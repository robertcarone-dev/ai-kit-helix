/** Agent execution uses AI Kit's existing PM transport and acceptance records, not a second Editor runner. */
import { readFileSync } from 'node:fs';
import { catalogPath } from './catalog.ts';
import { acceptanceStatus, loadAcceptance } from './acceptance.ts';
import { criteriaHash, digest, recordHash, portablePath } from './acceptance-format.ts';
import type { ReferenceObservation } from './acceptance-format.ts';
import { captureDependencyPins } from './dependency-pins.ts';
import { pmConfig, taskReceipt } from './pm-tasks.ts';
import type { TaskPlan } from './pm-tasks.ts';
export type CheckSelection = { item: string | null; caseId: string | null; remaining: boolean };
export async function prepareAiKitChecks(root: string, project: string, selection: CheckSelection, reference?: ReferenceObservation) {
  if (!selection || Object.keys(selection).sort().join() !== 'caseId,item,remaining' || typeof selection.remaining !== 'boolean' || (selection.item !== null && typeof selection.item !== 'string') || (selection.caseId !== null && (typeof selection.caseId !== 'string' || selection.item === null))) throw new Error('Select all checks, a feature, or one case.');
  const configPath = 'Tools/Helix/acceptance/aikit.json', configBytes = readFileSync(catalogPath(root, configPath)), config = JSON.parse(configBytes.toString());
  if (!config || config.version !== 1 || Object.keys(config).sort().join() !== 'instructions,manualCases,version' || !Array.isArray(config.manualCases)) throw new Error('Invalid AI Kit acceptance configuration');
  portablePath(config.instructions);
  const instructions = readFileSync(catalogPath(root, config.instructions));
  const { scope, screens, supplemental } = loadAcceptance(root, project), report = await acceptanceStatus(root, project, reference);
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
      const rows = report.items.find(item => item.id === screen.id)!.cases.filter(row => row.id === entry.id && (!selection.remaining || !row.accepted));
      if (!rows.length) continue;
      const reason = manual.get(screen.id + '/' + entry.id);
      if (reason) { deferred.push({ item: screen.id, caseId: entry.id, viewports: rows.map(row => row.viewport), reason }); continue; }
      checks.push({ item: screen.id, caseId: entry.id, dimension: entry.dimension, basis: entry.basis, setup: entry.recipe.setup, criteria: entry.criteria, anchors: entry.recipe.anchors, inputs: captureDependencyPins(root, entry),
        viewports: rows.map(row => ({ ...scope.viewports.find(v => v.id === row.viewport)!, criteriaSha256: criteriaHash(scope, screen, entry, row.viewport), previousRun: row.latestRun?.id ?? null, verification: row.verification, complete: row.accepted })) });
    }
  }
  const title = selection.caseId ? 'Verify ' + selection.item + ' / ' + selection.caseId : selection.item ? 'Verify ' + selection.item : selection.remaining ? 'Verify remaining game scenarios' : 'Verify all game scenarios';
  const body = [
    '# ' + title,
    'Execute every selected scenario through AI Kit in owned isolated lanes. This is an execution request, not a request to add adapters or TODOs. Group compatible setup to reduce work, but return a result for every listed case and viewport. Reuse matching active AI Kit tasks instead of duplicating work from overlapping requests. Preserve concurrent work. Do not launch an Editor in the shared checkout. Use AI Kit actions, recording, task ownership and delivery; do not build a competing runner.',
    'Read the project setup instructions at ' + config.instructions + ' and the repository instructions before execution. Read Tools/Helix/toolkit/Acceptance.md for the existing result contract. The declared case setup, criteria, event anchors, basis and viewport are mandatory. A missing custom Helix capture adapter is not a blocker to AI Kit agent execution; retain other genuine setup prerequisites. Use actual production interactions and case-specific observations. Unit tests, source inspection, generic screenshots, supporting captures and a task marked done do not establish scenario coverage. When a prerequisite is unavailable, report that specific case as blocked and continue the independent cases.',
    'Return results through the existing acceptance importer: Tools/Helix/bin/helix acceptance record-run --spec PATH --project-root OWNED_CHECKOUT. Compute each inputFingerprint with recordHash(captureDependencyPins(root, case)) from the installed Helix modules. Record actual input hashes at capture time and check them against this request; if they differ, report changed inputs rather than claiming verification of the requested revision. Keep appearance/motion/audio judgment as review-needed unless supported by an applicable review. Never fabricate a human decision. Use mismatch for observed product differences and blocked/unmeasured for execution gaps. Retain the required media and observations with recoverable paths; never generate placeholder evidence.',
    'Use AI Kit delivery/integration to bring the acceptance run records and required evidence back to the requesting checkout. Workbench reads those records through its existing status and evidence paths; sending this request does not complete any case. Run acceptance validate and acceptance publish after integration. Link unresolved mismatches to the existing discrepancy workflow without duplicating findings.',
    'Project: ' + project + '\nVariant: ' + scope.variant + '\nRequesting checkout: ' + root + '\nReference observation: ' + JSON.stringify(reference ? { project: reference.project, variant: reference.variant, identity: reference.identity } : null),
    'Project execution instructions:\n' + instructions.toString(),
    'Selected cases (current state is context, not a new result):\n' + JSON.stringify(checks.map(({ inputs, ...check }) => ({ ...check, inputFingerprint: recordHash(inputs) })), null, 2),
    'Deferred human-only cases:\n' + JSON.stringify(deferred, null, 2),
  ].join('\n\n');
  const attachments = [{ path: configPath, sha256: digest(configBytes), status: 'available' as const, resolved: catalogPath(root, configPath) }, { path: config.instructions, sha256: digest(instructions), status: 'available' as const, resolved: catalogPath(root, config.instructions) }];
  const token = recordHash({ project, selection, body, attachments }), key = recordHash({ kind: 'acceptance-execution', project, selection, token });
  let blocker: string | null = checks.length ? null : 'No executable checks in this selection.';
  try { pmConfig(root); } catch (error) { blocker = String(error); }
  const plan: TaskPlan = { key, token, title, body, attachments, specs: [], blocker, receipt: taskReceipt(root, key) };
  return { ...plan, checks, deferred, scenarioCount: checks.length, viewportCount: checks.reduce((sum, check) => sum + check.viewports.length, 0) };
}
