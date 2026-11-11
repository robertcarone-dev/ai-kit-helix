import { comparisonLinks } from '../src/comparison-index.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { catalogStatus, loadCatalog } from '../src/catalog.ts';
import { acceptanceBackend } from '../workbench/acceptance-backend.ts';
import { digest } from '../src/acceptance-format.ts';
function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'catalog-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path: string, value: any) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value)); };
  const entry = { id: 'screen.home', title: 'Home', kind: 'screen', group: 'Screens', scope: 'game', summary: 'Synthetic inventory', sources: ['source.txt'], implementationReferences: ['source.txt'], discrepancies: ['home-layout'], evidence: [], acceptanceItem: null };
  const catalog = { version: 1, project: 'synthetic', title: 'Synthetic catalog', exclusions: [], sources: ['source.txt'], legacyReport: 'Tools/Helix/catalog/legacy.json', entries: [entry] };
  put('Tools/Helix/catalog/catalog.json', catalog); put('source.txt', 'source'); put('evidence.txt', 'evidence');
  put('Tools/Helix/catalog/legacy.json', { format: 'helix-porting-dashboard', version: 1, project: 'synthetic', reportedUtc: '2026-11-11T12:00:00.000Z', items: [{ id: entry.id, title: 'Home', kind: 'screen', status: 'ported', summary: 'Old scoped claim', issues: [], evidence: ['missing.png'] }] });
  const discrepancy = { schemaVersion: 1, id: 'home-layout', status: 'open', expected: 'Expected layout', observed: 'Mismatch', nextAction: 'Compare again', evidence: [{ path: 'evidence.txt', sha256: digest('evidence') }] };
  put('Tools/Helix/discrepancies/home-layout/1.json', discrepancy);
  return { root, put, catalog, entry, discrepancy };
}
test('whole inventory survives missing coverage and retains legacy claims without granting acceptance', t => {
  const f = fixture(t), report = catalogStatus(f.root, 'synthetic');
  assert.equal(report.summary.accepted, 0); assert.equal(report.summary.definedCoverage, 0);
  assert.equal(report.entries[0].legacy.status, 'ported'); assert.equal(report.entries[0].acceptance, null);
  assert.equal(report.entries[0].evidence.find((file: any) => file.path === 'missing.png').availability, 'missing locally');
});
test('latest numeric revision wins; resolved records without nextAction are supported; new gaps remain visible', t => {
  const f = fixture(t), { nextAction, ...resolved } = f.discrepancy;
  f.put('Tools/Helix/discrepancies/home-layout/10.json', { ...resolved, status: 'resolved' });
  f.put('Tools/Helix/discrepancies/home-layout/2.json', f.discrepancy);
  f.put('Tools/Helix/discrepancies/new-gap/1.json', { ...f.discrepancy, id: 'new-gap' });
  const report = catalogStatus(f.root, 'synthetic');
  assert.equal(report.entries[0].issues[0].revision, 10); assert.equal(report.entries[0].issues[0].nextAction, null);
  assert.deepEqual(report.unmappedDiscrepancies, ['new-gap']); assert.equal(report.summary.accepted, 0);
});
test('definitions reject wrong projects, duplicate IDs, broken mappings, and escaping sources', t => {
  const f = fixture(t);
  assert.throws(() => loadCatalog(f.root, 'other'), /project/);
  f.catalog.entries.push(f.entry); f.put('Tools/Helix/catalog/catalog.json', f.catalog);
  assert.throws(() => loadCatalog(f.root, 'synthetic'), /Duplicate/);
  f.catalog.entries.pop(); f.entry.discrepancies = ['unknown']; f.put('Tools/Helix/catalog/catalog.json', f.catalog);
  assert.throws(() => catalogStatus(f.root, 'synthetic'), /Unknown linked/);
  f.entry.discrepancies = []; f.entry.sources = ['escape/file']; f.put('Tools/Helix/catalog/catalog.json', f.catalog); symlinkSync('/etc', join(f.root, 'escape'));
  assert.throws(() => catalogStatus(f.root, 'synthetic'), /escapes/);
});
test('catalog media is restricted to registered evidence, exact record identity and matching bytes', async t => {
  const f = fixture(t);
  const call = (input: any) => acceptanceBackend(f.root, f.root, 'synthetic', '/acceptance/catalog-evidence', input);
  const input = { item: 'screen.home', artifact: 0, expectedPath: 'evidence.txt', expectedSha256: digest('evidence') };
  assert.equal(await (await call(input)).text(), 'evidence');
  await assert.rejects(call({ ...input, expectedPath: 'source.txt' }), /changed/);
  await assert.rejects(call({ ...input, artifact: 99 }), /registered/);
  f.put('evidence.txt', 'changed'); await assert.rejects(call(input), /hash differs/);
});
test('acceptance is joined by explicit stable ID and cannot be counted twice', t => {
  const f = fixture(t); (f.entry as any).acceptanceItem = 'screen.home'; f.put('Tools/Helix/catalog/catalog.json', f.catalog);
  assert.throws(() => catalogStatus(f.root, 'synthetic'), /Missing declared acceptance/);
  const report = catalogStatus(f.root, 'synthetic', { items: [{ id: 'screen.home', status: 'incomplete', required: 2, accepted: 1, cases: [] }] });
  assert.equal(report.summary.accepted, 0); assert.equal(report.entries[0].acceptance.accepted, 1);
  f.catalog.entries.push({ ...f.entry, id: 'screen.other' }); f.put('Tools/Helix/catalog/catalog.json', f.catalog);
  assert.throws(() => loadCatalog(f.root, 'synthetic'), /mapped more than once/);
});

test('new catalog entries can own prepared comparisons before a legacy dashboard row exists', t => {
  const f = fixture(t);
  assert.deepEqual(comparisonLinks(f.root, 'synthetic', 'screen.home'), [{ item: 'screen.home' }]);
  assert.throws(() => comparisonLinks(f.root, 'synthetic', 'screen.home', '1'), /1-based/);
  assert.throws(() => comparisonLinks(f.root, 'synthetic', 'unknown'), /Unknown dashboard item/);
});


test('existing dashboard links remain usable while an optional catalog is invalid', t => {
  const f = fixture(t);
  f.put('.helix/porting-dashboard.json', { format: 'helix-porting-dashboard', version: 1, project: 'synthetic', reportedUtc: '2026-11-11T12:00:00.000Z', items: [{ id: 'screen.home', kind: 'screen', title: 'Home', status: 'in-progress', summary: 'Existing row', issues: [], evidence: [] }] });
  f.put('Tools/Helix/catalog/catalog.json', { version: 99 });
  assert.deepEqual(comparisonLinks(f.root, 'synthetic', 'screen.home'), [{ item: 'screen.home' }]);
  assert.throws(() => comparisonLinks(f.root, 'synthetic', 'screen.new'), /catalog/);
});
