// Spatial audio engine. Every sound is synthesised at startup (no files).
// Sources are positioned with PannerNodes (HRTF on medium/high quality);
// sounds from other rooms are muffled with a low-pass filter; music is a
// procedural ambient pad whose dissonance follows the current tension.
import { Emitter, clamp, RNG } from './core.js';

const R = new RNG(99);

function noise() {
  return Math.random() * 2 - 1;
}

// Simple one-pole filters for offline synthesis.
function lowpass(arr, cutoff, sr) {
  const a = Math.exp((-2 * Math.PI * cutoff) / sr);
  let y = 0;
  for (let i = 0; i < arr.length; i++) {
    y = arr[i] * (1 - a) + y * a;
    arr[i] = y;
  }
  return arr;
}
function highpass(arr, cutoff, sr) {
  const a = Math.exp((-2 * Math.PI * cutoff) / sr);
  let y = 0;
  let px = 0;
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    y = a * (y + x - px);
    px = x;
    arr[i] = y;
  }
  return arr;
}
// Resonant band-pass (biquad) for formants.
function bandpass(arr, freq, q, sr) {
  const w0 = (2 * Math.PI * freq) / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const b0 = alpha;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    const y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    arr[i] = y;
  }
  return arr;
}
function normalize(arr, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < arr.length; i++) m = Math.max(m, Math.abs(arr[i]));
  if (m > 0) for (let i = 0; i < arr.length; i++) arr[i] *= peak / m;
  return arr;
}
function env(t, a, d) {
  // attack then exponential decay
  return t < a ? t / a : Math.exp(-(t - a) / d);
}
function fadeEdges(arr, sr, ms = 6) {
  const n = Math.min(arr.length / 2, Math.floor((sr * ms) / 1000));
  for (let i = 0; i < n; i++) {
    const k = i / n;
    arr[i] *= k;
    arr[arr.length - 1 - i] *= k;
  }
  return arr;
}
// Make a buffer loop seamlessly by crossfading its tail into its head.
function loopify(arr, sr, ms = 120) {
  const n = Math.floor((sr * ms) / 1000);
  const out = arr.slice(0, arr.length - n);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    out[i] = out[i] * k + arr[arr.length - n + i] * (1 - k);
  }
  return out;
}

// Animal-ish voice: pitch contour through formant filters.
function voice(sr, dur, f0fn, formants, noiseAmt = 0.15, ampFn = null) {
  const n = Math.floor(sr * dur);
  const src = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = f0fn(t / dur);
    ph += (2 * Math.PI * f) / sr;
    // buzzy glottal-like source
    const saw = ((ph / (2 * Math.PI)) % 1) * 2 - 1;
    src[i] = saw * (1 - noiseAmt) + noise() * noiseAmt;
  }
  const out = new Float32Array(n);
  for (const [freq, q, gain] of formants) {
    const b = bandpass(src.slice(), freq, q, sr);
    for (let i = 0; i < n; i++) out[i] += b[i] * gain;
  }
  for (let i = 0; i < n; i++) {
    const k = i / n;
    out[i] *= ampFn ? ampFn(k) : Math.sin(Math.PI * Math.min(1, k * 1.2)) ** 0.6;
  }
  return normalize(fadeEdges(out, sr), 0.85);
}

