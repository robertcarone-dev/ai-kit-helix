using System;
using System.IO;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;

namespace Helix.Comparison
{
    // Project adapters supply a read-only probe, including their own observed timeline marker.
    public static class SceneSampling
    {
        private static Func<JObject> _capture;
        private static JArray _samples;
        private static string _output;
        private static double _started;
        private static double _next;
        private static double _duration;
        private static double _interval;
        private static string _error;
        private static bool _active;
        private static long _bytes;
        private static int _missed;

        public static void Start(Func<JObject> capture, string outputDirectory, double durationSeconds = 1, double intervalMs = 100)
        {
            if (_active) { throw new InvalidOperationException("A scene sampler is already active."); }
            if (capture == null) { throw new ArgumentNullException(nameof(capture)); }
            if (double.IsNaN(durationSeconds) || double.IsNaN(intervalMs) || durationSeconds <= 0 || durationSeconds > 30 || intervalMs < 16 || intervalMs > 5000 || Math.Ceiling(durationSeconds * 1000 / intervalMs) + 1 > 300) { throw new ArgumentException("Use duration >0..30 seconds, interval 16..5000ms, at most 300 samples."); }
            string root = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            string output = Path.GetFullPath(outputDirectory);
            if (!output.StartsWith(Path.Combine(root, ".helix") + Path.DirectorySeparatorChar, StringComparison.Ordinal) && !output.StartsWith(Path.Combine(root, ".aikit", "scratch") + Path.DirectorySeparatorChar, StringComparison.Ordinal)) { throw new ArgumentException("Use a project .helix or .aikit/scratch evidence directory."); }
            for (string path = output; path != root; path = Path.GetDirectoryName(path))
            {
                if (Directory.Exists(path) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) { throw new ArgumentException("Evidence parents must not be links."); }
            }
            if (Directory.Exists(output) && Directory.GetFileSystemEntries(output).Length != 0) { throw new InvalidOperationException("Evidence directory must be empty."); }
            Directory.CreateDirectory(output);
            _capture = capture; _samples = new JArray(); _output = output; _duration = durationSeconds; _interval = intervalMs / 1000;
            _started = EditorApplication.timeSinceStartup; _next = _started; _error = null; _bytes = 0; _missed = 0; _active = true;
            EditorApplication.update += Tick;
            AssemblyReloadEvents.beforeAssemblyReload += Interrupted;
            EditorApplication.quitting += Interrupted;
            Tick();
        }

        public static JObject Status()
        {
            return new JObject { ["active"] = _active, ["samples"] = _samples == null ? 0 : _samples.Count, ["output"] = _output, ["error"] = _error };
        }

        public static void Stop()
        {
            if (!_active) { throw new InvalidOperationException("No active sampler."); }
            Finish(false, "Stopped before scheduled completion");
        }

        private static void Tick()
        {
            double now = EditorApplication.timeSinceStartup;
            if (now < _next) { return; }
            try
            {
                JObject snapshot = _capture();
                if (snapshot == null || snapshot.Value<string>("kind") != "helix-scene") { throw new InvalidOperationException("Probe must return a scene snapshot."); }
                _bytes += System.Text.Encoding.UTF8.GetByteCount(snapshot.ToString());
                if (_bytes > 64000000) { throw new InvalidOperationException("Scene recording exceeds 64MB."); }
                _samples.Add(new JObject { ["sampledAtMs"] = (now - _started) * 1000, ["captureDurationMs"] = (EditorApplication.timeSinceStartup - now) * 1000, ["scheduledAtMs"] = (_next - _started) * 1000, ["snapshot"] = snapshot });
                if (now - _started >= _duration || _samples.Count >= 300) { Finish(true, null); }
                else {
                    _next += _interval;
                    while (_next < EditorApplication.timeSinceStartup) { _next += _interval; _missed++; }
                }
            }
            catch (Exception error)
            {
                if (_active) { Finish(false, error.Message); }
                else { _error = error.Message; }
            }
        }

        private static void Interrupted() { Finish(false, "Editor reload or shutdown interrupted sampling"); }

        private static void Finish(bool complete, string error)
        {
            _active = false; _error = error;
            EditorApplication.update -= Tick;
            AssemblyReloadEvents.beforeAssemblyReload -= Interrupted;
            EditorApplication.quitting -= Interrupted;
            _capture = null;
            var sequence = new JObject { ["schemaVersion"] = 1, ["kind"] = "helix-scene-sequence", ["complete"] = complete, ["samples"] = _samples, ["error"] = error, ["intervalMs"] = _interval * 1000, ["missedSamples"] = _missed,
                ["notes"] = new JArray("Observed Editor updates only. Project timeline markers, not sampledAtMs, align engines. No animation, camera or game state is changed by the sampler.") };
            using (var stream = new FileStream(Path.Combine(_output, "sequence.json"), FileMode.CreateNew, FileAccess.Write))
            using (var writer = new StreamWriter(stream)) { writer.Write(sequence.ToString()); }
        }
    }
}
