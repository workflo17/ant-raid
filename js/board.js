// ===== The table: bakes the scenery once, then paints the raid over it =====
// Ant and bug bodies come from Grubs TD unchanged (js/render/ants.js, bugs.js);
// everything a colony owns is tinted toward its side so two identical species on
// opposite teams never read as the same ant. The board itself, its hour and its
// weather all live in scenery.js.

import { TAU, mulberry32 } from '../shared/util.js';
import { INK, mixHex } from './render/helpers.js';
import { drawAnt } from './render/ants.js';
import { drawBugBody, drawSnailShell, drawHpBar } from './render/bugs.js';
import { updateParticles, drawParticles, popFx, explosionFx, burst, burstChunks, ring, textPop } from './particles.js';
import { TUNING, WILDLIFE, FOOD, PHEROMONE } from '../shared/data/board.js';
import { teamTint, colorEpoch } from './colors.js';
import { RAIDERS, DEFENDERS } from '../shared/data/units.js';
import { QUEENS, QUEEN_IDS, POP_WILD } from '../shared/data/heroes.js';
import { EMOTES, EMOTE_SHOW } from '../shared/data/emotes.js';
import {
  themeOf, paintGround, paintProp, paintGrade, paintRoads,
  bakeNestStages, NEST_STAGES,
  paintClouds, paintPools, paintAir, paintVignette,
} from './scenery.js';

let cv, c, dpr = 1, baked = null, bakedFor = null, bakedEpoch = -1, nestArt = null;
let MAP = null, T = null, W = 960, H = 640;
let time = 0;
// screen shake: an impulse that decays, so a nest bite is felt and not just read
let shake = 0, shakeSeed = 0;
let reducedMotion = false;
try { reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* older browser */ }

/** Kick the camera. Ignored entirely when the player asked for less motion. */
export function kick(amount) {
  if (reducedMotion) return;
  shake = Math.min(14, shake + amount);
  shakeSeed = (shakeSeed + 1) % 1000;
}
export let hoverPad = null;   // { team, pad } under the cursor

const tintCache = new Map();
/**
 * A species in colony colours: same ant, unmistakably whose. The colour id is
 * part of the key. Keying on `${species}|${team}` alone was the first version
 * and it pinned every ant to whatever colours the FIRST match happened to use.
 */
export function tinted(def, team) {
  const TT = teamTint(team);
  const key = `${def.color}|${team}|${TT.id}`;
  let t = tintCache.get(key);
  if (!t) {
    t = { ...def, color: mixHex(def.color, TT.mix, TT.mixT), dark: mixHex(def.dark, TT.mix, TT.mixT * 0.8) };
    tintCache.set(key, t);
  }
  return t;
}

// ----------------------------------------------------------------- wear
//
// Where the match has actually been. Two things accumulate onto one offscreen
// layer that sits between the baked ground and everything alive:
//
//   footfall  every ant darkens the ground under itself as it walks, so after
//             four minutes the road a colony committed to is visibly worn and
//             the one it ignored is not
//   debris    a body that pops, a blast, a bite taken out of a nest: each drops
//             something that stays there for the rest of the match
//
// It is a HALF-RESOLUTION canvas on purpose. These are smudges, nobody is going
// to read the edge of one, and a full-size layer meant 960x640 of alpha blending
// every frame for no visible gain.

const WEAR_SCALE = 0.5;
// How fast ground darkens, per second of an ant standing on it. Repeated
// source-over converges on solid, so what matters is the exposure a spot gets
// over a whole match: an ant crossing its own body length takes about 0.3s, and
// a busy road sees a hundred of them. At the first value (0.30/s) that came to
// an accumulated alpha of nine and every used road went pure black by 2:00.
const WEAR_RATE = 0.06;
// and the finished layer is composited at less than full strength, so even a
// completely saturated road stains the ground rather than replacing it
const WEAR_MAX = 0.6;
let wear = null, wearC = null;

function makeWear() {
  wear = document.createElement('canvas');
  wear.width = Math.round(W * WEAR_SCALE);
  wear.height = Math.round(H * WEAR_SCALE);
  wearC = wear.getContext('2d');
  wearC.setTransform(WEAR_SCALE, 0, 0, WEAR_SCALE, 0, 0);
}

/** A new match starts on clean ground. */
export function resetWear() {
  if (!wear || wear.width !== Math.round(W * WEAR_SCALE)) makeWear();
  else wearC.clearRect(0, 0, W, H);
}

/**
 * Footfall. Rate is per SECOND, not per frame, or the ground wears twice as
 * fast on a 120Hz screen as on a 60Hz one and two players watching the same
 * match see different boards.
 */
function stampFootfall(view, dt) {
  if (!wearC || !view.units.length) return;
  wearC.save();
  wearC.globalAlpha = Math.min(0.01, WEAR_RATE * dt);
  wearC.fillStyle = 'rgba(24,14,6,1)';
  for (const u of view.units) {
    wearC.beginPath();
    wearC.ellipse(u.x, u.y + 3, 7, 4.5, 0, 0, TAU);
    wearC.fill();
  }
  wearC.restore();
}

/** Something happened here and the ground is going to remember it. */
function stampDebris(x, y, spread, n, color) {
  if (!wearC) return;
  wearC.save();
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * spread;
    wearC.globalAlpha = 0.18 + Math.random() * 0.3;
    wearC.fillStyle = color;
    const r = 1.1 + Math.random() * 2.3;
    wearC.beginPath();
    wearC.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d, r, r * 0.72, Math.random() * TAU, 0, TAU);
    wearC.fill();
  }
  wearC.restore();
}

/** A blast leaves a scorch as well as pieces. */
function stampScorch(x, y, r) {
  if (!wearC) return;
  wearC.save();
  wearC.globalAlpha = 0.22;
  const g = wearC.createRadialGradient(x, y, 1, x, y, r);
  g.addColorStop(0, 'rgba(20,10,4,0.9)');
  g.addColorStop(1, 'rgba(20,10,4,0)');
  wearC.fillStyle = g;
  wearC.beginPath(); wearC.ellipse(x, y, r, r * 0.78, 0, 0, TAU); wearC.fill();
  wearC.restore();
}

