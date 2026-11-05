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

Snapshots preserve engine-native node data alongside bounds measured in top-left viewport pixels. Comparisons require native viewport metadata with DPR and zoom both 1, a complete bounded inventory and a valid hierarchy. Matching viewport dimensions, nonempty checkpoint and equivalent state are prerequisites for measurement. Binding errors for semantic IDs requested by the spec also prevent measurement; unrelated bindings outside the scoped comparison do not establish a blocker for that scope.

A mapping is `unresolved` when a selector is missing or ambiguous. It is `unmeasured` when prerequisites fail or selected bounds are unavailable. Otherwise its x, y, width and height deltas are compared separately against the explicit nonnegative `tolerancePx`, producing `within-tolerance` or `different`. Those labels describe rectangle measurements only. The report also records normalized viewport rectangles and visibility observations.

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

Each point is in its selected node's local coordinates. The report transforms it using that node's recorded world matrix and projects it using its recorded camera and surface. `geometry.landmarks` reports `screenDistancePx` and `screenStatus`; absent camera/matrix/surface data or failed prerequisites remain unmeasured. The report retains both sides' camera evidence in `geometry.cameras`.

World distance is opt-in. Add `coordinates.units` and both `coordinates.reference.worldToCommon` and `coordinates.candidate.worldToCommon`, each an explicit invertible affine 16-number matrix. These matrices convert each engine's world coordinates into the same declared space and units, accounting for axis direction, handedness, scale and origin as needed. Every landmark must then include a nonnegative `toleranceWorld`. The report records `worldDistance`, `worldUnits` and `worldStatus` separately from screen results.

Validate the conversion with known project landmarks before using world distances to guide a fix. Omitting it leaves world comparison unmeasured while still allowing supported screen projection. Never invent a universal axis flip, unit scale or camera adjustment to force agreement.

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

The optional reusable `SceneSnapshot.Capture(root, camera, width, height, state, checkpoint, bindings, cameraSurface)` helper returns a JSON object. It reads a supplied root, output dimensions and semantic `Transform` bindings. The camera may be omitted only for a screen-space overlay canvas; other render paths need their actual rendering camera. The project adapter chooses those objects and supplies semantic bindings; the generic helper does not search for a game's cameras or prepare gameplay state. Invoke it through the project's supported Unity execution route and preserve the returned snapshot with the case evidence.

Collection does not authorize scene or prefab changes. Use the game's implementation workflow for any resulting fix, then recapture the affected case.

Snapshots and images are separate observations, not an atomic capture. Use a settled checkpoint and retain capture provenance; moving content needs a timed comparison workflow.
