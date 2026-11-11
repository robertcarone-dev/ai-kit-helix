# Evidence and optional AI Kit workflows

Requires Python 3.10+; managed Unity test execution currently supports Unix account-home semantics only. Run `python3 Tools/Helix/toolkit/workflow.py --help` for commands. Browser capture remains usable without these integrations.

`ledger-check LEDGER --inputs INPUTS` checks recorded input fingerprints and evidence hashes without changing verdicts. Ledgers contain `cases` with `id`, `inputs`, `status` and `evidence` entries (`path`, `sha256`); paths are relative to the ledger. Inputs are keyed by case ID. Authors must include all relevant dependencies.

`recording-check RECEIPT --width W --height H` inspects actual Unity PNG/JPEG frame headers, dimensions, order, timestamps, drops and hashes. Optional `--first-frame`/`--last-frame` check endpoint coverage, not contiguous sampling. JPEG is lossy even at native dimensions. Browser motion.json is a different format.

`evidence-fetch ISSUE#ATTACHMENT --project-root DIR --out DIR` reads AI Kit attachment metadata from the lane owner and copies verified originals to fresh owned `.aikit/scratch`. It never modifies originals. Missing or changed evidence remains explicit.

`capture-plan --project-root DIR --width W --height H --kind motion` checks the project’s reviewed recorder profile. `recipe-plan CASE --project-root DIR --viewport NAME --out DIR` combines project scenarios/catalogs and hashes helpers; it prints plans, not execution. Missing configuration is a blocker for that operation.

Managed tests require `Tools/Helix/toolkit/Adapter.md` configuration and an active assigned lane. Use `test-plan --project-root DIR --editor PATH --filter FILTER --assignment ID --out DIR`, then `test-preflight --project-root DIR --assignment ID --out FRESH_DIR` while the owned Editor is ready and Play is stopped. Safely close only that Editor without releasing its assignment. `test-run` accepts the same plan arguments plus `--execute --isolation-receipt FILE`. The preflight receipt expires after twenty minutes and must match lane, assignment, revision and verifier paths/hashes.

The runner verifies closed-Editor state, source compatibility and account-home credentials, preserves XML/logs, and attempts `ai-kit unity ensure` restoration even after a failed process. Inspect run-receipt.json for both test and restoration results. Do not restart shared infrastructure or overwrite shared saves. Test success is not Helix parity.


## Readiness and synchronized motion

After implementing the project-owned capture hooks documented in `Tools/Helix/toolkit/Adapter.md`, run:

```sh
python3 Tools/Helix/toolkit/capture.py gate --execute --project-root /path/to/game --assignment A-N --expected expected.json --out .aikit/scratch/gate-01
python3 Tools/Helix/toolkit/capture.py motion --execute --project-root /path/to/game --assignment A-N --expected expected.json --out .aikit/scratch/motion-01 --seconds 8 --timeout 90
```

Omit `--assignment` only for a configured non-managed backend. Relative expected/output paths resolve against the selected project, independent of cwd or toolkit location. Outputs must be new directories inside that checkout's `.aikit/scratch`. A per-checkout capture lock prevents overlapping runs; inspect an abandoned lock and its owner rather than automatically removing it. Symlink paths cannot escape the project. Source hashes, compatibility profile and expected identity are checked before execution; `--execute` is required. Nothing is armed or inferred by default.

The gate waits for a project-defined safe transition, requests preparation at most once, then checks exact ready identity and dimensions. A successful gate leaves the session ready for its caller, which must eventually invoke the adapter's restoration procedure. Gate errors attempt restoration. Motion runs its own gate, starts recording, waits for a captured frame, calls the guarded action once, and requires observed event endpoints within the actual native saved frame sequence. Keep action/observer duration shorter than the recording window to allow startup overhead. A lost reply never authorizes another action. Failed motion attempts stop only their allocated recording and attempt restoration; successful motion also restores. Restoration failure fails the result. Every started workflow retains `capture.json`, including hook timings, returned evidence and errors. Configuration errors before an output is created produce no receipt.

`capture.py` is deliberately not a copy of any game's C# helper. Keep game actions, readiness logic, restoration, motion fixtures and environment selection in the adapter. Test one live pilot including error cleanup; automated synthetic tests do not establish visual parity or a measured speed improvement.

## Delivery, reuse and timing

