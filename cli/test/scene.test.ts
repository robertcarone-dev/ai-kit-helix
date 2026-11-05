import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareScenes, compareSceneFiles, validateScene } from '../src/scene.ts';
import { SCENE_INSPECTOR } from '../src/scene-inspector.ts';
import vm from 'node:vm';
const node = (id = 'a', x = 10) => ({
  id,
  parentId: null,
  semanticId: 'thing',
  name: 'Same',
  visible: true,
  bounds: { x, y: 20, width: 40, height: 60 },
  raw: {},
});
const snapshot = (nodes = [node()]) => ({
  schemaVersion: 1,
  kind: 'helix-scene',
  coordinateSpace: 'viewport-top-left-pixels',
  viewport: { width: 100, height: 200, dpr: 1, zoom: 1 },
  state: { view: 'test' },
  checkpoint: 'settled',
  nodes,
  truncated: false,
  bindingErrors: [],
});
const spec = {
  schemaVersion: 1,
  mappings: [
    {
      id: 'part',
      tolerancePx: 1,
      reference: { semanticIds: ['thing'] },
      candidate: { semanticIds: ['thing'] },
    },
  ],
};
test('scene reports directional native and normalized differences without accepting parity', () => {
  const r = compareScenes(snapshot(), snapshot([node('b', 13)]), spec);
  assert.equal(r.acceptance, 'diagnostic-only');
  assert.equal(r.mappings[0].status, 'different');
  assert.equal(r.mappings[0].deltaPx.x, 3);
  assert.equal(r.mappings[0].normalized.candidate.x, 0.13);
});
test('explicit groups union while duplicate semantic ids remain unresolved', () => {
  const b = snapshot([node(), node('b', 50)]);
  assert.equal(compareScenes(snapshot(), b, spec).mappings[0].status, 'unresolved');
  const s = structuredClone(spec);
  s.mappings[0].candidate = { ids: ['a', 'b'] } as any;
  assert.equal(compareScenes(snapshot(), b, s).mappings[0].candidate.bounds.width, 80);
});
test('state checkpoint viewport and binding mismatch withhold measurement', () => {
  for (const change of [
    { state: null },
    { state: { view: 'other' } },
    { checkpoint: 'other' },
    { viewport: { width: 101, height: 200, dpr: 1, zoom: 1 } },
  ]) {
    const r = compareScenes(snapshot(), { ...snapshot(), ...change }, spec);
    assert.equal(r.mappings[0].status, 'unmeasured');
    assert.ok(r.prerequisites.length);
  }
});
test('reject incomplete malformed or cyclic inventories and invalid mappings', () => {
  for (const change of [
    { truncated: true },
    { nodes: [node(), node()] },
    { viewport: { width: 1, height: 1, dpr: 2, zoom: 1 } },
    { nodes: [{ ...node(), parentId: 'a' }] },
    { nodes: [{ ...node(), bounds: { x: NaN, y: 0, width: 1, height: 1 } }] },
  ])
    assert.throws(() => validateScene({ ...snapshot(), ...change }));
  assert.throws(() =>
    compareScenes(snapshot(), snapshot(), {
      ...spec,
      mappings: [{ ...spec.mappings[0], tolerancePx: -1 }],
    }),
  );
});
test('reports retain provenance and escaped overlay annotations without overwriting evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scene-report-'));
  const paths = ['a', 'b', 'spec'].map((n) => join(dir, n + '.json'));
  [
    snapshot(),
    snapshot(),
    { ...spec, mappings: [{ ...spec.mappings[0], id: '<unsafe>' }] },
  ].forEach((v, i) => writeFileSync(paths[i], JSON.stringify(v)));
  const out = join(dir, 'out');
  const r = compareSceneFiles(paths[0], paths[1], paths[2], out);
  assert.equal(r.report.inputs[0].sha256.length, 64);
  assert.match(readFileSync(join(out, 'reference.svg'), 'utf8'), /&lt;unsafe&gt;/);
  assert.throws(() => compareSceneFiles(paths[0], paths[1], paths[2], out));
});
test('browser inventory keeps duplicate names as distinct ids and traverses Three groups read-only', () => {
  const vector = { toArray: () => [0, 0, 0] },
    matrix = { toArray: () => Array(16).fill(0) };
  const child = {
    name: 'Same',
    type: 'Group',
    visible: true,
    position: vector,
    quaternion: vector,
    scale: vector,
    matrixWorld: matrix,
    children: [],
  };
  const root = { ...child, children: [{ ...child }, { ...child }] };
  const camera = { projectionMatrix: matrix, matrixWorldInverse: matrix, matrixWorld: matrix };
  const context = {
    root,
    camera,
    innerWidth: 100,
    innerHeight: 200,
    devicePixelRatio: 1,
    visualViewport: { scale: 1 },
    performance: { now: () => 0 },
  };
  const result = vm.runInNewContext(
    '(' +
      SCENE_INSPECTOR +
      ')({three:{scene:"root",camera:"camera"},state:"({view:1})",checkpoint:"test"})',
    context,
  );
  assert.equal(result.nodes.length, 3);
  assert.equal(result.nodes[1].parentId, 'three');
  assert.notEqual(result.nodes[1].id, result.nodes[2].id);
  assert.equal(result.nodes[1].bounds, null);
});

