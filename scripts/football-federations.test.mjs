// The football federations of 1961/62 to 1995/96 (src/data/footballFederations.js; docs/design/football-years.md,
// 'Federations of the day'): the table against FIFA's own dates, territory and identities year by year, the CM 01/02
// builder fielding a federation's players under its name, the loader's rules for a season's identities, the historic
// flags, and a 1969/70 campaign played, drawn, flagged, saved and resumed as the Soviet Union.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { SAVE_KEY } from '../src/config.js';
import { FLAG_CODES } from '../src/data/flags.js';
import { FLAG_SYMBOLS } from '../src/data/flagSymbols.js';
import { FOOTBALL_FEDERATIONS as TABLE } from '../src/data/footballFederations.js';
import { namesOfTheDay } from '../src/data/namesOfTheDay.js';
import { CM0102_NATIONS } from '../src/data/cm0102Nations.js';
import {
  FIRST_YEAR, NO_TEAM, buildFootballSet, dayNationResolver, federationTeamOf, identitiesFor, nationResolver, territoryFor,
} from '../src/data/footballSetBuild.js';
import { HISTORIC_NATIONS, HISTORIC_THROUGH, NATIONS, buildTeam, makeRng, nationIdentity } from '../src/data/teams.js';
import { decodeFootballSet, fieldedNations, heldShapes, seasonSport } from '../src/engine/footballSets.js';
import { parseCampaign } from '../src/engine/storage.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { sampleDatabase, writeCm0102Files } from './lib/cm0102-fixture.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const SOVIET = ['804', '112', '268', '051', '031', '398', '860', '795', '762', '417', '498', '233', '428', '440'];
const BALTIC = ['233', '428', '440'];
const YUGOSLAV = ['191', '705', '070', '807', '499', 'KOS'];
const at = year => territoryFor(TABLE, year);
const holds = (year, holder) => Object.entries(at(year).merged).filter(([, h]) => h === holder).map(([shape]) => shape).sort();
const neutral = (year, shape) => at(year).inactive.includes(shape);
const plays = (year, shape) => !neutral(year, shape) && !Object.hasOwn(at(year).merged, shape);
const identity = (name, code, flagId) => ({ name, code, flagId });
const URS = identity('Soviet Union', 'URS', 'URS'), CIS = identity('CIS', 'CIS', 'CIS'), YUG = identity('Yugoslavia', 'YUG', 'YUG');
const FRY = identity('FR Yugoslavia', 'YUG', 'FRY'), TCH = identity('Czechoslovakia', 'TCH', '203');
const FRG = identity('West Germany', 'FRG', '276'), ZAI = identity('Zaire', 'ZAI', 'ZAI');

// ---------- the table ----------

test('every shape whose association joined FIFA after 30 June 1962 has FIFA\'s own date, read from its page', () => {
  assert.equal(FIRST_YEAR, 1962);
  const fifa = JSON.parse(read('scripts/data/fifa-member-associations.json')).associations;
  // East Germany's association (the DFV, a FIFA member until reunification) has no page of FIFA's today: it is a nation of the
  // map's earlier years only.
  assert.deepEqual(Object.keys(fifa).sort(), Object.keys(NATIONS).filter(id => !HISTORIC_NATIONS.includes(id)).sort(),
    'the snapshot covers every game nation on today\'s map');
  for (const [shape, entry] of Object.entries(TABLE.shapes)) {
    assert.ok(NATIONS[shape], shape);
    assert.equal(entry.fifa, fifa[shape].fifa, shape);
    assert.match(entry.member, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.member > '1962-06-30', `${shape} was a member by 1961/62's cutoff: it needs no entry`);
    assert.equal(entry.source, `https://inside.fifa.com/associations/${entry.fifa}`, shape);
    if (fifa[shape].unread) continue;
    // FIFA gives 1 January for a year alone; another source may give the day, in the same year.
    if (entry.dateSource) {
      assert.equal(fifa[shape].member, `${entry.member.slice(0, 4)}-01-01`, shape);
      assert.match(entry.dateSource, /^https:\/\/en\.wikipedia\.org\/w\/index\.php\?oldid=\d+$/);
    } else {
      assert.equal(entry.member, fifa[shape].member, shape);
    }
  }
  // South Africa's association was a member before 1962: its absences are suspensions, readmitted in 1992 (FIFA gives
  // the year of the new association alone).
  const missing = Object.entries(fifa).filter(([shape, row]) => row.member > '1962-06-30' && !TABLE.shapes[shape]).map(([shape]) => shape);
  assert.deepEqual(missing, ['710']);
  assert.equal(fifa['710'].member, '1992-01-01');
  assert.ok(TABLE.suspensions.some(s => s.shape === '710' && s.until === '1992-07-03'));
  assert.equal(Object.keys(TABLE.shapes).length, 79);
});

