/** Plain JavaScript function also serialized into the browser probe. Matrices are column-major. */
export function sceneGeometry() {
  const matrix = (m) => Array.isArray(m) && m.length === 16 && m.every(Number.isFinite);
  const point = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  const multiply = (m, p) =>
    [0, 1, 2, 3].map((r) => m[r] * p[0] + m[r + 4] * p[1] + m[r + 8] * p[2] + m[r + 12] * p[3]);
  const transform = (m, p) => {
    if (!matrix(m) || !point(p)) return null;
    const q = multiply(m, [...p, 1]);
    return Number.isFinite(q[3]) && Math.abs(q[3]) > 1e-10
      ? q.slice(0, 3).map((x) => x / q[3])
      : null;
  };
  const surface = (s) =>
    s &&
    s.axisAligned === true &&
    ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(s[k])) &&
    s.width > 0 &&
    s.height > 0;
  const project = (worldPoint, view, projection, output) => {
    if (!point(worldPoint) || !matrix(view) || !matrix(projection) || !surface(output)) return null;
    const clip = multiply(projection, multiply(view, [...worldPoint, 1]));
    if (!clip.every(Number.isFinite) || clip[3] <= 1e-10) return null;
    const p = clip.slice(0, 3).map((x) => x / clip[3]);
    // Clip-plane crossings are withheld, not approximated by a misleading bounding rectangle.
    if (p[2] < -1 - 1e-6 || p[2] > 1 + 1e-6) return null;
    return {
      x: output.x + (p[0] + 1) * 0.5 * output.width,
      y: output.y + (1 - p[1]) * 0.5 * output.height,
      depth: p[2],
    };
  };
  const bounds = (ps) => {
    if (!ps.length || ps.some((p) => !p)) return null;
    const xs = ps.map((p) => p.x),
      ys = ps.map((p) => p.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  };
  const corners = (b) => {
    if (!b || !point(b.min) || !point(b.max) || b.min.some((v, i) => v > b.max[i])) return [];
    const ps = [];
    for (const x of [b.min[0], b.max[0]])
      for (const y of [b.min[1], b.max[1]])
        for (const z of [b.min[2], b.max[2]]) ps.push([x, y, z]);
    return ps;
  };
  const affine = (m) =>
    matrix(m) &&
    Math.abs(m[3]) + Math.abs(m[7]) + Math.abs(m[11]) + Math.abs(m[15] - 1) < 1e-9 &&
    Math.abs(
      m[0] * (m[5] * m[10] - m[9] * m[6]) -
        m[4] * (m[1] * m[10] - m[9] * m[2]) +
        m[8] * (m[1] * m[6] - m[5] * m[2]),
    ) > 1e-12;
  return { matrix, point, transform, project, bounds, corners, affine, surface };
}

const g = sceneGeometry();
export function compareGeometry(a: any, b: any, spec: any, prerequisites: string[]) {
  const coordinates = spec.coordinates;
  if (
    coordinates &&
    (!coordinates.units ||
      !['reference', 'candidate'].every((k) => g.affine(coordinates[k]?.worldToCommon)))
  )
    throw new Error(
      'coordinates needs units and invertible affine worldToCommon matrices for both sides',
    );
  const worlds = (snapshot, selector, conversion) => {
    const nodes = snapshot.nodes.filter((n) =>
      selector.id ? n.id === selector.id : n.semanticId === selector.semanticId,
    );
    if (nodes.length !== 1) return { reason: 'landmark node missing or ambiguous' };
    const n = nodes[0],
      world = g.transform(n.raw?.world, selector.point);
    const cameras = snapshot.cameras?.filter((c) => c.id === n.cameraId) ?? [];
    const c = cameras.length === 1 ? cameras[0] : null;
    const screen =
      world && c?.projectionConvention === 'clip-minus-one-to-one'
        ? g.project(world, c.raw?.view, c.raw?.projection, c.surface)
        : null;
    return { world, common: world && conversion ? g.transform(conversion, world) : null, screen };
  };
  const seen = new Set();
  const landmarks = (spec.landmarks ?? []).map((l) => {
    if (
      !l.id ||
      seen.has(l.id) ||
      ![l.reference, l.candidate].every(
        (s) =>
          s &&
          (typeof s.id === 'string') !== (typeof s.semanticId === 'string') &&
          g.point(s.point),
      ) ||
      !Number.isFinite(l.tolerancePx) ||
      l.tolerancePx < 0
    )
      throw new Error(
        'Invalid landmark; supply unique id, single node selector, local point and tolerancePx',
      );
    seen.add(l.id);
    if (coordinates && (!Number.isFinite(l.toleranceWorld) || l.toleranceWorld < 0))
      throw new Error('World landmarks need explicit toleranceWorld');
    const r = worlds(a, l.reference, coordinates?.reference.worldToCommon),
      c = worlds(b, l.candidate, coordinates?.candidate.worldToCommon);
    const screenDistance =
      !prerequisites.length && r.screen && c.screen
        ? Math.hypot(r.screen.x - c.screen.x, r.screen.y - c.screen.y)
        : null;
    const worldDistance =
      !prerequisites.length && r.common && c.common
        ? Math.hypot(...r.common.map((v, i) => v - c.common[i]))
        : null;
    return {
      id: l.id,
      reference: r,
      candidate: c,
      screenDistancePx: screenDistance,
      screenStatus:
        screenDistance == null
          ? 'unmeasured'
          : screenDistance <= l.tolerancePx
            ? 'within-tolerance'
            : 'different',
      worldDistance,
      worldUnits: coordinates?.units ?? null,
      worldStatus:
        worldDistance == null
          ? 'unmeasured'
          : worldDistance <= l.toleranceWorld
            ? 'within-tolerance'
            : 'different',
    };
  });
  return {
    coordinates: coordinates ?? null,
    landmarks,
    cameras: { reference: a.cameras ?? [], candidate: b.cameras ?? [] },
    notes: [
      'Camera and local transform values remain engine-native. World comparisons require explicit affine conversion; screen comparisons use each engine camera independently.',
    ],
  };
}
