// ===== Adaptive music: a WebAudio step sequencer, fully synthesized =====
// Intensity layers: 0 menu/build (lead only) · 1 combat (+bass+hats)
//                   2 swarm (+kick+snare)    · 3 boss (minor color, driving arp)
// Structure (v14): each map theme owns a 16-step A melody and a B melody; the song
// alternates A/A/B/B by bar, every 4th bar closes with a quick arp-run fill, the
// bass gains passing tones in the B section, and the kit is a real kit — sampled
// kick (bank thump), layered tone+noise snare, hats with an accent pattern.
import { audioCtx, masterBus, reverbBus, playSampleAt } from './sound.js';

const ROOT = 110;              // A2 (per-map themes transpose from here)

// pentatonic degrees (semitones); boss rounds shift to minor color
const MAJOR = [0, 2, 4, 7, 9, 12, 14, 16];
const MINOR = [0, 3, 5, 7, 10, 12, 15, 17];

// ---- per-map identity: transposition, feel, tempo AND melody (set from startGame) ----
// lead / leadB: 16-step degree patterns (A section / B section), null = rest
const MAP_THEMES = {
  menu: { // the front porch: the picnic tune slowed to a lullaby rock — no kit,
    // intensity 0 lets the melody breathe in on even bars and out on odd ones
    rootOff: 0, bpm: 86, ambient: 'breeze',
    lead:  [0, null, 2, null, 4, null, null, null, 5, null, 4, null, 2, null, null, null],
    leadB: [4, null, 5, null, 7, null, null, null, 5, null, 4, null, 2, null, 1, null],
  },
  picnic: { // sunny A major, an easy porch-swing tune
    rootOff: 0, bpm: 112, ambient: 'breeze',
    lead:  [0, null, 2, null, 4, null, 2, null, 5, 4, null, 2, null, 1, null, null],
    leadB: [4, null, 5, null, 7, null, 5, 4, 2, null, 4, 2, 1, null, 0, null],
  },
  garden: { // brighter, up a minor third — skipping birdsong contour
    rootOff: 3, bpm: 112, ambient: 'birds',
    lead:  [0, 2, null, 4, null, null, 5, null, 4, null, 2, null, 3, 2, 1, null],
    leadB: [7, null, 5, null, 4, null, 5, 7, 5, null, 4, 2, null, 1, 2, null],
  },
  kitchen: { // lazy diner swing — sparse, behind the beat
    rootOff: -2, bpm: 112, swing: true, ambient: 'hum',
    lead:  [0, null, null, 2, null, null, 4, null, null, 3, null, 2, null, null, 1, null],
    leadB: [2, null, null, 4, null, null, 5, null, 4, null, 3, null, 2, null, 1, null],
  },
  flowerbed: { // minor-leaning dusk waltz-ish sway
    rootOff: 0, bpm: 108, minor: true, ambient: 'breeze',
    lead:  [0, null, 1, null, 2, null, 4, null, 5, null, 4, null, 2, null, 1, null],
    leadB: [5, null, 4, null, 7, null, 5, 4, 2, null, 1, null, 0, null, null, null],
  },
  nightporch: { // slow, dark, mothy — long held tones
    rootOff: -4, bpm: 96, minor: true, ambient: 'crickets',
    lead:  [0, null, null, null, 2, null, null, null, 1, null, null, null, 3, null, 2, null],
    leadB: [4, null, null, null, 5, null, 4, null, 2, null, null, 1, 0, null, null, null],
  },
  bath: { // light minor, echoing tile — droplet syncopation
    rootOff: 2, bpm: 104, minor: true, ambient: 'drips',
    lead:  [0, null, 4, null, null, 2, null, null, 5, null, null, 4, null, null, 2, null],
    leadB: [7, null, 5, null, 4, null, null, 2, 4, null, 5, null, 1, null, null, null],
  },
  orchard: { // bright and plucky, fruit coming down on the offbeats
    rootOff: 5, bpm: 116, ambient: 'birds',
    lead:  [0, null, 4, 2, null, 4, null, 5, null, 4, 2, null, 1, null, 2, null],
    leadB: [7, 5, null, 4, null, 2, 4, null, 5, null, 7, null, 4, null, 2, 1],
  },
  brookbed: { // low and sparse, something walking the dry bed between the notes
    rootOff: -5, bpm: 100, minor: true, ambient: 'breeze',
    lead:  [0, null, null, null, 1, null, 0, null, null, null, 3, null, 1, null, null, null],
    leadB: [4, null, null, 3, null, null, 1, null, 0, null, null, 1, null, null, 0, null],
  },
  wheel: { // the free-for-all: driving minor, no colony resting long
    rootOff: 7, bpm: 118, minor: true, ambient: 'crickets',
    lead:  [0, 0, null, 2, null, 3, null, 2, 4, null, 3, 2, null, 1, null, null],
    leadB: [5, null, 4, null, 5, 7, null, 5, 4, null, 2, null, 1, 2, null, null],
  },
};
let theme = MAP_THEMES.picnic;
let themeId = 'picnic';
let stepDur = 60 / theme.bpm / 2; // 8th notes

