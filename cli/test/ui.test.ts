import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { compareSnapshots, compareUI, loadSnapshot, validateSpec } from '../src/ui.ts';
import { sha, validateStep, readProjectConfig } from '../src/config.ts';
import { runMatrix, runCommand } from '../src/ui-runner.ts';
const spec = () => ({
  schemaVersion: 1,
  stateKeys: ['view', 'page'],
  elements: [
    {
      id: 'shop.price',
      reference: { name: 'Price' },
      candidate: { path: 'Canvas/Price' },
      boundsTolerance: 1,
      checks: [{ path: 'text.value' }, { path: 'text.baseline', tolerance: 1, unit: 'px' }],
    },
  ],
});
const snap = () => ({
  schemaVersion: 1,
  coordinateSpace: 'native-top-left-pixels',
  viewport: { width: 100, height: 200 },
  safeArea: { x: 0, y: 0, width: 100, height: 200 },
  state: { view: 'shop', page: 0 },
  nodes: [
    {
      name: 'Price',
      path: 'Canvas/Price',
      bounds: { x: 10, y: 20, width: 40, height: 20 },
      visible: true,
      text: { value: '£1.99', baseline: 35 },
    },
  ],
});
test('semantic mapping measures geometry and typography independently of hierarchy indices', () => {
  const a = snap(),
    b = snap();
  b.nodes[0].bounds.x += 0.5;
  const r = compareSnapshots(a, b, spec());
  assert.equal(r.status, 'passed');
  b.nodes[0].text.baseline += 4;
  assert.equal(compareSnapshots(a, b, spec()).status, 'difference');
});
test('state, dimensions, coordinates and safe area gate acceptance', () => {
  for (const mutate of [
    (b: any) => (b.state.page = 1),
    (b: any) => delete b.state.view,
    (b: any) => (b.viewport.width = 200),
    (b: any) => {
      b.safeArea.y = 20;
      b.safeArea.height = 180;
    },
    (b: any) => (b.coordinateSpace = 'bottom-left'),
  ]) {
    const b: any = snap();
    mutate(b);
    assert.equal(compareSnapshots(snap(), b, spec()).status, 'blocked');
  }
});
test('missing font metrics never pass and exact text remains independently measurable', () => {
  const b: any = snap();
  delete b.nodes[0].text.baseline;
  const r = compareSnapshots(snap(), b, spec());
  assert.equal(r.status, 'unmeasured');
  assert.equal(r.elements[0].checks.find((c: any) => c.path === 'text.value').status, 'passed');
});
test('ambiguous selector is blocked; truncated missing inventory is unmeasured', () => {
  const b: any = snap();
  b.nodes.push(b.nodes[0]);
  assert.equal(compareSnapshots(snap(), b, spec()).status, 'blocked');
  b.nodes = [];
  b.truncated = true;
  assert.equal(compareSnapshots(snap(), b, spec()).status, 'unmeasured');
  b.truncated = false;
  assert.equal(compareSnapshots(snap(), b, spec()).status, 'difference');
});
test('schema rejects vacuous comparisons, duplicate IDs and invalid tolerances', () => {
  for (const change of [
    (s: any) => (s.elements = []),
    (s: any) => (s.stateKeys = []),
    (s: any) => s.elements.push(s.elements[0]),
    (s: any) => (s.elements[0].reference = {}),
    (s: any) => (s.elements[0].boundsTolerance = -1),
    (s: any) => (s.elements[0].checks[1].tolerance = NaN),
  ]) {
    const s: any = spec();
    change(s);
    assert.throws(() => validateSpec(s));
  }
});
test('gap and alignment checks report native pixel deltas', () => {
  const s: any = spec();
  s.elements.push({ id: 'button', reference: { name: 'Button' }, candidate: { name: 'Button' } });
  s.relations = [{ from: 'shop.price', to: 'button', metric: 'gapY', tolerance: 1 }];
  const a: any = snap(),
    b: any = snap();
  a.nodes.push({ name: 'Button', visible: true, bounds: { x: 10, y: 45, width: 40, height: 20 } });
  b.nodes.push({ name: 'Button', visible: true, bounds: { x: 10, y: 50, width: 40, height: 20 } });
  assert.equal(compareSnapshots(a, b, s).relations[0].delta, 5);
});
test('PNG receipts validate hashes and native dimensions; HTML safely escapes user text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'helix-ui-test-'));
  try {
    const png = new PNG({ width: 100, height: 200 });
    const bytes = PNG.sync.write(png);
    writeFileSync(join(dir, 'image.png'), bytes);
    const receipt: any = { ui: snap(), image: 'image.png', sha256: sha(bytes) };
    writeFileSync(join(dir, 'a.json'), JSON.stringify(receipt));
    const s: any = spec();
    s.elements[0].id = '<script>alert(1)</script>';
    writeFileSync(join(dir, 'spec.json'), JSON.stringify(s));
    assert.equal(
      compareUI(join(dir, 'a.json'), join(dir, 'a.json'), join(dir, 'spec.json'), join(dir, 'out'))
        .status,
      'passed',
    );
    const html = readFileSync(join(dir, 'out/review.html'), 'utf8');
    assert(!html.includes(s.elements[0].id));
    assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    receipt.sha256 = 'bad';
    writeFileSync(join(dir, 'b.json'), JSON.stringify(receipt));
    assert.throws(() => loadSnapshot(join(dir, 'b.json')), /hash mismatch/);
    receipt.sha256 = sha(bytes);
    receipt.ui.viewport.width = 99;
    writeFileSync(join(dir, 'b.json'), JSON.stringify(receipt));
    assert.throws(() => loadSnapshot(join(dir, 'b.json')), /dimensions/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('interaction steps require bounded coordinates/deltas and explicit assertion expectations', () => {
  for (const s of [
    { kind: 'assert', expression: 'false', expected: false },
    { kind: 'pointerDown', x: 1, y: 2 },
    { kind: 'pointerUp', x: 1, y: 2 },
    { kind: 'hover', x: 1, y: 2 },
    { kind: 'wheel', x: 1, y: 2, deltaX: 0, deltaY: 100 },
  ])
    assert.deepEqual(validateStep(s), s);
  assert.throws(() => validateStep({ kind: 'assert', expression: 'true' }));
  assert.throws(() => validateStep({ kind: 'wheel', x: 1, y: 2, deltaX: 0, deltaY: Infinity }));
});
function project() {
  const root = mkdtempSync(join(tmpdir(), 'helix-runner-'));
  mkdirSync(join(root, 'Tools/Helix'), { recursive: true });
  mkdirSync(join(root, '.aikit'), { recursive: true });
  writeFileSync(join(root, '.aikit/lane.json'), '{}');
  writeFileSync(
    join(root, 'Tools/Helix/reference.json'),
    JSON.stringify({
      helix: { project: 'synthetic', variant: 'Default' },
      ready: 'true',
      scenarios: { shop: { unity: {}, steps: [], ready: 'true' } },
      viewports: { phone: { width: 100, height: 200 } },
    }),
  );
  writeFileSync(join(root, 'spec.json'), JSON.stringify(spec()));
  writeFileSync(
    join(root, 'matrix.json'),
    JSON.stringify({
      schemaVersion: 1,
      cases: [{ id: 'shop-phone', scenario: 'shop', viewport: 'phone', uiSpec: 'spec.json' }],
    }),
  );
  return root;
}
test('matrix is plan-only by default and refuses existing browser ownership', async () => {
  const root = project();
  try {
    const opts = {
      root,
      cli: 'cli',
      specPath: join(root, 'matrix.json'),
      out: join(root, '.aikit/scratch/run'),
    };
    const result = await runMatrix(opts, async () => {
      throw new Error('must not execute');
    });
    assert.equal(result.execute, false);
    assert(!existsSync(opts.out));
    mkdirSync(join(root, '.helix'));
    writeFileSync(join(root, '.helix/connection.json'), '{}');
    await assert.rejects(runMatrix({ ...opts, execute: 'yes' }), /existing browser/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('matrix always restores after preparation failure and preserves diagnostics', async () => {
  const root = project(),
    calls: string[] = [];
  try {
    const fake = async (exe: string, argv: string[]) => {
      const command = argv[0] === 'cli' ? argv[1] : argv[0];
      calls.push(command);
      if (command === 'unity-plan')
        return {
          stdout: JSON.stringify({
            configHash: readProjectConfig(root).configHash,
            revision: { projectRoot: root, revision: 'synthetic', workingTree: '' },
            stages: {
              preflight: [['preflight']],
              prepare: [['prepare']],
              capture: [['capture']],
              restore: [['restore'], ['verify']],
            },
          }),
        };
      if (command === 'prepare') throw new Error('setup failed');
      return {
        stdout: JSON.stringify({ adapterConfigHash: readProjectConfig(root).configHash }),
        exitCode: 0,
      };
    };
    const out = join(root, '.aikit/scratch/run');
    const r = await runMatrix(
      { root, cli: 'cli', specPath: join(root, 'matrix.json'), out, execute: 'yes' },
      fake,
    );
    assert.equal(r.status, 'blocked');
    assert(calls.includes('restore') && calls.includes('verify') && calls.includes('stop'));
    assert.equal(calls.filter((c) => c === 'capture').length, 1); // Reference capture precedes Unity preparation.
    assert.match(readFileSync(join(out, 'matrix.json'), 'utf8'), /setup failed/);
    assert(!existsSync(join(root, '.helix/ui-matrix.lock')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('preflight failure never restores or starts a browser it did not acquire', async () => {
  const root = project(),
    calls: string[] = [];
  try {
    await runMatrix(
      {
        root,
        cli: 'cli',
        specPath: join(root, 'matrix.json'),
        out: join(root, '.aikit/scratch/run'),
        execute: 'yes',
      },
      async (exe, argv) => {
        const c = argv[0] === 'cli' ? argv[1] : argv[0];
        calls.push(c);
        if (c === 'unity-plan')
          return {
            stdout: JSON.stringify({
              configHash: readProjectConfig(root).configHash,
              revision: { projectRoot: root, revision: 'synthetic', workingTree: '' },
              stages: {
                preflight: [['preflight']],
                prepare: [['prepare']],
                capture: [['capture']],
                restore: [['restore']],
              },
            }),
          };
        throw new Error('busy');
      },
    );
    assert.deepEqual(calls, ['unity-plan', 'preflight']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('command runner rejects failure and terminates timed-out children', async () => {
  await assert.rejects(
    runCommand(process.execPath, ['-e', 'process.exit(3)'], tmpdir(), 1000),
    /exited 3/,
  );
  await assert.rejects(
    runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], tmpdir(), 50),
    /timeout/,
  );
});

test('known null state matches while missing state cannot pass', () => {
  const a: any = snap(),
    b: any = snap(),
    s: any = spec();
  a.state.seed = null;
  b.state.seed = null;
  s.stateKeys.push('seed');
  assert.equal(compareSnapshots(a, b, s).status, 'passed');
  delete b.state.seed;
  assert.equal(compareSnapshots(a, b, s).status, 'blocked');
});
test('per-engine expected mappings compare font and sprite provenance without requiring identical identifiers', () => {
  const a: any = snap(),
    b: any = snap(),
    s: any = spec();
  a.nodes[0].text.fontAsset = 'web-font-hash';
  b.nodes[0].text.font = { guid: 'unity-font-guid' };
  s.elements[0].checks.push({
    path: 'font provenance',
    referencePath: 'text.fontAsset',
    candidatePath: 'text.font.guid',
    expected: { reference: 'web-font-hash', candidate: 'unity-font-guid' },
  });
  assert.equal(compareSnapshots(a, b, s).status, 'passed');
  b.nodes[0].text.font.guid = 'wrong';
  assert.equal(compareSnapshots(a, b, s).status, 'difference');
});
test('negative bounds, unavailable bindings and out-of-viewport safe areas never pass', () => {
  const a: any = snap(),
    b: any = snap();
  b.nodes[0].bounds.width = -1;
  assert.equal(compareSnapshots(a, b, spec()).status, 'unmeasured');
  b.nodes[0].bounds.width = 40;
  b.nodes[0].semanticId = 'price';
  const s: any = spec();
  s.elements[0].candidate = { semanticId: 'price' };
  b.bindingErrors = [{ id: 'price', error: 'duplicate binding' }];
  assert.equal(compareSnapshots(a, b, s).status, 'blocked');
  b.safeArea.width = 1000;
  assert.throws(() => compareSnapshots(a, b, s), /outside/);
});
test('matrix completes synthetic capture, reports results and runs every restoration stage', async () => {
  const root = project(),
    calls: string[] = [];
  try {
    const out = join(root, '.aikit/scratch/run');
    const record = (folder: string, image: string, receipt: string) => {
      mkdirSync(folder, { recursive: true });
      const bytes = PNG.sync.write(new PNG({ width: 100, height: 200 }));
      writeFileSync(join(folder, image), bytes);
      writeFileSync(
        join(folder, receipt),
        JSON.stringify({
          image,
          sha256: sha(bytes),
          ui: snap(),
          adapterConfigHash: readProjectConfig(root).configHash,
        }),
      );
    };
    const result = await runMatrix(
      { root, cli: 'cli', specPath: join(root, 'matrix.json'), out, execute: 'yes' },
      async (exe, argv) => {
        const browser = argv[0] === 'cli',
          c = browser ? argv[1] : argv[0];
        calls.push((browser ? 'helix:' : 'unity:') + c);
        if (c === 'unity-plan')
          return {
            stdout: JSON.stringify({
              configHash: readProjectConfig(root).configHash,
              revision: { projectRoot: root, revision: 'synthetic', workingTree: '' },
              stages: {
                preflight: [['preflight']],
                prepare: [['prepare']],
                capture: [['capture']],
                restore: [['restore'], ['verify']],
              },
            }),
          };
        if (c === 'capture')
          record(
            join(out, 'shop-phone', browser ? 'reference' : 'unity'),
            browser ? 'reference.png' : 'unity.png',
            browser ? 'reference.json' : 'unity.json',
          );
        return {
          stdout: JSON.stringify({
            success: true,
            adapterConfigHash: readProjectConfig(root).configHash,
          }),
          exitCode: 0,
        };
      },
    );
    assert.equal(result.status, 'passed');
    assert(existsSync(join(out, 'shop-phone/review/review.html')));
    assert.deepEqual(calls.slice(-3), ['unity:restore', 'unity:verify', 'helix:stop']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('failed restoration prevents later cases and semantic failure responses are rejected', async () => {
  const root = project(),
    calls: string[] = [];
  try {
    const path = join(root, 'matrix.json'),
      m = JSON.parse(readFileSync(path, 'utf8'));
    m.cases.push({ ...m.cases[0], id: 'second' });
    writeFileSync(path, JSON.stringify(m));
    const r = await runMatrix(
      { root, cli: 'cli', specPath: path, out: join(root, '.aikit/scratch/run'), execute: 'yes' },
      async (exe, argv) => {
        const c = argv[0] === 'cli' ? argv[1] : argv[0];
        calls.push(c);
        if (c === 'unity-plan')
          return {
            stdout: JSON.stringify({
              configHash: readProjectConfig(root).configHash,
              revision: { projectRoot: root, revision: 'synthetic', workingTree: '' },
              stages: {
                preflight: [['preflight']],
                prepare: [['prepare']],
                capture: [['capture']],
                restore: [['restore'], ['verify']],
              },
            }),
          };
        return {
          stdout:
            c === 'prepare' || c === 'restore'
              ? '{"success":false}'
              : JSON.stringify({ adapterConfigHash: readProjectConfig(root).configHash }),
        };
      },
    );
    assert.equal(r.status, 'blocked');
    assert.deepEqual(r.notRun, ['second']);
    assert(calls.includes('verify') && calls.includes('stop'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('matrix validates unsupported safe-area cases before executing a recipe', async () => {
  const root = project();
  try {
    const path = join(root, 'matrix.json'),
      m = JSON.parse(readFileSync(path, 'utf8'));
    m.cases[0].safeAreaInsets = { top: 30, right: 0, bottom: 20, left: 0 };
    writeFileSync(path, JSON.stringify(m));
    const r = await runMatrix(
      { root, cli: 'cli', specPath: path, out: join(root, '.aikit/scratch/run'), execute: 'yes' },
      async () => {
        throw new Error('must not execute');
      },
    );
    assert.equal(r.status, 'blocked');
    assert.match(
      readFileSync(join(root, '.aikit/scratch/run/matrix.json'), 'utf8'),
      /device capture/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('standalone isolation requires explicit identity and a matching worktree backlink', async () => {
  const { isolatedWorkspace } = await import('../src/isolation.ts');
  const { realpathSync } = await import('node:fs');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'helix-isolation-')));
  try {
    assert.equal(isolatedWorkspace(root), false);
    mkdirSync(join(root, '.helix'));
    mkdirSync(join(root, 'git-metadata'));
    writeFileSync(join(root, '.git'), 'gitdir: ' + join(root, 'git-metadata'));
    writeFileSync(join(root, 'git-metadata/gitdir'), join(root, '.git'));
    const marker = join(root, '.helix/isolated-worktree.json');
    writeFileSync(
      marker,
      JSON.stringify({ schemaVersion: 1, kind: 'standalone-comparison', projectRoot: root }),
    );
    assert.equal(isolatedWorkspace(root), true);
    writeFileSync(join(root, 'git-metadata/gitdir'), marker);
    assert.throws(() => isolatedWorkspace(root), /backlink/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('matrix lock rejects unrelated browser mutation before connecting', async () => {
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const root = project();
  try {
    mkdirSync(join(root, '.helix'));
    writeFileSync(join(root, '.helix/ui-matrix.lock'), JSON.stringify({ token: 'owned' }));
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            fileURLToPath(new URL('../src/cli.ts', import.meta.url)),
            'stop',
            '--project-root',
            root,
          ],
          { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, HELIX_MATRIX_TOKEN: '' } },
        ),
      /A UI matrix owns/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
