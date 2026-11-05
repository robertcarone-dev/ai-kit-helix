# Scene comparison

Scene snapshots expose the objects behind a screenshot so a comparison can distinguish missing content, hierarchy differences and placement errors. They supplement native images; they do not establish visual parity.

## Ownership

The toolkit owns engine extraction, normalized measurements and reports. The consuming project owns:

- The reference scene and camera selectors.
- Semantic identifiers and explicit source-to-target mappings.
- Equivalent state and checkpoint preparation.
- Required coverage and approved tolerances.

Names and hierarchy paths are inventory evidence, not automatic proof that two objects correspond. Map objects explicitly, including groups when one reference object corresponds to several Unity objects. Leave unresolved matches unmeasured.

## Commands and mapping spec

With a ready session and a selected named scenario:

```sh
./Tools/Helix/bin/helix scene-look > .helix/reference-scene.json
./Tools/Helix/bin/helix scene-compare --reference .helix/reference-scene.json --candidate .helix/unity-scene.json --spec Tools/Helix/scene-case.json --out .helix/evidence/scene-01
```

`scene-look` prints a JSON snapshot. It uses configured Phaser/Three selectors and collects semantic bindings from the UI binding files plus optional `sceneBindings` entries containing `id` and a reference-side `expression`. Expressions must resolve one intended object. The selected scenario supplies state and checkpoint. Capture the matching Unity snapshot through the project adapter; `scene-compare` reads files and does not execute either engine.

A project-owned comparison spec selects nodes explicitly:

```json
{
  "schemaVersion": 1,
  "mappings": [
    {
      "id": "example-panel",
      "tolerancePx": 1,
      "reference": {
        "semanticIds": [
          "example.panel"
        ]
      },
      "candidate": {
        "ids": [
          "unity/0/2"
        ]
      }
    }
  ]
}
```

Each selector contains either `semanticIds` or snapshot-local `ids`. Multiple entries form a group whose bounds are the union of its selected members; this does not assert matching internal hierarchy. Prefer semantic IDs for durable project mappings. Inventory IDs are local to the captured hierarchy. Exact-name suggestions never become accepted mappings automatically.

The output directory must be empty. It receives:

- `report.json`, including input SHA-256 hashes, prerequisite failures, mapping results and name-only suggestions.
- `reference.svg` and `candidate.svg`, transparent geometric overlays at the respective viewport dimensions. These are standalone diagrams, not composited screenshots.

## Snapshot scope and result statuses

Snapshots preserve engine-native node data alongside bounds measured in top-left viewport pixels. Comparisons require native viewport metadata with DPR and zoom both 1, a complete bounded inventory and a valid hierarchy. Matching viewport dimensions, nonempty checkpoint and equivalent state are prerequisites for measurement. Binding errors suppress only the affected semantic selectors; independent mappings continue. All observed binding errors remain in the report’s `bindingErrors` field, including errors outside the requested scope.

A mapping is `unresolved` when a selector is missing, ambiguous or has a failed semantic binding. It is `unmeasured` when prerequisites fail or selected bounds are unavailable. Otherwise its x, y, width and height deltas are compared separately against the explicit nonnegative `tolerancePx`, producing `within-tolerance` or `different`. Those labels describe rectangle measurements only. The report also records normalized viewport rectangles and visibility observations.

Phaser extraction uses the main camera for supported single-camera, unmasked, unrotated-camera bounds. Unsupported camera/mask cases have no bounds. Three extraction projects existing geometry bounds only when an explicit output-surface mapping and supported geometry are available. Neither engine's inventory proves occlusion or final visible pixels.

## Camera-aware geometry

A 3D camera renders into a surface that may occupy only part of the final image. Configure `three.surface` as an expression returning `{x, y, width, height, axisAligned: true}` in final viewport pixels. Use the actual displayed output rectangle, including its offset and size. Do not substitute the full viewport for a canvas embedded in another surface. Rotated or otherwise non-axis-aligned compositing is unsupported by this rectangle contract.

Three snapshots retain camera world, view and projection matrices plus the output surface. Supported existing geometry bounding boxes are projected through the observed object and camera matrices. Extraction never calls bounding-box computation or updates scene matrices. Missing bounds, skinned/instanced/morph geometry, absent surfaces and near/far clip-plane crossings remain unmeasured. Inspect `boundsMethod`; a projected box is not an exact silhouette.

