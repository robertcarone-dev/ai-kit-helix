import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { PNG } from 'pngjs';
import { emptyOutput, sha } from './config.ts';

export const get = (o: any, path: string): any => path.split('.').reduce((v, k) => v?.[k], o);
const missing = (v: any) => v === undefined || v === null;
const rect = (b: any) =>
  b &&
  ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(b[k])) &&
  b.width >= 0 &&
  b.height >= 0;
export const escape = (v: any) =>
  String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function select(nodes: any[], selector: any) {
  if (!selector || !Object.keys(selector).length)
    throw new Error('An element selector must not be empty.');
  const allowed = ['name', 'path', 'id', 'semanticId', 'kind', 'scene', 'type'];
  for (const k of Object.keys(selector))
    if (!allowed.includes(k) || typeof selector[k] !== 'string')
      throw new Error('Invalid selector field ' + k);
  return nodes.filter((n) => Object.entries(selector).every(([k, v]) => n[k] === v));
}

/** Require explicit element selectors and state keys before comparing measurements. */
export function validateSpec(spec: any) {
  if (spec?.schemaVersion !== 1 || !Array.isArray(spec.elements) || !spec.elements.length)
    throw new Error('UI spec needs schemaVersion:1 and nonempty elements.');
  const ids = new Set();
  for (const e of spec.elements) {
    if (typeof e.id !== 'string' || !e.id || ids.has(e.id))
      throw new Error('Element IDs must be unique nonempty strings.');
    ids.add(e.id);
    if (e.visualBindings !== undefined) {
      if (!Array.isArray(e.visualBindings))
        throw new Error('Expected visualBindings array: ' + e.id);
      for (const binding of e.visualBindings) {
        if (
          !binding ||
          typeof binding.prefab !== 'string' ||
          !binding.prefab.startsWith('Assets/') ||
          !binding.prefab.endsWith('.prefab') ||
          typeof binding.target !== 'string' ||
          typeof binding.component !== 'string' ||
          !binding.component ||
          typeof binding.field !== 'string' ||
          !binding.field ||
          !['font', 'sprite', 'material'].includes(binding.kind)
        )
          throw new Error('Invalid prefab visual binding: ' + e.id);
      }
    }
    select([], e.reference);
    select([], e.candidate);
    for (const c of e.checks ?? []) {
      if (typeof c.path !== 'string' || !c.path) throw new Error('Check needs a property path.');
      if (
        c.expected &&
        (!Object.hasOwn(c.expected, 'reference') ||
          !Object.hasOwn(c.expected, 'candidate') ||
          c.expected.reference === null ||
          c.expected.candidate === null)
      )
        throw new Error('Expected mappings need non-null reference and candidate values.');
      for (const k of ['referencePath', 'candidatePath'])
        if (c[k] !== undefined && (typeof c[k] !== 'string' || !c[k]))
          throw new Error('Invalid check path.');
      if (c.tolerance !== undefined && (!Number.isFinite(c.tolerance) || c.tolerance < 0))
        throw new Error('Tolerance must be finite and nonnegative.');
    }
    if (
      e.boundsTolerance !== undefined &&
      (!Number.isFinite(e.boundsTolerance) || e.boundsTolerance < 0)
    )
      throw new Error('Bounds tolerance must be finite and nonnegative.');
  }
  for (const g of spec.relations ?? []) {
    if (
      !ids.has(g.from) ||
      !ids.has(g.to) ||
      !['gapX', 'gapY', 'left', 'top', 'centerX', 'centerY'].includes(g.metric) ||
      !Number.isFinite(g.tolerance) ||
      g.tolerance < 0
    )
      throw new Error('Invalid element relation.');
  }
  if (
    !Array.isArray(spec.stateKeys) ||
    !spec.stateKeys.length ||
    spec.stateKeys.some((k: any) => typeof k !== 'string' || !k)
  )
    throw new Error('Specify nonempty stateKeys to establish equivalent state.');
  return spec;
}
// Missing observations stay unmeasured, even when both sides are missing.
function measure(a: any, b: any, tolerance?: number) {
  if (missing(a) || missing(b))
    return {
      status: 'unmeasured',
      reference: a ?? null,
      candidate: b ?? null,
      reason: 'A required property is unavailable.',
    };
  if (tolerance !== undefined) {
    if (!Number.isFinite(a) || !Number.isFinite(b))
      return {
        status: 'unmeasured',
        reason: 'Numeric measurement required.',
        reference: a,
        candidate: b,
      };
    return {
      status: Math.abs(b - a) <= tolerance ? 'passed' : 'difference',
      reference: a,
      candidate: b,
      delta: b - a,
      tolerance,
    };
  }
  return { status: isDeepStrictEqual(a, b) ? 'passed' : 'difference', reference: a, candidate: b };
}
// A stronger failure takes precedence; an empty set of checks cannot pass.
export function disposition(rows: any[]) {
  return rows.some((r) => r.status === 'blocked')
    ? 'blocked'
    : rows.some((r) => r.status === 'difference')
      ? 'difference'
      : rows.some((r) => r.status === 'unmeasured') || !rows.length
        ? 'unmeasured'
        : 'passed';
}

