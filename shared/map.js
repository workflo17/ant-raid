// ===== Map builder =====
// Turns a map definition into a live board: walkable paths, both teams' pads,
// and the mirrored copy of every play feature.
//
// A built map is a VALUE, never module state. The server runs many rooms at once
// and they can be on different maps, so nothing here may be global and mutable.

import { buildPath, posAt, clamp, dist } from './util.js';
import { MAPS, MAP_IDS, DEFAULT_MAP, WORLD_W, WORLD_H } from './data/maps.js';

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
  const def = MAPS.find((m) => m.id === id) || MAPS.find((m) => m.id === DEFAULT_MAP);

  const lanes = def.lanes.map((l, i) => ({ ...l, id: i, path: buildPath(l.points) }));
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

  const mkPads = (team) => def.pads.map((p, i) => {
    const x = team === 0 ? p.x : mirrorX(p.x);
    return { i, lane: p.lane, x, y: p.y, team, rangeMul: padRangeMul(x, p.y) };
  });

  const nestX = def.nestX ?? 74;
  const map = {
    id: def.id,
    name: def.name,
    tag: def.tag,
    theme: def.theme,
    blurb: def.blurb,
    note: def.note,
    width: WORLD_W,
    height: WORLD_H,
    lanes,
    laneLen,
    pads: [mkPads(0), mkPads(1)],
    nests: [
      { team: 0, x: nestX, y: 320, r: 46 },
      { team: 1, x: mirrorX(nestX), y: 320, r: 46 },
    ],
    mounds,
    hazards,
    dark: def.dark ? { ...def.dark, pools: darkPools } : null,
    props: def.props || [],

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

/** Menu data: enough to draw a map card without building the whole thing. */
export function mapList() {
  return MAPS.map((m) => ({
    id: m.id, name: m.name, tag: m.tag, blurb: m.blurb, note: m.note, theme: m.theme,
  }));
}

export { MAP_IDS, DEFAULT_MAP, WORLD_W, WORLD_H };
