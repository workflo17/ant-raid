// ===== The queen — one hero ant per colony — pure data, no engine imports =====
//
// A colony picks ONE queen before the match, out of four. She costs sugar the
// first time she walks out and is free every time after that, but she is slow to
// come back, so losing her is a tempo loss rather than a purchase you repeat.
//
// She levels on kills she helped land. Level 3 unlocks her ability, which is the
// only thing that really separates the four of them: the stat blocks are close
// on purpose, because a queen you cannot answer is a queen that decides matches.
//
// The four bodies were already drawn in js/render/ants.js as `hero` variants
// (`opts.hero`), so `art` here names the variant rather than describing one.
//
// SNOWBALL WATCH: levels come from kills, and the colony that is winning kills
// more. Everything here is sized to keep that loop shallow — five levels, small
// per-level steps, and a respawn that gets LONGER the bigger she is, so the
// colony that is ahead loses more when its queen finally falls.

export const HERO = {
  cost: 300,             // first walk-out only; every respawn after that is free
  abilityAt: 3,          // the level her ability unlocks at
  maxLevel: 5,
  abilityCd: 24,
  // total xp needed to REACH each level; index 0 and 1 are the starting level
  ladder: [0, 0, 12, 30, 56, 92],
  respawn: 26,           // seconds she is gone for...
  respawnPerLevel: 5,    // ...plus this per level, so a big queen is missed longer
  hpPerLevel: 1.16,
  damagePerLevel: 1.13,
  // she takes the xp for anything that dies within this many seconds of her
  // last hit on it, so a kill she set up still counts as hers
  assistWindow: 3,
  queenXp: 12,           // what killing the other colony's queen is worth
  /**
   * SHE DOES NOT SACK NESTS. A queen advances no further than this fraction of
   * the lane and holds there, at the enemy's gate and inside their pads' reach.
   *
   * The first build let her walk into the nest like any other raider, which
   * meant an unattended queen bit it once for her siege value and killed
   * herself. She almost never lived long enough to reach level 2, so the whole
   * levelling half of the feature never happened. Halting her turns her into a
   * lane anchor that has to be answered instead of a 300-sugar one-shot.
   *
   * 0.72 puts her inside the enemy's pad line but nowhere near their nest. At
   * 0.9 she stood on their doorstep and killed raiders as they walked out of
   * it: breach rate fell from 30% to 24% and matches ran a minute longer,
   * because both queens were camping each other's front door.
   *
   * Mirror-safe: team 0 stops at 0.72 of the lane, team 1 at 0.28, and every
   * lane is its own mirror image, so the two halt lines are the same spot.
   */
  haltAt: 0.72,
  /**
   * Calling her onto a different road. Allowed while she is out of a fight and
   * has not yet reached their gate, so it is repositioning rather than an escape
   * hatch from a fight she is losing.
   */
  recallCd: 8,
  recallBefore: 0.75,
};

/**
 * FX.POP carries the dead thing's type index, and a queen's index is already
 * negative (see the `t` encoding in sim.js), so wildlife needs a sentinel of
 * its own rather than the bare -1 it used before queens existed. It lives here
 * because queens are the reason it has to exist.
 */
export const POP_WILD = -99;

/** What a body is worth as experience. Derived from price so it needs no table. */
export const xpOf = (cost) => Math.max(1, Math.round(cost / 45));

export const QUEENS = {
  formica: {
    name: 'Warqueen', art: 'formica', species: 'hero',
    color: '#c8452c', dark: '#5e1a0c', scale: 1.05, radius: 16,
    hp: 620, damage: 60, cooldown: 0.9, speed: 44, range: 30, armor: 4,
    ability: {
      icon: '✸', id: 'onslaught', name: 'Onslaught', duration: 6,
      blast: { r: 62, damage: 70 }, speedMul: 1.35,
      tagline: 'For 6 seconds every bite she lands craters the ground around it, and she charges.',
    },
    tagline: 'Heavy, armoured, walks at the front of the column.',
  },
  vespula: {
    name: 'Silkqueen', art: 'vespula', species: 'hero',
    color: '#2fa7a0', dark: '#0e4f4b', scale: 0.95, radius: 14,
    hp: 430, damage: 26, cooldown: 1.0, speed: 42, range: 122, armor: 0,
    slow: { mul: 0.62, dur: 1.5 }, vsDefender: true,
    ability: {
      icon: '❋', id: 'snare', name: 'Snare', r: 140, slow: { mul: 0.35, dur: 4 },
      tagline: 'Every enemy ant near her is webbed to a crawl for 4 seconds.',
    },
    tagline: 'Spins from the back rank and outranges a pad.',
  },
  melissa: {
    name: 'Honeyqueen', art: 'melissa', species: 'hero',
    color: '#e8952f', dark: '#7a4a12', scale: 1.0, radius: 15,
    hp: 520, damage: 34, cooldown: 1.0, speed: 40, range: 62, armor: 2,
    income: 4,           // she is a walking honeypot, but only while she lives
    ability: {
      icon: '✚', id: 'honeydew', name: 'Honeydew', r: 150, heal: 100, sugar: 130,
      tagline: 'Heals every one of your ants near her and pays the colony 130 sugar.',
    },
    tagline: 'Adds 4 sugar a second while she is alive, and patches up a push.',
  },
  sergeant: {
    name: 'Broodqueen', art: 'sergeant', species: 'hero',
    color: '#8e5bc6', dark: '#43246b', scale: 1.0, radius: 15,
    hp: 470, damage: 30, cooldown: 1.1, speed: 40, range: 92, armor: 0,
    vsDefender: true,
    ability: {
      icon: '❖', id: 'levy', name: 'Levy', count: 4,
      tagline: 'Four free workers boil out of the ground beside her.',
    },
    tagline: 'Fights at range and calls up bodies out of nothing.',
  },
};

export const QUEEN_IDS = Object.keys(QUEENS);
export const DEFAULT_QUEEN = 'formica';

/**
 * hasOwn, never truthiness. QUEENS['__proto__'] is Object.prototype, which is
 * truthy, and a `!def` guard would let a client pick it as its queen.
 */
export const isQueen = (id) => Object.hasOwn(QUEENS, id);
export const cleanQueen = (id) => (isQueen(id) ? id : DEFAULT_QUEEN);

/** The stats she actually fights with at this level. */
export function queenStats(id, level = 1) {
  const base = QUEENS[isQueen(id) ? id : DEFAULT_QUEEN];
  const n = Math.max(0, Math.min(HERO.maxLevel, level) - 1);
  const out = { ...base };
  // deep-clone anything the sim mutates, or a slow applied to one queen edits
  // the shared QUEENS entry for every match in the process
  if (base.slow) out.slow = { ...base.slow };
  out.hp = Math.round(base.hp * HERO.hpPerLevel ** n);
  out.damage = Math.round(base.damage * HERO.damagePerLevel ** n);
  return out;
}

/** Total xp to reach a level, and how far into the current one she is. */
export function xpNeeded(level) {
  return HERO.ladder[Math.min(level + 1, HERO.ladder.length - 1)] ?? Infinity;
}

export function respawnFor(level) {
  return HERO.respawn + HERO.respawnPerLevel * Math.max(0, level - 1);
}
