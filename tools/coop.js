// Co-op tuning harness. tools/balance.js only ever runs a duel, so the co-op
// handicap has never been measured against anything: the bot's income multiplier
// was picked before queens existed and nobody re-checked it after.
//
// Two stand-in players share colony 0 and the handicapped bot holds colony 1,
// exactly as the `coop` room mode arranges it, and this reports how often the
// HUMAN SIDE wins. Both stand-ins run the same AiBrain the duel harness uses at
// `normal`, which is the calibration point for every balance number in this
// repo: a duel between two `normal` brains comes out 16-16, so a co-op run
// between two `normal` brains and the bot coming out 50/50 means the pair is
// facing the same fight one duellist faces.
//
//   node tools/coop.js [matches] [humanLevel] [map|all] [flags]
//     --order=a|b|alt   who updates first inside a tick (default alt)
//     --probe           run all three orders and check they agree
//     --mul=1.7         override TUNING.aiIncomeMul.coop for this run
//     --sweep=1.7,2.2   run the same matches at each multiplier and tabulate
//     --seed=4000       base of the seed family (see the note below)
//     --onequeen        the pair field ONE queen between them, not one each.
//                       This is the counterfactual behind the whole question:
//                       queens are per player, so co-op quietly became two of
//                       them against the bot's one. Run with and without it to
//                       see how much of the gap the queen actually accounts for
//                       before reaching for a fix that only addresses queens.
//
// TWO THINGS WILL LIE TO YOU HERE, both learned the hard way in this repo:
//
// 1. UPDATE ORDER. Brains that act on the same tick hand a free look to
//    whichever is updated last, and that alone was once worth an 11-of-14 win
//    rate. AiBrain now has its own RNG stream and a staggered start, so it
//    should not matter any more, and `--probe` is how you confirm that rather than
//    assuming it, and there are three brains here rather than two.
// 2. SEED FAMILY. A single arithmetic family of seeds leans several points one
//    way or the other all on its own. Run at least two families before you
//    believe a win split; `--seed` is there for that.

import { Sim } from '../shared/sim.js';
import { AiBrain } from '../shared/ai.js';
import { DT, TUNING } from '../shared/data/board.js';
import { QUEEN_IDS } from '../shared/data/heroes.js';
import { MAP_IDS } from '../shared/data/maps.js';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const flag = (name, dflt = null) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : (args.includes(`--${name}`) ? true : dflt);
};

const N = Number(pos[0] || 8);
const HUMAN = pos[1] || 'normal';
const MAP = pos[2] || 'all';
const SEED0 = Number(flag('seed', 4000));
const PROBE = !!flag('probe');
const ONE_QUEEN = !!flag('onequeen');
const ORDERS = PROBE ? ['a', 'b', 'alt'] : [String(flag('order', 'alt'))];
const SWEEP = flag('sweep') ? String(flag('sweep')).split(',').map(Number) : [Number(flag('mul', TUNING.aiIncomeMul.coop))];

const maps = MAP === 'all' ? MAP_IDS : [MAP];

/**
 * One co-op match, played to the end.
 *
 * Both colonies field the SAME queen, rotated across the run, for the reason
 * balance.js gives: four different queens would mix a queen matchup into every
 * win split this prints. The pair get one each because the game gives them one
 * each, which is the whole thing being measured.
 */
