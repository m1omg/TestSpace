// Render system: quality tiers, dynamic resolution, a single-pass post
// effect (grain, vignette, chromatic aberration, stress), CCTV feeds and
// instant-camera photographs. Different cameras see different object layers,
// which is how impostors look different on film and on the security feeds.
import * as THREE from 'three';
import { clamp } from './core.js';

// Object layers. Normal objects live on layer 0 and are seen by everyone.
export const LAYER = {
  EYE: 1, // seen by the player's own eyes only
  PHOTO: 2, // seen by the instant camera only
  CCTV: 3, // seen by security cameras only
  CAM_BASE: 4, // + camera index: seen only by one specific security camera
};

export function viewMask(eye, photo, cctv) {
  const l = new THREE.Layers();
  l.disableAll();
  if (eye && photo && cctv) {
    l.set(0);
    return l;
  }
  if (eye) l.enable(LAYER.EYE);
  if (photo) l.enable(LAYER.PHOTO);
  if (cctv) l.enable(LAYER.CCTV);
  return l;
}

export function setLayersDeep(obj, layers) {
  obj.traverse((o) => {
    o.layers.mask = layers.mask;
  });
}

const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const POST_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uGrain;
uniform float uVignette;
uniform float uCA;
uniform float uStress;
uniform float uFlash;
uniform float uDesat;
uniform float uDark;
uniform vec3 uTint;
varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  // stress: slow breathing wobble at the edges
  uv += d * r2 * uStress * 0.06 * sin(uTime * 1.7);
  float ca = uCA * (0.4 + r2 * 3.0) + uStress * 0.004;
  vec3 col;
  col.r = texture2D(tDiffuse, uv - d * ca).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv + d * ca).b;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(l), clamp(uDesat, 0.0, 1.0));
  col *= uTint;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // display-space effects
  float vig = smoothstep(0.85, 0.25, length(d * vec2(1.15, 1.0)));
  gl_FragColor.rgb *= mix(1.0 - uVignette, 1.0, vig);
  gl_FragColor.rgb *= 1.0 - uDark;
  float n = hash(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) - 0.5;
  gl_FragColor.rgb += n * uGrain * (0.6 + (1.0 - l) * 0.6);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), uFlash);
}
`;

const CCTV_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uNoise;
uniform float uSignal;
uniform float uGlitch;
uniform float uNight;
varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  // slight barrel distortion
  uv = 0.5 + d * (1.0 + dot(d, d) * 0.18);
  float t = uTime;
  // horizontal tearing when something interferes
  float band = step(0.985 - uGlitch * 0.12, fract(sin(floor(uv.y * 40.0) + floor(t * 12.0)) * 4375.0));
  uv.x += band * (hash(vec2(floor(uv.y * 40.0), floor(t * 20.0))) - 0.5) * (0.03 + uGlitch * 0.12);
  vec3 c = texture2D(tDiffuse, uv).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  // night-vision exposure curve for linear input (cameras have IR gain)
  l = pow(clamp(l * 3.4, 0.0, 1.0), 0.6);
  float n = hash(uv * 600.0 + fract(t * 13.7) * 91.0);
  l = mix(l, n, uGlitch * 0.35);
  l += (n - 0.5) * uNoise * 0.32;
  // scanlines & rolling bar
  l *= 0.92 + 0.08 * sin(uv.y * 520.0);
  l *= 1.0 - 0.12 * smoothstep(0.0, 0.08, abs(fract(uv.y * 0.6 - t * 0.07) - 0.5) - 0.42);
  vec3 tint = mix(vec3(0.82, 1.0, 0.86), vec3(0.75, 0.85, 1.0), uNight);
  vec3 col = vec3(l) * tint;
  // vignette
  col *= smoothstep(0.95, 0.35, length(d * vec2(1.1, 1.0)));
  // no signal -> full static
  float st = hash(uv * 900.0 + floor(t * 30.0));
  col = mix(vec3(st * 0.8), col, uSignal);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) col = vec3(0.0);
  gl_FragColor = vec4(col, 1.0);
}
`;

