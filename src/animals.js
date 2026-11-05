// Procedural, stylised animals built from primitives with vertex colours.
// Every visible feature can be restricted to specific "views" (your eyes, the
// instant camera, the security cameras) through object layers, which is how
// impostors betray themselves in photographs and on CCTV.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Materials, shared } from './materials.js';
import { viewMask, setLayersDeep, LAYER } from './renderer.js';
import { clamp, damp, lerp, noise1, hash1, RNG, TAU } from './core.js';

const tmpC = new THREE.Color();

// ---------- geometry helpers ----------
function colorize(geo, hex, fn) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  tmpC.set(hex);
  const pos = geo.attributes.position;
  for (let i = 0; i < n; i++) {
    let c = tmpC;
    if (fn) c = fn(pos.getX(i), pos.getY(i), pos.getZ(i)) || tmpC;
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function ell(rx, ry, rz, ws = 16, hs = 12) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.scale(rx, ry, rz);
  return g;
}

function cap(r, len, rs = 10) {
  return new THREE.CapsuleGeometry(r, len, 4, rs);
}

function cone(r, h, rs = 10) {
  return new THREE.ConeGeometry(r, h, rs);
}

function cyl(r0, r1, h, rs = 10) {
  return new THREE.CylinderGeometry(r0, r1, h, rs);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
function xf(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'XYZ');
  _q.setFromEuler(_e);
  _s.set(sx, sy, sz);
  _p.set(x, y, z);
  _m.compose(_p, _q, _s);
  geo.applyMatrix4(_m);
  return geo;
}

function merge(list) {
  const clean = list.map((g) => {
    const ng = g.index ? g : g;
    for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) ng.deleteAttribute(k);
    return ng;
  });
  const m = mergeGeometries(clean, false);
  for (const g of clean) if (g !== m) g.dispose();
  return m;
}

// Limb between two points (local), as a tapered cylinder.
function limbBetween(a, b, r0, r1, color) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = cyl(r1, r0, len, 6);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return colorize(g, color);
}

// ---------- palettes ----------
const PALETTES = {
  dog: [
    { fur: '#c98d5b', belly: '#f2dcc0', accent: '#8a5a33' },
    { fur: '#2f2a28', belly: '#c9b8a6', accent: '#1a1716' },
    { fur: '#e8c27a', belly: '#f8ead0', accent: '#c99a50' },
    { fur: '#f3efe8', belly: '#ffffff', accent: '#3a3230' },
    { fur: '#8a6a52', belly: '#d8c1a8', accent: '#5a4030' },
    { fur: '#a8a4a0', belly: '#e8e4e0', accent: '#5e5b58' },
  ],
  cat: [
    { fur: '#e3994f', belly: '#f8e2c8', accent: '#b8692b' },
    { fur: '#2a2a2e', belly: '#3a3a40', accent: '#ffffff' },
    { fur: '#8c929e', belly: '#c7ccd6', accent: '#5f6470' },
    { fur: '#f2ece2', belly: '#ffffff', accent: '#d9a46a' },
    { fur: '#b9a48e', belly: '#ece0d2', accent: '#5a4636' },
  ],
  rabbit: [
    { fur: '#f6f2ec', belly: '#ffffff', accent: '#e8c8c0' },
    { fur: '#a98767', belly: '#e8d8c4', accent: '#7a5a40' },
    { fur: '#7f7c80', belly: '#c8c4c8', accent: '#4a474c' },
    { fur: '#e2b27a', belly: '#f8e8d0', accent: '#b8844c' },
  ],
  parrot: [
    { fur: '#58b44c', belly: '#a6d86a', accent: '#e05040', head: '#e8d040' },
    { fur: '#b8bcc2', belly: '#d8dce0', accent: '#f08a3a', head: '#f6e27a' },
    { fur: '#4a9ad8', belly: '#f2d24a', accent: '#2a5aa8', head: '#4a9ad8' },
    { fur: '#7ac65a', belly: '#c8e88a', accent: '#3a8ad8', head: '#7ac65a' },
  ],
  guineapig: [
    { fur: '#e09a52', belly: '#ffffff', accent: '#2a2420' },
    { fur: '#f4efe6', belly: '#ffffff', accent: '#c88a4a' },
    { fur: '#6a5240', belly: '#c8a888', accent: '#f0e8dc' },
    { fur: '#c8b8a4', belly: '#f2ece2', accent: '#8a6a4c' },
  ],
};

const EYE_COLORS = {
  dog: ['#3a2416', '#2a1a10', '#4a3020'],
  cat: ['#7cc04a', '#e0a83a', '#4ab0c8', '#c8d040'],
  rabbit: ['#2a1a14', '#8a2a2a'],
  parrot: ['#f0f0e8'],
  guineapig: ['#1a1412'],
};

export function randomAppearance(species, rng) {
  const pal = rng.pick(PALETTES[species]);
  return {
    species,
    pal,
    eye: rng.pick(EYE_COLORS[species]),
    size: species === 'dog' ? rng.range(0.82, 1.22) : rng.range(0.92, 1.1),
    ears: species === 'dog' ? rng.pick(['floppy', 'pointy', 'floppy']) : species === 'rabbit' ? rng.pick(['up', 'lop']) : 'default',
    pattern: rng.pick(['plain', 'patch', 'socks', 'plain']),
    collar: rng.pick(['#d94a4a', '#4a7ad9', '#3fb27a', '#e0a030', '#b05ad0']),
    seed: Math.floor(rng.next() * 1e9),
  };
}

// ---------- the model ----------
export class AnimalModel {
  constructor(appearance, traits = {}, signs = []) {
    this.app = appearance;
    this.traits = traits;
    this.signs = new Set(signs);
    this.rng = new RNG(appearance.seed);
    this.root = new THREE.Group();
    this.root.name = 'animal';
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.inner = new THREE.Group();
    this.body.add(this.inner);
    this.furEntry = Materials.dynamic('fur', { vertexColors: true, roughness: 0.82, rim: 0.45 });
    this.eyeEntry = Materials.dynamic('eyes', { vertexColors: true, roughness: 0.12, rim: 0.1 });
    this.entries = [this.furEntry, this.eyeEntry];
    this.parts = [];
    this.legs = [];
    this.eyes = [];
    this.extraEyes = [];
    this.ears = [];
    this.anchors = {};
    this.time = this.rng.range(0, 100);
    this.blinkTimer = this.rng.range(1, 4);
    this.blink = 0;
    this.yawn = 0;
    this.yawnTimer = this.rng.range(4, 9);
    this.coughTimer = this.rng.range(2, 6);
    this.cough = 0;
    this.earTwitch = [0, 0];
    this.earTimer = this.rng.range(1, 4);
    this.pose = 'sit';
    this.poseBlend = { sit: 1, stand: 0, lie: 0 };
    this.walkPhase = 0;
    this.speed = 0;
    this.lookTarget = null; // world position the head wants to look at
    this.headYaw = 0;
    this.headPitch = 0;
    this.happy = 0;
    this.viewOverride = null;
    this.mood = 0; // 0 calm, 1 distressed
    this.build();
  }

