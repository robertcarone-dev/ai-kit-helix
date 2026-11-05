import {test} from 'node:test';
import assert from 'node:assert/strict';
import {realpathSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {projectRoot,localUrl,validateStep} from '../src/config.ts';
import {PNG} from 'pngjs';
import {compare} from '../src/compare.ts';
const cli=fileURLToPath(new URL('../src/cli.ts',import.meta.url));
function fixture(root,name) {
 const dir=join(root,name);mkdirSync(join(dir,'Tools/Helix'),{recursive:true});mkdirSync(join(dir,'nested'));
 writeFileSync(join(dir,'setup.js'),'({prepared:true})');
 writeFileSync(join(dir,'Tools/Helix/reference.json'),JSON.stringify({helix:{project:name,variant:'Default'},ready:'true',viewports:{small:{width:320,height:640}},scenarios:{example:{steps:[{kind:'script',purpose:'fixture',file:'setup.js'}],ready:'true',unity:{capture:[['capture','{{capture}}']]}}}}));
 return dir;
}
test('external CLI selects each project from nested cwd or explicit root',()=>{
 const temp=realpathSync(mkdtempSync(join(tmpdir(),'helix-context-')));
 try {
  const a=fixture(temp,'alpha'),b=fixture(temp,'beta');
  assert.equal(projectRoot([],join(a,'nested')),a);
  assert.equal(projectRoot(['--project-root',b],a),b);
  assert.throws(()=>projectRoot(['--project-root',temp],a),/reference.json/);
  assert.throws(()=>projectRoot(['--project-root',a,'--project-root',b]),/once/);
  for(const [cwd,root,args] of [[join(a,'nested'),a,[]],[a,b,['--project-root',b]]] as any[]) {
   const plan=JSON.parse(execFileSync(process.execPath,[cli,'unity-plan','example','--viewport','small','--out','.aikit/scratch/check',...args],{cwd,encoding:'utf8'}));
   assert.equal(plan.out,join(root,'.aikit/scratch/check'));
   assert.equal(plan.reference.project,root===a?'alpha':'beta');
  }
  mkdirSync(join(a,'.helix'));
  writeFileSync(join(a,'.helix/connection.json'),JSON.stringify({projectRoot:b,port:1,token:'unreachable'}));
  const wrongOwner=spawnSync(process.execPath,[cli,'stop','--project-root',a],{encoding:'utf8'});
  assert.notEqual(wrongOwner.status,0);assert.match(wrongOwner.stderr,/another checkout/);
  const rejected=spawnSync(process.execPath,[cli,'unity-plan','example','--project-root',a,'--out',join(b,'.aikit/scratch/no')],{encoding:'utf8'});
  assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/inside this checkout/);
  const absent=spawnSync(process.execPath,[cli,'resolve'],{cwd:temp,encoding:'utf8'});
  assert.notEqual(absent.status,0);assert.match(absent.stderr,/No project adapter/);
  // Script realpath containment is checked even when a symlink appears local.
  rmSync(join(a,'setup.js'));symlinkSync(join(b,'setup.js'),join(a,'setup.js'));
  const escaped=spawnSync(process.execPath,[cli,'unity-plan','example','--project-root',a,'--out','.aikit/scratch/x'],{encoding:'utf8'});
  assert.notEqual(escaped.status,0);assert.match(escaped.stderr,/inside this checkout/);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
test('URL/input boundaries and native image comparison remain enforced',()=>{
 assert.throws(()=>localUrl('https://example.com'));
 assert.throws(()=>validateStep({kind:'script',expression:'1'}));
 const temp=mkdtempSync(join(tmpdir(),'helix-images-'));
 try{
  const p=join(temp,'a.png'),q=join(temp,'b.png');writeFileSync(p,PNG.sync.write(new PNG({width:2,height:2})));writeFileSync(q,PNG.sync.write(new PNG({width:2,height:2})));
  assert.equal(compare(p,q,join(temp,'out')).verdict,null);
  assert.throws(()=>compare(p,q,join(temp,'out')),/empty/);
  writeFileSync(q,PNG.sync.write(new PNG({width:3,height:2})));
  assert.throws(()=>compare(p,q,join(temp,'other')),/dimensions/);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
