# Project-owned configuration

The installer never updates these files:

- `reference.json`: Helix project/variant/query, named viewports, `ready` JavaScript expression, optional `phaser` expression and `three.scene`/`three.camera` expressions, scenarios with `steps`, `ready`, optional `captureSteps` and `unity` command stages.
- `reference.local.json`: ignored machine overrides; merge `helix` fields, replace other top-level fields.
- `fixture-catalog.json`: map case IDs to procedure, files, supported state/trigger and scope. Referenced files must remain inside the project.
- `workflow-adapter.json`: `{"verifiers":{"storage":"Tools/Verification/storage.cs","comparison":"Tools/Verification/comparison.cs"}}`. Both required for isolated test execution. Scripts must return the existing AI Kit eval envelope with success true, a result beginning `PASS:`, and target projectPath matching the lane. Their path and hash are retained in preflight receipts.
- `capture-capabilities.json`: reviewed `maxSide`, `defaultMaxSide`, `maxSeconds`, and nonempty `sourceHashes` mapping project-relative recorder source paths to SHA256. Unknown hashes mean capability is unverified.
- `test-routing.json`: nonempty `sourceHashes` for reviewed paths inside the installed performance test package. Exactly one matching package is required before tests run.
- `project-adapter.md`: game identity/mappings, exact setup/cleanup procedures, save/preference isolation scope and limits, linked fixtures and approved deviations.

Keep fixtures, game-specific helper scripts and Unity code, scenes and assets in the project. The optional shared Unity helper supplies comparison infrastructure only. A new project has no implicit Unity recipe. No helper may fabricate managed lane metadata, bypass compatibility verification or infer save isolation from worktree separation.

Unity stages are argument arrays executed without a shell. Legacy `scenario.unity` stage objects use `ai-kit`. To select a backend explicitly, use this shape inside a configured scenario:

```json
{
  "unity": {
    "backend": "unity",
    "stages": {
      "preflight": [["YOUR_REVIEWED_PREFLIGHT_ARGUMENTS"]],
      "prepare": [["YOUR_REVIEWED_PREPARE_ARGUMENTS"]],
      "capture": [["YOUR_REVIEWED_CAPTURE_ARGUMENTS"]],
      "restore": [["YOUR_REVIEWED_RESTORE_ARGUMENTS"]]
    }
  }
}
```

The arrays above are placeholders, not executable recipes. `backend` is `ai-kit` or `unity`; supply commands supported by the chosen executable. The toolkit does not translate AI Kit arguments to Unity CLI arguments. Unity CLI commands are pinned to the resolved checkout with `--project-path`; alternative instance selectors are not allowed. Placeholders are `{{projectRoot}}`, `{{out}}`, `{{scenario}}`, `{{width}}`, `{{height}}`, `{{capture}}` and `{{receipt}}`. Review the emitted plan before execution. Project-local hooks remain responsible for game-specific setup and cleanup. Do not use empty source-hash profiles to claim verification. The Python managed-test workflows remain AI Kit-specific.

## Optional Unity comparison helper

Install with `--unity-helper` after previewing the change. The installer copies `unity/Editor` into `Assets/HelixComparison/Editor` and tracks those files in its manifest. This opt-in persists during updates; unchanged managed files are removed by toolkit removal. The consuming project must already declare `com.unity.nuget.newtonsoft-json`; no package is installed or changed automatically.

Create a project-owned Editor class deriving from `Helix.Comparison.ComparisonAdapter`. The adapter is recreated on each call, including after a domain reload. `ComparisonContext.ProjectState` (`JObject`) is the saved restoration baseline returned by `SaveState`, not mutable ongoing session storage. Changes made to it by later hooks are not persisted. Keep ongoing requested-view or readiness state in project-owned session storage that survives the required reloads, not adapter instance fields. Implement:

| Hook | Responsibility |
| --- | --- |
| `Preflight(context)` | Return evidence including `storageIsolated: true`, `compatible: true` and the absolute `projectRoot`. Verify real storage and compatibility prerequisites; these fields are assertions backed by the project’s checks, not isolation supplied by the helper. |
| `SaveState(context)` | Return a `JObject` containing all project state needed for restoration before preparation mutates it. |
| `Prepare(context)` | Establish the requested scenario, with fixture use disclosed. |
| `IsReady(context)` | Verify the requested state and dimensions, not an old scene’s existence. |
| `SelectView(context, name)` | Apply a project-defined comparison view. |
| `Capture(context)` | Return a `ComparisonFrame` with native `Texture2D Image`, `JObject Ui` and a descriptive `Source` identifying the capture method. |
| `Restore(context)` | Restore owned project changes from the saved state. |
| `VerifyRestored(context)` | Check restoration before session ownership is released. |

