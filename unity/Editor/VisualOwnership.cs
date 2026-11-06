using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.Animations;
using UnityEngine.Playables;
using Object = UnityEngine.Object;

namespace Helix.Comparison
{
    // An explicitly bound, read-only observation window. No global searches or update loop.
    public static class VisualOwnership
    {
        private static readonly OwnershipObservation Default = new OwnershipObservation();
        public static string Inspect(string prefab, string target, string component, string field) => Default.Inspect(prefab, target, component, field);
        public static string Begin(GameObject instance, string prefab, string target, string component, string field) => Default.Begin(instance, prefab, target, component, field);
        public static void Checkpoint(string label) => Default.Checkpoint(label);
        public static string End() => Default.End();
        public static void Applied(Component target, string field) => Default.Applied(target, field);
    }

    internal sealed class OwnershipObservation
    {
        private const int Limit = 256;
        private Component watched;
        private string fieldPath;
        private GameObject liveRoot;
        private JObject receipt;
        private readonly List<Action> releases = new List<Action>();
        private MethodInfo setter;
        private JToken lastValue;

        private static JObject Asset(Object value)
        {
            if (!value) return null;
            var result = new JObject { ["name"] = value.name, ["type"] = value.GetType().FullName };
            if (EditorUtility.IsPersistent(value) && AssetDatabase.TryGetGUIDAndLocalFileIdentifier(value, out string guid, out long fileId)) {
                result["path"] = AssetDatabase.GetAssetPath(value);
                result["guid"] = guid;
                result["fileId"] = fileId.ToString(System.Globalization.CultureInfo.InvariantCulture);
            } else result["instanceId"] = value.GetInstanceID();
            return result;
        }

        private static JToken Value(SerializedProperty property)
        {
            switch (property.propertyType) {
                case SerializedPropertyType.ObjectReference: return (JToken)Asset(property.objectReferenceValue) ?? JValue.CreateNull();
                case SerializedPropertyType.Float: return property.doubleValue;
                case SerializedPropertyType.Integer: return property.longValue;
                case SerializedPropertyType.Enum: return property.intValue;
                case SerializedPropertyType.Boolean: return property.boolValue;
                case SerializedPropertyType.String: return property.stringValue;
                case SerializedPropertyType.Color:
                    Color c = property.colorValue;
                    return new JArray(c.r, c.g, c.b, c.a);
                default: throw new ArgumentException("Unsupported serialized type. Select a scalar channel or asset reference: " + property.propertyPath);
            }
        }

        private static SerializedProperty Property(Component component, string field)
        {
            return new SerializedObject(component).FindProperty(field) ?? throw new ArgumentException("Missing serialized property: " + field);
        }

        private static void Pin(JObject hashes, string path)
        {
            if (!string.IsNullOrEmpty(path) && path.StartsWith("Assets/", StringComparison.Ordinal) && hashes[path] == null)
                hashes[path] = UiAuthoring.Hash(path);
        }

        internal void IncludeInput(Object asset)
        {
            string path = AssetDatabase.GetAssetPath(asset);
            if (!path.StartsWith("Assets/", StringComparison.Ordinal)) throw new ArgumentException("Expected a project asset input.");
            Pin((JObject)receipt["assetHashes"], path);
        }

