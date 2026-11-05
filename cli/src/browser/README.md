# Browser camera utility

`three-camera.js` installs the opt-in `window.helixThreeCamera` v1 API. It supplies reusable operations for Three.js perspective cameras. Loading the script does not change a camera.

The installer copies this directory to `Tools/Helix/src/browser`. Load `Tools/Helix/src/browser/three-camera.js` before project browser scripts, including in configured batch script lists and standalone capture entry points that use the API.

## API

### `save(camera)`

Returns a restore closure. It preserves the camera's captured state:

- Position, up vector and quaternion.
- FOV, aspect, near and far clipping planes.
- Zoom, focus, film gauge and film offset.
- View-offset state.
- Projection matrix and inverse projection matrix.

Call the returned closure when releasing an inspection view, including on failure. Restoration restores the saved matrices directly; recalculating them would discard a custom projection. The closure does not disable game callbacks or prevent a runtime controller from changing the camera afterward.

### `center(camera, { fov })`

Validates a perspective camera and the requested FOV, then sets up a centered diagnostic projection. It clears the view offset and film offset, sets zoom to `1`, applies the explicit FOV and updates the projection matrix. The project chooses the FOV; this API provides no game or device defaults.

Save the camera before applying a diagnostic projection. This operation is for explicit inspection views. Ordinary gameplay comparisons should observe the runtime lens and projection without invoking it.

### `describe(camera)`

Returns read-only camera receipt data without changing the camera. Project hooks can include this data in their observed state alongside fixture and revision metadata. A camera receipt describes the sampled state; it does not establish visual parity or prove that the image was captured after that state took effect.

## Project adapter responsibilities

The utility does not find cameras, schedule callbacks, select fixtures or choose an FOV. A project adapter owns those decisions and the lifecycle of its changes:

1. Locate the intended camera and save its state.
2. Select an explicitly requested diagnostic fixture and view.
3. Apply the desired pose and centered projection at the appropriate point in the game's update cycle.
4. Confirm readiness and capture the rendered state with its receipt.
5. Remove owned callbacks and restore the saved camera on success or failure.

Use the existing browser batch hooks for project readiness and view selection. Keep fixture identities, coordinate conversions and game instrumentation in project-owned scripts. Shared tests use synthetic cameras and projects; game integration tests belong outside the installed shared test tree.

For Unity integration, the optional `Helix.Comparison.ComparisonAdapter` interface provides the corresponding lifecycle boundary. Its project implementation owns camera selection and game-specific behavior. Installing the browser utility does not install a Unity adapter or alter a project's backend configuration.