function makeLibrary(sr) {
  const L = {};
  const buf = (dur) => new Float32Array(Math.floor(sr * dur));

  // footsteps: 4 variants
  for (let v = 0; v < 4; v++) {
    const a = buf(0.16);
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      a[i] = (noise() * 0.6 + Math.sin(2 * Math.PI * (70 + v * 9) * t) * 0.8) * env(t, 0.004, 0.03);
    }
    L['step' + v] = normalize(lowpass(a, 900 + v * 150, sr), 0.6);
  }
  // door swing: creak + soft thud
  {
    const a = buf(0.9);
    let ph = 0;
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      const f = 180 + Math.sin(t * 9) * 40 + t * 120;
      ph += (2 * Math.PI * f) / sr;
      const creak = Math.sign(Math.sin(ph)) * 0.25 * (Math.sin(t * 60) > 0.2 ? 1 : 0.3);
      a[i] = creak * Math.sin(Math.PI * Math.min(1, t / 0.7)) * 0.5 + noise() * 0.05;
      if (t > 0.7) a[i] += Math.sin(2 * Math.PI * 60 * t) * env(t - 0.7, 0.003, 0.05);
    }
    L.door = normalize(bandpass(a, 900, 0.8, sr), 0.6);
  }
  // door release buzzer
  {
    const a = buf(0.7);
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      a[i] = (Math.sign(Math.sin(2 * Math.PI * 110 * t)) * 0.5 + Math.sign(Math.sin(2 * Math.PI * 221 * t)) * 0.2) * (t < 0.6 ? 1 : 0);
    }
    L.buzzer = normalize(lowpass(fadeEdges(a, sr, 10), 2500, sr), 0.5);
  }
  // shutter: rolling rattle + clunk
  {
    const a = buf(1.9);
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      const rattle = (Math.sin(2 * Math.PI * 28 * t) > 0.3 ? 1 : 0.35) * noise();
      a[i] = rattle * (t < 1.5 ? 0.7 : 0) + (t > 1.5 ? (noise() * 0.6 + Math.sin(2 * Math.PI * 55 * t)) * env(t - 1.5, 0.002, 0.08) : 0);
    }
    L.shutter = normalize(bandpass(a, 700, 0.6, sr), 0.8);
  }
  // door chime: ding-dong
  {
    const a = buf(2.2);
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      const bell = (f, t0) => (t >= t0 ? (Math.sin(2 * Math.PI * f * (t - t0)) + 0.4 * Math.sin(2 * Math.PI * f * 2.76 * (t - t0)) + 0.2 * Math.sin(2 * Math.PI * f * 5.4 * (t - t0))) * Math.exp(-(t - t0) / 0.6) : 0);
      a[i] = bell(784, 0) * 0.6 + bell(622, 0.45) * 0.6;
    }
    L.chime = normalize(fadeEdges(a, sr), 0.55);
  }
  // printer
  {
    const a = buf(1.3);
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      const step = Math.sin(2 * Math.PI * 340 * t) * (Math.sin(2 * Math.PI * 14 * t) > 0 ? 1 : 0.2);
      a[i] = (step * 0.4 + noise() * 0.15) * (t < 1.2 ? 1 : 0);
    }
    L.printer = normalize(lowpass(fadeEdges(a, sr, 20), 3000, sr), 0.4);
  }
  // UI click
  {
    const a = buf(0.04);
    for (let i = 0; i < a.length; i++) a[i] = noise() * env(i / sr, 0.0005, 0.006);
    L.click = normalize(highpass(a, 1500, sr), 0.5);
  }
  // camera shutter + flash whine
  {
    const a = buf(1.0);
    let ph = 0;
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      ph += (2 * Math.PI * (2400 + t * 2600)) / sr;
      a[i] = noise() * env(t, 0.001, 0.012) * 1.2 + noise() * env(Math.max(0, t - 0.05), 0.001, 0.01) * (t > 0.05 ? 0.8 : 0) + Math.sin(ph) * 0.05 * (t > 0.12 ? Math.exp(-(t - 0.12) / 0.4) : 0);
    }
    L.camera = normalize(highpass(a, 800, sr), 0.6);
  }
  // CCTV switch: click + static burst
  {
    const a = buf(0.3);
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      a[i] = noise() * (t < 0.01 ? 1 : 0.35 * Math.exp(-t / 0.08));
    }
    L.cctv = normalize(bandpass(a, 2500, 0.5, sr), 0.4);
  }
  // static loop
  L.static = normalize(loopify(bandpass(Float32Array.from(buf(1.2), () => noise()), 3000, 0.4, sr), sr), 0.25);
  // breaker clunk
  {
    const a = buf(0.5);
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      a[i] = Math.sin(2 * Math.PI * 70 * t) * env(t, 0.002, 0.06) + noise() * env(t, 0.0005, 0.015) * 0.8 + Math.sin(2 * Math.PI * 1800 * t) * env(t, 0.001, 0.02) * 0.3;
    }
    L.breaker = normalize(a, 0.85);
  }
  // power down / power up
  {
    const a = buf(2.2);
    let ph = 0;
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      ph += (2 * Math.PI * (120 * Math.exp(-t * 1.6) + 18)) / sr;
      a[i] = Math.sin(ph) * Math.exp(-t / 0.9) + (t < 0.03 ? noise() : 0) * 0.7;
    }
    L.powerDown = normalize(a, 0.85);
    const b = buf(1.4);
    for (let i = 0; i < b.length; i++) {
      const t = i / sr;
      const tick = Math.sin(t * 70) > 0.85 ? noise() * 0.6 : 0;
      b[i] = tick * (t < 0.8 ? 1 : 0) + Math.sin(2 * Math.PI * 120 * t) * 0.2 * Math.min(1, t / 1.0);
    }
    L.powerUp = normalize(fadeEdges(b, sr, 40), 0.6);
  }
  // fluorescent hum loop
  {
    const a = buf(1.0);
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      a[i] = Math.sin(2 * Math.PI * 120 * t) * 0.5 + Math.sin(2 * Math.PI * 240 * t) * 0.25 + Math.sin(2 * Math.PI * 360 * t) * 0.12 + noise() * 0.04;
    }
    L.hum = normalize(a, 0.3);
  }
  // rain loop
  {
    const a = buf(2.6);
    for (let i = 0; i < a.length; i++) a[i] = noise() * (0.7 + 0.3 * Math.random());
    const drops = buf(2.6);
    for (let k = 0; k < 220; k++) {
      const p = Math.floor(Math.random() * (drops.length - 400));
      for (let j = 0; j < 300; j++) drops[p + j] += noise() * Math.exp(-j / 40) * 0.8;
    }
    for (let i = 0; i < a.length; i++) a[i] = a[i] * 0.4 + drops[i];
    L.rain = normalize(loopify(lowpass(highpass(a, 400, sr), 5000, sr), sr, 300), 0.45);
  }
  // heartbeat (single lub-dub)
  {
    const a = buf(0.6);
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      const thump = (t0, f) => (t >= t0 ? Math.sin(2 * Math.PI * f * (t - t0)) * env(t - t0, 0.008, 0.05) : 0);
      a[i] = thump(0, 55) + thump(0.18, 48) * 0.8;
    }
    L.heartbeat = normalize(lowpass(a, 300, sr), 0.9);
  }
  // monitor beeps
  {
    const a = buf(0.12);
    for (let i = 0; i < a.length; i++) a[i] = Math.sin((2 * Math.PI * 1000 * i) / sr) * (i < a.length - 300 ? 1 : (a.length - i) / 300);
    L.beep = normalize(fadeEdges(a, sr), 0.35);
    const b = buf(0.7);
    for (let i = 0; i < b.length; i++) {
      const t = i / sr;
      const f = t % 0.35 < 0.17 ? 880 : 660;
      b[i] = Math.sign(Math.sin(2 * Math.PI * f * t)) * 0.3 * (t % 0.35 < 0.3 ? 1 : 0);
    }
    L.alarm = normalize(lowpass(fadeEdges(b, sr, 5), 3000, sr), 0.4);
    const c = buf(2.5);
    for (let i = 0; i < c.length; i++) c[i] = Math.sin((2 * Math.PI * 1000 * i) / sr) * 0.3;
    L.flatline = normalize(fadeEdges(c, sr, 30), 0.35);
    const d = buf(0.35);
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      d[i] = Math.sin(2 * Math.PI * 2200 * t) * ((t < 0.08) || (t > 0.16 && t < 0.24) ? 1 : 0);
    }
    L.thermo = normalize(fadeEdges(d, sr, 3), 0.3);
    const e = buf(0.25);
    for (let i = 0; i < e.length; i++) {
      const t = i / sr;
      e[i] = Math.sin(2 * Math.PI * (t < 0.1 ? 1320 : 1760) * t) * (t < 0.22 ? 1 : 0);
    }
    L.pager = normalize(fadeEdges(e, sr, 4), 0.35);
  }
  // scanner sweep loop
  {
    const a = buf(1.0);
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      a[i] = Math.sin(2 * Math.PI * 220 * t) * 0.3 + Math.sin(2 * Math.PI * (600 + 400 * Math.sin(2 * Math.PI * t)) * t) * 0.08 + noise() * 0.03;
    }
    L.scan = normalize(a, 0.3);
  }
  // pill rattle / item pickup
  {
    const a = buf(0.35);
    for (let k = 0; k < 9; k++) {
      const p = Math.floor(Math.random() * (a.length - 600));
      for (let j = 0; j < 500; j++) a[p + j] += noise() * Math.exp(-j / 60);
    }
    L.item = normalize(highpass(a, 2000, sr), 0.45);
  }
  // coffee machine gurgle
  {
    const a = buf(2.4);
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      a[i] = noise() * 0.3 * (0.5 + 0.5 * Math.sin(t * 40 + Math.sin(t * 7) * 5)) + Math.sin(2 * Math.PI * 90 * t) * 0.1;
    }
    L.coffee = normalize(lowpass(fadeEdges(a, sr, 100), 1500, sr), 0.4);
  }
  // cash register ding
  {
    const a = buf(0.9);
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      a[i] = (Math.sin(2 * Math.PI * 1568 * t) + Math.sin(2 * Math.PI * 2093 * t) * 0.6) * Math.exp(-t / 0.25);
    }
    L.cash = normalize(fadeEdges(a, sr), 0.4);
  }
  // sliding door whoosh
  {
    const a = buf(0.8);
    for (let i = 0; i < a.length; i++) a[i] = noise() * Math.sin((Math.PI * i) / a.length);
    L.whoosh = normalize(bandpass(a, 600, 0.5, sr), 0.35);
  }
  // knocks (on glass / wood)
  {
    const a = buf(0.6);
    for (let k = 0; k < 2; k++) {
      const p = Math.floor(sr * k * 0.22);
      for (let j = 0; j < 3000; j++) {
        const t = j / sr;
        a[p + j] += (Math.sin(2 * Math.PI * 900 * t) * 0.6 + Math.sin(2 * Math.PI * 1900 * t) * 0.3 + noise() * 0.3) * Math.exp(-t / 0.02);
      }
    }
    L.knockGlass = normalize(a, 0.7);
    const b = buf(0.8);
    for (let k = 0; k < 3; k++) {
      const p = Math.floor(sr * k * 0.2);
      for (let j = 0; j < 4000; j++) {
        const t = j / sr;
        b[p + j] += (Math.sin(2 * Math.PI * 140 * t) + noise() * 0.4) * Math.exp(-t / 0.03);
      }
    }
    L.knockWood = normalize(lowpass(b, 1200, sr), 0.8);
  }
  // animal voices
  L.bark = voice(sr, 0.28, (k) => 420 - k * 180, [[600, 4, 1], [1300, 6, 0.6], [2600, 8, 0.2]], 0.3, (k) => (k < 0.1 ? k / 0.1 : Math.exp(-(k - 0.1) * 6)));
  L.whine = voice(sr, 0.9, (k) => 700 + Math.sin(k * 9) * 60 - k * 150, [[900, 5, 1], [2200, 8, 0.4]], 0.1);
  L.meow = voice(sr, 0.7, (k) => 520 + Math.sin(k * Math.PI) * 260, [[800, 3, 0.4], [1400, 5, 1], [3000, 8, 0.3]], 0.08);
  L.squeak = voice(sr, 0.18, (k) => 1600 + k * 600, [[2400, 4, 1]], 0.2);
  L.chirp = voice(sr, 0.22, (k) => 2600 + Math.sin(k * 30) * 700, [[3200, 3, 1]], 0.05);
  L.wheek = voice(sr, 0.5, (k) => 1300 + k * 900, [[2000, 3, 1], [3600, 6, 0.4]], 0.12);
  {
    // purr loop
    const a = buf(1.2);
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      a[i] = noise() * (0.5 + 0.5 * Math.sin(2 * Math.PI * 26 * t)) * 0.6;
    }
    L.purr = normalize(loopify(lowpass(a, 500, sr), sr, 100), 0.4);
  }
  L.cough = voice(sr, 0.35, (k) => 200 - k * 60, [[500, 2, 1], [1500, 3, 0.5]], 0.8, (k) => Math.exp(-k * 7));
  // creature sounds
  {
    const a = buf(1.8);
    let ph = 0;
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      ph += (2 * Math.PI * (55 + Math.sin(t * 3) * 10)) / sr;
      a[i] = (Math.sin(ph) * 0.6 + noise() * 0.5 * (0.6 + 0.4 * Math.sin(t * 23))) * Math.sin((Math.PI * i) / a.length);
    }
    L.growl = normalize(lowpass(a, 600, sr), 0.85);
    const b = buf(0.9);
    for (let i = 0; i < b.length; i++) b[i] = noise() * env(i / sr, 0.05, 0.35);
    L.hiss = normalize(highpass(b, 2500, sr), 0.6);
    L.screech = voice(sr, 0.9, (k) => 900 + Math.sin(k * 40) * 300 + k * 600, [[1200, 2, 1], [2800, 3, 0.8], [5200, 5, 0.4]], 0.5);
    const c = buf(2.4);
    for (let i = 0; i < c.length; i++) c[i] = noise();
    const w = new Float32Array(c.length);
    for (const [f, q, g] of [[700, 6, 1], [1200, 8, 0.7], [2600, 10, 0.5]]) {
      const bb = bandpass(c.slice(), f, q, sr);
      for (let i = 0; i < c.length; i++) w[i] += bb[i] * g;
    }
    for (let i = 0; i < w.length; i++) {
      const t = i / sr;
      w[i] *= Math.max(0, Math.sin(t * 7) * Math.sin(t * 2.3)) * Math.sin((Math.PI * i) / w.length);
    }
    L.whisper = normalize(w, 0.55);
    const d = buf(1.4);
    for (let k = 0; k < 14; k++) {
      const p = Math.floor((k / 14) * (d.length - 2000) + Math.random() * 400);
      for (let j = 0; j < 1600; j++) d[p + j] += noise() * Math.exp(-j / 300) * (0.5 + Math.random() * 0.5);
    }
    L.scratch = normalize(highpass(d, 1500, sr), 0.6);
    // jumpscare stinger: dissonant cluster + noise burst
    const e = buf(2.2);
    const freqs = [110, 116.5, 155.6, 233, 246.9, 311, 466];
    for (let i = 0; i < e.length; i++) {
      const t = i / sr;
      let v = 0;
      for (const f of freqs) v += Math.sign(Math.sin(2 * Math.PI * f * t * (1 + t * 0.02))) * 0.12;
      v += noise() * 0.6 * Math.exp(-t / 0.15);
      e[i] = v * env(t, 0.004, 0.7);
    }
    L.stinger = normalize(lowpass(e, 4000, sr), 0.95);
    const f2 = buf(1.5);
    for (let i = 0; i < f2.length; i++) {
      const t = i / sr;
      f2[i] = (Math.sin(2 * Math.PI * 45 * t) + Math.sin(2 * Math.PI * 47.5 * t) * 0.8) * env(t, 0.05, 0.5);
    }
    L.thud = normalize(f2, 0.8);
    const g = buf(3.0);
    for (let i = 0; i < g.length; i++) {
      const t = i / sr;
      g[i] = Math.sin(2 * Math.PI * 38 * t) * 0.5 + Math.sin(2 * Math.PI * 57 * t + Math.sin(t * 0.7) * 2) * 0.35 + noise() * 0.05;
    }
    L.drone = normalize(loopify(lowpass(g, 400, sr), sr, 300), 0.5);
    const h = buf(2.4);
    for (let i = 0; i < h.length; i++) {
      const t = i / sr;
      const cyc = (t % 1.2) / 1.2;
      h[i] = noise() * Math.sin(Math.PI * cyc) ** 2 * (cyc < 0.5 ? 0.6 : 0.9);
    }
    L.breath = normalize(loopify(bandpass(h, 500, 0.7, sr), sr, 150), 0.5);
  }
  return L;
}