Keep the recipe’s `preflight` stage read-only. Call `Begin` as the first mutation in the `prepare` stage: the matrix runner begins guaranteed restoration only once preparation is attempted. `Begin` rechecks the project preflight before taking ownership. Drive these static `Helix.Comparison.ComparisonSession` methods through the selected backend’s supported C# execution mechanism:

```text
Begin(adapterAssemblyQualifiedName, scenario, output, width, height)
Prepare(output)
Ready(output)
View(output, name)       # when required by the case
Capture(output)
Restore(output)
```

The adapter must be a concrete class with a public parameterless constructor. Begin requires an idle compiled, non-playing Editor with saved, clean scenes and fresh output below this checkout’s `.aikit/scratch`. Session ownership uses Unity `SessionState`: it survives domain reloads but not an Editor process restart. The baseline file remains on disk. After an interrupted or restarted Editor leaves an orphan baseline, inspect the recorded state and explicitly recover through the project’s supported procedure; do not assume restoration occurred or start a new comparison over unresolved changes. Poll readiness with the recipe’s bounded procedure before capturing. Exit any Play mode started by the recipe before calling `Restore`; retain ownership and diagnose a failed restoration instead of starting another comparison. The helper holds the Editor pause flag during capture and restores that flag afterward. Its UI snapshot must include `viewport.dpr: 1` and `viewport.zoom: 1`, the actual safe area, state and nodes. The helper validates native image/UI dimensions and required state, hashes evidence and writes `unity-before.json`, `unity.json`, `unity.png` and `unity-restored.json`. A valid receipt establishes its recorded checks and image integrity, not visual parity.

`Helix.Comparison.UiMeasurements.Bounds(RectTransform rect, Camera camera, int width, int height)` returns a `JObject` with native top-left `x`, `y`, `width` and `height`. A null camera means overlay UI and requires matching `Screen` dimensions. A supplied camera must cover the full native viewport without a target texture; behind-camera corners are rejected. These are geometry bounds, not visibility or clipping measurements. Semantic mappings and UI node construction remain project-owned. It does not automatically measure TMP font metrics, sprite provenance, occlusion or UI Toolkit layout. Missing values stay absent or null. The helper does not take screenshots or automatically match scenes. The project capture hook must obtain the actual composed native frame, including the required UI, and retains ownership of its `Texture2D`. No private Unity capture API or automatic fallback is supplied. Prefer supported AI Kit/Unity CLI capture APIs when they supply equivalent pixels and timing; do not replace a working capture route before checking those properties.

Existing game adapters remain valid. Adopt the optional helper only after a live pilot verifies setup, capture equivalence and restoration in that project. Default Node/workflow tests do not establish Unity compilation. The optional `npm run test:unity` smoke checks helper compilation and a synthetic lifecycle in a temporary Editor project; it does not establish game parity, project storage isolation, real Game View capture or backend end-to-end execution.


## Static batch adapter

An optional `batch` object in `reference.json` enables repeated static capture without reloading for each fixture. Keep all game hooks and scripts in the consuming project:

```json
{
  "batch": {
    "scripts": ["Tools/Helix/fixtures/static-preview.js"],
    "views": ["front", "side"],
    "reset": "(fixture, seed) => window.previewFixture.reset(fixture, seed)",
    "ready": "(fixture, seed) => window.previewFixture.isReady(fixture, seed)",
    "probe": "() => window.previewFixture.describe()",
    "view": "view => window.previewFixture.setView(view)"
  }
}
```

These function expressions illustrate an adapter API; the toolkit does not supply `window.previewFixture`. Script paths must resolve inside the consuming project. Provide the actual project-owned implementation and validate it in the running reference before expanding the matrix.

`reset(fixture, seed)` must remove previous fixture effects and deterministically establish the requested state, including owned timers, transient objects and camera settings. `ready(fixture, seed)` must verify the **new requested fixture and seed**, not merely that an old scene or canvas exists. `probe()` returns plain serializable state sufficient to identify the actual fixture and relevant settings. `view(view)` applies one of the declared view names and must establish the requested static view before capture. Load all dependencies needed by the requested views during reset/readiness; view switching must not lazily introduce unrecorded resources. Do not use a generic truthy readiness result as proof of correct setup.

Hashing the adapter and served resources establishes recorded dependencies, not semantic correctness of reset or readiness. Validate at least one warm reuse against a fresh-session result and retain the comparison. Motion, normal input, callback/guard behavior and cross-engine timing require their own evidence. Static batch configuration does not authorize Unity execution or replace its isolation and restoration procedure.


## Optional capture workflow adapter

`capture.py` is a backend-neutral orchestrator. It contains no game names, Unity types, fixtures or input semantics. Configure `capture` in project-owned `workflow-adapter.json`; no executable capture adapter is seeded by installation. Supply reviewed adapter commands for the game's actual lifecycle. AI Kit and standalone Unity CLI commands need a project wrapper that normalizes their replies to the protocol below; the toolkit does not guess backend envelopes or convert arguments.

