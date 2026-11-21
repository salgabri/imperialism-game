// Rugby union's built-in season, 2025/26, computed from RugbyPass's match centre (docs/design/rugby-union.md). No game or
// site publishes rugby union player ratings, so every rating is computed by the method of docs/design/computed-ratings.md
// from what the games recorded. No I/O here.
//
// Two stages:
// - `snapshotOf`: every game of the window (2023/24–2025/26) → the committed snapshot: each team, each game's result and
//   scoring, and each player's seasons (his teams with their games, starts and minutes, the positions he started at, his
//   replacements' appearances and his production), for every player who took the field for a club of the 2025/26
//   Premiership, Top 14, URC, Super Rugby Pacific or League One.
// - `seasonOf`: the snapshot → the season: each player's position, club, nation, value and rating (the three leagues'
//   players on one scale, each pool league's set on it by its offset), each club's move toward its results, the clubs'
//   squads and the nations'.
import { NATIONS, RUGBY_NEAR_PENALTY, makeRng, hashStr, selectLineup } from '../../src/data/teams.js';
import { BASELINE, marginOfGap, rugbyUnionStrength } from '../../src/sports/rugbyUnion.js';
import {
  blend, clubMoveOf, clubOfStints, perPointOf, pooled, priorFromReliability, ratingsOf, replacementRate, resultsTargets,
  seasonReliability, shrunkRate, srsOf, WINDOW,
} from './computed-ratings.mjs';

const SPORT = 'rugby-union';

/** A starter's position by his number in the team sheet. */
export const NUMBER_POSITION = Object.freeze({ 1: 'PR', 2: 'HK', 3: 'PR', 4: 'LK', 5: 'LK', 6: 'FL', 7: 'FL', 8: 'N8', 9: 'SH', 10: 'FH',
  11: 'WG', 12: 'CE', 13: 'CE', 14: 'WG', 15: 'FB' });
/** A replacement's position by RugbyPass's label for him (its back row and outside backs name no single place). */
export const LABEL_POSITION = Object.freeze({ Prop: 'PR', Hooker: 'HK', Lock: 'LK', 'Back Row': 'FL', 'Scrum Half': 'SH', 'Fly Half': 'FH',
  Centre: 'CE', 'Outside Back': 'WG' });
/** The positions, front to back: the order a tie between two positions started as often keeps, and the squads' order. */
export const POSITIONS = Object.freeze(['PR', 'HK', 'LK', 'FL', 'N8', 'SH', 'FH', 'CE', 'WG', 'FB']);
const FORWARDS = new Set(['PR', 'HK', 'LK', 'FL', 'N8']);
// The replacements' places a bench label is trusted for: the scrum-half's and the hooker's.
const BENCH_SPECIALISTS = new Set(['SH', 'HK']);

/**
 * A player's production in a game, in points of the Six Nations' own fantasy game (Guinness Six Nations Fantasy Rugby,
 * as Planet Rugby's guide gives its table, with the 2025 game's fifteen for a forward's try), for every stat RugbyPass
 * records: what a player does, as the championship itself scores it. Missing: 50:22 kicks and lineout steals, which
 * RugbyPass does not count, and the player of the match.
 */
export const CORE = Object.freeze({
  tries: { back: 10, forward: 15, why: 'a try, a forward\'s worth more (the 2025 game)' },
  assists: { points: 4, why: 'the last pass or kick before a try' },
  conversions: { points: 2, why: 'a conversion kicked' },
  penaltyGoals: { points: 3, why: 'a penalty goal kicked' },
  dropGoals: { points: 5, why: 'a drop goal' },
  beaten: { points: 2, why: 'a defender beaten' },
  metres: { points: 0.1, why: 'a metre carried (a point every ten)' },
  tackles: { points: 1, why: 'a tackle made' },
  steals: { points: 5, why: 'a turnover won (the game\'s breakdown steal)' },
  conceded: { points: -1, why: 'a penalty conceded' },
  yellow: { points: -3, why: 'a yellow card' },
  red: { points: -6, why: 'a red card' },
});
/** The order of a season's totals in the snapshot. */
export const TOTALS = Object.freeze(['tries', 'assists', 'conversions', 'penaltyGoals', 'dropGoals', 'beaten', 'metres', 'tackles', 'steals',
  'conceded', 'yellow', 'red']);
// RugbyPass's stat for each total that the team sheet's own events do not give.
const STAT_OF = { assists: 'try_assists', beaten: 'defenders_beaten', metres: 'carries_metres', tackles: 'completed_tackles',
  steals: 'turnovers_won', conceded: 'penalties_conceded' };
const EVENT_OF = { try: 'tries', conversion: 'conversions', penalty: 'penaltyGoals', 'drop-goal': 'dropGoals', 'yellow-card': 'yellow',
  'red-card': 'red' };

/** The leagues whose 2025/26 clubs the map plays (the URC's four South African sides rated beside them, on no map). */
export const LEAGUES = Object.freeze(['premiership', 'top-14', 'united-rugby-championship']);
/**
 * The leagues whose clubs are rated for their players alone and play on no map (docs/design/rugby-union.md, "Super Rugby
 * Pacific and League One"): New Zealand's, Australia's and Japan's Test sides play in them, as do many of Fiji's, Samoa's,
 * Tonga's and South Africa's players. No club game links them to Europe's clubs, so each is rated within itself, as the
 * three leagues are together, then set on their scale by its offset, which the Tests of the nations drawn from it give.
 */
export const POOL_LEAGUES = Object.freeze(['super-rugby', 'japan-rugby-league-one']);
/** The three leagues' scale, on which the URC's South African sides are rated too. */
export const EUROPE = 'europe';
/** RugbyPass's team names that the game's nation names do not match; null for a side with no land of its own on the map. */
const NATION_NAMES = { USA: '840', 'United States of America': '840', 'Czech Republic': '203', Korea: '410', 'Hong Kong China': null,
  'Hong Kong': null };
