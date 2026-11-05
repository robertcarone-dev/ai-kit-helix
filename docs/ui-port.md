# UI conversion planning

The conversion tools transfer measured assets and propose targeted UI edits. They do not translate Phaser game code into Unity or decide visual acceptance. Read [the UI evidence contract](ui.md) before producing source snapshots.

## Ownership

The shared toolkit owns extraction, coordinate conversion, dependency comparison and guarded authoring utilities. The consuming project owns:

- Semantic element selectors and Unity object bindings.
- Destination assets, prefab paths and parent mappings.
- State names, fixture setup, gameplay callbacks and localization.
- Responsive constraints and the supported UI framework.

Keep those mappings in project-owned files. Do not add game names or selectors to inherited toolkit code. Installation updates the shared implementation while preserving the adapter.

## Workflow

1. Capture equivalent reference and candidate states at native dimensions. Resolve missing or ambiguous semantic bindings before planning edits.
2. Extract original PNG frames and review texture provenance, transparent margins, trim, pivot and border metadata.
3. Supply explicit parent geometry and layout constraints. Use multiple viewport samples to assess a responsive rule; one screenshot cannot establish anchors.
4. Review the proposed changes and findings. Layout-driven or ambiguous elements require project decisions before authoring.
5. Apply only supported reviewed operations through the Unity Editor. Preserve existing references and nested prefab structure.
6. Recapture affected cases and inspect paired evidence. Preserve unchanged evidence only when its declared dependencies and original acceptance remain applicable.

A dependency result is a scheduling aid, not an acceptance verdict. A state contract describes integration work; it does not wire runtime callbacks or prove interaction behavior.

## Additive semantic bindings

A project may retain `uiBindingsFile` and add an optional `uiBindingsFiles` array in `reference.json`. The shared loader merges the files and rejects duplicate semantic IDs. Keep game HUD additions in their own project-owned binding file; this does not automatically implement a Unity resolver. The project capture adapter must resolve the same IDs to measured Unity objects.

## Asset extraction

```sh
./Tools/Helix/bin/helix ui-assets --spec Tools/Ui/assets.json --out .helix/ui-assets-01
```

The spec is project-local. Each `source` is an explicitly supplied local PNG, WebP or JPEG; it may be an absolute path in the discovered reference checkout. URLs and automatic catalog extraction are unsupported. Supply the actual lowercase SHA256, never a placeholder hash:

```json
{
  "schemaVersion": 1,
  "assets": [{
    "id": "sample-icon",
    "source": "/absolute/reference/atlas.png",
    "sha256": "REPLACE_WITH_EXACT_SOURCE_SHA256",
    "destination": "Assets/Art/UI/SampleIcon.png",
    "rect": {"x": 0, "y": 0, "width": 64, "height": 32},
    "rotation": "none",
    "originalSize": {"width": 80, "height": 48},
    "trimOffset": {"x": 8, "y": 8},
    "pivot": [0.5, 0.5],
    "pixelsPerUnit": 100,
    "border": [0, 0, 0, 0]
  }]
}
```

`rect` and `trimOffset` use top-left source pixels. `rotation: "cw90"` means the atlas stored the frame clockwise; extraction reverses that rotation before restoring transparent margins. Omit `rect` for the whole image and omit trim fields for an untrimmed frame. Pivot uses Unity's normalized bottom-left convention; convert Phaser origins explicitly. Border order is left, bottom, right, top in output pixels. Assets are bounded to 32 MiB, 8192 pixels per side and 16,777,216 decoded pixels.

The fresh output directory contains `<id>.png` and `imports.json` with original source and extracted PNG hashes. PNG processing uses lossless pixel copying. WebP/JPEG decoding uses installed Chromium without network access; JPEG loss and decoder/color differences are not reversed. Vector, procedural and shader-generated artwork require a project exporter. The command does not import into Unity.

## Layout plan

Obtain `Helix.Comparison.UiAuthoring.Inspect(prefabPath)` through the supported Unity execution backend and save the returned JSON inside the project. Inspection records the prefab hash, relative target paths, current layout and `componentTypes` on each target and its ancestors, including base types. The root target is the empty string. Use fresh paired capture receipts conforming to [the evidence contract](ui.md).

```sh
./Tools/Helix/bin/helix ui-plan --spec Tools/Ui/layout.json --out .helix/ui-plan-01
```

A minimal spec shape is:

```json
{
  "schemaVersion": 1,
  "stateKeys": ["view"],
  "elements": [{
    "id": "sample.icon",
    "anchor": [0, 1],
    "pivot": [0.5, 0.5],
    "toleranceUnits": 0.5,
    "unity": {
      "prefab": "Assets/UI/Sample.prefab",
      "target": "Icon",
      "inspection": ".helix/inspection/sample.json"
    }
  }],
  "samples": [{
    "id": "phone",
    "reference": ".helix/phone/reference.json",
    "candidate": ".helix/phone/unity.json",
    "parents": {"sample.icon": {
      "bounds": {"x": 0, "y": 0, "width": 400, "height": 800},
      "unitsPerPixel": 1,
      "axisAligned": true
    }}
  }, {
    "id": "tablet",
    "reference": ".helix/tablet/reference.json",
    "candidate": ".helix/tablet/unity.json",
    "parents": {"sample.icon": {
      "bounds": {"x": 0, "y": 0, "width": 800, "height": 1000},
      "unitsPerPixel": 1,
      "axisAligned": true
    }}
  }]
}
```

