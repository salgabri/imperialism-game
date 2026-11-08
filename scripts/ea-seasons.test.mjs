// The built-in earlier football seasons (docs/design/football-years.md): EA player tuples (src/data/eaPlayers.js), the
// season builders (scripts/lib/ea-seasons.mjs for FIFA 15 – EA FC 24, scripts/lib/ea-legacy-seasons.mjs for FIFA 07 –
// FIFA 14, scripts/lib/ea-early-seasons.mjs for FIFA 05 and FIFA 06) on invented rows, saves of an EA season campaign, and
// the committed files in public/football/ checked against their listing (src/data/footballSeasons.js), their own content
// hash and the manifest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NATIONS } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { EA_ROLES, eaRosterOf, eaTupleOf, expandEaTuple } from '../src/data/eaPlayers.js';
import { BUILT_IN_SEASONS } from '../src/data/footballSeasons.js';
import { contentHash } from '../src/data/footballSetBuild.js';
import { BUILT_IN_SETS, decodeFootballSet, setHasClubs, setHasNations, setKindOf, setSportOf, sportOf } from '../src/engine/footballSets.js';
import { dataSetOf } from '../src/app/shared.js';
import { parseCampaign, serializeCampaign } from '../src/engine/storage.js';
import { sourceLabel, sourceTitle, sourceUrl } from '../src/viewModels/squad.js';
import { EA_LEAGUES, EA_NATION_ALIASES, EA_NO_TEAM, buildEaSeason } from './lib/ea-seasons.mjs';
import {
  EARLY_EXTRA_FIELDS, WIKIDATA_COUNTRIES, buildEarlyEaSeason, eaCountryName, inLaterEdition, knownNationality, laterFromExport, laterFromScrape,
  nameWords, namesAgree, nationalityEntries, samePerson, teamCountry, wikidataNationality,
} from './lib/ea-early-seasons.mjs';
import {
  LEGACY_POSITIONS, buildLegacyEaSeason, isoDate, legacyExclusions, legacyPositionKeys, readClubRows, readRatingsRows, rosterDate,
  rosterDates,
} from './lib/ea-legacy-seasons.mjs';

const MANIFEST = JSON.parse(readFileSync(new URL('./data/ea-seasons.json', import.meta.url), 'utf8'));
const EDITION = { id: 'ea-fifa-18', fifaVersion: 18, edition: 'FIFA 18', update: 2 };
const DATASET = 'https://example.test/ea-export';
const SOURCE = { provider: 'EA Sports', edition: 'FIFA 18', update: 2, roster: '180002', snapshotDate: '2017-09-18', url: DATASET, rawScale: 99 };

// ---------- invented rows, in the export's columns ----------

let nextId = 1;
/** One invented player row of FIFA 18's launch roster; `over` replaces any field. */
function row(over = {}) {
  const id = String(nextId++);
  return { player_id: id, player_url: `/player/${id}/fake-player-${id}/180002`, fifa_version: '18.0', fifa_update: '2.0',
    update_as_of: '2017-09-18', short_name: `F. Player${id}`, long_name: `Fake Player${id}`, player_positions: 'ST', overall: '70',
    dob: '1990-01-01', club_team_id: '', club_name: '', league_id: '', nationality_name: 'England', ...over };
}
const XI = ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'RM', 'ST', 'ST'];
/** An invented XI: a natural 4-4-2, each row given `over`. */
const eleven = (over = {}) => XI.map((position, i) => row({ player_positions: position, overall: String(60 + i), ...over }));

function sampleRows() {
  nextId = 1;
  return [
    // England, in a Premier League club EA's later editions file under "Championship" (league id 13 all the same).
    ...eleven({ club_team_id: '501', club_name: 'Testford United', league_id: '13.0' }),
    // A Spanish club short of a natural XI.
    ...['GK', 'CB', 'CM', 'ST', 'ST'].map(position => row({ player_positions: position, club_team_id: '502', club_name: 'Real Ficticio',
      league_id: '53.0', nationality_name: 'Spain' })),
    // An old spelling, a nation without a shape, a free agent and a player at a club outside the seven leagues.
    ...['GK', 'CB', 'ST'].map(position => row({ player_positions: position, nationality_name: 'Czech Republic' })),
    row({ nationality_name: 'Malta', club_team_id: '501', club_name: 'Testford United', league_id: '13.0', player_positions: 'CAM, ST' }),
    row({ nationality_name: 'Malta' }),
    // A home nation plays for itself, not for England.
    row({ nationality_name: 'Scotland', player_positions: 'CB' }),
    row({ nationality_name: 'France', club_team_id: '900', club_name: 'Elsewhere FC', league_id: '68.0' }),
    // An absolute SoFIFA link, as older rows of the export have.
    row({ nationality_name: 'France', player_url: 'https://sofifa.com/player/77/absolute-link/180002', player_id: '77', dob: '' }),
    // Another edition's row is never read.
    row({ fifa_version: '15.0', update_as_of: '2014-09-18', player_url: '/player/999/other-edition/150002', player_id: '999' }),
  ];
}

// ---------- EA tuples ----------

test('an EA tuple expands into EA\'s own record, rating unchanged, and folds back exactly', () => {
  const tuple = [167948, 'H. Lloris', 'Hugo Lloris', 88, 'GK', 'France', 'Tottenham Hotspur', '1986-12-26', 'hugo-lloris'];
  const [name, pos, rating, info] = expandEaTuple(tuple, SOURCE);
  assert.deepEqual([name, pos, rating], ['H. Lloris', 'GK', 88]);
  assert.deepEqual(info, { id: 'ea:167948', fullName: 'Hugo Lloris', positions: ['GK'], source: 'ea-fc', edition: 'FIFA 18', update: 2,
    snapshotDate: '2017-09-18', url: 'https://sofifa.com/player/167948/hugo-lloris/180002', rawRating: 88, rawScale: 99,
    nationality: 'France', club: 'Tottenham Hotspur', dateOfBirth: '1986-12-26', naturalPositions: ['GK'] });
  assert.deepEqual(eaTupleOf(name, info), tuple);
  assert.equal(eaRosterOf(info.url), '180002');

  // A winger is a forward, a wing-back a defender; no date of birth stays absent; a full name equal to the name is 0.
  const [, wingerPos, , winger] = expandEaTuple([5, 'Winger', 0, 77, 'RW,RM', 'Brazil', '', '', 'winger'], SOURCE);
  assert.deepEqual([wingerPos, winger.positions, winger.fullName, 'dateOfBirth' in winger], ['FW', ['FW', 'MF'], 'Winger', false]);
  assert.deepEqual(eaTupleOf('Winger', winger), [5, 'Winger', 0, 77, 'RW,RM', 'Brazil', '', '', 'winger']);
  assert.deepEqual(Object.keys(EA_ROLES), ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'CF']);

  for (const bad of [[5, 'X', 0, 100, 'ST', 'Brazil', '', '', 'x'], [5, 'X', 0, 70, 'SW', 'Brazil', '', '', 'x'], [5, '', 0, 70, 'ST', 'Brazil', '', '', 'x'],
    [5, 'X', 0, 70, 'ST', 'Brazil', '', '', 'Not A Slug'], ['5', 'X', 0, 70, 'ST', 'Brazil', '', '', 'x']]) {
    assert.throws(() => expandEaTuple(bad, SOURCE), /Invalid EA tuple/);
  }
  // A record from another source, or whose link names another player, has no EA tuple.
  assert.equal(eaTupleOf('H. Lloris', { ...info, source: 'cm0102' }), null);
  assert.equal(eaTupleOf('H. Lloris', { ...info, url: 'https://sofifa.com/player/1/hugo-lloris/180002' }), null);
  assert.equal(eaTupleOf('H. Lloris', { ...info, url: 'https://sofifa.com/player/167948/hugo-lloris/180002/' }), null);
});

// ---------- the builder ----------

