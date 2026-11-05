using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Helix.Comparison
{
    // Deliberately edits existing objects only. Game bindings and state semantics belong to adapters.
    public static class UiAuthoring
    {
        private static readonly string[] LayoutKeys = { "anchorMin", "anchorMax", "pivot", "anchoredPosition", "sizeDelta" };

        public static string Inspect(string prefabPath)
        {
            string path = AssetPath(prefabPath, ".prefab");
            var nodes = new JArray();
            GameObject root = PrefabUtility.LoadPrefabContents(path);
            try {
                foreach (RectTransform rect in root.GetComponentsInChildren<RectTransform>(true)) {
                    var layout = new JObject();
                    foreach (string key in LayoutKeys) { Vector2 value = Get(rect, key); layout[key] = new JArray(value.x, value.y); }
                    var controllers = new JArray();
                    var componentTypes = new HashSet<string>(StringComparer.Ordinal);
                    for (Transform current = rect; current != null; current = current.parent) {
                        foreach (Component component in current.GetComponents<Component>()) {
                            if (component == null) { controllers.Add("missing-script"); continue; }
                            for (Type type = component.GetType(); type != null; type = type.BaseType) { componentTypes.Add(type.FullName); }
                            if (component is Animator || IsType(component.GetType(), "UnityEngine.UI.LayoutGroup") || IsType(component.GetType(), "UnityEngine.UI.ContentSizeFitter") || IsType(component.GetType(), "UnityEngine.UI.AspectRatioFitter")) {
                                if (!(component is Behaviour behaviour) || behaviour.enabled) { controllers.Add(component.GetType().FullName); }
                            }
                        }
                    }
                    nodes.Add(new JObject { ["target"] = AnimationUtility.CalculateTransformPath(rect, root.transform), ["layout"] = layout, ["nested"] = PrefabUtility.IsPartOfPrefabInstance(rect.gameObject), ["controllers"] = controllers, ["componentTypes"] = new JArray(componentTypes.OrderBy(name => name)), ["hasImage"] = Image(rect) != null });
                }
            } finally { PrefabUtility.UnloadPrefabContents(root); }
            return new JObject { ["prefab"] = path, ["prefabSha256"] = Hash(path), ["nodes"] = nodes }.ToString();
        }

        public static string Preview(string planJsonPath)
        {
            JObject plan = Read(planJsonPath);
            Validate(plan);
            return new JObject { ["valid"] = true, ["planSha256"] = Hash(planJsonPath), ["operationCount"] = ((JArray)plan["operations"]).Count }.ToString();
        }

        public static string Apply(string planJsonPath, string expectedPlanSha256)
        {
            byte[] planBytes = File.ReadAllBytes(planJsonPath);
            Require(Hash(planBytes) == expectedPlanSha256, "Plan hash changed; preview again.");
            JObject plan = JObject.Parse(System.Text.Encoding.UTF8.GetString(planBytes));
            Validate(plan);
            var backups = new Dictionary<string, byte[]>();
            var created = new List<string>();
            var receipts = new JArray();
            foreach (JObject op in (JArray)plan["operations"]) {
                string path = (string)op["prefab"];
                if (!backups.ContainsKey(path)) {
                    backups[path] = File.ReadAllBytes(path);
                    backups[path + ".meta"] = File.ReadAllBytes(path + ".meta");
                }
            }
            try {
                foreach (JObject asset in (JArray)plan["assets"]) {
                    string destination = (string)asset["destination"];
                    // Parents must already exist, so rollback never removes somebody else's directories.
                    byte[] bytes = File.ReadAllBytes((string)asset["source"]);
                    Require(Hash(bytes) == (string)asset["sha256"], "Asset source changed after validation.");
                    using (var stream = new FileStream(destination, FileMode.CreateNew, FileAccess.Write)) {
                        created.Add(destination);
                        stream.Write(bytes, 0, bytes.Length);
                    }
                    AssetDatabase.ImportAsset(destination, ImportAssetOptions.ForceSynchronousImport);
                    var importer = (TextureImporter)AssetImporter.GetAtPath(destination);
                    importer.textureType = TextureImporterType.Sprite;
                    importer.textureCompression = TextureImporterCompression.Uncompressed;
                    importer.mipmapEnabled = false;
                    importer.wrapMode = TextureWrapMode.Clamp;
                    importer.filterMode = FilterMode.Bilinear;
                    importer.spriteImportMode = SpriteImportMode.Single;
                    importer.spritePixelsPerUnit = (float)asset["pixelsPerUnit"];
                    TextureImporterSettings settings = new TextureImporterSettings();
                    importer.ReadTextureSettings(settings);
                    settings.spriteAlignment = (int)SpriteAlignment.Custom;
                    settings.spritePivot = Pair(asset["pivot"], true);
                    importer.SetTextureSettings(settings);
                    var border = (JArray)asset["border"];
                    importer.spriteBorder = new Vector4((float)border[0], (float)border[1], (float)border[2], (float)border[3]);
                    importer.SaveAndReimport();
                    receipts.Add(new JObject { ["asset"] = destination, ["afterSha256"] = Hash(destination) });
                }
                foreach (var group in ((JArray)plan["operations"]).Cast<JObject>().GroupBy(op => (string)op["prefab"])) {
                    Require(Hash(group.Key) == Hash(backups[group.Key]), "Prefab changed during apply.");
                    GameObject root = PrefabUtility.LoadPrefabContents(group.Key);
                    try {
                        foreach (JObject op in group) {
                            RectTransform rect = Target(root, (string)op["target"]);
                            Set(rect, (JObject)op["set"]);
                        }
                        PrefabUtility.SaveAsPrefabAsset(root, group.Key, out bool success);
                        Require(success, "Prefab save failed: " + group.Key);
                    } finally { PrefabUtility.UnloadPrefabContents(root); }
                    receipts.Add(new JObject { ["prefab"] = group.Key, ["beforeSha256"] = Hash(backups[group.Key]), ["afterSha256"] = Hash(group.Key) });
                }
                return new JObject { ["applied"] = true, ["planSha256"] = expectedPlanSha256, ["changes"] = receipts }.ToString();
            } catch {
                foreach (var backup in backups) { File.WriteAllBytes(backup.Key, backup.Value); }
                foreach (string path in created) {
                    AssetDatabase.DeleteAsset(path);
                    if (File.Exists(path)) { File.Delete(path); }
                    if (File.Exists(path + ".meta")) { File.Delete(path + ".meta"); }
                }
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                throw;
            }
        }

        private static JObject Read(string path) { return JObject.Parse(File.ReadAllText(path)); }
        private static void Require(bool condition, string message) { if (!condition) { throw new InvalidOperationException(message); } }
        private static string Hash(string path) { return Hash(File.ReadAllBytes(path)); }
        private static string Hash(byte[] bytes) { using (var sha = SHA256.Create()) { return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); } }

        private static void Validate(JObject plan)
        {
            Require(!EditorApplication.isPlayingOrWillChangePlaymode && !EditorApplication.isCompiling && !EditorApplication.isUpdating, "Editor must be idle in Edit Mode.");
            Require(PrefabStageUtility.GetCurrentPrefabStage() == null, "Close Prefab Mode before authoring.");
            for (int i = 0; i < UnityEngine.SceneManagement.SceneManager.sceneCount; i++) {
                Require(!UnityEngine.SceneManagement.SceneManager.GetSceneAt(i).isDirty, "Save dirty scenes first.");
            }
            Require((int?)plan["schemaVersion"] == 1, "Unsupported plan schema.");
            string root = (string)plan["projectRoot"];
            Require(!string.IsNullOrEmpty(root) && Path.IsPathRooted(root) && Path.GetFullPath(root).TrimEnd('/') == Directory.GetParent(Application.dataPath).FullName, "Plan projectRoot does not match this Editor.");
            Require(plan["operations"] is JArray && plan["assets"] is JArray, "Plan requires operations and assets arrays.");
            Require(plan["controllerTypes"] == null || plan["controllerTypes"] is JArray, "controllerTypes must be an array.");
            var controllerTypes = new List<string>();
            if (plan["controllerTypes"] is JArray declaredControllers) {
                foreach (JToken declared in declaredControllers) {
                    Require(declared.Type == JTokenType.String && !string.IsNullOrWhiteSpace((string)declared), "Controller types must be nonempty type names.");
                    controllerTypes.Add((string)declared);
                }
            }
            var destinations = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (JObject asset in (JArray)plan["assets"]) {
                string destination = AssetPath((string)asset["destination"], ".png");
                Require(destinations.Add(destination) && !File.Exists(destination) && !File.Exists(destination + ".meta"), "Asset destination already exists or is duplicated.");
                Require(Directory.Exists(Path.GetDirectoryName(destination)), "Create destination folder explicitly before preview.");
                string source = (string)asset["source"];
                Require(!string.IsNullOrEmpty(source) && Path.IsPathRooted(source), "Source must be absolute.");
                NoLinks(source);
                Require(Hash(source) == (string)asset["sha256"], "Source hash mismatch.");
                Pair(asset["pivot"], true);
                Require(Number(asset["pixelsPerUnit"]) > 0, "pixelsPerUnit must be positive.");
                var border = asset["border"] as JArray;
                Require(border != null && border.Count == 4 && border.All(v => Number(v) >= 0), "Border needs four nonnegative values.");
                var texture = new Texture2D(2, 2);
                try {
                    byte[] bytes = File.ReadAllBytes(source);
                    Require(bytes.Length > 8 && bytes[0] == 137 && bytes[1] == 80 && bytes[2] == 78 && bytes[3] == 71 && texture.LoadImage(bytes), "Source must be a readable PNG.");
                    Require((float)border[0] + (float)border[2] <= texture.width && (float)border[1] + (float)border[3] <= texture.height, "Border exceeds image dimensions.");
                } finally { UnityEngine.Object.DestroyImmediate(texture); }
            }
            var targets = new HashSet<string>();
            foreach (JObject op in (JArray)plan["operations"]) {
                string path = AssetPath((string)op["prefab"], ".prefab");
                Require(File.Exists(path) && File.Exists(path + ".meta") && Hash(path) == (string)op["prefabSha256"], "Stale or missing prefab: " + path);
                Require(targets.Add(path + "\n" + (string)op["target"]), "Duplicate prefab target.");
                Require(!EditorUtility.IsDirty(AssetDatabase.LoadAssetAtPath<GameObject>(path)), "Prefab asset is dirty.");
                JObject expected = op["expected"] as JObject;
                JObject values = op["set"] as JObject;
                Require(expected != null && values != null && values.Count > 0, "Expected and nonempty set are required.");
                Require(expected.Properties().All(p => LayoutKeys.Contains(p.Name)) && values.Properties().All(p => LayoutKeys.Contains(p.Name) || p.Name == "sprite"), "Unsupported layout property.");
                foreach (string key in LayoutKeys) { Pair(expected[key], key == "pivot" || key.StartsWith("anchor") && key != "anchoredPosition"); }
                foreach (var value in values.Properties().Where(p => p.Name != "sprite")) { Pair(value.Value, value.Name == "pivot" || value.Name == "anchorMin" || value.Name == "anchorMax"); }
                if (values["sprite"] != null) {
                    string sprite = AssetPath((string)values["sprite"], ".png");
                    Require(destinations.Contains(sprite) || AssetDatabase.LoadAssetAtPath<Sprite>(sprite) != null, "Sprite must be imported or part of this plan.");
                }
                GameObject prefab = PrefabUtility.LoadPrefabContents(path);
                try {
                    RectTransform rect = Target(prefab, (string)op["target"]);
                    Require(!PrefabUtility.IsPartOfPrefabInstance(rect.gameObject), "Nested prefab targets must be edited through their source prefab.");
                    for (Transform current = rect; current != null; current = current.parent) {
                        foreach (Component component in current.GetComponents<Component>()) {
                            Require(component != null, "Missing script on target or ancestor.");
                            string type = component.GetType().FullName;
                            bool driver = controllerTypes.Any(name => IsType(component.GetType(), name)) || component is Animator || IsType(component.GetType(), "UnityEngine.UI.LayoutGroup") || type == "UnityEngine.UI.ContentSizeFitter" || type == "UnityEngine.UI.AspectRatioFitter";
                            Require(!driver || !(component is Behaviour behaviour) || !behaviour.enabled, "Layout or animation controller owns this target.");
                        }
                    }
                    Require(rect.drivenByObject == null, "RectTransform is driven.");
                    foreach (string key in LayoutKeys) { Require((Get(rect, key) - Pair(expected[key], false)).sqrMagnitude < 0.000001f, "Layout precondition failed: " + key); }
                    if (values["sprite"] != null) { Require(Image(rect) != null, "Sprite assignment needs an existing uGUI Image."); }
                } finally { PrefabUtility.UnloadPrefabContents(prefab); }
            }
        }

        private static bool IsType(Type type, string name)
        {
            for (; type != null; type = type.BaseType) { if (type.FullName == name) { return true; } }
            return false;
        }
        private static Component Image(RectTransform rect) { return rect.GetComponents<Component>().FirstOrDefault(c => c != null && IsType(c.GetType(), "UnityEngine.UI.Image")); }
        private static string AssetPath(string path, string extension)
        {
            Require(path != null && path.StartsWith("Assets/", StringComparison.Ordinal) && path.EndsWith(extension, StringComparison.OrdinalIgnoreCase) && !path.Contains('\\') && !path.Split('/').Any(p => p == ".." || p == "." || p.Length == 0), "Unsafe asset path.");
            NoLinks(Path.GetFullPath(path));
            return path;
        }
        private static void NoLinks(string path)
        {
            for (string current = Path.GetFullPath(path); !string.IsNullOrEmpty(current); current = Path.GetDirectoryName(current)) {
                if (File.Exists(current) || Directory.Exists(current)) { Require((File.GetAttributes(current) & FileAttributes.ReparsePoint) == 0, "Symlink paths are unsupported: " + current); }
            }
        }
        private static float Number(JToken value)
        {
            Require(value != null && (value.Type == JTokenType.Float || value.Type == JTokenType.Integer), "Expected a number.");
            float number = (float)value;
            Require(!float.IsInfinity(number) && !float.IsNaN(number), "Expected finite number.");
            return number;
        }
        private static Vector2 Pair(JToken value, bool normalized)
        {
            var pair = value as JArray;
            Require(pair != null && pair.Count == 2, "Expected a two-number vector.");
            var vector = new Vector2(Number(pair[0]), Number(pair[1]));
            Require(!normalized || vector.x >= 0 && vector.x <= 1 && vector.y >= 0 && vector.y <= 1, "Anchors/pivots must be normalized.");
            return vector;
        }
        private static RectTransform Target(GameObject root, string path)
        {
            Require(path != null && !path.Split('/').Any(p => p == "." || p == ".."), "Invalid target path.");
            Transform current = root.transform;
            if (path.Length > 0) {
                foreach (string segment in path.Split('/')) {
                    var matches = current.Cast<Transform>().Where(t => t.name == segment).ToArray();
                    Require(matches.Length == 1, "Missing or ambiguous target: " + path);
                    current = matches[0];
                }
            }
            Require(current is RectTransform, "Target needs an existing RectTransform.");
            return (RectTransform)current;
        }
        private static Vector2 Get(RectTransform rect, string key)
        {
            return (Vector2)typeof(RectTransform).GetProperty(key).GetValue(rect);
        }
        private static void Set(RectTransform rect, JObject values)
        {
            foreach (string key in LayoutKeys) {
                if (values[key] != null) { typeof(RectTransform).GetProperty(key).SetValue(rect, Pair(values[key], false)); }
            }
            if (values["sprite"] != null) { Image(rect).GetType().GetProperty("sprite").SetValue(Image(rect), AssetDatabase.LoadAssetAtPath<Sprite>((string)values["sprite"])); }
        }
    }
}
