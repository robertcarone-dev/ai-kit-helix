import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { emptyOutput, sha } from './config.ts';
import { uiAssets, uiPlan } from './ui-port.ts';
/** An approved, hash-pinned manifest joins source extraction and layout plans; never applies Unity edits. */
export async function conversionPlan(root: string, specPath: string, out: string) {
  const local = (path) => {
    if (typeof path !== 'string' || !path) throw new Error('Manifest requires local paths');
    const full = realpathSync(resolve(root, path)),
      r = relative(realpathSync(root), full);
    if (r.startsWith('..') || isAbsolute(r)) throw new Error('Manifest input escapes project');
    return full;
  };
  const manifestPath = local(specPath),
    spec = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (
    spec.schemaVersion !== 1 ||
    spec.approved !== true ||
    !Array.isArray(spec.elements) ||
    !spec.elements.length ||
    (!spec.assets && !spec.layout)
  )
    throw new Error(
      'Conversion manifest needs schemaVersion:1, approved:true, elements and assets or layout',
    );
  const inputs = [],
    load = (entry) => {
      const path = local(entry.path),
        bytes = readFileSync(path);
      if (sha(bytes) !== entry.sha256)
        throw new Error('Manifest input hash changed: ' + entry.path);
      inputs.push({ path, sha256: entry.sha256 });
      return { path, spec: JSON.parse(bytes.toString()) };
    };
  const assets = spec.assets ? load(spec.assets) : null,
    layout = spec.layout ? load(spec.layout) : null;
  const ids = new Set();
  for (const e of spec.elements) {
    if (typeof e.id !== 'string' || !e.id || ids.has(e.id))
      throw new Error('Conversion elements need unique semantic ids');
    ids.add(e.id);
    if (!e.layoutId && !e.assetIds?.length)
      throw new Error('Every conversion element must link an asset or layout');
    if (
      e.layoutId &&
      (e.layoutId !== e.id ||
        layout?.spec.elements?.filter((x) => x.id === e.layoutId).length !== 1)
    )
      throw new Error('Layout link must resolve the same approved semantic id');
    if (
      e.assetIds !== undefined &&
      (!Array.isArray(e.assetIds) ||
        !e.assetIds.length ||
        new Set(e.assetIds).size !== e.assetIds.length)
    )
      throw new Error('assetIds must be unique nonempty list');
    for (const id of e.assetIds ?? [])
      if (assets?.spec.assets?.filter((x) => x.id === id).length !== 1)
        throw new Error('Unresolved conversion asset ' + id);
  }
  // Do not run additional operations hidden outside the approved element list.
  for (const e of layout?.spec.elements ?? [])
    if (!spec.elements.some((x) => x.layoutId === e.id))
      throw new Error('Layout operation not in approved manifest: ' + e.id);
  for (const a of assets?.spec.assets ?? [])
    if (!spec.elements.some((x) => x.assetIds?.includes(a.id)))
      throw new Error('Asset operation not in approved manifest: ' + a.id);
  const verification = (spec.verification ?? []).map((entry) => load(entry));
  for (const v of verification)
    if (v.spec.schemaVersion !== 1 || !v.spec.cases?.length)
      throw new Error('Verification entry must be a case matrix');
  const target = emptyOutput(out),
    report: any = {
      schemaVersion: 1,
      kind: 'helix-conversion-plan',
      status: 'planning',
      acceptance: 'unmeasured',
      manifest: { path: manifestPath, sha256: sha(readFileSync(manifestPath)) },
      inputs,
      elements: spec.elements,
      verification: verification.map((v) => ({
        spec: v.path,
        command: ['ui-matrix', '--spec', v.path, '--out', '<fresh-checkout-scratch-directory>'],
      })),
    };
  const save = () =>
    writeFileSync(join(target, 'conversion.json'), JSON.stringify(report, null, 2));
  save();
  try {
    if (assets) report.assets = await uiAssets(root, assets.path, join(target, 'assets'));
    if (layout) report.layout = uiPlan(root, layout.path, join(target, 'layout'));
    report.status = report.layout?.status === 'partial' ? 'partial' : 'planned';
  } catch (e) {
    report.status = 'blocked';
    report.error = String(e);
    save();
    throw e;
  }
  save();
  return { ...report, out: target };
}
