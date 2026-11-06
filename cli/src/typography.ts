// Compare renderer output in common coordinates. Authoring properties remain diagnostic.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { emptyOutput, sha } from './config.ts';
import { compareSnapshots, disposition, escape, loadSnapshot, writeNativeCrop } from './ui.ts';

type Metric = { field: string; status: string; [key: string]: unknown };
function rendererLines(text: any): string[] | null {
  if (
    !Array.isArray(text.lines) ||
    !text.lines.length ||
    text.lines.length !== text.lineCount ||
    !text.lines.every((line: unknown) => typeof line === 'string')
  )
    return null;
  // TMP's line indices can include the explicit line terminator. Preserve all other whitespace.
  return text.lines.map((line: string) => line.replace(/(?:\r\n|\r|\n)$/, ''));
}

function perLine(
  field: string,
  values: string,
  tolerance: number,
  a: any,
  b: any,
  sameLines: boolean,
): Metric {
  if (!sameLines)
    return {
      field,
      status: 'unmeasured',
      reason: 'Cannot align differing or unavailable rendered lines.',
    };
  const left = a[values],
    right = b[values];
  if (![left, right].every((series) => Array.isArray(series) && series.length === a.lineCount))
    return {
      field,
      status: 'unmeasured',
      reason: 'Missing native-pixel observations for one or more lines.',
    };
  const lines = left.map((reference: number, i: number) => {
    if (!Number.isFinite(reference) || !Number.isFinite(right[i]))
      return { line: i + 1, status: 'unmeasured', reason: 'Line has no measured value.' };
    const delta = right[i] - reference;
    return {
      line: i + 1,
      reference,
      candidate: right[i],
      delta,
      status: Math.abs(delta) <= tolerance ? 'passed' : 'difference',
    };
  });
  return { field, unit: 'native px', tolerance, lines, status: disposition(lines) };
}

