import { appearanceDiagnostics } from './scene-diagnostics.ts';
function node(s, selector) {
  if (!selector || (typeof selector.id === 'string') === (typeof selector.semanticId === 'string'))
    throw new Error('Relationship selector needs one id or semanticId');
  if (selector.semanticId && s.bindingErrors?.some((e) => e.id === selector.semanticId))
    return null;
  const ns = s.nodes.filter((n) =>
    selector.id ? n.id === selector.id : n.semanticId === selector.semanticId,
  );
  return ns.length === 1 ? ns[0] : null;
}
function measurement(s, selectors, kind) {
  if (!Array.isArray(selectors) || selectors.length !== 2)
    throw new Error('Relationship needs two ordered selectors per engine');
  const [a, b] = selectors.map((x) => node(s, x));
  if (!a || !b) return null;
  if (kind === 'baseline')
    return Number.isFinite(a.raw?.baseline) && Number.isFinite(b.raw?.baseline)
      ? b.raw.baseline - a.raw.baseline
      : null;
  if (!a.bounds || !b.bounds) return null;
  const x = a.bounds,
    y = b.bounds;
  switch (kind) {
    case 'gap-x':
      return y.x - x.x - x.width;
    case 'gap-y':
      return y.y - x.y - x.height;
    case 'align-x':
      return y.x + y.width / 2 - x.x - x.width / 2;
    case 'align-y':
      return y.y + y.height / 2 - x.y - x.height / 2;
    case 'ratio-width':
      return x.width > 0 ? y.width / x.width : null;
    case 'ratio-height':
      return x.height > 0 ? y.height / x.height : null;
    case 'distance':
      return Math.hypot(
        y.x + y.width / 2 - x.x - x.width / 2,
        y.y + y.height / 2 - x.y - x.height / 2,
      );
  }
}
export function relationshipDiagnostics(a, b, spec, prerequisites) {
  const ids = new Set();
  return (spec.relationships ?? []).map((r) => {
    if (
      typeof r.id !== 'string' ||
      !r.id ||
      ids.has(r.id) ||
      ![
        'gap-x',
        'gap-y',
        'align-x',
        'align-y',
        'ratio-width',
        'ratio-height',
        'baseline',
        'distance',
      ].includes(r.kind) ||
      !Number.isFinite(r.tolerance) ||
      r.tolerance < 0
    )
      throw new Error('Invalid relationship id, kind or tolerance');
    ids.add(r.id);
    const reference = measurement(a, r.reference, r.kind),
      candidate = measurement(b, r.candidate, r.kind);
    const measured = reference !== null && candidate !== null && !prerequisites.length,
      delta = measured ? candidate - reference : null;
    return {
      id: r.id,
      kind: r.kind,
      unit: r.kind.startsWith('ratio-') ? 'ratio' : 'px',
      reference,
      candidate,
      delta,
      status: !measured
        ? 'unmeasured'
        : Math.abs(delta) <= r.tolerance
          ? 'within-tolerance'
          : 'different',
    };
  });
}
// Named style roles expand into ordinary appearance checks: explicit selectors/conversions remain mandatory.
export function styleDiagnostics(a, b, spec, prerequisites) {
  const ids = new Set();
  return (spec.styles ?? []).map((role) => {
    if (
      typeof role.id !== 'string' ||
      !role.id ||
      ids.has(role.id) ||
      !Array.isArray(role.members) ||
      !role.members.length
    )
      throw new Error('Style roles need unique ids and members');
    ids.add(role.id);
    const rules = role.members.map((m, i) => ({
      id: String(i),
      mode: role.mode,
      tolerance: role.tolerance,
      ...m,
    }));
    const cross = appearanceDiagnostics(a, b, { appearance: rules }, prerequisites);
    const coherence = (snapshot, side) =>
      appearanceDiagnostics(
        snapshot,
        snapshot,
        {
          appearance: rules
            .slice(1)
            .map((r, i) => ({ ...r, reference: rules[0][side], candidate: rules[i + 1][side] })),
        },
        prerequisites,
      );
    const reference = coherence(a, 'reference'),
      candidate = coherence(b, 'candidate'),
      checks = [...cross, ...reference, ...candidate];
    return {
      id: role.id,
      cross,
      reference,
      candidate,
      status: checks.some((c) => c.status === 'unmeasured')
        ? 'unmeasured'
        : checks.some((c) => c.status === 'different')
          ? 'different'
          : 'within-tolerance',
    };
  });
}
