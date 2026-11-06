import { unityPlan } from './unity-plan.ts';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  openSync,
  closeSync,
} from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { root, stateDir, readConfig, sha } from './config.ts';
import { discover, assets } from './discovery.ts';

/** Short-lived command client. The detached host owns the browser between invocations. */
const file = join(stateDir, 'connection.json');
const help = `helix — project-owned local reference tools (Node >=22.18)
  discrepancy-resume [--feature NAME] [--assignment ID] [--status active|open|blocked|resolved|accepted-deviation|all]
  discrepancy-save --spec FILE [--after REVISION]
  discrepancy-rerun --id ID --out SCRATCH_DIR [--execute yes]
  fixture-list | fixture-create --spec FILE
  fixture-record ID --out NEW_DIR
  fixture-handoff --recording DIR --notes JSON_FILE --out NEW_ZIP
  doctor | resolve
  assets [--match TEXT]
  unity-plan SCENARIO --out DIR [--viewport phone|tablet]
  start [--viewport phone|tablet] [--url http://127.0.0.1:PORT/...]
  status | reset | stop
  recover                       recheck timed-out scenario readiness; no setup replay
  scenario NAME
  look [--match TEXT]
  scene-record --out EMPTY_DIR [--duration SECONDS] [--interval-ms MS] [--profile NAME]
  vfx-compare --spec FILE --out NEW_DIR
  scene-motion --reference JSON --candidate JSON --spec JSON --out EMPTY_DIR
  scene-look [--profile NAME]    read-only hierarchy and scene measurements
  scene-compare --reference JSON --candidate JSON --spec JSON --out EMPTY_DIR
  scene-report --reference RECEIPT --candidate RECEIPT --spec JSON --out EMPTY_DIR
  scene-case --spec MATRIX --out SCRATCH_DIR [--execute yes] [--ai-kit PATH]
  conversion-plan --spec MANIFEST --out EMPTY_DIR
  ui-look [--match TEXT]          UI metrics and semantic bindings
  step JSON                     press/drag/hover/pointerDown/pointerUp/wheel/wait/assert/script
  capture NAME [--out EMPTY_DIR] [--scene-profile NAME]
  record NAME [--duration SECONDS] [--out EMPTY_DIR]  replays named scenario; max 30s
  ui-assets --spec JSON --out EMPTY_DIR
  ui-plan --spec JSON --out EMPTY_DIR
  ui-impact --spec JSON [--previous JSON] --out EMPTY_DIR
  ui-compare --reference RECEIPT --candidate RECEIPT --spec JSON --out EMPTY_DIR
  batch --spec JSON --out EMPTY_DIR [--workers 1|2] [--resume yes]
  ui-matrix --spec JSON --out EMPTY_DIR [--execute yes] [--ai-kit PATH]
  compare --reference PNG --candidate PNG --out EMPTY_DIR
Every command accepts --project-root DIR; otherwise discover from the working directory.\nRelative file paths are project-relative. Config: Tools/Helix/reference.json; optional reference.local.json top-level overrides.
Start discovers the configured project/variant and opens local Helix Desktop if needed.
Helix serves source/assets and starts its preview on demand; stop closes only our browser.
Session/evidence state is per checkout in .helix/. No AI Kit installation required.`;
function connection() {
  if (!existsSync(file)) throw new Error('No session. Run helix start.');
  const s = JSON.parse(readFileSync(file, 'utf8'));
  if (s.projectRoot !== root) throw new Error('Session belongs to another checkout.');
  return s;
}

/** Exchange one newline-delimited JSON message with the checkout’s token-authenticated host. */
export function request(s: any, data: any, timeout = 65000): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: s.port });
    let body = '';
    socket.setTimeout(timeout, () =>
      socket.destroy(new Error('Request timed out; inspect status before retrying.')),
    );
    socket.on('error', reject);
    socket.on('connect', () => socket.write(JSON.stringify({ ...data, token: s.token }) + '\n'));
    socket.on('data', (chunk) => {
      body += chunk;
      if (body.length > 8_000_000) {
        socket.destroy(new Error('Response too large.'));
        return;
      }
      if (!body.includes('\n')) return;
      socket.end();
      try {
        const r = JSON.parse(body.split('\n')[0]);
        if (!r.ok) reject(new Error(r.error));
        else resolve(r.result);
      } catch (e) {
        reject(e);
      }
    });
    socket.on('end', () => {
      if (!body.includes('\n')) reject(new Error('Host ended without a response.'));
    });
  });
}

