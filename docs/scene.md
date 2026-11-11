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

`scene-look` prints a JSON snapshot. Use `--profile NAME` on `scene-look` or `scene-record` to select a built-in profile or a project-defined profile. It uses configured Phaser/Three selectors and collects semantic bindings from the UI binding files plus optional `sceneBindings` entries containing `id` and a reference-side `expression`. Expressions must resolve one intended object. The selected scenario supplies state and checkpoint. Capture the matching Unity snapshot through the project adapter; `scene-compare` reads files and does not execute either engine.

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

## Paired image review and one-case execution

Use capture receipts with inline `scene` snapshots to review measured differences beside verified native images:

```sh
./Tools/Helix/bin/helix scene-report --reference .helix/reference/reference.json --candidate .aikit/scratch/case/unity/unity.json --spec Tools/Helix/scene-case.json --out .helix/evidence/scene-review-01
```

`scene-report` verifies each PNG hash and native dimensions, then checks the scene's viewport, state and checkpoint against its receipt's UI snapshot. It writes `report.json` and a self-contained `review.html` with embedded images. Open the HTML locally to select a mapping, toggle its bounds, crop both sides to the selected element, and inspect appearance, relationship, style, landmark and provenance data. Crops follow each side's own bounds; similar displayed crop sizes do not prove equal native dimensions. The original measurements remain in the report. No external service receives the evidence.

For a report-only failure, rerun `scene-report` with the retained valid receipts and a fresh output directory after correcting the spec or reporting code. It does not start either engine or recapture images. Preserve the original evidence and record the new spec and report hashes. Re-review cannot supply missing observations; criteria depending on uncaptured state remain unmeasured.

To prepare and verify one case through an existing project lifecycle, create a matrix with exactly one case:

```json
{
  "schemaVersion": 1,
  "cases": [{
    "id": "panel-phone",
    "scenario": "panel",
    "viewport": "phone",
    "uiSpec": "Tools/Helix/ui-panel.json",
    "sceneSpec": "Tools/Helix/scene-panel.json",
    "sceneProfile": "panel-layout"
  }]
}
```

```sh
./Tools/Helix/bin/helix scene-case --spec Tools/Helix/scene-matrix.json --out .aikit/scratch/scene-case-01
./Tools/Helix/bin/helix scene-case --spec Tools/Helix/scene-matrix.json --out .aikit/scratch/scene-case-01 --execute yes
```

