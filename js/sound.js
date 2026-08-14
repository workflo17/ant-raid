// ===== WebAudio SFX: synth + a self-authored SAMPLE BANK through a real acoustic space =====
// Craft chain (v14): every voice runs dry into the master DynamicsCompressor AND through a
// convolution-reverb send (synthetic 2s impulse response) — SFX ≈80/20 dry/wet, music ≈65/35.
// The hot one-shots (pops, thumps, cracks, whooshes) are pre-rendered at init into
// AudioBuffers via OfflineAudioContext and played back with ±8% playbackRate jitter:
// this IS sampled playback — the samples just happen to be authored in-house at boot.

let ctx = null;
let master = null;
let comp = null;      // master DynamicsCompressor: glues SFX + music, stops swarm clipping
let convolver = null; // shared reverb tail (send bus)
let revReturn = null;
let sfxSend = null;   // master -> reverb send (SFX wet amount)
let muted = false;
const lastPlayed = {}; // per-key throttle
const bank = {};       // name -> AudioBuffer (pre-rendered one-shot "samples")
let bankBuilt = false;

// Real recorded foley (Kenney "Impact Sounds", CC0 — assets/sfx/): preferred over the
// synth bank when decoded; browsers that can't decode ogg (Safari) fall back seamlessly.
const FOLEY = { pop_small: 3, pop_mid: 3, pop_big: 3, snap: 2, clink: 2, splat: 2, place: 3, thud: 2, bell: 1 };
const foley = {}; // name -> AudioBuffer[] (variants; random pick per play)
let foleyLoaded = 0, foleyTotal = 0, foleyStarted = false;

function loadFoley(c) {
  if (foleyStarted) return;
  foleyStarted = true;
  for (const [name, count] of Object.entries(FOLEY)) {
    foley[name] = [];
    for (let i = 0; i < count; i++) {
      foleyTotal++;
      fetch(`assets/sfx/${name}_${i}.ogg`)
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('missing'))))
        .then(ab => c.decodeAudioData(ab))
        .then(buf => { foley[name].push(buf); foleyLoaded++; })
        .catch(() => { /* synth bank covers it */ });
    }
  }
}

// synthetic room: 2s of stereo noise, exponentially decaying, with a one-pole lowpass
// that closes over time so the tail darkens like a real space
function buildImpulse(c) {
  const dur = 2.0, sr = c.sampleRate, len = (sr * dur) | 0;
  const buf = c.createBuffer(2, len, sr);
  for (let chn = 0; chn < 2; chn++) {
    const d = buf.getChannelData(chn);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const k = 0.35 - 0.28 * t; // filter coefficient shrinks -> darker tail
      lp += k * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - t, 2.6);
    }
  }
  return buf;
}

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 24;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    comp.connect(ctx.destination);
    // convolution reverb as a send bus: dry stays intact, the room rides on top
    convolver = ctx.createConvolver();
    convolver.buffer = buildImpulse(ctx);
    revReturn = ctx.createGain();
    revReturn.gain.value = 1;
    convolver.connect(revReturn).connect(comp);
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.45;
    master.connect(comp);
    sfxSend = ctx.createGain();
    sfxSend.gain.value = 0.25; // ≈80/20 dry/wet for SFX
    master.connect(sfxSend).connect(convolver);
    buildBank();
    loadFoley(ctx);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function unlockAudio() { ac(); }
export function audioCtx() { return ac(); }
// music routes its gain through the same master compressor
export function masterBus() { ac(); return comp; }
// music sends a wetter share (≈65/35) into the same room
export function reverbBus() { ac(); return convolver; }

// verification / instrumentation: what the audio graph actually holds right now
export function soundState() {
  return {
    ctx: !!ctx,
    reverb: !!(convolver && convolver.buffer),
    irSeconds: convolver && convolver.buffer ? +convolver.buffer.duration.toFixed(2) : 0,
    sfxWet: sfxSend ? +sfxSend.gain.value.toFixed(2) : 0,
    bank: Object.keys(bank).sort(),
    bankReady: Object.keys(bank).length >= 8,
    foley: `${foleyLoaded}/${foleyTotal}`,
    foleySlots: Object.entries(foley).filter(([, v]) => v.length).map(([k, v]) => `${k}×${v.length}`),
  };
}

let sfxVol = 0.7;
export function setSfxVolume(v) {
  sfxVol = Math.max(0, Math.min(1, v));
  if (master && !muted) master.gain.value = 0.65 * sfxVol;
}
export function getSfxVolume() { return sfxVol; }

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.65 * sfxVol;
}
export function isMuted() { return muted; }

