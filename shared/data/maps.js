// ===== Maps — pure data, no imports =====
//
// Two worlds. Two boards are the FOREST FLOOR seen from just above the litter;
// two are a CROSS-SECTION of the soil with the tunnels cut open. `theme` picks
// which painters run (see js/scenery.js).
//
// FAIRNESS BY CONSTRUCTION. Anything that touches play is authored ONCE for the
// left half and mirrored by buildMap(): pads, mounds, hazards. You cannot forget
// to mirror them because you never write the right half.
//
// Lanes are the exception: a lane spans the whole board, so each one has to be
// its own mirror image about x = 480 (point i mirrored equals point n-1-i).
// tools/mapcheck.js verifies every lane of every map, and so does the test suite.
//
// `props` are DECORATION ONLY and are deliberately NOT mirrored. Nothing reads
// them but the painter, and a perfectly symmetrical forest floor looks like
// wallpaper. The one exception is `fungus` on the deep board, which the painter
// glows and which sits on the same spots as `dark.pools`.
//
// Per-map play features, all of which resolve to two numbers the sim understands:
//   mounds  { x, y, r, range }  a pad standing here reaches further
//   hazards { x, y, r, slow }   a raider crossing here is slowed
//   dark    { pools:[{x,y,r}], range }  pads OUTSIDE a pool of light see less

export const WORLD_W = 960;
export const WORLD_H = 640;

