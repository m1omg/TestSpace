// The clinic: layout, walls, furniture, fixtures, doors, the intake window
// and shutter, security cameras, navigation graph and interactable volumes.
import * as THREE from 'three';
import { Builder } from './builder.js';
import { Materials } from './materials.js';
import { Tex, makePosterAtlas, makeSignAtlas, signUV, posterUV, dynamicCanvasTexture, drawPosterAtlas } from './textures.js';
import { RNG, clamp } from './core.js';

export const H = 2.8; // ceiling height
export const T = 0.16; // wall thickness

const C = (hex) => new THREE.Color(hex);

export class Level {
  constructor(G) {
    this.G = G;
    this.lighting = G.lighting;
    this.root = new THREE.Group();
    this.root.name = 'level';
    this.dynamicRoot = new THREE.Group();
    this.root.add(this.dynamicRoot);
    this.colliders = [];
    this.interactables = new Map();
    this.doors = new Map();
    this.cams = [];
    this.spots = {};
    this.nav = { nodes: new Map(), edges: new Map() };
    this.screens = {};
    this.fixturesByCircuit = [];
    this.rng = new RNG(4242);
    this.animated = []; // small ambient animations (fish etc.)
  }

  // ---------------------------------------------------------------------
  build(scene, opts = {}) {
    const L = this.lighting;
    const B = new Builder(L);
    this.B = B;
    const pbr = Materials.pbr;

    // ---------- zones ----------
    L.addZone('vestibule', 0.6, 0, 7.16, 4.6, H, 10.4);
    L.addZone('reception', -7, 0, 0, 7, H, 7);
    L.addZone('corridor', -1, 0, -24, 1, H, 0);
    L.addZone('room1', -7, 0, -5.0, -1.16, H, -0.16);
    L.addZone('room2', -7, 0, -10.0, -1.16, H, -5.16);
    L.addZone('pharmacy', -7, 0, -14.0, -1.16, H, -10.16);
    L.addZone('staff', -7, 0, -19.0, -1.16, H, -14.16);
    L.addZone('room3', 1.16, 0, -5.0, 7, H, -0.16);
    L.addZone('surgery', 1.16, 0, -11.0, 7, H, -5.16);
    L.addZone('utility', 1.16, 0, -15.0, 7, H, -11.16);
    L.addZone('storage', 1.16, 0, -19.0, 7, H, -15.16);
    L.addZone('outside', -18, -1, 7.16, 22, 12, 44);

    // ---------- materials ----------
    const M = {
      floor: Materials.static('floor', { map: Tex.floor(), normalMap: Tex.floorNormal(), normalScale: 0.5, roughness: 0.32 }),
      floorCorr: Materials.static('floorCorr', { map: Tex.floor(), normalMap: Tex.floorNormal(), normalScale: 0.5, roughness: 0.32, color: 0xf2ecdd }),
      floorSurg: Materials.static('floorSurg', { map: Tex.floor(), normalMap: Tex.floorNormal(), normalScale: 0.5, roughness: 0.28, color: 0xdcecee }),
      carpet: Materials.static('carpet', { map: Tex.carpet(), roughness: 1 }),
      mat: Materials.static('rubberMat', { color: 0x2d3034, roughness: 1 }),
      asphalt: Materials.static('asphalt', { map: Tex.asphalt(), roughness: 0.85 }),
      concrete: Materials.static('concrete', { map: Tex.wall(), color: 0x8f8d88, roughness: 0.95 }),
      ceiling: Materials.static('ceiling', { map: Tex.ceiling(), roughness: 1 }),
      wallPeach: Materials.static('wallPeach', { map: Tex.wall(), color: 0xf7d7c4, roughness: 0.92 }),
      wallMint: Materials.static('wallMint', { map: Tex.wall(), color: 0xcbe8d6, roughness: 0.92 }),
      wallLilac: Materials.static('wallLilac', { map: Tex.wall(), color: 0xdcd1ee, roughness: 0.92 }),
      wallYellow: Materials.static('wallYellow', { map: Tex.wall(), color: 0xf3eac6, roughness: 0.92 }),
      wallBlue: Materials.static('wallBlue', { map: Tex.wall(), color: 0xd0e3f1, roughness: 0.92 }),
      wallBeige: Materials.static('wallBeige', { map: Tex.wall(), color: 0xe8dcc7, roughness: 0.92 }),
      wallGrey: Materials.static('wallGrey', { map: Tex.wall(), color: 0xb0aea6, roughness: 0.95 }),
      wallTiles: Materials.static('wallTiles', { map: Tex.tiles(), roughness: 0.3 }),
      exterior: Materials.static('exterior', { map: Tex.wall(), color: 0x77716b, roughness: 1 }),
      trim: Materials.static('trim', { color: 0xf6f4ee, roughness: 0.55 }),
      baseboard: Materials.static('baseboard', { color: 0x8f93a8, roughness: 0.5 }),
      wood: Materials.static('wood', { map: Tex.wood(), roughness: 0.5 }),
      counter: Materials.static('counter', { color: 0xf3eee6, roughness: 0.35 }),
      ledge: Materials.static('ledge', { color: 0xb9ddd6, roughness: 0.4 }),
      counterMint: Materials.static('counterMint', { color: 0x8fcfc2, roughness: 0.45 }),
      counterPink: Materials.static('counterPink', { color: 0xf0b3b0, roughness: 0.45 }),
      steel: Materials.static('steel', { map: Tex.metal(), color: 0xe4e6ea, metalness: 0.65, roughness: 0.32 }),
      dark: Materials.static('dark', { color: 0x26282e, roughness: 0.55 }),
      grey: Materials.static('grey', { color: 0x8d9097, roughness: 0.6 }),
      white: Materials.static('white', { color: 0xf2f1ec, roughness: 0.4 }),
      chairMint: Materials.static('chairMint', { color: 0x93d6c0, roughness: 0.3 }),
      chairCoral: Materials.static('chairCoral', { color: 0xf39d92, roughness: 0.3 }),
      chairLilac: Materials.static('chairLilac', { color: 0xb6a2e2, roughness: 0.3 }),
      chairYellow: Materials.static('chairYellow', { color: 0xf5d379, roughness: 0.3 }),
      vinyl: Materials.static('vinyl', { color: 0x74bcc0, roughness: 0.42 }),
      fabric: Materials.static('fabric', { color: 0x6b82b3, roughness: 1 }),
      paper: Materials.static('paper', { color: 0xf6f2e8, roughness: 0.9 }),
      cork: Materials.static('cork', { color: 0xb88a5a, roughness: 1 }),
      plant: Materials.static('plant', { color: 0x4c9a58, roughness: 0.8 }),
      pot: Materials.static('pot', { color: 0xcf8a6c, roughness: 0.8 }),
      red: Materials.static('red', { color: 0xc8403a, roughness: 0.4 }),
      green: Materials.static('green', { color: 0x46b46a, roughness: 0.4 }),
      yellow: Materials.static('yellowP', { color: 0xf0c430, roughness: 0.5 }),
      blue: Materials.static('blueP', { color: 0x5b8fd6, roughness: 0.5 }),
      orange: Materials.static('orangeP', { color: 0xf09a50, roughness: 0.5 }),
      rubber: Materials.static('rubber', { color: 0x1b1c20, roughness: 0.9 }),
      car: Materials.static('car', { color: 0x2f3a4a, roughness: 0.35, metalness: 0.4 }),
      posters: Materials.static('posters', { map: makePosterAtlas(0), roughness: 0.7 }),
      signs: Materials.static('signs', { map: makeSignAtlas(), roughness: 0.6 }),
      // unlit
      glass: Materials.basic('glass', { color: 0x9cc4d6, transparent: true, opacity: 0.13, depthWrite: false }),
      glassDark: Materials.basic('glassDark', { color: 0x0a0e14, transparent: true, opacity: 0.55, depthWrite: false }),
      backdrop: Materials.basic('backdrop', { map: Tex.outside(), fog: false }),
      exitGlow: Materials.basic('exitSign', { map: makeSignAtlas(), color: 0xffffff }),
      water: Materials.basic('water', { color: 0x2f86b8, transparent: true, opacity: 0.5, depthWrite: false }),
      screenDim: Materials.basic('screenDim', { color: 0x1a2a2a }),
      led: Materials.basic('ledRed', { color: 0xff2a2a }),
      ledGreen: Materials.basic('ledGreen', { color: 0x3dff6a }),
      lampHead: Materials.basic('lampHead', { color: 0xffc98a }),
      black: Materials.basic('void', { color: 0x000000 }),
    };
    this.M = M;
    this.posterMat = M.posters;

    // ---------- fixtures (lighting) ----------
    const fix = (x, z, circuit, zones, opts = {}) => this.fixture(B, x, z, circuit, zones, opts);
    // reception (circuit 0)
    for (const x of [-4.8, -1.4, 2.0, 5.3]) for (const z of [1.8, 5.2]) fix(x, z, 0, ['reception'], { intensity: 0.85 });
    fix(2.6, 8.9, 0, ['vestibule'], { intensity: 0.62, radius: 2.4 });
    // corridor (circuit 1)
    for (const z of [-1.8, -6.0, -10.2, -14.4, -18.6, -22.6]) fix(0, z, 1, ['corridor'], { intensity: 0.9, w: 0.6, d: 1.2, radius: 2.8 });
    // rooms
    fix(-4.1, -2.6, 2, ['room1'], { intensity: 1.1 });
    fix(-4.1, -7.6, 3, ['room2'], { intensity: 1.1 });
    fix(4.1, -2.6, 4, ['room3'], { intensity: 1.1 });
    fix(3.2, -8.1, 5, ['surgery'], { intensity: 0.9 });
    fix(5.4, -8.1, 5, ['surgery'], { intensity: 0.9 });
    fix(-4.1, -12.1, 6, ['pharmacy'], { intensity: 1.0 });
    fix(-4.1, -16.6, 6, ['staff'], { intensity: 0.85 });
    fix(4.1, -13.1, 6, ['utility'], { intensity: 0.7, bulb: true, radius: 2.4 });
    // surgical lamp (extra strong, surgery circuit)
    L.addFixture({ pos: new THREE.Vector3(3.9, 2.1, -8.1), circuit: 5, zones: ['surgery'], intensity: 1.2, radius: 1.6, down: 0.95 });
    // exterior street lamp + entrance lamp (circuit 7)
    L.addFixture({ pos: new THREE.Vector3(9.5, 5.2, 16), circuit: 7, zones: ['outside'], intensity: 2.2, radius: 7.5, down: 0.85 });
    L.addFixture({ pos: new THREE.Vector3(2.6, 3.1, 10.9), circuit: 7, zones: ['outside', 'vestibule'], intensity: 0.7, radius: 3.0, down: 0.8 });
    // always-on coloured sources
    L.addStatic({ pos: new THREE.Vector3(0, 2.45, -23.8), color: [0.15, 0.9, 0.35], radius: 1.8, zones: ['corridor'], intensity: 0.35 });
    L.addStatic({ pos: new THREE.Vector3(-4.6, 1.0, 0.45), color: [0.2, 0.55, 1.0], radius: 1.3, zones: ['reception'], intensity: 0.35 });

    // ---------- floors & ceilings ----------
    B.plane(-7, 0, 7, 7, 0, M.floor, 'reception', true, { uvScale: 0.5 });
    B.plane(-7, 0, 7, 7, H, M.ceiling, 'reception', false, { uvScale: 1 / 1.2 });
    B.plane(0.6, 7.16, 4.6, 10.4, 0, M.mat, 'vestibule', true, { uvScale: 1 });
    B.plane(0.6, 7.16, 4.6, 10.4, H, M.ceiling, 'vestibule', false, { uvScale: 1 / 1.2 });
    B.plane(-1, -24, 1, 0, 0, M.floorCorr, 'corridor', true, { uvScale: 0.5 });
    B.plane(-1, -24, 1, 0, H, M.ceiling, 'corridor', false, { uvScale: 1 / 1.2 });
    const roomFloor = {
      room1: M.floor, room2: M.floor, room3: M.floor, pharmacy: M.floorCorr, staff: M.carpet, surgery: M.floorSurg, utility: M.concrete, storage: M.concrete,
    };
    for (const [id, mat] of Object.entries(roomFloor)) {
      const z = L.zones.get(id);
      B.plane(z.min.x, z.min.z, z.max.x, z.max.z, 0, mat, id, true, { uvScale: mat === M.carpet ? 1 : 0.5 });
      B.plane(z.min.x, z.min.z, z.max.x, z.max.z, H, M.ceiling, id, false, { uvScale: 1 / 1.2 });
    }
    // door thresholds (floor under door openings) so no gaps show
    // exterior ground
    B.plane(-18, 7.16, 22, 44, -0.02, M.asphalt, 'outside', true, { uvScale: 0.25, seg: 2 });
    B.box(-18, -0.02, 7.16, 0.44, 0.06, 9.0, M.concrete, 'outside', { seg: 2 }); // sidewalk
    B.box(4.76, -0.02, 7.16, 22, 0.06, 9.0, M.concrete, 'outside', { seg: 2 });
    B.box(0.44, -0.02, 10.56, 4.76, 0.06, 12.0, M.concrete, 'outside', { seg: 2 });
    // parking lines
    for (let i = 0; i < 6; i++) B.box(-9 + i * 3.2, 0.0, 12, -8.9 + i * 3.2, 0.02, 17, M.paper, 'outside');

    // ---------- walls ----------
    this.buildWalls(B, M);

    // ---------- rooms & props ----------
    this.buildReception(B, M);
    this.buildVestibule(B, M);
    this.buildCorridor(B, M);
    this.buildExamRoom(B, M, 'room1', -1, 0);
    this.buildExamRoom(B, M, 'room2', -1, 1);
    this.buildExamRoom(B, M, 'room3', 1, 0);
    this.buildSurgery(B, M);
    this.buildPharmacy(B, M);
    this.buildStaff(B, M);
    this.buildUtility(B, M);
    this.buildExterior(B, M);

    // ---------- finalize ----------
    B.finalize(this.root, opts.shadows);
    this.colliders.push(...B.colliders);
    this.buildNav();
    scene.add(this.root);
    return this;
  }

