---
name: helix-sprite-usage
description: Trace a Phaser texture frame through its declared Unity sprite mapping to serialized prefab consumers and target-specific packed atlas page evidence.
---

# Trace sprite usage

Use the installed CLI directly. Locate a native Helix UI capture of the actual feature state. Inspect the node's Phaser texture key, frame name or number, source rectangle, trim and source URL. Preserve generated texture keys and distinguish a blob URL from a durable file identity. Find the project's source-to-target asset mapping and identify the Unity sprite by path, texture GUID **and sprite local file ID**. Duplicate names and texture GUID alone are insufficient for a sliced sheet. Use ui-assets when staged original pixels are needed.

Run `helix sprite-usage --spec FILE --out EMPTY_DIR` using the contract in Tools/Helix/toolkit/Toolkit.md. Review direct serialized fields and nested prefab edges separately. A nested instance can override a sprite. Runtime sprite assignment, Addressables loading and actual on-screen use require their own evidence. Follow the project's filing conventions; trace other consumers before changing a shared sprite or packing group.

For a page result, export SpriteUsageCapture.Inspect from an authorized Editor after the intended build target has packed the atlas, then rerun with the pinned inspection. Report the atlas asset, preview page index and texture name and dimensions, graphics format, mip count and sprite UV bounds. Distinguish authored folder/texture membership from a packed page; multiple bindable atlases can exist. The inspection does not repack the project. Missing or ambiguous packed matches stay unmeasured. Make memory or batching recommendations only with platform and loading-lifetime evidence.
