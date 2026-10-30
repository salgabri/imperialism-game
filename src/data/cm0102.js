// Championship Manager 01/02 database reader: a PC Data folder's .dat tables to plain
// records for the football data set builder. Pure (Uint8Array and DataView only), so it
// runs in Node and in the browser. The layout and its checks are in
// docs/design/cm0102-format.md; a file that does not match it throws rather than being
// guessed at, and softer anomalies come back as warnings.

const INDEX_HEADER = 8;
const INDEX_ENTRY = 67;
const INDEX_ENTRIES = 22;

/** Table ids in index.dat, the only key the loader uses (entry order differs between SI and editor files). */
export const CM_TABLES = {
  club: 0, natClub: 1, colour: 2, continent: 3, nation: 4, stadium: 5, staff: 6, officials: 7, youth: 8,
  nonPlayer: 9, player: 10, staffComp: 11, clubComp: 12, firstNames: 13, secondNames: 14, commonNames: 15,
  nationComp: 16, staffHistory: 17, staffCompHistory: 18, clubCompHistory: 19, nationCompHistory: 20, city: 21,
  preferences: 22,
};
const TABLE_NAMES = Object.fromEntries(Object.entries(CM_TABLES).map(([name, id]) => [id, name]));
const RECORD_SIZE = {
  0: 581, 1: 581, 2: 58, 3: 198, 4: 290, 5: 78, 7: 43, 9: 68, 10: 70, 11: 101, 12: 107,
  13: 60, 14: 60, 15: 60, 16: 107, 17: 17, 18: 58, 19: 26, 20: 26, 21: 56, 22: 52,
};
/** Staff record size by format: 1 is SI's untouched file record, 2 the editor's (and the game's memory) layout. */
export const CM_STAFF_SIZE = { 1: 157, 2: 110 };
// Format 1 in these tables would be a pre-01/02 layout that the exe converts and no 01/02 file has.
const FORMAT_2_ONLY = [0, 1, 4, 9, 10, 11, 12, 16];
// Chairman to physio, retired player and pundit: people who never play, whatever their data.
const STAFF_ONLY_JOBS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17]);
const RATING_KEYS = ['gk', 'sw', 'd', 'dm', 'm', 'am', 'f', 'wb', 'right', 'left', 'centre', 'free'];
// The exe's month tables: day of year (0 = 1 January) after which each month starts.
const COMMON_MONTHS = [-1, 30, 58, 89, 119, 150, 180, 211, 242, 272, 303, 333];
const LEAP_MONTHS = [-1, 30, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
// Mac CM 01/02 (3.9.62) data is big-endian, with other record sizes and this word after each table.
const MAC_TRAILER = [0xf1, 0xff, 0xff, 0xf1];

// Windows-1252 differs from Latin-1 only in 0x80-0x9F (0x9E is ž in SI's own second names).
// The five unassigned bytes pass through as C1 controls, as browsers decode them.
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f'
  + '\u0090‘’“”•–—˜™š›œ\u009džŸ';

const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** A fixed-width text field: cut at the first NUL (and at a line break in club names), then trimmed. */
function text(bytes, start, width, cutAtLineBreak = false) {
  let out = '';
  for (let i = start; i < start + width; i++) {
    const b = bytes[i];
    if (b === 0 || (cutAtLineBreak && (b === 10 || b === 13))) break;
    out += b >= 0x80 && b < 0xa0 ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b);
  }
  return out.trim();
}

function lowerCaseFiles(files) {
  if (!files || typeof files !== 'object') throw new Error('Expected the Data folder as { fileName: Uint8Array }');
  const byName = new Map();
  for (const [name, bytes] of Object.entries(files)) {
    if (!(bytes instanceof Uint8Array)) throw new Error(`${name} is not a Uint8Array`);
    byName.set(name.toLowerCase(), bytes);
  }
  return byName;
}

