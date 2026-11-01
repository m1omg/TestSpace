// Threats with learnable rules:
//  - Power failures: reset the breakers in the utility room.
//  - The tall watcher in the corridor: do NOT look straight at it.
//  - Something on a camera feed walking toward the lens: switch feeds.
//  - Scratching under a bed: crouch and shine your flashlight under it.
//  - A creature loose inside: it only moves while unwatched; restrain it
//    with a catch pole, or drive it off with a steady flashlight beam.
import * as THREE from 'three';
import { Materials } from './materials.js';
import { AnimalModel } from './animals.js';
import { LAYER } from './renderer.js';
import { clamp, damp, lerp, lerpAngle, dampAngle, RNG, noise1, rng } from './core.js';
import { SHIFTS } from './data.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

let _faceMat = null;
function figureFaceMaterial() {
  if (!_faceMat) _faceMat = new THREE.MeshBasicMaterial({ color: 0x6e6c68 });
  return _faceMat;
}

// Tall thin figure used by the watcher and feed presences.
function makeFigure(mask, tall = 2.55) {
  const g = new THREE.Group();
  const dark = Materials.dynamic('figure', { color: 0x0c0c0f, roughness: 1, rim: 0.05 });
  const face = figureFaceMaterial();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, tall * 0.5, 4, 10), dark.mat);
  body.scale.set(0.85, 1, 0.6);
  body.position.y = tall * 0.55;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), dark.mat);
  head.scale.set(0.9, 1.25, 0.95);
  head.position.set(0, tall - 0.08, 0.1);
  const faceM = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), face);
  faceM.rotation.x = Math.PI / 2 + 0.3;
  faceM.position.set(0, tall - 0.12, 0.17);
  faceM.scale.set(0.9, 1.3, 0.5);
  const parts = [body, head, faceM];
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, tall * 0.5, 3, 6), dark.mat);
    arm.position.set(0.22 * s, tall * 0.5, 0.04);
    arm.rotation.z = s * 0.06;
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, tall * 0.33, 3, 6), dark.mat);
    leg.position.set(0.09 * s, tall * 0.2, 0);
    parts.push(arm, leg);
  }
  g.add(...parts);
  if (mask) g.traverse((o) => (o.layers.mask = mask));
  g.userData.entry = dark;
  return g;
}

export class Composure {
  constructor(G) {
    this.G = G;
    this.value = 100;
    this.heartbeat = null;
    this.hbTimer = 0;
    this.hallucinationTimer = 25;
  }
  reset() {
    this.value = 100;
  }
  add(v) {
    this.value = clamp(this.value + v, 0, 100);
  }
  drain(v) {
    const diff = this.G.difficulty();
    this.value = clamp(this.value - v * diff.composureDrain, 0, 100);
  }
  fixedUpdate(dt) {
    const G = this.G;
    const p = G.player;
    const bright = G.lighting.brightness(p.pos.x, 1.2, p.pos.z);
    const dark = bright < 0.06;
    const threats = G.incidents.activeThreats();
    if (dark) this.drain((p.flashlightOn ? 0.35 : 1.0) * dt);
    else if (!threats) this.add(0.45 * dt);
    // heartbeat when composure is low (spaced by time, not frames)
    if (this.value < 40) {
      this.hbTimer -= dt;
      if (this.hbTimer <= 0) {
        const k = 1 - this.value / 40;
        this.hbTimer = lerp(1.1, 0.5, k);
        G.audio.play('heartbeat', { volume: 0.2 + k * 0.5 });
      }
    }
    // mild hallucinations at very low composure
    if (this.value < 25 && G.state === 'playing') {
      this.hallucinationTimer -= dt;
      if (this.hallucinationTimer <= 0) {
        this.hallucinationTimer = 18 + Math.random() * 20;
        G.incidents.hallucinate();
      }
    }
  }
}

