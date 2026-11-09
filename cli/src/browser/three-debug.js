// Scoped synchronous capture. Callers own scene/camera selection and simulation checkpoints.
(() => {
  const expressions = {
    silhouette: 'vec3(1.0)',
    'material-id': 'helixMaterialColor',
    'shadow-attenuation': 'vec3(getShadowMask())',
    'mesh-normal': 'normalize(vHelixNormal) * 0.5 + 0.5',
    'shaded-normal': 'normalize(normal) * 0.5 + 0.5',
    uv: 'vec3(fract(vHelixUv), 0.0)',
    'uv-checker': 'vec3(mod(floor(vHelixUv.x * 10.0) + floor(vHelixUv.y * 10.0), 2.0))',
    tangent: 'normalize(vHelixTangent.xyz) * 0.5 + 0.5',
    'tangent-sign': 'vec3(vHelixTangent.w * 0.5 + 0.5)',
    depth: 'vec3(clamp((vViewPosition.z - helixNear) / (helixFar - helixNear), 0.0, 1.0))',
    'base-color': 'diffuseColor.rgb',
    'material-alpha': 'vec3(diffuseColor.a)',
    roughness: 'vec3(roughnessFactor)',
    metallic: 'vec3(metalnessFactor)',
    specular: 'reflectedLight.directSpecular + reflectedLight.indirectSpecular',
    'lighting-only': 'outgoingLight',
  };
  function capture({ scene, camera, renderer, view, materialIds, root = scene }) {
    if (!Object.hasOwn(expressions, view)) throw new Error('Unsupported Three debug view: ' + view);
    if (!scene?.isScene || !camera?.isCamera || !renderer?.isWebGLRenderer)
      throw new Error('Supply the selected Three Scene, Camera and WebGLRenderer.');
    if (renderer.getRenderTarget() !== null) throw new Error('Debug capture requires the renderer default canvas target.');
    const selected = new Set();
    root.traverse(object => selected.add(object));
    if (!selected.has(scene) && !scene.getObjectById(root.id)) throw new Error('Debug root must belong to the selected scene.');
    const saved = [], materials = [], shaders = [], visibility = [];
    const semanticIds = new Map(), namedMaterials = new Map();
    const background = scene.background, autoClear = renderer.autoClear, onShaderError = renderer.debug.onShaderError;
    const shadowUpdate = renderer.shadowMap.needsUpdate;
    const shadows = [];
    scene.traverse(object => { if (object.isLight && object.shadow) shadows.push([object.shadow, object.shadow.needsUpdate]); });
    const oldAlpha = renderer.getClearAlpha();
    // getClearColor requires a Color instance; the camera has no dependency on a global THREE namespace.
    let clearColor;
    scene.traverseVisible(object => {
      if (!selected.has(object)) return;
      if (object.isLine || object.isPoints || object.isSprite) throw new Error('Select a mesh-only Three scene for diagnostic capture.');
      if (!object.isMesh) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material.isMeshStandardMaterial) throw new Error('Debug capture requires Standard/Physical materials: ' + material.name);
        if (view === 'material-id') {
          if (!materialIds || typeof materialIds !== 'object') throw new Error('Supply semantic material IDs keyed by material UUID or unique name.');
          const key = Object.hasOwn(materialIds, material.uuid) ? material.uuid : material.name;
          if (!key || typeof materialIds[key] !== 'string' || !materialIds[key]) throw new Error('Supply a semantic ID for material UUID ' + material.uuid);
          if (key !== material.uuid && namedMaterials.has(key) && namedMaterials.get(key) !== material) throw new Error('Ambiguous material name: ' + key + '. Use material UUIDs.');
          namedMaterials.set(key, material);
          semanticIds.set(material, materialIds[key]);
        }
        if (!clearColor) clearColor = material.color.clone();
      }
      if (['tangent', 'tangent-sign'].includes(view) && !object.geometry.getAttribute('tangent'))
        throw new Error('Mesh has no authored tangents: ' + object.name);
      if (['uv', 'uv-checker'].includes(view) && !object.geometry.getAttribute('uv'))
        throw new Error('Mesh has no UV0: ' + object.name);
    });
    if (!clearColor) throw new Error('Selected scene has no supported visible meshes.');
    renderer.getClearColor(clearColor);
    try {
      scene.traverse(object => {
        if (!selected.has(object) && (object.isMesh || object.isLine || object.isPoints || object.isSprite)) {
          visibility.push([object, object.visible]);
          object.visible = false;
        }
      });
      scene.background = null;
      renderer.autoClear = true;
      renderer.setClearColor(0x000000, 0);
      renderer.debug.onShaderError = () => { throw new Error('Three debug shader compilation failed.'); };
      scene.traverseVisible(object => {
        if (!object.isMesh) return;
        const original = object.material;
        saved.push([object, original]);
        const replacement = (Array.isArray(original) ? original : [original]).map(source => {
          const material = source.clone();
          materials.push(material);
          if (['tangent', 'tangent-sign'].includes(view)) material.defines = { ...material.defines, USE_TANGENT: '' };
          material.toneMapped = false;
          material.fog = false;
          material.transparent = false;
          material.blending = 0; // Three NoBlending: store diagnostic channels without compositing.
          material.depthWrite = true;
          if (view === 'lighting-only') {
            material.color.setRGB(1, 1, 1); material.map = null; material.vertexColors = false;
            material.metalness = 0; material.metalnessMap = null; material.roughness = 1; material.roughnessMap = null;
            material.emissive.setRGB(0, 0, 0); material.emissiveMap = null; material.aoMap = null;
            if (material.isMeshPhysicalMaterial) { material.clearcoat = 0; material.transmission = 0; material.sheen = 0; }
          }
          material.customProgramCacheKey = () => 'helix-debug-v1-' + view + '-' + source.customProgramCacheKey();
          material.onBeforeCompile = (shader, activeRenderer) => {
            source.onBeforeCompile.call(material, shader, activeRenderer);
            const requireChunk = (text, chunk) => { if (!text.includes(chunk)) throw new Error('Required Three shader chunk unavailable: ' + chunk); };
            requireChunk(shader.vertexShader, '#include <defaultnormal_vertex>');
            requireChunk(shader.vertexShader, '#include <uv_vertex>');
            requireChunk(shader.fragmentShader, '#include <opaque_fragment>');
            const tangents = ['tangent', 'tangent-sign'].includes(view);
            const declarations = 'varying vec3 vHelixNormal; varying vec2 vHelixUv;' + (tangents ? 'varying vec4 vHelixTangent;' : '');
            shader.vertexShader = declarations + '\n' + shader.vertexShader;
            shader.fragmentShader = declarations + '\nuniform float helixNear; uniform float helixFar; uniform vec3 helixMaterialColor;\n' + shader.fragmentShader;
            if (view === 'material-id') {
              let hash = 2166136261;
              for (const byte of new TextEncoder().encode(semanticIds.get(source))) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
              shader.uniforms.helixMaterialColor = { value: source.color.clone().setRGB((hash & 255) / 255, ((hash >>> 8) & 255) / 255, ((hash >>> 16) & 255) / 255) };
            }
            if (view === 'shadow-attenuation') {
              requireChunk(shader.fragmentShader, '#include <shadowmap_pars_fragment>');
              shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>');
            }
            shader.uniforms.helixNear = { value: camera.near }; shader.uniforms.helixFar = { value: camera.far };
            shader.vertexShader = shader.vertexShader.replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvHelixNormal = transformedNormal;' + (tangents ? '\nvHelixTangent = vec4(normalize(mat3(modelViewMatrix) * tangent.xyz), tangent.w);' : ''));
            // Explicit UV0 view, independent of any texture transform or selected texture channel.
            shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvHelixUv = uv;');
            shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor = vec4(' + expressions[view] + ', 1.0);');
            for (const chunk of ['tonemapping_fragment', 'colorspace_fragment', 'fog_fragment', 'premultiplied_alpha_fragment', 'dithering_fragment'])
              shader.fragmentShader = shader.fragmentShader.replace('#include <' + chunk + '>', '');
            shaders.push(source.name);
          };
          return material;
        });
        object.material = Array.isArray(original) ? replacement : replacement[0];
      });
      renderer.shadowMap.needsUpdate = true;
      for (const [shadow] of shadows) shadow.needsUpdate = true;
      renderer.render(scene, camera);
      if (shaders.length === 0) throw new Error('No diagnostic mesh shader was rendered.');
      return {
        png: renderer.domElement.toDataURL('image/png'),
        root: { name: root.name, id: root.id },
        view, width: renderer.domElement.width, height: renderer.domElement.height,
        camera: { projection: camera.projectionMatrix.toArray(), world: camera.matrixWorld.toArray(), near: camera.near, far: camera.far },
        encoding: 'linear diagnostic values stored directly in PNG channels; vectors encoded as value * 0.5 + 0.5',
        coordinates: 'view-space normals/tangents; UV0 before texture transforms; depth normalized to camera near/far',
        alpha: renderer.getContext().getContextAttributes().alpha ? 'diagnostic mesh coverage; inspect material-alpha for surface opacity' : 'opaque WebGL canvas; material-alpha records surface opacity',
        materials: shaders,
        materialIds: view === 'material-id' ? materialIds : null,
        shadowScope: view === 'shadow-attenuation' ? 'product of all shadow-casting light visibility terms' : null,
      };
    } finally {
      for (const [object, visible] of visibility) object.visible = visible;
      for (const [object, material] of saved) object.material = material;
      for (const material of materials) material.dispose();
      scene.background = background;
      renderer.autoClear = autoClear;
      renderer.setClearColor(clearColor, oldAlpha);
      renderer.debug.onShaderError = onShaderError;
      renderer.shadowMap.needsUpdate = true;
      for (const [shadow] of shadows) shadow.needsUpdate = true;
      try { renderer.render(scene, camera); }
      finally {
        renderer.shadowMap.needsUpdate = shadowUpdate;
        for (const [shadow, needsUpdate] of shadows) shadow.needsUpdate = needsUpdate;
      }
    }
  }
  window.helixThreeDebug = Object.freeze({ version: 1, views: Object.keys(expressions), capture });
})();
