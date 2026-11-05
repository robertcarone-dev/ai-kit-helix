using System;
using System.IO;
using Helix.Comparison;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public class SyntheticComparisonAdapter : ComparisonAdapter
{
    public static bool Prepared;
    public static bool FailPrepare;
    public static bool FailRestore;
    public static bool WrongSize;
    public static bool WrongSafeArea;
    public static bool Isolated = true;
    public override JObject Preflight(ComparisonContext c) => new JObject { ["storageIsolated"] = Isolated, ["compatible"] = true, ["projectRoot"] = c.ProjectRoot };
    public override JObject SaveState(ComparisonContext c) => new JObject { ["synthetic"] = true };
    public override void Prepare(ComparisonContext c) { Prepared = true; if (FailPrepare) throw new InvalidOperationException("synthetic prepare failure"); }
    public override bool IsReady(ComparisonContext c) => Prepared;
    public override void SelectView(ComparisonContext c, string name) { }
    public override ComparisonFrame Capture(ComparisonContext c)
    {
        var image = new Texture2D(WrongSize ? 1 : c.Width, c.Height, TextureFormat.RGB24, false);
        image.Apply();
        return new ComparisonFrame { Image = image, Source = "synthetic in-memory test image; not rendered game evidence", Ui = new JObject {
            ["schemaVersion"] = 1, ["coordinateSpace"] = "native-top-left-pixels",
            ["viewport"] = new JObject { ["width"] = c.Width, ["height"] = c.Height, ["dpr"] = 1, ["zoom"] = 1 },
            ["safeArea"] = new JObject { ["x"] = WrongSafeArea ? -1 : 0, ["y"] = 0, ["width"] = c.Width, ["height"] = c.Height },
            ["state"] = new JObject { ["fixture"] = "synthetic" }, ["nodes"] = new JArray()
        } };
    }
    public override void Restore(ComparisonContext c) { if (FailRestore) throw new InvalidOperationException("synthetic restore failure"); Prepared = false; }
    public override bool VerifyRestored(ComparisonContext c) => !Prepared;
}

public static class ComparisonSmoke
{
    public static void Run()
    {
        try {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            SceneSmoke.RunAssertions();
            string root = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            string output = Path.Combine(root, ".aikit/scratch/success");
            string type = typeof(SyntheticComparisonAdapter).AssemblyQualifiedName;
            SyntheticComparisonAdapter.Isolated = false;
            Reject(() => ComparisonSession.Begin(type, "test", output, 2, 2));
            Check(!Directory.Exists(output), "Preflight failure created evidence");
            SyntheticComparisonAdapter.Isolated = true;
            ComparisonSession.Begin(type, "test", output, 2, 2);
            Reject(() => ComparisonSession.Begin(type, "other", output + "2", 2, 2));
            Reject(() => ComparisonSession.Prepare(output + "2"));
            Reject(() => ComparisonSession.Capture(output));
            ComparisonSession.Prepare(output);
            Check(ComparisonSession.Ready(output), "Ready failed");
            SyntheticComparisonAdapter.WrongSize = true;
            Reject(() => ComparisonSession.Capture(output));
            Check(!File.Exists(Path.Combine(output, "unity.png")), "Wrong dimensions wrote image");
            SyntheticComparisonAdapter.WrongSize = false;
            SyntheticComparisonAdapter.WrongSafeArea = true;
            Reject(() => ComparisonSession.Capture(output));
            SyntheticComparisonAdapter.WrongSafeArea = false;
            JObject receipt = JObject.Parse(ComparisonSession.Capture(output));
            Check(receipt.Value<string>("sha256").Length == 64, "Missing image hash");
            Reject(() => ComparisonSession.Capture(output));
            SyntheticComparisonAdapter.FailRestore = true;
            Reject(() => ComparisonSession.Restore(output));
            Reject(() => ComparisonSession.Begin(type, "other", output + "2", 2, 2));
            SyntheticComparisonAdapter.FailRestore = false;
            ComparisonSession.Restore(output);
            ComparisonSession.Restore(output);
            Check(File.Exists(Path.Combine(output, "unity-restored.json")), "Missing restoration receipt");
            output = Path.Combine(root, ".aikit/scratch/failed-prepare");
            ComparisonSession.Begin(type, "test", output, 2, 2);
            SyntheticComparisonAdapter.FailPrepare = true;
            Reject(() => ComparisonSession.Prepare(output));
            Check(!ComparisonSession.Ready(output), "Failed prepare accepted as ready");
            Reject(() => ComparisonSession.Prepare(output));
            ComparisonSession.Restore(output);
            SceneSmoke.RunSampling(() => {
                File.WriteAllText(Path.Combine(root, "smoke-result.json"), "{\"passed\":true,\"scope\":\"synthetic Editor lifecycle, scene geometry, materials, event sampling and failure evidence; no game parity\"}");
                EditorApplication.Exit(0);
            });
        } catch (Exception error) {
            File.WriteAllText(Path.Combine(Application.dataPath, "../smoke-result.json"), new JObject { ["passed"] = false, ["error"] = error.ToString() }.ToString());
            EditorApplication.Exit(1);
        }
    }
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static void Reject(Action action)
    {
        try { action(); } catch (InvalidOperationException) { return; }
        throw new Exception("Expected rejection did not occur");
    }
}
