using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
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
        private static readonly string[] _layoutKeys = { "anchorMin", "anchorMax", "pivot", "anchoredPosition", "sizeDelta" };

        public static string Inspect(string prefabPath)
        {
            string path = AssetPath(prefabPath, ".prefab");
            var nodes = new JArray();
            GameObject root = PrefabUtility.LoadPrefabContents(path);
            try {
                foreach (RectTransform rect in root.GetComponentsInChildren<RectTransform>(true)) {
                    var layout = new JObject();
                    foreach (string key in _layoutKeys) {
                        Vector2 value = Get(rect, key);
                        layout[key] = new JArray(value.x, value.y);
                    }

                    var controllers = new JArray();
                    var componentTypes = new HashSet<string>(StringComparer.Ordinal);
                    for (Transform current = rect; current != null; current = current.parent) {
                        foreach (Component component in current.GetComponents<Component>()) {
                            if (component == null) {
                                controllers.Add("missing-script");
                                continue;
                            }
                            for (Type type = component.GetType(); type != null; type = type.BaseType) {
                                componentTypes.Add(type.FullName);
                            }
                            if (component is Animator ||
                                IsType(component.GetType(), "UnityEngine.UI.LayoutGroup") ||
                                IsType(component.GetType(), "UnityEngine.UI.ContentSizeFitter") ||
                                IsType(component.GetType(), "UnityEngine.UI.AspectRatioFitter")) {
                                if (!(component is Behaviour behaviour) || behaviour.enabled) {
                                    controllers.Add(component.GetType().FullName);
                                }
                            }
                        }
                    }

                    nodes.Add(new JObject {
                        ["target"] = AnimationUtility.CalculateTransformPath(rect, root.transform),
                        ["layout"] = layout,
                        ["nested"] = PrefabUtility.IsPartOfPrefabInstance(rect.gameObject),
                        ["controllers"] = controllers,
                        ["componentTypes"] = new JArray(componentTypes.OrderBy(name => name)),
                        ["hasImage"] = Image(rect) != null
                    });
                }
            }
            finally {
                PrefabUtility.UnloadPrefabContents(root);
            }
            return new JObject { ["prefab"] = path, ["prefabSha256"] = Hash(path), ["nodes"] = nodes }.ToString();
        }

        // Inspect persistent prefab assets so corresponding sources describe the containing variant
        // and each nested source. Component and field names for runtime style bindings are adapter data.
        public static string Inspect(string prefabPath, string target, string componentType, string field, string kind)
        {
            string path = AssetPath(prefabPath, ".prefab");
            JObject result = VisualInfo(path, target, componentType, field, kind);
            result["consumers"] = Consumers((string)result["owner"]);
            return result.ToString();
        }

        // Resolve each serialized scalar separately: a variant can override just one axis.
        public static string InspectLayout(string prefabPath, string target, params string[] controllerTypes)
        {
            string path = AssetPath(prefabPath, ".prefab");
            GameObject root = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            Require(root, "Missing prefab: " + path);
            RectTransform rect = Target(root, target);
            var nodes = new JArray();
            var hashes = new JObject { [path] = Hash(path) };
            for (Transform current = rect; current != null; current = current.parent) {
                var components = new JArray();
                foreach (Component component in current.GetComponents<Component>()) {
                    if (!component) {
                        components.Add(new JObject { ["role"] = "missing-script" });
                        continue;
                    }
                    Type type = component.GetType();
                    string role;
                    string[] fields;
                    if (component is RectTransform) {
                        role = "rect";
                        fields = new[] { "m_AnchoredPosition.x", "m_AnchoredPosition.y", "m_SizeDelta.x", "m_SizeDelta.y",
                            "m_AnchorMin.x", "m_AnchorMin.y", "m_AnchorMax.x", "m_AnchorMax.y", "m_Pivot.x", "m_Pivot.y" };
                    } else if (IsType(type, "UnityEngine.UI.LayoutGroup")) {
                        role = "child-layout";
                        fields = new[] { "m_Padding.m_Left", "m_Padding.m_Right", "m_Padding.m_Top", "m_Padding.m_Bottom",
                            "m_Spacing", "m_Spacing.x", "m_Spacing.y", "m_ChildAlignment", "m_ChildControlWidth", "m_ChildControlHeight",
                            "m_ChildForceExpandWidth", "m_ChildForceExpandHeight", "m_CellSize.x", "m_CellSize.y", "m_Constraint", "m_ConstraintCount" };
                    } else if (IsType(type, "UnityEngine.UI.ContentSizeFitter") || IsType(type, "UnityEngine.UI.AspectRatioFitter")) {
                        role = "self-layout";
                        fields = new[] { "m_HorizontalFit", "m_VerticalFit", "m_AspectMode", "m_AspectRatio" };
                    } else if (IsType(type, "UnityEngine.UI.LayoutElement")) {
                        role = "layout-input";
                        fields = new[] { "m_IgnoreLayout", "m_PreferredWidth", "m_PreferredHeight", "m_MinWidth", "m_MinHeight",
                            "m_FlexibleWidth", "m_FlexibleHeight", "m_LayoutPriority" };
                    } else if (IsType(type, "UnityEngine.UI.CanvasScaler")) {
                        role = "canvas-scale";
                        fields = new[] { "m_UiScaleMode", "m_ReferenceResolution.x", "m_ReferenceResolution.y",
                            "m_ScreenMatchMode", "m_MatchWidthOrHeight", "m_ScaleFactor" };
                    } else if (IsType(type, "TMPro.TMP_Text")) {
                        role = "text";
                        fields = new[] { "m_margin.x", "m_margin.y", "m_margin.z", "m_margin.w", "m_fontSize", "m_enableAutoSizing",
                            "m_HorizontalAlignment", "m_VerticalAlignment", "m_lineSpacing" };
                    } else if (component is Animator || controllerTypes.Any(name => IsType(type, name))) {
                        role = "controller";
                        fields = new string[0];
                    } else {
                        continue;
                    }
                    var properties = new JArray();
                    foreach (string field in fields) {
                        var owner = component;
                        var property = new SerializedObject(owner).FindProperty(field);
                        if (property == null || property.propertyType == SerializedPropertyType.Vector2) {
                            continue;
                        }
                        var chain = new JArray();
                        while (true) {
                            string asset = AssetDatabase.GetAssetPath(owner);
                            if (hashes[asset] == null) {
                                hashes[asset] = Hash(asset);
                            }
                            chain.Add(new JObject {
                                ["prefab"] = asset,
                                ["target"] = AnimationUtility.CalculateTransformPath(owner.transform, AssetDatabase.LoadAssetAtPath<GameObject>(asset).transform),
                                ["override"] = property.prefabOverride
                            });
                            var source = PrefabUtility.GetCorrespondingObjectFromSource(owner);
                            if (!source || property.prefabOverride) {
                                break;
                            }
                            owner = source;
                            property = new SerializedObject(owner).FindProperty(field);
                        }
                        properties.Add(new JObject {
                            ["property"] = field,
                            ["value"] = JToken.FromObject(property.boxedValue),
                            ["owner"] = chain.Last.DeepClone(),
                            ["sources"] = chain
                        });
                    }
                    components.Add(new JObject {
                        ["type"] = type.FullName,
                        ["role"] = role,
                        ["enabled"] = !(component is Behaviour behaviour) || behaviour.enabled,
                        ["properties"] = properties
                    });
                }

                nodes.Add(new JObject {
                    ["target"] = AnimationUtility.CalculateTransformPath(current, root.transform),
                    ["components"] = components
                });
            }
            return new JObject {
                ["schemaVersion"] = 1,
                ["prefab"] = path,
                ["target"] = target,
                ["assetHashes"] = hashes,
                ["controllerTypes"] = new JArray(controllerTypes),
                ["nodes"] = nodes
            }.ToString();
        }

        private static JArray Consumers(string owner)
        {
            var paths = new[] { "t:Prefab", "t:Scene" }.SelectMany(filter => AssetDatabase.FindAssets(filter, new[] { "Assets" })).Distinct().Select(AssetDatabase.GUIDToAssetPath);
            return new JArray(paths.Where(path => path != owner && AssetDatabase.GetDependencies(path, true).Contains(owner)).OrderBy(path => path));
        }

        internal static Component VisualComponent(Transform rect, string type)
        {
            Component[] matches = rect.GetComponents<Component>().Where(c => c && IsType(c.GetType(), type)).ToArray();
            Require(matches.Length == 1, "Expected one component of type " + type + " on " + rect.name);
            return matches[0];
        }

        private static SerializedProperty VisualField(Component component, string field, string kind)
        {
            Require(kind == "sprite" || kind == "font" || kind == "material", "Unsupported visual asset kind.");
            var property = new SerializedObject(component).FindProperty(field);
            Require(property != null && property.propertyType == SerializedPropertyType.ObjectReference, "Expected serialized asset reference: " + field);
            string expected = kind == "sprite" ? "UnityEngine.Sprite" : kind == "font" ? "TMPro.TMP_FontAsset" : "UnityEngine.Material";
            System.Reflection.FieldInfo member = null;
            for (var type = component.GetType(); type != null && member == null; type = type.BaseType) {
                member = type.GetField(field, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly);
            }
            Require(member != null && IsType(member.FieldType, expected), "Expected " + expected + " field: " + field);
            return property;
        }

        private static JObject AssetIdentity(UnityEngine.Object asset)
        {
            if (!asset) {
                return null;
            }
            Require(AssetDatabase.TryGetGUIDAndLocalFileIdentifier(asset, out string guid, out long fileId), "Expected a persistent asset.");
            var value = new JObject {
                ["path"] = AssetDatabase.GetAssetPath(asset),
                ["guid"] = guid,
                ["fileId"] = fileId.ToString(System.Globalization.CultureInfo.InvariantCulture)
            };
            if (asset is Material material && material.HasProperty("_MainTex")) {
                value["atlas"] = AssetIdentity(material.GetTexture("_MainTex"));
            }
            if (IsType(asset.GetType(), "TMPro.TMP_FontAsset")) {
                var atlases = new SerializedObject(asset).FindProperty("m_AtlasTextures");
                if (atlases != null) {
                    value["atlases"] = new JArray(Enumerable.Range(0, atlases.arraySize).Select(i => AssetIdentity(atlases.GetArrayElementAtIndex(i).objectReferenceValue)));
                }
            }
            return value;
        }

        private static JObject VisualInfo(string path, string target, string componentType, string field, string kind)
        {
            GameObject root = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            Require(root, "Missing prefab: " + path);
            Component component = VisualComponent(Target(root, target), componentType);
            var chain = new JArray();
            JObject effective = AssetIdentity(VisualField(component, field, kind).objectReferenceValue);
            string owner;
            while (true) {
                var property = VisualField(component, field, kind);
                owner = AssetDatabase.GetAssetPath(component);
                var source = PrefabUtility.GetCorrespondingObjectFromSource(component);
                chain.Add(new JObject {
                    ["prefab"] = owner,
                    ["target"] = AnimationUtility.CalculateTransformPath(component.transform, AssetDatabase.LoadAssetAtPath<GameObject>(owner).transform),
                    ["override"] = property.prefabOverride,
                    ["value"] = AssetIdentity(property.objectReferenceValue)
                });
                if (!source || property.prefabOverride) {
                    break;
                }
                component = source;
            }
            return new JObject {
                ["prefab"] = path,
                ["prefabSha256"] = Hash(path),
                ["target"] = target,
                ["component"] = componentType,
                ["field"] = field,
                ["kind"] = kind,
                ["effective"] = effective,
                ["owner"] = owner,
                ["sources"] = chain
            };
        }

        private static UnityEngine.Object Replacement(JObject op)
        {
            var identity = (JObject)op["replacement"];
            Require(identity != null, "Specify replacement asset identity and hash.");
            string path = (string)identity["path"];
            AssetPath(path, Path.GetExtension(path));
            Require(Hash(path) == (string)identity["sha256"], "Replacement asset changed: " + path);
            var matches = AssetDatabase.LoadAllAssetsAtPath(path).Where(asset => asset && AssetDatabase.TryGetGUIDAndLocalFileIdentifier(asset, out string guid, out long id)
                && guid == (string)identity["guid"] && id.ToString(System.Globalization.CultureInfo.InvariantCulture) == (string)identity["fileId"]).ToArray();
            Require(matches.Length == 1, "Replacement asset identity changed.");
            var value = matches[0];
            string kind = (string)op["kind"];
            Require(kind == "sprite" && value is Sprite || kind == "material" && value is Material || kind == "font" && IsType(value.GetType(), "TMPro.TMP_FontAsset"), "Incorrect replacement type.");
            return value;
        }

        private static JObject ValidateVisual(JObject op)
        {
            string path = (string)op["prefab"];
            var info = VisualInfo(path, (string)op["target"], (string)op["component"], (string)op["field"], (string)op["kind"]);
            Require(op.Property("expected") != null && JToken.DeepEquals(op["expected"], info["effective"]), "Visual value changed. Inspect again.");
            Require((string)info["owner"] == path, "Edit the supplying prefab: " + (string)info["owner"]);
            info["replacement"] = AssetIdentity(Replacement(op));
            return info;
        }

        public static string Preview(string planJsonPath)
        {
            byte[] bytes = File.ReadAllBytes(planJsonPath);
            JObject plan = JObject.Parse(System.Text.Encoding.UTF8.GetString(bytes));
            Validate(plan);
            var visuals = new JArray();
            foreach (JObject op in ((JArray)plan["operations"]).Where(op => op["field"] != null)) {
                var change = ValidateVisual(op);
                change["consumers"] = Consumers((string)change["owner"]);
                visuals.Add(change);
            }
            return new JObject {
                ["visualChanges"] = visuals,
                ["valid"] = true,
                ["planSha256"] = Hash(bytes),
                ["operationCount"] = ((JArray)plan["operations"]).Count
            }.ToString();
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
                            if (op["field"] != null) {
                                Component component = VisualComponent(rect, (string)op["component"]);
                                var property = VisualField(component, (string)op["field"], (string)op["kind"]);
                                property.objectReferenceValue = Replacement(op);
                                property.serializedObject.ApplyModifiedProperties();
                                if (PrefabUtility.IsPartOfPrefabInstance(component)) {
                                    PrefabUtility.RecordPrefabInstancePropertyModifications(component);
                                }
                                continue;
                            }
                            Set(rect, (JObject)op["set"]);
                        }
                        PrefabUtility.SaveAsPrefabAsset(root, group.Key, out bool success);
                        Require(success, "Prefab save failed: " + group.Key);
                    }
                    finally {
                        PrefabUtility.UnloadPrefabContents(root);
                    }
                    receipts.Add(new JObject {
                        ["prefab"] = group.Key,
                        ["beforeSha256"] = Hash(backups[group.Key]),
                        ["afterSha256"] = Hash(group.Key)
                    });
                }
                return new JObject { ["applied"] = true, ["planSha256"] = expectedPlanSha256, ["changes"] = receipts }.ToString();
            }
            catch {
                foreach (var backup in backups) {
                    File.WriteAllBytes(backup.Key, backup.Value);
                }
                foreach (string path in created) {
                    AssetDatabase.DeleteAsset(path);
                    if (File.Exists(path)) {
                        File.Delete(path);
                    }
                    if (File.Exists(path + ".meta")) {
                        File.Delete(path + ".meta");
                    }
                }
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                throw;
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) {
                throw new InvalidOperationException(message);
            }
        }

        internal static string Hash(string path)
        {
            return Hash(File.ReadAllBytes(path));
        }

        private static string Hash(byte[] bytes)
        {
            using (var sha = SHA256.Create()) {
                return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
            }
        }

        private static void Validate(JObject plan)
        {
            Require(!EditorApplication.isPlayingOrWillChangePlaymode && !EditorApplication.isCompiling && !EditorApplication.isUpdating, "Editor must be idle in Edit Mode.");
            Require(PrefabStageUtility.GetCurrentPrefabStage() == null, "Close Prefab Mode before authoring.");
            for (int i = 0; i < UnityEngine.SceneManagement.SceneManager.sceneCount; i++) {
                Require(!UnityEngine.SceneManagement.SceneManager.GetSceneAt(i).isDirty, "Save dirty scenes first.");
            }
            Require((int?)plan["schemaVersion"] == 1, "Unsupported plan schema.");
            string root = (string)plan["projectRoot"];
            Require(!string.IsNullOrEmpty(root) && Path.IsPathRooted(root) &&
                Path.GetFullPath(root).TrimEnd('/') == Directory.GetParent(Application.dataPath).FullName, "Plan projectRoot does not match this Editor.");
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
                }
                finally {
                    UnityEngine.Object.DestroyImmediate(texture);
                }
            }

            var targets = new HashSet<string>();
            foreach (JObject op in (JArray)plan["operations"]) {
                string path = AssetPath((string)op["prefab"], ".prefab");
                Require(File.Exists(path) && File.Exists(path + ".meta") && Hash(path) == (string)op["prefabSha256"], "Stale or missing prefab: " + path);
                Require(targets.Add(path + "\n" + (string)op["target"] + (op["field"] == null ? "" : "\n" + (string)op["component"] + "\n" + (string)op["field"])), "Duplicate prefab target.");
                Require(!EditorUtility.IsDirty(AssetDatabase.LoadAssetAtPath<GameObject>(path)), "Prefab asset is dirty.");
                if (op["field"] != null) {
                    Require(op["set"] == null, "Use separate layout and visual operations.");
                    ValidateVisual(op);
                    continue;
                }
                JObject expected = op["expected"] as JObject;
                JObject values = op["set"] as JObject;
                Require(expected != null && values != null && values.Count > 0, "Expected and nonempty set are required.");
                Require(expected.Properties().All(p => _layoutKeys.Contains(p.Name)) && values.Properties().All(p => _layoutKeys.Contains(p.Name) || p.Name == "sprite"), "Unsupported layout property.");
                foreach (string key in _layoutKeys) {
                    Pair(expected[key], key == "pivot" || key.StartsWith("anchor") && key != "anchoredPosition");
                }
                foreach (var value in values.Properties().Where(p => p.Name != "sprite")) {
                    Pair(value.Value, value.Name == "pivot" || value.Name == "anchorMin" || value.Name == "anchorMax");
                }
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
                            bool driver = controllerTypes.Any(name => IsType(component.GetType(), name)) ||
                                component is Animator || IsType(component.GetType(), "UnityEngine.UI.LayoutGroup") ||
                                type == "UnityEngine.UI.ContentSizeFitter" || type == "UnityEngine.UI.AspectRatioFitter";
                            Require(!driver || !(component is Behaviour behaviour) || !behaviour.enabled, "Layout or animation controller owns this target.");
                        }
                    }
                    Require(rect.drivenByObject == null, "RectTransform is driven.");
                    foreach (string key in _layoutKeys) {
                        Require((Get(rect, key) - Pair(expected[key], false)).sqrMagnitude < 0.000001f, "Layout precondition failed: " + key);
                    }
                    if (values["sprite"] != null) {
                        Require(Image(rect) != null, "Sprite assignment needs an existing uGUI Image.");
                    }
                }
                finally {
                    PrefabUtility.UnloadPrefabContents(prefab);
                }
            }
        }

        private static bool IsType(Type type, string name)
        {
            for (; type != null; type = type.BaseType) {
                if (type.FullName == name) {
                    return true;
                }
            }
            return false;
        }

        private static Component Image(RectTransform rect)
        {
            return rect.GetComponents<Component>().FirstOrDefault(c => c != null && IsType(c.GetType(), "UnityEngine.UI.Image"));
        }

        internal static string AssetPath(string path, string extension)
        {
            Require(path != null && path.StartsWith("Assets/", StringComparison.Ordinal) &&
                path.EndsWith(extension, StringComparison.OrdinalIgnoreCase) &&
                !path.Contains('\\') && !path.Split('/').Any(p => p == ".." || p == "." || p.Length == 0), "Unsafe asset path.");
            NoLinks(Path.GetFullPath(path));
            return path;
        }

        private static void NoLinks(string path)
        {
            for (string current = Path.GetFullPath(path); !string.IsNullOrEmpty(current); current = Path.GetDirectoryName(current)) {
                if (File.Exists(current) || Directory.Exists(current)) {
                    Require((File.GetAttributes(current) & FileAttributes.ReparsePoint) == 0, "Symlink paths are unsupported: " + current);
                }
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
            Transform target = TargetTransform(root, path);
            Require(target is RectTransform, "Target needs an existing RectTransform.");
            return (RectTransform)target;
        }

        internal static Transform TargetTransform(GameObject root, string path)
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
            return current;
        }

        private static Vector2 Get(RectTransform rect, string key)
        {
            return (Vector2)typeof(RectTransform).GetProperty(key).GetValue(rect);
        }

        private static void Set(RectTransform rect, JObject values)
        {
            foreach (string key in _layoutKeys) {
                if (values[key] != null) {
                    typeof(RectTransform).GetProperty(key).SetValue(rect, Pair(values[key], false));
                }
            }
            if (values["sprite"] != null) {
                Image(rect).GetType().GetProperty("sprite").SetValue(Image(rect), AssetDatabase.LoadAssetAtPath<Sprite>((string)values["sprite"]));
            }
        }
    }
}
