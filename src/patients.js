// Visitors and patients: generation, intake window, escorting, rooms,
// deterioration, diagnostics and treatment.
import * as THREE from 'three';
import { AnimalModel, randomAppearance } from './animals.js';
import {
  SPECIES, SPECIES_IDS, CONDITIONS, CONDITION_IDS, SIGNS, SIGN_IDS_BY_METHOD, OBVIOUS_DIRECT, SUBTLE_DIRECT,
  PET_NAMES, OWNER_NAMES, OWNER_FIRST, RECORD_ODDITIES, IMPOSSIBLE, SHIFTS, TEST_INFO, SUPPLIES,
} from './data.js';
import { clamp, damp, lerp, lerpAngle, dampAngle, RNG, wrapAngle } from './core.js';

const SPEED = { dog: 1.35, cat: 1.15, rabbit: 1.05, parrot: 0.8, guineapig: 0.85 };
const ROOMS = ['room1', 'room2', 'room3'];
const _v = new THREE.Vector3();
const _probe = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Record generation
// ---------------------------------------------------------------------------
export function generateShiftVisitors(shiftIndex, difficulty, rng, upgrades) {
  const cfg = SHIFTS[shiftIndex];
  let count = cfg.visitors + (difficulty.extraSigns < 0 ? 1 : 0);
  let impostors = cfg.impostors;
  const list = [];
  const usedNames = new Set();
  const idxImp = new Set();
  // never make the first visitor of night one an impostor (tutorial)
  const pool = [];
  for (let i = 0; i < count; i++) if (!(shiftIndex === 0 && i === 0)) pool.push(i);
  for (const i of rng.shuffle(pool).slice(0, impostors)) idxImp.add(i);
  for (let i = 0; i < count; i++) {
    const rec = makeRecord(rng, usedNames, shiftIndex, difficulty, idxImp.has(i));
    rec.order = i;
    list.push(rec);
  }
  // doppelgangers on the last night copy an earlier genuine visitor
  if (cfg.doppel) {
    const impIdx = [...idxImp].sort((a, b) => b - a);
    const late = impIdx.find((i) => i >= 3);
    if (late !== undefined) {
      const sources = list.filter((r, j) => j < late - 1 && !r.impostor);
      if (sources.length) {
        const src = rng.pick(sources);
        const d = list[late];
        d.name = src.name;
        d.species = src.species;
        d.breed = src.breed;
        d.appearance = { ...src.appearance, seed: src.appearance.seed };
        d.owner = src.owner;
        d.phone = src.phone;
        d.age = src.age;
        d.signs = ['doppel'];
        d.doppelOf = src.id;
        d.traits = { ...src.traits };
        d.complaint = src.complaint;
      }
    }
  }
  return list;
}

let recordCounter = 1;

function makeRecord(rng, usedNames, shiftIndex, difficulty, impostor) {
  const cfg = SHIFTS[shiftIndex];
  const species = rng.weighted(SPECIES_IDS, (s) => ({ dog: 3, cat: 3, rabbit: 2, parrot: 1.4, guineapig: 1.4 })[s]);
  const sp = SPECIES[species];
  let name = rng.pick(PET_NAMES);
  for (let k = 0; k < 10 && usedNames.has(name); k++) name = rng.pick(PET_NAMES);
  usedNames.add(name);
  const condId = rng.pick(CONDITION_IDS);
  const cond = CONDITIONS[condId];
  const pronoun = rng.chance(0.5) ? 'her' : 'his';
  const complaint = rng.pick(cond.complaints).replace(/\{name\}/g, name).replace(/\{pr\}/g, pronoun);
  const age = rng.int(sp.age[0], sp.age[1]);
  const appearance = randomAppearance(species, rng);
  // visible illness traits
  const traits = {};
  for (const v of cond.visual) {
    if (v === 'lethargic') traits.lethargic = true;
    if (v === 'limp') traits.limp = true;
    if (v === 'wound') traits.wound = true;
    if (v === 'swelling') traits.swelling = true;
    if (v === 'shiver') traits.shiver = true;
    if (v === 'drool') traits.drool = true;
    if (v === 'cough') traits.cough = true;
    if (v === 'tilt') traits.tilt = true;
  }
  // extra benign oddities (red herrings)
  if (rng.chance(cfg.benign)) {
    const extra = rng.pick(['cone', 'bandage', 'squint', 'pant', 'shiver', 'lethargic']);
    traits[extra] = true;
  }
  if (rng.chance(cfg.benign * 0.4)) traits[rng.pick(['cone', 'bandage', 'squint'])] = true;
  const rec = {
    id: recordCounter++,
    name,
    species,
    breed: rng.pick(sp.breeds),
    age: `${age} year${age === 1 ? '' : 's'}`,
    sex: pronoun === 'her' ? 'Female' : 'Male',
    owner: `${rng.pick(OWNER_FIRST)} ${rng.pick(OWNER_NAMES)}`,
    phone: `555 ${rng.int(100, 999)} ${rng.int(1000, 9999)}`,
    complaint,
    condition: condId,
    traits,
    appearance,
    impostor,
    signs: [],
    startHealth: rng.int(58, 88),
    patience: rng.range(85, 115),
    odd: null,
  };
  if (impostor) {
    rec.signs = pickSigns(rng, shiftIndex, difficulty);
    const oddChance = cfg.recordOddity + (difficulty.extraSigns > 0 ? 0.2 : 0);
    if (rng.chance(oddChance)) {
      const o = rng.pick(RECORD_ODDITIES);
      rec.odd = { field: o.field, value: o.value.replace(/\{name\}/g, name) };
      rec[o.field] = rec.odd.value;
    }
    // which instrument readings are impossible
    const tests = rng.shuffle(['temp', 'heart', 'scan', 'exam']);
    const n = difficulty.extraSigns > 0 ? 3 : 2;
    rec.impossible = {};
    for (const t of tests.slice(0, n)) rec.impossible[t] = true;
    rec.impossibleValues = {
      temp: rng.pick(IMPOSSIBLE.temp),
      heart: rng.pick(IMPOSSIBLE.heart),
      scan: rng.pick(IMPOSSIBLE.scan),
      exam: rng.pick(IMPOSSIBLE.exam),
    };
    rec.revealAfter = rng.range(150, 230);
  }
  return rec;
}

