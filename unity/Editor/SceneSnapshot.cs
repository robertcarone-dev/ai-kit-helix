using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEditor;

namespace Helix.Comparison
{
    // Public so project adapters can supply their owned roots, cameras, states and semantic bindings.
    public static class SceneSnapshot
    {
        public static JObject Capture(GameObject root, Camera camera, int width, int height, JToken state, string checkpoint,
            Dictionary<Transform, string> bindings = null, JObject cameraSurface = null, JObject options = null)
        {
            if (root == null) {
                throw new ArgumentNullException(nameof(root));
            }
            if (state == null || string.IsNullOrEmpty(checkpoint)) {
                throw new ArgumentException("Supply observed state and checkpoint.");
            }
            if (width <= 0 || height <= 0) {
                throw new ArgumentOutOfRangeException(nameof(width));
            }

            double started = Time.realtimeSinceStartupAsDouble * 1000;

            string profile = options?.Value<string>("profile") ?? "all";
            if (Array.IndexOf(new[] { "all", "layout", "geometry", "appearance", "motion" }, profile) < 0) {
                throw new ArgumentException("Unknown scene profile.");
            }

            var selected = options?["semanticIds"] is JArray selectedIds ? new HashSet<string>(selectedIds.Values<string>()) : null;
            var allowed = new HashSet<Transform>();
            if (selected != null && bindings != null) {
                foreach (var pair in bindings) {
                    if (selected.Contains(pair.Value) && pair.Key != null) {
                        for (Transform t = pair.Key; t != null; t = t.parent) {
                            allowed.Add(t);
                        }
                        if (options.Value<bool>("includeDescendants")) {
                            foreach (Transform t in pair.Key.GetComponentsInChildren<Transform>(true)) {
                                allowed.Add(t);
                            }
                        }
                    }
                }
            }

            var assetPaths = new Dictionary<UnityEngine.Object, string>();
            var nodes = new JArray();
            var errors = new JArray();
            var ids = new HashSet<string>();
            if (bindings != null) {
                foreach (var pair in bindings) {
                    if (pair.Key == null || string.IsNullOrEmpty(pair.Value) || !ids.Add(pair.Value)) {
                        throw new ArgumentException("Invalid or duplicate semantic binding.");
                    }
                    if (pair.Key != root.transform && !pair.Key.IsChildOf(root.transform)) {
                        errors.Add(new JObject { ["id"] = pair.Value, ["error"] = "Binding outside selected root" });
                    }
                }
            }

            JObject surface = cameraSurface;
            if (surface != null) {
                foreach (string key in new[] { "x", "y", "width", "height" }) {
                    JToken value = surface[key];
                    if (value == null || (value.Type != JTokenType.Integer && value.Type != JTokenType.Float) || double.IsNaN(value.Value<double>()) || double.IsInfinity(value.Value<double>())) {
                        throw new ArgumentException("Camera surface requires finite coordinates.");
                    }
                }
            }
            if (surface != null && (surface.Value<bool>("axisAligned") != true || surface.Value<double>("width") <= 0 || surface.Value<double>("height") <= 0)) {
                throw new ArgumentException("Invalid explicit camera surface.");
            }
            if (surface == null && camera != null && camera.targetTexture == null && camera.targetDisplay == 0 && Screen.width == width && Screen.height == height) {
                Rect r = camera.rect;
                surface = new JObject {
                    ["x"] = r.x * width,
                    ["y"] = (1 - r.yMax) * height,
                    ["width"] = r.width * width,
                    ["height"] = r.height * height,
                    ["axisAligned"] = true
                };
            }

            var cameras = new JArray();
            if (camera != null) {
                cameras.Add(new JObject {
                    ["id"] = "unity-camera",
                    ["engine"] = "unity",
                    ["surface"] = surface,
                    ["projectionConvention"] = "clip-minus-one-to-one",
                    ["raw"] = new JObject {
                        ["name"] = camera.name,
                        ["orthographic"] = camera.orthographic,
                        ["near"] = camera.nearClipPlane,
                        ["far"] = camera.farClipPlane,
                        ["projection"] = Matrix(camera.projectionMatrix),
                        ["view"] = Matrix(camera.worldToCameraMatrix),
                        ["world"] = Matrix(camera.transform.localToWorldMatrix),
                        ["fieldOfView"] = camera.fieldOfView,
                        ["orthographicSize"] = camera.orthographicSize,
                        ["cullingMask"] = camera.cullingMask
                    }
                });
            }
            if (selected != null) {
                foreach (string id in selected) {
                    if (bindings == null || !bindings.ContainsValue(id)) {
                        errors.Add(new JObject { ["id"] = id, ["error"] = "Missing semantic binding" });
                    }
                }
            }

            int total = 0;
            Visit(root.transform, "unity", null, camera, width, height, bindings, nodes, surface, ref total, 0, options, selected, allowed, false, assetPaths);
            return new JObject {
                ["schemaVersion"] = 1,
                ["kind"] = "helix-scene",
                ["coordinateSpace"] = "viewport-top-left-pixels",
                ["viewport"] = new JObject { ["width"] = width, ["height"] = height, ["dpr"] = 1, ["zoom"] = 1 },
                ["state"] = state.DeepClone(),
                ["checkpoint"] = checkpoint,
                ["observedAt"] = started,
                ["observationEnd"] = Time.realtimeSinceStartupAsDouble * 1000,
                ["scope"] = new JObject {
                    ["profile"] = profile,
                    ["semanticIds"] = options?["semanticIds"]?.DeepClone(),
                    ["includeDescendants"] = options?.Value<bool>("includeDescendants") ?? false
                },
                ["pipeline"] = new JObject {
                    ["engine"] = "unity",
                    ["activeColorSpace"] = QualitySettings.activeColorSpace.ToString(),
                    ["ambientMode"] = RenderSettings.ambientMode.ToString(),
                    ["ambientIntensity"] = RenderSettings.ambientIntensity,
                    ["fog"] = RenderSettings.fog
                },
                ["frame"] = Time.frameCount,
                ["nodes"] = nodes,
                ["cameras"] = cameras,
                ["bindingErrors"] = errors,
                ["totalNodes"] = total,
                ["truncated"] = total > nodes.Count,
                ["conventions"] = new JObject { ["unity"] = "engine-native transforms; quaternion xyzw; column-major matrices" },
                ["notes"] = new JArray("Read-only geometry inventory. Images are separate observations; no clipping or occlusion acceptance.")
            };
        }

