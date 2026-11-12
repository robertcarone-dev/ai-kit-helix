> The Workbench **mod/UI is retired**. Use `helix evidence-report` and repository reports. The CLI evidence commands and historical formats documented below remain supported. Use `--project-root DIR`; feedback reads `--decisions REVIEWS_JSON` instead of mod storage.

# Porting Workbench CLI contract

This toolkit supplies reusable CLI clients and offline evidence/review formats. It does not install a Helix mod, game hooks, scenarios, selectors, Unity capture recipes, or a viewer. A consuming project can implement the browser/Desktop contracts below. Offline preparation, render inspection, revision comparison, review summaries, and dashboard publication work without these services when the checkout is selected locally.

## Browser integration

```sh
Tools/Helix/bin/helix start --viewport phone --workbench yes
Tools/Helix/bin/helix workbench list
Tools/Helix/bin/helix workbench run SCENARIO --level 1 --seed 54
Tools/Helix/bin/helix workbench action ACTION
Tools/Helix/bin/helix workbench checkpoint LABEL
Tools/Helix/bin/helix workbench export --out NEW_TRACE_DIR
Tools/Helix/bin/helix stop
```

`start --workbench yes` requires both the configured readiness expression and a version-1 Workbench API. It does not inject hooks or assume a particular game engine global. The page must expose `window.__portingWorkbench` with `version: 1`, `scenarios`, and methods `run({scenario, level, seed})`, `reset()`, `stop()`, `action(name)`, `checkpoint(name)`, and `snapshot()`. Responses must be serializable; successful scenario mutations report `status: "ready"` and their `runId`. Scenario/action names and level/seed semantics belong to the project. Missing or incompatible APIs fail explicitly.

Run, reset, and action invalidate previous scenario readiness; the host records their outcome as fixture actions. A snapshot/export is observation, not normal player navigation or proof of equivalent Unity state. Export writes `trace.json` and a hash-bound `receipt.json` to a new directory, including session/configuration identity and observed served sources. `workbench stop` stops the project scenario; the top-level `stop` command closes the CLI-owned browser.

Object discovery uses additional project APIs described in [Objects](Objects.md). Browser session isolation, native viewport checks, and ordinary capture/recording contracts continue to apply.

## Evidence bundles

```sh
Tools/Helix/bin/helix workbench evidence --source EVIDENCE_DIR --out NEW_BUNDLE_DIR
```

Only PNG and JSON files are packaged. Symlinks and other formats are skipped; no HTML is executed. The output must be new and outside the source directory. The version-1 `helix-workbench-evidence` bundle contains original file paths relative to the source, types, SHA-256 hashes, JSON text or base64 PNG bytes, dimensions, creation time, and skipped paths. Limits: 250 files, 32 MiB source bytes, 48 MiB encoded bundle, 8192 pixels per image side, 16,777,216 pixels per image, and 33,554,432 pixels total. PNGs are decoded during packaging. Import verifies file hashes and PNG header/dimension budgets; integrity does not establish scenario equivalence or parity.

Successful evidence/prepare/refresh commands register the final bundle in the checkout. See [Dashboard](Dashboard.md) for registration, linking, and feedback. A compatible viewer is external to this toolkit.

## One-command review preparation

For automatic capture/extraction baselines and integrated per-case rendering inspection, see [Evidence baselines](EvidenceBaselines.md). Existing explicit pins below remain supported.

```sh
Tools/Helix/bin/helix workbench prepare --spec review.json --out .helix/evidence/review-01
```

This offline command checks retained evidence and declared dependencies, invokes the existing `compare` implementation for each case, and packages the result using `workbench evidence`. Inspect the generated comparison files directly and use `workbench review-summary` for saved decisions. Case IDs label prepared comparisons. Extraction, Unity mapping, capture and evidence authoring stay in the CLI. No session, browser, Unity Editor or asset import is started.

The spec has this shape (replace the descriptive hash placeholders with actual lowercase 64-character SHA-256 values):

