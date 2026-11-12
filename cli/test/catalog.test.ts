import { comparisonLinks } from '../src/comparison-index.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { catalogStatus, loadCatalog, catalogTree, renderCatalogTree } from '../src/catalog.ts';
import { acceptanceBackend } from '../src/acceptance-backend.ts';
import { digest, recordHash } from '../src/acceptance-format.ts';
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

test('folders, specifications and discipline assignments preserve feature identity and evidence boundaries', async t => {
  const f = fixture(t);
  Object.assign(f.catalog, { folders: [{ id: 'game', title: 'Game', parent: null }, { id: 'home', title: 'Home', parent: 'game' }], workAssignments: { 'home-layout': 'ta' } });
  Object.assign(f.entry, { folder: 'home', specs: [{ kind: 'markdown', title: 'Design', target: 'design.md' }, { kind: 'confluence', title: 'GDD', target: 'https://example.atlassian.net/wiki/pages/123' }] });
  f.put('design.md', '# Design'); f.put('Tools/Helix/catalog/catalog.json', f.catalog);
  const report = catalogStatus(f.root, 'synthetic');
  assert.equal(report.entries[0].id, 'screen.home'); assert.equal(report.entries[0].issues[0].discipline, 'ta'); assert.equal(report.entries[0].folder, 'home');
  const index = report.entries[0].evidence.findIndex((value: any) => value.path === 'design.md');
  const response = await acceptanceBackend(f.root, f.root, 'synthetic', '/acceptance/catalog-evidence', { item: 'screen.home', artifact: index, expectedPath: 'design.md', expectedSha256: null });
  assert.equal(await response.text(), '# Design');
  (f.catalog as any).folders[0].parent = 'home'; f.put('Tools/Helix/catalog/catalog.json', f.catalog); assert.throws(() => loadCatalog(f.root, 'synthetic'), /cycle/);
  (f.catalog as any).folders[0].parent = null; (f.entry as any).folder = 'missing'; f.put('Tools/Helix/catalog/catalog.json', f.catalog); assert.throws(() => loadCatalog(f.root, 'synthetic'), /Unknown feature folder/);
  (f.entry as any).folder = 'home'; (f.entry as any).specs[1].target = 'javascript:alert(1)'; f.put('Tools/Helix/catalog/catalog.json', f.catalog); assert.throws(() => loadCatalog(f.root, 'synthetic'), /HTTPS/);
});

test('folder selection includes descendants and Dev/TA includes shared open work without treating resolved work as pending', async t => {
  const { selectCatalogEntries } = await import('../src/catalog-selection.ts');
  const f = fixture(t);
  Object.assign(f.catalog, { folders: [{ id: 'game', title: 'Game', parent: null }, { id: 'home', title: 'Home', parent: 'game' }], workAssignments: { 'home-layout': 'shared' } });
  Object.assign(f.entry, { folder: 'home' }); f.put('Tools/Helix/catalog/catalog.json', f.catalog);
  const report = catalogStatus(f.root, 'synthetic');
  assert.equal(selectCatalogEntries(report, { folder: 'game', discipline: 'dev' }).length, 1);
  assert.equal(selectCatalogEntries(report, { folder: 'home', discipline: 'ta' }).length, 1);
  assert.equal(selectCatalogEntries(report, { discipline: 'unassigned' }).length, 0);
  assert.throws(() => selectCatalogEntries(report, { folder: 'missing' }), /Unknown/);
  assert.throws(() => selectCatalogEntries(report, { discipline: 'artist' }), /Invalid/);
  const tree = catalogTree(report, report.entries); assert.match(renderCatalogTree(tree), /Game.*\n.*Home.*\n.*screen.home/);
  report.entries[0].issues[0].status = 'resolved'; assert.equal(selectCatalogEntries(report, { discipline: 'dev' }).length, 0);
});

test('reconciliation is exact to record content and revision, preserves history and never grants acceptance', t => {
  const f = fixture(t);
  const finding = { id: 'home-layout', revision: 1, recordSha256: recordHash(f.discrepancy), kind: 'tooling', reason: 'Fixture issue only' };
  f.put('Tools/Helix/catalog/reconciliation.json', { version: 1, project: 'synthetic', findings: [finding] });
  let report = catalogStatus(f.root, 'synthetic');
  assert.equal(report.entries[0].issues[0].kind, 'tooling'); assert.equal(report.summary.accepted, 0);
  f.put('Tools/Helix/discrepancies/home-layout/1.json', { ...f.discrepancy, observed: 'Changed' });
  assert.equal(catalogStatus(f.root, 'synthetic').entries[0].issues[0].kind, 'untriaged');
  f.put('Tools/Helix/discrepancies/home-layout/2.json', f.discrepancy);
  assert.equal(catalogStatus(f.root, 'synthetic').entries[0].issues[0].kind, 'untriaged');
  f.put('Tools/Helix/discrepancies/home-layout/3.json', { ...f.discrepancy, status: 'resolved' });
  assert.equal(catalogStatus(f.root, 'synthetic').entries[0].issues[0].kind, 'history');
  f.put('Tools/Helix/catalog/reconciliation.json', { version: 1, project: 'synthetic', findings: [finding, finding] });
  assert.throws(() => catalogStatus(f.root, 'synthetic'), /Invalid reconciliation/);
});
