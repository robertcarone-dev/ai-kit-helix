import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caseStatus, featureStatus } from '../workbench/workbench-presentation.ts';
import type { CaseRow } from '../workbench/acceptance-view.ts';
import type { CatalogItem } from '../workbench/catalog-view.ts';
test('historical matches and pending review never create review eligibility', () => {
  const row = { accepted: false, canAccept: false, review: 'pending', latestRun: { id: 'capture' }, freshness: 'needs-recheck', verification: 'unmeasured', latestAssessment: { outcome: 'matched' }, assessmentAvailable: true } as CaseRow;
  assert.equal(caseStatus(row), 'recheck');
  assert.equal(caseStatus({ ...row, freshness: 'current' }), 'evidence');
  assert.equal(caseStatus({ ...row, canAccept: true, freshness: 'current' }), 'ready');
  assert.equal(caseStatus({ ...row, canAccept: true, review: 'changes-requested' }), 'fix');
});
test('feature summary distinguishes unresolved work, ready cases and accepted scope', () => {
  const item = { issues: [], acceptance: { status: 'incomplete', ready: 0, mismatches: 0, pendingReview: 4, verified: 2 } } as unknown as CatalogItem;
  assert.equal(featureStatus(item), 'evidence');
  assert.equal(featureStatus({ ...item, acceptance: { ...item.acceptance!, ready: 1 } }), 'ready');
  assert.equal(featureStatus({ ...item, issues: [{ status: 'open' }] as CatalogItem['issues'] }), 'fix');
  assert.equal(featureStatus({ ...item, acceptance: { ...item.acceptance!, status: 'accepted' } }), 'accepted');
  assert.equal(featureStatus({ ...item, acceptance: null }), 'define');
});
