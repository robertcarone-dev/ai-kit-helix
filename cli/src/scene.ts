import { relationshipDiagnostics, styleDiagnostics } from './scene-relations.ts';
import { appearanceDiagnostics } from './scene-diagnostics.ts';
import { compareGeometry } from './scene-geometry.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { emptyOutput, sha } from './config.ts';

export function validateScene(s: any) {
  if (
    s?.schemaVersion !== 1 ||
    s.kind !== 'helix-scene' ||
    s.coordinateSpace !== 'viewport-top-left-pixels'
  )
    throw new Error('Unsupported scene snapshot');
  if (
    ![s.viewport?.width, s.viewport?.height].every((n) => Number.isFinite(n) && n > 0) ||
    s.viewport.dpr !== 1 ||
    s.viewport.zoom !== 1
  )
    throw new Error('Scene needs native viewport, dpr=1 and zoom=1');
  if (!Array.isArray(s.nodes) || s.nodes.length > 10000 || s.truncated !== false)
    throw new Error('Scene inventory incomplete or excessive');
  const ids = new Set<string>();
  for (const n of s.nodes) {
    if (typeof n.id !== 'string' || !n.id || ids.has(n.id))
      throw new Error('Missing or duplicate node id');
    ids.add(n.id);
    if (
      n.bounds != null &&
      (!['x', 'y', 'width', 'height'].every((k) => Number.isFinite(n.bounds[k])) ||
        n.bounds.width < 0 ||
        n.bounds.height < 0)
    )
      throw new Error('Invalid bounds');
  }
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  for (const n of s.nodes) {
    const seen = new Set([n.id]);
    let p = n.parentId;
    while (p != null) {
      if (!ids.has(p) || seen.has(p) || seen.size > 129)
        throw new Error('Broken or cyclic hierarchy');
      seen.add(p);
      p = (byId.get(p) as any).parentId;
    }
  }
  return s;
}
function select(s: any, selector: any) {
  if (
    !selector ||
    Object.keys(selector).length !== 1 ||
    (!Array.isArray(selector.ids) && !Array.isArray(selector.semanticIds))
  )
    throw new Error('Selector needs ids or semanticIds');
  const key = selector.ids ? 'id' : 'semanticId',
    values = selector.ids ?? selector.semanticIds;
  if (
    !values.length ||
    new Set(values).size !== values.length ||
    values.some((v) => typeof v !== 'string' || !v)
  )
    throw new Error('Invalid selector values');
  const result = [];
  for (const v of values) {
    if (key === 'semanticId' && s.bindingErrors?.some((e) => e.id === v))
      return { error: 'binding-error', value: v };
    const found = s.nodes.filter((n) => n[key] === v);
    if (found.length !== 1) return { error: found.length ? 'ambiguous' : 'missing', value: v };
    result.push(found[0]);
  }
  return { nodes: result };
}
function union(ns: any[]) {
  if (ns.some((n) => !n.bounds)) return null;
  const l = Math.min(...ns.map((n) => n.bounds.x)),
    t = Math.min(...ns.map((n) => n.bounds.y));
  return {
    x: l,
    y: t,
    width: Math.max(...ns.map((n) => n.bounds.x + n.bounds.width)) - l,
    height: Math.max(...ns.map((n) => n.bounds.y + n.bounds.height)) - t,
  };
}
export function compareScenes(reference: any, candidate: any, spec: any) {
  validateScene(reference);
  validateScene(candidate);
  if (spec?.schemaVersion !== 1 || !Array.isArray(spec.mappings) || !spec.mappings.length)
    throw new Error('Scene spec needs schemaVersion:1 and explicit mappings');
  const prerequisites = [];
  if (
    reference.viewport.width !== candidate.viewport.width ||
    reference.viewport.height !== candidate.viewport.height
  )
    prerequisites.push('viewport-mismatch');
  if (!reference.checkpoint || reference.checkpoint !== candidate.checkpoint)
    prerequisites.push('checkpoint-mismatch-or-missing');
  if (
    reference.state == null ||
    candidate.state == null ||
    !isDeepStrictEqual(reference.state, candidate.state)
  )
    prerequisites.push('state-mismatch-or-missing');
  const ids = new Set();
  const mappings = spec.mappings.map((m) => {
    if (
      typeof m.id !== 'string' ||
      !m.id ||
      ids.has(m.id) ||
      !Number.isFinite(m.tolerancePx) ||
      m.tolerancePx < 0
    )
      throw new Error('Mappings need unique id and explicit nonnegative tolerancePx');
    ids.add(m.id);
    const a = select(reference, m.reference),
      b = select(candidate, m.candidate);
    if (a.error || b.error)
      return {
        id: m.id,
        status: 'unresolved',
        reference: a.error ? { reason: a.error, value: a.value } : null,
        candidate: b.error ? { reason: b.error, value: b.value } : null,
      };
    const rb = union(a.nodes),
      cb = union(b.nodes);
    const kinds = [...a.nodes, ...b.nodes].map((n) => n.boundsKind).filter(Boolean);
    const incompatible =
      kinds.some((k) => k === 'projected-world-aabb-3d') &&
      kinds.some((k) => k === 'projected-local-aabb-3d');
    const measured = prerequisites.length === 0 && rb && cb && !incompatible;
    const delta = measured
      ? Object.fromEntries(['x', 'y', 'width', 'height'].map((k) => [k, cb[k] - rb[k]]))
      : null;
    return {
      id: m.id,
      structure: {
        reference: a.nodes.map((n) => ({
          id: n.id,
          parentId: n.parentId,
          type: n.type,
          name: n.name,
        })),
        candidate: b.nodes.map((n) => ({
          id: n.id,
          parentId: n.parentId,
          type: n.type,
          name: n.name,
        })),
        assessment: 'observed-only; different engine hierarchies may be intentional',
      },
      status: !measured
        ? 'unmeasured'
        : Object.values(delta).every((v: any) => Math.abs(v) <= m.tolerancePx)
          ? 'within-tolerance'
          : 'different',
      reference: {
        ids: a.nodes.map((n) => n.id),
        bounds: rb,
        visible: a.nodes.map((n) => n.visible),
      },
      candidate: {
        ids: b.nodes.map((n) => n.id),
        bounds: cb,
        visible: b.nodes.map((n) => n.visible),
      },
      deltaPx: delta,
      measurementIssue: incompatible ? 'incompatible-bounds-methods' : null,
      normalized: measured
        ? {
            reference: {
              x: rb.x / reference.viewport.width,
              y: rb.y / reference.viewport.height,
              width: rb.width / reference.viewport.width,
              height: rb.height / reference.viewport.height,
            },
            candidate: {
              x: cb.x / candidate.viewport.width,
              y: cb.y / candidate.viewport.height,
              width: cb.width / candidate.viewport.width,
              height: cb.height / candidate.viewport.height,
            },
          }
        : null,
      visibility: prerequisites.length
        ? 'unmeasured'
        : a.nodes.length === 1 && b.nodes.length === 1
          ? a.nodes[0].visible === b.nodes[0].visible
            ? 'same'
            : 'different'
          : 'group-members-listed',
      notes: [
        'Bounds are geometric observations; visible pixels, clipping and occlusion need paired images.',
      ],
    };
  });
  // Suggestions never participate in accepted mappings.
  const names = new Map();
  for (const n of candidate.nodes) {
    if (!n.name) continue;
    const list = names.get(n.name) ?? [];
    list.push(n.id);
    names.set(n.name, list);
  }
  const suggestions = reference.nodes
    .filter((n) => n.name && names.has(n.name))
    .map((n) => ({
      reference: n.id,
      candidates: names.get(n.name).slice(0, 20),
      candidateCount: names.get(n.name).length,
      basis: 'exact-name-only; never accepted automatically',
    }));
  return {
    schemaVersion: 1,
    kind: 'helix-scene-comparison',
    acceptance: 'diagnostic-only',
    bindingErrors: {
      reference: reference.bindingErrors ?? [],
      candidate: candidate.bindingErrors ?? [],
    },
    relationships: relationshipDiagnostics(reference, candidate, spec, prerequisites),
    styles: styleDiagnostics(reference, candidate, spec, prerequisites),
    geometry: compareGeometry(reference, candidate, spec, prerequisites),
    appearance: appearanceDiagnostics(reference, candidate, spec, prerequisites),
    prerequisites,
    mappings,
    suggestions,
  };
}
function overlay(snapshot: any, report: any, side: string) {
  const esc = (s: any) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
    );
  const boxes = report.mappings
    .flatMap((m) => {
      const b = m[side]?.bounds;
      return b
        ? [
            `<g><rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="none" stroke="${m.status === 'different' ? '#e44' : '#08c'}"/><text x="${b.x}" y="${b.y + 14}" fill="#08c">${esc(m.id)}</text></g>`,
          ]
        : [];
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${snapshot.viewport.width}" height="${snapshot.viewport.height}" viewBox="0 0 ${snapshot.viewport.width} ${snapshot.viewport.height}">${boxes}</svg>`;
}
export function compareSceneFiles(
  referenceFile: string,
  candidateFile: string,
  specFile: string,
  output: string,
) {
  const bytes = [referenceFile, candidateFile, specFile].map((f) => readFileSync(f));
  const [a, b, spec] = bytes.map((b) => JSON.parse(b.toString()));
  const report = {
    ...compareScenes(a, b, spec),
    inputs: bytes.map((b, i) => ({
      path: [referenceFile, candidateFile, specFile][i],
      sha256: sha(b),
    })),
  };
  const out = emptyOutput(output);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(out, 'reference.svg'), overlay(a, report, 'reference'));
  writeFileSync(join(out, 'candidate.svg'), overlay(b, report, 'candidate'));
  return { out, report };
}
