import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PNG } from 'pngjs';
import { emptyOutput, sha } from './config.ts';
export function compare(referencePath:string,candidatePath:string,output:string) {
  const rb=readFileSync(referencePath), cb=readFileSync(candidatePath);
  const r=PNG.sync.read(rb),c=PNG.sync.read(cb);
  if(r.width!==c.width||r.height!==c.height) throw new Error('Native dimensions differ; recapture at matching dimensions. Images are never resized.');
  const side=new PNG({width:r.width*2,height:r.height}),diff=new PNG({width:r.width,height:r.height});
  PNG.bitblt(r,side,0,0,r.width,r.height,0,0);PNG.bitblt(c,side,0,0,c.width,c.height,r.width,0);
  let changed=0;
  for(let i=0;i<r.data.length;i+=4){let delta=0;for(let j=0;j<4;j++)delta=Math.max(delta,Math.abs(r.data[i+j]-c.data[i+j]));if(delta)changed++;
    diff.data[i]=delta;diff.data[i+1]=0;diff.data[i+2]=0;diff.data[i+3]=255;}
  const out=emptyOutput(output);
  writeFileSync(join(out,'side-by-side.png'),PNG.sync.write(side));writeFileSync(join(out,'diff.png'),PNG.sync.write(diff));
  const result={schemaVersion:1,reference:{path:resolve(referencePath),sha256:sha(rb)},candidate:{path:resolve(candidatePath),sha256:sha(cb)},width:r.width,height:r.height,changedPixels:changed,changedFraction:changed/(r.width*r.height),verdict:null,notes:['Exact pixel differences are diagnostic, not visual acceptance.','Matching dimensions alone do not establish matching scenario, revision, timing or native rendering.'],out};
  writeFileSync(join(out,'comparison.json'),JSON.stringify(result,null,2));
  writeFileSync(join(out,'review.html'),'<!doctype html><meta charset="utf-8"><title>Helix comparison</title><style>body{background:#222;color:white;font:16px sans-serif}img{max-width:100%;height:auto}</style><h1>Reference / Unity candidate</h1><p>Review state, provenance and motion separately. No automatic acceptance verdict.</p><img src="side-by-side.png"><h2>Exact pixel difference</h2><img src="diff.png">');
  return result;
}
