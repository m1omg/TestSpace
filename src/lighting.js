// Baked, relightable lighting.
//
// Each ceiling fixture belongs to a power circuit. At load time every static
// vertex receives a per-circuit light amount (plus colour for always-on
// sources such as exit signs) and an ambient-occlusion term. At runtime the
// circuits are scaled by one uniform array: blackouts, flicker and emergency
// lighting are free. Dynamic objects sample the same model at their position.
import * as THREE from 'three';
import { shared, Materials, CIRCUIT_COUNT } from './materials.js';
import { clamp, smoothstep, hash1, noise1, rng } from './core.js';

export const CIRCUITS = [
  { id: 'reception', label: 'Reception & intake', color: [1.0, 0.97, 0.9] },
  { id: 'corridor', label: 'Corridor', color: [0.93, 1.0, 0.96] },
  { id: 'room1', label: 'Exam room 1', color: [1.0, 0.98, 0.94] },
  { id: 'room2', label: 'Exam room 2', color: [1.0, 0.98, 0.94] },
  { id: 'room3', label: 'Exam room 3', color: [1.0, 0.98, 0.94] },
  { id: 'surgery', label: 'Surgery', color: [0.95, 1.0, 1.05] },
  { id: 'back', label: 'Pharmacy, staff & utility', color: [1.0, 0.96, 0.88] },
  { id: 'exterior', label: 'Exterior', color: [1.0, 0.62, 0.3] },
];

const tmpV = new THREE.Vector3();
const tmpB = new THREE.Vector3();

export class Lighting {
  constructor() {
    this.fixtures = [];
    this.staticLights = []; // always-on coloured sources: { pos, color:[r,g,b], radius, zones }
    this.zones = new Map(); // id -> { id, min:{x,y,z}, max:{x,y,z} }
    this.occluders = []; // footprints that darken the floor: { x0,z0,x1,z1, strength }
    this.state = CIRCUITS.map((c, i) => ({
      ...c,
      index: i,
      powered: true,
      level: 1, // smoothed output 0..1
      flicker: 0, // remaining strong flicker seconds
      buzz: 0,
      surge: 0,
    }));
    this.tubeMats = CIRCUITS.map((c, i) =>
      Materials.basic('tube' + i, { color: new THREE.Color(c.color[0], c.color[1], c.color[2]) })
    );
    this.glowMats = CIRCUITS.map((c, i) =>
      Materials.basic('glow' + i, {
        color: new THREE.Color(c.color[0], c.color[1], c.color[2]),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.35,
        fog: false,
      })
    );
    this.generator = false;
    this.flickerReduction = false;
    this.emergency = 0;
    this.time = 0;
    this.master = 1; // global dimmer (title screen etc.)
    this.ambientBase = new THREE.Vector3(0.012, 0.013, 0.02);
    this.bounce = 0.2;
  }