test('the federations of the day: FIFA\'s codes of the day, the flags the game has, game nations, sourced', () => {
  assert.deepEqual(TABLE.federations.map(f => [f.id, f.holder, f.from ?? null, f.through ?? null, f.members.length]), [
    ['URS', '643', null, 1991, 14], ['CIS', '643', 1992, 1992, 11], ['YUG', '688', null, 1991, 6], ['FRY', '688', 1992, 1996, 0],
    ['TCH', '203', null, 1993, 1], ['FRG', '276', null, 1990, 0], ['ZAI', '180', 1972, 1996, 0]]);
  for (const federation of TABLE.federations) {
    assert.ok(Object.hasOwn(FLAG_CODES, federation.flagId), federation.id);
    assert.ok(existsSync(new URL(`../public/flags/${FLAG_CODES[federation.flagId]}.svg`, import.meta.url)), federation.id);
    assert.match(federation.code, /^[A-Z]{3}$/);
    assert.match(federation.source, /^https:\/\/en\.wikipedia\.org\/w\/index\.php\?oldid=\d+$/);
    assert.ok(federation.members.every(shape => NATIONS[shape]), federation.id);
  }
  assert.deepEqual(TABLE.federations.find(f => f.id === 'URS').members.slice().sort(), SOVIET.slice().sort());
  assert.deepEqual(TABLE.federations.find(f => f.id === 'YUG').members.slice().sort(), YUGOSLAV.slice().sort());
  // The CIS team: the eleven CIS members and Georgia; not the Baltic states.
  assert.deepEqual(TABLE.federations.find(f => f.id === 'CIS').members.slice().sort(), SOVIET.filter(s => !BALTIC.includes(s)).sort());
  for (const suspension of TABLE.suspensions) {
    assert.ok(NATIONS[suspension.shape]);
    assert.match(suspension.source, /^https:\/\/en\.wikipedia\.org\/w\/index\.php\?oldid=\d+$/);
  }
  // East Germany is a nation of its own, on the map up to 1990 (src/engine/historicMap.js): no federation holds it.
  assert.deepEqual([HISTORIC_NATIONS, NATIONS['278'][0], HISTORIC_THROUGH['278']], [['278', 'RVN'], 'East Germany', 1990]);
  assert.ok(!TABLE.federations.some(federation => federation.holder === '278' || federation.members.includes('278')));
});

