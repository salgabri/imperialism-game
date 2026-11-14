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

// ---------- crests of the day ----------

const compiled = await build({
  stdin: {
    contents: `export { default as TeamMark } from './src/components/TeamMark.jsx';
      export { default as SquadFlag } from './src/screens/squad/SquadFlag.jsx';
      export { SeasonYear } from './src/components/seasonYear.js';
      export { crestFile, crestUrl } from './src/data/crests.js';`,
    resolveDir: fileURLToPath(root), loader: 'jsx',
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'], jsx: 'automatic',
  loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
});
const bundled = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
const { TeamMark, SquadFlag, SeasonYear, crestFile, crestUrl } = bundled.exports;
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
  // Gone clubs whose logo of 1998-1999 no source dates keep their monogram (docs/design/period-marks.md, "Coverage").
  const undated = new Set(['nrl-balmain-tigers', 'nrl-north-sydney-bears', 'nrl-western-suburbs-magpies']);
  for (let year = 1998; year <= 2007; year++) {
    const { clubs } = JSON.parse(read(`public/rugby-league/nrl-${year}.json`));
    for (const { id } of clubs) {
      const file = crestFile(id, year);
      if (undated.has(id)) assert.equal(file, null, `${id} ${year}: its monogram`);
      else assert.ok(file && files.has(file), `${id} ${year}: a crest the game ships`);
    }
  }
  const today = id => clubLogoFile(id);
  for (const [id, year, file] of [
    ['nrl-brisbane-broncos', 1999, 'nrl-brisbane-broncos.1998'], ['nrl-brisbane-broncos', 2000, 'nrl-brisbane-broncos.2000'],
    ['nrl-sydney-city-roosters', 1999, 'nrl-sydney-city-roosters.1998'], ['nrl-sydney-roosters', 2000, today('nrl-sydney-roosters')],
    ['nrl-st-george-dragons', 1998, 'nrl-st-george-dragons.1998'], ['nrl-st-george-illawarra-dragons', 1999, today('nrl-st-george-illawarra-dragons')],
    ['nrl-auckland-warriors', 2000, 'nrl-auckland-warriors.1998'], ['nrl-new-zealand-warriors', 2001, today('nrl-new-zealand-warriors')],
    ['nrl-north-queensland-cowboys', 2002, 'nrl-north-queensland-cowboys.1998'], ['nrl-north-queensland-cowboys', 2003, today('nrl-north-queensland-cowboys')],
    // Aliases share their club's picture: the Sharks of 1999-2002, the Bulldogs of 2000-2009.
    ['nrl-sharks', 2001, 'nrl-cronulla-sutherland-sharks.1998'], ['nrl-bulldogs', 2005, 'nrl-canterbury-bulldogs.1998'],
    // The first round's two corrections: the Bulldogs' head in 2008-2009, Parramatta's yellow eel to 2010.
    ['nrl-bulldogs', 2009, 'nrl-canterbury-bulldogs.1998'], ['nrl-parramatta-eels', 1999, today('nrl-parramatta-eels')],
    ['nrl-parramatta-eels', 2003, 'nrl-parramatta-eels.2000'], ['nrl-parramatta-eels', 2009, 'nrl-parramatta-eels.2004'],
    ['nrl-parramatta-eels', 2011, today('nrl-parramatta-eels')],
    ['nrl-south-sydney-rabbitohs', 2007, 'nrl-south-sydney-rabbitohs.1998'], ['nrl-south-sydney-rabbitohs', 2008, today('nrl-south-sydney-rabbitohs')],
  ]) assert.equal(crestFile(id, year), file, `${id} ${year}`);
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
