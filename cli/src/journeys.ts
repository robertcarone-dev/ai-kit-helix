import { selectDependency, validateDependencySelectors } from './dependency-selection.ts';
import { readFileSync, existsSync } from 'node:fs';
import { catalogPath } from './catalog.ts';
/** Project-authored execution relationships. Acceptance definitions and histories remain authoritative. */
import { identifier, portablePath, recordHash } from './acceptance-format.ts';
import type { Screen } from './acceptance-format.ts';
export type JourneyCheck = { item: string; caseId: string; criteria: string[]; checkpoints: string[]; parameters?: string[]; checkpointCriteria?: { checkpoint: string; criteria: string[] }[] };
export type JourneyCheckpoint = { id: string; action: string; evidence: ('image' | 'video' | 'audio' | 'observations')[]; focus: string[]; prerequisites?: string[] };
export type JourneyBranch = { id: string; title: string; reset: string; parameters: string[]; checkpoints: JourneyCheckpoint[]; checks: JourneyCheck[] };
export type Journey = { id: string; title: string; setup: string; resources: { path: string; pointer: string }[]; branches: JourneyBranch[] };
export type Journeys = { version: 1; project: string; journeys: Journey[] };
const key = (item: string, caseId: string) => JSON.stringify([item, caseId]);
function fields(value: any, keys: string[], label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error('Invalid journey fields: ' + label);
}
function text(value: any) { if (typeof value !== 'string' || !value.trim()) throw new Error('Journey text must be nonempty'); }
function list(value: any, label: string) { if (!Array.isArray(value) || !value.length) throw new Error('Journey requires ' + label); }
function strings(value: any, label: string) { list(value, label); value.forEach(text); if (new Set(value).size !== value.length) throw new Error('Duplicate journey ' + label); }
export function readJourneys(value: any, project: string, screens: Screen[], supplemental: Map<string, unknown>): Journeys {
  fields(value, ['version', 'project', 'journeys'], 'manifest');
  if (value.version !== 1 || value.project !== project) throw new Error('Journey version/project mismatch');
  list(value.journeys, 'journeys');
  const primary = new Map(screens.flatMap(screen => screen.cases.filter(entry => entry.required && !supplemental.has(key(screen.id, entry.id))).map(entry => [key(screen.id, entry.id), entry] as const)));
  const covered = new Set<string>(), coveredCriteria = new Set<string>(), ids = new Set<string>();
  for (const journey of value.journeys) {
    fields(journey, ['id', 'title', 'setup', 'resources', 'branches'], 'journey'); identifier(journey.id); if (!/^[a-z0-9][a-z0-9-]*$/.test(journey.id)) throw new Error('Journey ID must be a lowercase slug'); text(journey.title); text(journey.setup); list(journey.branches, 'branches');
    if (!Array.isArray(journey.resources)) throw new Error('Journey resources must be an array');
    for (const resource of journey.resources) { fields(resource, ['path', 'pointer'], 'resource'); portablePath(resource.path); validateDependencySelectors([{ pointer: resource.pointer }]); }
    if (ids.has(journey.id)) throw new Error('Duplicate journey: ' + journey.id); ids.add(journey.id);
    const branches = new Set<string>();
    for (const branch of journey.branches) {
      fields(branch, ['id', 'title', 'reset', 'parameters', 'checkpoints', 'checks'], 'branch'); identifier(branch.id); text(branch.title); text(branch.reset); strings(branch.parameters, 'parameters'); list(branch.checkpoints, 'checkpoints'); list(branch.checks, 'checks');
      if (branches.has(branch.id)) throw new Error('Duplicate journey branch: ' + branch.id); branches.add(branch.id);
      const checkpoints = new Set<string>();
      for (const checkpoint of branch.checkpoints) {
        fields(checkpoint, ['id', 'action', 'evidence', 'focus', ...(checkpoint.prerequisites === undefined ? [] : ['prerequisites'])], 'checkpoint'); identifier(checkpoint.id); text(checkpoint.action); strings(checkpoint.evidence, 'evidence'); strings(checkpoint.focus, 'focus');
        if (checkpoint.evidence.some((kind: string) => !['image', 'video', 'audio', 'observations'].includes(kind))) throw new Error('Invalid journey evidence kind');
        if (checkpoint.prerequisites !== undefined && (!Array.isArray(checkpoint.prerequisites) || new Set(checkpoint.prerequisites).size !== checkpoint.prerequisites.length || checkpoint.prerequisites.some((id: string) => !checkpoints.has(id)))) throw new Error('Checkpoint prerequisites must name earlier checkpoints');
        if (checkpoints.has(checkpoint.id)) throw new Error('Duplicate journey checkpoint: ' + checkpoint.id); checkpoints.add(checkpoint.id);
      }
      const checks = new Set<string>();
      for (const check of branch.checks) {
        fields(check, ['item', 'caseId', 'criteria', 'checkpoints', ...(check.checkpointCriteria === undefined ? [] : ['checkpointCriteria']), ...(check.parameters === undefined ? [] : ['parameters'])], 'check'); const id = key(check.item, check.caseId);
        if (!primary.has(id)) throw new Error('Journey check must name a current primary case: ' + id);
        if (checks.has(id)) throw new Error('Duplicate check in journey branch: ' + id); checks.add(id); covered.add(id);
        if (check.parameters !== undefined) { strings(check.parameters, 'check parameters'); if (check.parameters.some((parameter: string) => !branch.parameters.includes(parameter))) throw new Error('Unknown check parameter'); }
        strings(check.criteria, 'criteria');
        for (const criterion of check.criteria) {
          if (!primary.get(id)!.criteria.some(value => value.id === criterion)) throw new Error('Unknown journey criterion: ' + criterion);
          coveredCriteria.add(key(id, criterion));
        }
        strings(check.checkpoints, 'checkpoints');
        if (check.checkpoints.some((id: string) => !checkpoints.has(id))) throw new Error('Unknown journey checkpoint');
        if (check.checkpoints.length > 1 && check.checkpointCriteria === undefined) throw new Error('Multiple observation checkpoints require explicit checkpoint criteria');
        if (check.checkpointCriteria !== undefined) {
          list(check.checkpointCriteria, 'checkpoint criteria');
          const mapped = new Set<string>(), criteria = new Set<string>();
          for (const binding of check.checkpointCriteria) {
            fields(binding, ['checkpoint', 'criteria'], 'checkpoint criteria');
            if (!check.checkpoints.includes(binding.checkpoint) || mapped.has(binding.checkpoint)) throw new Error('Unknown or duplicate criterion checkpoint');
            mapped.add(binding.checkpoint); strings(binding.criteria, 'checkpoint criteria');
            for (const id of binding.criteria) { if (!check.criteria.includes(id)) throw new Error('Unknown checkpoint criterion'); criteria.add(id); }
          }
          if (mapped.size !== check.checkpoints.length || criteria.size !== check.criteria.length) throw new Error('Missing checkpoint criterion coverage');
        }
      }
      if (branch.parameters.some((parameter: string) => !branch.checks.some((check: JourneyCheck) => check.parameters === undefined || check.parameters.includes(parameter)))) throw new Error('Journey parameter has no check coverage');
    }
  }
  const missing = [...primary.keys()].filter(id => !covered.has(id));
  if (missing.length) throw new Error('Primary checks missing journey coverage: ' + missing.join(', '));
  const missingCriteria = [...primary].flatMap(([id, entry]) => entry.criteria.filter(criterion => !coveredCriteria.has(key(id, criterion.id))).map(criterion => id + '/' + criterion.id));
  if (missingCriteria.length) throw new Error('Primary criteria missing journey coverage: ' + missingCriteria.join(', '));
  return value;
}
/** Include observations and their explicit prerequisites, not unrelated later actions. */
export function selectJourneys(manifest: Journeys, checks: { item: string; caseId: string; viewports: { id: string }[] }[]) {
  const selected = new Map(checks.map(check => [key(check.item, check.caseId), check]));
  return manifest.journeys.map(journey => ({ ...journey, branches: journey.branches.map(branch => {
    const bindings = branch.checks.filter(check => selected.has(key(check.item, check.caseId))).map(check => ({ ...check, viewports: selected.get(key(check.item, check.caseId))!.viewports.map(viewport => viewport.id) }));
    const needed = new Set(bindings.flatMap(check => check.checkpoints));
    for (const checkpoint of [...branch.checkpoints].reverse()) if (needed.has(checkpoint.id)) for (const id of checkpoint.prerequisites ?? []) needed.add(id);
    return { ...branch, parameters: branch.parameters.filter(parameter => bindings.some(binding => binding.parameters === undefined || binding.parameters.includes(parameter))), checks: bindings, checkpoints: branch.checkpoints.filter(checkpoint => needed.has(checkpoint.id)) };
  }).filter(branch => branch.checks.length > 0) })).filter(journey => journey.branches.length > 0);
}

