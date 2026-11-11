import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync, createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve, relative, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { caseKey, criteriaHash, portablePath, readAssessment, readDecision, readReferenceObservation, readRun, readScope, readScreen, recordHash } from './acceptance-format.ts';
import type { AcceptanceCase, Assessment, Decision, ReferenceObservation, Run, Scope, Screen } from './acceptance-format.ts';

const directory = 'Tools/Helix/acceptance';
/** All file reads and writes stay inside the selected checkout, including symlink resolution. */
function pathIn(root: string, path: string) {
  portablePath(path);
  const base = realpathSync(root), target = resolve(base, path);
  for (let part = base, segments = path.split('/'); segments.length;) {
    part = join(part, segments.shift()!);
    if (existsSync(part) || (() => { try { lstatSync(part); return true; } catch (error: any) { if (error.code === 'ENOENT') return false; throw error; } })()) {
      const actual = realpathSync(part), rel = relative(base, actual);
      if (rel === '..' || rel.startsWith('..' + sep)) throw new Error('Acceptance path escapes checkout: ' + path);
    }
  }
  return target;
}
function json(path: string, limitMiB = 4) {
  if (statSync(path).size > limitMiB * 1024 * 1024) throw new Error('Acceptance JSON exceeds ' + limitMiB + ' MiB: ' + path);
  return JSON.parse(readFileSync(path, 'utf8'));
}
async function fileHash(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function pinState(root: string, pin: { path: string; sha256: string }) {
  const path = pathIn(root, pin.path);
  if (!existsSync(path)) return 'missing';
  return await fileHash(path) === pin.sha256 ? 'match' : 'changed';
}
export function loadAcceptance(root: string, project: string) {
  const scope = readScope(json(pathIn(root, directory + '/scope.json')));
  if (scope.project !== project) throw new Error('Acceptance project differs from connected project');
  const screens = scope.screens.map(path => readScreen(json(pathIn(root, directory + '/' + path))));
  const ids = new Set<string>();
  for (const screen of screens) {
    if (ids.has(screen.id)) throw new Error('Duplicate screen ID'); ids.add(screen.id);
    for (const entry of screen.cases) for (const viewport of entry.viewports) if (!scope.viewports.some(profile => profile.id === viewport)) throw new Error('Unknown viewport: ' + viewport);
    for (const path of screen.implementationReferences) pathIn(root, path);
    for (const entry of screen.cases) for (const path of entry.dependencies) pathIn(root, path);
  }
  return { scope, screens, evidence: evidenceLinks(root, project, screens) };
}
/** Optional historical evidence index; never used to grant verification or approval. */
function evidenceLinks(root: string, project: string, screens: Screen[]) {
  const path = pathIn(root, directory + '/evidence-links.json');
  if (!existsSync(path)) return [];
  const value = json(path);
  if (!value || Object.keys(value).sort().join() !== 'links,project,version' || value.version !== 1 || value.project !== project || !Array.isArray(value.links)) throw new Error('Invalid acceptance evidence links');
  const seen = new Set<string>();
  for (const link of value.links) {
    if (!link || Object.keys(link).sort().join() !== 'caseId,item,note,sources' || typeof link.note !== 'string' || !link.note.trim() || !Array.isArray(link.sources) || !link.sources.length || new Set(link.sources).size !== link.sources.length) throw new Error('Invalid acceptance evidence link');
    const screen = screens.find(screen => screen.id === link.item);
    if (!screen || !screen.cases.some(entry => entry.id === link.caseId)) throw new Error('Evidence link references unknown case');
    const key = JSON.stringify([link.item, link.caseId]);
    if (seen.has(key)) throw new Error('Duplicate acceptance evidence link');
    seen.add(key);
    for (const source of link.sources) pathIn(root, source);
  }
  return value.links as { item: string; caseId: string; note: string; sources: string[] }[];
}
function records<T>(root: string, kind: string, read: (value: any) => T): T[] {
  const path = pathIn(root, directory + '/' + kind);
  if (!existsSync(path)) return [];
  return readdirSync(path).filter(name => name.endsWith('.json')).sort().map(name => {
    const record = read(json(pathIn(root, directory + '/' + kind + '/' + name)));
    if (name !== (record as any).id + '.json') throw new Error('Record filename differs from ID: ' + name);
    return record;
  });
}
function target(scope: Scope, screens: Screen[], run: Pick<Run, 'project' | 'variant' | 'item' | 'caseId' | 'viewport'>) {
  if (run.project !== scope.project || run.variant !== scope.variant) throw new Error('Record project/variant differs from scope');
  const screen = screens.find(screen => screen.id === run.item);
  const entry = screen?.cases.find(entry => entry.id === run.caseId && entry.viewports.includes(run.viewport));
  if (!screen || !entry) throw new Error('Unknown acceptance case: ' + caseKey(run));
  return { screen, entry };
}
function validateRunTarget(scope: Scope, screen: Screen, entry: AcceptanceCase, run: Run) {
  if (run.criteriaSha256 !== criteriaHash(scope, screen, entry, run.viewport)) throw new Error('Run criteria differ from current case');
  const profile = scope.viewports.find(profile => profile.id === run.viewport)!;
  if (run.capture.width !== profile.width || run.capture.height !== profile.height || run.capture.safeArea !== profile.safeArea || run.capture.setup !== entry.recipe.setup) throw new Error('Run capture/setup differs from case profile');
  if (run.observations.some(observation => !entry.criteria.some(criterion => criterion.id === observation.criterion))) throw new Error('Unknown observed criterion');
  if (run.outcome === 'matched' || run.outcome === 'mismatch') {
    const gaps = runCoverageGaps(entry, run);
    if (gaps.length) throw new Error(gaps.join('; '));
  }
}
/** Required capture coverage is shared by import validation and review-gate explanations. */
function runCoverageGaps(entry: AcceptanceCase, run: Run): string[] {
  const gaps: string[] = [];
  const missingCriteria = entry.criteria.filter(criterion => !run.observations.some(observation => observation.criterion === criterion.id));
  if (missingCriteria.length) gaps.push('Missing required observation: ' + missingCriteria.map(criterion => criterion.id).join(', '));
  const missingAnchors = entry.recipe.anchors.filter(anchor => !run.capture.anchors.includes(anchor));
  if (missingAnchors.length) gaps.push('Missing event anchor: ' + missingAnchors.join(', '));
  const missingInputs = entry.dependencies.filter(path => !run.candidate.inputs.some(pin => pin.path === path));
  if (!entry.dependencies.length || missingInputs.length) gaps.push('Missing declared input pins: ' + (missingInputs.length ? missingInputs.join(', ') : 'case declares no dependencies'));
  const kind = { appearance: 'image', motion: 'video', behavior: 'observations', audio: 'audio' }[entry.dimension];
  const sides = entry.basis.kind === 'reference' ? ['reference', 'candidate'] : ['candidate'];
  for (const side of sides) if (!run.artifacts.some(artifact => artifact.kind === kind && artifact.side === side)) gaps.push('Missing required paired evidence type: ' + kind + ' / ' + side);
  return gaps;
}

function decisionHead(decisions: Decision[]) {
  if (!decisions.length) return null;
  const byId = new Map(decisions.map(decision => [decision.id, decision]));
  const replaced = new Set<string>();
  for (const decision of decisions) if (decision.supersedes !== null) {
    if (!byId.has(decision.supersedes)) throw new Error('Decision history is missing a predecessor');
    if (replaced.has(decision.supersedes)) throw new Error('Conflicting decision branches require explicit reconciliation');
    replaced.add(decision.supersedes);
  }
  const heads = decisions.filter(decision => !replaced.has(decision.id));
  if (heads.length !== 1) throw new Error('Conflicting or cyclic decision history');
  let current: Decision | undefined = heads[0];
  const seen = new Set<string>();
  while (current) { if (seen.has(current.id)) throw new Error('Cyclic decision history'); seen.add(current.id); current = current.supersedes === null ? undefined : byId.get(current.supersedes); }
  if (seen.size !== decisions.length) throw new Error('Disconnected decision history');
  return heads[0];
}
function checkDecisionRuns(decisions: Decision[], runs: Run[]) {
  for (const decision of decisions) {
    const run = runs.find(run => run.id === decision.runId);
    if (!run || caseKey(run) !== caseKey(decision) || recordHash(run) !== decision.runSha256) throw new Error('Decision run is missing, changed, or belongs to another case');
  }
}
function discrepancies(root: string, entry: AcceptanceCase) {
  return entry.discrepancies.flatMap(id => {
    const path = pathIn(root, 'Tools/Helix/discrepancies/' + id);
    if (!existsSync(path)) return [{ id, status: 'missing', path: 'Tools/Helix/discrepancies/' + id }];
    const versions = readdirSync(path).filter(name => /^[1-9][0-9]*\.json$/.test(name)).sort((a, b) => Number.parseInt(b) - Number.parseInt(a));
    if (!versions.length) return [{ id, status: 'missing', path: 'Tools/Helix/discrepancies/' + id }];
    const recordPath = 'Tools/Helix/discrepancies/' + id + '/' + versions[0];
    const record = json(pathIn(root, recordPath), 32);
    if (record.id !== id || !['open', 'blocked', 'resolved', 'accepted-deviation'].includes(record.status)) throw new Error('Invalid linked discrepancy: ' + id);
    // Deviation approval needs explicit criterion mapping before it can grant acceptance.
    return [{ id, status: record.status, path: recordPath }];
  });
}
export async function acceptanceStatus(root: string, project: string, reference?: ReferenceObservation) {
  const { scope, screens, evidence: links } = loadAcceptance(root, project);
  if (reference && (reference.project !== scope.project || reference.variant !== scope.variant)) throw new Error('Reference observation belongs to another project/variant');
  const { loadCaseAdapters, acceptanceExecutions } = await import('./acceptance-runner.ts');
  const adapters = loadCaseAdapters(root, project), executions = acceptanceExecutions(root, project);
  const { automationDefinitions } = await import('./verification-jobs.ts');
  const automation = automationDefinitions(root, project);
  const runs = records(root, 'runs', readRun), decisions = records(root, 'decisions', readDecision);
  checkDecisionRuns(decisions, runs);
  const assessments = records(root, 'assessments', readAssessment);
  for (const assessment of assessments) validateAssessmentRun(assessment, runs);
  const activeKeys = new Set<string>();
  const items = [];
  for (const screen of screens) {
    const cases = [];
    for (const entry of screen.cases) for (const viewport of entry.viewports) {
      const key = caseKey({ project: scope.project, variant: scope.variant, item: screen.id, caseId: entry.id, viewport }); activeKeys.add(key);
      const history = decisions.filter(decision => caseKey(decision) === key);
      const decision = decisionHead(history);
      const caseRuns = runs.filter(run => caseKey(run) === key).sort((a, b) => b.capturedUtc.localeCompare(a.capturedUtc) || a.id.localeCompare(b.id));
      if (caseRuns.length > 1 && caseRuns[0].capturedUtc === caseRuns[1].capturedUtc) throw new Error('Ambiguous latest runs: ' + key);
      const run = caseRuns[0];
      const assessmentsForRun = run ? assessments.filter(record => record.runId === run.id).sort((a, b) => b.assessedUtc.localeCompare(a.assessedUtc)) : [];
      if (assessmentsForRun.length > 1 && assessmentsForRun[0].assessedUtc === assessmentsForRun[1].assessedUtc) throw new Error('Ambiguous assessment timestamp');
      const latestAssessment = assessmentsForRun[0] ?? null;
      const assessmentEvidence = latestAssessment ? await Promise.all(latestAssessment.evidence.map(pin => pinState(root, pin))) : [];
      const assessmentAvailable = latestAssessment !== null && assessmentEvidence.every(state => state === 'match');
      const adapter = adapters.find(route => route.item === screen.id && route.caseId === entry.id && route.viewport === viewport);
      const execution = executions.find(run => run.item === screen.id && run.caseId === entry.id && run.viewport === viewport);
      const latestExecution = execution ? { status: execution.status, mode: execution.mode, output: execution.output, finishedUtc: execution.finishedUtc, criteriaCurrent: execution.criteriaSha256 === criteriaHash(scope, screen, entry, viewport) && adapter !== undefined && execution.routeSha256 === recordHash(adapter), artifacts: execution.artifacts } : null;
      const runner = adapter ? { retainedSources: adapter.retained.length, capture: adapter.capture?.kind ?? null, limitations: adapter.capture?.limitations ?? null } : null;
      const reasons: string[] = [];
      const linkedDiscrepancies = discrepancies(root, { ...entry, discrepancies: [...new Set([...entry.discrepancies, ...(latestAssessment?.discrepancies ?? [])])] });
      const defects = linkedDiscrepancies.filter(record => record.status !== 'resolved');
      const prior = links.find(link => link.item === screen.id && link.caseId === entry.id);
      const priorEvidence = prior ? { note: prior.note, sources: prior.sources.map(path => ({ path, available: existsSync(pathIn(root, path)) && statSync(pathIn(root, path)).isFile() })) } : null;
      let freshness: 'current' | 'needs-recheck' | 'unknown' = 'unknown';
      let availability: 'available' | 'missing' | 'unverified' = 'unverified';
      if (run) {
        if (run.criteriaSha256 !== criteriaHash(scope, screen, entry, viewport)) reasons.push('Acceptance criteria, recipe, dependencies or viewport changed');
        else validateRunTarget(scope, screen, entry, run);
        const coverageGaps = runCoverageGaps(entry, run);
        reasons.push(...coverageGaps.filter(reason => reason.startsWith('Missing declared input pins:')));
        for (const pin of run.candidate.inputs) { const state = await pinState(root, pin); if (state !== 'match') reasons.push('Candidate input ' + state + ': ' + pin.path); }
        if (reference && reference.identity !== run.reference.identity) reasons.push('Reference identity changed');
        freshness = reasons.length ? 'needs-recheck' : reference && run.candidate.inputs.length ? 'current' : 'unknown';
        const artifactStates = await Promise.all(run.artifacts.map(artifact => pinState(root, artifact)));
        availability = artifactStates.includes('missing') ? 'missing' : artifactStates.includes('changed') || !artifactStates.length ? 'unverified' : 'available';
        if (availability !== 'available') reasons.push('Evidence ' + availability);
        reasons.push(...coverageGaps.filter(reason => !reason.startsWith('Missing declared input pins:')));
      }
      if (scope.status !== 'approved') reasons.push('Acceptance scope is not approved: ' + scope.status);
      if (!run) reasons.push('No capture run exists for this case/viewport');
      else if (run.outcome !== 'matched') reasons.push('Capture verdict is ' + run.outcome + '; a scoped agent assessment does not replace a matched capture verdict');
      if (run && freshness === 'unknown') reasons.push('Capture source freshness is unknown');
      if (!reference) reasons.push('Current reference identity has not been supplied');
      if (entry.recipe.blockers.length) reasons.push(...entry.recipe.blockers);
      if (defects.length) reasons.push(...defects.map(defect => 'Linked discrepancy ' + defect.status + ': ' + defect.id));
      const decisionApplies = Boolean(decision && run && decision.runId === run.id && decision.runSha256 === recordHash(run));
      const assessmentAllowsAcceptance = !latestAssessment || (assessmentAvailable && latestAssessment.outcome === 'matched');
      if (!assessmentAllowsAcceptance) reasons.push('Agent assessment requires recheck: ' + (assessmentAvailable ? latestAssessment!.outcome : 'evidence missing or changed'));
      const canAccept = reasons.length === 0;
      const reviewRequirement = automation.find((workflow: any) => workflow.acceptanceItem === screen.id && workflow.caseId === entry.id && workflow.viewports.includes(viewport))?.review ?? 'human';
      const review = decisionApplies ? decision!.status : 'pending';
      const accepted = canAccept && (review === 'accepted' || (reviewRequirement === 'automated' && review === 'pending'));
      cases.push({ reviewRequirement, latestAssessment, assessmentAvailable, id: entry.id, viewport, runner, latestExecution, priorEvidence, linkedDiscrepancies, dimension: entry.dimension, required: entry.required, criteriaSha256: criteriaHash(scope, screen, entry, viewport), criteria: entry.criteria, basis: entry.basis, recipe: entry.recipe, verification: run ? run.outcome : entry.recipe.blockers.length ? 'blocked' : 'not-tested', review, freshness, availability, accepted, canAccept, reasons, latestRunSha256: run ? recordHash(run) : null, latestRun: run ?? null, lastDecision: decision, lastAccepted: history.filter(record => record.status === 'accepted').sort((a, b) => b.savedUtc.localeCompare(a.savedUtc))[0] ?? null });
    }
    const required = cases.filter(entry => entry.required), accepted = required.filter(entry => entry.accepted).length;
    const counts = (entries: typeof cases) => ({ required: entries.filter(entry => entry.required).length, accepted: entries.filter(entry => entry.required && entry.accepted).length });
    items.push({ id: screen.id, title: screen.title, implementation: screen.implementation, status: !required.length ? 'unconfigured' : accepted === required.length && screen.implementation === 'implemented' ? 'accepted' : 'incomplete', ...counts(cases), byViewport: Object.fromEntries(scope.viewports.map(viewport => [viewport.id, counts(cases.filter(entry => entry.viewport === viewport.id))])), byDimension: Object.fromEntries(['appearance', 'motion', 'behavior', 'audio'].map(dimension => [dimension, counts(cases.filter(entry => entry.dimension === dimension))])), cases });
  }
  return { format: 'helix-acceptance-status', version: 1, project: scope.project, variant: scope.variant, assessedUtc: new Date().toISOString(), referenceObservation: reference ?? null, scopeStatus: scope.status, exclusions: scope.exclusions, items, historicalRunIds: runs.filter(run => !activeKeys.has(caseKey(run))).map(run => run.id) };
}
/** Exclusive store lock plus atomic immutable records; an interrupted writer never publishes partial JSON. */
async function writeRecord(root: string, kind: 'runs' | 'decisions' | 'assessments', record: Run | Decision | Assessment, check: () => Promise<void>) {
  const store = pathIn(root, directory); mkdirSync(store, { recursive: true });
  const lock = pathIn(root, directory + '/.write.lock');
  try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); }
  catch (error: any) { if (error.code === 'EEXIST') throw new Error('Acceptance writer is locked; retry after it finishes or inspect the interrupted writer'); throw error; }
  try {
    const path = pathIn(root, directory + '/' + kind + '/' + record.id + '.json');
    if (existsSync(path)) { if (!isDeepStrictEqual(json(path), record)) throw new Error('Immutable record ID already exists with different content'); return { status: 'unchanged', path }; }
    await check();
    mkdirSync(pathIn(root, directory + '/' + kind), { recursive: true });
    const temporary = pathIn(root, directory + '/' + kind + '/.' + randomUUID() + '.tmp');
    try { writeFileSync(temporary, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' }); renameSync(temporary, path); }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
    return { status: 'saved', path };
  } finally { unlinkSync(lock); }
}
export async function saveRun(root: string, project: string, input: unknown) {
  const run = readRun(input);
  return writeRecord(root, 'runs', run, async () => {
    const { scope, screens } = loadAcceptance(root, project), { screen, entry } = target(scope, screens, run);
    validateRunTarget(scope, screen, entry, run);
    for (const pin of [...run.candidate.inputs, ...run.artifacts]) if (await pinState(root, pin) !== 'match') throw new Error('Run input/evidence missing or changed: ' + pin.path);
    const existing = records(root, 'runs', readRun);
    if (existing.some(record => caseKey(record) === caseKey(run) && record.capturedUtc === run.capturedUtc)) throw new Error('Ambiguous capture timestamp for this case');
  });
}
function validateAssessmentRun(assessment: Assessment, runs: Run[]) {
  const run = runs.find(run => run.id === assessment.runId);
  if (!run || caseKey(run) !== caseKey(assessment) || recordHash(run) !== assessment.runSha256) throw new Error('Assessment must pin its exact capture');
  if (assessment.assessedUtc < run.capturedUtc) throw new Error('Assessment precedes capture');
  const criteria = run.observations.map(entry => entry.criterion).sort();
  if (!isDeepStrictEqual(criteria, assessment.observations.map(entry => entry.criterion).sort())) throw new Error('Assessment must cover the captured criteria');
}
export async function saveAssessment(root: string, project: string, input: unknown) {
  const assessment = readAssessment(input);
  return writeRecord(root, 'assessments', assessment, async () => {
    const { scope, screens } = loadAcceptance(root, project); target(scope, screens, assessment);
    validateAssessmentRun(assessment, records(root, 'runs', readRun));
    for (const pin of assessment.evidence) if (await pinState(root, pin) !== 'match') throw new Error('Assessment evidence missing or changed: ' + pin.path);
    for (const id of assessment.discrepancies) if (!existsSync(pathIn(root, 'Tools/Helix/discrepancies/' + id))) throw new Error('Unknown assessment discrepancy: ' + id);
    if (records(root, 'assessments', readAssessment).some(record => record.runId === assessment.runId && record.assessedUtc === assessment.assessedUtc)) throw new Error('Ambiguous assessment timestamp');
  });
}
export async function saveDecision(root: string, project: string, input: unknown, reference?: ReferenceObservation) {
  const decision = readDecision(input);
  if (decision.reviewer.identity !== 'self-reported') throw new Error('CLI imports require self-reported reviewer identity; host verification is not implemented');
  return writeRecord(root, 'decisions', decision, async () => {
    const { scope, screens } = loadAcceptance(root, project); target(scope, screens, decision);
    const runs = records(root, 'runs', readRun), decisions = records(root, 'decisions', readDecision);
    checkDecisionRuns([...decisions, decision], runs);
    const head = decisionHead(decisions.filter(record => caseKey(record) === caseKey(decision)));
    if (decision.supersedes !== (head?.id ?? null)) throw new Error('Review changed since it was read; reload and reconcile');
    const report = await acceptanceStatus(root, project, reference);
    const item = report.items.find(item => item.id === decision.item)!, entry = item.cases.find(entry => entry.id === decision.caseId && entry.viewport === decision.viewport)!;
    if (entry.latestRun?.id !== decision.runId) throw new Error('Decision must review the latest case run');
    if (decision.status === 'accepted' && !entry.canAccept) throw new Error('Case is not eligible for acceptance: ' + entry.reasons.join('; '));
  });
}
export async function acceptanceCommand(root: string, project: string, operation: string, options: Record<string, string>) {
  if (options.folder !== undefined || options.discipline !== undefined) {
    if (!['plan', 'status'].includes(operation)) throw new Error('Folder/discipline selection supports acceptance plan or status only');
    const allowed = ['project-root', 'helix-project', 'folder', 'discipline', ...(operation === 'plan' ? ['out', 'viewport'] : ['reference'])];
    for (const key of Object.keys(options)) if (!allowed.includes(key)) throw new Error('Invalid selected acceptance option: ' + key);
    if (operation === 'plan' && !options.out) throw new Error('Acceptance plan requires --out NEW_SCRATCH_DIR');
    const { catalogStatus } = await import('./catalog.ts');
    const { selectCatalogEntries } = await import('../workbench/catalog-selection.ts');
    const reference = options.reference ? readReferenceObservation(json(resolve(root, options.reference))) : undefined;
    const status = await acceptanceStatus(root, project, reference);
    const catalog = catalogStatus(root, project, status), entries = selectCatalogEntries(catalog, options);
    const ids = new Set(entries.map(entry => entry.acceptanceItem));
    const items = status.items.filter(item => ids.has(item.id));
    const selection = { folder: options.folder ?? null, discipline: options.discipline ?? 'all', features: entries.map(entry => entry.id) };
    if (operation === 'status') return { ...status, items, selection };
    const { scope } = loadAcceptance(root, project);
    if (options.viewport !== undefined && !scope.viewports.some(viewport => viewport.id === options.viewport)) throw new Error('Unknown acceptance viewport');
    const { planAcceptanceCase } = await import('./acceptance-runner.ts');
    const plans = [];
    for (const item of items) for (const entry of item.cases) {
      if (options.viewport !== undefined && entry.viewport !== options.viewport) continue;
      const out = resolve(root, options.out, item.id, entry.id, entry.viewport);
      plans.push({ out, ...await planAcceptanceCase(root, project, item.id, entry.id, entry.viewport, out) });
    }
    return { project, selection, plans, note: 'Read-only plans for all cases of selected features. No captures executed. Discipline selects features with open/blocked work, not individual criteria.' };
  }
  if (['adapters', 'plan', 'run'].includes(operation)) {
    const { loadCaseAdapters, planAcceptanceCase, runAcceptanceCase } = await import('./acceptance-runner.ts');
    const keys = operation === 'adapters' ? [] : ['item', 'case', 'viewport', 'out', ...(operation === 'run' ? ['mode'] : [])];
    for (const key of Object.keys(options)) if (!['project-root', 'helix-project', ...keys].includes(key)) throw new Error('Invalid acceptance runner option: ' + key);
    if (operation === 'adapters') return loadCaseAdapters(root, project).map(route => ({ item: route.item, caseId: route.caseId, viewport: route.viewport, retainedSources: route.retained.length, capture: route.capture }));
    for (const key of ['item', 'case', 'viewport', 'out']) if (!options[key]) throw new Error('Acceptance runner requires --' + key);
    if (operation === 'run' && !options.mode) throw new Error('Acceptance run requires explicit --mode retained or capture');
    return operation === 'plan' ? planAcceptanceCase(root, project, options.item, options.case, options.viewport, resolve(root, options.out)) : runAcceptanceCase(root, project, options.item, options.case, options.viewport, resolve(root, options.out), options.mode);
  }
  const allowed: Record<string, string[]> = { validate: [], status: ['reference'], publish: ['reference'], 'record-run': ['spec'], 'assess': ['spec'], review: ['spec', 'reference'] };
  if (!Object.hasOwn(allowed, operation)) throw new Error('Use acceptance validate|status|publish|record-run|assess|review');
  for (const option of Object.keys(options)) if (!['project-root', 'helix-project'].includes(option) && !allowed[operation].includes(option)) throw new Error('Invalid acceptance option --' + option);
  const reference = options.reference ? readReferenceObservation(json(resolve(root, options.reference))) : undefined;
  if (operation === 'validate') { const { scope, screens } = loadAcceptance(root, project);
    for (const screen of screens) for (const path of [...screen.implementationReferences, ...screen.cases.flatMap(entry => entry.dependencies)]) if (!existsSync(pathIn(root, path))) throw new Error('Missing authored input: ' + path);
    return { status: 'valid', project, variant: scope.variant, screens: screens.length, requiredCases: screens.flatMap(screen => screen.cases).filter(entry => entry.required).reduce((count, entry) => count + entry.viewports.length, 0) }; }
  if (operation === 'status') return acceptanceStatus(root, project, reference);
  if (operation === 'publish') return publishAcceptance(root, project, reference);
  if (!options.spec) throw new Error('Acceptance record operation requires --spec FILE');
  const spec = json(resolve(root, options.spec));
  if (operation === 'assess') return saveAssessment(root, project, spec);
  return operation === 'record-run' ? saveRun(root, project, spec) : saveDecision(root, project, spec, reference);
}

/** Compatibility projection for the existing Workbench; only catalog-owned items are replaced. */
export async function publishAcceptance(root: string, project: string, reference?: ReferenceObservation) {
  const { portingDashboard } = await import('./porting-dashboard.ts');
  const state = pathIn(root, '.helix'); mkdirSync(state, { recursive: true });
  const lock = pathIn(root, '.helix/acceptance-publish.lock');
  try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); }
  catch (error: any) { if (error.code === 'EEXIST') throw new Error('Acceptance publication is already running'); throw error; }
  const temporary = pathIn(root, '.helix/acceptance-report-' + randomUUID() + '.tmp');
  const fullTemporary = pathIn(root, '.helix/acceptance-status-' + randomUUID() + '.tmp');
  try {
    const report = await acceptanceStatus(root, project, reference);
    const previous = portingDashboard(root, project).report;
    const items = (previous ? previous.items : []).filter(item => !report.items.some(current => current.id === item.id));
    for (const item of report.items) {
      const issues = item.cases.filter(entry => entry.required && !entry.accepted).map(entry => ({ severity: 'warning' as const, tool: 'helix-cli' as const, message: `${entry.id} / ${entry.viewport}: ${entry.verification}; review ${entry.review}; freshness ${entry.freshness}; evidence ${entry.availability}.`, action: entry.reasons.length ? entry.reasons.join('; ') : 'Capture the required evidence and obtain a human review.' }));
      if (issues.length > 50) throw new Error('Legacy dashboard supports at most 50 issues per item; use acceptance status for this catalog');
      items.push({ id: item.id, kind: 'screen', title: item.title, status: item.status === 'accepted' ? 'ported' : 'in-progress', summary: `Generated acceptance: ${item.accepted}/${item.required} required cases complete. Implementation: ${item.implementation}. Scope: ${report.scopeStatus}. Assessed ${report.assessedUtc}. Read acceptance status for full history and current dependency checks.`, issues, evidence: [directory + '/scope.json', '.helix/acceptance-status.json'] });
    }
    writeFileSync(fullTemporary, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    renameSync(fullTemporary, pathIn(root, '.helix/acceptance-status.json'));
    writeFileSync(temporary, JSON.stringify({ format: 'helix-porting-dashboard', version: 1, project, reportedUtc: report.assessedUtc, items }), { flag: 'wx' });
    return { ...portingDashboard(root, project, temporary), acceptance: { required: report.items.reduce((count, item) => count + item.required, 0), accepted: report.items.reduce((count, item) => count + item.accepted, 0), note: 'Generated snapshot. Reload the Workbench report; rerun acceptance publish after evidence or source changes.' } };
  } finally { for (const path of [temporary, fullTemporary, lock]) if (existsSync(path)) unlinkSync(path); }
}
