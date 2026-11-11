export type ComparisonLink = { item: string; issue?: string };
export const issueKey = (issue: { tool: string; message: string; action: string }) => JSON.stringify([issue.tool, issue.message, issue.action]);
export type ComparisonEntry = { version: 1; project: string; id: string; path: string; sha256: string; createdUtc: string; cases: string[]; preparation: 'ready' | 'unmeasured'; links: ComparisonLink[] };
export function readComparisonEntry(value: any, project: string): ComparisonEntry {
  if (!value || value.version !== 1 || value.project !== project || typeof value.id !== 'string' || !/^[a-f0-9]{64}$/.test(value.id) || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.path !== 'string' || !value.path.startsWith('/') || typeof value.createdUtc !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value.createdUtc) || !Array.isArray(value.cases) || value.cases.length > 20 || !value.cases.every((id: unknown) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) || !['ready', 'unmeasured'].includes(value.preparation)) throw new Error('Invalid registered comparison. Prepare it again with the CLI.');
  const links = value.links === undefined ? [] : value.links;
  if (!Array.isArray(links) || links.length > 50 || !links.every(link => link && typeof link.item === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(link.item) && (link.issue === undefined || typeof link.issue === 'string' && link.issue.length > 0 && link.issue.length <= 8192))) throw new Error('Invalid comparison links.');
  return { ...value, links };
}
