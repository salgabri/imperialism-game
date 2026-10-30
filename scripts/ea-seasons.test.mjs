// The built-in earlier football seasons (docs/design/football-years.md): EA player tuples (src/data/eaPlayers.js), the
// season builder (scripts/lib/ea-seasons.mjs) on invented rows, saves of an EA season campaign, and the committed
// files in public/football/ checked against their listing (src/data/footballSeasons.js) and their own content hash.
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

test('every built-in earlier season is committed, matches its listing and its own hash, and decodes', () => {
  assert.deepEqual(BUILT_IN_SEASONS.map(set => set.id), MANIFEST.editions.map(edition => edition.id), 'one per manifest edition, newest first');
  assert.deepEqual(BUILT_IN_SETS.map(set => set.id), BUILT_IN_SEASONS.map(set => set.id));
  for (const [i, listed] of BUILT_IN_SEASONS.entries()) {
    const edition = MANIFEST.editions[i];
    const doc = JSON.parse(readFileSync(new URL(`../public/football/${listed.id}.json`, import.meta.url), 'utf8'));
    assert.equal(setKindOf(listed.id), 'ea');
    assert.deepEqual([doc.id, doc.version, doc.year, doc.season, doc.label], [listed.id, listed.version, listed.year, listed.season, listed.label]);
    assert.deepEqual([doc.year, doc.label], [2000 + edition.fifaVersion, edition.edition]);
    assert.equal(doc.version, `${doc.id}-${contentHash(doc)}`, `${doc.id} is the file its version names`);
    assert.equal(doc.source.url, MANIFEST.dataset.url);
    const set = decodeFootballSet(doc);
    // Coverage the setup note promises: most strong nations, and all seven leagues.
    assert.ok(doc.coverage.completeXIs >= 65 && doc.coverage.nations >= 125, `${doc.id} coverage ${JSON.stringify(doc.coverage)}`);
    assert.deepEqual([...new Set(set.clubs.map(club => club.league))].sort(), Object.values(EA_LEAGUES).map(([league]) => league).sort());
    assert.ok(set.clubs.length >= 125, `${doc.id} has ${set.clubs.length} clubs`);
  }
});
