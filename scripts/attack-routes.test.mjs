import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttackRouteIndex, firstForeignLand } from '../src/engine/attackRoutes.js';

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const shape = (...labelRings) => ({ labelRings });
const route = (ax, ay, bx, by) => ({ ax, ay, bx, by, dist: Math.hypot(bx - ax, by - ay) });
const hit = (paths, own, cp, attacker = 'A') => firstForeignLand(createAttackRouteIndex(paths), own, attacker, cp);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-11, `${a} ~= ${b}`);

test('first interior country wins even when another target capital is closer to the direction', () => {
  const paths = { source: shape(rect(0, 0, 2, 2)), blocker: shape(rect(3, 0, 1, 2)), target: shape(rect(5, 0, 2, 2)) };
  const result = hit(paths, { source: 'A', blocker: 'B', target: 'C' }, route(1, 1, 6, 1));
  assert.equal(result.countryId, 'blocker'); assert.equal(result.ownerId, 'B');
  near(result.t, .4); near(result.exitT, .6); near(result.x, 3); near(result.y, 1);
  assert.ok(Object.isFrozen(result));
});

test('neutral land blocks, while all currently owned holdings are passable', () => {
  const paths = { home: shape(rect(0, 0, 1, 2)), outpost: shape(rect(2, 0, 1, 2)), target: shape(rect(4, 0, 2, 2)) };
  const own = { home: 'A', outpost: 'A', target: 'B' };
  assert.equal(hit(paths, own, route(.5, 1, 5, 1)).countryId, 'target');
  delete own.outpost;
  const neutral = hit(paths, own, route(.5, 1, 5, 1));
  assert.equal(neutral.countryId, 'outpost'); assert.equal(neutral.ownerId, null);
  own.outpost = 'B';
  assert.equal(hit(paths, own, route(.5, 1, 5, 1)).countryId, 'outpost', 'target-owned outlying land is its first landing');
});

test('nonzero-winding holes and disconnected island rings match painted land', () => {
  const outer = rect(0, 0, 10, 10), hole = rect(2, 2, 6, 6).reverse();
  const paths = { donut: shape(outer, hole), target: shape(rect(5, 4, 1, 2)), island: shape(rect(20, 0, 1, 1), rect(24, 0, 1, 1)) };
  assert.equal(hit(paths, { target: 'B' }, route(3, 5, 5.5, 5)).countryId, 'target', 'hole is sea');
  const donut = hit(paths, {}, route(3, 5, 12, 5));
  assert.equal(donut.countryId, 'target', 'an unowned shape in the hole is still real neutral land');
  const onlyDonut = hit({ donut: paths.donut }, {}, route(3, 5, 12, 5));
  near(onlyDonut.x, 8);
  assert.equal(hit({ island: paths.island }, {}, route(22, .5, 26, .5)).countryId, 'island');
  near(hit({ island: paths.island }, {}, route(22, .5, 26, .5)).x, 24);
});

test('same-winding nested rings remain filled rather than incorrectly becoming holes', () => {
  const paths = { filled: shape(rect(0, 0, 10, 10), rect(2, 2, 6, 6)) };
  const result = hit(paths, {}, route(3, 5, 6, 5));
  assert.equal(result.countryId, 'filled'); assert.equal(result.t, 0); assert.equal(result.exitT, 1);
  const alongInternalEdge = hit(paths, {}, route(1, 2, 9, 2));
  assert.equal(alongInternalEdge.t, 0); assert.equal(alongInternalEdge.exitT, 1, 'an internal ring edge is not an unpainted coastline');
  const hole = { donut: shape(rect(0, 0, 10, 10), rect(2, 2, 6, 6).reverse()) };
  const alongHoleEdge = hit(hole, {}, route(1, 2, 9, 2));
  near(alongHoleEdge.exitT, 1 / 8, 'hole coastline is excluded');
});

test('thin islands are not sampled over and entry is independent of path insertion order', () => {
  const paths = { target: shape(rect(90, -1, 10, 2)), thin: shape(rect(23.456789, -1, .000001, 2)) };
  for (const cp of [route(0, 0, 100, 0), route(100, 0, 0, 0)]) {
    const result = hit(paths, { target: 'A' }, cp);
    assert.equal(result.countryId, 'thin');
    assert.ok(result.exitT > result.t);
    near(result.x, cp.ax === 0 ? 23.456789 : 23.456790);
  }
});