  // ---------------------------------------------------------------------
  fixture(B, x, z, circuit, zones, opts = {}) {
    const L = this.lighting;
    const w = opts.w ?? 1.2;
    const d = opts.d ?? 0.6;
    const zone = zones[0];
    if (opts.bulb) {
      B.cyl(x, H - 0.12, z, 0.03, 0.03, 0.24, this.M.dark, zone);
      const g = new THREE.SphereGeometry(0.07, 10, 8);
      B.place(g, L.tubeMats[circuit], zone, x, H - 0.3, z, 0, { castShadow: false });
    } else {
      B.box(x - w / 2 - 0.04, H - 0.05, z - d / 2 - 0.04, x + w / 2 + 0.04, H, z + d / 2 + 0.04, this.M.white, zone);
      // two tubes behind a diffuser
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(Math.PI / 2);
      B.place(g, L.tubeMats[circuit], zone, x, H - 0.052, z, 0, { castShadow: false, keepUV: true });
    }
    L.addFixture({
      pos: new THREE.Vector3(x, H - 0.1, z),
      circuit,
      zones,
      intensity: opts.intensity ?? 1,
      radius: opts.radius ?? 3.2,
      down: opts.bulb ? 0.4 : 0.72,
    });
    if (!this.fixturesByCircuit[circuit]) this.fixturesByCircuit[circuit] = [];
    this.fixturesByCircuit[circuit].push(new THREE.Vector3(x, H - (opts.bulb ? 0.3 : 0.25), z));
  }

