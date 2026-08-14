// ===== Ant Raid — boot, screens, input =====

import { LocalDriver, NetDriver } from './drivers.js';
import { Sim } from '../shared/sim.js';
import { buildView } from './view.js';
import { DT } from '../shared/data/board.js';
import { initBoard, draw, worldFrom, playFx, setHoverPad, tinted, setMap, showEmote } from './board.js';
import { paintThumb } from './scenery.js';
import { recordMatch, recordLine, loadRecord, drawResultCard, shareResult, shareText } from './record.js';
import { Hud } from './hud.js';
import { drawAnt } from './render/ants.js';
import { resetParticles } from './particles.js';
import { sfx, unlockAudio, setMuted, isMuted } from './sound.js';
import { setMapTheme, setIntensity, ensureStarted, setMusicMuted } from './music.js';
import { distToPath, dist } from '../shared/util.js';
import { buildMap, mapList, DEFAULT_MAP } from '../shared/map.js';
import { COLONY_COLORS, cleanColor, resolveColors } from '../shared/data/board.js';
import { teamTint, setColonyColors } from './colors.js';
import { RAIDERS, DEFENDERS, DEFENDER_IDS, RAIDER_IDS, LOADOUT_SIZE, DEFAULT_LOADOUT, cleanLoadout } from '../shared/data/units.js';
import { QUEENS, QUEEN_IDS, HERO, cleanQueen } from '../shared/data/heroes.js';
import { AiBrain, botLoadout, botQueen } from '../shared/ai.js';
import { EMOTES } from '../shared/data/emotes.js';

const $ = (s) => document.querySelector(s);
const screens = ['intro', 'title', 'lobby', 'game', 'over'];
let driver = null, huds = [], mouseSeat = 0, myTeam = 0, lastT = 0, raf = 0, mode = 'versus';
let padMenu = null;
let MAP = null;                                  // the built map this match is on
let worstDeficit = 0;                            // the hole you climbed out of
let lastLaneTap = null;                          // for the touch double-tap send
let lastResult = null;                           // what the share card describes
let chosenMap = localStorage.getItem('antraid.map') || DEFAULT_MAP;
let chosenPack = cleanLoadout(JSON.parse(localStorage.getItem('antraid.pack') || 'null') || DEFAULT_LOADOUT);
let chosenQueen = cleanQueen(localStorage.getItem('antraid.queen'));
let chosenColor = cleanColor(localStorage.getItem('antraid.color'), 'ember');

function show(name) {
  for (const s of screens) $(`#screen-${s}`).classList.toggle('hidden', s !== name);
  if (name !== 'game') { cancelAnimationFrame(raf); raf = 0; }
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1600);
}

// ---------------------------------------------------------------- audio

let audioReady = false;
function wakeAudio() {
  if (audioReady) return;
  audioReady = true;
  try { unlockAudio(); setMapTheme('menu'); setIntensity(0); ensureStarted(); } catch { /* no audio, no problem */ }
}
addEventListener('pointerdown', wakeAudio, { once: true });
addEventListener('keydown', wakeAudio, { once: true });

// ---------------------------------------------------------------- intro
//
// The hero of the front screen is the game itself: two bot colonies play a real
// match behind the menu. It is the one thing a screenshot of this game cannot
// do, and it costs one Sim and one rAF loop because both already exist.
//
// It borrows the SAME renderer the match uses, which means it also borrows
// board.js's module state (the bound canvas, the baked ground, the wear layer).
// stopIntro() has to run before a real match is wired or the two fight over it.

let intro = null;

function startIntro() {
  stopIntro();
  const cv = $('#intro-board');
  const ids = mapList().map((m) => m.id);
  const state = { raf: 0, acc: 0, last: 0, sim: null, brains: [], map: null, cv };

  const nextMatch = () => {
    const id = ids[Math.floor(Math.random() * ids.length)];
    state.map = buildMap(id);
    setMap(state.map);
    initBoard(cv, state.map);
    // the two colonies wear the player's own colour against a contrasting one,
    // so the front screen previews the choice they last made
    setColonyColors(resolveColors([chosenColor, chosenColor === 'frost' ? 'ember' : 'frost']));
    state.sim = new Sim({
      mode: 'versus',
      map: id,
      seed: (Math.random() * 1e9) | 0,
      players: [
        { id: 'A', name: 'A', team: 0, roster: botLoadout(), queen: botQueen() },
        { id: 'B', name: 'B', team: 1, roster: botLoadout(), queen: botQueen() },
      ],
    });
    state.brains = [new AiBrain(state.sim, 'A', 'normal'), new AiBrain(state.sim, 'B', 'normal')];
    // open on a board that already has ants on it rather than an empty one
    for (let i = 0; i < 40 * 30; i++) {
      state.sim.step(DT);
      for (const b of state.brains) b.update(DT);
      state.sim.fx.length = 0;
      if (state.sim.over) break;
    }
  };

  const paint = (dt) => {
    const s = state.sim.snapshot();
    draw(buildView(state.map, s, s, 1), dt);
  };

  nextMatch();
  intro = state;

  // Less motion means a still board: one frame, no loop, no sim running under
  // a menu the player is trying to read.
  let still = false;
  try { still = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* older browser */ }
  if (still) { paint(0); return; }

  state.last = performance.now();
  const loop = (now) => {
    if (intro !== state) return;
    state.raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - state.last) / 1000);
    state.last = now;
    state.acc += dt;
    while (state.acc >= DT) {
      state.acc -= DT;
      state.sim.step(DT);
      for (const b of state.brains) b.update(DT);
      if (state.sim.over) break;
    }
    state.sim.fx.length = 0;      // attract mode is silent: no sound, no popups
    paint(dt);
    // a finished match rolls straight into another one on a different board
    if (state.sim.over) nextMatch();
  };
  state.raf = requestAnimationFrame(loop);
}

