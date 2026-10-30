// Synthetic CM 01/02 Data folders for tests, written byte by byte from the layout in
// docs/design/cm0102-format.md without using the reader in src/data/cm0102.js. Every
// person and club in sampleDatabase() is invented, with an obviously fake name, and
// exists only to exercise the parser and the data set builder; nations and leagues carry
// CM's stored names, because those are what the builder maps.

const SIZE = { club: 581, continent: 198, nation: 290, comp: 107, name: 60, nonPlayer: 68, player: 70, prefs: 52 };
export const FIXTURE_STAFF_SIZE = { 1: 157, 2: 110 };

// Index entries as SI ships them (with the empty youth table 8) and as the editor saves them (preferences, 22, last).
const SI_ORDER = [0, 1, 2, 3, 4, 7, 5, 6, 8, 9, 10, 11, 21, 12, 16, 13, 14, 15, 17, 18, 19, 20];
const EDITOR_ORDER = [0, 1, 2, 3, 4, 7, 5, 6, 9, 10, 11, 21, 12, 16, 13, 14, 15, 17, 18, 19, 20, 22];
const FILE_OF = {
  0: 'club.dat', 1: 'nat_club.dat', 2: 'colour.dat', 3: 'continent.dat', 4: 'nation.dat', 5: 'stadium.dat', 6: 'staff.dat',
  7: 'officials.dat', 8: 'staff.dat', 9: 'staff.dat', 10: 'staff.dat', 11: 'staff_comp.dat', 12: 'club_comp.dat',
  13: 'first_names.dat', 14: 'second_names.dat', 15: 'common_names.dat', 16: 'nation_comp.dat', 17: 'staff_history.dat',
  18: 'staff_comp_history.dat', 19: 'club_comp_history.dat', 20: 'nation_comp_history.dat', 21: 'city.dat', 22: 'staff.dat',
};
// The flags SI 3.9.68 ships; the staff table's own flag is the format being written.
const FORMAT_FLAG = { 0: 2, 1: 2, 4: 2, 9: 2, 10: 2, 11: 2, 12: 2, 16: 2 };

const HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
function encode1252(text) {
  return [...text].map(ch => {
    const code = ch.codePointAt(0);
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) return code;
    const high = HIGH.indexOf(ch);
    if (high < 0) throw new Error(`${JSON.stringify(ch)} has no windows-1252 byte`);
    return 0x80 + high;
  });
}

class Record {
  constructor(size) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }
  i8(at, value) { this.view.setInt8(at, value); return this; }
  u8(at, value) { this.view.setUint8(at, value); return this; }
  i16(at, value) { this.view.setInt16(at, value, true); return this; }
  u16(at, value) { this.view.setUint16(at, value, true); return this; }
  i32(at, value) { this.view.setInt32(at, value, true); return this; }
  u32(at, value) { this.view.setUint32(at, value, true); return this; }
  fill(at, length, value) { this.bytes.fill(value, at, at + length); return this; }
  /** A NUL-terminated field; `junk` fills the bytes after the NUL, as uninitialised memory does in real files. */
  str(at, width, value = '', junk = 0) {
    const bytes = encode1252(value);
    if (bytes.length >= width) throw new Error(`${JSON.stringify(value)} does not fit ${width} bytes`);
    this.bytes.set(bytes, at);
    this.bytes.fill(junk, at + bytes.length + 1, at + width);
    return this;
  }
  i32s(at, values) { values.forEach((value, i) => this.i32(at + 4 * i, value)); return this; }
}

const join = records => {
  const out = new Uint8Array(records.reduce((sum, r) => sum + r.bytes.length, 0));
  let at = 0;
  for (const r of records) { out.set(r.bytes, at); at += r.bytes.length; }
  return out;
};

/** Day of year (0 = 1 January) from a month and day, counting February by the stored leap flag. */
function dayOfYear(month, day, leap) {
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths.slice(0, month - 1).reduce((sum, n) => sum + n, 0) + day - 1;
}

