import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { UI_INSPECTOR } from '../src/ui-inspector.ts';
// Opt in because installing a browser is not a prerequisite of pure report/installer tests.
test(
  'browser probe maps exact objects, applies baseline transforms and detects DOM occlusion',
  { skip: process.env.HELIX_BROWSER_TESTS !== '1' },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 320, height: 640 },
        deviceScaleFactor: 1,
      });
      await page.setContent(
        '<canvas width="320" height="640" style="position:absolute;left:0;top:0;width:320px;height:640px"></canvas><button id="target" style="position:absolute;left:10px;top:100px;width:100px;height:40px">Buy</button><div style="position:absolute;left:10px;top:100px;width:100px;height:40px;z-index:10"></div>',
      );
      await page.evaluate(() => {
        const w: any = window;
        const text = {
          name: 'Price',
          type: 'Text',
          text: 'One\nTwo',
          visible: true,
          alpha: 1,
          x: 10,
          y: 20,
          scaleX: 2,
          scaleY: 2,
          rotation: 0,
          style: {
            fontFamily: 'Arial',
            fontSize: '16px',
            metrics: { fontSize: 16, ascent: 12 },
            strokeThickness: 2,
            maxLines: 1,
          },
          padding: { top: 3 },
          displayOriginX: 0,
          displayOriginY: 0,
          autoRound: true,
          getWrappedText: () => ['One', 'Two'],
          getBounds: () => ({ x: 10, y: 20, width: 100, height: 40 }),
          getWorldTransformMatrix: () => ({
            transformPoint: (x: number, y: number) => ({ x: 10 + 2 * x, y: 20 + 2 * y }),
          }),
        };
        w.target = text;
        w.game = {
          canvas: document.querySelector('canvas'),
          scale: { gameSize: { width: 320, height: 640 } },
          scene: {
            getScenes: () => [
              {
                sys: { settings: { key: 'Shop' } },
                cameras: {
                  main: {
                    scrollX: 0,
                    scrollY: 0,
                    matrix: { transformPoint: (x: number, y: number) => ({ x, y }) },
                  },
                },
                children: { list: [text] },
              },
            ],
          },
        };
      });
      const snapshot = await page.evaluate(
        '(' +
          UI_INSPECTOR +
          ')(' +
          JSON.stringify({
            phaser: 'window.game',
            bindings: [{ id: 'price', expression: 'window.target' }],
            state: '({view:"shop"})',
          }) +
          ')',
      );
      const price = snapshot.nodes.find((n: any) => n.semanticId === 'price');
      assert.equal(price.text.baseline, 52);
      assert.equal(price.text.lineCount, 1);
      assert.equal(
        snapshot.nodes.find((n: any) => n.name === 'target').input.topmostAtCenter,
        false,
      );
      assert.deepEqual(snapshot.bindingErrors, []);
      assert.equal(snapshot.coordinateSpace, 'native-top-left-pixels');
    } finally {
      await browser.close();
    }
  },
);