function stopIntro() {
  if (!intro) return;
  cancelAnimationFrame(intro.raf);
  intro = null;
}

/** Leave the front screen for the setup screen. */
function enterTitle(openJoin = false) {
  stopIntro();
  show('title');
  $('#join-row').classList.toggle('hidden', !openJoin);
  $('#solo-row').classList.add('hidden');
  if (openJoin) $('#join-code').focus();
}

// ---------------------------------------------------------------- title art

function paintTitle() {
  const cv = $('#title-canvas');
  const c = cv.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = 520 * dpr; cv.height = 180 * dpr;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, 520, 180);
  // two columns marching at each other across a crumb: the whole game in one image
  const cast = ['worker', 'trapjaw', 'archer'];
  cast.forEach((k, i) => {
    const d = RAIDERS[k];
    drawAnt(c, d.species, tinted(d, 0), { x: 74 + i * 62, y: 118, angle: 0, scale: 0.9, time: i * 0.8 });
  });
  cast.slice().reverse().forEach((k, i) => {
    const d = RAIDERS[k];
    drawAnt(c, d.species, tinted(d, 1), { x: 446 - i * 62, y: 118, angle: Math.PI, scale: 0.9, time: i * 1.3 });
  });
  c.save();
  c.translate(260, 108);
  c.fillStyle = '#f6e3a8'; c.strokeStyle = '#2b1a10'; c.lineWidth = 3;
  c.beginPath(); c.roundRect(-17, -17, 34, 34, 6); c.fill(); c.stroke();
  c.restore();
}

// ---------------------------------------------------------------- board picker

/**
 * Paints a real thumbnail of each board. A row of coloured rectangles would not
 * tell you that the Night Porch is dark or that the Kitchen is cramped.
 */
function buildMapStrip(el, { onPick, locked }) {
  el.innerHTML = '';
  el.classList.toggle('locked', !!locked);
  for (const m of mapList()) {
    const b = document.createElement('button');
    b.className = 'map-card' + (m.id === chosenMap ? ' on' : '');
    b.type = 'button';
    b.dataset.map = m.id;
    b.title = `${m.blurb} ${m.note}`;
    b.setAttribute('aria-pressed', String(m.id === chosenMap));
    b.setAttribute('aria-label', `${m.name}. ${m.blurb} ${m.note}`);

    const cv = document.createElement('canvas');
    const w = 276, h = Math.round(w * 640 / 960);
    cv.width = w * 2; cv.height = h * 2;
    cv.setAttribute('aria-hidden', 'true');
    const g = cv.getContext('2d');
    g.scale(2, 2);
    paintThumb(g, buildMap(m.id), w, h);

    b.appendChild(cv);
    b.insertAdjacentHTML('beforeend',
      `<span class="mt">${m.tag}</span><span class="mn">${m.name}</span><span class="mb">${m.note}</span>`);
    if (!locked) b.onclick = () => onPick(m.id);
    el.appendChild(b);
  }
}

