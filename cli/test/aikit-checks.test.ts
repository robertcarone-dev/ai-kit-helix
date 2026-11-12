import { journeyRequirements, selectJourneys } from '../src/journeys.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { prepareAiKitChecks, summarizeAiKitChecks } from '../src/aikit-checks.ts';
import { submitPmTask } from '../src/pm-tasks.ts';
import { saveRun, loadAcceptance, acceptanceStatus } from '../src/acceptance.ts';
import { criteriaHash, digest } from '../src/acceptance-format.ts';
function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'aikit checks ')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path: string, value: unknown) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value)); };
  const cases = Array.from({ length: 85 }, (_, i) => ({ id: 'case-' + i, dimension: 'behavior', required: true, viewports: ['phone', 'tablet'], basis: { kind: 'product', source: 'Product spec' }, criteria: [{ id: 'result', expected: 'Observe the actual action result ' + i }], dependencies: ['source.txt'], discrepancies: [], recipe: { reference: null, candidate: null, blockers: ['No direct capture adapter'], setup: 'Prepare state ' + i + ' then use the real controls', anchors: ['action', 'settled'] } }));
  const screen = { version: 1, id: 'feature.synthetic', title: 'Synthetic', implementation: 'implemented', implementationReferences: ['source.txt'], cases };
  put('Tools/Helix/acceptance/scope.json', { version: 1, project: 'synthetic', variant: 'Default', status: 'approved', rationale: 'Synthetic coverage', screens: ['screens/game.json'], exclusions: [], viewports: [{ id: 'phone', width: 32, height: 64, safeArea: 'full' }, { id: 'tablet', width: 64, height: 64, safeArea: 'full' }] });
  put('Tools/Helix/acceptance/screens/game.json', screen); put('source.txt', 'source'); put('instructions.md', 'Use owned lanes and the existing game input.');
  const config = { version: 1, instructions: 'instructions.md', manualCases: [{ item: screen.id, caseId: 'case-84', reason: 'Physical device unavailable' }] };
  put('Tools/Helix/acceptance/aikit.json', config);
  const executable = join(root, 'fake.cjs'); writeFileSync(executable, '#!' + process.execPath + '\nconst fs=require("node:fs");fs.appendFileSync("calls.txt","call\\n");fs.writeFileSync("packet.md",fs.readFileSync(process.argv[4].slice(1)));console.log(JSON.stringify({ok:true,id:"request-1"}));', { mode: 0o755 });
  put('.helix/aikit-pm.json', { version: 1, executable });
  return { root, put, config, screen };
}
const all = { item: null, caseId: null, remaining: true };
test('all authored primary scenarios are routed without hand-written adapter mappings; physical checks remain deferred', async t => {
  const f = fixture(t), plan = await prepareAiKitChecks(f.root, 'synthetic', all);
  assert.equal(plan.scenarioCount, 84); assert.equal(plan.viewportCount, 168); assert.equal(plan.deferred.length, 1); assert.equal(plan.blocker, null);
  assert.equal(new Set(plan.checks.map(check => check.caseId)).size, 84);
  for (const check of plan.checks) { assert.ok(plan.body.includes(check.setup)); assert.equal(check.inputs[0].sha256, digest('source')); assert.equal(check.viewports.length, 2); }
  assert.match(plan.body, /Unit tests, source inspection, generic screenshots/);
  f.put('Tools/Helix/acceptance/coverage-plan.json', { version: 1, project: 'synthetic', supplemental: [{ item: f.screen.id, caseId: 'case-83', reason: 'Supporting evidence only', coveredBy: [{ item: f.screen.id, caseId: 'case-0' }] }] });
  assert.equal((await prepareAiKitChecks(f.root, 'synthetic', all)).scenarioCount, 83);
  f.screen.cases.push({ ...f.screen.cases[0], id: 'new-case' }); f.put('Tools/Helix/acceptance/screens/game.json', f.screen);
  assert.equal((await prepareAiKitChecks(f.root, 'synthetic', all)).scenarioCount, 84);
});
test('case selection is exact and bad selections or stale manual exceptions fail', async t => {
  const f = fixture(t);
  assert.equal((await prepareAiKitChecks(f.root, 'synthetic', { item: f.screen.id, caseId: 'case-3', remaining: false })).scenarioCount, 1);
  assert.equal((await prepareAiKitChecks(f.root, 'synthetic', { item: f.screen.id, caseId: 'case-84', remaining: false })).scenarioCount, 0);
  await assert.rejects(prepareAiKitChecks(f.root, 'synthetic', { ...all, item: 'missing' }), /Unknown feature/);
  f.config.manualCases[0].caseId = 'missing'; f.put('Tools/Helix/acceptance/aikit.json', f.config);
  await assert.rejects(prepareAiKitChecks(f.root, 'synthetic', all), /Manual exception/);
});
test('reference observation timestamps do not invalidate preview; source changes do', async t => {
  const f = fixture(t), reference = { version: 1 as const, project: 'synthetic', variant: 'Default', identity: digest('reference'), observedUtc: '2026-11-11T12:00:00.000Z' };
  const a = await prepareAiKitChecks(f.root, 'synthetic', all, reference), b = await prepareAiKitChecks(f.root, 'synthetic', all, { ...reference, observedUtc: '2026-11-11T12:01:00.000Z' });
  assert.equal(a.token, b.token); f.put('source.txt', 'changed');
  const c = await prepareAiKitChecks(f.root, 'synthetic', all, reference); assert.notEqual(a.token, c.token);
  await assert.rejects(submitPmTask(f.root, c, a.token), /changed/); assert.equal(existsSync(join(f.root, 'calls.txt')), false);
});
test('AI Kit request is idempotent and never manufactures a run or acceptance decision', async t => {
  const f = fixture(t), plan = await prepareAiKitChecks(f.root, 'synthetic', all);
  const result = await submitPmTask(f.root, plan, plan.token); assert.equal(result.status, 'sent');
  await submitPmTask(f.root, plan, plan.token); assert.equal(readFileSync(join(f.root, 'calls.txt'), 'utf8'), 'call\n');
  assert.match(readFileSync(join(f.root, 'packet.md'), 'utf8'), /acceptance record-run/);
  assert.match(readFileSync(join(f.root, 'packet.md'), 'utf8'), /referenceObservation\(root, referenceRoot, project\)/);
  assert.match(readFileSync(join(f.root, 'packet.md'), 'utf8'), /Never hash a runtime receipt as a substitute/);
  assert.equal(existsSync(join(f.root, 'Tools/Helix/acceptance/runs')), false);
  assert.equal(existsSync(join(f.root, 'Tools/Helix/acceptance/decisions')), false);
});

