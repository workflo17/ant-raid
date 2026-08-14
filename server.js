// ===== Ant Raid room server =====
// One process serves the static game AND the websocket rooms, so there is a
// single port to open, tunnel, or deploy. The server is authoritative: clients
// send intents, the server runs the simulation and broadcasts snapshots.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { Sim } from './shared/sim.js';
import { AiBrain } from './shared/ai.js';
import { MAP_IDS, DEFAULT_MAP, boardForTeams } from './shared/map.js';
import { cleanLoadout } from './shared/data/units.js';
import { cleanQueen } from './shared/data/heroes.js';
import { cleanColor, resolveColors } from './shared/data/board.js';
import { isEmote, EMOTE_GAP } from './shared/data/emotes.js';
import { DT, TICK_HZ } from './shared/data/board.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5010);
const SNAP_EVERY = 3;          // broadcast at 10 Hz, simulate at 30 Hz
const ABANDON_AFTER = 45_000;  // forfeit if a colony stays empty this long
const EMPTY_ROOM_TTL = 10 * 60_000;

// ---------------------------------------------------------------- static files

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Dev-only screenshot sink: the QA hook POSTs the board canvas here so a script
 * can look at what the game actually drew.
 *
 * OFF UNLESS YOU ASK FOR IT. It used to be gated on the request coming from
 * localhost, which is not a gate at all the moment anything proxies: a tunnel or
 * a load balancer runs beside the server, so EVERY remote request arrives as
 * 127.0.0.1 and sails through. `npm run share` would have published an
 * unauthenticated file write to the internet.
 *
 * So it is opt-in (AR_DEV_SHOTS=1, which `npm run dev` sets), the localhost
 * check stays as a second layer, and the filename is still scrubbed to a bare
 * slug. `npm start` and `npm run share` both leave it off.
 */
const DEV_SHOTS = process.env.AR_DEV_SHOTS === '1';

function handleShot(req, res, url) {
  if (!DEV_SHOTS) { res.writeHead(404).end('not found'); return; }
  const addr = req.socket.remoteAddress || '';
  if (!/^(::1|::ffff:127\.|127\.)/.test(addr)) { res.writeHead(403).end('local only'); return; }
  const name = String(url.searchParams.get('name') || 'shot').replace(/[^a-z0-9_-]/gi, '').slice(0, 48) || 'shot';
  const chunks = [];
  let size = 0;
  req.on('data', (d) => {
    size += d.length;
    if (size > 12e6) { req.destroy(); return; }
    chunks.push(d);
  });
  req.on('end', () => {
    fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'shots', `${name}.png`), Buffer.concat(chunks));
    res.writeHead(200, { 'content-type': 'text/plain' }).end(`shots/${name}.png`);
  });
}

/**
 * What the page should hand out as a room link.
 *
 * A host browsing http://localhost while a tunnel is open would otherwise copy
 * a localhost link and send it to somebody it can never work for. `npm run
 * share` sets AR_PUBLIC_URL to the tunnel's address, and the page uses that
 * instead of whatever it happens to be browsing.
 *
 * Server-configured, never client-supplied, and still parsed before it is
 * echoed so a typo cannot put junk into somebody's clipboard.
 */
function publicUrl() {
  const raw = process.env.AR_PUBLIC_URL || '';
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin;
  } catch {
    return '';
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/health') { res.writeHead(200).end('ok'); return; }
  if (rel === '/config') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ publicUrl: publicUrl() }));
    return;
  }
  if (rel === '/shot' && req.method === 'POST') { handleShot(req, res, url); return; }
  // never hand out the QA scratch directory, least of all over a tunnel
  if (rel.startsWith('/shots/')) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }

  // resolve inside ROOT only — no climbing out with ../
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('nope'); return; }

  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      // modules are edited constantly during development; never serve a stale one
      'cache-control': ext === '.woff2' || ext === '.ogg' ? 'public, max-age=604800' : 'no-store',
    });
    res.end(buf);
  });
});

// ---------------------------------------------------------------------- rooms

/** Unambiguous alphabet: no O/0, no I/1, so a code read aloud still works. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

/**
 * The three ways a room can be arranged.
 *
 *   versus  one each, opposite colonies
 *   coop    both humans share a colony, a bot takes the other
 *   pairs   four humans, two to a colony
 *
 * `team` is a function of SEAT ORDER so it is decided the same way on every
 * client and never negotiated. In pairs the first two to arrive share a colony,
 * which is what makes "get in before the others and you are with your friend"
 * work without a team-picking screen.
 */
