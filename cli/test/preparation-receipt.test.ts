import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitForPreparationReceipt } from '../src/ui-runner.ts';
test('preparation waits for an atomic receipt and fails explicit preparation errors', async () => {
  const root = mkdtempSync(join(tmpdir(), 'helix-reload-'));
  try {
    const path = join(root, 'prepared.json'), barrier = { path, timeoutMs: 1000, expected: { prepared: true } };
    const timer = setTimeout(() => { writeFileSync(path + '.tmp', '{"prepared":true}'); renameSync(path + '.tmp', path); }, 20);
    const result = await waitForPreparationReceipt(barrier, root, () => false); clearTimeout(timer);
    assert.equal(result.receipt.prepared, true);
    await assert.rejects(waitForPreparationReceipt(barrier, root, () => true), /Interrupted/);
    writeFileSync(path, '{"prepared":false,"error":"fixture failed"}');
    await assert.rejects(waitForPreparationReceipt(barrier, root, () => false), /fixture failed/);
    rmSync(path);
    await assert.rejects(waitForPreparationReceipt({ ...barrier, timeoutMs: 1 }, root, () => false), /timeout/);
    await assert.rejects(waitForPreparationReceipt(barrier, root, () => true), /Interrupted/);
  } finally { rmSync(root, { recursive: true }); }
});
