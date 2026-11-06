---
name: Coordinate shared files and receiving branch delivery
description: Assign ownership of overlapping writes and coordinate delivery to the configured receiving branch.
enabled: true
tags: [assets-design, assets-tech, code, qa]
---

Before dispatch, record the receiving branch, required dependencies and files each assignment expects to change. Compare those files with active assignments. Treat a generator, its configuration and the assets it regenerates as one ownership group. Give overlapping writes one current owner and arrange a dependency or handoff for the other assignment. Independent work can proceed in parallel.

In the assigned lane, integrate required dependencies at a safe checkpoint and record the receiving commit used for validation. Finish or safely stop an owned capture before synchronizing. If an unexpected overlap appears, coordinate with the other owner before either assignment edits the shared files. Preserve other owners’ uncommitted changes.

Serialize the final delivery step for each receiving branch. Immediately before applying the change, recheck the receiving commit. If it moved, have the existing owner reconcile the new base and recheck the behavior and evidence affected by that change. Release the delivery slot while that work proceeds.

Record the task commit and resulting receiving commit in the integration receipt. Follow the [recovery and evidence rule](recover-owned-lanes-and-reuse-evidence.md) for dependency checks and integration verification. Report visual or behavioral acceptance separately.
