// End-to-end check of the real thing: two websocket clients create and join a
// room, play a whole match against each other through the server, and assert
// that both saw the same result. Start the server first, then:
//   node tools/netcheck.js [mode]        mode = versus | coop
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { listInstances } from './instances.mjs';

/**
 * Which server to check.
 *
 * AR_URL still wins, and it is the only way to reach a remote one. With nothing
 * set this used to assume 5010, which stopped being safe once a second server
 * on the machine slides to 5011: the check would connect to somebody else's
 * instance, or to nothing, and report a broken server either way.
 *
 * So it asks the instance registry, and prefers a server started from THIS
 * repo, newest first. That is the one a `node tools/netcheck.js` typed in this
 * directory almost certainly means.
 */
function discover() {
  const here = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const live = listInstances().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const mine = live.filter((e) => e.root === here);
  const pick = mine[0] || live[0];
  if (pick) console.log(`checking the Ant Raid on port ${pick.port}${pick.root === here ? '' : ` from ${pick.root}`}`);
  return `ws://localhost:${pick ? pick.port : 5010}/ws`;
}

const URL = process.env.AR_URL || discover();
const MODE = process.argv[2] || 'versus';
const UNITS = ['worker', 'army', 'trapjaw', 'archer', 'exploder', 'weaver', 'majoress'];

function client(label) {
  const ws = new WebSocket(URL);
  const c = {
    label, ws, pid: null, code: null, me: null,
    snaps: 0, lastSnap: null, over: null, errors: [], started: false,
    log: [],
    tx(m) { ws.send(JSON.stringify(m)); },
  };
  c.ready = new Promise((r) => { c._open = r; });
  c.done = new Promise((r) => { c._done = r; });
  ws.on('open', () => c._open());
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    switch (m.t) {
      case 'seat': c.pid = m.pid; c.code = m.code; c.host = m.host; break;
      case 'lobby': c.lobby = m; break;
      case 'start':
        c.started = true;
        c.full = m.full;
        c.me = m.full.players.find((p) => p.id === c.pid);
        break;
      case 'snap': c.snaps++; c.lastSnap = m.s; break;
      case 'over': c.over = m; c._done(m); break;
      case 'err': c.errors.push(m.why); break;
      case 'nope': c.log.push(`refused: ${m.why}`); break;
      case 'emote': (c.emotes ||= []).push(`${m.team}:${m.e}`); break;
    }
  });
  return c;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A remote server is not a local one. Every fixed 150ms sleep in here was a
// localhost assumption, and pointing this at a tunnel (which DEPLOY.md tells
// you to do) failed on "host never got a room code" purely because the reply
// had not arrived yet. Wait for the CONDITION, and only sleep a fixed time when
// checking that something did NOT happen.
const LOCAL = /localhost|127\.0\.0\.1|\[::1\]/.test(URL);
const SETTLE = Number(process.env.AR_SETTLE || (LOCAL ? 150 : 1500));

async function until(what, fn, ms = LOCAL ? 4000 : 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await wait(50);
  }
  throw new Error(`timed out after ${ms}ms waiting for: ${what}`);
}

