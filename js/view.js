// ===== Snapshot -> render view =====
// Both drivers hand the renderer the same shape, so the board never knows or
// cares whether the simulation is running here or on the server.

import { RAIDER_IDS, DEFENDER_IDS } from '../shared/data/units.js';
import { WILDLIFE, FOOD } from '../shared/data/board.js';
import { QUEEN_IDS, queenStats } from '../shared/data/heroes.js';

const lerp = (a, b, t) => a + (b - a) * t;
const scratch = { x: 0, y: 0, angle: 0, seg: 0 };

function place(map, lane, d, off, facing) {
  const p = map.laneAt(lane, d, scratch);
  const nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
  return {
    x: p.x + nx * off * 5.5,
    y: p.y + ny * off * 5.5,
    angle: facing > 0 ? p.angle : p.angle + Math.PI,
  };
}

/**
 * @param cur  latest snapshot
 * @param prev the one before it (pass cur for no interpolation)
 * @param a    0..1 blend between prev and cur
 */
export function buildView(map, cur, prev, a = 1) {
  const byId = new Map();
  if (prev && prev !== cur) for (const u of prev.u) byId.set(u[0], u);

  const units = cur.u.map((u) => {
    const [id, t, team, lane, d, hp, flags, off, lv = 0] = u;
    const p0 = byId.get(id);
    // only blend a unit that existed last snapshot and stayed in its lane
    const dd = p0 && p0[3] === lane ? lerp(p0[4], d, a) : d;
    // bit 16 of the flags is which way it is walking. It used to be guessed from
    // the colony number, which only works while there are two of them.
    const pos = place(map, lane, dd, off, flags & 16 ? -1 : 1);
    // a negative type is a queen, and which one. Her max health moves with her
    // level, so it is recomputed here rather than looked up from a fixed table.
    if (t < 0) {
      const q = QUEEN_IDS[-1 - t];
      return {
        id, k: q, hero: true, lv, maxHp: queenStats(q, lv).hp,
        team, lane, d: dd, hp, flags, off, ...pos,
      };
    }
    return { id, k: RAIDER_IDS[t], hero: false, lv: 0, team, lane, d: dd, hp, flags, off, ...pos };
  });

  const defs = cur.d.map(([id, t, team, pad, hp, atk, owner]) => {
    const spot = map.pads[team][pad];
    return { id, k: DEFENDER_IDS[t], team, pad, hp, atk, owner, x: spot.x, y: spot.y };
  });

  const walls = cur.w.map(([id, team, lane, d, hp]) => {
    const p = map.laneAt(lane, d, scratch);
    return { id, team, lane, d, hp, x: p.x, y: p.y };
  });

  const wildById = new Map();
  if (prev && prev !== cur) for (const w of prev.b) wildById.set(w[0], w);
  const wild = cur.b.map(([id, t, lane, d, hp, dir]) => {
    const p0 = wildById.get(id);
    const dd = p0 && p0[2] === lane ? lerp(p0[3], d, a) : d;
    const pos = place(map, lane, dd, 0, dir);
    return { id, k: WILDLIFE.types[t].type, def: WILDLIFE.types[t], lane, d: dd, hp, dir, ...pos };
  });

  return {
    n: cur.n,
    // interpolated like the ants are: the beetles and the tide are drawn
    // straight off this clock, and a 10Hz stepped clock gives stepped beetles
    t: prev && prev !== cur ? lerp(prev.t, cur.t, a) : cur.t,
    nestHp: cur.hp,
    nestOut: cur.out || cur.hp.map((h) => h <= 0),
    silks: (cur.sk || []).map(([x, y, team, r]) => ({ x, y, team, r })),
    crumbs: (cur.cr || []).map(([x, y]) => ({ x, y })),
    units, defs, walls, wild,
    food: {
      hold: cur.fd ? cur.fd[0] : 0,
      owner: cur.fd ? cur.fd[1] : -1,
      lead: cur.fd && cur.fd.length > 2 ? cur.fd[2] : -1,
      ...map.food,
    },
    rallies: cur.r,
    rains: cur.a,
    pher: cur.ph || [[0, 0, 0], [0, 0, 0]],
    players: cur.p,
    over: cur.over,
    winner: cur.win,
    why: cur.why,
    fx: cur.fx || [],
  };
}

/** How much force each side has standing in each lane — feeds the lane rail. */
export function lanePressure(view, lanes = 3, teams = 2) {
  const out = Array.from({ length: teams }, () => new Array(lanes).fill(0));
  for (const u of view.units) {
    if (!out[u.team]) continue;
    out[u.team][u.lane] += u.hp;
  }
  return out;
}
