// Every map's territories hold their clubs' grounds (docs/design/domestic-campaigns.md, "Grounds"; the user, 2026-11-21:
// "a territory needs to own the part of the map where their city and stadium is in"). A club's land holds the point the
// map gives as its home (its ground, or its town where no ground is known), or lies within GROUND_SLACK_KM of it, as
// simplified borders move; clubs sharing a home (SAME_GROUND_KM: a stadium two clubs play at, or a town point the
// sources give several clubs) each hold land within SHARED_SLACK_KM of it; a home on no land (a ground on a coast drawn
// coarser than it stands, or across a border) has no other club's land nearer it. The sports' club maps (a continent at
// the opening fit) allow a quarter of a pixel there for their simplified county lines (UBS Arena stands 0.1 km inside
// Nassau County). The Europe maps of before their seasons' clubs came from all of Europe stay as they were, for the
// campaigns saved on them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import { EUROPE_MAPS } from '../src/data/europeMaps.js';
import { europeMapOf } from '../src/data/domesticScope.js';
import { bboxOf, GROUND_SLACK_KM, groundProblem, kmBetween, kmToPolys, polysAreaKm2, polysOf, SAME_GROUND_KM, SHARED_SLACK_KM } from './lib/domestic-partition.mjs';

const dir = new URL('../public/domestic/', import.meta.url);
const frozen = new Set(EUROPE_MAPS.filter(entry => entry.replacedBy).map(entry => entry.id));
const docs = readdirSync(dir).filter(file => file.endsWith('.json')).map(file => file.slice(0, -5)).filter(id => !frozen.has(id))
  .map(id => JSON.parse(readFileSync(new URL(`${id}.json`, dir), 'utf8'))).filter(doc => doc.topology && Array.isArray(doc.clubs));

const isCountry = doc => doc.format === 2;
const isEurope = doc => doc.format === 1 && doc.name === 'Europe';
const isClubMap = doc => doc.format === 1 && !isEurope(doc);

/** The clubs whose land misses their home, as "map club: km out, by holder". */
function astray(doc, { pixels = 0 } = {}) {
  const geoms = doc.topology.objects.sections.geometries;
  const index = new Map(geoms.map((g, i) => [g.id, i]));
  const polys = geoms.map(g => polysOf(feature(doc.topology, g).geometry));
  const lands = doc.clubs.map(club => {
    const own = (club.sections || [club.section]).flatMap(id => polys[index.get(id)]);
    return { polys: own, box: bboxOf(own) };
  });
  // A map across the antimeridian is drawn east of 180°; its homes are not.
  const east = bboxOf(polys.flat())[2] > 180;
  const frame = ([lon, lat]) => [east && lon < 0 ? lon + 360 : lon, lat];
  // A quarter of a pixel at the opening fit (960 by 540), where asked.
  const [w, s, e, n] = doc.focus;
  const pixel = Math.max(kmBetween([w, (s + n) / 2], [e, (s + n) / 2]) / 960, kmBetween([w, s], [w, n]) / 540);
  const out = [];
  doc.clubs.forEach((club, c) => {
    if (!club.home) return;
    const home = frame(club.home);
    const shared = doc.clubs.some((other, d) => d !== c && other.home && kmBetween(frame(other.home), home) <= SAME_GROUND_KM);
    const slack = Math.max(shared ? SHARED_SLACK_KM : GROUND_SLACK_KM, pixels * pixel);
    const problem = groundProblem(home, c, lands, slack);
    if (problem) out.push(`${doc.id} ${club.name ?? club.id}: ${problem.km.toFixed(2)} km out, by ${doc.clubs[problem.holder].name ?? doc.clubs[problem.holder].id}`);
  });
  return out;
}

test('every country map, today\'s and each earlier season\'s, holds each club\'s ground in its land', () => {
  const maps = docs.filter(isCountry);
  assert.ok(maps.length > 1800, `${maps.length} country maps`);
  assert.deepEqual(maps.flatMap(doc => astray(doc)), []);
});

test('every Europe map in play holds each club\'s ground in its land: Nice holds Nice', () => {
  const maps = docs.filter(isEurope);
  assert.ok(maps.length > 90, `${maps.length} Europe maps`);
  assert.deepEqual(maps.flatMap(doc => astray(doc)), []);
  // The Top 124's Nice, pushed 30 km up the Var by Monaco until 2026-11-21, Crystal Palace 26 km out of London and
  // Galatasaray, whose ground Beşiktaş's border had crossed: today's Top 124, those of them it holds.
  const top = docs.find(doc => doc.id === europeMapOf('all').id);
  const named = ['f-ogc-nice', 'f-crystal-palace', 'f-galatasaray-sk', 'f-panathinaikos-fc'].filter(id => top.clubs.some(club => club.id === id));
  assert.ok(named.length >= 2, `${top.id} holds ${named.join(', ')}`);
  for (const id of named) {
    const c = top.clubs.findIndex(club => club.id === id);
    const own = top.clubs[c].section;
    const g = top.topology.objects.sections.geometries.find(geom => geom.id === own);
    const polys = polysOf(feature(top.topology, g).geometry);
    assert.ok(kmToPolys(top.clubs[c].home, polys) < GROUND_SLACK_KM, `${id} holds its ground`);
  }
});

test('a fan leaves each of its clubs land of its own: Gokulam Kerala at Kozhikode, IFK Göteborg and GAIS at Ullevi', () => {
  // Until 2026-11-23 a fan's first edge could fall beside a ground and leave its club next to nothing (docs/design/
  // domestic-campaigns.md, "Grounds": fans): Gokulam Kerala 1.7 km² in two sections, the two Ullevi clubs about 2 km² in
  // twelve on Sweden's maps of 1994/95 and 2009/10, too thin to draw.
  const landOf = (doc, c) => {
    const geoms = doc.topology.objects.sections.geometries;
    return doc.clubs[c].sections.flatMap(id => polysOf(feature(doc.topology, geoms.find(g => g.id === id)).geometry));
  };
  for (const [id, name, km2] of [['356', /^Gokulam Kerala/, 1000], ['752y1995', /^IFK Gothenburg$/, 1000], ['752y1995', /^GAIS$/, 1000],
    ['752y2010', /^IFK Göteborg$/, 1000], ['752y2010', /^GAIS$/, 1000]]) {
    const doc = docs.find(d => d.id === id);
    const c = doc.clubs.findIndex(club => name.test(club.name ?? ''));
    assert.ok(c >= 0, `${id}: ${name}`);
    const area = polysAreaKm2(landOf(doc, c));
    assert.ok(area > km2, `${id} ${doc.clubs[c].name}: ${Math.round(area)} km²`);
  }
});

test('every club map of the other sports holds each club\'s ground in its land, to a quarter of a pixel', () => {
  const maps = docs.filter(isClubMap);
  assert.ok(maps.length > 200, `${maps.length} club maps`);
  assert.deepEqual(maps.flatMap(doc => astray(doc, { pixels: 0.25 })), []);
});
