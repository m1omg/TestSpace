// DOM user interface: menus, settings, key rebinding, HUD, briefings,
// shop, shift summary and endings.
import { ACTIONS, keyName } from './input.js';
import { QUALITY_PRESETS, DIFFICULTIES } from './settings.js';
import { escapeHtml, formatClock, money, clamp, RNG } from './core.js';
import { SUPPLIES, SUPPLY_IDS, UPGRADES, CONDITIONS, SPECIES, SIGNS, DOCTOR, BRIEFINGS, REVIEWS, ENDINGS, RULES, SHIFTS } from './data.js';
import { rulesForShift, supplyOffers, upgradeAvailable, buyUpgrade, buySupply } from './shift.js';

const $ = (sel, root = document) => root.querySelector(sel);

export function supplyIcon(id) {
  const s = SUPPLIES[id];
  const c = s ? s.color : '#ccc';
  const shapes = {
    pill: `<rect x="6" y="14" width="28" height="12" rx="6" fill="${c}"/><rect x="20" y="14" width="14" height="12" rx="6" fill="#fff" opacity=".85"/>`,
    roll: `<circle cx="20" cy="20" r="12" fill="${c}" stroke="#bbb"/><circle cx="20" cy="20" r="4" fill="#ddd"/>`,
    splint: `<rect x="8" y="6" width="9" height="28" rx="3" fill="${c}"/><rect x="23" y="6" width="9" height="28" rx="3" fill="${c}"/><rect x="6" y="17" width="28" height="5" fill="#fff"/>`,
    box: `<rect x="7" y="10" width="26" height="20" rx="3" fill="${c}"/><path d="M11 20h18M20 14v12" stroke="#fff" stroke-width="3"/>`,
    bag: `<path d="M12 8h16v18a8 8 0 0 1-16 0z" fill="${c}"/><rect x="18" y="30" width="4" height="7" fill="#aaa"/>`,
    pack: `<rect x="7" y="9" width="26" height="22" rx="7" fill="${c}"/><path d="M14 20q6-6 12 0" stroke="#fff" stroke-width="2.5" fill="none"/>`,
    vial: `<rect x="14" y="8" width="12" height="5" fill="#888"/><rect x="13" y="13" width="14" height="20" rx="3" fill="${c}"/>`,
    bottle: `<rect x="16" y="6" width="8" height="7" fill="#777"/><path d="M12 15q8-4 16 0v16a3 3 0 0 1-3 3H15a3 3 0 0 1-3-3z" fill="${c}"/>`,
    syringe: `<rect x="8" y="17" width="20" height="7" rx="2" fill="${c}" stroke="#999"/><rect x="28" y="19" width="7" height="3" fill="#999"/><rect x="4" y="15" width="4" height="11" fill="#999"/>`,
    pole: `<rect x="18" y="4" width="4" height="30" fill="#aab"/><circle cx="20" cy="9" r="6" fill="none" stroke="#e86" stroke-width="3"/>`,
  };
  const shape = id === 'pole' ? shapes.pole : shapes[s ? s.shape : 'box'];
  return `<svg viewBox="0 0 40 40" aria-hidden="true">${shape}</svg>`;
}

function doctorPortrait() {
  return `<svg viewBox="0 0 150 190" role="img" aria-label="${DOCTOR.name}">
    <defs><radialGradient id="dg" cx="50%" cy="30%" r="70%"><stop offset="0" stop-color="#2b3443"/><stop offset="1" stop-color="#11151c"/></radialGradient></defs>
    <rect width="150" height="190" fill="url(#dg)"/>
    <rect x="96" y="18" width="40" height="52" rx="3" fill="#1a2029" stroke="#3a4454"/>
    <path d="M30 190c4-44 22-62 45-62s41 18 45 62z" fill="#e9edf0"/>
    <path d="M62 132l13 20 13-20" fill="#9fb8c8"/>
    <path d="M75 152v38" stroke="#c9cfd4" stroke-width="2"/>
    <rect x="66" y="112" width="18" height="20" fill="#b48a72"/>
    <ellipse cx="75" cy="92" rx="25" ry="30" fill="#c69a80"/>
    <path d="M48 92c-2-30 12-44 28-44s30 12 27 42c-4-18-14-26-27-26s-22 8-28 28z" fill="#3a2a24"/>
    <path d="M50 90c-6 26-2 40 6 46 0-14-2-28-6-46zM100 90c6 26 2 40-6 46 0-14 2-28 6-46z" fill="#3a2a24"/>
    <rect x="57" y="88" width="15" height="10" rx="3" fill="#e8f2f8" opacity=".85" stroke="#333" stroke-width="1.5"/>
    <rect x="78" y="88" width="15" height="10" rx="3" fill="#e8f2f8" opacity=".85" stroke="#333" stroke-width="1.5"/>
    <path d="M72 93h6" stroke="#333" stroke-width="1.5"/>
    <path d="M68 110q7 3 14 0" stroke="#7a4a40" stroke-width="2" fill="none"/>
    <circle cx="112" cy="150" r="7" fill="none" stroke="#7aa" stroke-width="3"/>
    <path d="M112 143v-12q0-8-8-8" stroke="#7aa" stroke-width="3" fill="none"/>
  </svg>`;
}

