import { captureDependencyPins } from './dependency-pins.ts';
/** Durable, checkout-owned verification jobs. Project manifests own setup and automation policy. */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync, realpathSync, openSync, closeSync, unlinkSync, accessSync, constants } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { catalogPath, loadCatalog } from './catalog.ts';
import { resolutionDefinitions } from './resolution.ts';
import { loadAcceptance } from './acceptance.ts';
import { loadCaseAdapters } from './acceptance-runner.ts';
import { criteriaHash, recordHash } from './acceptance-format.ts';
import { isolatedWorkspace } from './isolation.ts';

const activeStates = new Set(['queued', 'running']);
export function automationDefinitions(root: string, project: string) {
  const path = catalogPath(root, 'Tools/Helix/resolutions/automation.json');
  if (!existsSync(path) && !existsSync(catalogPath(root, 'Tools/Helix/acceptance/execution.json'))) return [];
  const profilePath = catalogPath(root, 'Tools/Helix/acceptance/execution.json');
  const profile = existsSync(profilePath) ? JSON.parse(readFileSync(profilePath, 'utf8')) : null;
  if (profile !== null) {
    if (profile.version !== 1 || profile.project !== project || Object.keys(profile).sort().join() !== 'project,unity,version' || !profile.unity || Object.keys(profile.unity).sort().join() !== 'preflightScripts,scene' || !Array.isArray(profile.unity.preflightScripts) || !profile.unity.preflightScripts.length) throw new Error('Invalid catalog execution profile');
    for (const path of [profile.unity.scene, ...profile.unity.preflightScripts]) catalogPath(root, path);
  }
  const document = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { version: 2, project, workflows: [] };
  if (![1, 2].includes(document.version) || document.project !== project || !Array.isArray(document.workflows) || Object.keys(document).sort().join() !== 'project,version,workflows') throw new Error('Invalid verification automation manifest');
  const definitions = resolutionDefinitions(root, project), catalog = loadCatalog(root, project), { screens } = loadAcceptance(root, project), ids = new Set(), cases = new Set();
  const workflows = document.workflows.map((workflow: any) => {
    const fields = document.version === 1 ? ['id', 'review', 'unity'] : ['id', 'item', 'caseId', 'review', ...(workflow && Object.hasOwn(workflow, 'unity') ? ['unity'] : []), ...(workflow && Object.hasOwn(workflow, 'finding') ? ['finding'] : [])];
    if (!workflow || Object.keys(workflow).sort().join() !== fields.sort().join() || !['automated', 'human'].includes(workflow.review) || typeof workflow.id !== 'string' || !/^[a-z0-9.-]+$/.test(workflow.id) || ids.has(workflow.id)) throw new Error('Invalid verification workflow');
    ids.add(workflow.id);
    if (!Object.hasOwn(workflow, 'unity')) {
      if (profile === null) throw new Error('Workflow requires unity setup or catalog execution profile');
      workflow = { ...workflow, unity: profile.unity };
    }
    if (Object.keys(workflow.unity).sort().join() !== 'preflightScripts,scene' || !Array.isArray(workflow.unity.preflightScripts) || !workflow.unity.preflightScripts.length) throw new Error('Verification requires authored Unity prerequisites');
    for (const path of [workflow.unity.scene, ...workflow.unity.preflightScripts]) catalogPath(root, path);
    const definition = document.version === 1 ? definitions.find((d: any) => d.id === workflow.id) : workflow;
    if (!definition) throw new Error('Invalid verification workflow');
    const item = catalog.entries.find((entry: any) => entry.id === definition.item);
    const screen = screens.find(screen => screen.id === item?.acceptanceItem), entry = screen?.cases.find(entry => entry.id === definition.caseId);
    if (!item || !screen || !entry) throw new Error('Verification requires an existing acceptance case');
    const key = JSON.stringify([screen.id, entry.id]);
    if (cases.has(key)) throw new Error('Duplicate workflow for acceptance case'); cases.add(key);
    const finding = document.version === 1 ? workflow.id : workflow.finding ?? null;
    if (finding !== null && !definitions.some((d: any) => d.id === finding && d.item === item.id && d.caseId === entry.id)) throw new Error('Finding does not belong to workflow case');
    return { ...workflow, item: item.id, title: screen.title, caseId: entry.id, viewports: document.version === 1 ? definition.viewports : entry.viewports, finding, basis: entry.basis.kind, acceptanceItem: screen.id };
  });
  if (profile !== null) {
    const adapters = loadCaseAdapters(root, project);
    for (const route of adapters.filter(route => route.capture !== null)) {
      const key = JSON.stringify([route.item, route.caseId]);
      if (cases.has(key)) continue;
      const screen = screens.find(screen => screen.id === route.item)!, entry = screen.cases.find(entry => entry.id === route.caseId)!;
      const item = catalog.entries.find((item: any) => item.acceptanceItem === screen.id);
      if (!item) continue; // Uncataloged cases are not part of catalog execution.
      const id = 'case.' + recordHash([route.item, route.caseId]).slice(0, 24);
      if (ids.has(id)) throw new Error('Generated workflow ID conflicts with authored workflow'); ids.add(id); cases.add(key);
      const viewports = adapters.filter(other => other.item === route.item && other.caseId === route.caseId && other.capture !== null).map(other => other.viewport);
      workflows.push({ id, item: item.id, title: screen.title, caseId: entry.id, viewports, finding: null, basis: entry.basis.kind, acceptanceItem: screen.id, review: 'human', unity: profile.unity });
    }
  }
  return workflows;
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
  const jobs = readdirSync(directory).filter(id => /^[0-9a-f-]{36}$/.test(id)).map(id => JSON.parse(readFileSync(join(directory, id, 'job.json'), 'utf8'))).filter(job => job.finding === finding || job.workflows?.some((workflow: any) => workflow.id === finding)).sort((a, b) => b.createdUtc.localeCompare(a.createdUtc));
  const job = jobs[0];
  if (!job) return null;
  if (activeStates.has(job.status) && !job.pid && Date.now() - Date.parse(job.createdUtc) > 30000) return { ...job, status: 'interrupted', message: 'Worker startup was not confirmed within 30 seconds. Inspect its journal before recovery; execution locks are retained.' };
  if (activeStates.has(job.status) && job.pid) {
    try { process.kill(job.pid, 0); } catch (error: any) { if (error.code !== 'ESRCH') throw error; return { ...job, status: 'interrupted', message: 'Worker stopped. Inspect the retained journal and restore its owned Editor before clearing execution locks.' }; }
  }
  return job;
}
/** Request-local definition cache for catalog planning; never retained across execution stages. */
export type VerificationContext = Map<string, { definition: ReturnType<typeof loadAcceptance>; workflows: any[]; adapters: ReturnType<typeof loadCaseAdapters> }>;
function workspace(root: string, project: string, context?: VerificationContext) {
  const known = context?.get(root); if (known) return known;
  const value = { definition: loadAcceptance(root, project), workflows: automationDefinitions(root, project), adapters: loadCaseAdapters(root, project) };
  context?.set(root, value); return value;
}
export function verificationTarget(root: string, project: string, workflow: any, context?: VerificationContext) {
  const path = catalogPath(root, '.helix/workbench-execution.json');
  if (!existsSync(path)) throw new Error('Configure an owned isolated checkout in .helix/workbench-execution.json.');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (config.version !== 1 || typeof config.target !== 'string' || !isAbsolute(config.target) || typeof config.unityExecutable !== 'string' || !isAbsolute(config.unityExecutable) || Object.keys(config).sort().join() !== 'target,unityExecutable,version') throw new Error('Invalid local verification target');
  accessSync(config.unityExecutable, constants.X_OK);
  const target = realpathSync(config.target);
  if (target === realpathSync(root) || existsSync(join(target, '.aikit/lane.json')) || !isolatedWorkspace(target)) throw new Error('Workbench requires a dedicated standalone linked worktree, not the receiving checkout or an agent lane.');
  const common = (path: string) => realpathSync(resolve(path, execFileSync('git', ['-C', path, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim()));
  if (common(root) !== common(target)) throw new Error('Verification target belongs to another repository');
  const local = workspace(root, project, context);
  const { scope, screens } = local.definition, screen = screens.find(s => s.id === workflow.acceptanceItem)!, entry = screen.cases.find(c => c.id === workflow.caseId)!;
  const remote = workspace(target, project, context);
  const other = remote.definition, targetScreen = other.screens.find(s => s.id === workflow.acceptanceItem);
  if (!targetScreen || workflow.viewports.some((viewport: string) => criteriaHash(scope, screen, entry, viewport) !== criteriaHash(other.scope, targetScreen, targetScreen.cases.find(c => c.id === workflow.caseId)!, viewport))) throw new Error('Target case definitions differ. Update the dedicated checkout before running.');
  const paths = [...workflow.unity.preflightScripts, workflow.unity.scene, 'ProjectSettings/ProjectVersion.txt', 'Tools/Helix/toolkit-install.json'];
  const changed = [...new Set(paths)].filter(path => recordHash(readFileSync(catalogPath(root, path)).toString('base64')) !== recordHash(readFileSync(catalogPath(target, path)).toString('base64')));
  const targetInputs = captureDependencyPins(target, targetScreen!.cases.find(c => c.id === workflow.caseId)!);
  for (const pin of captureDependencyPins(root, entry)) if (targetInputs.find(other => other.path === pin.path)!.sha256 !== pin.sha256) changed.push(pin.path);
  const routes = (path: string) => workspace(path, project, context).adapters.filter(route => route.item === screen.id && route.caseId === entry.id);
  if (recordHash(routes(root)) !== recordHash(routes(target))) changed.push('Selected case adapters');
  const targetWorkflow = remote.workflows.find((other: any) => other.id === workflow.id);
  if (!targetWorkflow || recordHash({ ...targetWorkflow, viewports: workflow.viewports }) !== recordHash(workflow)) changed.push('Selected verification workflow');
  if (changed.length) throw new Error('Target inputs differ: ' + changed.join(', '));
  return target;
}
export function verificationStatus(root: string, project: string, id: string, context?: VerificationContext) {
  const local = workspace(root, project, context);
  const workflow = local.workflows.find((w: any) => w.id === id);
  if (!workflow) return { configured: false as const, job: null, blocker: 'No runnable workflow is declared for this case.' };
  let target: string | null = null, unityExecutable: string | null = null, blocker: string | null = null;
  try { target = verificationTarget(root, project, workflow, context); unityExecutable = JSON.parse(readFileSync(catalogPath(root, '.helix/workbench-execution.json'), 'utf8')).unityExecutable; } catch (error) { blocker = String(error); }
  if (!blocker && existsSync(catalogPath(root, '.helix/evidence-retention.lock'))) blocker = 'Wait for evidence consolidation before starting verification.';
  const latest = latestJob(root, id);
  const job = latest ? { ...latest, results: latest.results.filter((result: any) => result.item === undefined || (result.item === workflow.acceptanceItem && result.caseId === workflow.caseId)) } : null;
  if (!blocker && existsSync(catalogPath(root, '.helix/workbench-runs/active.lock')) && (!job || !activeStates.has(job.status))) blocker = 'An execution lock is retained. Inspect its job journal before recovery; no automatic takeover.';
  const { scope, screens } = local.definition;
  const screen = screens.find(screen => screen.id === workflow.acceptanceItem)!, entry = screen.cases.find(entry => entry.id === workflow.caseId)!;
  const token = recordHash({ workflow, target, unityExecutable, blocker, adapters: local.adapters.filter(route => route.item === screen.id && route.caseId === entry.id), criteria: workflow.viewports.map((viewport: string) => criteriaHash(scope, screen, entry, viewport)), inputs: captureDependencyPins(root, entry) });
  return { configured: true as const, workflow, target, unityExecutable, blocker, token, job };
}
export function startVerification(root: string, referenceRoot: string, project: string, id: string, expectedToken: string) {
  return startVerificationGroup(root, referenceRoot, project, [{ id, token: expectedToken }]);
}
/** One owned Editor for cases with the same setup. A batch owns admission until it finishes. */
export function startVerificationGroup(root: string, referenceRoot: string, project: string, requests: { id: string; token: string; viewports?: string[] }[], batchId?: string) {
  if (!requests.length || new Set(requests.map(request => request.id)).size !== requests.length) throw new Error('Select distinct verification workflows');
  const batchLock = catalogPath(root, '.helix/catalog-batches/active.lock');
  if (existsSync(batchLock) && JSON.parse(readFileSync(batchLock, 'utf8')).id !== batchId) throw new Error('A catalog batch owns verification. Wait for it to finish.');
  const context: VerificationContext = new Map();
  const statuses = requests.map(request => {
    const status = verificationStatus(root, project, request.id, context);
    if (!status.configured) throw new Error(status.blocker);
    if (status.token !== request.token) throw new Error('Verification setup changed. Refresh before running.');
    if (status.blocker || !status.target) throw new Error(status.blocker ?? 'Workflow unavailable');
    const viewports = request.viewports ?? status.workflow.viewports;
    if (!viewports.length || new Set(viewports).size !== viewports.length || viewports.some(viewport => !status.workflow.viewports.includes(viewport))) throw new Error('Invalid workflow viewport selection');
    return { ...status, workflow: { ...status.workflow, viewports } };
  });
  const first = statuses[0]!;
  if (statuses.some(status => status.target !== first.target || status.unityExecutable !== first.unityExecutable || recordHash(status.workflow.unity) !== recordHash(first.workflow.unity))) throw new Error('Group workflows by checkout and Unity setup');
  const jobId = randomUUID(), directory = jobDirectory(root, jobId);
  mkdirSync(join(root, '.helix/workbench-runs'), { recursive: true });
  const lock = join(root, '.helix/workbench-runs/active.lock'), targetLock = join(first.target!, '.helix/workbench-execution.lock');
  writeFileSync(lock, JSON.stringify({ jobId }), { flag: 'wx' });
  try { writeFileSync(targetLock, JSON.stringify({ jobId, root }), { flag: 'wx' }); } catch (error) { unlinkSync(lock); throw error; }
  mkdirSync(directory);
  const workflows = statuses.map(status => status.workflow);
  const job: any = { version: 1, id: jobId, finding: first.workflow.id, project, root: realpathSync(root), referenceRoot: realpathSync(referenceRoot), target: first.target, unityExecutable: first.unityExecutable, workflow: first.workflow, workflows, setupTokens: Object.fromEntries(statuses.map(status => [status.workflow.id, status.token])), setupToken: first.token, status: 'queued', phase: 'Queued', createdUtc: new Date().toISOString(), pid: null, results: [], message: null, closed: false };
  saveJob(root, job);
  const log = openSync(join(directory, 'worker.log'), 'a');
  try {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./verification-worker.ts', import.meta.url)), root, jobId], { cwd: root, detached: true, stdio: ['ignore', log, log] });
    child.on('error', error => { job.status = 'blocked'; job.message = String(error); saveJob(root, job); }); child.unref();
  } finally { closeSync(log); }
  return job;
}
