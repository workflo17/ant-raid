// ===== Scenery: two worlds, four hours, and the things casting shadows =====
//
// Ant Raid happens at ant scale, so a board is either the FOREST FLOOR seen from
// just above the litter, or a CROSS-SECTION of the soil with the tunnels cut
// open. Those two worlds want opposite things from every painter: on the surface
// a road is a trail worn through leaf litter and the light comes from a canopy;
// underground a road is an excavated tunnel and there is no sun at all. `world`
// on each theme is what switches it.
//
// Baked once into an offscreen canvas: ground, roads, nests, props, grade.
// Painted live every frame over the top: drifting shade, air, glow, vignette.

import { TAU, mulberry32 } from '../shared/util.js';
import { INK, mixHex } from './render/helpers.js';
import { teamTint } from './colors.js';

// ---------------------------------------------------------------- the hours

export const THEMES = {
  // ---- surface: down in the leaf litter, sun through a canopy far above ----
  litter: {
    world: 'surface',
    soil: ['#9c7c4c', '#87673c', '#6d5230'],
    litterTint: '#b0894c',
    light: { ang: 0.52, len: 2.9, warm: '#ffe0a8', cool: '#3a2c52', strength: 0.52 },
    shaftFrom: [-90, -130], shafts: 4, shaftWarm: 'rgba(255,220,150,0.17)',
    air: { kind: 'pollen', n: 44, tint: 'rgba(255,240,196,0.85)' },
    canopy: 0.16,
    vignette: 0.3,
    road: { base: 'rgba(34,22,8,0.30)', worn: 'rgba(88,64,32,0.82)', edge: 'rgba(20,13,5,0.5)' },
  },
  gully: {
    world: 'surface',
    soil: ['#8a8470', '#736d59', '#5b5644'],
    litterTint: '#9a9378',
    light: { ang: 2.42, len: 2.5, warm: '#d8ecff', cool: '#111a26', strength: 0.6 },
    shaftFrom: [1060, -150], shafts: 3, shaftWarm: 'rgba(210,236,255,0.2)',
    air: { kind: 'rain', n: 86, tint: 'rgba(206,232,255,0.55)' },
    canopy: 0.22,
    vignette: 0.34,
    road: { base: 'rgba(18,22,12,0.32)', worn: 'rgba(70,66,50,0.85)', edge: 'rgba(12,16,8,0.55)' },
  },

  // ---- underground: a cutaway, lit only by whatever glows down there ----
  galleries: {
    world: 'under',
    soil: ['#4a3220', '#3a2617', '#2a1b0f'],
    strata: ['#5c3f26', '#46301c', '#6a4a2c', '#382413'],
    light: { ang: 1.4, len: 1.1, warm: '#ffc98a', cool: '#0d0805', strength: 0.18 },
    air: { kind: 'motes', n: 34, tint: 'rgba(255,224,170,0.7)' },
    vignette: 0.48,
    road: { base: 'rgba(0,0,0,0.42)', worn: 'rgba(24,15,8,0.9)' },
    tunnel: { wall: '#7a5836', lip: '#a4744a', floor: '#4a3218' },
  },
  deep: {
    world: 'under',
    soil: ['#2b2338', '#211a2c', '#161120'],
    strata: ['#372c48', '#271f36', '#413454', '#1d1729'],
    light: { ang: 1.4, len: 1.0, warm: '#9fffcf', cool: '#05060c', strength: 0 },
    pointLight: true,   // glowing fungus is the only light this far down
    air: { kind: 'spore', n: 30, tint: 'rgba(168,255,206,0.95)' },
    vignette: 0.58,
    road: { base: 'rgba(0,0,0,0.5)', worn: 'rgba(30,24,44,0.92)' },
    tunnel: { wall: '#4c3f63', lip: '#68557f', floor: '#2a2338' },
  },
};

export const themeOf = (map) => THEMES[map.theme] || THEMES.litter;
const isUnder = (T) => T.world === 'under';

const lit = (T, c, amt = 0.22) => mixHex(c, T.light.warm, amt * (T.light.strength + 0.3));
const shade = (T, c, amt = 0.3) => mixHex(c, T.light.cool, amt);

/**
 * An irregular closed shape. Three lobes across 21 points reads as a rounded
 * triangle, which is exactly what the first puddles looked like: geological
 * rather than liquid. Many points and three mismatched frequencies reads as a
 * natural outline instead.
 */
function blob(g, rx, ry, seed, amp = 0.1, points = 40) {
  g.beginPath();
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * TAU;
    const w = 1
      + Math.sin(a * 2.3 + seed) * amp
      + Math.sin(a * 3.7 - seed * 1.7) * amp * 0.6
      + Math.sin(a * 6.1 + seed * 0.4) * amp * 0.3;
    const px = Math.cos(a) * rx * w, py = Math.sin(a) * ry * w;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
}

// ------------------------------------------------------------------ shadows

/** A long soft shadow thrown away from the light, for anything standing up. */
function castShadow(g, x, y, r, height, T) {
  const L = T.light;
  if (T.pointLight || L.strength <= 0.02) return;
  const len = r * L.len * height;
  const dx = Math.cos(L.ang) * len, dy = Math.sin(L.ang) * len * 0.55;
  g.save();
  g.globalAlpha = 0.3 * (L.strength + 0.35);
  g.fillStyle = '#000';
  g.beginPath();
  g.ellipse(x + dx * 0.5, y + dy * 0.5 + r * 0.3,
    r * 0.95 + len * 0.42, r * 0.52, Math.atan2(dy, dx), 0, TAU);
  g.fill();
  g.globalAlpha = 0.15 * (L.strength + 0.35);
  g.beginPath();
  g.ellipse(x + dx * 0.8, y + dy * 0.8 + r * 0.3, r * 0.7 + len * 0.5, r * 0.4, Math.atan2(dy, dx), 0, TAU);
  g.fill();
  g.restore();
}

function contact(g, x, y, r, a = 0.32) {
  g.save();
  g.globalAlpha = a;
  g.fillStyle = '#000';
  g.beginPath(); g.ellipse(x, y + r * 0.34, r * 0.9, r * 0.34, 0, 0, TAU); g.fill();
  g.restore();
}