export function loadJourneys(root: string, project: string, screens: Screen[], supplemental: Map<string, unknown>) {
  const path = catalogPath(root, 'Tools/Helix/acceptance/aikit.json');
  if (!existsSync(path)) return null;
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (config.version !== 2) return null;
  portablePath(config.journeys);
  return readJourneys(JSON.parse(readFileSync(catalogPath(root, config.journeys), 'utf8')), project, screens, supplemental);
}
/** A content-addressed obligation per parameter and observed checkpoint. */
export function journeyRequirements(root: string, manifest: Journeys | null, item: string, caseId: string) {
  if (!manifest) return [];
  return journeyResources(root, selectJourneys(manifest, [{ item, caseId, viewports: [] }])).flatMap(journey => journey.branches.flatMap(branch => {
    const check = branch.checks[0];
    return (check.parameters ?? branch.parameters).flatMap(parameter => check.checkpoints.map(id => {
      const checkpoint = branch.checkpoints.find(value => value.id === id)!;
      const criteria = check.checkpointCriteria === undefined ? check.criteria : check.checkpointCriteria.find(binding => binding.checkpoint === id)!.criteria;
      const needed = new Set([id]);
      for (const value of [...branch.checkpoints].reverse()) if (needed.has(value.id)) for (const prerequisite of value.prerequisites ?? []) needed.add(prerequisite);
      const definitionSha256 = recordHash({ setup: journey.setup, resources: journey.resources, reset: branch.reset, parameter, checkpoints: branch.checkpoints.filter(value => needed.has(value.id)), item, caseId, criteria });
      return { journey: journey.id, branch: branch.id, parameter, checkpoint: id, definitionSha256, criteria, evidence: checkpoint.evidence };
    }));
  }));
}
export function journeyCoverage(requirements: ReturnType<typeof journeyRequirements>, run: import('./acceptance-format.ts').Run | null, reference = false) {
  return requirements.map(requirement => {
    const checkpoint = run?.journeyCoverage?.find(record => record.journey === requirement.journey && record.branch === requirement.branch && record.parameter === requirement.parameter && record.checkpoint === requirement.checkpoint && record.definitionSha256 === requirement.definitionSha256);
    const criteriaComplete = checkpoint && requirement.criteria.every(id => checkpoint.observations.some(observation => observation.criterion === id && observation.result === 'match')) && checkpoint.observations.every(observation => requirement.criteria.includes(observation.criterion) && observation.result === 'match');
    const evidenceComplete = checkpoint && requirement.evidence.every(kind => (reference ? ['candidate', 'reference'] : ['candidate']).every(side => run!.artifacts.some(artifact => checkpoint.artifacts.includes(artifact.path) && artifact.kind === kind && artifact.side === side)));
    return { ...requirement, complete: Boolean(criteriaComplete && evidenceComplete) };
  });
}

/** Pin the selected resource definition, not a rewritten fixture or a claimed capture baseline. */
export function journeyResources<T extends Journey>(root: string, journeys: T[]) {
  const documents = new Map<string, unknown>();
  return journeys.map(journey => ({ ...journey, resources: journey.resources.map(resource => {
    if (!documents.has(resource.path)) documents.set(resource.path, JSON.parse(readFileSync(catalogPath(root, resource.path), 'utf8')));
    return { ...resource, definitionSha256: recordHash(selectDependency(documents.get(resource.path), { pointer: resource.pointer })) };
  }) }));
}
