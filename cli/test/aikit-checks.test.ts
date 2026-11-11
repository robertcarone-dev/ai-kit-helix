import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { prepareAiKitChecks } from '../src/aikit-checks.ts';
import { submitPmTask } from '../src/pm-tasks.ts';
import { saveRun, loadAcceptance } from '../src/acceptance.ts';
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
