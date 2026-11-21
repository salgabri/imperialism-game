// Counter-Strike's ratings from Liquipedia's results (npm run sync:counter-strike) and its national teams (npm run
// build-counter-strike). No I/O: scripts/sync-counter-strike.mjs reads the export, scripts/build-counter-strike.mjs the
// snapshot this computes. The rules are Rocket League's (scripts/lib/liquipedia-elo.mjs): an Elo of players, built map by
// map from every 5v5 series the export holds since Counter-Strike: Global Offensive began, a team playing at the mean of
// its five; only the numbers and the wiki's reading are Counter-Strike's.
//
// A newcomer starts at his region's level: his nation's region (regionOfNation; Counter-Strike's events seldom name one),
// each region's level fitted at once with every player's own strength (liquipedia-elo.mjs regionLevels), so a scene whose
// teams mostly play each other, as South Africa's do, is not rated as the world's equal (docs/design/counter-strike.md,
// "Regions").
//
// On the game's scale a rating is (Elo + ELO_OFFSET) / 25: a rating point is 25 Elo points, as in tennis and Rocket
// League, so the match model plays Elo's own odds for each map (src/sports/counterStrike.js); the levels are anchored so
// that Europe's newcomers start at 1,500 (58), as every newcomer once did. A nation names its best seven by Elo
// (TEAM_SIZE) and fields its five best; with fewer than five it fields none and its land stays neutral.
import { baseTeamName, createLiquipediaElo, nationalTeams as sharedNationalTeams, nationOfFlag, regionByConfederation }
  from './liquipedia-elo.mjs';
import { infoboxOf, plainText, templateIn, tournamentOf as readInfobox, truthy } from './liquipedia.mjs';

export const SPORT = 'counter-strike';
export const TEAM_SIZE = 7;
export const MIN_PLAYERS = 5;
export const LINEUP = 5;
export const ELO_PER_POINT = 25;
const ELO_OFFSET = -50;
export const START = 1500;
export const SOURCE_ID = 'liquipedia';
export const EDITION = 'Liquipedia Elo';
export const WIKI = 'https://liquipedia.net/counterstrike/';
/** How long since his last map a player still plays for his nation: a year. */
export const ACTIVE_DAYS = 365;
/** The fewest maps a player needs behind him to be rated at all. */
export const MIN_GAMES = 20;
/** The tiers that count: S-Tier (1), A-Tier (2) and B-Tier (3) events. */
export const TIERS = Object.freeze([1, 2, 3]);
/** Counter-Strike: Global Offensive's release: the ratings count its maps and Counter-Strike 2's, none of the older games'. */
export const FIRST_DAY = '2012-08-21';
// The wiki's `game` (Liquipedia's Module:Info for Counter-Strike): CS:GO, CS2, and the events that changed from one to
// the other. An infobox that names none is CS:GO's, the wiki's default, if it began after FIRST_DAY.
const GAMES = new Set(['csgo', 'cs2', 'csgocs2']);

// K per map: K_SCALE / (games + 5) ^ 0.4, never below K_FLOOR (liquipedia-elo.mjs's kFactor). K_SCALE is the one that best
// foresaw the last 180 days of the exports of 2026-11-15 (S-, A- and B-Tier: 6,487 maps, each scored before it was
// played; the regions' levels on, fitted on the maps before): log loss 0.6498 at 60, 0.6442 at 110, 0.6419 at 140, 0.6406
// at 180, 0.6408 at 240, 0.6434 at 320, 0.6476 at 400 (re-run 2026-11-21; without the levels 0.0002 to 0.0004 more at
// each). A map is a noisier test of two teams than a Rocket League game, so each moves its players less (Rocket League's
// K is 320).
export const K_SCALE = 180;
export const K_FLOOR = 8;

/**
 * A nation's Counter-Strike region (homesOf: a player's home is his nation's): its confederation's, with the scenes' own
 * lines: the former Soviet states the CIS's, Australia Oceania's, the Arab states (North Africa's among them) and Iran the
 * Middle East's; Turkey and Israel play Europe's, as their confederation does.
 */
export const MENA_NATIONS = Object.freeze(['682', '784', '414', '634', '048', '512', '400', '422', '760', '368', '364', '275', '887',
  '818', '434', '788', '012', '504', '478', '736']);
export const CIS_NATIONS = Object.freeze(['643', '804', '112', '398', '860', '417', '762', '795', '051', '031', '268', '498']);
export const regionOfNation = regionByConfederation({
  confederations: { UEFA: 'EU', CONMEBOL: 'SA', CONCACAF: 'NA', AFC: 'ASIA', CAF: 'AF', OFC: 'OCE' },
  nations: { CIS: CIS_NATIONS, OCE: ['036'], MENA: MENA_NATIONS },
});

