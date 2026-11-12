import { prepareAiKitChecks } from './aikit-checks.ts';
import { preparePmTask, submitPmTask } from './pm-tasks.ts';
import { planCatalogBatch, startCatalogBatch, catalogBatchStatus } from './catalog-batch.ts';
import { evidencePath } from './evidence-archive.ts';
import { verificationStatus, startVerification } from './verification-jobs.ts';
import { resolutionDefinitions, resolutionStatus, reviewResolution } from './resolution.ts';
import { planAcceptanceCase } from './acceptance-runner.ts';
import { catalogStatus, catalogPath } from './catalog.ts';
/** Evidence API retained for CLI verification and integrations. No Workbench mod or UI is installed. */
import { existsSync, readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acceptanceStatus, loadAcceptance, publishAcceptance, saveDecision } from './acceptance.ts';
import { digest, portablePath, recordHash } from './acceptance-format.ts';

function within(root: string, path: string) {
  portablePath(path);
  const full = realpathSync(join(root, path)), difference = relative(realpathSync(root), full);
  if (difference === '..' || difference.startsWith('..' + sep)) throw new Error('Path escapes its owning project');
  return full;
}
/** Fingerprints the explicitly declared reference inputs; adding/removing files changes identity. */
export function referenceObservation(root: string, referenceRoot: string, project: string) {
  const { scope } = loadAcceptance(root, project);
  const configuration = JSON.parse(readFileSync(within(root, 'Tools/Helix/acceptance/reference-inputs.json'), 'utf8'));
  if (configuration.version !== 1 || !Array.isArray(configuration.paths) || !configuration.paths.length || Object.keys(configuration).some(key => !['version', 'paths'].includes(key))) throw new Error('Expected version 1 reference-inputs with explicit paths');
  const files = new Map<string, string>();
  function visit(path: string) {
    if (lstatSync(join(referenceRoot, path)).isSymbolicLink()) throw new Error('Reference manifest does not follow symlinks');
    const full = within(referenceRoot, path), info = lstatSync(full);
    if (info.isDirectory()) for (const child of readdirSync(full).sort()) visit(path + '/' + child);
    else if (info.isFile()) files.set(path, digest(readFileSync(full)));
    else throw new Error('Reference input must be a regular file or directory');
  }
  for (const path of configuration.paths) visit(path);
  return { version: 1 as const, project, variant: scope.variant, identity: recordHash([...files].sort(([a], [b]) => a.localeCompare(b))), observedUtc: new Date().toISOString() };
}
export async function acceptanceBackend(root: string, referenceRoot: string, project: string, route: string, input: any): Promise<Response> {
  if (route === '/acceptance/aikit-checks-plan' || route === '/acceptance/aikit-checks-start') {
    const plan = await prepareAiKitChecks(root, project, input.selection, referenceObservation(root, referenceRoot, project));
    if (route === '/acceptance/aikit-checks-plan') return Response.json(plan);
    if (plan.blocker) throw new Error(plan.blocker);
    return Response.json(await submitPmTask(root, plan, input.expectedToken), { status: 202 });
  }
  if (route === '/acceptance/task-preview' || route === '/acceptance/task-submit') {
    const plan = await preparePmTask(root, project, input.target, referenceObservation(root, referenceRoot, project));
    return Response.json(route === '/acceptance/task-preview' ? plan : await submitPmTask(root, plan, input.expectedToken));
  }
  if (route === '/acceptance/batch-status') return Response.json(catalogBatchStatus(root, input.id));
  if (route === '/acceptance/batch-plan' || route === '/acceptance/batch-start') {
    const reference = referenceObservation(root, referenceRoot, project);
    if (route === '/acceptance/batch-plan') return Response.json(await planCatalogBatch(root, project, input.selection, reference));
    return Response.json(await startCatalogBatch(root, referenceRoot, project, input.selection, input.expectedToken, reference, input.resume), { status: 202 });
  }
  if (route === '/acceptance/verification-start') return Response.json(startVerification(root, referenceRoot, project, input.id, input.expectedToken), { status: 202 });
  if (route === '/acceptance/verification-status') {
    const execution = verificationStatus(root, project, input.id);
    if (!execution.configured) return Response.json(execution);
    const acceptance = await acceptanceStatus(root, project, referenceObservation(root, referenceRoot, project));
    const rows = acceptance.items.find(item => item.id === execution.workflow.acceptanceItem)!.cases.filter(entry => entry.id === execution.workflow.caseId && execution.workflow.viewports.includes(entry.viewport));
    return Response.json({ ...execution, results: rows.map(entry => ({ viewport: entry.viewport, outcome: entry.verification === 'matched' && entry.assessmentAvailable ? entry.latestAssessment!.outcome : entry.verification, current: entry.freshness === 'current' && entry.availability === 'available', observations: entry.latestAssessment?.observations ?? entry.latestRun?.observations ?? [], capturedUtc: entry.latestRun?.capturedUtc ?? null })) });
  }
  if (route === '/acceptance/resolutions') return Response.json({ project, findings: resolutionDefinitions(root, project).filter((finding: any) => finding.item === input.item).map((finding: any) => resolutionStatus(root, project, finding.id)) });
  if (route === '/acceptance/resolution-review') return Response.json(reviewResolution(root, project, input.review));
  if (route === '/acceptance/resolution-plan' || route === '/acceptance/resolution-media') {
    const status = resolutionStatus(root, project, input.id);
    if (status.token !== input.expectedToken) throw new Error('Finding or evidence changed. Refresh before continuing.');
    if (route === '/acceptance/resolution-plan') {
      const definition = status.definition, catalog = catalogStatus(root, project, await acceptanceStatus(root, project));
      const item = catalog.entries.find((item: any) => item.id === definition.item)!;
      const plans = [];
      for (const viewport of definition.viewports) plans.push(await planAcceptanceCase(root, project, item.acceptanceItem!, definition.caseId, viewport, join(root, '.aikit/scratch/resolution-' + definition.id, viewport)));
      return Response.json({ plans, note: 'Read-only plan. Run captures in an owned checkout; this action does not start Unity.' });
    }
    if (!Number.isInteger(input.artifact) || input.artifact < 0 || input.artifact >= status.artifacts.length) throw new Error('Select registered resolution evidence');
    const artifact = status.artifacts[input.artifact];
    if (artifact.status !== 'intact') throw new Error('Retained evidence is missing or changed');
    const bytes = readFileSync(evidencePath(root, artifact.path));
    if (digest(bytes) !== artifact.expected) throw new Error('Evidence changed while opening');
    const mime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', json: 'text/plain', txt: 'text/plain', md: 'text/plain' };
    const extension = artifact.path.split('.').pop()!;
    if (!Object.hasOwn(mime, extension)) throw new Error('Unsupported resolution preview type');
    return new Response(bytes, { headers: { 'Content-Type': mime[extension], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
  }
  if (route === '/acceptance/catalog' || route === '/acceptance/catalog-evidence') {
    const status = existsSync(join(root, 'Tools/Helix/acceptance/scope.json')) ? await acceptanceStatus(root, project, referenceObservation(root, referenceRoot, project)) : null;
    const catalog = catalogStatus(root, project, status);
    if (route === '/acceptance/catalog') return Response.json(catalog);
    const item = catalog.entries.find((item: any) => item.id === input.item);
    if (!item || !Number.isInteger(input.artifact) || input.artifact < 0 || input.artifact >= item.evidence.length) throw new Error('Select registered catalog evidence');
    const artifact = item.evidence[input.artifact];
    if (artifact.path !== input.expectedPath || artifact.sha256 !== input.expectedSha256) throw new Error('Catalog evidence changed; refresh before opening');
    if (!artifact.availability.startsWith('local;')) throw new Error('Evidence is not available in this checkout');
    const full = evidencePath(root, artifact.path);
    if (lstatSync(full).size > 128 * 1024 * 1024) throw new Error('Evidence exceeds the 128 MiB review limit');
    const bytes = readFileSync(full);
    if (artifact.sha256 !== null && digest(bytes) !== artifact.sha256) throw new Error('Evidence hash differs from the retained record; recover the original artifact');
    const extension = artifact.path.split('.').pop()!.toLowerCase();
    const mime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webm: 'video/webm', mp4: 'video/mp4', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', json: 'application/json', md: 'text/plain', txt: 'text/plain' };
    return new Response(bytes, { headers: { 'Content-Type': mime[extension] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
  }
  const reference = referenceObservation(root, referenceRoot, project);
  const status = await acceptanceStatus(root, project, reference);
  if (route === '/acceptance/status') return Response.json({ ...status, checkout: root, referenceBasis: 'Current declared Helix draft source files; captures must record this same manifest identity.' });
  if (!['/acceptance/review', '/acceptance/media'].includes(route)) return new Response('Not found', { status: 404 });
  const item = status.items.find(item => item.id === input.item);
  const entry = item?.cases.find(entry => entry.id === input.caseId && entry.viewport === input.viewport);
  if (!entry || !entry.latestRun || entry.latestRun.id !== input.runId) throw new Error('Case run changed or is unavailable. Reload the matrix.');
  const run = entry.latestRun;
  if (route === '/acceptance/media') {
    if (!Number.isInteger(input.artifact) || input.artifact < 0 || input.artifact >= run.artifacts.length) throw new Error('Select a registered artifact');
    const artifact = run.artifacts[input.artifact], full = evidencePath(root, artifact.path);
    if (lstatSync(full).size > 128 * 1024 * 1024) throw new Error('Artifact exceeds the 128 MiB inline review limit');
    const bytes = readFileSync(full);
    if (digest(bytes) !== artifact.sha256) throw new Error('Artifact bytes changed since capture');
    const extension = artifact.path.split('.').pop()!.toLowerCase();
    const mime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webm: 'video/webm', mp4: 'video/mp4', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', json: 'application/json' };
    if (!Object.hasOwn(mime, extension)) throw new Error('Unsupported inline media format');
    return new Response(bytes, { headers: { 'Content-Type': mime[extension], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
  }
  if (input.expectedRunSha256 !== recordHash(run)) throw new Error('Run evidence changed. Reload before reviewing.');
  const decision = { version: 1, id: randomUUID(), project, variant: status.variant, item: item!.id, caseId: entry.id, viewport: entry.viewport, runId: run.id, runSha256: recordHash(run), reviewer: { name: input.reviewer, identity: 'self-reported' }, status: input.status, notes: input.notes, savedUtc: new Date().toISOString(), supersedes: input.supersedes };
  const receipt = await saveDecision(root, project, decision, reference);
  // A publication failure must not imply the durable review failed or invite duplicate saves.
  let publicationError: string | null = null;
  try { await publishAcceptance(root, project, reference); } catch (error) { publicationError = error instanceof Error ? error.message : String(error); }
  return Response.json({ status: 'saved', decisionId: decision.id, receipt, publicationError, report: await acceptanceStatus(root, project, reference) });
}