function rejectForeignData(byName) {
  for (const name of ['index.dat', 'club.dat', 'staff.dat', 'nation.dat']) {
    const bytes = byName.get(name);
    if (bytes && bytes.length >= 4 && MAC_TRAILER.every((b, i) => bytes[bytes.length - 4 + i] === b)) {
      throw new Error(`${name} ends in the 0xF1FFFFF1 table trailer of Mac CM 01/02 (3.9.62) data, which is big-endian `
        + 'with other record sizes: use a PC Data folder');
    }
  }
  const club = byName.get('club.dat');
  if (club && club.length % RECORD_SIZE[0]) {
    throw new Error(`club.dat is ${club.length} bytes, not a whole number of 581-byte PC records `
      + '(Mac 3.9.62 data is big-endian with 584-byte clubs)');
  }
}

function readIndex(bytes, warn) {
  if (bytes.length < INDEX_HEADER + INDEX_ENTRY) throw new Error(`index.dat is ${bytes.length} bytes, too short for a CM 01/02 index`);
  const view = viewOf(bytes);
  // The game reads exactly 22 entries; 13 known folders carry 1-6 stray bytes after them.
  const count = Math.min(INDEX_ENTRIES, Math.floor((bytes.length - INDEX_HEADER) / INDEX_ENTRY));
  if (count < INDEX_ENTRIES) warn(`index.dat holds ${count} of 22 entries`);
  const stray = bytes.length - INDEX_HEADER - count * INDEX_ENTRY;
  const extraComps = view.getInt32(0, true), humanManagers = view.getInt32(4, true);
  if (extraComps || humanManagers) warn(`index.dat header is ${extraComps}/${humanManagers}, not 0/0 as in database files: this may be a saved game`);
  const tables = new Map(), order = [];
  for (let k = 0; k < count; k++) {
    const at = INDEX_HEADER + k * INDEX_ENTRY;
    let end = at;
    while (end < at + 51 && bytes[end] !== 0) end++;
    const raw = String.fromCharCode(...bytes.subarray(at, end));
    if (!raw) continue;
    if (!/^[\x20-\x7e]+\.dat$/i.test(raw)) throw new Error(`index.dat entry ${k} names ${JSON.stringify(raw)}, not a .dat file: not a PC CM 01/02 index`);
    const entry = {
      file: raw.toLowerCase(), id: view.getInt32(at + 51, true), count: view.getInt32(at + 55, true),
      offset: view.getInt32(at + 59, true), format: view.getInt32(at + 63, true),
    };
    if (!(entry.id >= 0 && entry.id <= 22)) throw new Error(`index.dat entry ${k} (${entry.file}) has table id ${entry.id}, outside 0-22`);
    if (entry.count < 0 || entry.offset < 0) throw new Error(`index.dat entry ${k} (${entry.file}) has count ${entry.count} at offset ${entry.offset}`);
    if (tables.has(entry.id)) {
      warn(`index.dat lists table ${entry.id} twice; the first entry is used`);
      continue;
    }
    tables.set(entry.id, entry);
    order.push(entry.id);
  }
  return { tables, order, stray };
}

function checkFormats(tables, warn) {
  const staff = tables.get(CM_TABLES.staff);
  if (!staff) throw new Error('index.dat has no staff table (id 6)');
  if (staff.format !== 1 && staff.format !== 2) throw new Error(`index.dat gives the staff table format ${staff.format}, not 1 or 2`);
  for (const id of FORMAT_2_ONLY) {
    const entry = tables.get(id);
    if (entry && entry.format !== 2) throw new Error(`index.dat gives table ${id} (${entry.file}) format ${entry.format}: CM 01/02 data uses format 2`);
  }
  // SI files carry the empty youth table 8; editor-saved files replace it with preferences, 22.
  const preferences = tables.has(CM_TABLES.preferences), youth = tables.has(CM_TABLES.youth);
  if (staff.format === 1 ? preferences || !youth : !preferences || youth) {
    warn(`index.dat has ${youth ? '' : 'no '}table 8 and ${preferences ? '' : 'no '}table 22 with format-${staff.format} staff`);
  }
}

/**
 * Locate one single-table file. The indexed records must fit in it; bytes after them are read past with a warning
 * (some real files carry a stray byte), and the id check that follows proves the stride.
 */
