import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { portablePath } from './acceptance-format.ts';
import { readDashboard } from './porting-dashboard-format.ts';
import { readComparisonEntry } from './comparison-index-format.ts';

/** Inventory definitions are consumer-owned; evidence and verdicts remain owned by their original stores. */
export function catalogPath(root: string, path: string) {
  portablePath(path);
  const base = realpathSync(root);
  let part = base;
  for (const segment of path.split('/')) {
    part = join(part, segment);
    if (existsSync(part)) {
      const difference = relative(base, realpathSync(part));
      if (difference === '..' || difference.startsWith('..' + sep)) throw new Error('Catalog path escapes checkout: ' + path);
    }
  }
  return part;
}
function read(root: string, path: string) {
  const full = catalogPath(root, path);
  if (statSync(full).size > 32 * 1024 * 1024) throw new Error('Catalog JSON exceeds 32 MiB: ' + path);
  return JSON.parse(readFileSync(full, 'utf8'));
}
function fields(value: any, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error('Invalid catalog fields');
}
function text(value: any) { if (typeof value !== 'string' || !value.trim()) throw new Error('Expected catalog text'); }
function id(value: any) { text(value); if (!/^[a-z0-9][a-z0-9.-]*$/.test(value)) throw new Error('Invalid catalog ID'); }
function strings(value: any, validate: (value: any) => void) {
  if (!Array.isArray(value) || value.length > 1000 || new Set(value).size !== value.length) throw new Error('Invalid or duplicate catalog list');
  value.forEach(validate);
}
export function loadCatalog(root: string, project: string) {
  const catalog = read(root, 'Tools/Helix/catalog/catalog.json');
  fields(catalog, ['version', 'project', 'title', 'sources', 'legacyReport', 'entries', 'exclusions']);
  if (catalog.version !== 1 || catalog.project !== project) throw new Error('Catalog version or project differs');
  text(catalog.title); strings(catalog.exclusions, text); strings(catalog.sources, portablePath); portablePath(catalog.legacyReport);
  if (!Array.isArray(catalog.entries) || catalog.entries.length > 1000) throw new Error('Invalid catalog entries');
  const ids = new Set<string>(), acceptanceIds = new Set<string>();
  for (const entry of catalog.entries) {
    fields(entry, ['id', 'title', 'kind', 'group', 'scope', 'summary', 'sources', 'implementationReferences', 'discrepancies', 'evidence', 'acceptanceItem']);
    id(entry.id); if (ids.has(entry.id)) throw new Error('Duplicate catalog ID'); ids.add(entry.id);
    for (const key of ['title', 'group', 'summary']) text(entry[key]);
    if (!['screen', 'feature', 'scenario', 'fixture'].includes(entry.kind) || !['game', 'tooling', 'reference-only'].includes(entry.scope)) throw new Error('Invalid catalog kind or scope');
    for (const key of ['sources', 'implementationReferences', 'evidence']) strings(entry[key], portablePath);
    strings(entry.discrepancies, id);
    if (entry.acceptanceItem !== null) {
      id(entry.acceptanceItem); if (acceptanceIds.has(entry.acceptanceItem)) throw new Error('Acceptance item mapped more than once'); acceptanceIds.add(entry.acceptanceItem);
    }
  }
  return catalog;
}
export function catalogStatus(root: string, project: string, acceptance: any = null) {
  const catalog = loadCatalog(root, project);
  const legacy = readDashboard(read(root, catalog.legacyReport), project);
  const discrepancies = new Map<string, any>(), warnings: string[] = [];
  const directory = catalogPath(root, 'Tools/Helix/discrepancies');
  if (existsSync(directory)) for (const name of readdirSync(directory).sort()) {
    const folder = catalogPath(root, 'Tools/Helix/discrepancies/' + name);
    if (!statSync(folder).isDirectory()) continue;
    const revisions = readdirSync(folder).filter(file => /^\d+\.json$/.test(file)).sort((a, b) => Number.parseInt(b) - Number.parseInt(a));
    if (!revisions.length) continue;
    const path = 'Tools/Helix/discrepancies/' + name + '/' + revisions[0], record = read(root, path);
    if (record.schemaVersion !== 1 || record.id !== name || !['open', 'blocked', 'resolved', 'accepted-deviation'].includes(record.status)) throw new Error('Invalid discrepancy: ' + path);
    for (const key of ['expected', 'observed']) text(record[key]);
    if (record.nextAction !== undefined) text(record.nextAction);
    if (!Array.isArray(record.evidence)) throw new Error('Missing discrepancy evidence list: ' + path);
    discrepancies.set(name, { ...record, path, revision: Number.parseInt(revisions[0]) });
  }
  const comparisons: any[] = [];
  const comparisonDirectory = catalogPath(root, '.helix/comparisons');
  if (existsSync(comparisonDirectory)) for (const file of readdirSync(comparisonDirectory).filter(file => file.endsWith('.json')).sort()) {
    try { comparisons.push(readComparisonEntry(read(root, '.helix/comparisons/' + file), project)); }
    catch (error) { warnings.push('Comparison index ' + file + ': ' + String(error)); }
  }
  const used = new Set<string>();
  const entries = catalog.entries.map((entry: any) => {
    const result = entry.acceptanceItem === null ? null : acceptance?.items.find((item: any) => item.id === entry.acceptanceItem);
    const discrepancyIds = [...new Set<string>([...entry.discrepancies, ...(result ? result.cases.flatMap((row: any) => row.latestAssessment ? row.latestAssessment.discrepancies : []) : [])])];
    const issues = discrepancyIds.map((key: string) => {
      used.add(key); const record = discrepancies.get(key);
      if (!record) throw new Error('Unknown linked discrepancy: ' + key);
      return { id: key, status: record.status, revision: record.revision, path: record.path, expected: record.expected, observed: record.observed, nextAction: record.nextAction ?? null };
    });
    const previous = legacy.items.find(item => item.id === entry.id);
    const evidence: { path: string; sha256: string | null; origin: string; availability: string }[] = [];
    function artifact(path: string, sha256: string | null, origin: string) {
      text(path); if (sha256 !== null && !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid evidence digest: ' + path);
      // Historical external locators are retained verbatim; only portable paths are read from the checkout.
      let availability = 'external locator';
      if (!path.startsWith('/') && !path.includes(':') && !path.includes('..') && !path.includes('\\')) {
        const file = catalogPath(root, path);
        availability = existsSync(file) && statSync(file).isFile() ? sha256 ? 'local; hash checked on open' : 'local; unpinned' : 'missing locally';
      }
      if (!evidence.some(value => value.path === path && value.sha256 === sha256)) evidence.push({ path, sha256, origin, availability });
    }
    entry.evidence.forEach((path: string) => artifact(path, null, 'catalog'));
    for (const key of discrepancyIds) for (const pin of discrepancies.get(key).evidence) artifact(pin.path, pin.sha256, key);
    if (previous) previous.evidence.forEach(path => artifact(path, null, 'legacy report'));
    if (entry.acceptanceItem !== null && !result) throw new Error('Missing declared acceptance item: ' + entry.acceptanceItem);
    if (result) for (const row of result.cases) {
      if (row.latestAssessment) for (const pin of row.latestAssessment.evidence) artifact(pin.path, pin.sha256, 'agent assessment: ' + row.id + ' / ' + row.viewport);
      if (row.latestExecution) for (const pin of row.latestExecution.artifacts) artifact(pin.path, pin.sha256, 'case execution: ' + row.id + ' / ' + row.viewport);
      if (row.priorEvidence) for (const source of row.priorEvidence.sources) artifact(source.path, null, 'prior case evidence: ' + row.id);
      for (const issue of row.linkedDiscrepancies) artifact(issue.path, null, 'case discrepancy: ' + row.id);
    }
    if (result) for (const row of result.cases) if (row.latestRun) for (const pin of row.latestRun.artifacts) artifact(pin.path, pin.sha256, 'acceptance: ' + row.id + ' / ' + row.viewport);
    return { ...entry, implementation: entry.implementationReferences.length ? 'source located; not a completion verdict' : 'not assessed',
      missingSources: [...entry.sources, ...entry.implementationReferences].filter(path => !existsSync(catalogPath(root, path))),
      issues, evidence, comparisons: comparisons.filter(record => record.links.some((link: any) => link.item === entry.id)),
      legacy: previous ? { status: previous.status, summary: previous.summary, reportedUtc: legacy.reportedUtc } : null,
      acceptance: result ? { status: result.status, required: result.required, accepted: result.accepted, cases: result.cases.length, verified: result.cases.filter((row: any) => row.assessmentAvailable && row.latestAssessment.outcome === 'matched').length, mismatches: result.cases.filter((row: any) => row.assessmentAvailable && row.latestAssessment.outcome === 'mismatch').length, pendingReview: result.cases.filter((row: any) => row.latestRun && row.review === 'pending').length } : null };
  });
  return { format: 'helix-game-catalog', version: 1, project, title: catalog.title, assessedUtc: new Date().toISOString(), sources: catalog.sources, exclusions: catalog.exclusions, entries,
    summary: { total: entries.length, game: entries.filter((entry: any) => entry.scope === 'game').length, definedCoverage: entries.filter((entry: any) => entry.acceptance !== null).length, accepted: entries.filter((entry: any) => entry.acceptance?.status === 'accepted').length, discrepancies: discrepancies.size },
    unmappedDiscrepancies: [...discrepancies.keys()].filter(key => !used.has(key)), unmappedComparisons: comparisons.filter(record => record.links.length === 0 || !record.links.some((link: any) => entries.some((entry: any) => entry.id === link.item))).map(record => record.id), warnings };
}
