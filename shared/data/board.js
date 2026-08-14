// ===== Match tuning and shared constants — pure data =====
// Board GEOMETRY (lanes, pads, nests, props) is per-map and lives in
// data/maps.js; this file holds the numbers that are the same on every board.

export { WORLD_W, WORLD_H } from './maps.js';

export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ;

export const TUNING = {
  // Sized against the economy three times over. When raiding started paying for
  // itself both purses roughly doubled and a 100hp nest fell in 1.9 minutes, so
  // it went to 220. Then loadouts cut everyone to five of seven ants, defences
  // thinned, and matches dropped to 3.0 minutes, so it went to 290. Then queens
  // arrived and it went to 260 — but that was measured against a QUEEN THAT
  // CORKED HER OWN LANE. She halts partway down the road, and while she was
  // part of column separation every raider her colony sent queued up behind her
  // forever. What looked like "attrition lengthening matches" was a traffic jam.
  // With her out of the column the game runs freely again and the nest went to
  // 330, which is the first value this number has been ABOVE its pre-queen 290:
  // she is an extra body on the board and no longer a wall in front of one.
  //
  // Her HP is not the lever: cutting all four queens by a third moved match
  // length 0.26 of a minute. Retune this whenever the economy or the roster
  // changes: node tools/balance.js 8 normal normal all
  nestHp: 330,
  startSugar: 260,
  // Passive income is now a trickle, not the engine. It exists so a player who
  // loses everything can still act; growth is supposed to come from raiding.
  // It used to run 12 to 34 on its own, which made sitting still a strategy.
  incomeBase: 10,
  incomeRamp: 0.035,     // sugar/sec added per second of match time
  incomeCap: 18,
  // Eco earned from raiding. Each purchase is worth less the richer you already
  // are, falling to ecoFloor of its value at the cap. Without that taper, eco is
  // a pure compounding engine: money buys money, and leading at 2:00 converted
  // to a win 88% of the time. Diminishing returns make it a race you can lose
  // ground in and still be in.
  ecoCap: 30,
  ecoFloor: 0.25,
  padSlots: 4,           // per team in 1v1; split 2/2 between the two humans in co-op
  sellRefund: 0.6,
  // Losing a nest bite pays the victim: a deficit funds the counter-push instead
  // of being pure loss. Without this, leading at 2:00 won 73% of bot matches.
  // Roughly half what the attacker paid for the ants that got through, never
  // more: at 16 a Worker pair cost 120 to send and handed the victim 160, so
  // hitting someone first actively helped them and first blood converted to a
  // win only 38% of the time.
  leakRefund: 6,         // sugar per point of nest damage taken
  // and it pays more the further behind you are, up to double at a full nest
  // of deficit. This is the deliberate rubber band, and it is visible in the HUD.
  leakDesperation: 1.0,
  // A hard ceiling so a stalled lane cannot melt the server or the framerate:
  // two bots pouring into one contested lane peaked at 312 ants before this.
  maxUnitsPerPlayer: 55,
  // ...but the ceiling that matters is what the BOARD can draw, not what one
  // player can buy. Two a side is four purses feeding one board: peak went from
  // 64 ants to 201, and a measured frame at 110 ants with effects running
  // already costs 26ms, so 200 would be a slideshow. A colony with team-mates
  // gets more than a lone player but nowhere near double, and the budget is
  // still PER PLAYER so a greedy team-mate cannot starve the other one.
  teamCapMul: 0.68,
  // sudden death: from 8:00 both nests bleed, so nobody turtles forever
  suddenDeathAt: 480,
  suddenDeathDps: 2,
  matchCap: 720,
  // a raider that walks into a friendly's back slows to its pace instead of
  // stacking on top of it — this is what makes a push look like a column
  columnGap: 15,
  // AI colony income handicaps
  aiIncomeMul: { easy: 0.85, normal: 1.0, hard: 1.25, coop: 1.7 },
};

/**
 * Pheromone trails. Real ants lay a trail and the good trails get reinforced by
 * the ants that follow them, so this is the one mechanic in the game that came
 * from the animal rather than from the genre.
 *
 * A colony marks one road; its own ants move faster along it. The mark fades on
 * its own, but ants walking the road top it up, so a road you are actually using
 * stays fast and a road you abandoned goes cold. That is the whole loop: a small
 * cheap thing to do between purchases that pays off only if you follow it up.
 *
 * Per team, per lane, which makes it fair by construction: there is no geometry
 * in it to mirror. It is capped so it can never become a second Rally, and the
 * cost is low enough to be a habit rather than a decision you agonise over.
 */
