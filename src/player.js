// First-person controller. Movement runs in the fixed simulation step with
// render interpolation, so speed and feel are identical at 30, 60 or 240 Hz.
import * as THREE from 'three';
import { clamp, damp, lerp, approach } from './core.js';
import { LAYER, viewMask } from './renderer.js';
import { Materials } from './materials.js';

const RADIUS = 0.28;
const EYE_STAND = 1.6;
const EYE_CROUCH = 0.82;
const WALK = 2.5;
const SPRINT = 4.1;
const CROUCH = 1.25;

const _v = new THREE.Vector3();
const _ray = new THREE.Ray();
const _box = new THREE.Box3();
const _hit = new THREE.Vector3();

export class Interactions {
  constructor() {
    this.items = new Map();
  }
  add(it) {
    this.items.set(it.id, it);
    return it;
  }
  remove(id) {
    this.items.delete(id);
  }
  get(id) {
    return this.items.get(id);
  }
  // Nearest interactable along the ray that is not hidden behind a wall.
  pick(origin, dir, maxDist, colliders) {
    _ray.set(origin, dir);
    let best = null;
    let bestD = maxDist;
    for (const it of this.items.values()) {
      if (it.enabled && !it.enabled()) continue;
      const box = it.getBox ? it.getBox(_box) : it.box;
      if (!box) continue;
      const p = _ray.intersectBox(box, _hit);
      if (!p) continue;
      const d = p.distanceTo(origin);
      const range = it.range ?? maxDist;
      if (d < bestD && d <= range) {
        // don't prompt for things we can't name right now
        const prompt = it.prompt ? it.prompt() : null;
        if (!prompt) continue;
        best = { it, d, prompt };
        bestD = d;
      }
    }
    if (!best) return null;
    // wall occlusion
    for (const c of colliders) {
      if (!c.enabled) continue;
      _box.min.set(c.x0, 0, c.z0);
      _box.max.set(c.x1, 2.8, c.z1);
      if (_box.containsPoint(origin)) continue;
      const p = _ray.intersectBox(_box, _hit);
      if (p && p.distanceTo(origin) < best.d - 0.05) return null;
    }
    return best;
  }
}

export class Player {
  constructor(G) {
    this.G = G;
    this.camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.04, 90);
    this.camera.layers.enable(LAYER.EYE);
    this.pos = new THREE.Vector3(2.15, 0, 5.4);
    this.prevPos = this.pos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI; // facing +z (south) means yaw = PI with our convention below
    this.pitch = 0;
    this.eye = EYE_STAND;
    this.prevEye = EYE_STAND;
    this.crouched = false;
    this.bobPhase = 0;
    this.bobAmt = 0;
    this.stepDist = 0;
    this.stepIdx = 0;
    this.fovCurrent = 72;
    this.zoom = 0;
    this.locked = false; // movement locked (focus views)
    this.focus = null;
    this.focusBlend = 0;
    this.camPose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    this.target = null;
    this.holdTime = 0;
    this.holding = null;
    this.trail = [];
    this.cameraRaised = false;
    this.flashlightOn = false;
    this.shake = 0;
    this.noclip = false;
    this.moving = false;

    // flashlight
    const fl = new THREE.SpotLight(0xfff0dc, 0, 18, 0.42, 0.5, 1.6);
    fl.castShadow = false;
    fl.shadow.mapSize.set(1024, 1024);
    fl.shadow.bias = -0.0008;
    fl.shadow.camera.near = 0.15;
    fl.shadow.camera.far = 18;
    this.flashlight = fl;
    this.flashTarget = new THREE.Object3D();
    fl.target = this.flashTarget;
    // camera flash (always present so light count never changes)
    this.photoFlash = new THREE.PointLight(0xffffff, 0, 9, 2);
    G.scene.add(fl, this.flashTarget, this.photoFlash);
    this.flashIntensity = 22;
    this.flashBoost = 1;

