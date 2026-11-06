# Element-level UI comparison

The UI workflow compares declared criteria, not whole-screen artistic quality. It reports `passed`, `difference`, `unmeasured` or `blocked`. A pass applies only to the checks in the supplied spec. Unknown properties never count as equal measurements.

## Inspect, capture and compare

```sh
./Tools/Helix/bin/helix start --viewport phone
./Tools/Helix/bin/helix scenario shop
./Tools/Helix/bin/helix ui-look --match shop.offer
./Tools/Helix/bin/helix capture shop --out .helix/evidence/shop-01
# Obtain unity.json and unity.png through the project's adapter.
./Tools/Helix/bin/helix ui-compare \
  --reference .helix/evidence/shop-01/reference.json \
  --candidate .aikit/scratch/shop-01/unity.json \
  --spec Tools/Helix/ui-shop.json --out .helix/evidence/shop-review-01
./Tools/Helix/bin/helix stop
```

The report directory contains copied original PNGs, numbered element crops at native resolution, `comparison.json` and a self-contained local `review.html` with annotated overviews. The overview scales for display; measurements and crops remain native pixels. No source image is resized or overwritten. PNG hashes and snapshot dimensions are verified before reporting. Where present, native/rendered dimensions, readiness, state and reference-override flags are also checked. A receipt's hash establishes image integrity, not truthful provenance by itself: retain the producer's full receipt and review its identity.

`ui-look` provides UI-specific observations. `look` remains the broader Phaser/Three inspection command. A truncated inventory cannot establish that an element is absent.

## Stable mappings

Add `uiBindingsFile: "Tools/Helix/ui-bindings.json"` to `reference.json`. The project-owned file contains:

```json
{
  "schemaVersion": 1,
  "elements": [{
    "id": "shop.offer.price",
    "reference": "window.game.shop.offers[0].buy.label",
    "unity": {"component": "Game.Shop.ShopCarouselView", "steps": [
      {"field": "_pages"}, {"index": 0},
      {"component": "Game.Shop.ShopOfferCardView"}, {"field": "_priceText"}
    ]}
  }]
}
```

The reference expression must resolve to the actual displayed object; it is read-only instrumentation and must not mutate the game. Binding IDs must be unique. Duplicate object bindings and unavailable targets produce explicit errors. They are not replaced with nearest-looking objects. Unity binding resolution is implemented by the project adapter. Resolve each semantic ID to exactly one intended object and report missing or ambiguous targets explicitly. The binding structure above is an example project contract, not a universal field resolver.

A comparison selector is an exact conjunction of `semanticId`, `name`, `path`, `id`, `kind`, `scene` or `type`. Semantic IDs are preferred; name/path selectors remain useful for unique objects. Multiple matches block that element. Missing matches in a complete inventory are differences; missing matches in a truncated inventory remain unmeasured.

## Comparison spec

```json
{
  "schemaVersion": 1,
  "stateKeys": ["view", "offerPage"],
  "elements": [{
    "id": "shop.offer.price",
    "reference": {"semanticId": "shop.offer.price"},
    "candidate": {"semanticId": "shop.offer.price"},
    "boundsTolerance": 1,
    "checks": [
      {"path": "text.value"},
      {"path": "text.lineCount"},
      {"path": "text.baseline", "tolerance": 1, "unit": "px"},
      {"path": "font provenance", "referencePath": "text.fontAsset", "candidatePath": "text.fontAsset.guid",
       "expected": {"reference": "verified-web-font-hash", "candidate": "verified-unity-font-guid"}}
    ]
  }],
  "relations": []
}
```

Choose tolerances from the task's acceptance criteria. The example's values are illustrative. Every mapped element compares bounds and visibility. Other properties are opt-in. Numeric tolerances return signed candidate-minus-reference deltas. Omit tolerance for exact JSON equality. `referencePath`/`candidatePath` map different renderer properties. `expected` checks each engine against its own verified asset or setting instead of requiring the same identifier in both engines.

Relations specify `from`, `to`, `metric` and a nonnegative pixel `tolerance`. Metrics are `gapX`, `gapY`, `left`, `top`, `centerX`, `centerY`. Positive gap means separation; negative gap means overlap. Alignment metrics compare the two elements' edge/center displacement in each engine, then report the difference between engines.

`stateKeys` are required nonempty paths in snapshot state. Known `null` state values can agree; absent state cannot. Add balances, inventory, language, offer contents and scroll state whenever those affect the case. Equal view names alone do not prove equivalent content. Optional `checkpoint` requires that exact named checkpoint in both snapshots. Matching viewport and safe area are mandatory prerequisites.

## Capture evidence contract

A v1 receipt contains `ui`, `sha256`, and `image` (relative to the receipt) or `capturePath`. The UI snapshot contains:

- `schemaVersion: 1`, `coordinateSpace: "native-top-left-pixels"`.
- `viewport: {width, height}` and `safeArea: {x, y, width, height}` in that coordinate space.
- `state`, optional `checkpoint`, `nodes`, `truncated`, optional `bindingErrors`.
- Each node's identity, `bounds`, `visible`, and optional nested `text`, `sprite`, `input`, `layout`, `clipping` evidence.

Missing measurements must be null or absent, never fabricated zeros. Retain measurement method and renderer metadata. The comparator can consume Unity, UI Toolkit or device adapters using this contract. Only report properties actually measured by the selected adapter.