  get species() {
    return this.app.species;
  }

  fur() {
    return this.app.pal.fur;
  }

  // vertex colour function for the torso pattern
  patternFn(baseY) {
    const pal = this.app.pal;
    const pat = this.app.pattern;
    const belly = new THREE.Color(pal.belly);
    const acc = new THREE.Color(pal.accent);
    const fur = new THREE.Color(pal.fur);
    const seed = this.app.seed % 1000;
    return (x, y, z) => {
      if (y < baseY) return belly;
      if (pat === 'patch') {
        const n = hash1(Math.floor(x * 9 + seed) * 7.1 + Math.floor(z * 7) * 3.3 + Math.floor(y * 8));
        if (n > 0.72) return acc;
      }
      return fur;
    };
  }

  addPart(geo, parent, mat = this.furEntry.mat, opts = {}) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    if (opts.pos) mesh.position.copy(opts.pos);
    parent.add(mesh);
    if (opts.mask) mesh.layers.mask = opts.mask.mask;
    if (!opts.noShell) this.parts.push(mesh);
    return mesh;
  }

  build() {
    const sp = this.app.species;
    const B = {
      dog: () => this.buildDog(),
      cat: () => this.buildCat(),
      rabbit: () => this.buildRabbit(),
      parrot: () => this.buildParrot(),
      guineapig: () => this.buildGuineaPig(),
    }[sp];
    B();
    this.applyTraits();
    this.applySigns();
    const s = this.app.size;
    this.root.scale.setScalar(s);
    // contact shadow blob
    const blobMat = blobMaterial();
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), blobMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.005;
    const r = this.dims.blob;
    blob.scale.set(r * 2, r * 2.6, 1);
    blob.renderOrder = 1;
    this.root.add(blob);
    this.blob = blob;
  }

  // ---------- species ----------
  makeEye(r, irisHex, slit = false) {
    const parts = [];
    parts.push(colorize(xf(ell(r, r, r * 0.6, 14, 10)), irisHex));
    if (slit) parts.push(colorize(xf(ell(r * 0.28, r * 0.85, r * 0.3, 8, 6), 0, 0, r * 0.4), '#0a0a0c'));
    else parts.push(colorize(xf(ell(r * 0.62, r * 0.62, r * 0.3, 10, 8), 0, 0, r * 0.38), '#0b0807'));
    parts.push(colorize(xf(ell(r * 0.3, r * 0.3, r * 0.2, 8, 6), r * 0.32, r * 0.35, r * 0.5), '#ffffff'));
    parts.push(colorize(xf(ell(r * 0.12, r * 0.12, r * 0.1, 6, 4), -r * 0.3, -r * 0.3, r * 0.52), '#ffffff'));
    return merge(parts);
  }

  addEyes(pos, r, iris, slit, sideTurn = 0.25) {
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(pos.x * s, pos.y, pos.z);
      g.rotation.y = s * sideTurn;
      const mesh = new THREE.Mesh(this.makeEye(r, iris, slit), this.eyeEntry.mat);
      g.add(mesh);
      // infrared eyeshine: animal eyes glow on the security cameras
      const shine = new THREE.Mesh(eyeshineGeometry(), eyeshineMaterial());
      shine.scale.setScalar(r * 0.7);
      shine.position.set(0, 0, r * 0.62);
      shine.userData.eyeshine = true;
      g.add(shine);
      this.head.add(g);
      this.eyes.push(g);
      this.parts.push(mesh);
    }
    this.anchors.eye = pos.clone();
    this.anchors.eyeR = r;
  }

  addLeg(x, y, z, r, len, color, pawColor, front) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const g = merge([
      colorize(xf(cap(r, len), 0, -len / 2 - r * 0.2, 0), color),
      colorize(xf(ell(r * 1.25, r * 0.8, r * 1.5), 0, -len - r * 0.5, r * 0.3), pawColor),
    ]);
    this.addPart(g, pivot);
    this.inner.add(pivot);
    this.legs.push({ pivot, front, side: Math.sign(x), len: len + r * 1.2 });
    return pivot;
  }

  buildDog() {
    const pal = this.app.pal;
    const socks = this.app.pattern === 'socks';
    this.dims = { hip: 0.3, hipZ: -0.17, shoulderZ: 0.17, legLen: 0.3, headY: 0.5, blob: 0.3, torsoR: 0.16, kind: 'quad' };
    this.inner.position.set(0, -0.3, 0.17);
    const torso = colorize(ell(0.17, 0.16, 0.31), pal.fur, this.patternFn(-0.08));
    xf(torso, 0, 0.36, 0);
    this.addPart(torso, this.inner);
    this.anchors.torso = new THREE.Vector3(0, 0.36, 0);
    this.anchors.flank = new THREE.Vector3(0.15, 0.38, -0.02);
    // collar
    const collar = colorize(new THREE.TorusGeometry(0.105, 0.018, 6, 16), this.app.collar);
    xf(collar, 0, 0.47, 0.22, 1.25, 0, 0);
    const tag = colorize(xf(cyl(0.02, 0.02, 0.006, 10), 0, 0.39, 0.29, 1.3, 0, 0), '#e8c84a');
    this.addPart(merge([collar, tag]), this.inner);
    const legC = pal.fur;
    const paw = socks ? '#f6f2ec' : pal.fur;
    this.addLeg(-0.09, 0.3, 0.17, 0.05, 0.2, legC, paw, true);
    this.addLeg(0.09, 0.3, 0.17, 0.05, 0.2, legC, paw, true);
    this.addLeg(-0.1, 0.3, -0.19, 0.055, 0.19, legC, paw, false);
    this.addLeg(0.1, 0.3, -0.19, 0.055, 0.19, legC, paw, false);
    // tail
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.44, -0.28);
    this.addPart(colorize(xf(cap(0.03, 0.17), 0, 0.09, -0.02, -0.5, 0, 0), pal.fur), this.tail);
    this.inner.add(this.tail);
    // head
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.5, 0.25);
    this.inner.add(this.neck);
    this.head = new THREE.Group();
    this.neck.add(this.head);
    const head = [
      colorize(xf(ell(0.15, 0.14, 0.14), 0, 0.07, 0.04), pal.fur),
      colorize(xf(ell(0.08, 0.065, 0.1), 0, 0.02, 0.16), pal.belly),
    ];
    if (!this.signs.has('noMouth')) head.push(colorize(xf(ell(0.034, 0.025, 0.025), 0, 0.06, 0.255), '#2a1e1e'));
    head.push(colorize(xf(ell(0.035, 0.022, 0.012), -0.085, 0.02, 0.12, 0, -0.6, 0), '#f4a0a8'));
    head.push(colorize(xf(ell(0.035, 0.022, 0.012), 0.085, 0.02, 0.12, 0, 0.6, 0), '#f4a0a8'));
    this.headMesh = this.addPart(merge(head), this.head);
    this.anchors.headR = 0.15;
    this.anchors.headC = new THREE.Vector3(0, 0.07, 0.04);
    this.anchors.muzzle = new THREE.Vector3(0, 0.02, 0.2);
    this.buildJaw(new THREE.Vector3(0, -0.02, 0.15), 0.055, 0.08, pal.belly);
    if (!this.signs.has('noEyes')) this.addEyes(new THREE.Vector3(0.068, 0.11, 0.155), 0.034, this.app.eye, false);
    else this.anchors.eye = new THREE.Vector3(0.068, 0.11, 0.155);
    // ears
    const earC = pal.accent;
    const ears = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      if (this.app.ears === 'floppy') {
        pivot.position.set(0.11 * s, 0.16, 0.02);
        const g = colorize(xf(ell(0.05, 0.1, 0.025), 0, -0.08, 0, 0, 0, 0.25 * s), earC);
        this.addPart(g, pivot);
      } else {
        pivot.position.set(0.075 * s, 0.19, 0.02);
        const g = colorize(xf(cone(0.05, 0.12, 4), 0, 0.05, 0, 0, Math.PI / 4, -0.25 * s), earC);
        this.addPart(g, pivot);
      }
      this.head.add(pivot);
      ears.push(pivot);
    }
    this.ears = ears;
    this.anchors.ear = new THREE.Vector3(0.1, 0.18, 0.02);
  }

  buildCat() {
    const pal = this.app.pal;
    this.dims = { hip: 0.22, hipZ: -0.13, shoulderZ: 0.13, legLen: 0.22, headY: 0.38, blob: 0.22, torsoR: 0.12, kind: 'quad' };
    this.inner.position.set(0, -0.22, 0.13);
    const torso = colorize(ell(0.12, 0.12, 0.23), pal.fur, this.patternFn(-0.06));
    xf(torso, 0, 0.27, 0);
    this.addPart(torso, this.inner);
    this.anchors.torso = new THREE.Vector3(0, 0.27, 0);
    this.anchors.flank = new THREE.Vector3(0.11, 0.28, -0.02);
    const collar = colorize(new THREE.TorusGeometry(0.075, 0.012, 6, 16), this.app.collar);
    xf(collar, 0, 0.35, 0.17, 1.25, 0, 0);
    this.addPart(collar, this.inner);
    const paw = this.app.pattern === 'socks' ? '#f6f2ec' : pal.fur;
    this.addLeg(-0.06, 0.22, 0.13, 0.038, 0.15, pal.fur, paw, true);
    this.addLeg(0.06, 0.22, 0.13, 0.038, 0.15, pal.fur, paw, true);
    this.addLeg(-0.065, 0.22, -0.14, 0.042, 0.14, pal.fur, paw, false);
    this.addLeg(0.065, 0.22, -0.14, 0.042, 0.14, pal.fur, paw, false);
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.32, -0.21);
    this.addPart(
      merge([
        colorize(xf(cap(0.022, 0.16), 0, 0.06, -0.06, -0.9, 0, 0), pal.fur),
        colorize(xf(cap(0.02, 0.14), 0, 0.2, -0.13, -0.2, 0, 0), pal.accent),
      ]),
      this.tail
    );
    this.inner.add(this.tail);
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.37, 0.19);
    this.inner.add(this.neck);
    this.head = new THREE.Group();
    this.neck.add(this.head);
    const head = [colorize(xf(ell(0.125, 0.11, 0.11), 0, 0.06, 0.02), pal.fur), colorize(xf(ell(0.055, 0.04, 0.04), 0, 0.015, 0.105), pal.belly)];
    if (!this.signs.has('noMouth')) head.push(colorize(xf(ell(0.014, 0.01, 0.01), 0, 0.04, 0.142), '#e88a96'));
    head.push(colorize(xf(ell(0.03, 0.02, 0.01), -0.07, 0.02, 0.085, 0, -0.6, 0), '#f4a0a8'));
    head.push(colorize(xf(ell(0.03, 0.02, 0.01), 0.07, 0.02, 0.085, 0, 0.6, 0), '#f4a0a8'));
    if (!this.signs.has('noMouth')) {
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          head.push(colorize(xf(new THREE.BoxGeometry(0.11, 0.002, 0.002), 0.08 * s, 0.025 - i * 0.012, 0.12, 0, -0.15 * s, (i - 1) * 0.12 * s), '#f8f8f4'));
        }
      }
    }
    this.headMesh = this.addPart(merge(head), this.head);
    this.anchors.headR = 0.125;
    this.anchors.headC = new THREE.Vector3(0, 0.06, 0.02);
    this.anchors.muzzle = new THREE.Vector3(0, 0.015, 0.12);
    this.buildJaw(new THREE.Vector3(0, -0.01, 0.1), 0.04, 0.05, pal.belly);
    if (!this.signs.has('noEyes')) this.addEyes(new THREE.Vector3(0.055, 0.085, 0.112), 0.03, this.app.eye, true, 0.3);
    else this.anchors.eye = new THREE.Vector3(0.055, 0.085, 0.112);
    const ears = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.065 * s, 0.14, 0.0);
      const g = merge([
        colorize(xf(cone(0.045, 0.09, 4), 0, 0.04, 0, 0, Math.PI / 4, -0.3 * s), pal.fur),
        colorize(xf(cone(0.028, 0.06, 4), 0, 0.032, 0.012, 0, Math.PI / 4, -0.3 * s), '#f2a6ae'),
      ]);
      this.addPart(g, pivot);
      this.head.add(pivot);
      ears.push(pivot);
    }
    this.ears = ears;
    this.anchors.ear = new THREE.Vector3(0.065, 0.15, 0.0);
  }

  buildRabbit() {
    const pal = this.app.pal;
    this.dims = { hip: 0.12, hipZ: -0.08, shoulderZ: 0.08, legLen: 0.08, headY: 0.3, blob: 0.2, torsoR: 0.14, kind: 'rabbit' };
    this.inner.position.set(0, -0.12, 0.08);
    const torso = colorize(ell(0.145, 0.14, 0.19), pal.fur, this.patternFn(-0.06));
    xf(torso, 0, 0.17, -0.02);
    this.addPart(torso, this.inner);
    this.anchors.torso = new THREE.Vector3(0, 0.17, -0.02);
    this.anchors.flank = new THREE.Vector3(0.13, 0.18, -0.04);
    this.addLeg(-0.05, 0.1, 0.1, 0.028, 0.04, pal.fur, pal.belly, true);
    this.addLeg(0.05, 0.1, 0.1, 0.028, 0.04, pal.fur, pal.belly, true);
    // big hind feet
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.085 * s, 0.07, -0.06);
      this.addPart(colorize(xf(ell(0.045, 0.035, 0.1), 0, -0.04, 0.03), pal.fur), pivot);
      this.inner.add(pivot);
      this.legs.push({ pivot, front: false, side: s, len: 0.07, foot: true });
    }
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.17, -0.2);
    this.addPart(colorize(ell(0.045, 0.045, 0.04), '#ffffff'), this.tail);
    this.inner.add(this.tail);
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.27, 0.13);
    this.inner.add(this.neck);
    this.head = new THREE.Group();
    this.neck.add(this.head);
    const head = [colorize(xf(ell(0.105, 0.095, 0.1), 0, 0.03, 0.02), pal.fur), colorize(xf(ell(0.045, 0.035, 0.035), 0, -0.005, 0.09), pal.belly)];
    if (!this.signs.has('noMouth')) head.push(colorize(xf(ell(0.012, 0.009, 0.008), 0, 0.02, 0.122), '#e88a96'));
    head.push(colorize(xf(ell(0.025, 0.017, 0.01), -0.06, 0.0, 0.08, 0, -0.6, 0), '#f4a0a8'));
    head.push(colorize(xf(ell(0.025, 0.017, 0.01), 0.06, 0.0, 0.08, 0, 0.6, 0), '#f4a0a8'));
    this.headMesh = this.addPart(merge(head), this.head);
    this.anchors.headR = 0.105;
    this.anchors.headC = new THREE.Vector3(0, 0.03, 0.02);
    this.anchors.muzzle = new THREE.Vector3(0, -0.005, 0.1);
    this.buildJaw(new THREE.Vector3(0, -0.025, 0.08), 0.03, 0.035, pal.belly);
    if (!this.signs.has('noEyes')) this.addEyes(new THREE.Vector3(0.062, 0.06, 0.095), 0.026, this.app.eye, false, 0.45);
    else this.anchors.eye = new THREE.Vector3(0.062, 0.06, 0.095);
    const ears = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.035 * s, 0.1, -0.01);
      const lop = this.app.ears === 'lop';
      const g = merge([
        colorize(xf(ell(0.032, 0.11, 0.018), 0, 0.1, 0, 0, 0, 0), pal.fur),
        colorize(xf(ell(0.02, 0.085, 0.01), 0, 0.1, 0.01, 0, 0, 0), '#f2b6be'),
      ]);
      const m = this.addPart(g, pivot);
      if (lop) {
        pivot.rotation.z = -s * 2.1;
        pivot.position.set(0.07 * s, 0.07, -0.01);
      } else pivot.rotation.z = -s * 0.15;
      m.userData.baseRotZ = pivot.rotation.z;
      this.head.add(pivot);
      ears.push(pivot);
    }
    this.ears = ears;
    this.anchors.ear = new THREE.Vector3(0.035, 0.12, -0.01);
  }

  buildParrot() {
    const pal = this.app.pal;
    this.dims = { hip: 0.1, hipZ: 0, shoulderZ: 0, legLen: 0.08, headY: 0.34, blob: 0.14, torsoR: 0.08, kind: 'bird' };
    this.inner.position.set(0, 0, 0);
    const body = colorize(ell(0.085, 0.13, 0.085), pal.fur, (x, y, z) => (z > 0.03 && y < 0.02 ? new THREE.Color(pal.belly) : new THREE.Color(pal.fur)));
    xf(body, 0, 0.21, 0, -0.25, 0, 0);
    this.addPart(body, this.inner);
    this.anchors.torso = new THREE.Vector3(0, 0.21, 0);
    this.anchors.flank = new THREE.Vector3(0.075, 0.22, 0);
    // wings
    for (const s of [-1, 1]) {
      this.addPart(colorize(xf(ell(0.025, 0.11, 0.07), 0.075 * s, 0.21, -0.02, -0.25, 0, 0.08 * s), pal.accent), this.inner);
    }
    // tail
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.12, -0.06);
    this.addPart(colorize(xf(new THREE.BoxGeometry(0.06, 0.012, 0.17), 0, -0.03, -0.07, 0.6, 0, 0), pal.accent), this.tail);
    this.inner.add(this.tail);
    // legs/feet
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.03 * s, 0.1, 0.01);
      this.addPart(
        merge([
          colorize(xf(cyl(0.008, 0.008, 0.08, 6), 0, -0.04, 0), '#8a8a90'),
          colorize(xf(ell(0.025, 0.008, 0.03), 0, -0.085, 0.01), '#8a8a90'),
        ]),
        pivot
      );
      this.inner.add(pivot);
      this.legs.push({ pivot, front: s > 0, side: s, len: 0.09 });
    }
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.33, 0.035);
    this.inner.add(this.neck);
    this.head = new THREE.Group();
    this.neck.add(this.head);
    const head = [colorize(xf(ell(0.07, 0.068, 0.07), 0, 0.02, 0), pal.head || pal.fur)];
    if (pal.accent && this.app.pal.fur === '#b8bcc2') head.push(colorize(xf(ell(0.022, 0.022, 0.01), -0.055, 0.0, 0.035, 0, -0.9, 0), '#f08a3a'), colorize(xf(ell(0.022, 0.022, 0.01), 0.055, 0.0, 0.035, 0, 0.9, 0), '#f08a3a'));
    // crest
    for (let i = 0; i < 3; i++) head.push(colorize(xf(cone(0.012, 0.07, 5), 0, 0.1 + i * 0.005, -0.01 - i * 0.015, -0.5 - i * 0.2, 0, 0), pal.head || pal.fur));
    this.headMesh = this.addPart(merge(head), this.head);
    if (!this.signs.has('noMouth')) {
      this.addPart(merge([colorize(xf(cone(0.026, 0.06, 8), 0, -0.005, 0.075, 1.9, 0, 0), '#3a3434'), colorize(xf(ell(0.028, 0.02, 0.02), 0, 0.012, 0.06), '#e8d8c8')]), this.head);
    }
    this.anchors.headR = 0.07;
    this.anchors.headC = new THREE.Vector3(0, 0.02, 0);
    this.anchors.muzzle = new THREE.Vector3(0, 0, 0.07);
    this.jaw = null;
    if (!this.signs.has('noEyes')) this.addEyes(new THREE.Vector3(0.055, 0.035, 0.04), 0.018, '#0a0808', false, 0.9);
    else this.anchors.eye = new THREE.Vector3(0.055, 0.035, 0.04);
    this.ears = [];
    this.anchors.ear = new THREE.Vector3(0.05, 0.07, 0.0);
  }

  buildGuineaPig() {
    const pal = this.app.pal;
    this.dims = { hip: 0.06, hipZ: -0.08, shoulderZ: 0.08, legLen: 0.04, headY: 0.15, blob: 0.18, torsoR: 0.09, kind: 'small' };
    this.inner.position.set(0, -0.06, 0.08);
    const acc = new THREE.Color(pal.accent);
    const fur = new THREE.Color(pal.fur);
    const belly = new THREE.Color(pal.belly);
    const seed = this.app.seed % 97;
    const torso = colorize(ell(0.11, 0.09, 0.16), pal.fur, (x, y, z) => {
      if (y < -0.03) return belly;
      const n = Math.sin(z * 18 + seed) + Math.sin(x * 14 - seed);
      return n > 0.7 ? acc : n < -1.0 ? belly : fur;
    });
    xf(torso, 0, 0.1, -0.02);
    this.addPart(torso, this.inner);
    this.anchors.torso = new THREE.Vector3(0, 0.1, -0.02);
    this.anchors.flank = new THREE.Vector3(0.1, 0.1, -0.03);
    for (const [x, z] of [[-0.06, 0.07], [0.06, 0.07], [-0.065, -0.1], [0.065, -0.1]]) {
      this.addLeg(x, 0.05, z, 0.017, 0.015, pal.fur, '#f0c8c0', z > 0);
    }
    this.tail = null;
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.12, 0.11);
    this.inner.add(this.neck);
    this.head = new THREE.Group();
    this.neck.add(this.head);
    const head = [colorize(xf(ell(0.08, 0.07, 0.075), 0, 0.0, 0.02), pal.fur), colorize(xf(ell(0.04, 0.032, 0.03), 0, -0.02, 0.075), pal.belly)];
    if (!this.signs.has('noMouth')) head.push(colorize(xf(ell(0.01, 0.007, 0.007), 0, -0.005, 0.105), '#e88a96'));
    head.push(colorize(xf(ell(0.02, 0.014, 0.008), -0.05, -0.02, 0.06, 0, -0.6, 0), '#f4a0a8'));
    head.push(colorize(xf(ell(0.02, 0.014, 0.008), 0.05, -0.02, 0.06, 0, 0.6, 0), '#f4a0a8'));
    this.headMesh = this.addPart(merge(head), this.head);
    this.anchors.headR = 0.08;
    this.anchors.headC = new THREE.Vector3(0, 0, 0.02);
    this.anchors.muzzle = new THREE.Vector3(0, -0.02, 0.08);
    this.buildJaw(new THREE.Vector3(0, -0.04, 0.06), 0.025, 0.03, pal.belly);
    if (!this.signs.has('noEyes')) this.addEyes(new THREE.Vector3(0.06, 0.018, 0.065), 0.02, '#120e0c', false, 0.75);
    else this.anchors.eye = new THREE.Vector3(0.06, 0.018, 0.065);
    const ears = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.055 * s, 0.055, -0.01);
      this.addPart(colorize(xf(ell(0.025, 0.02, 0.008), 0, 0.01, 0, 0, s * 0.8, s * 0.6), '#d8a898'), pivot);
      this.head.add(pivot);
      ears.push(pivot);
    }
    this.ears = ears;
    this.anchors.ear = new THREE.Vector3(0.055, 0.06, -0.01);
  }

  // Lower jaw with tongue (and optional teeth) that can open.
  buildJaw(pos, w, l, color) {
    if (this.signs.has('noMouth')) {
      this.jaw = null;
      return;
    }
    const jaw = new THREE.Group();
    jaw.position.copy(pos);
    const parts = [colorize(xf(ell(w, w * 0.45, l), 0, -0.004, l * 0.6), color), colorize(xf(ell(w * 0.8, w * 0.25, l * 0.85), 0, w * 0.2, l * 0.55), '#7a2a34')];
    parts.push(colorize(xf(ell(w * 0.55, w * 0.18, l * 0.7), 0, w * 0.32, l * 0.62), '#f08090'));
    if (!this.signs.has('teeth')) {
      // two small fangs on the upper jaw (always there, only seen when open)
      parts.push(colorize(xf(cone(w * 0.12, w * 0.35, 5), -w * 0.55, w * 0.55, l * 1.1, Math.PI, 0, 0), '#fbf8f0'));
      parts.push(colorize(xf(cone(w * 0.12, w * 0.35, 5), w * 0.55, w * 0.55, l * 1.1, Math.PI, 0, 0), '#fbf8f0'));
    }
    const mesh = this.addPart(merge(parts), jaw);
    this.head.add(jaw);
    this.jaw = jaw;
    this.anchors.jaw = pos.clone();
    this.anchors.jawW = w;
    this.anchors.jawL = l;
    return mesh;
  }

  // ---------- illness & benign traits ----------
  applyTraits() {
    const t = this.traits;
    const A = this.anchors;
    if (t.wound) {
      const g = merge([
        colorize(xf(ell(0.055, 0.03, 0.08), 0, 0, 0), '#7a1e22'),
        colorize(xf(ell(0.03, 0.012, 0.06), 0, 0.012, 0), '#c03038'),
      ]);
      const m = this.addPart(g, this.inner);
      m.position.copy(A.flank);
      m.rotation.z = -1.2;
      m.scale.set(1, 0.7, 1);
    }
    if (t.bandage && this.legs.length) {
      const leg = this.legs[0].pivot;
      const r = this.dims.torsoR * 0.42;
      const g = colorize(xf(cyl(r, r, 0.07, 10), 0, -this.legs[0].len * 0.5, 0), '#f6f4ee');
      this.addPart(g, leg);
    }
    if (t.cone) {
      const r = (A.headR || 0.1) * 1.55;
      const g = colorize(new THREE.CylinderGeometry(r * 1.25, r * 0.55, r * 0.95, 18, 1, true), '#e8f2f8');
      const mat = this._coneMat || (this._coneMat = Materials.dynamic('cone', { color: 0xdcecf4, transparent: true, opacity: 0.55, side: THREE.DoubleSide, roughness: 0.2 }));
      if (!this.entries.includes(mat)) this.entries.push(mat);
      const m = new THREE.Mesh(g, mat.mat);
      m.rotation.x = Math.PI / 2;
      m.position.set(0, A.headC.y - 0.01, A.headC.z + r * 0.15);
      this.neck.add(m);
    }
    if (t.swelling) {
      const r = (A.headR || 0.1) * 0.55;
      for (const s of [-1, 1]) {
        const g = colorize(ell(r, r * 0.8, r * 0.9), this.app.pal.belly);
        const m = this.addPart(g, this.head);
        m.position.set(A.muzzle.x + s * r * 0.75, A.muzzle.y - r * 0.15, A.muzzle.z - r * 0.4);
      }
    }
    if (t.drool && A.muzzle) {
      const g = colorize(ell(0.012, 0.03, 0.012), '#cfe6f2');
      const mat = this._droolMat || (this._droolMat = Materials.dynamic('drool', { color: 0xd8eef8, transparent: true, opacity: 0.75, roughness: 0.05 }));
      if (!this.entries.includes(mat)) this.entries.push(mat);
      const m = new THREE.Mesh(g, mat.mat);
      m.position.set(A.muzzle.x + 0.02, A.muzzle.y - 0.05, A.muzzle.z);
      this.head.add(m);
      this.droolMesh = m;
    }
  }

  // ---------- anomaly signs ----------
  applySigns() {
    const S = this.signs;
    const A = this.anchors;
    const EYE_CCTV = viewMask(true, false, true);
    const PHOTO = viewMask(false, true, false);
    const CCTV = viewMask(false, false, true);
    const EYE_PHOTO = viewMask(true, true, false);
    const eyeR = A.eyeR || 0.03;
    if (S.has('extraEyes')) {
      const spots = [
        [0, A.eye.y + eyeR * 2.2, A.eye.z - eyeR * 0.3, 1],
        [-A.eye.x * 1.55, A.eye.y + eyeR * 1.4, A.eye.z - eyeR * 1.5, 0.8],
        [A.eye.x * 1.5, A.eye.y - eyeR * 1.7, A.eye.z - eyeR * 0.6, 0.7],
      ];
      for (const [x, y, z, s] of spots) {
        const g = new THREE.Group();
        g.position.set(x, y, z);
        g.rotation.y = x * 4;
        const m = new THREE.Mesh(this.makeEye(eyeR * s, this.app.eye, this.species === 'cat'), this.eyeEntry.mat);
        g.add(m);
        this.head.add(g);
        this.parts.push(m);
        this.extraEyes.push({ g, phase: this.rng.range(0, 5) });
      }
    }
    if (S.has('extraEyeSmall')) {
      const g = new THREE.Group();
      g.position.set(A.eye.x * 1.7, A.eye.y + eyeR * 1.1, A.eye.z - eyeR * 2.2);
      g.rotation.y = 0.9;
      const m = new THREE.Mesh(this.makeEye(eyeR * 0.6, this.app.eye), this.eyeEntry.mat);
      g.add(m);
      this.head.add(g);
      this.parts.push(m);
      this.extraEyes.push({ g, phase: 1.3 });
    }
    if (S.has('mismatchedEyes') && this.eyes.length === 2) {
      this.eyes[1].scale.setScalar(1.75);
      this.eyes[1].position.y += eyeR * 0.4;
    }
    if (S.has('bigHead')) {
      this.head.scale.setScalar(1.5);
    }
    if (S.has('longNeck')) {
      const extra = this.dims.torsoR * 1.6;
      const neckGeo = colorize(xf(cyl(this.dims.torsoR * 0.38, this.dims.torsoR * 0.5, extra, 10), 0, extra / 2, 0), this.app.pal.fur);
      const nm = this.addPart(neckGeo, this.neck);
      nm.position.set(0, -0.02, 0);
      this.head.position.y += extra;
      this.head.position.z += extra * 0.15;
    }
    if (S.has('teeth') && this.jaw) {
      const w = A.jawW;
      const l = A.jawL;
      const teeth = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 8 - 0.5) * 2.2;
        const x = Math.sin(a) * w * 0.85;
        const z = l * 1.05 + Math.cos(a) * l * 0.25 - l * 0.25;
        teeth.push(colorize(xf(new THREE.BoxGeometry(w * 0.2, w * 0.32, w * 0.08), x, w * 0.5, z, 0, a, 0), '#f6f0e0'));
        teeth.push(colorize(xf(new THREE.BoxGeometry(w * 0.2, w * 0.32, w * 0.08), x, w * 0.1, z, 0, a, 0), '#ece4d0'));
      }
      teeth.push(colorize(xf(ell(w * 1.05, w * 0.22, l * 0.5), 0, w * 0.32, l * 0.8), '#b04050'));
      this.addPart(merge(teeth), this.jaw);
    }
    if (S.has('photoEars')) {
      for (const e of this.ears) setLayersDeep(e, EYE_CCTV);
      // alternate ears seen only by the camera
      const alt = this.rng.pick(['long', 'human', 'spikes']);
      for (const s of [-1, 1]) {
        let g;
        if (alt === 'long') g = colorize(xf(ell(0.03, 0.15, 0.015), 0, 0.14, 0, 0, 0, -0.25 * s), this.app.pal.accent);
        else if (alt === 'human') g = colorize(xf(ell(0.02, 0.04, 0.012), 0, 0, 0, 0, s * 1.2, 0), '#e8b8a0');
        else g = merge([0, 1, 2].map((i) => colorize(xf(cone(0.012, 0.12 + i * 0.03, 5), (i - 1) * 0.02, 0.07, 0, (i - 1) * 0.3, 0, -0.5 * s), '#2a2626')));
        const m = this.addPart(g, this.head, this.furEntry.mat, { noShell: true });
        m.position.set(A.ear.x * s * (alt === 'human' ? 1.35 : 1), A.ear.y - (alt === 'human' ? 0.07 : 0), A.ear.z);
        m.layers.mask = PHOTO.mask;
      }
    }
    if (S.has('photoEyes')) {
      for (const e of this.eyes) setLayersDeep(e, EYE_CCTV);
      const kind = this.rng.pick(['void', 'white', 'many']);
      for (const s of [-1, 1]) {
        let g;
        if (kind === 'void') g = merge([colorize(ell(eyeR * 1.3, eyeR * 1.5, eyeR * 0.6), '#000000'), colorize(xf(ell(eyeR * 0.12, eyeR * 0.12, eyeR * 0.1), 0, 0, eyeR * 0.55), '#ffffff')]);
        else if (kind === 'white') g = colorize(ell(eyeR * 1.15, eyeR * 1.15, eyeR * 0.65), '#f4f4f0');
        else {
          const ps = [colorize(ell(eyeR * 1.1, eyeR * 1.1, eyeR * 0.6), '#d8c8a0')];
          for (let i = 0; i < 5; i++) ps.push(colorize(xf(ell(eyeR * 0.22, eyeR * 0.22, eyeR * 0.2), Math.cos(i * 1.3) * eyeR * 0.6, Math.sin(i * 1.3) * eyeR * 0.6, eyeR * 0.5), '#050505'));
          g = merge(ps);
        }
        const m = new THREE.Mesh(g, this.eyeEntry.mat);
        m.position.set(A.eye.x * s, A.eye.y, A.eye.z);
        m.rotation.y = s * 0.3;
        m.layers.mask = PHOTO.mask;
        this.head.add(m);
      }
    }
    if (S.has('photoStatic')) {
      const r = (A.headR || 0.1) * 1.18;
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), glitchMaterial());
      m.position.copy(A.headC);
      m.position.z += r * 0.15;
      m.layers.mask = PHOTO.mask;
      this.head.add(m);
    }
    if (S.has('camLimbs')) {
      for (const l of this.legs) setLayersDeep(l.pivot, EYE_PHOTO);
      const T = A.torso;
      const sp = this.dims.torsoR;
      const col = this.app.pal.accent;
      const parts = [];
      for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
        const a = new THREE.Vector3(T.x + sx * sp * 0.6, T.y - sp * 0.3, T.z + sz * sp * 0.9);
        const k = new THREE.Vector3(T.x + sx * sp * 3.2, T.y + sp * 2.2, T.z + sz * sp * 2.6);
        const f = new THREE.Vector3(T.x + sx * sp * 4.6, -0.95 / this.app.size, T.z + sz * sp * 3.8);
        parts.push(limbBetween(a, k, sp * 0.16, sp * 0.1, col));
        parts.push(limbBetween(k, f, sp * 0.1, sp * 0.05, col));
      }
      const m = new THREE.Mesh(merge(parts), this.furEntry.mat);
      m.layers.mask = CCTV.mask;
      this.inner.add(m);
    }
    if (S.has('camSilhouette')) {
      const black = shellMaterial();
      for (const p of this.parts.slice()) {
        const s = new THREE.Mesh(p.geometry, black);
        s.scale.setScalar(1.12);
        s.layers.mask = CCTV.mask;
        p.add(s);
      }
      // tall shadow behind it
      const shadow = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 1.1, 4, 10), black);
      shadow.position.set(0, 0.75, -0.25);
      shadow.layers.mask = CCTV.mask;
      this.inner.add(shadow);
      for (const s of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.5, 8, 6), Materials.basic('silEye', { color: 0xffffff }));
        e.position.set(A.eye.x * s, A.eye.y, A.eye.z + eyeR);
        e.layers.mask = CCTV.mask;
        this.head.add(e);
      }
    }
    // eyeshine is only ever visible to the security cameras
    const cctvOnly = viewMask(false, false, true).mask;
    this.root.traverse((o) => {
      if (o.userData.eyeshine) o.layers.mask = cctvOnly;
    });
    this.followCam = S.has('camFollow');
    this.twitch = S.has('twitch');
    this.still = S.has('still');
  }

  // ---------- animation ----------
  setPose(p) {
    this.pose = p;
  }

  // Head tracking target (world space) or null.
  lookAt(v) {
    this.lookTarget = v;
  }

  update(dt, ctx = {}) {
    this.time += dt;
    const t = this.time;
    const tr = this.traits;
    const still = this.still;
    // pose blending (frame-rate independent)
    for (const k of Object.keys(this.poseBlend)) {
      const target = this.pose === k || (this.pose === 'walk' && k === 'stand') ? 1 : 0;
      this.poseBlend[k] = damp(this.poseBlend[k], target, 6, dt);
    }
    const lethargic = !!tr.lethargic;
    const pb = this.poseBlend;
    const d = this.dims;
    // breathing
    const breathRate = tr.pant || this.mood > 0.6 ? 7 : lethargic ? 1.4 : 2.2;
    const breath = still ? 0 : Math.sin(t * breathRate) * (tr.pant ? 0.035 : 0.02);
    this.inner.scale.set(1 + breath * 0.6, 1 + breath, 1 + breath * 0.3);

    // quadruped posing
    let bodyY = 0;
    let pitch = 0;
    const walking = this.pose === 'walk' && this.speed > 0.05;
    if (d.kind === 'quad') {
      const sitPitch = 0.62;
      pitch = pb.sit * sitPitch;
      bodyY = d.hip * (pb.stand + pb.lie * 0.45) + pb.sit * d.hip * 0.38;
      this.body.position.set(0, bodyY, d.hipZ);
      this.body.rotation.x = -pitch;
      this.inner.position.z = -d.hipZ;
      this.inner.position.y = -d.hip;
      for (const l of this.legs) {
        let a = 0;
        if (l.front) a = pitch - pb.lie * 1.3;
        else a = pitch * 1.0 - pb.sit * 1.5 - pb.lie * 1.25;
        if (walking) {
          const ph = this.walkPhase + (l.front ? 0 : Math.PI) + (l.side > 0 ? Math.PI : 0);
          let swing = Math.sin(ph) * 0.55;
          if (tr.limp && l.front && l.side > 0) swing = -0.6;
          a += swing * pb.stand;
        } else if (tr.limp && l.front && l.side > 0) {
          a -= 0.45;
        }
        l.pivot.rotation.x = a;
      }
      if (walking) {
        const bob = Math.abs(Math.sin(this.walkPhase)) * 0.02 * (tr.limp ? 2 : 1);
        this.body.position.y += bob;
      }
    } else if (d.kind === 'rabbit' || d.kind === 'small') {
      this.body.position.set(0, d.hip, d.hipZ);
      this.inner.position.set(0, -d.hip, -d.hipZ);
      const hop = walking ? Math.max(0, Math.sin(this.walkPhase)) : 0;
      this.body.position.y += (d.kind === 'rabbit' ? hop * 0.08 : hop * 0.012) - pb.lie * 0.03;
      this.body.rotation.x = d.kind === 'rabbit' ? -hop * 0.2 : 0;
      for (const l of this.legs) {
        l.pivot.rotation.x = walking ? Math.sin(this.walkPhase * (d.kind === 'small' ? 1 : 1) + (l.front ? 0 : 1.5)) * (d.kind === 'small' ? 0.7 : 0.4) : 0;
      }
    } else if (d.kind === 'bird') {
      this.body.position.set(0, 0, 0);
      this.body.rotation.z = walking ? Math.sin(this.walkPhase) * 0.18 : 0;
      this.body.rotation.x = 0;
      for (const l of this.legs) l.pivot.rotation.x = walking ? Math.sin(this.walkPhase + (l.side > 0 ? Math.PI : 0)) * 0.5 : 0;
      this.body.position.y = walking ? Math.abs(Math.sin(this.walkPhase)) * 0.02 : 0;
    }
    if (walking) {
      const stride = d.kind === 'bird' ? 0.09 : d.kind === 'small' ? 0.06 : d.kind === 'rabbit' ? 0.22 : 0.26;
      this.walkPhase += (this.speed * dt / (stride * this.app.size)) * Math.PI;
    }

    // head: idle look-around, look target, illness modifiers
    let yaw = 0;
    let hp = 0;
    let roll = 0;
    if (!still) {
      yaw = noise1(t * 0.35 + 3.1) * 0.55;
      hp = noise1(t * 0.27 + 8.2) * 0.18;
    }
    if (this.lookTarget && !still) {
      const local = this.head.parent.worldToLocal(_p.copy(this.lookTarget));
      const ly = Math.atan2(local.x, local.z);
      const lp = -Math.atan2(local.y - 0.05, Math.hypot(local.x, local.z));
      yaw = clamp(ly, -1.1, 1.1);
      hp = clamp(lp, -0.5, 0.5);
    }
    if (lethargic || pb.lie > 0.5) hp += 0.25;
    if (tr.tilt) roll = 0.38;
    // keep the face level while the body is pitched up in the sitting pose
    if (d.kind === 'quad' && !(this.lookTarget && !still)) hp += pitch * 0.85;
    this.headYaw = damp(this.headYaw, yaw, lethargic ? 1.5 : 3.5, dt);
    this.headPitch = damp(this.headPitch, hp, 3, dt);
    let snapYaw = 0;
    if (this.twitch) {
      // impossible precision: identical snap every 2.4 s
      const ph = t % 2.4;
      if (ph < 0.14) snapYaw = Math.sin((ph / 0.14) * Math.PI) * 1.05;
    }
    // cough (irregular)
    if (tr.cough) {
      this.coughTimer -= dt;
      if (this.coughTimer <= 0) {
        this.cough = 1;
        this.coughTimer = 2.5 + this.rng.range(0, 5);
        if (ctx.onCough) ctx.onCough();
      }
    }
    this.cough = Math.max(0, this.cough - dt * 4);
    const coughP = Math.sin(this.cough * Math.PI) * 0.35;
    this.head.rotation.set(this.headPitch + coughP, this.headYaw + snapYaw, roll, 'YXZ');
    // shivering: irregular tremor
    if (tr.shiver) {
      const k = 0.006;
      this.body.position.x = noise1(t * 31) * k;
      this.body.position.z += noise1(t * 27 + 4) * k;
    }
    // blink
    if (!still) {
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) {
        this.blink = 1;
        this.blinkTimer = (lethargic ? 1.5 : 2.5) + this.rng.range(0, 3.5);
      }
    }
    this.blink = Math.max(0, this.blink - dt * (lethargic ? 3 : 7));
    const lid = lethargic ? 0.5 : 1;
    for (let i = 0; i < this.eyes.length; i++) {
      const e = this.eyes[i];
      let sy = lid * (1 - Math.sin(this.blink * Math.PI) * 0.92);
      if (tr.squint && i === 0) sy *= 0.35;
      const base = e.userData.baseScale || (e.userData.baseScale = e.scale.x);
      e.scale.set(base, base * Math.max(0.06, sy), base);
    }
    for (const x of this.extraEyes) {
      const b = Math.max(0, Math.sin(t * 1.3 + x.phase) - 0.96) * 25;
      x.g.scale.y = Math.max(0.08, 1 - b);
    }
    // ears
    this.earTimer -= dt;
    if (this.earTimer <= 0 && !still) {
      this.earTwitch[this.rng.int(0, 1)] = 1;
      this.earTimer = this.rng.range(1.2, 4.5);
    }
    for (let i = 0; i < this.ears.length; i++) {
      this.earTwitch[i] = Math.max(0, this.earTwitch[i] - dt * 6);
      const e = this.ears[i];
      const base = e.userData.baseRotX || 0;
      const flat = this.mood > 0.6 ? 0.5 : 0;
      e.rotation.x = base - Math.sin(this.earTwitch[i] * Math.PI) * 0.35 - flat;
    }
    // tail
    if (this.tail) {
      const wag = this.happy > 0.2 ? Math.sin(t * 14) * 0.6 * this.happy : still ? 0 : Math.sin(t * 1.3) * 0.18;
      this.tail.rotation.y = wag;
      this.tail.rotation.x = lethargic ? 0.5 : 0;
    }
    this.happy = Math.max(0, this.happy - dt * 0.3);
    // yawn / pant (jaw)
    if (this.jaw) {
      this.yawnTimer -= dt;
      if (this.yawnTimer <= 0 && !still) {
        this.yawn = 1;
        this.yawnTimer = this.signs.has('teeth') ? this.rng.range(3.5, 5.5) : this.rng.range(6, 12);
      }
      this.yawn = Math.max(0, this.yawn - dt * 0.7);
      const yawnOpen = Math.sin(this.yawn * Math.PI);
      let open = yawnOpen * (this.signs.has('teeth') ? 0.85 : 0.42);
      if (tr.pant) open = Math.max(open, 0.18 + Math.sin(t * 9) * 0.1);
      this.jaw.rotation.x = open;
    }
    if (this.droolMesh) {
      const k = (t * 0.4) % 1;
      this.droolMesh.scale.y = 0.6 + k * 1.4;
      this.droolMesh.position.y = this.anchors.muzzle.y - 0.04 - k * 0.03;
    }
  }

  // CCTV-only override: snap the head to stare at a security camera.
  applyViewOverride(camPos) {
    if (!this.followCam) return;
    this.savedHead = this.head.rotation.clone();
    this.head.parent.updateWorldMatrix(true, false);
    const local = this.head.parent.worldToLocal(_p.copy(camPos));
    const yaw = Math.atan2(local.x, local.z);
    const pitch = -Math.atan2(local.y, Math.hypot(local.x, local.z));
    this.head.rotation.set(clamp(pitch, -0.9, 0.9), clamp(yaw, -2.6, 2.6), 0, 'YXZ');
  }

  clearViewOverride() {
    if (this.savedHead) {
      this.head.rotation.copy(this.savedHead);
      this.savedHead = null;
    }
  }

  setProbe(v) {
    for (const e of this.entries) e.probe.value.copy(v);
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.isMesh && o.geometry !== _shineGeo) o.geometry.dispose();
    });
    for (const e of this.entries) Materials.release(e);
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}