test('a season is one edition\'s roster: nations by nationality, clubs by EA\'s league id, territory of its year', () => {
  const { doc, text, audit, warnings } = buildEaSeason(sampleRows(), EDITION, { dataset: DATASET });
  assert.deepEqual([doc.format, doc.kind, doc.id, doc.year, doc.season, doc.label, doc.local], [1, 'ea', 'ea-fifa-18', 2018, '2017/18', 'FIFA 18', false]);
  assert.deepEqual(doc.source, SOURCE);
  assert.equal(doc.version, `ea-fifa-18-${contentHash(doc)}`);
  assert.equal(text, `${JSON.stringify(doc)}\n`);

  // England fields its eleven, Czechia (EA's "Czech Republic") its three; nobody is invented.
  assert.equal(doc.nations['826'][2].length, 11);
  assert.deepEqual(doc.nations['203'][2].map(tuple => tuple[5]), ['Czech Republic', 'Czech Republic', 'Czech Republic']);
  assert.deepEqual(doc.nations['442'], [40, 0, []], 'a nation with no players is empty');
  assert.equal(Object.keys(doc.nations).length, Object.keys(NATIONS).length, 'every nation has an entry');
  assert.deepEqual(audit.noTeam, { Malta: 2 }, 'Malta has no shape, so no team');
  assert.ok(!Object.values(doc.nations).some(([, , squad]) => squad.some(tuple => tuple[5] === 'Malta')));
  assert.deepEqual(doc.nations.SCO[2].map(tuple => tuple[5]), ['Scotland']);
  const slugs = doc.nations['250'][2].map(tuple => tuple[8]).sort();
  assert.ok(slugs.length === 2 && slugs[0] === 'absolute-link' && /^fake-player-\d+$/.test(slugs[1]), `both link forms: ${slugs}`);

  // Clubs: the Premier League club, with the Scot it signed; the Spanish club is short of eleven and left out.
  assert.deepEqual(doc.clubs.map(club => [club.id, club.name, club.code, club.league, club.country]),
    [['f-testford-united', 'Testford United', 'TUN', 'Premier League', '826']]);
  assert.equal(doc.clubs[0].squad.length, 11);
  assert.deepEqual(audit.leagues['La Liga'], { clubs: 0, short: [{ name: 'Real Ficticio', players: 5 }] });
  assert.ok(warnings.includes('No La Liga clubs in FIFA 18'));
  assert.deepEqual(doc.coverage, { players: 23, nations: 5, completeXIs: 1, clubs: 1, leagues: 1 });
  assert.deepEqual(doc.territory, { merged: {}, inactive: [] }, 'every federation of the map was a FIFA member by mid-2018');
  assert.deepEqual(buildEaSeason(sampleRows(), { id: 'ea-fifa-15', fifaVersion: 15, edition: 'FIFA 15', update: 2 }, { dataset: DATASET })
    .doc.territory.inactive, ['KOS'], 'Kosovo joined FIFA in May 2016');

  // The loader takes what the builder writes, every player rebuilt from its tuple.
  const set = decodeFootballSet(structuredClone(doc));
  assert.deepEqual(set.rosters['826'][2][0][3].edition, 'FIFA 18');
  assert.deepEqual(set.clubs[0].squad.map(player => player[0]), doc.clubs[0].squad.map(tuple => tuple[1]));
  assert.equal(buildEaSeason(sampleRows(), EDITION, { dataset: DATASET }).text, text, 'the same rows build the same file');
});

test('the builder stops rather than guess', () => {
  const build = rows => buildEaSeason(rows, EDITION, { dataset: DATASET });
  assert.throws(() => build([...sampleRows(), row({ nationality_name: 'Fictionland' }), row({ nationality_name: 'Fictionland' })]),
    /FIFA 18: nationalities with no game nation, and not listed as having no team: Fictionland \(2 players\)\. Add them to EA_NATION_ALIASES or EA_NO_TEAM/);
  assert.throws(() => build([...sampleRows(), row({ update_as_of: '2017-10-01' })]), /roster dates 2017-09-18, 2017-10-01, not one/);
  assert.throws(() => build([...sampleRows(), row({ player_url: '/player/4242/other-roster/180003', player_id: '4242' })]), /rows from rosters 180002, 180003, not one/);
  assert.throws(() => build([...sampleRows(), row({ player_url: '/player/1/someone-else/180002' })]), /links to/);
  assert.throws(() => build([...sampleRows(), row({ player_positions: 'SW' })]), /has positions SW/);
  assert.throws(() => build([...sampleRows(), row({ overall: '0' })]), /has overall 0/);
  assert.throws(() => build([...sampleRows(), row({ dob: '18/09/1990' })]), /has date of birth/);
  const twice = sampleRows();
  assert.throws(() => build([...twice, { ...twice[0] }]), /repeated player id/);
  assert.throws(() => buildEaSeason(sampleRows(), { ...EDITION, update: 5 }, { dataset: DATASET }), /no rows of roster update 5/);
  assert.throws(() => buildEaSeason(sampleRows(), { ...EDITION, id: 'fifa-18' }, { dataset: DATASET }), /not like ea-fifa-15/);
});

test('the nation map names only game nations, and keeps every name EA spells differently', () => {
  const names = new Set(Object.values(NATIONS).map(nation => nation[0]));
  for (const [ea, game] of Object.entries(EA_NATION_ALIASES)) assert.ok(names.has(game), `${ea} → ${game} is a game nation`);
  for (const name of EA_NO_TEAM) assert.ok(!names.has(EA_NATION_ALIASES[name] || name), `${name} has no shape`);
  // Built-in leagues, so a club reads the same in every season.
  const leagues = new Set(getSport('football').clubs.map(club => club.league));
  for (const [league] of Object.values(EA_LEAGUES)) assert.ok(leagues.has(league), league);
});

// ---------- the FIFA 07 – FIFA 14 builder, on invented rows ----------

// What a decoder writes for bytes it could not read.
const GARBLED = String.fromCharCode(0xfffd);
const LEGACY_EDITION = {
  id: 'ea-fifa-09', fifaVersion: 9, edition: 'FIFA 09', ratings: { roster: '090001' }, clubs: { roster: '090002' },
  leagues: { 'Premier League': ['Test Premier League'], 'La Liga': ['Test Primera'], 'Serie A': ['Test Serie A'], Bundesliga: ['Test Bundesliga'],
    'Ligue 1': ['Test Ligue 1'], Eredivisie: ['Test Eredivisie'], 'Liga Portugal': ['Test Liga', 'Test Liga Sagres'] },
};
// SoFIFA's FIFA 09 dates: the launch roster (090001) and the winter one (090002).
const LEGACY_DATES = rosterDates({ data: [['Aug 30, 2008', 0, 0, 0, 0, '', 'FIFA 09'], ['Feb 22, 2009', 0, 0, 0, 0, '', 'FIFA 09']] });
const LEGACY_OPTIONS = { ratingsUrl: 'https://example.test/ratings', clubsUrl: 'https://example.test/clubs', dates: LEGACY_DATES };
const LEGACY_SOURCE = { provider: 'EA Sports', edition: 'FIFA 09', update: 2, roster: '090002', snapshotDate: '2009-02-22', ratingsDate: '2008-08-30',
  url: 'https://example.test/ratings', clubsUrl: 'https://example.test/clubs', rawScale: 99 };

let legacyId = 1;
/** One invented player: his ratings row (FIFA Index's columns) and his clubs row (SoFIFA's, with a `bov` never read). */
function legacyPlayer({ id, positions = 'ST', rating = '70', dob = '01/01/1990', fullName, name, nationality = 'England', club = '', league = '',
  roster = '090002' } = {}) {
  const eaId = String(id ?? legacyId++);
  return {
    rating: { id: eaId, Fullname: fullName ?? `Invented Player${eaId}`, current_rating: rating, birth_date: dob, preferred_positions: positions },
    club: { sofifa_id: eaId, player_url: `/player/${eaId}/invented-player-${eaId}/${roster}/`, short_name: name ?? `I. Player${eaId}`,
      nationality, club_name: club, league_name: league, bov: '99' },
  };
}
const LEGACY_XI = ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'RM', 'ST', 'ST'];
/** An invented club of eleven, a natural 4-4-2, in one of the table's leagues. */
const legacyClub = (club, league, nationality, codes = LEGACY_XI) => codes.map((positions, i) => legacyPlayer({ positions, rating: String(60 + i), nationality, club, league }));

function legacySample() {
  legacyId = 1;
  return [
    // England's eleven, in FIFA Index's old codes: a sweeper, the wide midfielders and a right forward.
    ...legacyClub('Testford United', 'Test Premier League', 'England', ['GK', 'LB', 'CB-SW', 'SW', 'RB', 'LWM', 'CM', 'CM', 'RWM-RM', 'RF-ST', 'ST']),
    ...legacyClub('Real Ficticio', 'Test Primera', 'Spain'),
    ...legacyClub('Inventus', 'Test Serie A', 'Italy'),
    ...legacyClub('FC Erfunden', 'Test Bundesliga', 'Germany'),
    ...legacyClub('Olympique Imaginaire', 'Test Ligue 1', 'France'),
    ...legacyClub('Verzonnen FC', 'Test Eredivisie', 'Netherlands'),
    ...legacyClub('Inventado FC', 'Test Liga Sagres', 'Portugal'),
    // Liga Portugal's other name: a club short of eleven.
    legacyPlayer({ id: 808, nationality: 'Portugal', club: 'Sagres Club', league: 'Test Liga' }),
    // In one file only: left out, nothing borrowed.
    { rating: legacyPlayer({ id: 801, rating: '90', nationality: 'Brazil' }).rating },
    { club: legacyPlayer({ id: 802, nationality: 'Brazil' }).club },
    // EA's stand-in under an invented name, excluded by the manifest's list.
    legacyPlayer({ id: 900, fullName: 'Invented Standin', rating: '85', nationality: 'Romania', club: 'Inventus', league: 'Test Serie A' }),
    // A nation without a shape, an old spelling, a club outside the table's leagues and a date of birth to convert.
    legacyPlayer({ id: 803, nationality: 'Turks and Caicos Islands' }),
    legacyPlayer({ id: 804, nationality: 'Czech Republic', club: 'Elsewhere FC', league: 'Test Serie B', dob: '04/01/1977' }),
    // A short name equal to the full name, and a short name the scrape garbled.
    legacyPlayer({ id: 805, nationality: 'Ghana', fullName: 'Kofi', name: 'Kofi' }),
    legacyPlayer({ id: 806, nationality: 'Latvia', fullName: 'Aleksejs Invented', name: `A. Inv${GARBLED} nted` }),
  ];
}
const EXCLUSIONS = legacyExclusions([{ player: 'Someone Real', evidence: 'the same EA id names him in another edition',
  records: [{ edition: 'FIFA 09', eaId: 900, name: 'Invented Standin' }] }]);