function singleTable(id, tables, byName, warn) {
  const entry = tables.get(id);
  if (!entry) throw new Error(`index.dat has no entry for table ${id} (${TABLE_NAMES[id]})`);
  const bytes = byName.get(entry.file);
  if (!bytes) throw new Error(`${entry.file} is listed in index.dat but missing from the folder`);
  const size = RECORD_SIZE[id], end = entry.offset + entry.count * size;
  if (end > bytes.length) {
    throw new Error(`index.dat puts ${entry.count} ${size}-byte records at byte ${entry.offset} of ${entry.file}, past its end (${bytes.length} bytes)`);
  }
  if (bytes.length > end) {
    const spare = Math.floor((bytes.length - end) / size);
    warn(`${entry.file} has ${bytes.length - end} bytes after its ${entry.count} indexed records${spare ? ` (room for ${spare} more, not read)` : ''}`);
  }
  return { bytes, view: viewOf(bytes), offset: entry.offset, count: entry.count, size };
}

/**
 * The sub-tables packed into staff.dat, found by id and proved by stride: sorted by offset, each segment must
 * span exactly its records (the last may leave less than one record spare). The staff record size follows the
 * stride when the format flag disagrees.
 */
function staffTables(tables, byName, warn) {
  const bytes = byName.get('staff.dat');
  if (!bytes) throw new Error('staff.dat is missing from the folder');
  const flag = tables.get(CM_TABLES.staff).format;
  const segments = [...tables.values()].filter(e => e.file === 'staff.dat' && e.count > 0).sort((a, b) => a.offset - b.offset);
  const found = {};
  let staffSize = CM_STAFF_SIZE[flag];
  segments.forEach((entry, i) => {
    const last = i === segments.length - 1;
    const room = (last ? bytes.length : segments[i + 1].offset) - entry.offset;
    const fits = size => (last ? room >= entry.count * size && room - entry.count * size < size : room === entry.count * size);
    let size = RECORD_SIZE[entry.id];
    if (entry.id === CM_TABLES.staff) {
      size = [CM_STAFF_SIZE[flag], CM_STAFF_SIZE[3 - flag]].find(fits);
      if (!size) throw new Error(`staff.dat: ${room} bytes for ${entry.count} staff records is a stride of ${(room / entry.count).toFixed(2)}, not 157 or 110`);
      if (size !== CM_STAFF_SIZE[flag]) warn(`index.dat flags format-${flag} staff, but its records are ${size} bytes; reading ${size}-byte records`);
      staffSize = size;
    } else if (size && !fits(size)) {
      throw new Error(`staff.dat: ${room} bytes for ${entry.count} records of table ${entry.id} (${TABLE_NAMES[entry.id]}) is not a stride of ${size}`);
    }
    if (last && size && room > entry.count * size) warn(`staff.dat has ${room - entry.count * size} trailing bytes`);
    found[entry.id] = { bytes, view: viewOf(bytes), offset: entry.offset, count: entry.count, size };
  });
  for (const id of [CM_TABLES.staff, CM_TABLES.player]) {
    if (!tables.has(id)) throw new Error(`index.dat has no entry for table ${id} (${TABLE_NAMES[id]})`);
    if (tables.get(id).file !== 'staff.dat') throw new Error(`index.dat puts table ${id} in ${tables.get(id).file}, not staff.dat`);
    found[id] ||= { bytes, view: viewOf(bytes), offset: tables.get(id).offset, count: 0, size: id === CM_TABLES.staff ? staffSize : RECORD_SIZE[id] };
  }
  return { staff: found[CM_TABLES.staff], player: found[CM_TABLES.player], format: staffSize === CM_STAFF_SIZE[1] ? 1 : 2 };
}

