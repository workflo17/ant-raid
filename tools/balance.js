// Bot-vs-bot tuning harness. Runs full matches headlessly and reports how they
// ended, so balance changes can be judged on outcomes instead of vibes.
//   node tools/balance.js [matches] [levelA] [levelB] [map|all]

import { Sim } from '../shared/sim.js';
import { AiBrain } from '../shared/ai.js';
import { DT, TUNING } from '../shared/data/board.js';
import { QUEEN_IDS, HERO } from '../shared/data/heroes.js';
import { MAP_IDS } from '../shared/data/maps.js';

const N = Number(process.argv[2] || 12);
const LA = process.argv[3] || 'normal';
const LB = process.argv[4] || 'normal';
const MAP = process.argv[5] || 'picnic';

function playMatch(seed, map) {
  const sim = new Sim({
    mode: 'versus',
    map,
    seed,
    // rotate the queens through the run so all four actually get played, and
    // give both colonies the SAME one per match: two different queens would mix
    // a queen matchup into every win split this harness prints
    players: [
      { id: 'A', name: 'A', team: 0, queen: QUEEN_IDS[seed % QUEEN_IDS.length] },
      { id: 'B', name: 'B', team: 1, queen: QUEEN_IDS[seed % QUEEN_IDS.length] },
    ],
  });
  const a = new AiBrain(sim, 'A', LA);
  const b = new AiBrain(sim, 'B', LB);
  let peakUnits = 0;
  const spend = { A: {}, B: {} };
  const wrap = (brain, key) => {
    const orig = brain.cmd.bind(brain);
    brain.cmd = (c) => {
      const r = orig(c);
      if (r.ok) {
        // KIND-QUALIFIED, or dead content hides in plain sight. The old key was
        // `c.unit || c.def || ...`, which folded caste upgrades into the unit
        // they upgrade and defender builds into the raider that shares their
        // species name. The caste system spent a whole audit looking unbought
        // because its purchases were filed under 'worker'.
        const name = c.kind === 'send' ? `send:${c.unit}`
          : c.kind === 'build' ? `build:${c.def}`
          : c.kind === 'upgrade' ? `up:${c.unit}`
          : c.kind === 'power' ? `power:${c.power}`
          : c.kind;
        spend[key][name] = (spend[key][name] || 0) + 1;
      }
      return r;
    };
  };
  wrap(a, 'A'); wrap(b, 'B');

  let arrived = 0, popped = 0;
  const firstBlood = [0, 0];
  while (!sim.over && sim.t < TUNING.matchCap + 1) {
    sim.step(DT);
    // alternate who acts first: acting first inside a tick is a real edge, and
    // holding it for a whole match was worth an 11-of-14 win rate on its own
    if (sim.tick % 2) { a.update(DT); b.update(DT); } else { b.update(DT); a.update(DT); }
    if (sim.units.length > peakUnits) peakUnits = sim.units.length;
    for (const f of sim.fx) {
      if (f[0] === 4) arrived++;          // FX.NEST — a raider got through
      else if (f[0] === 1) popped++;      // FX.POP  — a raider died on the way
    }
    for (const t of [0, 1]) if (!firstBlood[t] && sim.nestHp[t] < TUNING.nestHp) firstBlood[t] = sim.t;
    sim.fx.length = 0; // nobody is watching
  }
  return {
    winner: sim.winner,
    t: sim.t,
    queens: sim.players.map((p) => ({ q: p.queen, lv: p.heroLevel, falls: p.heroFalls, out: p.heroBought })),
    hp: sim.nestHp.map((h) => Math.round(h)),
    peakUnits,
    reason: sim.endReason,
    defs: sim.defs.length,
    arrived, popped,
    firstBlood,
    spend,
  };
}

const maps = MAP === 'all' ? MAP_IDS : [MAP];
const results = [];
for (const m of maps) for (let i = 0; i < N; i++) results.push({ ...playMatch(1000 + i * 7, m), map: m });

