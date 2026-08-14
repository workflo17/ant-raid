// Audits every map: is the board the same shape from both ends, do the pads sit
// beside the road they claim rather than on it, and does a scripted match played
// identically from both sides end dead level?
//   node tools/mapcheck.js
import { Sim } from '../shared/sim.js';
import { buildMap } from '../shared/map.js';
import { distToPath, dist } from '../shared/util.js';
import { MAPS, WORLD_W } from '../shared/data/maps.js';
import { DT } from '../shared/data/board.js';
import { DEFENDERS } from '../shared/data/units.js';

let bad = 0;
const fail = (msg) => { console.log(`      FAIL  ${msg}`); bad++; };

for (const def of MAPS) {
  const map = buildMap(def.id);
  console.log(`\n${map.name}  (${map.id})  ${map.tag}`);

  // 1. every lane must be its own mirror image, or one colony walks further
  for (const l of map.lanes) {
    const p = l.points;
    let worst = 0;
    for (let i = 0; i < p.length; i++) {
      const j = p.length - 1 - i;
      worst = Math.max(worst, Math.abs((WORLD_W - p[j][0]) - p[i][0]), Math.abs(p[j][1] - p[i][1]));
    }
    console.log(`  lane ${l.id} ${l.name.padEnd(11)} len ${map.laneLen[l.id].toFixed(0).padStart(4)}  mirror error ${worst.toFixed(1)}px`);
    if (worst > 0.001) fail(`lane ${l.id} is not symmetric`);
  }

  // 2. pads: mirrored, off the road, and reaching the lane they advertise
  for (let i = 0; i < map.pads[0].length; i++) {
    const a = map.pads[0][i], b = map.pads[1][i];
    if (b.x !== WORLD_W - a.x || b.y !== a.y || b.lane !== a.lane) fail(`pad ${i} is not mirrored`);
    if (b.rangeMul !== a.rangeMul) fail(`pad ${i} reaches further on one side (${a.rangeMul} vs ${b.rangeMul})`);

    const own = distToPath(map.lanes[a.lane].path, a.x, a.y);
    const dists = map.lanes.map((l) => distToPath(l.path, a.x, a.y).toFixed(0));
    const reach = (k) => (DEFENDERS[k].range * a.rangeMul).toFixed(0);
    console.log(`  pad ${i} lane ${a.lane}  (${a.x},${a.y})  range x${a.rangeMul}  to lanes [${dists.join(', ')}]  worker reaches ${reach('worker')}`);
    const nearest = Math.min(...map.lanes.map((l) => distToPath(l.path, a.x, a.y)));
    if (nearest < 30) fail(`pad ${i} stands in a road (${nearest.toFixed(0)}px from the nearest lane)`);
    if (own > DEFENDERS.worker.range * a.rangeMul) fail(`pad ${i} cannot reach its own lane ${a.lane} with the cheapest defender`);
    if (a.x > WORLD_W / 2 - 40) fail(`pad ${i} is not safely inside its own half`);
  }

  // 3. pads must not be buried in a nest
  for (const p of map.pads[0]) {
    for (const n of map.nests) if (dist(p.x, p.y, n.x, n.y) < n.r + 20) fail(`pad ${p.i} overlaps a nest`);
  }

  // 4. features are mirrored by construction; check the builder actually did it
  for (const [label, list] of [['mound', map.mounds], ['hazard', map.hazards]]) {
    const left = list.filter((f) => f.side === 0), right = list.filter((f) => f.side === 1);
    if (left.length !== right.length) fail(`${label}s are lopsided (${left.length} vs ${right.length})`);
    for (const f of left) {
      if (!right.some((r) => r.x === WORLD_W - f.x && r.y === f.y && r.r === f.r)) fail(`${label} at ${f.x},${f.y} has no mirror`);
    }
  }
  if (map.mounds.length || map.hazards.length || map.dark) {
    const bits = [];
    if (map.mounds.length) bits.push(`${map.mounds.length} mounds`);
    if (map.hazards.length) bits.push(`${map.hazards.length} hazards`);
    if (map.dark) bits.push(`dark x${map.dark.range} outside ${map.dark.pools.length} pools`);
    console.log(`  features: ${bits.join(', ')}`);
  }

  // 5. the real test: identical play from both sides has to end level
  const sim = new Sim({
    mode: 'versus', map: map.id, seed: 4242, wildlife: false,
    players: [{ id: 'A', name: 'A', team: 0 }, { id: 'B', name: 'B', team: 1 }],
  });
  const order = ['worker', 'army', 'trapjaw', 'archer'];
  let acc = 0, k = 0, queened = false;
  while (!sim.over && sim.t < 260) {
    sim.step(DT);
    acc += DT;
    // Both queens walk out at the same second down the same road, so they meet
    // head-on. Two identical queens have to destroy each other: if one lives,
    // whichever colony sits first in the units array is landing a free blow.
    if (!queened && sim.t >= 20) {
      queened = true;
      for (const id of ['A', 'B']) sim.playerById(id).sugar += 400;
      for (const id of ['A', 'B']) {
        const r = sim.command(id, { kind: 'queen', lane: 1 });
        if (!r.ok) fail(`${id} could not field a queen: ${r.why}`);
      }
    }
    if (acc >= 3) {
      acc = 0;
      const unit = order[k % order.length], lane = k % map.lanes.length;
      k++;
      sim.command('A', { kind: 'send', unit, lane });
      sim.command('B', { kind: 'send', unit, lane });
      // and both lay scent on the same road, so the speed bonus has to be
      // mirror-exact as well as the geometry it applies to
      sim.command('A', { kind: 'mark', lane });
      sim.command('B', { kind: 'mark', lane });
    }
    sim.fx.length = 0;
  }
  const queens = [0, 1].map((t) => sim.units.filter((u) => u.kind === 'h' && u.team === t).length);
  const scentLevel = sim.pher[0].every((v, i) => v === sim.pher[1][i]);
  const level = scentLevel && sim.nestHp[0] === sim.nestHp[1]
    && sim.units.filter((u) => u.team === 0).length === sim.units.filter((u) => u.team === 1).length
    && queens[0] === queens[1]
    && sim.players[0].heroXp === sim.players[1].heroXp;
  console.log(`  identical script: nests ${sim.nestHp[0].toFixed(1)} / ${sim.nestHp[1].toFixed(1)}`
    + `  queens up ${queens[0]}/${queens[1]}  queen xp ${sim.players[0].heroXp}/${sim.players[1].heroXp}`
    + `  scent ${sim.pher[0].map((v) => v.toFixed(2)).join('/')} vs ${sim.pher[1].map((v) => v.toFixed(2)).join('/')}`
    + `  ${level ? 'dead level' : 'DIVERGED'}`);
  if (!level) fail('the same play from both sides gave different results');
}

console.log(bad ? `\n${bad} problem(s)` : '\nevery map is fair');
process.exit(bad ? 1 : 0);
