import test from 'node:test';
import assert from 'node:assert/strict';

import { Sim } from '../shared/sim.js';
import { AiBrain, botLoadout } from '../shared/ai.js';
import { buildMap } from '../shared/map.js';
import {
  DT, TUNING, WORLD_W, WORLD_H, PHEROMONE,
  COLONY_COLORS, DEFAULT_COLORS, isColor, cleanColor, resolveColors,
} from '../shared/data/board.js';
import { EMOTES, isEmote } from '../shared/data/emotes.js';
import { MAPS, DEFAULT_MAP } from '../shared/data/maps.js';
import { RING_SIZES } from '../shared/data/ring.js';
import { RAIDERS, DEFENDERS, POWERS, RAIDER_IDS, LOADOUT_SIZE, cleanLoadout, DEFAULT_LOADOUT } from '../shared/data/units.js';
import { QUEENS, QUEEN_IDS, HERO, cleanQueen, queenStats, DEFAULT_QUEEN } from '../shared/data/heroes.js';

const duel = (opts = {}) => new Sim({
  mode: 'versus', seed: 7, wildlife: false,
  players: [{ id: 'A', name: 'A', team: 0 }, { id: 'B', name: 'B', team: 1 }],
  ...opts,
});
const run = (sim, seconds) => { for (let i = 0; i < seconds * 30; i++) sim.step(DT); };
/** Starting sugar is 260 — anything testing an expensive unit has to bankroll it. */
const fund = (sim, ...ids) => { for (const id of ids) sim.playerById(id).sugar = 20000; return sim; };
/**
 * A colony only packs five of the seven ants. Tests that are about combat rather
 * than about the loadout rule hand everybody the whole roster, so a refusal is
 * never the reason a combat assertion fails. The loadout rule has its own test.
 */
const packAll = (sim) => { for (const p of sim.players) p.roster = [...RAIDER_IDS]; return sim; };

// ------------------------------------------------------------------ fairness

// Fairness is checked on EVERY map, not just the default one. Adding a map is
// the easiest way to reintroduce the bug where one colony has a shorter walk.
for (const M of MAPS) {
  test(`${M.name}: every lane is its own mirror image`, () => {
    for (const L of M.lanes) {
      const p = L.points;
      for (let i = 0; i < p.length; i++) {
        const j = p.length - 1 - i;
        assert.equal(WORLD_W - p[j][0], p[i][0], `${M.id} lane point ${i} x`);
        assert.equal(p[j][1], p[i][1], `${M.id} lane point ${i} y`);
      }
    }
  });

  test(`${M.name}: pads mirror, keep their lane, and reach the same distance`, () => {
    const map = buildMap(M.id);
    for (let i = 0; i < map.pads[0].length; i++) {
      const a = map.pads[0][i], b = map.pads[1][i];
      assert.equal(b.x, WORLD_W - a.x);
      assert.equal(b.y, a.y);
      assert.equal(b.lane, a.lane);
      assert.equal(b.rangeMul, a.rangeMul, 'one side of the board sees further');
    }
  });

  test(`${M.name}: the same script from both sides ends dead level`, () => {
    const map = buildMap(M.id);
    const sim = duel({ map: M.id });
    for (let i = 0; i < 200 * 30; i++) {
      if (i % 90 === 0) {
        const lane = (i / 90) % map.lanes.length;
        sim.command('A', { kind: 'send', unit: 'worker', lane });
        sim.command('B', { kind: 'send', unit: 'worker', lane });
      }
      sim.step(DT);
      sim.fx.length = 0;
    }
    assert.equal(sim.nestHp[0], sim.nestHp[1], 'nests took different damage');
    assert.equal(
      sim.units.filter((u) => u.team === 0).length,
      sim.units.filter((u) => u.team === 1).length,
      'one side has more survivors',
    );
  });

  // The queen is the only unit that stops somewhere other than a nest, so her
  // halt line is a new way for a board to favour one colony. It is derived from
  // laneLen, which means it is only fair if the lane is its own mirror image.
  test(`${M.name}: both queens halt on exactly the same spot`, () => {
    const map = buildMap(M.id);
    for (let lane = 0; lane < map.lanes.length; lane++) {
      let sim0 = null;
      const held = [0, 1].map((team) => {
        // one at a time, or they meet in the middle and fight instead of halting
        const sim = duel({ map: M.id });
        const me = team === 0 ? 'A' : 'B';
        sim.playerById(me).sugar = 9999;
        assert.equal(sim.command(me, { kind: 'queen', lane }).ok, true);
        run(sim, 150);
        const h = sim.heroOf(sim.playerById(me).index);
        assert.ok(h, `${M.id} lane ${lane}: team ${team}'s queen did not survive the walk`);
        if (team === 0) sim0 = sim;
        return h;
      });
      // to a tolerance, not to the bit: both halt lines are derived by walking
      // the path from opposite ends, so they carry the same rounding the
      // crossing-time test above already allows for. 1e-9 of a 960px board.
      assert.ok(Math.abs(held[0].x + held[1].x - WORLD_W) < 1e-9, `${M.id} lane ${lane} halt x: ${held[0].x} + ${held[1].x}`);
      assert.ok(Math.abs(held[0].y - held[1].y) < 1e-9, `${M.id} lane ${lane} halt y`);
      assert.equal(sim0.nestHp[1], TUNING.nestHp, `${M.id} lane ${lane}: a queen bit the nest`);
    }
  });

  // The sideways fan is what stops a push reading as a conga line, and it also
  // decides x/y, which is what map.slowAt() reads. Get it wrong and two colonies
  // running the same script wade through a hazard at different times. It used to
  // come off the global nextId, so colony A's k-th ant and colony B's k-th ant
  // got unrelated offsets, and a single worker per side drifted ELEVEN PIXELS
  // apart on the two boards that have hazards. The existing suite missed it
  // because it only checked the boards, never two ants walking.
  test(`${M.name}: one worker per side stays mirrored the whole way down`, () => {
    const map = buildMap(M.id);
    for (let lane = 0; lane < map.lanes.length; lane++) {
      const sim = duel({ map: M.id });
      for (const id of ['A', 'B']) sim.playerById(id).sugar = 9999;
      sim.command('A', { kind: 'send', unit: 'worker', lane });
      sim.command('B', { kind: 'send', unit: 'worker', lane });
      const L = map.laneLen[lane];
      let worst = 0;
      for (let i = 0; i < 60 * 30; i++) {
        sim.step(DT);
        sim.fx.length = 0;
        const a = sim.units.filter((u) => u.team === 0).map((u) => u.d).sort((x, y) => x - y);
        const b = sim.units.filter((u) => u.team === 1).map((u) => L - u.d).sort((x, y) => x - y);
        if (!a.length || !b.length) break;
        for (let k = 0; k < Math.min(a.length, b.length); k++) worst = Math.max(worst, Math.abs(a[k] - b[k]));
      }
      // float noise from walking the path from opposite ends, nothing more
      assert.ok(worst < 1e-6, `${M.id} lane ${lane}: the two sides drifted ${worst.toFixed(4)}px apart`);
    }
  });

  test(`${M.name}: a raider crosses in the same time from either end`, () => {
    const map = buildMap(M.id);
    for (let lane = 0; lane < map.lanes.length; lane++) {
      const times = [0, 1].map((team) => {
        const sim = duel({ map: M.id });
        sim.command(team === 0 ? 'A' : 'B', { kind: 'send', unit: 'worker', lane });
        const foe = 1 - team;
        let t = 0;
        while (t < 160 && sim.nestHp[foe] === TUNING.nestHp) { sim.step(DT); sim.fx.length = 0; t += DT; }
        return t;
      });
      assert.equal(times[0].toFixed(4), times[1].toFixed(4), `${M.id} lane ${lane} favours one side`);
    }
  });
}