export class AudioEngine extends Emitter {
  constructor(settings) {
    super();
    this.settings = settings;
    this.ctx = null;
    this.buffers = {};
    this.active = new Set();
    this.listenerZone = null;
    this.zoneOf = null; // function (x,y,z) -> zone id
    this.tension = 0;
    this.ready = false;
  }

  // Must be called from a user gesture.
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.music = ctx.createGain();
    this.amb = ctx.createGain();
    this.sfx.connect(this.master);
    this.music.connect(this.master);
    this.amb.connect(this.master);
    const lib = makeLibrary(ctx.sampleRate);
    for (const [k, arr] of Object.entries(lib)) {
      const b = ctx.createBuffer(1, arr.length, ctx.sampleRate);
      b.copyToChannel(arr, 0);
      this.buffers[k] = b;
    }
    this.applyVolumes();
    this.ready = true;
    this.startMusic();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings.values;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.masterVolume, t, 0.05);
    this.sfx.gain.setTargetAtTime(s.sfxVolume, t, 0.05);
    this.amb.gain.setTargetAtTime(s.sfxVolume * 0.9, t, 0.05);
    this.music.gain.setTargetAtTime(s.musicVolume * 0.5, t, 0.05);
  }

  setListener(pos, forward, up) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.015);
      l.positionY.setTargetAtTime(pos.y, t, 0.015);
      l.positionZ.setTargetAtTime(pos.z, t, 0.015);
      l.forwardX.setTargetAtTime(forward.x, t, 0.015);
      l.forwardY.setTargetAtTime(forward.y, t, 0.015);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.015);
      l.upX.setTargetAtTime(up.x, t, 0.015);
      l.upY.setTargetAtTime(up.y, t, 0.015);
      l.upZ.setTargetAtTime(up.z, t, 0.015);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
    if (this.zoneOf) this.listenerZone = this.zoneOf(pos.x, pos.y, pos.z);
  }

  occlusion(pos) {
    if (!pos || !this.zoneOf) return 1;
    const z = this.zoneOf(pos.x, pos.y, pos.z);
    const lz = this.listenerZone;
    if (!z || !lz || z === lz) return 1;
    // rooms connect through the corridor / reception; partial muffling
    const open = (a, b) => (a === 'corridor' || b === 'corridor' || (a === 'reception' && b === 'vestibule') || (a === 'vestibule' && b === 'reception') || (a === 'reception' && b === 'outside') || (a === 'outside' && b === 'reception') || (a === 'vestibule' && b === 'outside') || (a === 'outside' && b === 'vestibule'));
    return open(z, lz) ? 0.45 : 0.15;
  }

  // Play a buffer. opts: pos (Vector3), volume, rate, loop, bus, caption,
  // muffle (0..1 extra lowpass), ref (refDistance), detune
  play(name, opts = {}) {
    if (!this.ready) {
      if (opts.caption) this.emit('caption', opts.caption);
      return null;
    }
    const buffer = this.buffers[name];
    if (!buffer) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = !!opts.loop;
    src.playbackRate.value = (opts.rate || 1) * (opts.vary ? 1 + (Math.random() - 0.5) * opts.vary : 1);
    const gain = ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    let node = src;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 20000;
    node.connect(filter);
    node = filter;
    let panner = null;
    if (opts.pos) {
      panner = ctx.createPanner();
      panner.panningModel = this.settings.values.hrtf ? 'HRTF' : 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = opts.ref ?? 1.2;
      panner.maxDistance = 40;
      panner.rolloffFactor = opts.rolloff ?? 1.3;
      this.setPannerPos(panner, opts.pos, true);
      node.connect(panner);
      node = panner;
      const occ = this.occlusion(opts.pos) * (1 - (opts.muffle || 0));
      filter.frequency.value = occ >= 1 ? 20000 : 400 + 9000 * occ * occ;
      if (occ < 1) gain.gain.value *= 0.55 + 0.45 * occ;
    } else if (opts.muffle) {
      filter.frequency.value = 400 + 9000 * (1 - opts.muffle) ** 2;
    }
    node.connect(gain);
    gain.connect(opts.bus === 'amb' ? this.amb : opts.bus === 'music' ? this.music : this.sfx);
    src.start(ctx.currentTime + (opts.delay || 0));
    const h = {
      src,
      gain,
      panner,
      filter,
      pos: opts.pos ? opts.pos.clone() : null,
      base: opts.volume ?? 1,
      muffle: opts.muffle || 0,
      stop: (fade = 0.05) => {
        try {
          gain.gain.setTargetAtTime(0, ctx.currentTime, fade);
          src.stop(ctx.currentTime + fade * 5);
        } catch (e) {
          /* already stopped */
        }
        this.active.delete(h);
      },
      setVolume: (v, tc = 0.1) => {
        h.base = v;
        gain.gain.setTargetAtTime(v, ctx.currentTime, tc);
      },
      setPos: (p) => {
        if (!panner) return;
        h.pos.copy(p);
        this.setPannerPos(panner, p);
      },
      setRate: (r) => src.playbackRate.setTargetAtTime(r, ctx.currentTime, 0.1),
    };
    src.onended = () => this.active.delete(h);
    if (src.loop) this.active.add(h);
    if (opts.caption) this.emit('caption', opts.caption);
    return h;
  }

  setPannerPos(p, pos, immediate) {
    if (p.positionX) {
      if (immediate) {
        p.positionX.value = pos.x;
        p.positionY.value = pos.y;
        p.positionZ.value = pos.z;
      } else {
        const t = this.ctx.currentTime;
        p.positionX.setTargetAtTime(pos.x, t, 0.02);
        p.positionY.setTargetAtTime(pos.y, t, 0.02);
        p.positionZ.setTargetAtTime(pos.z, t, 0.02);
      }
    } else p.setPosition(pos.x, pos.y, pos.z);
  }

  // Re-evaluate occlusion for looping positional sounds (call ~4x/s).
  updateOcclusion() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (const h of this.active) {
      if (!h.pos) continue;
      const occ = this.occlusion(h.pos) * (1 - h.muffle);
      h.filter.frequency.setTargetAtTime(occ >= 1 ? 20000 : 400 + 9000 * occ * occ, t, 0.1);
      h.gain.gain.setTargetAtTime(h.base * (occ >= 1 ? 1 : 0.55 + 0.45 * occ), t, 0.1);
    }
  }

  stopAll() {
    for (const h of [...this.active]) h.stop(0.1);
  }

  // ---------- procedural music ----------
  startMusic() {
    const ctx = this.ctx;
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 700;
    this.musicFilter.Q.value = 0.7;
    this.musicFilter.connect(this.music);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain);
    lfoGain.connect(this.musicFilter.frequency);
    lfo.start();
    this.voices = [];
    for (let i = 0; i < 4; i++) {
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o2.type = 'triangle';
      o2.detune.value = 7;
      const g = ctx.createGain();
      g.gain.value = 0;
      o1.connect(g);
      o2.connect(g);
      g.connect(this.musicFilter);
      o1.start();
      o2.start();
      this.voices.push({ o1, o2, g });
    }
    // dissonant voice for tension
    this.tensionOsc = ctx.createOscillator();
    this.tensionOsc.type = 'sine';
    this.tensionGain = ctx.createGain();
    this.tensionGain.gain.value = 0;
    this.tensionOsc.connect(this.tensionGain);
    this.tensionGain.connect(this.music);
    this.tensionOsc.start();
    this.chordIndex = 0;
    this.chordTimer = 0;
    this.musicLevel = 0.6;
    this.nextChord();
  }

  nextChord() {
    // A minor-ish slow progression (Hz roots)
    const chords = [
      [110, 130.8, 164.8, 220],
      [98, 123.5, 146.8, 196],
      [87.3, 110, 130.8, 174.6],
      [82.4, 103.8, 123.5, 164.8],
    ];
    const c = chords[this.chordIndex % chords.length];
    this.chordIndex++;
    const t = this.ctx.currentTime;
    this.voices.forEach((v, i) => {
      const f = c[i] * (i === 3 ? 1 : 1);
      v.o1.frequency.setTargetAtTime(f, t, 1.5);
      v.o2.frequency.setTargetAtTime(f * 2.003, t, 1.5);
    });
    this.tensionOsc.frequency.setTargetAtTime(c[0] * 1.414, t, 1.0);
  }

  // Called every frame with real dt.
  update(dt, tension) {
    if (!this.ready) return;
    this.tension += (tension - this.tension) * (1 - Math.exp(-dt * 0.8));
    this.chordTimer += dt;
    if (this.chordTimer > 9) {
      this.chordTimer = 0;
      this.nextChord();
    }
    const t = this.ctx.currentTime;
    const lvl = this.musicLevel;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      v.g.gain.setTargetAtTime(lvl * (0.028 - i * 0.004) * (1 - this.tension * 0.4), t, 0.5);
    }
    this.tensionGain.gain.setTargetAtTime(lvl * 0.05 * clamp(this.tension, 0, 1), t, 0.4);
    this.musicFilter.Q.setTargetAtTime(0.7 + this.tension * 6, t, 0.4);
  }

  setMusicLevel(l) {
    this.musicLevel = l;
  }
}
