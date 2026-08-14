// ===== Ring boards: three to six colonies, nobody's friend =====
//
// The mirrored boards in maps.js are fair because everything that touches play
// is authored ONCE for the left half and reflected. You cannot forget to mirror
// something because you never write the right half.
//
// A ring board earns fairness the same way, one turn further round: everything
// is authored once for COLONY 0 and rotated by 360/n. There is no second half
// to write and no fourth colony to keep in step by hand, so a board for six is
// exactly as fair as a board for three and neither can drift.
//
// Two symmetries are doing the work, and both are needed:
//
//   ROTATIONAL, 360/n. Colony i's nest, pads and roads are colony 0's turned
//   through i steps, so every colony has the same board in front of it.
//
//   REFLECTIVE, about each colony's own radius. Colony 0's pads are authored in
//   mirrored pairs, which makes the whole arrangement dihedral. That is what
//   makes a ROAD fair as well as a colony: a road runs between two colonies, and
//   without the reflection the colony at one end would sit closer to it than the
//   colony at the other.
//
// Roads only ever join NEIGHBOURS. On a six-colony board you cannot reach the
// colony opposite, which is the whole shape of the mode: you have two people who
// can hurt you, and hitting one of them helps the other.

import { TAU } from '../util.js';

/** Wider than the duelling boards, because six nests need the room. */
export const RING_W = 1280;
export const RING_H = 860;

const RING = {
  nestRing: 330,      // how far each nest sits from the middle
  laneMid: 168,       // how close a road's midpoint comes to the middle
  lanesPerPair: 2,    // roads between each pair of neighbours
  laneGap: 26,        // how far apart those roads run
  samples: 15,        // points per road; odd, so one lands on the bisector
  // The herd has to be big enough that the roads actually cross it. Every road
  // bows in to `laneMid` from the middle, so a herd smaller than that is a prize
  // nobody can stand on: the first version had the duelling board's 96 against a
  // 168 bow and no ant ever touched it.
  foodR: 206,
  padOut: 96,         // how far a pad sits from its own nest
  padSpread: 0.42,    // how far round the wedge, in radians
};

// NO ROUNDING. Tidy four-decimal coordinates look harmless and are not: they
// perturb each colony's wedge by a different sub-pixel amount, so the rotation
// stops being exact and the boards stop being each other's copies. Full
// precision is the only version where colony 3 has the same board as colony 0.
const round4 = (v) => v;

/**
 * One colony's angle on the ring. Colony 0 sits at the top, and the rest follow
 * clockwise, so a four-colony board reads as up/right/down/left.
 */
const angleOf = (i, n) => -Math.PI / 2 + (i * TAU) / n;

/**
 * A road between colony `i` and its next neighbour round.
 *
 * Built in the frame of the pair rather than the board: `s` runs along the chord
 * between the two nests and is sampled symmetrically, and the bow toward the
 * middle depends on s squared. Both of those make the road its own mirror image
 * about the pair's bisector, which is what gives the two colonies at its ends
 * the same walk.
 */
function ringLane(i, n, cx, cy, offset) {
  const a0 = angleOf(i, n);
  const mid = a0 + Math.PI / n;                 // the bisector of this pair
  const rm = [Math.cos(mid), Math.sin(mid)];    // outward, along the bisector
  const tm = [-Math.sin(mid), Math.cos(mid)];   // across it, toward colony i+1

  const half = RING.nestRing * Math.sin(Math.PI / n);   // half the chord
  const base = RING.nestRing * Math.cos(Math.PI / n);   // the chord's own radius
  const bow = base - RING.laneMid;

  const pts = [];
  for (let k = 0; k < RING.samples; k++) {
    const u = -1 + (2 * k) / (RING.samples - 1);        // -1 .. +1, symmetric
    const s = half * u;
    // pull toward the middle, most at the halfway point, none at either nest
    const radial = base - bow * (1 - u * u) + offset;
    pts.push([
      round4(cx + rm[0] * radial + tm[0] * s),
      round4(cy + rm[1] * radial + tm[1] * s),
    ]);
  }
  return pts;
}

