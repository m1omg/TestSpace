// In-game panels (the simulation keeps running while they are open):
// exam room, pharmacy cabinet, breaker panel, CCTV overlay, surgery,
// intake record, rules corkboard, status board and the pager.
import { escapeHtml, formatClock, clamp, money, RNG } from './core.js';
import { CONDITIONS, CONDITION_IDS, SUPPLIES, SUPPLY_IDS, SPECIES, TEST_INFO } from './data.js';
import { supplyIcon } from './ui.js';
import { rulesForShift } from './shift.js';
import { CIRCUITS } from './lighting.js';

const $ = (sel, root = document) => root.querySelector(sel);
const CARRY_MAX = 6;

const TEMP_WORD = { high: 'High', slightHigh: 'Slightly high', low: 'Low', normal: 'Normal' };
const SCAN_WORD = { clear: 'Clear', fracture: 'Fracture', foreign: 'Foreign object', mass: 'Mass', heart: 'Enlarged heart' };

function heartWord(h) {
  const r = { fast: 'Fast', slow: 'Slow', normal: 'Normal' }[h.rate];
  const y = { regular: '', irregular: ', irregular', murmur: ', murmur' }[h.rhythm];
  return r + y;
}

export class Panels {
  constructor(G) {
    this.G = G;
    this.root = $('#overlays');
    this.open = null;
    this.data = null;
    this.timer = 0;
    this.guide = false;
  }

  isOpen(name) {
    return this.open === name;
  }

  close() {
    if (this.open === 'surgery' && this.surgery && !this.surgery.done) return false;
    if (this.open === 'pager') {
      this.root.querySelector('#pager')?.remove();
      this.open = null;
      return true;
    }
    if (this.heartSound) {
      this.heartSound = null;
    }
    this.root.innerHTML = '';
    const was = this.open;
    this.open = null;
    this.data = null;
    this.G.onPanelClosed(was);
    return true;
  }

  frame(html, id, title, wide = '') {
    this.root.innerHTML = `<div class="overlay" id="${id}"><div class="ov-card" ${wide}>
      <div class="ov-head"><h3>${title}</h3><button class="ov-close" data-close aria-label="Close">×</button></div>
      ${html}</div></div>`;
    this.root.querySelector('[data-close]').addEventListener('click', () => this.G.closePanel());
    return this.root.firstElementChild;
  }

  click() {
    this.G.audio.play('click', { volume: 0.4 });
  }

  // ------------------------------------------------------------------
  // Exam room
  openExam(p, room) {
    this.open = 'exam';
    this.data = { p, room, msg: '', msgKind: '', confirmReport: false };
    this.renderExam();
  }

