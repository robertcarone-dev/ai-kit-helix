import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateBatch, reusable, permit } from '../src/batch.ts';
import { sha } from '../src/config.ts';
const config = {
  batch: {
    scripts: [],
    views: ['front', 'side', 'top'],
    reset: '()=>{}',
    ready: '()=>true',
    probe: '()=>({})',
    view: '()=>{}',
  },
  viewports: { phone: { width: 585, height: 1266 } },
};
const c = {
  id: 'one',
  viewport: 'phone',
  fixture: { payload: {} },
  views: ['front'],
};
test('batch rejects ambiguous or unsafe cases', () => {
  validateBatch({ schemaVersion: 1, cases: [c] }, config);
  for (const change of [
    { id: '../escape' },
    { viewport: 'unknown' },
    { views: ['front', 'front'] },
    { views: ['destroy'] },
    { seed: NaN },
  ])
    assert.throws(() => validateBatch({ schemaVersion: 1, cases: [{ ...c, ...change }] }, config));
  assert.throws(() => validateBatch({ schemaVersion: 1, cases: [c, c] }, config));
});
test('resume requires both input identity and original bytes', () => {
  const png = Buffer.from('original'),
    r = { fingerprint: 'inputs', sha256: sha(png), status: 'captured' };
  assert.ok(reusable(r, 'inputs', png));
  assert.ok(!reusable(r, 'changed', png));
  assert.ok(!reusable(r, 'inputs', Buffer.from('changed')));
  assert.ok(!reusable({ ...r, status: 'blocked' }, 'inputs', png));
});
test('global worker budget permits two owners and releases on handoff', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'helix-permits-test-'));
  const abort = new AbortController();
  const leases: Awaited<ReturnType<typeof permit>>[] = [];
  let pending: Promise<void> | undefined;
  try {
    leases.push(await permit(abort.signal, dir), await permit(abort.signal, dir));
    let acquired = false;
    pending = permit(abort.signal, dir).then((lease) => {
      leases.push(lease);
      acquired = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(acquired, false);
    await leases.shift()!.release();
    await pending;
    assert.equal(acquired, true);
    assert.ok(leases.every((lease) => !lease.lost.aborted));
  } finally {
    abort.abort();
    if (pending) await pending.catch(() => {});
    await Promise.all(leases.map((lease) => lease.release()));
    rmSync(dir, { recursive: true, force: true });
  }
});
test('cancelled waiter does not take or delete another owners slot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'helix-permits-test-'));
  const owner = new AbortController();
  const waiter = new AbortController();
  const leases: Awaited<ReturnType<typeof permit>>[] = [];
  try {
    leases.push(await permit(owner.signal, dir), await permit(owner.signal, dir));
    const before = [0, 1].map((slot) => readFileSync(join(dir, `${slot}.lock`), 'utf8'));
    const pending = permit(waiter.signal, dir);
    const rejected = assert.rejects(pending, /interrupted/);
    await new Promise((resolve) => setTimeout(resolve, 150));
    waiter.abort();
    await rejected;
    assert.deepEqual(
      [0, 1].map((slot) => readFileSync(join(dir, `${slot}.lock`), 'utf8')),
      before,
    );
    assert.ok(leases.every((lease) => !lease.lost.aborted));
    await assert.rejects(permit(waiter.signal, dir), { name: 'AbortError' });
  } finally {
    waiter.abort();
    await Promise.all(leases.map((lease) => lease.release()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cache excludes only known diagnostic stamp fields and retains game content', async () => {
  const { sourceRecord } = await import('../src/batch.ts');
  const body = (id: string, time: number, project = 'game', script = 'boot()') =>
    Buffer.from(
      `var stamp = ${JSON.stringify({ docId: id, servedAt: time, project })};\n${script}`,
    );
  const a = sourceRecord('http://localhost/', 200, body('one', 1), 'document');
  const b = sourceRecord('http://localhost/', 200, body('two', 2), 'document');
  assert.notEqual(a.sha256, b.sha256);
  assert.equal(a.contentSha256, b.contentSha256);
  assert.notEqual(
    a.contentSha256,
    sourceRecord('http://localhost/', 200, body('one', 1, 'other'), 'document').contentSha256,
  );
  assert.notEqual(
    a.contentSha256,
    sourceRecord('http://localhost/', 200, body('one', 1, 'game', 'changed()'), 'document')
      .contentSha256,
  );
  assert.notEqual(
    a.contentSha256,
    sourceRecord('http://localhost/', 200, body('one', 1), 'script').contentSha256,
  );
});

test('cache keys source bytes rather than browser request classification', async () => {
  const { inputIdentity } = await import('../src/batch.ts');
  const source = {
    url: 'http://localhost/texture.jpg',
    status: 200,
    contentSha256: 'same',
    kind: 'xhr',
  };
  assert.deepEqual(
    inputIdentity({ sources: [source] }),
    inputIdentity({ sources: [{ ...source, kind: 'image' }] }),
  );
});
