---
name: helix-compare-lighting
description: Port and verify Phaser/Three.js web lighting and shading in Unity, including illumination, shadows, reflections and final rendering. Use for lighting parity; model geometry, motion and UI layout have separate specialties.
---

# Compare lighting

## Prerequisites

Read [the shared workflow](../helix-reference/references/comparison-workflow.md). Establish comparable geometry, material, camera, object state and background before attributing differences to lights. Map source lights, environment, shaders and compositing stages to their Unity counterparts. Record known pipeline settings and disclose unknowns.

Inspect available color-space, exposure, tone-mapping, quality, antialiasing and output settings in both renderers. Numeric PBR parameters are not necessarily equivalent across renderers; equal values do not establish equal appearance.

## Authorized implementation

Follow [the port recipe](../helix-reference/references/port-recipe.md). Map source texture-baked illumination, lights, environment and output transforms into the target rendering pipeline. Prove one representative material under the final camera and background before propagating tuning. Change one explanatory variable at a time; retain intended target settings and remove diagnostic overrides.

## Procedure

1. Prove one matched native capture with comparable state and unclipped regions of interest.
2. Distinguish illumination baked into textures from real lights. Record light direction/type, environment, shader features and shadow settings from inspected data where available. Unknown light setup makes those properties unmeasured; it does not block all image observations.
3. Compare highlight placement/extent, shadow direction/softness/contact, fill, contrast, reflections and background contribution in the final composite. Inspect render-target color conversion, alpha/premultiplication, transparent sorting and postprocessing where relevant. Name the affected object/region and distinguish observations from inferred causes.
4. For numerical image samples, retain the same corresponding regions and state the encoded color space and method. Pixel values are output-image measurements, not scene luminance or light intensity.
5. If diagnosis requires intervention, change one variable at a time using an authorized scoped fixture, retain baseline evidence and restore it afterward. For an authorized Unity port/fix, tune target materials or lighting to reproduce the source result, then recapture affected final composites; restore diagnostic overrides while retaining intended target changes. Do not modify the source reference.
6. Repeat affected cases at required quality/viewport variants; preserve unaffected cases. Route geometry uncertainty to [models](../helix-compare-models/SKILL.md) when it prevents attribution.

## Measurements and observations

Record shadow offsets or highlight bounds in native pixels, and angles/intensities only when inspected scene data supports their units. Explain output-pipeline differences before interpreting brightness or hue discrepancies. Matching output does not require equal numeric light intensity or shader parameters. Exact pixel comparisons remain diagnostic, especially across antialiasing and tone-mapping implementations.

## Deliverable and completion

Add the shared ledger fields plus known/unknown pipeline settings, matched geometry/material/camera identity, measured regions, one-variable experiments and remaining attribution uncertainty. Preserve baseline and fixture receipts separately.

Finish when each required lighting case has a supported disposition, temporary diagnostic/session changes are restored and intended port fixes are retained. Stop only the affected causal claim when its controls or pipeline data are unavailable; report observations and continue independent cases rather than inventing light settings.
