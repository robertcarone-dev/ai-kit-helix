import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { PNG } from 'pngjs';
import { sha, emptyOutput } from './config.ts';
import { loadSnapshot } from './ui.ts';
import { requireUnchanged, writeBaseline } from './evidence-baseline.ts';

const finite = (x: any) => typeof x === 'number' && Number.isFinite(x);
const pair = (x: any) => Array.isArray(x) && x.length === 2 && x.every(finite);
const unitPair = (x: any) => pair(x) && x.every((n: number) => n >= 0 && n <= 1);
const rect = (r: any) =>
  r && ['x', 'y', 'width', 'height'].every((k) => finite(r[k])) && r.width > 0 && r.height > 0;
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const write = (p: string, v: any) =>
  writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
function list(items: any, name: string) {
  if (!Array.isArray(items) || !items.length) throw new Error(name + ' must be nonempty.');
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !/^[\w.-]+$/.test(item.id) || ids.has(item.id))
      throw new Error('Invalid or duplicate ' + name + ' id.');
    ids.add(item.id);
  }
}
function localFile(root: string, path: string) {
  if (typeof path !== 'string' || !path) throw new Error('Supply a file path.');
  const full = realpathSync(resolve(root, path));
  const r = relative(realpathSync(root), full);
  if (r.startsWith('..') || isAbsolute(r))
    throw new Error('Project input escapes checkout: ' + path);
  return full;
}
function destination(path: string) {
  if (
    typeof path !== 'string' ||
    !/^Assets\/.+\.png$/.test(path) ||
    path.split('/').some((p) => ['..', '.', ''].includes(p)) ||
    path.includes('\\')
  )
    throw new Error('Supply a project Assets PNG destination.');
}
function exactFile(path: string, hash: string) {
  const bytes = readFileSync(path);
  if (!/^[a-f0-9]{64}$/.test(hash ?? '') || sha(bytes) !== hash)
    throw new Error('Source hash mismatch: ' + path);
  return bytes;
}
function boundedImage(width: number, height: number) {
  if (
    ![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 8192) ||
    width * height > 16777216
  )
    throw new Error('Image exceeds bounded dimensions.');
}
/** Exact crop, counter-rotation and untrim. No resampling or screenshot pixels. */
export function extractFrame(source: any, spec: any) {
  boundedImage(source.width, source.height);
  const r = spec.rect ?? { x: 0, y: 0, width: source.width, height: source.height };
  if (
    !rect(r) ||
    !Object.values(r).every(Number.isInteger) ||
    r.x < 0 ||
    r.y < 0 ||
    r.x + r.width > source.width ||
    r.y + r.height > source.height
  )
    throw new Error('Invalid atlas frame rectangle.');
  if (spec.rotation !== undefined && !['none', 'cw90'].includes(spec.rotation))
    throw new Error('Unsupported atlas rotation.');
  const rotated = spec.rotation === 'cw90',
    w = rotated ? r.height : r.width,
    h = rotated ? r.width : r.height;
  const original = spec.originalSize ?? { width: w, height: h },
    offset = spec.trimOffset ?? { x: 0, y: 0 };
  boundedImage(original.width, original.height);
  if (
    ![offset.x, offset.y].every((n) => Number.isInteger(n) && n >= 0) ||
    offset.x + w > original.width ||
    offset.y + h > original.height
  )
    throw new Error('Trim exceeds original frame.');
  const out = new PNG({ width: original.width, height: original.height });
  out.data.fill(0);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = r.x + (rotated ? h - 1 - y : x),
        sy = r.y + (rotated ? x : y);
      source.data.copy(
        out.data,
        ((y + offset.y) * out.width + x + offset.x) * 4,
        (sy * source.width + sx) * 4,
        (sy * source.width + sx) * 4 + 4,
      );
    }
  return out;
}
async function decode(bytes: Buffer, session: any) {
  if (bytes.length > 33554432) throw new Error('Asset exceeds 32 MiB.');
  if (bytes.subarray(1, 4).toString() === 'PNG') {
    boundedImage(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    return PNG.sync.read(bytes);
  }
  const webp =
    bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  const jpeg = bytes[0] === 255 && bytes[1] === 216;
  if (!webp && !jpeg)
    throw new Error(
      'Only PNG, WebP and JPEG assets are supported; vector/procedural assets need a project exporter.',
    );
  const { chromium } = await import('./playwright.ts');
  if (!session.browser)
    session.browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const page = await session.browser.newPage();
  try {
    await page.route('**/*', (route) => route.abort());
    const png = await page.evaluate(
      async ({ data, mime }) => {
        const image = new Image();
        image.src = `data:${mime};base64,${data}`;
        await image.decode();
        const w = image.naturalWidth,
          h = image.naturalHeight;
        if (w < 1 || h < 1 || w > 8192 || h > 8192 || w * h > 16777216)
          throw new Error('Image exceeds bounded dimensions.');
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(image, 0, 0);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { data: bytes.toString('base64'), mime: webp ? 'image/webp' : 'image/jpeg' },
    );
    return PNG.sync.read(Buffer.from(png, 'base64'));
  } finally {
    await page.close();
  }
}
export async function uiAssets(root: string, specPath: string, out: string) {
  const specFile = localFile(root, specPath), specBytes = readFileSync(specFile), spec = JSON.parse(specBytes.toString());
  if (spec.schemaVersion !== 1) throw new Error('Expected asset spec schemaVersion 1.');
  list(spec.assets, 'assets');
  const prepared: any[] = [],
    destinations = new Set();
  const session: any = {},
    decoded = new Map();
  try {
    for (const a of spec.assets) {
      destination(a.destination);
      if (destinations.has(a.destination)) throw new Error('Duplicate asset destination.');
      destinations.add(a.destination);
      if (!unitPair(a.pivot) || !finite(a.pixelsPerUnit) || a.pixelsPerUnit <= 0)
        throw new Error('Explicit Unity pivot and pixelsPerUnit required.');
      if (typeof a.source !== 'string') throw new Error('Local source file required.');
      const path = realpathSync(resolve(root, a.source)); // Explicit local input may be in the discovered reference checkout.
      const bytes = exactFile(path, a.sha256);
      if (!decoded.has(a.sha256)) decoded.set(a.sha256, await decode(bytes, session));
      const image = extractFrame(decoded.get(a.sha256), a);
      const border = a.border;
      if (
        !Array.isArray(border) ||
        border.length !== 4 ||
        !border.every((n: any) => finite(n) && n >= 0) ||
        border[0] + border[2] > image.width ||
        border[1] + border[3] > image.height
      )
        throw new Error('Explicit border [left,bottom,right,top] must fit image.');
      const png = PNG.sync.write(image);
      prepared.push({
        a,
        png,
        metadata: {
          id: a.id,
          source: join(resolve(out), a.id + '.png'),
          sha256: sha(png),
          destination: a.destination,
          pixelsPerUnit: a.pixelsPerUnit,
          pivot: a.pivot,
          border,
          provenance: {
            file: path,
            sha256: sha(bytes),
            rect: a.rect ?? null,
            rotation: a.rotation ?? 'none',
            trimOffset: a.trimOffset ?? null,
            originalSize: { width: image.width, height: image.height },
            decodedWith: bytes.subarray(1, 4).toString() === 'PNG' ? 'pngjs' : 'chromium-canvas',
          },
        },
      });
    }
  } finally {
    if (session.browser) await session.browser.close();
  }
  const dependencies = [{ path: specFile, sha256: sha(specBytes) }, ...prepared.map(p => ({ path: p.metadata.provenance.file, sha256: p.metadata.provenance.sha256 }))];
  requireUnchanged(dependencies);
  emptyOutput(out);
  for (const p of prepared) writeFileSync(join(out, p.a.id + '.png'), p.png, { flag: 'wx' });
  const result = {
    schemaVersion: 1,
    projectRoot: realpathSync(root),
    assets: prepared.map((p) => p.metadata),
    limitations: [
      'No game assets imported. Review destination, pivot, border and pixel density before Unity apply.',
    ],
  };
  const receiptPath = join(resolve(out), 'imports.json');
  write(receiptPath, result);
  const receipt = { path: receiptPath, sha256: sha(readFileSync(receiptPath)) };
  const baselines = prepared.map(p => writeBaseline(join(resolve(out), p.a.id + '.baseline.json'), 'ui-assets',
    { path: p.metadata.source, sha256: p.metadata.sha256 }, receipt,
    [{ path: specFile, sha256: sha(specBytes) }, { path: p.metadata.provenance.file, sha256: p.metadata.provenance.sha256 }]));
  return { ...result, baselines };
}
/** Native top-left bounds to an explicitly chosen fixed-anchor parent-local RectTransform. */
export function layoutFor(bounds: any, parent: any, anchor: any, pivot: any) {
  if (
    !rect(bounds) ||
    !rect(parent?.bounds) ||
    parent.axisAligned !== true ||
    !finite(parent.unitsPerPixel) ||
    parent.unitsPerPixel <= 0 ||
    !unitPair(anchor) ||
    !unitPair(pivot)
  )
    throw new Error(
      'Explicit axis-aligned parent bounds, unitsPerPixel, anchor and pivot required.',
    );
  const p = parent.bounds,
    u = parent.unitsPerPixel;
  return {
    anchorMin: anchor,
    anchorMax: anchor,
    pivot,
    anchoredPosition: [
      (bounds.x - p.x + bounds.width * pivot[0] - p.width * anchor[0]) * u,
      (p.height - (bounds.y - p.y) - bounds.height * (1 - pivot[1]) - p.height * anchor[1]) * u,
    ],
    sizeDelta: [bounds.width * u, bounds.height * u],
  };
}
function selected(snapshot: any, id: string) {
  const nodes = snapshot.nodes.filter((n: any) => n.semanticId === id);
  if (nodes.length !== 1 || snapshot.bindingErrors?.some((e: any) => e.id === id))
    throw new Error('Expected one valid semantic binding for ' + id);
  return nodes[0];
}
function lookup(o: any, path: string) {
  return path.split('.').reduce((v, k) => v?.[k], o);
}
export function typography(reference: any, candidate: any) {
  const findings: any[] = [];
  if (!reference && !candidate) return findings;
  for (const key of [
    'value',
    'family',
    'lineCount',
    'lines',
    'baseline',
    'baselines',
    'fontSize',
    'fontStyle',
    'characterSpacing',
    'lineSpacing',
  ]) {
    const a = reference?.[key],
      b = candidate?.[key];
    if (a == null || b == null) findings.push({ field: key, status: 'unmeasured' });
    else if (!isDeepStrictEqual(a, b))
      findings.push({ field: key, status: 'difference', reference: a, candidate: b });
  }
  findings.push({
    field: 'rasterization-and-fallback',
    status: 'unmeasured',
    reason:
      'Font-size units, baseline and material effects require engine-specific inspection; no automatic font substitution.',
  });
  return findings;
}
export function uiPlan(root: string, specPath: string, out: string) {
  const spec = json(localFile(root, specPath));
  if (
    spec.schemaVersion !== 1 ||
    !Array.isArray(spec.stateKeys) ||
    !spec.stateKeys.length ||
    !spec.stateKeys.every((x: any) => typeof x === 'string' && x)
  )
    throw new Error('Plan needs schemaVersion 1 and explicit stateKeys.');
  list(spec.elements, 'elements');
  list(spec.samples, 'samples');
  const samples = spec.samples.map((s: any) => ({
    ...s,
    reference: loadSnapshot(localFile(root, s.reference)),
    candidate: loadSnapshot(localFile(root, s.candidate)),
  }));
  for (const s of samples) {
    const a = s.reference.ui,
      b = s.candidate.ui;
    if (
      a.coordinateSpace !== 'native-top-left-pixels' ||
      b.coordinateSpace !== a.coordinateSpace ||
      a.truncated ||
      b.truncated ||
      a.viewport.dpr !== 1 ||
      b.viewport.dpr !== 1 ||
      a.viewport.zoom !== 1 ||
      b.viewport.zoom !== 1 ||
      !isDeepStrictEqual(a.viewport, b.viewport) ||
      !isDeepStrictEqual(a.safeArea, b.safeArea)
    )
      throw new Error('Match complete native viewport and safe-area snapshots.');
    for (const k of spec.stateKeys)
      if (
        lookup(a.state, k) === undefined ||
        !isDeepStrictEqual(lookup(a.state, k), lookup(b.state, k))
      )
        throw new Error('Mismatched state: ' + k);
  }
  const controllerTypes = spec.controllerTypes ?? [];
  if (
    !Array.isArray(controllerTypes) ||
    !controllerTypes.every((t: any) => typeof t === 'string' && t)
  )
    throw new Error('controllerTypes must be type names.');
  const operations: any[] = [],
    findings: any[] = [],
    targets = new Set();
  for (const e of spec.elements) {
    const target = e.unity;
    if (
      !target ||
      typeof target.prefab !== 'string' ||
      !target.prefab.startsWith('Assets/') ||
      !target.prefab.endsWith('.prefab') ||
      typeof target.target !== 'string'
    )
      throw new Error('Explicit Unity prefab and relative target required.');
    const key = target.prefab + '#' + target.target;
    if (targets.has(key)) throw new Error('Duplicate Unity target.');
    targets.add(key);
    const inspection = json(localFile(root, target.inspection));
    const prefab = localFile(root, target.prefab);
    if (
      inspection.prefab !== target.prefab ||
      inspection.prefabSha256 !== sha(readFileSync(prefab))
    )
      throw new Error('Stale prefab inspection: ' + target.prefab);
    const inspected = inspection.nodes.filter((n: any) => n.target === target.target);
    if (inspected.length !== 1) throw new Error('Ambiguous prefab inspection target.');
    const node = inspected[0],
      proposals: any[] = [];
    const problem = (reason: string) => findings.push({ id: e.id, status: 'blocked', reason });
    if (
      node.nested ||
      node.controllers?.length ||
      controllerTypes.some((t: string) => node.componentTypes?.includes(t))
    )
      problem(
        'Target has nested ownership or driven properties; edit its source/controller explicitly.',
      );
    for (const s of samples) {
      try {
        const a = selected(s.reference.ui, e.id),
          b = selected(s.candidate.ui, e.id);
        for (const f of typography(a.text, b.text))
          findings.push({ id: e.id, sample: s.id, kind: 'typography', ...f });
        if (a.visible !== true || b.visible !== true)
          throw new Error('Target must be visible on both sides.');
        if (a.layout?.rotation && Math.abs(a.layout.rotation) > 1e-6)
          throw new Error('Rotated source needs a project conversion.');
        proposals.push(layoutFor(a.bounds, s.parents?.[e.id], e.anchor, e.pivot));
      } catch (error) {
        problem((error as Error).message);
      }
    }
    const viewports = new Set(
      samples.map((s: any) => `${s.reference.ui.viewport.width}x${s.reference.ui.viewport.height}`),
    );
    if (viewports.size < 2)
      problem('At least two distinct viewports are required to validate the explicit anchor rule.');
    const tolerance = e.toleranceUnits;
    if (!finite(tolerance) || tolerance < 0)
      throw new Error('Explicit nonnegative toleranceUnits required.');
    if (
      proposals.length &&
      proposals.some((p) =>
        ['anchoredPosition', 'sizeDelta'].some((k) =>
          p[k].some((v: number, i: number) => Math.abs(v - proposals[0][k][i]) > tolerance),
        ),
      )
    )
      problem('Samples disagree with this fixed-anchor rule; inspect responsive source layout.');
    if (!findings.some((f) => f.id === e.id && f.status === 'blocked')) {
      const expected = node.layout;
      for (const k of ['anchorMin', 'anchorMax', 'pivot', 'anchoredPosition', 'sizeDelta'])
        if (!pair(expected?.[k])) throw new Error('Incomplete prefab baseline.');
      operations.push({
        id: e.id,
        prefab: target.prefab,
        prefabSha256: inspection.prefabSha256,
        target: target.target,
        expected,
        set: { ...proposals[0], ...(e.sprite ? { sprite: e.sprite } : {}) },
      });
    }
  }
  let assets: any[] = [];
  if (spec.imports) {
    const imports = json(localFile(root, spec.imports));
    if (imports.schemaVersion !== 1 || imports.projectRoot !== realpathSync(root))
      throw new Error('Asset imports belong to another project.');
    list(imports.assets, 'assets');
    assets = imports.assets;
    for (const a of assets) {
      destination(a.destination);
      exactFile(localFile(root, a.source), a.sha256);
    }
  }
  const states = spec.states ?? [];
  if (states.length) {
    list(states, 'states');
    for (const s of states)
      if (
        typeof s.reference !== 'string' ||
        typeof s.unity !== 'string' ||
        !['fixture', 'input'].includes(s.kind) ||
        typeof s.trigger !== 'string' ||
        !s.trigger
      )
        throw new Error(
          'States require explicit reference, Unity state, trigger and fixture/input kind.',
        );
  }
  const inputs = Object.fromEntries(
    [
      specPath,
      ...spec.samples.flatMap((s: any) => [s.reference, s.candidate]),
      ...spec.elements.flatMap((e: any) => [e.unity.prefab, e.unity.inspection]),
      ...(spec.imports ? [spec.imports] : []),
    ].map((p: string) => [p, sha(readFileSync(localFile(root, p)))]),
  );
  const plan = {
    schemaVersion: 1,
    projectRoot: realpathSync(root),
    controllerTypes,
    operations,
    assets,
  };
  const report = {
    schemaVersion: 1,
    status: findings.some((f) => f.status === 'blocked') ? 'partial' : 'planned',
    operations: operations.length,
    findings,
    inputs,
    limitations: [
      'Plan validates supplied mappings, not visual acceptance. Fixed axis-aligned anchors only; no inferred callbacks, font replacement or animation conversion.',
    ],
  };
  emptyOutput(out);
  write(join(out, 'plan.json'), plan);
  write(join(out, 'report.json'), report);
  write(join(out, 'state-contract.json'), {
    schemaVersion: 1,
    states: states.map((state: any) => ({
      ...state,
      samples: spec.samples
        .filter((sample: any) => sample.stateId === state.id)
        .map((sample: any) => sample.id),
      status:
        state.unity === 'UNMAPPED'
          ? 'blocked'
          : spec.samples.some((sample: any) => sample.stateId === state.id)
            ? 'observed-not-accepted'
            : 'unmeasured',
    })),
    runtimeBindings: 'project-owned',
    acceptance: 'unmeasured',
  });
  return {
    ...report,
    plan: join(resolve(out), 'plan.json'),
    planSha256: sha(readFileSync(join(out, 'plan.json'))),
  };
}
export function uiImpact(
  root: string,
  specPath: string,
  previousPath: string | undefined,
  out: string,
) {
  const spec = json(localFile(root, specPath));
  if (spec.schemaVersion !== 1) throw new Error('Expected case spec schemaVersion 1.');
  list(spec.cases, 'cases');
  const previous = previousPath ? json(localFile(root, previousPath)) : null;
  if (
    previous &&
    (previous.schemaVersion !== 1 ||
      previous.projectRoot !== realpathSync(root) ||
      !Array.isArray(previous.cases))
  )
    throw new Error('Previous case receipt belongs to another checkout/schema.');
  const cases = spec.cases.map((c: any) => {
    if (
      !Array.isArray(c.inputs) ||
      !c.inputs.length ||
      !c.inputs.every((p: any) => typeof p === 'string')
    )
      throw new Error('Every case needs declared input files.');
    const inputs = Object.fromEntries(
      c.inputs.map((p: string) => [p, sha(readFileSync(localFile(root, p)))]),
    );
    const evidence = Object.fromEntries(
      (c.evidence ?? []).map((p: string) => [p, sha(readFileSync(localFile(root, p)))]),
    );
    const prior = previous?.cases.find((x: any) => x.id === c.id),
      contractHash = sha(JSON.stringify(c));
    const reusable =
      prior &&
      prior.contractHash === contractHash &&
      isDeepStrictEqual(prior.inputs, inputs) &&
      Object.keys(evidence).length > 0 &&
      isDeepStrictEqual(prior.evidence, evidence);
    return {
      id: c.id,
      contractHash,
      inputs,
      evidence,
      status: reusable ? 'reusable' : 'needs-validation',
      reason: reusable
        ? 'Declared inputs and evidence bytes unchanged.'
        : 'New/changed case, inputs or evidence; validation required.',
    };
  });
  const result = {
    schemaVersion: 1,
    projectRoot: realpathSync(root),
    cases,
    limitations: [
      'Reuse checks declared dependencies only; missing dependencies cannot be inferred. Reuse is not a new acceptance verdict.',
    ],
  };
  emptyOutput(out);
  write(join(out, 'impact.json'), result);
  return result;
}
