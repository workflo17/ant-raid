// A refresh mid-match must not end the match. Start the server, then:
//   node tools/reconnect.js
import { WebSocket } from 'ws';

const URL = process.env.AR_URL || 'ws://localhost:5010/ws';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function client() {
  const ws = new WebSocket(URL);
  const c = { ws, msgs: [], errors: [], tx(m) { ws.send(JSON.stringify(m)); } };
  c.ready = new Promise((r) => ws.on('open', r));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    c.msgs.push(m.t);
    if (m.t === 'seat') { c.pid = m.pid; c.code = m.code; }
    if (m.t === 'lobby') c.lobby = m;
    if (m.t === 'start') c.full = m.full;
    if (m.t === 'snap') { c.snaps = (c.snaps || 0) + 1; c.last = m.s; }
    if (m.t === 'err') c.errors.push(m.why);
    if (m.t === 'over') c.over = m;
  });
  return c;
}

const check = (label, ok) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) process.exitCode = 1;
};

const a = client(), b = client();
await Promise.all([a.ready, b.ready]);
a.tx({ t: 'create', name: 'Ember', mode: 'versus' });
await wait(150);
b.tx({ t: 'join', code: a.code, name: 'Frost' });
await wait(150);
a.tx({ t: 'start' });
await wait(600);
check('match started for both', !!a.full && !!b.full);

a.tx({ t: 'cmd', c: { kind: 'send', unit: 'worker', lane: 1 } });
await wait(800);
const snapsBefore = a.snaps;
const tBefore = a.last.t;

console.log('\nFrost closes the tab mid-match…');
b.ws.close();
await wait(2500);
check('the match kept running for the player still there', a.snaps > snapsBefore);
check('the abandoned colony is flagged away, not forfeited', a.last.p[1].on === false && !a.over);

console.log('Frost comes back with the same room code and seat…');
const b2 = client();
await b2.ready;
b2.tx({ t: 'join', code: a.code, name: 'Frost', pid: b.pid });
await wait(700);
check('rejoined without being told the room is full', b2.errors.length === 0);
check('got the full state back, not a lobby', !!b2.full);
check('snapshots resumed', (b2.snaps || 0) > 0);
check('marked connected again', a.last.p[1].on === true);
check('picked up the same colony', b2.full.players.find((p) => p.id === b.pid)?.i === 1);
check('the match is the same one, not a restart', b2.full.snap.t >= tBefore);

// and a stranger still cannot take the seat
const c3 = client();
await c3.ready;
c3.tx({ t: 'join', code: a.code, name: 'Gatecrasher' });
await wait(300);
check('the room is still full to everyone else', c3.errors.length > 0);

a.ws.close(); b2.ws.close(); c3.ws.close();
console.log(process.exitCode ? '\nFAILED' : '\nOK');
process.exit(process.exitCode || 0);
