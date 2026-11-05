---
name: helix-reference
description: Run the Phaser/Three.js Helix web reference for porting and verification in Unity. Diagnose launch, collect source evidence and route scoped asset, feature or UI comparisons to the relevant specialty.
---

# Helix reference

Use this entry point to port or verify Helix web assets, features and UI in Unity, including reference setup, evidence collection and comparisons spanning several visual domains. For a single domain, load its specialist directly.

## Prerequisites

Read [the shared comparison workflow](references/comparison-workflow.md) before collecting or accepting evidence. Follow `Tools/Helix/Toolkit.md` for installation and commands. Node.js 22.18 or later must be on the worker's `PATH`, and Helix must be installed and set up with the configured project pulled locally. `start` discovers the configured project and variant and opens Helix Desktop on macOS when needed; latest local content is accepted. No modified AI Kit app is required.

## Route the task

- [Feature behavior](../helix-compare-feature/SKILL.md): inputs, guards, event/state sequences, feedback and data effects.
- [Models](../helix-compare-models/SKILL.md): shape, proportions, visible surface artifacts, pivots and material-versus-geometry diagnosis.
- [Lighting](../helix-compare-lighting/SKILL.md): illumination, shadows, reflections and output-pipeline differences.
- [Motion](../helix-compare-motion/SKILL.md): animation, timing, trajectories and transitions.
- [UI](../helix-compare-ui/SKILL.md): layout, responsive states, sprites and typography.

Read only the specialty needed for the current case. A full visual audit may use several, with one shared evidence ledger.

## Procedure

1. Establish case IDs, required coverage, source-to-Unity mappings and whether the task is review-only or an authorized port/fix using the shared workflow.
2. Run `Tools/Helix/bin/helix doctor`; inspect browser installation and catalog discovery, not just process exit status.
3. Start or reuse the checkout's session with the required viewport. Use `status`, then a named `scenario` and `look` as appropriate.
4. Prove one representative case, check its receipts and render, then collect the remaining required cases.
5. Use `capture` for native PNGs, `record` for motion, and `compare` for diagnostic image pairs. `unity-plan` emits the configured argument arrays for the selected AI Kit or Unity CLI backend; execute and restore them using the shared workflow. Follow the specialist's measurement procedure.
6. Restore owned Unity state, stop owned browser work when finished, and hand off the ledger and accessible evidence.

`look` inspects Phaser and, only when `config.three` is present, configured Three.js data. Inspect the selected configuration and its scope: a gameplay-board mapping does not automatically cover lobby or mascot scenes. It is not a generic model, font or animation probe. Additional measurements need an inspected project fixture or explicit instrumentation.

## Result and stopping condition

Deliver the shared case ledger with source-to-target mapping, reference identity, setup, expected/actual results, evidence, recommended or implemented Unity fixes, retest cases and restoration receipts. For launch diagnostics, add the exact failing command, error and changed prerequisite needed to proceed. Completion means every required case has a supported status; blocked or unmeasured cases remain explicit and do not become passes.


For configured Unity/backend captures, follow `Tools/Helix/WorkflowToolkit.md` and the project's adapter. Use the readiness/motion helper only after a reviewed live pilot; do not invent hooks or copy another game's fixtures. Record before actions, verify first/last event coverage, and restore owned state. Use delivery receipts to distinguish implemented, validated and integrated work. Reuse evidence only when its declared inputs and bytes remain valid.
