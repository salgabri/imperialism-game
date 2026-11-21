// Every club the game can show wears a crest, in every sport, season and map (docs/design/period-marks.md, "No club
// without a crest"): today's country maps, each earlier season's country maps, the Europe maps, the sports' own maps and
// the seasons that play on them. A club shows its monogram chip only where its crest is a retired caricature of Native
// Americans (the user's "Keep monograms", 15 November 2026) or where no allowed source pictures any crest it wore:
// NO_PICTURE outside football; in football, mostly lower-division clubs of the country maps, whose number may only fall
// (FOOTBALL_WITHOUT_CREST).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { CREST_ERAS } from '../src/data/clubCrestEras.js';
import { crestFile, rememberTwins } from '../src/data/crests.js';
import { BUILT_IN_SEASONS } from '../src/data/footballSeasons.js';
import { BUILT_IN_WOMENS_SEASONS } from '../src/data/womensFootballSeasons.js';
import { BUILT_IN_BASKETBALL_SEASONS } from '../src/data/basketballSeasons.js';
import { BUILT_IN_AMERICAN_FOOTBALL_SEASONS } from '../src/data/americanFootballSeasons.js';
import { BUILT_IN_BASEBALL_SEASONS } from '../src/data/baseballSeasons.js';
import { BUILT_IN_HOCKEY_SEASONS } from '../src/data/hockeySeasons.js';
import { BUILT_IN_RUGBY_LEAGUE_SEASONS } from '../src/data/rugbyLeagueSeasons.js';
import { BUILT_IN_COLLEGE_FOOTBALL_SEASONS } from '../src/data/collegeFootballSeasons.js';
import { CLUBS as FOOTBALL } from '../src/data/clubs.football.js';
import { CLUBS as BASKETBALL } from '../src/data/clubs.basketball.js';
import { CLUBS as EUROLEAGUE } from '../src/data/clubs.euroleague.js';
import { CLUBS as NFL } from '../src/data/clubs.american-football.js';
import { CLUBS as MLB } from '../src/data/clubs.baseball.js';
import { CLUBS as NHL } from '../src/data/clubs.hockey.js';
import { CLUBS as NRL } from '../src/data/clubs.rugby-league.js';
import { CLUBS as WOMENS } from '../src/data/clubs.womens-football.js';
import { CLUBS as CFB } from '../src/data/clubs.college-football.js';
import { CLUBS as RUGBY_UNION } from '../src/data/clubs.rugby-union.js';

