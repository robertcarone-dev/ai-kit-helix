# Web-to-Unity mapping and capture

Use the web prototype as the scoped visual and behavioral source, with Unity as the target. Equivalent player output does not require identical object hierarchies or rendering internals. Record source identifiers and asset paths or procedural generator/parameters, then their Unity asset/component/shader counterparts. Missing counterparts permit source investigation and a concrete port brief; implement them only within an already authorized port/fix task.

## Match the final player output

Compare the final composed browser and Unity output at matching requested dimensions first. Preserve raw captures. Annotated crops of corresponding regions are supplementary; do not independently fit, align or resize objects to hide placement or layout errors.

For relevant measurements, inspect each stage rather than conflating these sizes:

- Browser page viewport; CSS canvas rectangle and page offset; Phaser logical game size and scale mode; canvas backing-buffer size and DPR.
- Three.js render-target size, camera viewport/crop and how that image is composited into Phaser or the page.
- Unity native Game view, camera viewport/render texture, compositing and UI scaler or equivalent framework transform.

The CLI pins browser DPR and zoom to 1 and captures the page viewport. This does not prove canvas backing buffers or offscreen targets have the same dimensions. Equal PNG sizes alone do not establish equivalent render paths. Map measurements into common final-output pixels, recording origin, scale and any crop/offset. Unknown mappings limit the affected measurement, not all visual inspection.

Inspect the project capture helper’s safe-area constraints. A helper that requires a full rectangular safe area cannot establish notch/device-safe-area acceptance; those cases need an appropriate method or an explicit coverage gap.

Three.js normalized device coordinates do not automatically locate content inside a Phaser sprite: that requires the project's render-target-to-sprite and final-output mapping. Inspect the selected `config.three` wiring and its scene scope; a gameplay-board mapping does not establish lobby or mascot coverage and does not supply that compositing mapping automatically.

Inspect the project's actual runtime versions and settings instead of assuming library defaults. [Phaser's scale model](https://docs.phaser.io/phaser/concepts/scale-manager) distinguishes game, base and display sizes; [Unity CanvasScaler](https://docs.unity3d.com/Packages/com.unity.ugui@2.0/manual/script-CanvasScaler.html) describes target UI scaling. [Three.js render targets](https://threejs.org/manual/pages/rendertargets.html) and [color management](https://threejs.org/manual/pages/color-management.html) explain the separate render surfaces and color-versus-data texture treatment relevant to tracing the composite.


## State, readiness and provenance

Establish source phase/state and the relevant asset, font, texture and render-settled conditions before capturing. Inspection and capture occur sequentially; moving objects can diverge between them. Use a disclosed deterministic fixture where available, otherwise retain phase/timing uncertainty rather than inventing a freeze command.

Keep declared source revisions separate from verified identity. Browser document/script response hashes do not identify binary textures, models or fonts. Collect those source-asset hashes separately when their identity affects the scoped case, and record the corresponding Unity import/settings or generator provenance.

## Port or review outcome

For review-only work, deliver the source evidence, mapping, diagnosed difference and recommended Unity fix/retest. For an authorized port/fix, apply the scoped Unity changes, retain intended implementation changes, restore temporary diagnostic/session state and recapture affected final composites. Never alter the web reference to conceal target differences. Use the shared ledger to distinguish validated behavior from unsupported assumptions or remaining port work.

If the project’s Unity recipe requires a managed lane, respect its preflight rather than fabricating lane metadata. Browser capture and source analysis can proceed independently when that Unity prerequisite is unavailable.
