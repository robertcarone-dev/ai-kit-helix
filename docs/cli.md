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
