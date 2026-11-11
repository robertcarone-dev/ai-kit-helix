import { loadCatalog } from './catalog.ts';
import { mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha } from './config.ts';
import { readEvidence } from './evidence-validation.ts';
import { portingDashboard } from './porting-dashboard.ts';
import { readComparisonEntry, issueKey, type ComparisonLink } from './comparison-index-format.ts';

/** Only preparation receipts supply status; unrelated JSON remains ordinary evidence. */
function preparationMetadata(value: unknown): { cases: string[]; preparation: 'ready' | 'unmeasured' } {
  if (!value || typeof value !== 'object' || !('kind' in value) || value.kind !== 'helix-review-preparation') return { cases: [], preparation: 'unmeasured' };
  const receipt = value as { schemaVersion?: unknown; status?: unknown; cases?: unknown };
  if (receipt.schemaVersion !== 1 || !['ready', 'blocked'].includes(receipt.status as string) || !Array.isArray(receipt.cases) || receipt.cases.length > 20 || (receipt.status === 'ready' && !receipt.cases.length)) throw new Error('Invalid version-1 preparation metadata in freshness.json.');
  const cases: string[] = [];
  for (const item of receipt.cases) {
    if (!item || typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(item.id) || cases.includes(item.id) || !['current', 'blocked'].includes(item.status) || (receipt.status === 'ready' && item.status !== 'current')) throw new Error('Invalid preparation case in freshness.json.');
    cases.push(item.id);
  }
  return { cases, preparation: receipt.status === 'ready' ? 'ready' : 'unmeasured' };
}

/** One atomic record per bundle: concurrent preparations do not replace each other's inventory. */
export async function registerComparison(root: string, project: string, bundlePath: string, links: ComparisonLink[] = []) {
  const path = realpathSync(bundlePath);
  if (statSync(path).size > 48 * 1024 * 1024) throw new Error('Comparison exceeds 48 MiB.');
  const bytes = readFileSync(path);
  if (bytes.length > 48 * 1024 * 1024) throw new Error('Comparison exceeds 48 MiB.');
  const bundle = await readEvidence(bytes.toString('utf8'));
  const freshnessFile = bundle.files.find(file => file.path === 'freshness.json' && file.type === 'json');
  const metadata = preparationMetadata(freshnessFile ? JSON.parse(freshnessFile.data) : null);
  const id = sha(Buffer.from(path));
  const directory = join(root, '.helix', 'comparisons');
  mkdirSync(directory, { recursive: true });
  const lock = join(directory, id + '.lock');
  try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); }
  catch (error) { throw new Error('Could not lock comparison registration. Retry after its writer finishes; investigate a retained .lock after an interrupted writer. ' + String(error)); }
  try {
    const previous = join(root, '.helix', 'comparisons', id + '.json');
    const priorLinks = existsSync(previous) ? readRegisteredComparison(root, project, id).links : [];
    const combined = [...new Map([...priorLinks, ...links].map(link => [JSON.stringify(link), link])).values()];
    const entry = readComparisonEntry({ links: combined, version: 1, project, id, path, sha256: sha(bytes), createdUtc: bundle.createdUtc, ...metadata }, project);
    const registration = JSON.stringify(entry, null, 2) + '\n';
    if (Buffer.byteLength(registration) > 16384) throw new Error('Comparison registration exceeds 16 KiB.');
    const target = join(directory, entry.id + '.json'), temporary = target + '.' + randomUUID() + '.tmp';
    try { writeFileSync(temporary, registration, { flag: 'wx' }); renameSync(temporary, target); }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
    return entry;
  } finally { unlinkSync(lock); }
}

export function readRegisteredComparison(root: string, project: string, id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid comparison ID.');
  const path = join(root, '.helix', 'comparisons', id + '.json');
  if (statSync(path).size > 16384) throw new Error('Comparison registration exceeds 16 KiB.');
  const entry = readComparisonEntry(JSON.parse(readFileSync(path, 'utf8')), project);
  if (entry.id !== id) throw new Error('Comparison registration ID mismatch.');
  return entry;
}
export function comparisonLinks(root: string, project: string, item?: string, issue?: string): ComparisonLink[] {
  if (!item) { if (issue) throw new Error('--issue requires --item.'); return []; }
  const result = portingDashboard(root, project);
  const row = result.report?.items.find(row => row.id === item);
  const catalogItem = !row && existsSync(join(root, 'Tools/Helix/catalog/catalog.json')) && loadCatalog(root, project).entries.some((entry: any) => entry.id === item);
  if (!row && !catalogItem) throw new Error('Unknown dashboard item or catalog entry: ' + item);
  if (issue === undefined) return [{ item }];
  if (!row || !/^[1-9][0-9]*$/.test(issue) || !row.issues[Number(issue) - 1]) throw new Error('--issue requires a current 1-based issue number for this item.');
  return [{ item, issue: issueKey(row.issues[Number(issue) - 1]) }];
}
export async function comparisons(root: string, project: string, evidence?: string, item?: string, issue?: string, fromReport = false) {
  if (fromReport) {
    const result = portingDashboard(root, project);
    if (!result.report) throw new Error('Publish a dashboard report first.');
    const registered = [], errors = [];
    for (const row of result.report.items) for (const reference of row.evidence) {
      if (basename(reference) !== 'evidence.json') continue;
      try { registered.push(await registerComparison(root, project, resolve(root, reference), [{ item: row.id }])); }
      catch (error) { errors.push({ item: row.id, path: reference, error: String(error) }); }
    }
    return { registered, errors };
  }
  if (evidence) return { registered: await registerComparison(root, project, resolve(root, evidence), comparisonLinks(root, project, item, issue)) };
  if (issue) throw new Error('--issue requires --evidence.');
  const directory = join(root, '.helix', 'comparisons');
  const entries = existsSync(directory) ? readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => readRegisteredComparison(root, project, name.slice(0, -5))) : [];
  return { comparisons: entries.filter(entry => !item || entry.links.some(link => link.item === item)).sort((a, b) => b.createdUtc.localeCompare(a.createdUtc)) };
}
