import { collectionKey } from './capture-identity.ts';
export { collectionKey } from './capture-identity.ts';
/** Catalog-wide collection. Coverage links reuse evidence, never verdicts or human decisions. */
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acceptanceStatus } from './acceptance.ts';
import { catalogPath, catalogStatus } from './catalog.ts';
import { recordHash } from './acceptance-format.ts';
import { loadCaseAdapters } from './acceptance-runner.ts';
import { automationDefinitions, verificationStatus } from './verification-jobs.ts';
import { selectCatalogEntries } from '../workbench/catalog-selection.ts';
import type { ReferenceObservation } from './acceptance-format.ts';

export type BatchSelection = { mode: 'ready' | 'changed'; folder?: string; discipline?: string; scope?: string };
function normalizeSelection(selection: BatchSelection): BatchSelection {
  if (!selection || !['ready', 'changed'].includes(selection.mode) || Object.keys(selection).some(key => !['mode', 'folder', 'discipline', 'scope'].includes(key))) throw new Error('Invalid catalog batch selection');
  return { mode: selection.mode, scope: selection.scope ?? 'game', discipline: selection.discipline ?? 'all', ...(selection.folder === undefined ? {} : { folder: selection.folder }) };
}
export function buildBatchPlan(report: any, catalog: any, adapters: any[], workflows: any[], selection: BatchSelection) {
  selection = normalizeSelection(selection);
  const selected = selectCatalogEntries(catalog, { scope: 'game', ...selection });
  const all = report.items.flatMap((item: any) => item.cases.map((row: any) => ({ ...row, item: item.id })));
  const reusable = new Set(all.filter((row: any) => row.latestRun && row.freshness === 'current' && row.availability === 'available').flatMap((row: any) => {
    const route = adapters.find(route => route.item === row.item && route.caseId === row.id && route.viewport === row.viewport && route.capture !== null);
    return route ? [collectionKey(route)] : [];
  }));
  const rows: any[] = [], captures = new Map<string, any>();
  for (const item of selected) for (const row of all.filter((row: any) => row.item === item.acceptanceItem && row.required)) {
    const sourceKeys = [[row.item, row.id], ...row.supportingCases.map((source: any) => [source.item, source.caseId])];
    const sources = all.filter((source: any) => source.viewport === row.viewport && sourceKeys.some(([item, id]) => source.item === item && source.id === id));
    const routes = sources.flatMap((source: any) => {
      const route = adapters.find(route => route.item === source.item && route.caseId === source.id && route.viewport === source.viewport && route.capture !== null);
      if (!route) return [];
      const workflow = workflows.find(workflow => workflow.acceptanceItem === source.item && workflow.caseId === source.id && workflow.viewports.includes(source.viewport));
      return [{ source, route, workflow }];
    });
    const current = row.latestRun && row.freshness === 'current' && row.availability === 'available';
    const collectedSupport = routes.length > 0 && routes.every(({ route }) => reusable.has(collectionKey(route)));
    const state = row.accepted ? 'complete' : current ? row.verification === 'mismatch' ? 'failed' : row.verification === 'unmeasured' ? 'unmeasured' : row.canAccept ? 'review' : 'gates' : collectedSupport ? 'support-only' : routes.length ? row.latestRun ? 'changed' : 'ready' : 'adapter-missing';
    const linked = row.supportingCases.filter((source: any) => source.latestRun || source.priorEvidence);
    rows.push({ item: row.item, title: item.title, caseId: row.id, viewport: row.viewport, dimension: row.dimension, state, directAdapter: routes.some(({ source }) => source.item === row.item && source.id === row.id), supportingEvidence: linked.length, gates: row.reasons, sources: routes.map(({ source }) => ({ item: source.item, caseId: source.id, viewport: source.viewport })) });
    if (row.accepted || current) continue;
    for (const { source, route, workflow } of routes) {
      if (source.latestRun && source.freshness === 'current' && source.availability === 'available') continue;
      if (selection.mode === 'changed' && !source.latestRun) continue;
      const key = collectionKey(route);
      if (reusable.has(key)) continue;
      const existing = captures.get(key);
      const supports = { item: row.item, caseId: row.id, viewport: row.viewport };
      if (existing) { if (!existing.supports.some((value: any) => recordHash(value) === recordHash(supports))) existing.supports.push(supports); continue; }
      captures.set(key, { key, item: source.item, caseId: source.id, viewport: source.viewport, workflowId: workflow?.id ?? null, unity: workflow?.unity ?? null, capture: route.capture, criteriaSha256: source.criteriaSha256, supports: [supports], blocker: workflow ? null : 'Declare a catalog execution profile.' });
    }
  }
  return { selection, rows, captures: [...captures.values()], summary: { features: selected.length, checks: rows.length, complete: rows.filter(row => row.state === 'complete').length, failed: rows.filter(row => row.state === 'failed').length, review: rows.filter(row => row.state === 'review').length, unmeasured: rows.filter(row => row.state === 'unmeasured').length, missingAdapters: rows.filter(row => row.state === 'adapter-missing' || !row.directAdapter).length, captures: captures.size } };
}
export async function planCatalogBatch(root: string, project: string, selection: BatchSelection, reference?: ReferenceObservation) {
  selection = normalizeSelection(selection);
  const acceptance = await acceptanceStatus(root, project, reference);
  const plan = buildBatchPlan(acceptance, catalogStatus(root, project, acceptance), loadCaseAdapters(root, project), automationDefinitions(root, project), selection);
  const statuses = new Map<string, any>();
  const context = new Map();
  for (const capture of plan.captures) {
    if (!capture.workflowId) continue;
    if (!statuses.has(capture.workflowId)) statuses.set(capture.workflowId, verificationStatus(root, project, capture.workflowId, context));
    const status = statuses.get(capture.workflowId);
    capture.blocker = status.blocker;
    capture.setupToken = status.token;
    capture.target = status.target;
  }
  const signature = plan.captures.map(capture => ({ key: capture.key, workflowId: capture.workflowId, viewport: capture.viewport, criteriaSha256: capture.criteriaSha256, setupToken: capture.setupToken, blocker: capture.blocker }));
  return { ...plan, token: recordHash({ selection, signature }), runnable: plan.captures.filter(capture => !capture.blocker).length, blocked: plan.captures.filter(capture => capture.blocker).length };
}
export function batchDirectory(root: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid catalog batch ID');
  return catalogPath(root, '.helix/catalog-batches/' + id);
}
export function saveBatch(root: string, batch: any) {
  const path = join(batchDirectory(root, batch.id), 'batch.json');
  writeFileSync(path + '.tmp', JSON.stringify(batch, null, 2) + '\n'); renameSync(path + '.tmp', path);
}
export function catalogBatchStatus(root: string, id?: string) {
  const directory = catalogPath(root, '.helix/catalog-batches');
  if (!existsSync(directory)) return null;
  const records = id ? [id] : readdirSync(directory).filter(name => /^[0-9a-f-]{36}$/.test(name));
  const batch = records.map(id => JSON.parse(readFileSync(join(batchDirectory(root, id), 'batch.json'), 'utf8'))).sort((a, b) => b.createdUtc.localeCompare(a.createdUtc))[0];
  if (!batch) return null;
  if (['queued', 'running'].includes(batch.status)) {
    if (batch.pid) {
      try { process.kill(batch.pid, 0); } catch (error: any) { if (error.code !== 'ESRCH') throw error; return { ...batch, status: 'interrupted', message: 'Batch worker stopped. Resume only after its owned verification job has stopped and released its execution locks.' }; }
    } else if (Date.now() - Date.parse(batch.createdUtc) > 30000) return { ...batch, status: 'interrupted', message: 'Batch startup was not confirmed.' };
  }
  return batch;
}
export async function startCatalogBatch(root: string, referenceRoot: string, project: string, selection: BatchSelection, token: string | undefined, reference?: ReferenceObservation, resume?: string) {
  selection = normalizeSelection(selection);
  const plan = await planCatalogBatch(root, project, selection, reference);
  if (token !== undefined && plan.token !== token) throw new Error('Catalog inputs changed. Refresh the batch plan.');
  if (!plan.runnable) throw new Error('No runnable checks in this selection. Inspect adapter/setup gaps.');
  const parent = catalogPath(root, '.helix/catalog-batches'); mkdirSync(parent, { recursive: true });
  const lock = join(parent, 'active.lock');
  if (resume) {
    const previous = catalogBatchStatus(root, resume);
    if (!previous || ['queued', 'running'].includes(previous.status) || recordHash(normalizeSelection(previous.selection)) !== recordHash(selection)) throw new Error('Resume requires a stopped batch with the same selection');
    const targets = new Set(previous.captures.map((capture: any) => capture.target).filter(Boolean));
    if (existsSync(catalogPath(root, '.helix/workbench-runs/active.lock')) || [...targets].some(target => existsSync(join(target as string, '.helix/workbench-execution.lock')))) throw new Error('Reconcile the owned verification job before resuming; execution locks are retained.');
    if (existsSync(lock)) { if (JSON.parse(readFileSync(lock, 'utf8')).id !== resume) throw new Error('Another batch owns execution'); unlinkSync(lock); }
  }
  const id = randomUUID(); writeFileSync(lock, JSON.stringify({ id }), { flag: 'wx' });
  mkdirSync(batchDirectory(root, id));
  const batch = { version: 1, id, project, root, referenceRoot, selection, resumedFrom: resume ?? null, status: 'queued', createdUtc: new Date().toISOString(), pid: null, captures: plan.captures, summary: plan.summary, groups: [] as any[], message: null };
  saveBatch(root, batch);
  const log = openSync(join(batchDirectory(root, id), 'worker.log'), 'a');
  try {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./catalog-batch-worker.ts', import.meta.url)), root, id], { cwd: root, detached: true, stdio: ['ignore', log, log] });
    child.on('error', error => { saveBatch(root, { ...batch, status: 'blocked', message: String(error) }); }); child.unref();
  } finally { closeSync(log); }
  return batch;
}
