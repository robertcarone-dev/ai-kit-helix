import { dependencyPinState } from './dependency-pins.ts';
import { validateDependencySelectors } from './dependency-selection.ts';
import { evidencePath } from './evidence-archive.ts';
import { spawnSync } from 'node:child_process';
// A feature's continuation travels with the checkout. Evidence stays at its original location.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { root } from './config.ts';

type Pin = import('./acceptance-format.ts').InputPin;
type Evidence = Pin & {
  claim: string;
  inputs: Pin[];
  recoverFrom?: string;
  recovery?: { attachment: string; member?: string };
};
type Issue = {
  schemaVersion: 1;
  id: string;
  feature: string;
  caseId: string;
  status: 'open' | 'blocked' | 'resolved' | 'accepted-deviation';
  expected: string;
  observed: string;
  reference: string;
  unityRevision: string;
  nextAction?: string;
  blocker?: string;
  decision?: string;
  suspectedCause?: string;
  assignment?: string;
  integration?: { commits: string[]; afterIntegration: string };
  uiCase?: {
    matrix: string;
    caseId: string;
    element: string;
    reference?: string;
    candidate?: string;
  };
  evidence: Evidence[];
};
type Check = {
  path: string;
  status: 'match' | 'changed' | 'missing' | 'unavailable';
  actualSha256?: string;
};
const store = join(root, 'Tools', 'Helix', 'discrepancies');
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const terminal = (issue: Issue) =>
  issue.status === 'resolved' || issue.status === 'accepted-deviation';

function textField(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Expected nonempty ' + field);
}

function validatePath(path: string) {
  textField(path, 'project-relative path');
  if (
    isAbsolute(path) ||
    path.includes('\\') ||
    path.split('/').some((part) => ['', '.', '..'].includes(part))
  )
    throw new Error('Expected a portable checkout-relative path: ' + path);
}
function validatePin(pin: Pin) {
  validatePath(pin.path);
  if (pin.selectors !== undefined) validateDependencySelectors(pin.selectors);
  if (typeof pin.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(pin.sha256))
    throw new Error('Expected capture-time SHA-256 for ' + pin.path);
}

function validate(issue: Issue) {
  if (issue.schemaVersion !== 1 || typeof issue.id !== 'string' || !idPattern.test(issue.id))
    throw new Error('Expected schemaVersion 1 and a lowercase kebab-case discrepancy id.');
  for (const field of [
    'feature',
    'caseId',
    'expected',
    'observed',
    'reference',
    'unityRevision',
  ] as const)
    textField(issue[field], field);
  if (!['open', 'blocked', 'resolved', 'accepted-deviation'].includes(issue.status))
    throw new Error('Unknown discrepancy status.');
  if (terminal(issue)) textField(issue.decision, 'resolution or approval decision');
  else textField(issue.nextAction, 'nextAction');
  if (issue.status === 'blocked') textField(issue.blocker, 'blocker');
  if (!Array.isArray(issue.evidence))
    throw new Error('Specify evidence (use [] for missing coverage).');
  if (issue.status === 'resolved' && !issue.evidence.length)
    throw new Error('A resolution requires verification evidence.');
  if (issue.uiCase !== undefined) {
    const route = issue.uiCase;
    validatePath(route.matrix);
    textField(route.caseId, 'matrix caseId');
    textField(route.element, 'semantic element');
    if (route.reference !== undefined && route.reference === route.candidate)
      throw new Error('Reference and candidate must have different receipts.');
    for (const path of [route.reference, route.candidate]) {
      if (path !== undefined && issue.evidence.filter((e) => e.path === path).length !== 1)
        throw new Error('Each retained receipt must identify one evidence entry.');
    }
  }
  if (issue.integration !== undefined) {
    const { commits, afterIntegration } = issue.integration;
    if (
      !Array.isArray(commits) ||
      !commits.length ||
      commits.some((c) => typeof c !== 'string' || !/^[a-f0-9]{40}$/.test(c))
    )
      throw new Error('Integration requires full Git commit IDs.');
    textField(afterIntegration, 'afterIntegration');
  }
  for (const evidence of issue.evidence) {
    if (evidence.recovery !== undefined) {
      const { attachment, member } = evidence.recovery;
      if (typeof attachment !== 'string' || !/^[A-Za-z][A-Za-z0-9]*-\d+#a\d+$/.test(attachment))
        throw new Error('Expected exact ISSUE#aN attachment ID.');
      if (member !== undefined) validatePath(member);
    }
    validatePin(evidence);
    textField(evidence.claim, 'evidence claim');
    if (!Array.isArray(evidence.inputs))
      throw new Error('Declare the input pins for ' + evidence.path);
    evidence.inputs.forEach(validatePin);
  }
}

async function directory(path: string, create = false) {
  if (create) await mkdir(path, { recursive: true });
  try {
    if ((await realpath(path)) !== path || !(await lstat(path)).isDirectory())
      throw new Error('Expected a real project directory: ' + path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !create) return false;
    throw error;
  }
}

async function latest(id: string) {
  const dir = join(store, id);
  if (!(await directory(dir))) return;
  const versions = (await readdir(dir))
    .filter((name) => /^[1-9]\d*\.json$/.test(name))
    .map((name) => Number.parseInt(name));
  if (!versions.length) return;
  const revision = Math.max(...versions);
  const path = join(dir, revision + '.json');
  if ((await realpath(path)) !== path) throw new Error('Unexpected record symlink: ' + path);
  const record = JSON.parse(await readFile(path, 'utf8')) as Issue;
  validate(record);
  if (record.id !== id) throw new Error('Discrepancy ID differs from directory: ' + path);
  return { revision, path: relative(root, path), record };
}

// Compare the pinned bytes with this checkout, never repin evidence on a read or update.
async function inspectPin(pin: Pin, hashes: Map<string, string>): Promise<Check> {
  if (pin.selectors !== undefined) { const state = dependencyPinState(root, pin); return { path: pin.path, status: state === 'missing' ? 'unavailable' : state }; }
  const path = evidencePath(root, pin.path);
  try {
    const actual = await realpath(path);
    if (!actual.startsWith(root + sep) || !(await stat(actual)).isFile())
      return { path: pin.path, status: 'unavailable' };
    let sha = hashes.get(actual);
    if (!sha) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(actual)) hash.update(chunk);
      sha = hash.digest('hex');
      hashes.set(actual, sha);
    }
    return { path: pin.path, status: sha === pin.sha256 ? 'match' : 'changed', actualSha256: sha };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { path: pin.path, status: 'missing' };
    if (code === 'EACCES' || code === 'EPERM' || code === 'ELOOP')
      return { path: pin.path, status: 'unavailable' };
    throw error;
  }
}

