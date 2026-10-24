// The CM 01/02 reader (src/data/cm0102.js, docs/design/cm0102-format.md) against synthetic
// Data folders written byte by byte from the documented layout (scripts/lib/cm0102-fixture.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CM_STAFF_SIZE, decodeCmDate, fileSignature, readCm0102 } from '../src/data/cm0102.js';
import { cmNaturalPositions } from '../src/data/cmPlayers.js';
import { patchIndexEntry, SAMPLE, sampleDatabase, writeCm0102Files, writeMacFiles } from './lib/cm0102-fixture.mjs';

const read = (files, options) => readCm0102(files, options);
const sample = (options = {}) => writeCm0102Files(sampleDatabase(), options);
const playerNamed = (parsed, fullName) => parsed.players.filter(p => p.fullName === fullName);
const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Change one index.dat entry's table id in place. */
function retagIndexEntry(files, from, to) {
  const view = viewOf(files['index.dat']);
  for (let k = 0; k < 22; k++) {
    if (view.getInt32(8 + 67 * k + 51, true) === from) return view.setInt32(8 + 67 * k + 51, to, true);
  }
  throw new Error(`No index entry for table ${from}`);
}

test('SI format-1 and editor format-2 folders read to the same records', () => {
  const one = read(sample({ format: 1 })), two = read(sample({ format: 2 }));
  assert.equal(one.format, 1);
  assert.equal(two.format, 2);
  // staff.dat tiles staff, non-player and player records, plus one 52-byte preferences row per person in format 2.
  const { people } = sampleDatabase();
  const n6 = people.length, n9 = people.filter(p => p.nonPlayer).length, n10 = people.filter(p => p.player).length;
  assert.equal(sample({ format: 1 })['staff.dat'].length, CM_STAFF_SIZE[1] * n6 + 68 * n9 + 70 * n10);
  assert.equal(sample({ format: 2 })['staff.dat'].length, (CM_STAFF_SIZE[2] + 52) * n6 + 68 * n9 + 70 * n10);
  assert.equal(one.counts.players, n10);
  for (const key of ['counts', 'nations', 'clubs', 'competitions', 'players', 'warnings']) assert.deepEqual(one[key], two[key], key);
  // SI's index carries the empty youth table 8 and the editor's carries preferences, 22.
  assert.deepEqual(one.index.order, [0, 1, 2, 3, 4, 7, 5, 6, 8, 9, 10, 11, 21, 12, 16, 13, 14, 15, 17, 18, 19, 20]);
  assert.deepEqual(two.index.order, [0, 1, 2, 3, 4, 7, 5, 6, 9, 10, 11, 21, 12, 16, 13, 14, 15, 17, 18, 19, 20, 22]);
  assert.equal(one.index.formats[6], 1);
  assert.equal(two.index.formats[6], 2);
});

test('index.dat is read by table id, with stray bytes after the 22nd entry ignored', () => {
  const clean = read(sample());
  for (const strayIndexBytes of [1, 3, 6]) {
    const files = sample({ strayIndexBytes });
    assert.equal(files['index.dat'].length, 1482 + strayIndexBytes);
    const parsed = read(files);
    assert.equal(parsed.index.strayBytes, strayIndexBytes);
    assert.deepEqual(parsed.players, clean.players);
    assert.deepEqual(parsed.warnings, clean.warnings);
  }
  // A shorter index holds fewer entries, which is reported; here the lost one is a history table.
  const short = sample({ format: 1 });
  short['index.dat'] = short['index.dat'].slice(0, 8 + 67 * 21);
  const parsed = read(short);
  assert.ok(parsed.warnings.includes('index.dat holds 21 of 22 entries'));
  assert.deepEqual(parsed.players, clean.players);
  // Without its preferences entry, an editor staff.dat no longer tiles.
  const noPreferences = sample({ format: 2 });
  noPreferences['index.dat'] = noPreferences['index.dat'].slice(0, 8 + 67 * 21);
  assert.throws(() => read(noPreferences), /table 10 \(player\) is not a stride of 70/);
});

test('file names are matched in any case and the files must be bytes', () => {
  const files = sample();
  const renamed = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name === 'staff.dat' ? 'Staff.dat' : name.toUpperCase(), bytes]));
  assert.deepEqual(read(renamed).players, read(files).players);
  assert.throws(() => read({ ...files, 'club.dat': [1, 2, 3] }), /club\.dat is not a Uint8Array/);
  assert.throws(() => read(null), /Data folder/);
  const { 'index.dat': _, ...noIndex } = files;
  assert.throws(() => read(noIndex), /no index\.dat/);
});

