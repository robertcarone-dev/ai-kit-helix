import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { readEvidence } from './evidence-validation.ts';
import { compareRevisions } from './revision-comparison.ts';

export async function compareRevisionFiles(previous: string, current: string, output: string) {
  if (statSync(previous).size > 48 * 1024 * 1024 || statSync(current).size > 48 * 1024 * 1024) throw new Error('Evidence bundle exceeds 48 MiB.');
  const before = await readEvidence(readFileSync(previous, 'utf8'));
  const after = await readEvidence(readFileSync(current, 'utf8'));
  const report = await compareRevisions(before, after);
  writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' });
  return { out: output, previous: report.previous, current: report.current, changedFiles: report.changes.length, unchangedFiles: report.unchangedFiles, limitedFieldFiles: report.changes.filter(change => change.fieldDetailsLimited).length };
}
