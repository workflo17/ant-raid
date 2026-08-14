// Free-for-all tuning harness: the N-colony answer to tools/balance.js, which
// only ever knew how to sit two bots down opposite each other.
//
//   node tools/ffa.js [matches per board] [3|4|5|6|all] [level]
//
// Four questions, in the order they have to be answered:
//
//   0. IS THE HARNESS ITSELF FAIR? Every number below is a win split or a rate
//      per colony, and both are worthless if the rig leans. Two things can make
//      it lean: the order the brains are updated in (whoever goes last decides
//      with everybody else's move already on the board) and the seat a brain
//      sits in (the ring is provably rotationally fair for identical scripts,
//      which is NOT the same as fair for bots). Both are probed before anything
//      else is printed, and both have to come out flat.
//   1. KINGMAKING. Does hitting a neighbour hand the match to the colony on
//      their far side?
//   2. ELIMINATION. How early does a colony get knocked out, and how long does
//      that player then sit there with nothing to do?
//   3. PACING. Match length and breach rate per colony count, against the
//      duelling targets of 4 to 5 minutes and 20 to 30 percent.

import { Sim, FX } from '../shared/sim.js';
import { AiBrain, botLoadout, botQueen } from '../shared/ai.js';
import { DT, TUNING } from '../shared/data/board.js';
import { RING_SIZES } from '../shared/data/ring.js';
import { mulberry32 } from '../shared/util.js';

const N = Number(process.argv[2] || 8);
const SIZES = (process.argv[3] || 'all') === 'all' ? RING_SIZES : [Number(process.argv[3])];
const LEVEL = process.argv[4] || 'normal';

const SAMPLE = 15;          // seconds between nest-health samples
const EARLY = 120;          // "an early leader", the same 2:00 snowball.js uses

/**
 * One match on a ring of `n`.
 *
 * `order` decides how the brains are stepped, and exists so the update-order
 * probe can ask the same match three different ways:
 *   'rotate'  a different colony goes first each tick (the honest default)
 *   'up'      colony 0 always first, colony n-1 always last
 *   'down'    the reverse
 *
 * `shift` rotates which brain sits in which seat. The brains are identical in
 * policy but not in random stream (each seeds from sim.seed ^ its own id), so
 * moving them round the ring separates "this seat wins" from "this stream wins".
 */
