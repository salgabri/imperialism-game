// The football data set builder (src/data/footballSetBuild.js, scripts/build-football-set.mjs;
// docs/design/football-years.md) on synthetic CM 01/02 folders from scripts/lib/cm0102-fixture.mjs,
// and the manifests it reads (src/data/cm0102Releases.js, cm0102Nations.js, footballFederations.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { NATIONS } from '../src/data/teams.js';
import { CM_ROLES, cmTupleOf, expandCmTuple } from '../src/data/cmPlayers.js';
import { fileSignature } from '../src/data/cm0102.js';
import { CM0102_RELEASES as databases } from '../src/data/cm0102Releases.js';
import { CM0102_NATIONS as nationMap } from '../src/data/cm0102Nations.js';
import { FOOTBALL_FEDERATIONS as federations } from '../src/data/footballFederations.js';
import {
  buildFootballIndex, buildFootballSet, contentHash, estimateBirthShift, LAST_YEAR, LEAGUES, nationResolver, NO_TEAM, resolveDatabase,
  seasonOfRelease, seasonYear, territoryFor,
} from '../src/data/footballSetBuild.js';
import { decodeFootballSet } from '../src/engine/footballSets.js';
import { sampleDatabase, writeCm0102Files } from './lib/cm0102-fixture.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const identity = { label: 'Fixture', released: '2007-10', url: 'https://example.test/fixture', dobShift: 6 };
const build = (db = sampleDatabase({ birthYearShift: 6 }), options = {}) => buildFootballSet(writeCm0102Files(db, options.write), {
  databases, nationMap, federations, identity, ...options,
});
const tuplesOf = doc => [...Object.values(doc.nations).flatMap(([, , squad]) => squad), ...doc.clubs.flatMap(club => club.squad)];

// SI's stored nation names (3.9.60 and 3.9.68: Taiwan became Chinese Taipei), then Update Team additions and the
// spellings TransferTool's lookup accepts.
const STORED_NATIONS = ('Afghanistan; Albania; Algeria; American Samoa; Andorra; Angola; Anguilla; Antigua & Barbuda; Argentina; Armenia; '
  + 'Aruba; Australia; Austria; Azerbaijan; Bahamas; Bahrain; Bangladesh; Barbados; Belarus; Belgium; Belize; Benin; Bermuda; Bhutan; '
  + 'Bolivia; Bosnia-Herzegovina; Botswana; Brazil; British Virgin Islands; Brunei Darussalam; Bulgaria; Burkina Faso; Burundi; Cambodia; '
  + 'Cameroon; Canada; Cape Verde Islands; Cayman Islands; Central African Republic; Chad; Chile; China PR; Chinese Taipei; Colombia; '
  + 'Commonwealth of Soviet States; Cook Islands; Costa Rica; Croatia; Cuba; Cyprus; Czech Republic; Czechoslovakia; '
  + 'Democratic Republic of Congo; Denmark; Djibouti; Dominica; Dominican Republic; East Germany; Ecuador; Egypt; El Salvador; England; '
  + 'Equatorial Guinea; Eritrea; Estonia; Ethiopia; Faroe Islands; Fiji; Finland; France; FYR of Macedonia; Gabon; Georgia; Germany; Ghana; '
  + 'Greece; Grenada; Guam; Guatemala; Guinea; Guinea-Bissau; Guyana; Haiti; Holland; Honduras; Hong Kong; Hungary; Iceland; India; '
  + 'Indonesia; Iran; Iraq; Israel; Italy; Ivory Coast; Jamaica; Japan; Jordan; Kazakhstan; Kenya; Kuwait; Kyrgyzstan; Laos; Latvia; '
  + 'Lebanon; Lesotho; Liberia; Libya; Liechtenstein; Lithuania; Luxembourg; Macau; Madagascar; Malawi; Malaysia; Maldives; Mali; Malta; '
  + 'Mauritania; Mauritius; Mexico; Moldova; Mongolia; Montserrat; Morocco; Mozambique; Myanmar; Namibia; Nepal; Netherlands Antilles; '
  + 'New Caledonia; New Zealand; Nicaragua; Niger; Nigeria; North Korea; Northern Ireland; Norway; Oman; Pakistan; Palestine; Panama; '
  + 'Papua New Guinea; Paraguay; Pays Basque; Peru; Poland; Portugal; Puerto Rico; Qatar; Republic of Ireland; Romania; Russia; Rwanda; '
  + 'Saint Lucia; Samoa; San Marino; Saudi Arabia; Scotland; Senegal; Seychelles; Sierra Leone; Singapore; Slovakia; Slovenia; '
  + 'Solomon Islands; Somalia; South Africa; South Korea; Soviet Union; Spain; Sri Lanka; St Kitts & Nevis; St Vincent & The Grenadines; '
  + 'Sudan; Surinam; Swaziland; Sweden; Switzerland; Syria; São Tomé & Principe; Tahiti; Taiwan; Tajikistan; Tanzania; Thailand; '
  + 'The Congo; The Gambia; The Philippines; Timor; Togo; Tonga; Trinidad & Tobago; Tunisia; Turkey; Turkmenistan; '
  + 'Turks and Caicos Islands; Uganda; Ukraine; United Arab Emirates; United States; Uruguay; US Virgin Islands; Uzbekistan; Vanuatu; '
  + 'Venezuela; Vietnam; Wales; West Germany; Yemen; Yugoslavia; Zaire; Zambia; Zimbabwe').split('; ');
