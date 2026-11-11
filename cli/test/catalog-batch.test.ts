import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBatchPlan, collectionKey } from '../src/catalog-batch.ts';
function fixture() {
  const source = (id: string, required = true, supportingCases: any[] = []) => ({ id, required, viewport: 'phone', supportingCases, dimension: 'appearance', accepted: false, latestRun: null, freshness: 'unknown', availability: 'unverified', reasons: [], criteriaSha256: id });
  const report = { items: [{ id: 'screen.a', cases: [source('primary', true, [{ item: 'screen.a', caseId: 'detail' }]), source('detail', false)] }, { id: 'screen.b', cases: [source('primary')] }] };
  const catalog = { folders: [{ id: 'game', title: 'Game', parent: null }, { id: 'ui', title: 'UI', parent: 'game' }], entries: [{ id: 'a', title: 'A', acceptanceItem: 'screen.a', folder: 'ui', scope: 'game', issues: [{ status: 'open', discipline: 'ta' }] }, { id: 'b', title: 'B', acceptanceItem: 'screen.b', folder: 'game', scope: 'game', issues: [{ status: 'open', discipline: 'dev' }] }] };
  const adapters = [{ item: 'screen.a', caseId: 'detail', viewport: 'phone', capture: { kind: 'ui-matrix', spec: 'matrix.json', caseId: 'settled', limitations: 'Still only' } }];
  const workflows = [{ id: 'w', acceptanceItem: 'screen.a', caseId: 'detail', viewports: ['phone'], unity: { scene: 'scene', preflightScripts: ['audit'] } }];
  return { report, catalog, adapters, workflows };
}
test('catalog planning connects supplemental capture without granting primary completion', () => {
  const f = fixture(), p = buildBatchPlan(f.report, f.catalog, f.adapters, f.workflows, { mode: 'ready' });
  assert.equal(p.rows.length, 2); assert.equal(p.summary.complete, 0); assert.equal(p.captures.length, 1);
  assert.deepEqual(p.captures[0].supports, [{ item: 'screen.a', caseId: 'primary', viewport: 'phone' }]);
  assert.equal(p.rows[1].state, 'adapter-missing'); assert.equal(p.rows[0].directAdapter, false);
});
test('folder and discipline selections apply before capture deduplication', () => {
  const f = fixture();
  assert.equal(buildBatchPlan(f.report, f.catalog, f.adapters, f.workflows, { mode: 'ready', folder: 'ui', discipline: 'ta' }).rows.length, 1);
  assert.equal(buildBatchPlan(f.report, f.catalog, f.adapters, f.workflows, { mode: 'ready', discipline: 'dev' }).captures.length, 0);
  assert.throws(() => buildBatchPlan(f.report, f.catalog, f.adapters, f.workflows, { mode: 'ready', folder: 'missing' }), /Unknown catalog folder/);
});
test('shared stills collect once across primary cases, without duplicate verdicts', () => {
  const f = fixture(); f.report.items[1].cases[0].supportingCases = [{ item: 'screen.a', caseId: 'detail' }];
  const p = buildBatchPlan(f.report, f.catalog, f.adapters, f.workflows, { mode: 'ready' });
  assert.equal(p.captures.length, 1); assert.equal(p.captures[0].supports.length, 2); assert.equal(p.summary.complete, 0);
});
test('current collection and completed cases are skipped; changed mode selects only changed captures', () => {
  const f = fixture(); const row: any = f.report.items[0].cases[1]; row.latestRun = { id: 'run' }; row.freshness = 'current'; row.availability = 'available';
  assert.equal(buildBatchPlan(f.report, f.catalog, f.adapters, f.workflows, { mode: 'ready' }).captures.length, 0);
  row.freshness = 'needs-recheck';
  assert.equal(buildBatchPlan(f.report, f.catalog, f.adapters, f.workflows, { mode: 'changed' }).captures.length, 1);
  row.latestRun = null;
  assert.equal(buildBatchPlan(f.report, f.catalog, f.adapters, f.workflows, { mode: 'changed' }).captures.length, 0);
  f.report.items[0].cases[0].accepted = true;
  assert.equal(buildBatchPlan(f.report, f.catalog, f.adapters, f.workflows, { mode: 'ready' }).captures.length, 0);
});
test('collection identity ignores prose, preserves viewport, fixture and node-case boundaries', () => {
  const f = fixture(), route = f.adapters[0];
  assert.equal(collectionKey(route), collectionKey({ ...route, capture: { ...route.capture, limitations: 'Different note' } }));
  assert.notEqual(collectionKey(route), collectionKey({ ...route, viewport: 'tablet' }));
  const node = { ...route, capture: { kind: 'node', script: 'run.ts', args: [] } };
  assert.notEqual(collectionKey(node), collectionKey({ ...node, caseId: 'other' }));
});
test('missing execution profile is a setup gap, not a product failure', () => {
  const f = fixture(), p = buildBatchPlan(f.report, f.catalog, f.adapters, [], { mode: 'ready' });
  assert.match(p.captures[0].blocker, /execution profile/); assert.equal(p.summary.failed, 0);
});

test('current shared fixture evidence prevents repeated collection through another case', () => {
  const f = fixture();
  const captured: any = f.report.items[0].cases[0]; captured.latestRun = { id: 'fresh' }; captured.freshness = 'current'; captured.availability = 'available'; captured.verification = 'unmeasured';
  f.adapters.push({ ...f.adapters[0], caseId: 'primary' });
  f.report.items[1].cases[0].supportingCases = [{ item: 'screen.a', caseId: 'detail' }];
  const plan = buildBatchPlan(f.report, f.catalog, f.adapters, f.workflows, { mode: 'ready' });
  assert.equal(plan.captures.length, 0); assert.equal(plan.summary.complete, 0); assert.equal(plan.rows[1].state, 'support-only');
});