export class UI {
  constructor(G) {
    this.G = G;
    this.screens = $('#screens');
    this.overlays = $('#overlays');
    this.hud = $('#hud');
    this.current = null;
    this.notes = [];
    this.buildHUD();
    this.captionTimers = [];
  }

  // ------------------------------------------------------------------
  // screens
  show(html, id, cls = 'dim') {
    this.screens.innerHTML = `<div class="screen ${cls}" id="${id}">${html}</div>`;
    this.current = id;
    return this.screens.firstElementChild;
  }

  hideScreens() {
    this.screens.innerHTML = '';
    this.current = null;
  }

  click() {
    this.G.audio.play('click', { volume: 0.5 });
  }

  bindButtons(root, map) {
    root.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const fn = map[b.dataset.act];
        if (fn) {
          this.click();
          fn(b, e);
        }
      });
    });
  }

  loading(progress, text = 'Opening the clinic…') {
    let el = $('#loading');
    if (!el) {
      el = this.show(`<div class="loading"><div class="logo" style="font-size:42px"><small>Veterinary · Open all night</small>The Night Ward</div><p class="sub" id="ld-text"></p><div class="bar"><i id="ld-bar"></i></div></div>`, 'loading', 'solid');
    }
    $('#ld-text').textContent = text;
    $('#ld-bar').style.width = `${Math.round(progress * 100)}%`;
  }

  title(hasSave, saveInfo) {
    const G = this.G;
    const el = this.show(
      `<div class="title-wrap">
        <h1 class="logo"><small>Veterinary · Open all night</small>The Night<br>Ward</h1>
        <p class="tagline">You are the only attendant on the overnight shift. Help every animal that comes to the window. First, make sure it is an animal.</p>
        <div class="menu">
          ${hasSave ? `<button class="btn primary" data-act="continue">Continue <small style="opacity:.6;font-size:13px">— Night ${saveInfo.shift + 1} of 5</small></button>` : ''}
          <button class="btn ${hasSave ? '' : 'primary'}" data-act="new">New game</button>
          <button class="btn" data-act="how">How to play</button>
          <button class="btn" data-act="settings">Settings</button>
          <button class="btn" data-act="controls">Controls</button>
        </div>
      </div>
      <div class="title-foot">Best with headphones · keyboard &amp; mouse<br>All visuals and sounds are generated procedurally</div>`,
      'title',
      ''
    );
    this.bindButtons(el, {
      continue: () => G.continueGame(),
      new: () => this.newGame(hasSave),
      how: () => this.howToPlay(() => this.title(hasSave, saveInfo)),
      settings: () => this.settings(() => this.title(hasSave, saveInfo)),
      controls: () => this.controls(() => this.title(hasSave, saveInfo)),
    });
  }

  newGame(hasSave) {
    const G = this.G;
    const s = G.settings;
    let diff = s.get('difficulty');
    const render = () => {
      const el = this.show(
        `<div class="panel">
          <h2>New game</h2>
          <p class="sub">Five night shifts. Choose how hard the nights should be — you can change this later in Settings.</p>
          <div class="offers">${Object.entries(DIFFICULTIES)
            .map(([k, d]) => `<button class="offer ${diff === k ? 'on' : ''}" data-act="diff" data-k="${k}"><b>${d.label}</b><small>${d.desc}</small></button>`)
            .join('')}</div>
          <div class="opt"><label>Reduce jumpscares<span class="hint">Replaces sudden faces and loud stingers with gentler cues.</span></label><button class="toggle ${s.get('jumpscareReduction') ? 'on' : ''}" data-act="js"></button></div>
          <div class="opt"><label>Tutorial hints<span class="hint">Short tips during the first night.</span></label><button class="toggle ${s.get('hints') ? 'on' : ''}" data-act="hints"></button></div>
          ${hasSave ? '<p class="sub" style="color:#f6b8a0;margin-top:14px">Starting a new game replaces your current save.</p>' : ''}
          <div class="spread" style="margin-top:18px"><button class="btn ghost" data-act="back">Back</button><button class="btn primary" data-act="start">Clock in</button></div>
        </div>`,
        'newgame'
      );
      this.bindButtons(el, {
        diff: (b) => {
          diff = b.dataset.k;
          render();
        },
        js: () => {
          s.set('jumpscareReduction', !s.get('jumpscareReduction'));
          render();
        },
        hints: () => {
          s.set('hints', !s.get('hints'));
          render();
        },
        back: () => G.toTitle(),
        start: () => {
          s.set('difficulty', diff);
          G.startNewGame(diff);
        },
      });
    };
    render();
  }

  howToPlay(back) {
    const I = this.G.input;
    const k = (a) => `<kbd>${escapeHtml(I.label(a))}</kbd>`;
    const el = this.show(
      `<div class="panel how">
        <h2>How to play</h2>
        <p class="sub">The Night Ward is about care and suspicion. You are alone. Nothing here is random — every threat follows rules you can learn.</p>
        <h3>1 · Screen visitors at the intake window</h3>
        <p>Stand at the reception desk. Look closely (hold ${k('focus')}). Raise the instant camera with ${k('camera')}, snap with ${k('primary')}, and compare the photo with what you see (${k('photos')}). Use the security monitor on the desk to view the vestibule from other angles. Real animals look the same everywhere. Impostors don't.</p>
        <p>Sick animals look strange too: limping, swelling, shivering, wounds, exhaustion. That's illness. Extra or missing parts, movements that repeat <i>exactly</i>, and differences between views are not.</p>
        <p>Press the <b style="color:#4fa892">green button</b> to admit, or pull the <b style="color:#d23d48">red lever</b> to drop the shutter.</p>
        <h3>2 · Treat your patients</h3>
        <p>Escort admitted animals (${k('interact')} on them) to a free exam room and settle them on the bed. Examine them: run tests, read the record, choose a diagnosis, fetch the listed supplies from the pharmacy and treat. Some need surgery. Patients get worse while they wait — your pager (${k('pager')}) shows everyone.</p>
        <h3>3 · Keep your composure</h3>
        <p>Darkness and the things in this building wear you down. Coffee in the staff office and comforting your patients help. If your composure breaks, you'll flee the clinic.</p>
        <h3>4 · Between shifts</h3>
        <p>Dr. Adair will warn you about what's coming. Spend your earnings on supplies and upgrades.</p>
        <div class="row" style="margin-top:18px"><button class="btn primary" data-act="back">Got it</button></div>
      </div>`,
      'how'
    );
    this.bindButtons(el, { back });
  }

  // ------------------------------------------------------------------
  settings(back, tab = 'graphics') {
    const G = this.G;
    const s = G.settings;
    const v = s.values;
    const pct = (x) => `${Math.round(x * 100)}%`;
    const toggle = (key, label, hint = '') => `<div class="opt"><label>${label}${hint ? `<span class="hint">${hint}</span>` : ''}</label><button class="toggle ${v[key] ? 'on' : ''}" data-act="tog" data-key="${key}" aria-pressed="${!!v[key]}"></button></div>`;
    const range = (key, label, min, max, step, fmt, hint = '') => `<div class="opt"><label>${label}<span class="val" id="val-${key}">${fmt(v[key])}</span>${hint ? `<span class="hint">${hint}</span>` : ''}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${v[key]}" data-range="${key}"></div>`;
    const select = (key, label, opts, hint = '') => `<div class="opt"><label>${label}${hint ? `<span class="hint">${hint}</span>` : ''}</label><select data-select="${key}">${opts.map(([val, l]) => `<option value="${val}" ${String(v[key]) === String(val) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
    const tabs = { graphics: 'Graphics', audio: 'Audio', gameplay: 'Gameplay', access: 'Accessibility' };
    let body = '';
    if (tab === 'graphics') {
      body =
        select('quality', 'Quality preset', [['low', 'Low — integrated graphics, older laptops'], ['medium', 'Medium'], ['high', 'High'], ['custom', 'Custom']], 'Low uses simpler materials, no post-processing and a lower resolution.') +
        range('renderScale', 'Render resolution', 0.4, 1, 0.05, pct) +
        toggle('dynamicResolution', 'Dynamic resolution', 'Lowers the resolution automatically to hold your target frame rate.') +
        select('targetFps', 'Target frame rate', [[30, '30'], [60, '60'], [90, '90'], [120, '120'], [144, '144']]) +
        toggle('pbr', 'Physically based materials', 'Off: cheaper lighting model.') +
        toggle('postFx', 'Post-processing', 'Film grain, vignette, lens effects.') +
        toggle('msaa', 'Anti-aliasing (MSAA)', 'Needs post-processing.') +
        toggle('shadows', 'Flashlight shadows') +
        toggle('glow', 'Light glow') +
        toggle('rain', 'Rain outside') +
        select('cctvRes', 'Security camera resolution', [[256, '256'], [384, '384'], [512, '512']]) +
        range('fov', 'Field of view', 55, 95, 1, (x) => `${x}°`) +
        toggle('showFps', 'Show frame rate');
    } else if (tab === 'audio') {
      body =
        range('masterVolume', 'Master volume', 0, 1, 0.05, pct) +
        range('sfxVolume', 'Effects volume', 0, 1, 0.05, pct) +
        range('musicVolume', 'Music volume', 0, 1, 0.05, pct) +
        toggle('hrtf', '3D audio (HRTF)', 'Binaural positioning — best with headphones.');
    } else if (tab === 'gameplay') {
      body =
        select('difficulty', 'Difficulty', Object.entries(DIFFICULTIES).map(([k, d]) => [k, `${d.label} — ${d.desc}`])) +
        range('mouseSensitivity', 'Mouse sensitivity', 0.2, 3, 0.05, (x) => x.toFixed(2)) +
        toggle('invertY', 'Invert vertical look') +
        toggle('hints', 'Tutorial hints');
    } else {
      body =
        toggle('jumpscareReduction', 'Reduce jumpscares', 'No sudden faces or loud stingers.') +
        toggle('flickerReduction', 'Reduce light flicker', 'Gentler flicker for photosensitive players.') +
        range('screenShake', 'Camera shake', 0, 1, 0.05, pct) +
        toggle('headBob', 'Head bob') +
        toggle('captions', 'Sound captions', 'Describe important sounds on screen.');
    }
    const el = this.show(
      `<div class="panel">
        <div class="spread"><h2>Settings</h2><button class="btn small" data-act="reset">Reset all</button></div>
        <div class="tabs">${Object.entries(tabs).map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-act="tab" data-k="${k}">${l}</button>`).join('')}</div>
        ${body}
        <div class="row" style="margin-top:18px"><button class="btn primary" data-act="back">Done</button></div>
      </div>`,
      'settings'
    );
    this.bindButtons(el, {
      tab: (b) => this.settings(back, b.dataset.k),
      back,
      reset: () => {
        s.reset();
        this.settings(back, tab);
      },
      tog: (b) => {
        s.set(b.dataset.key, !s.get(b.dataset.key));
        this.settings(back, tab);
      },
    });
    el.querySelectorAll('[data-range]').forEach((r) => {
      r.addEventListener('input', () => {
        const key = r.dataset.range;
        const val = Number(r.value);
        s.set(key, val);
        const fmt = { renderScale: pct, masterVolume: pct, sfxVolume: pct, musicVolume: pct, screenShake: pct, fov: (x) => `${x}°`, mouseSensitivity: (x) => x.toFixed(2) }[key] || String;
        const out = $('#val-' + key);
        if (out) out.textContent = fmt(val);
      });
    });
    el.querySelectorAll('[data-select]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const key = sel.dataset.select;
        const raw = sel.value;
        if (key === 'quality') {
          if (raw !== 'custom') s.applyPreset(raw);
          else s.set('quality', 'custom');
        } else s.set(key, isNaN(Number(raw)) ? raw : Number(raw));
        this.settings(back, tab);
      });
    });
  }

  controls(back) {
    const G = this.G;
    const I = G.input;
    let listening = null;
    const render = () => {
      let groups = '';
      let last = '';
      for (const a of ACTIONS) {
        if (a.group !== last) {
          groups += `<div class="bind-group">${a.group}</div>`;
          last = a.group;
        }
        const b = I.bindings[a.id];
        const cap = (slot) => {
          const on = listening && listening.id === a.id && listening.slot === slot;
          return `<button class="keycap ${on ? 'listening' : ''}" data-rebind="1" data-act="bind" data-id="${a.id}" data-slot="${slot}">${on ? 'Press a key…' : escapeHtml(keyName(b[slot]))}</button>`;
        };
        groups += `<div class="bind-row"><span>${a.label}</span>${cap(0)}${cap(1)}</div>`;
      }
      const el = this.show(
        `<div class="panel">
          <div class="spread"><h2>Controls</h2><button class="btn small" data-act="reset">Reset to defaults</button></div>
          <p class="sub">Click a binding, then press a key or mouse button. <kbd>Esc</kbd> cancels; binding a key already in use swaps the two. <kbd>Esc</kbd> always pauses and closes panels. Number keys pick camera feeds and exam tools.</p>
          ${groups}
          <div class="row" style="margin-top:18px"><button class="btn primary" data-act="back">Done</button></div>
        </div>`,
        'controls'
      );
      this.bindButtons(el, {
        back: () => {
          I.cancelCapture();
          back();
        },
        reset: () => {
          I.resetBindings();
          render();
        },
        bind: (btn) => {
          listening = { id: btn.dataset.id, slot: Number(btn.dataset.slot) };
          render();
          // capture on the next tick so this click isn't captured
          setTimeout(() => {
            I.startCapture((code) => {
              if (code === null) {
                listening = null;
                render();
                return;
              }
              if (code === undefined) {
                listening = null;
                render();
                return;
              }
              I.bind(listening.id, listening.slot, code);
              listening = null;
              render();
            });
          }, 50);
        },
      });
    };
    render();
  }

  // ------------------------------------------------------------------
  pause() {
    const G = this.G;
    const el = this.show(
      `<div class="panel" style="width:min(420px,100%)">
        <h2>Paused</h2>
        <p class="sub">Night ${G.shift.index + 1} · ${formatClock(G.shift.clockMinutes)}</p>
        <div class="menu" style="gap:4px">
          <button class="btn primary" data-act="resume">Resume</button>
          <button class="btn" data-act="rules">Night rules</button>
          <button class="btn" data-act="settings">Settings</button>
          <button class="btn" data-act="controls">Controls</button>
          <button class="btn" data-act="restart">Restart this night</button>
          <button class="btn" data-act="quit">Save &amp; quit to title</button>
        </div>
      </div>`,
      'pause'
    );
    this.bindButtons(el, {
      resume: () => G.resume(),
      rules: () => this.rulesScreen(() => this.pause()),
      settings: () => this.settings(() => this.pause()),
      controls: () => this.controls(() => this.pause()),
      restart: () => G.retryShift(),
      quit: () => G.quitToTitle(),
    });
  }

  rulesScreen(back) {
    const G = this.G;
    const rules = rulesForShift(G.campaign.shift);
    const el = this.show(
      `<div class="panel paper" style="width:min(620px,100%)">
        <h2>Night rules</h2>
        <p class="sub">Pinned to the corkboard in the staff office. Handwritten.</p>
        ${rules.map((r) => `<div class="rule"><b>${r.title}</b>${r.text}</div>`).join('')}
        <div class="row" style="margin-top:14px"><button class="btn primary" data-act="back">Back</button></div>
      </div>`,
      'rulesScreen'
    );
    this.bindButtons(el, { back });
  }

  // ------------------------------------------------------------------
  briefing(shiftIndex, onDone) {
    const G = this.G;
    const c = G.campaign;
    const prev = c.history[c.history.length - 1];
    let review = '';
    if (prev) {
      const r = new RNG(shiftIndex * 31);
      if (prev.creaturesAdmitted > 0 && prev.creaturesContained < prev.creaturesAdmitted) review = r.pick(REVIEWS.creature);
      else if (prev.wrongRejects > 0) review = r.pick(REVIEWS.wrongReject);
      else if (prev.deaths > 0) review = r.pick(REVIEWS.deaths);
      else if (prev.repDelta >= 8) review = r.pick(REVIEWS.great);
      else review = r.pick(REVIEWS.good);
    }
    const lines = BRIEFINGS[shiftIndex].map((l) => l.replace('{review}', review)).filter(Boolean);
    const newRules = RULES.filter((r) => r.shift === shiftIndex + 1);
    const offers = shiftIndex > 0 ? supplyOffers(new RNG(Date.now() & 0xffff)) : [];
    let i = 0;
    let chosen = shiftIndex > 0 ? null : -1;
    const render = () => {
      const last = i >= lines.length - 1;
      const el = this.show(
        `<div class="panel" style="width:min(820px,100%)">
          <div class="spread" style="margin-bottom:14px"><h2>Before night ${shiftIndex + 1}</h2><span class="sub" style="margin:0">${SHIFTS[shiftIndex].visitors} visitors expected · reputation ${Math.round(c.reputation)}</span></div>
          <div class="doctor">${doctorPortrait()}<div>
            <div class="speech"><div class="who">${DOCTOR.name} · ${DOCTOR.title}</div>${escapeHtml(lines[i])}</div>
            <div class="row"><button class="btn" data-act="prev" ${i === 0 ? 'disabled' : ''}>Back</button>${last ? '' : '<button class="btn primary" data-act="next">Next</button>'}<span class="sub" style="margin:0">${i + 1} / ${lines.length}</span></div>
          </div></div>
          ${last && newRules.length ? `<h3 style="margin:22px 0 4px">New rules tonight</h3>${newRules.map((r) => `<div class="rule new" style="color:var(--ink)"><b>${r.title}</b>${r.text}</div>`).join('')}` : ''}
          ${last && offers.length ? `<h3 style="margin:22px 0 4px">"Take one of these. On the house."</h3><div class="offers">${offers.map((o, k) => `<button class="offer ${chosen === k ? 'on' : ''}" data-act="offer" data-k="${k}"><b>${o.label}</b><small>${offerText(o)}</small></button>`).join('')}</div>` : ''}
          ${last ? `<div class="spread" style="margin-top:20px"><span></span><button class="btn primary" data-act="done" ${chosen === null ? 'disabled' : ''}>${shiftIndex > 0 ? 'Visit the supply room' : 'Clock in'}</button></div>` : ''}
        </div>`,
        'briefing'
      );
      this.bindButtons(el, {
        next: () => {
          i = Math.min(lines.length - 1, i + 1);
          render();
        },
        prev: () => {
          i = Math.max(0, i - 1);
          render();
        },
        offer: (b) => {
          chosen = Number(b.dataset.k);
          render();
        },
        done: () => {
          if (chosen !== null && chosen >= 0) {
            const o = offers[chosen];
            if (o.items) for (const [k, n] of Object.entries(o.items)) c.stock[k] = (c.stock[k] || 0) + n;
            if (o.upgrade) c.upgrades[o.upgrade] = (c.upgrades[o.upgrade] || 0) + 1;
          }
          onDone();
        },
      });
    };
    render();
  }

  shop(onDone) {
    const G = this.G;
    const c = G.campaign;
    const render = () => {
      const ups = UPGRADES.map((u) => {
        const owned = u.consumable ? c.upgrades[u.id] || 0 : !!c.upgrades[u.id];
        const can = upgradeAvailable(c, u);
        const locked = u.requires && !c.upgrades[u.requires];
        return `<div class="shop-item"><b>${u.name}</b><p>${u.desc}</p>
          <div class="spread">${u.consumable ? `<span class="owned">Owned: ${owned}/${u.max}</span>` : owned ? '<span class="owned">Installed</span>' : locked ? '<span class="sub" style="margin:0">Requires previous tier</span>' : '<span></span>'}
          ${can ? `<button class="btn small primary" data-act="up" data-id="${u.id}" ${c.money < u.price ? 'disabled' : ''}>${money(u.price)}</button>` : ''}</div></div>`;
      }).join('');
      const sup = SUPPLY_IDS.map((id) => {
        const s = SUPPLIES[id];
        return `<div class="shop-item" style="flex-direction:row;align-items:center"><span style="width:36px;height:36px;display:block">${supplyIcon(id)}</span><div style="flex:1"><b>${s.name}</b><br><small class="sub">In stock: ${c.stock[id] || 0}</small></div>
          <button class="btn small" data-act="buy" data-id="${id}" ${c.money < s.price ? 'disabled' : ''}>+1 ${money(s.price)}</button></div>`;
      }).join('');
      const el = this.show(
        `<div class="panel" style="width:min(960px,100%)">
          <div class="spread"><div><h2>Supply room</h2><p class="sub" style="margin:0">Spend your earnings before night ${c.shift + 1}.</p></div><div class="money">${money(c.money)}</div></div>
          <h3 style="margin:18px 0 8px">Upgrades &amp; protection</h3><div class="shop-grid">${ups}</div>
          <h3 style="margin:22px 0 8px">Medicine &amp; supplies</h3><div class="shop-grid">${sup}</div>
          <div class="spread" style="margin-top:20px"><span class="sub" style="margin:0">Reputation ${Math.round(c.reputation)} / 100</span><button class="btn primary" data-act="go">Begin night ${c.shift + 1}</button></div>
        </div>`,
        'shop'
      );
      this.bindButtons(el, {
        up: (b) => {
          if (buyUpgrade(c, b.dataset.id)) G.audio.play('cash', { volume: 0.5 });
          render();
        },
        buy: (b) => {
          if (buySupply(c, b.dataset.id)) G.audio.play('item', { volume: 0.5 });
          render();
        },
        go: () => onDone(),
      });
    };
    render();
  }

  summary(sum, onDone) {
    const reason = { dawn: 'The sun is coming up. The day team is arriving.', clockout: 'You clocked out early. Everyone is cared for.' }[sum.reason] || '';
    const rows = sum.visitors
      .map((v) => {
        const signs = v.impostor ? v.signs.map((s) => SIGNS[s] ? SIGNS[s].label : s).join('; ') : CONDITIONS[v.condition].name;
        return `<tr><td><b>${escapeHtml(v.name)}</b><br><small style="color:var(--text2)">${SPECIES[v.species].name}</small></td>
          <td>${v.impostor ? '<span class="tag imp">IMPOSTOR</span>' : '<span class="tag gen">Genuine</span>'}</td>
          <td>${escapeHtml(signs)}</td><td>${escapeHtml(v.decision)}</td><td>${escapeHtml(v.outcome)}</td></tr>`;
      })
      .join('');
    const el = this.show(
      `<div class="panel" style="width:min(980px,100%)">
        <h2>Night ${sum.shift + 1} — shift report</h2>
        <p class="sub">${reason}</p>
        <div class="stats">
          <div class="stat"><b>${sum.treated}</b><span>Patients treated</span></div>
          <div class="stat"><b>${sum.deaths}</b><span>Lost</span></div>
          <div class="stat"><b>${sum.rightRejects}</b><span>Impostors turned away</span></div>
          <div class="stat"><b style="color:${sum.wrongRejects ? '#ff9ca4' : 'inherit'}">${sum.wrongRejects}</b><span>Real patients turned away</span></div>
          <div class="stat"><b style="color:${sum.creaturesAdmitted ? '#ff9ca4' : 'inherit'}">${sum.creaturesAdmitted}</b><span>Impostors let in</span></div>
          <div class="stat"><b>${money(sum.earned + sum.salary)}</b><span>Earned (incl. ${money(sum.salary)} wage)</span></div>
          <div class="stat"><b style="color:${sum.repDelta < 0 ? '#ff9ca4' : '#8fd6c2'}">${sum.repDelta > 0 ? '+' : ''}${Math.round(sum.repDelta)}</b><span>Reputation → ${Math.round(sum.reputation)}</span></div>
        </div>
        <h3 style="margin:18px 0 6px">What came to the window tonight</h3>
        <table class="truth"><tr><th>Visitor</th><th>Truth</th><th>Signs / illness</th><th>Your call</th><th>Outcome</th></tr>${rows}</table>
        <div class="row" style="margin-top:20px;justify-content:flex-end"><button class="btn primary" data-act="ok">Continue</button></div>
      </div>`,
      'summary'
    );
    this.bindButtons(el, { ok: onDone });
  }

  gameOver(kind, onRetry, onQuit) {
    const t = kind === 'fled'
      ? { h: 'You ran.', p: 'Your composure broke. You left the clinic doors open behind you and drove until the sky turned grey. The animals waited all night.' }
      : { h: 'Let go.', p: ENDINGS.fired.text };
    const el = this.show(
      `<div class="panel" style="width:min(560px,100%)"><h2>${t.h}</h2><p class="sub" style="font-size:16px;line-height:1.6">${t.p}</p>
        <div class="row" style="margin-top:18px">${onRetry ? '<button class="btn primary" data-act="retry">Try the night again</button>' : ''}<button class="btn" data-act="quit">Title screen</button></div></div>`,
      'gameover'
    );
    this.bindButtons(el, { retry: onRetry, quit: onQuit });
  }

  ending(key, stats, onDone) {
    const e = ENDINGS[key];
    const el = this.show(
      `<div class="panel" style="width:min(640px,100%)">
        <p class="sub" style="letter-spacing:.2em;text-transform:uppercase;font-size:12px;margin:0 0 6px">Ending</p>
        <h2>${e.title}</h2>
        <p style="font-size:17px;line-height:1.65;color:var(--text)">${escapeHtml(e.text)}</p>
        <div class="stats">
          <div class="stat"><b>${stats.treated}</b><span>Animals helped</span></div>
          <div class="stat"><b>${stats.deaths}</b><span>Lost</span></div>
          <div class="stat"><b>${stats.right}</b><span>Impostors stopped</span></div>
          <div class="stat"><b>${stats.letIn}</b><span>Impostors let in</span></div>
        </div>
        <div class="row" style="margin-top:12px"><button class="btn primary" data-act="ok">Title screen</button></div>
      </div>`,
      'ending'
    );
    this.bindButtons(el, { ok: onDone });
  }

  // ------------------------------------------------------------------
  // HUD
  buildHUD() {
    this.hud.innerHTML = `
      <div id="vignette-lowfx" class="hidden"></div>
      <div id="stare"></div><div id="damage"></div>
      <div id="viewfinder" class="hidden"></div>
      <div id="crosshair"></div>
      <svg id="hold" class="hidden" viewBox="0 0 54 54"><circle cx="27" cy="27" r="22" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="4"/><circle id="holdArc" cx="27" cy="27" r="22" fill="none" stroke="#8fd6c2" stroke-width="4" stroke-linecap="round" transform="rotate(-90 27 27)" stroke-dasharray="138.2" stroke-dashoffset="138.2"/></svg>
      <div id="prompt" class="hidden"></div>
      <div id="topleft">
        <div class="clock" id="clock">22:00<small id="shiftlbl">Night 1</small></div>
        <div><div class="meter-label">Composure</div><div class="meter"><i id="composure" style="width:100%"></i></div></div>
      </div>
      <div id="hint" class="hidden"></div>
      <div id="notes"></div>
      <div id="captions"></div>
      <div id="tray"></div>
      <div id="photo" class="hidden"><canvas width="512" height="512"></canvas><div class="cap" id="photocap"></div></div>
      <div id="fps" class="hidden"></div>`;
    this.el = {
      crosshair: $('#crosshair'),
      prompt: $('#prompt'),
      hold: $('#hold'),
      holdArc: $('#holdArc'),
      clock: $('#clock'),
      shiftlbl: $('#shiftlbl'),
      composure: $('#composure'),
      hint: $('#hint'),
      notes: $('#notes'),
      captions: $('#captions'),
      tray: $('#tray'),
      photo: $('#photo'),
      photoCanvas: $('#photo canvas'),
      photocap: $('#photocap'),
      fps: $('#fps'),
      stare: $('#stare'),
      damage: $('#damage'),
      viewfinder: $('#viewfinder'),
      lowfx: $('#vignette-lowfx'),
    };
    this.lastTray = '';
  }

  showHUD(on) {
    this.hud.classList.toggle('hidden', !on);
  }

  prompt(text) {
    const p = this.el.prompt;
    if (text) {
      if (p.textContent !== text) p.textContent = text;
      p.classList.remove('hidden');
      this.el.crosshair.classList.add('active');
    } else {
      p.classList.add('hidden');
      this.el.crosshair.classList.remove('active');
    }
  }

  holdProgress(k) {
    if (k > 0) {
      this.el.hold.classList.remove('hidden');
      this.el.holdArc.setAttribute('stroke-dashoffset', String(138.2 * (1 - clamp(k, 0, 1))));
    } else this.el.hold.classList.add('hidden');
  }

  updateHUD(state) {
    const e = this.el;
    const clockText = formatClock(state.clock);
    if (e.clock.firstChild.textContent !== clockText) e.clock.firstChild.textContent = clockText;
    const sl = `Night ${state.shift + 1}`;
    if (e.shiftlbl.textContent !== sl) e.shiftlbl.textContent = sl;
    const comp = clamp(state.composure, 0, 100);
    e.composure.style.width = `${comp}%`;
    e.composure.style.background = comp < 25 ? '#d23d48' : comp < 50 ? '#f3d98b' : '#8fd6c2';
    e.stare.style.opacity = String(clamp(state.stare, 0, 1) * 0.9);
    e.damage.style.opacity = String(clamp(state.damage, 0, 1));
    e.lowfx.classList.toggle('hidden', !!state.postFx);
    // tray
    const key = state.tray.join(',') + '|' + state.poles;
    if (key !== this.lastTray) {
      this.lastTray = key;
      e.tray.innerHTML =
        (state.poles ? `<div class="slot" title="Catch pole ×${state.poles}">${supplyIcon('pole')}</div>` : '') +
        (state.tray.length ? `<span class="tray-label">Carrying</span>` : '') +
        state.tray.map((id) => `<div class="slot" title="${SUPPLIES[id].name}">${supplyIcon(id)}</div>`).join('');
    }
    if (state.showFps) {
      e.fps.classList.remove('hidden');
      e.fps.textContent = `${Math.round(state.fps)} fps · ${Math.round(state.scale * 100)}%`;
    } else e.fps.classList.add('hidden');
    e.viewfinder.classList.toggle('hidden', !state.cameraRaised);
  }

  notify(text, kind = '', sub = '') {
    const n = document.createElement('div');
    n.className = `note ${kind}`;
    n.innerHTML = `${escapeHtml(text)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}`;
    this.el.notes.prepend(n);
    while (this.el.notes.children.length > 5) this.el.notes.lastChild.remove();
    this.G.later(7, () => n.remove(), true);
  }

  hint(text) {
    if (!text) {
      this.el.hint.classList.add('hidden');
      return;
    }
    const I = this.G.input;
    const html = escapeHtml(text).replace(/\[(\w+)\]/g, (_, a) => `<kbd>${escapeHtml(I.label(a))}</kbd>`);
    this.el.hint.innerHTML = html;
    this.el.hint.classList.remove('hidden');
  }

  caption(text) {
    if (!this.G.settings.get('captions')) return;
    const c = document.createElement('div');
    c.className = 'caption';
    c.textContent = text;
    this.el.captions.append(c);
    while (this.el.captions.children.length > 3) this.el.captions.firstChild.remove();
    this.G.later(3.5, () => c.remove(), true);
  }

  setPhoto(canvas, label) {
    const ctx = this.el.photoCanvas.getContext('2d');
    ctx.drawImage(canvas, 0, 0, 512, 512);
    this.el.photocap.textContent = label;
    this.el.photo.classList.remove('hidden');
    this.el.photo.style.opacity = '0';
    this.photoDevelop = 0;
  }

  // Instant-film developing effect, time based.
  updatePhoto(dt) {
    if (this.photoDevelop === undefined || this.photoDevelop >= 1) return;
    this.photoDevelop = Math.min(1, this.photoDevelop + dt / 1.6);
    const k = this.photoDevelop;
    this.el.photo.style.opacity = '1';
    this.el.photoCanvas.style.filter = `brightness(${0.2 + 0.8 * k}) contrast(${0.6 + 0.4 * k}) sepia(${1 - k})`;
  }

  togglePhotoBig(on) {
    if (this.el.photo.classList.contains('hidden')) return false;
    this.el.photo.classList.toggle('big', on);
    return true;
  }

  // ------------------------------------------------------------------
  jumpscare(kind, reduced) {
    let el = $('#jumpscare');
    if (el) el.remove();
    if (reduced) return;
    el = document.createElement('div');
    el.id = 'jumpscare';
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 400;
    drawScareFace(c.getContext('2d'), kind);
    el.append(c);
    document.body.append(el);
    let t = 0;
    const step = () => {
      t += 1 / 60;
      c.style.transform = `scale(${1 + t * 0.6}) translate(${(Math.random() - 0.5) * 18}px, ${(Math.random() - 0.5) * 18}px)`;
    };
    const start = performance.now();
    const loop = (now) => {
      const k = (now - start) / 1000;
      c.style.transform = `scale(${1 + k * 0.5}) translate(${(Math.random() - 0.5) * 16}px, ${(Math.random() - 0.5) * 16}px)`;
      el.style.opacity = String(k < 0.55 ? 1 : Math.max(0, 1 - (k - 0.55) / 0.35));
      if (k < 0.9) requestAnimationFrame(loop);
      else el.remove();
    };
    requestAnimationFrame(loop);
    void step;
  }

  clickToResume(show, onClick) {
    let el = $('#clickresume');
    if (!show) {
      if (el) el.remove();
      return;
    }
    if (el) return;
    el = document.createElement('div');
    el.id = 'clickresume';
    el.textContent = 'Click to continue';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      el.remove();
      onClick();
    });
    document.body.append(el);
  }
}

function offerText(o) {
  if (o.upgrade) return o.upgrade === 'pole' ? 'One-use restraint for a loose creature.' : 'Banishes every presence around you, once.';
  return Object.entries(o.items).map(([k, n]) => `${n}× ${SUPPLIES[k].name}`).join(', ');
}

// Procedural jumpscare faces (drawn once per scare).
function drawScareFace(ctx, kind) {
  const W = 640;
  const H = 400;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2 + 20);
  if (kind === 'watcher' || kind === 'feed') {
    const g = ctx.createRadialGradient(0, -20, 10, 0, -20, 220);
    g.addColorStop(0, '#9a958c');
    g.addColorStop(0.6, '#3a3834');
    g.addColorStop(1, '#000');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, -20, 120, 190, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * 45, -60, 28, 40, s * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(0, 90, 30, 70, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // a cute animal face, wrong
    ctx.fillStyle = '#c98d5b';
    ctx.beginPath();
    ctx.ellipse(0, 0, 230, 180, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const x = Math.cos(a) * 120;
      const y = Math.sin(a) * 70 - 40;
      ctx.fillStyle = '#0b0807';
      ctx.beginPath();
      ctx.arc(x, y, 26 + (i % 3) * 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x + 8, y - 8, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#5a0f18';
    ctx.beginPath();
    ctx.ellipse(0, 90, 170, 60, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = '#f2ead6';
    for (let i = 0; i < 14; i++) {
      ctx.fillRect(-160 + i * 23, 88, 18, 26);
      ctx.fillRect(-150 + i * 22, 128, 16, 20);
    }
  }
  ctx.restore();
  // noise
  const img = ctx.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 60;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}
