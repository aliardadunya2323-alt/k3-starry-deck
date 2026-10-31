import * as THREE from 'three';
import { CHARACTER_SHADING_VERSION, softCharacterRamp, installCharacterRGBRamp } from './character-shading.js';
import { applyHairSurface } from './hair-surface.js';

// Original reconstructed heads have real eyelid apertures and independent iris surfaces.
// Roles, rather than mesh ordering, determine rendering and animation ownership.
export const REBUILT_HEAD_STYLE = 'anime-rebuild-v2';
// Existing scene lights only. Discover once per scene topology, sample once per render frame.
const eyeEnvironment = new WeakMap();
function addColor(out, color, weight) { out.r += color.r * weight; out.g += color.g * weight; out.b += color.b * weight; }
function sampleEyeEnvironment(renderer, scene) {
  let state = eyeEnvironment.get(scene);
  if (!state || state.children !== scene.children.length) {
    state = { children: scene.children.length, hemi: null, sun: null, frame: -1, renderer: null, color: new THREE.Color() };
    scene.traverse(o => { if (o.isHemisphereLight && !state.hemi) state.hemi = o; if (o.isDirectionalLight && !state.sun) state.sun = o; });
    eyeEnvironment.set(scene, state);
  }
  const frame = renderer.info.render.frame;
  if (state.frame === frame && state.renderer === renderer) return state.color;
  state.frame = frame; state.renderer = renderer;
  state.color.setRGB(0, 0, 0);
  if (state.hemi?.visible) {
    addColor(state.color, state.hemi.color, Math.max(0, state.hemi.intensity) * 0.65);
    addColor(state.color, state.hemi.groundColor, Math.max(0, state.hemi.intensity) * 0.35);
  }
  if (state.sun?.visible) addColor(state.color, state.sun.color, Math.max(0, state.sun.intensity) * 0.45);
  const peak = Math.max(state.color.r, state.color.g, state.color.b);
  const energy = 0.90 + 0.10 * THREE.MathUtils.clamp(peak, 0, 1);
  if (peak > 0.0001) state.color.multiplyScalar(1 / peak); else state.color.setRGB(1, 1, 1);
  // At most 8% chromatic adaptation; attenuation only, so identity and highlights survive.
  state.color.setRGB((0.92 + 0.08 * state.color.r) * energy, (0.92 + 0.08 * state.color.g) * energy, (0.92 + 0.08 * state.color.b) * energy);
  return state.color;
}
export function isRebuiltHead(root) {
  let result = false;
  root.traverse(o => { if (o.userData?.k3FaceStyle === REBUILT_HEAD_STYLE) result = true; });
  return result;
}

// Optional authored shading reference: keep the face stable when a neck extends.
// Geometry bounds remain accurate for culling; existing assets remain unchanged.
function shadingReferenceBounds(mesh) {
  mesh.geometry.computeBoundingBox();
  const r=mesh.userData.k3ShadingReferenceBounds;
  if (!r) return mesh.geometry.boundingBox;
  if (!['min','max'].every(k=>Array.isArray(r[k]) && r[k].length===3 && r[k].every(Number.isFinite)) || r.min.some((v,i)=>v>=r.max[i]))
    throw new Error('Invalid shading reference bounds: '+mesh.name);
  return new THREE.Box3(new THREE.Vector3(...r.min),new THREE.Vector3(...r.max));
}

