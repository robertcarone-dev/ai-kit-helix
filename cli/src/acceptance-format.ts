/** Portable acceptance contracts. No game identities, selectors, or runtime execution. */
import { createHash } from 'node:crypto';

export type Dimension = 'appearance' | 'motion' | 'behavior' | 'audio';
export type Pin = { path: string; sha256: string };
export type Criterion = { id: string; expected: string };
export type AcceptanceCase = { id: string; dimension: Dimension; required: boolean; viewports: string[]; basis: { kind: 'reference' | 'product'; source: string }; criteria: Criterion[]; dependencies: string[]; discrepancies: string[]; recipe: { reference: string | null; candidate: string | null; blockers: string[]; setup: string; anchors: string[] } };
export type Screen = { version: 1; id: string; title: string; implementation: 'missing' | 'in-progress' | 'implemented'; implementationReferences: string[]; cases: AcceptanceCase[] };
export type Scope = { version: 1; project: string; variant: string; status: 'draft' | 'approved'; rationale: string; screens: string[]; exclusions: string[]; viewports: { id: string; width: number; height: number; safeArea: string }[] };
export type Run = { version: 1; id: string; project: string; variant: string; item: string; caseId: string; viewport: string; criteriaSha256: string; capturedUtc: string; reference: { identity: string; description: string }; candidate: { revision: string; inputs: Pin[] }; capture: { width: number; height: number; safeArea: string; setup: string; anchors: string[] }; outcome: 'matched' | 'mismatch' | 'blocked' | 'unmeasured'; observations: { criterion: string; result: 'match' | 'mismatch' | 'unmeasured'; note: string }[]; artifacts: (Pin & { kind: 'image' | 'video' | 'audio' | 'observations'; side: 'reference' | 'candidate'; recovery: string })[]; notes: string };
export type Decision = { version: 1; id: string; project: string; variant: string; item: string; caseId: string; viewport: string; runId: string; runSha256: string; reviewer: { name: string; identity: 'self-reported' | 'host-verified' }; status: 'accepted' | 'changes-requested' | 'blocked'; notes: string; savedUtc: string; supersedes: string | null };
export type ReferenceObservation = { version: 1; project: string; variant: string; identity: string; observedUtc: string };