// ---------------------------------------------------------------------------
export class Incidents {
  constructor(G) {
    this.G = G;
    this.events = [];
    this.watcher = null;
    this.presence = null;
    this.underbed = null;
    this.creatures = [];
    this.glimpse = null;
    this.pendingFeed = null;
    this.deadCams = new Set();
    this.rng = new RNG(1);
  }

  get level() {
    return this.G.level;
  }

  reset(shiftIndex, duration) {
    this.clearAll();
    const G = this.G;
    const diff = G.difficulty();
    const cfg = SHIFTS[shiftIndex].incidents;
    this.rng = new RNG((Date.now() ^ (shiftIndex * 7919)) >>> 0);
    const r = this.rng;
    const count = (n) => Math.max(0, Math.round(n * diff.incidents + (diff.incidents > 1.2 && n > 0 ? 0.4 : 0)));
    const list = [];
    let power = count(cfg.power);
    if (G.campaign.upgrades.generator) power = Math.max(cfg.power > 0 ? 1 : 0, power - 1);
    for (let i = 0; i < power; i++) list.push('power');
    for (let i = 0; i < count(cfg.figure); i++) list.push('figure');
    for (let i = 0; i < count(cfg.feed); i++) list.push('feed');
    for (let i = 0; i < count(cfg.bed); i++) list.push('bed');
    // spread times across the shift, at least 40 s apart
    const times = [];
    const shuffled = r.shuffle(list);
    for (const type of shuffled) {
      let t = 0;
      for (let k = 0; k < 30; k++) {
        t = r.range(duration * (shiftIndex === 0 ? 0.42 : 0.16), duration * 0.92);
        if (times.every((x) => Math.abs(x - t) > 40)) break;
      }
      times.push(t);
      this.events.push({ t, type, done: false, tries: 0 });
    }
    this.events.sort((a, b) => a.t - b.t);
    this.deadCams.clear();
  }

  clearAll() {
    this.removeWatcher();
    this.removePresence();
    this.endUnderBed(false);
    for (const c of this.creatures) c.dispose();
    this.creatures = [];
    if (this.glimpse) {
      this.G.scene.remove(this.glimpse.mesh);
      this.glimpse = null;
    }
    this.events = [];
    this.pendingFeed = null;
  }

  activeThreats() {
    return !!(this.watcher || this.creatures.length || this.underbed || (this.presence && this.presence.active) || this.G.lighting.overallLevel() < 0.999);
  }

  tension() {
    let t = 0;
    if (this.G.lighting.overallLevel() < 0.999) t += 0.35;
    if (this.watcher) t += 0.4 + this.watcher.stare * 0.15;
    if (this.creatures.length) t += 0.7;
    if (this.underbed) t += 0.3;
    if (this.presence && this.presence.active) t += 0.5;
    t += (1 - this.G.composure.value / 100) * 0.3;
    return clamp(t, 0, 1);
  }

  // ---------- scheduling ----------
  fixedUpdate(dt, shiftTime) {
    for (const e of this.events) {
      if (e.done || shiftTime < e.t) continue;
      const ok = this.trigger(e.type);
      if (ok) e.done = true;
      else {
        e.t += 8;
        e.tries++;
        if (e.tries > 10) e.done = true;
      }
    }
    if (this.watcher) this.updateWatcher(dt);
    if (this.underbed) this.updateUnderBed(dt);
    for (const c of this.creatures.slice()) c.fixedUpdate(dt);
    if (this.presence) this.updatePresence(dt);
    if (this.glimpse) {
      this.glimpse.t -= dt;
      if (this.glimpse.t <= 0 || this.G.isVisibleToPlayer(this.glimpse.mesh.position, 1.4, 0, 0.22)) {
        this.G.scene.remove(this.glimpse.mesh);
        this.glimpse = null;
      }
    }
  }

