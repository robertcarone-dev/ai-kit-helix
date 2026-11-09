import type { PNG } from 'pngjs';

export type RGB = [number, number, number];
export type ImageRegion = { id: string; rect: [number, number, number, number] };
export type ImageFrame = { png: PNG; x: number };

export function parseRegions(value: unknown, width: number, height: number): ImageRegion[] {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('regions' in value) ||
    !Array.isArray(value.regions) ||
    value.regions.length === 0
  )
    throw new Error('Expected schemaVersion 1 and a nonempty regions array.');
  const ids = new Set<string>();
  return value.regions.map((region: unknown) => {
    if (
      typeof region !== 'object' ||
      region === null ||
      !('id' in region) ||
      typeof region.id !== 'string' ||
      !region.id.trim() ||
      !('rect' in region) ||
      !Array.isArray(region.rect)
    )
      throw new Error('Each region requires a nonempty string id and a rect array.');
    const { id, rect } = region;
    if (ids.has(id)) throw new Error('Duplicate region id: ' + id);
    if (
      rect.length !== 4 ||
      !rect.every(Number.isSafeInteger) ||
      rect[0] < 0 ||
      rect[1] < 0 ||
      rect[2] > width ||
      rect[3] > height ||
      rect[0] >= rect[2] ||
      rect[1] >= rect[3]
    )
      throw new Error('Invalid region rectangle: ' + id);
    ids.add(id);
    return { id, rect: rect as ImageRegion['rect'] };
  });
}

export function regionMean(
  frame: ImageFrame,
  [left, top, right, bottom]: ImageRegion['rect'],
): RGB {
  const { png, x } = frame;
  const sums: RGB = [0, 0, 0];
  for (let y = top; y < bottom; y++) {
    for (let i = left; i < right; i++) {
      const offset = 4 * (y * png.width + x + i);
      if (png.data[offset + 3] !== 255)
        throw new Error('Transparent pixel in sampled region. Supply the final opaque render.');
      for (let c = 0; c < 3; c++) sums[c] += png.data[offset + c];
    }
  }
  return sums.map((v) => v / ((right - left) * (bottom - top))) as RGB;
}

export function regionDifference(reference: PNG, candidate: PNG, region: ImageRegion) {
  const referenceMeanRgb = regionMean({ png: reference, x: 0 }, region.rect);
  const candidateMeanRgb = regionMean({ png: candidate, x: 0 }, region.rect);
  const [left, top, right, bottom] = region.rect;
  const pixelCount = (right - left) * (bottom - top);
  const absoluteSums: RGB = [0, 0, 0],
    maxAbsoluteDeltaRgb: RGB = [0, 0, 0];
  let changedPixels = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = 4 * (y * reference.width + x);
      let changed = false;
      for (let c = 0; c < 3; c++) {
        const delta = Math.abs(candidate.data[offset + c] - reference.data[offset + c]);
        absoluteSums[c] += delta;
        maxAbsoluteDeltaRgb[c] = Math.max(maxAbsoluteDeltaRgb[c], delta);
        changed ||= delta !== 0;
      }
      if (changed) changedPixels++;
    }
  }
  return {
    ...region,
    pixelCount,
    referenceMeanRgb,
    candidateMeanRgb,
    meanDeltaRgb: candidateMeanRgb.map((v, c) => v - referenceMeanRgb[c]) as RGB,
    changedPixels,
    changedFraction: changedPixels / pixelCount,
    meanAbsoluteDeltaRgb: absoluteSums.map((v) => v / pixelCount) as RGB,
    maxAbsoluteDeltaRgb,
  };
}
