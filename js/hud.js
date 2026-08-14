// ===== HUD: the lane rail and the dock =====
// The rail is the signature piece — three chips stacked to match the three roads
// on the board, each showing who is standing in that lane right now. It is both
// the read-the-game display and the target selector for everything you buy.

import { drawAnt } from './render/ants.js';
import { tinted } from './board.js';
import { PHEROMONE } from '../shared/data/board.js';
import { teamTint } from './colors.js';
import { RAIDERS, DEFENDERS, POWERS, POWER_IDS, DEFAULT_LOADOUT, CASTES, CASTE_TIERS } from '../shared/data/units.js';
import { QUEENS, HERO, cleanQueen } from '../shared/data/heroes.js';
import { lanePressure } from './view.js';

const PRESSURE_FULL = 1400; // hp in one lane that fills a pressure meter
// keys for a colony's own roads, in rail order
const LANE_KEYS = ['A', 'S', 'D', 'F', 'G', 'H'];

function iconCanvas(def, team, size = 44, hero = null) {
  const cv = document.createElement('canvas');
  cv.width = size * 2; cv.height = size * 2;
  const c = cv.getContext('2d');
  c.scale(2, 2);
  c.save();
  c.translate(size / 2, size / 2 + 4);
  c.scale(0.62, 0.62);
  // a queen shares one body id with a per-queen variant on top of it
  drawAnt(c, hero ? 'hero' : def.species, tinted(def, team),
    { x: 0, y: 0, angle: -Math.PI / 2, scale: 1, time: 0, hero });
  c.restore();
  return cv;
}

export class Hud {
  /**
   * @param o.railEl   container for the lane chips
   * @param o.hudEl    container for purse + shop + powers
   * @param o.seat     which local seat this HUD drives (0 or 1)
   * @param o.team     the colony it belongs to
   * @param o.keys     bind keyboard shortcuts for this seat
   * @param o.label    shown over the purse in hot-seat
   * @param o.onCmd    (seat, cmd) => void
   */
  constructor(o) {
    Object.assign(this, o);
    this.roster = (o.roster && o.roster.length) ? o.roster : DEFAULT_LOADOUT;
    this.queen = cleanQueen(o.queen);
    // ONLY THE ROADS THAT RUN FROM YOUR NEST. On a duelling board that is all
    // three of them; on a ring board it is your four out of ten, and showing the
    // rest would offer you roads the server will refuse to send anything down.
    const mine = this.map.lanesFor ? this.map.lanesFor(this.team) : null;
    this.lanes = mine && mine.length
      ? mine.map((id, k) => ({ ...this.map.lanes[id], id, key: LANE_KEYS[k] || '' }))
      : this.map.lanes;
    this.lane = this.lanes[(this.lanes.length / 2) | 0]?.id ?? 0;
    this.sugar = 0;
    this.cards = new Map();
    this.upEls = new Map();
    this.powerEls = new Map();
    this.buildRail();
    this.buildDock();
  }

  buildRail() {
    this.railEl.innerHTML = '';
    this.chips = this.lanes.map((L) => {
      const b = document.createElement('button');
      b.className = 'lane-chip' + (L.id === this.lane ? ' on' : '');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(L.id === this.lane));
      b.innerHTML =
        `<span class="lane-key">${this.keys ? L.key : '▸'}</span>` +
        `<span class="lane-name">${L.name}</span>` +
        `<span class="lane-press"><i style="width:0"></i><b style="width:0"></b></span>` +
        `<span class="lane-scent"><i style="width:0"></i></span>`;
      b.title = `Aim at the ${L.name}`;
      b.onclick = () => this.aim(L.id);
      this.railEl.appendChild(b);
      return b;
    });