function pickSigns(rng, shiftIndex, difficulty) {
  const cfg = SHIFTS[shiftIndex];
  let count = clamp(cfg.signCount + difficulty.extraSigns, 1, 3);
  const methods = cfg.signMethods.slice();
  while (methods.length < count) methods.push('any');
  const out = [];
  for (let i = 0; i < count; i++) {
    let m = methods[i] || 'any';
    if (m === 'any') m = rng.pick(['direct', 'photo', 'cctv']);
    let pool;
    if (m === 'direct') pool = cfg.subtle ? SUBTLE_DIRECT : shiftIndex <= 1 ? OBVIOUS_DIRECT : SIGN_IDS_BY_METHOD.direct;
    else pool = SIGN_IDS_BY_METHOD[m];
    const choices = pool.filter((s) => !out.includes(s) && !conflicts(s, out));
    if (choices.length) out.push(rng.pick(choices));
  }
  return out;
}

function conflicts(s, list) {
  const eyeSigns = ['noEyes', 'extraEyes', 'extraEyeSmall', 'mismatchedEyes', 'photoEyes'];
  if (eyeSigns.includes(s) && list.some((x) => eyeSigns.includes(x))) return true;
  if (s === 'noMouth' && list.includes('teeth')) return true;
  if (s === 'teeth' && list.includes('noMouth')) return true;
  if ((s === 'bigHead' || s === 'longNeck') && (list.includes('bigHead') || list.includes('longNeck'))) return true;
  if (s === 'photoStatic' && list.includes('photoEyes')) return true;
  if (s === 'photoEyes' && list.includes('photoStatic')) return true;
  if (s === 'camSilhouette' && list.includes('camLimbs')) return true;
  if (s === 'camLimbs' && list.includes('camSilhouette')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Patient entity
// ---------------------------------------------------------------------------
export class Patient {
  constructor(G, rec) {
    this.G = G;
    this.rec = rec;
    this.id = rec.id;
    this.name = rec.name;
    this.species = rec.species;
    this.impostor = rec.impostor;
    this.cond = CONDITIONS[rec.condition];
    this.model = new AnimalModel(rec.appearance, rec.traits, rec.signs);
    G.scene.add(this.model.root);
    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.y = 0;
    this.prevY = 0;
    this.yaw = 0;
    this.prevYaw = 0;
    this.path = [];
    this.onArrive = null;
    this.speed = SPEED[rec.species] || 1;
    this.state = 'arriving';
    this.health = rec.startHealth;
    this.location = 'outside';
    this.spot = null;
    this.patience = rec.patience;
    this.tests = { temp: null, heart: null, scan: null, exam: null };
    this.diagnosis = null;
    this.recovery = 0;
    this.comfortCooldown = 0;
    this.hop = null;
    this.follow = null;
    this.mood = 0;
    this.extraDrain = 0;
    this.timeInClinic = 0;
    this.critical = false;
    this.dead = false;
    this.alarmTimer = 0;
    this.revealTimer = rec.revealAfter || 9999;
    this.darkTimer = 0;
    this.decision = null; // 'admitted' | 'rejected' | 'left'
    this.outcome = null;
    this.observedTime = 0;
    this.vocalTimer = 3 + Math.random() * 6;
    this.knockReact = 0;
    this.attention = null;
    this.waitTimer = 0;
  }

  setPos(p, y = 0) {
    this.pos.set(p.x, 0, p.z);
    this.prevPos.copy(this.pos);
    this.y = y;
    this.prevY = y;
  }

  // Walk along floor points; `perch` (optional) is a final raised spot.
  walk(points, onArrive, perch = null, perchYaw = null) {
    this.path = points.map((p) => new THREE.Vector3(p.x, 0, p.z));
    this.onArrive = onArrive;
    this.perch = perch ? perch.clone() : null;
    this.perchYaw = perchYaw;
    this.follow = null;
    if (this.y > 0.01 && !this.hop) {
      // hop down first, toward where we are going
      const start = this.pos.clone();
      const first = this.path[0] || start;
      const dir = new THREE.Vector3(first.x - start.x, 0, first.z - start.z);
      if (dir.lengthSq() < 1e-4) dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      dir.normalize().multiplyScalar(0.45);
      this.hop = { from: start, fromY: this.y, to: start.clone().add(dir), toY: 0, t: 0, dur: 0.45 };
    }
    this.model.setPose('walk');
  }

  hopTo(target, y, yaw, onDone) {
    this.hop = { from: this.pos.clone(), fromY: this.y, to: new THREE.Vector3(target.x, 0, target.z), toY: y, t: 0, dur: 0.5, yaw, onDone };
    this.model.setPose('walk');
  }

  startFollow(player) {
    this.follow = { queue: [], lastCount: player.trailCount || 0 };
    this.path = [];
    this.perch = null;
    if (this.y > 0.01) {
      const start = this.pos.clone();
      const dir = new THREE.Vector3().subVectors(player.pos, start).setY(0).normalize().multiplyScalar(0.45);
      this.hop = { from: start, fromY: this.y, to: start.clone().add(dir), toY: 0, t: 0, dur: 0.45 };
    }
    this.state = 'following';
    this.model.setPose('walk');
  }

  fixedUpdate(dt) {
    this.prevPos.copy(this.pos);
    this.prevY = this.y;
    this.prevYaw = this.yaw;
    const G = this.G;
    if (this.hop) {
      const h = this.hop;
      h.t += dt / h.dur;
      const k = clamp(h.t, 0, 1);
      this.pos.lerpVectors(h.from, h.to, k);
      this.y = lerp(h.fromY, h.toY, k) + Math.sin(k * Math.PI) * 0.25;
      const dx = h.to.x - h.from.x;
      const dz = h.to.z - h.from.z;
      if (dx * dx + dz * dz > 1e-4) this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 12, dt);
      if (k >= 1) {
        this.y = h.toY;
        this.hop = null;
        if (h.yaw !== undefined && h.yaw !== null) this.yaw = h.yaw;
        if (h.onDone) h.onDone();
      }
      return;
    }
    if (this.follow) {
      this.updateFollow(dt);
      return;
    }
    if (this.path.length) {
      const target = this.path[0];
      const dx = target.x - this.pos.x;
      const dz = target.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const step = this.speed * dt;
      if (d <= step) {
        this.pos.x = target.x;
        this.pos.z = target.z;
        this.path.shift();
        if (!this.path.length) this.arrived();
      } else {
        this.pos.x += (dx / d) * step;
        this.pos.z += (dz / d) * step;
        this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 8, dt);
      }
      this.model.speed = this.speed;
      this.openDoorsNear();
    } else {
      this.model.speed = 0;
    }
  }

  arrived() {
    if (this.perch) {
      const p = this.perch;
      this.perch = null;
      this.hopTo(p, p.y, this.perchYaw, () => {
        this.model.setPose('sit');
        this.model.speed = 0;
        const cb = this.onArrive;
        this.onArrive = null;
        if (cb) cb();
      });
      return;
    }
    this.model.setPose('sit');
    this.model.speed = 0;
    if (this.perchYaw !== null && this.perchYaw !== undefined) this.yaw = this.perchYaw;
    const cb = this.onArrive;
    this.onArrive = null;
    if (cb) cb();
  }

  updateFollow(dt) {
    const pl = this.G.player;
    const f = this.follow;
    // pull new breadcrumbs from the player trail
    const count = pl.trailCount || 0;
    if (count !== f.lastCount) {
      const n = Math.min(count - f.lastCount, pl.trail.length);
      for (let i = pl.trail.length - n; i < pl.trail.length; i++) f.queue.push(pl.trail[i].clone());
      f.lastCount = count;
    }
    const distPlayer = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
    // drop crumbs we are already close to
    while (f.queue.length && Math.hypot(f.queue[0].x - this.pos.x, f.queue[0].z - this.pos.z) < 0.2) f.queue.shift();
    if (distPlayer > 10) {
      // got separated: catch up
      const p = f.queue.length > 3 ? f.queue[f.queue.length - 3] : pl.pos;
      this.pos.set(p.x, 0, p.z);
      this.prevPos.copy(this.pos);
      f.queue.length = 0;
    }
    let moving = false;
    if (distPlayer > 1.1 && f.queue.length) {
      const t = f.queue[0];
      const dx = t.x - this.pos.x;
      const dz = t.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const sp = Math.max(this.speed, Math.min(3.2, distPlayer * 0.9));
      const step = Math.min(d, sp * dt);
      this.pos.x += (dx / d) * step;
      this.pos.z += (dz / d) * step;
      this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 9, dt);
      moving = true;
      this.model.speed = sp;
      this.openDoorsNear();
    } else {
      const dx = pl.pos.x - this.pos.x;
      const dz = pl.pos.z - this.pos.z;
      this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 5, dt);
    }
    this.model.setPose(moving ? 'walk' : 'sit');
    if (!moving) this.model.speed = 0;
  }

  openDoorsNear() {
    for (const d of this.G.level.doors.values()) {
      if (d.locked || d.npcOnly) continue;
      if (d.target < 1 && Math.hypot(d.center.x - this.pos.x, d.center.z - this.pos.z) < 1.3) d.target = 1;
    }
  }

  frameUpdate(dt, alpha) {
    const m = this.model;
    const x = lerp(this.prevPos.x, this.pos.x, alpha);
    const z = lerp(this.prevPos.z, this.pos.z, alpha);
    const y = lerp(this.prevY, this.y, alpha);
    m.root.position.set(x, y, z);
    m.root.rotation.y = lerpAngle(this.prevYaw, this.yaw, alpha);
    m.mood = this.mood;
    m.update(dt, {
      onCough: () => this.G.audio.play('cough', { pos: m.root.position, volume: 0.5, vary: 0.2 }),
    });
    // light probe
    this.G.lighting.sample(x, y + 0.4, z, _probe, this.zoneHint());
    m.setProbe(_probe);
    if (m.blob) m.blob.visible = y < 0.05 || this.state === 'window' || this.location === 'waiting' || ROOMS.includes(this.location) || this.location === 'surgery';
  }

  zoneHint() {
    if (this.location === 'window' || this.state === 'arriving' || this.state === 'leaving') return null;
    return null;
  }

  get stable() {
    return this.state === 'recovering';
  }
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------
export class PatientManager {
  constructor(G) {
    this.G = G;
    this.patients = [];
    this.queue = []; // records waiting to arrive (scheduled)
    this.windowPatient = null;
    this.outsideQueue = [];
    this.rooms = { room1: null, room2: null, room3: null, surgery: null };
    this.sealed = {}; // roomId -> timer
    this.waitingSpots = [];
    this.stats = null;
    this.rng = new RNG(Date.now() & 0xffff);
  }

