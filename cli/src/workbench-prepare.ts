import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { sha } from './config.ts';
import { compare } from './compare.ts';
import { bundleEvidence } from './workbench-evidence.ts';
import { evidencePixelLimit, pngDimensions } from './image-limits.ts';
import { hashFile, readBaseline } from './evidence-baseline.ts';
import { renderInspect } from './render-inspect.ts';

type Pin = { path: string; sha256: string };
type Side = { image: Pin; receipt: Pin; dependencies: Pin[]; baseline?: Pin };
type Case = { id: string; reference: Side; candidate: Side; reports?: Pin[]; regions?: Pin; renderInspections: Pin[]; reviewDependencies?: { element: string; reports: number[] }[] };
type Check = { role: string; path: string; expected: string; actual?: string; status: 'current' | 'changed' | 'unavailable'; error?: string };

function object(value: any, keys: string[], label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)))
    throw new Error('Invalid ' + label + ' fields.');
}

function pin(value: any) {
  object(value, ['path', 'sha256'], 'file pin');
  if (typeof value.path !== 'string' || !value.path.length || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256))
    throw new Error('Each file requires path and lowercase SHA-256.');
}

function pins(value: any) {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Expected at most 100 file pins.');
  value.forEach(pin);
}

function parseSpec(bytes: Buffer, base: string): { schemaVersion: 1; cases: Case[] } {
  const spec = JSON.parse(bytes.toString('utf8'));
  object(spec, ['schemaVersion', 'cases'], 'review spec');
  if (spec.schemaVersion !== 1 || !Array.isArray(spec.cases) || !spec.cases.length || spec.cases.length > 20)
    throw new Error('Review spec requires schemaVersion 1 and 1–20 cases.');
  const ids = new Set<string>();
  for (const item of spec.cases) {
    object(item, ['id', 'reference', 'candidate', 'reports', 'regions', 'renderInspection', 'renderInspections', 'reviewDependencies'], 'case');
    if (typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(item.id) || ids.has(item.id))
      throw new Error('Case IDs must be unique lowercase slugs (1–64 characters).');
    ids.add(item.id);
    for (const name of ['reference', 'candidate']) {
      let side = item[name];
      if (side && typeof side === 'object' && Object.hasOwn(side, 'baseline')) {
        object(side, ['baseline'], name + ' baseline reference');
        if (typeof side.baseline !== 'string' || !side.baseline) throw new Error('Baseline reference requires a file path.');
        const normalized = readBaseline(resolve(base, side.baseline));
        item[name] = normalized;
        side = { image: normalized.image, receipt: normalized.receipt, dependencies: normalized.dependencies };
      }
      object(side, ['image', 'receipt', 'dependencies'], name);
      pin(side.image); pin(side.receipt); pins(side.dependencies);
    }
    if (item.reports !== undefined) pins(item.reports);
    if (item.regions !== undefined) pin(item.regions);
    if (item.reviewDependencies !== undefined) {
      if (!Array.isArray(item.reviewDependencies) || !item.reviewDependencies.length || item.reviewDependencies.length > 20) throw new Error('reviewDependencies requires 1–20 target declarations.');
      const targets = new Set<string>();
      for (const declaration of item.reviewDependencies) {
        object(declaration, ['element', 'reports'], 'review dependency declaration');
        if (typeof declaration.element !== 'string' || !declaration.element || declaration.element.length > 256 || targets.has(declaration.element) || !Array.isArray(declaration.reports) || new Set(declaration.reports).size !== declaration.reports.length || !declaration.reports.every((index: unknown) => Number.isInteger(index) && (index as number) >= 0 && (index as number) < (item.reports ?? []).length)) throw new Error('Review dependencies require unique element IDs and valid supporting report indices.');
        targets.add(declaration.element);
      }
    }

    if (item.renderInspection !== undefined && item.renderInspections !== undefined) throw new Error('Use renderInspection or renderInspections, not both.');
    const inspections = item.renderInspection === undefined ? item.renderInspections : [item.renderInspection];
    if (inspections !== undefined && (!Array.isArray(inspections) || !inspections.length || inspections.length > 20 || inspections.some((path: unknown) => typeof path !== 'string' || !path)))
      throw new Error('renderInspections requires 1–20 spec file paths.');
    const paths = (inspections ?? []).map((path: string) => resolve(base, path));
    if (new Set(paths).size !== paths.length) throw new Error('Render inspection spec paths must be unique within a case.');
    item.renderInspections = paths.map((path: string) => ({ path, sha256: hashFile(path) }));
    delete item.renderInspection;
  }
  return spec;
}

