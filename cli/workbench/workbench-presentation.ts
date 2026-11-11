import type { CatalogItem } from './catalog-view.ts';
import type { CaseRow } from './acceptance-view.ts';

export type WorkStatus = 'fix' | 'evidence' | 'ready' | 'accepted' | 'define' | 'recheck';
export function finding(entry: CaseRow) { return entry.latestAssessment && entry.assessmentAvailable ? entry.latestAssessment.outcome : entry.verification; }
export function caseStatus(entry: CaseRow): WorkStatus {
  if (entry.accepted) return 'accepted';
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
export const statusText: Record<WorkStatus, string> = { fix: 'Needs fixing', evidence: 'Needs evidence', ready: 'Ready for review', accepted: 'Accepted', define: 'Define coverage', recheck: 'Needs recheck' };
export const nextAction: Record<WorkStatus, string> = { fix: 'Review open findings', evidence: 'Prepare missing evidence', ready: 'Review eligible cases', accepted: 'Inspect accepted scope', define: 'Define acceptance cases', recheck: 'Recheck changed inputs' };