  // Glow halos per circuit (one Points draw call each).
  buildGlows(scene) {
    const L = this.lighting;
    this.glows = [];
    this.fixturesByCircuit.forEach((list, i) => {
      if (!list || !list.length) return;
      const pos = new Float32Array(list.length * 3);
      list.forEach((p, k) => pos.set([p.x, p.y, p.z], k * 3));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const m = new THREE.PointsMaterial({
        size: 1.5,
        map: Tex.glow(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: L.glowMats[i].color,
        sizeAttenuation: true,
        fog: false,
      });
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      pts.userData.circuit = i;
      pts.renderOrder = 5;
      scene.add(pts);
      this.glows.push(pts);
    });
  }

  updateGlows(enabled) {
    if (!this.glows) return;
    for (const p of this.glows) {
      const gm = this.lighting.glowMats[p.userData.circuit];
      p.visible = enabled && gm.opacity > 0.01;
      p.material.opacity = gm.opacity;
    }
  }

  // ---------------------------------------------------------------------
  // Walls are built as two half-thickness skins so each face is lit and
  // coloured by the zone it faces.
  wallX(B, z, x0, x1, sideA, sideB, openings = [], opts = {}) {
    // wall along X at plane z (A face is at z, A zone is z < ... caller decides)
    const t = opts.t ?? T;
    const h = opts.h ?? H;
    const za0 = z - t;
    const zm = z - t / 2;
    const ops = openings.slice().sort((a, b) => a.a - b.a);
    let cur = x0;
    const seg = (a, b, y0, y1) => {
      if (b - a < 0.001 || y1 - y0 < 0.001) return;
      if (sideA) B.box(a, y0, za0, b, y1, zm, sideA.mat, sideA.zone, { seg: 0.6 });
      if (sideB) B.box(a, y0, zm, b, y1, z, sideB.mat, sideB.zone, { seg: 0.6 });
    };
    for (const o of ops) {
      seg(cur, o.a, 0, h);
      B.collider(cur, za0, o.a, z, 'wall');
      if (o.top !== undefined) seg(o.a, o.b, o.top, h);
      if (o.sill !== undefined) {
        seg(o.a, o.b, 0, o.sill);
        B.collider(o.a, za0, o.b, z, 'wall');
      }
      cur = o.b;
    }
    seg(cur, x1, 0, h);
    B.collider(cur, za0, x1, z, 'wall');
    if (opts.base !== false) {
      // baseboards on each face, skipping door openings
      let c = x0;
      const doors = ops.filter((o) => o.sill === undefined || o.sill < 0.12);
      for (const o of [...doors, { a: x1, b: x1 }]) {
        if (o.a - c > 0.05) {
          if (sideA && sideA.zone !== 'outside') B.box(c, 0, za0 - 0.02, o.a, 0.1, za0, this.M.baseboard, sideA.zone);
          if (sideB && sideB.zone !== 'outside') B.box(c, 0, z, o.a, 0.1, z + 0.02, this.M.baseboard, sideB.zone);
        }
        c = o.b;
      }
    }
  }

  // wall along Z at plane x: A side is x < plane, B side is x > plane.
  wallZ(B, x, z0, z1, sideA, sideB, openings = [], opts = {}) {
    const t = opts.t ?? T;
    const h = opts.h ?? H;
    const xa0 = x - t;
    const xm = x - t / 2;
    const ops = openings.slice().sort((a, b) => a.a - b.a);
    let cur = z0;
    const seg = (a, b, y0, y1) => {
      if (b - a < 0.001 || y1 - y0 < 0.001) return;
      if (sideA) B.box(xa0, y0, a, xm, y1, b, sideA.mat, sideA.zone, { seg: 0.6 });
      if (sideB) B.box(xm, y0, a, x, y1, b, sideB.mat, sideB.zone, { seg: 0.6 });
    };
    for (const o of ops) {
      seg(cur, o.a, 0, h);
      B.collider(xa0, cur, x, o.a, 'wall');
      if (o.top !== undefined) seg(o.a, o.b, o.top, h);
      if (o.sill !== undefined) {
        seg(o.a, o.b, 0, o.sill);
        B.collider(xa0, o.a, x, o.b, 'wall');
      }
      cur = o.b;
    }
    seg(cur, z1, 0, h);
    B.collider(xa0, cur, x, z1, 'wall');
    if (opts.base !== false) {
      let c = z0;
      const doors = ops.filter((o) => o.sill === undefined || o.sill < 0.12);
      for (const o of [...doors, { a: z1, b: z1 }]) {
        if (o.a - c > 0.05) {
          if (sideA && sideA.zone !== 'outside') B.box(xa0 - 0.02, 0, c, xa0, 0.1, o.a, this.M.baseboard, sideA.zone);
          if (sideB && sideB.zone !== 'outside') B.box(x, 0, c, x + 0.02, 0.1, o.a, this.M.baseboard, sideB.zone);
        }
        c = o.b;
      }
    }
  }

  buildWalls(B, M) {
    const S = (zone, mat) => ({ zone, mat });
    const out = S('outside', M.exterior);
    const rec = S('reception', M.wallPeach);
    const recW = S('reception', M.wallMint);
    // Reception south wall (z = 7 .. 7.16): A side = reception (z < 7.16)
    // wallX puts face A at [z - t, z - t/2] and face B at [z - t/2, z].
    this.wallX(B, 7.16, -7.16, 0.44, recW, out, [
      { a: -6.2, b: -4.4, sill: 0.9, top: 2.25 },
      { a: -3.8, b: -2.0, sill: 0.9, top: 2.25 },
    ]);
    this.wallX(B, 7.16, 0.44, 4.76, rec, S('vestibule', M.wallYellow), [
      { a: 1.2, b: 3.2, sill: 0.95, top: 2.05 },
      { a: 3.6, b: 4.5, top: 2.15 },
    ]);
    this.wallX(B, 7.16, 4.76, 7.16, rec, out, [{ a: 5.3, b: 6.6, sill: 0.9, top: 2.25 }]);
    // Reception north wall (z = -0.16 .. 0): A side = rooms (z < -0.08), B = reception
    this.wallX(B, 0, -7.16, -1, S('room1', M.wallMint), recW, [], {});
    this.wallX(B, 0, -1, 1, S('corridor', M.wallYellow), rec, [{ a: -1, b: 1, top: 2.4 }], { base: false });
    this.wallX(B, 0, 1, 7.16, S('room3', M.wallLilac), rec, []);
    // Reception side walls
    this.wallZ(B, -7, 0, 7.16, out, recW, []);
    this.wallZ(B, 7.16, 0, 7.16, rec, out, []);

    // Vestibule side walls & storefront
    this.wallZ(B, 0.6, 7.16, 10.4, out, S('vestibule', M.wallYellow), []);
    this.wallZ(B, 4.76, 7.16, 10.4, S('vestibule', M.wallYellow), out, []);
    // storefront: low wall + glass, sliding door gap 1.8..3.4
    this.wallX(B, 10.56, 0.44, 4.76, S('vestibule', M.wallYellow), out, [
      { a: 0.75, b: 1.7, sill: 0.45, top: 2.4 },
      { a: 1.8, b: 3.4, top: 2.4 },
      { a: 3.5, b: 4.45, sill: 0.45, top: 2.4 },
    ], { base: false });
    this.glassPane(B, 0.75, 1.7, 0.45, 2.4, 10.48, 'x');
    this.glassPane(B, 3.5, 4.45, 0.45, 2.4, 10.48, 'x');
    // waiting room windows (with blinds)
    this.windowWithBlinds(B, -6.2, -4.4, 0.9, 2.25, 7.08, 'x', 'reception');
    this.windowWithBlinds(B, -3.8, -2.0, 0.9, 2.25, 7.08, 'x', 'reception');
    this.windowWithBlinds(B, 5.3, 6.6, 0.9, 2.25, 7.08, 'x', 'reception');

    // Corridor walls: west (x = -1) A side = rooms (x < -1.08), B = corridor
    const corr = S('corridor', M.wallYellow);
    const room1 = S('room1', M.wallMint);
    const room2 = S('room2', M.wallPeach);
    const pharm = S('pharmacy', M.wallBlue);
    const staff = S('staff', M.wallBeige);
    const room3 = S('room3', M.wallLilac);
    const surg = S('surgery', M.wallTiles);
    const util = S('utility', M.wallGrey);
    const stor = S('storage', M.wallGrey);
    const door = (a, b) => ({ a, b, top: 2.15 });
    this.wallZ(B, -1, -5.08, -0.16, room1, corr, [door(-3.3, -2.3)]);
    this.wallZ(B, -1, -10.08, -5.08, room2, corr, [door(-8.2, -7.2)]);
    this.wallZ(B, -1, -14.08, -10.08, pharm, corr, [door(-12.6, -11.6)]);
    this.wallZ(B, -1, -19.16, -14.08, staff, corr, [door(-17.0, -16.0)]);
    this.wallZ(B, -1, -24.16, -19.16, out, corr, []);
    // east (x = 1.16) A side = corridor, B = rooms
    this.wallZ(B, 1.16, -5.08, -0.16, corr, room3, [door(-3.3, -2.3)]);
    this.wallZ(B, 1.16, -11.08, -5.08, corr, surg, [{ a: -8.8, b: -7.4, top: 2.2 }]);
    this.wallZ(B, 1.16, -15.08, -11.08, corr, util, [door(-13.6, -12.6)]);
    this.wallZ(B, 1.16, -19.16, -15.08, corr, stor, [door(-17.6, -16.6)]);
    this.wallZ(B, 1.16, -24.16, -19.16, corr, out, []);
    // corridor end wall with exit door
    this.wallX(B, -24, -1.16, 1.16, out, corr, [{ a: -0.5, b: 0.5, top: 2.15 }]);

    // Room partition walls (A = north room z < plane, B = south room)
    this.wallX(B, -5.0, -7.16, -1.16, room2, room1, []);
    this.wallX(B, -10.0, -7.16, -1.16, pharm, room2, []);
    this.wallX(B, -14.0, -7.16, -1.16, staff, pharm, []);
    this.wallX(B, -19.0, -7.16, -1.16, out, staff, []);
    this.wallX(B, -5.0, 1.16, 7.16, surg, room3, []);
    this.wallX(B, -11.0, 1.16, 7.16, util, surg, []);
    this.wallX(B, -15.0, 1.16, 7.16, stor, util, []);
    this.wallX(B, -19.0, 1.16, 7.16, out, stor, []);
    // Outer walls
    this.wallZ(B, -7, -19.16, -0.16, out, null, [], { base: false });
    this.wallZ(B, 7.16, -19.16, -0.16, null, out, [], { base: false });
    this.outerWallFaces(B, M);
  }

  // Inner faces of the long outer walls, per room (west x=-7 face, east x=7).
  outerWallFaces(B, M) {
    const west = [
      ['room1', M.wallMint, -5.0, -0.16],
      ['room2', M.wallPeach, -10.0, -5.16],
      ['pharmacy', M.wallBlue, -14.0, -10.16],
      ['staff', M.wallBeige, -19.0, -14.16],
    ];
    for (const [zone, mat, z0, z1] of west) {
      if (zone === 'staff') {
        // window in the staff office
        B.box(-7.0, 0, z0, -6.98, H, -17.6, mat, zone, { seg: 0.6 });
        B.box(-7.0, 0, -15.8, -6.98, H, z1, mat, zone, { seg: 0.6 });
        B.box(-7.0, 0, -17.6, -6.98, 0.95, -15.8, mat, zone, { seg: 0.6 });
        B.box(-7.0, 2.2, -17.6, -6.98, H, -15.8, mat, zone, { seg: 0.6 });
        B.box(-7.16, 0.95, -17.6, -7.0, 2.2, -15.8, this.M.black, zone);
        this.windowWithBlinds(B, -17.6, -15.8, 0.95, 2.2, -6.97, 'z', zone, true);
      } else {
        B.box(-7.0, 0, z0, -6.98, H, z1, mat, zone, { seg: 0.6 });
      }
      B.box(-6.98, 0, z0, -6.96, 0.1, z1, M.baseboard, zone);
    }
    const east = [
      ['room3', M.wallLilac, -5.0, -0.16],
      ['surgery', M.wallTiles, -11.0, -5.16],
      ['utility', M.wallGrey, -15.0, -11.16],
      ['storage', M.wallGrey, -19.0, -15.16],
    ];
    for (const [zone, mat, z0, z1] of east) {
      B.box(6.98, 0, z0, 7.0, H, z1, mat, zone, { seg: 0.6 });
      B.box(6.96, 0, z0, 6.98, 0.1, z1, M.baseboard, zone);
    }
  }

  glassPane(B, a, b, y0, y1, c, axis) {
    const w = b - a;
    const g = new THREE.PlaneGeometry(w, y1 - y0);
    if (axis === 'x') {
      g.translate((a + b) / 2, (y0 + y1) / 2, c);
      B.add(g, this.M.glass, 'vestibule', { keepUV: true, castShadow: false });
      // frame
      B.box(a - 0.03, y0, c - 0.03, a, y1, c + 0.03, this.M.grey, 'vestibule');
      B.box(b, y0, c - 0.03, b + 0.03, y1, c + 0.03, this.M.grey, 'vestibule');
    } else {
      g.rotateY(Math.PI / 2);
      g.translate(c, (y0 + y1) / 2, (a + b) / 2);
      B.add(g, this.M.glass, 'vestibule', { keepUV: true, castShadow: false });
    }
  }

  windowWithBlinds(B, a, b, y0, y1, c, axis, zone, closed = false) {
    const M = this.M;
    const w = b - a;
    const h = y1 - y0;
    const blindsMat = this._blindsMat || (this._blindsMat = Materials.static('blinds', { map: Tex.blinds(), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 }));
    if (axis === 'x') {
      // sill + frame
      B.box(a - 0.05, y0 - 0.05, c - 0.14, b + 0.05, y0, c + 0.02, M.trim, zone);
      B.box(a - 0.05, y1, c - 0.1, b + 0.05, y1 + 0.06, c + 0.02, M.trim, zone);
      B.box(a - 0.05, y0, c - 0.1, a, y1, c + 0.02, M.trim, zone);
      B.box(b, y0, c - 0.1, b + 0.05, y1, c + 0.02, M.trim, zone);
      const g = new THREE.PlaneGeometry(w, h);
      g.translate((a + b) / 2, (y0 + y1) / 2, c + 0.04);
      B.add(g, M.glass, 'outside', { keepUV: true, castShadow: false });
      // blinds cover the top part
      const bh = closed ? h : h * 0.62;
      const gb = new THREE.PlaneGeometry(w - 0.04, bh);
      const uv = gb.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * bh * 6);
      gb.translate((a + b) / 2, y1 - bh / 2, c - 0.04);
      B.add(gb, blindsMat, zone, { keepUV: true });
    } else {
      B.box(c - 0.02, y0 - 0.05, a - 0.05, c + 0.14, y0, b + 0.05, M.trim, zone);
      const bh = closed ? h : h * 0.62;
      const gb = new THREE.PlaneGeometry(w - 0.04, bh);
      const uv = gb.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * bh * 6);
      gb.rotateY(Math.PI / 2);
      gb.translate(c + 0.04, y1 - bh / 2, (a + b) / 2);
      B.add(gb, blindsMat, zone, { keepUV: true });
    }
  }

  // ---------------------------------------------------------------------
  // Props
  chair(B, x, z, ry, mat, zone) {
    const M = this.M;
    // seat & back as one shell, metal legs
    B.rbox(x, 0.45, z, 0.48, 0.05, 0.44, ry, mat, zone);
    const bx = x - Math.sin(ry) * 0.2;
    const bz = z - Math.cos(ry) * 0.2;
    B.rbox(bx, 0.72, bz, 0.48, 0.44, 0.04, ry, mat, zone, { rx: -0.12 });
    for (const [lx, lz] of [[-0.19, -0.17], [0.19, -0.17], [-0.19, 0.17], [0.19, 0.17]]) {
      const cx = x + lx * Math.cos(ry) + lz * Math.sin(ry);
      const cz = z - lx * Math.sin(ry) + lz * Math.cos(ry);
      B.cyl(cx, 0.22, cz, 0.012, 0.012, 0.44, M.steel, zone, { radial: 6 });
    }
  }

  chairRow(B, x, z, n, dx, dz, ry, mats, zone) {
    const M = this.M;
    for (let i = 0; i < n; i++) this.chair(B, x + dx * i, z + dz * i, ry, mats[i % mats.length], zone);
    // shared beam
    const x1 = x + dx * (n - 1);
    const z1 = z + dz * (n - 1);
    B.box(Math.min(x, x1) - 0.05, 0.38, Math.min(z, z1) - 0.05, Math.max(x, x1) + 0.05, 0.41, Math.max(z, z1) + 0.05, M.steel, zone);
    this.lighting.addOccluder(Math.min(x, x1) - 0.25, Math.min(z, z1) - 0.25, Math.max(x, x1) + 0.25, Math.max(z, z1) + 0.25, 0.35);
    B.collider(Math.min(x, x1) - 0.25, Math.min(z, z1) - 0.25, Math.max(x, x1) + 0.25, Math.max(z, z1) + 0.25);
  }

  table(B, x0, z0, x1, z1, h, top, legs, zone, opts = {}) {
    B.box(x0, h - 0.04, z0, x1, h, z1, top, zone);
    const inset = 0.05;
    for (const [lx, lz] of [[x0 + inset, z0 + inset], [x1 - inset, z0 + inset], [x0 + inset, z1 - inset], [x1 - inset, z1 - inset]]) {
      B.box(lx - 0.025, 0, lz - 0.025, lx + 0.025, h - 0.04, lz + 0.025, legs, zone);
    }
    this.lighting.addOccluder(x0, z0, x1, z1, opts.shadow ?? 0.45);
    if (opts.collide !== false) B.collider(x0, z0, x1, z1);
  }

  cabinet(B, x0, z0, x1, z1, h, body, zone, opts = {}) {
    const M = this.M;
    B.box(x0, 0.08, z0, x1, h, z1, body, zone);
    B.box(x0 + 0.03, 0, z0 + 0.03, x1 - 0.03, 0.08, z1 - 0.03, M.dark, zone);
    if (opts.top) B.box(x0 - 0.02, h, z0 - 0.02, x1 + 0.02, h + 0.04, z1 + 0.02, opts.top, zone);
    // handles on the front face
    const face = opts.face || 'z+';
    const n = Math.max(1, Math.round((face[0] === 'z' ? x1 - x0 : z1 - z0) / 0.5));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      if (face === 'z+') B.box(x0 + (x1 - x0) * t - 0.06, h - 0.15, z1, x0 + (x1 - x0) * t + 0.06, h - 0.13, z1 + 0.02, M.steel, zone);
      if (face === 'z-') B.box(x0 + (x1 - x0) * t - 0.06, h - 0.15, z0 - 0.02, x0 + (x1 - x0) * t + 0.06, h - 0.13, z0, M.steel, zone);
      if (face === 'x+') B.box(x1, h - 0.15, z0 + (z1 - z0) * t - 0.06, x1 + 0.02, h - 0.13, z0 + (z1 - z0) * t + 0.06, M.steel, zone);
      if (face === 'x-') B.box(x0 - 0.02, h - 0.15, z0 + (z1 - z0) * t - 0.06, x0, h - 0.13, z0 + (z1 - z0) * t + 0.06, M.steel, zone);
    }
    this.lighting.addOccluder(x0, z0, x1, z1, 0.4);
    if (opts.collide !== false) B.collider(x0, z0, x1, z1);
  }

  plant(B, x, z, zone, s = 1) {
    const M = this.M;
    B.cyl(x, 0.2 * s, z, 0.17 * s, 0.13 * s, 0.4 * s, M.pot, zone);
    const r = this.rng;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + r.range(-0.3, 0.3);
      const g = new THREE.SphereGeometry(0.16 * s, 8, 6);
      B.place(g, M.plant, zone, x + Math.cos(a) * 0.12 * s, (0.62 + r.range(0, 0.35)) * s, z + Math.sin(a) * 0.12 * s, a, { sx: 0.6, sy: 1.6, sz: 0.35, rz: Math.cos(a) * 0.4, rx: Math.sin(a) * 0.4 });
    }
    B.collider(x - 0.2 * s, z - 0.2 * s, x + 0.2 * s, z + 0.2 * s);
  }

  poster(B, index, x, y, z, ry, zone, w = 0.6) {
    const uv = posterUV(index);
    B.quad(x, y, z, w, w * (512 / 384), ry, this.M.posters, zone, uv);
  }

  sign(B, index, x, y, z, ry, zone, w = 0.5, mat) {
    const uv = signUV(index);
    B.quad(x, y, z, w, w / 2, ry, mat || this.M.signs, zone, uv);
  }

  secCam(B, x, y, z, ry, zone) {
    const M = this.M;
    B.rbox(x, y, z, 0.12, 0.1, 0.22, ry, M.white, zone);
    B.cyl(x + Math.sin(ry) * 0.12, y, z + Math.cos(ry) * 0.12, 0.035, 0.035, 0.04, M.dark, zone, { rx: Math.PI / 2, ry });
    const g = new THREE.SphereGeometry(0.012, 6, 4);
    B.place(g, M.led, zone, x + Math.sin(ry) * 0.05 + Math.cos(ry) * 0.04, y + 0.04, z + Math.cos(ry) * 0.05 - Math.sin(ry) * 0.04);
  }

  addInteract(id, x0, y0, z0, x1, y1, z1, data = {}) {
    const box = new THREE.Box3(new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)), new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)));
    const it = { id, box, ...data };
    this.interactables.set(id, it);
    return it;
  }

  // ---------------------------------------------------------------------
  buildReception(B, M) {
    const z = 'reception';
    // reception desk: counter against the window wall
    const dx0 = 0.7;
    const dx1 = 3.45;
    B.box(dx0, 0, 6.25, dx1, 1.0, 6.33, M.counterMint, z, { seg: 0.5 }); // front panel (faces player)
    B.box(dx0, 0.98, 6.2, dx1, 1.04, 7.0, M.wood, z); // top surface
    B.box(dx0, 0, 6.33, dx0 + 0.06, 0.98, 7.0, M.counterMint, z);
    B.box(dx1 - 0.06, 0, 6.33, dx1, 0.98, 7.0, M.counterMint, z);
    B.collider(dx0 - 0.05, 6.2, dx1 + 0.05, 7.0);
    this.lighting.addOccluder(dx0, 6.2, dx1, 7.0, 0.5);
    // intake window frame (reception side) + speak grille + pass slot
    B.box(1.12, 0.93, 6.98, 3.28, 0.97, 7.18, M.trim, z);
    B.box(1.12, 2.03, 6.98, 3.28, 2.09, 7.18, M.trim, z);
    B.box(1.12, 0.95, 6.98, 1.2, 2.05, 7.18, M.trim, z);
    B.box(3.2, 0.95, 6.98, 3.28, 2.05, 7.18, M.trim, z);
    const glass = new THREE.PlaneGeometry(2.0, 1.1);
    glass.translate(2.2, 1.5, 7.08);
    B.add(glass, M.glass, z, { keepUV: true, castShadow: false });
    // desk items
    // security monitor (screen added as dynamic mesh)
    B.rbox(1.15, 1.25, 6.62, 0.56, 0.42, 0.36, 0.35, M.dark, z);
    B.rbox(1.15, 1.06, 6.62, 0.2, 0.04, 0.2, 0.35, M.dark, z);
    const scr = new THREE.PlaneGeometry(0.46, 0.33);
    const monScreen = new THREE.Mesh(scr, Materials.basic('monScreen', { color: 0xffffff }));
    // facing the player (-z), rotated with the monitor body
    monScreen.rotation.y = Math.PI + 0.35;
    monScreen.position.set(1.15 + Math.sin(Math.PI + 0.35) * 0.185, 1.26, 6.62 + Math.cos(Math.PI + 0.35) * 0.185);
    this.dynamicRoot.add(monScreen);
    this.screens.monitor = monScreen;
    this.addInteract('monitor', 0.8, 1.0, 6.35, 1.5, 1.5, 6.95);
    // printer with intake record
    B.box(2.75, 1.04, 6.55, 3.15, 1.2, 6.9, M.white, z);
    B.box(2.8, 1.2, 6.52, 3.1, 1.21, 6.75, M.paper, z);
    this.addInteract('record', 2.7, 1.0, 6.4, 3.2, 1.3, 6.95);
    // admit button + shutter lever panel
    B.box(3.2, 1.04, 6.3, 3.42, 1.1, 6.6, M.grey, z);
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16), Materials.basic('admitBtn', { color: 0x37d86a }));
    btn.position.set(3.26, 1.11, 6.45);
    this.dynamicRoot.add(btn);
    this.screens.admitButton = btn;
    this.addInteract('admit', 3.2, 1.04, 6.36, 3.32, 1.2, 6.56);
    const leverBase = new THREE.Group();
    leverBase.position.set(3.37, 1.1, 6.45);
    const leverMat = Materials.dynamic('lever', { color: 0xd94a3a, roughness: 0.35 });
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 8), leverMat.mat);
    lever.position.y = 0.09;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), leverMat.mat);
    knob.position.y = 0.18;
    leverBase.add(lever, knob);
    leverBase.rotation.x = -0.5;
    this.dynamicRoot.add(leverBase);
    this.screens.lever = leverBase;
    this.leverProbe = leverMat;
    this.addInteract('shutter', 3.32, 1.04, 6.3, 3.45, 1.35, 6.62);
    // knock on the glass
    this.addInteract('glass', 1.25, 1.1, 6.95, 3.15, 2.0, 7.2);
    // keyboard, mug, lamp, bell, papers
    B.rbox(1.95, 1.055, 6.45, 0.42, 0.02, 0.14, 0.05, M.dark, z);
    B.cyl(2.5, 1.1, 6.4, 0.04, 0.035, 0.1, M.chairCoral, z);
    B.rbox(2.35, 1.045, 6.75, 0.3, 0.01, 0.22, 0.2, M.paper, z);
    B.cyl(0.95, 1.06, 6.85, 0.07, 0.08, 0.04, M.dark, z);
    B.cyl(0.95, 1.3, 6.85, 0.012, 0.012, 0.46, M.steel, z);
    // chair behind the desk
    B.cyl(2.1, 0.48, 5.5, 0.24, 0.24, 0.08, M.fabric, z);
    B.cyl(2.1, 0.24, 5.5, 0.03, 0.03, 0.44, M.dark, z);
    B.rbox(2.1, 0.78, 5.27, 0.42, 0.5, 0.06, 0, M.fabric, z);
    // status board (TV on the north wall, east side)
    B.box(2.4, 1.25, 0.0, 5.6, 2.35, 0.06, M.dark, z);
    const boardTex = dynamicCanvasTexture(1024, 352);
    const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.03), Materials.basic('boardScreen', { map: boardTex.tex }));
    boardMesh.position.set(4.0, 1.8, 0.065);
    this.dynamicRoot.add(boardMesh);
    this.screens.board = { mesh: boardMesh, ...boardTex };
    this.addInteract('board', 2.4, 1.2, 0.0, 5.6, 2.4, 0.5);
    // wall clock above the corridor opening
    const clockTex = dynamicCanvasTexture(256, 256);
    const clock = new THREE.Mesh(new THREE.CircleGeometry(0.22, 32), Materials.basic('clockFace', { map: clockTex.tex }));
    clock.position.set(-2.2, 2.35, 0.03);
    this.dynamicRoot.add(clock);
    this.screens.clock = { mesh: clock, ...clockTex };
    // signage
    this.sign(B, 9, 0, 2.6, 0.02, 0, z, 0.8); // TREATMENT ROOMS
    this.sign(B, 7, 2.1, 2.45, 6.98, Math.PI, z, 0.9); // RECEPTION (above window)
    this.sign(B, 10, -6.97, 2.0, 4.0, Math.PI / 2, z, 0.8); // please wait
    this.sign(B, 14, -4.3, 2.55, 0.02, 0, z, 0.6); // waiting area
    // waiting area seating
    const mats = [M.chairMint, M.chairCoral, M.chairLilac, M.chairYellow];
    this.chairRow(B, -6.6, 1.6, 6, 0, 0.6, Math.PI / 2, mats, z);
    this.chairRow(B, -5.9, 6.55, 5, 0.6, 0, Math.PI, [M.chairYellow, M.chairMint, M.chairCoral, M.chairLilac], z);
    this.chairRow(B, -2.4, 1.6, 3, 0, 0.6, -Math.PI / 2, [M.chairLilac, M.chairCoral, M.chairMint], z);
    // coffee table with magazines
    this.table(B, -5.0, 3.2, -3.9, 4.6, 0.42, M.wood, M.steel, z);
    for (let i = 0; i < 4; i++) {
      const c = [M.chairCoral, M.blue, M.yellow, M.paper][i];
      B.rbox(-4.6 + i * 0.12, 0.43 + i * 0.006, 3.6 + (i % 2) * 0.3, 0.22, 0.008, 0.3, 0.3 * i, c, z);
    }
    // fish tank on a cabinet along the north wall
    this.cabinet(B, -5.4, 0.08, -3.8, 0.6, 0.75, M.counterPink, z, { face: 'z+' });
    B.box(-5.3, 0.79, 0.14, -3.9, 1.27, 0.55, M.water, z, { castShadow: false });
    B.box(-5.32, 0.75, 0.12, -3.88, 0.79, 0.57, M.dark, z);
    B.box(-5.32, 1.27, 0.12, -3.88, 1.3, 0.57, M.dark, z);
    B.box(-5.25, 0.79, 0.18, -3.95, 0.84, 0.5, M.orange, z);
    this.fish = [];
    for (let i = 0; i < 3; i++) {
      const fm = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), Materials.basic('fish' + i, { color: [0xff9a3a, 0xffd23a, 0xff5a7a][i] }));
      fm.scale.set(1.6, 1, 0.6);
      this.dynamicRoot.add(fm);
      this.fish.push({ mesh: fm, phase: i * 2.1, speed: 0.5 + i * 0.17 });
    }
    // water cooler & plants
    B.box(-6.75, 0, 0.25, -6.35, 1.0, 0.65, M.white, z);
    B.cyl(-6.55, 1.2, 0.45, 0.14, 0.14, 0.38, M.water, z);
    B.collider(-6.8, 0.2, -6.3, 0.7);
    this.plant(B, -6.55, 6.5, z, 1.2);
    this.plant(B, 6.55, 0.5, z, 1.1);
    this.plant(B, -1.4, 0.5, z, 0.9);
    // kids corner rug & toys
    B.box(-3.6, 0, 5.0, -2.6, 0.012, 6.1, M.chairLilac, z);
    B.sphere(-3.3, 0.1, 5.4, 0.1, M.red, z);
    B.rbox(-2.9, 0.07, 5.7, 0.14, 0.14, 0.14, 0.4, M.yellow, z);
    // posters
    this.poster(B, 0, -6.97, 1.6, 2.2, Math.PI / 2, z);
    this.poster(B, 4, -6.97, 1.6, 5.4, Math.PI / 2, z);
    this.poster(B, 1, -2.7, 1.6, 0.02, 0, z);
    this.poster(B, 6, 6.97, 1.6, 4.5, -Math.PI / 2, z);
    this.poster(B, 2, 6.97, 1.6, 2.4, -Math.PI / 2, z);
    // a pet-food display stand by the east wall
    this.cabinet(B, 6.4, 1.6, 6.98, 3.0, 1.2, M.white, z, { face: 'x-' });
    for (let i = 0; i < 6; i++) {
      const c = [M.chairCoral, M.blue, M.yellow, M.green, M.chairLilac, M.orange][i];
      B.box(6.5, 1.2, 1.7 + i * 0.21, 6.85, 1.45, 1.86 + i * 0.21, c, z);
    }
    // security camera in the waiting area
    this.secCam(B, -0.85, 2.6, 0.35, Math.PI - 0.6, z);
    // spots
    this.spots.deskStand = new THREE.Vector3(2.15, 0, 5.55);
    this.spots.waiting = [
      { pos: new THREE.Vector3(-6.6, 0.47, 2.2), yaw: Math.PI / 2, chair: true },
      { pos: new THREE.Vector3(-6.6, 0.47, 3.4), yaw: Math.PI / 2, chair: true },
      { pos: new THREE.Vector3(-6.6, 0.47, 4.6), yaw: Math.PI / 2, chair: true },
      { pos: new THREE.Vector3(-5.3, 0.47, 6.55), yaw: Math.PI, chair: true },
      { pos: new THREE.Vector3(-4.1, 0.47, 6.55), yaw: Math.PI, chair: true },
      { pos: new THREE.Vector3(-2.4, 0.47, 2.2), yaw: -Math.PI / 2, chair: true },
      { pos: new THREE.Vector3(-2.4, 0.47, 2.8), yaw: -Math.PI / 2, chair: true },
      { pos: new THREE.Vector3(-3.3, 0.0, 2.6), yaw: Math.PI * 0.75, chair: false },
      { pos: new THREE.Vector3(-5.6, 0.0, 5.2), yaw: Math.PI * 0.4, chair: false },
    ];
  }

  buildVestibule(B, M) {
    const z = 'vestibule';
    // intake platform (ledge) in front of the window
    B.box(1.2, 0, 7.16, 3.2, 0.88, 7.95, M.counterMint, z);
    B.box(1.15, 0.88, 7.16, 3.25, 0.92, 8.0, M.ledge, z);
    B.collider(1.15, 7.16, 3.25, 8.0);
    this.lighting.addOccluder(1.15, 7.16, 3.25, 8.0, 0.5);
    // shutter housing above the window (vestibule side)
    B.box(1.1, 2.05, 7.16, 3.3, 2.3, 7.4, M.grey, z);
    this.sign(B, 11, 2.2, 2.45, 7.17, 0, z, 0.7);
    // window frame vestibule side
    B.box(1.12, 0.92, 7.16, 1.2, 2.05, 7.22, M.trim, z);
    B.box(3.2, 0.92, 7.16, 3.28, 2.05, 7.22, M.trim, z);
    // bench
    B.box(3.6, 0.4, 9.6, 4.5, 0.46, 10.25, M.wood, z);
    B.box(3.65, 0, 9.65, 3.7, 0.4, 10.2, M.steel, z);
    B.box(4.4, 0, 9.65, 4.45, 0.4, 10.2, M.steel, z);
    B.collider(3.6, 9.6, 4.6, 10.3);
    // security cameras
    this.secCam(B, 4.45, 2.6, 10.25, Math.PI + 0.75, z);
    this.secCam(B, 0.72, 1.55, 8.4, Math.PI / 2 + 0.6, z);
    // plant
    this.plant(B, 0.95, 10.05, z, 0.8);
    // automatic sliding glass doors (storefront gap 1.8..3.4 at z 10.48)
    const panelMat = Materials.basic('slideGlass', { color: 0xa9cbd9, transparent: true, opacity: 0.18, depthWrite: false });
    const frameEntry = Materials.dynamic('slideFrame', { color: 0x9aa0a8, roughness: 0.4, metalness: 0.3 });
    const panels = [];
    for (const [x0, dx] of [[2.2, -0.78], [3.0, 0.78]]) {
      const g = new THREE.Group();
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 2.36), panelMat);
      glass.position.y = 1.2;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.4, 0.04), frameEntry.mat);
      frame.position.y = 1.2;
      frame.scale.set(1, 1, 1);
      const inner = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.28, 0.05), Materials.basic('slideHole', { color: 0x000000 }));
      inner.visible = false;
      // thin frame bars instead of a solid box
      const bars = new THREE.Group();
      for (const [w, h, x, y] of [[0.8, 0.05, 0, 2.38], [0.8, 0.05, 0, 0.02], [0.04, 2.4, -0.38, 1.2], [0.04, 2.4, 0.38, 1.2]]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), frameEntry.mat);
        b.position.set(x, y, 0);
        bars.add(b);
      }
      g.add(glass, bars);
      g.position.set(x0, 0, 10.48);
      this.dynamicRoot.add(g);
      panels.push({ mesh: g, x0, dx });
    }
    this.doors.set('outer', {
      id: 'outer', slide: true, panels, leaves: [], open: 0, target: 0, zone: 'vestibule', probe: [frameEntry], locked: null,
      center: new THREE.Vector3(2.6, 1, 10.48), collider: this.addDoorCollider(1.8, 10.4, 3.4, 10.56), npcOnly: true,
    });
    this.spots.platform = new THREE.Vector3(2.2, 0.92, 7.6);
    this.spots.platformYaw = Math.PI;
  }

  buildCorridor(B, M) {
    const z = 'corridor';
    // handrails
    for (const x of [-0.97, 0.97]) {
      const s = Math.sign(x);
      const segs = s < 0
        ? [[-0.2, -2.25], [-3.35, -7.15], [-8.25, -11.55], [-12.65, -15.95], [-17.05, -23.8]]
        : [[-0.2, -2.25], [-3.35, -7.35], [-8.85, -12.55], [-13.65, -16.55], [-17.65, -23.8]];
      for (const [a, b] of segs) B.box(x - 0.025, 0.88, b, x + 0.025, 0.93, a, M.steel, z);
    }
    // painted guide stripe with paw prints
    B.box(-0.12, 0, -23.5, 0.12, 0.003, -0.3, M.chairMint, z);
    // room signs
    this.sign(B, 0, -0.98, 2.35, -2.8 + 0.85, Math.PI / 2, z, 0.48);
    this.sign(B, 1, -0.98, 2.35, -7.7 + 0.85, Math.PI / 2, z, 0.48);
    this.sign(B, 4, -0.98, 2.35, -12.1 + 0.85, Math.PI / 2, z, 0.48);
    this.sign(B, 5, -0.98, 2.35, -16.5 + 0.85, Math.PI / 2, z, 0.48);
    this.sign(B, 2, 0.98, 2.35, -2.8 - 0.85, -Math.PI / 2, z, 0.48);
    this.sign(B, 3, 0.98, 2.35, -8.1 - 1.05, -Math.PI / 2, z, 0.48);
    this.sign(B, 6, 0.98, 2.35, -13.1 - 0.85, -Math.PI / 2, z, 0.48);
    this.sign(B, 12, 0.98, 2.35, -17.1 - 0.85, -Math.PI / 2, z, 0.48);
    // exit sign (unlit material so it glows in the dark)
    this.sign(B, 8, 0, 2.42, -23.97, 0, z, 0.42, M.exitGlow);
    // gurney near the end
    B.box(-0.9, 0.62, -21.8, -0.35, 0.72, -19.9, M.vinyl, z);
    B.box(-0.88, 0.55, -21.75, -0.37, 0.6, -19.95, M.steel, z);
    for (const [x, zz] of [[-0.85, -21.7], [-0.4, -21.7], [-0.85, -20.0], [-0.4, -20.0]]) {
      B.box(x - 0.015, 0.06, zz - 0.015, x + 0.015, 0.56, zz + 0.015, M.steel, z);
      B.sphere(x, 0.05, zz, 0.05, M.dark, z);
    }
    B.collider(-1, -21.85, -0.32, -19.85);
    this.lighting.addOccluder(-0.95, -21.8, -0.33, -19.9, 0.4);
    // fire extinguisher + bench
    B.cyl(0.9, 0.55, -5.6, 0.07, 0.07, 0.5, M.red, z);
    B.box(0.94, 1.0, -5.75, 0.98, 1.3, -5.45, M.red, z);
    B.box(-0.98, 0.42, -18.7, -0.6, 0.47, -17.4, M.wood, z);
    B.box(-0.95, 0, -18.6, -0.65, 0.42, -18.55, M.steel, z);
    B.box(-0.95, 0, -17.55, -0.65, 0.42, -17.5, M.steel, z);
    B.collider(-1, -18.75, -0.58, -17.35);
    // posters
    this.poster(B, 5, -0.98, 1.55, -5.6, Math.PI / 2, z, 0.5);
    this.poster(B, 7, 0.98, 1.55, -19.6, -Math.PI / 2, z, 0.5);
    // security cameras
    this.secCam(B, 0.82, 2.58, -0.4, Math.PI, z);
    this.secCam(B, -0.82, 2.58, -23.7, 0, z);
    // exit door (locked)
    B.box(-0.5, 0, -24.02, 0.5, 2.15, -23.98, M.grey, z);
    B.box(-0.4, 1.0, -23.98, 0.4, 1.06, -23.94, M.steel, z);
    B.collider(-0.55, -24.16, 0.55, -23.95);
    this.addInteract('door:exit', -0.55, 0, -24.05, 0.55, 2.2, -23.7, { locked: 'Emergency exit. Alarmed and chained from outside.' });
    // dynamic doors
    this.addDoor('room1', -1.0, -3.3, -2.3, 'x-', 'room1');
    this.addDoor('room2', -1.0, -8.2, -7.2, 'x-', 'room2');
    this.addDoor('pharmacy', -1.0, -12.6, -11.6, 'x-', 'pharmacy');
    this.addDoor('staff', -1.0, -17.0, -16.0, 'x-', 'staff');
    this.addDoor('room3', 1.0, -3.3, -2.3, 'x+', 'room3');
    this.addDoor('surgery', 1.0, -8.8, -7.4, 'x+', 'surgery', true);
    this.addDoor('utility', 1.0, -13.6, -12.6, 'x+', 'utility');
    this.addDoor('storage', 1.0, -17.6, -16.6, 'x+', 'storage', false, 'Storage. Locked. Something inside shifts when you touch the handle.');
    // inner vestibule door (only opens on admit / discharge)
    this.addDoor('inner', 4.5, 7.0, 7.16, 'inner', 'reception', false, 'Intake door. Opens only with the door release on the desk.');
  }

  // Door frames and hinged leaves. dir: 'x-' room to the west (door opens west)
  addDoor(id, x, a, b, dir, zone, double = false, locked = null) {
    const M = this.M;
    const B = this.B;
    const w = b - a;
    const group = new THREE.Group();
    const color = locked ? 0x8b8f9c : id === 'surgery' ? 0xd7e7ea : 0xb7d3e8;
    const probeEntry = Materials.dynamic('door:' + id, { color, roughness: 0.5 });
    const mat = probeEntry.mat;
    const handleMat = Materials.dynamic('doorHandle:' + id, { color: 0xd8dade, metalness: 0.7, roughness: 0.3 });
    const leaves = [];
    if (dir === 'inner') {
      // swinging door in the reception south wall, hinge at x = 4.5, opens north
      const pivot = new THREE.Group();
      pivot.position.set(4.5, 0, 7.08);
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.12, 0.05), mat);
      leaf.position.set(-0.45, 1.06, 0);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.5), Materials.basic('doorWin', { color: 0x1b2730 }));
      win.position.set(-0.45, 1.5, -0.03);
      win.rotation.y = Math.PI;
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.04), handleMat.mat);
      handle.position.set(-0.78, 1.0, -0.05);
      leaf.add(win);
      pivot.add(leaf);
      pivot.add(handle);
      group.add(pivot);
      leaves.push({ pivot, sign: -1 });
      // frame
      B.box(3.56, 0, 6.98, 3.6, 2.19, 7.18, M.trim, 'reception');
      B.box(4.5, 0, 6.98, 4.54, 2.19, 7.18, M.trim, 'reception');
      B.box(3.56, 2.15, 6.98, 4.54, 2.19, 7.18, M.trim, 'reception');
      this.doors.set(id, {
        id, group, leaves, open: 0, target: 0, zone, probe: [probeEntry, handleMat], locked,
        center: new THREE.Vector3(4.05, 1, 7.08),
        collider: this.addDoorCollider(3.6, 7.0, 4.5, 7.16),
        npcOnly: true,
      });
      this.addInteract('door:' + id, 3.6, 0, 6.9, 4.5, 2.15, 7.25, { door: id });
      this.dynamicRoot.add(group);
      return;
    }
    const sideSign = dir === 'x-' ? -1 : 1; // room side relative to corridor
    // frame trims: jambs span the wall thickness, plus a lip on the corridor face
    const fx0 = sideSign < 0 ? x - 0.16 : x;
    const fx1 = sideSign < 0 ? x + 0.02 : x + 0.16 + 0.0;
    const lipX0 = sideSign < 0 ? x : x - 0.02;
    const lipX1 = sideSign < 0 ? x + 0.02 : x;
    B.box(fx0, 0, a - 0.06, fx1, 2.2, a, M.trim, 'corridor');
    B.box(fx0, 0, b, fx1, 2.2, b + 0.06, M.trim, 'corridor');
    B.box(lipX0, 2.15, a - 0.06, lipX1, 2.21, b + 0.06, M.trim, 'corridor');
    const makeLeaf = (hingeZ, width, swingSign) => {
      const pivot = new THREE.Group();
      // door sits inside the wall thickness, toward the room side
      const px = x + sideSign * 0.1;
      pivot.position.set(px, 0, hingeZ);
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.045, 2.1, width - 0.02), mat);
      leaf.position.set(0, 1.05, swingSign * (width / 2));
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.13), handleMat.mat);
      handle.position.set(-sideSign * 0.04, 1.0, swingSign * (width - 0.12));
      const handle2 = handle.clone();
      handle2.position.x = sideSign * 0.04;
      if (double) {
        const win = new THREE.Mesh(new THREE.CircleGeometry(0.13, 16), Materials.basic('surgWin', { color: 0x223038 }));
        win.position.set(-sideSign * 0.024, 1.5, swingSign * (width / 2));
        win.rotation.y = -sideSign * Math.PI / 2;
        pivot.add(win);
      }
      pivot.add(leaf, handle, handle2);
      group.add(pivot);
      leaves.push({ pivot, sign: swingSign * sideSign });
    };
    if (double) {
      makeLeaf(a, w / 2, 1);
      makeLeaf(b, w / 2, -1);
    } else {
      makeLeaf(a, w, 1);
    }
    this.dynamicRoot.add(group);
    const cx0 = sideSign < 0 ? x - 0.16 : x;
    const cx1 = sideSign < 0 ? x : x + 0.16;
    const door = {
      id, group, leaves, open: locked ? 0 : 1, target: locked ? 0 : 1, zone, probe: [probeEntry, handleMat], locked,
      center: new THREE.Vector3(x, 1, (a + b) / 2),
      collider: this.addDoorCollider(cx0, a, cx1, b),
    };
    this.doors.set(id, door);
    const ix0 = Math.min(x - 0.35, x + sideSign * 0.3);
    const ix1 = Math.max(x + 0.35, x + sideSign * 0.3);
    this.addInteract('door:' + id, ix0, 0, a, ix1, 2.15, b, { door: id });
  }

  addDoorCollider(x0, z0, x1, z1) {
    const c = { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), enabled: false, door: true };
    this.colliders.push(c);
    return c;
  }

  buildExamRoom(B, M, zone, side, index) {
    const zr = this.lighting.zones.get(zone);
    const x0 = zr.min.x;
    const x1 = zr.max.x;
    const z0 = zr.min.z;
    const z1 = zr.max.z;
    const cz = (z0 + z1) / 2;
    const farX = side < 0 ? x0 : x1; // outer wall x
    const s = side; // direction from corridor into room is -1 for west rooms
    const inX = (d) => (s < 0 ? -1.16 - d : 1.16 + d); // distance from corridor wall into room
    // patient bed (padded exam table) in the middle
    const bx = inX(2.9);
    const bed = { x0: bx - 0.42, x1: bx + 0.42, z0: cz - 0.8, z1: cz + 0.8 };
    B.box(bed.x0, 0.62, bed.z0, bed.x1, 0.72, bed.z1, M.vinyl, zone);
    B.box(bed.x0 + 0.03, 0.56, bed.z0 + 0.03, bed.x1 - 0.03, 0.62, bed.z1 - 0.03, M.steel, zone);
    for (const [lx, lz] of [[bed.x0 + 0.06, bed.z0 + 0.06], [bed.x1 - 0.06, bed.z0 + 0.06], [bed.x0 + 0.06, bed.z1 - 0.06], [bed.x1 - 0.06, bed.z1 - 0.06]]) {
      B.box(lx - 0.02, 0.05, lz - 0.02, lx + 0.02, 0.56, lz + 0.02, M.steel, zone);
      B.sphere(lx, 0.045, lz, 0.045, M.dark, zone);
    }
    // lower shelf (a dark gap beneath where things can hide)
    B.box(bed.x0 + 0.05, 0.16, bed.z0 + 0.05, bed.x1 - 0.05, 0.18, bed.z1 - 0.05, M.steel, zone);
    B.collider(bed.x0, bed.z0, bed.x1, bed.z1);
    this.lighting.addOccluder(bed.x0, bed.z0, bed.x1, bed.z1, 0.75);
    // counter with sink along the far wall
    const cx0 = s < 0 ? x0 : x1 - 0.62;
    const cx1 = s < 0 ? x0 + 0.62 : x1;
    this.cabinet(B, cx0, z0 + 0.4, cx1, z0 + 2.6, 0.88, M.white, zone, { top: M.counter, face: s < 0 ? 'x+' : 'x-' });
    B.box(cx0 + 0.12, 0.86, z0 + 0.7, cx1 - 0.12, 0.93, z0 + 1.2, M.steel, zone);
    B.cyl((cx0 + cx1) / 2 + s * 0.2, 1.05, z0 + 0.95, 0.015, 0.015, 0.25, M.steel, zone);
    // upper cabinets
    B.box(s < 0 ? x0 : x1 - 0.35, 1.6, z0 + 0.4, s < 0 ? x0 + 0.35 : x1, 2.3, z0 + 2.6, M.white, zone);
    // stool, monitor stand, lamp, bin
    const stoolX = inX(1.9);
    B.cyl(stoolX, 0.55, cz + 1.25, 0.18, 0.18, 0.06, M.dark, zone);
    B.cyl(stoolX, 0.27, cz + 1.25, 0.025, 0.025, 0.5, M.steel, zone);
    B.cyl(stoolX, 0.03, cz + 1.25, 0.2, 0.2, 0.04, M.dark, zone);
    // vital monitor on a pole
    const mx = inX(2.2);
    const mz = cz - 1.25;
    B.cyl(mx, 0.6, mz, 0.02, 0.02, 1.2, M.steel, zone);
    B.cyl(mx, 0.03, mz, 0.22, 0.22, 0.04, M.dark, zone);
    B.rbox(mx, 1.35, mz, 0.36, 0.28, 0.12, s < 0 ? -Math.PI / 2 : Math.PI / 2, M.dark, zone);
    B.collider(mx - 0.2, mz - 0.2, mx + 0.2, mz + 0.2);
    const vitalTex = dynamicCanvasTexture(256, 192);
    const vital = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.23), Materials.basic('vital:' + zone, { map: vitalTex.tex }));
    vital.position.set(mx - s * 0.065, 1.35, mz);
    vital.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2;
    this.dynamicRoot.add(vital);
    this.screens['vital:' + zone] = { mesh: vital, ...vitalTex };
    // bin + sharps
    B.cyl(inX(0.5), 0.22, z0 + 0.35, 0.16, 0.14, 0.44, M.grey, zone);
    B.box(inX(0.3) - 0.08, 1.2, z1 - 0.03, inX(0.3) + 0.08, 1.45, z1, M.red, zone);
    // poster + exam lamp on the far wall
    this.poster(B, 7, farX - s * 0.02, 1.6, cz + 1.4, s < 0 ? Math.PI / 2 : -Math.PI / 2, zone, 0.55);
    this.poster(B, index === 0 ? 4 : 5, farX - s * 0.02, 1.6, cz - 0.3, s < 0 ? Math.PI / 2 : -Math.PI / 2, zone, 0.5);
    B.cyl(bx, 2.55, cz, 0.02, 0.02, 0.5, M.steel, zone);
    B.cyl(bx, 2.28, cz, 0.18, 0.12, 0.08, M.white, zone);
    // weighing scale by the door
    B.box(inX(0.8) - 0.3, 0, z1 - 0.9, inX(0.8) + 0.3, 0.06, z1 - 0.4, M.grey, zone);
    const bedTop = new THREE.Vector3(bx, 0.72, cz);
    this.spots[zone] = {
      bed: bedTop,
      yaw: s < 0 ? Math.PI / 2 : -Math.PI / 2, // facing the corridor/door side
      under: new THREE.Vector3(bx, 0.1, cz),
      door: new THREE.Vector3(s < 0 ? -1.6 : 1.6, 0, (zone === 'room2' ? -7.7 : -2.8)),
      examCam: new THREE.Vector3(bx - s * 1.05, 1.45, cz + 0.6),
      monitor: new THREE.Vector3(mx, 1.35, mz),
    };
    this.addInteract('bed:' + zone, bed.x0 - 0.05, 0.4, bed.z0, bed.x1 + 0.05, 1.3, bed.z1);
  }

  buildSurgery(B, M) {
    const z = 'surgery';
    const cx = 3.9;
    const cz = -8.1;
    // surgical table
    B.box(cx - 0.35, 0.85, cz - 0.9, cx + 0.35, 0.92, cz + 0.9, M.vinyl, z);
    B.box(cx - 0.3, 0.8, cz - 0.85, cx + 0.3, 0.85, cz + 0.85, M.steel, z);
    B.cyl(cx, 0.42, cz, 0.12, 0.16, 0.8, M.steel, z);
    B.box(cx - 0.35, 0, cz - 0.5, cx + 0.35, 0.06, cz + 0.5, M.steel, z);
    B.collider(cx - 0.36, cz - 0.92, cx + 0.36, cz + 0.92);
    this.lighting.addOccluder(cx - 0.35, cz - 0.9, cx + 0.35, cz + 0.9, 0.6);
    // big surgical lamp
    B.cyl(cx, 2.55, cz, 0.03, 0.03, 0.5, M.steel, z);
    B.cyl(cx, 2.25, cz, 0.42, 0.32, 0.14, M.white, z);
    const lampFace = new THREE.CircleGeometry(0.3, 24);
    lampFace.rotateX(Math.PI / 2);
    B.place(lampFace, this.lighting.tubeMats[5], z, cx, 2.175, cz, 0, { keepUV: true, castShadow: false });
    // anesthesia machine
    B.box(5.6, 0, cz - 1.5, 6.4, 1.3, cz - 0.8, M.grey, z);
    B.box(5.7, 1.3, cz - 1.4, 6.3, 1.7, cz - 0.9, M.dark, z);
    B.cyl(5.75, 0.5, cz - 0.65, 0.08, 0.08, 1.0, M.green, z);
    B.cyl(5.95, 0.5, cz - 0.65, 0.08, 0.08, 1.0, M.blue, z);
    B.collider(5.55, cz - 1.55, 6.45, cz - 0.55);
    // instrument tray
    this.table(B, 2.3, cz + 0.6, 2.9, cz + 1.0, 0.95, M.steel, M.steel, z);
    // IV stand
    B.cyl(4.9, 1.0, cz + 1.2, 0.015, 0.015, 2.0, M.steel, z);
    B.cyl(4.9, 2.0, cz + 1.2, 0.06, 0.06, 0.18, M.water, z);
    // cabinets along the east wall
    this.cabinet(B, 6.4, -10.8, 6.98, -9.6, 1.9, M.white, z, { face: 'x-' });
    this.cabinet(B, 6.4, -6.6, 6.98, -5.4, 0.9, M.white, z, { face: 'x-', top: M.steel });
    this.spots.surgery = {
      bed: new THREE.Vector3(cx, 0.92, cz),
      yaw: -Math.PI / 2,
      door: new THREE.Vector3(1.8, 0, -8.1),
      examCam: new THREE.Vector3(cx - 1.1, 1.6, cz + 0.4),
    };
    this.addInteract('bed:surgery', cx - 0.45, 0.6, cz - 0.95, cx + 0.45, 1.5, cz + 0.95);
  }

  buildPharmacy(B, M) {
    const z = 'pharmacy';
    // shelving along the west wall with colourful boxes
    const r = this.rng;
    const cols = [M.chairCoral, M.blue, M.yellow, M.green, M.chairLilac, M.orange, M.white, M.chairMint];
    for (const [z0, z1] of [[-13.8, -12.3], [-11.9, -10.4]]) {
      B.box(-7.0, 0, z0, -6.6, 2.1, z0 + 0.04, M.steel, z);
      B.box(-7.0, 0, z1 - 0.04, -6.6, 2.1, z1, M.steel, z);
      for (let lvl = 0; lvl < 5; lvl++) {
        const y = 0.15 + lvl * 0.45;
        B.box(-7.0, y, z0, -6.6, y + 0.025, z1, M.steel, z);
        let zz = z0 + 0.06;
        while (zz < z1 - 0.12) {
          const w = r.range(0.08, 0.2);
          const hh = r.range(0.12, 0.3);
          B.box(-6.95, y + 0.025, zz, -6.95 + r.range(0.2, 0.34), y + 0.025 + hh, zz + w, r.pick(cols), z);
          zz += w + r.range(0.01, 0.04);
        }
      }
      B.collider(-7, z0, -6.6, z1);
    }
    // locked medicine cabinet with glass doors on the north wall (interactive)
    B.box(-5.2, 0.0, -13.98, -2.6, 2.0, -13.55, M.white, z);
    const cabGlass = new THREE.PlaneGeometry(2.4, 1.0);
    cabGlass.translate(-3.9, 1.45, -13.54);
    B.add(cabGlass, M.glass, z, { keepUV: true, castShadow: false });
    for (let lvl = 0; lvl < 2; lvl++) {
      for (let i = 0; i < 12; i++) {
        const y = 1.05 + lvl * 0.45;
        B.box(-5.1 + i * 0.2, y, -13.9, -4.98 + i * 0.2, y + r.range(0.12, 0.25), -13.75, r.pick(cols), z);
      }
    }
    B.box(-5.2, 0.9, -13.98, -2.6, 0.95, -13.5, M.counter, z);
    B.collider(-5.25, -14, -2.55, -13.5);
    this.addInteract('pharmacy', -5.2, 0.6, -14.0, -2.6, 2.0, -13.3);
    // fridge
    B.box(-2.4, 0, -13.98, -1.5, 1.8, -13.3, M.white, z);
    B.box(-2.35, 1.0, -13.31, -2.33, 1.5, -13.29, M.steel, z);
    B.collider(-2.45, -14, -1.45, -13.25);
    // counter with computer
    this.cabinet(B, -6.0, -10.75, -3.6, -10.16, 0.9, M.white, z, { top: M.counter, face: 'z-' });
    B.rbox(-4.4, 1.15, -10.45, 0.45, 0.32, 0.05, 0, M.dark, z);
    this.sign(B, 4, -3.9, 2.35, -13.97, 0, z, 0.6);
    this.secCam(B, -6.8, 2.6, -10.4, Math.PI * 0.75, z);
    this.spots.pharmacy = new THREE.Vector3(-3.9, 0, -12.6);
  }

  buildStaff(B, M) {
    const z = 'staff';
    // desk with computer
    this.table(B, -6.9, -18.9, -5.5, -17.9, 0.76, M.wood, M.dark, z);
    B.rbox(-6.5, 1.05, -18.6, 0.5, 0.34, 0.05, 0.3, M.dark, z);
    // couch
    B.box(-4.6, 0.0, -18.95, -2.4, 0.45, -18.1, M.fabric, z);
    B.box(-4.6, 0.45, -18.95, -2.4, 0.9, -18.75, M.fabric, z);
    B.box(-4.6, 0.45, -18.95, -4.4, 0.65, -18.1, M.fabric, z);
    B.box(-2.6, 0.45, -18.95, -2.4, 0.65, -18.1, M.fabric, z);
    B.collider(-4.65, -19, -2.35, -18.05);
    this.lighting.addOccluder(-4.6, -18.95, -2.4, -18.1, 0.5);
    // coffee counter (interactive coffee machine)
    this.cabinet(B, -6.95, -15.9, -6.35, -14.3, 0.9, M.counterPink, z, { top: M.counter, face: 'x+' });
    B.box(-6.9, 0.94, -15.3, -6.5, 1.4, -14.9, M.dark, z);
    B.box(-6.52, 1.1, -15.2, -6.48, 1.3, -15.0, M.led, z);
    B.cyl(-6.62, 0.99, -15.1, 0.04, 0.035, 0.09, M.white, z);
    this.addInteract('coffee', -6.95, 0.9, -15.4, -6.3, 1.5, -14.8);
    // lockers along the north side of east wall
    for (let i = 0; i < 4; i++) {
      const zz = -15.9 + i * 0.42;
      B.box(-1.62, 0, zz, -1.18, 1.9, zz + 0.4, i === 1 ? M.chairCoral : M.blue, z);
      for (let v = 0; v < 4; v++) B.box(-1.63, 1.55 + v * 0.06, zz + 0.1, -1.62, 1.57 + v * 0.06, zz + 0.3, M.dark, z);
    }
    B.collider(-1.65, -15.95, -1.16, -14.2);
    this.addInteract('locker', -1.75, 0.2, -15.6, -1.15, 1.9, -15.0);
    // corkboard with night rules (south wall)
    B.box(-5.2, 1.2, -14.2, -3.4, 2.1, -14.16, M.cork, z);
    for (let i = 0; i < 5; i++) B.box(-5.05 + i * 0.34, 1.35 + (i % 2) * 0.25, -14.21, -4.8 + i * 0.34, 1.65 + (i % 2) * 0.25, -14.2, M.paper, z);
    this.addInteract('rules', -5.2, 1.1, -14.4, -3.4, 2.2, -14.1);
    // time clock by the door
    B.box(-2.0, 1.3, -14.27, -1.7, 1.65, -14.16, M.grey, z);
    B.box(-1.95, 1.5, -14.28, -1.75, 1.6, -14.27, M.ledGreen, z);
    this.addInteract('timeclock', -2.1, 1.2, -14.4, -1.6, 1.8, -14.05);
    // rug, small fridge, plant
    B.box(-5.2, 0, -17.9, -3.0, 0.01, -16.2, M.chairLilac, z);
    this.plant(B, -1.6, -18.6, z, 0.9);
    this.secCam(B, -1.3, 2.6, -18.8, -Math.PI * 0.25, z);
  }

  buildUtility(B, M) {
    const z = 'utility';
    // breaker panel on the east wall
    B.box(6.86, 1.0, -13.9, 6.98, 1.9, -12.9, M.grey, z);
    B.box(6.85, 1.05, -13.85, 6.86, 1.85, -12.95, M.dark, z);
    this.addInteract('breaker', 6.4, 0.9, -14.0, 7.0, 2.0, -12.8);
    this.spots.breaker = new THREE.Vector3(6.2, 1.45, -13.4);
    // water heater, shelves, mop bucket, pipes
    B.cyl(2.0, 0.85, -14.4, 0.32, 0.32, 1.7, M.white, z);
    B.collider(1.65, -14.75, 2.35, -14.05);
    B.box(5.0, 0, -14.98, 6.9, 1.8, -14.6, M.steel, z, {});
    for (let i = 0; i < 4; i++) B.box(5.0, 0.3 + i * 0.45, -14.98, 6.9, 0.33 + i * 0.45, -14.55, M.steel, z);
    for (let i = 0; i < 8; i++) B.cyl(5.2 + i * 0.22, 0.42 + (i % 3) * 0.45, -14.75, 0.08, 0.08, 0.18, i % 2 ? M.blue : M.yellow, z);
    B.collider(5.0, -15, 6.95, -14.5);
    B.cyl(3.0, 0.15, -11.6, 0.18, 0.15, 0.3, M.yellow, z);
    B.cyl(3.05, 0.6, -11.6, 0.012, 0.012, 1.0, M.wood, z, { rz: 0.2 });
    B.box(1.2, 2.55, -14.9, 7.0, 2.62, -14.83, M.grey, z);
    B.box(1.2, 2.45, -11.3, 7.0, 2.52, -11.23, M.steel, z);
    this.sign(B, 13, 6.98, 2.1, -13.4, -Math.PI / 2, z, 0.45);
    this.secCam(B, 6.75, 2.6, -11.4, -Math.PI * 0.8, z);
  }

  buildExterior(B, M) {
    const z = 'outside';
    // facade trim and canopy over the entrance
    B.box(-0.2, 2.9, 10.56, 5.4, 3.05, 12.0, M.grey, z);
    B.box(-0.1, 0, 11.85, 0.0, 2.9, 11.95, M.steel, z);
    B.box(5.2, 0, 11.85, 5.3, 2.9, 11.95, M.steel, z);
    // brand sign on the facade
    this.sign(B, 15, -3.0, 2.5, 7.17, 0, z, 1.6);
    // street lamp
    B.cyl(9.5, 2.6, 16.6, 0.07, 0.09, 5.2, M.dark, z);
    B.box(9.3, 5.15, 15.6, 9.7, 5.3, 16.7, M.dark, z);
    const lampGlow = new THREE.PlaneGeometry(0.3, 0.9);
    lampGlow.rotateX(Math.PI / 2);
    B.place(lampGlow, this.lighting.tubeMats[7], z, 9.5, 5.14, 16.0, 0, { keepUV: true, castShadow: false });
    // parked car (yours)
    B.box(-6.2, 0.25, 13.0, -4.4, 0.9, 17.2, M.car, z);
    B.box(-6.05, 0.9, 13.9, -4.55, 1.35, 16.1, M.car, z);
    B.box(-6.0, 0.95, 13.85, -4.6, 1.3, 13.9, M.glassDark, z);
    for (const [x, zz] of [[-6.2, 13.7], [-4.4, 13.7], [-6.2, 16.5], [-4.4, 16.5]]) B.cyl(x, 0.3, zz, 0.3, 0.3, 0.22, M.rubber, z, { rz: Math.PI / 2 });
    // dumpster & fence hints
    B.box(10.5, 0, 9.0, 12.4, 1.3, 10.2, M.green, z);
    for (let i = 0; i < 14; i++) B.box(-16 + i * 2.6, 0, 30, -15.9 + i * 2.6, 1.4, 30.1, M.dark, z);
    B.box(-16, 1.2, 29.98, 20, 1.26, 30.12, M.dark, z);
    // backdrop
    const bd = new THREE.PlaneGeometry(80, 20);
    const bdm = new THREE.Mesh(bd, M.backdrop);
    bdm.position.set(2, 6, 44);
    bdm.rotation.y = Math.PI;
    this.root.add(bdm);
    const bd2 = bdm.clone();
    bd2.position.set(-30, 6, 20);
    bd2.rotation.y = Math.PI / 2;
    this.root.add(bd2);
    const bd3 = bdm.clone();
    bd3.position.set(32, 6, 20);
    bd3.rotation.y = -Math.PI / 2;
    this.root.add(bd3);
    this.secCam(B, 5.2, 2.85, 10.8, 0.2, z);
    this.spots.outsideSpawn = new THREE.Vector3(7.5, 0, 28);
    this.spots.outsideQueue = [new THREE.Vector3(3.6, 0, 14.5), new THREE.Vector3(5.0, 0, 16.5), new THREE.Vector3(6.4, 0, 18.5)];
  }

  // ---------------------------------------------------------------------
  // Security cameras (render viewpoints). `layer` objects only show on that cam.
  defineCams() {
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    this.cams = [
      { id: 'VEST-A', label: 'Vestibule overhead', pos: V(4.4, 2.52, 10.15), target: V(2.2, 0.95, 7.6), fov: 62, screening: true, zone: 'vestibule', circuit: 0 },
      { id: 'VEST-B', label: 'Vestibule side', pos: V(0.82, 1.52, 8.45), target: V(2.2, 1.05, 7.55), fov: 52, screening: true, zone: 'vestibule', circuit: 0 },
      { id: 'EXT-1', label: 'Entrance (exterior)', pos: V(5.2, 2.8, 10.95), target: V(3.0, 0.4, 18.5), fov: 70, screening: true, zone: 'outside', circuit: 0 },
      { id: 'WAIT', label: 'Waiting area', pos: V(-0.9, 2.55, 0.45), target: V(-5, 0.4, 5), fov: 78, zone: 'reception', circuit: 0 },
      { id: 'HALL-N', label: 'Corridor, looking north', pos: V(0.8, 2.55, -0.5), target: V(0, 1.0, -20), fov: 58, zone: 'corridor', circuit: 0, presence: true },
      { id: 'HALL-S', label: 'Corridor, looking south', pos: V(-0.8, 2.55, -23.6), target: V(0, 0.9, -3), fov: 58, zone: 'corridor', circuit: 0, presence: true },
      { id: 'PHARM', label: 'Pharmacy', pos: V(-6.75, 2.55, -10.45), target: V(-3.5, 0.6, -13.5), fov: 78, zone: 'pharmacy', circuit: 0, presence: true },
      { id: 'UTIL', label: 'Utility room', pos: V(6.7, 2.55, -11.45), target: V(2.4, 0.6, -14.4), fov: 78, zone: 'utility', circuit: 0, presence: true },
      { id: 'FACE', label: 'Intake close-up', pos: V(2.2, 1.95, 8.55), target: V(2.2, 1.18, 7.55), fov: 46, screening: true, zone: 'vestibule', circuit: 0, upgrade: 'cctv2' },
    ];
    return this.cams;
  }

  buildNav() {
    const V = (x, z) => new THREE.Vector3(x, 0, z);
    const nodes = {
      far: V(7.5, 28),
      queue: V(3.6, 14.5),
      outDoor: V(2.6, 11.8),
      vestIn: V(2.6, 9.4),
      platform: V(2.2, 8.3),
      innerV: V(4.05, 8.0),
      innerR: V(4.05, 6.3),
      recE: V(4.4, 4.4),
      recMid: V(1.5, 4.2),
      recW: V(-1.5, 4.2),
      wait: V(-4.4, 2.6),
      corrS: V(0, -0.6),
      c1: V(0, -2.8),
      c2: V(0, -7.7),
      c3: V(0, -8.1),
      c4: V(0, -12.1),
      c5: V(0, -13.1),
      c6: V(0, -16.5),
      c7: V(0, -19.0),
      cEnd: V(0, -22.5),
      room1: V(-2.4, -2.8),
      room2: V(-2.4, -7.7),
      pharmacy: V(-2.4, -12.1),
      staff: V(-2.4, -16.5),
      room3: V(2.4, -2.8),
      surgery: V(2.6, -8.1),
      utility: V(2.4, -13.1),
    };
    const edges = [
      ['far', 'queue'], ['queue', 'outDoor'], ['outDoor', 'vestIn'], ['vestIn', 'platform'], ['vestIn', 'innerV'], ['platform', 'innerV'],
      ['innerV', 'innerR'], ['innerR', 'recE'], ['recE', 'recMid'], ['recMid', 'recW'], ['recW', 'wait'], ['recMid', 'corrS'], ['recW', 'corrS'],
      ['corrS', 'c1'], ['c1', 'c2'], ['c2', 'c3'], ['c3', 'c4'], ['c4', 'c5'], ['c5', 'c6'], ['c6', 'c7'], ['c7', 'cEnd'],
      ['c1', 'room1'], ['c1', 'room3'], ['c2', 'room2'], ['c3', 'surgery'], ['c4', 'pharmacy'], ['c5', 'utility'], ['c6', 'staff'],
    ];
    for (const [k, v] of Object.entries(nodes)) {
      this.nav.nodes.set(k, v);
      this.nav.edges.set(k, []);
    }
    for (const [a, b] of edges) {
      this.nav.edges.get(a).push(b);
      this.nav.edges.get(b).push(a);
    }
  }

  // Breadth-first path between nav nodes -> array of Vector3.
  path(from, to) {
    if (from === to) return [this.nav.nodes.get(to).clone()];
    const prev = new Map([[from, null]]);
    const q = [from];
    while (q.length) {
      const n = q.shift();
      if (n === to) break;
      for (const m of this.nav.edges.get(n) || []) {
        if (!prev.has(m)) {
          prev.set(m, n);
          q.push(m);
        }
      }
    }
    if (!prev.has(to)) return [];
    const out = [];
    for (let n = to; n; n = prev.get(n)) out.unshift(this.nav.nodes.get(n).clone());
    return out;
  }

  nearestNode(p) {
    let best = null;
    let bd = Infinity;
    for (const [k, v] of this.nav.nodes) {
      const d = (v.x - p.x) ** 2 + (v.z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  }

  // Redraw poster atlas with increasing wrongness through the week.
  setPosterWrongness(w) {
    const tex = this.posterMat.map;
    drawPosterAtlas(tex.image, w);
    tex.needsUpdate = true;
  }

  // Animate doors (visual, frame-rate independent damping) & ambient props.
  update(dt, time) {
    for (const d of this.doors.values()) {
      const speed = d.slide ? 2.2 : 3.2;
      if (d.open !== d.target) {
        d.open += clamp(d.target - d.open, -speed * dt, speed * dt);
        d.moving = true;
      } else if (d.moving) {
        d.moving = false;
        this.refreshDoorBox(d);
      }
      if (d.slide) {
        const k = d.open * d.open * (3 - 2 * d.open);
        for (const p of d.panels) p.mesh.position.x = p.x0 + p.dx * k;
      } else {
        const ang = d.open * 1.62;
        for (const l of d.leaves) l.pivot.rotation.y = l.sign * ang;
      }
      d.collider.enabled = d.open < 0.25;
    }
    if (this.fish) {
      for (const f of this.fish) {
        const t = time * f.speed + f.phase;
        f.mesh.position.set(-4.6 + Math.sin(t) * 0.55, 0.95 + Math.sin(t * 1.7) * 0.08, 0.34 + Math.cos(t * 0.8) * 0.1);
        f.mesh.rotation.y = Math.cos(t) > 0 ? 0 : Math.PI;
      }
    }
  }

  // Interaction volume follows the door leaf (so an open door doesn't block
  // prompts for things inside the room).
  refreshDoorBox(d) {
    const it = this.interactables.get('door:' + d.id);
    if (!it || !d.leaves.length) return;
    if (!it.baseBox) it.baseBox = it.box.clone();
    if (d.open < 0.5) {
      it.box.copy(it.baseBox);
      return;
    }
    const b = new THREE.Box3();
    for (const l of d.leaves) {
      l.pivot.updateWorldMatrix(true, true);
      b.expandByObject(l.pivot);
    }
    b.expandByScalar(0.06);
    it.box.copy(b);
  }

  setDoor(id, open) {
    const d = this.doors.get(id);
    if (!d) return;
    d.target = open ? 1 : 0;
  }
}