// These find a board by what it does, not by its id, so renaming a map does not
// silently turn a feature test into a no-op.
const builtMaps = MAPS.map((m) => buildMap(m.id));
const mapWith = (fn, what) => {
  const m = builtMaps.find(fn);
  assert.ok(m, `no map has ${what}, so nothing is testing it`);
  return m;
};

test('a hazard slows a raider crossing it, and only there', () => {
  const wet = mapWith((m) => m.hazards.length > 0, 'a hazard');
  const clear = mapWith((m) => m.hazards.length === 0, 'clear ground');
  const h = wet.hazards[0];
  assert.ok(wet.slowAt(h.x, h.y) < 1, 'standing in water should slow you');
  assert.equal(wet.slowAt(4, 4), 1, 'dry ground should not');
  assert.equal(clear.slowAt(h.x, h.y), 1, 'a map with no hazards slows nobody');
});

test('high ground reaches further, the dark reaches less, and it survives the build', () => {
  const hill = mapWith((m) => m.pads[0].some((p) => p.rangeMul > 1), 'high ground');
  const dark = mapWith((m) => m.pads[0].some((p) => p.rangeMul < 1), 'unlit pads');
  assert.ok(dark.dark, 'the unlit board should say why it is unlit');
  const boosted = hill.pads[0].find((p) => p.rangeMul > 1);
  const sim = duel({ map: hill.id });
  sim.playerById('A').sugar = 9999;
  sim.command('A', { kind: 'build', def: 'worker', pad: boosted.i });
  assert.equal(sim.defs[0].auraRange, boosted.rangeMul);
});

test('both worlds are represented, and every map declares which it is', () => {
  const worlds = new Set(MAPS.map((m) => m.world));
  assert.ok(worlds.has('Forest floor'), 'no surface board');
  assert.ok(worlds.has('Underground'), 'no underground board');
  for (const m of MAPS) assert.ok(m.theme && m.world && m.blurb && m.note, `${m.id} is missing its copy`);
});

// ------------------------------------------------------------------- economy

test('sugar accrues at the advertised rate and purchases deduct exactly', () => {
  const sim = duel();
  const p = sim.playerById('A');
  assert.equal(p.sugar, TUNING.startSugar);
  const rate0 = sim.incomeRate(p);
  assert.equal(rate0, TUNING.incomeBase);
  run(sim, 10);
  // income ramps while it accrues, so check the integral rather than rate*t
  assert.ok(p.sugar > TUNING.startSugar + TUNING.incomeBase * 10 * 0.99, 'income too slow');
  assert.ok(p.sugar < TUNING.startSugar + (TUNING.incomeBase + 1) * 10 * 1.02, 'income too fast');

  const before = p.sugar;
  assert.deepEqual(sim.command('A', { kind: 'send', unit: 'trapjaw', lane: 0 }), { ok: true });
  assert.equal(Math.round(before - p.sugar), RAIDERS.trapjaw.cost);
});

test('a honeypot adds its income to the colony that built it, and nobody else', () => {
  const sim = duel();
  const a = sim.playerById('A'), b = sim.playerById('B');
  const rateBefore = sim.incomeRate(a);
  sim.command('A', { kind: 'build', def: 'honeypot', pad: 0 });
  assert.equal(sim.incomeRate(a) - rateBefore, DEFENDERS.honeypot.income);
  assert.equal(sim.incomeRate(b), rateBefore);
});

test('income stops climbing at the cap', () => {
  const sim = duel();
  run(sim, 400);
  assert.equal(sim.incomeRate(sim.playerById('A')), TUNING.incomeCap);
});

// ------------------------------------------------------------------- combat

test('a raider that reaches the enemy nest deals exactly its siege damage', () => {
  for (const id of Object.keys(RAIDERS)) {
    const sim = packAll(fund(duel(), 'A'));
    assert.equal(sim.command('A', { kind: 'send', unit: id, lane: 1 }).ok, true, `could not buy ${id}`);
    let t = 0;
    while (t < 200 && sim.nestHp[1] === TUNING.nestHp) { sim.step(DT); sim.fx.length = 0; t += DT; }
    const dealt = TUNING.nestHp - sim.nestHp[1];
    const expect = RAIDERS[id].siege;
    assert.ok(Math.abs(dealt - expect) < 0.001, `${id} dealt ${dealt}, expected ${expect}`);
  }
});

test('melee raiders run past pads; ranged and siege raiders stop to break them', () => {
  const check = (id) => {
    const sim = packAll(fund(duel(), 'A', 'B'));
    sim.command('B', { kind: 'build', def: 'worker', pad: 0 });
    sim.command('A', { kind: 'send', unit: id, lane: 1 });
    run(sim, 45);
    return sim.defs.length === 0; // did the pad get destroyed
  };
  assert.equal(check('worker'), false, 'a Worker should have walked past the pad');
  assert.equal(check('archer'), true, 'an Archer should have shot the pad down');
});

test('a kill is credited to whoever did the most damage', () => {
  const sim = fund(duel(), 'A', 'B');
  assert.equal(sim.command('B', { kind: 'build', def: 'archer', pad: 1 }).ok, true);
  assert.equal(sim.command('B', { kind: 'build', def: 'archer', pad: 2 }).ok, true);
  const b = sim.playerById('B');
  assert.equal(b.kills, 0);
  sim.command('A', { kind: 'send', unit: 'worker', lane: 1 });
  run(sim, 40);
  assert.ok(b.kills > 0, 'defenders killed raiders but nobody was credited');
});

test('majoress armour blunts each hit rather than the tick total', () => {
  const sim = packAll(fund(duel(), 'A'));
  sim.command('A', { kind: 'send', unit: 'majoress', lane: 1 });
  const m = sim.units[0];
  const hit = DEFENDERS.worker.damage;
  sim._dmg = new Map();
  sim._damage(m, hit, 1);
  sim._damage(m, hit, 1);
  sim._applyDamage();
  assert.equal(m.maxHp - m.hp, (hit - RAIDERS.majoress.armor) * 2);
});

