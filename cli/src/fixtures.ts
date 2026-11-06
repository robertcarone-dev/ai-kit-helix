// Project-owned fixture documents use the same step language as live scenarios.
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';

export const fixtureContract = {
  schemaVersion: 1,
  required: ['schemaVersion', 'id', 'feature', 'label', 'viewport', 'steps', 'ready', 'state'],
  id: 'lowercase kebab-case, unique across fixtures and legacy scenarios',
  feature: 'Feature name from project data',
  label: 'Action or outcome the agent intends to reproduce',
  viewport: 'Key from the configured project viewports',
  steps: [
    {
      kind: 'script',
      purpose: 'fixture or instrumentation',
      file: 'project-relative JS (or supply expression)',
    },
    { kind: 'wait', until: 'observed readiness expression' },
    { kind: 'press', target: 'semantic target (or supply x and y)' },
    { kind: 'assert', expression: 'observed result', expected: 'JSON value' },
  ],
  ready: 'Boolean expression for the required final outcome',
  state: 'Expression returning serializable observed state for the recording receipt',
  stepContract:
    'Existing scenario step language. Inspect actual game callers, selectors, state and input before authoring.',
};

export function validateFixture(doc: any, config: any, loadStep: (step: any) => any) {
  if (
    doc.schemaVersion !== 1 ||
    typeof doc.id !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(doc.id)
  )
    throw new Error('Fixture requires schemaVersion 1 and a lowercase kebab-case id.');
  for (const key of ['feature', 'label', 'viewport', 'ready', 'state'])
    if (typeof doc[key] !== 'string' || !doc[key].trim()) throw new Error('Missing fixture ' + key);
  if (!Object.hasOwn(config.viewports, doc.viewport))
    throw new Error('Unknown fixture viewport: ' + doc.viewport);
  if (!Array.isArray(doc.steps) || !doc.steps.length)
    throw new Error('Fixture requires scenario steps.');
  doc.steps.forEach(loadStep);
  if (doc.captureSteps) doc.captureSteps.forEach(loadStep);
}

export function installFixtureScenarios(root: string, config: any, loadStep: (step: any) => any) {
  const dir = join(root, 'Tools/Helix/fixtures');
  if (!existsSync(dir)) return;
  if (realpathSync(dir) !== dir) throw new Error('Fixture directory must belong to the checkout.');
  config.scenarios ??= {};
  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const file = join(dir, name);
    if (realpathSync(file) !== file)
      throw new Error('Fixture document must belong to the checkout.');
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    validateFixture(doc, config, loadStep);
    if (name !== doc.id + '.json' || Object.hasOwn(config.scenarios, doc.id))
      throw new Error('Fixture filename mismatch or duplicate scenario: ' + name);
    config.scenarios[doc.id] = { ...doc, description: doc.label };
  }
}

export function createFixture(
  root: string,
  spec: string,
  config: any,
  loadStep: (step: any) => any,
) {
  const doc = JSON.parse(readFileSync(resolve(root, spec), 'utf8'));
  validateFixture(doc, config, loadStep);
  if (Object.hasOwn(config.scenarios ?? {}, doc.id))
    throw new Error('Scenario already exists: ' + doc.id);
  const dir = join(root, 'Tools/Helix/fixtures');
  mkdirSync(dir, { recursive: true });
  if (realpathSync(dir) !== dir) throw new Error('Fixture directory must belong to the checkout.');
  const destination = join(dir, doc.id + '.json');
  const staging = mkdtempSync(join(dir, '.create-'));
  try {
    const file = join(staging, basename(destination));
    writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
    linkSync(file, destination); // Atomic publish; concurrent authors cannot overwrite a fixture.
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return { id: doc.id, path: destination, status: 'authored' };
}
