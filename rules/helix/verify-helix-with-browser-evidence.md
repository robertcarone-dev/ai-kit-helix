---
name: Verify Helix with browser and Unity evidence
description: Use paired captures for Helix; Figma metadata is not a prerequisite.
enabled: true
tags: [assets-design, assets-tech, code, qa]
---

Select the verification method per criterion from the reference named in the assignment. For Helix appearance and layout, use paired native browser and Unity captures at matching states and viewports, including phone and iPad aspects for responsive layout. Figma frame IDs, node maps and frame-based `vision check` or `vision verify` apply only to criteria with a supplied Figma reference. For prefab changes, also run the applicable prefab audit and check that the screen is reachable when the task requires it.

Inspect scoped UI for:

- Composition, alignment, spacing and responsive layout.
- Typography, wrapping, colors, sprite proportions and layering.
- Masks, clipping, scrolling, safe areas and interaction states.
- Motion, transition timing and carousel behaviour using recordings when still images are insufficient.

Save paired captures with case IDs; annotate measurable differences and use overlays where useful. Distinguish rasterization differences from layout defects. Apply task acceptance criteria and approved tolerances; do not invent a whole-frame percentage threshold or require unrelated pixel perfection.

Keep valid existing audit or visual findings open until resolved or explicitly adjudicated with evidence. A screenshot does not erase a structural defect; an inapplicable Figma check does not establish a Helix defect or a pass.