test('text is windows-1252: accents, 0x80-0x9F letters, line breaks and padding', () => {
  const files = sample();
  const parsed = read(files);
  // The fixture stores ž as the single byte 0x9E and š as 0x9A, as SI's own second names do.
  assert.ok(files['first_names.dat'].includes(0x9e));
  assert.ok(files['second_names.dat'].includes(0x9a));
  assert.equal(playerNamed(parsed, 'Fakežej Mockošek').length, 1);
  assert.equal(playerNamed(parsed, 'Testène Françoisfake').length, 1);
  assert.equal(playerNamed(parsed, 'Unattached Fixturé').length, 1);
  assert.deepEqual(parsed.nations.map(n => n.name), SAMPLE.nations);
  assert.ok(parsed.nations.some(n => n.name === 'Curaçao') && parsed.nations.some(n => n.name === 'São Tomé & Principe'));
  const clubNames = parsed.clubs.map(c => c.name);
  // A long name is cut at CR LF and trimmed of the padding after it; a blank club is skipped.
  assert.ok(clubNames.includes('Fixtura Madrid C.F.'));
  assert.ok(clubNames.includes('Olympique Fixture'));
  assert.ok(clubNames.includes('FC Dummy München'));
  assert.ok(!clubNames.includes(''));
  assert.equal(parsed.clubs.length, 10);
  assert.equal(parsed.counts.clubs, 11);
});

test('nations, clubs and competitions resolve their links, with negatives and strays as none', () => {
  const parsed = read(sample());
  const nation = name => parsed.nations.find(n => n.name === name);
  assert.deepEqual(nation('Republic of Ireland'), { row: 8, name: 'Republic of Ireland', shortName: 'Ireland', code: 'REP', continent: 'Europe' });
  assert.equal(nation('Soviet Union').continent, null);
  assert.equal(nation('Curaçao').continent, 'North America');
  // Club divisions index the combined competitions: club_comp rows, then nation_comp rows.
  assert.equal(parsed.competitions.length, SAMPLE.leagues.length + 1);
  assert.deepEqual(parsed.competitions.at(-1), { row: SAMPLE.leagues.length, name: 'Fixture Nations Cup', shortName: 'Nations Cup', nation: null });
  const premier = parsed.competitions.find(c => c.name === 'English Premier Division');
  assert.equal(parsed.nations[premier.nation].name, 'England');
  const gone = parsed.clubs.find(c => c.name === 'Gone Athletic');
  assert.equal(gone.nation, null);
  assert.equal(gone.division, premier.row);
  assert.deepEqual(parsed.clubs.filter(c => c.division === premier.row).map(c => c.name), ['Testbury Rovers', 'Thinford Town', 'Gone Athletic']);
});

test('players are people with player data and a playing job, player-managers and free agents included', () => {
  const parsed = read(sample());
  const names = parsed.players.map(p => p.fullName);
  // A manager with player data and a scout without it never play.
  assert.ok(!names.includes('Managero Notaplayer'));
  assert.ok(!names.includes('Scouto Watcher'));
  const [manager] = playerNamed(parsed, 'Testène Françoisfake');
  assert.equal(manager.job, 12);
  assert.equal(manager.classification, 3);
  assert.equal(parsed.counts.staff, sampleDatabase().people.length);
  assert.equal(parsed.players.length, parsed.counts.staff - 2);
  // Ids are the stored staff ids (the rows here) and both copies of a duplicated person are read.
  assert.deepEqual(parsed.players.map(p => p.id), parsed.players.map((_, i) => i + 2));
  assert.equal(playerNamed(parsed, 'Dupli Catefake').length, 2);
  const [first] = parsed.players;
  assert.equal(first.ca, 150);
  assert.equal(first.pa, 150);
  assert.deepEqual(first.ratings, { gk: 20, sw: 1, d: 1, dm: 1, m: 1, am: 1, f: 1, wb: 1, right: 1, left: 1, centre: 1, free: 1 });
  assert.deepEqual(cmNaturalPositions(first.ratings), ['gk']);
});

test('club and nation links: -1, -2, out of range and extinct clubs mean none', () => {
  const parsed = read(sample());
  const club = fullName => playerNamed(parsed, fullName)[0].club;
  assert.equal(club('Unattached Fixturé'), null); // -2
  assert.equal(club('Lost Clubless'), null); // beyond club.dat
  assert.equal(club('Ghost Extinct'), null); // a club with no nation
  assert.equal(parsed.clubs.find(c => c.row === club('Fakežej Mockošek')).name, 'FC Dummy München');
  assert.equal(playerNamed(parsed, 'Stateless Testcase')[0].nation, null);
  assert.equal(playerNamed(parsed, 'Fixto Player001')[0].secondNation, null);
  assert.deepEqual(parsed.warnings, ['staff.dat: 1 players link a club beyond club.dat and nat_club.dat']);
});

