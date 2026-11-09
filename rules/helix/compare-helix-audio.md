---
name: Compare Helix sound effects and music
description: Map audible events to the project playback path and verify player-heard output on both sides.
enabled: true
tags: [assets-design, assets-tech, code, qa]
---

Apply this rule when implementing or reviewing an audible interaction, looping effect or music transition. Follow [reference authority](use-helix-as-the-design-source-of-truth.md); project-specific sound design and playback ownership belong in the adapter or local rules.

## Identify the sound and its owner

Trace the player action through its Helix caller to the Web Audio synth, sample or music controller. Record the trigger, guards, start/stop events and audible result. For layered effects, identify overlapping and sequential layers. For music, identify entry, transition, loop and exit. Distinguish observed silence from muted or unavailable output.

Map each case to a Unity caller, cue or track, binding and clip. Use explicitly approved substitutions, matching the trigger and audible role. If the prototype lacks a corresponding track, use the approved product brief and label the case as a product requirement. Record intentional differences and their decision source.

For authorized implementation, use the project's existing interaction/event owners and playback path. Keep cue variants, gain, pitch, track selection and asset provenance with their established owners. Follow the product's Sound and Music toggle policy rather than introducing another playback system.

## Verify what the player hears

1. Replay the same normal input from matched states. Use `Tools/Helix/bin/helix fixture-list` to find a replay, or the existing fixture workflow to author one. Record reference identity, Unity revision, cue/track, toggle states and action marker. In an authorized isolated Unity session, account for Editor master mute and restore any temporary change.
2. Start output recording before the trigger on both sides. Confirm intended game audio with a known audible control before judging silence. Compare onset relative to the action, sequence, variation, relative level and tail as required by the brief. Declare timing or level tolerances and their measurement basis before judging them.
3. For loops, listen across a wrap and through stop or interruption. For music, check the scoped state transition and same-state re-entry for restarts or doubled playback. Exercise Sound and Music controls according to the product's policy while playback is active. Record expected stop, continue-muted or resume behavior.
4. Keep event/wiring findings separate from listening findings. A fixture video, log or clip assignment alone establishes no audible verdict. Attach paired output recordings with time offsets and hashes under [comparison verdict recording](record-helix-comparison-verdicts.md). If output capture is unavailable, retain trigger evidence, mark the listening criterion `UNMEASURED` and identify the missing side. Report measured differences separately from approved substitutions.
