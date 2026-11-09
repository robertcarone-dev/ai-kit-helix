import { resolveSceneOptions } from './scene-options.ts';
import { sceneReview } from './scene-review.ts';
import { compareSceneState } from './scene-state.ts';
import { unityExecutable } from './unity-plan.ts';
import { isolatedWorkspace } from './isolation.ts';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  realpathSync,
} from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { emptyOutput, projectConfig, sha } from './config.ts';
import { compareUI, validateSpec, loadSnapshot } from './ui.ts';

/** Captured process output, also attached to command failures for matrix receipts. */
export interface CommandRecord {
  executable: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
  timedOut?: boolean;
}

export interface MatrixOptions {
  root: string;
  cli: string;
  specPath: string;
  out: string;
  /** Omit to plan. Only the literal "yes" authorizes execution. */
  execute?: string;
  caseId?: string;
  retained?: { reference?: string; candidate?: string };
  aiKit?: string;
  unity?: string;
}

/** Run an argument array without a shell, bounding output and terminating timed-out process groups. */
export function runCommand(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs = 90000,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CommandRecord> {
  return new Promise((done, reject) => {
    const started = Date.now(),
      child = spawn(executable, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    let stdout = '',
      stderr = '',
      failure: string | null = null,
      killTimer: NodeJS.Timeout | undefined;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {}
    };
    const terminate = (reason: string) => {
      if (failure) return;
      failure = reason;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 2000);
    };
    const timer = setTimeout(
      () => terminate('Command timeout; remote work may still be active.'),
      timeoutMs,
    );
    child.stdout.on('data', (b) => {
      stdout += b;
      if (stdout.length > 8_000_000) terminate('Command output limit exceeded.');
    });
    child.stderr.on('data', (b) => {
      stderr += b;
      if (stderr.length > 1_000_000) terminate('Command error output limit exceeded.');
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      const record = {
        executable,
        args,
        exitCode: code,
        stdout: stdout.slice(0, 8_000_000),
        stderr: stderr.slice(0, 1_000_000),
        elapsedMs: Date.now() - started,
        timedOut: failure?.startsWith('Command timeout') === true,
      };
      if (failure || code !== 0) {
        const e: any = new Error(failure ?? `Command exited ${code}: ${stderr.slice(-2000)}`);
        e.record = record;
        reject(e);
      } else done(record);
    });
  });
}

async function checkedCommand(command: typeof runCommand, executable: string, args: string[], root: string, env: NodeJS.ProcessEnv) {
  let record: CommandRecord;
  try {
    record = await command(executable, args, root, 90000, env);
  } catch (error) {
    const e = error as any;
    e.timedOut = e.record?.timedOut === true || /timed out|timeout|ETIMEDOUT/i.test(String(e));
    if (e.record) {
      try {
        const payload = JSON.parse(e.record.stdout);
        e.timedOut ||= responseTimedOut(payload);
      } catch {}
    }
    throw e;
  }
  let payload;
  try {
    payload = JSON.parse(record.stdout);
    if (payload === null || typeof payload !== 'object') throw new Error('Expected a command response object.');
  } catch {
    const error: any = new Error('Command returned invalid JSON; execution outcome is unknown.');
    error.record = record;
    error.uncertain = true;
    throw error;
  }
  const result = payload.data?.result;
  if (payload.success === false || payload.ok === false || result?.success === false || result?.met === false || responseTimedOut(payload)) {
    const error: any = new Error('Command returned a failure response.');
    error.record = record;
    error.timedOut = responseTimedOut(payload);
    throw error;
  }
  return record;
}

function responseTimedOut(payload: any) {
  const result = payload.data?.result;
  return result?.timedOut === true || result?.state === 'timedOut' ||
    /timed out|timeout|ETIMEDOUT/i.test(JSON.stringify([payload.errors, payload.error, result?.error, result?.errorDetails]));
}

function processExited(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid retained owner PID.');
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
    throw error;
  }
}

