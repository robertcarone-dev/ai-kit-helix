using System;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;

namespace Helix.Comparison
{
    public static class UiCompositing
    {
        // Inspect the persistent prefab. Scene camera assignment and runtime writes need runtime evidence.
        public static string Inspect(string prefab, string target, string component, string colorField = "m_Color")
        {
            string path = UiAuthoring.AssetPath(prefab, ".prefab");
            var root = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (!root) {
                throw new ArgumentException("Missing prefab: " + path);
            }
            var rect = UiAuthoring.TargetTransform(root, target);
            var graphic = UiAuthoring.VisualComponent(rect, component);
            var color = new SerializedObject(graphic).FindProperty(colorField);
            if (color == null || color.propertyType != SerializedPropertyType.Color) {
                throw new ArgumentException("Expected serialized Color: " + colorField);
            }
            var hashes = new JObject();
            var channels = new JObject();
            foreach (string channel in new[] { "r", "g", "b", "a" }) {
                var chain = OwnershipObservation.PropertySources(graphic, colorField + "." + channel, hashes, out var owner);
                channels[channel] = new JObject { ["owner"] = AssetDatabase.GetAssetPath(owner), ["sources"] = chain };
            }
            var sources = new JArray();
            for (var current = graphic; current; current = PrefabUtility.GetCorrespondingObjectFromSource(current)) {
                string source = AssetDatabase.GetAssetPath(current);
                hashes[source] = UiAuthoring.Hash(source);
                sources.Add(source);
            }
            var canvases = new JArray();
            var groups = new JArray();
            for (var parent = rect; parent != null; parent = parent.parent) {
                string node = AnimationUtility.CalculateTransformPath(parent, root.transform);
                foreach (var canvas in parent.GetComponents<Canvas>()) {
                    var serialized = new SerializedObject(canvas);
                    var camera = serialized.FindProperty("m_Camera").objectReferenceValue;
                    canvases.Add(new JObject {
                        ["target"] = node,
                        ["renderMode"] = ((RenderMode)serialized.FindProperty("m_RenderMode").intValue).ToString(),
                        ["sortingOrder"] = canvas.sortingOrder,
                        ["overrideSorting"] = canvas.overrideSorting,
                        ["camera"] = camera ? camera.name : null
                    });
                }
                foreach (var group in parent.GetComponents<CanvasGroup>()) {
                    groups.Add(new JObject {
                        ["target"] = node,
                        ["alpha"] = group.alpha,
                        ["enabled"] = group.enabled,
                        ["ignoreParentGroups"] = group.ignoreParentGroups
                    });
                }
            }
            var rgba = color.colorValue;
            return new JObject {
                ["schemaVersion"] = 1,
                ["prefab"] = path,
                ["target"] = target,
                ["component"] = component,
                ["field"] = colorField,
                ["rgba"] = new JArray(rgba.r, rgba.g, rgba.b, rgba.a),
                ["channels"] = channels,
                ["prefabSources"] = sources,
                ["canvases"] = canvases,
                ["canvasGroups"] = groups,
                ["assetHashes"] = hashes
            }.ToString();
        }
    }
}