/** An 8-byte date: { year, month, day, leap } or a raw { year, dayOfYear, leap }; undefined writes SI's empty 1 Feb 1900. */
function writeDate(record, at, date) {
  const { year = 1900, leap = 0 } = date || {};
  const day = !date ? 31 : date.dayOfYear ?? dayOfYear(date.month, date.day, leap);
  record.i16(at, day).u16(at + 2, year).u32(at + 4, leap ? 1 : 0);
}

const RATING_ORDER = ['gk', 'sw', 'd', 'dm', 'm', 'am', 'f', 'wb', 'right', 'left', 'centre', 'free'];

/**
 * Write a Data folder `{ fileName: Uint8Array }` from a description of the stored values:
 *   continents [{ name, code }], nations [{ name, short, code, continent }], clubs [{ name, short, nation, division }],
 *   clubComps / nationComps [{ name, short, nation }], and people [{ first, second, common, dob, yearOfBirth, nation,
 *   secondNation, caps, club, job, classification, player: { ca, pa, ratings }, nonPlayer, id, playerLink }].
 * Links are raw row numbers (-1 for none); club divisions use the combined competition index. A `common` of ''
 * links a blank common-name row and a number is written as the raw id. Options: `format` 1 (SI, 157-byte staff)
 * or 2 (editor, 110-byte staff), `strayIndexBytes` appended to index.dat, and the index `header` words.
 */
