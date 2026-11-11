/** Shared dashboard boundary: the CLI owns reports; the mod only reads them. */
export const dashboardLimit = 1024 * 1024;
export const portingStates = ['helix-only', 'in-progress', 'ported', 'out-of-date', 'blocked'] as const;
export type PortingState = typeof portingStates[number];
export interface PortingIssue { severity: 'error' | 'warning'; message: string; action: string; tool: 'helix-cli' | 'unity' | 'aikit' | 'helix' | 'other' }
export interface PortingItem { id: string; kind: 'feature' | 'screen' | 'fixture' | 'scenario'; title: string; status: PortingState; summary: string; issues: PortingIssue[]; evidence: string[] }
export interface PortingDashboard { format: 'helix-porting-dashboard'; version: 1; project: string; reportedUtc: string; items: PortingItem[] }
export function readDashboard(value: unknown, project: string): PortingDashboard {
  function object(value: unknown, keys: string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Dashboard entries must be objects.');
    if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('Unknown dashboard field.');
    return value as Record<string, unknown>;
  }
  function text(value: unknown, field: string, limit = 2000): string {
    if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`${field} must be nonempty text of at most ${limit} characters.`);
    return value;
  }
  const data = object(value, ['format', 'version', 'project', 'reportedUtc', 'items']);
  if (data.format !== 'helix-porting-dashboard' || data.version !== 1 || data.project !== project) throw new Error(`Expected a version 1 dashboard for ${project}.`);
  const reportedUtc = text(data.reportedUtc, 'reportedUtc');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(reportedUtc) || new Date(reportedUtc).toISOString() !== reportedUtc) throw new Error('reportedUtc must be an ISO UTC timestamp.');
  if (!Array.isArray(data.items) || data.items.length > 1000) throw new Error('Dashboard items must be an array of at most 1000 entries.');
  const ids = new Set<string>();
  const items = data.items.map(input => {
    const row = object(input, ['id', 'kind', 'title', 'status', 'summary', 'issues', 'evidence']);
    const id = text(row.id, 'id', 128);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(id) || ids.has(id)) throw new Error('Dashboard IDs must be unique identifiers.');
    ids.add(id);
    if (!['feature', 'screen', 'fixture', 'scenario'].includes(row.kind as string)) throw new Error('Unknown dashboard item kind.');
    if (!portingStates.includes(row.status as PortingState)) throw new Error('Unknown porting status.');
    if (!Array.isArray(row.issues) || row.issues.length > 50 || !Array.isArray(row.evidence) || row.evidence.length > 50) throw new Error('Each item requires issues and evidence arrays, with at most 50 entries each.');
    const issues = row.issues.map(input => {
      const issue = object(input, ['severity', 'message', 'action', 'tool']);
      if (!['error', 'warning'].includes(issue.severity as string) || !['helix-cli', 'unity', 'aikit', 'helix', 'other'].includes(issue.tool as string)) throw new Error('Unknown issue severity or tool.');
      return { severity: issue.severity, tool: issue.tool, message: text(issue.message, 'Issue message'), action: text(issue.action, 'Issue action') } as PortingIssue;
    });
    if (['blocked', 'out-of-date'].includes(row.status as string) && !issues.length) throw new Error('Blocked and out-of-date items require an issue explaining the next action.');
    return { id, kind: row.kind, title: text(row.title, 'title', 160), status: row.status, summary: text(row.summary, 'summary'), issues, evidence: row.evidence.map(entry => text(entry, 'Evidence reference')) } as PortingItem;
  });
  return { format: 'helix-porting-dashboard', version: 1, project, reportedUtc, items };
}