test('tangent vertices, shared boundary travel and collinear coast edges do not count as land entry', () => {
  const square = { land: shape(rect(2, 2, 2, 2)) };
  assert.equal(hit(square, {}, route(0, 2, 6, 2)), null, 'entire route follows lower coastline');
  assert.equal(hit(square, {}, route(0, 4, 6, 4)), null, 'entire route follows upper coastline');
  assert.equal(hit(square, {}, route(0, 4, 4, 0)), null, 'one corner touched only');
  assert.equal(hit(square, {}, route(0, 0, 2, 2)), null, 'endpoint touches boundary without interior span');
  const interior = hit(square, {}, route(0, 0, 6, 6));
  near(interior.t, 1 / 3); near(interior.exitT, 2 / 3);
});

test('repaired disconnected date-line parts cannot become an across-map land wedge', () => {
  const paths = { seam: shape(rect(-180, -3, 5, 6), rect(175, -3, 5, 6)), target: shape(rect(5, -1, 2, 2)) };
  const result = hit(paths, { target: 'B' }, route(-10, 0, 6, 0));
  assert.equal(result.countryId, 'target');
  assert.equal(hit({ seam: paths.seam }, {}, route(-10, 0, 10, 0)), null);
});

test('indexes are cached immutable snapshots and rebuild only for a new paths identity', () => {
  const paths = { land: shape(rect(2, -1, 1, 2)) };
  const index = createAttackRouteIndex(paths);
  assert.equal(createAttackRouteIndex(paths), index);
  assert.ok(Object.isFrozen(index)); assert.ok(Object.isFrozen(index.countries));
  assert.ok(Object.isFrozen(index.countries[0])); assert.ok(Object.isFrozen(index.countries[0].bounds));
  assert.ok(Object.isFrozen(index.countries[0].rings[0][0])); assert.ok(Object.isFrozen(index.countries[0].edges[0]));
  paths.land.labelRings[0].forEach(p => { p[0] += 10; });
  assert.equal(firstForeignLand(index, {}, 'A', route(0, 0, 4, 0)).x, 2, 'source mutation cannot alter a resolved snapshot');
  assert.equal(firstForeignLand(createAttackRouteIndex({ ...paths }), {}, 'A', route(0, 0, 4, 0)), null);
});

test('point-only fixtures, malformed rings, invalid and zero-length routes return no geometric hit', () => {
  assert.equal(createAttackRouteIndex(null), null);
  assert.equal(createAttackRouteIndex({ point: { cx: 1, cy: 2 } }), null);
  assert.equal(createAttackRouteIndex({ bad: shape([[NaN, 0], [1, 1], [2, 1]]) }), null);
  const index = createAttackRouteIndex({ land: shape(rect(0, 0, 5, 5)) });
  for (const cp of [null, route(1, 1, 1, 1), { ax: 0, ay: 0, bx: Infinity, by: 1 }, route(-1e300, 0, 1e300, 0)]) {
    assert.equal(firstForeignLand(index, {}, 'A', cp), null);
  }
});

test('geometrically coincident intervals resolve deterministically with unchanged ownership input', () => {
  const paths = { first: shape(rect(2, -1, 1, 2)), second: shape(rect(2, -1, 1, 2)) };
  const own = Object.freeze({ first: 'B', second: 'C' });
  for (let i = 0; i < 5; i++) assert.equal(hit(paths, own, route(0, 0, 4, 0)).countryId, 'first');
});

test('near bounding boxes never replace real first land, and bbox ordering preserves exact hit ties', () => {
  const broad = shape(rect(-20, 5, 2, 2), rect(3, -1, 1, 2));
  const near = shape(rect(2, -1, 1, 2));
  assert.equal(hit({ broad, near }, {}, route(0, 0, 10, 0)).countryId, 'near', 'a remote island cannot turn its spanning bbox into a hit');
  // The second country's broad bounds are checked first, but both actual
  // interiors start at x=3. Earlier source order must still win the tie.
  const first = shape(rect(3, -1, 1, 2));
  const second = shape(rect(-20, 5, 2, 2), rect(3, -1, 1, 2));
  assert.equal(hit({ first, second }, {}, route(0, 0, 10, 0)).countryId, 'first');
  assert.equal(hit({ first, second }, {}, route(10, 0, 0, 0)).countryId, 'first');
});
