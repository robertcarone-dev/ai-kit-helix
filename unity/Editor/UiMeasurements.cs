using System;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Helix.Comparison
{
    public static class UiMeasurements
    {
        // Measures geometry only. It does not establish visibility, clipping or font metrics.
        public static JObject Bounds(RectTransform rect, Camera camera, int width, int height)
        {
            if (rect == null) throw new ArgumentNullException(nameof(rect));
            if (width < 1 || height < 1) throw new ArgumentOutOfRangeException(nameof(width));
            if (camera == null) {
                if (Screen.width != width || Screen.height != height)
                    throw new InvalidOperationException("Overlay screen dimensions differ from the native capture.");
            } else if (camera.targetTexture != null || camera.pixelWidth != width || camera.pixelHeight != height ||
                camera.pixelRect.x != 0 || camera.pixelRect.y != 0) {
                throw new InvalidOperationException("Use an unscaled full-viewport camera for these UI bounds.");
            }
            var corners = new Vector3[4];
            rect.GetWorldCorners(corners);
            float left = float.PositiveInfinity, right = float.NegativeInfinity;
            float bottom = float.PositiveInfinity, top = float.NegativeInfinity;
            foreach (Vector3 corner in corners) {
                if (camera != null && camera.WorldToScreenPoint(corner).z <= 0)
                    throw new InvalidOperationException("UI geometry is behind the projection camera.");
                Vector2 point = RectTransformUtility.WorldToScreenPoint(camera, corner);
                left = Mathf.Min(left, point.x); right = Mathf.Max(right, point.x);
                bottom = Mathf.Min(bottom, point.y); top = Mathf.Max(top, point.y);
            }
            return new JObject { ["x"] = left, ["y"] = height - top, ["width"] = right - left, ["height"] = top - bottom };
        }
    }
}
