import { dependencyPinState } from './dependency-pins.ts';
import { evidencePath } from './evidence-archive.ts';
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { catalogPath, loadCatalog } from './catalog.ts';
import { loadAcceptance } from './acceptance.ts';
import { digest, recordHash } from './acceptance-format.ts';

function text(value: unknown) { if (typeof value !== 'string' || !value.trim()) throw new Error('Expected nonempty resolution text'); }
function identifier(value: unknown) { text(value); if (!/^[a-z0-9][a-z0-9.-]*$/.test(value as string)) throw new Error('Invalid resolution ID'); }
function keys(value: any, expected: string[]) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== expected.sort().join()) throw new Error('Invalid resolution fields'); }
export function resolutionDefinitions(root: string, project: string) {
  const path = catalogPath(root, 'Tools/Helix/resolutions/pilots.json');
  if (!existsSync(path)) return [];
  const document = JSON.parse(readFileSync(path, 'utf8')); keys(document, ['version', 'project', 'findings']);
  if (document.version !== 1 || document.project !== project || !Array.isArray(document.findings) || document.findings.length > 1000) throw new Error('Invalid resolution definitions');
  const catalog = loadCatalog(root, project), { screens } = loadAcceptance(root, project), ids = new Set();
  for (const finding of document.findings) {
    keys(finding, ['id', 'item', 'title', 'caseId', 'viewports']); identifier(finding.id); identifier(finding.item); identifier(finding.caseId); text(finding.title);
    if (ids.has(finding.id)) throw new Error('Duplicate resolution finding'); ids.add(finding.id);
    const item = catalog.entries.find((entry: any) => entry.id === finding.item);
    if (!item || !item.discrepancies.includes(finding.id)) throw new Error('Resolution finding must belong to its catalog feature');
    const entry = screens.find(screen => screen.id === item.acceptanceItem)?.cases.find(entry => entry.id === finding.caseId);
    if (!entry || !Array.isArray(finding.viewports) || !finding.viewports.length || new Set(finding.viewports).size !== finding.viewports.length || finding.viewports.some((viewport: string) => !entry.viewports.includes(viewport))) throw new Error('Resolution case/viewports are not declared');
  }
  return document.findings;
}
function checkPin(root: string, pin: any, input = false) {
  if (!pin || typeof pin.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(pin.sha256)) throw new Error('Invalid retained evidence pin');
  if (input && pin.selectors !== undefined) { const state = dependencyPinState(root, pin); return { path: pin.path, status: state === 'match' ? 'intact' : state, expected: pin.sha256, actual: state === 'match' ? pin.sha256 : null }; }
  const path = input ? catalogPath(root, pin.path) : evidencePath(root, pin.path);
  if (!existsSync(path)) return { path: pin.path, status: 'missing', expected: pin.sha256, actual: null };
  if (!statSync(path).isFile() || statSync(path).size > 128 * 1024 * 1024) throw new Error('Resolution artifact must be a file within 128 MiB');
  const actual = digest(readFileSync(path));
  return { path: pin.path, status: actual === pin.sha256 ? 'intact' : 'changed', expected: pin.sha256, actual };
}
export function resolutionStatus(root: string, project: string, id: string) {
  identifier(id);
  const definition = resolutionDefinitions(root, project).find((finding: any) => finding.id === id);
  if (!definition) throw new Error('Unknown resolution finding');
  const directory = catalogPath(root, 'Tools/Helix/discrepancies/' + id);
  const revisions = readdirSync(directory).filter(name => /^[1-9]\d*\.json$/.test(name)).map(name => Number.parseInt(name)).sort((a, b) => b - a);
  if (!revisions.length) throw new Error('Finding has no discrepancy revisions');
  const revision = revisions[0], path = `Tools/Helix/discrepancies/${id}/${revision}.json`, record = JSON.parse(readFileSync(catalogPath(root, path), 'utf8'));
  if (record.id !== id || record.schemaVersion !== 1 || !['open', 'blocked', 'resolved', 'accepted-deviation'].includes(record.status) || !Array.isArray(record.evidence)) throw new Error('Invalid discrepancy record');
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 }).trim();
  const head = git('rev-parse', 'HEAD');
  const commits = record.integration === undefined ? [] : record.integration.commits;
  if (!Array.isArray(commits) || commits.some((commit: string) => !/^[a-f0-9]{40}$/.test(commit))) throw new Error('Invalid integration commits');
  const integration = commits.map((commit: string) => {
    try { git('cat-file', '-e', commit + '^{commit}'); } catch (error: any) { if (typeof error.status !== 'number') throw error; return { commit, state: 'unknown' }; }
    try { git('merge-base', '--is-ancestor', commit, head); return { commit, state: 'included' }; } catch (error: any) { if (error.status !== 1) throw error; return { commit, state: 'not-included' }; }
  });
  const inputs = new Map<string, ReturnType<typeof checkPin>>();
  const artifacts = record.evidence.map((evidence: any, index: number) => {
    text(evidence.claim); if (!Array.isArray(evidence.inputs)) throw new Error('Missing input pins');
    for (const pin of evidence.inputs) {
      const previous = inputs.get(pin.path); if (previous && previous.expected !== pin.sha256) throw new Error('Conflicting evidence input pins');
      if (!previous) inputs.set(pin.path, checkPin(root, pin, true));
    }
    return { index, claim: evidence.claim, ...checkPin(root, evidence), hasInputs: evidence.inputs.length > 0 };
  });
  const implementation = integration.length > 0 && integration.every((commit: any) => commit.state === 'included') ? 'integrated' : integration.length ? 'integration-pending' : 'fix-not-linked';
  const evidence = !artifacts.length ? 'not-recorded' : artifacts.some((artifact: any) => artifact.status !== 'intact') ? 'recovery-needed' : artifacts.some((artifact: any) => !artifact.hasInputs) ? 'provenance-incomplete' : [...inputs.values()].some(input => input.status !== 'intact') ? 'stale-inputs' : 'ready-for-review';
  const review = record.status === 'resolved' ? 'resolved-recorded' : record.status === 'accepted-deviation' ? 'deviation-recorded' : record.status === 'blocked' ? 'blocked' : 'pending';
  const blockers = [];
  if (implementation !== 'integrated') blockers.push('Verify the linked fix commits are included in the receiving checkout.');
  if (evidence === 'stale-inputs') blockers.push(`${[...inputs.values()].filter(input => input.status !== 'intact').length} declared input files changed or are missing. Verify this scope against current inputs before resolving.`);
  else if (evidence !== 'ready-for-review') blockers.push('Restore missing evidence and complete its declared input coverage before resolving.');
  if (review === 'resolved-recorded' || review === 'deviation-recorded') blockers.push('A terminal disposition is already recorded. Reopen it before another resolution.');
  const result = { definition, revision, path, recordSha256: recordHash(record), receivingHead: head, implementation, evidence, review, integration, artifacts, inputs: [...inputs.values()], blockers, canResolve: blockers.length === 0, assignment: record.assignment ?? null, expected: record.expected, observed: record.observed, nextAction: implementation === 'integrated' && record.integration ? record.integration.afterIntegration : record.nextAction ?? null, decision: record.decision ?? null, resolutionReview: record.resolutionReview ?? null };
  return { ...result, token: recordHash(result) };
}
export function reviewResolution(root: string, project: string, input: any) {
  keys(input, ['id', 'expectedToken', 'reviewer', 'notes', 'action', 'evidenceReviewed']);
  text(input.reviewer); text(input.notes);
  if (typeof input.expectedToken !== 'string' || typeof input.evidenceReviewed !== 'boolean' || !['resolve', 'request-changes', 'block', 'reopen'].includes(input.action)) throw new Error('Invalid resolution review');
  const status = resolutionStatus(root, project, input.id);
  if (status.token !== input.expectedToken) throw new Error('Finding, checkout or evidence changed. Refresh before saving.');
  if (input.action === 'resolve' && (!status.canResolve || !input.evidenceReviewed)) throw new Error('Resolution requires integrated fix, intact current evidence, and explicit scoped review.');
  const terminal = ['resolved-recorded', 'deviation-recorded'].includes(status.review);
  if (terminal && input.action !== 'reopen') throw new Error('Reopen a terminal finding before changing its disposition');
  if (!terminal && input.action === 'reopen') throw new Error('Only terminal findings can be reopened');
  const record = JSON.parse(readFileSync(catalogPath(root, status.path), 'utf8'));
  record.status = input.action === 'resolve' ? 'resolved' : input.action === 'block' ? 'blocked' : 'open';
  record.resolutionReview = { reviewer: input.reviewer.trim(), identity: 'self-reported', action: input.action, notes: input.notes.trim(), evidenceReviewed: input.evidenceReviewed, savedUtc: new Date().toISOString(), sourceRevision: status.revision, receivingHead: status.receivingHead, assessmentToken: status.token };
  if (input.action === 'resolve') { record.decision = `${input.reviewer.trim()}: ${input.notes.trim()}`; delete record.blocker; record.nextAction = 'Resolved for the scope of this finding. Feature acceptance remains separate.'; }
  else { delete record.decision; record.nextAction = input.notes.trim(); if (input.action === 'block') record.blocker = input.notes.trim(); else delete record.blocker; }
  const directory = mkdtempSync(join(tmpdir(), 'helix-resolution-'));
  try {
    const file = join(directory, 'review.json'); writeFileSync(file, JSON.stringify(record));
    const output = execFileSync(process.execPath, [fileURLToPath(new URL('./cli.ts', import.meta.url)), 'discrepancy-save', '--project-root', root, '--spec', file, '--after', String(status.revision)], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    return { status: 'saved', receipt: JSON.parse(output), note: 'A new discrepancy revision was saved. Feature acceptance was not changed.' };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