// ---------- special materials ----------
let _glitch = null;
function glitchMaterial() {
  if (_glitch) return _glitch;
  _glitch = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform float uTime; varying vec2 vUv;
      float h(vec2 p){ p = fract(p*vec2(443.897,441.423)); p += dot(p,p.yx+19.19); return fract((p.x+p.y)*p.x); }
      void main(){
        float row = floor(vUv.y * 46.0);
        float shift = h(vec2(row, floor(uTime * 24.0))) * 30.0;
        float n = h(vec2(floor(vUv.x * 70.0 + shift), row + floor(uTime * 30.0)));
        float band = step(0.82, h(vec2(row * 0.37, floor(uTime * 8.0))));
        vec3 c = vec3(n) * (0.75 + band * 0.6);
        c.r += band * 0.25;
        gl_FragColor = vec4(c * 1.6, 1.0);
      }`,
  });
  return _glitch;
}

let _shineGeo = null;
let _shineMat = null;
function eyeshineGeometry() {
  if (!_shineGeo) _shineGeo = new THREE.SphereGeometry(1, 8, 6);
  return _shineGeo;
}
function eyeshineMaterial() {
  if (!_shineMat) _shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  return _shineMat;
}

let _shell = null;
function shellMaterial() {
  if (_shell) return _shell;
  _shell = new THREE.MeshBasicMaterial({ color: 0x000000 });
  return _shell;
}

let _blobMat = null;
function blobMaterial() {
  if (!_blobMat) _blobMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.5 });
  return _blobMat;
}

let _blob = null;
function blobTexture() {
  if (_blob) return _blob;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _blob = new THREE.CanvasTexture(c);
  _blob.colorSpace = THREE.SRGBColorSpace;
  // used as alpha via color multiply (black colour, alpha from texture)
  _blob.format = THREE.RGBAFormat;
  return _blob;
}

export { LAYER };
