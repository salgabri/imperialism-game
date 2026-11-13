// Ice hockey's rules by era (docs/design/hockey.md, "Rules by era"): the goals an NHL club scored a game in each
// built-in season, from the pinned downloads that scripts/sync-nhl-seasons.mjs reads (data-src/nhl-seasons/); how long
// every playoff overtime ran, from NHL.com's lists (scripts/data/nhl-playoff-overtimes.json); how a season's clubs score
// and settle level games in the match model (`leagueScoring`); and the factor on a season's scoring rates that brings
// its clubs' games to its league's goals (`solveScoring`). Read by scripts/build-nhl-league.mjs, the realism harness
// and the tests.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { buildClub, hashStr, makeRng, teamEff } from '../../src/data/teams.js';
import { decodeFootballSet, seasonSport } from '../../src/engine/footballSets.js';
import { hockeyWith, lateOf, overtimeOf, PERIOD_MODEL } from '../../src/sports/hockey.js';
import { csvRecords, plainCsvColumns } from './nhl-stats.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** The season label of the season ending in `year`: 1982 → '1981/82', 2000 → '1999/00'. */
export const seasonLabel = year => `${year - 1}/${String(year).slice(-2)}`;

// ---------- the league's goals ----------

/**
 * A pinned download's bytes (scripts/data/nhl-seasons-sources.json), or null when it is not on the computer. A file
 * that is there but not the pinned one stops the build: its source has changed.
 */
export function pinnedReader(root) {
  const { sources } = JSON.parse(readFileSync(path.join(root, 'scripts/data/nhl-seasons-sources.json'), 'utf8'));
  return file => {
    const entry = sources[file];
    if (!entry) throw new Error(`${file} is not a source in scripts/data/nhl-seasons-sources.json`);
    const full = path.join(root, 'data-src/nhl-seasons', file);
    if (!existsSync(full)) return null;
    const bytes = readFileSync(full);
    if (sha256(bytes) !== entry.sha256) throw new Error(`data-src/nhl-seasons/${file} is not the pinned source (SHA-256 ${sha256(bytes)}, pinned ${entry.sha256})`);
    return bytes;
  };
}

/**
 * The Hockey Databank's Teams.csv → Map season label → { teamGames, goals }: every NHL club's games (G) and goals (GF)
 * summed, less its shoot-out wins (SoW): the databank, like the NHL, counts a shoot-out's winner one goal that nobody
 * scored (from 2005/06, GF less the players' goals is exactly SoW).
 */
export function databankLeagueGoals(text) {
  const seasons = new Map();
  for (const row of csvRecords(text)) {
    if (row.lgID !== 'NHL') continue;
    const label = seasonLabel(Number(row.year) + 1);
    const e = seasons.get(label) ?? { teamGames: 0, goals: 0 };
    e.teamGames += Number(row.G);
    e.goals += Number(row.GF) - (Number(row.SoW) || 0);
    seasons.set(label, e);
  }
  return seasons;
}

/**
 * MoneyPuck.com's game-by-game skater file of a season (a zip of one CSV) → { teamGames, goals, oneSided }: the goals
 * every skater of a club scored in each regular-season game (situation 'all'; a regular-season game id has 02 after the
 * year), over the club-games. A game the file holds for one side only is left out (`oneSided`). A shoot-out's goals are
 * nobody's here, and goalies' own goals (about one a season) are left out with the goalies.
 */
export function moneypuckGameGoals(zip) {
  const files = unzipSync(new Uint8Array(zip));
  const names = Object.keys(files).filter(name => name.endsWith('.csv'));
  if (names.length !== 1) throw new Error(`A MoneyPuck game file holds ${names.length} CSV files`);
  const byGame = new Map();
  for (const row of plainCsvColumns(strFromU8(files[names[0]]), ['gameId', 'playerTeam', 'situation', 'I_F_goals'])) {
    if (row.situation !== 'all' || !/^\d{4}02\d{4}$/.test(row.gameId)) continue;
    const sides = byGame.get(row.gameId) ?? new Map();
    sides.set(row.playerTeam, (sides.get(row.playerTeam) ?? 0) + Number(row.I_F_goals));
    byGame.set(row.gameId, sides);
  }
  let teamGames = 0, goals = 0, oneSided = 0;
  for (const sides of byGame.values()) {
    if (sides.size !== 2) { oneSided++; continue; }
    teamGames += 2;
    for (const g of sides.values()) goals += g;
  }
  return { teamGames, goals, oneSided };
}

