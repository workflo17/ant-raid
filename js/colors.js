// ===== Which colours this match is being played in =====
//
// Colony colour is NOT a palette swap you can apply at the last moment. Three
// separate caches are built out of it and every one of them has to be thrown
// away when it changes:
//
//   js/board.js   the tint cache, keyed per species per team
//   js/scenery.js six baked nest damage stages per colony, ~420 grains each
//   js/record.js  the painted result card
//
// So the colours live here rather than being passed around, and `epoch` ticks
// every time they change. Anything holding a cache compares the epoch it built
// at against the current one and rebuilds when they differ. Reading
// TEAM_TINT[team] directly anywhere in the client is the bug this module exists
// to prevent: it silently pins that piece of art to Ember and Frost forever.

import { COLONY_COLORS, TEAM_TINT, colorById, resolveColors } from '../shared/data/board.js';

let active = [TEAM_TINT[0], TEAM_TINT[1]];
let epoch = 0;

/** The colour a colony is wearing right now. */
export function teamTint(team) {
  return active[team] || TEAM_TINT[team] || TEAM_TINT[0];
}

/** Bumped whenever the colours change, so caches know they are stale. */
export function colorEpoch() { return epoch; }

/**
 * Point the client at a pair of colour ids. Clashes are resolved the same way
 * the server resolves them, so a client that guesses wrong still lands on the
 * same answer rather than showing two colonies in one colour.
 */
export function setColonyColors(ids) {
  // as many colonies as the match has, not two: a ring board has up to six, and
  // holding only a pair left every colony past the second falling back to the
  // first one's colour, so four nests came out the same red
  const next = resolveColors(ids).map(colorById);
  if (next.length === active.length && next.every((c, i) => c === active[i])) return active;
  active = next;
  epoch++;
  applyCssVars();
  return active;
}

/**
 * The HUD is CSS, not canvas, and it reads --ember and --frost. Those names are
 * now roles rather than colours: --ember is whatever team 0 is wearing.
 */
export function applyCssVars(mine = 0) {
  const root = document.documentElement;
  if (!root) return;
  // The HUD only ever shows one colony's readouts, so --ember is whichever
  // colony YOU are, and --frost is somebody else for the pressure bars.
  const you = active[mine] || active[0];
  const them = active[mine === 0 ? 1 : 0] || active[1] || active[0];
  root.style.setProperty('--ember', you.accent);
  root.style.setProperty('--ember-dark', shade(you.accent, 0.34));
  root.style.setProperty('--frost', them.accent);
  root.style.setProperty('--frost-dark', shade(them.accent, 0.34));
}

/** How many colonies this match is being played in. */
export const colonyCount = () => active.length;

/** Darken a hex by mixing it toward black, for the -dark pair of each role. */
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export { COLONY_COLORS };
