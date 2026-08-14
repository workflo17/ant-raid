// ===== Ant Raid simulation — pure ESM, runs identically in Node and the browser =====
// The server owns one of these per room and broadcasts snapshots; solo and
// hot-seat run the very same class inside the page. No DOM, no node builtins.

import { dist, clamp, mulberry32 } from './util.js';
import {
  TUNING, WILDLIFE, FOOD, PHEROMONE, isColor, resolveColors, suddenDeathFor,
} from './data/board.js';
import { buildMap, DEFAULT_MAP, WORLD_W } from './map.js';
import {
  RAIDERS, DEFENDERS, POWERS, RAIDER_IDS, DEFENDER_IDS, POWER_IDS,
  cleanLoadout, LOADOUT_SIZE, isRaider, isDefender, isPower,
  CASTES, CASTE_TIERS, castedRaider,
} from './data/units.js';
import {
  HERO, QUEENS, QUEEN_IDS, cleanQueen, queenStats, xpOf, xpNeeded, respawnFor, POP_WILD,
} from './data/heroes.js';

const WILD_IDS = WILDLIFE.types.map((w) => w.type);
const scratch = { x: 0, y: 0, angle: 0, seg: 0 };

// A hero rides in this.units alongside the raiders so that targeting, column
// separation, damage and culling all work on her for free. `t` is the tell:
// zero or above indexes RAIDER_IDS, negative encodes which queen she is.
const heroT = (id) => -1 - QUEEN_IDS.indexOf(id);
const queenOfT = (t) => QUEEN_IDS[-1 - t];
export const isHeroT = (t) => t < 0;

// fx kinds are ints on the wire; the client maps them to particles + sound
export const FX = {
  HIT: 0, POP: 1, BLAST: 2, SHOOT: 3, NEST: 4, CAST: 5, BUILD: 6, WALL: 7,
  BOUNTY: 8, CLAIM: 9, LEVEL: 10, ABILITY: 11, QUEEN: 12, MARK: 13, FALL: 14,
};

export class Sim {
  /**
   * @param {object} opts
   *   mode      'versus' | 'coop'
   *   players   [{ id, name, team }]  team 0 = left, 1 = right
   *   ai        { team, difficulty } | null
   *   wildlife  boolean
   *   seed      number
   */
  constructor(opts = {}) {
    this.mode = opts.mode || 'versus';
    this.map = buildMap(opts.map || DEFAULT_MAP);
    this.seed = opts.seed ?? 12345;
    this.rand = mulberry32(this.seed);
    this.wildlifeOn = opts.wildlife !== false && WILDLIFE.enabled;

    this.t = 0;
    this.tick = 0;
    this.over = false;
    this.winner = -1;
    this.endReason = '';

    this.nextId = 1;
    this._dmg = new Map();
    this.units = [];
    this.defs = [];
    this.walls = [];
    this.wild = [];
    this.fx = [];

    // HOW MANY COLONIES. The board decides, not the player list: a board with
    // three nests is a three-colony game whether or not three people turned up.
    // Everything that used to be a pair is sized from this.
    this.teamCount = this.map.nests.length;
    const perTeam = (fill) => Array.from({ length: this.teamCount },
      () => new Array(this.map.lanes.length).fill(fill));

    this.nestHp = new Array(this.teamCount).fill(TUNING.nestHp);
    this.out = new Array(this.teamCount).fill(false);   // colonies already gone
    // read once: a match cannot change how many colonies are in it
    this.sudden = suddenDeathFor(this.teamCount);
    // rallies[team][lane] and rains[team][lane] hold an expiry time
    this.rallies = perTeam(0);
    this.rains = perTeam(0);
    // pher[team][lane] is trail strength, 0 to 1. Unlike the two above it is a
    // level rather than a deadline: it is topped up and it drains.
    this.pher = perTeam(0);

    this.players = (opts.players || []).map((p, i) => this._makePlayer(p, i));
    this.ai = opts.ai ? { ...opts.ai, team: opts.ai.team ?? 1 } : null;
    if (this.ai) {
      this.aiPlayer = this._makePlayer(
        { id: '@ai', name: 'The Other Colony', team: this.ai.team, bot: true,
          roster: this.ai.roster, queen: this.ai.queen },
        this.players.length,
      );
      this.players.push(this.aiPlayer);
    }
    this._assignPads();
    // one colour per COLONY, not per player: in co-op two humans share a side
    // and cannot wear different colours as each other
    this.colors = resolveColors(
      Array.from({ length: this.teamCount },
        (_, t) => this.players.find((p) => p.team === t)?.color),
    );

    this.nextWild = this.wildlifeOn ? WILDLIFE.firstAt : Infinity;
    // The aphid herd. `foodLead` is whichever colony is currently pulling it and
    // `foodHold` is how far, 0 to 1. With two colonies this is exactly the old
    // signed tug written another way: hold -0.5 for team 0 IS hold +0.5 for
    // team 1, so the dynamics are unchanged and it now says three names.
    this.foodLead = -1;
    this.foodHold = 0;
    this.foodOwner = -1;
  }

  _makePlayer(p, index) {
    return {
      index,
      id: p.id,
      name: p.name || `Colony ${index + 1}`,
      team: p.team ?? (index % 2),
      bot: !!p.bot,
      sugar: TUNING.startSugar,
      spent: 0,
      sent: 0,
      kills: 0,
      dealt: 0,
      padIdx: [],
      roster: cleanLoadout(p.roster),   // the five ants this colony packed
      castes: {},                       // species id -> upgrade tier bought
      eco: 0,            // income bought with raids, the main way a purse grows
      powerCd: { rally: 0, acidrain: 0, barricade: 0 },
      connected: true,
      // the queen. She is a persistent identity rather than a purchase you
      // repeat: bought once, and after that she keeps coming back with whatever
      // levels she earned before she fell.
      // cosmetic, but it travels with the player because both clients have to
      // agree on it: it is the only thing telling the two colonies apart
      color: isColor(p.color) ? p.color : null,
      queen: cleanQueen(p.queen),
      heroLevel: 1,
      heroXp: 0,
      heroBought: false,
      heroDeadUntil: 0,
      heroFalls: 0,
      abilityCd: 0,
      heroMoveCd: 0,
      markCd: 0,
      spawns: 0,   // per-colony, so the sideways fan mirrors (see _addUnit)
    };
  }

  // One player defending a side owns every pad on it. In co-op the two humans
  // split their side evenly by alternating pads, so each gets one per lane and
  // neither can hog the wall.
  _assignPads() {
    for (let team = 0; team < this.map.pads.length; team++) {
      const mine = this.players.filter((p) => p.team === team);
      const all = this.map.pads[team].map((_, i) => i);
      if (mine.length === 1) mine[0].padIdx = all;
      else if (mine.length >= 2) {
        mine[0].padIdx = all.filter((i) => i % 2 === 0);
        mine[1].padIdx = all.filter((i) => i % 2 === 1);
        for (let i = 2; i < mine.length; i++) mine[i].padIdx = [];
      }
    }
  }

  playerById(id) { return this.players.find((p) => p.id === id); }
  padOwner(team, pad) { return this.players.find((p) => p.team === team && p.padIdx.includes(pad)); }
  defAt(team, pad) { return this.defs.find((d) => d.team === team && d.pad === pad); }

