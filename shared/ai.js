// ===== The other colony — a bot that plays with the same commands a human does =====
// It has no privileged access: it reads sim state and calls sim.command(), so a
// bot match is a real match. Used for solo, for co-op's opponent, and as the
// tuning harness in test/.

import { distToPath, dist, mulberry32 } from './util.js';
import { RAIDERS, DEFENDERS, POWERS, RAIDER_IDS, LOADOUT_SIZE, CASTES, CASTE_TIERS } from './data/units.js';
import { FOOD, PHEROMONE } from './data/board.js';
import { HERO, QUEENS, QUEEN_IDS } from './data/heroes.js';

// `eco` is how long the bot keeps buying cheap raiders purely to grow income
// before it starts pushing for damage. A bot that never ecos gets out-earned and
// loses on resources long before it loses on the board.
const LEVELS = {
  easy:   { think: 1.6,  maxDefs: 2, pushAt: 380, powers: ['acidrain'], greed: 0.25, tech: 0.3, ecoUntil: 40,  ecoTarget: 6 },
  normal: { think: 0.95, maxDefs: 3, pushAt: 520, powers: ['acidrain', 'rally', 'barricade'], greed: 0.5, tech: 0.6, ecoUntil: 110, ecoTarget: 14 },
  hard:   { think: 0.55, maxDefs: 4, pushAt: 620, powers: ['acidrain', 'rally', 'barricade'], greed: 0.7, tech: 0.95, ecoUntil: 150, ecoTarget: 22 },
  coop:   { think: 0.5,  maxDefs: 4, pushAt: 700, powers: ['acidrain', 'rally', 'barricade'], greed: 0.8, tech: 1.0, ecoUntil: 150, ecoTarget: 24 },
};

// Opening build order, then it improvises. Cheap wall first, teeth second.
const OPENING = ['worker', 'trapjaw', 'honeypot', 'weaver', 'archer', 'beacon'];

/**
 * A roster the bot can actually play: something cheap to eco with, a body to
 * lead a push, and a gun to answer pads. The rest is flavour, so two bot matches
 * are not identical.
 */
export function botLoadout(rand = Math.random) {
  const must = ['worker', 'trapjaw', 'archer'];
  const rest = RAIDER_IDS.filter((k) => !must.includes(k));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...must, ...rest].slice(0, LOADOUT_SIZE);
}

/** Any of the four, so two bot matches do not field the same queen. */
export function botQueen(rand = Math.random) {
  return QUEEN_IDS[Math.floor(rand() * QUEEN_IDS.length) % QUEEN_IDS.length];
}