test('acid rain hits the enemy in that lane and nobody else', () => {
  const sim = packAll(fund(duel(), 'A', 'B'));
  sim.command('A', { kind: 'send', unit: 'trapjaw', lane: 0 });
  sim.command('B', { kind: 'send', unit: 'trapjaw', lane: 0 });
  sim.command('B', { kind: 'send', unit: 'trapjaw', lane: 2 });
  sim.command('A', { kind: 'power', power: 'acidrain', lane: 0 });
  run(sim, POWERS.acidrain.duration);
  const mine = sim.units.find((u) => u.team === 0);
  const theirsHit = sim.units.find((u) => u.team === 1 && u.lane === 0);
  const theirsSafe = sim.units.find((u) => u.team === 1 && u.lane === 2);
  assert.equal(mine.hp, mine.maxHp, 'the caster damaged their own ants');
  assert.equal(theirsSafe.hp, theirsSafe.maxHp, 'a different lane took damage');
  assert.ok(theirsHit.hp < theirsHit.maxHp, 'the targeted lane took nothing');
});

// -------------------------------------------------------------- the queen

test('a queen holds at the gate and never touches a nest', () => {
  for (const q of QUEEN_IDS) {
    const sim = duel({ players: [{ id: 'A', name: 'A', team: 0, queen: q }, { id: 'B', name: 'B', team: 1 }] });
    sim.playerById('A').sugar = 9999;
    assert.equal(sim.command('A', { kind: 'queen', lane: 1 }).ok, true, q);
    run(sim, 200);
    assert.ok(sim.heroOf(0), `${q} did not survive an empty lane`);
    assert.equal(sim.nestHp[1], TUNING.nestHp, `${q} bit the nest`);
    const L = sim.map.laneLen[1];
    assert.ok(Math.abs(sim.heroOf(0).d - L * HERO.haltAt) < 0.001, `${q} stopped in the wrong place`);
  }
});

test('two identical queens meeting head-on destroy each other exactly', () => {
  // If one survives, the side that happens to sit first in the units array is
  // landing a free blow, and every queen fight on the board is decided by that.
  for (const q of QUEEN_IDS) {
    const sim = duel({
      players: [{ id: 'A', name: 'A', team: 0, queen: q }, { id: 'B', name: 'B', team: 1, queen: q }],
    });
    for (const id of ['A', 'B']) sim.playerById(id).sugar = 9999;
    sim.command('A', { kind: 'queen', lane: 0 });
    sim.command('B', { kind: 'queen', lane: 0 });
    run(sim, 200);
    assert.equal(!!sim.heroOf(0), !!sim.heroOf(1), `${q}: one queen outlived the other`);
    assert.equal(sim.playerById('A').heroFalls, sim.playerById('B').heroFalls, `${q}: uneven losses`);
    assert.equal(sim.playerById('A').heroXp, sim.playerById('B').heroXp, `${q}: uneven experience`);
  }
});

test('a queen is never a cork in her own lane', () => {
  // She halts partway down the road and stays there. If she is part of the
  // column-separation chain, every raider her colony sends queues up behind her
  // and NOTHING that colony sends ever reaches a nest again. Two browsers
  // deadlocked on this at 190/206 with 110 ants alive and 54 of one side's 55
  // stacked behind its own queen. Every harness missed it: mapcheck's script is
  // symmetric so a stall still ends "dead level", and the balance run read the
  // slowdown as attrition.
  for (const q of QUEEN_IDS) {
    const sim = packAll(fund(duel({
      players: [{ id: 'A', name: 'A', team: 0, queen: q }, { id: 'B', name: 'B', team: 1 }],
    }), 'A'));
    assert.equal(sim.command('A', { kind: 'queen', lane: 1 }).ok, true);
    run(sim, 25);                       // let her get to the halt line first
    const hero = sim.heroOf(0);
    assert.ok(hero, `${q} did not survive an empty lane`);
    for (let i = 0; i < 8; i++) sim.command('A', { kind: 'send', unit: 'worker', lane: 1 });
    run(sim, 90);
    assert.ok(sim.nestHp[1] < TUNING.nestHp,
      `${q} blocked her own colony: nothing got past her in 90 seconds`);
    // and specifically: raiders got PAST her, they did not pile up behind
    const live = sim.heroOf(0);
    if (live) {
      const stuck = sim.units.filter((u) => u.kind !== 'h' && u.team === 0 && u.lane === 1 && u.d < live.d);
      assert.ok(stuck.length <= 2, `${q} has ${stuck.length} of her own ants queued behind her`);
    }
  }
});

test('a queen levels on kills she helped land, and keeps it through death', () => {
  const sim = duel({
    players: [{ id: 'A', name: 'A', team: 0, queen: 'formica' }, { id: 'B', name: 'B', team: 1 }],
  });
  const a = sim.playerById('A'), b = sim.playerById('B');
  packAll(sim);
  a.sugar = 9999;
  sim.command('A', { kind: 'queen', lane: 1 });
  assert.equal(a.heroLevel, 1);
  // drip bodies into her lane and let her eat them
  for (let i = 0; i < 40 && a.heroLevel < 2 && !sim.over; i++) {
    b.sugar = 9999;
    sim.command('B', { kind: 'send', unit: 'worker', lane: 1 });
    run(sim, 4);
    sim.fx.length = 0;
  }
  assert.ok(a.heroLevel >= 2, `she never levelled (xp ${a.heroXp})`);
  const grown = queenStats('formica', a.heroLevel);
  assert.ok(grown.hp > QUEENS.formica.hp, 'a level did not make her bigger');

  // kill her and check the level survives, the respawn waits, and it is free
  const level = a.heroLevel;
  const h = sim.heroOf(0);
  h.hp = 0;
  sim.step(DT);
  assert.equal(sim.heroOf(0), null);
  assert.equal(a.heroLevel, level, 'she forgot her levels when she died');
  assert.match(sim.command('A', { kind: 'queen', lane: 1 }).why, /recovering/);
  const purse = a.sugar;
  sim.t = a.heroDeadUntil;
  assert.equal(sim.command('A', { kind: 'queen', lane: 1 }).ok, true);
  assert.equal(a.sugar, purse, 'coming back should be free');
  assert.equal(sim.heroOf(0).lv, level, 'she came back smaller than she died');
});

test('her ability is locked until level 3, then costs a cooldown and nothing else', () => {
  const sim = duel({ players: [{ id: 'A', name: 'A', team: 0, queen: 'melissa' }] });
  const a = sim.playerById('A');
  a.sugar = 9999;
  assert.match(sim.command('A', { kind: 'ability' }).why, /not on the board/);
  sim.command('A', { kind: 'queen', lane: 1 });
  assert.match(sim.command('A', { kind: 'ability' }).why, new RegExp(`level ${HERO.abilityAt}`));
  a.heroLevel = HERO.abilityAt;
  const purse = a.sugar;
  assert.equal(sim.command('A', { kind: 'ability' }).ok, true);
  assert.match(sim.command('A', { kind: 'ability' }).why, /recharging/);
  // Honeydew pays the colony, so this one purse should have gone UP
  assert.equal(a.sugar, purse + QUEENS.melissa.ability.sugar);
});

