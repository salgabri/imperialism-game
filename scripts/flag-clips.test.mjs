// Flags mode's clip paths (src/engine/flagClips.js): a region's banner shows through one path per territory and compact
// group of its parts, rather than one per part, and those paths cover exactly the land the parts' own paths covered.
// The browser's clip rule (nonzero) is read back here independently of the module, from the path data it writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { partPath, regionClips } from '../src/engine/flagClips.js';
import { createFlagRegionIndex, FLAG_REGION_GAP_KM } from '../src/engine/flagRegions.js';
import { WorldGeometry } from '../src/engine/geo.js';
import { DEPENDENCIES, NATIONS } from '../src/data/teams.js';
import { decodeDomestic } from '../src/engine/domestic.js';

const load = file => JSON.parse(readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8'));
// Square rings: counter-clockwise or clockwise on screen (y down), so their windings are opposite.
const square = (x, y, size, reverse = false) => {
  const ring = [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
  return reverse ? ring.reverse() : ring;
};
const part = (countryId, ...rings) => ({ countryId, rings });

/** SVG path data (M…L…Z subpaths) back to rings. */
const parse = d => d.split('M').filter(Boolean).map(sub => sub.replace(/Z$/, '').split('L').map(point => point.split(',').map(Number)));
function winding(rings, x, y) {
  let w = 0;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const cross = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
    if (a[1] <= y && b[1] > y && cross > 0) w++; else if (a[1] > y && b[1] <= y && cross < 0) w--;
  }
  return w;
}
const boxOf = rings => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
};
const within = (box, x, y) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;

/**
 * For each territory of `region`: sample a grid over every box where two of its parts meet (where joining them could
 * change anything) and compare the clips' nonzero fill with the union of the parts' own. → points checked
 */
function assertExact(region, label, samples = 12) {
  const clips = regionClips(region);
  const byTerritory = new Map();
  for (const p of region.parts) byTerritory.set(p.countryId, [...(byTerritory.get(p.countryId) || []), p]);
  let checked = 0;
  for (const [territory, parts] of byTerritory) {
    const drawn = clips.filter(c => c.countryId === territory).map(c => ({ rings: parse(c.d) }));
    drawn.forEach(d => { d.box = boxOf(d.rings); });
    const boxes = parts.map(p => boxOf(p.rings));
    const union = (x, y) => parts.some((p, k) => within(boxes[k], x, y) && winding(p.rings, x, y) !== 0);
    const clipped = (x, y) => drawn.some(d => within(d.box, x, y) && winding(d.rings, x, y) !== 0);
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const a = boxes[i], b = boxes[j];
      const x0 = Math.max(a.x0, b.x0), x1 = Math.min(a.x1, b.x1), y0 = Math.max(a.y0, b.y0), y1 = Math.min(a.y1, b.y1);
      if (x0 > x1 || y0 > y1) continue;
      for (let u = 0; u < samples; u++) for (let v = 0; v < samples; v++) {
        const x = x0 + (x1 - x0) * (u + .5) / samples, y = y0 + (y1 - y0) * (v + .37) / samples;
        assert.equal(clipped(x, y), union(x, y), `${label}, ${territory}: (${x}, ${y})`);
        checked++;
      }
    }
  }
  return checked;
}

test('a territory\'s parts in a region take one clip path: their own paths, joined in order', () => {
  const a = part('fr', square(0, 0, 10)), b = part('fr', square(12, 0, 6)), c = part('fr', square(0, 12, 4));
  const other = part('mc', square(30, 0, 5));
  const region = { parts: [a, other, b, c] };
  assert.deepEqual(regionClips(region), [{ countryId: 'fr', d: partPath(a) + partPath(b) + partPath(c) }, { countryId: 'mc', d: partPath(other) }]);
  assert.equal(partPath(a), 'M0,0L10,0L10,10L0,10Z', 'the format WorldMap has always drawn');
  assert.strictEqual(regionClips(region), regionClips(region), 'kept per region object');
});

test('overlapping parts that wind opposite ways keep paths of their own, so the overlap stays covered', () => {
  const a = part('nc', square(0, 0, 10)), b = part('nc', square(5, 5, 10, true)), c = part('nc', square(9, 9, 3));
  // Joined, the overlap would sum to zero and show the sea through the banner.
  assert.equal(winding([...a.rings, ...b.rings], 7, 7), 0);
  const region = { parts: [a, b, c] };
  assert.deepEqual(regionClips(region).map(clip => clip.d), [partPath(a) + partPath(c), partPath(b)],
    'the parts that wind alike join; the other keeps its own');
  assert.ok(assertExact(region, 'opposite windings') > 0);
});