```sh
python3 Tools/Helix/toolkit/delivery.py integration --project-root /path/to/game --branch task-branch --base main --out integration.json
python3 Tools/Helix/toolkit/delivery.py pack --source evidence-directory --out new-package-directory --revision EXACT_REVISION_LABEL --part-mib 20
python3 Tools/Helix/toolkit/delivery.py upload --project-root /path/to/game --issue AK-N --package new-package-directory --out new-upload-receipt-directory
python3 Tools/Helix/toolkit/delivery.py reuse --ledger ledger.json --inputs current-inputs.json --out reuse.json
python3 Tools/Helix/toolkit/delivery.py timings --project-root /path/to/game --out timings.json
```

Delivery output paths are explicit filesystem paths (relative to cwd); they are not capture output paths. `integration` snapshots both refs and reports missing commits versus ancestry or patch equivalence, exiting nonzero for a merge gap. Merge commits absent from the target conservatively require review. It neither merges nor approves runtime behavior. Choose the project's actual integration branch; `main` is only the default.

`pack` requires a stable nonempty source directory and a new output outside it. It rejects symlinks, hashes source and archived payload bytes, and produces ZIP parts of 1–20 MiB plus a manifest with the supplied revision label, ordered reconstruction instructions, archive hash and per-part/payload hashes. Existing filenames/embedded labels remain unchanged. Do not package unrelated credentials, caches or unpublished evidence. Mixed-revision evidence needs its own per-file provenance; the packaging label is not historical proof.

`upload` and `timings` are optional AI Kit integrations. Upload verifies package parts and reconstruction hash, attaches through the supported CLI, then verifies consumer bytes against board metadata. Matching existing attachment hashes are reused. A partial failure preserves `upload.json`; inspect it before retrying with a fresh receipt directory. The helper never deletes existing attachments or marks a task complete. The supplied archive is not automatically extracted.

`reuse` uses the existing ledger format: each case's declared dependencies and evidence hashes determine whether it can be reused. It does not discover undeclared dependencies or change verdicts. Preserve valid cases and repeat only invalidated/required integration cases. `timings` reports requested/start/end wall-clock spans, run counts and provider holds from AI Kit metadata. Resumed assignments may include earlier work: request-to-latest-start is not pure queue time, and spans are not model execution or an invented phase breakdown.

## Dispatch a recipe pilot

Run `python3 Tools/Helix/toolkit/workflow.py recipe-plan CASE --viewport VIEW --project-root DIR --out DIR/.aikit/scratch/ROUND` using absolute project and output paths. This offline command accepts configured scenarios and registered fixture IDs. Read `dispatch.gaps` before reserving a runtime. The catalog entry can declare a procedure for a manual Unity setup or the scenario can supply preflight, prepare, capture and restore stages. In the project fixture catalog, supply `trigger` (actual input or disclosed setup), `observation` (observable event/state), `measurement` (method and units) and `owner` (contact for missing prerequisites). List files influencing the route in `files`. The owner should verify a manual procedure supports the specific viewport.

When status is `pilot-required`, exercise the scoped route in both authorized runtimes. Save a JSON receipt of this form and pin it under the catalog entry's `pilots[VIEW]` as a checkout-relative `{path, sha256}`:
```json
{
  "recipeFingerprint": "<from dispatch>",
  "helix": {"path": "<reference artifact>", "sha256": "<digest>", "observed": "<action, event and measured result>"},
  "unity": {"path": "<candidate artifact>", "sha256": "<digest>", "observed": "<action, event and measured result>"}
}
```
The fingerprint covers the viewport, recipe, Helix settings, catalog contract and declared file hashes. Update those inputs when relevant dependencies change. Recover archived files into their declared locations before planning. `pilot-recorded` means the owner's receipt and both pinned artifacts are accessible for this recipe. Inspect its observations and the source identity before requesting a live batch. Use the coverage report for per-moment reuse.

## Explain an event window in a recording

Run the existing native recording check with a case-specific window in milliseconds:

```sh
python3 Tools/Helix/toolkit/workflow.py recording-check RUN/record.json --width 768 --height 1024 \
  --events RUN/events.json --event continue --before-ms 250 --after-ms 3000 \
  --visual-samples RUN/measurement.json > timing-report.json
```

Use the events receipt from the same run. It contains an `events` array with a unique matching `action` and integer Unity `frame`. Include `recordingId` for identity validation. Older receipts without an ID require the caller to verify provenance. Elapsed times from separately started clocks are never subtracted. The event is anchored to its saved Unity frame or bracketed by the two surrounding captures. Each overlapping interval reports its endpoints and capture, unscaled and game-clock deltas, plus the count of intervening unsaved frame IDs. The realtime recorder can sample at a different point in the loop from Unity's frame-start clock. Inspect adjacent intervals. A capped recorder can skip frames with zero reported drops.