/**
 * A board for `n` colonies. Returns the same shape as an entry in MAPS, so
 * buildMap, the thumbnails and the map picker all treat it as an ordinary board.
 */
export function ringBoard(n) {
  const cx = RING_W / 2, cy = RING_H / 2;

  const nests = [];
  for (let i = 0; i < n; i++) {
    const a = angleOf(i, n);
    nests.push({
      team: i,
      x: round4(cx + Math.cos(a) * RING.nestRing),
      y: round4(cy + Math.sin(a) * RING.nestRing),
      r: 46,
    });
  }

  // Two roads between each pair of neighbours, offset either side of the line
  // between them, so a colony has four ways out: two at each neighbour.
  const lanes = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    for (let k = 0; k < RING.lanesPerPair; k++) {
      const offset = (k - (RING.lanesPerPair - 1) / 2) * RING.laneGap * 2;
      lanes.push({
        name: k === 0 ? `Outer to ${j + 1}` : `Inner to ${j + 1}`,
        key: '',                 // filled in per colony by the client
        ends: [i, j],
        points: ringLane(i, n, cx, cy, offset),
      });
    }
  }

  // Pads in mirrored pairs about each colony's own radius. The mirroring is what
  // makes a road fair to both colonies on it, not just each colony to itself.
  const pads = [];
  for (let i = 0; i < n; i++) {
    const a = angleOf(i, n);
    const mine = lanes.filter((l) => l.ends.includes(i)).map((l) => lanes.indexOf(l));
    // two pads leaning toward each neighbour, at matching angles either side
    const spots = [
      { turn: +RING.padSpread, out: RING.padOut },
      { turn: -RING.padSpread, out: RING.padOut },
      { turn: +RING.padSpread * 0.46, out: RING.padOut * 1.5 },
      { turn: -RING.padSpread * 0.46, out: RING.padOut * 1.5 },
    ];
    spots.forEach((sp, k) => {
      // out from the nest, and round toward one neighbour or the other
      const dir = a + Math.PI + sp.turn;     // back toward the middle of the board
      pads.push({
        team: i,
        // the lane this pad is meant to cover, so the build menu can name it
        lane: mine[k % mine.length],
        x: round4(nests[i].x + Math.cos(dir) * sp.out),
        y: round4(nests[i].y + Math.sin(dir) * sp.out),
      });
    });
  }

  return {
    id: `ring${n}`,
    name: RING_NAMES[n] || `Ring of ${n}`,
    tag: `${n} colonies`,
    theme: n % 2 ? 'litter' : 'galleries',
    world: n % 2 ? 'Forest floor' : 'Underground',
    kind: 'ring',
    teams: n,
    width: RING_W,
    height: RING_H,
    blurb: `${n} colonies in a ring, every one of them on their own.`,
    note: 'Roads only reach the colonies either side of you. Hitting one helps the other.',
    lanes,
    pads,
    nests,
    food: { r: RING.foodR },
    mounds: [],
    hazards: [],
    props: ringProps(n, cx, cy),
  };
}

const RING_NAMES = {
  3: 'The Three Stumps',
  4: 'Crossroads',
  5: 'The Five Hollows',
  6: 'The Wheel',
};

/** Decoration only, and deliberately not rotated: a perfect ring looks printed. */
function ringProps(n, cx, cy) {
  const props = [{ kind: 'moss', x: cx, y: cy, r: 120 }];
  const scatter = [
    ['twig', 0.4, 470, 58], ['leaf', 2.1, 505, 46], ['stone', 3.3, 445, 34],
    ['acorn', 4.4, 520, 26], ['needle', 5.2, 430, 28], ['toadstool', 1.3, 540, 20],
  ];
  for (const [kind, a, r, size] of scatter) {
    props.push({ kind, x: round4(cx + Math.cos(a) * r), y: round4(cy + Math.sin(a) * r), r: size, a });
  }
  return props;
}

export const RING_SIZES = [3, 4, 5, 6];
export const RING_BOARDS = RING_SIZES.map(ringBoard);