async function main() {
  const a = client('A');
  const b = client('B');
  await Promise.all([a.ready, b.ready]);

  a.tx({ t: 'create', name: 'Ember', mode: MODE });
  await until('the host to get a room code', () => a.code);
  console.log(`room ${a.code}, mode ${MODE}`);

  b.tx({ t: 'join', code: a.code, name: 'Frost' });
  await until('the second colony to be seated', () => b.pid || b.errors.length);
  if (b.errors.length) throw new Error(`join failed: ${b.errors.join(', ')}`);
  await until('the lobby to list both', () => a.lobby?.players?.length === 2);
  console.log(`seats: ${a.lobby.players.map((p) => `${p.name}(team ${p.team})`).join(' vs ')}`);

  // a third client must bounce off a full room
  const c3 = client('C');
  await c3.ready;
  c3.tx({ t: 'join', code: a.code, name: 'Gatecrasher' });
  await wait(SETTLE);
  console.log(`third client refused: ${c3.errors[0] ? `"${c3.errors[0]}"` : 'NO — it got in, that is a bug'}`);
  c3.ws.close();

  // a non-host must not be able to start
  b.tx({ t: 'start' });
  await wait(SETTLE);
  console.log(`non-host start refused: ${b.errors.some((e) => /host/.test(e)) ? 'yes' : 'NO — that is a bug'}`);

  a.tx({ t: 'start' });
  await until('the match to start for both clients', () => a.started && b.started);
  console.log(`both clients started. A is player ${a.me.i} (team ${a.me.team}), B is player ${b.me.i} (team ${b.me.team})`);

  // emotes: relayed to BOTH seats, validated by index, and rate limited on the
  // server rather than in the client, because a client is what a spammer swaps
  a.tx({ t: 'emote', e: 1 });
  await until('the emote to reach the other seat', () => (b.emotes || []).length);
  for (let i = 0; i < 6; i++) a.tx({ t: 'emote', e: 2 });   // should be swallowed
  a.tx({ t: 'emote', e: 99 });                              // should be refused
  a.tx({ t: 'emote', e: '__proto__' });
  await wait(SETTLE);
  const seen = (b.emotes || []).length;
  console.log(`emotes: B saw ${seen} (${(b.emotes || []).join(', ') || 'none'}), A saw ${(a.emotes || []).length}`);
  if (seen !== 1) throw new Error(`rate limit or validation leaked: B saw ${seen} emotes, expected 1`);
  // the refusal goes back to whoever SENT it, not to the other seat
  if (!a.errors.some((e) => /emote/.test(e))) throw new Error('an out-of-range emote index was not refused');
  console.log('  out-of-range and repeated emotes were both stopped by the server');

  // A commits everything to one lane, B spreads across all three and turtles.
  // Two identical scripts stalemate to sudden death (the board is symmetric on
  // purpose), which tells us nothing about whether the server resolves a match.
  let n = 0;
  const play = setInterval(() => {
    n++;
    if (a.started && !a.over) {
      for (let i = 0; i < 3; i++) a.tx({ t: 'cmd', c: { kind: 'send', unit: UNITS[(n + i) % 5], lane: 1 } });
      if (n % 12 === 3) a.tx({ t: 'cmd', c: { kind: 'power', power: 'rally', lane: 1 } });
    }
    if (b.started && !b.over) {
      b.tx({ t: 'cmd', c: { kind: 'send', unit: UNITS[n % 3], lane: n % 3 } });
      if (n % 6 === 2) b.tx({ t: 'cmd', c: { kind: 'build', def: 'worker', pad: (n / 6 | 0) % 4 } });
    }
  }, 300);

  const LIMIT = Number(process.env.AR_LIMIT || 420_000);
  const result = await Promise.race([
    Promise.all([a.done, b.done]),
    wait(LIMIT).then(() => { throw new Error(`match never finished inside ${LIMIT / 1000}s`); }),
  ]);
  clearInterval(play);

  const [oa, ob] = result;
  console.log(`\nmatch over after ${a.snaps} snapshots to A, ${b.snaps} to B`);
  console.log(`  A saw: winner ${oa.winner} — ${oa.why}`);
  console.log(`  B saw: winner ${ob.winner} — ${ob.why}`);
  if (oa.winner !== ob.winner) throw new Error('the two clients disagree about who won');
  console.log('  both clients agree on the result');
  for (const s of oa.stats) {
    console.log(`  ${s.name.padEnd(18)} team ${s.team}  sent ${String(s.sent).padStart(3)}  kills ${String(s.kills).padStart(3)}  damage ${s.dealt}`);
  }
  const refused = [...new Set([...a.log, ...b.log])];
  if (refused.length) console.log(`\n  server refused (expected — they overspend on purpose): ${refused.join(' | ')}`);

  a.ws.close(); b.ws.close();
  console.log('\nOK');
  process.exit(0);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
