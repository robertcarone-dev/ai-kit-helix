using System;
using System.IO;
using System.Security.Cryptography;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Helix.Comparison
{
    public static class ComparisonSession
    {
        private const string OwnerKey = "Helix.Comparison.Owner";
        private static string Root => Path.GetFullPath(Path.Combine(Application.dataPath, ".."));

        public static string Begin(string adapterType, string scenario, string output, int width, int height)
        {
            if (SessionState.GetString(OwnerKey, string.Empty).Length > 0) {
                throw new InvalidOperationException("An owned comparison requires restoration first.");
            }
            RequireIdle();
            if (string.IsNullOrWhiteSpace(scenario) || width < 1 || height < 1 || width > 4096 || height > 4096) {
                throw new ArgumentException("Supply a scenario and native dimensions in 1..4096.");
            }
            for (int index = 0; index < SceneManager.sceneCount; index++) {
                Scene scene = SceneManager.GetSceneAt(index);
                if (scene.isDirty || (scene.path.Length == 0 && scene.rootCount > 0)) {
                    throw new InvalidOperationException("Save or discard scene edits before comparison.");
                }
            }
            var context = new ComparisonContext {
                Scenario = scenario,
                Output = OutputPath(output),
                ProjectRoot = Root,
                Width = width,
                Height = height,
                ProjectState = new JObject()
            };
            if (Directory.Exists(context.Output) && Array.Exists(Directory.GetFileSystemEntries(context.Output), file => Path.GetFileName(file) != "scene-request.json" || Directory.Exists(file))) {
                throw new InvalidOperationException("Use a fresh empty comparison output directory.");
            }
            string sceneRequest = Path.Combine(context.Output, "scene-request.json");
            if (File.Exists(sceneRequest)) {
                context.SceneOptions = JObject.Parse(File.ReadAllText(sceneRequest));
            }
            ComparisonAdapter adapter = Adapter(adapterType);
            JObject proof = adapter.Preflight(context);
            if (proof == null || proof.Value<bool?>("storageIsolated") != true ||
                proof.Value<bool?>("compatible") != true || proof.Value<string>("projectRoot") != Root) {
                throw new InvalidOperationException("Project preflight must verify storage isolation, compatibility and target project.");
            }
            context.ProjectState = adapter.SaveState(context);
            if (context.ProjectState == null) {
                throw new InvalidOperationException("Project baseline is required.");
            }
            var baseline = new JObject {
                ["adapterType"] = adapterType,
                ["context"] = JObject.FromObject(context),
                ["preflight"] = proof,
                ["quality"] = QualitySettings.GetQualityLevel(),
                ["random"] = JsonUtility.ToJson(UnityEngine.Random.state),
                ["timeScale"] = Time.timeScale,
                ["runInBackground"] = Application.runInBackground,
                ["paused"] = EditorApplication.isPaused,
                ["scenes"] = JArray.FromObject(EditorSceneManager.GetSceneManagerSetup()),
                ["prepared"] = false
            };
            Directory.CreateDirectory(context.Output);
            WriteNew(Path.Combine(context.Output, "unity-before.json"), baseline.ToString());
            // Ownership precedes every mutating adapter hook; failure leaves a recoverable baseline.
            SessionState.SetString(OwnerKey, baseline.ToString(Formatting.None));
            return "Comparison owned; run the supplied prepare recipe.";
        }

        public static string Prepare(string output)
        {
            JObject baseline = Owned(output);
            if (baseline.Value<bool>("prepareAttempted")) {
                throw new InvalidOperationException("Preparation already attempted; restore before retrying.");
            }
            baseline["prepareAttempted"] = true;
            SessionState.SetString(OwnerKey, baseline.ToString(Formatting.None));
            Adapter(baseline.Value<string>("adapterType")).Prepare(Context(baseline));
            baseline["prepared"] = true;
            SessionState.SetString(OwnerKey, baseline.ToString(Formatting.None));
            return "Preparation requested; poll Ready before capture.";
        }

        public static bool Ready(string output)
        {
            JObject baseline = Owned(output);
            return baseline.Value<bool>("prepared") && !EditorApplication.isCompiling && !EditorApplication.isUpdating &&
                Adapter(baseline.Value<string>("adapterType")).IsReady(Context(baseline));
        }

        public static string View(string output, string name)
        {
            JObject baseline = Owned(output);
            if (!Ready(output)) {
                throw new InvalidOperationException("Requested fixture is not ready.");
            }
            if (string.IsNullOrWhiteSpace(name)) {
                throw new ArgumentException("A view name is required.");
            }
            Adapter(baseline.Value<string>("adapterType")).SelectView(Context(baseline), name);
            return "View requested; poll Ready and wait for its rendered frame.";
        }

        public static string Capture(string output)
        {
            JObject baseline = Owned(output);
            ComparisonContext context = Context(baseline);
            if (!Ready(output)) {
                throw new InvalidOperationException("Requested fixture is not ready.");
            }
            string png = Path.Combine(context.Output, "unity.png");
            string receipt = Path.Combine(context.Output, "unity.json");
            if (File.Exists(png) || File.Exists(receipt)) {
                throw new InvalidOperationException("Evidence already exists; never overwrite a capture.");
            }
            bool paused = EditorApplication.isPaused;
            try {
                EditorApplication.isPaused = true;
                int frameNumber = Time.frameCount;
                ComparisonFrame frame = Adapter(baseline.Value<string>("adapterType")).Capture(context);
                if (frame == null || frame.Image == null || frame.Ui == null || string.IsNullOrWhiteSpace(frame.Source)) {
                    throw new InvalidOperationException("The adapter must supply a native image, UI observations and capture source.");
                }
                if (frame.Image.width != context.Width || frame.Image.height != context.Height || Time.frameCount != frameNumber) {
                    throw new InvalidOperationException("Native image dimensions or capture frame changed.");
                }
                JObject ui = frame.Ui;
                if (ui.Value<int?>("schemaVersion") != 1 || ui.Value<string>("coordinateSpace") != "native-top-left-pixels" ||
                    (int?)ui["viewport"]?["width"] != context.Width || (int?)ui["viewport"]?["height"] != context.Height ||
                    (double?)ui["viewport"]?["dpr"] != 1 || (double?)ui["viewport"]?["zoom"] != 1 ||
                    !(ui["state"] is JObject) || !(ui["nodes"] is JArray) || !(ui["safeArea"] is JObject)) {
                    throw new InvalidOperationException("UI observations must describe the native image, state and actual safe area.");
                }
                if (context.SceneOptions != null && frame.Scene == null) {
                    throw new InvalidOperationException("Requested scene observations require adapter support.");
                }
                if (frame.Scene != null && (frame.Scene.Value<string>("kind") != "helix-scene" || frame.Scene.Value<bool?>("truncated") != false ||
                    (int?)frame.Scene["viewport"]?["width"] != context.Width || (int?)frame.Scene["viewport"]?["height"] != context.Height ||
                    !JToken.DeepEquals(frame.Scene["state"], ui["state"]) || !JToken.DeepEquals(frame.Scene["checkpoint"], ui["checkpoint"]))) {
                    throw new InvalidOperationException("Scene observations must match native UI state and checkpoint.");
                }
                JObject safeArea = (JObject)ui["safeArea"];
                foreach (string key in new[] { "x", "y", "width", "height" }) {
                    JToken value = safeArea[key];
                    if (value == null || (value.Type != JTokenType.Integer && value.Type != JTokenType.Float) ||
                        !double.IsFinite(value.Value<double>()) || value.Value<double>() < 0) {
                        throw new InvalidOperationException("Safe area requires finite nonnegative pixel measurements.");
                    }
                }
                if ((double)safeArea["x"] + (double)safeArea["width"] > context.Width ||
                    (double)safeArea["y"] + (double)safeArea["height"] > context.Height) {
                    throw new InvalidOperationException("Safe area exceeds the native viewport.");
                }
                byte[] bytes = frame.Image.EncodeToPNG();
                if (bytes == null || bytes.Length == 0) {
                    throw new InvalidOperationException("Native PNG encoding failed.");
                }
                var result = new JObject {
                    ["schemaVersion"] = 1,
                    ["image"] = "unity.png",
                    ["sha256"] = Hash(bytes),
                    ["ui"] = ui,
                    ["scene"] = frame.Scene,
                    ["native"] = new JObject { ["width"] = context.Width, ["height"] = context.Height },
                    ["projectRoot"] = Root,
                    ["editorId"] = "unity:" + System.Diagnostics.Process.GetCurrentProcess().Id,
                    ["scenario"] = context.Scenario,
                    ["source"] = frame.Source,
                    ["capturedFrame"] = frameNumber,
                    ["capturedUtc"] = DateTime.UtcNow.ToString("O"),
                    ["preflight"] = baseline["preflight"].DeepClone(),
                    ["baselineSha256"] = Hash(File.ReadAllBytes(Path.Combine(context.Output, "unity-before.json"))),
                    ["ready"] = true,
                    ["navigationProof"] = false
                };
                using (var stream = new FileStream(png, FileMode.CreateNew, FileAccess.Write)) {
                    stream.Write(bytes, 0, bytes.Length);
                }
                WriteNew(receipt, result.ToString());
                return result.ToString(Formatting.None);
            }
            finally {
                EditorApplication.isPaused = paused;
            }
        }

        public static string CaptureDebugImage(string output, string view)
        {
            ComparisonContext context = Context(Owned(output));
            if (Array.IndexOf(new[] { "final", "luminance", "hue", "saturation", "value", "alpha" }, view) < 0)
                throw new ArgumentException("Unknown image debug view: " + view);
            return DebugViewCapture.ExportImage(Path.Combine(context.Output, "unity.png"), Path.Combine(context.Output, "debug-" + view), view);
        }

        public static string Restore(string output)
        {
            if (SessionState.GetString(OwnerKey, string.Empty).Length == 0) {
                string path = OutputPath(output);
                if (!File.Exists(Path.Combine(path, "unity-before.json"))) {
                    return "No comparison session was acquired.";
                }
                if (File.Exists(Path.Combine(path, "unity-restored.json"))) {
                    return File.ReadAllText(Path.Combine(path, "unity-restored.json"));
                }
                throw new InvalidOperationException("Baseline exists without a restoration receipt or session owner; operator recovery is required.");
            }
            JObject baseline = Owned(output);
            RequireIdle();
            ComparisonContext context = Context(baseline);
            ComparisonAdapter adapter = Adapter(baseline.Value<string>("adapterType"));
            adapter.Restore(context);
            QualitySettings.SetQualityLevel(baseline.Value<int>("quality"), true);
            UnityEngine.Random.state = JsonUtility.FromJson<UnityEngine.Random.State>(baseline.Value<string>("random"));
            Time.timeScale = baseline.Value<float>("timeScale");
            Application.runInBackground = baseline.Value<bool>("runInBackground");
            EditorApplication.isPaused = baseline.Value<bool>("paused");
            SceneSetup[] scenes = baseline["scenes"].ToObject<SceneSetup[]>();
            if (scenes.Length == 0) {
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            } else {
                EditorSceneManager.RestoreSceneManagerSetup(scenes);
            }
            if (!adapter.VerifyRestored(context)) {
                throw new InvalidOperationException("Project restoration has not completed; retain ownership and inspect the adapter.");
            }
            var result = new JObject { ["restored"] = true, ["projectRoot"] = Root, ["restoredUtc"] = DateTime.UtcNow.ToString("O") };
            WriteNew(Path.Combine(context.Output, "unity-restored.json"), result.ToString());
            SessionState.EraseString(OwnerKey);
            return result.ToString(Formatting.None);
        }

        private static void RequireIdle()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode || EditorApplication.isCompiling || EditorApplication.isUpdating) {
                throw new InvalidOperationException("An idle compiled Editor in Edit mode is required.");
            }
        }

        private static ComparisonContext Context(JObject baseline) => baseline["context"].ToObject<ComparisonContext>();

        private static ComparisonAdapter Adapter(string name)
        {
            Type type = Type.GetType(name, true);
            if (!typeof(ComparisonAdapter).IsAssignableFrom(type) || type.IsAbstract) {
                throw new ArgumentException("Adapter must be a concrete ComparisonAdapter with a public parameterless constructor.");
            }
            return (ComparisonAdapter)Activator.CreateInstance(type);
        }

        private static JObject Owned(string output)
        {
            string owner = SessionState.GetString(OwnerKey, string.Empty);
            if (owner.Length == 0) {
                throw new InvalidOperationException("No comparison is owned by this helper.");
            }
            JObject baseline = JObject.Parse(owner);
            ComparisonContext context = Context(baseline);
            if (context.Output != OutputPath(output) || context.ProjectRoot != Root) {
                throw new InvalidOperationException("Comparison belongs to a different output or project.");
            }
            return baseline;
        }

        private static string OutputPath(string output)
        {
            string path = Path.GetFullPath(output);
            string prefix = Path.Combine(Root, ".aikit", "scratch") + Path.DirectorySeparatorChar;
            if (!path.StartsWith(prefix, StringComparison.Ordinal)) {
                throw new ArgumentException("Output must be below this project's .aikit/scratch.");
            }
            for (var dir = new DirectoryInfo(path); dir != null && dir.FullName != Root; dir = dir.Parent) {
                if (dir.Exists && (dir.Attributes & FileAttributes.ReparsePoint) != 0) {
                    throw new ArgumentException("Comparison output cannot traverse links.");
                }
            }
            return path;
        }

        private static void WriteNew(string path, string value)
        {
            using (var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write))
            using (var writer = new StreamWriter(stream)) {
                writer.Write(value);
            }
        }

        internal static string Hash(byte[] bytes)
        {
            using (SHA256 hash = SHA256.Create()) {
                return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", string.Empty).ToLowerInvariant();
            }
        }
    }
}
