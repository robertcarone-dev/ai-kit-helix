import { chromium, type BrowserContext, type Page } from 'playwright';
import { isDeepStrictEqual } from 'node:util';
import { createServer } from 'node:net';
import { readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { root, stateDir, sha, localUrl, validateStep, emptyOutput } from './config.ts';
import { webmDimensions } from './video.ts';
import { REFERENCE_INSPECTOR } from './inspector.ts';
import { UI_INSPECTOR } from './ui-inspector.ts';
import { ScenarioReadiness } from './readiness.ts';
import { receiptValue } from './receipt.ts';

/** Long-lived browser owner, started by cli.ts with an explicit consuming project root.
 * Commands run sequentially; receipts describe observations, not a parity verdict. */
const launch = JSON.parse(readFileSync(join(stateDir, 'launch.json'), 'utf8'));
const { config, configHash, viewport, token } = launch,
  size = config.viewports[viewport],
  sessionId = randomUUID();
const browser = await chromium.launch({ headless: true });
// State belongs to this browser session and is reset when its context is replaced.
let context: BrowserContext;
let page: Page;
let ready = false;
let scenario: string | null = null;
let actions: any[] = [];
let errors: string[] = [];
let sources = new Map<string, any>();
let pending = new Set<Promise<void>>();
let sourceFailures = 0;
let idle: NodeJS.Timeout;
let busy = false;
const readiness = new ScenarioReadiness();
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression: string) => receiptValue(await page.evaluate(expression));
const until = (expression: string) =>
  page.waitForFunction(expression, undefined, { timeout: 20000 });
function native(f: any) {
  if (f.width !== size.width || f.height !== size.height || f.dpr !== 1 || f.zoom !== 1)
    throw new Error('Native viewport mismatch: ' + JSON.stringify(f));
}
const facts = () =>
  evaluate(
    '({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,zoom:visualViewport?.scale??1})',
  );
async function close() {
  clearTimeout(idle);
  await context?.close();
  await browser.close();
  server.close();
  rmSync(join(stateDir, 'connection.json'), { force: true });
  process.exit(0);
}

function touch() {
  clearTimeout(idle);
  idle = setTimeout(() => void close(), 30 * 60 * 1000);
}

/** Replace the browser context and invalidate scenario readiness before navigating. */
async function load(recordDir?: string) {
  readiness.invalidate();
  ready = false;
  scenario = null;
  actions = [];
  errors = [];
  sources = new Map();
  pending = new Set();
  sourceFailures = 0;
  await context?.close();
  context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
    ...(recordDir ? { recordVideo: { dir: recordDir, size } } : {}),
  });
  await context.route('**/*', async (route) => {
    try {
      const u = route.request().url();
      if (!u.startsWith('data:') && !u.startsWith('blob:')) localUrl(u);
      await route.continue();
    } catch {
      await route.abort();
    }
  });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e: Error) => {
    errors.push(e.message);
    errors = errors.slice(-50);
  });
  const generationSources = sources,
    generationPending = pending;
  page.on('response', (response) => {
    if (!['document', 'script', 'stylesheet', 'font'].includes(response.request().resourceType()))
      return;
    const job: Promise<void> = response
      .body()
      .then((b: Buffer) => {
        generationSources.set(response.url(), {
          url: response.url(),
          status: response.status(),
          sha256: sha(b),
          bytes: b.length,
        });
      })
      .catch(() => {
        sourceFailures++;
      })
      .finally(() => generationPending.delete(job));
    generationPending.add(job);
  });
  await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await until(config.ready);
  native(await facts());
  ready = true;
}

async function look(match = '') {
  return {
    sessionId,
    scenario,
    viewport: await facts(),
    ...(await page.evaluate(
      '(' +
        REFERENCE_INSPECTOR +
        ')(' +
        JSON.stringify({
          phaser: config.phaser,
          three: config.three,
          inspect: config.inspect,
          match,
        }) +
        ')',
    )),
  };
}

function point(x: number, y: number) {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x >= size.width ||
    y >= size.height
  )
    throw new Error('Pointer coordinates outside viewport.');
  return { x, y };
}

