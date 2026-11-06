import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { emptyOutput, root, sha } from './config.ts';
import { compareSnapshots, loadSnapshot } from './ui.ts';

const below = (path: string, ancestor: string) => path.startsWith(ancestor + '/');
const usable = (e: any) =>
  e.reference?.kind === 'phaser' &&
  e.candidate?.kind === 'ugui' &&
  e.reference.visible &&
  e.candidate.visible &&
  !e.checks.some((c: any) => ['selector', 'binding', 'bounds'].includes(c.path));
const projectFile = (path: string) => {
  const file = realpathSync(resolve(root, path));
  const rel = relative(root, file);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../'))
    throw new Error('Trace input outside project: ' + path);
  return file;
};

function ancestors(node: any, nodes: any[]) {
  return nodes
    .filter((n) => n.kind === node.kind && (n.path === node.path || below(node.path, n.path)))
    .sort((a, b) => a.path.length - b.path.length)
    .map((n) => ({ path: n.path, bounds: n.bounds, layout: n.layout, context: n.layoutContext }));
}

function ownership(binding: any, node: any) {
  const observed = node.layoutContext?.prefabBinding;
  if (
    observed &&
    binding &&
    (observed.prefab !== binding.prefab || observed.target !== binding.target)
  )
    return {
      status: 'binding-mismatch',
      observed,
      next: 'Reconcile the configured binding with the captured prefab instance before attributing a property.',
    };
  binding ??= observed;
  if (!binding)
    return {
      status: 'unmapped',
      next: 'Map the runtime selector to its Unity prefab and relative target.',
    };
  if (
    typeof binding.prefab !== 'string' ||
    !/^Assets\/.+\.prefab$/.test(binding.prefab) ||
    typeof binding.target !== 'string'
  )
    throw new Error('layoutOwner needs prefab and target.');
  const { prefab, target } = binding;
  const types = binding.controllerTypes ?? [];
  if (!Array.isArray(types) || !types.every((s: any) => typeof s === 'string' && s.length))
    throw new Error('Invalid layout controller type list.');
  const next =
    'Helix.Comparison.UiAuthoring.InspectLayout(' +
    [prefab, target, ...types].map((x) => JSON.stringify(x)).join(', ') +
    ')';
  // An explicit binding is required even if a runtime clone happens to have the prefab name.
  if (!observed && target && !node.path.endsWith('/' + target))
    return {
      status: 'binding-mismatch',
      prefab,
      target,
      next: 'Inspect the runtime hierarchy and correct layoutOwner.target.',
    };
  if (!binding.inspection || !existsSync(resolve(root, binding.inspection)))
    return { status: 'inspection-required', prefab, target, next };
  const bytes = readFileSync(projectFile(binding.inspection));
  const data = JSON.parse(bytes.toString());
  if (
    data.schemaVersion !== 1 ||
    data.prefab !== prefab ||
    data.target !== target ||
    !data.assetHashes?.[prefab] ||
    data.nodes?.[0]?.target !== target ||
    JSON.stringify(data.controllerTypes) !== JSON.stringify(types)
  )
    return { status: 'inspection-mismatch', prefab, target, next };
  for (const [asset, expected] of Object.entries(data.assetHashes)) {
    if (!existsSync(resolve(root, asset)) || sha(readFileSync(projectFile(asset))) !== expected)
      return { status: 'stale-inspection', prefab, target, changedAsset: asset, next };
  }
  return {
    status: 'inspected',
    prefab,
    target,
    inspection: binding.inspection,
    inspectionSha256: sha(bytes),
    nodes: data.nodes,
  };
}

