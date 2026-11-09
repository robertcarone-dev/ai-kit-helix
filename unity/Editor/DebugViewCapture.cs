using System;
using System.IO;
using System.Text;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Helix.Comparison
{
    /// <summary>Explicit diagnostic captures. The caller owns the camera, checkpoint and selected renderers.</summary>
    public static class DebugViewCapture
    {
        private static readonly string[] ImageViews = { "final", "luminance", "hue", "saturation", "value", "alpha" };
        private static readonly string[] GeometryViews = { "silhouette", "mesh-normal", "uv", "tangent", "tangent-sign", "depth", "uv-checker", "material-id" };

        public static string ExportImage(string sourcePng, string output, string view)
        {
            if (Array.IndexOf(ImageViews, view) < 0) throw new ArgumentException("Unknown image debug view: " + view);
            RequireOutput(output);
            var image = new Texture2D(2, 2, TextureFormat.RGBA32, false, true);
            try {
                byte[] source = File.ReadAllBytes(sourcePng);
                if (!image.LoadImage(source)) throw new InvalidOperationException("Could not decode the source image.");
                var pixels = image.GetPixels32();
                if (view != "final") {
                    for (int index = 0; index < pixels.Length; index++) {
                        Color32 pixel = pixels[index];
                        float red = pixel.r / 255f, green = pixel.g / 255f, blue = pixel.b / 255f;
                        Color.RGBToHSV(new Color(red, green, blue), out float hue, out float saturation, out float value);
                        float result = 0;
                        if (view == "alpha") result = pixel.a / 255f;
                        else if (pixel.a != 0) {
                            switch (view) {
                                case "luminance": result = 0.2126f * Linear(red) + 0.7152f * Linear(green) + 0.0722f * Linear(blue); break;
                                case "saturation": result = saturation; break;
                                case "value": result = value; break;
                                case "hue":
                                    if (saturation < 0.01f || value < 0.01f) {
                                        pixels[index] = new Color32(255, 0, 255, 255);
                                        continue;
                                    }
                                    result = hue;
                                    break;
                            }
                        }
                        byte gray = (byte)Mathf.FloorToInt(result * 255 + 0.5f);
                        pixels[index] = new Color32(gray, gray, gray, 255);
                    }
                    image.SetPixels32(pixels);
                    image.Apply();
                }
                return Save(image, output, view, new JObject {
                    ["source"] = Path.GetFullPath(sourcePng), ["sourceSha256"] = ComparisonSession.Hash(source),
                    ["encoding"] = "sRGB input; linear Rec.709 luminance; encoded-sRGB HSV; direct grayscale output",
                    ["alpha"] = "Stored image alpha. Opaque screenshots have uniform alpha; transparent RGB is excluded.",
                    ["hue"] = "0..1 cyclic; saturation/value below 0.01 marked magenta"
                });
            }
            finally { UnityEngine.Object.DestroyImmediate(image); }
        }

        private static float Linear(float value) => value <= 0.04045f ? value / 12.92f : Mathf.Pow((value + 0.055f) / 1.055f, 2.4f);

        public static string CaptureGeometry(Camera camera, MeshRenderer[] renderers, string view, int width, int height, string output, string[] materialIds = null)
        {
            int mode = Array.IndexOf(GeometryViews, view);
            if (mode < 0) throw new ArgumentException("Unknown geometry debug view: " + view);
            RequireCamera(camera, width, height);
            RequireOutput(output);
            if (renderers == null || renderers.Length == 0) throw new ArgumentException("Supply selected static mesh renderers.");
            var meshes = new Mesh[renderers.Length];
            for (int index = 0; index < renderers.Length; index++) {
                MeshRenderer renderer = renderers[index];
                if (renderer == null || !renderer.TryGetComponent(out MeshFilter filter) || filter.sharedMesh == null)
                    throw new ArgumentException("Every selected renderer requires a mesh.");
                Mesh mesh = filter.sharedMesh;
                if ((view == "tangent" || view == "tangent-sign") && !mesh.HasVertexAttribute(VertexAttribute.Tangent))
                    throw new ArgumentException("Selected mesh has no tangents: " + mesh.name);
                if ((view == "uv" || view == "uv-checker") && !mesh.HasVertexAttribute(VertexAttribute.TexCoord0))
                    throw new ArgumentException("Selected mesh has no UV0: " + mesh.name);
                if (view == "mesh-normal" && !mesh.HasVertexAttribute(VertexAttribute.Normal))
                    throw new ArgumentException("Selected mesh has no normals: " + mesh.name);
                meshes[index] = mesh;
            }
            int submeshCount = 0;
            foreach (Mesh mesh in meshes) submeshCount += mesh.subMeshCount;
            if (view == "material-id" && (materialIds == null || materialIds.Length != submeshCount || Array.Exists(materialIds, string.IsNullOrWhiteSpace)))
                throw new ArgumentException("Supply one semantic material ID per submesh in renderer/submesh order.");
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>("Assets/HelixComparison/Editor/GeometryDebug.shader");
            if (shader == null || !shader.isSupported) throw new InvalidOperationException("Helix geometry debug shader is unavailable.");
            var material = new Material(shader);
            var target = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Linear);
            RenderTexture previousTarget = RenderTexture.active;
            var commands = new CommandBuffer { name = "Helix geometry debug" };
            try {
                material.SetInt("_HelixView", mode);
                material.SetVector("_HelixDepthRange", new Vector4(camera.nearClipPlane, camera.farClipPlane, 0, 0));
                commands.SetRenderTarget(target);
                commands.ClearRenderTarget(true, true, Color.clear);
                material.SetMatrix("_HelixWorldToView", camera.worldToCameraMatrix);
                material.SetMatrix("_HelixProjection", GL.GetGPUProjectionMatrix(camera.projectionMatrix, true));
                int materialIndex = 0;
                var properties = new MaterialPropertyBlock();
                for (int index = 0; index < renderers.Length; index++) {
                    for (int submesh = 0; submesh < meshes[index].subMeshCount; submesh++) {
                        if (view == "material-id") properties.SetVector("_HelixMaterialColor", MaterialColor(materialIds[materialIndex++]));
                        commands.DrawMesh(meshes[index], renderers[index].localToWorldMatrix, material, submesh, 0, properties);
                    }
                }
                Graphics.ExecuteCommandBuffer(commands);
                return ReadAndSave(target, output, view, new JObject {
                    ["captureMethod"] = "static mesh geometry override; backface culled; opaque; no material displacement or alpha clipping",
                    ["coordinates"] = "view-space normals/tangents; raw UV0; near/far normalized camera depth",
                    ["near"] = camera.nearClipPlane, ["far"] = camera.farClipPlane,
                    ["encoding"] = "linear diagnostic values; vectors encoded as value * 0.5 + 0.5",
                    ["camera"] = CameraReceipt(camera), ["rendererCount"] = renderers.Length,
                    ["materialIds"] = view == "material-id" ? new JArray(materialIds) : null
                });
            }
            finally {
                RenderTexture.active = previousTarget;
                commands.Release();
                RenderTexture.ReleaseTemporary(target);
                UnityEngine.Object.DestroyImmediate(material);
            }
        }

        public static string CaptureMaterial(Camera camera, Renderer[] renderers, string view, int width, int height, string output)
        {
            RequireCamera(camera, width, height);
            RequireOutput(output);
            DebugMaterialMode materialMode;
            DebugLightingMode lightingMode = DebugLightingMode.None;
            switch (view) {
                case "shadow-attenuation": materialMode = DebugMaterialMode.None; break;
                case "base-color": materialMode = DebugMaterialMode.Albedo; break;
                case "shaded-normal": materialMode = DebugMaterialMode.NormalWorldSpace; break;
                case "material-alpha": materialMode = DebugMaterialMode.Alpha; break;
                case "smoothness": materialMode = DebugMaterialMode.Smoothness; break;
                case "metallic": materialMode = DebugMaterialMode.Metallic; break;
                case "occlusion": materialMode = DebugMaterialMode.AmbientOcclusion; break;
                case "emission": materialMode = DebugMaterialMode.Emission; break;
                case "specular-color": materialMode = DebugMaterialMode.Specular; break;
                case "lighting-only": materialMode = DebugMaterialMode.None; lightingMode = DebugLightingMode.LightingWithNormalMaps; break;
                case "reflections": materialMode = DebugMaterialMode.None; lightingMode = DebugLightingMode.ReflectionsWithSmoothness; break;
                default: throw new ArgumentException("Unknown URP debug view: " + view);
            }
            if (renderers == null || renderers.Length == 0) throw new ArgumentException("Supply all renderers visible to the diagnostic camera.");
            var shaderNames = new JArray();
            foreach (Renderer renderer in renderers) {
                if (renderer == null) throw new ArgumentException("A selected renderer is missing.");
                foreach (Material material in renderer.sharedMaterials) {
                    if (material == null) throw new ArgumentException("A selected material is missing.");
                    string shaderName = material.shader.name;
                    bool supported = material.GetTag("HelixDebugViews", false, string.Empty) == "1" || (view != "shadow-attenuation" && (shaderName == "Universal Render Pipeline/Lit" || shaderName == "Universal Render Pipeline/Simple Lit"));
                    if (!supported) throw new ArgumentException("No verified debug support for " + view + " in shader " + shaderName);
                    shaderNames.Add(shaderName);
                }
            }
            if (!(GraphicsSettings.currentRenderPipeline is UniversalRenderPipelineAsset)) throw new InvalidOperationException("Material capture requires URP.");
            var settings = UniversalRenderPipelineDebugDisplaySettings.Instance;
            if (settings.AreAnySettingsActive) throw new InvalidOperationException("Disable existing Rendering Debugger overrides before capture.");
            var request = new UniversalRenderPipeline.SingleCameraRequest();
            if (!RenderPipeline.SupportsRenderRequest(camera, request)) throw new InvalidOperationException("Camera does not support the URP single-camera capture request.");
            var target = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Linear);
            CameraClearFlags oldClearFlags = camera.clearFlags;
            Color oldBackground = camera.backgroundColor;
            int shadowProperty = Shader.PropertyToID("_HelixShadowDebug");
            int oldShadow = Shader.GetGlobalInt(shadowProperty);
            var oldMaterial = settings.materialSettings.materialDebugMode;
            var oldLighting = settings.lightingSettings.lightingDebugMode;
            var oldPost = settings.renderingSettings.postProcessingDebugMode;
            try {
                Shader.SetGlobalInt(shadowProperty, view == "shadow-attenuation" ? 1 : 0);
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = Color.clear;
                settings.materialSettings.materialDebugMode = materialMode;
                settings.lightingSettings.lightingDebugMode = lightingMode;
                settings.renderingSettings.postProcessingDebugMode = DebugPostProcessingMode.Disabled;
                request.destination = target;
                RenderPipeline.SubmitRenderRequest(camera, request);
                return ReadAndSave(target, output, view, new JObject {
                    ["captureMethod"] = "URP Rendering Debugger single-camera request",
                    ["declaredShaders"] = shaderNames,
                    ["coordinates"] = "URP native; shaded normals are world-space encoded as value * 0.5 + 0.5",
                    ["coverage"] = "URP debug-aware shaders only; shadow-attenuation requires the Helix shadow shader hook. Camera stack overlays are excluded.",
                    ["shadowScope"] = view == "shadow-attenuation" ? "main light shadow attenuation; HelixDebugViews shader contract" : null,
                    ["encoding"] = "URP output into linear RGBA8; lighting values above 1 clip",
                    ["camera"] = CameraReceipt(camera)
                });
            }
            finally {
                Shader.SetGlobalInt(shadowProperty, oldShadow);
                camera.clearFlags = oldClearFlags;
                camera.backgroundColor = oldBackground;
                settings.materialSettings.materialDebugMode = oldMaterial;
                settings.lightingSettings.lightingDebugMode = oldLighting;
                settings.renderingSettings.postProcessingDebugMode = oldPost;
                RenderTexture.ReleaseTemporary(target);
            }
        }

        private static Color MaterialColor(string id)
        {
            uint hash = 2166136261;
            foreach (byte value in Encoding.UTF8.GetBytes(id)) hash = unchecked((hash ^ value) * 16777619);
            return new Color((hash & 255) / 255f, ((hash >> 8) & 255) / 255f, ((hash >> 16) & 255) / 255f, 1);
        }

        private static JObject CameraReceipt(Camera camera) => new JObject {
            ["name"] = camera.name, ["projection"] = MatrixValues(camera.projectionMatrix),
            ["worldToCamera"] = MatrixValues(camera.worldToCameraMatrix)
        };

        private static JArray MatrixValues(Matrix4x4 matrix)
        {
            var values = new JArray();
            for (int column = 0; column < 4; column++)
                for (int row = 0; row < 4; row++) values.Add(matrix[row, column]);
            return values;
        }

        private static void RequireCamera(Camera camera, int width, int height)
        {
            if (camera == null || width < 1 || height < 1 || width > 4096 || height > 4096)
                throw new ArgumentException("Supply a camera and native dimensions in 1..4096.");
            if (camera.cameraType == CameraType.Preview) throw new ArgumentException("Preview cameras do not support URP debug captures.");
        }

        private static void RequireOutput(string output)
        {
            if (Directory.Exists(output) && Directory.GetFileSystemEntries(output).Length != 0)
                throw new InvalidOperationException("Use a fresh empty debug output directory.");
        }

        private static string ReadAndSave(RenderTexture target, string output, string view, JObject receipt)
        {
            RenderTexture active = RenderTexture.active;
            var image = new Texture2D(target.width, target.height, TextureFormat.RGBA32, false, true);
            try {
                RenderTexture.active = target;
                image.ReadPixels(new Rect(0, 0, target.width, target.height), 0, 0);
                image.Apply();
                return Save(image, output, view, receipt);
            }
            finally {
                RenderTexture.active = active;
                UnityEngine.Object.DestroyImmediate(image);
            }
        }

        private static string Save(Texture2D image, string output, string view, JObject receipt)
        {
            byte[] bytes = image.EncodeToPNG();
            Directory.CreateDirectory(output);
            using (var stream = new FileStream(Path.Combine(output, "unity.png"), FileMode.CreateNew, FileAccess.Write)) stream.Write(bytes, 0, bytes.Length);
            receipt["schemaVersion"] = 1;
            receipt["kind"] = Array.IndexOf(ImageViews, view) >= 0 ? "helix-image-debug" : "helix-render-debug";
            receipt["view"] = view;
            receipt["image"] = "unity.png";
            receipt["sha256"] = ComparisonSession.Hash(bytes);
            receipt["width"] = image.width;
            receipt["height"] = image.height;
            receipt["capturedUtc"] = DateTime.UtcNow.ToString("O");
            using (var writer = new StreamWriter(new FileStream(Path.Combine(output, "debug.json"), FileMode.CreateNew, FileAccess.Write))) writer.Write(receipt.ToString());
            return receipt.ToString();
        }
    }
}
