// The Night Ward — entry point and game state machine.
//
// Simulation runs at a fixed 60 Hz step with render interpolation, so every
// movement, timer and threat behaves identically on 30, 60, 144 or 240 Hz
// displays. Visual-only animation uses real elapsed time.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Settings } from './settings.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { RenderSystem, LAYER } from './renderer.js';
import { Materials, applySwap, shared } from './materials.js';
import { Lighting } from './lighting.js';
import { Level } from './level.js';
import { Player, Interactions } from './player.js';
import { PatientManager, zoneCircuit, voiceFor } from './patients.js';
import { Incidents, Composure } from './incidents.js';
import { Shift, newCampaign, loadCampaign, saveCampaign, clearCampaign } from './shift.js';
import { UI } from './ui.js';
import { Panels } from './panels.js';
import { Emitter, clamp, damp, lerp, formatClock, money, RNG } from './core.js';
import { CONDITIONS, SUPPLIES, HINTS, SPECIES } from './data.js';
import { Tex, dynamicCanvasTexture } from './textures.js';

const STEP = 1 / 60;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _u = new THREE.Vector3();

const G = {
  THREE,
  state: 'boot',
  focusMode: null,
  inventory: [],
  simTime: 0,
  timers: [],
  realTimers: [],
  stareFx: 0,
  underbedFx: 0,
  restrainFx: 0,
  damageFx: 0,
  flashFx: 0,
  cctvActive: false,
  cctvCam: null,
  cctvIndex: 0,
  coffeeCooldown: 0,
  photoCooldown: 0,
  hintState: {},
};
window.__G = G; // handy for debugging from the console

// ---------------------------------------------------------------------------
// timers (sim time pauses with the game; real time does not)
G.later = (seconds, fn, real = false) => {
  (real ? G.realTimers : G.timers).push({ t: seconds, fn });
};
function runTimers(list, dt) {
  for (let i = list.length - 1; i >= 0; i--) {
    const tm = list[i];
    tm.t -= dt;
    if (tm.t <= 0) {
      list.splice(i, 1);
      try {
        tm.fn();
      } catch (e) {
        console.error(e);
      }
    }
  }
}

G.difficulty = () => G.settings.difficulty();

// ---------------------------------------------------------------------------
async function boot() {
  const canvas = document.getElementById('game');
  G.settings = new Settings();
  G.events = new Emitter();
  G.ui = null;
  // WebGL2 check
  const test = document.createElement('canvas').getContext('webgl2');
  if (!test) {
    document.getElementById('screens').innerHTML = `<div class="screen solid"><div class="panel"><h2>WebGL 2 is required</h2><p class="sub">Your browser or graphics driver does not support WebGL 2. Try an up-to-date Chrome, Edge, Firefox or Safari.</p></div></div>`;
    return;
  }
  G.audio = new AudioEngine(G.settings);
  G.input = new Input(canvas);
  G.ui = new UI(G);
  G.ui.loading(0.05);
  await nextFrame();
  try {
    await Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), wait(1500)]);
  } catch (e) {
    /* fonts are optional */
  }
  G.render = new RenderSystem(canvas, G.settings);
  Materials.setQuality(G.settings.get('pbr'), G.settings.get('quality') === 'high' ? 8 : 4);
  G.scene = new THREE.Scene();
  G.scene.background = new THREE.Color(0x020304);
  G.scene.fog = new THREE.FogExp2(0x04060a, 0.03);
  G.ui.loading(0.2, 'Wiring the lights…');
  await nextFrame();
  G.lighting = new Lighting();
  G.lighting.flickerReduction = G.settings.get('flickerReduction');
  G.level = new Level(G);
  G.ui.loading(0.35, 'Building the clinic…');
  await nextFrame();
  G.level.build(G.scene, { shadows: G.settings.get('shadows') });
  G.level.defineCams().forEach((c, i) => (c.index = i));
  G.level.buildGlows(G.scene);
  G.ui.loading(0.6, 'Feeding the fish…');
  await nextFrame();
  buildExtras();
  G.player = new Player(G);
  G.player.trailCount = 0;
  wrapTrail(G.player);
  G.interactions = new Interactions();
  G.patients = new PatientManager(G);
  G.composure = new Composure(G);
  G.incidents = new Incidents(G);
  G.shift = new Shift(G);
  G.panels = new Panels(G);
  G.campaign = loadCampaign() || newCampaign(G.settings.get('difficulty'));
  setupEnvironment();
  setupInteractions();
  setupEvents();
  setupInput();
  G.audio.zoneOf = (x, y, z) => G.lighting.zoneAt(x, y, z);
  G.audio.on('caption', (t) => G.ui && G.ui.caption(t));
  G.render.onResize = (aspect) => {
    G.player.camera.aspect = aspect;
    G.player.camera.updateProjectionMatrix();
  };
  G.render.resize();
  G.settings.on('change', onSettingChange);
  G.ui.loading(0.85, 'Compiling shaders…');
  await nextFrame();
  G.lighting.update(1);
  G.level.update(0, 0);
  for (const d of G.level.doors.values()) G.level.refreshDoorBox(d);
  G.player.teleport(2.15, 5.4, Math.PI, -0.05);
  G.player.frameUpdate(0.016, 1, {});
  G.render.warmup(G.scene, G.player.camera, G.level.cams[0]);
  G.ui.loading(1, 'Ready.');
  await nextFrame();
  G.last = performance.now();
  G.acc = 0;
  requestAnimationFrame(frame);
  toTitle();
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Count trail pushes so escorted patients can follow new breadcrumbs.
function wrapTrail(player) {
  const orig = player.trail.push.bind(player.trail);
  player.trail.push = (...a) => {
    player.trailCount += a.length;
    return orig(...a);
  };
}

function setupEnvironment() {
  if (Materials.pbr) {
    if (!G.envTex) {
      const pm = new THREE.PMREMGenerator(G.render.renderer);
      G.envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
    }
    G.scene.environment = G.envTex;
  } else G.scene.environment = null;
}

