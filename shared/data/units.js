// ===== Raiders, defenders and colony powers — pure data, no engine imports =====
// Species art, names and colours come straight from Grubs TD's tower roster, so
// the same nine ants appear here in new jobs: seven march, seven hold the line.
//
// raider  : damage/cooldown/speed in px/s, `range` compared along the lane
//           eco         = sugar/sec this purchase permanently adds to YOUR income.
//                         Raiding IS the economy. Sitting on your hands earns you
//                         almost nothing, which is the whole point.
//
//                         ECO PER SUGAR IS NEARLY FLAT, and that is a measured
//                         decision, not an oversight. The first table gave the
//                         Worker 0.0158 eco per sugar against the Majoress's
//                         0.0014, an elevenfold gap, and the game solved itself:
//                         Worker was 62 percent of ALL sends across an
//                         instrumented audit and the Majoress was sent once in
//                         24 matches. When one unit is the best eco buy AND the
//                         cheapest AND comes as a pair, the purchase decision is
//                         a ritual. The ratios now run 0.0127 for chaff down to
//                         0.0105 for the Majoress: a mild premium for the units
//                         that die for their income, small enough that WHAT a
//                         unit does in the fight decides the buy, not what it
//                         pays. Re-run the audit probe after touching these;
//                         the target is no unit above 40 percent of sends.
//           siege       = nest damage dealt when it reaches the enemy nest
//           count       = how many spawn per purchase
//           vsDefender  = may also shoot pad defenders (melee raiders run past them)
//           blast       = detonates on its first hit, then dies
// defender: immobile, `range` is euclidean from its pad

export const RAIDERS = {
  worker: {
    name: 'Worker', species: 'worker', hotkey: '1',
    color: '#e8952f', dark: '#7a4a12', scale: 0.68, radius: 11,
    cost: 60, count: 2, hp: 130, damage: 17, cooldown: 0.8, speed: 48, range: 26, siege: 5, eco: 0.72,
    tagline: 'Two for nothing, and they tandem run: faster directly behind another Worker.',
  },
  army: {
    name: 'Army Ant', species: 'army', hotkey: '2',
    color: '#7a2d1c', dark: '#3d130a', scale: 0.6, radius: 10,
    cost: 130, count: 3, hp: 80, damage: 21, cooldown: 0.55, speed: 78, range: 24, siege: 4, eco: 1.65,
    tagline: 'Three sprinters. Four or more in one lane bite in a frenzy.',
  },
  trapjaw: {
    name: 'Trap-Jaw', species: 'trapjaw', hotkey: '3',
    color: '#b5442c', dark: '#5e1d0e', scale: 0.82, radius: 14,
    cost: 200, count: 1, hp: 430, damage: 52, cooldown: 1.0, speed: 42, range: 32, siege: 11, eco: 2.3,
    tagline: 'The snap: its first hit on each new foe lands double. Then it keeps walking.',
  },
  exploder: {
    name: 'Exploder', species: 'exploder', hotkey: '4',
    color: '#e2762a', dark: '#7a3608', scale: 0.72, radius: 13,
    cost: 170, count: 1, hp: 170, damage: 0, cooldown: 0.4, speed: 60, range: 30, siege: 10, eco: 1.9,
    blast: { r: 70, damage: 150 }, vsDefender: true,
    tagline: 'One hit, one crater. Clears clumps and cracks pads.',
  },
  weaver: {
    name: 'Weaver', species: 'weaver', hotkey: '5',
    color: '#2fa7a0', dark: '#0e4f4b', scale: 0.72, radius: 12,
    cost: 190, count: 1, hp: 190, damage: 14, cooldown: 1.1, speed: 44, range: 112, siege: 3, eco: 2.1,
    slow: { mul: 0.55, dur: 1.6 }, vsDefender: true,
    tagline: 'Silk from the back rank, and a snare on the ground where it falls.',
  },
  archer: {
    name: 'Acid Archer', species: 'archer', hotkey: '6',
    color: '#8e5bc6', dark: '#43246b', scale: 0.72, radius: 12,
    cost: 240, count: 1, hp: 150, damage: 46, cooldown: 1.25, speed: 38, range: 138, siege: 5, eco: 2.6,
    vsDefender: true,
    tagline: 'Outranges the pads, and its acid etches armour off a point at a time.',
  },
  majoress: {
    name: 'Majoress', species: 'majoress', hotkey: '7',
    color: '#7b3fa0', dark: '#3c1657', scale: 1.05, radius: 18,
    cost: 420, count: 1, hp: 900, damage: 84, cooldown: 1.4, speed: 30, range: 34, siege: 30, eco: 4.4,
    armor: 6, vsDefender: true,
    tagline: 'Slow, enormous, a living shield: the column behind her takes less pad fire.',
  },
};