test('each ability does the one thing it advertises', () => {
  // Snare: everything of theirs nearby crawls
  {
    const sim = packAll(fund(duel({
      players: [{ id: 'A', name: 'A', team: 0, queen: 'vespula' }, { id: 'B', name: 'B', team: 1 }],
    }), 'A', 'B'));
    sim.command('A', { kind: 'queen', lane: 1 });
    sim.command('B', { kind: 'send', unit: 'worker', lane: 1 });
    run(sim, 12);
    sim.playerById('A').heroLevel = HERO.abilityAt;
    const foe = sim.units.find((u) => u.team === 1);
    assert.equal(foe.slowMul, 1);
    assert.equal(sim.command('A', { kind: 'ability' }).ok, true);
    assert.equal(foe.slowMul, QUEENS.vespula.ability.slow.mul, 'snare did not stick');
  }
  // Levy: four free workers, and they are free of eco so they cannot compound
  {
    const sim = fund(duel({ players: [{ id: 'A', name: 'A', team: 0, queen: 'sergeant' }] }), 'A');
    const a = sim.playerById('A');
    sim.command('A', { kind: 'queen', lane: 1 });
    run(sim, 4);
    a.heroLevel = HERO.abilityAt;
    const before = sim.units.length, eco = a.eco, purse = a.sugar;
    assert.equal(sim.command('A', { kind: 'ability' }).ok, true);
    assert.equal(sim.units.length - before, QUEENS.sergeant.ability.count);
    assert.equal(a.eco, eco, 'levied workers grew the economy');
    assert.equal(a.sugar, purse, 'levied workers cost sugar');
  }
  // Honeydew: patches up your own ants and nobody else's
  {
    const sim = packAll(fund(duel({
      players: [{ id: 'A', name: 'A', team: 0, queen: 'melissa' }, { id: 'B', name: 'B', team: 1 }],
    }), 'A', 'B'));
    sim.command('A', { kind: 'queen', lane: 1 });
    sim.command('A', { kind: 'send', unit: 'trapjaw', lane: 1 });
    sim.command('B', { kind: 'send', unit: 'trapjaw', lane: 1 });
    run(sim, 4);
    const mine = sim.units.find((u) => u.team === 0 && u.kind === 'r');
    const theirs = sim.units.find((u) => u.team === 1);
    // wound them by hand rather than waiting for a fight: which of the two
    // trapjaws is still alive after 40 seconds is not what this test is about
    mine.hp = Math.round(mine.maxHp * 0.4);
    theirs.hp = Math.round(theirs.maxHp * 0.4);
    const theirHp = theirs.hp, myHp = mine.hp;
    sim.playerById('A').heroLevel = HERO.abilityAt;
    assert.equal(sim.command('A', { kind: 'ability' }).ok, true);
    assert.ok(mine.hp > myHp, 'honeydew healed nobody');
    assert.equal(theirs.hp, theirHp, 'honeydew healed the enemy');
  }
});

test('a Honeyqueen pays income only while she is standing up', () => {
  const sim = duel({ players: [{ id: 'A', name: 'A', team: 0, queen: 'melissa' }] });
  const a = sim.playerById('A');
  a.sugar = 9999;
  const flat = sim.incomeRate(a);
  sim.command('A', { kind: 'queen', lane: 1 });
  assert.equal(sim.incomeRate(a) - flat, QUEENS.melissa.income);
  sim.heroOf(0).hp = 0;
  sim.step(DT);
  assert.equal(Math.round(sim.incomeRate(a) * 100), Math.round(flat * 100));
});

test('queenStats never edits the shared queen definitions', () => {
  // the castedRaider lesson: a shallow copy shares its nested slow object, and
  // one match applying a level to it rewrites the queen for every other room
  const before = JSON.stringify(QUEENS);
  for (const q of QUEEN_IDS) {
    const s = queenStats(q, HERO.maxLevel);
    if (s.slow) s.slow.mul = 0.01;
    s.hp = 1;
  }
  assert.equal(JSON.stringify(QUEENS), before);
});

// -------------------------------------------------------- pheromone trails

test('a mark costs sugar, tops out, and only one colony feels it', () => {
  const sim = packAll(fund(duel(), 'A', 'B'));
  const a = sim.playerById('A');
  assert.equal(sim.pher[0][1], 0);
  const purse = a.sugar;
  assert.equal(sim.command('A', { kind: 'mark', lane: 1 }).ok, true);
  assert.equal(purse - a.sugar, PHEROMONE.cost);
  assert.equal(sim.pher[0][1], PHEROMONE.perMark);
  assert.equal(sim.pher[1][1], 0, 'marking your road warmed theirs');
  assert.equal(sim.pher[0][0], 0, 'marking one road warmed another');

  // it will not let you pour the purse in all at once
  assert.match(sim.command('A', { kind: 'mark', lane: 1 }).why, /settling/);
  assert.match(sim.command('A', { kind: 'mark', lane: 9 }).why, /no such lane/);
  assert.match(sim.command('A', { kind: 'mark', lane: -1 }).why, /no such lane/);

  // and it has a ceiling, so it can never become a second Rally
  for (let i = 0; i < 20; i++) {
    a.markCd = 0;
    sim.command('A', { kind: 'mark', lane: 1 });
  }
  assert.equal(sim.pher[0][1], 1);
  assert.match(sim.command('A', { kind: 'mark', lane: 1 }).why, /as strong as it gets/);
});

test('a marked road speeds up its own colony and nobody else', () => {
  // The trail is PINNED at full strength each tick. Left alone it decays while
  // the ant walks, which averages the multiplier down to about x1.21 over a
  // crossing — true to the design, but then this measures the decay curve
  // instead of the speed bonus it is supposed to be checking.
  const walk = (mine, theirs) => {
    const sim = packAll(fund(duel(), 'A', 'B'));
    sim.command('A', { kind: 'send', unit: 'worker', lane: 1 });
    let t = 0;
    while (t < 200 && sim.nestHp[1] === TUNING.nestHp) {
      sim.pher[0][1] = mine;
      sim.pher[1][1] = theirs;
      sim.step(DT); sim.fx.length = 0; t += DT;
    }
    return t;
  };
  const plain = walk(0, 0), fast = walk(1, 0), foesOnly = walk(0, 1);
  assert.ok(fast < plain, 'a marked road did not speed anybody up');
  assert.ok(Math.abs(plain / fast - (1 + PHEROMONE.speed)) < 0.02,
    `expected about x${1 + PHEROMONE.speed}, got x${(plain / fast).toFixed(3)}`);
  assert.equal(foesOnly.toFixed(4), plain.toFixed(4), 'their trail carried your ants');
});

