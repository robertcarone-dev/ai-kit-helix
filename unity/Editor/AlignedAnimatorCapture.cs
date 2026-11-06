using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Helix.Comparison
{
    // Opt-in replay of the prefab Animator's default entry. Never edits the prefab.
    [InitializeOnLoad]
    public static class AlignedAnimatorCapture
    {
        private const string SessionKey = "Helix.AlignedAnimatorCapture";

        static AlignedAnimatorCapture()
        {
            EditorApplication.playModeStateChanged += Capture;
        }

        public static void Start()
        {
            if (!Application.isBatchMode) {
                throw new InvalidOperationException("Use an isolated batch Editor.");
            }
            string plan = Environment.GetEnvironmentVariable("HELIX_ANIMATOR_PLAN");
            if (!File.Exists(plan)) {
                throw new ArgumentException("Missing alignment plan.");
            }
            SessionState.SetString(SessionKey, plan);
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            EditorApplication.EnterPlaymode();
        }

        private static void Capture(PlayModeStateChange state)
        {
            string path = SessionState.GetString(SessionKey, "");
            if (state != PlayModeStateChange.EnteredPlayMode || path.Length == 0) {
                return;
            }
            SessionState.EraseString(SessionKey);
            try {
                var plan = JObject.Parse(File.ReadAllText(path));
                var binding = plan["unity"];
                if ((string)binding["event"] != "prefab-animator-start") {
                    throw new ArgumentException("Unsupported Unity anchor.");
                }
                string prefab = (string)binding["prefab"];
                UiAuthoring.AssetPath(prefab, ".prefab");
                var root = (GameObject)PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>(prefab));
                var animator = root.GetComponent<Animator>();
                if (!animator || !animator.isActiveAndEnabled || !animator.runtimeAnimatorController) {
                    throw new ArgumentException("The aligned prefab requires an active root Animator controller.");
                }
                VisualOwnership.Begin(root, prefab, (string)binding["target"], (string)binding["component"], (string)binding["field"]);
                animator.Update(0f);
                var times = new SortedSet<double>();
                foreach (var pick in plan["picks"].Where(p => (string)p["status"] == "ready")) {
                    double start = (double)pick["offsetMs"];
                    double end = (double)pick["latestOffsetMs"];
                    for (double t = start; t < end; t += 1000.0 / 120) {
                        times.Add(t);
                    }
                    times.Add(end);
                }
                double elapsed = 0;
                foreach (double time in times) {
                    while (elapsed < time) {
                        double next = Math.Min(time, elapsed + 1000.0 / 120);
                        animator.Update((float)((next - elapsed) / 1000));
                        elapsed = next;
                    }
                    VisualOwnership.Checkpoint(time.ToString("R", System.Globalization.CultureInfo.InvariantCulture));
                }
                var receipt = JObject.Parse(VisualOwnership.End());
                receipt["planSha256"] = UiAuthoring.Hash(path);
                File.WriteAllText(Path.Combine(Path.GetDirectoryName(path), "receipt.json"), receipt.ToString());
                EditorApplication.Exit(0);
            }
            catch (Exception ex) {
                Debug.LogException(ex);
                EditorApplication.Exit(2);
            }
        }
    }
}