export const PHEROMONE = {
  cost: 30,
  cooldown: 1.4,     // so a held key cannot pour the whole purse into one road
  perMark: 0.34,     // how much one mark lays down, out of a maximum of 1
  decay: 0.055,      // strength lost per second with nobody walking it
  // An ant on the road tops it up, but only to reinforceCap. That ceiling is
  // the whole balance of the mechanic and it was wrong the first time: at 0.75
  // a committed column drifted to three quarters of the maximum bonus for free
  // and marking only ever bought the last quarter, so there was no reason to do
  // the thing the feature exists for. At 0.35 traffic HOLDS a trail and only
  // marking BUILDS one, which is the loop that was wanted:
  //   column arrives          -> drifts to 0.35   (+9% speed, free)
  //   mark, and mark again    -> up to 1.00       (+25% speed, 60 sugar)
  //   stop marking            -> sags back to 0.35 while the column holds
  perAnt: 0.008,
  reinforceCap: 0.35,
  // Full strength is a quarter faster for that colony on that road. Swept 0.16
  // to 0.30 against the balance harness and breach rate barely moved (28.5% to
  // 30.8%, inside the run-to-run noise), so this is chosen for feel rather than
  // to hit a number: enough that a marked road is visibly quicker, not so much
  // that it beats spending the same sugar on another ant.
  speed: 0.25,
};

/**
 * The aphid herd. It sits dead centre, so it is fair by construction, and it
 * pays whoever keeps more ants standing on it. Without this the middle of the
 * board is just somewhere the lanes pass through and there is no reason to hold
 * ground rather than race past each other.
 */
export const FOOD = {
  x: 480,          // dead centre: the only position that needs no mirroring
  y: 320,
  r: 96,
  rate: 11,        // sugar/sec to whoever holds it
  tip: 0.55,       // how fast the tug moves, per second, at a 3-ant advantage
  claimAt: 0.6,    // |hold| above this and it starts paying
};

// Neutral wildlife wanders a lane and pays out to whoever kills it. Reuses the
// bug art from the TD game and gives both players something to fight over.
export const WILDLIFE = {
  enabled: true,
  firstAt: 35,
  every: 55,
  jitter: 12,
  types: [
    { type: 'snail', hp: 900, speed: 9, bounty: 190, radius: 20 },
    { type: 'caterpillar', hp: 1400, speed: 12, bounty: 300, radius: 24 },
    { type: 'pillbug', hp: 700, speed: 14, bounty: 150, radius: 17 },
  ],
};

/**
 * Colony colours. Both colonies field the same nine species, so the tint is the
 * only thing telling you whose ant you are looking at, which makes this a
 * gameplay-legibility setting wearing the clothes of a cosmetic one.
 *
 * `mixT` is how hard the colour pulls the species art toward itself, and it is
 * NOT the same for every entry: the ant roster is mostly warm already, so a cool
 * colour has to pull about twice as hard to register. Frost at 0.34 still read
 * as Ember's ants. Warm colours sit near 0.22 to 0.3 or the species stop being
 * distinguishable from each other.
 *
 * This is not a palette swap. It is read by the tint cache in js/board.js, by
 * the baked nest damage stages in js/scenery.js, and by the result card in
 * js/record.js, all of which cache and must be rebuilt when it changes. The
 * client side of that lives in js/colors.js.
 */
export const COLONY_COLORS = [
  { id: 'ember', name: 'Ember', accent: '#e2472f', mix: '#ff6a2e', mixT: 0.22, ring: '#ff8a52' },
  { id: 'frost', name: 'Frost', accent: '#2f5fd0', mix: '#3d6fd8', mixT: 0.5, ring: '#8cbcff' },
  { id: 'moss', name: 'Moss', accent: '#3f8f2a', mix: '#57b23a', mixT: 0.46, ring: '#a6e07c' },
  { id: 'plum', name: 'Plum', accent: '#8a3fb0', mix: '#a24fd0', mixT: 0.46, ring: '#d9a6f2' },
  { id: 'amber', name: 'Amber', accent: '#d99000', mix: '#ffb02e', mixT: 0.3, ring: '#ffd98a' },
  { id: 'teal', name: 'Teal', accent: '#128f8a', mix: '#16a8a2', mixT: 0.48, ring: '#7fe6e0' },
];

export const COLOR_IDS = COLONY_COLORS.map((c) => c.id);
export const DEFAULT_COLORS = ['ember', 'frost'];

/** hasOwn-equivalent for a list: an index lookup cannot be poisoned, but a find can miss. */
export const colorById = (id) => COLONY_COLORS.find((c) => c.id === id) || null;
export const isColor = (id) => !!colorById(id);
export const cleanColor = (id, fallback = 'ember') => (isColor(id) ? id : fallback);

/**
 * No two colonies may wear the same colour, because the colour is the only
 * thing telling their ants apart.
 *
 * Earlier colonies keep what they asked for and later ones move to the first
 * free colour, so the outcome depends on seat order rather than on who clicked
 * last. There are exactly as many colours as the largest game allows, so this
 * can always find one. Never fewer than two, since that is the smallest match.
 */
export function resolveColors(wanted = []) {
  const n = Math.max(2, wanted.length);
  const taken = new Set();
  const out = [];
  for (let i = 0; i < n; i++) {
    let pick = isColor(wanted[i]) ? wanted[i] : DEFAULT_COLORS[i] ?? null;
    if (!pick || taken.has(pick)) pick = COLOR_IDS.find((id) => !taken.has(id));
    taken.add(pick);
    out.push(pick);
  }
  return out;
}

/** The default pair, kept as a plain two-entry array for anything not in a match. */
export const TEAM_TINT = [colorById('ember'), colorById('frost')];
