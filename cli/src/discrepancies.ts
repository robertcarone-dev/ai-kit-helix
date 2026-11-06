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
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { root } from './config.ts';

type Pin = { path: string; sha256: string };
type Evidence = Pin & { claim: string; inputs: Pin[]; recoverFrom?: string };
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

function validatePin(pin: Pin) {
  textField(pin.path, 'project-relative path');
  if (
    isAbsolute(pin.path) ||
    pin.path.includes('\\') ||
    pin.path.split('/').some((part) => ['', '.', '..'].includes(part))
  )
    throw new Error('Expected a portable checkout-relative path: ' + pin.path);
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
  for (const evidence of issue.evidence) {
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
  const path = resolve(root, pin.path);
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
  const artifact = await inspectPin(evidence, hashes);
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

export async function discrepancyCommand(
  command: string,
  pos: string[],
  options: Record<string, string>,
) {
  if (pos.length) throw new Error(command + ' takes named options only.');
  if (!(await directory(join(root, 'Tools', 'Helix'))))
    throw new Error('Select a Helix project checkout.');
  if (command === 'discrepancy-save') {
    if (!options.spec) throw new Error('Supply --spec FILE and, for updates, --after REVISION.');
    const record: Issue = JSON.parse(await readFile(resolve(root, options.spec), 'utf8'));
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
      if (feature && item.feature.toLowerCase() !== feature) continue;
      if (status === 'active' ? terminal(item) : status !== 'all' && status !== item.status)
        continue;
      const evidenceChecks = [];
      for (const evidence of item.evidence)
        evidenceChecks.push(await inspectEvidence(evidence, hashes));
      issues.push({ ...entry, evidenceChecks });
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
