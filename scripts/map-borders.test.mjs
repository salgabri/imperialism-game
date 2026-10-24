import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMapBorderIndex } from '../src/engine/mapBorders.js';
import { WorldGeometry, projPt } from '../src/engine/geo.js';

const left = [[0, 0], [2, 0], [2, 2], [0, 2]];
const right = [[2, 0], [4, 0], [4, 2], [2, 2]];
const shared = '2,0|2,2';
const pair = () => [{ id: 'a', rings: [left] }, { id: 'b', rings: [right] }];

/** Every drawn edge of a path made of `M x,y L x,y …[Z]` runs (one segment per run, or chained outlines). */
function edgeKeys(path) {
  const edges = [];
  for (const run of path.split('M').slice(1)) {
    const closed = run.endsWith('Z');
    const points = (closed ? run.slice(0, -1) : run).split('L')
      .map(point => point.split(',').map(Number).join(','));
    if (closed) points.push(points[0]);
    for (let i = 1; i < points.length; i++) edges.push([points[i - 1], points[i]].sort().join('|'));
  }
  return edges.sort();
}
const runCount = path => (path.match(/M/g) || []).length;

function ownerPath(mesh, id) {
  return mesh.ownerPaths.find(owner => owner.ownerId === id)?.d || '';
}

test('conquered neighbouring countries retain one inner seam and one outer perimeter', () => {
  const mesh = createMapBorderIndex(pair()).resolve({ a: 'empire', b: 'empire' });
  assert.deepEqual(edgeKeys(mesh.internalD), [shared]);
  assert.deepEqual(edgeKeys(mesh.borderD), [
    '0,0|0,2', '0,0|2,0', '0,2|2,2',
    '2,0|4,0', '2,2|4,2', '4,0|4,2',
  ].sort());
  assert.deepEqual(edgeKeys(ownerPath(mesh, 'empire')), edgeKeys(mesh.borderD));
});

test('foreign-owner edges are drawn once in the mesh and belong to both perimeters', () => {
  const mesh = createMapBorderIndex(pair()).resolve({ a: 'red', b: 'blue' });
  assert.equal(mesh.internalD, '');
  assert.equal(edgeKeys(mesh.borderD).length, 7);
  assert.equal(edgeKeys(mesh.borderD).filter(edge => edge === shared).length, 1);
  assert.equal(edgeKeys(ownerPath(mesh, 'red')).length, 4);
  assert.equal(edgeKeys(ownerPath(mesh, 'blue')).length, 4);
  assert.ok(edgeKeys(ownerPath(mesh, 'red')).includes(shared));
  assert.ok(edgeKeys(ownerPath(mesh, 'blue')).includes(shared));
});

test('neutral seams and coastlines stay quiet while active-versus-neutral borders remain strong', () => {
  const index = createMapBorderIndex(pair());
  const neutral = index.resolve({});
  assert.equal(neutral.borderD, '');
  assert.equal(edgeKeys(neutral.internalD).length, 7);
  assert.deepEqual(neutral.ownerPaths, []);
  const mixed = index.resolve({ a: 'empire' });
  assert.equal(edgeKeys(mixed.borderD).length, 4);
  assert.equal(edgeKeys(mixed.internalD).length, 3);
  assert.ok(edgeKeys(mixed.borderD).includes(shared));
  assert.ok(!edgeKeys(mixed.internalD).includes(shared));
  assert.deepEqual(mixed.ownerPaths.map(owner => owner.ownerId), ['empire']);
});

test('winding, repeated closing vertices and duplicate shapes do not affect classification', () => {
  const geometry = pair();
  geometry[0].rings = [[...left, left[0], left[0]]];
  geometry[1].rings = [[...right].reverse()];
  geometry.push({ id: 'a', rings: [left] });
  const mesh = createMapBorderIndex(geometry).resolve({ a: 'empire', b: 'empire' });
  assert.deepEqual(edgeKeys(mesh.internalD), [shared]);
  assert.equal(edgeKeys(mesh.borderD).length, 6);
  assert.ok(!mesh.borderD.includes('M0,0L0,0'));
});

