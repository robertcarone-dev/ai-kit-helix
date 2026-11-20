import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { previewBridge, validateNativeRequest, validateCheat, writeNativeCapture, nativeRequest, NativePreviewTransportError } from '../src/native-preview.ts';
import { waitForCatalog, shippedAssets, previewStatus } from '../src/discovery.ts';
import { validateStep } from '../src/config.ts';

function bridge() {
  const listeners = new Map();
  const sent: any[] = [];
  const target = { postMessage: (msg: any) => sent.push(msg) };
  const window: any = { addEventListener: (name: string, fn: any) => listeners.set(name, fn) };
  const document = { getElementById: () => ({ contentWindow: target }) };
  vm.runInNewContext(previewBridge, { window, document, crypto: { randomUUID }, setTimeout, clearTimeout, Date });
  const receive = (data: any, source = target) => listeners.get('message')({ data, source });
  receive({ type: 'helix:document', docId: 'a', nonce: 'n', servedAt: 1, project: 'game' });
  receive({ type: 'helix:ready', nonce: 'n', capabilities: { cheats: true, clip: true, renderObject: true } });
  return { api: window.__helixCliPreview, sent, receive, listeners };
}
test('native bridge matches source, reply type and request ID and removes timed-out requests', async () => {
  const b = bridge();
  const pending = b.api.request({ type: 'helix:request:cheats', reply: 'helix:cheats', capability: 'cheats', args: {}, timeoutMs: 1000 });
  const requestId = b.sent[0].requestId;
  b.receive({ type: 'helix:cheats', requestId, cheats: ['wrong'] }, {} as any);
  b.receive({ type: 'helix:clip', requestId, cheats: ['wrong'] });
  b.receive({ type: 'helix:cheats', requestId, cheats: ['right'] });
  assert.equal((await pending).cheats[0], 'right');
  await assert.rejects(b.api.request({ type: 'x', reply: 'y', capability: 'cheats', args: {}, timeoutMs: 5 }), /may have run/);
  assert.throws(() => b.api.request({ capability: 'missing' }), /does not advertise/);
});
test('document replacement rejects in-flight actions and clears held state; stale notices are ignored', async () => {
  const b = bridge();
  b.receive({ type: 'helix:held', docId: 'old', trigger: 'ignored' });
  assert.equal(b.api.reading().heldReloadPending, false);
  b.receive({ type: 'helix:held', docId: 'a', trigger: 'write' });
  assert.equal(b.api.reading().heldReloadPending, true);
  const pending = b.api.request({ type: 'x', reply: 'y', capability: 'cheats', args: {}, timeoutMs: 1000 });
  const rejected = assert.rejects(pending, /document changed/);
  b.receive({ type: 'helix:document', docId: 'b', nonce: 'new', servedAt: 2, project: 'game' });
  await rejected;
  assert.equal(b.api.reading().generation, 2);
  assert.equal(b.api.reading().heldReloadPending, false);
  assert.equal(b.api.reading().ready, false);
  b.receive({ type: 'helix:ready', nonce: 'n', capabilities: { cheats: true } });
  assert.equal(b.api.reading().ready, false);
});
test('release cancels capture and blocks subsequent requests', async () => {
  const b = bridge();
  const pending = b.api.request({ type: 'x', reply: 'y', capability: 'clip', args: {}, timeoutMs: 1000 });
  const rejected = assert.rejects(pending, /requires a reload/);
  b.receive({ type: 'helix:release', docId: 'a', reason: 'changed-module' });
  await rejected;
  assert.throws(() => b.api.request({ capability: 'clip' }), /requires reset/);
});
test('native refusal tags survive transport and malformed replies fail', async () => {
  const page: any = { evaluate: async () => ({ ok: false, error: 'Not active', refusal: 'scene-not-active' }) };
  await assert.rejects(nativeRequest(page, 'run', { name: 'bomb', args: {} }), /scene-not-active/);
  await assert.rejects(nativeRequest(page, 'list'), /Malformed/);
});
test('native input validation rejects malformed and out-of-contract requests', () => {
  validateStep({ kind: 'cheat', purpose: 'fixture', name: 'bomb', args: {}, sceneKey: 'Game' });
  assert.throws(() => validateStep({ kind: 'cheat', name: 'bomb', args: {} }));
  assert.throws(() => validateCheat({ name: 'bomb', args: [] }));
  assert.throws(() => validateNativeRequest('clip', { durationMs: 10001 }));
  assert.throws(() => validateNativeRequest('clip', { durationMs: 100, frames: 1 }));
  assert.throws(() => validateNativeRequest('render', { name: 'Can', size: 2048 }));
  assert.throws(() => validateNativeRequest('render', { name: 'Can', context: 'true' }));
  assert.throws(() => validateNativeRequest('clip', { durationMs: 100, typo: true }));
  validateNativeRequest('clip', { durationMs: 1000, frames: 8, cheat: { name: 'bomb', args: {} } });
  validateNativeRequest('render', { name: 'Can', turntable: 12 });
});
test('native captures preserve original PNG bytes, measured times, and diagnostic scope', () => {
  const dir = mkdtempSync(join(tmpdir(), 'helix-native-'));
  try {
    const png = PNG.sync.write(new PNG({ width: 4, height: 2 }));
    const result = writeNativeCapture(dir, 'clip', { ok: true, dataUrl: 'data:image/png;base64,' + png.toString('base64'), frames: [0, 75, 199], requested: 8, rendered: 3 }, { preview: { documentId: 'a' } });
    assert.deepEqual(readFileSync(join(dir, 'filmstrip.png')), png);
    const receipt = JSON.parse(readFileSync(join(dir, 'native.json'), 'utf8'));
    assert.equal(receipt.nativeViewport, false);
    assert.deepEqual(receipt.result.frames, [0, 75, 199]);
    assert.equal(receipt.result.dataUrl, undefined);
    assert.equal(result.imagePath, join(dir, 'filmstrip.png'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('startup retries only connection errors, then surfaces HTTP/schema failures immediately', async () => {
  const saved = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return new Response('{}', { status: 401 }); };
    await assert.rejects(waitForCatalog('http://localhost', 500), /HTTP 401/);
    assert.equal(calls, 1);
    globalThis.fetch = async () => new Response('{}');
    await assert.rejects(waitForCatalog('http://localhost', 500), /Unexpected/);
    globalThis.fetch = async () => { throw new TypeError('refused', { cause: { code: 'ECONNREFUSED' } }); };
    await assert.rejects(waitForCatalog('http://localhost', 10), /within 10 ms/);
  } finally { globalThis.fetch = saved; }
});
test('asset index miss is distinct from empty classification and compute is explicit', async () => {
  const saved = globalThis.fetch;
  const identity = { serviceUrl: 'http://localhost', project: 'test', variant: 'Default' };
  const urls: string[] = [];
  let body: any = { state: 'ready', variants: [] };
  try {
    globalThis.fetch = async (url) => { urls.push(String(url)); return new Response(JSON.stringify(body)); };
    const missing = await shippedAssets(identity);
    assert.equal(missing.state, 'not-indexed'); assert.equal(missing.paths, null);
    assert.match(urls[0], /index=1/);
    body = { state: 'ready', variants: [{ playableKey: 'Default', paths: [] }] };
    assert.deepEqual((await shippedAssets(identity)).paths, []);
    body = { state: 'pending', jobId: 'job' };
    assert.equal((await shippedAssets(identity, 'compute')).state, 'pending');
    assert.doesNotMatch(urls[2], /index=/);
    body = { state: 'failed', error: 'failure' };
    assert.equal((await shippedAssets(identity, 'compute')).error, 'failure');
    body = { phase: 'installing' };
    assert.equal((await previewStatus(identity)).phase, 'installing');
  } finally { globalThis.fetch = saved; }
});

test('transport failures are distinct from refused actions so the owner can retire uncertain sessions', async () => {
  const page: any = { evaluate: async () => { throw new Error('context destroyed'); } };
  await assert.rejects(nativeRequest(page, 'run', { name: 'bomb', args: {} }), NativePreviewTransportError);
});
