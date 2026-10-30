// The built-in earlier football seasons (docs/design/football-years.md): EA player tuples (src/data/eaPlayers.js), the
// season builders (scripts/lib/ea-seasons.mjs for FIFA 15 – EA FC 24, scripts/lib/ea-legacy-seasons.mjs for FIFA 07 –
// FIFA 14) on invented rows, saves of an EA season campaign, and the committed files in public/football/ checked
// against their listing (src/data/footballSeasons.js), their own content hash and the manifest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NATIONS } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { EA_ROLES, eaRosterOf, eaTupleOf, expandEaTuple } from '../src/data/eaPlayers.js';
import { BUILT_IN_SEASONS } from '../src/data/footballSeasons.js';
import { contentHash } from '../src/data/footballSetBuild.js';
import { BUILT_IN_SETS, decodeFootballSet, setKindOf } from '../src/engine/footballSets.js';
import { parseCampaign, serializeCampaign } from '../src/engine/storage.js';
import { sourceLabel, sourceTitle, sourceUrl } from '../src/viewModels/squad.js';
import { EA_LEAGUES, EA_NATION_ALIASES, EA_NO_TEAM, buildEaSeason } from './lib/ea-seasons.mjs';
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
  // The club layer's own leagues, so a club theatre means the same in every season.
  assert.deepEqual(Object.values(EA_LEAGUES).map(([league]) => league).sort(),
    [...new Set(getSport('football').clubs.map(club => club.league))].sort());
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

// ---------- saves ----------

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
};
const committed = id => JSON.parse(readFileSync(new URL(`../public/football/${id}.json`, import.meta.url), 'utf8'));
const tuplesOf = doc => [...Object.values(doc.nations).flatMap(([, , squad]) => squad), ...doc.clubs.flatMap(club => club.squad)];

test('every built-in earlier season is committed, matches its listing and its own hash, and decodes', () => {
  const editions = [...MANIFEST.editions, ...MANIFEST.legacy.editions];
  assert.equal(editions.length, 18, 'FIFA 07 to EA FC 24');
  assert.deepEqual(BUILT_IN_SEASONS.map(set => set.id), editions.map(edition => edition.id), 'one per manifest edition, newest first');
  assert.deepEqual(BUILT_IN_SEASONS.map(set => set.year), editions.map((_, i) => 2024 - i));
  assert.deepEqual(BUILT_IN_SETS.map(set => set.id), BUILT_IN_SEASONS.map(set => set.id));
  for (const [i, listed] of BUILT_IN_SEASONS.entries()) {
    const edition = editions[i];
    const doc = committed(listed.id);
    assert.equal(setKindOf(listed.id), 'ea');
    assert.deepEqual([doc.id, doc.version, doc.year, doc.season, doc.label], [listed.id, listed.version, listed.year, listed.season, listed.label]);
    assert.deepEqual([doc.year, doc.label], [2000 + edition.fifaVersion, edition.edition]);
    assert.equal(doc.version, `${doc.id}-${contentHash(doc)}`, `${doc.id} is the file its version names`);
    if (edition.clubs) {
      // FIFA 07–14: the clubs file's roster dates the season; a ratings file of another roster has its own date.
      assert.deepEqual([doc.source.url, doc.source.clubsUrl, doc.source.roster, doc.source.update],
        [MANIFEST.legacy.ratings.url, MANIFEST.legacy.clubs.url, edition.clubs.roster, Number(edition.clubs.roster.slice(2))]);
      assert.equal('ratingsDate' in doc.source, edition.ratings.roster !== edition.clubs.roster, `${doc.id} ratings date`);
      assert.ok(!doc.source.ratingsDate || doc.source.ratingsDate < doc.source.snapshotDate);
    } else {
      assert.equal(doc.source.url, MANIFEST.dataset.url);
    }
    const set = decodeFootballSet(doc);
    const floor = { ...FLOORS.default, ...FLOORS[doc.id] };
    assert.ok(doc.coverage.completeXIs >= floor.completeXIs && doc.coverage.nations >= floor.nations, `${doc.id} coverage ${JSON.stringify(doc.coverage)}`);
    assert.deepEqual([...new Set(set.clubs.map(club => club.league))].sort(), Object.values(EA_LEAGUES).map(([league]) => league).sort());
    assert.ok(set.clubs.length >= floor.clubs, `${doc.id} has ${set.clubs.length} clubs`);
  }
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