  frameUpdate(dt, alpha) {
    for (const c of this.creatures) c.frameUpdate(dt, alpha);
    if (this.underbed) {
      const u = this.underbed;
      u.time += dt;
      u.group.children.forEach((f, i) => {
        if (f.userData.finger) f.rotation.x = 0.4 + Math.sin(u.time * 6 + i * 1.7) * 0.25 * (u.retreat ? 0 : 1);
      });
      if (u.retreat) u.group.position.y -= dt * 0.2;
    }
    if (this.watcher) {
      const w = this.watcher;
      const s = this.G.lighting.brightness(w.pos.x, 1.5, w.pos.z, 'corridor');
      w.entry.probe.value.setScalar(s * 0.3);
      // subtle sway
      w.mesh.rotation.z = Math.sin(performance.now() / 900) * 0.015;
    }
  }

  trigger(type) {
    if (type === 'power') return this.startPower();
    if (type === 'figure') return this.spawnWatcher();
    if (type === 'feed') {
      this.pendingFeed = { until: 120 };
      return true;
    }
    if (type === 'bed') return this.startUnderBed();
    return true;
  }

  // ---------- power ----------
  startPower() {
    const G = this.G;
    const L = G.lighting;
    if (L.overallLevel() < 0.999) return false; // already dark somewhere
    const n = G.shiftIndex >= 3 ? this.rng.int(2, 3) : this.rng.int(1, 2);
    let ids = L.randomTrippable(n);
    // early nights: never take everything out at once
    if (!ids.length) return true;
    for (const i of ids) L.surge(i, 3.5);
    // tubes buzz louder for a few seconds before the breakers trip
    const buzz = G.audio.play('hum', { volume: 0.6, rate: 1.4, loop: true });
    if (buzz) G.later(3.5, () => buzz.stop(0.1));
    this.powerTimer = { t: 3.5, ids };
    this.G.later(3.5, () => {
      let any = false;
      for (const i of ids) if (L.trip(i)) any = true;
      if (!any) return;
      G.audio.play('powerDown', { volume: 0.9, caption: '[Power failure]' });
      const names = ids.map((i) => L.state[i].label);
      G.events.emit('power', ids, names);
      G.player.shake = Math.max(G.player.shake, 0.3);
    });
    return true;
  }

  // ---------- the watcher ----------
  spawnWatcher() {
    const G = this.G;
    if (this.watcher) return true;
    const p = G.player.pos;
    const zone = G.lighting.zoneAt(p.x, 1, p.z);
    if (zone !== 'corridor' && zone !== 'reception') return false;
    if (zone === 'reception' && !(p.x > -2.5 && p.x < 2.5 && p.z < 4.5)) return false;
    // far end of the corridor, or a doorway, at least 9 m away
    const candidates = [
      new THREE.Vector3(0, 0, -22.6),
      new THREE.Vector3(0.3, 0, -20.5),
      new THREE.Vector3(-0.4, 0, -14.8),
      new THREE.Vector3(0.4, 0, -10.6),
    ].filter((c) => c.distanceTo(new THREE.Vector3(p.x, 0, p.z)) > 9);
    if (!candidates.length) return false;
    const pos = this.rng.pick(candidates);
    const mesh = makeFigure(null);
    mesh.position.copy(pos);
    mesh.lookAt(p.x, 0, p.z);
    G.scene.add(mesh);
    this.watcher = { mesh, pos, stare: 0, ignored: 0, steps: 0, entry: mesh.userData.entry, life: 0 };
    G.audio.play('whisper', { pos: pos.clone().setY(1.6), volume: 0.6, caption: '[Whispering in the corridor]' });
    G.events.emit('watcher');
    return true;
  }