test('holes are real perimeters until their land is claimed by the same owner', () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const hole = [[3, 3], [3, 7], [7, 7], [7, 3]];
  const donut = createMapBorderIndex([{ id: 'a', rings: [outer, hole] }]).resolve({ a: 'empire' });
  assert.equal(edgeKeys(donut.borderD).length, 8);
  assert.deepEqual(edgeKeys(donut.borderD).filter(edge => edge.startsWith('3,') || edge.startsWith('7,')), [
    '3,3|3,7', '3,3|7,3', '3,7|7,7', '7,3|7,7',
  ].sort());
  const filled = createMapBorderIndex([
    { id: 'a', rings: [outer, hole] }, { id: 'b', rings: [[...hole].reverse()] },
  ]).resolve({ a: 'empire', b: 'empire' });
  assert.equal(edgeKeys(filled.borderD).length, 4);
  assert.equal(edgeKeys(filled.internalD).length, 4);
});

test('islands and opposing date-line shores never acquire invented connections', () => {
  const islands = createMapBorderIndex([{ id: 'a', rings: [left,
    [[10, 0], [12, 0], [12, 2], [10, 2]],
  ] }]).resolve({ a: 'empire' });
  assert.equal(edgeKeys(islands.borderD).length, 8);
  assert.ok(!edgeKeys(islands.borderD).some(edge => edge === '10,0|2,0' || edge === '10,2|2,2'));
  const seam = createMapBorderIndex([{ id: 'a', rings: [
    [[-180, 0], [-175, 0], [-175, 2], [-180, 2]],
    [[175, 0], [180, 0], [180, 2], [175, 2]],
  ] }]).resolve({ a: 'empire' });
  assert.equal(edgeKeys(seam.borderD).length, 8);
  assert.equal(seam.internalD, '');
  for (const edge of edgeKeys(seam.borderD)) {
    const [a, b] = edge.split('|').map(point => point.split(',').map(Number));
    assert.ok(Math.abs(a[0] - b[0]) <= 5, `No cross-world join: ${edge}`);
  }
});

test('ownership changes invalidate the mesh even in place, while equivalent assignments reuse it', () => {
  const geometry = pair();
  const before = structuredClone(geometry);
  const index = createMapBorderIndex(geometry);
  const ownership = { a: 'red', b: 'blue' };
  const foreign = index.resolve(ownership);
  assert.equal(index.resolve({ a: 'red', b: 'blue', irrelevant: 'green' }), foreign);
  ownership.b = 'red';
  const conquered = index.resolve(ownership);
  assert.notEqual(conquered, foreign);
  assert.deepEqual(edgeKeys(conquered.internalD), [shared]);
  assert.deepEqual(geometry, before);
  assert.deepEqual(edgeKeys(foreign.borderD).length, 7);
});

test('empty and degenerate geometry produces an empty mesh', () => {
  assert.deepEqual(createMapBorderIndex().resolve(), { internalD: '', borderD: '', ownerPaths: [] });
  const mesh = createMapBorderIndex([{ id: 'a', rings: [[], [[0, 0]], [[1, 1], [1, 1]]] }]).resolve({ a: 'empire' });
  assert.deepEqual(mesh, { internalD: '', borderD: '', ownerPaths: [] });
});

