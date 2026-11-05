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
    { bindingErrors: ['missing'] },
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
  const camera = { projectionMatrix: matrix, matrixWorld: matrix };
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
