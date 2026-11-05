import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import { runMatrix } from '../src/ui-runner.ts';
import { sha } from '../src/config.ts';
test('matrix reuses browser while restoring Unity per case and closes at viewport boundary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'helix-matrix-test-'));
  const calls: string[] = [];
  const json = (p: string, d: any) => writeFileSync(p, JSON.stringify(d));
  try {
    mkdirSync(join(root, 'Tools/Helix'), { recursive: true });
    mkdirSync(join(root, '.aikit'), { recursive: true });
    // This is a fake filesystem fixture; the injected command never starts Unity or AI Kit.
    json(join(root, '.aikit/lane.json'), {});
    json(join(root, 'Tools/Helix/reference.json'), {
      scenarios: { s: { unity: {} } },
      viewports: {
        phone: { width: 2, height: 2 },
        tablet: { width: 2, height: 2 },
      },
    });
    json(join(root, 'ui.json'), {
      schemaVersion: 1,
      stateKeys: ['screen'],
      elements: [
        {
          id: 'button',
          reference: { name: 'button' },
          candidate: { name: 'button' },
        },
      ],
    });
    json(join(root, 'matrix.json'), {
      schemaVersion: 1,
      cases: [
        { id: 'a', viewport: 'phone' },
        { id: 'b', viewport: 'phone' },
        { id: 'c', viewport: 'tablet' },
      ].map((c) => ({ ...c, scenario: 's', uiSpec: 'ui.json' })),
    });
    let current = '';
    const stages = {
      preflight: [['preflight']],
      prepare: [['prepare']],
      capture: [['capture-unity']],
      restore: [['restore']],
    };
    const snapshot = (dir: string, name: string) => {
      mkdirSync(dir, { recursive: true });
      const p = new PNG({ width: 2, height: 2 });
      p.data.fill(255);
      const bytes = PNG.sync.write(p);
      writeFileSync(join(dir, 'image.png'), bytes);
      json(join(dir, name + '.json'), {
        image: 'image.png',
        sha256: sha(bytes),
        ui: {
          schemaVersion: 1,
          coordinateSpace: 'native-top-left-pixels',
          viewport: { width: 2, height: 2, dpr: 1, zoom: 1 },
          safeArea: { x: 0, y: 0, width: 2, height: 2 },
          state: { screen: 's' },
          nodes: [],
        },
      });
    };
    const command = async (executable: string, args: string[]) => {
      const action = executable === process.execPath ? args[1] : args[0];
      calls.push(action);
      let payload: any = {};
      if (action === 'unity-plan') {
        current = args[args.indexOf('--out') + 1];
        payload = { stages };
      }
      if (action === 'capture') snapshot(args[args.indexOf('--out') + 1], 'reference');
      if (action === 'capture-unity') snapshot(current, 'unity');
      return {
        executable,
        args,
        exitCode: 0,
        stdout: JSON.stringify(payload),
        stderr: '',
        elapsedMs: 1,
      };
    };
    const result = await runMatrix(
      {
        root,
        cli: 'cli.ts',
        specPath: join(root, 'matrix.json'),
        out: join(root, '.aikit/scratch/result'),
        execute: 'yes',
      },
      command,
    );
    assert.equal(result.cases.length, 3);
    assert.equal(calls.filter((c) => c === 'stop').length, 2);
    assert.equal(calls.filter((c) => c === 'restore').length, 3);
    assert.equal(existsSync(join(root, '.helix/ui-matrix.lock')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