        private static void Visit(Transform transform, string id, string parentId, Camera camera, int width, int height,
            Dictionary<Transform, string> bindings, JArray nodes, JObject surface, ref int total, int depth,
            JObject options, HashSet<string> selected, HashSet<Transform> allowed, bool inherited, Dictionary<UnityEngine.Object, string> assetPaths)
        {
            if (selected != null && !allowed.Contains(transform)) {
                return;
            }

            string profile = options?.Value<string>("profile") ?? "all";
            bool isSelected = selected == null || (bindings != null && bindings.TryGetValue(transform, out string binding) && selected.Contains(binding));
            bool measured = isSelected || inherited;
            bool descendants = (options?.Value<bool>("includeDescendants") ?? false) && measured;
            bool appearance = measured && (profile == "all" || profile == "appearance");
            total++;
            if (nodes.Count >= 10000 || depth > 128) {
                return;
            }

            JObject bounds = null;
            string reason = "No measurable geometry";
            string cameraId = camera == null ? null : "unity-camera";
            if (measured && transform is RectTransform rect) {
                cameraId = null;
                Canvas canvas = rect.GetComponentInParent<Canvas>();
                if (canvas != null) {
                    canvas = canvas.rootCanvas;
                    Camera uiCamera = canvas.renderMode == RenderMode.ScreenSpaceOverlay ? null : canvas.worldCamera;
                    if (uiCamera != null && uiCamera == camera) {
                        cameraId = "unity-camera";
                    }
                    if (canvas.targetDisplay != 0 || (canvas.renderMode != RenderMode.ScreenSpaceOverlay && uiCamera == null)) {
                        reason = "Unsupported display or missing Canvas camera";
                    } else {
                        try {
                            bounds = UiMeasurements.Bounds(rect, uiCamera, width, height);
                            reason = "RectTransform corners; clipping and occlusion unresolved";
                        }
                        catch (InvalidOperationException error) {
                            reason = error.Message;
                        }
                    }
                }
            }

            Renderer renderer = transform.GetComponent<Renderer>();
            string boundsKind = bounds == null ? null : "projected-rect-corners";
            MeshFilter filter = transform.GetComponent<MeshFilter>();
            if (measured && profile != "layout" && !(transform is RectTransform) && renderer is MeshRenderer && filter != null && filter.sharedMesh != null && camera != null && surface != null) {
                bounds = ProjectBounds(filter.sharedMesh.bounds, transform.localToWorldMatrix, camera, surface);
                boundsKind = bounds == null ? null : "projected-local-aabb-3d";
                reason = bounds == null ? "Unmeasured: clip-plane crossing" : "Local mesh AABB transformed and projected; silhouette unresolved";
            }
            if (!measured) {
                reason = "Structural ancestor only";
            }

            nodes.Add(new JObject {
                ["id"] = id,
                ["parentId"] = parentId,
                ["semanticId"] = bindings != null && bindings.TryGetValue(transform, out string semanticId) ? semanticId : null,
                ["engine"] = "unity",
                ["name"] = transform.name,
                ["type"] = transform.GetType().Name,
                ["visible"] = transform.gameObject.activeInHierarchy && (renderer == null || renderer.enabled),
                ["bounds"] = bounds,
                ["boundsKind"] = boundsKind,
                ["structuralOnly"] = !measured,
                ["boundsMethod"] = reason,
                ["cameraId"] = cameraId,
                ["raw"] = new JObject {
                    ["identity"] = transform.GetInstanceID(),
                    ["materials"] = appearance ? Materials(renderer, assetPaths) : null,
                    ["light"] = appearance ? Light(transform.GetComponent<Light>()) : null,
                    ["cameraLayerIncluded"] = camera == null ? JValue.CreateNull() : new JValue((camera.cullingMask & (1 << transform.gameObject.layer)) != 0),
                    ["position"] = Vector(transform.localPosition),
                    ["scale"] = Vector(transform.localScale),
                    ["quaternion"] = new JArray(transform.localRotation.x, transform.localRotation.y, transform.localRotation.z, transform.localRotation.w),
                    ["world"] = Matrix(transform.localToWorldMatrix)
                }
            });
            for (int i = 0; i < transform.childCount; i++) {
                Visit(transform.GetChild(i), id + "/" + i, id, camera, width, height, bindings, nodes, surface, ref total, depth + 1, options, selected, allowed, descendants, assetPaths);
            }
        }

