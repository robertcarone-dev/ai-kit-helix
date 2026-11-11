/** Reviewed format/refactor migrations preserve only explicitly named immutable runs. */
import { existsSync, readFileSync } from 'node:fs';
import { catalogPath } from './catalog.ts';
import { recordHash } from './acceptance-format.ts';
import { dependencyPin, dependencyPinState } from './dependency-pins.ts';
import type { Run, InputPin } from './acceptance-format.ts';
export function historicalInputState(root: string, run: Run, pin: InputPin) {
  const state = dependencyPinState(root, pin);
  if (state !== 'changed' || pin.selectors !== undefined) return state;
  const path = catalogPath(root, 'Tools/Helix/acceptance/input-migrations.json');
  if (!existsSync(path)) return state;
  const document = JSON.parse(readFileSync(path, 'utf8'));
  if (document.version !== 1 || !Array.isArray(document.migrations)) throw new Error('Invalid input migration manifest');
  for (const migration of document.migrations) {
    if (typeof migration.reason !== 'string' || !migration.reason.trim() || !Array.isArray(migration.runs) || !Array.isArray(migration.changes)) throw new Error('Invalid input migration');
    if (!migration.runs.some((record: any) => record.id === run.id && record.sha256 === recordHash(run))) continue;
    const actual = dependencyPin(root, pin.path).sha256;
    if (migration.changes.some((change: any) => change.path === pin.path && change.before === pin.sha256 && change.after === actual)) return 'match';
  }
  return state;
}
