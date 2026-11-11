// Portable review format. Kept identical in the project mod's review-format.ts.
export type Review = { version: 2; caseId: string; element: string; reportPath: string; reference: string; candidate: string; evidence: string; status: 'accepted' | 'needs-work' | 'blocked'; notes: string; savedUtc: string; dependencyManifest?: DependencyManifest };
export type Reviews = { format: 'helix-review-decisions'; version: 1; project: string; exportedUtc: string; decisions: Review[] };
export type ReviewTarget = { caseId: string; element: string; reportPath: string; reference: string; candidate: string; evidence: string; dependencies?: ManifestFile[] };
export type ReviewFile = { path: string; type: string; sha256: string; data: string };
export const reviewLimit = 48 * 1024 * 1024;
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const utc = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
export const reviewId = (value: { caseId: string; element: string }) => JSON.stringify([value.caseId, value.element]);
export function readReview(value: any): Review {
  if (!value || value.version !== 2 || typeof value.caseId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.caseId) || typeof value.element !== 'string' || !value.element || value.element.length > 256 || typeof value.reportPath !== 'string' || !value.reportPath || value.reportPath.length > 4096 || !hash(value.reference) || !hash(value.candidate) || !hash(value.evidence) || !['accepted', 'needs-work', 'blocked'].includes(value.status) || typeof value.notes !== 'string' || value.notes.length > 2000 || !utc(value.savedUtc)) throw new Error('Invalid review decision.');
  const dependencyManifest = value.dependencyManifest === undefined ? undefined : readDependencyManifest(value.dependencyManifest);
  if (dependencyManifest && (!dependencyManifest.files.some(file => file.path === value.reportPath && file.type === 'json') || ![value.reference, value.candidate].every(image => dependencyManifest.files.some(file => file.type === 'png' && file.sha256 === image)))) throw new Error('Saved dependency manifest must include its report and both captures.');
  return { ...(dependencyManifest ? { dependencyManifest } : {}), version: 2, caseId: value.caseId, element: value.element, reportPath: value.reportPath, reference: value.reference, candidate: value.candidate, evidence: value.evidence, status: value.status, notes: value.notes, savedUtc: value.savedUtc };
}
export type DependencyManifest = { version: 1; scope: 'declared-target' | 'whole-bundle'; files: ManifestFile[] };
function readDependencyManifest(value: any): DependencyManifest {
  if (!value || value.version !== 1 || !['declared-target', 'whole-bundle'].includes(value.scope) || !Array.isArray(value.files) || !value.files.length || value.files.length > 250) throw new Error('Invalid saved dependency manifest.');
  const seen = new Set<string>();
  const files = value.files.map((file: any): ManifestFile => {
    if (!file || typeof file.path !== 'string' || !file.path || file.path.length > 4096 || seen.has(file.path) || !['png', 'json'].includes(file.type) || !hash(file.sha256)) throw new Error('Invalid or duplicate saved dependency entry.');
    seen.add(file.path); return { path: file.path, type: file.type, sha256: file.sha256 };
  });
  files.sort((a: ManifestFile, b: ManifestFile) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { version: 1, scope: value.scope, files };
}
async function reviewEvidenceHash(caseId: string, element: string, manifest: DependencyManifest) {
  const payload = manifest.scope === 'whole-bundle' ? evidenceManifest(manifest.files) : JSON.stringify(['helix-target-evidence', 1, caseId, element, evidenceManifest(manifest.files)]);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)))).map(n => n.toString(16).padStart(2, '0')).join('');
}
export async function verifyReviewManifest(record: Review): Promise<void> {
  if (record.dependencyManifest && await reviewEvidenceHash(record.caseId, record.element, record.dependencyManifest) !== record.evidence) throw new Error('Saved dependency manifest does not match the decision evidence hash.');
}
export async function readValidatedReviews(text: string, project: string): Promise<Reviews> {
  const records = readReviews(text, project);
  await Promise.all(records.decisions.map(verifyReviewManifest));
  return records;
}
export function readReviews(text: string, project: string): Reviews {
  if (text.length > reviewLimit) throw new Error('Review file exceeds 48 MiB.');
  const value = JSON.parse(text);
  if (!value || value.format !== 'helix-review-decisions' || value.version !== 1 || value.project !== project || !utc(value.exportedUtc) || !Array.isArray(value.decisions) || value.decisions.length > 250) throw new Error('Expected version-1 review decisions for project ' + project + '.');
  const seen = new Set<string>();
  const decisions = value.decisions.map((item: unknown) => {
    const record = readReview(item), id = reviewId(record);
    if (seen.has(id)) throw new Error('Duplicate review identity: ' + record.caseId + ' / ' + record.element);
    seen.add(id); return record;
  });
  return { format: 'helix-review-decisions', version: 1, project, exportedUtc: value.exportedUtc, decisions };
}
export const sameReview = (a: Review | null, b: Review | null) => a === null || b === null ? a === b : JSON.stringify(readReview(a)) === JSON.stringify(readReview(b));
export function evidenceManifest(files: ManifestFile[]) {
  return JSON.stringify(files.map(file => [file.path, file.type, file.sha256] as const).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
export async function reviewTargets(files: ReviewFile[], evidence: string): Promise<ReviewTarget[]> {
  const images = new Set(files.filter(file => file.type === 'png').map(file => file.sha256));
  const seen = new Set<string>();
  const byPath = new Map(files.map(file => [file.path, file]));
  const targets = files.filter(file => file.type === 'json').flatMap(file => {
    const report = JSON.parse(file.data);
    if (report?.kind !== 'helix-render-inspection' || report.schemaVersion !== 1 || report.reviewCaseId === undefined) return [];
    if (report.schemaVersion !== 1 || typeof report.reviewCaseId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(report.reviewCaseId) || typeof report.id !== 'string' || !report.id || report.id.length > 256 || !hash(report.images?.reference) || !hash(report.images?.candidate) || !images.has(report.images.reference) || !images.has(report.images.candidate)) throw new Error('Invalid or incomplete review target: ' + file.path);
    const target: ReviewTarget = { caseId: report.reviewCaseId, element: report.id, reportPath: file.path, reference: report.images.reference, candidate: report.images.candidate, evidence };
    if (report.reviewDependencies !== undefined) {
      const declaration = report.reviewDependencies;
      if (!declaration || declaration.version !== 1 || !Array.isArray(declaration.paths) || !declaration.paths.length || declaration.paths.length > 249 || !declaration.paths.every((path: unknown) => typeof path === 'string' && path.length > 0 && path.length <= 4096) || new Set(declaration.paths).size !== declaration.paths.length) throw new Error('Invalid review dependency declaration: ' + file.path);
      const paths = [...new Set<string>([file.path, ...declaration.paths])].sort();
      target.dependencies = paths.map(path => {
        const dependency = byPath.get(path);
        if (!dependency) throw new Error('Missing review dependency: ' + path + ' for ' + file.path);
        return { path, type: dependency.type, sha256: dependency.sha256 };
      });
      for (const image of [target.reference, target.candidate]) if (!target.dependencies.some(dependency => dependency.type === 'png' && dependency.sha256 === image)) throw new Error('Review dependencies must include both capture images: ' + file.path);
    }
    const id = reviewId(target);
    if (seen.has(id)) throw new Error('Duplicate review target: ' + target.caseId + ' / ' + target.element);
    seen.add(id); return [target];
  });
  return Promise.all(targets.map(async target => {
    if (!target.dependencies) return target;
    const digest = await reviewEvidenceHash(target.caseId, target.element, { version: 1, scope: 'declared-target', files: target.dependencies });
    return { ...target, evidence: digest };
  }));
}
export function reviewState(record: Review | null, target: ReviewTarget | undefined) {
  if (!target) return 'not-in-evidence';
  if (!record) return 'not-reviewed';
  return record.reference === target.reference && record.candidate === target.candidate && record.evidence === target.evidence ? record.status : 'review-required';
}

export type ManifestFile = Pick<ReviewFile, 'path' | 'type' | 'sha256'>;
export type PreviousEvidence = { fingerprint: string; files: ManifestFile[] };
export async function readPreviousEvidence(value: any): Promise<PreviousEvidence | undefined> {
  if (value === undefined) return undefined;
  if (!value || !hash(value.fingerprint) || !Array.isArray(value.files) || !value.files.length || value.files.length > 250) throw new Error('Invalid previous evidence manifest.');
  const seen = new Set<string>();
  const files: ManifestFile[] = value.files.map((file: any) => {
    if (!file || typeof file.path !== 'string' || !file.path || file.path.length > 4096 || seen.has(file.path) || !['png', 'json'].includes(file.type) || !hash(file.sha256)) throw new Error('Invalid or duplicate previous evidence entry.');
    seen.add(file.path); return { path: file.path, type: file.type, sha256: file.sha256 };
  });
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(evidenceManifest(files))))).map(n => n.toString(16).padStart(2, '0')).join('');
  if (digest !== value.fingerprint) throw new Error('Previous evidence manifest hash mismatch.');
  return { fingerprint: digest, files };
}
export function evidenceChanges(previous: ManifestFile[], current: ManifestFile[]) {
  const before = new Map(previous.map(file => [file.path, file]));
  const changed: { path: string; change: 'added' | 'removed' | 'modified' }[] = [];
  for (const file of current) {
    const old = before.get(file.path); before.delete(file.path);
    if (!old) changed.push({ path: file.path, change: 'added' });
    else if (old.sha256 !== file.sha256 || old.type !== file.type) changed.push({ path: file.path, change: 'modified' });
  }
  for (const path of before.keys()) changed.push({ path, change: 'removed' });
  return changed;
}
export function reviewReasons(record: Pick<Review, 'reference' | 'candidate' | 'evidence' | 'dependencyManifest'> | null, target: Pick<ReviewTarget, 'reference' | 'candidate' | 'evidence' | 'reportPath' | 'dependencies'> | undefined, current: ManifestFile[], previous?: PreviousEvidence): string[] {
  if (!target) return ['Element is absent from this evidence bundle.'];
  if (!record) return ['No saved decision for this element.'];
  const reasons: string[] = [];
  if (record.reference !== target.reference) reasons.push('Reference capture changed.');
  if (record.candidate !== target.candidate) reasons.push('Candidate capture changed.');
  if (record.evidence !== target.evidence) {
    if (record.dependencyManifest) {
      const currentScope = target.dependencies ? 'declared-target' : 'whole-bundle';
      if (record.dependencyManifest.scope !== currentScope) reasons.push(`Review scope changed: ${record.dependencyManifest.scope} → ${currentScope}.`);
      for (const change of evidenceChanges(record.dependencyManifest.files, target.dependencies ?? current).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) reasons.push(`Dependency ${change.change}: ${change.path}`);
    } else if (target.dependencies) {
      reasons.push('Declared target evidence or dependency scope changed. Original dependency manifest unavailable; exact changes cannot be determined.');
    } else if (previous && previous.fingerprint === record.evidence) {
      const changes = evidenceChanges(previous.files, current);
      if (changes.some(file => file.path === target.reportPath)) reasons.push('Rendering report changed.');
      reasons.push(`Included evidence changed: ${changes.filter(file => file.change === 'modified').length} modified, ${changes.filter(file => file.change === 'added').length} added, ${changes.filter(file => file.change === 'removed').length} removed files.`);
    } else reasons.push('Included evidence changed; detailed changes are unavailable for this decision.');
    if (record.reference === target.reference && record.candidate === target.candidate) reasons.push('Capture images are unchanged.');
  }
  return reasons;
}

// Callers verify a saved manifest once at the read boundary before deriving reasons.
export function reviewDependencyChanges(record: Review | null, target: ReviewTarget | undefined, current: ManifestFile[]) {
  if (!record?.dependencyManifest || !target) return undefined;
  const before = new Map(record.dependencyManifest.files.map(file => [file.path, file]));
  const afterFiles = (target.dependencies ?? current).map(({ path, type, sha256 }) => ({ path, type, sha256 }));
  const after = new Map(afterFiles.map(file => [file.path, file]));
  return evidenceChanges(record.dependencyManifest.files, afterFiles).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(change => ({ ...change, before: before.get(change.path) ?? null, after: after.get(change.path) ?? null }));
}
