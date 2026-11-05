---
name: Run and validate the Helix reference
description: Use the configured live Helix preview, verify identity and input, and retain actionable launch failures.
enabled: true
tags: [assets-design, assets-tech, code, qa]
---

Use the repository-owned `Tools/Helix/bin/helix` CLI and `Tools/Helix/reference.json`. Load the `helix-reference` project skill when available; otherwise follow `Tools/Helix/Toolkit.md`. A modified AI Kit app is not a prerequisite. Resolve the configured `helix.project` and `helix.variant` through the local Helix catalog; latest locally pulled content is accepted. `start` opens installed Helix Desktop on macOS when needed and requests its preview. Reuse an unchanged session. Do not silently substitute an archived HTML export, another project or another variant. Do not recreate a Vite installation, stub framework dependencies or alter reference source to make it launch.

Before comparing, verify visible rendering, the target state and actual input response; a server response or readiness expression alone is insufficient. Record the native viewport, selected scenario, loaded-source hashes and diagnostics. Record resolved project/variant identity; loaded-content hashes do not prove a source commit. An explicit preview URL override has unverified preview identity. Check state equivalence with Unity before judging appearance.

Keep normal pointer navigation evidence separate from fixtures and instrumentation. A scripted page selection, frozen carousel or seeded level does not prove the corresponding player interaction.

On launch failure, retain the exact error and available console/network evidence. Retry only after a recorded prerequisite, configuration or diagnostic hypothesis changes; do not repeat unchanged startup attempts. Report an unavailable matching preview as a blocker. Stop only sessions and servers you own.

The Unity pairing procedure is in `Tools/Helix/project-adapter.md`.