export function writeCm0102Files(db, { format = 2, strayIndexBytes = 0, header = [0, 0] } = {}) {
  const tables = { first: [''], second: [''], common: [''] };
  const nameRow = (table, value) => {
    if (value === undefined || value === null) return -1;
    if (typeof value === 'number') return value;
    if (value === '') { tables[table].push(''); return tables[table].length - 1; }
    const row = tables[table].indexOf(value);
    if (row > 0) return row;
    tables[table].push(value);
    return tables[table].length - 1;
  };

  const people = db.people || [];
  const playerRows = [], nonPlayerRows = [];
  const staff = people.map((person, row) => {
    const record = new Record(FIXTURE_STAFF_SIZE[format]);
    record.i32(0, person.id ?? row)
      .i32(4, nameRow('first', person.first)).i32(8, nameRow('second', person.second)).i32(12, nameRow('common', person.common));
    writeDate(record, 16, person.dob);
    record.i16(24, person.yearOfBirth ?? person.dob?.year ?? 0)
      .i32(26, person.nation ?? -1).i32(30, person.secondNation ?? -1)
      .u8(34, person.caps ?? 0).u8(35, 0)
      .i32(36, row === 0 ? -2 : -1).i8(40, 0);
    writeDate(record, 41, { year: 0, dayOfYear: 0 });
    writeDate(record, 49, { year: 0, dayOfYear: 0 });
    record.i32(57, person.club ?? -1).i8(61, person.job ?? 11);
    writeDate(record, 62, { year: 2001, month: 7, day: 1 });
    writeDate(record, 70, { year: 2003, month: 6, day: 30 });
    record.i32(78, 1000).i32(82, 50000).fill(86, 8, 10).u8(94, person.club >= 0 ? 1 : 0)
      .u8(95, person.classification ?? (person.player ? (person.nonPlayer ? 3 : 2) : 1)).i8(96, 0);
    const playerRow = person.player ? playerRows.push(person) - 1 : -1;
    const nonPlayerRow = person.nonPlayer ? nonPlayerRows.push(person) - 1 : -1;
    const playerLink = person.playerLink ?? playerRow;
    if (format === 1) {
      record.i32s(97, new Array(12).fill(-1)).i32(145, playerLink).i32(149, -1).i32(153, nonPlayerRow);
    } else {
      record.i32(97, playerLink).i32(101, row).i32(105, nonPlayerRow).u8(109, 0);
    }
    return record;
  });
  const players = playerRows.map((person, row) => {
    const { ca, pa = ca, ratings = {} } = person.player;
    const record = new Record(SIZE.player).i32(0, row).i8(4, 0).i16(5, ca).i16(7, pa).i16(9, 100).i16(11, 100).i16(13, 100);
    RATING_ORDER.forEach((key, i) => record.i8(15 + i, ratings[key] ?? 1));
    return record.fill(27, 42, 10).u8(69, 0);
  });
  const nonPlayers = nonPlayerRows.map((person, row) => new Record(SIZE.nonPlayer).i32(0, row).i16(4, 100).i16(6, 120)
    .fill(14, 21, 10).i32s(35, new Array(8).fill(-1)).i8(67, 0));
  const preferences = people.map((person, row) => new Record(SIZE.prefs).i32(0, row).i32s(4, new Array(12).fill(-1)));

  const staffSegments = format === 1 ? [[6, staff], [8, []], [9, nonPlayers], [10, players]] : [[6, staff], [9, nonPlayers], [10, players], [22, preferences]];
  const offsets = {};
  let at = 0;
  for (const [id, records] of staffSegments) {
    offsets[id] = at;
    at += records.reduce((sum, r) => sum + r.bytes.length, 0);
  }

  const files = {
    'staff.dat': join(staffSegments.flatMap(([, records]) => records)),
    'continent.dat': join((db.continents || []).map((c, row) => new Record(SIZE.continent).i32(0, row).str(4, 26, c.name).u8(30, 0xff)
      .str(31, 4, c.code || '').str(35, 26, '').str(61, 101, '').u8(162, 0xff).str(163, 26, '').u8(189, 0xff))),
    'nation.dat': join((db.nations || []).map((n, row) => new Record(SIZE.nation).i32(0, row).str(4, 51, n.name).u8(55, 0xff)
      .str(56, 26, n.short ?? n.name).u8(82, 0xff).str(83, 4, n.code || '').str(87, 26, '').i32(113, n.continent ?? -1))),
    'club.dat': join((db.clubs || []).map((c, row) => new Record(SIZE.club).i32(0, row).str(4, 51, c.name, 0x20).u8(55, 0xff)
      .str(56, 26, c.short ?? '').u8(82, 0xff).i32(83, c.nation ?? -1).i32(87, c.division ?? -1).i32(91, -1).i8(95, 0).i32(96, -1)
      .i32s(215, new Array(50).fill(-1)))),
    'club_comp.dat': join((db.clubComps || []).map((c, row) => compRecord(c, row))),
    'nation_comp.dat': join((db.nationComps || []).map((c, row) => compRecord(c, (db.clubComps || []).length + row))),
  };
  for (const [table, file] of [['first', 'first_names.dat'], ['second', 'second_names.dat'], ['common', 'common_names.dat']]) {
    files[file] = join(tables[table].map((value, row) => new Record(SIZE.name).str(0, 51, value).i32(51, row).i32(55, row ? -1 : -2).u8(59, 1)));
  }
  for (const file of ['nat_club.dat', 'colour.dat', 'stadium.dat', 'officials.dat', 'staff_comp.dat', 'city.dat',
    'staff_history.dat', 'staff_comp_history.dat', 'club_comp_history.dat', 'nation_comp_history.dat']) files[file] = new Uint8Array(0);

  const counts = {
    0: (db.clubs || []).length, 3: (db.continents || []).length, 4: (db.nations || []).length, 6: staff.length, 8: 0,
    9: nonPlayers.length, 10: players.length, 12: (db.clubComps || []).length, 13: tables.first.length,
    14: tables.second.length, 15: tables.common.length, 16: (db.nationComps || []).length, 22: preferences.length,
  };
  const order = format === 1 ? SI_ORDER : EDITOR_ORDER;
  const index = new Record(8 + 67 * order.length + strayIndexBytes).i32(0, header[0]).i32(4, header[1]);
  order.forEach((id, k) => {
    const entry = 8 + 67 * k;
    index.str(entry, 51, FILE_OF[id], 0xcd).i32(entry + 51, id).i32(entry + 55, counts[id] ?? 0)
      .i32(entry + 59, offsets[id] ?? 0).i32(entry + 63, id === 6 ? format : FORMAT_FLAG[id] ?? 1);
  });
  // Stray bytes after the 22nd entry, as 13 real folders have.
  for (let i = 0; i < strayIndexBytes; i++) index.u8(8 + 67 * order.length + i, i === 0 ? 0 : 0x2a);
  files['index.dat'] = index.bytes;
  return files;
}

