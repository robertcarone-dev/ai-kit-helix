# Helix reference CLI

For optional project-owned Workbench integration, scenario controls, and event traces, see [Porting Workbench](Workbench.md). Start its CLI session with `start --workbench yes`. For offline review, `workbench prepare --spec REVIEW_SPEC --out NEW_DIR` checks pinned evidence and declared source freshness, generates comparisons, and creates a bundle for the mod; see the Workbench spec and exit-code contract.

Requires Node >=22.18 and a configured local Helix service. Install dependencies with `npm ci --prefix Tools/Helix` and Chromium with `npm run install-browser --prefix Tools/Helix`. The browser workflow does not require AI Kit. Automatic Helix Desktop launch is macOS-only; on other platforms start the local service first.

For offline image review, use `compare` for native PNG pairs and regional measurements, `debug-image` for image channels, `recording-sheet` for recording contact sheets, and `vfx-compare` for paired event filmstrips. PNG diagnostics use the installed `pngjs` dependency; recording review requires Python 3.10+, ffmpeg and ffprobe. None requires Pillow (`PIL`). Prefer these commands over custom PIL scripts. See `Tools/Helix/DebugViews.md` and the recording-sheet spec in `Tools/Helix/WorkflowToolkit.md` in the installed snapshot. `doctor` does not check these offline dependencies.

From a configured checkout:

```sh
./Tools/Helix/bin/helix doctor
./Tools/Helix/bin/helix resolve
./Tools/Helix/bin/helix start --viewport phone
./Tools/Helix/bin/helix scenario baseline
./Tools/Helix/bin/helix look
./Tools/Helix/bin/helix capture baseline --out .helix/evidence/baseline-01
./Tools/Helix/bin/helix record baseline-motion --duration 3 --out .helix/evidence/motion-01
./Tools/Helix/bin/helix stop
```

Replace scenario and viewport names with those in the project adapter. `--help` lists all commands. Every command accepts `--project-root DIR`; otherwise the nearest ancestor of the working directory with `Tools/Helix/reference.json` owns the session. Relative file arguments are relative to that project. Without a project, help and image comparison can operate from the working directory. Project commands refuse a missing adapter. The toolkit location never selects a game or lane.

`doctor` and `resolve` do not launch apps. Inspect doctor’s `error` and `browserInstalled` fields as well as its exit code. `start` resolves configured project and variant through the local catalog. `HELIX_URL`, `HELIX_DESKTOP_PORT` and project-local `reference.local.json` can select another loopback service. Do not embed credentials. Local `helix` fields merge; other top-level fields replace shared values. `start --url` marks preview identity unverified. Latest locally pulled content is accepted; content hashes do not prove a source commit.

Session tokens, locks, logs and evidence live in the checkout’s ignored `.helix/`. Reuse matching sessions; stop before changing config or viewport. Each new browser launch replaces `host.log`; its header identifies the launch ID, UTC start, project, URL and readiness predicate. Startup failures return that launch ID and the current log tail directly. Diagnose that command's output, not historical logs or another checkout's records. Browser launch, navigation, readiness, page errors and failed module responses are timestamped in the log. `status` exposes the launch ID, start time, readiness and diagnostics. `reset` and `scenario` recreate isolated browser storage. `recover` rechecks a timed-out readiness predicate without replaying setup; inspect failure before retrying. Only stop sessions you own.

`step` accepts labelled fixture/instrumentation script, press, drag, hover, pointerDown, pointerUp, wheel, wait or assert JSON. Script files must resolve inside the checkout, return plain serializable data and are hashed in receipts. Fixture setup does not prove player navigation. Non-wait steps clear the selected scenario.

`step` returns the completed action receipt in `step` and a script's value in `result` (omitted when the script returns `undefined`). Successful post-step inspection retains the usual top-level `look` fields with `inspectionError: null`. If inspection fails after execution, the command still returns the completed receipt and result, with the error in `inspectionError` and no inspection fields. Do not repeat the action to recover inspection; establish the appropriate scene and use `look` separately. Execution failures still fail the command, and standalone `look` still reports inspection failures as errors.

`record` requires a named scenario and recreates it, includes setup before the observation interval, and restores baseline afterward. It cannot record arbitrary manual setup. Recordings are bounded to 30 seconds. Check actual encoded dimensions and `nativeVideo`; odd dimensions can round. Native PNGs establish spatial dimensions; video does not prove game-time samples.

`assets --match TEXT` reads the project-wide asset catalog, not variant usage. `look` uses configured Phaser/Three mappings; it is not a universal model or font probe. Phaser bounds approximate main-camera output and do not resolve masks/occlusion.

`unity-plan SCENARIO --viewport NAME --out DIR` prints configured Unity recipe argument arrays, Git metadata in `revision`, and their `ai-kit` or `unity` backend. It never executes Unity commands. Output must be within the chosen project’s `.aikit/scratch`. Before executing a plan manually, save `revision` as `DIR/unity-revision.json`; matrix and shop-motion runners do this automatically. Alternatively, `unity-revision` prints fresh metadata for redirection to that file from the lane root. Git commands run outside Unity with a 10-second deadline. Execute preflight, prepare, capture and restoration only under the project’s verified adapter procedure. Always restore owned state after failure.