  get level() {
    return this.G.level;
  }

  reset() {
    for (const p of this.patients) p.model.dispose();
    this.patients = [];
    this.queue = [];
    this.windowPatient = null;
    this.outsideQueue = [];
    this.rooms = { room1: null, room2: null, room3: null, surgery: null };
    this.sealed = {};
    this.waitingSpots = this.level.spots.waiting.map(() => null);
    this.history = [];
    this.stats = {
      treated: 0,
      deaths: 0,
      wrongRejects: 0,
      rightRejects: 0,
      creaturesAdmitted: 0,
      creaturesContained: 0,
      leftWaiting: 0,
      handedOff: 0,
      earned: 0,
      repDelta: 0,
      log: [],
    };
  }

  schedule(records, arrivalTimes) {
    this.queue = records.map((r, i) => ({ rec: r, t: arrivalTimes[i] }));
  }

  // ---------- spawning & intake ----------
  spawn(rec) {
    const p = new Patient(this.G, rec);
    this.patients.push(p);
    const L = this.level;
    p.setPos(L.spots.outsideSpawn);
    p.state = 'arriving';
    p.location = 'outside';
    if (!this.windowPatient && !this.outsideQueue.length) this.sendToWindow(p);
    else this.sendToQueue(p);
    return p;
  }

