import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { emptyOutput, root, sha } from './config.ts';
import { loadSnapshot, select } from './ui.ts';

const guidOf = (meta: string) => meta.match(/^guid: ([0-9a-f]{32})\r?$/m)?.[1];
function projectFile(path: string) {
  if (typeof path !== 'string' || !path.startsWith('Assets/'))
    throw new Error('Expected an Assets/ path.');
  const file = realpathSync(resolve(root, path));
  if (!file.startsWith(join(root, 'Assets') + sep))
    throw new Error('Asset outside project: ' + path);
  return file;
}
function inventory(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = join(dir, entry.name);
    return entry.isDirectory()
      ? inventory(p)
      : entry.isFile()
        ? [relative(root, p).split(sep).join('/')]
        : [];
  });
}
function consumers(files: string[], guid: string, id: string) {
  const references = [],
    unreadable = [],
    parents = new Map<string, Set<string>>(),
    prefabIds = new Map<string, string>();
  for (const path of files.filter((f) => f.endsWith('.prefab'))) {
    const data = readFileSync(projectFile(path), 'utf8');
    if (!data.startsWith('%YAML')) {
      unreadable.push(path);
      continue;
    }
    const meta = guidOf(readFileSync(projectFile(path + '.meta'), 'utf8'));
    if (!meta) throw new Error('Missing prefab GUID: ' + path);
    prefabIds.set(path, meta);
    let objectId = '',
      propertyPath = '';
    const lines = data.split(/\r?\n/);
    for (const [i, line] of lines.entries()) {
      if (line.startsWith('--- ')) {
        objectId = line.match(/&(-?\d+)/)?.[1] ?? '';
        propertyPath = '';
      }
      const property = line.match(/^\s+propertyPath: (.*)$/);
      if (property) propertyPath = property[1];
      const ref = line.match(
        /^\s*(?:-\s*)?([\w.]+):\s*\{fileID: (-?\d+), guid: ([0-9a-f]{32}), type: \d+\}/,
      );
      if (ref?.[1] === 'm_SourcePrefab') {
        const paths = parents.get(ref[3]) ?? new Set<string>();
        paths.add(path);
        parents.set(ref[3], paths);
      }
      // Arrays can contain bare PPtrs. Keep the file and line even without a field label.
      if (
        line.includes(guid) &&
        [...line.matchAll(/\{fileID:\s*(-?\d+),\s*guid:\s*([0-9a-f]{32}),\s*type:\s*\d+\}/g)].some(
          (m) => m[1] === id && m[2] === guid,
        )
      )
        references.push({
          prefab: path,
          objectId,
          line: i + 1,
          field: ref?.[1] === 'objectReference' ? propertyPath : (ref?.[1] ?? null),
        });
    }
  }
  const pending = [...new Set(references.map((r) => r.prefab))],
    seen = new Set(pending),
    edges = [];
  for (const child of pending) {
    for (const parent of parents.get(prefabIds.get(child)!) ?? []) {
      edges.push({ child, parent });
      if (!seen.has(parent)) {
        seen.add(parent);
        pending.push(parent);
      }
    }
  }
  return {
    serializedReferences: references,
    nestedPrefabEdges: edges,
    unscannedBinaryPrefabs: unreadable,
  };
}
function atlasMembership(paths: string[], spritePath: string, guid: string, id: string) {
  const folders = new Set<string>();
  for (let dir = dirname(spritePath); dir !== 'Assets'; dir = dirname(dir)) {
    if (existsSync(resolve(root, dir + '.meta'))) {
      const folderGuid = guidOf(readFileSync(projectFile(dir + '.meta'), 'utf8'));
      if (folderGuid) folders.add(folderGuid);
    }
  }
  return paths
    .filter((p) => /\.spriteatlas(v2)?$/.test(p))
    .map((path) => {
      const raw = readFileSync(projectFile(path), 'utf8');
      const list = raw.match(/^( *)packables:\s*\r?\n((?:\1- [^\n]*\n?)*)/m);
      const entries = [...(list?.[2] ?? '').matchAll(/fileID: (-?\d+), guid: ([0-9a-f]{32})/g)];
      const matches = entries.filter(
        (m) => (m[2] === guid && (m[1] === id || m[1] === '2800000')) || folders.has(m[2]),
      );
      return {
        path,
        sha256: sha(readFileSync(projectFile(path))),
        membership: matches.length ? 'listed' : list ? 'no-direct-match' : 'unmeasured',
        matches: matches.map((m) => ({
          guid: m[2],
          fileId: m[1],
          kind: folders.has(m[2]) ? 'folder' : m[1] === id ? 'sprite' : 'texture',
        })),
      };
    });
}
export function spriteUsage(specPath: string, outPath: string) {
  const specBytes = readFileSync(specPath),
    s = JSON.parse(specBytes.toString());
  if (
    s.schemaVersion !== 1 ||
    typeof s.unity?.fileId !== 'string' ||
    !/^(-?[1-9]\d*)$/.test(s.unity.fileId) ||
    !s.source?.texture ||
    !['string', 'number'].includes(typeof s.source.frame)
  )
    throw new Error(
      'Expected schemaVersion 1, texture/frame and a Unity sprite fileId as a decimal string.',
    );
  const receiptPath = resolve(dirname(specPath), s.source.receipt),
    snapshot = loadSnapshot(receiptPath);
  const matches = select(snapshot.ui.nodes, s.source.selector);
  if (
    matches.length !== 1 ||
    snapshot.ui.bindingErrors?.some((e: any) => e.id === s.source.selector.semanticId)
  )
    throw new Error('Missing, ambiguous or failed Phaser frame binding.');
  const node = matches[0];
  if (
    node.kind !== 'phaser' ||
    node.sprite?.texture !== s.source.texture ||
    node.sprite?.frame !== s.source.frame
  )
    throw new Error('Selected Phaser node does not have the declared texture/frame.');
  const file = projectFile(s.unity.path),
    meta = readFileSync(projectFile(s.unity.path + '.meta'));
  const guid = guidOf(meta.toString());
  if (!guid || guid !== s.unity.guid) throw new Error('Unity sprite GUID does not match its meta.');
  const assetSha256 = sha(readFileSync(file)),
    metaSha256 = sha(meta),
    paths = inventory(join(root, 'Assets'));
  let packing: any = {
    status: 'unmeasured',
    next: 'Export Helix.Comparison.SpriteUsageCapture.Inspect(path, fileId) from the intended packed target.',
  };
  if (s.inspection) {
    const data = readFileSync(resolve(dirname(specPath), s.inspection.path));
    if (sha(data) !== s.inspection.sha256)
      throw new Error('Sprite inspection receipt hash mismatch.');
    const r = JSON.parse(data.toString());
    if (
      r.schemaVersion !== 1 ||
      r.path !== s.unity.path ||
      r.guid !== guid ||
      r.fileId !== s.unity.fileId ||
      r.assetSha256 !== assetSha256 ||
      r.metaSha256 !== metaSha256
    )
      throw new Error('Stale or mismatched imported sprite inspection.');
    if (!Array.isArray(r.atlases) || !r.buildTarget)
      throw new Error('Incomplete atlas inspection.');
    for (const a of r.atlases) {
      if (
        sha(readFileSync(projectFile(a.path))) !== a.sha256 ||
        sha(readFileSync(projectFile(a.path + '.meta'))) !== a.metaSha256
      )
        throw new Error('Stale atlas asset or importer: ' + a.path);
    }
    packing = {
      status: r.atlases.some((a: any) => a.page) ? 'observed-at-capture' : 'no-page-observed',
      receiptSha256: sha(data),
      inspection: r,
    };
  }
  const report = {
    schemaVersion: 1,
    specSha256: sha(specBytes),
    source: {
      receipt: receiptPath,
      receiptSha256: sha(readFileSync(receiptPath)),
      imageSha256: snapshot.receipt.sha256,
      scenario: snapshot.receipt.scenario,
      node: node.path,
      semanticId: node.semanticId,
      sprite: node.sprite,
    },
    mapping: 'project-declared correspondence',
    unity: { ...s.unity, assetSha256, metaSha256 },
    ...consumers(paths, guid, s.unity.fileId),
    authoredAtlases: atlasMembership(paths, s.unity.path, guid, s.unity.fileId),
    packing,
    scope:
      'Project Assets text prefab references and containment; overrides and runtime assignments can change rendering. Packed pages are target-specific historical observations; device residency is unmeasured.',
  };
  const output = join(emptyOutput(outPath), 'sprite-usage.json');
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return {
    report: output,
    texture: s.source.texture,
    frame: s.source.frame,
    unitySprite: s.unity.path,
    directReferences: report.serializedReferences.length,
    nestedEdges: report.nestedPrefabEdges.length,
    packing: packing.status,
  };
}
