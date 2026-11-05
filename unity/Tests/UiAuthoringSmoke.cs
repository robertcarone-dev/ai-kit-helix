using System;
using System.IO;
using System.Security.Cryptography;
using Helix.Comparison;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UI;

public static class UiAuthoringSmoke
{
    private static string Hash(string path) { using (var sha = SHA256.Create()) { return BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(path))).Replace("-", "").ToLowerInvariant(); } }
    private static void Check(bool condition, string message) { if (!condition) { throw new Exception(message); } }
    private static void Reject(Action action) { bool rejected = false; try { action(); } catch (InvalidOperationException) { rejected = true; } Check(rejected, "Expected rejection"); }
    public static void Run()
    {
        try {
            var root = new GameObject("Panel", typeof(RectTransform));
            var child = new GameObject("Icon", typeof(RectTransform), typeof(CanvasRenderer), typeof(Image));
            child.transform.SetParent(root.transform, false);
            var button = root.AddComponent<Button>(); button.targetGraphic = child.GetComponent<Image>();
            PrefabUtility.SaveAsPrefabAsset(root, "Assets/Panel.prefab");
            UnityEngine.Object.DestroyImmediate(root);
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var inspection = JObject.Parse(UiAuthoring.Inspect("Assets/Panel.prefab"));
            var node = (JObject)inspection["nodes"][1];
            string guid = AssetDatabase.AssetPathToGUID("Assets/Panel.prefab");
            var plan = new JObject { ["schemaVersion"] = 1, ["projectRoot"] = Directory.GetCurrentDirectory(), ["assets"] = new JArray(), ["operations"] = new JArray(new JObject { ["id"] = "icon", ["prefab"] = "Assets/Panel.prefab", ["prefabSha256"] = Hash("Assets/Panel.prefab"), ["target"] = "Icon", ["expected"] = node["layout"].DeepClone(), ["set"] = new JObject { ["sizeDelta"] = new JArray(80, 90) } }) };
            string path = Path.GetFullPath("plan.json"); File.WriteAllText(path, plan.ToString());
            UiAuthoring.Preview(path);
            UiAuthoring.Apply(path, Hash(path));
            var saved = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Panel.prefab");
            Check(saved.transform.Find("Icon").GetComponent<RectTransform>().sizeDelta == new Vector2(80,90), "Layout not applied");
            Check(saved.GetComponent<Button>().targetGraphic == saved.transform.Find("Icon").GetComponent<Image>(), "Reference lost");
            Check(AssetDatabase.AssetPathToGUID("Assets/Panel.prefab") == guid, "GUID changed");
            string after = Hash("Assets/Panel.prefab");
            Reject(() => UiAuthoring.Apply(path, Hash(path))); Check(Hash("Assets/Panel.prefab") == after, "Stale plan mutated file");
            plan["operations"][0]["prefabSha256"] = after;
            plan["operations"][0]["expected"] = JObject.Parse(UiAuthoring.Inspect("Assets/Panel.prefab"))["nodes"][1]["layout"].DeepClone();
            plan["operations"][0]["set"]["pivot"] = new JArray(5, 0);
            File.WriteAllText(path, plan.ToString()); Reject(() => UiAuthoring.Preview(path)); Check(Hash("Assets/Panel.prefab") == after, "Invalid plan mutated file");
            plan["operations"][0]["set"] = new JObject { ["sizeDelta"] = new JArray(42, 42) };
            GameObject loaded = PrefabUtility.LoadPrefabContents("Assets/Panel.prefab"); loaded.AddComponent<HorizontalLayoutGroup>(); PrefabUtility.SaveAsPrefabAsset(loaded,"Assets/Panel.prefab"); PrefabUtility.UnloadPrefabContents(loaded);
            plan["operations"][0]["prefabSha256"] = Hash("Assets/Panel.prefab"); File.WriteAllText(path,plan.ToString()); Reject(() => UiAuthoring.Preview(path));
            // Asset-only plans use the same guarded transaction and Editor importer path.
            var texture = new Texture2D(8, 8); byte[] png = texture.EncodeToPNG(); UnityEngine.Object.DestroyImmediate(texture);
            string source = Path.GetFullPath("source.png"); File.WriteAllBytes(source, png);
            var assetPlan = new JObject { ["schemaVersion"] = 1, ["projectRoot"] = Directory.GetCurrentDirectory(), ["operations"] = new JArray(), ["assets"] = new JArray(new JObject { ["id"] = "sprite", ["source"] = source, ["sha256"] = Hash(source), ["destination"] = "Assets/Imported.png", ["pixelsPerUnit"] = 100, ["pivot"] = new JArray(0.25, 0.75), ["border"] = new JArray(1, 2, 3, 4) }) };
            File.WriteAllText(path, assetPlan.ToString()); UiAuthoring.Preview(path); UiAuthoring.Apply(path, Hash(path));
            var importer = (TextureImporter)AssetImporter.GetAtPath("Assets/Imported.png");
            Check(importer.spritePixelsPerUnit == 100 && importer.spriteBorder == new Vector4(1,2,3,4) && importer.spritePivot == new Vector2(0.25f,0.75f), "Sprite metadata mismatch");
            Check(AssetDatabase.LoadAssetAtPath<Sprite>("Assets/Imported.png") != null, "Sprite not imported");
            Check(importer.textureCompression == TextureImporterCompression.Uncompressed && !importer.mipmapEnabled && importer.wrapMode == TextureWrapMode.Clamp && importer.filterMode == FilterMode.Bilinear, "UI texture sampling settings mismatch");
            Check(Hash(source) == Hash("Assets/Imported.png"), "Source PNG bytes changed");
            Reject(() => UiAuthoring.Apply(path, Hash(path)));
            var outer = new GameObject("Outer", typeof(RectTransform));
            var nested = (GameObject)PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Panel.prefab"));
            nested.transform.SetParent(outer.transform, false);
            PrefabUtility.SaveAsPrefabAsset(outer, "Assets/Outer.prefab"); UnityEngine.Object.DestroyImmediate(outer);
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            string nestedBefore = Hash("Assets/Outer.prefab");
            var nestedNode = (JObject)JObject.Parse(UiAuthoring.Inspect("Assets/Outer.prefab"))["nodes"][1];
            var nestedPlan = new JObject { ["schemaVersion"] = 1, ["projectRoot"] = Directory.GetCurrentDirectory(), ["assets"] = new JArray(), ["operations"] = new JArray(new JObject { ["id"] = "nested", ["prefab"] = "Assets/Outer.prefab", ["prefabSha256"] = nestedBefore, ["target"] = "Panel", ["expected"] = nestedNode["layout"].DeepClone(), ["set"] = new JObject { ["sizeDelta"] = new JArray(12, 12) } }) };
            File.WriteAllText(path, nestedPlan.ToString()); Reject(() => UiAuthoring.Apply(path, Hash(path)));
            Check(Hash("Assets/Outer.prefab") == nestedBefore, "Nested rejection changed bytes");
            var custom = new GameObject("Custom", typeof(RectTransform), typeof(CanvasGroup));
            PrefabUtility.SaveAsPrefabAsset(custom, "Assets/Custom.prefab"); UnityEngine.Object.DestroyImmediate(custom);
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            string customBefore = Hash("Assets/Custom.prefab");
            var customNode = (JObject)JObject.Parse(UiAuthoring.Inspect("Assets/Custom.prefab"))["nodes"][0];
            Check(customNode["componentTypes"].ToString().Contains("UnityEngine.CanvasGroup"), "Custom component type missing in inspection");
            var customPlan = new JObject { ["schemaVersion"] = 1, ["projectRoot"] = Directory.GetCurrentDirectory(), ["controllerTypes"] = new JArray("UnityEngine.CanvasGroup"), ["assets"] = new JArray(), ["operations"] = new JArray(new JObject { ["id"] = "custom", ["prefab"] = "Assets/Custom.prefab", ["prefabSha256"] = customBefore, ["target"] = "", ["expected"] = customNode["layout"].DeepClone(), ["set"] = new JObject { ["sizeDelta"] = new JArray(12, 12) } }) };
            File.WriteAllText(path, customPlan.ToString()); Reject(() => UiAuthoring.Apply(path, Hash(path)));
            Check(Hash("Assets/Custom.prefab") == customBefore, "Declared controller rejection changed bytes");
            File.WriteAllText("ui-authoring-result.json", "{\"passed\":true,\"checks\":[\"layout-update\",\"reference-preservation\",\"guid-preservation\",\"stale-plan\",\"invalid-vector-no-write\",\"layout-controller-rejection\",\"sprite-import-metadata\",\"asset-overwrite-rejection\",\"uncompressed-ui-sampling\",\"original-png-bytes\",\"nested-prefab-no-write\",\"custom-controller-no-write\",\"component-type-inspection\"]}");
            EditorApplication.Exit(0);
        } catch(Exception error) { File.WriteAllText("ui-authoring-result.json", new JObject { ["passed"] = false, ["error"] = error.ToString() }.ToString()); EditorApplication.Exit(1); }
    }
}