/** Offline review preparation. Baselines must come from capture/preparation time. */
export function prepareReview(specPath: string, output: string) {
  const specBytes = readFileSync(specPath), base = dirname(resolve(specPath)), spec = parseSpec(specBytes, base);
  const expectedByPath = new Map<string, string>();
  for (const item of spec.cases) {
    const files = [item.reference.image, item.reference.receipt, ...item.reference.dependencies,
      item.candidate.image, item.candidate.receipt, ...item.candidate.dependencies, ...(item.reports ?? [])];
    if (item.regions !== undefined) files.push(item.regions);
    files.push(...item.renderInspections);
    for (const side of [item.reference, item.candidate]) if (side.baseline !== undefined) files.push(side.baseline);
    for (const file of files) {
      const path = resolve(base, file.path), expected = expectedByPath.get(path);
      if (expected !== undefined && expected !== file.sha256)
        throw new Error('Conflicting SHA-256 pins for ' + path + ' (case ' + item.id + '). Retain different versions at separate paths.');
      expectedByPath.set(path, file.sha256);
    }
  }
  const out = resolve(output);
  const evidence = join(out, 'prepared');
  // Exclusive creation preserves prior evidence, including on failed preparation.
  mkdirSync(out);
  const report = {
    schemaVersion: 1, kind: 'helix-review-preparation', createdUtc: new Date().toISOString(),
    spec: { path: resolve(specPath), sha256: sha(specBytes) }, status: 'blocked',
    scope: 'Freshness covers declared file bytes at preparation time only. Dependency baselines come from producer records or explicit author pins; scenario equivalence and visual acceptance remain unmeasured.',
    cases: [] as { id: string; status: string; checks: Check[]; reasons: string[] }[],
    errors: [] as string[],
  };
  const retained = new Map<string, Buffer>();
  let retainedBytes = 0, pixels = 0;
  function check(file: Pin, role: string, checks: Check[], retain: boolean) {
    const path = resolve(base, file.path);
    try {
      if (!statSync(path).isFile()) throw new Error('Not a regular file.');
      if (retain && statSync(path).size > 32 * 1024 * 1024) throw new Error('Evidence file exceeds 32 MiB.');
      let actual: string;
      if (retain) {
        const bytes = readFileSync(path);
        actual = sha(bytes);
        if (actual === file.sha256 && !retained.has(actual)) {
          if (retainedBytes + bytes.length > 32 * 1024 * 1024) throw new Error('Retained inputs exceed 32 MiB.');
          retainedBytes += bytes.length;
          retained.set(actual, bytes);
        }
      } else {
        actual = hashFile(path);
      }
      checks.push({ role, path, expected: file.sha256, actual, status: actual === file.sha256 ? 'current' : 'changed' });
    } catch (error) {
      checks.push({ role, path, expected: file.sha256, status: 'unavailable', error: String(error) });
    }
  }
  const bytesFor = (file: Pin) => retained.get(file.sha256)!;
  try {
    for (const item of spec.cases) {
      const entry = { id: item.id, status: 'blocked', checks: [] as Check[], reasons: [] as string[] };
      report.cases.push(entry);
      for (const name of ['reference', 'candidate'] as const) {
        const side = item[name];
        if (side.baseline !== undefined) check(side.baseline, name + '.baseline', entry.checks, true);
        check(side.image, name + '.image', entry.checks, true);
        check(side.receipt, name + '.receipt', entry.checks, true);
        for (const dependency of side.dependencies) check(dependency, name + '.dependency', entry.checks, false);
        if (!side.dependencies.length) entry.reasons.push(name + ' freshness is unmeasured: no capture-time dependencies declared.');
      }
      for (const file of item.reports ?? []) check(file, 'report', entry.checks, true);
      if (item.regions !== undefined) check(item.regions, 'regions', entry.checks, true);
      for (const [index, file] of item.renderInspections.entries()) check(file, 'renderInspections.' + index + '.spec', entry.checks, true);
      if (entry.checks.some(check => check.status !== 'current')) entry.reasons.push('Pinned inputs changed or are unavailable.');
      if (!entry.reasons.length) {
        try {
          const a = pngDimensions(bytesFor(item.reference.image)), b = pngDimensions(bytesFor(item.candidate.image));
          if (a.width !== b.width || a.height !== b.height) throw new Error('Native image dimensions differ.');
          if (a.width * 2 > 8192 || a.width * a.height * 2 > 16777216) throw new Error('Side-by-side output would exceed viewer image limits.');
          pixels += a.width * a.height * 5; // Both inputs, difference, and double-width side-by-side.
          for (const side of [item.reference, item.candidate]) JSON.parse(bytesFor(side.receipt).toString('utf8'));
          for (const file of item.reports ?? []) JSON.parse(bytesFor(file).toString('utf8'));
          entry.status = 'current';
        } catch (error) { entry.reasons.push(String(error)); }
      }
    }
    if (pixels > evidencePixelLimit) throw new Error('Review exceeds the bundle decoded pixel budget; split the cases into smaller specs.');
    if (report.cases.some(item => item.status !== 'current')) return { out, ...report };
    mkdirSync(evidence);
    if (spec.cases.some(item => item.renderInspections.length > 0)) mkdirSync(join(out, 'inspections'));
    for (const [index, item] of spec.cases.entries()) {
      const dir = join(evidence, item.id);
      mkdirSync(dir);
      for (const name of ['reference', 'candidate'] as const) {
        if (item[name].baseline !== undefined) writeFileSync(join(dir, name + '-baseline.json'), bytesFor(item[name].baseline!), { flag: 'wx' });
        writeFileSync(join(dir, name + '.png'), bytesFor(item[name].image), { flag: 'wx' });
        writeFileSync(join(dir, name + '-receipt.json'), bytesFor(item[name].receipt), { flag: 'wx' });
      }
      for (const [index, file] of (item.reports ?? []).entries()) writeFileSync(join(dir, 'report-' + index + '.json'), bytesFor(file), { flag: 'wx' });
      if (item.regions !== undefined) writeFileSync(join(dir, 'regions.json'), bytesFor(item.regions), { flag: 'wx' });
      if (item.reviewDependencies) {
        const normalize = (file: Pin) => ({ path: resolve(base, file.path), sha256: file.sha256 });
        const inputs = Object.fromEntries((['reference', 'candidate'] as const).map(side => [side, { image: normalize(item[side].image), receipt: normalize(item[side].receipt), dependencies: item[side].dependencies.map(normalize) }]));
        writeFileSync(join(dir, 'review-inputs.json'), JSON.stringify({ kind: 'helix-review-inputs', schemaVersion: 1, ...inputs }, null, 2), { flag: 'wx' });
      }
      const elementIds = new Set<string>();
      if (item.renderInspections.length > 1) mkdirSync(join(out, 'inspections', item.id));
      for (const [elementIndex, elementSpec] of item.renderInspections.entries()) {
        const multiple = item.renderInspections.length > 1;
        const prefix = multiple ? 'rendering-' + elementIndex + '-' : 'rendering-';
        try {
          const inspection = renderInspect(elementSpec.path, multiple ? join(out, 'inspections', item.id, String(elementIndex)) : join(out, 'inspections', item.id), {
            reference: { image: item.reference.image.sha256, receipt: item.reference.receipt.sha256 },
            candidate: { image: item.candidate.image.sha256, receipt: item.candidate.receipt.sha256 },
            checkBaseline(baseline, role) {
              role = 'renderInspections.' + elementIndex + '.' + role;
              const checks: Check[] = [];
              check(baseline.baseline, role + '.baseline', checks, true);
              check(baseline.image, role + '.image', checks, true);
              check(baseline.receipt, role + '.receipt', checks, true);
              for (const dependency of baseline.dependencies) check(dependency, role + '.dependency', checks, false);
              report.cases[index].checks.push(...checks);
              if (!baseline.dependencies.length) throw new Error(role + ' freshness is unmeasured: no capture-time dependencies declared.');
              if (checks.some(check => check.status !== 'current')) throw new Error(role + ' baseline inputs changed or are unavailable.');
            },
          });
          const data = readFileSync(inspection.report);
          const rendering = JSON.parse(data.toString());
          if (rendering.specSha256 !== elementSpec.sha256) throw new Error('Render inspection spec changed during preparation.');
          if (elementIds.has(rendering.id)) throw new Error('Duplicate rendering element ID within case: ' + rendering.id);
          elementIds.add(rendering.id);
          const declaration = item.reviewDependencies?.find(target => target.element === rendering.id);
          const dependencies = declaration ? [
            'reference.png', 'candidate.png', 'reference-receipt.json', 'candidate-receipt.json', 'review-inputs.json',
            'comparison/comparison.json', 'comparison/diff.png', 'comparison/side-by-side.png',
            ...(['reference', 'candidate'] as const).filter(side => item[side].baseline !== undefined).map(side => side + '-baseline.json'),
            ...(item.regions === undefined ? [] : ['regions.json']),
            ...rendering.evidence.filter((file: { path: string }) => file.path.endsWith('.json')).map((file: { path: string }) => prefix + file.path),
            ...declaration.reports.map(index => 'report-' + index + '.json'),
          ].map(path => item.id + '/' + path).sort() : undefined;
          writeFileSync(join(dir, multiple ? 'render-inspection-' + elementIndex + '.json' : 'render-inspection.json'), JSON.stringify({ ...rendering, reviewCaseId: item.id, ...(dependencies ? { reviewDependencies: { version: 1, paths: dependencies } } : {}) }, null, 2), { flag: 'wx' });
          for (const file of rendering.evidence.filter((file: { path: string }) => file.path.endsWith('.json'))) {
            const raw = readFileSync(join(dirname(inspection.report), file.path));
            if (sha(raw) !== file.sha256) throw new Error('Collected rendering evidence changed: ' + file.path);
            writeFileSync(join(dir, prefix + file.path), raw, { flag: 'wx' });
          }
        } catch (error) {
          report.cases[index].status = 'blocked';
          report.cases[index].reasons.push('Render inspection ' + elementSpec.path + ': ' + String(error));
          throw new Error('Render inspection failed for case ' + item.id + ': ' + String(error));
        }
      }
      for (const declaration of item.reviewDependencies ?? []) if (!elementIds.has(declaration.element)) throw new Error('Review dependency target was not prepared: ' + declaration.element);
      compare(join(dir, 'reference.png'), join(dir, 'candidate.png'), join(dir, 'comparison'), item.regions === undefined ? undefined : join(dir, 'regions.json'));
    }
    report.status = 'ready';
    writeFileSync(join(evidence, 'freshness.json'), JSON.stringify(report, null, 2));
    writeFileSync(join(evidence, 'review-spec.json'), specBytes);
    const bundle = bundleEvidence(evidence, join(out, 'bundle'));
    return { out, status: report.status, cases: report.cases, bundle: join(bundle.out, 'evidence.json'), note: 'Open the bundle in Porting Workbench → Comparison. Ready means prepared for human review, not accepted parity.' };
  } catch (error) {
    report.status = 'blocked';
    report.errors.push(String(error));
    if (existsSync(evidence)) writeFileSync(join(evidence, 'freshness.json'), JSON.stringify(report, null, 2));
    return { out, ...report };
  } finally {
    writeFileSync(join(out, 'freshness.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  }
}