/** Ids equal rows in clean data: a few strays are a warning, most rows off means the layout is wrong. */
function checkIds(label, table, idOffset, expected, warn) {
  let wrong = 0;
  for (let row = 0; row < table.count; row++) {
    if (table.view.getInt32(table.offset + row * table.size + idOffset, true) !== expected(row)) wrong++;
  }
  if (wrong * 2 > table.count) throw new Error(`${label}: ${wrong} of ${table.count} record ids differ from their row, so the layout does not match`);
  if (wrong) warn(`${label}: ${wrong} of ${table.count} record ids differ from their row`);
}

/** A name table's text by row, decoded on first use; blank and out-of-range rows are null. */
function nameTable(table) {
  const cache = new Map();
  return row => {
    if (!Number.isInteger(row) || row < 0 || row >= table.count) return null;
    if (!cache.has(row)) cache.set(row, text(table.bytes, table.offset + row * table.size, 51) || null);
    return cache.get(row);
  };
}

export function cmMonthDay(dayOfYear, leap) {
  const months = leap ? LEAP_MONTHS : COMMON_MONTHS;
  if (!Number.isInteger(dayOfYear) || dayOfYear < 0 || dayOfYear > (leap ? 365 : 364)) return null;
  let month = 11;
  while (dayOfYear <= months[month]) month--;
  return { month: month + 1, day: dayOfYear - months[month] };
}

const isLeapYear = year => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const pad = (n, width = 2) => String(n).padStart(width, '0');

/**
 * A stored CM date as 'YYYY-MM-DD', or null when unknown (year 0 or up to 1900) or invalid. The stored leap flag,
 * not the stored year, picks the month table; `shift` is added to the year (real = stored + shift), and a 29 February
 * that lands in a common year becomes the 28th.
 */
export function decodeCmDate(date, shift = 0) {
  if (!date || !Number.isInteger(date.year) || date.year <= 1900) return null;
  const monthDay = cmMonthDay(date.dayOfYear, !!date.leap);
  if (!monthDay) return null;
  const year = date.year + shift;
  const day = monthDay.month === 2 && monthDay.day === 29 && !isLeapYear(year) ? 28 : monthDay.day;
  return `${pad(year, 4)}-${pad(monthDay.month)}-${pad(day)}`;
}

/**
 * The files readCm0102 reads, as every known Data folder names them in index.dat. The rest of a folder (histories,
 * stadiums, officials, ...) is never opened, so a browser import reads only these.
 */
export const CM_DATA_FILES = Object.freeze(['index.dat', 'continent.dat', 'nation.dat', 'club_comp.dat', 'nation_comp.dat',
  'club.dat', 'first_names.dat', 'second_names.dat', 'common_names.dat', 'staff.dat']);

/** What identifies a database: club.dat and staff.dat byte sizes, and the staff format flag. */
export function fileSignature(files) {
  const byName = lowerCaseFiles(files);
  for (const name of ['index.dat', 'club.dat', 'staff.dat']) if (!byName.has(name)) throw new Error(`The Data folder has no ${name}`);
  rejectForeignData(byName);
  const { tables } = readIndex(byName.get('index.dat'), () => {});
  return { clubSize: byName.get('club.dat').length, staffSize: byName.get('staff.dat').length, staffFormat: tables.get(CM_TABLES.staff)?.format ?? null };
}

/**
 * Read a CM 01/02 Data folder, `{ fileName: Uint8Array }` (names in any case). Returns
 * `{ format, counts, index, warnings, nations, clubs, competitions, players }`: links that are negative, out of
 * range, or lead to a blank or extinct club are null; `competitions` is the combined index the clubs' divisions use
 * (club_comp rows, then nation_comp rows). `players` are the people with valid player data whose job is not
 * staff-only, including player-managers and free agents. Dates stay as stored; see decodeCmDate.
 */
