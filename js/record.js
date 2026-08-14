// ===== What survives the match =====
// A local record (wins, streaks, per-board bests, head-to-head against a named
// friend) plus the two things you can send someone afterwards: a spoiler-light
// text summary and a painted result card.
//
// All of it is localStorage. There is no account and no server, which is the
// point: the share string is the whole distribution mechanism.

import { mapList } from '../shared/map.js';
import { RAIDERS } from '../shared/data/units.js';
import { TUNING } from '../shared/data/board.js';
import { teamTint } from './colors.js';
import { storeKey } from './session.js';
import { drawAnt } from './render/ants.js';
import { tinted } from './board.js';

// Per TAB, not per origin. Two tabs on the same server is how this game gets
// tested, and both of them writing here meant one match added a win and a loss
// to the same tally. See js/session.js.
const KEY = storeKey('antraid.record');
const BLANK = { wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, byMap: {}, h2h: {}, played: 0 };

export function loadRecord() {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || 'null');
    return r && typeof r === 'object' ? { ...BLANK, ...r, byMap: r.byMap || {}, h2h: r.h2h || {} } : { ...BLANK };
  } catch {
    return { ...BLANK };
  }
}

function save(r) {
  try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* private mode, nothing to do */ }
}

/**
 * Fold a finished match into the record.
 * @param m { won, drew, map, opponent, mode, bot }
 */
export function recordMatch(m) {
  const r = loadRecord();
  r.played++;
  if (m.drew) { r.draws++; r.streak = 0; }
  else if (m.won) { r.wins++; r.streak = r.streak >= 0 ? r.streak + 1 : 1; }
  else { r.losses++; r.streak = r.streak <= 0 ? r.streak - 1 : -1; }
  r.bestStreak = Math.max(r.bestStreak, r.streak);

  const bm = (r.byMap[m.map] ||= { w: 0, l: 0 });
  if (m.drew) { /* a draw belongs to neither column */ }
  else if (m.won) bm.w++; else bm.l++;

  // head-to-head only against a named human; the bot is not a rival
  const who = (m.opponent || '').trim();
  if (who && !m.bot) {
    const h = (r.h2h[who] ||= { w: 0, l: 0 });
    if (!m.drew) { if (m.won) h.w++; else h.l++; }
  }
  save(r);
  return r;
}

export function clearRecord() { try { localStorage.removeItem(KEY); } catch { /* nothing */ } }

/** One line for the title screen. Empty string when there is nothing to say yet. */
export function recordLine() {
  const r = loadRecord();
  if (!r.played) return '';
  const bits = [`${r.wins}W ${r.losses}L`];
  if (r.streak >= 2) bits.push(`${r.streak} in a row`);
  else if (r.streak <= -2) bits.push(`${-r.streak} lost in a row`);
  const rivals = Object.entries(r.h2h).sort((a, b) => (b[1].w + b[1].l) - (a[1].w + a[1].l));
  if (rivals.length) {
    const [name, h] = rivals[0];
    bits.push(`vs ${name} ${h.w}-${h.l}`);
  }
  return bits.join('  ·  ');
}

// ------------------------------------------------------------------- share

