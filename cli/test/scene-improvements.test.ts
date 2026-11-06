import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import { sha } from '../src/config.ts';
import { SCENE_INSPECTOR } from '../src/scene-inspector.ts';
import { sampleScene } from '../src/scene-sampler.ts';
import { compareScenes } from '../src/scene.ts';
import { sceneReview } from '../src/scene-review.ts';
import { conversionPlan } from '../src/conversion-plan.ts';
import { resolveSceneOptions, validateSceneOptions } from '../src/scene-options.ts';
const matrix = { toArray: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
  vector = { toArray: () => [0, 0, 0] };
const sn = (nodes) => ({
  schemaVersion: 1,
  kind: 'helix-scene',
  coordinateSpace: 'viewport-top-left-pixels',
  viewport: { width: 100, height: 100, dpr: 1, zoom: 1 },
  nodes,
  state: { view: 's' },
  checkpoint: 's',
  truncated: false,
});
const n = (id, x) => ({
  id,
  semanticId: id,
  parentId: null,
  bounds: { x, y: 10, width: 10, height: 10 },
  raw: { color: [1, 0, 0] },
});
const spec = {
  schemaVersion: 1,
  mappings: [
    {
      id: 'group',
      tolerancePx: 0,
      reference: { ids: ['a', 'b', 'c'] },
      candidate: { ids: ['a', 'b', 'c'] },
    },
  ],
};
test('scoped inventory skips unrelated geometry; own local bounds cache invalidates without mutating engine', () => {
  let reads = 0;
  const attribute = {
    count: 2,
    itemSize: 3,
    version: 0,
    array: new Float32Array([-0.2, 0, 0, 0.2, 0, 0]),
    getX(i) {
      reads++;
      return this.array[i * 3];
    },
    getY() {
      return 0;
    },
    getZ() {
      return 0;
    },
  };
  const mesh = {
    type: 'Mesh',
    geometry: { attributes: { position: attribute }, boundingBox: null },
    matrixWorld: matrix,
    position: vector,
    quaternion: vector,
    scale: vector,
    children: [],
  };
  const other = {
    ...mesh,
    geometry: {
      get attributes() {
        throw new Error('Unrelated geometry visited');
      },
    },
  };
  const root = { ...mesh, geometry: null, children: [mesh, other] };
  mesh.parent = root;
  other.parent = root;
  const camera = { projectionMatrix: matrix, matrixWorld: matrix, matrixWorldInverse: matrix };
  const ctx = vm.createContext({
    root,
    camera,
    mesh,
    innerWidth: 100,
    innerHeight: 100,
    devicePixelRatio: 1,
    visualViewport: { scale: 1 },
    performance: { now: () => 1 },
  });
  const config = {
    three: {
      scene: 'root',
      camera: 'camera',
      surface: '({x:0,y:0,width:100,height:100,axisAligned:true})',
    },
    bindings: [{ id: 'selected', expression: 'mesh' }],
    options: { profile: 'geometry', semanticIds: ['selected'] },
  };
  const capture = () =>
    vm.runInContext('(' + SCENE_INSPECTOR + ')(' + JSON.stringify(config) + ')', ctx);
  const a = capture();
  assert.equal(a.nodes.length, 2);
  assert.equal(a.nodes[0].structuralOnly, true);
  assert.equal(a.nodes[1].raw.materials, undefined);
  assert.equal(reads, 2);
  assert.equal(mesh.geometry.boundingBox, null);
  capture();
  assert.equal(reads, 2);
  attribute.array[3] = 0.4;
  attribute.version++;
  assert.ok(capture().nodes[1].bounds.width > a.nodes[1].bounds.width);
  assert.equal(reads, 4);
  attribute.array[3] = 0.6;
  config.options.geometryRevision = '2';
  capture();
  assert.equal(reads, 6);
  config.options.profile = 'layout';
  capture();
  assert.equal(reads, 6);
  assert.throws(() => validateSceneOptions({ profile: 'misspelled' }));
  assert.throws(() => validateSceneOptions({ semanticIds: ['a', 'a'] }));
  assert.equal(
    resolveSceneOptions({ sceneProfiles: { hud: { profile: 'layout' } } }, 'hud').profile,
    'layout',
  );
});
test('deadline sampler reports missed slots instead of accumulating probe duration', async () => {
  let now = 0;
  const context = vm.createContext({
    performance: { now: () => now },
    TextEncoder,
    setTimeout: (f, t) => {
      now += t;
      f();
    },
    probe: () => {
      now += 25;
      return sn([]);
    },
  });
  const sequence = await vm.runInContext(
    '(' + sampleScene.toString() + ')(probe,{}, {durationMs:100,intervalMs:20})',
    context,
  );
  assert.deepEqual(
    Array.from(sequence.samples, (x) => x.sampledAtMs),
    [0, 40, 80, 120],
  );
  assert.equal(sequence.missedSamples, 3);
  assert.equal(sequence.samples[0].captureDurationMs, 25);
  const failed = await sampleScene(
    () => {
      throw new Error('probe failure');
    },
    {},
    { durationMs: 100, intervalMs: 20 },
  );
  assert.equal(failed.complete, false);
  assert.match(failed.error, /probe failure/);
});
test('relationships detect internal drift hidden by unchanged union; style roles check palette coherence', () => {
  const a = sn([n('a', 0), n('b', 20), n('c', 40)]),
    b = structuredClone(a);
  b.nodes[1].bounds.x += 4;
  const selectors = ['a', 'b'].map((id) => ({ id }));
  const s = {
    ...spec,
    relationships: [
      { id: 'gap', kind: 'gap-x', tolerance: 1, reference: selectors, candidate: selectors },
    ],
    styles: [
      {
        id: 'accent',
        mode: 'linear-color',
        tolerance: 0.01,
        members: ['a', 'b'].map((id) => ({
          reference: { id, path: ['raw', 'color'], colorSpace: 'linear' },
          candidate: { id, path: ['raw', 'color'], colorSpace: 'linear' },
        })),
      },
    ],
  };
  let report = compareScenes(a, b, s);
  assert.equal(report.mappings[0].status, 'within-tolerance');
  assert.equal(report.relationships[0].delta, 4);
  assert.equal(report.relationships[0].status, 'different');
  assert.equal(report.styles[0].status, 'within-tolerance');
  b.nodes[1].raw.color = [0, 1, 0];
  report = compareScenes(a, b, s);
  assert.equal(report.styles[0].status, 'different');
  delete b.nodes[1].bounds;
  assert.equal(compareScenes(a, b, s).relationships[0].status, 'unmeasured');
});
test('offline review binds scene to hashed image/state and escapes embedded labels', async () => {
  const root = mkdtempSync(join(tmpdir(), 'scene-review-')),
    snapshot = sn([n('a', 0), n('b', 20), n('c', 40)]),
    png = PNG.sync.write(new PNG({ width: 100, height: 100 }));
  writeFileSync(join(root, 'image.png'), png);
  const receipt = {
    image: 'image.png',
    sha256: sha(png),
    scene: snapshot,
    ui: { ...snapshot, schemaVersion: 1, coordinateSpace: 'native-top-left-pixels' },
  };
  const put = (name, obj) => writeFileSync(join(root, name), JSON.stringify(obj));
  put('a.json', receipt);
  put('b.json', receipt);
  put('spec.json', {
    ...spec,
    mappings: [{ ...spec.mappings[0], id: '</script><script>alert(1)</script>' }],
  });
  const r = sceneReview(
    join(root, 'a.json'),
    join(root, 'b.json'),
    join(root, 'spec.json'),
    join(root, 'out'),
  );
  const html = readFileSync(r.viewer, 'utf8');
  assert.ok(!html.includes('</script><script>alert'));
  assert.ok(html.includes('data:image/png;base64,'));
  if (process.env.HELIX_BROWSER_TESTS === '1') {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true, channel: 'chromium' });
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('file://' + r.viewer);
      await page.waitForFunction(() => document.querySelector('canvas').width === 100);
      await page.selectOption('#mapping', '0');
      await page.check('#crop');
      assert.equal(await page.locator('#reference').evaluate((c) => c.width), 66);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  }
  receipt.scene = { ...snapshot, checkpoint: 'other' };
  put('b.json', receipt);
  assert.throws(
    () =>
      sceneReview(
        join(root, 'a.json'),
        join(root, 'b.json'),
        join(root, 'spec.json'),
        join(root, 'bad'),
      ),
    /checkpoint/,
  );
  assert.equal(existsSync(join(root, 'bad')), false);
});
test('conversion manifest runs existing asset planner with hash-pinned approved links and detects drift', async () => {
  const root = mkdtempSync(join(tmpdir(), 'conversion-manifest-')),
    png = PNG.sync.write(new PNG({ width: 2, height: 2 }));
  writeFileSync(join(root, 'source.png'), png);
  const assets = {
    schemaVersion: 1,
    assets: [
      {
        id: 'icon',
        source: 'source.png',
        sha256: sha(png),
        destination: 'Assets/Icon.png',
        pivot: [0.5, 0.5],
        pixelsPerUnit: 100,
        border: [0, 0, 0, 0],
        filterMode: 'Bilinear',
        sRGB: true,
      },
    ],
  };
  const path = join(root, 'assets.json');
  writeFileSync(path, JSON.stringify(assets));
  const manifest = {
    schemaVersion: 1,
    approved: true,
    assets: { path: 'assets.json', sha256: sha(readFileSync(path)) },
    elements: [{ id: 'button', assetIds: ['icon'] }],
  };
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  const result = await conversionPlan(root, 'manifest.json', join(root, 'out'));
  assert.equal(result.status, 'planned');
  assert.ok(existsSync(join(root, 'out/assets/icon.png')));
  assert.equal(existsSync(join(root, 'Assets/Icon.png')), false);
  writeFileSync(path, JSON.stringify({ ...assets, extra: true }));
  await assert.rejects(conversionPlan(root, 'manifest.json', join(root, 'bad')), /hash changed/);
});