function throttled(key, minGap) {
  const now = performance.now();
  if (lastPlayed[key] && now - lastPlayed[key] < minGap) return true;
  lastPlayed[key] = now;
  return false;
}

function tone(freq, dur, { type = 'square', vol = 0.15, slide = 0, delay = 0 } = {}) {
  const c = ac();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

let noiseBuf = null;
function noise(dur, { vol = 0.2, freq = 2000, delay = 0 } = {}) {
  const c = ac();
  if (!c || muted) return;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// ---------- the pre-rendered sample bank ----------

// offline mirror of tone(): pitch-enveloped oscillator straight to the offline destination
function oTone(oc, freq, dur, { type = 'sine', vol = 0.3, slide = 0, at = 0 } = {}) {
  const o = oc.createOscillator();
  const g = oc.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), at + dur);
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  o.connect(g).connect(oc.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

// offline filtered-noise burst (lowpass / highpass / bandpass)
function oNoise(oc, dur, { vol = 0.3, type = 'lowpass', freq = 2000, q = 0.8, at = 0 } = {}) {
  const len = Math.ceil(oc.sampleRate * dur);
  const nb = oc.createBuffer(1, len, oc.sampleRate);
  const d = nb.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = oc.createBufferSource();
  src.buffer = nb;
  const f = oc.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = oc.createGain();
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  src.connect(f).connect(g).connect(oc.destination);
  src.start(at);
  src.stop(at + dur);
}

function renderSample(name, dur, build) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC || !ctx) return;
  const sr = ctx.sampleRate;
  const oc = new OAC(1, Math.ceil(sr * dur), sr);
  build(oc);
  oc.startRendering().then(buf => { bank[name] = buf; }).catch(() => { /* keep synth fallback */ });
}

// 8 one-shots rendered once at init — until each lands, callers fall back to live synth
function buildBank() {
  if (bankBuilt || !ctx) return;
  bankBuilt = true;
  // pops: pitch-enveloped sine body + a noise crunch, three sizes
  renderSample('pop_small', 0.16, oc => {
    oTone(oc, 950, 0.11, { type: 'sine', vol: 0.5, slide: -620 });
    oTone(oc, 1500, 0.05, { type: 'triangle', vol: 0.18, slide: -600 });
    oNoise(oc, 0.07, { vol: 0.4, type: 'highpass', freq: 2400 });
  });
  renderSample('pop_mid', 0.2, oc => {
    oTone(oc, 520, 0.15, { type: 'sine', vol: 0.55, slide: -340 });
    oNoise(oc, 0.1, { vol: 0.42, type: 'bandpass', freq: 1700, q: 0.9 });
  });
  renderSample('pop_big', 0.34, oc => {
    oTone(oc, 250, 0.28, { type: 'sine', vol: 0.6, slide: -170 });
    oTone(oc, 125, 0.3, { type: 'triangle', vol: 0.3, slide: -60 });
    oNoise(oc, 0.2, { vol: 0.4, type: 'lowpass', freq: 900 });
  });
  // thump: kick drum — click transient + a 150→58Hz body drop
  renderSample('thump', 0.32, oc => {
    oNoise(oc, 0.02, { vol: 0.5, type: 'highpass', freq: 1500 });
    oTone(oc, 150, 0.3, { type: 'sine', vol: 0.9, slide: -92 });
  });
  // snap: band-passed noise crack over a low knuckle
  renderSample('snap', 0.12, oc => {
    oNoise(oc, 0.05, { vol: 0.85, type: 'bandpass', freq: 2900, q: 3.5 });
    oNoise(oc, 0.1, { vol: 0.3, type: 'bandpass', freq: 900, q: 1.5 });
    oTone(oc, 210, 0.07, { type: 'triangle', vol: 0.25, slide: -80 });
  });
  // chime: 2-op FM bell (inharmonic 1.4 ratio, modulation index decays)
  renderSample('chime', 0.9, oc => {
    const car = oc.createOscillator();
    const mod = oc.createOscillator();
    const mg = oc.createGain();
    const g = oc.createGain();
    car.frequency.value = 880;
    mod.frequency.value = 880 * 1.4;
    mg.gain.setValueAtTime(620, 0);
    mg.gain.exponentialRampToValueAtTime(1, 0.85);
    mod.connect(mg).connect(car.frequency);
    g.gain.setValueAtTime(0.5, 0);
    g.gain.exponentialRampToValueAtTime(0.001, 0.85);
    car.connect(g).connect(oc.destination);
    car.start(0); mod.start(0);
    car.stop(0.9); mod.stop(0.9);
  });
  // whoosh: band-swept noise 300→2400Hz
  renderSample('whoosh', 0.42, oc => {
    const len = Math.ceil(oc.sampleRate * 0.4);
    const nb = oc.createBuffer(1, len, oc.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = oc.createBufferSource();
    src.buffer = nb;
    const f = oc.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, 0);
    f.frequency.exponentialRampToValueAtTime(2400, 0.34);
    const g = oc.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.exponentialRampToValueAtTime(0.65, 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, 0.4);
    src.connect(f).connect(g).connect(oc.destination);
    src.start(0);
  });
  // splat: wet low crunch with a mid flick
  renderSample('splat', 0.26, oc => {
    oNoise(oc, 0.18, { vol: 0.7, type: 'lowpass', freq: 750 });
    oTone(oc, 240, 0.2, { type: 'triangle', vol: 0.4, slide: -165 });
    oNoise(oc, 0.05, { vol: 0.3, type: 'bandpass', freq: 1900, q: 2, at: 0.02 });
  });
}