const LATER_NATIONS = ['Serbia', 'Montenegro', 'Kosovo', 'Gibraltar', 'North Macedonia', 'Curaçao', 'Martinique', 'eSwatini',
  'Serbia and Montenegro', 'South Sudan', 'Southern Sudan', 'Macedonia', 'Netherlands'];

/** The tuple the builder should write for a fixture person, worked out from the description, not the parser. */
function expectedTuple(db, row, shift) {
  const person = db.people[row];
  const full = `${person.first} ${person.second}`;
  const name = typeof person.common === 'string' && person.common ? person.common : full;
  const club = person.club >= 0 && person.club < db.clubs.length && db.clubs[person.club].nation >= 0
    ? db.clubs[person.club].name.split(/[\r\n]/)[0].trim() : '';
  const { year, month, day } = person.dob;
  const real = year + shift, leap = real % 4 === 0 && (real % 100 !== 0 || real % 400 === 0);
  const date = year > 1900 ? `${real}-${String(month).padStart(2, '0')}-${String(month === 2 && day === 29 && !leap ? 28 : day).padStart(2, '0')}` : '';
  return [row, name, name === full ? 0 : full, person.player.ca, null, db.nations[person.nation].name, club, date];
}

// ---- Manifests ----

test('the database manifest names every known release once, by a unique signature', () => {
  assert.equal(databases.length, 48);
  const pairs = databases.flatMap(d => d.signatures.map(s => `${s.club}/${s.staff}`));
  assert.equal(new Set(pairs).size, pairs.length);
  assert.equal(new Set(databases.map(d => d.id)).size, databases.length);
  for (const d of databases) {
    assert.match(d.id, /^cm0102-\d{4}-\d{2}(-(odb|sim))?$/, d.id);
    assert.ok(d.id.startsWith(`cm0102-${d.released}`), d.id);
    assert.ok(d.label.trim() && d.provider.trim(), d.id);
    assert.equal(d.year, seasonYear(d.season), d.id);
    assert.ok(d.year <= LAST_YEAR, d.id);
    assert.match(d.url, /^https:\/\/www\.champman0102\.co\.uk\/viewtopic\.php\?t=\d+$/);
    assert.ok(['birth', 'joined', 'contract'].every(key => Number.isInteger(d.shifts[key])), d.id);
    assert.ok(d.signatures.every(s => Number.isInteger(s.club) && Number.isInteger(s.staff) && s.club % 581 === 0), d.id);
    for (const s of d.signatures) for (const key of ['clubSha256', 'staffSha256']) if (key in s) assert.match(s[key], /^[0-9a-f]{64}$/);
  }
  const byLabel = Object.fromEntries(databases.map(d => [d.label, d]));
  assert.ok(!byLabel['Summer 2004'] && !byLabel['Summer 2006'] && !byLabel['Empty database']);
  assert.deepEqual([byLabel['3.9.60'].id, byLabel['3.9.65'].id, byLabel['3.9.68'].id], ['cm0102-2001-09', 'cm0102-2001-12', 'cm0102-2002-11']);
  assert.equal(byLabel['3.9.68'].season, '2002/03');
  assert.equal(byLabel['3.9.60'].signatures.length, 2);
  assert.equal(byLabel['September 2005'].provider, 'Helvete');
  assert.deepEqual(byLabel['June 2010'].shifts, { birth: 9, joined: 8, contract: 8 });
  assert.equal(byLabel['May 2026'].url, 'https://www.champman0102.co.uk/viewtopic.php?t=10604');
});

test('every stored CM nation name maps to a game nation or is listed as having no team', () => {
  const resolve = nationResolver(nationMap);
  const unmapped = [...STORED_NATIONS, ...LATER_NATIONS].filter(name => resolve(name) == null);
  assert.deepEqual(unmapped, []);
  assert.equal(STORED_NATIONS.length, 214);
  for (const [name, id] of Object.entries(nationMap.aliases)) assert.ok(NATIONS[id], `${name} -> ${id}`);
  const reached = new Set([...STORED_NATIONS, ...LATER_NATIONS].map(resolve).filter(id => id !== NO_TEAM));
  assert.deepEqual(Object.keys(NATIONS).filter(id => !reached.has(id)), [], 'game nations no CM name reaches');
  assert.equal(resolve('Holland'), '528');
  assert.equal(resolve('Yugoslavia'), '688');
  assert.equal(resolve('Republic of Ireland'), '372');
  assert.equal(resolve('  south   korea '), '410');
  assert.equal(resolve('Scotland'), NO_TEAM);
  assert.equal(resolve('Fictionland'), null);
  assert.throws(() => nationResolver({ aliases: { Atlantis: '999' } }), /not a game nation/);
  assert.throws(() => nationResolver({ noTeam: ['England'] }), /maps to 826/);
});