        private static JObject InspectData(string prefab, string target, string type, string field)
        {
            UiAuthoring.AssetPath(prefab, ".prefab");
            GameObject root = AssetDatabase.LoadAssetAtPath<GameObject>(prefab);
            if (!root) throw new ArgumentException("Prefab unavailable: " + prefab);
            Component component = UiAuthoring.VisualComponent(UiAuthoring.TargetTransform(root, target), type);
            var hashes = new JObject();
            var chain = new JArray();
            Component owner = component;
            while (true) {
                var property = Property(owner, field);
                string asset = AssetDatabase.GetAssetPath(owner);
                Pin(hashes, asset);
                chain.Add(new JObject { ["prefab"] = asset, ["target"] = AnimationUtility.CalculateTransformPath(owner.transform, AssetDatabase.LoadAssetAtPath<GameObject>(asset).transform),
                    ["overridden"] = property.prefabOverride, ["value"] = Value(property) });
                var source = PrefabUtility.GetCorrespondingObjectFromSource(owner);
                if (!source || property.prefabOverride) break;
                owner = source;
            }
            var consumers = new JArray();
            foreach (MonoBehaviour behaviour in root.GetComponentsInChildren<MonoBehaviour>(true)) {
                if (!behaviour) continue;
                var script = MonoScript.FromMonoBehaviour(behaviour);
                var iterator = new SerializedObject(behaviour).GetIterator();
                while (iterator.Next(true)) {
                    if (iterator.propertyType != SerializedPropertyType.ObjectReference || iterator.objectReferenceValue != component) continue;
                    string path = AssetDatabase.GetAssetPath(script);
                    Pin(hashes, path);
                    consumers.Add(new JObject { ["type"] = behaviour.GetType().FullName, ["field"] = iterator.propertyPath, ["script"] = path });
                }
            }
            return new JObject { ["schemaVersion"] = 1, ["prefab"] = prefab, ["target"] = target, ["component"] = type, ["field"] = field,
                ["serializedOwner"] = AssetDatabase.GetAssetPath(owner), ["sourceChain"] = chain, ["referencesToTarget"] = consumers,
                ["clipBindings"] = Clips(component, field, false, hashes), ["assetHashes"] = hashes };
        }

        public string Inspect(string prefab, string target, string component, string field)
        {
            return InspectData(prefab, target, component, field).ToString();
        }

        private static JArray Clips(Component component, string field, bool playing, JObject hashes)
        {
            var found = new JArray();
            foreach (Animator animator in component.GetComponentsInParent<Animator>(true)) {
                var controller = animator.runtimeAnimatorController;
                if (!controller) continue;
                Pin(hashes, AssetDatabase.GetAssetPath(controller));
                string target = AnimationUtility.CalculateTransformPath(component.transform, animator.transform);
                void InspectClip(AnimationClip clip, int layer, string phase, float weight)
                {
                    if (!clip) return;
                    var bindings = AnimationUtility.GetCurveBindings(clip).Concat(AnimationUtility.GetObjectReferenceCurveBindings(clip));
                    foreach (var b in bindings) {
                        if (b.path != target || !b.type.IsAssignableFrom(component.GetType()) ||
                            (b.propertyName != field && !b.propertyName.StartsWith(field + ".", StringComparison.Ordinal))) continue;
                        Pin(hashes, AssetDatabase.GetAssetPath(clip));
                        var entry = new JObject { ["controller"] = Asset(controller), ["clip"] = Asset(clip), ["field"] = b.propertyName,
                            ["bindingPath"] = target, ["animatorInstanceId"] = animator.GetInstanceID(), ["phase"] = phase };
                        if (playing) { entry["layer"] = layer; entry["layerWeight"] = layer == 0 ? 1f : animator.GetLayerWeight(layer); entry["clipWeight"] = weight; }
                        found.Add(entry);
                    }
                }
                if (!playing) {
                    foreach (var clip in controller.animationClips.Distinct()) InspectClip(clip, -1, "configured", 0);
                } else if (animator.isActiveAndEnabled && animator.isInitialized) {
                    for (int layer = 0; layer < animator.layerCount; layer++) {
                        foreach (var current in animator.GetCurrentAnimatorClipInfo(layer)) InspectClip(current.clip, layer, "current", current.weight);
                        if (animator.IsInTransition(layer))
                            foreach (var next in animator.GetNextAnimatorClipInfo(layer)) InspectClip(next.clip, layer, "next", next.weight);
                    }
                }
            }
            return found;
        }

