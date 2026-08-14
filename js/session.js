// ===== One tab, one player =====
//
// Everything this game remembers about you lives in localStorage, and
// localStorage is per ORIGIN, not per tab. The documented way to test
// multiplayer here is two tabs on the same server, and those two tabs were
// reading the same name, the same colour, the same five ants and the same win
// record: two colonies wearing one player's identity. The colour clash was the
// visible half, since both asked for ember and resolveColors quietly moved one
// of them, but the record was the worse half, because a match between your own
// two tabs wrote a win and a loss into the same tally.
//
// So each tab claims a SLOT.
//
//   slot 0   the plain keys, `antraid.name`
//   slot 1   `antraid.name#1`, its own player from then on
//
// Slot 0 keeping the bare keys is the point of the design: somebody who only
// ever opens one tab is on slot 0 every time and keeps the name, loadout and
// record they already had. Nothing migrates, nothing is lost, and this file
// costs them one localStorage read.
//
// A NEW SLOT IS SEEDED, NOT BLANK. A second tab that opened with an empty name
// and no loadout would read as "the game forgot me" rather than "this tab is
// someone else", so it copies the board, pack and queen from slot 0, takes a
// numbered name, and picks a colour nobody on this origin is already wearing.
// The record is the one thing deliberately NOT copied: it is the tally the
// second player has not earned.
//
// SLOTS ARE LEASED, NOT OWNED. A tab writes a heartbeat and a slot whose
// heartbeat has gone quiet for long enough is free again, which is what stops a
// closed tab from holding slot 1 forever. The lease is deliberately long,
// because a backgrounded tab in this app's usual QA environment has its timers
// throttled for MINUTES at a time (the same throttling that freezes
// requestAnimationFrame there), and a short lease would let another tab steal a
// slot out from under a tab that is merely hidden. Holding a dead slot for a
// few minutes costs nothing: the next tab takes the one after it.

import { COLOR_IDS } from '../shared/data/board.js';

const LEASE_KEY = 'antraid.slots';
const SLOT_KEY = 'antraid.slot';
const TOKEN_KEY = 'antraid.slottoken';
const LEASE_MS = 5 * 60_000;   // see the throttling note above
const BEAT_MS = 20_000;
const MAX_SLOTS = 8;

// Every read and write is wrapped: private mode makes localStorage throw on
// access rather than return null, and a game that will not start because it
// could not remember your name is a worse outcome than forgetting it.
const readRaw = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeRaw = (k, v) => { try { localStorage.setItem(k, v); } catch { /* nothing to do */ } };

function readLeases() {
  try {
    const o = JSON.parse(readRaw(LEASE_KEY) || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}

/**
 * A token that survives reload but not a new tab, which is exactly the identity
 * a lease needs: after F5 this tab has to recognise its OWN lease and take the
 * slot back rather than treat it as somebody else's and move over.
 */
function myToken() {
  let t = null;
  try { t = sessionStorage.getItem(TOKEN_KEY); } catch { /* fall through */ }
  if (!t) {
    t = Math.random().toString(36).slice(2, 10);
    try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* fall through */ }
  }
  return t;
}

const token = myToken();

function claimSlot() {
  const now = Date.now();
  const leases = readLeases();
  const heldByOther = (n) => {
    const l = leases[n];
    return !!l && l.token !== token && now - (l.ts || 0) < LEASE_MS;
  };

  let remembered = -1;
  try { remembered = Number(sessionStorage.getItem(SLOT_KEY)); } catch { /* fall through */ }

  let slot = Number.isInteger(remembered) && remembered >= 0 && remembered < MAX_SLOTS ? remembered : -1;
  if (slot < 0 || heldByOther(slot)) {
    slot = 0;
    while (slot < MAX_SLOTS - 1 && heldByOther(slot)) slot++;
  }

  const take = (n) => {
    // merge into a fresh read rather than the snapshot above, so writing our
    // own lease does not erase one another tab wrote in the meantime
    const fresh = readLeases();
    fresh[n] = { token, ts: Date.now() };
    writeRaw(LEASE_KEY, JSON.stringify(fresh));
  };
  take(slot);

  // Re-read straight after writing. localStorage is synchronous and shared
  // across tabs, so if another tab claimed this slot in the gap between our
  // read and our write, its entry is visible right now and one of us moves.
  // Whoever re-reads second is the one that finds a foreign token and gives
  // way, so exactly one tab moves in the ordinary two-tab race. Two tabs
  // opened in the very same millisecond can still land on one slot, which is
  // what happened on every slot before this file existed, so it is no worse.
  const after = readLeases();
  if (after[slot] && after[slot].token !== token && slot < MAX_SLOTS - 1) {
    slot++;
    take(slot);
  }

  try { sessionStorage.setItem(SLOT_KEY, String(slot)); } catch { /* fall through */ }
  return slot;
}

/** Which tab this is. 0 is the ordinary single-tab case. */
export const tabSlot = claimSlot();

/** The localStorage key this tab should use for a given preference. */
export const storeKey = (name) => (tabSlot === 0 ? name : `${name}#${tabSlot}`);

export const load = (name) => readRaw(storeKey(name));
export const save = (name, value) => writeRaw(storeKey(name), value);
export const drop = (name) => { try { localStorage.removeItem(storeKey(name)); } catch { /* nothing to do */ } };

/**
 * Give a brand new slot something sensible to start from, once.
 *
 * Copies what makes a second tab convenient to test with and leaves out what
 * would be wrong to inherit. Runs only when the slot has never been used, so a
 * second tab that has already been given a name keeps it across reloads.
 */
function seedFromFirstTab() {
  if (tabSlot === 0 || readRaw(storeKey('antraid.seeded'))) return;
  writeRaw(storeKey('antraid.seeded'), '1');

  for (const k of ['antraid.map', 'antraid.pack', 'antraid.queen']) {
    const from = readRaw(k);
    if (from != null) writeRaw(storeKey(k), from);
  }
  const baseName = (readRaw('antraid.name') || 'Colony').slice(0, 13);
  save('antraid.name', `${baseName} ${tabSlot + 1}`);

  // step around the colour wheel from whatever tab one wears, so the two
  // colonies are told apart on the board without anybody picking
  const first = COLOR_IDS.indexOf(readRaw('antraid.color') || '');
  const at = (first >= 0 ? first : 0) + tabSlot;
  save('antraid.color', COLOR_IDS[at % COLOR_IDS.length]);
}
seedFromFirstTab();

/**
 * Keep the lease warm. Also re-asserted the moment the tab is shown again,
 * because the interval is the thing that gets throttled while it is hidden and
 * coming back to the front is the first reliable tick after a long sleep.
 */
function beat() {
  const fresh = readLeases();
  fresh[tabSlot] = { token, ts: Date.now() };
  writeRaw(LEASE_KEY, JSON.stringify(fresh));
}
if (typeof window !== 'undefined') {
  setInterval(beat, BEAT_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) beat(); });
  window.addEventListener('pagehide', () => {
    // hand the slot back on the way out, so the next tab gets this one rather
    // than waiting out the lease. Best effort: a crash skips it and the lease
    // expiry is what covers that case.
    const fresh = readLeases();
    if (fresh[tabSlot] && fresh[tabSlot].token === token) {
      delete fresh[tabSlot];
      writeRaw(LEASE_KEY, JSON.stringify(fresh));
    }
  });
}
