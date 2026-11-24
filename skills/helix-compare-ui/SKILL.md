---
name: helix-compare-ui
description: Port and verify Phaser/Three.js web UI in Unity, including layout, responsive behavior, sprites, typography and input states. Use for views, dialogs and HUDs; route timing-focused transitions to motion comparison.
---

# Compare UI

For an existing issue, use `Tools/Helix/bin/helix discrepancy-resume --assignment BOARD-KEY --format summary` (or `--feature "FEATURE"`). For a routed issue, run `discrepancy-rerun --id ID --out NEW_DIR` to verify retained sides and obtain the next command. For new coverage, start with one matched view and real content. Apply the [shared scope and evidence requirements](../helix-reference/references/comparison-workflow.md#scope-and-prerequisites) to the pair.

Match native dimensions, safe area, state, language, text and scroll position as relevant. Map Phaser origins, logical scale and trim to the actual Unity framework. Compare final-output pixel bounds, hit regions and event order separately. Use native images and receipts to distinguish observations from hypotheses. Device-notch coverage needs an appropriate device or fixture.

## Find the supplying owner

Use the diagnostic that discriminates between the plausible causes. The named sections below are in `Tools/Helix/toolkit/UI.md` unless indicated.

- **Wrong bounds or shifting children.** Use `ui-layout-trace` with the same paired receipts and spec as `ui-compare`. Inspect the affected axis, mapped ancestor chain and baseline-within-rect drift. For precise ownership, inspect runtime layoutContext and UiAuthoring.InspectLayout. For grouped elements, use the relationships in `Scene.md` to measure internal spacing. Check responsive rules at the required viewports.
- **Wrong shared sprite or material.** Follow the scoped UiAuthoring.Inspect procedure in `Tools/Helix/toolkit/UIPort.md`. Trace the effective field to its prefab override and inspect other consumers. Compare GUID and local file ID, including state-swapped materials. Use [sprite usage](../helix-sprite-usage/SKILL.md) when a frame or packed page is in question.
- **Wrong font, wrapping or baseline.** Use [typography comparison](references/typography.md) on the affected element. Pin the actual content, font/material provenance, wrapping and bounds.
- **Authored value changes at runtime.** Use `visual-owner` (“Runtime visual property ownership”). Follow the referencing presenter or active animation binding at the failing phase. Trace the caller's data before editing a shared asset.
- **Scrim or overlay tint.** Use `ui-compositing-compare` on bounded native regions. A same-scene capture without the overlay on each side isolates its contribution. Preserve phase and background gaps.
- **Wrong input or visibility state.** Trace transition, sorting and input writers from the triggering action. Use [feature behavior](../helix-compare-feature/SKILL.md) for multi-step state or data changes and [motion](../helix-compare-motion/SKILL.md) for event timing.

## Implement and verify

For an authorized port, apply the [port recipe](../helix-reference/references/port-recipe.md) at the supplying Unity owner. Stage original frames with `ui-assets` if needed. For shared uGUI authoring use `ui-plan`, preview the supplying prefab operation, apply the reviewed plan hash through the supported authoring tool, and use `ui-impact` for affected declared cases. Use a reviewed `conversion-plan` manifest when linking an asset/layout plan to a verification matrix.

Check the affected states and viewports for layout, clipping and normal input as scoped. Keep the paired receipts, measured bounds, verified writer, changed field and impacted consumers with the existing case. Reuse unaffected evidence with current fingerprints. In a review, report the proposed edit and retest cases. Record any blocked controller, unobserved writer or unmatched state with the claim it limits.
