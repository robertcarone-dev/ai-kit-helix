using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Helix.Comparison
{
    // Public so project adapters can supply their owned roots, cameras, states and semantic bindings.
    public static class SceneSnapshot
    {
        public static JObject Capture(GameObject root, Camera camera, int width, int height, JToken state, string checkpoint, Dictionary<Transform, string> bindings = null, JObject cameraSurface = null)
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
            JObject surface = cameraSurface;
            if (surface != null)
            {
                foreach (string key in new[] { "x", "y", "width", "height" })
                {
                    JToken value = surface[key];
                    if (value == null || (value.Type != JTokenType.Integer && value.Type != JTokenType.Float) || double.IsNaN(value.Value<double>()) || double.IsInfinity(value.Value<double>())) { throw new ArgumentException("Camera surface requires finite coordinates."); }
                }
            }
            if (surface != null && (surface.Value<bool>("axisAligned") != true || surface.Value<double>("width") <= 0 || surface.Value<double>("height") <= 0)) { throw new ArgumentException("Invalid explicit camera surface."); }
            if (surface == null && camera != null && camera.targetTexture == null && camera.targetDisplay == 0 && Screen.width == width && Screen.height == height)
            {
                Rect r = camera.rect;
                surface = new JObject { ["x"] = r.x * width, ["y"] = (1 - r.yMax) * height, ["width"] = r.width * width, ["height"] = r.height * height, ["axisAligned"] = true };
            }
            var cameras = new JArray();
            if (camera != null)
            {
                cameras.Add(new JObject { ["id"] = "unity-camera", ["engine"] = "unity", ["surface"] = surface, ["projectionConvention"] = "clip-minus-one-to-one",
                    ["raw"] = new JObject { ["name"] = camera.name, ["orthographic"] = camera.orthographic, ["near"] = camera.nearClipPlane, ["far"] = camera.farClipPlane,
                        ["projection"] = Matrix(camera.projectionMatrix), ["view"] = Matrix(camera.worldToCameraMatrix), ["world"] = Matrix(camera.transform.localToWorldMatrix),
                        ["fieldOfView"] = camera.fieldOfView, ["orthographicSize"] = camera.orthographicSize, ["cullingMask"] = camera.cullingMask } });
            }
            int total = 0;
            Visit(root.transform, "unity", null, camera, width, height, bindings, nodes, surface, ref total, 0);
            return new JObject {
                ["schemaVersion"] = 1, ["kind"] = "helix-scene", ["coordinateSpace"] = "viewport-top-left-pixels",
                ["viewport"] = new JObject { ["width"] = width, ["height"] = height, ["dpr"] = 1, ["zoom"] = 1 },
                ["state"] = state.DeepClone(), ["checkpoint"] = checkpoint, ["observedAt"] = Time.realtimeSinceStartupAsDouble * 1000,
                ["frame"] = Time.frameCount, ["nodes"] = nodes, ["cameras"] = cameras, ["bindingErrors"] = errors,
                ["totalNodes"] = total, ["truncated"] = total > nodes.Count,
                ["conventions"] = new JObject { ["unity"] = "engine-native transforms; quaternion xyzw; column-major matrices" },
                ["notes"] = new JArray("Read-only geometry inventory. Images are separate observations; no clipping or occlusion acceptance.")
            };
        }

        private static void Visit(Transform transform, string id, string parentId, Camera camera, int width, int height, Dictionary<Transform, string> bindings, JArray nodes, JObject surface, ref int total, int depth)
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
            Renderer renderer = transform.GetComponent<Renderer>();
            if (!(transform is RectTransform) && renderer != null && camera != null && surface != null)
            {
                bounds = ProjectBounds(renderer.bounds, camera, surface);
                reason = bounds == null ? "Unmeasured: clip-plane crossing" : "Renderer world AABB projected through observed camera; silhouette unresolved";
            }
            nodes.Add(new JObject {
                ["id"] = id, ["parentId"] = parentId, ["semanticId"] = bindings != null && bindings.TryGetValue(transform, out string semanticId) ? semanticId : null,
                ["engine"] = "unity", ["name"] = transform.name, ["type"] = transform.GetType().Name, ["visible"] = transform.gameObject.activeInHierarchy && (renderer == null || renderer.enabled),
                ["bounds"] = bounds, ["boundsMethod"] = reason, ["cameraId"] = camera == null ? null : "unity-camera",
                ["raw"] = new JObject { ["cameraLayerIncluded"] = camera == null ? JValue.CreateNull() : new JValue((camera.cullingMask & (1 << transform.gameObject.layer)) != 0), ["position"] = Vector(transform.localPosition), ["scale"] = Vector(transform.localScale), ["quaternion"] = new JArray(transform.localRotation.x, transform.localRotation.y, transform.localRotation.z, transform.localRotation.w), ["world"] = Matrix(transform.localToWorldMatrix) }
            });
            for (int i = 0; i < transform.childCount; i++) { Visit(transform.GetChild(i), id + "/" + i, id, camera, width, height, bindings, nodes, surface, ref total, depth + 1); }
        }

        private static JObject ProjectBounds(Bounds bounds, Camera camera, JObject surface)
        {
            float left = float.PositiveInfinity, top = float.PositiveInfinity, right = float.NegativeInfinity, bottom = float.NegativeInfinity;
            Matrix4x4 vp = camera.projectionMatrix * camera.worldToCameraMatrix;
            for (int i = 0; i < 8; i++)
            {
                var p = new Vector3((i & 1) == 0 ? bounds.min.x : bounds.max.x, (i & 2) == 0 ? bounds.min.y : bounds.max.y, (i & 4) == 0 ? bounds.min.z : bounds.max.z);
                Vector4 clip = vp * new Vector4(p.x, p.y, p.z, 1);
                if (clip.w <= 0 || clip.z / clip.w < -1 || clip.z / clip.w > 1) { return null; }
                float x = surface.Value<float>("x") + (clip.x / clip.w + 1) * 0.5f * surface.Value<float>("width");
                float y = surface.Value<float>("y") + (1 - clip.y / clip.w) * 0.5f * surface.Value<float>("height");
                left = Mathf.Min(left, x); right = Mathf.Max(right, x); top = Mathf.Min(top, y); bottom = Mathf.Max(bottom, y);
            }
            return new JObject { ["x"] = left, ["y"] = top, ["width"] = right - left, ["height"] = bottom - top };
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
