// ===== Mid-match emotes — pure data, no engine imports =====
//
// A FIXED LIST, sent and validated BY INDEX. No free text ever crosses the
// socket, so there is nothing to escape, nothing to moderate, and nothing a
// client can put on another player's screen that is not already in this file.
// That is the whole reason it is a list of six and not a chat box.
//
// Emotes are deliberately NOT part of the simulation. They change nothing, they
// are not in a snapshot, and they do not need to survive a reconnect: the server
// relays them straight to the other seat. Putting them in the sim would mean
// every one of them rode along in every snapshot for the rest of the match.

export const EMOTES = [
  { id: 'hi', glyph: '△', text: 'Hello' },
  { id: 'nice', glyph: '✦', text: 'Nice one' },
  { id: 'oops', glyph: '⁉', text: 'Oops' },
  { id: 'watch', glyph: '▶', text: 'Watch this' },
  { id: 'help', glyph: '⚑', text: 'Help' },
  { id: 'gg', glyph: '♥', text: 'Good game' },
  // The signals. Six colonies with two neighbours each is a social game with no
  // table talk: these three are the table talk, and they stay indexed entries
  // in a fixed list for exactly the reason everything above does. On a ring a
  // signal is delivered TO a colony (the one your aimed lane runs to) and the
  // bubble lands on their nest in your colour, so "you are next" arrives as a
  // threat from somebody in particular.
  { id: 'truce', glyph: '⚐', text: 'Truce?' },
  { id: 'next', glyph: '✕', text: 'You are next' },
  { id: 'off', glyph: '⊘', text: 'The truce is off' },
];

/** How long a bubble stays up, and the least time between two of them. */
export const EMOTE_SHOW = 2.6;
export const EMOTE_GAP = 1200;   // ms, enforced server-side so it cannot be bypassed

/** A client-supplied index is only ever an index into this list. */
export const isEmote = (i) => Number.isInteger(i) && i >= 0 && i < EMOTES.length;
