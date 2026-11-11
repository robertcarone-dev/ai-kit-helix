import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { unityPlan, unityExecutable } from '../src/unity-plan.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = mkdtempSync(join(tmpdir(), 'helix project with spaces '));
execFileSync('git', ['init', '--quiet', root]);
execFileSync('git', [
  '-C',
  root,
  '-c',
  'user.name=Helix Test',
  '-c',
  'user.email=test@example.invalid',
  '-c',
  'commit.gpgsign=false',
  'commit',
  '--allow-empty',
  '-m',
  'Synthetic baseline',
]);
after(() => rmSync(root, { recursive: true, force: true }));
const commands = {
  preflight: ['check'],
  prepare: ['prepare'],
  capture: ['capture'],
  restore: ['restore'],
};
const config = (unity: any) => ({
  scenarios: { lobby: { unity } },
  viewports: { phone: { width: 32, height: 64 } },
});
const plan = (unity: any) =>
  unityPlan(config(unity), root, 'lobby', 'phone', '.aikit/scratch/case');
test('legacy AI Kit plans retain argument arrays and complete lifecycle', () => {
  const result = plan(commands);
  assert.equal(result.backend, 'ai-kit');
  assert.deepEqual(result.stages.capture, [['capture']]);
  assert.equal(unityExecutable(result), 'ai-kit');
  assert.throws(() => plan({ ...commands, restore: [] }), /Incomplete/);
  assert.throws(() => plan({ ...commands, capture: [[]] }), /nonempty/);
});
test('Unity backend pins each command before its parameter fence', () => {
  const result = plan({
    backend: 'unity',
    stages: {
      ...commands,
      capture: [
        'command',
        'script',
        'eval',
        '--',
        '--code',
        'Capture("{{capture}}", {{width}}, {{height}});',
      ],
    },
  });
  assert.equal(unityExecutable(result), 'unity');
  assert.deepEqual(result.stages.capture[0], [
    'command',
    'script',
    'eval',
    '--project-path',
    root,
    '--',
    '--code',
    `Capture("${root}/.aikit/scratch/case/unity.png", 32, 64);`,
  ]);
  assert.equal(
    unityExecutable(result, { aiKit: '/wrong', unity: '/custom-unity' }),
    '/custom-unity',
  );
});
test('unknown backends, alternate targets and escaping output are refused', () => {
  assert.throws(() => plan({ backend: 'shell', stages: commands }), /backend/);
  for (const args of [
    ['command', '--project-path', '/elsewhere'],
    ['command', '--pid', '1'],
    ['command', '--runtime=game'],
    ['command', '--project-path=/elsewhere'],
  ])
    assert.throws(
      () => plan({ backend: 'unity', stages: { ...commands, capture: args } }),
      /project|selectors/,
    );
  assert.throws(() => unityPlan(config(commands), root, 'lobby', 'phone', '../outside'), /scratch/);
  assert.throws(() => unityExecutable({ backend: 'unity', executable: 'sh' }), /backend/);
});
