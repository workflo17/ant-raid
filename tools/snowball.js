// Does Ant Raid snowball? Measures whether an early lead converts to a win, and
// whether the contested wildlife bounty rewards the player who is already ahead.
// Genre reading says these are the two places a lane-push game goes wrong.
//   node tools/snowball.js [matches]
import { Sim } from '../shared/sim.js';
import { AiBrain } from '../shared/ai.js';
import { DT, TUNING } from '../shared/data/board.js';
import { MAP_IDS } from '../shared/data/maps.js';

const N = Number(process.argv[2] || 10);
let firstBloodWins = 0, firstBloodMatches = 0;
let bountyToLeader = 0, bountyToTrailer = 0, bountyLevel = 0;
let leadAt2minWins = 0, leadAt2minMatches = 0;
// The question a comeback mechanic actually has to answer: can the eventual
// winner have been losing? "Leading at 2:00" is confounded by match length,
// because 2:00 is a different fraction of a 4-minute match than a 6-minute one.
const comebacks = [];   // worst nest deficit the winner came back from
const spendCurve = [[], []]; // sugar banked, sampled per 30s, winner vs loser

for (const map of MAP_IDS) {
  for (let i = 0; i < N; i++) {
    const sim = new Sim({
      mode: 'versus', map, seed: 800 + i * 11,
      players: [{ id: 'A', name: 'A', team: 0 }, { id: 'B', name: 'B', team: 1 }],
    });
    const brains = [new AiBrain(sim, 'A', 'normal'), new AiBrain(sim, 'B', 'normal')];
    let firstBlood = -1, leadAt2min = -1;
    const banked = [[], []];
    const worstDeficit = [0, 0];

    let guard = 0;
    while (!sim.over && guard++ < TUNING.matchCap * 30 + 60) {
      const before = [...sim.nestHp];
      const purseBefore = sim.players.map((p) => p.sugar);
      sim.step(DT);
      // alternate who acts first; holding that edge all match decides the result
      if (sim.tick % 2) { brains[0].update(DT); brains[1].update(DT); }
      else { brains[1].update(DT); brains[0].update(DT); }

      if (firstBlood < 0) {
        // whoever scratches the other nest first "drew first blood"
        if (sim.nestHp[1] < before[1]) firstBlood = 0;
        else if (sim.nestHp[0] < before[0]) firstBlood = 1;
      }
      if (leadAt2min < 0 && sim.t >= 120) {
        leadAt2min = sim.nestHp[0] === sim.nestHp[1] ? -2 : (sim.nestHp[0] > sim.nestHp[1] ? 0 : 1);
      }
      // A bounty is the only way a purse jumps by more than one tick of income,
      // so the payout identifies its own taker without touching the sim.
      if (sim.fx.some((f) => f[0] === 8)) {
        const jumped = sim.players
          .map((p, i) => ({ i, gain: p.sugar - purseBefore[i] }))
          .filter((x) => x.gain > 100)
          .sort((a, b) => b.gain - a.gain)[0];
        const ahead = sim.nestHp[0] === sim.nestHp[1] ? -1 : (sim.nestHp[0] > sim.nestHp[1] ? 0 : 1);
        if (!jumped || ahead < 0) bountyLevel++;
        else if (sim.players[jumped.i].team === ahead) bountyToLeader++;
        else bountyToTrailer++;
      }
      if (sim.tick % 900 === 0) for (const t of [0, 1]) banked[t].push(Math.round(sim.players[t].sugar));
      for (const t of [0, 1]) worstDeficit[t] = Math.max(worstDeficit[t], sim.nestHp[1 - t] - sim.nestHp[t]);
      sim.fx.length = 0;
    }

    if (firstBlood >= 0 && sim.winner >= 0) {
      firstBloodMatches++;
      if (sim.winner === firstBlood) firstBloodWins++;
    }
    if (leadAt2min >= 0 && sim.winner >= 0) {
      leadAt2minMatches++;
      if (sim.winner === leadAt2min) leadAt2minWins++;
    }
    if (sim.winner >= 0) {
      spendCurve[0].push(banked[sim.winner]);
      spendCurve[1].push(banked[1 - sim.winner]);
      comebacks.push(worstDeficit[sim.winner]);
    }
  }
}

const pct = (a, b) => b ? `${((100 * a) / b).toFixed(0)}%` : 'n/a';
console.log(`\n${MAP_IDS.length * N} bot matches across every map\n`);
console.log(`  first blood converts to a win   ${firstBloodWins}/${firstBloodMatches}  ${pct(firstBloodWins, firstBloodMatches)}`);
console.log(`  leading at 2:00 converts        ${leadAt2minWins}/${leadAt2minMatches}  ${pct(leadAt2minWins, leadAt2minMatches)}`);
console.log(`\n  50% means an early lead means nothing. 100% means the match is`);
console.log(`  decided the moment somebody lands the first hit.`);
const deep = comebacks.filter((d) => d >= 20).length;
const veryDeep = comebacks.filter((d) => d >= 60).length;
const never = comebacks.filter((d) => d <= 0).length;
const meanBack = comebacks.length ? comebacks.reduce((a, b) => a + b, 0) / comebacks.length : 0;
console.log(`\n  COMEBACKS (not confounded by match length, unlike the rows above)`);
console.log(`    winner was never behind at all      ${never}/${comebacks.length}  ${pct(never, comebacks.length)}`);
console.log(`    winner came back from 20+ nest hp   ${deep}/${comebacks.length}  ${pct(deep, comebacks.length)}`);
console.log(`    winner came back from 60+ nest hp   ${veryDeep}/${comebacks.length}  ${pct(veryDeep, comebacks.length)}`);
console.log(`    mean deficit the winner overcame    ${meanBack.toFixed(0)} of ${TUNING.nestHp} nest hp`);

console.log(`\n  wildlife bounty went to the player already ahead ${bountyToLeader}, behind ${bountyToTrailer}, level ${bountyLevel}`);
console.log(`  (a bounty that mostly feeds the leader is a snowball, not a comeback)`);