  /** This colony's queen if she is on the board, else null. */
  heroOf(ownerIndex) {
    for (const u of this.units) if (u.kind === 'h' && u.owner === ownerIndex && u.hp > 0) return u;
    return null;
  }

  /** The stat block a unit fights with, whether it is a raider or a queen. */
  statsOf(u) {
    return u.kind === 'h'
      ? queenStats(queenOfT(u.t), u.lv)
      : castedRaider(RAIDER_IDS[u.t], u.caste);
  }

  /**
   * What a raid is actually worth to your income. Full value while you are poor,
   * tapering to ecoFloor once you are at the cap, so an early lead cannot be
   * compounded into an unanswerable one.
   */
  ecoGain(p, base) {
    const t = Math.min(1, p.eco / TUNING.ecoCap);
    return base * (1 - t * (1 - TUNING.ecoFloor));
  }

  /**
   * How many ants THIS player may have on the board at once. Shared out so that
   * a colony of two cannot put twice as much on a board of the same size.
   */
  unitCapFor(p) {
    // What the BOARD can carry, shared between the colonies on it. With two
    // this is the old flat ceiling: 150/2 is 75, above the 55 a player has
    // always had, so nothing about a duel, a pair or a co-op game changes.
    let cap = Math.min(TUNING.maxUnitsPerPlayer,
      Math.max(TUNING.boardUnitsFloor, Math.round(TUNING.boardUnits / this.teamCount)));
    // and then shared again between team-mates sitting in the same colony
    if (this._teamSize(p.team) > 1) cap = Math.round(cap * TUNING.teamCapMul);
    return cap;
  }

  /** How many players share a colony, so the herd pays a team and not a head. */
  _teamSize(team) {
    let n = 0;
    for (const p of this.players) if (p.team === team) n++;
    return n;
  }

  /**
   * The tug over the aphid herd. Whoever has more ants standing on it pulls it
   * their way; it pays only once pulled past claimAt, so brushing past does not
   * flip it and holding it actually means holding it.
   */
  _stepFood(dt) {
    const F = this.map.food;
    const near = new Array(this.teamCount).fill(0);
    for (const u of this.units) {
      if (u.hp <= 0) continue;
      if (dist(u.x, u.y, F.x, F.y) <= F.r) near[u.team]++;
    }
    // who is winning it, and by how much over the next colony along
    let lead = -1, best = 0, second = 0;
    for (let t = 0; t < this.teamCount; t++) {
      if (near[t] > best) { second = best; best = near[t]; lead = t; }
      else if (near[t] > second) { second = near[t]; }
    }
    const margin = best - second;

    if (margin > 0) {
      const speed = FOOD.tip * Math.min(1, margin / 3);
      if (lead === this.foodLead || this.foodHold <= 0) {
        // pulling it further your way, or taking it over now it has gone slack
        this.foodLead = lead;
        this.foodHold = clamp(this.foodHold + speed * dt, 0, 1);
      } else {
        // Somebody else holds it: drag it back through slack and out the other
        // side, CARRYING THE OVERSHOOT. Stopping dead at zero looks equivalent
        // and is not: it throws away part of a tick's pull every time the herd
        // changes hands, which moved every downstream number in the two-colony
        // game when this was first written.
        const next = this.foodHold - speed * dt;
        if (next >= 0) this.foodHold = next;
        else { this.foodLead = lead; this.foodHold = Math.min(1, -next); }
      }
    }
    const owner = this.foodHold >= FOOD.claimAt ? this.foodLead : -1;
    if (owner !== this.foodOwner) {
      this.foodOwner = owner;
      this.fx.push([FX.CLAIM, Math.round(F.x), Math.round(F.y), owner]);
    }
  }

  incomeRate(p) {
    let r = TUNING.incomeBase + Math.min(TUNING.incomeCap - TUNING.incomeBase, this.t * TUNING.incomeRamp);
    r += Math.min(TUNING.ecoCap, p.eco);
    if (this.foodOwner === p.team) r += FOOD.rate / Math.max(1, this._teamSize(p.team));
    for (const d of this.defs) {
      if (d.owner === p.index && DEFENDERS[DEFENDER_IDS[d.t]].income) r += DEFENDERS[DEFENDER_IDS[d.t]].income;
    }
    // a Honeyqueen is a walking honeypot, and stops paying the moment she falls
    const q = QUEENS[p.queen];
    if (q.income && this.heroOf(p.index)) r += q.income;
    if (p.bot) {
      const key = this.mode === 'coop' ? 'coop' : (this.ai?.difficulty || 'normal');
      r *= TUNING.aiIncomeMul[key] ?? 1;
    }
    return r;
  }

  // ---------------------------------------------------------------- commands

  /** Returns { ok } or { ok:false, why }. The server calls this; so does the AI. */
  command(playerId, cmd) {
    if (this.over) return { ok: false, why: 'match over' };
    const p = this.playerById(playerId);
    if (!p) return { ok: false, why: 'no such player' };
    // A colony with no nest left cannot buy its way back in. With two colonies
    // `over` has already caught this in the same tick, so the rule only ever
    // fires in a free-for-all — where without it a colony that can no longer win
    // still gets a full income to decide who does.
    if (this.out[p.team]) return { ok: false, why: 'your nest has fallen' };
    switch (cmd.kind) {
      case 'send': return this._send(p, cmd);
      case 'build': return this._build(p, cmd);
      case 'sell': return this._sell(p, cmd);
      case 'power': return this._power(p, cmd);
      case 'upgrade': return this._upgrade(p, cmd);
      case 'queen': return this._queen(p, cmd);
      case 'ability': return this._ability(p);
      case 'mark': return this._mark(p, cmd);
      default: return { ok: false, why: 'unknown command' };
    }
  }

  _send(p, cmd) {
    // hasOwn, not truthiness: '__proto__' and 'constructor' both resolve to
    // something truthy on a plain object and would sail past a `!def` check
    if (!isRaider(cmd.unit)) return { ok: false, why: 'no such raider' };
    // built with this colony's upgrades baked in, so an upgrade bought later
    // never retroactively rewrites a fight that is already resolving
    const def = castedRaider(cmd.unit, p.castes[cmd.unit] || 0);
    const lane = cmd.lane | 0;
    if (!p.roster.includes(cmd.unit)) return { ok: false, why: `you did not pack ${def.name}` };
    if (lane < 0 || lane >= this.map.lanes.length) return { ok: false, why: 'no such lane' };
    // on a ring board most roads do not start at your door
    const dir = this.map.laneSideFor(lane, p.team);
    if (!dir) return { ok: false, why: 'that road does not run from your nest' };
    if (p.sugar < def.cost) return { ok: false, why: 'not enough sugar' };
    let alive = 0;
    for (const u of this.units) if (u.owner === p.index) alive++;
    if (alive + (def.count || 1) > this.unitCapFor(p)) return { ok: false, why: 'lanes are full' };
    p.sugar -= def.cost;
    p.spent += def.cost;
    p.sent += def.count || 1;
    p.eco += this.ecoGain(p, def.eco || 0);   // the raid pays for itself
    const start = dir > 0 ? 0 : this.map.laneLen[lane];
    for (let i = 0; i < (def.count || 1); i++) {
      this._addUnit(p, {
        t: RAIDER_IDS.indexOf(cmd.unit),
        lane, dir,
        d: start - dir * i * TUNING.columnGap,
        hp: def.hp,
        caste: p.castes[cmd.unit] || 0,
      });
    }
    const n = this.map.nests[p.team];
    this.fx.push([FX.BUILD, n.x, n.y, lane]);
    return { ok: true };
  }

