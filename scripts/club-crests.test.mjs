// Every club the game can show wears a crest, in every sport, season and map (docs/design/period-marks.md, "No club
// without a crest"): today's country maps, each earlier season's country maps, the Europe maps, the sports' own maps and
// the seasons that play on them, each club-season by its country and id (the crest census, scripts/lib/crest-census.mjs).
// A club shows its monogram chip only where its crest is a retired caricature of Native Americans (the user's "Keep
// monograms", 15 November 2026) or where no allowed source pictures any crest it wore: NO_PICTURE outside football; in
// football, mostly lower-division clubs of the country maps, whose number may only fall (FOOTBALL_WITHOUT_CREST). No club
// wears another's crest because the seasons give their ids the same name: a club is its country and its id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { CREST_ERAS } from '../src/data/clubCrestEras.js';
import { crestFile, rememberTwins } from '../src/data/crests.js';
import { crestCensus, crestCountry, oneClub, sameClubs } from './lib/crest-census.mjs';

const root = new URL('../', import.meta.url);
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
// Football's club appearances (a club on a map in a season) with no crest, 23 November 2026 after the fourth pass: 1,412
// of about 60,400, 720 clubs by country and id (271 of today's country maps, 449 of the earlier seasons'), whose articles
// show no crest, show another club's, or do not exist (1,501 after the third pass, the USA's San Francisco of 1996/97
// included since the namesakes' fix). A crest found for one lowers it.
const FOOTBALL_WITHOUT_CREST = 1412;
const isFootball = id => /^(f-|d[0-9A-Z]+-)/.test(id);

const excused = (id, year) => (CARICATURES[id] && year != null && CARICATURES[id][0] <= year && year <= CARICATURES[id][1]) || id in NO_PICTURE;
const census = crestCensus();
const season = year => year ?? 'today';

test('every club of every map, season and sport shows a crest the game ships', () => {
  const missing = [];
  for (const { where, id, year, file } of census) {
    if (file) assert.ok(files.has(file), `${where} ${id} ${season(year)}: ${file}.webp ships`);
    else if (!excused(id, year)) missing.push(`${where} ${id} ${season(year)}`);
  }
  assert.ok(census.length > 70000, `${census.length} club appearances checked`);
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

test('no club wears a namesake\'s crest: none of another country\'s club, none worn in two countries', () => {
  // A crest of today's country maps (d<country>-…) is that country's club's; a period crest, the club's it was drawn for.
  // The census of 21 November 2026 grouped club-seasons by id across countries, and five clubs wore a namesake's crest
  // in every mode: Peru's León of 1994/95-1996/97 Club León's (Mexico), New Zealand's Rangers of 1994/95 and 1996/97
  // Rangers de Talca's (Chile), the USA's San Francisco of 1996/97 Atlético San Francisco's (Mexico), Venezuela's
  // Valencia FC of 1995/96-1996/97 Valencia CF's (Spain) and South Africa's Vasco da Gama of 2010/11-2014/15 Brazil's.
  // Serbia's maps hold Montenegro's clubs, the same clubs as Montenegro's of today (sameClubs).
  const foreign = [];
  const countries = new Map(); // crest file → the countries whose club-seasons wear it
  for (const { where, country, id, year, file } of census) {
    if (!file) continue;
    const owner = crestCountry(file);
    if (owner && !(country && sameClubs(country, owner))) foreign.push(`${where} ${id} ${season(year)} (${country ?? 'no country'}): ${file}`);
    if (!country) continue;
    if (!countries.has(file)) countries.set(file, new Set());
    countries.get(file).add(country);
  }
  assert.deepEqual(foreign, [], 'no club-season wears the crest of another country\'s club of today');
  const shared = [...countries].filter(([, worn]) => !oneClub(worn)).map(([file, worn]) => `${file}: ${[...worn].sort().join(', ')}`);
  assert.deepEqual(shared, [], 'no crest is worn by clubs of two countries');
  // The five by name: their own crest, or their monogram where no allowed source pictures one.
  const wears = (where, id) => census.find(row => row.where === where && row.id === id)?.file;
  assert.equal(wears('604y1996', 'f-leon'), 'd604-5290586', 'León de Huánuco, its twin of today');
  assert.equal(wears('554y1995', 'f-rangers-2'), 'f-rangers-3.1996', 'Christchurch\'s Rangers A.F.C., whose 1995/96 id is f-rangers-3');
  assert.equal(wears('840y1997', 'f-san-francisco'), null, 'the San Francisco Bay Blackhawks, whom no source pictures');
  assert.equal(wears('484y1996', 'f-san-francisco'), 'f-san-francisco.1995', 'Mexico\'s Atlético San Francisco keeps its own');
  assert.equal(wears('862y1997', 'f-valencia'), 'd862-5300226', 'Valencia FC, Carabobo FC since February 1997');
  assert.equal(wears('710y2013', 'f-vasco-da-gama'), 'f-vasco-da-gama.2011', 'Cape Town\'s Vasco da Gama, its own logo');
  assert.equal(wears('076y2016', 'f-vasco-da-gama'), 'd076-339', 'Brazil\'s keeps its own');
});

test('a namesake\'s crest eras each name a country, and cover none of another country\'s seasons', () => {
  // A season year gives an id to one country's club only, so the id alone finds a club's eras and twin there
  // (src/data/crests.js). An id the seasons give to clubs of two countries keys every era by country in
  // scripts/data/crest-eras.json ('<id>@<country>'; CREST_ERAS carries it fourth), and each era covers only that
  // country's club-seasons.
  const seasons = new Map(); // id → year → the countries whose club-seasons it names that year
  for (const { country, id, year } of census) {
    if (year == null || !country) continue;
    if (!seasons.has(id)) seasons.set(id, new Map());
    const years = seasons.get(id);
    if (!years.has(year)) years.set(year, new Set());
    years.get(year).add(country);
  }
  const twice = [], untagged = [], strays = [];
  for (const [id, years] of seasons) {
    for (const [year, countries] of years) if (countries.size > 1) twice.push(`${id} ${year}: ${[...countries].sort().join(', ')}`);
  }
  for (const [id, eras] of Object.entries(CREST_ERAS)) {
    const years = seasons.get(id);
    if (!years) continue;
    const countries = new Set([...years.values()].flatMap(set => [...set]));
    for (const [from, through, , country] of eras) {
      if (!country) {
        if (countries.size > 1) untagged.push(`${id} ${from}-${through} (${[...countries].sort().join(', ')})`);
        continue;
      }
      for (const [year, here] of years) {
        if (from <= year && year <= through) for (const other of here) if (other !== country) strays.push(`${id}@${country} ${from}-${through}: ${other}'s ${year}`);
      }
    }
  }
  assert.deepEqual(twice, [], 'an id names one country\'s club in a season year');
  assert.deepEqual(untagged, [], 'an id of two countries\' clubs keys every era by country');
  assert.deepEqual(strays, [], 'a country\'s era covers no other country\'s club-season');
  assert.deepEqual(CREST_ERAS['f-valencia'], [[1996, 1997, 'd862-5300226', '862'], [2015, 2024, 'd724-1775', '724']]);
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
