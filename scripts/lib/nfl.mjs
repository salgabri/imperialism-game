// The NFL's clubs from a Madden NFL roster: the squad each franchise fields, as the built-in season
// (scripts/build-nfl.mjs) and the earlier seasons (scripts/build-nfl-seasons.mjs) both build it, and each earlier
// season's franchises (scripts/data/nfl-seasons.json). No I/O here.
//
// Madden lists one position per player, finer than the game's: its five line spots become OL, the defensive ends
// (LE and RE; the edges, LEDG and REDG, from Madden NFL 26) and tackles DL, its three linebackers (LOLB, MLB and
// ROLB; SAM, MIKE and WILL from Madden NFL 26) LB, both safeties S and the fullback RB. Punters and long snappers
// have no place in the lineup and are left out. Each franchise fields the lineup the game itself picks from its whole
// roster (eleven on offence, the nickel defence and the kicker), then the best backups at each position (DEPTH).
// Ratings are Madden's overalls, unchanged.
import { selectLineup } from '../../src/data/teams.js';

const SPORT = 'american-football';
export const POSITION_OF = {
  QB: 'QB', HB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE',
  LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL',
  LE: 'DL', RE: 'DL', LEDG: 'DL', REDG: 'DL', DT: 'DL',
  LOLB: 'LB', MLB: 'LB', ROLB: 'LB', SAM: 'LB', MIKE: 'LB', WILL: 'LB',
  CB: 'CB', FS: 'S', SS: 'S', K: 'K',
};
export const LEFT_OUT = new Set(['P', 'LS']);
const ORDER = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K'];
// The lineup's places by position: eleven on offence (three receivers), the nickel defence and the kicker.
export const FORMATION = { QB: 1, RB: 1, WR: 3, TE: 1, OL: 5, DL: 4, LB: 2, CB: 3, S: 2, K: 1 };
// Backups kept beyond the starters, by position: a squad of 34.
const DEPTH = { QB: 1, RB: 1, WR: 1, TE: 1, OL: 2, DL: 2, LB: 1, CB: 1, S: 1 };

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** Distinct, readable colours spread around the hue wheel (as build-clubs gives the other sports' clubs). */
export const colourFor = id => `oklch(0.72 0.16 ${hashStr(id) % 360})`;
const byRating = (a, b) => b.rating - a.rating || a.name.localeCompare(b.name);

/**
 * A Madden player as a squad player `{ name, pos, rating }`, his position the game's ('LOLB' → 'LB'); null for a
 * punter or long snapper. Throws on a position Madden does not have.
 */
export function playerOf(name, listed, overall) {
  if (LEFT_OUT.has(listed)) return null;
  const pos = POSITION_OF[listed];
  if (!pos) throw new Error(`Unknown Madden position ${listed} (${name})`);
  return { name, pos, rating: overall };
}

/** The places of the lineup a roster has too few natural players for: `{ DL: 1 }`. */
export function shortOf(players) {
  return Object.fromEntries(Object.entries(FORMATION)
    .map(([pos, count]) => [pos, count - players.filter(player => player.pos === pos).length]).filter(([, short]) => short > 0));
}
const describe = places => Object.entries(places).map(([pos, n]) => (n > 1 ? `${n} ${pos}` : pos)).join(', ') || 'nothing';

/**
 * The squad a franchise fields from its players `players` (`{ name, pos, rating }`), offence first → `{ squad, str }`:
 * the lineup the game picks from the whole roster, then its best backups (DEPTH). Where the game starts a player out
 * of position, preferring him (less the penalty) to a weak natural one, as a thin roster of the early 2000s makes it
 * (a linebacker before a 48-rated kicker), the natural players it passed over stay in the squad as well. A roster too
 * short of natural players for a place is refused unless `gaps` documents exactly that shortfall (`{ DL: 1, CB: 1 }`:
 * a 3-4 Tecmo club of 1990); the game then fills the place out of position, and no player is added.
 */
export function squadOf(players, label, { gaps = {} } = {}) {
  const pool = players.slice().sort(byRating);
  const stray = Object.keys(gaps).filter(pos => !FORMATION[pos]);
  if (stray.length) throw new Error(`${label}: no place ${stray.join(', ')} in the lineup`);
  const short = shortOf(pool);
  const documented = Object.fromEntries(Object.keys(FORMATION).filter(pos => gaps[pos] > 0).map(pos => [pos, gaps[pos]]));
  if (describe(short) !== describe(documented)) {
    throw new Error(Object.keys(gaps).length ? `${label} is short of ${describe(short)}, not the documented ${describe(documented)}`
      : `${label} cannot field every position: ${Object.keys(short).join(', ')}`);
  }
  const lineup = selectLineup({ sport: SPORT, squad: pool });
  const chosen = new Set(lineup.starters.map(player => player.originalIndex));
  const passedOver = [];
  for (const [pos, count] of Object.entries(FORMATION)) {
    let missing = count - lineup.slots.filter(slot => slot.position === pos && slot.player && !slot.outOfPosition).length;
    pool.forEach((player, i) => {
      if (missing > 0 && player.pos === pos && !chosen.has(i)) { chosen.add(i); passedOver.push(player); missing--; }
    });
  }
  const left = { ...DEPTH };
  const backups = pool.filter((player, i) => !chosen.has(i) && left[player.pos] > 0 && left[player.pos]--);
  const squad = [...lineup.starters.map(player => pool[player.originalIndex]), ...passedOver, ...backups]
    .sort((a, b) => ORDER.indexOf(a.pos) - ORDER.indexOf(b.pos) || byRating(a, b));
  return { squad, str: selectLineup({ sport: SPORT, squad }).rating };
}

/** Clubs strongest first, then by name. */
export const strongestFirst = (a, b) => b.str - a.str || a.name.localeCompare(b.name);

// ---------- the earlier seasons' franchises (scripts/data/nfl-seasons.json) ----------

/** The data set id of the season of `year`: Madden NFL 06 rates 2005, 'madden-2005'. */
export const seasonIdOf = year => `madden-${year}`;
/** The data set id of the manifest's season `year`: its source's own `id`, else the Madden season's. */
export const setIdOf = (manifest, year) => manifest?.sources?.[year]?.id ?? seasonIdOf(year);

/** The era map the season of `year` plays on (the manifest's `maps`). */
export function mapOf(manifest, year) {
  const map = manifest.maps.find(entry => entry.seasons.includes(year));
  if (!map) throw new Error(`No map for the ${year} season`);
  return map.id;
}

const VENUE = ['stadium', 'base', 'home'];

/**
 * The franchises of season `year` as `{ franchise, ea, id, name, code, city, stadium, base, home }`, in today's
 * order (scripts/data/nfl-teams.json, `franchises`): today's unless the manifest names an era in which a franchise
 * played under another name or elsewhere (`teams`). An era keeps today's identity (id, name, code, city) unless it
 * names its own; one that names a stadium or a point replaces today's venue whole (its stadium, training base and
 * point); one that is `absent` (before an expansion franchise's first season, or while one was suspended) leaves the
 * franchise out of the season.
 */
export function teamsOf(franchises, manifest, year) {
  return Object.entries(franchises).flatMap(([franchise, team]) => {
    const era = manifest?.teams?.[franchise]?.find(e => (e.from ?? -Infinity) <= year && year <= (e.to ?? Infinity));
    if (era?.absent) return [];
    const venue = era && VENUE.some(key => key in era) ? { stadium: era.stadium, base: era.base, home: era.home }
      : { stadium: team.stadium, base: team.base, home: team.home };
    const here = { ...team, id: franchise, ...(era || {}), ...venue };
    return [{ franchise, ea: team.ea, id: here.id, name: here.name, code: here.code, city: here.city,
      stadium: here.stadium, ...(here.base ? { base: here.base } : {}), home: here.home }];
  });
}