test('manual-only selections cannot be submitted through the shared transport', async t => {
  const f = fixture(t), plan = await prepareAiKitChecks(f.root, 'synthetic', { item: f.screen.id, caseId: 'case-84', remaining: false });
  await assert.rejects(submitPmTask(f.root, plan, plan.token), /No executable checks/);
  assert.equal(existsSync(join(f.root, 'calls.txt')), false);
});
test('imported passing evidence removes only its completed viewport and changed inputs restore it', async t => {
  const f = fixture(t), selection = { item: f.screen.id, caseId: 'case-0', remaining: true };
  Object.assign(f.screen.cases[0].recipe, { blockers: [], reference: 'scenario:synthetic', candidate: 'scenario:synthetic' }); f.put('Tools/Helix/acceptance/screens/game.json', f.screen);
  f.put('Tools/Helix/catalog/catalog.json', { version: 1, project: 'synthetic', title: 'Synthetic', sources: [], exclusions: [], legacyReport: 'legacy.json', entries: [{ id: f.screen.id, title: 'Synthetic', kind: 'feature', group: 'Game', scope: 'game', summary: 'Synthetic', sources: [], implementationReferences: [], discrepancies: [], evidence: [], acceptanceItem: f.screen.id }] });
  f.put('Tools/Helix/resolutions/automation.json', { version: 2, project: 'synthetic', workflows: [{ id: 'synthetic-check', item: f.screen.id, caseId: 'case-0', review: 'automated', unity: { scene: 'scene.unity', preflightScripts: ['audit.cs'] } }] });
  const { scope, screens } = loadAcceptance(f.root, 'synthetic');
  f.put('media/observations.json', 'synthetic observations');
  await saveRun(f.root, 'synthetic', { version: 1, id: 'synthetic-run', project: 'synthetic', variant: 'Default', item: f.screen.id, caseId: 'case-0', viewport: 'phone', criteriaSha256: criteriaHash(scope, screens[0], screens[0].cases[0], 'phone'), capturedUtc: '2026-11-11T11:00:00.000Z', reference: { identity: digest('reference'), description: 'Synthetic product assertion' }, candidate: { revision: 'synthetic', inputs: [{ path: 'source.txt', sha256: digest('source') }] }, capture: { width: 32, height: 64, safeArea: 'full', setup: f.screen.cases[0].recipe.setup, anchors: ['action', 'settled'] }, outcome: 'matched', observations: [{ criterion: 'result', result: 'match', note: 'Synthetic observation' }], artifacts: [{ path: 'media/observations.json', sha256: digest('synthetic observations'), kind: 'observations', side: 'candidate', recovery: 'synthetic-archive:observations' }], notes: 'Synthetic test only' });
  assert.deepEqual((await prepareAiKitChecks(f.root, 'synthetic', selection)).checks[0].viewports.map(v => v.id), ['tablet']);
  assert.equal((await prepareAiKitChecks(f.root, 'synthetic', { ...selection, remaining: false })).viewportCount, 2);
  f.put('source.txt', 'changed');
  assert.equal((await prepareAiKitChecks(f.root, 'synthetic', selection)).viewportCount, 2);
});