export const MAPS = [
  {
    id: 'litter',
    name: 'Leaf Litter',
    tag: 'Open',
    theme: 'litter',
    world: 'Forest floor',
    blurb: 'Three trails worn through the leaf mould. Nothing in the way, nowhere to hide.',
    note: 'Two spoil heaps are high ground. Build on one and that pad reaches further.',
    lanes: [
      { name: 'High Road', key: 'A', points: [[112, 296], [212, 168], [350, 120], [480, 108], [610, 120], [748, 168], [848, 296]] },
      { name: 'Short Road', key: 'S', points: [[120, 320], [300, 356], [480, 300], [660, 356], [840, 320]] },
      { name: 'Low Road', key: 'D', points: [[112, 344], [212, 472], [350, 520], [480, 532], [610, 520], [748, 472], [848, 344]] },
    ],
    pads: [
      { lane: 0, x: 252, y: 208 },
      { lane: 1, x: 412, y: 262 },
      { lane: 1, x: 412, y: 378 },
      { lane: 2, x: 252, y: 432 },
    ],
    mounds: [{ x: 252, y: 208, r: 34, range: 1.18 }, { x: 252, y: 432, r: 34, range: 1.18 }],
    hazards: [],
    props: [
      { kind: 'leaf', x: 806, y: 150, r: 62, a: 0.4, dead: true },
      { kind: 'leaf', x: 118, y: 128, r: 44, a: -0.8, dead: true },
      { kind: 'leaf', x: 620, y: 596, r: 52, a: 0.9 },
      { kind: 'leaf', x: 300, y: 44, r: 38, a: -0.3, dead: true },
      { kind: 'twig', x: 130, y: 556, r: 58, a: 0.22 },
      { kind: 'twig', x: 872, y: 430, r: 44, a: -1.3 },
      { kind: 'acorn', x: 872, y: 96, r: 26 },
      { kind: 'toadstool', x: 60, y: 246, r: 22 },
      { kind: 'toadstool', x: 84, y: 282, r: 15 },
      { kind: 'moss', x: 540, y: 610, r: 54 },
      { kind: 'moss', x: 40, y: 44, r: 40 },
      { kind: 'needle', x: 700, y: 250, r: 30, a: 0.7 },
      { kind: 'needle', x: 396, y: 596, r: 26, a: -0.4 },
      { kind: 'needle', x: 236, y: 96, r: 24, a: 1.2 },
      { kind: 'stone', x: 928, y: 300, r: 30 },
    ],
  },

  {
    id: 'gully',
    name: 'Rain Gully',
    tag: 'Tight',
    theme: 'gully',
    world: 'Forest floor',
    blurb: 'A washed-out channel where every trail runs close. Splash damage is worth double in here.',
    note: 'Standing water sits across the middle of every trail. Ants wade.',
    lanes: [
      { name: 'High Road', key: 'A', points: [[112, 300], [240, 196], [400, 188], [480, 150], [560, 188], [720, 196], [848, 300]] },
      { name: 'Short Road', key: 'S', points: [[120, 320], [280, 320], [430, 352], [480, 352], [530, 352], [680, 320], [840, 320]] },
      { name: 'Low Road', key: 'D', points: [[112, 340], [240, 444], [400, 452], [480, 490], [560, 452], [720, 444], [848, 340]] },
    ],
    pads: [
      { lane: 0, x: 268, y: 262 },
      { lane: 1, x: 372, y: 268 },
      { lane: 1, x: 372, y: 396 },
      { lane: 2, x: 268, y: 380 },
    ],
    mounds: [],
    hazards: [
      { x: 330, y: 214, r: 62, slow: 0.62 },
      { x: 330, y: 430, r: 62, slow: 0.62 },
      { x: 396, y: 336, r: 54, slow: 0.62 },
    ],
    props: [
      { kind: 'puddle', x: 330, y: 214, r: 62 },
      { kind: 'puddle', x: 630, y: 214, r: 62 },
      { kind: 'puddle', x: 330, y: 430, r: 62 },
      { kind: 'puddle', x: 630, y: 430, r: 62 },
      { kind: 'puddle', x: 396, y: 336, r: 54 },
      { kind: 'puddle', x: 564, y: 336, r: 54 },
      { kind: 'stone', x: 820, y: 106, r: 46 },
      { kind: 'stone', x: 110, y: 118, r: 32 },
      { kind: 'stone', x: 880, y: 552, r: 38 },
      { kind: 'twig', x: 180, y: 588, r: 64, a: -0.14 },
      { kind: 'leaf', x: 700, y: 596, r: 46, a: 1.1, dead: true },
      { kind: 'leaf', x: 60, y: 470, r: 40, a: 0.2, dead: true },
      { kind: 'dew', x: 540, y: 92, r: 40 },
      { kind: 'dew', x: 250, y: 120, r: 30 },
      { kind: 'moss', x: 930, y: 250, r: 44 },
    ],
  },

  {
    id: 'galleries',
    name: 'The Long Galleries',
    tag: 'Long',
    theme: 'galleries',
    world: 'Underground',
    blurb: 'Deep tunnels cut through old soil. Wide sweeping runs and a serpentine middle. Long walks, late fights.',
    note: 'A seep floods the middle gallery. Wet clay is slow going.',
    lanes: [
      { name: 'High Road', key: 'A', points: [[112, 300], [180, 150], [330, 96], [480, 132], [630, 96], [780, 150], [848, 300]] },
      { name: 'Short Road', key: 'S', points: [[120, 320], [260, 300], [400, 368], [480, 320], [560, 368], [700, 300], [840, 320]] },
      { name: 'Low Road', key: 'D', points: [[112, 340], [180, 490], [330, 544], [480, 508], [630, 544], [780, 490], [848, 340]] },
    ],
    pads: [
      { lane: 0, x: 244, y: 208 },
      { lane: 1, x: 340, y: 268 },
      { lane: 1, x: 340, y: 392 },
      { lane: 2, x: 244, y: 432 },
    ],
    mounds: [{ x: 340, y: 268, r: 32, range: 1.2 }],
    hazards: [{ x: 404, y: 356, r: 58, slow: 0.58 }],
    props: [
      { kind: 'seep', x: 404, y: 356, r: 58 },
      { kind: 'seep', x: 556, y: 356, r: 58 },
      { kind: 'root', x: 150, y: 60, r: 60, a: 1.2 },
      { kind: 'root', x: 700, y: 40, r: 74, a: 1.5 },
      { kind: 'root', x: 880, y: 420, r: 54, a: 2.4 },
      { kind: 'root', x: 60, y: 380, r: 48, a: 0.7 },
      { kind: 'grub', x: 812, y: 236, r: 18, a: 0.5 },
      { kind: 'grub', x: 140, y: 588, r: 15, a: -0.3 },
      { kind: 'pebblewall', x: 620, y: 610, r: 40 },
      { kind: 'pebblewall', x: 96, y: 140, r: 32 },
      { kind: 'stone', x: 900, y: 600, r: 34 },
      { kind: 'stone', x: 480, y: 40, r: 26 },
    ],
  },

  {
    id: 'deep',
    name: 'The Blind Deep',
    tag: 'Cruel',
    theme: 'deep',
    world: 'Underground',
    blurb: 'Every tunnel squeezes through one junction in the middle. One fight decides it.',
    note: 'Only the outer galleries have glowing fungus. Pads in the dark cannot see as far.',
    lanes: [
      { name: 'High Road', key: 'A', points: [[112, 296], [230, 180], [400, 240], [480, 306], [560, 240], [730, 180], [848, 296]] },
      { name: 'Short Road', key: 'S', points: [[120, 320], [290, 320], [440, 320], [480, 320], [520, 320], [670, 320], [840, 320]] },
      { name: 'Low Road', key: 'D', points: [[112, 344], [230, 460], [400, 400], [480, 334], [560, 400], [730, 460], [848, 344]] },
    ],
    pads: [
      { lane: 0, x: 244, y: 236 },
      { lane: 1, x: 368, y: 276 },
      { lane: 1, x: 368, y: 366 },
      { lane: 2, x: 244, y: 404 },
    ],
    mounds: [],
    hazards: [],
    // the fungus grows in the outer galleries. The junction in the middle, where
    // all three tunnels meet, is the part nobody can light.
    dark: {
      range: 0.78,
      pools: [{ x: 244, y: 236, r: 96 }, { x: 244, y: 404, r: 96 }],
    },
    props: [
      { kind: 'fungus', x: 244, y: 236, r: 96 },
      { kind: 'fungus', x: 244, y: 404, r: 96 },
      { kind: 'fungus', x: 716, y: 236, r: 96 },
      { kind: 'fungus', x: 716, y: 404, r: 96 },
      { kind: 'root', x: 120, y: 70, r: 56, a: 1.1 },
      { kind: 'root', x: 840, y: 590, r: 62, a: 2.2 },
      { kind: 'root', x: 520, y: 40, r: 44, a: 1.6 },
      { kind: 'grub', x: 620, y: 120, r: 16, a: 0.4 },
      { kind: 'grub', x: 300, y: 570, r: 13, a: -0.6 },
      { kind: 'pebblewall', x: 880, y: 130, r: 36 },
      { kind: 'pebblewall', x: 70, y: 560, r: 30 },
    ],
  },
];

export const MAP_IDS = MAPS.map((m) => m.id);
export const DEFAULT_MAP = 'litter';