/** Compare selected criteria only after coordinate, viewport, safe-area and state checks pass. */
export function compareSnapshots(reference: any, candidate: any, spec: any) {
  validateSpec(spec);
  const prerequisites: any[] = [];
  const requireEqual = (path: string, a: any, b: any) =>
    prerequisites.push({ path, ...measure(a, b) });
  for (const [side, snapshot] of [
    ['reference', reference],
    ['candidate', candidate],
  ] as const) {
    if (
      snapshot?.schemaVersion !== 1 ||
      !Array.isArray(snapshot.nodes) ||
      !Number.isInteger(snapshot.viewport?.width) ||
      !Number.isInteger(snapshot.viewport?.height) ||
      snapshot.viewport.width <= 0 ||
      snapshot.viewport.height <= 0 ||
      !rect(snapshot.safeArea)
    )
      throw new Error('Invalid ' + side + ' UI snapshot schema, viewport or safe area.');
    if (
      snapshot.safeArea.x < 0 ||
      snapshot.safeArea.y < 0 ||
      snapshot.safeArea.x + snapshot.safeArea.width > snapshot.viewport.width ||
      snapshot.safeArea.y + snapshot.safeArea.height > snapshot.viewport.height
    )
      throw new Error('Safe area lies outside ' + side + ' viewport.');
  }
  requireEqual('coordinateSpace', reference.coordinateSpace, candidate.coordinateSpace);
  if (
    reference.coordinateSpace !== 'native-top-left-pixels' ||
    candidate.coordinateSpace !== 'native-top-left-pixels'
  )
    prerequisites.push({
      path: 'coordinateSpace.supported',
      status: 'blocked',
      reason: 'Only native top-left pixel measurements are supported.',
    });
  for (const k of ['width', 'height'])
    requireEqual('viewport.' + k, reference.viewport?.[k], candidate.viewport?.[k]);
  for (const k of spec.stateKeys) {
    const a = get(reference.state, k),
      b = get(candidate.state, k);
    prerequisites.push({
      path: 'state.' + k,
      ...(a === null && b === null
        ? { status: 'passed', reference: null, candidate: null }
        : measure(a, b)),
    });
  }
  for (const k of ['x', 'y', 'width', 'height'])
    requireEqual('safeArea.' + k, reference.safeArea?.[k], candidate.safeArea?.[k]);
  if (spec.checkpoint) {
    requireEqual('checkpoint.reference', reference.checkpoint, spec.checkpoint);
    requireEqual('checkpoint.candidate', candidate.checkpoint, spec.checkpoint);
  }
  const valid = prerequisites.every((r) => r.status === 'passed');
  const pairs = new Map<string, any>();
  const elements = spec.elements.map((e: any) => {
    const a = select(reference.nodes ?? [], e.reference),
      b = select(candidate.nodes ?? [], e.candidate);
    const checks: any[] = [];
    const bindingErrors = [
      ...(reference.bindingErrors ?? []).filter((x: any) => x.id === e.reference.semanticId),
      ...(candidate.bindingErrors ?? []).filter((x: any) => x.id === e.candidate.semanticId),
    ];
    if (bindingErrors.length)
      checks.push({
        path: 'binding',
        status: 'blocked',
        reason: 'Runtime binding failed.',
        errors: bindingErrors,
      });
    if (a.length !== 1 || b.length !== 1)
      checks.push({
        path: 'selector',
        status:
          a.length > 1 || b.length > 1
            ? 'blocked'
            : reference.truncated || candidate.truncated
              ? 'unmeasured'
              : 'difference',
        reason: `Expected one match on each side; found ${a.length} reference, ${b.length} candidate.`,
      });
    else {
      pairs.set(e.id, { a: a[0], b: b[0] });
      if (!rect(a[0].bounds) || !rect(b[0].bounds))
        checks.push({
          path: 'bounds',
          status: 'unmeasured',
          reason: 'Finite nonnegative bounds are required.',
        });
      else
        for (const k of ['x', 'y', 'width', 'height'])
          checks.push({
            path: 'bounds.' + k,
            unit: 'px',
            ...measure(a[0].bounds[k], b[0].bounds[k], e.boundsTolerance ?? 0),
          });
      checks.push({ path: 'visible', ...measure(a[0].visible, b[0].visible) });
      for (const check of e.checks ?? []) {
        const av = get(a[0], check.referencePath ?? check.path),
          bv = get(b[0], check.candidatePath ?? check.path);
        if (check.expected) {
          for (const side of ['reference', 'candidate'])
            checks.push({
              path: check.path,
              side,
              unit: check.unit ?? null,
              ...measure(side === 'reference' ? av : bv, check.expected[side], check.tolerance),
            });
        } else
          checks.push({
            path: check.path,
            unit: check.unit ?? null,
            ...measure(av, bv, check.tolerance),
          });
      }
    }
    return {
      id: e.id,
      reference: a.length === 1 ? a[0] : null,
      candidate: b.length === 1 ? b[0] : null,
      checks,
      status: valid ? disposition(checks) : 'blocked',
    };
  });
  const metric = (a: any, b: any, m: string) =>
    m === 'gapX'
      ? b.x - a.x - a.width
      : m === 'gapY'
        ? b.y - a.y - a.height
        : m === 'left'
          ? b.x - a.x
          : m === 'top'
            ? b.y - a.y
            : m === 'centerX'
              ? b.x + b.width / 2 - a.x - a.width / 2
              : b.y + b.height / 2 - a.y - a.height / 2;
  const relations = (spec.relations ?? []).map((g: any) => {
    const a = pairs.get(g.from),
      b = pairs.get(g.to);
    const ok = a && b && [a.a.bounds, a.b.bounds, b.a.bounds, b.b.bounds].every(rect);
    const row = {
      ...g,
      unit: 'px',
      ...measure(
        ok ? metric(a.a.bounds, b.a.bounds, g.metric) : null,
        ok ? metric(a.b.bounds, b.b.bounds, g.metric) : null,
        g.tolerance,
      ),
    };
    if (!valid) row.status = 'blocked';
    return row;
  });
  return {
    schemaVersion: 1,
    status: valid ? disposition([...elements, ...relations]) : 'blocked',
    prerequisites,
    elements,
    relations,
    notes: [
      'Passed means the specified measurable criteria passed, not whole-screen visual parity.',
      'Bounds are layout bounds; clipping, occlusion, font identity and interaction require their own evidence.',
    ],
  };
}

