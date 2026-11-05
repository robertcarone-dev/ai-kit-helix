---
name: helix-compare-models
description: Port and verify Phaser/Three.js web assets in Unity through model shape, proportions, pivots, material/texture assignments, UVs and surface evidence. Use for asset parity; route lighting-only, motion-only or UI layout work to its own specialty.
---

# Compare models

## Prerequisites

Read [the shared workflow](../helix-reference/references/comparison-workflow.md). Identify the corresponding reference and Unity objects, their supported variants and accessible inspection data. Map source asset IDs or procedural mesh generators and parameters to Unity meshes/components/shaders. A missing counterpart supports source capture and a port brief; create it only when implementation is already within task scope.

Match equivalent projected views, aspect, pose and visible state; compare camera projection/pose parameters only for applicable 3D counterparts. Translate unit scale, handedness, axes, pivots, parent transforms and camera projection from inspected source data into the Unity conventions; do not copy numeric transforms blindly. If these are unknown, label world-space measurements unmeasured; do not derive them from pixels alone.

## Authorized implementation

Follow [the port recipe](../helix-reference/references/port-recipe.md). Map a file asset or procedural generator into Unity mesh data, preserving the inspected topology, pivot, normals, UVs and material boundaries that matter to the case. Prove one mesh/material pair in the final scene before extending generator parameters or variants. Diagnose geometry separately from shader response before changing either.

## Procedure

1. Prove a representative final-output view, preserving intended game crop/clipping. Full-silhouette measurements require the scoped silhouette to be visible and framing to be comparable; label unseen geometry unmeasured rather than invalidating the final-composite case.
2. Compare shape first under comparable illumination. Use authorized existing fixtures to isolate geometry when needed, preserving original captures and disclosing the fixture. Diagnostic isolates supplement, rather than replace, the final composed player-output comparison.
3. Measure silhouette bounds and relative proportions in native pixels. When inspected transforms/mesh bounds are available, separately report dimensions, pivot offsets and axes in their stated coordinate system.
4. Use front, side and three-quarter views only where the acceptance criterion needs them and reproducible camera control exists. The CLI has no camera preset command; otherwise record the unavailable view.
5. Inspect contour breaks, normals-related shading, seams, intersections and material boundaries. Where source assets/generators and shaders are available, compare normals/tangents, winding/culling, material/texture assignments, UV scale/orientation/seams, texture channels and color-space imports for base-color, normal, roughness and metallic inputs. Derive conversions from the actual shaders; do not assume a universal channel swizzle or roughness formula. Classify each difference as geometry, material, lighting, fixture or unresolved; explain the evidence rather than assuming a shader defect is a mesh defect. Equal PBR input values across renderers do not establish equivalent appearance.
6. Check required object variants using the proven setup, reusing unaffected evidence. Route illumination diagnosis to [lighting](../helix-compare-lighting/SKILL.md) only when necessary.

## Measurements and observations

Separate image-space silhouette measurements from world-space mesh or transform measurements. Record projection and view for each result. Apparent size can change through camera distance or field of view; a screenshot alone does not establish mesh scale, topology, pivot position or polygon count. Treat visual impressions as observations until supported by inspected data.

## Deliverable and completion

Add the shared ledger fields plus file-asset versus runtime-generator provenance, source-to-Unity conversion and import decisions, counterpart IDs, projection/camera setup, unit/axis mapping, measured dimensions or ratios, view coverage and difference classification. Link annotated captures and the source of any mesh/transform values.

Finish when every required model/view case has a supported disposition and cleanup is verified. Stop the affected measurement when framing, counterpart identity or units cannot be established; retain valid image observations, mark missing measurements explicitly and continue independent cases.
