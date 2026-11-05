# Port a technical-art feature

Use this recipe for authorized implementation. Keep review-only findings as a port brief.

1. Inspect the source asset or generator and its caller. Record parameters, textures, shaders and state dependencies; map each to an existing Unity counterpart or a scoped missing component.
2. Translate conventions before tuning appearance. Establish units, coordinate axes, pivots, parent transforms, camera projection, texture channels and the relevant color/time basis from actual source and target code.
3. Implement one representative counterpart through the project’s existing architecture. Follow the target repository’s asset-authoring rules. Preserve source behavior and unrelated Unity work.
4. Compare that counterpart in the final player composition. Use a disclosed isolate only to diagnose geometry, material, lighting or timing; restore diagnostic overrides before accepting the intended result.
5. Fix the identified cause, then extend to required variants affected by the implementation. Reuse evidence for cases whose dependencies are unchanged. Record deviations and missing coverage explicitly.

## Reusable fixture recipes

Before writing another scratch helper, inspect existing scenarios and repository tools for the same setup. Promote a successful reusable helper into a maintained project script with a small recipe containing:

- Case IDs and source/Unity counterpart identifiers.
- Supported variants, viewports and required input fingerprints.
- Initial state, exact trigger, readiness predicate and observation endpoint.
- Setup and cleanup commands, owned storage and output locations.
- Whether it uses normal input, a deterministic fixture or instrumentation, and which claims it supports.

Prove the recipe with one pilot before expanding coverage. Return only serializable data from browser evaluation; never return Phaser scene objects or engine graphs. Preserve receipts and cleanup results so another lane can execute the recipe without reconstructing setup from prose.