test('a trail fades when you walk away and traffic keeps it warm, but only so warm', () => {
  const sim = packAll(fund(duel(), 'A'));
  sim.pher[0][1] = 1;
  run(sim, 5);
  assert.ok(sim.pher[0][1] < 1, 'an empty road stayed warm');
  run(sim, 60);
  assert.equal(sim.pher[0][1], 0, 'an abandoned road never went cold');

  // Traffic alone tops it back up. It has to be measured while they are still
  // ON the road: a worker crosses in about fifteen seconds, so a long run just
  // measures an empty road again.
  const busy = () => { for (let i = 0; i < 6; i++) sim.command('A', { kind: 'send', unit: 'worker', lane: 1 }); };
  busy();
  run(sim, 8);
  assert.ok(sim.units.length > 0, 'they all died before this could measure anything');
  assert.ok(sim.pher[0][1] > 0, 'walking a road laid nothing down');

  // and traffic alone tops out below what a fresh mark reaches, so a swarm can
  // hold a trail warm but can never build one for free
  for (let i = 0; i < 30; i++) { busy(); run(sim, 4); }
  assert.ok(sim.pher[0][1] <= PHEROMONE.reinforceCap + 1e-9,
    `traffic alone reached ${sim.pher[0][1]}, past the ${PHEROMONE.reinforceCap} cap`);
  assert.ok(sim.pher[0][1] > 0.3, `traffic barely registered at ${sim.pher[0][1]}`);
});

// ------------------------------------------------- colours and emotes

test('a colony colour survives the trip and two colonies never share one', () => {
  assert.deepEqual(resolveColors(['moss', 'plum']), ['moss', 'plum']);
  // team 0 keeps what it asked for and team 1 moves, so the outcome does not
  // depend on which of them clicked last
  const clash = resolveColors(['teal', 'teal']);
  assert.equal(clash[0], 'teal');
  assert.notEqual(clash[1], 'teal');
  assert.ok(isColor(clash[1]));
  assert.deepEqual(resolveColors([]), DEFAULT_COLORS);

  // junk of every shape falls back rather than reaching the renderer
  for (const evil of ['__proto__', 'constructor', 'toString', 'nonsense', '', null, undefined, 42, {}]) {
    assert.equal(isColor(evil), false, `${String(evil)} passed as a colour`);
    assert.equal(cleanColor(evil), 'ember', `${String(evil)} was not repaired`);
    const [a, b] = resolveColors([evil, evil]);
    assert.ok(isColor(a) && isColor(b) && a !== b, `${String(evil)} produced ${a}/${b}`);
  }

  // and the sim resolves it once, for the colony rather than for each player
  const sim = new Sim({
    mode: 'versus', seed: 3,
    players: [
      { id: 'A', name: 'A', team: 0, color: 'plum' },
      { id: 'B', name: 'B', team: 1, color: 'plum' },
    ],
  });
  assert.equal(sim.colors[0], 'plum');
  assert.notEqual(sim.colors[1], 'plum');
  assert.deepEqual(sim.fullState().colors, sim.colors);
});

