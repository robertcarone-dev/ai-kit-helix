import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { emptyOutput, root, sha } from './config.ts';

function projectFile(path: string) {
  const file = realpathSync(resolve(root, path));
  const name = relative(root, file);
  if (isAbsolute(name) || name === '..' || name.startsWith('../'))
    throw new Error('Ownership input outside checkout: ' + path);
  return file;
}

export function visualOwner(specPath: string, output: string) {
  const specBytes = readFileSync(specPath),
    spec = JSON.parse(specBytes.toString());
  const fields = ['prefab', 'target', 'component', 'field'] as const;
  if (
    spec.schemaVersion !== 1 ||
    fields.some((k) => typeof spec[k] !== 'string' || (k !== 'target' && !spec[k].trim())) ||
    !/^Assets\/.+\.prefab$/.test(spec.prefab) ||
    spec.prefab.split('/').some((x: string) => x === '..' || x === '.')
  )
    throw new Error('Specify schemaVersion 1, prefab, target, component and serialized field.');
  const args = fields.map((k) => JSON.stringify(spec[k])).join(', ');
  const plan = {
    inspect: `Helix.Comparison.VisualOwnership.Inspect(${args})`,
    begin: `Helix.Comparison.VisualOwnership.Begin(instance, ${args})`,
    checkpoint: 'Helix.Comparison.VisualOwnership.Checkpoint("named phase")',
    end: 'Helix.Comparison.VisualOwnership.End()',
  };
  const out = emptyOutput(output);
  const binding = Object.fromEntries(fields.map((k) => [k, spec[k]]));
  const report: Record<string, unknown> = {
    schemaVersion: 1,
    binding,
    specSha256: sha(specBytes),
    plan,
  };
  if (!spec.receipt) {
    report.status = 'inspection-required';
    report.next =
      'Inspect the prefab; bind the exact live instance and arm Begin before the owner initializes or changes this field.';
  } else {
    const bytes = readFileSync(projectFile(spec.receipt)),
      data = JSON.parse(bytes.toString());
    if (
      data.schemaVersion !== 1 ||
      fields.some((k) => data[k] !== spec[k]) ||
      !data.assetHashes?.[spec.prefab] ||
      !data.sourceChain?.length ||
      data.serializedOwner !== data.sourceChain.at(-1).prefab ||
      data.sourceChain.some((s: any) => !data.assetHashes[s.prefab])
    )
      throw new Error('Receipt does not describe the requested property and prefab chain.');
    const stale = Object.entries(data.assetHashes)
      .filter(
        ([path, hash]) =>
          !existsSync(resolve(root, path)) || sha(readFileSync(projectFile(path))) !== hash,
      )
      .map(([path]) => path);
    const events = data.events ?? [];
    const checkpoints = events.filter((e: any) => e.kind === 'checkpoint');
    const writes = events.filter((e: any) =>
      ['setter-stack', 'instrumented-write-site'].includes(e.kind),
    );
    const active = checkpoints.flatMap((c: any) =>
      c.activeBindings
        .filter((b: any) => b.clipWeight > 0 && b.layerWeight > 0)
        .map((b: any) => ({ ...b, checkpoint: c.label, frame: c.frame })),
    );
    Object.assign(report, {
      receipt: spec.receipt,
      receiptSha256: sha(bytes),
      assetHashes: data.assetHashes,
      instanceId: data.instanceId,
      stale,
      serializedOwner: data.serializedOwner,
      sourceChain: data.sourceChain,
      referencesToTarget: data.referencesToTarget,
      configuredClips: data.clipBindings,
      activeClipBindings: active,
      writes,
      checkpoints,
      omittedEvents: data.omittedEvents ?? 0,
      bindingMethod: data.bindingMethod ?? 'asset-inspection',
    });
    if (stale.length) {
      report.status = 'stale';
      report.next = 'Reinspect changed inputs before editing.';
    } else if (data.bindingMethod && !events.some((e: any) => e.kind === 'target-destroyed' || (e.kind === 'checkpoint' && e.label === 'end')) || data.omittedEvents) {
      report.status = 'incomplete';
      report.next = 'Capture the relevant action in a shorter window and save the receipt returned by End.';
    } else if (writes.length && active.length) {
      report.status = 'multiple-drivers-observed';
      report.next =
        'Compare the setter stacks and clip bindings at the named checkpoints; isolate their ordering before editing.';
    } else if (writes.length) {
      report.status = 'runtime-write-observed';
      report.next =
        'Inspect the recorded call chain and its input data at the relevant write before editing the prefab default.';
    } else if (active.length) {
      report.status = 'active-animation-binding';
      report.next =
        'Inspect the bound clip, layer, weight and transition at this checkpoint. Confirm the curve contribution before editing.';
    } else {
      report.status = events.length ? 'runtime-writer-unresolved' : 'serialized-owner-only';
      report.next =
        'Inspect the serialized references and clip bindings. Trace before initialization, or instrument the exact assignment with Applied; an unchanged value does not exclude a same-value write.';
    }
  }
  const reportPath = join(out, 'ownership.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return { reportPath, ...report };
}