// Counter-Strike's regions as Liquipedia's pages name them (an infobox's `region`, or a segment of its title), by the
// key the ratings use (regionOfNation's): a player whose nation is unknown is the region whose events he played most
// (homesOf). An event that names none, or the Americas' (both continents'), is international.
export const REGIONS = Object.freeze({
  EU: ['europe', 'eu', 'western europe', 'northern europe', 'southern europe', 'central europe', 'nordic', 'nordics', 'scandinavia',
    'benelux', 'balkans', 'baltics', 'iberia', 'dach', 'uk & ireland'],
  CIS: ['cis', 'commonwealth of independent states', 'eastern europe'],
  NA: ['north america', 'na'],
  SA: ['south america', 'sa', 'latin america', 'latam', 'latin america south', 'latin america north', 'brazil'],
  ASIA: ['asia', 'east asia', 'southeast asia', 'south asia', 'central asia', 'asia-pacific', 'asia pacific', 'apac', 'china'],
  OCE: ['oceania', 'oce', 'australia', 'anz'],
  MENA: ['middle east', 'mena', 'middle east & north africa', 'middle east and north africa', 'west asia'],
  AF: ['africa', 'sub-saharan africa', 'ssa'],
});

/**
 * A Counter-Strike event's infobox (liquipedia.mjs's tournamentOf, a team event unless it says otherwise, the regions
 * above), with the game it was played in (`game`, lower case: 'csgo', 'cs2'…; null when unnamed) and whether players
 * enter it alone (`individual`, `player_number`).
 */
export function tournamentOf(page) {
  const base = readInfobox(page, { mode: 'team', regions: REGIONS });
  if (!base) return null;
  const p = infoboxOf(page).params;
  return { ...base, game: plainText(p.game).toLowerCase() || null, individual: truthy(p.individual) || !!plainText(p.player_number) };
}

/** Whether an event was played in CS:GO or CS2: its `game`, else (unnamed, the wiki's default) its first day. */
export const isCounted = tournament => (tournament.game ? GAMES.has(tournament.game)
  : String(tournament.start ?? '') >= FIRST_DAY);

// National teams: the Esports Nations Cup, the IESF's World Esports Championship, WESG and the World Cyber Games, the
// national cups and leagues; or an event most of whose teams are named for a country (four or more teams, three in four
// of them a nation's name, "Team " in front or not).
const NATIONS_EVENT = /Nations Cup|Nations League|IESF|World Esports Championship|WESG|World Electronic Sports Games|World Cyber Games|National Team/i;
/** The nation a team's name is, "Team Denmark" as Denmark, or null for a club's. */
export const nationOfTeamName = name => nationOfFlag(baseTeamName(name)) ?? nationOfFlag(baseTeamName(name).replace(/^team\s+/i, ''));
/** Whether national teams play an event (its title, series and name; else its rosters' names). */
export function isNationsEvent(title, tournament, rosters = []) {
  if (NATIONS_EVENT.test(`${title} ${tournament.series ?? ''} ${tournament.name ?? ''}`)) return true;
  return rosters.length >= 4 && rosters.filter(roster => nationOfTeamName(roster.team)).length >= 0.75 * rosters.length;
}

// ---------- a map ----------

const count = value => (/^\s*\d+\s*$/.test(plainText(value)) ? Number(plainText(value)) : null);
const FORFEIT = new Set(['W', 'FF', 'L', 'DQ', '-']);

/**
 * A map's halves as Liquipedia's Counter-Strike wiki writes them (Module:MatchGroup/Input/Custom, read 2026-11-15 at
 * github.com/Liquipedia/Lua-Modules): `t1firstside` ('ct' or 't') and each side's rounds in each half (`t1ct`, `t1t`,
 * `t2t`, `t2ct`), then each overtime's the same under `o1`, `o2`… → [{ ot, rounds: [first team's, second's] }], the
 * regulation's two halves first (`ot` 0), then each overtime's (1, 2…); [] when the map records none.
 */
export function halvesOf(p) {
  const halves = [];
  for (let ot = 0; ot < 20; ot++) {
    const prefix = ot ? `o${ot}` : '';
    let side = plainText(p[`${prefix}t1firstside`]).toLowerCase();
    if (side !== 'ct' && side !== 't') break;
    for (let half = 0; half < 2; half++) {
      const other = side === 'ct' ? 't' : 'ct';
      const a = count(p[`${prefix}t1${side}`]), b = count(p[`${prefix}t2${other}`]);
      if (a == null || b == null) break;
      halves.push({ ot, rounds: [a, b] });
      side = other;
    }
  }
  return halves;
}

/**
 * A map of a series (`{{Map|map=Mirage|finished=true|t1firstside=ct|t1t=5|t1ct=7|t2t=4|t2ct=8|…}}`) → { map, rounds:
 * [first team's, second's] or null, halves (halvesOf), ot: the overtimes played, winner: 1 or 2 }, or null for a map not
 * played (no winner, or a forfeit's). The rounds are `score1` and `score2` where the wiki gives them, else the halves'
 * sum, as the wiki's module counts them; the winner is the map's own `winner`, else the side with more rounds.
 */