function compRecord(c, id) {
  return new Record(SIZE.comp).i32(0, id).str(4, 51, c.name).u8(55, 0xff).str(56, 26, c.short ?? '').u8(82, 0xff)
    .str(83, 4, '').i8(87, 0).i8(88, 0).i32(89, -1).i32(93, c.nation ?? -1).i32(97, 0).i32(101, 0).i16(105, 100);
}

/** Rewrite one index.dat entry in place (found by table id), for layout-failure tests. */
export function patchIndexEntry(files, tableId, { count, offset, format }) {
  const view = new DataView(files['index.dat'].buffer, files['index.dat'].byteOffset, files['index.dat'].byteLength);
  for (let k = 0; k < 22; k++) {
    const entry = 8 + 67 * k;
    if (view.getInt32(entry + 51, true) !== tableId) continue;
    if (count !== undefined) view.setInt32(entry + 55, count, true);
    if (offset !== undefined) view.setInt32(entry + 59, offset, true);
    if (format !== undefined) view.setInt32(entry + 63, format, true);
    return files;
  }
  throw new Error(`No index entry for table ${tableId}`);
}

/** A Mac 3.9.62-style folder: big-endian 68-byte index entries, 584-byte clubs and the 0xF1FFFFF1 trailer. */
export function writeMacFiles(db) {
  const clubs = (db.clubs || []).map((c, row) => {
    const record = new Record(584).str(4, 51, c.name);
    record.view.setInt32(0, row, false);
    return record;
  });
  const trailer = new Record(4).u8(0, 0xf1).u8(1, 0xff).u8(2, 0xff).u8(3, 0xf1);
  const index = new Record(8 + 68 * 22);
  EDITOR_ORDER.forEach((id, k) => {
    const entry = 8 + 68 * k;
    index.str(entry, 52, FILE_OF[id]);
    index.view.setInt32(entry + 52, id, false);
    index.view.setInt32(entry + 64, 2, false);
  });
  return { 'index.dat': index.bytes, 'club.dat': join([...clubs, trailer]), 'staff.dat': join([trailer]) };
}

// ---- The sample database ----

const R = (pos, side) => ({ ...(pos === 'gk' ? { gk: 20 } : { [pos]: 20 }), ...(side ? { [side]: 20 } : {}) });
// The positions of a natural 4-4-2, as stored position and side ratings.
const XI = [R('gk'), R('d', 'right'), R('d', 'centre'), R('d', 'centre'), R('d', 'left'),
  R('m', 'right'), R('m', 'centre'), R('m', 'centre'), R('m', 'left'), R('f', 'centre'), R('f', 'centre')];
const FAKE_FIRST = ['Testo', 'Fixto', 'Mocko', 'Dummo', 'Placo', 'Stubbo', 'Sampo', 'Fakeo'];

/** The nations, competitions and clubs of sampleDatabase(), by name, for tests to find rows with. */
export const SAMPLE = {
  continents: ['Africa', 'Asia', 'Europe', 'North America', 'Oceania', 'South America'],
  nations: ['England', 'Spain', 'Italy', 'Germany', 'France', 'Holland', 'Portugal', 'Scotland', 'Republic of Ireland',
    'Yugoslavia', 'Soviet Union', 'Curaçao', 'São Tomé & Principe', 'Sudan'],
  leagues: [['English Premier Division', 'England'], ['Spanish La Liga', 'Spain'], ['Italian Serie A', 'Italy'],
    ['German First Division', 'Germany'], ['French First Division', 'France'], ['Dutch Premier Division', 'Holland'],
    ['Portuguese Premier League', 'Portugal'], ['English First Division', 'England'], ['Scottish Premier Division', 'Scotland']],
};

