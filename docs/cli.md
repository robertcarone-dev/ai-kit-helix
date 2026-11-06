# Helix reference CLI

Requires Node >=22.18 and a configured local Helix service. Install dependencies with `npm ci --prefix Tools/Helix` and Chromium with `npm run install-browser --prefix Tools/Helix`. The browser workflow does not require AI Kit. Automatic Helix Desktop launch is macOS-only; on other platforms start the local service first.

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

Session tokens, locks, logs and evidence live in the checkout’s ignored `.helix/`. Reuse matching sessions; stop before changing config or viewport. `status` exposes readiness and diagnostics. `reset` and `scenario` recreate isolated browser storage. `recover` rechecks a timed-out readiness predicate without replaying setup; inspect failure before retrying. Only stop sessions you own.

`step` accepts labelled fixture/instrumentation script, press, drag, hover, pointerDown, pointerUp, wheel, wait or assert JSON. Script files must resolve inside the checkout, return plain serializable data and are hashed in receipts. Fixture setup does not prove player navigation. Non-wait steps clear the selected scenario.

`record` requires a named scenario and recreates it, includes setup before the observation interval, and restores baseline afterward. It cannot record arbitrary manual setup. Recordings are bounded to 30 seconds. Check actual encoded dimensions and `nativeVideo`; odd dimensions can round. Native PNGs establish spatial dimensions; video does not prove game-time samples.

`assets --match TEXT` reads the project-wide asset catalog, not variant usage. `look` uses configured Phaser/Three mappings; it is not a universal model or font probe. Phaser bounds approximate main-camera output and do not resolve masks/occlusion.

`unity-plan SCENARIO --viewport NAME --out DIR` prints configured Unity recipe argument arrays and their `ai-kit` or `unity` backend. It never executes Unity commands. Output must be within the chosen project’s `.aikit/scratch`. Execute preflight, prepare, capture and restoration only under the project’s verified adapter procedure. Always restore owned state after failure.

`compare --reference PNG --candidate PNG --out EMPTY_DIR` creates native side-by-side/diff PNGs, JSON and HTML. It refuses mismatched dimensions and existing evidence. Pixel metrics are diagnostic, not an acceptance verdict. Inspect both receipts, equivalent state, input evidence and timing.

Read `Tools/Helix/project-adapter.md` for game-specific recipes and `Tools/Helix/WorkflowToolkit.md` for optional AI Kit workflows. No game build or Production check is required.

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

Run `helix fixture-record ID --out NEW_DIR` to exercise the authored case and replay it in a new recording context. This uses the project's effective adapter and its own isolated session, leaving interactive sessions alone. Inspect the returned state, motion.json, and motion.webm. A failed case retains diagnostics; fix the project fixture or report a missing source capability. Record only in trusted checkouts: fixture scripts execute in the prototype.

For a Unity handoff, supply notes as a JSON array of objects with integer timeMs (from clip start) and text. The author can be an agent or designer. Run `helix fixture-handoff --recording DIR --notes FILE --out NEW_ZIP`. Registered fixture captures use the fixture replay command. Scenario recordings include the start, scenario and record commands with their observation duration and viewport. For older receipts the exporter matches viewport dimensions against the checkout configuration. The portable archive includes the clip, its hash-bound receipt, fixture identity, annotations and agent brief. The commands emit machine-readable JSON and use nonzero exits on failure. Python 3 is required for archive export.

The optional designer UI runs with `python3 Tools/Helix/handoff-ui/serve.py --open`. It discovers registered fixtures and uses the same record and handoff commands as the agent.

## Resume a feature without the previous session

Start an assignment with `helix discrepancy-resume --feature "Feature name"`. Run `helix discrepancy-resume` without a feature to discover all open and blocked work. Feature names match exactly, ignoring case. The result includes each stable ID, latest revision, case/fixture ID, expected and observed behavior, source identity, Unity revision, next action and optional owner/assignment context. A zero count means this checkout contains no matching records. Use `--status all` to include resolutions and approved deviations.

Each evidence claim has its own `evidenceChecks` entry. `reusable: true` means the artifact and **all its declared inputs** match their capture-time SHA-256 values. `changed`, `missing`, and `unavailable` identify the affected files. An empty inputs list is unverified. An empty evidence list means no supporting files were recorded. Preserve independently reusable claims. Retrieve missing originals from the recorded `recoverFrom` location or recapture only the affected claim. Recheck external served content and integration when required; a local hash check cannot establish either.

### Save a checkpoint

Use `helix discrepancy-save --spec FILE`. Store **one expected vs observed difference or coverage gap per ID**. The JSON below illustrates the shape; replace the placeholder hashes with the actual recorded digests. Paths in evidence and inputs are relative to the checkout root, regardless of the spec file location.

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