export function compareTypography(
  reference: string,
  candidate: string,
  specFile: string,
  output: string,
) {
  const a = loadSnapshot(reference),
    b = loadSnapshot(candidate);
  const spec = JSON.parse(readFileSync(specFile, 'utf8'));
  for (const key of ['baselineTolerancePx', 'advanceTolerancePx'])
    if (!Number.isFinite(spec[key]) || spec[key] < 0) throw new Error('Specify nonnegative ' + key);
  // Reuse UI pairing, selector errors, viewport, state and safe-area gates. Layout bounds
  // describe the component, so they are used for crops rather than scored as glyph widths.
  const pairs = compareSnapshots(a.ui, b.ui, {
    schemaVersion: spec.schemaVersion,
    stateKeys: spec.stateKeys,
    checkpoint: spec.checkpoint,
    elements: spec.elements.map((e: any) => ({
      id: e.id,
      reference: e.reference,
      candidate: e.candidate,
    })),
  });
  for (const [side, ui] of [
    ['reference', a.ui],
    ['candidate', b.ui],
  ] as const) {
    for (const key of ['dpr', 'zoom'])
      pairs.prerequisites.push({
        path: side + '.viewport.' + key,
        status: ui.viewport[key] === 1 ? 'passed' : 'blocked',
        expected: 1,
        observed: ui.viewport[key] ?? null,
      });
  }
  const out = emptyOutput(output);
  const valid = pairs.prerequisites.every((p) => p.status === 'passed');
  const elements = pairs.elements.map((pair: any, i: number) => {
    const checks: Metric[] = [],
      source = pair.reference?.text,
      target = pair.candidate?.text;
    const pairing = pair.checks.filter((c: any) => ['binding', 'selector'].includes(c.path));
    if (!valid || pairing.length || !pair.reference?.visible || !pair.candidate?.visible)
      checks.push({
        field: 'pairing',
        status: 'blocked',
        reason: 'Requires matching context and one visible uniquely bound label on each side.',
        pairing,
      });
    else if (source?.renderer !== 'Text' || target?.renderer !== 'TextMeshProUGUI')
      checks.push({
        field: 'renderer',
        status: 'unmeasured',
        reason: 'Requires Phaser Text and Canvas TextMeshProUGUI observations.',
      });
    else {
      const left = rendererLines(source),
        right = rendererLines(target);
      const same = !!left && !!right && isDeepStrictEqual(left, right);
      checks.push({
        field: 'renderedLines',
        reference: left,
        candidate: right,
        status: !left || !right ? 'unmeasured' : same ? 'passed' : 'difference',
      });
      const mapping = spec.elements[i].fontMapping;
      if (mapping !== undefined) {
        if (
          !mapping ||
          typeof mapping.referenceFamily !== 'string' ||
          !mapping.referenceFamily ||
          typeof mapping.candidateGuid !== 'string' ||
          !mapping.candidateGuid
        )
          throw new Error('Font mapping needs referenceFamily and candidateGuid for ' + pair.id);
        const seen = {
          referenceFamily: source.family ?? null,
          candidateGuid: target.fontAsset?.guid ?? null,
        };
        checks.push({
          field: 'configuredFontMapping',
          expected: mapping,
          observed: seen,
          status:
            !seen.referenceFamily || !seen.candidateGuid
              ? 'unmeasured'
              : seen.referenceFamily === mapping.referenceFamily &&
                  seen.candidateGuid === mapping.candidateGuid
                ? 'passed'
                : 'difference',
        });
      }
      checks.push(perLine('baseline', 'baselines', spec.baselineTolerancePx, source, target, same));
      checks.push(
        perLine('lineAdvance', 'lineAdvancePx', spec.advanceTolerancePx, source, target, same),
      );
    }
    const crops = {
      reference: writeNativeCrop(out, a.png, pair.reference?.bounds, `reference-${i}.png`),
      candidate: writeNativeCrop(out, b.png, pair.candidate?.bounds, `candidate-${i}.png`),
    };
    return {
      id: pair.id,
      status: disposition(checks),
      checks,
      crops,
      rawStringEquality:
        typeof source?.value === 'string' && typeof target?.value === 'string'
          ? source.value === target.value
          : null,
      reference: source ?? null,
      candidate: target ?? null,
      canvas: pair.candidate?.layout ?? null,
    };
  });
  const fontResources = (a.receipt.identity?.sources ?? []).filter((s: any) =>
    /\.(woff2?|otf|ttf)(?:$|[?#])/i.test(s.url),
  );
  const report = {
    schemaVersion: 1,
    kind: 'typography-comparison',
    status: disposition(elements),
    prerequisites: pairs.prerequisites,
    elements,
    provenance: {
      reference: {
        receipt: reference,
        sha256: sha(readFileSync(reference)),
        imageSha256: a.receipt.sha256,
        fontResources,
      },
      candidate: {
        receipt: candidate,
        sha256: sha(readFileSync(candidate)),
        imageSha256: b.receipt.sha256,
        revision: b.receipt.revision,
      },
      specSha256: sha(readFileSync(specFile)),
    },
    scope:
      'Baselines and line advances use native screen pixels; positive baseline delta means lower in Unity. Advance excludes painted outline and shadow. Raw Phaser font sizes and weights and TMP authoring values use different conventions. A configured font stack, available font resources and a TMP asset do not establish per-glyph face equivalence. Inspect native crops for ink, weight, stroke, shadow, clipping and fallback; these are unmeasured by this command.',
  };
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  const sections = elements
    .map(
      (e: any) =>
        `<section><h2>${escape(e.id)} · ${escape(e.status)}</h2><div>${Object.entries(e.crops)
          .map(([side, file]) =>
            file
              ? `<figure><figcaption>${side}</figcaption><img alt="${side} text crop" src="${file}"></figure>`
              : '',
          )
          .join(
            '',
          )}</div><pre>${escape(JSON.stringify(e.checks, null, 2))}</pre><details><summary>Font, text and Canvas evidence</summary><pre>${escape(JSON.stringify({ reference: e.reference, candidate: e.candidate, canvas: e.canvas }, null, 2))}</pre></details></section>`,
    )
    .join('');
  writeFileSync(
    join(out, 'review.html'),
    `<!doctype html><meta charset="utf-8"><title>Typography comparison</title><style>body{font:15px system-ui;color:#19272c;margin:2rem}section{border-top:1px solid #ccd1d4}section div{display:flex;gap:12px;overflow:auto}figure{margin:0}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Typography comparison · ${escape(report.status)}</h1><p>${escape(report.scope)}</p><details><summary>Capture prerequisites</summary><pre>${escape(JSON.stringify(report.prerequisites, null, 2))}</pre></details>${sections}`,
  );
  return {
    status: report.status,
    out,
    elements: elements.map(({ id, status, checks }: any) => ({
      id,
      status,
      checks: checks.map((c: Metric) => ({ field: c.field, status: c.status })),
    })),
  };
}
