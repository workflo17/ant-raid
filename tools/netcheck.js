// End-to-end check of the real thing: real websocket clients create and join a
// room, play through the server, and assert they all saw the same match. Start
// the server first, then:
//   node tools/netcheck.js [mode] [seats] [--quick]
//     mode    versus | coop | ffa      (default versus)
//     seats   3 to 6, free-for-all only (default 3)
//     --quick free-for-all only: run the three short cases and skip the match
//             played out to a finish, which is the ten minutes of the run
//
// The forfeit case waits out the server's abandon window, and a colony nobody
// is playing loses its whole column inside three quarters of a minute. To watch
// the scatter take ants off the board rather than an empty lane, shorten the
// window on the server and here at once:
//   AR_ABANDON_AFTER=8000 node server.js
//   AR_ABANDON_AFTER=8000 node tools/netcheck.js ffa 3 --quick
//
// The duel path is two clients and one match. The free-for-all path is four
// cases in their own rooms, because a forfeit and a clean finish tell you
// different things and running them together means a failure cannot say which.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { listInstances } from './instances.mjs';
import { buildMap } from '../shared/map.js';

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
const argv = process.argv.slice(2);
const MODE = argv.find((a) => !a.startsWith('--')) || 'versus';
const SEATS = Number(argv.filter((a) => !a.startsWith('--'))[1] || 3);
const QUICK = argv.includes('--quick');
const UNITS = ['worker', 'army', 'trapjaw', 'archer', 'exploder', 'weaver', 'majoress'];

// How long server.js lets a colony nobody is holding stand before it forfeits.
// The same variable name the server reads, so one export configures both, and a
// plain mirror rather than an import because the server may be a remote one on
// a different build: if the two disagree the waits below just take longer.
//
// Set it low on BOTH and the forfeit case gets to watch a colony scatter while
// it still has a column walking, which at the real 45 seconds it never does.
const ABANDON = Number(process.env.AR_ABANDON_AFTER) || 45_000;

