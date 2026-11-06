// Offline trace of one configured URP renderer feature and one exact graph pass.
import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, dirname } from 'node:path';
import { root, sha, emptyOutput } from './config.ts';

function required(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Expected ' + name);
  return value;
}

function local(path: string) {
  const file = realpathSync(resolve(root, path));
  const rel = relative(root, file);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel))
    throw new Error('Asset outside project: ' + path);
  return file;
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return entry.isFile() ? [path] : [];
  });
}

function asset(path: string) {
  const bytes = readFileSync(local(path));
  return { path, sha256: sha(bytes) };
}

// Only consume Force Text fields used by URP's renderer/feature references.
function documents(path: string) {
  const text = readFileSync(local(path), 'utf8');
  const docs = [
    ...text.matchAll(/^--- !u!114 &(-?\d+)\r?\n([\s\S]*?)(?=^--- !u!|(?![\s\S]))/gm),
  ].map((m) => ({ id: m[1], text: m[2] }));
  if (!docs.length) throw new Error('No text-serialized MonoBehaviour in ' + path);
  return docs;
}

function scalar(text: string, field: string) {
  return text.match(new RegExp('^  ' + field + ': ([^\\r\\n]*)', 'm'))?.[1];
}

function refs(text: string, field: string) {
  const block = text.match(
    new RegExp(
      '^  ' + field + ':(?:[ \\t]*\\[\\])?[ \\t]*\\r?\\n((?:  - \\{[^}]*\\}[^\\S\\n]*\\n)*)',
      'm',
    ),
  );
  if (!block) throw new Error('Unsupported or missing serialized list ' + field);
  return [...block[1].matchAll(/\{fileID: (-?\d+)(?:, guid: ([a-f0-9]{32}), type: \d+)?\}/g)].map(
    (m) => ({ id: m[1], guid: m[2] }),
  );
}

