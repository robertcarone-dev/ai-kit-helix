---
name: Maintain the project comparison status
description: Refresh the designated project status after relevant delivery or evidence changes, before handoff.
enabled: true
tags: [assets-design, assets-tech, code, qa]
---

Maintain the comparison status document designated by the project adapter or a project-local rule, without waiting for a separate user prompt. The project supplies its path, scope and current owner. If that mapping is absent, record the missing mapping in the existing handoff; do not guess or create a status document, and continue independent work. This is an event-driven agent responsibility, not a scheduler or software watcher.

## Trigger and ownership

At the next safe checkpoint before handoff, update the designated status after a relevant implementation integration or delivery, comparison verdict, approved deviation, or blocker change.

Serialize overlapping summary edits through its assigned owner. Contributing lanes supply scoped facts and evidence through the existing handoff; do not overwrite concurrent updates. Use the configured receiving branch. Before calling work landed, verify receiving-branch inclusion or patch equivalence and record the receiving revision; lane-only work remains pending. Integration establishes inclusion, not acceptance.

Use the project-owned `Tools/Helix/report.json` when configured: it names the evidence index scope and existing status document. Route scoped updates through that document owner and regenerate supporting evidence with `helix evidence-report`. Do not introduce a dashboard or another progress summary, or infer completion of separately owned work from shared evidence. Legacy dashboard commands remain compatibility interfaces, not required delivery steps.

## Refresh the affected status

Update the discrepancy register first: the verdict owner must [persist completed cases](record-helix-comparison-verdicts.md#persist-completion-in-the-discrepancy-register), deliver the new revisions and verify receiving-checkout readback before refreshing counts or describing them as resolved in the summary.

- Record the review date, receiving branch and resolved revision. Identify lane-only work and exclude unrelated uncommitted changes from landed claims.
- Recount the register when it changes: select the highest numbered JSON revision for each stable discrepancy ID, count each ID once, and group by its recorded status. Explain additions and status changes without treating totals as an acceptance percentage.
- Separate landed implementation, scoped observed passes, accepted deviations, verification still owed, and concrete defects, decisions or prerequisites. Source inspection and integration alone cannot close a case or establish visual or audio acceptance.
- Reconcile obsolete summaries against current source, integration records and newer evidence. Preserve valid unaffected observations with their original revision and scope. Recovered bytes do not by themselves establish reusable evidence on the receiving revision.
- Update only affected summary sections and links. Preserve dated history rather than rebuilding it after every change. Link stable cases and their latest relevant evidence or next actions instead of duplicating their ledgers.

Follow [comparison verdict recording](record-helix-comparison-verdicts.md) for evidence and disposition ownership. Missing evidence remains an explicit limitation with its prerequisite and next action; do not infer a pass.

## Boundaries

Follow [reference authority](use-helix-as-the-design-source-of-truth.md) and the project's declared reference scope. Review the documentation diff and affected links. Do not run tests, launch or control Unity or Helix, capture new runtime evidence, or perform device profiling solely to refresh the summary. Record missing verification instead. This rule authorizes no external messages, artifact writes outside the designated status/register/evidence-index work, or additional runtime sessions; use only already-authorized work and existing handoff mechanisms.