export function setMapTheme(mapId) {
  themeId = MAP_THEMES[mapId] ? mapId : 'picnic';
  theme = MAP_THEMES[themeId];
  stepDur = 60 / theme.bpm / 2;
  if (running && gain) startAmbientBed(audioCtx()); // swap the ambient bed with the theme
}

// fallback 16-step patterns (degree index, or null for rest)
const LEAD_PAT = [0, null, 4, null, null, 2, null, null, 5, null, null, 3, null, null, 1, null];
const LEAD_PAT_B = [4, null, 5, null, 7, null, 4, null, 2, null, 4, null, 1, null, 0, null];
const BASS_PAT = [0, null, null, 0, null, null, 3, null, 0, null, null, 0, null, 4, null, 3];
const BASS_PAT_B = [0, null, null, 0, null, 2, 3, null, 0, null, null, 4, null, 3, 2, 1]; // passing tones walk between roots
const ARP_PAT = [0, 2, 4, 2, 5, 2, 4, 2, 0, 2, 4, 2, 6, 4, 2, 1];
const FILL_RUN = [2, 4, 5, 7]; // quick arp run closing every 4th bar (steps 12-15)
// hat velocities per step: light offbeats, accents pushing into beats 2 and 4
const HAT_ACC = [0.5, 0.3, 0.8, 0.35, 0.5, 0.3, 0.9, 0.35, 0.5, 0.3, 0.8, 0.35, 0.55, 0.35, 1.0, 0.45];

let gain = null;
let musicSend = null; // music -> reverb send
let muted = false;
let running = false;
let intensity = 0;
let step = 0;
let bar = 0;
let nextTime = 0;
let timer = null;

function freq(scale, degree, octave = 0) {
  const d = scale[((degree % scale.length) + scale.length) % scale.length];
  return ROOT * Math.pow(2, (theme.rootOff + d + 12 * (octave + Math.floor(degree / scale.length))) / 12);
}

function voice(c, f, t, dur, type, vol, dest) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = f;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf = null;
function tick(c, t, vol, hp, dest) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.1, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  s.connect(f).connect(g).connect(dest);
  s.start(t);
  s.stop(t + 0.08);
}

function scheduleStep(c, i, t) {
  const scale = (intensity >= 3 || theme.minor) ? MINOR : MAJOR;
  if (theme.swing && i % 2 === 1) t += stepDur * 0.16; // delay every other 8th
  // song form: A A B B by bar; every 4th bar ends in a fill
  const sectionB = bar % 4 >= 2;
  const fillBar = bar % 4 === 3;
  // lead: always on, gentle — per-theme melody, B melody in the back half
  let ld = (sectionB ? (theme.leadB || LEAD_PAT_B) : (theme.lead || LEAD_PAT))[i];
  if (fillBar && i >= 12) ld = FILL_RUN[i - 12]; // the fill overrides the tail of the phrase
  if (ld != null && (intensity > 0 || i % 4 === 0 || bar % 2 === 0)) {
    voice(c, freq(scale, ld, 2), t, 0.34, 'triangle', 0.09, gain);
  }
  if (intensity >= 1) {
    const bs = (sectionB ? BASS_PAT_B : BASS_PAT)[i]; // B section walks with passing tones
    if (bs != null) voice(c, freq(scale, bs, 0), t, 0.3, 'square', 0.075, gain);
    if (i % 2 === 1) tick(c, t, 0.028 + 0.045 * HAT_ACC[i], HAT_ACC[i] > 0.8 ? 7500 : 6000, gain); // hats w/ accents
  }
  if (intensity >= 2) {
    if (i % 4 === 0 && !playSampleAt('thump', t, 0.5, 1, gain)) {
      voice(c, 55, t, 0.16, 'sine', 0.3, gain); // synth kick until the bank lands
      tick(c, t, 0.05, 2000, gain);
    }
    if (i === 4 || i === 12) { // snare: tone + noise layered on the backbeats
      voice(c, 190, t, 0.09, 'triangle', 0.12, gain);
      tick(c, t, 0.09, 1600, gain);
    }
  }
  if (intensity >= 3) {
    voice(c, freq(scale, ARP_PAT[i], 3), t, 0.12, 'square', 0.045, gain);
    if (i === 8) voice(c, freq(scale, 0, 1), t, 0.5, 'sawtooth', 0.05, gain);
  }
}

// ---- per-map ambient beds: quiet synth atmosphere under the sequencer ----
// continuous: 'hum' (kitchen fridge), 'breeze' (picnic/flowerbed noise swell)
// event-based: 'crickets' (night porch), 'birds' (garden), 'drips' (bath)
let ambientKind = null;
let ambientNodes = null; // running sources for continuous beds
let nextAmbT = 0;
let ambNoiseBuf = null;

