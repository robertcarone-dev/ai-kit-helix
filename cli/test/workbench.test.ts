import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha, localUrl } from '../src/config.ts';
import { prepareReview } from '../src/workbench-prepare.ts';
import { writeBaseline, captureDependencies, requireUnchanged } from '../src/evidence-baseline.ts';
import { readEvidence } from '../src/evidence-validation.ts';
import { evidenceManifest, reviewTargets, readValidatedReviews } from '../src/review-format.ts';
import { reviewSummary } from '../src/review-summary.ts';
import { refreshReview } from '../src/review-refresh.ts';
import { compareRevisions } from '../src/revision-comparison.ts';
import { registerComparison, comparisons, comparisonLinks } from '../src/comparison-index.ts';
import { portingDashboard } from '../src/porting-dashboard.ts';
import { connectedProjectRoot } from '../src/unity-connection.ts';
import { workbench } from '../src/workbench.ts';

const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
async function temporary(run: (root: string) => Promise<void> | void) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'helix-workbench-test-')));
  try { await run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
function fixture(root: string) {
  const pin = (path: string) => ({ path, sha256: sha(readFileSync(path)) });
  const dependency = join(root, 'input.txt');
  writeFileSync(dependency, 'capture-time input');
  const png = new PNG({ width: 2, height: 2 }); png.data.fill(255);
  const image = join(root, 'capture.png'); writeFileSync(image, PNG.sync.write(png));
  const receipt = join(root, 'capture.json');
  json(receipt, { image, sha256: pin(image).sha256, ui: {
    schemaVersion: 1, coordinateSpace: 'native-top-left-pixels', viewport: { width: 2, height: 2 },
    nodes: [{ name: 'Icon', path: 'Screen/Icon', kind: 'phaser', visible: true, bounds: { x: 0, y: 0, width: 2, height: 2 }, rendering: { alpha: 1 } }],
  } });
  const baseline = join(root, 'baseline.json');
  writeBaseline(baseline, 'capture', pin(image), pin(receipt), [pin(dependency)]);
  const inspection = join(root, 'inspection.json');
  json(inspection, { schemaVersion: 1, id: 'icon', reference: { baseline, selector: { name: 'Icon' } }, candidate: { baseline } });
  const spec = join(root, 'review.json');
  json(spec, { schemaVersion: 1, cases: [{ id: 'screen', reference: { baseline }, candidate: { baseline }, renderInspection: inspection, reviewDependencies: [{ element: 'icon', reports: [] }] }] });
  return { spec, dependency, pin };
}

test('prepare, decision summary and no-op refresh preserve scoped acceptance and original evidence', async () => temporary(async root => {
  const { spec, dependency } = fixture(root);
  const result = prepareReview(spec, join(root, 'first'));
  assert.equal(result.status, 'ready', JSON.stringify(result));
  assert.ok('bundle' in result);
  const original = readFileSync(result.bundle, 'utf8');
  const bundle = await readEvidence(original);
  const targets = await reviewTargets(bundle.files, sha(evidenceManifest(bundle.files)));
  assert.equal(targets.length, 1);
  const target = targets[0];
  assert.ok(target.dependencies);
  const decisions = join(root, 'decisions.json');
  json(decisions, { format: 'helix-review-decisions', version: 1, project: 'sample-project', exportedUtc: new Date().toISOString(), decisions: [{
    version: 2, caseId: target.caseId, element: target.element, reportPath: target.reportPath,
    reference: target.reference, candidate: target.candidate, evidence: target.evidence,
    status: 'accepted', notes: 'Synthetic reviewer decision', savedUtc: new Date().toISOString(),
    dependencyManifest: { version: 1, scope: 'declared-target', files: target.dependencies },
  }] });
  assert.equal((await reviewSummary(decisions, result.bundle, 'sample-project')).counts.accepted, 1);
  const refreshed = await refreshReview(spec, decisions, result.bundle, join(root, 'second'), 'sample-project');
  assert.equal(refreshed.status, 'ready');
  assert.ok('summary' in refreshed);
  assert.equal(read(refreshed.summary).counts.accepted, 1);
  assert.equal(readFileSync(refreshed.decisions, 'utf8'), readFileSync(decisions, 'utf8'));
  assert.equal(readFileSync(result.bundle, 'utf8'), original);
  assert.equal(read(refreshed.comparison).changes.length, 0);
  writeFileSync(dependency, 'changed after capture');
  const blocked = prepareReview(spec, join(root, 'stale'));
  assert.equal(blocked.status, 'blocked');
  assert.equal(existsSync(join(root, 'stale/bundle/evidence.json')), false);
  assert.ok(read(join(root, 'stale/freshness.json')).cases[0].checks.some(check => check.status === 'changed'));
  const tampered = read(decisions); tampered.decisions[0].dependencyManifest.files[0].sha256 = '0'.repeat(64);
  await assert.rejects(readValidatedReviews(JSON.stringify(tampered), 'sample-project'), /manifest|captures/i);
}));

test('preparation rejects empty dependencies, conflicting pins and receipt/image mismatch', async () => temporary(root => {
  const { spec, pin } = fixture(root);
  const baseline = read(join(root, 'baseline.json'));
  baseline.dependencies = []; json(join(root, 'baseline.json'), baseline);
  assert.equal(prepareReview(spec, join(root, 'unmeasured')).status, 'blocked');
  const a = { image: pin(join(root, 'capture.png')), receipt: pin(join(root, 'capture.json')), dependencies: [pin(join(root, 'input.txt'))] };
  json(spec, { schemaVersion: 1, cases: [{ id: 'conflict', reference: a, candidate: { ...a, image: { ...a.image, sha256: '0'.repeat(64) } } }] });
  assert.throws(() => prepareReview(spec, join(root, 'conflict')), /Conflicting SHA-256/);
  assert.equal(existsSync(join(root, 'conflict')), false);
  const alternateReceipt = join(root, 'alternate.json'); json(alternateReceipt, { other: true });
  json(spec, { schemaVersion: 1, cases: [{ id: 'screen', reference: { ...a, receipt: pin(alternateReceipt) }, candidate: a, renderInspection: join(root, 'inspection.json') }] });
  const mismatch = prepareReview(spec, join(root, 'mismatch'));
  assert.equal(mismatch.status, 'blocked');
  assert.match(JSON.stringify(mismatch), /receipts do not match/);
}));

test('capture dependency records detect mutation without reconstructing historical pins', async () => temporary(root => {
  writeFileSync(join(root, 'input.txt'), 'original');
  const spec = join(root, 'dependencies.json'); json(spec, { schemaVersion: 1, files: ['input.txt'] });
  const pins = captureDependencies(spec);
  assert.equal(pins.length, 2);
  requireUnchanged(pins);
  writeFileSync(join(root, 'input.txt'), 'changed');
  assert.throws(() => requireUnchanged(pins), /Input changed/);
}));

test('registration preserves links, validates freshness metadata and refuses invalid dashboard replacement', async () => temporary(async root => {
  const { spec } = fixture(root);
  const prepared = prepareReview(spec, join(root, 'prepared'));
  assert.ok('bundle' in prepared);
  const report = join(root, 'dashboard.json');
  const value = { format: 'helix-porting-dashboard', version: 1, project: 'sample-project', items: [{ id: 'screen.menu', kind: 'screen', title: 'Menu', status: 'blocked', summary: 'Review needed', issues: [{ severity: 'warning', tool: 'helix-cli', message: 'Review pending', action: 'Review the prepared bundle' }], evidence: [prepared.bundle] }] };
  json(report, value); portingDashboard(root, 'sample-project', report);
  const entry = await registerComparison(root, 'sample-project', prepared.bundle, comparisonLinks(root, 'sample-project', 'screen.menu', '1'));
  assert.equal(entry.preparation, 'ready');
  await registerComparison(root, 'sample-project', prepared.bundle, [{ item: 'screen.menu' }]);
  await registerComparison(root, 'sample-project', prepared.bundle, [{ item: 'screen.menu' }]);
  const listed = await comparisons(root, 'sample-project');
  assert.ok('comparisons' in listed); assert.equal(listed.comparisons[0].links.length, 2);
  const published = readFileSync(join(root, '.helix/porting-dashboard.json'), 'utf8');
  value.items[0].issues = []; json(report, value);
  assert.throws(() => portingDashboard(root, 'sample-project', report), /require an issue/);
  assert.equal(readFileSync(join(root, '.helix/porting-dashboard.json'), 'utf8'), published);
  const bundle = read(prepared.bundle), freshness = bundle.files.find(file => file.path === 'freshness.json');
  const invalid = JSON.parse(freshness.data); invalid.cases[0].status = 'blocked';
  freshness.data = JSON.stringify(invalid); freshness.sha256 = sha(freshness.data);
  const invalidBundle = join(root, 'invalid.json'); json(invalidBundle, bundle);
  await assert.rejects(registerComparison(root, 'sample-project', invalidBundle), /preparation case/);
  assert.equal(existsSync(join(root, '.helix/comparisons', sha(realpathSync(invalidBundle)) + '.json')), false);
}));

test('revision limits retain all file changes after field details reach their budget', async () => {
  const file = (path: string, value: unknown) => { const data = JSON.stringify(value); return { path, type: 'json' as const, data, sha256: sha(data) }; };
  const envelope = files => ({ format: 'helix-workbench-evidence' as const, version: 1 as const, source: 'synthetic', createdUtc: new Date().toISOString(), skipped: [], files });
  const previous = envelope([file('a.json', Array(2100).fill(0)), file('z.json', { final: false })]);
  const current = envelope([file('a.json', Array(2100).fill(1)), file('z.json', { final: true })]);
  const result = await compareRevisions(previous, current);
  assert.equal(result.changes.length, 2);
  assert.equal(result.changes[0].fieldDetailsLimited, 'field-count');
  assert.equal(result.changes[1].path, 'z.json');
  assert.equal(result.changes[1].fieldDetailsLimited, 'field-count');
});

test('explicit checkout selection bypasses Desktop and validates slug input', async () => {
  assert.equal(await connectedProjectRoot(['--helix-project', 'sample-project', '--project-root', '/explicit'], localUrl), null);
  assert.equal(await connectedProjectRoot([], localUrl), null);
  await assert.rejects(connectedProjectRoot(['--helix-project', '../invalid'], localUrl), /project slug/);
});

test('Workbench export uses only the supplied v1 API and preserves output ownership', async () => temporary(async root => {
  const trace = { runId: 'synthetic-run', status: 'ready', events: [] };
  const page = { evaluate: async (fn, args) => {
    const previous = globalThis.window;
    globalThis.window = { __portingWorkbench: { version: 1, snapshot: () => trace } };
    try { return await fn(args); } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
  } };
  const out = join(root, 'export');
  await workbench(page, { operation: 'export', out }, { sessionId: 'synthetic-session' });
  assert.deepEqual(read(join(out, 'trace.json')), trace);
  assert.equal(read(join(out, 'receipt.json')).evidence[0].sha256, sha(readFileSync(join(out, 'trace.json'))));
  await assert.rejects(workbench(page, { operation: 'export', out }, {}), /EEXIST/);
}));


test('live Workbench commands respect an existing matrix session owner', async () => temporary(root => {
  mkdirSync(join(root, 'Tools/Helix'), { recursive: true });
  json(join(root, 'Tools/Helix/reference.json'), { helix: { project: 'sample-project', variant: 'Default' } });
  mkdirSync(join(root, '.helix'));
  json(join(root, '.helix/ui-matrix.lock'), { token: 'another-owner' });
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'workbench', 'run', 'example', '--level', '1', '--seed', '1', '--project-root', root], { encoding: 'utf8', timeout: 10000, env: { ...process.env, HELIX_MATRIX_TOKEN: 'this-test' } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /A UI matrix owns this checkout session/);
}));