    // THE TRAIL CHIP: aim at the scent itself rather than a road. Everything
    // aimed while it is on follows the colony's strongest trail, and a forked
    // trail takes turns, so one mark re-aims every send that follows. It sits
    // under the roads because it IS a road, just one the colony picks for you.
    const t = document.createElement('button');
    t.className = 'lane-chip trail-chip';
    t.type = 'button';
    t.setAttribute('aria-pressed', 'false');
    t.innerHTML =
      `<span class="lane-key">${this.keys ? 'T' : '≋'}</span>` +
      `<span class="lane-name">Follow the trail</span>` +
      `<span class="lane-press"><i style="width:0"></i><b style="width:0"></b></span>` +
      `<span class="lane-scent"><i style="width:0"></i></span>`;
    t.title = 'Aim at your scent: sends walk the strongest trail, and a fork takes turns';
    t.onclick = () => this.aim('trail');
    this.railEl.appendChild(t);
    this.trailChip = t;
  }

  buildDock() {
    this.hudEl.innerHTML = '';

    const purse = document.createElement('div');
    purse.className = 'purse';
    purse.innerHTML =
      (this.label ? `<span class="who">${this.label}</span>` : '') +
      `<span class="amt">0</span><span class="rate">+0/s</span>` +
      `<span class="eco" title="Income bought by raiding. Sending ants is how this grows.">raids +0</span>`;
    this.amtEl = purse.querySelector('.amt');
    this.rateEl = purse.querySelector('.rate');
    this.ecoEl = purse.querySelector('.eco');
    this.hudEl.appendChild(purse);

    const shop = document.createElement('div');
    shop.className = 'shop';
    // only what this colony packed, numbered 1..5 in the order it was packed
    this.roster.forEach((id, slot) => {
      const def = RAIDERS[id];
      const b = document.createElement('button');
      b.className = 'card';
      b.type = 'button';
      b.title = `${def.name}. ${def.cost} sugar, adds ${def.eco}/s to your income. ${def.tagline}`;
      b.innerHTML = `<span class="ck">${this.keys ? slot + 1 : ''}</span>` +
        `<span class="cn">${def.name}</span>` +
        `<span class="cc">${def.cost}<i class="ce">+${def.eco.toFixed(2)}/s</i></span>`;
      const icon = iconCanvas(def, this.team);
      icon.setAttribute('aria-hidden', 'true');
      b.setAttribute('aria-label', `Send ${def.name}, ${def.cost} sugar`);
      b.insertBefore(icon, b.querySelector('.cn'));
      b.onclick = () => this.buy(id);

      // the upgrade sits beside the card rather than inside it: a button cannot
      // legally contain another button, and these are two different actions
      const cell = document.createElement('div');
      cell.className = 'slot';
      cell.appendChild(b);

      const up = document.createElement('button');
      up.className = 'up';
      up.type = 'button';
      up.innerHTML = `<span class="uc">${CASTES[id][0].cost}</span>`;
      up.onclick = () => this.upgrade(id);
      cell.appendChild(up);

      const pips = document.createElement('span');
      pips.className = 'pips';
      pips.innerHTML = Array.from({ length: CASTE_TIERS }, () => '<i></i>').join('');
      b.appendChild(pips);

      shop.appendChild(cell);
      this.cards.set(id, b);
      this.upEls.set(id, up);
    });
    this.hudEl.appendChild(shop);

    const pw = document.createElement('div');
    pw.className = 'powers';
    for (const id of POWER_IDS) {
      const def = POWERS[id];
      const b = document.createElement('button');
      b.className = 'pw';
      b.type = 'button';
      b.title = `${def.name}, ${def.cost} sugar. ${def.tagline}`;
      b.setAttribute('aria-label', `${def.name}, ${def.cost} sugar`);
      b.innerHTML = `<span class="glyph" aria-hidden="true">${def.icon}</span>` +
        `<span class="pk">${this.keys ? def.hotkey : def.name.slice(0, 5)}</span>` +
        `<span class="cd hidden">0</span>`;
      b.onclick = () => this.cast(id);
      pw.appendChild(b);
      this.powerEls.set(id, b);
    }
    // Pheromone sits with the powers because it works the same way: it acts on
    // whichever road the rail is aimed at. It is not in POWERS because it has no
    // cooldown meter worth a whole slot and no duration, only a level.
    const mk = document.createElement('button');
    mk.className = 'pw mark';
    mk.type = 'button';
    mk.title = `Lay a scent trail on the aimed road, ${PHEROMONE.cost} sugar. `
      + `Your ants move faster along it, your own traffic keeps it warm, and it fades if you walk away.`;
    mk.setAttribute('aria-label', `Lay a scent trail, ${PHEROMONE.cost} sugar`);
    mk.innerHTML = `<span class="glyph" aria-hidden="true">≋</span>` +
      `<span class="pk">${this.keys ? 'R' : 'Trail'}</span>` +
      `<span class="cd hidden">0</span>`;
    mk.onclick = () => this.mark();
    pw.appendChild(mk);
    this.markEl = mk;

    // Fork sits beside the trail button it modifies. Same cost, same cooldown,
    // and its price is baked into the mechanic: both branches top out lower
    // than a committed trail, so the button is a choice and not an upgrade.
    const fk = document.createElement('button');
    fk.className = 'pw fork';
    fk.type = 'button';
    fk.title = `Fork the trail toward the aimed road, ${PHEROMONE.cost} sugar. `
      + `The colony then splits: sends that follow the scent take turns down the two branches, `
      + `and both top out lower than a single committed trail.`;
    fk.setAttribute('aria-label', `Fork the trail, ${PHEROMONE.cost} sugar`);
    fk.innerHTML = `<span class="glyph" aria-hidden="true">⑂</span>` +
      `<span class="pk">${this.keys ? 'F' : 'Fork'}</span>` +
      `<span class="cd hidden">0</span>`;
    fk.onclick = () => this.fork();
    pw.appendChild(fk);
    this.forkEl = fk;

    this.hudEl.appendChild(pw);
    this.buildQueen();
  }

  /**
   * The queen block. She is one ant, so she gets one block: her portrait, how
   * far along she is, the button that walks her out, and the button that fires
   * her ability. The deploy button carries three different jobs depending on
   * where she is, which is why its label is rewritten every frame rather than
   * being three separate controls the player has to learn.
   */
  buildQueen() {
    const q = QUEENS[this.queen];
    const el = document.createElement('div');
    el.className = 'queen';

    const icon = iconCanvas(q, this.team, 46, q.art);
    icon.className = 'qart';
    icon.setAttribute('aria-hidden', 'true');
    el.appendChild(icon);

    el.insertAdjacentHTML('beforeend',
      `<span class="qtext">` +
        `<b class="qn">${q.name}</b>` +
        `<i class="qlv">Lv 1</i>` +
        `<span class="qxp"><i style="width:0"></i></span>` +
      `</span>` +
      `<button class="qgo" type="button"></button>` +
      `<button class="qab" type="button">` +
        `<span class="glyph" aria-hidden="true">${q.ability.icon}</span>` +
        `<span class="pk">${this.keys ? 'C' : q.ability.name.slice(0, 5)}</span>` +
        `<span class="cd hidden">0</span>` +
      `</button>`);

    this.qLv = el.querySelector('.qlv');
    this.qXp = el.querySelector('.qxp i');
    this.qGo = el.querySelector('.qgo');
    this.qAb = el.querySelector('.qab');
    this.qGo.onclick = () => this.sendQueen();
    this.qAb.onclick = () => this.ability();
    this.qAb.title = `${q.ability.name}. ${q.ability.tagline}`;
    this.hudEl.appendChild(el);
  }

  /** Walk her out down the aimed lane, or move her onto it if she is already out. */
  sendQueen() { this.onCmd(this.seat, { kind: 'queen', lane: this.lane }); }

  ability() { this.onCmd(this.seat, { kind: 'ability' }); }

  /** Rewrite the queen block from this frame's snapshot. */
  updateQueen(p) {
    const h = p.h;
    if (!h || !this.qGo) return;
    const q = QUEENS[h.q] || QUEENS[this.queen];

    this.qLv.textContent = `Lv ${h.lv}`;
    const floor = HERO.ladder[h.lv] ?? 0;
    const span = Math.max(1, h.nx - floor);
    const frac = h.lv >= HERO.maxLevel ? 1 : Math.max(0, Math.min(1, (h.xp - floor) / span));
    this.qXp.style.width = `${frac * 100}%`;

    if (h.dead > 0) {
      this.qGo.textContent = `Back in ${h.dead}s`;
      this.qGo.className = 'qgo waiting';
    } else if (h.out) {
      this.qGo.textContent = 'Move her here';
      this.qGo.className = 'qgo';
    } else {
      const cost = h.bought ? 0 : HERO.cost;
      this.qGo.innerHTML = cost
        ? `Send her out<em>${cost}</em>` : 'Send her out';
      this.qGo.className = 'qgo' + (this.sugar < cost ? ' broke' : '');
    }

    const locked = h.lv < HERO.abilityAt;
    const cdEl = this.qAb.querySelector('.cd');
    cdEl.classList.toggle('hidden', h.cd <= 0);
    if (h.cd > 0) cdEl.textContent = h.cd;
    this.qAb.classList.toggle('locked', locked);
    this.qAb.classList.toggle('broke', locked || h.cd > 0 || !h.out);
    this.qAb.setAttribute('aria-disabled', String(locked || h.cd > 0 || !h.out));
    this.qAb.title = locked
      ? `${q.ability.name} unlocks at level ${HERO.abilityAt}. ${q.ability.tagline}`
      : `${q.ability.name}. ${q.ability.tagline}`;
  }

  aim(lane) {
    // `lane` is a real lane id, which on a ring board is not its rail position,
    // or the literal 'trail' for the follow-the-scent chip
    this.lane = lane;
    this.chips.forEach((b, i) => {
      const on = this.lanes[i].id === lane;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if (this.trailChip) {
      this.trailChip.classList.toggle('on', lane === 'trail');
      this.trailChip.setAttribute('aria-pressed', String(lane === 'trail'));
    }
  }

  buy(id) {
    this.lastBought = id;
    this.onCmd(this.seat, { kind: 'send', unit: id, lane: this.lane });
    const el = this.cards.get(id);
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  cast(id) { this.onCmd(this.seat, { kind: 'power', power: id, lane: this.lane }); }

  mark() { this.onCmd(this.seat, { kind: 'mark', lane: this.lane }); }
  fork() { this.onCmd(this.seat, { kind: 'fork', lane: this.lane }); }

  upgrade(id) { this.onCmd(this.seat, { kind: 'upgrade', unit: id }); }

  /** Keyboard is seat 0's input in hot-seat; seat 1 plays on the mouse. */
  handleKey(e) {
    if (!this.keys) return false;
    const k = e.key.toLowerCase();
    const laneKey = this.lanes.findIndex((L) => (L.key || '').toLowerCase() === k);
    if (laneKey >= 0) { this.aim(this.lanes[laneKey].id); return true; }
    const power = POWER_IDS.find((p) => POWERS[p].hotkey.toLowerCase() === k);
    if (power) { this.cast(power); return true; }
    // the queen sits beside the powers rather than in them: she is one ant, not
    // a spell, and she has to stay reachable without eating a shop slot
    if (k === 'x') { this.sendQueen(); return true; }
    if (k === 'c') { this.ability(); return true; }
    if (k === 'r') { this.mark(); return true; }
    if (k === 'f') { this.fork(); return true; }
    if (k === 't') { this.aim('trail'); return true; }
    const slot = '12345678'.indexOf(e.key);
    const unit = slot >= 0 ? this.roster[slot] : null;
    if (unit) {
      if (e.shiftKey) this.quickBuild(unit);
      else this.buy(unit);
      return true;
    }
    return false;
  }

  /** Shift+number puts that defender on the free pad closest to the aimed lane. */
  quickBuild(unitId) {
    const idx = this.roster.indexOf(unitId);
    const defId = Object.keys(DEFENDERS)[idx];
    if (!defId) return;
    const pads = this.map.pads[this.team];
    const free = (this.freePads || []).slice().sort(
      (a, b) => Math.abs(pads[a].lane - this.lane) - Math.abs(pads[b].lane - this.lane),
    );
    if (!free.length) return;
    this.onCmd(this.seat, { kind: 'build', def: defId, pad: free[0] });
  }

  update(view, meIndex) {
    const p = view.players.find((q) => q.i === meIndex);
    if (!p) return;
    this.sugar = p.s;
    this.amtEl.textContent = p.s;
    this.rateEl.textContent = `+${p.r}/s`;
    if (this.ecoEl) this.ecoEl.textContent = `raids +${(p.e ?? 0).toFixed(1)}`;

    const castes = p.u || {};
    for (const [id, el] of this.cards) {
      el.classList.toggle('broke', p.s < RAIDERS[id].cost);
      const tier = castes[id] || 0;
      el.querySelectorAll('.pips i').forEach((pip, i) => pip.classList.toggle('on', i < tier));
      const up = this.upEls.get(id);
      const step = tier < CASTE_TIERS ? CASTES[id][tier] : null;
      if (step) {
        up.classList.remove('maxed');
        up.classList.toggle('broke', p.s < step.cost);
        up.querySelector('.uc').textContent = step.cost;
        up.title = `${step.name}: ${describeCaste(step)} (${step.cost} sugar). Applies to ants you send from now on.`;
        up.setAttribute('aria-label', `Upgrade ${RAIDERS[id].name} to ${step.name}, ${step.cost} sugar`);
      } else {
        up.classList.add('maxed');
        up.querySelector('.uc').textContent = 'max';
        up.title = `${RAIDERS[id].name} is fully upgraded`;
        up.setAttribute('aria-label', `${RAIDERS[id].name} is fully upgraded`);
      }
    }
    for (const [id, el] of this.powerEls) {
      const cd = p.c[id] || 0;
      const cdEl = el.querySelector('.cd');
      cdEl.classList.toggle('hidden', cd <= 0);
      el.setAttribute('aria-disabled', String(p.s < POWERS[id].cost || cd > 0));
      if (cd > 0) cdEl.textContent = cd;
      el.classList.toggle('broke', p.s < POWERS[id].cost || cd > 0);
    }

    const taken = new Set(view.defs.filter((d) => d.owner === meIndex).map((d) => d.pad));
    this.freePads = (this.padIdx || []).filter((i) => !taken.has(i));

    this.updateQueen(p);

    if (this.markEl) {
      const cd = p.mk || 0;
      const cdEl = this.markEl.querySelector('.cd');
      cdEl.classList.toggle('hidden', cd <= 0);
      if (cd > 0) cdEl.textContent = cd.toFixed(1);
      const mine = view.pher?.[this.team] || [];
      const full = (mine[this.lane] || 0) >= 1;
      this.markEl.classList.toggle('broke', p.s < PHEROMONE.cost || cd > 0 || full);
      this.markEl.setAttribute('aria-disabled', String(p.s < PHEROMONE.cost || cd > 0 || full));

      // The fork wants a committed trail, a NAMED target road that is not part
      // of it, and the same purse and cooldown as a mark. Mirrors Sim._fork so
      // the button greys exactly when the command would refuse.
      if (this.forkEl) {
        const members = this.lanes.filter((L) => (mine[L.id] || 0) > PHEROMONE.reinforceCap);
        const canFork = members.length === 1
          && this.lane !== 'trail'
          && members[0].id !== this.lane
          && p.s >= PHEROMONE.cost && cd <= 0;
        this.forkEl.classList.toggle('broke', !canFork);
        this.forkEl.setAttribute('aria-disabled', String(!canFork));
        const fcd = this.forkEl.querySelector('.cd');
        fcd.classList.toggle('hidden', cd <= 0);
        if (cd > 0) fcd.textContent = cd.toFixed(1);
      }
      // the trail chip fades with the scent: no trail, nothing to follow
      if (this.trailChip) {
        const strongest = Math.max(0, ...this.lanes.map((L) => mine[L.id] || 0));
        const live = strongest > PHEROMONE.reinforceCap;
        this.trailChip.classList.toggle('broke', !live);
        this.trailChip.querySelector('.lane-scent i').style.width = `${strongest * 100}%`;
      }
    }

    const press = lanePressure(view, this.map.lanes.length, view.players?.length || 2);
    const scent = view.pher?.[this.team] || [];
    for (let i = 0; i < this.lanes.length; i++) {
      const id = this.lanes[i].id;
      const bar = this.chips[i].querySelector('.lane-press');
      // yours from the left, everybody else's from the right
      const mineHp = press[this.team]?.[id] || 0;
      let theirs = 0;
      for (let t = 0; t < press.length; t++) if (t !== this.team) theirs += press[t][id] || 0;
      bar.querySelector('i').style.width = `${Math.min(50, (mineHp / PRESSURE_FULL) * 100)}%`;
      bar.querySelector('b').style.width = `${Math.min(50, (theirs / PRESSURE_FULL) * 100)}%`;
      this.chips[i].querySelector('.lane-scent i').style.width = `${(scent[id] || 0) * 100}%`;
    }
  }
}

/** Turn a caste step into something a player can read at a glance. */
function describeCaste(step) {
  const bits = [];
  const pct = (v) => `${v > 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;
  if (step.hp) bits.push(`${pct(step.hp)} health`);
  if (step.damage) bits.push(`${pct(step.damage)} damage`);
  if (step.speed) bits.push(`${pct(step.speed)} speed`);
  if (step.range) bits.push(`${pct(step.range)} range`);
  if (step.siege) bits.push(`${pct(step.siege)} nest damage`);
  if (step.eco) bits.push(`${pct(step.eco)} income`);
  if (step.count) bits.push(`+${step.count} per purchase`);
  if (step.armor) bits.push(`+${step.armor} armour`);
  if (step.blastDamage) bits.push(`${pct(step.blastDamage)} blast`);
  if (step.blastR) bits.push(`${pct(step.blastR)} blast radius`);
  if (step.slowMul) bits.push('a heavier slow');
  if (step.slowDur) bits.push('a longer slow');
  return bits.join(', ');
}

/** Colour a lane chip set to match a colony, used to tell the hot-seat HUDs apart. */
export function tintRail(el, team) {
  el.style.setProperty('--accent', teamTint(team).accent);
}