function grouped(f: ReturnType<typeof fixture>) {
  const checkpoint = { id: 'settled', action: 'Use the real controls and observe the settled state', evidence: ['video', 'observations'], focus: ['control', 'state'] };
  const document = { version: 1, project: 'synthetic', journeys: [{ id: 'tour', title: 'Tour', setup: 'Pinned synthetic setup', resources: [{ path: 'resources.json', pointer: '/fixture' }], branches: [{ id: 'baseline', title: 'Baseline', reset: 'Restore isolated state before each variant', parameters: ['known state'], checkpoints: [checkpoint], checks: f.screen.cases.map(entry => ({ item: f.screen.id, caseId: entry.id, criteria: entry.criteria.map(criterion => criterion.id), checkpoints: ['settled'] })) }] }] };
  f.put('resources.json', { fixture: { seed: 54 } });
  f.put('journeys.json', document);
  f.put('Tools/Helix/acceptance/aikit.json', { ...f.config, version: 2, journeys: 'journeys.json' });
  return document;
}
test('grouped plans preserve all primary checks, validate coverage and retain branch prerequisites under selection', async t => {
  const f = fixture(t), document = grouped(f);
  const plan = await prepareAiKitChecks(f.root, 'synthetic', all);
  assert.equal(plan.journeyCount, 1); assert.equal(plan.branchCount, 1); assert.equal(plan.scenarioCount, 84);
  assert.equal(plan.deferred.length, 1); assert.equal(plan.workCounts.capture, 168);
  assert.equal(plan.journeys[0].branches[0].checks.length, 84);
  const single = await prepareAiKitChecks(f.root, 'synthetic', { item: f.screen.id, caseId: 'case-3', remaining: true });
  assert.equal(single.journeys[0].branches[0].checks.length, 1);
  assert.deepEqual(single.journeys[0].branches[0].checkpoints, document.journeys[0].branches[0].checkpoints);
  document.journeys[0].branches[0].checks.pop(); f.put('journeys.json', document);
  await assert.rejects(prepareAiKitChecks(f.root, 'synthetic', all), /missing journey coverage/);
});
test('journey validation rejects stale checks, invalid checkpoint links, escaping resources and duplicates', async t => {
  const f = fixture(t), baseline = grouped(f);
  for (const [mutate, message] of [
    [(d: any) => d.journeys[0].branches[0].checks[0].caseId = 'missing', /current primary/],
    [(d: any) => d.journeys[0].branches[0].checks[0].checkpoints = ['missing'], /Unknown journey checkpoint/],
    [(d: any) => d.journeys[0].branches[0].checks[0].criteria = ['missing'], /Unknown journey criterion/],
    [(d: any) => d.journeys[0].resources[0].path = '../escape.json', /portable relative path/],
    [(d: any) => d.journeys[0].branches.push(d.journeys[0].branches[0]), /Duplicate journey branch/],
  ] as const) { const document = structuredClone(baseline); mutate(document); f.put('journeys.json', document); await assert.rejects(prepareAiKitChecks(f.root, 'synthetic', all), message); }
});
test('journey and resource edits invalidate previews; unknown journey fails and partial scope is explicit', async t => {
  const f = fixture(t), document = grouped(f);
  document.journeys.push({ ...structuredClone(document.journeys[0]), id: 'other', branches: [{ ...structuredClone(document.journeys[0].branches[0]), checks: [document.journeys[0].branches[0].checks[0]] }] }); f.put('journeys.json', document);
  const selection = { ...all, journey: 'other' }, a = await prepareAiKitChecks(f.root, 'synthetic', selection);
  assert.equal(a.scenarioCount, 1); assert.equal(a.journeyCount, 1); assert.equal(a.journeys[0].id, 'other');
  assert.equal(a.obligations[0].branches.filter(branch => !branch.selected).length, 1);
  f.put('resources.json', { fixture: { seed: 55 } });
  const b = await prepareAiKitChecks(f.root, 'synthetic', selection); assert.notEqual(a.token, b.token);
  document.journeys[1].branches[0].reset = 'New required reset'; f.put('journeys.json', document);
  const c = await prepareAiKitChecks(f.root, 'synthetic', selection); assert.notEqual(b.token, c.token);
  await assert.rejects(prepareAiKitChecks(f.root, 'synthetic', { ...all, journey: 'missing' }), /Unknown journey/);
  await assert.rejects(submitPmTask(f.root, c, a.token), /changed/);
  f.put('resources.json', { wrong: {} });
  await assert.rejects(prepareAiKitChecks(f.root, 'synthetic', selection), /Missing dependency selection/);
});
test('shared evidence is indexed once while each check retains its own freshness and work disposition', async t => {
  const f = fixture(t);
  const { scope, screens } = loadAcceptance(f.root, 'synthetic');
  f.put('media/shared.json', 'shared observations');
  for (const [index, outcome] of [[0, 'matched'], [1, 'mismatch']] as const) {
    const entry = screens[0].cases[index];
    await saveRun(f.root, 'synthetic', { version: 1, id: 'shared-' + index, project: 'synthetic', variant: 'Default', item: f.screen.id, caseId: entry.id, viewport: 'phone', criteriaSha256: criteriaHash(scope, screens[0], entry, 'phone'), capturedUtc: '2026-11-11T11:00:00.000Z', reference: { identity: digest('reference'), description: 'Synthetic product observation' }, candidate: { revision: 'synthetic', inputs: [{ path: 'source.txt', sha256: digest('source') }] }, capture: { width: 32, height: 64, safeArea: 'full', setup: entry.recipe.setup, anchors: ['action', 'settled'] }, outcome, observations: [{ criterion: 'result', result: outcome === 'matched' ? 'match' : 'mismatch', note: 'Scoped observation ' + index }], artifacts: [{ path: 'media/shared.json', sha256: digest('shared observations'), kind: 'observations', side: 'candidate', recovery: 'synthetic-archive:shared-' + index }], notes: 'Two scoped results share original evidence' });
  }
  grouped(f);
  const a = await prepareAiKitChecks(f.root, 'synthetic', all);
  assert.equal(a.evidence.length, 1); assert.equal(a.evidence[0].consumers.length, 2); assert.equal(a.evidence[0].recoveries.length, 2);
  assert.equal(a.workCounts.review, 1); assert.equal(a.workCounts.investigate, 1);
  assert.match(a.body, /pending human decision alone never requires another capture/);
  f.put('source.txt', 'changed'); const stale = await prepareAiKitChecks(f.root, 'synthetic', all);
  assert.equal(stale.workCounts.review, 0); assert.equal(stale.workCounts.investigate, 0);
  rmSync(join(f.root, 'media/shared.json')); const missing = await prepareAiKitChecks(f.root, 'synthetic', all);
  assert.equal(missing.workCounts.recover, 2);
  assert.equal(existsSync(join(f.root, 'Tools/Helix/acceptance/decisions')), false);
});