Overlay the plan's `environment` on the child process environment for **every** stage. AI Kit plans set `AIKIT_QA_VIEWPORT` and a round-local `AIKIT_QA_DIR`; resizing the Game view alone does not configure later play commands. The matrix runner applies this environment automatically.

`compare --reference PNG --candidate PNG --out EMPTY_DIR` creates native side-by-side/diff PNGs, JSON and HTML. It refuses mismatched dimensions and existing evidence. Pixel metrics are diagnostic, not an acceptance verdict. Inspect both receipts, equivalent state, input evidence and timing.

Add `--regions regions.json` for paired regional differences and per-image statistics:

```json
{"schemaVersion":1,"regions":[{"id":"label","rect":[130,640,180,685]}]}
```

Rectangles use native top-left pixels: `[left, top, right, bottom]`, with right and bottom excluded. Both images use the same rectangle. IDs must be distinct nonempty strings; rectangles must contain integer coordinates, have positive area, and fit inside the images. Invalid regions are refused, never clamped. A 1×1 rectangle measures a point. Regional measurements require 8-bit PNG inputs and opaque pixels inside every sampled region; ordinary whole-image comparison retains its RGBA behavior.

`comparison.json` retains the whole-image results and adds `regionsSource` (absolute path and SHA256 of the supplied JSON) and `regions`. Each region reports `pixelCount`, `referenceMeanRgb`, `candidateMeanRgb`, `meanDeltaRgb`, `changedPixels`, `changedFraction`, `meanAbsoluteDeltaRgb`, and `maxAbsoluteDeltaRgb`. Means use encoded 8-bit RGB without gamma conversion. Signed mean delta is candidate minus reference; mean absolute delta averages absolute per-pixel differences, so opposing changes cannot cancel. Changed pixels have at least one different RGB channel. The existing review page includes a regional measurement table; the images remain full-size. Regions may overlap and are reported independently. No threshold, alignment, resizing or acceptance verdict is inferred.

Read `Tools/Helix/project-adapter.md` for game-specific recipes and `Tools/Helix/WorkflowToolkit.md` for optional AI Kit workflows. No game build or Production check is required.

For sprite/UI rendering diagnosis, `render-inspect --spec FILE --out EMPTY_DIR` combines captured node properties, sprite usage, optional serialized UI settings and related render traces for the Workbench’s **Inspect rendering** drill-down. See [Render inspector](RenderInspector.md).

## UI comparison

`ui-look --match TEXT` inspects semantic bindings, text/sprite metadata and native layout observations. `ui-compare --reference RECEIPT --candidate RECEIPT --spec JSON --out EMPTY_DIR` produces an element report. `ui-matrix --spec JSON --out EMPTY_DIR` plans a case matrix; only explicit `--execute yes` executes supplied Unity recipes. Read the UI contract (`Tools/Helix/UI.md` in an installed project; `docs/ui.md` in the source repository) for schema, limitations, isolation and cleanup.

## UI conversion tools

`ui-assets --spec JSON --out EMPTY_DIR` stages local PNG/WebP/JPEG frames as PNGs with import metadata. `ui-plan --spec JSON --out EMPTY_DIR` proposes layout edits from paired native observations and explicit project mappings. `ui-impact --spec JSON [--previous JSON] --out EMPTY_DIR` identifies cases affected by declared dependency changes. These commands do not launch Unity or apply prefab changes. Read the conversion contract (`Tools/Helix/UIPort.md` when installed; [ui-port.md](ui-port.md) in the source repository) before authoring specs.

`conversion-plan --spec JSON --out EMPTY_DIR` joins hash-pinned, reviewed semantic links to existing asset/layout specs and optional verification matrices. It stages assets and proposes layouts; it never applies changes or executes verification. Read the same conversion contract for manifest requirements.

## Scene comparison

`scene-look [--profile NAME]` prints a read-only Phaser/Three scene inventory from a ready named scenario. A profile selects a built-in property set or a project-owned semantic scope from `sceneProfiles`. `capture SCENARIO --out EMPTY_DIR --scene-profile NAME` embeds that scene observation during the existing capture hold. `scene-compare --reference JSON --candidate JSON --spec JSON --out EMPTY_DIR` compares explicit node or group mappings, camera-projected landmarks and optional declared world-coordinate conversions. It writes diagnostic JSON plus geometric SVG overlays. Read the scene contract (`Tools/Helix/Scene.md` when installed; [scene.md](scene.md) in the source repository) for snapshot prerequisites, supported bounds and result statuses. Scene snapshots supplement separately captured images; they are not visual acceptance.

`scene-record --out EMPTY_DIR --duration SECONDS --interval-ms MS [--profile NAME]` samples the current ready scenario without replaying setup. `scene-motion --reference SEQUENCE --candidate SEQUENCE --spec JSON --out EMPTY_DIR` compares samples using explicit event-relative timelines and time tolerance. Appearance, relationship and repeated-style rules in the scene spec compare explicitly selected observations with declared tolerances and conversions. Inspect deadline timing and missed samples before interpreting temporal coverage. Read the scene contract before interpreting material values, event clocks or incomplete coverage.