        // Supply the actual instance through the adapter, before the action being investigated.
        public string Begin(GameObject instance, string prefab, string target, string component, string field)
        {
            if (receipt != null) throw new InvalidOperationException("End the active ownership trace first.");
            if (!EditorApplication.isPlaying || !instance || !instance.scene.IsValid()) throw new ArgumentException("Requires a live Play Mode instance.");
            var data = InspectData(prefab, target, component, field);
            var live = UiAuthoring.VisualComponent(UiAuthoring.TargetTransform(instance, target), component);
            var linked = PrefabUtility.GetCorrespondingObjectFromSourceAtPath(instance, prefab);
            if (PrefabUtility.IsPartOfPrefabInstance(instance) && linked != AssetDatabase.LoadAssetAtPath<GameObject>(prefab))
                throw new ArgumentException("Live instance is linked to a different prefab.");
            lastValue = Value(Property(live, field));
            watched = live;
            liveRoot = instance;
            fieldPath = field;
            receipt = data;
            try {
                receipt["bindingMethod"] = linked ? "unity-prefab-link" : "explicit-adapter-instance";
                receipt["instanceId"] = live.GetInstanceID();
                receipt["events"] = new JArray();
                receipt["omittedEvents"] = 0;
                AssemblyReloadEvents.beforeAssemblyReload += Release;
                EditorApplication.playModeStateChanged += PlayModeChanged;
                // Only mapped managed setters permit stack attribution. Other fields use checkpoints or an explicit write-site hook.
                var keys = new Dictionary<string, string> { { "UnityEngine.UI.Image/m_Sprite", "sprite" }, { "UnityEngine.UI.Graphic/m_Color", "color" },
                    { "UnityEngine.UI.Graphic/m_Material", "material" }, { "TMPro.TMP_Text/m_text", "text" },
                    { "TMPro.TMP_Text/m_fontAsset", "font" }, { "TMPro.TMP_Text/m_fontSize", "fontSize" } };
                for (Type t = live.GetType(); t != null && setter == null; t = t.BaseType)
                    if (keys.TryGetValue(t.FullName + "/" + field, out string name)) setter = t.GetProperty(name).GetSetMethod();
                if (setter != null) {
                    UnityAction callback = OnDirty;
                    foreach (string channel in new[] { "Vertices", "Material" }) {
                        MethodInfo add = live.GetType().GetMethod("RegisterDirty" + channel + "Callback", new[] { typeof(UnityAction) });
                        MethodInfo remove = live.GetType().GetMethod("UnregisterDirty" + channel + "Callback", new[] { typeof(UnityAction) });
                        if (add == null || remove == null) continue;
                        add.Invoke(live, new object[] { callback });
                        releases.Add(() => remove.Invoke(live, new object[] { callback }));
                    }
                }
                receipt["setter"] = setter == null ? null : setter.DeclaringType.FullName + "." + setter.Name;
                Checkpoint("begin");
                return receipt.ToString();
            } catch { Release(); throw; }
        }

        private static JObject Event(string kind)
        {
            return new JObject { ["kind"] = kind, ["frame"] = Time.frameCount, ["realtime"] = Time.realtimeSinceStartupAsDouble };
        }

        private void Append(JObject e)
        {
            var events = (JArray)receipt["events"];
            if (events.Count < Limit) events.Add(e);
            else receipt["omittedEvents"] = (int)receipt["omittedEvents"] + 1;
        }

        private void OnDirty()
        {
            if (!watched) return;
            var frames = new StackTrace(true).GetFrames();
            int at = Array.FindIndex(frames, f => f.GetMethod() == setter || (f.GetMethod() is MethodInfo m && m.GetBaseDefinition() == setter.GetBaseDefinition()));
            if (at >= 0) Write("setter-stack", frames.Skip(at));
        }

        // Call directly after a known assignment when the engine exposes no synchronous setter notification.
        public void Applied(Component target, string field)
        {
            if (receipt != null && watched && target == watched && field == fieldPath)
                Write("instrumented-write-site", new StackTrace(1, true).GetFrames());
        }

        private void Write(string kind, IEnumerable<StackFrame> frames)
        {
            var value = Value(Property(watched, fieldPath));
            if (JToken.DeepEquals(value, lastValue)) return;
            if (value is JObject asset) Pin((JObject)receipt["assetHashes"], (string)asset["path"]);
            var stack = new JArray();
            foreach (var frame in frames.Take(24)) {
                var method = frame.GetMethod();
                var item = new JObject { ["method"] = method.DeclaringType?.FullName + "." + method.Name };
                string file = frame.GetFileName();
                if (!string.IsNullOrEmpty(file)) {
                    var full = Path.GetFullPath(file);
                    var assets = Path.GetFullPath(Application.dataPath) + Path.DirectorySeparatorChar;
                    if (full.StartsWith(assets, StringComparison.Ordinal)) {
                        var path = "Assets/" + full.Substring(assets.Length);
                        if (File.Exists(path)) { Pin((JObject)receipt["assetHashes"], path); item["source"] = path; item["line"] = frame.GetFileLineNumber(); }
                    }
                }
                stack.Add(item);
            }
            var e = Event(kind);
            e["previousObservation"] = lastValue.DeepClone(); e["value"] = value; e["stack"] = stack;
            Append(e);
            lastValue = value;
        }

