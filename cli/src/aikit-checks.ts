import { readJourneys, selectJourneys, journeyResources } from './journeys.ts';
/** Agent execution uses AI Kit's existing PM transport and acceptance records, not a second Editor runner. */
import { readFileSync, existsSync } from 'node:fs';
import { catalogPath, catalogStatus } from './catalog.ts';
import { acceptanceStatus, loadAcceptance } from './acceptance.ts';
import { criteriaHash, digest, recordHash, portablePath } from './acceptance-format.ts';
import type { ReferenceObservation } from './acceptance-format.ts';
import { captureDependencyPins } from './dependency-pins.ts';
import { pmConfig, taskReceipt } from './pm-tasks.ts';
import type { TaskPlan } from './pm-tasks.ts';
const artifactKey = ({ path, sha256, kind, side }: { path: string; sha256: string; kind: string; side: string }) => recordHash({ path, sha256, kind, side });
export type CheckSelection = { item: string | null; caseId: string | null; remaining: boolean; journey?: string };
export async function prepareAiKitChecks(root: string, project: string, selection: CheckSelection, reference?: ReferenceObservation) {
  if (!selection || Object.keys(selection).filter(key => key !== 'journey').sort().join() !== 'caseId,item,remaining' || (selection.journey !== undefined && (typeof selection.journey !== 'string' || selection.item !== null || selection.caseId !== null)) || typeof selection.remaining !== 'boolean' || (selection.item !== null && typeof selection.item !== 'string') || (selection.caseId !== null && (typeof selection.caseId !== 'string' || selection.item === null))) throw new Error('Select all checks, a feature, or one case.');
  const configPath = 'Tools/Helix/acceptance/aikit.json', configBytes = readFileSync(catalogPath(root, configPath)), config = JSON.parse(configBytes.toString());
  if (!config || ![1, 2].includes(config.version) || Object.keys(config).sort().join() !== (config.version === 2 ? 'instructions,journeys,manualCases,version' : 'instructions,manualCases,version') || !Array.isArray(config.manualCases)) throw new Error('Invalid AI Kit acceptance configuration');
  portablePath(config.instructions);
  if (config.version === 2) portablePath(config.journeys);
  const instructions = readFileSync(catalogPath(root, config.instructions));
  const { scope, screens, supplemental } = loadAcceptance(root, project), report = await acceptanceStatus(root, project, reference);
  const journeyBytes = config.version === 2 ? readFileSync(catalogPath(root, config.journeys)) : null;
  const manifest = journeyBytes ? readJourneys(JSON.parse(journeyBytes.toString()), project, screens, supplemental) : null;
  if (selection.journey !== undefined && !manifest?.journeys.some(journey => journey.id === selection.journey)) throw new Error('Unknown journey');
  const selectedJourney = selection.journey === undefined ? null : manifest!.journeys.find(journey => journey.id === selection.journey)!;
  if (selection.item !== null && !screens.some(screen => screen.id === selection.item)) throw new Error('Unknown feature');
  if (selection.caseId !== null && !screens.find(screen => screen.id === selection.item)!.cases.some(entry => entry.required && !supplemental.has(JSON.stringify([selection.item, entry.id])) && entry.id === selection.caseId)) throw new Error('Unknown primary case');
  const manual = new Map<string, string>();
  for (const entry of config.manualCases) {
    if (!entry || Object.keys(entry).sort().join() !== 'caseId,item,reason' || typeof entry.reason !== 'string' || !entry.reason.trim() || !screens.some(screen => screen.id === entry.item && screen.cases.some(c => c.required && !supplemental.has(JSON.stringify([entry.item, c.id])) && c.id === entry.caseId))) throw new Error('Manual exception must name an existing primary case and a reason');
    const key = entry.item + '/' + entry.caseId; if (manual.has(key)) throw new Error('Duplicate manual exception'); manual.set(key, entry.reason);
  }
  const checks = [], deferred = [];
  for (const screen of screens) {
    if (selection.item !== null && screen.id !== selection.item) continue;
    for (const entry of screen.cases.filter(entry => entry.required && !supplemental.has(JSON.stringify([screen.id, entry.id])) && (selection.caseId === null || entry.id === selection.caseId))) {
      if (selectedJourney && !selectedJourney.branches.some(branch => branch.checks.some(check => check.item === screen.id && check.caseId === entry.id))) continue;
      const rows = report.items.find(item => item.id === screen.id)!.cases.filter(row => row.id === entry.id && (!selection.remaining || !row.accepted));
      if (!rows.length) continue;
      const reason = manual.get(screen.id + '/' + entry.id);
      if (reason) { deferred.push({ item: screen.id, caseId: entry.id, viewports: rows.map(row => row.viewport), reason }); continue; }
      checks.push({ item: screen.id, caseId: entry.id, dimension: entry.dimension, basis: entry.basis, setup: entry.recipe.setup, criteria: entry.criteria, anchors: entry.recipe.anchors, inputs: captureDependencyPins(root, entry),
        blockers: entry.recipe.blockers, recipe: { reference: entry.recipe.reference, candidate: entry.recipe.candidate },
        supplemental: [...supplemental].filter(([, relation]) => relation.coveredBy.some(parent => parent.item === screen.id && parent.caseId === entry.id)).map(([key]) => { const [item, caseId] = JSON.parse(key); const owner = screens.find(screen => screen.id === item)!; const entry = owner.cases.find(entry => entry.id === caseId)!; return { item, caseId, definition: { path: 'Tools/Helix/acceptance/' + scope.screens[screens.indexOf(owner)], caseId, definitionSha256: recordHash(entry) }, discrepancies: entry.discrepancies }; }),
        viewports: rows.map(row => ({ ...scope.viewports.find(v => v.id === row.viewport)!, criteriaSha256: criteriaHash(scope, screen, entry, row.viewport), previousRun: row.latestRun?.id ?? null, verification: row.verification, complete: row.accepted, work: row.accepted ? 'reuse' : row.latestRun && row.freshness === 'current' && row.availability === 'available' ? row.verification === 'mismatch' ? 'investigate' : 'review' : (row.latestRun && row.availability === 'missing') || row.supportingCases.some(source => source.availability === 'missing' && source.artifacts.some(artifact => artifact.recovery)) ? 'recover' : row.supportingCases.some(source => source.freshness === 'current' && source.availability === 'available') ? 'review' : 'capture', freshness: row.freshness, availability: row.availability, gates: row.reasons, findings: row.linkedDiscrepancies, retainedRun: row.latestRun, retainedRunSha256: row.latestRunSha256, priorEvidence: row.priorEvidence, supportingCases: row.supportingCases, journeyCoverage: row.journeyCoverage })) });
    }
  }
  const selectedJourneys = manifest ? journeyResources(root, selectJourneys(manifest, checks).filter(journey => selection.journey === undefined || journey.id === selection.journey)) : [];
  const journeys = selectedJourneys.map(journey => ({ ...journey, branches: journey.branches.map(branch => ({ ...branch, checks: branch.checks.map(binding => ({ ...binding, coverage: checks.find(check => check.item === binding.item && check.caseId === binding.caseId)!.viewports.map(viewport => ({ viewport: viewport.id, obligations: viewport.journeyCoverage.filter(value => value.journey === journey.id && value.branch === branch.id) })) })) })) }));
  const obligations = checks.map(check => ({ item: check.item, caseId: check.caseId, branches: manifest ? manifest.journeys.flatMap(journey => journey.branches.filter(branch => branch.checks.some(binding => binding.item === check.item && binding.caseId === check.caseId)).map(branch => ({ journey: journey.id, branch: branch.id, criteria: branch.checks.find(binding => binding.item === check.item && binding.caseId === check.caseId)!.criteria, selected: journeys.some(selected => selected.id === journey.id && selected.branches.some(value => value.id === branch.id)) }))) : [] }));
  const evidence = new Map<string, any>();
  for (const check of checks) for (const viewport of check.viewports) {
    const sources = [{ item: check.item, caseId: check.caseId, viewport: viewport.id, captureFrom: { item: check.item, caseId: check.caseId }, latestRun: viewport.retainedRun, latestRunSha256: viewport.retainedRunSha256, artifacts: viewport.retainedRun?.artifacts ?? [], freshness: viewport.freshness, availability: viewport.availability }, ...viewport.supportingCases];
    for (const source of sources) for (const artifact of source.artifacts) {
      const id = artifactKey(artifact), existing = evidence.get(id);
      const consumer = { item: check.item, caseId: check.caseId, viewport: viewport.id, source: { item: source.item, caseId: source.caseId, viewport: source.viewport, captureFrom: source.captureFrom, runId: source.latestRun!.id, runSha256: source.latestRunSha256 }, freshness: source.freshness, availability: source.availability };
      if (existing) { existing.consumers.push(consumer); if (!existing.recoveries.includes(artifact.recovery)) existing.recoveries.push(artifact.recovery); }
      else evidence.set(id, { id, path: artifact.path, sha256: artifact.sha256, kind: artifact.kind, side: artifact.side, recoveries: [artifact.recovery], consumers: [consumer] });
    }
  }
  const catalog = manifest && existsSync(catalogPath(root, 'Tools/Helix/catalog/catalog.json')) ? catalogStatus(root, project, report) : null;
  const findingMap = new Map<string, any>();
  for (const item of catalog?.entries ?? []) {
    if (!checks.some(check => check.item === item.acceptanceItem) && !(selection.item === null && selection.journey === undefined && item.scope === 'tooling')) continue;
    for (const finding of item.issues) findingMap.set(finding.id, { ...finding, recordSha256: digest(readFileSync(catalogPath(root, finding.path))) });
  }
  const findings = [...findingMap.values()];
  const title = selection.journey ? 'Verify journey ' + selection.journey : selection.caseId ? 'Verify ' + selection.item + ' / ' + selection.caseId : selection.item ? 'Verify ' + selection.item : selection.remaining ? 'Verify remaining game journeys' : 'Verify all game journeys';
  const instructionsBody = [
    '# ' + title,
    'Execute the grouped journey plan through AI Kit in owned isolated lanes. Return a result for every selected case, criterion and viewport. Follow branch reset boundaries and parameter variants; never assume one variant covers the others. Record once per compatible branch and share original evidence with region/event-window indexes. A branch is not a new acceptance case. Reuse and review current evidence first; recover missing originals before deciding to capture. For review work, inspect coverage and capture only genuinely missing observations; a pending human decision alone never requires another capture. Investigate recorded mismatches before rerunning. Reuse matching active AI Kit tasks instead of duplicating work from overlapping requests. Preserve concurrent work. Do not launch an Editor in the shared checkout. Use AI Kit actions, recording, task ownership and delivery; do not build a competing runner.',
    'Read the project setup instructions at ' + config.instructions + ' and the repository instructions before execution. Read Tools/Helix/toolkit/Acceptance.md for the existing result contract. The declared case setup, criteria, event anchors, basis and viewport are mandatory. A missing custom Helix capture adapter is not a blocker to AI Kit agent execution; retain other genuine setup prerequisites. Use actual production interactions and case-specific observations. Unit tests, source inspection, generic screenshots, supporting captures and a task marked done do not establish scenario coverage. When a prerequisite is unavailable, report that specific case as blocked and continue the independent cases.',
    'Return results through the existing acceptance importer: Tools/Helix/bin/helix acceptance record-run --spec PATH --project-root OWNED_CHECKOUT. Compute each inputFingerprint with recordHash(captureDependencyPins(root, case)) from the installed Helix modules. Record actual input hashes at capture time and check them against this request; if they differ, report changed inputs rather than claiming verification of the requested revision. Keep appearance/motion/audio judgment as review-needed unless supported by an applicable review. Never fabricate a human decision. Use mismatch for observed product differences and blocked/unmeasured for execution gaps. Retain the required media and observations with recoverable paths; never generate placeholder evidence.',
    'For reference freshness, use the same identity producer as the requesting Workbench: referenceObservation(root, referenceRoot, project) from Tools/Helix/toolkit/workbench/acceptance-backend.ts hashes Tools/Helix/acceptance/reference-inputs.json. Retain observations before and after reference capture and require unchanged identity. Set run.reference.identity to that observed identity; retain the separate served runtime identity in the original capture receipts. Never hash a runtime receipt as a substitute, copy the request identity without verification, or backdate a current source observation onto older media. If source proof is missing, preserve unknown freshness and collect only the missing reference evidence. Deliver the source observations with shared originals so the receiving checkout can recompute current identity and reuse compatible evidence.',
    'Use AI Kit delivery/integration to bring the acceptance run records and required evidence back to the requesting checkout. Workbench reads those records through its existing status and evidence paths; sending this request does not complete any case. Run acceptance validate and acceptance publish after integration. Link unresolved mismatches to the existing discrepancy workflow without duplicating findings.',
    'Project: ' + project + '\nVariant: ' + scope.variant + '\nRequesting checkout: ' + root + '\nReference observation: ' + JSON.stringify(reference ? { project: reference.project, variant: reference.variant, identity: reference.identity } : null),
    'Project execution instructions:\n' + instructions.toString(),
  ].join('\n\n');
  const attachments = [{ path: configPath, sha256: digest(configBytes), status: 'available' as const, resolved: catalogPath(root, configPath) }, { path: config.instructions, sha256: digest(instructions), status: 'available' as const, resolved: catalogPath(root, config.instructions) }];
  if (journeyBytes) attachments.push({ path: config.journeys, sha256: digest(journeyBytes), status: 'available', resolved: catalogPath(root, config.journeys) });
  const packetFiles = manifest ? journeys.map(journey => {
    const keys = new Set(journey.branches.flatMap(branch => branch.checks.map(check => JSON.stringify([check.item, check.caseId]))));
    const selectedChecks = checks.filter(check => keys.has(JSON.stringify([check.item, check.caseId])));
    const selectedItems = new Set(selectedChecks.map(check => check.item));
    const selectedFindingIds = new Set((catalog?.entries ?? []).filter(item => selectedItems.has(item.acceptanceItem)).flatMap(item => item.issues.map(issue => issue.id)));
    const packetJourney = { ...journey, branches: journey.branches.map(branch => ({ ...branch, checks: branch.checks.map(({ coverage, ...binding }) => ({ ...binding,
      requirements: coverage[0].obligations.map(({ parameter, checkpoint, definitionSha256 }) => ({ parameter, checkpoint, definitionSha256 })),
      coverage: coverage.map(row => ({ viewport: row.viewport, reusable: row.obligations.flatMap((obligation, index) => obligation.complete ? [index] : []) })),
    })) })) };
    const details = { version: 1, project, selection, journey: packetJourney, obligations: obligations.filter(check => keys.has(JSON.stringify([check.item, check.caseId]))), checks: selectedChecks.map(({ inputs, ...check }) => ({ ...check, inputFingerprint: recordHash(inputs), viewports: check.viewports.map(({ retainedRun, journeyCoverage, supportingCases, ...viewport }) => ({ ...viewport, supportingCases: supportingCases.map(({ artifacts, ...source }) => ({ ...source, artifacts: artifacts.map(artifactKey) })), retainedRun: retainedRun ? { id: retainedRun.id, capturedUtc: retainedRun.capturedUtc, reference: retainedRun.reference, path: 'Tools/Helix/acceptance/runs/' + retainedRun.id + '.json', recordSha256: recordHash(retainedRun), artifacts: retainedRun.artifacts.map(artifactKey), notes: retainedRun.notes } : null })) })), findings: findings.filter(finding => selectedFindingIds.has(finding.id)).map(({ id, status, revision, path, recordSha256 }) => ({ id, status, revision, path, recordSha256 })), evidence: [...evidence.values()].filter(artifact => artifact.consumers.some((consumer: any) => keys.has(JSON.stringify([consumer.item, consumer.caseId])))) };
    return { name: 'details-journey-' + journey.id + '.json', content: JSON.stringify(details, null, 2) + '\n' };
  }) : [];
  if (manifest) packetFiles.push({ name: 'details-history.json', content: JSON.stringify({ version: 1, project, findings, deferred, catalogGaps: catalog?.unmappedDiscrepancies ?? [] }, null, 2) + '\n' });
  const body = manifest ? [
    instructionsBody,
    'Dispatch one compatible branch suite at a time. Read only its attached details file; do not load all histories or media into the PM context. Reuse existing matching assignments. Each packet binding lists requirements once, with parameter, checkpoint and definitionSha256. Its per-viewport coverage.reusable array contains zero-based indexes into those requirements; all other indexes remain open. Resolve criteria from checkpointCriteria (or binding.criteria for a single checkpoint) and evidence kinds from the checkpoint. Reuse complete obligations; execute only incomplete parameter/checkpoint observations plus necessary prerequisites. Return journeyCoverage entries with the exact journey, branch, parameter, checkpoint and definitionSha256, checkpoint-specific criterion observations and artifact paths referencing pinned run artifacts. Checkpoint criteria are authoritative: do not pool observations across checkpoints. Each parameter label is one variant or ordered sequence; record every listed variant independently, sharing original media where compatible. Partial progress uses unmeasured runs. Carry forward still-current coverage and its original pinned artifacts into each cumulative run; matched requires every obligation. Shared checks can span suites: aggregate scoped observations before recording a matched case. Keep incomplete checks unmeasured, never infer coverage from a completed suite.',
    'Journey packets:\n' + journeys.map((journey, index) => '- ' + journey.title + ' [' + journey.id + ']: ' + journey.branches.length + ' branches; ' + packetFiles[index].name + '; SHA-256 ' + digest(packetFiles[index].content) + '\n  ' + journey.branches.map(branch => branch.id).join(', ')).join('\n'),
    'Existing result contract: preserve every case/viewport/criterion, original hash-pinned media and source receipts. Region coordinates and clip-relative event windows index shared originals. Separate product-only observations from reference comparisons. Branch resets and parameter variants are mandatory. Supplemental regressions and resolved/deviation history remain scoped context, never automatic passes.',
    'Deferred human-only checks: ' + JSON.stringify(deferred),
    'Cross-cutting/tooling history and deferred work: details-history.json; SHA-256 ' + digest(packetFiles[packetFiles.length - 1].content),
    'Catalog mapping gaps: ' + JSON.stringify(catalog?.unmappedDiscrepancies ?? []),
  ].join('\n\n') : instructionsBody + '\n\nSelected checks:\n' + JSON.stringify(checks.map(({ inputs, ...check }) => ({ ...check, inputFingerprint: recordHash(inputs) })), null, 2) + '\nDeferred checks:\n' + JSON.stringify(deferred);
  const token = recordHash({ project, selection, body, attachments, packetFiles }), key = recordHash({ kind: 'acceptance-execution', project, selection, token });
  let blocker: string | null = checks.length ? null : 'No executable checks in this selection.';
  try { pmConfig(root); } catch (error) { blocker = String(error); }
  const plan: TaskPlan = { key, token, title, body, attachments, packetFiles, specs: [], blocker, receipt: taskReceipt(root, key) };
  return { ...plan, checks, deferred, journeys, obligations, findings, catalogGaps: catalog?.unmappedDiscrepancies ?? [], journeyOptions: manifest ? manifest.journeys.map(journey => ({ id: journey.id, title: journey.title })) : [], journeyCount: journeys.length, branchCount: journeys.reduce((sum, journey) => sum + journey.branches.length, 0), evidence: [...evidence.values()], workCounts: Object.fromEntries(['reuse', 'review', 'investigate', 'recover', 'capture'].map(work => [work, checks.flatMap(check => check.viewports).filter(viewport => viewport.work === work).length])), scenarioCount: checks.length, viewportCount: checks.reduce((sum, check) => sum + check.viewports.length, 0) };
}

/** CLI planning stays bounded; full criteria and immutable detail snapshots remain explicitly available. */
export function summarizeAiKitChecks(plan: Awaited<ReturnType<typeof prepareAiKitChecks>>) {
  return { title: plan.title, token: plan.token, key: plan.key, blocker: plan.blocker, receipt: plan.receipt, journeyCount: plan.journeyCount, branchCount: plan.branchCount, checkCount: plan.scenarioCount, viewportCount: plan.viewportCount, workCounts: plan.workCounts,
    journeys: plan.journeys.map(journey => ({ id: journey.id, title: journey.title, branches: journey.branches.map(branch => ({ id: branch.id, title: branch.title, checks: branch.checks.length })) })),
    deferred: plan.deferred, catalogGaps: plan.catalogGaps, evidenceCount: plan.evidence.length, findingCount: plan.findings.length,
    packets: plan.packetFiles.map(file => ({ name: file.name, bytes: Buffer.byteLength(file.content), sha256: digest(file.content) })),
    detailCommand: 'Use the same plan selection with --format full for criteria, checkpoints, evidence and request contents.' };
}
