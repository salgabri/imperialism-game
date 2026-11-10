// The Reep identity register reduced to the built-in football squads' person keys (scripts/lib/reep-bridge.mjs,
// scripts/sync-reep-bridge.mjs; docs/design/football-squad-identity.md). The reproduction test needs the ignored
// data-src/reep/ copy of Reep's bridges.csv and skips without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ageOn } from './lib/football-data.mjs';
import { BUILT_IN_PAIR, REEP_SOURCES, foldTokens, loadSourceRecords, namesAgree, reduceBridges, serializeBridge, similar } from './lib/reep-bridge.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BRIDGE = 'scripts/data/reep-bridge.json';
const read = file => readFile(path.join(root, file), 'utf8');

test('the Reep name check accepts romanisations and rejects nicknames, namesakes and shared first names', () => {
  // Accepted links of release 2026-10-18.1 that differ only by romanisation.
  for (const [ea, fm] of [[['Saad Al Mousa'], 'Saad Al-Mosa'], [['Arseniy BatagovБатагов Арсеній Павлович'], 'Arsenii Batahov'],
    [['Abbosbek Fayzullaev'], 'Abbosbek Fayzullayev'], [['Muhannad Mustafa Al Shanqeeti'], 'Muhannad Al-Shanqiti'],
    [["Moussa N'Diaye"], 'Moussa Ndiaye'], [['Berkay Yilmaz'], 'Berkay Yılmaz'], [['Anselmo García MacNulty'], 'Anselmo García Mac Nulty'],
    [['Jiang Guangtai', 'Jiang GuangtaiTyias Charles Browning 蒋光太'], 'Tyias Browning']]) assert.ok(namesAgree(ea, fm), `${ea} = ${fm}`);
  // Rejected: a nickname, a namesake by first name only, a coincidence of short tokens (McKenna stays one token; Kenna
  // is not Kayne).
  for (const [ea, fm] of [[['Pedro Gonçalves', 'Pedro António Pereira Gonçalves'], 'Pote'], [['Moussa Diaby'], 'Moussa Sissoko'],
    [['S. Duke-McKenna', 'Stephen Winston Duke-McKenna'], 'Kayne Bonnevie'], [['Marko Milovanović'], 'Marezi']]) assert.ok(!namesAgree(ea, fm), `${ea} ≠ ${fm}`);
  assert.deepEqual(foldTokens("A. N'Doumbou Al-Qahtani"), ['ndoumbou', 'qahtani']);
  assert.deepEqual(foldTokens('Stephen Duke-McKenna'), ['stephen', 'duke', 'mckenna']);
  assert.ok(similar('mosa', 'mousa') && similar('shanqiti', 'shanqeeti') && !similar('lee', 'lie'), 'one edit from four letters, two from eight');
});

test('the Reep reducer keeps present ids only and rejects links that could merge two people', () => {
  const ageDate = '2025-07-01';
  const ea = new Map([[1, 'Pedro Gonçalves', 'Pedro António Pereira Gonçalves', '1998-06-28'], [2, 'S. Al Mousa', 'Saad Al Mousa', '2000-03-01'],
    [3, 'Tiago Silva', 'Tiago Gonçalves da Silva', '2007-07-10'], [4, 'J. Doe', 'John Doe', '1995-01-01'], [5, 'A. Solo', 'Ann Solo', '1999-01-01']]
    .map(([id, short, long, dob]) => [id, { names: new Set([short, long]), dobs: new Set([dob]) }]));
  const fm = new Map([[11, 'Pote', 27], [12, 'Saad Al-Mosa', 25], [13, 'Tiago Silva', 32], [15, 'John Doe', 30]]
    .map(([id, name, age]) => [id, { name, age, ageDate }]));
  const files = [{ file: BUILT_IN_PAIR.ea, kind: 'ea', ids: new Set([1, 2, 3, 4, 5]) }, { file: BUILT_IN_PAIR.fm, kind: 'fm', ids: new Set([11, 12, 13, 15]) }];
  const sources = { ea, fm, files };
  const person = (eaIds, fmIds) => ({ ea: new Set(eaIds), fm: new Set(fmIds) });
  const reep = { rows: 9, kept: 9, persons: new Map([
    ['rp00000000000005', person([5], [])], ['rp00000000000001', person([1], [11])], ['rp00000000000002', person([2], [12])],
    ['rp00000000000003', person([3], [13])], ['rp00000000000004', person([4], [15])], ['rp00000000000006', person([4], [])],
    ['rp00000000000007', person([99], [98])]]) };
  const input = { file: 'bridges.csv', cut: 'fixture', sha256: '0'.repeat(64), bytes: 1 };
  const bridge = reduceBridges(reep, sources, { release: '2030-07-01.1', input });
  // Sorted by Reep id; absent ids (99, 98) drop their person; EA 4 sits on two persons and leaves both; Pote (a
  // nickname) and Tiago Silva (32, not 17) lose their FM id; the romanised Al-Mosa stays linked.
  assert.deepEqual(bridge.persons, [['rp00000000000001', [1], []], ['rp00000000000002', [2], [12]], ['rp00000000000003', [3], []],
    ['rp00000000000004', [], [15]], ['rp00000000000005', [5], []]]);
  assert.deepEqual(bridge.rejected.map(link => [link.reep, link.ea, link.fm, link.reason.split(':')[0]]), [
    ['rp00000000000001', [1], [11], 'names share no surname'], ['rp00000000000003', [3], [13], 'ages differ'],
    ['rp00000000000004', [4], [], 'EA id on 2 Reep persons'], ['rp00000000000006', [4], [], 'EA id on 2 Reep persons']]);
  assert.deepEqual(bridge.coverage, { 'ea-fc27.csv': { records: 5, linked: 4, percent: 80 }, 'fm26-players.json': { records: 4, linked: 2, percent: 50 }, builtInPairs: 1 });
  assert.deepEqual([bridge.source.license, bridge.source.input], ['CC0-1.0', input]);
  assert.deepEqual(JSON.parse(serializeBridge(bridge)), bridge, 'the compact serialisation is plain JSON');
  // Two EA records of one person in the snapshots would field once; the reducer stops for review.
  const twice = { rows: 1, kept: 2, persons: new Map([['rp00000000000008', person([1, 2], [])]]) };
  assert.throws(() => reduceBridges(twice, sources, { release: '2030-07-01.1', input }), /links 2 EA and 0 FM ids/);
});