test('federations: a shape plays once its association was a FIFA member by 30 June of the season-end year', () => {
  for (const [shape, entry] of Object.entries(federations.shapes)) {
    assert.ok(NATIONS[shape], shape);
    assert.ok(entry.heldBy == null || NATIONS[entry.heldBy], shape);
    assert.match(entry.member, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(entry.source, /^https:\/\/inside\.fifa\.com\/associations\/[A-Z]{3}$/);
  }
  const at = year => territoryFor(federations, year);
  assert.deepEqual(at(2003), { merged: { 499: '688', 540: '250', 728: '729' }, inactive: ['626', 'KOS'] });
  assert.deepEqual(at(2005), { merged: { 499: '688', 728: '729' }, inactive: ['626', 'KOS'] });
  assert.deepEqual(at(2006), { merged: { 499: '688', 728: '729' }, inactive: ['KOS'] });
  assert.deepEqual(at(2007), { merged: { 728: '729' }, inactive: ['KOS'] });
  assert.deepEqual(at(2011), { merged: { 728: '729' }, inactive: ['KOS'] });
  assert.deepEqual(at(2012), { merged: {}, inactive: ['KOS'] });
  assert.deepEqual(at(2016), { merged: {}, inactive: [] });
  assert.throws(() => territoryFor({ shapes: { 999: { member: '2010-01-01' } } }, 2005), /not both game nations/);
});

// ---- Identification ----

test('seasons and identities: release months, flags and refusals', () => {
  assert.equal(seasonYear('2025/26'), 2026);
  assert.equal(seasonYear('1999/00'), 2000);
  assert.throws(() => seasonYear('2025/27'), /not like 2025\/26/);
  assert.deepEqual(['2001-09', '2002-11', '2010-06', '2025-12', '2026-05'].map(seasonOfRelease), ['2001/02', '2002/03', '2009/10', '2025/26', '2025/26']);
  const signature = { clubSize: 1, staffSize: 2, staffFormat: 2 };
  assert.throws(() => resolveDatabase(signature, databases, {}), /Unknown CM 01\/02 database .* --label=\.\.\. --released=\.\.\. --url=\.\.\. --dob-shift=\.\.\./);
  assert.throws(() => resolveDatabase(signature, databases, { ...identity, released: '2007-13' }), /not a month/);
  assert.throws(() => resolveDatabase(signature, databases, { ...identity, url: 'example.test' }), /not an https URL/);
  assert.throws(() => resolveDatabase(signature, databases, { ...identity, dobShift: 'six' }), /not a whole number/);
  assert.throws(() => resolveDatabase(signature, databases, { ...identity, id: 'cm0102-07' }), /is not like cm0102-2026-05/);
  assert.throws(() => resolveDatabase(signature, databases, { ...identity, released: '2007-11' }), /belongs to the known database November 2007/);
  const named = resolveDatabase(signature, databases, { ...identity, id: 'cm0102-2007-10-custom', provider: 'Fixture makers' });
  assert.deepEqual([named.id, named.season, named.year, named.provider, named.dobShift], ['cm0102-2007-10-custom', '2007/08', 2008, 'Fixture makers', 6]);
  assert.deepEqual(named.defaulted, ['--season']);
  // A flag of only spaces is missing (the game refuses a blank label or provider), and a shift is plain digits.
  assert.throws(() => resolveDatabase(signature, databases, { ...identity, label: '   ' }), /Name it with --label=\.\.\. \(and optionally/);
  assert.throws(() => resolveDatabase(signature, databases, { ...identity, dobShift: ' ' }), /Name it with --dob-shift=\.\.\. \(and optionally/);
  for (const dobShift of ['0x6', '6.0', '1e1', '6 years', '101']) {
    assert.throws(() => resolveDatabase(signature, databases, { ...identity, dobShift }), /is not a whole number of years/, dobShift);
  }
  assert.deepEqual(['+9', ' -2 ', 0].map(dobShift => resolveDatabase(signature, databases, { ...identity, dobShift }).dobShift), [9, -2, 0]);
  const padded = resolveDatabase(signature, databases, { ...identity, label: ' Fixture ', provider: ' ' });
  assert.deepEqual([padded.label, padded.provider, padded.defaulted], ['Fixture', 'CM 01/02 Update Team', ['--id', '--season', '--provider']]);
  // The game loads seasons ending up to 2100.
  assert.equal(resolveDatabase(signature, databases, { ...identity, season: '2099/00' }).year, 2100);
  assert.throws(() => resolveDatabase(signature, databases, { ...identity, season: '2150/51' }), /Season 2150\/51 ends after 2100, the last year the game loads/);
  const may = databases.find(d => d.label === 'May 2026');
  const known = resolveDatabase({ clubSize: may.signatures[0].club, staffSize: may.signatures[0].staff }, databases, { label: 'Other' });
  assert.deepEqual([known.known, known.id, known.dobShift, known.ignored], [true, 'cm0102-2026-05', 24, ['--label']]);
});

test('a known database is identified by its sizes, with digests confirmed', () => {
  const files = writeCm0102Files(sampleDatabase({ birthYearShift: 6 }));
  const { clubSize, staffSize } = fileSignature(files);
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const entry = {
    id: 'cm0102-2007-10', label: 'Fixture known', provider: 'Fixture makers', season: '2007/08', year: 2008, released: '2007-10',
    url: 'https://example.test/known', shifts: { birth: 6, joined: 6, contract: 6 },
    signatures: [{ club: clubSize, staff: staffSize, clubSha256: sha(files['club.dat']), staffSha256: '0'.repeat(64) }],
  };
  const { doc, text, audit, warnings } = buildFootballSet(files, { databases: [entry], nationMap, federations, identity: { label: 'Ignored' } });
  assert.equal(doc.source.version, 'Fixture known');
  assert.equal(doc.source.provider, 'Fixture makers');
  assert.equal(doc.label, 'CM 01/02 · Fixture known');
  assert.deepEqual(audit.database.digests, { club: 'match', staff: 'mismatch' });
  assert.ok(warnings.some(w => /staff\.dat has the size of Fixture known but not its SHA-256/.test(w)));
  assert.ok(warnings.some(w => /--label is ignored/.test(w)));
  // verifyFiles: false skips the digests, which a browser import may not want to pay for, and builds the same set.
  const quick = buildFootballSet(files, { databases: [entry], nationMap, federations, verifyFiles: false });
  assert.deepEqual(quick.audit.database.digests, { club: 'not checked', staff: 'not checked' });
  assert.ok(!quick.warnings.some(w => /SHA-256/.test(w)));
  assert.equal(quick.text, text);
  const unlisted = { ...entry, signatures: [{ club: clubSize, staff: staffSize }] };
  assert.deepEqual(buildFootballSet(files, { databases: [unlisted], nationMap, federations, verifyFiles: false }).audit.database.digests,
    { club: 'not known', staff: 'not known' });
});

test('the builder defaults to the src manifests, so the CLI and the browser build the same set', () => {
  const files = writeCm0102Files(sampleDatabase({ birthYearShift: 6 }));
  const given = buildFootballSet(files, { databases, nationMap, federations, identity });
  const defaulted = buildFootballSet(files, { identity });
  assert.equal(defaulted.text, given.text);
  assert.deepEqual(defaulted.audit, given.audit);
  assert.throws(() => buildFootballSet(files), /Unknown CM 01\/02 database .*: it is not in src\/data\/cm0102Releases\.js/);
  assert.throws(() => buildFootballSet(writeCm0102Files(sampleDatabase({ birthYearShift: 6, unmapped: true })), { identity }),
    /Fictionland \(2 players\)\. Add them to src\/data\/cm0102Nations\.js/);
});

test('seasons ending before 2002 are refused', () => {
  assert.throws(() => build(undefined, { identity: { ...identity, released: '2001-05', season: '2000/01' } }), /ends in 2001: seasons ending before 2002 are refused .*football-years\.md/);
  const files = writeCm0102Files(sampleDatabase());
  const { clubSize, staffSize } = fileSignature(files);
  const old = { id: 'cm0102-2000-10', label: 'Old', provider: 'Fixture makers', season: '2000/01', year: 2001, released: '2000-10',
    url: 'https://example.test/old', shifts: { birth: 0 }, signatures: [{ club: clubSize, staff: staffSize }] };
  assert.throws(() => buildFootballSet(files, { databases: [old], nationMap, federations }), /before 2002/);
  // SI's own 2001/02 database is the first accepted.
  assert.equal(build(undefined, { identity: { ...identity, released: '2001-09', id: 'cm0102-2001-09-custom', dobShift: 0 } }).doc.year, 2002);
});

// ---- Birth-shift check ----

/** Fixture players with their real birthdays, standing in for the famous players of a real database. */
const famousOf = (db, shift, count = 6) => db.people.filter(p => p.player && p.job === 11 && p.dob?.month).slice(0, count)
  .map(p => [`${p.first} ${p.second}`, `${p.dob.year + shift}-${String(p.dob.month).padStart(2, '0')}-${String(p.dob.day).padStart(2, '0')}`]);

test('the birth shift is checked against known birthdays', () => {
  const db = sampleDatabase({ birthYearShift: 12 });
  const files = writeCm0102Files(db);
  const famous = famousOf(db, 12);
  const named = { ...identity, released: '2013-11', dobShift: 12 };
  const agreed = buildFootballSet(files, { databases, nationMap, federations, identity: named, famous });
  assert.equal(agreed.audit.birthShift.oracle.shift, 12);
  assert.equal(agreed.audit.birthShift.oracle.conclusive, true);
  assert.ok(!agreed.warnings.some(w => /shift/i.test(w)));
  // An unknown folder whose --dob-shift disagrees stops the build.
  assert.throws(() => buildFootballSet(files, { databases, nationMap, federations, identity: { ...named, dobShift: 11 }, famous }),
    /--dob-shift=11 disagrees with known birthdays, which give \+12 \(6 of 6 famous players\)/);
  // A known database keeps its manifest shift and says so loudly.
  const { clubSize, staffSize } = fileSignature(files);
  const known = { id: 'cm0102-2013-11', label: 'Fixture known', provider: 'Fixture makers', season: '2013/14', year: 2014, released: '2013-11',
    url: 'https://example.test/known', shifts: { birth: 11 }, signatures: [{ club: clubSize, staff: staffSize }] };
  const mismatched = buildFootballSet(files, { databases: [known], nationMap, federations, famous });
  assert.ok(mismatched.warnings.some(w => /^BIRTH SHIFT MISMATCH: known birthdays give \+12 .* manifest gives Fixture known \+11/.test(w)));
  assert.equal(mismatched.doc.source.dobShift, 11);
  // Too few matches is inconclusive, and the given shift is used.
  const few = buildFootballSet(files, { databases, nationMap, federations, identity: { ...named, dobShift: 11 }, famous: famous.slice(0, 4) });
  assert.ok(few.warnings.some(w => /inconclusive \(4 famous players found, 4 agreeing\); using \+11 from --dob-shift/.test(w)));
});

test('the oracle matches names without accents or case, and day and month within a day', () => {
  const player = (name, year, dayOfYear) => ({ name, fullName: name, dob: { year, dayOfYear, leap: false } });
  const famous = [['Testène Fakeman', '1977-08-17']];
  assert.equal(estimateBirthShift([player('TESTENE fakeman', 1960, 228)], famous).shift, 17);
  assert.equal(estimateBirthShift([player('Testene Fakeman', 1960, 229)], famous).matches, 1);
  assert.equal(estimateBirthShift([player('Testene Fakeman', 1960, 231)], famous).matches, 0);
  const result = estimateBirthShift([player('Testene Fakeman', 1960, 228)], famous);
  assert.equal(result.conclusive, false);
  // Two stored copies are one witness: the copy at a club, as de-duplication keeps, though the other has the higher CA.
  const copies = [{ ...player('Testene Fakeman', 1961, 228), id: 7, club: null, ca: 90 }, { ...player('Testene Fakeman', 1960, 228), id: 8, club: 3, ca: 50 }];
  const once = estimateBirthShift(copies, famous);
  assert.deepEqual([once.matches, once.agreeing, once.duplicates, once.shift, once.samples.map(s => s.cmId)], [1, 1, 1, 17, [8]]);
});

test('a famous player stored twice counts once towards a conclusive birth shift', () => {
  const db = sampleDatabase({ birthYearShift: 6 });
  const famous = [];
  for (let i = 0; i < 3; i++) {
    const person = { first: 'Famo', second: `Twicefake${i}`, dob: { year: 1960 + i, month: 3, day: 10 + i }, nation: 0, club: 0, job: 11,
      player: { ca: 50, ratings: { gk: 20 } } };
    db.people.push(person, { ...person, club: -1 });
    famous.push([`Famo Twicefake${i}`, `${1969 + i}-03-${10 + i}`]);
  }
  // Six stored records but three people: too few to overrule --dob-shift=6.
  const { audit, warnings, summary } = build(db, { famous });
  const { oracle } = audit.birthShift;
  assert.deepEqual([oracle.matches, oracle.agreeing, oracle.shift, oracle.conclusive, oracle.duplicates], [3, 3, 9, false, 3]);
  const atClub = name => db.people.findIndex(p => `${p.first} ${p.second}` === name && p.club >= 0);
  assert.deepEqual(oracle.samples.map(s => s.cmId), famous.map(([name]) => atClub(name)));
  assert.ok(warnings.some(w => /inconclusive \(3 famous players found, 3 agreeing\); using \+6 from --dob-shift/.test(w)));
  assert.ok(summary.some(line => /famous players: 3 found, 3 agree on \+9 \(3 more stored copies not counted\)/.test(line)));
});

// ---- The data set ----

test('a data set has every game nation, its source block and a content version', () => {
  const { doc, text } = build();
  assert.deepEqual(Object.keys(doc), ['format', 'id', 'version', 'year', 'season', 'label', 'local', 'source', 'nations', 'clubs', 'territory', 'coverage']);
  assert.deepEqual(Object.keys(doc.nations).sort(), Object.keys(NATIONS).sort());
  assert.deepEqual(doc.nations['076'], [40, 0, []]);
  for (const [id, [strength, pool, squad]] of Object.entries(doc.nations)) {
    assert.ok(Number.isInteger(strength) && strength >= 1 && strength <= 99, id);
    assert.ok(pool >= squad.length && squad.length <= 11, id);
  }
  assert.deepEqual(doc.source, {
    provider: 'CM 01/02 Update Team', edition: 'CM 01/02', version: 'Fixture', snapshotDate: '2007-10', url: 'https://example.test/fixture',
    rawScale: 200, conversion: 'round(ca * 99 / 200)', dobShift: 6,
  });
  assert.deepEqual([doc.id, doc.year, doc.season, doc.label, doc.local], ['cm0102-2007-10', 2008, '2007/08', 'CM 01/02 · Fixture', true]);
  assert.equal(doc.version, `cm0102-2007-10-${contentHash(doc)}`);
  const { version, ...rest } = JSON.parse(text);
  assert.equal(version, `cm0102-2007-10-${createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 8)}`);
  assert.equal(text, `${JSON.stringify(doc)}\n`);
  assert.deepEqual(doc.coverage, { players: new Set(tuplesOf(doc).map(t => t[0])).size, nations: 8, completeXIs: 7, clubs: 7, leagues: 7 });
});

test('never invents: every tuple is a stored fixture player, and rebuilds exactly', () => {
  const db = sampleDatabase({ birthYearShift: 6 });
  const { doc } = build(db);
  const tuples = tuplesOf(doc);
  assert.ok(tuples.length > 80);
  for (const tuple of tuples) {
    const expected = expectedTuple(db, tuple[0], 6);
    assert.deepEqual([...tuple.slice(0, 4), ...tuple.slice(5)], [...expected.slice(0, 4), ...expected.slice(5)], tuple[1]);
    assert.ok(tuple[4].split(',').every(key => Object.hasOwn(CM_ROLES, key)), tuple[1]);
    const [name, , rating, sourceInfo] = expandCmTuple(tuple, doc.source);
    assert.deepEqual(cmTupleOf(name, sourceInfo), tuple);
    assert.equal(rating, Math.max(1, Math.round(tuple[3] * 99 / 200)));
  }
  const fullNames = new Set(tuples.map(t => (t[2] || t[1])));
  for (const name of ['Managero Notaplayer', 'Scouto Watcher', 'Noability Testcase', 'Nopositions Testcase', 'Stateless Testcase']) {
    assert.ok(!fullNames.has(name), name);
  }
  // Positions come from the stored ratings, and a common name keeps the full name beside it.
  const byName = Object.fromEntries(tuples.map(t => [t[1], t]));
  assert.equal(byName['Fixto Player001'][4], 'gk');
  assert.equal(byName['Mocko Player002'][4], 'rb');
  assert.equal(byName['Fakežej Mockošek'][4], 'am');
  assert.equal(byName['Fakežej Mockošek'][5], 'Yugoslavia');
  assert.equal(doc.nations['688'][2][0][1], 'Fakežej Mockošek');
  assert.equal(byName['Testène Françoisfake'][7], '1964-02-29');
});

test('players of teamless nations stay at clubs; the dropped are counted', () => {
  const { doc, audit } = build();
  assert.deepEqual(audit.noTeam, { Scotland: 1, Curaçao: 1 });
  assert.deepEqual(audit.players.dropped, { nameless: 0, noAbility: 1, noPositions: 1, noNationality: 1, unmapped: 0, duplicates: 1 });
  const national = Object.values(doc.nations).flatMap(([, , squad]) => squad);
  assert.ok(!national.some(t => ['Scotland', 'Curaçao'].includes(t[5])));
  const england = audit.nations.find(n => n.id === '826');
  assert.equal(england.pool, doc.nations['826'][1]);
  assert.equal(england.naturalLineup, true);
  assert.equal(audit.nations.filter(n => n.naturalLineup).length, doc.coverage.completeXIs);
});

test('a duplicated person is kept once, at a club; namesakes without a date both stay', () => {
  const db = sampleDatabase({ birthYearShift: 6 });
  const twin = { first: 'Twino', second: 'Namesakefake', dob: { year: 0, dayOfYear: 0 }, yearOfBirth: 0, nation: 0, club: -1, job: 11,
    player: { ca: 60, ratings: { gk: 20 } } };
  db.people.push(twin, { ...twin, player: { ca: 61, ratings: { gk: 20 } } });
  const { doc, audit } = build(db);
  const dupes = doc.nations['826'][1];
  const england = build().doc.nations['826'][1];
  assert.equal(dupes, england + 2);
  assert.equal(audit.players.dropped.duplicates, 1);
  // Strong enough for England's XI: the copy at a club is kept, though the free agent copy has the higher CA.
  const strong = sampleDatabase({ birthYearShift: 6 });
  const copies = strong.people.filter(p => p.second === 'Catefake');
  copies.forEach((p, i) => { p.player.ca = 190 - i * 5; });
  const atClub = strong.people.findIndex(p => p.second === 'Catefake' && p.club >= 0);
  const kept = tuplesOf(build(strong).doc).filter(t => t[1] === 'Dupli Catefake');
  assert.deepEqual(kept.map(t => [t[0], t[3], t[6]]), [[atClub, 185, 'Lowerton United']]);
});

test('an unmapped nation stops the build unless allowed, and is then left out and reported', () => {
  const db = sampleDatabase({ birthYearShift: 6, unmapped: true });
  assert.throws(() => build(db), /CM nations with no game nation, and not listed as having no team: Fictionland \(2 players\)\. .*--allow-unmapped/);
  const { doc, audit, warnings, summary } = build(db, { allowUnmapped: true });
  assert.deepEqual(audit.unmapped, { Fictionland: 2 });
  assert.equal(audit.players.dropped.unmapped, 2);
  assert.ok(!tuplesOf(doc).some(t => t[5] === 'Fictionland'));
  assert.ok(warnings.includes('Left out the players of unmapped nations: Fictionland (2)'));
  assert.ok(summary.includes('Unmapped nations: Fictionland (2)'));
});

test('federations follow the set year: Montenegro with Serbia in 2005, its own in 2008', () => {
  const at = released => build(undefined, { identity: { ...identity, released } }).doc.territory;
  assert.deepEqual(at('2004-10'), { merged: { 499: '688', 728: '729' }, inactive: ['626', 'KOS'] });
  assert.deepEqual(at('2007-10'), { merged: { 728: '729' }, inactive: ['KOS'] });
});

test('clubs: the seven leagues by stored name or patcher alias, members by division, eleven players or none', () => {
  const { doc, audit } = build();
  assert.deepEqual(doc.clubs.map(c => [c.league, c.country]).sort(), Object.entries(LEAGUES).map(([league, { country }]) => [league, country]).sort());
  assert.equal(audit.leagues.find(l => l.league === 'La Liga').competition, 'Spanish La Liga');
  // Thinford Town has six players and the extinct Gone Athletic none: neither is a club of the set.
  assert.deepEqual(audit.leagues.find(l => l.league === 'Premier League').short, [{ name: 'Thinford Town', players: 6 }]);
  assert.ok(!doc.clubs.some(c => ['Thinford Town', 'Gone Athletic', 'Lowerton United'].includes(c.name)));
  for (const club of doc.clubs) {
    assert.equal(club.squad.length, 11, club.name);
    assert.match(club.code, /^[A-Z]{3}$/);
    assert.match(club.col, /^oklch\(0\.72 0\.16 \d+\)$/);
    const ratings = club.squad.map(t => expandCmTuple(t, doc.source)[2]);
    assert.equal(club.str, Math.round(ratings.reduce((s, r) => s + r, 0) / ratings.length));
  }
  const munich = doc.clubs.find(c => c.name === 'FC Dummy München');
  assert.deepEqual([munich.id, munich.code], ['f-fc-dummy-munchen', 'DMU']);
  assert.equal(new Set(doc.clubs.map(c => c.code)).size, doc.clubs.length);
  assert.deepEqual(doc.clubs.map(c => c.str), doc.clubs.map(c => c.str).sort((a, b) => b - a));
});

test('club ids stay unique when two names make the same slug', () => {
  const db = sampleDatabase({ birthYearShift: 6 });
  const spain = db.nations.findIndex(n => n.name === 'Spain');
  const club = db.clubs.push({ name: 'Testbury-Rovers', short: 'Testbury', nation: spain, division: db.clubs[1].division }) - 1;
  const outfield = [{ gk: 20 }, ...Array.from({ length: 10 }, () => ({ m: 20, centre: 20 }))];
  outfield.forEach((ratings, i) => db.people.push({ first: 'Slugo', second: `Clashfake${i}`, dob: { year: 1980, month: 1, day: 1 + i },
    nation: spain, club, job: 11, player: { ca: 40, ratings } }));
  const { doc, warnings } = build(db);
  const ids = doc.clubs.filter(c => /^Testbury.Rovers$/.test(c.name)).map(c => [c.name, c.id]);
  assert.deepEqual(ids, [['Testbury Rovers', 'f-testbury-rovers'], ['Testbury-Rovers', 'f-testbury-rovers-2']]);
  assert.ok(warnings.includes('Two clubs make the id f-testbury-rovers; the weaker is f-testbury-rovers-2'));
});

test('league detection: a patched name is found, a namesake of another nation is not, a missing league is reported', () => {
  const db = sampleDatabase({ birthYearShift: 6 });
  db.clubComps[0].name = 'English Premier League';
  const italy = db.clubComps.findIndex(c => c.name === 'Italian Serie A');
  db.clubComps[italy].nation = db.nations.findIndex(n => n.name === 'Spain');
  const { doc, audit, warnings } = build(db);
  assert.equal(audit.leagues.find(l => l.league === 'Premier League').competition, 'English Premier League');
  assert.ok(!doc.clubs.some(c => c.league === 'Serie A'));
  assert.ok(warnings.includes('No Serie A in this database: no Italian Serie A of Italy'));
  assert.equal(doc.coverage.leagues, 6);
});

test('two builds of one folder are byte for byte the same', () => {
  const a = build(), b = build();
  assert.equal(a.text, b.text);
  assert.equal(a.doc.version, b.doc.version);
  assert.deepEqual(a.audit, b.audit);
  // Format 1 and format 2 copies of one database make the same set.
  assert.equal(build(undefined, { write: { format: 1 } }).text, a.text);
});

test('the index lists sets newest season first and checks each version', () => {
  const sets = ['2004-10', '2007-10', '2008-03'].map(released => build(undefined, { identity: { ...identity, released } }).doc);
  const index = buildFootballIndex(sets);
  assert.equal(index.format, 1);
  assert.deepEqual(index.sets.map(s => s.id), ['cm0102-2008-03', 'cm0102-2007-10', 'cm0102-2004-10']);
  assert.deepEqual(Object.keys(index.sets[0]), ['id', 'version', 'year', 'season', 'label', 'provider', 'local', 'coverage']);
  const edited = structuredClone(sets[0]);
  edited.nations['826'][0] = 99;
  assert.throws(() => buildFootballIndex([edited]), /cm0102-2004-10 is not a format-1 football data set with a matching version/);
});

test('every set the builder writes loads in the game (decodeFootballSet)', () => {
  const files = writeCm0102Files(sampleDatabase({ birthYearShift: 6 }));
  const { clubSize, staffSize } = fileSignature(files);
  const known = { id: 'cm0102-2013-11', label: 'Fixture known', provider: 'Fixture makers', season: '2013/14', year: 2014, released: '2013-11',
    url: 'https://example.test/known', shifts: { birth: 6 }, signatures: [{ club: clubSize, staff: staffSize }] };
  const sets = [
    build(),
    build(sampleDatabase({ birthYearShift: 6, unmapped: true }), { allowUnmapped: true }),
    build(undefined, { identity: { ...identity, label: ' Padded ', provider: ' ', released: '2004-10' } }),
    build(undefined, { identity: { ...identity, season: '2099/00' } }),
    buildFootballSet(files, { databases: [known], nationMap, federations }),
  ];
  for (const { doc, text } of sets) {
    const decoded = decodeFootballSet(JSON.parse(text), doc.id);
    assert.equal(decoded.meta.version, doc.version);
    assert.deepEqual(Object.keys(decoded.rosters).sort(), Object.keys(NATIONS).sort());
    assert.deepEqual(decoded.clubs.map(c => c.id), doc.clubs.map(c => c.id));
    assert.deepEqual(decoded.territory, doc.territory);
  }
  assert.deepEqual([sets[2].doc.label, sets[2].doc.source.version, sets[2].doc.source.provider], ['CM 01/02 · Padded', 'Padded', 'CM 01/02 Update Team']);
  assert.equal(sets[3].doc.year, 2100);
});

// ---- The command line ----

const cli = path.join(root, 'scripts/build-football-set.mjs');
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const flags = Object.entries({ label: 'Fixture', released: '2007-10', url: 'https://example.test/fixture', 'dob-shift': '6' }).map(([k, v]) => `--${k}=${v}`);

function withFolder(fn, db = sampleDatabase({ birthYearShift: 6 })) {
  const dir = mkdtempSync(path.join(tmpdir(), 'football-set-'));
  try {
    const data = path.join(dir, 'Copy of the game', 'Data');
    mkdirSync(data, { recursive: true });
    for (const [name, bytes] of Object.entries(writeCm0102Files(db))) writeFileSync(path.join(data, name === 'staff.dat' ? 'Staff.dat' : name), bytes);
    return fn({ game: path.dirname(data), out: path.join(dir, 'football') });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the CLI writes the set, its audit and the index, and rebuilds the same bytes', () => {
  withFolder(({ game, out }) => {
    const first = run(`--cm0102=${game}`, `--out=${out}`, ...flags);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /National squads: 7\/170 complete natural XIs/);
    assert.match(first.stdout, /Clubs: 7 \(Premier League 1, La Liga 1/);
    assert.deepEqual(readdirSync(out).sort(), ['cm0102-2007-10.audit.json', 'cm0102-2007-10.json', 'index.json']);
    const text = readFileSync(path.join(out, 'cm0102-2007-10.json'), 'utf8');
    const doc = JSON.parse(text);
    assert.equal(text, `${JSON.stringify(doc)}\n`);
    assert.equal(decodeFootballSet(doc, 'cm0102-2007-10').meta.version, doc.version);
    assert.equal(JSON.parse(readFileSync(path.join(out, 'cm0102-2007-10.audit.json'), 'utf8')).version, doc.version);
    assert.deepEqual(JSON.parse(readFileSync(path.join(out, 'index.json'), 'utf8')), buildFootballIndex([doc]));
    assert.equal(run(`--cm0102=${game}`, `--out=${out}`, ...flags).status, 0);
    assert.equal(readFileSync(path.join(out, 'cm0102-2007-10.json'), 'utf8'), text);
    const check = run(`--cm0102=${game}`, `--out=${out}`, '--check', ...flags);
    assert.match(check.stdout, /Check only, nothing written: .*cm0102-2007-10\.json is up to date/);
    // A second set joins the index, newest first.
    assert.equal(run(`--cm0102=${game}`, `--out=${out}`, ...flags.map(f => f.replace('2007-10', '2004-10'))).status, 0);
    assert.deepEqual(JSON.parse(readFileSync(path.join(out, 'index.json'), 'utf8')).sets.map(s => s.id), ['cm0102-2007-10', 'cm0102-2004-10']);
  });
});

test('the CLI writes nothing with --check, and stops on what it cannot build', () => {
  withFolder(({ game, out }) => {
    const check = run(`--cm0102=${game}`, `--out=${out}`, '--check', ...flags);
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /would be new/);
    assert.ok(!existsSync(out));
    const unknown = run(`--cm0102=${game}`, `--out=${out}`);
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Unknown CM 01\/02 database .* --label=\.\.\./);
    const early = run(`--cm0102=${game}`, `--out=${out}`, ...flags, '--season=2000/01');
    assert.equal(early.status, 1);
    assert.match(early.stderr, /seasons ending before 2002 are refused/);
    const blank = run(`--cm0102=${game}`, `--out=${out}`, ...flags, '--label=  ');
    assert.equal(blank.status, 1);
    assert.match(blank.stderr, /Name it with --label=\.\.\. \(/);
    assert.match(run(`--cm0102=${path.dirname(game)}`, ...flags).stderr, /No index\.dat in .* or in a Data folder inside it/);
    assert.match(run(`--cm0102=${game}`, '--check=yes').stderr, /Unknown option --check=yes/);
    assert.match(run('--check').stderr, /Name the database folder: --cm0102=/);
    assert.ok(!existsSync(out));
    // A data set in the folder that this builder did not write stops the run before anything is written.
    mkdirSync(out);
    writeFileSync(path.join(out, 'cm0102-2004-10.json'), '{"format":1,"id":"cm0102-2004-10"}');
    const stale = run(`--cm0102=${game}`, `--out=${out}`, ...flags);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /cm0102-2004-10\.json is not a data set this builder wrote/);
    assert.deepEqual(readdirSync(out), ['cm0102-2004-10.json']);
  });
});

test('the CLI stops on an unmapped nation, and --allow-unmapped reports it instead', () => {
  withFolder(({ game, out }) => {
    const stopped = run(`--cm0102=${game}`, `--out=${out}`, ...flags);
    assert.equal(stopped.status, 1);
    assert.match(stopped.stderr, /Fictionland \(2 players\)/);
    const allowed = run(`--cm0102=${game}`, `--out=${out}`, '--allow-unmapped', ...flags);
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.match(allowed.stdout, /Unmapped nations: Fictionland \(2\)/);
    assert.deepEqual(JSON.parse(readFileSync(path.join(out, 'cm0102-2007-10.audit.json'), 'utf8')).unmapped, { Fictionland: 2 });
  }, sampleDatabase({ birthYearShift: 6, unmapped: true }));
});
