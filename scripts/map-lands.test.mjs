// A country map's lands (src/engine/lands.js): each club's starting sections drawn as one piece, its outline alone, so
// the map never draws a line between a club's own sections. The sections stay the game's working units.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapLands, outlineRings, ringsPath } from '../src/engine/lands.js';
import { decodeDomestic, domesticLands } from '../src/engine/domestic.js';
import { createMapBorderIndex } from '../src/engine/mapBorders.js';

const signedArea = ring => {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return sum / 2;
};
const areaOf = rings => rings.reduce((sum, ring) => sum + signedArea(ring), 0);
/** Directed edges "x,y>x,y" → how many run that way less how many run back: what a fill by winding sees. */
function netEdges(rings) {
  const net = new Map();
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const from = ring[j].join(','), to = ring[i].join(',');
    if (from === to) continue;
    const [key, step] = from < to ? [`${from}>${to}`, 1] : [`${to}>${from}`, -1];
    net.set(key, (net.get(key) || 0) + step);
  }
  for (const [key, count] of net) if (!count) net.delete(key);
  return net;
}
/** Edges an outline runs both ways: a line with its land on both sides, which a stroke would draw inside it. */
function doubled(rings) {
  const runs = new Set(), both = [];
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) runs.add(`${ring[j]}>${ring[i]}`);
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (runs.has(`${ring[i]}>${ring[j]}`)) both.push(`${ring[j]}>${ring[i]}`);
  return both;
}
// Squares wound as the shipped maps' sections are (a negative area: land on the right of every edge).
const square = (x, y, size) => [[x, y], [x, y + size], [x + size, y + size], [x + size, y]];

test('two sections sharing an edge become one ring, with no edge between them', () => {
  const rings = outlineRings([[square(0, 0, 10)], [square(10, 0, 10)]]);
  assert.equal(rings.length, 1);
  assert.equal(ringsPath(rings), 'M10,0L0,0L0,10L10,10L20,10L20,0Z');
  assert.equal(areaOf(rings), -200, 'the land of both, wound as they are');
  assert.deepEqual(doubled(rings), []);
});

test('a land round another club’s section keeps it out: a hole wound the other way', () => {
  // A ring of four sections round the middle square, which another club holds.
  const ring = [
    [[0, 0], [0, 10], [10, 10], [20, 10], [30, 10], [30, 0], [20, 0], [10, 0]],
    [[0, 20], [0, 30], [10, 30], [20, 30], [30, 30], [30, 20], [20, 20], [10, 20]],
    [[0, 10], [0, 20], [10, 20], [10, 10]],
    [[20, 10], [20, 20], [30, 20], [30, 10]],
  ];
  const rings = outlineRings(ring.map(section => [section]));
  assert.equal(rings.length, 2);
  const [outer, hole] = [...rings].sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  assert.equal(signedArea(outer), -900);
  assert.equal(signedArea(hole), 100, 'the middle is a hole: a fill by either rule leaves it to its own club');
  assert.equal(areaOf(rings), areaOf(ring.map(section => section)));
});

test('sections touching at a corner only come out as two rings, not one crossing itself', () => {
  const rings = outlineRings([[square(0, 0, 10)], [square(10, 10, 10)]]);
  assert.equal(rings.length, 2);
  assert.deepEqual(rings.map(signedArea), [-100, -100]);
  // A third section filling one of the other corners joins them along its edges.
  const joined = outlineRings([[square(0, 0, 10)], [square(10, 10, 10)], [square(10, 0, 10)]]);
  assert.equal(joined.length, 1);
  assert.equal(areaOf(joined), -300);
});

test('islands stay rings of their own, and a zero-width spike cancels itself out', () => {
  const rings = outlineRings([[square(0, 0, 10), square(30, 0, 5)], [square(10, 0, 10)]]);
  assert.equal(rings.length, 2);
  assert.equal(areaOf(rings), -225);
  // A zero-width spike (rounding can make one) cancels itself out of the outline.
  const spiked = outlineRings([[[[0, 0], [0, 10], [5, 10], [5, 15], [5, 10], [10, 10], [10, 0]]], [square(10, 0, 10)]]);
  assert.equal(ringsPath(spiked), 'M10,0L0,0L0,10L5,10L10,10L20,10L20,0Z');
});