// ================================================================= THE NEST
//
// A real ant nest seen from above is a heap of excavated grain with a crater
// bitten out of the middle and a dark shaft in it. It is not a disc. The first
// version was a tinted ellipse with a glow and it read as a coin.
//
// The colony's colour lives in the pheromone stain around the entrance and two
// marker grains, never in the soil: soil is soil on both sides of the board.

function drawMound(g, n, T, hp = 1) {
  const rnd = mulberry32(((n.x * 7919 + n.y) | 0) >>> 0);
  const R = n.r * 1.55;
  const TT = teamTint(n.team);
  // `wear` is how wrecked it is: the crater widens, the rim breaks open, spoil
  // gets flung outward and the pheromone ring fades as the colony loses hold
  const wear = 1 - Math.max(0, Math.min(1, hp));

  castShadow(g, n.x, n.y, n.r, 1.1 - wear * 0.5, T);

  // the heap: brightest at the rim where fresh spoil lands, darkening inward
  const base = g.createRadialGradient(n.x - R * 0.2, n.y - R * 0.28, R * 0.1, n.x, n.y, R);
  base.addColorStop(0, lit(T, '#9a7b4e', 0.4));
  base.addColorStop(0.62, lit(T, '#7d6039', 0.2));
  base.addColorStop(1, shade(T, '#4a3520', 0.35));
  g.save();
  g.fillStyle = base;
  g.beginPath();
  // an irregular outline, because nothing an ant builds is a circle
  for (let a = 0; a <= TAU + 0.01; a += 0.22) {
    const wob = 1 + Math.sin(a * 3.1 + n.x) * 0.06 + Math.sin(a * 5.7) * 0.04;
    const px = n.x + Math.cos(a) * R * wob;
    const py = n.y + Math.sin(a) * R * 0.74 * wob;
    if (a === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
  g.restore();

  // grain: a mound IS thousands of carried crumbs, so draw them
  g.save();
  for (let i = 0; i < 420; i++) {
    const a = rnd() * TAU;
    const d = Math.sqrt(rnd()) * R;
    const px = n.x + Math.cos(a) * d, py = n.y + Math.sin(a) * d * 0.74;
    g.globalAlpha = 0.16 + rnd() * 0.3;
    g.fillStyle = rnd() < 0.45 ? lit(T, '#c2a06a', 0.3) : shade(T, '#4c3720', 0.2);
    const s = 0.8 + rnd() * (1.6 + (d / R) * 1.4);
    g.beginPath(); g.ellipse(px, py, s, s * 0.78, rnd() * TAU, 0, TAU); g.fill();
  }
  g.restore();

  // the crater: a raised lip of spoil, then the shaft going down. A battered
  // nest is a wider, rougher hole with the rim caved in.
  const cr = n.r * (0.62 + wear * 0.42);
  g.save();
  g.translate(n.x, n.y + n.r * 0.06);
  const lip = g.createRadialGradient(0, -cr * 0.3, cr * 0.2, 0, 0, cr * 1.25);
  lip.addColorStop(0, 'rgba(0,0,0,0)');
  lip.addColorStop(0.7, lit(T, '#b08d57', 0.25));
  lip.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = lip;
  g.beginPath(); g.ellipse(0, 0, cr * 1.25, cr * 0.95, 0, 0, TAU); g.fill();

  // the shaft, darker toward the middle because it goes down
  const hole = g.createRadialGradient(cr * 0.12, -cr * 0.12, 1, 0, 0, cr);
  hole.addColorStop(0, '#000000');
  hole.addColorStop(0.55, '#140c05');
  hole.addColorStop(1, shade(T, '#3a2814', 0.4));
  g.fillStyle = hole;
  g.beginPath(); g.ellipse(0, 0, cr, cr * 0.66, 0, 0, TAU); g.fill();

  // pheromone stain: this is where the colony colour lives, and it fades as
  // the colony loses its grip on its own doorstep
  g.globalAlpha = 0.5 * (1 - wear * 0.75);
  g.strokeStyle = TT.accent;
  g.lineWidth = 3;
  g.beginPath(); g.ellipse(0, 0, cr * 1.06, cr * 0.72, 0, 0, TAU); g.stroke();
  g.globalAlpha = 0.22 * (1 - wear * 0.75);
  g.lineWidth = 8;
  g.beginPath(); g.ellipse(0, 0, cr * 1.16, cr * 0.8, 0, 0, TAU); g.stroke();
  g.globalAlpha = 1;
  g.restore();

  // cracks radiating out of a nest that is coming apart
  if (wear > 0.25) {
    g.save();
    g.translate(n.x, n.y);
    g.strokeStyle = 'rgba(10,6,2,.7)';
    g.lineCap = 'round';
    for (let i = 0; i < Math.floor(wear * 9); i++) {
      const a = rnd() * TAU;
      g.globalAlpha = 0.3 + wear * 0.45;
      g.lineWidth = 1 + rnd() * 2.6 * wear;
      g.beginPath();
      g.moveTo(Math.cos(a) * cr * 0.9, Math.sin(a) * cr * 0.6);
      let x = Math.cos(a) * cr, y = Math.sin(a) * cr * 0.7;
      for (let k = 0; k < 3; k++) {
        x += Math.cos(a + (rnd() - 0.5)) * R * 0.2;
        y += Math.sin(a + (rnd() - 0.5)) * R * 0.16;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    g.restore();
  }

  // thatch: chaff and needle bits the workers hauled up and dumped
  g.save();
  for (let i = 0; i < 26; i++) {
    const a = rnd() * TAU, d = (0.55 + rnd() * 0.5) * R;
    g.save();
    g.translate(n.x + Math.cos(a) * d, n.y + Math.sin(a) * d * 0.74);
    g.rotate(rnd() * TAU);
    g.globalAlpha = 0.4 + rnd() * 0.35;
    g.strokeStyle = shade(T, '#6a5028', 0.15);
    g.lineWidth = 1.3 + rnd();
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(-4 - rnd() * 5, 0); g.lineTo(4 + rnd() * 5, 0); g.stroke();
    g.restore();
  }
  // two marker grains in the colony's colour, so a glance reads whose it is.
  // A wrecked nest keeps only one, knocked over.
  for (const side of [-1, 1]) {
    if (side > 0 && wear > 0.6) continue;
    g.fillStyle = TT.accent;
    g.strokeStyle = INK; g.lineWidth = 2;
    g.beginPath();
    g.ellipse(n.x + side * R * 0.72, n.y - R * 0.36, 5.5, 4.2, side * 0.4 + wear, 0, TAU);
    g.fill(); g.stroke();
  }
  // spoil flung well clear of the mound by whatever has been biting it
  if (wear > 0.15) {
    for (let i = 0; i < Math.floor(wear * 60); i++) {
      const a = rnd() * TAU, d = R * (1.05 + rnd() * 0.7 * wear);
      g.globalAlpha = 0.25 + rnd() * 0.4;
      g.fillStyle = rnd() < 0.5 ? shade(T, '#4c3720', 0.2) : lit(T, '#c2a06a', 0.2);
      const sz = 1 + rnd() * 2.6;
      g.beginPath();
      g.ellipse(n.x + Math.cos(a) * d, n.y + Math.sin(a) * d * 0.74, sz, sz * 0.8, rnd() * TAU, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  g.restore();
}

/** Underground the nest is a chamber cut out of the soil, with brood in it. */
function drawChamber(g, n, T, hp = 1) {
  const rnd = mulberry32(((n.x * 104729 + n.y) | 0) >>> 0);
  const R = n.r * 1.5;
  const TT = teamTint(n.team);
  const wear = 1 - Math.max(0, Math.min(1, hp));

  g.save();
  g.translate(n.x, n.y);

  // packed soil lip around the void
  g.fillStyle = T.tunnel.lip;
  g.beginPath();
  for (let a = 0; a <= TAU + 0.01; a += 0.2) {
    const wob = 1 + Math.sin(a * 2.7 + n.y) * 0.09 + Math.sin(a * 6.1) * 0.05;
    const px = Math.cos(a) * (R + 8) * wob, py = Math.sin(a) * (R + 8) * 0.82 * wob;
    if (a === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath(); g.fill();

  const hollow = g.createRadialGradient(-R * 0.2, -R * 0.25, R * 0.1, 0, 0, R);
  hollow.addColorStop(0, mixHex(T.tunnel.floor, '#ffffff', 0.1));
  hollow.addColorStop(1, '#000000');
  g.fillStyle = hollow;
  g.beginPath(); g.ellipse(0, 0, R, R * 0.82, 0, 0, TAU); g.fill();

  // brood: the pale ovals that make a chamber unmistakably a nest. A raided
  // chamber has fewer of them left, which is the whole horror of the thing.
  const broodLeft = Math.max(2, Math.round(22 * (1 - wear * 0.85)));
  for (let i = 0; i < broodLeft; i++) {
    const a = rnd() * TAU, d = Math.sqrt(rnd()) * R * 0.66;
    g.save();
    g.translate(Math.cos(a) * d, Math.sin(a) * d * 0.8);
    g.rotate(rnd() * TAU);
    g.globalAlpha = 0.62 + rnd() * 0.3;
    const grd = g.createLinearGradient(-5, -3, 5, 3);
    grd.addColorStop(0, '#f4ead0');
    grd.addColorStop(1, '#c9b48c');
    g.fillStyle = grd;
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1;
    g.beginPath(); g.ellipse(0, 0, 5.5 + rnd() * 2.5, 3.4 + rnd() * 1.4, 0, 0, TAU);
    g.fill(); g.stroke();
    g.restore();
  }

  // the colony's colour glows out of its own chamber
  g.globalCompositeOperation = 'lighter';
  const glow = g.createRadialGradient(0, 0, 2, 0, 0, R * 1.1);
  glow.addColorStop(0, TT.accent);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = 0.3 * (1 - wear * 0.7);
  g.fillStyle = glow;
  g.beginPath(); g.ellipse(0, 0, R * 1.1, R * 0.9, 0, 0, TAU); g.fill();
  g.restore();

  // the roof coming in: rubble piling up inside a chamber that is being dug out
  if (wear > 0.2) {
    g.save();
    g.translate(n.x, n.y);
    for (let i = 0; i < Math.floor(wear * 26); i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * R * 0.9;
      g.globalAlpha = 0.35 + rnd() * 0.4;
      g.fillStyle = shade(T, '#6b5334', 0.2);
      const sz = 2 + rnd() * 5;
      g.beginPath();
      g.ellipse(Math.cos(a) * d, Math.sin(a) * d * 0.8, sz, sz * 0.78, rnd() * TAU, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  // roots hanging into it, because it is a hole in the ground
  g.save();
  g.strokeStyle = shade(T, '#6a4a2a', 0.2);
  g.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const x0 = n.x - R + rnd() * R * 2;
    g.globalAlpha = 0.5;
    g.lineWidth = 1 + rnd() * 2;
    g.beginPath();
    g.moveTo(x0, n.y - R * 0.85);
    g.quadraticCurveTo(x0 + (rnd() - 0.5) * 20, n.y - R * 0.3, x0 + (rnd() - 0.5) * 34, n.y + rnd() * R * 0.4);
    g.stroke();
  }
  g.restore();
}

export function paintNest(g, n, T, hp = 1) {
  if (isUnder(T)) drawChamber(g, n, T, hp);
  else drawMound(g, n, T, hp);
}

/**
 * Nest art is expensive (hundreds of individual grains), so it cannot be drawn
 * fresh every frame, but it has to change as the nest takes damage. Bake a few
 * stages up front and blit whichever one matches the current health.
 */
export const NEST_STAGES = 6;

export function bakeNestStages(map, T, dpr = 1) {
  const pad = 90;
  return map.nests.map((n) => {
    const w = (n.r * 2 + pad * 2), h = (n.r * 2 + pad * 2);
    return Array.from({ length: NEST_STAGES }, (_, i) => {
      const cv = document.createElement('canvas');
      cv.width = w * dpr; cv.height = h * dpr;
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.translate(pad + n.r - n.x, pad + n.r - n.y);
      paintNest(g, n, T, 1 - i / (NEST_STAGES - 1));
      return { cv, x: n.x - n.r - pad, y: n.y - n.r - pad, w, h };
    });
  });
}

// =================================================================== ROADS

const _a = { x: 0, y: 0, angle: 0, seg: 0 };
function at(path, d) {
  let i = 0;
  while (i < path.segs.length - 1 && d > path.segs[i].start + path.segs[i].len) i++;
  const s = path.segs[i], l = d - s.start;
  _a.x = s.ax + s.dx * l; _a.y = s.ay + s.dy * l; _a.angle = Math.atan2(s.dy, s.dx);
  return _a;
}

/** Surface: a trail worn bare through the litter. Under: an excavated tunnel. */
export function paintRoads(g, map, T) {
  const rnd = mulberry32(1234 + map.id.length * 31);
  g.lineCap = 'round'; g.lineJoin = 'round';

  for (const lane of map.lanes) {
    const pts = lane.points;
    const stroke = (w, style) => {
      g.strokeStyle = style; g.lineWidth = w;
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.stroke();
    };

    if (isUnder(T)) {
      stroke(38, T.tunnel.lip);
      stroke(30, T.tunnel.wall);
      stroke(24, T.road.base);
      stroke(20, T.tunnel.floor);
      // scallops along the wall, from mandibles taking bites out of it
      for (let d = 6; d < lane.path.length; d += 11) {
        const p = at(lane.path, d);
        const nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
        for (const s of [-1, 1]) {
          g.globalAlpha = 0.16 + rnd() * 0.2;
          g.fillStyle = s > 0 ? '#000' : mixHex(T.tunnel.wall, '#ffffff', 0.25);
          g.beginPath();
          g.arc(p.x + nx * s * 11, p.y + ny * s * 11, 2.4 + rnd() * 2.6, 0, TAU);
          g.fill();
        }
      }
      g.globalAlpha = 1;
    } else {
      stroke(36, T.road.base);
      if (T.road.edge) stroke(27, T.road.edge);
      stroke(23, T.road.worn);
      for (let d = 8; d < lane.path.length; d += 7) {
        const p = at(lane.path, d);
        const j = (rnd() - 0.5) * 17;
        g.globalAlpha = 0.1 + rnd() * 0.2;
        g.fillStyle = rnd() < 0.5 ? '#2a1c0c' : mixHex(T.litterTint, '#ffffff', 0.3);
        g.beginPath();
        g.arc(p.x - Math.sin(p.angle) * j, p.y + Math.cos(p.angle) * j, 0.8 + rnd() * 1.8, 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
    }
  }
}

// =================================================================== PROPS

const PROPS = {
  // ---- forest floor ----
  leaf(g, p, T) {
    g.save(); g.translate(p.x, p.y); g.rotate(p.a || 0);
    contact(g, 0, 0, p.r * 0.8, 0.26);
    const grd = g.createLinearGradient(-p.r, -p.r * 0.4, p.r, p.r * 0.4);
    grd.addColorStop(0, lit(T, p.dead ? '#b98a44' : '#7fae42', 0.35));
    grd.addColorStop(1, shade(T, p.dead ? '#7a5320' : '#3d6a1f', 0.35));
    g.fillStyle = grd; g.strokeStyle = 'rgba(28,18,8,.75)'; g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(-p.r, 0);
    g.bezierCurveTo(-p.r * 0.4, -p.r * 0.72, p.r * 0.4, -p.r * 0.66, p.r, 0);
    g.bezierCurveTo(p.r * 0.4, p.r * 0.66, -p.r * 0.4, p.r * 0.72, -p.r, 0);
    g.fill(); g.stroke();
    g.strokeStyle = 'rgba(28,18,8,.4)'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(-p.r * 0.92, 0); g.lineTo(p.r * 0.92, 0); g.stroke();
    for (let i = -3; i <= 3; i++) {
      g.globalAlpha = 0.35;
      g.beginPath();
      g.moveTo(i * p.r * 0.24, 0);
      g.lineTo(i * p.r * 0.24 + p.r * 0.18, (i % 2 ? 1 : -1) * p.r * 0.34);
      g.stroke();
    }
    g.restore();
  },
  needle(g, p, T) {
    g.save(); g.translate(p.x, p.y); g.rotate(p.a || 0);
    g.strokeStyle = shade(T, '#8a6a34', 0.2);
    g.lineWidth = 3; g.lineCap = 'round';
    g.globalAlpha = 0.85;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(-p.r, s * 1.5);
      g.quadraticCurveTo(0, s * 4, p.r, s * 3);
      g.stroke();
    }
    g.restore();
  },
  twig(g, p, T) {
    castShadow(g, p.x, p.y, p.r * 0.4, 1.4, T);
    g.save(); g.translate(p.x, p.y); g.rotate(p.a || 0);
    const grd = g.createLinearGradient(0, -6, 0, 6);
    grd.addColorStop(0, lit(T, '#8a6a42', 0.35));
    grd.addColorStop(1, shade(T, '#3e2c17', 0.3));
    g.fillStyle = grd; g.strokeStyle = INK; g.lineWidth = 2.5;
    g.beginPath(); g.roundRect(-p.r, -6, p.r * 2, 12, 6); g.fill(); g.stroke();
    g.beginPath(); g.roundRect(p.r * 0.1, -14, p.r * 0.7, 9, 4.5); g.fill(); g.stroke();
    g.restore();
  },
  moss(g, p) {
    const rnd = mulberry32(((p.x * 31 + p.y * 17) | 0) >>> 0);
    g.save(); g.translate(p.x, p.y);
    for (let i = 0; i < 90; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * p.r;
      const x = Math.cos(a) * d, y = Math.sin(a) * d * 0.7;
      g.strokeStyle = `rgba(${70 + rnd() * 50 | 0},${120 + rnd() * 70 | 0},${50 + rnd() * 40 | 0},.8)`;
      g.lineWidth = 1.4 + rnd();
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rnd() - 0.5) * 5, y - 4 - rnd() * 7);
      g.stroke();
    }
    g.restore();
  },
  acorn(g, p, T) {
    castShadow(g, p.x, p.y, p.r, 1.5, T);
    g.save(); g.translate(p.x, p.y); g.rotate(p.a || 0);
    const grd = g.createRadialGradient(-p.r * 0.3, -p.r * 0.4, p.r * 0.1, 0, 0, p.r * 1.3);
    grd.addColorStop(0, lit(T, '#c68a44', 0.4));
    grd.addColorStop(1, shade(T, '#6d3f16', 0.3));
    g.fillStyle = grd; g.strokeStyle = INK; g.lineWidth = 3;
    g.beginPath(); g.ellipse(0, p.r * 0.15, p.r * 0.72, p.r, 0, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = shade(T, '#5a3a18', 0.2);
    g.beginPath(); g.ellipse(0, -p.r * 0.58, p.r * 0.78, p.r * 0.42, 0, 0, TAU); g.fill(); g.stroke();
    g.restore();
  },
  toadstool(g, p, T) {
    castShadow(g, p.x, p.y, p.r, 1.8, T);
    g.save(); g.translate(p.x, p.y);
    g.fillStyle = lit(T, '#efe6d2', 0.2); g.strokeStyle = INK; g.lineWidth = 3;
    g.beginPath(); g.roundRect(-p.r * 0.2, -p.r * 0.1, p.r * 0.4, p.r * 0.95, 5); g.fill(); g.stroke();
    const grd = g.createLinearGradient(-p.r, -p.r, p.r, 0);
    grd.addColorStop(0, lit(T, '#d8622f', 0.4)); grd.addColorStop(1, shade(T, '#8a2a12', 0.3));
    g.fillStyle = grd;
    g.beginPath(); g.ellipse(0, -p.r * 0.15, p.r, p.r * 0.6, 0, Math.PI, TAU); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,248,230,.85)';
    for (const [dx, dy, s] of [[-0.42, -0.36, 0.15], [0.2, -0.48, 0.11], [0.5, -0.24, 0.09]]) {
      g.beginPath(); g.ellipse(p.r * dx, -p.r * 0.15 + p.r * dy, p.r * s, p.r * s * 0.7, 0, 0, TAU); g.fill();
    }
    g.restore();
  },
  stone(g, p, T) {
    // One fixed six-point outline made every stone the same grey hexagon and they
    // read as UI shapes. Seeded per position, so no two are alike.
    const rnd = mulberry32(((p.x * 8191 + p.y * 131) | 0) >>> 0);
    castShadow(g, p.x, p.y, p.r, 1.3, T);
    g.save(); g.translate(p.x, p.y); g.rotate(rnd() * TAU);
    const n = 8 + Math.floor(rnd() * 4);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const rr = p.r * (0.72 + rnd() * 0.34);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr * (0.74 + rnd() * 0.14)]);
    }
    const tint = ['#a8a49a', '#9c968b', '#b0a89c', '#8e8a82'][Math.floor(rnd() * 4)];
    const grd = g.createRadialGradient(-p.r * 0.4, -p.r * 0.5, p.r * 0.1, 0, 0, p.r * 1.25);
    grd.addColorStop(0, lit(T, tint, 0.4));
    grd.addColorStop(1, shade(T, '#48443c', 0.4));
    g.fillStyle = grd; g.strokeStyle = INK; g.lineWidth = 3; g.lineJoin = 'round';
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath(); g.fill(); g.stroke();
    // a chipped facet catching the light, so it reads as rock and not a plate
    g.globalAlpha = 0.26; g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    g.lineTo(pts[1][0], pts[1][1]);
    g.lineTo(pts[2][0] * 0.35, pts[2][1] * 0.35);
    g.closePath(); g.fill();
    g.restore();
  },
  puddle(g, p, T) {
    const rnd = mulberry32(((p.x * 977 + p.y * 13) | 0) >>> 0);
    g.save(); g.translate(p.x, p.y);
    // a damp margin, so the water sits IN the ground rather than on top of it
    g.globalAlpha = 0.5;
    g.fillStyle = 'rgba(24,20,10,.8)';
    blob(g, p.r * 1.1, p.r * 0.78, p.x * 0.01, 0.12); g.fill();
    g.globalAlpha = 1;

    // shallow at the rim, dark in the middle, which is how a puddle reads
    const grd = g.createRadialGradient(0, -p.r * 0.24, p.r * 0.08, 0, 0, p.r);
    grd.addColorStop(0, '#3c5364');
    grd.addColorStop(0.62, '#293c49');
    grd.addColorStop(1, '#1d2a31');
    g.fillStyle = grd;
    blob(g, p.r, p.r * 0.68, p.x * 0.01, 0.1); g.fill();
    g.strokeStyle = 'rgba(10,16,12,.5)'; g.lineWidth = 2; g.stroke();

    // it holds the sky in broken pieces, which is what sells it as water
    g.globalAlpha = 0.4; g.fillStyle = T.light.warm;
    for (let i = 0; i < 4; i++) {
      const a = rnd() * TAU, d = rnd() * p.r * 0.6;
      g.beginPath();
      g.ellipse(Math.cos(a) * d, Math.sin(a) * d * 0.6,
        p.r * (0.1 + rnd() * 0.2), p.r * 0.035, rnd() * 0.6 - 0.3, 0, TAU);
      g.fill();
    }
    g.restore();
  },
  dew(g, p) {
    const rnd = mulberry32(((p.x * 13 + p.y * 7) | 0) >>> 0);
    g.save(); g.translate(p.x, p.y);
    for (let i = 0; i < 10; i++) {
      const a = rnd() * TAU, d = rnd() * p.r;
      const x = Math.cos(a) * d, y = Math.sin(a) * d * 0.7, s = 1.6 + rnd() * 3;
      g.fillStyle = 'rgba(220,242,255,.5)';
      g.beginPath(); g.arc(x, y, s, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.beginPath(); g.arc(x - s * 0.3, y - s * 0.35, s * 0.32, 0, TAU); g.fill();
    }
    g.restore();
  },

  // ---- underground ----
  root(g, p, T) {
    g.save(); g.translate(p.x, p.y); g.rotate(p.a || 0);
    g.strokeStyle = shade(T, '#7a5230', 0.15);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const draw = (len, w, spread, depth) => {
      if (depth > 2 || w < 0.8) return;
      g.lineWidth = w;
      g.beginPath(); g.moveTo(0, 0);
      g.quadraticCurveTo(len * 0.5, spread * 8, len, spread * 16);
      g.stroke();
      g.save(); g.translate(len, spread * 16); g.rotate(spread * 0.5);
      draw(len * 0.66, w * 0.6, -spread, depth + 1);
      g.restore();
    };
    for (const s of [-1, 1]) { g.save(); draw(p.r, 5, s, 0); g.restore(); }
    g.restore();
  },
  seep(g, p) {
    const rnd = mulberry32(((p.x * 331 + p.y * 7) | 0) >>> 0);
    g.save(); g.translate(p.x, p.y);
    // wet clay staining outward from wherever the water comes through
    g.globalAlpha = 0.55; g.fillStyle = 'rgba(20,26,26,.85)';
    blob(g, p.r * 1.15, p.r * 0.85, p.y * 0.01, 0.14); g.fill();
    g.globalAlpha = 1;
    const grd = g.createRadialGradient(0, -p.r * 0.2, p.r * 0.08, 0, 0, p.r);
    grd.addColorStop(0, 'rgba(96,142,158,.85)');
    grd.addColorStop(0.7, 'rgba(38,70,86,.75)');
    grd.addColorStop(1, 'rgba(18,34,42,.55)');
    g.fillStyle = grd;
    blob(g, p.r, p.r * 0.72, p.y * 0.01, 0.11); g.fill();
    g.globalAlpha = 0.3; g.strokeStyle = '#b8e2f0'; g.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      blob(g, p.r * (0.5 + i * 0.2), p.r * (0.36 + i * 0.14), p.y * 0.01 + i, 0.08, 26);
      g.stroke();
    }
    g.globalAlpha = 1;
    // drips off the roof of the gallery into it
    g.strokeStyle = 'rgba(184,226,240,.5)'; g.lineWidth = 1.6; g.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const x = (rnd() - 0.5) * p.r * 1.2;
      g.beginPath(); g.moveTo(x, -p.r * (0.9 + rnd() * 0.5)); g.lineTo(x, -p.r * 0.6); g.stroke();
    }
    g.restore();
  },
  fungus(g, p) {
    const rnd = mulberry32(((p.x * 5 + p.y * 3) | 0) >>> 0);
    g.save(); g.translate(p.x, p.y);
    // the stalks; the glow is painted live so it can breathe
    for (let i = 0; i < 9; i++) {
      const a = rnd() * TAU, d = rnd() * p.r * 0.45;
      const x = Math.cos(a) * d, y = Math.sin(a) * d * 0.6;
      const h = 8 + rnd() * 14;
      const tx = x + (rnd() - 0.5) * 6;
      g.strokeStyle = 'rgba(150,200,170,.65)'; g.lineWidth = 2; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y); g.lineTo(tx, y - h); g.stroke();
      g.fillStyle = '#cfffe0';
      g.beginPath(); g.ellipse(tx, y - h, 4 + rnd() * 3, 3 + rnd() * 2, 0, 0, TAU); g.fill();
    }
    g.restore();
  },
  grub(g, p) {
    g.save(); g.translate(p.x, p.y); g.rotate(p.a || 0);
    const grd = g.createLinearGradient(-p.r, -p.r * 0.4, p.r, p.r * 0.4);
    grd.addColorStop(0, '#f2e6c8'); grd.addColorStop(1, '#c4ab7e');
    g.fillStyle = grd; g.strokeStyle = 'rgba(40,28,12,.6)'; g.lineWidth = 2;
    g.beginPath(); g.ellipse(0, 0, p.r, p.r * 0.56, 0, 0, TAU); g.fill(); g.stroke();
    g.globalAlpha = 0.5;
    for (let i = -2; i <= 2; i++) {
      g.beginPath();
      g.ellipse(i * p.r * 0.3, 0, p.r * 0.06, p.r * 0.48, 0, 0, TAU);
      g.stroke();
    }
    g.restore();
  },
  pebblewall(g, p, T) {
    const rnd = mulberry32(((p.x * 61 + p.y * 11) | 0) >>> 0);
    g.save(); g.translate(p.x, p.y);
    for (let i = 0; i < 9; i++) {
      const x = (rnd() - 0.5) * p.r * 1.7, y = (rnd() - 0.5) * p.r;
      const s = 5 + rnd() * 9;
      g.fillStyle = shade(T, '#8d8378', 0.25 + rnd() * 0.2);
      g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 2;
      g.beginPath(); g.ellipse(x, y, s, s * 0.8, rnd() * TAU, 0, TAU); g.fill(); g.stroke();
    }
    g.restore();
  },
};

export function paintProp(g, p, T) {
  const fn = PROPS[p.kind];
  if (fn) fn(g, p, T);
}

// ================================================================== GROUND

export function paintGround(g, map, T, W, H) {
  const rnd = mulberry32(9001 + map.id.length * 77);
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, T.soil[0]); sky.addColorStop(0.55, T.soil[1]); sky.addColorStop(1, T.soil[2]);
  g.fillStyle = sky; g.fillRect(0, 0, W, H);

  if (isUnder(T)) {
    // strata: wavy horizontal bands, because soil is layered and it sells the cut
    let y = -20, i = 0;
    while (y < H + 40) {
      const h = 40 + rnd() * 70;
      g.globalAlpha = 0.3 + rnd() * 0.25;
      g.fillStyle = T.strata[i % T.strata.length];
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= W; x += 40) g.lineTo(x, y + Math.sin(x * 0.011 + i * 1.7) * 9);
      g.lineTo(W, y + h);
      for (let x = W; x >= 0; x -= 40) g.lineTo(x, y + h + Math.sin(x * 0.009 + i * 2.3) * 8);
      g.closePath(); g.fill();
      y += h; i++;
    }
    g.globalAlpha = 1;

    for (let k = 0; k < 1500; k++) {
      g.globalAlpha = 0.06 + rnd() * 0.16;
      g.fillStyle = rnd() < 0.45 ? '#000' : '#c8b08a';
      const s = rnd() * 2.2 + 0.4;
      g.beginPath(); g.ellipse(rnd() * W, rnd() * H, s, s * 0.8, rnd() * TAU, 0, TAU); g.fill();
    }
    g.globalAlpha = 1;

    // hair roots threading through the earth
    g.strokeStyle = 'rgba(120,86,48,.35)';
    for (let k = 0; k < 60; k++) {
      const x0 = rnd() * W, y0 = rnd() * H;
      g.globalAlpha = 0.2 + rnd() * 0.3;
      g.lineWidth = 0.6 + rnd() * 1.4;
      g.beginPath(); g.moveTo(x0, y0);
      g.bezierCurveTo(x0 + 30, y0 + 20, x0 + 50, y0 - 30, x0 + 90 * (rnd() - 0.3), y0 + 60 * (rnd() - 0.5));
      g.stroke();
    }
    g.globalAlpha = 1;
    return;
  }

  // ---- surface: damp earth under a scatter of litter ----
  for (let k = 0; k < 420; k++) {
    g.globalAlpha = 0.1 + rnd() * 0.2;
    g.fillStyle = rnd() < 0.5 ? '#2a1d0e' : mixHex(T.soil[0], '#ffffff', 0.25);
    const s = 4 + rnd() * 16;
    g.beginPath(); g.ellipse(rnd() * W, rnd() * H, s, s * 0.62, rnd() * TAU, 0, TAU); g.fill();
  }
  g.globalAlpha = 1;

  // the litter: hundreds of small fragments, the floor of a wood
  for (let k = 0; k < 260; k++) {
    g.save();
    g.translate(rnd() * W, rnd() * H);
    g.rotate(rnd() * TAU);
    g.globalAlpha = 0.25 + rnd() * 0.45;
    const kind = rnd();
    if (kind < 0.45) {
      g.strokeStyle = mixHex(T.litterTint, rnd() < 0.5 ? '#000000' : '#ffffff', rnd() * 0.4);
      g.lineWidth = 1.4 + rnd() * 1.6;
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(-6 - rnd() * 10, 0); g.lineTo(6 + rnd() * 10, rnd() * 3); g.stroke();
    } else if (kind < 0.8) {
      g.fillStyle = mixHex(T.litterTint, '#ffffff', rnd() * 0.35);
      const s = 3 + rnd() * 7;
      g.beginPath();
      g.moveTo(-s, 0); g.quadraticCurveTo(0, -s * 0.7, s, 0); g.quadraticCurveTo(0, s * 0.7, -s, 0);
      g.fill();
    } else {
      g.fillStyle = 'rgba(30,22,10,.5)';
      g.beginPath(); g.arc(0, 0, 1 + rnd() * 2.4, 0, TAU); g.fill();
    }
    g.restore();
  }
  g.globalAlpha = 1;
}

// =================================================================== GRADE

export function paintGrade(g, map, T, W, H) {
  const L = T.light;

  if (T.shafts) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.filter = 'blur(24px)';
    const [sx, sy] = T.shaftFrom;
    for (let i = 0; i < T.shafts; i++) {
      const a = Math.atan2(H * 0.7 - sy, W * (0.25 + i * 0.2) - sx);
      g.save();
      g.translate(sx, sy); g.rotate(a);
      const grd = g.createLinearGradient(0, 0, 1500, 0);
      grd.addColorStop(0, T.shaftWarm);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(0, -6); g.lineTo(1500, -54 - i * 22); g.lineTo(1500, 54 + i * 22); g.lineTo(0, 6);
      g.fill();
      g.restore();
    }
    g.filter = 'none';
    g.restore();
  }

  g.save();
  g.globalCompositeOperation = 'multiply';
  const cool = g.createLinearGradient(W, H, 0, 0);
  cool.addColorStop(0, mixHex(L.cool, '#ffffff', 1 - 0.44 * (0.5 + L.strength * 0.5)));
  cool.addColorStop(1, '#ffffff');
  g.globalAlpha = 0.85;
  g.fillStyle = cool;
  g.fillRect(0, 0, W, H);
  g.restore();

  if (L.strength > 0.02) {
    g.save();
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = 0.3 * L.strength;
    const warm = g.createLinearGradient(0, 0, W * 0.9, H);
    warm.addColorStop(0, L.warm);
    warm.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = warm;
    g.fillRect(0, 0, W, H);
    g.restore();
  }
}

// ================================================================ LIVE PASS

/** Leaf shade drifting over the floor. Surface only: no canopy underground. */
export function paintClouds(c, T, time, W, H) {
  if (!T.canopy) return;
  c.save();
  c.globalCompositeOperation = 'multiply';
  c.globalAlpha = T.canopy;
  for (let i = 0; i < 4; i++) {
    const x = ((time * (11 + i * 5) + i * 520) % (W + 800)) - 400;
    const y = 90 + i * 150;
    const grd = c.createRadialGradient(x, y, 20, x, y, 300);
    grd.addColorStop(0, '#4c4a38');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = grd;
    c.beginPath(); c.ellipse(x, y, 300, 175, 0.3, 0, TAU); c.fill();
  }
  c.restore();
}

/** Glowing fungus, painted live so it can pulse. Deep underground only. */
export function paintPools(c, map, T, time) {
  if (!T.pointLight) return;
  c.save();
  c.globalCompositeOperation = 'lighter';
  for (const p of map.props) {
    if (p.kind !== 'fungus') continue;
    const breathe = 0.86 + Math.sin(time * 1.6 + p.x * 0.02) * 0.1 + Math.sin(time * 0.7 + p.y) * 0.04;
    const r = p.r * breathe;
    const grd = c.createRadialGradient(p.x, p.y - 8, 3, p.x, p.y - 8, r);
    grd.addColorStop(0, 'rgba(180,255,214,0.5)');
    grd.addColorStop(0.42, 'rgba(90,220,160,0.18)');
    grd.addColorStop(1, 'rgba(40,180,120,0)');
    c.fillStyle = grd;
    c.beginPath(); c.arc(p.x, p.y - 8, r, 0, TAU); c.fill();
  }
  c.restore();
}

let air = [];
let airTheme = null;
function seedAir(T, W, H) {
  const rnd = mulberry32(4242);
  air = Array.from({ length: T.air.n }, () => ({
    x: rnd() * W, y: rnd() * H,
    vx: (rnd() - 0.5) * 14, vy: (rnd() - 0.5) * 10,
    r: 1 + rnd() * 2.2, ph: rnd() * TAU, sp: 0.5 + rnd(),
  }));
  airTheme = T;
}

export function paintAir(c, T, time, dt, W, H) {
  if (airTheme !== T) seedAir(T, W, H);
  const kind = T.air.kind;
  c.save();
  c.globalCompositeOperation = kind === 'rain' ? 'source-over' : 'lighter';
  for (const p of air) {
    if (kind === 'pollen') {
      p.x += (p.vx * 0.5 + 9) * dt;
      p.y += Math.sin(time * p.sp + p.ph) * 7 * dt;
      c.globalAlpha = 0.4 + Math.sin(time * 2 + p.ph) * 0.25;
      c.fillStyle = T.air.tint;
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, TAU); c.fill();
    } else if (kind === 'rain') {
      p.x += 150 * dt; p.y += 520 * dt;
      c.globalAlpha = 0.4;
      c.strokeStyle = T.air.tint; c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - 5, p.y - 17); c.stroke();
    } else if (kind === 'motes') {
      // dust sifting down through a cut-open tunnel
      p.x += p.vx * 0.2 * dt;
      p.y += (7 + p.sp * 5) * dt;
      c.globalAlpha = 0.18 + Math.sin(time * 1.5 + p.ph) * 0.14;
      c.fillStyle = T.air.tint;
      c.beginPath(); c.arc(p.x, p.y, p.r * 0.8, 0, TAU); c.fill();
    } else {
      // spores: slow, glowing, with a heartbeat
      p.x += p.vx * 0.35 * dt; p.y += (p.vy * 0.3 - 4) * dt;
      const pulse = Math.max(0, Math.sin(time * 1.3 * p.sp + p.ph));
      c.globalAlpha = pulse * 0.85;
      c.fillStyle = T.air.tint;
      c.beginPath(); c.arc(p.x, p.y, p.r * 1.3, 0, TAU); c.fill();
      c.globalAlpha = pulse * 0.2;
      c.beginPath(); c.arc(p.x, p.y, p.r * 5, 0, TAU); c.fill();
    }
    if (p.x > W + 30) { p.x = -30; p.y = Math.random() * H; }
    if (p.y > H + 30) { p.y = -30; p.x = Math.random() * W; }
    if (p.x < -30) p.x = W + 30;
    if (p.y < -30) p.y = H + 30;
  }
  c.restore();
}

