---
name: Verify Helix with browser and Unity evidence
description: Use paired captures for Helix; Figma metadata is not a prerequisite.
enabled: true
tags: [assets-design, assets-tech, code, qa]
---

For Helix work, compare browser captures with Unity captures at the same viewport and state. Never feed Helix into Figma-specific commands or invent Figma frame IDs or node maps. Missing Figma metadata is inapplicable, not a Helix verification blocker. Use Figma-specific checks only for an explicitly supplied, applicable Figma reference.

Inspect scoped UI for:

- Composition, alignment, spacing and responsive layout.
- Typography, wrapping, colors, sprite proportions and layering.
- Masks, clipping, scrolling, safe areas and interaction states.
- Motion, transition timing and carousel behaviour using recordings when still images are insufficient.

Save paired captures with case IDs; annotate measurable differences and use overlays where useful. Distinguish rasterization differences from layout defects. Apply task acceptance criteria and approved tolerances; do not invent a whole-frame percentage threshold or require unrelated pixel perfection.

Keep valid existing audit or visual findings open until resolved or explicitly adjudicated with evidence. A screenshot does not erase a structural defect; an inapplicable Figma check does not establish a Helix defect or a pass.