test(
  'host executes semantic input assertions and restores the clock after capture failure',
  { skip: process.env.HELIX_BROWSER_TESTS !== '1', timeout: 30000 },
  async () => {
    const { createServer } = await import('node:http');
    const { createConnection } = await import('node:net');
    const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } =
      await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { spawn } = await import('node:child_process');
    const root = mkdtempSync(join(tmpdir(), 'helix-host-ui-'));
    let child: any;
    const server = createServer((_, response) => {
      response.setHeader('content-type', 'text/html');
      response.end(
        `<canvas style="position:absolute;left:0;top:0;width:320px;height:640px" width="320" height="640"></canvas><button id="buy" style="position:absolute;left:10px;top:20px;width:100px;height:40px" onclick="window.clicks++">Buy</button><script>window.clicks=0;window.game={canvas:document.querySelector('canvas'),scale:{gameSize:{width:320,height:640}},scene:{getScenes:()=>[]},loop:{running:true,sleep(){this.running=false},wake(){this.running=true}}};window.ready=true;</script>`,
      );
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const request = async (data: any) => {
      const connection = JSON.parse(readFileSync(join(root, '.helix/connection.json'), 'utf8'));
      return new Promise<any>((done, reject) => {
        const socket = createConnection({ host: '127.0.0.1', port: connection.port });
        let body = '';
        socket.setTimeout(10000, () => socket.destroy(new Error('test request timeout')));
        socket.on('error', reject);
        socket.on('connect', () =>
          socket.write(JSON.stringify({ ...data, token: connection.token }) + '\n'),
        );
        socket.on('data', (chunk) => {
          body += chunk;
          if (body.includes('\n')) {
            socket.end();
            const result = JSON.parse(body.split('\n')[0]);
            result.ok ? done(result.result) : reject(new Error(result.error));
          }
        });
      });
    };
    try {
      mkdirSync(join(root, 'Tools/Helix'), { recursive: true });
      mkdirSync(join(root, '.helix'));
      writeFileSync(join(root, 'Tools/Helix/reference.json'), '{}');
      const config = {
        url: `http://127.0.0.1:${(server.address() as any).port}`,
        phaser: 'window.game',
        ready: 'window.ready',
        viewports: { phone: { width: 320, height: 640 } },
        uiClockHold: 'phaser-loop',
        uiBindings: [{ id: 'shop.buy', expression: 'document.getElementById("buy")' }],
        scenarios: {
          shop: {
            steps: [
              { kind: 'press', target: 'shop.buy' },
              { kind: 'assert', expression: 'window.clicks', expected: 1 },
            ],
            ready: 'window.clicks===1',
            state: '({view:"shop",clicks:window.clicks})',
          },
        },
      };
      writeFileSync(
        join(root, '.helix/launch.json'),
        JSON.stringify({
          config,
          configHash: 'synthetic-test',
          adapterConfigHash: 'synthetic-test',
          launchId: 'synthetic-launch',
          startedUtc: new Date().toISOString(),
          startupDeadline: Date.now() + 20000,
          viewport: 'phone',
          token: 'test-token',
        }),
      );
      child = spawn(
        process.execPath,
        [fileURLToPath(new URL('../src/host.ts', import.meta.url)), '--project-root', root],
        { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let log = '';
      child.stderr.on('data', (b: any) => (log += b));
      child.stdout.resume();
      for (let i = 0; i < 100 && !existsSync(join(root, '.helix/connection.json')); i++) {
        if (child.exitCode !== null) throw new Error(log);
        await new Promise((r) => setTimeout(r, 50));
      }
      assert(existsSync(join(root, '.helix/connection.json')), log);
      await request({ method: 'scenario', name: 'shop' });
      const inspected = await request({ method: 'ui-look', match: 'shop.buy' });
      assert.equal(inspected.nodes[0].semanticId, 'shop.buy');
      const out = join(root, 'evidence');
      await request({ method: 'capture', label: 'shop', out });
      const receipt = JSON.parse(readFileSync(join(out, 'reference.json'), 'utf8'));
      assert.equal(receipt.ui.clockHold, 'phaser-loop');
      assert.equal(receipt.state.clicks, 1);
      await assert.rejects(request({ method: 'capture', label: 'shop', out }), /empty/);
      await request({
        method: 'step',
        step: { kind: 'assert', expression: 'window.game.loop.running', expected: true },
      });
      await assert.rejects(
        request({
          method: 'step',
          step: { kind: 'assert', expression: 'window.clicks', expected: 99 },
        }),
        /Assertion failed/,
      );
      await request({ method: 'stop' });
    } finally {
      if (child && child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise<void>((r) => {
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
            r();
          }, 3000);
          child.once('close', () => {
            clearTimeout(timer);
            r();
          });
        });
      }
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(root, { recursive: true, force: true });
    }
  },
);