  /**
   * One place a body enters the board, so a raider bought in the shop, a worker
   * levied by a Broodqueen and a queen herself all carry the same fields. A unit
   * that is missing one of these silently reads as `undefined` somewhere deep in
   * the step, which is the sort of bug that only shows up in a live match.
   */
  _addUnit(p, o) {
    const dir = o.dir ?? this.map.laneSideFor(o.lane, p.team) ?? 1;
    /**
     * The sideways fan, and it has to MIRROR.
     *
     * It used to come off the global `nextId`, so colony A's k-th ant and colony
     * B's k-th ant got different offsets (2/-1/0 against 1/-2/-1). That moves
     * their x/y, and x/y is what map.slowAt() reads, so on a board with hazards
     * the two colonies were wading at different times off the same script. It
     * only surfaced once queens stopped corking their own lanes and ants got far
     * enough for it to matter, and then mapcheck failed on exactly the two maps
     * that have hazards.
     *
     * Both colonies use the SAME offset. A lane is its own mirror image, so the
     * heading at the mirrored distance is -theta: the normal's x component
     * flips and its y component does not, and the same `off` therefore lands
     * both ants on mirrored points. (Negating it for team 1 is the intuitive
     * guess and it is wrong: measured, it puts them 17 to 22 pixels apart.)
     */
    const fan = ((p.spawns++ * 37) % 5) - 2;
    const u = {
      kind: o.kind || 'r',
      id: this.nextId++,
      t: o.t,
      team: p.team,
      owner: p.index,
      lane: o.lane,
      d: o.d,
      dir,
      hp: o.hp,
      maxHp: o.hp,
      cd: 0,
      seg: 0,
      x: 0, y: 0, angle: 0,
      off: o.off ?? fan,
      slowT: 0, slowMul: 1,
      atk: 0,
      lastHit: -1,
      heroHit: -1,       // whose queen last hurt it, for the assist window
      heroHitT: -Infinity,
      colAhead: null,
      caste: o.caste || 0,
      lv: o.lv || 0,     // queens only
      ons: 0,            // Onslaught expiry, queens only
    };
    this.units.push(u);
    return u;
  }

  /**
   * Walk the queen out. She costs sugar once; every respawn after that is free
   * but has to wait out the timer, which is the whole price of losing her.
   */
  _queen(p, cmd) {
    const lane = cmd.lane | 0;
    if (lane < 0 || lane >= this.map.lanes.length) return { ok: false, why: 'no such lane' };
    // she is already out: this is a recall. Two conditions, both readable at a
    // glance from the board — she has to be out of a fight, and she has to not
    // have reached their gate yet. Anything looser is a teleport out of trouble;
    // "your own half only" was tighter and gave a useless eight-second window.
    const live = this.heroOf(p.index);
    if (live) {
      if (live.lane === lane) return { ok: false, why: 'she is already on that road' };
      if (p.heroMoveCd > 0) return { ok: false, why: 'she is still getting her bearings' };
      if (live.target) return { ok: false, why: 'she is in a fight' };
      const L = this.map.laneLen[live.lane];
      const gate = live.dir > 0 ? L * HERO.recallBefore : L * (1 - HERO.recallBefore);
      const stillBack = live.dir > 0 ? live.d < gate : live.d > gate;
      if (!stillBack) return { ok: false, why: 'she is too deep to call back' };
      const moveDir = this.map.laneSideFor(lane, p.team);
      if (!moveDir) return { ok: false, why: 'that road does not run from your nest' };
      live.lane = lane;
      live.dir = moveDir;
      live.d = moveDir > 0 ? 0 : this.map.laneLen[lane];
      live.seg = 0;
      p.heroMoveCd = HERO.recallCd;
      const home = this.map.nests[p.team];
      this.fx.push([FX.QUEEN, home.x, home.y, p.team]);
      return { ok: true };
    }
    if (this.t < p.heroDeadUntil) {
      return { ok: false, why: `she is still recovering, ${Math.ceil(p.heroDeadUntil - this.t)}s` };
    }
    const cost = p.heroBought ? 0 : HERO.cost;
    if (p.sugar < cost) return { ok: false, why: 'not enough sugar' };
    p.sugar -= cost;
    p.spent += cost;
    p.heroBought = true;

    const s = queenStats(p.queen, p.heroLevel);
    const dir = this.map.laneSideFor(lane, p.team);
    if (!dir) return { ok: false, why: 'that road does not run from your nest' };
    const start = dir > 0 ? 0 : this.map.laneLen[lane];
    this._addUnit(p, {
      kind: 'h', t: heroT(p.queen), lane, dir, d: start, hp: s.hp, lv: p.heroLevel, off: 0,
    });
    const n = this.map.nests[p.team];
    this.fx.push([FX.QUEEN, n.x, n.y, p.team]);
    return { ok: true };
  }

  /** Her ability. Free, but on a long cooldown, and locked until level 3. */
  _ability(p) {
    const u = this.heroOf(p.index);
    if (!u) return { ok: false, why: 'your queen is not on the board' };
    if (p.heroLevel < HERO.abilityAt) {
      return { ok: false, why: `she unlocks that at level ${HERO.abilityAt}` };
    }
    if (p.abilityCd > 0) return { ok: false, why: 'still recharging' };
    const q = QUEENS[p.queen];
    const ab = q.ability;
    p.abilityCd = HERO.abilityCd;
    this.fx.push([FX.ABILITY, Math.round(u.x), Math.round(u.y), QUEEN_IDS.indexOf(p.queen)]);

    if (ab.id === 'onslaught') {
      u.ons = this.t + ab.duration;
    } else if (ab.id === 'snare') {
      for (const o of this.units) {
        if (o.team === u.team || o.hp <= 0) continue;
        if (dist(u.x, u.y, o.x, o.y) > ab.r) continue;
        o.slowMul = ab.slow.mul;
        o.slowT = ab.slow.dur;
      }
    } else if (ab.id === 'honeydew') {
      for (const o of this.units) {
        if (o.team !== u.team || o.hp <= 0) continue;
        if (dist(u.x, u.y, o.x, o.y) > ab.r) continue;
        o.hp = Math.min(o.maxHp, o.hp + ab.heal);
      }
      for (const q2 of this.players) if (q2.index === p.index) q2.sugar += ab.sugar;
    } else if (ab.id === 'levy') {
      let alive = 0;
      for (const o of this.units) if (o.owner === p.index) alive++;
      const room = Math.max(0, this.unitCapFor(p) - alive);
      const n = Math.min(ab.count, room);
      // free bodies, and deliberately NOT worth eco: an ability that grew your
      // income would compound with itself every time it came off cooldown
      for (let i = 0; i < n; i++) {
        this._addUnit(p, {
          t: RAIDER_IDS.indexOf('worker'),
          lane: u.lane,
          d: u.d - u.dir * i * TUNING.columnGap,
          hp: RAIDERS.worker.hp,
        });
      }
    }
    return { ok: true };
  }

