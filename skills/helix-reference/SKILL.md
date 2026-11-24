---
name: helix-reference
description: Run the Phaser/Three.js Helix web reference for porting and verification in Unity. Diagnose launch, collect source evidence and route scoped asset, feature or UI comparisons to the relevant specialty.
---

# Helix reference

Start with the named feature, state and visible difference. Run the installed launcher, `Tools/Helix/bin/helix`, from the consuming checkout. The project adapter owns scenario IDs, Unity recipes and lane access.

- Continuing an issue? Run `discrepancy-resume --assignment BOARD-KEY --format summary` or `--feature "FEATURE" --format summary` to locate its latest record and next action. The summary skips evidence checks. For reuse, run `discrepancy-resume --id ID` in its default full format or, for a routed UI issue, `discrepancy-rerun --id ID --out NEW_DIR` to check which sides need capture.
- Implementing a new port? Start at the web asset or generator and its caller. Trace the corresponding Unity owner and implement one representative variant using the [port recipe](references/port-recipe.md).
- Collecting or judging a pair? Use [scope and evidence requirements](references/comparison-workflow.md#scope-and-prerequisites). Keep full reports on disk. Bring the selected IDs, changed inputs, first relevant error or measurement, and artifact paths into the conversation.

Choose the skill for the question that determines the next edit.

- [Feature behavior](../helix-compare-feature/SKILL.md) for actions, guards, transitions and data effects.
- [Models](../helix-compare-models/SKILL.md) for shape, pivot, topology, UVs and material boundaries.
- [Lighting](../helix-compare-lighting/SKILL.md) for shadows, reflections, illumination and final output.
- [Motion](../helix-compare-motion/SKILL.md) for timing, easing and trajectories. [Transient VFX](../helix-compare-vfx/SKILL.md) covers effect phases, compositing and cleanup.
- [UI](../helix-compare-ui/SKILL.md) for layout, text and input states. [Sprite usage](../helix-sprite-usage/SKILL.md) traces a frame to its prefab consumers and packed atlas.
- [Render trace](../helix-render-trace/SKILL.md) for a camera, renderer feature, pass or texture consumer.

## Capture and diagnose

1. Use Node 22.18+ and a locally pulled Helix Desktop project for live browser work. For launch failures, run `doctor` and inspect its error, browser installation and preview provisioning phase. Retry when the reported prerequisite changes.
2. For a manual live capture, start or reuse the owned session at the requested viewport, select the named scenario, and verify readiness and visible state. A matrix or routed rerun manages its own session. `look` sees the configured scene and cameras. For a hierarchy mismatch, use a scoped `scene-look --profile NAME` and the “Scoped capture profiles” section of `Tools/Helix/toolkit/Scene.md`.
3. Use `capture` for native PNGs and `record` for named-scenario video. For a missing replay, use `fixture-list` to find a related setup, inspect the actual input and expected outcome, then register a project fixture with `fixture-create --spec FILE`. Run `fixture-record ID --out NEW_DIR` and inspect the action receipt and clip. Use `fixture-handoff` when delivering clip-relative notes.
4. For paired Unity capture, inspect the configured backend with `unity-plan` and use the project's isolated setup, readiness and restoration procedure. Verify one matched pair before expanding coverage. Preserve the case ledger, restoration receipt and any missing prerequisite.
