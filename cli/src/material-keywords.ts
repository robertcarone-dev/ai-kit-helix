// Offline inventory of Force Text materials and directly authored ShaderLab keyword sets.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyOutput, root } from './config.ts';

type Material = {
  path: string;
  fileId: string;
  name: string;
  shader: string;
  parent?: string;
  keywords: string[];
  values: Map<string, number>;
  overrides: boolean;
};
type Group = { names: string[]; optional: boolean; local: boolean; line: number };
type Drawer = { property: string; names: string[]; kind: string; initial: number; line: number };
type Shader = {
  path: string;
  name: string;
  fallback?: string;
  urpInspector: boolean;
  groups: Group[];
  drawers: Drawer[];
};
type Finding = {
  path: string;
  fileId?: string;
  material?: string;
  shader?: string;
  reason: string;
  line?: number;
};

function* files(directory: string): Generator<string> {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = directory + '/' + entry.name;
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile()) yield path;
  }
}
function read(path: string) {
  return readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
}
function guid(path: string) {
  return existsSync(join(root, path + '.meta'))
    ? read(path + '.meta').match(/^guid: ([\da-f]{32})$/m)?.[1]
    : undefined;
}
function parseShader(path: string): Shader {
  // Preserve original line numbers in diagnostics.
  const source = read(path)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
  const groups: Group[] = [],
    drawers: Drawer[] = [];
  let depth = 0;
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    let line = lines[i];
    while (line.endsWith('\\') && i + 1 < lines.length) line = line.slice(0, -1) + lines[++i];
    if (/^\s*#\s*(?:if|ifdef|ifndef)\b/.test(line)) depth++;
    if (/^\s*#\s*endif\b/.test(line)) depth--;
    if (depth) continue;
    const pragma = line.match(/^\s*#pragma\s+(shader_feature\w*|multi_compile\w*)\s+([\w \t]+)$/);
    if (pragma) {
      const tokens = pragma[2].trim().split(/\s+/);
      groups.push({
        names: tokens.filter((k) => !/^_+$/.test(k)),
        optional:
          (pragma[1].startsWith('multi_compile') && !pragma[1].includes('_local')) ||
          tokens.some((k) => /^_+$/.test(k)) ||
          (pragma[1].startsWith('shader_feature') && tokens.length === 1),
        local: pragma[1].includes('_local'),
        line: lineNumber,
      });
    }
    const drawer = line.match(
      /\[(KeywordEnum|ToggleOff|Toggle)(?:\(([^)]*)\))?\](?:\s*\[[^\]]+\])*\s*(\w+)\s*\([^\n]*\)\s*=\s*([-+.\deE]+)/,
    );
    if (!drawer) continue;
    const [, kind, args, property, initial] = drawer;
    const names =
      kind === 'KeywordEnum'
        ? args.split(',').map((v) => (property + '_' + v.trim().replace(/\s+/g, '_')).toUpperCase())
        : [args?.trim() || property.toUpperCase() + (kind === 'ToggleOff' ? '_OFF' : '_ON')];
    drawers.push({ property, names, kind, initial: Number(initial), line: lineNumber });
  }
  return {
    path,
    name: source.match(/\bShader\s+"([^"]+)"/i)?.[1] ?? path,
    urpInspector:
      /\bCustomEditor\s+"UnityEditor\.Rendering\.Universal\.ShaderGUI\.(?:LitShader|UnlitShader|ParticlesLitShader|ParticlesUnlitShader)"/.test(
        source,
      ),
    fallback: source.match(/\bFallback\s+"([^"]+)"/i)?.[1],
    groups,
    drawers,
  };
}