const PHOTO_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uSeed;
varying vec2 vUv;
float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19 + uSeed);
  return fract((p.x + p.y) * p.x);
}
vec3 aces(vec3 x) {
  const float a = 2.51; const float b = 0.03; const float c = 2.43; const float d = 0.59; const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
void main() {
  vec2 d = vUv - 0.5;
  vec3 c = texture2D(tDiffuse, vUv).rgb * 1.25;
  c = aces(c);
  c = pow(c, vec3(1.0 / 2.2));
  // instant film: warm, lifted blacks, soft vignette
  c = c * vec3(1.04, 0.98, 0.88) + vec3(0.05, 0.04, 0.06);
  c *= smoothstep(0.9, 0.3, length(d));
  c += (hash(vUv * 512.0) - 0.5) * 0.06;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

function fullscreenQuad(fragmentShader, uniforms, toneMapped = false) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: POST_VERT,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return { scene, mat, mesh };
}

export class RenderSystem {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
      preserveDrawingBuffer: false,
    });
    this.renderer = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0x000000, 1);
    this.camOrtho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.dynScale = 1;
    this.frameTimes = [];
    this.dynTimer = 0;
    this.width = 1;
    this.height = 1;
    this.time = 0;

    this.post = fullscreenQuad(POST_FRAG, {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uGrain: { value: 0.045 },
      uVignette: { value: 0.45 },
      uCA: { value: 0.0025 },
      uStress: { value: 0 },
      uFlash: { value: 0 },
      uDesat: { value: 0 },
      uDark: { value: 0 },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
    }, true);
    this.cctvQuad = fullscreenQuad(CCTV_FRAG, {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uNoise: { value: 0.5 },
      uSignal: { value: 1 },
      uGlitch: { value: 0 },
      uNight: { value: 0 },
    });
    this.photoQuad = fullscreenQuad(PHOTO_FRAG, { tDiffuse: { value: null }, uSeed: { value: 0 } });

    this.postRT = null;
    this.cctvCam = new THREE.PerspectiveCamera(60, 4 / 3, 0.05, 80);
    this.photoCam = new THREE.PerspectiveCamera(50, 1, 0.05, 80);
    this.photoRT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, depthBuffer: true });
    this.photoOutRT = new THREE.WebGLRenderTarget(512, 512, { depthBuffer: false });
    this.monitorRT = new THREE.WebGLRenderTarget(320, 240, { depthBuffer: false });
    this.monitorSceneRT = new THREE.WebGLRenderTarget(320, 240, { type: THREE.HalfFloatType });
    this.cctvRT = null;
    this.applySettings();
    window.addEventListener('resize', () => this.resize());
  }

  applySettings() {
    const s = this.settings.values;
    this.renderer.shadowMap.enabled = !!s.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    this.maxScale = s.renderScale;
    if (!s.dynamicResolution) this.dynScale = 1;
    const res = s.cctvRes || 384;
    const h = Math.round(res * 0.75);
    if (!this.cctvRT || this.cctvRT.width !== res) {
      if (this.cctvRT) this.cctvRT.dispose();
      this.cctvRT = new THREE.WebGLRenderTarget(res, h, { type: THREE.HalfFloatType });
      this.cctvRT.texture.minFilter = THREE.LinearFilter;
    }
    this.resize();
  }

  resize() {
    const s = this.settings.values;
    const dpr = Math.min(window.devicePixelRatio || 1, s.maxDpr || 1);
    const scale = clamp(s.renderScale * this.dynScale, 0.35, 2) * dpr;
    const w = Math.max(1, Math.floor(window.innerWidth));
    const h = Math.max(1, Math.floor(window.innerHeight));
    this.renderer.setPixelRatio(scale);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.width = Math.floor(w * scale);
    this.height = Math.floor(h * scale);
    if (s.postFx) {
      const samples = s.msaa ? 4 : 0;
      if (!this.postRT || this.postRT.width !== this.width || this.postRT.height !== this.height || this.postRT.samples !== samples) {
        if (this.postRT) this.postRT.dispose();
        this.postRT = new THREE.WebGLRenderTarget(this.width, this.height, { type: THREE.HalfFloatType, samples });
      }
    } else if (this.postRT) {
      this.postRT.dispose();
      this.postRT = null;
    }
    this.aspect = w / h;
    if (this.onResize) this.onResize(this.aspect);
  }

  // Track frame time and adapt resolution to hold the target frame rate.
  trackFrame(dt) {
    const s = this.settings.values;
    if (!s.dynamicResolution) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 40) this.frameTimes.shift();
    this.dynTimer += dt;
    if (this.dynTimer < 0.75 || this.frameTimes.length < 20) return;
    this.dynTimer = 0;
    const sorted = this.frameTimes.slice().sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length * 0.5)];
    const target = 1 / (s.targetFps || 60);
    let next = this.dynScale;
    if (typical > target * 1.2) next -= 0.08;
    else if (typical < target * 0.85) next += 0.05;
    next = clamp(next, 0.55, 1);
    if (Math.abs(next - this.dynScale) > 0.001) {
      this.dynScale = next;
      this.resize();
    }
  }

  // Main view render (with optional post-processing).
  render(scene, camera, fx) {
    const r = this.renderer;
    const u = this.post.mat.uniforms;
    if (this.postRT) {
      r.setRenderTarget(this.postRT);
      r.render(scene, camera);
      r.setRenderTarget(null);
      u.tDiffuse.value = this.postRT.texture;
      u.uTime.value = this.time;
      u.uStress.value = fx.stress;
      u.uFlash.value = fx.flash;
      u.uDesat.value = fx.desat;
      u.uDark.value = fx.dark;
      u.uGrain.value = fx.grain;
      u.uVignette.value = fx.vignette;
      u.uCA.value = fx.ca;
      r.render(this.post.scene, this.camOrtho);
    } else {
      r.setRenderTarget(null);
      r.render(scene, camera);
    }
  }

  setupCCTVCamera(cam, def, aspect) {
    cam.position.copy(def.pos);
    cam.fov = def.fov;
    cam.aspect = aspect;
    cam.near = 0.05;
    cam.far = 60;
    cam.updateProjectionMatrix();
    cam.lookAt(def.target);
    cam.updateMatrixWorld();
    cam.layers.disableAll();
    cam.layers.enable(0);
    cam.layers.enable(LAYER.CCTV);
    cam.layers.enable(LAYER.CAM_BASE + def.index);
  }

  // Render a security camera into the CCTV target.
  renderCCTVScene(scene, def) {
    const cam = this.cctvCam;
    this.setupCCTVCamera(cam, def, this.cctvRT.width / this.cctvRT.height);
    const r = this.renderer;
    r.setRenderTarget(this.cctvRT);
    r.render(scene, cam);
    r.setRenderTarget(null);
    return cam;
  }

  // Display the CCTV target full-screen with the monitor shader.
  displayCCTV(params) {
    const u = this.cctvQuad.mat.uniforms;
    u.tDiffuse.value = this.cctvRT.texture;
    u.uTime.value = this.time;
    u.uNoise.value = params.noise;
    u.uSignal.value = params.signal;
    u.uGlitch.value = params.glitch;
    u.uNight.value = params.night;
    const r = this.renderer;
    r.setRenderTarget(null);
    r.render(this.cctvQuad.scene, this.camOrtho);
  }

  // Small in-world monitor texture (rendered rarely).
  renderMonitor(scene, def, params) {
    const r = this.renderer;
    const cam = this.cctvCam;
    this.setupCCTVCamera(cam, def, 4 / 3);
    r.setRenderTarget(this.monitorSceneRT);
    r.render(scene, cam);
    const u = this.cctvQuad.mat.uniforms;
    u.tDiffuse.value = this.monitorSceneRT.texture;
    u.uTime.value = this.time;
    u.uNoise.value = params.noise;
    u.uSignal.value = params.signal;
    u.uGlitch.value = params.glitch;
    u.uNight.value = params.night;
    r.setRenderTarget(this.monitorRT);
    r.render(this.cctvQuad.scene, this.camOrtho);
    r.setRenderTarget(null);
    return this.monitorRT.texture;
  }

  // Instant camera: render what the camera sees (layers 0 + PHOTO), process,
  // and return a canvas.
  capturePhoto(scene, fromCamera, flashLight) {
    const cam = this.photoCam;
    cam.position.copy(fromCamera.position);
    cam.quaternion.copy(fromCamera.quaternion);
    cam.fov = Math.min(fromCamera.fov, 55);
    cam.aspect = 1;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    cam.layers.disableAll();
    cam.layers.enable(0);
    cam.layers.enable(LAYER.PHOTO);
    const r = this.renderer;
    const prevFlash = flashLight ? flashLight.intensity : 0;
    if (flashLight) {
      flashLight.position.copy(cam.position);
      flashLight.intensity = 9;
      flashLight.updateMatrixWorld();
    }
    r.setRenderTarget(this.photoRT);
    r.render(scene, cam);
    if (flashLight) flashLight.intensity = prevFlash;
    this.photoQuad.mat.uniforms.tDiffuse.value = this.photoRT.texture;
    this.photoQuad.mat.uniforms.uSeed.value = Math.random() * 10;
    r.setRenderTarget(this.photoOutRT);
    r.render(this.photoQuad.scene, this.camOrtho);
    const w = this.photoOutRT.width;
    const h = this.photoOutRT.height;
    const buf = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(this.photoOutRT, 0, 0, w, h, buf);
    r.setRenderTarget(null);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    // flip vertically (GL origin is bottom-left)
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4;
      img.data.set(buf.subarray(src, src + w * 4), y * w * 4);
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  // Compile shaders for all view types up front to avoid hitches mid-game.
  warmup(scene, camera, cctvDef) {
    try {
      this.renderer.compile(scene, camera);
      this.render(scene, camera, { stress: 0, flash: 0, desat: 0, dark: 0, grain: 0, vignette: 0, ca: 0 });
      if (cctvDef) this.renderCCTVScene(scene, cctvDef);
    } catch (e) {
      console.warn('warmup failed', e);
    }
  }
}