// --------------------------------------------------------------- emotes
// Bubbles over a colony's nest. Never simulation state: they arrive from the
// driver, sit here for a couple of seconds and are gone.

// One slot per COLONY, not a fixed pair: the old `[null, null]` silently
// dropped every emote from colonies 2 to 5 on a ring board.
let bubbles = [];
export function showEmote(team, index, at = -1) {
  const e = EMOTES[index];
  if (!e || !MAP || !MAP.nests[team]) return;
  // A targeted signal is DELIVERED: the bubble lands on the target's nest,
  // tinted in the sender's colour, which in this game is the whole of who they
  // are. "You are next" arriving on your own doorstep in somebody's colours
  // needs no further attribution.
  const target = at >= 0 && at !== team && MAP.nests[at] ? at : -1;
  bubbles[team] = { e, target, until: time + EMOTE_SHOW, born: time };
}
export function clearEmotes() { bubbles = []; backs = {}; }

// ------------------------------------------------ backing, the fallen's verb
// A knocked-out colony plants its pennant on a survivor's nest. Render state
// only, like the emotes: the sim never knows, which is exactly what keeps it
// from being an alliance mechanic. `backs[from] = at`, latest wins.
let backs = {};
export function showBack(from, at) {
  if (!MAP || !MAP.nests[from] || !MAP.nests[at]) return;
  backs[from] = at;
}
/** A local, unwired bubble, for the one hint the fallen get. */
export function showHint(team, text) {
  if (!MAP || !MAP.nests[team]) return;
  bubbles[team] = { e: { text }, target: -1, until: time + EMOTE_SHOW * 1.6, born: time };
}

/** The snare a fallen Weaver leaves: a pale web in its colony's tint. */
function drawSilks(view) {
  if (!view?.silks?.length) return;
  c.save();
  for (const k of view.silks) {
    const T2 = teamTint(k.team);
    c.globalAlpha = 0.5;
    c.strokeStyle = '#f2ead2';
    c.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) {
      c.beginPath(); c.ellipse(k.x, k.y, k.r * (0.4 + i * 0.3), k.r * (0.3 + i * 0.24), 0.3, 0, TAU); c.stroke();
    }
    c.globalAlpha = 0.9;
    c.strokeStyle = T2.ring;
    c.lineWidth = 1;
    c.beginPath(); c.ellipse(k.x, k.y, k.r * 0.55, k.r * 0.42, 0.3, 0, TAU); c.stroke();
  }
  c.restore();
}

// -------------------------------------------- the board's signature element
// Each board owns at most one of these. The tide and the beetles are drawn
// straight off the view clock with the same functions the sim uses, so what
// you see IS what the sim is doing; only the fruit needs telling (who has
// taken what is state, not clockwork).

/** How deep the seep is right now, 0 dry to 1 up, with a short rise and drain. */
function tideLevel(t) {
  const td = MAP.tide;
  const P = td.period;
  const s = t % P;
  const start = P * (1 - td.high);
  if (s >= start) return Math.min(1, (s - start) / 2.2);   // coming in
  if (s < 2.2) return 1 - s / 2.2;                          // draining away
  return 0;
}

function drawTide(view) {
  if (!MAP.tide || !view) return;
  const lvl = tideLevel(view.t);
  if (lvl <= 0.01) return;
  c.save();
  for (const h of MAP.tide.hazards) {
    c.globalAlpha = 0.42 * lvl;
    c.fillStyle = '#6eafcd';
    c.beginPath(); c.ellipse(h.x, h.y, h.r * (0.7 + 0.3 * lvl), h.r * 0.8 * (0.7 + 0.3 * lvl), 0, 0, TAU); c.fill();
    // the waterline, wobbling while the level moves
    c.globalAlpha = 0.5 * lvl;
    c.strokeStyle = '#cfe8f2';
    c.lineWidth = 1.6;
    const wob = 1 + Math.sin(time * 2.4 + h.x) * 0.02;
    c.beginPath(); c.ellipse(h.x, h.y, h.r * (0.7 + 0.3 * lvl) * wob, h.r * 0.8 * (0.7 + 0.3 * lvl), 0, 0, TAU); c.stroke();
  }
  c.restore();
}

