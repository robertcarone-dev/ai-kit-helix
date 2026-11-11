import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,symlinkSync,readlinkSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {run} from './install.mjs';
const withProject=fn=>{const root=mkdtempSync(join(tmpdir(),'helix-install-'));try{fn(root);}finally{rmSync(root,{recursive:true,force:true});}};
const call=(cmd,root,...args)=>run([cmd,'--project-root',root,...args]);
test('preview, repeated install, update and removal preserve project-owned files',()=>withProject(root=>{
 assert.ok(call('preview',root,'--init','--rules','all').changes.length>20);
 assert.equal(existsSync(join(root,'Tools')),false);
 call('install',root,'--init','--rules','all');
 const config=join(root,'Tools/Helix/reference.json');writeFileSync(config,'{"game":"owned"}');
 mkdirSync(join(root,'.aikit/rules'),{recursive:true});writeFileSync(join(root,'.aikit/rules/state.json'),'{}');
 assert.equal(call('install',root).changes.length,0);
 assert.equal(call('update',root).changes.length,0);
 assert.equal(readlinkSync(join(root,'.agents/skills/helix-reference')),'../../.claude/skills/helix-reference');
 call('remove',root);
 assert.equal(existsSync(join(root,'Tools/Helix/toolkit/src/cli.ts')),false);
 assert.equal(readFileSync(config,'utf8'),'{"game":"owned"}');
 assert.equal(readFileSync(join(root,'.aikit/rules/state.json'),'utf8'),'{}');
}));
test('conflicts abort all writes and removal refuses locally edited files',()=>withProject(root=>{
 call('install',root);
 const cli=join(root,'Tools/Helix/toolkit/src/cli.ts');writeFileSync(cli,'local work');
 const before=readFileSync(join(root,'Tools/Helix/toolkit-install.json'),'utf8');
 assert.throws(()=>call('update',root,'--rules','all'),/conflict/);
 assert.equal(readFileSync(join(root,'Tools/Helix/toolkit-install.json'),'utf8'),before);
 assert.equal(existsSync(join(root,'.aikit/rules/run-the-helix-reference.md')),false);
 assert.throws(()=>call('remove',root),/conflict/);
 assert.equal(readFileSync(cli,'utf8'),'local work');
}));
test('unmanaged collisions and parent symlinks are refused',()=>withProject(root=>{
 mkdirSync(join(root,'Tools/Helix/toolkit/src'),{recursive:true});writeFileSync(join(root,'Tools/Helix/toolkit/src/cli.ts'),'unmanaged');
 assert.throws(()=>call('install',root),/conflict/);
 rmSync(join(root,'Tools'),{recursive:true});
 const outside=mkdtempSync(join(tmpdir(),'helix-outside-'));
 try{symlinkSync(outside,join(root,'Tools'));assert.throws(()=>call('install',root),/real directory/);assert.equal(existsSync(join(outside,'Helix')),false);}finally{rmSync(outside,{recursive:true,force:true});}
}));
test('copy mode and separate projects have independent installed skills',()=>withProject(root=>{
 call('install',root,'--copy-skills','--init');
 const a=readFileSync(join(root,'.agents/skills/helix-reference/SKILL.md'),'utf8');
 assert.equal(a,readFileSync(join(root,'.claude/skills/helix-reference/SKILL.md'),'utf8'));
 assert.equal(call('update',root).changes.length,0);
 withProject(other=>{call('install',other,'--init');call('remove',other);assert.ok(existsSync(join(root,'Tools/Helix/toolkit/src/cli.ts')));});
}));
test('stale browser connection blocks runtime replacement',()=>withProject(root=>{
 mkdirSync(join(root,'.helix'));writeFileSync(join(root,'.helix/connection.json'),'{}');
 assert.throws(()=>call('install',root),/session may be active/);
 assert.equal(existsSync(join(root,'Tools/Helix/toolkit/src/cli.ts')),false);
}));
test('Unity helper is opt-in, requires declared JSON dependency and preserves conflicts',()=>withProject(root=>{
 const helper='Assets/HelixComparison/Editor/ComparisonSession.cs';
 call('install',root);
 assert.equal(existsSync(join(root,helper)),false);
 assert.throws(()=>call('update',root,'--unity-helper'),/newtonsoft-json/);
 mkdirSync(join(root,'Packages'));writeFileSync(join(root,'Packages/manifest.json'),JSON.stringify({dependencies:{'com.unity.nuget.newtonsoft-json':'3.2.2','com.unity.render-pipelines.universal':'17.0.0'}}));
 const preview=call('preview',root,'--unity-helper');
 assert.ok(preview.changes.some(c=>c.path===helper));
 assert.equal(existsSync(join(root,helper)),false);
 call('update',root,'--unity-helper');
 assert.equal(call('update',root).changes.length,0);
 mkdirSync(join(root,'Assets/ProjectFixtures'));writeFileSync(join(root,'Assets/ProjectFixtures/Adapter.cs'),'project owned');
 const original=readFileSync(join(root,helper));writeFileSync(join(root,helper),'local edit');
 assert.throws(()=>call('update',root),/conflict/);
 assert.throws(()=>call('remove',root),/conflict/);
 writeFileSync(join(root,helper),original);call('remove',root);
 assert.equal(existsSync(join(root,helper)),false);
 assert.equal(readFileSync(join(root,'Assets/ProjectFixtures/Adapter.cs'),'utf8'),'project owned');
}));