  sendToQueue(p) {
    const L = this.level;
    this.outsideQueue.push(p);
    const idx = Math.min(this.outsideQueue.length - 1, L.spots.outsideQueue.length - 1);
    const spot = L.spots.outsideQueue[idx];
    p.state = 'queued';
    p.walk([spot], () => {
      p.yaw = Math.PI;
    });
  }

  sendToWindow(p) {
    const L = this.level;
    this.windowPatient = p;
    p.state = 'arriving';
    const pts = [L.nav.nodes.get('queue'), L.nav.nodes.get('outDoor'), L.nav.nodes.get('vestIn'), L.nav.nodes.get('platform')];
    p.walk(pts, () => {
      p.state = 'window';
      p.location = 'window';
      p.patience = p.rec.patience * this.G.difficulty().patience;
      this.G.events.emit('arrival', p);
    }, L.spots.platform, L.spots.platformYaw);
  }

  advanceQueue() {
    if (this.windowPatient || !this.outsideQueue.length) return;
    const next = this.outsideQueue.shift();
    this.sendToWindow(next);
    // shuffle the rest forward
    this.outsideQueue.forEach((q, i) => {
      const spot = this.level.spots.outsideQueue[Math.min(i, 2)];
      q.walk([spot], () => (q.yaw = Math.PI));
    });
  }

  admit() {
    const p = this.windowPatient;
    if (!p || p.state !== 'window') return false;
    const L = this.level;
    p.decision = 'admitted';
    this.windowPatient = null;
    if (p.impostor) this.stats.creaturesAdmitted++;
    const spotIdx = this.freeWaitingSpot(p);
    const spot = L.spots.waiting[spotIdx];
    this.waitingSpots[spotIdx] = p;
    p.waitingSpot = spotIdx;
    // approach the seat from the front, then hop up
    const front = new THREE.Vector3(spot.pos.x + Math.sin(spot.yaw) * 0.5, 0, spot.pos.z + Math.cos(spot.yaw) * 0.5);
    const pts = [L.nav.nodes.get('innerV'), L.nav.nodes.get('innerR'), L.nav.nodes.get('recE'), L.nav.nodes.get('recMid'), L.nav.nodes.get('recW'), L.nav.nodes.get('wait'), spot.chair ? front : spot.pos];
    p.state = 'admitted';
    p.walk(pts, () => {
      p.state = 'waiting';
      p.location = 'waiting';
    }, spot.chair ? spot.pos : null, spot.yaw);
    this.log(p, 'Admitted');
    this.G.events.emit('admitted', p);
    return true;
  }