function drawCrumbs(view) {
  if (!MAP.drops || !view) return;
  const D = MAP.drops;
  // the shadow of the NEXT one, growing as it comes down
  const k = view.t < D.first ? 0 : Math.floor((view.t - D.first) / D.every) + 1;
  const nd = D.first + k * D.every;
  const left = nd - view.t;
  if (left < 1.6) {
    const grow = 1 - left / 1.6;
    c.save();
    c.globalAlpha = 0.22 * grow;
    c.fillStyle = INK;
    // the pair falls together, so both shadows grow together
    for (const s of D.spots[k % D.spots.length]) {
      c.beginPath(); c.ellipse(s.x, s.y, 6 + 9 * grow, (6 + 9 * grow) * 0.62, 0, 0, TAU); c.fill();
    }
    c.restore();
  }
  for (const cr of view.crumbs) {
    const bob = Math.sin(time * 3 + cr.x) * 0.8;
    c.save();
    c.translate(cr.x, cr.y + bob);
    // a chunk of fallen fruit: flesh, skin, shine
    c.fillStyle = INK;
    c.beginPath(); c.ellipse(0, 0, 10.5, 8.5, 0.3, 0, TAU); c.fill();
    c.fillStyle = '#f2d98c';
    c.beginPath(); c.ellipse(0, 0, 9, 7, 0.3, 0, TAU); c.fill();
    c.fillStyle = '#c9564a';
    c.beginPath(); c.ellipse(-2, -3.5, 6.5, 3.4, 0.5, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.beginPath(); c.ellipse(2.5, -1.5, 2.2, 1.3, 0.4, 0, TAU); c.fill();
    c.restore();
  }
}

function drawProwlers(view) {
  if (!MAP.prowl || !view) return;
  const pair = MAP.prowlAt(view.t);
  for (let i = 0; i < pair.length; i++) {
    const b = pair[i];
    // its reach, faint: the road is priced, the price should be visible
    c.save();
    c.globalAlpha = 0.09;
    c.fillStyle = '#5a2f1c';
    c.beginPath(); c.arc(b.x, b.y, MAP.prowl.r, 0, TAU); c.fill();
    c.restore();
    c.save();
    c.translate(b.x, b.y);
    c.rotate(b.angle);
    drawBugBody(c, {
      type: { color: '#54402a', dark: '#241a10', radius: 13, bodyL: 1.2, bodyW: 1.05 },
      dist: b.d, phase: i * 1.3, radius: 13,
    }, time);
    c.restore();
  }
}

function drawBalm(view) {
  if (!MAP.balm || !view) return;
  c.save();
  for (const pool of MAP.balm.pools) {
    c.globalAlpha = 0.07 + Math.sin(time * 1.8 + pool.x) * 0.025;
    c.fillStyle = '#a8e063';
    c.beginPath(); c.arc(pool.x, pool.y, pool.r, 0, TAU); c.fill();
    // motes drifting up out of the beds, on a loop
    c.fillStyle = '#d9f2a8';
    for (let i = 0; i < 4; i++) {
      const ph = ((time * 0.22 + i * 0.25) % 1);
      const mx = pool.x + Math.sin(i * 2.4 + pool.y) * pool.r * 0.5;
      const my = pool.y + pool.r * 0.45 - ph * pool.r * 0.9;
      c.globalAlpha = 0.5 * Math.sin(ph * Math.PI);
      c.beginPath(); c.arc(mx, my, 1.7, 0, TAU); c.fill();
    }
  }
  c.restore();
}

function drawBacks() {
  const froms = Object.keys(backs);
  for (const f of froms) {
    const from = Number(f);
    const n = MAP.nests[backs[f]];
    if (!n) continue;
    const T = teamTint(from);
    // a little pennant per backer, planted round the nest rim so several can
    // stand together; the colour IS the signature, same rule as everywhere
    const x = n.x - n.r * 0.6 + (from % 3) * 13;
    const y = n.y - n.r - 8 - Math.floor(from / 3) * 16;
    c.save();
    c.strokeStyle = INK; c.lineWidth = 2;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 14); c.stroke();
    c.fillStyle = T.accent;
    c.beginPath(); c.moveTo(x, y - 14); c.lineTo(x + 11, y - 10.5); c.lineTo(x, y - 7); c.closePath(); c.fill();
    c.restore();
  }
}

function drawEmotes() {
  for (let team = 0; team < bubbles.length; team++) {
    const b = bubbles[team];
    if (!b) continue;
    if (time > b.until) { bubbles[team] = null; continue; }
    const n = MAP.nests[b.target >= 0 ? b.target : team];
    const age = time - b.born;
    // a short pop on the way in, then it just sits there
    const grow = age < 0.16 ? 0.55 + (age / 0.16) * 0.45 : 1;
    const fade = Math.min(1, (b.until - time) / 0.4);
    const T = teamTint(team);
    const x = n.x, y = n.y - n.r - 52;
    // text only. The DOM buttons keep their glyphs, where the browser falls
    // back through the whole font stack; canvas does not, and Baloo 2 has no
    // heart or pennant, so half of them came out as a box.
    const label = b.e.text;

    c.save();
    c.globalAlpha = fade;
    c.translate(x, y);
    c.scale(grow, grow);
    c.font = '800 17px "Baloo 2", sans-serif';
    c.textAlign = 'center';
    const w = Math.max(96, c.measureText(label).width + 26);
    c.fillStyle = INK;
    c.beginPath(); c.roundRect(-w / 2 - 3, -19, w + 6, 36, 13); c.fill();
    c.fillStyle = T.ring;
    c.beginPath(); c.roundRect(-w / 2, -16, w, 30, 11); c.fill();
    // the tail, pointing down at whoever said it
    c.fillStyle = INK;
    c.beginPath(); c.moveTo(-9, 13); c.lineTo(0, 26); c.lineTo(9, 13); c.closePath(); c.fill();
    c.fillStyle = T.ring;
    c.beginPath(); c.moveTo(-6, 12); c.lineTo(0, 21); c.lineTo(6, 12); c.closePath(); c.fill();
    c.fillStyle = INK;
    c.fillText(label, 0, 6);
    c.restore();
  }
}

/** Point the renderer at a map. Re-bakes on the next frame. */
export function setMap(map) {
  MAP = map;
  T = themeOf(map);
  W = map.width; H = map.height;
  baked = null;
  // a new board means a new world size, and a camera aimed at the old one
  // would be looking at a spot that may no longer exist
  resetCam();
  return map;
}

export function initBoard(canvas, map) {
  cv = canvas;
  c = cv.getContext('2d');
  if (map) setMap(map);
  resize();
  resetWear();
  clearEmotes();
  // once only. This is called again for every match AND for every board the
  // front screen cycles through, and each call used to stack another listener.
  if (!resizeBound) { addEventListener('resize', resize); resizeBound = true; }
  return cv;
}
let resizeBound = false;

function resize() {
  dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = W * dpr;
  cv.height = H * dpr;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  baked = null;
}

// ------------------------------------------------------------------ camera
//
// A phone fits the whole 3:2 board into a 242px band and everything on it is
// a speck, so touch gets a camera: pinch to zoom, drag to pan, pinch back in
// to see it all. The camera lives HERE because this file owns both halves of
// the contract: draw() applies it and worldFrom() inverts it, so input and
// paint can never disagree about where the world is. At z = 1 every transform
// below is the identity and desktop behaves as it always has.
const cam = { x: 0, y: 0, z: 1 };
const CAM_MAX = 2.75;

function camClamp() {
  cam.z = Math.min(CAM_MAX, Math.max(1, cam.z));
  cam.x = Math.min(W - W / cam.z, Math.max(0, cam.x));
  cam.y = Math.min(H - H / cam.z, Math.max(0, cam.y));
}