export const DEFENDERS = {
  worker: {
    name: 'Worker Post', species: 'worker', hotkey: '1',
    color: '#e8952f', dark: '#7a4a12', scale: 0.85,
    cost: 90, hp: 190, damage: 11, cooldown: 0.75, range: 120,
    tagline: 'Cheap acid pellets. Fills a gap.',
  },
  trapjaw: {
    name: 'Trap-Jaw Post', species: 'trapjaw', hotkey: '2',
    color: '#b5442c', dark: '#5e1d0e', scale: 0.95,
    cost: 150, hp: 420, damage: 34, cooldown: 0.9, range: 76, maxTargets: 3,
    tagline: 'Short reach, snaps three at once, hard to kill.',
  },
  weaver: {
    name: 'Weaver Post', species: 'weaver', hotkey: '3',
    color: '#2fa7a0', dark: '#0e4f4b', scale: 0.85,
    cost: 190, hp: 210, damage: 11, cooldown: 1.0, range: 155,
    slow: { mul: 0.55, dur: 1.8 },
    tagline: 'Slows the whole push so the rest of the line can work.',
  },
  exploder: {
    name: 'Mortar Post', species: 'exploder', hotkey: '4',
    color: '#e2762a', dark: '#7a3608', scale: 0.9,
    cost: 210, hp: 230, damage: 0, cooldown: 1.7, range: 100,
    blast: { r: 64, damage: 62 },
    tagline: 'Lobs into the column. Punishes stacked-up swarms.',
  },
  beacon: {
    name: 'Beacon', species: 'beacon', hotkey: '5',
    color: '#e9e4d2', dark: '#5b5442', scale: 0.85,
    cost: 230, hp: 250, damage: 0, cooldown: 0, range: 175,
    aura: { damage: 1.25, range: 1.15 },
    tagline: 'Buffs every pad in reach. Build it second, never first.',
  },
  archer: {
    name: 'Archer Nest', species: 'archer', hotkey: '6',
    color: '#8e5bc6', dark: '#43246b', scale: 0.9,
    cost: 300, hp: 170, damage: 52, cooldown: 1.5, range: 200,
    tagline: 'Reaches into the next lane over. Paper-thin.',
  },
  honeypot: {
    name: 'Honeypot', species: 'honeypot', hotkey: '7',
    color: '#f5a623', dark: '#8a5a00', scale: 0.95,
    cost: 260, hp: 280, damage: 0, cooldown: 0, range: 0,
    income: 7,
    tagline: '+7 sugar a second. Pays for itself in 38s, if it lives.',
  },
};

export const POWERS = {
  rally: {
    name: 'Rally', hotkey: 'Q', icon: '▶', cost: 140, cooldown: 14, duration: 6,
    speedMul: 1.45, damageMul: 1.25,
    // Rally FOLLOWS THE TRAIL and scales with it, and that is the whole redesign:
    // the old lane-targeted version was cast 635 times in a 24-match audit, on
    // cooldown, into the push lane, every time, by every player worth measuring.
    // A button that is always right is a tax. Tied to the trail it asks two real
    // questions: is my trail where the surge should go, and is it built enough
    // to be worth cashing the cooldown, since a rally on a half-built trail is a
    // half rally. At full strength the numbers above are exactly what they were.
    followsTrail: true,
    tagline: 'Your colony surges down its trail for 6s, as hard as the trail is strong.',
  },
  acidrain: {
    name: 'Acid Rain', hotkey: 'W', icon: '☂', cost: 190, cooldown: 22, duration: 2,
    damage: 160,
    tagline: 'Drenches one lane. 160 damage to every enemy ant standing in it.',
  },
  barricade: {
    name: 'Barricade', hotkey: 'E', icon: '■', cost: 160, cooldown: 26, hp: 650, at: 0.35,
    tagline: 'Drops a pebble wall in your half of a lane. They have to chew it.',
  },
};

/**
 * Caste upgrades. Two tiers per species, bought during the match, permanent for
 * the rest of it. A second thing to spend on besides more ants: once your income
 * is up, widening your best species can beat sending another body.
 *
 * They apply to ants you send AFTERWARDS, not to the ones already marching. That
 * is both easier to reason about mid-fight and stops a purchase mid-push from
 * silently rewriting a battle that is already resolving.
 */
