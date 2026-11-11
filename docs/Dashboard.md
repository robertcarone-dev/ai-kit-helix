# Porting dashboard and comparison registry

The CLI owns checkout-local report and comparison files. A compatible project-owned mod can display them; the shared installer does not supply a dashboard UI or backend.

## Publish a status report

From the Unity checkout, agents publish a complete snapshot:

```sh
Tools/Helix/bin/helix workbench dashboard --spec report.json
Tools/Helix/bin/helix workbench dashboard
```

Use `--helix-project sample-project` to use the saved mod connection, or `--project-root /absolute/checkout` for an isolated checkout. Neither command launches a game or Unity. The CLI validates the report, stamps `reportedUtc`, and atomically replaces `.helix/porting-dashboard.json`. With no `--spec`, it reads the current report. This path is checkout-wide and independent of browser session directories. Publication replaces the whole snapshot; coordinate publication through one reporting agent rather than having individual agents overwrite each other's inventory.

The mod reads this file from its connected Unity project. **Reload report** rereads it; it does not run scenarios or recapture evidence. An unreported checkout shows an empty state, never inferred completion. Read or validation failures clear displayed status and show a recovery instruction.

Input example (illustrative, not a report of actual project completion):

```json
{
  "format": "helix-porting-dashboard",
  "version": 1,
  "project": "sample-project",
  "items": [
    {
      "id": "screen.menu",
      "kind": "screen",
      "title": "Menu",
      "status": "out-of-date",
      "summary": "The Helix status layout changed after the last Unity capture.",
      "issues": [
        {
          "severity": "warning",
          "tool": "helix-cli",
          "message": "The retained comparison predates the layout change.",
          "action": "Run workbench prepare with the menu review spec, review the new captures, and publish an updated report."
        }
      ],
      "evidence": ["path/to/previous/review.json"]
    }
  ]
}
```

Kinds: `feature`, `screen`, `fixture`, `scenario`. Statuses:

| Status | Meaning supplied by the reporting agent |
| --- | --- |
| `helix-only` | Present in Helix; Unity implementation has not started. |
| `in-progress` | Porting work is underway. |
| `ported` | The agent reports the scoped implementation complete; describe its evidence and limitations. |
| `out-of-date` | A known source/dependency change invalidated the prior result. |
| `blocked` | A prerequisite or error prevents progress. |

Every item needs a stable unique ID, title, summary, issues array and evidence-reference array. Each error/warning requires a concrete next action and the responsible tool (`helix-cli`, `unity`, `aikit`, `helix`, or `other`). Blocked and out-of-date items require at least one issue. Evidence references are displayed as text; the dashboard does not execute commands, open arbitrary URLs, or claim that referenced files were verified.

`reportedUtc` is CLI publication time, not a source revision or evidence timestamp. Statuses are agent assertions based on their work and existing CLI evidence/freshness checks. This command does not independently calculate freshness or parity and does not automatically turn a successful capture into “ported.” Include the reason for an out-of-date result and publish again when resolved. Existing `workbench prepare` and review commands remain responsible for evidence preparation; agents summarize those outcomes here.

Reports are limited to 1 MiB, 1000 items and 50 issues/references per item. Unknown fields, duplicate IDs, cross-project reports and invalid states/actions are rejected before replacement. The pure validator is mirrored in the project's mod at `src/porting-dashboard-format.ts`; keep both copies identical when changing this versioned contract.

## Connected evidence and feedback

Select a feature or screen to see its linked comparisons. The issue filter shows evidence explicitly linked to that issue; **Show all comparisons** exposes the checkout-wide inventory. No issue relationship or verdict is inferred from pixel differences.

Agents can register existing bundles without recapture, including bundles from an isolated checkout:

```sh
Tools/Helix/bin/helix workbench comparisons --from-report yes
Tools/Helix/bin/helix workbench comparisons --evidence /absolute/evidence.json --item screen.menu --issue 1
Tools/Helix/bin/helix workbench comparisons --item screen.menu
Tools/Helix/bin/helix workbench feedback --comparison COMPARISON_ID
```

`--from-report yes` registers the report's explicit `evidence.json` references and links them to their items. Other report files are not treated as comparison bundles. Invalid or missing bundles are reported individually and yield exit code 2; successful entries are retained. Registration validates the complete bundle. Repeating registration preserves existing links without duplication.

`--issue` is a 1-based issue number in the current dashboard report and requires `--item`. Registration stores the issue's tool, message, and next action as its identity, not its position. Reordering issues preserves the relationship; changed issues are labeled as earlier issues until an agent links the updated issue. `prepare`, `refresh`, and `evidence` accept these same link flags; invalid item or issue selections fail before preparation. Same-bundle registration uses an exclusive lock to avoid concurrent link loss; an interrupted writer may leave a lock requiring investigation.

Use the connected checkout as the registration destination (`--helix-project` or explicit `--project-root`); an absolute bundle path may point into an isolated capture checkout. This does not change capture provenance or pretend the capture came from the connected revision.

`feedback` reads saved decisions directly from the signed-in account on local Helix Desktop. No export or import is required. Output includes linked items/issues, element identity, notes, decision, and evidence-relative state (`not-reviewed`, `accepted`, `needs-work`, `blocked`, or `review-required`). Legacy report-path decisions are included with their identity explicitly labeled. A changed evidence hash requires review; this command does not assess live source freshness. Missing decisions are distinct from connection/read errors, which fail the command. Unsaved edits are not visible to agents. Saving feedback does not automatically change the CLI-owned feature status; the next agent must evaluate it and publish an updated report.


Successful preparation, refresh, and evidence commands register their bundles automatically. Each `.helix/comparisons/<id>.json` record pins an absolute bundle path and SHA-256; moving or changing the bundle invalidates it. Registration verifies the complete bundle, derives status only from valid preparation metadata, and writes atomically under an exclusive per-bundle lock. Registration failure fails the command but leaves completed evidence for investigation. Lists describe preparation-time status, not current source freshness.

Feedback requires the optional Desktop endpoints in [Workbench](Workbench.md). It reads durable project-mod decisions first, falling back to account KV only when a record is absent. Connection failures are not treated as missing decisions.