  updateWatcher(dt) {
    const G = this.G;
    const w = this.watcher;
    const p = G.player;
    w.life += dt;
    const head = _v.copy(w.pos).setY(2.2);
    const cam = p.camera.position;
    const to = _w.subVectors(head, cam);
    const dist = to.length();
    to.normalize();
    const fwd = p.camera.getWorldDirection(new THREE.Vector3());
    const angle = Math.acos(clamp(fwd.dot(to), -1, 1));
    const los = G.lineOfSight(cam, head);
    const visible = los && G.lighting.brightness(w.pos.x, 1.5, w.pos.z, 'corridor') + (p.flashlightOn ? 0.3 : 0) > 0.03;
    const staring = visible && angle < 0.26;
    w.mesh.lookAt(p.pos.x, 0, p.pos.z);
    if (staring) {
      w.stare += dt;
      w.ignored = Math.max(0, w.ignored - dt * 2);
      G.composure.drain(5.5 * dt);
      G.stareFx = Math.min(1, w.stare / 2.4);
      if (w.stare > 2.4) {
        // it steps closer
        w.stare = 0.6;
        w.steps++;
        const dir = _v.set(p.pos.x - w.pos.x, 0, p.pos.z - w.pos.z);
        const d = dir.length();
        dir.normalize();
        const move = Math.max(2, d * 0.38);
        w.pos.addScaledVector(dir, Math.min(move, d - 0.9));
        w.mesh.position.copy(w.pos);
        G.audio.play('thud', { pos: w.pos.clone().setY(1), volume: 0.9, caption: '[Something steps closer]' });
        G.player.shake = 0.35;
        if (d - move < 2.6) {
          this.removeWatcher();
          G.jumpscare('watcher', 30);
          return;
        }
      }
    } else {
      G.stareFx = 0;
      w.stare = Math.max(0, w.stare - dt * 0.5);
      w.ignored += dt;
      if (w.ignored > 11) {
        this.removeWatcher();
        G.composure.add(3);
        G.audio.play('whisper', { pos: w.pos.clone().setY(1.6), volume: 0.25, rate: 0.8 });
        G.events.emit('watcherGone');
        return;
      }
    }
    // very near and unseen also counts as an encounter
    if (dist < 1.4) {
      this.removeWatcher();
      G.jumpscare('watcher', 25);
    }
  }

  removeWatcher() {
    if (!this.watcher) return;
    this.G.scene.remove(this.watcher.mesh);
    Materials.release(this.watcher.entry);
    this.watcher = null;
    this.G.stareFx = 0;
  }

  // ---------- feed presence ----------
  // Called by the CCTV view each time the player looks at a feed.
  onFeedViewed(camDef) {
    const G = this.G;
    if (this.deadCams.has(camDef.id)) return;
    if (this.pendingFeed && !camDef.screening && !this.presence) {
      // attach to this camera
      const mask = 1 << (LAYER.CAM_BASE + camDef.index);
      const mesh = makeFigure(mask, 2.3);
      const dir = _v.subVectors(camDef.target, camDef.pos).setY(0).normalize();
      const start = camDef.pos.clone().addScaledVector(dir, 9.5);
      start.y = 0;
      this.clampToZone(start, camDef.zone);
      mesh.position.copy(start);
      G.scene.add(mesh);
      this.presence = { cam: camDef.id, camDef, mesh, active: true, pos: start.clone(), entry: mesh.userData.entry, sound: null, viewed: true };
      this.pendingFeed = null;
      G.events.emit('presence', camDef.id);
    }
  }

  clampToZone(p, zoneId) {
    const z = this.G.lighting.zones.get(zoneId);
    if (!z) return;
    p.x = clamp(p.x, z.min.x + 0.4, z.max.x - 0.4);
    p.z = clamp(p.z, z.min.z + 0.4, z.max.z - 0.4);
  }

