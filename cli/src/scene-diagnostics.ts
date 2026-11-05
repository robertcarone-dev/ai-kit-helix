import { isDeepStrictEqual } from 'node:util';

function property(snapshot: any, selector: any) {
  if (
    !selector ||
    (typeof selector.id === 'string') === (typeof selector.semanticId === 'string') ||
    !Array.isArray(selector.path) ||
    !selector.path.length ||
    selector.path.length > 16 ||
    selector.path.some(
      (k) =>
        (typeof k !== 'string' && !Number.isInteger(k)) ||
        ['__proto__', 'constructor', 'prototype'].includes(k),
    )
  )
    throw new Error('Appearance selector needs one node id/semanticId and a bounded property path');
  if (selector.semanticId && snapshot.bindingErrors?.some((e) => e.id === selector.semanticId))
    return undefined;
  const nodes = snapshot.nodes.filter((n) =>
    selector.id ? n.id === selector.id : n.semanticId === selector.semanticId,
  );
  if (nodes.length !== 1) return undefined;
  let value = nodes[0];
  for (const key of selector.path) {
    if (value == null || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}
function numeric(value: any, rule: any, mode: string) {
  const values = mode === 'number' ? [value] : value;
  if (!Array.isArray(values) || !values.length || !values.every(Number.isFinite)) return null;
  if (
    mode === 'linear-color' &&
    (![3, 4].includes(values.length) || !['linear', 'srgb'].includes(rule.colorSpace))
  )
    throw new Error('Color comparisons require explicit linear/srgb space and RGB/RGBA arrays');
  if (
    (rule.scale !== undefined && !Number.isFinite(rule.scale)) ||
    (rule.offset !== undefined && !Number.isFinite(rule.offset))
  )
    throw new Error('Property conversion scale/offset must be finite');
  return values.map((v, i) => {
    const n =
      mode === 'linear-color' && i < 3 && rule.colorSpace === 'srgb'
        ? v <= 0.04045
          ? v / 12.92
          : Math.pow((v + 0.055) / 1.055, 2.4)
        : v;
    return n * (rule.scale ?? 1) + (rule.offset ?? 0);
  });
}
export function appearanceDiagnostics(a: any, b: any, spec: any, prerequisites: string[]) {
  const ids = new Set();
  return (spec.appearance ?? []).map((rule) => {
    if (
      !rule.id ||
      ids.has(rule.id) ||
      !['exact', 'number', 'vector', 'linear-color'].includes(rule.mode)
    )
      throw new Error('Appearance rules need unique id and a supported mode');
    ids.add(rule.id);
    if (rule.mode !== 'exact' && (!Number.isFinite(rule.tolerance) || rule.tolerance < 0))
      throw new Error('Numeric appearance comparisons need nonnegative tolerance');
    const r = property(a, rule.reference),
      c = property(b, rule.candidate);
    if (r == null || c == null || prerequisites.length)
      return {
        id: rule.id,
        status: 'unmeasured',
        reason: prerequisites.length ? 'capture-prerequisites' : 'missing-or-ambiguous-property',
        reference: r ?? null,
        candidate: c ?? null,
      };
    if (rule.mode === 'exact')
      return {
        id: rule.id,
        status: isDeepStrictEqual(r, c) ? 'same' : 'different',
        reference: r,
        candidate: c,
      };
    const rn = numeric(r, rule.reference, rule.mode),
      cn = numeric(c, rule.candidate, rule.mode);
    if (!rn || !cn || rn.length !== cn.length)
      return {
        id: rule.id,
        status: 'unmeasured',
        reason: 'non-comparable-numeric-values',
        reference: r,
        candidate: c,
      };
    const delta = cn.map((v, i) => v - rn[i]);
    return {
      id: rule.id,
      status: delta.every((v) => Math.abs(v) <= rule.tolerance) ? 'within-tolerance' : 'different',
      reference: r,
      candidate: c,
      normalizedReference: rn,
      normalizedCandidate: cn,
      delta,
    };
  });
}