`scene-report --reference RECEIPT --candidate RECEIPT --spec JSON --out EMPTY_DIR` validates inline scene/image evidence and creates a self-contained interactive HTML review. `scene-case --spec MATRIX --out SCRATCH [--execute yes]` plans or executes exactly one scene-enabled UI matrix case through the existing project lifecycle. Multi-case `ui-matrix` also supports `sceneSpec` and `sceneProfile`; the Unity adapter must supply inline scene evidence.

## Warm static capture batches

Use `batch` for repeated static fixture views when the consumer supplies a reviewed batch adapter. It loads once per viewport worker, resets the requested fixture between cases, and captures only the requested views. It does not record motion or exercise normal player navigation.

```sh
./Tools/Helix/bin/helix batch --spec Tools/Helix/static-batch.json --out .helix/evidence/static-01 --workers 1
./Tools/Helix/bin/helix batch --spec Tools/Helix/static-batch.json --out .helix/evidence/static-01 --workers 1 --resume yes
```

The spec uses configured viewport and adapter view names. Fixture contents belong to the consuming project:

```json
{
  "schemaVersion": 1,
  "cases": [
    {"id": "sample-front", "viewport": "phone", "fixture": {"asset": "sample"}, "seed": 1, "views": ["front", "side"]}
  ]
}
```

A missing seed defaults to 1. Use `--workers 2` only after measuring the single-worker pilot; workers own separate pages and state, and commands remain sequential within each worker. A shared two-worker budget limits competing batch processes. Keep Unity operations serialized in their assigned lane.

The batch captures native lossless PNGs using the full Chromium distribution installed by `install-browser`. Receipts retain image hashes, adapter/source fingerprints, observed state and timings. Repeated source manifests are shared within the output package; preserve the complete package when handing off evidence. Resume requires matching recorded dependencies and intact evidence. A changed dependency set is a reason to capture a fresh batch, not to weaken verification.

Measure initial loading, fixture preparation, view changes and PNG capture separately. Warm capture latency excludes startup and fixture setup. The generic toolkit has no universal subsecond guarantee: benchmark the actual project and machine. Before accepting scene reuse, compare a representative reused case with a fresh-session capture at the same state, viewport and seed, then inspect the images and receipts.

The required project-owned `batch` adapter is documented in `Tools/Helix/Adapter.md` (source: [project-adapter.md](project-adapter.md)).

## Agent-authored fixtures

From an installed project, run `helix fixture-list` for the authoring contract, configured viewports, available scenarios and registered fixtures. The agent inspects the actual prototype and its controls, authors a JSON document with schemaVersion 1 and the listed required fields, then calls `helix fixture-create --spec FILE`. Creation validates the step language and project-local script references and atomically registers a new project-owned document under Tools/Helix/fixtures. Edit that document for later revisions. The installer leaves it in place. Ready and state expressions must describe the observed outcome. A scripted fixture may prepare initial state; use ordinary player inputs for interaction claims.

Run `helix fixture-record ID --out NEW_DIR` to execute the authored case once in a new recording context. This uses the project's effective adapter and its own isolated session, leaving interactive sessions alone. Inspect the returned state, motion.json, and motion.webm. A failed case retains diagnostics; fix the project fixture or report a missing source capability. Record only in trusted checkouts: fixture scripts execute in the prototype.

For a Unity handoff, supply notes as a JSON array of objects with integer timeMs (from clip start) and text. The author can be an agent or designer. Run `helix fixture-handoff --recording DIR --notes FILE --out NEW_ZIP`. Registered fixture captures use the fixture replay command. Scenario recordings include the start and explicit-scenario record commands with their observation duration and viewport. For older receipts the exporter matches viewport dimensions against the checkout configuration. The portable archive includes the clip, its hash-bound receipt, fixture identity, annotations and agent brief. The commands emit machine-readable JSON and use nonzero exits on failure. Python 3 is required for archive export.

The optional designer UI runs with `python3 Tools/Helix/handoff-ui/serve.py --open`. It discovers registered fixtures and uses the same record and handoff commands as the agent.

## Resume a feature without the previous session

An AI Kit agent with a board key can discover its records with `helix discrepancy-resume --assignment BOARD-KEY` (use the assigned key).

For an open UI discrepancy, plan `helix discrepancy-rerun --id ID --out .aikit/scratch/new-round`. The additive discrepancy field `uiCase` takes `matrix` (project-relative file), `caseId` (exact matrix row), and `element` (UI spec element ID). Optional `reference` and `candidate` name individual receipt paths from the record's evidence list. The plan checks the saved bytes, PNG, case, viewport, and declared dependencies for each side. Execute its returned argument array to review two retained captures offline, capture one missing side, or capture both. Live capture uses the existing isolated matrix lifecycle. Use a new output directory each round. A blocked issue returns its prerequisite and refuses execution. A record without routing still resumes normally.

