import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { emptyOutput, sha } from './config.ts';
import { loadSnapshot } from './ui.ts';
import { compareScenes, validateScene } from './scene.ts';
export function sceneReceipt(file: string) {
  const input = loadSnapshot(file),
    scene = validateScene(input.receipt.scene);
  if (
    input.ui.coordinateSpace !== 'native-top-left-pixels' ||
    input.ui.viewport?.dpr !== 1 ||
    input.ui.viewport?.zoom !== 1 ||
    input.ui.truncated === true
  )
    throw new Error('Scene review requires complete native UI observations');
  if (
    scene.viewport.width !== input.png.width ||
    scene.viewport.height !== input.png.height ||
    !isDeepStrictEqual(scene.state, input.ui.state) ||
    scene.checkpoint !== input.ui.checkpoint
  )
    throw new Error('Scene/image/UI receipt dimensions, state or checkpoint disagree');
  return { ...input, scene };
}
export function sceneReview(
  referenceFile: string,
  candidateFile: string,
  specFile: string,
  output: string,
) {
  const a = sceneReceipt(referenceFile),
    b = sceneReceipt(candidateFile),
    spec = JSON.parse(readFileSync(specFile, 'utf8'));
  const report = {
    ...compareScenes(a.scene, b.scene, spec),
    inputs: [referenceFile, candidateFile, specFile].map((path) => ({
      path,
      sha256: sha(readFileSync(path)),
    })),
  };
  const payload = JSON.stringify({
    report,
    reference: { scene: a.scene, image: a.bytes.toString('base64') },
    candidate: { scene: b.scene, image: b.bytes.toString('base64') },
  }).replace(/</g, '\\u003c');
  const out = emptyOutput(output);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(
    join(out, 'review.html'),
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Scene comparison</title>
 <style>body{font:15px system-ui;background:#15191f;color:#eee;margin:24px}button,select{padding:8px;margin:4px}main{display:flex;gap:16px}section{width:50%;min-width:0}canvas{max-width:100%;background:#252b35}pre{white-space:pre-wrap;overflow-wrap:anywhere}label{margin:12px}h1{font-size:24px}</style>
 <h1>Scene comparison · diagnostic only</h1><p>Bounds are geometric. Inspect pixels, clipping and appearance before accepting visual parity.</p>
 <select id="mapping"><option value="">All mapped elements</option></select><label><input id="crop" type="checkbox">Crop to selected element</label><label><input id="overlay" type="checkbox" checked>Bounds</label>
 <main><section><h2>Reference</h2><canvas id="reference"></canvas></section><section><h2>Unity candidate</h2><canvas id="candidate"></canvas></section></main>
 <h2>Selected measurement</h2><pre id="selected"></pre><details open><summary>Relationships, style roles and appearance</summary><pre id="properties"></pre></details><details><summary>Landmarks and camera geometry</summary><pre id="geometry"></pre></details><details><summary>Capture provenance</summary><pre id="provenance"></pre></details>
 <script type="application/json" id="data">${payload}</script><script>
 const d=JSON.parse(document.getElementById('data').textContent),select=document.getElementById('mapping'),imgs={};
 for(const [i,m]of d.report.mappings.entries()){const o=document.createElement('option');o.value=String(i);o.textContent=m.id+' · '+m.status;select.append(o);}
 const show=(id,v)=>document.getElementById(id).textContent=JSON.stringify(v,null,2);
 show('properties',{prerequisites:d.report.prerequisites,state:d.report.state,relationships:d.report.relationships,styles:d.report.styles,appearance:d.report.appearance});show('geometry',d.report.geometry);show('provenance',d.report.inputs);
 function draw(){const chosen=select.value===''?null:d.report.mappings[Number(select.value)];show('selected',chosen??d.report.mappings);
 for(const side of ['reference','candidate']){const canvas=document.getElementById(side),ctx=canvas.getContext('2d'),v=d[side].scene.viewport,b=chosen?.[side]?.bounds;
 let r={x:0,y:0,width:v.width,height:v.height};if(document.getElementById('crop').checked&&b){const x=Math.max(0,b.x-16),y=Math.max(0,b.y-16);r={x,y,width:Math.max(1,Math.min(v.width,b.x+b.width+16)-x),height:Math.max(1,Math.min(v.height,b.y+b.height+16)-y)};}
 canvas.width=Math.ceil(r.width);canvas.height=Math.ceil(r.height);ctx.drawImage(imgs[side],r.x,r.y,r.width,r.height,0,0,r.width,r.height);
 if(document.getElementById('overlay').checked)for(const m of chosen?[chosen]:d.report.mappings){const box=m[side]?.bounds;if(!box)continue;ctx.strokeStyle=m.status==='different'?'#ff5270':'#1ee4cd';ctx.lineWidth=2;ctx.strokeRect(box.x-r.x,box.y-r.y,box.width,box.height);ctx.fillStyle=ctx.strokeStyle;ctx.font='14px sans-serif';ctx.fillText(m.id,box.x-r.x+3,box.y-r.y+15);}
 }}
 Promise.all(['reference','candidate'].map(side=>new Promise(resolve=>{const img=new Image();imgs[side]=img;img.onload=resolve;img.src='data:image/png;base64,'+d[side].image;}))).then(draw);
 for(const id of ['mapping','crop','overlay'])document.getElementById(id).onchange=draw;
 </script>`,
  );
  return { out, viewer: join(out, 'review.html'), report };
}