Unity retains the equivalent camera matrices and projects renderer world bounds. The optional `cameraSurface` argument declares the final output rectangle. The helper infers a surface only when the camera renders directly to display 0 without a RenderTexture and the requested dimensions match `Screen`; it applies the camera viewport within that output. Other paths need an explicit surface. RectTransform measurements retain their separate canvas rules.

All stored matrices are column-major. Camera projection uses the CPU clip convention with depth from -1 to 1. The comparison projects each side through its own camera; it does not equate FOV, Euler angles or raw transform components across engines.

## Landmarks and world coordinates

Add `landmarks` to the mapping spec for points with an explicit correspondence:

```json
{
  "landmarks": [
    {
      "id": "example-origin",
      "reference": {
        "semanticId": "example.object",
        "point": [
          0,
          0,
          0
        ]
      },
      "candidate": {
        "id": "unity/0/2",
        "point": [
          0,
          0,
          0
        ]
      },
      "tolerancePx": 1
    }
  ]
}
```

Each point is in its selected node's local coordinates. The report transforms it using that node's recorded world matrix and projects it using its recorded camera and surface. `geometry.landmarks` reports `screenDistancePx` and `screenStatus`; absent camera/matrix/surface data, failed prerequisites or an affected semantic binding remain unmeasured; independent landmark selectors continue. The report retains both sides' camera evidence in `geometry.cameras`.

World distance is opt-in. Add `coordinates.units` and both `coordinates.reference.worldToCommon` and `coordinates.candidate.worldToCommon`, each an explicit invertible affine 16-number matrix. These matrices convert each engine's world coordinates into the same declared space and units, accounting for axis direction, handedness, scale and origin as needed. Every landmark must then include a nonnegative `toleranceWorld`. The report records `worldDistance`, `worldUnits` and `worldStatus` separately from screen results.

Validate the conversion with known project landmarks before using world distances to guide a fix. Omitting it leaves world comparison unmeasured while still allowing supported screen projection. Never invent a universal axis flip, unit scale or camera adjustment to force agreement.

## Appearance diagnostics

Snapshots retain available engine-native appearance evidence:

- Phaser texture/frame references, text/font fields, tint, blend mode and mask presence.
- Three material identity, selected material values, texture slots and light properties.
- Unity shared material/shader identity, selected shader properties, texture slots and light properties.

When `three.renderer` is configured, snapshots also retain available output-color-space, tone-mapping, exposure and shadow-enabled observations. Unity snapshots retain active color space and selected ambient/fog settings. These snapshot-level `pipeline` fields are context for manual diagnosis, outside the node-property appearance selectors. This is a bounded property inventory, not a complete shader, texture-content, lighting or rendering-pipeline extraction. Asset names and paths identify observations; they do not prove identical asset bytes.

Add `appearance` rules to the comparison spec. Each rule has a unique `id`, a `mode`, and `reference`/`candidate` selectors. Each selector contains either a single `id` or `semanticId`, plus a `path` array locating a property in the selected node. String keys and numeric array indices are supported; missing or ambiguous properties and failed semantic bindings remain unmeasured; independent appearance rules continue.

Modes are:

- `exact`: compare observed values directly. This is useful only for properties with a justified exact correspondence.
- `number`: compare one number after an optional explicit conversion.
- `vector`: compare numeric arrays of the same length component by component.
- `linear-color`: compare RGB or RGBA arrays after conversion into linear color space. Each selector must explicitly declare `colorSpace` as `linear` or `srgb`; both arrays must have the same length. Alpha is not gamma-decoded.

Non-exact rules require a nonnegative `tolerance`. Each numeric selector may declare finite scalar `scale` and `offset`; conversion applies to every component after any color decoding. Raw values and normalized values remain in the report. Inspect actual shader/color-space semantics before declaring a conversion. Do not assume a universal roughness-to-smoothness conversion, equal light-intensity units or equivalent shader parameters.

For example, the following addition compares the color of explicitly matched lights whose stored colors have been independently verified as linear:

```json
{
  "appearance": [
    {
      "id": "example-light-color",
      "mode": "linear-color",
      "reference": {"semanticId": "example.light", "path": ["raw", "light", "color"], "colorSpace": "linear"},
      "candidate": {"semanticId": "example.light", "path": ["raw", "light", "color"], "colorSpace": "linear"},
      "tolerance": 0.01
    }
  ]
}
```

Matching normalized input values does not establish matching rendered appearance. Use native images to inspect exposure, tone mapping, shadows, compositing and effects absent from the snapshot.

## Temporal scene sampling

`scene-record` samples the current ready named scenario without replaying setup, resetting animation or changing game time:

