// ===== Bug (enemy) body art: silhouettes, shells, status FX, HP bars. =====
import { TAU } from '../util.js';
import { INK, bodyGrad, mixHex, rr, stampNoise } from './helpers.js';

export function bodyColors(e) {
  if (e.camo) return { fill: '#8a9a52', dark: '#55622f' };
  return { fill: e.jfill || e.type.color, dark: e.type.dark };
}

export function drawBugBody(c, e, time) {
  const t = e.type;
  const r = t.radius;
  const { fill, dark } = bodyColors(e);
  const rx = r * 1.25 * (t.bodyL || 1), ry = r * 0.92 * (t.bodyW || 1);

  // legs — jointed at the knee, swinging with distance travelled
  c.strokeStyle = INK;
  c.lineWidth = 2.4;
  c.lineJoin = 'round';
  const legR = t.bigLegs ? ry + 8 : ry + 5;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = -1; i <= 1; i++) {
      const ph = e.dist * 0.14 + i * 2.1 + e.phase + (side > 0 ? 1.5 : 0);
      const sw = Math.sin(ph) * 4;
      const hx = i * rx * 0.45, hy = side * ry * 0.5;
      const fx = hx + sw, fy = side * legR;
      c.beginPath();
      c.moveTo(hx, hy);
      c.lineTo((hx + fx) / 2 + sw * 0.4, (hy + fy) / 2 + side * 2.4); // knee bows outward
      c.lineTo(fx, fy);
      c.stroke();
      c.fillStyle = INK;
      c.beginPath(); c.arc(fx, fy, 1.1, 0, TAU); c.fill(); // foot
    }
  }

  // wings (behind body)
  if (t.wings) {
    const flap = Math.sin(time * 34 + e.phase) * 0.45;
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.strokeStyle = 'rgba(43,26,16,0.5)';
    c.lineWidth = 1.6;
    for (let side = -1; side <= 1; side += 2) {
      c.save();
      c.rotate(side * (0.75 + flap));
      c.beginPath();
      c.ellipse(-r * 0.9, 0, r * 1.15, r * 0.42, 0, 0, TAU);
      c.fill(); c.stroke();
      // iridescent sheen: a cool/warm arc that flickers as the wing beats
      // (skipped on the tiniest wings — invisible there, and swarms stay cheap)
      if (r >= 11) {
        c.strokeStyle = side > 0
          ? `rgba(170,220,255,${0.22 + 0.16 * Math.sin(time * 21 + e.phase)})`
          : `rgba(255,190,235,${0.22 + 0.16 * Math.cos(time * 19 + e.phase)})`;
        c.lineWidth = 1.8;
        c.beginPath();
        c.ellipse(-r * 0.9, 0, r * 0.88, r * 0.28, 0, -2.7, -0.5);
        c.stroke();
        c.strokeStyle = 'rgba(43,26,16,0.5)';
        c.lineWidth = 1.6;
      }
      c.restore();
    }
  }

  // body — lit from the top-left
  c.fillStyle = bodyGrad(c, fill, dark, ry);
  c.strokeStyle = INK;
  c.lineWidth = 3;
  c.beginPath();
  c.ellipse(0, 0, rx, ry, 0, 0, TAU);
  c.fill();

  // camo stick-bug stripes (clipped)
  if (e.camo) {
    c.save();
    c.clip();
    c.strokeStyle = '#55622f';
    c.lineWidth = 4.5;
    for (let i = -1; i <= 1; i++) {
      c.beginPath();
      c.moveTo(i * rx * 0.55 - ry * 0.6, -ry - 2);
      c.lineTo(i * rx * 0.55 + ry * 0.6, ry + 2);
      c.stroke();
    }
    c.restore();
  }

  // pillbug plates — also the tell on ARMORED-round bugs (steel-gray banding)
  if (t.plates || e.armored) {
    c.strokeStyle = t.plates ? dark : 'rgba(151,161,176,0.9)';
    c.lineWidth = 3;
    for (let i = -1; i <= 1; i++) {
      c.beginPath();
      c.arc(i * rx * 0.42, 0, ry * 0.85, -Math.PI * 0.42, Math.PI * 0.42);
      c.stroke();
    }
  }

  // queen stripes
  if (t.stripes) {
    c.fillStyle = 'rgba(43,26,16,0.75)';
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.ellipse(-rx * 0.15 - i * rx * 0.28, 0, rx * 0.09, ry * 0.94, 0, 0, TAU);
      c.fill();
    }
  }

  // species detail kits
  const id = e.typeId;
  if (id === 'mite') {
    c.fillStyle = 'rgba(43,26,16,0.4)';
    c.beginPath(); c.arc(-rx * 0.3, -ry * 0.2, 1.6, 0, TAU); c.fill();
    c.beginPath(); c.arc(0, ry * 0.3, 1.4, 0, TAU); c.fill();
  } else if (id === 'gnat') {
    c.strokeStyle = dark;
    c.lineWidth = 1.8;
    c.beginPath(); c.moveTo(rx * 1.05, 0); c.lineTo(rx * 1.55, 0); c.stroke(); // proboscis needle
    c.strokeStyle = INK;
  } else if (id === 'hopper') {
    // folded jumping haunches
    c.strokeStyle = INK;
    c.lineWidth = 3.2;
    for (let side = -1; side <= 1; side += 2) {
      c.beginPath();
      c.moveTo(-rx * 0.5, side * ry * 0.4);
      c.lineTo(-rx * 0.95, side * (ry + 4));
      c.lineTo(-rx * 0.35, side * (ry + 6.5));
      c.stroke();
    }
    c.lineWidth = 2.4;
  } else if (id === 'moth') {
    // feathered antennae
    c.strokeStyle = INK;
    c.lineWidth = 1.4;
    for (let side = -1; side <= 1; side += 2) {
      for (let f = 0; f < 3; f++) {
        c.beginPath();
        c.moveTo(rx * (1.15 + f * 0.12), side * ry * (0.4 + f * 0.12));
        c.lineTo(rx * (1.3 + f * 0.12), side * ry * (0.62 + f * 0.12));
        c.stroke();
      }
    }
  } else if (id === 'stagBeetle') {
    // glossy elytra split line + wide pronotum ridge
    c.strokeStyle = 'rgba(16,8,4,0.85)';
    c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(-rx * 0.95, 0); c.lineTo(rx * 0.45, 0); c.stroke();
    c.beginPath(); c.ellipse(rx * 0.5, 0, rx * 0.1, ry * 0.9, 0, 0, TAU); c.stroke();
    // hard-shine lacquer streak
    c.fillStyle = 'rgba(255,255,255,0.22)';
    c.beginPath(); c.ellipse(-rx * 0.25, -ry * 0.4, rx * 0.45, ry * 0.16, -0.15, 0, TAU); c.fill();
    c.strokeStyle = INK;
  } else if (id === 'wasp') {
    // stinger + pinched waist
    c.fillStyle = INK;
    c.beginPath();
    c.moveTo(-rx - 4.5, 0); c.lineTo(-rx + 1, -2.4); c.lineTo(-rx + 1, 2.4); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(43,26,16,0.55)';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(rx * 0.35, -ry * 0.8); c.lineTo(rx * 0.35, ry * 0.8); c.stroke();
    c.strokeStyle = INK;
  } else if (t.shell) {
    // snail eye stalks
    c.strokeStyle = INK;
    c.lineWidth = 1.8;
    for (let side = -1; side <= 1; side += 2) {
      c.beginPath();
      c.moveTo(rx * 0.9, side * ry * 0.25);
      c.lineTo(rx * 1.35, side * ry * 0.7);
      c.stroke();
      c.fillStyle = dark;
      c.beginPath(); c.arc(rx * 1.35, side * ry * 0.7, 1.8, 0, TAU); c.fill();
    }
  } else if (t.plates) {
    // pillbug plate rivets
    c.fillStyle = 'rgba(43,26,16,0.5)';
    for (let i = -1; i <= 1; i++) {
      c.beginPath(); c.arc(i * rx * 0.42, -ry * 0.55, 1.2, 0, TAU); c.fill();
      c.beginPath(); c.arc(i * rx * 0.42, ry * 0.55, 1.2, 0, TAU); c.fill();
    }
  }

  // chitin texture + rim light on the lit side
  stampNoise(c, rx, ry);
  c.strokeStyle = 'rgba(255,255,255,0.35)';
  c.lineWidth = 1.5;
  c.beginPath();
  c.ellipse(0, 0, rx - 1.6, ry - 1.6, 0, Math.PI * 1.05, Math.PI * 1.7);
  c.stroke();

  // specular glint
  c.fillStyle = 'rgba(255,255,255,0.3)';
  c.beginPath();
  c.ellipse(-rx * 0.3, -ry * 0.45, rx * 0.22, ry * 0.14, -0.5, 0, TAU);
  c.fill();

  // outline, hand-weighted: heavier on the shadow side
  c.strokeStyle = INK;
  c.lineWidth = 2.6;
  if (e.camo) c.setLineDash([6, 4]);
  c.beginPath();
  c.ellipse(0, 0, rx, ry, 0, 0, TAU);
  c.stroke();
  c.lineWidth = 4;
  c.beginPath();
  c.ellipse(0, 0, rx, ry, 0, 0.4, Math.PI - 0.4);
  c.stroke();
  c.setLineDash([]);

  // head
  c.save();
  c.translate(rx * 0.85, 0);
  c.fillStyle = bodyGrad(c, dark, mixHex(dark, '#100804', 0.55), ry * 0.5);
  c.beginPath();
  c.arc(0, 0, ry * 0.5, 0, TAU);
  c.fill();
  c.lineWidth = 2.6;
  c.stroke();
  c.restore();

  // stag beetle: huge branched antler mandibles reaching ahead
  if (id === 'stagBeetle') {
    c.strokeStyle = '#241407';
    c.lineJoin = 'round';
    for (let side = -1; side <= 1; side += 2) {
      c.lineWidth = 4.2;
      c.beginPath(); // main antler beam curving inward
      c.moveTo(rx * 0.95, side * ry * 0.3);
      c.quadraticCurveTo(rx * 1.55, side * ry * 0.75, rx * 1.95, side * ry * 0.28);
      c.stroke();
      c.lineWidth = 2.6;
      c.beginPath(); // inner tine
      c.moveTo(rx * 1.45, side * ry * 0.62);
      c.lineTo(rx * 1.62, side * ry * 0.18);
      c.stroke();
      c.beginPath(); // tip barb
      c.moveTo(rx * 1.95, side * ry * 0.28);
      c.lineTo(rx * 2.1, side * ry * 0.02);
      c.stroke();
    }
    c.strokeStyle = INK;
    c.lineWidth = 1.4;
    for (let side = -1; side <= 1; side += 2) {
      c.beginPath(); // ink edge for the cartoon read
      c.moveTo(rx * 0.95, side * ry * 0.3);
      c.quadraticCurveTo(rx * 1.55, side * ry * 0.75, rx * 1.95, side * ry * 0.28);
      c.stroke();
    }
    c.lineWidth = 2.4;
  }

  // weevil snout
  if (t.snout) {
    c.strokeStyle = dark;
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(rx * 1.1, 0);
    c.lineTo(rx * 1.6, 0);
    c.stroke();
    c.strokeStyle = INK; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(rx * 1.1, 0); c.lineTo(rx * 1.6, 0); c.stroke();
  }

  // eyes — bosses get bigger DARK compound eyes with a faint menacing ember + angry brow
  if (t.boss) {
    const ex = rx * 0.95, ey = ry * 0.26, er = 3.6;
    for (let side = -1; side <= 1; side += 2) {
      c.fillStyle = '#160b06'; // dark compound eye (menace comes from the brow, not a glow)
      c.beginPath(); c.ellipse(ex, side * ey, er * 0.82, er, 0, 0, TAU); c.fill();
      c.strokeStyle = INK; c.lineWidth = 1.2; c.stroke();
      c.fillStyle = 'rgba(208,48,24,0.5)'; // faint ember deep inside
      c.beginPath(); c.arc(ex + 0.5, side * ey, er * 0.42, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.4)'; // reflective glint
      c.beginPath(); c.arc(ex - 0.7, side * ey - er * 0.4, er * 0.26, 0, TAU); c.fill();
    }
    // angry brow ridges — menace via shape, not glow
    c.strokeStyle = INK; c.lineWidth = 2.4;
    c.beginPath(); c.moveTo(rx * 0.7, -ey - er); c.lineTo(rx * 1.05, -ey + 1); c.stroke();
    c.beginPath(); c.moveTo(rx * 0.7, ey + er); c.lineTo(rx * 1.05, ey - 1); c.stroke();
  } else {
    // dark compound eyes on the head sides — matches the ants, no more cartoon pupils
    const er = Math.min(3, Math.max(1.7, ry * 0.26));
    for (let side = -1; side <= 1; side += 2) {
      const ex = rx * 0.96, ey = side * ry * 0.22;
      c.fillStyle = '#180d07';
      c.beginPath(); c.ellipse(ex, ey, er * 0.85, er, 0, 0, TAU); c.fill();
      c.strokeStyle = INK; c.lineWidth = 0.9; c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.5)';
      c.beginPath(); c.arc(ex - 0.7, ey - er * 0.4, er * 0.3, 0, TAU); c.fill();
    }
  }
  // hornet queen's crown
  if (id === 'hornetQueen') {
    c.fillStyle = '#ffd24a';
    c.strokeStyle = INK;
    c.lineWidth = 2;
    const cy = -ry * 0.62;
    c.beginPath();
    c.moveTo(rx * 0.55, cy + 5);
    c.lineTo(rx * 0.6, cy - 5); c.lineTo(rx * 0.78, cy + 1);
    c.lineTo(rx * 0.95, cy - 7); c.lineTo(rx * 1.12, cy + 1);
    c.lineTo(rx * 1.3, cy - 5); c.lineTo(rx * 1.35, cy + 5);
    c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#e2472f';
    c.beginPath(); c.arc(rx * 0.95, cy - 2, 1.8, 0, TAU); c.fill();
  }

  // antennae
  c.strokeStyle = INK;
  c.lineWidth = 2;
  for (let side = -1; side <= 1; side += 2) {
    c.beginPath();
    c.moveTo(rx * 0.95, side * ry * 0.3);
    c.quadraticCurveTo(rx * 1.4, side * ry * 0.8, rx * 1.55, side * ry * 0.55);
    c.stroke();
  }
}