export const CASTES = {
  worker:   [{ name: 'Thick Chitin', cost: 210, hp: 1.3 },
             { name: 'Swarm Drill',  cost: 520, count: 1 }],
  army:     [{ name: 'Forced March', cost: 300, speed: 1.24 },
             { name: 'Raid Column',  cost: 560, hp: 1.4, eco: 1.2 }],
  trapjaw:  [{ name: 'Locked Jaws',  cost: 400, damage: 1.32 },
             { name: 'Ironside',     cost: 720, hp: 1.35, siege: 1.25 }],
  exploder: [{ name: 'Volatile Sac', cost: 350, blastDamage: 1.35 },
             { name: 'Wide Charge',  cost: 620, blastR: 1.25, speed: 1.12 }],
  weaver:   [{ name: 'Thick Silk',   cost: 370, slowMul: 0.75, slowDur: 1.25 },
             { name: 'Long Spinneret', cost: 650, range: 1.25, damage: 1.25 }],
  archer:   [{ name: 'Etched Acid',  cost: 450, damage: 1.3 },
             { name: 'Long Barrel',  cost: 800, range: 1.25, siege: 1.3 }],
  majoress: [{ name: 'Royal Guard',  cost: 680, hp: 1.28, armor: 3 },
             { name: 'Siegebreaker', cost: 1120, siege: 1.35, damage: 1.2 }],
};

export const CASTE_TIERS = 2;

/** The stats an ant is actually built with, after this colony's upgrades. */
export function castedRaider(id, tier = 0) {
  const base = RAIDERS[id];
  if (!base || !tier) return base;
  const out = { ...base };
  if (base.blast) out.blast = { ...base.blast };
  if (base.slow) out.slow = { ...base.slow };
  for (let i = 0; i < Math.min(tier, CASTE_TIERS); i++) {
    const u = CASTES[id]?.[i];
    if (!u) continue;
    if (u.hp) out.hp = Math.round(out.hp * u.hp);
    if (u.damage) out.damage = Math.round(out.damage * u.damage);
    if (u.speed) out.speed = Math.round(out.speed * u.speed);
    if (u.range) out.range = Math.round(out.range * u.range);
    if (u.siege) out.siege = Math.round(out.siege * u.siege);
    if (u.eco) out.eco = Math.round(out.eco * u.eco * 100) / 100;
    if (u.count) out.count = (out.count || 1) + u.count;
    if (u.armor) out.armor = (out.armor || 0) + u.armor;
    if (u.blastDamage && out.blast) out.blast.damage = Math.round(out.blast.damage * u.blastDamage);
    if (u.blastR && out.blast) out.blast.r = Math.round(out.blast.r * u.blastR);
    if (u.slowMul && out.slow) out.slow.mul = Math.round(out.slow.mul * u.slowMul * 100) / 100;
    if (u.slowDur && out.slow) out.slow.dur = Math.round(out.slow.dur * u.slowDur * 10) / 10;
  }
  return out;
}

export const RAIDER_IDS = Object.keys(RAIDERS);

/**
 * You bring five of the seven. Two colonies with the same board and the same
 * economy still play differently because they packed differently, and you can
 * see what your opponent packed before the match starts.
 */
export const LOADOUT_SIZE = 5;
export const DEFAULT_LOADOUT = ['worker', 'army', 'trapjaw', 'archer', 'exploder'];

/**
 * Trim or pad whatever a client sent into a legal roster. Never trust it raw.
 *
 * The lookups here are hasOwn and not truthiness on purpose: RAIDERS['__proto__']
 * returns Object.prototype, which is truthy, so a client that sent '__proto__'
 * got it into its roster. From there the cost check (`sugar < undefined`) passes,
 * the ant is free, and the sim crashes looking up a type index of -1.
 */
export const isRaider = (id) => Object.hasOwn(RAIDERS, id);
export const isDefender = (id) => Object.hasOwn(DEFENDERS, id);
export const isPower = (id) => Object.hasOwn(POWERS, id);

export function cleanLoadout(list) {
  const seen = [];
  for (const id of Array.isArray(list) ? list : []) {
    if (isRaider(id) && !seen.includes(id)) seen.push(id);
    if (seen.length === LOADOUT_SIZE) break;
  }
  for (const id of DEFAULT_LOADOUT) {
    if (seen.length === LOADOUT_SIZE) break;
    if (!seen.includes(id)) seen.push(id);
  }
  for (const id of RAIDER_IDS) {
    if (seen.length === LOADOUT_SIZE) break;
    if (!seen.includes(id)) seen.push(id);
  }
  return seen;
}
export const DEFENDER_IDS = Object.keys(DEFENDERS);
export const POWER_IDS = Object.keys(POWERS);