function pickMap(id, strips) {
  chosenMap = id;
  localStorage.setItem('antraid.map', id);
  for (const el of strips) {
    for (const b of el.querySelectorAll('.map-card')) {
      const on = b.dataset.map === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }
}

/**
 * The loadout picker. Five of seven, and because eco is now the main way a purse
 * grows, each card shows what it earns as well as what it costs: packing all
 * heavies is a real decision with a real downside.
 */
function buildPackStrip(el, countEl, { onPick, locked }) {
  el.innerHTML = '';
  el.classList.toggle('locked', !!locked);
  for (const id of RAIDER_IDS) {
    const def = RAIDERS[id];
    const slot = chosenPack.indexOf(id);
    const b = document.createElement('button');
    b.className = 'pack' + (slot >= 0 ? ' on' : '');
    b.type = 'button';
    b.dataset.unit = id;
    b.title = `${def.name}. ${def.cost} sugar, adds ${def.eco}/s income. ${def.tagline}`;
    b.setAttribute('aria-pressed', String(slot >= 0));
    b.setAttribute('aria-label', `${def.name}, ${def.cost} sugar, adds ${def.eco} income per second. ${def.tagline}`);

    const cv = document.createElement('canvas');
    cv.width = 92; cv.height = 92;
    cv.setAttribute('aria-hidden', 'true');
    const g = cv.getContext('2d');
    g.scale(2, 2);
    g.save(); g.translate(23, 27); g.scale(0.62, 0.62);
    drawAnt(g, def.species, tinted(def, 0), { x: 0, y: 0, angle: -Math.PI / 2, scale: 1, time: 0 });
    g.restore();

    b.appendChild(cv);
    b.insertAdjacentHTML('beforeend',
      `<span class="pn">${def.name}</span><span class="pc">${def.cost}</span><span class="pe">+${def.eco}/s</span>` +
      (slot >= 0 ? `<span class="slot">${slot + 1}</span>` : ''));
    if (!locked) b.onclick = () => onPick(id);
    el.appendChild(b);
  }
  if (countEl) {
    countEl.textContent = `${chosenPack.length} of ${LOADOUT_SIZE}`;
    countEl.style.color = chosenPack.length === LOADOUT_SIZE ? '' : 'var(--ember)';
  }
}

/** Toggle an ant in or out of the pack, keeping the pack exactly five. */
function togglePack(id, redraw) {
  const at = chosenPack.indexOf(id);
  if (at >= 0) {
    if (chosenPack.length <= 1) return toast('You have to bring something');
    chosenPack.splice(at, 1);
  } else {
    if (chosenPack.length >= LOADOUT_SIZE) {
      return toast(`Five is the limit. Drop one first.`);
    }
    chosenPack.push(id);
  }
  localStorage.setItem('antraid.pack', JSON.stringify(chosenPack));
  redraw();
  if (driver?.online) driver.setLoadout(chosenPack, chosenQueen, chosenColor);
}

/**
 * The queen picker. One of four, and unlike the pack it is a single choice, so
 * this is a radio row rather than a set of toggles. Her ability is the reason to
 * pick one over another, so the card leads with it.
 */
function buildQueenStrip(el, { locked } = {}) {
  el.innerHTML = '';
  el.classList.toggle('locked', !!locked);
  for (const id of QUEEN_IDS) {
    const q = QUEENS[id];
    const b = document.createElement('button');
    b.className = 'qpick' + (id === chosenQueen ? ' on' : '');
    b.type = 'button';
    b.dataset.queen = id;
    b.title = `${q.name}. ${q.tagline} ${q.ability.name} unlocks at level ${HERO.abilityAt}: ${q.ability.tagline}`;
    b.setAttribute('aria-pressed', String(id === chosenQueen));
    b.setAttribute('aria-label', `${q.name}. ${q.tagline} Her ability is ${q.ability.name}: ${q.ability.tagline}`);

    const cv = document.createElement('canvas');
    cv.width = 96; cv.height = 96;
    cv.setAttribute('aria-hidden', 'true');
    const g = cv.getContext('2d');
    g.scale(2, 2);
    g.save(); g.translate(24, 30); g.scale(0.6, 0.6);
    drawAnt(g, 'hero', tinted(q, 0), { x: 0, y: 0, angle: -Math.PI / 2, scale: 1, time: 0, hero: q.art });
    g.restore();

    b.appendChild(cv);
    b.insertAdjacentHTML('beforeend',
      `<span class="pn">${q.name}</span>` +
      `<span class="qa">${q.ability.icon} ${q.ability.name}</span>`);
    if (!locked) b.onclick = () => pickQueen(id);
    el.appendChild(b);
  }
}

/**
 * The colony colour picker. It repaints the whole page immediately rather than
 * waiting for a match, because the ant portraits on the queen and pack cards are
 * canvas and the only way to show what you picked is to draw it again.
 */
function buildColorStrip(el) {
  el.innerHTML = '';
  for (const col of COLONY_COLORS) {
    const b = document.createElement('button');
    b.className = 'cpick' + (col.id === chosenColor ? ' on' : '');
    b.type = 'button';
    b.dataset.color = col.id;
    b.style.setProperty('--swatch', col.accent);
    b.style.setProperty('--swatch-ring', col.ring);
    b.title = `Your colony fights in ${col.name}`;
    b.setAttribute('aria-pressed', String(col.id === chosenColor));
    b.setAttribute('aria-label', `Colony colour ${col.name}`);
    b.innerHTML = `<span class="sw" aria-hidden="true"></span><span class="cn">${col.name}</span>`;
    b.onclick = () => pickColor(col.id);
    el.appendChild(b);
  }
}

function pickColor(id) {
  chosenColor = cleanColor(id, 'ember');
  localStorage.setItem('antraid.color', chosenColor);
  // preview it everywhere at once: menu art, HUD variables, the lot
  setColonyColors(resolveColors([chosenColor, chosenColor === 'frost' ? 'ember' : 'frost']));
  paintTitle();
  redrawPacks();
  if (driver?.online) driver.setLoadout(chosenPack, chosenQueen, chosenColor);
}

function pickQueen(id) {
  chosenQueen = cleanQueen(id);
  localStorage.setItem('antraid.queen', chosenQueen);
  redrawPacks();
  if (driver?.online) driver.setLoadout(chosenPack, chosenQueen, chosenColor);
}

const redrawPacks = () => {
  buildPackStrip($('#pack-strip'), $('#pack-count'), { onPick: (id) => togglePack(id, redrawPacks) });
  buildQueenStrip($('#queen-strip'), {});
  buildColorStrip($('#color-strip'));
  if (!$('#screen-lobby').classList.contains('hidden')) {
    buildPackStrip($('#lobby-pack-strip'), $('#lobby-pack-count'), { onPick: (id) => togglePack(id, redrawPacks) });
    buildQueenStrip($('#lobby-queen-strip'), {});
    buildColorStrip($('#lobby-color-strip'));
  }
};

// ---------------------------------------------------------------- title menu

let chosenDifficulty = 'normal';

$('#name').value = localStorage.getItem('antraid.name') || '';
$('#name').oninput = (e) => localStorage.setItem('antraid.name', e.target.value);
const myName = () => ($('#name').value || '').trim().slice(0, 16);

document.querySelectorAll('[data-go]').forEach((b) => {
  b.onclick = () => {
    const go = b.dataset.go;
    $('#join-row').classList.toggle('hidden', go !== 'join');
    $('#solo-row').classList.toggle('hidden', go !== 'solo');
    if (go === 'join') $('#join-code').focus();
    if (go === 'host') hostRoom();
    if (go === 'hotseat') {
      if (matchMedia('(max-width: 760px)').matches) {
        toast('Hot-seat needs a keyboard. Try Solo or Play with a friend.');
        return;
      }
      startHotseat();
    }
  };
});

document.querySelectorAll('[data-diff]').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('[data-diff]').forEach((o) => o.classList.remove('on'));
    b.classList.add('on');
    chosenDifficulty = b.dataset.diff;
  };
});

