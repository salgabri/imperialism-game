// The administrative levels the Europe maps split a country along (scripts/lib/admin-levels.mjs): every European nation
// of the game with a world shape has its hierarchy, coarsest first, down to the finest level the sources have, and every
// level geoBoundaries lists is used or skipped for a stated reason. Levels drawn apart are made to nest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { NATIONS } from '../src/data/teams.js';
import { checkLevels, COUNTRIES, levelRank, NE_COUNTY, naturalEarthGroups, nestLevels, ONS_DISTRICTS } from './lib/admin-levels.mjs';
import { interiorPoint, pointInPolys, polysOf } from './lib/domestic-partition.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const ATLAS = JSON.parse(read('public/countries-50m.json'));
const WORLD_IDS = new Set(ATLAS.objects.countries.geometries.map(g => (g.id != null ? String(g.id) : g.properties?.name === 'Kosovo' ? 'KOS' : null)));
const META = new URL('../data-src/boundaries/gbOpen-ALL-ALL.json', import.meta.url);
const NE = new URL('../data-src/boundaries/ne/ne_10m_admin_1.geojson', import.meta.url);
const ONS = new URL('../data-src/boundaries/ons/LAD-2019-12-GCB-UK.geojson', import.meta.url);
const square = (x, y, size = 1) => [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]];

test('every European nation with a world shape has its levels, coarsest first, down to the finest the sources have', () => {
  const uefa = Object.entries(NATIONS).filter(([, nation]) => nation[2] === 'UEFA').map(([id]) => id);
  for (const id of uefa) {
    if (!WORLD_IDS.has(id)) continue; // East Germany: no world shape, and no season with clubs before 1990
    assert.ok(COUNTRIES[id], `${NATIONS[id][0]} (${id}) has its levels`);
  }
  assert.deepEqual(Object.keys(COUNTRIES).filter(id => !uefa.includes(id)), [], 'and no other country is listed');
  for (const [id, spec] of Object.entries(COUNTRIES)) {
    assert.ok(spec.levels.length >= 1 && !spec.levels.at(-1).startsWith('NE:'), `${id}: the finest level is geoBoundaries' or the ONS's`);
    const ranks = spec.levels.map(levelRank);
    assert.ok(ranks.every((rank, i) => !i || rank > ranks[i - 1] || (rank === 0 && ranks[i - 1] === 0)), `${id}: coarsest first`);
    for (const [level, why] of Object.entries(spec.skip ?? {})) assert.ok(/^ADM\d$/.test(level) && why.length > 20, `${id}: ${level} is skipped for a stated reason`);
  }
  // The levels named: regions, then provinces or departments, then communes.
  assert.deepEqual(COUNTRIES[250].levels, ['ADM1', 'ADM2', 'ADM3', 'ADM5'], 'France: régions, départements, arrondissements, communes');
  assert.deepEqual(COUNTRIES[380].levels, ['ADM2', 'ADM3', 'ADM4'], 'Italy: regions, provinces, comuni');
  assert.deepEqual(COUNTRIES[724].levels, ['ADM1', 'ADM2', 'ADM3'], 'Spain: communities, provinces, municipalities');
  assert.deepEqual(COUNTRIES[620].levels, ['ADM1', 'ADM2', 'ADM3'], 'Portugal: districts, municipalities, parishes');
  assert.deepEqual(COUNTRIES[826].levels, [NE_COUNTY, 'ADM2', ONS_DISTRICTS], 'England: counties, councils, districts');
  assert.ok(COUNTRIES[380].skip.ADM1 && COUNTRIES[250].skip.ADM4, 'Italy\'s statistical groups of regions and France\'s cantons are left out, with reasons');
});