test('both real atlases move a source-topology France/Germany border inside the conquered empire', () => {
  for (const filename of ['world-110m.v1.json', 'countries-50m.json']) {
    const topo = JSON.parse(readFileSync(new URL(`../public/${filename}`, import.meta.url), 'utf8'));
    const sourceCountries = topo.objects.countries.geometries;
    const sourceArcIds = id => sourceCountries.find(country => String(country.id) === id).arcs
      .flat(Infinity).map(arc => arc < 0 ? ~arc : arc);
    const germanArcs = new Set(sourceArcIds('276'));
    const commonArcs = sourceArcIds('250').filter(arc => germanArcs.has(arc));
    assert.ok(commonArcs.length, `${filename} provides a shared source-topology border`);

    const geo = new WorldGeometry(topo).fitTo(['250', '276']);
    const { s, tx, ty } = geo.fit;
    // This oracle reads the original shared TopoJSON arcs directly, separately
    // from the helper's country-ring segment index and path classifications.
    const sourceEdges = [];
    for (const arcId of commonArcs) {
      let x = 0, y = 0, previous;
      for (const delta of topo.arcs[arcId]) {
        x += delta[0]; y += delta[1];
        const point = projPt(x * topo.transform.scale[0] + topo.transform.translate[0],
          y * topo.transform.scale[1] + topo.transform.translate[1]);
        const current = `${Number((point[0] * s + tx).toFixed(1))},${Number((point[1] * s + ty).toFixed(1))}`;
        if (previous && current !== previous) sourceEdges.push([previous, current].sort().join('|'));
        previous = current;
      }
    }
    assert.ok(sourceEdges.length, `${filename} retains visible source border segments`);
    const index = createMapBorderIndex(geo.countries.map(country => ({ id: country.id, rings: geo.paths[country.id].labelRings })));
    const divided = index.resolve({ '250': 'france', '276': 'germany' });
    const dividedBorder = new Set(edgeKeys(divided.borderD));
    const conquered = index.resolve({ '250': 'france', '276': 'france' });
    const conqueredBorder = new Set(edgeKeys(conquered.borderD));
    const conqueredInternal = new Set(edgeKeys(conquered.internalD));
    for (const edge of sourceEdges) {
      assert.ok(dividedBorder.has(edge), `${filename}: shared foreign border ${edge} is strong`);
      assert.ok(conqueredInternal.has(edge), `${filename}: conquered border ${edge} becomes quiet`);
      assert.ok(!conqueredBorder.has(edge), `${filename}: conquered border ${edge} leaves the perimeter`);
    }
    assert.equal(index.resolve({ '250': 'france', '276': 'france' }), conquered);
  }
});

// v4 border classes (README "Map rendering", DEC D19): coast = one country,
// inner = a seam inside one empire, outer = every other land border.

/** Independent oracle: every rendered ring edge and the countries drawing it. */
function edgeCountries(geometry) {
  const edges = new Map();
  for (const shape of geometry) {
    if (shape?.id == null) continue;
    for (const ring of shape.rings || []) {
      if (ring.length < 2) continue;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const ka = `${a[0]},${a[1]}`, kb = `${b[0]},${b[1]}`;
        if (ka === kb) continue;
        const key = [ka, kb].sort().join('|');
        if (!edges.has(key)) edges.set(key, new Set());
        edges.get(key).add(String(shape.id));
      }
    }
  }
  return edges;
}

function expectedLayers(geometry, ownership) {
  const expected = { coast: [], inner: [], outer: [] };
  for (const [edge, ids] of edgeCountries(geometry)) {
    const owners = [...ids].map(id => ownership[id] ?? null);
    if (ids.size === 1) expected.coast.push(edge);
    else if (owners[0] !== null && owners.every(owner => owner === owners[0])) expected.inner.push(edge);
    else expected.outer.push(edge);
  }
  for (const key of Object.keys(expected)) expected[key].sort();
  return expected;
}

function assertLayers(geometry, ownership, layers, context = '') {
  const expected = expectedLayers(geometry, ownership);
  assert.deepEqual(edgeKeys(layers.coastD), expected.coast, `${context} coast`);
  assert.deepEqual(edgeKeys(layers.innerD), expected.inner, `${context} inner`);
  assert.deepEqual(edgeKeys(layers.outerD), expected.outer, `${context} outer`);
}

test('layers: a conquered pair has one inner seam, no outer border and six coast edges', () => {
  const layers = createMapBorderIndex(pair()).layers({ a: 'empire', b: 'empire' });
  assert.deepEqual(Object.keys(layers).sort(), ['coastD', 'innerD', 'outerD', 'ownerPaths']);
  assert.deepEqual(edgeKeys(layers.innerD), [shared]);
  assert.equal(layers.outerD, '');
  assert.equal(edgeKeys(layers.coastD).length, 6);
  assert.ok(!edgeKeys(layers.coastD).includes(shared));
  assertLayers(pair(), { a: 'empire', b: 'empire' }, layers);
});

