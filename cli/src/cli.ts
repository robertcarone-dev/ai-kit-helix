import { registerComparison, comparisonLinks, comparisons } from './comparison-index.ts';
import { processExited } from './process-lock.ts';
import { unityPlan, unityRevision } from './unity-plan.ts';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  openSync,
  closeSync,
  renameSync,
} from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { root, stateDir, readConfig, adapterSettings, loadStep, sha } from './config.ts';
import { discover, assets } from './discovery.ts';

/** Short-lived command client. The detached host owns the browser between invocations. */
const file = join(stateDir, 'connection.json');
const help = `helix — project-owned local reference tools (Node >=22.18)
  catalog status|tree [--folder ID] [--discipline dev|ta|shared|unassigned] [--scope game|tooling|reference-only|all] [--format json|text]
  catalog validate
  resolution status --finding ID
  resolution review --spec FILE
  acceptance validate|summary|status|publish [--reference CURRENT_REFERENCE_JSON]
  acceptance record-run|assess|review --spec RECORD_JSON [--reference CURRENT_REFERENCE_JSON]
  evidence compact --directory BATCH [--apply true]
  evidence recover --path ORIGINAL --out NEW_FILE
  acceptance adapters
  acceptance status --folder ID [--discipline dev|ta|shared|unassigned]
  acceptance plan --folder ID --out NEW_SCRATCH_DIR [--discipline dev|ta|shared|unassigned] [--viewport ID]
  acceptance plan|run --item ID --case ID --viewport ID --out NEW_SCRATCH_DIR [--mode retained|capture]
  discrepancy-resume [--feature NAME] [--assignment ID] [--status active|open|blocked|resolved|accepted-deviation|all]
  discrepancy-save --spec FILE [--after REVISION]
  discrepancy-recover --id ID [--issue ISSUE] [--board-root OWNER_CHECKOUT]
  discrepancy-rerun --id ID --out SCRATCH_DIR [--execute yes]
  fixture-list | fixture-create --spec FILE
  fixture-record ID --out NEW_DIR
  handoff-owner --handoff ZIP --unity-project IDLE_ISOLATED_DIR --out EMPTY_DIR
  fixture-handoff --recording DIR --notes JSON_FILE --out NEW_ZIP
  doctor | resolve
  unity-connection [--helix-project SLUG | --project-root DIR]
  assets [--match TEXT]
  unity-plan SCENARIO --out DIR [--viewport phone|tablet]
  start [--viewport phone|tablet] [--workbench yes] [--url http://127.0.0.1:PORT/...]
  status | reset | stop
  recover                       recheck timed-out scenario readiness; no setup replay
  scenario NAME
  workbench comparisons [--item ID] | --evidence FILE --item ID [--issue NUMBER] | --from-report yes
  workbench feedback --comparison ID
  workbench prepare|refresh|evidence also accept --item ID [--issue NUMBER]
  workbench dashboard [--spec FILE]  read or publish the connected checkout status
  workbench list|status|reset|stop
  workbench run NAME --level N --seed N
  workbench action ACTION | workbench checkpoint LABEL
  workbench export --out NEW_DIR
  workbench evidence --source EVIDENCE_DIR --out NEW_DIR
  workbench prepare --spec REVIEW_SPEC --out NEW_DIR
  workbench review-summary --decisions REVIEWS_JSON --evidence EVIDENCE_JSON
  workbench compare-revisions --previous EVIDENCE_JSON --evidence EVIDENCE_JSON --out NEW_FILE
  workbench refresh --spec REVIEW_SPEC --decisions REVIEWS_JSON --previous EVIDENCE_JSON --out NEW_DIR
  look [--match TEXT]
  scene-record --out EMPTY_DIR [--duration SECONDS] [--interval-ms MS] [--profile NAME]
  material-keywords --out EMPTY_DIR
  sprite-usage --spec FILE --out EMPTY_DIR
  render-trace --spec FILE --out EMPTY_DIR
  render-inspect --spec FILE --out EMPTY_DIR
  recording-sheet --spec FILE --out EMPTY_DIR
  vfx-compare --spec FILE --out NEW_DIR
  scene-motion --reference JSON --candidate JSON --spec JSON --out EMPTY_DIR
  objects list [--match TEXT] [--engine phaser|three]
  objects selector|resolve|inspect|explain also accept --engine three
  objects selector ID [--out NEW_FILE]
  objects resolve --selector FILE
  objects inspect|explain [ID | --selector FILE]
  objects capture [ID | --selector FILE] --view context|isolated --out NEW_DIR
  scene-look [--profile NAME]    read-only hierarchy and scene measurements
  scene-compare --reference JSON --candidate JSON --spec JSON --out EMPTY_DIR
  scene-report --reference RECEIPT --candidate RECEIPT --spec JSON --out EMPTY_DIR
  scene-case --spec MATRIX --out SCRATCH_DIR [--execute yes] [--ai-kit PATH]
  capture-coverage --spec FILE [--inventory FILE] [--basis retained|current] --out EMPTY_DIR
  conversion-plan --spec MANIFEST --out EMPTY_DIR
  ui-look [--match TEXT]          UI metrics and semantic bindings
  step JSON                     press/drag/hover/pointerDown/pointerUp/wheel/wait/assert/script
  capture NAME [--out EMPTY_DIR] [--scene-profile NAME] [--dependencies FILE]
  record NAME [--scenario ID] [--after reset|stop] [--duration SECONDS] [--out EMPTY_DIR]  max 30s
  ui-assets --spec JSON --out EMPTY_DIR
  ui-plan --spec JSON --out EMPTY_DIR
  ui-impact --spec JSON [--previous JSON] --out EMPTY_DIR
  visual-owner --spec FILE --out EMPTY_DIR
  ui-layout-trace --reference RECEIPT --candidate RECEIPT --spec JSON --out EMPTY_DIR
  ui-compositing-compare --spec FILE --out EMPTY_DIR
  typography-compare --reference RECEIPT --candidate RECEIPT --spec JSON --out EMPTY_DIR
  ui-compare --reference RECEIPT --candidate RECEIPT --spec JSON --out EMPTY_DIR
  batch --spec JSON --out EMPTY_DIR [--workers 1|2] [--resume yes]
  ui-matrix --spec JSON --out EMPTY_DIR [--execute yes] [--ai-kit PATH]
  debug-image --input PNG --out EMPTY_DIR
  debug-capture --view MODE --out EMPTY_DIR
  compare --reference PNG --candidate PNG --out EMPTY_DIR [--regions JSON]
Every command accepts --helix-project SLUG to use the Workbench connection.
--project-root DIR overrides it without changing the saved connection. Otherwise discover from the working directory.\nRelative file paths are project-relative. Config: Tools/Helix/reference.json; optional reference.local.json top-level overrides.
unity-revision prints Git metadata for a manual comparison's unity-revision.json receipt.
Start discovers the configured project/variant and opens local Helix Desktop if needed.
Helix serves source/assets and starts its preview on demand; stop closes only our browser.
Session/evidence state is per checkout in .helix/. No AI Kit installation required.`;
function connection() {
  if (!existsSync(file)) throw new Error('No session. Run helix start.');
  const s = JSON.parse(readFileSync(file, 'utf8'));
  if (s.projectRoot !== root) throw new Error('Session belongs to another checkout.');
  return s;
}