test('capture and delivery install/update/remove preserve game adapters',()=>withProject(root=>{
 call('install',root,'--init');
 const adapter=join(root,'Tools/Helix/workflow-adapter.json');
 writeFileSync(adapter,'{"capture":{"gameSpecific":true}}');
 for(const name of ['capture.py','delivery.py'])assert.ok(existsSync(join(root,'Tools/Helix/toolkit',name)));
 call('update',root);
 assert.equal(readFileSync(adapter,'utf8'),'{"capture":{"gameSpecific":true}}');
 writeFileSync(join(root,'Tools/Helix/toolkit/capture.py'),'local edits');
 assert.throws(()=>call('update',root),/conflict/);
 assert.throws(()=>call('remove',root),/conflict/);
}));


test('older snapshot gains workflows without changing project-owned config',()=>withProject(root=>{
 call('install',root,'--init');
 const mp=join(root,'Tools/Helix/toolkit-install.json');
 const manifest=JSON.parse(readFileSync(mp,'utf8'));
 for(const name of ['capture.py','delivery.py']) {
   const path=`Tools/Helix/toolkit/${name}`;rmSync(join(root,path));delete manifest.files[path];
 }
 manifest.version='1.1.0';writeFileSync(mp,JSON.stringify(manifest));
 const adapter=join(root,'Tools/Helix/workflow-adapter.json');writeFileSync(adapter,'{"owned":true}');
 const preview=call('preview',root);
 assert.ok(preview.changes.some(c=>c.path==='Tools/Helix/toolkit/capture.py'));
 assert.equal(existsSync(join(root,'Tools/Helix/toolkit/capture.py')),false);
 call('update',root);
 assert.equal(readFileSync(adapter,'utf8'),'{"owned":true}');
 call('remove',root);
 assert.equal(existsSync(join(root,'Tools/Helix/toolkit/capture.py')),false);
 assert.equal(existsSync(join(root,'Tools/Helix/toolkit/delivery.py')),false);
 assert.equal(readFileSync(adapter,'utf8'),'{"owned":true}');
}));

