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

Follow the [editable animation authoring contract](../helix-reference/references/animation-porting.md). Sparse source-aligned curves, shared clocks, current-pose overlap, explicit dynamic ownership, and visible Edit Mode preview/restoration are implementation requirements. Audit obsolete clips, controller parameters, and state timing owners before reusing an old port.

Follow [the port recipe](../helix-reference/references/port-recipe.md). Map the source tween, mixer or procedural update into the existing Unity motion system. Translate time units, easing, delays and interruption behavior explicitly; prove one event from matched initial state through its final pose before extending affected variants. Keep observation instrumentation separate from the shipped motion logic.

## Scene sampling support

Read `Tools/Helix/Scene.md` for `scene-record`, the optional Unity `SceneSampling` helper and `scene-motion`. Use a project-observed event timeline, not sampler start time, to align snapshots. The sampler observes the current scenario; it does not reset animations or reproduce an event automatically. Use a scoped motion profile containing required nodes; choose appearance only when property sampling is required. Inspect actual sample timing, capture durations, missed deadlines and unmatched coverage, and keep unsampled transitions unmeasured. A fixture-readiness marker is not animation onset. Retain video and input/event evidence for rendered motion and behavior.

## Procedure

1. Establish explicitly matched initial snapshots, including relevant progress and object state; equal seeds do not guarantee equal RNG output across engines. Prove a short representative recording and inspect its receipt, setup interval and encoded dimensions before recording the matrix.
2. Align both recordings to an observable event, such as input acceptance or transition onset. Record the alignment frame and any uncertainty; file start times are not automatically event times.
3. Inspect source and target timing units (milliseconds/seconds), easing parameters, delay, repeat/yoyo and time scale where available. Compare initial/final poses, onset delay, duration, overshoot, settling, trajectory and readability against the criterion. Include interruptions or repeated input only when scoped.
4. Use `recording-sheet` for recording overviews and event-window contact sheets, following [offline image and recording review](../helix-reference/references/comparison-workflow.md#offline-image-and-recording-review). Sample comparable frames relative to the observed event. Measure screen-space displacement in pixels and elapsed frame/video time with the frame rate or timestamps used.
5. For game-time transforms, use inspected instrumentation that records game clock and transforms in both engines. Video alone cannot supply game-time samples; keep those claims unmeasured without instrumentation.
6. Verify scoped event order, gameplay effects, input hit regions and state sequences as well as appearance. Record playback speed, time scale, randomness and remaining phase differences where known. Repeat only affected cases after a changed setup or implementation.

## Measurements and observations

Distinguish video frame time, wall time and game time explicitly. Describe perceived easing/readability as observations unless sampled motion supports a quantitative claim. Unsynchronized ambient motion is not evidence of a trajectory defect. Use native PNGs for exact spatial comparisons when video encoding changes dimensions.

## Deliverable and completion

Add the shared ledger fields plus source/target motion implementations and timing conversions, event/state sequence, trigger/scenario, initial snapshot and final pose, alignment frame/event, time basis, sampled frame timestamps, timing/displacement measurements and clock uncertainty. Link both videos, motion receipts and any instrumentation scripts/data.

Finish when all required events and variants have supported dispositions and owned state is restored. Stop affected timing or trajectory claims when event alignment or sampling is insufficient; retain qualitative observations, identify the missing fixture/instrumentation and continue independent events.


For configured Unity/backend captures, follow `Tools/Helix/WorkflowToolkit.md` and the project's adapter. Use the readiness/motion helper only after a reviewed live pilot; do not invent hooks or copy another game's fixtures. Record before actions, verify first/last event coverage, and restore owned state. Use delivery receipts to distinguish implemented, validated and integrated work. Reuse evidence only when its declared inputs and bytes remain valid.

For a designer's aligned handoff ZIP, run `handoff-owner --handoff FILE.zip --unity-project IDLE_ISOLATED_PROJECT --out NEW_EVIDENCE_DIR` on the receiving checkout. Use each note's clip paths, time range and disposition from `alignment.json`. Inspect both clips on a transition and preserve unresolved ownership. The fixture authoring contract and prerequisites are in Tools/Helix/Toolkit.md under “Aligning a scrubber pick to a Unity Animator”.

For a presenter event, inspect every property result for the note. A sprite assignment can precede the entrance and persist through the selected frame while a parent scale has a separate live clip binding. Use the writer stack and the property-specific clip path in the linked review.

Before booking a reference session or starting Unity, run `capture-coverage` with the project feature spec and available inventories. Read the per-viewport, per-side capture list. Review retained action windows and use `--basis current` when judging the receiving revision. Pass new capture receipts back as an additional inventory and carry the complete coverage report in the handoff.
