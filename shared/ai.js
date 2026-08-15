// ===== The other colony — a bot that plays with the same commands a human does =====
// It has no privileged access: it reads sim state and calls sim.command(), so a
// bot match is a real match. Used for solo, for co-op's opponent, and as the
// tuning harness in test/.

import { distToPath, dist, mulberry32 } from './util.js';
import {
  RAIDERS, DEFENDERS, POWERS, RAIDER_IDS, DEFENDER_IDS, LOADOUT_SIZE, CASTES, CASTE_TIERS,
} from './data/units.js';
import { PHEROMONE } from './data/board.js';
import { HERO, QUEENS, QUEEN_IDS } from './data/heroes.js';

// `eco` is how long the bot keeps buying cheap raiders purely to grow income
// before it starts pushing for damage. A bot that never ecos gets out-earned and
// loses on resources long before it loses on the board.
const LEVELS = {
  easy:   { think: 1.6,  maxDefs: 2, pushAt: 380, powers: ['acidrain'], greed: 0.25, tech: 0.3, ecoUntil: 40,  ecoTarget: 6 },
  normal: { think: 0.95, maxDefs: 3, pushAt: 520, powers: ['acidrain', 'rally', 'barricade'], greed: 0.5, tech: 0.6, ecoUntil: 110, ecoTarget: 14 },
  hard:   { think: 0.55, maxDefs: 4, pushAt: 620, powers: ['acidrain', 'rally', 'barricade'], greed: 0.7, tech: 0.95, ecoUntil: 150, ecoTarget: 22 },
  // pushAt 700 -> 900 when the species signatures landed and the pair drifted
  // to 61 percent. Two levers were tried and measured: more income saturates
  // (the bot already banked 2800 unspent), and a FASTER bot made it worse, 66
  // percent, because the extra thinks went on trickle chaff rather than
  // pushes. What the deep bank actually buys is BIGGER WAVES: committing at
  // 900 turns the idle pile into columns with a Majoress at their head.
  coop:   { think: 0.5,  maxDefs: 4, pushAt: 900, powers: ['acidrain', 'rally', 'barricade'], greed: 0.8, tech: 1.0, ecoUntil: 150, ecoTarget: 24 },
};

// Opening build order, then it improvises. Cheap wall first, teeth second.
const OPENING = ['worker', 'trapjaw', 'honeypot', 'weaver', 'archer', 'beacon'];

