import { acceptanceBackend, referenceObservation } from '../workbench/acceptance-backend.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptanceStatus, loadAcceptance, publishAcceptance, saveAssessment, saveDecision, saveRun } from '../src/acceptance.ts';
import { criteriaHash, digest, readRun, readScreen, recordHash } from '../src/acceptance-format.ts';

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
test('required coverage survives missing records; acceptance is exact to viewport and durable', async t => {
  const f = fixture(t);
  let status = await acceptanceStatus(f.root, 'synthetic');
  assert.equal(status.items[0].required, 2); assert.equal(status.items[0].accepted, 0);
  await saveRun(f.root, 'synthetic', f.run);
  await assert.rejects(saveDecision(f.root, 'synthetic', f.decision), /eligible/);
  await saveDecision(f.root, 'synthetic', f.decision, f.reference);
  status = await acceptanceStatus(f.root, 'synthetic', f.reference);
  assert.equal(status.items[0].accepted, 1); assert.equal(status.items[0].status, 'incomplete');
  assert.equal(status.items[0].cases[1].review, 'pending');
  assert.equal((await saveDecision(f.root, 'synthetic', f.decision, f.reference)).status, 'unchanged');
  assert.equal(JSON.parse(readFileSync(join(f.root, 'Tools/Helix/acceptance/decisions/review-1.json'), 'utf8')).runSha256, recordHash(f.run));
});
test('relevant changes invalidate acceptance while unrelated files do not', async t => {
  const f = fixture(t); await saveRun(f.root, 'synthetic', f.run); await saveDecision(f.root, 'synthetic', f.decision, f.reference);
  f.put('unrelated.txt', 'new'); assert.equal((await acceptanceStatus(f.root, 'synthetic', f.reference)).items[0].accepted, 1);
  f.put('source.txt', 'changed'); let row = (await acceptanceStatus(f.root, 'synthetic', f.reference)).items[0].cases[0];
  assert.equal(row.freshness, 'needs-recheck'); assert.equal(row.accepted, false); assert.equal(row.lastAccepted!.id, 'review-1');
  f.put('source.txt', 'source'); assert.equal((await acceptanceStatus(f.root, 'synthetic', f.reference)).items[0].accepted, 1);
  const reference = { ...f.reference, identity: digest('new-reference') };
  assert.equal((await acceptanceStatus(f.root, 'synthetic', reference)).items[0].cases[0].freshness, 'needs-recheck');
  f.screen.cases[0].criteria[0].expected = 'Changed criterion'; f.put('Tools/Helix/acceptance/screens/result.json', f.screen);
  assert.equal((await acceptanceStatus(f.root, 'synthetic', f.reference)).items[0].accepted, 0);
});
test('missing or corrupted media cannot remain accepted; recovery restores original evidence', async t => {
  const f = fixture(t); await saveRun(f.root, 'synthetic', f.run); await saveDecision(f.root, 'synthetic', f.decision, f.reference);
  rmSync(join(f.root, 'media/candidate.png'));
  let row = (await acceptanceStatus(f.root, 'synthetic', f.reference)).items[0].cases[0]; assert.equal(row.availability, 'missing'); assert.equal(row.accepted, false);
  f.put('media/candidate.png', 'wrong'); row = (await acceptanceStatus(f.root, 'synthetic', f.reference)).items[0].cases[0]; assert.equal(row.availability, 'unverified');
  f.put('media/candidate.png', 'candidate'); assert.equal((await acceptanceStatus(f.root, 'synthetic', f.reference)).items[0].accepted, 1);
});
test('stale saves, immutable record replacement and forged host identities fail', async t => {
  const f = fixture(t); await saveRun(f.root, 'synthetic', f.run); await saveDecision(f.root, 'synthetic', f.decision, f.reference);
  await assert.rejects(saveDecision(f.root, 'synthetic', { ...f.decision, id: 'review-2' }, f.reference), /changed since/);
  await assert.rejects(saveDecision(f.root, 'synthetic', { ...f.decision, notes: 'overwrite' }, f.reference), /Immutable/);
  await assert.rejects(saveDecision(f.root, 'synthetic', { ...f.decision, reviewer: { name: 'fake', identity: 'host-verified' } }, f.reference), /host verification/);
  await saveDecision(f.root, 'synthetic', { ...f.decision, id: 'review-2', supersedes: 'review-1', status: 'changes-requested' }, f.reference);
  assert.equal((await acceptanceStatus(f.root, 'synthetic', f.reference)).items[0].accepted, 0);
});
test('incomplete observations, input pins, wrong dimensions, wrong project and stills for motion are rejected', async t => {
  const f = fixture(t);
  for (const bad of [{ ...f.run, observations: [] }, { ...f.run, candidate: { ...f.run.candidate, inputs: [] } }, { ...f.run, capture: { ...f.run.capture, width: 64 } }, { ...f.run, project: 'other' }]) await assert.rejects(saveRun(f.root, 'synthetic', bad));
  f.screen.cases[0].dimension = 'motion'; f.put('Tools/Helix/acceptance/screens/result.json', f.screen);
  const { scope, screens } = loadAcceptance(f.root, 'synthetic');
  await assert.rejects(saveRun(f.root, 'synthetic', { ...f.run, criteriaSha256: criteriaHash(scope, screens[0], screens[0].cases[0], 'phone') }), /paired evidence type/);
});
test('open defects and unmapped accepted deviations block acceptance, not observation recording', async t => {
  const f = fixture(t); (f.screen.cases[0].discrepancies as string[]).push('layout-defect'); f.put('Tools/Helix/acceptance/screens/result.json', f.screen);
  const { scope, screens } = loadAcceptance(f.root, 'synthetic'); f.run.criteriaSha256 = criteriaHash(scope, screens[0], screens[0].cases[0], 'phone'); f.decision.runSha256 = recordHash(f.run);
  await saveRun(f.root, 'synthetic', f.run);
  for (const status of ['open', 'blocked', 'accepted-deviation']) {
    f.put('Tools/Helix/discrepancies/layout-defect/1.json', { id: 'layout-defect', status });
    await assert.rejects(saveDecision(f.root, 'synthetic', f.decision, f.reference), /eligible/);
  }
  f.put('Tools/Helix/discrepancies/layout-defect/2.json', { id: 'layout-defect', status: 'resolved' });
  await saveDecision(f.root, 'synthetic', f.decision, f.reference);
});
test('zero-case screens are unconfigured, unknown fields fail, and checkout escape is rejected', async t => {
  const f = fixture(t); f.screen.cases = []; f.put('Tools/Helix/acceptance/screens/result.json', f.screen);
  assert.equal((await acceptanceStatus(f.root, 'synthetic')).items[0].status, 'unconfigured');
  assert.throws(() => readScreen({ ...f.screen, accepted: true }), /fields/);
  f.scope.screens = ['../escape.json']; f.put('Tools/Helix/acceptance/scope.json', f.scope); assert.throws(() => loadAcceptance(f.root, 'synthetic'), /relative path/);
  f.scope.screens = ['screens/result.json']; f.put('Tools/Helix/acceptance/scope.json', f.scope);
  rmSync(join(f.root, 'Tools/Helix/acceptance/screens/result.json')); symlinkSync('/etc/hosts', join(f.root, 'Tools/Helix/acceptance/screens/result.json'));
  assert.throws(() => loadAcceptance(f.root, 'synthetic'), /escapes checkout/);
});
test('divergent and cyclic review histories fail instead of selecting by timestamp', async t => {
  const f = fixture(t); await saveRun(f.root, 'synthetic', f.run); await saveDecision(f.root, 'synthetic', f.decision, f.reference);
  f.put('Tools/Helix/acceptance/decisions/other.json', { ...f.decision, id: 'other' });
  await assert.rejects(acceptanceStatus(f.root, 'synthetic', f.reference), /Conflicting/);
});