export function drawSnailShell(c, e) {
  const r = e.type.radius;
  c.fillStyle = bodyGrad(c, '#8a5a33', '#4a2c10', r * 0.95);
  c.strokeStyle = INK;
  c.lineWidth = 3;
  c.beginPath();
  c.arc(-r * 0.5, -r * 0.35, r * 0.95, 0, TAU);
  c.fill(); c.stroke();
  c.strokeStyle = '#5e3a17';
  c.lineWidth = 2.5;
  c.beginPath();
  c.arc(-r * 0.5, -r * 0.35, r * 0.6, 0.6, 0.6 + TAU * 0.8);
  c.stroke();
  c.beginPath();
  c.arc(-r * 0.5, -r * 0.35, r * 0.3, 2.4, 2.4 + TAU * 0.7);
  c.stroke();
  // polished-shell glint on the lit shoulder
  c.fillStyle = 'rgba(255,244,214,0.4)';
  c.beginPath();
  c.ellipse(-r * 0.85, -r * 0.72, r * 0.26, r * 0.14, -0.6, 0, TAU);
  c.fill();
}

export function drawStatusFx(c, e, time) {
  const r = e.type.radius;
  // silk slow wrap
  if (e.slowPct > 0 && e.slowT_active) {
    c.strokeStyle = 'rgba(238,246,244,0.85)';
    c.lineWidth = 2.5;
    for (let i = -1; i <= 1; i++) {
      c.beginPath();
      c.moveTo(-r, i * r * 0.4 - 2);
      c.lineTo(r, i * r * 0.4 + 2);
      c.stroke();
    }
  }
  // burn
  if (e.burn_active) {
    c.fillStyle = 'rgba(255,140,40,0.9)';
    for (let i = 0; i < 3; i++) {
      const fx = Math.sin(time * 20 + i * 2.4 + e.phase) * r * 0.4;
      const fh = 5 + Math.sin(time * 26 + i * 3.1) * 2.5;
      c.beginPath();
      c.moveTo(fx - 3, -r * 0.2);
      c.quadraticCurveTo(fx, -r * 0.2 - fh * 2, fx + 3, -r * 0.2);
      c.fill();
    }
  }
  // stun stars
  if (e.stun_active) {
    c.fillStyle = '#ffe14d';
    for (let i = 0; i < 2; i++) {
      const a = time * 7 + i * Math.PI;
      c.beginPath();
      c.arc(Math.cos(a) * r * 0.9, -r - 6 + Math.sin(a) * 3, 3, 0, TAU);
      c.fill();
    }
  }
}

export function drawHpBar(c, x, y, w, frac) {
  c.fillStyle = INK;
  rr(c, x - w / 2 - 1.5, y - 1.5, w + 3, 8, 3);
  c.fill();
  const col = frac > 0.5 ? '#63c840' : frac > 0.25 ? '#f2c230' : '#e2472f';
  c.fillStyle = col;
  if (w * frac > 2) { rr(c, x - w / 2, y, w * frac, 5, 2); c.fill(); }
}
