/** Runs in the prototype renderer. Bounds are observations, not hit-test or occlusion claims. */
export const REFERENCE_INSPECTOR = String.raw`(config) => {
  const evaluate = (expression) => (0, eval)('(' + expression + ')');
  const nodes = [],
    cameras = [],
    notes = [];
  let total = 0,
    matched = 0;
  const add = (node) => {
    total++;
    if (config.match && !JSON.stringify(node).toLowerCase().includes(config.match.toLowerCase()))
      return;
    matched++;
    if (nodes.length < 1000) nodes.push(node);
  };
  const rect = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  const material = (m) => ({
    name: m.name,
    type: m.type,
    uuid: m.uuid,
    color: m.color?.getHexString?.() ?? null,
    metalness: m.metalness ?? null,
    roughness: m.roughness ?? null,
    opacity: m.opacity,
    transparent: m.transparent,
    textures: Object.entries(m)
      .filter(([, v]) => v?.isTexture)
      .map(([slot, t]) => ({
        slot,
        name: t.name,
        uuid: t.uuid,
        source: t.source?.data?.currentSrc ?? t.source?.data?.src ?? null,
      })),
  });
  for (const [index, node] of [
    ...document.querySelectorAll('button,input,[role=button],canvas'),
  ].entries()) {
    const b = node.getBoundingClientRect();
    add({
      id: 'dom/' + index,
      kind: 'dom',
      name:
        node.id ||
        node.getAttribute('aria-label') ||
        node.textContent?.trim().slice(0, 100) ||
        node.tagName,
      bounds: rect(b),
      visible: !!(b.width && b.height) && getComputedStyle(node).visibility !== 'hidden',
      canvasPixels: node.tagName === 'CANVAS' ? { width: node.width, height: node.height } : null,
    });
  }
  if (config.phaser) {
    const game = evaluate(config.phaser),
      canvas = game.canvas.getBoundingClientRect();
    for (const scene of game.scene.getScenes(true)) {
      const cam = scene.cameras.main;
      cameras.push({
        kind: 'phaser',
        scene: scene.sys.settings.key,
        scroll: { x: cam.scrollX, y: cam.scrollY },
        zoom: cam.zoom,
        rotation: cam.rotation,
        viewport: rect(cam),
      });
      const visit = (o, path, parentVisible = true) => {
        const visible = parentVisible && o.visible !== false && (o.alpha ?? 1) > 0;
        let bounds = null;
        if (o.getBounds) {
          const b = o.getBounds();
          const corners = [
            [b.x, b.y],
            [b.x + b.width, b.y],
            [b.x, b.y + b.height],
            [b.x + b.width, b.y + b.height],
          ].map(([x, y]) => {
            const p = cam.matrix.transformPoint(
              x - cam.scrollX * (o.scrollFactorX ?? 1),
              y - cam.scrollY * (o.scrollFactorY ?? 1),
            );
            return {
              x: canvas.x + (p.x * canvas.width) / game.scale.gameSize.width,
              y: canvas.y + (p.y * canvas.height) / game.scale.gameSize.height,
            };
          });
          const xs = corners.map((p) => p.x),
            ys = corners.map((p) => p.y);
          bounds = {
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
          };
        }
        add({
          id: path,
          kind: 'phaser',
          name: o.name || o.type,
          type: o.type,
          text: typeof o.text === 'string' ? o.text : null,
          visible,
          bounds,
          inputEnabled: !!o.input?.enabled && parentVisible && o.visible !== false,
          depth: o.depth,
          alpha: o.alpha,
          transform: { x: o.x, y: o.y, scaleX: o.scaleX, scaleY: o.scaleY, rotation: o.rotation },
          texture: o.texture?.key ?? null,
          frame: o.frame?.name ?? null,
          font: o.style
            ? {
                family: o.style.fontFamily,
                size: o.style.fontSize,
                color: o.style.color,
                stroke: o.style.stroke,
                strokeThickness: o.style.strokeThickness,
              }
            : null,
        });
        if (Array.isArray(o.list))
          o.list.forEach((child, i) => visit(child, path + '/' + i, visible));
      };
      scene.children.list.forEach((o, i) => visit(o, 'phaser/' + scene.sys.settings.key + '/' + i));
    }
    notes.push(
      'Phaser bounds use each active scene main camera; masks, other cameras and occlusion are not resolved.',
    );
  }
  if (config.three) {
    const root = evaluate(config.three.scene),
      cam = evaluate(config.three.camera);
    cameras.push({
      kind: 'three',
      name: cam.name,
      type: cam.type,
      position: cam.position.toArray(),
      quaternion: cam.quaternion.toArray(),
      projection: cam.projectionMatrix.toArray(),
      world: cam.matrixWorld.toArray(),
      fov: cam.fov ?? null,
      aspect: cam.aspect ?? null,
    });
    const visit = (o, path, parentVisible = true) => {
      const visible = parentVisible && o.visible;
      if (o.isMesh) {
        let boundsNdc = null;
        const b = o.geometry?.boundingBox;
        if (b) {
          const corners = [];
          for (const x of [b.min.x, b.max.x])
            for (const y of [b.min.y, b.max.y])
              for (const z of [b.min.z, b.max.z]) {
                const p = o.position.clone().set(x, y, z).applyMatrix4(o.matrixWorld).project(cam);
                corners.push(p);
              }
          boundsNdc = {
            min: ['x', 'y', 'z'].map((k) => Math.min(...corners.map((p) => p[k]))),
            max: ['x', 'y', 'z'].map((k) => Math.max(...corners.map((p) => p[k]))),
          };
        }
        add({
          id: path,
          kind: 'three',
          name: o.name,
          uuid: o.uuid,
          visible,
          boundsNdc,
          transform: {
            position: o.position.toArray(),
            quaternion: o.quaternion.toArray(),
            scale: o.scale.toArray(),
            world: o.matrixWorld.toArray(),
          },
          materials: (Array.isArray(o.material) ? o.material : [o.material])
            .filter(Boolean)
            .map(material),
          geometry: { name: o.geometry?.name, uuid: o.geometry?.uuid },
        });
      }
      o.children.forEach((child, i) => visit(child, path + '/' + i, visible));
    };
    visit(root, 'three');
    notes.push(
      'Three bounds use existing geometry bounds and matrices, in camera NDC; offscreen render textures need a project mapping to UI pixels.',
    );
  }
  return {
    nodes,
    cameras,
    totalNodes: total,
    matchedNodes: matched,
    truncated: matched > nodes.length,
    custom: config.inspect ? evaluate(config.inspect) : null,
    notes,
  };
}`;