import { sceneGeometry } from '../src/scene-geometry.ts';
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const surface = { x: 10, y: 20, width: 100, height: 200, axisAligned: true };
test('camera projection accounts for viewport offset, top-left axis, perspective and near plane', () => {
  const g = sceneGeometry();
  assert.deepEqual(g.project([0, 1, 0], identity, identity, surface), { x: 60, y: 20, depth: 0 });
  const perspective = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -11 / 9, -1, 0, 0, -20 / 9, 0];
  assert.equal(g.project([0, 0, 1], identity, perspective, surface), null);
  assert.equal(g.project([0, 0, -0.5], identity, perspective, surface), null);
  assert.equal(g.project([0, 0, -11], identity, perspective, surface), null);
  assert.equal(g.project([0, 0, -2], identity, perspective, surface)?.x, 60);
  assert.equal(g.project([0, 0, 0], identity, identity, { ...surface, axisAligned: false }), null);
});
test('explicit world mappings account for mirrored axes and unit scales without guessing', () => {
  const a: any = snapshot();
  const b: any = snapshot();
  a.nodes[0].raw.world = identity;
  b.nodes[0].raw.world = [...identity];
  b.nodes[0].raw.world[12] = 2;
  for (const s of [a, b]) {
    s.nodes[0].cameraId = 'cam';
    s.cameras = [
      {
        id: 'cam',
        projectionConvention: 'clip-minus-one-to-one',
        raw: { view: identity, projection: identity },
        surface,
      },
    ];
  }
  const s: any = {
    ...spec,
    coordinates: {
      units: 'metres',
      reference: { worldToCommon: identity },
      candidate: { worldToCommon: [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1] },
    },
    landmarks: [
      {
        id: 'origin',
        reference: { id: 'a', point: [0, 0, 0] },
        candidate: { id: 'a', point: [0, 0, 0] },
        tolerancePx: 1,
        toleranceWorld: 0.001,
      },
    ],
  };
  const l = compareScenes(a, b, s).geometry.landmarks[0];
  assert.equal(l.worldDistance, 0);
  assert.equal(l.screenDistancePx, 100);
  assert.equal(l.worldStatus, 'within-tolerance');
  assert.equal(l.screenStatus, 'different');
  delete s.coordinates;
  assert.equal(compareScenes(a, b, s).geometry.landmarks[0].worldStatus, 'unmeasured');
  s.coordinates = {
    units: 'm',
    reference: { worldToCommon: Array(16).fill(0) },
    candidate: { worldToCommon: identity },
  };
  assert.throws(() => compareScenes(a, b, s));
});