function client(label) {
  const ws = new WebSocket(URL);
  const c = {
    label, ws, pid: null, code: null, me: null,
    snaps: 0, lastSnap: null, over: null, errors: [], started: false,
    log: [], nopes: [],
    // a short tail of raw snapshot payloads, keyed by tick — see agree()
    recent: new Map(),
    tx(m) { ws.send(JSON.stringify(m)); },
    get live() { return ws.readyState === 1; },
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
      case 'snap':
        c.snaps++;
        c.lastSnap = m.s;
        c.recent.set(m.s.n, String(raw));
        if (c.recent.size > 48) c.recent.delete(c.recent.keys().next().value);
        break;
      case 'over': c.over = m; c._done(m); break;
      case 'err': c.errors.push(m.why); break;
      case 'nope': c.log.push(`refused: ${m.why}`); c.nopes.push(m.why); break;
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

async function duel() {
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

// ------------------------------------------------------------- free-for-all
//
// Everything below is about a room with more than two colonies in it. The duel
// above is one long assertion that a match resolves; these are short assertions
// about the things a third colony makes possible, and they collect their
// failures rather than throwing at the first, because a run that takes ten
// minutes should tell you everything that is wrong with it in one go.

const NAMES = ['Ember', 'Frost', 'Cinder', 'Thistle', 'Sable', 'Marrow'];

let fails = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `   ${detail}` : ''}`);
  if (!ok) fails++;
  return ok;
}

/**
 * Do these clients hold the same picture?
 *
 * A snapshot is broadcast as ONE string to every socket, so any tick that two
 * clients both received has to match byte for byte. Anything else means the
 * server handed them different worlds, which is the failure a free-for-all
 * makes possible and a duel does not: colonies come off the board mid-match.
 */
function agree(cs) {
  const [head, ...rest] = cs;
  let compared = 0;
  for (const [n, raw] of head.recent) {
    for (const o of rest) {
      const theirs = o.recent.get(n);
      if (theirs === undefined) continue;
      compared++;
      if (theirs !== raw) return { ok: false, why: `tick ${n} differs between ${head.label} and ${o.label}` };
    }
  }
  if (compared < 5) return { ok: false, why: `only ${compared} shared ticks to compare, which proves nothing` };
  return { ok: true, why: `${compared} shared ticks identical` };
}

/** What a colony has standing on the board, read off the wire. */
function kitIn(s, team) {
  if (!s) return { ants: 0, queen: false, pads: 0, walls: 0 };
  return {
    // a queen rides in the unit list with a negative type; everything else is a raider
    ants: s.u.filter((u) => u[2] === team && u[1] >= 0).length,
    queen: s.u.some((u) => u[2] === team && u[1] < 0),
    pads: s.d.filter((d) => d[2] === team).length,
    walls: s.w.filter((w) => w[1] === team).length,
  };
}
const kitOf = (c, team) => kitIn(c.lastSnap, team);

/** Seat `n` colonies in one free-for-all room, lobby settled, not yet started. */
async function seatRoom(n) {
  const host = client(NAMES[0]);
  await host.ready;
  host.tx({ t: 'create', name: NAMES[0], mode: 'ffa' });
  await until('the host to get a room code', () => host.code);
  const seats = [{ i: 0, name: NAMES[0], c: host }];
  for (let i = 1; i < n; i++) {
    const c = client(NAMES[i]);
    await c.ready;
    c.tx({ t: 'join', code: host.code, name: NAMES[i] });
    await until(`${NAMES[i]} to be seated`, () => c.pid || c.errors.length);
    if (c.errors.length) throw new Error(`${NAMES[i]} could not join: ${c.errors.join(', ')}`);
    seats.push({ i, name: NAMES[i], c });
  }
  await until('the lobby to list every colony', () => host.lobby?.players?.length === n);
  for (const s of seats) s.pid = s.c.pid;
  return { code: host.code, seats };
}

async function startRoom(seats) {
  seats[0].c.tx({ t: 'start' });
  await until('the match to start for every client', () => seats.every((s) => s.c.started));
  for (const s of seats) {
    s.team = s.c.me.team;
    s.idx = s.c.me.i;
    s.pads = s.c.me.pads;
  }
  await until('the first snapshot', () => seats.every((s) => s.c.lastSnap));
  return seats[0].c.full;
}

/**
 * What every colony does while a case runs. Not a strategy: an order of
 * business. A pad, then a wall, then a queen, and only then ants, because those
 * first three are exactly what a forfeit has to take off the board and what a
 * reconnect has to give back — and a colony that spends every coin on raiders
 * never owns any of them to lose.
 */
function drive(seats, mapId) {
  const map = buildMap(mapId);
  let n = 0;
  const timer = setInterval(() => {
    n++;
    for (const s of seats) {
      const c = s.c;
      if (!c || !c.live || c.over || !c.lastSnap || s.team === undefined) continue;
      const lanes = map.lanesFor(s.team);
      const lane = lanes[(n + s.i) % lanes.length];
      const snap = c.lastSnap;
      if (snap.out[s.team]) continue;               // nothing left to spend it on
      const me = snap.p[s.idx];
      const kit = kitOf(c, s.team);
      const taken = new Set(snap.d.filter((d) => d[2] === s.team).map((d) => d[3]));
      const free = s.pads.find((p) => !taken.has(p));
      if (kit.pads < 2 && free !== undefined) c.tx({ t: 'cmd', c: { kind: 'build', def: 'worker', pad: free } });
      else if (!kit.walls) c.tx({ t: 'cmd', c: { kind: 'power', power: 'barricade', lane } });
      else if (!me.h.out && !me.h.dead) c.tx({ t: 'cmd', c: { kind: 'queen', lane } });
      else {
        for (let i = 0; i < 2; i++) {
          c.tx({ t: 'cmd', c: { kind: 'send', unit: UNITS[(n + i + s.i) % 5], lane: lanes[(n + i) % lanes.length] } });
        }
      }
    }
  }, 300);
  return () => clearInterval(timer);
}

const closeAll = (seats, ...extra) => {
  for (const s of seats) if (s.c && s.c.live) s.c.ws.close();
  for (const c of extra) if (c && c.live) c.ws.close();
};

// ------------------------------------------------------- case: the mode switch

/**
 * The mode buttons live in the LOBBY, not on the title screen: they act on a
 * room that already exists and already has people in it. So the thing to check
 * is not that `ffa` is a valid mode string, it is that switching a live room to
 * it moves capacity, the minimum to start, and the seat-to-colony mapping all
 * at once — and that switching BACK cannot strand the people already sitting
 * down.
 */
async function caseLobby() {
  const host = client('host');
  const b = client('B');
  await Promise.all([host.ready, b.ready]);
  host.tx({ t: 'create', name: NAMES[0], mode: 'versus' });
  await until('the host to get a room code', () => host.code);
  await until('the lobby', () => host.lobby);
  check('a fresh room is a duel', host.lobby.mode === 'versus' && host.lobby.capacity === 2 && !host.lobby.ffa,
    `capacity ${host.lobby.capacity}, minSeats ${host.lobby.minSeats}`);

  b.tx({ t: 'join', code: host.code, name: NAMES[1] });
  await until('the second seat', () => host.lobby.players.length === 2);

  b.tx({ t: 'mode', mode: 'ffa' });
  await wait(SETTLE);
  check('a non-host cannot change the mode', b.errors.some((e) => /host/.test(e)),
    b.errors.join(', ') || 'no refusal came back');
  check('and the room did not change anyway', host.lobby.mode === 'versus');

  host.tx({ t: 'mode', mode: 'ffa' });
  await until('the room to turn into a free-for-all', () => host.lobby.mode === 'ffa');
  check('capacity went from two to six', host.lobby.capacity === 6, `capacity ${host.lobby.capacity}`);
  check('three is now enough to start', host.lobby.minSeats === 3, `minSeats ${host.lobby.minSeats}`);
  check('the lobby says it is a free-for-all', host.lobby.ffa === true);
  check('two seats is not enough yet', host.lobby.canStart === false);
  check('both clients were told', b.lobby.mode === 'ffa' && b.lobby.capacity === 6);

  host.tx({ t: 'start' });
  await wait(SETTLE);
  check('and the host cannot start under three', !host.started && host.errors.length > 0,
    host.errors.slice(-1)[0] || 'nothing came back');

  const c3 = client('C');
  await c3.ready;
  c3.tx({ t: 'join', code: host.code, name: NAMES[2] });
  await until('the third seat', () => host.lobby.players.length === 3);
  check('three seats can start', host.lobby.canStart === true);
  check('every seat is its own colony', new Set(host.lobby.players.map((p) => p.team)).size === 3,
    `teams ${host.lobby.players.map((p) => p.team).join(',')}`);

  const before = host.errors.length;
  host.tx({ t: 'mode', mode: 'versus' });
  await wait(SETTLE);
  check('the room cannot shrink below the people in it', host.lobby.mode === 'ffa' && host.errors.length > before,
    host.errors.slice(-1)[0] || 'no refusal came back');

  closeAll([], host, b, c3);
}

// ------------------------------------------------- case: leaving the lobby

/**
 * Somebody closes the tab BEFORE the raid starts.
 *
 * The chair has to be given up, and that is the opposite of the rule one screen
 * later: a seat that drops mid-match keeps its colony so `resume` can hand it
 * back. Getting the two confused either way is a bug, so both are checked here
 * and in `a colony that drops and comes back`.
 *
 * What this catches: `canStart` and `boardId()` both count seats.length, so a
 * chair held by nobody used to size the board and then stand on it. Three join,
 * one leaves, the host starts a three colony ring, and the third colony does
 * nothing until the abandon timer knocks it out 45 seconds later.
 */
async function caseLobbyLeave() {
  const host = client('host');
  const b = client('B');
  const c = client('C');
  await Promise.all([host.ready, b.ready, c.ready]);
  host.tx({ t: 'create', name: NAMES[0], mode: 'ffa' });
  await until('the host to get a room code', () => host.code && host.lobby);
  b.tx({ t: 'join', code: host.code, name: NAMES[1] });
  await until('the second seat', () => host.lobby.players.length === 2);
  c.tx({ t: 'join', code: host.code, name: NAMES[2] });
  await until('the third seat', () => host.lobby.players.length === 3);
  check('three seats can start', host.lobby.canStart === true);
  const pids = host.lobby.players.map((p) => p.pid);

  c.ws.close();
  await until('the lobby to notice', () => host.lobby.players.length !== 3, 8000)
    .catch(() => {});
  check('the empty chair is given up, not held',
    host.lobby.players.length === 2, `${host.lobby.players.length} seats still listed`);
  check('and the room is no longer startable',
    host.lobby.canStart === false, 'it would have started onto a colony nobody holds');

  // and the pid it vacated must not be handed to the next arrival, or `resume`
  // and `cmd` would address two people at once
  const d = client('D');
  await d.ready;
  d.tx({ t: 'join', code: host.code, name: NAMES[3] || 'D' });
  await until('a replacement seat', () => host.lobby.players.length === 3);
  const now = host.lobby.players.map((p) => p.pid);
  check('the new arrival got a pid nobody is sitting on',
    new Set(now).size === now.length, `pids ${now.join(',')}`);
  check('and it is not one the room has issued before',
    !pids.includes(now.find((p) => !pids.includes(p)) ?? pids[0]) && now.some((p) => !pids.includes(p)),
    `was ${pids.join(',')} now ${now.join(',')}`);

  host.tx({ t: 'start' });
  await until('the match to start', () => host.started || host.errors.length, 8000).catch(() => {});
  check('a refilled room starts normally', !!host.started, host.errors.slice(-1)[0] || '');
  if (host.full) {
    check('onto a board sized for the people actually in it',
      host.full.teams === 3, `teams ${host.full.teams}`);
    check('and every colony is held by somebody',
      host.full.snap.p.every((p) => p.on), 'a colony started already disconnected');
  }
  closeAll([], host, b, c, d);
}

// -------------------------------------------------- case: chairs filled by bots

/**
 * One person opens a six-colony room and fills the rest with bots.
 *
 * The assertions that matter are not "the button worked". They are the four
 * ways a bot seat could be mistaken for a human one:
 *
 *   a filled chair must not forfeit. It has no socket, so it looks exactly
 *   like somebody who walked out, and the abandon timer would knock its nest
 *   flat in the middle of the match it was filled to make possible. This is
 *   why the case waits out the window (AR_ABANDON_AFTER=8000 makes it quick)
 *   and then reads the nests.
 *
 *   a late human must get in, taking a bot's chair rather than the room's
 *   "full" message.
 *
 *   the host must still be the host, when seat order now contains sockets
 *   that are null.
 *
 *   and the match must actually be played by them: bots that sit there are
 *   worse than empty chairs, so the case reads the board for their ants.
 */
async function caseBotFill() {
  const host = client('host');
  await host.ready;
  host.tx({ t: 'create', name: NAMES[0], mode: 'ffa' });
  await until('the host to get a room code', () => host.code && host.lobby);
  check('one person alone cannot start a free-for-all', host.lobby.canStart === false);

  host.tx({ t: 'bots', fill: true });
  await until('the chairs to fill', () => host.lobby.players.length === 6, 8000);
  const filled = host.lobby.players;
  check('every chair is taken', filled.length === 6, `${filled.length} seats`);
  check('five of them by bots', filled.filter((p) => p.bot).length === 5,
    `${filled.filter((p) => p.bot).length} bots`);
  check('the host is not one of them', filled[0].bot === false);
  check('and the room can start now', host.lobby.canStart === true);
  check('the bots are named, not numbered', filled.filter((p) => p.bot).every((p) => p.name && !/^Colony/.test(p.name)),
    filled.map((p) => p.name).join(', '));
  check('no two colonies share a name', new Set(filled.map((p) => p.name)).size === 6,
    filled.map((p) => p.name).join(', '));

  // a late human takes a bot's chair rather than bouncing off a full room
  const late = client('late');
  await late.ready;
  late.tx({ t: 'join', code: host.code, name: NAMES[1] });
  await until('the late arrival to be seated', () => host.lobby.players.filter((p) => !p.bot).length === 2, 8000);
  check('a late human is let in, and a bot gives up the chair', late.errors.length === 0,
    late.errors[0] || '');
  check('the room is still exactly full', host.lobby.players.length === 6);
  check('now with four bots', host.lobby.players.filter((p) => p.bot).length === 4);

  // and the host is still the host, with null sockets in the seat list
  host.tx({ t: 'start' });
  await until('the match to start', () => host.started || host.errors.length, 8000);
  check('the host can still start a room with bots in it', !!host.started,
    host.errors.slice(-1)[0] || '');
  const full = host.full;
  check('the board was sized for the filled room', full.map === 'ring6', full.map);
  check('the sim is running six colonies', full.teams === 6, `teams ${full.teams}`);
  check('the bots are flagged as bots on the wire',
    full.players.filter((p) => p.bot).length === 4,
    `${full.players.filter((p) => p.bot).length} flagged`);

  // THE ONE THAT MATTERS: sit through the abandon window and see whether the
  // filled colonies are still standing.
  const wait_for = ABANDON + 6000;
  console.log(`  waiting out the abandon window (${Math.round(wait_for / 1000)}s) to see if the bots forfeit`);
  await wait(wait_for);
  const snap = host.lastSnap;
  const botTeams = full.players.filter((p) => p.bot).map((p) => p.team);
  const flattened = botTeams.filter((t) => snap.hp[t] <= 0);
  check('a filled chair does not forfeit like a no-show',
    flattened.length === 0,
    `colonies ${flattened.join(',')} were knocked out by the abandon timer`);
  check('and the match is still running', !host.over, host.over?.why || '');

  // and they play: their ants are on the board
  const botAnts = snap.u.filter((u) => botTeams.includes(u[2])).length;
  check('the bots actually raid', botAnts > 0, 'no bot ants on the board');
  const botSpend = botTeams.filter((t) => {
    const p = full.players.find((x) => x.team === t);
    return snap.p[p.i] && snap.p[p.i].s < 3000;
  }).length;
  check('and they spend rather than hoard', botSpend === botTeams.length,
    'a bot banked its whole purse');
  console.log(`  ${botAnts} bot ants on the board after ${Math.round(wait_for / 1000)}s`);

  closeAll([], host, late);
}

// ----------------------------------------------------------- case: the forfeit

/**
 * A colony walks out and does not come back. In a duel that ends the match; in
 * a free-for-all its nest simply falls and everybody else plays on, which drags
 * Sim._scatter() in behind it — the colony's ants, pads and walls come off the
 * board and it lets go of the aphid herd.
 *
 * Nothing had ever exercised this path before this check existed, so the
 * assertions are deliberately about the board rather than about the message:
 * that the others kept playing, that they still agree with each other, and that
 * the colony that left is really gone rather than standing there inert.
 */
async function caseForfeit(n) {
  const { code, seats } = await seatRoom(n);
  const full = await startRoom(seats);
  const stop = drive(seats, full.map);
  const quit = seats[n - 1];          // the last seat: the host leaving is its own question
  const others = seats.filter((s) => s !== quit);
  try {
    // Enough of each that finding none of them afterwards means something. One
    // ant and one pad would pass this check on a board that had barely started.
    await until('the leaving colony to get a column, two pads, a wall and a queen onto the board',
      () => { const k = kitOf(quit.c, quit.team); return k.ants >= 6 && k.pads >= 2 && k.walls >= 1 && k.queen; }, 150_000);
    const leaving = kitOf(quit.c, quit.team);
    console.log(`  ${quit.name} closes the tab holding ${leaving.ants} ants, ${leaving.pads} pads, ${leaving.walls} walls and a queen`);

    const snapsAt = others.map((s) => s.c.snaps);
    quit.c.ws.close();
    const watch = others[0].c;

    // An empty chair is not a forfeit yet: for the next three quarters of a
    // minute the colony is still on the board and its column is still walking.
    // Sampled a third of the way in, so a shortened window still looks early.
    await wait(Math.max(600, Math.min(3000, ABANDON / 3)));
    check('an empty chair is not a forfeit on its own',
      !watch.lastSnap.out[quit.team] && kitOf(watch, quit.team).ants > 0,
      `${kitOf(watch, quit.team).ants} ants still marching`);

    // The herd changes hands all match, so whether the leaver was holding it has
    // to be read from the last frame before its nest fell rather than from the
    // moment it closed the tab.
    let alive = watch.lastSnap;
    await until(`the abandoned colony to forfeit (up to ${ABANDON / 1000}s by design)`,
      () => {
        if (!watch.lastSnap.out[quit.team]) alive = watch.lastSnap;
        return watch.lastSnap.out[quit.team] || watch.over;
      }, ABANDON + 30_000);

    const last = watch.lastSnap;
    // what it still had on the board in the last frame before its nest fell,
    // which is the only "before" the scatter is answerable for
    const before = kitIn(alive, quit.team);
    const heldHerd = alive.fd[2] === quit.team || alive.fd[1] === quit.team;
    check('the match did not end for anybody else', others.every((s) => !s.c.over),
      others.find((s) => s.c.over) ? `${others.find((s) => s.c.over).name} was told the match was over` : '');
    check('everybody still at the table kept getting snapshots',
      others.every((s, i) => s.c.snaps > snapsAt[i] + 10));
    check('the abandoned nest is at zero', last.hp[quit.team] === 0, `hp ${last.hp.join('/')}`);
    check('and is flagged out, not merely empty', last.out[quit.team] === true, `out ${last.out.join('/')}`);

    const now = kitOf(watch, quit.team);
    console.log(`  by the time its nest fell it still had ${before.ants} ants, ${before.pads} pads, ${before.walls} walls${before.queen ? ' and a queen' : ''}`);
    // ATTRITION IS NOT SCATTER. A colony nobody is playing spends the whole
    // abandon window losing ants it never replaces, and its queen with them, so
    // "0 ants after" proves nothing unless it had some in the frame before it
    // fell. Pads and walls do survive the wait, which is what carries this.
    const emptied = (what, was, is) => (was > 0
      ? check(`its ${what} left the board`, is === 0, `${was} before, ${is} after`)
      : console.log(`  --   it had no ${what} left to scatter when its nest fell, so that went untested this run`));
    emptied('ants', before.ants, now.ants);
    emptied('queen', before.queen ? 1 : 0, now.queen ? 1 : 0);
    emptied('pads', before.pads, now.pads);
    emptied('walls', before.walls, now.walls);

    // And the invariant the three of them are instances of, which needs no
    // "before" and so holds every run: a colony flagged out owns nothing.
    const ghost = [...watch.recent.values()].map((r) => JSON.parse(r).s)
      .filter((s) => s.out[quit.team])
      .map((s) => ({ n: s.n, k: kitIn(s, quit.team) }))
      .find(({ k }) => k.ants || k.pads || k.walls || k.queen);
    check('nothing of a fallen colony is ever left standing', !ghost,
      ghost ? `tick ${ghost.n} still shows ${ghost.k.ants} ants, ${ghost.k.pads} pads, ${ghost.k.walls} walls` : '');
    // The herd. A colony that has stopped playing spends the whole abandon
    // window losing ants, so it is rarely the one pulling the herd at the moment
    // its nest falls, and waiting for a run where it is would be waiting a long
    // time. The invariant underneath it holds every run and says the same thing:
    // a colony with no units left cannot be the one holding the herd, so a
    // scatter that failed to let go would leave its name in the field.
    const stillNamed = [...watch.recent.values()]
      .map((r) => JSON.parse(r).s)
      .filter((s) => s.out[quit.team])
      .some((s) => s.fd[1] === quit.team || s.fd[2] === quit.team);
    check('a colony that is out is never named on the aphid herd', !stillNamed,
      heldHerd ? 'and it WAS pulling it when it fell' : 'it was not pulling it when it fell, so this run only proves the weaker half');

    const a1 = agree(others.map((s) => s.c));
    check('the colonies still playing agree snapshot for snapshot', a1.ok, a1.why);

    // ------ and now the colony that fell comes back and tries to play anyway
    const back = client(`${quit.name}-again`);
    await back.ready;
    back.tx({ t: 'join', code, name: quit.name, pid: quit.pid });
    await until('the fallen seat to get back in', () => back.started || back.errors.length, 10_000);
    check('a fallen colony can still rejoin and watch', back.started && !back.errors.length,
      back.errors.join(', '));

    const tries = [
      { kind: 'send', unit: 'worker', lane: 0 },
      { kind: 'build', def: 'worker', pad: 0 },
      { kind: 'power', power: 'rally', lane: 0 },
      { kind: 'queen', lane: 0 },
      { kind: 'mark', lane: 0 },
      { kind: 'upgrade', unit: 'worker' },
    ];
    const spamAt = others.map((s) => s.c.snaps);
    for (const c of tries) back.tx({ t: 'cmd', c });
    for (let i = 0; i < 60; i++) back.tx({ t: 'cmd', c: { kind: 'send', unit: 'worker', lane: i % 4 } });
    await wait(Math.max(SETTLE, 1500));
    check('every command from a fallen colony was refused', back.nopes.length === tries.length + 60,
      `${back.nopes.length} refusals for ${tries.length + 60} commands`);
    check('and refused for the right reason', back.nopes.every((w) => /nest has fallen/.test(w)),
      [...new Set(back.nopes)].join(' | '));
    check('none of it reached the board', kitOf(watch, quit.team).ants === 0);
    check('the server kept simulating through the hammering',
      others.every((s, i) => s.c.snaps > spamAt[i]));
    const a2 = agree(others.map((s) => s.c));
    check('and the survivors are still identical afterwards', a2.ok, a2.why);
    const a3 = agree([watch, back]);
    check('the fallen client sees the same match as everyone else', a3.ok, a3.why);

    closeAll(seats, back);
  } finally {
    stop();
  }
}

// --------------------------------------------------------- case: the reconnect

/**
 * A drop INSIDE the window is a refresh, not a forfeit. The colony has to be
 * waiting where it was left: same seat, same pads, same queen, nest untouched.
 * tools/reconnect.js asks this of a duel; a free-for-all is the version where
 * getting it wrong is quiet, because the match carries on either way.
 */
async function caseReconnect(n) {
  const { code, seats } = await seatRoom(n);
  const full = await startRoom(seats);
  const stop = drive(seats, full.map);
  const target = seats[1];            // not the host, whose socket also owns the room
  try {
    await until('the reconnecting colony to get two pads, a wall and a queen out',
      () => { const k = kitOf(target.c, target.team); return k.pads >= 2 && k.walls >= 1 && k.queen; }, 150_000);
    const before = kitOf(target.c, target.team);
    const meBefore = target.c.lastSnap.p[target.idx];
    const padsBefore = target.pads.join(',');
    const tBefore = target.c.lastSnap.t;
    const watch = seats[0].c;

    target.c.ws.close();
    await wait(6000);                 // well inside the window, nowhere near it
    check('the colony is flagged away, not forfeited',
      watch.lastSnap.p[target.idx].on === false && watch.lastSnap.out[target.team] === false);
    check('its nest was not touched', watch.lastSnap.hp[target.team] > 0,
      `hp ${watch.lastSnap.hp.join('/')}`);

    const back = client(`${target.name}-again`);
    await back.ready;
    back.tx({ t: 'join', code, name: target.name, pid: target.pid });
    await until('the seat to come back', () => back.started || back.errors.length, 10_000);
    check('rejoined without being told the room is full', back.errors.length === 0, back.errors.join(', '));
    check('got the running match back, not a lobby', !!back.full);
    if (!back.full) { closeAll(seats, back); return; }
    target.c = back;                  // the drive loop picks it up from here

    check('kept the same colony', back.me.i === target.idx && back.me.team === target.team,
      `player ${back.me.i}, colony ${back.me.team}`);
    check('kept its pads', back.me.pads.join(',') === padsBefore, `${padsBefore} -> ${back.me.pads.join(',')}`);
    check('the match is the same one, not a restart', back.full.snap.t >= tBefore,
      `${tBefore}s before, ${back.full.snap.t}s after`);

    await until('a snapshot after the reconnect', () => back.lastSnap && back.lastSnap.n > back.full.snap.n, 10_000);
    const after = kitOf(back, target.team);
    const meAfter = back.lastSnap.p[target.idx];
    check('its pads are still standing', after.pads >= 1, `${before.pads} before, ${after.pads} after`);
    // She can legitimately fall in the six seconds nobody was holding the reins,
    // so what is asserted is that the colony still OWNS her — the 300 sugar and
    // the levels are still on the books — and she is reported walking or coming back.
    check('kept its queen', meAfter.h.bought === true && meAfter.h.lv >= meBefore.h.lv,
      after.queen ? 'still on the board' : `off the board, respawning in ${meAfter.h.dead}s`);
    check('marked connected again', watch.lastSnap.p[target.idx].on === true);
    const a1 = agree(seats.map((s) => s.c));
    check('the whole table agrees again', a1.ok, a1.why);

    // And it may act, which is the half of "kept its colony" no field can show.
    // The drive loop stops first: with it running, its own overspending fills
    // the refusal log and there is no telling whose command was turned down.
    stop();
    await until('the returned colony to bank the price of a raider',
      () => back.lastSnap.p[target.idx].s >= 60, 30_000);
    const antsBefore = kitOf(back, target.team).ants;
    const nopesAt = back.nopes.length;
    back.tx({ t: 'cmd', c: { kind: 'send', unit: 'worker', lane: buildMap(full.map).lanesFor(target.team)[0] } });
    await wait(Math.max(SETTLE, 1200));
    check('and it may play again', back.nopes.length === nopesAt,
      back.nopes.slice(nopesAt).join(' | ') || `ants ${antsBefore} -> ${kitOf(back, target.team).ants}`);

    closeAll(seats);
  } finally {
    stop();
  }
}

// ------------------------------------------------------------ case: a finish

const KNOWN_ENDINGS = [
  'last colony standing',
  'every nest fell at once, the closest call there is',
  'out of time, most nest left wins',
];

/**
 * The whole field plays until the server says it is over, and every client has
 * to have been told the same story. The board is the other half of this: it is
 * picked by ATTENDANCE rather than chosen, so three seats have to land on ring3
 * and six on ring6 without anybody selecting anything.
 */
async function caseFinish(n) {
  const { code, seats } = await seatRoom(n);

  if (n === 6) {
    const extra = client('Gatecrasher');
    await extra.ready;
    extra.tx({ t: 'join', code, name: 'Gatecrasher' });
    await wait(Math.max(SETTLE, 800));
    check('a seventh client bounces off a full free-for-all', extra.errors.length > 0,
      extra.errors[0] || 'it got in, which is a bug');
    extra.ws.close();
  }

  const full = await startRoom(seats);
  check('the board was chosen by attendance', full.map === `ring${n}`, `${n} seats got ${full.map}`);
  check('and the sim is running that many colonies', full.teams === n, `teams ${full.teams}`);
  check('every seat got a colony of its own', new Set(seats.map((s) => s.team)).size === n,
    `colonies ${seats.map((s) => s.team).join(',')}`);

  const stop = drive(seats, full.map);
  // A free-for-all runs to sudden death more often than a duel does, and
  // TUNING.matchCap is 720s, so the ceiling has to sit above the cap or a match
  // that ended perfectly correctly gets reported as one that never finished.
  const LIMIT = Number(process.env.AR_LIMIT || 800_000);
  const t0 = Date.now();
  try {
    await Promise.race([
      Promise.all(seats.map((s) => s.c.done)),
      wait(LIMIT).then(() => { throw new Error(`match never finished inside ${LIMIT / 1000}s`); }),
    ]);
  } finally {
    stop();
  }

  const overs = seats.map((s) => s.c.over);
  const winners = new Set(overs.map((o) => o.winner));
  const whys = new Set(overs.map((o) => o.why));
  console.log(`  match ran ${Math.round((Date.now() - t0) / 1000)}s, ${seats.map((s) => s.c.snaps).join('/')} snapshots`);
  console.log(`  result: winner ${overs[0].winner} — ${overs[0].why}`);
  check('every client got a result', overs.every(Boolean));
  check('and they all name the same winner', winners.size === 1, `saw ${[...winners].join(', ')}`);
  check('and the same reason', whys.size === 1, `saw ${[...whys].join(' | ')}`);
  check('the winner is a colony that was at the table', overs[0].winner >= -1 && overs[0].winner < n);
  check('the ending is one the free-for-all knows', KNOWN_ENDINGS.includes(overs[0].why), overs[0].why);
  if (overs[0].why === 'last colony standing') check('it came down to the last colony standing', true);
  else console.log(`  --   it ended on "${overs[0].why}" this run, so "last colony standing" went untested`);

  for (const s of overs[0].stats) {
    console.log(`  ${s.name.padEnd(12)} colony ${s.team}  sent ${String(s.sent).padStart(4)}  kills ${String(s.kills).padStart(4)}  damage ${s.dealt}`);
  }
  closeAll(seats);
}

async function ffa() {
  if (!(SEATS >= 3 && SEATS <= 6)) throw new Error(`a free-for-all seats three to six, not ${SEATS}`);
  console.log(`free-for-all check: ${SEATS} colonies${QUICK ? ', quick pass — no match played out' : ''}`);
  const cases = [
    ['the lobby mode switch', caseLobby],
    ['a seat that leaves the lobby', caseLobbyLeave],
    ['chairs filled by bots', caseBotFill],
    ['a colony that walks out and stays out', () => caseForfeit(SEATS)],
    ['a colony that drops and comes back', () => caseReconnect(SEATS)],
  ];
  if (!QUICK) cases.push(['a match played to a finish', () => caseFinish(SEATS)]);

  for (const [name, run] of cases) {
    console.log(`\n== ${name} ==`);
    try {
      await run();
    } catch (e) {
      console.log(`  FAIL ${name}: ${e.message}`);
      fails++;
    }
  }
  console.log(fails ? `\n${fails} FAILED` : '\nOK');
  process.exit(fails ? 1 : 0);
}

const main = () => (MODE === 'ffa' ? ffa() : duel());
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