Each fresh matrix capture writes a v2 sibling `<receipt>.case.json` with its case, side, scenario, viewport, selected recipe and spec hashes, and receipt hash. Web fingerprints include the selected scenario with expanded script bytes, effective shared browser configuration and loaded bindings; Unity fingerprints include the selected Unity lifecycle recipe. Both include the selected viewport, safe area and scene options. The full configuration hash remains in matrix provenance. Adding an unrelated fixture or changing the opposite side’s recipe does not invalidate this side. To retain a side, pin the receipt and include the sibling, UI/scene specs, and actual source/fixture dependencies at capture time as inputs. Whole matrix/reference configuration files are not required pins; if explicitly pinned, their byte changes still invalidate evidence. Include external source identity through project-owned source snapshots or revision manifests. Claims without current source dependencies require fresh capture. Pairing still checks snapshot state and prerequisites. Older sidecars require one fresh capture to acquire scoped provenance; they remain available for historical review.

Start an assignment with `helix discrepancy-resume --feature "Feature name"`. Run `helix discrepancy-resume` without a feature to discover all open and blocked work. Feature names match exactly, ignoring case. The result includes each stable ID, latest revision, case/fixture ID, expected and observed behavior, source identity, Unity revision, next action and optional owner/assignment context. A zero count means this checkout contains no matching records. Use `--status all` to include resolutions and approved deviations.

Each evidence claim has its own `evidenceChecks` entry. `reusable: true` means the artifact and **all its declared inputs** match their capture-time SHA-256 values. `changed`, `missing`, and `unavailable` identify the affected files. An empty inputs list is unverified. An empty evidence list means no supporting files were recorded. Preserve independently reusable claims. Retrieve missing originals from the recorded `recoverFrom` location or recapture only the affected claim. Recheck external served content and integration when required; a local hash check cannot establish either.

### Save a checkpoint

Use `helix discrepancy-save --spec FILE`. Store **one expected vs observed difference or coverage gap per ID**. The JSON below illustrates the shape; replace the placeholder hashes with the actual recorded digests. Paths in evidence and inputs are relative to the checkout root, regardless of the spec file location.

For generated recording sheets, the authoring spec may also include `evidenceManifests: [".aikit/scratch/ROUND/sheets/evidence.json"]` alongside `evidence: []`. Save imports the manifest's artifact and dependency pins, verifies their bytes, and persists the expanded evidence array. It refuses changed, missing or duplicate artifacts instead of recalculating historical hashes. The manifest describes review artifacts, not visual acceptance; keep the finding and verdict in the discrepancy spec. Add recovery locators to the saved evidence when packaging a cross-checkout handoff.

```json
{
  "schemaVersion": 1,
  "id": "panel-title-baseline",
  "feature": "Panel",
  "caseId": "panel-open-phone",
  "status": "open",
  "expected": "Title baseline at 220 px from the top on the reference phone.",
  "observed": "Candidate baseline at 226 px in the same state.",
  "reference": "Default variant, served-source identity in the reference receipt.",
  "unityRevision": "REPLACE_WITH_CAPTURED_REVISION_AND_DIRTY_STATE",
  "nextAction": "Inspect the title prefab's TMP margin and its parent layout before changing either. Replay panel-open-phone after the edit.",
  "evidence": [{
    "claim": "The recorded candidate baseline is 226 px.",
    "path": "Evidence/panel/phone.json",
    "sha256": "CAPTURE_TIME_ARTIFACT_SHA256",
    "inputs": [{"path": "Assets/UI/Panel.prefab", "sha256": "CAPTURE_TIME_PREFAB_SHA256"}],
    "recoverFrom": "Assignment attachment or durable archive locator and internal path"
  }]
}
```

`id` is a stable lowercase kebab-case key. Use the fixture ID for `caseId` where one exists; findings can predate fixtures. Record an explicitly unknown revision when it is unavailable. Include all relevant declared dependencies, including scripts and import settings where they affect the claim. For independent sources or criteria, supply separate evidence entries. Optional `suspectedCause` is a hypothesis; `assignment` holds the board reference or responsible seat. For `blocked`, supply both `blocker` and a next action naming what will unblock it. For `resolved` or `accepted-deviation`, supply `decision` with the verification/ruling and its owner. Resolution requires evidence. Lifecycle status is distinct from the original comparison verdict.

For an update, use the latest resume result's **record** as the full spec, edit it and call `helix discrepancy-save --spec FILE --after N` with the revision you read. This also supports reopening. Keep original hashes when updating prose or status. Add new evidence with its own capture-time hashes. Revision conflicts require rereading and reconciling; earlier snapshots remain readable.

Records are project files at `Tools/Helix/discrepancies/<id>/<revision>.json`. Deliver them to the receiving branch with the feature work. Make referenced evidence available in the checkout or via a durable recovery location, especially for ignored scratch outputs. The installer leaves records alone. Independent lanes editing the same finding must reconcile revisions during integration. The command does not publish to a board, retrieve evidence, or infer a new verdict.

## Transient VFX