async function main() {
  const args = process.argv.slice(2),
    command = args.shift();
  const options: Record<string, string> = {},
    pos: string[] = [];
  while (args.length) {
    const a = args.shift()!;
    if (a.startsWith('--')) {
      if (a === '--help') {
        console.log(help);
        return;
      }
      const v = args.shift();
      if (!v || v.startsWith('--')) throw new Error('Missing value for ' + a);
      options[a.slice(2)] = v;
    } else pos.push(a);
  }
  if (!command || ['help', '--help', '-h'].includes(command)) {
    console.log(help);
    return;
  }
  const allowed: Record<string, string[]> = {
    'discrepancy-resume': ['feature', 'assignment', 'status'],
    'discrepancy-rerun': ['id', 'out', 'execute', 'ai-kit'],
    'discrepancy-save': ['spec', 'after'],
    'fixture-list': [],
    'fixture-create': ['spec'],
    'fixture-record': ['out'],
    'fixture-handoff': ['recording', 'notes', 'out'],
    doctor: [],
    resolve: [],
    assets: ['match'],
    'unity-plan': ['out', 'viewport'],
    start: ['viewport', 'url'],
    status: [],
    reset: [],
    stop: [],
    recover: [],
    scenario: [],
    look: ['match'],
    'ui-look': ['match'],
    'scene-look': ['profile'],
    'scene-record': ['out', 'duration', 'interval-ms', 'profile'],
    'vfx-compare': ['spec', 'out'],
    'scene-motion': ['reference', 'candidate', 'spec', 'out'],
    'scene-report': ['reference', 'candidate', 'spec', 'out'],
    'conversion-plan': ['spec', 'out'],
    'scene-case': ['spec', 'out', 'execute', 'ai-kit'],
    'scene-compare': ['reference', 'candidate', 'spec', 'out'],
    step: [],
    capture: ['out', 'scene-profile'],
    record: ['out', 'duration'],
    'ui-assets': ['spec', 'out'],
    'ui-plan': ['spec', 'out'],
    'ui-impact': ['spec', 'previous', 'out'],
    'ui-compare': ['reference', 'candidate', 'spec', 'out'],
    batch: ['spec', 'out', 'workers', 'resume'],
    'ui-matrix': ['spec', 'out', 'execute', 'ai-kit'],
    compare: ['reference', 'candidate', 'out'],
  };
  if (!allowed[command]) throw new Error('Unknown command ' + command);
  for (const k of Object.keys(options))
    if (k !== 'project-root' && !allowed[command].includes(k))
      throw new Error('Unknown option --' + k);
  if (['scenario', 'step', 'capture', 'record'].includes(command) && pos.length !== 1)
    throw new Error(command + ' requires one argument.');
  if (['scene-look', 'scene-record'].includes(command) && pos.length)
    throw new Error(command + ' takes no positional arguments');
  const matrixLock = join(stateDir, 'ui-matrix.lock');
  if (
    [
      'start',
      'stop',
      'reset',
      'scenario',
      'step',
      'capture',
      'record',
      'recover',
      'scene-record',
    ].includes(command) &&
    existsSync(matrixLock) &&
    JSON.parse(readFileSync(matrixLock, 'utf8')).token !== process.env.HELIX_MATRIX_TOKEN
  )
    throw new Error('A UI matrix owns this checkout session. Wait for it to restore and finish.');
  if (command.startsWith('discrepancy-')) {
    const { discrepancyCommand } = await import('./discrepancies.ts');
    return discrepancyCommand(command, pos, options);
  }
  if (command.startsWith('fixture-')) {
    const { fixtureCommand } = await import('./fixture-command.ts');
    return fixtureCommand(command, pos, options);
  }
  if (command === 'resolve' || command === 'assets') {
    const { config } = readConfig();
    const identity = await discover(config);
    return command === 'assets' ? assets(identity, options.match) : identity;
  }
  if (command === 'unity-plan') {
    const { config } = readConfig();
    if (pos.length !== 1 || !options.out)
      throw new Error('unity-plan requires SCENARIO and --out.');
    return unityPlan(
      config,
      root,
      pos[0],
      options.viewport ?? Object.keys(config.viewports)[0],
      options.out,
    );
  }
  if (command === 'doctor') {
    const { config, configHash } = readConfig();
    const { chromium } = await import('playwright');
    let identity: any = null,
      error: string | null = null;
    try {
      identity = await discover(config);
    } catch (e) {
      error = (e as Error).message;
    }
    return {
      node: process.version,
      projectRoot: root,
      configHash,
      identity,
      error,
      browserInstalled: existsSync(chromium.executablePath()),
      browserPath: chromium.executablePath(),
      viewports: Object.keys(config.viewports),
      scenarios: Object.keys(config.scenarios),
      notes: [
        'start opens installed Helix Desktop when needed; resolve and doctor never launch it.',
        'Install browser with npm run install-browser from Tools/Helix.',
      ],
    };
  }
  if (['ui-assets', 'ui-plan', 'ui-impact'].includes(command)) {
    if (pos.length || !options.spec || !options.out)
      throw new Error(command + ' requires --spec and --out.');
    const { uiAssets, uiPlan, uiImpact } = await import('./ui-port.ts');
    const out = resolve(root, options.out);
    if (command === 'ui-assets') return uiAssets(root, options.spec, out);
    if (command === 'ui-plan') return uiPlan(root, options.spec, out);
    return uiImpact(root, options.spec, options.previous, out);
  }
  if (command === 'vfx-compare') {
    if (pos.length || !options.spec || !options.out)
      throw new Error('vfx-compare requires --spec and --out.');
    const directory = dirname(fileURLToPath(import.meta.url));
    const installed = join(directory, '../vfx.py');
    const script = existsSync(installed) ? installed : join(directory, '../../workflows/vfx.py');
    const result = spawnSync(
      'python3',
      [script, resolve(root, options.spec), resolve(root, options.out)],
      { encoding: 'utf8' },
    );
    if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr.trim());
    return JSON.parse(result.stdout);
  }
  if (command === 'scene-motion') {
    if (pos.length || !options.reference || !options.candidate || !options.spec || !options.out)
      throw new Error('scene-motion requires --reference, --candidate, --spec and --out');
    const { compareMotionFiles } = await import('./scene-motion.ts');
    return compareMotionFiles(
      ...([options.reference, options.candidate, options.spec, options.out].map((p) =>
        resolve(root, p),
      ) as [string, string, string, string]),
    );
  }
  if (command === 'conversion-plan') {
    if (pos.length || !options.spec || !options.out)
      throw new Error('conversion-plan requires --spec and --out');
    const { conversionPlan } = await import('./conversion-plan.ts');
    return conversionPlan(root, resolve(root, options.spec), resolve(root, options.out));
  }
  if (command === 'scene-report') {
    if (pos.length || !options.reference || !options.candidate || !options.spec || !options.out)
      throw new Error('scene-report requires --reference, --candidate, --spec and --out');
    const { sceneReview } = await import('./scene-review.ts');
    return sceneReview(
      ...([options.reference, options.candidate, options.spec, options.out].map((p) =>
        resolve(root, p),
      ) as [string, string, string, string]),
    );
  }
  if (command === 'scene-compare') {
    if (pos.length || !options.reference || !options.candidate || !options.spec || !options.out)
      throw new Error('scene-compare requires --reference, --candidate, --spec and --out');
    const { compareSceneFiles } = await import('./scene.ts');
    return compareSceneFiles(
      ...([options.reference, options.candidate, options.spec, options.out].map((p) =>
        resolve(root, p),
      ) as [string, string, string, string]),
    );
  }
  if (command === 'ui-compare') {
    if (pos.length || !options.reference || !options.candidate || !options.spec || !options.out)
      throw new Error('ui-compare requires --reference, --candidate, --spec and --out.');
    const { compareUI } = await import('./ui.ts');
    return compareUI(
      resolve(root, options.reference),
      resolve(root, options.candidate),
      resolve(root, options.spec),
      resolve(root, options.out),
    );
  }
  if (command === 'batch') {
    if (pos.length || !options.spec || !options.out || (options.resume && options.resume !== 'yes'))
      throw new Error('batch needs --spec JSON --out DIR; --resume accepts yes.');
    const { config } = readConfig();
    config.referenceIdentity = await discover(config, true);
    config.url = config.url ?? config.referenceIdentity.url;
    const { runBatch } = await import('./batch.ts');
    const report = await runBatch({
      root,
      config,
      spec: JSON.parse(readFileSync(resolve(root, options.spec), 'utf8')),
      out: resolve(root, options.out),
      workers: Number(options.workers ?? 1),
      resume: options.resume === 'yes',
    });
    if (report.status !== 'captured') process.exitCode = 1;
    return {
      status: report.status,
      out: resolve(root, options.out),
      performance: report.performance,
      elapsedMs: report.elapsedMs,
      cases: report.cases.map(({ id, status, error }: any) => ({ id, status, error })),
      notRun: report.notRun,
    };
  }
  if (command === 'ui-matrix' || command === 'scene-case') {
    if (command === 'scene-case') {
      const spec = JSON.parse(readFileSync(resolve(root, options.spec ?? ''), 'utf8'));
      if (spec.cases?.length !== 1 || !spec.cases[0].sceneSpec)
        throw new Error('scene-case requires exactly one case with sceneSpec');
    }
    if (pos.length || !options.spec || !options.out)
      throw new Error('ui-matrix requires --spec and --out.');
    const { runMatrix } = await import('./ui-runner.ts');
    return runMatrix({
      root,
      cli: fileURLToPath(import.meta.url),
      specPath: resolve(root, options.spec),
      out: resolve(root, options.out),
      execute: options.execute,
      aiKit: options['ai-kit'],
    });
  }
  if (command === 'compare') {
    if (!options.reference || !options.candidate || !options.out)
      throw new Error('compare requires --reference, --candidate and --out.');
    const { compare } = await import('./compare.ts');
    return compare(
      resolve(root, options.reference),
      resolve(root, options.candidate),
      resolve(root, options.out),
    );
  }
  if (command === 'start') {
    const { config } = readConfig(options.url);
    config.referenceIdentity = await discover(config, true);
    config.url = options.url ?? config.url ?? config.referenceIdentity.url;
    config.referenceIdentity = {
      ...config.referenceIdentity,
      previewOverride: config.url !== config.referenceIdentity.url,
    };
    const configHash = sha(JSON.stringify(config)),
      viewport = options.viewport ?? Object.keys(config.viewports)[0];
    if (!config.viewports[viewport]) throw new Error('Unknown viewport ' + viewport);
    mkdirSync(stateDir, { recursive: true });
    const lock = join(stateDir, 'start.lock');
    let fd;
    try {
      fd = openSync(lock, 'wx', 0o600);
    } catch {
      throw new Error(
        'Another start is in progress. If its process died, remove .helix/start.lock before retrying.',
      );
    }
    try {
      if (existsSync(file)) {
        let live;
        try {
          live = await request(connection(), { method: 'status' }, 3000);
        } catch (e) {
          if (!['ECONNREFUSED', 'ENOENT'].includes((e as any).code)) throw e;
          rmSync(file, { force: true });
        }
        if (live) {
          if (live.configHash !== configHash || live.viewport !== viewport)
            throw new Error(
              'Existing session has different config/viewport. Stop it explicitly first.',
            );
          return live;
        }
      }
      const token = randomUUID();
      writeFileSync(
        join(stateDir, 'launch.json'),
        JSON.stringify({ config, configHash, viewport, token }),
        { mode: 0o600 },
      );
      const log = openSync(join(stateDir, 'host.log'), 'a', 0o600);
      const child = spawn(
        process.execPath,
        [join(dirname(fileURLToPath(import.meta.url)), 'host.ts'), '--project-root', root],
        { cwd: root, detached: true, stdio: ['ignore', log, log] },
      );
      closeSync(log);
      let failure: Error | undefined;
      child.on('error', (e) => {
        failure = e;
      });
      child.unref();
      for (let i = 0; i < 350; i++) {
        if (failure) throw failure;
        if (existsSync(file)) return await request(connection(), { method: 'status' });
        if (child.exitCode !== null) throw new Error('Browser host failed. See .helix/host.log.');
        await new Promise((r) => setTimeout(r, 100));
      }
      child.kill('SIGTERM');
      throw new Error('Start exceeded 35 seconds. See .helix/host.log.');
    } finally {
      closeSync(fd!);
      rmSync(lock, { force: true });
    }
  }
  const owned = connection();
  const result = await request(
    owned,
    {
      method: command,
      name: pos[0],
      label: pos[0],
      match: options.match,
      out: options.out ? resolve(root, options.out) : undefined,
      duration: options.duration,
      interval: options['interval-ms'],
      profile: options.profile,
      sceneProfile: options['scene-profile'],
      step: command === 'step' ? JSON.parse(pos[0]) : undefined,
    },
    command === 'record' ? 125000 : 65000,
  );
  if (command === 'stop') {
    for (let i = 0; i < 100; i++) {
      if (!existsSync(file) || connection().token !== owned.token) return result;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(
      'Browser shutdown has not completed; inspect .helix/host.log before restarting.',
    );
  }
  return result;
}
main()
  .then((result) => {
    if (result !== undefined) console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  });
