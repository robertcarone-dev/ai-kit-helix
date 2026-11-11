/** Durable, checkout-owned verification jobs. Project manifests own setup and automation policy. */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync, realpathSync, openSync, closeSync, unlinkSync, accessSync, constants } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { catalogPath, loadCatalog } from './catalog.ts';
import { resolutionDefinitions } from './resolution.ts';
import { loadAcceptance } from './acceptance.ts';
import { criteriaHash, recordHash } from './acceptance-format.ts';
import { isolatedWorkspace } from './isolation.ts';

const activeStates = new Set(['queued', 'running']);
export function automationDefinitions(root: string, project: string) {
  const path = catalogPath(root, 'Tools/Helix/resolutions/automation.json');
  if (!existsSync(path)) return [];
  const document = JSON.parse(readFileSync(path, 'utf8'));
  if (document.version !== 1 || document.project !== project || !Array.isArray(document.workflows) || Object.keys(document).sort().join() !== 'project,version,workflows') throw new Error('Invalid verification automation manifest');
  const definitions = resolutionDefinitions(root, project), catalog = loadCatalog(root, project), ids = new Set();
  return document.workflows.map((workflow: any) => {
    if (!workflow || Object.keys(workflow).sort().join() !== 'id,review,unity' || !['automated', 'human'].includes(workflow.review) || !definitions.some((d: any) => d.id === workflow.id) || ids.has(workflow.id)) throw new Error('Invalid verification workflow');
    ids.add(workflow.id);
    if (Object.keys(workflow.unity).sort().join() !== 'preflightScripts,scene' || !Array.isArray(workflow.unity.preflightScripts) || !workflow.unity.preflightScripts.length) throw new Error('Verification requires authored Unity prerequisites');
    for (const path of [workflow.unity.scene, ...workflow.unity.preflightScripts]) catalogPath(root, path);
    const definition = definitions.find((d: any) => d.id === workflow.id);
    return { ...definition, ...workflow, acceptanceItem: catalog.entries.find((entry: any) => entry.id === definition.item).acceptanceItem };
  });
}
export function jobDirectory(root: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid verification job ID');
  return catalogPath(root, '.helix/workbench-runs/' + id);
}
export function saveJob(root: string, job: any) {
  const path = join(jobDirectory(root, job.id), 'job.json');
  writeFileSync(path + '.tmp', JSON.stringify(job, null, 2) + '\n'); renameSync(path + '.tmp', path);
}
export function latestJob(root: string, finding: string) {
  const directory = catalogPath(root, '.helix/workbench-runs');
  if (!existsSync(directory)) return null;
  const jobs = readdirSync(directory).filter(id => /^[0-9a-f-]{36}$/.test(id)).map(id => JSON.parse(readFileSync(join(directory, id, 'job.json'), 'utf8'))).filter(job => job.finding === finding).sort((a, b) => b.createdUtc.localeCompare(a.createdUtc));
  const job = jobs[0];
  if (!job) return null;
  if (activeStates.has(job.status) && !job.pid && Date.now() - Date.parse(job.createdUtc) > 30000) return { ...job, status: 'interrupted', message: 'Worker startup was not confirmed within 30 seconds. Inspect its journal before recovery; execution locks are retained.' };
  if (activeStates.has(job.status) && job.pid) {
    try { process.kill(job.pid, 0); } catch (error: any) { if (error.code !== 'ESRCH') throw error; return { ...job, status: 'interrupted', message: 'Worker stopped. Inspect the retained journal and restore its owned Editor before clearing execution locks.' }; }
  }
  return job;
}
export function verificationTarget(root: string, project: string, workflow: any) {
  const path = catalogPath(root, '.helix/workbench-execution.json');
  if (!existsSync(path)) throw new Error('Configure an owned isolated checkout in .helix/workbench-execution.json.');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (config.version !== 1 || typeof config.target !== 'string' || !isAbsolute(config.target) || typeof config.unityExecutable !== 'string' || !isAbsolute(config.unityExecutable) || Object.keys(config).sort().join() !== 'target,unityExecutable,version') throw new Error('Invalid local verification target');
  accessSync(config.unityExecutable, constants.X_OK);
  const target = realpathSync(config.target);
  if (target === realpathSync(root) || existsSync(join(target, '.aikit/lane.json')) || !isolatedWorkspace(target)) throw new Error('Workbench requires a dedicated standalone linked worktree, not the receiving checkout or an agent lane.');
  const common = (path: string) => realpathSync(resolve(path, execFileSync('git', ['-C', path, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim()));
  if (common(root) !== common(target)) throw new Error('Verification target belongs to another repository');
  const { scope, screens } = loadAcceptance(root, project), screen = screens.find(s => s.id === workflow.acceptanceItem)!, entry = screen.cases.find(c => c.id === workflow.caseId)!;
  const other = loadAcceptance(target, project), targetScreen = other.screens.find(s => s.id === workflow.acceptanceItem);
  if (!targetScreen || workflow.viewports.some((viewport: string) => criteriaHash(scope, screen, entry, viewport) !== criteriaHash(other.scope, targetScreen, targetScreen.cases.find(c => c.id === workflow.caseId)!, viewport))) throw new Error('Target case definitions differ. Update the dedicated checkout before running.');
  const paths = [...entry.dependencies, ...workflow.unity.preflightScripts, workflow.unity.scene, 'ProjectSettings/ProjectVersion.txt', 'Tools/Helix/toolkit-install.json', 'Tools/Helix/resolutions/automation.json'];
  const changed = [...new Set(paths)].filter(path => recordHash(readFileSync(catalogPath(root, path)).toString('base64')) !== recordHash(readFileSync(catalogPath(target, path)).toString('base64')));
  if (changed.length) throw new Error('Target inputs differ: ' + changed.join(', '));
  return target;
}
export function verificationStatus(root: string, project: string, id: string) {
  const workflow = automationDefinitions(root, project).find((w: any) => w.id === id);
  if (!workflow) return { configured: false as const, job: null, blocker: 'No runnable workflow is declared for this finding.' };
  let target: string | null = null, unityExecutable: string | null = null, blocker: string | null = null;
  try { target = verificationTarget(root, project, workflow); unityExecutable = JSON.parse(readFileSync(catalogPath(root, '.helix/workbench-execution.json'), 'utf8')).unityExecutable; } catch (error) { blocker = String(error); }
  const job = latestJob(root, id);
  if (!blocker && existsSync(catalogPath(root, '.helix/workbench-runs/active.lock')) && (!job || !activeStates.has(job.status))) blocker = 'An execution lock is retained. Inspect its job journal before recovery; no automatic takeover.';
  const { scope, screens } = loadAcceptance(root, project);
  const screen = screens.find(screen => screen.id === workflow.acceptanceItem)!, entry = screen.cases.find(entry => entry.id === workflow.caseId)!;
  const token = recordHash({ workflow, target, unityExecutable, blocker, criteria: workflow.viewports.map((viewport: string) => criteriaHash(scope, screen, entry, viewport)), inputs: entry.dependencies.map(path => [path, recordHash(readFileSync(catalogPath(root, path)).toString('base64'))]) });
  return { configured: true as const, workflow, target, unityExecutable, blocker, token, job };
}
export function startVerification(root: string, referenceRoot: string, project: string, id: string, expectedToken: string) {
  const status = verificationStatus(root, project, id);
  if (!status.configured) throw new Error(status.blocker);
  if (status.token !== expectedToken) throw new Error('Verification setup changed. Refresh before running.');
  if (status.blocker || !status.target || !status.workflow) throw new Error(status.blocker ?? 'Workflow unavailable');
  const jobId = randomUUID(), directory = jobDirectory(root, jobId);
  mkdirSync(join(root, '.helix/workbench-runs'), { recursive: true });
  const lock = join(root, '.helix/workbench-runs/active.lock'), targetLock = join(status.target, '.helix/workbench-execution.lock');
  writeFileSync(lock, JSON.stringify({ jobId }), { flag: 'wx' });
  try { writeFileSync(targetLock, JSON.stringify({ jobId, root }), { flag: 'wx' }); } catch (error) { unlinkSync(lock); throw error; }
  mkdirSync(directory);
  const job: any = { version: 1, id: jobId, finding: id, project, root: realpathSync(root), referenceRoot: realpathSync(referenceRoot), target: status.target, unityExecutable: status.unityExecutable, workflow: status.workflow, setupToken: status.token, status: 'queued', phase: 'Queued', createdUtc: new Date().toISOString(), pid: null, results: [], message: null, closed: false };
  saveJob(root, job);
  const log = openSync(join(directory, 'worker.log'), 'a');
  try {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./verification-worker.ts', import.meta.url)), root, jobId], { cwd: root, detached: true, stdio: ['ignore', log, log] });
    // Spawn errors must leave a visible receipt rather than an unhandled backend exception.
    child.on('error', error => { job.status = 'blocked'; job.message = String(error); saveJob(root, job); });
    child.unref();
  } finally { closeSync(log); }
  return job;
}
