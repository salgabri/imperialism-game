// The EuroLeague's clubs from the snapshot (scripts/data/euroleague-2026-27.json, scripts/sync-euroleague.mjs): each
// club's best five, its players' positions and ratings, and their names as the game shows them. Pure: build-euroleague.mjs
// reads the files and tests feed invented players. docs/design/euroleague.md explains the choices.
//
// No source rates EuroLeague players: NBA 2K has carried no EuroLeague teams since 2K17, and no other public dataset
// rates them. Every rating here is the game's estimate, on NBA 2K's scale, from a player's EuroLeague box scores, and is
// marked as one wherever it is shown (src/data/estimates.js).
import { selectLineup } from '../../src/data/teams.js';

export const FIVE = 5;
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

// ---- Ratings --------------------------------------------------------------------------------------------------------

/**
 * A rating is linear in the player's PIR (the EuroLeague's Performance Index Rating) a game, `RATING_AT_LEVEL` at
 * `LEVEL_PIR` and `RATING_PER_PIR` more for each point above it.
 * - The level: a EuroLeague player with a PIR of 9 a game rates 73, between the two references. The 47 players on
 *   this season's rosters who played in the NBA lately rated 72.5 in their last NBA 2K (2K24–2K27) at a PIR of 8.4, and
 *   the 30 EuroLeague players among the national fives (scripts/fiba-squads.json) carry 73.6 at 9.2.
 * - The slope: a club's five then rates as its players play, and the league's clubs spread as the real ones do. At 1.3
 *   a point of PIR, a simulated season of these 20 fives has its clubs' records as far apart as the EuroLeague's last
 *   five regular seasons (the standard deviation of their winning shares 0.139; real 0.126–0.159), its margins as wide
 *   (10.3 points a game; real 10.2–10.8) and as many close games and blowouts. Neither reference can give the slope:
 *   NBA 2K rates the league's fringe, which is where EuroLeague players come from, close together.
 */
export const LEVEL_PIR = 9;
export const RATING_AT_LEVEL = 73;
export const RATING_PER_PIR = 1.3;
export const RATING_RANGE = Object.freeze([60, 88]);
/**
 * A player's PIR a game over the seasons he played, the season under way counting one and a half times a game, the
 * last full season once and the one before half: form now, but a season hurt or a slow start does not sink him.
 */
export const SEASON_WEIGHTS = Object.freeze([0.5, 1, 1.5]);
/**
 * Few games say little: a player's PIR is drawn towards a bench player's (`PRIOR_PIR`) as if he had also played
 * `PRIOR_GAMES` games at it. A player with no EuroLeague game in the three seasons rates there: about 66.
 */
export const PRIOR_PIR = 4;
export const PRIOR_GAMES = 4;

// A line is [games, minutes, points, rebounds, assists, three-point attempts, PIR], per game.
const G = 0, MIN = 1, REB = 3, AST = 4, TPA = 5, PIR = 6;

/** The player's PIR a game over `lines` (one per season, oldest first, null for a season he did not play), shrunk. */
export function blendedPir(lines) {
  let weight = 0, total = 0;
  lines.forEach((line, s) => {
    if (!line || !line[G]) return;
    const w = SEASON_WEIGHTS[s] * line[G];
    weight += w;
    total += w * line[PIR];
  });
  return (total + PRIOR_GAMES * PRIOR_PIR) / (weight + PRIOR_GAMES);
}

/** The game's rating of a player with these lines, a whole number in RATING_RANGE. */
export function estimateRating(lines) {
  const raw = RATING_AT_LEVEL + RATING_PER_PIR * (blendedPir(lines) - LEVEL_PIR);
  return Math.max(RATING_RANGE[0], Math.min(RATING_RANGE[1], Math.round(raw)));
}

// ---- Positions ------------------------------------------------------------------------------------------------------

/** Per-36-minute rates over the seasons played, by minutes: { ast, reb, tpa }, or null with no game. */
export function per36(lines) {
  let minutes = 0;
  const sum = { ast: 0, reb: 0, tpa: 0 };
  for (const line of lines) {
    if (!line || !line[G] || !line[MIN]) continue;
    minutes += line[G] * line[MIN];
    sum.ast += line[G] * line[AST];
    sum.reb += line[G] * line[REB];
    sum.tpa += line[G] * line[TPA];
  }
  return minutes ? { ast: 36 * sum.ast / minutes, reb: 36 * sum.reb / minutes, tpa: 36 * sum.tpa / minutes } : null;
}