$('#solo-go').onclick = () => startSolo(chosenDifficulty);
$('#solo-cancel').onclick = () => $('#solo-row').classList.add('hidden');
$('#join-cancel').onclick = () => $('#join-row').classList.add('hidden');
$('#join-go').onclick = () => joinRoom($('#join-code').value.trim().toUpperCase());
$('#join-code').onkeydown = (e) => { if (e.key === 'Enter') $('#join-go').click(); };

// ---------------------------------------------------------------- local play

function startSolo(difficulty) {
  mode = 'versus';
  driver = new LocalDriver({
    mode: 'versus',
    map: chosenMap,
    seats: [{ name: myName() || teamTint(0).name, team: 0, roster: chosenPack, queen: chosenQueen, color: chosenColor }],
    bots: [{ team: 1, difficulty }],
  });
  wireDriver([{ seat: 0, team: 0, keys: true, label: null }]);
  driver.start();
}

function startHotseat() {
  mode = 'versus';
  driver = new LocalDriver({
    mode: 'versus',
    map: chosenMap,
    // hot-seat: player two gets its own pack so the two halves differ
    seats: [
      { name: myName() || teamTint(0).name, team: 0, roster: chosenPack, queen: chosenQueen, color: chosenColor },
      { name: teamTint(1).name, team: 1, roster: botLoadout(), queen: botQueen() },
    ],
    bots: [],
  });
  // one on the keys, one on the mouse — the only way two people share a screen
  wireDriver([
    { seat: 0, team: 0, keys: true, label: 'Keys' },
    { seat: 1, team: 1, keys: false, label: 'Mouse' },
  ]);
  mouseSeat = 1;
  driver.start();
}

// ---------------------------------------------------------------- online

function net() {
  const d = new NetDriver().connect();
  d.on('err', (why) => toast(why));
  d.on('down', () => { toast('Lost the connection'); show('title'); });
  d.on('seat', () => renderLobby(null));
  d.on('lobby', (m) => renderLobby(m));
  d.on('start', () => {
    myTeam = d.full.players.find((p) => p.id === d.pid)?.team ?? 0;
    wireDriver([{ seat: 0, team: myTeam, keys: true, label: null }], d.mine[0]);
  });
  return d;
}

function hostRoom() {
  driver = net();
  driver.on('open', () => driver.create(myName(), 'versus', 'normal', chosenMap, chosenPack, chosenQueen, chosenColor));
  show('lobby');
}

function joinRoom(code, pid) {
  if (!code) return toast('Type the four-letter code');
  driver = net();
  driver.on('open', () => driver.join(code, myName(), pid, chosenPack, chosenQueen, chosenColor));
  show('lobby');
}

// ------------------------------------------------------------- the link
//
// A room code is worthless without a URL the other person can actually open,
// and the commonest way to get this wrong is to copy `http://localhost:5010`
// and send it to somebody on the other side of the country. So the lobby says
// out loud how far the link it is showing you actually reaches.

let PUBLIC_URL = '';

