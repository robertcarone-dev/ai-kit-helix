---
name: helix-render-trace
description: Trace a selected Unity URP renderer feature, pass inputs, output textures, shader consumers and camera-specific Render Graph evidence using the local Helix CLI.
---

# Trace a render pass

Run the installed CLI directly from the project. Follow the render-trace contract in Tools/Helix/Toolkit.md. Start with the question about a camera and pass. Inspect the effective quality/pipeline and camera renderer selection when available; record an assumed selection explicitly. Identify the feature, graph pass label and relevant shader property from project assets and source.

Run a configuration-only trace first. Follow the GUID and local-file-ID links; inspect the listed scheduling predicates, resource declarations and shader lines. Confirm what the shader samples and when. Record custom pass order, color/depth format and scope only where source or captured data supports them.

For execution evidence, prefer retained camera-specific Render Graph Viewer receipts. If authorized to capture a new frame, capture the desired camera and fixture in the viewer, then export its existing debug data with RenderTraceCapture.Inspect. Keep fixture, camera, revision, capture provenance and any visual crop alongside each receipt. Compare equivalent states with and without the effect's consumer. A disabled or culled pass, an absent pass in a valid selected graph, and a missing capture are distinct outcomes.

Use graph indices and declared resource edges for order and consumers. A named shader reference alone cannot establish a draw or pixel read. Observation-time Editor texture memory, graph descriptor sizes and device GPU time have different meanings. State the device/API and profiler measurement before attributing a performance improvement. Never disable a pass, change pipeline assets or start Unity just to generate the offline report.
