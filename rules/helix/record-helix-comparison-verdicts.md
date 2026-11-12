---
name: Record evidence for every comparison verdict
description: A completed case needs reproducible evidence; inaccessible or unmeasured cases cannot pass.
enabled: true
tags: [assets-design, assets-tech, code, qa]
---

Record each scoped comparison case with its ID, steps, reference identity, Unity revision, expected result, actual result and links to paired captures or recordings. Include relevant console errors and precise reproduction steps for defects.

Use explicit evidence status:

- PASS: both applications were exercised and the scoped criteria match, including documented approved deviations.
- FAIL: an observed mismatch or unresolved applicable defect remains.
- BLOCKED: the case could not begin; name the missing dependency or access.
- UNMEASURED: a started case could not be completed.
- NOT TESTED: the case has not been attempted.

Assign the board verdict from the case evidence and stage reached. Retain the CLI status, capture receipts and cleanup result separately. A matrix row can report `blocked` after both captures exist. Never pass by omission. Source-only inspection, compile success and prefab captures do not prove live parity.

Separate visual defects from behavior defects. Final reports state coverage and all outstanding cases. Claim the scoped screen or feature matches only when its required cases pass; partial evidence is partial completion.

Builders put their validation plan and evidence in the build handoff. QA owns board case planning and final verdicts; a builder does not need to create QA board cases before doing scoped validation.

Finish bounded audit sections with explicit dispositions. Route actionable findings into implementation tasks and preserve valid unaffected evidence. A missing fixture blocks only dependent cases; do not automatically replay the whole asset library.

Start or resume feature work by reading `Tools/Helix/bin/helix discrepancy-resume --feature "FEATURE"`. At a checkpoint or handoff, persist open differences and coverage gaps with stable IDs, capture-time evidence/input hashes, recoverable locations and executable next actions through `discrepancy-save`. Deliver the project-owned records to the receiving branch. A later seat checks the per-claim evidence status, preserves valid observations and updates the same ID using the revision it read. Link the record to the existing assignment; keep final QA verdict and deviation approval with their owners.

## Persist completion in the discrepancy register

When a discrepancy's scoped acceptance is satisfied and applicable receiving-revision verification is complete, its verdict owner (QA where assigned) must record completion before handoff, without a separate user prompt. A build handoff or board Done status alone does not close the register entry.

Read the latest revision, then append a new revision of the same stable ID using `Tools/Helix/bin/helix discrepancy-save --spec FILE --after READ_REVISION`. Set `status` to `resolved`; the schema has no `completed` status. `--after` must equal the revision read: on a conflict, resume and reconcile the intervening record rather than overwrite it. Use `accepted-deviation` only for an explicitly approved difference, recording that approval.

Include the resolution `decision`, fix identity, tested receiving revision in `unityRevision`, and recoverable verification evidence with capture-time evidence/input hashes. A resolved record requires a nonempty evidence array. Clear obsolete `blocker` and `nextAction` fields in the new revision. Do not delete records or rewrite earlier revisions.

Do not close a partly unmet scope. If residual coverage is genuinely independent of the completed defect, retain or create separately linked stable cases and explain the split in the decision; do not leave a fixed scoped defect open solely for unrelated coverage. Deliver the new revision and verify its status and evidence readback from the receiving checkout before recounting the project status summary.

## Offline review feedback

For portable evidence reviews, follow the [offline handoff contract](../../Tools/Helix/toolkit/Dashboard.md#task-handoff) and its project adapter to register retained comparisons and read exported feedback with `workbench feedback --comparison ID --decisions EXPORTED_REVIEWS` on continuation and before handoff. Missing exports remain an explicit review limitation; do not query retired mod endpoints. Keep evidence-relative decisions, board verdicts and discrepancy dispositions distinct; review feedback does not transfer QA or deviation-approval ownership.

## Continuation and evidence recovery

For a UI continuation, the AI Kit assignment or build handoff includes the exact feature name and stable discrepancy IDs in the board task. The receiving seat can retrieve evidence, case routing and next actions from the checkout with those identifiers. Keep case selectors and prefab field names in the project adapter.

Missing evidence must carry a recoverable board attachment ID or package manifest ID and member path. Check recovery from the receiving checkout before delivery. Use the returned evidenceChecks to distinguish recovered bytes from reusable observations. For a merge-dependent handoff, pin the required commits and supply an afterIntegration action; the receiving agent follows continuation.nextAction against its own HEAD.

At handoff, distinguish pairs captured, pairs measured and measurements reviewed. Attach the case ledger, exact input and capture identities, measurement method and result, and durable originals before releasing scratch. Verify readback from the receiving checkout. Preserve passes with matching declared inputs and evidence. Assign remaining measurement work against retained pairs before requesting another reference slot.

After a relevant verdict, deviation or blocker change, follow [comparison status maintenance](maintain-comparison-status.md) at the next checkpoint before handoff.
