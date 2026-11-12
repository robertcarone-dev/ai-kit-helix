import type { CatalogFolder, CatalogItem, CatalogReport } from './catalog-types.ts';

export function folderPath(folders: CatalogFolder[], id: string | null): CatalogFolder[] {
  if (id === null) return [];
  const folder = folders.find(folder => folder.id === id)!;
  return [...folderPath(folders, folder.parent), folder];
}
export function matchesDiscipline(issue: CatalogItem['issues'][number], discipline: string) {
  return discipline === 'all' || issue.discipline === discipline || (['dev', 'ta'].includes(discipline) && issue.discipline === 'shared');
}
export function selectCatalogEntries(report: CatalogReport, options: { folder?: string; discipline?: string; scope?: string }) {
  if (options.folder !== undefined && !report.folders.some(folder => folder.id === options.folder)) throw new Error('Unknown catalog folder: ' + options.folder);
  if (options.discipline !== undefined && !['all', 'dev', 'ta', 'shared', 'unassigned'].includes(options.discipline)) throw new Error('Invalid work discipline');
  if (options.scope !== undefined && !['all', 'game', 'tooling', 'reference-only'].includes(options.scope)) throw new Error('Invalid catalog scope');
  return report.entries.filter(entry => (options.folder === undefined || folderPath(report.folders, entry.folder).some(folder => folder.id === options.folder)) &&
    (options.scope === undefined || options.scope === 'all' || entry.scope === options.scope) &&
    (options.discipline === undefined || options.discipline === 'all' || entry.issues.some(issue => ['open', 'blocked'].includes(issue.status) && matchesDiscipline(issue, options.discipline!))));
}
