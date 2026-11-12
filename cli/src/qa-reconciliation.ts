import { readQaSource, type QaSourceOrigin } from './qa-source.ts';
/** Scoped imports of existing QA verdicts. These are attestations, never fabricated capture runs. */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { catalogPath } from './catalog.ts';
import { digest, identifier, recordHash } from './acceptance-format.ts';
import type { AcceptanceCase, Scope, Screen } from './acceptance-format.ts';

export type QaBinding = { item: string; caseId: string; viewport: string; definitionSha256: string; coverage: 'full' | 'partial' | 'none'; note: string; gaps: string[]; sources: { path: string; sha256: string; cases: number[]; context?: boolean }[]; testedRevision: string | null; inputs: { path: string; sha256: string }[]; inputReviews?: { path: string; before: string; after: string; reason: string }[]; findings: { id: string; path: string; sha256: string; disposition: string }[] };
export type QaDocument = { version: 1; id: string; project: string; reconciledUtc: string; reviewer: string; bindings: QaBinding[] };
const directory = 'Tools/Helix/acceptance/qa-reconciliations';
export function qaDefinition(scope: Scope, screen: Screen, entry: AcceptanceCase, viewport: string) {
  // A changed capture recipe does not revoke a QA verdict about unchanged product requirements.
  return recordHash({ project: scope.project, variant: scope.variant, item: screen.id, caseId: entry.id, criteria: entry.criteria, basis: entry.basis, viewport: scope.viewports.find(value => value.id === viewport) });
}
export function qaInputs(screen: Screen, entry: AcceptanceCase) {
  return [...new Set([...screen.implementationReferences, ...entry.dependencies].filter(path => /^(Assets|Packages|ProjectSettings)\//.test(path) && !path.includes('/Editor/')))].sort();
}
function text(value: any) { if (typeof value !== 'string' || !value.trim()) throw new Error('QA reconciliation requires nonempty text'); }
function pin(value: any) { if (!value || typeof value.path !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('Invalid QA pin'); }
export function readQaDocument(root: string, project: string, value: any): QaDocument {
  if (!value || value.version !== 1 || value.project !== project || !Array.isArray(value.bindings) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.reconciledUtc)) throw new Error('Invalid QA reconciliation');
  identifier(value.id); text(value.reviewer);
  const keys = new Set<string>();
  for (const binding of value.bindings) {
    identifier(binding.item); identifier(binding.caseId); identifier(binding.viewport); text(binding.note);
    const key = JSON.stringify([binding.item, binding.caseId, binding.viewport]);
    if (keys.has(key) || !/^[a-f0-9]{64}$/.test(binding.definitionSha256) || !['full', 'partial', 'none'].includes(binding.coverage)) throw new Error('Invalid or duplicate QA binding'); keys.add(key);
    if (!Array.isArray(binding.sources) || !Array.isArray(binding.inputs) || !Array.isArray(binding.findings) || !Array.isArray(binding.gaps)) throw new Error('Invalid QA binding collections');
    binding.gaps.forEach(text);
    if (binding.coverage === 'full' && (!binding.sources.length || binding.gaps.length || !binding.inputs.length || !/^[a-f0-9]{40}$/.test(binding.testedRevision))) throw new Error('Full QA coverage requires sources, tested revision, input pins and no remaining gaps');
    if (binding.coverage !== 'full' && !binding.gaps.length) throw new Error('Partial QA coverage requires an explicit gap');
    for (const source of binding.sources) { pin(source); if (source.context !== undefined && typeof source.context !== 'boolean') throw new Error('Invalid QA source context'); catalogPath(root, source.path); if (!Array.isArray(source.cases) || !source.cases.length || source.cases.some((id: any) => !Number.isInteger(id) || id < 1)) throw new Error('QA source requires exact case IDs'); }
    if (binding.inputReviews !== undefined) { if (!Array.isArray(binding.inputReviews)) throw new Error('Invalid QA input reviews'); for (const review of binding.inputReviews) { text(review.reason); catalogPath(root, review.path); if (!/^[a-f0-9]{64}$/.test(review.before) || !/^[a-f0-9]{64}$/.test(review.after) || !binding.inputs.some((input: any) => input.path === review.path && input.sha256 === review.before)) throw new Error('QA input review must name an original pin'); } }
    for (const input of binding.inputs) { pin(input); catalogPath(root, input.path); }
    for (const finding of binding.findings) { pin(finding); identifier(finding.id); text(finding.disposition); catalogPath(root, finding.path); }
  }
  return value;
}
export function loadQaReconciliation(root: string, project: string) {
  const path = catalogPath(root, directory);
  if (!existsSync(path)) return null;
  const documents = readdirSync(path).filter(name => name.endsWith('.json')).map(name => readQaDocument(root, project, JSON.parse(readFileSync(catalogPath(root, directory + '/' + name), 'utf8')))).sort((a, b) => b.reconciledUtc.localeCompare(a.reconciledUtc));
  if (documents.length > 1 && documents[0].reconciledUtc === documents[1].reconciledUtc) throw new Error('Ambiguous QA reconciliation head');
  return documents[0] ?? null;
}
export function evaluateQa(root: string, document: QaDocument | null, scope: Scope, screen: Screen, entry: AcceptanceCase, viewport: string) {
  const binding = document?.bindings.find(value => value.item === screen.id && value.caseId === entry.id && value.viewport === viewport);
  if (!binding) return null;
  const reasons = [...binding.gaps], reports: { sourceId: string; origin: QaSourceOrigin | null; key: string; caseId: number; name: string; status: string; note: string; at: string; context: boolean }[] = [];
  let invalid = false, changed = false, failed = false;
  if (binding.definitionSha256 !== qaDefinition(scope, screen, entry, viewport)) { reasons.push('Product acceptance requirements changed since QA reconciliation'); changed = true; }
  for (const source of binding.sources) {
    const path = catalogPath(root, source.path);
    if (!existsSync(path) || digest(readFileSync(path)) !== source.sha256) { reasons.push('QA source missing or changed: ' + source.path); invalid = true; continue; }
    const { record, sourceId, origin } = readQaSource(JSON.parse(readFileSync(path, 'utf8')), source.sha256);
    if (!/^AK-[1-9][0-9]*$/.test(record.key) || !Array.isArray(record.cases) || !['story', 'task'].includes(record.kind) || (record.kind === 'task' && !record.test) || (record.kind === 'story' && !record.signOff?.lastVerdict)) throw new Error('QA source has no submitted verdict: ' + source.path);
    for (const caseId of source.cases) {
      const qaCase = record.cases.find((value: any) => value.id === caseId);
      if (!qaCase || !Array.isArray(qaCase.results) || !qaCase.results.length) throw new Error('QA source case has no result: ' + source.path + '#' + caseId);
      const result = qaCase.results.at(-1);
      if (!['passed', 'failed', 'blocked', 'unmeasured'].includes(result.status) || typeof result.note !== 'string' || typeof result.at !== 'string') throw new Error('Invalid QA case result');
      const verdictAt = record.kind === 'task' ? record.test.at : record.signOff.lastVerdict.at;
      if (typeof verdictAt !== 'string' || result.at > verdictAt) throw new Error('QA result has not been included in a submitted verdict');
      reports.push({ sourceId, origin, key: record.key, caseId, name: qaCase.name, status: result.status, note: result.note, at: result.at, context: source.context === true });
      if (!source.context && result.status !== 'passed') reasons.push(`${record.key} case ${caseId}: ${result.status}: ${result.note}`);
      if (!source.context && result.status === 'failed') failed = true;
      // Done means the QA task finished, not that it passed. Individual scoped passes can survive a failed report.
    }
  }
  if (binding.coverage === 'full') {
    if (JSON.stringify(binding.inputs.map(value => value.path).sort()) !== JSON.stringify(qaInputs(screen, entry))) { reasons.push('QA input ownership changed'); changed = true; }
    for (const input of binding.inputs) { const path = catalogPath(root, input.path); if (!existsSync(path) || (digest(readFileSync(path)) !== input.sha256 && !binding.inputReviews?.some(review => review.path === input.path && review.before === input.sha256 && review.after === digest(readFileSync(path))))) { reasons.push('Product input changed since tested revision: ' + input.path); changed = true; } }
    for (const id of entry.discrepancies) {
      const disposition = binding.findings.find(value => value.id === id);
      const folder = catalogPath(root, 'Tools/Helix/discrepancies/' + id);
      const latest = existsSync(folder) ? readdirSync(folder).filter(name => /^\d+\.json$/.test(name)).sort((a, b) => parseInt(b) - parseInt(a))[0] : undefined;
      const path = latest ? 'Tools/Helix/discrepancies/' + id + '/' + latest : null;
      if (!disposition || path !== disposition.path || digest(readFileSync(catalogPath(root, disposition.path))) !== disposition.sha256) { reasons.push('Finding requires reconciliation: ' + id); changed = true; }
    }
  }
  const accepted = binding.coverage === 'full' && reasons.length === 0 && reports.some(report => !report.context && report.status === 'passed');
  return { id: document!.id, coverage: binding.coverage, accepted, status: invalid ? 'unavailable' : changed ? 'changed' : failed ? 'failed' : accepted ? 'accepted' : 'gap', note: binding.note, reasons, reports, sources: binding.sources, testedRevision: binding.testedRevision, reconciledUtc: document!.reconciledUtc, reviewer: document!.reviewer, inputReviews: binding.inputReviews ?? [] };
}
export function saveQaReconciliation(root: string, project: string, value: unknown, scope: Scope, screens: Screen[], supplemental: Map<string, unknown>) {
  const document = readQaDocument(root, project, value);
  const required = screens.flatMap(screen => screen.cases.filter(entry => entry.required && !supplemental.has(JSON.stringify([screen.id, entry.id]))).flatMap(entry => entry.viewports.map(viewport => ({ screen, entry, viewport }))));
  if (document.bindings.length !== required.length) throw new Error('Reconciliation must disposition every primary case/viewport exactly once');
  for (const { screen, entry, viewport } of required) {
    const binding = document.bindings.find(value => value.item === screen.id && value.caseId === entry.id && value.viewport === viewport);
    if (!binding || binding.definitionSha256 !== qaDefinition(scope, screen, entry, viewport)) throw new Error('Missing or stale QA target');
    const result = evaluateQa(root, document, scope, screen, entry, viewport)!;
    if (result.status === 'unavailable') throw new Error(result.reasons.join('; '));
    if (binding.coverage === 'full') {
      if (!result.reports.some(report => !report.context && report.status === 'passed') || result.reports.some(report => !report.context && report.status !== 'passed')) throw new Error('Full coverage cites a non-passing QA result');
      execFileSync('git', ['merge-base', '--is-ancestor', binding.testedRevision!, 'HEAD'], { cwd: root });
      for (const input of binding.inputs) {
        const bytes = execFileSync('git', ['show', binding.testedRevision + ':' + input.path], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
        if (digest(bytes) !== input.sha256) throw new Error('QA input pin differs from tested revision: ' + input.path);
      }
    }
  }
  const folder = catalogPath(root, directory); mkdirSync(folder, { recursive: true });
  const path = catalogPath(root, directory + '/' + document.id + '.json');
  if (existsSync(path)) { if (recordHash(JSON.parse(readFileSync(path, 'utf8'))) !== recordHash(document)) throw new Error('Immutable QA reconciliation already exists'); return { status: 'unchanged', path }; }
  const lock = catalogPath(root, directory + '/.write.lock'), temporary = path + '.tmp';
  writeFileSync(lock, document.id, { flag: 'wx' });
  try {
    if (existsSync(path)) throw new Error('QA reconciliation was concurrently created');
    writeFileSync(temporary, JSON.stringify(document, null, 2) + '\n', { flag: 'wx' });
    renameSync(temporary, path);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); unlinkSync(lock); }
  return { status: 'saved', path, bindings: document.bindings.length };
}

/** QA cases are shared evidence, while acceptance rows are requirement/viewport obligations. */
export function summarizeQa(rows: { required: boolean; accepted: boolean; qa: ReturnType<typeof evaluateQa> }[]) {
  const primary = rows.filter(row => row.required), reports = new Map<string, NonNullable<ReturnType<typeof evaluateQa>>['reports'][number]>();
  for (const row of primary) for (const report of row.qa?.reports ?? []) {
    if (report.context) continue;
    const key = report.sourceId + ':' + report.caseId, previous = reports.get(key);
    if (!previous || report.at > previous.at) reports.set(key, report);
  }
  const evidence = [...reports.values()];
  return { requirements: primary.length, accepted: primary.filter(row => row.accepted).length, partiallySupported: primary.filter(row => !row.accepted && row.qa?.reports.some(report => !report.context && report.status === 'passed')).length, sourceCases: evidence.length, passed: evidence.filter(report => report.status === 'passed').length, failed: evidence.filter(report => report.status === 'failed').length, blocked: evidence.filter(report => report.status === 'blocked').length, unmeasured: evidence.filter(report => report.status === 'unmeasured').length };
}
