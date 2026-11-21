// Rocket League's ratings from Liquipedia's results (npm run sync:rocket-league) and its national teams (npm run
// build-rocket-league). No I/O: scripts/sync-rocket-league.mjs reads the export, scripts/build-rocket-league.mjs the
// snapshot this computes.
//
// Every rating is an Elo, built game by game from every 3v3 series the export holds, in date order: a team plays at
// the mean of its three players' Elo, the winner of each game takes K × (1 − E) from the loser (E, Elo's expected
// score for the gap), and each player moves by his team's amount. A player's K shrinks with the games he has played
// (`kFactor`), so a newcomer finds his level quickly and a veteran's rating holds. Nothing is estimated: a player is
// rated only from the games Liquipedia records him in, and only a player who has played lately (ACTIVE_DAYS) plays.
//
// A newcomer starts at his region's level: the RLCS region whose events he has played most games in, else his nation's
// (regionOfNation), each region's level fitted at once with every player's own strength (liquipedia-elo.mjs regionLevels),
// so a region whose teams mostly play each other is not rated as the world's equal (docs/design/rocket-league.md,
// "Regions").
//
// On the game's scale a rating is Elo / 25 − 2, so a rating point is 25 Elo points, as in tennis, and the match model
// plays Elo's own odds for each game (src/sports/rocketLeague.js); the levels are anchored so that Europe's newcomers start
// at 1,500 (58), as every newcomer once did. A nation names its best players by Elo (TEAM_SIZE); it needs three for a team,
// so a nation with fewer fields none and its land stays neutral.
import { createLiquipediaElo, regionByConfederation } from './liquipedia-elo.mjs';

export const SPORT = 'rocket-league';
export const TEAM_SIZE = 5;
export const MIN_PLAYERS = 3;
export const LINEUP = 3;
export const ELO_PER_POINT = 25;
const ELO_OFFSET = -50;
export const START = 1500;
export const SOURCE_ID = 'liquipedia';
export const EDITION = 'Liquipedia Elo';
export const WIKI = 'https://liquipedia.net/rocketleague/';
/** How long since his last game a player still plays for his nation: a year. */
export const ACTIVE_DAYS = 365;
/** The fewest games a player needs behind him to be rated at all. */
export const MIN_GAMES = 20;
/** The tiers that count: S-Tier (1), A-Tier (2) and B-Tier (3) 3v3 events. */
export const TIERS = Object.freeze([1, 2, 3]);

// K per game: K_SCALE / (games + 5) ^ 0.4, FiveThirtyEight's shape, never below K_FLOOR. A newcomer's first game moves
// him about 5.2 times a 300-game veteran's. K_SCALE is the one that best foresaw the last 180 days of the exports of
// 2026-11-14 and 15 (2,462 games, each scored before it was played; the regions' levels on, fitted on the games before):
// log loss 0.5759 at 320, 0.5924 at 110, 0.5815 at 180, 0.5774 at 240, 0.5771 at 400, 0.5809 at 500 (re-run 2026-11-21).
// Rocket League's form moves fast: rosters change and a team's level with them.
export const K_SCALE = 320;
export const K_FLOOR = 8;

/**
 * A nation's RLCS region, for a player no regional event places (homesOf): its confederation's, Australia with Oceania and
 * the Arab states (North Africa's among them) and Iran with the Middle East and North Africa, as the RLCS draws them.
 */
export const MENA_NATIONS = Object.freeze(['682', '784', '414', '634', '048', '512', '400', '422', '760', '368', '364', '275', '887',
  '818', '434', '788', '012', '504', '478', '736']);
export const regionOfNation = regionByConfederation({
  confederations: { UEFA: 'EU', CONMEBOL: 'SAM', CONCACAF: 'NA', AFC: 'APAC', CAF: 'SSA', OFC: 'OCE' },
  nations: { OCE: ['036'], MENA: MENA_NATIONS },
});


// ---------- the export, read ----------

/** Whether an event is a school's (Collegiate Rocket League): its players a pool of their own, outside the RLCS's regions. */
const isSchool = (title, tournament) => /^school$/i.test(tournament.tierType ?? '') || /^Collegiate Rocket League\//.test(title);

/**
 * Whether an event is played by national teams: the FIFAe World Cup and its regionals, the Esports Nations Cup and its
 * regionals (Rocket League's, on this wiki), whose rosters say whom each player plays for.
 */
const isNationsEvent = (title, tournament) => /FIFAe|Nations Cup/i.test(`${title} ${tournament.series ?? ''}`);

// The rules are the ones every Liquipedia esport shares (scripts/lib/liquipedia-elo.mjs), with Rocket League's numbers:
// the 3v3 events of the counted tiers, no school's.
const elo = createLiquipediaElo({
  wiki: WIKI, sourceId: SOURCE_ID, edition: EDITION, lineup: LINEUP, teamSize: TEAM_SIZE, minPlayers: MIN_PLAYERS,
  minGames: MIN_GAMES, activeDays: ACTIVE_DAYS, start: START, eloPerPoint: ELO_PER_POINT, eloOffset: ELO_OFFSET,
  kScale: K_SCALE, kFloor: K_FLOOR, position: 'PLR',
  skips: {
    mode: tournament => tournament.mode !== '3v3',
    tier: tournament => !TIERS.includes(tournament.tier),
    school: (tournament, title) => isSchool(title, tournament),
  },
  isNationsEvent,
  // A player's home is the RLCS region whose events he has played most games in, else his nation's.
  homeBy: 'event',
  regionOfNation,
});

export { abbreviationScore, ANCHOR, baseTeamName, BORROW_DAYS, binOdds, expected, flagOf, foldPlayers, homeOf, isRegionFlag, LEVEL_TAU,
  looseKey, nationalTeams, nationOfFlag, nationOfPlayer, ODDS_BINS, OFFSET_TAU, oddsBin, playerKey, rowOf, scoreOf } from './liquipedia-elo.mjs';

/** A player's Elo on the game's scale: Elo / 25 − 2, rounded. */
export const gameRating = elo.gameRating;
/** A player's K after `games` games. */
export const kFactor = elo.kFactor;
/**
 * Liquipedia's pages (readExport, every file's) → what the ratings play: the 3v3 tournaments of the counted tiers but no
 * school's, each with its teams and series, and what was left out and why (skipped: mode, tier, school, noInfobox).
 */
export const readTournaments = elo.readTournaments;
/** The three who start for a roster: its first three players who are no substitutes and did play. */
export const startersOf = elo.startersOf;
export const { seriesInOrder, runElo, crossRegion, homeEdge, homesOf, regionLevels, ratedPlayers, playersAsOf, playerOf, tupleOf,
  nationsOf, leftOut } = elo;
