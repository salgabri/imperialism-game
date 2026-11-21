// Flags and crests of the day (docs/design/period-marks.md): a season of another day shows each nation under the flag
// (and, where the state was another, the name and code) of its cutoff, and each club under the crest it wore then.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { FLAG_CODES } from '../src/data/flags.js';
import { NATIONS, buildTeam, makeRng, nationIdentity } from '../src/data/teams.js';
import { FLAGS_OF_THE_DAY, cutoffOf, flagOfTheDay } from '../src/data/flagsOfTheDay.js';
import { NAMES_OF_THE_DAY } from '../src/data/namesOfTheDay.js';
import { CREST_ERAS } from '../src/data/clubCrestEras.js';
import { clubLogoFile } from '../src/data/clubLogos.js';
import { decodeFootballSet, fieldedNations, seasonSport } from '../src/engine/footballSets.js';
import { getSport } from '../src/sports/index.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const season = (folder, id) => seasonSport(decodeFootballSet(JSON.parse(read(`public/${folder}/${id}.json`)), id));
const identity = (name, code, flagId) => ({ name, code, flagId });

// ---------- flags and names of the day ----------

test('a season reads its flags on 30 June of its year', () => {
  assert.equal(cutoffOf(1974), '1974-06-30');
  assert.equal(cutoffOf(2006), '2006-06-30');
});