```json
{
  "capture": {
    "schemaVersion": 1,
    "managedAiKit": true,
    "sourceHashes": {"Tools/Comparison/adapter.py": "REVIEWED_SHA256"},
    "hooks": {
      "preflight": ["python3", "Tools/Comparison/adapter.py", "preflight", "{{projectRoot}}", "{{out}}", "{{expected}}", "{{recordingId}}"],
      "probe": ["python3", "Tools/Comparison/adapter.py", "probe", "{{projectRoot}}", "{{out}}", "{{expected}}", "{{recordingId}}"],
      "prepare": ["python3", "Tools/Comparison/adapter.py", "prepare", "{{projectRoot}}", "{{out}}", "{{expected}}", "{{recordingId}}"],
      "restore": ["python3", "Tools/Comparison/adapter.py", "restore", "{{projectRoot}}", "{{out}}", "{{expected}}", "{{recordingId}}"]
    }
  }
}
```

This illustrates the contract; the wrapper and hash must be implemented/reviewed by the project. All hooks are nonempty argv arrays, executed without a shell in the selected checkout. Placeholders are `projectRoot`, `out`, `expected`, `recordingId`, `seconds`, `width`, `height`, `assignment`, each enclosed in double braces. Paths to helper scripts belong in nonempty `sourceHashes`; include every relevant adapter dependency. Hash matching is recorded provenance, not proof the hook is correct.

`managedAiKit: true` also requires a running Editor assignment bound to this ready managed lane. `false` permits other backends and standalone worktrees; the project preflight must still verify ownership, compatibility and save/preference isolation. It is not a way to bypass an AI Kit lane's lifecycle.

Every hook prints one JSON object, exits zero, and returns `ok: true` and the exact resolved `projectRoot`. The runner rejects other projects, malformed replies, nonzero exit and timeouts. Do not echo secrets into receipts.

| Hook | Additional result and responsibility |
| --- | --- |
| `preflight` | `isolated: true`, `compatible: true`. Validate actual ownership/storage routing and installed/compiled backend; retain baseline needed for restoration under `out`. Safe restoration must also handle a partially failed preflight. |
| `probe` | `state`: `waiting`, `prepare`, or `ready`. Only return `prepare` when the transition can be accepted. `ready` additionally requires exact `identity`, native `width`/`height`, `quiescent: true` and integer `frame`. Check actual fixture, seed, input history, settled state and served resources relevant to this game. |
| `prepare` | Perform the scoped transition at most once, rechecking readiness atomically. The runner never retries it after a lost reply. No automatic reset or hit replay. |
| `restore` | Restore only owned state from the baseline and return `restored: true` after verification; safe if preparation failed partway. |
| `recordStart` | Motion only: start native recording with supplied `recordingId` and `seconds`, return `id`. The allocated id is a `rec-YYYYMMDD-HHMMSS-xxxx` token. It must identify only this recording, even if the reply is lost. |
| `recordStatus` | Return `id`, `state` (`armed`, `recording`, `done`, `failed`, `timedOut`, `interrupted`), integer `frames`. `done` includes `recordPath`, contained in `out`. |
| `action` | Atomically confirm this recorder is active with at least one captured frame, then install observer/trigger once. Return matching `id`, `recordingConfirmed: true` and actual integer `firstFrame`. A prior poll alone is insufficient. The wrapper owns this backend-specific atomic check. |
| `events` | Return `complete: true`, observed integer `firstFrame` and `lastFrame`, both at/after action invocation. Missing or incomplete events fail coverage; never substitute recorder endpoints. |
| `recordStop` | Stop only the supplied id, including after a lost start reply. |

Motion requires all nine hooks plus a reviewed `capture-capabilities.json` profile. The adapter must write the supported frame-sequence JSON format: `screen` and `frameSize` are `{width,height}`; nonempty `frames` contain relative `file`, integer `frame` and numeric `t`. Images must be native PNG/JPEGs readable by `recording-check`. Other recorder formats need an explicit project conversion preserving source provenance; encoded videos alone cannot be substituted. Adapter frame numbering must use the same frame clock for actions, events and recorder frames.

Expected input is `{ "identity": { "case": "PROJECT_CASE", "seed": 7 }, "width": 780, "height": 1688 }`. Identity keys are project-defined, nonempty and compared exactly. Add relevant payload hashes, source hashes and state selectors; equal seed alone is insufficient. Width/height are requested evidence dimensions, never silently reduced. The hooks must check semantics, not merely return the expected input. Validate a live pilot before expanding a matrix; synthetic protocol tests do not validate a game's hooks.