test('mapLands: a club’s starting group is one land named by its home, every other section a land of its own', () => {
  const section = ring => ({ d: ringsPath([ring]), labelRings: [ring], bbox: { x: ring[0][0], y: ring[0][1], w: 10, h: 10 } });
  const paths = { a: section(square(0, 0, 10)), b: section(square(10, 0, 10)), c: section(square(20, 0, 10)),
    d: section(square(30, 0, 10)) };
  const lands = mapLands(['a', 'b', 'c', 'd', 'gone'], paths, [['c', 'a'], ['b'], ['gone', 'zzz']]);
  assert.ok(Object.isFrozen(lands));
  assert.deepEqual(lands.map(land => [land.id, land.sections]), [['c', ['c', 'a']], ['b', ['b']], ['d', ['d']]],
    'in the order the map first reaches each; a group named by its first section; sections without a path left out');
  assert.equal(lands[0].d, ringsPath(outlineRings([paths.c.labelRings, paths.a.labelRings])));
  assert.deepEqual(lands[0].bbox, { x: 0, y: 0, w: 30, h: 10 }, 'its box covers its sections');
  assert.equal(lands[1].d, paths.b.d, 'a land of one section is that section');
  assert.equal(lands[1].rings, paths.b.labelRings);
  assert.equal(lands[2].bbox, paths.d.bbox);
});

/** A shipped map decoded, with its lands. */
function shipped(id) {
  const map = decodeDomestic(JSON.parse(readFileSync(new URL(`../public/domestic/${id}.json`, import.meta.url), 'utf8')), id);
  return { map, lands: domesticLands(map) };
}

test('shipped maps: one land per club, each outline exactly its sections’ land with no line inside it', () => {
  // Sweden (40 clubs), Fiji (16 clubs over islands), Morocco, and Albania's 2026 map, whose sections have holes.
  for (const id of ['752', '242', '504', '008y2026']) {
    const { map, lands } = shipped(id);
    const clubless = Object.keys(map.sectionNames).filter(section => !map.startOwners[section]);
    assert.deepEqual(lands.map(land => land.id).sort(), [...map.clubs.map(club => club.homeSection), ...clubless].sort(),
      `${id}: a land per club, named by its home section`);
    for (const club of map.clubs) {
      const land = lands.find(candidate => candidate.id === club.homeSection);
      assert.deepEqual(land.sections, club.startSections, `${id}: ${club.name}'s land is its starting group`);
      const sections = club.startSections.flatMap(section => map.geo.paths[section].labelRings);
      assert.deepEqual(netEdges(land.rings), netEdges(sections), `${id}: ${club.name}'s outline winds as its sections do`);
      assert.deepEqual(doubled(land.rings), [], `${id}: no line inside ${club.name}'s land`);
      assert.ok(Math.abs(areaOf(land.rings) - areaOf(sections)) < 1e-6 * Math.abs(areaOf(sections)));
    }
    assert.equal(domesticLands(map), lands, `${id}: kept per map`);
  }
});

test('the border mesh draws no line inside a club’s land at kick-off, as it did between its sections', () => {
  const { map, lands } = shipped('752');
  const own = map.startOwners;
  const sections = createMapBorderIndex(map.geo.countries.map(section => ({ id: section.id, rings: map.geo.paths[section.id].labelRings })));
  assert.ok(sections.layers(own).innerD.length > 0, 'drawn by section, a club’s land is crossed by its sections’ lines');
  const drawn = createMapBorderIndex(lands.map(land => ({ id: land.id, rings: land.rings }))).layers(own);
  assert.equal(drawn.innerD, '', 'drawn by land, nothing but the borders between clubs');
  assert.ok(drawn.outerD.length > 0 && drawn.coastD.length > 0);
  // After a conquest the winner's two lands keep the old border between them, as conquered nations do.
  const [first, second] = map.clubs;
  const conquered = Object.fromEntries(Object.entries(own).map(([section, club]) => [section, club === second.id ? first.id : club]));
  const touching = lands.find(land => land.id === first.homeSection).rings.flat().map(point => point.join(','));
  const borderShared = lands.find(land => land.id === second.homeSection).rings.flat().some(point => touching.includes(point.join(',')));
  assert.equal(createMapBorderIndex(lands.map(land => ({ id: land.id, rings: land.rings }))).layers(conquered).innerD.length > 0,
    borderShared, 'a seam only where the two clubs met');
});
