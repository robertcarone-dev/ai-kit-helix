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
        private readonly JObject _plan;
        private readonly string _path;
        private readonly OwnershipObservation[] _traces;
        private readonly (double start, double end)[] _ranges;
        private double? _anchor;
        private int _lastFrame = -1;

        public PresenterOwnershipWindow(string planPath, GameObject instance)
        {
            _path = planPath;
            _plan = JObject.Parse(File.ReadAllText(_path));
            var unity = _plan["unity"];
            if ((string)unity["event"] != "presenter-event") {
                throw new ArgumentException("Expected presenter event.");
            }
            var properties = (JArray)unity["properties"];
            _traces = properties.Select(_ => new OwnershipObservation()).ToArray();
            try {
                for (int i = 0; i < _traces.Length; i++) {
                    var binding = properties[i];
                    _traces[i].Begin(instance, (string)unity["prefab"], (string)binding["target"], (string)binding["component"], (string)binding["field"]);
                }
            }
            catch {
                foreach (var trace in _traces) {
                    trace.Release();
                }
                throw;
            }
            _ranges = _plan["picks"].Where(p => (string)p["status"] == "ready")
                .Select(p => ((double)p["offsetMs"], (double)p["latestOffsetMs"])).OrderBy(r => r.Item2).ToArray();
        }

        public void IncludeInput(UnityEngine.Object asset)
        {
            foreach (var trace in _traces) {
                trace.IncludeInput(asset);
            }
        }

        public void Signal(string eventId, PlayableGraph graph = default)
        {
            if (_anchor.HasValue || eventId != (string)_plan["event"]) {
                throw new InvalidOperationException("Unexpected or repeated presenter event.");
            }
            _anchor = Time.timeAsDouble;
            Sample(graph);
        }

        public bool Sample(PlayableGraph graph = default)
        {
            if (!_anchor.HasValue) {
                return false;
            }
            double elapsed = (Time.timeAsDouble - _anchor.Value) * 1000;
            if (Time.frameCount != _lastFrame && Array.Exists(_ranges, r => elapsed >= r.start - 100 && elapsed <= r.end + 100)) {
                foreach (var trace in _traces) {
                    trace.Checkpoint(elapsed.ToString("R", CultureInfo.InvariantCulture), graph);
                }
                _lastFrame = Time.frameCount;
            }
            return elapsed >= _ranges[_ranges.Length - 1].end;
        }

        public string Finish()
        {
            if (!_anchor.HasValue) {
                throw new InvalidOperationException("Presenter event was never observed.");
            }
            var result = new JObject {
                ["event"] = _plan["event"],
                ["planSha256"] = UiAuthoring.Hash(_path),
                ["anchorGameTime"] = _anchor.Value,
                ["properties"] = new JArray(_traces.Select(t => JObject.Parse(t.End())))
            };
            return result.ToString();
        }
    }
}