async function inspectEvidence(evidence: Evidence, hashes: Map<string, string>) {
  let artifact = await inspectPin(evidence, hashes);
  if (artifact.status === 'missing') {
    const cached = await inspectPin(
      { path: '.helix/recovered/' + evidence.sha256, sha256: evidence.sha256 },
      hashes,
    );
    if (cached.status === 'match') artifact = cached;
  }
  const inputs: Check[] = [];
  for (const input of evidence.inputs) inputs.push(await inspectPin(input, hashes));
  const reusable =
    artifact.status === 'match' && inputs.length > 0 && inputs.every((i) => i.status === 'match');
  return {
    claim: evidence.claim,
    artifact,
    inputs,
    reusable,
    ...(inputs.length ? {} : { reason: 'no-declared-inputs' }),
  };
}

function continuation(issue: Issue) {
  if (terminal(issue) || !issue.integration) return { nextAction: issue.nextAction ?? null };
  const git = (...args: string[]) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  const head = git('rev-parse', '--verify', 'HEAD');
  const receivingHead = head.status === 0 ? head.stdout.trim() : null;
  const commits = issue.integration.commits.map((commit) => {
    if (!receivingHead || git('cat-file', '-e', commit + '^{commit}').status !== 0)
      return { commit, status: 'unknown' };
    const result = git('merge-base', '--is-ancestor', commit, receivingHead);
    return {
      commit,
      status:
        result.status === 0 ? 'included' : result.status === 1 ? 'not-in-ancestry' : 'unknown',
    };
  });
  const included = commits.every((c) => c.status === 'included');
  return {
    receivingHead,
    commits,
    nextAction: included ? issue.integration.afterIntegration : issue.nextAction,
    basis: included ? 'required-commits-in-receiving-HEAD' : 'integration-unconfirmed',
  };
}