export const camZ = () => cam.z;
export function resetCam() { cam.x = 0; cam.y = 0; cam.z = 1; }

/** Zoom by `f` about a screen point (client coords), so what is under the fingers stays under them. */
export function zoomAt(f, clientX, clientY) {
  const r = cv.getBoundingClientRect();
  const wx = cam.x + ((clientX - r.left) / r.width) * (W / cam.z);
  const wy = cam.y + ((clientY - r.top) / r.height) * (H / cam.z);
  cam.z *= f;
  camClamp();
  cam.x = wx - ((clientX - r.left) / r.width) * (W / cam.z);
  cam.y = wy - ((clientY - r.top) / r.height) * (H / cam.z);
  camClamp();
}

/** Pan by a screen-pixel delta, converted to world pixels at the current zoom. */
export function panScreen(dx, dy) {
  const r = cv.getBoundingClientRect();
  cam.x -= (dx / r.width) * (W / cam.z);
  cam.y -= (dy / r.height) * (H / cam.z);
  camClamp();
}

/** Canvas pixel -> world coordinate, for clicks on the board. */
export function worldFrom(ev) {
  const r = cv.getBoundingClientRect();
  return {
    x: cam.x + ((ev.clientX - r.left) / r.width) * (W / cam.z),
    y: cam.y + ((ev.clientY - r.top) / r.height) * (H / cam.z),
  };
}

// ---------------------------------------------------------------- the bake

function bake() {
  const b = document.createElement('canvas');
  b.width = W * dpr; b.height = H * dpr;
  const g = b.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  paintGround(g, MAP, T, W, H);
  paintRoads(g, MAP, T);
  bakeFeatures(g);
  for (const p of MAP.props) paintProp(g, p, T);
  bakePads(g);
  paintGrade(g, MAP, T, W, H);
  // the nests are NOT baked into this: they change as they take damage, so they
  // get their own stack of pre-baked damage stages, blitted live in draw()
  nestArt = bakeNestStages(MAP, T, dpr);

  baked = b;
  bakedFor = MAP.id;
  bakedEpoch = colorEpoch();
}

/** Ground the map's own features so a player can see where they are. */
function bakeFeatures(g) {
  for (const m of MAP.mounds) {
    g.save();
    g.globalAlpha = 0.45;
    const grd = g.createRadialGradient(m.x, m.y - m.r * 0.3, 2, m.x, m.y, m.r * 1.5);
    grd.addColorStop(0, 'rgba(255,240,200,0.5)');
    grd.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(m.x, m.y, m.r * 1.5, 0, TAU); g.fill();
    g.restore();
  }
  // hazards get their look from the prop sitting on them (a puddle, a seep);
  // this is just the edge, so the slowed area is unambiguous
  for (const h of MAP.hazards) {
    g.save();
    g.globalAlpha = 0.4;
    g.strokeStyle = 'rgba(190,230,245,0.7)';
    g.lineWidth = 2;
    g.setLineDash([5, 6]);
    g.beginPath(); g.ellipse(h.x, h.y, h.r * 0.92, h.r * 0.72, 0, 0, TAU); g.stroke();
    g.restore();
  }
}

/** Build pads: a scuffed ring waiting for somebody to stand in it. */
function bakePads(g) {
  for (const team of [0, 1]) {
    for (const p of MAP.pads[team]) {
      g.save();
      g.translate(p.x, p.y);
      g.fillStyle = 'rgba(0,0,0,0.24)';
      g.beginPath(); g.ellipse(0, 4, 24, 15, 0, 0, TAU); g.fill();
      g.setLineDash([7, 6]);
      g.strokeStyle = p.rangeMul > 1 ? 'rgba(255,225,150,0.85)'
        : p.rangeMul < 1 ? 'rgba(130,160,210,0.7)'
        : 'rgba(255,240,215,0.5)';
      g.lineWidth = 2.5;
      g.beginPath(); g.ellipse(0, 2, 21, 13, 0, 0, TAU); g.stroke();
      g.restore();
    }
  }
}

function strokePts(g, pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.stroke();
}

const _a = { x: 0, y: 0, angle: 0, seg: 0 };
function at(path, d) {
  let i = 0;
  while (i < path.segs.length - 1 && d > path.segs[i].start + path.segs[i].len) i++;
  const s = path.segs[i], l = d - s.start;
  _a.x = s.ax + s.dx * l; _a.y = s.ay + s.dy * l; _a.angle = Math.atan2(s.dy, s.dx);
  return _a;
}

// ------------------------------------------------------------------- paint

export function setHoverPad(p) { hoverPad = p; }

export function draw(view, dt, ui) {
  if (!MAP) return;
  // a colour change invalidates the six baked nest damage stages, not just
  // the tint cache, so the whole bake goes with it
  if (!baked || bakedFor !== MAP.id || bakedEpoch !== colorEpoch()) bake();
  time += dt;
  // the camera is one transform: scale by z, slide by the world offset. At
  // z = 1 with the offsets clamped to 0 this is exactly the old line.
  c.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, -cam.x * dpr * cam.z, -cam.y * dpr * cam.z);
  if (shake > 0.05) {
    const a = shakeSeed * 2.3 + time * 47;
    c.translate(Math.sin(a) * shake, Math.cos(a * 1.37) * shake * 0.7);
    shake *= Math.pow(0.0015, dt);   // decays fast enough to feel like an impact
  } else shake = 0;
  c.drawImage(baked, 0, 0, W, H);
  // where the match has been: under the weather, under everything alive
  if (wear) {
    c.save();
    c.globalAlpha = WEAR_MAX;
    c.drawImage(wear, 0, 0, W, H);
    c.restore();
  }

  // weather sits on the ground, under the ants, so they never get lost in it
  paintClouds(c, T, time, W, H);
  paintPools(c, MAP, T, time);
  if (!view) { paintVignette(c, T, W, H); return; }

  drawNestArt(view);
  drawTide(view);
  drawBalm(view);
  drawPheromone(view);
  drawFood(view);
  drawCrumbs(view);
  drawLaneMoods(view);
  drawWalls(view);
  drawWild(view);
  drawProwlers(view);
  drawDefenders(view);
  drawUnits(view);
  drawNests(view);

  stampFootfall(view, dt);
  updateParticles(dt);
  drawParticles(c);
  drawSilks(view);
  drawBacks();
  drawEmotes();

  if (ui?.aimLane != null) drawAim(ui.aimLane, ui.aimTeam ?? 0, view);

  // and the air goes over everything, because it is between you and the board
  paintAir(c, T, time, dt, W, H);
  paintVignette(c, T, W, H);
}