test('every colony colour is distinguishable and pulls the art hard enough', () => {
  const ids = new Set();
  for (const c of COLONY_COLORS) {
    assert.ok(c.id && c.name && c.accent && c.mix && c.ring, `${c.id} is missing a field`);
    assert.equal(ids.has(c.id), false, `${c.id} appears twice`);
    ids.add(c.id);
    for (const key of ['accent', 'mix', 'ring']) {
      assert.match(c[key], /^#[0-9a-f]{6}$/i, `${c.id}.${key} is not a hex colour`);
    }
    // the roster is mostly warm, so a cool colour that pulls softly leaves its
    // ants reading as somebody else's. Frost at 0.34 did exactly that.
    assert.ok(c.mixT >= 0.2 && c.mixT <= 0.55, `${c.id} mixT ${c.mixT} is outside the workable range`);
  }
  assert.ok(COLONY_COLORS.length >= 3, 'with two colours there is nothing to choose');
});

test('an emote is an index into a fixed list and nothing else', () => {
  assert.ok(EMOTES.length >= 4);
  for (const e of EMOTES) assert.ok(e.id && e.text && e.glyph, `${e.id} is missing its copy`);
  for (let i = 0; i < EMOTES.length; i++) assert.equal(isEmote(i), true);
  for (const evil of [-1, EMOTES.length, 1.5, '0', '__proto__', null, undefined, NaN, Infinity, {}, []]) {
    assert.equal(isEmote(evil), false, `${String(evil)} passed as an emote`);
  }
});

// ----------------------------------------------------------- ring boards

/**
 * Colony i's four roads in a canonical order: two toward the colony after it,
 * two toward the colony before. "My second road" then means the same thing to
 * everybody, which is what lets a script be played identically by all of them.
 */
const roadsOf = (n, i) => [2 * i, 2 * i + 1, 2 * (((i - 1) + n) % n), 2 * (((i - 1) + n) % n) + 1];

for (const n of RING_SIZES) {
  const id = `ring${n}`;

  test(`${id}: every colony is handed the same board`, () => {
    const map = buildMap(id);
    assert.equal(map.nests.length, n);
    assert.equal(map.teams, n);
    assert.equal(map.kind, 'ring');

    // rotational symmetry, checked on the things that decide a match
    const spread = (xs) => Math.max(...xs) - Math.min(...xs);
    assert.ok(spread(map.laneLen) < 1e-6, `roads differ in length by ${spread(map.laneLen)}`);
    const fromMiddle = map.nests.map((v) => Math.hypot(v.x - map.width / 2, v.y - map.height / 2));
    assert.ok(spread(fromMiddle) < 1e-6, 'a nest sits closer to the middle than the others');

    // each colony's pads sit the same way round its own nest, and see as far
    const sig = map.pads.map((ps, t) => ps
      .map((p) => Math.hypot(p.x - map.nests[t].x, p.y - map.nests[t].y).toFixed(6)).sort().join(','));
    assert.equal(new Set(sig).size, 1, 'one colony has its pads placed differently');
    const reach = map.pads.map((ps) => ps.map((p) => p.rangeMul).sort().join(','));
    assert.equal(new Set(reach).size, 1, 'one colony can see further than another');

    // every road joins neighbours only, and both of them can walk it
    for (const l of map.lanes) {
      assert.equal(l.ends.length, 2);
      const [a, b] = l.ends;
      assert.equal((a + 1) % n, b, `a road joins ${a} to ${b}, which are not neighbours`);
      assert.equal(map.laneSideFor(l.id, a), 1);
      assert.equal(map.laneSideFor(l.id, b), -1);
      assert.equal(map.laneFoe(l.id, 1), b);
      assert.equal(map.laneFoe(l.id, -1), a);
    }
    // and every colony has the same number of ways out
    const ways = Array.from({ length: n }, (_, t) => map.lanesFor(t).length);
    assert.equal(new Set(ways).size, 1);

    // the herd has to be somewhere the roads actually go
    let closest = Infinity;
    for (let l = 0; l < map.lanes.length; l++) {
      for (let d = 0; d <= map.laneLen[l]; d += 7) {
        const pt = map.laneAt(l, d, { x: 0, y: 0, angle: 0, seg: 0 });
        closest = Math.min(closest, Math.hypot(pt.x - map.food.x, pt.y - map.food.y));
      }
    }
    assert.ok(closest < map.food.r, `no road comes within ${closest.toFixed(0)} of a herd of ${map.food.r}`);
  });

  test(`${id}: the same play from every colony ends every nest level`, () => {
    // The ring equivalent of the mirrored boards' "same script from both sides".
    // If any colony's board differs by so much as a pad, this drifts apart.
    const sim = new Sim({
      mode: 'versus', map: id, seed: 4242, wildlife: false,
      players: Array.from({ length: n }, (_, i) => ({ id: `P${i}`, name: `P${i}`, team: i })),
    });
    for (const p of sim.players) p.roster = [...RAIDER_IDS];
    const order = ['worker', 'army', 'trapjaw', 'archer'];
    let acc = 0, k = 0, queened = false;
    while (!sim.over && sim.t < 220) {
      sim.step(DT);
      acc += DT;
      if (!queened && sim.t >= 20) {
        queened = true;
        for (const p of sim.players) p.sugar += 400;
        for (let i = 0; i < n; i++) sim.command(`P${i}`, { kind: 'queen', lane: roadsOf(n, i)[0] });
      }
      if (acc >= 3) {
        acc = 0;
        const unit = order[k % order.length], slot = k % 4;
        k++;
        for (let i = 0; i < n; i++) {
          const lane = roadsOf(n, i)[slot];
          sim.command(`P${i}`, { kind: 'send', unit, lane });
          sim.command(`P${i}`, { kind: 'mark', lane });
        }
      }
      sim.fx.length = 0;
    }
    const hp = sim.nestHp.map((h) => h.toFixed(4));
    assert.equal(new Set(hp).size, 1, `nests ended ${hp.join(' / ')}`);
    const alive = sim.players.map((p) => sim.units.filter((u) => u.owner === p.index).length);
    assert.equal(new Set(alive).size, 1, `survivors ${alive.join('/')}`);
    assert.equal(new Set(sim.players.map((p) => p.heroXp)).size, 1, 'queens earned differently');
    assert.equal(new Set(sim.players.map((p) => Math.round(p.sugar * 1e4))).size, 1, 'purses drifted apart');
  });
}

test('a road you are not on cannot be raided down', () => {
  const n = 4;
  const sim = new Sim({
    mode: 'versus', map: 'ring4', seed: 5, wildlife: false,
    players: Array.from({ length: n }, (_, i) => ({ id: `P${i}`, name: `P${i}`, team: i })),
  });
  for (const p of sim.players) { p.roster = [...RAIDER_IDS]; p.sugar = 9999; }
  const mine = sim.map.lanesFor(0);
  assert.equal(mine.length, 4);
  assert.equal(sim.command('P0', { kind: 'send', unit: 'worker', lane: mine[0] }).ok, true);
  const notMine = sim.map.lanes.find((l) => !l.ends.includes(0)).id;
  assert.match(sim.command('P0', { kind: 'send', unit: 'worker', lane: notMine }).why, /does not run from your nest/);
  assert.match(sim.command('P0', { kind: 'queen', lane: notMine }).why, /does not run from your nest/);
});

test('a free-for-all outlives a colony falling, and the last one takes it', () => {
  const n = 4;
  const sim = new Sim({
    mode: 'versus', map: 'ring4', seed: 5, wildlife: false,
    players: Array.from({ length: n }, (_, i) => ({ id: `P${i}`, name: `P${i}`, team: i })),
  });
  sim.nestHp[1] = 0;
  sim.step(DT);
  assert.equal(sim.over, false, 'one colony falling ended everybody else\'s match');
  assert.equal(sim.out[1], true);
  sim.nestHp[2] = 0;
  sim.nestHp[3] = 0;
  sim.step(DT);
  assert.equal(sim.over, true);
  assert.equal(sim.winner, 0);
  assert.match(sim.endReason, /last colony standing/);
});

test('six colonies get six different colours', () => {
  const ids = resolveColors(new Array(6).fill('ember'));
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, 6, 'two colonies would be wearing the same colour');
  for (const id of ids) assert.ok(isColor(id));
  assert.ok(COLONY_COLORS.length >= 6, 'not enough colours for the biggest game');
});

// ------------------------------------------------------------- two a side

/** Four players, two to a colony, which is what the `pairs` room mode builds. */
const foursome = (opts = {}) => new Sim({
  mode: 'versus', seed: 11, wildlife: false,
  players: [
    { id: 'A', name: 'A', team: 0, color: 'moss' },
    { id: 'B', name: 'B', team: 0, color: 'plum' },
    { id: 'C', name: 'C', team: 1, color: 'teal' },
    { id: 'D', name: 'D', team: 1, color: 'amber' },
  ],
  ...opts,
});

test('two a side: team-mates split the pads and cannot build on each other', () => {
  const sim = foursome();
  const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((id) => sim.playerById(id));
  for (const p of sim.players) p.sugar = 9999;

  // every pad on a side is owned by exactly one of the two who hold it
  for (const team of [0, 1]) {
    const pair = sim.players.filter((p) => p.team === team);
    const all = pair.flatMap((p) => p.padIdx).sort();
    assert.deepEqual(all, sim.map.pads[team].map((_, i) => i), `team ${team} does not cover its pads`);
    assert.equal(new Set(all).size, all.length, `team ${team} has a pad owned twice`);
    assert.ok(pair.every((p) => p.padIdx.length > 0), `team ${team} left somebody with no pads`);
  }
  assert.equal(sim.command('A', { kind: 'build', def: 'worker', pad: a.padIdx[0] }).ok, true);
  assert.match(sim.command('A', { kind: 'build', def: 'worker', pad: b.padIdx[0] }).why, /your pad/);
  // and the mirrored pair get exactly the same split, or one colony defends better
  assert.deepEqual(a.padIdx, c.padIdx);
  assert.deepEqual(b.padIdx, d.padIdx);
});

test('two a side: one colour per colony, not one per player', () => {
  const sim = foursome();
  assert.equal(sim.colors.length, 2);
  // the first player of each colony decides it; a team-mate cannot wear another
  assert.equal(sim.colors[0], 'moss');
  assert.equal(sim.colors[1], 'teal');
  assert.notEqual(sim.colors[0], sim.colors[1]);
});

