import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareScenes, validateScene } from './scene.ts';
import { emptyOutput, sha } from './config.ts';

export function validateSequence(sequence: any) {
  if (
    sequence?.schemaVersion !== 1 ||
    sequence.kind !== 'helix-scene-sequence' ||
    sequence.complete !== true ||
    !Array.isArray(sequence.samples) ||
    sequence.samples.length < 2 ||
    sequence.samples.length > 300
  )
    throw new Error('Need a complete scene sequence with 2..300 samples');
  let previous = -Infinity,
    event;
  for (const sample of sequence.samples) {
    validateScene(sample.snapshot);
    const t = sample.snapshot.timeline;
    if (
      !t ||
      typeof t.event !== 'string' ||
      !t.event ||
      !Number.isFinite(t.elapsedMs) ||
      t.elapsedMs < 0 ||
      t.elapsedMs <= previous ||
      (event && t.event !== event)
    )
      throw new Error(
        'Every sample needs the same observed timeline event and strictly increasing nonnegative elapsedMs',
      );
    previous = t.elapsedMs;
    event = t.event;
  }
  return sequence;
}
export function compareMotion(a: any, b: any, spec: any) {
  validateSequence(a);
  validateSequence(b);
  if (!Number.isFinite(spec.timeToleranceMs) || spec.timeToleranceMs < 0)
    throw new Error('Motion spec needs explicit nonnegative timeToleranceMs');
  if (a.samples[0].snapshot.timeline.event !== b.samples[0].snapshot.timeline.event)
    throw new Error('Timeline events differ');
  const used = new Set();
  let lastIndex = -1;
  const samples = a.samples.map((reference) => {
    const t = reference.snapshot.timeline.elapsedMs;
    const candidates = b.samples
      .map((s, i) => ({ s, i, d: Math.abs(s.snapshot.timeline.elapsedMs - t) }))
      .filter((c) => c.i > lastIndex && c.d <= spec.timeToleranceMs)
      .sort((x, y) => x.d - y.d);
    if (!candidates.length)
      return {
        referenceTimeMs: t,
        status: 'unmeasured',
        reason: 'no-unused-sample-within-time-tolerance',
      };
    if (candidates.length > 1 && Math.abs(candidates[0].d - candidates[1].d) < 1e-9)
      return { referenceTimeMs: t, status: 'unmeasured', reason: 'ambiguous-nearest-time' };
    const selected = candidates[0];
    used.add(selected.i);
    lastIndex = selected.i;
    return {
      referenceTimeMs: t,
      candidateTimeMs: selected.s.snapshot.timeline.elapsedMs,
      timeDeltaMs: selected.s.snapshot.timeline.elapsedMs - t,
      status: 'sampled',
      report: compareScenes(reference.snapshot, selected.s.snapshot, spec),
    };
  });
  const trajectories = spec.mappings.map((mapping) => ({
    id: mapping.id,
    samples: samples.map((pair) => {
      const m = pair.report?.mappings.find((m) => m.id === mapping.id);
      return {
        referenceTimeMs: pair.referenceTimeMs,
        candidateTimeMs: pair.candidateTimeMs,
        status: m?.status ?? 'unmeasured',
        referenceCenter: m?.reference?.bounds
          ? {
              x: m.reference.bounds.x + m.reference.bounds.width / 2,
              y: m.reference.bounds.y + m.reference.bounds.height / 2,
            }
          : null,
        candidateCenter: m?.candidate?.bounds
          ? {
              x: m.candidate.bounds.x + m.candidate.bounds.width / 2,
              y: m.candidate.bounds.y + m.candidate.bounds.height / 2,
            }
          : null,
        deltaPx: m?.deltaPx ?? null,
      };
    }),
  }));
  return {
    schemaVersion: 1,
    kind: 'helix-scene-motion',
    acceptance: 'diagnostic-only',
    event: a.samples[0].snapshot.timeline.event,
    samples,
    trajectories,
    coverage: {
      referenceSamples: a.samples.length,
      pairedSamples: used.size,
      unpairedCandidateTimes: b.samples
        .filter((_, i) => !used.has(i))
        .map((s) => s.snapshot.timeline.elapsedMs),
    },
    notes: [
      'No interpolation, retiming, best-frame selection or animation update. Coverage is discrete; unsampled events and rendered appearance remain unmeasured.',
    ],
  };
}
export function compareMotionFiles(
  reference: string,
  candidate: string,
  spec: string,
  output: string,
) {
  const files = [reference, candidate, spec],
    bytes = files.map((p) => readFileSync(p));
  const [a, b, s] = bytes.map((b) => JSON.parse(b.toString()));
  const report = {
    ...compareMotion(a, b, s),
    inputs: bytes.map((b, i) => ({ path: files[i], sha256: sha(b) })),
  };
  const out = emptyOutput(output);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  return { out, report };
}