test('deleted source keeps historical approval but requires recheck', async t => {
  const f = fixture(t); await saveRun(f.root, 'synthetic', f.run); await saveDecision(f.root, 'synthetic', f.decision, f.reference);
  rmSync(join(f.root, 'source.txt'));
  const row = (await acceptanceStatus(f.root, 'synthetic', f.reference)).items[0].cases[0];
  assert.equal(row.freshness, 'needs-recheck'); assert.equal(row.accepted, false); assert.equal(row.lastAccepted!.id, 'review-1');
});
test('publication preserves unrelated legacy rows and exposes the full required denominator', async t => {
  const f = fixture(t);
  const other = { id: 'screen.other', kind: 'screen', title: 'Other', status: 'in-progress', summary: 'Legacy claim', issues: [], evidence: [] };
  f.put('.helix/porting-dashboard.json', { format: 'helix-porting-dashboard', version: 1, project: 'synthetic', reportedUtc: '2026-11-11T12:00:00.000Z', items: [other] });
  const result = await publishAcceptance(f.root, 'synthetic');
  assert.equal(result.acceptance.required, 2); assert.equal(result.acceptance.accepted, 0);
  assert.deepEqual(result.report!.items.find(item => item.id === other.id), other);
  assert.match(result.report!.items.find(item => item.id === 'screen.result')!.summary, /0\/2/);
  assert.equal(JSON.parse(readFileSync(join(f.root, '.helix/acceptance-status.json'), 'utf8')).items[0].required, 2);
});
test('lock contention does not overwrite records and an older decision cannot approve a new run', async t => {
  const f = fixture(t);
  f.put('Tools/Helix/acceptance/.write.lock', 'synthetic-owner');
  await assert.rejects(saveRun(f.root, 'synthetic', f.run), /locked/);
  rmSync(join(f.root, 'Tools/Helix/acceptance/.write.lock'));
  await saveRun(f.root, 'synthetic', f.run); await saveDecision(f.root, 'synthetic', f.decision, f.reference);
  await saveRun(f.root, 'synthetic', { ...f.run, id: 'capture-2', capturedUtc: '2026-11-11T13:00:00.000Z' });
  const row = (await acceptanceStatus(f.root, 'synthetic', f.reference)).items[0].cases[0];
  assert.equal(row.review, 'pending'); assert.equal(row.accepted, false); assert.equal(row.lastAccepted!.id, 'review-1');
});

