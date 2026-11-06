# Shared comparison workflow

This contract applies to all Helix comparison specialties. The `Tools/Helix/Toolkit.md` defines available commands; `Tools/Helix/project-adapter.md` defines the Unity procedure.

Read [Web-to-Unity mapping and capture](web-to-unity.md) when establishing source/target state, coordinates or asset provenance.

## Scope and prerequisites

The web source defines the scoped visual and behavioral reference; Unity may use a different hierarchy, component system or renderer. Do not change the web reference to match the target. Establish review-only versus already authorized port/fix work: review delivers an evidence-backed port/fix brief; authorized implementation applies the Unity change and recaptures affected cases without a new approval gate.

Record case IDs, acceptance criteria, required variants/viewports and approved deviations before capture. Clarify only missing decisions that materially affect the result; do not add approval gates to already authorized work. Inspect only the assigned lane and its owned sessions. Do not build games or run Production checks. Use verified isolated storage and restore owned state; never restore shared save snapshots over another session.

Identify the catalog-resolved project and variant, preview URL, served-content hashes and Unity revision/changes. Use the latest local Helix content; no source revision pin is required. A page hash alone does not verify a source commit, and an explicit preview URL override does not verify the configured project identity. Confirm visible rendering, matching native dimensions and equivalent state before judging appearance. Disclosed deterministic fixtures are valid for scoped geometry, material and motion comparisons. Test normal navigation, guards and callbacks separately when those interactions are acceptance criteria; a visual-only case does not require replaying unrelated navigation. Fixtures and instrumentation are distinct from normal player input. Missing prerequisites restrict only acceptance claims that depend on them; continue useful inspection and independent cases.

## Evidence and bounded execution

1. Include a JSON evidence ledger in the task's output package. Follow the `ledger-check` schema: a top-level `cases` array with `id`, `status`, `inputs`, and `evidence` entries containing a ledger-relative `path` and `sha256`. A Markdown summary is optional. Use `Tools/Helix/WorkflowToolkit.md` for evidence retrieval and dependency checks; these checks do not establish visual acceptance or automate case execution.
2. Reuse evidence whose reference, state, viewport and relevant inputs are unchanged. Invalidate only cases affected by changed inputs, recording why.
3. Prove one representative pilot with valid captures, receipts and cleanup before expanding to the required matrix. If it fails, diagnose the setup; do not silently reduce required coverage.
4. Checkpoint the ledger and review evidence at least every 10 minutes, with a handoff target within 20 minutes or earlier when the execution ceiling requires it. Preserve partial work before another batch.
5. After a prerequisite failure, allow one retry only when a concrete prerequisite changes; record that change. If it fails again, mark affected cases blocked and continue independent cases. Never repeat unchanged capture or startup attempts.
6. Use fresh output directories. Attach evidence or place executable helpers in the repository so the next lane can access them; a bare board attachment ID or another lane's temporary path is not a usable handoff.

For report-only scene failures, use `scene-report` with retained valid receipts and a fresh output directory before considering recapture. Follow `Tools/Helix/Scene.md` for explicit context, outcome and observation classification. Keep actual outcome differences and missing observations visible; changing the report contract cannot create missing evidence.

## Efficient static capture

For static fixture views, prefer the configured `batch` command in `Tools/Helix/Toolkit.md` over repeated full audits. Its adapter contract is in `Tools/Helix/Adapter.md`. Load once per viewport worker, request only the required views, and leave destruction and video out unless the acceptance criterion requires them. Do not infer fixture behavior from another project's adapter.

Prove deterministic reset and readiness for the requested fixture/seed, then compare a representative warm-session result with a fresh-session result before expanding. Start with one worker; measure before selecting two. The shared worker budget bounds simultaneous batch captures across agents. Serialize Unity operations within each lane; independent browser work and subsequent image analysis may overlap when resources permit.

Use resume only with matching recorded source/adapter inputs and intact image hashes. Preserve shared source manifests with the case receipts. Record startup and fixture setup separately from view-change and screenshot timings; a fast warm PNG does not establish fast initial loading or a parity verdict. Reuse valid evidence instead of rerunning unchanged cases, and checkpoint partial output before expanding scope.

## Authorized implementation

For port/fix work, follow [the port recipe](port-recipe.md), then use the specialist measurements to verify the result. Review-only work records actionable findings without changing game behavior. Close each bounded audit section with explicit case dispositions and route confirmed fixes or missing counterparts into scoped implementation tasks; a missing fixture blocks its dependent cases, not the entire library.