/** Verify the receipt against its PNG before trusting the attached UI measurements. */
export function loadSnapshot(path: string) {
  const receipt = JSON.parse(readFileSync(path, 'utf8'));
  const ui = receipt.ui;
  if (!ui || ui.schemaVersion !== 1) throw new Error('Receipt has no v1 UI snapshot: ' + path);
  const imagePath = resolve(dirname(path), receipt.image ?? receipt.capturePath ?? '');
  const bytes = readFileSync(imagePath),
    png = PNG.sync.read(bytes);
  if (receipt.sha256 !== sha(bytes)) throw new Error('Receipt/image hash mismatch: ' + path);
  if (png.width !== ui.viewport?.width || png.height !== ui.viewport?.height)
    throw new Error('Snapshot/image dimensions differ: ' + path);
  for (const field of ['native', 'rendered'])
    if (
      receipt[field] &&
      (receipt[field].width !== png.width || receipt[field].height !== png.height)
    )
      throw new Error('Receipt ' + field + ' dimensions disagree: ' + path);
  if (receipt.ready === false || receipt.identity?.reference?.previewOverride === true)
    throw new Error('Capture readiness or reference identity is unverified: ' + path);
  if (receipt.state !== undefined && !isDeepStrictEqual(receipt.state, ui.state))
    throw new Error('Receipt and snapshot state disagree: ' + path);
  if (receipt.errors?.length) throw new Error('Capture contains runtime errors: ' + path);
  return { receipt, ui, png, bytes, imagePath };
}