test('Workbench saves exact reviews durably, rejects stale writes, and verifies media bytes', async t => {
  const f = fixture(t);
  f.put('Tools/Helix/acceptance/reference-inputs.json', { version: 1, paths: ['source.txt'] });
  const reference = referenceObservation(f.root, f.root, 'synthetic');
  f.run.reference.identity = reference.identity;
  await saveRun(f.root, 'synthetic', f.run);
  const request = { item: 'screen.result', caseId: 'settled', viewport: 'phone', runId: f.run.id, expectedRunSha256: recordHash(f.run), supersedes: null, reviewer: 'Synthetic UI reviewer', notes: 'Test only', status: 'accepted' };
  const call = (route: string, input: any) => acceptanceBackend(f.root, f.root, 'synthetic', '/acceptance/' + route, input);
  assert.equal((await (await call('status', {})).json()).items[0].cases[0].canAccept, true);
  assert.equal(await (await call('media', { ...request, artifact: 0 })).text(), 'reference');
  const saved = await (await call('review', request)).json();
  assert.equal(saved.status, 'saved'); assert.equal(saved.report.items[0].accepted, 1);
  assert.equal(JSON.parse(readFileSync(join(f.root, 'Tools/Helix/acceptance/decisions/' + saved.decisionId + '.json'), 'utf8')).reviewer.name, request.reviewer);
  await assert.rejects(call('review', request), /changed since/);
  await assert.rejects(call('review', { ...request, expectedRunSha256: digest('changed') }), /Run evidence changed/);
  f.put('media/reference.png', 'changed');
  await assert.rejects(call('media', { ...request, artifact: 0 }), /bytes changed/);
  await assert.rejects(call('review', { ...request, supersedes: saved.decisionId }), /eligible/);
});


test('publication holds ownership while deriving the snapshot and releases it after failure', async t => {
  const f = fixture(t);
  const pending = publishAcceptance(f.root, 'synthetic');
  await assert.rejects(publishAcceptance(f.root, 'synthetic'), /already running/);
  await pending;
  f.put('Tools/Helix/acceptance/scope.json', { ...f.scope, project: 'wrong' });
  await assert.rejects(publishAcceptance(f.root, 'synthetic'), /project differs/);
  f.put('Tools/Helix/acceptance/scope.json', f.scope);
  assert.equal((await publishAcceptance(f.root, 'synthetic')).acceptance.required, 2);
});


