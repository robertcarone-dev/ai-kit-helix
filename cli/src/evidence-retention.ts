import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync, lstatSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, relative, join } from 'node:path';
import { digest, portablePath } from './acceptance-format.ts';
import { catalogPath } from './catalog.ts';

const indexPath = 'Tools/Helix/evidence/recovery.json';
function git(root: string, args: string[]) { return execFileSync('git', ['-C', root, ...args], { timeout: 30000, maxBuffer: 128 * 1024 * 1024 }); }
export function evidenceRecovery(root: string) {
  const path = catalogPath(root, indexPath);
  if (!existsSync(path)) return { version: 1, files: [] as { path: string; commit: string; sha256: string; bytes: number }[] };
  const index = JSON.parse(readFileSync(path, 'utf8'));
  if (index.version !== 1 || !Array.isArray(index.files)) throw new Error('Invalid evidence recovery index');
  const seen = new Set<string>();
  for (const file of index.files) {
    portablePath(file.path);
    if (seen.has(file.path) || !/^[a-f0-9]{40}$/.test(file.commit) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isInteger(file.bytes) || file.bytes < 0 || file.bytes > 128 * 1024 * 1024) throw new Error('Invalid evidence recovery entry');
    seen.add(file.path);
  }
  return index;
}
/** Only generated HTML is compacted. Pinned screenshots, observations and source inputs stay untouched. */
function compactEvidenceLocked(root: string, directory: string, apply: boolean) {
  portablePath(directory); catalogPath(root, directory);
  if (!directory.startsWith('Tools/Helix/evidence/') && !directory.startsWith('Documentation/Verification/Evidence/')) throw new Error('Select an evidence batch directory');
  const commit = git(root, ['rev-parse', 'HEAD']).toString().trim();
  const paths = git(root, ['ls-tree', '-r', '--name-only', '-z', commit, '--', directory]).toString().split('\0').filter(path => path.endsWith('.html'));
  const protectedPaths = new Set<string>();
  const scan = (value: any) => { if (typeof value === 'string') protectedPaths.add(value); else if (value && typeof value === 'object') Object.values(value).forEach(scan); };
  const visit = (path: string) => {
    if (!existsSync(path)) return;
    if (lstatSync(path).isSymbolicLink()) throw new Error('Evidence metadata cannot be a symlink');
    if (lstatSync(path).isDirectory()) for (const child of readdirSync(path)) visit(join(path, child));
    else if (path.endsWith('.json')) scan(JSON.parse(readFileSync(path, 'utf8')));
  };
  for (const directory of ['Tools/Helix/acceptance', 'Tools/Helix/discrepancies', 'Tools/Helix/catalog']) visit(catalogPath(root, directory));
  const index = evidenceRecovery(root), candidates = [];
  for (const path of paths) {
    if (protectedPaths.has(path)) continue;
    const full = catalogPath(root, path); if (!existsSync(full)) continue;
    const bytes = readFileSync(full), original = git(root, ['show', commit + ':' + path]);
    if (!bytes.equals(original)) throw new Error('Evidence has concurrent/uncommitted changes: ' + path);
    candidates.push({ path, commit, sha256: digest(bytes), bytes: bytes.length });
  }
  if (apply && candidates.length) {
    // Publish recovery references before removing anything. Interrupted compaction remains recoverable.
    for (const file of candidates) {
      const old = index.files.find((entry: any) => entry.path === file.path);
      if (old && old.sha256 !== file.sha256) throw new Error('Recovery path already identifies different bytes');
      if (!old) index.files.push(file);
    }
    const full = catalogPath(root, indexPath); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, JSON.stringify(index, null, 2) + '\n');
    for (const file of candidates) { const full = catalogPath(root, file.path); if (digest(readFileSync(full)) !== file.sha256) throw new Error('Evidence changed during compaction'); unlinkSync(full); }
  }
  return { applied: apply, files: candidates.length, bytes: candidates.reduce((n, file) => n + file.bytes, 0), recovery: indexPath };
}
export function recoverEvidence(root: string, path: string, out: string) {
  const file = evidenceRecovery(root).files.find((entry: any) => entry.path === path);
  if (!file) throw new Error('No registered recovery path');
  const bytes = git(root, ['show', file.commit + ':' + file.path]);
  if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error('Recovered evidence differs from retained hash');
  const target = resolve(root, out); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: 'wx' });
  return { path, out: target, sha256: file.sha256, bytes: bytes.length };
}

/** Retain declared evidence once; generated HTML, crops and debug output stay in execution scratch. */
export function retainRunArtifacts(root: string, target: string, output: string, retained: string, artifacts: { path: string; sha256: string; recovery: string }[]) {
  const original = relative(target, output);
  const copies = artifacts.map(artifact => {
    if (!artifact.path.startsWith(original + '/')) throw new Error('Adapter artifact is outside its fresh capture directory');
    const source = catalogPath(target, artifact.path), destination = retained + artifact.path.slice(original.length);
    if (digest(readFileSync(source)) !== artifact.sha256) throw new Error('Capture artifact changed before retention');
    return { artifact, source, destination };
  });
  for (const { artifact, source, destination } of copies) {
    const full = catalogPath(root, destination); mkdirSync(dirname(full), { recursive: true });
    cpSync(source, full, { errorOnExist: true, force: false });
    artifact.path = destination; artifact.recovery = 'Repository evidence: ' + retained;
  }
}

export function compactEvidence(root: string, directory: string, apply: boolean) {
  if (!apply) return compactEvidenceLocked(root, directory, false);
  const lock = catalogPath(root, '.helix/evidence-retention.lock'); mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(lock, String(process.pid), { flag: 'wx' });
  try { return compactEvidenceLocked(root, directory, true); } finally { unlinkSync(lock); }
}
