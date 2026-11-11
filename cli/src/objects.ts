import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha } from './config.ts';
import { pngDimensions } from './image-limits.ts';

/** Uses the same development API as the mod, in the CLI's owned browser context. */
export async function objects(page: any, req: any, provenance: any) {
  const result = await page.evaluate(async ({ operation, id, match, view, selector, engine }: any) => {
    const api = (window as any).__portingWorkbench?.[engine === 'three' ? 'threeObjects' : 'objects'];
    if (!api || api.version !== 1) throw new Error('Object discovery v1 is unavailable. Update the project development hooks and reload.');
    if (operation === 'list') return api.list(match);
    if (['selector', 'resolve', 'explain'].includes(operation) || selector !== undefined) {
      if (typeof api.selector !== 'function' || typeof api.resolve !== 'function' || typeof api.explain !== 'function') throw new Error('Reusable selectors and rendering explanations are unavailable. Reload the updated development hooks.');
    }
    if (selector !== undefined) {
      const resolution = api.resolve(selector);
      if (operation === 'resolve' || resolution.status !== 'resolved') return resolution;
      id = resolution.matches[0].id;
    }
    if (operation === 'selector') return api.selector(id);
    if (operation === 'explain') return api.explain(id);
    if (operation === 'inspect') return api.inspect(id);
    if (operation === 'capture') {
      if (engine === 'three') throw new Error('Three object capture is unavailable; use the existing Three debug capture tools.');
      return api.capture(id, view);
    }
    throw new Error('Use objects list|selector|resolve|inspect|explain|capture.');
  }, { operation: req.operation, id: req.name, match: req.match ?? '', view: req.view, selector: req.selector, engine: req.engine });
  if (req.operation === 'selector') {
    if (req.out) writeFileSync(req.out, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    return result;
  }
  if (result.kind === 'helix-object-resolution' || req.operation !== 'capture') return { ...provenance, ...result };
  if (typeof result.dataUrl !== 'string' || !result.dataUrl.startsWith('data:image/png;base64,') || result.dataUrl.length > 100000000)
    throw new Error('Invalid object capture PNG response.');
  const bytes = Buffer.from(result.dataUrl.slice('data:image/png;base64,'.length), 'base64');
  const dimensions = pngDimensions(bytes);
  if (dimensions.width !== result.canvas.width || dimensions.height !== result.canvas.height) throw new Error('Object capture canvas dimensions changed.');
  const { dataUrl, ...observation } = result;
  const receipt = { ...provenance, ...observation, ...(req.selector === undefined ? {} : { requestedSelector: req.selector }), image: { path: 'object.png', sha256: sha(bytes), ...dimensions } };
  mkdirSync(req.out);
  writeFileSync(join(req.out, 'object.png'), bytes, { flag: 'wx' });
  writeFileSync(join(req.out, 'object.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return { out: req.out, ...receipt };
}
