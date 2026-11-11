import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { emptyOutput, root, sha } from './config.ts';
import { loadSnapshot, select, get } from './ui.ts';
import { pngDimensions } from './image-limits.ts';
import { spriteUsage } from './sprite-usage.ts';
import { renderTrace } from './render-trace.ts';
import { readBaseline } from './evidence-baseline.ts';

type Pin = { path: string; sha256: string };
type PreparedReview = {
  reference: { image: string; receipt: string };
  candidate: { image: string; receipt: string };
  checkBaseline: (baseline: ReturnType<typeof readBaseline>, role: string) => void;
};
type Observation = { value: string | null; basis: string };
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function bytes(path: string) {
  if (!statSync(path).isFile() || statSync(path).size > 32 * 1024 * 1024) throw new Error('Expected a regular evidence file no larger than 32 MiB: ' + path);
  return readFileSync(path);
}
function pinned(base: string, pin: Pin) {
  if (!pin || typeof pin.path !== 'string' || !pin.path || !digest(pin.sha256)) throw new Error('Expected path and lowercase SHA-256 pin.');
  const path = resolve(base, pin.path), data = bytes(path);
  if (sha(data) !== pin.sha256) throw new Error('Evidence hash mismatch: ' + path);
  return { path, data, sha256: pin.sha256 };
}
function snapshot(base: string, input: any) {
  if (input.baseline !== undefined && (typeof input.baseline !== 'string' || !input.baseline || input.receipt !== undefined)) throw new Error('Use a baseline path or a receipt pin, not both.');
  const baseline = input.baseline === undefined ? undefined : readBaseline(resolve(base, input.baseline));
  const file = pinned(base, baseline === undefined ? input.receipt : baseline.receipt), receipt = JSON.parse(file.data.toString());
  const image = receipt.image ?? receipt.capturePath;
  if (typeof image !== 'string' || !image) throw new Error('Snapshot receipt requires an image path.');
  pngDimensions(bytes(resolve(dirname(file.path), image)));
  const loaded = loadSnapshot(file.path);
  if (loaded.ui.coordinateSpace !== 'native-top-left-pixels') throw new Error('Render inspection requires native-top-left-pixels coordinates: ' + file.path);
  if (!Array.isArray(loaded.ui.nodes)) throw new Error('Snapshot requires UI nodes.');
  const matches = select(loaded.ui.nodes, input.selector);
  if (matches.length !== 1 || loaded.ui.bindingErrors?.some((e: any) => e.id === input.selector.semanticId)) throw new Error('Rendering selector is missing, ambiguous, or has a binding error.');
  // loadSnapshot reads the receipt itself; require that exact parsed receipt to remain pinned.
  if (sha(bytes(file.path)) !== file.sha256) throw new Error('Snapshot receipt changed during inspection.');
  if (baseline !== undefined && loaded.receipt.sha256 !== baseline.image.sha256) throw new Error('Snapshot image differs from its baseline.');
  return { file, ...loaded, node: matches[0], baseline };
}
const observed = (value: unknown, basis: string): Observation => value === undefined || value === null
  ? { value: null, basis: 'unmeasured' }
  : { value: typeof value === 'string' ? value : JSON.stringify(value), basis };