  /** Buy the next caste tier for one of the species this colony packed. */
  _upgrade(p, cmd) {
    if (!isRaider(cmd.unit)) return { ok: false, why: 'no such raider' };
    if (!p.roster.includes(cmd.unit)) return { ok: false, why: `you did not pack ${RAIDERS[cmd.unit].name}` };
    const tier = p.castes[cmd.unit] || 0;
    if (tier >= CASTE_TIERS) return { ok: false, why: 'fully upgraded' };
    const step = CASTES[cmd.unit][tier];
    if (p.sugar < step.cost) return { ok: false, why: 'not enough sugar' };
    p.sugar -= step.cost;
    p.spent += step.cost;
    p.castes[cmd.unit] = tier + 1;
    const n = this.map.nests[p.team];
    this.fx.push([FX.CAST, n.x, n.y, 0]);
    return { ok: true };
  }

  _build(p, cmd) {
    if (!isDefender(cmd.def)) return { ok: false, why: 'no such defender' };
    const def = DEFENDERS[cmd.def];
    const pad = cmd.pad | 0;
    if (!p.padIdx.includes(pad)) return { ok: false, why: 'not your pad' };
    if (this.defAt(p.team, pad)) return { ok: false, why: 'pad taken' };
    if (p.sugar < def.cost) return { ok: false, why: 'not enough sugar' };
    p.sugar -= def.cost;
    p.spent += def.cost;
    const spot = this.map.pads[p.team][pad];
    this.defs.push({
      kind: 'd',
      id: this.nextId++,
      t: DEFENDER_IDS.indexOf(cmd.def),
      team: p.team,
      owner: p.index,
      pad,
      x: spot.x, y: spot.y,
      padRange: spot.rangeMul,
      hp: def.hp,
      maxHp: def.hp,
      cd: 0,
      atk: 0,
      lastHit: -1,
      auraDmg: 1, auraRange: 1,
    });
    this._recomputeAuras();
    this.fx.push([FX.BUILD, spot.x, spot.y, 0]);
    return { ok: true };
  }

  _sell(p, cmd) {
    const pad = cmd.pad | 0;
    const d = this.defAt(p.team, pad);
    if (!d || d.owner !== p.index) return { ok: false, why: 'nothing of yours there' };
    p.sugar += Math.floor(DEFENDERS[DEFENDER_IDS[d.t]].cost * TUNING.sellRefund);
    this.defs.splice(this.defs.indexOf(d), 1);
    this._recomputeAuras();
    return { ok: true };
  }

  _power(p, cmd) {
    if (!isPower(cmd.power)) return { ok: false, why: 'no such power' };
    const def = POWERS[cmd.power];
    const lane = cmd.lane | 0;
    if (lane < 0 || lane >= this.map.lanes.length) return { ok: false, why: 'no such lane' };
    // A power lands on ONE ROAD, and the roads you may act on are the ones that
    // run from your nest — the same rule `send` and `queen` already apply, and
    // the same four the lane rail offers you. On a duelling board every road
    // does, so nothing changes there. On a ring it matters: acid rain on a road
    // between two OTHER colonies would let you hurt somebody the mode says you
    // cannot reach, which is the one thing the neighbours-only shape exists to
    // prevent.
    const dir = this.map.laneSideFor(lane, p.team);
    if (!dir) return { ok: false, why: 'that road does not run from your nest' };
    if (p.powerCd[cmd.power] > 0) return { ok: false, why: 'still recharging' };
    if (p.sugar < def.cost) return { ok: false, why: 'not enough sugar' };
    p.sugar -= def.cost;
    p.spent += def.cost;
    p.powerCd[cmd.power] = def.cooldown;

    if (cmd.power === 'rally') {
      this.rallies[p.team][lane] = this.t + def.duration;
    } else if (cmd.power === 'acidrain') {
      this.rains[p.team][lane] = this.t + def.duration;
    } else if (cmd.power === 'barricade') {
      // A pebble wall goes in YOUR half, and your half of a road is the end you
      // walk in from. `p.team === 0 ? at : 1 - at` said the same thing in a duel,
      // where colony 0 always enters at zero and colony 1 always at the far end.
      // On a ring one colony does both, on different roads, so half its walls
      // were being dropped on its neighbour's doorstep instead of its own.
      const at = dir > 0 ? def.at : 1 - def.at;
      const d = this.map.laneLen[lane] * at;
      const old = this.walls.find((w) => w.team === p.team && w.lane === lane);
      if (old) this.walls.splice(this.walls.indexOf(old), 1);
      this.map.laneAt(lane, d, scratch);
      this.walls.push({ kind: 'w', id: this.nextId++, team: p.team, lane, d, hp: def.hp, maxHp: def.hp, x: scratch.x, y: scratch.y, lastHit: -1 });
      this.fx.push([FX.WALL, scratch.x, scratch.y, 0]);
    }
    const mid = this.map.laneAt(lane, this.map.laneLen[lane] * 0.5, scratch);
    this.fx.push([FX.CAST, mid.x, mid.y, POWER_IDS.indexOf(cmd.power)]);
    return { ok: true };
  }

  /**
   * Lay pheromone on one road. Cheap, quick, and repeatable: this is the thing
   * to do with the twenty seconds between two purchases.
   */
  _mark(p, cmd) {
    const lane = cmd.lane | 0;
    if (lane < 0 || lane >= this.map.lanes.length) return { ok: false, why: 'no such lane' };
    // your own roads only: a trail on a road none of your ants can walk is
    // thirty sugar laid on the ground for nobody
    const dir = this.map.laneSideFor(lane, p.team);
    if (!dir) return { ok: false, why: 'that road does not run from your nest' };
    if (p.markCd > 0) return { ok: false, why: 'the scent is still settling' };
    if (p.sugar < PHEROMONE.cost) return { ok: false, why: 'not enough sugar' };
    if (this.pher[p.team][lane] >= 1) return { ok: false, why: 'that road is as strong as it gets' };
    p.sugar -= PHEROMONE.cost;
    p.spent += PHEROMONE.cost;
    p.markCd = PHEROMONE.cooldown;
    this.pher[p.team][lane] = Math.min(1, this.pher[p.team][lane] + PHEROMONE.perMark);
    const at = this.map.laneAt(lane, this.map.laneLen[lane] * (dir > 0 ? 0.2 : 0.8), scratch);
    this.fx.push([FX.MARK, Math.round(at.x), Math.round(at.y), p.team]);
    return { ok: true };
  }

  /**
   * Trails fade, and the ants walking them lay more down. A road a colony is
   * actually using stays warm without being paid for again; a road it walked
   * away from goes cold. Reinforcement alone tops out below a fresh mark, so
   * traffic can maintain a trail but never build one from nothing.
   */
  _stepPheromone(dt) {
    const walking = Array.from({ length: this.teamCount },
      () => new Array(this.map.lanes.length).fill(0));
    for (const u of this.units) if (u.hp > 0) walking[u.team][u.lane]++;
    for (let team = 0; team < this.teamCount; team++) {
      for (let l = 0; l < this.map.lanes.length; l++) {
        let v = this.pher[team][l];
        if (v <= 0 && walking[team][l] === 0) continue;
        v -= PHEROMONE.decay * dt;
        if (walking[team][l] > 0 && v < PHEROMONE.reinforceCap) {
          v = Math.min(PHEROMONE.reinforceCap, v + walking[team][l] * PHEROMONE.perAnt * dt);
        }
        this.pher[team][l] = clamp(v, 0, 1);
      }
    }
  }

  // ------------------------------------------------------------------- step

