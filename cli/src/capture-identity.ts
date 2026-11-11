import { recordHash } from './acceptance-format.ts';
/** A reusable collection is a fixture/viewport, not an acceptance verdict. */
export function collectionKey(route: any) {
  return recordHash(route.capture.kind === 'ui-matrix' ? { kind: route.capture.kind, spec: route.capture.spec, caseId: route.capture.caseId, viewport: route.viewport } : { item: route.item, caseId: route.caseId, viewport: route.viewport, capture: route.capture });
}
