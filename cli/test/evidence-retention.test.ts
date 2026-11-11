import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { compactEvidence, recoverEvidence, retainRunArtifacts } from '../src/evidence-retention.ts';
import { digest } from '../src/acceptance-format.ts';
test('generated reports compact only after verified recovery; pinned files and concurrent changes survive', t => {
 const root=mkdtempSync(join(tmpdir(),'retention-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const batch='Tools/Helix/evidence/verification/batch';mkdirSync(join(root,batch),{recursive:true});
 const put=(path:string,content:string)=>{mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),content);};
 put(batch+'/review.html','generated report');put(batch+'/pinned.html','pinned report');put(batch+'/image.png','native image');
 put('Tools/Helix/acceptance/runs/record.json',JSON.stringify({artifacts:[{path:batch+'/pinned.html'}]}));
 const git=(...args:string[])=>execFileSync('git',['-C',root,...args]);git('init','-q');git('add','.');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','retain evidence');
 assert.equal(compactEvidence(root,batch,false).files,1);assert.ok(existsSync(join(root,batch+'/review.html')));
 put(batch+'/review.html','concurrent');assert.throws(()=>compactEvidence(root,batch,true),/concurrent/);put(batch+'/review.html','generated report');
 const result=compactEvidence(root,batch,true);assert.equal(result.files,1);assert.ok(!existsSync(join(root,batch+'/review.html')));assert.ok(existsSync(join(root,batch+'/pinned.html')));assert.ok(existsSync(join(root,batch+'/image.png')));
 recoverEvidence(root,batch+'/review.html','restored.html');assert.equal(readFileSync(join(root,'restored.html'),'utf8'),'generated report');assert.throws(()=>recoverEvidence(root,batch+'/review.html','restored.html'),/EEXIST/);
 assert.throws(()=>compactEvidence(root,'Assets',true),/evidence batch/);
});
test('run retention copies declared artifacts without diagnostic trees and rejects changed bytes', t => {
 const root=mkdtempSync(join(tmpdir(),'retain-run-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'scratch/capture'),{recursive:true});writeFileSync(join(root,'scratch/capture/image.png'),'image');writeFileSync(join(root,'scratch/capture/review.html'),'large duplicate');
 const artifacts=[{path:'scratch/capture/image.png',sha256:digest('image'),recovery:'scratch'}];
 retainRunArtifacts(root,root,join(root,'scratch'),'Tools/Helix/evidence/run',artifacts);
 assert.equal(artifacts[0].path,'Tools/Helix/evidence/run/capture/image.png');assert.ok(!existsSync(join(root,'Tools/Helix/evidence/run/capture/review.html')));
 assert.throws(()=>retainRunArtifacts(root,root,join(root,'scratch'),'Tools/Helix/evidence/other',[{path:'scratch/capture/image.png',sha256:digest('changed'),recovery:'scratch'}]),/changed/);
});