  step(dt) {
    if (this.over) return;
    this.t += dt;
    this.tick++;

    for (const p of this.players) {
      p.sugar += this.incomeRate(p) * dt;
      for (const k of POWER_IDS) if (p.powerCd[k] > 0) p.powerCd[k] = Math.max(0, p.powerCd[k] - dt);
      if (p.abilityCd > 0) p.abilityCd = Math.max(0, p.abilityCd - dt);
      if (p.heroMoveCd > 0) p.heroMoveCd = Math.max(0, p.heroMoveCd - dt);
      if (p.markCd > 0) p.markCd = Math.max(0, p.markCd - dt);
    }

    this._dmg = new Map();
    this._positions();
    this._stepWildlife(dt);
    this._stepFood(dt);
    this._stepPheromone(dt);
    this._stepUnits(dt);
    this._stepDefenders(dt);
    this._stepRains(dt);
    this._applyDamage();
    this._cull();

    if (this.t >= this.sudden.at) {
      const bleed = this.sudden.dps * dt;
      for (let t = 0; t < this.teamCount; t++) this.nestHp[t] = Math.max(0, this.nestHp[t] - bleed);
    }
    this._checkEnd();
  }

  _positions() {
    for (const u of this.units) {
      const p = this.map.laneAt(u.lane, u.d, scratch, u.seg);
      u.seg = p.seg;
      // fan the column sideways so a push reads as a crowd, not a conga line
      const nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
      u.x = p.x + nx * u.off * 5.5;
      u.y = p.y + ny * u.off * 5.5;
      u.angle = u.dir > 0 ? p.angle : p.angle + Math.PI;
    }
    for (const w of this.wild) {
      const p = this.map.laneAt(w.lane, w.d, scratch, w.seg);
      w.seg = p.seg; w.x = p.x; w.y = p.y; w.angle = p.angle + (w.dir > 0 ? 0 : Math.PI);
    }
  }

  _recomputeAuras() {
    for (const d of this.defs) { d.auraDmg = 1; d.auraRange = d.padRange ?? 1; }
    for (const b of this.defs) {
      const bd = DEFENDERS[DEFENDER_IDS[b.t]];
      if (!bd.aura) continue;
      for (const d of this.defs) {
        if (d === b || d.team !== b.team) continue;
        if (dist(b.x, b.y, d.x, d.y) <= bd.range * (b.padRange ?? 1)) {
          d.auraDmg = Math.max(d.auraDmg, bd.aura.damage);
          d.auraRange = Math.max(d.auraRange, (d.padRange ?? 1) * bd.aura.range);
        }
      }
    }
  }

  _stepWildlife(dt) {
    if (this.t >= this.nextWild && this.wild.length < 2) {
      const kind = Math.floor(this.rand() * WILDLIFE.types.length);
      const w = WILDLIFE.types[kind];
      const lane = Math.floor(this.rand() * this.map.lanes.length);
      this.wild.push({
        kind: 'b', id: this.nextId++, t: kind, lane,
        d: this.map.laneLen[lane] * (0.35 + this.rand() * 0.3),
        dir: this.rand() < 0.5 ? 1 : -1,
        hp: w.hp, maxHp: w.hp, seg: 0, x: 0, y: 0, angle: 0, lastHit: -1,
      });
      this.nextWild = this.t + WILDLIFE.every + (this.rand() * 2 - 1) * WILDLIFE.jitter;
    }
    for (const w of this.wild) {
      const def = WILDLIFE.types[w.t];
      w.d += w.dir * def.speed * dt;
      const lo = this.map.laneLen[w.lane] * 0.22, hi = this.map.laneLen[w.lane] * 0.78;
      if (w.d < lo) { w.d = lo; w.dir = 1; }
      if (w.d > hi) { w.d = hi; w.dir = -1; }
    }
  }

