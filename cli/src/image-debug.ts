import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { emptyOutput, sha } from './config.ts';

export const imageViews = ['final', 'luminance', 'hue', 'saturation', 'value', 'alpha'];
export const imageViewNotes =
  'Luminance uses linear sRGB and Rec.709 weights, displayed as linear grayscale. HSV uses encoded sRGB. Hue runs red=0, yellow=1/6, green=1/3, cyan=1/2, blue=2/3, magenta=5/6. Magenta marks undefined hue (saturation or value below 0.01). Transparent RGB is excluded. Alpha is stored coverage, which is uniformly white for an opaque screenshot.';

export function debugPixels(data: Uint8ClampedArray | Buffer, view: string) {
  if (!['final', 'luminance', 'hue', 'saturation', 'value', 'alpha'].includes(view))
    throw new Error('Unknown image debug view: ' + view);
  if (view === 'final') return;
  const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255,
      g = data[i + 1] / 255,
      b = data[i + 2] / 255,
      alpha = data[i + 3];
    const high = Math.max(r, g, b),
      low = Math.min(r, g, b),
      delta = high - low;
    const saturation = high === 0 ? 0 : delta / high;
    let value = 0;
    if (view === 'alpha') value = alpha / 255;
    else if (alpha !== 0) {
      if (view === 'luminance')
        value = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
      if (view === 'saturation') value = saturation;
      if (view === 'value') value = high;
      if (view === 'hue') {
        if (saturation < 0.01 || high < 0.01) {
          data[i] = 255;
          data[i + 1] = 0;
          data[i + 2] = 255;
          data[i + 3] = 255;
          continue;
        }
        const sector =
          high === r ? (g - b) / delta : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
        value = (sector / 6 + 1) % 1;
      }
    }
    data[i] = data[i + 1] = data[i + 2] = Math.round(value * 255);
    data[i + 3] = 255;
  }
}

export function imageDebugControls() {
  return `<label>Debug view <select id="image-debug-view">${imageViews.map((v) => `<option>${v}</option>`).join('')}</select></label><p>${imageViewNotes}</p>`;
}

// Transform original PNG bytes on the server, preserving low-alpha RGB that a canvas round trip loses.
export function debugImageData(bytes: Buffer) {
  return Object.fromEntries(
    imageViews.map((view) => {
      if (view === 'final') return [view, 'data:image/png;base64,' + bytes.toString('base64')];
      const png = PNG.sync.read(bytes);
      debugPixels(png.data, view);
      return [view, 'data:image/png;base64,' + PNG.sync.write(png).toString('base64')];
    }),
  );
}

export function exportImageViews(input: string, output: string) {
  const bytes = readFileSync(input),
    images = debugImageData(bytes),
    out = emptyOutput(output);
  for (const [view, uri] of Object.entries(images))
    writeFileSync(join(out, view + '.png'), Buffer.from(uri.split(',')[1], 'base64'));
  const png = PNG.sync.read(bytes);
  const receipt = {
    schemaVersion: 1,
    kind: 'helix-image-debug',
    source: resolve(input),
    sha256: sha(bytes),
    width: png.width,
    height: png.height,
    views: imageViews,
    notes: imageViewNotes,
  };
  writeFileSync(join(out, 'debug.json'), JSON.stringify(receipt, null, 2));
  writeFileSync(
    join(out, 'review.html'),
    `<!doctype html><meta charset="utf-8"><title>Image debug views</title><style>body{font:16px system-ui;background:#222;color:white}img{max-width:100%}</style>${imageDebugControls()}<img id="image" src="final.png"><script>document.getElementById('image-debug-view').onchange=e=>document.getElementById('image').src=e.target.value+'.png';</script>`,
  );
  return { ...receipt, out };
}