  reject() {
    const p = this.windowPatient;
    if (!p || p.state !== 'window') return false;
    p.decision = 'rejected';
    this.windowPatient = null;
    if (p.impostor) this.stats.rightRejects++;
    else this.stats.wrongRejects++;
    this.leave(p, true);
    this.log(p, 'Turned away');
    this.G.events.emit('rejected', p);
    return true;
  }

  leave(p, viaShutter) {
    const L = this.level;
    p.state = 'leaving';
    p.location = 'outside';
    const pts = [L.nav.nodes.get('vestIn'), L.nav.nodes.get('outDoor'), L.nav.nodes.get('queue'), L.nav.nodes.get('far'), new THREE.Vector3(9, 0, 36)];
    const delay = viaShutter ? 2.2 : 0;
    p.leaveDelay = delay;
    p.pendingWalk = () => p.walk(pts, () => this.despawn(p));
  }

  despawn(p) {
    p.state = 'gone';
    p.model.dispose();
    this.patients = this.patients.filter((x) => x !== p);
    for (const k of Object.keys(this.rooms)) if (this.rooms[k] === p) this.rooms[k] = null;
    if (p.waitingSpot !== undefined && this.waitingSpots[p.waitingSpot] === p) this.waitingSpots[p.waitingSpot] = null;
    if (this.windowPatient === p) this.windowPatient = null;
  }

  freeWaitingSpot(p) {
    const spots = this.level.spots.waiting;
    const small = ['cat', 'rabbit', 'parrot', 'guineapig'].includes(p.species);
    let best = -1;
    for (let i = 0; i < spots.length; i++) {
      if (this.waitingSpots[i]) continue;
      if (best < 0) best = i;
      if (spots[i].chair === small) return i;
    }
    return best >= 0 ? best : 0;
  }

  // ---------- escort / placement ----------
  escorting() {
    return this.patients.find((p) => p.state === 'following') || null;
  }

  startEscort(p) {
    const cur = this.escorting();
    if (cur && cur !== p) this.stopEscort(cur);
    if (p.waitingSpot !== undefined) {
      this.waitingSpots[p.waitingSpot] = null;
      p.waitingSpot = undefined;
    }
    for (const k of Object.keys(this.rooms)) if (this.rooms[k] === p) this.rooms[k] = null;
    p.location = 'escort';
    p.startFollow(this.G.player);
    this.G.audio.play(voiceFor(p), { pos: p.model.root.position, volume: 0.6, vary: 0.15 });
  }

  stopEscort(p) {
    // sit down where it stands
    p.follow = null;
    p.state = 'waiting';
    p.location = 'loose-wait';
    p.model.setPose('sit');
    p.model.speed = 0;
  }

  placeInRoom(p, roomId) {
    const L = this.level;
    const spot = roomId === 'surgery' ? L.spots.surgery : L.spots[roomId];
    if (!spot) return false;
    p.follow = null;
    this.rooms[roomId] = p;
    p.state = 'placing';
    const floorNear = new THREE.Vector3(spot.bed.x + (roomId === 'surgery' ? -0.6 : spot.yaw > 0 ? 0.6 : -0.6), 0, spot.bed.z);
    p.walk([floorNear], () => {
      p.state = 'inRoom';
      p.location = roomId;
      p.y = spot.bed.y;
      this.G.events.emit('placed', p, roomId);
    }, new THREE.Vector3(spot.bed.x, spot.bed.y, spot.bed.z), spot.yaw);
    return true;
  }

  roomOf(p) {
    for (const [k, v] of Object.entries(this.rooms)) if (v === p) return k;
    return null;
  }

  // ---------- diagnostics ----------
  testDuration(test) {
    const up = this.G.campaign.upgrades;
    const k = up.diag2 ? 0.4 : up.diag1 ? 0.65 : 1;
    return TEST_INFO[test].time * k;
  }

  startTest(p, test) {
    if (p.tests[test] && (p.tests[test].running || p.tests[test].done)) return;
    p.tests[test] = { running: true, done: false, t: 0, dur: this.testDuration(test), result: null };
    const pos = p.model.root.position;
    if (test === 'scan') p.tests[test].sound = this.G.audio.play('scan', { pos, loop: true, volume: 0.4 });
  }

  completeTest(p, test) {
    const t = p.tests[test];
    t.running = false;
    t.done = true;
    if (t.sound) t.sound.stop(0.1);
    t.result = this.testResult(p, test);
    const pos = p.model.root.position;
    this.G.audio.play(test === 'temp' ? 'thermo' : 'beep', { pos, volume: 0.6 });
    this.G.events.emit('testDone', p, test);
  }

