---
name: helix-compare-motion
description: Port and verify Phaser/Three.js web animation timing, easing, trajectories, poses and transition motion in Unity. Use for motion parity; route multi-step feature state/data semantics or static appearance to their own specialties.
---

# Compare motion

Route multi-step feature state/data semantics to [feature behavior](../helix-compare-feature/SKILL.md); retain scoped event and input checks needed to interpret the motion.

## Prerequisites

Read [the shared workflow](../helix-reference/references/comparison-workflow.md). Map the actual source motion system (Phaser tween, Three.js mixer or procedural update) to the actual Unity implementation. Define the event, trigger, initial state/pose, expected final state/pose, required variants and available time basis.

Use a named scenario with reproducible actions for transient interactions. `record` recreates the scenario and drops later manual setup; it does not record the current arbitrary state. If a necessary trigger is not represented, provide a scoped project scenario/fixture before recording that case. Do not invent a freeze or animation-clock command.

## Authorized implementation

Follow [the port recipe](../helix-reference/references/port-recipe.md). Map the source tween, mixer or procedural update into the existing Unity motion system. Translate time units, easing, delays and interruption behavior explicitly; prove one event from matched initial state through its final pose before extending affected variants. Keep observation instrumentation separate from the shipped motion logic.

## Procedure

1. Establish explicitly matched initial snapshots, including relevant progress and object state; equal seeds do not guarantee equal RNG output across engines. Prove a short representative recording and inspect its receipt, setup interval and encoded dimensions before recording the matrix.
2. Align both recordings to an observable event, such as input acceptance or transition onset. Record the alignment frame and any uncertainty; file start times are not automatically event times.
3. Inspect source and target timing units (milliseconds/seconds), easing parameters, delay, repeat/yoyo and time scale where available. Compare initial/final poses, onset delay, duration, overshoot, settling, trajectory and readability against the criterion. Include interruptions or repeated input only when scoped.
4. Sample comparable frames relative to the event. Measure screen-space displacement in pixels and elapsed frame/video time with the frame rate or timestamps used.
5. For game-time transforms, use inspected instrumentation that records game clock and transforms in both engines. Video alone cannot supply game-time samples; keep those claims unmeasured without instrumentation.
6. Verify scoped event order, gameplay effects, input hit regions and state sequences as well as appearance. Record playback speed, time scale, randomness and remaining phase differences where known. Repeat only affected cases after a changed setup or implementation.

## Measurements and observations

Distinguish video frame time, wall time and game time explicitly. Describe perceived easing/readability as observations unless sampled motion supports a quantitative claim. Unsynchronized ambient motion is not evidence of a trajectory defect. Use native PNGs for exact spatial comparisons when video encoding changes dimensions.

## Deliverable and completion

Add the shared ledger fields plus source/target motion implementations and timing conversions, event/state sequence, trigger/scenario, initial snapshot and final pose, alignment frame/event, time basis, sampled frame timestamps, timing/displacement measurements and clock uncertainty. Link both videos, motion receipts and any instrumentation scripts/data.

Finish when all required events and variants have supported dispositions and owned state is restored. Stop affected timing or trajectory claims when event alignment or sampling is insufficient; retain qualitative observations, identify the missing fixture/instrumentation and continue independent events.


For configured Unity/backend captures, follow `Tools/Helix/WorkflowToolkit.md` and the project's adapter. Use the readiness/motion helper only after a reviewed live pilot; do not invent hooks or copy another game's fixtures. Record before actions, verify first/last event coverage, and restore owned state. Use delivery receipts to distinguish implemented, validated and integrated work. Reuse evidence only when its declared inputs and bytes remain valid.