/** The server tells us its public address when it has one (see npm run share). */
async function loadPublicUrl() {
  try {
    const r = await fetch('/config');
    if (!r.ok) return;
    const c = await r.json();
    if (typeof c.publicUrl === 'string' && /^https?:\/\//.test(c.publicUrl)) PUBLIC_URL = c.publicUrl;
  } catch { /* older server, or offline: fall back to whatever we are browsing */ }
}

/** public: anyone can open it. lan: same wifi only. local: this machine only. */
function reachOf(origin) {
  let host;
  try { host = new URL(origin).hostname.replace(/^\[|\]$/g, ''); } catch { return 'local'; }
  if (host === 'localhost' || host === '::1' || /^127\./.test(host)) return 'local';
  if (/^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || /^169\.254\./.test(host)
    || host.endsWith('.local')) return 'lan';
  return 'public';
}

function roomLink(code) {
  const origin = PUBLIC_URL || location.origin;
  return `${origin}${location.pathname}?r=${code}`;
}

const REACH_COPY = {
  public: {
    label: 'Anyone can open this',
    note: 'Send it however you like. The room disappears ten minutes after everyone leaves.',
  },
  lan: {
    label: 'Same wifi only',
    note: 'Anyone on this network can open it. For a friend somewhere else, stop the server and run <code>npm run share</code>.',
  },
  local: {
    label: 'This computer only',
    note: 'Nobody else can open this address. For a link you can send, stop the server and run <code>npm run share</code>, or deploy it once with DEPLOY.md.',
  },
};

function renderShare(code) {
  const link = roomLink(code);
  const reach = reachOf(PUBLIC_URL || location.origin);
  const copy = REACH_COPY[reach];
  $('#share-link').value = link;
  const r = $('#share-reach');
  r.className = `reach ${reach}`;
  r.textContent = copy.label;
  $('#share-note').innerHTML = copy.note;
}

function renderLobby(m) {
  show('lobby');
  const d = driver;
  const code = m?.code || d.code || '····';
  $('#room-code').textContent = code;
  $('#sharebox').classList.toggle('hidden', !d.code);
  if (d.code) renderShare(d.code);
  const isHost = d.host;
  $('#mode-block').classList.toggle('hidden', !isHost);
  $('#lobby-hint').textContent = isHost
    ? 'Send that link to your friend. The raid starts when you say so.'
    : `Waiting for the host to start.`;

  const seats = $('#seats');
  seats.innerHTML = '';
  const players = m?.players || [];
  for (let i = 0; i < 2; i++) {
    const p = players[i];
    const li = document.createElement('li');
    li.className = `seat ${p ? `t${p.team}` : 'empty'}`;
    if (p?.color) li.style.setProperty('--seat-color', COLONY_COLORS.find((c) => c.id === p.color)?.accent || '');
    const packed = (p?.roster || []).map((id) =>
      `<i style="background:${RAIDERS[id].color}" title="${RAIDERS[id].name}"></i>`).join('');
    const qn = p?.queen && QUEENS[p.queen] ? QUEENS[p.queen].name : '';
    li.innerHTML = p
      ? `<span class="dot"></span><span>${escapeHtml(p.name)}</span>` +
        `<span class="packed" aria-label="packed: ${(p.roster || []).map((id) => RAIDERS[id].name).join(', ')}">${packed}</span>` +
        (qn ? `<span class="qtag">${qn}</span>` : '') +
        `<span class="tag">${p.pid === d.pid ? 'you' : ''}${p.connected ? '' : ' · away'}</span>`
      : `<span class="dot"></span><span>Waiting for a second colony…</span>`;
    seats.appendChild(li);
  }

  if (m) {
    mode = m.mode;
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m.mode));
    if (m.map) chosenMap = m.map;
  }
  buildMapStrip($('#lobby-map-strip'), {
    locked: !isHost,
    onPick: (id) => { pickMap(id, [$('#map-strip'), $('#lobby-map-strip')]); driver.setMap(id); },
  });
  buildPackStrip($('#lobby-pack-strip'), $('#lobby-pack-count'), { onPick: (id) => togglePack(id, redrawPacks) });
  buildQueenStrip($('#lobby-queen-strip'), {});
  const btn = $('#lobby-start');
  btn.disabled = !isHost || !m?.canStart;
  btn.textContent = !isHost ? 'The host starts this one'
    : m?.canStart ? 'Start the raid'
    : 'Waiting for a second colony';
}

