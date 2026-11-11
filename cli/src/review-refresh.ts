import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { sha } from './config.ts';
import { readEvidence } from './evidence-validation.ts';
import { evidenceManifest, readValidatedReviews, reviewLimit } from './review-format.ts';
import { prepareReview } from './workbench-prepare.ts';
import { compareRevisions } from './revision-comparison.ts';
import { reviewSummary } from './review-summary.ts';
import type { EvidenceFile } from './evidence-validation.ts';

// Only metadata owned by preparation is excluded. Capture timestamps, source
// paths, dependency checks, image hashes, and arbitrary supporting JSON stay exact.
function reviewContent(file: EvidenceFile): string {
  const value = JSON.parse(file.data);
  if (!value || value.schemaVersion !== 1) return file.data;
  if ((file.path === 'freshness.json' && value.kind === 'helix-review-preparation') ||
      (/^[a-z0-9-]+\/render-inspection(?:-\d+)?\.json$/.test(file.path) && value.kind === 'helix-render-inspection')) {
    const { createdUtc, ...content } = value;
    return JSON.stringify(content);
  }
  if (/^[a-z0-9-]+\/comparison\/comparison\.json$/.test(file.path) &&
      typeof value.out === 'string' && typeof value.reference?.path === 'string' && typeof value.candidate?.path === 'string' &&
      (value.regionsSource === undefined || typeof value.regionsSource?.path === 'string')) {
    const { out, reference, candidate, regionsSource, ...content } = value;
    const { path: referencePath, ...referenceContent } = reference;
    const { path: candidatePath, ...candidateContent } = candidate;
    if (regionsSource === undefined) return JSON.stringify({ ...content, reference: referenceContent, candidate: candidateContent });
    const { path: regionsPath, ...regionsContent } = regionsSource;
    return JSON.stringify({ ...content, reference: referenceContent, candidate: candidateContent, regionsSource: regionsContent });
  }
  return file.data;
}

/** Prepare an immutable review revision; never re-pin stale inputs or rewrite decisions. */
export async function refreshReview(specPath: string, decisionsPath: string, previousPath: string, output: string, project: string) {
  if (statSync(decisionsPath).size > reviewLimit || statSync(previousPath).size > 48 * 1024 * 1024) throw new Error('Review or evidence file exceeds its size limit.');
  const decisions = readFileSync(decisionsPath);
  await readValidatedReviews(decisions.toString('utf8'), project);
  const previousBytes = readFileSync(previousPath);
  const previous = await readEvidence(previousBytes.toString('utf8'));
  const previousEvidence = { fingerprint: sha(Buffer.from(evidenceManifest(previous.files))), files: previous.files.map(({ path, type, sha256 }) => ({ path, type, sha256 })) };
  const out = resolve(realpathSync(dirname(resolve(output))), basename(resolve(output)));
  // A revision must not add files beneath the previous bundle's directory.
  const distance = relative(dirname(realpathSync(previousPath)), out);
  if (!distance || (distance !== '..' && !distance.startsWith('..' + sep) && !distance.startsWith(sep))) throw new Error('Refresh output must be outside the previous evidence directory.');
  mkdirSync(out);
  const decisionOutput = join(out, 'review-decisions.json');
  writeFileSync(decisionOutput, decisions, { flag: 'wx' });
  const prepared = prepareReview(specPath, join(out, 'review'));
  const receipt = { format: 'helix-review-refresh', version: 1, project, createdUtc: new Date().toISOString(), previous: { path: resolve(previousPath), sha256: sha(previousBytes), evidence: previousEvidence.fingerprint }, decisions: { path: decisionOutput, sha256: sha(decisions) }, preparation: prepared };
  if (prepared.status !== 'ready' || !('bundle' in prepared)) {
    writeFileSync(join(out, 'refresh.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' });
    return { out, status: 'blocked', decisions: decisionOutput, preparation: prepared };
  }
  const bundlePath = prepared.bundle;
  const current = await readEvidence(readFileSync(bundlePath, 'utf8'));
  const previousFiles = new Map(previous.files.map(file => [file.path, file]));
  const retainedReports: { path: string; retainedSha256: string; generatedSha256: string }[] = [];
  current.files = current.files.map(file => {
    const old = previousFiles.get(file.path);
    if (file.type !== 'json' || !old || old.type !== 'json' || old.sha256 === file.sha256 || reviewContent(old) !== reviewContent(file)) return file;
    retainedReports.push({ path: file.path, retainedSha256: old.sha256, generatedSha256: file.sha256 });
    return old;
  });
  const revisionComparison = await compareRevisions(previous, current);
  const enriched = JSON.stringify({ ...current, previousEvidence });
  if (Buffer.byteLength(enriched) > 48 * 1024 * 1024) throw new Error('Refreshed bundle exceeds 48 MiB. Prepare fewer cases.');
  // This bundle belongs to the newly and exclusively created output directory.
  writeFileSync(bundlePath, enriched);
  const changes = revisionComparison.changes.map(({ path, change }) => ({ path, change }));
  writeFileSync(join(out, 'revision-changes.json'), JSON.stringify(revisionComparison, null, 2), { flag: 'wx' });
  const summary = await reviewSummary(decisionOutput, bundlePath, project);
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2), { flag: 'wx' });
  writeFileSync(join(out, 'refresh.json'), JSON.stringify({ ...receipt, retainedReports, changes }, null, 2), { flag: 'wx' });
  return { out, status: 'ready', bundle: bundlePath, decisions: decisionOutput, summary: join(out, 'summary.json'), comparison: join(out, 'revision-changes.json'), limitedFieldFiles: revisionComparison.changes.filter(change => change.fieldDetailsLimited).length, changes, note: 'Open the new bundle and import review-decisions.json. Decisions retain their original evidence hashes; changed evidence requires review.' };
}
