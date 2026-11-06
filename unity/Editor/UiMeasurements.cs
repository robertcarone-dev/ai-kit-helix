using System;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEditor;

namespace Helix.Comparison
{
    public static class UiMeasurements
    {
        // Optional snapshot evidence for semantically mapped runtime nodes, including layout drivers.
        public static JObject LayoutContext(RectTransform rect)
        {
            var driven = rect.drivenByObject;
            var driver = driven as Component;
            JObject binding = null;
            var instance = PrefabUtility.GetOutermostPrefabInstanceRoot(rect);
            if (instance) {
                string path = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(instance);
                RectTransform source = PrefabUtility.GetCorrespondingObjectFromSourceAtPath(rect, path);
                if (source) {
                    binding = new JObject {
                        ["prefab"] = path,
                        ["target"] = AnimationUtility.CalculateTransformPath(source, AssetDatabase.LoadAssetAtPath<GameObject>(path).transform)
                    };
                }
            }
            return new JObject {
                ["prefabBinding"] = binding,
                ["anchoredPosition"] = new JArray(rect.anchoredPosition.x, rect.anchoredPosition.y),
                ["worldRotation"] = Quaternion.Angle(rect.rotation, Quaternion.identity),
                ["parentWorldRotation"] = rect.parent ? Quaternion.Angle(rect.parent.rotation, Quaternion.identity) : 0f,
                ["unitLocalScale"] = rect.localScale.x.Equals(1f) && rect.localScale.y.Equals(1f),
                ["worldScale"] = new JArray(rect.lossyScale.x, rect.lossyScale.y),
                ["driver"] = !driven ? null : new JObject {
                    ["component"] = driven.GetType().FullName,
                    ["path"] = driver ? UnityEditor.AnimationUtility.CalculateTransformPath(driver.transform, null) : null
                }
            };
        }

        // Measures geometry only. It does not establish visibility, clipping or font metrics.
        public static JObject Bounds(RectTransform rect, Camera camera, int width, int height)
        {
            if (rect == null) {
                throw new ArgumentNullException(nameof(rect));
            }
            if (width < 1 || height < 1) {
                throw new ArgumentOutOfRangeException(nameof(width));
            }
            if (camera == null) {
                if (Screen.width != width || Screen.height != height) {
                    throw new InvalidOperationException("Overlay screen dimensions differ from the native capture.");
                }
            } else if (camera.targetTexture != null || camera.pixelWidth != width || camera.pixelHeight != height ||
                                camera.pixelRect.x != 0 || camera.pixelRect.y != 0) {
                throw new InvalidOperationException("Use an unscaled full-viewport camera for these UI bounds.");
            }
            var corners = new Vector3[4];
            rect.GetWorldCorners(corners);
            float left = float.PositiveInfinity;
            float right = float.NegativeInfinity;
            float bottom = float.PositiveInfinity;
            float top = float.NegativeInfinity;
            foreach (Vector3 corner in corners) {
                if (camera != null && camera.WorldToScreenPoint(corner).z <= 0) {
                    throw new InvalidOperationException("UI geometry is behind the projection camera.");
                }
                Vector2 point = RectTransformUtility.WorldToScreenPoint(camera, corner);
                left = Mathf.Min(left, point.x);
                right = Mathf.Max(right, point.x);
                bottom = Mathf.Min(bottom, point.y);
                top = Mathf.Max(top, point.y);
            }
            return new JObject { ["x"] = left, ["y"] = height - top, ["width"] = right - left, ["height"] = top - bottom };
        }
    }
}
