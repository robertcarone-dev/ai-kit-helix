# Debug views

Image comparison, UI comparison and scene review include a synchronized **Debug view** selector. It applies to both images, mapped crops and scene bounds. The existing exact RGBA difference image remains labelled separately. Diagnostic views support investigation; final appearance decisions use the final render at the matching checkpoint.

## Retained 2D images

Run from the consuming project root:

```sh
./Tools/Helix/bin/helix debug-image --input path/to/capture.png --out .helix/evidence/debug-image-01
./Tools/Helix/bin/helix compare --reference path/to/reference.png --candidate path/to/unity.png --out .helix/evidence/debug-pair-01
```

`debug-image` exports `final.png`, `luminance.png`, `hue.png`, `saturation.png`, `value.png`, `alpha.png`, `debug.json` and `review.html`. The comparison commands expose the same views in their existing `review.html`. Every output directory must be fresh. Inputs retain native pixel dimensions. Each generated view is computed from the original PNG channels, including low-alpha RGB.

| View | Definition |
| --- | --- |
| Luminance | Decode sRGB, then `0.2126 R + 0.7152 G + 0.0722 B`. Store the linear result directly as grayscale. |
| Hue | HSV from encoded sRGB. Grayscale 0..1 traverses red, yellow, green, cyan, blue, magenta, red. Saturation or value below 0.01 is magenta. |
| Saturation | HSV saturation, grayscale 0..1. |
| Value | Maximum encoded RGB channel, grayscale 0..1. |
| Alpha | Stored alpha channel, grayscale 0..1. |

Fully transparent pixels are black in color diagnostics. Alpha reveals transparency only when the source capture retained it. Browser screenshots and flattened Unity captures commonly have uniform alpha. Hue is cyclic, so the ends of its grayscale ramp are adjacent colors. The viewer supplies visual comparisons, with no scalar hue-difference score. Derived image views assume sRGB inputs; renderer data captures below have their own encoding and coordinate receipts.

## Three.js renderer captures

```sh
./Tools/Helix/bin/helix debug-capture --view mesh-normal --out .helix/evidence/debug-normal-01
```

Select a ready named scenario in an owned Helix browser session first. The command uses the existing `three.scene`, `three.camera` and `three.renderer` expressions from `reference.json`, with optional `three.debugRoot` selecting one object hierarchy, renders synchronously, writes the native Three canvas to `reference.png`, then restores the scene materials and background and redraws the original scene. It records view, camera matrices, canvas size, shader material names, source identity and cleanup in `debug.json`.

The utility `src/browser/three-debug.js` also exposes `window.helixThreeDebug.capture({ scene, camera, renderer, view })` for project adapters. The renderer must be a WebGLRenderer targeting its canvas. Select a mesh-only scene or `debugRoot` hierarchy with Standard/Physical materials. Renderable objects outside the selected hierarchy are temporarily hidden. Shadow maps are refreshed for the diagnostic scope and again after restoration. Missing UVs, tangents and shader chunks fail clearly. Custom `onBeforeCompile` hooks are retained, but custom shader output must retain the required Three shader chunks. The diagnostic captures the Three canvas, whose size and rectangle can differ from the full game composition.

Supported modes are `silhouette`, `material-id`, `shadow-attenuation`, `mesh-normal`, `shaded-normal`, `uv`, `uv-checker`, `tangent`, `tangent-sign`, `depth`, `base-color`, `material-alpha`, `roughness`, `metallic`, `specular`, and `lighting-only`.

- Normals and tangents use view space, encoded as `vector * 0.5 + 0.5`. Mesh normals precede normal-map evaluation. Shaded normals use the fragment's lighting normal.
- UV modes use raw UV0, with wrapping per tile and a ten-cell checker. Texture transforms and alternative texture channels need separate inspection.
- Depth is camera distance normalized using the recorded near/far values. Agree on depth range and unit conversion before comparing captures.
- Base color and material alpha use evaluated material inputs. Specular uses direct plus indirect specular lighting from the shader. Diagnostic values are stored directly, with tone mapping, display conversion, fog and dithering disabled. RGBA8 clips lighting above 1.
- Lighting-only replaces base color with white, removes texture color, metallic, emission, AO, clearcoat, transmission and sheen, and sets roughness to 1. It retains normal maps and the existing light/environment setup.
- Diagnostic materials write opaque channels with depth writes enabled. Source culling, alpha clipping and shader vertex deformation still affect Three captures. Canvas alpha support is recorded.

