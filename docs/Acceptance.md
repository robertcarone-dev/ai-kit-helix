# Port acceptance contracts

The shared toolkit owns `acceptance-format.ts` and `acceptance.ts`. Consumers own `Tools/Helix/acceptance/scope.json`, referenced screen definitions, semantic recipe mappings, implementation references, and immutable run/decision records. Shared code contains no game selectors or feature inventory.

## Commands

```sh
Tools/Helix/bin/helix acceptance validate
Tools/Helix/bin/helix acceptance status
Tools/Helix/bin/helix acceptance status --reference current-reference.json
Tools/Helix/bin/helix acceptance record-run --spec run.json
Tools/Helix/bin/helix acceptance review --spec human-decision.json --reference current-reference.json
Tools/Helix/bin/helix acceptance publish --reference current-reference.json
```

`validate` checks authored scope, identities, viewport references and dependency paths. `status` derives required counts and case-level implementation, verification, review, freshness and media availability. `publish` projects catalog-owned items into the legacy dashboard file, preserving other rows, and writes `.helix/acceptance-status.json`. Read the generated files directly; use `evidence-report` for the current repository report. Publishing does not run a game, capture evidence, or grant acceptance.

`current-reference.json` has `version: 1`, `project`, `variant`, `identity` (SHA-256 of the capture producer's declared reference identity manifest), and `observedUtc`. It is an explicit caller-supplied observation, not a live Helix check. Recompute it from the current declared reference inputs; do not copy the old run's identity and call it current. For the supplied Workbench, use `referenceObservation(root, referenceRoot, project)` from `Tools/Helix/toolkit/src/acceptance-backend.ts`, which hashes the paths declared by `Tools/Helix/acceptance/reference-inputs.json`. Retain matching observations before and after reference capture and use that identity in the run. The served runtime receipt is a separate identity domain: hashing its `identity` object will not match the Workbench source observation. Do not assign a newly computed source identity to older media that lacks this proof. Source-file hashes alone do not prove what the browser served; preserve runtime identity in capture receipts. Reports retain its observation time. Reference-based cases require it for current freshness. Product-based cases instead use their declared specification and candidate input hashes. Candidate inputs and local evidence hashes are checked on every status read.

## Version 1 records

All contracts reject unknown/missing fields and duplicate IDs. The exported TypeScript types and readers in `acceptance-format.ts` define the exact format. Paths in authored definitions, pins and media are portable checkout-relative paths; references escaping the selected checkout through symlinks are rejected.

- Scope: project/variant, draft or approved coverage, rationale, screen-definition paths relative to the acceptance directory, exclusions, and named viewport dimensions/safe-area profiles.
- Screen: stable ID/title, implementation state and references, cases. Each case has required flag, viewports, evidence dimension, reference or product basis, explicit criteria, candidate dependencies, stable discrepancy IDs and semantic recipes with setup/event anchors/blockers.
- Run: stable ID and full case identity, criteria digest returned by `status`, capture timestamp, declared reference digest/description, candidate revision and input pins, exact capture profile/setup/anchors, observations, outcome and recoverable media pins. Required evidence types are images for appearance, video for motion, observations for behavior, and audio for listening. Reference-backed cases require both sides; product-backed cases require the candidate.
- Decision: full case identity, run ID and canonical run digest, explicit reviewer label, status/notes/time, and the prior decision ID in `supersedes` (null for the first decision). CLI imports accept only `self-reported` identity. A host-verified identity requires a future authenticated host bridge; it cannot be asserted by JSON import.

`recordHash` computes SHA-256 over recursively key-sorted JSON, preserving array order. `criteriaHash` includes the case definition, project/variant/item identity and viewport profile. This allows unrelated file changes without invalidating acceptance while changes to relevant requirements invalidate it.

Runs are written to `runs/<id>.json`; decisions to `decisions/<id>.json`. Both are immutable, atomically published under an exclusive store lock. Exact retries are idempotent. A review must address the latest run and expected prior decision. Divergent, disconnected or cyclic decision histories fail explicitly. An interrupted writer can leave a lock; investigate its owner before removing it. Version control publishes these records to collaborators; saving a local decision does not push it anywhere.

## Acceptance rules

An accepted case requires approved scope, implemented screen, matching observations, applicable human approval, current declared dependencies/reference, available hash-verified required evidence, no recipe blocker and no unresolved linked discrepancy. Zero required cases means unconfigured. Missing evidence and unknown freshness never become passes. A new run makes an earlier decision historical until reviewed. Old accepted decisions remain visible after source or criteria changes.

A resolved discrepancy grants no case acceptance. Version 1 conservatively blocks `accepted-deviation` discrepancy dispositions: criterion-scoped deviation approval and its migration are not implemented yet. Do not delete the link to manufacture acceptance. Media hashes prove byte identity, not that a clip depicts the correct event; human review remains necessary.

## Current integration boundary

The Workbench mod and progress UI have been removed. Use the configured evidence index, and the CLI evidence and review commands. Shared reference identity, hash validation, decision storage and verification helpers remain in `toolkit/src`; no mod endpoint is required for these CLI workflows. Review exports retain their original self-reported identities and immutable histories.

Large media remain outside version control. Each artifact requires a recovery locator and hash; recovery uses the consumer's existing attachment workflow. This module verifies restored local bytes but does not download attachments. A clean-checkout recovery demonstration remains a live pilot requirement.

Optional consumer-owned `evidence-links.json` retains historical case sources and notes. Status exposes these links and resolved discrepancy references separately from current runs and approval. Historical links never grant acceptance. Acceptance publication holds its checkout-local lock while deriving and writing the snapshot; whole-dashboard publication still follows the project’s single-publisher ownership rule.

## Execution adapters and assessments (1.5.0)

Consumers own optional `acceptance/adapters.json` routes and their capture scripts. The installed `src/case-adapters.ts` validates the route contract; `acceptance adapters` exposes the authored routes. Use `acceptance adapters` to list routes and `acceptance plan --item ID --case ID --viewport ID --out .aikit/scratch/NEW_RUN` to inspect them. Planning does not launch capture. `acceptance run` takes the same options plus explicit `--mode retained` or `--mode capture`. Retained mode checks historical pins and records recovery diagnostics without creating acceptance runs. Capture mode requires an isolated checkout and delegates lifecycle cleanup to the configured runner. Never use an active lane owned by another task.

`acceptance assess --spec assessment.json` records immutable agent/automation findings pinned to an existing run's canonical hash, with criterion observations, evidence hashes and discrepancy IDs. Findings do not rewrite captures or constitute human review. A matched assessment cannot promote an unmeasured run to accepted; a mismatch or unavailable assessment evidence blocks acceptance. Case summary counts describe captured or assessed cases, not individual criteria or current game completion. Source freshness remains a separate gate.

Preparation recipes may declare bounded `prepareReceipts` barriers to await a consumer-owned atomic JSON marker across Unity domain reloads. The runner checks the marker before advancing to capture and preserves normal cleanup on failure or interruption. Optional Three.js scenes may declare `three.active`; general inspection skips inactive scenes while dedicated scene capture retains its readiness requirements. These capabilities do not authorize launching Unity in a shared checkout.

## Direct checks and retained records

A feature owns acceptance cases. A case owns its criteria, inputs and setup; a run owns measured observations and declared artifacts. Automatic cases complete from a current passing run. Judgment cases still need an explicit review. Parent implementation requirements apply only when completing the feature. Assessments are optional independent analysis, not a second mandatory copy of an automated verdict.

`Tools/Helix/resolutions/automation.json` version 2 links each workflow directly to an existing catalog `item` and acceptance `caseId`. Supply `id`, `review` (`automated` or `human`), and `unity` (`scene` and `preflightScripts`). Viewports come from the case. Optional `finding` links a real issue with a resolution definition; missing verification does not require a discrepancy. Version 1 remains readable for existing projects. Both assertion adapters and paired matrix capture adapters use the same worker; unmeasured collection is shown as evidence ready for review, never as a pass.

Product assertion adapters can call `runMatrix({ ...options, candidateOnly: true })` with cases containing scenario and viewport but no paired UI/scene specs. This preserves preflight, preparation, capture, restoration and ownership checks while skipping browser capture and comparison. The adapter must measure every criterion; successful lifecycle execution alone is not verification. Keep paired captures for reference comparison.

New CLI imports retain only declared artifacts and one authoritative run record. Diagnostic plans, logs, generated reports and duplicate receipts stay in ignored execution scratch. Declare compact observations and only media needed to judge the case; do not declare an entire debug capture tree. Existing assessments and reviews are preserved unchanged.

To consolidate historical loose files, preview `helix evidence archive --directory Tools/Helix/evidence/verification`, then add `--apply true`. This creates a standard ZIP plus `Tools/Helix/evidence/archives.json`, verifies every original hash, publishes recovery, then removes originals. It also supports directories under `Documentation/Verification/Evidence/`. Original logical paths and immutable run/review hashes remain unchanged. CLI evidence readers resolve archived files through an ignored `.helix/evidence-cache`; missing or corrupted archives cannot grant completion. Retain the ZIP and index together in the project's artifact storage/version control. `helix evidence recover --path ORIGINAL --out NEW_FILE` recovers an indexed file without overwriting the destination. Archive consolidation is explicit, blocked during active jobs, and checks for concurrent evidence changes.

### Case-specific JSON dependencies

Cases may add `dependencySelections: [{ path, selectors: [{ pointer, where? }] }]` for declared JSON dependencies. Pointers use JSON Pointer syntax. Optional `where` selects array records whose fields match the supplied strings; matching records are hashed independent of their ordering. Include shared settings the case actually consumes as well as its scenario/routes. All unselected dependencies retain whole-file hashing.

Captures record the selectors alongside each input hash. Freshness, import, retained findings, and isolated verification compare that recorded contract. Changing a selection changes case criteria; historical captures are never rewritten or promoted. Missing selections invalidate evidence, and malformed configuration fails clearly.

Feature Overview exposes primary scenarios and their configured verification workflow. The existing isolated job runner handles execution, blockers, and results. Scenarios without runnable setup remain explicitly unconfigured; they are never treated as passing.

## Catalog batches

A project may declare `acceptance/execution.json` as `{version:1, project, unity:{scene, preflightScripts}}`. Every existing capture adapter then gains a discoverable human-policy workflow; explicit automation entries retain their authored review policy. Only viewports with routes are exposed. Supplemental coverage connects existing evidence to primary cases without copying verdicts or changing completion.

`helix catalog-batch plan [--folder ID] [--discipline dev|ta] [--mode ready|changed]` lists primary coverage, direct-adapter gaps, supporting collection and setup blockers. `catalog-batch run` runs ready collections; `catalog-batch status` reports durable progress; `catalog-batch resume --id ID` replans unfinished work against current inputs. Plans accept `--reference` observations; execution observes the local reference. Shared matrix captures are collected once per fixture/viewport; node assertions remain case-specific. Cases with current evidence are skipped even if they still need human evaluation. Changed mode selects existing captures whose inputs/evidence are no longer current.

Batches group compatible cases into one owned Editor session, preserve source/setup tokens, import only declared artifacts and authoritative records, and close before completion. An uncertain capture stops the group and retains execution locks; resume cannot take over another worker or bypass unreconciled Unity state. Missing adapters remain coverage gaps, unmeasured collection remains review work, and neither counts as a failed game feature or automatic completion. After successful cleanup, batch artifacts are consolidated into a verified ZIP using the shared evidence archive index; original run paths/hashes stay unchanged. Batch journals stay under ignored `.helix/catalog-batches`.

Markdown dependencies use `selectors: [{ heading: "## Exact section heading" }]` on a declared `.md` path. A selection includes its subsections through the next heading of equal or higher level, ignoring headings inside code fences. Missing or duplicate headings invalidate the selection. JSON and Markdown selectors cannot be mixed. Scope every shared specification dependency explicitly; do not rewrite historical capture hashes when migrating.

Feature Overview also exposes supporting capture workflows under their primary scenario, including workflows covering only some viewports. These retain their original case identity and review requirements. Running supporting evidence never completes the parent scenario. Missing adapters display the authored setup blockers.

### Configuration-only consolidation

`helix acceptance consolidate` previews lossless adapter deduplication; `--apply true` writes the version 2 manifest. It never starts Unity, captures evidence, or changes acceptance records. Shared `captures` and `evidence` dictionaries are keyed by content hash; routes reference those definitions and group identical `viewports`. The loader expands the same version 1 route contract for existing callers. Repeating consolidation is a no-op. Malformed references fail at the owning boundary.

Version 2 automation workflows may omit `unity` when `acceptance/execution.json` supplies the common setup. Explicit workflow setup remains an override. Neither this default nor consolidation grants completion.

Historical runs with whole-file input pins can be retained across an explicitly reviewed format-only migration with `acceptance/input-migrations.json`: `{version:1,migrations:[{reason,runs:[{id,sha256}],changes:[{path,before,after}]}]}`. Each run hash and exact old/new input hash must match; changed run records, selected dependencies, and later edits are not covered. This receipt is a review assertion, not an automated proof of semantic equivalence. It affects historical status only, never fresh capture import or criteria/review gates. Do not use it for gameplay changes. Preserve original runs; document the comparison that establishes equivalence.

## Grouped journey coverage

Projects using AI Kit configuration version 2 require journey coverage in addition to the existing case gates. Existing run and decision histories remain immutable and readable; a legacy whole-case match does not prove the new branch obligations.

The plan exposes `journeyCoverage` for each case/viewport and `coverage` on each journey binding. Each obligation identifies `journey`, `branch`, `parameter`, `checkpoint`, `definitionSha256`, required `criteria` and evidence kinds. The digest pins the case's observation/prerequisite definitions, setup, reset, exact parameter and selected resource contents. Changed definitions invalidate affected coverage.

Run records may include a `journeyCoverage` array. Copy the five identity/digest fields and add `observations` (criterion/result/note, scoped to that parameter/checkpoint) and `artifacts` (paths referencing hash-pinned artifacts in the same run). Notes should locate the screen region or event window in shared originals. Each observation checkpoint must have its own matching observations and required evidence kinds (both sides for reference comparisons). A check bound to multiple checkpoints must declare `checkpointCriteria: [{checkpoint, criteria}]`, covering every bound checkpoint and every bound criterion. Compound legacy criteria may occur at multiple checkpoints; each observation judges the clause applicable at that checkpoint, and all those checkpoints remain mandatory. An observation at one checkpoint never completes another. Single-checkpoint bindings assign their criteria to that checkpoint. Existing reference-side, input, viewport, review and discrepancy gates still apply. The importer rejects `matched` runs with incomplete or outdated journey coverage.

Save partial progress as an `unmeasured` cumulative run. When extending it, retain still-current coverage and original artifact pins in the next immutable run; do not copy stale coverage as a new observation. Status and planning derive progress from the latest run, never a separate mutable tracker. Complete/current/available obligations are labeled reusable, so AI Kit executes only missing observations and the prerequisites needed to reach them. Supporting captures retain their source case, capture owner, run digest, freshness and availability; they are review inputs, never automatic primary passes.

Checkpoint `prerequisites` are optional explicit lists of earlier checkpoint IDs. Check bindings name observation checkpoints. Planning follows prerequisite edges transitively and excludes unrelated later actions; array order alone does not imply a prerequisite.

Parameter labels describe one executable variant or one intentional ordered sequence. Enumerate distinct outcomes individually; enumerate interacting axes as explicit tuples. A bundled prose label is not a substitute for variant coverage. Each parameter/checkpoint requires its own receipt even when it shares original media with others. Adding a variant or editing an unrelated later checkpoint preserves existing unaffected coverage. Missing supporting media with recovery locators is recovery work before any recapture decision.

A check may declare `parameters` as a nonempty subset of its branch variants; omission means all branch variants apply. Scoped planning includes only variants needed by selected checks. Every branch variant must have at least one check owner.

AI Kit detail packets deduplicate coverage: each branch binding lists `requirements` once (`parameter`, `checkpoint`, `definitionSha256`) and per-viewport `coverage.reusable` indexes into that list. All other indexes remain open. Resolve criterion IDs from the binding’s `checkpointCriteria` (or `criteria` for a single checkpoint) and media kinds from the checkpoint. Full CLI previews retain expanded coverage. Supporting artifact references in packets resolve through the shared evidence index.

## Reconcile existing AI Kit QA without replay

`helix acceptance reconcile --spec PATH` imports a reviewed, immutable QA reconciliation into `Tools/Helix/acceptance/qa-reconciliations/`. It does not create captures, rewrite decisions, close discrepancies, contact AI Kit, or run gameplay. The latest reconciliation is consumed by CLI status/summary, repository reports, and grouped handoff planning. A new reconciliation must disposition every current primary case/viewport, including explicit gaps. Supplemental records remain unchanged.

Version 1 documents contain `id`, `project`, `reconciledUtc`, `reviewer`, and `bindings`. Each binding names `item`, `caseId`, `viewport`, `definitionSha256` (from `qaDefinition`), `coverage` (`full`, `partial`, `none`), `note`, `gaps`, and `sources` pins with exact AI Kit case IDs. Sources are portable exports of the original submitted QA fields, including case-result history, verdict, revision limitations and attachment hashes. Keep them in project-owned `qa-sources/`. A completed task is not a passing test: the latest submitted individual result must pass for full coverage. A failed aggregate report can still contain valid individual passes. A case added after the submitted verdict cannot grant acceptance.

Full coverage additionally requires an ancestral `testedRevision`, original product `inputs` from that revision, and explicit pinned `findings` dispositions. The importer checks those original bytes using Git. `qaInputs` includes declared runtime assets/configuration and implementation references, excluding Editor capture helpers. Capture-recipe changes alone do not revoke an unchanged product verdict. Optional `inputReviews` carry exact `path`, `before`, `after`, and `reason` for reviewed changes that do not alter the cited behavior; later edits invalidate that exception. Never repin old captures to current code or claim a new playtest from a source review.

Reconciliation is an explicit scope judgment, not title matching or a board-state synchronization. Map only the criteria and viewport that the recorded case actually proves. Preserve approved deviations and limits in `note`. Mark broader combinations, missing listening/device evidence, unavailable routes and unresolved failures as partial/none with specific `gaps`. Full QA approval is acceptance of that recorded reference/product scope, not a fresh reference capture. Reference media and source identity remain in the original QA reports. Existing capture freshness remains visible separately.

Status exposes `qa` provenance and exact remaining reasons on each mapped row. Complete, unchanged full QA coverage contributes to `accepted`; missing/tampered sources, changed product requirements/inputs/findings, a later mismatching capture, or a later request for changes prevent reuse. Original captures and their metadata remain intact. Grouped remaining plans omit accepted QA and attach hash-pinned source reports once for shared use. Partial QA routes to review of its explicit gaps rather than automatic recapture of every passed observation.

A source may set `context: true` when a broader report contains a failure in a different phase or criterion. It remains visible as related scope but cannot grant acceptance or classify this target as failed. Full coverage still requires non-context passing cases. Record the scope distinction explicitly in the binding note; never use context to hide a failure of the target requirement.

Status and CLI summary include `qaSummary`: distinct submitted QA case counts are deduplicated across requirements and viewports, while `requirements`, `accepted`, and `partiallySupported` count primary case/viewport obligations. Context-only citations do not inflate contributing QA counts. A passing case can support several requirements; a requirement can combine several passing cases and an unresolved edge. These denominators must not be compared as if each QA case were one complete requirement.

Review gaps against the exact authored criterion. Do not copy a feature-wide blocker onto unrelated phases. For example, a claim-color defect does not invalidate retained idle motion, and a layout defect does not invalidate measured entrance timing. Correct invented requirements or approved exceptions in the project-owned definition with its original decision citation, retain the previous reconciliation, then import a successor. Preserve all still-required portions and unresolved evidence limitations.

## Progress ownership

AI Kit is the source of truth for implementation and QA delivery. Repository reports display archived sign-offs, imported run evidence, and unresolved discrepancies or triage records. CLI acceptance counts remain technical coverage-audit counts, not game completion metrics. Historical audit records and CLI contracts remain intact.

## Portable QA snapshots and local AI Kit numbers

An AI Kit key such as `AK-239` is a label local to its originating board. Never resolve a key from imported evidence against the receiving checkout's board, associate it with same-numbered local work, or use it as a shared repository identity.

New exports use an envelope created by `exportQaSource` in `src/qa-source.ts`: `{ format: "helix-qa-source", version: 1, origin: { kind: "aikit-local-export", archiveId: "<UUID>", label: "<original export provenance>" }, record: <original submitted QA record> }`. Assign the archive UUID once per originating export collection; it identifies the archive, not an AI Kit server or a live board. Save the serialized envelope under `qa-sources/sha256-<SHA256-of-file-bytes>.json` and pin those same bytes in the reconciliation. Preserve the original record and local key inside the envelope.

Each evaluated report carries `sourceId: "sha256:<pinned-file-hash>"` and `origin`. Case identities and summary deduplication use sourceId plus case number; AK labels do not join evidence. Grouped handoffs carry these identities and instruct consumers to read the attached snapshots without local-board lookups. Distinct snapshots stay distinct even when their local labels match. Legacy raw snapshots remain readable with their pinned content identity and unknown origin; they are never resolved through AI Kit.

Migrate by adding content-addressed envelopes and a successor reconciliation, retaining old immutable manifests and files for history. Reading portable QA requires neither AI Kit installation nor the original machine. Absolute attachment/recording paths inside an archived report remain historical provenance, not portable media: only separately retained, registered files are available for media inspection. The repository report makes no live board or team-wide progress claim.

## Repository report (preferred reading surface)

Configure `Tools/Helix/report.json` in the consuming project with `version: 1`, `title`, `scope`, `status` (the existing status document), and `output` (a repository-relative filename stem, without `.md` or `.html`). The generator requires that status page to exist and refuses to overwrite it or unmarked reports. It creates only the configured evidence index, with links relative to its location. Missing configuration is an error; it never invents a new status page or root report. `helix evidence-report` is the canonical command; `porting-report` remains an alias using the same configuration.

```json
{
  "version": 1,
  "title": "Technical art evidence index",
  "scope": "TA presentation and visual comparison; DEV implementation is separately owned. Shared behavior evidence is dependency context, not DEV completion.",
  "status": "Documentation/Status/helix-parity.md",
  "output": "Documentation/Verification/helix-ta-evidence"
}
```

The paths above are an example, not a toolkit default. Run `./Tools/Helix/bin/helix evidence-report` after authorized integration. The command reads portable QA snapshots, imported runs, journey mappings and discrepancy records without a live board or gameplay. Markdown retains media recovery locators; the local HTML index links originals or recovered archive-cache files. Ignored cache files and external media are not portable merely because they are available locally.

Agents maintain the configured existing status document for current delivery notes, agreed next steps and evidence links. Regeneration never overwrites notes or unmarked hand-authored report files. After integrating QA, preserve the original scoped verdict in a portable snapshot, update mappings and discrepancy records, run `acceptance validate`, then regenerate the report. Commit notes, reports and supporting evidence together when authorized. Historical AK labels are not shared task identifiers. Recorded delivery/QA states are snapshots, not live team-wide status. Do not infer completion from missing findings or absent coverage.

The Helix mod is retired. Use the repository report for reading and agent handoffs; keep AI Kit responsible for execution and QA decisions.


## Workbench removal

The Helix mod and all `cli/workbench` UI components are retired and no longer installed. Installer updates remove only previously managed UI payload. Repository reports, QA snapshots, decisions and discrepancies remain project-owned and are preserved. Use cwd discovery or `--project-root DIR`; the old `--helix-project` mod connection is retired. `workbench feedback` now requires `--decisions REVIEWS_JSON`, using a portable review export rather than querying the deleted mod. Existing `.helix/porting-reviews` and account KV history are not deleted. Other `workbench` CLI evidence/scenario commands retain their names and formats for compatibility.
