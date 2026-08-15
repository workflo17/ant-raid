// ===== Drivers: where the simulation actually runs =====
// LocalDriver steps shared/sim.js right here in the page (solo, hot-seat).
// NetDriver receives snapshots from the server and interpolates between them.
// Both expose the same surface, so main.js and the renderer never branch.

import { Sim } from '../shared/sim.js';
import { AiBrain, botLoadout, botQueen } from '../shared/ai.js';
import { buildMap } from '../shared/map.js';
import { DT } from '../shared/data/board.js';
import { buildView } from './view.js';

class Emitter {
  constructor() { this.h = {}; }
  on(k, f) { (this.h[k] ||= []).push(f); return this; }
  emit(k, ...a) { for (const f of this.h[k] || []) f(...a); }
}

/**
 * When each colony was knocked out, which is the one thing a free-for-all result
 * needs and the final state cannot give: everybody who fell reads nought there,
 * whether they went at 2:00 or in the last bite of the match.
 *
 * It lives on the driver rather than in the render loop because a match keeps
 * running in a hidden tab and requestAnimationFrame does not — the same reason
 * the local driver carries a keepalive. A colony that fell while somebody was
 * alt-tabbed still has to count.
 *
 * A STAMP RATHER THAN A POSITION. Colonies seen going down together share one,
 * so a ring that collapses in a single step is four colonies tied rather than
 * four ranked by seat number, which is an order nobody played.
 */
function noteFallen(fellAt, out, mark) {
  if (!out) return fellAt;
  for (let t = 0; t < out.length; t++) if (out[t] && fellAt[t] === undefined) fellAt[t] = mark;
  return fellAt;
}

// ------------------------------------------------------------------ local

export class LocalDriver extends Emitter {
  /**
   * @param opts.seats  [{ name, team }] the humans at this keyboard
   * @param opts.bots   [{ team, difficulty }] colonies the machine plays
   */
  constructor(opts) {
    super();
    this.online = false;
    this.seats = opts.seats;
    const players = opts.seats.map((s, i) => ({ id: `p${i}`, name: s.name, team: s.team, roster: s.roster, queen: s.queen, color: s.color }));
    this.sim = new Sim({
      mode: opts.mode || 'versus',
      map: opts.map,
      seed: (Math.random() * 1e9) | 0,
      players,
      ai: opts.bots?.[0] ? { ...opts.bots[0], roster: botLoadout(), queen: botQueen() } : null,
    });
    this.map = this.sim.map;
    this.brains = (opts.bots || []).map((b) => new AiBrain(this.sim, '@ai', b.difficulty));
    this.mine = opts.seats.map((_, i) => i);
    this.fellAt = [];          // team -> the stamp it was seen to fall on
    this.fellMark = 0;
    this.acc = 0;
    this.last = 0;
    this.running = false;
  }

  start() {
    this.running = true;
    this.emit('start', this.sim.fullState());
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.advance((now - this.last) / 1000);
      this.last = now;
    };
    this.raf = requestAnimationFrame(loop);
    // requestAnimationFrame stops dead in a hidden tab, which would freeze a
    // hot-seat match the moment somebody alt-tabs. Timers clamp to ~1Hz there,
    // so this is slow rather than smooth — but the match keeps moving.
    this.keepalive = setInterval(() => {
      if (!this.running || !document.hidden) return;
      const now = performance.now();
      this.advance((now - this.last) / 1000);
      this.last = now;
    }, 100);
  }

  /** Fixed-step the simulation by up to `dt` seconds of wall clock. */
  advance(dt) {
    if (!this.running) return;
    this.acc += Math.min(0.25, Math.max(0, dt)); // never fast-forward a whole match
    while (this.acc >= DT) {
      this.acc -= DT;
      this.sim.step(DT);
      for (const b of this.brains) b.update(DT);
      noteFallen(this.fellAt, this.sim.out, ++this.fellMark);
      if (this.sim.over) break;
    }
    if (this.sim.over) this.finish();
  }

  finish() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    clearInterval(this.keepalive);
    this.emit('over', {
      winner: this.sim.winner,
      why: this.sim.endReason,
      stats: this.sim.players.map((p) => ({
        i: p.index, name: p.name, team: p.team, bot: p.bot,
        kills: p.kills, sent: p.sent, spent: Math.round(p.spent), dealt: Math.round(p.dealt),
      })),
    });
  }

  send(seat, cmd) {
    const r = this.sim.command(`p${seat}`, cmd);
    if (!r.ok) this.emit('nope', r.why, cmd, seat);
    return r;
  }

  /** No socket to go round, so it comes straight back to the same page. */
  back(at, seat = 0) {
    const from = this.sim.players[seat]?.team ?? 0;
    if (!this.sim.out[from] || !Number.isInteger(at) || at === from
      || at < 0 || at >= this.sim.teamCount || this.sim.out[at]) return;
    this.emit('back', { from, at });
  }

  emote(seat, e, at) {
    const p = this.sim.players[seat];
    const team = p ? p.team : 0;
    // same sanity rules the server applies: a target is a real other colony
    const ok = Number.isInteger(at) && at >= 0 && at < this.sim.teamCount && at !== team;
    this.emit('emote', { team, e, at: ok ? at : -1 });
  }

  view() {
    const s = this.sim.snapshot();
    return buildView(this.map, s, s, 1);
  }

  stop() { this.running = false; cancelAnimationFrame(this.raf); clearInterval(this.keepalive); }
}

