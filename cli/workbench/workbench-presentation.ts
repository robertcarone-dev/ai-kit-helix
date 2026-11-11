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
  if (item.issues.some(issue => issue.kind === 'defect') || (item.acceptance && (item.acceptance.nextSteps?.fix ?? 0) > 0)) return 'fix';
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
  const defects = item.issues.filter(issue => issue.kind === 'defect').length;
  const review = item.issues.filter(issue => issue.kind === 'review' || issue.kind === 'untriaged').length;
  const port = item.implementation === 'implemented' ? 'Implemented' : item.implementation === 'in-progress' ? 'Implementation in progress' : 'Implementation not assessed';
  const coverage = item.acceptance ? `${item.acceptance.accepted}/${item.acceptance.required} checks complete` : 'Verification not configured';
  return `${port} · ${coverage}${defects ? ` · ${defects} product ${defects === 1 ? 'finding' : 'findings'}` : ''}${review ? ` · ${review} ${review === 1 ? 'finding' : 'findings'} to review` : ''}`;
}

export type FeatureNextStep = { title: string; detail: string; target: 'work' | 'review'; finding: string | null; filter: CaseAction | 'required' };
/** One navigation recommendation, derived from existing records; never a new task or verdict. */
export function featureNextStep(item: CatalogItem): FeatureNextStep {
  const issueStep = (issue: CatalogItem['issues'][number], title: string): FeatureNextStep => ({ title, detail: readableCase(issue.id) + '. ' + issue.triageReason, target: 'work', finding: issue.id, filter: 'required' });
  const defect = item.issues.find(issue => issue.kind === 'defect');
  if (defect) return issueStep(defect, 'Inspect product finding');
  const coverage = item.acceptance;
  if (coverage && (coverage.nextSteps.review ?? 0) > 0) return { title: 'Review eligible evidence', detail: 'Required checks are ready for a decision. Open their evidence and record the review.', target: 'review', finding: null, filter: 'review' };
  const review = item.issues.find(issue => issue.kind === 'review' || issue.kind === 'untriaged');
  if (review) return issueStep(review, 'Review next finding');
  if (!coverage || coverage.required === 0) return { title: 'Define acceptance coverage', detail: 'This feature has no primary acceptance cases yet.', target: 'review', finding: null, filter: 'required' };
  for (const action of ['fix', 'recover', 'recheck', 'measure', 'gates', 'setup', 'capture'] as CaseAction[]) {
    if ((coverage.nextSteps[action] ?? 0) > 0) return { ...caseActionText[action], target: 'review', finding: null, filter: action };
  }
  if (coverage.status === 'accepted') return { title: 'Inspect completed checks', detail: 'Required verification and implementation are complete. Historical and tooling records remain available in Work.', target: 'review', finding: null, filter: 'required' };
  return { title: 'Confirm implementation status', detail: 'Required checks are complete. Review the implementation declaration before marking the feature complete.', target: 'review', finding: null, filter: 'required' };
}