Optional visual observations declare `record` (recording ID or directory), `dimensions`, `method` and `samples` (or legacy `navySamples`). List all matching saved frames with their recording index `i` and timestamp `t` in seconds. The report brackets contiguous observed runs with neighboring saved frames. Their sampled span alone cannot establish continuous display duration.

For independent loop timing, a project-owned recipe can start `new Helix.Comparison.PlayerLoopTimingTrace(recordingId)` during authorized isolated Play Mode, before triggering the case. Call `Mark("continue")` on the actual action and mark transition milestones at their owning callbacks. The helper buffers one monotonically timed sample per observed Unity Update frame. Write the JSON returned by `Finish()` after the window; call `Dispose()` in the recipe’s cleanup. Use `--trace RUN/trace.json` to join the same recording by ID and frame number. If the trace contains the named event, it can also supply the events receipt. An interval has complete trace coverage only when both endpoints and every intervening Unity frame were sampled.

To compare recorder overhead, replay the same action, state, viewport and quality with image capture disabled. Construct the helper with null recordingId and save its trace. Pass it as `--baseline-trace REPLAY/trace.json` with the recorded run. Its peak consecutive Update gap is measured around its own event; frame IDs from separate runs are never joined. A loop gap identifies a slowdown in that measured run. Attribution to scene loading, recorder work, GPU presentation or the physical player requires separate evidence.

## Review the actual event before declaring footage missing

Run `helix recording-sheet --spec window.json --out NEW_DIR` offline. It reads a retained Helix `motion.json` with its adjacent hash-matching `motion.webm`, or a Unity frame-sequence receipt. It requires ffmpeg and ffprobe. Input paths in the spec resolve relative to the spec. No live session is needed.

```json
{
  "recording": "run/motion.json",
  "event": {
    "name": "claim-started",
    "frame": 160,
    "observation": "First decoded frame showing the claim burst, visually inspected"
  },
  "beforeMs": 750,
  "afterMs": 3000,
  "intervalMs": 250
}
```

The anchor must be an actual saved Unity frame ID or a zero-based decoded video frame ordinal. Describe the visual observation supporting it. Browser scenario elapsed times have their own origin and cannot be used as clip timestamps. Video setup/loading is included before the observation interval. Locate the event in the full recording before anchoring it.

Open `index.html` for labeled timestamps and event-relative offsets. `sheet.json` retains the source receipt hash, video or individual source-frame hashes, requested/available bounds and all selected frame identities. Overview PNG pages sample the whole recording, including the final frame. Event PNG pages cover the requested window at the declared sampling interval and include the anchor and available endpoints. Each PNG's ordered frame list is in the JSON; use the HTML labels when reading times. Large windows paginate automatically. More than 500 requested intervals is rejected; choose a narrower window or a coarser overview. Incomplete bounds are reported explicitly even when image generation succeeds. Thumbnail sheets support review; inspect native source frames for small detail and every frame around the event for exact timing.

Before claiming absent footage, inspect the overview, the event window and the recorded final state. State the inspected source interval and sampling limits. A first-page contact sheet covering only loading cannot establish an absent event. If no event can be found, inspect all relevant recording intervals and report the coverage searched. Separate missing bytes, partial review, absent event, incomplete window and a visible behavioral mismatch. Preserve accepted case results and repeat only checks whose inputs changed.

For the initial search, a spec containing only `{"recording":"run/motion.json"}` generates the full overview without an event claim. Inspect all overview pages, locate the event in the original frames, then supply the observed frame anchor for the detailed window.

Each sheet run also writes `evidence.json`, with checkout-relative artifact paths and automatically pinned spec, recording receipt, and video or source frames. Optional `inputs` in the window spec lists additional source/recipe files relative to that spec; these are pinned before rendering and checked again afterward. The CLI supplies the project root; direct Python callers can pass it as the third argument. Import this manifest through `discrepancy-save`'s `evidenceManifests` authoring field instead of assembling dependency hashes by hand. Generated pins establish artifact provenance, not completeness of game-source dependencies or visual acceptance.

### Cropped recording sheets

A recording-sheet spec can include `crop: [x, y, width, height]` in encoded-frame pixels. Bounds are checked against decoded video dimensions or the Unity frame receipt before output creation. The report records `encodedSize` and `crop`; source hashes, frame IDs and timestamps remain unchanged. Cropped thumbnails are scaled to the standard review width, not native pixel evidence. Video selection is decoded in one pass with passthrough timing. Use a full overview first to locate the event, then a crop/window to limit image context.