  testResult(p, test) {
    const sp = SPECIES[p.species];
    const c = p.cond;
    const rng = new RNG(p.id * 977 + test.length * 31);
    if (p.impostor && p.rec.impossible[test]) {
      const v = p.rec.impossibleValues[test];
      if (test === 'scan') return { impossible: true, scan: v, text: { skull: 'The skull is not an animal\'s skull.', ribs: 'Far too many ribs. They keep going.', empty: 'There is nothing inside it.', hand: 'Something inside it is holding its ribs.' }[v] };
      if (test === 'heart') return { impossible: true, text: v, rate: 0, rhythm: 'impossible' };
      return { impossible: true, text: v };
    }
    if (test === 'temp') {
      const [lo, hi] = sp.temp;
      let v;
      if (c.temp === 'high') v = hi + rng.range(0.9, 1.8);
      else if (c.temp === 'slightHigh') v = hi + rng.range(0.25, 0.6);
      else if (c.temp === 'low') v = lo - rng.range(1.6, 3.2);
      else v = rng.range(lo + 0.1, hi - 0.1);
      const flag = v > hi ? 'HIGH' : v < lo ? 'LOW' : 'normal';
      return { value: v, text: `${v.toFixed(1)} °C`, flag, range: `${lo.toFixed(1)}–${hi.toFixed(1)} °C` };
    }
    if (test === 'heart') {
      const [lo, hi] = sp.hr;
      let rate;
      if (c.heart.rate === 'fast') rate = hi * rng.range(1.15, 1.35);
      else if (c.heart.rate === 'slow') rate = lo * rng.range(0.55, 0.78);
      else rate = rng.range(lo * 1.05, hi * 0.95);
      rate = Math.round(rate);
      const rhythm = c.heart.rhythm;
      const rtext = rhythm === 'regular' ? 'regular rhythm' : rhythm === 'irregular' ? 'IRREGULAR rhythm' : 'regular, with a whooshing MURMUR';
      const flag = rate > hi ? 'FAST' : rate < lo ? 'SLOW' : 'normal';
      return { rate, rhythm, text: `${rate} bpm, ${rtext}`, flag, range: `${lo}–${hi} bpm` };
    }
    if (test === 'scan') {
      const txt = {
        clear: 'No fractures, masses or foreign objects.',
        fracture: 'Fracture visible in one leg bone.',
        foreign: 'A dense foreign object in the stomach.',
        mass: 'A round soft-tissue mass in the abdomen.',
        heart: 'The heart is markedly enlarged.',
      }[c.scan];
      return { scan: c.scan, text: txt };
    }
    // physical exam
    let text = c.exam;
    const tr = p.rec.traits;
    const extras = [];
    if (tr.cone && !c.visual.includes('cone')) extras.push('Wearing a protective cone from an old procedure.');
    if (tr.bandage) extras.push('An old, clean bandage on one leg. Healing well.');
    if (tr.squint && c.visual.indexOf('squint') < 0) extras.push('Squinting one eye; mild irritation, nothing serious.');
    if (extras.length) text += ' ' + extras.join(' ');
    return { text };
  }

  // Returns { ok, message }
  applyTreatment(p, inventory) {
    if (!p.diagnosis) return { ok: false, message: 'Choose a diagnosis first.' };
    const diag = CONDITIONS[p.diagnosis];
    const room = this.roomOf(p);
    if (diag.surgery && room !== 'surgery') return { ok: false, message: 'This needs surgery. Escort the patient to the surgery table.' };
    const need = diag.treatment.slice();
    const missing = [];
    const carried = inventory.slice();
    for (const item of need) {
      const i = carried.indexOf(item);
      if (i < 0) missing.push(item);
      else carried.splice(i, 1);
    }
    if (missing.length) {
      return { ok: false, message: `You need: ${missing.map((m) => SUPPLIES[m].name).join(', ')}. Fetch them from the pharmacy.` };
    }
    return { ok: true, items: need, surgery: diag.surgery };
  }

  // Called once the treatment items are consumed (and surgery succeeded).
  resolveTreatment(p, quality = 1) {
    if (p.impostor) {
      return { reveal: true };
    }
    const correct = p.diagnosis === p.rec.condition;
    if (!correct) {
      p.health = Math.max(1, p.health - 10);
      p.diagnosis = null;
      return { ok: false, message: 'No improvement. The treatment did not match the illness. Reassess.' };
    }
    p.state = 'recovering';
    p.recovery = 0;
    p.health = Math.min(100, p.health + 8 * quality);
    p.model.happy = 1;
    return { ok: true, message: `${p.name} is responding well to treatment.` };
  }

