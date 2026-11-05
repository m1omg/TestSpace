// Campaign state (money, reputation, supplies, upgrades) and the flow of a
// single shift: clock, staggered arrivals, end conditions and scoring.
import { START_STOCK, SHIFTS, UPGRADES, SUPPLY_OFFERS, SUPPLIES, RULES } from './data.js';
import { storageGet, storageSet, storageRemove, RNG, clamp } from './core.js';
import { generateShiftVisitors } from './patients.js';

const SAVE_KEY = 'nightward.campaign.v1';

export function newCampaign(difficulty = 'normal') {
  return {
    version: 1,
    shift: 0, // index of the next shift to play
    money: 150,
    reputation: 55,
    stock: { ...START_STOCK },
    upgrades: { pole: 1, flare: 0 },
    history: [],
    difficulty,
    started: Date.now(),
    finished: false,
  };
}

export function loadCampaign() {
  const c = storageGet(SAVE_KEY, null);
  if (!c || c.version !== 1) return null;
  return c;
}

export function saveCampaign(c) {
  storageSet(SAVE_KEY, c);
}

export function clearCampaign() {
  storageRemove(SAVE_KEY);
}

export function rulesForShift(shiftIndex) {
  return RULES.filter((r) => r.shift <= shiftIndex + 1);
}

export function supplyOffers(rng) {
  return rng.shuffle(SUPPLY_OFFERS).slice(0, 3);
}

export function upgradeAvailable(c, u) {
  if (u.requires && !c.upgrades[u.requires]) return false;
  if (u.consumable) return (c.upgrades[u.id] || 0) < (u.max || 1);
  return !c.upgrades[u.id];
}

export function buyUpgrade(c, id) {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u || c.money < u.price || !upgradeAvailable(c, u)) return false;
  c.money -= u.price;
  if (u.consumable) c.upgrades[u.id] = (c.upgrades[u.id] || 0) + 1;
  else c.upgrades[u.id] = true;
  return true;
}

export function buySupply(c, id, qty = 1) {
  const s = SUPPLIES[id];
  if (!s) return false;
  const cost = s.price * qty;
  if (c.money < cost) return false;
  c.money -= cost;
  c.stock[id] = (c.stock[id] || 0) + qty;
  return true;
}

export class Shift {
  constructor(G) {
    this.G = G;
    this.index = 0;
    this.time = 0;
    this.duration = 600;
    this.records = [];
    this.arrivals = [];
    this.spawned = 0;
    this.over = false;
    this.snapshot = null;
  }

  // Minutes since 22:00 for the HUD clock.
  get clockMinutes() {
    return clamp((this.time / this.duration) * 480, 0, 480);
  }

  begin(index) {
    const G = this.G;
    const c = G.campaign;
    this.index = index;
    this.snapshot = JSON.parse(JSON.stringify(c));
    const cfg = SHIFTS[index];
    const diff = G.difficulty();
    this.duration = cfg.realMinutes * 60 * (diff.decay < 1 ? 1.08 : 1);
    this.time = 0;
    this.over = false;
    this.spawned = 0;
    const rng = new RNG((Date.now() ^ (index * 104729)) >>> 0);
    this.records = generateShiftVisitors(index, diff, rng, c.upgrades);
    // staggered arrivals: first after a short settling-in period, then
    // spaced so that one person can screen, escort and treat in between.
    const n = this.records.length;
    const first = index === 0 ? 35 : 22;
    const last = this.duration * 0.74;
    const gap = (last - first) / Math.max(1, n - 1);
    this.arrivals = this.records.map((r, i) => first + i * gap + rng.range(-gap * 0.25, gap * 0.25) * (i === 0 ? 0 : 1));
    G.patients.reset();
    G.patients.schedule(this.records, this.arrivals);
    G.incidents.reset(index, this.duration);
  }

  fixedUpdate(dt) {
    if (this.over) return;
    const G = this.G;
    this.time += dt;
    // arrivals
    while (this.spawned < this.records.length && this.time >= this.arrivals[this.spawned]) {
      G.patients.spawn(this.records[this.spawned]);
      this.spawned++;
    }
    if (this.time >= this.duration) this.end('dawn');
  }

  // All visitors have come and gone and nobody needs care.
  canClockOut() {
    const G = this.G;
    if (this.spawned < this.records.length) return false;
    const busy = G.patients.patients.some((p) => !['gone', 'leaving', 'discharging', 'dead'].includes(p.state));
    return !busy && !G.incidents.creatures.length;
  }

  end(reason) {
    if (this.over) return;
    this.over = true;
    this.G.onShiftEnd(reason);
  }

  // Final accounting for a finished shift. Returns a summary object.
  summarize(reason) {
    const G = this.G;
    const c = G.campaign;
    const st = G.patients.stats;
    const lines = [];
    // patients still inside at dawn are handed to the day team
    let handed = 0;
    let looseImpostors = 0;
    for (const p of G.patients.patients) {
      if (p.impostor && ['waiting', 'inRoom', 'following', 'placing', 'admitted'].includes(p.state)) looseImpostors++;
      else if (!p.impostor && ['waiting', 'inRoom', 'following', 'placing', 'admitted'].includes(p.state)) handed++;
      if (p.state === 'recovering') st.treated++;
    }
    const creaturesLoose = G.incidents.creatures.length + looseImpostors;
    let rep = 0;
    rep -= handed * 2;
    rep -= st.wrongRejects * 8;
    rep += st.rightRejects * 2;
    rep -= creaturesLoose * 8;
    const salary = 100;
    c.money += salary;
    c.reputation = clamp(c.reputation + rep, 0, 100);
    st.repDelta += rep;
    st.handedOff = handed;
    // reveal the truth about every visitor
    const visitors = this.records.map((r) => {
      const h = G.patients.history.filter((x) => x.id === r.id);
      const last = h[h.length - 1];
      const first = h[0];
      return {
        name: r.name,
        species: r.species,
        impostor: r.impostor,
        signs: r.signs,
        condition: r.condition,
        decision: first ? first.what : this.arrivals[this.records.indexOf(r)] > this.time ? 'Never arrived' : 'Still outside',
        outcome: last ? last.what : '—',
      };
    });
    const summary = {
      shift: this.index,
      reason,
      treated: st.treated,
      deaths: st.deaths,
      wrongRejects: st.wrongRejects,
      rightRejects: st.rightRejects,
      creaturesAdmitted: st.creaturesAdmitted,
      creaturesContained: st.creaturesContained,
      creaturesLoose,
      handed,
      leftWaiting: st.leftWaiting,
      earned: st.earned,
      salary,
      repDelta: st.repDelta,
      reputation: c.reputation,
      money: c.money,
      visitors,
    };
    c.history.push(summary);
    return summary;
  }
}
