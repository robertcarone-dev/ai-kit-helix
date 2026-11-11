---
name: helix-compare-vfx
description: Port and compare transient Phaser or Three.js effects in Unity through event-aligned rendered filmstrips, compositing and explicit sampling coverage.
---

# Compare transient VFX

Read the shared comparison workflow in ../helix-reference/references/comparison-workflow.md. Resume existing discrepancies for the feature. Capture a reproducible normal-input fixture with the production camera on both sides. Start recording before the trigger; preserve setup, cancellation, cleanup, quality, viewport, recording clock and presentation seed where relevant.

Define the visual event precisely (for example, first rendered contact flash). Inspect each recording independently. Pin its receipt and mark the actual saved frame containing that observation. For a simulation event, use a project instrument that ties the event to the recording's frame or clock. Never treat observer start, fixture readiness, file start or a delayed screenshot as event onset. If one engine lacks a supported anchor, review the available side and mark timing on the other unmeasured.

Use `Tools/Helix/bin/helix vfx-compare --spec FILE --out NEW_DIR` as documented in Toolkit.md. Define offsets for anticipation, onset, peak, decay and clear as the effect warrants. Inspect both bracket frames, the anchor's preceding gap and the native composite before looking at crops. Record repeated/held frames and clock differences. A coverage label describes samples, never acceptance.

Compare screen footprint, opacity evolution, color, layer order, depth occlusion, additive/alpha response, camera shake, HUD readability and lingering emitters as applicable. For randomized effects compare distributions across representative repeats. For an authorized port, trace the effect's actual emitters, textures, simulation space, lifetime/curves and blend/depth configuration to their Unity owners. Change one cause and recapture affected phases. File unresolved observations with discrepancy-save, including report, artifact and declared dependency hashes. Keep game-specific effect names, event observers and tolerances in the consuming adapter.

For affected supported behavior, inspect natural completion separately from cancellation or owner teardown. Exercise reuse, emitter movement, offscreen completion/re-entry and peak concurrent effects when those paths are part of the effect's contract. Check for lingering particles, trails or retained instance state after the relevant release path. Do not require pooling, offscreen simulation or a new lifecycle framework solely to satisfy a comparison.

For rendering changes, follow the consuming project's technical-art and measurement rules. Keep workload evidence separate from the visual verdict: matched particle/draw/pass observations can explain changed work, but do not establish GPU cost. Record unavailable measurements explicitly and continue the visual comparison without waiting for a device build that the assignment did not authorize.