```json
{
  "schemaVersion": 1,
  "cases": [{
    "id": "status-icon",
    "reference": {
      "image": {"path": "capture/reference.png", "sha256": "IMAGE_HASH"},
      "receipt": {"path": "capture/receipt.json", "sha256": "RECEIPT_HASH"},
      "dependencies": [{"path": "source/icon.webp", "sha256": "CAPTURE_TIME_SOURCE_HASH"}]
    },
    "candidate": {
      "image": {"path": "unity/candidate.png", "sha256": "IMAGE_HASH"},
      "receipt": {"path": "unity/receipt.json", "sha256": "RECEIPT_HASH"},
      "dependencies": [{"path": "../Assets/Icon.png", "sha256": "CAPTURE_TIME_ASSET_HASH"}]
    },
    "reports": [{"path": "usage/sprite-usage.json", "sha256": "REPORT_HASH"}],
    "regions": {"path": "regions.json", "sha256": "REGIONS_HASH"}
  }]
}
```

`reports` and `regions` are optional. File paths **inside the spec are relative to the spec directory**, or absolute; the command's `--spec` and `--out` paths are project-relative. IDs must be unique lowercase letter/digit/hyphen slugs, starting with a letter or digit, at most 64 characters. A spec contains 1–20 cases; each file-pin list contains at most 100 entries. Receipts and reports must be JSON; images must be PNG with matching native dimensions. Existing regional-measurement rules apply. Original evidence and reports are copied without rewriting their contents, so embedded paths can still point to their original locations.

For each side, declare dependencies whose bytes affected that capture or extraction: relevant source assets/code, import metadata, scene/prefab/config files, and preparation specs as appropriate. Take their expected hashes from records retained **when that evidence was produced**, such as `ui-assets` provenance or `sprite-usage` asset/meta hashes. Do not hash today's source and present it as an old capture's baseline. If no baseline exists, use an empty dependency list: preparation reports freshness as unmeasured and blocks the bundle. This command does not infer dependency coverage or authenticate author-supplied baselines. Receipt hashes establish retained bytes; receipt semantics and the association to the chosen image remain the author's responsibility and are available for human inspection.

The command writes `freshness.json` with expected/observed hashes and per-case reasons. A mismatched hash is `changed`; an unreadable input is `unavailable`. Any changed, unavailable or unmeasured case blocks the entire bundle and returns exit code **2**, retaining the report. Refresh affected captures/extractions and their baselines, then rerun into a fresh directory. Invalid spec syntax/schema or an existing output directory returns exit code **1**. Successful preparation returns **0** and `status: ready`; ready means ready for human review, never accepted parity. Pixel differences do not change the exit code.

The output directory must not exist and its parent must exist. Inputs are retained in memory after hashing so comparison uses those same bytes. Checks describe each file at the time it was read, not a transactional repository snapshot; rerun after source changes. Dependencies are checked but are not copied into the bundle. Successful output contains `prepared/<case-id>/` (images, original receipts/reports, comparisons), `prepared/freshness.json`, `prepared/review-spec.json`, and `bundle/evidence.json`. Failed comparison or packaging can leave partial diagnostic files, but no completed review bundle. The root `freshness.json` is authoritative. The existing bundle byte/file/pixel budgets apply; split larger reviews into smaller specs. Preparation also checks the generated double-width side-by-side image against viewer limits before comparison.

## Portable review decisions

`helix-review-decisions` version 1 contains `project`, `exportedUtc`, and up to 250 version-2 decisions, bounded to 48 MiB. Each decision contains `caseId`, `element`, `reportPath`, reference/candidate/evidence SHA-256 hashes, `status` (`accepted`, `needs-work`, or `blocked`), `notes`, and `savedUtc`. Optional `dependencyManifest` records the original evidence scope and complete file descriptors. Identities are the case/element pair, not a generated report filename. Duplicate identities, invalid hashes, wrong projects, and inconsistent manifest fingerprints fail validation.

```sh
Tools/Helix/bin/helix workbench review-summary --decisions REVIEWS.json --evidence EVIDENCE.json
```

The summary validates both files and reports `accepted`, `needs-work`, `blocked`, `review-required`, `not-reviewed`, and `not-in-evidence`, with reasons and dependency changes. It does not modify decisions or assess current source freshness. Retained decisions always keep their original hashes; reusing a note is not accepting changed evidence.