## Measurement discipline

Record numeric measurements with units, coordinate space, frame/time basis and method. Keep observations separate from measurements and hypotheses. Do not infer missing scene properties from a screenshot. Use task-defined tolerances and severity criteria; do not invent percentage thresholds or claim that a pixel difference score proves visual acceptance.

The CLI does not provide camera presets or cross-engine animation synchronization. Its UI snapshots provide scoped text/sprite/layout observations; unknown font fallback and occlusion remain unmeasured. See `Tools/Helix/UI.md`. Explicit `ui-matrix --execute yes` can execute supplied project Unity recipes in a verified isolated workspace; it does not provision Editors or acquire lanes. `unity-plan` emits configured argument arrays for the selected AI Kit or Unity CLI backend without executing them; follow the linked Unity procedure and always restore owned state. The optional shared Unity helper can provide receipt validation and bounds measurements, but project hooks still own setup, readiness, state, capture and restoration. Do not replace existing helpers until a live pilot verifies equivalent captures and cleanup. Use existing inspected project helpers or a scoped fixture when required; disclose what remains unmeasured. Do not silently substitute synthetic evidence for the running reference.

When using `look` inspection output, treat Phaser bounds as main-camera approximations: they do not resolve masks, occlusion or other cameras. Truncated results are not full object inventories. Confirm relevant bounds and visibility against the capture before relying on them.

`record` recreates the selected named scenario, does not replay later manual steps, includes setup before its observation interval, and resets the session afterward. Reproducible transient actions must be part of the scenario used for recording. Inspect `encoded` and `nativeVideo` in its receipt; video can round odd dimensions down and cannot prove native pixel parity or game-time transforms.

## Case deliverable

Each ledger entry contains:

- Case ID, acceptance criterion, required variant/viewport and approved deviation.
- Reference identity (declared versus verified), relevant source asset hashes, Unity revision and changed inputs.
- Source object/asset or procedural generator and parameters mapped to the Unity asset/component/shader; missing counterparts recorded as port work.
- Setup kind: normal input, fixture or instrumentation; exact reproduction commands and accessible scripts.
- Expected result, actual result, measurements with unit/space/frame/time basis, observations and remaining uncertainty.
- Status: `passed`, `difference`, `unmeasured` or `blocked`; severity only where task criteria justify it.
- Evidence paths, image/video hashes, source receipts and relevant comparison output. Record the input fingerprints each case depends on so reuse checks invalidate only affected cases.
- Evidence-based recommended or implemented Unity fix, affected retest cases, restoration receipt and any concrete prerequisite required for a retry.

Mark a case passed only when its criterion has sufficient evidence. A completed review can contain differences or gaps; it is not a successful parity verdict. Finish the review when all required cases have an explicit supported disposition and owned state is restored, or checkpoint with a specific executable handoff when the work bound is reached. Report unresolved coverage rather than calling full verification complete.

## AI Kit task brief template

```text
Skill: .claude/skills/helix-compare-<domain>/SKILL.md
Mode: review-only or authorized port/fix
Cases and acceptance criteria: ...
Source identifiers/assets/generators -> Unity counterparts or missing port work: ...
Required variants/viewports and approved deviations: ...
Assigned lane and reference identity: ...
Reuse: accessible evidence package, receipts, hashes and valid case IDs
Changed inputs / invalidated cases: ...
Prerequisite failure and concrete change before retry: ...
Next bounded deliverable: pilot or named remaining cases; checkpoint deadline
Executable setup/cleanup: repository script paths or attached files + commands
Ledger/evidence destination and handoff location: ...
```

## Status mapping

Map `passed` to PASS, `difference` to FAIL, `blocked` to BLOCKED, and `unmeasured` to UNMEASURED. Cases not attempted are NOT TESTED. Preserve the evidence and scope when mapping to a board.

### Cross-session continuation

Start with `Tools/Helix/bin/helix discrepancy-resume --feature "FEATURE"` in the receiving checkout. Read each record's next action, blocker, assignment and per-claim evidence checks. During a checkpoint, save new findings and update existing IDs using `discrepancy-save --spec FILE [--after REVISION]`. The spec, statuses, file ownership and evidence recovery procedure are in Tools/Helix/Toolkit.md under “Resume a feature without the previous session”. Link these project-owned records from the assignment handoff so the next agent can recover work even when the original chat and scratch files are unavailable.