/**
 * Scent trails. Both colonies can have one on the same road, so each hugs its
 * own edge of it: a single blended stroke down the middle would leave you unable
 * to tell whose trail you were looking at, which is the only thing that matters.
 * The beads drift the way that colony walks, so a warm road looks like traffic.
 */
function drawPheromone(view) {
  if (!view.pher) return;
  // every colony's trails, not the first two: on a ring this loop used to stop
  // at two and four colonies raided on invisible scent
  for (let team = 0; team < view.pher.length; team++) {
    for (let l = 0; l < MAP.lanes.length; l++) {
      const v = view.pher[team][l];
      if (v <= 0.01) continue;
      const path = MAP.lanes[l].path;
      const side = team % 2 === 0 ? -1 : 1;
      const dir = team % 2 === 0 ? 1 : -1;
      const T = teamTint(team);
      c.save();
      c.globalAlpha = 0.14 + v * 0.44;
      c.fillStyle = T.ring;
      const step = 15;
      const drift = ((time * 46 * dir) % step + step) % step;
      for (let d = drift; d < path.length; d += step) {
        const p = at(path, d);
        const nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
        const r = 1.5 + v * 2.3;
        c.beginPath();
        c.ellipse(p.x + nx * side * 8.5, p.y + ny * side * 8.5, r, r * 0.66, p.angle, 0, TAU);
        c.fill();
      }
      c.restore();
    }
  }
}

/** A lane that is rallied or being rained on says so, in that colony's colour. */
function drawLaneMoods(view) {
  // same lesson as the trails: rally and rain glows belong to every colony
  for (let team = 0; team < view.rallies.length; team++) {
    for (let l = 0; l < MAP.lanes.length; l++) {
      if (view.rallies[team][l]) {
        c.save();
        c.globalAlpha = 0.16 + Math.sin(time * 8) * 0.05;
        c.strokeStyle = teamTint(team).ring;
        c.lineWidth = 26;
        c.lineCap = 'round'; c.lineJoin = 'round';
        strokePts(c, MAP.lanes[l].points);
        c.restore();
      }
      if (view.rains[team][l]) {
        c.save();
        c.globalAlpha = 0.3;
        c.strokeStyle = '#7fd94a';
        c.lineWidth = 30;
        c.lineCap = 'round'; c.lineJoin = 'round';
        strokePts(c, MAP.lanes[l].points);
        c.globalAlpha = 0.55;
        const path = MAP.lanes[l].path;
        for (let d = 0; d < path.length; d += 13) {
          const p = at(path, d);
          const j = ((d * 7 + time * 300) % 26) - 13;
          c.fillStyle = '#a6ff5e';
          c.fillRect(p.x - 1, p.y + j * 0.5 - 5, 2, 7);
        }
        c.restore();
      }
    }
  }
}

function drawWalls(view) {
  for (const w of view.walls) {
    const frac = w.hp / 650;
    c.save();
    c.translate(w.x, w.y);
    c.fillStyle = 'rgba(43,26,16,0.22)';
    c.beginPath(); c.ellipse(2, 12, 24, 8, 0, 0, TAU); c.fill();
    for (let i = 0; i < 3; i++) {
      const px = (i - 1) * 13, py = i === 1 ? -6 : 0;
      c.fillStyle = i === 1 ? '#9a8b78' : '#8a7a67';
      c.strokeStyle = INK; c.lineWidth = 2.5;
      c.beginPath();
      c.ellipse(px, py, 11, 10, i * 0.4, 0, TAU);
      c.fill(); c.stroke();
    }
    c.restore();
    drawHpBar(c, w.x, w.y - 24, 40, Math.max(0, frac));
  }
}

function drawWild(view) {
  for (const w of view.wild) {
    const def = WILDLIFE.types.find((t) => t.type === w.k);
    const e = {
      type: {
        color: '#8bc34a', dark: '#33691e', radius: def.radius,
        bodyL: w.k === 'caterpillar' ? 1.5 : 1, bodyW: 1.1,
        ...(w.k === 'snail' ? { color: '#c08046', dark: '#6b3f18' } : {}),
        ...(w.k === 'pillbug' ? { color: '#97a1b0', dark: '#3d4552' } : {}),
      },
      dist: w.d, phase: w.id * 0.7, radius: def.radius,
    };
    c.save();
    c.translate(w.x, w.y);
    c.rotate(w.angle);
    drawBugBody(c, e, time);
    if (w.k === 'snail') drawSnailShell(c, e);
    c.restore();
    drawHpBar(c, w.x, w.y - def.radius - 14, 46, w.hp / def.hp);
    // it is nobody's ant, and it is worth money — say so
    c.save();
    c.font = '800 11px "Baloo 2", sans-serif';
    c.textAlign = 'center';
    c.fillStyle = INK;
    c.fillText(`+${def.bounty}`, w.x, w.y - def.radius - 20);
    c.restore();
  }
}