test('historical evidence and resolved findings remain visible without granting acceptance', async t => {
  const f = fixture(t);
  f.screen.cases[0].discrepancies.push('prior-finding');
  f.put('Tools/Helix/acceptance/screens/result.json', f.screen);
  f.put('Tools/Helix/discrepancies/prior-finding/1.json', { id: 'prior-finding', status: 'resolved' });
  f.put('Tools/Helix/acceptance/evidence-links.json', { version: 1, project: 'synthetic', links: [{ item: 'screen.result', caseId: 'settled', note: 'Historical only', sources: ['media/reference.png'] }] });
  const report = await acceptanceStatus(f.root, 'synthetic');
  assert.equal(report.items[0].accepted, 0);
  assert.equal(report.items[0].cases[0].priorEvidence!.sources[0].available, true);
  assert.equal(report.items[0].cases[0].linkedDiscrepancies[0].status, 'resolved');
  assert.equal(report.items[0].cases[0].verification, 'not-tested');
});

test('historical evidence links validate targets, duplicates and checkout containment without requiring recovered files', async t => {
  const f = fixture(t);
  const link = { item: 'screen.result', caseId: 'settled', note: 'Recover original evidence', sources: ['missing/receipt.json'] };
  const put = (links: unknown[]) => f.put('Tools/Helix/acceptance/evidence-links.json', { version: 1, project: 'synthetic', links });
  put([link]);
  assert.equal((await acceptanceStatus(f.root, 'synthetic')).items[0].cases[0].priorEvidence!.sources[0].available, false);
  put([{ ...link, caseId: 'unknown' }]); assert.throws(() => loadAcceptance(f.root, 'synthetic'), /unknown case/);
  put([link, link]); assert.throws(() => loadAcceptance(f.root, 'synthetic'), /Duplicate/);
  put([{ ...link, sources: ['../outside.json'] }]); assert.throws(() => loadAcceptance(f.root, 'synthetic'), /relative path/);
  put([{ ...link, accepted: true }]); assert.throws(() => loadAcceptance(f.root, 'synthetic'), /Invalid/);
});

test('agent assessment is pinned, immutable, and never grants human acceptance', async t => {
  const f = fixture(t); f.run.outcome = 'unmeasured'; f.run.observations[0].result = 'unmeasured'; await saveRun(f.root, 'synthetic', f.run);
  const assessment = { version: 1, id: 'assessment-1', project: f.run.project, variant: f.run.variant, item: f.run.item, caseId: f.run.caseId, viewport: f.run.viewport, runId: f.run.id, runSha256: recordHash(f.run), assessor: { name: 'Test agent', kind: 'agent' }, assessedUtc: '2026-11-11T12:00:00.000Z', outcome: 'matched', observations: [{ criterion: 'layout', result: 'match', note: 'Scoped measurement' }], evidence: [{ path: 'media/candidate.png', sha256: digest('candidate') }], discrepancies: [], notes: 'Not human approval' };
  await assert.rejects(saveAssessment(f.root, 'synthetic', { ...assessment, runSha256: digest('wrong') }), /exact capture/);
  await assert.rejects(saveAssessment(f.root, 'synthetic', { ...assessment, observations: [{ criterion: 'other', result: 'match', note: 'wrong' }] }), /criteria/);
  await saveAssessment(f.root, 'synthetic', assessment);
  await assert.rejects(saveAssessment(f.root, 'synthetic', { ...assessment, notes: 'mutated' }), /Immutable/);
  let entry = (await acceptanceStatus(f.root, 'synthetic', f.reference)).items[0].cases[0];
  assert.equal(entry.latestAssessment?.outcome, 'matched'); assert.equal(entry.assessmentAvailable, true); assert.equal(entry.canAccept, false); assert.equal(entry.accepted, false); assert.equal(entry.review, 'pending');
  f.put('media/candidate.png', 'changed');
  entry = (await acceptanceStatus(f.root, 'synthetic', f.reference)).items[0].cases[0]; assert.equal(entry.assessmentAvailable, false);
});