  updatePresence(dt) {
    const G = this.G;
    const pr = this.presence;
    if (this.pendingFeed) {
      this.pendingFeed.until -= dt;
      if (this.pendingFeed.until <= 0) this.pendingFeed = null;
    }
    if (!pr) return;
    const viewing = G.cctvActive && G.cctvCam && G.cctvCam.id === pr.cam;
    if (viewing) {
      // walk toward the lens
      const camPos = pr.camDef.pos;
      const dir = _v.set(camPos.x - pr.pos.x, 0, camPos.z - pr.pos.z);
      const d = dir.length();
      dir.normalize();
      const speed = 1.25 * G.difficulty().creatureSpeed;
      pr.pos.addScaledVector(dir, speed * dt);
      pr.mesh.position.copy(pr.pos);
      pr.mesh.lookAt(camPos.x, 0, camPos.z);
      pr.glitch = clamp(1 - d / 9, 0, 1);
      if (!pr.sound) pr.sound = G.audio.play('whisper', { volume: 0.5, loop: true, caption: '[Whispering from the monitor speaker]' });
      if (pr.sound) pr.sound.setVolume(0.2 + pr.glitch * 0.7);
      G.composure.drain(1.5 * dt);
      if (d < 1.1) {
        // it reached the camera
        this.deadCams.add(pr.cam);
        this.removePresence();
        G.jumpscare('feed', 25);
        G.events.emit('camDead', pr.cam);
      }
    } else if (pr.viewed && G.cctvActive) {
      // the player switched away: obeying the rule makes it vanish
      this.removePresence();
      G.composure.drain(2);
      G.events.emit('presenceGone');
    } else if (!G.cctvActive) {
      this.removePresence();
    }
  }

  presenceGlitch(camId) {
    if (!this.presence || this.presence.cam !== camId) return 0;
    return this.presence.glitch || 0;
  }

  removePresence() {
    const pr = this.presence;
    if (!pr) return;
    if (pr.sound) pr.sound.stop(0.2);
    this.G.scene.remove(pr.mesh);
    Materials.release(pr.entry);
    this.presence = null;
  }

