// Material factory.
//
// Static level geometry is lit by *baked, relightable* lighting: every vertex
// stores how much light it receives from each of 8 power circuits (computed
// once at load). At runtime a single uniform array scales those circuits, so
// flicker, blackouts and per-room failures cost nothing extra on the GPU.
// Dynamic objects (animals, doors) receive a per-object "probe" colour sampled
// from the same circuits. The only real-time lights are the flashlight and the
// camera flash, so the shader cost is tiny even on integrated graphics.
//
// Low quality swaps PBR materials for Lambert at runtime.
import * as THREE from 'three';

export const CIRCUIT_COUNT = 8;

export const shared = {
  uCirc: { value: Array.from({ length: CIRCUIT_COUNT }, () => new THREE.Vector3()) },
  uAmbient: { value: new THREE.Vector3(0.02, 0.02, 0.026) },
  uSpec: { value: 1.0 },
  uTime: { value: 0 },
};

const STATIC_VERT_PARS = /* glsl */ `
attribute vec4 aBakeA;
attribute vec4 aBakeB;
attribute vec4 aStatic;
uniform vec3 uCirc[${CIRCUIT_COUNT}];
uniform vec3 uAmbient;
varying vec3 vBake;
`;

const STATIC_VERT_MAIN = /* glsl */ `
vBake = aBakeA.x * uCirc[0] + aBakeA.y * uCirc[1] + aBakeA.z * uCirc[2] + aBakeA.w * uCirc[3]
      + aBakeB.x * uCirc[4] + aBakeB.y * uCirc[5] + aBakeB.z * uCirc[6] + aBakeB.w * uCirc[7]
      + aStatic.rgb + uAmbient * aStatic.a;
`;

const STATIC_FRAG = /* glsl */ `
irradiance += vBake;
#if defined( RE_IndirectSpecular )
  iblIrradiance = vec3( 0.0 );
  radiance *= uSpec * clamp( dot( vBake, vec3( 0.3333 ) ) * 0.9, 0.0, 1.6 );
#endif
`;

const DYN_FRAG = /* glsl */ `
{
  vec3 upV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  float upF = dot( geometryNormal, upV ) * 0.5 + 0.5;
  vec3 probeLight = uProbe * mix( 0.42, 1.12, upF ) + uAmbient;
  float rim = pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 3.0 );
  probeLight += uProbe * rim * uRim;
  irradiance += probeLight;
  #if defined( RE_IndirectSpecular )
    iblIrradiance = vec3( 0.0 );
    radiance *= uSpec * clamp( dot( uProbe, vec3( 0.3333 ) ) * 0.9, 0.0, 1.6 );
  #endif
}
`;

function injectStatic(shader) {
  shader.uniforms.uCirc = shared.uCirc;
  shader.uniforms.uAmbient = shared.uAmbient;
  shader.uniforms.uSpec = shared.uSpec;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + STATIC_VERT_PARS)
    .replace('#include <fog_vertex>', '#include <fog_vertex>\n' + STATIC_VERT_MAIN);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vBake;\nuniform float uSpec;')
    .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + STATIC_FRAG);
}

function makeDynamicInjector(def) {
  const fn = function (shader) {
    shader.uniforms.uProbe = def.probe;
    shader.uniforms.uRim = def.rim;
    shader.uniforms.uAmbient = shared.uAmbient;
    shader.uniforms.uSpec = shared.uSpec;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uProbe;\nuniform float uRim;\nuniform vec3 uAmbient;\nuniform float uSpec;'
      )
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + DYN_FRAG);
  };
  return fn;
}

// Shared program cache keys so all static (and all dynamic) materials reuse
// the same compiled shader variants.
const STATIC_KEY = 'nw-static-v1';
const DYN_KEY = 'nw-dyn-v1';

class MaterialRegistry {
  constructor() {
    this.entries = [];
    this.pbr = true;
    this.anisotropy = 1;
  }