function material(path: string, fileId: string, body: string, assetGuid: string): Material {
  const reference = (key: string) =>
    body.match(new RegExp('^  ' + key + ': \\{([^}]+)\\}', 'm'))?.[1];
  const parent = reference('m_Parent');
  const parentId = parent?.match(/fileID: (-?\d+)/)?.[1];
  const keywords = body.match(/^  m_ValidKeywords:[ \t]*(\[[^\n]*\])?\n((?:  - [^\n]+\n)*)/m);
  const words = keywords
    ? keywords[1]
      ? keywords[1].slice(1, -1).split(/[,\s]+/)
      : [...keywords[2].matchAll(/^  - (\S+)/gm)].map((m) => m[1])
    : (body.match(/^  m_ShaderKeywords:[ \t]*(.*)$/m)?.[1] ?? '').split(/\s+/);
  return {
    path,
    fileId,
    name: body.match(/^  m_Name: (.*)$/m)?.[1] ?? fileId,
    shader: reference('m_Shader')?.match(/guid: ([\da-f]{32})/)?.[1] ?? '',
    parent:
      parentId && parentId !== '0'
        ? (parent!.match(/guid: ([\da-f]{32})/)?.[1] ?? assetGuid) + ':' + parentId
        : undefined,
    keywords: words.filter(Boolean),
    overrides: !/^  m_ModifiedSerializedProperties: 0$/m.test(body),
    values: new Map(
      [...body.matchAll(/^    - (\w+): ([-+.\deE]+)$/gm)].map((m) => [m[1], Number(m[2])]),
    ),
  };
}
const urpControls: [string, string, (value: number) => boolean][] = [
  ['_ReceiveShadows', '_RECEIVE_SHADOWS_OFF', (v) => v === 0],
  ['_Surface', '_SURFACE_TYPE_TRANSPARENT', (v) => v === 1],
  ['_AlphaClip', '_ALPHATEST_ON', (v) => v >= 0.5],
  ['_FlipbookBlending', '_FLIPBOOKBLENDING_ON', (v) => v > 0],
];

function inspect(
  m: Material,
  index: Map<string, Material>,
  shader: Shader,
  shadersByName: Map<string, Shader[]>,
  mismatches: Finding[],
  review: Finding[],
) {
  const note = (reason: string, line?: number) => ({
    path: m.path,
    fileId: m.fileId,
    material: m.name,
    shader: shader.path,
    reason,
    line,
  });
  let base = m;
  const chain = [m];
  while (base.parent) {
    const p = index.get(base.parent);
    if (
      !p ||
      chain.includes(p) ||
      p.shader !== m.shader ||
      base.keywords.length ||
      base.overrides
    ) {
      review.push(note('Unresolved material variant parent or serialized keyword overrides'));
      return;
    }
    chain.push(p);
    base = p;
  }
  const selected = new Set(base.keywords);
  const known = new Set(shader.groups.flatMap((g) => g.names));
  for (const group of shader.groups) {
    const active = group.names.filter((k) => selected.has(k));
    if (active.length <= 1 && (active.length || group.optional)) continue;
    const reason =
      'Keyword set [' + group.names.join(', ') + '] selects ' + (active.join(', ') || 'none');
    (group.local ? mismatches : review).push(note(reason, group.line));
  }
  for (const d of shader.drawers) {
    if (!d.names.every((k) => known.has(k))) continue;
    const value = chain.find((p) => p.values.has(d.property))?.values.get(d.property) ?? d.initial;
    const expected =
      d.kind === 'KeywordEnum'
        ? d.names[value]
        : (d.kind === 'ToggleOff' ? value === 0 : value !== 0)
          ? d.names[0]
          : undefined;
    const actual = d.names.filter((k) => selected.has(k));
    if (
      (d.kind === 'KeywordEnum' && expected === undefined) ||
      actual.length !== Number(expected !== undefined) ||
      actual[0] !== expected
    )
      mismatches.push(
        note(
          d.property +
            '=' +
            value +
            ' expects ' +
            (expected ?? (d.kind === 'KeywordEnum' ? 'a valid enum index' : 'off')) +
            '; selected ' +
            (actual.join(', ') || 'none'),
          d.line,
        ),
      );
  }
  // These properties are synchronized by URP's inspector, independently of ShaderLab drawers.
  // Route discrepancies to the installed inspector for review since package versions may differ.
  if (shader.urpInspector) {
    for (const [property, keyword, enabled] of urpControls) {
      const value = chain.find((p) => p.values.has(property))?.values.get(property);
      if (value !== undefined && known.has(keyword) && selected.has(keyword) !== enabled(value))
        review.push(
          note(
            `Inspect URP ShaderGUI: ${property}=${value}, ${keyword} is ${selected.has(keyword) ? 'on' : 'off'}`,
          ),
        );
    }
  }
  for (const k of selected) {
    if (known.has(k)) continue;
    const fallback = shader.fallback && shadersByName.get(shader.fallback);
    const inherited =
      fallback && fallback.length === 1 && fallback[0].groups.some((g) => g.names.includes(k));
    review.push(
      note(
        inherited
          ? k + ' is declared by fallback ' + shader.fallback
          : k +
              ' has no direct declaration in the inspected keyword sets; inspect includes, passes and fallback',
      ),
    );
  }
}

