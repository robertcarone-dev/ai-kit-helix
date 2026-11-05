using System;
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
        Check(camera.orthographic && camera.orthographicSize == 2, "Camera mutated");
        cube.transform.position = camera.transform.position;
        snapshot = SceneSnapshot.Capture(root, camera, 120, 240, new JObject(), "test", null, surface);
        Check(snapshot["nodes"][3]["bounds"].Type == JTokenType.Null, "Near-plane crossing must be unmeasured");
        UnityEngine.Object.DestroyImmediate(cameraObject);
        UnityEngine.Object.DestroyImmediate(root);
    }
    private static void Check(bool condition, string message)
    {
        if (!condition) { throw new InvalidOperationException(message); }
    }
}
