import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMapBorderIndex } from '../src/engine/mapBorders.js';
import { WorldGeometry, projPt } from '../src/engine/geo.js';

const left = [[0, 0], [2, 0], [2, 2], [0, 2]];
const right = [[2, 0], [4, 0], [4, 2], [2, 2]];
const shared = '2,0|2,2';
const pair = () => [{ id: 'a', rings: [left] }, { id: 'b', rings: [right] }];

function edgeKeys(path) {
  return [...path.matchAll(/M(-?[\d.]+),(-?[\d.]+)L(-?[\d.]+),(-?[\d.]+)/g)]
    .map(match => {
      const a = `${Number(match[1])},${Number(match[2])}`;
      const b = `${Number(match[3])},${Number(match[4])}`;
      return [a, b].sort().join('|');
    }).sort();
}

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