// sampled playback: ±8% rate jitter by default so repeats never sound photocopied.
// Returns false if the sample isn't rendered yet — caller falls back to live synth.
function playSample(name, { vol = 0.2, rate = 1, jitter = 0.08, delay = 0 } = {}) {
  const c = ac();
  if (!c) return false;
  if (muted) return true; // handled (silently)
  // real foley first (random variant), then the synth-rendered bank
  const fl = foley[name];
  const buf = (fl && fl.length) ? fl[(Math.random() * fl.length) | 0] : bank[name];
  if (!buf) return false;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * jitter);
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(g).connect(master);
  src.start(c.currentTime + delay);
  return true;
}

// scheduled sample playback for the music sequencer (dest = the music gain, so the
// music mute/volume and its own reverb send apply; no jitter — the groove stays tight)
export function playSampleAt(name, when, vol = 0.3, rate = 1, dest = null) {
  const c = ac();
  if (!c) return false;
  const buf = bank[name];
  if (!buf) return false;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(g).connect(dest || master);
  src.start(when);
  return true;
}

export const sfx = {
  shoot() { if (throttled('shoot', 40)) return; tone(760 + Math.random() * 120, 0.05, { type: 'square', vol: 0.04, slide: -200 }); },
  snap() {
    if (throttled('snap', 60)) return;
    if (playSample('snap', { vol: 0.2 })) { tone(180, 0.05, { type: 'square', vol: 0.04, slide: -60 }); return; }
    noise(0.05, { vol: 0.12, freq: 3200 }); tone(180, 0.06, { type: 'square', vol: 0.08, slide: -60 });
  },
  snipe() { if (throttled('snipe', 60)) return; tone(1400, 0.08, { type: 'sawtooth', vol: 0.06, slide: -900 }); },
  lob() {
    if (throttled('lob', 80)) return;
    if (playSample('whoosh', { vol: 0.12, rate: 1.1 })) return;
    tone(300, 0.12, { type: 'sine', vol: 0.07, slide: 160 });
  },
  silk() { if (throttled('silk', 60)) return; tone(520, 0.09, { type: 'triangle', vol: 0.06, slide: 180 }); },
  // pitch tracks bug size: mite = high plink, big shells = lower thunk
  pop(radius = 12) {
    if (throttled('pop', 30)) return;
    const name = radius < 12 ? 'pop_small' : radius < 17 ? 'pop_mid' : 'pop_big';
    if (playSample(name, { vol: 0.22, rate: Math.max(0.7, 1 + (12 - radius) * 0.012) })) {
      const f = Math.max(220, 700 - radius * 18);
      tone(f + Math.random() * f * 0.35, 0.05, { type: 'triangle', vol: 0.04, slide: -f * 0.5 });
      return;
    }
    const f = Math.max(220, 700 - radius * 18); // synth fallback while the bank renders
    noise(0.06, { vol: 0.16, freq: Math.max(1200, 3400 - radius * 90) });
    tone(f + Math.random() * f * 0.35, 0.06, { type: 'triangle', vol: 0.1, slide: -Math.max(140, f * 0.55) });
  },
  clink() {
    if (throttled('clink', 90)) return;
    if (playSample('clink', { vol: 0.14, rate: 1.2 })) return; // real glass ping off the armor
    tone(1900, 0.05, { type: 'square', vol: 0.05, slide: -80 });
  },
  boom() {
    if (throttled('boom', 70)) return;
    if (playSample('thump', { vol: 0.4, rate: 0.7 })) {
      playSample('splat', { vol: 0.25, rate: 0.8, delay: 0.02 });
      tone(70, 0.3, { type: 'sine', vol: 0.12, slide: -35 });
      return;
    }
    noise(0.28, { vol: 0.3, freq: 700 }); tone(70, 0.3, { type: 'sine', vol: 0.22, slide: -35 });
  },
  // boss pops thump deeper the bigger the boss (stag r24 → queen r28)
  bigPop(radius = 24) {
    if (playSample('pop_big', { vol: 0.45, rate: Math.max(0.55, 1.25 - radius * 0.025) })) {
      playSample('thump', { vol: 0.35, rate: 0.8 });
      return;
    }
    const f = Math.max(58, 175 - radius * 2.6);
    noise(0.4, { vol: 0.32, freq: Math.max(500, 1250 - radius * 12) });
    tone(f, 0.38, { type: 'sawtooth', vol: 0.17, slide: -f * 0.55 });
  },
  leak() {
    if (throttled('leak', 120)) return;
    playSample('thud', { vol: 0.22, rate: 0.9 }); // real wood thud under the alarm
    tone(160, 0.22, { type: 'sawtooth', vol: 0.14, slide: -90 });
  },
  buy() { tone(620, 0.07, { type: 'square', vol: 0.1 }); tone(930, 0.09, { type: 'square', vol: 0.1, delay: 0.06 }); },
  sell() { tone(700, 0.07, { type: 'square', vol: 0.1 }); tone(430, 0.1, { type: 'square', vol: 0.1, delay: 0.06 }); },
  upgrade() { tone(520, 0.08, { type: 'triangle', vol: 0.12 }); tone(780, 0.08, { type: 'triangle', vol: 0.12, delay: 0.07 }); tone(1040, 0.12, { type: 'triangle', vol: 0.12, delay: 0.14 }); },
  deny() { tone(200, 0.12, { type: 'sawtooth', vol: 0.1, slide: -60 }); },
  fanfare() {
    [523, 659, 784].forEach((f, i) => tone(f, 0.14, { type: 'triangle', vol: 0.14, delay: i * 0.09 }));
    playSample('bell', { vol: 0.12, rate: 1.3, delay: 0.27 }); // real bell on the button
  },
  // a real 4-phrase victory tune: I–IV–V–I arpeggios, walking bass, bell on the button
  win() {
    const B = 0.15;
    const mel = [
      [440, 0, 1], [554, 1, 1], [659, 2, 1], [880, 3, 2],      // bar 1: A-major climb
      [587, 6, 1], [740, 7, 1], [880, 8, 1], [1109, 9, 2],     // bar 2: IV lifts higher
      [988, 12, 1], [880, 13, 1], [740, 14, 1], [659, 15, 2],  // bar 3: V walks back down
      [880, 18, 3], [1109, 20, 1], [1319, 21, 4],              // bar 4: home + sparkle top
    ];
    for (const [f, at, d] of mel) tone(f, d * B * 1.15, { type: 'triangle', vol: 0.14, delay: at * B });
    for (const [f, at] of [[110, 0], [147, 6], [165, 12], [110, 18]]) {
      tone(f, B * 5.5, { type: 'square', vol: 0.09, delay: at * B });
    }
    playSample('thump', { vol: 0.25, rate: 1, jitter: 0, delay: 18 * B });
    playSample('chime', { vol: 0.2, rate: 1, jitter: 0, delay: 21 * B });
  },
  // 4-phrase lament: a minor descent over a drone that sags a half step and dies out
  lose() {
    const B = 0.18;
    const mel = [
      [440, 0, 2], [392, 2, 2], [349, 4, 2], [330, 6, 3],     // bars 1-2: the descent
      [349, 10, 1.5], [330, 11.5, 1.5], [294, 13, 3],         // bar 3: sighs lower
      [262, 17, 2], [247, 19, 4],                             // bar 4: sags, gives out
    ];
    for (const [f, at, d] of mel) tone(f, d * B * 1.1, { type: 'sawtooth', vol: 0.1, delay: at * B });
    tone(110, B * 12, { type: 'sawtooth', vol: 0.1, slide: -8 });
    tone(104, B * 10, { type: 'sawtooth', vol: 0.08, delay: B * 13, slide: -6 });
    playSample('splat', { vol: 0.2, rate: 0.7, jitter: 0, delay: B * 19 });
  },
  place() {
    if (playSample('place', { vol: 0.3 })) { tone(340, 0.06, { type: 'sine', vol: 0.07, slide: -80 }); return; } // boots on grass
    if (playSample('thump', { vol: 0.16, rate: 1.6 })) { tone(340, 0.06, { type: 'sine', vol: 0.08, slide: -80 }); return; }
    noise(0.05, { vol: 0.1, freq: 1200 }); tone(340, 0.08, { type: 'sine', vol: 0.12, slide: -80 });
  },
  coin() { if (throttled('coin', 90)) return; tone(1150 + Math.random() * 150, 0.06, { type: 'triangle', vol: 0.07, slide: 220 }); },
  // boss-specific stingers: stag = low brass blast, queen = two-chord menace
  horn(kind) {
    if (kind === 'stag') {
      tone(65, 0.85, { type: 'sawtooth', vol: 0.24, slide: -12 });
      tone(98, 0.85, { type: 'sawtooth', vol: 0.16, slide: -16, delay: 0.03 });
      tone(130, 0.5, { type: 'square', vol: 0.07, slide: -20, delay: 0.06 });
      noise(0.6, { vol: 0.14, freq: 350, delay: 0.04 });
      return;
    }
    if (kind === 'queen') {
      [98, 117, 147].forEach(f => tone(f, 0.5, { type: 'sawtooth', vol: 0.11 }));      // i chord…
      [104, 124, 156].forEach(f => tone(f, 0.95, { type: 'sawtooth', vol: 0.13, delay: 0.42 })); // …lurches a half step up
      noise(0.7, { vol: 0.12, freq: 500, delay: 0.42 });
      return;
    }
    tone(98, 0.7, { type: 'sawtooth', vol: 0.2, slide: -18 }); tone(147, 0.7, { type: 'sawtooth', vol: 0.14, slide: -22, delay: 0.05 }); noise(0.5, { vol: 0.12, freq: 500, delay: 0.05 });
  },
  stamp() { if (throttled('stamp', 300)) return; tone(90, 0.16, { type: 'sine', vol: 0.22, slide: -30 }); noise(0.08, { vol: 0.14, freq: 900 }); },
  // the iris breathes: a soft air-swipe closing, a lighter one opening
  iris() {
    if (playSample('whoosh', { vol: 0.15, rate: 1.2 })) return;
    noise(0.2, { vol: 0.08, freq: 900 }); tone(300, 0.18, { type: 'sine', vol: 0.04, slide: -140 });
  },
  irisOpen() {
    if (playSample('whoosh', { vol: 0.11, rate: 1.55 })) return;
    noise(0.16, { vol: 0.06, freq: 1300 }); tone(240, 0.16, { type: 'sine', vol: 0.035, slide: 160 });
  },
  // defeat: the color drains — one long low fall under the dusk wash
  drain() {
    if (playSample('whoosh', { vol: 0.2, rate: 0.5 })) { tone(196, 0.7, { type: 'sine', vol: 0.05, slide: -110 }); return; }
    tone(220, 0.8, { type: 'sine', vol: 0.08, slide: -140 }); noise(0.6, { vol: 0.05, freq: 500 });
  },
  // PERFECT ROUND jingle: rising gold arpeggio, crowned with the FM bell
  perfect() {
    [659, 784, 988, 1319].forEach((f, i) => tone(f, 0.16, { type: 'triangle', vol: 0.15, delay: i * 0.07 }));
    tone(1568, 0.32, { type: 'triangle', vol: 0.12, delay: 0.3 });
    playSample('chime', { vol: 0.15, rate: 2, jitter: 0, delay: 0.3 });
  },
  // the round's final bug pops: one satisfying deep-then-bright button
  lastPop() {
    if (playSample('splat', { vol: 0.35, rate: 0.9 })) { playSample('chime', { vol: 0.12, rate: 1.5, delay: 0.05 }); return; }
    noise(0.24, { vol: 0.26, freq: 1400 }); tone(290, 0.26, { type: 'triangle', vol: 0.16, slide: -180 }); tone(620, 0.14, { type: 'sine', vol: 0.1, slide: 260, delay: 0.04 });
  },
  // Sugar Decoy: tiny crystalline nibbles while bugs eat, a wet crumble when it goes
  nibble() {
    if (throttled('nibble', 160)) return;
    if (playSample('pop_small', { vol: 0.07, rate: 1.7 })) return;
    tone(900, 0.03, { type: 'triangle', vol: 0.03, slide: -300 });
  },
  crumble() {
    if (playSample('splat', { vol: 0.3 })) { playSample('pop_big', { vol: 0.2, rate: 1.3, delay: 0.03 }); return; }
    noise(0.2, { vol: 0.2, freq: 800 }); tone(180, 0.18, { type: 'triangle', vol: 0.12, slide: -90 });
  },
};