/**
 * A small invented database: one full club in each of the seven leagues (Spain's top flight under CM0102Patcher's
 * 'Spanish La Liga' alias), a second English club short of eleven, an English second-tier club, and English and
 * Dutch national XIs. Edge cases: windows-1252 names (é, ž, ç, è), leap-flag dates, sentinel links, non-player staff,
 * a player-manager, a duplicate person, blank common names, an extinct and a blank club. `unmapped` adds players of
 * an invented nation that no mapping knows.
 */
export function sampleDatabase({ unmapped = false, birthYearShift = 0 } = {}) {
  const continent = name => SAMPLE.continents.indexOf(name);
  const nations = SAMPLE.nations.map(name => ({
    name, short: name === 'Republic of Ireland' ? 'Ireland' : name, code: name.slice(0, 3).toUpperCase(),
    continent: name === 'Soviet Union' ? -1 : continent(name === 'Curaçao' ? 'North America' : name === 'Sudan' || name.startsWith('São') ? 'Africa' : 'Europe'),
  }));
  if (unmapped) nations.push({ name: 'Fictionland', code: 'FIC', continent: continent('Europe') });
  const nation = name => nations.findIndex(n => n.name === name);
  const clubComps = SAMPLE.leagues.map(([name, country]) => ({ name, short: name.split(' ').slice(1).join(' '), nation: nation(country) }));
  const nationComps = [{ name: 'Fixture Nations Cup', short: 'Nations Cup', nation: -1 }];
  const league = name => SAMPLE.leagues.findIndex(([l]) => l === name);
  const clubs = [
    { name: 'Testbury Rovers', short: 'Testbury', nation: nation('England'), division: league('English Premier Division') },
    { name: 'Fixtura Madrid C.F.\r\n', short: 'Fixtura', nation: nation('Spain'), division: league('Spanish La Liga') },
    { name: 'Mockolano Calcio', short: 'Mockolano', nation: nation('Italy'), division: league('Italian Serie A') },
    { name: 'FC Dummy München', short: 'Dummy', nation: nation('Germany'), division: league('German First Division') },
    { name: 'Olympique Fixture   ', short: 'OFix', nation: nation('France'), division: league('French First Division') },
    { name: 'Stubvoort', short: 'Stubvoort', nation: nation('Holland'), division: league('Dutch Premier Division') },
    { name: 'Sporting Placeholder', short: 'Placeholder', nation: nation('Portugal'), division: league('Portuguese Premier League') },
    { name: 'Thinford Town', short: 'Thinford', nation: nation('England'), division: league('English Premier Division') },
    { name: 'Lowerton United', short: 'Lowerton', nation: nation('England'), division: league('English First Division') },
    { name: 'Gone Athletic', short: 'Gone', nation: -1, division: league('English Premier Division') },
    { name: '', short: '', nation: nation('England'), division: -1 },
  ];
  const club = name => clubs.findIndex(c => c.name.trim() === name);
  const people = [];
  let serial = 0;
  const birth = (year, month, day, leap = 0) => ({ year: year - birthYearShift, month, day, leap });
  const add = person => people.push(person) - 1;
  const squad = (clubName, nationName, size = 11, ca = 120) => {
    for (let i = 0; i < size; i++) {
      serial++;
      add({
        first: FAKE_FIRST[serial % FAKE_FIRST.length], second: `Player${String(serial).padStart(3, '0')}`,
        dob: birth(1970 + (serial % 15), 1 + (serial % 12), 1 + (serial % 27)), nation: nation(nationName),
        club: clubName ? club(clubName) : -1, job: 11, player: { ca: ca - i, ratings: XI[i % 11] },
      });
    }
  };

  // Staff who never play: a manager with player data (retired from playing) and a scout without.
  add({ first: 'Managero', second: 'Notaplayer', dob: birth(1950, 3, 3), nation: nation('England'), club: club('Testbury Rovers'), job: 5,
    classification: 3, nonPlayer: true, player: { ca: 150, ratings: R('m', 'centre') } });
  add({ first: 'Scouto', second: 'Watcher', dob: birth(1955, 4, 4), nation: nation('Scotland'), club: club('Testbury Rovers'), job: 9, nonPlayer: true });

  squad('Testbury Rovers', 'England', 11, 150);
  squad('Fixtura Madrid C.F.', 'Spain', 11, 160);
  squad('Mockolano Calcio', 'Italy', 11, 140);
  squad('FC Dummy München', 'Germany', 11, 145);
  squad('Olympique Fixture', 'France', 11, 135);
  squad('Stubvoort', 'Holland', 11, 130);
  squad('Sporting Placeholder', 'Portugal', 11, 125);
  squad('Thinford Town', 'England', 6, 110);
  squad('Lowerton United', 'England', 11, 90);
  // Unattached Dutch players, who count for the national side only.
  squad(null, 'Holland', 4, 100);

  // Accented names, a player-manager, sentinel links, leap-flag dates and common names.
  add({ first: 'Fakežej', second: 'Mockošek', common: '', dob: birth(1965, 3, 15, 1), nation: nation('Yugoslavia'),
    club: club('FC Dummy München'), job: 11, player: { ca: 150, ratings: R('am', 'centre') } });
  add({ first: 'Testène', second: 'Françoisfake', dob: birth(1964, 2, 29, 1), nation: nation('France'),
    club: club('Olympique Fixture'), job: 12, classification: 3, nonPlayer: true, player: { ca: 141, ratings: R('m', 'centre') } });
  add({ first: 'Unattached', second: 'Fixturé', common: 0, dob: birth(1980, 12, 31), nation: nation('England'), club: -2, job: 11,
    player: { ca: 99, ratings: R('f', 'centre') } });
  add({ first: 'Lost', second: 'Clubless', dob: birth(1979, 5, 5), nation: nation('England'), club: 9999, job: 11,
    player: { ca: 98, ratings: R('d', 'centre') } });
  add({ first: 'Ghost', second: 'Extinct', dob: birth(1978, 6, 6), nation: nation('England'), club: club('Gone Athletic'), job: 11,
    player: { ca: 97, ratings: R('gk') } });
  add({ first: 'Nameless', second: 'Bluff', common: 'Bluffo', dob: birth(1981, 7, 7), nation: nation('Curaçao'), club: club('Stubvoort'),
    job: 11, player: { ca: 96, ratings: R('m', 'left') } });
  add({ first: 'Dupli', second: 'Catefake', dob: birth(1977, 8, 17), nation: nation('England'), club: -1, job: 11,
    player: { ca: 130, ratings: R('f', 'centre') } });
  add({ first: 'Dupli', second: 'Catefake', dob: birth(1977, 8, 17), nation: nation('England'), club: club('Lowerton United'), job: 11,
    player: { ca: 125, ratings: R('f', 'centre') } });
  add({ first: 'Undated', second: 'Fixtureson', dob: { year: 0, dayOfYear: 0 }, yearOfBirth: 0, nation: nation('Scotland'),
    club: club('Testbury Rovers'), job: 11, player: { ca: 115, ratings: R('d', 'left') } });
  add({ first: 'Noability', second: 'Testcase', dob: birth(1985, 1, 1), nation: nation('England'), club: -1, job: 11,
    player: { ca: 0, ratings: R('m', 'centre') } });
  add({ first: 'Nopositions', second: 'Testcase', dob: birth(1985, 1, 2), nation: nation('England'), club: -1, job: 11,
    player: { ca: 80, ratings: { m: 12, centre: 12 } } });
  add({ first: 'Stateless', second: 'Testcase', dob: birth(1985, 1, 3), nation: -1, club: -1, job: 11, player: { ca: 80, ratings: R('gk') } });
  if (unmapped) {
    for (let i = 0; i < 2; i++) add({ first: 'Fictio', second: `Nowhere${i}`, dob: birth(1990, 2, 2 + i), nation: nation('Fictionland'),
      club: -1, job: 11, player: { ca: 70, ratings: R('gk') } });
  }
  return { continents: SAMPLE.continents.map(name => ({ name, code: name.slice(0, 3).toUpperCase() })), nations, clubs, clubComps, nationComps, people };
}
