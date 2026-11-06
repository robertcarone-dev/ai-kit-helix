---
name: helix-compare-ui
description: Port and verify Phaser/Three.js web UI in Unity, including layout, responsive behavior, sprites, typography and input states. Use for views, dialogs and HUDs; route timing-focused transitions to motion comparison.
---

# Compare UI

Route multi-step feature state/data semantics to [feature behavior](../helix-compare-feature/SKILL.md); retain scoped input and state checks needed to verify the UI.

## Prerequisites

Read [the shared workflow](../helix-reference/references/comparison-workflow.md). Match native viewport, orientation, safe area, language, exact text, navigation state, balances/offers, scroll position and selected carousel page where relevant. Record fixture use separately from normal navigation.

Map Phaser origins, containers, cameras, logical scale and layout, plus sprite trim/atlas metadata, to the actual Unity framework. For uGUI this may include CanvasScaler, RectTransform anchors/pivot and Image/RawImage; do not force that framework when the target uses another.

For text cases, read [Typography comparison](references/typography.md). Do not infer font family or loaded fallback from appearance alone.

## Authorized implementation

Follow [the port recipe](../helix-reference/references/port-recipe.md). Map source layout and sprite/font assets to the target UI framework. Implement a representative view with real content and its responsive constraints, then verify the final phone/tablet composition before extending affected states. Diagnose asset trim, typography metrics and state mismatch before compensating with layout offsets.

## Tool support

Read `Tools/Helix/UI.md` for `ui-look`, `ui-compare` and the explicit matrix runner. Prefer semantic bindings and supplied project specs. Inspect report prerequisites and unmeasured checks; a generated report or passing synthetic test is not live parity. The native Game-view adapter does not establish device-notch coverage.

For asset transfer and uGUI layout planning, read `Tools/Helix/UIPort.md` and the project's UI conversion adapter when present. Use `ui-assets` to stage original frames, `ui-plan` for a reviewable proposal, and `ui-impact` to narrow recapture to affected declared cases. Use a reviewed `conversion-plan` manifest to retain hash-pinned semantic links across asset/layout plans and verification matrices. Keep selectors, parent mappings, state meanings and gameplay callbacks project-owned. Do not infer responsive anchors from a single image or write prefab YAML. Report blocked layout controllers and unmeasured effects explicitly; a plan or dependency match is not visual acceptance.

For broader hierarchy and grouped-element diagnosis, read `Tools/Helix/Scene.md`. Compare explicit semantic mappings in screen space before adjusting local transforms. Keep unresolved matches and unsupported clipping/camera cases explicit. Select a scoped layout profile containing every required element. Prefer a scene-enabled matrix case when the project adapter supports inline scene receipts; use `scene-report` to inspect paired crops and overlays. Use relationship checks for internal gaps, centers, ratios and measured baselines, and project-owned style roles for repeated components. A group union does not verify its internal spacing or order; continue element-level UI measurements and inspect native images.

## Procedure

1. For an existing feature, run `Tools/Helix/bin/helix discrepancy-resume --feature "FEATURE"` first. If the brief gives only a board key, use `discrepancy-resume --assignment BOARD-KEY`. Inspect the open ID, element, viewport, state and evidence checks. Plan `discrepancy-rerun --id ID --out .aikit/scratch/ROUND` for a routed issue. Follow its next command in the assigned workspace. Read the paired crops when both sides are current. Record missing fixture readiness as the next action on the same ID. For a new feature or uncovered case, prove one representative view at a required viewport and inspect the native receipts, visible content and equivalent state.
2. Map both render paths into final-output pixels, then compare element bounds, alignment, spacing, anchors and layering. Distinguish screen-space bounds from local transform values.
3. Inspect clipping/masks, scrolling, safe-area response, sprite aspect, atlas trim and nine-slice behavior. Verify input hit regions separately from visible bounds. Identify whether mismatches originate in layout, assets, text metrics or state before proposing a cause.
4. Check required phone/tablet, orientation, content-length and state variants. Infer responsive rules only from sufficient cases or inspected layout data; one screenshot does not establish an anchor rule.
5. For a shared control, inspect the bound sprite, TMP font and material fields with the scoped UiAuthoring.Inspect overload in UIPort.md. Follow its source chain and check consumers before proposing a change. If a state swaps material, inspect the adapter-declared component field that supplies that state. Compare atlas GUID and file ID. Preview the operation on the supplying prefab, apply the reviewed hash, and use ui-impact for other consumers. Apply the typography reference to scoped text. Use inspection/source data for renderer properties; Phaser text is not DOM text, so do not claim CSS properties without evidence.
6. Verify scoped UI state transitions, input response and gameplay-facing effects against the web behavior. Use paired images and annotations to substantiate differences. Route interaction timing to [motion](../helix-compare-motion/SKILL.md) when needed; a static screenshot does not verify a transition.

## Measurements and observations

Record pixel bounds/gaps and coordinate origin, plus normalized ratios only when useful. Distinguish measured wrapping/line count from hypotheses about font or layout settings. Exact pixel scores can reflect rasterization; assess the task's criteria and approved tolerances rather than assigning a whole-frame percentage threshold.

## Deliverable and completion

Add the shared ledger fields plus source-to-target layout/framework mapping, view/state and input behavior, viewport/safe-area/language/text, element identifiers, measured bounds/gaps, clipping or responsive findings and relevant font provenance. Link annotated native captures and inspection receipts.

Finish when each required view/state/viewport case has a supported disposition and cleanup is verified. Stop only affected claims when content, state, native dimensions or typography provenance cannot be matched; mark them unmeasured or blocked and continue independent cases without reducing required coverage.
