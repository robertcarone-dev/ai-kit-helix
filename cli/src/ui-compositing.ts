import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { emptyOutput, root, sha } from './config.ts';
import { regionMean, type RGB, type ImageRegion, type ImageFrame } from './image-regions.ts';

type Pin = { sha256: string; path?: string; attachment?: string };
type Region = ImageRegion;
type View = { width: number; height: number; regions: Region[] };
type Case = {
  id: string;
  viewport: string;
  state: string;
  phase: { helix: string; unity: string };
  phaseException?: string;
  pair?: Pin;
  helix?: Pin;
  unity?: Pin;
  background?: { helix?: Pin; unity?: Pin };
};
type Binding = { prefab: string; target: string; component: string; field: string; receipt: Pin };
type Spec = {
  schemaVersion: number;
  tolerance: number;
  overlay: Binding;
  viewports: Record<string, View>;
  cases: Case[];
};
type Frame = ImageFrame;

function inside(base: string, name: string) {
  const path = realpathSync(resolve(base, name));
  const rel = relative(realpathSync(base), path);
  if (isAbsolute(name) || !rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel))
    throw new Error('Expected file inside evidence root: ' + name);
  return path;
}

function bytes(pin: Pin) {
  if (Boolean(pin.path) === Boolean(pin.attachment))
    throw new Error('Pin one project file or one board attachment.');
  let file: string;
  if (pin.attachment) {
    const match = /^([A-Za-z][A-Za-z0-9]*-\d+)#a\d+$/.exec(pin.attachment);
    if (!match) throw new Error('Invalid board attachment: ' + pin.attachment);
    const marker = join(root, '.aikit/lane.json');
    const owner = existsSync(marker) ? JSON.parse(readFileSync(marker, 'utf8')).owner : root;
    const folder = inside(owner, '.aikit/assistant/issues/' + match[1]);
    const issue = JSON.parse(readFileSync(inside(folder, 'issue.json'), 'utf8'));
    const records = issue.attachments.filter((a: any) => a.id === pin.attachment);
    if (issue.key !== match[1] || records.length !== 1 || records[0].sha256 !== pin.sha256)
      throw new Error('Board attachment identity or digest differs: ' + pin.attachment);
    file = inside(inside(folder, 'attachments'), records[0].file);
  } else file = inside(root, pin.path!);
  const data = readFileSync(file);
  if (sha(data) !== pin.sha256) throw new Error('Evidence digest differs: ' + file);
  return data;
}

function png(pin: Pin, width: number, height: number) {
  const data = bytes(pin);
  const image = PNG.sync.read(data);
  if (data[24] !== 8 || image.width !== width || image.height !== height)
    throw new Error('Expected native 8-bit PNG of size ' + width + ' × ' + height);
  return image;
}

function ownership(binding: Binding) {
  const receipt = JSON.parse(bytes(binding.receipt).toString());
  if (
    receipt.schemaVersion !== 1 ||
    (['prefab', 'target', 'component', 'field'] as const).some((k) => receipt[k] !== binding[k]) ||
    !receipt.prefabSources?.length ||
    receipt.prefabSources[0] !== binding.prefab ||
    !receipt.prefabSources.every((p: string) => receipt.assetHashes[p])
  )
    throw new Error('Overlay inspection does not match the requested component and field.');
  const fields = ['r', 'g', 'b', 'a'].map((channel) => {
    const source = receipt.channels[channel];
    if (
      source.sources[0].prefab !== binding.prefab ||
      source.owner !== source.sources.at(-1).prefab ||
      !source.sources.every((s: any) => receipt.assetHashes[s.prefab])
    )
      throw new Error('Incomplete overlay channel source chain.');
    return {
      property: binding.field + '.' + channel,
      prefab: source.owner,
      target: source.sources.at(-1).target,
    };
  });
  const stale = Object.entries(receipt.assetHashes)
    .filter(
      ([path, hash]) =>
        !existsSync(resolve(root, path)) || sha(readFileSync(inside(root, path))) !== hash,
    )
    .map(([path]) => path);
  return {
    status: stale.length ? 'stale' : 'serialized-owner',
    stale,
    fields: stale.length ? [] : fields,
    inspection: receipt,
    scope:
      'Serialized prefab configuration. Runtime camera assignment, animations and presenter writes require live evidence.',
  };
}

const delta = (a: RGB, b: RGB): RGB => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function regionMap(helix: Frame, unity: Frame, { width, height, regions }: View) {
  const map = new PNG({ width: width * 2, height });
  for (const [side, frame] of [helix, unity].entries()) {
    const offset = side * width;
    PNG.bitblt(frame.png, map, frame.x, 0, width, height, offset, 0);
    for (const {
      rect: [left, top, right, bottom],
    } of regions) {
      const mark = (x: number, y: number) =>
        map.data.writeUInt32BE(0x00ffffff, 4 * (y * map.width + offset + x));
      for (let x = left; x < right; x++) {
        mark(x, top);
        mark(x, bottom - 1);
      }
      for (let y = top; y < bottom; y++) {
        mark(left, y);
        mark(right - 1, y);
      }
    }
  }
  return PNG.sync.write(map);
}

