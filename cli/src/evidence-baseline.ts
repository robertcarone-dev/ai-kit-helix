import { closeSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { sha } from './config.ts';

export type EvidencePin = { path: string; sha256: string };
export function hashFile(path: string) {
  if (!statSync(path).isFile()) throw new Error('Expected a regular dependency file: ' + path);
  const fd = openSync(path, 'r');
  try {
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024);
    let count: number;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) !== 0) hash.update(buffer.subarray(0, count));
    return hash.digest('hex');
  } finally { closeSync(fd); }
}

/** Snapshot author-declared files before producing new evidence, never for an old capture. */
export function captureDependencies(specPath?: string): EvidencePin[] {
  if (specPath === undefined) return [];
  if (!statSync(specPath).isFile() || statSync(specPath).size > 32 * 1024 * 1024) throw new Error('Expected a dependency spec no larger than 32 MiB.');
  const raw = readFileSync(specPath), spec = JSON.parse(raw.toString());
  if (spec.schemaVersion !== 1 || !Array.isArray(spec.files) || !spec.files.length || spec.files.length > 99 || !spec.files.every((file: unknown) => typeof file === 'string' && file.length > 0))
    throw new Error('Capture dependencies require schemaVersion 1 and 1–99 file paths.');
  const paths = [...new Set<string>(spec.files.map((file: string) => resolve(dirname(specPath), file)))];
  return [{ path: resolve(specPath), sha256: sha(raw) }, ...paths.map(path => ({ path, sha256: hashFile(path) }))];
}

export function requireUnchanged(dependencies: EvidencePin[]) {
  for (const file of dependencies)
    if (hashFile(file.path) !== file.sha256) throw new Error('Input changed while producing evidence: ' + file.path);
}

/** Called only by evidence producers with hashes of the bytes they actually used/wrote. */
export function writeBaseline(path: string, producer: 'capture' | 'unity-capture' | 'ui-assets', image: EvidencePin, receipt: EvidencePin, dependencies: EvidencePin[]) {
  const baseline = {
    schemaVersion: 1, kind: 'helix-evidence-baseline', producer, createdUtc: new Date().toISOString(),
    image, receipt, dependencies,
    scope: producer === 'capture'
      ? 'Declared local file hashes around this capture. Does not prove these bytes were loaded by the browser, full dependency coverage, revision or cross-engine state equivalence.'
      : producer === 'unity-capture'
        ? 'Declared local files and compiled assemblies checked around a new Unity capture. Does not establish full dependency coverage, loaded assembly identity or cross-engine state equivalence; inspect the runtime receipt.'
        : 'Extraction input bytes and extraction spec at production time. Does not establish the freshness of a historical screenshot or runtime rendering.',
  };
  writeFileSync(path, JSON.stringify(baseline, null, 2), { flag: 'wx' });
  return path;
}

/** Normalize a producer record; consumers still own freshness checks against current files. */
export function readBaseline(path: string) {
  if (!statSync(path).isFile() || statSync(path).size > 32 * 1024 * 1024) throw new Error('Expected a baseline file no larger than 32 MiB.');
  const raw = readFileSync(path), record = JSON.parse(raw.toString());
  if (record.schemaVersion !== 1 || record.kind !== 'helix-evidence-baseline' || !['capture', 'unity-capture', 'ui-assets'].includes(record.producer) || !Array.isArray(record.dependencies) || record.dependencies.length > 100)
    throw new Error('Expected a producer-owned evidence baseline.');
  const local = (file: any): EvidencePin => {
    if (!file || typeof file.path !== 'string' || !file.path || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid file pin in baseline.');
    return { path: resolve(dirname(path), file.path), sha256: file.sha256 };
  };
  return { image: local(record.image), receipt: local(record.receipt), dependencies: record.dependencies.map(local) as EvidencePin[], baseline: { path: resolve(path), sha256: sha(raw) } };
}
