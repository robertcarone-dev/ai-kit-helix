import { expandAdapterManifest } from './adapter-format.ts';
import { captureDependencyPins, dependencyPinState } from './dependency-pins.ts';
import { validateDependencySelectors } from './dependency-selection.ts';
import { evidencePath } from './evidence-archive.ts';
/** Executes authored case adapters. Game setup stays in consumer manifests and lifecycle recipes. */
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadAcceptance, saveRun } from './acceptance.ts';
import { criteriaHash, identifier, recordHash } from './acceptance-format.ts';
import { catalogPath } from './catalog.ts';
import { hashFile } from './evidence-baseline.ts';
import { runCommand, runMatrix } from './ui-runner.ts';
import { isolatedWorkspace } from './isolation.ts';
import { adapterSettings } from './config.ts';
import { discover } from './discovery.ts';
import { unityRevision } from './unity-plan.ts';
import { loadSnapshot } from './ui.ts';

type Pin = { path: string; sha256: string };
type Retained = Pin & { claim: string; recovery: string; inputs: Pin[] };
type Capture = { kind: 'ui-matrix'; spec: string; caseId: string; limitations: string } | { kind: 'node'; script: string; args: string[]; limitations: string };
export type CaseAdapter = { item: string; caseId: string; viewport: string; retained: Pin[]; capture: Capture | null };
const adaptersPath = 'Tools/Helix/acceptance/adapters.json';
function fields(value: any, keys: string[], label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error('Invalid ' + label);
}
function text(value: any) { if (typeof value !== 'string' || !value.trim()) throw new Error('Expected adapter text'); }
function pin(root: string, value: any) {
  fields(value, ['path', 'sha256', ...(value.selectors === undefined ? [] : ['selectors'])], 'adapter pin'); if (value.selectors !== undefined) validateDependencySelectors(value.selectors); catalogPath(root, value.path);
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('Expected adapter SHA-256');
}
export function loadCaseAdapters(root: string, project: string): CaseAdapter[] {
  const path = catalogPath(root, adaptersPath);
  if (!existsSync(path)) return [];
  if (statSync(path).size > 32 * 1024 * 1024) throw new Error('Case adapter manifest exceeds 32 MiB');
  let value = JSON.parse(readFileSync(path, 'utf8'));
  value = expandAdapterManifest(value);
  fields(value, ['version', 'project', 'routes'], 'case adapter manifest');
  if (value.version !== 1 || value.project !== project || !Array.isArray(value.routes)) throw new Error('Invalid case adapter project/version/routes');
  const { screens } = loadAcceptance(root, project), keys = new Set<string>();
  for (const route of value.routes) {
    fields(route, ['item', 'caseId', 'viewport', 'retained', 'capture'], 'case adapter route');
    for (const key of ['item', 'caseId', 'viewport']) identifier(route[key]);
    const entry = screens.find(item => item.id === route.item)?.cases.find(entry => entry.id === route.caseId);
    if (!entry || !entry.viewports.includes(route.viewport)) throw new Error('Adapter targets unknown case/viewport');
    const key = JSON.stringify([route.item, route.caseId, route.viewport]);
    if (keys.has(key)) throw new Error('Duplicate case adapter'); keys.add(key);
    if (!Array.isArray(route.retained)) throw new Error('Expected retained evidence list');
    const paths = new Set<string>();
    for (const source of route.retained) {
      pin(root, source);
      if (paths.has(source.path)) throw new Error('Duplicate retained source'); paths.add(source.path);
    }
    if (route.capture !== null) {
      const capture = route.capture;
      if (capture.kind === 'ui-matrix') {
        fields(capture, ['kind', 'spec', 'caseId', 'limitations'], 'matrix adapter'); catalogPath(root, capture.spec); identifier(capture.caseId);
        if (entry.dimension !== 'appearance') throw new Error('Still matrix cannot execute motion, behavior or audio acceptance');
      } else if (capture.kind === 'node') {
        fields(capture, ['kind', 'script', 'args', 'limitations'], 'node adapter'); catalogPath(root, capture.script);
        if (!Array.isArray(capture.args) || capture.args.some((arg: any) => typeof arg !== 'string' || /\{(?!root\}|out\}|case\}|viewport\})/.test(arg))) throw new Error('Invalid node adapter arguments');
      } else throw new Error('Unknown capture adapter kind');
      text(capture.limitations);
    }
  }
  return value.routes;
}
function inspectPin(root: string, file: Pin & { selectors?: import('./dependency-selection.ts').DependencySelector[] }, cache: Map<string, string>) {
  if (file.selectors !== undefined) { const state = dependencyPinState(root, file); return { ...file, status: state === 'match' ? 'intact' : state }; }
  const path = evidencePath(root, file.path);
  if (!existsSync(path)) return { ...file, status: 'missing' };
  let actual = cache.get(path);
  if (actual === undefined) { actual = hashFile(path); cache.set(path, actual); }
  return { ...file, actual, status: actual === file.sha256 ? 'intact' : 'changed' };
}
export function retainedEvidence(root: string, route: CaseAdapter) {
  const cache = new Map<string, string>();
  const files: Retained[] = [];
  for (const source of route.retained) {
    const sourcePath = catalogPath(root, source.path);
    if (inspectPin(root, source, cache).status !== 'intact') throw new Error('Historical evidence source missing or changed: ' + source.path);
    if (statSync(sourcePath).size > 32 * 1024 * 1024) throw new Error('Historical evidence source exceeds 32 MiB');
    const record = JSON.parse(readFileSync(sourcePath, 'utf8'));
    if (record.schemaVersion !== 1 || !Array.isArray(record.evidence)) throw new Error('Expected a version 1 discrepancy evidence source');
    for (const file of record.evidence) {
      pin(root, { path: file.path, sha256: file.sha256 }); text(file.claim);
      if (!Array.isArray(file.inputs)) throw new Error('Missing captured input pins');
      file.inputs.forEach((input: any) => pin(root, input));
      const recovery = typeof file.recoverFrom === 'string' ? file.recoverFrom : JSON.stringify(file.recovery ?? { source: source.path, action: 'Recover original discrepancy evidence' });
      if (!files.some(existing => existing.path === file.path && existing.sha256 === file.sha256)) files.push({ path: file.path, sha256: file.sha256, claim: file.claim, recovery, inputs: file.inputs });
    }
  }
  return files.map(file => {
    const evidence = inspectPin(root, file, cache), inputs = file.inputs.map(input => inspectPin(root, input, cache));
    return { ...evidence, claim: file.claim, recovery: file.recovery, inputs,
      reuse: evidence.status !== 'intact' ? 'recover-original' : !inputs.length ? 'provenance-incomplete' : inputs.some(input => input.status !== 'intact') ? 'inputs-drifted' : 'review-required' };
  });
}
export async function planAcceptanceCase(root: string, project: string, item: string, caseId: string, viewport: string, out: string) {
  const requested = relative(resolve(root), resolve(out));
  root = realpathSync(root); out = catalogPath(root, requested);
  const { scope, screens } = loadAcceptance(root, project), screen = screens.find(screen => screen.id === item);
  const entry = screen?.cases.find(entry => entry.id === caseId && entry.viewports.includes(viewport));
  if (!screen || !entry) throw new Error('Unknown acceptance case/viewport');
  const route = loadCaseAdapters(root, project).find(route => route.item === item && route.caseId === caseId && route.viewport === viewport);
  const size = scope.viewports.find(size => size.id === viewport)!;
  const evidence = route ? retainedEvidence(root, route) : [];
  let capturePlan: any = null;
  if (route?.capture?.kind === 'ui-matrix') {
    capturePlan = await runMatrix({ root, cli: fileURLToPath(new URL('./cli.ts', import.meta.url)), specPath: catalogPath(root, route.capture.spec), caseId: route.capture.caseId, out: join(out, 'capture') });
    const planned = capturePlan.cases[0];
    if (capturePlan.cases.length !== 1 || planned.viewport !== viewport || planned.widthPx !== size.width || planned.heightPx !== size.height || size.safeArea !== 'full-rectangle') throw new Error('Capture route differs from acceptance viewport');
  }
  return { version: 1, project, item, caseId, viewport, criteriaSha256: criteriaHash(scope, screen, entry, viewport),
    routeSha256: route ? recordHash(route) : null, retained: evidence, capture: route?.capture ?? null, capturePlan,
    captureAvailable: route?.capture !== undefined && route.capture !== null, blockers: entry.recipe.blockers,
    note: 'Retained checks never rebaseline old evidence. Capture completion produces unmeasured observations, not acceptance.' };
}
function write(path: string, value: unknown) { writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
/** Offline inspection is separate from live capture. Capture delegates ownership/restoration to existing runners. */
export async function runAcceptanceCase(root: string, project: string, item: string, caseId: string, viewport: string, output: string, mode: string) {
  if (!['retained', 'capture'].includes(mode)) throw new Error('Use mode retained or capture');
  const requested = relative(resolve(root), resolve(output));
  root = realpathSync(root);
  const out = catalogPath(root, requested);
  if (!relative(root, out).startsWith('.aikit/scratch/')) throw new Error('Case output must be a fresh directory under .aikit/scratch');
  if (existsSync(out)) throw new Error('Case output already exists');
  const plan = await planAcceptanceCase(root, project, item, caseId, viewport, out);
  if (mode === 'retained' && !plan.retained.length) throw new Error('No retained artifacts mapped to this case');
  if (mode === 'capture' && !plan.captureAvailable) throw new Error('No capture adapter for this case; inspect retained evidence or implement the missing route');
  if (mode === 'capture' && !isolatedWorkspace(root)) throw new Error('Live capture requires an owned isolated lane/worktree; the runner never launches an Editor');
  if (mode === 'capture' && hashFile(catalogPath(root, 'Tools/Helix/src/acceptance-runner.ts')) !== hashFile(fileURLToPath(import.meta.url))) throw new Error('Target checkout runner differs; adopt the reviewed toolkit before capture');
  mkdirSync(out, { recursive: true }); write(join(out, 'plan.json'), plan);
  const report: any = { version: 1, id: randomUUID(), project, item, caseId, viewport, mode, criteriaSha256: plan.criteriaSha256, routeSha256: plan.routeSha256, startedUtc: new Date().toISOString(), status: 'running', output: relative(root, out), artifacts: [], error: null };
  const journal = () => { const temporary = join(out, 'execution.tmp'); writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n'); renameSync(temporary, join(out, 'execution.json')); };
  journal();
  try {
    if (mode === 'retained') {
      report.status = plan.retained.some(file => file.status === 'intact') ? 'prior-evidence-review' : 'recovery-required';
      write(join(out, 'retained.json'), { ...plan, checkedUtc: new Date().toISOString() });
      // Self-contained review checklist; original bytes remain at their pinned paths.
      const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
      writeFileSync(join(out, 'review.html'), '<!doctype html><meta charset="utf-8"><title>Retained acceptance evidence</title><h1>' + escape(item + ' / ' + caseId + ' / ' + viewport) + '</h1><p>Historical evidence only. No current verification or approval inferred.</p>' + plan.retained.map(file => '<section><h2>' + escape(file.claim) + '</h2><p>' + escape(file.path + ': ' + file.status + ' / ' + file.reuse) + '</p><p>Recovery: ' + escape(file.recovery) + '</p><ul>' + file.inputs.map(input => '<li>' + escape(input.path + ': ' + input.status) + '</li>').join('') + '</ul></section>').join(''), { flag: 'wx' });
    } else if (plan.capture!.kind === 'node') {
      const capture = plan.capture!;
      const values: Record<string, string> = { root, out: join(out, 'capture'), case: caseId, viewport };
      const args = capture.args.map(arg => arg.replace(/\{(root|out|case|viewport)\}/g, (_, key) => values[key]));
      const interruption = new AbortController();
      const interrupt = () => interruption.abort();
      process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
      try { report.command = await runCommand(process.execPath, [catalogPath(root, capture.script), ...args], root, 600000, process.env, interruption.signal); }
      finally { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); }
      report.status = 'capture-complete';
    } else {
      const capture = plan.capture!;
      const { scope, screens } = loadAcceptance(root, project), screen = screens.find(screen => screen.id === item)!, entry = screen.cases.find(entry => entry.id === caseId)!;
      const size = scope.viewports.find(size => size.id === viewport)!;
      const { referenceObservation } = await import('../workbench/acceptance-backend.ts');
      const identity = await discover(adapterSettings(root));
      const reference = referenceObservation(root, identity.sourceRoot, project);
      const inputs = captureDependencyPins(root, entry);
      write(join(out, 'capture-inputs.json'), { reference, inputs, criteriaSha256: plan.criteriaSha256 });
      await runMatrix({ root, cli: fileURLToPath(new URL('./cli.ts', import.meta.url)), specPath: catalogPath(root, capture.spec), caseId: capture.caseId, out: join(out, 'capture'), execute: 'yes' });
      const matrix = JSON.parse(readFileSync(join(out, 'capture/matrix.json'), 'utf8')), row = matrix.cases[0];
      if (!row || row.captureComplete !== true || row.cleanupFailed || row.executionOutcome !== 'restored') throw new Error('Capture or restoration incomplete; inspect capture/matrix.json and reconcile the owned session');
      if (referenceObservation(root, identity.sourceRoot, project).identity !== reference.identity || inputs.some(pin => dependencyPinState(root, pin) !== 'match')) throw new Error('Inputs changed during capture; retain artifacts but do not import');
      const current = await planAcceptanceCase(root, project, item, caseId, viewport, out);
      if (current.criteriaSha256 !== plan.criteriaSha256 || current.routeSha256 !== plan.routeSha256) throw new Error('Case/adapter changed during capture');
      const artifacts: any[] = [];
      for (const side of ['reference', 'candidate']) {
        const receipt = row.receipts[side], snapshot = loadSnapshot(receipt);
        if (snapshot.ui.viewport.width !== size.width || snapshot.ui.viewport.height !== size.height) throw new Error('Captured dimensions differ from acceptance');
        for (const [file, kind] of [[snapshot.imagePath, 'image'], [receipt, 'observations']]) {
          const path = relative(root, file); catalogPath(root, path);
          artifacts.push({ path, sha256: hashFile(file), kind, side, recovery: 'Archive complete capture directory: ' + relative(root, out) });
        }
      }
      const run = { version: 1, id: 'capture-' + report.id, project, variant: scope.variant, item, caseId, viewport, criteriaSha256: plan.criteriaSha256, capturedUtc: new Date().toISOString(), reference: { identity: reference.identity, description: 'Declared draft source manifest before/after; served runtime and actual setup are in original receipts.' }, candidate: { revision: unityRevision(root).revision, inputs }, capture: { width: size.width, height: size.height, safeArea: size.safeArea, setup: entry.recipe.setup, anchors: [] }, outcome: 'unmeasured', observations: entry.criteria.map(criterion => ({ criterion: criterion.id, result: 'unmeasured', note: 'Native stills captured; inspect original fixture/state receipts and evaluate this criterion. No behavioral or timing claim.' })), artifacts, notes: capture.limitations + '\nMatrix review status: ' + row.status + '. Review blockers remain unresolved; this run records collection only.' };
      write(join(out, 'acceptance-run.json'), run); await saveRun(root, project, run); report.status = 'captured-unmeasured'; report.runId = run.id;
    }
  } catch (error: any) { report.status = 'blocked'; report.error = String(error); if (error.record) report.command = error.record; }
  report.finishedUtc = new Date().toISOString();
  for (const name of ['plan.json', 'retained.json', 'review.html', 'acceptance-run.json', 'capture/matrix.json']) if (existsSync(join(out, name))) report.artifacts.push({ path: relative(root, join(out, name)), sha256: hashFile(join(out, name)) });
  journal();
  const index = catalogPath(root, '.helix/acceptance-executions'); mkdirSync(index, { recursive: true }); write(join(index, report.id + '.json'), report);
  return report;
}

/** Execution diagnostics are local receipts, never acceptance decisions. */
export function acceptanceExecutions(root: string, project: string) {
  const directory = catalogPath(root, '.helix/acceptance-executions');
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(name => name.endsWith('.json')).map(name => {
    const path = catalogPath(root, '.helix/acceptance-executions/' + name);
    if (statSync(path).size > 16 * 1024 * 1024) throw new Error('Execution receipt exceeds 16 MiB');
    const record = JSON.parse(readFileSync(path, 'utf8'));
    for (const key of ['id', 'item', 'caseId', 'viewport']) identifier(record[key]);
    if (record.version !== 1 || record.project !== project || name !== record.id + '.json' || !['retained', 'capture'].includes(record.mode) || !['prior-evidence-review', 'recovery-required', 'capture-complete', 'captured-unmeasured', 'blocked'].includes(record.status) || !Array.isArray(record.artifacts)) throw new Error('Invalid execution receipt');
    text(record.finishedUtc); catalogPath(root, record.output); record.artifacts.forEach((file: any) => pin(root, file));
    return record;
  }).sort((a, b) => b.finishedUtc.localeCompare(a.finishedUtc) || b.id.localeCompare(a.id));
}