/** The British and Irish Lions: no nation, but a Lions game is a representative game, as a Test is. */
const LIONS = 'British & Irish Lions';

const nationIdByName = new Map(Object.entries(NATIONS).map(([id, row]) => [row[0], id]));
/** A Test side's nation on the game's map, by RugbyPass's name: an id, or null (an A side, the Barbarians, a nation off the map). */
export function nationOfTeam(name) {
  if (Object.hasOwn(NATION_NAMES, name)) return NATION_NAMES[name];
  return nationIdByName.get(name) ?? null;
}

// ---------- the snapshot ----------

/** A player's minutes in a game ending at minute `end`: on from kick-off if he started, on and off by his substitutions. */
export function minutesOf(player, end) {
  let on = player.number <= 15 ? 0 : null, total = 0;
  for (const [type, minute] of player.subs.slice().sort((a, b) => a[1] - b[1])) {
    if (type === 'sub-off' && on != null) { total += Math.max(0, minute - on); on = null; }
    else if (type === 'sub-on' && on == null) on = minute;
  }
  if (on != null) total += Math.max(0, end - on);
  return Math.round(total * 100) / 100;
}

/** When a game ended: the eightieth minute, or the last thing that happened in it (extra time, a late penalty). */
export function endOf(game) {
  let end = 80;
  for (const side of ['home', 'away']) {
    for (const player of game.players[side]) for (const [, minute] of [...player.events, ...player.subs]) end = Math.max(end, minute);
  }
  return Math.min(100, end);
}

const round2 = x => Math.round(x * 100) / 100;
const counts = () => Object.create(null);
const bump = (map, key, by = 1) => { map[key] = (map[key] ?? 0) + by; };

/**
 * The snapshot of the window's games (`games`: [{ fixture, game }], fixture.kind 'club' or 'test'; `seasons`: [{ key,
 * from, to }] newest first). → { seasons, teams, games, players }: see docs/design/rugby-union.md "The snapshot".
 */
export function snapshotOf({ seasons, competitions, games, source = {} }) {
  const seasonOfDate = at => seasons.findIndex(season => at >= season.from && at < season.to);
  const ordered = games.slice().sort((a, b) => a.fixture.epoch - b.fixture.epoch || a.fixture.id - b.fixture.id);
  const teams = new Map();
  const rows = [];
  const players = new Map();
  // Tries by the scorer's place in the team sheet, a competition's season at a time: a starter's position, or the bench.
  const tryPlaces = new Map();
  // The games whose team sheets RugbyPass does not hold (Super Rugby's 2025 from its tenth round, a few Tests).
  const sheetless = [];
  // A team is a club if it played any club game of the window: Super Rugby's Australian sides also met the Lions on
  // their 2025 tour, a Test competition's game. A nation on the map never plays as a club.
  const inWindow = ordered.filter(({ fixture }) => seasonOfDate(fixture.epoch * 1000) >= 0);
  const clubSides = new Set(inWindow.filter(({ fixture }) => fixture.kind === 'club').flatMap(({ game }) => [game.home.id, game.away.id]));
  for (const { fixture, game } of inWindow) {
    const s = seasonOfDate(fixture.epoch * 1000);
    for (const team of [game.home, game.away]) {
      const kind = clubSides.has(team.id) ? 'club' : 'test';
      if (kind === 'club' && nationOfTeam(team.name)) throw new Error(`${team.name} (${team.id}) is a nation and plays club games`);
      teams.set(team.id, { name: team.name, kind });
    }
    // A game RugbyPass holds no team sheets for keeps its score; its counts are unknown (null) where its summary is empty.
    if (!game.players.home.length && !game.players.away.length) sheetless.push(game.id);
    const summary = title => (game.summary[title] ?? ['0', '0']).map(v => (v == null ? null : Number.parseInt(v, 10) || 0));
    const penaltyTries = game.summary.Tries?.[0] === null ? [null, null]
      : ['home', 'away'].map(side => game.scoring.filter(e => e.type === 'penalty-try' && e.side === side).length);
    rows.push([game.id, s, fixture.competition, game.date.slice(0, 10), game.home.id, game.away.id, game.homeScore, game.awayScore,
      game.venue ?? '', ...summary('Tries'), ...summary('Conversions'), ...summary('Penalty Goals'), ...summary('Drop Goals'), ...penaltyTries]);
    const end = endOf(game);
    for (const side of ['home', 'away']) {
      const team = side === 'home' ? game.home : game.away;
      for (const p of game.players[side]) {
        const minutes = minutesOf(p, end);
        if (!(minutes > 0)) continue;
        if (!players.has(p.id)) players.set(p.id, { id: p.id, name: p.name, seasons: seasons.map(() => null) });
        const player = players.get(p.id);
        player.name = p.name;
        const season = player.seasons[s] ??= { stints: new Map(), starts: counts(), bench: counts(), totals: Object.fromEntries(TOTALS.map(k => [k, 0])) };
        const stint = season.stints.get(team.id) ?? [team.id, 0, 0, 0];
        stint[1] += 1;
        if (p.number <= 15) stint[2] += 1;
        stint[3] = round2(stint[3] + minutes);
        season.stints.set(team.id, stint);
        if (p.number <= 15) bump(season.starts, NUMBER_POSITION[p.number]);
        else if (LABEL_POSITION[p.position]) bump(season.bench, LABEL_POSITION[p.position]);
        for (const [type] of p.events) if (EVENT_OF[type]) season.totals[EVENT_OF[type]] += 1;
        const tries = p.events.filter(([type]) => type === 'try').length;
        if (tries) {
          const key = `${s}|${fixture.competition}`;
          if (!tryPlaces.has(key)) tryPlaces.set(key, counts());
          bump(tryPlaces.get(key), p.number <= 15 ? NUMBER_POSITION[p.number] : 'BENCH', tries);
        }
        for (const [total, stat] of Object.entries(STAT_OF)) season.totals[total] = round2(season.totals[total] + (Number(game.stats[stat]?.[p.uri]) || 0));
      }
    }
  }
  // Only the players of the clubs the season rates: those of the 2025/26 leagues, the map's and the pools'.
  const rated = new Set(rows.filter(row => row[1] === 0 && (LEAGUES.includes(row[2]) || POOL_LEAGUES.includes(row[2])))
    .flatMap(row => [row[4], row[5]]));
  const kept = [...players.values()].filter(player => player.seasons[0] && [...player.seasons[0].stints.keys()].some(id => rated.has(id)))
    .sort((a, b) => a.id - b.id);
  return {
    format: 1,
    source,
    seasons: seasons.map(season => season.key),
    competitions,
    core: CORE,
    totals: TOTALS,
    teams: Object.fromEntries([...teams.entries()].sort((a, b) => a[0] - b[0]).map(([id, team]) => [id, [team.name, team.kind]])),
    sheetless: sheetless.sort((a, b) => a - b),
    games: rows,
    tryPlaces: [...tryPlaces.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, places]) => {
      const [s, competition] = key.split('|');
      return [Number(s), competition, Object.fromEntries([...POSITIONS, 'BENCH'].filter(code => places[code]).map(code => [code, places[code]]))];
    }),
    players: kept.map(player => [player.id, player.name, player.seasons.map(season => (season
      ? [[...season.stints.values()], sortedCounts(season.starts), sortedCounts(season.bench), TOTALS.map(k => season.totals[k])]
      : null))]),
  };
}

