import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PNG } from 'pngjs';
import { emptyOutput, sha } from './config.ts';

/** Produce exact pixel diagnostics at native dimensions; leave visual acceptance to review. */
export function compare(referencePath: string, candidatePath: string, output: string) {
  const referenceBytes = readFileSync(referencePath),
    candidateBytes = readFileSync(candidatePath);
  const reference = PNG.sync.read(referenceBytes),
    candidate = PNG.sync.read(candidateBytes);
  if (reference.width !== candidate.width || reference.height !== candidate.height)
    throw new Error(
      'Native dimensions differ; recapture at matching dimensions. Images are never resized.',
    );
  const sideBySide = new PNG({ width: reference.width * 2, height: reference.height }),
    difference = new PNG({ width: reference.width, height: reference.height });
  PNG.bitblt(reference, sideBySide, 0, 0, reference.width, reference.height, 0, 0);
  PNG.bitblt(candidate, sideBySide, 0, 0, candidate.width, candidate.height, reference.width, 0);
  let changedPixels = 0;
  for (let offset = 0; offset < reference.data.length; offset += 4) {
    let delta = 0;
    for (let channel = 0; channel < 4; channel++)
      delta = Math.max(
        delta,
        Math.abs(reference.data[offset + channel] - candidate.data[offset + channel]),
      );
    if (delta) changedPixels++;
    difference.data[offset] = delta;
    difference.data[offset + 1] = 0;
    difference.data[offset + 2] = 0;
    difference.data[offset + 3] = 255;
  }
  const out = emptyOutput(output);
  writeFileSync(join(out, 'side-by-side.png'), PNG.sync.write(sideBySide));
  writeFileSync(join(out, 'diff.png'), PNG.sync.write(difference));
  const result = {
    schemaVersion: 1,
    reference: { path: resolve(referencePath), sha256: sha(referenceBytes) },
    candidate: { path: resolve(candidatePath), sha256: sha(candidateBytes) },
    width: reference.width,
    height: reference.height,
    changedPixels,
    changedFraction: changedPixels / (reference.width * reference.height),
    verdict: null,
    notes: [
      'Exact pixel differences are diagnostic, not visual acceptance.',
      'Matching dimensions alone do not establish matching scenario, revision, timing or native rendering.',
    ],
    out,
  };
  writeFileSync(join(out, 'comparison.json'), JSON.stringify(result, null, 2));
  writeFileSync(
    join(out, 'review.html'),
    '<!doctype html><meta charset="utf-8"><title>Helix comparison</title><style>body{background:#222;color:white;font:16px sans-serif}img{max-width:100%;height:auto}</style><h1>Reference / Unity candidate</h1><p>Review state, provenance and motion separately. No automatic acceptance verdict.</p><img src="side-by-side.png"><h2>Exact pixel difference</h2><img src="diff.png">',
  );
  return result;
}