export function paintVignette(c, T, W, H) {
  const grd = c.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.95);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, `rgba(4,3,6,${T.vignette})`);
  c.fillStyle = grd;
  c.fillRect(0, 0, W, H);
}

// ------------------------------------------------------------------ thumbs

/** A small painting of a board for the picker, run through the same painters. */
export function paintThumb(g, map, w) {
  const T = themeOf(map);
  const s = w / map.width;
  g.save();
  g.scale(s, s);
  paintGround(g, map, T, map.width, map.height);
  paintRoads(g, map, T);
  for (const hz of map.hazards) {
    g.save(); g.globalAlpha = 0.55; g.fillStyle = 'rgba(110,175,205,0.8)';
    g.beginPath(); g.ellipse(hz.x, hz.y, hz.r, hz.r * 0.8, 0, 0, TAU); g.fill(); g.restore();
  }
  // each board's signature element earns a glyph on its card, so the picker
  // tells the truth about what you are choosing between
  if (map.tide) {
    for (const hz of map.tide.hazards) {
      g.save(); g.globalAlpha = 0.4; g.fillStyle = 'rgba(110,175,205,0.8)';
      g.beginPath(); g.ellipse(hz.x, hz.y, hz.r, hz.r * 0.8, 0, 0, TAU); g.fill();
      g.globalAlpha = 0.8; g.strokeStyle = 'rgba(207,232,242,0.9)'; g.lineWidth = 5;
      g.setLineDash([14, 12]);
      g.beginPath(); g.ellipse(hz.x, hz.y, hz.r, hz.r * 0.8, 0, 0, TAU); g.stroke();
      g.restore();
    }
  }
  if (map.drops) {
    for (const s of map.drops.spots.flat()) {
      g.save();
      g.fillStyle = '#f2d98c'; g.strokeStyle = '#5a2f1c'; g.lineWidth = 4;
      g.beginPath(); g.ellipse(s.x, s.y, 16, 13, 0.3, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = '#c9564a';
      g.beginPath(); g.ellipse(s.x - 4, s.y - 5, 9, 5, 0.5, 0, TAU); g.fill();
      g.restore();
    }
  }
  if (map.prowl) {
    const L = map.laneLen[map.prowl.lane];
    for (const d of [L * 0.34, L * 0.66]) {
      const p = map.laneAt(map.prowl.lane, d);
      g.save();
      g.translate(p.x, p.y); g.rotate(p.angle);
      g.fillStyle = '#241a10';
      g.beginPath(); g.ellipse(0, 0, 20, 13, 0, 0, TAU); g.fill();
      g.fillStyle = '#54402a';
      g.beginPath(); g.ellipse(-3, 0, 13, 9, 0, 0, TAU); g.fill();
      g.restore();
    }
  }
  if (map.balm) {
    for (const pool of map.balm.pools) {
      g.save(); g.globalAlpha = 0.3; g.fillStyle = '#a8e063';
      g.beginPath(); g.arc(pool.x, pool.y, pool.r, 0, TAU); g.fill(); g.restore();
    }
  }
  for (const p of map.props) paintProp(g, p, T);
  for (const n of map.nests) paintNest(g, n, T);
  paintGrade(g, map, T, map.width, map.height);
  if (T.pointLight) paintPools(g, map, T, 0);
  paintVignette(g, T, map.width, map.height);
  g.restore();
}
