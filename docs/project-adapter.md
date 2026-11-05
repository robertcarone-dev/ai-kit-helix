# Project-owned configuration

The installer never updates these files:

- `reference.json`: Helix project/variant/query, named viewports, `ready` JavaScript expression, optional `phaser` expression and `three.scene`/`three.camera` expressions, scenarios with `steps`, `ready`, optional `captureSteps` and `unity` command stages.
- `reference.local.json`: ignored machine overrides; merge `helix` fields, replace other top-level fields.
- `fixture-catalog.json`: map case IDs to procedure, files, supported state/trigger and scope. Referenced files must remain inside the project.
- `workflow-adapter.json`: `{"verifiers":{"storage":"Tools/Verification/storage.cs","comparison":"Tools/Verification/comparison.cs"}}`. Both required for isolated test execution. Scripts must return the existing AI Kit eval envelope with success true, a result beginning `PASS:`, and target projectPath matching the lane. Their path and hash are retained in preflight receipts.
- `capture-capabilities.json`: reviewed `maxSide`, `defaultMaxSide`, `maxSeconds`, and nonempty `sourceHashes` mapping project-relative recorder source paths to SHA256. Unknown hashes mean capability is unverified.
- `test-routing.json`: nonempty `sourceHashes` for reviewed paths inside the installed performance test package. Exactly one matching package is required before tests run.
- `project-adapter.md`: game identity/mappings, exact setup/cleanup procedures, save/preference isolation scope and limits, linked fixtures and approved deviations.

Keep fixtures, helper scripts, Unity code, scenes and assets in the project. A new project has no implicit Unity recipe. No helper may fabricate managed lane metadata, bypass compatibility verification or infer save isolation from worktree separation.

Unity stages are argument arrays for the installed `ai-kit` executable; placeholders are `out`, `scenario`, `width`, `height`, `capture`, `receipt`. Review the emitted plan before execution. Project-local helpers are responsible for game-specific setup and cleanup. Do not use empty source-hash profiles to claim verification.
