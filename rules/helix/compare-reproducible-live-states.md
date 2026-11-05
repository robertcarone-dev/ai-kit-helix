---
name: Compare equivalent live states and viewports
description: Match reference and Unity state, dimensions and timing before judging a difference.
enabled: true
tags: [assets-design, assets-tech, code, qa]
---

Compare the running Helix reference with the running Unity game in Play Mode. Do not run game builds or Production checks. Prefab previews and source inspection are supplementary evidence.

For each scoped case, record:

- Reference identity and Unity checkout, commit and uncommitted changes.
- Browser viewport in CSS pixels, device pixel ratio and zoom; Unity render dimensions, aspect ratio and safe-area configuration.
- Variant, navigation steps, initial progress, balances, offer state, scroll position and any debug setup.
- Capture timing relative to entry or interaction; control random state when possible and report remaining variability.

Use matching logical viewport dimensions and equivalent states. For UI/layout changes, compare at a phone aspect and an iPad aspect, recording actual dimensions and orientation. Account explicitly for safe-area differences. Do not stretch captures to conceal mismatches.

Use disclosed deterministic fixtures for scoped geometry, material, lighting and motion comparisons. Test normal navigation, guards and callbacks separately when they are acceptance criteria; visual-only cases do not require unrelated interaction coverage. Direct state mutation does not prove player input. Repeat from a known initial state; do not compare unrelated carousel frames or animation phases.