`helix vfx-compare --spec FILE --out NEW_DIR` builds a self-contained HTML filmstrip and a JSON coverage report from existing Helix and AI Kit recordings. Python 3, ffprobe and ffmpeg must be on PATH. Input paths are relative to the spec; the output path is project-relative. Use an unused output path. On failure preserve partial evidence or diagnose the source before using a fresh path.

```json
{
  "schemaVersion": 1,
  "caseId": "effect-on-phone",
  "event": "first visible contact flash",
  "reference": {"receipt":"reference/motion.json","sha256":"RECEIPT_SHA256","anchor":{"frame":140,"observation":"First visible flash in the encoded clip."},"crop":[80,120,240,240]},
  "candidate": {"receipt":"unity/record.json","sha256":"RECEIPT_SHA256","anchor":{"frame":8142,"observation":"First visible flash on the saved Unity frame."}},
  "maxGapMs": 50,
  "beats":[{"name":"Before contact","offsetMs":-80},{"name":"Contact","offsetMs":0},{"name":"Decay","offsetMs":120}]
}
```

Mark the reference using the zero-based decoded frame ordinal in motion.webm next to motion.json; ffprobe supplies actual presentation timestamps. Unity uses the saved engine frame number (`frames[].frame`) and recorded clock (`frames[].t`). Author the common event and per-side observation from inspected images or a synchronized observer. Never substitute unrelated source and target timestamps. Source-only work omits `candidate`. A missing or incorrect anchor in a supplied recording is an input error.

The report retains each side's size, clock, observed anchor, preceding anchor gap, bracketing frames with actual offsets, and hashes of selected images. A wide bracket or a request beyond recorded coverage is unmeasured; the available images are retained for diagnosis. A sample exactly at a requested time has a zero bracket width. This does not establish the instant a transient began between frames. Playback can hold the same rendered image for multiple encoded frames. Compare equivalent state, camera, viewport and time basis before drawing conclusions. Optional crops use each recording's encoded top-left pixel coordinates; full frames stay available. File actionable differences or missing coverage using the discrepancy workflow.

### Recover board evidence on the receiving branch

Run `helix discrepancy-resume --feature "FEATURE"`. For missing evidence, run `helix discrepancy-recover --id ID`. New records should give each evidence entry a structured locator alongside its original path, capture-time SHA-256 and inputs:

- Direct attachment: `"recovery":{"attachment":"AK-123#a4"}`.
- Packaged member: `"recovery":{"attachment":"AK-123#a7","member":"phone/unity.png"}`. Here the attachment is the delivery manifest, and the member is its exact payload path.
- For legacy free-text locators the tool can use a single unambiguous board key in the hint. Otherwise pass `--issue AK-123` to search that issue's attachment metadata and package manifests by **pinned digest**. No filename or prose match authorizes recovery. Use an explicit locator per claim for mixed-origin issues.

Recovery reads the local board from the managed lane owner or current project. An independent checkout may supply `--board-root /path/to/owner-checkout`. It checks attachment bytes against board metadata, verifies package parts and reconstructed archive hash, reads only the identified ZIP member, and rechecks the destination digest. Missing scratch artifacts under .aikit/scratch and .helix/evidence return to their original paths. Other missing evidence is stored under .helix/recovered by digest. Existing conflicting files and source dependencies are never overwritten. Resume can read verified cached bytes for a missing original; executable recipes that require original adjacent files must still satisfy their own path and sidecar checks.

Read `recovery` for per-file retrieval results, then `evidenceChecks` for reuse on this checkout. Partial recovery returns JSON and a nonzero exit; successful files survive a retry. Missing/changed inputs still require review or recapture. At handoff, run recovery in a receiving checkout without the producer's scratch to verify durable locators.

When the next action depends on landing work, add `"integration":{"commits":["FULL_40_HEX_COMMIT"],"afterIntegration":"Replay the affected case on this checkout and attach the paired result."}` to the discrepancy. Both resume and recover emit `continuation.nextAction` and, for this form, the resolved receiving HEAD and per-commit ancestry. While any prerequisite is unknown or absent from ancestry, follow the recorded nextAction to resolve integration (check patch equivalence separately for cherry-picks). Once all are ancestors, follow afterIntegration. Ancestry does not establish visual acceptance. Historical records remain immutable. To add routing to an older record, save a new revision with --after.

### Aligning a scrubber pick to a Unity Animator

An AI Kit agent can register an optional `alignment` in a project fixture. Set `event` to a shared semantic event, `visible` to a browser expression that changes from false to true once when that event becomes visible, and `unity` to a binding with `event: "prefab-animator-start"`, `prefab`, `target`, `component` and `field`. Use this recipe when the equivalent Unity event starts the prefab's root Animator at its default entry, playing at normal speed. Presenter triggers, state jumps and custom Playables need a different Unity replay recipe. Keep all project names and bindings in the fixture.

Designers use the usual Record, scrub, note and export controls. For aligned recordings the recorder samples the predicate on animation frames and adds a 32 × 16 pixel marker in the top left corner at its first observed onset. FFmpeg and ffprobe must be on PATH. The recording retains the first marked video frame, its predecessor and presentation timestamps. This measures an event in the recorded picture, including setup time.