function drawDefenders(view) {
  for (const d of view.defs) {
    const def = DEFENDERS[d.k];
    const showRange = hoverPad && hoverPad.team === d.team && hoverPad.pad === d.pad;
    if (showRange && def.range) {
      c.save();
      c.globalAlpha = 0.16;
      c.fillStyle = teamTint(d.team).ring;
      c.beginPath(); c.arc(d.x, d.y, def.range, 0, TAU); c.fill();
      c.globalAlpha = 0.7;
      c.strokeStyle = teamTint(d.team).accent;
      c.lineWidth = 2;
      c.setLineDash([6, 5]);
      c.beginPath(); c.arc(d.x, d.y, def.range, 0, TAU); c.stroke();
      c.restore();
    }
    teamRing(d.x, d.y, d.team, 15);
    drawAnt(c, def.species, tinted(def, d.team), {
      // along its own road, toward the enemy: `team 0 east, team 1 west` was
      // only a direction on a duelling board
      x: d.x, y: d.y, angle: d.face ?? (d.team === 0 ? 0 : Math.PI),
      scale: def.scale, time, bob: d.id * 1.7, flash: d.atk ? 0.09 : 0,
    });
    drawHpBar(c, d.x, d.y - 30, 34, d.hp / def.hp);
    if (def.income) {
      c.save();
      c.font = '800 12px "Baloo 2", sans-serif';
      c.textAlign = 'center';
      c.fillStyle = '#8a5400';
      c.fillText(`+${def.income}`, d.x, d.y - 34);
      c.restore();
    }
  }
}

function drawUnits(view) {
  // painter's order so ants nearer the viewer overlap the ones behind
  const list = view.units.slice().sort((a, b) => a.y - b.y);
  for (const u of list) {
    if (u.hero) { drawQueen(u); continue; }
    const def = RAIDERS[u.k];
    teamRing(u.x, u.y, u.team, def.radius);
    if (u.flags & 1) { // slowed by silk
      c.save();
      c.globalAlpha = 0.5;
      c.strokeStyle = '#9fe8e4'; c.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        c.beginPath();
        c.arc(u.x, u.y, def.radius + 3 + i * 3, i * 2, i * 2 + 2.4);
        c.stroke();
      }
      c.restore();
    }
    drawAnt(c, def.species, tinted(def, u.team), {
      x: u.x, y: u.y, angle: u.angle,
      scale: def.scale * (u.flags & 2 ? 1.07 : 1),
      time, bob: u.id * 1.3,
      flash: u.flags & 4 ? 0.1 : 0,
    });
    if (u.hp < def.hp) drawHpBar(c, u.x, u.y - def.radius - 14, 26, u.hp / def.hp);
  }
}

/**
 * The queen. She reuses the four `hero` bodies already drawn in render/ants.js,
 * but everything around her is hers alone: a doubled team ring so she is
 * findable in a crowd, a level badge, and a burning halo while Onslaught runs.
 */
function drawQueen(u) {
  const def = QUEENS[u.k];
  const T = teamTint(u.team);

  // a standing halo, so you can pick her out of forty identical ants
  c.save();
  c.globalAlpha = 0.28 + Math.sin(time * 2.4 + u.id) * 0.07;
  c.strokeStyle = T.ring;
  c.lineWidth = 2.5;
  c.setLineDash([5, 5]);
  c.lineDashOffset = -time * 22;
  c.beginPath();
  c.ellipse(u.x, u.y + def.radius * 0.7, def.radius + 9, (def.radius + 9) * 0.42, 0, 0, TAU);
  c.stroke();
  c.restore();

  // Onslaught: she is visibly on fire, because 6 seconds is short enough that
  // you have to be able to see at a glance whether it is still running
  if (u.flags & 8) {
    c.save();
    c.globalAlpha = 0.4 + Math.sin(time * 14) * 0.16;
    c.strokeStyle = '#ffd166';
    c.lineWidth = 4;
    c.beginPath(); c.arc(u.x, u.y, def.radius + 13, 0, TAU); c.stroke();
    c.restore();
  }

  teamRing(u.x, u.y, u.team, def.radius);
  drawAnt(c, 'hero', tinted(def, u.team), {
    x: u.x, y: u.y, angle: u.angle,
    scale: def.scale * (u.flags & 2 ? 1.07 : 1),
    time, bob: u.id * 1.3,
    flash: u.flags & 4 ? 0.1 : 0,
    hero: def.art,
    heroLevel: u.lv,
  });
  drawHpBar(c, u.x, u.y - def.radius - 18, 40, Math.max(0, u.hp / u.maxHp));
}

/**
 * The one mark that says whose ant this is, under every body on the board.
 * Ink outline first, colour inside it: a bare coloured ring disappeared against
 * the tan cloth, and at a glance you could not tell the two colonies apart.
 */
function teamRing(x, y, team, r) {
  const rx = r * 0.95, ry = r * 0.4;
  c.save();
  c.translate(x + 1, y + r * 0.74);
  c.fillStyle = INK;
  c.beginPath(); c.ellipse(0, 0, rx + 1.6, ry + 1.6, 0, 0, TAU); c.fill();
  c.fillStyle = teamTint(team).accent;
  c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, TAU); c.fill();
  c.fillStyle = teamTint(team).ring;
  c.beginPath(); c.ellipse(0, -ry * 0.25, rx * 0.62, ry * 0.42, 0, 0, TAU); c.fill();
  c.restore();
}

function drawNests(view) {
  for (const n of MAP.nests) {
    const hp = Math.max(0, view.nestHp[n.team]);
    const frac = hp / TUNING.nestHp;
    c.save();
    c.translate(n.x, n.y - n.r - 16);
    c.fillStyle = INK;
    c.beginPath(); c.roundRect(-34, -8, 68, 15, 7); c.fill();
    c.fillStyle = teamTint(n.team).accent;
    if (frac > 0) { c.beginPath(); c.roundRect(-31.5, -5.5, 63 * frac, 10, 5); c.fill(); }
    c.font = '800 12px "Baloo 2", sans-serif';
    c.textAlign = 'center';
    c.fillStyle = '#fff3d6';
    c.fillText(String(Math.ceil(hp)), 0, 4);
    c.restore();
  }
}

/**
 * The aphid herd, and the tug over it. Drawn live because the whole point is
 * watching it swing: the ground stain creeps toward whoever is winning it, and
 * the aphids themselves only fatten up while somebody is actually milking them.
 */