test('grouped submission sends bounded dispatch with immutable scoped detail files exactly once', async t => {
  const f = fixture(t); grouped(f);
  const plan = await prepareAiKitChecks(f.root, 'synthetic', all);
  assert.equal(plan.packetFiles.length, 2);
  assert.ok(plan.body.length < 20000);
  const details = JSON.parse(plan.packetFiles[0].content);
  assert.equal(details.checks.length, 84); assert.equal(details.journey.branches[0].checks.length, 84);
  const receipt = await submitPmTask(f.root, plan, plan.token);
  assert.equal(receipt.status, 'sent');
  const packet = readFileSync(join(f.root, 'packet.md'), 'utf8');
  assert.match(packet, /details-journey-tour.json/); assert.match(packet, /details-history.json/);
  assert.equal(readFileSync(join(f.root, '.helix/task-submissions', plan.key, 'details-journey-tour.json'), 'utf8'), plan.packetFiles[0].content);
  await submitPmTask(f.root, plan, plan.token);
  assert.equal(readFileSync(join(f.root, 'calls.txt'), 'utf8'), 'call\n');
});


test('new criteria cannot silently inherit an existing journey mapping', async t => {
  const f = fixture(t); grouped(f);
  f.screen.cases[0].criteria.push({ id: 'new-boundary', expected: 'Observe the newly required boundary' });
  f.put('Tools/Helix/acceptance/screens/game.json', f.screen);
  await assert.rejects(prepareAiKitChecks(f.root, 'synthetic', all), /Primary criteria missing journey coverage/);
});
test('packet file names cannot escape the immutable submission directory', async t => {
  const f = fixture(t); grouped(f);
  const plan = await prepareAiKitChecks(f.root, 'synthetic', all);
  plan.packetFiles[0].name = '../escape.json';
  await assert.rejects(submitPmTask(f.root, plan, plan.token), /Invalid or duplicate packet detail name/);
  assert.equal(existsSync(join(f.root, 'calls.txt')), false);
});