        private static string AssetPath(UnityEngine.Object asset, Dictionary<UnityEngine.Object, string> paths)
        {
            if (asset == null) {
                return null;
            }
            if (!paths.TryGetValue(asset, out string path)) {
                path = AssetDatabase.GetAssetPath(asset);
                paths.Add(asset, path);
            }
            return path;
        }

        private static JArray Materials(Renderer renderer, Dictionary<UnityEngine.Object, string> paths)
        {
            var result = new JArray();
            if (renderer == null) {
                return result;
            }
            var rendererBlock = new MaterialPropertyBlock();
            var indexedBlock = new MaterialPropertyBlock();
            renderer.GetPropertyBlock(rendererBlock);
            Material[] materials = renderer.sharedMaterials;
            for (int index = 0; index < materials.Length; index++) {
                Material material = materials[index];
                if (material == null) {
                    result.Add(JValue.CreateNull());
                    continue;
                }
                indexedBlock.Clear();
                renderer.GetPropertyBlock(indexedBlock, index);
                // Unity uses the per-material block instead of the renderer block, not a property-wise merge.
                MaterialPropertyBlock block = indexedBlock.isEmpty ? rendererBlock : indexedBlock;
                string source = indexedBlock.isEmpty ? "renderer-property-block" : "material-property-block";
                var properties = new JObject();
                var defaults = new JObject();
                var provenance = new JObject();
                foreach (string key in new[] { "_BaseColor", "_Color", "_EmissionColor" }) {
                    if (!material.HasProperty(key)) {
                        continue;
                    }
                    int id = Shader.PropertyToID(key);
                    Color original = material.GetColor(id), effective = block.HasColor(id) ? block.GetColor(id) : original;
                    defaults[key] = new JArray(original.r, original.g, original.b, original.a);
                    properties[key] = new JArray(effective.r, effective.g, effective.b, effective.a);
                    provenance[key] = block.HasColor(id) ? source : "material";
                }
                foreach (string key in new[] { "_Metallic", "_Smoothness", "_Glossiness", "_Cutoff" }) {
                    if (!material.HasProperty(key)) {
                        continue;
                    }
                    int id = Shader.PropertyToID(key);
                    defaults[key] = material.GetFloat(id);
                    properties[key] = block.HasFloat(id) ? block.GetFloat(id) : material.GetFloat(id);
                    provenance[key] = block.HasFloat(id) ? source : "material";
                }
                var textures = new JArray();
                foreach (string key in material.GetTexturePropertyNames()) {
                    int id = Shader.PropertyToID(key);
                    Texture texture = block.HasTexture(id) ? block.GetTexture(id) : material.GetTexture(id);
                    Vector2 offset = material.GetTextureOffset(key), scale = material.GetTextureScale(key);
                    int st = Shader.PropertyToID(key + "_ST");
                    if (block.HasVector(st)) {
                        Vector4 v = block.GetVector(st);
                        scale = new Vector2(v.x, v.y);
                        offset = new Vector2(v.z, v.w);
                    }
                    if (texture != null) {
                        textures.Add(new JObject {
                            ["slot"] = key,
                            ["name"] = texture.name,
                            ["assetPath"] = AssetPath(texture, paths),
                            ["source"] = block.HasTexture(id) ? source : "material",
                            ["transformSource"] = block.HasVector(st) ? source : "material",
                            ["offset"] = new JArray(offset.x, offset.y),
                            ["scale"] = new JArray(scale.x, scale.y)
                        });
                    }
                }
                result.Add(new JObject {
                    ["name"] = material.name,
                    ["shader"] = material.shader.name,
                    ["assetPath"] = AssetPath(material, paths),
                    ["properties"] = properties,
                    ["materialDefaults"] = defaults,
                    ["propertySources"] = provenance,
                    ["textures"] = textures,
                    ["renderQueue"] = material.renderQueue
                });
            }
            return result;
        }