  // ---------- under the bed ----------
  startUnderBed() {
    const G = this.G;
    if (this.underbed) return true;
    const rooms = ['room1', 'room2', 'room3'].filter((r) => {
      const p = G.patients.rooms[r];
      return p && p.state === 'inRoom' && !p.impostor;
    });
    if (!rooms.length) return false;
    const room = this.rng.pick(rooms);
    const spot = this.level.spots[room];
    const g = new THREE.Group();
    const eyeM = Materials.basic('underEyes', { color: 0xfff2b0 });
    const skin = Materials.dynamic('underSkin', { color: 0xc8c0b8, roughness: 0.7 });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), eyeM);
      e.position.set(0.0, 0.06, s * 0.09);
      g.add(e);
    }
    const sideX = spot.yaw > 0 ? 0.4 : -0.4; // toward the room centre / door side
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.16, 3, 6), skin.mat);
      f.userData.finger = true;
      f.position.set(sideX * 0.9, 0.14, -0.15 + i * 0.1);
      f.rotation.z = Math.sign(sideX) * 1.2;
      g.add(f);
    }
    g.position.set(spot.bed.x, 0.0, spot.bed.z);
    G.scene.add(g);
    const patient = G.patients.rooms[room];
    patient.extraDrain = 0.55;
    const sound = G.audio.play('scratch', { pos: new THREE.Vector3(spot.bed.x, 0.2, spot.bed.z), loop: true, volume: 0.8, caption: `[Scratching from Exam ${room.slice(-1)}]` });
    this.underbed = { room, group: g, skin, timer: 0, progress: 0, time: 0, sound, patient, retreat: false };
    G.events.emit('underbed', room);
    return true;
  }

  updateUnderBed(dt) {
    const G = this.G;
    const u = this.underbed;
    if (u.retreat) {
      u.retreatT -= dt;
      if (u.retreatT <= 0) this.endUnderBed(true);
      return;
    }
    u.timer += dt;
    const p = G.player;
    const spot = this.level.spots[u.room];
    const target = _v.set(spot.bed.x, 0.12, spot.bed.z);
    const cam = p.camera.position;
    const dist = cam.distanceTo(target);
    let lit = false;
    if (p.flashlightOn && p.eye < 1.05 && dist < 3.8) {
      const fwd = p.camera.getWorldDirection(new THREE.Vector3());
      const to = _w.subVectors(target, cam).normalize();
      if (fwd.dot(to) > Math.cos(0.42) && G.lineOfSight(cam, target)) lit = true;
    }
    const need = G.campaign.upgrades.flashlight ? 1.0 : 2.0;
    if (lit) {
      u.progress += dt;
      G.underbedFx = u.progress / need;
      if (u.progress >= need) {
        G.audio.play('hiss', { pos: target.clone(), volume: 0.8, caption: '[A hiss. It lets go.]' });
        G.composure.add(5);
        u.retreat = true;
        u.retreatT = 0.6;
        if (u.patient) u.patient.extraDrain = 0;
        if (u.sound) u.sound.stop(0.2);
        G.events.emit('underbedGone', true);
        G.underbedFx = 0;
      }
    } else {
      G.underbedFx = 0;
      u.progress = Math.max(0, u.progress - dt * 0.5);
    }
    // the patient left or it waited too long
    const pt = G.patients.rooms[u.room];
    if (!pt || pt !== u.patient || pt.state !== 'inRoom') {
      this.endUnderBed(false);
      return;
    }
    if (u.timer > 70) {
      pt.health = Math.max(1, pt.health - 25);
      G.events.emit('notice', `Something hurt ${pt.name} in Exam ${u.room.slice(-1)}.`, 'bad');
      this.endUnderBed(false);
    }
  }

  endUnderBed(ok) {
    const u = this.underbed;
    if (!u) return;
    if (u.sound) u.sound.stop(0.2);
    if (u.patient) u.patient.extraDrain = 0;
    this.G.scene.remove(u.group);
    Materials.release(u.skin);
    this.underbed = null;
    this.G.underbedFx = 0;
  }

  // ---------- creatures ----------
  revealCreature(patient, where) {
    const G = this.G;
    const pos = patient.pos.clone();
    const app = patient.rec.appearance;
    G.patients.despawn(patient);
    patient.outcome = 'escaped';
    const c = new Creature(G, app, pos);
    this.creatures.push(c);
    G.audio.play('screech', { pos: pos.clone().setY(0.8), volume: 1.0, caption: '[An inhuman screech]' });
    G.events.emit('creatureLoose', c);
    return c;
  }

  // ---------- hallucinations ----------
  hallucinate() {
    const G = this.G;
    const p = G.player;
    if (this.glimpse || Math.random() < 0.4) {
      // a whisper from behind
      const back = p.forward(new THREE.Vector3()).multiplyScalar(-2);
      G.audio.play('whisper', { pos: new THREE.Vector3(p.pos.x + back.x, 1.6, p.pos.z + back.z), volume: 0.4 });
      return;
    }
    // a figure in the corner of your eye, gone when you look
    const fwd = p.forward(new THREE.Vector3());
    const side = new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
    const pos = new THREE.Vector3(p.pos.x, 0, p.pos.z).addScaledVector(fwd.setY(0).normalize(), 5).addScaledVector(side, 3.2);
    if (!G.lineOfSight(p.camera.position, pos.clone().setY(1.5))) return;
    const mesh = makeFigure(null, 2.2);
    mesh.position.copy(pos);
    mesh.lookAt(p.pos.x, 0, p.pos.z);
    G.scene.add(mesh);
    this.glimpse = { mesh, t: 1.5 };
  }

  useFlare() {
    // banish everything nearby
    const G = this.G;
    let any = false;
    if (this.watcher) {
      this.removeWatcher();
      any = true;
    }
    if (this.underbed && G.player.pos.distanceTo(_v.set(this.level.spots[this.underbed.room].bed.x, 0, this.level.spots[this.underbed.room].bed.z)) < 6) {
      this.endUnderBed(true);
      any = true;
    }
    for (const c of this.creatures) {
      if (c.pos.distanceTo(G.player.pos) < 9) {
        c.flee(60);
        any = true;
      }
    }
    return any;
  }
}

