// ===== Map builder =====
// Turns a map definition into a live board: walkable paths, both teams' pads,
// and the mirrored copy of every play feature.
//
// A built map is a VALUE, never module state. The server runs many rooms at once
// and they can be on different maps, so nothing here may be global and mutable.

import { buildPath, posAt, clamp, dist } from './util.js';
import { FOOD } from './data/board.js';
import { MAPS, MAP_IDS, DEFAULT_MAP, WORLD_W, WORLD_H } from './data/maps.js';
import { RING_BOARDS } from './data/ring.js';

/** Duelling boards and ring boards live in one list; `kind` says which. */
const ALL = [...MAPS, ...RING_BOARDS];

const CENTER = WORLD_W / 2;
const onCenter = (x) => Math.abs(x - CENTER) < 1;
const mirrorX = (x) => WORLD_W - x;

/** Author a feature once on the left; get it on both sides. */
function bothSides(list = []) {
  const out = [];
  for (const f of list) {
    out.push({ ...f, side: 0 });
    if (!onCenter(f.x)) out.push({ ...f, x: mirrorX(f.x), side: 1 });
  }
  return out;
}

export function buildMap(id = DEFAULT_MAP) {
  const def = ALL.find((m) => m.id === id) || ALL.find((m) => m.id === DEFAULT_MAP);
  const W = def.width ?? WORLD_W;
  const H = def.height ?? WORLD_H;
  const ring = def.kind === 'ring';

  // A LANE RUNS BETWEEN TWO COLONIES. On the mirrored boards every road joins
  // the only two there are, so `ends` defaults to [0, 1] and nothing changes.
  // A ring board sets it per lane, and that is what lets an ant know whose nest
  // it just walked into without assuming there is exactly one other colony.
  const lanes = def.lanes.map((l, i) => ({
    ...l, id: i, ends: l.ends || [0, 1], path: buildPath(l.points),
  }));
  const laneLen = lanes.map((l) => l.path.length);

  const mounds = bothSides(def.mounds);
  const hazards = bothSides(def.hazards);
  const darkPools = def.dark ? bothSides(def.dark.pools) : [];

  // A pad's reach is decided by where it stands: up on a crumb pile it sees
  // further, out beyond the lantern light it sees less.
  const padRangeMul = (x, y) => {
    let mul = 1;
    for (const m of mounds) if (dist(x, y, m.x, m.y) <= m.r) mul *= m.range;
    if (def.dark) {
      const lit = darkPools.some((p) => dist(x, y, p.x, p.y) <= p.r);
      if (!lit) mul *= def.dark.range;
    }
    return Math.round(mul * 1000) / 1000;
  };

  // A duelling board authors its pads once and mirrors them. A ring board has
  // already placed every colony's pads by rotating colony 0's, so they are taken
  // as they are and only re-indexed per colony.
  const mkPads = (team) => (ring
    ? def.pads.filter((p) => p.team === team)
      .map((p, i) => ({ i, lane: p.lane, x: p.x, y: p.y, team, rangeMul: padRangeMul(p.x, p.y) }))
    : def.pads.map((p, i) => {
      const x = team === 0 ? p.x : mirrorX(p.x);
      return { i, lane: p.lane, x, y: p.y, team, rangeMul: padRangeMul(x, p.y) };
    }));

  const teams = def.teams ?? 2;
  const nestX = def.nestX ?? 74;
  const map = {
    id: def.id,
    name: def.name,
    tag: def.tag,
    theme: def.theme,
    blurb: def.blurb,
    note: def.note,
    kind: def.kind || 'mirror',
    teams,
    // The aphid herd sits dead centre, which is the one spot that needs no
    // mirroring and no rotating. It used to be a fixed (480, 320) in the tuning
    // file, which WAS the centre back when every board was 960x640; on a wider
    // ring board that put it nearer some colonies than others.
    food: { x: W / 2, y: H / 2, r: def.food?.r ?? FOOD.r },
    width: W,
    height: H,
    lanes,
    laneLen,
    pads: Array.from({ length: teams }, (_, t) => mkPads(t)),
    nests: ring ? def.nests.map((n) => ({ ...n })) : [
      { team: 0, x: nestX, y: 320, r: 46 },
      { team: 1, x: mirrorX(nestX), y: 320, r: 46 },
    ],
    mounds,
    hazards,
    dark: def.dark ? { ...def.dark, pools: darkPools } : null,
    props: def.props || [],

    /** Whose nest sits at the end of this lane an ant walking `dir` is heading for. */
    laneFoe(lane, dir) {
      const e = lanes[lane].ends;
      return dir > 0 ? e[1] : e[0];
    },

    /** Which end of this lane a colony starts from, or -1 if the lane misses it. */
    laneSideFor(lane, team) {
      const e = lanes[lane].ends;
      if (e[0] === team) return 1;    // walk forwards, toward e[1]
      if (e[1] === team) return -1;   // walk backwards, toward e[0]
      return 0;                       // this road does not touch your nest
    },

    /** Every lane that touches a colony's nest. */
    lanesFor(team) {
      return lanes.filter((l) => l.ends.includes(team)).map((l) => l.id);
    },

    /**
     * The road that carries on out of `at`, away from where this one came from.
     * Null when there is nowhere to carry on to.
     *
     * This is what a raider does when the nest at the end of its road is already
     * rubble: it walks through the ruins and out the other side. Without it a
     * ring comes APART as colonies fall, because roads only ever joined
     * neighbours: knock out the two colonies either side of somebody and they
     * can no longer reach anyone, and nobody can reach them. Measured on a ring
     * of six, that happened in 8 matches out of 12 and the marooned colony won 4
     * of them, having spent the endgame unable to fight at all.
     *
     * The continuing road keeps its place in the pair, so the inner road runs on
     * into the inner one. That is a rotational invariant, which is what keeps a
     * ring board fair while it is being taken apart.
     *
     * On a duelling board every road touches both colonies, so there is never a
     * road that leads onward and this always returns null.
     */
    onwardFrom(lane, at) {
      const came = lanes[lane];
      const from = came.ends[0] === at ? came.ends[1] : came.ends[0];
      const mine = lanes.filter((l) => l.ends.includes(at));
      const back = mine.filter((l) => l.ends.includes(from));
      const on = mine.filter((l) => !l.ends.includes(from));
      if (!on.length) return null;
      const slot = Math.max(0, back.indexOf(came));
      const next = on[slot % on.length];
      return { lane: next.id, dir: next.ends[0] === at ? 1 : -1 };
    },

    /** World position and heading at distance `d` along a lane. */
    laneAt(lane, d, out = { x: 0, y: 0, angle: 0, seg: 0 }, hint = 0) {
      const p = lanes[lane].path;
      return posAt(p, clamp(d, 0, p.length), out, hint);
    },

    /** Speed multiplier for a raider standing at (x, y). 1 means clear going. */
    slowAt(x, y) {
      let mul = 1;
      for (const h of hazards) if (dist(x, y, h.x, h.y) <= h.r) mul = Math.min(mul, h.slow);
      return mul;
    },
  };
  return map;
}

/**
 * Menu data: enough to draw a map card without building the whole thing.
 * Defaults to the duelling boards; ask for a colony count to get ring boards.
 */
export function mapList(teams = 2) {
  return ALL.filter((m) => (m.teams ?? 2) === teams).map((m) => ({
    id: m.id, name: m.name, tag: m.tag, blurb: m.blurb, note: m.note,
    theme: m.theme, teams: m.teams ?? 2,
  }));
}

/** The board this many colonies play on. */
export const boardForTeams = (n) => (n === 2 ? DEFAULT_MAP : `ring${n}`);
export const ALL_MAP_IDS = ALL.map((m) => m.id);

export { MAP_IDS, DEFAULT_MAP, WORLD_W, WORLD_H };
