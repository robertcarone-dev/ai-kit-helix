import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caseStatus, featureStatus, nextCaseAction, featureSummary, featureNextStep } from '../workbench/workbench-presentation.ts';
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
  assert.equal(featureStatus({ ...item, issues: [{ status: 'open', kind: 'defect' }] as CatalogItem['issues'] }), 'fix');
  assert.equal(featureStatus({ ...item, acceptance: { ...item.acceptance!, status: 'accepted' } }), 'accepted');
  assert.equal(featureStatus({ ...item, acceptance: null }), 'define');
});

test('next steps distinguish missing captures, setup blockers, historical matches and remaining gates', () => {
  const row = { accepted: false, canAccept: false, required: true, review: 'pending', latestRun: null, recipe: { blockers: [] }, availability: 'available', freshness: 'current', verification: 'unmeasured', latestAssessment: null, assessmentAvailable: false } as unknown as CaseRow;
  assert.equal(nextCaseAction(row), 'capture');
  assert.equal(nextCaseAction({ ...row, recipe: { ...row.recipe, blockers: ['Setup unavailable'] } }), 'setup');
  const captured = { ...row, latestRun: { id: 'run' } as CaseRow['latestRun'] };
  assert.equal(nextCaseAction(captured), 'measure');
  assert.equal(nextCaseAction({ ...captured, freshness: 'unknown' }), 'recheck');
  assert.equal(nextCaseAction({ ...captured, availability: 'missing' }), 'recover');
  assert.equal(nextCaseAction({ ...captured, verification: 'mismatch' }), 'fix');
  assert.equal(nextCaseAction({ ...captured, verification: 'matched' }), 'gates');
  assert.equal(nextCaseAction({ ...captured, verification: 'matched', canAccept: true }), 'review');
  assert.equal(nextCaseAction({ ...captured, accepted: true }), 'accepted');
});

test('an agent assessment cannot promote an unmeasured or failed automated capture', () => {
  const row = { accepted: false, canAccept: false, review: 'pending', reviewRequirement: 'automated', latestRun: { id: 'capture' }, recipe: { blockers: [] }, availability: 'available', freshness: 'current', verification: 'unmeasured', latestAssessment: { outcome: 'matched' }, assessmentAvailable: true } as unknown as CaseRow;
  assert.notEqual(caseStatus(row), 'verified'); assert.equal(nextCaseAction(row), 'measure');
  assert.equal(caseStatus({ ...row, verification: 'mismatch' }), 'fix'); assert.equal(nextCaseAction({ ...row, verification: 'mismatch' }), 'fix');
  assert.equal(caseStatus({ ...row, verification: 'matched' }), 'evidence');
  assert.equal(caseStatus({ ...row, accepted: true, verification: 'matched' }), 'verified');
  assert.equal(caseStatus({ ...row, verification: 'matched', latestAssessment: { ...row.latestAssessment!, outcome: 'mismatch' } }), 'fix');
});

test('feature progress counts automatic completion without listing it as remaining work', () => {
  const item = { implementation: 'in-progress', issues: [], acceptance: { status: 'incomplete', required: 2, accepted: 2, nextSteps: { verified: 2 } } } as unknown as CatalogItem;
  assert.equal(featureSummary(item), 'Implementation in progress · 2/2 checks complete');
  assert.equal(featureSummary({ ...item, implementation: 'implemented', acceptance: { ...item.acceptance!, status: 'accepted' } }), 'Implemented · 2/2 checks complete');
});

test('verification gaps and review/tooling findings do not become product defects', () => {
  const item = { implementation: 'implemented', issues: [{ status: 'open', kind: 'tooling' }, { status: 'open', kind: 'review' }], acceptance: { status: 'incomplete', accepted: 0, required: 12, ready: 0, mismatches: 2 } } as unknown as CatalogItem;
  assert.equal(featureStatus(item), 'evidence');
  assert.equal(featureSummary(item), 'Implemented · 0/12 checks complete · 1 finding to review');
});

test('one next action routes to the exact finding or eligible primary checks, not historical noise', () => {
  const issue = { id: 'specific-difference', kind: 'review', triageReason: 'Confirm retained results', status: 'open' } as CatalogItem['issues'][number];
  const item = { implementation: 'implemented', issues: [issue], acceptance: { status: 'incomplete', required: 3, nextSteps: { setup: 2, review: 1 } } } as unknown as CatalogItem;
  assert.equal(featureNextStep(item).filter, 'review');
  const defect = { ...item, issues: [{ ...issue, kind: 'defect' }] } as CatalogItem;
  assert.equal(featureNextStep(defect).finding, issue.id); assert.equal(featureNextStep(defect).target, 'work');
  const review = { ...item, acceptance: { ...item.acceptance!, nextSteps: { setup: 2 } } };
  assert.equal(featureNextStep(review).finding, issue.id);
  const noIssues = { ...review, issues: [] };
  assert.equal(featureNextStep(noIssues).filter, 'setup');
  const done = { ...noIssues, acceptance: { ...noIssues.acceptance!, status: 'accepted', nextSteps: { verified: 2 } } };
  assert.equal(featureNextStep(done).title, 'Inspect completed checks');
  assert.equal(featureNextStep({ ...noIssues, acceptance: { ...noIssues.acceptance!, required: 0, nextSteps: {} } }).title, 'Define acceptance coverage');
});