function playMatch(seed, map, order) {
  const queen = QUEEN_IDS[seed % QUEEN_IDS.length];
  const sim = new Sim({
    mode: 'coop',
    map,
    seed,
    players: [
      { id: 'A', name: 'A', team: 0, queen },
      { id: 'B', name: 'B', team: 0, queen },
    ],
    // the same arrangement server.js builds for a co-op room: one bot, whole
    // other colony, income handicapped by TUNING.aiIncomeMul.coop
    ai: { team: 1, difficulty: 'coop', queen },
  });
  const a = new AiBrain(sim, 'A', HUMAN);
  const b = new AiBrain(sim, 'B', HUMAN);
  const bot = new AiBrain(sim, '@ai', 'coop');
  // The counterfactual: refuse B's queen at the command, so the pair run one
  // between them. Everything else about B is untouched, so the difference
  // between this and a normal run is the second queen and nothing else.
  if (ONE_QUEEN) {
    const pass = b.cmd.bind(b);
    b.cmd = (c) => (c.kind === 'queen' || c.kind === 'ability'
      ? { ok: false, why: 'no queen in this run' } : pass(c));
  }
  // `a` reversed is `b`; alt swaps between them by tick. If the three disagree
  // the win split is an artefact of who moved first, not of the tuning.
  const fwd = [a, b, bot];
  const rev = [bot, b, a];

  const hits = [0, 0];        // raiders that reached each colony's nest
  let popped = 0;
  const nests = sim.map.nests;
  const nestOf = (x, y) => nests.findIndex((n) => Math.abs(n.x - x) < 0.5 && Math.abs(n.y - y) < 0.5);

  // Can the bot even SPEND a bigger allowance? Sampled once a second: how often
  // it is sitting on its unit cap, and how much sugar it is sitting on. Income
  // it cannot convert into ants is income that buys it nothing.
  const samples = { botCapped: 0, botBank: 0, humanBank: 0, n: 0 };
  const alive = (team) => sim.units.reduce((s, u) => s + (u.team === team && u.hp > 0 ? 1 : 0), 0);
  const capOf = (team) => sim.players.filter((p) => p.team === team)
    .reduce((s, p) => s + sim.unitCapFor(p), 0);

  let peak = [0, 0];
  let pads = [0, 0];   // most pads either side ever had standing at once
  while (!sim.over && sim.t < TUNING.matchCap + 1) {
    sim.step(DT);
    const turn = order === 'a' ? fwd : order === 'b' ? rev : (sim.tick % 2 ? fwd : rev);
    for (const brain of turn) brain.update(DT);

    for (const f of sim.fx) {
      if (f[0] === 4) { const t = nestOf(f[1], f[2]); if (t >= 0) hits[t]++; }
      else if (f[0] === 1) popped++;
    }
    sim.fx.length = 0;   // nobody is watching

    if (sim.tick % 30 === 0) {
      const botAlive = alive(1);
      if (botAlive >= capOf(1) - 1) samples.botCapped++;
      samples.botBank += sim.aiPlayer.sugar;
      samples.humanBank += sim.players.filter((p) => p.team === 0).reduce((s, p) => s + p.sugar, 0);
      samples.n++;
      peak = [Math.max(peak[0], alive(0)), Math.max(peak[1], botAlive)];
      for (const t of [0, 1]) {
        pads[t] = Math.max(pads[t], sim.defs.reduce((s, d) => s + (d.team === t ? 1 : 0), 0));
      }
    }
  }

  const q = (team) => sim.players.filter((p) => p.team === team);
  return {
    winner: sim.winner,
    t: sim.t,
    reason: sim.endReason,
    hp: sim.nestHp.map((h) => Math.round(h)),
    hits, popped, peak, pads,
    padSlots: sim.map.pads[0].length,
    cap: [capOf(0), capOf(1)],
    capped: samples.n ? samples.botCapped / samples.n : 0,
    bank: samples.n ? [samples.humanBank / samples.n, samples.botBank / samples.n] : [0, 0],
    queens: [q(0), q(1)].map((side) => ({
      out: side.filter((p) => p.heroBought).length,
      of: side.length,
      lv: side.reduce((s, p) => s + p.heroLevel, 0) / side.length,
    })),
    eco: [q(0).reduce((s, p) => s + p.eco, 0), q(1).reduce((s, p) => s + p.eco, 0)],
  };
}

function runSet(mul, order) {
  TUNING.aiIncomeMul.coop = mul;
  const out = [];
  for (const m of maps) for (let i = 0; i < N; i++) out.push({ ...playMatch(SEED0 + i * 7, m, order), map: m });
  return out;
}

function summarise(rs) {
  const humans = rs.filter((r) => r.winner === 0).length;
  const botWins = rs.filter((r) => r.winner === 1).length;
  const draws = rs.length - humans - botWins;
  const mean = (f) => rs.reduce((s, r) => s + f(r), 0) / rs.length;
  return {
    n: rs.length, humans, botWins, draws,
    rate: humans / rs.length,
    mins: mean((r) => r.t) / 60,
    breach: rs.reduce((s, r) => s + r.hits[0] + r.hits[1], 0)
      / Math.max(1, rs.reduce((s, r) => s + r.hits[0] + r.hits[1] + r.popped, 0)),
    onBot: rs.reduce((s, r) => s + r.hits[1], 0),
    onHumans: rs.reduce((s, r) => s + r.hits[0], 0),
    capped: mean((r) => r.capped),
    bank: [mean((r) => r.bank[0]), mean((r) => r.bank[1])],
    peak: [Math.max(...rs.map((r) => r.peak[0])), Math.max(...rs.map((r) => r.peak[1]))],
    pads: [mean((r) => r.pads[0]), mean((r) => r.pads[1])],
    padSlots: rs[0].padSlots,
    cap: rs[0].cap,
    eco: [mean((r) => r.eco[0]), mean((r) => r.eco[1])],
    qlv: [mean((r) => r.queens[0].lv), mean((r) => r.queens[1].lv)],
    timeouts: rs.filter((r) => r.reason.startsWith('out of time')).length,
  };
}

