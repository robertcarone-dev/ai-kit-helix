import { readFileSync, statSync } from 'node:fs';
import { readEvidence } from './evidence-validation.ts';
import { sha } from './config.ts';
import { evidenceManifest, readValidatedReviews, reviewDependencyChanges, reviewId, reviewState, reviewTargets, reviewLimit, readPreviousEvidence, reviewReasons } from './review-format.ts';

export async function reviewSummary(decisionsPath: string, evidencePath: string, project: string) {
  if (statSync(decisionsPath).size > reviewLimit || statSync(evidencePath).size > 48 * 1024 * 1024) throw new Error('Review or evidence file exceeds its size limit.');
  const reviews = await readValidatedReviews(readFileSync(decisionsPath, 'utf8'), project);
  const bundle = await readEvidence(readFileSync(evidencePath, 'utf8'));
  const previous = await readPreviousEvidence((bundle as typeof bundle & { previousEvidence?: unknown }).previousEvidence);
  const files = bundle.files;
  const fingerprint = sha(Buffer.from(evidenceManifest(files)));
  const targets = await reviewTargets(files, fingerprint);
  const records = new Map(reviews.decisions.map(record => [reviewId(record), record]));
  const rows = targets.map(target => {
    const record = records.get(reviewId(target)) ?? null;
    records.delete(reviewId(target));
    return { caseId: target.caseId, element: target.element, state: reviewState(record, target), scope: target.dependencies ? 'declared-target' : 'whole-bundle', dependencies: target.dependencies?.map(file => file.path), reasons: reviewReasons(record, target, files, previous), dependencyChanges: reviewDependencyChanges(record, target, files), decision: record };
  });
  for (const record of records.values()) rows.push({ caseId: record.caseId, element: record.element, state: 'not-in-evidence', scope: 'not-in-evidence', dependencies: undefined, reasons: reviewReasons(record, undefined, files, previous), dependencyChanges: undefined, decision: record });
  const counts: Record<string, number> = { accepted: 0, 'needs-work': 0, blocked: 0, 'review-required': 0, 'not-reviewed': 0, 'not-in-evidence': 0 };
  for (const row of rows) counts[row.state]++;
  return { format: 'helix-review-summary', version: 1, project, evidence: fingerprint, counts, rows, note: 'Human decisions against included evidence only. This does not verify current source freshness or establish automatic parity.' };
}