// ---------------------------------------------------------------------------
// Extra level pieces that are driven by game logic: shutter, rain, screens.
function buildExtras() {
  const L = G.level;
  // roller shutter on the vestibule side of the intake window
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, '#9aa0a8');
  g.addColorStop(0.45, '#c8cdd4');
  g.addColorStop(0.55, '#7a8088');
  g.addColorStop(1, '#5a5f66');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const entry = Materials.dynamic('shutter', { map: tex, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1), entry.mat);
  mesh.position.set(2.2, 2.05, 7.24);
  mesh.rotation.y = Math.PI;
  mesh.visible = false;
  L.dynamicRoot.add(mesh);
  G.shutter = { mesh, entry, tex, k: 0, target: 0, holdTimer: 0 };
  // rain (time-based shader, no per-frame CPU work)
  const N = 700;
  const pos = new Float32Array(N * 2 * 3);
  const rng = new RNG(5);
  for (let i = 0; i < N; i++) {
    const x = rng.range(-12, 16);
    const z = rng.range(12.2, 28);
    const y = rng.range(0, 7);
    pos.set([x, y, z, x + 0.01, y + 0.2, z], i * 6);
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const rm = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uLight: { value: 1 } },
    vertexShader: `uniform float uTime; varying float vA; void main(){ vec3 p = position; float off = fract(sin(dot(p.xz, vec2(12.9898,78.233))) * 43758.5453); p.y = mod(p.y - uTime * 8.5 - off * 7.0, 7.0); vA = 0.05 + off * 0.09; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `varying float vA; uniform float uLight; void main(){ gl_FragColor = vec4(vec3(0.55,0.6,0.68) * uLight, vA); }`,
    transparent: true,
    depthWrite: false,
  });
  const rain = new THREE.LineSegments(rg, rm);
  rain.frustumCulled = false;
  G.scene.add(rain);
  G.rain = rain;
}

// ---------------------------------------------------------------------------
// Interactables
function setupInteractions() {
  const I = G.interactions;
  const L = G.level;
  const P = () => G.patients;
  const static_ = (id, prompt, use, extra = {}) => {
    const src = L.interactables.get(id);
    if (!src) return;
    I.add({ id, box: src.box, prompt, use, ...extra });
  };
  const wp = () => {
    const p = P().windowPatient;
    return p && p.state === 'window' ? p : null;
  };
  static_('admit', () => (wp() ? `Door release — admit ${wp().name}` : 'Door release (nobody at the window)'), () => {
    if (G.shutter.k > 0.05) return G.ui.notify('The shutter is down.', 'warn');
    const p = wp();
    G.audio.play('buzzer', { pos: _v.set(3.26, 1.1, 6.45).clone(), volume: 0.6 });
    pressButton();
    if (!p) return;
    P().admit();
  });
  static_('shutter', () => (wp() ? `Pull the shutter — turn ${wp().name} away` : 'Shutter lever'), () => {
    if (G.shutter.target > 0) return;
    pullLever();
    const p = wp();
    lowerShutter();
    if (p) P().reject();
  });
  static_('monitor', () => 'Security monitor', () => openCCTV());
  static_('record', () => (wp() ? `Read ${wp().name}'s intake record` : null), () => {
    const p = wp();
    if (p) openPanel('record', () => G.panels.openRecord(p));
  });
  static_('glass', () => (wp() ? 'Knock on the glass' : null), () => knockGlass(), { range: 2.6 });
  static_('board', () => 'Patient status board', () => openPanel('board', () => G.panels.openBoard()), { range: 3.5 });
  static_('pharmacy', () => 'Open the pharmacy cabinet', () => openPanel('pharmacy', () => G.panels.openPharmacy()));
  static_('coffee', () => (G.coffeeCooldown > 0 ? `Coffee machine (brewing… ${Math.ceil(G.coffeeCooldown)}s)` : 'Make a coffee'), () => drinkCoffee());
  static_('rules', () => 'Read the night rules', () => openPanel('rules', () => G.panels.openRules()));
  static_('locker', () => `Locker — catch poles: ${G.campaign.upgrades.pole || 0}, flares: ${G.campaign.upgrades.flare || 0}`, () => {
    G.audio.play('door', { volume: 0.4, rate: 1.6, pos: _v.set(-1.4, 1.2, -15.3).clone() });
    G.ui.notify(`Catch poles: ${G.campaign.upgrades.pole || 0}`, '', `Hold ${G.input.label('primary')} on a loose creature up close to restrain it. Flares (${G.input.label('flare')}): ${G.campaign.upgrades.flare || 0}.`);
  });
  static_('timeclock', () => (G.shift.canClockOut() ? 'Clock out — end the night' : 'Time clock (patients still need you)'), () => {
    if (G.shift.canClockOut()) {
      G.audio.play('cash', { volume: 0.4 });
      G.shift.end('clockout');
    } else G.ui.notify('Not yet.', 'warn', 'You can clock out once every visitor has come and gone and no one needs care.');
  });
  static_('breaker', () => 'Open the breaker panel', () => openPanel('breaker', () => G.panels.openBreaker()));
  // doors
  for (const [id, d] of L.doors) {
    const it = L.interactables.get('door:' + id);
    if (!it) continue;
    I.add({
      id: 'door:' + id,
      box: it.box,
      prompt: () => (d.npcOnly ? null : d.locked ? 'Door (locked)' : d.target > 0.5 ? 'Close door' : 'Open door'),
      use: () => {
        if (d.locked) return G.ui.notify(d.locked, 'warn');
        d.target = d.target > 0.5 ? 0 : 1;
        G.audio.play('door', { pos: d.center.clone(), volume: 0.6, vary: 0.2 });
      },
    });
  }
  const exitIt = L.interactables.get('door:exit');
  I.add({ id: 'door:exit', box: exitIt.box, prompt: () => 'Emergency exit', use: () => G.ui.notify(exitIt.locked, 'warn') });
  // beds
  for (const room of ['room1', 'room2', 'room3', 'surgery']) {
    const it = L.interactables.get('bed:' + room);
    I.add({
      id: 'bed:' + room,
      box: it.box,
      prompt: () => bedPrompt(room),
      use: () => bedUse(room),
      hold: () => (P().rooms[room] && P().rooms[room].dead ? 2.0 : 0),
    });
  }
  // patients (dynamic boxes)
  I.add({
    id: 'patients',
    getBox: (box) => {
      const p = nearestEscortable();
      if (!p) return null;
      const r = p.model.root.position;
      box.min.set(r.x - 0.4, r.y - 0.05, r.z - 0.4);
      box.max.set(r.x + 0.4, r.y + 0.8, r.z + 0.4);
      return box;
    },
    prompt: () => {
      const p = nearestEscortable();
      if (!p) return null;
      if (p.state === 'following') return `Tell ${p.name} to wait here`;
      return `Escort ${p.name}`;
    },
    use: () => {
      const p = nearestEscortable();
      if (!p) return;
      if (p.state === 'following') P().stopEscort(p);
      else {
        P().startEscort(p);
        hintStep('escorted');
      }
    },
  });
}

