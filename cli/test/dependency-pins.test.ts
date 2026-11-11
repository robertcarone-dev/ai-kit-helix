import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dependencyPin, dependencyPinState } from '../src/dependency-pins.ts';
import { validateDependencySelectors } from '../src/dependency-selection.ts';
test('selected pins ignore unrelated rows and ordering but detect relevant changes', t => {
  const root = mkdtempSync(join(tmpdir(), 'dependency-pins-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (rows: unknown[], version = 1) => writeFileSync(join(root, 'config.json'), JSON.stringify({ version, rows }));
  const selected = { id: 'loss', value: 4 }, other = { id: 'shop', value: 2 };
  write([selected, other]);
  const pin = dependencyPin(root, 'config.json', [{ pointer: '/version' }, { pointer: '/rows', where: { id: 'loss' } }]);
  const legacy = dependencyPin(root, 'config.json');
  write([{ ...other, value: 3 }, selected]);
  assert.equal(dependencyPinState(root, pin), 'match'); assert.equal(dependencyPinState(root, legacy), 'changed');
  write([{ ...selected, value: 5 }, other]); assert.equal(dependencyPinState(root, pin), 'changed');
  write([selected], 2); assert.equal(dependencyPinState(root, pin), 'changed');
  write([other]); assert.equal(dependencyPinState(root, pin), 'changed');
  rmSync(join(root, 'config.json')); assert.equal(dependencyPinState(root, pin), 'missing');
});
test('invalid selector authoring fails clearly', () => {
  for (const selectors of [[], [{ pointer: 'rows' }], [{ pointer: '/a~2b' }], [{ pointer: '/rows', where: {} }], [{ pointer: '/rows', where: { id: 1 } }]]) assert.throws(() => validateDependencySelectors(selectors));
});
test('Markdown pins retain their section and ignore unrelated sections, including fenced headings', t => {
  const root = mkdtempSync(join(tmpdir(), 'markdown-pins-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (selected: string, other: string) => writeFileSync(join(root, 'spec.md'), '# Spec\n## Gameplay\n' + selected + '\n```md\n## Fake\n```\n### Details\nRequired\n## Shop\n' + other);
  write('Win', 'Prices'); const pin = dependencyPin(root, 'spec.md', [{ heading: '## Gameplay' }]);
  write('Win', 'New prices'); assert.equal(dependencyPinState(root, pin), 'match');
  write('Lose', 'New prices'); assert.equal(dependencyPinState(root, pin), 'changed');
  writeFileSync(join(root, 'spec.md'), '## Other\nNo gameplay'); assert.equal(dependencyPinState(root, pin), 'changed');
  writeFileSync(join(root, 'spec.md'), '## Gameplay\nA\n## Gameplay\nB'); assert.equal(dependencyPinState(root, pin), 'changed');
});
