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

## Static batch adapter

An optional `batch` object in `reference.json` enables repeated static capture without reloading for each fixture. Keep all game hooks and scripts in the consuming project:

```json
{
  "batch": {
    "scripts": ["Tools/Helix/fixtures/static-preview.js"],
    "views": ["front", "side"],
    "reset": "(fixture, seed) => window.previewFixture.reset(fixture, seed)",
    "ready": "(fixture, seed) => window.previewFixture.isReady(fixture, seed)",
    "probe": "() => window.previewFixture.describe()",
    "view": "view => window.previewFixture.setView(view)"
  }
}
```

These function expressions illustrate an adapter API; the toolkit does not supply `window.previewFixture`. Script paths must resolve inside the consuming project. Provide the actual project-owned implementation and validate it in the running reference before expanding the matrix.

`reset(fixture, seed)` must remove previous fixture effects and deterministically establish the requested state, including owned timers, transient objects and camera settings. `ready(fixture, seed)` must verify the **new requested fixture and seed**, not merely that an old scene or canvas exists. `probe()` returns plain serializable state sufficient to identify the actual fixture and relevant settings. `view(view)` applies one of the declared view names and must establish the requested static view before capture. Load all dependencies needed by the requested views during reset/readiness; view switching must not lazily introduce unrecorded resources. Do not use a generic truthy readiness result as proof of correct setup.

Hashing the adapter and served resources establishes recorded dependencies, not semantic correctness of reset or readiness. Validate at least one warm reuse against a fresh-session result and retain the comparison. Motion, normal input, callback/guard behavior and cross-engine timing require their own evidence. Static batch configuration does not authorize Unity execution or replace its isolation and restoration procedure.