  setQuality(pbr, anisotropy) {
    this.anisotropy = anisotropy;
    if (pbr === this.pbr) return null;
    this.pbr = pbr;
    const swap = new Map();
    for (const e of this.entries) {
      if (e.kind !== 'static' && e.kind !== 'dynamic') continue;
      const old = e.mat;
      e.mat = this.build(e);
      swap.set(old, e.mat);
      old.dispose();
    }
    return swap;
  }

  build(e) {
    const p = e.params;
    const common = {
      color: p.color !== undefined ? p.color : 0xffffff,
      map: p.map || null,
      vertexColors: !!p.vertexColors,
      transparent: !!p.transparent,
      opacity: p.opacity !== undefined ? p.opacity : 1,
      side: p.side !== undefined ? p.side : THREE.FrontSide,
      emissive: p.emissive !== undefined ? p.emissive : 0x000000,
      emissiveIntensity: p.emissiveIntensity !== undefined ? p.emissiveIntensity : 1,
      alphaTest: p.alphaTest || 0,
      depthWrite: p.depthWrite !== undefined ? p.depthWrite : true,
      flatShading: !!p.flatShading,
    };
    let mat;
    if (this.pbr) {
      mat = new THREE.MeshStandardMaterial({
        ...common,
        roughness: p.roughness !== undefined ? p.roughness : 0.85,
        metalness: p.metalness !== undefined ? p.metalness : 0,
        normalMap: p.normalMap || null,
      });
      if (p.normalMap && p.normalScale) mat.normalScale.set(p.normalScale, p.normalScale);
    } else {
      mat = new THREE.MeshLambertMaterial(common);
    }
    if (e.kind === 'static') {
      mat.onBeforeCompile = injectStatic;
      mat.customProgramCacheKey = () => STATIC_KEY;
    } else {
      mat.onBeforeCompile = makeDynamicInjector(e);
      mat.customProgramCacheKey = () => DYN_KEY;
    }
    if (mat.map) mat.map.anisotropy = this.anisotropy;
    mat.name = e.name;
    return mat;
  }

  // Lit material for baked level geometry.
  static(name, params = {}) {
    const e = { kind: 'static', name, params, mat: null };
    e.mat = this.build(e);
    this.entries.push(e);
    return e.mat;
  }

  // Lit material for moving objects; returns the entry so callers can update
  // the probe colour (entry.probe.value) without holding the material itself.
  dynamic(name, params = {}) {
    const e = {
      kind: 'dynamic',
      name,
      params,
      mat: null,
      probe: { value: new THREE.Vector3(0.6, 0.6, 0.6) },
      rim: { value: params.rim !== undefined ? params.rim : 0.35 },
    };
    e.mat = this.build(e);
    this.entries.push(e);
    return e;
  }

  // Unlit material (screens, light tubes, signs). Never swapped.
  basic(name, params = {}) {
    const mat = new THREE.MeshBasicMaterial({
      color: params.color !== undefined ? params.color : 0xffffff,
      map: params.map || null,
      transparent: !!params.transparent,
      opacity: params.opacity !== undefined ? params.opacity : 1,
      side: params.side !== undefined ? params.side : THREE.FrontSide,
      depthWrite: params.depthWrite !== undefined ? params.depthWrite : true,
      blending: params.blending !== undefined ? params.blending : THREE.NormalBlending,
      vertexColors: !!params.vertexColors,
      toneMapped: params.toneMapped !== undefined ? params.toneMapped : true,
      fog: params.fog !== undefined ? params.fog : true,
      alphaTest: params.alphaTest || 0,
    });
    mat.name = name;
    this.entries.push({ kind: 'basic', name, params, mat });
    return mat;
  }

  // Remove a dynamic entry (when a patient is discarded).
  release(entry) {
    const i = this.entries.indexOf(entry);
    if (i >= 0) this.entries.splice(i, 1);
    if (entry.mat) entry.mat.dispose();
  }
}

export const Materials = new MaterialRegistry();

// Apply a material swap map (old -> new) to every mesh under root.
export function applySwap(root, swap) {
  if (!swap || swap.size === 0) return;
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material)) {
      o.material = o.material.map((m) => swap.get(m) || m);
    } else if (swap.has(o.material)) {
      o.material = swap.get(o.material);
    }
  });
}
