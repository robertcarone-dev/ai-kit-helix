import { archiveEvidence } from './evidence-archive.ts';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { batchDirectory, saveBatch } from './catalog-batch.ts';
import { startVerificationGroup, jobDirectory } from './verification-jobs.ts';
import { recordHash } from './acceptance-format.ts';
const [root, id] = process.argv.slice(2);
const batch = JSON.parse(readFileSync(join(batchDirectory(root, id), 'batch.json'), 'utf8'));
batch.pid = process.pid; batch.status = 'running'; saveBatch(root, batch);
let safe = true;
try {
  const groups = new Map<string, any[]>();
  for (const capture of batch.captures.filter((capture: any) => !capture.blocker)) {
    const key = recordHash({ target: capture.target, unity: capture.unity });
    const group = groups.get(key) ?? []; group.push(capture); groups.set(key, group);
  }
  for (const captures of groups.values()) {
    const requests = new Map<string, { id: string; token: string; viewports: string[] }>();
    for (const capture of captures) {
      const request = requests.get(capture.workflowId) ?? { id: capture.workflowId, token: capture.setupToken, viewports: [] };
      request.viewports.push(capture.viewport); requests.set(capture.workflowId, request);
    }
    const job = startVerificationGroup(root, batch.referenceRoot, batch.project, [...requests.values()], id);
    const group: any = { jobId: job.id, keys: captures.map((capture: any) => capture.key), status: 'running', results: [] };
    batch.groups.push(group); saveBatch(root, batch);
    safe = false;
    let settling = 0;
    for (;;) {
      const current = JSON.parse(readFileSync(join(jobDirectory(root, job.id), 'job.json'), 'utf8'));
      group.status = current.status; group.phase = current.phase; group.results = current.results; group.message = current.message; saveBatch(root, batch);
      if (!['queued', 'running'].includes(current.status) && current.finishedUtc) {
        safe = current.closed && !existsSync(join(root, '.helix/workbench-runs/active.lock')) && !existsSync(join(current.target, '.helix/workbench-execution.lock'));
        // Worker publishes final status before releasing locks; observe its completed cleanup.
        if (current.closed && !safe) { if (++settling > 20) throw new Error('Cleanup locks remain after Editor close; reconcile before resume.'); await new Promise(resolve => setTimeout(resolve, 500)); continue; }
        if (current.status === 'blocked') throw new Error(current.message ?? 'Verification blocked; remaining checks were not run.');
        if (current.results.length) group.archive = archiveEvidence(root, 'Tools/Helix/evidence/verification/' + job.id, true);
        saveBatch(root, batch);
        break;
      }
      if (!current.pid && Date.now() - Date.parse(current.createdUtc) > 30000) throw new Error('Verification worker startup was not confirmed; inspect its locks before resume.');
      if (current.pid) { try { process.kill(current.pid, 0); } catch (error: any) { if (error.code !== 'ESRCH') throw error; throw new Error('Verification worker stopped; reconcile its retained locks before resuming.'); } }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  batch.status = batch.groups.some((group: any) => group.status === 'failed') ? 'failed' : batch.groups.some((group: any) => group.status === 'needs-review') ? 'needs-review' : 'completed';
} catch (error) { batch.status = 'blocked'; batch.message = String(error); }
finally {
  batch.finishedUtc = new Date().toISOString(); saveBatch(root, batch);
  if (safe) { const lock = join(root, '.helix/catalog-batches/active.lock'); if (JSON.parse(readFileSync(lock, 'utf8')).id !== id) throw new Error('Catalog batch lock owner changed'); unlinkSync(lock); }
}
