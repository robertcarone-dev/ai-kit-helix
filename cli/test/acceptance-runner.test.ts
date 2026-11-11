import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from '../src/acceptance-format.ts';
import { acceptanceStatus } from '../src/acceptance.ts';
import { loadCaseAdapters, planAcceptanceCase, runAcceptanceCase } from '../src/acceptance-runner.ts';
function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'case-runner-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path: string, value: any) => { const full = join(root, path); mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true }); writeFileSync(full, typeof value === 'string' ? value : JSON.stringify(value)); };
  put('Tools/Helix/acceptance/scope.json', { version: 1, project: 'synthetic', variant: 'Default', status: 'approved', rationale: 'Synthetic', screens: ['screens/a.json'], exclusions: [], viewports: [{ id: 'phone', width: 32, height: 64, safeArea: 'full-rectangle' }] });
  put('Tools/Helix/acceptance/screens/a.json', { version: 1, id: 'screen.a', title: 'A', implementation: 'implemented', implementationReferences: ['source.txt'], cases: [{ id: 'settled', dimension: 'appearance', required: true, viewports: ['phone'], basis: { kind: 'reference', source: 'Synthetic' }, criteria: [{ id: 'a', expected: 'Compare native appearance' }], dependencies: ['source.txt'], discrepancies: [], recipe: { reference: null, candidate: null, blockers: ['No runtime adapter'], setup: 'Fixture', anchors: ['settled'] } }] });
  put('source.txt', 'original'); put('image.png', 'retained-bytes');
  put('historical.json', { schemaVersion: 1, evidence: [{ path: 'image.png', sha256: digest('retained-bytes'), claim: '<script>historical</script>', recoverFrom: 'attachment:synthetic', inputs: [{ path: 'source.txt', sha256: digest('original') }] }] });
  const route = { item: 'screen.a', caseId: 'settled', viewport: 'phone', retained: [{ path: 'historical.json', sha256: digest(readFileSync(join(root, 'historical.json'))) }], capture: null as any };
  const manifest = { version: 1, project: 'synthetic', routes: [route] };
  const save = () => put('Tools/Helix/acceptance/adapters.json', manifest); save();
  return { root, put, route, manifest, save, out: join(root, '.aikit/scratch/result') };
}
test('retained execution preserves original hashes, records drift and never manufactures a run or approval', async t => {
  const f = fixture(t); f.put('source.txt', 'changed');
  const plan = await planAcceptanceCase(f.root, 'synthetic', 'screen.a', 'settled', 'phone', f.out);
  assert.equal(plan.retained[0].status, 'intact'); assert.equal(plan.retained[0].reuse, 'inputs-drifted');
  const result = await runAcceptanceCase(f.root, 'synthetic', 'screen.a', 'settled', 'phone', f.out, 'retained');
  assert.equal(result.status, 'prior-evidence-review');
  const row = (await acceptanceStatus(f.root, 'synthetic')).items[0].cases[0];
  assert.equal(row.latestRun, null); assert.equal(Boolean(row.accepted), false); assert.equal(row.latestExecution!.status, 'prior-evidence-review');
  assert.match(readFileSync(join(f.out, 'review.html'), 'utf8'), /&lt;script&gt;/);
  f.route.capture = { kind: 'node', script: 'adapter.ts', args: [], limitations: 'New route' }; f.save();
  assert.equal((await acceptanceStatus(f.root, 'synthetic')).items[0].cases[0].latestExecution!.criteriaCurrent, false);
  await assert.rejects(runAcceptanceCase(f.root, 'synthetic', 'screen.a', 'settled', 'phone', f.out, 'retained'), /already exists/);
});
test('missing evidence has an executable recovery result and corrupted source declarations fail closed', async t => {
  const f = fixture(t); rmSync(join(f.root, 'image.png'));
  const result = await runAcceptanceCase(f.root, 'synthetic', 'screen.a', 'settled', 'phone', f.out, 'retained');
  assert.equal(result.status, 'recovery-required');
  f.put('historical.json', {});
  await assert.rejects(planAcceptanceCase(f.root, 'synthetic', 'screen.a', 'settled', 'phone', f.out), /source missing or changed/);
});
test('adapter identities, dimensions, traversal and live execution boundaries are enforced', async t => {
  const f = fixture(t); f.manifest.routes.push(f.route); f.save(); assert.throws(() => loadCaseAdapters(f.root, 'synthetic'), /Duplicate/);
  f.manifest.routes.pop(); f.route.viewport = 'tablet'; f.save(); assert.throws(() => loadCaseAdapters(f.root, 'synthetic'), /unknown/);
  f.route.viewport = 'phone'; f.route.capture = { kind: 'node', script: '../outside.ts', args: [], limitations: 'Synthetic' }; f.save(); assert.throws(() => loadCaseAdapters(f.root, 'synthetic'), /relative path/);
  f.route.capture.script = 'adapter.ts'; f.save();
  await assert.rejects(runAcceptanceCase(f.root, 'synthetic', 'screen.a', 'settled', 'phone', f.out, 'capture'), /isolated/);
  symlinkSync(tmpdir(), join(f.root, 'escape')); f.route.retained[0].path = 'escape/out.json'; f.save(); assert.throws(() => loadCaseAdapters(f.root, 'synthetic'), /escapes/);
});

test('interruption forwards termination and waits for the child cleanup before reporting failure', async () => {
  const { runCommand } = await import('../src/ui-runner.ts');
  const signal = new AbortController();
  const pending = runCommand(process.execPath, ['-e', "process.on('SIGTERM',()=>{console.log('cleanup-complete');process.exit(0)});setInterval(()=>{},1000)"], process.cwd(), 5000, process.env, signal.signal);
  const timer = setTimeout(() => signal.abort(), 200);
  try { await assert.rejects(pending, (error: any) => { assert.match(error.message, /interrupted/); assert.match(error.record.stdout, /cleanup-complete/); return true; }); }
  finally { clearTimeout(timer); }
});

test('an already canceled command does not attempt to launch an executable', async () => {
  const { runCommand } = await import('../src/ui-runner.ts');
  const signal = new AbortController(); signal.abort();
  await assert.rejects(runCommand('/nonexistent/helix-canceled-command', [], process.cwd(), 5000, process.env, signal.signal), /interrupted before launch/);
});