function playMatch(n, seed, { order = 'rotate', shift = 0, level = LEVEL } = {}) {
  // ONE kit for the whole ring, rotated through the roster and queen lists by
  // seed. balance.js hands both duelling colonies the same queen for the same
  // reason: a colony that packed better is a second variable, and it would land
  // in the win split as if it were a seat advantage.
  const pick = mulberry32(seed >>> 0);
  const roster = botLoadout(pick);
  const queen = botQueen(pick);
  const sim = new Sim({
    mode: 'ffa',
    map: `ring${n}`,
    seed,
    players: Array.from({ length: n }, (_, i) => ({
      id: `P${(i + shift) % n}`, name: `P${i}`, team: i, roster, queen,
    })),
  });
  const brains = sim.players.map((p) => new AiBrain(sim, p.id, level));

  // per colony
  const arrived = new Array(n).fill(0);
  const popped = new Array(n).fill(0);
  const fellAt = new Array(n).fill(-1);         // when this nest hit zero
  const finisher = new Array(n).fill(-1);       // who landed the last bite on it
  const samples = [];                           // [{ t, hp: [...] }]
  let peakUnits = 0, nextSample = 0;

  while (!sim.over && sim.t < TUNING.matchCap + 1) {
    const before = [...sim.nestHp];
    sim.step(DT);
    // Update order is a real edge and it has to be rotated, not just alternated:
    // with two brains "alternate" and "rotate" are the same thing, with six they
    // are not, and a fixed order hands the last colony a free look every tick.
    for (let k = 0; k < n; k++) {
      const i = order === 'up' ? k
        : order === 'down' ? n - 1 - k
        : (sim.tick + k) % n;
      brains[i].update(DT);
    }
    if (sim.units.length > peakUnits) peakUnits = sim.units.length;

    // A colony scattering throws one POP per ant it had walking, and counting
    // those as raiders killed en route would quietly halve the breach rate. Skip
    // the whole tick's pops when a nest fell in it: the handful of real deaths
    // lost with them is nothing against dozens of scatter pops.
    const scattered = sim.fx.some((f) => f[0] === FX.FALL);
    for (const f of sim.fx) {
      if (f[0] === FX.NEST) {
        const by = f[4];
        arrived[by]++;
        // Only a NEIGHBOUR can be bitten, and only one of the two is losing
        // health from this bite. That is enough to name a killer without the
        // sim having to report one.
        for (const t of [(by + 1) % n, (by + n - 1) % n]) {
          if (sim.nestHp[t] < before[t] && sim.nestHp[t] <= 0) finisher[t] = by;
        }
      } else if (f[0] === FX.POP && !scattered) {
        popped[0]++;      // POP carries a type index, not an owner: a board total
      }
    }
    for (let t = 0; t < n; t++) if (fellAt[t] < 0 && sim.nestHp[t] <= 0) fellAt[t] = sim.t;
    if (sim.t >= nextSample) {
      samples.push({ t: sim.t, hp: [...sim.nestHp] });
      nextSample += SAMPLE;
    }
    sim.fx.length = 0;
  }

  return {
    n, seed, shift, order,
    winner: sim.winner,
    // the SEAT that won, and separately the brain that won it: with the seats
    // rotated these are different questions
    winnerBrain: sim.winner < 0 ? -1 : (sim.winner + shift) % n,
    t: sim.t,
    reason: sim.endReason,
    hp: sim.nestHp.map((h) => Math.round(h)),
    arrived, popped: popped[0], fellAt, finisher, samples, peakUnits,
    survivors: sim.nestHp.filter((h) => h > 0).length,
  };
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : 'n/a');
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// ------------------------------------------------------- 0. is the rig fair?

console.log('\n=== PROBE: does the harness itself lean? ===');
console.log('  A CROSSED design: every seed is played once from every rotation of the');
console.log('  ring, so the seat a colony sits in and the brain sitting in it are');
console.log('  balanced against each other rather than confounded. Playing each seed');
console.log('  once at some rotation does NOT do this, and reads as a seat effect.\n');

const chi2 = (wins, total) => {
  const e = total / wins.length;
  return e ? wins.reduce((a, v) => a + (v - e) ** 2 / e, 0) : 0;
};

/** Chi-squared at 5 per cent, for 2 to 5 degrees of freedom. */
const CRITICAL = { 2: 5.99, 3: 7.81, 4: 9.49, 5: 11.07 };

/**
 * Say what the number MEANS, and refuse to say it when the run is too small.
 *
 * A short run overstates. This board measured chi-squared 6.7 by seat over 72
 * matches and 2.3 over 600, on the same code: the first reading is noise wearing
 * the clothes of a finding, and acting on it would mean hunting a seat bias that
 * is not there. 30 matches per seat is where it settles down. The order probe in
 * tools/coop.js learned the same lesson the same way, and a guard that cries
 * wolf is worse than no guard because it gets ignored.
 */
function verdict(value, df, decided) {
  const perSeat = decided / (df + 1);
  if (perSeat < 30) return `too few to judge, ${perSeat.toFixed(0)} per seat, want 30`;
  const crit = CRITICAL[df] ?? 11.07;
  return value <= crit ? `flat (under ${crit})` : `LEANS, over ${crit} at 5 per cent`;
}