Phaser captures expose configured font properties, wrapping, baseline metrics and texture/atlas metadata. Font network resource hashes are retained in the main receipt. `fontReady` tests family availability; it does not identify the actual per-glyph fallback. TMP rendered line metrics, font asset provenance, sprite borders/import settings and mask intersections require an adapter that measures those properties. Unmeasured fields must remain absent or null. A canvas raycast observation is not proof that a callback ran.

Phaser screen bounds use the main camera and world AABB. Secondary cameras, rotated-camera geometry, masks and pixel occlusion require scoped custom instrumentation; use `uiProbe` to return additional JSON nodes/evidence. Do not treat layout bounds as visible pixel silhouettes. Both geometry and typography need visual verification before adopting tolerances.

The optional Unity helper described in `Tools/Helix/Adapter.md` validates and writes this receipt contract. It supplies RectTransform bounds utilities; a project adapter supplies semantic mappings, state and any additional measured UI fields. It does not replace the project’s capture method or storage-isolation checks.

## Inputs and capture timing

Scenario steps support `press` (including a semantic binding ID as `target`), `drag`, `hover`, `pointerDown`, `pointerUp`, `wheel`, `wait`, `assert`, and labelled scripts. Hover/down/up require `x,y`. Wheel requires `x,y,deltaX,deltaY`; each delta is bounded to ±10000. Assertions evaluate a read-only expression, compare its JSON result with `expected`, and retain the actual value in the action receipt:

```json
{"kind":"assert","expression":"window.game.shop.page","expected":1}
```

Use real pointer steps followed by assertions to test disabled controls, scrolling, callbacks and overlay blocking. Down/up must be paired in the scenario or followed by a reset. Assertions fail scenario setup immediately. Label any direct state manipulation as a fixture. Individual manual non-wait steps invalidate the named scenario, as before.

`uiClockHold: "phaser-loop"` temporarily sleeps the configured Phaser loop after readiness/capture setup, obtains the snapshot and PNG, and restores the previous running state even on failure. This is disclosed instrumentation. Document whether the project's Unity capture holds its frame and how it restores the prior state. Neither hold synchronizes animation phase across engines, freezes DOM/CSS animation, nor establishes transition timing. For transition cases use explicitly instrumented checkpoints or the separate motion workflow.

## Matrix plan and explicit execution

```json
{"schemaVersion":1,"cases":[
  {"id":"shop-phone","scenario":"shop","viewport":"phone","uiSpec":"Tools/Helix/ui-shop.json"},
  {"id":"shop-tablet","scenario":"shop","viewport":"tablet","uiSpec":"Tools/Helix/ui-shop.json"}
]}
```

```sh
./Tools/Helix/bin/helix ui-matrix --spec Tools/Helix/ui-matrix.json --out .aikit/scratch/ui-round-01
./Tools/Helix/bin/helix ui-matrix --spec Tools/Helix/ui-matrix.json --out .aikit/scratch/ui-round-01 --execute yes
```

Planning never starts an Editor/browser or writes evidence. Execution requires the project's supplied `preflight`, `prepare`, `capture`, `restore` recipes, an already available Editor, the selected `ai-kit` or `unity` backend on PATH, an isolated workspace, and no pre-existing reference browser session. It creates the Unity output directory, executes argument arrays without a shell, then compares `reference/reference.json` with `unity/unity.json`. The capture recipe must produce those names. Each case uses fresh output. `matrix.json` retains command results, failures, cleanup and cases not run.

For scene-assisted cases, add `sceneSpec` and `sceneProfile` to the case and supply matching inline Unity scene evidence. Read the scene contract (`Tools/Helix/Scene.md` when installed; [scene.md](scene.md#paired-image-review-and-one-case-execution) in the source repository) for the request file, adapter fields and one-case command.

The matrix starts its browser in a private session under `.helix/fixture-sessions/<matrix-token>`. Adjacent cases with the same viewport reuse that browser. Each case still runs its configured scenario setup and Unity restoration; browser reuse is not fixture reuse or permission to skip readiness. A viewport change, interruption, execution/capture failure or restoration failure closes the owned browser. A report-only failure after both captures succeed can retain the same-viewport browser when Unity restoration also succeeds; the failed case and its receipts remain recorded. Group compatible viewports in the spec when case ordering permits, and retain every case’s separate evidence.

The runner does not provision an Editor, install packages, build games, or acquire an AI Kit seat. Managed lanes are supported, as are linked Git worktrees explicitly opted in with `.helix/isolated-worktree.json`:

```json
{"schemaVersion":1,"kind":"standalone-comparison","projectRoot":"/absolute/canonical/worktree/path"}
```

The Git backlink must match. The project adapter must independently verify storage isolation before Play. Never add this marker to a developer checkout to bypass those checks. Document the actual storage paths and isolation mechanism in the project's adapter.

A matrix lock prevents normal CLI commands from changing its browser. Commands are bounded to 90 seconds. SIGINT/SIGTERM request a stop at command boundaries with restoration; an unresponsive remote Editor may still need inspection. Once preparation is attempted, every restoration command is attempted even if one fails. Cleanup failure stops later cases. No automatic retry occurs. A crash/SIGKILL can leave a stale lock: inspect and restore the owned sessions before removing it.

Optional `safeAreaInsets: {top,right,bottom,left}` uses native pixels. Nonzero insets require the scenario to declare the same `safeAreaInsets` and supply an actual device/simulator capture recipe; both resulting receipts must report the requested safe rectangle. Do not assume an Editor Game View capture reproduces a device notch or safe area. Unsupported notch cases are blocked, not passed as rectangular captures. Orientation/content/language variants are ordinary separately configured scenarios and viewports.