/** The sample as the builder takes it: the two files' rows. */
const legacyInput = (players = legacySample()) => ({ ratings: players.filter(p => p.rating).map(p => p.rating), clubs: players.filter(p => p.club).map(p => p.club) });
const buildLegacy = (input = legacyInput(), edition = LEGACY_EDITION, options = {}) => buildLegacyEaSeason(input, edition, { ...LEGACY_OPTIONS, exclusions: EXCLUSIONS, ...options });

test('an old season joins its two files by EA id: EA\'s rating, positions and birth date from one, nationality and club from the other', () => {
  const { doc, text, audit, warnings } = buildLegacy();
  assert.deepEqual([doc.format, doc.kind, doc.id, doc.year, doc.season, doc.label], [1, 'ea', 'ea-fifa-09', 2009, '2008/09', 'FIFA 09']);
  assert.deepEqual(doc.source, LEGACY_SOURCE, 'the clubs roster dates the season; the ratings roster has its own date');
  assert.equal(doc.version, `ea-fifa-09-${contentHash(doc)}`);
  assert.equal(text, `${JSON.stringify(doc)}\n`);
  assert.deepEqual(warnings, []);

  // England: FIFA Index's old codes become EA's modern ones, repeats dropped; the rating is FIFA Index's, never SoFIFA's bov.
  const england = doc.nations['826'][2];
  assert.equal(england.length, 11);
  const byName = Object.fromEntries(england.map(tuple => [tuple[2], tuple]));
  assert.deepEqual(['Invented Player3', 'Invented Player4', 'Invented Player6', 'Invented Player9', 'Invented Player10'].map(name => byName[name][4]),
    ['CB', 'CB', 'LM', 'RM', 'CF,ST']);
  assert.ok(england.every(tuple => tuple[3] >= 60 && tuple[3] <= 70), 'ratings from the ratings file');
  assert.deepEqual(byName['Invented Player1'], [1, 'I. Player1', 'Invented Player1', 60, 'GK', 'England', 'Testford United', '1990-01-01', 'invented-player-1']);
  assert.deepEqual(audit.mappedPositions, { 'LWM→LM': 1, 'RF→CF': 1, 'RWM→RM': 1, 'SW→CB': 2 });

  // Players in one file only are left out; the stand-in is excluded and named in the audit.
  const written = [...Object.values(doc.nations).flatMap(([, , squad]) => squad), ...doc.clubs.flatMap(club => club.squad)].map(tuple => tuple[0]);
  for (const missing of [801, 802, 900]) assert.ok(!written.includes(missing), `player ${missing} is not written`);
  assert.equal(doc.nations['076'][1], 0, 'Brazil has nobody: each of its players is in one file only');
  assert.deepEqual(audit.join, { ratingsRows: 84, clubsRows: 84, clubsDuplicates: 0, joined: 83, ratingsOnly: 1, clubsOnly: 1, excluded: 1 });
  assert.deepEqual(audit.excluded, ['900 Invented Standin (stands for Someone Real)']);
  assert.equal(audit.rows, 82);

  // Nations: the old spelling is Czechia, Turks and Caicos has no team, a short name equal to the full name keeps 0, and a
  // garbled short name gives way to the full name.
  assert.deepEqual(doc.nations['203'][2].map(tuple => [tuple[5], tuple[7]]), [['Czech Republic', '1977-01-04']]);
  assert.deepEqual(audit.noTeam, { 'Turks and Caicos Islands': 1 });
  assert.deepEqual(doc.nations['288'][2][0].slice(1, 3), ['Kofi', 0]);
  assert.deepEqual(doc.nations['428'][2][0].slice(1, 3), ['Aleksejs Invented', 0]);
  assert.deepEqual(audit.namesFromRatings, [`806 "A. Inv${GARBLED} nted" → "Aleksejs Invented"`]);

  // Clubs by the edition's league table, both of Liga Portugal's names accepted; a league outside the table holds no club.
  assert.deepEqual(doc.clubs.map(club => club.league).sort(), Object.values(EA_LEAGUES).map(([league]) => league).sort());
  assert.deepEqual(doc.clubs.find(club => club.name === 'Inventado FC').country, '620');
  assert.deepEqual(audit.leagues['Liga Portugal'], { clubs: 1, short: [{ name: 'Sagres Club', players: 1 }] });
  assert.ok(!doc.clubs.some(club => club.name === 'Elsewhere FC'));
  assert.deepEqual(doc.territory, { merged: { 728: '729' }, inactive: ['KOS'] }, 'South Sudan and Kosovo were not FIFA members by mid-2009');
  assert.deepEqual([audit.ratingsRoster, audit.ratingsDate, audit.roster, audit.snapshotDate], ['090001', '2008-08-30', '090002', '2009-02-22']);

  // The loader takes it, and each player links to his page on the clubs file's roster.
  const set = decodeFootballSet(structuredClone(doc));
  const [, , rating, info] = set.rosters['826'][2][0];
  assert.equal(rating, info.rawRating);
  assert.equal(info.url, `https://sofifa.com/player/${info.id.slice(3)}/invented-player-${info.id.slice(3)}/090002`);
  assert.equal(info.snapshotDate, '2009-02-22');
  assert.equal(buildLegacy().text, text, 'the same rows build the same file');

  // One roster in both files: no separate ratings date.
  const same = buildLegacy(legacyInput(), { ...LEGACY_EDITION, ratings: { roster: '090002' } }).doc.source;
  assert.ok(!('ratingsDate' in same));
  assert.deepEqual([same.roster, same.update, same.snapshotDate], ['090002', 2, '2009-02-22']);
});