Material IDs require `three.debugMaterialIds` in the project adapter, mapping each source material UUID or unique nonempty name to a semantic ID such as `can-body`. Use UUIDs when names are missing or duplicated. The browser utility accepts the same map as `materialIds` and an optional `root` object. Both engines hash UTF-8 IDs with FNV-1a and use the low three bytes as RGB. Supply identical semantic IDs for corresponding material regions. Shadow attenuation uses Three's product of shadow visibility terms from all shadow-casting lights.

## Unity comparison helper

The helper uses Unity 6000.3 / URP 17.3 assemblies. Call it through the existing authorized Unity recipe on the intended isolated project. It performs no scene discovery or camera setup.

For paired native gameplay captures, the project adapter must explicitly create and size the Game view in each owned session, wait for a rendered frame, and validate its native dimensions before capture. Restoration may close a Game view created during that round. Offscreen debug PNG dimensions do not establish native Game-view readiness.

For an owned comparison session after `ComparisonSession.Capture(output)`:

```csharp
Helix.Comparison.ComparisonSession.CaptureDebugImage(output, "luminance");
```

For any retained source PNG:

```csharp
Helix.Comparison.DebugViewCapture.ExportImage(sourcePng, freshOutputDirectory, "alpha");
```

For selected static mesh geometry:

```csharp
Helix.Comparison.DebugViewCapture.CaptureGeometry(camera, selectedMeshRenderers, "mesh-normal", width, height, freshOutputDirectory);
```

Geometry modes are `material-id`, `silhouette`, `mesh-normal`, `uv`, `uv-checker`, `tangent`, `tangent-sign`, and `depth`. This pass draws selected static meshes with their actual transforms, opaque backface culling, and a transparent clear color. It records its geometry-override method. Skinned deformation, shader displacement and alpha clipping need the project's actual shader capture path. The normal, UV and depth encodings match the Three geometry descriptions above. Camera and object correspondence must still be established.

For `material-id`, supply the final optional `string[] materialIds` argument with one semantic ID per submesh, in renderer/submesh order.

For actual URP material evaluation:

```csharp
Helix.Comparison.DebugViewCapture.CaptureMaterial(camera, allVisibleRenderers, "lighting-only", width, height, freshOutputDirectory);
```

URP modes are `shadow-attenuation`, `base-color`, `shaded-normal`, `material-alpha`, `smoothness`, `metallic`, `occlusion`, `emission`, `specular-color`, `lighting-only`, and `reflections`. They use a synchronous single-camera render request with postprocessing disabled. Existing Rendering Debugger overrides must be cleared first. Temporary camera clear settings, debug settings and render resources are restored in `finally` blocks.

Supply all renderers visible to the diagnostic camera. The helper validates declared shaders against supported URP Lit, Simple Lit and explicitly opted-in custom shaders. Other shaders fail clearly until their debug paths are integrated. Custom shaders opt in with the SubShader tag `"HelixDebugViews" = "1"`. This declares support for URP `DEBUG_DISPLAY` material/lighting overrides and an integer global `_HelixShadowDebug` that returns main-light shadow attenuation when nonzero. The project owns and verifies that shader implementation. `shadow-attenuation` requires this custom contract. Match the light scope before comparing with Three's combined shadow visibility. Camera stack overlays are excluded. Shaded normals are URP world-space normals, so a project-owned basis conversion is required before comparing them numerically with Three view-space normals. URP smoothness, specular color and reflection debug modes retain their engine-specific names and meanings. The recipe must establish material semantics before comparing them with Three roughness or specular response.

Every Unity export writes `unity.png` and `debug.json`, including encoding, dimensions, camera details where applicable and the image hash. Use the ordinary `helix compare` command to review a pair of renderer PNGs after checking their diagnostic receipts. These standalone renderer receipts are separate from the full scene/UI receipt contract.

Custom debug branches should be compiled under `DEBUG_DISPLAY`. Material and lighting overrides must return before project tint, fog and compositing stages. Reflections use the URP debugger response; custom reflection attribution still requires the project shader context.