test('a mismatching assessment blocks accepting a previously matched run', async t => {
  const f = fixture(t); await saveRun(f.root, 'synthetic', f.run);
  await saveAssessment(f.root, 'synthetic', { version: 1, id: 'assessment-mismatch', project: f.run.project, variant: f.run.variant, item: f.run.item, caseId: f.run.caseId, viewport: f.run.viewport, runId: f.run.id, runSha256: recordHash(f.run), assessor: { name: 'Test agent', kind: 'agent' }, assessedUtc: '2026-11-11T12:00:00.000Z', outcome: 'mismatch', observations: [{ criterion: 'layout', result: 'mismatch', note: 'Visible difference' }], evidence: [{ path: 'media/candidate.png', sha256: digest('candidate') }], discrepancies: [], notes: 'Needs correction' });
  await assert.rejects(saveDecision(f.root, 'synthetic', f.decision, f.reference), /eligible/);
});

test('review gates explain every structural refusal without promoting a scoped assessment', async t => {
  const f = fixture(t); f.scope.status = 'draft'; f.screen.implementation = 'in-progress';
  f.put('Tools/Helix/acceptance/scope.json', f.scope); f.put('Tools/Helix/acceptance/screens/result.json', f.screen);
  f.run.outcome = 'unmeasured'; f.run.candidate.inputs = []; f.run.capture.anchors = []; f.run.observations = []; f.run.artifacts = [];
  await saveRun(f.root, 'synthetic', f.run);
  const row = (await acceptanceStatus(f.root, 'synthetic', f.reference)).items[0].cases[0];
  for (const message of ['scope is not approved', 'Implementation is not declared complete', 'Capture verdict is unmeasured', 'Missing declared input pins', 'Missing event anchor', 'Missing required observation', 'Missing required paired evidence type', 'Evidence unverified']) assert.ok(row.reasons.some(reason => reason.includes(message)), message);
  assert.equal(row.canAccept, false); assert.equal(row.freshness, 'needs-recheck');
  assert.equal((await acceptanceStatus(f.root, 'synthetic', f.reference)).items[0].cases[1].reasons.some(reason => reason.includes('No capture run')), true);
});
test('approved deviations require explicit criterion reconciliation and do not silently pass', async t => {
  const f = fixture(t); f.screen.cases[0].discrepancies.push('deviation');
  f.put('Tools/Helix/acceptance/screens/result.json', f.screen); f.put('Tools/Helix/discrepancies/deviation/1.json', { id: 'deviation', status: 'accepted-deviation' });
  const { scope, screens } = loadAcceptance(f.root, 'synthetic'); f.run.criteriaSha256 = criteriaHash(scope, screens[0], screens[0].cases[0], 'phone'); await saveRun(f.root, 'synthetic', f.run);
  const row = (await acceptanceStatus(f.root, 'synthetic', f.reference)).items[0].cases[0];
  assert.equal(row.canAccept, false); assert.ok(row.reasons.some(reason => reason.includes('accepted-deviation')));
});

