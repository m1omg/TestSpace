// Input system with fully redefinable bindings.
// Keyboard keys are identified by KeyboardEvent.code (layout independent),
// mouse buttons by "Mouse0".."Mouse4" and the wheel by "WheelUp"/"WheelDown".
// Gameplay reads queued presses inside the fixed simulation step, so a tap is
// never lost or duplicated regardless of the display refresh rate.
import { Emitter, storageGet, storageSet } from './core.js';

const KEY = 'nightward.bindings.v1';

export const ACTIONS = [
  { id: 'forward', label: 'Move forward', group: 'Movement', def: ['KeyW', 'ArrowUp'] },
  { id: 'back', label: 'Move backward', group: 'Movement', def: ['KeyS', 'ArrowDown'] },
  { id: 'left', label: 'Strafe left / previous feed', group: 'Movement', def: ['KeyA', 'ArrowLeft'] },
  { id: 'right', label: 'Strafe right / next feed', group: 'Movement', def: ['KeyD', 'ArrowRight'] },
  { id: 'sprint', label: 'Sprint', group: 'Movement', def: ['ShiftLeft', 'ShiftRight'] },
  { id: 'crouch', label: 'Crouch', group: 'Movement', def: ['KeyC', 'ControlLeft'] },
  { id: 'interact', label: 'Interact / use', group: 'Actions', def: ['KeyE', 'Space'] },
  { id: 'primary', label: 'Take photo / hold to contain', group: 'Actions', def: ['Mouse0', ''] },
  { id: 'focus', label: 'Focus (zoom in)', group: 'Actions', def: ['Mouse2', 'KeyZ'] },
  { id: 'camera', label: 'Raise / lower instant camera', group: 'Actions', def: ['KeyQ', ''] },
  { id: 'photos', label: 'Compare last photo', group: 'Actions', def: ['KeyR', ''] },
  { id: 'flashlight', label: 'Flashlight', group: 'Actions', def: ['KeyF', ''] },
  { id: 'flare', label: 'Light an emergency flare', group: 'Actions', def: ['KeyV', ''] },
  { id: 'pager', label: 'Pager (patient board, rules)', group: 'Interface', def: ['Tab', 'KeyP'] },
  { id: 'back_out', label: 'Close panel / step back', group: 'Interface', def: ['KeyX', 'Backspace'] },
];

const ACTION_IDS = ACTIONS.map((a) => a.id);

const KEY_NAMES = {
  Space: 'Space',
  ShiftLeft: 'L-Shift',
  ShiftRight: 'R-Shift',
  ControlLeft: 'L-Ctrl',
  ControlRight: 'R-Ctrl',
  AltLeft: 'L-Alt',
  AltRight: 'R-Alt',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Mouse0: 'Left Mouse',
  Mouse1: 'Middle Mouse',
  Mouse2: 'Right Mouse',
  Mouse3: 'Mouse 4',
  Mouse4: 'Mouse 5',
  WheelUp: 'Wheel Up',
  WheelDown: 'Wheel Down',
  Backspace: 'Backspace',
  Enter: 'Enter',
  Tab: 'Tab',
  CapsLock: 'Caps',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
};

