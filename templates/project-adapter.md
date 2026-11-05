# Project Helix adapter

Configure `Tools/Helix/reference.json` with this project’s exact Helix identity, viewports, inspected readiness expressions and scenarios. The initial template proves document loading only; verify visible rendering and real input before comparison.

Record source-to-Unity mappings, approved deviations, fixture scripts, testable states and exact setup/capture/cleanup procedures here. Unity execution remains unavailable until the project supplies its own verified isolation and capture recipes.

For managed test workflows, supply `workflow-adapter.json` with project-relative `verifiers.storage` and `verifiers.comparison` script paths, reviewed `capture-capabilities.json` and `test-routing.json`, and a `fixture-catalog.json`. See `Tools/Helix/Adapter.md` for their contracts. Never copy another game’s isolation claims or source hashes without review.