test(
  'real Three scene projection respects transformed parents and does not update runtime matrices',
  { skip: !process.env.HELIX_THREE_MODULE },
  async () => {
    const { createRequire } = await import('node:module');
    const THREE = createRequire(import.meta.url)(process.env.HELIX_THREE_MODULE!);
    const root = new THREE.Scene(),
      parent = new THREE.Group(),
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    root.add(parent);
    parent.add(mesh);
    parent.position.set(1, 0, 0);
    parent.rotation.z = 0.3;
    mesh.geometry.computeBoundingBox();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.z = 5;
    root.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const before = mesh.matrixWorld.toArray();
    const context = {
      root,
      camera,
      innerWidth: 100,
      innerHeight: 100,
      devicePixelRatio: 1,
      visualViewport: { scale: 1 },
      performance: { now: () => 0 },
    };
    const result = vm.runInNewContext(
      '(' +
        SCENE_INSPECTOR +
        ')({three:{scene:"root",camera:"camera",surface:"({x:0,y:0,width:100,height:100,axisAligned:true})"}})',
      context,
    );
    assert.equal(result.nodes.length, 3);
    assert.ok(result.nodes[2].bounds.x > 50);
    assert.deepEqual(mesh.matrixWorld.toArray(), before);
    mesh.position.x = 10;
    const stale = vm.runInNewContext(
      '(' +
        SCENE_INSPECTOR +
        ')({three:{scene:"root",camera:"camera",surface:"({x:0,y:0,width:100,height:100,axisAligned:true})"}})',
      context,
    );
    assert.equal(stale.nodes[2].bounds.x, result.nodes[2].bounds.x);
    assert.equal(mesh.matrixWorldNeedsUpdate, false);
  },
);

import { compareMotion, validateSequence } from '../src/scene-motion.ts';
test('appearance compares explicit shader-property mappings and declared color spaces', () => {
  const a: any = snapshot(),
    b: any = snapshot();
  a.nodes[0].raw = { color: [0.5, 0.5, 0.5], roughness: 0.7 };
  b.nodes[0].raw = {
    color: [0.21404114048223255, 0.21404114048223255, 0.21404114048223255],
    smoothness: 0.3,
  };
  const s = {
    ...spec,
    appearance: [
      {
        id: 'color',
        mode: 'linear-color',
        reference: { id: 'a', path: ['raw', 'color'], colorSpace: 'srgb' },
        candidate: { id: 'a', path: ['raw', 'color'], colorSpace: 'linear' },
        tolerance: 0.00001,
      },
      {
        id: 'roughness',
        mode: 'number',
        reference: { id: 'a', path: ['raw', 'roughness'] },
        candidate: { id: 'a', path: ['raw', 'smoothness'], scale: -1, offset: 1 },
        tolerance: 0.001,
      },
    ],
  };
  assert.ok(compareScenes(a, b, s).appearance.every((r) => r.status === 'within-tolerance'));
  delete b.nodes[0].raw.color;
  assert.equal(compareScenes(a, b, s).appearance[0].status, 'unmeasured');
  b.state = { other: true };
  assert.equal(compareScenes(a, b, s).appearance[1].status, 'unmeasured');
});
const sequence = (times: number[], shift = 0) => ({
  schemaVersion: 1,
  kind: 'helix-scene-sequence',
  complete: true,
  samples: times.map((t, i) => ({
    snapshot: {
      ...snapshot([node('a', i * 10 + shift)]),
      timeline: { event: 'impact', elapsedMs: t },
    },
  })),
});
test('motion pairs measured event times without retiming, sample reuse or hidden coverage loss', () => {
  const s = { ...spec, timeToleranceMs: 5 };
  const report = compareMotion(sequence([0, 100, 200]), sequence([1, 101], 2), s);
  assert.equal(report.coverage.pairedSamples, 2);
  assert.equal(report.samples[2].status, 'unmeasured');
  assert.equal(report.trajectories[0].samples[0].deltaPx.x, 2);
  assert.equal(
    compareMotion(sequence([5, 100]), sequence([0, 10, 100]), s).samples[0].status,
    'unmeasured',
  );
  assert.throws(() => validateSequence(sequence([0, 0])));
  assert.throws(() => validateSequence({ ...sequence([0, 1]), complete: false }));
  const b = sequence([0, 1]);
  b.samples[0].snapshot.timeline.event = 'other';
  assert.throws(() => compareMotion(sequence([0, 1]), b, s));
  const bare: any = sequence([0, 1]);
  delete bare.samples[0].snapshot.timeline;
  assert.throws(() => compareMotion(bare, sequence([0, 1]), s));
});
test('motion reports changed state and appearance separately at each measured sample', () => {
  const a: any = sequence([0, 10]),
    b: any = sequence([0, 10]);
  b.samples[1].snapshot.state = { view: 'other' };
  const r = compareMotion(a, b, { ...spec, timeToleranceMs: 0 });
  assert.equal(r.samples[0].report.mappings[0].status, 'within-tolerance');
  assert.equal(r.samples[1].report.mappings[0].status, 'unmeasured');
});

