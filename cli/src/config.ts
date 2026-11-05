import { readFileSync, existsSync, realpathSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

/** Resolve the consuming checkout from --project-root or its nearest adapter.
 * Never infer project identity from this toolkit’s installation directory. */
export function projectRoot(args = process.argv.slice(2), cwd = process.cwd()) {
  const indexes = args.flatMap((arg, i) => (arg === '--project-root' ? [i] : []));
  if (indexes.length > 1) throw new Error('Supply --project-root only once.');
  if (indexes.length) {
    const value = args[indexes[0] + 1];
    if (!value || value.startsWith('--')) throw new Error('--project-root requires a directory.');
    const explicit = realpathSync(resolve(cwd, value));
    if (!existsSync(resolve(explicit, 'Tools/Helix/reference.json')))
      throw new Error('Project root needs Tools/Helix/reference.json.');
    return explicit;
  }
  let dir = realpathSync(cwd);
  while (!existsSync(resolve(dir, 'Tools/Helix/reference.json'))) {
    const parent = dirname(dir);
    if (parent === dir) return realpathSync(cwd); // Pure image utilities and help need no adapter.
    dir = parent;
  }
  return dir;
}
// Each process fixes its project context once; child processes receive it explicitly.
export const root = projectRoot();
export const stateDir = resolve(root, '.helix');
export const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
/** Restrict browser navigation and service requests to credential-free loopback URLs. */
export function localUrl(raw: string) {
  const u = new URL(raw);
  if (
    !['http:', 'https:'].includes(u.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ||
    u.username ||
    u.password
  )
    throw new Error('Preview must be an HTTP(S) loopback URL without credentials.');
  return u.href;
}

export function validateStep(s: any) {
  if (!s || typeof s !== 'object') throw new Error('Step must be an object.');
  if (
    s.kind === 'script' &&
    ['fixture', 'instrumentation'].includes(s.purpose) &&
    typeof s.expression === 'string'
  )
    return s;
  if (s.kind === 'wait' && typeof s.until === 'string') return s;
  if (s.kind === 'assert' && typeof s.expression === 'string' && Object.hasOwn(s, 'expected'))
    return s;
  if (['hover', 'pointerDown', 'pointerUp'].includes(s.kind) && [s.x, s.y].every(Number.isFinite))
    return s;
  if (
    s.kind === 'wheel' &&
    [s.x, s.y, s.deltaX, s.deltaY].every(Number.isFinite) &&
    Math.abs(s.deltaX) <= 10000 &&
    Math.abs(s.deltaY) <= 10000
  )
    return s;
  if (s.kind === 'press' && (typeof s.target === 'string' || [s.x, s.y].every(Number.isFinite)))
    return s;
  if (
    s.kind === 'drag' &&
    [s.x, s.y, s.toX, s.toY].every(Number.isFinite) &&
    Number.isInteger(s.durationMs ?? 300) &&
    (s.durationMs ?? 300) >= 16 &&
    (s.durationMs ?? 300) <= 5000
  )
    return s;
  throw new Error(
    'Invalid step: use press, drag, hover, pointerDown, pointerUp, wheel, wait, assert, or a script labelled fixture/instrumentation.',
  );
}

/** Expand project-owned scripts and hash their exact contents for action receipts. */
export function loadStep(s: any) {
  if (s?.kind !== 'script' || s.file === undefined) return validateStep(s);
  if (typeof s.file !== 'string' || s.expression !== undefined)
    throw new Error('Script needs either file or expression.');
  const path = realpathSync(resolve(root, s.file));
  const within = relative(root, path);
  if (within.startsWith('..') || isAbsolute(within))
    throw new Error('Script file must be inside this checkout.');
  const expression = readFileSync(path, 'utf8');
  return validateStep({ ...s, expression, sha256: sha(expression) });
}

/** Merge local overrides (shallow except helix), validate, then hash the effective config. */
export function readConfig(url?: string) {
  if (!existsSync(resolve(root, 'Tools/Helix/reference.json')))
    throw new Error(
      'No project adapter found. Run from a configured checkout or use --project-root DIR.',
    );
  const base = JSON.parse(readFileSync(resolve(root, 'Tools/Helix/reference.json'), 'utf8'));
  const local = resolve(root, 'Tools/Helix/reference.local.json');
  const overrides = existsSync(local) ? JSON.parse(readFileSync(local, 'utf8')) : {};
  const config = { ...base, ...overrides, helix: { ...base.helix, ...overrides.helix } };
  if (config.uiBindingsFile || config.uiBindingsFiles) {
    if (
      config.uiBindingsFiles !== undefined &&
      (!Array.isArray(config.uiBindingsFiles) || !config.uiBindingsFiles.length)
    )
      throw new Error('uiBindingsFiles must be a nonempty file list.');
    const files = [
      ...(config.uiBindingsFile ? [config.uiBindingsFile] : []),
      ...(config.uiBindingsFiles ?? []),
    ];
    const ids = new Set();
    config.uiBindings = files.flatMap((file) => {
      if (typeof file !== 'string' || !file) throw new Error('UI binding file must be a path.');
      const path = realpathSync(resolve(root, file));
      if (relative(root, path).startsWith('..'))
        throw new Error('UI bindings must be inside the project.');
      const bindings = JSON.parse(readFileSync(path, 'utf8'));
      if (bindings.schemaVersion !== 1 || !Array.isArray(bindings.elements))
        throw new Error('UI bindings need schemaVersion:1 and elements.');
      return bindings.elements.map((e: any) => {
        if (typeof e.id !== 'string' || !e.id || ids.has(e.id) || typeof e.reference !== 'string')
          throw new Error('Invalid or duplicate UI binding.');
        ids.add(e.id);
        return { id: e.id, expression: e.reference };
      });
    });
  }
  if (config.sceneBindings !== undefined) {
    if (!Array.isArray(config.sceneBindings)) throw new Error('sceneBindings must be a list');
    const ids = new Set((config.uiBindings ?? []).map((b) => b.id));
    for (const b of config.sceneBindings) {
      if (
        typeof b.id !== 'string' ||
        !b.id ||
        ids.has(b.id) ||
        typeof b.expression !== 'string' ||
        !b.expression
      )
        throw new Error('Invalid or duplicate scene binding');
      ids.add(b.id);
    }
  }
  if (config.uiClockHold !== undefined && config.uiClockHold !== 'phaser-loop')
    throw new Error('Supported uiClockHold is phaser-loop.');
  if (config.uiClockHold && !config.phaser)
    throw new Error('Phaser clock hold needs a phaser expression.');
  if (url ?? config.url) config.url = localUrl(url ?? config.url);
  if (!config.helix?.project || !config.helix?.variant)
    throw new Error('Config needs helix.project and helix.variant.');
  if (typeof config.ready !== 'string' || !config.ready)
    throw new Error('Config needs a ready expression.');
  if (!Object.keys(config.viewports ?? {}).length) throw new Error('Config needs viewports.');
  for (const size of Object.values(config.viewports) as any[])
    if (![size.width, size.height].every((n) => Number.isInteger(n) && n > 0 && n <= 4096))
      throw new Error('Viewport dimensions must be integers 1..4096.');
  for (const s of Object.values(config.scenarios ?? {}) as any[]) {
    if (!Array.isArray(s.steps) || typeof s.ready !== 'string')
      throw new Error('Scenario needs steps and ready.');
    s.steps = s.steps.map(loadStep);
    if (s.captureSteps) s.captureSteps = s.captureSteps.map(loadStep);
  }
  return { config, configHash: sha(JSON.stringify(config)) };
}

/** Reserve a new or empty evidence directory; never overwrite an earlier capture. */
export function emptyOutput(path: string) {
  const out = resolve(root, path);
  if (existsSync(out) && readdirSync(out).length)
    throw new Error('Output directory must be empty; existing evidence is never overwritten.');
  mkdirSync(out, { recursive: true });
  return out;
}