const sortedCounts = map => Object.fromEntries(POSITIONS.filter(code => map[code]).map(code => [code, map[code]]));

/** The snapshot as text: one game or player a line, so a diff reads. */
export function snapshotText(snapshot) {
  const { sheetless = [], games, tryPlaces, players, ...head } = snapshot;
  const lines = JSON.stringify(head, null, 1).replace(/\n}$/, '');
  const list = (name, rows) => ` "${name}": [\n${rows.map(row => `  ${JSON.stringify(row)}`).join(',\n')}\n ]`;
  return `${lines},\n "sheetless": ${JSON.stringify(sheetless)},\n${list('games', games)},\n${list('tryPlaces', tryPlaces)},\n`
    + `${list('players', players)}\n}\n`;
}

// ---------- the season ----------

/** A snapshot player's season as the method reads it, or null. */
function seasonRecord(row, teams) {
  if (!row) return null;
  const [stints, starts, bench, totals] = row;
  const kind = id => teams[id]?.[1];
  return {
    stints: stints.map(([team, games, starts, minutes]) => ({ team, games, starts, minutes, kind: kind(team) })),
    starts, bench, totals: Object.fromEntries(TOTALS.map((k, i) => [k, totals[i]])),
  };
}

const sum = xs => xs.reduce((s, x) => s + x, 0);
const median = xs => { const s = xs.slice().sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const most = map => POSITIONS.reduce((best, code) => ((map?.[code] ?? 0) > (map?.[best] ?? 0) ? code : best), POSITIONS[0]);
const any = map => POSITIONS.some(code => map?.[code]);

/** A player's core points in a season: his totals at CORE's weights, a try at his position's. */
export function corePoints(totals, position) {
  let points = totals.tries * (FORWARDS.has(position) ? CORE.tries.forward : CORE.tries.back);
  for (const key of TOTALS) if (key !== 'tries') points += totals[key] * CORE[key].points;
  return Math.round(points * 1000) / 1000;
}

/** A quarter of a season's club games, in minutes: a season counts toward a reliability only past it. */
export const QUARTER_SEASON = 480;

/**
 * The matchday's share of a position's players and the ratings it is read against (docs/design/computed-ratings.md, "A
 * sport no game has ever rated"): the clubs' matchday 23 at their positions on the default shape, 73/76/80/84/90 at
 * p5/p25/p50/p75/p95, and every player below them on a straight line from 60 up to where the shape starts. `count` players at the position,
 * `lineup` of them the clubs' matchday places there (the plan's count at it × the clubs).
 */
export const SHAPE = Object.freeze([[0, 71.5], [0.05, 73], [0.25, 76], [0.5, 80], [0.75, 84], [0.95, 90], [1, 92]]);
export const DEPTH = Object.freeze([60, SHAPE[0][1]]);
export function referenceFor(count, lineup) {
  const share = Math.min(1, lineup / count);
  const read = q => {
    for (let i = 1; i < SHAPE.length; i++) {
      const [q1, r1] = SHAPE[i], [q0, r0] = SHAPE[i - 1];
      if (q <= q1) return r0 + (r1 - r0) * (q - q0) / (q1 - q0);
    }
    return SHAPE.at(-1)[1];
  };
  return Array.from({ length: count }, (_, i) => {
    const p = (i + 0.5) / count;
    if (p >= 1 - share) return read((p - (1 - share)) / share);
    return DEPTH[0] + (DEPTH[1] - DEPTH[0]) * (p / (1 - share));
  });
}

const LINEUP_PLACES = { PR: 4, HK: 2, LK: 3, FL: 3, N8: 1, SH: 2, FH: 2, CE: 3, WG: 2, FB: 1 };
/** A club's squad: its matchday 23 and its best players left, up to this many. */
export const ROSTER_SIZE = 30;
const byRating = (a, b) => b.rating - a.rating || a.name.localeCompare(b.name);
const fielded = p => ({ ...p, positions: p.others.length ? [p.pos, ...p.others] : undefined });

/** The lineup the game picks from `pool`, then the best players left, up to a squad of ROSTER_SIZE. */
export function rosterOf(pool) {
  const sorted = pool.slice().sort(byRating).map(fielded);
  const lineup = selectLineup({ sport: SPORT, squad: sorted });
  const starters = new Set(lineup.starters.map(player => player.originalIndex));
  const depth = sorted.filter((player, i) => !starters.has(i)).slice(0, ROSTER_SIZE - lineup.starters.length);
  const squad = [...lineup.starters.map(player => sorted[player.originalIndex]), ...depth]
    .sort((a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || byRating(a, b));
  return { squad, lineup: selectLineup({ sport: SPORT, squad }) };
}

/** The strength the match model plays a pool at: its matchday 23's (rugbyUnionStrength). */
const strengthOf = pool => rugbyUnionStrength(selectLineup({ sport: SPORT, squad: pool.map(fielded) }));

/**
 * As computed-ratings.mjs's ratingsOf, unrounded: each value's mid-rank percentile among `values` (ties sharing one),
 * read off `reference` (ascending) by linear interpolation. → Map value → reading. A pool league's ratings are these
 * readings moved by its offset, then rounded and held to 1–99, so that its offset can be fitted on unrounded ratings.
 */
function readingsOf(values, reference) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length, m = reference.length;
  const out = new Map();
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && sorted[j + 1] === sorted[i]) j++;
    const p = ((i + j) / 2 + 0.5) / n;
    const h = Math.min(Math.max(p * m - 0.5, 0), m - 1);
    const lo = Math.floor(h), hi = Math.ceil(h);
    out.set(sorted[i], reference[lo] + (reference[hi] - reference[lo]) * (h - lo));
    i = j + 1;
  }
  return out;
}