// ---------------------------------------------------------------------------
// A creature loose in the clinic. It moves only when nobody is watching.
export class Creature {
  constructor(G, appearance, pos) {
    this.G = G;
    this.model = new AnimalModel({ ...appearance, size: appearance.size * 1.35 }, {}, ['extraEyes', 'teeth', 'longNeck', 'camLimbs']);
    this.model.root.traverse((o) => {
      o.layers.mask = 1; // visible to every view
    });
    this.model.setPose('walk');
    G.scene.add(this.model.root);
    this.pos = pos.clone().setY(0);
    this.prevPos = this.pos.clone();
    this.yaw = 0;
    this.prevYaw = 0;
    this.path = [];
    this.repath = 0;
    this.hidden = 0; // seconds until it returns from fleeing
    this.restraint = 0;
    this.lightExposure = 0;
    this.attackCooldown = 2;
    this.growlTimer = 2;
    this.feeding = null;
    this.observed = false;
    this.mode = 'hunt';
    this.breath = G.audio.play('breath', { pos: this.pos.clone().setY(0.6), loop: true, volume: 0.6 });
  }

  flee(seconds) {
    const G = this.G;
    // vanish to a far node and wait
    const L = G.level;
    const nodes = ['cEnd', 'staff', 'utility', 'surgery', 'pharmacy'];
    let best = null;
    let bd = -1;
    for (const n of nodes) {
      const v = L.nav.nodes.get(n);
      const d = v.distanceTo(G.player.pos);
      if (d > bd) {
        bd = d;
        best = v;
      }
    }
    this.pos.copy(best);
    this.prevPos.copy(best);
    this.hidden = seconds;
    this.model.root.visible = false;
    this.path = [];
    this.lightExposure = 0;
    G.audio.play('hiss', { pos: G.player.camera.position.clone(), volume: 0.5, caption: '[It recoils and is gone]' });
  }