function configured(spec: any) {
  const pipeline = required(spec.pipeline, 'pipeline asset path');
  const paths = files(local('Assets')).map((f) => relative(root, f));
  const locate = (guid: string, extension: string) => {
    const matches = paths.filter(
      (p) =>
        p.endsWith(extension + '.meta') &&
        readFileSync(local(p), 'utf8')
          .split(/\r?\n/)
          .includes('guid: ' + guid),
    );
    if (matches.length !== 1)
      throw new Error(
        'Expected one ' + extension + ' under Assets for GUID ' + guid + '; got ' + matches.length,
      );
    return matches[0].slice(0, -5);
  };
  const pipelines = documents(pipeline).filter((d) => d.text.includes('  m_RendererDataList:'));
  if (pipelines.length !== 1) throw new Error('Expected one URP renderer data list in ' + pipeline);
  const data = pipelines[0].text,
    configuredIndex = scalar(data, 'm_DefaultRendererIndex');
  if (configuredIndex === undefined) throw new Error('Missing default renderer index.');
  const index = spec.rendererIndex ?? Number(configuredIndex);
  const entry = refs(data, 'm_RendererDataList')[index];
  if (!Number.isInteger(index) || !entry?.guid)
    throw new Error('Missing renderer at index ' + index);
  const renderer = locate(entry.guid, '.asset'),
    docs = documents(renderer);
  const r = docs.find((d) => d.id === entry.id);
  if (!r) throw new Error('Missing renderer local file ID ' + entry.id);
  const features = refs(r.text, 'm_RendererFeatures')
    .filter((ref) => ref.id !== '0')
    .map((ref) => {
      const path = ref.guid ? locate(ref.guid, '.asset') : renderer;
      const feature = (path === renderer ? docs : documents(path)).find((d) => d.id === ref.id);
      if (!feature) throw new Error('Missing feature subasset ' + path + '#' + ref.id);
      return { path, ...feature };
    })
    .filter((d) => scalar(d.text, 'm_Name') === spec.feature);
  if (features.length !== 1)
    throw new Error(
      'Expected one referenced feature named ' + spec.feature + '; got ' + features.length,
    );
  const f = features[0],
    guid = scalar(f.text, 'm_Script')?.match(/guid: ([a-f0-9]{32})/)?.[1];
  if (!guid) throw new Error('Missing renderer feature script GUID.');
  const script = locate(guid, '.cs');
  const source = readFileSync(local(script), 'utf8').split(/\r?\n/);
  const sourceLines = source.flatMap((line, i) =>
    /AddRenderPasses|EnqueuePass\(|renderPassEvent\s*=|RecordRenderGraph|activeColorTexture|cameraTargetDescriptor|descriptor\.\w+\s*=|AddBlitPass|SetGlobalTextureAfterPass|^\s*if\s*\(/.test(
      line,
    ) ||
    line.includes(spec.property) ||
    line.includes(spec.pass)
      ? [{ line: i + 1, text: line.trim() }]
      : [],
  );
  const token = new RegExp('\\b' + spec.property + '\\b');
  const consumers = paths
    .filter((p) => /\.(shader|hlsl|cginc|compute)$/.test(p))
    .flatMap((path) => {
      const lines = readFileSync(local(path), 'utf8')
        .split(/\r?\n/)
        .flatMap((line, i) => (token.test(line) ? [{ line: i + 1, text: line.trim() }] : []));
      return lines.length ? [{ ...asset(path), lines }] : [];
    });
  const active = scalar(f.text, 'm_Active');
  if (active !== '0' && active !== '1')
    throw new Error('Unsupported renderer feature active flag.');
  return {
    pipeline: asset(pipeline),
    renderer: asset(renderer),
    rendererIndex: index,
    indexSelection: spec.rendererIndex === undefined ? 'pipeline-default' : 'caller-selected',
    settings: Object.fromEntries(
      [
        'm_RequireOpaqueTexture',
        'm_RequireDepthTexture',
        'm_OpaqueDownsampling',
        'm_RenderScale',
        'm_MSAA',
        'm_SupportsHDR',
      ].map((k) => [k, scalar(data, k) ?? null]),
    ),
    feature: {
      ...asset(f.path),
      localId: f.id,
      name: spec.feature,
      active: active === '1',
      script: asset(script),
      sourceLines,
    },
    property: spec.property,
    shaderReferences: consumers,
  };
}

function observation(spec: any, capture: any, specDir: string, featureScript: string) {
  required(capture.fixture, 'capture fixture');
  required(capture.camera, 'capture camera');
  const path = resolve(specDir, required(capture.receipt, 'capture receipt')),
    bytes = readFileSync(path),
    hash = sha(bytes);
  if (hash !== capture.sha256) throw new Error('Capture hash mismatch: ' + path);
  const raw = JSON.parse(bytes.toString());
  let payload = raw;
  if (raw.command === 'command') {
    if (raw.success !== true || raw.data?.result?.success !== true)
      throw new Error('Failed Unity command receipt: ' + path);
    payload = raw.data.result.result;
    if (typeof payload === 'string') payload = JSON.parse(payload);
  }
  const g = payload.viewer;
  if (g?.valid !== true || g.executionName !== capture.camera || !g.passList?.length)
    throw new Error('Invalid graph, empty pass inventory or camera mismatch: ' + path);
  const passes = g.passList;
  const indices = (array: any[], i: number, label: string) => {
    if (!Array.isArray(array) || !Number.isInteger(i) || i < 0 || i >= array.length)
      throw new Error('Invalid graph index: ' + label + ' ' + i);
    return array[i];
  };
  const resources = (lists: any) =>
    Object.entries(lists).flatMap(([kind, ids]: [string, any]) => {
      if (!Array.isArray(ids)) throw new Error('Invalid graph resource list ' + kind);
      return ids.map((id: number) => {
        const r = indices(g.resourceLists[kind], id, kind);
        const descriptorId = (kind === 'm_Textures' ? r.textureData : r.bufferData)?.rid;
        const descriptor =
          g.references?.RefIds?.find((item: any) => item.rid === descriptorId)?.data ?? null;
        return {
          kind,
          id,
          name: r.name,
          imported: r.imported,
          descriptor,
          consumerPasses: r.consumerList.map((n: number) => ({
            index: n,
            name: indices(passes, n, 'consumer').name,
            culled: passes[n].culled,
          })),
        };
      });
    });
  const matches = passes.flatMap((p: any, i: number) => (p.name === spec.pass ? [{ p, i }] : []));
  if (matches.length > 1) throw new Error('Ambiguous graph pass name in ' + path);
  const match = matches[0];
  if (match && typeof match.p.culled !== 'boolean')
    throw new Error('Missing observed graph culling state.');
  const textureInventory = payload.textures;
  const inventoryApplies =
    payload.textureInventoryFilter === undefined ||
    payload.textureInventoryFilter === spec.property;
  const textures =
    inventoryApplies && Array.isArray(textureInventory)
      ? textureInventory.filter((x: any) => x.name === spec.property)
      : null;
  const origin = match?.p.scriptInfo?.filePath?.replaceAll('\\', '/');
  const selectedScript = featureScript.replaceAll('\\', '/');
  return {
    fixture: capture.fixture,
    camera: g.executionName,
    receipt: { path, sha256: hash },
    observationFrame: payload.frame ?? null,
    graphHash: g.graphHash,
    qualityAtObservation: payload.quality ?? null,
    pipelineAtObservation: payload.pipeline ?? null,
    execution: !match ? 'absent' : match.p.culled ? 'culled' : 'present-unculled',
    pass: match
      ? {
          index: match.i,
          name: spec.pass,
          scriptInfo: match.p.scriptInfo,
          configuredScriptPathMatch: origin
            ? origin === selectedScript || origin.endsWith('/' + selectedScript)
            : null,
          reads: resources(match.p.resourceReadLists),
          writes: resources(match.p.resourceWriteLists),
        }
      : null,
    propertyInGraph: g.resourceLists.m_Textures.some((r: any) => r.name === spec.property),
    measured: { editorTextureInventory: textures, deviceGpuTimeMs: null },
  };
}

export function renderTrace(specPath: string, outPath: string) {
  const bytes = readFileSync(specPath),
    spec = JSON.parse(bytes.toString());
  if (spec.schemaVersion !== 1) throw new Error('Expected render-trace schemaVersion 1.');
  required(spec.feature, 'feature');
  required(spec.pass, 'pass');
  required(spec.property, 'property');
  if (!/^[a-zA-Z_]\w*$/.test(spec.property))
    throw new Error('Expected a shader property identifier.');
  if (spec.captures !== undefined && !Array.isArray(spec.captures))
    throw new Error('Expected captures array.');
  const configuration = configured(spec);
  const observations = (spec.captures ?? []).map((c: any) =>
    observation(spec, c, dirname(specPath), configuration.feature.script.path),
  );
  const report = {
    schemaVersion: 1,
    pass: spec.pass,
    specSha256: sha(bytes),
    configured: configuration,
    observations,
    scope:
      'Configuration and shader text describe this checkout. Captures describe the saved camera graphs. Unculled graph entries are scheduling evidence. GPU duration, device residency, actual pixel sampling and the graph capture frame are not inferred from observation-time data.',
  };
  const output = join(emptyOutput(outPath), 'render-trace.json');
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return {
    report: output,
    feature: spec.feature,
    pass: spec.pass,
    active: configuration.feature.active,
    observations: observations.map((o: any) => ({
      fixture: o.fixture,
      camera: o.camera,
      execution: o.execution,
      propertyInGraph: o.propertyInGraph,
    })),
  };
}
