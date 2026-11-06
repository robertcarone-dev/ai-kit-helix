using System;
using System.Globalization;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Playables;

namespace Helix.Comparison
{
    // A project recipe binds before configuration, signals at its presenter event and samples after evaluation.
    public sealed class PresenterOwnershipWindow
    {
        private readonly JObject plan;
        private readonly string path;
        private readonly OwnershipObservation[] traces;
        private readonly (double start, double end)[] ranges;
        private double? anchor;
        private int lastFrame = -1;

        public PresenterOwnershipWindow(string planPath, GameObject instance)
        {
            path = planPath;
            plan = JObject.Parse(File.ReadAllText(path));
            var unity = plan["unity"];
            if ((string)unity["event"] != "presenter-event") throw new ArgumentException("Expected presenter event.");
            var properties = (JArray)unity["properties"];
            traces = properties.Select(_ => new OwnershipObservation()).ToArray();
            try {
                for (int i = 0; i < traces.Length; i++) {
                    var binding = properties[i];
                    traces[i].Begin(instance, (string)unity["prefab"], (string)binding["target"], (string)binding["component"], (string)binding["field"]);
                }
            } catch {
                foreach (var trace in traces) trace.Release();
                throw;
            }
            ranges = plan["picks"].Where(p => (string)p["status"] == "ready")
                .Select(p => ((double)p["offsetMs"], (double)p["latestOffsetMs"])).OrderBy(r => r.Item2).ToArray();
        }

        public void IncludeInput(UnityEngine.Object asset)
        {
            foreach (var trace in traces) trace.IncludeInput(asset);
        }

        public void Signal(string eventId, PlayableGraph graph = default)
        {
            if (anchor.HasValue || eventId != (string)plan["event"]) throw new InvalidOperationException("Unexpected or repeated presenter event.");
            anchor = Time.timeAsDouble;
            Sample(graph);
        }

        public bool Sample(PlayableGraph graph = default)
        {
            if (!anchor.HasValue) return false;
            double elapsed = (Time.timeAsDouble - anchor.Value) * 1000;
            if (Time.frameCount != lastFrame && Array.Exists(ranges, r => elapsed >= r.start - 100 && elapsed <= r.end + 100)) {
                foreach (var trace in traces) trace.Checkpoint(elapsed.ToString("R", CultureInfo.InvariantCulture), graph);
                lastFrame = Time.frameCount;
            }
            return elapsed >= ranges[ranges.Length - 1].end;
        }

        public string Finish()
        {
            if (!anchor.HasValue) throw new InvalidOperationException("Presenter event was never observed.");
            var result = new JObject { ["event"] = plan["event"], ["planSha256"] = UiAuthoring.Hash(path),
                ["anchorGameTime"] = anchor.Value, ["properties"] = new JArray(traces.Select(t => JObject.Parse(t.End()))) };
            return result.ToString();
        }
    }
}