test('common names: a blank row or id 0 is none, otherwise it is the display name', () => {
  const parsed = read(sample());
  const [blank] = playerNamed(parsed, 'Fakežej Mockošek');
  assert.equal(blank.commonName, null);
  assert.equal(blank.name, 'Fakežej Mockošek');
  const [zero] = playerNamed(parsed, 'Unattached Fixturé');
  assert.equal(zero.commonName, null);
  const [common] = playerNamed(parsed, 'Nameless Bluff');
  assert.equal(common.name, 'Bluffo');
  assert.equal(common.firstName, 'Nameless');
  assert.equal(common.secondName, 'Bluff');
});

test('dates decode with the stored leap flag, not the stored year', () => {
  // Day of year from 0 = 1 January; the flag picks the month table.
  assert.equal(decodeCmDate({ year: 1965, dayOfYear: 74, leap: true }), '1965-03-15');
  assert.equal(decodeCmDate({ year: 1965, dayOfYear: 74, leap: false }), '1965-03-16');
  // SI rows carry flag 0 even in leap years (30 May 1980 is day 149).
  assert.equal(decodeCmDate({ year: 1980, dayOfYear: 149, leap: false }), '1980-05-30');
  assert.equal(decodeCmDate({ year: 1977, dayOfYear: 228, leap: false }), '1977-08-17');
  assert.equal(decodeCmDate({ year: 1993, dayOfYear: 242, leap: true }), '1993-08-30');
  assert.equal(decodeCmDate({ year: 1990, dayOfYear: 0, leap: false }), '1990-01-01');
  assert.equal(decodeCmDate({ year: 1990, dayOfYear: 364, leap: false }), '1990-12-31');
  assert.equal(decodeCmDate({ year: 1990, dayOfYear: 365, leap: true }), '1990-12-31');
  assert.equal(decodeCmDate({ year: 1990, dayOfYear: 365, leap: false }), null);
  assert.equal(decodeCmDate({ year: 1990, dayOfYear: -1, leap: false }), null);
  // Year 0, or 1900 and before (SI's empty marker is 1 Feb 1900), is unknown.
  assert.equal(decodeCmDate({ year: 1900, dayOfYear: 31, leap: false }), null);
  assert.equal(decodeCmDate({ year: 0, dayOfYear: 0, leap: false }), null);
  assert.equal(decodeCmDate(null), null);
});

test('a birth shift moves the year only, and 29 February lands on the 28th in a common year', () => {
  const leapDay = { year: 1964, dayOfYear: 59, leap: true };
  assert.equal(decodeCmDate(leapDay), '1964-02-29');
  assert.equal(decodeCmDate(leapDay, 4), '1968-02-29');
  assert.equal(decodeCmDate(leapDay, 1), '1965-02-28');
  assert.equal(decodeCmDate({ year: 1956, dayOfYear: 332, leap: false }, 17), '1973-11-29');
  const parsed = read(writeCm0102Files(sampleDatabase({ birthYearShift: 24 })));
  const [manager] = playerNamed(parsed, 'Testène Françoisfake');
  assert.deepEqual(manager.dob, { year: 1940, dayOfYear: 59, leap: true });
  assert.equal(decodeCmDate(manager.dob, 24), '1964-02-29');
  assert.equal(manager.yearOfBirth, 1940);
  const [undated] = playerNamed(parsed, 'Undated Fixtureson');
  assert.equal(undated.dob, null);
  assert.equal(undated.yearOfBirth, null);
});

test('a birthday pile-up on one day is reported as an unreliable day and month', () => {
  const db = sampleDatabase();
  for (let i = 0; i < 150; i++) {
    db.people.push({ first: 'Pileo', second: `Upfake${i}`, dob: { year: 1980, dayOfYear: 1, leap: 0 }, nation: 0, club: -1, job: 11,
      player: { ca: 50, ratings: { gk: 20 } } });
  }
  assert.ok(read(writeCm0102Files(db)).warnings.some(w => /birthdays fall on one day/.test(w)));
});

test('fileSignature gives the identifying sizes and the staff format', () => {
  for (const format of [1, 2]) {
    const files = sample({ format });
    assert.deepEqual(fileSignature(files), { clubSize: files['club.dat'].length, staffSize: files['staff.dat'].length, staffFormat: format });
  }
  const { 'club.dat': _, ...noClub } = sample();
  assert.throws(() => fileSignature(noClub), /no club\.dat/);
});