test('two a side: the board budget is shared, so four purses cannot double it', () => {
  const solo = duel();
  const four = foursome();
  const soloCap = solo.unitCapFor(solo.playerById('A'));
  const pairCap = four.unitCapFor(four.playerById('A'));

  // a lone player is untouched by any of this
  assert.equal(soloCap, TUNING.maxUnitsPerPlayer);
  // a colony of two gets more than one player, and well under two players' worth
  assert.ok(pairCap < soloCap, 'a team-mate did not reduce the per-player budget');
  assert.ok(pairCap * 2 > soloCap, 'a colony of two is worse off than a lone player');
  assert.ok(pairCap * 2 < soloCap * 2, 'two a side can put twice as much on one board');

  // and the cap is actually enforced per player, so nobody can be starved out
  const p = four.playerById('A');
  p.sugar = 1e6;
  let refused = null;
  for (let i = 0; i < 300 && !refused; i++) {
    const r = four.command('A', { kind: 'send', unit: p.roster[0], lane: i % 3 });
    if (!r.ok) refused = r.why;
  }
  assert.match(refused, /full/);
  const mine = four.units.filter((u) => u.owner === p.index).length;
  assert.ok(mine <= pairCap, `A fielded ${mine}, over its ${pairCap} budget`);
  // the team-mate still has their own room
  assert.equal(four.command('B', { kind: 'send', unit: four.playerById('B').roster[0], lane: 0 }).ok, true);
});

test('two a side: both colonies field two queens, and they mirror', () => {
  const sim = foursome();
  for (const p of sim.players) p.sugar = 9999;
  for (const [id, lane] of [['A', 0], ['B', 2], ['C', 0], ['D', 2]]) {
    assert.equal(sim.command(id, { kind: 'queen', lane }).ok, true, id);
  }
  run(sim, 1);
  const queens = sim.units.filter((u) => u.kind === 'h');
  assert.equal(queens.filter((u) => u.team === 0).length, 2);
  assert.equal(queens.filter((u) => u.team === 1).length, 2);
  // same lanes on both sides, so neither colony gets a better opening
  const lanesOf = (t) => queens.filter((u) => u.team === t).map((u) => u.lane).sort();
  assert.deepEqual(lanesOf(0), lanesOf(1));
});

// ---------------------------------------------------------------- commands

test('the server refuses what a player cannot do', () => {
  const sim = new Sim({
    mode: 'coop', seed: 3, wildlife: false,
    players: [{ id: 'A', name: 'A', team: 0 }, { id: 'B', name: 'B', team: 0 }],
    ai: { team: 1, difficulty: 'coop' },
  });
  const a = sim.playerById('A');
  a.sugar = 10;
  sim.playerById('A').roster = [...RAIDER_IDS];
  assert.match(sim.command('A', { kind: 'send', unit: 'majoress', lane: 0 }).why, /sugar/);
  assert.match(sim.command('A', { kind: 'send', unit: 'nonsense', lane: 0 }).why, /raider/);
  assert.match(sim.command('A', { kind: 'send', unit: 'worker', lane: 9 }).why, /lane/);
  assert.match(sim.command('nobody', { kind: 'send', unit: 'worker', lane: 0 }).why, /player/);

  // co-op splits the pads, so neither human can build on the other's
  const mine = a.padIdx, theirs = sim.playerById('B').padIdx;
  assert.equal(mine.length + theirs.length, sim.map.pads[0].length);
  assert.equal(mine.filter((i) => theirs.includes(i)).length, 0);
  a.sugar = 9999;
  assert.equal(sim.command('A', { kind: 'build', def: 'worker', pad: mine[0] }).ok, true);
  assert.match(sim.command('A', { kind: 'build', def: 'worker', pad: mine[0] }).why, /taken/);
  assert.match(sim.command('A', { kind: 'build', def: 'worker', pad: theirs[0] }).why, /your pad/);
});

test('a colony can only send the five ants it packed', () => {
  const sim = fund(duel(), 'A');
  const packed = sim.playerById('A').roster;
  assert.equal(packed.length, LOADOUT_SIZE);
  const missing = RAIDER_IDS.filter((k) => !packed.includes(k));
  assert.equal(missing.length, RAIDER_IDS.length - LOADOUT_SIZE);
  assert.equal(sim.command('A', { kind: 'send', unit: packed[0], lane: 0 }).ok, true);
  assert.match(sim.command('A', { kind: 'send', unit: missing[0], lane: 0 }).why, /did not pack/);
});

test('inherited property names are not mistaken for game content', () => {
  // RAIDERS['__proto__'] is truthy, so a `!def` guard lets it through, the cost
  // check compares against undefined and passes, and the sim then crashes.
  const sim = fund(duel(), 'A');
  for (const evil of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.match(sim.command('A', { kind: 'send', unit: evil, lane: 0 }).why, /no such raider/, evil);
    assert.match(sim.command('A', { kind: 'build', def: evil, pad: 0 }).why, /no such defender/, evil);
    assert.match(sim.command('A', { kind: 'power', power: evil, lane: 0 }).why, /no such power/, evil);
    assert.match(sim.command('A', { kind: 'upgrade', unit: evil }).why, /no such raider/, evil);
    assert.equal(cleanLoadout([evil]).includes(evil), false, `${evil} got into a roster`);
    // a queen is chosen by name too, and QUEENS['__proto__'] is just as truthy
    assert.equal(cleanQueen(evil), DEFAULT_QUEEN, `${evil} got picked as a queen`);
    const s = new Sim({
      mode: 'versus', seed: 5, wildlife: false,
      players: [{ id: 'A', name: 'A', team: 0, queen: evil }],
    });
    assert.equal(s.playerById('A').queen, DEFAULT_QUEEN, `${evil} survived into a player`);
    s.playerById('A').sugar = 9999;
    assert.equal(s.command('A', { kind: 'queen', lane: 0 }).ok, true);
    run(s, 2);
    assert.equal(s.units[0].kind, 'h');
    assert.ok(Number.isFinite(s.units[0].hp), `${evil} produced a queen with no health`);
  }
  // the two new handlers also have to survive junk arguments
  assert.match(sim.command('A', { kind: 'queen', lane: 99 }).why, /no such lane/);
  assert.match(sim.command('A', { kind: 'queen', lane: -1 }).why, /no such lane/);
  assert.match(sim.command('A', { kind: 'mark', lane: 99 }).why, /no such lane/);
  assert.match(sim.command('A', { kind: 'ability' }).why, /not on the board/);
  assert.match(sim.command('A', { kind: 'nonsense' }).why, /unknown command/);
  // and the sim is still healthy after all that
  run(sim, 2);
  assert.equal(sim.over, false);
});

test('a junk loadout is repaired rather than trusted', () => {
  assert.deepEqual(cleanLoadout(null), DEFAULT_LOADOUT);
  assert.deepEqual(cleanLoadout([]), DEFAULT_LOADOUT);
  // duplicates collapse, unknown ids are dropped, and it is always padded to five
  assert.equal(cleanLoadout(['worker', 'worker', 'worker']).length, LOADOUT_SIZE);
  assert.equal(new Set(cleanLoadout(['worker', 'worker'])).size, LOADOUT_SIZE);
  assert.equal(cleanLoadout(['nonsense', '__proto__', 'worker']).includes('nonsense'), false);
  // and an over-long one is cut to size rather than accepted
  assert.equal(cleanLoadout(RAIDER_IDS).length, LOADOUT_SIZE);
  for (const id of cleanLoadout(['weaver', 'majoress'])) assert.ok(RAIDERS[id], `${id} is a real raider`);
});