// The escortable patient closest to the player's aim.
function nearestEscortable() {
  const pl = G.player;
  let best = null;
  let bd = 2.6;
  for (const p of G.patients.patients) {
    if (!['waiting', 'following'].includes(p.state)) continue;
    const d = Math.hypot(p.pos.x - pl.pos.x, p.pos.z - pl.pos.z);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function bedPrompt(room) {
  const M = G.patients;
  const occ = M.rooms[room];
  const esc = M.escorting();
  const label = room === 'surgery' ? 'surgery table' : 'bed';
  if (M.sealed[room]) return 'Sealed — containment is on the way';
  if (occ) {
    if (occ.dead) return `Hold to cover ${occ.name} with a blanket`;
    if (occ.state === 'placing') return null;
    if (occ.state === 'inRoom' || occ.state === 'recovering') return `Examine ${occ.name}`;
    return null;
  }
  if (esc) return `Settle ${esc.name} on the ${label}`;
  return room === 'surgery' ? 'Surgery table (empty)' : 'Exam bed (empty)';
}

function bedUse(room) {
  const M = G.patients;
  const occ = M.rooms[room];
  const esc = M.escorting();
  if (M.sealed[room]) return;
  if (occ) {
    if (occ.dead) {
      M.despawn(occ);
      M.rooms[room] = null;
      G.composure.drain(4);
      G.ui.notify(`You covered ${occ.name} and carried them to the cold room.`, '');
      return;
    }
    if (occ.state === 'inRoom' || occ.state === 'recovering') openExam(occ, room);
    return;
  }
  if (esc) {
    M.placeInRoom(esc, room);
    hintStep('placed');
  }
}

function pressButton() {
  const b = G.level.screens.admitButton;
  b.position.y = 1.095;
  G.later(0.25, () => (b.position.y = 1.11), true);
}

function pullLever() {
  const l = G.level.screens.lever;
  l.rotation.x = 0.5;
  G.later(0.6, () => (l.rotation.x = -0.5), true);
  G.audio.play('click', { volume: 0.6, rate: 0.6 });
}

function lowerShutter() {
  const s = G.shutter;
  s.target = 1;
  s.holdTimer = 4.5;
  G.audio.play('shutter', { pos: _v.set(2.2, 1.6, 7.24).clone(), volume: 0.9, caption: '[The shutter rattles down]' });
}

function knockGlass() {
  const p = G.patients.windowPatient;
  G.audio.play('knockGlass', { pos: _v.set(2.2, 1.5, 7.08).clone(), volume: 0.8 });
  if (!p) return;
  if (!p.impostor) {
    G.later(0.35 + Math.random() * 0.4, () => {
      p.model.lookAt(G.player.camera.position.clone());
      p.model.happy = 0.6;
      G.audio.play(voiceFor(p), { pos: p.model.root.position, volume: 0.5, muffle: 0.35, vary: 0.2 });
      G.later(3, () => p.model.lookAt(null));
    });
  } else if (Math.random() < 0.5) {
    // nothing. it doesn't even blink.
  } else {
    G.later(1.3, () => G.audio.play('knockGlass', { pos: _v.set(2.2, 1.3, 7.3).clone(), volume: 0.7, rate: 0.92, caption: '[Something knocks back]' }));
  }
}

function drinkCoffee() {
  if (G.coffeeCooldown > 0) return;
  const esp = G.campaign.upgrades.espresso;
  G.audio.play('coffee', { pos: _v.set(-6.7, 1.1, -15.1).clone(), volume: 0.6 });
  G.coffeeCooldown = esp ? 60 : 100;
  G.later(2.2, () => {
    G.composure.add(esp ? 35 : 22);
    G.ui.notify('Hot coffee. Your hands stop shaking.', 'good');
  });
}

// ---------------------------------------------------------------------------
// Panels / focus
function openPanel(name, fn) {
  if (G.focusMode) return;
  G.focusMode = name;
  G.player.locked = true;
  G.player.cameraRaised = false;
  G.expectUnlock = true;
  G.input.releaseLock();
  fn();
  G.ui.prompt(null);
}

G.closePanel = () => {
  if (!G.focusMode && G.panels.open !== 'pager') return;
  if (G.panels.open === 'pager') {
    G.panels.close();
    return;
  }
  G.panels.close();
};

G.onPanelClosed = (name) => {
  G.focusMode = null;
  G.cctvActive = false;
  G.player.clearFocus();
  G.player.locked = false;
  if (G.state === 'playing') {
    G.expectUnlock = false;
    G.input.requestLock();
  }
};

function openExam(p, room) {
  const L = G.level;
  const spot = room === 'surgery' ? L.spots.surgery : L.spots[room];
  openPanel('exam', () => G.panels.openExam(p, room));
  const look = spot.bed.clone();
  look.y += 0.22;
  // stand back a little so the whole patient is framed between the panels
  const cam = spot.examCam.clone().sub(look).multiplyScalar(1.45).add(look);
  cam.y = Math.max(cam.y, look.y + 0.75);
  G.player.setFocus({ pos: cam, look, fov: 52, returnYaw: G.player.yaw, returnPitch: G.player.pitch });
  hintStep('exam');
}

function openCCTV() {
  openPanel('cctv', () => {
    G.cctvActive = true;
    const cams = G.availableCams();
    if (!G.cctvCam || !cams.includes(G.cctvCam)) G.cctvCam = cams[0];
    G.cctvTimer = 0;
    G.panels.openCCTV();
    G.audio.play('cctv', { volume: 0.5 });
    G.incidents.onFeedViewed(G.cctvCam);
    hintStep('monitor');
  });
}

G.availableCams = () => G.level.cams.filter((c) => !c.upgrade || G.campaign.upgrades[c.upgrade]);

G.selectCam = (i) => {
  const cams = G.availableCams();
  const n = cams.length;
  const next = cams[((i % n) + n) % n];
  if (next === G.cctvCam) return;
  G.cctvCam = next;
  G.cctvTimer = 0;
  G.audio.play('cctv', { volume: 0.5 });
  G.panels.renderCCTV();
  G.incidents.onFeedViewed(next);
};

// ---------------------------------------------------------------------------
// Treatment API used by the exam panel
G.comfort = (p) => {
  if (p.comfortCooldown > 0) return;
  p.comfortCooldown = 30;
  if (p.impostor) {
    G.composure.drain(6);
    G.ui.notify(`${p.name} leans into your hand. Too hard. It's cold under the fur.`, 'warn');
    return;
  }
  G.composure.add(7);
  p.model.happy = 1;
  p.mood = Math.max(0, p.mood - 0.3);
  const purr = p.species === 'cat' ? 'purr' : voiceFor(p);
  G.audio.play(purr, { pos: p.model.root.position, volume: 0.6 });
  G.ui.notify(`${p.name} relaxes a little.`, 'good');
};

G.playHeartbeat = (p) => {
  const r = p.tests.heart && p.tests.heart.result;
  if (!r) return;
  const pos = p.model.root.position.clone();
  if (r.impossible) {
    G.audio.play('scratch', { pos, volume: 0.5 });
    return;
  }
  const bps = clamp(r.rate / 60, 0.6, 4);
  let t = 0;
  for (let i = 0; i < 6; i++) {
    const jitter = r.rhythm === 'irregular' ? (Math.random() - 0.5) * 0.5 : 0;
    t += Math.max(0.2, 1 / bps + jitter / bps);
    G.later(t, () => {
      G.audio.play('heartbeat', { pos, volume: 0.9, rate: 1 + Math.min(0.6, bps * 0.08) });
      if (r.rhythm === 'murmur') G.audio.play('whoosh', { pos, volume: 0.15, rate: 1.6 });
    });
  }
};

G.treat = (p) => {
  const M = G.patients;
  const r = M.applyTreatment(p, G.inventory);
  if (!r.ok) return r;
  // consume items
  for (const it of r.items) G.inventory.splice(G.inventory.indexOf(it), 1);
  G.audio.play('item', { pos: p.model.root.position, volume: 0.5 });
  const res = M.resolveTreatment(p);
  if (res.reveal) {
    G.closePanel();
    revealImpostor(p, 'treatment');
    return { ok: false, closed: true };
  }
  if (res.ok) {
    hintStep('treated');
    G.composure.add(3);
  }
  return res;
};

G.beginSurgery = (p) => {
  const r = G.patients.applyTreatment(p, G.inventory);
  if (!r.ok) {
    G.panels.data.msg = r.message;
    G.panels.data.msgKind = 'bad';
    G.panels.renderExam();
    return;
  }
  for (const it of r.items) G.inventory.splice(G.inventory.indexOf(it), 1);
  G.panels.root.innerHTML = '';
  G.panels.open = null;
  G.focusMode = 'surgery';
  G.panels.openSurgery(p, (result) => {
    G.focusMode = null;
    G.panels.open = null;
    G.onPanelClosed('surgery');
    if (result.reveal) {
      revealImpostor(p, 'surgery');
      return;
    }
    const res = G.patients.resolveTreatment(p, result.quality);
    G.ui.notify(res.message, res.ok ? 'good' : 'bad');
  });
};

G.reportAnomaly = (p, room) => {
  const M = G.patients;
  G.closePanel();
  if (p.impostor) {
    p.state = 'sealed';
    p.outcome = 'contained';
    M.sealed[room] = 75;
    M.stats.creaturesContained++;
    G.campaign.money += 30;
    M.stats.earned += 30;
    M.changeRep(2, null);
    G.level.setDoor(room === 'surgery' ? 'surgery' : room, false);
    M.log(p, 'Sealed in the room (contained)');
    G.ui.notify(`Room sealed. Containment will collect "${p.name}".`, 'good', '+$30 hazard pay');
    G.audio.play('breaker', { volume: 0.6 });
    G.later(1.5, () => G.audio.play('knockWood', { pos: (G.level.spots[room] || G.level.spots.surgery).bed.clone(), volume: 0.8, caption: '[Something knocks from inside the sealed room]' }));
  } else {
    // a real patient taken away by containment: counts as turning them away
    M.stats.wrongRejects++;
    M.rooms[room] = null;
    M.log(p, 'Wrongly reported and taken away');
    M.despawn(p);
    G.ui.notify(`Containment took ${p.name} away. The readings were normal.`, 'bad');
  }
};

function revealImpostor(p, why) {
  if (p.state === 'gone') return;
  const M = G.patients;
  M.log(p, 'Broke loose inside the clinic');
  G.incidents.revealCreature(p, why);
  G.jumpscare('creature', 20);
}

G.onBreakerReset = () => {
  if (G.lighting.overallLevel() >= 0.999) {
    G.ui.notify('All circuits restored.', 'good');
    G.composure.add(3);
  }
};

// ---------------------------------------------------------------------------
// Visibility helpers used by threats
const _ray = new THREE.Ray();
const _box = new THREE.Box3();
G.lineOfSight = (a, b) => {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const c of G.level.colliders) {
    if (!c.enabled) continue;
    if (c.tag !== 'wall' && !c.door) continue;
    if (segAABB(a.x, a.z, dx, dz, c.x0 + 0.02, c.z0 + 0.02, c.x1 - 0.02, c.z1 - 0.02)) return false;
  }
  return true;
};

function segAABB(px, pz, dx, dz, x0, z0, x1, z1) {
  let tmin = 0;
  let tmax = 1;
  if (Math.abs(dx) < 1e-9) {
    if (px < x0 || px > x1) return false;
  } else {
    let t1 = (x0 - px) / dx;
    let t2 = (x1 - px) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (pz < z0 || pz > z1) return false;
  } else {
    let t1 = (z0 - pz) / dz;
    let t2 = (z1 - pz) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return tmax > 0.0 && tmin < 1.0;
}

G.isVisibleToPlayer = (pos, h = 0, minLight = 0.06, cone = 0.9) => {
  if (G.focusMode === 'cctv') return false;
  const cam = G.player.camera;
  const p = _u.copy(pos);
  p.y += h;
  const to = _w.subVectors(p, cam.position);
  const dist = to.length();
  if (dist > 26) return false;
  to.divideScalar(dist);
  const fwd = cam.getWorldDirection(_v);
  const vHalf = THREE.MathUtils.degToRad(cam.fov / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * cam.aspect);
  const ang = Math.acos(clamp(fwd.dot(to), -1, 1));
  if (ang > hHalf * cone) return false;
  if (!G.lineOfSight(cam.position, p)) return false;
  if (minLight <= 0) return true;
  if (G.lighting.brightness(p.x, p.y, p.z) >= minLight) return true;
  if (G.player.flashlightOn && dist < 14 && ang < 0.45) return true;
  return false;
};

G.jumpscare = (kind, loss) => {
  const reduced = G.settings.get('jumpscareReduction');
  G.ui.jumpscare(kind, reduced);
  G.audio.play(reduced ? 'thud' : 'stinger', { volume: reduced ? 0.6 : 1.0 });
  G.composure.drain(loss);
  G.player.shake = reduced ? 0.4 : 1.2;
  G.damageFx = reduced ? 0.4 : 1;
};

// ---------------------------------------------------------------------------
// Events -> notifications, hints, sounds
function setupEvents() {
  const E = G.events;
  const notify = (...a) => G.ui.notify(...a);
  E.on('arrival', (p) => {
    G.audio.play('chime', { pos: _v.set(2.6, 2.4, 8.8).clone(), volume: 0.8, caption: '[Door chime: a visitor at the intake window]' });
    G.audio.play('printer', { pos: _v.set(2.95, 1.1, 6.7).clone(), volume: 0.6, delay: 1.2 });
    notify(`A visitor is waiting at the intake window`, 'warn', `${SPECIES[p.species].name} — intake record printing at the desk.`);
    hintStep('arrival');
  });
  E.on('admitted', (p) => {
    notify(`${p.name} admitted`, '', 'Waiting area. Escort them to a free room.');
    hintStep('admitted');
  });
  E.on('rejected', (p) => {
    notify(`${p.name} turned away`, '');
    if (p.impostor) {
      G.later(2.4, () => G.audio.play(Math.random() < 0.5 ? 'growl' : 'scratch', { pos: _v.set(2.2, 1.0, 7.5).clone(), volume: 0.9, muffle: 0.4, caption: '[Something claws at the shutter]' }));
    } else {
      G.later(2.0, () => G.audio.play('whine', { pos: _v.set(2.2, 1.0, 7.8).clone(), volume: 0.5, muffle: 0.4, caption: '[A small, sad whimper]' }));
    }
  });
  E.on('leftWindow', (p) => notify(`${p.name} left the window`, p.impostor ? '' : 'bad', 'Visitors give up if you take too long.'));
  E.on('critical', (p) => notify(`${p.name} is critical`, 'bad', `${roomName(p)} — needs treatment now.`));
  E.on('death', (p) => {
    notify(`${p.name} has died`, 'bad', 'Cover them in their room when you can.');
    G.composure.drain(15);
  });
  E.on('discharged', (p, pay) => notify(`${p.name} is going home`, 'good', `+${money(pay)}`));
  E.on('power', (ids, names) => {
    notify('Power failure', 'bad', names.join(', '));
    hintStep('power');
  });
  E.on('underbed', (room) => notify(`Patient distressed in Exam ${room.slice(-1)}`, 'warn', 'Something is scratching.'));
  E.on('creatureLoose', () => notify('Something is loose in the clinic', 'bad', 'It only moves when unwatched.'));
  E.on('contained', () => notify('Restrained.', 'good', 'Containment will collect it at dawn. +$40'));
  E.on('camDead', (id) => notify(`Camera ${id} has gone dark`, 'warn'));
  E.on('roomCleared', (room) => notify(`${room === 'surgery' ? 'Surgery' : 'Exam ' + room.slice(-1)} is clear again`, 'good'));
  E.on('notice', (msg, kind) => notify(msg, kind));
  E.on('reveal', (p, why) => revealImpostor(p, why));
  E.on('testDone', (p, t) => {
    if (G.focusMode !== 'exam' || !G.panels.data || G.panels.data.p !== p) notify(`${p.name}: ${t === 'temp' ? 'temperature' : t === 'heart' ? 'heart' : t === 'scan' ? 'scan' : 'exam'} result ready`, '');
  });
  E.on('placed', () => hintStep('placed'));
}

function roomName(p) {
  const r = G.patients.roomOf(p);
  if (r) return r === 'surgery' ? 'Surgery' : `Exam ${r.slice(-1)}`;
  return p.state === 'window' ? 'Intake window' : 'Waiting area';
}

// Tutorial hints for the first night.
function hintStep(step) {
  const s = G.settings.get('hints');
  const H = G.hintState;
  if (!s || G.shift.index !== 0) {
    if (step === 'power' && s && !H.powerShown) {
      H.powerShown = true;
      showHint(HINTS.power, 10);
    }
    return;
  }
  if (H[step]) return;
  H[step] = true;
  const map = {
    start: [HINTS.start, 12],
    arrival: [HINTS.arrival, 10],
    zoomed: [HINTS.photo, 12],
    photo: [HINTS.monitor, 10],
    monitor: [HINTS.decide, 12],
    admitted: [HINTS.escort, 12],
    escorted: [HINTS.place, 10],
    placed: [HINTS.exam, 10],
    exam: ['Run tests (number keys), read the record, pick a diagnosis. Toggle the clinical guide if unsure.', 12],
    diagnosed: [HINTS.pharmacy, 12],
    power: [HINTS.power, 10],
  };
  const m = map[step];
  if (m) showHint(m[0], m[1]);
}

function showHint(text, seconds) {
  G.ui.hint(text);
  const id = (G.hintId = (G.hintId || 0) + 1);
  G.later(seconds, () => {
    if (G.hintId === id) G.ui.hint(null);
  });
}

// ---------------------------------------------------------------------------
// Input wiring
function setupInput() {
  const I = G.input;
  const canvas = document.getElementById('game');
  canvas.addEventListener('click', () => {
    G.audio.init();
    if (G.state === 'playing' && !G.focusMode && !I.locked && !I.dragLook) I.requestLock();
  });
  window.addEventListener('pointerdown', () => G.audio.init(), { once: false });
  I.on('lost-lock', () => {
    if (G.state === 'playing' && !G.focusMode && !G.expectUnlock) pause();
  });
  I.on('locked', () => G.ui.clickToResume(false));
  I.on('lock-error', () => {
    if (!I.dragLook) {
      I.setDragLook(true);
      G.ui.notify('Mouse capture unavailable', 'warn', 'Drag with the mouse to look around.');
    }
  });
  I.on('escape', () => {
    if (G.state === 'playing') {
      if (G.panels.open === 'pager') G.panels.close();
      else if (G.focusMode) G.closePanel();
      else pause();
    } else if (G.state === 'paused') {
      if (G.ui.current === 'pause') resume();
      else G.ui.pause();
    }
  });
  I.on('action', (id) => {
    if (G.state !== 'playing') return;
    if (id === 'pager') {
      if (!G.focusMode || G.panels.open === 'pager') G.panels.togglePager();
    } else if (id === 'back_out') {
      if (G.focusMode) G.closePanel();
      else if (G.panels.open === 'pager') G.panels.close();
    } else if (id === 'photos') {
      G.photoBig = !G.photoBig;
      if (!G.ui.togglePhotoBig(G.photoBig)) G.photoBig = false;
    }
  });
  I.on('digit', (n) => {
    if (G.state !== 'playing') return;
    if (G.focusMode === 'cctv' && n >= 1) G.selectCam(n - 1);
    else if (G.focusMode === 'exam' && n >= 1 && n <= 4) G.panels.examDigit(n);
    else if (G.focusMode === 'breaker' && n >= 1) G.panels.breakerDigit(n);
  });
  window.addEventListener('blur', () => {
    if (G.state === 'playing' && !G.focusMode) pause();
  });
}

// Gameplay presses, consumed inside the fixed step.
function handleGameplayInput() {
  const I = G.input;
  const pl = G.player;
  if (G.focusMode === 'cctv') {
    if (I.consume('left')) G.selectCam(G.availableCams().indexOf(G.cctvCam) - 1);
    if (I.consume('right')) G.selectCam(G.availableCams().indexOf(G.cctvCam) + 1);
    I.consume('interact');
    return;
  }
  if (G.focusMode) {
    I.consume('interact');
    I.consume('primary');
    I.consume('camera');
    I.consume('flashlight');
    return;
  }
  if (I.consume('flashlight')) {
    pl.flashlightOn = !pl.flashlightOn;
    G.audio.play('click', { volume: 0.5, rate: 1.4 });
  }
  if (I.consume('flare')) useFlare();
  if (I.consume('camera')) {
    pl.cameraRaised = !pl.cameraRaised;
    G.audio.play('click', { volume: 0.35, rate: 0.8 });
  }
  if (I.consume('primary')) {
    if (pl.cameraRaised && G.photoCooldown <= 0) takePhoto();
  }
  // interaction (tap or hold)
  const tgt = G.target;
  const holdNeed = tgt && tgt.it.hold ? (typeof tgt.it.hold === 'function' ? tgt.it.hold() : tgt.it.hold) : 0;
  if (holdNeed > 0) {
    I.consume('interact');
    if (I.isDown('interact')) {
      G.holdTime += STEP;
      if (G.holdTime >= holdNeed) {
        G.holdTime = 0;
        tgt.it.use();
      }
    } else G.holdTime = 0;
  } else {
    G.holdTime = 0;
    if (I.consume('interact') && tgt) {
      tgt.it.use();
      G.audio.play('click', { volume: 0.25 });
    }
  }
}

function useFlare() {
  const c = G.campaign;
  if (!(c.upgrades.flare > 0)) {
    G.ui.notify('No flares left.', 'warn');
    return;
  }
  c.upgrades.flare--;
  G.flashFx = 1;
  G.audio.play('powerUp', { volume: 0.8, rate: 1.6 });
  const any = G.incidents.useFlare();
  G.ui.notify(any ? 'The flare burns white. Everything retreats.' : 'The flare burns out. Nothing was there.', any ? 'good' : '');
}

function takePhoto() {
  G.photoCooldown = 1.3;
  const pl = G.player;
  pl.viewModel.visible = false;
  const canvas = G.render.capturePhoto(G.scene, pl.camera, pl.photoFlash);
  G.ui.setPhoto(canvas, `${formatClock(G.shift.clockMinutes)} · night ${G.shift.index + 1}`);
  G.flashFx = 0.85;
  G.audio.play('camera', { volume: 0.7 });
  hintStep('photo');
}

// ---------------------------------------------------------------------------
// Game flow
function toTitle() {
  G.state = 'title';
  G.focusMode = null;
  G.panels.close();
  G.panels.root.innerHTML = '';
  G.ui.showHUD(false);
  G.input.releaseLock();
  G.audio.stopAll();
  cleanupWorld();
  G.lighting.restoreAll();
  G.attract = { t: 0 };
  // a calm patient waiting in the lobby for the title screen
  const save = loadCampaign();
  G.ui.title(!!save && !save.finished, save || {});
  G.audio.setMusicLevel && G.audio.ready && G.audio.setMusicLevel(0.8);
}
G.toTitle = toTitle;

function cleanupWorld() {
  G.patients.reset();
  G.incidents.clearAll();
  G.inventory = [];
  G.shutter.k = 0;
  G.shutter.target = 0;
  for (const d of G.level.doors.values()) {
    if (d.locked || d.npcOnly) d.target = 0;
    else d.target = 1;
  }
  G.player.flashlightOn = false;
  G.player.cameraRaised = false;
  G.timers = [];
  G.cctvActive = false;
}

G.startNewGame = (diff) => {
  G.audio.init();
  clearCampaign();
  G.campaign = newCampaign(diff);
  saveCampaign(G.campaign);
  showBriefing();
};

G.continueGame = () => {
  G.audio.init();
  const c = loadCampaign();
  if (!c) return G.startNewGame(G.settings.get('difficulty'));
  G.campaign = c;
  showBriefing();
};

function showBriefing() {
  G.state = 'briefing';
  const idx = G.campaign.shift;
  G.ui.briefing(idx, () => {
    saveCampaign(G.campaign);
    if (idx > 0) {
      G.state = 'shop';
      G.ui.shop(() => {
        saveCampaign(G.campaign);
        beginShift();
      });
    } else beginShift();
  });
}

function beginShift() {
  const c = G.campaign;
  if (G.needsWarmup) {
    // compile any shader variants the new quality settings need, so the
    // first seconds of the night don't stutter
    G.needsWarmup = false;
    G.render.warmup(G.scene, G.player.camera, G.level.cams[0]);
  }
  G.audio.init();
  cleanupWorld();
  G.lighting.restoreAll();
  G.lighting.generator = !!c.upgrades.generator;
  G.player.flashIntensity = c.upgrades.flashlight ? 34 : 22;
  G.player.flashBoost = c.upgrades.flashlight ? 1.3 : 1;
  G.composure.reset();
  G.hintState = {};
  G.coffeeCooldown = 0;
  G.simTime = 0;
  G.level.setPosterWrongness(c.shift / 4);
  G.shift.begin(c.shift);
  G.player.teleport(2.15, 5.3, Math.PI, -0.05);
  G.player.clearFocus();
  G.ui.hideScreens();
  G.ui.showHUD(true);
  G.ui.hint(null);
  G.photoBig = false;
  G.ui.el.photo.classList.add('hidden');
  G.state = 'playing';
  G.expectUnlock = false;
  G.input.clearPresses();
  G.input.requestLock();
  G.ui.clickToResume(!G.input.locked && !G.input.dragLook, () => G.input.requestLock());
  G.acc = 0;
  G.ambience = startAmbience();
  hintStep('start');
  G.ui.notify(`Night ${c.shift + 1} begins`, '', `${G.shift.records.length} visitors expected before dawn.`);
}

function startAmbience() {
  const A = G.audio;
  if (!A.ready) return null;
  if (G.ambLoops) for (const h of G.ambLoops) h && h.stop(0.2);
  const loops = [];
  // hum per lit zone, positioned at the zone centre
  const hums = [
    ['reception', 0, new THREE.Vector3(0, 2.6, 3.5)],
    ['corridor', 1, new THREE.Vector3(0, 2.6, -6)],
    ['corridor', 1, new THREE.Vector3(0, 2.6, -18)],
    ['room1', 2, new THREE.Vector3(-4.1, 2.6, -2.6)],
    ['room2', 3, new THREE.Vector3(-4.1, 2.6, -7.6)],
    ['room3', 4, new THREE.Vector3(4.1, 2.6, -2.6)],
    ['surgery', 5, new THREE.Vector3(4.2, 2.6, -8.1)],
    ['pharmacy', 6, new THREE.Vector3(-4.1, 2.6, -12.1)],
  ];
  G.humLoops = hums.map(([z, c, pos]) => ({ circuit: c, h: A.play('hum', { pos, loop: true, volume: 0.12, ref: 1.5, rate: 0.98 + Math.random() * 0.04, bus: 'amb' }) }));
  loops.push(...G.humLoops.map((x) => x.h));
  loops.push(A.play('rain', { pos: new THREE.Vector3(2.5, 2, 12), loop: true, volume: 0.9, ref: 3, bus: 'amb' }));
  loops.push(A.play('rain', { pos: new THREE.Vector3(-4.5, 2, 9), loop: true, volume: 0.6, ref: 3, bus: 'amb', rate: 0.97 }));
  G.ambLoops = loops;
  return loops;
}

function pause() {
  if (G.state !== 'playing') return;
  G.state = 'paused';
  G.input.releaseLock();
  G.ui.pause();
}
G.pause = pause;

function resume() {
  if (G.state !== 'paused') return;
  G.ui.hideScreens();
  G.state = 'playing';
  G.input.clearPresses();
  G.last = performance.now();
  if (!G.focusMode) {
    G.expectUnlock = false;
    G.input.requestLock();
  }
}
G.resume = resume;

G.retryShift = () => {
  if (G.shift.snapshot) G.campaign = JSON.parse(JSON.stringify(G.shift.snapshot));
  saveCampaign(G.campaign);
  G.panels.close();
  G.focusMode = null;
  beginShift();
};

G.quitToTitle = () => {
  // progress inside an unfinished night is not kept
  if (G.shift.snapshot) G.campaign = JSON.parse(JSON.stringify(G.shift.snapshot));
  saveCampaign(G.campaign);
  toTitle();
};

G.onShiftEnd = (reason) => {
  const c = G.campaign;
  G.state = 'summary';
  G.focusMode = null;
  G.panels.close();
  G.panels.root.innerHTML = '';
  G.input.releaseLock();
  // recovering patients go home happy at dawn
  for (const p of G.patients.patients) {
    if (p.state === 'recovering') {
      const pay = Math.round(p.cond.pay * 0.9 * G.difficulty().pay);
      c.money += pay;
      G.patients.stats.earned += pay;
      G.patients.log(p, 'Treated, sent home at dawn');
      p.state = 'discharging';
      G.patients.stats.treated++;
    }
  }
  const sum = G.shift.summarize(reason);
  // supplies carried at dawn go back to the cabinet
  for (const it of G.inventory) c.stock[it] = (c.stock[it] || 0) + 1;
  G.inventory = [];
  G.audio.stopAll();
  G.ui.showHUD(false);
  saveCampaign(c);
  G.ui.summary(sum, () => {
    if (c.reputation <= 0) {
      clearCampaign();
      G.state = 'gameover';
      G.ui.gameOver('fired', null, () => toTitle());
      return;
    }
    if (c.shift >= 4) {
      finishGame();
      return;
    }
    c.shift++;
    saveCampaign(c);
    showBriefing();
  });
};

function finishGame() {
  const c = G.campaign;
  const h = c.history;
  const stats = {
    treated: h.reduce((a, x) => a + x.treated, 0),
    deaths: h.reduce((a, x) => a + x.deaths, 0),
    right: h.reduce((a, x) => a + x.rightRejects, 0),
    letIn: h.reduce((a, x) => a + x.creaturesAdmitted, 0),
    loose: h.reduce((a, x) => a + x.creaturesLoose, 0),
  };
  let key = 'good';
  if (stats.loose >= 3 || stats.letIn >= 5) key = 'infested';
  else if (stats.letIn === 0 && c.reputation >= 70) key = 'best';
  c.finished = true;
  saveCampaign(c);
  G.state = 'ending';
  G.ui.ending(key, stats, () => {
    clearCampaign();
    toTitle();
  });
}

function gameOverFled() {
  G.state = 'gameover';
  G.focusMode = null;
  G.panels.close();
  G.panels.root.innerHTML = '';
  G.input.releaseLock();
  G.audio.stopAll();
  G.ui.showHUD(false);
  G.ui.gameOver('fled', () => G.retryShift(), () => G.quitToTitle());
}

// Current objective text for the pager.
G.objective = () => {
  const M = G.patients;
  const crit = M.patients.find((p) => p.critical && !p.dead && ['inRoom', 'waiting'].includes(p.state));
  if (G.lighting.overallLevel() < 0.999) return 'Restore power at the breaker panel (utility room).';
  if (G.incidents.creatures.length) return 'Something is loose. Keep it in sight. Restrain it or drive it off.';
  if (crit) return `${crit.name} is critical — treat them now.`;
  if (M.windowPatient && M.windowPatient.state === 'window') return `Screen ${M.windowPatient.name} at the intake window.`;
  const waiting = M.patients.find((p) => p.state === 'waiting');
  if (waiting) return `Escort ${waiting.name} to a free room.`;
  const needDx = M.patients.find((p) => p.state === 'inRoom' && !p.diagnosis);
  if (needDx) return `Examine and diagnose ${needDx.name} (${roomName(needDx)}).`;
  const needTx = M.patients.find((p) => p.state === 'inRoom' && p.diagnosis);
  if (needTx) return `Treat ${needTx.name}: ${CONDITIONS[needTx.diagnosis].treatment.map((i) => SUPPLIES[i].name).join(', ')}.`;
  if (G.shift.canClockOut()) return 'Everyone is cared for. Clock out at the time clock in the staff office.';
  return 'Wait for the next visitor. Keep an eye on the board.';
};

// ---------------------------------------------------------------------------
// Settings changes
function onSettingChange(key) {
  const s = G.settings.values;
  if (['quality', 'renderScale', 'postFx', 'msaa', 'cctvRes', 'maxDpr', 'dynamicResolution'].includes(key)) G.render.applySettings();
  if (key === 'quality' || key === 'pbr') {
    const swap = Materials.setQuality(s.pbr, s.quality === 'high' ? 8 : 4);
    if (swap) applySwap(G.scene, swap);
    setupEnvironment();
    G.needsWarmup = true;
  }
  if (key === 'quality' || key === 'shadows') {
    G.render.renderer.shadowMap.enabled = !!s.shadows;
    G.player.setFlashlightShadows(s.shadows);
    G.scene.traverse((o) => {
      if (o.isMesh && o.name.startsWith('static:')) {
        o.castShadow = !!s.shadows;
        o.receiveShadow = !!s.shadows;
      }
      if (o.material && o.material.needsUpdate !== undefined && !Array.isArray(o.material)) o.material.needsUpdate = true;
    });
  }
  if (['masterVolume', 'sfxVolume', 'musicVolume'].includes(key)) G.audio.applyVolumes();
  if (['quality', 'postFx', 'msaa', 'shadows'].includes(key)) G.needsWarmup = true;
  if (key === 'flickerReduction') G.lighting.flickerReduction = s.flickerReduction;
}

// ---------------------------------------------------------------------------
// Simulation step
function fixedUpdate(dt) {
  G.simTime += dt;
  runTimers(G.timers, dt);
  G.coffeeCooldown = Math.max(0, G.coffeeCooldown - dt);
  G.photoCooldown = Math.max(0, G.photoCooldown - dt);
  const pl = G.player;
  handleGameplayInput();
  pl.fixedUpdate(dt, G.input, G.level.colliders, !G.focusMode);
  // interaction target
  if (!G.focusMode) {
    const cam = pl.camera;
    const dir = cam.getWorldDirection(_v);
    G.target = G.interactions.pick(cam.position, dir, 2.3, G.level.colliders);
  } else G.target = null;
  G.shift.fixedUpdate(dt);
  if (G.state !== 'playing') return;
  G.patients.fixedUpdate(dt);
  G.incidents.fixedUpdate(dt, G.shift.time);
  G.composure.fixedUpdate(dt);
  // shutter: hold down, then roll back up for the next visitor
  const sh = G.shutter;
  if (sh.target > 0) {
    sh.holdTimer -= dt;
    if (sh.holdTimer <= 0) sh.target = 0;
  }
  if (G.input.isDown('focus') && !G.focusMode && G.patients.windowPatient) hintStep('zoomed');
  if (G.composure.value <= 0) gameOverFled();
}

// ---------------------------------------------------------------------------
// Per-frame (visual) update
let fpsAcc = 0;
let fpsFrames = 0;
let fpsValue = 60;
let boardTimer = 0;
let clockMinute = -1;
let monitorTimer = 0;
let vitalTimer = 0;
let occlTimer = 0;

function frame(now) {
  requestAnimationFrame(frame);
  G.frameCount = (G.frameCount || 0) + 1;
  const info = G.render.renderer.info;
  if (info.autoReset) info.autoReset = false;
  G.lastInfo = { calls: info.render.calls, tris: info.render.triangles, programs: info.programs ? info.programs.length : 0 };
  info.reset();
  let dt = (now - G.last) / 1000;
  G.last = now;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.25) dt = 0.25;
  runTimers(G.realTimers, dt);
  fpsAcc += dt;
  fpsFrames++;
  if (fpsAcc > 0.5) {
    fpsValue = fpsFrames / fpsAcc;
    fpsAcc = 0;
    fpsFrames = 0;
  }
  const playing = G.state === 'playing';
  const worldDt = playing || G.state === 'title' ? dt : 0;
  G.render.time += worldDt;
  shared.uTime.value += worldDt;
  // mouse look: applied immediately from input deltas
  const [lx, ly] = G.input.takeLook();
  if (playing) G.player.look(lx, ly);
  let alpha = 1;
  if (playing) {
    G.render.trackFrame(dt);
    G.acc += dt;
    let n = 0;
    while (G.acc >= STEP && n < 12) {
      fixedUpdate(STEP);
      G.acc -= STEP;
      n++;
      if (G.state !== 'playing') break;
    }
    if (n >= 12) G.acc = 0;
    alpha = clamp(G.acc / STEP, 0, 1);
  }
  if (G.state === 'title') attractCamera(dt);
  visualUpdate(worldDt, alpha, dt);
  renderFrame(dt);
}

function attractCamera(dt) {
  const a = G.attract || (G.attract = { t: 0 });
  a.t += dt;
  const t = a.t * 0.05;
  const cam = G.player.camera;
  cam.position.set(-1.0 + Math.sin(t) * 1.2, 1.55, 4.6 + Math.cos(t * 0.7) * 0.6);
  cam.lookAt(-4.6 + Math.sin(t * 0.6) * 1.5, 0.9, 2.6 - Math.cos(t * 0.5) * 1.5);
  cam.fov = 60;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  // the corridor lights struggle every so often
  if (Math.random() < dt * 0.15) G.lighting.flicker(1, 0.5);
}

function visualUpdate(dt, alpha, realDt) {
  const pl = G.player;
  pl.ensureShadowMap();
  G.lighting.update(dt);
  G.level.update(dt, G.render.time);
  G.level.updateGlows(G.settings.get('glow'));
  if (G.rain) {
    G.rain.visible = G.settings.get('rain');
    G.rain.material.uniforms.uLight.value = 0.3 + 0.7 * G.lighting.state[7].level;
  }
  // shutter animation
  const sh = G.shutter;
  sh.k = damp(sh.k, sh.target, sh.target > sh.k ? 3.2 : 2.0, dt);
  sh.mesh.visible = sh.k > 0.01;
  const hgt = 1.13 * sh.k;
  sh.mesh.scale.y = Math.max(0.001, hgt);
  sh.mesh.position.y = 2.05 - hgt / 2;
  sh.tex.repeat.set(1, Math.max(1, hgt * 14));
  G.lighting.sample(2.2, 1.5, 7.5, _v, 'vestibule');
  sh.entry.probe.value.copy(_v);
  if (G.state === 'playing' || G.state === 'paused' || G.state === 'summary') {
    G.patients.frameUpdate(dt, alpha);
    G.incidents.frameUpdate(dt, alpha);
    const zoom = G.state === 'playing' && !G.focusMode && G.input.isDown('focus');
    const comp = G.composure.value;
    const flick = pl.flashlightOn && comp < 25 ? (Math.sin(G.render.time * 23) > 0.9 ? 0.2 : 1) : 1;
    pl.frameUpdate(dt, alpha, { zoom, flashFlicker: flick });
  }
  // light probes for dynamic level objects
  for (const d of G.level.doors.values()) {
    G.lighting.sample(d.center.x, 1.2, d.center.z, _v);
    for (const e of d.probe) e.probe.value.copy(_v).multiplyScalar(0.8).addScalar(0.02);
  }
  G.lighting.sample(3.37, 1.3, 6.45, _v, 'reception');
  G.level.leverProbe.probe.value.copy(_v);
  G.lighting.sample(pl.pos.x, 1.4, pl.pos.z, _v);
  pl.setProbe(_v);
  // hum loops follow their circuits
  if (G.humLoops) for (const hl of G.humLoops) if (hl.h) hl.h.setVolume(0.12 * G.lighting.state[hl.circuit].level, 0.05);
  // audio listener
  if (G.audio.ready) {
    const cam = pl.camera;
    const fwd = cam.getWorldDirection(_w);
    _u.set(0, 1, 0).applyQuaternion(cam.quaternion);
    G.audio.setListener(cam.position, fwd, _u);
    G.audio.update(realDt, G.state === 'playing' ? G.incidents.tension() : 0.1);
    occlTimer += realDt;
    if (occlTimer > 0.25) {
      occlTimer = 0;
      G.audio.updateOcclusion();
    }
  }
  // fx decay (time based)
  G.flashFx = Math.max(0, G.flashFx - realDt * 3);
  G.damageFx = Math.max(0, G.damageFx - realDt * 0.8);
  G.panels.update(realDt);
  G.ui.updatePhoto(realDt);
  if (G.state === 'playing' || G.state === 'paused') updateHUD();
  updateWorldScreens(realDt);
}

function updateHUD() {
  const pl = G.player;
  const t = G.target;
  if (G.state === 'playing' && !G.focusMode) {
    let text = t ? `${G.input.label('interact')}  ${t.prompt}` : null;
    for (const c of G.incidents.creatures) {
      if (c.canRestrain) text = `Hold ${G.input.label('primary')} to restrain it`;
    }
    G.ui.prompt(text);
    const holdNeed = t && t.it.hold ? (typeof t.it.hold === 'function' ? t.it.hold() : t.it.hold) : 0;
    G.ui.holdProgress(holdNeed > 0 ? G.holdTime / holdNeed : G.restrainFx > 0 ? G.restrainFx : G.underbedFx > 0 ? G.underbedFx : 0);
  } else {
    G.ui.prompt(null);
    G.ui.holdProgress(0);
  }
  G.ui.updateHUD({
    clock: G.shift.clockMinutes,
    shift: G.shift.index,
    composure: G.composure.value,
    stare: G.stareFx,
    damage: G.damageFx * 0.8 + Math.max(0, (25 - G.composure.value) / 25) * 0.35,
    tray: G.inventory,
    poles: G.campaign.upgrades.pole || 0,
    showFps: G.settings.get('showFps'),
    fps: fpsValue,
    scale: G.settings.get('renderScale') * G.render.dynScale,
    cameraRaised: pl.cameraRaised && !G.focusMode,
    postFx: G.settings.get('postFx'),
  });
  G.ui.hud.querySelector('#crosshair').style.display = G.focusMode ? 'none' : '';
  document.body.classList.toggle('focus', !!G.focusMode);
  document.body.classList.toggle('cctv', G.focusMode === 'cctv');
  G.ui.hud.querySelector('#topleft').style.visibility = G.focusMode === 'cctv' ? 'hidden' : '';
  G.ui.hud.querySelector('#hint').style.visibility = G.focusMode === 'cctv' ? 'hidden' : '';
}

// In-world screens: wall clock, status board TV, vital monitors.
function updateWorldScreens(dt) {
  const L = G.level;
  const S = L.screens;
  if (!S.clock) return;
  const min = Math.floor(G.shift.clockMinutes);
  if (min !== clockMinute) {
    clockMinute = min;
    drawClock(S.clock, G.state === 'title' ? 120 : min);
  }
  boardTimer += dt;
  if (boardTimer > 1) {
    boardTimer = 0;
    drawBoard(S.board);
  }
  vitalTimer += dt;
  if (vitalTimer > 0.2) {
    vitalTimer = 0;
    for (const room of ['room1', 'room2', 'room3']) drawVital(S['vital:' + room], G.patients.rooms[room], room);
  }
}

function drawClock(c, minutes) {
  const ctx = c.ctx;
  const W = c.canvas.width;
  ctx.fillStyle = '#f7f4ec';
  ctx.beginPath();
  ctx.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2a2a2e';
  ctx.lineWidth = 10;
  ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.lineWidth = i % 3 === 0 ? 6 : 3;
    ctx.beginPath();
    ctx.moveTo(W / 2 + Math.sin(a) * 100, W / 2 - Math.cos(a) * 100);
    ctx.lineTo(W / 2 + Math.sin(a) * 112, W / 2 - Math.cos(a) * 112);
    ctx.stroke();
  }
  const total = 22 * 60 + minutes;
  const h = ((total / 60) % 12) / 12;
  const m = (total % 60) / 60;
  ctx.lineCap = 'round';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(W / 2, W / 2);
  ctx.lineTo(W / 2 + Math.sin(h * Math.PI * 2) * 60, W / 2 - Math.cos(h * Math.PI * 2) * 60);
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(W / 2, W / 2);
  ctx.lineTo(W / 2 + Math.sin(m * Math.PI * 2) * 92, W / 2 - Math.cos(m * Math.PI * 2) * 92);
  ctx.stroke();
  c.tex.needsUpdate = true;
}