  addZone(id, x0, y0, z0, x1, y1, z1) {
    this.zones.set(id, { id, min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } });
  }

  zoneAt(x, y, z) {
    for (const zone of this.zones.values()) {
      if (x >= zone.min.x - 0.05 && x <= zone.max.x + 0.05 && z >= zone.min.z - 0.05 && z <= zone.max.z + 0.05) {
        if (y >= zone.min.y - 0.5 && y <= zone.max.y + 0.5) return zone.id;
      }
    }
    return null;
  }

  // Fixture: pos, circuit index, zones lit, intensity, radius, emitDown 0..1
  addFixture(f) {
    const fx = {
      pos: f.pos.clone(),
      circuit: f.circuit,
      zones: f.zones,
      intensity: f.intensity ?? 1,
      radius: f.radius ?? 3.2,
      down: f.down ?? 0.75,
    };
    this.fixtures.push(fx);
    return fx;
  }

  addStatic(s) {
    this.staticLights.push({
      pos: s.pos.clone(),
      color: s.color,
      radius: s.radius ?? 2,
      zones: s.zones,
      intensity: s.intensity ?? 1,
    });
  }

  addOccluder(x0, z0, x1, z1, strength = 0.5) {
    this.occluders.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), strength });
  }

  // Light contribution of one source to a point with normal n.
  static contribution(src, px, py, pz, nx, ny, nz, down) {
    const lx = src.pos.x - px;
    const ly = src.pos.y - py;
    const lz = src.pos.z - pz;
    const d2 = lx * lx + ly * ly + lz * lz;
    const d = Math.sqrt(d2) + 1e-4;
    const ix = lx / d;
    const iy = ly / d;
    const iz = lz / d;
    // wrapped lambert keeps the bake soft, like a large diffuse panel
    let lam = (nx * ix + ny * iy + nz * iz + 0.2) / 1.2;
    if (lam <= 0) return 0;
    const emit = (1 - down) + down * clamp(iy, 0, 1);
    const r = src.radius;
    const att = 1 / (1 + (d2 / (r * r)) * 2.2);
    return lam * emit * att * src.intensity;
  }

  ambientOcclusion(zone, px, py, pz, nx, ny, nz) {
    if (!zone) return 1;
    const mn = zone.min;
    const mx = zone.max;
    const dx = Math.min(px - mn.x, mx.x - px);
    const dz = Math.min(pz - mn.z, mx.z - pz);
    const dFloor = py - mn.y;
    const dCeil = mx.y - py;
    let ao = 1;
    if (ny > 0.6) {
      // floors & tops: corners darken
      const dw = Math.max(0, Math.min(dx, dz));
      ao *= 0.6 + 0.4 * smoothstep(0, 0.7, dw);
      if (dFloor < 0.1) {
        for (const o of this.occluders) {
          const ex = Math.max(o.x0 - px, 0, px - o.x1);
          const ez = Math.max(o.z0 - pz, 0, pz - o.z1);
          const e = Math.hypot(ex, ez);
          if (e < 0.45) ao *= 1 - o.strength * (1 - smoothstep(0, 0.45, e));
        }
      }
    } else if (ny < -0.6) {
      const dw = Math.max(0, Math.min(dx, dz));
      ao *= 0.7 + 0.3 * smoothstep(0, 0.6, dw);
    } else {
      // walls & sides: darker near floor and ceiling, and in corners
      ao *= 0.55 + 0.45 * smoothstep(0, 0.55, dFloor);
      ao *= 0.8 + 0.2 * smoothstep(0, 0.35, dCeil);
      const side = Math.abs(nx) > Math.abs(nz) ? dz : dx;
      ao *= 0.72 + 0.28 * smoothstep(0, 0.5, Math.max(0, side));
    }
    return clamp(ao, 0.25, 1);
  }

  // Compute aBakeA / aBakeB / aStatic for a geometry already in world space.
  bake(geo, zoneId) {
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const n = pos.count;
    const A = new Float32Array(n * 4);
    const B = new Float32Array(n * 4);
    const S = new Float32Array(n * 4);
    const zone = this.zones.get(zoneId) || null;
    const fixtures = this.fixtures.filter((f) => f.zones.includes(zoneId));
    const statics = this.staticLights.filter((s) => s.zones.includes(zoneId));
    for (let i = 0; i < n; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const nx = nor.getX(i);
      const ny = nor.getY(i);
      const nz = nor.getZ(i);
      const ao = this.ambientOcclusion(zone, px, py, pz, nx, ny, nz);
      for (const f of fixtures) {
        // direct term + soft omnidirectional bounce (fakes indirect light)
        const dx = f.pos.x - px;
        const dy = f.pos.y - py;
        const dz = f.pos.z - pz;
        const bounce = (f.intensity * this.bounce) / (1 + (dx * dx + dy * dy + dz * dz) / (f.radius * f.radius * 2.5));
        const c = (Lighting.contribution(f, px, py, pz, nx, ny, nz, f.down) + bounce) * ao;
        const ch = f.circuit;
        if (ch < 4) A[i * 4 + ch] += c;
        else B[i * 4 + ch - 4] += c;
      }
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (const s of statics) {
        const c = Lighting.contribution(s, px, py, pz, nx, ny, nz, 0) * ao;
        sr += c * s.color[0];
        sg += c * s.color[1];
        sb += c * s.color[2];
      }
      S[i * 4] = sr;
      S[i * 4 + 1] = sg;
      S[i * 4 + 2] = sb;
      S[i * 4 + 3] = ao;
    }
    geo.setAttribute('aBakeA', new THREE.BufferAttribute(A, 4));
    geo.setAttribute('aBakeB', new THREE.BufferAttribute(B, 4));
    geo.setAttribute('aStatic', new THREE.BufferAttribute(S, 4));
  }

  // Light arriving at a point (for dynamic objects), as a colour vector.
  sample(x, y, z, out, zoneHint) {
    out.set(0, 0, 0);
    const zoneId = zoneHint || this.zoneAt(x, y, z);
    if (!zoneId) return out;
    const circ = shared.uCirc.value;
    for (const f of this.fixtures) {
      if (!f.zones.includes(zoneId)) continue;
      // treat the probe as an upward-facing hemisphere
      const c = Lighting.contribution(f, x, y, z, 0, 1, 0, f.down) * 0.75;
      tmpV.copy(circ[f.circuit]).multiplyScalar(c);
      out.add(tmpV);
    }
    for (const s of this.staticLights) {
      if (!s.zones.includes(zoneId)) continue;
      const c = Lighting.contribution(s, x, y, z, 0, 1, 0, 0) * 0.6;
      out.x += c * s.color[0];
      out.y += c * s.color[1];
      out.z += c * s.color[2];
    }
    return out;
  }

  // Brightness 0..~1 at a point (used for "can you see it" checks, composure).
  brightness(x, y, z, zoneHint) {
    // NB: must not pass tmpV here, sample() uses it internally
    this.sample(x, y, z, tmpB, zoneHint);
    return (tmpB.x + tmpB.y + tmpB.z) / 3;
  }

  // ---------- runtime control ----------
  trip(index) {
    const s = this.state[index];
    if (!s || !s.powered || s.id === 'exterior') return false;
    s.powered = false;
    s.flicker = 0;
    return true;
  }
  reset(index) {
    const s = this.state[index];
    if (!s || s.powered) return false;
    s.powered = true;
    s.flicker = 0.8; // tubes stutter on
    return true;
  }
  isPowered(id) {
    const s = this.state.find((c) => c.id === id);
    return s ? s.powered : true;
  }
  circuitIndex(id) {
    return this.state.findIndex((c) => c.id === id);
  }
  flicker(index, seconds) {
    const s = this.state[index];
    if (s && s.powered) s.flicker = Math.max(s.flicker, seconds);
  }
  // Warning surge: tubes buzz and dim before a failure.
  surge(index, seconds) {
    const s = this.state[index];
    if (s && s.powered) s.surge = Math.max(s.surge, seconds);
  }
  restoreAll() {
    for (const s of this.state) {
      s.powered = true;
      s.flicker = 0;
      s.surge = 0;
      s.level = 1;
    }
  }

  // Called once per rendered frame with real (visual) delta time.
  update(dt) {
    this.time += dt;
    const t = this.time;
    const reduce = this.flickerReduction;
    const circ = shared.uCirc.value;
    for (const s of this.state) {
      let target;
      if (s.powered) {
        target = 1;
        // gentle idle shimmer of old tubes
        target *= 1 - 0.025 * (noise1(t * 3 + s.index * 13.1) * 0.5 + 0.5);
        if (s.surge > 0) {
          s.surge -= dt;
          const k = reduce ? 0.15 : 0.45;
          target *= 1 - k * (noise1(t * 9 + s.index) * 0.5 + 0.5);
        }
        if (s.flicker > 0) {
          s.flicker -= dt;
          if (reduce) {
            target *= 0.7;
          } else {
            const on = hash1(Math.floor(t * 22) + s.index * 7.7) > 0.45;
            target *= on ? 1 : 0.08;
          }
        }
      } else {
        target = this.generator ? 0.16 : 0.0;
      }
      if (s.id === 'exterior') {
        target = 1 - (reduce ? 0.05 : 0.18) * Math.max(0, noise1(t * 1.7) - 0.3);
      }
      // fast response for flicker, slower fade when powering down
      const rate = s.powered ? 40 : 6;
      s.level += (target - s.level) * (1 - Math.exp(-rate * dt));
      const lv = Math.max(0, s.level) * this.master;
      const emergencyTint = !s.powered && this.generator;
      const r = emergencyTint ? 1.0 : s.color[0];
      const g = emergencyTint ? 0.35 : s.color[1];
      const b = emergencyTint ? 0.3 : s.color[2];
      const strength = s.id === 'exterior' ? 1.6 : 2.4;
      circ[s.index].set(r * lv * strength, g * lv * strength, b * lv * strength);
      const tube = this.tubeMats[s.index];
      const tl = s.powered ? Math.max(0.04, lv) : emergencyTint ? 0.25 : 0.03;
      tube.color.setRGB(r * tl * 1.6, g * tl * 1.6, b * tl * 1.6);
      this.glowMats[s.index].opacity = 0.28 * (s.powered ? lv : 0);
    }
    shared.uAmbient.value.copy(this.ambientBase).multiplyScalar(this.master);
  }

  // Average powered level of the circuits (0..1).
  overallLevel() {
    let s = 0;
    for (const c of this.state) if (c.id !== 'exterior') s += c.powered ? 1 : 0;
    return s / (this.state.length - 1);
  }

  randomTrippable(count) {
    const ids = this.state.filter((s) => s.powered && s.id !== 'exterior').map((s) => s.index);
    return rng.shuffle(ids).slice(0, count);
  }
}

export { CIRCUIT_COUNT };
