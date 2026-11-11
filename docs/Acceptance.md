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

`validate` checks authored scope, identities, viewport references and dependency paths. `status` derives required counts and case-level implementation, verification, review, freshness and media availability. `publish` projects catalog-owned items into the existing Workbench dashboard, preserving other rows, and writes `.helix/acceptance-status.json`. Reload the Workbench report to see the snapshot. Publishing does not run a game, capture evidence, or grant acceptance.

`current-reference.json` has `version: 1`, `project`, `variant`, `identity` (SHA-256 of the capture producer's declared reference identity manifest), and `observedUtc`. It is an explicit caller-supplied observation, not a live Helix check. Recompute it from the current declared reference inputs; do not copy the old run's identity and call it current. Source-file hashes alone do not prove what the browser served; preserve runtime identity in capture receipts. Reports retain its observation time. Reference-based cases require it for current freshness. Product-based cases instead use their declared specification and candidate input hashes. Candidate inputs and local evidence hashes are checked on every status read.

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

The shared `workbench/` module adds a live case matrix, registered media viewing and direct decision saves through the existing mod backend. See `cli/workbench/README.md` upstream, installed as `Tools/Helix/toolkit/workbench/README.md`. Review saves bind the exact run digest and prior decision and acknowledge durable storage before reporting success. The UI labels reviewer identity as self-reported. Media playback can start both clips together, but event alignment must still be assessed from their recorded anchors.

The backend recomputes a consumer-declared Helix draft source manifest on each request; candidate files and artifact bytes are checked by the same shared status/writer code as the CLI. This is a declared-source freshness check, not proof that the browser loaded those bytes. Automatic publication after later source changes and historical review migration remain outside this integration. Existing element-level feedback stays separate until explicitly mapped; no legacy `ported` value becomes human approval.

Large media remain outside version control. Each artifact requires a recovery locator and hash; recovery uses the consumer's existing attachment workflow. This module verifies restored local bytes but does not download attachments. A clean-checkout recovery demonstration remains a live pilot requirement.

Optional consumer-owned `evidence-links.json` retains historical case sources and notes. Status exposes these links and resolved discrepancy references separately from current runs and approval. Historical links never grant acceptance. Acceptance publication holds its checkout-local lock while deriving and writing the snapshot; whole-dashboard publication still follows the project’s single-publisher ownership rule.

## Execution adapters and assessments (1.5.0)

Consumers own optional `acceptance/adapters.json` routes and their capture scripts. See `Tools/Helix/toolkit/workbench/README.md` for the exact route contract. Use `acceptance adapters` to list routes and `acceptance plan --item ID --case ID --viewport ID --out .aikit/scratch/NEW_RUN` to inspect them. Planning does not launch capture. `acceptance run` takes the same options plus explicit `--mode retained` or `--mode capture`. Retained mode checks historical pins and records recovery diagnostics without creating acceptance runs. Capture mode requires an isolated checkout and delegates lifecycle cleanup to the configured runner. Never use an active lane owned by another task.

`acceptance assess --spec assessment.json` records immutable agent/automation findings pinned to an existing run's canonical hash, with criterion observations, evidence hashes and discrepancy IDs. Findings do not rewrite captures or constitute human review. A matched assessment cannot promote an unmeasured run to accepted; a mismatch or unavailable assessment evidence blocks acceptance. Case summary counts describe captured or assessed cases, not individual criteria or current game completion. Source freshness remains a separate gate.

Preparation recipes may declare bounded `prepareReceipts` barriers to await a consumer-owned atomic JSON marker across Unity domain reloads. The runner checks the marker before advancing to capture and preserves normal cleanup on failure or interruption. Optional Three.js scenes may declare `three.active`; general inspection skips inactive scenes while dedicated scene capture retains its readiness requirements. These capabilities do not authorize launching Unity in a shared checkout.

## Direct checks and retained records

A feature owns acceptance cases. A case owns its criteria, inputs and setup; a run owns measured observations and declared artifacts. Automatic cases complete from a current passing run. Judgment cases still need an explicit review. Parent implementation requirements apply only when completing the feature. Assessments are optional independent analysis, not a second mandatory copy of an automated verdict.

`Tools/Helix/resolutions/automation.json` version 2 links each workflow directly to an existing catalog `item` and acceptance `caseId`. Supply `id`, `review` (`automated` or `human`), and `unity` (`scene` and `preflightScripts`). Viewports come from the case. Optional `finding` links a real issue with a resolution definition; missing verification does not require a discrepancy. Version 1 remains readable for existing projects. Workbench exposes Run checks in case details. Both assertion adapters and paired matrix capture adapters use the same worker; unmeasured collection is shown as evidence ready for review, never as a pass.

Product assertion adapters can call `runMatrix({ ...options, candidateOnly: true })` with cases containing scenario and viewport but no paired UI/scene specs. This preserves preflight, preparation, capture, restoration and ownership checks while skipping browser capture and comparison. The adapter must measure every criterion; successful lifecycle execution alone is not verification. Keep paired captures for reference comparison.

New Workbench imports retain only declared artifacts and one authoritative run record. Diagnostic plans, logs, generated reports and duplicate receipts stay in ignored execution scratch. Declare compact observations and only media needed to judge the case; do not declare an entire debug capture tree. Existing assessments and reviews are preserved unchanged.

To consolidate historical loose files, preview `helix evidence archive --directory Tools/Helix/evidence/verification`, then add `--apply true`. This creates a standard ZIP plus `Tools/Helix/evidence/archives.json`, verifies every original hash, publishes recovery, then removes originals. It also supports directories under `Documentation/Verification/Evidence/`. Original logical paths and immutable run/review hashes remain unchanged. CLI status and Workbench media resolve archived files through an ignored `.helix/evidence-cache`; missing or corrupted archives cannot grant completion. Retain the ZIP and index together in the project's artifact storage/version control. `helix evidence recover --path ORIGINAL --out NEW_FILE` recovers an indexed file without overwriting the destination. Archive consolidation is explicit, blocked during active jobs, and checks for concurrent evidence changes.

### Case-specific JSON dependencies

Cases may add `dependencySelections: [{ path, selectors: [{ pointer, where? }] }]` for declared JSON dependencies. Pointers use JSON Pointer syntax. Optional `where` selects array records whose fields match the supplied strings; matching records are hashed independent of their ordering. Include shared settings the case actually consumes as well as its scenario/routes. All unselected dependencies retain whole-file hashing.

Captures record the selectors alongside each input hash. Freshness, import, retained findings, and isolated verification compare that recorded contract. Changing a selection changes case criteria; historical captures are never rewritten or promoted. Missing selections invalidate evidence, and malformed configuration fails clearly.

Feature Overview exposes primary scenarios and their configured verification workflow. The existing isolated job runner handles execution, blockers, and results. Scenarios without runnable setup remain explicitly unconfigured; they are never treated as passing.

## Catalog batches

A project may declare `acceptance/execution.json` as `{version:1, project, unity:{scene, preflightScripts}}`. Every existing capture adapter then gains a discoverable human-policy workflow; explicit automation entries retain their authored review policy. Only viewports with routes are exposed. Supplemental coverage connects existing evidence to primary cases without copying verdicts or changing completion.

`helix catalog-batch plan [--folder ID] [--discipline dev|ta] [--mode ready|changed]` lists primary coverage, direct-adapter gaps, supporting collection and setup blockers. `catalog-batch run` runs ready collections; `catalog-batch status` reports durable progress; `catalog-batch resume --id ID` replans unfinished work against current inputs. Plans accept `--reference` observations; execution observes the local reference. Workbench provides the same Game and inline folder actions. Shared matrix captures are collected once per fixture/viewport; node assertions remain case-specific. Cases with current evidence are skipped even if they still need human evaluation. Changed mode selects existing captures whose inputs/evidence are no longer current.

Batches group compatible cases into one owned Editor session, preserve source/setup tokens, import only declared artifacts and authoritative records, and close before completion. An uncertain capture stops the group and retains execution locks; resume cannot take over another worker or bypass unreconciled Unity state. Missing adapters remain coverage gaps, unmeasured collection remains review work, and neither counts as a failed game feature or automatic completion. After successful cleanup, batch artifacts are consolidated into a verified ZIP using the shared evidence archive index; original run paths/hashes stay unchanged. Batch journals stay under ignored `.helix/catalog-batches`.

Markdown dependencies use `selectors: [{ heading: "## Exact section heading" }]` on a declared `.md` path. A selection includes its subsections through the next heading of equal or higher level, ignoring headings inside code fences. Missing or duplicate headings invalidate the selection. JSON and Markdown selectors cannot be mixed. Scope every shared specification dependency explicitly; do not rewrite historical capture hashes when migrating.

Feature Overview also exposes supporting capture workflows under their primary scenario, including workflows covering only some viewports. These retain their original case identity and review requirements. Running supporting evidence never completes the parent scenario. Missing adapters display the authored setup blockers.

### Configuration-only consolidation

`helix acceptance consolidate` previews lossless adapter deduplication; `--apply true` writes the version 2 manifest. It never starts Unity, captures evidence, or changes acceptance records. Shared `captures` and `evidence` dictionaries are keyed by content hash; routes reference those definitions and group identical `viewports`. The loader expands the same version 1 route contract for existing callers. Repeating consolidation is a no-op. Malformed references fail at the owning boundary.

Version 2 automation workflows may omit `unity` when `acceptance/execution.json` supplies the common setup. Explicit workflow setup remains an override. Neither this default nor consolidation grants completion.

Historical runs with whole-file input pins can be retained across an explicitly reviewed format-only migration with `acceptance/input-migrations.json`: `{version:1,migrations:[{reason,runs:[{id,sha256}],changes:[{path,before,after}]}]}`. Each run hash and exact old/new input hash must match; changed run records, selected dependencies, and later edits are not covered. This receipt is a review assertion, not an automated proof of semantic equivalence. It affects historical status only, never fresh capture import or criteria/review gates. Do not use it for gameplay changes. Preserve original runs; document the comparison that establishes equivalence.
