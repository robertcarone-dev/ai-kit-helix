# Object discovery and selection

These commands use the CLI-owned browser and require project-owned development hooks. Install those hooks separately; the toolkit does not implement a Phaser/Three object walker or change the game. Start an owned session with `start --workbench yes`, navigate to the relevant state through the project's scenario API, then discover objects.

```sh
Tools/Helix/bin/helix objects list --match NAME
Tools/Helix/bin/helix objects inspect OBJECT_ID
Tools/Helix/bin/helix objects selector OBJECT_ID --out selector.json
Tools/Helix/bin/helix objects resolve --selector selector.json
Tools/Helix/bin/helix objects explain --selector selector.json
Tools/Helix/bin/helix objects capture --selector selector.json --view isolated --out NEW_CAPTURE_DIR
Tools/Helix/bin/helix objects list --engine three
Tools/Helix/bin/helix objects inspect OBJECT_ID --engine three
```

Use the returned object ID, not a descriptive hierarchy path. IDs belong to the document/object lifetime and cannot select objects in another browser or viewer. Rediscover after a scene restart. Reusable selectors are project API data; store authored selectors in the consumer, never in the shared toolkit. `selector` can write a new JSON file without overwriting it. Target commands accept exactly one ID or `--selector FILE`.

## Browser API contract

Expose `window.__portingWorkbench.objects` for Phaser or `.threeObjects` for Three, each with `version: 1`. The client calls `list(match)`, `inspect(id)`, `selector(id)`, `resolve(selector)`, `explain(id)`, and, for Phaser only, `capture(id, view)`. Operations can return promises except selector resolution, which must return synchronously. Responses must be serializable. Reusable-selector operations require the selector, resolve, and explain functions together.

Resolution returns `{kind: "helix-object-resolution", status, matches}`. A unique match uses `status: "resolved"` and `matches[0].id`. Missing/ambiguous results are returned without choosing an object or creating capture output and yield CLI exit code 2. Invalid command input or unavailable APIs yield exit code 1. The project API owns selector validation, uniqueness, lifetime checks, and renderer-specific observations. The CLI does not infer selectors from names.

Phaser capture requires `--view context|isolated` and a new output directory whose parent exists. Its response includes a PNG `dataUrl` and `canvas: {width, height}`, plus the project's object/observation metadata. The client validates the PNG header and native dimensions, then writes `object.png` and `object.json`, including PNG SHA-256, session/configuration provenance, and the requested selector when supplied. Maximum dimensions are 8192 per side and 16,777,216 pixels per image. These are diagnostic receipts, not dependency baselines or matched Unity captures.

The project implementation owns temporary visibility changes and restoration on success, error, timeout, or object destruction. It must describe whether the capture includes other canvases/DOM, what it isolates, supported renderer types, bounds coordinates, and animation timing. Object bounds and rendering explanations are observations, not proof of occlusion, actual pixel shader execution, effective composition, or parity. Do not present snapshots from separate frames as synchronized captures.

Three discovery, selector resolution, inspection, and explanations are read-only. Three object capture is explicitly unsupported; use the existing scene/debug capture commands. See [Workbench](Workbench.md) for hook/session ownership and [Evidence baselines](EvidenceBaselines.md) for freshness requirements.