test('resolution workflow separates integrated fixes, retained evidence and review; stale writes fail and resolution uses immutable discrepancy revisions', async t => {
  const { execFileSync } = await import('node:child_process');
  const { resolutionStatus, reviewResolution } = await import('../src/resolution.ts');
  const f = fixture(t);
  const git = (...args: string[]) => execFileSync('git', ['-C', f.root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q'); git('add', 'source.txt'); git('-c', 'user.name=Synthetic', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Synthetic fix');
  const commit = git('rev-parse', 'HEAD');
  f.put('Tools/Helix/reference.json', {});
  f.put('Tools/Helix/catalog/catalog.json', { version: 1, project: 'synthetic', title: 'Synthetic', sources: [], exclusions: [], legacyReport: 'legacy.json', entries: [{ id: 'screen.result', title: 'Result', kind: 'screen', group: 'Screens', scope: 'game', summary: 'Synthetic', sources: [], implementationReferences: [], discrepancies: ['result-layout'], evidence: [], acceptanceItem: 'screen.result' }] });
  f.put('Tools/Helix/resolutions/pilots.json', { version: 1, project: 'synthetic', findings: [{ id: 'result-layout', item: 'screen.result', title: 'Result layout', caseId: 'settled', viewports: ['phone'] }] });
  f.put('Tools/Helix/discrepancies/result-layout/1.json', { schemaVersion: 1, id: 'result-layout', feature: 'result', caseId: 'settled', status: 'open', expected: 'Match', observed: 'Fixed', reference: 'Synthetic', unityRevision: commit, nextAction: 'Review', integration: { commits: [commit], afterIntegration: 'Inspect evidence' }, evidence: [{ path: 'media/candidate.png', sha256: digest('candidate'), claim: 'Synthetic match', inputs: [{ path: 'source.txt', sha256: digest('source') }] }] });
  const status = resolutionStatus(f.root, 'synthetic', 'result-layout');
  const media = await acceptanceBackend(f.root, f.root, 'synthetic', '/acceptance/resolution-media', { id: 'result-layout', expectedToken: status.token, artifact: 0 }); assert.equal(await media.text(), 'candidate');
  await assert.rejects(acceptanceBackend(f.root, f.root, 'synthetic', '/acceptance/resolution-media', { id: 'result-layout', expectedToken: status.token, artifact: 1 }), /registered/);
  const list = await (await acceptanceBackend(f.root, f.root, 'synthetic', '/acceptance/resolutions', { item: 'screen.result' })).json(); assert.equal(list.findings.length, 1);
  assert.equal(status.implementation, 'integrated'); assert.equal(status.evidence, 'ready-for-review'); assert.equal(status.review, 'pending');
  const review = { id: 'result-layout', expectedToken: status.token, reviewer: 'Synthetic reviewer', notes: 'Scoped synthetic verification', action: 'resolve', evidenceReviewed: true };
  f.put('source.txt', 'changed');
  const changed = resolutionStatus(f.root, 'synthetic', 'result-layout'); assert.equal(changed.implementation, 'integrated'); assert.equal(changed.evidence, 'stale-inputs'); assert.equal(changed.canResolve, false);
  assert.throws(() => reviewResolution(f.root, 'synthetic', review), /changed/);
  assert.throws(() => reviewResolution(f.root, 'synthetic', { ...review, expectedToken: changed.token }), /Resolution requires/);
  f.put('source.txt', 'source');
  assert.throws(() => reviewResolution(f.root, 'synthetic', { ...review, evidenceReviewed: false }), /explicit scoped review/);
  const saved = reviewResolution(f.root, 'synthetic', review); assert.equal(saved.receipt.revision, 2);
  assert.equal(JSON.parse(readFileSync(join(f.root, 'Tools/Helix/discrepancies/result-layout/1.json'), 'utf8')).status, 'open');
  const resolved = resolutionStatus(f.root, 'synthetic', 'result-layout'); assert.equal(resolved.review, 'resolved-recorded');
  assert.equal((await acceptanceStatus(f.root, 'synthetic')).items[0].accepted, 0);
  assert.throws(() => reviewResolution(f.root, 'synthetic', review), /changed/);
  reviewResolution(f.root, 'synthetic', { ...review, expectedToken: resolved.token, action: 'reopen', notes: 'New regression' });
  assert.equal(resolutionStatus(f.root, 'synthetic', 'result-layout').review, 'pending');
  const reopened = resolutionStatus(f.root, 'synthetic', 'result-layout');
  reviewResolution(f.root, 'synthetic', { ...review, expectedToken: reopened.token, action: 'block', notes: 'Waiting on test fixture' });
  assert.equal(resolutionStatus(f.root, 'synthetic', 'result-layout').review, 'blocked');
  f.put('media/candidate.png', 'tampered'); assert.equal(resolutionStatus(f.root, 'synthetic', 'result-layout').evidence, 'recovery-needed');
});

test('authored automation removes manual approval only for current measured checks, without manufacturing human acceptance', async t => {
  const f = fixture(t);
  f.put('Tools/Helix/catalog/catalog.json', { version: 1, project: 'synthetic', title: 'Synthetic', sources: [], exclusions: [], legacyReport: 'legacy.json', entries: [{ id: 'screen.result', title: 'Result', kind: 'screen', group: 'Screens', scope: 'game', summary: 'Synthetic', sources: [], implementationReferences: [], discrepancies: ['result-layout'], evidence: [], acceptanceItem: 'screen.result' }] });
  f.put('Tools/Helix/resolutions/pilots.json', { version: 1, project: 'synthetic', findings: [{ id: 'result-layout', item: 'screen.result', title: 'Result', caseId: 'settled', viewports: ['phone', 'tablet'] }] });
  const workflow = { id: 'result-layout', review: 'automated', unity: { scene: 'scene.unity', preflightScripts: ['audit.cs'] } };
  f.put('Tools/Helix/resolutions/automation.json', { version: 1, project: 'synthetic', workflows: [workflow] });
  await saveRun(f.root, 'synthetic', f.run);
  const { caseStatus, nextCaseAction } = await import('../workbench/workbench-presentation.ts');
  const { verificationStatus, startVerification, automationDefinitions } = await import('../src/verification-jobs.ts');
  const row = (await acceptanceStatus(f.root, 'synthetic', f.reference)).items[0].cases[0];
  assert.equal(row.reviewRequirement, 'automated'); assert.equal(caseStatus(row), 'verified'); assert.equal(nextCaseAction(row), 'verified');
  assert.equal(row.review, 'pending'); assert.equal(row.accepted, false);
  assert.notEqual(caseStatus({ ...row, freshness: 'needs-recheck' }), 'verified');
  assert.notEqual(caseStatus({ ...row, availability: 'missing' }), 'verified');
  assert.notEqual(caseStatus({ ...row, verification: 'mismatch' }), 'verified');
  assert.notEqual(caseStatus({ ...row, reviewRequirement: 'human' }), 'verified');
  assert.notEqual(caseStatus({ ...row, review: 'changes-requested' }), 'verified');
  assert.notEqual(caseStatus({ ...row, recipe: { ...row.recipe, blockers: ['Unmeasured gate'] } }), 'verified');
  const setup = verificationStatus(f.root, 'synthetic', 'result-layout'); assert.match(setup.blocker!, /Configure an owned isolated checkout/);
  assert.throws(() => startVerification(f.root, f.root, 'synthetic', 'result-layout', setup.token!), /Configure/);
  assert.throws(() => startVerification(f.root, f.root, 'synthetic', 'result-layout', 'stale'), /setup changed/);
  const catalog = JSON.parse(readFileSync(join(f.root, 'Tools/Helix/catalog/catalog.json'), 'utf8')); catalog.entries[0].id = 'feature.result'; f.put('Tools/Helix/catalog/catalog.json', catalog);
  f.put('Tools/Helix/resolutions/pilots.json', { version: 1, project: 'synthetic', findings: [{ id: 'result-layout', item: 'feature.result', title: 'Result', caseId: 'settled', viewports: ['phone', 'tablet'] }] });
  assert.equal(automationDefinitions(f.root, 'synthetic')[0].acceptanceItem, 'screen.result');
  assert.equal((await acceptanceStatus(f.root, 'synthetic', f.reference)).items[0].cases[0].reviewRequirement, 'automated');
  f.put('Tools/Helix/resolutions/automation.json', { version: 1, project: 'synthetic', workflows: [workflow, workflow] });
  assert.throws(() => automationDefinitions(f.root, 'synthetic'), /Invalid verification workflow/);
});

test('interrupted background jobs remain visible and cannot discard ownership locks', async t => {
  const f = fixture(t);
  const { latestJob, jobDirectory } = await import('../src/verification-jobs.ts');
  const { spawnSync } = await import('node:child_process');
  const child = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  const id = '11111111-1111-4111-8111-111111111111';
  f.put('.helix/workbench-runs/' + id + '/job.json', { id, finding: 'result-layout', createdUtc: new Date().toISOString(), pid: child.pid, status: 'running' });
  f.put('.helix/workbench-runs/active.lock', { jobId: id });
  assert.equal(latestJob(f.root, 'result-layout').status, 'interrupted');
  assert.equal(JSON.parse(readFileSync(join(f.root, '.helix/workbench-runs/active.lock'), 'utf8')).jobId, id);
  assert.throws(() => jobDirectory(f.root, '../../elsewhere'), /Invalid verification job/);
  f.put('.helix/workbench-runs/22222222-2222-4222-8222-222222222222/job.json', { id: '22222222-2222-4222-8222-222222222222', finding: 'startup-failure', createdUtc: '2000-01-01T00:00:00.000Z', pid: null, status: 'queued' });
  assert.equal(latestJob(f.root, 'startup-failure').status, 'interrupted');
});