  _stepUnits(dt) {
    // Column separation: nobody walks through the ant in front of them.
    //
    // THE QUEEN IS NOT IN THE COLUMN, in either direction. She halts partway
    // down the lane and stays there; put her in the chain and every raider her
    // colony sends is stuck behind her for the rest of the match. Two real
    // browsers deadlocked on exactly that at 190/206 with 110 ants on the board,
    // 54 of one colony's 55 queued behind its own queen and nothing able to
    // reach a nest again. She is one body, and the sideways `off` fan already
    // keeps her from sitting on top of anyone.
    const columns = Array.from({ length: this.teamCount },
      () => Array.from({ length: this.map.lanes.length }, () => []));
    for (const u of this.units) {
      if (u.kind === 'h') { u.colAhead = null; continue; }
      columns[u.team][u.lane].push(u);
    }
    for (let team = 0; team < this.teamCount; team++) {
      for (let l = 0; l < this.map.lanes.length; l++) {
        const col = columns[team][l];
        if (!col.length) continue;
        // Order by WHICH WAY THEY ARE WALKING, not by which colony they belong
        // to. This used to read `team === 0 ? ... : ...`, which happened to work
        // only because on a duelling board colony 1 always walks backwards. On a
        // ring a colony walks forwards down one road and backwards down another,
        // and the old test put the column in reverse: the ant at the back was
        // treated as the leader and the one in front was shoved backwards.
        const facing = col[0].dir;
        col.sort((a, b) => (facing > 0 ? b.d - a.d : a.d - b.d));
        for (let i = 0; i < col.length; i++) col[i].colAhead = i > 0 ? col[i - 1] : null;
      }
    }

    // Pass 1: decay timers and pick every target off the same frozen board.
    // This has to happen before anyone moves. Resolve target-then-move per unit
    // in array order and whichever team sits later in the array evaluates
    // against positions the other team already advanced — it lands the opening
    // blow in every single engagement and wins the match. tools/symmetry.js
    // caught exactly that (84/100 nests on an identical script).
    for (const u of this.units) {
      const def = this.statsOf(u);
      if (u.cd > 0) u.cd -= dt;
      if (u.slowT > 0) { u.slowT -= dt; if (u.slowT <= 0) u.slowMul = 1; }
      if (u.atk > 0) u.atk -= dt;
      u.target = this._raiderTarget(u, def);
    }

    // Raiders that walked into a nest already in ruins and are carrying on out
    // the far side. Collected rather than moved on the spot: a unit's `d` is
    // read by whoever is queued behind it for the rest of this pass, and yanking
    // it back to the start of another road drags its whole column backwards with
    // it. They are re-roaded once everybody has moved.
    const through = [];

    // Pass 2: everyone acts. Damage lands in a buffer applied after the pass, so
    // two ants trading blows always trade, whoever the array happens to list first.
    for (const u of this.units) {
      const def = this.statsOf(u);
      const hero = u.kind === 'h';
      const rallied = this.rallies[u.team][u.lane] > this.t;
      const dmgMul = rallied ? POWERS.rally.damageMul : 1;
      // silk, a rally, an Onslaught and the ground underfoot all pull on the
      // same speed number
      const charging = hero && u.ons > this.t ? QUEENS[queenOfT(u.t)].ability.speedMul : 1;
      const scent = 1 + PHEROMONE.speed * this.pher[u.team][u.lane];
      const spdMul = (rallied ? POWERS.rally.speedMul : 1) * charging * scent
        * u.slowMul * this.map.slowAt(u.x, u.y);

      const target = u.target;
      if (target) {
        if (u.cd <= 0) {
          u.cd = def.cooldown || 0.4;
          u.atk = 0.12;
          if (def.blast) {
            this._blast(u.x, u.y, def.blast.r, def.blast.damage * dmgMul, u.team, u.owner);
            u.hp = 0;
          } else {
            this._damage(target, def.damage * dmgMul, u.owner, hero);
            if (def.slow) { target.slowMul = def.slow.mul; target.slowT = def.slow.dur; }
            this.fx.push([FX.HIT, target.x, target.y, u.t]);
            if (def.range > 60) this.fx.push([FX.SHOOT, u.x, u.y, u.t]);
            // Onslaught rides ON TOP of her bite rather than replacing it. It
            // must not reuse def.blast: that branch kills the attacker, which is
            // correct for an Exploder and fatal for a queen.
            if (hero && u.ons > this.t) {
              const ab = QUEENS[queenOfT(u.t)].ability;
              this._blast(u.x, u.y, ab.blast.r, ab.blast.damage * dmgMul, u.team, u.owner, true);
            }
          }
        }
        continue; // stopped to fight
      }

      // advance, but never closer than columnGap to the friendly ahead
      let nd = u.d + u.dir * def.speed * spdMul * dt;
      const ahead = u.colAhead;
      if (ahead) {
        const limit = ahead.d - u.dir * TUNING.columnGap;
        if (u.dir > 0 ? nd > limit : nd < limit) nd = limit;
      }
      // the queen holds at the enemy's gate rather than walking into their nest.
      // `L - L * haltAt` and not `L * (1 - haltAt)`: the two are not the same
      // float, and the first is the exact mirror of the near side's halt.
      if (hero) {
        const L = this.map.laneLen[u.lane];
        const halt = u.dir > 0 ? L * HERO.haltAt : L - L * HERO.haltAt;
        if (u.dir > 0 ? nd > halt : nd < halt) nd = halt;
      }
      u.d = nd;

      // and so she never triggers the nest bite below; the guard is here anyway
      // because a haltAt of 1 would otherwise feed an undefined siege into it
      const end = u.dir > 0 ? this.map.laneLen[u.lane] : 0;
      if (!hero && (u.dir > 0 ? u.d >= end : u.d <= end)) {
        // whose nest is at the end this ant just walked into. On a two-colony
        // board every lane runs 0 to 1 so this is the old `1 - u.team`.
        const foe = this.map.laneFoe(u.lane, u.dir);
        // THROUGH THE RUINS. A nest that has already fallen is not a target and
        // not a wall either: the raid keeps going, out of the dead colony's far
        // side and on to whoever is still standing beyond it. This is what stops
        // a ring from falling into disconnected pieces as colonies drop out, and
        // it cannot fire in a duel, where there is no road that leads onward.
        if (this.out[foe]) {
          const on = foe === u.team ? null : this.map.onwardFrom(u.lane, foe);
          if (on) through.push([u, on]);
          else u.hp = 0;      // nowhere left to walk
          continue;
        }
        const dmg = Math.min(this.nestHp[foe], def.siege * dmgMul);
        // The bitten colony boils out: losing ground funds the answer to it, and
        // pays more the further behind that colony ALREADY was.
        //
        // Measured before the bite lands, not after. Reading it afterwards
        // counts the damage being dealt right now as part of the deficit, so
        // whichever colony happens to be bitten first in a tick collects a
        // slightly bigger refund than the ones bitten after it. That is
        // invisible in a duel, where both sides have spare sugar and the
        // scripted fairness check never spends down to it, and it is fatal on a
        // ring, where the advantage lands on a different colony every tick and
        // compounds until the boards are no longer each other's copies.
        const deficit = Math.max(0, this.nestHp[u.team] - this.nestHp[foe]) / TUNING.nestHp;
        this.nestHp[foe] = Math.max(0, this.nestHp[foe] - dmg);
        const refund = dmg * TUNING.leakRefund * (1 + deficit * TUNING.leakDesperation);
        for (const q of this.players) {
          if (q.team === foe) q.sugar += refund;
        }
        const n = this.map.nests[foe];
        // WHO BIT IT is the fifth slot. With two colonies the answer was always
        // "the other one" and nobody had to say it; with six it is the only
        // record of which neighbour did the softening, and every measurement of
        // whether raiding pays in a free-for-all is built on it. The client
        // destructures four and ignores the rest.
        this.fx.push([FX.NEST, n.x, n.y, Math.round(dmg), u.team]);
        if (def.blast) this._blast(n.x, n.y, def.blast.r, def.blast.damage * dmgMul, u.team, u.owner);
        u.hp = 0;
      }
    }

    // and now the ones that walked through a ruin, onto the far side of it
    for (const [u, on] of through) {
      u.lane = on.lane;
      u.dir = on.dir;
      u.d = on.dir > 0 ? 0 : this.map.laneLen[on.lane];
      u.seg = 0;
      u.colAhead = null;
    }
  }

  /** Nearest thing this raider will stop for, or null to keep marching. */
  _raiderTarget(u, def) {
    let best = null, bestD = Infinity;
    const range = def.range;

    for (const o of this.units) {
      if (o.team === u.team || o.hp <= 0 || o.lane !== u.lane) continue;
      const dd = Math.abs(o.d - u.d);
      if (dd < range && dd < bestD) { best = o; bestD = dd; }
    }
    for (const w of this.wild) {
      if (w.hp <= 0 || w.lane !== u.lane) continue;
      const dd = Math.abs(w.d - u.d);
      if (dd < range + 12 && dd < bestD) { best = w; bestD = dd; }
    }
    for (const wl of this.walls) {
      if (wl.team === u.team || wl.hp <= 0 || wl.lane !== u.lane) continue;
      const dd = Math.abs(wl.d - u.d);
      if (dd < range + 10 && dd < bestD) { best = wl; bestD = dd; }
    }
    // melee raiders run the gauntlet; only ranged and siege units stop for pads
    if (def.vsDefender) {
      for (const dfd of this.defs) {
        if (dfd.team === u.team || dfd.hp <= 0) continue;
        const dd = dist(u.x, u.y, dfd.x, dfd.y);
        if (dd < range && dd < bestD) { best = dfd; bestD = dd; }
      }
    }
    return best;
  }

  _stepDefenders(dt) {
    for (const d of this.defs) {
      const def = DEFENDERS[DEFENDER_IDS[d.t]];
      if (d.cd > 0) d.cd -= dt;
      if (d.atk > 0) d.atk -= dt;
      if (!def.damage && !def.blast) continue;
      if (d.cd > 0) continue;

      const range = def.range * d.auraRange;
      const dmg = (def.damage || 0) * d.auraDmg;
      const hits = [];
      let nearest = null, nd = Infinity;
      for (const u of this.units) {
        if (u.team === d.team || u.hp <= 0) continue;
        const dd = dist(d.x, d.y, u.x, u.y);
        if (dd > range) continue;
        if (dd < nd) { nd = dd; nearest = u; }
        hits.push({ u, dd });
      }
      if (!nearest) continue;

      d.cd = def.cooldown;
      d.atk = 0.12;
      d.aimX = nearest.x; d.aimY = nearest.y;
      if (def.blast) {
        this._blast(nearest.x, nearest.y, def.blast.r, def.blast.damage * d.auraDmg, d.team, d.owner);
      } else if (def.maxTargets) {
        hits.sort((a, b) => a.dd - b.dd);
        for (const h of hits.slice(0, def.maxTargets)) {
          this._damage(h.u, dmg, d.owner);
          if (def.slow) { h.u.slowMul = def.slow.mul; h.u.slowT = def.slow.dur; }
          this.fx.push([FX.HIT, h.u.x, h.u.y, d.t]);
        }
      } else {
        this._damage(nearest, dmg, d.owner);
        if (def.slow) { nearest.slowMul = def.slow.mul; nearest.slowT = def.slow.dur; }
        this.fx.push([FX.HIT, nearest.x, nearest.y, d.t]);
        if (def.range > 90) this.fx.push([FX.SHOOT, d.x, d.y, d.t]);
      }
    }
  }

