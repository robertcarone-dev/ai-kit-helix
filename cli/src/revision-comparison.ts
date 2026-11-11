// Shared with the Workbench (only import extensions differ). Callers validate bundles with readEvidence first.
import type { Bundle, EvidenceFile } from './evidence-validation.ts';
import { summarizeEvidence, type EvidenceSummary } from './evidence-summary.ts';
import { evidenceManifest } from './review-format.ts';

export type ValuePreview = { present: boolean; text: string; truncated: boolean };
export type FieldChange = { pointer: string; before: ValuePreview; after: ValuePreview };
export type FileRevision = { type: 'png' | 'json'; sha256: string; width?: number; height?: number };
export type FileChange = { path: string; change: 'added' | 'removed' | 'modified'; before: FileRevision | null; after: FileRevision | null; fields: FieldChange[]; fieldDetailsLimited?: 'field-count' | 'field-bytes'; summary?: EvidenceSummary };
export type RevisionComparison = { format: 'helix-revision-comparison'; version: 2; previous: string; current: string; unchangedFiles: number; changes: FileChange[] };
// Keep file descriptors even when field details reach their budget. Two 48 MiB
// input bundles can contribute distinct paths; reserve room for those plus details.
export const changeReportLimit = 112 * 1024 * 1024;
const fieldBytesLimit = 8 * 1024 * 1024;
const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(n => n.toString(16).padStart(2, '0')).join('');
function preview(present: boolean, value: unknown): ValuePreview {
  const text = present ? JSON.stringify(value) : '';
  return { present, text: text.slice(0, 2000), truncated: text.length > 2000 };
}
const object = (value: any): value is Record<string, unknown> => value !== null && typeof value === 'object';
function fields(before: unknown, after: unknown, budget: { remaining: number; bytes: number }, hasBefore: boolean, hasAfter: boolean): Pick<FileChange, 'fields' | 'fieldDetailsLimited'> {
  const result: FieldChange[] = [];
  const pending = [{ pointer: '', before, after, hasBefore, hasAfter, depth: 0 }];
  while (pending.length) {
    const item = pending.pop()!;
    if (item.hasBefore && item.hasAfter && JSON.stringify(item.before) === JSON.stringify(item.after)) continue;
    if (item.hasBefore && item.hasAfter && object(item.before) && object(item.after) && Array.isArray(item.before) === Array.isArray(item.after) && item.depth < 32) {
      const keys = [...new Set([...Object.keys(item.before), ...Object.keys(item.after)])].sort().reverse();
      for (const key of keys) pending.push({ pointer: item.pointer + '/' + key.replace(/~/g, '~0').replace(/\//g, '~1'), before: item.before[key], after: item.after[key], hasBefore: Object.hasOwn(item.before, key), hasAfter: Object.hasOwn(item.after, key), depth: item.depth + 1 });
    } else {
      if (!budget.remaining) return { fields: result, fieldDetailsLimited: 'field-count' };
      const change = { pointer: item.pointer, before: preview(item.hasBefore, item.before), after: preview(item.hasAfter, item.after) };
      // Include an allowance for the extra indentation inside the report envelope.
      const bytes = new TextEncoder().encode(JSON.stringify(change, null, 2)).length + 128;
      if (bytes > budget.bytes) return { fields: result, fieldDetailsLimited: 'field-bytes' };
      budget.remaining--; budget.bytes -= bytes;
      result.push(change);
    }
  }
  return { fields: result };
}
function revision(file: EvidenceFile | undefined): FileRevision | null {
  if (!file) return null;
  return file.type === 'png' ? { type: file.type, sha256: file.sha256, width: file.width, height: file.height } : { type: file.type, sha256: file.sha256 };
}
export async function compareRevisions(previous: Bundle, current: Bundle): Promise<RevisionComparison> {
  const before = new Map(previous.files.map(file => [file.path, file]));
  const after = new Map(current.files.map(file => [file.path, file]));
  const changes: FileChange[] = [];
  const budget = { remaining: 2000, bytes: fieldBytesLimit };
  const summaryBudget = { remaining: 1000 };
  let unchangedFiles = 0;
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const a = before.get(path), b = after.get(path);
    if (a && b && a.type === b.type && a.sha256 === b.sha256) { unchangedFiles++; continue; }
    const av = a?.type === 'json' ? JSON.parse(a.data) : undefined;
    const bv = b?.type === 'json' ? JSON.parse(b.data) : undefined;
    const summary = summarizeEvidence(av, bv, summaryBudget);
    changes.push({ path, change: !a ? 'added' : !b ? 'removed' : 'modified', before: revision(a), after: revision(b), ...(a?.type === 'json' || b?.type === 'json' ? fields(av, bv, budget, a?.type === 'json', b?.type === 'json') : { fields: [] }), ...(summary ? { summary } : {}) });
  }
  const report: RevisionComparison = { format: 'helix-revision-comparison', version: 2, previous: await digest(evidenceManifest(previous.files)), current: await digest(evidenceManifest(current.files)), unchangedFiles, changes };
  return report;
}
// Import is checked against recomputed evidence, not trusted merely because hashes are claimed.
export function readRevisionComparison(text: string, expected: RevisionComparison): RevisionComparison {
  if (new TextEncoder().encode(text).length > changeReportLimit) throw new Error('Revision change report exceeds 112 MiB.');
  const value = JSON.parse(text);
  if (!value || value.format !== 'helix-revision-comparison' || ![1, 2].includes(value.version)) throw new Error('Expected a version-1 or version-2 revision comparison.');
  const comparable = value.version === 1 ? { ...expected, version: 1, changes: expected.changes.map(({ summary, ...change }) => change) } : expected;
  const pending: [unknown, unknown][] = [[value, comparable]];
  let matches = true;
  while (pending.length && matches) {
    const [a, b] = pending.pop()!;
    if (object(a) && object(b) && Array.isArray(a) === Array.isArray(b)) {
      const keys = Object.keys(a);
      matches = keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key));
      if (matches) for (const key of keys) pending.push([a[key], b[key]]);
    } else matches = a === b;
  }
  if (!matches) throw new Error('Change report does not match these evidence revisions. Regenerate it with workbench compare-revisions.');
  return expected;
}