function ambNoise(c) {
  if (!ambNoiseBuf) {
    ambNoiseBuf = c.createBuffer(1, c.sampleRate * 1.0, c.sampleRate);
    const d = ambNoiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return ambNoiseBuf;
}

function stopAmbientBed() {
  if (ambientNodes) for (const n of ambientNodes) { try { n.stop(); } catch { /* already stopped */ } }
  ambientNodes = null;
}

function startAmbientBed(c) {
  stopAmbientBed();
  ambientKind = theme.ambient || null;
  if (!c || !gain || !ambientKind) return;
  if (ambientKind === 'hum') {
    // low fridge drone: fundamental + faintly beating overtone
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 50;
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = 100.7;
    const g = c.createGain(); g.gain.value = 0.05;
    const g2 = c.createGain(); g2.gain.value = 0.016;
    o.connect(g).connect(gain); o2.connect(g2).connect(gain);
    o.start(); o2.start();
    ambientNodes = [o, o2];
  } else if (ambientKind === 'breeze') {
    // soft looping wind: lowpassed noise with a slow LFO swell
    const src = c.createBufferSource(); src.buffer = ambNoise(c); src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    const g = c.createGain(); g.gain.value = 0.022;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.13;
    const lg = c.createGain(); lg.gain.value = 0.014;
    lfo.connect(lg).connect(g.gain);
    src.connect(f).connect(g).connect(gain);
    src.start(); lfo.start();
    ambientNodes = [src, lfo];
  }
  nextAmbT = c.currentTime + 0.8;
}

// pitched blip used by the event ambiences
function ambChirp(c, t, f0, f1, dur, vol, type = 'triangle') {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(gain);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function scheduleAmbEvent(c, t) {
  if (ambientKind === 'crickets') {
    // one cricket phrase: 4 rapid high pulses
    for (let i = 0; i < 4; i++) ambChirp(c, t + i * 0.075, 4100, 4400, 0.05, 0.028);
    nextAmbT = t + 1.4 + Math.random() * 1.6;
  } else if (ambientKind === 'birds') {
    // occasional two-note whistle
    ambChirp(c, t, 1900, 2600, 0.16, 0.03);
    if (Math.random() > 0.4) ambChirp(c, t + 0.22, 2300, 1800, 0.14, 0.026);
    nextAmbT = t + 4 + Math.random() * 6;
  } else if (ambientKind === 'drips') {
    // echoing tap-drip plink with a faint tile echo
    ambChirp(c, t, 950, 420, 0.12, 0.05, 'sine');
    ambChirp(c, t + 0.24, 760, 380, 0.1, 0.02, 'sine');
    nextAmbT = t + 2.5 + Math.random() * 4;
  } else {
    nextAmbT = t + 5;
  }
}

export function ensureStarted() {
  if (running) return;
  const c = audioCtx();
  if (!c) return;
  gain = c.createGain();
  gain.gain.value = muted ? 0 : musicVol;
  gain.connect(masterBus() || c.destination); // through the shared master compressor
  const rb = reverbBus();
  if (rb) { // ≈65/35 dry/wet: music sits deeper in the room than the SFX
    musicSend = c.createGain();
    musicSend.gain.value = 0.54;
    gain.connect(musicSend);
    musicSend.connect(rb);
  }
  startAmbientBed(c);
  nextTime = c.currentTime + 0.1;
  timer = setInterval(() => {
    if (c.state !== 'running') {
      nextTime = c.currentTime + 0.1;
      return;
    }
    while (nextTime < c.currentTime + 0.18) {
      scheduleStep(c, step, nextTime);
      step = (step + 1) % 16;
      if (step === 0) bar++;
      nextTime += stepDur;
    }
    // event ambiences (crickets/birds/drips) ride the same scheduler
    if (ambientKind && !ambientNodes && c.currentTime + 0.3 >= nextAmbT) {
      scheduleAmbEvent(c, Math.max(nextAmbT, c.currentTime + 0.05));
    }
  }, 80);
  running = true;
}

export function setIntensity(n) {
  intensity = n | 0;
}

let musicVol = 0.5;
export function setMusicVolume(v) {
  musicVol = Math.max(0, Math.min(1, v));
  if (gain && !muted) gain.gain.value = musicVol;
}
export function getMusicVolume() { return musicVol; }

export function setMusicMuted(m) {
  muted = m;
  if (gain) gain.gain.value = m ? 0 : musicVol;
}

export function isMusicMuted() {
  return muted;
}

export function musicState() {
  return {
    running, intensity, step, bar, muted, theme: themeId, bpm: theme.bpm,
    minor: !!theme.minor, swing: !!theme.swing, rootOff: theme.rootOff,
    ambient: theme.ambient || null, ambientLive: running && !!(ambientNodes || (ambientKind && nextAmbT > 0)),
    section: bar % 4 >= 2 ? 'B' : 'A', fillBar: bar % 4 === 3,
    hasLead: !!theme.lead, hasLeadB: !!theme.leadB,
    reverbSend: musicSend ? +musicSend.gain.value.toFixed(2) : 0,
  };
}
