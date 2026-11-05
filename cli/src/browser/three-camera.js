// Optional browser instrumentation. Loading this file never selects or changes a camera.
(() => {
  if (window.helixThreeCamera) {
    if (window.helixThreeCamera.version !== 1) throw new Error('Incompatible Helix camera utility.');
    return;
  }
  const fields = ['fov', 'aspect', 'near', 'far', 'zoom', 'focus', 'filmGauge', 'filmOffset'];
  function requireCamera(camera) {
    if (!camera?.isPerspectiveCamera) throw new Error('Supply a Three.js PerspectiveCamera.');
  }
  function describe(camera) {
    requireCamera(camera);
    return {
      ...Object.fromEntries(fields.map(key => [key, camera[key]])),
      position: camera.position.toArray(), rotation: camera.quaternion.toArray(), up: camera.up.toArray(),
      projection: camera.projectionMatrix.toArray(), inverse: camera.projectionMatrixInverse.toArray(),
      projectionShift: [camera.projectionMatrix.elements[8], camera.projectionMatrix.elements[9]],
      viewOffset: camera.view ? { ...camera.view } : null,
    };
  }
  function save(camera) {
    const state = describe(camera);
    // A closure owns this camera only; the adapter owns render hooks and session lifetime.
    return () => {
      for (const key of fields) camera[key] = state[key];
      camera.position.fromArray(state.position);
      camera.quaternion.fromArray(state.rotation);
      camera.up.fromArray(state.up);
      camera.view = state.viewOffset ? { ...state.viewOffset } : null;
      camera.updateMatrixWorld(true);
      camera.projectionMatrix.fromArray(state.projection);
      camera.projectionMatrixInverse.fromArray(state.inverse);
    };
  }
  function center(camera, { fov } = {}) {
    requireCamera(camera);
    if (!Number.isFinite(fov) || fov <= 0 || fov >= 180) throw new Error('Supply an explicit FOV between 0 and 180 degrees.');
    camera.fov = fov;
    camera.zoom = 1;
    camera.filmOffset = 0;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  window.helixThreeCamera = Object.freeze({ version: 1, save, center, describe });
})();