On the receiving checkout run `Tools/Helix/bin/helix handoff-owner --handoff FILE.zip --unity-project IDLE_ISOLATED_PROJECT --out NEW_EVIDENCE_DIR`. Supply a separate prepared Unity project or lane with the same prefab assets, the shared Editor helper and the declared Editor installed. This command uses the standalone Unity CLI and POSIX process inventory. It checks the clip digest and project fixture, opens an empty scene in batch Play Mode and advances the instantiated prefab's Animator from entry. Each note is snapped to its displayed source frame. Unity samples the elapsed interval from that frame back to the first marked frame and its predecessor, including both endpoints, at intervals of at most 1/120 s.

Read `alignment.json` for per-note clip paths and dispositions, and `review/ownership.json` for the property, clip weights, layers, values and input hashes. Overlapping clips, missing coverage and stale inputs prevent a single-owner result. Notes before the anchor or beyond the final indexed frame stay unaligned. The mapping measures equal elapsed playback time from the observed event. Differences in game speed, pauses or the shape of the two animations require additional alignment evidence.

For an entrance driven by a presenter, use `unity.event: "presenter-event"`, the shared prefab path, an `entryPoint` registered in the receiving fixture, and a `properties` array of target/component/field bindings. The Editor entry point owns the isolated game setup and restoration. Before configuration, construct a `PresenterOwnershipWindow` on the actual instance using the path in `HELIX_ANIMATOR_PLAN`; include project data assets supplying the values. Call `Signal` at the matching event, then `Sample` after each evaluated frame until it completes. Supply the live owning PlayableGraph when relevant. Publish the JSON returned by `Finish()` as `receipt.json` beside the plan after successful restoration. The command executes only the locally registered entry point after checking the handoff binding.

Property reports distinguish an observed assignment retained through the pick from a full-weight clip binding sampled across it. The graph probe follows AnimationPlayableOutput, AnimationMixerPlayable and AnimationClipPlayable on the target hierarchy. Unsupported nodes, competing drivers, changed inputs and frame gaps over 100 ms leave the answer open. Inspect the referenced property reports for actual values, call stacks, clip times and asset hashes.

## Per-camera URP render trace

Run `Tools/Helix/bin/helix render-trace --spec trace.json --out .helix/evidence/render-review` in an installed project. This read-only Node command writes render-trace.json. It needs no running Editor, Helix Desktop, board, or AI Kit assignment.

```json
{
  "schemaVersion": 1,
  "pipeline": "Assets/Settings/WorldPipeline.asset",
  "feature": "SceneCopyFeature",
  "pass": "Scene Color Copy",
  "property": "_SceneCopy",
  "captures": [{
    "fixture": "visible consumer",
    "camera": "WorldCamera",
    "receipt": "captures/graph.json",
    "sha256": "SHA256_OF_GRAPH_RECEIPT"
  }]
}
```

Use the actual pipeline asset, feature subasset name, exact graph pass label and shader identifier from the project. An explicit rendererIndex selects a camera override; otherwise the command follows the asset's default index. Pipeline, feature script and renderer references must resolve in text-serialized project Assets. The supplied pipeline/index is a configuration selection. Confirm which pipeline and renderer the camera actually used independently. The static trace follows the serialized GUIDs and file IDs and cites source lines worth inspecting. Shader-property matches cover .shader, .hlsl, .compute and .cginc files under Assets. Inspect indirect bindings, package sources and graph-generated shaders separately.

Omit captures for configuration-only work. To add graph evidence, use a URP Render Graph Viewer debug capture for each selected camera. In a supported, authorized Editor session, save the JSON string from `Helix.Comparison.RenderTraceCapture.Inspect(cameraExecutionName, textureName)` while that camera's capture is selected. The exporter reads the existing viewer and samples matching Editor RenderTexture objects. Viewer debug serialization is Unity-version dependent. Capture receipts are relative to the spec; both direct JSON and successful Unity CLI eval receipts containing the exporter result are supported. Pin the actual file hash. Keep revision, camera selection and fixture provenance with the capture.

The report lists each selected pass as absent, culled or present-unculled, resolves texture/buffer indices to named resources and graph consumers, and retains available descriptor fields in their original units. Saved graph scheduling does not prove GPU duration. Observation frame, quality, pipeline and memory describe the instant the viewer was read; the graph can be older or from a connected player. Named texture inventory is separate from graph ownership. Empty or unavailable evidence must not be used to claim device savings.

### Plan capture coverage before opening either runtime

Run `helix capture-coverage --spec FILE --out EMPTY_DIR`. Supply `--inventory FILE` to add another batch of evidence. The command reads retained captures offline. In `coverage.json`, `plan[viewport][side].capture` lists missing moments, and `reuse` maps each covered moment to its evidence IDs. Multiple moments can share a recording. `comparisons` identifies pairs available for review. The default `--basis retained` includes historical observations. Use `--basis current` to require matching declared capture-time dependency hashes. The project owns the completeness of those dependencies. Both modes leave artistic acceptance to review.