test('every flag of the day is one the game has, its periods in order, on shapes the game draws', () => {
  for (const [shape, periods] of Object.entries(FLAGS_OF_THE_DAY)) {
    assert.ok(NATIONS[shape], `${shape} is a nation`);
    let last = '';
    for (const entry of periods) {
      assert.match(entry.until, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(entry.until > last, `${shape}: periods in order`);
      if (entry.from) assert.ok(entry.from > last && entry.from <= entry.until, `${shape}: ${entry.from} starts after the period before`);
      last = entry.until;
      assert.ok(Object.hasOwn(FLAG_CODES, entry.flagId), `${shape}: flag ${entry.flagId} is in src/data/flags.js`);
      assert.ok(existsSync(new URL(`public/flags/${FLAG_CODES[entry.flagId]}.svg`, root)), `${shape}: ${FLAG_CODES[entry.flagId]}.svg is vendored`);
    }
  }
  for (const entry of NAMES_OF_THE_DAY) {
    assert.ok(Object.hasOwn(FLAG_CODES, entry.flagId), `${entry.name}: flag ${entry.flagId} is in src/data/flags.js`);
    assert.ok(existsSync(new URL(`public/flags/${FLAG_CODES[entry.flagId]}.svg`, root)), `${entry.name}: its flag is vendored`);
  }
});

test('a shape flies today\'s flag in a season of today and outside its periods, its flag of the day within them', () => {
  for (const [shape, periods] of Object.entries(FLAGS_OF_THE_DAY)) {
    assert.equal(flagOfTheDay(shape, null), null, `${shape}: no year, today's`);
    assert.equal(flagOfTheDay(shape, 2026), null, `${shape}: today's season year`);
    for (const entry of periods) {
      const year = Number(entry.until.slice(0, 4)) - (entry.until.slice(5) >= '06-30' ? 0 : 1);
      if (year >= Number((entry.from ?? '0000').slice(0, 4))) assert.equal(flagOfTheDay(shape, year), entry.flagId, `${shape} ${year}`);
    }
  }
  // A team under its own shape's flag flies the flag of the day; a federation of the day and Great Britain keep theirs.
  const shape = Object.keys(FLAGS_OF_THE_DAY)[0];
  if (shape) {
    const [entry] = FLAGS_OF_THE_DAY[shape];
    const year = Number(entry.until.slice(0, 4)) - (entry.until.slice(5) >= '06-30' ? 0 : 1);
    assert.equal(nationIdentity(shape, { dataYear: year }).flagId, entry.flagId);
    assert.equal(nationIdentity(shape, { dataYear: year, playsAs: { [shape]: { name: 'X', code: 'XXX', flagId: shape } } }).flagId, entry.flagId);
    assert.equal(nationIdentity(shape, { dataYear: year, playsAs: { [shape]: { name: 'X', code: 'XXX', flagId: 'URS' } } }).flagId, 'URS');
    assert.equal(nationIdentity(shape).flagId, shape, 'today');
  }
});

test('tennis 1975 plays Czechoslovakia, the Soviet Union, Yugoslavia and West Germany under their own names and flags', () => {
  const sport = season('tennis', 'tennis-1975');
  assert.deepEqual(nationIdentity('203', sport), identity('Czechoslovakia', 'TCH', '203'));
  assert.deepEqual(nationIdentity('643', sport), identity('Soviet Union', 'URS', 'URS'));
  assert.deepEqual(nationIdentity('688', sport), identity('Yugoslavia', 'YUG', 'YUG'));
  assert.deepEqual(nationIdentity('276', sport), identity('West Germany', 'FRG', '276'));
  assert.deepEqual(nationIdentity('826', sport), identity('Great Britain', 'GBR', 'GBR'), 'Great Britain as ever');
  const team = buildTeam('203', makeRng(1), sport);
  assert.deepEqual([team.name, team.code, team.flagId], ['Czechoslovakia', 'TCH', '203']);
  // 1992: the CIS; 1993: Russia, Czechia and Slovakia apart.
  assert.deepEqual(nationIdentity('643', season('tennis', 'tennis-1992')), identity('CIS', 'CIS', 'CIS'));
  const t1993 = season('tennis', 'tennis-1993');
  assert.deepEqual([nationIdentity('643', t1993).name, nationIdentity('203', t1993).name], ['Russia', 'Czechia']);
  // Today's tennis is today's.
  assert.deepEqual(nationIdentity('203', getSport('tennis')), identity('Czechia', 'CZE', '203'));
});

test('football from 1996/97 to 2005/06 plays FR Yugoslavia, then Serbia and Montenegro, under their flag', () => {
  for (const [id, name, code] of [['swos-9697', 'FR Yugoslavia', 'YUG'], ['cm0102-2002-11', 'Serbia and Montenegro', 'SCG'],
    ['ea-fifa-06', 'Serbia and Montenegro', 'SCG']]) {
    const sport = season('football', id);
    assert.deepEqual(nationIdentity('688', sport), identity(name, code, 'FRY'), id);
  }
  assert.deepEqual(nationIdentity('688', season('football', 'ea-fifa-07')).name, 'Serbia', '2006/07: Serbia');
});

test('a men\'s football season\'s own identities come first', () => {
  const sport = season('football', 'cm0102-2017-04-cm89');
  assert.deepEqual(nationIdentity('643', sport), identity('Soviet Union', 'URS', 'URS'));
  assert.ok(!fieldedNations(sport).includes('804'), 'Ukraine plays for the Soviet Union');
});

test('round 3: every change a viewer sees at 64 px, and teams under a flag other than their state\'s', () => {
  for (const [shape, year, flagId] of [
    ['818', 1980, 'EGY-1972'], ['818', 1985, null], ['180', 1971, 'COD-1966'], ['630', 1995, 'PUR-1952'], ['630', 1996, null],
    ['894', 1995, 'ZAM-1964'], ['894', 1996, null], ['643', 1993, 'RUS-1991'], ['643', 1994, null], ['231', 1995, 'ETH-1991'],
    ['231', 1996, 'ETH-1996'], ['231', 2010, null], ['608', 1997, 'PHI-1936'], ['608', 1998, null], ['616', 1979, 'POL-1928'],
    ['616', 1980, null],
  ]) assert.equal(flagOfTheDay(shape, year), flagId, `${shape} ${year}`);
  // In the seasons' teams: Egypt in 1979/80, Puerto Rico's birthplace team of 1990, Russia in hockey's 1992/93.
  assert.equal(nationIdentity('818', season('football', 'nt-1980')).flagId, 'EGY-1972');
  assert.equal(nationIdentity('630', season('baseball', 'mlb-war-1990')).flagId, 'PUR-1952');
  assert.deepEqual(nationIdentity('643', season('hockey', 'nhl-1993')), identity('Russia', 'RUS', 'RUS-1991'));
  // Chinese Taipei's teams fly the Chinese Taipei Olympic flag, today too, its football teams their association's
  // flag before 2006; Russia played tennis's 2021 as RTF.
  assert.equal(FLAG_CODES['158'], 'tpe');
  assert.deepEqual(nationIdentity('158', getSport('tennis')), identity('Chinese Taipei', 'TPE', '158'));
  assert.deepEqual(nationIdentity('158', season('football', 'swos-9697')), identity('Chinese Taipei', 'TPE', 'TPE-CTFA'));
  assert.deepEqual(nationIdentity('643', season('tennis', 'tennis-2021')), identity('RTF', 'RTF', 'RTF'));
  assert.deepEqual(nationIdentity('643', season('tennis', 'tennis-2020')), identity('Russia', 'RUS', '643'));
});

// ---------- crests of the day ----------

const compiled = await build({
  stdin: {
    contents: `export { default as TeamMark } from './src/components/TeamMark.jsx';
      export { default as SquadFlag } from './src/screens/squad/SquadFlag.jsx';
      export { SeasonYear } from './src/components/seasonYear.js';
      export { crestFile, crestUrl, rememberTwins } from './src/data/crests.js';`,
    resolveDir: fileURLToPath(root), loader: 'jsx',
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'], jsx: 'automatic',
  loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
});
const bundled = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
const { TeamMark, SquadFlag, SeasonYear, crestFile, crestUrl, rememberTwins } = bundled.exports;
const dom = new JSDOM('<!doctype html><html><body></body></html>');
after(() => dom.window.close());
const render = element => {
  const host = dom.window.document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  return host;
};

test('every crest era is in order and names a crest file the game ships, or none', () => {
  const files = new Set(readdirSync(new URL('public/club-logos/', root)).filter(name => name.endsWith('.webp')).map(name => name.slice(0, -5)));
  for (const [id, eras] of Object.entries(CREST_ERAS)) {
    let last = -Infinity;
    for (const [from, through, file] of eras) {
      assert.ok(from > last && from <= through, `${id}: eras in order`);
      last = through;
      if (file !== null) assert.ok(files.has(file), `${id}: ${file}.webp is vendored`);
    }
  }
  const sources = read('public/club-logos/SOURCES-eras.tsv').split('\n').filter(line => line && !line.startsWith('#')).slice(1);
  const periodFiles = [...files].filter(name => /\.\d{4}$/.test(name));
  assert.deepEqual(sources.map(line => line.split('\t')[0]).sort(), periodFiles.map(name => `${name}.webp`).sort(), 'a source row for each period crest');
});

test('a club wears today\'s crest in a season of today and outside its eras, its period crest or monogram within them', () => {
  for (const [id, eras] of Object.entries(CREST_ERAS)) {
    assert.equal(crestFile(id, null), clubLogoFile(id), `${id}: today`);
    for (const [from, through, file] of eras) {
      assert.equal(crestFile(id, from), file, `${id} ${from}`);
      assert.equal(crestFile(id, through), file, `${id} ${through}`);
      assert.equal(crestUrl(id, from), file ? `/club-logos/${file}.webp` : null);
    }
  }
  const id = Object.keys(CREST_ERAS).find(key => clubLogoFile(key)) ?? 'b-boston-celtics';
  assert.equal(crestFile(id, 2026), clubLogoFile(id), 'today\'s season year');
});

test('rugby league 1998 to 2007: every club wears the crest of its day, the era and gone clubs too', () => {
  const files = new Set(readdirSync(new URL('public/club-logos/', root)).filter(name => name.endsWith('.webp')).map(name => name.slice(0, -5)));
  // Every club of these seasons, the gone ones too (Balmain, Norths and Wests since round 3), wears a crest.
  for (let year = 1998; year <= 2007; year++) {
    const { clubs } = JSON.parse(read(`public/rugby-league/nrl-${year}.json`));
    for (const { id } of clubs) {
      const file = crestFile(id, year);
      assert.ok(file && files.has(file), `${id} ${year}: a crest the game ships`);
    }
  }
  const today = id => clubLogoFile(id);
  for (const [id, year, file] of [
    // Crests worn since before 1998 carry their first year (nrl-brisbane-broncos.1988: the bronco of 1988-1999).
    ['nrl-brisbane-broncos', 1999, 'nrl-brisbane-broncos.1988'], ['nrl-brisbane-broncos', 2000, 'nrl-brisbane-broncos.2000'],
    ['nrl-sydney-city-roosters', 1999, 'nrl-sydney-city-roosters.1995'], ['nrl-sydney-roosters', 2000, today('nrl-sydney-roosters')],
    ['nrl-st-george-dragons', 1998, 'nrl-st-george-dragons.1978'], ['nrl-st-george-illawarra-dragons', 1999, today('nrl-st-george-illawarra-dragons')],
    ['nrl-balmain-tigers', 1999, 'nrl-balmain-tigers.1978'], ['nrl-north-sydney-bears', 1998, 'nrl-north-sydney-bears.1997'],
    ['nrl-western-suburbs-magpies', 1999, 'nrl-western-suburbs-magpies.1998'],
    ['nrl-auckland-warriors', 2000, 'nrl-auckland-warriors.1995'], ['nrl-new-zealand-warriors', 2001, today('nrl-new-zealand-warriors')],
    ['nrl-north-queensland-cowboys', 2002, 'nrl-north-queensland-cowboys.1998'], ['nrl-north-queensland-cowboys', 2003, today('nrl-north-queensland-cowboys')],
    // Aliases share their club's picture: the Sharks of 1999-2002, the Bulldogs of 2000-2009.
    ['nrl-sharks', 2001, 'nrl-cronulla-sutherland-sharks.1998'], ['nrl-bulldogs', 2005, 'nrl-canterbury-bulldogs.1998'],
    // The first round's two corrections: the Bulldogs' head in 2008-2009, Parramatta's yellow eel to 2010.
    ['nrl-bulldogs', 2009, 'nrl-canterbury-bulldogs.1998'], ['nrl-parramatta-eels', 1999, today('nrl-parramatta-eels')],
    ['nrl-parramatta-eels', 2003, 'nrl-parramatta-eels.2000'], ['nrl-parramatta-eels', 2009, 'nrl-parramatta-eels.2004'],
    ['nrl-parramatta-eels', 2011, today('nrl-parramatta-eels')],
    ['nrl-south-sydney-rabbitohs', 2007, 'nrl-south-sydney-rabbitohs.1980'], ['nrl-south-sydney-rabbitohs', 2008, today('nrl-south-sydney-rabbitohs')],
  ]) assert.equal(crestFile(id, year), file, `${id} ${year}`);
});

test('the EuroLeague of 2000/01 to 2025/26: every club wears the crest of its day, the clubs since gone too', () => {
  const files = new Set(readdirSync(new URL('public/club-logos/', root)).filter(name => name.endsWith('.webp')).map(name => name.slice(0, -5)));
  // Club-seasons whose crest no allowed source pictures or dates show the club's nearest picture since November 2026
  // (docs/design/period-marks.md, "No club without a crest"); only the Saint Petersburg Lions, pictured nowhere, keep
  // their code.
  const codes = { 'el-st-petersburg-lions': [2001] };
  let seasons = 0;
  for (const name of readdirSync(new URL('public/basketball/', root)).filter(name => /^nba-2k\d\d\.json$/.test(name))) {
    const { year, clubs } = JSON.parse(read(`public/basketball/${name}`));
    const euroleague = clubs.filter(club => club.id.startsWith('el-'));
    if (!euroleague.length) continue;
    seasons++;
    for (const { id } of euroleague) {
      const file = crestFile(id, year);
      if (codes[id]?.includes(year)) assert.equal(file, null, `${id} ${year}: its code`);
      else assert.ok(file && files.has(file), `${id} ${year}: a crest the game ships`);
    }
  }
  assert.equal(seasons, 26, 'the seasons 2000/01 to 2025/26');
  const today = id => clubLogoFile(id);
  for (const [id, year, file] of [
    // Ülkerspor, whose code EuroLeague files Fenerbahçe under since, wears its own badge. Fenerbahçe wears the sports
    // club's emblem (the football club's of today) to 2016/17, one star for its EuroLeague title of 2017 from 2017/18,
    // the second (2025) on today's crest (round 4).
    ['el-ulkerspor', 2002, 'el-ulkerspor.2002'], ['el-ulkerspor', 2006, 'el-ulkerspor.2002'], ['el-fenerbahce', 2007, 'd792-1870'],
    ['el-fenerbahce', 2017, 'd792-1870'], ['el-fenerbahce', 2018, 'el-fenerbahce.2018'], ['el-fenerbahce', 2026, today('el-fenerbahce')],
    ['el-fc-barcelona', 2002, 'el-fc-barcelona.2001'], ['el-fc-barcelona', 2003, today('el-fc-barcelona')],
    // The football club wore the same crest, as FC Barcelona and (in most CM seasons) F.C. Barcelona, to 2001/02.
    ['f-f-c-barcelona', 1994, 'el-fc-barcelona.2001'], ['f-fc-barcelona', 1997, 'el-fc-barcelona.2001'],
    ['f-f-c-barcelona', 2002, 'el-fc-barcelona.2001'], ['f-f-c-barcelona', 2003, today('f-fc-barcelona')],
    // Real Madrid's plain club crest (the football club's of today) to 2008/09, today's lockup after.
    ['el-real-madrid', 2009, today('f-real-madrid')], ['el-real-madrid', 2010, today('el-real-madrid')],
    // Valencia's 2017 badge through 2025/26 (its 40th-year crest is 2026/27's); Efes's 50th-year logo in 2025/26.
    ['el-valencia-basket', 2026, 'el-valencia-basket.2018'], ['el-valencia-basket', null, today('el-valencia-basket')],
    ['el-anadolu-efes', 2025, today('el-anadolu-efes')], ['el-anadolu-efes', 2026, 'el-anadolu-efes.2026'],
    // CSKA's red-star shield, first dated in 2006/07, stands for its seasons before (no picture shows an older logo).
    ['el-cska-moscow', 2002, 'el-cska-moscow.2007'], ['el-cska-moscow', 2006, 'el-cska-moscow.2007'],
    ['el-cska-moscow', 2007, 'el-cska-moscow.2007'], ['el-cska-moscow', 2018, 'el-cska-moscow.2018'],
    ['el-arka-gdynia', 2008, 'el-arka-gdynia.2005'], ['el-arka-gdynia', 2009, 'el-arka-gdynia.2009'],
    // Galatasaray under the sports club's plain GS emblem (the stars are the football team's, round 3); AEK's 1997 emblem
    // has no picture, so its 2004 redraw stands for it; Olimpija's dragon roundel from 2005/06 (round 3) for the seasons
    // before it too.
    ['el-galatasaray', 2014, 'f-galatasaray-sk.1994'], ['el-aek-athens', 2004, 'el-aek-athens.2005'], ['el-aek-athens', 2005, 'el-aek-athens.2005'],
    ['el-olimpija', 2005, 'el-olimpija.2006'], ['el-olimpija', 2006, 'el-olimpija.2006'],
    // ASVEL's 60th-year shield in 2009/10; the LDLC ASVEL logo since 2018/19 is its crest of today.
    ['el-asvel', 2010, 'el-asvel.2008'], ['el-asvel', 2020, today('el-asvel')], ['el-asvel', 2026, today('el-asvel')],
  ]) assert.equal(crestFile(id, year), file, `${id} ${year}`);
  assert.equal(today('el-asvel'), 'el-asvel');
  const asvel = read('public/club-logos/SOURCES.tsv').split('\n').find(line => line.startsWith('el-asvel\t'));
  assert.equal(asvel.split('\t')[6], 'https://en.wikipedia.org/wiki/File:LDLC_ASVEL_Basket.svg', 'ASVEL\'s crest of today is the LDLC ASVEL logo');
});

test('rugby league 1960 to 1997: every club wears the crest of its day, the era and gone clubs too', () => {
  const files = new Set(readdirSync(new URL('public/club-logos/', root)).filter(name => name.endsWith('.webp')).map(name => name.slice(0, -5)));
  // No season shows a monogram since November 2026 (docs/design/period-marks.md, "No club without a crest"): where no
  // picture shows the logo of the day, the nearest picture stands for it. Eastern Suburbs had no logo before 1967 and
  // Balmain no badge before 1964; Parramatta's logo to 1979, Penrith's before its panther of 1978, the badges of Balmain,
  // Norths, St. George and Wests before 1978 and the Sydney Tigers' roundel of 1996 differ but survive in no picture; no
  // source dates the Perth Reds' logo of 1997. Souths' and Wests' 90th-season badges of 1997, variants of the badges worn
  // before, show those (round 4).
  const monogram = {};
  const seasons = readdirSync(new URL('public/rugby-league/', root)).filter(name => /^nrl-(?:sl-)?(?:19[6-8]\d|199[0-7])\.json$/.test(name));
  assert.equal(seasons.length, 39, 'nrl-1960 ... nrl-1997 and nrl-sl-1997');
  for (const name of seasons) {
    const { year, clubs } = JSON.parse(read(`public/rugby-league/${name}`));
    for (const { id } of clubs) {
      const file = crestFile(id, year);
      if ((monogram[id] ?? []).some(([from, through]) => from <= year && year <= through)) assert.equal(file, null, `${id} ${year}: its monogram`);
      else assert.ok(file && files.has(file), `${id} ${year}: a crest the game ships`);
    }
  }
  const today = id => clubLogoFile(id);
  for (const [id, year, file] of [
    // Cronulla's four logos before the star of 1998, from Captain Cook's Endeavour in its first season.
    ['nrl-cronulla-sutherland-sharks', 1967, 'nrl-cronulla-sutherland-sharks.1967'], ['nrl-cronulla-sutherland-sharks', 1969, 'nrl-cronulla-sutherland-sharks.1968'],
    ['nrl-cronulla-sutherland-sharks', 1977, 'nrl-cronulla-sutherland-sharks.1970'], ['nrl-cronulla-sutherland-sharks', 1997, 'nrl-cronulla-sutherland-sharks.1978'],
    ['nrl-cronulla-sutherland-sharks', 1998, 'nrl-cronulla-sutherland-sharks.1998'],
    // Eastern Suburbs: "Easts to Win" to 1977 (the article's text over its gallery), the Eastern Suburbs shield to 1994.
    ['nrl-eastern-suburbs-roosters', 1977, 'nrl-eastern-suburbs-roosters.1967'], ['nrl-eastern-suburbs-roosters', 1978, 'nrl-eastern-suburbs-roosters.1978'],
    ['nrl-eastern-suburbs-roosters', 1994, 'nrl-eastern-suburbs-roosters.1978'], ['nrl-sydney-city-roosters', 1995, 'nrl-sydney-city-roosters.1995'],
    ['nrl-canterbury-bankstown-berries', 1960, 'nrl-canterbury-bankstown-berries.1960'], ['nrl-canterbury-bankstown-berries', 1977, 'nrl-canterbury-bankstown-berries.1960'],
    // First logos from the clubs' first seasons, and the clubs of 1995-1997.
    ['nrl-brisbane-broncos', 1988, 'nrl-brisbane-broncos.1988'], ['nrl-canberra-raiders', 1982, 'nrl-canberra-raiders.1982'],
    ['nrl-newcastle-knights', 1997, 'nrl-newcastle-knights.1988'], ['nrl-newcastle-knights', 1998, 'nrl-newcastle-knights.1998'],
    ['nrl-gold-coast-seagulls', 1990, 'nrl-gold-coast-seagulls.1990'], ['nrl-gold-coast-chargers', 1996, 'nrl-gold-coast-chargers.1996'],
    ['nrl-north-queensland-cowboys', 1997, 'nrl-north-queensland-cowboys.1995'], ['nrl-north-queensland-cowboys', 1998, 'nrl-north-queensland-cowboys.1998'],
    ['nrl-auckland-warriors', 1995, 'nrl-auckland-warriors.1995'], ['nrl-adelaide-rams', 1997, 'nrl-adelaide-rams.1997'],
    ['nrl-south-queensland-crushers', 1995, 'nrl-south-queensland-crushers.1995'], ['nrl-western-reds', 1996, 'nrl-western-reds.1995'],
    ['nrl-hunter-mariners', 1997, 'nrl-hunter-mariners.1997'], ['nrl-gold-coast-tweed-giants', 1989, 'nrl-gold-coast-tweed-giants.1988'],
    // Illawarra's logo of its NSWRL years to 1997 (the article over a file page that says 1997), its last from 1998.
    ['nrl-illawarra-steelers', 1982, 'nrl-illawarra-steelers.1982'], ['nrl-illawarra-steelers', 1997, 'nrl-illawarra-steelers.1982'],
    ['nrl-illawarra-steelers', 1998, 'nrl-illawarra-steelers.1998'],
    // Canterbury's snarling bulldog of 1978-1997 under its three names; the cartoon head from 1998.
    ['nrl-canterbury-bankstown-bulldogs', 1978, 'nrl-canterbury-bankstown-bulldogs.1978'], ['nrl-sydney-bulldogs', 1995, 'nrl-canterbury-bankstown-bulldogs.1978'],
    ['nrl-canterbury-bulldogs', 1997, 'nrl-canterbury-bankstown-bulldogs.1978'], ['nrl-canterbury-bulldogs', 1998, 'nrl-canterbury-bulldogs.1998'],
    // Penrith's panther of 1978 and its 1991 logo; Manly's MW sea eagle to 1979 and its circle of the 1980s.
    ['nrl-penrith-panthers', 1978, 'nrl-penrith-panthers.1978'], ['nrl-penrith-panthers', 1991, 'nrl-penrith-panthers.1991'],
    ['nrl-manly-warringah-sea-eagles', 1960, 'nrl-manly-warringah-sea-eagles.1960'], ['nrl-manly-warringah-sea-eagles', 1979, 'nrl-manly-warringah-sea-eagles.1960'],
    ['nrl-manly-warringah-sea-eagles', 1980, 'nrl-manly-warringah-sea-eagles.1980'], ['nrl-manly-warringah-sea-eagles', 1997, 'nrl-manly-warringah-sea-eagles.1980'],
    // Souths' emblem of 1959 to 1979; its red and green oval from 1980 (the season articles' jerseys, round 3) to 2007.
    ['nrl-south-sydney-rabbitohs', 1960, 'nrl-south-sydney-rabbitohs.1960'], ['nrl-south-sydney-rabbitohs', 1979, 'nrl-south-sydney-rabbitohs.1960'],
    ['nrl-south-sydney-rabbitohs', 1980, 'nrl-south-sydney-rabbitohs.1980'], ['nrl-south-sydney-rabbitohs', 1996, 'nrl-south-sydney-rabbitohs.1980'],
    // Wests' shield of 1978 to 1996; Parramatta's eel (today's crest) from 1980.
    ['nrl-western-suburbs-magpies', 1978, 'nrl-western-suburbs-magpies.1978'], ['nrl-western-suburbs-magpies', 1996, 'nrl-western-suburbs-magpies.1978'],
    ['nrl-parramatta-eels', 1980, today('nrl-parramatta-eels')], ['nrl-parramatta-eels', 1997, today('nrl-parramatta-eels')],
    // Round 3: the Newtown N shield (the Bluebags', the Jets' to 1977), the Jets' logo of 1978; Balmain's roundel, Norths'
    // bear and St. George's red shield from 1978; the Warriors' 2015 logo.
    ['nrl-newtown-bluebags', 1960, 'nrl-newtown-bluebags.1960'], ['nrl-newtown-jets', 1977, 'nrl-newtown-bluebags.1960'],
    ['nrl-newtown-jets', 1978, 'nrl-newtown-jets.1978'], ['nrl-balmain-tigers', 1978, 'nrl-balmain-tigers.1978'],
    ['nrl-sydney-tigers', 1995, 'nrl-balmain-tigers.1978'], ['nrl-north-sydney-bears', 1978, 'nrl-north-sydney-bears.1978'],
    ['nrl-st-george-dragons', 1978, 'nrl-st-george-dragons.1978'], ['nrl-new-zealand-warriors', 2015, 'nrl-new-zealand-warriors.2015'],
  ]) assert.equal(crestFile(id, year), file, `${id} ${year}`);
});

test('round 3: crests of the day in every sport, retired caricatures as monograms, crests of today brought up to date', () => {
  const today = id => clubLogoFile(id);
  for (const [id, year, file] of [
    // Crests of the 1990s-2010s pictured from archived infoboxes and other Wikipedias' galleries.
    ['nhl-florida-panthers', 2010, 'nhl-florida-panthers.1994'], ['nhl-vancouver-canucks', 2000, 'nhl-vancouver-canucks.1998'],
    ['f-ajax', 2010, 'f-ajax.1994'], ['f-ajax', 2026, today('f-ajax')], ['f-manchester-city', 2010, 'f-manchester-city.1998'],
    ['f-fiorentina', 2010, 'f-fiorentina.1995'], ['f-napoli', 2010, 'f-napoli.2008'], ['b-seattle-supersonics', 1990, 'b-seattle-supersonics.1976'],
    ['b-boston-celtics', 1980, 'b-boston-celtics.1977'], ['b-detroit-pistons', 1990, 'b-detroit-pistons.1979'],
    ['mlb-philadelphia-phillies', 1980, 'mlb-philadelphia-phillies.1970'], ['nfl-denver-broncos', 1980, 'nfl-denver-broncos.1968'],
    ['nfl-washington-football-team', 2020, 'nfl-washington-football-team.2020'],
    // The chip-size ruling is gone: Calgary's black-trimmed C of 1995-2020 is its own crest; its first C is today's.
    ['nhl-calgary-flames', 2010, 'nhl-calgary-flames.1995'], ['nhl-calgary-flames', 1990, today('nhl-calgary-flames')],
    // Clubs of all Europe's leagues, researched for the first time; stars counted (Galatasaray's four from 2015/16).
    ['f-galatasaray-sk', 2010, 'f-galatasaray-sk.1994'], ['f-galatasaray', 2020, 'f-galatasaray.2016'],
    ['f-glasgow-celtic', 1994, 'f-glasgow-celtic.1994'], ['f-anderlecht', 2016, 'f-rsc-anderlecht.2011'],
    ['f-spartak-moskva', 2016, 'f-spartak-moskva.2014'], ['f-rosenborg-bk', 2008, 'f-rosenborg-bk.2007'],
    // Women's sides under their club's crest of the day; rugby league's St. George shield from 1978.
    ['w-leicester-city', 2024, 'f-leicester-city.2011'], ['nrl-st-george-dragons', 1985, 'nrl-st-george-dragons.1978'],
    // Retired caricatures of Native Americans stay monograms (the user's choice, 15 November 2026), the Braves' too.
    ['mlb-cleveland-indians', 2015, null], ['mlb-milwaukee-braves', 1962, null], ['mlb-atlanta-braves', 1966, null],
    ['nfl-washington', 2000, null], ['b-philadelphia-warriors', 1961, null],
  ]) assert.equal(crestFile(id, year), file, `${id} ${year}`);
  // Crests of today read from their file pages (scripts/data/club-logos.json "pages"): the Braves' primary logo,
  // Rosenborg's of 2024, OB's of 2025, ASVEL's LDLC ASVEL logo.
  const pages = JSON.parse(read('scripts/data/club-logos.json')).pages;
  for (const [id, name] of [['mlb-atlanta-braves', 'Atlanta Braves.svg'], ['d578-1376', 'Rosenborg logo RGB.svg'],
    ['d208-545', 'Logo Odense Boldklub 2025.svg'], ['el-asvel', 'LDLC ASVEL Basket.svg']]) {
    assert.equal(pages[id]?.file, name, id);
    const row = read('public/club-logos/SOURCES.tsv').split('\n').find(line => line.startsWith(`${id}\t`));
    assert.equal(row?.split('\t')[3], name, `${id}: SOURCES.tsv names the file page's crest`);
  }
});

test('round 4: every club rechecked under the 64 px rule, a variant shows its nearest picture, crests of today renewed', () => {
  const today = id => clubLogoFile(id);
  for (const [id, year, file] of [
    // Crests the rounds before kept at today's design, told apart at 64 px and pictured: Arsenal's four crests of
    // 1994/95-2025/26, Juventus's J from 2017/18, PSG's of 2013/14, the Hawks' and Bruins' and Tigers' older marks.
    ['f-arsenal', 1995, 'f-arsenal.1995'], ['f-arsenal', 2012, 'f-arsenal.2012'], ['f-arsenal', 2026, today('f-arsenal')],
    ['f-juventus', 2017, 'f-juventus.2005'], ['f-juventus', 2018, 'f-juventus.2018'],
    ['f-paris-saint-germain', 2013, 'f-paris-saint-germain.2003'], ['f-paris-saint-germain', 2014, 'f-paris-saint-germain.2014'],
    ['b-atlanta-hawks', 1970, 'b-atlanta-hawks.1970'], ['nhl-boston-bruins', 1961, 'nhl-boston-bruins.1961'],
    ['mlb-detroit-tigers', 1994, 'mlb-detroit-tigers.1994'], ['nfl-dallas-cowboys', 1960, 'nfl-dallas-cowboys.1960'],
    ['nfl-dallas-cowboys', 1964, today('nfl-dallas-cowboys')], ['nrl-sydney-roosters', 2007, 'nrl-sydney-roosters.2007'],
    ['el-siena', 2003, 'el-siena.2003'],
    // A crest that differs from a pictured one only as a variant (stars, colours, small lettering, a one-season
    // anniversary logo) shows that nearest picture, not a monogram: Panathinaikos's two- and three-star ball under the
    // four-star picture, Chelsea's red lion under its yellow colouring, the Mets' first roundel under today's.
    ['el-panathinaikos', 2002, 'el-panathinaikos.2008'], ['f-chelsea', 1994, 'f-chelsea.1996'],
    ['mlb-new-york-mets', 1962, today('mlb-new-york-mets')], ['nrl-western-suburbs-magpies', 1997, 'nrl-western-suburbs-magpies.1978'],
    ['nhl-california-golden-seals', 1971, 'nhl-california-golden-seals.1975'],
    // The retired caricatures stay monograms. The Braves' logos before today's of 1987 are named by no source: the
    // monogram, not the logo of 1987. A different design with no picture shows the nearest picture since November 2026:
    // the Perth Reds' only logo, undated, for 1997.
    ['nrl-perth-reds', 1997, 'nrl-perth-reds.1997'], ['mlb-cleveland-indians', 2018, null], ['mlb-milwaukee-braves', 1960, null],
    ['mlb-atlanta-braves', 1967, null], ['mlb-atlanta-braves', 1986, null], ['mlb-atlanta-braves', 1987, today('mlb-atlanta-braves')],
    // Undated seasons right before a pictured crest show that picture, not today's crest of later years (PSV's stars
    // of 2020, St. Pauli's brown of 2018, Racing's "RC" of 2004, Valencia's C.F. crest of 2009/10) or a monogram.
    ['f-psv', 1994, 'f-psv.1997'], ['f-fc-st-pauli', 1996, 'f-fc-st-pauli.2007'], ['f-racing-santander', 1995, 'f-racing-club-de-santander.2004'],
    ['f-racing-club-de-santander', 1994, 'f-racing-club-de-santander.2004'], ['f-valencia-cf', 1995, 'f-valencia-cf.2005'],
    ['f-valencia-c-f', 1994, 'f-valencia-cf.2005'], ['f-de-graafschap', 2000, 'f-de-graafschap.2007'],
    // Women's sides under their own marks: FC Zürich Frauen's two stars, Fleury's logo of November 2023, Montpellier
    // under the HSC's roundel of 2025 before its own Montpellier FC logo of today.
    ['w-fc-zurich', 2024, 'w-fc-zurich.2024'], ['w-fc-fleury-91', 2024, 'w-fc-fleury-91.2024'],
    ['w-montpellier-fc', 2026, today('d250-859')],
  ]) assert.equal(crestFile(id, year), file, `${id} ${year}`);
  // Crests of today brought up to date from their file pages, English Wikipedia's or (where only that one has it) Italian
  // or French Wikipedia's: Benfica, Sassuolo's of 2025, Braga, Athletic, and the women's sides' own logos.
  const pages = JSON.parse(read('scripts/data/club-logos.json')).pages;
  const sources = read('public/club-logos/SOURCES.tsv').split('\n');
  for (const [id, name, wiki] of [['d620-1487', 'SL Benfica logo.svg'], ['d380-3800256', 'Sassuolocalcio2026.svg', 'it'],
    ['d620-1488', 'Logo SC Braga 2018.svg', 'fr'], ['d724-1664', 'Athletic Club Bilbao logo.svg', 'it'],
    ['w-fc-zurich', 'FC Zurich logo (with two stars).svg'], ['w-fc-fleury-91', 'Logo FC Fleury 91 - 2023-11.svg', 'fr'],
    ['w-montpellier-fc', 'Montpellier FC logo.png']]) {
    assert.equal(pages[id]?.file, name, id);
    assert.equal(pages[id]?.wiki, wiki, `${id}: its file page's Wikipedia`);
    const row = sources.find(line => line.startsWith(`${id}\t`))?.split('\t');
    assert.equal(row?.[3], name, `${id}: SOURCES.tsv names the file page's crest`);
    if (wiki) assert.ok(row[6].startsWith(`https://${wiki}.wikipedia.org/wiki/`), `${id}: links ${wiki}.wikipedia.org's file page`);
  }
  for (const id of ['w-fc-zurich', 'w-fc-fleury-91', 'w-montpellier-fc']) assert.equal(today(id), id, `${id}: a file of its own`);
  assert.equal(today('f-sassuolo'), 'd380-3800256', 'the all-leagues club shares its domestic twin\'s renewed crest');
});

test('TeamMark and SquadFlag draw the crest of the season on screen', () => {
  const entry = Object.entries(CREST_ERAS).find(([id, eras]) => clubLogoFile(id) && eras.some(([, , file]) => file));
  const [id, eras] = entry ?? ['b-boston-celtics', [[1961, 1961, null]]];
  const [from, , file] = eras.find(([, , era]) => era) ?? eras[0];
  const at = year => render(React.createElement(SeasonYear.Provider, { value: year },
    React.createElement(TeamMark, { id, teamId: id, code: 'XYZ', color: '#123456', isClub: true, width: 28 })));
  const today = at(null).querySelector('img')?.getAttribute('src') ?? null;
  assert.equal(today, clubLogoFile(id) ? `/club-logos/${clubLogoFile(id)}.webp` : null);
  const then = at(from);
  if (file) assert.equal(then.querySelector('img').getAttribute('src'), `/club-logos/${file}.webp`);
  else assert.equal(then.textContent, 'XYZ', 'no picture of the crest of the day: the monogram');
  const flag = render(React.createElement(SeasonYear.Provider, { value: from },
    React.createElement(SquadFlag, { teamId: id, isClub: true, width: 16 })));
  assert.equal(flag.querySelector('img')?.getAttribute('src') ?? null, file ? `/club-logos/${file}.webp` : null);
});