function propertyRoutes(owner: any, node: any, axis: string, kind: string) {
  if (owner.status !== 'inspected') return { status: owner.status, next: owner.next };
  const driver = node.layoutContext?.driver;
  const rootPath = owner.target ? node.path.slice(0, -owner.target.length - 1) : node.path;
  const routes: any[] = [];
  const suffix = axis === 'x' ? 'Width' : 'Height';
  for (const [depth, ancestor] of owner.nodes.entries()) {
    for (const c of ancestor.components) {
      if (!c.enabled && c.role !== 'missing-script') continue;
      const realDriver =
        driver &&
        driver.component === c.type &&
        driver.path === (ancestor.target ? rootPath + '/' + ancestor.target : rootPath);
      let keys: string[] = [];
      switch (c.role) {
        case 'rect':
          if (depth || kind === 'baseline') continue;
          keys = [
            (kind === 'size' ? 'm_SizeDelta.' : 'm_AnchoredPosition.') + axis,
            'm_AnchorMin.' + axis,
            'm_AnchorMax.' + axis,
            'm_Pivot.' + axis,
          ];
          break;
        case 'child-layout':
          if (depth !== 1 && !realDriver) continue;
          keys = [
            'm_Spacing',
            'm_Spacing.' + axis,
            'm_ChildAlignment',
            'm_CellSize.' + axis,
            'm_ChildControl' + suffix,
            'm_ChildForceExpand' + suffix,
            ...(axis === 'x'
              ? ['m_Padding.m_Left', 'm_Padding.m_Right']
              : ['m_Padding.m_Top', 'm_Padding.m_Bottom']),
          ];
          break;
        case 'layout-input':
          if (depth) continue;
          keys = [
            'm_IgnoreLayout',
            'm_Preferred' + suffix,
            'm_Min' + suffix,
            'm_Flexible' + suffix,
            'm_LayoutPriority',
          ];
          break;
        case 'self-layout':
          if (depth && !realDriver) continue;
          keys = [
            axis === 'x' ? 'm_HorizontalFit' : 'm_VerticalFit',
            'm_AspectMode',
            'm_AspectRatio',
          ];
          break;
        case 'text':
          if (depth || kind !== 'baseline') continue;
          keys = [
            'm_margin.y',
            'm_margin.w',
            'm_fontSize',
            'm_enableAutoSizing',
            'm_VerticalAlignment',
            'm_lineSpacing',
          ];
          break;
        case 'canvas-scale':
          keys = [
            'm_UiScaleMode',
            'm_ReferenceResolution.' + axis,
            'm_ScreenMatchMode',
            'm_MatchWidthOrHeight',
            'm_ScaleFactor',
          ];
          break;
        case 'controller':
        case 'missing-script':
          break;
        default:
          continue;
      }
      routes.push({
        component: c.type,
        role: c.role,
        target: ancestor.target,
        observedDriver: !!realDriver,
        properties: (c.properties ?? []).filter((p: any) => keys.includes(p.property)),
      });
    }
  }
  const driving = routes.filter((r) => r.observedDriver);
  if (kind === 'baseline')
    return {
      status: 'inspect-text-metrics',
      next: 'Compare the line metrics, font and alignment at the text owner.',
      routes: routes.filter((r) => r.role === 'text' || r.role === 'controller'),
    };
  if (driver)
    return {
      status: 'runtime-driven',
      driver,
      next: 'Inspect the measured driver before modifying driven RectTransform fields.',
      routes: driving.length ? driving : routes.filter((r) => r.role !== 'rect'),
    };
  const controllers = routes.filter((r) =>
    ['controller', 'missing-script', 'self-layout', 'child-layout'].includes(r.role),
  );
  if (
    controllers.length ||
    !node.layoutContext ||
    node.layoutContext.worldRotation !== 0 ||
    node.layoutContext.worldScale?.some((value: number) => value <= 0)
  )
    return {
      status: 'inspect-layout-chain',
      next: 'Check layout controllers, transforms and runtime values before changing the serialized rect.',
      routes,
    };

  const r = routes.find((r) => r.role === 'rect');
  const property = r?.properties.find(
    (p: any) => p.property === (kind === 'size' ? 'm_SizeDelta.' : 'm_AnchoredPosition.') + axis,
  );
  const idx = axis === 'x' ? 0 : 1;
  const live =
    kind === 'size' ? node.layout?.sizeDelta?.[idx] : node.layoutContext.anchoredPosition?.[idx];
  if (property && Number.isFinite(live) && property.value !== live)
    return {
      status: 'runtime-value-differs',
      next: 'Trace the runtime writer of this property; the captured value differs from its prefab.',
      live,
      authored: property,
      routes,
    };
  return {
    status: 'inspect-placement',
    next: 'Inspect the first property as a local tuning control; confirm anchor, pivot, scale and runtime ownership before editing.',
    property,
    routes,
  };
}

