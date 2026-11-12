import { retainRunArtifacts } from './evidence-retention.ts';
import { readFileSync, writeFileSync, existsSync, readdirSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { jobDirectory, saveJob, verificationTarget, verificationStatus } from './verification-jobs.ts';
import { runCommand } from './ui-runner.ts';
import { saveRun } from './acceptance.ts';
import { recordHash } from './acceptance-format.ts';
import { resolutionStatus } from './resolution.ts';
import { referenceObservation } from './acceptance-backend.ts';

const [root, id] = process.argv.slice(2), directory = jobDirectory(root, id);
const job = JSON.parse(readFileSync(join(directory, 'job.json'), 'utf8'));
process.env.PATH = dirname(job.unityExecutable) + ':' + process.env.PATH;
job.pid = process.pid; job.status = 'running'; saveJob(root, job);
const workflows = job.workflows ?? [job.workflow];
const setupToken = (workflow: any) => job.setupTokens ? job.setupTokens[workflow.id] : job.setupToken;
const findings = new Map<string, any>();
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url));
let commandIndex = 0, opened = false, launchAttempted = false, cleanupFailed = false, commandUncertain = false;
function phase(value: string) { job.phase = value; saveJob(root, job); }
async function command(program: string, args: string[], timeout = 90000) {
  let receipt;
  try { receipt = await runCommand(program, args, root, timeout); }
  catch (error: any) {
    if (error.record) {
      writeFileSync(join(directory, `command-${++commandIndex}.json`), JSON.stringify(error.record, null, 2));
      commandUncertain ||= error.record.timedOut;
      try { const payload = JSON.parse(error.record.stdout); commandUncertain ||= /timed out|timeout|ETIMEDOUT/i.test(JSON.stringify([payload.errors, payload.error, payload.data?.result?.error])); }
      catch { commandUncertain = true; }
    }
    throw error;
  }
  writeFileSync(join(directory, `command-${++commandIndex}.json`), JSON.stringify(receipt, null, 2));
  let response;
  try { response = JSON.parse(receipt.stdout); } catch (error) { commandUncertain = true; throw error; }
  if (response.success === false || response.data?.result?.success === false) throw new Error(JSON.stringify(response));
  return response;
}
const unity = (args: string[], timeout?: number) => command(job.unityExecutable, [...args, '--format', 'json', '--non-interactive'], timeout);
const evaluate = (code: string) => unity(['command', 'eval', '--project-path', job.target, '--caller', 'plugin', '--skill', 'unity-cli', '--timeout', '75', '--code', code]);
function noSymlinks(path: string) {
  if (lstatSync(path).isSymbolicLink()) throw new Error('Capture evidence cannot contain symlinks');
  if (lstatSync(path).isDirectory()) for (const name of readdirSync(path)) noSymlinks(join(path, name));
}
try {
  phase('Checking isolated checkout');
  const planningContext = new Map();
  for (const workflow of workflows) {
    if (verificationStatus(root, job.project, workflow.id, planningContext).token !== setupToken(workflow)) throw new Error('Verification setup changed after queueing.');
    verificationTarget(root, job.project, workflow, planningContext);
    if (workflow.finding !== null) findings.set(workflow.id, resolutionStatus(root, job.project, workflow.finding));
  }
  // A missing lock or an empty Pipeline response alone never establishes ownership.
  const processes = execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8' });
  if (processes.split('\n').some(line => /(?:\/Unity |Unity\.exe )/.test(line) && line.includes('-projectPath ' + job.target)) || existsSync(join(job.target, 'Temp/UnityLockfile'))) throw new Error('The dedicated checkout already has an Editor or lock. Close it before running; Workbench never borrows an Editor.');
  const status = await runCommand(job.unityExecutable, ['status', '--project-path', job.target, '--format', 'json', '--non-interactive'], root).catch((error: any) => {
    if (!error.record) throw error;
    const response = JSON.parse(error.record.stdout);
    if (response.errors?.[0]?.code !== 'STATUS_NO_INSTANCES') throw error;
    return error.record;
  });
  const inventory = JSON.parse(status.stdout);
  if (inventory.success || inventory.data?.count > 0) throw new Error('An Editor already owns the verification checkout.');
  if (existsSync(join(job.target, '.helix/ui-matrix.lock')) || existsSync(join(job.target, '.helix/unity-reconciliation.json'))) throw new Error('The capture adapter has a retained session. Restore it before starting a new Workbench run.');
  phase('Starting isolated Editor');
  launchAttempted = true;
  const launch = await unity(['open', job.target, '--until-ready', '--timeout', '180', '--args', '-logFile ' + JSON.stringify(join(directory, 'editor.log')) + ' -desiredWorkerCount 2 -standbyWorkerCount 1'], 200000);
  if (!launch.data?.launchedPid) throw new Error('Editor launch ownership was not confirmed');
  opened = true; job.editorPid = launch.data.launchedPid; saveJob(root, job);
  phase('Checking storage and opening fixture');
  for (const script of job.workflow.unity.preflightScripts) await evaluate(readFileSync(join(job.target, script), 'utf8'));
  await evaluate('if (UnityEngine.SceneManagement.SceneManager.sceneCount != 1 || UnityEngine.SceneManagement.SceneManager.GetActiveScene().path != ' + JSON.stringify(job.workflow.unity.scene) + ') UnityEditor.SceneManagement.EditorSceneManager.OpenScene(' + JSON.stringify(job.workflow.unity.scene) + '); return "Fixture scene ready";');
  for (const workflow of workflows) for (const viewport of workflow.viewports) {
    phase('Running ' + workflow.title + ' · ' + workflow.caseId + ' · ' + viewport);
    const output = join(job.target, '.aikit/scratch/workbench-' + id, workflow.id, viewport);
    const result = await command(process.execPath, [cli, 'acceptance', 'run', '--project-root', job.target, '--item', workflow.acceptanceItem, '--case', workflow.caseId, '--viewport', viewport, '--out', output, '--mode', 'capture'], 650000);
    if (!['capture-complete', 'captured-unmeasured'].includes(result.status)) throw new Error(result.error ?? 'Capture did not complete');
    const run = JSON.parse(readFileSync(join(output, result.status === 'captured-unmeasured' ? 'acceptance-run.json' : 'capture/acceptance-run.json'), 'utf8'));
    if (run.item !== workflow.acceptanceItem || run.caseId !== workflow.caseId || run.viewport !== viewport || run.capturedUtc < job.createdUtc) throw new Error('Adapter did not produce this job’s fresh case result');
    verificationTarget(root, job.project, workflow);
    if (workflow.basis === 'reference' && run.reference.identity !== referenceObservation(root, job.referenceRoot, job.project).identity) throw new Error('Reference changed during verification');
    phase('Importing ' + viewport + ' evidence');
    noSymlinks(output);
    const retained = 'Tools/Helix/evidence/verification/' + id + '/' + workflow.id + '/' + viewport;
    retainRunArtifacts(root, job.target, output, retained, run.artifacts);
    run.notes += ' Imported by Workbench job ' + id + '; capture timestamp and input hashes retained.';
    await saveRun(root, job.project, run);
    job.results.push({ item: workflow.acceptanceItem, caseId: workflow.caseId, workflowId: workflow.id, viewport, outcome: run.outcome, runId: run.id, observations: run.observations, evidence: retained }); saveJob(root, job);
  }
  job.resultStatus = job.results.every((result: any) => result.outcome === 'matched') ? 'passed' : job.results.some((result: any) => result.outcome === 'mismatch') ? 'failed' : 'needs-review';
} catch (error) { job.status = 'blocked'; job.message = String(error); }
finally {
  if (opened && (commandUncertain || existsSync(join(job.target, '.helix/ui-matrix.lock')) || existsSync(join(job.target, '.helix/unity-reconciliation.json')))) { cleanupFailed = true; job.message = 'Capture execution or restoration is uncertain. The owned Editor and locks are retained for recovery.'; }
  if (opened && !cleanupFailed) {
    try { phase('Closing owned Editor'); await unity(['close', job.target, '--timeout', '30'], 45000); job.closed = true; }
    catch (error) { cleanupFailed = true; job.status = 'blocked'; job.message = 'Editor cleanup needs attention: ' + String(error); }
  }
  if (launchAttempted && !opened) { cleanupFailed = true; job.message = 'Editor launch outcome is uncertain. Inspect the launch receipt and dedicated checkout before recovery.'; }
  job.status = cleanupFailed ? 'blocked' : job.resultStatus ?? job.status;
  // Never advertise success before cleanup. Preserve any concurrent finding edit.
  for (const workflow of workflows) if (!cleanupFailed && job.closed && workflow.review === 'automated' && workflow.finding !== null) {
    const results = job.results.filter((result: any) => result.workflowId === workflow.id);
    if (results.length !== workflow.viewports.length || !results.every((result: any) => ['matched', 'mismatch'].includes(result.outcome))) continue;
    const passed = results.every((result: any) => result.outcome === 'matched');
    const initial = findings.get(workflow.id);
    try {
      const current = verificationStatus(root, job.project, workflow.id);
      if (current.token !== setupToken(workflow)) throw new Error('Verification inputs changed; evidence was imported, but disposition needs reconciliation.');
      if (results.length !== current.workflow.viewports.length) continue; // A partial rerun cannot replace a finding's full viewport evidence.
      const status = resolutionStatus(root, job.project, workflow.finding);
      if (status.revision !== initial.revision || status.recordSha256 !== initial.recordSha256 || status.implementation !== 'integrated') throw new Error('Finding or integration changed during the run; evidence was imported, but disposition needs reconciliation.');
      const record = JSON.parse(readFileSync(join(root, status.path), 'utf8'));
      record.unityRevision = status.receivingHead;
      record.status = passed ? 'resolved' : 'open';
      record.observed = results.map((r: any) => r.viewport + ': ' + r.outcome + '. ' + r.observations.map((o: any) => o.note).join(' ')).join('\n');
      record.evidence = results.flatMap((result: any) => {
        const run = JSON.parse(readFileSync(join(root, 'Tools/Helix/acceptance/runs/' + result.runId + '.json'), 'utf8'));
        return run.artifacts.map((a: any) => ({ path: a.path, sha256: a.sha256, claim: result.viewport + ': ' + run.observations.map((o: any) => o.note).join(' '), inputs: run.candidate.inputs }));
      });
      delete record.blocker; delete record.resolutionReview;
      record.nextAction = passed ? 'Automated checks passed for this finding. Other feature cases retain their own review requirements.' : 'Fix the failed automated assertions and rerun this finding.';
      if (passed) record.decision = 'Authored automated verification passed all configured viewports; no human approval or whole-feature acceptance inferred.'; else delete record.decision;
      const spec = join(directory, 'disposition-' + workflow.id + '.json'); writeFileSync(spec, JSON.stringify(record, null, 2));
      const saved = await command(process.execPath, [cli, 'discrepancy-save', '--project-root', root, '--spec', spec, '--after', String(status.revision)]);
      job.findingRevision = saved.revision;
    } catch (error) { job.status = 'blocked'; job.message = String(error); }
  }
  job.phase = job.status === 'passed' ? 'Checks passed' : job.status === 'failed' ? 'Checks failed' : job.status === 'needs-review' ? 'Evidence ready for review' : 'Run blocked'; job.finishedUtc = new Date().toISOString(); saveJob(root, job);
  if (!cleanupFailed) {
    for (const lock of [join(root, '.helix/workbench-runs/active.lock'), join(job.target, '.helix/workbench-execution.lock')]) {
      if (JSON.parse(readFileSync(lock, 'utf8')).jobId !== id) throw new Error('Execution lock owner changed');
      unlinkSync(lock);
    }
  }
}
