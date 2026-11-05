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
        UnityEngine.Object.DestroyImmediate(root);
    }
    private static void Check(bool condition, string message)
    {
        if (!condition) { throw new InvalidOperationException(message); }
    }
}
