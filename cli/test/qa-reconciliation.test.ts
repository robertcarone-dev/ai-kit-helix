import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from '../src/acceptance-format.ts';
import { evaluateQa, qaDefinition, readQaDocument } from '../src/qa-reconciliation.ts';
function fixture(t: any, status = 'passed') {
  const root = mkdtempSync(join(tmpdir(), 'qa-reconciliation-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'Assets')); writeFileSync(join(root, 'Assets/game.cs'), 'product');
  const source = JSON.stringify({ key: 'AK-1', kind: 'task', state: 'Done', test: { result: status === 'passed' ? 'pass' : 'fail', at: '2026-01-01T00:01:00.000Z' }, cases: [{ id: 1, name: 'Exact behavior', results: [{ status, note: 'Scoped phone observation', at: '2026-01-01T00:00:00.000Z' }] }] });
  writeFileSync(join(root, 'qa.json'), source);
  const scope: any = { project: 'synthetic', variant: 'Default', viewports: [{ id: 'phone', width: 100, height: 200 }] };
  const screen: any = { id: 'screen.example', implementationReferences: ['Assets/game.cs'] };
  const entry: any = { id: 'behavior', criteria: [{ id: 'once', expected: 'Exactly once' }], basis: { kind: 'product', source: 'approved design' }, dependencies: ['Assets/game.cs'], discrepancies: [] };
  const binding: any = { item: screen.id, caseId: entry.id, viewport: 'phone', definitionSha256: qaDefinition(scope, screen, entry, 'phone'), coverage: 'full', note: 'Mapped exact scope', gaps: [], sources: [{ path: 'qa.json', sha256: digest(source), cases: [1] }], testedRevision: 'a'.repeat(40), inputs: [{ path: 'Assets/game.cs', sha256: digest('product') }], findings: [] };
  const document: any = { version: 1, id: 'reconciled', project: 'synthetic', reconciledUtc: '2026-01-02T00:00:00.000Z', reviewer: 'reviewer', bindings: [binding] };
  return { root, scope, screen, entry, binding, document, evaluate: () => evaluateQa(root, document, scope, screen, entry, 'phone')! };
}
test('existing scoped QA completes acceptance without manufacturing a capture; recipe changes do not invalidate product QA', t => {
  const f = fixture(t); readQaDocument(f.root, 'synthetic', f.document); assert.equal(f.evaluate().accepted, true);
  f.entry.recipe = { blockers: ['new capture tooling'] }; assert.equal(f.evaluate().accepted, true);
  assert.equal(evaluateQa(f.root, f.document, f.scope, f.screen, f.entry, 'tablet'), null);
});
test('Done QA tasks with failed or unmeasured cases never grant acceptance', t => {
  const failed = fixture(t, 'failed'); assert.equal(failed.evaluate().status, 'failed'); assert.equal(failed.evaluate().accepted, false);
  const unmeasured = fixture(t, 'unmeasured'); assert.equal(unmeasured.evaluate().accepted, false);
});
test('partial scope, changed criteria and later product changes cannot become accepted', t => {
  const f = fixture(t); f.binding.coverage = 'partial'; f.binding.gaps = ['Repeated input not covered']; assert.equal(f.evaluate().accepted, false);
  f.binding.coverage = 'full'; f.binding.gaps = []; f.entry.criteria[0].expected = 'New requirement'; assert.equal(f.evaluate().status, 'changed');
  f.binding.definitionSha256 = qaDefinition(f.scope, f.screen, f.entry, 'phone'); writeFileSync(join(f.root, 'Assets/game.cs'), 'changed'); assert.equal(f.evaluate().status, 'changed');
});
test('missing or tampered QA sources fail closed; empty full scope and duplicate bindings are rejected', t => {
  const f = fixture(t); writeFileSync(join(f.root, 'qa.json'), '{}'); assert.equal(f.evaluate().status, 'unavailable'); assert.equal(f.evaluate().accepted, false);
  f.binding.sources = []; assert.throws(() => readQaDocument(f.root, 'synthetic', f.document), /Full QA coverage/);
  const g = fixture(t); g.document.bindings.push(g.binding); assert.throws(() => readQaDocument(g.root, 'synthetic', g.document), /duplicate QA binding/);
});

test('reviewed nonbehavioral changes are scoped to exact before/after bytes, never future edits', t => {
  const f = fixture(t); writeFileSync(join(f.root, 'Assets/game.cs'), 'reviewed refactor');
  f.binding.inputReviews = [{ path: 'Assets/game.cs', before: digest('product'), after: digest('reviewed refactor'), reason: 'Reviewed equivalent wiring for this case' }];
  readQaDocument(f.root, 'synthetic', f.document); assert.equal(f.evaluate().accepted, true);
  writeFileSync(join(f.root, 'Assets/game.cs'), 'later edit'); assert.equal(f.evaluate().accepted, false);
});
test('an unrelated failure remains context without becoming a target failure or granting acceptance', t => {
  const f = fixture(t, 'failed'); f.binding.sources[0].context = true; f.binding.coverage = 'partial'; f.binding.gaps = ['Other criterion needs a scoped verdict'];
  assert.equal(f.evaluate().status, 'gap'); assert.equal(f.evaluate().accepted, false); assert.equal(f.evaluate().reports[0].status, 'failed');
});

test('a passing phase remains accepted with a contextual failure in a different phase', t => {
  const f = fixture(t);
  const source = JSON.stringify({ key: 'AK-2', kind: 'task', test: { result: 'fail', at: '2026-01-01T00:02:00.000Z' }, cases: [{ id: 2, name: 'Claim color', results: [{ status: 'failed', note: 'Claim color failed; idle remains accepted', at: '2026-01-01T00:01:00.000Z' }] }] });
  writeFileSync(join(f.root, 'claim.json'), source);
  f.binding.sources.push({ path: 'claim.json', sha256: digest(source), cases: [2], context: true });
  assert.equal(f.evaluate().accepted, true);
  f.binding.sources[1].context = false;
  assert.equal(f.evaluate().accepted, false);
});

test('QA counts deduplicate shared cases across viewports and requirements without counting contextual failures', async t => {
  const { summarizeQa } = await import('../src/qa-reconciliation.ts');
  const f = fixture(t), qa = f.evaluate();
  const rows = [{ required: true, accepted: true, qa }, { required: true, accepted: false, qa: { ...qa, coverage: 'partial', accepted: false, status: 'gap' } }, { required: false, accepted: false, qa }];
  assert.deepEqual(summarizeQa(rows), { requirements: 2, accepted: 1, partiallySupported: 1, sourceCases: 1, passed: 1, failed: 0, blocked: 0, unmeasured: 0 });
});

test('same AK number from different local archives remains distinct and portable without AI Kit', async t => {
  const { exportQaSource } = await import('../src/qa-source.ts');
  const { summarizeQa } = await import('../src/qa-reconciliation.ts');
  const a = fixture(t), b = fixture(t, 'failed');
  for (const [index, f] of [a, b].entries()) {
    const record = { key: 'AK-1', kind: 'task', test: { result: index ? 'fail' : 'pass', at: '2026-01-01T00:01:00.000Z' }, cases: [{ id: 1, name: 'Same local number', results: [{ status: index ? 'failed' : 'passed', note: 'Original verdict', at: '2026-01-01T00:00:00.000Z' }] }] };
    const origin = { kind: 'aikit-local-export' as const, archiveId: index ? '22222222-2222-2222-2222-222222222222' : '11111111-1111-1111-1111-111111111111', label: 'Original local export' };
    const bytes = JSON.stringify(exportQaSource(record, origin));
    writeFileSync(join(f.root, 'qa.json'), bytes); f.binding.sources[0].sha256 = digest(bytes);
  }
  const qaA = a.evaluate(), qaB = b.evaluate();
  assert.equal(qaA.accepted, true); assert.equal(qaB.accepted, false);
  assert.notEqual(qaA.reports[0].sourceId, qaB.reports[0].sourceId);
  assert.equal(qaA.reports[0].key, qaB.reports[0].key);
  const counts = summarizeQa([{ required: true, accepted: true, qa: qaA }, { required: true, accepted: false, qa: qaB }]);
  assert.equal(counts.sourceCases, 2); assert.equal(counts.passed, 1); assert.equal(counts.failed, 1);
  // A copied checkout needs only the snapshot and its pin, not the original board or path.
  writeFileSync(join(b.root, 'qa.json'), readFileSync(join(a.root, 'qa.json')));
  b.document.bindings[0] = structuredClone(a.binding);
  assert.equal(b.evaluate().accepted, true);
  assert.equal(b.evaluate().reports[0].sourceId, qaA.reports[0].sourceId);
  writeFileSync(join(b.root, 'qa.json'), JSON.stringify(exportQaSource({ key: 'AK-1' }, { kind: 'aikit-local-export', archiveId: '22222222-2222-2222-2222-222222222222', label: 'Changed export' })));
  assert.equal(b.evaluate().status, 'unavailable');
});
test('legacy source identity uses the pinned content, never its AK label or local pathname', async t => {
  const { readQaSource } = await import('../src/qa-source.ts');
  const record = { key: 'AK-1' };
  assert.equal(readQaSource(record, 'a'.repeat(64)).sourceId, 'sha256:' + 'a'.repeat(64));
  assert.notEqual(readQaSource(record, 'a'.repeat(64)).sourceId, readQaSource(record, 'b'.repeat(64)).sourceId);
  assert.throws(() => readQaSource({ format: 'helix-qa-source', version: 1, origin: { kind: 'aikit-local-export', archiveId: 'AK-1', label: 'Local' }, record }, 'a'.repeat(64)), /Invalid portable QA source/);
});