function drawBoard(b) {
  const ctx = b.ctx;
  const W = b.canvas.width;
  const H = b.canvas.height;
  const powered = G.lighting.isPowered('reception');
  ctx.fillStyle = powered ? '#0f1a22' : '#020304';
  ctx.fillRect(0, 0, W, H);
  if (!powered) {
    b.tex.needsUpdate = true;
    return;
  }
  ctx.fillStyle = '#8fd6c2';
  ctx.font = '700 34px Nunito, Trebuchet MS, sans-serif';
  ctx.fillText('PATIENT STATUS', 28, 50);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#f3d98b';
  ctx.font = '40px VT323, monospace';
  ctx.fillText(formatClock(G.shift.clockMinutes), W - 28, 50);
  ctx.textAlign = 'left';
  const rows = G.state === 'title' ? [] : G.patients.board().slice(0, 6);
  ctx.font = '600 26px Nunito, Trebuchet MS, sans-serif';
  rows.forEach((r, i) => {
    const y = 100 + i * 42;
    if (r.critical && Math.floor(G.render.time * 2) % 2 === 0) {
      ctx.fillStyle = 'rgba(210,61,72,0.35)';
      ctx.fillRect(16, y - 30, W - 32, 40);
    }
    ctx.fillStyle = '#eef0f4';
    ctx.fillText(r.name, 28, y);
    ctx.fillStyle = '#a9afbd';
    ctx.fillText(r.where, 230, y);
    ctx.fillText(r.status.slice(0, 26), 440, y);
    ctx.fillStyle = '#2a3340';
    ctx.fillRect(820, y - 20, 170, 16);
    ctx.fillStyle = r.health < 25 ? '#d23d48' : r.health < 50 ? '#e0a33a' : '#3aa776';
    ctx.fillRect(820, y - 20, 1.7 * clamp(r.health, 0, 100), 16);
  });
  if (!rows.length) {
    ctx.fillStyle = '#a9afbd';
    ctx.fillText('No patients. Quiet night… so far.', 28, 110);
  }
  b.tex.needsUpdate = true;
}