test('the bot packs something it can actually play', () => {
  for (let i = 0; i < 20; i++) {
    const r = botLoadout(() => (i * 0.37 + 0.11) % 1);
    assert.equal(r.length, LOADOUT_SIZE);
    assert.equal(new Set(r).size, LOADOUT_SIZE, 'the bot packed a duplicate');
    assert.ok(r.some((k) => RAIDERS[k].eco >= 0.9), 'nothing cheap to eco with');
    assert.ok(r.includes('trapjaw'), 'no body to lead a push');
  }
});

test('one player cannot flood the board past the unit cap', () => {
  const sim = duel();
  const a = sim.playerById('A');
  a.sugar = 1e6;
  let refused = null;
  for (let i = 0; i < 200 && !refused; i++) {
    const r = sim.command('A', { kind: 'send', unit: 'worker', lane: i % 3 });
    if (!r.ok) refused = r.why;
  }
  assert.match(refused, /full/);
  assert.ok(sim.units.length <= TUNING.maxUnitsPerPlayer, 'cap did not hold');
});

test('selling a defender refunds the stated share and frees the pad', () => {
  const sim = duel();
  const a = sim.playerById('A');
  a.sugar = 1000;
  sim.command('A', { kind: 'build', def: 'archer', pad: 0 });
  const after = a.sugar;
  sim.command('A', { kind: 'sell', pad: 0 });
  assert.equal(a.sugar - after, Math.floor(DEFENDERS.archer.cost * TUNING.sellRefund));
  assert.equal(sim.defs.length, 0);
  assert.equal(sim.command('A', { kind: 'build', def: 'worker', pad: 0 }).ok, true);
});

// ---------------------------------------------------------------- the wire

test('a snapshot carries everything the client needs to redraw the board', () => {
  const sim = duel({ wildlife: true });
  sim.playerById('A').sugar = 5000;
  sim.command('A', { kind: 'send', unit: 'trapjaw', lane: 1 });
  sim.command('A', { kind: 'build', def: 'archer', pad: 0 });
  sim.command('A', { kind: 'power', power: 'barricade', lane: 1 });
  run(sim, 2);
  const s = sim.snapshot();
  assert.equal(s.u.length, 1);
  assert.equal(s.d.length, 1);
  assert.equal(s.w.length, 1);
  assert.equal(s.p.length, 2);
  // the client rebuilds x/y from lane + distance; it must land on the lane
  const [, , , lane, d] = s.u[0];
  const p = sim.map.laneAt(lane, d);
  assert.ok(p.x > 0 && p.x < WORLD_W && p.y > 0 && p.y < WORLD_H);
  assert.equal(JSON.parse(JSON.stringify(s)).n, s.n, 'snapshot is not JSON-safe');
  assert.equal(sim.snapshot().fx.length, 0, 'fx were not drained after sending');
});

test('a fallen colony rides the wire as out, not as nought', () => {
  const n = 4;
  const sim = new Sim({
    mode: 'versus', map: 'ring4', seed: 5, wildlife: false,
    players: Array.from({ length: n }, (_, i) => ({ id: `P${i}`, name: `P${i}`, team: i })),
  });
  assert.deepEqual(sim.snapshot().out, [false, false, false, false], 'one flag per colony');
  sim.nestHp[2] = 0;
  sim.step(DT);
  const s = sim.snapshot();
  // nought and gone look identical in `hp` alone, and the HUD has to tell a
  // colony that is out of the match from one sitting on its last point
  assert.equal(s.hp[2], 0);
  assert.equal(s.out[2], true);
  assert.deepEqual(s.out, [false, false, true, false], 'a colony falling took somebody else with it');
  assert.deepEqual(JSON.parse(JSON.stringify(s)).out, s.out, 'out is not JSON-safe');
});

test('a full state names the map, the players and their pads', () => {
  const id = MAPS[MAPS.length - 1].id;   // any board that is not the default
  const sim = duel({ map: id });
  const f = sim.fullState();
  assert.equal(f.map, id, 'a client cannot rebuild the board without this');
  assert.equal(f.players.length, 2);
  assert.deepEqual(f.players.map((p) => p.team), [0, 1]);
  assert.equal(f.players[0].pads.length, buildMap(id).pads[0].length);
});

// ------------------------------------------------------------------ endings

test('a match ends, and the bots are ordered easy < hard', () => {
  let hardWins = 0;
  for (let i = 0; i < 6; i++) {
    // alternate sides so a seating advantage cannot hide in the result
    const hardTeam = i % 2;
    const sim = new Sim({
      mode: 'versus', seed: 500 + i * 13,
      players: [{ id: 'A', name: 'A', team: 0 }, { id: 'B', name: 'B', team: 1 }],
    });
    const brains = [
      new AiBrain(sim, 'A', hardTeam === 0 ? 'hard' : 'easy'),
      new AiBrain(sim, 'B', hardTeam === 1 ? 'hard' : 'easy'),
    ];
    let guard = 0;
    while (!sim.over && guard++ < TUNING.matchCap * 30 + 60) {
      sim.step(DT);
      for (const b of brains) b.update(DT);
      sim.fx.length = 0;
    }
    assert.ok(sim.over, 'match never ended');
    assert.ok(sim.endReason, 'match ended without saying why');
    if (sim.winner === hardTeam) hardWins++;
  }
  assert.ok(hardWins >= 4, `hard only won ${hardWins}/6 against easy`);
});

test('sudden death bleeds both nests so nobody can turtle forever', () => {
  const sim = duel();
  sim.t = TUNING.suddenDeathAt;
  const before = [...sim.nestHp];
  run(sim, 5);
  assert.ok(sim.nestHp[0] < before[0] && sim.nestHp[1] < before[1]);
  assert.equal((before[0] - sim.nestHp[0]).toFixed(3), (before[1] - sim.nestHp[1]).toFixed(3));
});

test('every map builds three sane lanes with the middle one shortest', () => {
  for (const M of MAPS) {
    const map = buildMap(M.id);
    assert.equal(map.laneLen.length, 3, `${M.id} lane count`);
    for (const l of map.laneLen) assert.ok(l > 500 && l < 1200, `${M.id} lane length ${l}`);
    assert.ok(map.laneLen[1] < map.laneLen[0], `${M.id}: the Short Road should be the short one`);
  }
});

test('an unknown map id falls back instead of taking the server down', () => {
  for (const junk of ['not-a-real-map', '__proto__', '', null, undefined, 42]) {
    const map = buildMap(junk);
    assert.equal(map.id, DEFAULT_MAP, `buildMap(${JSON.stringify(junk)})`);
    assert.equal(map.lanes.length, 3);
  }
});