A version 1 spec declares a feature, named viewports with width and height, and requirements with a unique id, kind (still or motion), matched state and list of moments. Inventory filenames are relative to the spec. Each inventory has the same schemaVersion and feature, and an evidence array. Each entry supplies a unique id, side (helix or unity), view, kind, observed state, observation, receipt locator, and receipt checks (dotted object keys or numeric array indices mapped to expected values). Use the same state identity only for comparable setup. Annotate reviewed moments as `covers: ["requirement/moment"]`. For logged Helix actions use `deriveHelixMotion: true` and spec-level `helixMotionRules` with `orderedSetup` field matches on completed steps and the corresponding `covers`. Recognition stops at an intervening unmatched player input. It indexes footage for inspection; a completed action alone does not prove that the visuals match.

Use `{path, sha256}` for loose files relative to the consuming checkout. For an ordinary board ZIP use `{archive, path}` with a member path and an `archives` entry keyed by alias containing `attachment` (full board ID) and its pinned `sha256`. The reader verifies the board metadata and ZIP bytes before reading members. Existing recovered files can also be supplied as pinned loose files. Stills and Helix motion require a `media` locator matching the receipt hash. FFprobe reads the encoded video dimensions. For Unity recordings the planner reads the listed frames relative to record.json. Supply `frameHashes` keyed by receipt frame filename for loose files or `frameArchives` when the frame sequence spans ZIPs. The optional `motionEncoderTolerancePx` allows a specified encoder reduction per dimension while requiring the exact logical viewport. Supply `captureInputs` as checkout-relative paths and original digests for receiving-revision use. Missing media, failed predicates and incompatible dimensions leave capture work open.

## Sprite usage and packed atlas provenance

`Tools/Helix/bin/helix sprite-usage --spec FILE --out EMPTY_DIR` runs offline from the installed toolkit. It joins a verified Phaser UI receipt and PNG to a project-declared sprite mapping and scans project Assets for consumers. No AI Kit assignment or running Editor is required.

```json
{
  "schemaVersion": 1,
  "source": {"receipt":"captures/reference.json","selector":{"semanticId":"panel.icon"},"texture":"ui","frame":"badge"},
  "unity": {"path":"Assets/UI/Icons.png","guid":"TEXTURE_ASSET_GUID","fileId":"SPRITE_LOCAL_ID"},
  "inspection":{"path":"captures/sprite-inspection.json","sha256":"RECEIPT_SHA256"}
}
```

Receipt paths are relative to the spec; Assets paths are project-relative. Preserve the frame's JSON type and supply the signed Unity local ID as a decimal string. The report retains sprite metadata including the source rectangle, original size and trim when measured. The frame-to-Unity relationship is declared by the project. A matching name or similar screenshot cannot prove identical pixels.

The command returns exact inline GUID + file ID references in Force Text prefabs, with line and serialized object ID; nested prefab and variant parents are reported separately as possible consumers. Binary prefabs are listed as unscanned. Authored .spriteatlas and .spriteatlasv2 packables can identify individual sprites, entire textures or folders. Missing, inherited and unsupported lists require Unity inspection. Dynamic references, scenes, packages, and bundle residency are outside the static scan.

Omit inspection for the offline inventory. To resolve a packed page, save the JSON from `Helix.Comparison.SpriteUsageCapture.Inspect("Assets/UI/Icons.png", "SPRITE_LOCAL_ID")` in an authorized Unity Editor where the target atlas has already been packed. The helper matches the exact sprite’s bound texture object to each bindable atlas’s Editor preview pages; it records the page index, texture format and estimated mip-chain bytes. An unavailable preview API or an unmatched texture leaves the page unmeasured. It leaves source assets and packing settings alone. Include the receipt hash in the spec. The CLI verifies the captured sprite and reported atlas files and importer hashes against this checkout. Page identity is scoped to the atlas, build target and capture; instance IDs identify textures only within that Editor session. Tight/rotated sprites use normalized UV bounds. Page dimensions and format describe the observed packing, not device residency or exact occupied area. Re-export after changes to packables, platform, packing settings or other page contents.

### Dispatch and measurement handoff in capture-coverage

A coverage requirement may supply `recipeByViewport`, for example `{"phone":"win-enter-phone","tablet":"win-enter-tablet"}`. Each value names a configured scenario or registered fixture. `cases[view].recipes` contains the same dispatch status, gaps, owner and fingerprint as recipe-plan, plus the Unity procedure/stage names. See the installed WorkflowToolkit.md for the fixture catalog and pilot receipt contract. Older specs still produce their original plan and comparisons. A missing recipe leaves already captured pairs available to measure.

