using System;
using System.Reflection;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Helix.Comparison
{
    public static class RenderTraceCapture
    {
        // Snapshot an already captured Render Graph Viewer entry. Never open or retarget the viewer.
        public static string Inspect(string cameraName, string textureName)
        {
            if (string.IsNullOrWhiteSpace(cameraName) || string.IsNullOrWhiteSpace(textureName)) {
                throw new ArgumentException("Supply a camera execution name and texture name.");
            }
            JObject selected = null;
            foreach (var window in Resources.FindObjectsOfTypeAll<EditorWindow>()) {
                var type = window.GetType();
                if (type.FullName != "UnityEditor.Rendering.RenderGraphViewer") {
                    continue;
                }
                var field = type.GetField("m_CurrentDebugData", BindingFlags.Instance | BindingFlags.NonPublic);
                if (field == null) {
                    throw new InvalidOperationException("Unsupported Render Graph Viewer debug data layout.");
                }
                var data = field.GetValue(window);
                if (data == null) {
                    continue;
                }
                var graph = JObject.Parse(JsonUtility.ToJson(data));
                if ((string)graph["executionName"] != cameraName || (bool?)graph["valid"] != true) {
                    continue;
                }
                if (selected != null) {
                    throw new InvalidOperationException("Multiple viewers match the selected camera execution.");
                }
                selected = graph;
            }
            if (selected == null) {
                throw new InvalidOperationException("Capture the requested camera in the Render Graph Viewer first.");
            }
            var textures = new JArray();
            foreach (var texture in Resources.FindObjectsOfTypeAll<RenderTexture>()) {
                if (texture.name != textureName) {
                    continue;
                }
                textures.Add(new JObject {
                    ["name"] = texture.name,
                    ["width"] = texture.width,
                    ["height"] = texture.height,
                    ["format"] = texture.graphicsFormat.ToString(),
                    ["created"] = texture.IsCreated(),
                    ["memoryBytes"] = UnityEngine.Profiling.Profiler.GetRuntimeMemorySizeLong(texture)
                });
            }
            return new JObject {
                ["frame"] = Time.frameCount,
                ["quality"] = QualitySettings.names[QualitySettings.GetQualityLevel()],
                ["pipeline"] = AssetDatabase.GetAssetPath(GraphicsSettings.currentRenderPipeline),
                ["viewer"] = selected,
                ["textureInventoryFilter"] = textureName,
                ["textures"] = textures
            }.ToString();
        }
    }
}