export function traceLayout(
  referencePath: string,
  candidatePath: string,
  specPath: string,
  outPath: string,
) {
  const a = loadSnapshot(referencePath),
    b = loadSnapshot(candidatePath);
  const specBytes = readFileSync(specPath);
  const spec = JSON.parse(specBytes.toString());
  const comparison = compareSnapshots(a.ui, b.ui, spec);
  const eligible =
    comparison.prerequisites.every((p) => p.status === 'passed') &&
    !a.ui.truncated &&
    !b.ui.truncated;
  const measured = comparison.elements.filter(usable);
  const traces = comparison.elements.map((e: any, index: number) => {
    const definition = spec.elements[index];
    const tolerance = definition.boundsTolerance ?? 0;
    if (
      definition.baselineTolerancePx !== undefined &&
      (!Number.isFinite(definition.baselineTolerancePx) || definition.baselineTolerancePx < 0)
    )
      throw new Error('Invalid baselineTolerancePx: ' + e.id);
    if (!eligible || !usable(e))
      return {
        id: e.id,
        status: 'unmeasured',
        checks: e.checks,
        reason:
          'Require matched state and dimensions, complete inventories, and visible unique Phaser/uGUI geometry.',
      };
    const parent = measured
      .filter(
        (p: any) =>
          below(e.reference.path, p.reference.path) && below(e.candidate.path, p.candidate.path),
      )
      .sort((p: any, q: any) => q.candidate.path.length - p.candidate.path.length)[0];
    const aRect = e.reference.bounds,
      bRect = e.candidate.bounds;
    const delta = (key: string) => bRect[key] - aRect[key];
    const owner = ownership(definition.layoutOwner, e.candidate);
    const findings = [];
    for (const [axis, size] of [
      ['x', 'width'],
      ['y', 'height'],
    ]) {
      const sizeDelta = delta(size);
      const shift = delta(axis);
      const idx = axis === 'x' ? 0 : 1;
      const layout = e.candidate.layout;
      const p = layout?.pivot?.[idx];
      const min = layout?.anchorMin?.[idx],
        max = layout?.anchorMax?.[idx];
      const parentShift = parent
        ? parent.candidate.bounds[axis] - parent.reference.bounds[axis]
        : null;
      const parentResize = parent
        ? parent.candidate.bounds[size] - parent.reference.bounds[size]
        : null;
      const direct =
        parent &&
        e.candidate.path.slice(0, e.candidate.path.lastIndexOf('/')) === parent.candidate.path;
      const context = e.candidate.layoutContext;
      const axisAligned =
        context &&
        context.worldRotation === 0 &&
        context.unitLocalScale &&
        context.parentWorldRotation === 0 &&
        context.worldScale.every((scale: number) => scale > 0);
      const anchored = direct && axisAligned && [p, min, max].every(Number.isFinite);
      const fromParent = {
        status: 'tracks-parent',
        inspectElement: parent?.id,
        next: 'Inspect the mapped ancestor first; its measured change accounts for this difference on this axis.',
      };
      if (Math.abs(sizeDelta) > tolerance) {
        const stretch = anchored ? (max - min) * parentResize : null;
        findings.push({
          axis,
          kind: 'size',
          deltaPx: sizeDelta,
          parentExtentDeltaPx: parentResize,
          stretchContributionPx: stretch,
          route:
            stretch !== null &&
            Math.abs(stretch) > tolerance &&
            Math.abs(stretch - sizeDelta) <= tolerance
              ? fromParent
              : propertyRoutes(owner, e.candidate, axis, 'size'),
        });
      }
      if (Math.abs(shift) <= tolerance) continue;
      const pureTranslation =
        parent &&
        Math.abs(parentShift) > tolerance &&
        Math.abs(shift - parentShift) <= tolerance &&
        Math.abs(sizeDelta) <= tolerance &&
        Math.abs(parentResize) <= tolerance;
      // Unity anchors/pivots use bottom-left axes; receipts measure down from the top.
      const fraction = anchored ? min + (max - min) * p : 0;
      const positionFromParent = anchored
        ? parentShift + (axis === 'x' ? fraction : 1 - fraction) * parentResize
        : null;
      const edgeFromSize = anchored ? -(axis === 'x' ? p : 1 - p) * sizeDelta : null;
      let route;
      if (pureTranslation) route = fromParent;
      else if (anchored && Math.abs(shift - positionFromParent - edgeFromSize) <= tolerance) {
        route =
          Math.abs(edgeFromSize) > tolerance
            ? {
                status: 'edge-follows-size',
                next: 'Inspect the size finding and its pivot before moving the rect.',
              }
            : fromParent;
      } else if (Math.abs(sizeDelta) > tolerance && Math.abs(shift + sizeDelta / 2) <= tolerance)
        route = {
          status: 'aligned-center',
          next: 'The centers agree on this axis. Inspect the size difference before changing placement.',
        };
      else route = propertyRoutes(owner, e.candidate, axis, 'position');
      findings.push({
        axis,
        kind: 'position',
        deltaPx: shift,
        parentDeltaPx: parentShift,
        relativeDeltaPx: parent ? shift - parentShift : null,
        anchorContributionPx: positionFromParent,
        sizeContributionPx: edgeFromSize,
        route,
      });
    }
    if (
      typeof e.reference.text?.value === 'string' &&
      e.reference.text.value === e.candidate.text?.value &&
      Number.isFinite(e.reference.text.baseline) &&
      Number.isFinite(e.candidate.text.baseline)
    ) {
      const relativeBaseline =
        e.candidate.text.baseline - bRect.y - (e.reference.text.baseline - aRect.y);
      if (Math.abs(relativeBaseline) > (definition.baselineTolerancePx ?? tolerance))
        findings.push({
          axis: 'y',
          kind: 'baseline-within-rect',
          deltaPx: relativeBaseline,
          route: propertyRoutes(owner, e.candidate, 'y', 'baseline'),
        });
    }
    return {
      id: e.id,
      status: findings.length ? 'difference' : 'no-measured-difference',
      mappedAncestor: parent?.id ?? null,
      referenceChain: ancestors(e.reference, a.ui.nodes),
      candidateChain: ancestors(e.candidate, b.ui.nodes),
      referenceText: e.reference.text,
      candidateText: e.candidate.text,
      ownership: owner,
      findings,
    };
  });
  const out = emptyOutput(outPath);
  const reportPath = join(out, 'layout-trace.json');
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        prerequisites: comparison.prerequisites,
        traces,
        inputs: {
          reference: {
            path: referencePath,
            receiptSha256: sha(readFileSync(referencePath)),
            imageSha256: sha(a.bytes),
          },
          candidate: {
            path: candidatePath,
            receiptSha256: sha(readFileSync(candidatePath)),
            imageSha256: sha(b.bytes),
          },
          spec: { path: specPath, sha256: sha(specBytes) },
        },
        scope:
          'Screen deltas localize divergence. Property ownership is provenance; proposed causes need confirmation with a scoped edit and recapture.',
      },
      null,
      2,
    ),
  );
  return {
    reportPath,
    elements: traces.map((t) => ({
      id: t.id,
      status: t.status,
      findings: t.findings?.length ?? 0,
    })),
  };
}
