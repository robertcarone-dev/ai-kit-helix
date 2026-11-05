using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Helix.Comparison
{
    // Public so project adapters can supply their owned roots, cameras, states and semantic bindings.
    public static class SceneSnapshot
    {
        public static JObject Capture(GameObject root, Camera camera, int width, int height, JToken state, string checkpoint, Dictionary<Transform, string> bindings = null)
        {
            if (root == null) { throw new ArgumentNullException(nameof(root)); }
            if (state == null || string.IsNullOrEmpty(checkpoint)) { throw new ArgumentException("Supply observed state and checkpoint."); }
            if (width <= 0 || height <= 0) { throw new ArgumentOutOfRangeException(nameof(width)); }
            var nodes = new JArray();
            var errors = new JArray();
            var ids = new HashSet<string>();
            if (bindings != null)
            {
                foreach (var pair in bindings)
                {
                    if (pair.Key == null || string.IsNullOrEmpty(pair.Value) || !ids.Add(pair.Value)) { throw new ArgumentException("Invalid or duplicate semantic binding."); }
                    if (pair.Key != root.transform && !pair.Key.IsChildOf(root.transform)) { errors.Add(new JObject { ["id"] = pair.Value, ["error"] = "Binding outside selected root" }); }
                }
            }
            int total = 0;
            Visit(root.transform, "unity", null, camera, width, height, bindings, nodes, ref total, 0);
            return new JObject {
                ["schemaVersion"] = 1, ["kind"] = "helix-scene", ["coordinateSpace"] = "viewport-top-left-pixels",
                ["viewport"] = new JObject { ["width"] = width, ["height"] = height, ["dpr"] = 1, ["zoom"] = 1 },
                ["state"] = state.DeepClone(), ["checkpoint"] = checkpoint, ["observedAt"] = Time.realtimeSinceStartupAsDouble * 1000,
                ["frame"] = Time.frameCount, ["nodes"] = nodes, ["cameras"] = new JArray(), ["bindingErrors"] = errors,
                ["totalNodes"] = total, ["truncated"] = total > nodes.Count,
                ["conventions"] = new JObject { ["unity"] = "engine-native transforms; quaternion xyzw; column-major matrices" },
                ["notes"] = new JArray("Read-only geometry inventory. Images are separate observations; no clipping or occlusion acceptance.")
            };
        }

        private static void Visit(Transform transform, string id, string parentId, Camera camera, int width, int height, Dictionary<Transform, string> bindings, JArray nodes, ref int total, int depth)
        {
            total++;
            if (nodes.Count >= 10000 || depth > 128) { return; }
            JObject bounds = null;
            string reason = "No measurable geometry";
            if (transform is RectTransform rect)
            {
                Canvas canvas = rect.GetComponentInParent<Canvas>();
                if (canvas != null)
                {
                    canvas = canvas.rootCanvas;
                    Camera uiCamera = canvas.renderMode == RenderMode.ScreenSpaceOverlay ? null : canvas.worldCamera;
                    if (canvas.targetDisplay != 0 || (canvas.renderMode != RenderMode.ScreenSpaceOverlay && uiCamera == null)) { reason = "Unsupported display or missing Canvas camera"; }
                    else
                    {
                        try { bounds = UiMeasurements.Bounds(rect, uiCamera, width, height); reason = "RectTransform corners; clipping and occlusion unresolved"; }
                        catch (InvalidOperationException error) { reason = error.Message; }
                    }
                }
            }
            nodes.Add(new JObject {
                ["id"] = id, ["parentId"] = parentId, ["semanticId"] = bindings != null && bindings.TryGetValue(transform, out string semanticId) ? semanticId : null,
                ["engine"] = "unity", ["name"] = transform.name, ["type"] = transform.GetType().Name, ["visible"] = transform.gameObject.activeInHierarchy,
                ["bounds"] = bounds, ["boundsMethod"] = reason, ["cameraId"] = camera == null ? null : "unity-camera",
                ["raw"] = new JObject { ["position"] = Vector(transform.localPosition), ["scale"] = Vector(transform.localScale), ["quaternion"] = new JArray(transform.localRotation.x, transform.localRotation.y, transform.localRotation.z, transform.localRotation.w), ["world"] = Matrix(transform.localToWorldMatrix) }
            });
            for (int i = 0; i < transform.childCount; i++) { Visit(transform.GetChild(i), id + "/" + i, id, camera, width, height, bindings, nodes, ref total, depth + 1); }
        }

        public static JArray Matrix(Matrix4x4 matrix)
        {
            var result = new JArray();
            for (int i = 0; i < 16; i++) { result.Add(matrix[i]); }
            return result;
        }

        private static JArray Vector(Vector3 value) { return new JArray(value.x, value.y, value.z); }
    }
}
