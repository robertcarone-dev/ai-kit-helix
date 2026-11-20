import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readProjectConfig } from '../src/config.ts';
const exec = promisify(execFile);
const cli = new URL('../src/cli.ts', import.meta.url).pathname;
function fixture(origin: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'helix-health-')));
  mkdirSync(join(root, 'Tools/Helix'), { recursive: true });
  mkdirSync(join(root, '.helix'));
  const config = { helix: { project: 'test', variant: 'Default', url: origin }, ready: 'true', viewports: { phone: { width: 320, height: 640 } }, scenarios: {} };
  writeFileSync(join(root, 'Tools/Helix/reference.json'), JSON.stringify(config));
  return { root, config, hash: readProjectConfig(root).configHash };
}
async function listen(server: any) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
async function close(server: any) { await new Promise<void>((resolve) => server.close(() => resolve())); }
function env(origin: string) { const env = { ...process.env, HELIX_URL: origin }; delete env.HELIX_FIXTURE_SESSION; return env; }

test('doctor exits unsuccessfully with structured service diagnostics', async () => {
  const server = createServer((_req, res) => { res.writeHead(401); res.end('{}'); });
  const origin = 'http://127.0.0.1:' + await listen(server);
  const f = fixture(origin);
  try {
    await assert.rejects(exec(process.execPath, [cli, 'doctor', '--project-root', f.root], { env: env(origin) }), (error: any) => {
      assert.equal(error.code, 1);
      const result = JSON.parse(error.stdout);
      assert.equal(result.healthy, false);
      assert.match(result.error, /HTTP 401/);
      return true;
    });
  } finally { await close(server); rmSync(f.root, { recursive: true, force: true }); }
});
test('start reuses only matching live-session identity; refresh contacts catalog and changed inputs refuse reuse', async () => {
  let catalogCalls = 0;
  const service = createServer((_req, res) => { catalogCalls++; res.writeHead(401); res.end('{}'); });
  const origin = 'http://127.0.0.1:' + await listen(service);
  const f = fixture(origin);
  const token = 'test-token';
  const host = createSocketServer((socket) => {
    let bytes = '';
    socket.on('data', (chunk) => {
      bytes += chunk;
      if (!bytes.includes('\n')) return;
      const req = JSON.parse(bytes.trim());
      assert.equal(req.token, token);
      socket.end(JSON.stringify({ ok: true, result: { adapterConfigHash: f.hash, viewport: 'phone', ready: true } }) + '\n');
    });
  });
  const port = await listen(host);
  writeFileSync(join(f.root, '.helix/connection.json'), JSON.stringify({ port, token, projectRoot: f.root, pid: process.pid }));
  writeFileSync(join(f.root, '.helix/launch.json'), JSON.stringify({ token, config: { ...f.config, audioOutput: false, previewMode: 'direct', url: origin + '/preview/test/?variant=Default', referenceIdentity: { serviceUrl: origin, url: origin + '/preview/test/?variant=Default' } } }));
  try {
    const result = JSON.parse((await exec(process.execPath, [cli, 'start', '--project-root', f.root], { env: env(origin) })).stdout);
    assert.equal(result.discovery, 'owned-session');
    assert.equal(catalogCalls, 0);
    await assert.rejects(exec(process.execPath, [cli, 'start', '--refresh', 'yes', '--project-root', f.root], { env: env(origin) }), /HTTP 401/);
    assert.equal(catalogCalls, 1);
    await assert.rejects(exec(process.execPath, [cli, 'start', '--preview', 'native', '--project-root', f.root], { env: env(origin) }), /different config/);
    assert.equal(catalogCalls, 1);
  } finally { await close(host); await close(service); rmSync(f.root, { recursive: true, force: true }); }
});