function drawFood(view) {
  const f = view.food;
  if (!f) return;
  const held = f.owner >= 0;
  const tint = held ? teamTint(f.owner) : null;

  // ground stain: how far it has been pulled, in whoever is pulling it colour
  const pull = Math.abs(f.hold);
  if (pull > 0.02) {
    const side = f.hold > 0 ? 0 : 1;
    c.save();
    c.globalAlpha = 0.1 + pull * 0.24;
    const grd = c.createRadialGradient(f.x, f.y, 4, f.x, f.y, f.r * (0.4 + pull * 0.6));
    grd.addColorStop(0, teamTint(side).accent);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = grd;
    c.beginPath(); c.ellipse(f.x, f.y, f.r, f.r * 0.78, 0, 0, TAU); c.fill();
    c.restore();
  }

  // the contested ring
  c.save();
  c.globalAlpha = held ? 0.75 : 0.4;
  c.strokeStyle = held ? tint.accent : 'rgba(240,225,190,0.8)';
  c.lineWidth = held ? 3 : 2;
  c.setLineDash([9, 7]);
  c.lineDashOffset = -time * (held ? 26 : 10) * (f.hold >= 0 ? 1 : -1);
  c.beginPath(); c.ellipse(f.x, f.y, f.r, f.r * 0.78, 0, 0, TAU); c.stroke();
  c.restore();

  // the stem and the aphids on it
  c.save();
  c.translate(f.x, f.y);
  c.strokeStyle = '#4a6a2a'; c.lineWidth = 7; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-2, 26); c.quadraticCurveTo(4, 0, -6, -26); c.stroke();
  c.strokeStyle = '#63a832'; c.lineWidth = 4;
  c.beginPath(); c.moveTo(-2, 26); c.quadraticCurveTo(4, 0, -6, -26); c.stroke();
  const fat = 1 + (held ? 0.16 : 0) + Math.sin(time * 2.2) * 0.04;
  const APH = [[-14, 10], [10, 2], [-9, -8], [8, -16], [-16, -20], [2, 18]];
  APH.forEach(([ax, ay], i) => {
    const bob = Math.sin(time * 1.7 + i) * 1.2;
    c.save();
    c.translate(ax, ay + bob);
    c.scale(fat, fat);
    const grd = c.createRadialGradient(-2, -2, 1, 0, 0, 9);
    grd.addColorStop(0, '#c9ea86');
    grd.addColorStop(1, '#6f9c33');
    c.fillStyle = grd; c.strokeStyle = INK; c.lineWidth = 2;
    c.beginPath(); c.ellipse(0, 0, 8, 6.4, 0.3, 0, TAU); c.fill(); c.stroke();
    c.strokeStyle = 'rgba(43,26,16,.7)'; c.lineWidth = 1.4;
    for (const s of [-1, 1]) {
      c.beginPath(); c.moveTo(s * 3, -4); c.lineTo(s * 7, -9); c.stroke();
    }
    // a bead of honeydew, which is the thing worth fighting over
    if (held) {
      c.fillStyle = 'rgba(255,214,120,.9)';
      c.beginPath(); c.arc(-6, 4, 2.2 + Math.sin(time * 3 + i) * 0.5, 0, TAU); c.fill();
    }
    c.restore();
  });
  c.restore();

  // the tug bar, so the swing is legible without counting ants
  const bw = 92, bh = 9, by = f.y - f.r * 0.78 - 20;
  c.save();
  c.fillStyle = INK;
  c.beginPath(); c.roundRect(f.x - bw / 2 - 2, by - 2, bw + 4, bh + 4, 6); c.fill();
  c.fillStyle = 'rgba(230,216,182,.35)';
  c.beginPath(); c.roundRect(f.x - bw / 2, by, bw, bh, 4); c.fill();
  const half = (bw / 2) * Math.abs(f.hold);
  if (half > 1) {
    c.fillStyle = teamTint(f.hold > 0 ? 0 : 1).accent;
    c.beginPath();
    c.roundRect(f.hold > 0 ? f.x : f.x - half, by, half, bh, 4);
    c.fill();
  }
  c.fillStyle = 'rgba(255,243,214,.8)';
  c.fillRect(f.x - 1, by - 2, 2, bh + 4);
  c.font = '800 11px "Baloo 2", sans-serif';
  c.textAlign = 'center';
  c.fillStyle = held ? teamTint(f.owner).accent : 'rgba(255,243,214,.75)';
  c.fillText(held ? `+${Math.round(FOOD.rate)}/s` : 'aphids', f.x, by - 7);
  c.restore();
}

/** Blit whichever damage stage matches each nest's health right now. */
function drawNestArt(view) {
  if (!nestArt) return;
  for (const n of MAP.nests) {
    const frac = Math.max(0, Math.min(1, view.nestHp[n.team] / TUNING.nestHp));
    const stage = Math.min(NEST_STAGES - 1, Math.round((1 - frac) * (NEST_STAGES - 1)));
    const a = nestArt[n.team][stage];
    c.drawImage(a.cv, a.x, a.y, a.w, a.h);
  }
}

/**
 * Where the next thing you buy is going. Aimed at 'trail', that is wherever
 * the colony's scent says: the strongest road, or BOTH branches of a fork,
 * which is the honest answer since sends will take turns down them. No trail
 * yet means nothing to stroke, and the trail chip is already showing why.
 */
function drawAim(lane, team, view) {
  const lanes = lane === 'trail'
    ? (view?.pher?.[team] || []).map((v, l) => [v, l])
      .filter(([v]) => v > PHEROMONE.reinforceCap).map(([, l]) => l)
    : [lane];
  if (!lanes.length || !MAP.lanes[lanes[0]]) return;
  c.save();
  c.globalAlpha = 0.35 + Math.sin(time * 6) * 0.12;
  c.strokeStyle = teamTint(team).accent;
  c.lineWidth = 5;
  c.setLineDash([14, 10]);
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (const l of lanes) {
    // the dashes march the way YOUR ants will walk this road. `team 0
    // forwards, everyone else backwards` was only true in a duel; on a ring a
    // colony walks out forwards on some roads and backwards on others.
    const dir = MAP.laneSideFor ? (MAP.laneSideFor(l, team) || 1) : 1;
    c.lineDashOffset = -time * 40 * dir;
    strokePts(c, MAP.lanes[l].points);
  }
  c.restore();
}

