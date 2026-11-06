using System;
using System.IO;
using UnityEditor;
using Helix.Comparison;
using Newtonsoft.Json.Linq;
using UnityEngine;

public static class SceneSmoke
{
    public static void RunAssertions()
    {
        var root = new GameObject("SceneInventory");
        var child = new GameObject("Same");
        child.transform.SetParent(root.transform, false);
        var second = new GameObject("Same");
        second.transform.SetParent(root.transform, false);
        second.SetActive(false);
        JObject snapshot = SceneSnapshot.Capture(root, null, 100, 200, new JObject { ["view"] = "test" }, "settled");
        var nodes = (JArray)snapshot["nodes"];
        Check(nodes.Count == 3, "Inventory must include inactive children");
        Check(nodes[1].Value<string>("parentId") == "unity", "Missing parent");
        Check(nodes[1].Value<string>("id") != nodes[2].Value<string>("id"), "Duplicate names must have distinct ids");
        Check(!nodes[2].Value<bool>("visible"), "Inactive object became visible");
        Check(child.transform.localPosition == Vector3.zero && !second.activeSelf, "Probe mutated hierarchy");
        var cameraObject = new GameObject("Camera");
        Camera camera = cameraObject.AddComponent<Camera>();
        camera.transform.position = new Vector3(0, 0, -5);
        camera.orthographic = true; camera.orthographicSize = 2;
        var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
        cube.transform.SetParent(root.transform, false);
        var surface = new JObject { ["x"] = 10, ["y"] = 20, ["width"] = 100, ["height"] = 200, ["axisAligned"] = true };
        snapshot = SceneSnapshot.Capture(root, camera, 120, 240, new JObject(), "test", null, surface);
        nodes = (JArray)snapshot["nodes"];
        JObject box = (JObject)nodes[3]["bounds"];
        Check(box != null && Math.Abs(box.Value<float>("height") - 50) < 0.01f, "Orthographic projected bounds wrong");
        Check(Math.Abs(box.Value<float>("y") - 95) < 0.01f, "Top-left surface offset wrong");
        Check(((JArray)snapshot["cameras"]).Count == 1, "Camera omitted");
        File.WriteAllText(Path.Combine(Application.dataPath, "../scene-smoke.json"), snapshot.ToString());
        Check(camera.orthographic && camera.orthographicSize == 2, "Camera mutated");
        Check(((JArray)nodes[3]["raw"]["materials"]).Count == 1, "Material observations missing");
        Material originalMaterial = cube.GetComponent<Renderer>().sharedMaterial;
        SceneSnapshot.Capture(root, camera, 120, 240, new JObject(), "test", null, surface);
        Check(cube.GetComponent<Renderer>().sharedMaterial == originalMaterial, "Probe instantiated or replaced shared material");
        var block = new MaterialPropertyBlock();
        block.SetColor("_Color", Color.red);
        cube.GetComponent<Renderer>().SetPropertyBlock(block);
        snapshot = SceneSnapshot.Capture(root, camera, 120, 240, new JObject(), "test", null, surface);
        Check(snapshot["nodes"][3]["raw"]["materials"][0]["properties"]["_Color"][0].Value<float>() == 1 && snapshot["nodes"][3]["raw"]["materials"][0]["properties"]["_Color"][1].Value<float>() == 0, "Renderer override color missing");
        Check(snapshot["nodes"][3]["raw"]["materials"][0]["propertySources"].Value<string>("_Color") == "renderer-property-block", "Override source missing");
        var indexed = new MaterialPropertyBlock(); indexed.SetFloat("_Glossiness", 0.25f);
        cube.GetComponent<Renderer>().SetPropertyBlock(indexed, 0);
        snapshot = SceneSnapshot.Capture(root, camera, 120, 240, new JObject(), "test", null, surface);
        Check(snapshot["nodes"][3]["raw"]["materials"][0]["propertySources"].Value<string>("_Color") == "material", "Indexed block incorrectly merged with renderer block");
        Check(snapshot["nodes"][3]["raw"]["materials"][0]["properties"].Value<float>("_Glossiness") == 0.25f, "Indexed override missing");
        cube.transform.localScale = new Vector3(4, 0.2f, 0.2f);
        cube.transform.rotation = Quaternion.Euler(0, 30, 40);
        camera.transform.position = new Vector3(3, 2, -5); camera.transform.LookAt(Vector3.zero);
        snapshot = SceneSnapshot.Capture(root, camera, 120, 240, new JObject(), "test", null, surface);
        Check(snapshot["nodes"][3].Value<string>("boundsKind") == "projected-local-aabb-3d", "Local box method missing");
        Bounds local = cube.GetComponent<MeshFilter>().sharedMesh.bounds;
        float top = float.PositiveInfinity, bottom = float.NegativeInfinity;
        for (int i = 0; i < 8; i++) {
            Vector3 point = new Vector3((i & 1) == 0 ? local.min.x : local.max.x, (i & 2) == 0 ? local.min.y : local.max.y, (i & 4) == 0 ? local.min.z : local.max.z);
            Vector3 projected = camera.WorldToViewportPoint(cube.transform.TransformPoint(point));
            float y = 20 + (1 - projected.y) * 200; top = Mathf.Min(top, y); bottom = Mathf.Max(bottom, y);
        }
        Check(Math.Abs(snapshot["nodes"][3]["bounds"].Value<float>("height") - (bottom - top)) < 0.01f, "Rotated local box disagrees with native camera projection");
        File.WriteAllText(Path.Combine(Application.dataPath, "../scene-rotated.json"), snapshot.ToString());
        var selected = new System.Collections.Generic.Dictionary<Transform, string> { [cube.transform] = "cube" };
        var options = new JObject { ["profile"] = "geometry", ["semanticIds"] = new JArray("cube") };
        snapshot = SceneSnapshot.Capture(root, camera, 120, 240, new JObject(), "test", selected, surface, options);
        Check(((JArray)snapshot["nodes"]).Count == 2 && snapshot["nodes"][1]["raw"]["materials"].Type == JTokenType.Null, "Scope/profile retained unrelated material nodes");
        cube.transform.localScale = Vector3.one;
        camera.transform.position = new Vector3(0, 0, -5); camera.transform.rotation = Quaternion.identity;
        cube.transform.position = camera.transform.position;
        snapshot = SceneSnapshot.Capture(root, camera, 120, 240, new JObject(), "test", null, surface);
        Check(snapshot["nodes"][3]["bounds"].Type == JTokenType.Null, "Near-plane crossing must be unmeasured");
        UnityEngine.Object.DestroyImmediate(cameraObject);
        UnityEngine.Object.DestroyImmediate(root);
    }
    public static void RunSampling(Action success)
    {
        var root = new GameObject("SamplerRoot");
        double eventStart = Time.realtimeSinceStartupAsDouble;
        string output = Path.GetFullPath(Path.Combine(Application.dataPath, "../.helix/sampling"));
        SceneSampling.Start(() =>
        {
            JObject snapshot = SceneSnapshot.Capture(root, null, 100, 100, new JObject(), "test");
            snapshot["timeline"] = new JObject { ["event"] = "test", ["elapsedMs"] = (Time.realtimeSinceStartupAsDouble - eventStart) * 1000 };
            return snapshot;
        }, output, 0.1, 16);
        EditorApplication.CallbackFunction poll = null;
        poll = () =>
        {
            if (SceneSampling.Status().Value<bool>("active")) { return; }
            EditorApplication.update -= poll;
            try
            {
                JObject sequence = JObject.Parse(File.ReadAllText(Path.Combine(output, "sequence.json")));
                Check(sequence.Value<bool>("complete") && ((JArray)sequence["samples"]).Count >= 2, "Sampling did not retain complete sequence");
                SceneSampling.Start(() => { throw new InvalidOperationException("synthetic probe error"); }, output + "-failure", 0.1, 16);
                EditorApplication.CallbackFunction failurePoll = null;
                failurePoll = () =>
                {
                    if (SceneSampling.Status().Value<bool>("active")) { return; }
                    EditorApplication.update -= failurePoll;
                    try
                    {
                        JObject failed = JObject.Parse(File.ReadAllText(Path.Combine(output + "-failure", "sequence.json")));
                        Check(!failed.Value<bool>("complete") && failed.Value<string>("error").Contains("synthetic probe error"), "Failure receipt missing");
                        UnityEngine.Object.DestroyImmediate(root);
                        success();
                    }
                    catch (Exception error) { Fail(error); }
                };
                EditorApplication.update += failurePoll;
            }
            catch (Exception error) { Fail(error); }
        };
        EditorApplication.update += poll;
    }

    private static void Fail(Exception error)
    {
        File.WriteAllText(Path.Combine(Application.dataPath, "../smoke-result.json"), new JObject { ["passed"] = false, ["error"] = error.ToString() }.ToString());
        EditorApplication.Exit(1);
    }

    private static void Check(bool condition, string message)
    {
        if (!condition) { throw new InvalidOperationException(message); }
    }
}
