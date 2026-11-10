import { acquireProcessLock } from './process-lock.ts';
import { randomUUID } from 'node:crypto';
import { nativePng } from './png.ts';
import { chromium } from 'playwright';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  realpathSync,
} from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { sha, localUrl } from './config.ts';

export function validateBatch(spec: any, config: any) {
  if (spec.schemaVersion !== 1 || !Array.isArray(spec.cases) || !spec.cases.length)
    throw new Error('Batch needs schemaVersion 1 and nonempty cases.');
  const adapter = config.batch;
  if (
    !adapter ||
    !Array.isArray(adapter.scripts) ||
    !Array.isArray(adapter.views) ||
    !adapter.views.length ||
    adapter.views.some((v: any) => typeof v !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(v)) ||
    new Set(adapter.views).size !== adapter.views.length ||
    ['reset', 'ready', 'probe', 'view'].some(
      (k) => typeof adapter[k] !== 'string' || !adapter[k].trim(),
    )
  )
    throw new Error(
      'Configure batch scripts, views and reset/ready/probe/view function expressions in the project adapter.',
    );
  const ids = new Set();
  for (const c of spec.cases) {
    if (!/^[a-zA-Z0-9_-]+$/.test(c.id) || ids.has(c.id))
      throw new Error('Case IDs must be unique safe filenames.');
    ids.add(c.id);
    if (
      !config.viewports[c.viewport] ||
      !c.fixture ||
      typeof c.fixture !== 'object' ||
      Array.isArray(c.fixture) ||
      !Array.isArray(c.views) ||
      !c.views.length ||
      c.views.some((v: string) => !adapter.views.includes(v)) ||
      new Set(c.views).size !== c.views.length
    )
      throw new Error(
        'Case needs configured viewport, fixture object and unique configured views.',
      );
    if (!Number.isInteger(c.seed ?? 1) || (c.seed ?? 1) <= 0)
      throw new Error('Seed must be an integer.');
  }
}
/** A helper holds an OS lock; pipe closure releases ownership, including on parent exit. */
export async function permit(
  signal: AbortSignal,
  directory = join(tmpdir(), 'helix-static-capture-workers'),
): Promise<{ release: () => Promise<void>; lost: AbortSignal }> {
  signal.throwIfAborted();
  const installed = fileURLToPath(new URL('../worker_permit.py', import.meta.url));
  const helper = existsSync(installed) ? installed : fileURLToPath(new URL('../../workflows/worker_permit.py', import.meta.url));
  const child = spawn('python3', [helper, directory, String(process.pid)], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lost = new AbortController();
  let stderr = '', output = '', acquired = false, releasing = false;
  let failure: Error | undefined;
  const closed = new Promise<number | null>((resolve) => child.on('close', (code) => {
    if (acquired && !releasing) lost.abort(new Error('Capture permit holder exited before release: ' + stderr.trim()));
    resolve(code);
  }));
  // Pipe failures are lifetime failures, not uncaught stream errors.
  child.stdin.on('error', (error) => { failure = error; lost.abort(error); });
  await new Promise<void>((resolve, reject) => {
    const abort = () => child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 35000);
    signal.addEventListener('abort', abort, { once: true });
    const detach = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    child.stderr.on('data', (bytes) => { stderr += bytes; });
    child.stdout.on('data', (bytes) => {
      output += bytes;
      if (!output.includes('\n') || signal.aborted) return;
      detach();
      acquired = true;
      resolve();
    });
    child.on('error', (error) => { failure = error; });
    child.on('close', () => {
      detach();
      if (!acquired) reject(failure ?? new Error('Capture permit acquisition failed: ' + (stderr.trim() || (signal.aborted ? 'interrupted' : directory))));
    });
    if (signal.aborted) abort();
  });
  return {
    lost: lost.signal,
    release: async () => {
      releasing = true;
      child.stdin.end();
      const force = setTimeout(() => child.kill('SIGKILL'), 5000);
      try {
        const code = await closed;
        if (code !== 0 || lost.signal.aborted || failure)
          throw failure ?? new Error('Capture permit holder failed: ' + stderr.trim());
      } finally {
        clearTimeout(force);
      }
    },
  };
}
/** Helix's diagnostic document stamp is not game content. Keep raw hashes as provenance. */
export function sourceRecord(url: string, status: number, bytes: Buffer, kind: string) {
  let content = bytes;
  if (kind === 'document') {
    const html = bytes.toString('utf8');
    const matches = [...html.matchAll(/var stamp = (\{[^\n]+\});/g)];
    if (matches.length === 1) {
      try {
        const stamp = JSON.parse(matches[0][1]);
        if (
          typeof stamp.docId === 'string' &&
          typeof stamp.servedAt === 'number' &&
          typeof stamp.project === 'string'
        ) {
          delete stamp.docId;
          delete stamp.servedAt;
          content = Buffer.from(
            html.replace(matches[0][0], 'var stamp = ' + JSON.stringify(stamp) + ';'),
          );
        }
      } catch {
        /* Unknown documents retain their exact byte identity. */
      }
    }
  }
  return {
    url,
    status,
    kind,
    bytes: bytes.length,
    sha256: sha(bytes),
    contentSha256: sha(content),
  };
}
export function inputIdentity(identity: any) {
  return {
    ...identity,
    sources: identity.sources.map((s: any) => ({
      url: s.url,
      status: s.status,
      contentSha256: s.contentSha256,
    })),
  };
}
export function reusable(receipt: any, fingerprint: string, png: Buffer) {
  return (
    receipt.fingerprint === fingerprint &&
    receipt.sha256 === sha(png) &&
    receipt.status === 'captured'
  );
}
/** Engine-specific hooks belong to the consuming project. */
export async function adapterCall(page: any, expression: string, args: any[] = []) {
  return page.evaluate(({ expression, args }: any) => (0, eval)('(' + expression + ')')(...args), {
    expression,
    args,
  });
}
export async function resetFixture(page: any, fixture: any, seed: number, adapter: any) {
  await adapterCall(page, adapter.reset, [fixture, seed]);
  await page.waitForFunction(
    ({ expression, fixture, seed }: any) => (0, eval)('(' + expression + ')')(fixture, seed),
    { expression: adapter.ready, fixture, seed },
    { timeout: 30000 },
  );
}
export async function runBatch({ root, config, spec, out, workers = 1, resume = false }: any) {
  validateBatch(spec, config);
  if (![1, 2].includes(workers)) throw new Error('workers must be 1 or 2.');
  const scripts = config.batch.scripts.map((name: any) => {
    if (typeof name !== 'string' || isAbsolute(name))
      throw new Error('Batch scripts must be project-relative paths.');
    const path = realpathSync(resolve(root, name)),
      rel = relative(realpathSync(root), path);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Batch script escapes project.');
    return { name, bytes: readFileSync(path, 'utf8') };
  });
  const destination = resolve(out),
    rel = relative(root, destination);
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error('Output must be inside the checkout.');
  let ancestor = destination;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const realRel = relative(realpathSync(root), realpathSync(ancestor));
  if (realRel.startsWith('..') || isAbsolute(realRel)) throw new Error('Output escapes checkout.');
  if (existsSync(destination) && !resume)
    throw new Error('Output exists; choose a fresh directory or --resume yes.');
  mkdirSync(destination, { recursive: true });
  const lock = join(destination, '.batch.lock');
  acquireProcessLock(lock, randomUUID());
  const abort = new AbortController(),
    stop = () => abort.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const started = performance.now();
  const report: any = {
    schemaVersion: 1,
    status: 'running',
    startedAt: new Date().toISOString(),
    workers,
    cases: [],
    timings: {},
    reference: config.referenceIdentity,
  };
  const save = () =>
    writeFileSync(join(destination, 'batch.json'), JSON.stringify(report, null, 2));
  const groups = Object.keys(config.viewports)
    .map((viewport) => ({
      viewport,
      cases: spec.cases.filter((c: any) => c.viewport === viewport),
    }))
    .filter((g) => g.cases.length);
  let next = 0;
  async function worker() {
    const queued = performance.now(),
      lease = await permit(abort.signal);
    const queueMs = performance.now() - queued;
    let browser: any;
    lease.lost.addEventListener('abort', stop, { once: true });
    try {
      if (lease.lost.aborted) stop();
      abort.signal.throwIfAborted();
      browser = await chromium.launch({
        headless: true,
        channel: 'chromium',
      });
      while (next < groups.length && !abort.signal.aborted) {
        const group = groups[next++],
          size = config.viewports[group.viewport],
          boot = performance.now();
        const context = await browser.newContext({
          viewport: size,
          deviceScaleFactor: 1,
          serviceWorkers: 'block',
        });
        const cancelContext = () => {
          void context.close().catch(() => {});
        };
        abort.signal.addEventListener('abort', cancelContext);
        if (abort.signal.aborted) cancelContext();
        const deadline = setTimeout(cancelContext, 180000);
        try {
          await context.route('**/*', async (route) => {
            try {
              const u = route.request().url();
              if (!u.startsWith('data:') && !u.startsWith('blob:')) localUrl(u);
              await route.continue();
            } catch {
              await route.abort();
            }
          });
          const page = await context.newPage(),
            errors: string[] = [],
            sources = new Map<string, any>(),
            pending = new Set<Promise<void>>();
          let sourceFailures = 0;
          page.on('pageerror', (e) => errors.push(e.message));
          page.on('response', (response) => {
            const job = response
              .body()
              .then((b) => {
                sources.set(
                  response.url(),
                  sourceRecord(
                    response.url(),
                    response.status(),
                    b,
                    response.request().resourceType(),
                  ),
                );
              })
              .catch(() => {
                sourceFailures++;
              })
              .finally(() => pending.delete(job));
            pending.add(job);
          });
          page.setDefaultTimeout(30000);
          const navigation = performance.now();
          await page.goto(localUrl(config.url), {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
          });
          const navigationMs = performance.now() - navigation;
          await page.waitForFunction(config.ready, undefined, {
            timeout: 120000,
          });
          for (const script of scripts) await page.addScriptTag({ content: script.bytes });
          await Promise.allSettled([...pending]);
          report.timings[group.viewport] = {
            queueMs,
            navigationMs,
            coldReadyMs: performance.now() - boot,
          };
          save();
          clearTimeout(deadline);
          for (const c of group.cases) {
            if (abort.signal.aborted) break;
            const row: any = {
              id: c.id,
              viewport: c.viewport,
              status: 'running',
              views: [],
            };
            report.cases.push(row);
            save();
            const caseDeadline = setTimeout(cancelContext, 90000);
            try {
              const setup = performance.now();
              await resetFixture(page, c.fixture, c.seed ?? 1, config.batch);
              await page.evaluate(
                () =>
                  new Promise<void>((r) =>
                    requestAnimationFrame(() => requestAnimationFrame(() => r())),
                  ),
              );
              if (!(await adapterCall(page, config.batch.ready, [c.fixture, c.seed ?? 1])))
                throw new Error('Project fixture readiness changed before capture.');
              row.setupMs = performance.now() - setup;
              await Promise.allSettled([...pending]);
              // Revalidate optional/lazy resources recorded by the prior run too.
              if (resume)
                for (const view of c.views) {
                  const receiptPath = join(destination, `${c.id}-${view}.json`);
                  if (!existsSync(receiptPath)) continue;
                  const prior = JSON.parse(readFileSync(receiptPath, 'utf8'));
                  const manifest = readFileSync(prior.identity.manifestPath);
                  if (sha(manifest) !== prior.identity.sha256)
                    throw new Error('Source manifest hash mismatch.');
                  for (const source of JSON.parse(manifest.toString()).sources)
                    if (!sources.has(source.url)) {
                      const response = await context.request.get(localUrl(source.url), {
                        timeout: 20000,
                      });
                      sources.set(
                        source.url,
                        sourceRecord(
                          source.url,
                          response.status(),
                          await response.body(),
                          source.kind,
                        ),
                      );
                    }
                }
              const identity = {
                browser: browser.version(),
                engine: 'chromium',
                toolSha256:
                  sha(readFileSync(new URL('./batch.ts', import.meta.url))) +
                  ':' +
                  sha(readFileSync(new URL('./png.ts', import.meta.url))),
                adapter: config.batch,
                reference: config.referenceIdentity,
                url: config.url,
                sources: [...sources.values()].sort((a, b) => a.url.localeCompare(b.url)),
                complete: sourceFailures === 0,
                helpers: scripts.map((s) => ({
                  name: s.name,
                  sha256: sha(s.bytes),
                })),
              };
              if (!identity.complete || errors.length)
                throw new Error('Source collection or browser errors; see worker diagnostics.');
              const identityBytes = JSON.stringify(identity, null, 2),
                identityHash = sha(identityBytes),
                identityFile = join(destination, 'sources-' + identityHash + '.json');
              if (!existsSync(identityFile)) writeFileSync(identityFile, identityBytes);
              const identityRef = {
                manifestPath: identityFile,
                sha256: identityHash,
                reference: identity.reference,
                complete: true,
              };
              row.identity = identityRef;
              for (const view of c.views) {
                const base = join(destination, `${c.id}-${view}`),
                  fingerprint = sha(
                    JSON.stringify({
                      c,
                      view,
                      size,
                      identity: inputIdentity(identity),
                    }),
                  );
                if (resume && existsSync(base + '.json') && existsSync(base + '.png')) {
                  const prior = JSON.parse(readFileSync(base + '.json', 'utf8'));
                  if (reusable(prior, fingerprint, readFileSync(base + '.png'))) {
                    row.views.push({
                      ...prior,
                      reused: true,
                    });
                    continue;
                  }
                  throw new Error(
                    'Existing evidence inputs changed; use a fresh output directory.',
                  );
                }
                const begin = performance.now();
                await adapterCall(page, config.batch.view, [view]);
                await page.evaluate(
                  () =>
                    new Promise<void>((r) =>
                      requestAnimationFrame(() => requestAnimationFrame(() => r())),
                    ),
                );
                if (!(await adapterCall(page, config.batch.ready, [c.fixture, c.seed ?? 1])))
                  throw new Error('Project fixture not ready after view change.');
                const state = {
                  viewport: await page.evaluate(() => ({
                    width: innerWidth,
                    height: innerHeight,
                    dpr: devicePixelRatio,
                    zoom: visualViewport?.scale ?? 1,
                  })),
                  probe: await adapterCall(page, config.batch.probe),
                };
                if (
                  state.viewport.width !== size.width ||
                  state.viewport.height !== size.height ||
                  state.viewport.dpr !== 1 ||
                  state.viewport.zoom !== 1
                )
                  throw new Error('Native viewport mismatch.');
                const renderMs = performance.now() - begin,
                  screenshotStart = performance.now();
                await Promise.allSettled([...pending]);
                if (
                  sourceFailures ||
                  JSON.stringify(
                    inputIdentity({
                      sources: [...sources.values()].sort((a, b) => a.url.localeCompare(b.url)),
                    }),
                  ) !== JSON.stringify(inputIdentity({ sources: identity.sources }))
                )
                  throw new Error(
                    'View loaded new or changed sources; preload all view dependencies in the project reset/readiness adapter.',
                  );
                const png = await nativePng(page);
                if (png.readUInt32BE(16) !== size.width || png.readUInt32BE(20) !== size.height)
                  throw new Error('Native PNG dimensions mismatch.');
                if (errors.length) throw new Error('Browser errors during capture.');
                writeFileSync(base + '.png', png);
                const receipt = {
                  schemaVersion: 1,
                  status: 'captured',
                  case: c.id,
                  view,
                  viewport: group.viewport,
                  native: size,
                  state,
                  identity: identityRef,
                  fingerprint,
                  sha256: sha(png),
                  timings: {
                    renderMs,
                    screenshotMs: performance.now() - screenshotStart,
                    viewToPngMs: performance.now() - begin,
                  },
                  errors: [...errors],
                  notes: [
                    'Static fixture evidence, not normal-input or motion acceptance.',
                    'A seed alone does not establish deterministic visuals; inspect the project probe and actual pixels. Stochastic variation is not a parity pass.',
                    'Lossless PNG; view timing includes camera change, two animation frames, state probe, screenshot, write and hash.',
                  ],
                };
                writeFileSync(base + '.json', JSON.stringify(receipt, null, 2));
                row.views.push(receipt);
                save();
              }
              row.status = 'captured';
            } catch (e) {
              row.status = 'blocked';
              row.error = String(e);
              row.errors = [...errors];
              if (String(e).includes('Timeout')) break;
            } finally {
              clearTimeout(caseDeadline);
            }
            save();
          }
        } finally {
          clearTimeout(deadline);
          abort.signal.removeEventListener('abort', cancelContext);
          await context.close();
        }
      }
    } finally {
      try {
        await browser?.close();
      } finally {
        lease.lost.removeEventListener('abort', stop);
        await lease.release();
      }
    }
  }
  try {
    save();
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(workers, groups.length) }, () => worker()),
    );
    report.workerErrors = results
      .filter((r) => r.status === 'rejected')
      .map((r: any) => String(r.reason));
    report.status =
      !abort.signal.aborted &&
      !report.workerErrors.length &&
      report.cases.length === spec.cases.length &&
      report.cases.every((r: any) => r.status === 'captured')
        ? 'captured'
        : 'blocked';
    report.notRun = spec.cases
      .filter((c: any) => !report.cases.some((r: any) => r.id === c.id))
      .map((c: any) => c.id);
    const measured = report.cases
      .flatMap((c: any) =>
        c.views.filter((v: any) => !v.reused).map((v: any) => v.timings.viewToPngMs),
      )
      .sort((a: number, b: number) => a - b);
    report.performance = {
      captures: measured.length,
      reused: report.cases.reduce(
        (n: number, c: any) => n + c.views.filter((v: any) => v.reused).length,
        0,
      ),
      medianMs: measured.length ? measured[Math.floor(measured.length / 2)] : null,
      p95Ms: measured.length ? measured[Math.ceil(measured.length * 0.95) - 1] : null,
      maxMs: measured.length ? measured.at(-1) : null,
      allViewsUnderOneSecond: measured.length > 0 && measured.every((ms: number) => ms < 1000),
    };
    report.elapsedMs = performance.now() - started;
    save();
    return report;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    unlinkSync(lock);
  }
}