The pure review, evidence-validation, revision-comparison, and summary contracts must agree with a consuming viewer. Browser-only viewers can mirror these modules (adjusting import extensions), but changes require coordinated protocol verification; the installer does not update an external viewer.

## Refresh a review revision

```sh
Tools/Helix/bin/helix workbench refresh \
  --spec REVIEW_SPEC.json \
  --decisions REVIEW_DECISIONS.json \
  --previous PREVIOUS_REVISION/bundle/evidence.json \
  --out NEW_REVISION_DIR
```

Supply the existing preparation spec (or an explicitly revised spec), an exported decision file, and the previous evidence bundle. Relative spec dependencies retain their normal spec-relative interpretation. The output parent must exist; the new directory must not exist and must be outside the previous evidence bundle's directory. Refresh calls the existing preparation/freshness flow; it never captures new images, starts Unity, updates baseline hashes, or silently re-pins changed dependencies. Stale declared inputs block preparation with exit code 2.

A successful revision contains `review/bundle/evidence.json`, byte-for-byte copied `review-decisions.json`, `summary.json`, and `refresh.json`. The last file links the previous bundle by SHA-256, records preparation provenance, and lists added, removed, and modified evidence paths. Blocked preparation retains the copied decisions and its freshness diagnostics in the new directory. Prior revision files and Helix's saved decisions are never rewritten.

Use `workbench review-summary` with the new bundle and copied decisions. Carried decisions retain their original status, notes, timestamps, and evidence hashes. The new bundle includes a hash-validated previous-evidence manifest outside its included-file fingerprint.

The CLI summary includes change reasons: reference/candidate capture changes, rendering report changes, and counts of modified/added/removed files. `refresh.json` provides the exact changed paths. Detailed reasons apply only when the saved decision's evidence hash matches the supplied previous manifest; older decisions still require review but explicitly report that detailed changes are unavailable. Current whole-bundle invalidation remains conservative: changing a supporting file can require review even when capture images are unchanged. Reasons describe changed bytes, not an inferred visual regression or automatically measured dependency impact.

Refresh retains previous generated report bytes in the review bundle when only preparation-owned metadata changed: the top-level `createdUtc` in version-1 preparation/render-inspection reports, or local output/input locations in generated comparison receipts. Comparison image/region hashes, dimensions, measurements, and difference-image provenance remain significant. Capture timestamps, dependency checks, source paths, unknown report formats, and arbitrary supporting JSON are not normalized. This preserves existing decision hashes without changing the decision format or migrating saved records. Newly generated reports and current freshness diagnostics remain under `review/prepared`, `review/inspections`, and `review/freshness.json`; `refresh.json.retainedReports` records each retained path and both its retained and generated SHA-256. The bundle intentionally contains the retained report's original timestamp and provenance.

## Generic revision comparison

```sh
Tools/Helix/bin/helix workbench compare-revisions \
  --previous PREVIOUS_EVIDENCE.json \
  --evidence CURRENT_EVIDENCE.json \
  --out NEW_CHANGE_REPORT.json
```

Both inputs are validated evidence bundles. The output file must not exist. This read-only comparison needs no game connection, scenario execution, saved decisions, or stable review targets. Refresh also writes `revision-changes.json` after metadata-only report retention, and returns its path as `comparison`.

Inspect the CLI revision report and its referenced original evidence. A report alone does not contain the images. No saved decisions are changed.

The shared `revision-comparison.ts` owns the version-2 `helix-revision-comparison` contract and comparison/import logic (used by the offline CLI):

