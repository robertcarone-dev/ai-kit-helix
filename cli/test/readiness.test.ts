import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScenarioReadiness } from '../src/readiness.ts';

test('late readiness can recover the original scenario without replaying setup', async () => {
  const gate = new ScenarioReadiness();
  await assert.rejects(gate.check('gameplay-tin', async () => { throw new Error('timeout'); }));
  await assert.rejects(gate.recover(async () => { throw new Error('still not ready'); }));
  assert.equal(gate.pending, 'gameplay-tin');
  assert.equal(await gate.recover(async name => { assert.equal(name, 'gameplay-tin'); }), 'gameplay-tin');
  assert.equal(gate.pending, null);
  await assert.rejects(gate.recover(async () => {}), /No completed scenario/);
});

test('reset, manual input or incomplete setup cannot recover', async () => {
  const gate = new ScenarioReadiness();
  await assert.rejects(gate.recover(async () => {}), /No completed scenario/);
  await assert.rejects(gate.check('gameplay-tin', async () => { throw new Error('timeout'); }));
  gate.invalidate();
  await assert.rejects(gate.recover(async () => {}), /No completed scenario/);
});