test('layers: rival owners, owned v neutral and neutral v neutral land borders are all outer', () => {
  const index = createMapBorderIndex(pair());
  for (const ownership of [{ a: 'red', b: 'blue' }, { a: 'empire' }, { b: 'empire' }, {}]) {
    const layers = index.layers(ownership);
    assert.deepEqual(edgeKeys(layers.outerD), [shared], JSON.stringify(ownership));
    assert.equal(layers.innerD, '');
    assert.equal(edgeKeys(layers.coastD).length, 6);
    assertLayers(pair(), ownership, layers, JSON.stringify(ownership));
  }
});

test('layers: ownerPaths match resolve() for every ownership, including neutral coasts', () => {
  for (const ownership of [{ a: 'empire', b: 'empire' }, { a: 'red', b: 'blue' }, { a: 'empire' }, {}]) {
    const layers = createMapBorderIndex(pair()).layers(ownership);
    const resolved = createMapBorderIndex(pair()).resolve(ownership);
    assert.deepEqual(layers.ownerPaths, resolved.ownerPaths, JSON.stringify(ownership));
  }
  const rivals = createMapBorderIndex(pair()).layers({ a: 'red', b: 'blue' });
  assert.deepEqual(rivals.ownerPaths.map(owner => owner.ownerId), ['blue', 'red']);
  assert.equal(edgeKeys(ownerPath(rivals, 'red')).length, 4, 'an owner outline includes its coasts');
  assert.ok(edgeKeys(ownerPath(rivals, 'red')).includes(shared));
});

test('layers: a hole ring alone is coast; a filled hole is inner or outer by owner', () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const hole = [[3, 3], [3, 7], [7, 7], [7, 3]];
  const holeEdges = ['3,3|3,7', '3,3|7,3', '3,7|7,7', '7,3|7,7'];
  const donut = createMapBorderIndex([{ id: 'a', rings: [outer, hole] }]).layers({ a: 'empire' });
  assert.equal(edgeKeys(donut.coastD).length, 8);
  assert.ok(holeEdges.every(edge => edgeKeys(donut.coastD).includes(edge)));
  assert.equal(donut.innerD, '');
  assert.equal(donut.outerD, '');
  const filledGeometry = [{ id: 'a', rings: [outer, hole] }, { id: 'b', rings: [[...hole].reverse()] }];
  const filled = createMapBorderIndex(filledGeometry);
  const same = filled.layers({ a: 'empire', b: 'empire' });
  assert.deepEqual(edgeKeys(same.innerD), holeEdges.sort());
  assert.equal(edgeKeys(same.coastD).length, 4);
  const rival = filled.layers({ a: 'empire', b: 'rival' });
  assert.deepEqual(edgeKeys(rival.outerD), holeEdges.sort());
  assert.equal(rival.innerD, '');
  const neutralEnclave = filled.layers({ a: 'empire' });
  assert.deepEqual(edgeKeys(neutralEnclave.outerD), holeEdges.sort());
});

test('layers: winding, repeated vertices and duplicate shapes partition the mesh exactly once', () => {
  const geometry = pair();
  geometry[0].rings = [[...left, left[0], left[0]]];
  geometry[1].rings = [[...right].reverse()];
  geometry.push({ id: 'a', rings: [left] });
  const index = createMapBorderIndex(geometry);
  const layers = index.layers({ a: 'empire', b: 'empire' });
  assert.deepEqual(edgeKeys(layers.innerD), [shared]);
  assert.equal(edgeKeys(layers.coastD).length, 6);
  assert.ok(!layers.coastD.includes('M0,0L0,0'));
  const all = [...edgeKeys(layers.coastD), ...edgeKeys(layers.innerD), ...edgeKeys(layers.outerD)];
  assert.equal(new Set(all).size, all.length, 'no segment is painted in two classes');
  const resolved = index.resolve({ a: 'empire', b: 'empire' });
  assert.deepEqual(all.sort(), [...edgeKeys(resolved.internalD), ...edgeKeys(resolved.borderD)].sort());
});

test('layers: cached separately from resolve(), invalidated by in-place ownership changes', () => {
  const index = createMapBorderIndex(pair());
  const ownership = { a: 'red', b: 'blue' };
  const first = index.layers(ownership);
  const resolved = index.resolve(ownership);
  assert.equal(index.layers({ a: 'red', b: 'blue', irrelevant: 'green' }), first, 'equivalent ownership reuses the layers');
  assert.equal(index.resolve(ownership), resolved, 'layers() does not evict the resolve() cache');
  index.resolve({});
  assert.equal(index.layers(ownership), first, 'resolve() does not evict the layers() cache');
  ownership.b = 'red';
  const conquered = index.layers(ownership);
  assert.notEqual(conquered, first);
  assert.deepEqual(edgeKeys(conquered.innerD), [shared]);
  assert.deepEqual(edgeKeys(first.outerD), [shared], 'earlier results are not mutated');
});

