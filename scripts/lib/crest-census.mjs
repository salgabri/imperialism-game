// The crest census (docs/design/period-marks.md, "No club without a crest"): every club the game can show, in every
// sport, season and map, as a club-season (country, id, year) with the crest it wears there, resolved as
// src/data/crests.js resolves it. A club is its country and its id, never its id alone: a season's `f-<name>` id names
// one club in that season, but other seasons give the same id to namesakes in other countries (f-valencia is Venezuela's
// Valencia FC in 1995/96 and Spain's Valencia CF in 2015/16). The census of 21 November 2026 grouped club-seasons by id
// and gave five clubs a namesake's crest. scripts/club-crests.test.mjs checks the census; scripts/crest-census.mjs lists
// the club-seasons without a crest, by country and id, where a crest pass starts.
import { readdirSync, readFileSync } from 'node:fs';
import { crestFile, rememberTwins } from '../../src/data/crests.js';
import { BUILT_IN_SEASONS } from '../../src/data/footballSeasons.js';
import { BUILT_IN_WOMENS_SEASONS } from '../../src/data/womensFootballSeasons.js';
import { BUILT_IN_BASKETBALL_SEASONS } from '../../src/data/basketballSeasons.js';
import { BUILT_IN_AMERICAN_FOOTBALL_SEASONS } from '../../src/data/americanFootballSeasons.js';
import { BUILT_IN_BASEBALL_SEASONS } from '../../src/data/baseballSeasons.js';
import { BUILT_IN_HOCKEY_SEASONS } from '../../src/data/hockeySeasons.js';
import { BUILT_IN_RUGBY_LEAGUE_SEASONS } from '../../src/data/rugbyLeagueSeasons.js';
import { BUILT_IN_COLLEGE_FOOTBALL_SEASONS } from '../../src/data/collegeFootballSeasons.js';
import { CLUBS as FOOTBALL } from '../../src/data/clubs.football.js';
import { CLUBS as BASKETBALL } from '../../src/data/clubs.basketball.js';
import { CLUBS as EUROLEAGUE } from '../../src/data/clubs.euroleague.js';
import { CLUBS as NFL } from '../../src/data/clubs.american-football.js';
import { CLUBS as MLB } from '../../src/data/clubs.baseball.js';
import { CLUBS as NHL } from '../../src/data/clubs.hockey.js';
import { CLUBS as NRL } from '../../src/data/clubs.rugby-league.js';
import { CLUBS as WOMENS } from '../../src/data/clubs.womens-football.js';
import { CLUBS as CFB } from '../../src/data/clubs.college-football.js';
import { CLUBS as RUGBY_UNION } from '../../src/data/clubs.rugby-union.js';

const root = new URL('../../', import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

const SEASONS = [BUILT_IN_SEASONS, BUILT_IN_WOMENS_SEASONS, BUILT_IN_BASKETBALL_SEASONS, BUILT_IN_AMERICAN_FOOTBALL_SEASONS,
  BUILT_IN_BASEBALL_SEASONS, BUILT_IN_HOCKEY_SEASONS, BUILT_IN_RUGBY_LEAGUE_SEASONS, BUILT_IN_COLLEGE_FOOTBALL_SEASONS];
// The sports whose earlier seasons bring their clubs onto a map of today from the season's own file (the NBA's since 2014/15).
const FOLDERS = { basketball: BUILT_IN_BASKETBALL_SEASONS, 'american-football': BUILT_IN_AMERICAN_FOOTBALL_SEASONS,
  baseball: BUILT_IN_BASEBALL_SEASONS, hockey: BUILT_IN_HOCKEY_SEASONS, 'rugby-league': BUILT_IN_RUGBY_LEAGUE_SEASONS,
  'college-football': BUILT_IN_COLLEGE_FOOTBALL_SEASONS };
const TODAY = [FOOTBALL, BASKETBALL, EUROLEAGUE, NFL, MLB, NHL, NRL, WOMENS, CFB, RUGBY_UNION];

/** An earlier season's country map (`<country>y<year>.json`), whose clubs remember their twins. */
const seasonCountry = map => map.season != null && map.sport == null;

let census = null;

/**
 * Every club-season the game can show: [{ where, country, id, year, file }], `where` the map or season it shows on,
 * `country` the country the club plays in there (a season's country map: its country; a Europe or sport's map: the
 * club's `shape`; today's country map: its id; a built-in club or a season file's: its own), or null where a map names
 * none (a sport's own map of one league); `year` the season year (null: today's season); `file` its crest file, or null
 * for its monogram. Computed once per process: resolving remembers each season map's twins in src/data/crests.js.
 */
export function crestCensus() {
  if (census) return census;
  const yearOf = new Map(SEASONS.flat().map(season => [season.id, season.year]));
  const rows = [];
  const add = (where, country, year, club) => rows.push({ where, country: country ?? null, id: club.id, year, file: crestFile(club.id, year) });
  for (const clubs of TODAY) for (const club of clubs) add('today', club.country, null, club);
  const maps = readdirSync(new URL('public/domestic/', root)).filter(name => name.endsWith('.json')).sort()
    .map(name => json(`public/domestic/${name}`)).filter(map => !map.replacedBy);
  // The maps that remember no twins first, so none of them leans on a country map's.
  for (const map of maps.filter(map => !seasonCountry(map))) {
    const today = /^[0-9A-Z]{3}$/.test(map.id) && !map.sport; // today's country map, named by its country
    for (const year of map.seasons ? map.seasons.map(season => yearOf.get(season)) : [null]) {
      for (const club of map.clubs) add(map.id, today ? map.id : club.shape, year, club);
    }
  }
  for (const map of maps.filter(seasonCountry)) {
    rememberTwins(map.clubs, map.year);
    for (const club of map.clubs) add(map.id, map.country, map.year, club);
  }
  for (const [folder, seasons] of Object.entries(FOLDERS)) {
    for (const season of seasons) {
      const { clubs = [] } = json(`public/${folder}/${season.id}.json`);
      for (const club of clubs) add(season.id, club.country, season.year, club);
    }
  }
  census = rows;
  return rows;
}

/** The country whose club of today crest `file` is (`d<country>-<id>`, a club of today's country maps), or null. */
export const crestCountry = file => /^d([0-9A-Z]{3})-/.exec(file ?? '')?.[1] ?? null;

// Serbia's season maps (688) hold Montenegro's clubs: FR Yugoslavia's and Serbia and Montenegro's to 2005/06, and the
// CM 01/02 Update Team's databases, whose game has no Montenegro, to 2010/11 (docs/design/domestic-campaigns.md). They
// are the same clubs as Montenegro's of today (499), not namesakes, so they wear those crests.
const SAME_CLUBS = [['688', '499']];

/** Whether a club-season of `country` may wear a crest of `other`'s clubs: only where both name the same clubs. */
export const sameClubs = (country, other) => country === other || SAME_CLUBS.some(([a, b]) => a === country && b === other);

/** Whether club-seasons of every country in `countries` may wear one crest file (one country, or both of a SAME_CLUBS pair). */
export const oneClub = countries => countries.size <= 1
  || (countries.size === 2 && SAME_CLUBS.some(([a, b]) => countries.has(a) && countries.has(b)));
