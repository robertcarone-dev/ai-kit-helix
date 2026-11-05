import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import { sha } from '../src/config.ts';
import { extractFrame, layoutFor, uiAssets, uiPlan, uiImpact, typography } from '../src/ui-port.ts';
const put = (p, v) => writeFileSync(p, JSON.stringify(v));
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'helix-ui-port-'));
  mkdirSync(join(root, 'Assets'));
  writeFileSync(join(root, 'Assets/Widget.prefab'), 'synthetic-prefab-bytes');
  const layout = {
    anchorMin: [0, 1],
    anchorMax: [0, 1],
    pivot: [0.5, 0.5],
    anchoredPosition: [0, 0],
    sizeDelta: [10, 10],
  };
  put(join(root, 'inspect.json'), {
    prefab: 'Assets/Widget.prefab',
    prefabSha256: sha(Buffer.from('synthetic-prefab-bytes')),
    nodes: [{ target: '', layout, nested: false, controllers: [] }],
  });
  const samples = [100, 200].map((width, i) => {
    const height = 100,
      sample = {
        id: 's' + i,
        reference: `r${i}.json`,
        candidate: `c${i}.json`,
        parents: {
          widget: { bounds: { x: 0, y: 0, width, height }, axisAligned: true, unitsPerPixel: 1 },
        },
      };
    const image = PNG.sync.write(new PNG({ width, height }));
    writeFileSync(join(root, `im${i}.png`), image);
    for (const side of ['r', 'c'])
      put(join(root, `${side}${i}.json`), {
        image: `im${i}.png`,
        sha256: sha(image),
        ui: {
          schemaVersion: 1,
          coordinateSpace: 'native-top-left-pixels',
          viewport: { width, height, dpr: 1, zoom: 1 },
          safeArea: { x: 0, y: 0, width, height },
          state: { view: 'fixture' },
          nodes: [
            {
              semanticId: 'widget',
              visible: true,
              bounds: { x: 10, y: 20, width: 30, height: 40 },
              layout: { rotation: 0 },
            },
          ],
        },
      });
    return sample;
  });
  const spec = {
    schemaVersion: 1,
    stateKeys: ['view'],
    samples,
    elements: [
      {
        id: 'widget',
        unity: { prefab: 'Assets/Widget.prefab', target: '', inspection: 'inspect.json' },
        anchor: [0, 1],
        pivot: [0.5, 0.5],
        toleranceUnits: 0.01,
      },
    ],
    states: [
      {
        id: 'locked',
        reference: 'locked',
        unity: 'Locked',
        kind: 'fixture',
        trigger: 'project visual-state fixture',
      },
    ],
  };
  put(join(root, 'spec.json'), spec);
  return { root, spec, close: () => rmSync(root, { recursive: true, force: true }) };
}
test('native top-left layout converts position, size, pivot and scale without guessed anchors', () => {
  assert.deepEqual(
    layoutFor(
      { x: 10, y: 20, width: 30, height: 40 },
      { bounds: { x: 0, y: 0, width: 100, height: 200 }, unitsPerPixel: 2, axisAligned: true },
      [0, 1],
      [0.5, 0.5],
    ),
    {
      anchorMin: [0, 1],
      anchorMax: [0, 1],
      pivot: [0.5, 0.5],
      anchoredPosition: [50, -80],
      sizeDelta: [60, 80],
    },
  );
  assert.throws(
    () =>
      layoutFor(
        { x: 0, y: 0, width: 1, height: 1 },
        { bounds: { x: 0, y: 0, width: 10, height: 10 }, unitsPerPixel: 1 },
        [0, 1],
        [0.5, 0.5],
      ),
    /axis-aligned/,
  );
});
test('asset crop unrotates clockwise packing and restores transparent trim', () => {
  const src = new PNG({ width: 2, height: 3 });
  for (let i = 0; i < 6; i++) {
    src.data[i * 4] = i + 1;
    src.data[i * 4 + 3] = 255;
  }
  const out = extractFrame(src, {
    rotation: 'cw90',
    originalSize: { width: 5, height: 4 },
    trimOffset: { x: 1, y: 1 },
  });
  assert.deepEqual([out.width, out.height], [5, 4]);
  assert.deepEqual(
    [out.data[(1 * 5 + 1) * 4], out.data[(1 * 5 + 2) * 4], out.data[(1 * 5 + 3) * 4]],
    [2, 4, 6],
  );
  assert.equal(out.data[3], 0);
  assert.throws(
    () => extractFrame(src, { rect: { x: 1, y: 0, width: 2, height: 3 } }),
    /rectangle/,
  );
  assert.throws(() => extractFrame(src, { rotation: 'guess' }), /rotation/);
});
test('asset package verifies original hash, creates import metadata and never writes Assets', async () => {
  const h = setup();
  try {
    const bytes = PNG.sync.write(new PNG({ width: 3, height: 2 }));
    writeFileSync(join(h.root, 'source.png'), bytes);
    const spec = {
      schemaVersion: 1,
      assets: [
        {
          id: 'icon',
          source: 'source.png',
          sha256: sha(bytes),
          destination: 'Assets/Imported.png',
          pivot: [0.5, 0.5],
          pixelsPerUnit: 100,
          border: [0, 0, 0, 0],
        },
      ],
    };
    put(join(h.root, 'assets.json'), spec);
    const result = await uiAssets(h.root, 'assets.json', join(h.root, 'output'));
    assert.equal(result.assets[0].sha256, sha(readFileSync(join(h.root, 'output/icon.png'))));
    assert.equal(existsSync(join(h.root, 'Assets/Imported.png')), false);
    spec.assets[0].sha256 = '0'.repeat(64);
    put(join(h.root, 'bad.json'), spec);
    await assert.rejects(uiAssets(h.root, 'bad.json', join(h.root, 'bad-output')), /hash mismatch/);
    assert.equal(existsSync(join(h.root, 'bad-output')), false);
  } finally {
    h.close();
  }
});
test('matching viewport samples create a hash-guarded plan and explicit visual state contract', () => {
  const h = setup();
  try {
    const result = uiPlan(h.root, 'spec.json', join(h.root, 'out'));
    assert.equal(result.status, 'planned');
    assert.equal(result.operations, 1);
    const plan = JSON.parse(readFileSync(result.plan, 'utf8'));
    assert.deepEqual(plan.operations[0].set.anchoredPosition, [25, -40]);
    assert.equal(
      readFileSync(join(h.root, 'Assets/Widget.prefab'), 'utf8'),
      'synthetic-prefab-bytes',
    );
    assert.equal(
      JSON.parse(readFileSync(join(h.root, 'out/state-contract.json'), 'utf8')).acceptance,
      'unmeasured',
    );
  } finally {
    h.close();
  }
});
for (const failure of ['one-viewport', 'responsive', 'nested', 'driver', 'custom-driver'])
  test('planner withholds unsafe operation: ' + failure, () => {
    const h = setup();
    try {
      if (failure === 'one-viewport') h.spec.samples.pop();
      if (failure === 'responsive') {
        const p = join(h.root, 'r1.json'),
          r = JSON.parse(readFileSync(p, 'utf8'));
        r.ui.nodes[0].bounds.x = 35;
        put(p, r);
      }
      if (failure === 'nested' || failure === 'driver' || failure === 'custom-driver') {
        const p = join(h.root, 'inspect.json'),
          r = JSON.parse(readFileSync(p, 'utf8'));
        r.nodes[0].nested = failure === 'nested';
        r.nodes[0].controllers = failure === 'driver' ? ['LayoutGroup'] : [];
        r.nodes[0].componentTypes = ['Synthetic.StateController'];
        if (failure === 'custom-driver')
          (h.spec as any).controllerTypes = ['Synthetic.StateController'];
        put(p, r);
      }
      put(join(h.root, 'spec.json'), h.spec);
      const r = uiPlan(h.root, 'spec.json', join(h.root, 'out'));
      assert.equal(r.status, 'partial');
      assert.equal(r.operations, 0);
    } finally {
      h.close();
    }
  });