test('layers: outline(id) chains one owner exactly as ownerPaths does, and the coast never depends on ownership', () => {
  const index = createMapBorderIndex(pair());
  const rivals = index.layers({ a: 'red', b: 'blue' });
  assert.deepEqual(Object.keys(rivals).sort(), ['coastD', 'innerD', 'outerD', 'ownerPaths'], 'outline is not a layer');
  assert.equal(rivals.outline('red'), ownerPath(rivals, 'red'));
  assert.equal(rivals.outline('blue'), ownerPath(rivals, 'blue'));
  assert.equal(rivals.outline('nobody'), '');
  assert.equal(rivals.outline(null), '');
  const conquered = index.layers({ a: 'red', b: 'red' });
  assert.equal(conquered.coastD, rivals.coastD);
  assert.deepEqual(edgeKeys(conquered.outline('red')), edgeKeys(conquered.outerD + conquered.coastD));
  assert.equal(index.resolve({ a: 'red', b: 'blue' }).outline('red'), rivals.outline('red'), 'resolve() offers the same outline');
});

test('layers: empty and degenerate geometry produces empty layers', () => {
  assert.deepEqual(createMapBorderIndex().layers(), { coastD: '', innerD: '', outerD: '', ownerPaths: [] });
  const layers = createMapBorderIndex([{ id: 'a', rings: [[], [[0, 0]], [[1, 1], [1, 1]]] }]).layers({ a: 'empire' });
  assert.deepEqual(layers, { coastD: '', innerD: '', outerD: '', ownerPaths: [] });
});

test('layers: calling layers() leaves resolve() output identical to a fresh index', () => {
  const ownership = { a: 'empire' };
  const index = createMapBorderIndex(pair());
  index.layers(ownership);
  index.layers({ a: 'red', b: 'blue' });
  assert.deepEqual(index.resolve(ownership), createMapBorderIndex(pair()).resolve(ownership));
});

test('layers: both real atlases classify every rendered segment like the independent oracle', () => {
  for (const filename of ['world-110m.v1.json', 'countries-50m.json']) {
    const topo = JSON.parse(readFileSync(new URL(`../public/${filename}`, import.meta.url), 'utf8'));
    const geo = new WorldGeometry(topo).fitTo(['250', '276']);
    const geometry = geo.countries.map(country => ({ id: country.id, rings: geo.paths[country.id].labelRings }));
    const index = createMapBorderIndex(geometry);
    const ids = geometry.map(shape => String(shape.id));
    // A deterministic patchwork: seven empires and unowned land across the world.
    const patchwork = Object.fromEntries(ids.map((id, i) => [id, i % 8 === 7 ? null : `e${i % 7}`]));
    const scenarios = { setup: {}, divided: { '250': 'france', '276': 'germany' }, conquered: { '250': 'france', '276': 'france' }, patchwork };
    const franceGermany = [...edgeCountries(geometry)].filter(([, owners]) => owners.size === 2 && owners.has('250') && owners.has('276'))
      .map(([edge]) => edge);
    assert.ok(franceGermany.length, `${filename} has a rendered France/Germany border`);
    for (const [name, ownership] of Object.entries(scenarios)) {
      const layers = index.layers(ownership);
      assertLayers(geometry, ownership, layers, `${filename} ${name}`);
      assert.deepEqual(layers.ownerPaths, index.resolve(ownership).ownerPaths, `${filename} ${name} ownerPaths`);
    }
    const divided = new Set(edgeKeys(index.layers(scenarios.divided).outerD));
    const conquered = new Set(edgeKeys(index.layers(scenarios.conquered).innerD));
    for (const edge of franceGermany) {
      assert.ok(divided.has(edge), `${filename}: ${edge} is a border between empires`);
      assert.ok(conquered.has(edge), `${filename}: ${edge} becomes a border inside the empire`);
    }
  }
});

