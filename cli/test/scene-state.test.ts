import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSceneState } from '../src/scene-state.ts';
import { compareScenes } from '../src/scene.ts';
const contract = {
  contextKeys: ['view', 'seed', 'result'],
  outcomeKeys: ['coins'],
  observationalKeys: ['timeline'],
};
const a = { view: 'gameplay', seed: 54, result: 'win', coins: 500, timeline: [1] };
const b = { ...a, coins: 90, timeline: [2] };
test('outcomes and timing do not gate geometry; strict remains default', () => {
  const r = compareSceneState(a, b, contract);
  assert.deepEqual(r.prerequisites, []);
  assert.equal(r.outcomes[0].status, 'different');
  assert.equal(r.observations[0].status, 'observed-only');
  assert.equal(compareSceneState(a, b).prerequisites.length, 1);
  const scene = (state) => ({
    schemaVersion: 1,
    kind: 'helix-scene',
    coordinateSpace: 'viewport-top-left-pixels',
    viewport: { width: 10, height: 10, dpr: 1, zoom: 1 },
    checkpoint: 'settled',
    state,
    truncated: false,
    nodes: [{ id: 'a', parentId: null, bounds: { x: 0, y: 0, width: 1, height: 1 } }],
  });
  const result = compareScenes(scene(a), scene(b), {
    schemaVersion: 1,
    stateContract: contract,
    mappings: [{ id: 'a', reference: { ids: ['a'] }, candidate: { ids: ['a'] }, tolerancePx: 0 }],
  });
  assert.equal(result.mappings[0].status, 'within-tolerance');
  assert.equal(result.state.outcomes[0].status, 'different');
});
test('missing context, wrong result and missing versus explicit null stay distinct', () => {
  assert.ok(compareSceneState(a, { ...b, result: 'none' }, contract).prerequisites.length);
  const missing = { ...b };
  delete missing.seed;
  assert.ok(compareSceneState(a, missing, contract).prerequisites.length);
  assert.deepEqual(
    compareSceneState({ ...a, seed: null }, { ...b, seed: null }, contract).prerequisites,
    [],
  );
  delete missing.coins;
  assert.equal(compareSceneState(a, missing, contract).outcomes[0].status, 'unmeasured');
});
test('unclassified fields remain unmeasured and malformed contracts fail closed', () => {
  const r = compareSceneState({ ...a, unknown: 2 }, b, contract);
  assert.equal(r.outcomes[1].reason, 'unclassified-state-key');
  for (const c of [
    { contextKeys: [] },
    { contextKeys: ['view'], outcomeKeys: ['view'] },
    { contextKeys: ['view'], typo: [] },
    { contextKeys: ['view'], outcomeKeys: 'coins' },
  ])
    assert.throws(() => compareSceneState(a, b, c));
});