        // Inspect only ordinary clip/mixer outputs connected to the watched hierarchy.
        // Other playable types can alter masks or evaluation and are marked unresolved.
        private void GraphBindings(PlayableGraph graph, JArray bindings)
        {
            for (int i = 0; i < graph.GetOutputCount(); i++) {
                var output = graph.GetOutput(i);
                if (!output.IsOutputValid() || output.GetPlayableOutputType() != typeof(AnimationPlayableOutput)) continue;
                var animator = ((AnimationPlayableOutput)output).GetTarget();
                if (!animator || !animator.isActiveAndEnabled || !watched.transform.IsChildOf(animator.transform)) continue;
                string target = AnimationUtility.CalculateTransformPath(watched.transform, animator.transform);
                void Visit(Playable node, float weight)
                {
                    if (!node.IsValid() || weight <= 0) return;
                    if (node.IsPlayableOfType<AnimationClipPlayable>()) {
                        var clip = ((AnimationClipPlayable)node).GetAnimationClip();
                        foreach (var b in AnimationUtility.GetCurveBindings(clip).Concat(AnimationUtility.GetObjectReferenceCurveBindings(clip))) {
                            if (b.path != target || !b.type.IsAssignableFrom(watched.GetType()) || b.propertyName != fieldPath) continue;
                            Pin((JObject)receipt["assetHashes"], AssetDatabase.GetAssetPath(clip));
                            bindings.Add(new JObject { ["clip"] = Asset(clip), ["field"] = fieldPath, ["bindingPath"] = target,
                                ["phase"] = "current", ["driver"] = "animation-playable", ["clipTime"] = node.GetTime(),
                                ["clipWeight"] = weight, ["layerWeight"] = 1f });
                        }
                    } else if (node.IsPlayableOfType<AnimationMixerPlayable>()) {
                        for (int port = 0; port < node.GetInputCount(); port++) Visit(node.GetInput(port), weight * node.GetInputWeight(port));
                    } else receipt["unsupportedPlayable"] = true;
                }
                Visit(output.GetSourcePlayable(), output.GetWeight());
            }
        }

        public void Checkpoint(string label, PlayableGraph graph = default)
        {
            if (receipt == null || !watched || !liveRoot) throw new InvalidOperationException("No live ownership target.");
            if (string.IsNullOrWhiteSpace(label)) throw new ArgumentException("Name the checkpoint.");
            var e = Event("checkpoint");
            lastValue = Value(Property(watched, fieldPath));
            e["label"] = label; e["value"] = lastValue;
            e["activeBindings"] = Clips(watched, fieldPath, true, (JObject)receipt["assetHashes"]);
            if (graph.IsValid()) GraphBindings(graph, (JArray)e["activeBindings"]);
            Append(e);
        }

        public string End()
        {
            if (receipt == null) throw new InvalidOperationException("No active ownership trace.");
            try {
                if (watched && liveRoot) Checkpoint("end"); else Append(Event("target-destroyed"));
                return receipt.ToString();
            } finally { Release(); }
        }

        private void PlayModeChanged(PlayModeStateChange state)
        {
            if (state == PlayModeStateChange.ExitingPlayMode) Release();
        }

        internal void Release()
        {
            if (watched) foreach (var release in releases) release();
            releases.Clear();
            AssemblyReloadEvents.beforeAssemblyReload -= Release;
            EditorApplication.playModeStateChanged -= PlayModeChanged;
            watched = null; liveRoot = null; setter = null; receipt = null; lastValue = null; fieldPath = null;
        }
    }
}