test('CLI summary retains the exact submission token without expanding criteria or media', async t => {
  const f = fixture(t); grouped(f);
  const plan = await prepareAiKitChecks(f.root, 'synthetic', all), summary = summarizeAiKitChecks(plan);
  assert.equal(summary.token, plan.token); assert.equal(summary.checkCount, 84); assert.equal(summary.packets.length, 2);
  assert.ok(JSON.stringify(summary).length < 5000); assert.equal('body' in summary, false); assert.equal('checks' in summary, false);
});

async function runCase(f, index, note = 'Scoped evidence', overrides = {}) {
 const {scope,screens}=loadAcceptance(f.root,'synthetic'), entry=screens[0].cases[index];
 f.put('media/observations.json','observations');
 await saveRun(f.root,'synthetic',{version:1,id:'run-'+index,project:'synthetic',variant:'Default',item:f.screen.id,caseId:entry.id,viewport:'phone',criteriaSha256:criteriaHash(scope,screens[0],entry,'phone'),capturedUtc:'2026-11-11T11:00:00.000Z',reference:{identity:digest('reference'),description:'Product'},candidate:{revision:'synthetic',inputs:[{path:'source.txt',sha256:digest('source')}]},capture:{width:32,height:64,safeArea:'full',setup:entry.recipe.setup,anchors:['action','settled']},outcome:'matched',observations:[{criterion:'result',result:'match',note}],artifacts:[{path:'media/observations.json',sha256:digest('observations'),kind:'observations',side:'candidate',recovery:'archive:observations'}],notes:note,...overrides});
}

