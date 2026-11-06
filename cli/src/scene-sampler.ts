// Serialized into the page: one protocol roundtrip per sequence, deadline-based sampling.
export async function sampleScene(probe, config, timing) {
  const samples = [],
    start = performance.now();
  let next = 0,
    missedSamples = 0,
    bytes = 0,
    error = null;
  try {
    while (samples.length < 300) {
      const wait = start + next - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const observed = performance.now() - start,
        snapshot = probe(config),
        end = performance.now() - start;
      const sample = {
        sampledAtMs: observed,
        scheduledAtMs: next,
        captureDurationMs: end - observed,
        snapshot,
      };
      bytes += new TextEncoder().encode(JSON.stringify(sample)).length;
      if (bytes > 64000000) throw new Error('Scene recording exceeds 64MB');
      samples.push(sample);
      if (observed >= timing.durationMs) break;
      next += timing.intervalMs;
      while (next < end) {
        next += timing.intervalMs;
        missedSamples++;
      }
    }
  } catch (e) {
    error = String(e);
  }
  return {
    schemaVersion: 1,
    kind: 'helix-scene-sequence',
    complete: error === null,
    samples,
    error,
    intervalMs: timing.intervalMs,
    missedSamples,
    notes: [
      'Browser monotonic deadlines. Project timeline events are required for cross-engine alignment; missed samples are not interpolated.',
    ],
  };
}