document.querySelectorAll('[data-mode]').forEach((b) => {
  b.onclick = () => driver?.setMode?.(b.dataset.mode);
});
$('#lobby-start').onclick = () => driver.startMatch();
$('#lobby-leave').onclick = () => leave();
$('#copy-link').onclick = async () => {
  if (!driver?.code) return;
  const url = roomLink(driver.code);
  try {
    await navigator.clipboard.writeText(url);
    toast(reachOf(PUBLIC_URL || location.origin) === 'public'
      ? 'Link copied' : 'Copied, but read the note under it');
  } catch {
    // no clipboard permission: select it so they can copy it themselves
    const el = $('#share-link');
    el.focus(); el.select();
    toast('Press Ctrl+C to copy');
  }
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// ---------------------------------------------------------------- the match

function wireDriver(seatSpecs, netIndex) {
  // the front screen borrows this renderer, so it has to be off before a real
  // match binds its own canvas, bakes its own ground and resets the wear layer
  stopIntro();
  // the roster, the queens and the COLOURS all come from here, and the colours
  // have to be live before anything bakes: the nest damage stages are painted
  // in colony colours and there is no cheap way to recolour them afterwards
  const full = driver.full || driver.sim?.fullState();
  setColonyColors(full?.colors || resolveColors([chosenColor, 'frost']));

  MAP = driver.map || buildMap(chosenMap);
  setMap(MAP);
  const cv = initBoard($('#board'), MAP);
  resetParticles();
  worstDeficit = 0;
  huds = [];
  mouseSeat = 0;
  padMenu = null;
  $('#padmenu').classList.add('hidden');

  const railIds = ['#rail-0', '#rail-1'];
  const hudIds = ['#hud-0', '#hud-1'];
  $('#rail-1').classList.toggle('hidden', seatSpecs.length < 2);
  $('#hud-1').classList.toggle('hidden', seatSpecs.length < 2);

  const seatIndex = (spec, i) => (netIndex !== undefined && i === 0 ? netIndex : spec.seat);

  seatSpecs.forEach((spec, i) => {
    const h = new Hud({
      map: MAP,
      roster: full?.players.find((q) => q.i === seatIndex(spec, i))?.roster || chosenPack,
      queen: full?.players.find((q) => q.i === seatIndex(spec, i))?.queen || chosenQueen,
      railEl: $(railIds[i]),
      hudEl: $(hudIds[i]),
      seat: spec.seat,
      team: spec.team,
      keys: spec.keys,
      label: spec.label,
      onCmd: (seat, cmd) => driver.send(seat, cmd),
    });
    h.meIndex = seatIndex(spec, i);
    huds.push(h);
  });

  driver.on('nope', (why) => toast(why));
  driver.on('over', (m) => showResult(m));
  driver.on('emote', (m) => showEmote(m.team, m.e));
  buildEmoteBar(seatSpecs[0]?.seat ?? 0);

  // colony names on the nest bar
  if (full) {
    const t0 = full.players.find((p) => p.team === 0);
    const t1 = full.players.find((p) => p.team === 1);
    $('#nest-0 .nest-name').textContent = (t0?.name || teamTint(0).name).slice(0, 12);
    $('#nest-1 .nest-name').textContent = (t1?.name || teamTint(1).name).slice(0, 12);
    for (const h of huds) h.padIdx = full.players.find((p) => p.i === h.meIndex)?.pads || [];
  }

  show('game');
  // the audio module keeps its own theme names from Grubs TD; give each board a
  // different one so the two worlds do not share a single tune
  const TUNE = { litter: 'garden', gully: 'bath', galleries: 'kitchen', deep: 'nightporch' };
  try { setMapTheme(TUNE[MAP?.id] || 'picnic'); setIntensity(1); } catch { /* audio off */ }
  wireBoardInput(cv);
  lastT = performance.now();
  loop(lastT);
}

let lastHp = [100, 100];
function loop(now) {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  const view = driver?.view?.();
  draw(view, dt, { aimLane: huds[mouseSeat]?.lane ?? huds[0]?.lane, aimTeam: huds[mouseSeat]?.team ?? 0 });
  if (!view) return;

  if (view.fx?.length) playFx(view.fx, sfx);

  for (const h of huds) h.update(view, h.meIndex);

  // how far behind you have been: the number worth bragging about
  const meTeam = huds[0]?.team ?? 0;
  worstDeficit = Math.max(worstDeficit, view.nestHp[1 - meTeam] - view.nestHp[meTeam]);

  // nest bars
  for (const t of [0, 1]) {
    const hp = Math.max(0, view.nestHp[t]);
    const el = $(`#nest-${t}`);
    el.querySelector('.nest-hp').textContent = Math.ceil(hp);
    el.querySelector('.bar i').style.width = `${hp}%`;
    if (hp < lastHp[t] - 0.5) {
      el.classList.remove('hurt'); void el.offsetWidth; el.classList.add('hurt');
    }
    lastHp[t] = hp;
  }

  const s = Math.floor(view.t);
  $('#clock').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  $('#clock-note').textContent = view.t >= 480 ? 'Sudden death' : '';
  try { setIntensity(Math.min(3, Math.floor(view.units.length / 9))); } catch { /* audio off */ }
}

// ---------------------------------------------------------------- board input

function wireBoardInput(cv) {
  cv.onpointermove = (e) => {
    const w = worldFrom(e);
    setHoverPad(nearestPad(w, null));
    cv.style.cursor = nearestPad(w, mySeats()) ? 'pointer' : 'crosshair';
  };
  cv.onpointerleave = () => setHoverPad(null);

  cv.onpointerdown = (e) => {
    const w = worldFrom(e);
    const pad = nearestPad(w, mySeats());
    if (pad) { openPadMenu(pad, e); return; }
    closePadMenu();
    // a double tap on a lane sends the last thing you bought down it, so a
    // phone player is not forced back to the shop strip for every push
    if (e.pointerType === 'touch') {
      const now = performance.now();
      if (lastLaneTap && now - lastLaneTap.t < 400) {
        const h = huds[mouseSeat];
        if (h?.lastBought) { h.buy(h.lastBought); lastLaneTap = null; return; }
      }
      lastLaneTap = { t: now };
    }
    // otherwise the click aims: pick the lane whose road is nearest the pointer
    let best = 0, bestD = Infinity;
    for (let l = 0; l < MAP.lanes.length; l++) {
      const d = distToPath(MAP.lanes[l].path, w.x, w.y);
      if (d < bestD) { bestD = d; best = l; }
    }
    if (bestD < 90) huds[mouseSeat]?.aim(best);
  };

  addEventListener('keydown', onKey);
}

/**
 * Six fixed things you can say. The button sends an INDEX; nothing a player
 * types ever leaves this page, which is why there is no moderation problem and
 * no escaping to get wrong.
 */
function buildEmoteBar(seat) {
  const el = $('#emotebar');
  el.innerHTML = '';
  EMOTES.forEach((e, i) => {
    const b = document.createElement('button');
    b.className = 'em';
    b.type = 'button';
    b.title = e.text;
    b.setAttribute('aria-label', `Say: ${e.text}`);
    b.innerHTML = `<span class="eg" aria-hidden="true">${e.glyph}</span><span class="et">${e.text}</span>`;
    b.onclick = () => driver?.emote?.(seat, i);
    el.appendChild(b);
  });
}

function mySeats() {
  return huds.map((h) => ({ seat: h.seat, team: h.team, meIndex: h.meIndex, padIdx: h.padIdx || [] }));
}

/** The pad under the pointer, optionally restricted to ones a local seat owns. */
function nearestPad(w, seats) {
  for (const team of [0, 1]) {
    for (const p of MAP.pads[team]) {
      if (dist(w.x, w.y, p.x, p.y) > 30) continue;
      if (!seats) return { team, pad: p.i, seat: null };
      const owner = seats.find((s) => s.team === team && s.padIdx.includes(p.i));
      if (owner) return { team, pad: p.i, seat: owner.seat, meIndex: owner.meIndex };
      return null;
    }
  }
  return null;
}

function closePadMenu() { $('#padmenu').classList.add('hidden'); padMenu = null; }

function openPadMenu(pad, ev) {
  const el = $('#padmenu');
  const view = driver.view();
  const existing = view?.defs.find((d) => d.team === pad.team && d.pad === pad.pad);
  const hud = huds.find((h) => h.seat === pad.seat);
  el.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'pm-head';
  const spot = MAP.pads[pad.team][pad.pad];
  const reach = spot.rangeMul > 1 ? ' · high ground, +reach'
    : spot.rangeMul < 1 ? ' · in the dark, less reach' : '';
  head.textContent = (existing
    ? `${DEFENDERS[existing.k].name} on the ${MAP.lanes[spot.lane].name}`
    : `Build on the ${MAP.lanes[spot.lane].name}`) + reach;
  el.appendChild(head);

  if (existing) {
    const foot = document.createElement('div');
    foot.className = 'pm-foot';
    const refund = Math.floor(DEFENDERS[existing.k].cost * 0.6);
    foot.innerHTML = `<button class="pill go">Sell for ${refund}</button><button class="pill quiet">Close</button>`;
    foot.children[0].onclick = () => { driver.send(pad.seat, { kind: 'sell', pad: pad.pad }); closePadMenu(); };
    foot.children[1].onclick = closePadMenu;
    el.appendChild(foot);
  } else {
    for (const id of DEFENDER_IDS) {
      const def = DEFENDERS[id];
      const b = document.createElement('button');
      b.className = 'card';
      b.type = 'button';
      b.title = `${def.name}. ${def.tagline}`;
      b.innerHTML = `<span class="cn">${def.name}</span><span class="cc">${def.cost}</span>`;
      if (hud && hud.sugar < def.cost) b.classList.add('broke');
      b.onclick = () => { driver.send(pad.seat, { kind: 'build', def: id, pad: pad.pad }); closePadMenu(); };
      el.appendChild(b);
    }
    const foot = document.createElement('div');
    foot.className = 'pm-foot';
    foot.innerHTML = `<button class="pill quiet">Close</button>`;
    foot.children[0].onclick = closePadMenu;
    el.appendChild(foot);
  }

  el.classList.remove('hidden');
  // keep it on the board rather than off the edge
  const wrap = $('#board').getBoundingClientRect();
  const menuW = 340;
  let left = ev.clientX - wrap.left - menuW / 2;
  left = Math.max(6, Math.min(wrap.width - menuW - 6, left));
  const top = pad.team === 0 || true ? Math.min(wrap.height - el.offsetHeight - 6, ev.clientY - wrap.top + 18) : 0;
  el.style.left = `${left}px`;
  el.style.top = `${Math.max(6, top)}px`;
  el.querySelector('button')?.focus();
  padMenu = pad;
}

function onKey(e) {
  if ($('#screen-game').classList.contains('hidden')) return;
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape') { closePadMenu(); return; }
  if (e.key === 'm' || e.key === 'M') {
    setMuted(!isMuted()); setMusicMuted(isMuted());
    toast(isMuted() ? 'Sound off' : 'Sound on');
    return;
  }
  for (const h of huds) if (h.keys && h.handleKey(e)) { e.preventDefault(); return; }
}

// ---------------------------------------------------------------- result

function showResult(m) {
  show('over');
  try { setMapTheme('menu'); setIntensity(0); } catch { /* audio off */ }
  const mineTeam = huds[0]?.team ?? 0;
  const won = m.winner === mineTeam;
  const drew = m.winner < 0;

  const meIdx = huds[0]?.meIndex ?? 0;
  const meStat = m.stats.find((s) => s.i === meIdx) || m.stats[0];
  const foeStat = m.stats.find((s) => s.team !== mineTeam) || m.stats[1];
  const view = driver?.view?.();
  lastResult = {
    won, drew,
    map: MAP?.id,
    myTeam: mineTeam,
    myName: meStat?.name, theirName: foeStat?.name,
    nestHp: view?.nestHp || [0, 0],
    t: view?.t || 0,
    sent: meStat?.sent || 0,
    kills: meStat?.kills || 0,
    eco: view?.players.find((p) => p.i === meIdx)?.e || 0,
    comeback: won ? Math.max(0, worstDeficit) : 0,
    streak: loadRecord().streak,
    roster: huds[0]?.roster || [],
    url: `${location.origin}${location.pathname}`,
  };

  // a hot-seat match has no "you", so it does not belong in a personal record
  if (huds.length === 1) {
    const r = recordMatch({
      won, drew, map: MAP?.id,
      opponent: foeStat?.name, bot: !!foeStat?.bot,
    });
    $('#over-record').textContent =
      `${r.wins}W ${r.losses}L` + (r.streak >= 2 ? `  ·  ${r.streak} in a row`
        : r.streak <= -2 ? `  ·  ${-r.streak} lost in a row` : '');
  } else {
    $('#over-record').textContent = '';
  }

  try { drawResultCard($('#result-card'), lastResult); } catch { /* card is optional */ }
  const v = $('#verdict');
  v.className = 'verdict ' + (m.winner < 0 ? '' : won ? 'win' : 'lose');
  v.textContent = m.winner < 0 ? 'Nobody took the crumb'
    : huds.length > 1 ? `${teamTint(m.winner).name} takes it`
    : won ? 'Their nest is rubble' : 'Your nest is rubble';
  $('#verdict-why').textContent = m.why;
  if (won) sfx.win?.(); else sfx.deny?.();

  const rows = m.stats.map((s) => `
    <tr class="t${s.team}">
      <td>${escapeHtml(s.name)}${s.bot ? ' (bot)' : ''}</td>
      <td>${s.sent}</td><td>${s.kills}</td><td>${s.dealt}</td><td>${s.spent}</td>
    </tr>`).join('');
  $('#scoretable').innerHTML =
    `<tr><th>Colony</th><th>Ants sent</th><th>Kills</th><th>Damage</th><th>Sugar spent</th></tr>${rows}`;

  $('#again').textContent = driver?.online ? (driver.host ? 'Play again' : 'Waiting for the host') : 'Play again';
  $('#again').disabled = !!(driver?.online && !driver.host);
}

$('#share').onclick = async () => {
  if (!lastResult) return;
  const how = await shareResult($('#result-card'), lastResult);
  toast(how === 'shared' ? 'Sent' : how === 'copied' ? 'Copied, paste it to them' : 'Card saved');
};

$('#again').onclick = () => {
  if (driver?.online) { driver.rematch(); return; }
  if (huds.length > 1) startHotseat(); else startSolo(chosenDifficulty);
};
$('#over-leave').onclick = () => leave();
$('#game-leave').onclick = () => {
  // walking out of a live online match hands your friend the win, so ask once
  const live = driver?.online && !$('#screen-game').classList.contains('hidden');
  if (live && !confirm('Leave the raid? Your colony forfeits if you do not come back.')) return;
  leave();
};

function leave() {
  $('#record-line').textContent = recordLine();
  $('#intro-record').textContent = recordLine();
  driver?.stop?.();
  driver = null;
  huds = [];
  removeEventListener('keydown', onKey);
  sessionStorage.removeItem('antraid.resume');
  history.replaceState(null, '', location.pathname);
  try { setMapTheme('menu'); setIntensity(0); } catch { /* audio off */ }
  show('title');
}

// ---------------------------------------------------------------- boot

setColonyColors(resolveColors([chosenColor, chosenColor === 'frost' ? 'ember' : 'frost']));
paintTitle();
buildMapStrip($('#map-strip'), {
  onPick: (id) => pickMap(id, [$('#map-strip'), $('#lobby-map-strip')]),
});
redrawPacks();
$('#record-line').textContent = recordLine();
$('#intro-record').textContent = recordLine();

loadPublicUrl();
$('#intro-play').onclick = () => enterTitle(false);
$('#intro-code').onclick = () => enterTitle(true);

// Arriving on a shared link, or coming back from a refresh mid-match. Somebody
// who was handed a room code did not come here to read a front screen, so they
// never see one: straight into the room.
const params = new URLSearchParams(location.search);
const resume = (() => { try { return JSON.parse(sessionStorage.getItem('antraid.resume') || 'null'); } catch { return null; } })();
if (params.get('r')) {
  show('title');
  $('#join-code').value = params.get('r').toUpperCase();
  joinRoom(params.get('r').toUpperCase(), resume?.code === params.get('r').toUpperCase() ? resume.pid : undefined);
} else if (resume) {
  show('title');
  joinRoom(resume.code, resume.pid);
} else {
  show('intro');
  startIntro();
}

// QA hook. rAF is frozen in a hidden tab, so anything driving this game from a
// script has to step and paint by hand rather than wait for frames.
window.AR = {
  get driver() { return driver; },
  get sim() { return driver?.sim; },
  get huds() { return huds; },
  /** Burst-step a local match: AR.step(600) runs 20 seconds of simulation now. */
  step(ticks = 30) {
    if (!driver?.sim) return 'no local sim';
    for (let i = 0; i < ticks && !driver.sim.over; i++) {
      driver.sim.step(1 / 30);
      for (const b of driver.brains) b.update(1 / 30);
    }
    if (driver.sim.over) driver.finish();
    return driver.sim.t.toFixed(1);
  },
  /** Paint one frame without a rAF tick. */
  paint(dt = 1 / 60) {
    const view = driver?.view?.();
    draw(view, dt, { aimLane: huds[mouseSeat]?.lane ?? 0, aimTeam: huds[mouseSeat]?.team ?? 0 });
    if (view) { for (const h of huds) h.update(view, h.meIndex); }
    return view && { t: view.t, units: view.units.length, defs: view.defs.length, nest: view.nestHp };
  },
  solo: (d) => startSolo(d || 'normal'),
  hotseat: startHotseat,
  /** The front screen runs on rAF too, so it needs the same hand-crank. */
  get intro() { return intro; },
  introStep(ticks = 30) {
    if (!intro) return 'not on the front screen';
    for (let i = 0; i < ticks && !intro.sim.over; i++) {
      intro.sim.step(DT);
      for (const b of intro.brains) b.update(DT);
    }
    intro.sim.fx.length = 0;
    const snap = intro.sim.snapshot();
    draw(buildView(intro.map, snap, snap, 1), 1 / 30);
    return { map: intro.map.id, t: intro.sim.t.toFixed(1), units: intro.sim.units.length, nest: intro.sim.nestHp };
  },
  /** Post any canvas on the page to the dev shot sink, not just the board. */
  shotOf(sel, name = 'shot') {
    return new Promise((res, rej) => {
      document.querySelector(sel).toBlob((b) => {
        fetch(`/shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: b })
          .then((r) => r.text()).then(res).catch(rej);
      }, 'image/png');
    });
  },
  send: (seat, cmd) => driver?.send(seat, cmd),
  /** Post the board to the dev shot sink so a script can see the real pixels. */
  get result() { return lastResult; },
  share: () => shareText(lastResult),
  shot(name = 'shot') {
    return new Promise((res, rej) => {
      $('#board').toBlob((b) => {
        fetch(`/shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: b })
          .then((r) => r.text()).then(res).catch(rej);
      }, 'image/png');
    });
  },
};

