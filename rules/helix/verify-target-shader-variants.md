---
name: Verify shader variants on the target device
description: Check material keywords during porting and verify affected draws in the next authorized target player.
enabled: true
tags: [assets-design, assets-tech, code, qa]
---

During porting, run `Tools/Helix/bin/helix material-keywords --out EMPTY_DIR` in the assigned checkout. Read the mismatch locations, review items and unscanned paths in `material-keywords.json`. Resolve confirmed authoring errors at the owning material, generator or shader, then rerun into a fresh directory. An unresolved parent or fallback needs source inspection before changing keywords.

For the affected draw, inspect each affected material's shader reference, serialized keyword selections and any keywords set at runtime. Match each reachable combination to the declarations for the pass that draws it. For a keyword enum, check the default selection on older materials as well as explicitly selected values. Consider the active render pipeline, quality tier and player variant stripping. Keep strict variant matching enabled where configured.

Use the isolated Editor for routine port comparisons. Record the affected scene, material, triggering state and target tier for the device check. Use the next scheduled or already-authorized player containing the change. Routine porting does not authorize a new player build. Until that candidate and device are available, record target-device verification as pending.

Before promoting the candidate, inspect its shader compiler diagnostics for the target graphics API. On a physical target device, capture the player log from before scene entry, exercise the affected draws and keyword transitions on the intended quality tier, and capture the rendered surfaces. Attach the build ID or revision, device, OS, graphics API, quality tier, reproduction steps, image and relevant log excerpt to the [comparison verdict](record-helix-comparison-verdicts.md).

Hold promotion if the affected draw uses the error shader, reports a missing variant, or has a target shader compilation error. Record the shader, pass and keyword combination from the diagnostic where available. Recheck the same draw in the next authorized candidate containing the correction.
