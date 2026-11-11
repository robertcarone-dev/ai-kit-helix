import { hostname } from 'node:os';
import { isAbsolute } from 'node:path';
import { realpathSync } from 'node:fs';

/** Resolve the same per-Creator, per-machine connection the project Mod owns.
 * Explicit checkout overrides never contact Helix or mutate the saved selection. */
export async function connectedProjectRoot(args: string[], validateUrl: (url: string) => string): Promise<string | null> {
  const indexes = args.flatMap((arg, i) => arg === '--helix-project' ? [i] : []);
  if (indexes.length > 1) throw new Error('Supply --helix-project only once.');
  if (!indexes.length) return null;
  const project = args[indexes[0] + 1];
  if (!project || !/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw new Error('--helix-project requires a project slug.');
  if (args.includes('--project-root') || args.includes('--help') || ['help', '-h'].includes(args[0])) return null;
  const origin = new URL(validateUrl(process.env.HELIX_URL ?? `http://127.0.0.1:${process.env.HELIX_DESKTOP_PORT ?? 47600}`)).origin;
  const mod = `${project}~porting-workbench`;
  async function json(path: string, body?: unknown) {
    const response = await fetch(`${origin}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-helix-project': project, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`Unity connection request failed (${response.status}): ${await response.text()}`);
    return response.json();
  }
  const machine = await json(`/api/mods/${mod}/machine`);
  if (machine.machine !== hostname() || machine.key !== `unity-project:${hostname()}`) throw new Error('The Unity connection must come from Helix Desktop on this machine.');
  const stored = await json(`/api/me/mod-kv/${mod}/${encodeURIComponent(machine.key)}`);
  if (stored.value === undefined) throw new Error(`Select a Unity project in ${project}'s Porting Workbench, or use --project-root DIR.`);
  const saved = stored.value;
  if (!saved || saved.version !== 1 || typeof saved.path !== 'string' || !isAbsolute(saved.path)) throw new Error('Invalid saved Unity connection. Reconnect the project in Porting Workbench.');
  const checkout = await json(`/api/mods/${mod}/inspect`, { path: saved.path });
  if (checkout.project !== project || checkout.machine !== hostname() || checkout.path !== realpathSync(saved.path)) throw new Error('Unity connection identity does not match the selected checkout.');
  return checkout.path;
}
