import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveEvidence } from '../src/evidence-archive.ts';
import { loadAcceptance, saveRun } from '../src/acceptance.ts';
import { criteriaHash, digest, readRun, recordHash } from '../src/acceptance-format.ts';
import { renderPortingReport, writePortingReport, readReportLocation } from '../src/porting-report.ts';
const location = { title: 'TA evidence', scope: 'TA visual comparison only; DEV delivery is separately owned.', status: 'Documentation/Status/ta.md', output: 'Documentation/Verification/ta-evidence' };
function configure(root: string) {
  mkdirSync(join(root, 'Tools/Helix'), {recursive:true}); mkdirSync(join(root, 'Documentation/Status'), {recursive:true}); mkdirSync(join(root, 'Documentation/Verification'), {recursive:true});
  writeFileSync(join(root, 'Tools/Helix/report.json'), JSON.stringify({version:1,...location}));
  writeFileSync(join(root, location.status), 'Keep existing TA status');
}
test('portable reports escape imported text, use relative evidence links and preserve original verdicts', () => {
  const path = 'Tools/Helix/qa sources/sha256-abc.json';
  const rendered = renderPortingReport({ location, project: 'Example', reconciledUtc: '2026-11-12', sources: [{path, title: '<script>bad()</script>|Title', label: 'AK-1', delivery: 'Done', summary: 'Scoped failure <img src=x>', verdict: 'fail', at: '2026-11-12'}], journeys: [{title:'Win and return',sources:[path]}], findings: [{kind:'defect',status:'open',id:'claim-color',expected:'Orange',observed:'Gray',path:'Tools/Helix/discrepancies/claim-color/1.json'}] });
  assert.ok(!rendered.html.includes('<script>')); assert.ok(!rendered.html.includes('<img src=x>'));
  assert.match(rendered.html, /Done \/ fail/); assert.match(rendered.html, /Tools\/Helix\/qa%20sources\/sha256-abc.json/);
  assert.match(rendered.markdown, /archived media|archived path/); assert.match(rendered.markdown, /Status\/ta.md/);
  assert.ok(!rendered.html.includes('http://')); assert.ok(!rendered.html.includes('https://'));
  assert.equal(rendered.html, renderPortingReport({ location, project: 'Example', reconciledUtc: '2026-11-12', sources: [{path, title: '<script>bad()</script>|Title', label: 'AK-1', delivery: 'Done', summary: 'Scoped failure <img src=x>', verdict: 'fail', at: '2026-11-12'}], journeys: [{title:'Win and return',sources:[path]}], findings: [{kind:'defect',status:'open',id:'claim-color',expected:'Orange',observed:'Gray',path:'Tools/Helix/discrepancies/claim-color/1.json'}] }).html);
});
test('regeneration refuses to overwrite a hand-authored report or notes', async t => {
  const root=mkdtempSync(join(tmpdir(),'porting-report-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  configure(root);
  writeFileSync(join(root,location.output + '.md'),'Hand-authored progress');
  await assert.rejects(writePortingReport(root,'example'),/Refusing to overwrite/);
  assert.equal(readFileSync(join(root,location.output + '.md'),'utf8'),'Hand-authored progress');assert.equal(readFileSync(join(root,location.status),'utf8'),'Keep existing TA status');
});

function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'acceptance-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path: string, value: any) => { const full = join(root, path); mkdirSync(full.substring(0, full.lastIndexOf('/')), { recursive: true }); writeFileSync(full, typeof value === 'string' ? value : JSON.stringify(value)); };
  const scope = { version: 1, project: 'synthetic', variant: 'Default', status: 'approved', rationale: 'Synthetic test scope', screens: ['screens/result.json'], exclusions: [], viewports: [{ id: 'phone', width: 32, height: 64, safeArea: 'full-rectangle' }, { id: 'tablet', width: 64, height: 64, safeArea: 'full-rectangle' }] };
  const screen = { version: 1, id: 'screen.result', title: 'Result', implementation: 'implemented', implementationReferences: ['source.txt'], cases: [{ id: 'settled', dimension: 'appearance', required: true, viewports: ['phone', 'tablet'], basis: { kind: 'reference', source: 'synthetic' }, criteria: [{ id: 'layout', expected: 'Matching layout' }], dependencies: ['source.txt'], discrepancies: [], recipe: { reference: 'scenario:result', candidate: 'scenario:result', blockers: [], setup: 'isolated', anchors: ['settled'] } }] };
  put('Tools/Helix/acceptance/scope.json', scope); put('Tools/Helix/acceptance/screens/result.json', screen); put('source.txt', 'source'); put('media/reference.png', 'reference'); put('media/candidate.png', 'candidate');
  const reference = { version: 1 as const, project: 'synthetic', variant: 'Default', identity: digest('reference-source'), observedUtc: '2026-11-11T12:00:00.000Z' };
  const { scope: parsedScope, screens } = loadAcceptance(root, 'synthetic');
  const run = readRun({ version: 1, id: 'capture-1', project: 'synthetic', variant: 'Default', item: 'screen.result', caseId: 'settled', viewport: 'phone', criteriaSha256: criteriaHash(parsedScope, screens[0], screens[0].cases[0], 'phone'), capturedUtc: '2026-11-11T11:00:00.000Z', reference: { identity: reference.identity, description: 'Synthetic served content' }, candidate: { revision: 'synthetic-revision', inputs: [{ path: 'source.txt', sha256: digest('source') }] }, capture: { width: 32, height: 64, safeArea: 'full-rectangle', setup: 'isolated', anchors: ['settled'] }, outcome: 'matched', observations: [{ criterion: 'layout', result: 'match', note: 'Synthetic observation' }], artifacts: ['reference', 'candidate'].map(side => ({ path: 'media/' + side + '.png', sha256: digest(side), kind: 'image', side, recovery: 'synthetic-archive:' + side })), notes: 'Synthetic capture, not runtime validation' });
  const decision = { version: 1, id: 'review-1', project: 'synthetic', variant: 'Default', item: 'screen.result', caseId: 'settled', viewport: 'phone', runId: run.id, runSha256: recordHash(run), reviewer: { name: 'Synthetic reviewer', identity: 'self-reported' }, status: 'accepted', notes: 'Synthetic decision', savedUtc: '2026-11-11T12:00:00.000Z', supersedes: null };
  return { root, put, scope, screen, run, decision, reference };
}

test('report regeneration incorporates delivered runs, shared originals and new or revised findings without a QA manifest', async t => {
  const f = fixture(t); configure(f.root);
  f.put('Tools/Helix/catalog/catalog.json', { version: 1, project: 'synthetic', title: 'Synthetic', exclusions: [], sources: ['source.txt'], legacyReport: 'legacy.json', entries: [{ id: 'screen.result', title: 'Result', kind: 'screen', group: 'Screens', scope: 'game', summary: 'Result', sources: ['source.txt'], implementationReferences: ['source.txt'], discrepancies: ['layout'], evidence: [], acceptanceItem: 'screen.result' }] });
  f.put('legacy.json', { format: 'helix-porting-dashboard', version: 1, project: 'synthetic', reportedUtc: '2026-11-11T12:00:00.000Z', items: [] });
  f.put('resources.json', { fixture: 'synthetic' });
  f.put('Tools/Helix/acceptance/aikit.json', { version: 2, journeys: 'journeys.json' });
  f.put('journeys.json', { version: 1, project: 'synthetic', journeys: [{ id: 'tour', title: 'Tour', setup: 'Isolated', resources: [{ path: 'resources.json', pointer: '/fixture' }], branches: [{ id: 'baseline', title: 'Baseline', reset: 'Reset', parameters: ['baseline'], checkpoints: [{ id: 'settled', action: 'Observe', evidence: ['image'], focus: ['layout'] }], checks: [{ item: 'screen.result', caseId: 'settled', criteria: ['layout'], checkpoints: ['settled'] }] }] }] });
  const finding = { schemaVersion: 1, id: 'layout', status: 'open', expected: 'Expected layout', observed: 'Difference', evidence: [] };
  f.put('Tools/Helix/discrepancies/layout/1.json', finding);
  f.put('Tools/Helix/catalog/reconciliation.json', { version: 1, project: 'synthetic', findings: [{ id: 'layout', revision: 1, recordSha256: recordHash(finding), kind: 'defect', reason: 'Confirmed' }] });
  await writePortingReport(f.root, 'synthetic');
  const before = readFileSync(join(f.root, location.output + '.md'), 'utf8');
  assert.match(before, /Classification: defect/);
  f.run.outcome = 'blocked';
  await saveRun(f.root, 'synthetic', f.run);
  await saveRun(f.root, 'synthetic', { ...f.run, id: 'capture-2', capturedUtc: '2026-11-11T11:01:00.000Z' });
  f.put('Tools/Helix/discrepancies/layout/2.json', { ...finding, observed: 'Revised difference' });
  f.put('Tools/Helix/discrepancies/new-gap/1.json', { ...finding, id: 'new-gap' });
  f.put(location.status, 'Keep authored notes');
  const result = await writePortingReport(f.root, 'synthetic');
  assert.equal(result.markdown, location.output + '.md');
  assert.equal(existsSync(join(f.root, 'PORTING.md')), false); assert.equal(existsSync(join(f.root, 'PORTING-NOTES.md')), false);
  assert.equal(result.runs, 2); assert.equal(result.discrepancies, 2);
  const after = readFileSync(join(f.root, location.output + '.md'), 'utf8');
  assert.match(after, /Needs triage/); assert.match(after, /new-gap/); assert.match(after, /Revised difference/);
  assert.match(after, /### Tour[\s\S]*capture-2/);
  assert.equal(after.split('SHA-256:').length - 1, 2, 'shared artifacts appear once across runs');
  assert.match(after, /Hash verified/);
  assert.equal(readFileSync(join(f.root, location.status), 'utf8'), 'Keep authored notes');
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, 'Tools/Helix/discrepancies/layout/1.json'), 'utf8')), finding);
  f.put('media/reference.png', 'changed'); rmSync(join(f.root, 'media/candidate.png'));
  await writePortingReport(f.root, 'synthetic');
  const changed = readFileSync(join(f.root, location.output + '.md'), 'utf8');
  assert.match(changed, /Hash mismatch/); assert.match(changed, /Missing locally/);
  await writePortingReport(f.root, 'synthetic');
  assert.equal(readFileSync(join(f.root, location.output + '.md'), 'utf8'), changed);
  const directory = 'Tools/Helix/evidence/verification/shared';
  const archived = { ...f.run, id: 'capture-archived', capturedUtc: '2026-11-11T11:02:00.000Z', artifacts: f.run.artifacts.map(pin => ({ ...pin, path: directory + '/' + pin.side + '.png' })) };
  for (const pin of archived.artifacts) f.put(pin.path, pin.side);
  await saveRun(f.root, 'synthetic', archived);
  archiveEvidence(f.root, directory, true);
  await writePortingReport(f.root, 'synthetic');
  const recovered = readFileSync(join(f.root, location.output + '.html'), 'utf8');
  assert.match(recovered, /\.helix\/evidence-cache\/[a-f0-9]+\/reference.png/);
  assert.match(recovered, /Hash verified/);

});


test('report location is explicit, cannot overwrite status, and never creates root progress documents', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ta-location-')); t.after(() => rmSync(root, {recursive:true,force:true}));
  assert.throws(() => readReportLocation(root), /ENOENT/);
  configure(root);
  assert.equal(readReportLocation(root).status, location.status);
  writeFileSync(join(root, 'Tools/Helix/report.json'), JSON.stringify({version:1,...location,output:'Documentation/Status/ta'}));
  await assert.rejects(writePortingReport(root, 'synthetic'), /distinct/);
  assert.equal(readFileSync(join(root,location.status),'utf8'), 'Keep existing TA status');
});