// -------------------------------------------------------------------- net

const INTERP_DELAY = 120; // ms behind the newest snapshot, so there is always a pair to blend

export class NetDriver extends Emitter {
  constructor() {
    super();
    this.online = true;
    this.buf = [];
    this.fellAt = [];
    this.fellMark = 0;
    this.mine = [];
    this.pid = null;
    this.code = null;
    this.full = null;
    this.ping = 0;
    this.closed = false;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => {
      this.emit('open');
      this.pinger = setInterval(() => {
        this.pingSentAt = performance.now();
        this.tx({ t: 'ping', id: this.pingSentAt });
      }, 4000);
    };
    this.ws.onmessage = (ev) => this.rx(JSON.parse(ev.data));
    this.ws.onclose = () => {
      clearInterval(this.pinger);
      if (!this.closed) this.emit('down');
    };
    this.ws.onerror = () => {};
    return this;
  }

  tx(m) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); }

  rx(m) {
    switch (m.t) {
      case 'seat':
        this.pid = m.pid; this.code = m.code; this.host = m.host;
        sessionStorage.setItem('antraid.resume', JSON.stringify({ code: m.code, pid: m.pid }));
        this.emit('seat', m);
        break;
      case 'lobby':
        this.emit('lobby', m);
        break;
      case 'start': {
        this.full = m.full;
        // the server picked the map; rebuild the same one to read snapshots
        this.map = buildMap(m.full.map);
        const me = m.full.players.find((p) => p.id === this.pid);
        this.mine = me ? [me.i] : [];
        this.buf = [{ s: m.full.snap, at: performance.now() }];
        this.fellAt = [];
        this.fellMark = 0;
        this.emit('start', m.full);
        break;
      }
      case 'snap':
        this.buf.push({ s: m.s, at: performance.now() });
        // read before the buffer is trimmed, and off the socket rather than off
        // a frame, so a hidden tab still sees who went and in what order
        noteFallen(this.fellAt, m.s.out, ++this.fellMark);
        if (this.buf.length > 12) this.buf.shift();
        break;
      case 'over':
        sessionStorage.removeItem('antraid.resume');
        this.emit('over', m);
        break;
      case 'nope':
        this.emit('nope', m.why, m.c, 0);
        break;
      case 'emote':
        this.emit('emote', m);
        break;
      case 'back':
        this.emit('back', m);
        break;
      case 'pong':
        this.ping = Math.round(performance.now() - m.id);
        break;
      case 'err':
        this.emit('err', m.why);
        break;
    }
  }

  create(name, mode, difficulty, map, roster, queen, color) { this.tx({ t: 'create', name, mode, difficulty, map, roster, queen, color }); }
  join(code, name, pid, roster, queen, color) { this.tx({ t: 'join', code, name, pid, roster, queen, color }); }
  setLoadout(roster, queen, color) { this.tx({ t: 'loadout', roster, queen, color }); }
  setMode(mode) { this.tx({ t: 'mode', mode }); }
  setMap(map) { this.tx({ t: 'mode', map }); }
  /** Fill the empty chairs with bot colonies, or send them home. Host only. */
  setBots(fill) { this.tx({ t: 'bots', fill: !!fill }); }
  startMatch() { this.tx({ t: 'start' }); }
  rematch() { this.tx({ t: 'rematch' }); }
  emote(seat, e, at) { this.tx(Number.isInteger(at) ? { t: 'emote', e, at } : { t: 'emote', e }); }
  back(at) { this.tx({ t: 'back', at }); }

  /** `seat` is ignored online: the server only ever lets you move your own colony. */
  send(seat, cmd) { this.tx({ t: 'cmd', c: cmd }); return { ok: true }; }

  view() {
    if (!this.buf.length) return null;
    const now = performance.now() - INTERP_DELAY;
    let i = this.buf.length - 1;
    while (i > 0 && this.buf[i].at > now) i--;
    const cur = this.buf[Math.min(i + 1, this.buf.length - 1)];
    const prev = this.buf[i];
    const span = cur.at - prev.at;
    const a = span > 0 ? Math.max(0, Math.min(1, (now - prev.at) / span)) : 1;
    // fx must fire exactly once, so drain them off the raw snapshots as they pass
    const fx = [];
    for (const e of this.buf) {
      if (e.at <= now && e.s.fx && e.s.fx.length) { fx.push(...e.s.fx); e.s.fx = []; }
    }
    const v = buildView(this.map, cur.s, prev.s, a);
    v.fx = fx;
    return v;
  }

  stop() { this.closed = true; clearInterval(this.pinger); this.ws?.close(); }
}
