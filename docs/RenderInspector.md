# Sprite and UI rendering inspector

The CLI collects the evidence described here. Viewer controls require a compatible project-owned Porting Workbench; the shared installer does not install a mod or browser development hooks.

`render-inspect` prepares read-only evidence for **Comparison → Inspect rendering** in the Porting Workbench. It uses the existing UI snapshot selectors and validators, optionally runs `sprite-usage` and `render-trace`, and accepts retained `UiCompositing.Inspect` observations. No Unity process is launched, no assets are imported or edited, and the mod does not collect or infer rendering state.

```sh
Tools/Helix/bin/helix render-inspect --spec render-spec.json --out .helix/evidence/render-01
```

The spec below uses descriptive SHA placeholders; replace them with lowercase 64-character SHA-256 values. Paths are relative to the spec directory (or absolute). Paths inside linked collector specs retain those specs' own path rules.

```json
{
  "schemaVersion": 1,
  "id": "status-icon",
  "reference": {
    "receipt": {"path": "reference/reference.json", "sha256": "RECEIPT_SHA256"},
    "selector": {"semanticId": "hud.status.icon"}
  },
  "candidate": {
    "image": {"path": "unity/unity.png", "sha256": "IMAGE_SHA256"}
  },
  "spriteUsage": {"path": "sprite-spec.json", "sha256": "SPEC_SHA256"}
}
```

The reference must select exactly one captured Phaser node. Its receipt must include the original image at its recorded path. An optional `candidate.snapshot` has the same `{receipt, selector}` shape and must select a uGUI node whose receipt hashes the supplied candidate image. Without it, candidate runtime properties stay unmeasured. The correspondence between selected nodes, candidate image and authored Unity target is explicitly project-declared; an image hash does not establish matching scenarios or capture phases.

Optional evidence:

- `spriteUsage`: a pinned **spec**, passed to the existing `sprite-usage` collector. It must resolve to the same reference receipt and selected node. This checks the Unity sprite path, GUID and local file ID and collects prefab consumers and atlas observations. See the sprite-usage section of the CLI guide (`docs/cli.md` in source, `Tools/Helix/Toolkit.md` when installed).
- `renderTrace`: a pinned **spec**, passed to `render-trace`. Its feature/pass/property summary is shown as **Related render trace**, never as proof of the selected object's material or pixel shader execution.
- `unityUi`: `{ "receipt": {"path":"ui-color.json", "sha256":"..."}, "prefab":"Assets/...prefab", "target":"Child/Graphic", "component":"UnityEngine.UI.Image", "field":"m_Color" }`. The receipt comes from the existing `Helix.Comparison.UiCompositing.Inspect` exporter. The command verifies binding fields and recorded asset hashes against this checkout. If a candidate snapshot supplies a prefab binding, it must agree. Serialized Graphic color, ancestor Canvas sorting and CanvasGroup alpha are shown separately from runtime observations. Generating a new Unity receipt follows the project's normal Editor isolation procedure; this command never starts an Editor.

The report retains engine-specific property values and their evidence basis. New Phaser UI snapshots include local alpha, corner tint integers (packed RGB), tint mode, blend mode and pipeline name. Older snapshots remain usable and show missing properties as **Unmeasured**. Local alpha is not effective inherited opacity, Phaser depth is not equivalent to Canvas sorting order, and a mask's presence does not establish clipped pixels or occlusion. Material execution, effective blend/opacity and missing candidate observations require further runtime evidence. Unity-only CanvasGroup and packed-atlas properties are marked **Not applicable** on the Phaser side and excluded from reference evidence gaps. Missing Unity observations remain **Unmeasured**. Reports encode the distinction as a null value with `basis: "not-applicable"`; older reports keep their recorded meaning until regenerated. There is no automatic equality or parity verdict.

## Review preparation

`reference.baseline` can replace `reference.receipt`, and `candidate.baseline` can replace `candidate.image`. Use baseline file paths relative to the inspector spec, without mixing both forms. The inspector resolves image/receipt pins; `workbench prepare` owns dependency freshness checks. A review case’s optional `renderInspection` spec path runs this collector automatically and verifies that both image hashes match the case. For multiple elements, use `renderInspections: ["status-icon.json", "status-text.json", "action-button.json"]` instead. The forms are mutually exclusive; lists contain 1–20 unique spec paths and each report must have a unique element ID within its case. Every inspection must match the same case image and receipt hashes and pass its baseline freshness checks. One comparison and one pair of input PNGs are packaged per case; element reports and their JSON evidence use separate numbered names. A failed element blocks the case and no completed bundle is produced. See [Automatic evidence baselines](EvidenceBaselines.md).

The output includes `render-inspection.json`, original receipts and images, the inspection spec, and collected raw reports. Existing output evidence is never overwritten. Each pinned evidence file is limited to 32 MiB; normal comparison/bundle pixel and file budgets still apply. The candidate PNG is fully decoded with CRC checking after its header passes the decoded-pixel limits, before any output is created.

Add the returned report path and hash to the corresponding case's `reports` list in a `workbench prepare` spec. The existing freshness flow checks the report pin; it does **not** recursively infer dependencies from that report. Declare the relevant capture/collector dependencies and their original baselines as usual. For the full raw report browser, include the other generated JSON reports as additional pinned reports. The inspector matches both image hashes, independent of report filenames.

For a focused manual review, package the inspector output directly:

```sh
Tools/Helix/bin/helix compare --reference .helix/evidence/render-01/reference.png --candidate .helix/evidence/render-01/candidate.png --out .helix/evidence/render-01/comparison
Tools/Helix/bin/helix workbench evidence --source .helix/evidence/render-01 --out .helix/evidence/render-01-bundle
```

Open `render-01-bundle/evidence.json` in the Workbench. Click an outlined element on either image, or choose **Element** above the images, to drive both the visual drill-down and **Inspect rendering**. Unselected elements use thinner, dimmer outlines. Clicks use native image coordinates at the current shared zoom/pan; dragging more than four screen pixels pans without selecting. Repeated clicks cycle overlapping elements (smallest bounds first); the selector also provides keyboard access. Overlay and difference views accept hits on either side’s captured bounds. Reports must match both image SHA-256 values. The CLI requires `native-top-left-pixels` on each supplied snapshot and records that coordinate space in the rendering report. Older reports without this field remain readable, but require regeneration before highlights and geometry deltas are enabled; unsupported explicit coordinate spaces are rejected on import. The viewer draws captured bounds as a cyan solid reference outline and a pink dashed candidate outline, and shows native-pixel X, Y, width and height with candidate-minus-reference deltas. Missing runtime bounds remain **Unmeasured**; serialized mappings do not supply image coordinates.

**Focus element** fits the union of both captured bounds. Both images keep the same pixel origin, scale and pan position, so focusing preserves layout offsets. Use **Fit captures**, **100%**, and **+/−** for shared zoom; drag either image or focus it and use arrow keys to pan both. Opacity overlay and the hash-verified CLI difference view retain the same navigation and outlines. Different image dimensions allow side-by-side review only. Bounds are axis-aligned capture evidence, not silhouettes, visible-pixel extents or proof of matching scenario state.

Expand **Inspect rendering** for the selected element's source/candidate properties, evidence basis and gaps. Raw reports and hashes stay under **Technical details**. Switching image pairs resets selection and navigation, and never reuses a report from another pair. Rendering reports and captured bounds are parsed outside navigation updates. Malformed captured bounds are rejected during bundle import, preserving the previous loaded bundle. Extraction, mapping and evidence preparation remain in the existing CLI; no new evidence format or collection command is required.
