---
name: helix-compare-feature
description: Port and verify Phaser/Three.js web feature behavior in Unity through semantic inputs, guards, event/state sequences, feedback and data effects. Use for multi-step feature parity; route precise animation timing or appearance-only work to the relevant specialty.
---

# Compare feature behavior

## Prerequisites

Read [the shared workflow](../helix-reference/references/comparison-workflow.md). Identify the scoped feature, acceptance criteria and review-only versus authorized port/fix mode. Map source controllers/state and relevant assets to actual Unity components; equivalent behavior does not require the same architecture.

Establish explicitly matched initial snapshots, including relevant local currency, inventory or progress. Equal seeds do not establish equal state. Use verified isolated state and preserve source behavior as the reference. Missing source behavior supports a documented port question or brief; do not invent backend behavior.

For purchase/reward cases, use isolated fake or local fixtures. A comparison task does not imply authorization for real payments or backend writes. Do not create game builds or run Production checks.

## Authorized implementation

Follow [the port recipe](../helix-reference/references/port-recipe.md). Map the source action, guard, state transition and visible feedback into existing Unity controllers and services. Implement one normal-input path with matched initial state, then add only the scoped guard, interruption and reset cases. Keep local test fixtures separate from real purchase or backend operations.

## Procedure

1. Define each case as initial state → semantic input/action → guards/enabledness → event/state sequence → final state, visible feedback and relevant data changes. Record only effects needed by the task.
2. Prove one representative source case, then its Unity counterpart. A fixture may establish initial state; use normal player inputs for behavioral claims. Calling a debug destination method does not prove navigation, guards or callbacks.
3. Capture source pre/post state and visible feedback, recording the action chronology and observed event order. Repeat with the target from its matched initial snapshot. Probes/logs corroborate UI/video and input evidence; they do not replace proof that the player action worked.
4. Cover the task's required cases: main path, disabled/invalid guards, repeated input or double activation, interrupted transition/Close, and reopen/reset where applicable. Persistence/reload checks apply only when specified. Do not turn a scoped feature port into an exhaustive unrelated audit.
5. Where relevant, check lifecycle cleanup for duplicate handlers, timers, callbacks or rewards. Distinguish intended persisted feature state from temporary test/session state that must be restored.
6. Diagnose differences against the source sequence. For review-only work, recommend the Unity change and affected retests; for an authorized port/fix, apply that scoped target change and recapture affected cases. Reuse unaffected evidence.

## Tool and evidence limits

Use `fixture-list` to find an authored replay. For an uncovered case, define the initial state, actual player actions and observable outcome in a project fixture and register it with `fixture-create --spec FILE`. Use an `assert` step with an expression and expected JSON value for a specific behavioral check. Run `fixture-record ID --out NEW_DIR` and inspect the action receipt, state and clip. Derive the expected behavior from the source and verify the Unity counterpart independently. A non-`wait` `step` clears the selected scenario; `record` requires and replays a named scenario, includes its setup, then resets. It cannot record an arbitrary sequence of manual steps already performed. For video proof, put reproducible normal actions in a suitable named scenario, or use an applicable capture method; do not label direct state mutation as input proof.

Record chronology without inventing clock precision. Add milliseconds, frames or game-time basis only when timing is part of the criterion and evidence supports it. Unknown event/data telemetry makes the dependent claim unmeasured; continue supported visible/input observations and independent cases.

Distinguish UI reopen, page reload and a fresh browser context. `reset` and normal `scenario` setup recreate isolated storage; they do not prove reload persistence. For a scoped persistence claim, use an inspected same-session reload/re-entry method that preserves the intended storage, and record it explicitly. Scenario replay during recording can also change the starting state.

Use [motion](../helix-compare-motion/SKILL.md) for precise animation timing. Use [UI](../helix-compare-ui/SKILL.md), [models](../helix-compare-models/SKILL.md) or [lighting](../helix-compare-lighting/SKILL.md) only where appearance is part of the feature criterion.

## Deliverable and completion

Add to the shared ledger: source-to-Unity controller/state mapping, paired pre/post state receipts, semantic actions and actual input method, guards, event/state chronology, expected/actual feedback and data effects, lifecycle findings, recommended or implemented target fix and affected retests. Retain accessible scripts, evidence paths/hashes and restoration receipts.

Report `passed`, `difference`, `unmeasured` or `blocked` for every required case, with explicit remaining coverage. Complete the review when each case has a supported disposition and temporary owned state is restored; successful feature parity requires evidence for all scoped criteria. At the shared work bound or a missing prerequisite, preserve an executable handoff and continue independent cases without inventing a pass.

For world-space input, look up the project adapter's existing collider probe and pointer route. Confirm the viewport, project the active collider, and inspect the top hit before tapping. Check the press receipt and the resulting gameplay state before recording a verdict. See “World-space pointer evidence” in the installed Adapter.md.