test(
  'native Unity and actual Three agree on projected cube bounds and mirrored local landmarks',
  { skip: !process.env.HELIX_UNITY_SCENE || !process.env.HELIX_THREE_MODULE },
  async () => {
    const { createRequire } = await import('node:module');
    const THREE = createRequire(import.meta.url)(process.env.HELIX_THREE_MODULE!);
    const candidate = JSON.parse(readFileSync(process.env.HELIX_UNITY_SCENE!, 'utf8'));
    const cameraData = candidate.cameras[0],
      aspect = cameraData.raw.projection[5] / cameraData.raw.projection[0];
    const root = new THREE.Scene(),
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    root.add(mesh);
    mesh.geometry.computeBoundingBox();
    const camera = new THREE.OrthographicCamera(
      -2 * aspect,
      2 * aspect,
      2,
      -2,
      cameraData.raw.near,
      cameraData.raw.far,
    );
    camera.position.z = 5;
    camera.updateMatrixWorld(true);
    root.updateMatrixWorld(true);
    const ctx = {
      root,
      camera,
      innerWidth: 120,
      innerHeight: 240,
      devicePixelRatio: 1,
      visualViewport: { scale: 1 },
      performance: { now: () => 0 },
      surface: cameraData.surface,
    };
    const reference = vm.runInNewContext(
      '(' +
        SCENE_INSPECTOR +
        ')({three:{scene:"root",camera:"camera",surface:"surface"},state:"({})",checkpoint:"test"})',
      ctx,
    );
    // Cross-realm objects are serialized exactly like real browser snapshots.
    const r = JSON.parse(JSON.stringify(reference));
    const spec = {
      schemaVersion: 1,
      mappings: [
        {
          id: 'cube',
          reference: { ids: ['three/0'] },
          candidate: { ids: ['unity/2'] },
          tolerancePx: 0.001,
        },
      ],
      coordinates: {
        units: 'fixture-units',
        reference: { worldToCommon: identity },
        candidate: { worldToCommon: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1] },
      },
      landmarks: [
        {
          id: 'corner',
          reference: { id: 'three/0', point: [0.5, 0.5, -0.5] },
          candidate: { id: 'unity/2', point: [0.5, 0.5, 0.5] },
          tolerancePx: 0.001,
          toleranceWorld: 0.001,
        },
      ],
    };
    const report = compareScenes(r, candidate, spec);
    assert.equal(report.mappings[0].status, 'within-tolerance');
    assert.equal(report.geometry.landmarks[0].screenStatus, 'within-tolerance');
    assert.equal(report.geometry.landmarks[0].worldStatus, 'within-tolerance');
  },
);

test('binding errors affect only selected aliases; independent explicit nodes remain measurable', () => {
  const b = { ...snapshot(), bindingErrors: [{ id: 'thing', error: 'unavailable' }] };
  const s = {
    ...spec,
    mappings: [
      ...spec.mappings,
      { id: 'explicit', reference: { ids: ['a'] }, candidate: { ids: ['a'] }, tolerancePx: 1 },
    ],
  };
  const r = compareScenes(snapshot(), b, s);
  assert.equal(r.mappings[0].status, 'unresolved');
  assert.equal(r.mappings[1].status, 'within-tolerance');
  assert.deepEqual(r.prerequisites, []);
});
