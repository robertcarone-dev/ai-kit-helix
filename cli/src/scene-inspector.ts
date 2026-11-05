/** Read-only scene inventory. No rendering, layout, camera or animation updates are invoked. */
export const SCENE_INSPECTOR = String.raw`(config) => {
  const evaluate = expression => (0, eval)('(' + expression + ')');
  const nodes = [], cameras = [], bindingErrors = [], bindings = new Map();
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
            texture:o.texture?.key??null,frame:o.frame?.name??null,text:typeof o.text==='string'?o.text:null}});
        if(Array.isArray(o.list))o.list.forEach((child,i)=>visit(child,id+'/'+i,id,visible,masked,depth+1));
      };
      scene.children.list.forEach((o,i)=>visit(o,'phaser/'+si+'/'+i,null,true,false,0));
    }
  }
  if(config.three) {
    const root=evaluate(config.three.scene), camera=evaluate(config.three.camera);
    cameras.push({id:'three-camera',engine:'three',raw:{name:camera.name,type:camera.type,projection:camera.projectionMatrix.toArray(),world:camera.matrixWorld.toArray(),near:camera.near,far:camera.far}});
    const visit=(o,id,parentId,parentVisible,depth)=>{
      if(depth>128 || total>=limit) {total++;return;}
      const visible=parentVisible&&o.visible!==false;
      add({id,parentId,semanticId:bindings.get(o)??null,engine:'three',name:o.name,type:o.type,visible,cameraId:'three-camera',bounds:null,
        boundsMethod:'unmeasured: Three output surface requires an explicit mapping',
        raw:{uuid:o.uuid,position:o.position.toArray(),quaternion:o.quaternion.toArray(),scale:o.scale.toArray(),world:o.matrixWorld.toArray(),geometry:o.geometry?{name:o.geometry.name,uuid:o.geometry.uuid}:null}});
      o.children.forEach((child,i)=>visit(child,id+'/'+i,id,visible,depth+1));
    };visit(root,'three',null,true,0);
  }
  return {schemaVersion:1,kind:'helix-scene',coordinateSpace:'viewport-top-left-pixels',viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,zoom:visualViewport?.scale??1},
    checkpoint:config.checkpoint??null,state:config.state?evaluate(config.state):null,observedAt:performance.now(),nodes,cameras,bindingErrors,truncated:total>nodes.length,totalNodes:total,
    conventions:{phaser:'2D y-down; radians',three:'engine-native; column-major matrices'},notes:['Geometry observations only; no occlusion or visual acceptance. Capture images separately at a settled checkpoint.']};
}`;
