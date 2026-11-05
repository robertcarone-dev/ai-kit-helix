import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const script = readFileSync(new URL('../src/browser/three-camera.js', import.meta.url), 'utf8');
function harness() {
  const array = (elements: number[]) => ({ elements, toArray() { return [...this.elements]; }, fromArray(value) { this.elements = [...value]; } });
  const camera: any = {
    isPerspectiveCamera: true, fov: 63, aspect: 0.46, near: 0.1, far: 100, zoom: 1.3, focus: 8, filmGauge: 35, filmOffset: 4,
    position: array([1, 2, 3]), quaternion: array([0, 0, 0, 1]), up: array([0, 1, 0]),
    projectionMatrix: array(Array.from({ length: 16 }, (_, i) => i)),
    projectionMatrixInverse: array(Array.from({ length: 16 }, (_, i) => -i)),
    view: { enabled: true, offsetY: 130 }, updateMatrixWorld() {},
    clearViewOffset() { if (this.view) this.view.enabled = false; },
    updateProjectionMatrix() { this.projectionMatrix.elements[8] = this.filmOffset; this.projectionMatrix.elements[9] = this.view?.enabled ? this.view.offsetY : 0; },
  };
  const window: any = {};
  runInNewContext(script, { window });
  return { camera, api: window.helixThreeCamera, window };
}
test('loading and observing never mutate a camera; invalid requests fail before mutation', () => {
  const { camera, api, window } = harness();
  const before = JSON.stringify(camera);
  api.describe(camera);
  api.save(camera);
  runInNewContext(script, { window });
  assert.equal(window.helixThreeCamera, api);
  for (const fov of [undefined, NaN, 0, -1, 180, Infinity]) assert.throws(() => api.center(camera, { fov }), /explicit FOV/);
  assert.throws(() => api.center({ ...camera, isPerspectiveCamera: false }, { fov: 40 }), /PerspectiveCamera/);
  assert.equal(JSON.stringify(camera), before);
});
test('explicit diagnostic lens centers all offsets and restore preserves exact saved matrices and lens', () => {
  for (const view of [null, { enabled: true, offsetY: 130 }]) {
    const { camera, api } = harness();
    camera.view = view;
    const before = api.describe(camera);
    const restore = api.save(camera);
    api.center(camera, { fov: 40 });
    assert.equal(camera.fov, 40);
    assert.equal(camera.zoom, 1);
    assert.equal(camera.filmOffset, 0);
    assert.deepEqual(camera.projectionMatrix.elements.slice(8, 10), [0, 0]);
    camera.position.fromArray([9, 8, 7]);
    camera.near = 2;
    camera.far = 900;
    camera.aspect = 2;
    restore();
    assert.deepEqual(api.describe(camera), before);
    // Restoration does not expose its saved view object to subsequent mutation.
    if (camera.view) camera.view.offsetY = 999;
    restore();
    assert.deepEqual(api.describe(camera), before);
  }
});