for (const n of SIZES) {
  const bySeat = new Array(n).fill(0), byBrain = new Array(n).fill(0);
  let decided = 0;
  for (let s = 0; s < N; s++) {
    for (let shift = 0; shift < n; shift++) {
      const r = playMatch(n, 9000 + s * 7, { shift });
      if (r.winner < 0) continue;
      decided++;
      bySeat[r.winner]++;
      byBrain[r.winnerBrain]++;
    }
  }
  const seatChi = chi2(bySeat, decided), brainChi = chi2(byBrain, decided);
  console.log(`  ring${n}   ${N} seeds x ${n} rotations = ${N * n} matches, flat is ${(decided / n).toFixed(1)} each`);
  console.log(`    by seat   ${bySeat.join(' / ')}   chi2 ${seatChi.toFixed(1)} on ${n - 1} df   ${verdict(seatChi, n - 1, decided)}`);
  console.log(`    by brain  ${byBrain.join(' / ')}   chi2 ${brainChi.toFixed(1)} on ${n - 1} df   ${verdict(brainChi, n - 1, decided)}`);

  // Update order: whoever is stepped last in a tick decides with everybody
  // else's move already on the board. Three orders, same seeds; if they disagree
  // the rig is measuring its own loop and not the game.
  const rows = [];
  for (const order of ['rotate', 'up', 'down']) {
    const wins = new Array(n).fill(0);
    for (let s = 0; s < N; s++) {
      const r = playMatch(n, 9000 + s * 7, { order });
      if (r.winner >= 0) wins[r.winner]++;
    }
    rows.push(`${order} ${wins.join('/')}`);
  }
  console.log(`    update order: ${rows.join('   ')}`);
}

// --------------------------------------------------------------- the matches

const all = [];
for (const n of SIZES) {
  for (let i = 0; i < N; i++) all.push(playMatch(n, 9000 + i * 7, { shift: i % n }));
}

console.log('\n=== PACING: length, breach and crowding per colony count ===');
console.log('  Duelling targets, for reference: 4 to 5 minutes, 20 to 30 percent breach.\n');
for (const n of SIZES) {
  const rs = all.filter((r) => r.n === n);
  const arr = rs.reduce((s, r) => s + r.arrived.reduce((a, b) => a + b, 0), 0);
  const pop = rs.reduce((s, r) => s + r.popped, 0);
  const timeouts = rs.filter((r) => r.reason.startsWith('out of time')).length;
  console.log(`  ring${n}  ${(mean(rs.map((r) => r.t)) / 60).toFixed(1)} min`
    + `   breach ${(100 * arr / Math.max(1, arr + pop)).toFixed(1)}%`
    + `   peak ants ${Math.max(...rs.map((r) => r.peakUnits))}`
    + `   ran out the clock ${timeouts}/${rs.length}`);
}

console.log('\n=== ELIMINATION: how early is a colony out, and for how long? ===');
console.log('  A player knocked out at 2:00 of an 8:00 match has nothing to do for six');
console.log('  minutes. Dead time is measured against the match they were in.\n');
for (const n of SIZES) {
  const rs = all.filter((r) => r.n === n);
  const outs = [];
  for (const r of rs) for (let t = 0; t < n; t++) if (r.fellAt[t] >= 0 && t !== r.winner) outs.push({ at: r.fellAt[t], dead: r.t - r.fellAt[t], of: r.t });
  const early = outs.filter((o) => o.at < EARLY).length;
  const longWait = outs.filter((o) => o.dead > 180).length;
  console.log(`  ring${n}  ${outs.length}/${rs.length * (n - 1)} of the losing colonies were knocked out`
    + ` (the rest were still standing at the end)`);
  console.log(`         first one out at ${mean(rs.map((r) => Math.min(...r.fellAt.filter((v) => v >= 0), Infinity)).filter(Number.isFinite)).toFixed(0)}s`
    + `   mean knock-out ${mean(outs.map((o) => o.at)).toFixed(0)}s`
    + `   mean dead time ${mean(outs.map((o) => o.dead)).toFixed(0)}s`
    + `   worst ${Math.max(0, ...outs.map((o) => o.dead)).toFixed(0)}s`);
  console.log(`         out before 2:00 ${early}/${outs.length} ${pct(early, outs.length)}`
    + `   left watching over 3:00 ${longWait}/${outs.length} ${pct(longWait, outs.length)}`
    + `   a knocked-out player sat out ${(100 * mean(outs.map((o) => o.dead / o.of))).toFixed(0)}% of their match`);
}

