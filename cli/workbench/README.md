# Acceptance matrix host integration

These files belong to the shared Helix toolkit. They contain no project-specific case IDs, Unity members, or fixture routes. The installer copies them into `Tools/Helix/workbench`.

In a Helix Kit mod, copy `AcceptanceMatrix.tsx` and `acceptance-view.ts` into `src`, then render `<AcceptanceMatrix key={'acceptance:' + root} root={root} project={project} />` after the connected-checkout selector. Use a distinct key from sibling panels.

The mod backend must first validate the connected absolute checkout (Unity Assets, ProjectVersion, manifest and matching Helix project identity). Then delegate `/acceptance/status`, `/acceptance/media`, and `/acceptance/review` to the selected checkout's installed module:

```ts
const module = await import(pathToFileURL(join(root, 'Tools/Helix/workbench/acceptance-backend.ts')).href);
return module.acceptanceBackend(root, helix.project.root, helix.project.slug, path, input);
```

The consumer owns `Tools/Helix/acceptance/reference-inputs.json`: `{ "version": 1, "paths": ["src", "package.json"] }`. Paths are relative to the selected Helix draft project. The manifest hashes additions, deletions and bytes, refuses escapes/symlinks, and requires explicit source coverage. It describes draft source freshness; capture receipts must separately establish served runtime identity. Consumers own their capture adapters and dependency coverage.

Reviews use the existing immutable decision store, exact run hash, and previous-decision compare-and-swap. Names are explicitly self-reported. UI success requires a durable save acknowledgment. Publication failure is reported separately from save failure. Media is restricted to registered, hash-verified artifacts in the connected checkout; arbitrary paths are never accepted. No server or global review database is introduced.

Use the native Helix typecheck and Mod Bench after host integration. Backend contract tests live in `cli/test/acceptance.test.ts`. Acceptance never follows merely from a successful capture or a historical legacy discrepancy verdict.

## Whole-game inventory

`GameCatalog.tsx` and `catalog-view.ts` provide the primary inventory browser. Render `GameCatalog` with `root`, `project`, and a `renderComparisons(item)` callback to the host's existing comparison viewer. Add `/acceptance/catalog` and `/acceptance/catalog-evidence` to the validated host routes. The existing `AcceptanceMatrix` accepts `itemId` to show review cases only for the selected catalog entry. Keep historical reports secondary; do not present their ported counts as current acceptance.

The consumer owns `Tools/Helix/catalog/catalog.json` and its versioned historical dashboard snapshot. Version 1 requires `project`, `title`, `sources`, `exclusions`, `legacyReport`, and `entries`. Each entry declares stable `id`, `title`, `kind`, `group`, `scope` (`game`, `tooling`, `reference-only`), `summary`, `sources`, `implementationReferences`, `discrepancies`, `evidence`, and nullable `acceptanceItem`. The shared `catalog.ts` reader defines validation. `helix catalog validate|status` joins this inventory with current discrepancy revisions, comparison registrations and acceptance coverage without migrating or manufacturing verdicts.

Catalog evidence is opened by registered item/index plus expected path/hash. Escaping paths and changed selections are rejected. Local presence is checked on refresh; large artifact hashes are checked on demand to avoid hashing every recording while browsing. External and missing references remain visible. New unmapped discrepancies and orphan comparison registrations surface as coverage warnings.

After changing installed backend modules, restart the host Mod Backend before verification: Helix caches imports outside the mod directory. A UI reload or touching `server.ts` does not clear those imports. Use Helix's Mod Backend restart control, then Refresh catalog.

## Prior case evidence

Consumers may supply `Tools/Helix/acceptance/evidence-links.json`: `{ "version": 1, "project": "...", "links": [{ "item": "screen.example", "caseId": "settled", "sources": ["evidence/inventory.json"], "note": "Original scope and remaining review needs" }] }`. Each target must exist, each case may have one link record, and source paths must stay in the checkout. Missing local sources remain visible. This optional index associates historical context only; it never contributes to verification, freshness, eligibility or approval and does not change criteria hashes.

Acceptance rows expose `priorEvidence` and all `linkedDiscrepancies`, including resolved findings and their latest numeric revision paths. The matrix separates prior findings from current run verification and human review. The catalog registers these source documents for its existing evidence viewer. Retained inventories and discrepancy files are unpinned context when opened through these links; original media pins remain in their owning records. Resolved discrepancies do not automatically approve a new case.

## Case execution adapters

Consumers may add `Tools/Helix/acceptance/adapters.json` with `version: 1`, matching `project`, and `routes`. Each route requires `item`, `caseId`, `viewport`, `retained` (pins of version-1 discrepancy source documents), and nullable `capture`. Capture is either `{ kind: "ui-matrix", spec, caseId, limitations }` or `{ kind: "node", script, args, limitations }`. Node args are literal arrays with `{root}`, `{out}`, `{case}`, `{viewport}` placeholders; no shell is used. Setup and lifecycle recipes remain consumer-owned. Still matrices are accepted only for appearance cases and must match the declared viewport.

`helix acceptance adapters` lists dispatch; `acceptance plan --item ... --case ... --viewport ... --out ...` validates and checks retained evidence without executing. `acceptance run` requires explicit `--mode retained|capture`. Retained mode verifies original pins and writes review diagnostics without creating runs. Capture requires an isolated checkout, delegates lifecycle/restoration to existing runners, and imports only unmeasured still observations after verified cleanup and unchanged inputs. Node adapters retain responsibility for their case records and recovery journals. Configured does not mean live-piloted.

Execution receipts are local under `.helix/acceptance-executions`. The matrix shows last execution and commands, while catalog evidence exposes the pinned diagnostic artifacts. Execution status never grants acceptance. Case/adapter drift is distinguished from current instructions; media/dependency freshness remains owned by acceptance status. Versioned definitions and durable evidence recovery are still required for handoff.

### Agent assessments

`helix acceptance assess --spec FILE` saves immutable findings pinned to an existing run hash. The assessment carries an agent/automation identity, UTC timestamp, one observation per captured criterion, evidence SHA-256 pins, and discrepancy IDs. It never rewrites capture timestamps or creates human decisions. The matrix shows scoped findings separately from current-source freshness and human review. A matching assessment alone cannot enable acceptance; the original verified-run and scope gates still apply. Missing or changed assessment evidence invalidates its displayed finding. Mismatching assessments block acceptance even if the original run matched.

Acceptance gate explanations include scope approval, implementation declaration, capture verdict, required criterion observations, recorded anchors, declared dependency pins, paired evidence, freshness, recipe blockers, linked discrepancies, and agent-assessment evidence. `canAccept` uses this same list: an empty refusal list is eligible, while human acceptance remains a separate decision. Accepted deviations still require explicit criterion reconciliation; their issue status alone cannot waive an unchanged criterion.
