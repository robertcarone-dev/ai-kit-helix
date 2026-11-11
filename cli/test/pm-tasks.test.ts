import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { submitPmTask, taskReceipt } from '../src/pm-tasks.ts';
import type { TaskPlan } from '../src/pm-tasks.ts';
import { digest } from '../src/acceptance-format.ts';
function fixture(t: any, reply = '{"ok":true,"id":"message-1"}') {
  const root = mkdtempSync(join(tmpdir(), 'pm task ')); t.after(() => rmSync(root, { recursive: true, force: true })); mkdirSync(join(root, '.helix'));
  const executable = join(root, 'fake-cli.cjs');
  writeFileSync(executable, '#!' + process.execPath + '\nconst fs=require("node:fs");fs.appendFileSync("calls.jsonl",JSON.stringify(process.argv.slice(2))+"\\n");fs.writeFileSync("received.md",fs.readFileSync(process.argv[4].slice(1)));console.log(' + JSON.stringify(reply) + ');', { mode: 0o755 });
  writeFileSync(join(root, '.helix/aikit-pm.json'), JSON.stringify({ version: 1, executable }));
  const evidence = join(root, 'existing.png'); writeFileSync(evidence, 'original');
  const plan: TaskPlan = { key: 'a'.repeat(64), token: 'b'.repeat(64), title: 'Tooling task', body: 'Use existing evidence. Do not run Unity. Literal $(touch SHOULD_NOT_EXIST)', attachments: [{ path: 'existing.png', sha256: digest('original'), status: 'available', resolved: evidence }], specs: [], blocker: null, receipt: null };
  return { root, plan, evidence };
}
test('explicit PM submission uses argument arrays and existing attachments, retaining receipt and deduplicating repeated requests', async t => {
  const f = fixture(t); const result = await submitPmTask(f.root, f.plan, f.plan.token);
  assert.equal(result.status, 'sent'); assert.equal(result.messageId, 'message-1');
  const args = JSON.parse(readFileSync(join(f.root, 'calls.jsonl'), 'utf8')); assert.deepEqual(args.slice(0, 2), ['assistant', 'send']); assert.ok(args[2].startsWith('@'));
  assert.match(readFileSync(join(f.root, 'received.md'), 'utf8'), /Attached files: .*existing.png/);
  assert.match(readFileSync(join(f.root, 'received.md'), 'utf8'), /Literal \$\(touch/);
  assert.equal((await submitPmTask(f.root, f.plan, f.plan.token)).messageId, 'message-1');
  assert.equal(readFileSync(join(f.root, 'calls.jsonl'), 'utf8').trim().split('\n').length, 1);
});
test('stale preview and changed attachments cannot be sent', async t => {
  const f = fixture(t); await assert.rejects(submitPmTask(f.root, f.plan, 'stale'), /changed/);
  writeFileSync(f.evidence, 'changed'); await assert.rejects(submitPmTask(f.root, f.plan, f.plan.token), /Attachment changed/); assert.equal(taskReceipt(f.root, f.plan.key), null);
});
test('ambiguous CLI response stays uncertain and cannot silently retry', async t => {
  const f = fixture(t, 'not a receipt'); assert.equal((await submitPmTask(f.root, f.plan, f.plan.token)).status, 'uncertain');
  assert.equal((await submitPmTask(f.root, f.plan, f.plan.token)).status, 'uncertain'); assert.equal(readFileSync(join(f.root, 'calls.jsonl'), 'utf8').trim().split('\n').length, 1);
});

test('simultaneous clicks cannot create two PM messages', async t => {
  const f = fixture(t);
  const results = await Promise.allSettled([submitPmTask(f.root, f.plan, f.plan.token), submitPmTask(f.root, f.plan, f.plan.token)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(readFileSync(join(f.root, 'calls.jsonl'), 'utf8').trim().split('\n').length, 1);
});