test('journey acceptance enforces complete current coverage and resumes partial observations', async t => {
  const f = fixture(t); Object.assign(f.screen.cases[0].recipe, { blockers: [], candidate: 'scenario:synthetic' }); f.put('Tools/Helix/acceptance/screens/game.json', f.screen);
  await runCase(f, 0);
  const d = grouped(f);
  d.journeys[0].branches[0].checkpoints[0].evidence = ['observations'];
  d.journeys[0].branches.push({ ...structuredClone(d.journeys[0].branches[0]), id: 'other', checks: [d.journeys[0].branches[0].checks[0]] });
  f.put('journeys.json', d);
  const row = async () => (await acceptanceStatus(f.root, 'synthetic')).items[0].cases.find(c => c.id === 'case-0' && c.viewport === 'phone')!;
  assert.equal((await row()).canAccept, false, 'Legacy whole-case match is not branch coverage');
  const requirements = journeyRequirements(f.root, d, f.screen.id, 'case-0');
  const coverage = requirements.map(({ criteria, evidence, ...value }) => ({ ...value, observations: [{ criterion: 'result', result: 'match', note: 'Observed this parameter at this checkpoint' }], artifacts: ['media/observations.json'] }));
  await assert.rejects(runCase(f, 0, 'Partial', { id: 'partial-match', capturedUtc: '2026-11-11T12:00:00.000Z', journeyCoverage: coverage.slice(0, 1) }), /complete current journey/);
  await runCase(f, 0, 'Partial', { id: 'partial', capturedUtc: '2026-11-11T12:00:00.000Z', outcome: 'unmeasured', journeyCoverage: coverage.slice(0, 1) });
  const plan = await prepareAiKitChecks(f.root, 'synthetic', { item: f.screen.id, caseId: 'case-0', remaining: true });
  assert.deepEqual(plan.checks[0].viewports[0].journeyCoverage.map(c => c.complete), [true, false]);
  await runCase(f, 0, 'Complete', { id: 'complete', capturedUtc: '2026-11-11T13:00:00.000Z', journeyCoverage: coverage });
  assert.equal((await row()).canAccept, true);
  d.journeys[0].branches[1].parameters = ['changed variant']; f.put('journeys.json', d);
  assert.equal((await row()).canAccept, false);
  assert.deepEqual((await row()).journeyCoverage.map(c => c.complete), [true, false]);
  f.put('source.txt', 'changed');
  assert.ok((await row()).journeyCoverage.every(c => !c.complete));
});
test('current supplemental evidence is scoped review input without granting primary coverage', async t => {
  const f = fixture(t);
  f.put('Tools/Helix/acceptance/coverage-plan.json', { version: 1, project: 'synthetic', supplemental: [{ item: f.screen.id, caseId: 'case-1', reason: 'Shared observation', coveredBy: [{ item: f.screen.id, caseId: 'case-0' }] }] });
  const d = grouped(f); d.journeys[0].branches[0].checks = d.journeys[0].branches[0].checks.filter(c => c.caseId !== 'case-1'); f.put('journeys.json', d);
  await runCase(f, 1);
  const plan = await prepareAiKitChecks(f.root, 'synthetic', { item: f.screen.id, caseId: 'case-0', remaining: true });
  assert.equal(plan.evidence.length, 1); assert.equal(plan.checks[0].viewports[0].work, 'review');
  assert.equal(plan.evidence[0].consumers[0].source.caseId, 'case-1');
  assert.equal(plan.checks[0].viewports[0].complete, false);
  f.put('source.txt', 'changed');
  assert.equal((await prepareAiKitChecks(f.root, 'synthetic', { item: f.screen.id, caseId: 'case-0', remaining: true })).checks[0].viewports[0].work, 'capture');
});
test('checkpoint selection keeps transitive prerequisites and excludes later unrelated actions', t => {
  const f = fixture(t), d = grouped(f), b = d.journeys[0].branches[0];
  b.checkpoints = [
    { ...b.checkpoints[0], id: 'open', prerequisites: [] },
    { ...b.checkpoints[0], id: 'settled', prerequisites: ['open'] },
    { ...b.checkpoints[0], id: 'claim', prerequisites: ['settled'] },
  ];
  const selected = selectJourneys(d, [{ item: f.screen.id, caseId: 'case-0', viewports: [{ id: 'phone' }] }]);
  assert.deepEqual(selected[0].branches[0].checkpoints.map(c => c.id), ['open', 'settled']);
  b.checkpoints[0].prerequisites = ['claim']; f.put('journeys.json', d);
  assert.throws(() => loadAcceptance(f.root, 'synthetic'), /earlier checkpoints/);
});

