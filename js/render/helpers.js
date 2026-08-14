// ===== Shared render helpers: ink color, cached gradients, chitin-noise, rounded rects. =====
import { TAU } from '../util.js';

export const INK = '#2b1a10';

// ---- lighting: cached radial gradients give every body a lit, rounded look ----
const gradCache = new Map();

export function mixHex(hex, target, t) {
  const p = (i) => parseInt(hex.slice(i, i + 2), 16);
  const q = (i) => parseInt(target.slice(i, i + 2), 16);
  const to = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${to(p(1) + (q(1) - p(1)) * t)}${to(p(3) + (q(3) - p(3)) * t)}${to(p(5) + (q(5) - p(5)) * t)}`;
}

// top-left key light -> base -> shadowed underside (hue kept by authored dark colors)
export function bodyGrad(c, fill, dark, r) {
  const rb = Math.max(6, Math.round(r / 3) * 3);
  const key = `${fill}|${dark}|${rb}`;
  let g = gradCache.get(key);
  if (!g) {
    g = c.createRadialGradient(-rb * 0.4, -rb * 0.45, rb * 0.12, 0, 0, rb * 1.6);
    g.addColorStop(0, mixHex(fill, '#ffffff', 0.4));
    g.addColorStop(0.45, fill);
    g.addColorStop(1, dark);
    gradCache.set(key, g);
  }
  return g;
}

// pre-rendered elliptical chitin-noise sprites, composited soft-light onto bodies
const noiseSprites = new Map();
export function noiseSprite(r) {
  const rb = Math.min(40, Math.max(8, Math.round(r / 4) * 4));
  let cv = noiseSprites.get(rb);
  if (!cv) {
    cv = document.createElement('canvas');
    const w = rb * 3, h = Math.ceil(rb * 2.2);
    cv.width = w; cv.height = h;
    const n = cv.getContext('2d');
    for (let i = 0; i < rb * 14; i++) {
      n.fillStyle = i % 2 ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
      n.beginPath();
      n.arc(Math.random() * w, Math.random() * h, 0.6 + Math.random() * 1.1, 0, TAU);
      n.fill();
    }
    n.globalCompositeOperation = 'destination-in';
    n.beginPath();
    n.ellipse(w / 2, h / 2, w / 2 - 1, h / 2 - 1, 0, 0, TAU);
    n.fill();
    noiseSprites.set(rb, cv);
  }
  return cv;
}

export function stampNoise(c, rx, ry, alpha = 0.16) {
  const sp = noiseSprite(ry);
  c.save();
  c.globalAlpha = alpha;
  c.globalCompositeOperation = 'soft-light';
  c.drawImage(sp, -rx, -ry, rx * 2, ry * 2);
  c.restore();
}

export function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