const workbenchDocs=['Workbench.md','EvidenceBaselines.md','RenderInspector.md','Objects.md','Dashboard.md'];
test('older snapshots gain Workbench modules and guides while preserving consumer content',()=>withProject(root=>{
 call('install',root,'--init');
 const mp=join(root,'Tools/Helix/toolkit-install.json');
 const manifest=JSON.parse(readFileSync(mp,'utf8'));
 for(const path of [...workbenchDocs.map(name=>'Tools/Helix/toolkit/'+name),'Tools/Helix/toolkit/src/workbench.ts']) {
  rmSync(join(root,path));delete manifest.files[path];
 }
 writeFileSync(mp,JSON.stringify(manifest));
 const recipe=join(root,'Tools/Helix/recipes/local.ts');mkdirSync(join(root,'Tools/Helix/recipes'));writeFileSync(recipe,'consumer recipe');
 const guide=join(root,'Tools/Helix/LocalReview.md');writeFileSync(guide,'consumer evidence and mappings');
 const config=join(root,'Tools/Helix/reference.json'),before=readFileSync(config,'utf8');
 const preview=call('preview',root);
 for(const name of workbenchDocs)assert.ok(preview.changes.some(c=>c.path==='Tools/Helix/toolkit/'+name));
 assert.equal(existsSync(join(root,'Tools/Helix/toolkit/Workbench.md')),false);
 call('update',root);
 const updated=JSON.parse(readFileSync(mp,'utf8'));
 for(const name of workbenchDocs) {
  const path='Tools/Helix/toolkit/'+name;assert.ok(updated.files[path]);assert.ok(existsSync(join(root,path)));
 }
 assert.equal(call('preview',root).changes.length,0);
 assert.equal(readFileSync(config,'utf8'),before);
 call('remove',root);
 for(const name of workbenchDocs)assert.equal(existsSync(join(root,'Tools/Helix/toolkit/'+name)),false);
 assert.equal(readFileSync(recipe,'utf8'),'consumer recipe');
 assert.equal(readFileSync(guide,'utf8'),'consumer evidence and mappings');
}));
test('a project-owned Workbench guide conflicts without changing it or writing runtime files',()=>withProject(root=>{
 mkdirSync(join(root,'Tools/Helix/toolkit'),{recursive:true});
 const guide=join(root,'Tools/Helix/toolkit/Workbench.md');writeFileSync(guide,'local recipes and pilot history');
 assert.ok(call('preview',root).conflicts.includes('Tools/Helix/toolkit/Workbench.md'));
 assert.throws(()=>call('install',root),/conflict/);
 assert.equal(readFileSync(guide,'utf8'),'local recipes and pilot history');
 assert.equal(existsSync(join(root,'Tools/Helix/toolkit/src/cli.ts')),false);
 assert.equal(existsSync(join(root,'Tools/Helix/toolkit-install.json')),false);
}));

test('explicit conflict preservation updates safe files without adopting local work',()=>withProject(root=>{
 call('install',root);
 const manifest=join(root,'Tools/Helix/toolkit-install.json');
 const original=JSON.parse(readFileSync(manifest,'utf8'));
 const conflict='Tools/Helix/toolkit/recording_sheet.py', missing='Tools/Helix/toolkit/workbench/GameCatalog.tsx';
 writeFileSync(join(root,conflict),'another owner');rmSync(join(root,missing));
 const preview=call('preview',root,'--preserve-conflicts');
 assert.deepEqual(preview.preservedConflicts,[conflict]);assert.ok(preview.changes.some(change=>change.path===missing));
 call('update',root,'--preserve-conflicts');
 assert.equal(readFileSync(join(root,conflict),'utf8'),'another owner');assert.ok(existsSync(join(root,missing)));
 const after=JSON.parse(readFileSync(manifest,'utf8'));assert.deepEqual(after.files[conflict],original.files[conflict]);assert.deepEqual(after.deferredConflicts,[conflict]);
 assert.throws(()=>call('update',root),/conflict/);assert.throws(()=>call('remove',root,'--preserve-conflicts'),/requires/);
 writeFileSync(join(root,conflict),readFileSync(new URL('../workflows/recording_sheet.py',import.meta.url)));
 call('update',root);assert.equal(JSON.parse(readFileSync(manifest,'utf8')).deferredConflicts,undefined);
}));