/** MoneyPuck.com's season summary of skaters → the goals they scored (situation 'all'). */
export function moneypuckSummaryGoals(text) {
  return plainCsvColumns(text, ['situation', 'I_F_goals']).filter(row => row.situation === 'all')
    .reduce((sum, row) => sum + Number(row.I_F_goals), 0);
}

/**
 * The club-games of a season MoneyPuck keeps no game-by-game file of: 2021/22, the 32 clubs' 82 games each
 * (Wikipedia's 2021–22 NHL season, https://en.wikipedia.org/w/index.php?oldid=1383879616, read 2026-11-10).
 */
const SUMMARY_TEAM_GAMES = Object.freeze({ '2021/22': 32 * 82 });

/**
 * The goals a club scored a game in each season of `seasons` ([{ season, year }]), a shoot-out's deciding goal left out
 * → { [season]: { goals (to two decimals), source, teamGames, total } }, or null when a download it needs is not on the
 * computer (`read`: pinnedReader). To 2017/18 the Hockey Databank's Teams.csv; after, MoneyPuck's game-by-game skater
 * files, and its season summary for 2021/22, which it keeps no game file of.
 */
export function leagueGoals(read, seasons) {
  const teams = read('hockey-databank/Teams.csv');
  if (!teams) return null;
  const databank = databankLeagueGoals(teams.toString('utf8'));
  const out = {};
  for (const { season, year } of seasons) {
    let figures;
    if (year <= 2018) {
      if (!databank.has(season)) throw new Error(`The Hockey Databank has no NHL season ${season}`);
      figures = { source: 'hockey-databank', ...databank.get(season) };
    } else if (Object.hasOwn(SUMMARY_TEAM_GAMES, season)) {
      const summary = read(`moneypuck/${year - 1}-skaters.csv`);
      if (!summary) return null;
      figures = { source: 'moneypuck-summary', teamGames: SUMMARY_TEAM_GAMES[season], goals: moneypuckSummaryGoals(summary.toString('utf8')) };
    } else {
      const zip = read(`moneypuck-games/skaters-${year - 1}.zip`);
      if (!zip) return null;
      const { teamGames, goals, oneSided } = moneypuckGameGoals(zip);
      figures = { source: 'moneypuck-games', teamGames, goals, oneSided };
    }
    out[season] = { goals: Number((figures.goals / figures.teamGames).toFixed(2)), source: figures.source,
      teamGames: figures.teamGames, total: figures.goals, ...(figures.oneSided ? { oneSided: figures.oneSided } : {}) };
  }
  return out;
}

// ---------- the playoffs' overtimes ----------

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const cell = html => html.replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** The last playoffs NHL.com's lists are read for: the page titled 2000-08 runs on to 2010, whose rows hold errors. */
export const LAST_PLAYOFFS = 2009;

/**
 * One of NHL.com's "Overtime Games" pages (a decade of the Stanley Cup playoffs) → [[date 'YYYY-MM-DD', length 'm:ss'],
 * ...], one for every overtime game with a scorer to LAST_PLAYOFFS, in the page's order. Its rows: date ("15-May-90"),
 * city, series, the teams and goals, the scorer and the overtime's length, every period of it ("55:13", the third
 * overtime's 15:13). The 2010 rows added to the 2000s' page are left out: one, Matt Carkner's goal of 22 April 2010,
 * reads 23:06 where the game ran into a third overtime (47:06, Wikipedia's Overtime (ice hockey)).
 */
export function parseOvertimePage(html) {
  const games = [];
  for (const [, row] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(([, text]) => cell(text));
    const date = /^(\d{1,2})-([A-Z][a-z]{2})-(\d{2})$/.exec(cells[0] ?? '');
    if (cells.length < 9 || !date) continue;
    const year = Number(date[3]) + (Number(date[3]) > 50 ? 1900 : 2000);
    if (year > LAST_PLAYOFFS || /no scorer/i.test(cells[7])) continue;
    if (!/^\d{1,3}:\d{2}$/.test(cells[8])) throw new Error(`An overtime of ${cells[0]} lasts ${JSON.stringify(cells[8])}`);
    games.push([`${year}-${String(MONTHS[date[2]]).padStart(2, '0')}-${date[1].padStart(2, '0')}`, cells[8]]);
  }
  return games;
}