/** Cleanup succeeds only for an absent session or a confirmed exited owner. */
async function finishStop(owned: any) {
  for (let i = 0; i < 100; i++) {
    if (processExited(owned.pid)) {
      if (existsSync(file) && connection().token === owned.token) rmSync(file);
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Browser owner has not exited; inspect ' + join(stateDir, 'host.log') + ' before restarting.');
}

/** Exchange one newline-delimited JSON message with the checkout’s token-authenticated host. */
export function request(s: any, data: any, timeout = 65000): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: s.port });
    let body = '';
    socket.setTimeout(timeout, () =>
      socket.destroy(new Error('Request timed out; inspect status before retrying.')),
    );
    socket.on('error', reject);
    socket.on('connect', () => socket.write(JSON.stringify({ ...data, token: s.token }) + '\n'));
    socket.on('data', (chunk) => {
      body += chunk;
      if (body.length > 8_000_000) {
        socket.destroy(new Error('Response too large.'));
        return;
      }
      if (!body.includes('\n')) return;
      socket.end();
      try {
        const r = JSON.parse(body.split('\n')[0]);
        if (!r.ok) reject(new Error(r.error));
        else resolve(r.result);
      } catch (e) {
        reject(e);
      }
    });
    socket.on('end', () => {
      if (!body.includes('\n')) reject(new Error('Host ended without a response.'));
    });
  });
}

