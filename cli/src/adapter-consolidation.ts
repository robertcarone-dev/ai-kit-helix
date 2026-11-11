/** Lossless authoring consolidation; expanded routes and immutable records are unchanged. */
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { catalogPath } from './catalog.ts';
import { recordHash } from './acceptance-format.ts';
import { loadCaseAdapters } from './acceptance-runner.ts';
export function consolidateAdapters(root: string, project: string, apply: boolean) {
  const path = catalogPath(root, 'Tools/Helix/acceptance/adapters.json'), before = readFileSync(path, 'utf8');
  const routes = loadCaseAdapters(root, project), captures: Record<string, any> = {}, evidence: Record<string, any> = {}, groups = new Map<string, any>();
  const intern = (table: Record<string, any>, value: any) => { const id = recordHash(value); table[id] = value; return id; };
  for (const route of routes) {
    const value = { item: route.item, caseId: route.caseId, retained: route.retained.map(pin => intern(evidence, pin)), capture: route.capture === null ? null : intern(captures, route.capture) };
    const key = recordHash(value), known = groups.get(key);
    if (known) known.viewports.push(route.viewport); else groups.set(key, { ...value, viewports: [route.viewport] });
  }
  const after = JSON.stringify({ version: 2, project, captures, evidence, routes: [...groups.values()] }, null, 2) + '\n';
  const result = { applied: apply, changed: before !== after, viewportRoutes: routes.length, authoringRoutes: groups.size, sharedCaptures: Object.keys(captures).length, sharedEvidence: Object.keys(evidence).length, beforeBytes: Buffer.byteLength(before), afterBytes: Buffer.byteLength(after) };
  if (apply && result.changed) {
    const lock = path + '.lock'; writeFileSync(lock, '', { flag: 'wx' });
    try {
      if (readFileSync(path, 'utf8') !== before) throw new Error('Adapter manifest changed concurrently; retry consolidation');
      const temporary = path + '.' + randomUUID(); writeFileSync(temporary, after, { flag: 'wx' }); renameSync(temporary, path);
    } finally { unlinkSync(lock); }
  }
  return result;
}