export function readCm0102(files, { onWarning } = {}) {
  const warnings = [];
  const warn = message => { warnings.push(message); onWarning?.(message); };
  const byName = lowerCaseFiles(files);
  if (!byName.has('index.dat')) throw new Error('The Data folder has no index.dat');
  rejectForeignData(byName);
  const { tables, order, stray } = readIndex(byName.get('index.dat'), warn);
  checkFormats(tables, warn);
  const single = id => singleTable(id, tables, byName, warn);

  const continentTable = single(CM_TABLES.continent);
  checkIds('continent.dat', continentTable, 0, row => row, warn);
  const continents = Array.from({ length: continentTable.count }, (_, row) => text(continentTable.bytes, continentTable.offset + row * 198 + 4, 26));

  const nationTable = single(CM_TABLES.nation);
  checkIds('nation.dat', nationTable, 0, row => row, warn);
  const link = (value, count) => (Number.isInteger(value) && value >= 0 && value < count ? value : null);
  const nations = Array.from({ length: nationTable.count }, (_, row) => {
    const at = nationTable.offset + row * nationTable.size;
    const continent = link(nationTable.view.getInt32(at + 113, true), continents.length);
    return {
      row, name: text(nationTable.bytes, at + 4, 51), shortName: text(nationTable.bytes, at + 56, 26),
      code: text(nationTable.bytes, at + 83, 4), continent: continent == null ? null : continents[continent] || null,
    };
  });

  const clubCompTable = single(CM_TABLES.clubComp), nationCompTable = single(CM_TABLES.nationComp);
  checkIds('club_comp.dat', clubCompTable, 0, row => row, warn);
  checkIds('nation_comp.dat', nationCompTable, 0, row => clubCompTable.count + row, warn);
  // Out-of-range links read as none, but a file with many of them is counted.
  let badLinks = 0;
  const checked = (value, count) => {
    if (value >= count) badLinks++;
    return link(value, count);
  };
  const competitions = [clubCompTable, nationCompTable].flatMap((table, part) => Array.from({ length: table.count }, (_, row) => {
    const at = table.offset + row * table.size;
    return {
      row: part ? clubCompTable.count + row : row, name: text(table.bytes, at + 4, 51), shortName: text(table.bytes, at + 56, 26),
      nation: checked(table.view.getInt32(at + 93, true), nations.length),
    };
  }));
  if (badLinks) warn(`club_comp.dat and nation_comp.dat: ${badLinks} competitions link a nation beyond nation.dat`);

  const clubTable = single(CM_TABLES.club);
  checkIds('club.dat', clubTable, 0, row => row, warn);
  const clubs = [], liveClub = new Uint8Array(clubTable.count);
  badLinks = 0;
  for (let row = 0; row < clubTable.count; row++) {
    const at = clubTable.offset + row * clubTable.size;
    const name = text(clubTable.bytes, at + 4, 51, true);
    if (!name) continue;
    const nation = checked(clubTable.view.getInt32(at + 83, true), nations.length);
    // An extinct club (no nation) keeps its record, but the game unattaches its people.
    if (nation != null) liveClub[row] = 1;
    clubs.push({ row, name, shortName: text(clubTable.bytes, at + 56, 26), nation, division: checked(clubTable.view.getInt32(at + 87, true), competitions.length) });
  }
  if (badLinks) warn(`club.dat: ${badLinks} nation or division links point beyond their tables`);
  const natClubCount = tables.get(CM_TABLES.natClub)?.count ?? 0;

  const names = {};
  for (const [key, id, label] of [['first', 13, 'first_names.dat'], ['second', 14, 'second_names.dat'], ['common', 15, 'common_names.dat']]) {
    const table = single(id);
    checkIds(label, table, 51, row => row, warn);
    names[key] = nameTable(table);
  }

  const { staff, player, format } = staffTables(tables, byName, warn);
  checkIds('staff.dat staff table', staff, 0, row => row, warn);
  checkIds('staff.dat player table', player, 0, row => row, warn);
  const playerLinkAt = format === 1 ? 145 : 97;
  const linked = new Uint8Array(player.count);
  const players = [], dayCounts = new Map();
  let sharedLinks = 0, kindMismatch = 0, badDays = 0, badRatings = 0, badAbility = 0, noNation = 0, badClubLinks = 0;
  for (let row = 0; row < staff.count; row++) {
    const at = staff.offset + row * staff.size, v = staff.view;
    const job = v.getInt8(at + 61), classification = v.getUint8(at + 95);
    const playerRow = link(v.getInt32(at + playerLinkAt, true), player.count);
    const hasPlayer = playerRow != null && player.view.getInt32(player.offset + playerRow * player.size, true) === playerRow;
    if (hasPlayer !== (classification === 2 || classification === 3)) kindMismatch++;
    if (!hasPlayer) continue;
    if (linked[playerRow]++) sharedLinks++;
    if (STAFF_ONLY_JOBS.has(job)) continue;

    const first = names.first(v.getInt32(at + 4, true)), second = names.second(v.getInt32(at + 8, true));
    const commonId = v.getInt32(at + 12, true);
    const common = commonId > 0 ? names.common(commonId) : null;
    const fullName = [first, second].filter(Boolean).join(' ') || common || '';
    const day = v.getInt16(at + 16, true), year = v.getUint16(at + 18, true), leap = v.getUint32(at + 20, true) !== 0;
    let dob = null;
    if (year > 1900) {
      if (cmMonthDay(day, leap)) {
        dob = { year, dayOfYear: day, leap };
        dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
      } else badDays++;
    }
    const yearOfBirth = v.getInt16(at + 24, true);
    const nation = link(v.getInt32(at + 26, true), nations.length);
    if (nation == null) noNation++;
    const clubId = v.getInt32(at + 57, true);
    if (clubId >= clubTable.count + natClubCount) badClubLinks++;
    const club = clubId >= 0 && clubId < clubTable.count && liveClub[clubId] ? clubId : null;

    const p = player.offset + playerRow * player.size;
    const ratings = {};
    RATING_KEYS.forEach((key, i) => {
      ratings[key] = player.view.getInt8(p + 15 + i);
      if (ratings[key] < 0 || ratings[key] > 20) badRatings++;
    });
    const ca = player.view.getInt16(p + 5, true), pa = player.view.getInt16(p + 7, true);
    if (ca < 0 || ca > 200) badAbility++;
    players.push({
      id: v.getInt32(at, true), name: common || fullName, fullName, firstName: first, secondName: second, commonName: common,
      dob, yearOfBirth: yearOfBirth > 1900 ? yearOfBirth : null, nation, secondNation: link(v.getInt32(at + 30, true), nations.length),
      club, job, classification, ca, pa: pa >= 0 ? pa : null, caps: v.getUint8(at + 34), ratings,
    });
  }
  if (kindMismatch) warn(`staff.dat: ${kindMismatch} people whose classification disagrees with their player data`);
  if (sharedLinks) warn(`staff.dat: ${sharedLinks} people share a player row with someone else`);
  if (badDays) warn(`staff.dat: ${badDays} players have a birth day outside the year; their dates are treated as unknown`);
  if (badRatings) warn(`staff.dat: ${badRatings} player position ratings fall outside 0-20`);
  if (badAbility) warn(`staff.dat: ${badAbility} players have a current ability outside 0-200`);
  if (badClubLinks) warn(`staff.dat: ${badClubLinks} players link a club beyond club.dat and nat_club.dat`);
  if (noNation * 100 > players.length) warn(`staff.dat: ${noNation} of ${players.length} players have no nationality`);
  const dated = [...dayCounts.values()].reduce((sum, n) => sum + n, 0);
  const busiest = Math.max(0, ...dayCounts.values());
  // A year changer that rewrites days through a 1-31 helper piles most birthdays onto one day.
  if (dated >= 100 && busiest * 10 > dated) warn(`staff.dat: ${busiest} of ${dated} birthdays fall on one day, so day and month may be unreliable`);

  return {
    format,
    counts: {
      staff: staff.count, players: player.count, nations: nations.length, clubs: clubTable.count, nationalSides: natClubCount,
      clubCompetitions: clubCompTable.count, nationCompetitions: nationCompTable.count, continents: continents.length,
    },
    index: { order, formats: Object.fromEntries(order.map(id => [id, tables.get(id).format])), strayBytes: stray },
    warnings, nations, clubs, competitions, players,
  };
}