export async function discrepancyCommand(
  command: string,
  pos: string[],
  options: Record<string, string>,
) {
  if (pos.length) throw new Error(command + ' takes named options only.');
  if (!(await directory(join(root, 'Tools', 'Helix'))))
    throw new Error('Select a Helix project checkout.');
  if (command === 'discrepancy-recover') {
    if (!idPattern.test(options.id ?? '')) throw new Error('Supply --id ID.');
    const entry = await latest(options.id);
    if (!entry) throw new Error('Unknown discrepancy: ' + options.id);
    const directory = dirname(fileURLToPath(import.meta.url));
    const installed = join(directory, '../recovery.py');
    const script = existsSync(installed)
      ? installed
      : join(directory, '../../workflows/recovery.py');
    const result = spawnSync(
      'python3',
      [script, root, options.issue ?? '', options['board-root'] ?? ''],
      { input: JSON.stringify(entry.record), encoding: 'utf8' },
    );
    if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr.trim());
    const recovery = JSON.parse(result.stdout);
    const complete = recovery.every((e: { status: string }) =>
      ['present', 'recovered'].includes(e.status),
    );
    if (!complete) process.exitCode = 1;
    const hashes = new Map<string, string>();
    const evidenceChecks = [];
    for (const pin of entry.record.evidence)
      evidenceChecks.push(await inspectEvidence(pin, hashes));
    return {
      id: options.id,
      revision: entry.revision,
      complete,
      recovery,
      evidenceChecks,
      continuation: continuation(entry.record),
    };
  }
  if (command === 'discrepancy-rerun') {
    if (!idPattern.test(options.id ?? '') || !options.out)
      throw new Error('Supply --id ID and --out SCRATCH_DIR.');
    const entry = await latest(options.id);
    if (!entry) throw new Error('Unknown discrepancy: ' + options.id);
    const issue = entry.record;
    const routeState = continuation(issue);
    if (
      terminal(issue) ||
      issue.status === 'blocked' ||
      !issue.uiCase ||
      routeState.basis === 'integration-unconfirmed'
    ) {
      if (options.execute !== undefined)
        throw new Error(
          issue.blocker ??
            routeState.nextAction ??
            'An open issue with an executable uiCase is required.',
        );
      return {
        id: issue.id,
        status: issue.status,
        runnable: false,
        nextAction: routeState.nextAction,
        continuation: routeState,
        blocker: issue.blocker,
      };
    }
    const route = issue.uiCase;
    const { runMatrix, caseIdentity } = await import('./ui-runner.ts');
    const { loadSnapshot } = await import('./ui.ts');
    const settings = {
      root,
      cli: fileURLToPath(new URL('./cli.ts', import.meta.url)),
      caseId: route.caseId,
      specPath: resolve(root, route.matrix),
      out: resolve(root, options.out),
      aiKit: options['ai-kit'],
    };
    const plan = await runMatrix(settings);
    const c = plan.cases[0];
    const spec = JSON.parse(await readFile(c.uiSpec, 'utf8'));
    const element = spec.elements.find((e: { id: string }) => e.id === route.element);
    if (!element) throw new Error('Unknown element in the selected UI spec: ' + route.element);
    const retained: { reference?: string; candidate?: string } = {};
    const reasons: Record<string, unknown> = {};
    const hashes = new Map<string, string>();
    for (const side of ['reference', 'candidate'] as const) {
      const evidence = issue.evidence.find((e) => e.path === route[side]);
      if (!evidence) {
        reasons[side] = 'No retained receipt declared';
        continue;
      }
      const check = await inspectEvidence(evidence, hashes);
      // The v2 sidecar binds the selected effective recipe, not whole config files.
      const required = [relative(root, c.uiSpec)];
      required.push(evidence.path + '.case.json');
      if (c.sceneSpec) required.push(relative(root, c.sceneSpec));
      const configurationFiles = [route.matrix, 'Tools/Helix/reference.json', 'Tools/Helix/reference.local.json'];

      if (
        !check.reusable ||
        !required.every((p) => evidence.inputs.some((i) => i.path === p)) ||
        !evidence.inputs.some((i) => !required.includes(i.path) && !configurationFiles.includes(i.path))
      ) {
        reasons[side] = {
          reason: 'Receipt, recipe, comparison spec, or source dependencies missing or stale',
          check,
        };
        continue;
      }
      try {
        const path = resolve(root, evidence.path);
        const identity = JSON.parse(await readFile(path + '.case.json', 'utf8'));
        if (!isDeepStrictEqual(identity, caseIdentity(c, side, path)))
          throw new Error('Case, side, recipe or receipt identity changed');
        const receipt = JSON.parse(await readFile(path, 'utf8'));
        if (
          !(
            await realpath(resolve(dirname(path), receipt.image ?? receipt.capturePath))
          ).startsWith(root + sep)
        )
          throw new Error('Retained image is outside checkout');
        const snapshot = loadSnapshot(path);
        if (snapshot.ui.viewport.width !== c.widthPx || snapshot.ui.viewport.height !== c.heightPx)
          throw new Error('Captured viewport differs');
        if (c.sceneSpec && !snapshot.receipt.scene)
          throw new Error('Missing inline scene evidence');
        retained[side] = path;
        reasons[side] = 'Pinned receipt, image and declared dependencies verified';
      } catch (e) {
        reasons[side] = String(e);
      }
    }
    const nextCommand = [
      'Tools/Helix/bin/helix',
      'discrepancy-rerun',
      '--id',
      issue.id,
      '--out',
      options.out,
      ...(options['ai-kit'] ? ['--ai-kit', options['ai-kit']] : []),
      '--execute',
      'yes',
    ];
    return {
      id: issue.id,
      revision: entry.revision,
      caseId: c.id,
      scenario: c.scenario,
      viewport: c.viewport,
      element: route.element,
      inspections: (element.visualBindings ?? []).map((b: Record<string, string>) => ({
        method: 'Helix.Comparison.UiAuthoring.Inspect',
        args: [b.prefab, b.target, b.component, b.field, b.kind],
      })),
      retained,
      reasons,
      nextCommand,
      ...(options.execute === undefined
        ? {}
        : { result: await runMatrix({ ...settings, retained, execute: options.execute }) }),
    };
  }
  if (command === 'discrepancy-save') {
    if (!options.spec) throw new Error('Supply --spec FILE and, for updates, --after REVISION.');
    const { evidenceManifests, ...record } = JSON.parse(await readFile(resolve(root, options.spec), 'utf8'));
    if (evidenceManifests !== undefined) {
      if (!Array.isArray(evidenceManifests) || !Array.isArray(record.evidence))
        throw new Error('evidenceManifests and evidence must be arrays.');
      const hashes = new Map<string, string>();
      for (const path of evidenceManifests) {
        validatePath(path);
        const manifest = JSON.parse(await readFile(resolve(root, path), 'utf8'));
        if (manifest.schemaVersion !== 1 || manifest.pathBase !== 'projectRoot' || !Array.isArray(manifest.evidence))
          throw new Error('Invalid evidence manifest: ' + path);
        for (const evidence of manifest.evidence) {
          validate({ ...record, evidence: [evidence] });
          if (!(await inspectEvidence(evidence, hashes)).reusable)
            throw new Error('Evidence manifest contains missing or changed bytes: ' + evidence.path);
          if (record.evidence.some((entry: Evidence) => entry.path === evidence.path))
            throw new Error('Duplicate evidence path: ' + evidence.path);
          record.evidence.push(evidence);
        }
      }
    }
    validate(record);
    const after = options.after ?? '0';
    if (!/^(0|[1-9]\d*)$/.test(after) || !Number.isSafeInteger(Number(after)))
      throw new Error('Invalid --after revision.');
    await directory(store, true);
    const dir = join(store, record.id);
    await directory(dir, true);
    const current = await latest(record.id);
    if (Number(after) !== (current?.revision ?? 0))
      throw new Error('Discrepancy revision conflict; resume again before saving.');
    const revision = Number(after) + 1;
    const dest = join(dir, revision + '.json');
    const staging = await mkdtemp(join(dir, '.saving-'));
    try {
      const file = join(staging, 'record');
      await writeFile(file, JSON.stringify(record, null, 2) + '\n');
      await link(file, dest); // Atomic create-only revision, including simultaneous writers.
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    return {
      id: record.id,
      feature: record.feature,
      status: record.status,
      revision,
      path: relative(root, dest),
    };
  }
  if (
    options.status &&
    !['active', 'all', 'open', 'blocked', 'resolved', 'accepted-deviation'].includes(options.status)
  )
    throw new Error('Unknown --status filter.');
  const issues = [];
  const hashes = new Map<string, string>();
  const feature = options.feature?.trim().toLowerCase();
  const status = options.status ?? 'active';
  if (await directory(store)) {
    for (const id of (await readdir(store)).filter((name) => idPattern.test(name)).sort()) {
      const entry = await latest(id);
      if (!entry) continue;
      const item = entry.record;
      if (options.assignment && item.assignment !== options.assignment) continue;
      if (feature && item.feature.toLowerCase() !== feature) continue;
      if (status === 'active' ? terminal(item) : status !== 'all' && status !== item.status)
        continue;
      const evidenceChecks = [];
      for (const evidence of item.evidence)
        evidenceChecks.push(await inspectEvidence(evidence, hashes));
      const recoveryCommand = evidenceChecks.some((check) => check.artifact.status === 'missing')
        ? ['Tools/Helix/bin/helix', 'discrepancy-recover', '--id', item.id]
        : undefined;
      issues.push({ ...entry, evidenceChecks, recoveryCommand, continuation: continuation(item) });
    }
  }
  return {
    feature: options.feature ?? null,
    status,
    count: issues.length,
    issues,
    scope:
      'Reuse checks cover recorded artifact bytes and declared file dependencies in this checkout. Acceptance and external source revisions require separate evidence.',
  };
}