test('the committed Reep bridge holds only ids of the committed snapshots, each on one person, with every link checked', async () => {
  const text = await read(BRIDGE), bridge = JSON.parse(text);
  assert.deepEqual([bridge.source.provider, bridge.source.license, bridge.source.url], ['Reep', 'CC0-1.0', 'https://reep.football/data']);
  assert.match(bridge.source.release, /^\d{4}-\d{2}-\d{2}\.\d+$/);
  assert.match(bridge.source.input.sha256, /^[0-9a-f]{64}$/, 'the bridges file it was reduced from is pinned');
  assert.equal(serializeBridge(bridge), text, 'one person per line, as the reducer writes it');
  const sources = await loadSourceRecords(root);
  assert.deepEqual(sources.files.map(row => row.file), [...REEP_SOURCES.ea, ...REEP_SOURCES.fm]);
  const ids = bridge.persons.map(([reepId]) => reepId);
  assert.deepEqual(ids, ids.slice().sort());
  assert.equal(new Set(ids).size, ids.length);
  const seen = new Set();
  let pairs = 0;
  for (const [reepId, ea, fm] of bridge.persons) {
    assert.match(reepId, /^rp[0-9a-f]{14}$/);
    assert.ok(ea.length + fm.length > 0 && ea.length <= 1 && fm.length <= 1, reepId);
    for (const id of ea) { assert.ok(sources.ea.has(id) && !seen.has(`ea:${id}`), `${reepId} ea:${id}`); seen.add(`ea:${id}`); }
    for (const id of fm) { assert.ok(sources.fm.has(id) && !seen.has(`fm:${id}`), `${reepId} fm:${id}`); seen.add(`fm:${id}`); }
    if (!ea.length || !fm.length) continue;
    pairs++;
    // Every kept EA–FM link passes the reducer's name and age checks.
    const record = sources.ea.get(ea[0]), player = sources.fm.get(fm[0]);
    assert.ok(namesAgree([...record.names], player.name), `${reepId}: ${[...record.names]} / ${player.name}`);
    assert.ok([...record.dobs].some(dob => Math.abs(ageOn(dob, player.ageDate) - player.age) <= 1), `${reepId} ages`);
  }
  assert.deepEqual([bridge.counts.persons, bridge.counts.pairs, bridge.counts.rejected], [bridge.persons.length, pairs, bridge.rejected.length]);
  for (const link of bridge.rejected) assert.ok(link.reason && link.fm.every(id => !seen.has(`fm:${id}`)), `${link.reep}: a rejected FM id stays out`);
  for (const { file, kind, ids: fileIds } of sources.files) {
    const row = bridge.coverage[path.basename(file)];
    assert.equal(row.records, fileIds.size, file);
    assert.equal(row.linked, [...fileIds].filter(id => seen.has(`${kind}:${id}`)).length, file);
    assert.ok(row.percent > 60, `${file}: Reep coverage ${row.percent}%`);
  }
});

const rawReep = existsSync(path.join(root, 'data-src/reep/bridges-filtered.csv')) && existsSync(path.join(root, 'data-src/reep/manifest.json'));
test('reep-bridge.json is reproducible from the pinned Reep bridges file', {
  skip: !rawReep && 'data-src/reep/bridges-filtered.csv or its manifest.json is absent; put Reep\'s bridges.csv (release 2026-10-18.1) and release manifest there to check the reduction',
}, () => {
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/sync-reep-bridge.mjs'), '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, `${BRIDGE} is stale or its input is not the pinned file; run npm run sync:reep-bridge\n${run.stdout}${run.stderr}`);
  assert.match(run.stdout, /is current/);
});
