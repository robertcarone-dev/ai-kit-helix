import { expandAdapterManifest } from './adapter-format.ts';
import { existsSync, readFileSync } from 'node:fs';
import { catalogPath } from './catalog.ts';
import { canonical, digest, recordHash } from './acceptance-format.ts';
import type { AcceptanceCase, InputPin } from './acceptance-format.ts';
import { MissingDependencySelection, selectDependency, validateDependencySelectors } from './dependency-selection.ts';
import type { DependencySelector } from './dependency-selection.ts';
export function dependencyPin(root: string, path: string, selectors?: DependencySelector[]): InputPin {
  const bytes = readFileSync(catalogPath(root, path));
  if (selectors === undefined) return { path, sha256: digest(bytes) };
  validateDependencySelectors(selectors);
  const markdown = selectors.every(selector => 'heading' in selector);
  if (!markdown && selectors.some(selector => 'heading' in selector)) throw new Error('Cannot mix JSON and Markdown dependency selectors');
  let document = markdown ? bytes.toString('utf8') : JSON.parse(bytes.toString('utf8'));
  if (!markdown && path === 'Tools/Helix/acceptance/adapters.json') document = expandAdapterManifest(document);
  const values = selectors.map(selector => {
    const selected = selectDependency(document, selector);
    return !('where' in selector) || selector.where === undefined ? selected : (selected as unknown[]).sort((a, b) => canonical(a).localeCompare(canonical(b)));
  });
  return { path, selectors, sha256: recordHash({ selectors, values }) };
}
export function captureDependencyPins(root: string, entry: AcceptanceCase): InputPin[] {
  return entry.dependencies.map(path => dependencyPin(root, path, entry.dependencySelections?.find(selection => selection.path === path)?.selectors));
}
export function dependencyPinState(root: string, pin: InputPin): 'match' | 'missing' | 'changed' {
  if (!existsSync(catalogPath(root, pin.path))) return 'missing';
  try { return dependencyPin(root, pin.path, pin.selectors).sha256 === pin.sha256 ? 'match' : 'changed'; }
  catch (error) { if (error instanceof MissingDependencySelection) return 'changed'; throw error; }
}
