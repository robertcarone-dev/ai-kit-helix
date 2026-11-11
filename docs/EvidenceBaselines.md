# Automatic evidence baselines

`capture` and `ui-assets` now write producer-owned baseline JSON alongside new evidence. Project-owned Unity capture orchestration can use the `unity-capture` producer with dependencies recorded before the capture and checked afterward. A baseline pins the exact image and receipt bytes plus the declared inputs used when producing them. `workbench prepare` consumes these records and can run render inspection as part of the same review command. It never reconstructs capture-time baselines from today's files.

## Produce evidence

For a native browser capture, declare the local files relevant to the case in a dependency spec:

```json
{"schemaVersion":1,"files":["../../Tools/Helix/reference.json","/absolute/path/to/prototype/src/assets/ui/coin/status_icon.webp"]}
```

Paths inside this file are relative to its directory, or absolute. Supply 1–99 regular files. The command hashes them before capture and checks them again afterward, including the dependency spec itself. A changed or unreadable dependency fails capture before evidence output is written; the existing clock-restoration path still runs.

```sh
Tools/Helix/bin/helix capture status-icon --dependencies capture-dependencies.json --out .helix/evidence/icon-reference
```

The result includes `baselinePath`, pointing to `baseline.json`. `capture` without `--dependencies` also emits a baseline, but with no dependencies: review preparation treats its freshness as unmeasured and blocks the bundle. Dependencies are declared file evidence, not an inferred graph. Their hashes do not prove the browser loaded those exact source bytes; served-content observations remain in the capture receipt. Dependency scanning uses a fixed-size hash buffer.

`ui-assets` automatically writes `<asset-id>.baseline.json` for each extracted PNG and returns a `baselines` list. Each record pins the original source bytes, the extraction spec, the generated image and `imports.json`. Source/spec changes during extraction fail before output is created. The existing explicit source hash in the asset spec remains required. No Unity assets are imported.

An extraction baseline establishes **extraction freshness**, not runtime scene freshness. Extracting a retained Unity screenshot today does not make that historical capture current with today's scene or code.

## Prepare a review with rendering inspection

A case side can use a baseline path instead of the existing explicit `{image, receipt, dependencies}` pins. Do not mix both forms on one side. Baseline paths and render-inspection spec paths are relative to the review spec directory.

```json
{
  "schemaVersion": 1,
  "cases": [{
    "id": "status-icon",
    "reference": {"baseline": "reference/baseline.json"},
    "candidate": {"baseline": "candidate/unity-capture.baseline.json"},
    "renderInspection": "render-spec.json"
  }]
}
```

The optional render spec can also reference those baselines, avoiding repeated image/receipt hashes:

```json
{
  "schemaVersion": 1,
  "id": "status-icon",
  "reference": {"baseline": "reference/baseline.json", "selector": {"name": "statusIcon"}},
  "candidate": {"baseline": "candidate/unity-capture.baseline.json"}
}
```

Use an exact selector for the actual case. Optional pinned `spriteUsage`, `unityUi`, and `renderTrace` inputs retain the [render inspector contract](RenderInspector.md). A reference baseline must point to a native UI snapshot receipt; an extraction receipt cannot substitute for a node snapshot. A candidate baseline supplies its image pin. Optional candidate snapshots still need their own validated receipt/selector.

```sh
Tools/Helix/bin/helix workbench prepare --spec review-spec.json --out .helix/evidence/icon-review
```

Preparation normalizes and retains both baselines, checks their image/receipt/dependency hashes, captures the current render recipe hash, runs the existing render inspector, verifies that its image hashes match the review pair, runs comparison, and packages the results. A render-inspection error blocks the bundle with the case ID and reason in `freshness.json`. A recipe changed during execution is rejected. The recipe is new preparation configuration; hashing it does not claim it existed at capture time.

Integrated inspection also requires the reference receipt, any candidate baseline receipt, and any candidate snapshot receipt to match the corresponding review receipt hash. Identical pixels alone cannot associate observations from a different capture. If a candidate snapshot is supplied, use that capture's receipt as the review candidate receipt, rather than an extraction receipt. Preparation checks every baseline used by inspection (including an optional candidate snapshot baseline) and records its image, receipt, baseline and dependency checks in `freshness.json`. Changed, missing, or empty baseline dependencies block the review even when the image hashes match. Explicit receipt pins remain supported and must match the freshness-checked review receipts. Standalone `render-inspect` still validates evidence identity without claiming dependency freshness.

The bundle includes the rendering report and raw JSON inputs/reports under `rendering-` prefixed names. Their bytes and hashes are preserved; internal paths still describe the original inspection directory, just as copied capture receipts retain their original image paths. Complete collector output is retained in `OUT/inspections/<case-id>/`. Both image hashes link the inspector to the prepared pair in the existing mod. A compatible project-owned viewer is required to display the bundle.

Existing explicit-pin review specs remain supported. Baselines are ordinary local records, not signatures: store them with the evidence and retain their provenance. Malformed/missing baseline or recipe files fail input loading (exit 1); changed/unmeasured dependencies or failed inspection after preparation starts retain a blocked report (exit 2). Successful preparation (exit 0) means ready for visual review, never accepted parity. Existing bundle resource limits apply to the combined evidence.