console.log('\n=== KINGMAKING: does hitting a neighbour hand it to the far side? ===');
console.log('  leader converts far ABOVE 1/n  -> the leader is left alone to grow');
console.log('  leader converts far BELOW 1/n  -> everybody piles onto whoever leads');
console.log('  focus ratio above 1            -> the leader takes more than their share next\n');
for (const n of SIZES) {
  const rs = all.filter((r) => r.n === n);
  let leadWins = 0, leadMatches = 0;
  let focusLead = 0, focusRest = 0, focusN = 0;
  let finisherWins = 0, finisherMatches = 0;
  let quiet = 0;                      // winner had not been bitten by 2:00
  const worstDeficit = [];
  for (const r of rs) {
    // who led at 2:00
    const at = r.samples.find((s) => s.t >= EARLY);
    if (at && r.winner >= 0) {
      const best = Math.max(...at.hp);
      const leaders = at.hp.map((h, t) => [h, t]).filter(([h]) => h === best);
      if (leaders.length === 1) { leadMatches++; if (leaders[0][1] === r.winner) leadWins++; }
      if (at.hp[r.winner] >= TUNING.nestHp - 0.5) quiet++;
    }
    // is the colony that finishes somebody the one that goes on to win, or does
    // the neighbour on their far side collect?
    for (let t = 0; t < n; t++) {
      if (r.finisher[t] < 0 || r.winner < 0) continue;
      finisherMatches++;
      if (r.finisher[t] === r.winner) finisherWins++;
    }
    // focus: nest damage taken over the next window, leader against the field
    for (let i = 0; i < r.samples.length - 1; i++) {
      const a = r.samples[i], b = r.samples[i + 1];
      const live = a.hp.map((h, t) => t).filter((t) => a.hp[t] > 0);
      if (live.length < 3) continue;
      const lead = live.reduce((x, t) => (a.hp[t] > a.hp[x] ? t : x), live[0]);
      const took = (t) => a.hp[t] - b.hp[t];
      focusLead += took(lead);
      focusRest += mean(live.filter((t) => t !== lead).map(took));
      focusN++;
    }
    if (r.winner >= 0) {
      let worst = 0;
      for (const s of r.samples) {
        const bestOther = Math.max(...s.hp.filter((_, t) => t !== r.winner));
        worst = Math.max(worst, bestOther - s.hp[r.winner]);
      }
      worstDeficit.push(worst);
    }
  }
  const back = worstDeficit.filter((d) => d >= 20).length;
  const never = worstDeficit.filter((d) => d <= 0).length;
  console.log(`  ring${n}  leading at 2:00 converts ${leadWins}/${leadMatches} ${pct(leadWins, leadMatches)}`
    + `  (flat would be ${(100 / n).toFixed(0)}%)`);
  console.log(`         focus ratio ${(focusLead / Math.max(1e-9, focusRest)).toFixed(2)}`
    + `   the colony that finishes somebody goes on to win ${pct(finisherWins, finisherMatches)}`
    + `  (flat ${(100 / n).toFixed(0)}%)`);
  console.log(`         winner untouched at 2:00 ${pct(quiet, rs.length)}`
    + `   winner never trailed ${pct(never, worstDeficit.length)}`
    + `   came back from 20+ ${pct(back, worstDeficit.length)}`);
}

console.log('\n=== per match ===');
for (const r of all) {
  console.log(`  ring${r.n} seed ${r.seed}  ${String(Math.round(r.t)).padStart(4)}s  winner ${r.winner < 0 ? 'draw' : r.winner}`
    + `  nests ${r.hp.join('/')}  out at ${r.fellAt.map((v) => (v < 0 ? '-' : Math.round(v))).join('/')}  ${r.reason}`);
}