export function writeNativeCrop(out: string, png: PNG, bounds: any, name: string) {
  if (!rect(bounds)) return null;
  const x = Math.max(0, Math.floor(bounds.x) - 6),
    y = Math.max(0, Math.floor(bounds.y) - 6),
    right = Math.min(png.width, Math.ceil(bounds.x + bounds.width) + 6),
    bottom = Math.min(png.height, Math.ceil(bounds.y + bounds.height) + 6);
  if (right <= x || bottom <= y) return null;
  const image = new PNG({ width: right - x, height: bottom - y });
  PNG.bitblt(png, image, x, y, right - x, bottom - y, 0, 0);
  writeFileSync(join(out, name), PNG.sync.write(image));
  return name;
}

/** Write a review bundle with provenance, native crops and per-criterion results. */
export function compareUI(
  referencePath: string,
  candidatePath: string,
  specPath: string,
  outPath: string,
) {
  const a = loadSnapshot(referencePath),
    b = loadSnapshot(candidatePath),
    spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const report: any = compareSnapshots(a.ui, b.ui, spec);
  report.provenance = {
    reference: {
      receipt: resolve(referencePath),
      sha256: sha(readFileSync(referencePath)),
      imageSha256: sha(a.bytes),
    },
    candidate: {
      receipt: resolve(candidatePath),
      sha256: sha(readFileSync(candidatePath)),
      imageSha256: sha(b.bytes),
    },
    spec: { path: resolve(specPath), sha256: sha(readFileSync(specPath)) },
  };
  const out = emptyOutput(outPath);
  writeFileSync(join(out, 'reference.png'), a.bytes);
  writeFileSync(join(out, 'candidate.png'), b.bytes);
  let sections = '';
  report.elements.forEach((e: any, i: number) => {
    e.crops = {
      reference: writeNativeCrop(out, a.png, e.reference?.bounds, `element-${i}-reference.png`),
      candidate: writeNativeCrop(out, b.png, e.candidate?.bounds, `element-${i}-candidate.png`),
    };
    sections += `<section><h2>${escape(e.id)} — ${e.status}</h2><div class="pair">${Object.entries(
      e.crops,
    )
      .map(([side, file]) =>
        file
          ? `<figure><figcaption>${side}, native pixels</figcaption><img src="${file}"></figure>`
          : '',
      )
      .join('')}</div><pre>${escape(JSON.stringify(e.checks, null, 2))}</pre></section>`;
  });
  const overlay = (side: string, png: any) =>
    `<svg viewBox="0 0 ${png.width} ${png.height}" xmlns="http://www.w3.org/2000/svg"><image href="${side}.png" width="${png.width}" height="${png.height}"/>${report.elements
      .map((e: any) => {
        const r = e[side]?.bounds;
        return rect(r)
          ? `<g><title>${escape(e.id)}</title><rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="none" stroke="${e.status === 'passed' ? '#00ff88' : '#ff4466'}" stroke-width="2"/><text x="${Math.max(0, r.x)}" y="${Math.max(14, r.y)}" fill="white" stroke="black" paint-order="stroke" stroke-width="2" font-size="14">${escape(e.id)}</text></g>`
          : '';
      })
      .join('')}</svg>`;
  writeFileSync(join(out, 'comparison.json'), JSON.stringify(report, null, 2));
  writeFileSync(
    join(out, 'review.html'),
    `<!doctype html><meta charset="utf-8"><title>UI comparison</title><style>body{background:#16191e;color:#eee;font:15px system-ui;margin:24px}.pair{display:flex;gap:16px;overflow:auto}.pair>svg{width:48%;flex-shrink:0}section{border-top:1px solid #555;padding:16px 0}pre{white-space:pre-wrap}figure{margin:0}img{image-rendering:auto}button{padding:8px}</style><h1>UI comparison: ${report.status}</h1><p>Native coordinates. Overview scales for viewing; crops retain native pixels. Criteria are separate from visual acceptance.</p><h2>State and capture prerequisites</h2><pre>${escape(JSON.stringify(report.prerequisites, null, 2))}</pre><div class="pair">${overlay('reference', a.png)}${overlay('candidate', b.png)}</div><h2>Spacing and alignment</h2><pre>${escape(JSON.stringify(report.relations, null, 2))}</pre>${sections}`,
  );
  return {
    status: report.status,
    out,
    elements: report.elements.map(({ id, status }: any) => ({ id, status })),
  };
}