  // ---------- per-step simulation ----------
  fixedUpdate(dt) {
    const G = this.G;
    const diff = G.difficulty();
    // vestibule doors open for animals passing through
    const transit = ['admitted', 'discharging', 'leaving', 'arriving'];
    const near = (door, r) => door && this.patients.some((p) => transit.includes(p.state) && Math.hypot(p.pos.x - door.center.x, p.pos.z - door.center.z) < r);
    const inner = this.level.doors.get('inner');
    const outer = this.level.doors.get('outer');
    if (inner) inner.target = near(inner, 1.7) ? 1 : 0;
    if (outer) {
      const want = near(outer, 2.4) ? 1 : 0;
      if (want && outer.target === 0) G.audio.play('whoosh', { pos: outer.center, volume: 0.5 });
      outer.target = want;
    }
    for (const p of this.patients.slice()) {
      if (p.leaveDelay > 0) {
        p.leaveDelay -= dt;
        if (p.leaveDelay <= 0 && p.pendingWalk) {
          const w = p.pendingWalk;
          p.pendingWalk = null;
          w();
        }
      }
      p.fixedUpdate(dt);
      p.comfortCooldown = Math.max(0, p.comfortCooldown - dt);
      if (p.state === 'gone') continue;
      // window patience
      if (p.state === 'window') {
        p.patience -= dt;
        if (p.patience <= 0) {
          p.decision = 'left';
          this.windowPatient = null;
          if (!p.impostor) {
            this.stats.leftWaiting++;
            this.changeRep(-4, `${p.name} gave up waiting at the window.`);
          }
          this.log(p, 'Gave up waiting');
          this.leave(p, false);
          G.events.emit('leftWindow', p);
        }
      }
      // tests progress
      for (const k of Object.keys(p.tests)) {
        const t = p.tests[k];
        if (t && t.running) {
          // instruments need power in that room
          const room = this.roomOf(p);
          const powered = !room || G.lighting.isPowered(room === 'surgery' ? 'surgery' : room);
          if (powered) t.t += dt;
          if (t.t >= t.dur) this.completeTest(p, k);
        }
      }
      // health
      this.updateHealth(p, dt, diff);
      // impostors inside the clinic eventually break out
      if (p.impostor && ['waiting', 'inRoom', 'following', 'placing', 'admitted'].includes(p.state)) {
        p.timeInClinic += dt;
        p.revealTimer -= dt * (p.state === 'following' ? 0.3 : 1);
        const zone = G.lighting.zoneAt(p.pos.x, 0.5, p.pos.z);
        const circuit = zoneCircuit(zone);
        if (circuit >= 0 && !G.lighting.state[circuit].powered) {
          p.darkTimer += dt;
          if (p.darkTimer > 7) p.revealTimer = 0;
        } else p.darkTimer = 0;
        if (p.revealTimer <= 0) {
          G.events.emit('reveal', p, 'timeout');
        }
        // waiting-room creepiness: it moves when no one is looking
        if (p.state === 'waiting' && Math.random() < dt * 0.02 && !G.isVisibleToPlayer(p.pos, 0.5)) {
          const free = this.waitingSpots.findIndex((s) => !s);
          if (free >= 0) {
            const spot = this.level.spots.waiting[free];
            if (p.waitingSpot !== undefined) this.waitingSpots[p.waitingSpot] = null;
            this.waitingSpots[free] = p;
            p.waitingSpot = free;
            p.setPos(spot.pos, spot.pos.y);
            p.yaw = spot.yaw;
            p.prevYaw = spot.yaw;
          }
        }
      }
      // recovery & discharge
      if (p.state === 'recovering') {
        p.recovery += dt;
        p.health = Math.min(100, p.health + dt * 1.6);
        if (p.recovery > 26 && p.health > 70) this.discharge(p);
      }
      // ambient vocalisations
      if (['window', 'waiting', 'inRoom'].includes(p.state)) {
        p.vocalTimer -= dt;
        if (p.vocalTimer <= 0) {
          p.vocalTimer = 9 + Math.random() * 14;
          const vol = p.state === 'window' ? 0.45 : 0.4;
          const name = p.impostor && Math.random() < 0.3 ? voiceFor(p) : voiceFor(p);
          G.audio.play(name, { pos: p.model.root.position, volume: vol, vary: p.impostor ? 0 : 0.2, rate: p.impostor && Math.random() < 0.4 ? 0.82 : 1, muffle: p.state === 'window' ? 0.35 : 0 });
        }
      }
    }
    // sealed rooms get cleared by the containment team
    for (const k of Object.keys(this.sealed)) {
      this.sealed[k] -= dt;
      if (this.sealed[k] <= 0) {
        delete this.sealed[k];
        const sp = this.rooms[k];
        if (sp && sp.state === 'sealed') this.despawn(sp);
        this.rooms[k] = null;
        G.lighting && this.level.setDoor(k, true);
        G.events.emit('roomCleared', k);
      }
    }
    // queue advancement
    if (!this.windowPatient && this.outsideQueue.length) this.advanceQueue();
  }

