// Which seat is winning, and WHY: the discriminating probe for a per-board
// win lean in bot self-play.
//   node tools/seatprobe.js [map] [matches]
//
// Three variants of the same seeded match:
//   base   the balance harness as it stands (even ticks: B thinks first)
//   phase  the think alternation flipped   (even ticks: A thinks first)
//   ids    the brains swap seats: 'A' plays team 1, 'B' plays team 0
//
// Reading the table:
//   wins follow the VARIANT's phase  -> think order is deciding matches, the
//                                       instrument is biased, pool both phases
//   wins follow the brain ID         -> per-seed RNG stream luck, pool more
//                                       seeds and stop worrying
//   wins follow the TEAM everywhere  -> the sim itself favours a seat, dig on

import { Sim } from '../shared/sim.js';
import { AiBrain } from '../shared/ai.js';
import { DT, TUNING } from '../shared/data/board.js';
import { QUEEN_IDS } from '../shared/data/heroes.js';

const MAP = process.argv[2] || 'gully';
const N = Number(process.argv[3] || 40);
// a different base walks a different seed family: the tell between "this
// family froze lucky" and "something structural favours one brain"
const BASE = Number(process.argv[4] || 1000);
const STEP = Number(process.argv[5] || 7);

function play(seed, map, { flip = false, swap = false } = {}) {
  const sim = new Sim({
    mode: 'versus',
    map,
    seed,
    players: [
      { id: swap ? 'B' : 'A', name: 't0', team: 0, queen: QUEEN_IDS[seed % QUEEN_IDS.length] },
      { id: swap ? 'A' : 'B', name: 't1', team: 1, queen: QUEEN_IDS[seed % QUEEN_IDS.length] },
    ],
  });
  const first = new AiBrain(sim, swap ? 'B' : 'A', 'normal');   // team 0's brain
  const second = new AiBrain(sim, swap ? 'A' : 'B', 'normal');  // team 1's brain
  while (!sim.over && sim.t < TUNING.matchCap + 1) {
    sim.step(DT);
    const even = sim.tick % 2 === 0;
    // base: even ticks second-first (what tools/balance.js line 61 does)
    const aFirst = flip ? even : !even;
    if (aFirst) { first.update(DT); second.update(DT); } else { second.update(DT); first.update(DT); }
    sim.fx.length = 0;
  }
  return sim.winner;
}

const rows = [];
const wins = { base: [0, 0, 0], phase: [0, 0, 0], ids: [0, 0, 0] };
for (let i = 0; i < N; i++) {
  const seed = BASE + i * STEP;   // default: the family tools/balance.js runs
  const base = play(seed, MAP);
  const phase = play(seed, MAP, { flip: true });
  const ids = play(seed, MAP, { swap: true });
  rows.push({ seed, base, phase, ids });
  wins.base[base < 0 ? 2 : base]++;
  wins.phase[phase < 0 ? 2 : phase]++;
  wins.ids[ids < 0 ? 2 : ids]++;
}

console.log(`\n${MAP}: ${N} seeds, three variants each`);
for (const k of ['base', 'phase', 'ids']) {
  console.log(`  ${k.padEnd(6)} team 0 wins ${String(wins[k][0]).padStart(2)}   team 1 wins ${String(wins[k][1]).padStart(2)}   draws ${wins[k][2]}`);
}

const flippedByPhase = rows.filter((r) => r.base !== r.phase).length;
console.log(`\n  winner changed when the think phase flipped: ${flippedByPhase}/${N}`);

// in the ids variant, brain 'A' holds team 1: a win for the BRAIN 'A' there is
// a team-1 win. If the lean follows the brain, base team-0 wins should match
// ids team-1 wins seed by seed.
const followsBrain = rows.filter((r) => r.base >= 0 && r.ids >= 0 && r.base === 1 - r.ids).length;
const followsTeam = rows.filter((r) => r.base >= 0 && r.ids >= 0 && r.base === r.ids).length;
console.log(`  winner followed the brain across the ids swap: ${followsBrain}/${N}`);
console.log(`  winner stayed with the team across the ids swap: ${followsTeam}/${N}`);

console.log('\n  seed   base  phase  ids');
for (const r of rows) {
  console.log(`  ${String(r.seed).padStart(5)}   ${r.base}     ${r.phase}      ${r.ids}`);
}
