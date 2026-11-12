import { readdirSync, readFileSync, mkdirSync, writeFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve, extname, sep } from 'node:path';
import { pngDimensions, evidencePixelLimit } from './image-limits.ts';
import { PNG } from 'pngjs';
import { sha } from './config.ts';

type EvidenceFile = { path: string; sha256: string; data: string } & ({ type: 'png'; width: number; height: number } | { type: 'json' });

/** Portable, bounded evidence for the mod; never follows evidence symlinks or executes HTML. */
export function bundleEvidence(source: string, output: string) {
  const base = realpathSync(source);
  const out = resolve(output);
  const inside = relative(base, out);
  if (!inside || (!inside.startsWith('..' + sep) && inside !== '..' && !inside.startsWith(sep)))
    throw new Error('Bundle output must be outside the source directory.');
  const files: EvidenceFile[] = [], skipped: string[] = [];
  let total = 0, pixels = 0;
  function visit(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name), name = relative(base, path).split(sep).join('/');
      if (entry.isDirectory()) { visit(path); continue; }
      if (!entry.isFile() || !['.png', '.json'].includes(extname(entry.name).toLowerCase())) { skipped.push(name); continue; }
      total += statSync(path).size;
      if (total > 32 * 1024 * 1024 || files.length >= 250)
        throw new Error('Select a smaller evidence directory (maximum 250 files / 32 MiB).');
      const bytes = readFileSync(path);
      if (extname(entry.name).toLowerCase() === '.png') {
        const dimensions = pngDimensions(bytes);
        pixels += dimensions.width * dimensions.height;
        if (pixels > evidencePixelLimit) throw new Error('Bundle exceeds decoded image budget (33554432 total pixels).');
        const png = PNG.sync.read(bytes);
        files.push({ path: name, sha256: sha(bytes), type: 'png', width: png.width, height: png.height, data: bytes.toString('base64') });
      } else {
        const data = bytes.toString('utf8');
        JSON.parse(data);
        files.push({ path: name, sha256: sha(bytes), type: 'json', data });
      }
    }
  }
  visit(base);
  if (!files.length) throw new Error('No PNG or JSON evidence found.');
  const bundle = { format: 'helix-workbench-evidence', version: 1, createdUtc: new Date().toISOString(), source: base, files, skipped };
  const bytes = JSON.stringify(bundle);
  if (Buffer.byteLength(bytes) > 48 * 1024 * 1024) throw new Error('Encoded bundle exceeds 48 MiB. Select a smaller evidence directory.');
  mkdirSync(out);
  writeFileSync(join(out, 'evidence.json'), bytes, { flag: 'wx' });
  return { out, files: files.length, skipped, sha256: sha(bytes), note: 'Inspect the portable evidence.json bundle with the offline review commands. Hash integrity does not establish parity or source revision.' };
}