/**
 * The positions a player covers, primary first ('PG/SG'). The EuroLeague lists guards, forwards and centres only; the
 * split follows the box score and height as a coach's would:
 * - a guard who makes 5.5 assists in 36 minutes, or 4 at 188 cm or less, runs the point ('PG'; 'PG/SG' unless he makes
 *   7.5), another plays off the ball ('SG/PG' with 4 assists, 'SG/SF' at 198 cm or more, else 'SG');
 * - a forward of 201 cm or less, or of 204 who rebounds under 6.5 and shoots threes, is a small forward ('SF/PF' at 200
 *   cm or with 6 rebounds, 'SF/SG' with 3.5 assists or at 196 cm or less); another is a power forward ('PF/C' at 207 cm
 *   or with 9 rebounds, else 'PF/SF');
 * - a centre is a centre, 'C/PF' when he shoots 2.5 threes in 36 minutes or stands 205 cm or less.
 * A player with no EuroLeague minutes is placed by height alone.
 */
export function positionsOf(position, height, lines) {
  const rates = per36(lines);
  const h = Number(height) || 0;
  const ast = rates?.ast ?? null, reb = rates?.reb ?? 0, tpa = rates?.tpa ?? 0;
  if (position === 'C') return tpa >= 2.5 || (h && h <= 205) ? ['C', 'PF'] : ['C'];
  if (position === 'F') {
    if (h <= 201 || (h <= 204 && reb < 6.5 && tpa >= 3)) {
      return h >= 200 || reb >= 6 ? ['SF', 'PF'] : (ast ?? 0) >= 3.5 || h <= 196 ? ['SF', 'SG'] : ['SF'];
    }
    return h >= 207 || reb >= 9 ? ['PF', 'C'] : ['PF', 'SF'];
  }
  if (position !== 'G') throw new Error(`Unknown EuroLeague position ${JSON.stringify(position)}`);
  if (ast == null) return h && h <= 188 ? ['PG', 'SG'] : ['SG', 'PG'];
  if (ast >= 5.5 || (h && h <= 188 && ast >= 4)) return ast >= 7.5 ? ['PG'] : ['PG', 'SG'];
  return ast >= 4 ? ['SG', 'PG'] : h >= 198 ? ['SG', 'SF'] : ['SG'];
}

// ---- Names ----------------------------------------------------------------------------------------------------------

const PARTICLES = new Set(['DE', 'DA', 'DI', 'DO', 'DOS', 'DAS', 'DEL', 'DELLA', 'VAN', 'VON', 'DER', 'DEN', 'LA', 'LE']);
const ROMAN = /^(II|III|IV|V|VI)$/;
const plain = text => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');

