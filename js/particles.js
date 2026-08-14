// ===== Pooled juice: shards, rings, floating text, tracers =====
import { TAU } from './util.js';

const MAX = 1400;
const pool = [];
for (let i = 0; i < MAX; i++) pool.push({ active: false });
let cursor = 0;

// reduced-flash accessibility setting: strobing white flashes draw far dimmer
let reducedFx = false;
export function setReducedFx(v) { reducedFx = !!v; }

function take() {
  for (let i = 0; i < MAX; i++) {
    cursor = (cursor + 1) % MAX;
    if (!pool[cursor].active) return pool[cursor];
  }
  return null;
}

function spawn(props) {
  const p = take();
  if (!p) return;
  p.kind = 'shard'; p.x = 0; p.y = 0; p.vx = 0; p.vy = 0;
  p.life = 0.4; p.age = 0; p.size = 3; p.color = '#fff';
  p.text = ''; p.x2 = 0; p.y2 = 0; p.r = 6; p.grow = 0; p.gravity = 0;
  p.rot = 0; p.vr = 0;
  Object.assign(p, props);
  p.active = true;
}

// pre-rendered warm glow sprite for additive explosion light (shadowBlur is a frame-killer)
let glowSprite = null;
function getGlow() {
  if (glowSprite) return glowSprite;
  glowSprite = document.createElement('canvas');
  glowSprite.width = glowSprite.height = 64;
  const g = glowSprite.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,220,150,1)');
  grad.addColorStop(0.4, 'rgba(255,160,60,0.55)');
  grad.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return glowSprite;
}

export function explosionFx(x, y, blast) {
  spawn({ kind: 'flash', x, y, r: blast * 0.7, life: 0.08 });
  spawn({ kind: 'glow', x, y, size: blast * 3.2, life: 0.32 });
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * TAU;
    spawn({
      kind: 'smoke', x: x + Math.cos(a) * blast * 0.3, y: y + Math.sin(a) * blast * 0.3,
      vx: Math.cos(a) * 26, vy: Math.sin(a) * 26 - 34,
      life: 0.6 + Math.random() * 0.35, size: 7 + Math.random() * 7, gravity: -40,
    });
  }
}

// spinning shell pieces — the bug leaves wreckage, not just dust
export function burstChunks(x, y, color, n = 3) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const s = 70 + Math.random() * 110;
    spawn({
      kind: 'chunk', x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120,
      life: 0.5 + Math.random() * 0.3,
      size: 3.5 + Math.random() * 3.5,
      color, gravity: 460,
      rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 16,
    });
  }
}

export function burst(x, y, color, n = 6, speed = 100) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const s = speed * (0.4 + Math.random() * 0.9);
    spawn({ kind: 'shard', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30, life: 0.3 + Math.random() * 0.25, size: 2 + Math.random() * 3.4, color, gravity: 260 });
  }
}
export function ring(x, y, color, r = 10, grow = 220, life = 0.28) {
  spawn({ kind: 'ring', x, y, r, grow, life, color });
}
export function textPop(x, y, text, color = '#fff', size = 15) {
  spawn({ kind: 'text', x, y, vy: -42, text, color, life: 1.0, size });
}
export function tracer(x, y, x2, y2, color = '#d3ff5e') {
  spawn({ kind: 'line', x, y, x2, y2, color, life: 0.1, size: 2.5 });
}
export function slashFx(x, y, r, color = '#fff') {
  spawn({ kind: 'ring', x, y, r: r * 0.4, grow: r * 2.2, life: 0.16, color });
}
// the satisfying "pop": a quick small flash + a snappy white ring, plus colored splatter for big bugs
export function popFx(x, y, color, radius, big) {
  spawn({ kind: 'flash', x, y, r: radius * 1.0 + 3, life: 0.07 });
  spawn({ kind: 'ring', x, y, r: radius * 0.5, grow: radius * 2.2 + 22, life: 0.2, color: '#ffffff' });
  if (big) {
    spawn({ kind: 'ring', x, y, r: radius * 0.4, grow: radius * 1.8 + 36, life: 0.34, color });
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * TAU, d = radius * (0.3 + Math.random() * 0.8);
      spawn({ kind: 'splat', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, size: 2.5 + Math.random() * 3.5, color, rot: Math.random() * TAU, life: 0.5 + Math.random() * 0.45 });
    }
  }
}

export function updateParticles(dt) {
  if (dt <= 0) return;
  for (const p of pool) {
    if (!p.active) continue;
    p.age += dt;
    if (p.age >= p.life) { p.active = false; continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.gravity) p.vy += p.gravity * dt;
    if (p.kind === 'ring') p.r += p.grow * dt;
    if (p.kind === 'chunk') p.rot += p.vr * dt;
  }
}

export function drawParticles(ctx) {
  for (const p of pool) {
    if (!p.active) continue;
    const k = 1 - p.age / p.life;
    ctx.globalAlpha = k;
    if (p.kind === 'shard') {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + k * 0.5), 0, TAU);
      ctx.fill();
    } else if (p.kind === 'chunk') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = '#2b1a10';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.62, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else if (p.kind === 'ring') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 3 * k + 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.stroke();
    } else if (p.kind === 'text') {
      ctx.font = `800 ${p.size}px 'Baloo 2', 'Trebuchet MS', sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#2b1a10';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    } else if (p.kind === 'smoke') {
      ctx.fillStyle = `rgba(90,74,60,${0.35 * k})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1.4 - k * 0.4), 0, TAU);
      ctx.fill();
    } else if (p.kind === 'splat') {
      ctx.globalAlpha = k * 0.85;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.size, p.size * 0.7, p.rot, 0, TAU);
      ctx.fill();
    } else if (p.kind === 'line') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x2, p.y2);
      ctx.stroke();
    }
  }
  // additive pass: fire light on top
  ctx.globalCompositeOperation = 'lighter';
  for (const p of pool) {
    if (!p.active) continue;
    const k = 1 - p.age / p.life;
    if (p.kind === 'flash') {
      ctx.globalAlpha = k * (reducedFx ? 0.3 : 0.9);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1 + (1 - k) * 0.5), 0, TAU);
      ctx.fill();
    } else if (p.kind === 'glow') {
      ctx.globalAlpha = k;
      const s = p.size * (0.7 + (1 - k) * 0.5);
      ctx.drawImage(getGlow(), p.x - s / 2, p.y - s / 2, s, s);
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

export function resetParticles() {
  for (const p of pool) p.active = false;
}