/** Record each action before execution so failed setup remains visible in receipts. */
async function step(raw: any) {
  const s = validateStep(raw),
    entry: any = { ...s, at: new Date().toISOString(), status: 'running' };
  actions.push(entry);
  try {
    if (s.kind === 'wait') await until(s.until);
    if (s.kind === 'assert') {
      entry.actual = await evaluate(s.expression);
      if (!isDeepStrictEqual(entry.actual, s.expected))
        throw new Error(
          'Assertion failed: ' + JSON.stringify({ expected: s.expected, actual: entry.actual }),
        );
    }
    if (['hover', 'pointerDown', 'pointerUp', 'wheel'].includes(s.kind)) {
      const p = point(s.x, s.y);
      await page.mouse.move(p.x, p.y);
      if (s.kind === 'pointerDown') await page.mouse.down();
      if (s.kind === 'pointerUp') await page.mouse.up();
      if (s.kind === 'wheel') await page.mouse.wheel(s.deltaX, s.deltaY);
    }
    if (s.kind === 'script') entry.result = await evaluate(s.expression);
    if (s.kind === 'press') {
      let p;
      if (s.target) {
        const mapped = (await lookUI()).nodes.filter((n: any) => n.semanticId === s.target);
        if (mapped.length) {
          if (
            mapped.length !== 1 ||
            !mapped[0].visible ||
            !mapped[0].input?.enabled ||
            !(mapped[0].bounds?.width > 0 && mapped[0].bounds?.height > 0)
          )
            throw new Error('Semantic target is ambiguous, hidden, disabled or unmeasured.');
          const b = mapped[0].bounds;
          p = point(b.x + b.width / 2, b.y + b.height / 2);
        } else {
          const nodes = (await look(s.target)).nodes.filter(
            (n: any) =>
              (n.id === s.target || n.name === s.target) &&
              n.inputEnabled &&
              n.visible &&
              n.bounds?.width > 0 &&
              n.bounds?.height > 0,
          );
          if (nodes.length !== 1)
            throw new Error('Expected one visible enabled target; inspect look for an exact id.');
          const b = nodes[0].bounds;
          p = point(b.x + b.width / 2, b.y + b.height / 2);
        }
      } else p = point(s.x, s.y);
      await page.mouse.click(p.x, p.y, { delay: 40 });
    }
    if (s.kind === 'drag') {
      const a = point(s.x, s.y),
        b = point(s.toX, s.toY);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      try {
        for (let i = 1; i <= 20; i++) {
          await pause((s.durationMs ?? 300) / 20);
          await page.mouse.move(a.x + ((b.x - a.x) * i) / 20, a.y + ((b.y - a.y) * i) / 20);
        }
      } finally {
        await page.mouse.up();
      }
    }
    entry.status = 'completed';
  } catch (e) {
    entry.status = 'failed';
    ready = false;
    throw e;
  }
}

async function checkReady(name: string, recovery = false) {
  const entry: any = {
    kind: 'readiness',
    scenario: name,
    recovery,
    at: new Date().toISOString(),
    status: 'running',
  };
  actions.push(entry);
  try {
    await until(config.scenarios[name].ready);
    native(await facts());
    entry.status = 'completed';
  } catch (e) {
    entry.status = 'failed';
    entry.error = String(e);
    throw e;
  }
}

/** Replay setup once, then wait for readiness. Recovery only repeats the readiness check. */
async function select(name: string, reset = true) {
  const s = config.scenarios[name];
  if (!s) throw new Error('Unknown scenario ' + name);
  readiness.invalidate();
  if (reset && s.reset !== false) await load();
  ready = false;
  scenario = null;
  for (const a of s.steps) await step(a);
  await readiness.check(name, () => checkReady(name));
  scenario = name;
  ready = true;
  return status();
}

function status() {
  return {
    sessionId,
    projectRoot: root,
    pid: process.pid,
    configHash,
    referenceIdentity: config.referenceIdentity,
    viewport,
    url: page?.url(),
    ready,
    scenario,
    pendingScenario: readiness.pending,
    scenarios: Object.entries(config.scenarios).map(([name, s]: any) => ({
      name,
      description: s.description,
      counterpart: s.counterpart,
    })),
    errors,
  };
}

async function lookUI(match = '') {
  const s = scenario ? config.scenarios[scenario] : null;
  const snapshot = await page.evaluate(
    '(' +
      UI_INSPECTOR +
      ')(' +
      JSON.stringify({
        phaser: config.phaser,
        uiProbe: config.uiProbe,
        bindings: config.uiBindings,
        state: s?.state,
        checkpoint: s?.checkpoint,
      }) +
      ')',
  );
  if (match)
    snapshot.nodes = snapshot.nodes.filter((n: any) =>
      JSON.stringify(n).toLowerCase().includes(match.toLowerCase()),
    );
  return snapshot;
}

