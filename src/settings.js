// Player settings with quality presets, difficulty and accessibility options.
import { storageGet, storageSet, Emitter } from './core.js';

const KEY = 'nightward.settings.v1';

export const QUALITY_PRESETS = {
  low: {
    renderScale: 0.6,
    maxDpr: 1,
    pbr: false,
    postFx: false,
    shadows: false,
    msaa: false,
    cctvRes: 256,
    glow: true,
    rain: false,
    hrtf: false,
  },
  medium: {
    renderScale: 0.85,
    maxDpr: 1,
    pbr: true,
    postFx: true,
    shadows: false,
    msaa: false,
    cctvRes: 384,
    glow: true,
    rain: true,
    hrtf: true,
  },
  high: {
    renderScale: 1.0,
    maxDpr: 1.5,
    pbr: true,
    postFx: true,
    shadows: true,
    msaa: true,
    cctvRes: 512,
    glow: true,
    rain: true,
    hrtf: true,
  },
};

export const DIFFICULTIES = {
  easy: {
    label: 'Gentle',
    desc: 'Slower deterioration, calmer nights, impostors show more signs.',
    decay: 0.6,
    composureDrain: 0.6,
    incidents: 0.65,
    extraSigns: 1,
    patience: 1.5,
    creatureSpeed: 0.8,
    pay: 0.9,
  },
  normal: {
    label: 'Standard',
    desc: 'The intended experience.',
    decay: 1,
    composureDrain: 1,
    incidents: 1,
    extraSigns: 0,
    patience: 1,
    creatureSpeed: 1,
    pay: 1,
  },
  hard: {
    label: 'Graveyard',
    desc: 'Patients fade fast, threats are frequent, impostors hide well.',
    decay: 1.35,
    composureDrain: 1.3,
    incidents: 1.4,
    extraSigns: -1,
    patience: 0.75,
    creatureSpeed: 1.2,
    pay: 1.25,
  },
};

function guessDefaultQuality() {
  try {
    const mem = navigator.deviceMemory || 8;
    const cores = navigator.hardwareConcurrency || 8;
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    if (mobile || mem <= 4 || cores <= 4) return 'low';
  } catch (e) {
    /* ignore */
  }
  return 'medium';
}

const DEFAULTS = {
  quality: 'medium',
  ...QUALITY_PRESETS.medium,
  dynamicResolution: true,
  targetFps: 60,
  fov: 72,
  mouseSensitivity: 1.0,
  invertY: false,
  headBob: true,
  masterVolume: 0.85,
  musicVolume: 0.55,
  sfxVolume: 0.9,
  difficulty: 'normal',
  jumpscareReduction: false,
  flickerReduction: false,
  screenShake: 1.0,
  hints: true,
  captions: true,
  showFps: false,
};

export class Settings extends Emitter {
  constructor() {
    super();
    const saved = storageGet(KEY, null);
    this.values = { ...DEFAULTS };
    if (saved && typeof saved === 'object') {
      Object.assign(this.values, saved);
    } else {
      const q = guessDefaultQuality();
      this.values.quality = q;
      Object.assign(this.values, QUALITY_PRESETS[q]);
    }
  }
  get(key) {
    return this.values[key];
  }
  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    if (key in QUALITY_PRESETS.low && this.values.quality !== 'custom') {
      // Editing an individual graphics option turns the preset into "custom".
      const preset = QUALITY_PRESETS[this.values.quality];
      if (preset && preset[key] !== value) this.values.quality = 'custom';
    }
    this.save();
    this.emit('change', key, value);
  }
  applyPreset(name) {
    const preset = QUALITY_PRESETS[name];
    if (!preset) return;
    this.values.quality = name;
    Object.assign(this.values, preset);
    this.save();
    this.emit('change', 'quality', name);
  }
  difficulty() {
    return DIFFICULTIES[this.values.difficulty] || DIFFICULTIES.normal;
  }
  save() {
    storageSet(KEY, this.values);
  }
  reset() {
    this.values = { ...DEFAULTS };
    this.applyPreset(guessDefaultQuality());
  }
}