test('a lake stays open, and land of another part inside it is covered', () => {
  // A mainland with a lake (wound the other way), an island in the lake, and an islet on the shore.
  const mainland = part('ug', square(0, 0, 30), square(10, 10, 10, true));
  const island = part('ug', square(13, 13, 4));
  const islet = part('ug', square(28, 28, 5, true));
  const region = { parts: [mainland, island, islet] };
  const clips = regionClips(region);
  assert.deepEqual(clips.map(clip => clip.d), [partPath(mainland) + partPath(island), partPath(islet)], 'the islet winds the other way');
  const rings = parse(clips[0].d);
  assert.equal(winding(rings, 11, 11), 0, 'the lake');
  assert.notEqual(winding(rings, 15, 15), 0, 'the island in it');
  assert.ok(clips.some(clip => winding(parse(clip.d), 29, 29) !== 0), 'where the islet overlaps the shore');
  assertExact(region, 'lake');
});

test('a part that could wind both ways inside itself keeps a path of its own where it meets another', () => {
  // Its island in a lake turns like the lake, so the island winds -1 where the land winds +1.
  const odd = part('xx', square(0, 0, 30), square(5, 5, 20, true), square(10, 10, 5, true));
  const neighbour = part('xx', square(8, 8, 10));
  const region = { parts: [odd, neighbour] };
  const clips = regionClips(region);
  assert.equal(clips.length, 2);
  assert.ok(clips.some(clip => clip.d === partPath(odd)));
  assertExact(region, 'mixed winding');
});

test('islands far from the rest of their land in the region keep their own path, near ones join', () => {
  const mainland = part('pt', square(0, 0, 40)), near = part('pt', square(42, 10, 5)), far = part('pt', square(400, 300, 3));
  const clips = regionClips({ parts: [mainland, near, far] });
  assert.deepEqual(clips.map(clip => clip.d), [partPath(mainland) + partPath(near), partPath(far)],
    'one path spread over the sea between them would make the map draw the banner over all of it');
});

test('a large landmass keeps a path of its own; the small islands off its coast share one', () => {
  // A mainland drawn with 300 vertices, and three islands of four inside its box.
  const outline = Array.from({ length: 300 }, (_, i) => [50 + 50 * Math.cos(-i * Math.PI / 150), 50 + 50 * Math.sin(-i * Math.PI / 150)]);
  const mainland = part('ca', outline);
  const islands = [square(92, 92, 3), square(95, 88, 2), square(93, 95, 2)].map(ring => part('ca', ring));
  const clips = regionClips({ parts: [mainland, ...islands] });
  assert.deepEqual(clips.map(clip => clip.d), [partPath(mainland), islands.map(partPath).join('')],
    'every map tile the mainland touches would draw the islands again');
});

test('on the world map and the country maps whose parts overlap, every clip covers exactly its parts', t => {
  const rules = new WorldGeometry(load('world-110m.v1.json')).fitTo(Object.keys(NATIONS));
  const display = new WorldGeometry(load('countries-50m.json'));
  const { s, tx, ty } = rules.fit, paths = display.buildPaths(s, tx, ty);
  const shapes = rules.countries.map(c => ({ id: c.id, rings: (paths[c.id] || rules.paths[c.id]).labelRings }));
  const index = createFlagRegionIndex(shapes, { maxGap: FLAG_REGION_GAP_KM / rules.kmPerUnit });
  const nations = Object.fromEntries(rules.countries.filter(c => NATIONS[c.id] || DEPENDENCIES[c.id])
    .map(c => [c.id, NATIONS[c.id] ? c.id : DEPENDENCIES[c.id].of]));
  const board = index.components(nations);
  const parts = board.reduce((n, region) => n + region.parts.length, 0);
  const clips = board.reduce((n, region) => n + regionClips(region).length, 0);
  assert.ok(clips < parts * .6, `the World War board draws ${clips} banner copies for ${parts} parts`);
  let checked = 0;
  // Every territory's parts in one region, the most any board can join.
  for (const shape of shapes) for (const region of index.components({ [shape.id]: 'one' })) checked += assertExact(region, `world ${shape.id}`, 6);
  // Indonesia and New Caledonia: the country maps with parts that overlap and wind opposite ways.
  for (const id of ['360', '540']) {
    const domestic = decodeDomestic(load(`domestic/${id}.json`), id);
    const sections = domestic.geo.countries.map(c => ({ id: c.id, rings: domestic.geo.paths[c.id].labelRings }));
    const country = createFlagRegionIndex(sections, { maxGap: FLAG_REGION_GAP_KM / domestic.geo.kmPerUnit });
    for (const section of sections) for (const region of country.components({ [section.id]: 'one' })) checked += assertExact(region, `map ${id} ${section.id}`, 8);
  }
  t.diagnostic(`World War board: ${parts} parts, ${clips} clip paths; ${checked} points checked`);
});