test('Mac CM 01/02 data is rejected', () => {
  const mac = writeMacFiles(sampleDatabase());
  assert.throws(() => readCm0102(mac), /Mac CM 01\/02/);
  assert.throws(() => fileSignature(mac), /Mac CM 01\/02/);
  const odd = sample();
  odd['club.dat'] = new Uint8Array(odd['club.dat'].length + 3);
  assert.throws(() => read(odd), /not a whole number of 581-byte/);
});

test('a staff stride that is neither 157 nor 110 stops the read; a wrong flag follows the stride', () => {
  const files = sample({ format: 2 });
  const count = read(files).counts.staff;
  assert.throws(() => read(patchIndexEntry(sample({ format: 2 }), 6, { count: count + 1 })), /stride of .* not 157 or 110/);
  // Editor records flagged as SI's: the stride proves 110 bytes, which is read and reported.
  const flagged = read(patchIndexEntry(sample({ format: 2 }), 6, { format: 1 }));
  assert.equal(flagged.format, 2);
  assert.deepEqual(flagged.players, read(files).players);
  assert.ok(flagged.warnings.some(w => /flags format-1 staff, but its records are 110 bytes/.test(w)));
  // A player table that does not tile its segment.
  assert.throws(() => read(patchIndexEntry(sample({ format: 2 }), 10, { count: read(files).counts.players - 1 })), /not a stride of 70/);
});

test('records the index puts past the end of a file stop the read; spare bytes are reported', () => {
  const files = sample();
  assert.throws(() => read(patchIndexEntry(files, 4, { count: 20 })), /past its end/);
  const padded = sample();
  padded['nation_comp.dat'] = Uint8Array.from([...padded['nation_comp.dat'], 0]);
  padded['continent.dat'] = Uint8Array.from([...padded['continent.dat'], ...new Uint8Array(198)]);
  const parsed = read(padded);
  assert.ok(parsed.warnings.includes('nation_comp.dat has 1 bytes after its 1 indexed records'));
  assert.ok(parsed.warnings.includes('continent.dat has 198 bytes after its 6 indexed records (room for 1 more, not read)'));
  assert.equal(parsed.counts.continents, 6);
});

test('record ids that differ from their row: a few warn, most mean the layout is wrong', () => {
  const files = sample();
  const view = viewOf(files['nation.dat']);
  view.setInt32(290 * 3, 77, true);
  assert.ok(read(files).warnings.includes('nation.dat: 1 of 14 record ids differ from their row'));
  for (let row = 0; row < 14; row++) view.setInt32(290 * row, row + 1, true);
  assert.throws(() => read(files), /nation\.dat: 14 of 14 record ids differ from their row, so the layout does not match/);
  // A name table read with the wrong layout fails the same check.
  const names = sample();
  names['first_names.dat'] = names['first_names.dat'].slice(4);
  patchIndexEntry(names, 13, { count: Math.floor(names['first_names.dat'].length / 60) });
  assert.throws(() => read(names), /first_names\.dat: .* record ids differ/);
});

test('index entries must be .dat tables of known ids and formats', () => {
  const junk = sample();
  junk['index.dat'][8] = 0x01;
  assert.throws(() => read(junk), /not a \.dat file/);
  const unknownId = sample();
  retagIndexEntry(unknownId, 21, 40);
  assert.throws(() => read(unknownId), /table id 40, outside 0-22/);
  assert.throws(() => read(patchIndexEntry(sample(), 4, { format: 1 })), /table 4 \(nation\.dat\) format 1/);
  assert.throws(() => read(patchIndexEntry(sample(), 6, { format: 3 })), /staff table format 3/);
  const missing = sample();
  delete missing['club_comp.dat'];
  assert.throws(() => read(missing), /club_comp\.dat is listed in index\.dat but missing/);
  // An editor index that names table 8 instead of 22 is reported, not rejected.
  const retagged = sample({ format: 2 });
  retagIndexEntry(retagged, 22, 8);
  assert.ok(read(retagged).warnings.includes('index.dat has table 8 and no table 22 with format-2 staff'));
});

test('a saved game header is reported', () => {
  const parsed = read(sample({ header: [127, 0] }));
  assert.ok(parsed.warnings.some(w => /header is 127\/0.*saved game/.test(w)));
});

test('onWarning hears every warning as it is raised', () => {
  const heard = [];
  const parsed = read(sample({ header: [0, 3] }), { onWarning: message => heard.push(message) });
  assert.deepEqual(heard, parsed.warnings);
  assert.equal(heard.length, 2);
});