// Every duelling board has three roads, and `maxDefs` above is how many pads
// each difficulty wants when it is holding three. A ring colony holds four.
const DUEL_ROADS = 3;

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
    this.pushUntil = 0;
    this.built = 0;
    // ONLY THE ROADS THAT RUN FROM ITS OWN NEST. On a duelling board that is
    // every lane, so nothing about a duel changes; on a ring it is four of ten
    // and the other six belong to arguments it is not part of. Every decision
    // below is made over THIS list rather than over the whole board, because
    // scoring a road you cannot walk down is how a bot picks a lane it will then
    // be refused. The list cannot change during a match: the board is fixed and
    // so is the colony a brain plays.
    // IN ITS OWN FRAME, not in board order. Every tie below breaks toward the
    // front of this list, and lane ids run round the ring rather than out from
    // any one nest, so ordering by id gave each colony a different favourite
    // direction: on a ring of four, colonies 0, 1 and 2 all opened toward the
    // same two nests and colony 3 opened toward nobody at all. It won six
    // matches in eight, on a board that is provably rotationally fair, purely
    // because the bot read the board in board order.
    //
    // Sorted by which way it walks the road (out toward the next colony round
    // first, then back toward the previous), every colony now sees the same
    // list from where it stands. On a duelling board every road runs the same
    // way for a given colony, so this leaves [0, 1, 2] exactly as it was.
    this.team = this.me?.team ?? 0;
    this.myLanes = this.map.lanesFor(this.team)
      .sort((a, b) => this.dirOn(b) - this.dirOn(a) || a - b);
    // The road it leans on until something gives it a reason to switch. Its
    // second one, which on a duelling board is the short middle lane it has
    // always opened on.
    this.pushLane = this.myLanes[Math.min(1, this.myLanes.length - 1)] ?? 0;
    // ONE PAD PER ROAD, which is what a duel already gives it: three roads in,
    // three defenders at `normal`. A ring colony has FOUR roads arriving at its
    // nest and was still building three, so a quarter of its front door had
    // nothing pointed at it and the breach rate ran at 42% where a duel runs at
    // 32%. Scaled off the duelling board's three rather than hard-coded, so the
    // easy and hard appetites keep their shape, and never more pads than it owns.
    this.maxDefs = Math.min(this.me?.padIdx.length ?? this.level.maxDefs,
      Math.round((this.level.maxDefs * this.myLanes.length) / DUEL_ROADS));
  }

  get me() { return this.sim.playerById(this.id); }
  /** Only ever consider ants this colony actually packed. */
  has(k) { return this.me?.roster.includes(k); }
  get map() { return this.sim.map; }
  get lanes() { return this.sim.map.lanes.length; }
  /** Which way this colony walks down a road: +1, -1, or 0 if it is not on it. */
  dirOn(lane) { return this.map.laneSideFor(lane, this.team); }

  /**
   * Say 'trail' instead of a lane number when the two are guaranteed to mean
   * the same road. The bot then exercises the order path a human uses on every
   * send it makes along its own trail, WITHOUT its choices changing: the
   * substitution only happens when the colony's scent declares exactly the
   * road the bot picked anyway. A fork or a faded trail falls back to numbers.
   */
  _laneArg(lane) {
    const t = this.sim.trailLanes(this.team);
    return t.length === 1 && t[0] === lane ? 'trail' : lane;
  }
  /** Whose nest is at the far end of one of its own roads. Replaces `1 - me.team`. */
  foeOn(lane) { return this.map.laneFoe(lane, this.dirOn(lane)); }

  update(dt) {
    if (this.sim.over) return;
    this.acc += dt;
    if (this.acc < this.level.think) return;
    this.acc = 0;
    const me = this.me;
    if (!me) return;
    // One read of every colony's guns per think, because a ring bot has to ask
    // about two different neighbours' pads and the old code rebuilt the whole
    // table for each question.
    this.cov = this._coverageAll();
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
    // Honeydew is a heal, so it wants wounded friends or a wounded queen.
    // Levy is bodies out of nothing, so it only wants somewhere to put them.
    // The damage abilities want A fight, not a crowd: waiting for two foes in
    // range left a third of unlocked queens sitting on a free, off-cooldown
    // ability for the whole match. One enemy in her face is reason enough.
    const worth = ab.id === 'honeydew' ? (hurtFriends >= 1 || hero.hp < hero.maxHp * 0.75)
      : foes >= 1;
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
    // any of its three most-fielded species, not strictly the top one: sorting
    // by count alone made 72 of 118 audited caste purchases Worker upgrades,
    // because the cheapest species is always the most fielded
    const ranked = me.roster
      .filter((k) => (me.castes[k] || 0) < CASTE_TIERS && (counts[k] || 0) >= 2)
      .sort((a, b) => (counts[b] || 0) - (counts[a] || 0))
      .slice(0, 3);
    const pick = ranked[Math.floor(this.rand() * ranked.length) % Math.max(1, ranked.length)];
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
    if (this.sim.pher[me.team][lane] <= 0.62) {
      let n = 0;
      for (const u of this.sim.units) if (u.team === me.team && u.lane === lane && u.hp > 0) n++;
      if (n >= 4) this.cmd({ kind: 'mark', lane });
      return;
    }
    // FORK, ring boards only, and only when the colony genuinely has two
    // fronts: the trail is committed to one neighbour and a real column of its
    // own is already walking a road to the OTHER one. Then splitting the scent
    // is describing what the colony is doing rather than a plan of its own,
    // which keeps the bot's strategy untouched while the fork path gets played.
    // A duelling board never reaches this: every road runs to the same enemy.
    if (this.myLanes.length <= 3 || me.sugar < PHEROMONE.cost + 320) return;
    const t = this.sim.trailLanes(me.team);
    if (t.length !== 1 || t[0] !== lane) return;
    for (const l of this.myLanes) {
      if (l === lane || this.foeOn(l) === this.foeOn(lane)) continue;
      let n = 0;
      for (const u of this.sim.units) if (u.team === me.team && u.lane === l && u.hp > 0) n++;
      if (n >= 4) { this.cmd({ kind: 'fork', lane: l }); return; }
    }
  }

  // ---- how much enemy is standing in each of my lanes right now
  //
  // Roads that do not touch this colony are skipped rather than scored. Only two
  // colonies can ever stand on one of ITS roads, so on its own lanes "not mine"
  // still means exactly one neighbour, the same as it always did in a duel.
  _pressure(team) {
    const p = new Array(this.lanes).fill(0);
    for (const u of this.sim.units) {
      if (u.team === team || !this.map.lanes[u.lane].ends.includes(team)) continue;
      p[u.lane] += u.hp;
    }
    return p;
  }

  /**
   * Gun pointed at every road by every colony: cov[team][lane].
   *
   * It used to be built one colony at a time, which was fine when there was only
   * ever one other colony to ask about. On a ring a bot's four roads run to TWO
   * different neighbours, so the question is per road, not per enemy.
   */
  _coverageAll() {
    const cov = Array.from({ length: this.sim.teamCount }, () => new Array(this.lanes).fill(0));
    for (const d of this.sim.defs) {
      const def = DEFENDERS[DEFENDER_IDS[d.t]];
      if (!def.damage && !def.blast) continue;
      for (let l = 0; l < this.lanes; l++) {
        if (distToPath(this.map.lanes[l].path, d.x, d.y) < def.range * d.auraRange) {
          cov[d.team][l] += (def.damage || def.blast?.damage || 0) / (def.cooldown || 1);
        }
      }
    }
    return cov;
  }

  /** This think's table, built once in update(). */
  _coverage(team) {
    return (this.cov || (this.cov = this._coverageAll()))[team]
      || new Array(this.lanes).fill(0);
  }

  /**
   * The reactive pad, from the third build on: an answer to what is coming,
   * not the next line of a list.
   *
   *   a real swarm, eight up   Mortar, whose blast is priced for exactly that
   *   three or more ranged     Archer Nest, which outranges what outranges pads
   *   three guns of mine       Beacon, whose aura then earns its slot
   *   nothing in particular    Honeypot for the income, then silk
   *
   * The thresholds are deliberately high, and the Honeypot sits ABOVE the
   * Beacon, because the first cut of this function had it the other way round:
   * the bot's first two builds are both guns, so "beacon at two guns" made the
   * aura the automatic third pad, the game's defence outgrew its income, and
   * mean match length went from 4.5 minutes to 6.0 in one measurement. The
   * reactive picks are answers to something the enemy is visibly doing, never
   * the default.
   */
  _defPick(me, mine, have) {
    // Reactive defence is for the colony being HURT. When level or ahead, the
    // third pad is the Honeypot it always was, or the game's whole pace drifts:
    // both bots answering ordinary traffic with extra guns added a minute and a
    // half to the mean match in one measurement, because an answer to nothing
    // in particular is just more defence. Behind on nest health, the tools
    // unlock, which also makes them what they should be: comeback equipment.
    let bestOther = 0;
    for (let t = 0; t < this.sim.teamCount; t++) {
      if (t !== me.team && this.sim.nestHp[t] > bestOther) bestOther = this.sim.nestHp[t];
    }
    const behind = this.sim.nestHp[me.team] + 25 < bestOther;
    if (behind) {
      let clump = 0, ranged = 0;
      const perLane = {};
      for (const u of this.sim.units) {
        if (u.team === me.team || u.hp <= 0) continue;
        if (!this.map.lanes[u.lane].ends.includes(me.team)) continue;
        perLane[u.lane] = (perLane[u.lane] || 0) + 1;
        if (clump < perLane[u.lane]) clump = perLane[u.lane];
        const k = RAIDER_IDS[u.t];
        if (k === 'archer' || k === 'weaver') ranged++;
      }
      const guns = mine.filter((d) => {
        const def = DEFENDERS[Object.keys(DEFENDERS)[d.t]];
        return def.damage || def.blast;
      }).length;
      if (!have.has('exploder') && clump >= 8) return 'exploder';
      if (!have.has('archer') && ranged >= 3) return 'archer';
      if (!have.has('beacon') && guns >= 3) return 'beacon';
    }
    if (!have.has('honeypot')) return 'honeypot';
    return OPENING.find((k) => !have.has(k)) || 'worker';
  }

  _defend(me) {
    // MINE, not my colony's, and capped by the roads that reach my nest.
    //
    // Two halves from two branches, and both are load-bearing. `d.owner` and not
    // `d.team`: a colony can hold more than one player, and two brains sharing a
    // side counted each other's pads against their own budget, so a pair filled
    // 3 of their 4 slots between them while a lone bot filled all 4. `maxDefs`
    // and not `level.maxDefs`: the level's appetite is written for the three
    // roads of a duelling board, and a ring colony has four arriving at it, so
    // holding it to three left a quarter of its front door uncovered and the
    // breach rate ran at 42 percent against a duel's 32.
    //
    // Neither changes a duel. One brain per colony makes owner and team select
    // the same defenders, and three roads make maxDefs equal level.maxDefs.
    const mine = this.sim.defs.filter((d) => d.owner === me.index);
    if (mine.length >= this.maxDefs) return;

    // The first two builds follow the opening: a cheap wall and teeth, the same
    // start every match wants. From the third pad the pick is REACTIVE, chosen
    // by what the enemy is actually doing. The old rule walked the OPENING list
    // top to bottom, and since the budget is three or four pads, the list's
    // tail was unreachable: the Mortar, the Beacon and the Archer Nest were
    // built ZERO times across the audit that tuned this game. A defender the
    // tuning bot cannot reach is a defender with no measured reason to exist.
    const have = new Set(mine.map((d) => Object.keys(DEFENDERS)[d.t]));
    let want = mine.length < 2
      ? (OPENING.find((k) => !have.has(k)) || 'worker')
      : this._defPick(me, mine, have);
    if (this.level.tech < 0.5 && (want === 'beacon' || want === 'archer')) want = 'worker';

    const pressure = this._pressure(me.team);
    const cov = this._coverage(me.team);
    // the lane with the most incoming and the least answer gets the next pad,
    // out of the roads that actually arrive at this nest
    let bestLane = this.myLanes[0] ?? 0, bestScore = -Infinity;
    for (const l of this.myLanes) {
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

      // WHICH HALF OF A ROAD IS MINE depends on which end I walk in from, not on
      // my colony number. `me.team === 0 ? near : far` was the same statement in
      // a duel, where colony 0 always starts at zero and colony 1 always starts
      // at the far end; on a ring one colony does both, on different roads.
      if (key === 'acidrain') {
        // rain on whichever lane has the fattest enemy stack in my half
        let best = -1, bestN = 0;
        for (const l of this.myLanes) {
          const L = this.map.laneLen[l], into = this.dirOn(l);
          let n = 0;
          for (const u of this.sim.units) {
            if (u.team === me.team || u.lane !== l) continue;
            const half = into > 0 ? u.d < L * 0.55 : u.d > L * 0.45;
            if (half) n++;
          }
          if (n > bestN) { bestN = n; best = l; }
        }
        if (best >= 0 && bestN >= 4) this.cmd({ kind: 'power', power: 'acidrain', lane: best });

      } else if (key === 'rally') {
        // Rally follows the trail now, so the question is not which lane but
        // whether THIS is the moment: a built trail (a weak one wastes the
        // cooldown, the surge scales with strength) and a real column already
        // deep on it. The old version scanned every lane and cast on cooldown,
        // 635 times in the audit, which is exactly the habit the redesign kills.
        const t = this.sim.trailLanes(me.team);
        if (t.length && this.sim.pher[me.team][t[0]] >= 0.75) {
          const l = t[0];
          const L = this.map.laneLen[l], into = this.dirOn(l);
          let deep = 0;
          for (const u of this.sim.units) {
            if (u.team !== me.team || u.lane !== l) continue;
            if (into > 0 ? u.d > L * 0.45 : u.d < L * 0.55) deep++;
          }
          if (deep >= 3) this.cmd({ kind: 'power', power: 'rally' });
        }

      } else if (key === 'barricade') {
        const pressure = this._pressure(me.team);
        let worst = this.myLanes[0] ?? 0;
        for (const l of this.myLanes) if (pressure[l] > pressure[worst]) worst = l;
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
      // Best eco per sugar first, but ANY of the top three, not strictly the
      // winner. With the flattened eco table the ratios sit within a few
      // percent of each other, and a strict sort re-created the exact
      // degeneracy the flattening removed: the bot bought nothing but Workers
      // through the whole eco phase because Workers win by 0.0003. A rational
      // player at these ratios buys variety for the fight it brings.
      const ranked = [...me.roster]
        .sort((a, b) => (RAIDERS[b].eco / RAIDERS[b].cost) - (RAIDERS[a].eco / RAIDERS[a].cost));
      const top = ranked.slice(0, Math.min(3, ranked.length));
      const want = top[Math.floor(this.rand() * top.length) % top.length];
      if (me.sugar >= RAIDERS[want].cost) {
        this.cmd({ kind: 'send', unit: want, lane });
      } else if (me.sugar <= RAIDERS[want].cost * 0.6) {
        // nowhere near the pick: buy the best eco it CAN afford rather than
        // stalling the opening. Close to it, hold, exactly as _sendNext does;
        // without the hold, "any of the top three" collapsed back to Workers,
        // because Workers were the only pick the purse could cover at the
        // moment the think fired.
        const afford = ranked.filter((k) => me.sugar >= RAIDERS[k].cost);
        if (afford.length) this.cmd({ kind: 'send', unit: afford[0], lane });
      }
      return;
    }
    // bank until a push is affordable, then commit the bank into one lane
    if (this.sim.t < this.pushUntil) {
      this._sendNext(me);
      return;
    }
    if (me.sugar < this.level.pushAt) {
      // trickle chaff so the enemy is never entirely free to build. Cheapest
      // PACKED unit, by rule rather than by name: with eco per sugar nearly
      // flat there is no reason the trickle must be Workers, and a hardcoded
      // 'worker' here was one of the three legs of its 62 percent send share.
      if (me.sugar > this.level.pushAt * 0.55 && this.rand() < this.level.greed * 0.4) {
        // either of the two cheapest, so the trickle is not one species' job
        const cheap = me.roster
          .filter((k) => me.sugar >= RAIDERS[k].cost)
          .sort((a, b) => RAIDERS[a].cost - RAIDERS[b].cost)
          .slice(0, 2);
        if (cheap.length) {
          this.cmd({ kind: 'send', unit: cheap[Math.floor(this.rand() * cheap.length) % cheap.length], lane: this._weakestLane(me) });
        }
      }
      return;
    }
    // if the herd is being taken off it, push through the herd instead. Anybody
    // else holding it counts, not just the one other colony there used to be.
    this.pushLane = (this.sim.foodOwner >= 0 && this.sim.foodOwner !== me.team)
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
    // The herd belongs to the MAP. It used to be read out of the tuning file as
    // a fixed (480, 320), which was the middle of the world back when every
    // board was 960x640 and is 190px off the middle of a ring board — so the bot
    // was walking toward the wrong patch of ground to contest it.
    const F = this.map.food;
    let best = this.myLanes[0] ?? 0, bestD = Infinity;
    for (const l of this.myLanes) {
      const d = distToPath(this.map.lanes[l].path, F.x, F.y);
      // A TOLERANCE, BECAUSE THE TIE IS EXACT AND THE ARITHMETIC IS NOT.
      //
      // A ring board is one wedge rotated n times, so a colony's road out and
      // its road back are the SAME distance from the herd in the middle: 142.0
      // both, on every board and for every colony. Rotated through an irrational
      // angle they come out equal to about a part in 1e13, and a bare `<` hands
      // that last bit the decision. It decided differently for different seats,
      // and this is the road a colony commits its whole push to whenever
      // somebody else is holding the herd: on a ring of five, colony 2 alone
      // read its BACKWARD road as the nearer one, spent the match pushing the
      // wrong way round the ring, and handed colony 3 an unattacked flank. That
      // one flipped bit was worth 84 wins in 200 on a board that is provably
      // rotationally fair, and it is why ring4 measured flat while 3, 5 and 6
      // did not: on four colonies nothing happened to land the wrong side.
      //
      // Anything closer than a micron is the same distance. Ties then fall to
      // the front of myLanes, which every colony reads from where it stands.
      // On a duelling board the middle lane runs THROUGH the herd and the outer
      // two are 190px further off, so no tolerance is ever in play.
      if (d < bestD - 1e-6) { bestD = d; best = l; }
    }
    return best;
  }

  /**
   * The road out with the least gun pointed at it and the least traffic on it.
   *
   * Scored per ROAD rather than per enemy: each of its roads ends at a different
   * neighbour's nest, so "how well defended is the enemy" is not one number any
   * more. Traffic is the same measurement as pressure, because the only colony
   * that can put ants on one of its roads is the one at the other end of it.
   */
  _weakestLane(me) {
    const traffic = this._pressure(me.team);
    let bestScore = Infinity;
    let tied = [];
    for (const l of this.myLanes) {
      const foe = this.foeOn(l);
      const wall = this.sim.walls.some((w) => w.team === foe && w.lane === l) ? 90 : 0;
      const s = this._coverage(foe)[l] * 8 + traffic[l] * 0.6 + wall;
      if (s < bestScore) { bestScore = s; tied = [l]; }
      else if (s === bestScore) tied.push(l);
    }
    if (tied.length < 2) return tied[0] ?? this.myLanes[0] ?? 0;
    // AN EXACT TIE ACROSS TWO DIFFERENT NEIGHBOURS is a choice of victim, not a
    // choice of road, and it is not a rare one: an empty board scores every road
    // at zero, so this is what picks the opening for the whole eco phase. Always
    // taking the first one turns the ring into a carousel where everybody chases
    // the colony on the same side of them. Where the tied roads all end at the
    // same nest — which is every tie there has ever been in a duel — nothing is
    // drawn and nothing changes.
    const foes = new Set(tied.map((l) => this.foeOn(l)));
    if (foes.size < 2) return tied[0];
    return tied[Math.floor(this.rand() * tied.length) % tied.length];
  }

  /**
   * One purchase per think while a push is live: a body to soak, guns to answer
   * the pads, chaff to fill. It will hold sugar for the item it actually wants
   * rather than always defaulting to the cheapest thing it can afford — without
   * that patience the bot buys nothing but Workers and never exercises the roster.
   */
  _sendNext(me) {
    const lane = this.pushLane;
    const cov = this._coverage(this.foeOn(lane))[lane];
    const mine = this.sim.units.filter((u) => u.team === me.team && u.lane === lane);
    const roles = { front: 0, gun: 0, chaff: 0 };
    for (const u of mine) {
      const k = Object.keys(RAIDERS)[u.t];
      if (k === 'trapjaw' || k === 'majoress') roles.front++;
      else if (k === 'archer' || k === 'weaver' || k === 'exploder') roles.gun++;
      else roles.chaff++;
    }

    const wish = [];
    // a wave wants something big in front to absorb the pads. The Majoress gate
    // used to be a flat 780, which the normal bot banks past so rarely that she
    // was sent ONCE in a 24-match audit; scaled to her price it fires whenever
    // a real push can afford the big front instead of the cheap one.
    if (roles.front < 1) {
      wish.push(me.sugar > RAIDERS.majoress.cost + 180 && this.level.tech >= 0.55 ? 'majoress' : 'trapjaw');
    }
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
      if (me.sugar >= cost) { this.cmd({ kind: 'send', unit: k, lane: this._laneArg(lane) }); return; }
      // close to affording the thing it wants? hold the sugar this think instead
      // of spending it on chaff and never reaching the top of the list.
      if (i < 2 && me.sugar > cost * 0.6) return;
    }
  }
}
