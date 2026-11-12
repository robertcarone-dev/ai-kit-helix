import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha } from './config.ts';

/** Commands use the project's development API; scenario definitions stay in Helix. */
export async function workbench(page: any, req: any, provenance: any) {
  const operation = req.operation;
  if (!['list', 'run', 'reset', 'stop', 'status', 'action', 'checkpoint', 'export'].includes(operation))
    throw new Error('Use workbench list|run|reset|stop|status|action|checkpoint|export.');
  const result = await page.evaluate(async ({ operation, name, level, seed }: any) => {
    const api = (window as any).__portingWorkbench;
    if (!api || api.version !== 1)
      throw new Error('Porting Workbench v1 is unavailable. Enable the project-owned development hooks, then reload the preview.');
    switch (operation) {
      case 'list': return { version: api.version, scenarios: api.scenarios };
      case 'run': return api.run({ scenario: name, level: Number(level), seed: Number(seed) });
      case 'reset': return api.reset();
      case 'stop': return api.stop();
      case 'action': return api.action(name);
      case 'checkpoint': return api.checkpoint(name);
      default: return api.snapshot();
    }
  }, { operation, name: req.name, level: req.level, seed: req.seed });
  if (operation !== 'export') return result;
  if (!result) throw new Error('Run a workbench scenario before exporting.');
  if (!req.out) throw new Error('Workbench export requires --out NEW_DIR.');
  // Exclusive directory creation protects earlier evidence, including empty directories.
  mkdirSync(req.out);
  const bytes = JSON.stringify(result, null, 2) + '\n';
  writeFileSync(join(req.out, 'trace.json'), bytes, { flag: 'wx' });
  const receipt = { schemaVersion: 1, capturedUtc: new Date().toISOString(), ...provenance, runId: result.runId, evidence: [{ path: 'trace.json', sha256: sha(bytes) }] };
  writeFileSync(join(req.out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return { out: req.out, ...receipt };
}