- `previous` and `current`: SHA-256 fingerprints of each sorted included-file manifest, using the existing review fingerprint contract.
- `unchangedFiles` and `changes`: deterministic path-sorted additions, removals, and modifications. File moves are represented as removal plus addition; no object identity is inferred.
- Each change has `path`, `change`, `before`/`after` file descriptors (type, exact SHA-256, and PNG dimensions), and `fields`.
- JSON `fields` use escaped JSON Pointers, with explicit present/absent values. Arrays compare by index. Object property reordering and whitespace can change file bytes without changing field values. Added/removed JSON is shown as a root value; file type changes retain both descriptors.
- Value previews are limited to 2,000 characters and explicitly marked `truncated`; traversal below depth 32 uses a subtree preview. Full bytes remain in the bundles. Field details share a 2,000-entry / 8 MiB budget (including serialized field metadata and an indentation allowance). When a file reaches either budget, its remaining field details are omitted and `fieldDetailsLimited` explicitly identifies `field-count` or `field-bytes`; absence means its field enumeration completed. Every added, removed, or modified file and its descriptors remain in the report. Later files can still use any remaining detail budget. CLI results include `limitedFieldFiles`; report consumers must surface both report-level and per-file limits rather than treating omitted details as unchanged. Refresh still completes its receipt and review summary. The report import cap is 112 MiB, reserving space for paths from two valid 48 MiB bundles plus bounded field details and descriptor overhead; it is not the field-detail budget. Existing bundle byte/pixel limits apply independently to each input.

This is an exact evidence comparison, not a semantic renderer diagnosis or automatic parity verdict. Raw bundle comparison includes generation metadata; `workbench refresh` retains metadata-only equivalent reports before producing its report. Capture/source data and decision freshness rules are unchanged.


## Schema-aware revision summaries

Revision comparison now writes version 2, adding an optional `summary` to recognized JSON file changes. CLI comparison and refresh use the same adapters. Version-1 report imports are verified against the recomputed generic portion; version-2 imports also verify summary content. Reports retain schema summaries alongside generic JSON changes. Unknown formats or unsupported evidence versions show generic JSON changes without schema interpretation. Unsupported render-inspection versions are excluded from version-1 rendering/review-target consumers; malformed supported version-1 render reports still fail evidence validation.

Adapters are selected by exact `kind` and `schemaVersion: 1`, never by filename, game object name, or incidental fields:

- `helix-render-inspection`: capture hashes by reference/candidate, properties matched by name, observation basis, measured/unmeasured/not-applicable transitions, evidence gaps, and related render trace. Native-pixel bounds deltas require the same element/case identity, compatible coordinate spaces, and captured bounds on both revisions. Reordering rows does not create property changes.
- `helix-evidence-baseline`: evidence producer, image/receipt hashes, and dependency additions/removals/changes matched by declared path. These are recorded evidence changes, not a new filesystem freshness check.
- `helix-review-preparation`: preparation status and case status/reasons matched by declared case ID. Dependency-check details remain available in the generic diff.

Unversioned or ambiguous capture receipts stay generic. Missing/invalid adapter fields or duplicate property/dependency/case identities explicitly mark a summary unavailable instead of guessing a match. Summaries describe selected schema fields only; zero summary rows never establishes unchanged evidence or parity. Full file-level changes and generic field limits remain independent.

Summary rows have a separate shared budget of 1,000 entries per report, with 300-character labeled previews. A reached budget sets `summary.limited`; it cannot interrupt preparation or remove file changes. Unavailable summaries set `summary.unavailable`. Original data stays in the validated evidence bundles. No saved decision format, fingerprint, source-freshness rule, or game behavior changes.

Rendering observations are compared as typed absent, unmeasured, not-applicable, or measured values before display formatting. Measured values are quoted and prefixed with `Measured:` so literal `Unmeasured`, `Not applicable`, and `(absent)` text cannot masquerade as states. Evidence-basis changes remain separate. The report shape and saved-decision fingerprints are unchanged; regenerate previously exported version-2 reports whose rendered summaries differ under this correction before verifying them against the new summary output.

## Declared target review dependencies

Preparation cases can opt individual stable rendering targets into dependency-aware review:

```json
"reviewDependencies": [
  { "element": "primary-element", "reports": [0] },
  { "element": "secondary-element", "reports": [] }
]
```

`element` is the declared render-inspection ID, not a game object lookup. `reports` contains zero-based indices into that case's existing pinned `reports` array. Duplicate/unknown targets and duplicate/out-of-range indices fail preparation. A target without an entry retains whole-bundle freshness. Include a shared supporting report in every target that depends on it; the tools do not infer dependency coverage.