for (const failure of ['state', 'image', 'prefab'])
  test('planner rejects stale/mismatched evidence before output: ' + failure, () => {
    const h = setup();
    try {
      if (failure === 'state') {
        const p = join(h.root, 'c0.json'),
          r = JSON.parse(readFileSync(p, 'utf8'));
        r.ui.state.view = 'other';
        put(p, r);
      }
      if (failure === 'image')
        writeFileSync(
          join(h.root, 'im0.png'),
          PNG.sync.write(new PNG({ width: 100, height: 100, bgColor: 0xff0000ff })),
        );
      if (failure === 'prefab') writeFileSync(join(h.root, 'Assets/Widget.prefab'), 'changed');
      if (failure === 'image') {
        const p = join(h.root, 'r0.json'),
          r = JSON.parse(readFileSync(p, 'utf8'));
        r.sha256 = '0'.repeat(64);
        put(p, r);
      }
      assert.throws(() => uiPlan(h.root, 'spec.json', join(h.root, 'out')));
      assert.equal(existsSync(join(h.root, 'out')), false);
    } finally {
      h.close();
    }
  });
test('typography diagnoses content and family; unavailable glyph fallback stays unmeasured', () => {
  const findings = typography(
    { value: '100', family: 'A', fontSize: 12, baseline: 20 },
    { value: '1,000', family: 'B', fontSize: 12, baseline: 24 },
  );
  assert.ok(findings.some((f) => f.field === 'value' && f.status === 'difference'));
  assert.ok(findings.some((f) => f.field === 'family' && f.status === 'difference'));
  assert.ok(findings.some((f) => f.field === 'baseline' && f.status === 'difference'));
  assert.ok(findings.some((f) => f.status === 'unmeasured'));
});
test('incremental validation invalidates changed case inputs and modified evidence only', () => {
  const h = setup();
  try {
    writeFileSync(join(h.root, 'other.txt'), 'other');
    const spec = {
      schemaVersion: 1,
      cases: [
        { id: 'a', inputs: ['Assets/Widget.prefab'], evidence: ['im0.png'] },
        { id: 'b', inputs: ['other.txt'], evidence: ['im1.png'] },
      ],
    };
    put(join(h.root, 'cases.json'), spec);
    const first = uiImpact(h.root, 'cases.json', undefined, join(h.root, 'first'));
    assert.ok(first.cases.every((c) => c.status === 'needs-validation'));
    const second = uiImpact(h.root, 'cases.json', 'first/impact.json', join(h.root, 'second'));
    assert.ok(second.cases.every((c) => c.status === 'reusable'));
    writeFileSync(join(h.root, 'Assets/Widget.prefab'), 'changed');
    const third = uiImpact(h.root, 'cases.json', 'first/impact.json', join(h.root, 'third'));
    assert.equal(third.cases[0].status, 'needs-validation');
    assert.equal(third.cases[1].status, 'reusable');
    writeFileSync(join(h.root, 'im1.png'), 'tampered');
    const fourth = uiImpact(h.root, 'cases.json', 'first/impact.json', join(h.root, 'fourth'));
    assert.equal(fourth.cases[1].status, 'needs-validation');
  } finally {
    h.close();
  }
});