test('an old season stops rather than guess', () => {
  const players = () => legacySample();
  const withPlayer = over => legacyInput([...players(), legacyPlayer({ id: 807, ...over })]);
  assert.throws(() => buildLegacy(withPlayer({ positions: 'ST-XX' })), /FIFA 09: player 807 has positions ST-XX, a code neither EA's nor in LEGACY_POSITIONS/);
  assert.throws(() => buildLegacy(withPlayer({ dob: '31/02/1990' })), /player 807 has date of birth 31\/02\/1990/);
  assert.throws(() => buildLegacy(withPlayer({ rating: '0' })), /player 807 has overall 0/);
  assert.throws(() => buildLegacy(withPlayer({ nationality: 'Fictionland' })), /nationalities with no game nation, and not listed as having no team: Fictionland \(1 players\)/);
  assert.throws(() => buildLegacy(withPlayer({ nationality: `Lat${GARBLED}ia` })), /player 807 has a damaged nationality/);
  assert.throws(() => buildLegacy(withPlayer({ roster: '090003' })), /the clubs file holds rosters 090002, 090003, not 090002/);

  const input = legacyInput();
  assert.throws(() => buildLegacy({ ...input, clubs: [...input.clubs, { ...input.clubs[0], club_name: 'Another Club' }] }), /the clubs file has two different rows for player 1/);
  assert.throws(() => buildLegacy({ ...input, ratings: [...input.ratings, input.ratings[0]] }), /the ratings file repeats player 1/);
  assert.throws(() => buildLegacy({ ...input, clubs: input.clubs.map((row, i) => (i ? row : { ...row, player_url: '/player/2/invented-player-2/090002/' })) }), /player 1 links to/);
  // The league table: every league named, every name found in the clubs file, and each league with a club of eleven.
  const { 'Serie A': _serieA, ...six } = LEGACY_EDITION.leagues;
  assert.throws(() => buildLegacy(input, { ...LEGACY_EDITION, leagues: six }), /the league table names .*, not the seven game leagues/);
  assert.throws(() => buildLegacy(input, { ...LEGACY_EDITION, leagues: { ...LEGACY_EDITION.leagues, 'Serie A': ['Missing League'] } }),
    /no player of the clubs file is in "Missing League" \(Serie A\)/);
  const withoutKeeper = players().filter(p => !(p.club?.club_name === 'Inventado FC' && p.rating.preferred_positions === 'GK'));
  assert.throws(() => buildLegacy(legacyInput(withoutKeeper)), /FIFA 09: no Liga Portugal club has eleven players/);
  // The exclusions name players of the edition as the data spells them.
  const exclude = records => buildLegacy(input, LEGACY_EDITION, { exclusions: legacyExclusions([{ player: 'Someone', evidence: 'shown', records }]) });
  assert.throws(() => exclude([{ edition: 'FIFA 09', eaId: 999, name: 'Nobody' }]), /the exclusion of 999 \(Nobody\) names no player of this edition/);
  assert.throws(() => exclude([{ edition: 'FIFA 09', eaId: 801, name: 'Invented Player801' }]), /names no player of this edition/, 'in the ratings file only');
  assert.throws(() => exclude([{ edition: 'FIFA 09', eaId: 900, name: 'Someone Else' }]), /player 900 is Invented Standin, not Someone Else/);
  // Rosters: each the edition's own, and each with a date.
  assert.throws(() => buildLegacy(input, { ...LEGACY_EDITION, ratings: { roster: '090005' } }), /the roster dates give no date for roster 090005/);
  assert.throws(() => buildLegacy(input, { ...LEGACY_EDITION, clubs: { roster: '100002' } }), /roster 100002 is not one of FIFA 09's/);
  assert.throws(() => buildLegacy(input, { ...LEGACY_EDITION, id: 'fifa-09' }), /not like ea-fifa-07/);
});

test('the old files are read as they are laid out: the ratings file\'s shifted columns, the clubs file\'s duplicate rows, SoFIFA\'s roster dates', () => {
  // FIFA 11–14 name one column more than their rows hold, and FIFA 11's last row is cut short: the columns read come first.
  const ratingsText = ['id;Fullname;current_rating;potential_rating;height;weight;preferred_foot;birth_date;preferred_positions;work_rate;composure;vision;penalties',
    '3721;Nenad Dzodic;72;75;188;75;Right;04/01/1977;CB-RB-SW;;46;66', '193030;Milan Lukac;65;72;197;88;Right;04/10/1985;GK'].join('\n');
  assert.deepEqual(readRatingsRows(ratingsText), [
    { id: '3721', Fullname: 'Nenad Dzodic', current_rating: '72', birth_date: '04/01/1977', preferred_positions: 'CB-RB-SW' },
    { id: '193030', Fullname: 'Milan Lukac', current_rating: '65', birth_date: '04/10/1985', preferred_positions: 'GK' }]);
  assert.throws(() => readRatingsRows(`${ratingsText}\n1;Too Short;60;61;180;80;Right;01/01/1990`), /Ratings row 4 has 8 fields/);
  assert.throws(() => readRatingsRows('id;Name\n1;X'), /no "Fullname" column/);

  // Exact duplicates are dropped and counted; a quoted club name keeps its comma.
  const clubsText = ['sofifa_id,player_url,short_name,age,nationality,club_name,league_name,bov',
    '1179,/player/1179/gianluigi-buffon/070002/,G. Buffon,28,Italy,Juventus,Italian Serie B,93',
    '1179,/player/1179/gianluigi-buffon/070002/,G. Buffon,28,Italy,Juventus,Italian Serie B,93',
    '4,/player/4/someone/070002/,S. One,30,Spain,"Club, Deportivo",Spain Primera Division,70', ''].join('\r\n');
  const { rows, duplicates } = readClubRows(clubsText);
  assert.equal(duplicates, 1);
  assert.deepEqual(rows.map(row => [row.sofifa_id, row.club_name, row.league_name]), [['1179', 'Juventus', 'Italian Serie B'], ['4', 'Club, Deportivo', 'Spain Primera Division']]);
  assert.ok(!('bov' in rows[0]), 'SoFIFA\'s best overall is never read');
  assert.throws(() => readClubRows('sofifa_id,player_url,short_name,nationality,club_name,league_name\n1,x'), /Clubs row 2 has 2 fields; expected 6/);

  // Each edition's rosters in order; a row that names its roster must sit at its place.
  const dates = rosterDates({ data: [['Aug 29, 2014', 0, 0, 0, 0, '', 'FIFA 15'], ['Sep 18, 2014', 0, 0, 0, 0, '', 'FIFA 15'],
    ['Feb 6, 2015', '79', '63', 210000, 4000, '150003', 'FIFA 15'], ['Aug 30, 2006', 0, 0, 0, 0, '', 'FIFA 07']] });
  assert.deepEqual(dates, { 'FIFA 15': ['2014-08-29', '2014-09-18', '2015-02-06'], 'FIFA 07': ['2006-08-30'] });
  assert.equal(rosterDate(dates, 'FIFA 15', '150002'), '2014-09-18');
  assert.throws(() => rosterDate(dates, 'FIFA 07', '070002'), /FIFA 07: the roster dates give no date for roster 070002/);
  assert.throws(() => rosterDates({ data: [['Feb 6, 2015', '79', '63', 210000, 4000, '150026', 'FIFA 15']] }), /is number 1 of FIFA 15, not roster 150026/);
  assert.throws(() => rosterDates({}), /no data list/);

  // Dates of birth are real days; positions map once, in order.
  assert.deepEqual(['29/02/1984', '29/02/1985', '1984-02-29', '00/01/1990'].map(isoDate), ['1984-02-29', null, null, null]);
  assert.deepEqual(legacyPositionKeys('CB-RB-SW'), { keys: ['CB', 'RB'], mapped: ['SW→CB'] });
  assert.deepEqual(legacyPositionKeys('LF-ST-LW-CF'), { keys: ['CF', 'ST', 'LW'], mapped: ['LF→CF'] });
  assert.deepEqual(legacyPositionKeys('LCDM-RAM-LS'), { keys: ['CDM', 'CAM', 'ST'], mapped: ['LCDM→CDM', 'RAM→CAM', 'LS→ST'] });
  assert.equal(legacyPositionKeys('ST-XX'), null);
  for (const [code, key] of Object.entries(LEGACY_POSITIONS)) {
    assert.ok(Object.hasOwn(EA_ROLES, key) && !Object.hasOwn(EA_ROLES, code), `${code} → ${key} maps a code EA no longer uses to one it does`);
  }

  // Exclusions: whom each stands for and how that is known, each player once.
  assert.deepEqual(EXCLUSIONS, [{ edition: 'FIFA 09', eaId: 900, name: 'Invented Standin', player: 'Someone Real' }]);
  assert.throws(() => legacyExclusions([{ player: 'Someone', records: [{ edition: 'FIFA 09', eaId: 1, name: 'X' }] }]), /must name the player, its evidence and its records/);
  assert.throws(() => legacyExclusions([{ player: 'A', evidence: 'e', records: [{ edition: 'FIFA 09', eaId: 1, name: 'X' }] },
    { player: 'B', evidence: 'e', records: [{ edition: 'FIFA 09', eaId: 1, name: 'X' }] }]), /FIFA 09: player 1 is excluded twice/);
  assert.throws(() => legacyExclusions([{ player: 'A', evidence: 'e', records: [{ edition: 'FIFA 09', eaId: '1', name: 'X' }] }]), /is incomplete/);
});

// ---------- the FIFA 05 and FIFA 06 builder, on invented rows ----------

const EARLY_EDITION = { id: 'ea-fifa-06', fifaVersion: 6, edition: 'FIFA 06', released: '2005-09-30' };
const EARLY_URL = 'https://example.test/ratings';
const earlyRow = (id, name, over = {}) => ({ id: String(id), Fullname: name, current_rating: '70', birth_date: '01/01/1980', preferred_positions: 'ST', ...over });
const later = (nationality, names, dob = '1980-01-01') => ({ nationality, names, dob });
const EARLY_LATER = [
  { edition: 'FIFA 07', players: new Map([
    [1, later('England', ['A. Keeper', 'Alan Keeper'])],
    [2, later('France', ['T. Spelled', 'Thierry Spelled'], '1977-08-17')],
    [3, later('Egypt', ['I. Said', 'Ibrahim Said'], '1979-10-16')],
    [4, later('Montenegro', ['M. Vucin'])],
    [8, later('Brazil', ['Someone Else Entirely'])],
  ]) },
  { edition: 'FIFA 08', players: new Map([
    [1, later('Scotland', ['Alan Keeper'])],
    [3, later('Tunisia', ['Anis Boussaidi'], '1984-02-29')],
    [5, later('Spain', ['Xavi'], null)],
    [6, later('Kosovo', ['Bes Hasani'])],
    [7, later('Malta', ['Maltese Player'])],
  ]) },
];
const EARLY_ENTRIES = nationalityEntries({ players: [
  { eaId: 20, names: ['Retired Great'], nationality: 'France', wikidata: 'Q1835', evidence: 'P1532', match: 'birth date and name' },
  { eaId: 21, names: ['Real Name'], nationality: 'Romania', wikidata: 'Q2', evidence: 'P27', match: 'name', dob: '1979-01-08' },
  { eaId: 22, names: ['Spelt One Way'], nationality: 'Italy', wikidata: 'Q3', evidence: 'P54', match: 'birth date and name' },
] });
const earlyRows = () => [
  earlyRow(1, 'Alan Keeper', { preferred_positions: 'GK', current_rating: '80' }),
  // A name that agrees, with a birth date a later edition corrects (this file has many wrong ones).
  earlyRow(2, 'Thierry Spelled', { birth_date: '12/05/1984', preferred_positions: 'LWM-LF' }),
  // EA gave this id to someone else: FIFA 07's Egyptian is another person, and FIFA 08 is not asked.
  earlyRow(3, 'Anis Boussaidi', { birth_date: '29/02/1984' }),
  // Montenegro's players counted for Serbia until 2006, and Kosovo had no federation.
  earlyRow(4, 'Mirko Vucin'),
  earlyRow(6, 'Bes Hasani'),
  // The nearest later edition with the id, and a nationality with no team.
  earlyRow(5, 'Xavi', { preferred_positions: 'CM-CAM' }),
  earlyRow(7, 'Maltese Player'),
  // The same birth date under another name is the same person ("Rocco" and "J. Sandkvist").
  earlyRow(8, 'Nickname'),
  // Wikidata for those no later edition has: only under the spelling it was matched to.
  earlyRow(20, 'Retired Great', { current_rating: '92', preferred_positions: 'CAM' }),
  earlyRow(21, 'Real Name', { birth_date: '30/06/1987' }),
  earlyRow(22, 'Invented Standin', { current_rating: '89' }),
  earlyRow(30, 'Nobody Knows', { current_rating: '60' }),
];
const buildEarly = (rows = earlyRows(), edition = EARLY_EDITION, options = {}) =>
  buildEarlyEaSeason({ ratings: rows, later: EARLY_LATER, entries: EARLY_ENTRIES }, edition, { ratingsUrl: EARLY_URL, nationalities: 'Later editions, then Wikidata', ...options });

test('names agree word by word: an initial or a shortening counts, a shared surname alone does not', () => {
  assert.deepEqual(nameWords("Raúl M. Sørensen-O'Brien"), ['raul', 'm', 'sorensen', 'o', 'brien']);
  for (const [a, b] of [['C. Ronaldo', 'Cristiano Ronaldo'], ['Manuel Cesar Rui Costa', 'Rui Costa'], ['Joshua Gowling', 'Josh Gowling'], ['Kim J. W.', 'Kim Jin Woo'],
    ['Jin Woo Kim', 'Kim Jin Woo'], ['Tuncay Sanli', 'Tuncay Şanlı'], ['Alex Baptiste', 'Alex John-Baptiste'], ['Jay-Jay', 'Jay-Jay Okocha'], ['Wendell', 'Wendel']]) {
    assert.ok(namesAgree(a, b), `${a} and ${b} agree`);
    assert.ok(namesAgree(b, a), `${b} and ${a} agree`);
  }
  for (const [a, b] of [['Pierluigi Brivio', 'D. Brivio'], ['Pierluigi Brivio', 'Davide Brivio'], ['Peng Wang', 'Dong Fangzhuo'], ['Adrian Mutu', 'Petrovici Teodor'], ['', 'Someone']]) {
    assert.ok(!namesAgree(a, b), `${a} and ${b} do not agree`);
  }
  const row = { id: '1', Fullname: 'Rocco', birth_date: '06/05/1981' };
  assert.ok(samePerson(row, { names: ['J. Sandkvist'], dob: '1981-05-06' }), 'the same birth date under another name');
  assert.ok(samePerson({ ...row, Fullname: 'Teddy Sheringham', birth_date: '14/05/1984' }, { names: ['T. Sheringham'], dob: '1966-04-02' }), 'the same name with a wrong date');
  assert.ok(!samePerson(row, { names: ['J. Sandkvist'], dob: null }), 'nothing to go on');
});

test('the later editions read a player from either kind of source, and the nearest with the id speaks', () => {
  const ratings = [{ id: '5', Fullname: 'Full Name', birth_date: '02/03/1980' }];
  const clubs = [{ sofifa_id: '5', short_name: 'F. Name', nationality: 'Spain ' }, { sofifa_id: '6', short_name: 'Clubs Only', nationality: 'Peru' }];
  const scraped = laterFromScrape('FIFA 07', clubs, ratings);
  assert.equal(scraped.edition, 'FIFA 07');
  assert.deepEqual(scraped.players.get(5), { nationality: 'Spain', names: ['F. Name', 'Full Name'], dob: '1980-03-02' });
  assert.deepEqual(scraped.players.get(6), { nationality: 'Peru', names: ['Clubs Only'], dob: null });

  const row = (id, version, nationality) => ({ player_id: id, fifa_version: version, nationality_name: nationality, short_name: 'S. Name', long_name: 'Some Name', dob: '1980-01-01' });
  const exported = laterFromExport([row('9', '15.0', 'Chile'), row('9', '15.0', 'Peru'), row('9', '16.0', 'Peru'), row('8', '99.0', 'Peru')],
    [{ fifaVersion: 16, edition: 'FIFA 16' }, { fifaVersion: 15, edition: 'FIFA 15' }]);
  assert.deepEqual(exported.map(({ edition }) => edition), ['FIFA 16', 'FIFA 15']);
  assert.equal(exported[1].players.get(9).nationality, 'Chile', 'a player\'s first row in the edition');
  assert.ok(!exported.some(({ players }) => players.has(8)), 'another edition is not read');

  const ask = id => inLaterEdition(earlyRows().find(candidate => candidate.id === String(id)), EARLY_LATER);
  assert.deepEqual([ask(1).edition, ask(1).player.nationality], ['FIFA 07', 'England'], 'the nearest edition, though FIFA 08 says otherwise');
  assert.deepEqual([ask(5).edition, ask(5).player.nationality], ['FIFA 08', 'Spain']);
  assert.deepEqual(ask(3), { reused: { edition: 'FIFA 07', names: ['I. Said', 'Ibrahim Said'] } }, 'FIFA 08 is not asked once the id has moved on');
  assert.equal(ask(30), null);
});

test('Wikidata settles a nationality in order of how directly it speaks of football, or not at all', () => {
  assert.deepEqual(wikidataNationality({ senior: ["Greece men's national football team"], sport: ['Germany'], citizenship: ['Greece'] }), { nationality: 'Greece', evidence: 'P54' }, 'the team they played for');
  assert.deepEqual(wikidataNationality({ senior: ["England men's national association football team"], citizenship: ['United Kingdom'] }), { nationality: 'England', evidence: 'P54' }, 'by the team\'s name: Wikidata files it under the United Kingdom');
  assert.deepEqual(wikidataNationality({ senior: ['Soviet Union national football team', "Russia men's national football team"] }), { nationality: 'Russia', evidence: 'P54' }, 'a state of its time says nothing');
  assert.equal(wikidataNationality({ senior: ["Spain men's national football team", "Argentina men's national football team"] }), null, 'two nations');
  assert.deepEqual(wikidataNationality({ sport: ['Germany'], citizenship: ['Brazil'] }), { nationality: 'Brazil', evidence: 'P27' }, 'a country for sport no citizenship backs does not count');
  assert.deepEqual(wikidataNationality({ sport: ['France'], citizenship: ['France', 'Algeria'] }), { nationality: 'France', evidence: 'P1532' });
  assert.deepEqual(wikidataNationality({ sport: ['Russia', 'Germany'], citizenship: ['Russia'] }), { nationality: 'Russia', evidence: 'P1532' });
  assert.deepEqual(wikidataNationality({ teams: ['England national under-21 association football team'], citizenship: ['United Kingdom'] }), { nationality: 'England', evidence: 'P54' }, 'a youth team, where nothing stronger speaks');
  assert.deepEqual(wikidataNationality({ teams: ['Germany national under-21 football team', 'West Germany national under-18 football team'], citizenship: ['Germany', 'Turkey'] }), { nationality: 'Germany', evidence: 'P54' }, 'one nation, under two names');
  assert.deepEqual(wikidataNationality({ citizenship: ['Kingdom of the Netherlands'] }), { nationality: 'Netherlands', evidence: 'P27' });
  assert.deepEqual(wikidataNationality({ citizenship: ['South Korea'] }), { nationality: 'Korea Republic', evidence: 'P27' });
  assert.deepEqual(wikidataNationality({ sport: ['England'], citizenship: ['United Kingdom'] }), { nationality: 'England', evidence: 'P1532' });
  assert.equal(wikidataNationality({ citizenship: ['United Kingdom'] }), null, 'the United Kingdom is four of the game\'s nations');
  assert.equal(wikidataNationality({ citizenship: ['Soviet Union'] }), null);
  assert.equal(wikidataNationality({ citizenship: ['France', 'Algeria'] }), null, 'two countries, nothing to choose between them');
  assert.equal(wikidataNationality({ sport: ['France', 'Algeria'], citizenship: ['France', 'Algeria'] }), null, 'football itself is unsure');
  assert.equal(wikidataNationality({}), null);
  assert.equal(teamCountry("United States men's national soccer team"), 'United States');
  assert.equal(teamCountry('Atlantis'), 'Atlantis');
  assert.equal(eaCountryName('Atlantis'), null);
  for (const [label, name] of Object.entries(WIKIDATA_COUNTRIES)) {
    if (name != null) assert.ok(knownNationality(name), `${label} → ${name} is a nationality the seasons read`);
  }

  const entry = { eaId: 1, names: ['Name'], nationality: 'France', wikidata: 'Q1', evidence: 'P1532', match: 'birth date and name' };
  assert.equal(nationalityEntries({ players: [entry] }).get(1), entry);
  assert.throws(() => nationalityEntries({}), /no players/);
  assert.throws(() => nationalityEntries({ players: [entry, entry] }), /Early nationality of 1 is listed twice/);
  assert.throws(() => nationalityEntries({ players: [{ ...entry, nationality: 'Atlantis' }] }), /"Atlantis" is not a nationality/);
  for (const damaged of [{ names: [] }, { wikidata: 'x' }, { evidence: 'P9' }, { match: 'hunch' }, { dob: '1980' }]) {
    assert.throws(() => nationalityEntries({ players: [{ ...entry, ...damaged }] }), /is incomplete/, JSON.stringify(damaged));
  }
});

test('a FIFA 05 or FIFA 06 season: EA\'s ratings, a later edition\'s nationality or Wikidata\'s, and no clubs', () => {
  const { doc, text, audit, warnings } = buildEarly();
  assert.deepEqual([doc.format, doc.kind, doc.id, doc.year, doc.season, doc.label], [1, 'ea', 'ea-fifa-06', 2006, '2005/06', 'FIFA 06']);
  assert.deepEqual(doc.source, { provider: 'EA Sports', edition: 'FIFA 06', update: 1, roster: '060001', snapshotDate: '2005-09-30', url: EARLY_URL,
    nationalities: 'Later editions, then Wikidata', rawScale: 99 });
  assert.equal(doc.version, `ea-fifa-06-${contentHash(doc)}`);
  assert.equal(text, `${JSON.stringify(doc)}\n`);
  assert.deepEqual(warnings, [], 'no club is no news here');

  assert.deepEqual(doc.clubs, []);
  assert.deepEqual([doc.coverage.clubs, doc.coverage.leagues], [0, 0]);
  const tuple = (nation, id) => doc.nations[nation][2].find(player => player[0] === id);
  assert.deepEqual(tuple('826', 1), [1, 'Alan Keeper', 0, 80, 'GK', 'England', '', '1980-01-01', 'alan-keeper'], 'the nearest later edition; no club');
  assert.deepEqual(tuple('250', 2), [2, 'Thierry Spelled', 0, 70, 'LM,CF', 'France', '', '1977-08-17', 'thierry-spelled'], 'the later edition\'s birth date');
  assert.deepEqual(tuple('724', 5).slice(1, 6), ['Xavi', 0, 70, 'CM,CAM', 'Spain']);
  assert.deepEqual(tuple('076', 8).slice(1, 6), ['Nickname', 0, 70, 'ST', 'Brazil'], 'the same birth date under another name');
  assert.deepEqual(tuple('250', 20), [20, 'Retired Great', 0, 92, 'CAM', 'France', '', '1980-01-01', 'retired-great'], 'Wikidata, for one no later edition has');
  assert.deepEqual(tuple('642', 21), [21, 'Real Name', 0, 70, 'ST', 'Romania', '', '1979-01-08', 'real-name'], 'matched by name: Wikidata\'s birth date');

  // Montenegro's player counts for Serbia that year; Montenegro is held by Serbia, Kosovo has no federation.
  assert.deepEqual(tuple('688', 4).slice(1, 6), ['Mirko Vucin', 0, 70, 'ST', 'Serbia']);
  assert.deepEqual(doc.nations['499'], [40, 0, []]);
  assert.deepEqual(doc.nations.KOS, [40, 0, []]);
  assert.deepEqual(doc.territory, { merged: { 499: '688', 728: '729' }, inactive: ['KOS'] });

  // Not written: a reused id, an entry under another spelling, nobody's nationality; a nation with no team has no squad.
  const written = Object.values(doc.nations).flatMap(([, , squad]) => squad).map(player => player[0]);
  for (const id of [3, 22, 30, 6, 7]) assert.ok(!written.includes(id), `player ${id} is not written`);
  assert.deepEqual(audit.noTeam, { Malta: 1 });
  assert.deepEqual(audit.join, { ratingsRows: 12, fromLater: { 'FIFA 07': 4, 'FIFA 08': 3 }, fromWikidata: { P1532: 1, P27: 1 }, reusedIds: 1, leftOut: 3, datesCorrected: 2,
    noFederation: { Kosovo: 1 }, heldBy: { 'Montenegro → Serbia': 1 } });
  assert.deepEqual(audit.reused, ['3 Anis Boussaidi: FIFA 07 names I. Said / Ibrahim Said']);
  assert.deepEqual(audit.leftOutBest, ['22 Invented Standin (89)', '3 Anis Boussaidi (70)', '30 Nobody Knows (60)'], 'best first');
  assert.deepEqual(audit.mappedPositions, { 'LF→CF': 1, 'LWM→LM': 1 });
  assert.deepEqual([audit.roster, audit.snapshotDate, audit.update], ['060001', '2005-09-30', 1]);

  // The loader takes it, and a player links to that edition's page on FIFA Index, SoFIFA having no roster so old.
  const set = decodeFootballSet(structuredClone(doc));
  assert.deepEqual(set.clubs, []);
  const zidane = set.rosters['250'][2].find(player => player[0] === 'Retired Great');
  assert.equal(sourceUrl({ sourceInfo: zidane[3] }), 'https://fifaindex.com/players/20-retired-great/fifa06');
  assert.equal(sourceLabel({ sourceInfo: zidane[3] }), 'FIFA 06');
  assert.equal(zidane[3].club, '');
  assert.equal(buildEarly().text, text, 'the same rows build the same file');

  // FIFA 05 is a year earlier: Timor-Leste had no federation yet either.
  const earlier = buildEarly(earlyRows(), { id: 'ea-fifa-05', fifaVersion: 5, edition: 'FIFA 05', released: '2004-10-08' }).doc;
  assert.deepEqual([earlier.year, earlier.season, earlier.source.roster, earlier.source.snapshotDate], [2005, '2004/05', '050001', '2004-10-08']);
  assert.deepEqual(earlier.territory.inactive, ['626', 'KOS']);
});

test('a FIFA 05 or FIFA 06 season stops rather than guess', () => {
  const withRow = over => buildEarly([...earlyRows(), earlyRow(1000, 'Alan Keeper', { ...over })]);
  assert.throws(() => withRow({ preferred_positions: 'ST-XX' }), /FIFA 06: player 1000 has positions ST-XX, a code neither EA's nor in LEGACY_POSITIONS/);
  assert.throws(() => withRow({ birth_date: '31/02/1990' }), /FIFA 06: player 1000 has date of birth 31\/02\/1990/);
  assert.throws(() => withRow({ Fullname: `Alan ${GARBLED}eeper` }), /FIFA 06: player 1000 has a damaged name/);
  const rows = earlyRows();
  assert.throws(() => buildEarly([...rows, rows[0]]), /FIFA 06: invalid or repeated player id 1/);
  assert.throws(() => buildEarly(rows, { ...EARLY_EDITION, id: 'fifa-06' }), /not like ea-fifa-06/);
  assert.throws(() => buildEarly(rows, { ...EARLY_EDITION, released: 'autumn' }), /FIFA 06: release date autumn is not YYYY-MM-DD/);
  // A later edition's nationality the game cannot read stops the build, as for any other season.
  const later2 = [{ edition: 'FIFA 07', players: new Map([[1, later('Fictionland', ['Alan Keeper'])]]) }];
  assert.throws(() => buildEarlyEaSeason({ ratings: rows.slice(0, 1), later: later2 }, EARLY_EDITION, { ratingsUrl: EARLY_URL }), /nationalities with no game nation, and not listed as having no team: Fictionland/);
});

test('the FIFA 05 and FIFA 06 files hold one field more per row than their header names', () => {
  const header = 'id;Fullname;current_rating;potential_rating;height;weight;preferred_foot;birth_date;preferred_positions;last';
  const row = '3721;Nenad Dzodic;67;62;188;75;Right;04/01/1977;CB;1;extra';
  assert.throws(() => readRatingsRows(`${header}\n${row}`), /Ratings row 2 has 11 fields/);
  assert.deepEqual(readRatingsRows(`${header}\n${row}`, { extraFields: EARLY_EXTRA_FIELDS }),
    [{ id: '3721', Fullname: 'Nenad Dzodic', current_rating: '67', birth_date: '04/01/1977', preferred_positions: 'CB' }]);
  assert.throws(() => readRatingsRows(`${header}\n${row};more`, { extraFields: EARLY_EXTRA_FIELDS }), /Ratings row 2 has 12 fields/);
});

test('FIFA 05 and FIFA 06 have nations only, and a player of theirs links to FIFA Index and folds back exactly', () => {
  for (const id of ['ea-fifa-05', 'ea-fifa-06']) {
    assert.ok(!setHasClubs(id) && setHasNations(id), id);
    assert.equal(setSportOf(id), 'football');
  }
  for (const id of ['ea-fifa-07', 'ea-fifa-18', 'ea-fc-26', 'cm0102-2005-09', 'nba-2k10', 'mlb-the-show-21']) assert.ok(setHasClubs(id), id);

  // With clubs chosen, such a season does not play: the built-in season does.
  const nations = { sport: 'football', layer: 'nations', dataSet: 'ea-fifa-06' }, clubs = { ...nations, layer: 'clubs' };
  assert.equal(dataSetOf(nations), 'ea-fifa-06');
  assert.equal(dataSetOf(clubs), null);
  assert.equal(dataSetOf({ ...clubs, dataSet: 'ea-fifa-18' }), 'ea-fifa-18');
  assert.equal(sportOf(nations), null, 'waits for the season to load');
  assert.equal(sportOf(clubs), getSport('football'));

  const source = { provider: 'EA Sports', edition: 'FIFA 06', update: 1, roster: '060001', snapshotDate: '2005-09-30', url: EARLY_URL, rawScale: 99 };
  const tuple = [1397, 'Zinedine Zidane', 0, 92, 'CAM', 'France', '', '1972-06-23', 'zinedine-zidane'];
  const [name, , rating, info] = expandEaTuple(tuple, source);
  assert.deepEqual([name, rating, info.url, info.club, info.edition], ['Zinedine Zidane', 92, 'https://fifaindex.com/players/1397-zinedine-zidane/fifa06', '', 'FIFA 06']);
  assert.deepEqual(eaTupleOf(name, info), tuple);
  assert.equal(eaRosterOf(info.url), '060001');
  assert.equal(sourceUrl({ name, sourceInfo: info }), info.url);
  assert.equal(sourceTitle({ name, sourceInfo: info }), 'FIFA 06 · Database snapshot 2005-09-30 · Source rating 92/99');
  // SoFIFA's editions keep their links; FIFA Index links name only editions before them, and the right player.
  assert.equal(expandEaTuple([5, 'X', 0, 70, 'ST', 'Brazil', '', '', 'x'], { ...source, roster: '070002' })[3].url, 'https://sofifa.com/player/5/x/070002');
  assert.equal(eaRosterOf('https://fifaindex.com/players/1397-zinedine-zidane/fifa18'), null);
  assert.equal(eaTupleOf(name, { ...info, url: 'https://fifaindex.com/players/1-zinedine-zidane/fifa06' }), null);
});

// ---------- saves ----------

test('a FIFA 06 campaign packs its players too; a save cannot play it with clubs', () => {
  const doc = buildEarly().doc;
  const set = decodeFootballSet(structuredClone(doc));
  const squad = set.rosters['250'][2].map(([name, pos, rating, sourceInfo]) => ({ name, pos, rating, gen: false, sourceInfo, id: sourceInfo.id, positions: [...sourceInfo.positions] }));
  const settings = { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', pacing: 'duel', resolution: 'ticker', uncertainty: 'balanced', role: 'spectator',
    finale: 'single', express: false, managedTeamId: '', dataSet: doc.id, dataVersion: doc.version, dataYear: 2006, dataSeason: '2005/06' };
  const campaign = { v: 4, seed: 7, rngState: 7, round: 1, matches: 0, aliveIds: ['250', '826'], own: { 250: '250', 826: '826' },
    teams: { 250: { id: '250', name: 'France', str: 70, squad }, 826: { id: '826', name: 'England', str: 60, squad: [] } }, settings };
  const text = serializeCampaign(campaign);
  const packed = JSON.parse(text);
  assert.deepEqual(packed.playerPack, { kind: 'ea', source: { edition: 'FIFA 06', update: 1, snapshotDate: '2005-09-30', roster: '060001' } });
  assert.ok(packed.teams['250'].squad.every(player => Array.isArray(player) && player.length === 9), 'FIFA Index links pack as well as SoFIFA\'s');
  assert.equal(JSON.stringify(parseCampaign(text).teams), JSON.stringify(campaign.teams), 'rebuilt exactly');

  const copy = JSON.parse(text);
  copy.settings.layer = 'clubs';
  assert.throws(() => parseCampaign(JSON.stringify(copy)), /Campaign data set is invalid/);
});

test('an EA season campaign packs its players as EA tuples; a damaged pack is refused', () => {
  const doc = buildEaSeason(sampleRows(), EDITION, { dataset: DATASET }).doc;
  const set = decodeFootballSet(doc);
  const squad = set.rosters['826'][2].map(([name, pos, rating, sourceInfo]) => ({ name, pos, rating, gen: false, sourceInfo,
    id: sourceInfo.id, positions: [...sourceInfo.positions] }));
  const campaign = { v: 4, seed: 7, rngState: 7, round: 1, matches: 0, aliveIds: ['826', '250'], own: { 826: '826', 250: '250' },
    teams: { 826: { id: '826', name: 'England', str: 70, squad }, 250: { id: '250', name: 'France', str: 60, squad: [] } },
    settings: { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', pacing: 'duel', resolution: 'ticker',
      uncertainty: 'balanced', role: 'spectator', finale: 'single', express: false, managedTeamId: '',
      dataSet: doc.id, dataVersion: doc.version, dataYear: 2018, dataSeason: '2017/18' } };
  const text = serializeCampaign(campaign);
  const packed = JSON.parse(text);
  assert.deepEqual(packed.playerPack, { kind: 'ea', source: { edition: 'FIFA 18', update: 2, snapshotDate: '2017-09-18', roster: '180002' } });
  assert.ok(packed.teams['826'].squad.every(player => Array.isArray(player) && player.length === 9));
  assert.equal(JSON.stringify(parseCampaign(text).teams), JSON.stringify(campaign.teams), 'rebuilt exactly');

  const damaged = (change, message) => {
    const copy = JSON.parse(text);
    change(copy);
    assert.throws(() => parseCampaign(JSON.stringify(copy)), new RegExp(message), message);
  };
  damaged(copy => { copy.teams['826'].squad[0][4] = 'SW'; }, 'Campaign squads are incomplete');
  damaged(copy => { copy.teams['826'].squad[0].splice(8); }, 'Campaign squads are incomplete');
  damaged(copy => { delete copy.playerPack.source.roster; }, 'Campaign squads are incomplete');
  damaged(copy => { copy.playerPack.kind = 'fifa'; }, 'Campaign squads are incomplete');
  damaged(copy => { copy.settings.dataSet = 'ea-fifa-1'; }, 'Campaign data set is invalid');
});

test('an EA season\'s player is labelled with its edition and links to that roster\'s page', () => {
  const [name, , , sourceInfo] = expandEaTuple([167948, 'H. Lloris', 'Hugo Lloris', 88, 'GK', 'France', 'Tottenham Hotspur', '1986-12-26', 'hugo-lloris'], SOURCE);
  const player = { name, sourceInfo };
  assert.equal(sourceLabel(player), 'FIFA 18');
  assert.equal(sourceTitle(player), 'FIFA 18 · Database snapshot 2017-09-18 · Source rating 88/99');
  assert.equal(sourceUrl(player), 'https://sofifa.com/player/167948/hugo-lloris/180002');
});

// ---------- the committed seasons ----------

// Coverage the setup note promises: most strong nations, and all seven leagues. EA rated fewer nations' players before
// FIFA 11 and the FIFA 07–14 sources join two scrapes, so those seasons have their own lower floors.
const FLOORS = {
  default: { completeXIs: 65, nations: 125, clubs: 125 },
  'ea-fifa-14': { completeXIs: 60 }, 'ea-fifa-11': { completeXIs: 60 }, 'ea-fifa-10': { completeXIs: 60 },
  'ea-fifa-09': { completeXIs: 45, nations: 120 }, 'ea-fifa-08': { completeXIs: 50, nations: 115 }, 'ea-fifa-07': { completeXIs: 50, nations: 110 },
  // Nations only (no source here has their clubs).
  'ea-fifa-06': { completeXIs: 50, nations: 110, clubs: 0 }, 'ea-fifa-05': { completeXIs: 50, nations: 110, clubs: 0 },
};
const committed = id => JSON.parse(readFileSync(new URL(`../public/football/${id}.json`, import.meta.url), 'utf8'));
const tuplesOf = doc => [...Object.values(doc.nations).flatMap(([, , squad]) => squad), ...doc.clubs.flatMap(club => club.squad)];

test('every built-in earlier season is committed, matches its listing and its own hash, and decodes', () => {
  const editions = [...MANIFEST.snapshots, ...MANIFEST.editions, ...MANIFEST.legacy.editions, ...MANIFEST.early.editions];
  assert.equal(editions.length, 21, 'FIFA 05 to EA FC 24, and EA FC 26');
  assert.deepEqual(BUILT_IN_SEASONS.map(set => set.id), editions.map(edition => edition.id), 'one per manifest edition, newest first');
  // EA FC 25 (2024/25) has no source here.
  assert.deepEqual(BUILT_IN_SEASONS.map(set => set.year), [2026, ...Array.from({ length: 20 }, (_, i) => 2024 - i)]);
  assert.deepEqual(BUILT_IN_SETS.filter(set => setSportOf(set.id) === 'football').map(set => set.id), BUILT_IN_SEASONS.map(set => set.id));
  for (const [i, listed] of BUILT_IN_SEASONS.entries()) {
    const edition = editions[i];
    const doc = committed(listed.id);
    assert.equal(setKindOf(listed.id), 'ea');
    assert.deepEqual([doc.id, doc.version, doc.year, doc.season, doc.label], [listed.id, listed.version, listed.year, listed.season, listed.label]);
    assert.deepEqual([doc.year, doc.label], [2000 + edition.fifaVersion, edition.edition]);
    assert.equal(doc.version, `${doc.id}-${contentHash(doc)}`, `${doc.id} is the file its version names`);
    if (edition.released) {
      // FIFA 05 and FIFA 06: one roster each, dated by the game's release.
      assert.deepEqual([doc.source.url, doc.source.roster, doc.source.update, doc.source.snapshotDate],
        [MANIFEST.legacy.ratings.url, `${String(edition.fifaVersion).padStart(2, '0')}0001`, 1, edition.released]);
    } else if (edition.clubs) {
      // FIFA 07–14: the clubs file's roster dates the season; a ratings file of another roster has its own date.
      assert.deepEqual([doc.source.url, doc.source.clubsUrl, doc.source.roster, doc.source.update],
        [MANIFEST.legacy.ratings.url, MANIFEST.legacy.clubs.url, edition.clubs.roster, Number(edition.clubs.roster.slice(2))]);
      assert.equal('ratingsDate' in doc.source, edition.ratings.roster !== edition.clubs.roster, `${doc.id} ratings date`);
      assert.ok(!doc.source.ratingsDate || doc.source.ratingsDate < doc.source.snapshotDate);
    } else if (edition.file) {
      // EA FC 26: the committed snapshot the built-in 2025/26 was built from, its generated players left out.
      assert.deepEqual([doc.source.url, doc.source.update, doc.source.roster, doc.source.snapshotDate],
        [edition.url, edition.update, '260004', '2025-09-19']);
    } else {
      assert.equal(doc.source.url, MANIFEST.dataset.url);
    }
    const set = decodeFootballSet(doc);
    const floor = { ...FLOORS.default, ...FLOORS[doc.id] };
    assert.ok(doc.coverage.completeXIs >= floor.completeXIs && doc.coverage.nations >= floor.nations, `${doc.id} coverage ${JSON.stringify(doc.coverage)}`);
    assert.deepEqual([...new Set(set.clubs.map(club => club.league))].sort(),
      setHasClubs(doc.id) ? Object.values(EA_LEAGUES).map(([league]) => league).sort() : []);
    assert.ok(set.clubs.length >= floor.clubs, `${doc.id} has ${set.clubs.length} clubs`);
  }
});

test('FIFA 05 and FIFA 06 name every input by its SHA-256, field the players who retired before FIFA 07, and write no stand-in', () => {
  const { early, legacy } = MANIFEST;
  const hex = /^[0-9a-f]{64}$/;
  const fileText = readFileSync(new URL(`../${early.nationalities.file}`, import.meta.url));
  assert.equal(createHash('sha256').update(fileText).digest('hex'), early.nationalities.sha256, 'the committed nationalities are the pinned ones');
  const entries = nationalityEntries(JSON.parse(fileText.toString('utf8')));
  assert.ok(entries.size > 1000, `${entries.size} players from Wikidata`);
  for (const edition of early.editions) {
    assert.ok(hex.test(edition.ratings.sha256) && edition.evidence?.trim(), `${edition.edition} pins its file and says how its roster is known`);
    assert.ok(!legacy.editions.some(other => other.id === edition.id));
    assert.ok(!setHasClubs(edition.id), `${edition.edition} has nations only`);
  }

  const byId = (doc, nation, id) => doc.nations[nation][2].find(tuple => tuple[0] === id);
  const fifa06 = committed('ea-fifa-06'), fifa05 = committed('ea-fifa-05');
  // Top of each edition, as FIFA Index lists them: Henry at 97 in FIFA 05 (https://fifaindex.com/players/fifa05), Ronaldinho at 95 in FIFA 06.
  const strongest = doc => Math.max(...tuplesOf(doc).map(tuple => tuple[3]));
  assert.deepEqual([strongest(fifa05), strongest(fifa06)], [97, 95]);
  assert.equal(tuplesOf(fifa05).find(tuple => tuple[3] === 97 && tuple[1] === 'Thierry Henry')?.[5], 'France');
  assert.equal(tuplesOf(fifa06).find(tuple => tuple[1] === 'Ronaldinho')?.[3], 95);
  // Zidane (EA id 1397) had retired by FIFA 07: his nationality is Wikidata's, and he leads France in both.
  const zidane = doc => byId(doc, '250', 1397);
  assert.deepEqual([zidane(fifa05)?.[1], zidane(fifa05)?.[3], zidane(fifa05)?.[5]], ['Zinedine Zidane', 96, 'France']);
  assert.deepEqual([zidane(fifa06)?.[1], zidane(fifa06)?.[3], zidane(fifa06)?.[5]], ['Zinedine Zidane', 92, 'France']);
  assert.equal(entries.get(1397)?.nationality, 'France');
  // Each player checked by hand is one no rule could settle, and says why.
  for (const { eaId, names, wikidata, nationality, why } of early.checked) {
    assert.ok(why?.trim(), `${eaId} says why`);
    assert.deepEqual([entries.get(eaId)?.wikidata, entries.get(eaId)?.nationality, entries.get(eaId)?.evidence], [wikidata, nationality, 'checked']);
    assert.deepEqual(entries.get(eaId).names, names.slice().sort());
  }

  for (const doc of [fifa05, fifa06]) {
    assert.deepEqual(doc.clubs, [], `${doc.id} has no clubs`);
    const tuples = tuplesOf(doc);
    assert.ok(tuples.every(tuple => tuple[6] === ''), 'nobody has a club');
    assert.ok(tuples.every(tuple => tuple[8] && /^[a-z0-9-]+$/.test(tuple[8])), 'everyone has a link');
    assert.ok(!tuples.some(tuple => tuple.some(field => String(field).includes(GARBLED))), 'no damaged text');
    for (const held of [...Object.keys(doc.territory.merged), ...doc.territory.inactive]) assert.deepEqual(doc.nations[held], [40, 0, []], `${held} fields nobody that year`);
    assert.ok(!tuples.some(tuple => ['Montenegro', 'Kosovo', 'South Sudan'].includes(tuple[5])));
  }
  // EA's stand-ins of FIFA 06 (the evidence in `legacy.exclusions`), whose real players are named in FIFA 05.
  const standIns = ['Petrovici Teodor', 'Valerio Bernado', 'Rabret Sylvain', 'Tellot Yves', 'Marcuccilli Silvio', 'Sturdza Corneliu', 'Kurtz Kambert', 'Daddah Ankoma'];
  const names06 = new Set(tuplesOf(fifa06).map(tuple => tuple[1]));
  for (const name of standIns) assert.ok(!names06.has(name), `FIFA 06 leaves out ${name}`);
  assert.ok(!standIns.some(name => [...entries.values()].some(entry => entry.names.includes(name))), 'no entry names a stand-in');
});

test('the FIFA 07–14 seasons name every input by its SHA-256, and none writes a player EA renamed with an invented name', () => {
  const { legacy } = MANIFEST;
  const hex = /^[0-9a-f]{64}$/;
  assert.ok(hex.test(legacy.dates.sha256) && hex.test(legacy.ratings.archive.sha256));
  for (const edition of legacy.editions) {
    const version = String(edition.fifaVersion).padStart(2, '0');
    assert.ok(hex.test(edition.ratings.sha256) && hex.test(edition.clubs.sha256), `${edition.edition} pins both files`);
    assert.ok([edition.ratings.roster, edition.clubs.roster].every(roster => new RegExp(`^${version}\\d{4}$`).test(roster)));
    assert.ok(edition.evidence?.trim(), `${edition.edition} says how its rosters are known`);
    assert.deepEqual(Object.keys(edition.leagues).sort(), Object.values(EA_LEAGUES).map(([league]) => league).sort());
  }
  const exclusions = legacyExclusions(legacy.exclusions);
  assert.ok(exclusions.length > 0);
  for (const { edition, eaId, name } of exclusions) {
    const built = legacy.editions.find(e => e.edition === edition);
    assert.ok(built, `${edition} is built`);
    assert.ok(!tuplesOf(committed(built.id)).some(tuple => tuple[0] === eaId), `${edition} leaves out ${eaId} ${name}`);
  }
  // Nothing the scrapes could not decode reaches a season.
  for (const { id } of legacy.editions) {
    assert.ok(!tuplesOf(committed(id)).some(tuple => tuple.some(field => String(field).includes(GARBLED))), `${id} has no damaged text`);
  }
});
