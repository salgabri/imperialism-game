// The world map as it stood in a season's year (docs/design/historic-maps.md): East Germany on the maps up to 1990,
// today's map untouched, the capitals and the names of the day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WorldGeometry, mergeSharedIds } from '../src/engine/geo.js';
import { atlasOfYear, CAPITALS_OF_THE_DAY, capitalsOfYear, mapEraOf } from '../src/engine/historicMap.js';
import { CAPITALS } from '../src/data/capitals.js';
import { FLAG_CODES } from '../src/data/flags.js';
import { NATION_COLOURS } from '../src/data/nationColours.js';
import { HISTORIC_NATIONS, HISTORIC_THROUGH, NATIONS, nationIdentity } from '../src/data/teams.js';
import { NAMES_OF_THE_DAY, namesOfTheDay } from '../src/data/namesOfTheDay.js';
import { BUILT_IN_SETS, decodeFootballSet, fieldedNations, seasonSport, setSportOf } from '../src/engine/footballSets.js';
import { mapYearOf } from '../src/app/shared.js';
import { HISTORIC_CUTS } from './lib/historic-shapes.mjs';

const load = file => JSON.parse(readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8'));
const RULES = load('world-110m.v1.json'), ATLAS = load('countries-50m.json');
const season = id => seasonSport(decodeFootballSet(load(`${setSportOf(id)}/${id}.json`), id));

test('today\'s map is the atlas itself: the historic shapes sit apart, and no year after 1990 reads them', () => {
  for (const atlas of [RULES, ATLAS]) {
    assert.equal(atlas.objects.historic.type, 'GeometryCollection');
    assert.deepEqual(atlas.objects.historic.geometries.map(geometry => [String(geometry.id), geometry.properties.through]),
      [['276', 1990], ['278', 1990], ['203', 1990], ['704', 1975], ['RVN', 1975], ['418', 1975]]);
    assert.ok(!atlas.objects.countries.geometries.some(geometry => ['278', 'RVN'].includes(String(geometry.id))), 'no East Germany or South Vietnam today');
    for (const year of [null, 1991, 1994, 2026]) assert.equal(atlasOfYear(atlas, year), atlas, `${year}: today's map`);
    for (const year of [1962, 1974, 1975]) assert.equal(mapEraOf(atlas, year), 'historic:0,1,2,3,4,5');
    for (const year of [1976, 1985, 1990]) assert.equal(mapEraOf(atlas, year), 'historic:0,1,2');
    // One copy per era: the same object for every year of it.
    assert.equal(atlasOfYear(atlas, 1976), atlasOfYear(atlas, 1990));
    assert.equal(atlasOfYear(atlas, 1962), atlasOfYear(atlas, 1975));
  }
  // The historic arcs come after every arc of today's map, so today's decode reads exactly the arcs it always did.
  const used = new Set(RULES.objects.countries.geometries.flatMap(g => (g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [])
    .flat(2).map(ref => (ref < 0 ? ~ref : ref))));
  const historic = new Set(RULES.objects.historic.geometries.flatMap(g => (g.type === 'Polygon' ? [g.arcs] : g.arcs).flat(2).map(ref => (ref < 0 ? ~ref : ref))));
  assert.ok(Math.max(...used) < Math.min(...[...historic].filter(arc => !used.has(arc))));
});

test('the map of 1990: East Germany between West Germany, Poland and Czechoslovakia, Berlin its capital, Bonn West Germany\'s', () => {
  const today = new WorldGeometry(RULES, CAPITALS);
  const then = new WorldGeometry(atlasOfYear(RULES, 1990), capitalsOfYear(RULES, 1990));
  assert.equal(then.countries.length, today.countries.length + 1);
  assert.deepEqual([...then.adj['278']].sort(), ['203', '276', '616']);
  assert.ok(!then.adj['276'].has('616'), 'West Germany never bordered Poland');
  assert.deepEqual([...today.adj['276']].sort(), ['040', '056', '203', '208', '250', '442', '528', '616', '756']);
  // Every other shape decodes exactly as today's, point for point.
  const ring = (geo, id) => JSON.stringify(geo.countries.find(country => country.id === id).polys);
  for (const country of today.countries) if (!['276', '203'].includes(country.id)) assert.equal(ring(then, country.id), ring(today, country.id), country.id);
  // Czechoslovakia's outline is today's Czechia's: only its border arc with Germany is read in two pieces, at most one
  // point more where the tripoint with both Germanys falls between two of its corners.
  const points = (geo, id) => geo.countries.find(country => country.id === id).polys.flat(2).map(point => point.join());
  const before = points(today, '203'), after = new Set(points(then, '203'));
  assert.ok(before.every(point => after.has(point)) && after.size - new Set(before).size <= 1);
  // The two capitals of the day.
  assert.deepEqual(capitalsOfYear(RULES, 1990)['276'], [7.10, 50.73]);
  assert.deepEqual(capitalsOfYear(RULES, 1990)['278'], CAPITALS['278']);
  assert.equal(capitalsOfYear(RULES, 2026), CAPITALS);
  assert.deepEqual(CAPITALS_OF_THE_DAY.map(capital => [capital.id, capital.with, capital.name]), [['276', '278', 'Bonn']]);
  // The display atlas draws it too: its mainland, Rügen and its share of Usedom.
  const display = new WorldGeometry(mergeSharedIds(atlasOfYear(ATLAS, 1990)), capitalsOfYear(ATLAS, 1990), { keepPolys: false, borderLengths: false });
  assert.ok(display.countries.some(country => country.id === '278'));
  assert.equal(atlasOfYear(ATLAS, 1990).objects.countries.geometries.find(g => String(g.id) === '278').arcs.length, 3);
});

test('East Germany is a nation of the map\'s earlier years: a flag, a colour, a capital, and a team only in its years', () => {
  assert.deepEqual([HISTORIC_NATIONS, HISTORIC_THROUGH], [['278', 'RVN'], { 278: 1990, RVN: 1975 }]);
  assert.deepEqual(NATIONS['278'].slice(0, 5), ['East Germany', 'GDR', 'UEFA', 'ger', 0]);
  assert.equal(FLAG_CODES['278'], 'dd');
  assert.ok(NATION_COLOURS['278']);
  assert.deepEqual(HISTORIC_CUTS.map(cut => [cut.id, cut.of, cut.through]), [['278', '276', 1990], ['RVN', '704', 1975]]);
  // Fielded by the seasons whose sources rate East German players, on the map of their year...
  const wc1974 = season('wc-1974'), cm89 = season('cm0102-2017-04-cm89');
  assert.ok(fieldedNations(wc1974).includes('278') && fieldedNations(cm89).includes('278'));
  assert.deepEqual(nationIdentity('278', wc1974), { name: 'East Germany', code: 'GDR', flagId: '278' });
  // ...and by no other: not in 1977/78 (no finalist), not after reunification.
  for (const id of ['wc-1978', 'wc-1990', 'swos-9495', 'ea-fifa-07', 'tennis-1985', 'wta-1985']) assert.ok(!fieldedNations(season(id)).includes('278'), id);
  // A season after 1990 cannot list East German players.
  const doc = load('football/ea-fifa-07.json');
  const listed = { ...doc, nations: { ...doc.nations, 278: doc.nations['276'] } };
  assert.throws(() => decodeFootballSet(listed, doc.id), /East Germany is on the map only up to 1990/);
});

test('the map of 1965: South Vietnam south of the 17th parallel, its Davis Cup team on its own land, North Vietnam neutral', () => {
  const then = new WorldGeometry(atlasOfYear(RULES, 1965), capitalsOfYear(RULES, 1965));
  assert.deepEqual([...then.adj.RVN].sort(), ['116', '418', '704']);
  assert.ok(!then.adj['704'].has('116'), 'North Vietnam never bordered Cambodia');
  assert.deepEqual([NATIONS.RVN[0], NATIONS.RVN[1], FLAG_CODES.RVN, CAPITALS.RVN], ['South Vietnam', 'VNM', 'rvn', [106.70, 10.78]]);
  const sport = season('tennis-1965');
  assert.ok(fieldedNations(sport).includes('RVN') && !fieldedNations(sport).includes('704'));
  assert.deepEqual(nationIdentity('RVN', sport), { name: 'South Vietnam', code: 'VNM', flagId: 'RVN' });
  for (const id of ['tennis-1976', 'tennis-1985', 'wc-1974']) assert.ok(!fieldedNations(season(id)).includes('RVN'), id);
  // 1976 on, one Vietnam again, and in 1976-1990 the map of East Germany alone.
  assert.ok(!new WorldGeometry(atlasOfYear(RULES, 1976), capitalsOfYear(RULES, 1976)).countries.some(country => country.id === 'RVN'));
});

test('a setup or campaign plays the map of its season\'s year: today\'s for the built-in season or a country map', () => {
  assert.equal(mapYearOf({ sport: 'football', layer: 'nations', dataSet: null }), null);
  assert.equal(mapYearOf({ sport: 'football', layer: 'nations', dataSet: 'wc-1974' }), 1974);
  assert.equal(mapYearOf({ sport: 'tennis', layer: 'nations', dataSet: 'tennis-1985' }), 1985);
  assert.equal(mapYearOf({ sport: 'football', layer: 'nations', dataSet: 'wc-1974', dataYear: 1974 }), 1974);
  assert.equal(mapYearOf({ sport: 'basketball', layer: 'nations', dataSet: 'wc-1974' }), null, 'another sport\'s season is no season');
  assert.equal(mapYearOf({ sport: 'hockey', layer: 'nations', dataSet: 'nhl-1982' }), 1982);
  assert.equal(mapYearOf({ sport: 'baseball', layer: 'nations', dataSet: 'mlb-war-1968' }), 1968);
  // Every built-in season with nations names its year.
  for (const set of BUILT_IN_SETS) {
    const year = mapYearOf({ sport: setSportOf(set.id), layer: 'nations', dataSet: set.id });
    assert.ok(year === set.year || year === null, set.id);
  }
});

test('the names of the day: tennis\'s federations, FR Yugoslavia, Swaziland and Macedonia, each sourced', () => {
  for (const entry of NAMES_OF_THE_DAY) {
    assert.ok(NATIONS[entry.shape], entry.name);
    assert.match(entry.code, /^[A-Z]{3}$/);
    assert.ok(Object.hasOwn(FLAG_CODES, entry.flagId), entry.flagId);
    assert.match(entry.source, /^https:\/\/en\.wikipedia\.org\/w\/index\.php\?oldid=\d+$/);
  }
  const named = (sport, year) => Object.fromEntries(Object.entries(namesOfTheDay(sport, year)).map(([shape, identity]) => [shape, identity.name]));
  assert.deepEqual(named('tennis', 1985), { 203: 'Czechoslovakia', 643: 'Soviet Union', 688: 'Yugoslavia', 276: 'West Germany', 748: 'Swaziland',
    807: 'Macedonia' });
  assert.deepEqual(named('tennis', 1992), { 203: 'Czechoslovakia', 643: 'CIS', 688: 'FR Yugoslavia', 748: 'Swaziland', 807: 'Macedonia' });
  assert.deepEqual(named('football', 2005), { 688: 'Serbia and Montenegro', 748: 'Swaziland', 807: 'Macedonia' });
  assert.deepEqual(named('football', 2019), {});
  assert.deepEqual(namesOfTheDay('tennis', null), {}, 'the built-in season plays today\'s names');
  // Each season plays them: a file's own win (the 1990 World Cup's West Germany), the table's fill the rest.
  assert.equal(nationIdentity('276', season('tennis-1985')).name, 'West Germany');
  assert.equal(nationIdentity('203', season('wta-1985')).name, 'Czechoslovakia');
  assert.deepEqual(nationIdentity('688', season('ea-fifa-06')), { name: 'Serbia and Montenegro', code: 'SCG', flagId: 'FRY' });
  assert.equal(nationIdentity('807', season('ea-fifa-18')).name, 'Macedonia');
  assert.equal(nationIdentity('807', season('ea-fifa-19')).name, NATIONS['807'][0], '2018/19: North Macedonia');
  assert.equal(nationIdentity('276', season('wc-1990')).name, 'West Germany');
  assert.equal(nationIdentity('643', season('tennis-1993')).name, NATIONS['643'][0], '1993: Russia');
});