export function keyName(code) {
  if (!code) return '—';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

// Keys the browser/game reserves: never bindable.
const RESERVED = new Set(['Escape', 'F11', 'F12', 'MetaLeft', 'MetaRight']);

export class Input extends Emitter {
  constructor(element) {
    super();
    this.element = element;
    this.bindings = {};
    this.loadBindings();
    this.down = new Set();
    this.pressQueue = new Map();
    this.lookX = 0;
    this.lookY = 0;
    this.locked = false;
    this.lockWanted = false;
    this.lockFailed = false;
    this.dragLook = false; // fallback when pointer lock is unavailable
    this.dragging = false;
    this.capture = null; // rebinding capture callback
    this.enabled = true;
    this.mouseX = 0;
    this.mouseY = 0;

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onBlur = this.onBlur.bind(this);
    this.onLockChange = this.onLockChange.bind(this);
    this.onLockError = this.onLockError.bind(this);

    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('keyup', this.onKeyUp, { capture: true });
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('contextmenu', (e) => {
      if (this.locked || this.dragLook || e.target === this.element) e.preventDefault();
    });
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', this.onLockError);
  }

  // ---------- bindings ----------
  loadBindings() {
    const saved = storageGet(KEY, null);
    for (const a of ACTIONS) {
      const s = saved && Array.isArray(saved[a.id]) ? saved[a.id] : null;
      this.bindings[a.id] = s ? [s[0] || '', s[1] || ''] : [a.def[0] || '', a.def[1] || ''];
    }
  }
  saveBindings() {
    storageSet(KEY, this.bindings);
  }
  resetBindings() {
    for (const a of ACTIONS) this.bindings[a.id] = [a.def[0] || '', a.def[1] || ''];
    this.saveBindings();
    this.emit('bindings');
  }
  // Assign `code` to action slot. If another action already uses that code it
  // receives this action's previous key in exchange (swap), so nothing is lost.
  bind(actionId, slot, code) {
    if (!ACTION_IDS.includes(actionId)) return;
    const previous = this.bindings[actionId][slot];
    if (code) {
      for (const other of ACTION_IDS) {
        const b = this.bindings[other];
        for (let i = 0; i < 2; i++) {
          if (b[i] === code && !(other === actionId && i === slot)) {
            b[i] = other === actionId ? '' : previous || '';
          }
        }
      }
    }
    this.bindings[actionId][slot] = code;
    this.saveBindings();
    this.emit('bindings');
  }
  label(actionId) {
    const b = this.bindings[actionId];
    if (!b) return '?';
    return keyName(b[0] || b[1]);
  }
  startCapture(cb) {
    this.capture = cb;
  }
  cancelCapture() {
    this.capture = null;
  }

  // ---------- state queries ----------
  isDown(actionId) {
    const b = this.bindings[actionId];
    if (!b || !this.enabled) return false;
    return (b[0] && this.down.has(b[0])) || (b[1] && this.down.has(b[1]));
  }
  // Edge-triggered press, consumed once (used in the fixed step).
  consume(actionId) {
    const b = this.bindings[actionId];
    if (!b) return false;
    let hit = false;
    for (const code of b) {
      if (code && this.pressQueue.get(code) > 0) {
        this.pressQueue.set(code, 0);
        hit = true;
      }
    }
    return hit && this.enabled;
  }
  clearPresses() {
    this.pressQueue.clear();
  }
  takeLook() {
    const x = this.lookX;
    const y = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    return [x, y];
  }
  actionsFor(code) {
    const out = [];
    for (const id of ACTION_IDS) {
      const b = this.bindings[id];
      if (b[0] === code || b[1] === code) out.push(id);
    }
    return out;
  }

  // ---------- raw events ----------
  press(code) {
    this.down.add(code);
    this.pressQueue.set(code, (this.pressQueue.get(code) || 0) + 1);
    for (const id of this.actionsFor(code)) this.emit('action', id);
  }
  release(code) {
    this.down.delete(code);
  }
  onKeyDown(e) {
    if (this.capture) {
      e.preventDefault();
      e.stopPropagation();
      const cb = this.capture;
      this.capture = null;
      if (e.code === 'Escape') cb(null);
      else if (RESERVED.has(e.code)) cb(undefined);
      else cb(e.code);
      return;
    }
    if (e.code === 'Escape') {
      if (!e.repeat) this.emit('escape');
      return;
    }
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
      if (target.type !== 'range' && target.type !== 'checkbox') return;
    }
    const bound = this.actionsFor(e.code).length > 0;
    if (bound || e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    if (/^Digit[0-9]$/.test(e.code) && !e.repeat) this.emit('digit', Number(e.code.slice(5)));
    if (e.repeat) return;
    this.press(e.code);
  }
  onKeyUp(e) {
    this.release(e.code);
  }
  onMouseDown(e) {
    const code = 'Mouse' + e.button;
    if (this.capture) {
      // Only capture mouse buttons when clicking somewhere other than the UI
      // button that started the capture.
      if (e.target && e.target.dataset && e.target.dataset.rebind) return;
      e.preventDefault();
      const cb = this.capture;
      this.capture = null;
      cb(code);
      return;
    }
    if (this.dragLook && e.target === this.element && (e.button === 0 || e.button === 2)) {
      this.dragging = true;
    }
    if (!this.locked && !this.dragLook) return;
    if (e.target !== this.element && !this.locked) return;
    this.press(code);
  }
  onMouseUp(e) {
    this.release('Mouse' + e.button);
    if (e.button === 0 || e.button === 2) this.dragging = false;
  }
  onMouseMove(e) {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    if (this.locked || (this.dragLook && this.dragging)) {
      // Ignore the movement spike some browsers emit right after locking,
      // and clamp absurd per-event values.
      if (performance.now() < (this.ignoreUntil || 0)) return;
      const mx = Math.max(-200, Math.min(200, e.movementX || 0));
      const my = Math.max(-200, Math.min(200, e.movementY || 0));
      this.lookX += mx;
      this.lookY += my;
    }
  }
  onWheel(e) {
    if (this.capture) {
      const cb = this.capture;
      this.capture = null;
      cb(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
      return;
    }
    if (!this.locked && !this.dragLook) return;
    const code = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
    this.pressQueue.set(code, (this.pressQueue.get(code) || 0) + 1);
    for (const id of this.actionsFor(code)) this.emit('action', id);
  }
  onBlur() {
    this.down.clear();
    this.dragging = false;
  }

  // ---------- pointer lock ----------
  requestLock() {
    this.lockWanted = true;
    if (this.dragLook) return;
    if (document.pointerLockElement === this.element) return;
    try {
      const r = this.element.requestPointerLock({ unadjustedMovement: false });
      if (r && typeof r.catch === 'function') r.catch(() => this.onLockError());
    } catch (e) {
      this.onLockError();
    }
  }
  releaseLock() {
    this.lockWanted = false;
    this.dragging = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }
  onLockChange() {
    const was = this.locked;
    this.locked = document.pointerLockElement === this.element;
    if (!this.locked) this.down.clear();
    if (was && !this.locked) this.emit('lost-lock', this.lockWanted);
    if (!was && this.locked) {
      this.ignoreUntil = performance.now() + 150;
      this.lookX = 0;
      this.lookY = 0;
      this.emit('locked');
    }
  }
  onLockError() {
    this.lockFailed = true;
    this.emit('lock-error');
  }
  setDragLook(on) {
    this.dragLook = on;
    this.dragging = false;
  }
}