/** The European cups, whose games tie the three leagues' clubs together. */
const CUPS = Object.freeze(['european-champions-cup', 'challenge-cup']);
/** How far a pool league's offset must still move before its fit stops, and the most solves it is given. */
const SETTLED = 0.005, SOLVES = 20;

/**
 * A matchday 23's strength per point of its `scale`'s players (`rugbyUnionStrength`, the lineup fixed): the share of the
 * side that is theirs, each place weighed as the match model weighs it (a replacement a third of a game).
 */
function shareOf(lineup, scale, strength = rugbyUnionStrength(lineup)) {
  const step = 0.01;
  const moved = { ...lineup, slots: lineup.slots.map(slot => (slot.player?.scale === scale
    ? { ...slot, effectiveRating: slot.effectiveRating + step, player: { ...slot.player, effectiveRating: slot.player.effectiveRating + step } }
    : slot)) };
  return (rugbyUnionStrength(moved) - strength) / step;
}

/** The solution x of `a` x = `b` (a small square system), by Gaussian elimination with partial pivoting. */
function solve(a, b) {
  const k = b.length, m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < k; col++) {
    let pivot = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) throw new Error('A pool league\'s offset has no nation to fit it');
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const factor = m[r][col] / m[col][col];
      for (let c = col; c <= k; c++) m[r][c] -= factor * m[col][c];
    }
  }
  return m.map((row, i) => row[k] / row[i]);
}

/**
 * The season (docs/design/rugby-union.md "The method"): `snapshot` and the clubs (`clubs`: RugbyPass team id → the
 * spec in scripts/data/rugby-union-clubs.json). → { players, clubs, nations, report }.
 */
