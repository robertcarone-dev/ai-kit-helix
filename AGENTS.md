# Working on AI Kit Helix

This repository is the shared source toolkit. Consuming Unity projects receive a versioned snapshot through `scripts/install.mjs`. For installation or comparison work in a game, follow README.md and that game's project adapter and skills.

## Implementation boundaries

- Keep generic CLI code in `cli/`, evidence/workflow helpers in `workflows/`, shared instructions in `skills/` and optional obligations in `rules/`. Optional reusable Unity comparison infrastructure belongs in `unity/`.
- Keep game identities, scenarios, game-specific Unity helpers, fixtures, compatibility profiles, credentials and evidence in the consuming project. Shared tests use synthetic projects.
- `scripts/install.mjs` is the only installation implementation. `install.sh` checks prerequisites and forwards arguments; do not duplicate installation policy there.
- Preserve conflict detection, manifest hashes, project-file ownership and per-checkout session isolation. Resolve project context independently of this repository's location and propagate it to child processes.
- Do not silently enable Unity execution without supplied recipes and verified storage/compatibility prerequisites. Preserve receipts, native dimensions and the distinction between fixtures and player input.
- This repository does not patch AI Kit or own its managed lanes. Use the target project's supported lifecycle for any authorized live pilot.

## Verification

Use Node >=22.18 and Python >=3.10. Run `npm ci` before the first dependency-backed check. For changed runtime, installer or workflow behavior, run the relevant `npm test` and/or `npm run test:workflow` suite. Test installer changes in disposable projects, including conflicts and preservation of project-owned files.

For Unity helper changes, also run `npm run test:unity` when a supported Editor and local Newtonsoft JSON package are available. Set `UNITY_EDITOR` to the absolute Editor executable and `UNITY_NEWTONSOFT_PACKAGE` to the existing package directory. This runs `scripts/test-unity.mjs` in a retained temporary synthetic project; inspect its result and Editor log. Report unavailable live Editor validation explicitly, and keep synthetic helper checks distinct from backend end-to-end execution and game parity.

For shell-wrapper changes, run `sh -n install.sh`, then smoke-test help, argument forwarding from another working directory, and paths containing spaces. For instruction-only changes, check links, command accuracy and skill discovery paths; no live Unity session is required.

Changes to installed payloads need a reviewed installer preview/update in any consumer being migrated. Source-only README, wrapper and contributor-instruction changes do not require reinstalling a game snapshot. Do not edit a consumer as an incidental part of toolkit maintenance.

Report automated checks separately from live browser/Unity evidence. Never claim game parity from unit tests or synthetic fixtures. Update documentation when the installation or adapter contract changes; commit and publish only when requested.