/** Trim to fit the space it has, rather than to a guessed character count. */
function ellipsis(c, text, maxW) {
  let s = String(text || '');
  if (c.measureText(s).width <= maxW) return s;
  while (s.length > 1 && c.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

const bar = (frac, width = 10) => {
  const n = Math.max(0, Math.min(width, Math.round(frac * width)));
  return '█'.repeat(n) + '·'.repeat(width - n);
};

/** A ring holds six colonies at the most, so the awkward teens never come up. */
const ORDINALS = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'];
const ordinal = (n) => ORDINALS[n] || `${n}th`;

// THREE COLONIES OR MORE IS NOT A DUEL, the same rule the nest bar goes by.
// A duel keeps every word it has always had. A free-for-all has no "them" to
// name: it gets whoever of the others finished best, and a placing, because two
// bars out of six cannot say on their own whether you came second or fifth.
const isMany = (res) => (res.teams || 2) > 2;
const rivalOf = (res) => res.rivalTeam ?? 1 - res.myTeam;
const rivalLabel = (res) => (isMany(res)
  ? res.rivalName || teamTint(rivalOf(res)).name
  : res.theirName || 'Them');

/**
 * How the colonies finished against each other.
 *
 * A colony still standing is ahead of every colony that fell; two still
 * standing rank on what is left of their nests; two that fell rank on which of
 * them lasted longer. That last comparison is the whole reason the driver keeps
 * `fellAt` at all, because the final state has everybody who fell on nought and
 * cannot tell second from fifth. Colonies that went down together are tied.
 *
 * A colony the driver never saw fall gets Infinity: it went in a step nobody
 * observed, which can only be the last one.
 *
 * The WINNER is put above all of it, because that is the sim's own verdict and
 * the scoreboard on the same screen already says so. It is not always the last
 * nest standing: a ring can collapse entirely in one step, and then the match
 * goes to whoever was least far gone. Ranking that colony second because three
 * others fell in the same step as it would contradict the page it is printed on.
 */
function ranker(res) {
  const hp = res.nestHp || [];
  const out = res.out || hp.map((h) => h <= 0);
  const fellAt = res.fellAt || [];
  const rank = (t) => (t === res.winner ? [2, 0]
    : out[t] ? [0, fellAt[t] ?? Infinity]
    : [1, hp[t]]);
  return { n: hp.length, rank, ahead: (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]) };
}

/**
 * Where you finished, counting the colonies that beat you. Colonies that tie
 * share a place, so two level on health are both second and nobody is third.
 */
export function placeOf(res) {
  const { n, rank, ahead } = ranker(res);
  const mine = rank(res.myTeam);
  let place = 1;
  for (let t = 0; t < n; t++) if (t !== res.myTeam && ahead(rank(t), mine)) place++;
  return place;
}

/**
 * The colony the card holds you up against: whoever of the OTHERS finished
 * best. Not whoever has the most nest left — win a ring by outlasting everybody
 * and all of them read nought, so health alone picks an arbitrary one, which is
 * the bug this whole change is about. The one that lasted longest is the runner
 * up, and that is a thing worth putting on the card.
 */
export function bestOther(res) {
  const { n, rank, ahead } = ranker(res);
  let best = res.myTeam === 0 ? 1 % n : 0;
  for (let t = 0; t < n; t++) if (t !== res.myTeam && ahead(rank(t), rank(best))) best = t;
  return best;
}

/**
 * Spoiler-light: it shows how close it was and how it ended, without listing
 * what anyone built. Short enough to paste into a chat without wrapping.
 */
export function shareText(res) {
  // mapList() defaults to the duelling boards, so a ring board fell through it
  // and the card printed the raw id: "ring5" where the board is called The Five
  // Hollows. It is keyed by colony count, which is a thing the result now knows.
  const map = mapList(res.teams || 2).find((m) => m.id === res.map);
  const many = isMany(res);
  const mine = Math.max(0, res.nestHp[res.myTeam] ?? 0);
  const theirs = Math.max(0, res.nestHp[rivalOf(res)] ?? 0);
  const mins = Math.floor(res.t / 60), secs = String(Math.floor(res.t % 60)).padStart(2, '0');
  const lines = [
    `Ant Raid  ·  ${map ? map.name : res.map}`,
    `${bar(mine / TUNING.nestHp)}  you ${Math.ceil(mine)}`,
    `${bar(theirs / TUNING.nestHp)}  ${many ? rivalLabel(res) : 'them'} ${Math.ceil(theirs)}`,
    `${many ? `${ordinal(placeOf(res))} of ${res.teams}  ·  ` : ''}${mins}:${secs}`
      + `  ·  ${res.sent} ants sent  ·  ${res.kills} kills`,
  ];
  if (res.comeback >= 20) lines.push(`came back from ${Math.round(res.comeback)} down`);
  if (res.url) lines.push(res.url);
  return lines.join('\n');
}

// -------------------------------------------------------------- result card

/**
 * A painted postcard of the match. Procedural, so there is nothing to load and
 * nothing to host: it is drawn from the numbers the match already produced.
 */
export function drawResultCard(cv, res) {
  const W = 840, H = 440;
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr;
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);

  const many = isMany(res);
  const mineT = res.myTeam, theirsT = rivalOf(res);
  const mine = Math.max(0, res.nestHp[mineT] ?? 0);
  const theirs = Math.max(0, res.nestHp[theirsT] ?? 0);
  const won = res.won;

  // ground
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#f8efd4'); g.addColorStop(1, '#e6d3a8');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.globalAlpha = 0.1;
  c.fillStyle = '#5c3a1e';
  for (let x = 0; x < W; x += 48) c.fillRect(x, 0, 24, H);
  for (let y = 0; y < H; y += 48) c.fillRect(0, y, W, 24);
  c.globalAlpha = 1;

  c.strokeStyle = '#2b1a10'; c.lineWidth = 8;
  c.strokeRect(4, 4, W - 8, H - 8);

  // headline
  c.textAlign = 'center';
  c.fillStyle = won ? '#3f7a22' : '#c33a1e';
  c.font = '800 54px "Baloo 2", sans-serif';
  // A duel has one other nest, so the headline can talk about it. A free-for-all
  // ends with most of the board in rubble whoever won, and "their nest" is four
  // nests: it says where you came instead, which is true whether the match was
  // won by outlasting everybody or by holding the most nest at the whistle.
  c.fillText(many ? `${ordinal(placeOf(res)).toUpperCase()} OF ${res.teams}`
    : won ? 'THEIR NEST IS RUBBLE' : 'YOUR NEST IS RUBBLE', W / 2, 74);
  c.fillStyle = '#2b1a10';
  c.font = '700 20px "Baloo 2", sans-serif';
  const map = mapList(res.teams || 2).find((m) => m.id === res.map);   // by colony count, see shareText
  c.fillText(`${map ? map.name : res.map}  ·  ${Math.floor(res.t / 60)}:${String(Math.floor(res.t % 60)).padStart(2, '0')}`, W / 2, 104);

  // the two nests, facing each other
  const rows = [
    { label: res.myName || 'You', hp: mine, team: mineT, y: 168 },
    { label: rivalLabel(res), hp: theirs, team: theirsT, y: 246 },
  ];
  c.textAlign = 'left';
  for (const r of rows) {
    const T = teamTint(r.team);
    c.font = '800 22px "Baloo 2", sans-serif';
    c.fillStyle = '#2b1a10';
    c.fillText(ellipsis(c, r.label, 300), 56, r.y - 8);
    c.fillStyle = '#2b1a10';
    c.beginPath(); c.roundRect(52, r.y, 640, 34, 17); c.fill();
    const w = (640 - 6) * Math.max(0, Math.min(1, r.hp / TUNING.nestHp));
    c.fillStyle = T.accent;
    if (w > 2) { c.beginPath(); c.roundRect(55, r.y + 3, w, 28, 14); c.fill(); }
    c.textAlign = 'right';
    c.fillStyle = '#2b1a10';
    c.font = '800 26px "Baloo 2", sans-serif';
    c.fillText(String(Math.ceil(r.hp)), 780, r.y + 26);
    c.textAlign = 'left';
  }

  // the five ants you packed, marching along the bottom
  c.font = '700 15px "Baloo 2", sans-serif';
  c.fillStyle = 'rgba(43,26,16,.7)';
  c.fillText('you packed', 56, 330);
  (res.roster || []).forEach((id, i) => {
    const def = RAIDERS[id];
    if (!def) return;
    c.save();
    c.translate(180 + i * 64, 332);
    c.scale(0.78, 0.78);
    drawAnt(c, def.species, tinted(def, mineT), { x: 0, y: 0, angle: 0, scale: 1, time: i * 0.7 });
    c.restore();
  });

  // Four numbers, and the last slot shows whichever is actually interesting.
  // "came back from 0" is a dead stat on a match you led from the front.
  const last = res.comeback >= 1 ? [Math.round(res.comeback), 'came back from']
    : (res.streak || 0) >= 2 ? [res.streak, 'win streak']
    : [Math.ceil(mine), 'nest left'];
  const stats = [
    [res.sent, 'ants sent'],
    [res.kills, 'kills'],
    [`+${(res.eco || 0).toFixed(0)}/s`, 'raid income'],
    last,
  ];
  c.textAlign = 'center';
  stats.forEach(([v, label], i) => {
    const x = 118 + i * 202;
    c.fillStyle = '#2b1a10';
    c.font = '800 30px "Baloo 2", sans-serif';
    c.fillText(String(v), x, 402);
    c.fillStyle = 'rgba(43,26,16,.6)';
    c.font = '700 13px "Baloo 2", sans-serif';
    c.fillText(label, x, 422);
  });

  return cv;
}

/** Hand the card and the text to whatever the browser can do with them. */
export async function shareResult(cv, res) {
  const text = shareText(res);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  const file = blob ? new File([blob], 'ant-raid.png', { type: 'image/png' }) : null;

  if (file && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); return 'shared'; } catch { /* cancelled */ }
  }
  try { await navigator.clipboard.writeText(text); return 'copied'; } catch { /* no clipboard */ }
  const a = document.createElement('a');
  a.href = cv.toDataURL('image/png');
  a.download = 'ant-raid.png';
  a.click();
  return 'downloaded';
}