export function seasonOf(snapshot, clubs, { perPoint = null, offsets: fixed = null } = {}) {
  const teams = snapshot.teams;
  const s0Games = snapshot.games.filter(row => row[1] === 0);
  const teamsIn = competitions => new Set(s0Games.filter(row => competitions.includes(row[2])).flatMap(row => [row[4], row[5]]));
  const leagueTeams = teamsIn(LEAGUES);
  // Each pool league's 2025/26 clubs.
  const poolLeagueOf = new Map(POOL_LEAGUES.flatMap(league => [...teamsIn([league])].map(id => [id, league])));
  for (const id of [...leagueTeams, ...poolLeagueOf.keys()]) if (!clubs[id]) throw new Error(`No club spec for ${teams[id]?.[0]} (${id})`);
  // The games RugbyPass holds no team sheets for: their scores count among the results, but as no minutes were recorded in
  // them, they count toward no club's minutes and no nation's Tests.
  const sheetless = new Set(snapshot.sheetless ?? []);
  // Each club's games in each season with team sheets: its league's and the European cups' (and a game against the Lions).
  const clubGames = snapshot.seasons.map((_, s) => {
    const n = new Map();
    for (const row of snapshot.games) {
      if (row[1] !== s || teams[row[4]]?.[1] !== 'club' || sheetless.has(row[0])) continue;
      for (const id of [row[4], row[5]]) n.set(id, (n.get(id) ?? 0) + 1);
    }
    return n;
  });

  // Step 1: who plays, where, and for whom.
  const players = [];
  const left = [];
  for (const [id, name, rows] of snapshot.players) {
    const seasons = rows.map(row => seasonRecord(row, teams));
    const now = seasons[0];
    // His club: the one he played the most minutes for in 2025/26 of the three leagues' and the pool leagues' clubs alike
    // (the later of two as many); his scale, Europe's or his pool league's.
    const ratedStints = now.stints.filter(stint => leagueTeams.has(stint.team) || poolLeagueOf.has(stint.team));
    const club = clubOfStints(ratedStints.map(stint => ({ club: stint.team, minutes: stint.minutes, games: stint.games })));
    if (club == null) { left.push({ id, name, why: 'no 2025/26 game for a club of the leagues rated' }); continue; }
    const scale = poolLeagueOf.get(club) ?? EUROPE;
    const started = seasons.find(season => any(season?.starts));
    const benched = seasons.find(season => any(season?.bench));
    const pos = started ? most(started.starts) : benched ? most(benched.bench) : null;
    if (!pos) { left.push({ id, name, why: 'no position: never in a team sheet with one' }); continue; }
    // Every other position he started at at least twice, and a specialist's place he sat on the bench for as often (a
    // utility back as the replacement scrum-half, a prop covering hooker). RugbyPass's labels for the other replacements
    // follow the shirt's usual place as often as the player's (the Top 14's 23 reads "Prop"), so they name no position.
    const others = POSITIONS.filter(code => code !== pos && ((now.starts[code] ?? 0) >= 2 || (BENCH_SPECIALISTS.has(code) && (now.bench[code] ?? 0) >= 2)));
    // His nation: the side he played his latest Test for (the one he played most minutes for in that season).
    let nation = null, test = null;
    for (const season of seasons) {
      const tests = (season?.stints ?? []).filter(stint => stint.kind === 'test' && nationOfTeam(teams[stint.team][0]));
      if (!tests.length) continue;
      const best = tests.reduce((a, b) => (b.minutes > a.minutes ? b : a));
      test = teams[best.team][0];
      nation = nationOfTeam(test);
      break;
    }
    players.push({ id, name, club, scale, pos, others, nation, test, seasons });
  }

  // Step 3: each player's signals over the window.
  for (const player of players) {
    const records = player.seasons.map((season, s) => {
      if (!season) return null;
      const clubStints = season.stints.filter(stint => stint.kind === 'club');
      const main = clubOfStints(clubStints.map(stint => ({ club: stint.team, minutes: stint.minutes, games: stint.games })));
      const exposure = main == null ? 0 : 80 * (clubGames[s].get(main) ?? 0);
      const clubMinutes = sum(clubStints.map(stint => stint.minutes));
      const testMinutes = sum(season.stints.filter(stint => stint.kind === 'test'
        && (nationOfTeam(teams[stint.team][0]) || teams[stint.team][0] === LIONS)).map(stint => stint.minutes));
      const minutes = sum(season.stints.map(stint => stint.minutes));
      return {
        selection: exposure > 0 ? { exposure, events: Math.min(clubMinutes, exposure) } : null,
        tests: { exposure: 1, events: testMinutes },
        production: minutes > 0 ? { exposure: minutes / 80, events: corePoints(season.totals, player.pos) } : null,
        clubMinutes, minutes,
      };
    });
    player.records = records;
    player.selection = pooled(records.map(r => r?.selection));
    player.tests = pooled(records.map(r => r?.tests));
    player.production = pooled(records.map(r => r?.production));
    const now = player.seasons[0].totals;
    player.goals = now.conversions + now.penaltyGoals;
    player.dropGoals = now.dropGoals;
  }

  // Values within each position, on each scale apart: the three leagues' players together, as one, and each pool
  // league's by itself. Every scale reads its ranks off the same shape; a pool league's are then moved by its offset.
  const groups = {};
  const pools = Object.fromEntries(POOL_LEAGUES.map(league => [league, { groups: {} }]));
  const readings = [];
  for (const scale of [EUROPE, ...POOL_LEAGUES]) {
    const into = scale === EUROPE ? groups : pools[scale].groups;
    for (const pos of POSITIONS) {
      const group = players.filter(player => player.scale === scale && player.pos === pos);
      if (!group.length) continue;
      // Reliabilities: a signal's rank correlation between the two latest seasons, among players with a quarter season in both.
      const both = group.filter(p => p.records[0]?.minutes >= QUARTER_SEASON && p.records[1]?.minutes >= QUARTER_SEASON
        && p.records[0].selection && p.records[1].selection);
      const single = (p, s, key) => {
        const r = p.records[s];
        if (key === 'selection') return r.selection.events / r.selection.exposure;
        if (key === 'tests') return r.tests.events;
        return r.production.events / r.production.exposure;
      };
      const reliability = Object.fromEntries(['selection', 'tests', 'production'].map(key => [key,
        both.length >= 8 ? seasonReliability(both.map(p => single(p, 0, key)), both.map(p => single(p, 1, key))) : 0.5]));
      // Production shrinks toward replacement level by a prior from its reliability at a typical season's games.
      const typical = median(group.filter(p => p.records[0]?.minutes >= QUARTER_SEASON).map(p => p.records[0].minutes / 80)) || 10;
      const prior = priorFromReliability(Math.min(0.95, Math.max(0.05, reliability.production)), typical);
      const replacement = replacementRate(group.map(p => ({ n: p.production.n, x: p.production.x })));
      for (const p of group) {
        p.rate = p.production.n > 0 ? shrunkRate(p.production, prior, replacement) : replacement;
        p.share = p.selection.n > 0 ? p.selection.x / p.selection.n : 0;
        p.testMinutes = p.tests.n > 0 ? p.tests.x / p.tests.n : 0;
      }
      const { values, weights } = blend([
        { values: group.map(p => p.share), reliability: reliability.selection },
        { values: group.map(p => p.testMinutes), reliability: reliability.tests },
        { values: group.map(p => p.rate), reliability: reliability.production },
      ]);
      group.forEach((p, i) => { p.value = Math.round(values[i] * 1e6) / 1e6; });
      // Step 4: the value's rank read off the reference.
      const clubsHere = new Set(group.map(p => p.club)).size;
      const reference = referenceFor(group.length, LINEUP_PLACES[pos] * clubsHere);
      const rating = ratingsOf(group.map(p => p.value), reference);
      for (const p of group) p.rating = p.base = rating.get(p.value);
      if (scale !== EUROPE) readings.push({ scale, group, reading: readingsOf(group.map(p => p.value), reference) });
      into[pos] = { players: group.length, regulars: both.length, reliability, weights, prior: Math.round(prior * 100) / 100,
        typical: Math.round(typical * 100) / 100, replacement: Math.round(replacement * 1000) / 1000 };
    }
  }
  // The pool leagues' players at their leagues' offsets: unrounded while the offsets are fitted, then rounded and held.
  const offsets = Object.fromEntries(POOL_LEAGUES.map(league => [league, 0]));
  const atOffsets = ({ round }) => {
    for (const { scale, group, reading } of readings) {
      for (const p of group) {
        const read = reading.get(p.value) + offsets[scale];
        p.rating = p.base = round ? Math.min(99, Math.max(1, Math.round(read))) : read;
      }
    }
  };

  // Step 5: clubs moved toward their 2025/26 results: the three leagues' clubs by their games together (the European cups
  // tie them), each pool league's by its own. Their Simple Rating System, a home edge fitted and a game away from the home
  // side's usual ground neutral; each set keeps its mean strength.
  const m = perPoint ?? perPointOf({ play: (delta, rng) => marginOfGap(delta, rng), rng: makeRng(hashStr('rugby union per point')), games: 6000 });
  const moves = {};
  const moveClubs = (ids, games) => {
    const homeGround = new Map();
    for (const row of games) {
      const at = homeGround.get(row[4]) ?? new Map();
      at.set(row[8], (at.get(row[8]) ?? 0) + 1);
      homeGround.set(row[4], at);
    }
    const groundOf = id => [...(homeGround.get(id) ?? new Map()).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    const srs = srsOf(games.map(row => ({ home: String(row[4]), away: String(row[5]), homeScore: row[6], awayScore: row[7],
      neutral: row[8] !== groundOf(row[4]) })));
    const squads = new Map([...ids].map(id => [id, players.filter(p => p.club === id)]));
    // The strength a club's move matches is the one the match model plays: its matchday 23's.
    const before = new Map([...squads.entries()].map(([id, pool]) => [id, strengthOf(pool)]));
    const level = sum([...before.values()]) / before.size;
    const centre = sum([...ids].map(id => srs.ratings[String(id)])) / ids.size;
    const { scale, targets } = resultsTargets({ ratings: Object.fromEntries([...ids].map(id => [id, srs.ratings[String(id)] - centre])),
      reliability: srs.reliability }, { mean: level, perPoint: m });
    for (const [id, pool] of squads) {
      const move = clubMoveOf(pool, targets[id], strengthOf, { bestFirst: (a, b) => b.rating - a.rating });
      move.pool.forEach((moved, i) => { pool[i].rating = moved.rating; });
      moves[id] = { srs: Math.round(srs.ratings[String(id)] * 100) / 100, target: Math.round(targets[id] * 100) / 100, shift: move.shift,
        plus: move.plus, before: Math.round(move.before * 100) / 100, after: Math.round(move.after * 100) / 100 };
    }
    return { squads, srs, scale, level };
  };
  const europe = moveClubs(leagueTeams, s0Games.filter(row => LEAGUES.includes(row[2]) || CUPS.includes(row[2])));

  // A nation's team plays at its Test results' level (docs/design/computed-ratings.md, "National teams drawn from many
  // leagues": the order inside from the club evidence, the team from its results): its players, at their own ratings
  // before any club moves (Leinster's internationals rest through much of its URC season, so its results say less of them
  // than of the club), move by its 2025/26 Tests' Simple Rating System as a club moves by its season's. Only a nation whose
  // Test minutes that season the rated players played almost all of (COVERED) is moved: another's squad is not the side
  // its results were won with, so its players keep their own ratings.
  const tests = s0Games.filter(row => teams[row[4]]?.[1] === 'test' && nationOfTeam(teams[row[4]][0]) && nationOfTeam(teams[row[5]][0]));
  const testSrs = srsOf(connectedTo(tests, 'France', teams).map(row => ({ home: teams[row[4]][0], away: teams[row[5]][0], homeScore: row[6],
    awayScore: row[7], neutral: false })));
  const testsOf = new Map();
  for (const row of tests) for (const id of [row[4], row[5]]) testsOf.set(teams[id][0], (testsOf.get(teams[id][0]) ?? 0) + 1);
  // Every 2025/26 Test a nation played, one against the Lions or a side off the map too: what its players' Test minutes
  // are counted against (Australia's third Test against the Lions fell on 2 August 2025).
  const playedOf = new Map();
  for (const row of s0Games) {
    if (teams[row[4]]?.[1] !== 'test' || teams[row[5]]?.[1] !== 'test' || sheetless.has(row[0])) continue;
    for (const id of [row[4], row[5]]) if (nationOfTeam(teams[id][0])) playedOf.set(teams[id][0], (playedOf.get(teams[id][0]) ?? 0) + 1);
  }
  const coverageBy = list => {
    const minutes = new Map();
    for (const player of list) {
      for (const stint of player.seasons[0].stints) {
        const name = teams[stint.team][0];
        if (stint.kind === 'test' && nationOfTeam(name)) minutes.set(name, (minutes.get(name) ?? 0) + stint.minutes);
      }
    }
    return name => (minutes.get(name) ?? 0) / Math.max(1, (playedOf.get(name) ?? 0) * 80 * 15);
  };
  const nationName = id => [...testsOf.keys()].find(name => nationOfTeam(name) === id);
  const nationStrength = pool => rugbyUnionStrength(rosterOf(pool).lineup);
  // The nations' pools of `list`'s players, each at his own rating (before any club moves).
  const nationPoolsOf = list => {
    const nationPools = new Map();
    for (const player of list) {
      if (player.nation == null) continue;
      if (!NATIONS[player.nation]) throw new Error(`${player.name}: the game has no nation ${player.nation}`);
      if (!nationPools.has(player.nation)) nationPools.set(player.nation, []);
      nationPools.get(player.nation).push({ ...player, rating: player.base });
    }
    return nationPools;
  };
  const coveredOf = (nationPools, coverage) => [...nationPools.keys()].filter(id => {
    const name = nationName(id);
    return name && Object.hasOwn(testSrs.ratings, name) && coverage(name) >= COVERED && nationPools.get(id).length * 2 >= 23;
  });
  // The line every nation's level is read off, as before the pool leagues were read: the nations the three leagues' players
  // cover by themselves, their mean strength at their Tests' mean rating, √reliability ÷ m a point of Test rating.
  const europeans = players.filter(p => p.scale === EUROPE);
  const europePools = nationPoolsOf(europeans);
  const anchor = coveredOf(europePools, coverageBy(europeans));
  const coverage = coverageBy(players);
  const nationMoves = {};
  let line = null, covered = [];
  let nationPools = nationPoolsOf(players);
  if (anchor.length >= 2) {
    const strengths = anchor.map(id => nationStrength(europePools.get(id)));
    const ratings = anchor.map(id => testSrs.ratings[nationName(id)]);
    const level = sum(strengths) / anchor.length;
    const centre = sum(ratings) / anchor.length;
    const rated = [...new Set(Object.keys(testSrs.ratings).map(nationOfTeam))].filter(id => nationName(id));
    const { targets } = resultsTargets({ ratings: Object.fromEntries(rated.map(id => [id, testSrs.ratings[nationName(id)] - centre])),
      reliability: testSrs.reliability }, { mean: level, perPoint: m });
    // Where the anchor's players stand to their Tests before any move: their nations' strength against their Test rating,
    // by least squares. Players' own ratings bunch the nations together (a Test minute counts alike whoever it is played
    // for), so France's stand below the line and Wales's and Italy's above it; a pool league is on the anchor's scale when
    // its nations stand as the anchor's would at their Test ratings.
    const slope = sum(ratings.map((r, i) => (r - centre) * (strengths[i] - level))) / sum(ratings.map(r => (r - centre) ** 2));
    const standsAt = id => level + slope * (testSrs.ratings[nationName(id)] - centre);
    line = { level: Math.round(level * 100) / 100, centre: Math.round(centre * 100) / 100, slope: Math.round(slope * 10000) / 10000 };
    covered = coveredOf(nationPools, coverage);
    if (fixed) Object.assign(offsets, fixed);
    else {
      // Each pool league's offset: the one at which the covered nations its players play for stand where the anchor's would,
      // each counting by the share of its matchday 23's strength the league's players hold (the three leagues' players
      // already on the anchor's scale). Least squares on unrounded ratings, solved again from each answer's lineups (a step
      // that does not lower the squares halved, as a lineup that changes with the offsets can turn it back) until it
      // settles; then rounded to a tenth.
      const standing = () => {
        atOffsets({ round: false });
        const unrounded = nationPoolsOf(players);
        return covered.map(id => {
          const { lineup } = rosterOf(unrounded.get(id));
          const strength = rugbyUnionStrength(lineup);
          return { gap: strength - standsAt(id), share: POOL_LEAGUES.map(league => shareOf(lineup, league, strength)) };
        });
      };
      const squares = standings => sum(standings.map(n => n.gap ** 2));
      let standings = standing();
      const fitted = POOL_LEAGUES.filter((league, i) => standings.some(n => n.share[i] > 0));
      const index = fitted.map(league => POOL_LEAGUES.indexOf(league));
      let solves = 0;
      while (fitted.length && solves < SOLVES) {
        solves++;
        const normal = index.map(i => index.map(j => sum(standings.map(n => n.share[i] * n.share[j]))));
        const delta = solve(normal, index.map(i => -sum(standings.map(n => n.share[i] * n.gap))));
        const from = { ...offsets };
        let next = null, step = 1;
        for (;;) {
          fitted.forEach((league, k) => { offsets[league] = from[league] + step * delta[k]; });
          const trial = standing();
          if (squares(trial) < squares(standings)) { next = trial; break; }
          if ((step /= 2) < 1 / 64) break;
        }
        if (!next) { Object.assign(offsets, from); break; }
        standings = next;
        if (Math.max(...delta.map(d => Math.abs(step * d))) < SETTLED) break;
      }
      for (const league of POOL_LEAGUES) offsets[league] = Math.round(offsets[league] * 10) / 10;
      line.solves = solves;
    }
    atOffsets({ round: true });
    nationPools = nationPoolsOf(players);
    for (const id of covered) {
      const { lineup } = rosterOf(nationPools.get(id));
      const share = Object.fromEntries([EUROPE, ...POOL_LEAGUES].map(scale => [scale, Math.round(shareOf(lineup, scale) * 1000) / 1000])
        .filter(([, x]) => x > 0));
      const move = clubMoveOf(nationPools.get(id), targets[id], nationStrength, { bestFirst: (a, b) => b.rating - a.rating });
      nationPools.set(id, move.pool);
      nationMoves[id] = { srs: Math.round(testSrs.ratings[nationName(id)] * 100) / 100, coverage: Math.round(coverage(nationName(id)) * 1000) / 1000,
        share, stands: Math.round(standsAt(id) * 100) / 100, target: Math.round(targets[id] * 100) / 100, shift: move.shift, plus: move.plus,
        before: Math.round(move.before * 100) / 100, after: Math.round(move.after * 100) / 100 };
    }
  } else {
    if (fixed) Object.assign(offsets, fixed);
    atOffsets({ round: true });
    nationPools = nationPoolsOf(players);
  }

  // Each pool league's clubs moved toward their own results, at its offset.
  const squads = new Map(europe.squads);
  for (const league of POOL_LEAGUES) {
    const ids = new Set([...poolLeagueOf].filter(([, of]) => of === league).map(([id]) => id));
    if (!ids.size) continue;
    const moved = moveClubs(ids, s0Games.filter(row => row[2] === league));
    for (const [id, pool] of moved.squads) squads.set(id, pool);
    Object.assign(pools[league], { offset: offsets[league], srs: { homeEdge: moved.srs.homeEdge, sigma: moved.srs.sigma,
      reliability: moved.srs.reliability }, scale: moved.scale, level: moved.level });
  }

  // The clubs' squads, strongest first.
  const builtClubs = [...squads.entries()].map(([id, pool]) => {
    const spec = clubs[id];
    const { squad, lineup } = rosterOf(pool);
    const crossing = lineup.slots.filter(slot => !slot.player || slot.penalty > RUGBY_NEAR_PENALTY);
    return { rpid: id, ...spec, str: lineup.rating, strength: strengthOf(squad), squad, crossing: crossing.map(slot => slot.position) };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));

  const nations = [...nationPools.entries()].map(([id, pool]) => {
    const { squad, lineup } = rosterOf(pool);
    const open = lineup.slots.filter(slot => !slot.player || slot.penalty > RUGBY_NEAR_PENALTY);
    const filled = lineup.slots.map(slot => (slot.player && slot.penalty <= RUGBY_NEAR_PENALTY ? slot.effectiveRating : BASELINE));
    return { id, name: NATIONS[id][0], str: Math.round(sum(filled) / filled.length), squad, open: open.map(slot => slot.position),
      coverage: nationName(id) ? Math.round(coverage(nationName(id)) * 1000) / 1000 : 0 };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));

  return {
    players, clubs: builtClubs, nations, left,
    report: { groups, srs: { homeEdge: europe.srs.homeEdge, sigma: europe.srs.sigma, reliability: europe.srs.reliability }, perPoint: m,
      scale: europe.scale, level: europe.level, moves, pools,
      tests: { homeEdge: testSrs.homeEdge, sigma: testSrs.sigma, reliability: testSrs.reliability, covered: COVERED, anchor, line,
        offsets, moves: nationMoves },
      window: WINDOW },
  };
}

/**
 * The real leagues' figures, each season's three leagues pooled (the Premiership's, the Top 14's and the URC's games,
 * finals included), from the snapshot: what the match model is checked against (scripts/simulation-realism.mjs,
 * REAL.union). → one `{ season, games, … }` a season, newest first. A conversion counts a penalty try, which RugbyPass counts
 * among the tries at seven points, as the model counts a converted try.
 */
export function realFigures(snapshot, competitions = LEAGUES) {
  const mean = xs => sum(xs) / Math.max(1, xs.length);
  const sd = xs => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
  const share = (xs, test) => xs.filter(test).length / Math.max(1, xs.length);
  return snapshot.seasons.map((season, s) => {
    const games = snapshot.games.filter(row => row[1] === s && competitions.includes(row[2]));
    const points = games.flatMap(row => [row[6], row[7]]);
    const pair = i => games.flatMap(row => [row[i], row[i + 1]]);
    const [tries, conversions, penaltyGoals, dropGoals, penaltyTries] = [9, 11, 13, 15, 17].map(pair);
    const margins = games.map(row => Math.abs(row[6] - row[7]));
    // Each league's table: its clubs' win shares (a draw half a win), its spread.
    const spreads = competitions.map(competition => {
      const table = new Map();
      for (const row of games.filter(r => r[2] === competition)) {
        for (const [id, won] of [[row[4], Math.sign(row[6] - row[7])], [row[5], Math.sign(row[7] - row[6])]]) {
          const t = table.get(id) ?? { w: 0, n: 0 };
          t.w += (won + 1) / 2;
          t.n += 1;
          table.set(id, t);
        }
      }
      return sd([...table.values()].map(t => t.w / t.n));
    });
    const places = {};
    for (const [at, competition, counted] of snapshot.tryPlaces) {
      if (at !== s || !competitions.includes(competition)) continue;
      for (const [place, n] of Object.entries(counted)) places[place] = (places[place] ?? 0) + n;
    }
    const placed = sum(Object.values(places));
    return {
      season, games: games.length, pointsPerTeam: mean(points), teamPointsSd: sd(points), triesPerTeam: mean(tries),
      conversionRate: (sum(conversions) + sum(penaltyTries)) / Math.max(1, sum(tries)), penaltyGoalsPerTeam: mean(penaltyGoals),
      dropGoalsPerGame: 2 * mean(dropGoals), draws: share(margins, m => m === 0), marginMean: mean(margins),
      byOneToSeven: share(margins, m => m > 0 && m <= 7), byFifteenPlus: share(margins, m => m >= 15), byThirtyPlus: share(margins, m => m >= 30),
      nilRate: share(points, p => p === 0), fortyPlusRate: share(points, p => p >= 40), homeWins: share(games, row => row[6] > row[7]),
      winPctSd: mean(spreads), tryShares: Object.fromEntries(Object.entries(places).map(([place, n]) => [place, n / placed])),
    };
  });
}

/** The share of a nation's Test minutes the clubs' players must have played for its Test results to move its squad. */
export const COVERED = 0.75;

/** The games (snapshot rows) in the part of their graph that `name`'s side is in: a rating needs its sides connected. */
function connectedTo(rows, name, teams) {
  const links = new Map();
  for (const row of rows) {
    for (const [a, b] of [[row[4], row[5]], [row[5], row[4]]]) {
      if (!links.has(a)) links.set(a, new Set());
      links.get(a).add(b);
    }
  }
  const start = [...links.keys()].find(id => teams[id][0] === name);
  const seen = new Set(start == null ? [] : [start]);
  for (const stack = [...seen]; stack.length;) for (const next of links.get(stack.pop()) ?? []) if (!seen.has(next)) { seen.add(next); stack.push(next); }
  return rows.filter(row => seen.has(row[4]));
}

/**
 * A squad player as the game's files hold it: `[name, 'FL/N8', rating, source]`, every position he plays, the source
 * marking the rating an estimate (src/data/estimates.js) with the goals and drop goals he kicked in 2025/26 (the match
 * model's kicker).
 */
export const tupleOf = p => [p.name, [p.pos, ...p.others].join('/'), p.rating,
  { source: 'estimate', edition: 'Estimated', league: 'Rugby union', ...(p.goals ? { goals: p.goals } : {}),
    ...(p.dropGoals ? { dropGoals: p.dropGoals } : {}) }];