The numbers illustrate the schema, not measured layout or recommended tolerances. Parent bounds are the intended Unity parent's native top-left screen rectangle for that sample; `unitsPerPixel` converts native pixels into that parent's local units. Supply them from inspection. Both receipts in each sample must match native viewport, safe area and declared state; inventories must be complete with DPR and zoom equal to 1. At least two distinct viewports are required. Every element needs exactly one semantic binding on each side.

Only explicit fixed anchors are supported: `anchorMin` equals `anchorMax`. The planner compares proposed local position and size across samples using `toleranceUnits`. Disagreeing responsive rules, rotated source elements, driven layouts and nested prefab ownership produce blocked findings rather than guessed edits. Edit a nested target's source prefab or its controller explicitly. Declare custom animation/layout drivers in optional root `controllerTypes`, an array of fully qualified type names. The planner carries this project-owned declaration into the plan, and both planning and Unity apply block matching targets or ancestors. Keep game-specific driver types out of shared code; edit driven state through its project controller instead. Undeclared custom drivers still require project inspection.

Optional `imports` points to the staged `imports.json` inside this checkout. Optional element `sprite` names an existing Sprite PNG or a destination in those imports. Optional `states` is an array of `{id, reference, unity, kind, trigger}`; `kind` is `fixture` or `input`, and each other field is a nonempty project-defined string. It describes state bindings and triggers; it does not generate animations or callbacks.

Outputs are `plan.json`, `report.json` and `state-contract.json`. CLI output includes `planSha256`. A `partial` report can contain independent operations; inspect every blocked finding before applying that subset. Typography differences are diagnostic and do not automatically block otherwise supported layout operations. The state contract records per-state samples and statuses: `blocked` for `UNMAPPED`, `observed-not-accepted` for observed states, or `unmeasured`. None establishes state acceptance.

## Optional Unity authoring

The optional shared Unity helper exposes `UiAuthoring.Inspect`, `Preview` and `Apply`. Invoke them using the project's supported Editor backend; the CLI planner never runs them automatically.

1. Review `plan.json` and its report, and explicitly create required destination folders.
2. Call `Helix.Comparison.UiAuthoring.Preview(planJsonPath)` and retain its returned plan hash.
3. Call `Helix.Comparison.UiAuthoring.Apply(planJsonPath, expectedPlanSha256)` with that reviewed hash.
4. Retain the returned change receipt and capture the affected live cases.

Preview and apply require an idle, compiled Editor in Edit Mode, saved scenes and closed Prefab Mode. The helper checks project identity, prefab hashes, target uniqueness, current layout and controller ownership. It refuses existing asset destinations, including `.meta` files. It only changes existing RectTransforms and optionally assigns sprites to existing uGUI Images; it never creates UI hierarchy, text components, localization or callbacks. Asset import sets single-sprite mode, pivot, pixels per unit and border, with explicit Uncompressed, no mipmaps, Clamp and Bilinear defaults. Review those choices for the project before application.

Apply revalidates the reviewed hash and preconditions. On a caught failure it restores backed-up prefab bytes and removes newly created assets. This is not crash recovery or protection against concurrent external authors: keep the assigned Editor exclusive for the operation and inspect any interrupted apply before retrying. Never edit prefab YAML manually.

## Incremental case validation

```sh
./Tools/Helix/bin/helix ui-impact --spec Tools/Ui/cases.json --out .helix/ui-impact-01
./Tools/Helix/bin/helix ui-impact --spec Tools/Ui/cases.json --previous .helix/ui-impact-01/impact.json --out .helix/ui-impact-02
```

The spec is `{ "schemaVersion": 1, "cases": [{ "id": "sample-phone", "inputs": ["Assets/UI/Sample.prefab", "Tools/Ui/layout.json"], "evidence": [".helix/phone/reference.json", ".helix/phone/reference.png", ".helix/phone/unity.json", ".helix/phone/unity.png"] }] }`. All paths resolve inside the checkout. Include every relevant prefab consumer, code file, asset, fixture, setting and evidence file; the tool does not discover missing dependencies.

`impact.json` reports `reusable` only when the case contract, all declared input hashes and nonempty evidence hashes match the prior receipt from this checkout. Otherwise it reports `needs-validation`. An initial run never establishes reusable evidence. Preserve original acceptance alongside reused receipts; unchanged bytes do not establish a new parity verdict.

## Measurement limits

Native top-left screen bounds are observations, not prefab-local positions. Canvas scaling, parent space, layout controllers and safe-area behavior must be supplied or measured before deriving RectTransform values. Unsupported transforms and effects stay unmeasured; do not compensate for them with arbitrary offsets.

Typography diagnostics separate known text, font, wrapping and baseline observations. They do not select replacement fonts, identify unobserved fallback glyphs or prove rasterization equivalence. Retain the original font provenance and inspect the rendered result.

Never edit prefab YAML by hand. Synthetic tests validate conversion and guards; they do not establish live game parity. Adopt new tooling at the assigned agent's safe checkpoint without replacing an active capture session.