The first command plans; only explicit execution runs supplied recipes. `scene-case` reuses the UI matrix lifecycle (`Tools/Helix/toolkit/UI.md` when installed; [ui.md](ui.md#matrix-plan-and-explicit-execution) in the source repository), including its storage/compatibility prerequisites, owned-session rules and restoration. It does not acquire a seat or provision an Editor. `uiSpec` remains required. For multiple cases, `ui-matrix` accepts the same optional `sceneSpec` and `sceneProfile` fields per case. Each scene-enabled case writes resolved options to `unity/scene-request.json`, captures the reference with that profile, compares UI and scene evidence, and writes its viewer under `scene-review/`.

The Unity recipe must read the request and include the matching snapshot in `unity.json` as `scene`. With the optional shared helper, the adapter reads `ComparisonContext.SceneOptions` and returns `ComparisonFrame.Scene`; missing requested scene evidence blocks the case. The project chooses roots, cameras and bindings. Use the same observed state, checkpoint and dimensions as the UI snapshot. Restoration is attempted after preparation begins even if capture or comparison fails; inspect cleanup receipts before reusing the lane.

## State context and measured outcomes

Without `stateContract`, scene comparison requires exact equality of the complete state objects. A project may explicitly separate the context needed to compare geometry from measured game outcomes and observational metadata:

```json
"stateContract": {
  "contextKeys": ["view", "seed", "result"],
  "outcomeKeys": ["coins", "rewardText"],
  "observationalKeys": ["timeline"]
}
```

Add this optional object to the scene comparison spec. Keys are top-level property names, not nested paths. `contextKeys` must be nonempty; names must be nonempty and unique across all three lists. Choose context that identifies the actual screen or overlay, fixture and seed required by the case.

- Context properties must exist on both sides and match exactly. Explicit `null` is an observed value; an absent property is unmeasured. Missing or different context blocks dependent geometry measurements.
- Outcome properties report `same`, `different` or `unmeasured`. A missing observation remains unmeasured. Outcome differences do not block geometry, but contribute to a matrix case's difference or unmeasured verdict.
- Observational properties remain in the report as `observed-only`. Classifying a timeline this way does not establish timing parity; use a motion comparison when timing is an acceptance criterion.
- Any captured property absent from all three lists remains an unmeasured outcome with reason `unclassified-state-key`. New adapter fields cannot silently disappear from review.

Supply actual observations from each engine. Do not rewrite balances, rewards or other outcomes to match the reference, or classify required outcomes as observational to obtain a passing result. Each receipt's scene and UI snapshots must still agree on their own complete state and checkpoint. The contract governs comparison between engines; it does not relax receipt consistency.

## Snapshot scope and result statuses

Snapshots preserve engine-native node data alongside bounds measured in top-left viewport pixels. Comparisons require native viewport metadata with DPR and zoom both 1, a complete bounded inventory and a valid hierarchy. Matching viewport dimensions, nonempty checkpoint and equivalent state context are prerequisites for measurement; the state contract above defines which state values gate geometry. Binding errors suppress only the affected semantic selectors; independent mappings continue. All observed binding errors remain in the report’s `bindingErrors` field, including errors outside the requested scope.

A mapping is `unresolved` when a selector is missing, ambiguous or has a failed semantic binding. It is `unmeasured` when prerequisites fail or selected bounds are unavailable. Otherwise its x, y, width and height deltas are compared separately against the explicit nonnegative `tolerancePx`, producing `within-tolerance` or `different`. Those labels describe rectangle measurements only. The report also records normalized viewport rectangles and visibility observations.

Phaser extraction uses the main camera for supported single-camera, unmasked, unrotated-camera bounds. Unsupported camera/mask cases have no bounds. Three extraction projects supported local geometry bounds only when an explicit output-surface mapping is available. Neither engine's inventory proves occlusion or final visible pixels.

## Scoped capture profiles

Define reusable scopes in project configuration:

```json
{
  "sceneProfiles": {
    "panel-layout": {
      "profile": "layout",
      "semanticIds": ["example.panel", "example.label"],
      "includeDescendants": false
    }
  }
}
```

Use `scene-look --profile panel-layout` or `scene-record --profile panel-layout`. Built-in profiles are `all`, `layout`, `geometry`, `appearance` and `motion`; the default is `all`. `layout` omits Three/Unity mesh projection and focuses on UI observations. `geometry` and `motion` omit appearance inventories. `appearance` retains supported geometry plus appearance fields. Profiles do not change game state.

A scoped snapshot retains selected semantic nodes and the ancestors needed to preserve hierarchy. Ancestors marked `structuralOnly` are context, not measured elements. `includeDescendants` adds descendants of selected nodes; it defaults to false. Include every node needed by mappings, relationships and style rules. Omitted fields and nodes remain unmeasured rather than being filled from another capture.

`capture --out PATH --scene-profile NAME` collects the selected scene snapshot during the existing capture hold and embeds it in the receipt. It reduces preparation and transport work but does not make all engine observations atomic. Prefer a settled checkpoint for static measurements. `geometryRevision` is an optional project-defined string in the profile; change it whenever otherwise unversioned geometry edits need cache invalidation.

## Camera-aware geometry

A 3D camera renders into a surface that may occupy only part of the final image. Configure `three.surface` as an expression returning `{x, y, width, height, axisAligned: true}` in final viewport pixels. Use the actual displayed output rectangle, including its offset and size. Do not substitute the full viewport for a canvas embedded in another surface. Rotated or otherwise non-axis-aligned compositing is unsupported by this rectangle contract.

Three snapshots retain camera world, view and projection matrices plus the output surface. Supported local geometry boxes are projected through the observed object and camera matrices. When readable position attributes are available, extraction computes a local axis-aligned box from their vertices without changing the geometry or its `boundingBox`. A toolkit-owned WeakMap caches this result by attribute/buffer identity, buffer version and count. `geometryRevision` explicitly invalidates the cache when project code changes positions without advancing the buffer version. Extraction never updates scene matrices. Unsupported vertex buffers, skinned/instanced/actively morphed geometry, absent surfaces and near/far clip-plane crossings remain unmeasured. Inspect `boundsKind` and `boundsMethod`; a projected box is not an exact silhouette.

Unity retains the equivalent camera matrices and projects `MeshFilter.sharedMesh.bounds` corners through the object world matrix and camera. Both 3D extractors therefore measure a transformed local axis-aligned box, avoiding the extra expansion caused by a world-axis-aligned box around a rotated object. Unsupported renderer/deformation paths remain unmeasured. The optional `cameraSurface` argument declares the final output rectangle. The helper infers a surface only when the camera renders directly to display 0 without a RenderTexture and the requested dimensions match `Screen`; it applies the camera viewport within that output. Other paths need an explicit surface. RectTransform measurements retain their separate canvas rules.

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
- Unity material/shader identity, selected effective shader properties, texture slots and light properties, including supported renderer property-block overrides.

Unity `raw.materials[].properties` holds effective supported values. `materialDefaults` retains the underlying material values, and `propertySources` identifies material, renderer property block or indexed material property block provenance. A nonempty indexed block replaces the renderer-wide block for that material slot; missing properties fall back to the material rather than merging both blocks. Texture entries also retain override and transform provenance. This is a bounded supported-property inventory: shader-specific values and interpretation belong in project adapters.

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

## Relationships and repeated styles

A group union can match while its children are incorrectly spaced. Add `relationships` to the comparison spec to measure two ordered elements independently in each engine:

```json
{
  "relationships": [{
    "id": "label-gap",
    "kind": "gap-x",
    "tolerance": 1,
    "reference": [{"semanticId": "example.icon"}, {"semanticId": "example.label"}],
    "candidate": [{"semanticId": "example.icon"}, {"semanticId": "example.label"}]
  }]
}
```

Each selector names one `id` or `semanticId`. Supported kinds are:

- `gap-x` and `gap-y`: the second element's leading edge minus the first element's trailing edge.
- `align-x` and `align-y`: the second element's center minus the first element's center on that axis.
- `ratio-width` and `ratio-height`: the second size divided by the first size; zero denominators remain unmeasured.
- `distance`: Euclidean distance between the two element centers.
- `baseline`: the second `raw.baseline` minus the first. Project adapters must supply measured baseline coordinates in final-output pixels; absent baselines remain unmeasured.

The report compares candidate and reference measurements using the explicit nonnegative `tolerance`. Ratios are unitless; all other kinds use pixels. Missing selectors, bounds or prerequisites remain unmeasured. These diagnostics do not prove clipping, hit regions or rendered pixels.

Add `styles` for project-owned repeated visual roles. Each role has a unique `id`, an appearance `mode`, its required `tolerance`, and a nonempty `members` array. Every member contains `reference` and `candidate` appearance selectors with explicit property paths and any required conversions/color spaces. The same appearance modes apply. The report compares each pair across engines, then compares every later member to the first member within each engine. This detects a role that is inconsistent even when a broad group rectangle matches. A one-member role has no within-engine repetition check. Keep intentional variations in separate roles rather than widening tolerances to hide them.

## Temporal scene sampling

`scene-record` samples the current ready named scenario without replaying setup, resetting animation or changing game time:

```sh
./Tools/Helix/bin/helix scene-record --out .helix/evidence/scene-reference-motion-01 --duration 1 --interval-ms 100
./Tools/Helix/bin/helix scene-motion --reference .helix/evidence/scene-reference-motion-01/sequence.json --candidate .helix/evidence/scene-unity-motion-01/sequence.json --spec Tools/Helix/scene-motion-case.json --out .helix/evidence/scene-motion-report-01
```

Duration must be greater than 0 and at most 30 seconds; interval must be 16–5000 milliseconds, with at most 300 planned samples and a 64 MB collected-snapshot budget. Scheduling and probe costs can lengthen the observed interval. Inspect actual timestamps instead of treating the requested interval as a fixed frame rate.

`sequence.json` contains `samples` with `sampledAtMs` and a `snapshot`. `sampledAtMs` measures sampler-relative collection time, not a shared event clock. Browser recording runs its samples inside one browser evaluation and transfers the sequence as a batch. Browser and Unity samplers schedule against deadlines, skip missed slots instead of queuing catch-up work, and report `intervalMs` and `missedSamples`. Each sample includes `scheduledAtMs` and `captureDurationMs`. Inspect these fields before claiming temporal coverage; a requested interval is not a guaranteed sample rate. Supply a project-owned `sceneTimeline` expression returning `{event, elapsedMs}`; each snapshot retains this as `timeline`. Establish the same observable event in both engines and document its clock basis. A readiness marker alone does not establish animation onset or matching animation phase.

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

The optional reusable `SceneSnapshot.Capture(root, camera, width, height, state, checkpoint, bindings, cameraSurface, options)` helper returns a JSON object. It reads a supplied root, output dimensions and semantic `Transform` bindings. The camera may be omitted for hierarchy-only inventory; 3D projection then remains unmeasured. Screen-space overlay canvas bounds do not require a camera. Other projected render paths require their actual rendering camera and supported output surface. The project adapter chooses those objects and supplies semantic bindings; the generic helper does not search for a game's cameras or prepare gameplay state. Invoke it through the project's supported Unity execution route and preserve the returned snapshot with the case evidence.

Collection does not authorize scene or prefab changes. Use the game's implementation workflow for any resulting fix, then recapture the affected case.

Snapshots and images are separate observations, not an atomic capture. Use a settled checkpoint and retain capture provenance; moving content needs a timed comparison workflow.

## Debug views

See [debug view capture and review](DebugViews.md) for paired luminance, HSV and alpha views, Three.js renderer captures, and the Unity geometry/material capture APIs.
