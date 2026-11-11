import { catalogStatus, catalogPath } from '../src/catalog.ts';
/** Reusable Workbench endpoints. The host validates the connected checkout and supplies its project root. */
import { existsSync, readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acceptanceStatus, loadAcceptance, publishAcceptance, saveDecision } from '../src/acceptance.ts';
import { digest, portablePath, recordHash } from '../src/acceptance-format.ts';

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
  if (route === '/acceptance/catalog' || route === '/acceptance/catalog-evidence') {
    const status = existsSync(join(root, 'Tools/Helix/acceptance/scope.json')) ? await acceptanceStatus(root, project, referenceObservation(root, referenceRoot, project)) : null;
    const catalog = catalogStatus(root, project, status);
    if (route === '/acceptance/catalog') return Response.json(catalog);
    const item = catalog.entries.find((item: any) => item.id === input.item);
    if (!item || !Number.isInteger(input.artifact) || input.artifact < 0 || input.artifact >= item.evidence.length) throw new Error('Select registered catalog evidence');
    const artifact = item.evidence[input.artifact];
    if (artifact.path !== input.expectedPath || artifact.sha256 !== input.expectedSha256) throw new Error('Catalog evidence changed; refresh before opening');
    if (!artifact.availability.startsWith('local;')) throw new Error('Evidence is not available in this checkout');
    const full = catalogPath(root, artifact.path);
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
    const artifact = run.artifacts[input.artifact], full = within(root, artifact.path);
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