  fixedUpdate(dt) {
    const G = this.G;
    const p = G.player;
    this.prevPos.copy(this.pos);
    this.prevYaw = this.yaw;
    this.attackCooldown -= dt;
    if (this.hidden > 0) {
      this.hidden -= dt;
      if (this.hidden <= 0) {
        this.model.root.visible = true;
        G.audio.play('growl', { pos: this.pos.clone().setY(0.5), volume: 0.7, caption: '[A growl somewhere in the clinic]' });
      }
      return;
    }
    const head = _v.copy(this.pos).setY(0.6);
    this.observed = G.isVisibleToPlayer(head, 0, 0.07, 0.5);
    const dist = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    // restraint with a catch pole (hold the primary action)
    const poles = G.campaign.upgrades.pole || 0;
    this.canRestrain = this.observed && dist < 2.6 && poles > 0;
    if (this.canRestrain && G.input.isDown('primary') && G.state === 'playing' && !G.focusMode) {
      this.restraint += dt;
      G.restrainFx = this.restraint / 2.0;
      if (this.restraint >= 2.0) {
        this.contain();
        return;
      }
    } else {
      this.restraint = Math.max(0, this.restraint - dt);
      if (!this.canRestrain) G.restrainFx = 0;
    }
    // a steady flashlight beam drives it off
    if (this.observed && p.flashlightOn && dist < 10) {
      const fwd = p.camera.getWorldDirection(_w);
      const to = new THREE.Vector3().subVectors(head, p.camera.position).normalize();
      if (fwd.dot(to) > Math.cos(0.3)) {
        this.lightExposure += dt;
        const need = G.campaign.upgrades.flashlight ? 2.0 : 4.0;
        if (this.lightExposure > need) {
          this.flee(45);
          G.composure.add(4);
          return;
        }
      }
    } else this.lightExposure = Math.max(0, this.lightExposure - dt * 0.5);
    if (this.observed) {
      G.composure.drain((dist < 6 ? 2.0 : 0.8) * dt);
      this.model.speed = 0;
      return; // frozen in place while watched
    }
    // choose target: the player, or a patient in a room
    this.repath -= dt;
    if (this.repath <= 0 || !this.path.length) {
      this.repath = 1.5;
      const L = G.level;
      let targetNode = L.nearestNode(p.pos);
      const victim = Object.entries(G.patients.rooms).find(([k, v]) => v && v.state === 'inRoom' && !v.impostor);
      if (victim && Math.random() < 0.3 && dist > 8) targetNode = victim[0] === 'surgery' ? 'surgery' : victim[0];
      const from = L.nearestNode(this.pos);
      this.path = L.path(from, targetNode).slice(1);
      if (L.nearestNode(p.pos) === targetNode) this.path.push(new THREE.Vector3(p.pos.x, 0, p.pos.z));
    }
    if (this.path.length) {
      const t = this.path[0];
      const dx = t.x - this.pos.x;
      const dz = t.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const speed = 2.7 * G.difficulty().creatureSpeed;
      const step = speed * dt;
      if (d < step) {
        this.pos.set(t.x, 0, t.z);
        this.path.shift();
      } else {
        this.pos.x += (dx / d) * step;
        this.pos.z += (dz / d) * step;
        this.yaw = Math.atan2(dx, dz);
      }
      this.model.speed = speed;
    }
    // harm patients when it reaches their room
    for (const [room, pt] of Object.entries(G.patients.rooms)) {
      if (!pt || pt.impostor || pt.state !== 'inRoom') continue;
      if (Math.hypot(pt.pos.x - this.pos.x, pt.pos.z - this.pos.z) < 1.6) pt.health -= 2.2 * dt;
    }
    // attack the player when it reaches them unseen
    if (dist < 1.0 && this.attackCooldown <= 0) {
      this.attackCooldown = 5;
      G.jumpscare('creature', 35);
      this.flee(30);
      return;
    }
    this.growlTimer -= dt;
    if (this.growlTimer <= 0) {
      this.growlTimer = 5 + Math.random() * 6;
      G.audio.play(Math.random() < 0.5 ? 'growl' : 'scratch', { pos: this.pos.clone().setY(0.5), volume: 0.6 });
    }
  }

  contain() {
    const G = this.G;
    G.campaign.upgrades.pole = Math.max(0, (G.campaign.upgrades.pole || 0) - 1);
    G.patients.stats.creaturesContained++;
    G.campaign.money += 40;
    G.patients.stats.earned += 40;
    G.composure.add(10);
    G.audio.play('hiss', { pos: this.pos.clone().setY(0.5), volume: 0.9, caption: '[The thing thrashes, then goes still]' });
    G.events.emit('contained', this);
    G.restrainFx = 0;
    this.dispose();
    G.incidents.creatures = G.incidents.creatures.filter((c) => c !== this);
  }

  frameUpdate(dt, alpha) {
    const m = this.model;
    const x = lerp(this.prevPos.x, this.pos.x, alpha);
    const z = lerp(this.prevPos.z, this.pos.z, alpha);
    m.root.position.set(x, 0, z);
    m.root.rotation.y = lerpAngle(this.prevYaw, this.yaw, alpha);
    // when watched it is perfectly still: no breathing, no blinking
    m.still = this.observed;
    m.update(this.observed ? 0 : dt);
    this.G.lighting.sample(x, 0.5, z, _v);
    m.setProbe(_v);
    if (this.breath) this.breath.setPos(_w.set(x, 0.6, z));
  }

  dispose() {
    if (this.breath) this.breath.stop(0.2);
    this.model.dispose();
  }
}