function titleWord(word, { inner, given = false }) {
  if (ROMAN.test(word)) return word;
  if (/^(JR|SR)\.?$/.test(word)) return `${word[0]}${word[1].toLowerCase()}.`;
  if (inner && PARTICLES.has(word)) return word.toLowerCase();
  // Initials go by as such: "TJ" is T.J., as "A.J." stays A.J.
  if (given && /^[BCDFGHJKLMNPQRSTVWXZ]{2}$/.test(word)) return `${word[0]}.${word[1]}.`;
  return word.split(/([-'’.])/).map(part => {
    if (!part || /[-'’.]/.test(part)) return part;
    const lower = part.toLocaleLowerCase('en');
    const cased = lower.charAt(0).toLocaleUpperCase('en') + lower.slice(1);
    // McKinley, McIntyre; one letter after "Mc" is not a name of its own.
    return /^Mc[a-z]{2}/.test(cased) ? `Mc${cased.charAt(2).toUpperCase()}${cased.slice(3)}` : cased;
  }).join('');
}

/**
 * "First Surname" from EuroLeague's "SURNAME, FIRST NAME": its accented spelling where it has one (`alias`), its own
 * mixed-case surname where that is the same name (`abbr`: "Miller-McIntyre, C."), else title case (Jr., II, Mc…,
 * particles inside a surname in lower case). `override` wins: the spelling the game uses elsewhere, or the player's own.
 */
export function displayName(name, { alias = null, abbr = null } = {}, override = null) {
  if (override) return override;
  const [surname, first = ''] = String(alias || name).split(',').map(part => part.trim().replace(/\s+/g, ' '));
  const own = abbr?.split(',')[0]?.trim();
  const last = own && plain(own) === plain(surname) && own !== own.toUpperCase()
    ? own
    : surname.split(' ').map((word, i) => titleWord(word, { inner: i > 0 })).join(' ');
  const given = first.split(' ').filter(Boolean).map(word => titleWord(word, { inner: false, given: true })).join(' ');
  return [given, last].filter(Boolean).join(' ');
}

// ---- Clubs ----------------------------------------------------------------------------------------------------------

/** A pool's best five: the strongest lineup its players' positions allow, strongest first (as the NBA clubs'). */
export function startingFive(pool) {
  const byRating = pool.slice().sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
  return selectLineup({ sport: 'basketball', squad: byRating }).starters
    .map(starter => byRating[starter.originalIndex])
    .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
}

/** What every estimated rating carries (src/data/estimates.js reads `source` and `league`). */
export const ESTIMATE = Object.freeze({ source: 'estimate', edition: 'Estimated', league: 'EuroLeague' });

/**
 * The EuroLeague's clubs, strongest first: `snapshot` is the synced file, `teams` the game's identity for each club by
 * EuroLeague code ({ id, name, code, country, col }) and `names` the spellings that override EuroLeague's, by player code.
 * Each club fields its best five as `[name, 'PG/SG', rating, ESTIMATE]`; `str` is the five's mean, rounded. Returns
 * `{ clubs, players, warnings }`, `players` every rostered player as rated (for the audit and tests).
 */
export function euroleagueClubs(snapshot, teams, names = {}) {
  const warnings = [];
  const codes = snapshot.clubs.map(club => club.code);
  const missing = codes.filter(code => !teams[code]);
  if (missing.length) throw new Error(`No identity for EuroLeague clubs ${missing.join(', ')}`);
  const extra = Object.keys(teams).filter(code => !codes.includes(code));
  if (extra.length) warnings.push(`identities for clubs not in the season: ${extra.join(', ')}`);
  const seasons = snapshot.source.seasons.length;
  const players = snapshot.players.map(row => {
    const [code, name, club, position, height, nationality, ...rest] = row;
    const lines = rest.slice(0, seasons);
    const extra = rest[seasons] ?? {};
    if (!codes.includes(club)) throw new Error(`${name} plays for ${club}, which is not in the season`);
    const positions = positionsOf(position, height, lines);
    return { code, club, nationality, name: displayName(name, extra, names[code]), positions, rating: estimateRating(lines),
      pir: blendedPir(lines), games: lines.reduce((sum, line) => sum + (line?.[G] ?? 0), 0) };
  });
  const seen = new Map();
  for (const player of players) {
    const key = `${player.club}|${player.name}`;
    if (seen.has(key)) throw new Error(`Two players called ${player.name} at ${player.club}`);
    seen.set(key, player);
  }
  const clubs = codes.map(code => {
    const pool = players.filter(player => player.club === code).map(p => ({ ...p, pos: p.positions[0] }));
    const five = startingFive(pool);
    if (five.length < FIVE) throw new Error(`${teams[code].name} has ${five.length} players`);
    const lineup = selectLineup({ sport: 'basketball', squad: five });
    const stretched = lineup.slots.filter(slot => slot.outOfPosition).map(slot => `${slot.player.name} at ${slot.position}`);
    if (stretched.length) warnings.push(`${teams[code].name} plays ${stretched.join(', ')} out of position`);
    const team = teams[code];
    return { id: team.id, name: team.name, code: team.code, league: 'EuroLeague', country: team.country, col: team.col,
      str: Math.round(five.reduce((sum, p) => sum + p.rating, 0) / five.length),
      squad: five.map(p => [p.name, p.positions.join('/'), p.rating, ESTIMATE]), source: code };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
  for (const p of players) {
    if (!POSITIONS.includes(p.positions[0])) throw new Error(`${p.name}: position ${p.positions.join('/')}`);
  }
  return { clubs, players, warnings };
}
