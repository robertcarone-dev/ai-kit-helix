import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,symlinkSync,readlinkSync} from 'node:fs';
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
 assert.equal(existsSync(join(root,'Tools/Helix/src/cli.ts')),false);
 assert.equal(readFileSync(config,'utf8'),'{"game":"owned"}');
 assert.equal(readFileSync(join(root,'.aikit/rules/state.json'),'utf8'),'{}');
}));
test('conflicts abort all writes and removal refuses locally edited files',()=>withProject(root=>{
 call('install',root);
 const cli=join(root,'Tools/Helix/src/cli.ts');writeFileSync(cli,'local work');
 const before=readFileSync(join(root,'Tools/Helix/toolkit-install.json'),'utf8');
 assert.throws(()=>call('update',root,'--rules','all'),/conflict/);
 assert.equal(readFileSync(join(root,'Tools/Helix/toolkit-install.json'),'utf8'),before);
 assert.equal(existsSync(join(root,'.aikit/rules/run-the-helix-reference.md')),false);
 assert.throws(()=>call('remove',root),/conflict/);
 assert.equal(readFileSync(cli,'utf8'),'local work');
}));
test('unmanaged collisions and parent symlinks are refused',()=>withProject(root=>{
 mkdirSync(join(root,'Tools/Helix/src'),{recursive:true});writeFileSync(join(root,'Tools/Helix/src/cli.ts'),'unmanaged');
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
 withProject(other=>{call('install',other,'--init');call('remove',other);assert.ok(existsSync(join(root,'Tools/Helix/src/cli.ts')));});
}));
test('stale browser connection blocks runtime replacement',()=>withProject(root=>{
 mkdirSync(join(root,'.helix'));writeFileSync(join(root,'.helix/connection.json'),'{}');
 assert.throws(()=>call('install',root),/session may be active/);
 assert.equal(existsSync(join(root,'Tools/Helix/src/cli.ts')),false);
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
 for(const name of ['capture.py','delivery.py'])assert.ok(existsSync(join(root,'Tools/Helix',name)));
 call('update',root);
 assert.equal(readFileSync(adapter,'utf8'),'{"capture":{"gameSpecific":true}}');
 writeFileSync(join(root,'Tools/Helix/capture.py'),'local edits');
 assert.throws(()=>call('update',root),/conflict/);
 assert.throws(()=>call('remove',root),/conflict/);
}));


test('older snapshot gains workflows without changing project-owned config',()=>withProject(root=>{
 call('install',root,'--init');
 const mp=join(root,'Tools/Helix/toolkit-install.json');
 const manifest=JSON.parse(readFileSync(mp,'utf8'));
 for(const name of ['capture.py','delivery.py']) {
   const path=`Tools/Helix/${name}`;rmSync(join(root,path));delete manifest.files[path];
 }
 manifest.version='1.1.0';writeFileSync(mp,JSON.stringify(manifest));
 const adapter=join(root,'Tools/Helix/workflow-adapter.json');writeFileSync(adapter,'{"owned":true}');
 const preview=call('preview',root);
 assert.ok(preview.changes.some(c=>c.path==='Tools/Helix/capture.py'));
 assert.equal(existsSync(join(root,'Tools/Helix/capture.py')),false);
 call('update',root);
 assert.equal(readFileSync(adapter,'utf8'),'{"owned":true}');
 call('remove',root);
 assert.equal(existsSync(join(root,'Tools/Helix/capture.py')),false);
 assert.equal(existsSync(join(root,'Tools/Helix/delivery.py')),false);
 assert.equal(readFileSync(adapter,'utf8'),'{"owned":true}');
}));

const workbenchDocs=['Workbench.md','EvidenceBaselines.md','RenderInspector.md','Objects.md','Dashboard.md'];
test('older snapshots gain Workbench modules and guides while preserving consumer content',()=>withProject(root=>{
 call('install',root,'--init');
 const mp=join(root,'Tools/Helix/toolkit-install.json');
 const manifest=JSON.parse(readFileSync(mp,'utf8'));
 for(const path of [...workbenchDocs.map(name=>'Tools/Helix/'+name),'Tools/Helix/src/workbench.ts']) {
  rmSync(join(root,path));delete manifest.files[path];
 }
 writeFileSync(mp,JSON.stringify(manifest));
 const recipe=join(root,'Tools/Helix/recipes/local.ts');mkdirSync(join(root,'Tools/Helix/recipes'));writeFileSync(recipe,'consumer recipe');
 const guide=join(root,'Tools/Helix/LocalReview.md');writeFileSync(guide,'consumer evidence and mappings');
 const config=join(root,'Tools/Helix/reference.json'),before=readFileSync(config,'utf8');
 const preview=call('preview',root);
 for(const name of workbenchDocs)assert.ok(preview.changes.some(c=>c.path==='Tools/Helix/'+name));
 assert.equal(existsSync(join(root,'Tools/Helix/Workbench.md')),false);
 call('update',root);
 const updated=JSON.parse(readFileSync(mp,'utf8'));
 for(const name of workbenchDocs) {
  const path='Tools/Helix/'+name;assert.ok(updated.files[path]);assert.ok(existsSync(join(root,path)));
 }
 assert.equal(call('preview',root).changes.length,0);
 assert.equal(readFileSync(config,'utf8'),before);
 call('remove',root);
 for(const name of workbenchDocs)assert.equal(existsSync(join(root,'Tools/Helix/'+name)),false);
 assert.equal(readFileSync(recipe,'utf8'),'consumer recipe');
 assert.equal(readFileSync(guide,'utf8'),'consumer evidence and mappings');
}));
test('a project-owned Workbench guide conflicts without changing it or writing runtime files',()=>withProject(root=>{
 mkdirSync(join(root,'Tools/Helix'),{recursive:true});
 const guide=join(root,'Tools/Helix/Workbench.md');writeFileSync(guide,'local recipes and pilot history');
 assert.ok(call('preview',root).conflicts.includes('Tools/Helix/Workbench.md'));
 assert.throws(()=>call('install',root),/conflict/);
 assert.equal(readFileSync(guide,'utf8'),'local recipes and pilot history');
 assert.equal(existsSync(join(root,'Tools/Helix/src/cli.ts')),false);
 assert.equal(existsSync(join(root,'Tools/Helix/toolkit-install.json')),false);
}));
