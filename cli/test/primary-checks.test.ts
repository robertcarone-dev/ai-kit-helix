import { test } from 'node:test';
import assert from 'node:assert/strict';
import { primaryCases } from '../workbench/primary-checks-view.ts';
test('primary panel excludes supplemental cases and requires workflow coverage for every viewport', () => {
  const report: any = { items: [{ id: 'feature', cases: [
    { id: 'primary', required: true, viewport: 'phone', accepted: true, workflowId: 'run', recipe: { blockers: [] }, supportingCases: [] },
    { id: 'primary', required: true, viewport: 'tablet', accepted: false, workflowId: null, recipe: { blockers: [] }, supportingCases: [] },
    { id: 'supplemental', required: false, viewport: 'phone', accepted: false, workflowId: 'other' }
  ] }] };
  const cases = primaryCases(report, 'feature'); assert.equal(cases.length, 1); assert.equal(cases[0].workflowId, null); assert.deepEqual(cases[0].workflows[0].viewports, ['phone']); assert.equal(cases[0].complete, 1);
  report.items[0].cases[1].workflowId = 'run';
  assert.equal(primaryCases(report, 'feature')[0].workflowId, 'run');
});

test('primary scenarios expose supporting adapters without promoting their completion', () => {
 const report: any = { items: [{ id: 'gameplay', cases: [{ id: 'layout', required: true, accepted: false, viewport: 'phone', workflowId: null, recipe: { blockers: ['Needs full layout review'] }, supportingCases: [{ item: 'gameplay', caseId: 'hud', viewport: 'phone', workflowId: 'hud-check' }] }] }] };
 const entry = primaryCases(report, 'gameplay')[0]; assert.equal(entry.complete, 0); assert.equal(entry.workflowId, null); assert.equal(entry.workflows[0].supporting, true); assert.equal(entry.workflows[0].id, 'hud-check');
});

test('supporting captures on both viewports never become a direct scenario adapter', () => {
 const report: any = { items: [{ id: 'feature', cases: ['phone', 'tablet'].map(viewport => ({ id: 'scenario', required: true, accepted: false, viewport, workflowId: null, recipe: { blockers: [] }, supportingCases: [{ item: 'feature', caseId: 'still', viewport, workflowId: 'capture' }] })) }] };
 const entry = primaryCases(report, 'feature')[0]; assert.equal(entry.workflowId, null); assert.equal(entry.complete, 0); assert.equal(entry.workflows.length, 1); assert.equal(entry.workflows[0].supporting, true); assert.deepEqual(entry.workflows[0].viewports, ['phone', 'tablet']);
});