  updateHealth(p, dt, diff) {
    if (p.dead || ['leaving', 'gone', 'sealed', 'arriving', 'queued'].includes(p.state)) return;
    if (p.state === 'recovering') return;
    let rate = 0.17 * p.cond.severity * diff.decay * (this.G.shift.index === 0 ? 0.75 : 1);
    if (p.state === 'window') rate *= 0.6;
    if (p.state === 'inRoom') rate *= p.diagnosis ? 0.5 : 0.7;
    rate += p.extraDrain;
    // dark rooms distress patients
    const zone = p.location;
    const circuit = zoneCircuit(zone);
    if (circuit >= 0 && !this.G.lighting.state[circuit].powered) rate += 0.15;
    p.health -= rate * dt;
    p.mood = damp(p.mood, p.extraDrain > 0 ? 1 : p.health < 30 ? 0.7 : 0.15, 1, dt);
    const wasCritical = p.critical;
    p.critical = p.health < 25;
    if (p.critical && !wasCritical) this.G.events.emit('critical', p);
    if (p.critical && ['inRoom', 'waiting'].includes(p.state)) {
      p.alarmTimer -= dt;
      if (p.alarmTimer <= 0) {
        p.alarmTimer = 2.2;
        this.G.audio.play('alarm', { pos: p.model.root.position, volume: 0.35 });
      }
    }
    if (p.health <= 0) this.kill(p);
  }

  kill(p) {
    if (p.impostor) {
      // it does not die. it was never alive.
      p.health = 1;
      this.G.events.emit('reveal', p, 'death');
      return;
    }
    p.dead = true;
    p.health = 0;
    p.state = 'dead';
    p.model.setPose('lie');
    p.model.still = true;
    this.stats.deaths++;
    this.changeRep(-10, `${p.name} died waiting for treatment.`);
    this.log(p, 'Died');
    this.G.audio.play('flatline', { pos: p.model.root.position, volume: 0.45 });
    this.G.events.emit('death', p);
  }

  discharge(p) {
    const G = this.G;
    const L = this.level;
    const room = this.roomOf(p);
    if (room) this.rooms[room] = null;
    p.state = 'discharging';
    p.outcome = 'treated';
    const pay = Math.round(p.cond.pay * (0.6 + 0.4 * (p.health / 100)) * G.difficulty().pay);
    this.stats.treated++;
    this.stats.earned += pay;
    G.campaign.money += pay;
    this.changeRep(p.health > 70 ? 4 : 3, null);
    G.composure.add(4);
    G.audio.play('cash', { volume: 0.5 });
    G.events.emit('discharged', p, pay);
    this.log(p, `Treated, discharged (+$${pay})`);
    const startNode = room ? (room === 'surgery' ? 'surgery' : room) : L.nearestNode(p.pos);
    const nodes = L.path(startNode, 'far');
    p.walk(nodes.concat([new THREE.Vector3(9, 0, 36)]), () => this.despawn(p));
  }

  changeRep(delta, msg) {
    const c = this.G.campaign;
    c.reputation = clamp(c.reputation + delta, 0, 100);
    this.stats.repDelta += delta;
    if (msg) this.G.events.emit('notice', msg, delta < 0 ? 'bad' : 'good');
  }

  log(p, what) {
    this.history.push({ id: p.id, name: p.name, species: p.species, impostor: p.impostor, signs: p.rec.signs.slice(), what, condition: p.rec.condition });
  }

  frameUpdate(dt, alpha) {
    for (const p of this.patients) p.frameUpdate(dt, alpha);
  }

  // patient visible in a room / waiting area for the status board
  board() {
    return this.patients
      .filter((p) => !['gone', 'arriving', 'queued', 'leaving'].includes(p.state) || p.state === 'window')
      .map((p) => ({
        p,
        name: p.name,
        species: p.species,
        where: locationLabel(p, this),
        health: p.health,
        status: statusLabel(p),
        critical: p.critical,
      }));
  }
}

export function zoneCircuit(zone) {
  return { reception: 0, waiting: 0, window: 0, vestibule: 0, corridor: 1, room1: 2, room2: 3, room3: 4, surgery: 5, pharmacy: 6, staff: 6, utility: 6 }[zone] ?? -1;
}

export function voiceFor(p) {
  return { dog: p.rec.traits.lethargic || p.health < 40 ? 'whine' : 'bark', cat: 'meow', rabbit: 'squeak', parrot: 'chirp', guineapig: 'wheek' }[p.species] || 'squeak';
}

function locationLabel(p, mgr) {
  const r = mgr.roomOf(p);
  if (r) return r === 'surgery' ? 'Surgery' : `Exam ${r.slice(-1)}`;
  if (p.state === 'window') return 'Intake window';
  if (p.state === 'following') return 'With you';
  if (p.state === 'waiting' || p.state === 'admitted') return 'Waiting area';
  if (p.state === 'discharging') return 'Going home';
  if (p.state === 'dead') return '—';
  return '…';
}

function statusLabel(p) {
  if (p.dead) return 'Deceased';
  if (p.state === 'sealed') return 'SEALED';
  if (p.state === 'window') return 'Awaiting screening';
  if (p.state === 'discharging') return 'Discharged';
  if (p.state === 'recovering') return 'Recovering';
  if (p.state === 'following') return 'Being escorted';
  if (p.state === 'waiting' || p.state === 'admitted') return 'Needs a room';
  if (p.diagnosis) {
    const c = CONDITIONS[p.diagnosis];
    return c.surgery ? `Dx: ${c.name} — surgery` : `Dx: ${c.name} — treat`;
  }
  const done = Object.values(p.tests).filter((t) => t && t.done).length;
  return done ? `Tests: ${done}/4` : 'Needs exam';
}

export { ROOMS };