  renderExam() {
    const G = this.G;
    const { p, room } = this.data;
    const r = p.rec;
    const sp = SPECIES[p.species];
    const roomName = room === 'surgery' ? 'Surgery' : `Exam room ${room.slice(-1)}`;
    const odd = (f, v) => (r.odd && r.odd.field === f ? `<span class="odd">${escapeHtml(v)}</span>` : escapeHtml(v));
    const tests = ['temp', 'heart', 'scan', 'exam']
      .map((t, i) => {
        const st = p.tests[t];
        let res = '';
        if (st && st.done) {
          const x = st.result;
          if (x.impossible) res = `<div class="res impossible">${escapeHtml(x.text)}</div>`;
          else if (t === 'temp') res = `<div class="res">${x.text} ${x.flag !== 'normal' ? `<span class="flag">${x.flag}</span>` : '<span style="color:#2d8a62">normal</span>'}<br><small style="color:#888">Normal for a ${sp.name.toLowerCase()}: ${x.range}</small></div>`;
          else if (t === 'heart') res = `<div class="res">${x.text} ${x.flag !== 'normal' ? `<span class="flag">${x.flag}</span>` : ''}<br><small style="color:#888">Normal: ${x.range}</small> <button class="btn small" data-act="listen">Listen again</button></div>`;
          else res = `<div class="res">${escapeHtml(x.text)}</div>`;
          if (t === 'scan') res += `<canvas class="scanimg" width="320" height="180" id="scanimg"></canvas>`;
        }
        const running = st && st.running;
        const prog = running ? clamp(st.t / st.dur, 0, 1) : st && st.done ? 1 : 0;
        return `<div class="test"><div class="spread"><b>${i + 1}. ${TEST_INFO[t].name}</b>${st && st.done ? '<span style="color:#2d8a62;font-weight:800">Done</span>' : running ? '<span style="color:#888">Running…</span>' : `<button class="btn small primary" data-act="test" data-t="${t}">Run <kbd>${i + 1}</kbd></button>`}</div>
          ${running ? `<div class="bar"><i id="bar-${t}" style="width:${prog * 100}%"></i></div>` : ''}${res}</div>`;
      })
      .join('');
    const diagList = CONDITION_IDS.map((id) => {
      const c = CONDITIONS[id];
      return `<button class="diag ${p.diagnosis === id ? 'on' : ''}" data-act="diag" data-id="${id}">${c.name}${this.guide ? `<small>Temp ${TEMP_WORD[c.temp]} · Heart ${heartWord(c.heart)} · Scan ${SCAN_WORD[c.scan]}${c.surgery ? ' · SURGERY' : ''}</small>` : ''}</button>`;
    }).join('');
    let protocol = '';
    if (p.diagnosis) {
      const c = CONDITIONS[p.diagnosis];
      const tray = G.inventory;
      const items = c.treatment.map((id) => `${tray.includes(id) ? '✓' : '○'} ${SUPPLIES[id].name}`).join('<br>');
      protocol = `<div class="protocol"><b>Protocol: ${c.name}</b><br>${c.surgery ? 'Surgery on the surgery table, using:<br>' : ''}${items}</div>`;
      if (c.surgery && room !== 'surgery') protocol += `<p class="msg">Escort ${escapeHtml(p.name)} to the surgery table (across the corridor from Exam 2).</p>`;
    }
    const canTreat = !!p.diagnosis && p.state === 'inRoom';
    const isSurg = p.diagnosis && CONDITIONS[p.diagnosis].surgery;
    const hcol = p.health < 25 ? '#d23d48' : p.health < 50 ? '#e0a33a' : '#3aa776';
    this.root.innerHTML = `<div class="overlay" id="exam" style="justify-content:space-between;align-items:stretch">
      <div class="ov-card" style="width:min(330px,40vw);align-self:center">
        <div class="ov-head"><h3>${roomName}</h3><button class="ov-close" data-close aria-label="Close">×</button></div>
        <div class="col">
          <dl class="record">
            <dt>Patient</dt><dd><b>${escapeHtml(p.name)}</b> — ${escapeHtml(r.breed)} (${sp.name})</dd>
            <dt>Age / sex</dt><dd>${odd('age', r.age)} · ${r.sex}</dd>
            <dt>Owner</dt><dd>${odd('owner', r.owner)} · ${odd('phone', r.phone)}</dd>
            <dt>Reason for visit</dt><dd>${odd('complaint', r.complaint)}</dd>
          </dl>
          <div class="vitals"><b>Condition</b><div class="healthbar"><i style="width:${p.health}%;background:${hcol}"></i></div><b id="exam-health">${Math.round(p.health)}%</b></div>
          <p class="sub" style="font-size:13px;margin:4px 0 12px">${p.state === 'recovering' ? 'Recovering — will be discharged soon.' : p.critical ? '<b style="color:#d23d48">Critical — act now.</b>' : 'Gets worse while untreated.'}</p>
          <div class="row">
            <button class="btn small" data-act="comfort" ${p.comfortCooldown > 0 ? 'disabled' : ''}>Comfort ${escapeHtml(p.name)}</button>
            ${this.data.confirmReport ? '<button class="btn small danger" data-act="report2">Confirm: seal the room</button><button class="btn small" data-act="cancelreport">Cancel</button>' : '<button class="btn small" data-act="report" style="color:#a3232c">Report anomaly…</button>'}
          </div>
          ${this.data.confirmReport ? '<p class="msg bad">Only if the readings are impossible. Sealing a real patient counts as turning them away.</p>' : ''}
        </div>
      </div>
      <div class="ov-card" style="width:min(380px,46vw);align-self:center">
        <div class="ov-head"><h3>Diagnostics</h3><span class="sub" style="margin:0;font-size:12px">Instruments need power</span></div>
        <div class="col">
          ${tests}
          <div class="spread" style="margin-top:12px"><b>Diagnosis</b><button class="btn small" data-act="guide">${this.guide ? 'Hide' : 'Show'} clinical guide</button></div>
          <div class="diag-list">${diagList}</div>
          ${protocol}
          <div class="msg ${this.data.msgKind}">${escapeHtml(this.data.msg)}</div>
          <div class="row">${canTreat ? (isSurg && room === 'surgery' ? '<button class="btn primary" data-act="surgery">Begin surgery</button>' : isSurg ? `<button class="btn primary" data-act="escort">Take ${escapeHtml(p.name)} to surgery</button>` : '<button class="btn primary" data-act="treat">Administer treatment</button>') : ''}
            ${p.state === 'inRoom' && !(isSurg && room !== 'surgery') ? `<button class="btn" data-act="escort">Move ${escapeHtml(p.name)}</button>` : ''}</div>
        </div>
        <div class="ov-foot">Close with <kbd>Esc</kbd> or <kbd>${escapeHtml(G.input.label('back_out'))}</kbd>. Tests keep running if you leave.</div>
      </div>
    </div>`;
    const root = this.root.firstElementChild;
    root.querySelector('[data-close]').addEventListener('click', () => G.closePanel());
    root.querySelectorAll('[data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        this.click();
        this.examAction(b.dataset.act, b.dataset);
      })
    );
    const scan = $('#scanimg');
    if (scan && p.tests.scan && p.tests.scan.done) drawScan(scan, p, G.campaign.upgrades.diag2);
    this.lastExamKey = this.examKey();
  }

  examKey() {
    const p = this.data.p;
    return JSON.stringify([Object.values(p.tests).map((t) => (t ? `${t.running}${t.done}` : '-')), p.diagnosis, p.state, p.comfortCooldown > 0, p.critical, this.G.inventory.join(), this.data.msg, this.data.confirmReport, this.guide]);
  }

  examAction(act, ds) {
    const G = this.G;
    const { p } = this.data;
    const M = G.patients;
    if (act === 'test') M.startTest(p, ds.t);
    else if (act === 'listen') G.playHeartbeat(p);
    else if (act === 'diag') {
      p.diagnosis = ds.id;
      this.data.msg = '';
    } else if (act === 'guide') this.guide = !this.guide;
    else if (act === 'comfort') G.comfort(p);
    else if (act === 'report') this.data.confirmReport = true;
    else if (act === 'cancelreport') this.data.confirmReport = false;
    else if (act === 'report2') {
      G.reportAnomaly(p, this.data.room);
      return;
    } else if (act === 'treat') {
      const r = G.treat(p);
      this.data.msg = r.message || '';
      this.data.msgKind = r.ok ? 'good' : 'bad';
      if (r.closed) return;
    } else if (act === 'surgery') {
      G.beginSurgery(p);
      return;
    } else if (act === 'escort') {
      G.closePanel();
      M.startEscort(p);
      G.ui.notify(`${p.name} follows you`, '', 'Settle them on a free bed or the surgery table.');
      return;
    }
    if (this.open === 'exam') this.renderExam();
  }

  examDigit(n) {
    const t = ['temp', 'heart', 'scan', 'exam'][n - 1];
    if (t) {
      this.G.patients.startTest(this.data.p, t);
      this.renderExam();
    }
  }

  // ------------------------------------------------------------------
  // Pharmacy
  openPharmacy() {
    this.open = 'pharmacy';
    this.renderPharmacy();
  }

  renderPharmacy() {
    const G = this.G;
    const c = G.campaign;
    const inv = G.inventory;
    const items = SUPPLY_IDS.map((id) => {
      const s = SUPPLIES[id];
      const n = c.stock[id] || 0;
      return `<button class="item" data-act="take" data-id="${id}" ${n <= 0 || inv.length >= CARRY_MAX ? 'disabled' : ''}>${supplyIcon(id)}<span><b>${s.name}</b><small>${n} in stock</small></span></button>`;
    }).join('');
    const slots = [];
    for (let i = 0; i < CARRY_MAX; i++) {
      const id = inv[i];
      slots.push(id ? `<div class="slot" data-act="ret" data-i="${i}" title="Put back ${SUPPLIES[id].name}">${supplyIcon(id)}</div>` : '<div class="slot empty"></div>');
    }
    // what the patients currently need
    const needs = G.patients.patients
      .filter((p) => p.diagnosis && ['inRoom', 'following', 'waiting'].includes(p.state))
      .map((p) => `<b>${escapeHtml(p.name)}</b>: ${CONDITIONS[p.diagnosis].treatment.map((i) => SUPPLIES[i].name).join(', ')}`);
    const root = this.frame(
      `<div class="shelf">${items}</div>
       <div class="carry"><b style="margin-right:6px">Carrying (${inv.length}/${CARRY_MAX})</b>${slots.join('')}<span class="sub" style="margin:0;font-size:12px">click to put back</span></div>
       ${needs.length ? `<div class="ov-foot" style="font-size:13.5px;color:var(--ink)">Diagnosed patients need — ${needs.join(' · ')}</div>` : '<div class="ov-foot">Diagnose a patient first; the protocol lists what to bring.</div>'}`,
      'pharmacy',
      'Pharmacy cabinet'
    );
    root.querySelectorAll('[data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        if (b.dataset.act === 'take') {
          const id = b.dataset.id;
          if ((c.stock[id] || 0) > 0 && inv.length < CARRY_MAX) {
            c.stock[id]--;
            inv.push(id);
            G.audio.play('item', { volume: 0.5 });
          }
        } else if (b.dataset.act === 'ret') {
          const i = Number(b.dataset.i);
          const id = inv[i];
          if (id) {
            inv.splice(i, 1);
            c.stock[id] = (c.stock[id] || 0) + 1;
            this.click();
          }
        }
        this.renderPharmacy();
      })
    );
  }

  // ------------------------------------------------------------------
  // Breakers
  openBreaker() {
    this.open = 'breaker';
    this.renderBreaker();
  }

  renderBreaker() {
    const G = this.G;
    const L = G.lighting;
    const list = L.state.filter((s) => s.id !== 'exterior');
    const allOk = list.every((s) => s.powered);
    const root = this.frame(
      `<div class="breakers">${list
        .map((s) => `<button class="brk ${s.powered ? '' : 'off'}" data-act="reset" data-i="${s.index}"><span class="sw"></span><span><b>${s.label}</b><small>${s.powered ? 'On' : 'TRIPPED — click to reset'}</small></span></button>`)
        .join('')}</div>
       <div class="ov-foot" style="color:#aab">${allOk ? 'All circuits are on.' : 'Reset every tripped switch. Number keys work too.'}${G.campaign.upgrades.generator ? ' Backup generator: emergency lighting active during faults.' : ''}</div>`,
      'breaker',
      'Breaker panel'
    );
    root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => this.resetBreaker(Number(b.dataset.i))));
    this.lastBreakerKey = this.breakerKey();
  }

  breakerKey() {
    return this.G.lighting.state.map((s) => (s.powered ? 1 : 0)).join('');
  }

  resetBreaker(i) {
    const G = this.G;
    if (G.lighting.reset(i)) {
      G.audio.play('breaker', { volume: 0.9 });
      G.audio.play('powerUp', { volume: 0.5, delay: 0.15 });
      G.onBreakerReset(i);
    } else G.audio.play('click', { volume: 0.3 });
    this.renderBreaker();
  }

  breakerDigit(n) {
    const s = this.G.lighting.state[n - 1];
    if (s && s.id !== 'exterior') this.resetBreaker(n - 1);
  }

  // ------------------------------------------------------------------
  // CCTV overlay (the image itself is rendered by the WebGL canvas)
  openCCTV() {
    this.open = 'cctv';
    this.renderCCTV();
  }

  renderCCTV() {
    const G = this.G;
    const cams = G.availableCams();
    const cur = G.cctvCam;
    const dead = G.incidents.deadCams;
    const powered = G.lighting.isPowered('reception');
    this.root.innerHTML = `<div class="overlay" id="cctv"><div class="cctv-ui">
      <div class="cctv-top"><span class="rec">●</span> ${escapeHtml(cur.id)}<br><span style="font-size:22px">${escapeHtml(cur.label)}</span></div>
      <div class="cctv-time"><span id="cctv-clock">${formatClock(G.shift.clockMinutes)}</span><br><span style="font-size:20px">NIGHT ${G.shift.index + 1}</span></div>
      ${!powered ? '<div class="cctv-nosignal">NO SIGNAL — POWER</div>' : dead.has(cur.id) ? '<div class="cctv-nosignal">CAMERA OFFLINE</div>' : ''}
      <div class="cctv-cams">${cams.map((c, i) => `<button class="cam-btn ${c.id === cur.id ? 'on' : ''} ${dead.has(c.id) ? 'dead' : ''}" data-i="${i}">${i + 1} ${escapeHtml(c.id)}</button>`).join('')}</div>
      <div class="cctv-help">${escapeHtml(G.input.label('left'))}/${escapeHtml(G.input.label('right'))} switch · 1–${cams.length} pick · Esc / ${escapeHtml(G.input.label('back_out'))} leave</div>
    </div></div>`;
    this.root.querySelectorAll('.cam-btn').forEach((b) => b.addEventListener('click', () => G.selectCam(Number(b.dataset.i))));
    this.lastCctvKey = `${cur.id}|${powered}|${[...dead].join()}`;
  }

  // ------------------------------------------------------------------
  // Intake record (printer at the desk)
  openRecord(p) {
    this.open = 'record';
    const r = p.rec;
    const sp = SPECIES[p.species];
    const odd = (f, v) => (r.odd && r.odd.field === f ? `<span class="odd">${escapeHtml(v)}</span>` : escapeHtml(v));
    this.frame(
      `<div class="col"><dl class="record">
        <dt>Intake form #${String(r.id).padStart(4, '0')}</dt><dd>Printed ${formatClock(this.G.shift.clockMinutes)}</dd>
        <dt>Patient</dt><dd><b>${escapeHtml(p.name)}</b></dd>
        <dt>Species / breed</dt><dd>${sp.name} — ${escapeHtml(r.breed)}</dd>
        <dt>Age / sex</dt><dd>${odd('age', r.age)} · ${r.sex}</dd>
        <dt>Owner</dt><dd>${odd('owner', r.owner)}</dd>
        <dt>Phone</dt><dd>${odd('phone', r.phone)}</dd>
        <dt>Reason for visit</dt><dd>${odd('complaint', r.complaint)}</dd>
      </dl>
      <p class="sub" style="margin-top:12px;font-size:13px">The owner filled this in online. Nobody waits with the animals at night.</p></div>`,
      'record',
      'Intake record'
    );
  }

  openRules() {
    this.open = 'rules';
    const rules = rulesForShift(this.G.campaign.shift);
    this.frame(`<div class="col">${rules.map((r) => `<div class="rule"><b>${r.title}</b>${r.text}</div>`).join('')}</div>`, 'rules', 'Night rules');
  }

  openBoard() {
    this.open = 'board';
    this.renderBoard();
  }

  renderBoard() {
    const G = this.G;
    const rows = G.patients.board();
    const html = rows.length
      ? `<table class="board-table"><tr><th>Patient</th><th>Where</th><th>Status</th><th>Condition</th></tr>${rows
          .map((r) => `<tr class="${r.critical ? 'crit' : ''}"><td><b>${escapeHtml(r.name)}</b> <small style="color:#888">${SPECIES[r.species].name}</small></td><td>${r.where}</td><td>${escapeHtml(r.status)}</td><td style="width:140px"><div class="healthbar"><i style="width:${r.health}%;background:${r.health < 25 ? '#d23d48' : r.health < 50 ? '#e0a33a' : '#3aa776'}"></i></div></td></tr>`)
          .join('')}</table>`
      : '<p class="sub">No patients yet.</p>';
    this.frame(`<div class="col">${html}<p class="sub" style="font-size:12.5px;margin-top:10px">Visitors expected tonight: ${G.shift.records.length} · arrived: ${G.shift.spawned}</p></div>`, 'board', 'Patient status board');
    this.lastBoardKey = JSON.stringify(rows.map((r) => [r.name, r.where, r.status, Math.round(r.health / 5)]));
  }

  // ------------------------------------------------------------------
  // Pager: non-blocking side panel
  togglePager() {
    if (this.open === 'pager') {
      this.close();
      return;
    }
    if (this.open) return;
    this.open = 'pager';
    const el = document.createElement('div');
    el.id = 'pager';
    this.root.append(el);
    this.renderPager();
  }

  renderPager() {
    const G = this.G;
    const el = $('#pager');
    if (!el) return;
    const rows = G.patients.board();
    const obj = G.objective();
    el.innerHTML = `<div class="spread"><b style="font-family:var(--mono);font-size:24px">${formatClock(G.shift.clockMinutes)}</b><span style="color:var(--butter);font-family:var(--mono);font-size:20px">${money(G.campaign.money)}</span></div>
      <h4>Now</h4><div>${escapeHtml(obj)}</div>
      <h4>Patients</h4>${rows.length ? rows.map((r) => `<div class="pg-pt"><div><b>${escapeHtml(r.name)}</b> <small style="display:inline">${SPECIES[r.species].name}</small><small>${r.where} · ${escapeHtml(r.status)}</small></div><div><div class="healthbar"><i style="width:${r.health}%;background:${r.health < 25 ? '#d23d48' : r.health < 50 ? '#e0a33a' : '#3aa776'}"></i></div><small style="text-align:right">${Math.round(r.health)}%</small></div></div>`).join('') : '<div style="color:var(--text2)">No patients yet.</div>'}
      <h4>Supplies carried</h4><div style="color:var(--text2)">${G.inventory.length ? G.inventory.map((i) => SUPPLIES[i].name).join(', ') : 'Nothing'} · catch poles: ${G.campaign.upgrades.pole || 0} · flares: ${G.campaign.upgrades.flare || 0}</div>
      <h4>Rules</h4><div style="color:var(--text2)">${rulesForShift(G.campaign.shift).map((r) => r.title).join(' · ')}</div>
      <div style="color:var(--text2);margin-top:10px;font-size:12px">Reputation ${Math.round(G.campaign.reputation)} · ${escapeHtml(G.input.label('pager'))} to close</div>`;
  }

  // ------------------------------------------------------------------
  // Surgery minigame (all timing uses real elapsed time)
  openSurgery(p, onFinish) {
    this.open = 'surgery';
    const s = {
      p,
      onFinish,
      step: 0,
      mistakes: 0,
      done: false,
      gauge: 0,
      holding: false,
      path: [],
      progress: 0,
      dev: 0,
      obj: { x: 360, y: 210 },
      dragging: false,
      sutures: [],
      sutureIdx: 0,
      ringT: 0,
      msg: 'Hold the mouse button to administer anesthetic. Release in the green band.',
      lastT: performance.now(),
      flash: 0,
      revealed: false,
    };
    this.surgery = s;
    const steps = ['Anesthesia', 'Incision', 'Removal', 'Sutures'];
    this.root.innerHTML = `<div class="overlay" id="surgery"><div class="ov-card">
      <div class="ov-head"><h3>Surgery — ${escapeHtml(p.name)}</h3><span class="sub" style="margin:0" id="sg-health"></span></div>
      <div class="col"><div class="steps">${steps.map((n, i) => `<span id="sg-step${i}">${i + 1}. ${n}</span>`).join('')}</div>
      <canvas id="sg" width="720" height="400"></canvas><p class="msg" id="sg-msg"></p></div></div></div>`;
    const cv = $('#sg');
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height };
    };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      this.surgeryDown(pos(e));
    });
    cv.addEventListener('pointermove', (e) => this.surgeryMove(pos(e)));
    cv.addEventListener('pointerup', (e) => this.surgeryUp(pos(e)));
    // incision path (a gentle curve)
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      s.path.push({ x: 180 + t * 360, y: 210 + Math.sin(t * Math.PI) * -30 });
    }
    for (let i = 0; i < 6; i++) {
      const t = (i + 0.5) / 6;
      s.sutures.push({ x: 180 + t * 360, y: 210 + Math.sin(t * Math.PI) * -30, ok: null });
    }
    this.surgeryLoop();
  }

  surgeryLoop() {
    const s = this.surgery;
    if (!s || this.open !== 'surgery') return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - s.lastT) / 1000);
    s.lastT = now;
    this.surgeryTick(dt);
    this.drawSurgery();
    if (!s.done) requestAnimationFrame(() => this.surgeryLoop());
  }

  surgeryTick(dt) {
    const s = this.surgery;
    s.flash = Math.max(0, s.flash - dt * 2);
    if (s.step === 0 && s.holding) {
      s.gauge = Math.min(1.05, s.gauge + dt * 0.42);
      if (s.gauge >= 1.05) this.surgeryUp();
    }
    if (s.step === 3) {
      s.ringT += dt;
      if (s.ringT > 1.6) {
        // missed this suture
        this.sutureResult(false);
      }
    }
    for (let i = 0; i < 4; i++) {
      const el = $('#sg-step' + i);
      if (el) el.className = i < s.step ? 'done' : i === s.step ? 'on' : '';
    }
    const m = $('#sg-msg');
    if (m) m.textContent = s.msg;
    const h = $('#sg-health');
    if (h) h.textContent = `Condition ${Math.round(s.p.health)}%`;
  }

  mistake(amount, text) {
    const s = this.surgery;
    s.mistakes++;
    s.flash = 1;
    s.p.health = Math.max(1, s.p.health - amount);
    s.msg = text;
    this.G.audio.play('beep', { volume: 0.5, rate: 0.7 });
  }

  surgeryDown(pt) {
    const s = this.surgery;
    if (!s || s.done) return;
    if (s.step === 0) {
      s.holding = true;
    } else if (s.step === 1) {
      const a = s.path[0];
      if (Math.hypot(pt.x - a.x, pt.y - a.y) < 26) {
        s.cutting = true;
        s.progress = 0;
        s.msg = 'Steady… follow the line to the end.';
      } else s.msg = 'Start the incision at the white dot.';
    } else if (s.step === 2) {
      if (Math.hypot(pt.x - s.obj.x, pt.y - s.obj.y) < 34) {
        s.dragging = true;
        s.lastDrag = { ...pt, t: performance.now() };
      }
    } else if (s.step === 3) {
      const target = s.sutures[s.sutureIdx];
      if (target && Math.hypot(pt.x - target.x, pt.y - target.y) < 30) {
        const r = this.ringRadius();
        this.sutureResult(Math.abs(r - 14) < 9);
      }
    }
  }

  ringRadius() {
    const s = this.surgery;
    return Math.max(0, 60 - s.ringT * 40);
  }

  sutureResult(ok) {
    const s = this.surgery;
    const t = s.sutures[s.sutureIdx];
    if (!t) return;
    t.ok = ok;
    if (!ok) this.mistake(2, 'A loose stitch. Keep going.');
    else {
      s.msg = 'Good stitch.';
      this.G.audio.play('click', { volume: 0.4 });
    }
    s.sutureIdx++;
    s.ringT = 0;
    if (s.sutureIdx >= s.sutures.length) this.finishSurgery(true);
  }

  surgeryMove(pt) {
    const s = this.surgery;
    if (!s || s.done) return;
    if (s.step === 1 && s.cutting) {
      // distance to path and progress along it
      let best = Infinity;
      let bi = 0;
      s.path.forEach((p, i) => {
        const d = Math.hypot(pt.x - p.x, pt.y - p.y);
        if (d < best) {
          best = d;
          bi = i;
        }
      });
      if (best > 22) {
        s.cutting = false;
        this.mistake(4, 'You slipped. Start again from the white dot.');
        return;
      }
      if (bi > s.progress && bi <= s.progress + 6) s.progress = bi;
      s.cursor = pt;
      if (s.progress >= s.path.length - 2) {
        s.cutting = false;
        s.step = 2;
        if (s.p.impostor) {
          this.revealDuringSurgery();
          return;
        }
        s.msg = 'Drag the object out to the tray at the top right. Slowly.';
      }
    } else if (s.step === 2 && s.dragging) {
      const now = performance.now();
      const dtm = Math.max(1, now - s.lastDrag.t) / 1000;
      const speed = Math.hypot(pt.x - s.lastDrag.x, pt.y - s.lastDrag.y) / dtm;
      s.lastDrag = { ...pt, t: now };
      if (speed > 1500 && !s.roughCooldown) {
        this.mistake(3, 'Too rough! Slow down.');
        s.roughCooldown = true;
        setTimeout(() => (s.roughCooldown = false), 600);
      }
      s.obj.x = pt.x;
      s.obj.y = pt.y;
      if (pt.x > 590 && pt.y < 110) {
        s.dragging = false;
        s.step = 3;
        s.ringT = 0;
        s.msg = 'Click each stitch point as the ring closes onto it.';
        this.G.audio.play('item', { volume: 0.5 });
      }
    }
  }

  surgeryUp() {
    const s = this.surgery;
    if (!s || s.done) return;
    if (s.step === 0 && s.holding) {
      s.holding = false;
      if (s.gauge >= 0.55 && s.gauge <= 0.75) {
        s.step = 1;
        s.msg = 'Anesthetic holding. Make the incision along the dashed line.';
        this.G.audio.play('beep', { volume: 0.4 });
      } else if (s.gauge < 0.55) {
        this.mistake(3, 'Not enough — the patient is stirring. Try again.');
        s.gauge = 0;
      } else {
        this.mistake(10, 'Too much! Vitals dropping. Try again, carefully.');
        s.gauge = 0;
      }
    }
    if (s.step === 1) s.cutting = false;
    if (s.step === 2) s.dragging = false;
  }

  revealDuringSurgery() {
    const s = this.surgery;
    s.revealed = true;
    s.msg = 'The incision opens onto something that is not an animal.';
    s.done = true;
    this.drawSurgery();
    this.G.later(1.2, () => {
      this.surgery = null;
      this.root.innerHTML = '';
      this.open = null;
      s.onFinish({ reveal: true });
    });
  }

  finishSurgery(ok) {
    const s = this.surgery;
    s.done = true;
    s.msg = `Done. ${s.mistakes ? `${s.mistakes} complication${s.mistakes > 1 ? 's' : ''}.` : 'Clean work.'}`;
    this.drawSurgery();
    this.G.later(1.0, () => {
      this.surgery = null;
      this.root.innerHTML = '';
      this.open = null;
      s.onFinish({ ok, quality: clamp(1 - s.mistakes * 0.15, 0.3, 1) });
    });
  }

  drawSurgery() {
    const s = this.surgery;
    const cv = $('#sg');
    if (!cv || !s) return;
    const ctx = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    // drape and skin window
    ctx.fillStyle = '#2f7f86';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#e8b8a4';
    ctx.beginPath();
    ctx.ellipse(W / 2, H / 2 + 10, 250, 120, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 3;
    ctx.stroke();
    // tray
    ctx.fillStyle = '#c9ccd2';
    ctx.fillRect(590, 20, 110, 90);
    ctx.fillStyle = '#555';
    ctx.font = '700 14px Nunito, sans-serif';
    ctx.fillText('TRAY', 625, 70);
    // monitor
    ctx.fillStyle = '#0d1a14';
    ctx.fillRect(16, 16, 150, 70);
    ctx.strokeStyle = '#4fe08a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const t = performance.now() / 1000;
    for (let x = 0; x < 140; x++) {
      const ph = (x / 140 + t * 0.8) % 1;
      const y = ph > 0.45 && ph < 0.5 ? -24 : ph > 0.5 && ph < 0.53 ? 14 : Math.sin(ph * 30) * 1.5;
      if (x === 0) ctx.moveTo(21 + x, 52 + y);
      else ctx.lineTo(21 + x, 52 + y);
    }
    ctx.stroke();
    ctx.fillStyle = '#4fe08a';
    ctx.fillText(`${Math.round(s.p.health)}%`, 120, 34);
    if (s.step === 0) {
      // gauge
      const gx = 330;
      const gy = 80;
      ctx.fillStyle = '#1b1b1e';
      ctx.fillRect(gx, gy, 60, 240);
      ctx.fillStyle = 'rgba(80,220,140,0.45)';
      ctx.fillRect(gx, gy + 240 * (1 - 0.75), 60, 240 * 0.2);
      ctx.fillStyle = '#f0e070';
      ctx.fillRect(gx + 8, gy + 240 * (1 - Math.min(1, s.gauge)), 44, 240 * Math.min(1, s.gauge));
      ctx.fillStyle = '#fff';
      ctx.fillText('ANESTHETIC', gx - 8, gy - 10);
    }
    if (s.step >= 1) {
      // incision line
      ctx.setLineDash(s.step === 1 ? [8, 8] : []);
      ctx.strokeStyle = s.step === 1 ? 'rgba(60,40,40,0.7)' : '#7a1e28';
      ctx.lineWidth = s.step === 1 ? 3 : 8;
      ctx.beginPath();
      s.path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.setLineDash([]);
      if (s.step === 1) {
        ctx.strokeStyle = '#a3232c';
        ctx.lineWidth = 6;
        ctx.beginPath();
        for (let i = 0; i <= s.progress; i++) (i ? ctx.lineTo(s.path[i].x, s.path[i].y) : ctx.moveTo(s.path[i].x, s.path[i].y));
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(s.path[0].x, s.path[0].y, 9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (s.step === 2 || (s.step > 2 && false)) {
      ctx.fillStyle = '#5a1018';
      ctx.beginPath();
      ctx.ellipse(360, 200, 120, 34, 0, 0, Math.PI * 2);
      ctx.fill();
      const isMass = s.p.rec.condition === 'tumor';
      ctx.fillStyle = isMass ? '#d8a0a8' : '#5b8fd6';
      ctx.beginPath();
      if (isMass) ctx.ellipse(s.obj.x, s.obj.y, 26, 20, 0, 0, Math.PI * 2);
      else ctx.rect(s.obj.x - 18, s.obj.y - 12, 36, 24);
      ctx.fill();
    }
    if (s.step === 3) {
      s.sutures.forEach((p, i) => {
        ctx.fillStyle = p.ok === null ? (i === s.sutureIdx ? '#fff' : 'rgba(255,255,255,0.35)') : p.ok ? '#3aa776' : '#e0a33a';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.fill();
        if (p.ok !== null) {
          ctx.strokeStyle = '#222';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(p.x - 8, p.y - 10);
          ctx.lineTo(p.x + 8, p.y + 10);
          ctx.stroke();
        }
      });
      const tgt = s.sutures[s.sutureIdx];
      if (tgt) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(tgt.x, tgt.y, this.ringRadius(), 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(80,220,140,0.6)';
        ctx.beginPath();
        ctx.arc(tgt.x, tgt.y, 14, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (s.revealed) {
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.beginPath();
      ctx.ellipse(360, 200, 140, 60, 0, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = '#f8f0d8';
        ctx.beginPath();
        ctx.arc(300 + i * 30, 195 + Math.sin(i) * 10, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(302 + i * 30, 195 + Math.sin(i) * 10, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (s.flash > 0) {
      ctx.fillStyle = `rgba(200,0,20,${s.flash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ------------------------------------------------------------------
  // periodic refresh while open (called with real dt)
  update(dt) {
    if (!this.open) return;
    this.timer += dt;
    if (this.timer < 0.1) return;
    this.timer = 0;
    if (this.open === 'exam' && this.data) {
      const p = this.data.p;
      if (['gone', 'sealed'].includes(p.state) || p.dead) {
        this.G.closePanel();
        return;
      }
      for (const t of ['temp', 'heart', 'scan', 'exam']) {
        const st = p.tests[t];
        const bar = $('#bar-' + t);
        if (bar && st) bar.style.width = `${clamp(st.t / st.dur, 0, 1) * 100}%`;
      }
      const h = $('#exam-health');
      if (h) h.textContent = `${Math.round(p.health)}%`;
      if (this.examKey() !== this.lastExamKey) this.renderExam();
    } else if (this.open === 'breaker') {
      if (this.breakerKey() !== this.lastBreakerKey) this.renderBreaker();
    } else if (this.open === 'cctv') {
      const c = $('#cctv-clock');
      if (c) c.textContent = formatClock(this.G.shift.clockMinutes);
      const cur = this.G.cctvCam;
      const key = `${cur.id}|${this.G.lighting.isPowered('reception')}|${[...this.G.incidents.deadCams].join()}`;
      if (key !== this.lastCctvKey) this.renderCCTV();
    } else if (this.open === 'board') {
      const key = JSON.stringify(this.G.patients.board().map((r) => [r.name, r.where, r.status, Math.round(r.health / 5)]));
      if (key !== this.lastBoardKey) this.renderBoard();
    } else if (this.open === 'pager') {
      this.pagerTimer = (this.pagerTimer || 0) + 0.1;
      if (this.pagerTimer > 0.5) {
        this.pagerTimer = 0;
        this.renderPager();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// X-ray style scan image.
function drawScan(cv, p, mark) {
  const ctx = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  ctx.fillStyle = '#061322';
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.6);
  g.addColorStop(0, 'rgba(60,110,160,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const res = p.tests.scan.result;
  const bone = 'rgba(220,235,255,0.85)';
  ctx.strokeStyle = bone;
  ctx.fillStyle = bone;
  ctx.lineCap = 'round';
  const bird = p.species === 'parrot';
  const cx = W / 2;
  const cy = H / 2 + 5;
  // body outline
  ctx.strokeStyle = 'rgba(140,180,220,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (bird) ctx.ellipse(cx, cy, 45, 70, 0, 0, Math.PI * 2);
  else ctx.ellipse(cx, cy - 5, 110, 48, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = bone;
  ctx.lineWidth = 3;
  if (res.scan === 'empty') {
    ctx.fillStyle = 'rgba(220,235,255,0.15)';
    ctx.font = '16px VT323, monospace';
    ctx.fillText('NO INTERNAL STRUCTURE DETECTED', 40, H - 16);
    return;
  }
  // spine
  const spineY = bird ? 0 : cy - 22;
  if (bird) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - 70);
    ctx.lineTo(cx, cy + 60);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - 100, spineY);
    ctx.quadraticCurveTo(cx, spineY - 12, cx + 100, spineY);
    ctx.stroke();
    // skull
    ctx.beginPath();
    if (res.scan === 'skull') {
      ctx.ellipse(cx + 125, spineY - 6, 26, 30, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + 117, spineY - 10, 6, 0, Math.PI * 2);
      ctx.arc(cx + 135, spineY - 10, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx + 112, spineY + 12, 26, 4);
    } else {
      ctx.ellipse(cx + 125, spineY + 2, 28, 16, 0.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    // ribs
    const ribs = res.scan === 'ribs' ? 28 : 9;
    for (let i = 0; i < ribs; i++) {
      const x = cx + 50 - i * (res.scan === 'ribs' ? 5 : 12);
      ctx.beginPath();
      ctx.moveTo(x, spineY);
      ctx.quadraticCurveTo(x - 10, cy + 10, x - 4, cy + 30);
      ctx.stroke();
    }
    // legs
    const legs = [[cx + 60, cy + 18], [cx + 45, cy + 18], [cx - 70, cy + 18], [cx - 85, cy + 18]];
    legs.forEach(([x, y], i) => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      if (res.scan === 'fracture' && i === 2) {
        ctx.lineTo(x + 4, y + 30);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 8, y + 34);
        ctx.lineTo(x + 6, y + 68);
        ctx.stroke();
        if (mark) {
          ctx.strokeStyle = '#ff5b5b';
          ctx.beginPath();
          ctx.arc(x + 6, y + 32, 14, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = bone;
        }
      } else {
        ctx.lineTo(x + 4, y + 34);
        ctx.lineTo(x, y + 68);
        ctx.stroke();
      }
    });
  }
  // findings
  if (res.scan === 'foreign') {
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.save();
    ctx.translate(cx - 10, cy + 6);
    ctx.rotate(0.4);
    ctx.fillRect(-14, -8, 28, 16);
    ctx.restore();
  } else if (res.scan === 'mass') {
    ctx.fillStyle = 'rgba(200,220,240,0.45)';
    ctx.beginPath();
    ctx.ellipse(cx - 20, cy + 8, 22, 17, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (res.scan === 'heart') {
    ctx.fillStyle = 'rgba(200,220,240,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx + 30, cy + 2, 30, 24, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (res.scan === 'hand') {
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(cx - 20 + i * 8, cy + 20);
      ctx.lineTo(cx - 26 + i * 10, cy - 12 - (i === 0 ? -10 : i * 2));
      ctx.stroke();
    }
  }
  if (mark && ['foreign', 'mass', 'heart'].includes(res.scan)) {
    ctx.strokeStyle = '#ff5b5b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(res.scan === 'heart' ? cx + 30 : cx - 15, cy + 6, 34, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(200,225,255,0.6)';
  ctx.font = '16px VT323, monospace';
  ctx.fillText(`${p.name.toUpperCase()} · LAT · ${new Date().getFullYear()}`, 10, H - 10);
}