const MODES = {
  versus: { seats: 2, team: (i) => i, bot: false },
  coop:   { seats: 2, team: () => 0,  bot: true },
  pairs:  { seats: 4, team: (i) => (i < 2 ? 0 : 1), bot: false },
  // Free-for-all. Every seat is its own colony, so the board is chosen by how
  // many turned up rather than picked from the list: three people play a
  // three-colony ring, six play a six.
  ffa:    { seats: 6, minSeats: 3, team: (i) => i, bot: false, ffa: true },
};
const cleanMode = (m) => (Object.hasOwn(MODES, m) ? m : 'versus');

class Room {
  constructor(code, mode, difficulty, map) {
    this.code = code;
    this.mode = cleanMode(mode);
    this.difficulty = difficulty || 'normal';
    // never trust a client-supplied map id straight into the sim
    this.map = MAP_IDS.includes(map) ? map : DEFAULT_MAP;
    this.seats = [];        // { pid, name, ws, connected, gone }
    this.sim = null;
    this.brains = [];
    this.timer = null;
    this.frame = 0;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
  }

  get capacity() { return MODES[this.mode].seats; }
  /** Free-for-all starts with anything from three up, not only when it is full. */
  get minSeats() { return MODES[this.mode].minSeats ?? this.capacity; }
  get isFfa() { return !!MODES[this.mode].ffa; }
  /** A ring board sized to the people actually in the room. */
  boardId() { return this.isFfa ? boardForTeams(this.seats.length) : this.map; }

  /**
   * Team colours for this room, with a clash settled the same way every time.
   *
   * Ask the first seat of each COLONY, not seats 0 and 1: in pairs those two are
   * team-mates, so reading them as the two colonies would paint both sides from
   * one team's preferences and leave the other side's choice unused.
   */
  resolvedColors() {
    const teams = new Set(this.seats.map((_, i) => this.teamFor(i)));
    const n = Math.max(2, teams.size);
    const firstOf = (team) => this.seats.find((s, i) => this.teamFor(i) === team);
    return resolveColors(Array.from({ length: n }, (_, t) => firstOf(t)?.color));
  }
  get started() { return !!this.sim; }

  seatFor(ws) { return this.seats.find((s) => s.ws === ws); }

  /** In co-op both humans share team 0 and face the bot; in versus they oppose. */
  teamFor(index) { return MODES[this.mode].team(index); }

  add(ws, name, roster, queen, color) {
    if (this.seats.length >= this.capacity) return null;
    const seat = {
      pid: `p${this.seats.length}`,
      name: (name || '').slice(0, 16) || `Colony ${this.seats.length + 1}`,
      roster: cleanLoadout(roster),
      queen: cleanQueen(queen),
      color: cleanColor(color, 'ember'),
      ws, connected: true, gone: 0,
    };
    this.seats.push(seat);
    this.lastActivity = Date.now();
    return seat;
  }

  /** Reclaim a seat whose player dropped, so a refresh does not end the match. */
  resume(ws, pid) {
    const seat = this.seats.find((s) => s.pid === pid && !s.connected);
    if (!seat) return null;
    seat.ws = ws;
    seat.connected = true;
    seat.gone = 0;
    if (this.sim) {
      const p = this.sim.playerById(pid);
      if (p) p.connected = true;
    }
    this.lastActivity = Date.now();
    return seat;
  }

