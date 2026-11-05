import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {run} from './install.mjs';
test('camera utility is managed while game behavior and tests survive update and removal', () => {
 const root=mkdtempSync(join(tmpdir(),'helix-camera-install-'));
 const call=command=>run([command,'--project-root',root]);
 try {
  call('install');
  const helper=join(root,'Tools/Helix/src/browser/three-camera.js');
  assert.ok(existsSync(helper));
  const project=join(root,'Tools/Helix/project-tests');
  mkdirSync(project,{recursive:true});writeFileSync(join(project,'game.test.ts'),'project-owned');
  const original=readFileSync(helper);writeFileSync(helper,'local edit');
  assert.throws(()=>call('update'),/conflict/);
  writeFileSync(helper,original);call('update');call('remove');
  assert.equal(existsSync(helper),false);
  assert.equal(readFileSync(join(project,'game.test.ts'),'utf8'),'project-owned');
 } finally {rmSync(root,{recursive:true,force:true});}
});
