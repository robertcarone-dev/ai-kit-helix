using System;
using System.Collections.Generic;
using System.Diagnostics;
using Newtonsoft.Json;
using UnityEditor;
using UnityEngine;
using UnityEngine.LowLevel;

namespace Helix.Comparison
{
    // Owned by one comparison recipe. Install once per replay; captures no images.
    public sealed class PlayerLoopTimingTrace : IDisposable
    {
        private struct Sample
        {
            public int frame;
            public double t;
        }

        private readonly List<Sample> frames = new List<Sample>(2048);
        private readonly List<object> events = new List<object>();
        private readonly Stopwatch clock = Stopwatch.StartNew();
        private readonly string recordingId;
        private bool active;

        // Supply the recorder ID for a recorded run, or null for a trace-only replay.
        public PlayerLoopTimingTrace(string recordingId)
        {
            if (!EditorApplication.isPlaying)
                throw new InvalidOperationException("A timing trace requires Play Mode.");

            this.recordingId = recordingId;
            var loop = PlayerLoop.GetCurrentPlayerLoop();
            int index = Array.FindIndex(loop.subSystemList, phase => phase.type == typeof(UnityEngine.PlayerLoop.Update));
            if (index < 0)
                throw new InvalidOperationException("Player loop has no Update phase.");

            var phaseSystem = loop.subSystemList[index];
            var children = new List<PlayerLoopSystem>(phaseSystem.subSystemList);
            if (children.Exists(child => child.type == typeof(PlayerLoopTimingTrace)))
                throw new InvalidOperationException("A timing trace is already active.");

            children.Add(new PlayerLoopSystem { type = typeof(PlayerLoopTimingTrace), updateDelegate = Capture });
            phaseSystem.subSystemList = children.ToArray();
            loop.subSystemList[index] = phaseSystem;
            PlayerLoop.SetPlayerLoop(loop);
            active = true;
            AssemblyReloadEvents.beforeAssemblyReload += Dispose;
            EditorApplication.playModeStateChanged += OnPlayModeChanged;
        }

        private void Capture()
        {
            int frame = Time.frameCount;
            if (frames.Count == 0 || frames[frames.Count - 1].frame != frame)
                frames.Add(new Sample { frame = frame, t = clock.Elapsed.TotalSeconds });
        }

        public void Mark(string action)
        {
            if (!active)
                throw new InvalidOperationException("Timing trace has ended.");
            events.Add(new { action, frame = Time.frameCount, t = clock.Elapsed.TotalSeconds });
        }

        public string Finish()
        {
            if (!active)
                throw new InvalidOperationException("Timing trace has ended.");
            Dispose();
            return JsonConvert.SerializeObject(new { schemaVersion = 1, clock = "monotonic-seconds", recordingId, frames, events });
        }

        private void OnPlayModeChanged(PlayModeStateChange change)
        {
            if (change == PlayModeStateChange.ExitingPlayMode)
                Dispose();
        }

        public void Dispose()
        {
            if (!active)
                return;
            active = false;
            AssemblyReloadEvents.beforeAssemblyReload -= Dispose;
            EditorApplication.playModeStateChanged -= OnPlayModeChanged;
            var loop = PlayerLoop.GetCurrentPlayerLoop();
            for (int i = 0; i < loop.subSystemList.Length; i++) {
                var phase = loop.subSystemList[i];
                if (phase.type != typeof(UnityEngine.PlayerLoop.Update))
                    continue;
                var children = new List<PlayerLoopSystem>(phase.subSystemList);
                if (children.RemoveAll(child => child.updateDelegate == (PlayerLoopSystem.UpdateFunction)Capture) == 0)
                    return;
                phase.subSystemList = children.ToArray();
                loop.subSystemList[i] = phase;
                PlayerLoop.SetPlayerLoop(loop);
                return;
            }
        }
    }
}