function twoSteps(f) {
 const d=grouped(f), b=d.journeys[0].branches[0];
 b.checkpoints=[{id:'first',action:'First action',evidence:['observations'],focus:['first']},{id:'second',action:'Second action',evidence:['observations'],focus:['second'],prerequisites:['first']}];
 b.checks.forEach(c=>{ c.checkpoints=['first','second']; c.checkpointCriteria=[{checkpoint:'first',criteria:[c.criteria[0]]},{checkpoint:'second',criteria:c.criteria.length>1?c.criteria.slice(1):c.criteria}]; });
 f.put('journeys.json',d); return d;
}
test('matched import rejects a required checkpoint without its own observations',async t=>{
 const f=fixture(t);Object.assign(f.screen.cases[0].recipe,{blockers:[],candidate:'scenario:synthetic'});f.put('Tools/Helix/acceptance/screens/game.json',f.screen);
 const d=twoSteps(f), req=journeyRequirements(f.root,d,f.screen.id,'case-0');
 const coverage=req.map(({criteria,evidence,...r},i)=>({...r,observations:i===0?[{criterion:'result',result:'match',note:'Observed FIRST only'}]:[],artifacts:['media/observations.json']}));
 await assert.rejects(runCase(f,0,'Only first checkpoint judged',{journeyCoverage:coverage}), /complete current journey/);
});
test('completed checkpoints remain reusable while later criteria are pending',async t=>{
 const f=fixture(t);f.screen.cases[0].criteria.push({id:'later',expected:'Later state'});f.put('Tools/Helix/acceptance/screens/game.json',f.screen);
 const d=twoSteps(f), req=journeyRequirements(f.root,d,f.screen.id,'case-0');
 const {criteria,evidence,...r}=req[0];
 await runCase(f,0,'First complete; second pending',{outcome:'unmeasured',journeyCoverage:[{...r,observations:[{criterion:'result',result:'match',note:'First checkpoint observed'}],artifacts:['media/observations.json']}]});
 const plan=await prepareAiKitChecks(f.root,'synthetic',{item:f.screen.id,caseId:'case-0',remaining:true});
 assert.deepEqual(plan.checks[0].viewports[0].journeyCoverage.map(c=>c.complete),[true,false]);
 d.journeys[0].branches[0].checkpoints[1].action='Changed later action';f.put('journeys.json',d);
 const changed=await prepareAiKitChecks(f.root,'synthetic',{item:f.screen.id,caseId:'case-0',remaining:true});
 assert.deepEqual(changed.checks[0].viewports[0].journeyCoverage.map(c=>c.complete),[true,false]);
});
test('missing supporting evidence is scheduled for recovery before recapture',async t=>{
 const f=fixture(t);f.put('Tools/Helix/acceptance/coverage-plan.json',{version:1,project:'synthetic',supplemental:[{item:f.screen.id,caseId:'case-1',reason:'Shared evidence',coveredBy:[{item:f.screen.id,caseId:'case-0'}]}]});
 const d=grouped(f);d.journeys[0].branches[0].checks=d.journeys[0].branches[0].checks.filter(c=>c.caseId!=='case-1');f.put('journeys.json',d);
 await runCase(f,1);rmSync(join(f.root,'media/observations.json'));
 const p=await prepareAiKitChecks(f.root,'synthetic',{item:f.screen.id,caseId:'case-0',remaining:true});
 assert.equal(p.evidence[0].consumers[0].availability,'missing');assert.equal(p.checks[0].viewports[0].work,'recover');assert.deepEqual(p.evidence[0].recoveries,['archive:observations']);
});

test('each explicit variant requires a separate scoped receipt', async t => {
  const f=fixture(t), d=grouped(f), b=d.journeys[0].branches[0];
  b.parameters=['ad complete','ad cancel','ad failure','ad unavailable','ad pending'];
  b.checkpoints[0].evidence=['observations']; f.put('journeys.json',d);
  const requirements=journeyRequirements(f.root,d,f.screen.id,'case-0');
  const coverage=requirements.map(({criteria,evidence,...value})=>({...value,observations:[{criterion:'result',result:'match',note:'Observed this exact provider outcome'}],artifacts:['media/observations.json']}));
  for (let omitted=0;omitted<coverage.length;omitted++) await assert.rejects(runCase(f,0,'One outcome missing',{journeyCoverage:coverage.filter((_,i)=>i!==omitted)}), /complete current journey/);
  await runCase(f,0,'All outcomes',{journeyCoverage:coverage});
  b.parameters.push('ad skipped');f.put('journeys.json',d);
  const p=await prepareAiKitChecks(f.root,'synthetic',{item:f.screen.id,caseId:'case-0',remaining:true});
  assert.deepEqual(p.checks[0].viewports[0].journeyCoverage.map(c=>c.complete),[true,true,true,true,true,false]);
});
test('checkpoint criteria cannot omit a checkpoint or strand a criterion', t => {
  const f=fixture(t), d=twoSteps(f), c=d.journeys[0].branches[0].checks[0];
  delete c.checkpointCriteria;f.put('journeys.json',d);
  assert.throws(()=>loadAcceptance(f.root,'synthetic'), /explicit checkpoint criteria/);
  c.checkpointCriteria=[{checkpoint:'first',criteria:['result']}];f.put('journeys.json',d);
  assert.throws(()=>loadAcceptance(f.root,'synthetic'), /Missing checkpoint criterion/);
  c.checkpointCriteria.push({checkpoint:'second',criteria:['unknown']});f.put('journeys.json',d);
  assert.throws(()=>loadAcceptance(f.root,'synthetic'), /Unknown checkpoint criterion/);
});

