import { readFileSync, statSync } from 'node:fs';
import { sha } from './config.ts';
import { readRegisteredComparison } from './comparison-index.ts';
import { reviewSummary } from './review-summary.ts';

/** Read portable review exports, without a deleted mod backend or local account lookup. */
export async function comparisonFeedback(root: string, project: string, id: string, decisionsPath: string) {
  const comparison = readRegisteredComparison(root, project, id);
  if (statSync(comparison.path).size > 48 * 1024 * 1024) throw new Error('Comparison exceeds 48 MiB.');
  const bytes = readFileSync(comparison.path);
  if (bytes.length > 48 * 1024 * 1024 || sha(bytes) !== comparison.sha256) throw new Error('Registered comparison changed. Register the current evidence before reading feedback.');
  const report = await reviewSummary(decisionsPath, comparison.path, project);
  return { comparison: id, links: comparison.links, project, feedback: report.rows, note: report.note };
}
