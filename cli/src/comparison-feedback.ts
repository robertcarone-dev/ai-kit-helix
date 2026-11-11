import { readFileSync, statSync } from 'node:fs';
import { localUrl, sha } from './config.ts';
import { readRegisteredComparison } from './comparison-index.ts';
import { readEvidence } from './evidence-validation.ts';
import { evidenceManifest, reviewTargets, readReview, verifyReviewManifest, reviewId, reviewState } from './review-format.ts';

/** Read the same local-draft decisions and legacy account records as the mod, without mutations. */
export async function comparisonFeedback(root: string, project: string, id: string) {
  const comparison = readRegisteredComparison(root, project, id);
  if (statSync(comparison.path).size > 48 * 1024 * 1024) throw new Error('Comparison exceeds 48 MiB.');
  const bytes = readFileSync(comparison.path);
  if (bytes.length > 48 * 1024 * 1024 || sha(bytes) !== comparison.sha256) throw new Error('Registered comparison changed. Register the current evidence before reading feedback.');
  const bundle = await readEvidence(bytes.toString('utf8'));
  const targets = await reviewTargets(bundle.files, sha(evidenceManifest(bundle.files)));
  const origin = new URL(localUrl(process.env.HELIX_URL ?? `http://127.0.0.1:${process.env.HELIX_DESKTOP_PORT ?? 47600}`)).origin;
  async function get(key: string) {
    const response = await fetch(`${origin}/api/me/mod-kv/${project}~porting-workbench/${encodeURIComponent(key)}`, { headers: { 'x-helix-project': project }, signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new Error(`Could not read Helix feedback (${response.status}): ${await response.text()}`);
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Helix feedback response.');
    return data.value;
  }
  const feedback = [];
  for (const target of targets) {
    const key = 'review-v2-' + sha(reviewId(target));
    const response = await fetch(`${origin}/api/mods/${project}~porting-workbench/reviews/read`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-helix-project': project }, body: JSON.stringify({ key }), signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new Error(`Could not read stored review (${response.status}): ${await response.text()}`);
    const stored = await response.json();
    const raw = stored.value === undefined ? await get(key) : stored.value;
    let decision = raw === undefined ? null : readReview(raw);
    if (decision) await verifyReviewManifest(decision);
    if (decision && reviewId(decision) !== reviewId(target)) throw new Error('Saved review identity mismatch.');
    if (!decision) {
      const paths = [...new Set([target.reportPath, `${target.caseId}/render-inspection.json`, ...Array.from({ length: 20 }, (_, index) => `${target.caseId}/render-inspection-${index}.json`)])];
      const legacy = await Promise.all(paths.map(async reportPath => {
        const value = await get('review-v1-' + sha(JSON.stringify([reportPath, target.element])));
        if (value === undefined) return null;
        if (value.version !== 1 || value.element !== target.element || value.reportPath !== reportPath) throw new Error('Legacy review identity mismatch.');
        return readReview({ ...value, version: 2, caseId: target.caseId });
      }));
      decision = legacy.filter(value => value !== null).sort((a, b) => b.savedUtc.localeCompare(a.savedUtc))[0] ?? null;
    }
    feedback.push({ caseId: target.caseId, element: target.element, state: reviewState(decision, target), decision });
  }
  // Older bundles have report-path identities, which the viewer still saves as v1 decisions.
  for (const file of bundle.files.filter(file => file.type === 'json')) {
    const report = JSON.parse(file.data);
    if (report?.kind !== 'helix-render-inspection' || report.schemaVersion !== 1 || report.reviewCaseId !== undefined) continue;
    const raw = await get('review-v1-' + sha(JSON.stringify([file.path, report.id])));
    if (raw !== undefined && (raw.version !== 1 || raw.element !== report.id || raw.reportPath !== file.path)) throw new Error('Legacy review identity mismatch.');
    const validated = raw === undefined ? null : readReview({ ...raw, version: 2, caseId: 'legacy' });
    const target = { caseId: 'legacy', element: report.id, reportPath: file.path, reference: report.images.reference, candidate: report.images.candidate, evidence: sha(evidenceManifest(bundle.files)) };
    feedback.push({ caseId: null, element: report.id, reportPath: file.path, identity: 'legacy-report-path', state: reviewState(validated, target), decision: validated ? { version: 1, element: validated.element, reportPath: validated.reportPath, reference: validated.reference, candidate: validated.candidate, evidence: validated.evidence, status: validated.status, notes: validated.notes, savedUtc: validated.savedUtc } : null });
  }
  return { comparison: id, links: comparison.links, project, feedback, note: 'Saved feedback from the current Helix draft (with legacy account fallback), checked against this bundle. Not a live source freshness check. Unsaved edits are excluded.' };
}
