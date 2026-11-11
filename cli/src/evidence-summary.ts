// Shared with the Workbench; adapters are selected by evidence kind and version.
import { capturedBounds, type Inspection, type Observation } from './evidence-validation.ts';
export type SummaryItem = { label: string; side: 'reference' | 'candidate' | 'evidence'; before: string; after: string };
export type EvidenceSummary = { kind: string; schemaVersion: 1; items: SummaryItem[]; limited: boolean; unavailable?: true; note: string };
export type SummaryBudget = { remaining: number };
const known = new Set(['helix-render-inspection', 'helix-evidence-baseline', 'helix-review-preparation']);
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const pin = (value: any) => value && typeof value.path === 'string' && hash(value.sha256);
const text = (value: unknown) => {
  const result = value === undefined ? '(absent)' : typeof value === 'string' ? value : JSON.stringify(value);
  return result.length > 300 ? result.slice(0, 300) + ' … [truncated]' : result;
};
type ObservedValue = { state: 'measured'; value: string } | { state: 'absent' | 'unmeasured' | 'not-applicable' };
function observed(value: Observation | undefined): ObservedValue {
  if (value === undefined) return { state: 'absent' };
  if (value.basis === 'not-applicable') return { state: 'not-applicable' };
  return value.value === null ? { state: 'unmeasured' } : { state: 'measured', value: value.value };
}
function observationText(value: ObservedValue): string {
  if (value.state === 'measured') return text('Measured: ' + JSON.stringify(value.value));
  return value.state === 'absent' ? '(absent)' : value.state === 'not-applicable' ? 'Not applicable' : 'Unmeasured';
}
export function summarizeEvidence(before: any, after: any, budget: SummaryBudget): EvidenceSummary | undefined {
  const record = after === undefined ? before : after;
  if (!record || !known.has(record.kind) || record.schemaVersion !== 1) return undefined;
  if ([before, after].some(value => value !== undefined && (!value || value.kind !== record.kind || value.schemaVersion !== 1))) return undefined;
  const summary: EvidenceSummary = { kind: record.kind, schemaVersion: 1, items: [], limited: false, note: 'Selected schema fields only. Full JSON changes remain under technical details; no automatic parity verdict.' };
  function add<T>(label: string, a: T, b: T, side: SummaryItem['side'] = 'evidence', format: (value: T) => string = text) {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (!budget.remaining) { summary.limited = true; return; }
    budget.remaining--;
    summary.items.push({ label: text(label), side, before: format(a), after: format(b) });
  }
  function unavailable(reason: string) { summary.items = []; summary.unavailable = true; summary.note = reason + ' Use the generic JSON changes.'; return summary; }
  if (record.kind === 'helix-render-inspection') {
    // Version-1 render inspections have already passed the shared bundle validator.
    const a = before as Inspection | undefined, b = after as Inspection | undefined;
    if ([a, b].some(value => value && new Set(value.rows.map(row => row.property)).size !== value.rows.length)) return unavailable('Duplicate rendering properties prevent unambiguous matching.');
    add('Element identity', a?.id, b?.id); add('Review case', a?.reviewCaseId, b?.reviewCaseId);
    add('Coordinate space', a?.coordinateSpace, b?.coordinateSpace);
    for (const side of ['reference', 'candidate'] as const) {
      add('Capture image', a?.images[side], b?.images[side], side);
      const old = new Map(a ? a.rows.map(row => [row.property, row[side]]) : []);
      const next = new Map(b ? b.rows.map(row => [row.property, row[side]]) : []);
      for (const property of [...new Set([...old.keys(), ...next.keys()])].sort()) {
        const av = old.get(property), bv = next.get(property);
        add(property, observed(av), observed(bv), side, observationText);
        add(property + ' — evidence basis', av?.basis, bv?.basis, side);
        if (property === 'Bounds' && a?.id === b?.id && a?.reviewCaseId === b?.reviewCaseId && a?.coordinateSpace === 'native-top-left-pixels' && b?.coordinateSpace === 'native-top-left-pixels') {
          const ab = capturedBounds(av), bb = capturedBounds(bv);
          if (ab && bb) for (const key of ['x', 'y', 'width', 'height'] as const) {
            // Valid finite endpoints can still overflow subtraction at opposite extremes.
            const delta = bb[key] - ab[key];
            if (ab[key] !== bb[key]) add(`Bounds ${key} (native px; delta ${Number.isFinite(delta) ? delta : 'out of range'})`, ab[key], bb[key], side);
          }
        }
      }
    }
    add('Evidence gaps', a?.gaps, b?.gaps);
    add('Related render trace', a?.relatedTrace, b?.relatedTrace);
  } else if (record.kind === 'helix-evidence-baseline') {
    if ([before, after].some(value => value !== undefined && (!['capture', 'unity-capture', 'ui-assets'].includes(value.producer) || !pin(value.image) || !pin(value.receipt) || !Array.isArray(value.dependencies) || value.dependencies.length > 100 || !value.dependencies.every(pin) || new Set(value.dependencies.map((file: any) => file.path)).size !== value.dependencies.length))) return unavailable('Invalid or ambiguous version-1 baseline fields.');
    add('Evidence producer', before?.producer, after?.producer);
    add('Capture image', before?.image.sha256, after?.image.sha256);
    add('Capture receipt', before?.receipt.sha256, after?.receipt.sha256);
    const old = new Map<string, string>(before ? before.dependencies.map((file: any) => [file.path, file.sha256]) : []);
    const next = new Map<string, string>(after ? after.dependencies.map((file: any) => [file.path, file.sha256]) : []);
    for (const path of [...new Set([...old.keys(), ...next.keys()])].sort()) add('Dependency: ' + path, old.get(path), next.get(path));
  } else {
    const status = (value: unknown) => ['current', 'blocked'].includes(value as string);
    if ([before, after].some(value => value !== undefined && (!['ready', 'blocked'].includes(value.status) || !Array.isArray(value.cases) || value.cases.length > 250 || !value.cases.every((item: any) => item && typeof item.id === 'string' && status(item.status) && Array.isArray(item.reasons) && item.reasons.every((reason: unknown) => typeof reason === 'string')) || new Set(value.cases.map((item: any) => item.id)).size !== value.cases.length))) return unavailable('Invalid or ambiguous version-1 preparation fields.');
    add('Preparation status', before?.status, after?.status);
    const old = new Map<string, any>(before ? before.cases.map((item: any) => [item.id, item]) : []);
    const next = new Map<string, any>(after ? after.cases.map((item: any) => [item.id, item]) : []);
    for (const id of [...new Set([...old.keys(), ...next.keys()])].sort()) {
      add('Case ' + id + ' — status', old.get(id)?.status, next.get(id)?.status);
      add('Case ' + id + ' — reasons', old.get(id)?.reasons, next.get(id)?.reasons);
    }
  }
  return summary;
}
