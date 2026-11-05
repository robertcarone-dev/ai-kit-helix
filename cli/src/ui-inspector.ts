/** Serializable runtime evidence. Unknown renderer properties remain null. */
export const UI_INSPECTOR=String.raw`(config) => {
 const nodes=[];let total=0;const limit=10000;
 const add=n=>{total++;if(nodes.length<limit)nodes.push(n);};
 const bounds=r=>({x:r.x,y:r.y,width:r.width,height:r.height});
 const evaluate=e=>(0,eval)('('+e+')');
 const bindings=new Map();const bindingErrors=[];for(const binding of config.bindings??[]){try{const target=evaluate(binding.expression);if(!target)bindingErrors.push({id:binding.id,error:'Target unavailable'});else if(bindings.has(target))bindingErrors.push({id:binding.id,error:'Object already bound'});else bindings.set(target,binding.id);}catch(e){bindingErrors.push({id:binding.id,error:String(e)});}}
 const safe=document.createElement('div');safe.style.cssText='position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';document.body.appendChild(safe);const css=getComputedStyle(safe),insets=['Left','Top','Right','Bottom'].map(s=>parseFloat(css['padding'+s])||0);safe.remove();
 const safeArea={x:insets[0],y:insets[1],width:innerWidth-insets[0]-insets[2],height:innerHeight-insets[1]-insets[3]};
 if(config.phaser){const game=evaluate(config.phaser),canvas=game.canvas.getBoundingClientRect();
 for(const scene of game.scene.getScenes(true)){const cam=scene.cameras.main;
 const visit=(o,path,parentVisible=true,parentMasked=false)=>{
 const masked=parentMasked||!!o.mask;
 const visible=parentVisible&&o.visible!==false&&(o.alpha??1)>0;
 const project=(x,y)=>{const p=cam.matrix.transformPoint(x-cam.scrollX*(o.scrollFactorX??1),y-cam.scrollY*(o.scrollFactorY??1));return {x:canvas.x+p.x*canvas.width/game.scale.gameSize.width,y:canvas.y+p.y*canvas.height/game.scale.gameSize.height};};
 let b=null;if(o.getBounds){const r=o.getBounds(),ps=[[r.x,r.y],[r.x+r.width,r.y],[r.x,r.y+r.height],[r.x+r.width,r.y+r.height]].map(([x,y])=>project(x,y));const xs=ps.map(p=>p.x),ys=ps.map(p=>p.y);b={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};}
 const style=o.style,frame=o.frame;
 const text=typeof o.text==='string'?{value:o.text,renderer:o.type,family:style?.fontFamily??null,fontSize:style?.fontSize??null,fontStyle:style?.fontStyle??null,color:style?.color??null,stroke:style?.stroke??null,strokeThickness:style?.strokeThickness??null,align:style?.align??null,lineSpacing:o.lineSpacing??null,letterSpacing:o.letterSpacing??null,padding:o.padding?{left:o.padding.left,right:o.padding.right,top:o.padding.top,bottom:o.padding.bottom}:null,lines:o.getWrappedText?o.getWrappedText(o.text):null,lineCount:o.getWrappedText?o.getWrappedText(o.text).length:null,baseline:null,fontAsset:null,actualFallback:null,fontReady:style?.fontFamily?document.fonts.check((parseFloat(style.fontSize)||16)+'px '+style.fontFamily):null}:null;
 if(text&&o.type==='Text'&&style?.metrics&&o.getWorldTransformMatrix){
  if(style.maxLines>0&&text.lines)text.lines=text.lines.slice(0,style.maxLines);text.lineCount=text.lines?.length??null;
  const matrix=o.getWorldTransformMatrix();text.baselines=(text.lines??[]).map((_,i)=>{let y=style.strokeThickness/2+style.metrics.ascent+i*(style.metrics.fontSize+style.strokeThickness+(o.lineSpacing??0));if(o.autoRound)y=Math.round(y);const world=matrix.transformPoint(-o.displayOriginX,(o.padding?.top??0)+y-o.displayOriginY);return project(world.x,world.y).y;});
  text.baseline=text.baselines[0]??null;text.baselineMethod='Phaser Text metrics + stroke/padding + world and main-camera transforms';
 }
 const sprite=frame?{texture:o.texture?.key??null,frame:frame.name,source:frame.source?.image?.currentSrc??frame.source?.image?.src??null,sourceRect:{x:frame.cutX,y:frame.cutY,width:frame.cutWidth,height:frame.cutHeight},originalSize:{width:frame.realWidth,height:frame.realHeight},trimmed:frame.trimmed??false,trim:frame.data?.spriteSourceSize??null,borders:o.leftWidth!==undefined?{left:o.leftWidth,right:o.rightWidth,top:o.topHeight,bottom:o.bottomHeight}:null}:null;
 add({semanticId:bindings.get(o)??null,kind:'phaser',scene:scene.sys.settings.key,path,name:o.name||o.type,type:o.type,visible,bounds:b,text,sprite,layout:{originX:o.originX??null,originY:o.originY??null,scaleX:o.scaleX,scaleY:o.scaleY,rotation:o.rotation,depth:o.depth},clipping:{hasMask:masked,visibleBounds:null,occluded:null},input:{enabled:!!o.input?.enabled,hitArea:o.input?.hitArea?{type:o.input.hitArea.constructor?.name??null,x:o.input.hitArea.x??null,y:o.input.hitArea.y??null,width:o.input.hitArea.width??null,height:o.input.hitArea.height??null,radius:o.input.hitArea.radius??null}:null,hitAreaSpace:'object-local',topmostAtCenter:null},boundsMethod:'main-camera world-AABB projection; masks and occlusion unresolved'});
 if(Array.isArray(o.list))o.list.forEach(child=>visit(child,path+'/'+(child.name||child.type),visible,masked));};
 scene.children.list.forEach(o=>visit(o,scene.sys.settings.key+'/'+(o.name||o.type)));
 }}
 for(const o of document.querySelectorAll('[data-helix-id],button,input,[role=button]')) {const r=o.getBoundingClientRect(),s=getComputedStyle(o),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);add({semanticId:bindings.get(o)??o.getAttribute('data-helix-id')??null,kind:'dom',name:o.getAttribute('data-helix-id')||o.id||o.getAttribute('aria-label')||o.tagName,path:o.id?'#'+o.id:null,type:o.tagName,bounds:bounds(r),visible:r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0,text:{value:o.textContent??'',family:s.fontFamily,fontSize:s.fontSize,actualFallback:null,baseline:null},input:{enabled:!o.disabled,topmostAtCenter:!!top&&(top===o||o.contains(top))},clipping:{visibleBounds:null,occluded:null}});}
 const custom=config.uiProbe?evaluate(config.uiProbe):null;
 if(custom?.nodes){for(const n of custom.nodes)add(n);}
 return {schemaVersion:1,coordinateSpace:'native-top-left-pixels',viewport:{width:innerWidth,height:innerHeight},safeArea,state:config.state?evaluate(config.state):null,checkpoint:config.checkpoint??null,nodes,bindingErrors,totalNodes:total,truncated:total>nodes.length,observedAt:performance.now(),custom:custom?.evidence??null,notes:['Phaser geometry is a main-camera approximation. No mask, secondary camera or occlusion acceptance is implied.','fontReady tests availability of a configured family, not the actual glyph fallback.','Snapshots precede PNG capture; use settled checkpoints for geometry.']};
}`;