function drawVital(v, p, room) {
  if (!v) return;
  const pl = G.player.pos;
  const spot = G.level.spots[room].monitor;
  if (Math.hypot(pl.x - spot.x, pl.z - spot.z) > 9) return;
  const ctx = v.ctx;
  const W = v.canvas.width;
  const H = v.canvas.height;
  const powered = G.lighting.isPowered(room);
  ctx.fillStyle = '#04100a';
  ctx.fillRect(0, 0, W, H);
  if (!powered) {
    v.tex.needsUpdate = true;
    return;
  }
  const t = G.render.time;
  ctx.strokeStyle = p && p.critical ? '#ff6060' : '#4fe08a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let x = 0; x < W; x += 2) {
    let y = H * 0.45;
    if (p && !p.dead) {
      const rate = p.critical ? 2.4 : 1.4;
      const ph = (x / W) * 2 + t * rate;
      const f = ph % 1;
      y += f > 0.4 && f < 0.44 ? -50 : f > 0.44 && f < 0.48 ? 26 : Math.sin(f * 20) * 2;
      if (p.impostor && p.tests.heart && p.tests.heart.done) y = H * 0.45 + Math.sin(x * 0.3 + t * 9) * 30;
    }
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#c8ffd8';
  ctx.font = '28px VT323, monospace';
  if (p) {
    ctx.fillText(p.name.toUpperCase(), 10, 26);
    ctx.fillText(p.dead ? '---' : `${Math.round(p.health)}%`, W - 70, 26);
  } else ctx.fillText('NO PATIENT', 10, 26);
  v.tex.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Rendering
function renderFrame(dt) {
  const R = G.render;
  const pl = G.player;
  const comp = G.composure ? G.composure.value : 100;
  if (G.cctvActive && G.cctvCam) {
    const cam = G.cctvCam;
    const fps = G.campaign.upgrades.cctv1 ? 15 : 12;
    G.cctvTimer = (G.cctvTimer || 0) - dt;
    const powered = G.lighting.isPowered('reception');
    const dead = G.incidents.deadCams.has(cam.id);
    if (G.cctvTimer <= 0 && powered && !dead) {
      G.cctvTimer = 1 / fps;
      renderCCTVView(cam, false);
    }
    const up = G.campaign.upgrades;
    R.displayCCTV({
      noise: up.cctv2 ? 0.1 : up.cctv1 ? 0.2 : 0.42,
      signal: powered && !dead ? 1 : 0,
      glitch: G.incidents.presenceGlitch(cam.id),
      night: cam.zone === 'outside' ? 1 : 0.2,
    });
    return;
  }
  // desk monitor (small, rarely updated)
  monitorTimer -= dt;
  if (monitorTimer <= 0 && G.state === 'playing' && pl.pos.distanceTo(_v.set(1.15, 0, 6.6)) < 6) {
    monitorTimer = 0.2;
    const cam = G.cctvCam || G.level.cams[0];
    const powered = G.lighting.isPowered('reception');
    const dead = G.incidents.deadCams.has(cam.id);
    const tex = renderCCTVView(cam, true, { noise: 0.4, signal: powered && !dead ? 1 : 0, glitch: G.incidents.presenceGlitch(cam.id), night: 0.2 });
    const m = G.level.screens.monitor.material;
    if (m.map !== tex) {
      m.map = tex;
      m.needsUpdate = true;
    }
  }
  const stress = clamp((60 - comp) / 60, 0, 1);
  R.render(G.scene, pl.camera, {
    stress: stress * 0.8 + G.stareFx * 0.6,
    flash: G.flashFx,
    desat: stress * 0.5,
    dark: 0,
    grain: 0.035 + stress * 0.05,
    vignette: 0.42 + stress * 0.3 + G.stareFx * 0.3,
    ca: 0.0018 + stress * 0.004,
  });
}

function renderCCTVView(cam, monitor, params) {
  // impostors whose heads follow every camera
  for (const p of G.patients.patients) p.model.applyViewOverride(cam.pos);
  let tex = null;
  if (monitor) tex = G.render.renderMonitor(G.scene, cam, params);
  else G.render.renderCCTVScene(G.scene, cam);
  for (const p of G.patients.patients) p.model.clearViewOverride();
  return tex;
}

// Test/debug hooks (used by the automated playtests).
G.debugAdvance = (seconds) => {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n && G.state === 'playing'; i++) fixedUpdate(STEP);
};
G.takePhoto = () => takePhoto();
G.openCCTV = () => openCCTV();
G.openExam = (p, room) => openExam(p, room);

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('screens');
  el.innerHTML = `<div class="screen solid"><div class="panel"><h2>Something went wrong</h2><p class="sub">${String(e && e.message ? e.message : e)}</p></div></div>`;
});