export function materialKeywords(outPath: string) {
  const mismatches: Finding[] = [],
    review: Finding[] = [],
    unscanned: string[] = [];
  const shaderPaths = new Map<string, string[]>(),
    shadersByName = new Map<string, Shader[]>(),
    parsed = new Map<string, Shader>();
  const index = new Map<string, Material>(),
    materials: Material[] = [];
  if (!existsSync(join(root, 'Assets'))) throw new Error('Expected a Unity project with Assets/');
  for (const directory of ['Assets', 'Packages', 'Library/PackageCache']) {
    if (!existsSync(join(root, directory))) continue;
    for (const path of files(directory)) {
      if (/\.(shader|shadergraph)$/.test(path)) {
        const key = guid(path);
        if (key) shaderPaths.set(key, [...(shaderPaths.get(key) ?? []), path]);
        continue;
      }
      if (directory === 'Library/PackageCache' || !/\.(mat|asset|prefab|unity)$/.test(path))
        continue;
      const body = read(path);
      if (!body.startsWith('%YAML')) {
        unscanned.push(path);
        continue;
      }
      const blocks = [
        ...body.matchAll(/^--- !u!21 &(-?\d+)\nMaterial:\n([\s\S]*?)(?=^--- !u!|(?![\s\S]))/gm),
      ];
      if (!blocks.length) {
        if (path.endsWith('.mat')) unscanned.push(path);
        continue;
      }
      const key = guid(path);
      if (!key) {
        unscanned.push(path);
        continue;
      }
      for (const [, id, text] of blocks) {
        const m = material(path, id, text, key);
        if (index.has(key + ':' + id))
          throw new Error('Duplicate material identity: ' + path + '#' + id);
        index.set(key + ':' + id, m);
        materials.push(m);
      }
    }
  }
  for (const paths of shaderPaths.values())
    for (const path of paths) {
      if (!path.endsWith('.shader')) continue;
      const shader = parseShader(path);
      parsed.set(path, shader);
      shadersByName.set(shader.name, [...(shadersByName.get(shader.name) ?? []), shader]);
    }
  for (const m of materials) {
    const paths = shaderPaths.get(m.shader) ?? [];
    const shader = paths.length === 1 && parsed.get(paths[0]);
    if (!shader) {
      review.push({
        path: m.path,
        fileId: m.fileId,
        material: m.name,
        reason: 'Shader GUID ' + (m.shader || '(none)') + ' unresolved, ambiguous or generated',
        shader: paths.join(', '),
      });
      continue;
    }
    inspect(m, index, shader, shadersByName, mismatches, review);
  }
  const summary = {
    materials: materials.length,
    variants: materials.filter((m) => m.parent).length,
    mismatches: mismatches.length,
    review: review.length,
    unscanned: unscanned.length,
  };
  const reportPath = join(emptyOutput(outPath), 'material-keywords.json');
  writeFileSync(
    reportPath,
    JSON.stringify({ schemaVersion: 1, summary, mismatches, review, unscanned }, null, 2) + '\n',
  );
  return { reportPath, ...summary };
}
