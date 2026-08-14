export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function dist2(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}
export function dist(ax, ay, bx, by) {
  return Math.sqrt(dist2(ax, ay, bx, by));
}

// point-to-segment distance
export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return dist(px, py, ax + dx * t, ay + dy * t);
}

// deterministic rng for map decoration
export function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build a walkable path from waypoints: cumulative segment table.
export function buildPath(points) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const len = dist(ax, ay, bx, by);
    segs.push({ ax, ay, dx: (bx - ax) / len, dy: (by - ay) / len, len, start: total });
    total += len;
  }
  return { points, segs, length: total };
}

// Position at distance d along the path. segHint speeds up repeated lookups.
export function posAt(path, d, out, segHint = 0) {
  const segs = path.segs;
  if (d <= 0) {
    const s = segs[0];
    out.x = s.ax + s.dx * d; out.y = s.ay + s.dy * d;
    out.angle = Math.atan2(s.dy, s.dx);
    out.seg = 0;
    return out;
  }
  let i = clamp(segHint, 0, segs.length - 1);
  while (i > 0 && d < segs[i].start) i--;
  while (i < segs.length - 1 && d > segs[i].start + segs[i].len) i++;
  const s = segs[i];
  const local = d - s.start;
  out.x = s.ax + s.dx * local;
  out.y = s.ay + s.dy * local;
  out.angle = Math.atan2(s.dy, s.dx);
  out.seg = i;
  return out;
}

export function distToPath(path, x, y) {
  let best = Infinity;
  const pts = path.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = segDist(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}

// shift a #rrggbb hue/lightness slightly — used so swarms don't look photocopied
export function jitterColor(hex, dh, dl) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d > 0) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  h = (h + dh / 360 + 1) % 1;
  const l2 = clamp(l + dl / 100, 0, 1);
  const q = l2 < 0.5 ? l2 * (1 + s) : l2 + s - l2 * s;
  const p = 2 * l2 - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const to = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(f(h + 1 / 3))}${to(f(h))}${to(f(h - 1 / 3))}`;
}

export function fmt(n) {
  n = Math.floor(n);
  return n >= 100000 ? (n / 1000).toFixed(0) + 'k' : n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}
