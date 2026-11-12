import { readFileSync, statSync } from 'node:fs';
import { readEvidence } from './evidence-validation.ts';
import { sha } from './config.ts';
import { evidenceManifest, readReview, readValidatedReviews, reviewDependencyChanges, reviewId, reviewState, reviewTargets, reviewLimit, readPreviousEvidence, reviewReasons } from './review-format.ts';

export async function reviewSummary(decisionsPath: string, evidencePath: string, project: string) {
  if (statSync(decisionsPath).size > reviewLimit || statSync(evidencePath).size > 48 * 1024 * 1024) throw new Error('Review or evidence file exceeds its size limit.');
  const exported = JSON.parse(readFileSync(decisionsPath, 'utf8'));
  // Validate the envelope before separating historical report-path decisions.
  await readValidatedReviews(JSON.stringify({ ...exported, decisions: [] }), project);
  if (!Array.isArray(exported.decisions) || exported.decisions.length > 250) throw new Error('Invalid review decisions list.');
  const legacy = new Map<string, any>();
  for (const record of exported.decisions.filter((record: any) => record?.version === 1)) {
    readReview({ ...record, version: 2, caseId: 'legacy' });
    if (record.dependencyManifest !== undefined) throw new Error('Legacy reviews cannot declare a dependency manifest.');
    const key = JSON.stringify([record.reportPath, record.element]);
    if (legacy.has(key)) throw new Error('Duplicate legacy review identity: ' + key);
    legacy.set(key, record);
  }
  const reviews = await readValidatedReviews(JSON.stringify({ ...exported, decisions: exported.decisions.filter((record: any) => record?.version !== 1) }), project);
  const bundle = await readEvidence(readFileSync(evidencePath, 'utf8'));
  const previous = await readPreviousEvidence((bundle as typeof bundle & { previousEvidence?: unknown }).previousEvidence);
  const files = bundle.files;
  const fingerprint = sha(Buffer.from(evidenceManifest(files)));
  const targets = await reviewTargets(files, fingerprint);
  const records = new Map(reviews.decisions.map(record => [reviewId(record), record]));
  const rows: any[] = targets.map(target => {
    const record = records.get(reviewId(target)) ?? null;
    records.delete(reviewId(target));
    const legacyKey = JSON.stringify([target.reportPath, target.element]);
    if (!record && legacy.has(legacyKey)) {
      const original = legacy.get(legacyKey); legacy.delete(legacyKey);
      const normalized = readReview({ ...original, version: 2, caseId: target.caseId });
      return { caseId: target.caseId, element: target.element, reportPath: target.reportPath, identity: 'legacy-report-path', state: reviewState(normalized, target), scope: 'whole-bundle', reasons: reviewReasons(normalized, target, files, previous), decision: original };
    }
    return { caseId: target.caseId, element: target.element, state: reviewState(record, target), scope: target.dependencies ? 'declared-target' : 'whole-bundle', dependencies: target.dependencies?.map(file => file.path), reasons: reviewReasons(record, target, files, previous), dependencyChanges: reviewDependencyChanges(record, target, files), decision: record };
  });
  for (const record of records.values()) rows.push({ caseId: record.caseId, element: record.element, state: 'not-in-evidence', scope: 'not-in-evidence', dependencies: undefined, reasons: reviewReasons(record, undefined, files, previous), dependencyChanges: undefined, decision: record });
  for (const file of files.filter(file => file.type === 'json')) {
    const report = JSON.parse(file.data);
    if (report?.kind !== 'helix-render-inspection' || report.schemaVersion !== 1 || report.reviewCaseId !== undefined) continue;
    const key = JSON.stringify([file.path, report.id]), record = legacy.get(key) ?? null;
    legacy.delete(key);
    const normalized = record === null ? null : readReview({ ...record, version: 2, caseId: 'legacy' });
    const target = { caseId: 'legacy', element: report.id, reportPath: file.path, reference: report.images.reference, candidate: report.images.candidate, evidence: fingerprint };
    rows.push({ caseId: null, element: report.id, reportPath: file.path, identity: 'legacy-report-path', state: reviewState(normalized, target), scope: 'whole-bundle', reasons: reviewReasons(normalized, target, files, previous), decision: record });
  }
  for (const record of legacy.values()) rows.push({ caseId: null, element: record.element, reportPath: record.reportPath, identity: 'legacy-report-path', state: 'not-in-evidence', scope: 'not-in-evidence', decision: record });
  const counts: Record<string, number> = { accepted: 0, 'needs-work': 0, blocked: 0, 'review-required': 0, 'not-reviewed': 0, 'not-in-evidence': 0 };
  for (const row of rows) counts[row.state]++;
  return { format: 'helix-review-summary', version: 1, project, evidence: fingerprint, counts, rows, note: 'Human decisions against included evidence only. This does not verify current source freshness or establish automatic parity.' };
}