const wins = [0, 0, 0];
let totalT = 0, peak = 0;
const spendTotals = {};
for (const r of results) {
  wins[r.winner < 0 ? 2 : r.winner]++;
  totalT += r.t;
  peak = Math.max(peak, r.peakUnits);
  for (const side of ['A', 'B']) {
    for (const [k, v] of Object.entries(r.spend[side])) spendTotals[k] = (spendTotals[k] || 0) + v;
  }
}

console.log(`\n${results.length} matches  ${LA} (team 0) vs ${LB} (team 1)  on ${maps.join(', ')}`);
console.log(`  team 0 wins ${wins[0]}   team 1 wins ${wins[1]}   draws ${wins[2]}`);
console.log(`  mean length ${(totalT / results.length / 60).toFixed(1)} min   peak units on board ${peak}`);
const timeouts = results.filter((r) => r.reason.startsWith('out of time')).length;
const sudden = results.filter((r) => r.t > TUNING.suddenDeathAt).length;
console.log(`  reached sudden death ${sudden}/${results.length}   ran out the clock ${timeouts}/${results.length}`);
const arr = results.reduce((s, r) => s + r.arrived, 0);
const pop = results.reduce((s, r) => s + r.popped, 0);
const fb = results.reduce((s, r) => s + Math.max(...r.firstBlood), 0) / results.length;
console.log(`  raiders that reached a nest ${arr}   died en route ${pop}   breach rate ${(100 * arr / (arr + pop)).toFixed(1)}%`);
console.log(`  first blood on both nests by ${fb.toFixed(0)}s`);
// The queen only pays off if she actually levels. If mean level sits at 1 the
// whole levelling half of the feature is decoration.
const qs = results.flatMap((r) => r.queens);
const fielded = qs.filter((q) => q.out);
const meanLv = fielded.length ? fielded.reduce((s, q) => s + q.lv, 0) / fielded.length : 0;
const reachedAbility = fielded.filter((q) => q.lv >= HERO.abilityAt).length;
// ...and the ability only exists as content if fielded queens actually cast it.
// The audit target is 80 percent of queens casting at least once per match.
let cast = 0;
for (const r of results) for (const side of ['A', 'B']) if ((r.spend[side].ability || 0) > 0) cast++;
console.log(`  queens fielded ${fielded.length}/${qs.length}  mean level ${meanLv.toFixed(2)}  reached ability level ${reachedAbility}/${fielded.length}  cast at least once ${cast}/${fielded.length}  mean falls ${(fielded.reduce((s, q) => s + q.falls, 0) / Math.max(1, fielded.length)).toFixed(1)}`);

// The health of the ROSTER, not just the match. One unit above ~40 percent of
// sends means the purchase is solved and the other six are decoration; that is
// exactly what the first audit found (worker at 68 percent, majoress at one
// send in 24 matches) and what the eco flattening exists to prevent.
const sends = Object.entries(spendTotals).filter(([k]) => k.startsWith('send:'));
const totalSends = sends.reduce((s, [, v]) => s + v, 0);
if (totalSends) {
  const shares = sends.map(([k, v]) => `${k.slice(5)} ${(100 * v / totalSends).toFixed(0)}%`).join('  ');
  console.log(`  send shares: ${shares}`);
}
console.log('\n  purchases across all matches:');
for (const [k, v] of Object.entries(spendTotals).sort((x, y) => y[1] - x[1])) {
  console.log(`    ${k.padEnd(16)} ${String(v).padStart(4)}`);
}
console.log('\n  per match:');
for (const r of results) {
  console.log(`    ${r.map.padEnd(11)} ${String(Math.round(r.t)).padStart(4)}s  winner ${r.winner < 0 ? 'draw' : r.winner}  nests ${r.hp[0]}/${r.hp[1]}  ${r.reason}`);
}