async function capture(label: string, output?: string) {
  if (!ready) throw new Error('Session not ready; reset after diagnosing the failure.');
  const s = scenario ? config.scenarios[scenario] : null;
  if (s) {
    await until(s.ready);
    for (const a of s.captureSteps ?? []) await step(a);
    await until(s.ready);
  }
  const hold = config.uiClockHold === 'phaser-loop' && config.phaser;
  let restore = false;
  try {
    if (hold)
      restore = await page.evaluate(
        '(()=>{const g=(' +
          config.phaser +
          ');if(!g?.loop?.sleep||!g?.loop?.wake)throw new Error("Phaser clock hold unavailable");const running=g.loop.running;g.loop.sleep();return running;})()',
      );
    return await captureHeld(label, output, !!hold);
  } finally {
    if (restore) await page.evaluate('(' + config.phaser + ').loop.wake(true)');
  }
}

/** Collect state, UI metrics and a native PNG; hash the evidence without claiming revision parity. */
async function captureHeld(label: string, output?: string, clockHeld = false) {
  if (!ready) throw new Error('Session not ready; reset after diagnosing the failure.');
  const s = scenario ? config.scenarios[scenario] : null;
  const measured = await facts();
  native(measured);
  const inspection = await look();
  const state = s?.state ? await evaluate(s.state) : null;
  const ui = await lookUI();
  ui.clockHold = clockHeld ? 'phaser-loop' : 'none';
  const png = await page.screenshot({ type: 'png', fullPage: false, animations: 'allow' });
  if (png.readUInt32BE(16) !== size.width || png.readUInt32BE(20) !== size.height)
    throw new Error('Screenshot dimensions differ from native viewport.');
  await Promise.allSettled([...pending]);
  const out = emptyOutput(output ?? join(stateDir, 'evidence', randomUUID())),
    capturePath = join(out, 'reference.png'),
    manifestPath = join(out, 'reference.json');
  writeFileSync(capturePath, png);
  const identity = {
    reference: config.referenceIdentity,
    url: page.url(),
    expectedRevision: config.expectedRevision ?? null,
    revisionVerified: false,
    sources: [...sources.values()].sort((a, b) => a.url.localeCompare(b.url)),
    sourceScope: 'document, script, stylesheet, font',
    complete: pending.size === 0 && sourceFailures === 0,
  };
  const manifest = {
    schemaVersion: 1,
    sessionId,
    projectRoot: root,
    configHash,
    scenario,
    label,
    at: new Date().toISOString(),
    viewport: measured,
    native: size,
    state,
    capturePath,
    sha256: sha(png),
    setup: actions,
    setupKind: actions.some((a) => a.purpose === 'fixture')
      ? 'fixture'
      : actions.some((a) => a.purpose === 'instrumentation')
        ? 'instrumented-input'
        : 'input',
    identity,
    inspection,
    ui,
    image: 'reference.png',
    errors,
    notes: [
      'Source hashes do not verify expectedRevision.',
      clockHeld
        ? 'Phaser loop held during snapshot and PNG; this does not synchronize animation phase with Unity.'
        : 'Inspection and capture are sequential; moving objects may advance.',
    ],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { capturePath, manifestPath, native: size, scenario };
}

async function dispatch(req: any) {
  if (req.method === 'status') return status();
  if (req.method === 'stop') {
    setTimeout(() => void close(), 50);
    return { stopped: true };
  }
  if (req.method === 'reset') {
    await load();
    return status();
  }
  if (req.method === 'scenario') return select(req.name);
  if (req.method === 'recover') {
    if (errors.length)
      throw new Error('Browser errors require diagnosis and reset before recovery.');
    scenario = await readiness.recover((name) => checkReady(name, true));
    ready = true;
    return status();
  }
  if (req.method === 'look') return look(req.match);
  if (req.method === 'ui-look') return lookUI(req.match);
  if (req.method === 'step') {
    readiness.invalidate();
    await step(req.step);
    if (req.step.kind !== 'wait') scenario = null;
    return look();
  }
  if (req.method === 'capture') return capture(req.label, req.out);
  if (req.method === 'record') {
    const seconds = Number(req.duration ?? 3);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 30)
      throw new Error('Duration must be >0 and <=30 seconds.');
    const selected = scenario;
    if (!selected)
      throw new Error(
        'Select a named scenario before recording; record recreates it in an isolated context.',
      );
    const out = emptyOutput(req.out ?? join(stateDir, 'evidence', randomUUID()));
    try {
      await load(out);
      await select(selected, false);
      const startedAt = new Date().toISOString();
      native(await facts());
      await pause(seconds * 1000);
      const video = page.video();
      const state = config.scenarios[selected].state
        ? await evaluate(config.scenarios[selected].state)
        : null;
      await Promise.allSettled([...pending]);
      const identity = {
        reference: config.referenceIdentity,
        url: page.url(),
        sources: [...sources.values()].sort((a, b) => a.url.localeCompare(b.url)),
        sourceScope: 'document, script, stylesheet, font',
        complete: pending.size === 0 && sourceFailures === 0,
      };
      await context.close();
      const videoPath = join(out, 'motion.webm');
      await video.saveAs(videoPath);
      await video.delete();
      const bytes = readFileSync(videoPath),
        encoded = webmDimensions(bytes);
      const result = {
        sessionId,
        configHash,
        scenario: selected,
        label: req.label,
        viewport: size,
        encoded,
        nativeVideo: encoded.width === size.width && encoded.height === size.height,
        observationStartedAt: startedAt,
        durationSeconds: seconds,
        state,
        setup: actions,
        identity,
        errors,
        sha256: sha(bytes),
        referenceIdentity: config.referenceIdentity,
        url: config.url,
        expectedRevision: config.expectedRevision ?? null,
        revisionVerified: false,
        notes: [
          'Recording includes navigation/setup before the observation interval. Scenario is reset after recording.',
          'The encoder may round odd dimensions down; inspect encoded and nativeVideo. Native PNG captures remain separate evidence.',
        ],
        videoPath,
      };
      writeFileSync(join(out, 'motion.json'), JSON.stringify(result, null, 2));
      return result;
    } finally {
      await load();
    }
  }
  throw new Error('Unknown command.');
}
// A session accepts one command at a time. Timeouts invalidate readiness and close the page.
const server = createServer((client) => {
  let body = '';
  client.setEncoding('utf8');
  client.setTimeout(125000, () => client.destroy());
  client.on('error', () => {});
  client.on('data', async (chunk) => {
    body += chunk;
    if (body.length > 128000) {
      client.destroy();
      return;
    }
    if (!body.includes('\n')) return;
    client.removeAllListeners('data');
    let req;
    try {
      req = JSON.parse(body.split('\n')[0]);
      if (req.token !== token) throw new Error('Session token mismatch.');
      if (busy) throw new Error('Session busy; run commands sequentially.');
    } catch (e) {
      client.end(JSON.stringify({ ok: false, error: String(e) }) + '\n');
      return;
    }
    busy = true;
    touch();
    let deadline: NodeJS.Timeout;
    const budgetMs = req.method === 'record' ? 120000 : 60000;
    try {
      const result = await Promise.race([
        dispatch(req),
        new Promise((_, reject) => {
          deadline = setTimeout(() => {
            ready = false;
            void page?.close();
            reject(
              new Error(`Command exceeded ${budgetMs / 1000} seconds; reset before retrying.`),
            );
          }, budgetMs);
        }),
      ]);
      client.end(JSON.stringify({ ok: true, result }) + '\n');
    } catch (e) {
      const error = String(e);
      writeFileSync(
        join(stateDir, 'failure.json'),
        JSON.stringify({ at: new Date().toISOString(), error, status: status(), actions }, null, 2),
      );
      client.end(JSON.stringify({ ok: false, error }) + '\n');
    } finally {
      clearTimeout(deadline!);
      busy = false;
    }
  });
});
try {
  await load();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as any).port;
  const file = join(stateDir, 'connection.json');
  writeFileSync(
    file + '.tmp',
    JSON.stringify({ port, token, configHash, viewport, projectRoot: root, pid: process.pid }),
    { mode: 0o600 },
  );
  renameSync(file + '.tmp', file);
  touch();
} catch (e) {
  console.error(e);
  await browser.close();
  process.exit(1);
}
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
