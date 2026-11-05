import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptValue } from '../src/receipt.ts';

test('browser receipt results preserve plain evidence and undefined', () => {
  const value = { scene: 'Lobby', frames: [1, 2], ready: true };
  assert.deepEqual(receiptValue(value), value);
  assert.equal(receiptValue(undefined), undefined);
});

test('circular runtime objects fail before contaminating failure receipts', () => {
  const scene: any = { sys: {} };
  scene.sys.scene = scene;
  const action: any = { status: 'running' };
  try {
    action.result = receiptValue(scene);
    assert.fail('circular scene accepted');
  } catch (error) {
    action.status = 'failed';
    assert.match(String(error), /non-JSON value.*setup may already have executed/);
  }
  assert.equal(JSON.parse(JSON.stringify({ actions: [action] })).actions[0].status, 'failed');
  assert.equal('result' in action, false);
  assert.throws(() => receiptValue(1n), /non-JSON value/);
});