function compare(c: Case, view: View, tolerance: number) {
  const { width, height, regions } = view;
  if (
    ![width, height].every((n) => Number.isSafeInteger(n) && n > 0) ||
    !regions.length ||
    !c.state ||
    !c.phase?.helix ||
    !c.phase.unity
  )
    throw new Error('Declare viewport, regions, matched scene state and both capture phases.');
  if (c.phase.helix !== c.phase.unity && !c.phaseException?.trim())
    throw new Error('Different capture phases require an explicit region-specific scope: ' + c.id);
  let helix: Frame, unity: Frame;
  if (c.pair) {
    if (c.helix || c.unity) throw new Error('Supply a native pair or separate captures.');
    const image = png(c.pair, width * 2, height);
    helix = { png: image, x: 0 };
    unity = { png: image, x: width };
  } else {
    if (!c.helix || !c.unity) throw new Error('Both captures are required.');
    helix = { png: png(c.helix, width, height), x: 0 };
    unity = { png: png(c.unity, width, height), x: 0 };
  }
  const background = (pin?: Pin) => (pin ? { png: png(pin, width, height), x: 0 } : undefined);
  const baseH = background(c.background?.helix),
    baseU = background(c.background?.unity);
  const measurements = regions.map((region) => {
    const rect = region.rect;
    if (
      !region.id ||
      rect.length !== 4 ||
      !rect.every(Number.isSafeInteger) ||
      rect[0] < 0 ||
      rect[1] < 0 ||
      rect[2] > width ||
      rect[3] > height ||
      rect[0] >= rect[2] ||
      rect[1] >= rect[3]
    )
      throw new Error('Invalid region: ' + region.id);
    const h = regionMean(helix, rect),
      u = regionMean(unity, rect),
      difference = delta(u, h);
    const backgroundHelix = baseH ? regionMean(baseH, rect) : null;
    const backgroundUnity = baseU ? regionMean(baseU, rect) : null;
    const hChange = backgroundHelix ? delta(h, backgroundHelix) : null;
    const uChange = backgroundUnity ? delta(u, backgroundUnity) : null;
    const maxAbs = Math.max(...difference.map(Math.abs));
    return {
      ...region,
      helixRGB: h,
      unityRGB: u,
      unityMinusHelix: difference,
      maxAbs,
      status: maxAbs <= tolerance ? 'within-tolerance' : 'difference',
      backgroundRGB: { helix: backgroundHelix, unity: backgroundUnity },
      overlayMinusBackground: { helix: hChange, unity: uChange },
      effectDifference: uChange && hChange ? delta(uChange, hChange) : null,
    };
  });
  if (new Set(regions.map((r) => r.id)).size !== regions.length)
    throw new Error('Duplicate region in ' + c.viewport);
  return {
    ...c,
    map: regionMap(helix, unity, view),
    measurements,
    worstMaxAbs: Math.max(...measurements.map((m) => m.maxAbs)),
    status: measurements.every((m) => m.status === 'within-tolerance')
      ? 'within-tolerance'
      : 'difference',
  };
}

export function uiCompositing(specPath: string, output: string) {
  const raw = readFileSync(specPath),
    spec: Spec = JSON.parse(raw.toString());
  if (
    spec.schemaVersion !== 1 ||
    !Number.isFinite(spec.tolerance) ||
    spec.tolerance < 0 ||
    spec.tolerance > 255 ||
    !spec.cases?.length ||
    new Set(spec.cases.map((c) => c.id)).size !== spec.cases.length
  )
    throw new Error(
      'Expected schemaVersion 1, distinct cases and a channel tolerance from 0 to 255.',
    );
  const owner = ownership(spec.overlay);
  const comparisons = spec.cases.map((c) => {
    if (!c.id || !Object.hasOwn(spec.viewports, c.viewport))
      throw new Error('Missing case ID or unknown viewport.');
    return compare(c, spec.viewports[c.viewport], spec.tolerance);
  });
  const out = emptyOutput(output),
    reportPath = join(out, 'compositing.json');
  const cases = comparisons.map(({ map, ...result }, index) => {
    const regionImage = 'regions-' + (index + 1) + '.png';
    writeFileSync(join(out, regionImage), map);
    return { ...result, regionImage };
  });
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        specSha256: sha(raw),
        method:
          'Arithmetic mean of encoded 8-bit RGB per half-open top-left rectangle; signed delta is Unity minus Helix.',
        tolerance: spec.tolerance,
        ownership: owner,
        cases,
      },
      null,
      2,
    ),
  );
  return {
    reportPath,
    ownership: owner.status,
    fields: owner.fields,
    cases: cases.map(({ id, status, worstMaxAbs }) => ({ id, status, worstMaxAbs })),
  };
}
