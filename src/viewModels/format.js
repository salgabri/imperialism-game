// Owner: WP-0 (see PLAN.md §4). Shared pure formatting helpers (PLAN §3.4) — FROZEN.
// Pure: no window/document/timers/RNG. Every helper tolerates null/undefined input.
import { ratingTierOf } from '../theme.js';
import { isDomesticScope } from '../data/domesticScope.js';

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

/** Standard subtractive Roman numeral; roman(0) === ''. */
export function roman(n) {
  let x = Math.floor(Number(n));
  if (!Number.isFinite(x) || x <= 0) return '';
  let out = '';
  for (const [value, symbol] of ROMAN) {
    while (x >= value) { out += symbol; x -= value; }
  }
  return out;
}

/** recordMatch stores `round` as a pad3 string ('007'); this reads it back as a number. */
export function historyRound(entry) {
  return Number(entry?.round) || 0;
}

/** '<1%' | '>99%' | `${Math.round(p*100)}%` (the MatchCard convention); '' for a missing estimate. */
export function formatWinChance(p) {
  const value = Number(p);
  if (p == null || !Number.isFinite(value)) return '';
  if (value < .01) return '<1%';
  if (value > .99) return '>99%';
  return `${Math.round(value * 100)}%`;
}

/**
 * Both sides of a fixture's win chance from the attacker's probability `pA`: the attacker's percentage is rounded once
 * (exactly formatWinChance) and the defender shows the rest, so the pair always reads 100% (rounding each side on its
 * own showed '38% / 63%' for k/512 estimates that land on a half). The '<1%' / '>99%' edges stay symmetric.
 * aShown/bShown are the displayed integers (0/100 at the edges) that DEC D5 tones read; '' / null for a missing estimate.
 */
export function formatOddsPair(pA) {
  const value = Number(pA);
  if (pA == null || !Number.isFinite(value)) return { a: '', b: '', aShown: null, bShown: null };
  const p = Math.max(0, Math.min(1, value));
  if (p < .01) return { a: '<1%', b: '>99%', aShown: 0, bShown: 100 };
  if (p > .99) return { a: '>99%', b: '<1%', aShown: 100, bShown: 0 };
  const aShown = Math.round(p * 100), bShown = 100 - aShown;
  return { a: `${aShown}%`, b: `${bShown}%`, aShown, bShown };
}

/** A theatre's display name: the data's trailing "*" footnote marker ("Asia & Oceania*") is a setup-only device. */
export function plainScopeName(name) {
  return String(name ?? '').replace(/\s*\*\s*$/, '');
}

/** DEC D5: tone of the displayed integer percentage — ≥60 gain, 45–59 even, <45 loss. */
export function winTone(p) {
  const value = Number(p);
  if (p == null || !Number.isFinite(value)) return 'muted';
  const shown = value < .01 ? 0 : value > .99 ? 100 : Math.round(value * 100);
  return shown >= 60 ? 'gain' : shown >= 45 ? 'even' : 'loss';
}

/** A strength delta: '+2.3' (gain) | '−1.4' with U+2212 (loss) | '±0.0' (muted). */
export function signedDelta(delta) {
  const value = Number(delta);
  const rounded = Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
  if (Math.abs(rounded) < .05) return { text: '±0.0', tone: 'muted' };
  return rounded > 0
    ? { text: `+${rounded.toFixed(1)}`, tone: 'gain' }
    : { text: `−${Math.abs(rounded).toFixed(1)}`, tone: 'loss' };
}

/** README rating tiers: '88' | '84' | '80' | '75' | '70' | 'low'. */
export function ratingTier(r) {
  const value = Number(r);
  return r != null && Number.isFinite(value) ? ratingTierOf(value) : 'low';
}

export function territoryWord(n) {
  return Number(n) === 1 ? 'territory' : 'territories';
}

const PARTICLES = new Set(['de', 'van', 'von', 'da', 'di', 'dos', 'del', 'der', 'ter', 'ten', 'le', 'la', 'el', 'al', 'den', 'du', 'das', 'do']);
const SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv']);

