// ===== Ant (tower) body art: procedural ant silhouettes, tiers, tower icons. =====
import { TAU } from '../util.js';
import { INK, bodyGrad, mixHex, stampNoise } from './helpers.js';

// species anatomy: [gaster rx,ry], thorax [rx,ry], head radius, leg length, stance width
const ANT_PROTO = {
  worker:   { g: [8.5, 10.5], th: [5.5, 7], head: 6.2, legLen: 12, spread: 1 },
  trapjaw:  { g: [8, 9.5], th: [6.5, 7.5], head: 9.2, legLen: 13, spread: 1.25 },
  archer:   { g: [6, 14], th: [4.8, 6.5], head: 5.8, legLen: 12, spread: 1 },
  exploder: { g: [11.5, 11.5], th: [5, 6.5], head: 4.8, legLen: 10, spread: 1.12 },
  weaver:   { g: [7, 10.5], th: [4.5, 6], head: 5.6, legLen: 15.5, spread: 1.15 },
  army:     { g: [8, 10], th: [6, 7.5], head: 7.8, legLen: 12, spread: 1.2 },
  majoress: { g: [11, 14], th: [6.5, 8], head: 7.4, legLen: 14, spread: 1.15 },
  honeypot: { g: [15, 15], th: [5, 6.5], head: 5.4, legLen: 10, spread: 1.1 },
  beacon:   { g: [7.5, 9], th: [5, 6.5], head: 6, legLen: 12, spread: 1 },
  hero:     { g: [9.5, 12], th: [6, 7.5], head: 7, legLen: 13, spread: 1.1 },
  guard:    { g: [8, 10], th: [5.5, 7], head: 6.5, legLen: 12, spread: 1 },
};

