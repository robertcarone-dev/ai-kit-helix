import type { CatalogItem } from './catalog-view.ts';
import type { CaseRow } from './acceptance-view.ts';

export type WorkStatus = 'fix' | 'evidence' | 'ready' | 'accepted' | 'define' | 'recheck' | 'verified';
export function finding(entry: CaseRow) { return entry.latestAssessment && entry.assessmentAvailable ? entry.latestAssessment.outcome : entry.verification; }
export function caseStatus(entry: CaseRow): WorkStatus {
  if (entry.accepted) return entry.reviewRequirement === 'automated' && entry.review === 'pending' ? 'verified' : 'accepted';
  if (entry.reviewRequirement === 'automated' && entry.verification === 'mismatch') return 'fix';
  if (finding(entry) === 'mismatch' || entry.review === 'changes-requested') return 'fix';
  if (entry.canAccept) return 'ready';
  if (entry.latestRun && entry.freshness === 'needs-recheck') return 'recheck';
  return 'evidence';
}
export function featureStatus(item: CatalogItem): WorkStatus {
  if (item.acceptance?.status === 'accepted') return 'accepted';
  if (item.issues.some(issue => issue.status === 'open' || issue.status === 'blocked') || (item.acceptance && item.acceptance.mismatches > 0)) return 'fix';
  if (!item.acceptance) return 'define';
  if (item.acceptance.ready > 0) return 'ready';
  return 'evidence';
}
export function readableCase(id: string) { const label = id.replace(/^regression-/, '').replace(/[-_.]+/g, ' '); return label.charAt(0).toUpperCase() + label.slice(1); }
export const statusText: Record<WorkStatus, string> = { verified: 'Automatically verified', fix: 'Open findings', evidence: 'Verification incomplete', ready: 'Ready for review', accepted: 'Complete', define: 'Define coverage', recheck: 'Needs recheck' };
export const nextAction: Record<WorkStatus, string> = { verified: 'Inspect automated results', fix: 'Review open findings', evidence: 'Prepare missing evidence', ready: 'Review eligible cases', accepted: 'Inspect completed scope', define: 'Define acceptance cases', recheck: 'Recheck changed inputs' };

export type CaseAction = 'verified' | 'accepted' | 'setup' | 'capture' | 'recover' | 'fix' | 'recheck' | 'measure' | 'gates' | 'review';
export const caseActionText: Record<CaseAction, { title: string; detail: string }> = {
  verified: { title: 'Automatically verified', detail: 'Declared automated checks passed with current evidence. No human approval is required for these checks.' },
  accepted: { title: 'Accepted', detail: 'The declared checks have human approval.' },
  setup: { title: 'Unblock capture setup', detail: 'Resolve the setup blockers listed for these cases before capturing.' },
  capture: { title: 'Capture missing cases', detail: 'No run is registered for these case / viewport checks. This is missing verification, not proof of a broken feature.' },
  recover: { title: 'Recover capture files', detail: 'Registered evidence is missing or cannot be verified. Restore the original files or capture again.' },
  fix: { title: 'Review captured differences', detail: 'Captured findings report a mismatch or a reviewer requested changes. Inspect the linked finding before changing the game.' },
  recheck: { title: 'Check capture freshness', detail: 'A capture exists, but its inputs changed or current source identity is unknown. Check the case reasons before recapturing.' },
  measure: { title: 'Complete measurements', detail: 'A capture exists but does not have a matched capture verdict. Inspect the required criteria and observations.' },
  gates: { title: 'Complete acceptance prerequisites', detail: 'Review the remaining scope, implementation, dependency, or discrepancy requirements.' },
  review: { title: 'Record human review', detail: 'The prerequisite gates passed. Inspect the evidence and record a decision.' },
};
export function nextCaseAction(entry: CaseRow): CaseAction {
  if (entry.accepted) return entry.reviewRequirement === 'automated' && entry.review === 'pending' ? 'verified' : 'accepted';
  if (entry.reviewRequirement === 'automated' && entry.verification === 'mismatch') return 'fix';
  if (!entry.latestRun) return entry.recipe.blockers.length ? 'setup' : 'capture';
  if (entry.availability !== 'available') return 'recover';
  if (finding(entry) === 'mismatch' || entry.review === 'changes-requested') return 'fix';
  if (entry.freshness !== 'current') return 'recheck';
  if (entry.verification !== 'matched') return 'measure';
  return entry.canAccept ? 'review' : 'gates';
}

export function featureSummary(item: CatalogItem) {
  const open = item.issues.filter(issue => ['open', 'blocked'].includes(issue.status)).length;
  const progress = item.acceptance ? `${item.acceptance.accepted}/${item.acceptance.required} checks complete · ` : '';
  if (open) return `${progress}${open} recorded findings`;
  if (!item.acceptance) return 'Acceptance cases not defined';
  const next = Object.entries(item.acceptance.nextSteps).filter(([action]) => action !== 'accepted' && action !== 'verified').sort((a, b) => b[1]! - a[1]!)[0];
  if (!next) return `${item.acceptance.accepted}/${item.acceptance.required} checks complete${item.acceptance.status === 'accepted' ? '' : ' · implementation incomplete'}`;
  const labels: Record<string, string> = { setup: 'checks have setup blockers', capture: 'checks without captures', recover: 'checks need evidence recovery', fix: 'captured differences', recheck: 'captures need freshness checks', measure: 'checks need measurements', gates: 'checks have acceptance prerequisites', review: 'checks ready for review' };
  return `${progress}${next[1]} ${labels[next[0]]}`;
}