test('the levels match what geoBoundaries lists for each country', { skip: !existsSync(META) && 'the geoBoundaries metadata (data-src/boundaries/) is not on this computer' }, () => {
  const meta = JSON.parse(readFileSync(META, 'utf8'));
  for (const [id, spec] of Object.entries(COUNTRIES)) {
    const rows = meta.filter(row => row.boundaryISO === spec.iso3 && row.boundaryLicense !== 'Other - Direct Permission');
    assert.doesNotThrow(() => checkLevels(id, spec, rows), id);
  }
  // A level neither used nor skipped stops the build, as does one out of order, missing, or from no source.
  const rows = ['ADM0', 'ADM1', 'ADM2', 'ADM3'].map(boundaryType => ({ boundaryType }));
  assert.throws(() => checkLevels('X', { iso3: 'XXX', levels: ['ADM1', 'ADM2'] }, rows), /has ADM3, which COUNTRIES neither uses nor skips/);
  assert.throws(() => checkLevels('X', { iso3: 'XXX', levels: ['ADM2', 'ADM1', 'ADM3'] }, rows), /not coarsest first/);
  assert.throws(() => checkLevels('X', { iso3: 'XXX', levels: ['ADM1', 'ADM2', 'ADM4'] }, rows), /no ADM4 layer/);
  assert.throws(() => checkLevels('X', { iso3: 'XXX', levels: ['ADM1', 'ADM2', 'ADM3', ONS_DISTRICTS] }, rows), /the United Kingdom's/);
});

test('the home nations\' counties come from Natural Earth, Wigan in Greater Manchester', { skip: !existsSync(NE) && 'Natural Earth admin-1 (data-src/boundaries/ne/) is not on this computer' }, () => {
  const features = JSON.parse(readFileSync(NE, 'utf8')).features;
  const counties = naturalEarthGroups(features, COUNTRIES[826], 'region_sub', polysOf);
  assert.ok(counties.length > 40 && ['Greater Manchester', 'Merseyside', 'Lancashire', 'Greater London', 'West Yorkshire'].every(name => counties.some(c => c.name === name)));
  const wigan = features.find(f => f.properties.iso_3166_2 === 'GB-WGN');
  const manchester = counties.find(c => c.name === 'Greater Manchester');
  assert.ok(pointInPolys(interiorPoint(polysOf(wigan.geometry)), manchester.polys), 'Wigan is one of Greater Manchester\'s ten boroughs');
  assert.deepEqual(naturalEarthGroups(features, COUNTRIES.WAL, 'region_sub', polysOf).map(r => r.name).sort(), ['Mid Wales', 'North Wales', 'South Wales', 'West Wales']);
  assert.ok(naturalEarthGroups(features, COUNTRIES.SCO, 'region_sub', polysOf).some(r => r.name === 'Glasgow City Region'));
  assert.throws(() => naturalEarthGroups(features, COUNTRIES[250], 'region_sub', polysOf), /home nations/);
});

test('England\'s districts are the ONS\'s, inside its two-tier counties', { skip: !existsSync(ONS) && 'the ONS districts (data-src/boundaries/ons/) are not on this computer' }, () => {
  const features = JSON.parse(readFileSync(ONS, 'utf8')).features;
  const england = features.filter(f => f.properties.lad19cd.startsWith('E'));
  assert.equal(england.length, 317, 'England\'s 317 districts and unitary authorities of December 2019');
  const named = name => england.find(f => f.properties.lad19nm === name);
  for (const name of ['Preston', 'Burnley', 'Lancaster', 'Eden', 'Manchester', 'Liverpool']) assert.ok(named(name), name);
  // Preston lies in Lancashire, Eden in Cumbria: points of the districts, not the counties around them.
  assert.ok(pointInPolys([-2.7, 53.76], polysOf(named('Preston').geometry)));
  assert.ok(pointInPolys([-2.75, 54.66], polysOf(named('Eden').geometry)));
});

test('a unit whose region lies in another parent moves to the nearest region of its own', () => {
  // Two top regions, west (x < 2) and east; three middle regions drawn crudely: M0 and M1 in the west, M2 in the east,
  // but M1's shape reaches over the line and takes in unit 3, whose top region is the east.
  const top = [{ polys: [square(0, 0, 2)] }, { polys: [square(2, 0, 2)] }];
  const middle = [{ polys: [square(0, 0, 1)] }, { polys: [square(1, 0, 1.6)] }, { polys: [square(2.6, 0, 1.4)] }];
  const points = [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [2.3, 0.5], [3.5, 0.5]];
  const areas = [1, 1, 1, 0.2, 1];
  const assign = [[0, 0, 0, 1, 1], [0, 1, 1, 1, 2]];
  assert.equal(nestLevels([top, middle], assign, points, areas), 1);
  assert.deepEqual(assign, [[0, 0, 0, 1, 1], [0, 1, 1, 2, 2]], 'unit 3 joins M2, the east\'s own middle region');
  // A parent with no region of its own at the level below keeps the unit's region there: it stands under both.
  const lone = [[0, 1], [0, 0]];
  assert.equal(nestLevels([top, [middle[0]]], lone, [[0.5, 0.5], [3, 0.5]], [1, 1]), 0);
  assert.deepEqual(lone, [[0, 1], [0, 0]]);
});

test('a piece of a region cut off from the rest by another region joins the one around it; one across the water stays', () => {
  // Units in a row 0 - 1 - 2, with 3 hanging off 1 and 4 an island. Region A holds 0, 2 and 4, region B 1 and 3: unit 2 is
  // A's only through B's land, as a parish a crude municipal layer put in the next municipality.
  const adjacency = [[1], [0, 2, 3], [1], [1], []];
  const assign = [[0, 1, 0, 1, 0]];
  assert.equal(nestLevels([[{}, {}]], assign, [], [5, 3, 1, 2, 1], adjacency), 1);
  assert.deepEqual(assign, [[0, 1, 1, 1, 0]], 'unit 2 joins B, the island 4 stays A\'s');
});