// Owner outlines are chained into continuous runs: a browser restarts a dash pattern at every subpath, and nearly
// every ring edge is shorter than one 5px dash on screen, so per-edge subpaths drew the dashed your-turn reach
// outline as a solid line (DEC D21). Chaining must not add, drop or invent any edge.
test('ownerPaths: each owner outline is chained into continuous runs, one M per run, Z when it closes', () => {
  const conquered = createMapBorderIndex(pair()).layers({ a: 'empire', b: 'empire' });
  const empire = ownerPath(conquered, 'empire');
  assert.equal(runCount(empire), 1, `one closed perimeter is one run: ${empire}`);
  assert.ok(empire.endsWith('Z'));
  assert.deepEqual(edgeKeys(empire), edgeKeys(conquered.outerD + conquered.coastD));
  const rivals = createMapBorderIndex(pair()).layers({ a: 'red', b: 'blue' });
  for (const id of ['red', 'blue']) {
    assert.equal(runCount(ownerPath(rivals, id)), 1, `${id}: its square is one closed run`);
    assert.equal(edgeKeys(ownerPath(rivals, id)).length, 4);
  }
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const hole = [[3, 3], [3, 7], [7, 7], [7, 3]];
  const donut = ownerPath(createMapBorderIndex([{ id: 'a', rings: [outer, hole] }]).resolve({ a: 'empire' }), 'empire');
  assert.equal(runCount(donut), 2, 'a ring and its hole stay two runs');
  assert.equal(edgeKeys(donut).length, 8);
  const islands = ownerPath(createMapBorderIndex([{ id: 'a', rings: [left, [[10, 0], [12, 0], [12, 2], [10, 2]]] }])
    .resolve({ a: 'empire' }), 'empire');
  assert.equal(runCount(islands), 2, 'islands are never joined');
  assert.ok(!edgeKeys(islands).some(edge => edge === '10,0|2,0' || edge === '10,2|2,2'));
  assert.deepEqual(createMapBorderIndex(pair()).layers({}).ownerPaths, [], 'no owner, no outline');
});

test('ownerPaths: on both real atlases the chained outline draws exactly the perimeter edges, in long runs', () => {
  for (const filename of ['world-110m.v1.json', 'countries-50m.json']) {
    const topo = JSON.parse(readFileSync(new URL(`../public/${filename}`, import.meta.url), 'utf8'));
    const geo = new WorldGeometry(topo).fitTo(['250', '276']);
    const geometry = geo.countries.map(country => ({ id: country.id, rings: geo.paths[country.id].labelRings }));
    const index = createMapBorderIndex(geometry);
    const ids = geometry.map(shape => String(shape.id));
    const ownership = Object.fromEntries(ids.map((id, i) => [id, i % 8 === 7 ? null : `e${i % 7}`]));
    // Oracle: an owner's perimeter is every edge it draws that is not a seam inside it.
    const expected = new Map();
    for (const [edge, countries] of edgeCountries(geometry)) {
      const owners = [...countries].map(id => ownership[id] ?? null);
      const active = new Set(owners.filter(owner => owner != null));
      if (!active.size || (countries.size > 1 && active.size === 1 && owners.every(owner => owner === owners[0]))) continue;
      for (const owner of active) {
        if (!expected.has(owner)) expected.set(owner, []);
        expected.get(owner).push(edge);
      }
    }
    const layers = index.layers(ownership);
    assert.deepEqual(layers.ownerPaths.map(path => path.ownerId), [...expected.keys()].sort());
    for (const { ownerId, d } of layers.ownerPaths) {
      const edges = edgeKeys(d);
      assert.deepEqual(edges, expected.get(ownerId).sort(), `${filename} ${ownerId}: same edges, none added or dropped`);
      assert.equal(new Set(edges).size, edges.length, `${filename} ${ownerId}: no edge drawn twice`);
      assert.ok(edges.length / runCount(d) >= 20, `${filename} ${ownerId}: ${edges.length} edges in ${runCount(d)} runs`);
    }
    assert.deepEqual(layers.ownerPaths, index.resolve(ownership).ownerPaths, `${filename}: layers and resolve agree`);
  }
});
