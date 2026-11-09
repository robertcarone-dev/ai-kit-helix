---
name: Author editable Helix motion
description: Require sparse source-aligned animation, explicit clock and property ownership, and visible Edit Mode preview.
enabled: true
tags: [assets-design, assets-tech, code, qa]
---

For authorized animation ports, follow the [editable animation contract](../../.claude/skills/helix-reference/references/animation-porting.md) and the [motion comparison skill](../../.claude/skills/helix-compare-motion/SKILL.md), together with the consuming project's authoring and verification rules.

Author fixed trajectories as sparse editable clips with tuned curves. Do not deliver uniform per-frame bakes or procedural copies of fixed motion. Preserve source timing, discontinuities, rotation winding, overlaps against the current underlying pose, and independent continuous phases. Keep genuinely state-dependent motion procedural with one final writer per property and one owning event clock.

Make clips visibly scrub in the Animation window in Edit Mode and restore original transforms and prefab overrides on exit. Keep preview free of gameplay clocks and dynamic simulation. Compare live composed motion, including overlaps and loop seams; an old Unity bake or matching endpoint is insufficient evidence.

When an external state machine owns animation time, remove obsolete Animator transitions, parameters, bindings, and constants after reference inspection. Retire unused clips/states only within authorized scope, and maintain a project-owned mapping to the active sparse assets and dynamic owners. Keep game-specific assets, timings, fixtures, and evidence out of the shared toolkit.