```sh
./Tools/Helix/bin/helix scene-record --out .helix/evidence/scene-reference-motion-01 --duration 1 --interval-ms 100
./Tools/Helix/bin/helix scene-motion --reference .helix/evidence/scene-reference-motion-01/sequence.json --candidate .helix/evidence/scene-unity-motion-01/sequence.json --spec Tools/Helix/scene-motion-case.json --out .helix/evidence/scene-motion-report-01
```

Duration must be greater than 0 and at most 30 seconds; interval must be 16–5000 milliseconds, with at most 300 planned samples and a 64 MB collected-snapshot budget. Scheduling and probe costs can lengthen the observed interval. Inspect actual timestamps instead of treating the requested interval as a fixed frame rate.

`sequence.json` contains `samples` with `sampledAtMs` and a `snapshot`. The host's `sampledAtMs` measures collection time, not a shared event clock. Supply a project-owned `sceneTimeline` expression returning `{event, elapsedMs}`; each snapshot retains this as `timeline`. Establish the same observable event in both engines and document its clock basis. A readiness marker alone does not establish animation onset or matching animation phase.

For Unity, `SceneSampling.Start(capture, outputDirectory, durationSeconds, intervalMs)` samples a project-supplied read-only function that returns a scene snapshot. The function must attach the project's observed timeline for temporal comparison. Use `Status()` to inspect progress and `Stop()` to retain an incomplete early-stop sequence. Output must be a fresh directory under the project's `.helix` or `.aikit/scratch`. Handled probe errors and Editor reload/shutdown interruptions retain incomplete receipts; abrupt process termination is not a durable capture guarantee.

`scene-motion` accepts the scene comparison spec plus an explicit nonnegative `timeToleranceMs`. Each sequence must be complete with 2–300 samples, the same nonempty event label and strictly increasing nonnegative event-relative times. The comparison selects the nearest candidate sample within tolerance while moving forward through candidate time; samples are never reused. Missing or equally near ambiguous samples remain unmeasured; there is no interpolation, retiming or best-looking-frame selection.

The output `report.json` retains input hashes, per-pair scene reports, sampled center trajectories and coverage including unpaired candidate times. A sampled pair can still contain unmeasured geometry or properties. Sparse samples do not establish behavior between samples, exact motion onset, every transition or final rendered appearance. Retain recordings and event/input receipts for those claims.

## Collect a representative pair

1. Prepare the reference and Unity at the same named state and checkpoint using the project's adapter.
2. Capture native images and retain their receipts.
3. Collect each engine's scene snapshot with the intended root and camera.
4. Review the inventory and define explicit semantic matches.
5. Run the scene comparison into a new evidence directory.
6. Inspect the report and overlays beside the original images before changing the game.

Use screen-space measurements for cross-engine placement. Retain engine-native transforms, origins and hierarchy for diagnosis. A matching screen-space rectangle does not establish a matching silhouette, rendered surface, hit region or behavior.

## Interpretation

- Missing or ambiguous semantic matches need mapping or scene investigation before an implementation change.
- A bounds mismatch with similar proportions may indicate layout, scale or camera framing; inspect those inputs before choosing a cause.
- Matching bounds with differing images may indicate assets, pose, clipping or rendering; the rectangle alone cannot choose among them.
- Inactive, invisible and outside-camera objects are distinct observations. Hierarchy presence does not establish visible pixels.
- Unsupported measurements remain unmeasured. A partial inventory does not establish full-scene coverage.

Bounds and overlays are diagnostic approximations. They do not resolve all masks, occlusion, alpha cutouts, shader deformation or final compositing. Preserve the selected root, camera, viewport and state with the report so another worker can interpret its scope.

## Unity collection

The optional reusable `SceneSnapshot.Capture(root, camera, width, height, state, checkpoint, bindings, cameraSurface)` helper returns a JSON object. It reads a supplied root, output dimensions and semantic `Transform` bindings. The camera may be omitted for hierarchy-only inventory; 3D projection then remains unmeasured. Screen-space overlay canvas bounds do not require a camera. Other projected render paths require their actual rendering camera and supported output surface. The project adapter chooses those objects and supplies semantic bindings; the generic helper does not search for a game's cameras or prepare gameplay state. Invoke it through the project's supported Unity execution route and preserve the returned snapshot with the case evidence.

Collection does not authorize scene or prefab changes. Use the game's implementation workflow for any resulting fix, then recapture the affected case.

Snapshots and images are separate observations, not an atomic capture. Use a settled checkpoint and retain capture provenance; moving content needs a timed comparison workflow.
