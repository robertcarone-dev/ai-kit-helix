import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featureWork } from '../workbench/feature-work.ts';
import type { CatalogItem } from '../workbench/catalog-view.ts';
const item = (values = {}) => ({ implementation: 'implemented', issues: [], acceptance: { status: 'incomplete', required: 8, accepted: 2, ready: 0, missingAdapters: 6, unmeasured: 0, nextSteps: { setup: 6 } }, ...values }) as CatalogItem;
test('missing adapters are tooling, not implementation defects or approval-ready reviews', () => {
  const work = featureWork(item());
  assert.equal(work.primary, 'tooling'); assert.equal(work.flags.implementation, false); assert.equal(work.flags.review, false); assert.match(work.descriptions.complete, /2 \/ 8/);
});
test('implementation, tooling and review may coexist without hiding one another', () => {
  const work = featureWork(item({ implementation: 'in-progress', issues: [{ kind: 'defect' }, { kind: 'untriaged' }] }));
  assert.deepEqual(work.flags, { implementation: true, tooling: true, review: true, complete: false });
  assert.match(work.descriptions.review, /0 checks ready for approval/);
});
test('completed scope is distinct from completed individual checks and historical findings', () => {
  const base = item();
  assert.equal(featureWork({ ...base, acceptance: { ...base.acceptance!, accepted: 8 } }).flags.complete, false);
  assert.deepEqual(featureWork({ ...base, acceptance: { ...base.acceptance!, status: 'accepted', accepted: 8 } }).flags, { implementation: false, tooling: false, review: false, complete: true });
});
test('unmeasured evidence and unknown implementation need evaluation, never invented approval eligibility', () => {
  const base = item();
  const work = featureWork({ ...base, implementation: 'not-assessed', acceptance: { ...base.acceptance!, missingAdapters: 0, unmeasured: 2, nextSteps: { measure: 2 } } });
  assert.equal(work.primary, 'review'); assert.equal(work.flags.implementation, false); assert.match(work.descriptions.review, /2 captured checks need measurements/);
});