/** Surname for scorers and pitch labels (ED§4e.17): last token, keeping name particles and Jr./II suffixes. */
export function shortName(name) {
  const tokens = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return tokens[0] || '';
  let end = tokens.length - 1;
  let suffix = '';
  if (SUFFIXES.has(tokens[end].toLowerCase()) && end > 0) { suffix = ` ${tokens[end]}`; end -= 1; }
  let start = end;
  while (start > 0 && PARTICLES.has(tokens[start - 1].toLowerCase())) start -= 1;
  return tokens.slice(start, end + 1).join(' ') + suffix;
}

/**
 * Route line for a draw or match: land border, neutral transit treaty, foreign land (an exclave on a country map:
 * the neighbouring country is crossed, never claimed) or sea.
 */
export function routeCopy(draw) {
  if (!draw) return '';
  if (draw.routeKind === 'neutral-transit') return 'Through neutral land — transit treaty';
  if (draw.routeKind === 'foreign-transit') return 'Through foreign land — never claimed';
  if (draw.routeKind === 'sea' || draw.isNeighbor === false) return 'By sea — no shared border';
  return 'Across a land border';
}

/**
 * 'The European Campaign' | 'The World Campaign' | `${scopeName} Campaign` (DEC misc). A country's top clubs read as
 * the theatre itself ('England · top 100 clubs').
 */
export function campaignTitle(settings, scopeName) {
  const nations = settings?.layer !== 'clubs';
  if (nations && settings?.scope === 'UEFA') return 'The European Campaign';
  if (nations && settings?.scope === 'world') return 'The World Campaign';
  if (!nations && isDomesticScope(settings?.clubScope)) return scopeName || 'One country · top clubs';
  return scopeName ? `${scopeName} Campaign` : 'The Campaign';
}

/**
 * The round being played, or about to be played. Busy (live match, spin, pending target, tactical
 * gate, signing, or a blitz/chaos batch with matches still queued) → st.round; idle → st.round + 1.
 * Round robin (DEC D3): idle mid-cycle → st.round; idle at a cycle boundary → st.round + 1.
 * A completed campaign (one empire left) has no next round: → st.round, the final round the victory shows.
 */
export function displayRound(st) {
  if (!st) return 0;
  const round = Number(st.round) || 0;
  if (round > 0 && Array.isArray(st.aliveIds) && st.aliveIds.length === 1) return round;
  const busy = (st.match && !st.match.applied) || !!st.spin || !!st.pendingTarget || !!st.tacticalChoice || !!st.choice
    || (Array.isArray(st.queue) && st.queue.length > 0);
  if (busy) return round;
  if (st.settings?.turnOrder === 'round-robin') {
    const queue = Array.isArray(st.turnQueue) ? st.turnQueue : [];
    const index = Math.max(0, Number(st.turnIndex) || 0);
    const alive = new Set(st.aliveIds || []);
    return queue.slice(index).some(id => alive.has(id)) ? round : round + 1;
  }
  return round + 1;
}

/** Identity chip for flags/monograms: { teamId, flagId, isClub, code, color, name } | null. */
export function teamChip(team) {
  if (!team) return null;
  return { teamId: team.id ?? null, flagId: team.flagId ?? null, isClub: team.kind === 'club', code: team.code || '',
    color: team.col || null, name: team.name || '' };
}

/**
 * Memoise `compute()` under a prefixed key (rule 16) until any dep changes identity. Deps must be state
 * identities (st.own, st.teams, …), never the per-call ctx.board object.
 */
export function memo(cache, key, deps, compute) {
  if (!cache || typeof cache.get !== 'function' || typeof cache.set !== 'function') return compute();
  const list = Array.isArray(deps) ? deps : [deps];
  const hit = cache.get(key);
  if (hit && hit.deps.length === list.length && hit.deps.every((dep, i) => dep === list[i])) return hit.value;
  const value = compute();
  cache.set(key, { deps: list.slice(), value });
  return value;
}