// -------------------------------------------------------------------- fx

const FX = {
  HIT: 0, POP: 1, BLAST: 2, SHOOT: 3, NEST: 4, CAST: 5, BUILD: 6, WALL: 7,
  BOUNTY: 8, CLAIM: 9, LEVEL: 10, ABILITY: 11, QUEEN: 12, MARK: 13, FALL: 14,
};

/** Turn the sim's fx list into particles and sound. Called once per snapshot. */
export function playFx(list, sfx) {
  for (const [kind, x, y, arg] of list) {
    switch (kind) {
      case FX.HIT:
        burst(x, y, '#ffe9a8', 2, 60);
        break;
      case FX.POP: {
        // three cases share this one event: a raider (index into RAIDERS), a
        // queen (a negative type index), and wildlife (the POP_WILD sentinel)
        if (arg === POP_WILD) {
          popFx(x, y, '#8bc34a', 20, true);
          sfx?.pop(22);
        } else if (arg < 0) {
          const q = QUEENS[QUEEN_IDS[-1 - arg]];
          popFx(x, y, q.color, q.radius + 6, true);
          ring(x, y, '#ffd166', 20, 300, 0.55);
          burstChunks(x, y, q.dark, 9);
          textPop(x, y - 34, 'the queen has fallen', '#ffd166', 15);
          kick(4);
          sfx?.boom();
        } else {
          const k = Object.keys(RAIDERS)[arg];
          popFx(x, y, RAIDERS[k].color, RAIDERS[k].radius, false);
          sfx?.pop(RAIDERS[k].radius);
        }
        // whatever it was, it left something on the ground
        stampDebris(x, y, arg === POP_WILD ? 20 : 13, arg < 0 ? 9 : 5, '#2a1a0c');
        break;
      }
      case FX.LEVEL:
        ring(x, y, '#ffd166', 16, 300, 0.45);
        ring(x, y, '#fff3d6', 8, 200, 0.6);
        textPop(x, y - 38, `level ${arg}`, '#ffd166', 19);
        sfx?.upgrade();
        break;
      case FX.ABILITY: {
        const q = QUEENS[QUEEN_IDS[arg]] || QUEENS[QUEEN_IDS[0]];
        ring(x, y, q.color, 22, 520, 0.5);
        ring(x, y, '#fff3d6', 12, 340, 0.35);
        textPop(x, y - 42, q.ability.name, q.color, 18);
        kick(2);
        sfx?.fanfare();
        break;
      }
      case FX.MARK:
        ring(x, y, teamTint(arg)?.ring || '#ffe9a8', 10, 190, 0.3);
        burst(x, y, teamTint(arg)?.accent || '#ffe9a8', 3, 44);
        sfx?.snap();
        break;
      case FX.QUEEN:
        ring(x, y, teamTint(arg)?.ring || '#ffd166', 26, 380, 0.5);
        burst(x, y, '#ffe9a8', 7, 110);
        sfx?.buy();
        break;
      case FX.BLAST:
        explosionFx(x, y, arg);
        stampScorch(x, y, arg * 0.85);
        stampDebris(x, y, arg * 0.7, 7, '#1c1006');
        kick(arg > 40 ? 2.6 : 1.2);
        sfx?.boom();
        break;
      case FX.SHOOT:
        sfx?.shoot();
        break;
      case FX.NEST:
        ring(x, y, '#ffffff', 22, 200, 0.3);
        ring(x, y, '#ff8a52', 34, 340, 0.45);
        burstChunks(x, y, '#8a5a33', 7);
        textPop(x, y - 30, `-${arg}`, '#ffd6c6', 22);
        // the bitten colony gets paid; say so, or the rubber band is invisible
        textPop(x, y - 54, '+sugar', '#ffd166', 15);
        // spoil thrown out of the nest, and it stays thrown out
        stampDebris(x, y, 54, 10, '#6b4a26');
        kick(3 + Math.min(7, arg * 0.3));
        sfx?.leak();
        break;
      case FX.CAST:
        ring(x, y, '#ffe9a8', 30, 420, 0.4);
        sfx?.upgrade();
        break;
      case FX.BUILD:
        burst(x, y, '#ffe9a8', 4, 90);
        sfx?.buy();
        break;
      case FX.WALL:
        burst(x, y, '#9a8b78', 6, 110);
        sfx?.snap();
        break;
      case FX.CLAIM:
        if (arg >= 0) {
          ring(x, y, teamTint(arg).accent, 40, 460, 0.5);
          textPop(x, y - 58, 'aphids taken', teamTint(arg).ring, 15);
          sfx?.fanfare();
        } else {
          textPop(x, y - 58, 'aphids contested', '#ffe9a8', 14);
        }
        break;

      case FX.BOUNTY:
        ring(x, y, '#ffd166', 26, 300, 0.5);
        textPop(x, y - 26, `+${arg}`, '#ffd166', 24);
        sfx?.fanfare();
        break;

      case FX.FALL: {
        // A COLONY IS OUT. The sim has announced this since the free-for-all
        // landed and the client sat through it in silence: kind 14 was not in
        // the switch, so the biggest moment a ring has played nothing at all.
        const T = teamTint(arg);
        explosionFx(x, y, 52);
        ring(x, y, T?.ring || '#ffd166', 46, 600, 0.6);
        ring(x, y, '#ffffff', 24, 380, 0.4);
        burstChunks(x, y, '#6b4a26', 14);
        stampScorch(x, y, 50);
        stampDebris(x, y, 60, 12, '#1c1006');
        textPop(x, y - 64, 'the colony has fallen', T?.ring || '#ffd166', 17);
        kick(8);
        sfx?.boom();
        break;
      }
    }
  }
}
