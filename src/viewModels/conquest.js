// Owner: WP-CONQ (see PLAN.md §4). Conquest view-models (D§5–§8, DEC D15). buildConquestPreview was written final
// by WP-0 in W1: its shape is FROZEN (PLAN §3.6). Everything here is pure: (state, ctx) in, plain data out; no
// window/document/timers/RNG, and every builder tolerates missing geometry, odds, sport or history.
import { DEPENDENCIES, NATIONS } from '../data/teams.js';
import { roman, signedDelta, territoryWord } from './format.js';
import { getSport, overtimeText } from '../sports/index.js';

function territoryName(ctx, cid) {
  // A country map's sections first (ctx.sectionNames); the geometry fallback below is an O(n) find.
  return ctx?.sectionNames?.[cid] || NATIONS[cid]?.[0] || DEPENDENCIES[cid]?.name
    || (ctx?.geo?.countries || []).find(country => country.id === cid)?.name || cid;
}

function boundsOf(ctx, ids) {
  if (!ctx?.geo && !ctx?.displayGeo) return null;
  const boxes = ids.map(id => (ctx.displayGeo?.paths?.[id] || ctx.geo?.paths?.[id])?.bbox)
    .filter(box => box && [box.x, box.y, box.w, box.h].every(Number.isFinite));
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  const right = Math.max(...boxes.map(b => b.x + b.w)), bottom = Math.max(...boxes.map(b => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * The map and figures as they will be once the pending signing is confirmed (DEC D15, ED§4e.12).
 * → { winnerId, loserId, taken, own, territoryNames, empireAfter, aliveAfter, totalEmpires, bounds, centre } | null
 * `taken` lists every territory the loser holds, dependencies included, in applyConquest's order; `own` is the
 * projected ownership; `bounds` is the union of the taken path boxes without overseas dependencies (falling back
 * to all taken land when only dependencies remain), null without geometry. Null unless a signing is pending
 * on a decided, unapplied match.
 */
export function buildConquestPreview(st, ctx = {}) {
  const m = st?.match;
  if (!st?.choice || !m || m.applied || m.winner == null) return null;
  const winnerId = m.winner;
  const loserId = winnerId === m.aId ? m.dId : m.aId;
  if (!st.teams?.[winnerId] || !st.teams?.[loserId]) return null;
  const own = { ...(st.own || {}) };
  const taken = [];
  for (const cid in own) {
    if (own[cid] === loserId) {
      own[cid] = winnerId;
      taken.push(cid);
    }
  }
  let empireAfter = 0;
  for (const cid in own) if (own[cid] === winnerId) empireAfter += 1;
  const framed = taken.filter(cid => !DEPENDENCIES[cid]);
  const bounds = boundsOf(ctx, framed.length ? framed : taken);
  return {
    winnerId, loserId, taken, own,
    territoryNames: taken.map(cid => territoryName(ctx, cid)),
    empireAfter,
    aliveAfter: (st.aliveIds || []).filter(id => id !== loserId).length,
    totalEmpires: Number.isFinite(ctx.totalTeams) ? ctx.totalTeams : Object.keys(st.teams).length,
    bounds,
    centre: bounds ? { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 } : null,
  };
}

// ---------- shared copy helpers ----------

const isFiniteScore = value => value !== null && value !== '' && Number.isFinite(Number(value));

/**
 * Winner-first result score with sport-aware tie-break text (DEC D15):
 * '2–1' · '1–1, 4–3 on penalties' (shoot-out kicks, winner first) · '98–95 after 1 overtime period' · '5–4 after 11 innings'.
 * `m` is a live/finished match ({ aId, dId, finalGa|ga, finalGd|gd, tie }); '' when the score is unknown.
 */
export function winnerScore(m, winnerId, sport) {
  if (!m) return '';
  const ga = m.finalGa ?? m.ga, gd = m.finalGd ?? m.gd;
  if (!isFiniteScore(ga) || !isFiniteScore(gd)) return '';
  const winnerIsA = winnerId === m.aId;
  let text = `${winnerIsA ? ga : gd}–${winnerIsA ? gd : ga}`;
  const tie = m.tie;
  if (tie) {
    const tieBreak = sport?.tieBreak || (Array.isArray(tie.periods) ? 'overtime' : 'shootout');
    if (tieBreak === 'overtime') {
      text += ` ${overtimeText(sport, Array.isArray(tie.periods) && tie.periods.length ? tie.periods.length : 1)}`;
    } else if (isFiniteScore(tie.ga) && isFiniteScore(tie.gd)) {
      text += `, ${winnerIsA ? tie.ga : tie.gd}–${winnerIsA ? tie.gd : tie.ga} on penalties`;
    } else {
      text += ' on penalties';
    }
  }
  return text;
}

/** "Italy beat Serbia 2–1." / "Italy held off Serbia 2–1." (winner attacked / defended; DEC D15 has no comma). */
export function resultSentence(winnerName, loserName, winnerAttacked, score) {
  return `${winnerName} ${winnerAttacked ? 'beat' : 'held off'} ${loserName}${score ? ` ${score}` : ''}.`;
}


const rating1 = value => (Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '—');
const replacedName = candidate => (typeof candidate?.replaces === 'string' ? candidate.replaces : candidate?.replaces?.name) || null;
const supportChange = value => {
  const number = Number(value) || 0;
  return `${number >= 0 ? '+' : '−'}${Math.abs(number).toFixed(2)}`;
};

/** The candidate a choice currently points at: `choice.selected` when valid, else the best lineup fit. */
export function selectedOption(choice, selectedIndex = choice?.selected) {
  const candidates = Array.isArray(choice?.candidates) ? choice.candidates : [];
  return candidates.find(candidate => candidate.index === selectedIndex) || candidates[0] || null;
}

/**
 * The lineup noun in the conquest copy (DEC misc, as squad/match/preview): basketball reads "starting five", American
 * football "starting lineup", football keeps DEC D15's "XI". `sport` is the sport object or its id; anything else is
 * football.
 */
function lineupNoun(sport) {
  return getSport(typeof sport === 'string' ? sport : sport?.id).words.lineupNoun;
}

/** One v4 option row per candidate (D§2.5, D§7, DEC D15); `sport` picks the lineup noun (football by default). */
export function conquestOptions(choice, selectedIndex = choice?.selected, sport) {
  const candidates = Array.isArray(choice?.candidates) ? choice.candidates : [];
  const selected = selectedOption(choice, selectedIndex);
  const lineup = lineupNoun(sport);
  return candidates.map((candidate, position) => {
    const index = Number.isInteger(candidate.index) ? candidate.index : position;
    const replaced = replacedName(candidate);
    const delta = signedDelta(Math.max(0, Number(candidate.gain) || 0));
    // Every natural position: a PG/SG fits either guard spot.
    const base = `${candidate.positions?.length ? candidate.positions.join('/') : candidate.pos} · ${candidate.rating} rating`;
    const note = replaced ? `Starts ahead of ${replaced}`
      : candidate.entersLineup ? `Starts in the ${lineup}` : `Adds depth · the ${lineup} is unchanged`;
    return {
      key: `option-${index}`, index, name: candidate.name, base, note, meta: `${base} · ${note}`,
      gain: delta.text, tone: delta.tone === 'gain' ? 'gain' : 'muted', role: candidate.role || null,
      selected: candidate === selected,
    };
  });
}

/** "Lineup changes" for the selected candidate (DEC D15; strategy-ui coverage): the places it changes, not the ten that read the same twice. */
export function conquestComparison(candidate) {
  const lineup = candidate?.lineupPreview;
  if (!lineup || !Array.isArray(lineup.after)) return null;
  const before = Array.isArray(lineup.before) ? lineup.before : [];
  return {
    summary: 'Lineup changes',
    beforeRating: rating1(lineup.beforeRating),
    afterRating: rating1(lineup.afterRating),
    caption: `Lineup before and after signing ${candidate.name}`,
    rows: lineup.after.flatMap((slot, index) => (slot.name === before[index]?.name ? [] : [{
      key: `${slot.position}-${index}`,
      position: slot.position,
      before: { name: before[index]?.name || '—', rating: rating1(before[index]?.rating) },
      after: { name: slot.name, rating: rating1(slot.rating), outOfPosition: !!slot.outOfPosition },
    }])),
    none: 'Your lineup stays the same.',
    support: candidate.support
      ? `Attack support ${supportChange(candidate.attackGain)} · Defensive support ${supportChange(candidate.defendGain)}`
      : null,
  };
}

function articleModel({ choice, selectedIndex, kicker, standfirst, effects, sport }) {
  const options = conquestOptions(choice, selectedIndex, sport);
  const selected = selectedOption(choice, selectedIndex);
  const chosen = options.find(option => option.selected) || null;
  return {
    kicker: kicker || 'Conquest',
    kickerRight: '',
    headline: choice?.loserName ? `${choice.loserName} is out` : 'Conquest',
    standfirst: standfirst || '',
    effects: effects || [],
    claimTitle: 'Claim one player',
    claimAside: `Change to your ${lineupNoun(sport)}`,
    options,
    selectedIndex: chosen ? chosen.index : null,
    ctaLabel: chosen ? `Sign ${chosen.name}` : null,
    ctaGain: chosen ? chosen.gain : null,
    ctaTone: chosen ? chosen.tone : null,
    comparison: conquestComparison(selected),
  };
}

/**
 * Minimal article straight from `st.choice` (no match, teams or map). ConquestScreen uses it when it is handed the
 * W1 stub model `{ choice, selectedIndex }`, so the screen works before conquestModel() is wired to buildConquest.
 */
export function conquestFromChoice(choice, selectedIndex = choice?.selected) {
  return articleModel({
    choice, selectedIndex,
    // Neutral copy: the stub carries no score or attacker, so no "beat" / "held off" (DEC D15 tail only).
    standfirst: choice?.winnerName ? `${choice.winnerName} claim one player.` : '',
  });
}

/**
 * The conquest article (D1/D2, D§5–§8, DEC D15) → owned shape:
 * { kicker: 'Round XIX · Conquest', kickerRight: '', headline: 'Serbia is out', standfirst: 'Italy beat Serbia 2–1.',
 *   effects: [{ key, label, value, title }], claimTitle, claimAside,
 *   options: [{ key, index, name, base, note, meta, gain: '+1.2'|'±0.0', tone: 'gain'|'muted', role, selected }],
 *   selectedIndex, ctaLabel: 'Sign Federico Chiesa', ctaGain: '+1.2', ctaTone,
 *   comparison: { summary, beforeRating, afterRating, caption, rows: [{ key, position, before, after }], none, support } | null }
 * `preview` = buildConquestPreview(st, ctx) (computed here when omitted). Null without a pending choice.
 */
export function buildConquest(st, ctx = {}, preview) {
  const choice = st?.choice;
  if (!choice) return null;
  const projected = preview === undefined ? buildConquestPreview(st, ctx) : preview;
  const m = st.match || null;
  const winnerId = projected?.winnerId ?? m?.winner ?? null;
  const loserId = projected?.loserId ?? (m && winnerId != null ? (winnerId === m.aId ? m.dId : m.aId) : null);
  const winnerName = st.teams?.[winnerId]?.name || choice.winnerName || 'Your team';
  const loserName = choice.loserName || st.teams?.[loserId]?.name || 'The loser';
  const taken = projected ? projected.taken.length : 0;
  const score = m ? winnerScore(m, winnerId, ctx?.sport) : '';
  const winnerAttacked = m ? m.aId === winnerId : true;
  const round = roman(st.round);
  const effects = [];
  if (projected) {
    effects.push({ key: 'territory', label: 'Territory', value: `+${taken}`, title: projected.territoryNames.join(', ') });
    effects.push({ key: 'empire', label: 'Empire', value: String(projected.empireAfter),
      title: `${territoryWord(projected.empireAfter)} · ${projected.aliveAfter} of ${projected.totalEmpires} empires remain` });
  }
  return articleModel({
    choice: { ...choice, loserName }, selectedIndex: choice.selected,
    kicker: round ? `Round ${round} · Conquest` : 'Conquest',
    standfirst: resultSentence(winnerName, loserName, winnerAttacked, score),
    effects,
    sport: ctx?.sport,
  });
}

/**
 * Callout anchored on the taken land (D§2.4, D§3.4; A-2). WorldMap converts the map-unit point to px and clamps it;
 * the wiring wraps the copy in <ConquestCallout/> as the anchor node. The label agrees with the figure
 * ('+1 Territory taken', like the standfirst's "only territory"); D1's static copy is the plural case.
 * → { key: 'conquest-callout', x, y, align: 'center', figure: '+3', label: 'Territories taken', sub: 'Now part of Italy' } | null
 */
export function buildConquestCallout(st, ctx = {}, preview) {
  const projected = preview === undefined ? buildConquestPreview(st, ctx) : preview;
  if (!projected?.centre || !projected.taken.length) return null;
  const winnerName = st?.teams?.[projected.winnerId]?.name || st?.choice?.winnerName || '';
  const n = projected.taken.length;
  return {
    key: 'conquest-callout', x: projected.centre.x, y: projected.centre.y, align: 'center',
    figure: `+${n}`, label: n === 1 ? 'Territory taken' : 'Territories taken', sub: winnerName ? `Now part of ${winnerName}` : '',
  };
}

// ---------- manager elimination (DEC D15: the same article pattern) ----------

const ORDINAL = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
const ordinalRules = typeof Intl !== 'undefined' && Intl.PluralRules ? new Intl.PluralRules('en', { type: 'ordinal' }) : null;
function ordinal(n) {
  const value = Number(n);
  if (!Number.isInteger(value) || value <= 0) return '—';
  return `${value}${ORDINAL[ordinalRules ? ordinalRules.select(value) : 'other'] || 'th'}`;
}

/**
 * The closing note speaks only when the last save failed (the masthead shows "Unsaved"): it points to the export. The
 * buttons say what comes next. → { note, noteTone: 'unsaved' | null }
 */
export function eliminationNote(saveStatus) {
  if (saveStatus?.ok === false) {
    return { note: 'Your run could not be saved. Use Export campaign in Settings to keep a copy.', noteTone: 'unsaved' };
  }
  return { note: '', noteTone: null };
}

/**
 * Copy straight from `st.managerElimination` (used when no model is passed and as the builder's fallback).
 * `result.score` is attacker-first with the legacy tie suffix, so it is never printed here (DEC D15 is winner-first).
 * `extra.saveStatus` picks the closing note (eliminationNote); without it the note claims nothing about the save.
 */
export function eliminationFromResult(result, extra = {}) {
  if (!result) return null;
  const teamName = result.teamName || 'Your team';
  const opponentName = result.opponentName || 'Your opponent';
  return {
    kicker: extra.kicker || 'Eliminated',
    kickerRight: '',
    headline: `${teamName} is out`,
    standfirst: extra.standfirst || `${opponentName} won the decisive match.`,
    stats: [
      { key: 'placement', label: 'Placement', value: ordinal(result.placement) },
      { key: 'conquests', label: 'Conquests', value: String(result.conquests ?? 0) },
      { key: 'signings', label: 'Signings', value: String(result.signings ?? 0) },
    ],
    ...eliminationNote(extra.saveStatus),
  };
}

/**
 * Elimination article for ManagerElimination: { kicker: 'Round XIX · Eliminated', headline: 'Italy is out',
 * standfirst: 'Serbia beat Italy 2–1.', stats: [{ key, label, value }], note, noteTone } | null. Winner-first score from
 * the finished match (or its archived history entry after a reload); with neither, a neutral sentence without a score.
 * The note speaks only when `st.saveStatus` says the save failed (eliminationNote).
 */
export function buildElimination(st, ctx = {}) {
  const result = st?.managerElimination;
  if (!result) return null;
  const teamName = result.teamName || st.teams?.[result.teamId]?.name || 'Your team';
  const winnerName = result.opponentName || st.teams?.[result.opponentId]?.name || 'Your opponent';
  const ids = [result.teamId, result.opponentId];
  const m = st.match && ids.every(id => id === st.match.aId || id === st.match.dId) ? st.match : null;
  const entry = !m && Array.isArray(st.history) ? st.history.find(item => item.id === result.matchId) : null;
  let score = '';
  let winnerAttacked = true;
  let sentence = null;
  if (m) {
    score = winnerScore(m, result.opponentId, ctx?.sport);
    winnerAttacked = m.aId === result.opponentId;
  } else if (entry) {
    winnerAttacked = entry.aId === result.opponentId;
    const a = entry.a?.score, b = entry.b?.score;
    if (isFiniteScore(a) && isFiniteScore(b)) score = winnerAttacked ? `${a}–${b}` : `${b}–${a}`;
    const tieText = entry.result?.tieText || '';
    const kicks = tieText.match(/^(\d+)–(\d+) on penalties$/);
    if (score && kicks) score += `, ${winnerAttacked ? `${kicks[1]}–${kicks[2]}` : `${kicks[2]}–${kicks[1]}`} on penalties`;
    else if (score && /^after/i.test(tieText)) score += ` ${tieText.replace(/^After/, 'after')}`;
  } else {
    // Unknown side and score: result.score is attacker-first, so stay neutral rather than guess the verb.
    sentence = `${winnerName} won the decisive match.`;
  }
  const round = roman(st.round);
  return eliminationFromResult({ ...result, teamName, opponentName: winnerName }, {
    kicker: round ? `Round ${round} · Eliminated` : 'Eliminated',
    standfirst: sentence || resultSentence(winnerName, teamName, winnerAttacked, score),
    saveStatus: st.saveStatus,
  });
}