  _stepRains(dt) {
    for (let team = 0; team < this.teamCount; team++) {
      for (let l = 0; l < this.map.lanes.length; l++) {
        if (this.rains[team][l] <= this.t) continue;
        const dps = POWERS.acidrain.damage / POWERS.acidrain.duration;
        for (const u of this.units) {
          if (u.team === team || u.lane !== l || u.hp <= 0) continue;
          this._damage(u, dps * dt, -1);
        }
        for (const w of this.walls) {
          if (w.team === team || w.lane !== l || w.hp <= 0) continue;
          this._damage(w, dps * dt, -1);
        }
      }
    }
  }

  _blast(x, y, r, damage, team, owner, byHero = false) {
    this.fx.push([FX.BLAST, Math.round(x), Math.round(y), Math.round(r)]);
    for (const u of this.units) {
      if (u.team === team || u.hp <= 0) continue;
      if (dist(x, y, u.x, u.y) <= r) this._damage(u, damage, owner, byHero);
    }
    for (const d of this.defs) {
      if (d.team === team || d.hp <= 0) continue;
      if (dist(x, y, d.x, d.y) <= r) this._damage(d, damage, owner, byHero);
    }
    for (const w of this.walls) {
      if (w.team === team || w.hp <= 0) continue;
      if (dist(x, y, w.x, w.y) <= r) this._damage(w, damage, owner, byHero);
    }
    for (const w of this.wild) {
      if (w.hp <= 0) continue;
      if (dist(x, y, w.x, w.y) <= r) this._damage(w, damage, owner, byHero);
    }
  }

  /**
   * One damage funnel so armour, kill credit and bounty all live in one place.
   * Nothing is applied here — it accumulates and lands in _applyDamage() at the
   * end of the tick, which is what makes a tick order-independent.
   */
  _damage(target, amount, owner, byHero = false) {
    if (target.hp <= 0) return;
    let amt = amount;
    if (target.kind === 'r' || target.kind === 'h') {
      const rd = this.statsOf(target);
      if (rd.armor) amt = Math.max(1, amt - rd.armor); // armour bites per hit, not per tick
    }
    let e = this._dmg.get(target);
    if (!e) { e = { amt: 0, topOwner: -1, topAmt: 0, heroOwner: -1, heroAmt: 0 }; this._dmg.set(target, e); }
    e.amt += amt;
    // kill credit goes to whoever put the most in, so it doesn't depend on order
    if (owner >= 0) {
      const own = (e[`o${owner}`] = (e[`o${owner}`] || 0) + amt);
      if (own > e.topAmt) { e.topAmt = own; e.topOwner = owner; }
      // and a queen's share is tracked separately, because she levels on it.
      // Two opposing queens can both be chewing the same wildlife bug, so this
      // is per owner rather than a single flag.
      if (byHero) {
        const h = (e[`h${owner}`] = (e[`h${owner}`] || 0) + amt);
        if (h > e.heroAmt) { e.heroAmt = h; e.heroOwner = owner; }
      }
    }
    if (owner >= 0 && this.players[owner]) this.players[owner].dealt += amt;
  }

  _applyDamage() {
    for (const [target, e] of this._dmg) {
      target.hp -= e.amt;
      if (e.topOwner >= 0) target.lastHit = e.topOwner;
      // she takes the xp for anything that dies soon after she hurt it, so a
      // kill she set up and a defender finished still counts as hers
      if (e.heroOwner >= 0) { target.heroHit = e.heroOwner; target.heroHitT = this.t; }
    }
    this._dmg.clear();
  }

  /**
   * Hand a queen the experience for something she helped kill, and level her if
   * that crosses a rung. A level-up heals her by exactly the health it added,
   * so it is a reward rather than a full refill mid-fight.
   */
  _heroXp(target, amount) {
    const owner = target.heroHit;
    if (!(owner >= 0)) return;
    if (this.t - target.heroHitT > HERO.assistWindow) return;
    const p = this.players[owner];
    if (!p) return;
    p.heroXp += amount;
    while (p.heroLevel < HERO.maxLevel && p.heroXp >= xpNeeded(p.heroLevel)) {
      p.heroLevel++;
      const u = this.heroOf(owner);
      if (u) {
        const s = queenStats(p.queen, p.heroLevel);
        u.hp += s.hp - u.maxHp;
        u.maxHp = s.hp;
        u.lv = p.heroLevel;
        this.fx.push([FX.LEVEL, Math.round(u.x), Math.round(u.y), p.heroLevel]);
      }
    }
  }