        private static JObject Light(UnityEngine.Light light)
        {
            if (light == null) {
                return null;
            }
            return new JObject {
                ["type"] = light.type.ToString(),
                ["color"] = new JArray(light.color.r, light.color.g, light.color.b),
                ["intensity"] = light.intensity,
                ["range"] = light.range,
                ["spotAngle"] = light.spotAngle,
                ["shadows"] = light.shadows.ToString(),
                ["enabled"] = light.enabled
            };
        }

        private static JObject ProjectBounds(Bounds bounds, Matrix4x4 world, Camera camera, JObject surface)
        {
            float left = float.PositiveInfinity;
            float top = float.PositiveInfinity;
            float right = float.NegativeInfinity;
            float bottom = float.NegativeInfinity;
            Matrix4x4 vp = camera.projectionMatrix * camera.worldToCameraMatrix * world;
            for (int i = 0; i < 8; i++) {
                var p = new Vector3((i & 1) == 0 ? bounds.min.x : bounds.max.x, (i & 2) == 0 ? bounds.min.y : bounds.max.y, (i & 4) == 0 ? bounds.min.z : bounds.max.z);
                Vector4 clip = vp * new Vector4(p.x, p.y, p.z, 1);
                if (clip.w <= 0 || clip.z / clip.w < -1 || clip.z / clip.w > 1) {
                    return null;
                }
                float x = surface.Value<float>("x") + (clip.x / clip.w + 1) * 0.5f * surface.Value<float>("width");
                float y = surface.Value<float>("y") + (1 - clip.y / clip.w) * 0.5f * surface.Value<float>("height");
                left = Mathf.Min(left, x);
                right = Mathf.Max(right, x);
                top = Mathf.Min(top, y);
                bottom = Mathf.Max(bottom, y);
            }
            return new JObject { ["x"] = left, ["y"] = top, ["width"] = right - left, ["height"] = bottom - top };
        }

        public static JArray Matrix(Matrix4x4 matrix)
        {
            var result = new JArray();
            for (int i = 0; i < 16; i++) {
                result.Add(matrix[i]);
            }
            return result;
        }

        private static JArray Vector(Vector3 value)
        {
            return new JArray(value.x, value.y, value.z);
        }
    }
}