async function main() {
  const args = process.argv.slice(2),
    command = args.shift();
  const options: Record<string, string> = {},
    pos: string[] = [];
  while (args.length) {
    const a = args.shift()!;
    if (a.startsWith('--')) {
      if (a === '--help') {
        console.log(help);
        return;
      }
      const v = args.shift();
      if (!v || v.startsWith('--')) throw new Error('Missing value for ' + a);
      options[a.slice(2)] = v;
    } else pos.push(a);
  }
  if (!command || ['help', '--help', '-h'].includes(command)) {
    console.log(help);
    return;
  }
  const allowed: Record<string, string[]> = {
    resolution: ['finding', 'spec'],
    catalog: ['folder', 'discipline', 'scope', 'format'],
    evidence: ['directory', 'apply', 'path', 'out'],
    acceptance: ['folder', 'discipline', 'spec', 'reference', 'item', 'case', 'viewport', 'out', 'mode'],
    'discrepancy-resume': ['feature', 'assignment', 'status'],
    'discrepancy-recover': ['id', 'issue', 'board-root'],
    'discrepancy-rerun': ['id', 'out', 'execute', 'ai-kit'],
    'discrepancy-save': ['spec', 'after'],
    'fixture-list': [],
    'fixture-create': ['spec'],
    'fixture-record': ['out'],
    'handoff-owner': ['handoff', 'unity-project', 'out'],
    'fixture-handoff': ['recording', 'notes', 'out'],
    doctor: [],
    'unity-connection': [],
    resolve: [],
    assets: ['match'],
    'unity-plan': ['out', 'viewport'],
    'unity-revision': [],
    start: ['viewport', 'url', 'workbench'],
    status: [],
    reset: [],
    stop: [],
    recover: [],
    scenario: [],
    workbench: ['level', 'seed', 'out', 'source', 'spec', 'decisions', 'evidence', 'previous', 'item', 'issue', 'from-report', 'comparison'],
    look: ['match'],
    objects: ['match', 'view', 'out', 'selector', 'engine'],
    'ui-look': ['match'],
    'scene-look': ['profile'],
    'scene-record': ['out', 'duration', 'interval-ms', 'profile'],
    'material-keywords': ['out'],
    'sprite-usage': ['spec', 'out'],
    'render-trace': ['spec', 'out'],
    'render-inspect': ['spec', 'out'],
    'recording-sheet': ['spec', 'out'],
    'vfx-compare': ['spec', 'out'],
    'scene-motion': ['reference', 'candidate', 'spec', 'out'],
    'scene-report': ['reference', 'candidate', 'spec', 'out'],
    'capture-coverage': ['spec', 'inventory', 'basis', 'out'],
    'conversion-plan': ['spec', 'out'],
    'scene-case': ['spec', 'out', 'execute', 'ai-kit'],
    'scene-compare': ['reference', 'candidate', 'spec', 'out'],
    step: [],
    capture: ['out', 'scene-profile', 'dependencies'],
    record: ['out', 'duration', 'scenario', 'after'],
    'ui-assets': ['spec', 'out'],
    'ui-plan': ['spec', 'out'],
    'ui-impact': ['spec', 'previous', 'out'],
    'visual-owner': ['spec', 'out'],
    'ui-layout-trace': ['reference', 'candidate', 'spec', 'out'],
    'ui-compositing-compare': ['spec', 'out'],
    'typography-compare': ['reference', 'candidate', 'spec', 'out'],
    'ui-compare': ['reference', 'candidate', 'spec', 'out'],
    batch: ['spec', 'out', 'workers', 'resume'],
    'ui-matrix': ['spec', 'out', 'execute', 'ai-kit'],
    compare: ['reference', 'candidate', 'out', 'regions'],
    'debug-image': ['input', 'out'],
    'debug-capture': ['view', 'out'],
  };
  if (!allowed[command]) throw new Error('Unknown command ' + command);
  for (const k of Object.keys(options))
    if (!['project-root', 'helix-project'].includes(k) && !allowed[command].includes(k))
      throw new Error('Unknown option --' + k);
  if (command === 'resolution') {
    const { resolutionStatus, reviewResolution } = await import('./resolution.ts');
    if (pos.length !== 1 || !['status', 'review'].includes(pos[0])) throw new Error('Use resolution status|review');
    const project = adapterSettings(root).helix.project;
    if (pos[0] === 'status') { if (!options.finding || options.spec) throw new Error('Use resolution status --finding ID'); return resolutionStatus(root, project, options.finding); }
    if (!options.spec || options.finding) throw new Error('Use resolution review --spec FILE');
    return reviewResolution(root, project, JSON.parse(readFileSync(resolve(root, options.spec), 'utf8')));
  }
  if (command === 'catalog') {
    if (pos.length !== 1 || !['status', 'tree', 'validate'].includes(pos[0])) throw new Error('Use catalog status|tree|validate');
    const { catalogStatus, catalogTree, renderCatalogTree } = await import('./catalog.ts');
    const { selectCatalogEntries } = await import('../workbench/catalog-selection.ts');
    const { acceptanceStatus } = await import('./acceptance.ts');
    const project = adapterSettings(root).helix.project;
    const acceptance = existsSync(join(root, 'Tools/Helix/acceptance/scope.json')) ? await acceptanceStatus(root, project) : null;
    const report = catalogStatus(root, project, acceptance);
    if (pos[0] === 'validate') {
      for (const key of ['folder', 'discipline', 'scope', 'format']) if (options[key] !== undefined) throw new Error('Catalog validate does not take --' + key);
      return { status: 'valid', ...report.summary, unmappedDiscrepancies: report.unmappedDiscrepancies, warnings: report.warnings };
    }
    if (options.format !== undefined && !['json', 'text'].includes(options.format)) throw new Error('Use --format json|text');
    if (pos[0] !== 'tree' && options.format === 'text') throw new Error('Text format is only available for catalog tree');
    const entries = selectCatalogEntries(report, options);
    if (pos[0] === 'tree') {
      const tree = catalogTree(report, entries);
      if (options.format === 'json') return { project, selection: { folder: options.folder ?? null, discipline: options.discipline ?? 'all', scope: options.scope ?? 'all' }, tree };
      console.log(tree.length ? renderCatalogTree(tree) : 'No matching features.'); return;
    }
    return { ...report, entries, selection: { folder: options.folder ?? null, discipline: options.discipline ?? 'all', scope: options.scope ?? 'all' }, summary: { total: entries.length, game: entries.filter(entry => entry.scope === 'game').length, definedCoverage: entries.filter(entry => entry.acceptance !== null).length, accepted: entries.filter(entry => entry.acceptance?.status === 'accepted').length, discrepancies: new Set(entries.flatMap(entry => entry.issues.map(issue => issue.id))).size } };
  }
  if (command === 'evidence') {
    const { compactEvidence, recoverEvidence } = await import('./evidence-retention.ts');
    const allowed = pos[0] === 'compact' ? ['directory', 'apply'] : ['path', 'out'];
    for (const key of Object.keys(options)) if (!['project-root', 'helix-project', ...allowed].includes(key)) throw new Error('Invalid evidence option');
    if (pos.length !== 1) throw new Error('Use evidence compact|recover');
    if (pos[0] === 'compact' && options.directory) {
      if (options.apply !== undefined && options.apply !== 'true') throw new Error('Use --apply true to compact');
      return compactEvidence(root, options.directory, options.apply === 'true');
    }
    if (pos[0] === 'recover' && options.path && options.out) return recoverEvidence(root, options.path, options.out);
    throw new Error('Use evidence compact --directory BATCH [--apply true] or evidence recover --path ORIGINAL --out NEW_FILE');
  }
  if (command === 'acceptance') {
    if (pos.length !== 1) throw new Error('Supply one acceptance operation');
    const { acceptanceCommand } = await import('./acceptance.ts');
    return acceptanceCommand(root, adapterSettings(root).helix.project, pos[0], options);
  }
  if (command === 'objects') {
    if (options.engine !== undefined && !['phaser', 'three'].includes(options.engine)) throw new Error('Object engine must be phaser or three.');
    if (options.engine === 'three' && pos[0] === 'capture') throw new Error('Three object discovery is read-only. Use the existing debug-capture or scene capture tools for rendering.');
    const operation = pos[0];
    const targetOperation = ['inspect', 'explain', 'capture'].includes(operation);
    if (!['list', 'selector', 'resolve', 'inspect', 'explain', 'capture'].includes(operation)) throw new Error('Use objects list|selector|resolve|inspect|explain|capture.');
    if (pos.length !== (operation === 'selector' || (targetOperation && !options.selector) ? 2 : 1)) throw new Error('Supply exactly one object ID or --selector FILE for the target.');
    if (operation === 'resolve' && !options.selector) throw new Error('Object resolve requires --selector FILE.');
    if (operation === 'capture' && (!options.out || !['context', 'isolated'].includes(options.view))) throw new Error('Object capture requires --view context|isolated and --out NEW_DIR.');
    for (const option of Object.keys(options)) {
      if (['project-root', 'helix-project', 'engine'].includes(option)) continue;
      if (!(operation === 'list' && option === 'match') && !(operation === 'capture' && ['view', 'out'].includes(option)) && !(operation === 'selector' && option === 'out') && !((targetOperation || operation === 'resolve') && option === 'selector'))
        throw new Error('Option --' + option + ' is not valid for objects ' + operation);
    }
  }
  if (command === 'unity-connection') {
    if (pos.length) throw new Error('unity-connection takes no positional arguments.');
    const adapter = adapterSettings(root);
    return { project: adapter.helix.project, projectRoot: root, source: options['project-root'] ? 'explicit override' : options['helix-project'] ? 'saved Workbench connection' : 'working directory' };
  }
  if (command === 'workbench') {
    const operation = pos[0];
    const takesName = ['run', 'action', 'checkpoint'].includes(operation);
    if (!['list', 'status', 'run', 'reset', 'stop', 'action', 'checkpoint', 'export', 'evidence', 'prepare', 'review-summary', 'refresh', 'compare-revisions', 'dashboard', 'comparisons', 'feedback'].includes(operation) || pos.length !== (takesName ? 2 : 1))
      throw new Error('Use workbench list|status|run NAME|reset|stop|action NAME|checkpoint LABEL|export|evidence|prepare|review-summary|refresh|compare-revisions|dashboard|comparisons|feedback.');
    if (operation === 'run' && (options.level === undefined || options.seed === undefined))
      throw new Error('Workbench run requires explicit --level and --seed.');
    if (operation === 'export' && !options.out) throw new Error('Workbench export requires --out NEW_DIR.');
    for (const option of Object.keys(options)) {
      if (['project-root', 'helix-project'].includes(option)) continue;
      if (!(['prepare', 'refresh', 'evidence'].includes(operation) && ['item', 'issue'].includes(option)) && !(operation === 'comparisons' && ['evidence', 'item', 'issue', 'from-report'].includes(option)) && !(operation === 'feedback' && option === 'comparison') && !(operation === 'dashboard' && option === 'spec') && !(operation === 'compare-revisions' && ['previous', 'evidence', 'out'].includes(option)) && !(operation === 'refresh' && ['spec', 'decisions', 'previous', 'out'].includes(option)) && !(operation === 'review-summary' && ['decisions', 'evidence'].includes(option)) && !(operation === 'prepare' && ['spec', 'out'].includes(option)) && !(operation === 'evidence' && ['source', 'out'].includes(option)) && !(operation === 'run' && ['level', 'seed'].includes(option)) && !(operation === 'export' && option === 'out'))
        throw new Error('Option --' + option + ' is not valid for workbench ' + operation);
    }
  }
  if (command === 'workbench' && pos[0] === 'comparisons') {
    if (options['from-report'] !== undefined && (options['from-report'] !== 'yes' || options.evidence || options.item || options.issue)) throw new Error('Use --from-report yes alone to register existing report evidence.');
    const result = await comparisons(root, adapterSettings(root).helix.project, options.evidence, options.item, options.issue, options['from-report'] === 'yes');
    if ('errors' in result && result.errors.length) process.exitCode = 2;
    return result;
  }
  if (command === 'workbench' && pos[0] === 'feedback') {
    if (!options.comparison) throw new Error('Feedback requires --comparison ID from workbench comparisons.');
    const { comparisonFeedback } = await import('./comparison-feedback.ts');
    return comparisonFeedback(root, adapterSettings(root).helix.project, options.comparison);
  }
  const links = command === 'workbench' && ['prepare', 'refresh', 'evidence'].includes(pos[0]) ? comparisonLinks(root, adapterSettings(root).helix.project, options.item, options.issue) : [];
  if (command === 'workbench' && pos[0] === 'dashboard') {
    const { portingDashboard } = await import('./porting-dashboard.ts');
    return portingDashboard(root, adapterSettings(root).helix.project, options.spec ? resolve(root, options.spec) : undefined);
  }
  if (command === 'workbench' && pos[0] === 'compare-revisions') {
    if (!options.previous || !options.evidence || !options.out) throw new Error('Revision comparison requires --previous, --evidence, and --out NEW_FILE.');
    const { compareRevisionFiles } = await import('./workbench-compare-revisions.ts');
    return compareRevisionFiles(resolve(root, options.previous), resolve(root, options.evidence), resolve(root, options.out));
  }
  if (command === 'workbench' && pos[0] === 'refresh') {
    if (!options.spec || !options.decisions || !options.previous || !options.out) throw new Error('Review refresh requires --spec, --decisions, --previous, and --out NEW_DIR.');
    const { refreshReview } = await import('./review-refresh.ts');
    const result = await refreshReview(resolve(root, options.spec), resolve(root, options.decisions), resolve(root, options.previous), resolve(root, options.out), adapterSettings(root).helix.project);
    if (result.status !== 'ready') process.exitCode = 2;
    if (result.status === 'ready' && 'bundle' in result) return { ...result, registeredComparison: await registerComparison(root, adapterSettings(root).helix.project, result.bundle, links), note: 'Available in Porting Workbench → Available comparisons. Reload comparisons to view it.' };
    return result;
  }
  if (command === 'workbench' && pos[0] === 'review-summary') {
    if (!options.decisions || !options.evidence) throw new Error('Review summary requires --decisions and --evidence.');
    const { reviewSummary } = await import('./review-summary.ts');
    return reviewSummary(resolve(root, options.decisions), resolve(root, options.evidence), adapterSettings(root).helix.project);
  }
  if (command === 'workbench' && pos[0] === 'prepare') {
    if (!options.spec || !options.out) throw new Error('Workbench prepare requires --spec and --out.');
    const { prepareReview } = await import('./workbench-prepare.ts');
    const result = prepareReview(resolve(root, options.spec), resolve(root, options.out));
    if (result.status !== 'ready') process.exitCode = 2;
    if (result.status === 'ready' && 'bundle' in result) return { ...result, registeredComparison: await registerComparison(root, adapterSettings(root).helix.project, result.bundle, links), note: 'Available in Porting Workbench → Available comparisons. Reload comparisons to view it.' };
    return result;
  }
  if (command === 'workbench' && pos[0] === 'evidence') {
    if (!options.source || !options.out) throw new Error('Workbench evidence requires --source and --out.');
    const { bundleEvidence } = await import('./workbench-evidence.ts');
    const result = bundleEvidence(resolve(root, options.source), resolve(root, options.out));
    return { ...result, registeredComparison: await registerComparison(root, adapterSettings(root).helix.project, resolve(result.out, 'evidence.json'), links), note: 'Available in Porting Workbench → Available comparisons.' };
  }
  if (['scenario', 'step', 'capture', 'record'].includes(command) && pos.length !== 1)
    throw new Error(command + ' requires one argument.');
  if (['scene-look', 'scene-record'].includes(command) && pos.length)
    throw new Error(command + ' takes no positional arguments');
  const matrixLock = join(stateDir, 'ui-matrix.lock');
  if (
    [
      'start',
      'stop',
      'reset',
      'scenario',
      'step',
      'capture',
      'record',
      'recover',
      'scene-record',
      'objects',
      'workbench',
    ].includes(command) &&
    existsSync(matrixLock) &&
    JSON.parse(readFileSync(matrixLock, 'utf8')).token !== process.env.HELIX_MATRIX_TOKEN
  )
    throw new Error('A UI matrix owns this checkout session. Wait for it to restore and finish.');
  if (command.startsWith('discrepancy-')) {
    const { discrepancyCommand } = await import('./discrepancies.ts');
    return discrepancyCommand(command, pos, options);
  }
  if (command.startsWith('fixture-')) {
    const { fixtureCommand } = await import('./fixture-command.ts');
    return fixtureCommand(command, pos, options);
  }
  if (command === 'resolve' || command === 'assets') {
    const { config } = readConfig();
    const identity = await discover(config);
    return command === 'assets' ? assets(identity, options.match) : identity;
  }
  if (command === 'unity-revision') return unityRevision(root);
  if (command === 'unity-plan') {
    const { config } = readConfig();
    if (pos.length !== 1 || !options.out)
      throw new Error('unity-plan requires SCENARIO and --out.');
    return unityPlan(
      config,
      root,
      pos[0],
      options.viewport ?? Object.keys(config.viewports)[0],
      options.out,
    );
  }
  if (command === 'doctor') {
    const { config, configHash } = readConfig();
    const { chromium } = await import('playwright');
    let identity: any = null,
      error: string | null = null;
    try {
      identity = await discover(config);
    } catch (e) {
      error = (e as Error).message;
    }
    return {
      node: process.version,
      projectRoot: root,
      configHash,
      identity,
      error,
      browserInstalled: existsSync(chromium.executablePath()),
      browserPath: chromium.executablePath(),
      viewports: Object.keys(config.viewports),
      scenarios: Object.keys(config.scenarios),
      notes: [
        'start opens installed Helix Desktop when needed; resolve and doctor never launch it.',
        'Install browser with npm run install-browser from Tools/Helix.',
      ],
    };
  }
  if (['ui-assets', 'ui-plan', 'ui-impact'].includes(command)) {
    if (pos.length || !options.spec || !options.out)
      throw new Error(command + ' requires --spec and --out.');
    const { uiAssets, uiPlan, uiImpact } = await import('./ui-port.ts');
    const out = resolve(root, options.out);
    if (command === 'ui-assets') return uiAssets(root, options.spec, out);
    if (command === 'ui-plan') return uiPlan(root, options.spec, out);
    return uiImpact(root, options.spec, options.previous, out);
  }
  if (command === 'material-keywords') {
    if (pos.length || !options.out) throw new Error('material-keywords requires --out EMPTY_DIR.');
    const { materialKeywords } = await import('./material-keywords.ts');
    const result = materialKeywords(resolve(root, options.out));
    if (result.mismatches) process.exitCode = 2;
    return result;
  }
  if (command === 'sprite-usage') {
    if (pos.length || !options.spec || !options.out)
      throw new Error('sprite-usage requires --spec and --out.');
    const { spriteUsage } = await import('./sprite-usage.ts');
    return spriteUsage(resolve(root, options.spec), resolve(root, options.out));
  }
  if (command === 'render-inspect') {
    if (pos.length || !options.spec || !options.out) throw new Error('render-inspect requires --spec and --out.');
    const { renderInspect } = await import('./render-inspect.ts');
    return renderInspect(resolve(root, options.spec), resolve(root, options.out));
  }
  if (command === 'render-trace') {
    if (pos.length || !options.spec || !options.out)
      throw new Error('render-trace requires --spec and --out.');
    const { renderTrace } = await import('./render-trace.ts');
    return renderTrace(resolve(root, options.spec), resolve(root, options.out));
  }
  if (command === 'capture-coverage' || command === 'vfx-compare' || command === 'recording-sheet') {
    if (pos.length || !options.spec || !options.out)
      throw new Error(command + ' requires --spec and --out.');
    const directory = dirname(fileURLToPath(import.meta.url));
    const filename =
      command === 'capture-coverage'
        ? 'coverage_plan.py'
        : command === 'recording-sheet'
          ? 'recording_sheet.py'
          : 'vfx.py';
    const installed = join(directory, '..', filename);
    const script = existsSync(installed) ? installed : join(directory, '../../workflows', filename);
    const result = spawnSync(
      'python3',
      [
        script,
        resolve(root, options.spec),
        resolve(root, options.out),
        ...(command === 'capture-coverage'
          ? [
              root,
              options.basis ?? 'retained',
              ...(options.inventory ? [resolve(root, options.inventory)] : []),
            ]
          : command === 'recording-sheet' ? [root] : []),
      ],
      { encoding: 'utf8' },
    );
    if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr.trim());
    return JSON.parse(result.stdout);
  }
  if (command === 'scene-motion') {
    if (pos.length || !options.reference || !options.candidate || !options.spec || !options.out)
      throw new Error('scene-motion requires --reference, --candidate, --spec and --out');
    const { compareMotionFiles } = await import('./scene-motion.ts');
    return compareMotionFiles(
      ...([options.reference, options.candidate, options.spec, options.out].map((p) =>
        resolve(root, p),
      ) as [string, string, string, string]),
    );
  }
  if (command === 'conversion-plan') {
    if (pos.length || !options.spec || !options.out)
      throw new Error('conversion-plan requires --spec and --out');
    const { conversionPlan } = await import('./conversion-plan.ts');
    return conversionPlan(root, resolve(root, options.spec), resolve(root, options.out));
  }
  if (command === 'scene-report') {
    if (pos.length || !options.reference || !options.candidate || !options.spec || !options.out)
      throw new Error('scene-report requires --reference, --candidate, --spec and --out');
    const { sceneReview } = await import('./scene-review.ts');
    return sceneReview(
      ...([options.reference, options.candidate, options.spec, options.out].map((p) =>
        resolve(root, p),
      ) as [string, string, string, string]),
    );
  }
  if (command === 'scene-compare') {
    if (pos.length || !options.reference || !options.candidate || !options.spec || !options.out)
      throw new Error('scene-compare requires --reference, --candidate, --spec and --out');
    const { compareSceneFiles } = await import('./scene.ts');
    return compareSceneFiles(
      ...([options.reference, options.candidate, options.spec, options.out].map((p) =>
        resolve(root, p),
      ) as [string, string, string, string]),
    );
  }
  if (command === 'handoff-owner') {
    if (pos.length || !options.handoff || !options['unity-project'] || !options.out)
      throw new Error('handoff-owner requires --handoff, --unity-project and --out.');
    const { handoffOwner } = await import('./handoff-owner.ts');
    return handoffOwner(
      resolve(root, options.handoff),
      resolve(root, options['unity-project']),
      resolve(root, options.out),
    );
  }
  if (command === 'visual-owner') {
    if (pos.length || !options.spec || !options.out)
      throw new Error('visual-owner requires --spec and --out.');
    const { visualOwner } = await import('./visual-owner.ts');
    return visualOwner(resolve(root, options.spec), resolve(root, options.out));
  }
  if (command === 'ui-compositing-compare') {
    if (pos.length || !options.spec || !options.out)
      throw new Error('ui-compositing-compare requires --spec and --out.');
    const { uiCompositing } = await import('./ui-compositing.ts');
    return uiCompositing(resolve(root, options.spec), resolve(root, options.out));
  }
  if (command === 'typography-compare') {
    if (pos.length || !options.reference || !options.candidate || !options.spec || !options.out)
      throw new Error('typography-compare requires --reference, --candidate, --spec and --out.');
    const { compareTypography } = await import('./typography.ts');
    return compareTypography(
      resolve(root, options.reference),
      resolve(root, options.candidate),
      resolve(root, options.spec),
      resolve(root, options.out),
    );
  }
  if (command === 'ui-layout-trace' || command === 'ui-compare') {
    if (pos.length || !options.reference || !options.candidate || !options.spec || !options.out)
      throw new Error(command + ' requires --reference, --candidate, --spec and --out.');
    if (command === 'ui-layout-trace') {
      const { traceLayout } = await import('./ui-layout-trace.ts');
      return traceLayout(
        resolve(root, options.reference),
        resolve(root, options.candidate),
        resolve(root, options.spec),
        resolve(root, options.out),
      );
    }
    const { compareUI } = await import('./ui.ts');
    return compareUI(
      resolve(root, options.reference),
      resolve(root, options.candidate),
      resolve(root, options.spec),
      resolve(root, options.out),
    );
  }
  if (command === 'batch') {
    if (pos.length || !options.spec || !options.out || (options.resume && options.resume !== 'yes'))
      throw new Error('batch needs --spec JSON --out DIR; --resume accepts yes.');
    const { config } = readConfig();
    config.referenceIdentity = await discover(config, true);
    config.url = config.url ?? config.referenceIdentity.url;
    const { runBatch } = await import('./batch.ts');
    const report = await runBatch({
      root,
      config,
      spec: JSON.parse(readFileSync(resolve(root, options.spec), 'utf8')),
      out: resolve(root, options.out),
      workers: Number(options.workers ?? 1),
      resume: options.resume === 'yes',
    });
    if (report.status !== 'captured') process.exitCode = 1;
    return {
      status: report.status,
      out: resolve(root, options.out),
      performance: report.performance,
      elapsedMs: report.elapsedMs,
      cases: report.cases.map(({ id, status, error }: any) => ({ id, status, error })),
      notRun: report.notRun,
    };
  }
  if (command === 'ui-matrix' || command === 'scene-case') {
    if (command === 'scene-case') {
      const spec = JSON.parse(readFileSync(resolve(root, options.spec ?? ''), 'utf8'));
      if (spec.cases?.length !== 1 || !spec.cases[0].sceneSpec)
        throw new Error('scene-case requires exactly one case with sceneSpec');
    }
    if (pos.length || !options.spec || !options.out)
      throw new Error('ui-matrix requires --spec and --out.');
    const { runMatrix } = await import('./ui-runner.ts');
    return runMatrix({
      root,
      cli: fileURLToPath(import.meta.url),
      specPath: resolve(root, options.spec),
      out: resolve(root, options.out),
      execute: options.execute,
      aiKit: options['ai-kit'],
    });
  }
  if (command === 'debug-image') {
    if (!options.input || !options.out) throw new Error('debug-image requires --input and --out.');
    const { exportImageViews } = await import('./image-debug.ts');
    return exportImageViews(resolve(root, options.input), resolve(root, options.out));
  }
  if (command === 'record' && options.after !== undefined && !['reset', 'stop'].includes(options.after))
    throw new Error('--after must be reset or stop.');
  if (command === 'debug-capture' && (!options.view || !options.out))
    throw new Error('debug-capture requires --view and --out.');
  if (command === 'compare') {
    if (!options.reference || !options.candidate || !options.out)
      throw new Error('compare requires --reference, --candidate and --out.');
    const { compare } = await import('./compare.ts');
    return compare(
      resolve(root, options.reference),
      resolve(root, options.candidate),
      resolve(root, options.out),
      options.regions === undefined ? undefined : resolve(root, options.regions),
    );
  }
  if (command === 'start') {
    const { config, configHash: adapterConfigHash } = readConfig(options.url);
    if (options.workbench !== undefined) {
      if (options.workbench !== 'yes') throw new Error('--workbench accepts yes.');
      config.ready = '(' + config.ready + ') && window.__portingWorkbench?.version === 1';
    }
    config.referenceIdentity = await discover(config, true);
    config.url = options.url ?? config.url ?? config.referenceIdentity.url;
    config.referenceIdentity = {
      ...config.referenceIdentity,
      previewOverride: config.url !== config.referenceIdentity.url,
    };
    const configHash = sha(JSON.stringify(config)),
      viewport = options.viewport ?? Object.keys(config.viewports)[0];
    if (!config.viewports[viewport]) throw new Error('Unknown viewport ' + viewport);
    mkdirSync(stateDir, { recursive: true });
    const lock = join(stateDir, 'start.lock');
    let fd;
    try {
      fd = openSync(lock, 'wx', 0o600);
    } catch {
      throw new Error(
        'Another start is in progress. If its process died, remove .helix/start.lock before retrying.',
      );
    }
    try {
      if (existsSync(file)) {
        let live;
        try {
          live = await request(connection(), { method: 'status' }, 3000);
        } catch (e) {
          if (!['ECONNREFUSED', 'ENOENT'].includes((e as any).code)) throw e;
          rmSync(file, { force: true });
        }
        if (live) {
          if (live.configHash !== configHash || live.viewport !== viewport)
            throw new Error(
              'Existing session has different config/viewport. Stop it explicitly first.',
            );
          return live;
        }
      }
      const token = randomUUID(),
        launchId = randomUUID(),
        startedUtc = new Date().toISOString(),
        startupDeadline = Date.now() + 60000,
        logPath = join(stateDir, 'host.log');
      writeFileSync(
        join(stateDir, 'launch.json'),
        JSON.stringify({ config, configHash, adapterConfigHash, viewport, token, launchId, startedUtc, startupDeadline }),
        { mode: 0o600 },
      );
      // Replace the file under the start lock. A previous host still unwinding keeps
      // its old descriptor and cannot write stale errors into this launch's log.
      const nextLogPath = join(stateDir, `host-${launchId}.log`);
      writeFileSync(nextLogPath, JSON.stringify({ launchId, startedUtc, projectRoot: root, viewport, url: config.url, ready: config.ready }) + '\n', { flag: 'wx', mode: 0o600 });
      renameSync(nextLogPath, logPath);
      const log = openSync(logPath, 'a', 0o600);
      const launchFailure = (message: string) => new Error(`${message} Launch ${launchId} (${startedUtc}). Current launch log: ${logPath}\n${readFileSync(logPath, 'utf8').slice(-12000)}`);
      const child = spawn(
        process.execPath,
        [join(dirname(fileURLToPath(import.meta.url)), 'host.ts'), '--project-root', root],
        { cwd: root, detached: true, stdio: ['ignore', log, log] },
      );
      closeSync(log);
      let failure: Error | undefined;
      child.on('error', (e) => {
        failure = e;
      });
      const exited = new Promise<void>((done) => child.once('exit', () => done()));
      child.unref();
      let connected = false;
      try {
        while (Date.now() < startupDeadline + 5000) {
          if (failure) throw launchFailure(String(failure));
          if (existsSync(file)) {
            const owned = connection();
            if (owned.token !== token) throw new Error('Startup connection belongs to another host.');
            const live = await request(owned, { method: 'status' }, Math.max(1, startupDeadline + 5000 - Date.now()));
            connected = true;
            return live;
          }
          if (child.exitCode !== null || child.signalCode !== null)
            throw launchFailure('Browser host failed.');
          await new Promise((r) => setTimeout(r, 100));
        }
        throw launchFailure('Startup exceeded its 60-second deadline and 5-second shutdown grace.');
      } finally {
        // Also reap the owned child after a failed status exchange, not just timeout.
        if (!connected && child.pid && child.exitCode === null && child.signalCode === null) {
          const force = setTimeout(() => child.kill('SIGKILL'), 5000);
          child.kill('SIGTERM');
          try { await exited; } finally { clearTimeout(force); }
        }
        if (!connected && existsSync(file) && connection().token === token) rmSync(file);
      }
    } finally {
      closeSync(fd!);
      rmSync(lock, { force: true });
    }
  }
  if (command === 'stop' && !existsSync(file)) return { stopped: true, alreadyStopped: true };
  const owned = connection();
  if (command === 'stop' && processExited(owned.pid)) {
    await finishStop(owned);
    return { stopped: true, alreadyStopped: true };
  }
  let result;
  try {
    result = await request(
      owned,
      {
        method: command,
        view: options.view,
        name: ['workbench', 'objects'].includes(command) ? pos[1] : pos[0],
        operation: ['workbench', 'objects'].includes(command) ? pos[0] : undefined,
        level: options.level,
        seed: options.seed,
        label: pos[0],
        dependencies: options.dependencies ? resolve(root, options.dependencies) : undefined,
        match: options.match,
        engine: options.engine,
        selector: options.selector ? JSON.parse(readFileSync(resolve(root, options.selector), 'utf8')) : undefined,
        out: options.out ? resolve(root, options.out) : undefined,
        duration: options.duration,
        scenario: options.scenario,
        after: options.after,
        interval: options['interval-ms'],
        profile: options.profile,
        sceneProfile: options['scene-profile'],
        step: command === 'step' ? loadStep(JSON.parse(pos[0])) : undefined,
      },
      command === 'record' ? 125000 : 65000,
    );
  } catch (error) {
    if (command !== 'stop') throw error;
    try { await finishStop(owned); } catch { throw error; }
    return { stopped: true, alreadyStopped: true };
  }
  if (command === 'objects' && ['helix-object-resolution', 'helix-three-resolution'].includes(result.kind) && result.status !== 'resolved') process.exitCode = 2;
  if (command === 'stop' || (command === 'record' && options.after === 'stop'))
    await finishStop(owned);
  return result;
}
main()
  .then((result) => {
    if (result !== undefined) console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  });
