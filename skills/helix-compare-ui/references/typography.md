# Typography comparison

Use this reference for text cases within UI comparison, following the shared workflow's evidence contract.

## Establish comparable text

Match exact text, language, casing, formatting spans, available bounds and state. Record font family, asset/version, weight/style and fallback from inspected runtime data or source assets. Verify actual font/atlas readiness before capture and actual fallback selection where accessible; a configured family name alone does not prove the rendered font. Unknown provenance stays unmeasured.

Map the actual source renderer (Phaser Text, BitmapText, DOM text or another implementation) to the actual Unity text renderer; do not assume or require TextMeshPro. Phaser text properties are not DOM CSS. Distinguish bitmap-atlas glyph metrics from TTF/OpenType metrics and generated SDF glyphs/fallback chains. Record relevant atlas/SDF, material and scaling settings when inspected. Do not infer a font identity, weight or SDF parameter from screenshot resemblance.

## Compare

1. Measure rendered text bounds, baseline position, line count, wrapping points, line height and alignment in native pixels where evidence supports them.
2. Inspect glyph coverage, fallback substitutions, clipping, truncation, outline/shadow and spacing. Record exact affected characters and strings.
3. Separate layout and font-metric differences from rasterization, antialiasing or SDF appearance. Translate from observed glyph metrics and final-output scale rather than copying nominal font sizes; equal nominal sizes across renderers do not guarantee equal glyph dimensions.
4. Check the task's required long strings, languages and responsive variants; do not expand into unrelated localization coverage.

Deliver source-to-target renderer/font mapping, recommended or implemented Unity correction and affected retest cases, font provenance (including unknowns), exact strings, bounds and baseline/line measurements with methods, annotated crops, relevant renderer settings and a criterion-based disposition. If provenance is missing, report visible wrapping or clipping observations while leaving font attribution unmeasured. A crop or pixel score alone cannot establish typography parity.

Run the shared `typography-compare` command documented in Tools/Helix/toolkit/UI.md with paired native UI receipts. Compare rendered lines first, then baseline and advance deltas in native pixels, then inspect the native crops. Inspect the configured font mapping independently of visual weight or actual glyph fallback. Use the recorded Canvas scale and parent transforms to explain nominal size differences. Preserve incomplete criteria and resume actionable differences through the discrepancy workflow.
