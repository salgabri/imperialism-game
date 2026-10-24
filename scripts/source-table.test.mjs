// The compact player-tuple storage of the generated football data (src/data/sourceTable.js, scripts/lib/data-module.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTupleTable, unpackTuples } from '../src/data/sourceTable.js';
import { clubsModule, jsonLiteral, rostersModule } from './lib/data-module.mjs';
import { ROSTERS } from '../src/data/rosters.js';
import { CLUBS } from '../src/data/clubs.football.js';

const ea = (id, extra = {}) => ({ id: `ea:${id}`, fullName: `Player ${id}`, positions: ['FW', 'MF'], source: 'ea-fc', edition: 'EA FC 26',
  snapshotDate: '2025-09-19', update: 4, rawRating: 70 + id, rawScale: 99, ...extra });

test('packed tuples rebuild exactly: values, key order, tuples without metadata and every shape', () => {
  const tuples = [
    ['A. One', 'FW', 81, ea(1)],
    ['B. Two', 'MF', 72, ea(2)],
    ['C. Three', 'GK', 65],
    ['D. Four', 'DF', 70, { id: 'fm:9', fullName: 'D. Four', source: 'football-manager', version: '26.3.0', rawScale: 100 }],
    ['E. Five', 'FW', 77, ea(5, { club: 'Ajax' })],
    ['F. Six', 'MF', 74, ea(6, { club: 'PAOK' })],
  ];
  const table = createTupleTable(tuples);
  const rows = tuples.map(table.pack);
  assert.deepEqual(rows[2], ['C. Three', 'GK', 65], 'no metadata, no shape');
  const back = unpackTuples(JSON.parse(JSON.stringify(rows)), JSON.parse(JSON.stringify(table.shapes)));
  assert.equal(JSON.stringify(back), JSON.stringify(tuples), 'identical JSON, key order included');
  assert.equal(table.shapes.length, 3, 'one shape per key order');
  const [keys, shared] = table.shapes[0];
  assert.deepEqual(keys, Object.keys(ea(1)));
  assert.deepEqual(Object.keys(shared), ['source', 'edition', 'snapshotDate', 'update', 'rawScale'], 'only values every player shares');
  assert.ok(rows[0].length < 4 + keys.length, 'shared values are not repeated per player');
  assert.notEqual(back[0][3].positions, back[1][3].positions, 'arrays are never shared between players');
});

test('a value that differs once is stored per player, and a tuple of another length is refused', () => {
  const tuples = [['A', 'FW', 1, { x: 1, y: 'same' }], ['B', 'FW', 2, { x: 2, y: 'same' }], ['C', 'FW', 3, { x: 1, y: 'same' }]];
  const table = createTupleTable(tuples);
  assert.deepEqual(table.shapes, [[['x', 'y'], { y: 'same' }]]);
  assert.deepEqual(tuples.map(table.pack), [['A', 'FW', 1, 0, 1], ['B', 'FW', 2, 0, 2], ['C', 'FW', 3, 0, 1]]);
  assert.throws(() => table.pack(['A', 'FW', 1, { x: 1, y: 'same' }, 'extra']), /Unexpected player tuple/);
});

test('generated modules are JSON lines that load back to the same data', async () => {
  const literal = jsonLiteral({ name: "N'Golo \\ \"Kanté\"" });
  assert.deepEqual(JSON.parse(new Function(`return ${literal}`)()), { name: "N'Golo \\ \"Kanté\"" }, 'quotes and backslashes survive');
  const rosters = { '250': [80, 12, [['A. One', 'FW', 81, ea(1)], ['C. Three', 'GK', 65]]] };
  const clubs = [{ id: 'f-x', name: 'X', league: 'L', country: '250', str: 80, squad: [['A. One', 'FW', 81, ea(1)]], code: 'XXX', col: '#000' }];
  const load = async text => import(`data:text/javascript,${encodeURIComponent(text.replace("'./sourceTable.js'",
    JSON.stringify(new URL('../src/data/sourceTable.js', import.meta.url).href)))}`);
  const rosterModule = await load(rostersModule(rosters, { '250': 'France' }, '// test\n'));
  assert.equal(JSON.stringify(rosterModule.ROSTERS), JSON.stringify(rosters));
  const clubModule = await load(clubsModule(clubs, '// test\n'));
  assert.deepEqual(Object.keys(clubModule.CLUBS[0]), ['id', 'name', 'code', 'league', 'country', 'col', 'str', 'squad'], 'the clubs’ field order');
  assert.deepEqual(clubModule.CLUBS[0].squad, clubs[0].squad);
});

test('the shipped football data is fully sourced and loads as plain records', () => {
  const players = [...Object.values(ROSTERS).flatMap(roster => roster[2]), ...CLUBS.flatMap(club => club.squad)];
  assert.ok(players.length > 3000);
  for (const [name, role, rating, meta] of players) {
    assert.equal(typeof name, 'string');
    assert.equal(typeof role, 'string');
    assert.ok(Number.isFinite(rating));
    assert.equal(typeof meta?.id, 'string', `${name} keeps its source record`);
  }
});
