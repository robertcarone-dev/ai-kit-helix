import type { AcceptanceReport } from './acceptance-view';
export type PrimaryWorkflow = { id: string; caseId: string; item: string; viewports: string[]; supporting: boolean };
export type PrimaryCase = { id: string; workflowId: string | null; workflows: PrimaryWorkflow[]; viewports: string[]; complete: number; blockers: string[] };
export function primaryCases(report: AcceptanceReport, itemId: string): PrimaryCase[] {
  const item = report.items.find(item => item.id === itemId);
  if (!item) throw new Error('Feature acceptance definition is missing');
  const result = new Map<string, PrimaryCase>();
  for (const row of item.cases.filter(row => row.required)) {
    let current = result.get(row.id);
    if (!current) { current = { id: row.id, workflowId: row.workflowId, workflows: [], viewports: [], complete: 0, blockers: [] }; result.set(row.id, current); }
    current.viewports.push(row.viewport); current.complete += Number(row.accepted);
    if (current.workflowId !== row.workflowId) current.workflowId = null;
    for (const blocker of row.recipe.blockers) if (!current.blockers.includes(blocker)) current.blockers.push(blocker);
    const sources = [{ item: itemId, caseId: row.id, viewport: row.viewport, workflowId: row.workflowId }, ...row.supportingCases];
    for (const source of sources) {
      if (source.workflowId === null) continue;
      const existing = current.workflows.find(workflow => workflow.id === source.workflowId);
      if (existing) { if (!existing.viewports.includes(source.viewport)) existing.viewports.push(source.viewport); }
      else current.workflows.push({ id: source.workflowId, item: source.item, caseId: source.caseId, viewports: [source.viewport], supporting: source.item !== itemId || source.caseId !== row.id });
    }
  }
  return [...result.values()];
}