test('modular binding files combine and reject duplicates across modules', async () => {
  const { execFileSync } = await import('node:child_process');
  const h = setup();
  try {
    mkdirSync(join(h.root, 'Tools/Helix'), { recursive: true });
    const config = {
      helix: { project: 'synthetic', variant: 'Default' },
      ready: 'true',
      viewports: { phone: { width: 100, height: 100 } },
      uiBindingsFile: 'base.json',
      uiBindingsFiles: ['feature.json'],
    };
    put(join(h.root, 'Tools/Helix/reference.json'), config);
    put(join(h.root, 'base.json'), {
      schemaVersion: 1,
      elements: [{ id: 'base', reference: 'window.base' }],
    });
    put(join(h.root, 'feature.json'), {
      schemaVersion: 1,
      elements: [{ id: 'feature', reference: 'window.feature' }],
    });
    const script = `import {readConfig} from ${JSON.stringify(new URL('../src/config.ts', import.meta.url).href)}; console.log(JSON.stringify(readConfig().config.uiBindings));`;
    const run = () =>
      execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: h.root,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    assert.equal(JSON.parse(run()).length, 2);
    put(join(h.root, 'feature.json'), {
      schemaVersion: 1,
      elements: [{ id: 'base', reference: 'window.feature' }],
    });
    assert.throws(run, /duplicate UI binding/);
  } finally {
    h.close();
  }
});