const root = new URL('../', import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const files = new Set(readdirSync(new URL('public/club-logos/', root)).filter(name => name.endsWith('.webp')).map(name => name.slice(0, -5)));

// The retired caricatures of Native Americans keep their monogram (the user's choice, 15 November 2026): Washington's
// logo to 2019, Cleveland's Chief Wahoo to 2018, the Philadelphia Warriors', the Milwaukee Braves' laughing brave and the
// Atlanta Braves' of 1966 (with the unidentified logo of 1967-1986 that followed it).
const CARICATURES = {
  'nfl-washington': [1960, 2019], 'mlb-cleveland-indians': [1960, 2018], 'b-philadelphia-warriors': [1961, 1962],
  'mlb-milwaukee-braves': [1960, 1965], 'mlb-atlanta-braves': [1966, 1986],
};
// Clubs no Wikipedia, Commons file or archived page pictures any crest of (club id → why), outside football.
const NO_PICTURE = {
  'el-st-petersburg-lions': 'a one-season club of 2000/01: no article, file or archived page in any language shows a logo',
};
// Football's club appearances (a club on a map in a season) with no crest, 21 November 2026: 2,622 of about 55,000, 1,295
// clubs (414 of today's country maps, 881 of the earlier seasons'), whose articles show no crest, show another club's,
// or do not exist. A crest found for one lowers it.
const FOOTBALL_WITHOUT_CREST = 2622;
const isFootball = id => /^(f-|d[0-9A-Z]+-)/.test(id);

const SEASONS = [BUILT_IN_SEASONS, BUILT_IN_WOMENS_SEASONS, BUILT_IN_BASKETBALL_SEASONS, BUILT_IN_AMERICAN_FOOTBALL_SEASONS,
  BUILT_IN_BASEBALL_SEASONS, BUILT_IN_HOCKEY_SEASONS, BUILT_IN_RUGBY_LEAGUE_SEASONS, BUILT_IN_COLLEGE_FOOTBALL_SEASONS];
const yearOf = new Map(SEASONS.flat().map(season => [season.id, season.year]));
const FOLDERS = { basketball: BUILT_IN_BASKETBALL_SEASONS, 'american-football': BUILT_IN_AMERICAN_FOOTBALL_SEASONS,
  baseball: BUILT_IN_BASEBALL_SEASONS, hockey: BUILT_IN_HOCKEY_SEASONS, 'rugby-league': BUILT_IN_RUGBY_LEAGUE_SEASONS,
  'college-football': BUILT_IN_COLLEGE_FOOTBALL_SEASONS };

const excused = (id, year) => (CARICATURES[id] && year != null && CARICATURES[id][0] <= year && year <= CARICATURES[id][1]) || id in NO_PICTURE;

test('every club of every map, season and sport shows a crest the game ships', () => {
  const missing = [];
  let shown = 0;
  const check = (where, year, clubs) => {
    for (const club of clubs) {
      shown++;
      const file = crestFile(club.id, year);
      if (file) assert.ok(files.has(file), `${where} ${club.id} ${year ?? 'today'}: ${file}.webp ships`);
      else if (!excused(club.id, year)) missing.push(`${where} ${club.id} ${year ?? 'today'}`);
    }
  };
  // Today's built-in clubs of every sport (the world board's and their maps').
  for (const clubs of [FOOTBALL, BASKETBALL, EUROLEAGUE, NFL, MLB, NHL, NRL, WOMENS, CFB, RUGBY_UNION]) check('today', null, clubs);
  const maps = readdirSync(new URL('public/domestic/', root)).filter(name => name.endsWith('.json')).sort();
  const seasonCountry = name => /^[0-9A-Z]{3}y\d{4}\.json$/.test(name);
  // The maps that remember no twins first (Europe maps and the sports' own), so none of them leans on a country map's.
  for (const name of [...maps.filter(name => !seasonCountry(name)), ...maps.filter(seasonCountry)]) {
    const map = json(`public/domestic/${name}`);
    if (map.replacedBy) continue;
    if (map.season != null && map.sport == null) {
      rememberTwins(map.clubs, map.year);
      check(map.id, map.year, map.clubs);
    } else if (map.seasons) {
      for (const season of map.seasons) check(map.id, yearOf.get(season), map.clubs);
    } else check(map.id, null, map.clubs);
  }
  // The earlier seasons of the sports whose clubs come from the season onto a map of today (the NBA's since 2014/15).
  for (const [folder, seasons] of Object.entries(FOLDERS)) {
    for (const season of seasons) {
      const { clubs = [] } = json(`public/${folder}/${season.id}.json`);
      check(season.id, season.year, clubs);
    }
  }
  assert.ok(shown > 70000, `${shown} club appearances checked`);
  const football = missing.filter(row => isFootball(row.split(' ')[1]));
  assert.deepEqual(missing.filter(row => !isFootball(row.split(' ')[1])), [], 'every other sport\'s clubs show a crest in every season');
  assert.ok(football.length <= FOOTBALL_WITHOUT_CREST, `${football.length} football club appearances without a crest (at most ${FOOTBALL_WITHOUT_CREST})`);
});

test('the retired caricatures keep their monogram, and every other club-season with eras a picture', () => {
  for (const [id, [from, through]] of Object.entries(CARICATURES)) {
    assert.equal(crestFile(id, from), null, `${id} ${from}`);
    assert.equal(crestFile(id, through), null, `${id} ${through}`);
  }
  for (const [id, eras] of Object.entries(CREST_ERAS)) {
    for (const [from, through, file] of eras) {
      if (file === null) assert.ok(CARICATURES[id] && CARICATURES[id][0] <= from && through <= CARICATURES[id][1] || id in NO_PICTURE,
        `${id} ${from}-${through}: a monogram era outside the caricatures`);
    }
  }
});

test('a namesake club of another country and season never lends its crest: twins are remembered by season', () => {
  // Uruguay's Nacional (1994/95) and Portugal's CD Nacional (2015/16) share the season id f-nacional. Kept by id alone,
  // the twin was whichever map decoded last, and a map the loader serves again from its cache is not decoded again.
  const map = name => JSON.parse(readFileSync(new URL(`../public/domestic/${name}.json`, import.meta.url), 'utf8'));
  const uruguay = map('858y1995'), portugal = map('620y2016');
  const twinOf = data => data.clubs.find(club => club.id === 'f-nacional')?.twin;
  assert.deepEqual([twinOf(uruguay), twinOf(portugal)], ['d858-1921', 'd620-2433']);
  rememberTwins(uruguay.clubs, uruguay.year);
  rememberTwins(portugal.clubs, portugal.year);
  assert.equal(crestFile('f-nacional', 1995), crestFile('d858-1921', 1995), 'Uruguay 1994/95 wears its own Nacional\'s crest');
  assert.equal(crestFile('f-nacional', 2016), crestFile('d620-2433', 2016), 'Portugal 2015/16 its own');
  assert.notEqual(crestFile('d858-1921', 1995), crestFile('d620-2433', 2016));
});