/** An overtime's length 'm:ss' in minutes. */
export const overtimeMinutes = length => {
  const [minutes, seconds] = length.split(':').map(Number);
  return minutes + seconds / 60;
};

/**
 * The playoff overtimes of the years `from` to `to` → { games, firstPeriod (settled in the first twenty minutes),
 * share, meanMinutes }.
 */
export function overtimeShares(games, from, to) {
  const chosen = games.filter(([date]) => Number(date.slice(0, 4)) >= from && Number(date.slice(0, 4)) <= to).map(([, length]) => overtimeMinutes(length));
  const firstPeriod = chosen.filter(minutes => minutes <= 20).length;
  return { games: chosen.length, firstPeriod, share: firstPeriod / chosen.length,
    meanMinutes: chosen.reduce((sum, minutes) => sum + minutes, 0) / chosen.length };
}

/**
 * The two pre-shoot-out overtimes of src/sports/hockey.js, by the seasons that play them (their end years), each
 * calibrated on the playoffs that closed those seasons.
 */
export const PLAYOFF_ERAS = Object.freeze([
  Object.freeze({ seasons: Object.freeze([1967, 1989]), playoffs: Object.freeze([1967, 1989]) }),
  Object.freeze({ seasons: Object.freeze([1990, 2004]), playoffs: Object.freeze([1990, 2004]) }),
]);

// ---------- a season in the match model ----------

/** The clubs of built-in season `id` (public/hockey/<id>.json), built as a campaign builds them. */
export function seasonClubs(root, id) {
  const set = decodeFootballSet(JSON.parse(readFileSync(path.join(root, `public/hockey/${id}.json`), 'utf8')), id);
  const sport = seasonSport(set);
  return set.clubs.map(club => buildClub(club, sport));
}

/**
 * Every pairing of `clubs` under `sport` (a rules object, `hockeyWith`), about `games` games in all at Balanced and on
 * neutral ice, each from its own seeded stream (so a change of scoring moves each game's goals, not which games are
 * drawn): { games, goals (a club a game, a shoot-out's goal left out), level (after sixty), shootouts, inOvertime (level
 * games settled in the overtime, before any shoot-out), firstPeriod (level games settled in the first overtime period),
 * longest (overtime periods) }.
 */
export function leagueScoring(sport, clubs, { games = 12000, seed = 'nhl' } = {}) {
  const pairings = clubs.length * (clubs.length - 1);
  const draws = Math.max(1, Math.round(games / pairings));
  const eff = clubs.map(teamEff);
  let played = 0, goals = 0, level = 0, shootouts = 0, firstPeriod = 0, longest = 0;
  for (let i = 0; i < clubs.length; i++) {
    for (let j = 0; j < clubs.length; j++) {
      if (i === j) continue;
      const prepared = sport.prepareMatch(clubs[i], clubs[j], eff[i], eff[j]);
      for (let k = 0; k < draws; k++) {
        const result = sport.sampleResult(makeRng(hashStr(`${seed}|${i}|${j}|${k}`)), prepared, 6);
        // The shoot-out's goal comes after the overtime's slice; an overtime's in it, whichever period.
        const shootout = result.goals.some(goal => goal.slice > PERIOD_MODEL.SLICES);
        const periods = result.tie?.periods.length ?? 0;
        played++;
        goals += result.ga + result.gd - (shootout ? 1 : 0);
        if (result.tie) {
          level++;
          if (shootout) shootouts++;
          else if (periods === 1) firstPeriod++;
          longest = Math.max(longest, periods);
        }
      }
    }
  }
  return { games: played, goals: goals / (2 * played), level: level / played, shootouts: shootouts / played,
    inOvertime: (level - shootouts) / level, firstPeriod: firstPeriod / level, longest };
}

/**
 * The factor on the scoring rates of the season ending in `year` that brings `clubs` to `goals` a club a game under the
 * season's overtime, to four decimals: each round scales it by how far the last fell short.
 */
export function solveScoring(year, clubs, goals, { games = 12000, rounds = 4 } = {}) {
  const season = seasonLabel(year), late = lateOf(year), overtime = overtimeOf(year, goals);
  let scoring = 1;
  for (let round = 0; round < rounds; round++) {
    const measured = leagueScoring(hockeyWith({ season, scoring, late, overtime }), clubs, { games, seed: season }).goals;
    scoring *= goals / measured;
  }
  return Number(scoring.toFixed(4));
}
