---
name: Recheck fixes on the delivered Unity revision
description: Close defects with repeatable comparisons and identify which revision was actually tested.
enabled: true
tags: [assets-design, assets-tech, code, qa]
---

For authorized implementation work, fix observed mismatches at their source while preserving user work and unrelated behaviour. A comparison-only task reports defects without changing the game.

After a fix:

1. Check compilation and relevant prefab audits.
2. Repeat the failing case against the same Helix reference and capture new evidence.
3. Recheck affected states and responsive aspects for regressions.
4. Link the defect, fix and verification evidence in the issue handoff.
5. Once scoped acceptance and applicable receiving verification are complete, have the verdict owner [persist discrepancy completion](record-helix-comparison-verdicts.md#persist-completion-in-the-discrepancy-register) before handoff.

Do not close a defect merely because the code or asset changed. Preserve unresolved valid finding IDs; document approved deviations explicitly.

Record the tested checkout and commit, including dirty changes. Evidence from an isolated worktree proves that revision only. After integration, confirm the delivered revision contains the fixes and rerun affected acceptance cases there. If integration or execution is blocked, name the tested revision and outstanding verification; do not claim the user's working game matches.

Handoffs must carry reference identity, tested state setup, evidence locations and remaining cases so the next worker does not restart from assumptions.