const pct = (x) => `${(100 * x).toFixed(1)}%`;

// ------------------------------------------------------------------ sweep mode

if (SWEEP.length > 1) {
  console.log(`\nco-op income sweep: ${N * maps.length} matches per multiplier, ${HUMAN} stand-ins on colony 0`);
  console.log(`seed family ${SEED0}+7i   order ${ORDERS.join('/')}   maps ${maps.join(', ')}\n`);
  console.log('    mul    humans win        length   breach   bot at unit cap   bot bank   bot eco');
  for (const mul of SWEEP) {
    for (const order of ORDERS) {
      const s = summarise(runSet(mul, order));
      const tag = ORDERS.length > 1 ? ` [${order}]` : '';
      console.log(`   ${mul.toFixed(2)}   ${String(s.humans).padStart(3)}/${s.n}  ${pct(s.rate).padStart(6)}${tag.padEnd(6)}  ${s.mins.toFixed(1)} min   ${pct(s.breach).padStart(5)}   ${pct(s.capped).padStart(14)}   ${s.bank[1].toFixed(0).padStart(8)}   ${s.eco[1].toFixed(1).padStart(7)}`);
    }
  }
  console.log('\n  50% is parity: the pair face what a lone duellist faces.');
  process.exit(0);
}

// ----------------------------------------------------------------- single run

const mul = SWEEP[0];
console.log(`\nco-op: two ${HUMAN} stand-ins on colony 0 vs the bot on colony 1, income x${mul.toFixed(2)}`);
console.log(`${N * maps.length} matches on ${maps.join(', ')}   seed family ${SEED0}+7i\n`);

const byOrder = [];
for (const order of ORDERS) {
  const rs = runSet(mul, order);
  const s = summarise(rs);
  byOrder.push({ order, s, rs });
  console.log(`  order ${order.padEnd(3)}  humans win ${s.humans}/${s.n}  ${pct(s.rate)}   bot wins ${s.botWins}   draws ${s.draws}`);
}

if (PROBE) {
  const rates = byOrder.map((o) => o.s.rate);
  const spread = Math.max(...rates) - Math.min(...rates);
  const n = byOrder[0].s.n;
  // Three brains, so a free look is worth more here than in a duel. What counts
  // as agreement has to scale with the sample, or the guard cries wolf: three
  // orders over four matches can land 0%, 75% and 50% on coin flips alone and
  // that says nothing about turn order either way.
  const tol = 1.2 / Math.sqrt(n);
  console.log(n < 16
    ? `\n  update-order spread ${pct(spread)}: ${n} matches is too few for this probe to say anything. Run 8 or more over every map.`
    : `\n  update-order spread ${pct(spread)} against ${pct(tol)} of noise at ${n} matches: ${spread <= tol ? 'orders agree, the split is about the tuning' : 'ORDERS DISAGREE, do not trust this win split'}`);
}

const { s } = byOrder[byOrder.length - 1];
console.log(`\n  mean length ${s.mins.toFixed(1)} min   ran out the clock ${s.timeouts}/${s.n}`);
console.log(`  breach rate ${pct(s.breach)}   hits on the bot nest ${s.onBot}   on the human nest ${s.onHumans}`);
console.log(`  unit cap ${s.cap[0]} humans / ${s.cap[1]} bot   peak alive ${s.peak[0]} / ${s.peak[1]}   bot sat on its cap ${pct(s.capped)} of the match`);
console.log(`  mean banked sugar ${s.bank[0].toFixed(0)} humans / ${s.bank[1].toFixed(0)} bot   mean eco ${s.eco[0].toFixed(1)} / ${s.eco[1].toFixed(1)}`);
console.log(`  pads filled ${s.pads[0].toFixed(2)} humans / ${s.pads[1].toFixed(2)} bot   out of ${s.padSlots} a side`);
console.log(`  mean queen level ${s.qlv[0].toFixed(2)} humans / ${s.qlv[1].toFixed(2)} bot   (the pair field ${byOrder[0].rs[0].queens[0].of} queens, the bot ${byOrder[0].rs[0].queens[1].of})`);
console.log('\n  per match:');
for (const r of byOrder[byOrder.length - 1].rs) {
  console.log(`    ${r.map.padEnd(11)} ${String(Math.round(r.t)).padStart(4)}s  ${r.winner === 0 ? 'humans' : r.winner === 1 ? 'bot   ' : 'draw  '}  nests ${r.hp[0]}/${r.hp[1]}  ${r.reason}`);
}