test(
  'rotated thin mesh agrees across native Unity and Three after explicit handedness conversion',
  { skip: !process.env.HELIX_UNITY_SCENE || !process.env.HELIX_THREE_MODULE },
  async () => {
    const { createRequire } = await import('node:module'),
      { dirname } = await import('node:path');
    const THREE = createRequire(import.meta.url)(process.env.HELIX_THREE_MODULE);
    const candidate = JSON.parse(
      readFileSync(join(dirname(process.env.HELIX_UNITY_SCENE), 'scene-rotated.json'), 'utf8'),
    );
    const data = candidate.cameras[0],
      cube = candidate.nodes.find((n) => n.boundsKind === 'projected-local-aabb-3d');
    const flip = new THREE.Matrix4().makeScale(1, 1, -1),
      root = new THREE.Scene(),
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()),
      camera = new THREE.Camera();
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(flip).multiply(new THREE.Matrix4().fromArray(cube.raw.world)).multiply(flip);
    root.add(mesh);
    root.updateMatrixWorld(true);
    camera.projectionMatrix.fromArray(data.raw.projection);
    camera.matrixWorldInverse.fromArray(data.raw.view).multiply(flip);
    camera.matrixWorld.copy(camera.matrixWorldInverse).invert();
    const ctx = {
      root,
      camera,
      surface: data.surface,
      innerWidth: 120,
      innerHeight: 240,
      devicePixelRatio: 1,
      visualViewport: { scale: 1 },
      performance: { now: () => 0 },
    };
    const raw = vm.runInNewContext(
      '(' +
        SCENE_INSPECTOR +
        ')({three:{scene:"root",camera:"camera",surface:"surface"},state:"({})",checkpoint:"test"})',
      ctx,
    );
    const report = compareScenes(JSON.parse(JSON.stringify(raw)), candidate, {
      schemaVersion: 1,
      mappings: [
        {
          id: 'rotated',
          reference: { ids: ['three/0'] },
          candidate: { ids: [cube.id] },
          tolerancePx: 0.001,
        },
      ],
    });
    assert.equal(report.mappings[0].status, 'within-tolerance');
    assert.equal(mesh.geometry.boundingBox, null);
  },
);