Read `cases[view].moments[key].nextAction`. Resolve missing prerequisites or run one pilot before expanding captures. For an available pair, measure the requested property, retain the result, and have the reviewer record the scoped verdict. To carry the work forward, add an optional inventory entry to `assessments` with `view`, `moment` (requirement/moment), and `record` (a pinned loose file or archive-member locator). Point to one current assessment per viewport and moment. The JSON record has this shape:
```json
{
  "view":"phone", "moment":"entrance/settled",
  "helix":{"id":"reference-phone","fingerprint":"<from coverage.json evidence>"},
  "unity":{"id":"candidate-phone","fingerprint":"<from coverage.json evidence>"},
  "method":"Measure the settled title top in native viewport pixels",
  "result":"Helix 154 px, Unity 156 px, delta +2 px",
  "reviewer":"<review owner>", "verdict":"PASS"
}
```
Omit reviewer and verdict for a measured pair awaiting review. Each fingerprint identifies the inventory observation, declared inputs, media/receipt locators and referenced archive pins. Inspect the resulting assessment status and capture basis. A historical review describes the recorded observations. A changed pair or inaccessible record leaves measurement open with the reason. Before releasing lane scratch, pack and upload the original captures, receipt, measurement and ledger, then verify the receiving checkout can recover the pinned members.

## Audit serialized material keywords

Run `Tools/Helix/bin/helix material-keywords --out EMPTY_DIR` from the consuming checkout, or supply `--project-root DIR`. This offline command reads Unity text assets and writes `material-keywords.json` in the output directory. It requires neither a running Editor nor a player build.

The audit scans material documents in .mat, .asset, .prefab and .unity files under Assets and embedded Packages. It resolves shader GUIDs there and in the local Library/PackageCache. It reads modern and legacy keyword lists, numeric property overrides and plain inherited material variants. For directly authored ShaderLab declarations it checks mutually exclusive selections, required local sets, and supported KeywordEnum, Toggle and ToggleOff drawers against their saved or default values. A single shader_feature keyword permits an off state. Explicit blank alternatives permit it in multi-keyword sets.

Exit code 2 means the report contains static mismatches; 1 means the command failed. Exit code 0 may still include review items and unscanned files. Read the material path and file ID, shader path, source line and reason before editing. A keyword used by a fallback can be intentional. Ambiguous shader GUIDs, built-in or generated shaders and variant overrides with unclear keyword ownership need manual inspection. The report also flags saved receive-shadows, surface, alpha-clip and flipbook values that disagree with common URP inspector keyword mappings for manual review. Binary containers can contain additional materials. The scan excludes imported model subassets, indirect or conditional pragmas, runtime keyword changes, custom ShaderGUI validation and build-time stripping. Verify the affected draw on the next authorized target player.

## Debug views

See [debug view capture and review](DebugViews.md) for paired luminance, HSV and alpha views, Three.js renderer captures, and the Unity geometry/material capture APIs.


### Bounded session lifecycle

Startup shares one 60-second deadline across browser launch, navigation and readiness; the client allows five additional seconds for shutdown. Failures identify the navigation/readiness stage in the host log. A command deadline retires the host instead of permitting a reset to overlap unfinished cleanup. Start a fresh session after inspecting the retained failure receipt. Alignment decoding uses asynchronous ffprobe/ffmpeg processes with 30-second limits, bounded output and cancellation when the host shuts down.

`record LABEL --scenario ID --after stop --duration SECONDS --out EMPTY_DIR` records the named scenario without requiring an earlier `scenario` command and closes the disposable session afterward. `--after reset` is the default for interactive sessions; omitting `--scenario` retains the selected-scenario behavior. `fixture-record` uses the explicit scenario and stop lifecycle, so actions execute once and no post-record reload is needed.

Static batch worker capacity requires Python 3 and POSIX file locking. A helper holds each permanent `.permit` inode until the parent closes its pipe; process exit releases the OS lock. Complete PID receipts are published atomically as `.lock` files so older workers also respect capacity; dead owners are recovered under the guard. Acquisition is bounded to 30 seconds (35 seconds for helper supervision). Incomplete legacy `.lock` receipts reserve their slots conservatively: inspect their owners and recover abandoned receipts explicitly before retrying. Do not unlink permanent `.permit` files.


### Cleanup and capture-time provenance

`stop` is idempotent for a missing session or a confirmed exited owner. A live owner, busy session or unknown PID is not treated as restored. Failed startup reaps only its own child, including when the initial status exchange fails. Matrix cleanup checks structured command results as well as exit codes.

Worker permits observe parent-pipe closure while queued, release on normal termination, and notify the batch immediately if the helper disappears after acquisition. Unexpected permit loss stops further work and fails the batch. Batch output locks now carry recoverable PID/token receipts using the same guarded acquisition as matrices; a crashed owner can be reclaimed on resume. Incomplete legacy locks still require explicit owner inspection. Permanent guard files must not be removed.

Matrix planning freezes comparison-spec hashes. Browser launch/capture receipts and Unity plans report the effective adapter configuration hash, and execution refuses a changed configuration before running its recipe. Before publishing case sidecars, the runner rechecks selected recipes and specs. These checks prevent an old plan from being labeled as capture-time provenance after an edit. They do not discover Unity asset or external web dependencies: those still require capture-time source pins. Explicit whole-file pins remain conservative and older receipts do not gain new provenance retroactively.