  _cull() {
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (u.hp > 0) continue;
      this.fx.push([FX.POP, Math.round(u.x), Math.round(u.y), u.t]);
      if (u.lastHit >= 0 && this.players[u.lastHit]) this.players[u.lastHit].kills++;
      if (u.kind === 'h') {
        // she keeps her levels and comes back free, but the wait grows with how
        // big she had become: losing a level 5 queen is the real punishment
        const p = this.players[u.owner];
        if (p) {
          p.heroDeadUntil = this.t + respawnFor(p.heroLevel);
          p.heroFalls++;
        }
        this._heroXp(u, HERO.queenXp);
      } else {
        this._heroXp(u, xpOf(RAIDERS[RAIDER_IDS[u.t]].cost));
      }
      this.units.splice(i, 1);
    }
    for (let i = this.defs.length - 1; i >= 0; i--) {
      if (this.defs[i].hp > 0) continue;
      const d = this.defs[i];
      this.fx.push([FX.BLAST, Math.round(d.x), Math.round(d.y), 34]);
      this._heroXp(d, xpOf(DEFENDERS[DEFENDER_IDS[d.t]].cost));
      this.defs.splice(i, 1);
      this._recomputeAuras();
    }
    for (let i = this.walls.length - 1; i >= 0; i--) {
      if (this.walls[i].hp > 0) continue;
      const w = this.walls[i];
      this.fx.push([FX.BLAST, Math.round(w.x), Math.round(w.y), 26]);
      this.walls.splice(i, 1);
    }
    for (let i = this.wild.length - 1; i >= 0; i--) {
      const w = this.wild[i];
      if (w.hp > 0) continue;
      const bounty = WILDLIFE.types[w.t].bounty;
      if (w.lastHit >= 0 && this.players[w.lastHit]) {
        this.players[w.lastHit].sugar += bounty;
        this.fx.push([FX.BOUNTY, Math.round(w.x), Math.round(w.y), bounty]);
      }
      this._heroXp(w, xpOf(bounty));
      this.fx.push([FX.POP, Math.round(w.x), Math.round(w.y), POP_WILD]);
      this.wild.splice(i, 1);
    }
  }

  /**
   * A knocked-out colony leaves the board: its column scatters, its pads go
   * quiet and its walls crumble.
   *
   * Leaving them there is not neutral. Its ants keep walking into a neighbour's
   * nest and its pads keep shooting whoever passes, so a colony that can no
   * longer win goes on choosing who does — kingmaking by a player who is not
   * even at the table any more. It also makes the herd unclaimable, since the
   * tug can sit parked on a colony that no longer has anything to hold it with.
   */
  _scatter(team) {
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (u.team !== team) continue;
      this.fx.push([FX.POP, Math.round(u.x), Math.round(u.y), u.t]);
      this.units.splice(i, 1);
    }
    for (let i = this.defs.length - 1; i >= 0; i--) {
      const d = this.defs[i];
      if (d.team !== team) continue;
      this.fx.push([FX.BLAST, Math.round(d.x), Math.round(d.y), 34]);
      this.defs.splice(i, 1);
    }
    for (let i = this.walls.length - 1; i >= 0; i--) {
      if (this.walls[i].team === team) this.walls.splice(i, 1);
    }
    this._recomputeAuras();
    // and it lets go of the herd rather than holding it from beyond the grave
    if (this.foodLead === team) {
      this.foodLead = -1;
      this.foodHold = 0;
      if (this.foodOwner !== -1) {
        this.foodOwner = -1;
        this.fx.push([FX.CLAIM, Math.round(this.map.food.x), Math.round(this.map.food.y), -1]);
      }
    }
  }

  /**
   * A colony whose nest has fallen is out, and the last one standing wins.
   *
   * With two colonies this is the old rule word for word. With more, a colony
   * being knocked out does not end the match for everybody else, which is the
   * whole shape of a free-for-all.
   */
  _checkEnd() {
    const standing = [];
    const justFell = [];
    for (let t = 0; t < this.teamCount; t++) {
      if (this.nestHp[t] > 0) { standing.push(t); continue; }
      if (!this.out[t]) {
        this.out[t] = true;
        justFell.push(t);
        const n = this.map.nests[t];
        this.fx.push([FX.FALL, Math.round(n.x), Math.round(n.y), t]);
      }
    }

    if (standing.length === 1 && this.teamCount > 1) {
      this.over = true;
      this.winner = standing[0];
      this.endReason = this.teamCount > 2 ? 'last colony standing' : 'nest destroyed';
      return;
    }
    if (standing.length === 0) {
      // everything fell together, so whoever was least far gone takes it
      this.over = true;
      let best = -1, bestHp = -Infinity;
      for (let t = 0; t < this.teamCount; t++) {
        if (this.nestHp[t] > bestHp) { bestHp = this.nestHp[t]; best = t; }
      }
      this.winner = best;
      this.endReason = 'every nest fell at once, the closest call there is';
      return;
    }
    // The match carries on without them, so they come off the board. This can
    // only be reached with three colonies or more: in a duel a nest falling has
    // already returned above, which is why no duelling number moves.
    for (const t of justFell) this._scatter(t);
    if (this.t >= TUNING.matchCap) {
      this.over = true;
      let best = -1, bestHp = -Infinity, tied = false;
      for (const t of standing) {
        if (this.nestHp[t] > bestHp) { bestHp = this.nestHp[t]; best = t; tied = false; }
        else if (this.nestHp[t] === bestHp) tied = true;
      }
      this.winner = tied ? -1 : best;
      this.endReason = 'out of time, most nest left wins';
    }
  }

  // ------------------------------------------------------------------- wire

  /** Compact per-frame state. Lane positions stay as `d`; the client re-derives x/y. */
  snapshot() {
    const s = {
      n: this.tick,
      t: Math.round(this.t * 10) / 10,
      hp: this.nestHp.map((h) => Math.round(h * 10) / 10),
      u: this.units.map((u) => [
        u.id, u.t, u.team, u.lane, Math.round(u.d * 10) / 10, Math.round(u.hp),
        (u.slowT > 0 ? 1 : 0) | (this.rallies[u.team][u.lane] > this.t ? 2 : 0)
          | (u.atk > 0 ? 4 : 0) | (u.ons > this.t ? 8 : 0)
          // WHICH WAY IT IS FACING. The client used to work this out as
          // `team === 0 ? forwards : backwards`, which is only true when there
          // are two colonies: on a ring, one colony walks out down two roads and
          // back down two others, so half its ants were drawn moonwalking. A
          // raider walking through a fallen colony's nest can also end up on a
          // road that touches neither it nor anyone it started next to, and then
          // there is nothing on the wire to derive a heading from at all.
          | (u.dir < 0 ? 16 : 0),
        u.off,
        u.lv,     // queens only; 0 on an ordinary raider
      ]),
      d: this.defs.map((d) => [d.id, d.t, d.team, d.pad, Math.round(d.hp), d.atk > 0 ? 1 : 0, d.owner]),
      w: this.walls.map((w) => [w.id, w.team, w.lane, Math.round(w.d), Math.round(w.hp)]),
      b: this.wild.map((w) => [w.id, w.t, w.lane, Math.round(w.d * 10) / 10, Math.round(w.hp), w.dir]),
      fd: [Math.round(this.foodHold * 100) / 100, this.foodOwner, this.foodLead],
      ph: this.pher.map((row) => row.map((v) => Math.round(v * 100) / 100)),
      r: this.rallies.map((row) => row.map((v) => (v > this.t ? 1 : 0))),
      a: this.rains.map((row) => row.map((v) => (v > this.t ? 1 : 0))),
      p: this.players.map((p) => ({
        i: p.index, s: Math.floor(p.sugar), r: Math.round(this.incomeRate(p) * 10) / 10,
        e: Math.round(Math.min(TUNING.ecoCap, p.eco) * 10) / 10,
        u: { ...p.castes },
        c: { rally: Math.ceil(p.powerCd.rally), acidrain: Math.ceil(p.powerCd.acidrain), barricade: Math.ceil(p.powerCd.barricade) },
        k: p.kills, on: p.connected, mk: Math.max(0, Math.round(p.markCd * 10) / 10),
        // the queen: level, progress to the next rung, whether she is out, how
        // long until she can walk again, and her ability's cooldown
        h: {
          q: p.queen,
          lv: p.heroLevel,
          xp: Math.round(p.heroXp),
          nx: xpNeeded(p.heroLevel),
          out: !!this.heroOf(p.index),
          bought: p.heroBought,
          dead: Math.max(0, Math.ceil(p.heroDeadUntil - this.t)),
          cd: Math.ceil(p.abilityCd),
        },
      })),
      fx: this.fx,
      over: this.over, win: this.winner, why: this.endReason,
    };
    this.fx = [];
    return s;
  }

  /** Everything a joining or reconnecting client needs before snapshots make sense. */
  fullState() {
    return {
      mode: this.mode,
      map: this.map.id,
      seed: this.seed,
      colors: this.colors,
      teams: this.teamCount,
      wildlife: this.wildlifeOn,
      players: this.players.map((p) => ({
        i: p.index, id: p.id, name: p.name, team: p.team, bot: p.bot,
        pads: p.padIdx, roster: p.roster, queen: p.queen, color: p.color,
      })),
      snap: this.snapshot(),
    };
  }
}

export {
  RAIDERS, DEFENDERS, POWERS, RAIDER_IDS, DEFENDER_IDS, POWER_IDS, WILD_IDS,
  WORLD_W, LOADOUT_SIZE, QUEENS, QUEEN_IDS, HERO, POP_WILD,
};
