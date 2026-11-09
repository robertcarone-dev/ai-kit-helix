import { debugImageData, imageDebugControls } from './image-debug.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PNG } from 'pngjs';
import { emptyOutput, sha } from './config.ts';
import { parseRegions, regionDifference } from './image-regions.ts';

/** Produce exact pixel diagnostics at native dimensions; leave visual acceptance to review. */
export function compare(
  referencePath: string,
  candidatePath: string,
  output: string,
  regionsPath?: string,
) {
  const referenceBytes = readFileSync(referencePath),
    candidateBytes = readFileSync(candidatePath);
  const reference = PNG.sync.read(referenceBytes),
    candidate = PNG.sync.read(candidateBytes);
  if (reference.width !== candidate.width || reference.height !== candidate.height)
    throw new Error(
      'Native dimensions differ; recapture at matching dimensions. Images are never resized.',
    );
  let regional:
    | {
        regionsSource: { path: string; sha256: string };
        regions: ReturnType<typeof regionDifference>[];
      }
    | undefined;
  if (regionsPath !== undefined) {
    if (referenceBytes[24] !== 8 || candidateBytes[24] !== 8)
      throw new Error('Regional measurements require 8-bit PNG inputs.');
    const bytes = readFileSync(regionsPath);
    const regions = parseRegions(JSON.parse(bytes.toString()), reference.width, reference.height);
    regional = {
      regionsSource: { path: resolve(regionsPath), sha256: sha(bytes) },
      regions: regions.map((region) => regionDifference(reference, candidate, region)),
    };
  }
  const sideBySide = new PNG({
      width: reference.width * 2,
      height: reference.height,
    }),
    difference = new PNG({
      width: reference.width,
      height: reference.height,
    });
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
    reference: {
      path: resolve(referencePath),
      sha256: sha(referenceBytes),
    },
    candidate: {
      path: resolve(candidatePath),
      sha256: sha(candidateBytes),
    },
    width: reference.width,
    height: reference.height,
    changedPixels,
    changedFraction: changedPixels / (reference.width * reference.height),
    ...regional,
    verdict: null,
    notes: [
      'Exact pixel differences are diagnostic, not visual acceptance.',
      'Matching dimensions alone do not establish matching scenario, revision, timing or native rendering.',
    ],
    out,
  };
  writeFileSync(join(out, 'comparison.json'), JSON.stringify(result, null, 2));
  let regionalTable = '';
  if (regional !== undefined) {
    const rows = regional.regions
      .map((region) => {
        const values = [
          region.id,
          region.rect.join(', '),
          region.pixelCount,
          region.referenceMeanRgb.join(', '),
          region.candidateMeanRgb.join(', '),
          region.meanDeltaRgb.join(', '),
          region.changedPixels,
          region.changedFraction,
          region.meanAbsoluteDeltaRgb.join(', '),
          region.maxAbsoluteDeltaRgb.join(', '),
        ];
        const cells = values
          .map(
            (value) =>
              `<td>${String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</td>`,
          )
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');
    regionalTable = `<h2>Regional measurements</h2><p>Native top-left rectangles [left, top, right, bottom), encoded 8-bit RGB; opaque sampled pixels only. Deltas are candidate minus reference. Diagnostic measurements, not acceptance verdicts.</p><table><thead><tr><th>Region</th><th>Rectangle</th><th>Pixels</th><th>Reference mean RGB</th><th>Candidate mean RGB</th><th>Mean delta RGB</th><th>Changed pixels</th><th>Changed fraction</th><th>Mean absolute delta RGB</th><th>Max absolute delta RGB</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  writeFileSync(
    join(out, 'review.html'),
    `<!doctype html><meta charset="utf-8"><title>Helix comparison</title><style>body{background:#222;color:white;font:16px sans-serif}.pair{display:flex}img{max-width:50%;height:auto;object-fit:contain;align-self:start}</style><h1>Reference / Unity candidate</h1>${imageDebugControls()}<div class="pair"><img id="reference"><img id="candidate"></div><h2>Exact RGBA pixel difference</h2><img src="diff.png">${regionalTable}<script>
const images=${JSON.stringify({ reference: debugImageData(referenceBytes), candidate: debugImageData(candidateBytes) })};
function draw(){for(const side of ['reference','candidate'])document.getElementById(side).src=images[side][document.getElementById('image-debug-view').value];}
document.getElementById('image-debug-view').onchange=draw;draw();</script>`,
  );
  return result;
}