export class AiBrain {
  constructor(sim, playerId, difficulty = 'normal') {
    this.sim = sim;
    this.id = playerId;
    this.level = LEVELS[difficulty] || LEVELS.normal;
    this.name = difficulty;
    // Its OWN random stream. Two brains sharing sim.rand() interleave their
    // draws, so whichever one is updated first each tick gets a systematically
    // different sequence: in the harness that was worth an 11-of-14 win rate.
    let h = 2166136261;
    for (const ch of String(playerId)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    this.rand = mulberry32(((sim.seed ^ h) >>> 0));
    // Stagger when it thinks. Two brains with identical think timers both
    // starting at zero act on exactly the same ticks for the whole match, so
    // whichever is updated second always decides with the other's move already
    // on the board. That single free look was worth 11 wins in 14.
    this.acc = this.rand() * this.level.think;
    this.pushLane = 1;
    this.pushUntil = 0;
    this.built = 0;
  }

  get me() { return this.sim.playerById(this.id); }
  /** Only ever consider ants this colony actually packed. */
  has(k) { return this.me?.roster.includes(k); }
  get map() { return this.sim.map; }
  get lanes() { return this.sim.map.lanes.length; }

  update(dt) {
    if (this.sim.over) return;
    this.acc += dt;
    if (this.acc < this.level.think) return;
    this.acc = 0;
    const me = this.me;
    if (!me) return;
    this._defend(me);
    this._cast(me);
    this._buyCaste(me);
    this._queen(me);
    this._scent(me);
    this._attack(me);
  }

  /**
   * The queen. Walk her out once she is affordable without starving the push,
   * send her wherever the fighting is, and fire her ability when it will land on
   * something. Without this the bot never fields one and the balance harness
   * measures a game the bot is playing a piece short.
   */
  _queen(me) {
    const hero = this.sim.heroOf(me.index);
    if (!hero) {
      if (this.sim.t < me.heroDeadUntil) return;
      const cost = me.heroBought ? 0 : HERO.cost;
      // never spend the last of the bank on her: a queen with nothing walking
      // beside her is a queen fighting a whole lane by herself
      if (me.sugar < cost + 140) return;
      this.cmd({ kind: 'queen', lane: this.pushLane ?? this._weakestLane(me) });
      return;
    }
    if (me.heroLevel < HERO.abilityAt || me.abilityCd > 0) return;

    const ab = QUEENS[me.queen].ability;
    const r = ab.r || 130;
    let foes = 0, hurtFriends = 0;
    for (const u of this.sim.units) {
      if (u.hp <= 0 || dist(hero.x, hero.y, u.x, u.y) > r) continue;
      if (u.team !== me.team) foes++;
      else if (u.hp < u.maxHp * 0.7) hurtFriends++;
    }
    // Honeydew is a heal, so it wants wounded friends rather than live enemies.
    // Levy is bodies out of nothing, so it only wants somewhere to put them.
    const worth = ab.id === 'honeydew' ? hurtFriends >= 2
      : ab.id === 'levy' ? foes >= 1
      : foes >= 2;
    if (worth) this.cmd({ kind: 'ability' });
  }

  cmd(c) { return this.sim.command(this.id, c); }

  /**
   * Widen the species it leans on, once it is rich enough that another body is
   * not obviously the better buy. Without this the bot never buys an upgrade and
   * the whole mechanic goes untested by the balance harness.
   */
  _buyCaste(me) {
    if (this.level.tech < 0.5) return;
    // Upgrade whatever it actually fields, and only once it has fielded some:
    // a species it has never sent is not the one to widen.
    const counts = {};
    for (const u of this.sim.units) {
      if (u.owner !== me.index) continue;
      const k = RAIDER_IDS[u.t];
      counts[k] = (counts[k] || 0) + 1;
    }
    const pick = me.roster
      .filter((k) => (me.castes[k] || 0) < CASTE_TIERS && (counts[k] || 0) >= 2)
      .sort((a, b) => (counts[b] || 0) - (counts[a] || 0))[0];
    if (!pick) return;
    const step = CASTES[pick][me.castes[pick] || 0];
    // A flat 700 floor plus a 400 buffer sat above anything the bot ever banks,
    // so it bought 3 upgrades in 16 colonies and the mechanic went untested.
    // Scale the buffer to the purchase instead.
    if (me.sugar >= step.cost + 180) this.cmd({ kind: 'upgrade', unit: pick });
  }

  /**
   * Lay pheromone on the road it is actually pushing down. Only bothers when it
   * has a column there to speed up: marking an empty road is 30 sugar spent on
   * nothing, and it fades before the column arrives.
   */
  _scent(me) {
    if (me.markCd > 0 || me.sugar < PHEROMONE.cost + 150) return;
    const lane = this.pushLane;
    // Top the road up while there is real headroom on it. Stopping at 0.85 made
    // the bot re-mark every single think (2993 marks in 32 matches, more than it
    // bought of anything else); stopping at 0.34 made it never mark at all,
    // because a column reinforces past that within seconds.
    if (this.sim.pher[me.team][lane] > 0.62) return;
    let n = 0;
    for (const u of this.sim.units) if (u.team === me.team && u.lane === lane && u.hp > 0) n++;
    if (n >= 4) this.cmd({ kind: 'mark', lane });
  }

  // ---- how much enemy is standing in each of my lanes right now
  _pressure(team) {
    const p = new Array(this.lanes).fill(0);
    for (const u of this.sim.units) if (u.team !== team) p[u.lane] += u.hp;
    return p;
  }

  // ---- which pads still cover a lane for a given team
  _coverage(team) {
    const cov = new Array(this.lanes).fill(0);
    for (const d of this.sim.defs) {
      if (d.team !== team) continue;
      const def = DEFENDERS[Object.keys(DEFENDERS)[d.t]];
      if (!def.damage && !def.blast) continue;
      for (let l = 0; l < this.lanes; l++) {
        if (distToPath(this.map.lanes[l].path, d.x, d.y) < def.range * d.auraRange) {
          cov[l] += (def.damage || def.blast?.damage || 0) / (def.cooldown || 1);
        }
      }
    }
    return cov;
  }

  _defend(me) {
    const mine = this.sim.defs.filter((d) => d.team === me.team);
    if (mine.length >= this.level.maxDefs) return;

    // pick what to build: follow the opening, but answer real pressure first
    const have = new Set(mine.map((d) => Object.keys(DEFENDERS)[d.t]));
    let want = OPENING.find((k) => !have.has(k)) || 'worker';
    if (this.level.tech < 0.5 && (want === 'beacon' || want === 'archer')) want = 'worker';

    const pressure = this._pressure(me.team);
    const cov = this._coverage(me.team);
    // the lane with the most incoming and the least answer gets the next pad
    let bestLane = 0, bestScore = -Infinity;
    for (let l = 0; l < this.lanes; l++) {
      const s = pressure[l] * 2 + 40 - cov[l] * 6;
      if (s > bestScore) { bestScore = s; bestLane = l; }
    }

    const taken = new Set(mine.map((d) => d.pad));
    const free = me.padIdx.filter((i) => !taken.has(i));
    if (!free.length) return;
    // prefer a free pad flanking the lane that needs help
    free.sort((a, b) => {
      const pa = this.map.pads[me.team][a], pb = this.map.pads[me.team][b];
      return (pa.lane === bestLane ? 0 : 1) - (pb.lane === bestLane ? 0 : 1);
    });

    const cost = DEFENDERS[want].cost;
    // don't spend the whole bank on a pad when a push is landing
    if (me.sugar < cost) return;
    if (me.sugar < cost + 120 && pressure[bestLane] < 60) return;
    this.cmd({ kind: 'build', def: want, pad: free[0] });
    this.built++;
  }

  _cast(me) {
    for (const key of this.level.powers) {
      if (me.powerCd[key] > 0 || me.sugar < POWERS[key].cost + 80) continue;

      if (key === 'acidrain') {
        // rain on whichever lane has the fattest enemy stack in my half
        let best = -1, bestN = 0;
        for (let l = 0; l < this.lanes; l++) {
          let n = 0;
          for (const u of this.sim.units) {
            if (u.team === me.team || u.lane !== l) continue;
            const half = me.team === 0 ? u.d < this.map.laneLen[l] * 0.55 : u.d > this.map.laneLen[l] * 0.45;
            if (half) n++;
          }
          if (n > bestN) { bestN = n; best = l; }
        }
        if (best >= 0 && bestN >= 4) this.cmd({ kind: 'power', power: 'acidrain', lane: best });

      } else if (key === 'rally') {
        // push the lane where my own column is deepest into their half
        let best = -1, bestN = 0;
        for (let l = 0; l < this.lanes; l++) {
          let n = 0;
          for (const u of this.sim.units) {
            if (u.team !== me.team || u.lane !== l) continue;
            const deep = me.team === 0 ? u.d > this.map.laneLen[l] * 0.45 : u.d < this.map.laneLen[l] * 0.55;
            if (deep) n++;
          }
          if (n > bestN) { bestN = n; best = l; }
        }
        if (best >= 0 && bestN >= 3) this.cmd({ kind: 'power', power: 'rally', lane: best });

      } else if (key === 'barricade') {
        const pressure = this._pressure(me.team);
        const worst = pressure.indexOf(Math.max(...pressure));
        const hasWall = this.sim.walls.some((w) => w.team === me.team && w.lane === worst);
        if (!hasWall && pressure[worst] > 180) this.cmd({ kind: 'power', power: 'barricade', lane: worst });
      }
    }
  }

  _attack(me) {
    // Early on, raid for the income rather than the damage: the cheapest ants
    // buy the most eco per sugar, and that compounds for the rest of the match.
    if (this.sim.t < this.level.ecoUntil && me.eco < this.level.ecoTarget) {
      const lane = this._weakestLane(me);
      // cheapest eco per sugar first, but only out of what it packed
      const ecoPicks = me.roster
        .filter((k) => me.sugar >= RAIDERS[k].cost)
        .sort((a, b) => (RAIDERS[b].eco / RAIDERS[b].cost) - (RAIDERS[a].eco / RAIDERS[a].cost));
      if (ecoPicks.length) this.cmd({ kind: 'send', unit: ecoPicks[0], lane });
      return;
    }
    // bank until a push is affordable, then commit the bank into one lane
    if (this.sim.t < this.pushUntil) {
      this._sendNext(me);
      return;
    }
    if (me.sugar < this.level.pushAt) {
      // trickle chaff so the enemy is never entirely free to build
      if (me.sugar > this.level.pushAt * 0.55 && this.rand() < this.level.greed * 0.4) {
        this.cmd({ kind: 'send', unit: 'worker', lane: this._weakestLane(me) });
      }
      return;
    }
    // if the herd is being taken off it, push through the herd instead
    this.pushLane = (this.sim.foodOwner === 1 - me.team)
      ? this._foodLane()
      : this._weakestLane(me);
    this.pushUntil = this.sim.t + 6;
    this._sendNext(me);
  }

  /**
   * The lane that runs closest to the aphid herd. Losing the herd is worth about
   * as much as a Honeypot, so the bot will not simply ignore it.
   */
  _foodLane() {
    let best = 0, bestD = Infinity;
    for (let l = 0; l < this.lanes; l++) {
      const path = this.map.lanes[l].path;
      const d = distToPath(path, FOOD.x, FOOD.y);
      if (d < bestD) { bestD = d; best = l; }
    }
    return best;
  }

  /** The enemy lane with the least gun pointed at it and the least traffic. */
  _weakestLane(me) {
    const foe = 1 - me.team;
    const cov = this._coverage(foe);
    const traffic = new Array(this.lanes).fill(0);
    for (const u of this.sim.units) if (u.team === foe) traffic[u.lane] += u.hp;
    let best = (this.lanes / 2) | 0, bestScore = Infinity;
    for (let l = 0; l < this.lanes; l++) {
      const wall = this.sim.walls.some((w) => w.team === foe && w.lane === l) ? 90 : 0;
      const s = cov[l] * 8 + traffic[l] * 0.6 + wall;
      if (s < bestScore) { bestScore = s; best = l; }
    }
    return best;
  }

  /**
   * One purchase per think while a push is live: a body to soak, guns to answer
   * the pads, chaff to fill. It will hold sugar for the item it actually wants
   * rather than always defaulting to the cheapest thing it can afford — without
   * that patience the bot buys nothing but Workers and never exercises the roster.
   */
  _sendNext(me) {
    const lane = this.pushLane;
    const foe = 1 - me.team;
    const cov = this._coverage(foe)[lane];
    const mine = this.sim.units.filter((u) => u.team === me.team && u.lane === lane);
    const roles = { front: 0, gun: 0, chaff: 0 };
    for (const u of mine) {
      const k = Object.keys(RAIDERS)[u.t];
      if (k === 'trapjaw' || k === 'majoress') roles.front++;
      else if (k === 'archer' || k === 'weaver' || k === 'exploder') roles.gun++;
      else roles.chaff++;
    }

    const wish = [];
    // a wave wants something big in front to absorb the pads
    if (roles.front < 1) wish.push(me.sugar > 780 && this.level.tech >= 0.55 ? 'majoress' : 'trapjaw');
    // a defended lane needs blast and range before it needs more bodies
    if (cov > 14 && this.level.tech > 0.4 && roles.gun < 1) wish.push('exploder');
    if (roles.gun < 2) wish.push('archer');
    if (this.level.tech > 0.5 && roles.gun < 3) wish.push('weaver');
    if (roles.front < 2) wish.push('trapjaw');
    wish.push('army', 'worker');

    const packed = wish.filter((k) => this.has(k));
    for (let i = 0; i < packed.length; i++) {
      const k = packed[i];
      const cost = RAIDERS[k].cost;
      if (me.sugar >= cost) { this.cmd({ kind: 'send', unit: k, lane }); return; }
      // close to affording the thing it wants? hold the sugar this think instead
      // of spending it on chaff and never reaching the top of the list.
      if (i < 2 && me.sugar > cost * 0.6) return;
    }
  }
}
