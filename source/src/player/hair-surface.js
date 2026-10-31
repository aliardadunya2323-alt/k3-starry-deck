import * as THREE from 'three';

export const HAIR_SURFACE_VERSION = 'private-hair-surface-02';
// A stylized, light-driven strand approximation, not a fiber scattering solver.
// Use a continuous head-down flow projected onto smoothed normals, not UV
// derivatives: the latter expose individual low-poly triangles. This is an
// approximate comb direction, not authored per-strand tangents. UVs only drive
// subtle, filtered filament variation. No texture or geometry attribute added.
export function installHairSurface(shader) {
  const chunk = THREE.ShaderChunk.lights_toon_pars_fragment;
  const direct = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
  const sheen = 'k3Lit += (1.0 - k3Skin) * diffuseColor.rgb * vec3(0.032, 0.039, 0.048) * k3Sheen;';
  if (!chunk.includes(direct) || !shader.fragmentShader.includes(sheen) || !shader.fragmentShader.includes('#include <lights_toon_pars_fragment>') || !shader.fragmentShader.includes('#include <map_fragment>') || !shader.vertexShader.includes('#include <begin_vertex>')) throw new Error('K3 hair shader contract changed');
  shader.vertexShader = 'varying vec2 k3HairUV; varying vec3 k3HairDown;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nk3HairUV = uv; k3HairDown = mat3(modelViewMatrix) * vec3(0.0, -1.0, 0.0);');
  shader.fragmentShader = 'varying vec2 k3HairUV; varying vec3 k3HairDown;\n' + shader.fragmentShader;
  const functions = `
    vec3 k3StrandDirection(vec3 n) {
      vec3 down = normalize(k3HairDown);
      vec3 t = down - n * dot(down,n);
      if (dot(t,t) < 1e-8) t = cross(n, abs(n.z) < 0.9 ? vec3(0.0,0.0,1.0) : vec3(1.0,0.0,0.0));
      t = normalize(t);
      return dot(t,k3HairDown) < 0.0 ? -t : t;
    }
    float k3StrandLobe(vec3 t, vec3 h, float power) {
      float d = clamp(dot(t,h),-1.0,1.0);
      return pow(max(0.0,1.0-d*d),power);
    }
  `;
  const light = `
    vec3 k3T = k3StrandDirection(geometryNormal);
    vec3 k3H = normalize(directLight.direction + geometryViewDir + vec3(1e-7));
    float k3NL = max(dot(geometryNormal,directLight.direction),0.0);
    float k3FlowWeight = 1.0 - smoothstep(0.91,0.995,abs(dot(geometryNormal,normalize(k3HairDown))));
    float k3Mask = smoothstep(0.0,0.25,k3NL) * k3FlowWeight;
    float k3Broad = k3StrandLobe(normalize(k3T + geometryNormal * 0.10),k3H,28.0);
    float k3Fine = k3StrandLobe(normalize(k3T - geometryNormal * 0.14),k3H,80.0);
    float k3Energy = 0.32 * k3Broad + 0.09 * k3Fine;
    reflectedLight.directSpecular += directLight.color * k3Mask * k3NL * k3Energy;
  `;
  const patched = chunk.replace('struct ToonMaterial',functions + '\nstruct ToonMaterial').replace(direct,direct+light);
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_toon_pars_fragment>',patched);
  shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
    float k3Phase = k3HairUV.x * 12.0;
    float k3BandLimit = 1.0 - smoothstep(0.15,0.65,fwidth(k3Phase));
    float k3Threads = sin(k3Phase * 6.2831853 + 0.32 * sin(k3HairUV.y * 6.2831853));
    diffuseColor.rgb *= 1.0 - 0.045 * k3BandLimit * (0.5 + 0.5 * k3Threads);
  `);
  // Preserve the shared skin/eyelid branch verbatim. Replace only its hair copy.
  shader.fragmentShader = shader.fragmentShader.replace('float k3Sheen = pow(max(dot(normal, normalize(vec3(-0.4, 0.65, 0.7))), 0.0), 7.0);','');
  shader.fragmentShader = shader.fragmentShader.replace(sheen, `
    vec3 k3HairSpec = reflectedLight.directSpecular;
    float k3SpecLuma = dot(k3HairSpec,vec3(0.2126,0.7152,0.0722));
    k3Lit += mix(vec3(k3SpecLuma),k3HairSpec,0.35);
  `);
  return shader;
}

export function applyHairSurface(material) {
  if (material.userData.k3HairSurface === HAIR_SURFACE_VERSION) return material;
  const compile = material.onBeforeCompile;
  const cache = material.customProgramCacheKey();
  material.onBeforeCompile = function(shader,renderer) {
    compile.call(this,shader,renderer);
    installHairSurface(shader);
  };
  material.customProgramCacheKey = () => cache + '-' + HAIR_SURFACE_VERSION;
  material.userData.k3HairSurface = HAIR_SURFACE_VERSION;
  material.needsUpdate = true;
  return material;
}
