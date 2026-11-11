/** PM handoff only. Never launches an Editor or marks acceptance complete. */
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { catalogPath, catalogStatus } from './catalog.ts';
import { acceptanceStatus, loadAcceptance } from './acceptance.ts';
import { digest, recordHash } from './acceptance-format.ts';
import type { ReferenceObservation } from './acceptance-format.ts';
import { evidencePath } from './evidence-archive.ts';
export type TaskTarget = { item: string; kind: 'finding' | 'tooling'; finding?: string };
type Attachment = { path: string; sha256: string | null; status: 'available' | 'missing' | 'changed'; resolved: string | null };
export type TaskPlan = { key: string; token: string; title: string; body: string; attachments: Attachment[]; specs: { title: string; target: string; kind: string }[]; blocker: string | null; receipt: any };
export function pmConfig(root: string) {
  const path = catalogPath(root, '.helix/aikit-pm.json');
  if (!existsSync(path)) throw new Error('Configure .helix/aikit-pm.json with {"version":1,"executable":"/absolute/path/to/ai-kit"}.');
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (value.version !== 1 || Object.keys(value).sort().join() !== 'executable,version' || typeof value.executable !== 'string' || !isAbsolute(value.executable)) throw new Error('Invalid AI Kit PM configuration');
  accessSync(value.executable, constants.X_OK); return value.executable as string;
}
function taskDirectory(root: string, key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid task key');
  return catalogPath(root, '.helix/task-submissions/' + key);
}
export function taskReceipt(root: string, key: string) { const path = join(taskDirectory(root, key), 'receipt.json'); return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null; }
export async function preparePmTask(root: string, project: string, target: TaskTarget, reference?: ReferenceObservation): Promise<TaskPlan> {
  if (!target || !['finding', 'tooling'].includes(target.kind) || typeof target.item !== 'string' || Object.keys(target).some(key => !['item', 'kind', 'finding'].includes(key)) || (target.kind === 'finding' ? typeof target.finding !== 'string' : target.finding !== undefined)) throw new Error('Select a finding or feature tooling gap');
  const report = await acceptanceStatus(root, project, reference), catalog = catalogStatus(root, project, report);
  const item = catalog.entries.find(item => item.id === target.item);
  if (!item) throw new Error('Unknown catalog feature');
  const issue = target.kind === 'finding' ? item.issues.find(issue => issue.id === target.finding) : null;
  if (target.kind === 'finding' && (!issue || issue.kind === 'history')) throw new Error('Select a current finding');
  const { screens } = loadAcceptance(root, project), screen = screens.find(screen => screen.id === item.acceptanceItem);
  const rows = report.items.find(entry => entry.id === item.acceptanceItem)?.cases ?? [];
  const selected = target.kind === 'finding' ? rows.filter(row => screen!.cases.find(entry => entry.id === row.id)!.discrepancies.includes(target.finding!)) : rows.filter(row => row.required && !row.accepted && (row.workflowId === null || row.recipe.blockers.length > 0));
  if (target.kind === 'tooling' && !selected.length && item.acceptance && item.acceptance.required > 0 && !item.issues.some(issue => issue.kind === 'tooling')) throw new Error('This feature has no tooling gap');
  const attachments = new Map<string, Attachment>();
  const attach = (path: string, expected: string | null = null) => {
    const resolved = evidencePath(root, path), actual = existsSync(resolved) ? digest(readFileSync(resolved)) : null;
    if (attachments.has(path)) { const previous = attachments.get(path)!; if (expected !== null && previous.sha256 !== expected) throw new Error('Conflicting evidence hashes: ' + path); return; }
    const status = actual === null ? 'missing' : expected !== null && actual !== expected ? 'changed' : 'available';
    attachments.set(path, { path, sha256: expected ?? actual, status, resolved: status === 'available' ? resolved : null });
  };
  for (const spec of item.specs) if (spec.kind === 'markdown') attach(spec.target);
  for (const path of item.sources) if (/\.md$/i.test(path)) attach(path);
  if (issue) {
    attach(issue.path);
    const record = JSON.parse(readFileSync(catalogPath(root, issue.path), 'utf8'));
    for (const artifact of record.evidence) attach(artifact.path, artifact.sha256);
  }
  const related = new Map<string, any>();
  for (const row of selected) {
    if (row.latestRun) related.set(row.latestRun.id, row.latestRun);
    for (const support of row.supportingCases) if (support.latestRun) {
      const run = JSON.parse(readFileSync(catalogPath(root, 'Tools/Helix/acceptance/runs/' + support.latestRun.id + '.json'), 'utf8')); related.set(run.id, run);
    }
    for (const source of row.priorEvidence?.sources ?? []) {
      attach(source.path);
      if (source.path.startsWith('Tools/Helix/discrepancies/') && source.available) {
        const record = JSON.parse(readFileSync(catalogPath(root, source.path), 'utf8'));
        for (const artifact of record.evidence) attach(artifact.path, artifact.sha256);
      }
    }
  }
  for (const run of related.values()) {
    attach('Tools/Helix/acceptance/runs/' + run.id + '.json');
    for (const artifact of run.artifacts) attach(artifact.path, artifact.sha256);
  }
  const title = target.kind === 'tooling' ? 'Add missing tooling: ' + item.title : (issue!.kind === 'defect' ? 'Address finding: ' : 'Investigate finding: ') + issue!.id;
  const body = [
    '# ' + title, 'Project: ' + project + '\nFeature: ' + item.id + '\nFolder: ' + (item.folder ?? 'unfiled'),
    'Create or update an AI Kit task for this scoped work. Check for an existing matching task before creating another. Preserve concurrent work. Keep reusable tooling upstream and project-specific definitions in this repository. Do not run Unity, launch an Editor, or start captures for this request. Use the attached existing evidence; do not mark acceptance complete without its existing gates.',
    issue ? 'Finding: ' + issue.id + ' · revision ' + issue.revision + ' · ' + issue.kind + ' · discipline ' + issue.discipline + '\nExpected: ' + issue.expected + '\nObserved: ' + issue.observed + '\nTriage: ' + issue.triageReason + '\nNext action: ' + (issue.nextAction ?? 'Investigate against the declared criteria.') : 'Implement the missing adapters/setup for the primary checks below, reusing shared adapters and existing evidence. Keep unknown behavior, missing tooling and product defects distinct. A supporting capture is not a primary-case verdict.',
    '## Specifications\n' + item.specs.map(spec => spec.title + ': ' + spec.target).join('\n'),
    '## Acceptance cases and existing state\n' + selected.map(row => '### ' + row.id + ' · ' + row.viewport + '\n' + row.criteria.map(criterion => '- ' + criterion.id + ': ' + criterion.expected).join('\n') + '\nSetup: ' + row.recipe.setup + '\nState: ' + row.verification + '; ' + row.freshness + '; ' + row.availability + '; complete=' + row.accepted + '\nDirect workflow: ' + (row.workflowId ?? 'missing') + '\nRemaining gates: ' + row.reasons.join('; ')).join('\n\n'),
    '## Existing evidence and local specs\n' + [...attachments.values()].map(file => '- ' + file.path + ' · ' + file.status + (file.sha256 ? ' · SHA-256 ' + file.sha256 : '')).join('\n'),
    'Submission is a PM request, not proof that a board task was created or that the feature is complete.',
  ].join('\n\n');
  let blocker: string | null = null; try { pmConfig(root); } catch (error) { blocker = String(error); }
  const key = recordHash({ project, target }), files = [...attachments.values()];
  return { key, title, body, attachments: files, specs: item.specs, token: recordHash({ target, title, body, files }), blocker, receipt: taskReceipt(root, key) };
}
export async function submitPmTask(root: string, plan: TaskPlan, expectedToken: string) {
  if (plan.token !== expectedToken) throw new Error('Finding, specifications or evidence changed. Refresh the task preview.');
  if (plan.blocker !== null) throw new Error(plan.blocker);
  const executable = pmConfig(root), directory = taskDirectory(root, plan.key); mkdirSync(directory, { recursive: true });
  const lock = join(directory, 'submit.lock');
  try { writeFileSync(lock, '', { flag: 'wx' }); } catch (error: any) { if (error.code === 'EEXIST') throw new Error('This task is already being submitted. Refresh its preview.'); throw error; }
  const save = (receipt: any) => { const path = join(directory, 'receipt.json'); writeFileSync(path + '.tmp', JSON.stringify(receipt, null, 2) + '\n'); renameSync(path + '.tmp', path); };
  try {
    const previous = taskReceipt(root, plan.key); if (previous) return previous;
    const files = plan.attachments.filter(file => file.status === 'available');
    for (const file of files) if (digest(readFileSync(file.resolved!)) !== file.sha256) throw new Error('Attachment changed: ' + file.path);
    const packet = join(directory, 'request.md');
    if ([packet, ...files.map(file => file.resolved!)].some(path => /[,\r\n]/.test(path))) throw new Error('AI Kit attachment paths cannot contain commas or line breaks');
    writeFileSync(packet, plan.body + (files.length ? '\n\nAttached files: ' + files.map(file => file.resolved!).join(', ') : '') + '\n', { flag: 'wx' });
    const receipt: any = { key: plan.key, token: plan.token, title: plan.title, status: 'pending', messageId: null, createdUtc: new Date().toISOString(), packet, error: null }; save(receipt);
    try {
      const { stdout } = await promisify(execFile)(executable, ['assistant', 'send', '@' + packet], { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 });
      const result = JSON.parse(stdout);
      if (result.ok !== true || typeof result.id !== 'string' || !result.id) throw new Error('AI Kit did not return a PM message receipt');
      receipt.status = 'sent'; receipt.messageId = result.id;
    } catch (error) { receipt.status = 'uncertain'; receipt.error = String(error); }
    save(receipt); return receipt;
  } finally { unlinkSync(lock); }
}