test('the table refuses what it cannot apply', () => {
  const shapes = {};
  const base = { shapes, federations: [], suspensions: [] };
  assert.throws(() => territoryFor({ ...base, federations: [{ id: 'X', name: 'X', code: 'XXX', flagId: '643', holder: '643', members: ['643'] }] }, 1970),
    /other than its holder/);
  assert.throws(() => territoryFor({ ...base, federations: [{ id: 'X', name: 'X', code: 'xx', flagId: '643', holder: '643', members: [] }] }, 1970),
    /three-capital code/);
  const urs = { id: 'URS', name: 'Soviet Union', code: 'URS', flagId: 'URS', holder: '643', through: 1991, members: ['804'] };
  assert.throws(() => territoryFor({ ...base, federations: [urs, { ...urs, id: 'CIS', from: 1991, through: 1992 }] }, 1970), /both play on 643/);
  assert.throws(() => territoryFor({ ...base, federations: [urs, { ...urs, id: 'UKR', holder: '804', members: [] }] }, 1970), /holds 804/);
  assert.throws(() => territoryFor({ ...base, suspensions: [{ shape: '710', from: '1964-06', until: '1992-07-03' }] }, 1970), /cutoff's month/);
  assert.throws(() => territoryFor({ ...base, suspensions: [{ shape: '710', from: '1964-10', until: '1964-01' }] }, 1970), /start before it ends/);
  assert.throws(() => territoryFor({ ...base, suspensions: [{ shape: '999', from: '1964-10' }] }, 1970), /not a game nation/);
});

// ---------- territory and identities, year by year ----------

test('1969/70: the Soviet Union holds Ukraine and the Baltic states, Yugoslavia its republics, Czechoslovakia Slovakia', () => {
  assert.deepEqual(holds(1970, '643'), SOVIET.slice().sort());
  assert.ok(['804', ...BALTIC].every(shape => at(1970).merged[shape] === '643'));
  assert.deepEqual(holds(1970, '688'), YUGOSLAV.slice().sort());
  assert.deepEqual(holds(1970, '203'), ['703']);
  assert.deepEqual(identitiesFor(TABLE, 1970), { 203: TCH, 276: FRG, 643: URS, 688: YUG });
  // China and South Africa are out of FIFA; DR Congo joined in 1964, but is Zaire only from 1971/72.
  assert.ok(neutral(1970, '156') && neutral(1970, '710') && plays(1970, '180'));
});

test('1973/74: Zaire plays under its own name and flag, and East Germany, with no shape, has no team', () => {
  assert.deepEqual(identitiesFor(TABLE, 1974)[180], ZAI);
  assert.equal(identitiesFor(TABLE, 1974)[276].name, 'West Germany');
  assert.ok(!identitiesFor(TABLE, 1971)[180] && identitiesFor(TABLE, 1972)[180] && identitiesFor(TABLE, 1996)[180] && !identitiesFor(TABLE, 1997)[180]);
});

test('1981/82: Yugoslavia holds Croatia; 1989/90: Czechoslovakia holds Slovakia, West Germany its last season', () => {
  assert.equal(at(1982).merged['191'], '688');
  assert.equal(identitiesFor(TABLE, 1982)[688].name, 'Yugoslavia');
  assert.equal(at(1990).merged['703'], '203');
  assert.equal(identitiesFor(TABLE, 1990)[203].name, 'Czechoslovakia');
  assert.equal(identitiesFor(TABLE, 1990)[276].name, 'West Germany');
  assert.ok(!identitiesFor(TABLE, 1991)[276], 'Germany from 1990/91');
  // Eritrea is Ethiopia's until May 1991; Bangladesh Pakistan's until December 1971.
  assert.equal(at(1990).merged['232'], '231');
  assert.ok(neutral(1991, '232'));
  assert.equal(at(1971).merged['050'], '586');
  assert.ok(neutral(1972, '050') && plays(1976, '050'));
});

test('1991/92: the CIS holds eleven republics, the Baltic states play, and no shape of the old Yugoslavia does', () => {
  assert.deepEqual(identitiesFor(TABLE, 1992), { 180: ZAI, 203: TCH, 643: CIS });
  assert.deepEqual(holds(1992, '643'), SOVIET.filter(s => !BALTIC.includes(s)).sort());
  assert.ok(BALTIC.every(shape => plays(1992, shape)));
  // Barred from 31 May 1992 (FR Yugoslavia's association), and Croatia and Slovenia FIFA members from 3 July 1992.
  assert.ok(['688', ...YUGOSLAV].every(shape => neutral(1992, shape)));
  assert.ok(neutral(1992, '710'), 'South Africa readmitted on 3 July 1992');
  assert.deepEqual(at(1991).merged['268'], '643', 'Georgia, the Soviet Union\'s in 1990/91');
});

test('1992/93 to 1995/96: Czechoslovakia to 1992/93, FR Yugoslavia barred to 1993/94, then under its own flag', () => {
  assert.deepEqual(holds(1993, '203'), ['703']);
  assert.ok(plays(1994, '203') && plays(1994, '703'), 'the Czech Republic and Slovakia from 1993/94');
  assert.ok(['191', '705', '804', '112', '268', '051'].every(shape => plays(1993, shape)));
  assert.ok(['031', '398', '417', '498', '762', '795', '860'].every(shape => neutral(1993, shape) && plays(1994, shape)), 'FIFA members from 1994');
  assert.ok(['688', '499', 'KOS'].every(shape => neutral(1993, shape) && neutral(1994, shape)));
  assert.ok(neutral(1993, '807') && plays(1994, '807'), 'North Macedonia joined on 16 June 1994');
  for (const year of [1995, 1996]) {
    assert.deepEqual(holds(year, '688'), ['499', 'KOS']);
    assert.deepEqual(identitiesFor(TABLE, year)[688], FRY);
    assert.ok(neutral(year, '070'), 'Bosnia joined FIFA on 3 July 1996');
  }
  assert.ok(plays(1993, '710'), 'South Africa from 1992/93');
});

test('suspensions: South Africa\'s two, China\'s absence', () => {
  const southAfrica = [1962, 1963, 1964, 1965, 1976, 1992, 1993].map(year => plays(year, '710'));
  assert.deepEqual(southAfrica, [false, true, true, false, false, false, true]);
  assert.ok([1962, 1970, 1979, 1980].every(year => neutral(year, '156')) && plays(1981, '156'));
});

test('every season 1961/62 to 1995/96 holds together, and none from 1996/97 has a federation of the day', () => {
  for (let year = FIRST_YEAR; year <= 1996; year++) {
    const { merged, inactive } = at(year);
    for (const [shape, holder] of Object.entries(merged)) {
      assert.ok(NATIONS[shape] && NATIONS[holder] && holder !== shape, `${year} ${shape}`);
      assert.ok(!inactive.includes(holder) && !Object.hasOwn(merged, holder), `${year}: ${shape}'s holder ${holder} plays`);
    }
    assert.equal(new Set(inactive).size, inactive.length);
    for (const holder of Object.keys(identitiesFor(TABLE, year))) assert.ok(plays(year, holder), `${year} ${holder}`);
  }
  for (let year = 1997; year <= 2030; year++) assert.deepEqual(identitiesFor(TABLE, year), {}, String(year));
  // A merged shape whose holder fields no team stays neutral: SWOS 94/95 has no FR Yugoslavia squad.
  const swos = territoryFor(TABLE, 1995, { fields: id => id !== '688' });
  assert.ok(['499', 'KOS'].every(shape => swos.inactive.includes(shape)) && !Object.hasOwn(swos.merged, '499'));
  assert.deepEqual(identitiesFor(TABLE, 1995, { fields: id => id !== '688' }), { 180: ZAI });
});

test('a federation of the day fields its members\' players, and a nation named after it plays for its holder in its years', () => {
  const ids = { merged: at(1970).merged };
  const teamOf = federationTeamOf(identitiesFor(TABLE, 1970), ids);
  assert.deepEqual(['804', '440', '191', '703', '540', '250'].map(teamOf), ['643', '643', '688', '203', '540', '250'],
    'New Caledonia, held by France with no identity, keeps its players apart as before');
  const resolve = nationResolver(CM0102_NATIONS);
  const of = year => dayNationResolver(resolve, TABLE, year);
  assert.deepEqual(['Soviet Union', 'Czechoslovakia', 'West Germany', 'Zaire', 'Commonwealth of Soviet States', 'East Germany'].map(of(1970)),
    ['643', '203', '276', NO_TEAM, NO_TEAM, '278']);
  assert.deepEqual(['Zaire', 'Commonwealth of Soviet States', 'Soviet Union'].map(of(1992)), ['180', '643', NO_TEAM]);
  assert.deepEqual(['Soviet Union', 'Czechoslovakia', 'West Germany', 'Zaire', 'Russia'].map(of(1997)), [NO_TEAM, NO_TEAM, NO_TEAM, NO_TEAM, '643']);
});

// ---------- a CM 01/02 season of 1969/70 ----------

const R = (pos, side) => ({ ...(pos === 'gk' ? { gk: 20 } : { [pos]: 20 }), ...(side ? { [side]: 20 } : {}) });
const XI = [R('gk'), R('d', 'right'), R('d', 'centre'), R('d', 'centre'), R('d', 'left'),
  R('m', 'right'), R('m', 'centre'), R('m', 'centre'), R('m', 'left'), R('f', 'centre'), R('f', 'centre')];

/** The fixture database with eleven Russians, eleven stronger Ukrainians, two 'Soviet Union' players, eleven Croats,
 * eleven Slovaks and two players of SI's 'Zaire'. */
function databaseOf1970() {
  const db = sampleDatabase();
  const europe = db.continents.findIndex(c => c.name === 'Europe'), africa = db.continents.findIndex(c => c.name === 'Africa');
  const nation = (name, continent = europe) => db.nations.findIndex(n => n.name === name) + 1
    || db.nations.push({ name, short: name, code: name.slice(0, 3).toUpperCase(), continent });
  const index = name => db.nations.findIndex(n => n.name === name);
  let serial = 0;
  const squad = (name, size, ca, continent) => {
    nation(name, continent);
    for (let i = 0; i < size; i++) {
      serial++;
      db.people.push({ first: 'Histo', second: `${name.replace(/\W/g, '')}${String(serial).padStart(3, '0')}`,
        dob: { year: 1940 + (serial % 10), month: 1 + (serial % 12), day: 1 + (serial % 27), leap: 0 }, nation: index(name),
        club: -1, job: 11, player: { ca: ca - i, ratings: XI[i % 11] } });
    }
  };
  squad('Russia', 11, 120);
  squad('Ukraine', 11, 160);
  squad('Croatia', 11, 150);
  squad('Slovakia', 11, 140);
  squad('Zaire', 2, 100, africa);
  // SI's placeholder names, in the sample already (with no players): two of the Soviet Union's.
  const soviet = index('Soviet Union');
  for (let i = 0; i < 2; i++) db.people.push({ first: 'Histo', second: `Sovietski${i}`, dob: { year: 1945, month: 3, day: 3 + i, leap: 0 },
    nation: soviet, club: -1, job: 11, player: { ca: 190, ratings: XI[9] } });
  return db;
}
const build = (released, id = `cm0102-${released}-fixture`) => buildFootballSet(writeCm0102Files(databaseOf1970()),
  { identity: { label: `Fixture ${released}`, released, url: 'https://example.test/historic', dobShift: 0, id } });

test('the CM 01/02 builder plays the Soviet Union with its Ukrainians, under its own name; 1996/97 as before', () => {
  const { doc, audit } = build('1970-05');
  assert.deepEqual([doc.year, doc.season], [1970, '1969/70']);
  assert.deepEqual(doc.territory, territoryFor(TABLE, 1970));
  assert.deepEqual(doc.identities, { 203: TCH, 276: FRG, 643: URS, 688: YUG });
  const names = id => doc.nations[id][2].map(tuple => tuple[1]);
  assert.ok(names('643').some(name => name.startsWith('Histo Ukraine')), 'Ukrainians play for the Soviet Union');
  assert.ok(names('643').some(name => name.startsWith('Histo Sovietski')), 'and so do SI\'s Soviet Union players');
  assert.deepEqual(doc.nations['804'], [40, 0, []], 'Ukraine fields no team of its own');
  assert.ok(names('688').some(name => name.startsWith('Histo Croatia')) && names('203').some(name => name.startsWith('Histo Slovakia')));
  assert.deepEqual(audit.federations.pooled, { 643: { 804: 11 }, 688: { 191: 11 }, 203: { 703: 11 } }, 'whose players each fields');
  assert.equal(audit.noTeam.Zaire, 2, 'before 1971/72 SI\'s Zaire is DR Congo by another name, with no team');
  assert.ok(decodeFootballSet(doc), 'the loader takes it');

  const zaire = build('1975-05').doc;
  assert.equal(zaire.identities[180].name, 'Zaire');
  assert.equal(zaire.nations['180'][1], 2);
  const shipped = build('1996-09').doc;
  assert.ok(!('identities' in shipped));
  assert.ok(shipped.nations['804'][2].length && shipped.nations['703'][2].length, 'Ukraine and Slovakia play for themselves');
  assert.deepEqual(shipped.nations['643'][1], 11, 'SI\'s Soviet Union placeholders have no team');
});

// ---------- the loader and the season's sport ----------

const SEASON = build('1970-05').doc;

test('the loader refuses identities a season does not field, or that are not a name, a three-capital code and a flag', () => {
  const refuses = (identities, pattern) => assert.throws(() => decodeFootballSet({ ...SEASON, identities }, SEASON.id), pattern);
  refuses({}, /at least one nation/);
  refuses([], /at least one nation/);
  // Ukraine is merged into the Soviet Union, China out of FIFA, Luxembourg without a player.
  refuses({ 804: URS }, /identities\[804\] names no nation the season fields/);
  refuses({ 156: URS }, /identities\[156\] names no nation/);
  refuses({ 442: identity('Luxembourg FA', 'LUF', '442') }, /identities\[442\] names no nation/);
  refuses({ 643: { ...URS, code: 'urs' } }, /code "urs" must be three capitals/);
  refuses({ 643: { ...URS, code: 'UR1' } }, /must be three capitals/);
  refuses({ 643: { ...URS, flagId: 'SUN' } }, /flag "SUN" is not one the game has/);
  refuses({ 643: { ...URS, name: ' ' } }, /has no name/);
  refuses({ 643: { ...URS, colour: '#c00' } }, /must be \{ name, code, flagId \}/);
  refuses({ 643: { ...URS, code: 'ENG' } }, /code ENG is 826's too/);
  refuses({ 643: { ...URS, name: 'england' } }, /name "england" is 826's too/);
  refuses({ 643: URS, 688: { ...YUG, code: 'URS' } }, /identities\[688\] code URS is 643's too/);
  // Only men's football: a tennis season may not.
  const tennis = readdirSync(new URL('../public/tennis/', import.meta.url)).find(file => /^tennis-\d{4}\.json$/.test(file));
  const season = JSON.parse(read(`public/tennis/${tennis}`));
  assert.throws(() => decodeFootballSet({ ...season, identities: { 643: URS } }, season.id), /only a men's football season/);
});

test('a season with identities plays the Soviet Union on Russia\'s shape, under its own name, code and flag', () => {
  const set = decodeFootballSet(SEASON);
  assert.ok(Object.isFrozen(set.meta.identities) && Object.isFrozen(set.meta.identities[643]));
  assert.notEqual(set.meta.identities, SEASON.identities, 'a copy: the sport cannot change the file');
  const sport = seasonSport(set);
  // The file's own identities, over the names of the day the game knows for its year (src/data/namesOfTheDay.js).
  assert.deepEqual(sport.playsAs, { ...namesOfTheDay('football', SEASON.year), ...SEASON.identities });
  assert.deepEqual(nationIdentity('643', sport), URS);
  assert.deepEqual(nationIdentity('688', sport), YUG);
  assert.deepEqual(nationIdentity('276', sport), FRG);
  assert.deepEqual(nationIdentity('250', sport), identity('France', 'FRA', '250'), 'everyone else as ever');
  const team = buildTeam('643', makeRng(1), sport);
  assert.deepEqual([team.id, team.name, team.code, team.flagId, team.home], ['643', 'Soviet Union', 'URS', 'URS', '643']);
  assert.ok(fieldedNations(sport).includes('643') && !fieldedNations(sport).includes('804'));
  assert.ok(heldShapes(sport).some(([shape, holder]) => shape === '428' && holder === '643'), 'Latvia starts in its empire');
  // The built-in football sport has no identities.
  assert.equal(nationIdentity('643').name, 'Russia');
});

test('the historic flags are vendored, and the Soviet, Yugoslav, Zairean and CIS emblems keep their shape on the map', () => {
  for (const [flagId, file] of [['URS', 'su'], ['CIS', 'cis-1992'], ['YUG', 'yu'], ['FRY', 'yu-1992'], ['ZAI', 'zr']]) {
    assert.equal(FLAG_CODES[flagId], file);
    const svg = read(`public/flags/${file}.svg`);
    assert.match(svg, new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" id="flag-historic-${file}" viewBox="0 0 640 480">`));
    assert.equal(!!FLAG_SYMBOLS[file], file !== 'yu-1992', `${file}: an emblem to keep upright, or plain bands`);
  }
  const manifest = JSON.parse(read('scripts/data/historic-flags.json'));
  for (const flag of manifest.flags) {
    // Public domain, or (where Commons has no public-domain drawing: Spain's and Bulgaria's arms, Rhodesia's flag of 1964)
    // CC BY-SA with its author, credited in public/flags/SOURCES-historic.tsv.
    assert.match(flag.licence, /^(Public domain|CC BY-SA \d\.\d( \(or GFDL 1\.2 or later, at the reuser's choice\))?, by \S)/);
    assert.match(flag.commons.page, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.ok(Number.isInteger(flag.commons.revision));
    assert.match(flag.sha256, /^[0-9a-f]{64}$/);
  }
});

// ---------- in the running game ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
  clearFootballSetIndex: ['src/engine/footballSets.js', 'clearFootballSetIndex'],
}, { jsx: 'automatic' });

test('a 1969/70 campaign shows the Soviet Union on the setup wall, the map, its flag and labels, and in a resumed save', async () => {
  const url = `/football/${SEASON.id}.json`;
  const index = { format: 1, sets: [{ id: SEASON.id, version: SEASON.version, year: SEASON.year, season: SEASON.season, label: SEASON.label,
    provider: SEASON.source.provider, local: true, coverage: SEASON.coverage }] };
  const files = { '/football/index.json': index, [url]: SEASON };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: async request => {
    const body = files[String(request)];
    return body ? { ok: true, status: 200, json: async () => structuredClone(body) } : { ok: false, status: 404, json: async () => ({}) };
  } });
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  const ids = ['643', '804', '428', '688', '191', '276', '250'];
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids,
    settings: { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', role: 'manager', managedTeamId: '643', seed: '7' } });
  f.app.opening = B.App.prototype.opening;
  try {
    const { app, items, time } = f;
    await app.requestSeasons();
    app.pickSetup('dataSet', SEASON.id);
    time.advance(200);
    await app.loadSet(SEASON.id);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.seasonStatus().state, 'ready');
    // The setup wall lists it under its own name and flag.
    const wall = app.setupTeams();
    const soviet = wall.find(team => team.id === '643');
    assert.deepEqual([soviet.name, soviet.code, soviet.flagId], ['Soviet Union', 'URS', 'URS']);
    assert.ok(!wall.some(team => team.id === '804'), 'Ukraine fields no team');
    const model = buildSetupModel(app.state.setup, { managerTeams: wall, season: app.seasonStatus() });
    assert.deepEqual([model.managed.name, model.managed.flagId], ['Soviet Union', 'URS']);

    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.teams['643'].name, st.teams['643'].code, st.teams['643'].flagId], ['Soviet Union', 'URS', 'URS']);
    assert.deepEqual([st.teams['688'].name, st.teams['688'].flagId], ['Yugoslavia', 'YUG']);
    assert.deepEqual([st.teams['276'].name, st.teams['276'].code, st.teams['276'].flagId], ['West Germany', 'FRG', '276']);
    assert.ok(['804', '428'].every(shape => st.own[shape] === '643') && st.own['191'] === '688', 'the federations hold their members');
    assert.equal(st.campaignName, 'Football 1969/70 · Europe · Soviet Union');
    assert.deepEqual(app.mapLabels(true).find(label => label.id === '643'), { id: '643', text: 'SOVIET UNION' });
    app.geo.fitTo = () => {};
    B.App.prototype.fitMap.call(app, ids);
    app.setState({ mapMode: 'flags' });
    const banner = app.mapFlags(true).flagPatterns.find(pattern => pattern.ownerId === '643');
    assert.equal(banner.url, '/flags/su.svg');
    assert.deepEqual(banner.symbolProfile, FLAG_SYMBOLS.su, 'the hammer and sickle stays upright');
    app.setState({ hoverCid: '804' });
    assert.deepEqual([app.tooltip(true).name, app.tooltip(true).held], ['Ukraine', 'Held by Soviet Union'], 'the land keeps its name');

    // The checkpoint keeps the identity, and the campaign resumes with no data set.
    const text = items.get(SAVE_KEY);
    B.clearFootballSetCache();
    delete files[url];
    const saved = parseCampaign(text);
    assert.deepEqual([saved.teams['643'].name, saved.teams['643'].code, saved.teams['643'].flagId], ['Soviet Union', 'URS', 'URS']);
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.deepEqual([app.state.teams['643'].name, app.state.teams['643'].flagId], ['Soviet Union', 'URS']);
    assert.equal(app.state.settings.dataSet, SEASON.id);
  } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
});