/** Compose existing CLI evidence without inferring renderer state from pixels or asset names. */
export function renderInspect(specPath: string, output: string, review?: PreparedReview) {
  const raw = bytes(specPath), spec = JSON.parse(raw.toString()), base = dirname(resolve(specPath));
  if (spec.schemaVersion !== 1 || typeof spec.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(spec.id) || !spec.reference || !spec.candidate)
    throw new Error('Render inspection needs schemaVersion 1, an element slug, reference snapshot and candidate image.');
  const reference = snapshot(base, spec.reference);
  if (reference.node.kind !== 'phaser') throw new Error('This inspector requires a captured Phaser sprite or UI element.');
  if (spec.candidate.baseline !== undefined && (typeof spec.candidate.baseline !== 'string' || !spec.candidate.baseline || spec.candidate.image !== undefined)) throw new Error('Use a candidate baseline path or an image pin, not both.');
  const candidateBaseline = spec.candidate.baseline === undefined ? undefined : readBaseline(resolve(base, spec.candidate.baseline));
  const candidate = pinned(base, candidateBaseline === undefined ? spec.candidate.image : candidateBaseline.image);
  pngDimensions(candidate.data);
  PNG.sync.read(candidate.data);
  const unity = spec.candidate.snapshot === undefined ? undefined : snapshot(base, spec.candidate.snapshot);
  if (unity && (unity.receipt.sha256 !== candidate.sha256 || unity.node.kind !== 'ugui')) throw new Error('Candidate snapshot must select uGUI in the pinned candidate image.');
  if (review !== undefined) {
    if (reference.receipt.sha256 !== review.reference.image || candidate.sha256 !== review.candidate.image) throw new Error('Render inspection images do not match the review case.');
    if (reference.file.sha256 !== review.reference.receipt || (unity !== undefined && unity.file.sha256 !== review.candidate.receipt) || (candidateBaseline !== undefined && candidateBaseline.receipt.sha256 !== review.candidate.receipt))
      throw new Error('Render inspection receipts do not match the freshness-checked review case.');
    if (reference.baseline !== undefined) review.checkBaseline(reference.baseline, 'renderInspection.reference');
    if (candidateBaseline !== undefined) review.checkBaseline(candidateBaseline, 'renderInspection.candidate');
    if (unity?.baseline !== undefined) review.checkBaseline(unity.baseline, 'renderInspection.candidate.snapshot');
  }
  const out = emptyOutput(output);
  const evidence: { role: string; path: string; sha256: string }[] = [];
  function save(role: string, name: string, data: Buffer) {
    writeFileSync(join(out, name), data, { flag: 'wx' });
    evidence.push({ role, path: name, sha256: sha(data) });
  }
  save('reference receipt', 'reference-receipt.json', reference.file.data);
  save('reference image', 'reference.png', reference.bytes);
  save('candidate image', 'candidate.png', candidate.data);
  save('inspection spec', 'render-inspect-spec.json', raw);
  if (reference.baseline !== undefined) save('reference baseline', 'reference-baseline.json', pinned(base, reference.baseline.baseline).data);
  if (candidateBaseline !== undefined) save('candidate baseline', 'candidate-baseline.json', pinned(base, candidateBaseline.baseline).data);
  if (unity?.baseline !== undefined) save('candidate snapshot baseline', 'candidate-snapshot-baseline.json', pinned(base, unity.baseline.baseline).data);
  if (unity) save('candidate receipt', 'candidate-receipt.json', unity.file.data);
  let usage: any;
  if (spec.spriteUsage !== undefined) {
    const file = pinned(base, spec.spriteUsage), mapping = JSON.parse(file.data.toString());
    // Check the mapping against this exact selected capture before invoking the existing collector.
    const mappingReceipt = resolve(dirname(file.path), mapping.source.receipt);
    if (sha(bytes(mappingReceipt)) !== reference.file.sha256 || select(reference.ui.nodes, mapping.source.selector).length !== 1 || select(reference.ui.nodes, mapping.source.selector)[0] !== reference.node)
      throw new Error('Sprite usage must select the inspected node in the same reference receipt.');
    const collected = spriteUsage(file.path, join(out, 'usage'));
    const data = bytes(collected.report);
    usage = JSON.parse(data.toString());
    if (usage.specSha256 !== file.sha256 || usage.source.receiptSha256 !== reference.file.sha256 || usage.source.imageSha256 !== reference.receipt.sha256 || usage.source.node !== reference.node.path)
      throw new Error('Sprite usage inputs changed during inspection.');
    save('sprite usage', 'sprite-usage.json', data);
  }
  let authored: any;
  if (spec.unityUi !== undefined) {
    const binding = spec.unityUi, file = pinned(base, binding.receipt), data = JSON.parse(file.data.toString());
    if (data.schemaVersion !== 1 || ['prefab', 'target', 'component', 'field'].some(key => typeof binding[key] !== 'string' || data[key] !== binding[key]) || !data.assetHashes || !data.assetHashes[binding.prefab] || !Array.isArray(data.rgba) || data.rgba.length !== 4 || !Array.isArray(data.canvases) || !Array.isArray(data.canvasGroups))
      throw new Error('Expected a UiCompositing inspection matching the declared prefab, target, component and field.');
    for (const [path, hash] of Object.entries(data.assetHashes))
      if (!digest(hash) || sha(bytes(resolve(root, path))) !== hash) throw new Error('Stale Unity UI inspection: ' + path);
    const runtimeBinding = unity?.node.layoutContext?.prefabBinding;
    if (runtimeBinding && (runtimeBinding.prefab !== binding.prefab || runtimeBinding.target !== binding.target)) throw new Error('Unity UI authoring target differs from captured prefab binding.');
    authored = data;
    save('Unity serialized UI', 'unity-ui.json', file.data);
  }
  let trace: any;
  if (spec.renderTrace !== undefined) {
    const file = pinned(base, spec.renderTrace), collected = renderTrace(file.path, join(out, 'trace'));
    const data = bytes(collected.report);
    trace = JSON.parse(data.toString());
    if (trace.specSha256 !== file.sha256) throw new Error('Render trace spec changed during inspection.');
    save('related render trace', 'render-trace.json', data);
  }
  const rows: { property: string; reference: Observation; candidate: Observation }[] = [];
  const row = (property: string, a: unknown, b: unknown, candidateBasis = 'captured UI node') => rows.push({ property, reference: observed(a, 'captured Phaser node'), candidate: observed(b, candidateBasis) });
  row('Element', reference.node.path, unity?.node.path ?? authored?.target, unity ? 'captured UI node' : 'declared serialized target');
  const sprite = reference.node.sprite;
  row('Texture / sprite', sprite ? sprite.texture + ' / ' + sprite.frame : null, usage ? usage.unity.path + ' (sprite ID ' + usage.unity.fileId + ')' : unity?.node.sprite, usage ? 'project-declared mapping; current asset hashes' : 'captured UI node');
  row('Source rectangle', sprite?.sourceRect, usage?.packing.inspection?.sourceRectBottomLeft, 'imported sprite rectangle; Unity bottom-left coordinates');
  row('Visible', reference.node.visible, unity?.node.visible);
  row('Bounds', reference.node.bounds, unity?.node.bounds);
  row('Mask present', reference.node.clipping?.hasMask, unity?.node.clipping?.hasMask);
  row('Local alpha', reference.node.rendering?.alpha, get(unity?.node, 'rendering.alpha'));
  row('Corner tint / graphic RGBA', reference.node.rendering?.tint, authored?.rgba, 'serialized Graphic color; not effective runtime color');
  row('Blend mode', reference.node.rendering?.blendMode, get(unity?.node, 'rendering.blendMode'));
  row('Pipeline / material', reference.node.rendering?.pipeline, get(unity?.node, 'rendering.material'));
  row('Depth / Canvas sorting', reference.node.layout?.depth, authored?.canvases, 'serialized ancestor Canvas settings; not equivalent to Phaser depth');
  const notApplicable: Observation = { value: null, basis: 'not-applicable' };
  rows.push({ property: 'CanvasGroup alpha', reference: notApplicable, candidate: observed(authored?.canvasGroups, 'serialized ancestor CanvasGroup settings') });
  rows.push({ property: 'Atlas packing', reference: notApplicable, candidate: observed(usage?.packing.status === 'unmeasured' ? null : usage?.packing, 'sprite-usage observation; target-specific') });
  const unmeasured = (value: Observation) => value.value === null && value.basis !== 'not-applicable';
  const gaps = rows.filter(r => unmeasured(r.reference) || unmeasured(r.candidate)).map(r => r.property + ': ' + [unmeasured(r.reference) ? 'reference' : '', unmeasured(r.candidate) ? 'candidate' : ''].filter(Boolean).join(' and ') + ' unmeasured.');
  const report = {
    schemaVersion: 1, kind: 'helix-render-inspection', id: spec.id,
    coordinateSpace: 'native-top-left-pixels',
    images: { reference: reference.receipt.sha256, candidate: candidate.sha256 },
    specSha256: sha(raw), createdUtc: new Date().toISOString(),
    scope: 'Selected node observations and explicitly declared Unity mappings. Properties use engine-specific units; no equality or parity verdict. Serialized settings and related render traces do not establish the candidate image runtime state.',
    rows, gaps, evidence,
    relatedTrace: trace ? { feature: trace.configured.feature.name, pass: trace.pass, active: trace.configured.feature.active, property: trace.configured.property, scope: trace.scope } : null,
    next: 'Capture missing runtime properties at the same scenario and phase. Use sprite-usage for mapping/packing and UiCompositing.Inspect for authored UI color and Canvas settings. Effective opacity, actual pixel shader execution and occlusion remain unmeasured.',
  };
  const path = join(out, 'render-inspection.json');
  writeFileSync(path, JSON.stringify(report, null, 2), { flag: 'wx' });
  return { report: path, sha256: sha(bytes(path)), images: report.images, gaps: gaps.length, note: 'Add this report to workbench prepare reports, or package this directory with workbench evidence.' };
}