export function mapOf(value) {
  const template = templateIn(value);
  if (!template) return null;
  const p = template.params;
  const marks = [p.score1, p.score2].map(score => plainText(score).toUpperCase());
  if (truthy(p.walkover) || marks.some(mark => FORFEIT.has(mark))) return null;
  const halves = halvesOf(p);
  const given = [count(p.score1), count(p.score2)];
  const summed = halves.length ? [0, 1].map(side => halves.reduce((sum, half) => sum + half.rounds[side], 0)) : null;
  const rounds = given.every(n => n != null) ? given : summed;
  const named = Number(plainText(p.winner));
  const winner = named === 1 || named === 2 ? named : rounds && rounds[0] !== rounds[1] ? (rounds[0] > rounds[1] ? 1 : 2) : null;
  if (!winner) return null;
  const ot = halves.length ? Math.max(0, ...halves.map(half => half.ot)) : 0;
  return { map: plainText(p.map) || null, rounds, halves, ot, winner };
}

/** The rounds of a half in each format: Counter-Strike 2's MR12 (first to 13), CS:GO's MR15 (first to 16). */
export const HALF_ROUNDS = Object.freeze({ mr12: 12, mr15: 15 });

/**
 * Whether a map's final score (`rounds`) is one a format gives: first to half + 1 in regulation, the loser at most
 * half − 1; or from half–half, overtimes of six rounds, each first to four (a 3–3 overtime going to another), so after k
 * of them the winner has half + 3k + 1 and the loser half + 3k − 3 to half + 3k − 1 (16–12, 16–13, 16–14 in MR12's first).
 */
export function scoreFits(rounds, half) {
  if (!Array.isArray(rounds) || rounds.length !== 2 || !rounds.every(Number.isInteger)) return false;
  const high = Math.max(...rounds), low = Math.min(...rounds);
  if (high === half + 1) return low >= 0 && low <= half - 1;
  const periods = (high - half - 1) / 3;
  return Number.isInteger(periods) && periods >= 1 && low >= half + 3 * periods - 3 && low <= half + 3 * periods - 1;
}

/**
 * The format a map was played in → 'mr12', 'mr15' or null: its first half's rounds where the wiki records its halves (12
 * or 15), else its event's game (Counter-Strike 2's MR12, CS:GO's MR15), else the one format its score fits; and only if
 * its score fits that format (not a map cut short or a score mistyped). 16–14 and 19–15 fit both formats.
 */
export function formatOf(map, game = null) {
  const first = map?.halves?.find(half => half.ot === 0);
  const halfRounds = first ? first.rounds[0] + first.rounds[1] : null;
  const named = halfRounds === 12 ? 'mr12' : halfRounds === 15 ? 'mr15' : game === 'cs2' ? 'mr12' : game === 'csgo' ? 'mr15' : null;
  if (named) return scoreFits(map.rounds, HALF_ROUNDS[named]) ? named : null;
  const fitting = Object.keys(HALF_ROUNDS).filter(format => scoreFits(map?.rounds, HALF_ROUNDS[format]));
  return fitting.length === 1 ? fitting[0] : null;
}

// ---------- the ratings ----------

const elo = createLiquipediaElo({
  wiki: WIKI, sourceId: SOURCE_ID, edition: EDITION, lineup: LINEUP, teamSize: TEAM_SIZE, minPlayers: MIN_PLAYERS,
  minGames: MIN_GAMES, activeDays: ACTIVE_DAYS, start: START, eloPerPoint: ELO_PER_POINT, eloOffset: ELO_OFFSET,
  kScale: K_SCALE, kFloor: K_FLOOR, position: 'PLR',
  tournamentOf,
  skips: {
    mode: tournament => tournament.individual || !['team', '5v5'].includes(tournament.mode),
    game: tournament => !isCounted(tournament),
    tier: tournament => !TIERS.includes(tournament.tier),
    showmatch: tournament => /^(?:showmatch|points|ladder)$/i.test(tournament.tierType ?? ''),
  },
  isNationsEvent,
  nationOfTeamName,
  starters: LINEUP,
  gameOf: mapOf,
  // The wiki's team templates are often a word of the team's name: "eclot" for Dynamo Eclot, "unity.sk" for UNiTY esports.
  templateWords: true,
  // A player's home is his nation's region, else the region whose events he has played most games in: most of
  // Counter-Strike's events name no region (South Africa's leagues none), and 97% of its players have a country.
  homeBy: 'nation',
  regionOfNation,
});

export { ANCHOR, binOdds, expected, homeOf, isRegionFlag, LEVEL_TAU, looseKey, nationOfFlag, nationOfPlayer, ODDS_BINS, OFFSET_TAU, oddsBin,
  playerKey, rowOf, scoreOf } from './liquipedia-elo.mjs';
/** The nation each player last played for in a national-team event ("Team Denmark" as Denmark): liquipedia-elo.mjs's. */
export const nationalTeams = tournaments => sharedNationalTeams(tournaments, nationOfTeamName);
export const { gameRating, kFactor, readTournaments, startersOf, seriesInOrder, runElo, crossRegion, homeEdge, homesOf, regionLevels,
  ratedPlayers, playersAsOf, playerOf, tupleOf, nationsOf, leftOut } = elo;
