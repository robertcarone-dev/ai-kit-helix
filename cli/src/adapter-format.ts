/** Canonical expanded view used by execution and dependency selectors. */
function fields(value: any, keys: string[], label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error('Invalid ' + label);
}
export function expandAdapterManifest(value: any) {
  if (value.version === 2) {
    fields(value, ['version', 'project', 'captures', 'evidence', 'routes'], 'shared adapter manifest');
    if (!value.captures || !value.evidence || Array.isArray(value.captures) || Array.isArray(value.evidence) || typeof value.captures !== 'object' || typeof value.evidence !== 'object' || !Array.isArray(value.routes)) throw new Error('Invalid shared adapter definitions');
    const shared = value;
    value = { version: 1, project: shared.project, routes: shared.routes.flatMap((route: any) => {
      fields(route, ['item', 'caseId', 'viewports', 'retained', 'capture'], 'shared adapter route');
      if (!Array.isArray(route.viewports) || !route.viewports.length || !Array.isArray(route.retained)) throw new Error('Invalid shared adapter viewports/evidence');
      const lookup = (table: any, key: any) => { if (typeof key !== 'string' || !Object.hasOwn(table, key)) throw new Error('Unknown shared adapter definition'); return table[key]; };
      return route.viewports.map((viewport: string) => ({ item: route.item, caseId: route.caseId, viewport, retained: route.retained.map((key: string) => lookup(shared.evidence, key)), capture: route.capture === null ? null : lookup(shared.captures, route.capture) }));
    }) };
  }
  return value;
}