test('case selection prunes inapplicable variants without weakening their other check owners', async t => {
  const f=fixture(t), d=grouped(f), b=d.journeys[0].branches[0];
  b.parameters=['arm cancel','confirmed hit'];b.checks[0].parameters=['arm cancel'];b.checks[1].parameters=['confirmed hit'];f.put('journeys.json',d);
  const p=await prepareAiKitChecks(f.root,'synthetic',{item:f.screen.id,caseId:'case-0',remaining:true});
  assert.deepEqual(p.journeys[0].branches[0].parameters,['arm cancel']);
  assert.ok(p.checks[0].viewports[0].journeyCoverage.every(c=>c.parameter==='arm cancel'));
  b.checks[0].parameters=['unknown'];f.put('journeys.json',d);
  assert.throws(()=>loadAcceptance(f.root,'synthetic'), /Unknown check parameter/);
  b.checks.forEach(c=>c.parameters=['arm cancel']);f.put('journeys.json',d);
  assert.throws(()=>loadAcceptance(f.root,'synthetic'), /no check coverage/);
});

test('a missing later artifact does not discard available earlier checkpoint evidence', async t => {
  const f=fixture(t), d=twoSteps(f), requirements=journeyRequirements(f.root,d,f.screen.id,'case-0');
  f.put('media/second.json','second');
  const coverage=requirements.map(({criteria,evidence,...value},index)=>({...value,observations:[{criterion:'result',result:'match',note:'Observed this checkpoint'}],artifacts:[index===0?'media/observations.json':'media/second.json']}));
  const artifacts=[{path:'media/observations.json',sha256:digest('observations'),kind:'observations',side:'candidate',recovery:'archive:first'},{path:'media/second.json',sha256:digest('second'),kind:'observations',side:'candidate',recovery:'archive:second'}];
  await runCase(f,0,'Both checkpoints captured',{journeyCoverage:coverage,artifacts});
  rmSync(join(f.root,'media/second.json'));
  const p=await prepareAiKitChecks(f.root,'synthetic',{item:f.screen.id,caseId:'case-0',remaining:true});
  assert.deepEqual(p.checks[0].viewports[0].journeyCoverage.map(c=>c.complete),[true,false]);
  assert.equal(p.checks[0].viewports[0].work,'recover');
  assert.equal(p.checks[0].viewports[0].complete,false);
});

test('compact journey packets preserve every requirement and viewport reuse index without duplicating coverage', async t => {
  const f=fixture(t), d=grouped(f);d.journeys[0].branches[0].checkpoints[0].evidence=['observations'];f.put('journeys.json',d);
  const requirements=journeyRequirements(f.root,d,f.screen.id,'case-0');
  await runCase(f,0,'Captured',{journeyCoverage:requirements.map(({criteria,evidence,...value})=>({...value,observations:[{criterion:'result',result:'match',note:'Observed this checkpoint'}],artifacts:['media/observations.json']}))});
  const p=await prepareAiKitChecks(f.root,'synthetic',{item:f.screen.id,caseId:'case-0',remaining:true}), packet=JSON.parse(p.packetFiles[0].content), binding=packet.journey.branches[0].checks[0];
  assert.equal(binding.requirements.length,requirements.length);
  for (const row of binding.coverage) {
    const expected=p.checks[0].viewports.find(viewport=>viewport.id===row.viewport)!.journeyCoverage;
    assert.deepEqual(binding.requirements,expected.map(({parameter,checkpoint,definitionSha256})=>({parameter,checkpoint,definitionSha256})));
    assert.deepEqual(row.reusable,expected.flatMap((value,index)=>value.complete?[index]:[]));
  }
  assert.deepEqual(binding.coverage.map(row=>row.reusable),[[0],[]]);
  assert.ok(packet.checks[0].viewports.every(viewport=>!Object.hasOwn(viewport,'journeyCoverage')));
  assert.match(p.body,/zero-based indexes/);
});
