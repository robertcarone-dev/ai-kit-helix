import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  statSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runBatch } from '../src/batch.ts';
test(
  'generic project hooks capture warm batches, resume unchanged bytes and reject changed helpers',
  { skip: process.env.HELIX_BROWSER_TESTS !== '1', timeout: 60000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'generic-helix-batch-'));
    const server = createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<html><body style="margin:0;background:white"><div id="shape" style="width:20px;height:20px;background:red"></div></body></html>',
      );
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as any).port}/`;
    try {
      mkdirSync(join(root, 'tools'));
      const helper = join(root, 'tools/fixture.js');
      writeFileSync(helper, 'window.batchState={generation:0};');
      const batch = {
        scripts: ['tools/fixture.js'],
        views: ['left', 'right'],
        reset:
          '(fixture,seed)=>{window.priorGeneration=window.batchState.generation;setTimeout(()=>{window.batchState={generation:window.priorGeneration+1,fixture,seed};},25)}',
        ready:
          '(fixture,seed)=>window.batchState.generation>window.priorGeneration && window.batchState.seed===seed && JSON.stringify(window.batchState.fixture)===JSON.stringify(fixture)',
        probe: '()=>window.batchState',
        view: 'view=>{document.getElementById("shape").style.marginLeft=view==="left"?"0px":"30px"}',
      };
      const config = {
        url,
        ready: 'document.readyState === "complete"',
        referenceIdentity: { project: 'synthetic', variant: 'Default', url },
        viewports: { small: { width: 128, height: 192 } },
        batch,
      };
      const spec = {
        schemaVersion: 1,
        cases: [
          { id: 'one', viewport: 'small', fixture: { value: 1 }, views: ['left', 'right'] },
          { id: 'two', viewport: 'small', fixture: { value: 2 }, views: ['left', 'right'] },
        ],
      };
      const out = join(root, 'evidence');
      const first = await runBatch({ root, config, spec, out });
      assert.equal(first.status, 'captured');
      assert.equal(first.performance.captures, 4);
      const png = join(out, 'one-left.png'),
        before = statSync(png).mtimeMs,
        bytes = readFileSync(png);
      const resumed = await runBatch({ root, config, spec, out, resume: true });
      assert.equal(resumed.status, 'captured');
      assert.equal(resumed.performance.reused, 4);
      assert.equal(resumed.performance.captures, 0);
      assert.equal(statSync(png).mtimeMs, before);
      writeFileSync(helper, 'window.batchState={generation:0}; // changed source');
      const changed = await runBatch({ root, config, spec, out, resume: true });
      assert.equal(changed.status, 'blocked');
      assert.equal(changed.performance.reused, 0);
      assert.deepEqual(readFileSync(png), bytes);
      assert.equal(existsSync(join(out, '.batch.lock')), false);
      await assert.rejects(
        runBatch({
          root,
          config: { ...config, batch: { ...batch, scripts: ['missing.js'] } },
          spec,
          out: join(root, 'invalid'),
        }),
      );
      assert.equal(existsSync(join(root, 'invalid')), false);
    } finally {
      server.close();
      await new Promise<void>((r) =>
        server.closeAllConnections ? (server.closeAllConnections(), r()) : r(),
      );
      rmSync(root, { recursive: true, force: true });
    }
  },
);