For opted-in targets, preparation writes a version-1 `reviewDependencies.paths` declaration into the rendering report, using exact bundle-relative evidence paths. It automatically includes the target report itself, both capture images and receipts, baseline records when present, comparison outputs, regions when present, that target's collected rendering JSON inputs, and a stable `review-inputs.json` snapshot of both sides' declared capture/source pins. Only the explicitly selected supporting reports are added. Shared capture/receipt/source-input changes therefore invalidate all dependent targets; a target-specific supporting report or rendering-input change need not invalidate other targets. Freshness checks still reject stale source pins during preparation—dependency-scoped review does not re-pin inputs or establish live source freshness.

Bundle import resolves every declared path against validated included evidence, requires both capture images, and rejects missing entries, duplicate paths, or unsupported declaration versions. The fingerprint uses the versioned `helix-target-evidence` domain, stable case/element identity, and the sorted path/type/SHA-256 dependency manifest. Changing the declaration also changes the included target-report hash. Declaration removal returns to whole-bundle hashing; adding/removing/changing scope requires review. Existing decisions are never silently migrated, and notes, statuses, and original hashes remain intact in export/import and refresh.

CLI `review-summary` includes `scope` and dependency paths for each current target. Changed scoped decisions report that target evidence or scope changed; they do not claim exact historical dependency changes when the old declaration is unavailable. The decision format and stable storage keys remain unchanged. Unsupported/legacy reports continue their existing conservative behavior.

Generated report timestamps and output paths still follow refresh's metadata-only report-retention rules. Running fresh preparation directly can regenerate report bytes; use `workbench refresh` when carrying decisions across revisions. Source dependency arrays remain author-declared; this feature does not discover per-object source-code dependencies or prove declaration completeness.

Successful `workbench prepare`, `refresh`, and `evidence` commands register their final bundle in the selected checkout’s `.helix/comparisons/` directory. Use `workbench comparisons` to inspect the registered evidence. Registration preserves the original bundle location and hash; preparation status is not live freshness or a parity verdict. Original evidence and decision exports remain available to CLI review workflows.

Link prepared evidence with `--item DASHBOARD_ID [--issue NUMBER]` on `prepare`, `refresh`, or `evidence`. Register old bundles with `workbench comparisons --evidence FILE --item ID`, or register existing dashboard bundle references with `workbench comparisons --from-report yes`. `workbench comparisons --item ID` lists their IDs; `workbench feedback --comparison ID --decisions REVIEWS_JSON` reads a portable review export without a mod backend.

### Precise decision freshness reasons

New stable review decisions retain `dependencyManifest: { version: 1, scope, files }`, with each dependency's path, type, and SHA-256. The scope is `declared-target` or `whole-bundle`. Saving a new decision snapshots the current dependencies; imports and refresh preserve the original manifest and notes. Existing decisions remain readable without manufacturing historical dependencies.

`workbench review-summary` identifies scope changes and emits reasons plus `dependencyChanges` with before/after file descriptors (`null` for an absent side). Records without a saved manifest cannot provide exact historical paths unless older revision information is available. A manifest is validated against the saved evidence fingerprint when read, imported, or saved; mismatches fail without overwriting the decision. Dependency changes indicate evidence changes, not automatic visual parity or semantic causes. No game-specific identifiers or behavior participate in this logic.

## Unity project selection and Desktop contract

Run commands inside the Unity repo or supply `--project-root DIR`. The mod-owned saved connection is retired. Child processes retain the selected checkout and its isolated session state.

```sh
Tools/Helix/bin/helix unity-connection --project-root /absolute/path/to/unity-repo
```

This command inspects the selected local checkout; it does not use a mod connection or account KV. The retired mod endpoints are no longer part of the CLI contract.

For historical feedback, supply a portable `helix-review-decisions` export to `workbench feedback` or `workbench review-summary`. Both accept version-2 stable decisions and version-1 report-path decisions inside the version-1 export envelope. Legacy records retain their original identity, notes, timestamps and hashes; they do not silently become stable-case approvals. Changed bundles require review, and absent targets remain visible as `not-in-evidence`. Legacy exports can be summarized offline; `refresh` still requires stable version-2 decisions.

