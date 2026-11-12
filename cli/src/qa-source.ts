import { recordHash } from './acceptance-format.ts';

/** Archive identity is provenance for an export, never a remotely resolvable AI Kit board ID. */
export type QaSourceOrigin = { kind: 'aikit-local-export'; archiveId: string; label: string };
export function readQaSource(value: any, sha256: string) {
  if (value?.format !== 'helix-qa-source') return { record: value, sourceId: 'sha256:' + sha256, origin: null };
  if (value.version !== 1 || value.origin?.kind !== 'aikit-local-export' || typeof value.origin.archiveId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.origin.archiveId) || typeof value.origin.label !== 'string' || !value.origin.label.trim() || !value.record || typeof value.record !== 'object') throw new Error('Invalid portable QA source');
  return { record: value.record, sourceId: 'sha256:' + sha256, origin: value.origin as QaSourceOrigin };
}
export function exportQaSource(record: unknown, origin: QaSourceOrigin) {
  const value = { format: 'helix-qa-source', version: 1, origin, record };
  readQaSource(value, recordHash(value));
  return value;
}