function acquireMatrixLock(lock: string, token: string) {
  // Python's standard-library flock protects the complete receipt replacement.
  // The OS releases it even if this process or the helper exits unexpectedly.
  const installed = fileURLToPath(new URL('../matrix_lock.py', import.meta.url));
  const helper = existsSync(installed) ? installed : fileURLToPath(new URL('../../workflows/matrix_lock.py', import.meta.url));
  const result = spawnSync('python3', [helper, lock, String(process.pid), token], {
    encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim());
  return JSON.parse(result.stdout) as { recoverySessions: string[] };
}

function inside(root: string, path: string) {
  const r = relative(root, path);
  return r !== '' && !r.startsWith('..') && !isAbsolute(r);
}

export function caseIdentity(c: any, side: 'reference' | 'candidate', receipt: string) {
  return {
    caseId: c.id,
    scenario: c.scenario,
    viewport: c.viewport,
    side,
    receiptSha256: sha(readFileSync(receipt)),
    configSha256: c.configSha256,
    uiSpecSha256: sha(readFileSync(c.uiSpec)),
    sceneProfile: c.sceneProfile ?? null,
    sceneSpecSha256: c.sceneSpec ? sha(readFileSync(c.sceneSpec)) : null,
  };
}

function reviewCase(c: any, row: any, retained: NonNullable<MatrixOptions['retained']>) {
  const reference = retained.reference ?? join(c.out, 'reference/reference.json');
  const candidate = retained.candidate ?? join(c.out, 'unity/unity.json');
  row.receipts = { reference, candidate };
  if (c.safeAreaInsets) {
    const v = { width: c.widthPx, height: c.heightPx },
      i = c.safeAreaInsets,
      expected = {
        x: i.left,
        y: i.top,
        width: v.width - i.left - i.right,
        height: v.height - i.top - i.bottom,
      };
    for (const receipt of [reference, candidate]) {
      const actual = loadSnapshot(receipt).ui.safeArea;
      if (!Object.entries(expected).every(([key, value]) => actual?.[key] === value))
        throw new Error('Captured safe area does not match the requested device case.');
    }
  }
  row.comparison = compareUI(reference, candidate, c.uiSpec, join(c.out, 'review'));
  row.status = row.comparison.status;
  if (c.sceneSpec) {
    const review = sceneReview(reference, candidate, c.sceneSpec, join(c.out, 'scene-review'));
    row.sceneReview = { viewer: review.viewer, inputs: review.report.inputs };
    const statuses = [
      ...review.report.mappings,
      ...review.report.relationships,
      ...review.report.styles,
      ...review.report.appearance,
      ...review.report.state.outcomes,
    ].map((c) => c.status);
    for (const landmark of review.report.geometry.landmarks) {
      statuses.push(landmark.screenStatus);
      if (review.report.geometry.coordinates) statuses.push(landmark.worldStatus);
    }
    if (review.report.prerequisites.length || row.status === 'blocked') row.status = 'blocked';
    else if (row.status === 'difference' || statuses.includes('different'))
      row.status = 'difference';
    else if (
      row.status === 'unmeasured' ||
      statuses.some((s) => ['unmeasured', 'unresolved'].includes(s))
    )
      row.status = 'unmeasured';
  }
}

/** Plan by default. Execution requires an isolated checkout and complete Unity lifecycle recipes.
 * Reconcile uncertain session state; stop subsequent cases on timeouts or failed cleanup. */
export async function runMatrix(options: MatrixOptions, command = runCommand) {
  const { root, cli, specPath } = options;
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const config = projectConfig(root);
  if (spec.schemaVersion !== 1 || !Array.isArray(spec.cases) || !spec.cases.length)
    throw new Error('Matrix needs schemaVersion:1 and nonempty cases.');
  const out = resolve(options.out),
    scratch = join(root, '.aikit/scratch');
  if (!inside(scratch, out))
    throw new Error('Matrix output must be below this checkout’s .aikit/scratch.');
  const ids = new Set();
  const allCases = spec.cases.map((c: any) => {
    if (!/^[A-Za-z0-9_-]+$/.test(c.id) || ids.has(c.id))
      throw new Error('Case IDs must be unique filename-safe names.');
    ids.add(c.id);
    if (!config.scenarios?.[c.scenario]?.unity || !config.viewports?.[c.viewport])
      throw new Error('Case requires a configured Unity recipe and viewport: ' + c.id);
    if (c.safeArea !== undefined)
      throw new Error('Use safeAreaInsets with top/right/bottom/left pixel values.');
    if (
      c.safeAreaInsets &&
      (!['top', 'right', 'bottom', 'left'].every(
        (k) => Number.isFinite(c.safeAreaInsets[k]) && c.safeAreaInsets[k] >= 0,
      ) ||
        Object.keys(c.safeAreaInsets).length !== 4)
    )
      throw new Error('Invalid safe-area insets.');
    if (typeof c.uiSpec !== 'string') throw new Error('Case needs uiSpec path.');
    const uiSpec = resolve(root, c.uiSpec);
    validateSpec(JSON.parse(readFileSync(uiSpec, 'utf8')));
    if (c.sceneSpec !== undefined) {
      if (typeof c.sceneSpec !== 'string' || typeof c.sceneProfile !== 'string')
        throw new Error('Scene case requires sceneSpec and sceneProfile');
      c.sceneSpec = resolve(root, c.sceneSpec);
      const scene = JSON.parse(readFileSync(c.sceneSpec, 'utf8'));
      if (scene.schemaVersion !== 1 || !Array.isArray(scene.mappings) || !scene.mappings.length)
        throw new Error('Invalid scene spec');
      compareSceneState({}, {}, scene.stateContract);
      c.sceneOptions = resolveSceneOptions(config, c.sceneProfile);
    }
    return {
      ...c,
      configSha256: sha(JSON.stringify(config)),
      widthPx: config.viewports[c.viewport].width,
      heightPx: config.viewports[c.viewport].height,
      uiSpec,
      out: join(out, c.id),
    };
  });
  const cases =
    options.caseId === undefined ? allCases : allCases.filter((c: any) => c.id === options.caseId);
  if (!cases.length) throw new Error('Unknown matrix case: ' + options.caseId);
  const retained = options.retained ?? {};
  if (options.execute === undefined)
    return {
      schemaVersion: 1,
      execute: false,
      cases,
      notes: [
        'Use --execute yes only in an idle isolated workspace. Recipes execute in preflight/prepare/capture/restore order.',
        'No build or Production check. Timeouts and failed restoration stop the matrix. Pending owned cleanup must finish before another run.',
      ],
    };
  if (options.execute !== 'yes') throw new Error('--execute must be yes, or omitted for a plan.');
  // Reject symlinked output ancestors before starting either application.
  for (let p = out; p !== root; p = resolve(p, '..'))
    if (existsSync(p) && !inside(realpathSync(root), realpathSync(p)))
      throw new Error('Output escapes the checkout through a symlink.');
  if (retained.reference && retained.candidate) {
    emptyOutput(out);
    const row: any = { id: cases[0].id, commands: [], retained };
    mkdirSync(cases[0].out);
    try {
      reviewCase(cases[0], row, retained);
    } catch (error) {
      row.status = 'blocked';
      row.error = String(error);
    }
    const report = { schemaVersion: 1, status: row.status, cases: [row], notRun: [] };
    writeFileSync(join(out, 'matrix.json'), JSON.stringify(report, null, 2));
    return { ...report, out };
  }
  if (!isolatedWorkspace(root))
    throw new Error('Execution requires an isolated managed lane or opted-in linked worktree.');
  mkdirSync(join(root, '.helix'), { recursive: true });
  const lock = join(root, '.helix/ui-matrix.lock'),
    matrixToken = randomUUID(),
    { recoverySessions } = acquireMatrixLock(lock, matrixToken);
  let recoveryComplete = recoverySessions.length === 0;
  const pendingPath = join(root, '.helix/unity-reconciliation.json');
  const matrixEnv: NodeJS.ProcessEnv = { ...process.env, HELIX_MATRIX_TOKEN: matrixToken };
  const browserEnv = { ...matrixEnv, HELIX_FIXTURE_SESSION: matrixToken };
  let interrupted = false;
  const onSignal = () => {
    interrupted = true;
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  const report: any = {
    schemaVersion: 1,
    cases: [],
    status: 'running',
    startedAt: new Date().toISOString(),
  };
  let created = false;
  let browserOwned = false;
  try {
    emptyOutput(out);
    created = true;
    const save = () => writeFileSync(join(out, 'matrix.json'), JSON.stringify(report, null, 2));
    save();
    for (const session of recoverySessions) {
      const connectionPath = join(root, '.helix/fixture-sessions', session, 'connection.json');
      if (!existsSync(connectionPath)) continue;
      const connection = JSON.parse(readFileSync(connectionPath, 'utf8'));
      if (connection.projectRoot !== root) throw new Error('Retained browser belongs to another project.');
      if (processExited(connection.pid)) {
        unlinkSync(connectionPath);
      } else {
        await checkedCommand(command, process.execPath, [cli, 'stop', '--project-root', root], root,
          { ...matrixEnv, HELIX_FIXTURE_SESSION: session });
      }
    }
    // A previous process may have lost the reply after Begin acquired a session.
    // Replay only its owned cleanup, never its preparation, before admitting new work.
    if (existsSync(pendingPath)) {
      const pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
      if (pending.projectRoot !== root || !inside(scratch, pending.out) || !Array.isArray(pending.restore) || !pending.restore.length)
        throw new Error('Invalid pending Unity reconciliation receipt: ' + pendingPath);
      report.reconciliation = { out: pending.out, status: 'running', commands: [] };
      save();
      try {
        const executable = unityExecutable(pending, options);
        for (const args of pending.restore) {
          const record = await checkedCommand(command, executable, args, root, { ...matrixEnv, ...pending.environment });
          report.reconciliation.commands.push(record);
          save();
        }
        unlinkSync(pendingPath);
        report.reconciliation.status = 'restored';
        save();
      } catch (error) {
        report.reconciliation.status = 'blocked';
        report.reconciliation.error = String(error);
        if ((error as any).record) report.reconciliation.commands.push((error as any).record);
        throw error;
      }
    }
    recoveryComplete = true;
    if (!retained.reference && existsSync(join(root, '.helix/connection.json')))
      throw new Error('An existing browser session is owned elsewhere; stop it explicitly before the matrix.');
    for (const [caseIndex, c] of cases.entries()) {
      if (interrupted) break;
      const row: any = {
        id: c.id,
        scenario: c.scenario,
        viewport: c.viewport,
        status: 'running',
        commands: [],
      };
      report.cases.push(row);
      mkdirSync(c.out);
      save();
      const invoke = async (executable: string, args: string[], stage: string, env = matrixEnv) => {
        try {
          const r = await checkedCommand(command, executable, args, root, env);
          row.commands.push({ stage, ...r });
          save();
          return r;
        } catch (e) {
          if ((e as any).timedOut) {
            row.timedOut = true;
          }
          if ((e as any).timedOut || (e as any).uncertain) {
            row.executionUncertain = true;
            row.executionOutcome = 'unknown';
          }
          row.commands.push({
            stage,
            error: String(e),
            ...(e as any).record,
          });
          save();
          throw e;
        }
      };
      const helix = (args: string[], stage: string) =>
        invoke(process.execPath, [cli, ...args, '--project-root', root], stage, browserEnv);
      let browserAttempted = false,
        prepareAttempted = false,
        plan: any,
        executable: string,
        unityEnv: NodeJS.ProcessEnv,
        restoreFailed = false,
        capturesComplete = false;
      try {
        if (
          c.safeAreaInsets &&
          Object.values(c.safeAreaInsets).some((v: any) => v !== 0) &&
          !['top', 'right', 'bottom', 'left'].every(
            (k) => config.scenarios[c.scenario].safeAreaInsets?.[k] === c.safeAreaInsets[k],
          )
        )
          throw new Error(
            'The scenario has no matching device capture recipe for these safe-area insets.',
          );
        if (!retained.candidate) {
          const planned = await helix(
            ['unity-plan', c.scenario, '--viewport', c.viewport, '--out', join(c.out, 'unity')],
            'plan',
          );
          plan = JSON.parse(planned.stdout);
          executable = unityExecutable(plan, options);
          unityEnv = { ...matrixEnv, ...plan.environment };
          for (const stage of ['preflight', 'prepare', 'capture', 'restore'])
            if (
              !Array.isArray(plan.stages[stage]) ||
              !plan.stages[stage].length ||
              plan.stages[stage].some(
                (a: any) => !Array.isArray(a) || a.some((v: any) => typeof v !== 'string'),
              )
            )
              throw new Error('Incomplete Unity lifecycle recipe: ' + stage);
          mkdirSync(join(c.out, 'unity'), { recursive: true });
          writeFileSync(join(c.out, 'unity/unity-revision.json'), JSON.stringify(plan.revision));
          if (c.sceneSpec)
            writeFileSync(
              join(c.out, 'unity', 'scene-request.json'),
              JSON.stringify(c.sceneOptions),
            );
          writeFileSync(pendingPath, JSON.stringify({ projectRoot: root, out: plan.out, backend: plan.backend,
            environment: plan.environment, restore: plan.stages.restore }));
          for (const argv of plan.stages.preflight) await invoke(executable, argv, 'preflight', unityEnv);
        }
        if (!retained.reference) {
          browserAttempted = true;
          await helix(['start', '--viewport', c.viewport], 'reference-start');
          browserOwned = true;
          await helix(['scenario', c.scenario], 'reference-scenario');
          await helix(
            [
              'capture',
              c.id,
              '--out',
              join(c.out, 'reference'),
              ...(c.sceneSpec ? ['--scene-profile', c.sceneProfile] : []),
            ],
            'reference-capture',
          );
        }
        if (!retained.candidate) {
          prepareAttempted = true;
          for (const argv of plan.stages.prepare) {
            if (interrupted) throw new Error('Interrupted');
            await invoke(executable, argv, 'prepare', unityEnv);
          }
          for (const argv of plan.stages.capture) await invoke(executable, argv, 'capture', unityEnv);
        }
        for (const [side, file] of [
          ['reference', 'reference/reference.json'],
          ['candidate', 'unity/unity.json'],
        ] as const) {
          if (!retained[side]) {
            const receipt = join(c.out, file);
            writeFileSync(
              receipt + '.case.json',
              JSON.stringify(caseIdentity(c, side, receipt), null, 2),
            );
          }
        }
        capturesComplete = true;
        reviewCase(c, row, retained);
      } catch (e) {
        row.status = 'blocked';
        row.error = String(e);
        row.failureStage = capturesComplete ? 'review' : 'execution';
      } finally {
        if (prepareAttempted || (plan && row.executionUncertain)) {
          row.restoration = [];
          for (const argv of plan.stages.restore) {
            try {
              await invoke(executable, argv, 'restore', unityEnv);
              row.restoration.push({ argv, status: 'completed' });
            } catch (e) {
              row.restoration.push({
                argv,
                status: 'failed',
                error: String(e),
              });
              restoreFailed = true;
            }
          }
          if (!restoreFailed) row.executionOutcome = 'restored';
        }
        // Retain only this matrix's browser across adjacent same-viewport cases.
        // Scenario setup still performs its configured reset; Unity restores every case.
        if (
          browserAttempted &&
          (interrupted ||
            restoreFailed ||
            !capturesComplete ||
            cases[caseIndex + 1]?.viewport !== c.viewport)
        ) {
          try {
            await helix(['stop'], 'reference-stop');
            browserOwned = false;
          } catch (e) {
            row.browserCleanupError = String(e);
            restoreFailed = true;
            recoveryComplete = false;
          }
        }
        if (restoreFailed) {
          row.status = 'blocked';
          row.cleanupFailed = true;
        }
        if (plan && !restoreFailed && existsSync(pendingPath)) unlinkSync(pendingPath);
        save();
      }
      if (row.executionUncertain || restoreFailed || interrupted) break;
    }
    report.status =
      report.cases.some((c: any) => c.status === 'blocked') || report.cases.length !== cases.length
        ? 'blocked'
        : report.cases.some((c: any) => c.status === 'difference')
          ? 'difference'
          : report.cases.some((c: any) => c.status === 'unmeasured')
            ? 'unmeasured'
            : 'passed';
    report.notRun = cases
      .filter((c: any) => !report.cases.some((r: any) => r.id === c.id))
      .map((c: any) => c.id);
    save();
    return {
      status: report.status,
      out,
      cases: report.cases.map(({ id, status }: any) => ({ id, status })),
      notRun: report.notRun,
    };
  } catch (e) {
    report.status = 'blocked';
    report.error = String(e);
    report.notRun = cases.filter((c: any) => !report.cases.some((r: any) => r.id === c.id)).map((c: any) => c.id);
    if (created) writeFileSync(join(out, 'matrix.json'), JSON.stringify(report, null, 2));
    throw e;
  } finally {
    if (browserOwned) {
      try {
        await command(
          process.execPath,
          [options.cli, 'stop', '--project-root', root],
          root,
          90000,
          browserEnv,
        );
      } catch (e) {
        recoveryComplete = false;
        report.cleanupFailed = true;
        report.status = 'blocked';
        report.cleanupError = String(e);
        if (created) writeFileSync(join(out, 'matrix.json'), JSON.stringify(report, null, 2));
        throw e;
      } finally {
        if (recoveryComplete) unlinkSync(lock);
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
      }
    } else {
      if (recoveryComplete) unlinkSync(lock);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    }
  }
}