  send(ws, msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  broadcast(msg) {
    const raw = JSON.stringify(msg);
    for (const s of this.seats) if (s.ws && s.ws.readyState === 1) s.ws.send(raw);
  }

  lobbyState() {
    return {
      t: 'lobby',
      code: this.code,
      mode: this.mode,
      map: this.map,
      difficulty: this.difficulty,
      started: this.started,
      capacity: this.capacity,
      players: this.seats.map((s, i) => ({
        pid: s.pid, name: s.name, team: this.teamFor(i), connected: s.connected,
        roster: s.roster, queen: s.queen,
        // the colour a seat will ACTUALLY wear, clashes already resolved, so the
        // lobby shows what the match will show rather than what was asked for
        color: this.resolvedColors()[this.teamFor(i)],
      })),
      canStart: this.seats.length >= this.minSeats,
      minSeats: this.minSeats,
      ffa: this.isFfa,
    };
  }

  start() {
    if (this.started || this.seats.length < this.minSeats) return false;
    const colors = this.resolvedColors();
    const players = this.seats.map((s, i) => ({
      id: s.pid, name: s.name, team: this.teamFor(i),
      roster: s.roster, queen: s.queen, color: colors[this.teamFor(i)],
    }));
    this.sim = new Sim({
      mode: this.mode,
      map: this.boardId(),
      seed: (Math.random() * 1e9) | 0,
      players,
      // co-op needs somebody to raid: the bot takes the whole other side
      ai: MODES[this.mode].bot ? { team: 1, difficulty: 'coop' } : null,
    });
    this.brains = this.mode === 'coop' ? [new AiBrain(this.sim, '@ai', 'coop')] : [];
    this.frame = 0;
    this.broadcast({ t: 'start', full: this.sim.fullState() });
    this.timer = setInterval(() => this.tick(), 1000 / TICK_HZ);
    return true;
  }

  tick() {
    const sim = this.sim;
    if (!sim) return;
    sim.step(DT);
    for (const b of this.brains) b.update(DT);

    // a colony nobody is sitting in forfeits rather than standing there forever
    const now = Date.now();
    for (const s of this.seats) {
      if (s.connected) continue;
      if (!s.gone) s.gone = now;
      if (now - s.gone <= ABANDON_AFTER || sim.over) continue;
      // A colony forfeits when NOBODY is left holding it. In pairs one player
      // dropping leaves a team-mate still playing, and ending their match for
      // them would be the wrong call.
      const team = this.teamFor(this.seats.indexOf(s));
      const stillThere = this.seats.some((o, i) => o.connected && this.teamFor(i) === team);
      if (stillThere) continue;
      // In a free-for-all one colony walking out does not end anybody else's
      // match: its nest simply falls and the rest play on.
      if (this.isFfa) {
        if (sim.nestHp[team] > 0) {
          sim.nestHp[team] = 0;
          s.gone = now;   // only once
        }
        continue;
      }
      sim.over = true;
      sim.winner = MODES[this.mode].bot ? -1 : 1 - team;
      sim.endReason = `${s.name} left the table`;
    }

    if (++this.frame % SNAP_EVERY === 0 || sim.over) {
      this.broadcast({ t: 'snap', s: sim.snapshot() });
    }
    if (sim.over) this.finish();
  }

  finish() {
    clearInterval(this.timer);
    this.timer = null;
    const sim = this.sim;
    this.broadcast({
      t: 'over',
      winner: sim.winner,
      why: sim.endReason,
      stats: sim.players.map((p) => ({
        i: p.index, name: p.name, team: p.team, bot: p.bot,
        kills: p.kills, sent: p.sent, spent: Math.round(p.spent), dealt: Math.round(p.dealt),
      })),
    });
    this.sim = null;
    this.brains = [];
    this.lastActivity = Date.now();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.sim = null;
    this.brains = [];
  }
}

// ------------------------------------------------------------------ websocket

const wss = new WebSocketServer({ server, path: '/ws' });

function fail(ws, why) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'err', why }));
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.room = null;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return fail(ws, 'bad message'); }
    const room = ws.room ? rooms.get(ws.room) : null;

    switch (m.t) {
      case 'create': {
        const code = makeCode();
        const r = new Room(code, m.mode, m.difficulty, m.map);
        rooms.set(code, r);
        const seat = r.add(ws, m.name, m.roster, m.queen, m.color);
        ws.room = code;
        ws.pid = seat.pid;
        r.send(ws, { t: 'seat', code, pid: seat.pid, host: true });
        r.broadcast(r.lobbyState());
        break;
      }

      case 'join': {
        const code = String(m.code || '').toUpperCase().trim();
        const r = rooms.get(code);
        if (!r) return fail(ws, `no room called ${code}`);
        // a refresh mid-match comes back through here and reclaims its colony
        const resumed = m.pid ? r.resume(ws, m.pid) : null;
        const seat = resumed || r.add(ws, m.name, m.roster, m.queen, m.color);
        if (!seat) return fail(ws, 'that room is full');
        ws.room = code;
        ws.pid = seat.pid;
        r.send(ws, { t: 'seat', code, pid: seat.pid, host: r.seats[0] === seat });
        r.broadcast(r.lobbyState());
        if (r.started) r.send(ws, { t: 'start', full: r.sim.fullState() });
        break;
      }

      case 'loadout': {
        if (!room || room.started) return;
        const seat = room.seatFor(ws);
        if (!seat) return;
        seat.roster = cleanLoadout(m.roster);
        seat.queen = cleanQueen(m.queen);
        if (m.color !== undefined) seat.color = cleanColor(m.color, seat.color);
        room.broadcast(room.lobbyState());
        break;
      }

      case 'mode': {
        if (!room || room.started) return;
        if (room.seats[0]?.ws !== ws) return fail(ws, 'only the host sets the mode');
        if (m.mode) {
          const next = cleanMode(m.mode);
          // never shrink the room below the people already in it
          if (MODES[next].seats >= room.seats.length) room.mode = next;
          else return fail(ws, `${room.seats.length} players are already here`);
        }
        if (m.map && MAP_IDS.includes(m.map)) room.map = m.map;
        if (m.difficulty) room.difficulty = m.difficulty;
        room.broadcast(room.lobbyState());
        break;
      }

      case 'start': {
        if (!room) return fail(ws, 'not in a room');
        if (room.seats[0]?.ws !== ws) return fail(ws, 'only the host can start');
        if (!room.start()) fail(ws, 'need both colonies before starting');
        break;
      }

      case 'cmd': {
        if (!room || !room.sim) return;
        const seat = room.seatFor(ws);
        if (!seat) return;
        const r = room.sim.command(seat.pid, m.c || {});
        if (!r.ok) room.send(ws, { t: 'nope', why: r.why, c: m.c });
        room.lastActivity = Date.now();
        break;
      }

      // Relayed, never simulated. The index is checked against the fixed list
      // and the rate limit is enforced HERE rather than in the client, because a
      // client is exactly what a spammer would replace.
      case 'emote': {
        if (!room) return;
        const seat = room.seatFor(ws);
        if (!seat) return;
        if (!isEmote(m.e)) return fail(ws, 'no such emote');
        const now = Date.now();
        if (now - (seat.lastEmote || 0) < EMOTE_GAP) return;
        seat.lastEmote = now;
        room.broadcast({ t: 'emote', team: room.teamFor(room.seats.indexOf(seat)), e: m.e });
        break;
      }

      case 'rematch': {
        if (!room || room.started) return;
        if (room.seats[0]?.ws !== ws) return fail(ws, 'only the host can restart');
        room.start();
        break;
      }

      case 'ping':
        if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'pong', id: m.id }));
        break;

      default:
        fail(ws, `unknown message ${m.t}`);
    }
  });

  ws.on('close', () => {
    const room = ws.room ? rooms.get(ws.room) : null;
    if (!room) return;
    const seat = room.seatFor(ws);
    if (seat) {
      seat.connected = false;
      seat.ws = null;
      seat.gone = Date.now();
      if (room.sim) {
        const p = room.sim.playerById(seat.pid);
        if (p) p.connected = false;
      }
    }
    room.broadcast(room.lobbyState());
    // nobody left and no match running: drop it now rather than wait for the sweep
    if (!room.started && room.seats.every((s) => !s.connected)) {
      room.stop();
      rooms.delete(room.code);
    }
  });
});

// keepalive: hosts and proxies hang up on quiet sockets
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 25_000);

// sweep rooms nobody came back to
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    const empty = r.seats.every((s) => !s.connected);
    if (empty && now - r.lastActivity > EMPTY_ROOM_TTL) {
      r.stop();
      rooms.delete(code);
    }
  }
}, 60_000);

// Bind 0.0.0.0 explicitly. `listen(PORT)` with no host binds `::`, which is
// fine on a dev machine but is exactly what Render's docs tell you not to do:
// their port detection and health checks reach the container over IPv4, and an
// IPv6-only listener makes an instance intermittently unreachable rather than
// cleanly broken.
server.listen(PORT, '0.0.0.0', () => {
  const pub = publicUrl();
  console.log(`Ant Raid on http://localhost:${PORT}`);
  if (DEV_SHOTS) console.log('  dev screenshot sink ON (AR_DEV_SHOTS=1) — do not use this while sharing');
  if (pub) console.log(`  shareable link: ${pub}`);
  else console.log(`  local only. For a link a friend can open: npm run share`);
  console.log(`  sim ${TICK_HZ}Hz, snapshots ${TICK_HZ / SNAP_EVERY}Hz, ws at /ws`);
});
