import * as THREE from 'three';

export const CHARACTER_SHADING_VERSION = 'private-character-shading-01';
const ramps = new Map();
const COLORS = Object.freeze({
  skin: [[145,126,127], [197,174,162], [236,218,202], [255,249,240]],
  hair: [[56,73,110], [112,137,181], [186,208,236], [239,247,255]],
});
// Preserve the existing palette, but interpolate in linear light. Face and
// body share the same sixteen-byte skin ramp; no bitmap asset is added.
export function softCharacterRamp(role) {
  if (!COLORS[role]) throw new RangeError('Unknown character ramp: '+role);
  if (!ramps.has(role)) {
    const data = new Uint8Array(COLORS[role].flatMap(rgb => [...rgb,255]));
    const texture = new THREE.DataTexture(data,4,1,THREE.RGBAFormat);
    texture.name = 'K3-Soft-'+role;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false; texture.needsUpdate = true;
    ramps.set(role,texture);
  }
  return ramps.get(role);
}
export function installCharacterRGBRamp(shader) {
  const chunk = THREE.ShaderChunk.gradientmap_pars_fragment;
  const sample = 'vec3( texture2D( gradientMap, coord ).r )';
  if (!chunk.includes(sample) || !shader.fragmentShader.includes('#include <gradientmap_pars_fragment>')) throw new Error('Character RGB ramp shader contract changed');
  shader.fragmentShader = shader.fragmentShader.replace('#include <gradientmap_pars_fragment>',chunk.replace(sample,'texture2D( gradientMap, coord ).rgb'));
}
export function travelerBodySkinMaterial(color) {
  const mat = new THREE.MeshToonMaterial({color,gradientMap:softCharacterRamp('skin')});
  mat.name = 'K3-Traveler-Skin';mat.userData.k3CharacterShading = CHARACTER_SHADING_VERSION;
  mat.onBeforeCompile = shader => {
    installCharacterRGBRamp(shader);
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
      `vec3 k3Illum = reflectedLight.directDiffuse / max(diffuseColor.rgb, vec3(0.025));
      float k3Luma = dot(k3Illum, vec3(0.2126,0.7152,0.0722));
      vec3 k3Lit = diffuseColor.rgb * mix(vec3(k3Luma), k3Illum, 0.23)
        + reflectedLight.indirectDiffuse / (vec3(1.0) + reflectedLight.indirectDiffuse / max(diffuseColor.rgb * 0.8, vec3(0.001)));
      float k3Peak = max(k3Lit.r,max(k3Lit.g,k3Lit.b));
      float k3SoftPeak = k3Peak <= 0.55 ? k3Peak : 0.55 + 0.25 * (1.0-exp(-4.0*(k3Peak-0.55)));
      vec3 outgoingLight = k3Lit * (k3SoftPeak / max(k3Peak,0.00001)) + totalEmissiveRadiance;`);
  };
  mat.customProgramCacheKey = () => CHARACTER_SHADING_VERSION+'-skin';return mat;
}
const ROUGHNESS = Object.freeze({cloth:0.86,satin:0.58,leather:0.70});
export function travelerGarmentMaterial(color,surface='cloth',options={}) {
  if (!(surface in ROUGHNESS)) throw new RangeError('Unknown garment surface: '+surface);
  const mat = new THREE.MeshStandardMaterial({color,roughness:ROUGHNESS[surface],metalness:0,...options});
  mat.name = 'K3-Traveler-'+surface;
  mat.userData.k3CharacterShading = CHARACTER_SHADING_VERSION;mat.userData.k3GarmentSurface = surface;
  // Existing lights drive the response. No emissive lift or extra light.
  if (surface==='cloth' || surface==='satin') mat.onBeforeCompile = shader => {
    const LF=String.fromCharCode(10);
    shader.vertexShader = 'varying vec3 k3GarmentPosition;'+LF+shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>'+LF+'k3GarmentPosition = position;');
    shader.fragmentShader = 'varying vec3 k3GarmentPosition;'+LF+shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      vec2 k3Thread = k3GarmentPosition.xy * vec2(110.0,145.0);
      float k3ThreadWeight = 1.0-smoothstep(0.18,0.85,max(fwidth(k3Thread.x),fwidth(k3Thread.y)));
      diffuseColor.rgb *= 1.0+0.012*k3ThreadWeight*sin(k3Thread.x*6.2831853)*sin(k3Thread.y*6.2831853);`);
  };
  mat.customProgramCacheKey = () => CHARACTER_SHADING_VERSION+'-'+(surface==='leather'?'leather':'woven');return mat;
}