export function drawAnt(c, typeId, def, opts) {
  const { x, y, angle = -Math.PI / 2, scale = 1, tiers = null, flash = 0, time = 0, stats = null } = opts;
  c.save();
  c.translate(x, y);
  c.scale(scale, scale);
  // grounding shadow (before bob so it stays planted) — soft penumbra + darker core plants the ant
  c.fillStyle = 'rgba(43,26,16,0.12)';
  c.beginPath();
  c.ellipse(3, 13, 18, 7, 0, 0, TAU);
  c.fill();
  c.fillStyle = 'rgba(43,26,16,0.26)';
  c.beginPath();
  c.ellipse(2, 12, 13.5, 5, 0, 0, TAU);
  c.fill();
  const bob = Math.sin(time * 3 + (opts.bob || 0)) * 0.8;
  c.translate(0, bob);
  // placement drop-in: falls from above, shadow grows to meet it
  const pk = opts.placeT > 0 ? opts.placeT / 0.28 : 0;
  if (pk > 0) c.translate(0, -110 * pk * pk);
  c.rotate(angle + Math.PI / 2); // sprites authored pointing up
  // veterans of many tiers grow visibly bigger
  if (tiers) {
    const growth = 1 + (tiers.a + tiers.b) * 0.05;
    c.scale(growth, growth);
  }
  // recoil kick on fire, settling with the flash timer
  const fk = flash > 0 ? flash / 0.12 : 0;
  if (fk > 0) {
    c.translate(0, fk * 3.5);
    c.scale(1 + 0.05 * fk, 1 - 0.05 * fk);
  }

  const col = def.color, dark = def.dark;
  const P = ANT_PROTO[typeId] || ANT_PROTO.guard;
  const gy = 4 + P.g[1] * 0.82; // gaster center sits below the petiole
  c.strokeStyle = INK;

  // legs: 6, jointed at the knee, species stance width
  c.lineWidth = 2.4;
  c.lineJoin = 'round';
  for (let side = -1; side <= 1; side += 2) {
    for (let i = -1; i <= 1; i++) {
      const hx = side * 4, hy = i * 4.5;
      const fx = side * (P.legLen + Math.abs(i) * 2) * P.spread, fy = i * 6.5 + 3;
      c.beginPath();
      c.moveTo(hx, hy);
      c.lineTo((hx + fx) / 2, (hy + fy) / 2 - 2.6);
      c.lineTo(fx, fy);
      c.stroke();
      c.fillStyle = INK;
      c.beginPath(); c.arc(fx, fy, 1, 0, TAU); c.fill();
    }
  }

  // gaster (abdomen, behind)
  if (typeId === 'honeypot') {
    const slosh = 1 + Math.sin(time * 2.1 + (opts.bob || 0)) * 0.035; // liquid sway
    c.save();
    c.translate(0, gy);
    c.scale(1, slosh);
    c.fillStyle = 'rgba(245,166,35,0.92)';
    c.beginPath(); c.arc(0, 0, P.g[0], 0, TAU); c.fill();
    c.lineWidth = 3; c.stroke();
    // replete harness: repletes hang from rope in the nest
    c.strokeStyle = 'rgba(43,26,16,0.55)';
    c.lineWidth = 2;
    c.beginPath(); c.arc(0, 0, P.g[0] - 1.5, 0.5, 2.65); c.stroke();
    c.beginPath(); c.arc(0, 0, P.g[0] - 1.5, -2.6, -0.5); c.stroke();
    c.strokeStyle = INK;
    c.fillStyle = 'rgba(255,255,255,0.45)';
    c.beginPath(); c.arc(-5, -6, 5, 0, TAU); c.fill();
    c.fillStyle = '#ffd166';
    c.beginPath(); c.arc(0, P.g[0] - 3.5, 3.5, 0, TAU); c.fill(); // drip
    c.restore();
    // sugar sparkles orbiting the living jar
    c.fillStyle = '#ffe9a8';
    for (let i = 0; i < 2; i++) {
      const a = time * 1.4 + (opts.bob || 0) + i * Math.PI;
      c.beginPath(); c.arc(Math.cos(a) * 19, gy + Math.sin(a) * 12, 1.6, 0, TAU); c.fill();
    }
  } else if (typeId === 'archer') {
    // artillery abdomen: ringed barrel with an acid reservoir at the tip
    c.fillStyle = bodyGrad(c, col, dark, 13);
    c.beginPath(); c.ellipse(0, gy, P.g[0], P.g[1], 0, 0, TAU); c.fill();
    c.lineWidth = 3; c.stroke();
    c.strokeStyle = 'rgba(43,26,16,0.5)';
    c.lineWidth = 1.8;
    for (let i = 0; i < 3; i++) {
      const ry = gy - 4 + i * 5;
      c.beginPath(); c.ellipse(0, ry, P.g[0] - 1 - i * 0.4, 2.4, 0, 0, Math.PI); c.stroke();
    }
    c.strokeStyle = INK;
    c.fillStyle = '#9be34a';
    c.lineWidth = 2;
    c.beginPath(); c.arc(0, gy + P.g[1] - 2.5, 3.6, 0, TAU); c.fill(); c.stroke();
  } else if (typeId === 'exploder') {
    const pulse = 1 + Math.sin(time * 6) * 0.08 + flash * 2;
    c.fillStyle = flash > 0 ? '#ffe9a8' : bodyGrad(c, col, dark, P.g[0]);
    c.beginPath(); c.arc(0, gy, P.g[0] * pulse, 0, TAU); c.fill();
    c.lineWidth = 3; c.stroke();
    // hazard chevrons: this ant is ordnance
    c.strokeStyle = 'rgba(43,26,16,0.75)';
    c.lineWidth = 3.2;
    for (let i = -1; i <= 1; i += 2) {
      c.beginPath(); c.arc(0, gy, P.g[0] * pulse * 0.62, i > 0 ? 0.5 : Math.PI + 0.5, i > 0 ? 1.25 : Math.PI + 1.25); c.stroke();
    }
    c.strokeStyle = INK;
    // pressure cracks glow as it readies
    if (flash > 0 || Math.sin(time * 6) > 0.6) {
      c.strokeStyle = '#ffd166';
      c.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + 0.5;
        c.beginPath();
        c.moveTo(Math.cos(a) * P.g[0] * 0.35, gy + Math.sin(a) * P.g[0] * 0.35);
        c.lineTo(Math.cos(a + 0.3) * P.g[0] * 0.75, gy + Math.sin(a + 0.3) * P.g[0] * 0.75);
        c.stroke();
      }
      c.strokeStyle = INK;
    }
    c.fillStyle = '#e2472f';
    c.beginPath(); c.arc(0, gy + P.g[0] * pulse * 0.62, 4, 0, TAU); c.fill(); c.stroke();
  } else if (typeId === 'majoress') {
    c.fillStyle = bodyGrad(c, col, dark, 14);
    c.beginPath(); c.ellipse(0, gy, P.g[0], P.g[1], 0, 0, TAU); c.fill();
    c.lineWidth = 3; c.stroke();
    c.strokeStyle = '#ffd166';
    c.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) {
      c.beginPath(); c.arc(0, gy - 6 + i * 5.5, 9.5 - i * 1.2, 0.35, Math.PI - 0.35); c.stroke();
    }
    c.strokeStyle = INK;
  } else if (typeId === 'hero' && opts.hero === 'melissa') {
    // Melissa: glossy honey-pot gaster, like a small replete
    const slosh = 1 + Math.sin(time * 2.1 + (opts.bob || 0)) * 0.03;
    c.save();
    c.translate(0, gy);
    c.scale(1, slosh);
    c.fillStyle = 'rgba(245,166,35,0.92)';
    c.beginPath(); c.arc(0, 0, P.g[0], 0, TAU); c.fill();
    c.lineWidth = 3; c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.45)';
    c.beginPath(); c.arc(-4, -5, 4, 0, TAU); c.fill();
    c.fillStyle = '#ffd166';
    c.beginPath(); c.arc(0, P.g[0] - 3, 3, 0, TAU); c.fill(); // honey drip
    c.restore();
  } else {
    c.fillStyle = bodyGrad(c, col, dark, P.g[1]);
    c.beginPath(); c.ellipse(0, gy, P.g[0], P.g[1], 0, 0, TAU); c.fill();
    c.lineWidth = 3; c.stroke();
    // segment banding: ants have plated gasters
    c.strokeStyle = 'rgba(43,26,16,0.4)';
    c.lineWidth = 1.6;
    c.beginPath(); c.ellipse(0, gy - P.g[1] * 0.25, P.g[0] * 0.92, 2.6, 0, 0, Math.PI); c.stroke();
    c.beginPath(); c.ellipse(0, gy + P.g[1] * 0.2, P.g[0] * 0.8, 2.4, 0, 0, Math.PI); c.stroke();
    c.strokeStyle = INK;
  }
  // per-species markings
  if (typeId === 'army') {
    c.strokeStyle = 'rgba(255,244,214,0.75)';
    c.lineWidth = 1.8;
    c.beginPath(); c.moveTo(-4, gy - 3); c.lineTo(-1, gy + 1); c.stroke(); // battle scars
    c.beginPath(); c.moveTo(4, gy + 2); c.lineTo(6.5, gy + 6); c.stroke();
    c.strokeStyle = INK;
    // staked pennant: this is a camp
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(13, 10); c.lineTo(13, -8); c.stroke();
    c.fillStyle = '#7a2d1c';
    c.beginPath(); c.moveTo(13, -8); c.lineTo(21, -5); c.lineTo(13, -2); c.closePath(); c.fill(); c.stroke();
  }
  // gaster texture + glint
  if (typeId !== 'honeypot') {
    c.save();
    c.translate(0, gy);
    stampNoise(c, P.g[0] + 1, P.g[1] + 1, 0.14);
    c.restore();
  }
  c.fillStyle = 'rgba(255,255,255,0.3)';
  c.beginPath(); c.ellipse(-P.g[0] * 0.35, gy - P.g[1] * 0.4, 2.4, 3.2, -0.4, 0, TAU); c.fill();

  // weaver: a silk-spinner — woven web fan behind, spinneret sac, dangling beaded threads
  if (typeId === 'weaver') {
    const sy = gy + P.g[1];
    // faint woven web fan behind the abdomen
    c.strokeStyle = 'rgba(238,246,244,0.5)';
    c.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      c.beginPath(); c.moveTo(0, sy - 2); c.lineTo(i * 7, sy + 16); c.stroke();
    }
    for (let r = 6; r <= 14; r += 4) {
      c.beginPath(); c.moveTo(-r, sy + r * 0.9); c.quadraticCurveTo(0, sy + r * 0.55, r, sy + r * 0.9); c.stroke();
    }
    // glossy silk sac at the spinneret
    c.fillStyle = '#eef6f4';
    c.strokeStyle = INK; c.lineWidth = 1.6;
    c.beginPath(); c.ellipse(0, sy + 1, 3.4, 4.2, 0, 0, TAU); c.fill(); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.beginPath(); c.arc(-1, sy - 0.4, 1.1, 0, TAU); c.fill();
    // dangling beaded threads
    c.strokeStyle = 'rgba(238,246,244,0.85)'; c.lineWidth = 1.4;
    for (const dx of [-3, 2]) {
      c.beginPath(); c.moveTo(dx * 0.4, sy + 4);
      c.quadraticCurveTo(dx, sy + 10, dx * 0.6, sy + 16); c.stroke();
      c.fillStyle = '#eef6f4';
      c.beginPath(); c.arc(dx * 0.6, sy + 16, 1.4, 0, TAU); c.fill();
    }
    c.strokeStyle = INK;
  }

  // petiole: the pinched ant waist. Myrmicine castes (the Majoress, an Atta-like major)
  // have TWO nodes — petiole + postpetiole; Formicines get the single node.
  const pyy = P.th[1] * 0.62 + 1.5;
  c.fillStyle = bodyGrad(c, col, dark, 3);
  c.lineWidth = 2;
  if (typeId === 'majoress') {
    c.beginPath(); c.arc(0, pyy - 0.6, 2.3, 0, TAU); c.fill(); c.stroke();
    c.beginPath(); c.arc(0, pyy + 3, 2.6, 0, TAU); c.fill(); c.stroke();
  } else {
    c.beginPath(); c.arc(0, pyy, 2.7, 0, TAU); c.fill(); c.stroke();
  }

  // hero regalia sits behind the thorax
  if (typeId === 'hero' && opts.hero === 'formica') {
    // regalia takes the COLONY colour, not a fixed one: a queen is the piece you
    // pick out of a crowd, and a hardcoded red cape made every Warqueen on the
    // board read as Ember's whatever colour her colony was wearing
    c.fillStyle = col;                    // war cape
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(-8, -4); c.quadraticCurveTo(-13, 8, -7, 14); c.lineTo(0, 6); c.closePath(); c.fill(); c.stroke();
  } else if (typeId === 'hero' && opts.hero === 'vespula') {
    c.fillStyle = 'rgba(238,246,244,0.4)'; // silk shawl
    c.lineWidth = 1.5;
    c.beginPath(); c.ellipse(0, 2, 12, 8, 0, 0, TAU); c.fill();
  } else if (typeId === 'hero' && opts.hero === 'sergeant') {
    c.fillStyle = dark;                   // summoner's tattered cape
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(8, -4); c.quadraticCurveTo(13, 8, 7, 14); c.lineTo(0, 6); c.closePath(); c.fill(); c.stroke();
  }

  // thorax
  c.fillStyle = bodyGrad(c, col, dark, P.th[1]);
  c.lineWidth = 2.6;
  c.beginPath(); c.ellipse(0, 0, P.th[0], P.th[1], 0, 0, TAU); c.fill(); c.stroke();
  if (typeId === 'worker') { // pellet bandolier across the thorax
    c.fillStyle = '#9be34a';
    c.lineWidth = 1.2;
    for (let i = -1; i <= 1; i++) {
      c.beginPath(); c.arc(i * 3.4, -i * 1.6 + 1, 1.7, 0, TAU); c.fill(); c.stroke();
    }
  } else if (typeId === 'majoress') { // gold pauldrons
    c.strokeStyle = '#ffd166';
    c.lineWidth = 2.6;
    c.beginPath(); c.arc(-P.th[0] + 1, -2, 4.5, Math.PI * 0.6, Math.PI * 1.5); c.stroke();
    c.beginPath(); c.arc(P.th[0] - 1, -2, 4.5, -Math.PI * 0.5, Math.PI * 0.4); c.stroke();
    c.strokeStyle = INK;
  } else if (typeId === 'trapjaw') { // armored collar
    c.strokeStyle = 'rgba(43,26,16,0.6)';
    c.lineWidth = 2.2;
    c.beginPath(); c.ellipse(0, -2.5, P.th[0] * 0.85, 2.2, 0, 0, Math.PI); c.stroke();
    c.strokeStyle = INK;
  }

  // head — size is the species signature
  const hy0 = -(P.th[1] + P.head * 0.55);
  c.save();
  c.translate(0, hy0);
  c.fillStyle = bodyGrad(c, dark, mixHex(dark, '#100804', 0.5), P.head);
  c.beginPath(); c.arc(0, 0, P.head, 0, TAU); c.fill(); c.stroke();
  if (typeId === 'army') { // helmet plate
    c.strokeStyle = 'rgba(255,244,214,0.5)';
    c.lineWidth = 2.4;
    c.beginPath(); c.arc(0, 0, P.head - 2, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
    c.strokeStyle = INK;
  }
  c.restore();

  // mandibles / weapons
  const headFront = hy0 - P.head + 1;
  if (typeId === 'trapjaw') {
    // Odontomachus trap-jaws: long, thin, STRAIGHT linear mandibles with fine inner teeth
    // and a terminal tooth — latched wide open at rest, snapping nearly shut on attack.
    const open = flash > 0 ? 0.06 : 0.6;      // 0 = snapped forward, 1 = splayed ~90° apart
    const spread = 0.18 + open * 1.05;         // radians each jaw angles outward from forward
    const len = 18;
    for (let side = -1; side <= 1; side += 2) {
      c.save();
      c.scale(side, 1);
      c.translate(2.2, headFront + 1);
      c.rotate(spread);
      // thin tapered straight blade with a hooked terminal tooth
      c.beginPath();
      c.moveTo(-1.3, 1);
      c.lineTo(-1.0, -len);
      c.lineTo(0.4, -len - 2.8);   // terminal tooth
      c.lineTo(1.4, -len + 1);
      c.lineTo(1.6, 0.5);
      c.closePath();
      c.fillStyle = dark; c.fill();
      c.lineWidth = 2; c.strokeStyle = INK; c.stroke();
      // fine teeth along the inner (mesal) edge
      c.lineWidth = 1;
      for (let k = 1; k <= 3; k++) {
        const ty = -len * (0.28 + k * 0.18);
        c.beginPath(); c.moveTo(-1.0, ty); c.lineTo(-2.7, ty + 0.9); c.stroke();
      }
      // rim light down the outer edge
      c.strokeStyle = 'rgba(226,236,255,0.4)';
      c.beginPath(); c.moveTo(1.2, 0); c.lineTo(1.0, -len + 1); c.stroke();
      c.restore();
    }
  } else if (typeId === 'archer') {
    // sleek acid sniper: long tapered barrel, scope, dripping green muzzle
    const by = headFront;
    c.save();
    c.rotate(-0.1); // held at a marksman's slight cant
    c.lineCap = 'round';
    // barrel
    c.strokeStyle = dark; c.lineWidth = 5.5;
    c.beginPath(); c.moveTo(0, by + 2); c.lineTo(0, by - 18); c.stroke();
    c.strokeStyle = INK; c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(0, by + 2); c.lineTo(0, by - 18); c.stroke();
    // muzzle brake vents
    c.lineWidth = 1.8;
    c.beginPath(); c.moveTo(-2.8, by - 15.5); c.lineTo(2.8, by - 15.5); c.stroke();
    c.beginPath(); c.moveTo(-2.4, by - 12.8); c.lineTo(2.4, by - 12.8); c.stroke();
    // scope
    c.fillStyle = INK; c.fillRect(-1.6, by - 9.5, 3.2, 5);
    c.fillStyle = '#8fd3e8';
    c.beginPath(); c.arc(0, by - 9, 1.1, 0, TAU); c.fill();
    // acid globule at the muzzle
    c.fillStyle = '#9be34a'; c.strokeStyle = INK; c.lineWidth = 1.4;
    c.beginPath(); c.arc(0, by - 18, 2.4, 0, TAU); c.fill(); c.stroke();
    c.fillStyle = '#d7fb7a';
    c.beginPath(); c.arc(-0.7, by - 18.7, 0.9, 0, TAU); c.fill();
    c.restore();
  } else if (typeId === 'army') {
    // hooked war-jaws
    c.strokeStyle = INK;
    c.lineWidth = 2.8;
    for (let side = -1; side <= 1; side += 2) {
      c.beginPath();
      c.moveTo(side * 3, headFront + 2);
      c.quadraticCurveTo(side * 9, headFront - 4, side * 4, headFront - 9);
      c.stroke();
    }
  } else if (typeId === 'majoress') {
    // acid tusks + a tall jeweled crown — a royal heavyweight
    const hf = headFront;
    c.lineCap = 'round';
    c.strokeStyle = dark; c.lineWidth = 3.4;
    for (let side = -1; side <= 1; side += 2) { c.beginPath(); c.moveTo(side * 3, hf + 3); c.quadraticCurveTo(side * 7.5, hf - 2, side * 4.5, hf - 8); c.stroke(); }
    c.strokeStyle = INK; c.lineWidth = 1.4;
    for (let side = -1; side <= 1; side += 2) { c.beginPath(); c.moveTo(side * 3, hf + 3); c.quadraticCurveTo(side * 7.5, hf - 2, side * 4.5, hf - 8); c.stroke(); }
    c.fillStyle = '#ffd166'; c.strokeStyle = INK; c.lineWidth = 1.8;
    c.beginPath();
    c.moveTo(-7.5, hf - 1); c.lineTo(-7.5, hf - 6); c.lineTo(-4.5, hf - 3); c.lineTo(-2.5, hf - 11);
    c.lineTo(0, hf - 4); c.lineTo(2.5, hf - 11); c.lineTo(4.5, hf - 3); c.lineTo(7.5, hf - 6); c.lineTo(7.5, hf - 1);
    c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#e2472f'; c.beginPath(); c.arc(0, hf - 9.5, 1.6, 0, TAU); c.fill();
    c.fillStyle = '#8fd3e8'; c.beginPath(); c.arc(-2.5, hf - 10, 1.1, 0, TAU); c.fill(); c.beginPath(); c.arc(2.5, hf - 10, 1.1, 0, TAU); c.fill();
  } else if (typeId === 'worker') {
    // small working mandibles with a bead of acid — the reliable grunt
    c.strokeStyle = INK; c.lineWidth = 2.4; c.lineCap = 'round';
    for (let side = -1; side <= 1; side += 2) { c.beginPath(); c.moveTo(side * 2.5, headFront + 2); c.quadraticCurveTo(side * 6, headFront - 2, side * 3, headFront - 6); c.stroke(); }
    c.fillStyle = '#9be34a';
    c.beginPath(); c.arc(0, headFront - 1, 1.7, 0, TAU); c.fill();
  } else if (typeId === 'hero') {
    if (opts.hero === 'formica') {
      // war banner + heavy jaws (mirror-exact)
      c.strokeStyle = INK;
      c.lineWidth = 3.2;
      for (let side = -1; side <= 1; side += 2) {
        c.save();
        c.scale(side, 1);
        c.beginPath();
        c.arc(4, headFront - 1, 7.5, -2.6, -0.5);
        c.stroke();
        c.restore();
      }
      c.lineWidth = 2.4;
      c.beginPath(); c.moveTo(9, 4); c.lineTo(9, -26); c.stroke();
      c.fillStyle = col;                  // the banner flies colony colours too
      c.beginPath(); c.moveTo(9, -26); c.lineTo(22, -22); c.lineTo(9, -17); c.closePath();
      c.fill(); c.stroke();
    } else if (opts.hero === 'melissa') {
      // small crown of flower petals
      c.strokeStyle = INK;
      c.fillStyle = '#ff9d8a';
      c.lineWidth = 1.4;
      for (let i = -2; i <= 2; i++) {
        const a = -Math.PI / 2 + i * 0.5;
        const px = Math.cos(a) * (P.head + 1.5);
        const py = hy0 + Math.sin(a) * (P.head + 1.5);
        c.beginPath(); c.ellipse(px, py, 3.2, 2, a, 0, TAU); c.fill(); c.stroke();
      }
      c.fillStyle = '#ffd166';
      c.beginPath(); c.arc(0, hy0 - P.head - 1.5, 2.4, 0, TAU); c.fill(); c.stroke();
    } else if (opts.hero === 'sergeant') {
      // summoner's rune staff + horned diadem
      c.strokeStyle = INK;
      c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(-9, 6); c.lineTo(-9, -24); c.stroke(); // staff
      c.fillStyle = mixHex(col, '#ffffff', 0.35);
      c.beginPath(); c.arc(-9, -26, 3.4, 0, TAU); c.fill(); c.stroke(); // summoning orb
      c.strokeStyle = mixHex(col, '#ffffff', 0.5);
      c.lineWidth = 1.6;
      c.beginPath(); c.arc(-9, -26, 6 + Math.sin(time * 4 + (opts.bob || 0)) * 1.2, 0, TAU); c.stroke(); // pulsing halo
      c.strokeStyle = INK;
      c.fillStyle = '#2a1245';
      c.lineWidth = 1.6;
      for (const sx of [-4, 4]) { // horned diadem
        c.beginPath(); c.moveTo(sx, headFront + 1); c.lineTo(sx * 1.8, headFront - 7); c.lineTo(sx * 0.7, headFront - 2); c.closePath(); c.fill(); c.stroke();
      }
    } else {
      // silk diadem + trailing threads
      c.strokeStyle = 'rgba(238,246,244,0.9)';
      c.lineWidth = 1.8;
      for (let i = -1; i <= 1; i++) {
        c.beginPath();
        c.moveTo(i * 3, 20);
        c.quadraticCurveTo(i * 8, 28, i * 5, 36);
        c.stroke();
      }
      c.strokeStyle = INK;
      c.fillStyle = '#eef6f4';
      c.lineWidth = 1.6;
      for (let i = -1; i <= 1; i++) {
        c.beginPath(); c.arc(i * 5, headFront, 2.6, 0, TAU); c.fill(); c.stroke();
      }
    }
  } else if (typeId !== 'beacon') {
    // elbowed antennae — the ant signature — with a gentle idle sway
    const sway = Math.sin(time * 2.2 + (opts.bob || 0)) * 1.3;
    c.strokeStyle = INK;
    c.lineWidth = 2;
    for (let side = -1; side <= 1; side += 2) {
      c.beginPath();
      c.moveTo(side * 2.5, headFront + 2);
      c.lineTo(side * 6 + sway, headFront - 5);
      c.lineTo(side * 10.5 + sway, headFront - 3);
      c.stroke();
    }
  }

  // beacon: radar mast with dish and V-antennae
  if (typeId === 'beacon') {
    c.strokeStyle = INK;
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, headFront + 2); c.lineTo(0, headFront - 14); c.stroke();
    c.lineWidth = 2.4;
    c.beginPath(); c.arc(0, headFront - 15, 6.5, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); // dish
    const pulse = 0.5 + 0.5 * Math.sin(time * 4 + (opts.bob || 0));
    c.fillStyle = `rgba(99,200,240,${0.55 + pulse * 0.45})`;
    c.beginPath(); c.arc(0, headFront - 16, 3.6 + pulse * 1.2, 0, TAU); c.fill(); c.stroke();
    c.lineWidth = 1.8;
    for (let side = -1; side <= 1; side += 2) {
      c.beginPath();
      c.moveTo(side * 3, headFront + 1);
      c.lineTo(side * 8, headFront - 7);
      c.stroke();
    }
  }

  // compound eyes: dark, faceted, set on the SIDES of the head (as real ants have them),
  // not forward-facing cartoon eyes. A single reflective glint keeps them lively.
  const eyeR = Math.max(1.8, P.head * 0.3);
  for (let side = -1; side <= 1; side += 2) {
    const ex = side * P.head * 0.6, ey = hy0 - P.head * 0.12;
    c.fillStyle = mixHex(dark, '#050302', 0.45);
    c.strokeStyle = INK; c.lineWidth = 1;
    c.beginPath(); c.ellipse(ex, ey, eyeR * 0.78, eyeR, side * 0.28, 0, TAU); c.fill(); c.stroke();
    // faint facet banding
    c.strokeStyle = 'rgba(255,255,255,0.14)'; c.lineWidth = 0.7;
    c.beginPath(); c.ellipse(ex, ey, eyeR * 0.5, eyeR * 0.66, side * 0.28, 0, TAU); c.stroke();
    // reflective glint
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.beginPath(); c.arc(ex - side * 0.7, ey - eyeR * 0.4, eyeR * 0.28, 0, TAU); c.fill();
  }
  // archer keeps a sniper's monocle scope over one eye (a prop, not a googly eye)
  if (typeId === 'archer') {
    const ex = -P.head * 0.6, ey = hy0 - P.head * 0.12;
    c.strokeStyle = INK; c.lineWidth = 1.6;
    c.beginPath(); c.arc(ex, ey, eyeR + 1.2, 0, TAU); c.stroke();
    c.strokeStyle = 'rgba(143,211,232,0.9)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(ex - eyeR, ey); c.lineTo(ex + eyeR, ey); c.stroke();
    c.beginPath(); c.moveTo(ex, ey - eyeR); c.lineTo(ex, ey + eyeR); c.stroke();
  }
  // royal caste (Majoress) carries three ocelli — simple eyes — in a triangle on the vertex
  if (typeId === 'majoress') {
    const oc = [[0, hy0 - P.head * 0.5], [-P.head * 0.2, hy0 - P.head * 0.24], [P.head * 0.2, hy0 - P.head * 0.24]];
    for (const [ox, oy] of oc) {
      c.fillStyle = '#ffe08a'; c.strokeStyle = INK; c.lineWidth = 0.7;
      c.beginPath(); c.arc(ox, oy, 1, 0, TAU); c.fill(); c.stroke();
    }
  }

  // weaver holds a leaf in her jaws
  if (typeId === 'weaver') {
    c.fillStyle = '#63a832';
    c.strokeStyle = INK;
    c.lineWidth = 1.4;
    c.beginPath(); c.ellipse(0, headFront - 3, 5.5, 2.8, 0.15, 0, TAU); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(-5, headFront - 3.6); c.lineTo(5, headFront - 2.4); c.stroke();
  }

  // tier-3 transforms: any maxed path earns a distinct silhouette piece
  if (tiers && (tiers.a >= 3 || tiers.b >= 3)) {
    if (typeId === 'worker') { // banded cannon-gaster
      c.strokeStyle = '#ffd166'; c.lineWidth = 2.6;
      c.beginPath(); c.ellipse(0, gy - 2, P.g[0] + 1.5, 3, 0, 0, Math.PI); c.stroke();
      c.beginPath(); c.ellipse(0, gy + 3.5, P.g[0] - 0.5, 2.6, 0, 0, Math.PI); c.stroke();
      c.strokeStyle = INK; c.lineWidth = 2.4; c.fillStyle = '#5b4a32';
      c.beginPath(); c.arc(0, gy + P.g[1] + 2, 3.4, 0, TAU); c.fill(); c.stroke(); // muzzle
    } else if (typeId === 'trapjaw') { // crested helm
      c.fillStyle = '#e2472f'; c.strokeStyle = INK; c.lineWidth = 2;
      c.beginPath(); c.moveTo(-P.head * 0.55, hy0 - P.head * 0.4);
      c.quadraticCurveTo(0, hy0 - P.head - 7, P.head * 0.55, hy0 - P.head * 0.4);
      c.lineTo(0, hy0 - P.head * 0.15); c.closePath(); c.fill(); c.stroke();
    } else if (typeId === 'archer') { // twin barrels
      c.strokeStyle = dark; c.lineWidth = 4;
      for (const sx of [-3.4, 3.4]) { c.beginPath(); c.moveTo(sx, headFront); c.lineTo(sx, headFront - 12); c.stroke(); }
      c.strokeStyle = INK; c.lineWidth = 1.6;
      for (const sx of [-3.4, 3.4]) { c.beginPath(); c.arc(sx, headFront - 12, 2.1, 0, TAU); c.stroke(); }
    } else if (typeId === 'exploder') { // double payload
      c.fillStyle = bodyGrad(c, col, dark, 6); c.strokeStyle = INK; c.lineWidth = 2.2;
      c.beginPath(); c.arc(P.g[0] * 0.85, gy + 3, 6, 0, TAU); c.fill(); c.stroke();
      c.fillStyle = '#e2472f';
      c.beginPath(); c.arc(P.g[0] * 0.85, gy + 8, 2.2, 0, TAU); c.fill(); c.stroke();
    } else if (typeId === 'weaver') { // silk cape
      c.fillStyle = 'rgba(238,246,244,0.55)'; c.strokeStyle = INK; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(-P.th[0] - 2, -2); c.quadraticCurveTo(-11, gy + 6, -4, gy + P.g[1] + 4);
      c.lineTo(4, gy + P.g[1] + 4); c.quadraticCurveTo(11, gy + 6, P.th[0] + 2, -2); c.closePath(); c.fill(); c.stroke();
    } else if (typeId === 'army') { // second war-standard: a gold campaign banner
      c.strokeStyle = INK; c.lineWidth = 2.4;
      c.beginPath(); c.moveTo(-13, 12); c.lineTo(-13, -18); c.stroke();
      c.fillStyle = '#ffd166';
      c.beginPath(); c.moveTo(-13, -18); c.lineTo(-2, -14.5); c.lineTo(-13, -11); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#7a2d1c';
      c.beginPath(); c.arc(-13, -20, 2.4, 0, TAU); c.fill(); c.stroke(); // finial
    } else if (typeId === 'majoress') { // full crown + royal cape
      c.fillStyle = 'rgba(123,63,160,0.5)'; c.strokeStyle = INK; c.lineWidth = 1.8;
      c.beginPath(); c.moveTo(-P.th[0] - 3, -3); c.quadraticCurveTo(-14, gy + 8, -5, gy + P.g[1] + 3);
      c.lineTo(5, gy + P.g[1] + 3); c.quadraticCurveTo(14, gy + 8, P.th[0] + 3, -3); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#ffd166'; c.lineWidth = 1.8;
      c.beginPath();
      c.moveTo(-8, headFront + 1); c.lineTo(-6, headFront - 8); c.lineTo(-2.5, headFront - 2.5);
      c.lineTo(0, headFront - 10); c.lineTo(2.5, headFront - 2.5); c.lineTo(6, headFront - 8); c.lineTo(8, headFront + 1);
      c.closePath(); c.fill(); c.stroke();
    }
  }

  c.restore();

  // tier pips (world-space, below the ant)
  if (tiers) {
    c.save();
    c.translate(x, y);
    if (tiers.a > 0) {
      c.fillStyle = '#ffd166';
      c.strokeStyle = INK;
      c.lineWidth = 1.4;
      for (let i = 0; i < tiers.a; i++) {
        c.save();
        c.translate(-14 + 0, 20 + i * -0); // stacked horizontally below-left
        c.restore();
        const px = -16 + i * 9;
        c.beginPath();
        c.moveTo(px, 22 - 4); c.lineTo(px + 4, 22); c.lineTo(px, 22 + 4); c.lineTo(px - 4, 22);
        c.closePath(); c.fill(); c.stroke();
      }
    }
    if (tiers.b > 0) {
      c.fillStyle = '#63c8f0';
      c.strokeStyle = INK;
      c.lineWidth = 1.4;
      for (let i = 0; i < tiers.b; i++) {
        c.beginPath();
        c.arc(6 + i * 9, 22, 3.6, 0, TAU);
        c.fill(); c.stroke();
      }
    }
    if (tiers.a >= 3 || tiers.b >= 3) {
      // tiny crown for a maxed path
      c.fillStyle = '#ffd166';
      c.strokeStyle = INK;
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(-7, -26); c.lineTo(-4, -32) ; c.lineTo(0, -27); c.lineTo(4, -32); c.lineTo(7, -26); c.closePath();
      c.fill(); c.stroke();
    }
    c.restore();
  }

  // veteran service stars
  if (opts.stars) {
    c.save();
    c.translate(x, y);
    c.font = "900 11px 'Baloo 2', 'Trebuchet MS', sans-serif";
    c.textAlign = 'center';
    c.lineWidth = 2.6;
    c.strokeStyle = INK;
    const str = '★'.repeat(opts.stars);
    c.strokeText(str, 0, -30);
    c.fillStyle = '#ffd166';
    c.fillText(str, 0, -30);
    c.restore();
  }

  // hero level badge
  if (opts.heroLevel) {
    c.save();
    c.translate(x, y);
    c.fillStyle = '#ffd166';
    c.strokeStyle = INK;
    c.lineWidth = 2;
    c.beginPath(); c.arc(0, 24, 8.5, 0, TAU); c.fill(); c.stroke();
    c.fillStyle = INK;
    c.font = "900 10px 'Baloo 2', 'Trebuchet MS', sans-serif";
    c.textAlign = 'center';
    c.fillText(String(opts.heroLevel), 0, 27.5);
    c.restore();
  }
}

export function drawTowerIcon(c, typeId, def, size = 56, time = 0) {
  c.clearRect(0, 0, size, size);
  drawAnt(c, typeId, def, { x: size / 2, y: size / 2 + 4, scale: size / 64, time });
}