    this.buildViewModel();
    this.buildBody();
  }

  // Instant camera held in the lower right (visible only to the player's eyes).
  buildViewModel() {
    const g = new THREE.Group();
    const bodyM = Materials.dynamic('camBody', { color: 0xf2efe6, roughness: 0.5 });
    const darkM = Materials.dynamic('camDark', { color: 0x222429, roughness: 0.4 });
    const accM = Materials.dynamic('camAcc', { color: 0xe0566a, roughness: 0.5 });
    this.vmEntries = [bodyM, darkM, accM];
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, 0.1), bodyM.mat);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.03, 20), darkM.mat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0.0, -0.005, -0.06);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.151, 0.012, 0.101), accM.mat);
    stripe.position.y = 0.03;
    const vf = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, 0.02), darkM.mat);
    vf.position.set(0.045, 0.045, -0.05);
    g.add(body, lens, stripe, vf);
    const mask = viewMask(true, false, false);
    g.traverse((o) => (o.layers.mask = mask.mask));
    g.visible = false;
    this.viewModel = g;
    this.camera.add(g);
    this.G.scene.add(this.camera);
    this.vmRaise = 0;
  }

  // A simple figure visible only on the security cameras.
  buildBody() {
    const m = Materials.dynamic('scrubs', { color: 0x6aa6b8, roughness: 0.9 });
    const skin = Materials.dynamic('skin', { color: 0xc89a7a, roughness: 0.8 });
    this.bodyEntries = [m, skin];
    const g = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.62, 4, 10), m.mat);
    torso.position.y = 1.08;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), skin.mat);
    head.position.y = 1.62;
    const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.6, 4, 8), m.mat);
    legs.position.y = 0.45;
    legs.scale.x = 1.2;
    g.add(torso, head, legs);
    const mask = viewMask(false, false, true);
    g.traverse((o) => (o.layers.mask = mask.mask));
    this.body = g;
    this.G.scene.add(g);
  }

  setFlashlightShadows(on) {
    this.flashlight.castShadow = !!on;
    this.ensureShadowMap();
  }

  // Lit materials sample the flashlight's shadow map whenever shadows are
  // enabled; if it has never been rendered, their draw calls fail and the
  // scene goes black. Render it once whenever it does not exist yet.
  ensureShadowMap() {
    const fl = this.flashlight;
    if (fl.castShadow && !fl.shadow.map) fl.shadow.needsUpdate = true;
  }

  teleport(x, z, yaw = this.yaw, pitch = 0) {
    this.pos.set(x, 0, z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = pitch;
    this.trail.length = 0;
  }

  forward(out = _v) {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  // Mouse look: applied immediately from input deltas (not time based).
  look(dx, dy) {
    if (this.focus && !this.focus.freeLook) return;
    const s = this.G.settings.values;
    const zoomFactor = this.fovCurrent / s.fov;
    const k = 0.0022 * s.mouseSensitivity * zoomFactor;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (s.invertY ? -1 : 1);
    if (this.focus && this.focus.freeLook) {
      const f = this.focus;
      this.yaw = clamp(this.yaw, f.yaw - f.yawRange, f.yaw + f.yawRange);
      this.pitch = clamp(this.pitch, f.pitch - f.pitchRange, f.pitch + f.pitchRange);
    }
    this.pitch = clamp(this.pitch, -1.45, 1.45);
  }

  // ---------- fixed step ----------
  fixedUpdate(dt, input, colliders, enabled) {
    this.prevPos.copy(this.pos);
    this.prevEye = this.eye;
    let mx = 0;
    let mz = 0;
    if (enabled && !this.locked) {
      if (input.isDown('forward')) mz -= 1;
      if (input.isDown('back')) mz += 1;
      if (input.isDown('left')) mx -= 1;
      if (input.isDown('right')) mx += 1;
    }
    const wantCrouch = enabled && !this.locked && input.isDown('crouch');
    this.crouched = wantCrouch;
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      mx /= len;
      mz /= len;
    }
    const sprint = enabled && input.isDown('sprint') && !this.crouched && mz < 0;
    const speed = (this.crouched ? CROUCH : sprint ? SPRINT : WALK) * (this.cameraRaised ? 0.7 : 1);
    // rotate input by yaw
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wx = mx * cos + mz * sin;
    const wz = -mx * sin + mz * cos;
    const accel = len > 0 ? 12 : 14;
    this.vel.x = damp(this.vel.x, wx * speed, accel, dt);
    this.vel.z = damp(this.vel.z, wz * speed, accel, dt);
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    const before = this.pos.clone();
    if (this.noclip) {
      this.pos.x = nx;
      this.pos.z = nz;
    } else {
      this.pos.x = nx;
      this.pos.z = nz;
      this.collide(colliders);
    }
    const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    this.moving = moved > 0.0005;
    // eye height
    this.eye = approach(this.eye, this.crouched ? EYE_CROUCH : EYE_STAND, dt * 4.5);
    // bob and footsteps by distance travelled (refresh independent)
    this.bobPhase += moved * (sprint ? 2.2 : 2.6);
    this.bobAmt = damp(this.bobAmt, this.moving ? (sprint ? 1 : 0.6) : 0, 8, dt);
    this.stepDist += moved;
    const stride = sprint ? 0.78 : this.crouched ? 0.55 : 0.62;
    if (this.stepDist > stride) {
      this.stepDist = 0;
      this.stepIdx = (this.stepIdx + 1) % 4;
      if (this.onStep) this.onStep(this.crouched ? 0.25 : sprint ? 0.75 : 0.5, this.stepIdx);
    }
    // breadcrumb trail for escorted patients
    const last = this.trail[this.trail.length - 1];
    if (!last || last.distanceToSquared(this.pos) > 0.09) {
      this.trail.push(this.pos.clone());
      if (this.trail.length > 120) this.trail.shift();
    }
    this.shake = Math.max(0, this.shake - dt * 1.5);
  }

  collide(colliders) {
    for (let iter = 0; iter < 3; iter++) {
      for (const c of colliders) {
        if (!c.enabled) continue;
        if (this.pos.x < c.x0 - RADIUS || this.pos.x > c.x1 + RADIUS || this.pos.z < c.z0 - RADIUS || this.pos.z > c.z1 + RADIUS) continue;
        const cx = clamp(this.pos.x, c.x0, c.x1);
        const cz = clamp(this.pos.z, c.z0, c.z1);
        let dx = this.pos.x - cx;
        let dz = this.pos.z - cz;
        let d2 = dx * dx + dz * dz;
        if (d2 >= RADIUS * RADIUS) continue;
        if (d2 < 1e-10) {
          // centre inside the box: push out along the shallowest axis
          const left = this.pos.x - c.x0;
          const right = c.x1 - this.pos.x;
          const top = this.pos.z - c.z0;
          const bottom = c.z1 - this.pos.z;
          const m = Math.min(left, right, top, bottom);
          if (m === left) this.pos.x = c.x0 - RADIUS;
          else if (m === right) this.pos.x = c.x1 + RADIUS;
          else if (m === top) this.pos.z = c.z0 - RADIUS;
          else this.pos.z = c.z1 + RADIUS;
          continue;
        }
        const d = Math.sqrt(d2);
        const push = RADIUS - d;
        dx /= d;
        dz /= d;
        this.pos.x += dx * push;
        this.pos.z += dz * push;
        // remove velocity into the wall
        const vn = this.vel.x * dx + this.vel.z * dz;
        if (vn < 0) {
          this.vel.x -= vn * dx;
          this.vel.z -= vn * dz;
        }
      }
    }
  }

  // ---------- per frame ----------
  setFocus(f) {
    // f: { pos, look (Vector3), fov, freeLook, yawRange, pitchRange }
    this.focus = f;
    if (f && f.freeLook) {
      const d = new THREE.Vector3().subVectors(f.look, f.pos);
      f.yaw = Math.atan2(-d.x, -d.z);
      f.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      this.yaw = f.yaw;
      this.pitch = f.pitch;
    }
    this.locked = !!f;
  }

  clearFocus() {
    if (this.focus && this.focus.returnYaw !== undefined) {
      this.yaw = this.focus.returnYaw;
      this.pitch = this.focus.returnPitch;
    }
    this.focus = null;
    this.locked = false;
  }

  frameUpdate(dt, alpha, opts) {
    const s = this.G.settings.values;
    const cam = this.camera;
    // interpolated position
    const px = lerp(this.prevPos.x, this.pos.x, alpha);
    const pz = lerp(this.prevPos.z, this.pos.z, alpha);
    const eye = lerp(this.prevEye, this.eye, alpha);
    const bob = s.headBob ? this.bobAmt : 0;
    const bobY = Math.sin(this.bobPhase * 2) * 0.035 * bob;
    const bobX = Math.cos(this.bobPhase) * 0.025 * bob;
    const freePos = _v.set(px, eye + bobY, pz);
    // free camera orientation
    const qFree = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    let targetPos = freePos.clone();
    targetPos.x += Math.cos(this.yaw) * bobX;
    targetPos.z -= Math.sin(this.yaw) * bobX;
    let targetQ = qFree;
    const focusTarget = this.focus ? 1 : 0;
    this.focusBlend = damp(this.focusBlend, focusTarget, 7, dt);
    if (this.focus) {
      const f = this.focus;
      if (!f._q) {
        const m = new THREE.Matrix4().lookAt(f.pos, f.look, new THREE.Vector3(0, 1, 0));
        f._q = new THREE.Quaternion().setFromRotationMatrix(m);
      }
      const fq = f.freeLook ? qFree : f._q;
      targetPos = targetPos.lerp(f.pos, this.focusBlend);
      targetQ = qFree.clone().slerp(fq, this.focusBlend);
    } else if (this.focusBlend > 0.001 && this.lastFocusPose) {
      targetPos.lerp(this.lastFocusPose.pos, this.focusBlend);
      targetQ = qFree.clone().slerp(this.lastFocusPose.quat, this.focusBlend);
    }
    if (this.focus) this.lastFocusPose = { pos: this.focus.pos.clone(), quat: (this.focus.freeLook ? qFree : this.focus._q).clone() };
    cam.position.copy(targetPos);
    cam.quaternion.copy(targetQ);
    // shake (time based)
    const sh = this.shake * (s.screenShake ?? 1);
    if (sh > 0.001) {
      const t = performance.now() / 1000;
      cam.rotateX(Math.sin(t * 37) * 0.01 * sh);
      cam.rotateY(Math.cos(t * 29) * 0.01 * sh);
    }
    // FOV: base, zoom (focus action), camera viewfinder
    let fov = s.fov;
    if (this.focus && this.focus.fov) fov = this.focus.fov;
    const zoomTarget = opts.zoom ? 1 : 0;
    this.zoom = damp(this.zoom, zoomTarget, 10, dt);
    fov = lerp(fov, fov * 0.4, this.zoom);
    if (this.cameraRaised) fov *= 0.85;
    this.fovCurrent = damp(this.fovCurrent, fov, 12, dt);
    if (Math.abs(cam.fov - this.fovCurrent) > 0.01) {
      cam.fov = this.fovCurrent;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    // view model
    this.vmRaise = damp(this.vmRaise, this.cameraRaised ? 1 : 0, 10, dt);
    this.viewModel.visible = this.vmRaise > 0.02;
    // the instant camera peeks in from the lower right corner when raised
    this.viewModel.position.set(0.3 - this.vmRaise * 0.06, -0.42 + this.vmRaise * 0.17 + bobY * 0.5, -0.45);
    this.viewModel.rotation.set(0.25 * (1 - this.vmRaise), -0.35, 0.1);
    this.viewModel.scale.setScalar(0.8);
    // flashlight follows the camera with a slight lag in aim
    const fl = this.flashlight;
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    fl.position.copy(cam.position).addScaledVector(right, 0.2).add(new THREE.Vector3(0, -0.18, 0));
    this.flashTarget.position.copy(cam.position).addScaledVector(fwd, 6);
    const flick = opts.flashFlicker || 1;
    fl.intensity = this.flashlightOn ? this.flashIntensity * this.flashBoost * flick : 0;
    // skip the shadow-map pass while the flashlight is off (see ensureShadowMap)
    fl.shadow.autoUpdate = this.flashlightOn;
    fl.angle = this.flashBoost > 1.2 ? 0.55 : 0.42;
    // body (CCTV only)
    this.body.position.set(px, 0, pz);
    this.body.rotation.y = this.yaw;
    this.body.scale.y = this.crouched ? 0.6 : 1;
  }

  // Probe light for the held camera / body.
  setProbe(v) {
    for (const e of this.vmEntries) e.probe.value.copy(v).multiplyScalar(1.1).addScalar(0.05);
    for (const e of this.bodyEntries) e.probe.value.copy(v);
  }
}
