import { sceneGeometry } from './scene-geometry.ts';
/** Pure engine observations; the probe owns only its WeakMap cache, never renderer state. */
export const SCENE_INSPECTOR = String.raw`(config) => {
  const started=performance.now(), timeline=config.timeline?(0,eval)('('+config.timeline+')'):null;
  const geometry = (${sceneGeometry.toString()})();
  const evaluate = expression => (0, eval)('(' + expression + ')');
  const options=config.options??{},profile=options.profile??'all', appearance=['all','appearance'].includes(profile),layout=['all','layout','appearance'].includes(profile);
  const nodes=[],cameras=[],bindingErrors=[],bindings=new Map(),selected=new Set(),ancestors=new Set();
  const requested=options.semanticIds?new Set(options.semanticIds):null;
  for(const b of config.bindings??[]) {
    if(requested&&!requested.has(b.id))continue;
    try{const o=evaluate(b.expression);if(!o||bindings.has(o))throw new Error('Target missing or already bound');bindings.set(o,b.id);selected.add(o);for(let p=o.parentContainer??o.parent;p;p=p.parentContainer??p.parent)ancestors.add(p);}
    catch(e){bindingErrors.push({id:b.id,error:String(e)});}
  }
  for(const id of requested??[])if(!(config.bindings??[]).some(b=>b.id===id))bindingErrors.push({id,error:'No configured binding'});
  const cacheKey=Symbol.for('helix.scene.geometry-cache.v2');
  let cache=globalThis[cacheKey];
  if(!cache||cache.revision!==options.geometryRevision)cache=globalThis[cacheKey]={revision:options.geometryRevision,boxes:new WeakMap()};
  const boxFor=o=>{
    const g=o.geometry,p=g?.attributes?.position;
    if(!g)return {box:null,reason:'no geometry'};
    if(o.isSkinnedMesh||o.isInstancedMesh||o.morphTargetInfluences?.some(v=>v!==0))return {box:null,reason:'unsupported deformation or instancing'};
    if(!p){const b=g.boundingBox;return {box:b?{min:b.min.toArray(),max:b.max.toArray()}:null,reason:'existing local AABB'};}
    if(p.isGLBufferAttribute||!Number.isInteger(p.count)||p.count<1||p.count>1000000||p.itemSize<3)return {box:null,reason:'unsupported or excessive vertex buffer'};
    const data=p.isInterleavedBufferAttribute?p.data:p,key={attribute:p,array:data.array,version:data.version,count:p.count,itemSize:p.itemSize,offset:p.offset,stride:data.stride,normalized:p.normalized};
    const old=cache.boxes.get(g);
    if(old&&Object.keys(key).every(k=>old[k]===key[k]))return {box:old.box,reason:'cached vertex local AABB'};
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<p.count;i++){
      const v=[p.getX(i),p.getY(i),p.getZ(i)];if(!v.every(Number.isFinite))return {box:null,reason:'nonfinite vertex'};
      for(let k=0;k<3;k++){min[k]=Math.min(min[k],v[k]);max[k]=Math.max(max[k],v[k]);}
    }
    const box={min,max};cache.boxes.set(g,{...key,box});return {box,reason:'read-only vertex local AABB'};
  };
  const materialCache=new Map();
  const material=m=>{
    if(materialCache.has(m))return materialCache.get(m);
    const r={name:m.name,type:m.type,uuid:m.uuid,color:m.color?[m.color.r,m.color.g,m.color.b]:null,emissive:m.emissive?[m.emissive.r,m.emissive.g,m.emissive.b]:null,opacity:m.opacity??null,roughness:m.roughness??null,metalness:m.metalness??null,transparent:m.transparent??null,side:m.side??null,
      textures:Object.entries(m).filter(([,t])=>t?.isTexture).map(([slot,t])=>({slot,name:t.name,uuid:t.uuid,source:t.source?.data?.currentSrc??t.source?.data?.src??null,colorSpace:t.colorSpace??null,offset:t.offset?.toArray()??null,repeat:t.repeat?.toArray()??null}))};materialCache.set(m,r);return r;
  };
  let total=0,visited=0;const limit=10000;
  const add=n=>{total++;if(nodes.length<limit)nodes.push(n);};
  const scope=(o,included)=>!requested||selected.has(o)||(options.includeDescendants&&included);
  if(config.phaser){
    const game=evaluate(config.phaser),canvas=game.canvas.getBoundingClientRect();
    for(const [si,scene] of game.scene.getScenes(true).entries()){
      const cam=scene.cameras.main,cameraId='phaser-camera/'+si;
      cameras.push({id:cameraId,engine:'phaser',raw:{name:cam.name,scroll:[cam.scrollX,cam.scrollY],zoom:[cam.zoomX??cam.zoom,cam.zoomY??cam.zoom],rotation:cam.rotation,viewport:{x:cam.x,y:cam.y,width:cam.width,height:cam.height}}});
      const visit=(o,id,parentId,parentVisible,parentMasked,depth,included)=>{
        visited++;const measured=scope(o,included);if(!measured&&!ancestors.has(o))return;
        if(depth>128||total>=limit){total++;return;}
        const visible=parentVisible&&o.visible!==false&&(o.alpha??1)>0,masked=parentMasked||!!o.mask;let bounds=null;
        if(measured&&o.getBounds&&scene.cameras.cameras.length===1&&!masked&&!cam.rotation&&!(o.cameraFilter&cam.id)){
          const r=o.getBounds();bounds=geometry.bounds([[r.x,r.y],[r.x+r.width,r.y],[r.x,r.y+r.height],[r.x+r.width,r.y+r.height]].map(([x,y])=>{
            const p=cam.matrix.transformPoint(x-cam.scrollX*(o.scrollFactorX??1),y-cam.scrollY*(o.scrollFactorY??1));return {x:canvas.x+p.x*canvas.width/game.scale.gameSize.width,y:canvas.y+p.y*canvas.height/game.scale.gameSize.height};}));
        }
        const raw=measured?{position:[o.x,o.y],scale:[o.scaleX,o.scaleY],rotation:o.rotation,origin:[o.originX??null,o.originY??null],depth:o.depth,alpha:o.alpha}:{};
        if(measured&&layout)Object.assign(raw,{texture:o.texture?.key??null,frame:o.frame?.name??null,text:typeof o.text==='string'?o.text:null,font:o.style?{family:o.style.fontFamily,size:o.style.fontSize,align:o.style.align,color:o.style.color,stroke:o.style.stroke,strokeThickness:o.style.strokeThickness}:null});
        if(measured&&appearance)Object.assign(raw,{tint:[o.tintTopLeft??null,o.tintTopRight??null,o.tintBottomLeft??null,o.tintBottomRight??null],blendMode:o.blendMode??null,mask:masked});
        add({id,parentId,semanticId:bindings.get(o)??null,engine:'phaser',name:o.name||o.type,type:o.type,visible,bounds,cameraId,structuralOnly:!measured,boundsKind:bounds?'projected-world-aabb-2d':null,boundsMethod:bounds?'main-camera projected world AABB; occlusion unresolved':'unmeasured: scope, camera, mask or bounds',raw});
        if(Array.isArray(o.list))o.list.forEach((child,i)=>visit(child,id+'/'+i,id,visible,masked,depth+1,measured));
      };scene.children.list.forEach((o,i)=>visit(o,'phaser/'+si+'/'+i,null,true,false,0,false));
    }
  }
  if(config.three){
    const root=evaluate(config.three.scene),camera=evaluate(config.three.camera),surface=config.three.surface?evaluate(config.three.surface):null;
    if(surface&&!geometry.surface(surface))throw new Error('Three surface must be an explicit axis-aligned final-output pixel rectangle');
    const view=camera.matrixWorldInverse.toArray(),projection=camera.projectionMatrix.toArray();
    cameras.push({id:'three-camera',engine:'three',surface,projectionConvention:'clip-minus-one-to-one',raw:{name:camera.name,type:camera.type,projection,view,world:camera.matrixWorld.toArray(),near:camera.near,far:camera.far}});
    const visit=(o,id,parentId,parentVisible,depth,included)=>{
      visited++;const measured=scope(o,included);if(!measured&&!ancestors.has(o))return;
      if(depth>128||total>=limit){total++;return;}const visible=parentVisible&&o.visible!==false,world=o.matrixWorld.toArray();
      const info=measured&&profile!=='layout'?boxFor(o):{box:null,reason:'scope/profile'},box=info.box;
      const bounds=geometry.bounds(geometry.corners(box).map(p=>geometry.project(geometry.transform(world,p),view,projection,surface)));
      const raw={uuid:o.uuid,world,...(measured?{position:o.position.toArray(),quaternion:o.quaternion.toArray(),scale:o.scale.toArray(),geometry:o.geometry?{name:o.geometry.name,uuid:o.geometry.uuid}:null}:{}),...(measured&&appearance?{materials:(Array.isArray(o.material)?o.material:[o.material]).filter(Boolean).map(material),light:o.isLight?{type:o.type,color:[o.color.r,o.color.g,o.color.b],intensity:o.intensity,castShadow:o.castShadow,distance:o.distance??null,decay:o.decay??null,angle:o.angle??null}:null}:{})};
      add({id,parentId,semanticId:bindings.get(o)??null,engine:'three',name:o.name,type:o.type,visible,cameraId:'three-camera',bounds,localBounds:box,projectionSupported:!!box,structuralOnly:!measured,boundsKind:bounds?'projected-local-aabb-3d':null,boundsMethod:bounds?info.reason+' projected through observed matrices':'unmeasured: '+info.reason+', surface or clip-plane crossing',raw});
      o.children.forEach((child,i)=>visit(child,id+'/'+i,id,visible,depth+1,measured));
    };visit(root,'three',null,true,0,false);
  }
  for(const [o,id]of bindings)if(!nodes.some(n=>n.semanticId===id)&&!bindingErrors.some(e=>e.id===id))bindingErrors.push({id,error:'Binding outside inspected roots'});
  return {schemaVersion:1,kind:'helix-scene',coordinateSpace:'viewport-top-left-pixels',viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,zoom:visualViewport?.scale??1},scope:{profile,semanticIds:options.semanticIds??null,includeDescendants:options.includeDescendants===true},
    timeline,pipeline:appearance&&config.three?.renderer?(()=>{const r=evaluate(config.three.renderer);return {engine:'three',outputColorSpace:r.outputColorSpace??null,toneMapping:r.toneMapping??null,toneMappingExposure:r.toneMappingExposure??null,shadows:r.shadowMap?.enabled??null};})():null,
    checkpoint:config.checkpoint??null,state:config.state?evaluate(config.state):null,observedAt:started,observationEnd:performance.now(),nodes,cameras,bindingErrors,truncated:total>nodes.length,totalNodes:total,visitedNodes:visited,
    conventions:{phaser:'2D y-down; radians',three:'engine-native; column-major matrices'},notes:['Geometry observations only; no occlusion or visual acceptance. Vertex-cache invalidation uses buffer identity/version/count and optional geometryRevision.']};
}`;