Local draft review files and account KV are historical storage, not a live feedback service. Preserve those stores and any existing exports. To recover unexported records, copy their original decision objects into a project-scoped `helix-review-decisions` envelope (`version: 1`, `project`, `exportedUtc`, `decisions`) and validate it with `review-summary`. Do not rewrite the original stores. The CLI does not fetch account KV automatically.

## Grouped AI Kit journeys

Version 2 of `Tools/Helix/acceptance/aikit.json` adds required `journeys`, a checkout-relative JSON path, alongside `instructions` and `manualCases`. Version 1 remains supported for consumers without authored journeys. Game checks uses the same planner as `helix aikit-checks plan|run`; `--journey ID` selects a branch suite, while `--item`/`--case` retains exact check selection. Journey and item/case selection are mutually exclusive.

The journey document has `{ version: 1, project, journeys }`. Each journey declares `id`, `title`, `setup`, `resources`, and `branches`. Resources are `{ path, pointer }` references into existing JSON fixture/scenario catalogs. Their selected definitions are hashed in the preview; they are discovery references, never capture-time input baselines. A branch declares `id`, `title`, `reset`, nonempty `parameters`, ordered `checkpoints`, and `checks`. A checkpoint has `id`, `action`, nonempty `evidence` (image/video/audio/observations), and nonempty `focus` (regions/events/state observations). Check bindings are `{ item, caseId, criteria, checkpoints }` and refer to existing primary acceptance cases. No new case or verdict is created.

Every primary check, including a manual exception, must be mapped. Missing/stale checks or uncovered criteria, unknown checkpoints, duplicate IDs, invalid paths and missing resource selections fail planning. One check may span several branches or journeys; all its existing setup/criteria remain mandatory. An individual journey can therefore contribute partial evidence only. Plans explicitly list unselected required branches, and agents must not record matched until all required branch/criterion observations have current evidence. Selecting a case retains branch setup/checkpoints, but does not expand its result obligations to unrelated checks.

Plans distinguish reuse, review, investigate, recover, and capture per viewport from authoritative acceptance freshness and evidence availability. Review means inspect retained coverage and capture only missing observations; it is not acceptance. Recipe gates remain visible. Unknown reference freshness cannot grant reuse. Retained artifacts are indexed once with independent consumer freshness, and each existing case retains its own immutable result, criteria hash, input pins, observations and human decision requirements. Region and clip-relative indexes point into hash-pinned originals; they never replace source media or receipts. Missing media stays recoverable context, not verified evidence.

The request includes mapped supplemental regressions and latest catalog finding revisions without changing historical records. Resolved findings and approved deviations remain context rather than implied acceptance. Plan tokens include journey/resource definitions and finding revisions. Changed previews require replanning. Submission retains the existing transport admission and idempotency rules; the planner never starts Unity, captures, submits automatically, or creates a second status store.

Use `helix evidence-report` to browse journeys and shared evidence from the repo. Use `aikit-checks plan` to inspect grouped execution details; the Workbench mod and copied frontend integrations are removed.

The PM message contains a compact dispatch summary and hashes of `details-journey-<id>.json` packets. Submission materializes these immutable request details through the existing PM transport. Each packet contains only that suite's checks, obligations, fixture locators, findings and retained evidence index. `details-history.json` preserves shared/tooling findings and deferred work. Read one suite at a time; these files are request snapshots, not result/status stores. Preview is read-only apart from existing evidence-cache materialization.

CLI `aikit-checks plan` defaults to a compact JSON summary with the exact submission token, journey/branch/check counts, work dispositions and detail-file hashes. Add `--format full` to inspect the complete criteria/checkpoints and request snapshots. The display format does not change the selection or submission token.

## Repository report updates

After integrating imported run records and their original artifacts, run `helix evidence-report`. It reads the run history directly, links runs to journey checks, and deduplicates shared originals by path and hash. Artifact availability is reported separately from recorded outcomes; neither grants a new QA sign-off. Portable QA snapshots remain linked through the reconciliation manifest. New or revised unresolved findings appear as needing triage even when not linked to a catalog entry. Resolved findings and approved deviations remain in their original history files. Update the configured existing status document for delivery notes and next steps; regeneration preserves it.
