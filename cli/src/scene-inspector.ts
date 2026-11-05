import { sceneGeometry } from './scene-geometry.ts';
/** Read-only scene inventory. No rendering, layout, camera or animation updates are invoked. */
export const SCENE_INSPECTOR = String.raw`(config) => {
  const geometry = (${sceneGeometry.toString()})();
  const evaluate = expression => (0, eval)('(' + expression + ')');
  const nodes = [], cameras = [], bindingErrors = [], bindings = new Map();
  const material = m => ({name:m.name,type:m.type,uuid:m.uuid,color:m.color?[m.color.r,m.color.g,m.color.b]:null,emissive:m.emissive?[m.emissive.r,m.emissive.g,m.emissive.b]:null,opacity:m.opacity??null,roughness:m.roughness??null,metalness:m.metalness??null,transparent:m.transparent??null,side:m.side??null,
    textures:Object.entries(m).filter(([,t])=>t?.isTexture).map(([slot,t])=>({slot,name:t.name,uuid:t.uuid,source:t.source?.data?.currentSrc??t.source?.data?.src??null,colorSpace:t.colorSpace??null,offset:t.offset?.toArray()??null,repeat:t.repeat?.toArray()??null}))});
  const limit = 10000;
  let total = 0;
  for (const b of config.bindings ?? []) {
    try {
      const o = evaluate(b.expression);
      if (!o || bindings.has(o)) throw new Error('Target missing or already bound');
      bindings.set(o, b.id);
    } catch(e) { bindingErrors.push({id:b.id,error:String(e)}); }
  }
  const add = n => { total++; if(nodes.length < limit) nodes.push(n); };
  const rect = points => {
    if(!points.length || points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))) return null;
    const xs=points.map(p=>p.x), ys=points.map(p=>p.y);
    return {x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
  };
  if(config.phaser) {
    const game=evaluate(config.phaser), canvas=game.canvas.getBoundingClientRect();
    for(const [si,scene] of game.scene.getScenes(true).entries()) {
      const cam=scene.cameras.main, cameraId='phaser-camera/'+si;
      cameras.push({id:cameraId,engine:'phaser',raw:{name:cam.name,scroll:[cam.scrollX,cam.scrollY],zoom:[cam.zoomX??cam.zoom,cam.zoomY??cam.zoom],rotation:cam.rotation,viewport:{x:cam.x,y:cam.y,width:cam.width,height:cam.height}}});
      const visit=(o,id,parentId,parentVisible,parentMasked,depth)=>{
        if(depth>128 || total>=limit) {total++; return;}
        const visible=parentVisible&&o.visible!==false&&(o.alpha??1)>0;
        const masked=parentMasked||!!o.mask;
        let bounds=null;
        if(o.getBounds && scene.cameras.cameras.length===1 && !masked && !cam.rotation && !(o.cameraFilter & cam.id)) {
          const r=o.getBounds();
          bounds=rect([[r.x,r.y],[r.x+r.width,r.y],[r.x,r.y+r.height],[r.x+r.width,r.y+r.height]].map(([x,y])=>{
            const p=cam.matrix.transformPoint(x-cam.scrollX*(o.scrollFactorX??1),y-cam.scrollY*(o.scrollFactorY??1));
            return {x:canvas.x+p.x*canvas.width/game.scale.gameSize.width,y:canvas.y+p.y*canvas.height/game.scale.gameSize.height};
          }));
        }
        add({id,parentId,semanticId:bindings.get(o)??null,engine:'phaser',name:o.name||o.type,type:o.type,visible,bounds,cameraId,
          boundsMethod:bounds?'main-camera projected world AABB; occlusion unresolved':'unmeasured: unsupported camera/mask or no bounds',
          raw:{position:[o.x,o.y],scale:[o.scaleX,o.scaleY],rotation:o.rotation,origin:[o.originX??null,o.originY??null],depth:o.depth,alpha:o.alpha,
            texture:o.texture?.key??null,frame:o.frame?.name??null,text:typeof o.text==='string'?o.text:null,font:o.style?{family:o.style.fontFamily,size:o.style.fontSize,align:o.style.align,color:o.style.color,stroke:o.style.stroke,strokeThickness:o.style.strokeThickness}:null,tint:[o.tintTopLeft??null,o.tintTopRight??null,o.tintBottomLeft??null,o.tintBottomRight??null],blendMode:o.blendMode??null,mask:masked}});
        if(Array.isArray(o.list))o.list.forEach((child,i)=>visit(child,id+'/'+i,id,visible,masked,depth+1));
      };
      scene.children.list.forEach((o,i)=>visit(o,'phaser/'+si+'/'+i,null,true,false,0));
    }
  }
  if(config.three) {
    const root=evaluate(config.three.scene), camera=evaluate(config.three.camera);
    const surface=config.three.surface?evaluate(config.three.surface):null;
    if(surface&&!geometry.surface(surface))throw new Error('Three surface must be an explicit axis-aligned final-output pixel rectangle');
    cameras.push({id:'three-camera',engine:'three',surface,projectionConvention:'clip-minus-one-to-one',raw:{name:camera.name,type:camera.type,projection:camera.projectionMatrix.toArray(),view:camera.matrixWorldInverse.toArray(),world:camera.matrixWorld.toArray(),near:camera.near,far:camera.far}});
    const visit=(o,id,parentId,parentVisible,depth)=>{
      if(depth>128 || total>=limit) {total++;return;}
      const visible=parentVisible&&o.visible!==false;
      const box=o.geometry?.boundingBox;
      const localBounds=box?{min:box.min.toArray(),max:box.max.toArray()}:null;
      const supported=!o.isSkinnedMesh&&!o.isInstancedMesh&&!o.morphTargetInfluences?.some(v=>v!==0);
      const projected=supported?geometry.corners(localBounds).map(p=>geometry.project(geometry.transform(o.matrixWorld.toArray(),p),camera.matrixWorldInverse.toArray(),camera.projectionMatrix.toArray(),surface)):[];
      const bounds=geometry.bounds(projected);
      add({id,parentId,semanticId:bindings.get(o)??null,engine:'three',name:o.name,type:o.type,visible,cameraId:'three-camera',bounds,localBounds,projectionSupported:supported,
        boundsMethod:bounds?'existing local geometry AABB projected through observed matrices':'unmeasured: no existing bounds, unsupported deformation/instancing, surface or clip-plane crossing',
        raw:{uuid:o.uuid,position:o.position.toArray(),quaternion:o.quaternion.toArray(),scale:o.scale.toArray(),world:o.matrixWorld.toArray(),geometry:o.geometry?{name:o.geometry.name,uuid:o.geometry.uuid}:null,materials:(Array.isArray(o.material)?o.material:[o.material]).filter(Boolean).map(material),light:o.isLight?{type:o.type,color:[o.color.r,o.color.g,o.color.b],intensity:o.intensity,castShadow:o.castShadow,distance:o.distance??null,decay:o.decay??null,angle:o.angle??null}:null}});
      o.children.forEach((child,i)=>visit(child,id+'/'+i,id,visible,depth+1));
    };visit(root,'three',null,true,0);
  }
  return {schemaVersion:1,kind:'helix-scene',coordinateSpace:'viewport-top-left-pixels',viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,zoom:visualViewport?.scale??1},
    timeline:config.timeline?evaluate(config.timeline):null,pipeline:config.three?.renderer?(()=>{const r=evaluate(config.three.renderer);return {engine:'three',outputColorSpace:r.outputColorSpace??null,toneMapping:r.toneMapping??null,toneMappingExposure:r.toneMappingExposure??null,shadows:r.shadowMap?.enabled??null};})():null,checkpoint:config.checkpoint??null,state:config.state?evaluate(config.state):null,observedAt:performance.now(),nodes,cameras,bindingErrors,truncated:total>nodes.length,totalNodes:total,
    conventions:{phaser:'2D y-down; radians',three:'engine-native; column-major matrices'},notes:['Geometry observations only; no occlusion or visual acceptance. Capture images separately at a settled checkpoint.']};
}`;
