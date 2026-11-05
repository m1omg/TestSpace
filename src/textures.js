// Procedurally generated canvas textures: no image files are needed, so the
// game runs offline and straight from disk.
import * as THREE from 'three';
import { RNG } from './core.js';

const R = new RNG(1337);

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function colorTex(canvas, repeat = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

function dataTex(canvas, repeat = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Tileable value noise into an ImageData-like float array.
function valueNoise(w, h, cells, seed) {
  const rng = new RNG(seed);
  const grid = [];
  for (let i = 0; i < cells * cells; i++) grid.push(rng.next());
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = (x / w) * cells;
      const gy = (y / h) * cells;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const ux = fx * fx * (3 - 2 * fx);
      const uy = fy * fy * (3 - 2 * fy);
      const a = grid[(y0 % cells) * cells + (x0 % cells)];
      const b = grid[(y0 % cells) * cells + ((x0 + 1) % cells)];
      const c = grid[((y0 + 1) % cells) * cells + (x0 % cells)];
      const d = grid[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
      out[y * w + x] = (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
    }
  }
  return out;
}

function fbm(w, h, seed, octaves = [[4, 0.5], [8, 0.3], [16, 0.2]]) {
  const out = new Float32Array(w * h);
  octaves.forEach(([cells, amp], i) => {
    const n = valueNoise(w, h, cells, seed + i * 101);
    for (let k = 0; k < out.length; k++) out[k] += n[k] * amp;
  });
  return out;
}

// Height map (0..1 floats) -> tangent-space normal map canvas.
function heightToNormal(height, w, h, strength = 2.0) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = height[y * w + ((x - 1 + w) % w)];
      const r = height[y * w + ((x + 1) % w)];
      const u = height[((y - 1 + h) % h) * w + x];
      const d = height[((y + 1) % h) * w + x];
      let nx = (l - r) * strength;
      let ny = (u - d) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const cache = {};

export const Tex = {
  // Speckled vinyl floor tiles. One texture = 2 m x 2 m (4 x 4 tiles).
  floor() {
    if (cache.floor) return cache.floor;
    const S = 512;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const n = fbm(S, S, 11);
    const img = ctx.createImageData(S, S);
    const tile = S / 4;
    const height = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const k = y * S + x;
        const tx = Math.floor(x / tile);
        const ty = Math.floor(y / tile);
        const checker = (tx + ty) % 2 === 0;
        let v = checker ? 236 : 226;
        v += (n[k] - 0.5) * 18;
        const lx = x % tile;
        const ly = y % tile;
        const seam = lx < 2 || ly < 2 || lx > tile - 3 || ly > tile - 3;
        if (seam) v -= 38;
        const i = k * 4;
        // warm off-white with a hint of mint on alternating tiles
        img.data[i] = v - (checker ? 4 : 10);
        img.data[i + 1] = v + (checker ? 0 : 2);
        img.data[i + 2] = v - (checker ? 8 : 6);
        img.data[i + 3] = 255;
        height[k] = seam ? 0.0 : 0.5 + n[k] * 0.06;
      }
    }
    ctx.putImageData(img, 0, 0);
    // speckles
    for (let i = 0; i < 2600; i++) {
      const x = R.next() * S;
      const y = R.next() * S;
      const r = R.range(0.6, 1.8);
      const tone = R.pick(['rgba(120,130,140,0.5)', 'rgba(170,150,160,0.45)', 'rgba(90,110,100,0.4)', 'rgba(255,255,255,0.5)']);
      ctx.fillStyle = tone;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // scuffs
    ctx.globalAlpha = 0.06;
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = '#333';
      ctx.lineWidth = R.range(1, 3);
      ctx.beginPath();
      const x = R.next() * S;
      const y = R.next() * S;
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + R.range(-30, 30), y + R.range(-10, 10), x + R.range(-60, 60), y + R.range(-20, 20));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    cache.floor = colorTex(c);
    cache.floorNormal = dataTex(heightToNormal(height, S, S, 3.0));
    return cache.floor;
  },
  floorNormal() {
    this.floor();
    return cache.floorNormal;
  },

  // Painted plaster: neutral light grey noise, tinted by material colour.
  wall() {
    if (cache.wall) return cache.wall;
    const S = 256;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const n = fbm(S, S, 23, [[8, 0.5], [32, 0.35], [64, 0.15]]);
    const img = ctx.createImageData(S, S);
    for (let k = 0; k < S * S; k++) {
      const v = 238 + (n[k] - 0.5) * 16;
      img.data[k * 4] = v;
      img.data[k * 4 + 1] = v;
      img.data[k * 4 + 2] = v;
      img.data[k * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    cache.wall = colorTex(c);
    return cache.wall;
  },

  // Acoustic ceiling tiles, 2 x 2 tiles per texture (1.2 m).
  ceiling() {
    if (cache.ceiling) return cache.ceiling;
    const S = 256;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#e9e7e1';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 1800; i++) {
      ctx.fillStyle = `rgba(110,105,100,${R.range(0.08, 0.25)})`;
      ctx.fillRect(R.next() * S, R.next() * S, R.range(1, 2), R.range(1, 2));
    }
    ctx.fillStyle = '#b9b6ae';
    ctx.fillRect(0, 0, S, 3);
    ctx.fillRect(0, S / 2 - 1, S, 3);
    ctx.fillRect(0, 0, 3, S);
    ctx.fillRect(S / 2 - 1, 0, 3, S);
    // water stain
    const g = ctx.createRadialGradient(170, 70, 2, 170, 70, 40);
    g.addColorStop(0, 'rgba(150,120,70,0.0)');
    g.addColorStop(0.75, 'rgba(150,120,70,0.10)');
    g.addColorStop(1, 'rgba(150,120,70,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(120, 20, 100, 100);
    cache.ceiling = colorTex(c);
    return cache.ceiling;
  },

  wood() {
    if (cache.wood) return cache.wood;
    const S = 256;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const n = fbm(S, S, 41, [[8, 0.5], [32, 0.5]]);
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const k = y * S + x;
        const grain = Math.sin((x / S) * 110 + n[k] * 14) * 0.5 + 0.5;
        const v = 0.75 + grain * 0.18 + (n[k] - 0.5) * 0.1;
        img.data[k * 4] = 196 * v;
        img.data[k * 4 + 1] = 156 * v;
        img.data[k * 4 + 2] = 116 * v;
        img.data[k * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    cache.wood = colorTex(c);
    return cache.wood;
  },

  metal() {
    if (cache.metal) return cache.metal;
    const S = 256;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#c9ccd0';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      ctx.strokeStyle = `rgba(${R.pick(['255,255,255', '90,95,100'])},${R.range(0.05, 0.18)})`;
      ctx.lineWidth = 1;
      const y = R.next() * S;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(S, y + R.range(-2, 2));
      ctx.stroke();
    }
    cache.metal = colorTex(c);
    return cache.metal;
  },

  // Small square wall tiles for the surgery room (1 m per texture).
  tiles() {
    if (cache.tiles) return cache.tiles;
    const S = 256;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#9fb8b6';
    ctx.fillRect(0, 0, S, S);
    const t = S / 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const v = R.range(-6, 6);
        ctx.fillStyle = `rgb(${226 + v},${238 + v},${236 + v})`;
        roundRect(ctx, x * t + 1.5, y * t + 1.5, t - 3, t - 3, 3);
        ctx.fill();
      }
    }
    cache.tiles = colorTex(c);
    return cache.tiles;
  },

  carpet() {
    if (cache.carpet) return cache.carpet;
    const S = 256;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const n = fbm(S, S, 77, [[16, 0.5], [64, 0.5]]);
    const img = ctx.createImageData(S, S);
    for (let k = 0; k < S * S; k++) {
      const v = 0.8 + (n[k] - 0.5) * 0.4;
      img.data[k * 4] = 120 * v;
      img.data[k * 4 + 1] = 112 * v;
      img.data[k * 4 + 2] = 140 * v;
      img.data[k * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    cache.carpet = colorTex(c);
    return cache.carpet;
  },

  // Soft radial glow for fake bloom halos.
  glow() {
    if (cache.glow) return cache.glow;
    const S = 128;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    cache.glow = colorTex(c, false);
    return cache.glow;
  },

  // Dark radial blob used as a cheap contact shadow.
  blob() {
    if (cache.blob) return cache.blob;
    const S = 128;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    cache.blob = colorTex(c, false);
    return cache.blob;
  },

  // Horizontal blinds with transparent gaps.
  blinds() {
    if (cache.blinds) return cache.blinds;
    const c = makeCanvas(64, 256);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 64, 256);
    for (let i = 0; i < 16; i++) {
      const y = i * 16;
      const g = ctx.createLinearGradient(0, y, 0, y + 11);
      g.addColorStop(0, '#f4f1ea');
      g.addColorStop(1, '#c9c4b9');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, 64, 11);
    }
    const t = colorTex(c);
    cache.blinds = t;
    return t;
  },

  // The night outside: sky gradient, tree line, distant road lamp.
  outside() {
    if (cache.outside) return cache.outside;
    const W = 1024;
    const H = 256;
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#05070d');
    g.addColorStop(0.55, '#0c1220');
    g.addColorStop(0.75, '#111522');
    g.addColorStop(1, '#07080b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // stars hidden by clouds; a faint moon glow
    const m = ctx.createRadialGradient(780, 50, 2, 780, 50, 90);
    m.addColorStop(0, 'rgba(160,170,200,0.25)');
    m.addColorStop(1, 'rgba(160,170,200,0)');
    ctx.fillStyle = m;
    ctx.fillRect(600, 0, 360, 200);
    // tree line
    ctx.fillStyle = '#020304';
    ctx.beginPath();
    ctx.moveTo(0, H);
    let x = 0;
    while (x <= W) {
      const h = 120 + Math.sin(x * 0.01) * 20 + R.range(0, 40);
      ctx.lineTo(x, H - h * 0.5 - 40);
      x += R.range(6, 18);
      ctx.lineTo(x, H - h * 0.45 - 30 - R.range(0, 30));
      x += R.range(4, 10);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
    // a far lamp
    const l = ctx.createRadialGradient(220, 150, 1, 220, 150, 30);
    l.addColorStop(0, 'rgba(255,190,120,0.9)');
    l.addColorStop(0.2, 'rgba(255,170,90,0.3)');
    l.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = l;
    ctx.fillRect(180, 110, 80, 80);
    cache.outside = colorTex(c, false);
    return cache.outside;
  },

  asphalt() {
    if (cache.asphalt) return cache.asphalt;
    const S = 256;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const n = fbm(S, S, 91, [[16, 0.4], [64, 0.6]]);
    const img = ctx.createImageData(S, S);
    for (let k = 0; k < S * S; k++) {
      const v = 50 + n[k] * 40;
      img.data[k * 4] = v;
      img.data[k * 4 + 1] = v;
      img.data[k * 4 + 2] = v + 4;
      img.data[k * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    cache.asphalt = colorTex(c);
    return cache.asphalt;
  },

  rain() {
    if (cache.rain) return cache.rain;
    const c = makeCanvas(16, 128);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(200,220,255,0)');
    g.addColorStop(1, 'rgba(200,220,255,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(7, 0, 2, 128);
    cache.rain = colorTex(c, false);
    return cache.rain;
  },
};

// ---------- illustrations ----------

function cuteFace(ctx, x, y, s, kind, fur, opts = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = fur;
  // ears
  if (kind === 'cat') {
    ctx.beginPath();
    ctx.moveTo(-34, -20);
    ctx.lineTo(-24, -52);
    ctx.lineTo(-6, -30);
    ctx.moveTo(34, -20);
    ctx.lineTo(24, -52);
    ctx.lineTo(6, -30);
    ctx.fill();
  } else if (kind === 'dog') {
    ctx.beginPath();
    ctx.ellipse(-36, -4, 12, 26, 0.3, 0, Math.PI * 2);
    ctx.ellipse(36, -4, 12, 26, -0.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'rabbit') {
    ctx.beginPath();
    ctx.ellipse(-14, -56, 9, 30, -0.15, 0, Math.PI * 2);
    ctx.ellipse(14, -56, 9, 30, 0.15, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(0, 0, 40, 34, 0, 0, Math.PI * 2);
  ctx.fill();
  // eyes
  const eyes = opts.eyes || [[-14, -4], [14, -4]];
  for (const [ex, ey] of eyes) {
    ctx.fillStyle = opts.voidEyes ? '#000' : '#1d1b22';
    ctx.beginPath();
    ctx.arc(ex, ey, 6.5, 0, Math.PI * 2);
    ctx.fill();
    if (!opts.voidEyes) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ex + 2, ey - 2.5, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // nose + mouth
  ctx.fillStyle = '#3a2a2e';
  ctx.beginPath();
  ctx.ellipse(0, 8, 5, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3a2a2e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(-5, 12, 5, 0.1, Math.PI - 0.6);
  ctx.arc(5, 12, 5, 0.6, Math.PI - 0.1);
  ctx.stroke();
  // blush
  ctx.fillStyle = 'rgba(255,130,150,0.45)';
  ctx.beginPath();
  ctx.ellipse(-24, 10, 7, 4, 0, 0, Math.PI * 2);
  ctx.ellipse(24, 10, 7, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function posterFrame(ctx, x, y, w, h, bg) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 6;
  ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
}

function text(ctx, str, x, y, size, color, weight = '800', align = 'center', font = 'Trebuchet MS, Verdana, sans-serif') {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

function wrapText(ctx, str, x, y, maxW, lineH) {
  const words = str.split(' ');
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      y += lineH;
      line = w;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
  return y;
}

// Poster atlas: 4 x 2 cells of 384 x 512 px. `wrong` (0..1) adds subtle
// wrongness as the week goes on.
export const POSTER_COLS = 4;
export const POSTER_ROWS = 2;
export function drawPosterAtlas(canvas, wrong = 0) {
  const ctx = canvas.getContext('2d');
  const W = 384;
  const H = 512;
  const cell = (i) => [(i % POSTER_COLS) * W, Math.floor(i / POSTER_COLS) * H];
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 0: Adopt don't shop
  let [x, y] = cell(0);
  posterFrame(ctx, x, y, W, H, '#ffd9cf');
  text(ctx, 'ADOPT,', x + W / 2, y + 70, 54, '#d0566b');
  text(ctx, "DON'T SHOP", x + W / 2, y + 125, 46, '#d0566b');
  cuteFace(ctx, x + 120, y + 290, 1.5, 'dog', '#c98d5b', wrong > 0.85 ? { voidEyes: true } : {});
  cuteFace(ctx, x + 268, y + 300, 1.35, 'cat', '#7f8590', wrong > 0.85 ? { voidEyes: true } : {});
  text(ctx, 'Every friend deserves a home', x + W / 2, y + 445, 20, '#8a4a55', '600');

  // 1: Happy teeth
  [x, y] = cell(1);
  posterFrame(ctx, x, y, W, H, '#cfeef0');
  text(ctx, 'HAPPY TEETH', x + W / 2, y + 70, 46, '#2f7f86');
  text(ctx, 'HAPPY PETS', x + W / 2, y + 120, 46, '#2f7f86');
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#2f7f86';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(x + 130, y + 210);
  ctx.bezierCurveTo(x + 110, y + 170, x + 180, y + 170, x + 192, y + 195);
  ctx.bezierCurveTo(x + 204, y + 170, x + 274, y + 170, x + 254, y + 210);
  ctx.bezierCurveTo(x + 250, y + 300, x + 236, y + 380, x + 222, y + 380);
  ctx.bezierCurveTo(x + 205, y + 380, x + 205, y + 300, x + 192, y + 300);
  ctx.bezierCurveTo(x + 179, y + 300, x + 179, y + 380, x + 162, y + 380);
  ctx.bezierCurveTo(x + 148, y + 380, x + 134, y + 300, x + 130, y + 210);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2f7f86';
  ctx.beginPath();
  ctx.arc(x + 172, y + 240, 7, 0, Math.PI * 2);
  ctx.arc(x + 212, y + 240, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.lineWidth = 4;
  ctx.arc(x + 192, y + 255, 18, 0.2, Math.PI - 0.2);
  ctx.stroke();
  text(ctx, 'Ask us about dental checks', x + W / 2, y + 445, 20, '#2f7f86', '600');

  // 2: Flea season
  [x, y] = cell(2);
  posterFrame(ctx, x, y, W, H, '#fff1b8');
  text(ctx, 'FLEA SEASON', x + W / 2, y + 70, 48, '#b06a12');
  text(ctx, 'IS HERE!', x + W / 2, y + 122, 44, '#b06a12');
  ctx.fillStyle = '#6b3d14';
  ctx.beginPath();
  ctx.ellipse(x + 192, y + 280, 70, 50, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6b3d14';
  ctx.lineWidth = 7;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x + 150 + i * 35, y + 315);
    ctx.lineTo(x + 130 + i * 40, y + 380);
    ctx.lineTo(x + 115 + i * 45, y + 372);
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x + 238, y + 262, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(x + 242, y + 262, 7, 0, Math.PI * 2);
  ctx.fill();
  text(ctx, 'Monthly treatment keeps them away', x + W / 2, y + 445, 19, '#8a5410', '600');

  // 3: Lost pet poster
  [x, y] = cell(3);
  posterFrame(ctx, x, y, W, H, '#fbfbf7');
  text(ctx, 'LOST CAT', x + W / 2, y + 60, 56, '#222');
  ctx.fillStyle = '#ddd';
  ctx.fillRect(x + 72, y + 105, 240, 200);
  const lostEyes = wrong > 0.4 ? [[-14, -4], [14, -4], [0, -18]] : [[-14, -4], [14, -4]];
  cuteFace(ctx, x + 192, y + 215, 2.0, 'cat', '#2a2a2a', { eyes: lostEyes });
  text(ctx, 'Answers to "BEAN"', x + W / 2, y + 335, 26, '#222', '700');
  ctx.font = '600 18px Trebuchet MS, sans-serif';
  ctx.fillStyle = '#444';
  wrapText(
    ctx,
    wrong > 0.65 ? 'If you see her at night, do not let her in.' : 'Last seen near the clinic. Very friendly, a little shy.',
    x + W / 2,
    y + 372,
    300,
    24
  );
  for (let i = 0; i < 8; i++) {
    ctx.strokeStyle = '#999';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x + 24 + i * 42, y + 430);
    ctx.lineTo(x + 24 + i * 42, y + 505);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.save();
    ctx.translate(x + 45 + i * 42, y + 468);
    ctx.rotate(-Math.PI / 2);
    text(ctx, '555-0142', 0, 0, 12, '#444', '600');
    ctx.restore();
  }

  // 4: Know the signs (educational, doubles as a hint)
  [x, y] = cell(4);
  posterFrame(ctx, x, y, W, H, '#e3dcff');
  text(ctx, 'IS YOUR PET', x + W / 2, y + 60, 40, '#5b46a8');
  text(ctx, 'UNWELL?', x + W / 2, y + 105, 44, '#5b46a8');
  const signs = ['Limping', 'Swelling', 'Shivering', 'Tiredness', 'Coughing', 'Drooling'];
  signs.forEach((s, i) => {
    ctx.fillStyle = '#5b46a8';
    ctx.beginPath();
    ctx.arc(x + 70, y + 170 + i * 45, 10, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, s, x + 95, y + 170 + i * 45, 28, '#3b2d70', '700', 'left');
  });
  text(ctx, 'These are signs of illness.', x + W / 2, y + 455, 20, '#3b2d70', '700');
  text(ctx, wrong > 0.95 ? 'Everything else is not.' : 'We are here to help, 24/7.', x + W / 2, y + 482, 18, '#3b2d70', '600');

  // 5: Wash hands
  [x, y] = cell(5);
  posterFrame(ctx, x, y, W, H, '#d6f5dc');
  text(ctx, 'WASH YOUR', x + W / 2, y + 70, 46, '#2b8a4a');
  text(ctx, 'HANDS', x + W / 2, y + 122, 56, '#2b8a4a');
  for (let i = 0; i < 14; i++) {
    ctx.strokeStyle = '#2b8a4a';
    ctx.lineWidth = 3;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(x + 80 + R.next() * 230, y + 190 + R.next() * 200, R.range(10, 30), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  text(ctx, 'Between every patient', x + W / 2, y + 445, 22, '#2b8a4a', '600');

  // 6: Open 24/7
  [x, y] = cell(6);
  posterFrame(ctx, x, y, W, H, '#1f2a4a');
  ctx.fillStyle = '#ffe9a8';
  ctx.beginPath();
  ctx.arc(x + 192, y + 200, 70, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1f2a4a';
  ctx.beginPath();
  ctx.arc(x + 222, y + 180, 64, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 20; i++) {
    ctx.fillStyle = 'rgba(255,240,200,0.8)';
    ctx.fillRect(x + 20 + R.next() * 340, y + 20 + R.next() * 300, 3, 3);
  }
  text(ctx, 'OPEN ALL NIGHT', x + W / 2, y + 330, 38, '#ffe9a8');
  text(ctx, 'Emergencies welcome', x + W / 2, y + 380, 24, '#c9d2f0', '600');
  text(ctx, wrong > 0.75 ? 'Please knock twice. Only twice.' : 'Ring the bell at the intake window', x + W / 2, y + 420, 18, '#c9d2f0', '600');

  // 7: Anatomy chart
  [x, y] = cell(7);
  posterFrame(ctx, x, y, W, H, '#f6f0e4');
  text(ctx, 'CANINE SKELETON', x + W / 2, y + 50, 32, '#5a4a3a');
  ctx.strokeStyle = '#5a4a3a';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + 80, y + 200);
  ctx.quadraticCurveTo(x + 190, y + 170, x + 300, y + 210);
  ctx.stroke();
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    ctx.moveTo(x + 130 + i * 14, y + 195 - i * 0.5);
    ctx.quadraticCurveTo(x + 125 + i * 14, y + 250, x + 140 + i * 12, y + 270);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(x + 60, y + 190, 30, 22, -0.3, 0, Math.PI * 2);
  ctx.stroke();
  [[110, 205], [140, 205], [270, 215], [300, 215]].forEach(([lx, ly]) => {
    ctx.beginPath();
    ctx.moveTo(x + lx, y + ly);
    ctx.lineTo(x + lx + 6, y + ly + 80);
    ctx.lineTo(x + lx, y + ly + 150);
    ctx.stroke();
  });
  ctx.font = '600 15px Trebuchet MS, sans-serif';
  ctx.fillStyle = '#5a4a3a';
  ctx.textAlign = 'left';
  ['Skull', 'Cervical vertebrae', 'Ribs (13 pairs)', 'Femur', 'Tibia'].forEach((s, i) => ctx.fillText(s, x + 40, y + 410 + i * 20));
  return canvas;
}

export function makePosterAtlas(wrong = 0) {
  const c = makeCanvas(384 * POSTER_COLS, 512 * POSTER_ROWS);
  drawPosterAtlas(c, wrong);
  const t = colorTex(c, false);
  t.anisotropy = 4;
  return t;
}

// Signage atlas: 8 x 4 cells of 256 x 128.
export const SIGN_LIST = [
  ['1', 'EXAM'],
  ['2', 'EXAM'],
  ['3', 'EXAM'],
  ['SURGERY', ''],
  ['PHARMACY', ''],
  ['STAFF', 'ONLY'],
  ['UTILITY', 'BREAKERS'],
  ['RECEPTION', ''],
  ['EXIT', ''],
  ['TREATMENT', 'ROOMS →'],
  ['PLEASE WAIT', 'TO BE CALLED'],
  ['INTAKE', 'WINDOW'],
  ['NO ENTRY', ''],
  ['KEEP CLEAR', ''],
  ['WAITING', 'AREA'],
  ['NIGHT WARD', 'VETERINARY'],
];
export function makeSignAtlas() {
  const W = 256;
  const H = 128;
  const c = makeCanvas(W * 4, H * 4);
  const ctx = c.getContext('2d');
  SIGN_LIST.forEach(([a, b], i) => {
    const x = (i % 4) * W;
    const y = Math.floor(i / 4) * H;
    const isExit = a === 'EXIT';
    const isBrand = a === 'NIGHT WARD';
    ctx.fillStyle = isExit ? '#0e5a2a' : isBrand ? '#2c3e5c' : a === 'NO ENTRY' ? '#9c2a2a' : '#f7f4ee';
    ctx.fillRect(x, y, W, H);
    ctx.fillStyle = isExit ? '#0e5a2a' : 'rgba(0,0,0,0)';
    const fg = isExit ? '#7dff9e' : isBrand ? '#f3e9d2' : a === 'NO ENTRY' ? '#fff' : '#3e5560';
    if (/^[0-9]$/.test(a)) {
      text(ctx, a, x + 70, y + H / 2 + 4, 92, '#e0708a');
      text(ctx, b, x + 168, y + H / 2, 40, fg);
    } else if (b) {
      text(ctx, a, x + W / 2, y + 44, a.length > 9 ? 30 : 38, fg);
      text(ctx, b, x + W / 2, y + 90, b.length > 9 ? 24 : 28, isBrand ? '#e0b47a' : fg, '700');
    } else {
      text(ctx, a, x + W / 2, y + H / 2 + 2, a.length > 8 ? 36 : 54, fg);
    }
  });
  const t = colorTex(c, false);
  t.anisotropy = 4;
  return t;
}

export function signUV(index) {
  const col = index % 4;
  const row = Math.floor(index / 4);
  // canvas origin is top-left; texture v origin is bottom
  return { u0: col / 4, u1: (col + 1) / 4, v0: 1 - (row + 1) / 4, v1: 1 - row / 4 };
}

export function posterUV(index) {
  const col = index % POSTER_COLS;
  const row = Math.floor(index / POSTER_COLS);
  return {
    u0: col / POSTER_COLS,
    u1: (col + 1) / POSTER_COLS,
    v0: 1 - (row + 1) / POSTER_ROWS,
    v1: 1 - row / POSTER_ROWS,
  };
}

// Canvas-backed dynamic texture (clocks, boards, vital monitors).
export function dynamicCanvasTexture(w, h) {
  const canvas = makeCanvas(w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return { canvas, ctx: canvas.getContext('2d'), tex };
}

export { text as drawText, wrapText, cuteFace };