// Build a recorded 1.x installation from the current payload, then exercise the
// actual upgrade/removal contract without depending on an external checkout.
function legacyLayout(root) {
 call('install',root,'--init');
 const mp=join(root,'Tools/Helix/toolkit-install.json'), manifest=JSON.parse(readFileSync(mp,'utf8'));
 for(const path of Object.keys(manifest.files)) {
  if(!path.startsWith('Tools/Helix/toolkit/'))continue;
  if(path==='Tools/Helix/toolkit/bin/helix'){rmSync(join(root,path));delete manifest.files[path];continue;}
  const old=path.replace('Tools/Helix/toolkit/','Tools/Helix/');
  mkdirSync(join(root,old,'..'),{recursive:true});renameSync(join(root,path),join(root,old));
  manifest.files[old]=manifest.files[path];delete manifest.files[path];
 }
 const launcher=readFileSync(new URL('../cli/bin/helix',import.meta.url));
 writeFileSync(join(root,'Tools/Helix/bin/helix'),launcher);
 manifest.files['Tools/Helix/bin/helix']={type:'file',sha256:createHash('sha256').update(launcher).digest('hex')};
 delete manifest.layoutVersion;manifest.version='1.5.0';writeFileSync(mp,JSON.stringify(manifest));
}
test('layout upgrade preserves project records byte-for-byte and removes only recorded old payload',()=>withProject(root=>{
 legacyLayout(root);
 const records=['reference.local.json','acceptance/runs/original.json','evidence/original.bin','project-tests/local.ts','LocalGuide.md'];
 for(const path of records){const dest=join(root,'Tools/Helix',path);mkdirSync(join(dest,'..'),{recursive:true});writeFileSync(dest,'original '+path);}
 const preview=call('preview',root);assert.equal(preview.layoutVersion,2);assert.deepEqual(preview.conflicts,[]);
 assert.ok(preview.changes.some(c=>c.path==='Tools/Helix/src/cli.ts'&&c.action==='remove'));
 assert.ok(preview.changes.some(c=>c.path==='Tools/Helix/toolkit/src/cli.ts'&&c.action==='write'));
 call('update',root);assert.equal(call('preview',root).changes.length,0);
 assert.equal(existsSync(join(root,'Tools/Helix/src/cli.ts')),false);
 for(const path of records)assert.equal(readFileSync(join(root,'Tools/Helix',path),'utf8'),'original '+path);
 call('remove',root);
 for(const path of records)assert.equal(readFileSync(join(root,'Tools/Helix',path),'utf8'),'original '+path);
}));
test('layout migration refuses old local edits without installing a second runtime',()=>withProject(root=>{
 legacyLayout(root);writeFileSync(join(root,'Tools/Helix/recording_sheet.py'),'local enhancement');
 assert.throws(()=>call('update',root),/conflict/);
 assert.throws(()=>call('update',root,'--preserve-conflicts'),/reconciliation/);
 assert.equal(readFileSync(join(root,'Tools/Helix/recording_sheet.py'),'utf8'),'local enhancement');
 assert.equal(existsSync(join(root,'Tools/Helix/toolkit/src/cli.ts')),false);
}));

test('installed launcher and Python workflow run outside a checkout with spaces',()=>withProject(parent=>{
 const root=join(parent,'game with spaces');mkdirSync(root);call('install',root,'--init');
 // CLI imports Playwright/pngjs; use the locked dependency owner from this source checkout.
 symlinkSync(fileURLToPath(new URL('../node_modules',import.meta.url)),join(root,'Tools/Helix/toolkit/node_modules'),'dir');
 const result=execFileSync(join(root,'Tools/Helix/bin/helix'),['--help'],{cwd:tmpdir(),encoding:'utf8'});
 assert.match(result,/Helix/);
 const help=execFileSync('python3',['-B',join(root,'Tools/Helix/toolkit/workflow.py'),'--help'],{cwd:tmpdir(),encoding:'utf8'});
 assert.match(help,/recipe-plan/);
 const probe='import runpy,sys; from pathlib import Path; module=runpy.run_path(sys.argv[1]); assert module["ROOT"] == Path(sys.argv[2]).resolve(); assert module["CLI"].is_file()';
 execFileSync('python3',['-B','-c',probe,join(root,'Tools/Helix/toolkit/handoff-ui/serve.py'),root],{cwd:tmpdir()});
}));