export function prepareRebuiltHead(root) {
  // Linear-light color ramps: warm rose skin shadows, broad slate-blue silver-hair shadows.
  // Three's stock toon chunk samples .r only, so the explicit RGB shader hook below is necessary.
  const skinRamp = softCharacterRamp('skin'), hairRamp = softCharacterRamp('hair');
  let form = null;
  root.traverse(o => { if (o.userData?.form) form = o.userData.form; });
  const retired = new Set();
  let head = null, hair = null;
  let skinBounds = null;
  root.traverse(mesh => {
    if (mesh.isMesh && mesh.userData.surfaceRole === 'skin') {
      mesh.geometry.computeBoundingBox();
      skinBounds = shadingReferenceBounds(mesh);
    }
  });
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    const old = mesh.material;
    const role = mesh.userData.surfaceRole || old.userData?.surfaceRole;
    const map = old.map || null;
    if (map) {
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 4;
      map.needsUpdate = true;
    }
    mesh.geometry.computeBoundingBox();
    const bounds = role === 'lidSkin' && skinBounds ? skinBounds : shadingReferenceBounds(mesh);
    const surfaceBounds = new THREE.Vector2(bounds.min.y, Math.max(0.001, bounds.max.y - bounds.min.y));
    const addSurfaceCoordinates = shader => {
      shader.uniforms.k3SurfaceBounds = { value: surfaceBounds };
      shader.vertexShader = 'varying vec3 k3Local;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nk3Local = position;');
      shader.fragmentShader = 'varying vec3 k3Local; uniform vec2 k3SurfaceBounds;\n' + shader.fragmentShader;
    };
    const color = old.color?.clone() || new THREE.Color(0xffffff);
    const skinLike = role === 'skin' || role === 'lidSkin';
    if (skinLike || role === 'hair') {
      mesh.material = new THREE.MeshToonMaterial({
        color, map, side: THREE.FrontSide,
        vertexColors: skinLike && !!mesh.geometry.attributes.color, // Authored sculpt cavity tint; white elsewhere.
        gradientMap: skinLike ? skinRamp : hairRamp,
        emissive: map ? 0xffffff : color,
        emissiveMap: map,
        emissiveIntensity: skinLike ? 0.018 : 0.005,
      });
      mesh.material.onBeforeCompile = shader => {
        addSurfaceCoordinates(shader);
        shader.uniforms.k3Skin = { value: skinLike ? 1 : 0 };
        // Ratios are measured from installed GLB Head bounds, including its neck.
        // Nose centers: chibi y=-.097 over [-.211,.198], awakened y=-.054 over [-.154,.125].
        const isChibi = form === 'chibi' || (form === null && surfaceBounds.y > 0.34);
        shader.uniforms.k3Nose = { value: new THREE.Vector4(
          bounds.getCenter(new THREE.Vector3()).x + (bounds.max.x - bounds.min.x) * 0.019,
          bounds.min.y + surfaceBounds.y * (isChibi ? 0.278728606 : 0.358422939),
          (bounds.max.x - bounds.min.x) * 0.024,
          surfaceBounds.y * 0.043) };
        shader.fragmentShader = 'uniform float k3Skin; uniform vec4 k3Nose;\n' + shader.fragmentShader;
        installCharacterRGBRamp(shader);
        // Skin needs its midtones on the front-facing hemisphere. The default
        // toon lookup spends half of this soft skin palette behind the face.
        if (skinLike) {
          const legacy = 'vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );';
          if (!shader.fragmentShader.includes(legacy)) throw new Error('Skin gradient coordinate contract changed');
          shader.fragmentShader = shader.fragmentShader.replace(legacy,
            'vec2 coord = vec2( clamp((dotNL + 0.10) / 1.10, 0.0, 1.0), 0.0 );');
        }
        shader.fragmentShader = shader.fragmentShader.replace(
          'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
          `// Preserve albedo while reducing the chroma of nearby red/cyan practical lights.
          vec3 k3Illum = reflectedLight.directDiffuse / max(diffuseColor.rgb, vec3(0.025));
          float k3Luma = dot(k3Illum, vec3(0.2126, 0.7152, 0.0722));
          vec3 k3Direct = diffuseColor.rgb * mix(vec3(k3Luma), k3Illum, mix(0.58, 0.23, k3Skin));
          // Smooth ambient compression preserves cheek/neck curvature instead
          // of clipping every bright hemisphere sample to the same flat value.
          vec3 k3Ambient = reflectedLight.indirectDiffuse / (vec3(1.0) + reflectedLight.indirectDiffuse / max(diffuseColor.rgb * 0.8, vec3(0.001)));
          vec3 k3Lit = k3Direct + k3Ambient;
          float k3Height = (k3Local.y - k3SurfaceBounds.x) / k3SurfaceBounds.y;
          // A restrained art-directed fringe occlusion, not simulated shadow mapping.
          float k3Fringe = smoothstep(0.58, 0.78, k3Height) * (1.0 - smoothstep(0.85, 0.97, k3Height));
          float k3Front = smoothstep(0.0, 0.075, k3Local.z);
          k3Lit *= 1.0 - k3Skin * k3Fringe * k3Front * 0.10;
          // Small feathered nose-side occlusion; no black outline or painted nostril.
          vec2 k3NoseP = (k3Local.xy - k3Nose.xy) / max(k3Nose.zw, vec2(0.001));
          float k3NoseShade = exp(-dot(k3NoseP, k3NoseP) * 1.6) * k3Front * k3Skin;
          k3Lit *= vec3(1.0) - k3NoseShade * vec3(0.025, 0.038, 0.040);
          // Wide, low-energy hair sheen follows existing smoothed strand normals.
          float k3Sheen = pow(max(dot(normal, normalize(vec3(-0.4, 0.65, 0.7))), 0.0), 7.0);
          k3Lit += (1.0 - k3Skin) * diffuseColor.rgb * vec3(0.032, 0.039, 0.048) * k3Sheen;
          float k3Peak = max(k3Lit.r, max(k3Lit.g, k3Lit.b));
          float k3SoftPeak = k3Peak <= 0.55 ? k3Peak : 0.55 + 0.25 * (1.0-exp(-4.0*(k3Peak-0.55)));
          float k3Scale = mix(1.0 / max(1.0,k3Peak), k3SoftPeak / max(k3Peak,0.00001), k3Skin);
          vec3 outgoingLight = k3Lit * k3Scale + totalEmissiveRadiance;`
        );
      };
      mesh.material.customProgramCacheKey = () => 'k3-head-skin-midtone-v01';
      mesh.material.userData.k3CharacterShading = CHARACTER_SHADING_VERSION;
      if (role === 'hair') applyHairSurface(mesh.material);
      mesh.castShadow = role !== 'lidSkin'; // No extra shadow program for a blinking eyelid.
      if (role === 'skin') head = mesh;
      else if (role === 'hair') hair = mesh;
    } else {
      // Eyes and fine lines retain painted contrast without casting tiny black
      // self-shadows onto the sclera; no additive glow or enlarged face shell.
      // MeshBasic color is linear: keep even a white atlas highlight below the
      // game's 0.85 bloom threshold; the lid shader only attenuates this color.
      const eyeLimit = role === 'eyeWhite' ? 0.54 : role === 'iris' ? 0.68 : null;
      if (eyeLimit !== null) color.multiplyScalar(eyeLimit / Math.max(eyeLimit, color.r, color.g, color.b));
      mesh.material = new THREE.MeshBasicMaterial({ color, map, side: THREE.FrontSide });
      if (eyeLimit !== null) mesh.material.userData.linearColorLimit = eyeLimit;
      if (eyeLimit !== null) {
        const environment = { value: new THREE.Color(1, 1, 1) };
        const previousBeforeRender = mesh.onBeforeRender;
        mesh.onBeforeRender = function(renderer, scene, ...args) {
          previousBeforeRender?.call(this, renderer, scene, ...args);
          environment.value.copy(sampleEyeEnvironment(renderer, scene));
        };
        mesh.material.onBeforeCompile = shader => {
          addSurfaceCoordinates(shader);
          shader.uniforms.k3EyeEnvironment = environment;
          shader.uniforms.k3EyeLimit = { value: eyeLimit };
          shader.fragmentShader = 'uniform vec3 k3EyeEnvironment; uniform float k3EyeLimit;\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
            'outgoingLight *= k3EyeEnvironment;\nfloat k3EyePeak = max(outgoingLight.r, max(outgoingLight.g, outgoingLight.b));\noutgoingLight *= min(1.0, k3EyeLimit / max(k3EyePeak, 0.00001));\n#include <opaque_fragment>');
          shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
            '#include <color_fragment>\nfloat lidHeight = (k3Local.y - k3SurfaceBounds.x) / k3SurfaceBounds.y;\ndiffuseColor.rgb *= 1.0 - 0.19 * smoothstep(0.55, 0.96, lidHeight);');
        };
        mesh.material.customProgramCacheKey = () => 'k3-eye-lid-environment-v2';
      }
      mesh.castShadow = false;
    }
    mesh.receiveShadow = false;
    mesh.material.name = `K3-Rebuilt-${role}`;
    mesh.material.userData.surfaceRole = role;
    mesh.userData.k3RebuiltSurface = true;
    retired.add(old);
  });
  for (const material of retired) material.dispose(); // Texture ownership stays with the loaded head.
  return { head, hair };
}