export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export const recordHash = (value: unknown) => digest(canonical(value));
export const caseKey = (value: Pick<Run, 'project' | 'variant' | 'item' | 'caseId' | 'viewport'>) => canonical([value.project, value.variant, value.item, value.caseId, value.viewport]);
function object(value: any, keys: string[], label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid fields: ' + label);
}
function text(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192) throw new Error('Expected nonempty text: ' + label);
}
function choice(value: unknown, choices: readonly string[], label: string) {
  if (!choices.includes(value as string)) throw new Error('Invalid ' + label);
}
export function identifier(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) throw new Error('Invalid identifier');
}
export function portablePath(value: unknown): asserts value is string {
  text(value, 'path');
  if (typeof value !== 'string' || value.startsWith('/') || value.includes('\\') || value.includes(':') || value.split('/').some(part => ['', '.', '..'].includes(part))) throw new Error('Expected portable relative path');
}
function hash(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Expected SHA-256');
}
function utc(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Expected ISO UTC timestamp');
}
function array(value: any, label: string, validate: (entry: any) => void, key: (entry: any) => string = canonical) {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Invalid array: ' + label);
  const seen = new Set<string>();
  for (const entry of value) { validate(entry); const id = key(entry); if (seen.has(id)) throw new Error('Duplicate ' + label); seen.add(id); }
}
function positive(value: unknown) { if (!Number.isInteger(value) || (value as number) <= 0) throw new Error('Expected positive integer'); }
function identity(value: any) { for (const key of ['project', 'variant', 'item', 'caseId', 'viewport', 'id']) identifier(value[key]); if (value.version !== 1) throw new Error('Unsupported acceptance version'); }
export function readScope(value: any): Scope {
  object(value, ['version', 'project', 'variant', 'status', 'rationale', 'screens', 'exclusions', 'viewports'], 'scope');
  if (value.version !== 1) throw new Error('Unsupported scope version');
  identifier(value.project); identifier(value.variant); choice(value.status, ['draft', 'approved'], 'scope status'); text(value.rationale, 'scope rationale');
  array(value.screens, 'screen paths', portablePath); array(value.exclusions, 'exclusions', entry => text(entry, 'exclusion'));
  array(value.viewports, 'viewports', entry => { object(entry, ['id', 'width', 'height', 'safeArea'], 'viewport'); identifier(entry.id); positive(entry.width); positive(entry.height); text(entry.safeArea, 'safe area'); }, entry => entry.id);
  return value;
}
export function readScreen(value: any): Screen {
  object(value, ['version', 'id', 'title', 'implementation', 'implementationReferences', 'cases'], 'screen');
  if (value.version !== 1) throw new Error('Unsupported screen version');
  identifier(value.id); text(value.title, 'screen title'); choice(value.implementation, ['missing', 'in-progress', 'implemented'], 'implementation'); array(value.implementationReferences, 'implementation references', portablePath);
  array(value.cases, 'cases', entry => {
    object(entry, ['id', 'dimension', 'required', 'viewports', 'basis', 'criteria', 'dependencies', 'discrepancies', 'recipe'], 'case');
    identifier(entry.id); choice(entry.dimension, ['appearance', 'motion', 'behavior', 'audio'], 'dimension');
    if (typeof entry.required !== 'boolean') throw new Error('Expected required boolean');
    array(entry.viewports, 'case viewports', identifier); if (!entry.viewports.length) throw new Error('Case requires a viewport');
    object(entry.basis, ['kind', 'source'], 'basis'); choice(entry.basis.kind, ['reference', 'product'], 'basis'); text(entry.basis.source, 'basis source');
    array(entry.criteria, 'criteria', criterion => { object(criterion, ['id', 'expected'], 'criterion'); identifier(criterion.id); text(criterion.expected, 'expected'); }, criterion => criterion.id);
    if (!entry.criteria.length) throw new Error('Case requires criteria');
    array(entry.dependencies, 'dependencies', portablePath); array(entry.discrepancies, 'discrepancies', identifier);
    object(entry.recipe, ['reference', 'candidate', 'blockers', 'setup', 'anchors'], 'recipe');
    for (const side of ['reference', 'candidate']) if (entry.recipe[side] !== null) text(entry.recipe[side], side + ' recipe');
    array(entry.recipe.blockers, 'blockers', blocker => text(blocker, 'blocker')); text(entry.recipe.setup, 'setup'); array(entry.recipe.anchors, 'anchors', identifier);
    if ((entry.recipe.candidate === null || (entry.basis.kind === 'reference' && entry.recipe.reference === null)) && !entry.recipe.blockers.length) throw new Error('Missing recipe requires a blocker');
  }, entry => entry.id);
  return value;
}
export function readRun(value: any): Run {
  object(value, ['version', 'id', 'project', 'variant', 'item', 'caseId', 'viewport', 'criteriaSha256', 'capturedUtc', 'reference', 'candidate', 'capture', 'outcome', 'observations', 'artifacts', 'notes'], 'run'); identity(value); hash(value.criteriaSha256); utc(value.capturedUtc); text(value.notes, 'run notes');
  object(value.reference, ['identity', 'description'], 'reference'); hash(value.reference.identity); text(value.reference.description, 'reference description');
  object(value.candidate, ['revision', 'inputs'], 'candidate'); text(value.candidate.revision, 'candidate revision');
  array(value.candidate.inputs, 'inputs', pin => { object(pin, ['path', 'sha256'], 'input'); portablePath(pin.path); hash(pin.sha256); }, pin => pin.path);
  object(value.capture, ['width', 'height', 'safeArea', 'setup', 'anchors'], 'capture'); positive(value.capture.width); positive(value.capture.height); text(value.capture.safeArea, 'safe area'); text(value.capture.setup, 'setup'); array(value.capture.anchors, 'anchors', identifier);
  choice(value.outcome, ['matched', 'mismatch', 'blocked', 'unmeasured'], 'outcome');
  array(value.observations, 'observations', entry => { object(entry, ['criterion', 'result', 'note'], 'observation'); identifier(entry.criterion); choice(entry.result, ['match', 'mismatch', 'unmeasured'], 'observation result'); text(entry.note, 'observation'); }, entry => entry.criterion);
  array(value.artifacts, 'artifacts', entry => { object(entry, ['path', 'sha256', 'kind', 'side', 'recovery'], 'artifact'); portablePath(entry.path); hash(entry.sha256); choice(entry.kind, ['image', 'video', 'audio', 'observations'], 'artifact kind'); choice(entry.side, ['reference', 'candidate'], 'artifact side'); text(entry.recovery, 'recovery locator'); }, entry => entry.path);
  if (value.outcome === 'matched' && (!value.observations.length || value.observations.some((entry: any) => entry.result !== 'match'))) throw new Error('Matched run requires matching observations');
  if (value.outcome === 'mismatch' && !value.observations.some((entry: any) => entry.result === 'mismatch')) throw new Error('Mismatch run requires a mismatching observation');
  return value;
}
export function readDecision(value: any): Decision {
  object(value, ['version', 'id', 'project', 'variant', 'item', 'caseId', 'viewport', 'runId', 'runSha256', 'reviewer', 'status', 'notes', 'savedUtc', 'supersedes'], 'decision'); identity(value); identifier(value.runId); hash(value.runSha256); utc(value.savedUtc); text(value.notes, 'decision notes');
  object(value.reviewer, ['name', 'identity'], 'reviewer'); text(value.reviewer.name, 'reviewer'); choice(value.reviewer.identity, ['self-reported', 'host-verified'], 'reviewer identity');
  choice(value.status, ['accepted', 'changes-requested', 'blocked'], 'decision status'); if (value.supersedes !== null) identifier(value.supersedes); if (value.id === value.supersedes) throw new Error('Decision cannot supersede itself');
  return value;
}
export function readReferenceObservation(value: any): ReferenceObservation {
  object(value, ['version', 'project', 'variant', 'identity', 'observedUtc'], 'reference observation');
  if (value.version !== 1) throw new Error('Unsupported reference observation version');
  identifier(value.project); identifier(value.variant); hash(value.identity); utc(value.observedUtc); return value;
}
export function criteriaHash(scope: Scope, screen: Screen, entry: AcceptanceCase, viewport: string) {
  return recordHash({ project: scope.project, variant: scope.variant, item: screen.id, case: entry, viewport: scope.viewports.find(profile => profile.id === viewport) });
}
