/** Standard ZIP storage for immutable evidence. Original logical paths and hashes never change. */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, lstatSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { catalogPath } from './catalog.ts';
import { digest, portablePath } from './acceptance-format.ts';

const indexPath = 'Tools/Helix/evidence/archives.json';
type File = { path: string; sha256: string; bytes: number };
type Archive = { path: string; sha256: string; files: File[] };
const evidenceDirectory = (path: string) => path.startsWith('Tools/Helix/evidence/verification/') || path.startsWith('Documentation/Verification/Evidence/');
function index(root: string): { version: 1; archives: Archive[] } {
  const path = catalogPath(root, indexPath);
  if (!existsSync(path)) return { version: 1, archives: [] };
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (value.version !== 1 || !Array.isArray(value.archives)) throw new Error('Invalid evidence archive index');
  const seen = new Set<string>();
  for (const archive of value.archives) {
    portablePath(archive.path);
    if (!archive.path.startsWith('Tools/Helix/evidence/archives/') || !/^[a-f0-9]{64}$/.test(archive.sha256) || !Array.isArray(archive.files)) throw new Error('Invalid evidence archive');
    for (const file of archive.files) {
      portablePath(file.path);
      if (!evidenceDirectory(file.path) || seen.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 128 * 1024 * 1024) throw new Error('Invalid archived evidence file');
      seen.add(file.path);
    }
  }
  return value;
}
const checkedArchives = new Map<string, string>();
/** Materialize on demand into ignored cache; a missing/corrupt archive never grants availability. */
export function evidencePath(root: string, path: string): string {
  const original = catalogPath(root, path);
  if (existsSync(original) || !evidenceDirectory(path)) return original;
  const archive = index(root).archives.find(archive => archive.files.some(file => file.path === path));
  if (!archive) return original;
  const file = archive.files.find(file => file.path === path)!;
  const source = catalogPath(root, archive.path);
  if (!existsSync(source)) return original;
  const info = statSync(source), stamp = `${archive.sha256}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  if (checkedArchives.get(source) !== stamp) {
    if (digest(readFileSync(source)) !== archive.sha256) throw new Error('Evidence archive changed: ' + archive.path);
    checkedArchives.set(source, stamp);
  }
  const cache = catalogPath(root, '.helix/evidence-cache/' + file.sha256 + '/' + path.split('/').pop()!);
  if (existsSync(cache) && digest(readFileSync(cache)) === file.sha256) return cache;
  const bytes = execFileSync('python3', ['-c', 'import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n i=z.getinfo(sys.argv[2])\n if i.file_size != int(sys.argv[3]): raise ValueError("Evidence size changed")\n sys.stdout.buffer.write(z.read(i))', source, path, String(file.bytes)], { maxBuffer: 128 * 1024 * 1024, timeout: 30000 });
  if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error('Archived evidence hash differs: ' + path);
  mkdirSync(dirname(cache), { recursive: true });
  const temporary = cache + '.' + randomUUID(); writeFileSync(temporary, bytes, { flag: 'wx' }); renameSync(temporary, cache);
  return cache;
}
/** Preview-first, byte-preserving migration. Publish verified recovery before unlinking originals. */
export function archiveEvidence(root: string, directory: string, apply: boolean) {
  portablePath(directory);
  if (!evidenceDirectory(directory + '/')) throw new Error('Select a verification evidence directory');
  if (existsSync(catalogPath(root, '.helix/workbench-runs/active.lock'))) throw new Error('Wait for the active verification job before archiving evidence');
  const files: File[] = [];
  function visit(path: string) {
    const full = catalogPath(root, path), info = lstatSync(full);
    if (info.isSymbolicLink()) throw new Error('Evidence archive does not follow symlinks');
    if (info.isDirectory()) { for (const name of readdirSync(full).sort()) visit(path + '/' + name); return; }
    if (!info.isFile() || info.size > 128 * 1024 * 1024) throw new Error('Evidence must be regular files within 128 MiB');
    files.push({ path, sha256: digest(readFileSync(full)), bytes: info.size });
  }
  visit(directory);
  const result = { applied: apply, files: files.length, bytes: files.reduce((total, file) => total + file.bytes, 0), archive: null as string | null, archiveBytes: 0 };
  if (!apply || !files.length) return result;
  const lock = catalogPath(root, '.helix/evidence-retention.lock'); mkdirSync(dirname(lock), { recursive: true }); writeFileSync(lock, '', { flag: 'wx' });
  try {
    if (existsSync(catalogPath(root, '.helix/workbench-runs/active.lock'))) throw new Error('Wait for the active verification job before archiving evidence');
    const current = index(root);
    if (files.some(file => current.archives.some(archive => archive.files.some(old => old.path === file.path)))) throw new Error('Files already archived; do not replace immutable archive paths');
    const archive = 'Tools/Helix/evidence/archives/' + randomUUID() + '.zip';
    const full = catalogPath(root, archive); mkdirSync(dirname(full), { recursive: true });
    execFileSync('python3', ['-c', 'import sys,json,zipfile,hashlib,pathlib\nroot=pathlib.Path(sys.argv[1]); files=json.load(sys.stdin)\nwith zipfile.ZipFile(sys.argv[2],"x",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:\n for f in files:\n  b=(root/f["path"]).read_bytes()\n  if hashlib.sha256(b).hexdigest()!=f["sha256"]: raise ValueError("Evidence changed during archive")\n  z.writestr(f["path"],b)\nwith zipfile.ZipFile(sys.argv[2]) as z:\n for f in files:\n  if hashlib.sha256(z.read(f["path"])).hexdigest()!=f["sha256"]: raise ValueError("Archive verification failed")', root, full], { input: JSON.stringify(files), timeout: 120000 });
    for (const file of files) if (digest(readFileSync(catalogPath(root, file.path))) !== file.sha256) throw new Error('Concurrent evidence change; originals preserved');
    current.archives.push({ path: archive, sha256: digest(readFileSync(full)), files });
    const target = catalogPath(root, indexPath), temporary = target + '.' + randomUUID(); writeFileSync(temporary, JSON.stringify(current, null, 2) + '\n', { flag: 'wx' }); renameSync(temporary, target);
    for (const file of files) {
      const path = catalogPath(root, file.path);
      if (digest(readFileSync(path)) !== file.sha256) throw new Error('Concurrent evidence change; remaining originals preserved');
      unlinkSync(path);
    }
    return { ...result, archive, archiveBytes: statSync(full).size };
  } finally { unlinkSync(lock); }
}
