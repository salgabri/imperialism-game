// Rugby league's earlier seasons (docs/design/rugby-league.md, "Earlier seasons"): the 2008 NRL season from Rugby League
// 2: World Cup Edition's database, every player checked against the Rugby League Project's 2008 records, its overall
// converted from the game's attributes onto Rugby League 26's ratings position by position, its clubs on the map of 2008,
// and the running App launching and resuming it. Then the computed seasons, 1998–2007 and 2009–2024 ("Computed seasons"):
// every overall recomputed from its snapshot, the club shift from the season's own results, the clubs and maps of each era.
// Then the seasons before 1998, 1960–1997 and Super League's 1997 ("Computed seasons, 1960–1997"), computed from the
// Rugby League Project's lists of who started, where and how often: the same checks, and the clubs and grounds of the day.
// Each season plays its own day's points, scoring and extra time ("Rules by era"), its scoring the record's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SAVE_KEY } from '../src/config.js';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { CLUBS } from '../src/data/clubs.rugby-league.js';
import { BUILT_IN_RUGBY_LEAGUE_SEASONS } from '../src/data/rugbyLeagueSeasons.js';
import { buildClub, hashStr, makeRng, selectLineup, teamEff } from '../src/data/teams.js';
import { decodeDomestic } from '../src/engine/domestic.js';
import {
  BUILT_IN_SETS, builtInSeasonOf, decodeFootballSet, isEraMap, seasonMapOf, seasonSport, setHasClubs, setHasNations, setIsMapped, setKindOf,
  setSportOf, sportOf,
} from '../src/engine/footballSets.js';
import { parseCampaign } from '../src/engine/storage.js';
import { NRL_LEAGUE_AVERAGES } from '../src/data/nrlLeagueAverages.js';
import { marginPerStrength, rugbyLeague, rugbyLeagueIn, rulesOf } from '../src/sports/rugbyLeague.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { kmToPolys, pointInPolys } from './lib/domestic-partition.mjs';
import { playerOf } from './lib/nrl.mjs';
import {
  ATTRIBUTE_ORDER, CORE, CORE_REASONS, DEFAULTS, KEPT, NRLCOM_BENCH, NRLCOM_POSITION, PREVIOUS_WEIGHT, PRIMARY_POSITION, REASONS, RECORDED_SHARE, RLP_POSITION,
  TEAM_RATING_PARTS, WEIGHTS, bornAlike, clubGamesOf, clubOf, clubShiftOf, corePoints, drawGames, findListed, fold, leagueOf, mapOf, matchRecord, mostStarted,
  nameParts, overallOf, playSeasons, positionScore, readOff, readRl2Database, referenceOf, rlpGrid, rlpName, rlpPlayer, rlpPositions, rlpResults,
  RLP_CLUB_CODES, RLP_LIST_POSITION, SELECTION, checkListAgainstResults, clubsByCode, mostStartedListed, rlpRepresentative, rlpSeasonList, rlpSquadGames,
  rlpSurname, seasonFigures, seasonIdOf, seasonKeyOf, seasonPlayers, seasonValue, selectionValue, shifted, spearman, srsOf, statCensus, teamRatingOf, teamsOf,
  tookField, expectedWins, SPREAD, bestFirst, builtInStrengths, clubMoveOf, clubSquadOf, modelStrengthOf, spreadTargets,
} from './lib/rugby-league-seasons.mjs';
import { cachedList, leagueFigures, leagueScoring, rlpListTotals, seasonClubs, solveScoring } from './lib/nrl-league.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';
import { colourFor } from './lib/club-identity.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const MANIFEST = JSON.parse(read('scripts/data/rugby-league-seasons.json'));
const SOURCES = JSON.parse(read('scripts/data/rugby-league-seasons-sources.json')).sources;
const SNAPSHOT = JSON.parse(read('scripts/data/rugby-league-seasons/nrl-2008.json'));
const AUDITS = new Map(JSON.parse(read('docs/design/rugby-league-seasons-audit.json')).seasons.map(audit => [audit.id, audit]));
const AUDIT = AUDITS.get('nrl-2008');
const TEXT = read('public/rugby-league/nrl-2008.json');
const DOC = JSON.parse(TEXT);
const MAP_DOC = JSON.parse(read('public/domestic/nrl2008.json'));
const MAP = decodeDomestic(JSON.parse(read('public/domestic/nrl2008.json')), 'nrl2008');
const TEAMS = teamsOf(MANIFEST, 2008);
const PLAYERS = new Map(SNAPSHOT.players.map(([index, name, pos, born, star, attributes, score, overall, shift]) =>
  [index, { index, name, pos, born, star, attributes: Object.fromEntries(ATTRIBUTE_ORDER.map((key, i) => [key, attributes[i]])), score, overall, shift,
    rating: Math.min(99, Math.max(1, overall + (shift ?? 0))) }]));
const CLUB_PLAYERS = SNAPSHOT.clubs.flatMap(club => club.players.map(([index, rlp, how]) => ({ ...PLAYERS.get(index), club: club.id, rlp, how })));
const clubLists = new Set(SNAPSHOT.clubs.map(club => club.list));
const sectionAt = point => MAP.geo.countries.find(section => pointInPolys(point, section.polys))?.id ?? null;
const home = id => MAP.clubs.find(club => club.id === id).homeSection;
const getBuiltIn = () => sportOf({ sport: 'rugby-league', layer: 'nations' });

// ---------- building ----------

test('every season rebuilds byte for byte from its snapshot; the built-in season and its map are untouched', () => {
  assert.match(execFileSync(process.execPath, ['scripts/build-rugby-league-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the 66 rugby league seasons, the listing and the audit byte for byte/);
  assert.match(execFileSync(process.execPath, ['scripts/build-rugby-league.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the NRL clubs and the rugby league nations byte for byte/);
  // Every input is pinned by SHA-256: the database's zip, of each Rugby League Project page the part read, and of NRL.com's
  // replies what is read of each season's rounds and each round's games.
  assert.ok(Object.keys(SOURCES).length >= 70);
  assert.ok(Object.values(SOURCES).every(source => /^[0-9a-f]{64}$/.test(source.sha256) && /^https?:\/\//.test(source.url)));
  assert.deepEqual(Object.entries(SOURCES).filter(([, source]) => !source.pin).map(([file]) => file), ['rl2/aid56-RLDatabase.zip']);
  const nrlcom = Object.entries(SOURCES).filter(([key]) => key.startsWith('nrlcom/'));
  assert.deepEqual([...new Set(nrlcom.map(([key]) => Number(key.split('/')[1])))].sort((a, b) => a - b),
    Array.from({ length: 29 }, (_, i) => 1998 + i), 'NRL.com 1998–2026: each computed season and the two either side, none before 1998');
  assert.equal(MANIFEST.nrlcom.from, 1998, 'NRL.com\'s first season with team lists');
  assert.ok(nrlcom.every(([key, source]) => (key.split('/').length === 2 ? source.pin === 'rounds'
    : source.pin === 'round' && Number.isInteger(source.games) && source.url.startsWith('https://www.nrl.com/draw/data?competition=111&season='))));
  const rl2 = MANIFEST.seasons.find(season => season.id === 'nrl-2008');
  assert.equal(rl2.database.sha256, '4891f3deab5caeddc276af68d24aca65c867d533db96d1f8edb6812d5b6ef9c8', 'RLDatabase.xml itself');
  assert.deepEqual(SNAPSHOT.source.database, rl2.database);
});

const cached = existsSync(new URL('../data-src/rugby-league-seasons', import.meta.url));
test('the snapshot rebuilds from its pinned inputs', { skip: !cached && 'the inputs (data-src/rugby-league-seasons/) are not on this computer' }, () => {
  assert.match(execFileSync(process.execPath, ['scripts/sync-rugby-league-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the rugby league season snapshots byte for byte/);
});

test('the built-in season list has 2024 to 1960, newest first, Super League\'s 1997 beside the ARL\'s: clubs only, each on the map of its day', () => {
  const computed = years => years.map(year => [`nrl-${year}`, year, String(year), 'Computed from NRL.com match stats', mapOf(MANIFEST, year)]);
  const after = computed(Array.from({ length: 16 }, (_, i) => 2024 - i)), before = computed(Array.from({ length: 10 }, (_, i) => 2007 - i));
  // Before 1998, the premiership of its day: the NSWRFL's to 1983, the NSWRL's to 1994, the ARL's, and in 1997 Super League's too.
  const competition = year => (year <= 1983 ? 'NSWRFL' : year <= 1994 ? 'NSWRL' : 'ARL');
  const earlier = Array.from({ length: 38 }, (_, i) => 1997 - i).flatMap(year => [[`nrl-${year}`, year, String(year), `${competition(year)} (computed)`,
    mapOf(MANIFEST, year)], ...(year === 1997 ? [['nrl-sl-1997', 1997, '1997', 'Super League (computed)', 'sl1997']] : [])]);
  assert.deepEqual(BUILT_IN_RUGBY_LEAGUE_SEASONS.map(set => [set.id, set.year, set.season, set.label, set.map]),
    [...after, ['nrl-2008', 2008, '2008', 'Rugby League 2: World Cup Edition', 'nrl2008'], ...before, ...earlier]);
  assert.deepEqual(earlier.map(([id, , , , map]) => `${id} ${map}`).filter((_, i) => [0, 1, 2, 3, 4, 12, 18, 30, 38].includes(i)),
    ['nrl-1997 nrl1997', 'nrl-sl-1997 sl1997', 'nrl-1996 nrl1996', 'nrl-1995 nrl1995', 'nrl-1994 nrl1993', 'nrl-1986 nrl1984', 'nrl-1980 nrl1978',
      'nrl-1968 nrl1968', 'nrl-1960 nrl1960']);
  assert.deepEqual([...after, ...before].map(([, year, , , map]) => `${year} ${map}`), ['2024 nrl', '2023 nrl', '2022 nrl2020', '2021 nrl2020', '2020 nrl2020',
    '2019 nrl2012', '2018 nrl2012', '2017 nrl2012', '2016 nrl2012', '2015 nrl2012', '2014 nrl2012', '2013 nrl2012', '2012 nrl2012', '2011 nrl2010',
    '2010 nrl2010', '2009 nrl2008', '2007 nrl2007', '2006 nrl2006', '2005 nrl2003', '2004 nrl2003', '2003 nrl2003', '2002 nrl2002', '2001 nrl2001',
    '2000 nrl2000', '1999 nrl1999', '1998 nrl1998']);
  assert.deepEqual([...new Set(BUILT_IN_RUGBY_LEAGUE_SEASONS.map(set => set.year))].sort((a, b) => a - b), Array.from({ length: 65 }, (_, i) => 1960 + i),
    'no gap from 1960');
  assert.equal(BUILT_IN_RUGBY_LEAGUE_SEASONS.length, 66, 'two seasons in 1997');
  assert.deepEqual(builtInSeasonOf('rugby-league'), { year: 2025, season: '2025' }, 'the built-in season stays 2025');
  const listed = BUILT_IN_RUGBY_LEAGUE_SEASONS.find(set => set.id === 'nrl-2008');
  for (const set of BUILT_IN_RUGBY_LEAGUE_SEASONS) {
    assert.deepEqual(BUILT_IN_SETS.find(other => other.id === set.id), set);
    assert.deepEqual([setKindOf(set.id), setSportOf(set.id), setHasNations(set.id), setHasClubs(set.id), setIsMapped(set.id)],
      ['nrl', 'rugby-league', false, true, true]);
    assert.equal(seasonMapOf(set.id), set.map);
    // A premiership season's id is its year's; Super League's 1997 has its own (`nrl-sl-`, as the AFL's `pfa-afl-`).
    assert.equal(set.id, set.id === 'nrl-sl-1997' ? 'nrl-sl-1997' : seasonIdOf(set.year));
    assert.equal(seasonIdOf(seasonKeyOf(set)), set.id);
  }
  assert.equal(listed.version, DOC.version);
  const era = CLUB_MAPS.find(entry => entry.id === 'nrl2008');
  assert.deepEqual([era.sport, era.league, era.seasons, era.clubs, era.sections, era.venue, era.lines],
    ['rugby-league', 'NRL', ['nrl-2008', 'nrl-2009'], 16, 16, 'ground', 'state or region']);
  assert.ok(isEraMap('nrl2008') && !isEraMap('nrl'));
  assert.equal(CLUB_MAPS.find(entry => entry.id === 'nrl').seasons, undefined, 'today\'s map serves the built-in clubs, and 2023 and 2024');
});

// ---------- the database ----------

test('the database reader: twelve attributes, the game\'s positions, a first name of two words, copies told apart by place', () => {
  const entry = (name, dbIndex, primary, extra = '') => `<entry><name>${name}</name><db_index>${dbIndex}</db_index><year>1984</year><month>7</month>`
    + `<day>9</day><primary_position>${primary}</primary_position>${Object.keys({ fitness: 0, speed: 0, acceleration: 0, agressiveness: 0, aggressiveness: 0,
      agility: 0, break_tackle_ability: 0, tackle_ability: 0, pass_accuracy: 0, offload_ability: 0, general_kick_accuracy: 0, goal_kick_accuracy: 0,
      catch_ability: 0 }).map(tag => `<${tag}>6</${tag}>`).join('')}<star>70</star>${extra}</entry>`;
  const xml = `${String.fromCharCode(0xFEFF)}<?xml version="1.0"?><!-- a comment --><MabStream><database><dynamic_database><entry><players>${entry('Jean\\x20Philippe Baile', 0, 4)}`
    + `${entry('Hazem El Masri', 1, 2)}${entry('Chaz I\'Anson', 0, 1)}</players><num_players>3</num_players><teams><entry><name>Club</name>`
    + '<short_mnemonic>CLB</short_mnemonic><team_type>0</team_type><primary_comp>0</primary_comp><available>1</available>'
    + '<willingness_to_attack>7</willingness_to_attack><attack>7</attack><defense>6</defense><flair>6</flair><support>8</support>'
    + '<goal_kicker><entry>1</entry></goal_kicker><players><entry><index>2</index></entry><entry><index>1</index></entry></players><num_players>2</num_players>'
    + '<db_index>0</db_index></entry></teams><num_teams>1</num_teams></entry></dynamic_database></database></MabStream>';
  const { players, teams } = readRl2Database(xml);
  assert.deepEqual(players.map(p => [p.index, p.dbIndex, p.name, p.first, p.last, p.pos, p.born]), [
    [0, 0, 'Jean Philippe Baile', 'Jean Philippe', 'Baile', 'CE', '1984-07-09'],
    [1, 1, 'Hazem El Masri', 'Hazem', 'El Masri', 'WG', '1984-07-09'],
    [2, 0, 'Chaz I\'Anson', 'Chaz', 'I\'Anson', 'HB', '1984-07-09'],
  ]);
  assert.deepEqual(players[0].attributes, Object.fromEntries(ATTRIBUTE_ORDER.map(key => [key, 6])));
  assert.deepEqual(teams[0].players.map(i => players[i].name), ['Chaz I\'Anson', 'Hazem El Masri'], 'a list names its players by their place');
  assert.deepEqual(teams[0].ratings, { willingness: 7, attack: 7, defence: 6, flair: 6, support: 8 }, 'the five parts a side is rated by');
  assert.throws(() => readRl2Database(xml.replace('<flair>6</flair>', '<flair>11</flair>')), /flair 11 is not 1–10/);
  assert.throws(() => readRl2Database(xml.replace('<num_players>3</num_players>', '<num_players>4</num_players>')), /lists 3 players, not its 4/);
  assert.throws(() => readRl2Database(xml.replace('<agressiveness>6', '<agressiveness>5')), /aggressiveness values differ/);
  assert.deepEqual(PRIMARY_POSITION, ['FB', 'HB', 'WG', 'WG', 'CE', 'CE', 'FE', 'PR', 'HK', 'PR', 'SR', 'SR', 'LK']);
  // The 2008 clubs bear the order out.
  const at = name => CLUB_PLAYERS.find(p => p.name === name).pos;
  assert.deepEqual(['Billy Slater', 'Cooper Cronk', 'Hazem El Masri', 'Mark Gasnier', 'Darren Lockyer', 'Petero Civoniceva', 'Cameron Smith',
    'Nathan Hindmarsh', 'Dallas Johnson'].map(at), ['FB', 'HB', 'WG', 'CE', 'FE', 'PR', 'HK', 'SR', 'LK']);
  assert.equal(nameParts('Jeremy\\x20J Smith').first, 'Jeremy J');
});

// ---------- naming a player ----------

test('a database player is a Rugby League Project player by his name, or a near one and his date of birth', () => {
  const pool = [{ id: 1, first: 'Danny', last: 'WILLIAMS' }, { id: 2, first: 'Frank-Paul', last: 'NU\'UAUSALA' }, { id: 3, first: 'David', last: 'FA\'ALOGO' },
    { id: 4, first: 'David', last: 'WILLIAMS' }, { id: 5, first: 'Scott', last: 'GRIX' }];
  assert.deepEqual(findListed(pool, { first: 'Frank-Paul', last: 'Nuuausala' }), { entry: pool[1], how: 'name' });
  assert.deepEqual(findListed(pool.filter(entry => entry.id !== 4), { first: 'Dan', last: 'Williams' }), { entry: pool[0], how: 'surname and initial' });
  assert.deepEqual(findListed(pool, { first: 'David', last: 'Fa\'alago' }), { entry: pool[2], how: 'near spelling' });
  assert.equal(findListed(pool, { first: 'Dan', last: 'Williams' }), null, 'two Williamses with a D: nobody');
  assert.equal(findListed(pool, { first: 'Simon', last: 'Grix' }).how, 'surname and initial', 'loose: his date of birth decides');
  assert.equal(findListed(pool, { first: 'Joel', last: 'Smith' }), null);
  assert.equal(fold('Rémi Casty'), fold('Remi CASTY'));
  assert.ok(bornAlike('1986-06-14', '1986-08-14') && bornAlike('1986-10-01', '1986-10-01'));
  assert.ok(!bornAlike('1989-08-15', '1986-05-21') && !bornAlike(null, '1983-05-31') && !bornAlike('1986-06-13', '1986-08-14'));
  assert.deepEqual(rlpName('Adam MacDOUGALL'), { first: 'Adam', last: 'MacDOUGALL' });
  assert.deepEqual(rlpName('Sonny Bill WILLIAMS'), { first: 'Sonny Bill', last: 'WILLIAMS' });
  assert.deepEqual(rlpName('Hazem EL MASRI'), { first: 'Hazem', last: 'EL MASRI' });
  assert.deepEqual(rlpGrid('<table class="grid lines"><tr><td><a href="/players/742">Cameron SMITH</a></td></tr></table>'), [{ id: 742, first: 'Cameron', last: 'SMITH' }]);
  assert.deepEqual(rlpPlayer('<h1>Danny Williams</h1><dl><dt>Born</dt><dd>Wednesday, 1st October, 1986</dd><dt>Current Age</dt></dl>'),
    { name: 'Danny Williams', born: '1986-10-01' });
  assert.deepEqual(rlpResults('<table class="list is"><tr><th colspan="11"><a href="/seasons/nrl-2008/round-1/summary.html">Round 1</a></th></tr>'
    + '<tr><td>x</td><td class="team"><a href="/seasons/nrl-2008/melbourne/summary.html">Melbourne</a></td><td class="n">30</td>'
    + '<td class="team"><a href="/seasons/nrl-2008/warriors/summary.html">Warriors</a></td><td class="n">12</td></tr></table>'),
  [{ competition: null, round: 'Round 1', home: 'melbourne', away: 'warriors', homeScore: 30, awayScore: 12, venue: null }]);
  // A page that pads its cells and heads its rounds by month too (Super League's of 1997) reads the same, each game's ground with it.
  assert.deepEqual(rlpResults('<table class="list is"><tr><th colspan="10"> March 1997 </th></tr><tr><th colspan="10"><a href="/r">Round 1</a></th></tr>'
    + '<tr><th colspan="10"> April 1997 </th></tr><tr><td class="pad"><a href="/seasons/super-league-1997/cronulla/summary.html">Cronulla</a></td>'
    + '<td class="pad n">26</td><td class="pad"><a href="/seasons/super-league-1997/canberra-raiders/summary.html">Canberra</a></td><td class="pad n">4</td>'
    + '<td class="pad"><a href="/venues/9">Shark Park</a></td></tr></table>'),
  [{ competition: null, round: 'Round 1', home: 'cronulla', away: 'canberra-raiders', homeScore: 26, awayScore: 4, venue: [9, 'Shark Park'] }]);
});

test('a club keeps only the players RLP shows there in 2008; every other one is left out with the reason', () => {
  assert.equal(CLUB_PLAYERS.length, 414);
  const left = SNAPSHOT.left.filter(([team]) => clubLists.has(team));
  assert.equal(left.length, 48);
  assert.equal(CLUB_PLAYERS.length + left.length, 462, 'the database\'s 462 NRL players, each kept or left out');
  assert.ok(left.every(([, , , reason]) => typeof reason === 'string' && reason.length > 20));
  const why = name => left.find(([, , n]) => n === name)[3];
  assert.match(why('Luke Harlen'), /played for North Queensland Cowboys in 2008, not Wests Tigers/, 'on the wrong club');
  assert.match(why('Joel Rapana'), /Jordan Rapana \(7848\) was born 1989-08-15/, 'another player of a near name');
  assert.match(why('Craig Frawley'), /played for Brisbane Broncos in 2007, no 2008 game/);
  assert.match(why('Hutch Maiava'), /not shown to be a real player of the club/);
  // Every kept player is one RLP player, named once, by a name or (with his date of birth) a near one.
  assert.equal(new Set(CLUB_PLAYERS.map(p => p.rlp)).size, CLUB_PLAYERS.length);
  assert.ok(CLUB_PLAYERS.every(p => ['name', 'surname and initial', 'near spelling'].includes(p.how)));
  // A near name plays under RLP's spelling; the snapshot keeps the database's.
  assert.deepEqual(CLUB_PLAYERS.filter(p => p.how !== 'name').map(p => [SNAPSHOT.spelled[p.index], p.name]).sort(), [['Adrian Guerra', 'Aidan Guerra'],
    ['Darryl Millard', 'Daryl Millard'], ['David Fa\'alago', 'David Fa\'alogo'], ['David Taylor', 'Dave Taylor'], ['Dan Williams', 'Danny Williams'],
    ['Jeremy J Smith', 'Jeremy Smith'], ['Karlos Filiga', 'Karl Filiga'], ['Matt Keating', 'Matthew Keating'], ['Michael Luck', 'Micheal Luck'],
    ['Steven Bell', 'Steve Bell']].sort());
  assert.equal(AUDIT.left.length, SNAPSHOT.left.length, 'the audit lists every one');
  assert.ok(AUDIT.left.includes(`Wests Tigers: Luke Harlen: ${why('Luke Harlen')}`));
});

// ---------- the overall ----------

test('each position\'s score weighs what its job asks for, every weight with its reason, and no default counts', () => {
  for (const [pos, weights] of Object.entries(WEIGHTS)) {
    assert.equal(Object.values(weights).reduce((s, w) => s + w, 0), 100, `${pos} weighs to 100`);
    assert.deepEqual(Object.keys(REASONS[pos]).sort(), Object.keys(weights).sort(), `${pos}: a reason for every weight`);
    assert.ok(Object.values(REASONS[pos]).every(reason => reason.length > 10));
    assert.ok(!('GKA' in weights), `goal-kicking is no ${pos}'s job`);
    assert.equal('KCK' in weights, pos === 'HB' || pos === 'FE', 'general kicking only for the halves');
  }
  assert.deepEqual(Object.keys(WEIGHTS), ['FB', 'WG', 'CE', 'FE', 'HB', 'HK', 'PR', 'SR', 'LK']);
  assert.deepEqual(DEFAULTS, { FIT: 7, KCK: 4, GKA: 3 });
  const base = { FIT: 9, SPD: 6, ACC: 6, AGG: 6, AGI: 6, BRK: 8, TKL: 8, PAS: 5, OFF: 6, KCK: 6, GKA: 9, CAT: 6 };
  // A prop's score is his weighted mean: fitness counts when rated, not when left at its default 7; goal-kicking never.
  const six = x => Math.round(x * 1e6) / 1e6;
  assert.equal(positionScore('PR', base), six((25 * 8 + 25 * 8 + 15 * 6 + 15 * 6 + 5 * 6 + 5 * 6 + 10 * 9) / 100));
  assert.equal(positionScore('PR', { ...base, FIT: 7 }), six((25 * 8 + 25 * 8 + 15 * 6 + 15 * 6 + 5 * 6 + 5 * 6) / 90));
  assert.equal(positionScore('PR', { ...base, GKA: 1 }), positionScore('PR', base));
  assert.equal(positionScore('HB', { ...base, KCK: 4 }), positionScore('HB', { ...base, KCK: 4, PAS: 5 }), 'a default kick is no information');
  assert.ok(positionScore('HB', { ...base, KCK: 9 }) > positionScore('HB', base));
  assert.equal(positionScore('WG', { ...base, KCK: 10 }), positionScore('WG', base), 'a winger\'s kicking does not count');
});

test('the overall is read off Rugby League 26\'s ratings at each position: recomputable, monotonic and within 1–99', () => {
  const { conversion } = SNAPSHOT;
  assert.deepEqual(conversion.weights, WEIGHTS);
  assert.deepEqual(conversion.defaults, DEFAULTS);
  const builtIn = JSON.parse(read('scripts/data/rugby-league-26.json')).players.map(playerOf).map(p => ({ name: p.name, club: p.club, pos: p.pos, rating: p.rating }));
  for (const pos of Object.keys(WEIGHTS)) {
    const at = CLUB_PLAYERS.filter(p => p.pos === pos);
    assert.equal(conversion.quota[pos], Math.round(at.length / 16 * 1e4) / 1e4);
    assert.deepEqual(conversion.reference[pos], referenceOf(builtIn, pos, conversion.quota[pos]), `${pos}: 2025's overalls, as many a club as 2008's`);
    assert.deepEqual(conversion.scores[pos], at.map(p => p.score).sort((a, b) => a - b));
  }
  for (const player of PLAYERS.values()) {
    assert.equal(player.score, positionScore(player.pos, player.attributes), `${player.name}'s score`);
    assert.equal(player.overall, overallOf(player.score, conversion.scores[player.pos], conversion.reference[player.pos]), `${player.name}'s overall`);
    assert.ok(player.overall >= 1 && player.overall <= 99);
  }
  for (const pos of Object.keys(WEIGHTS)) {
    const at = CLUB_PLAYERS.filter(p => p.pos === pos).sort((a, b) => a.score - b.score);
    assert.ok(at.every((p, i) => !i || p.overall >= at[i - 1].overall), `${pos}: a higher score never rates lower`);
    const reference = conversion.reference[pos];
    assert.ok(at[0].overall >= reference[0] && at.at(-1).overall <= reference.at(-1), `${pos}: within 2025's range`);
  }
  // Mid-rank percentiles: ties share one; a score between two takes its place.
  assert.equal(overallOf(5, [1, 5, 5, 9], [60, 70, 80, 90]), 75);
  assert.equal(overallOf(10, [1, 5, 5, 9], [60, 70, 80, 90]), 90);
  assert.equal(overallOf(0, [1, 5, 5, 9], [60, 70, 80, 90]), 60);
  // Readings the game's own top players bear out.
  const rated = name => CLUB_PLAYERS.find(p => p.name === name).overall;
  assert.ok(rated('Cameron Smith') >= 90 && rated('Darren Lockyer') >= 90 && rated('Billy Slater') >= 90 && rated('Matt Orford') >= 90);
});

test("each club moves by its team rating: read off the built-in clubs' strengths, one whole number for all its players", () => {
  const { clubShift } = SNAPSHOT.conversion;
  assert.deepEqual(clubShift.parts, ['willingness_to_attack', 'attack', 'defense', 'flair', 'support']);
  assert.deepEqual(Object.values(TEAM_RATING_PARTS), clubShift.parts);
  assert.deepEqual(clubShift.reference, CLUBS.map(club => club.str).sort((a, b) => a - b), "the built-in 2025 NRL clubs' strengths");
  assert.equal(teamRatingOf({ willingness: 7, attack: 7, defence: 6, flair: 6, support: 8 }), 6.8, 'an equal-weight mean of the five');
  const ratings = SNAPSHOT.clubs.map(club => club.team.parts.reduce((sum, part) => sum + part, 0) / 5);
  SNAPSHOT.clubs.forEach((club, i) => {
    const { team } = club;
    assert.equal(team.rating, Math.round(ratings[i] * 1000) / 1000);
    assert.equal(team.target, Math.round(readOff(ratings[i], ratings, clubShift.reference) * 100) / 100, `${club.id}'s target`);
    const pool = club.players.map(([index]) => ({ name: PLAYERS.get(index).name, pos: PLAYERS.get(index).pos, rating: PLAYERS.get(index).overall }));
    assert.deepEqual(clubShiftOf(pool, team.target), { shift: team.shift, before: team.strength, after: team.shifted }, `${club.id}'s shift`);
    assert.ok(club.players.every(([index]) => PLAYERS.get(index).shift === team.shift), 'every player of the club moves alike');
    assert.ok(Math.abs(team.shifted - team.target) <= 0.5 + 1e-9, `${club.id} lands within half a point of its target`);
    const listed = DOC.clubs.find(c => c.id === club.id);
    assert.equal(listed.str, team.shifted, 'the season plays the shifted strength');
  });
  // Ties share a target; the order of team ratings is the order of targets.
  const byRating = SNAPSHOT.clubs.slice().sort((a, b) => a.team.rating - b.team.rating);
  assert.ok(byRating.every((club, i) => !i || club.team.target >= byRating[i - 1].team.target));
  const at = id => SNAPSHOT.clubs.find(club => club.id === id).team;
  assert.deepEqual([at('nrl-melbourne-storm').target, at('nrl-manly-warringah-sea-eagles').target], [at('nrl-north-queensland-cowboys').target,
    at('nrl-north-queensland-cowboys').target], 'three clubs rated 7.6 share one');
  assert.deepEqual([at('nrl-sydney-roosters').shift, at('nrl-south-sydney-rabbitohs').shift, at('nrl-penrith-panthers').shift], [3, -1, -2]);
  // A player keeps his place in his club: the shift is one number, held to 1–99.
  assert.deepEqual(shifted([{ rating: 97 }, { rating: 60 }, { rating: 2 }], 3).map(p => p.rating), [99, 63, 5]);
  assert.deepEqual(shifted([{ rating: 97 }, { rating: 2 }], -3).map(p => p.rating), [94, 1]);
  assert.ok(PLAYERS.size > CLUB_PLAYERS.length && [...PLAYERS.values()].filter(p => p.shift === null).length === PLAYERS.size - CLUB_PLAYERS.length,
    "a national squad's player outside the clubs has no shift");
  assert.match(DOC.source.conversion, /Then each club is shifted: its team rating, the equal-weight mean/);
  assert.equal(AUDIT.clubShift.length, 16);
  assert.ok(AUDIT.clubShift.includes('Sydney Roosters: team rating 8 (8/9/8/8/7), target 85.08, shift +3, strength 82.5 → 85.5'));
});

test('the star value is a cross-check, never an input: it ranks with the overall but picks out the elite little better', () => {
  const { star } = SNAPSHOT.conversion;
  assert.ok(star.spearman > 0.4 && star.spearman < 0.6, `Spearman ${star.spearman}`);
  assert.ok(star.eliteAuc.overall > 0.7 && Math.abs(star.eliteAuc.star - star.eliteAuc.overall) < 0.05, JSON.stringify(star.eliteAuc));
  assert.ok(star.testPlayers > 80 && star.elitePlayers > 60);
  assert.equal(positionScore.length, 2, 'the score takes a position and attributes, nothing else');
});

// ---------- the clubs ----------

test('the clubs of 2008: no Dolphins, the Bulldogs as they were named, each at its ground of the day', () => {
  const set = decodeFootballSet(DOC, 'nrl-2008');
  assert.deepEqual([set.meta.kind, set.meta.year, set.meta.season, set.meta.map, set.meta.source.provider, set.meta.source.rawScale],
    ['nrl', 2008, '2008', 'nrl2008', 'Sidhe', 10]);
  assert.match(set.meta.source.conversion, /weighted mean of the attributes/);
  assert.equal(set.rosters, null, 'clubs only');
  assert.equal(DOC.clubs.length, 16);
  assert.ok(!DOC.clubs.some(club => club.id === 'nrl-dolphins'));
  const grounds = new Map(MAP_DOC.clubs.map(club => [club.id, club.arena]));
  for (const club of DOC.clubs) {
    const team = TEAMS.find(t => t.id === club.id);
    assert.ok(team, `${club.name} is a club of 2008`);
    assert.deepEqual([club.name, club.code, club.league, club.country], [team.name, team.code, 'NRL', team.country]);
    assert.equal(club.col, CLUBS.find(c => c.id === team.franchise).col, 'the franchise\'s colour');
    assert.equal(grounds.get(club.id), team.ground);
    const land = MAP.geo.countries.find(section => section.id === home(club.id)).polys;
    assert.ok(kmToPolys(team.home, land) <= 1, `${club.name} grows from its own territory`);
    assert.equal(MAP.sectionNames[home(club.id)], team.city);
  }
  const bulldogs = DOC.clubs.find(club => club.id === 'nrl-bulldogs');
  assert.deepEqual([bulldogs.name, bulldogs.code], ['Bulldogs', 'BUL'], 'the Bulldogs, 2000–2009');
  assert.equal(grounds.get('nrl-melbourne-storm'), 'Olympic Park Stadium');
  assert.equal(grounds.get('nrl-north-queensland-cowboys'), 'Dairy Farmers Stadium');
  // The state rule, as on today's map: Queensland three ways, New South Wales ten, every other state one club's or nobody's.
  assert.equal(sectionAt([144.9839, -37.8253]), home('nrl-melbourne-storm'), 'Victoria is the Storm\'s');
  assert.equal(sectionAt([149.13, -35.28]), home('nrl-canberra-raiders'), 'the ACT is the Raiders\'');
  assert.equal(sectionAt([174.76, -36.85]), home('nrl-new-zealand-warriors'), 'Auckland is the Warriors\'');
  assert.equal(sectionAt([175.28, -37.79]), null, 'Hamilton is nobody\'s');
  assert.equal(sectionAt([153.0972, -27.2189]), home('nrl-brisbane-broncos'), 'Redcliffe is the Broncos\', with no Dolphins');
  assert.equal(sectionAt([145.77, -16.92]), home('nrl-north-queensland-cowboys'), 'Cairns is North Queensland\'s');
  assert.equal(sectionAt([150.9025, -34.4278]), home('nrl-st-george-illawarra-dragons'));
  const sydney = ['nrl-sydney-roosters', 'nrl-south-sydney-rabbitohs', 'nrl-wests-tigers', 'nrl-bulldogs', 'nrl-parramatta-eels', 'nrl-penrith-panthers',
    'nrl-cronulla-sutherland-sharks', 'nrl-manly-warringah-sea-eagles'];
  assert.equal(new Set(sydney.map(home)).size, 8);
  const empty = new Set(MAP_DOC.topology.objects.empty.geometries.map(g => g.id));
  for (const region of ['AU-WA', 'AU-SA', 'AU-TAS', 'AU-NT', 'NZ-CAN', 'NZ-WGN']) assert.ok(empty.has(region), `${region} is empty`);
});

test('every club fields its matchday 17 from its own players and depth behind it; nobody is added', () => {
  const sport = seasonSport(decodeFootballSet(DOC, 'nrl-2008'));
  assert.deepEqual([sport.id, sport.dataSet, sport.dataYear, sport.dataSeason, sport.dataLabel, sport.clubMap],
    ['rugby-league', 'nrl-2008', 2008, '2008', 'Rugby League 2: World Cup Edition', 'nrl2008']);
  const overall = new Map(CLUB_PLAYERS.map(p => [`${p.club}|${p.name}`, p]));
  for (const club of sport.clubs) {
    const team = buildClub(club, sport);
    assert.ok(team.squad.length >= 17 && team.squad.length <= 24, `${club.name} names ${team.squad.length}`);
    assert.ok(team.squad.every(p => !p.gen), 'no generated player');
    for (const [name, pos, rating] of club.squad) {
      const player = overall.get(`${club.id}|${name}`);
      assert.deepEqual([pos, rating], [player.pos, Math.min(99, Math.max(1, player.overall + player.shift))], `${name}: his overall, his club's shift added`);
    }
    const lineup = selectLineup(team);
    assert.equal(lineup.rating, club.str, `${club.name}'s strength is its lineup's`);
    assert.equal(lineup.slots.length, 17);
    assert.ok(lineup.slots.every(slot => slot.player), `${club.name} fills all seventeen`);
  }
  const strengths = sport.clubs.map(club => club.str);
  assert.ok(Math.min(...strengths) >= 79 && Math.max(...strengths) <= 86, `club strengths ${Math.min(...strengths)}–${Math.max(...strengths)}`);
  // Manly's list has no five-eighth: the game plays its fullback there and a centre at fullback.
  const manly = selectLineup(buildClub(sport.clubs.find(club => club.id === 'nrl-manly-warringah-sea-eagles'), sport));
  assert.equal(manly.slots.find(slot => slot.position === 'FE').player.name, 'Brett Stewart');
});

test('the nations are not fielded: Super League\'s players are rated on a kinder scale than the NRL\'s', () => {
  assert.equal(setHasNations('nrl-2008'), false);
  assert.equal(sportOf({ sport: 'rugby-league', layer: 'nations', dataSet: 'nrl-2008' }), getBuiltIn(), 'nations play the built-in season');
  const { scales } = SNAPSHOT.conversion;
  const kinder = Object.keys(WEIGHTS).filter(pos => scales.score[pos][1] > scales.score[pos][0]);
  assert.ok(kinder.length >= 7, `Super League scores higher at ${kinder.join(', ')}`);
  assert.ok(scales.attributes.TKL[1] > scales.attributes.TKL[0] && scales.attributes.BRK[1] > scales.attributes.BRK[0]);
  assert.equal(AUDIT.nations.fielded, false);
  const strength = name => Number(AUDIT.nations.squads.find(line => line.startsWith(`${name}:`)).match(/all (\d+)/)[1]);
  assert.ok(strength('England') > strength('Australia'), 'read off the clubs\' scale, England would lead');
  assert.match(AUDIT.nations.squads.find(line => line.startsWith('France:')), /0 of them NRL players; all \d+, NRL players only none/);
  // The checked squads are kept in the snapshot: ten World Cup nations, each player one RLP shows in its 2008 squad.
  assert.deepEqual(SNAPSHOT.nations.map(nation => nation.list), ['Australia', 'New Zealand', 'England', 'France', 'Papua New Guinea', 'Fiji', 'Samoa',
    'Tonga', 'Scotland', 'Ireland']);
  assert.deepEqual(SNAPSHOT.carriedOver.map(([name]) => name), MANIFEST.carriedOver['2008']);
  assert.ok(SNAPSHOT.players.some(([, name]) => name === 'Joel Taufa\'ao'), 'an encoding slip mended');
});

test('the loader refuses an NRL season that is not the builder\'s', () => {
  const broken = edit => { const copy = JSON.parse(TEXT); edit(copy); return () => decodeFootballSet(copy, copy.id); };
  assert.throws(broken(d => { delete d.source.conversion; }), /source conversion must say how the overalls were derived/);
  assert.throws(broken(d => { d.map = 'nhl2007'; }), /map "nhl2007" is not one of Rugby's maps listing this season/);
  assert.throws(broken(d => { d.map = 'nrl'; }), /clubs must be the 17 of map nrl, found 16/, "today's map is today's clubs'");
  assert.throws(broken(d => { d.season = '2007/08'; }), /season "2007\/08" must be "2008"/);
  assert.throws(broken(d => { d.clubs[0].squad[0][1] = 'QB'; }), /is not one of the sport's/);
  assert.throws(broken(d => { d.clubs[0].squad[0][2] = 100; }), /rating must be a whole number 1-99/);
  assert.throws(broken(d => { d.clubs.pop(); }), /clubs must be the 16 of map nrl2008/);
  assert.throws(broken(d => { d.clubs[0].squad = d.clubs[0].squad.slice(0, 16); }), /needs at least 17 players/);
  assert.throws(broken(d => { d.clubs[0].id = 'nhl-boston-bruins'; }), /must look like the built-in clubs'/);
  assert.throws(broken(d => { d.nations = {}; }), /has clubs only/);
});

// ---------- the season played ----------

/** A season's own rules (rugbyLeagueIn): its day's points and extra time at its scoring. */
const rulesOfSeason = id => rugbyLeagueIn({ dataSet: id, dataYear: MANIFEST.seasons.find(season => season.id === id).year });

test("the 2008 clubs play NRL-like seasons; their order, a check only, comes nearer 2008's with the shift", () => {
  const report = playSeasons(DOC.clubs, { seasons: 40, seed: 20261108, sport: rulesOfSeason('nrl-2008') });
  const real = SNAPSHOT.real.figures;
  assert.deepEqual([real.games, real.bestWins, real.worstWins, real.draws], [192, 17, 5, 1], 'the real 2008 regular season, from RLP');
  assert.deepEqual(SNAPSHOT.real.ladder[0].slice(0, 4), ['nrl-melbourne-storm', 17, 0, 7], 'Melbourne the minor premiers');
  assert.ok(Math.abs(report.pointsPerTeam - real.pointsPerTeam) < 0.6, `points a team ${report.pointsPerTeam}, 2008's ${real.pointsPerTeam}`);
  assert.ok(report.marginMean > 12 && report.marginMean < 19, `mean margin ${report.marginMean}`);
  assert.ok(report.winPctSd > 0.12 && report.winPctSd < 0.23, `win% SD ${report.winPctSd}`);
  assert.ok(report.bestWins > 15 && report.bestWins < 22 && report.worstWins > 2 && report.worstWins < 8);
  // The real season checks the shift and never sets it: the clubs' strengths unshifted rank against its wins at -0.16, shifted
  // at 0.36, and the model's wins follow.
  const wins = new Map(SNAPSHOT.real.ladder.map(([id, won, drawn]) => [id, won + drawn / 2]));
  const byStrength = key => spearman(SNAPSHOT.clubs.map(club => club.team[key]), SNAPSHOT.clubs.map(club => wins.get(club.id)));
  assert.deepEqual([byStrength('strength'), byStrength('shifted')].map(rho => Math.round(rho * 100) / 100), [-0.16, 0.36]);
  assert.deepEqual(AUDIT.strengthAndResults, { attributes: -0.158, shifted: 0.358 });
  const rho = spearman(report.clubs.map(club => club.wins), report.clubs.map(club => wins.get(club.id)));
  assert.ok(rho > 0.15 && rho < 0.6, `the model's wins rank against 2008's at ${rho.toFixed(2)}`);
});

// ---------- the computed seasons, 2009–2024 ----------

const ORDER = ['FB', 'WG', 'CE', 'FE', 'HB', 'HK', 'PR', 'SR', 'LK'];
// The seasons computed from NRL.com's match stats; those before 1998 (`basis` "selection") have their own section below.
const COMPUTED = MANIFEST.seasons.filter(season => season.method === 'computed' && season.basis !== 'selection');
const SELECTED = MANIFEST.seasons.filter(season => season.basis === 'selection');
const SELECTED_SNAPSHOTS = new Map(SELECTED.map(season => [season.id, JSON.parse(read(`scripts/data/rugby-league-seasons/${season.id}.json`))]));
const SELECTED_DOCS = new Map(SELECTED.map(season => [season.id, JSON.parse(read(`public/rugby-league/${season.id}.json`))]));
/** The English Wikipedia articles a note cites, "(English Wikipedia, Title)" (a title may end in a year: "… (1988)"). */
const citedArticles = note => [...String(note ?? '').matchAll(/\(English Wikipedia, ((?:[^()]|\(\d{4}\))+)\)/g)].map(m => m[1]);
const SNAPSHOTS = new Map(COMPUTED.map(season => [season.id, JSON.parse(read(`scripts/data/rugby-league-seasons/${season.id}.json`))]));
const DOCS = new Map(COMPUTED.map(season => [season.id, JSON.parse(read(`public/rugby-league/${season.id}.json`))]));
const RL26 = JSON.parse(read('scripts/data/rugby-league-26.json')).players.map(playerOf).map(p => ({ name: p.name, club: p.club, pos: p.pos, rating: p.rating }));
const rowOf = ([nrlId, name, club, pos, how, games, clubs, sums, previous, value, overall, shift]) =>
  ({ nrlId, name, club, pos, how, games, clubs, sums, previous, value, overall, shift });
const round = (x, digits) => Math.round(x * 10 ** digits) / 10 ** digits;
/** A team-list row as matchRecord keeps it: [id, name, position, jersey, ...KEPT]. */
const listed = (id, position, jersey, stats = {}) => [id, `Player ${id}`, position, jersey, ...KEPT.map(stat => stats[stat] ?? 0)];

// What each computed season's value counts, as its source.metric names it: every season from 2004 counts all eleven
// stats with the season before; NRL.com recorded six in 1998 and eight from 1999 to 2002, and 1998, 1999 and 2003 stand
// alone (no season before on NRL.com, or one that recorded fewer stats).
const ELEVEN = 'core points a club game: NRL Fantasy\'s points for eleven NRL.com stats, the season before at half weight';
const METRIC = {
  1998: 'core points a club game: NRL Fantasy\'s points for the six NRL.com stats recorded in 1998, the season alone',
  1999: 'core points a club game: NRL Fantasy\'s points for the eight NRL.com stats recorded in 1999, the season alone',
  2000: 'core points a club game: NRL Fantasy\'s points for the eight NRL.com stats recorded in 1999 and 2000, the season before at half weight',
  2001: 'core points a club game: NRL Fantasy\'s points for the eight NRL.com stats recorded in 2000 and 2001, the season before at half weight',
  2002: 'core points a club game: NRL Fantasy\'s points for the eight NRL.com stats recorded in 2001 and 2002, the season before at half weight',
  2003: 'core points a club game: NRL Fantasy\'s points for eleven NRL.com stats, the season alone',
};

test('the computed seasons are 1998 to 2007 and 2009 to 2024: one method, clubs only, the method stated in the source', () => {
  assert.deepEqual(COMPUTED.map(season => season.year), [...Array.from({ length: 10 }, (_, i) => 1998 + i), ...Array.from({ length: 16 }, (_, i) => 2009 + i)]);
  for (const season of COMPUTED) {
    const doc = DOCS.get(season.id);
    const { meta } = decodeFootballSet(doc, season.id);
    assert.deepEqual([meta.kind, meta.year, meta.season, meta.label, meta.source.provider, meta.source.method],
      ['nrl', season.year, String(season.year), 'Computed from NRL.com match stats', 'NRL.com', 'computed']);
    assert.equal(meta.source.rawScale, undefined, 'no game\'s scale');
    assert.equal(meta.source.metric, METRIC[season.year] ?? ELEVEN, season.id);
    assert.match(meta.source.conversion, new RegExp(`^No game rated the ${season.year} season`));
    assert.match(meta.source.conversion, /the season's results set each club's level and how far apart the clubs play, while its players keep their order/);
    assert.equal(setHasNations(season.id), false, 'clubs only: a nations game plays the built-in nations');
  }
  // The seasons 2009–2024 read as they did before 1998–2007 joined: their formula names no stat NRL.com did not record.
  for (const year of [2004, 2009, 2024]) assert.doesNotMatch(DOCS.get(`nrl-${year}`).source.conversion, /NRL\.com recorded|the season's alone/);
  assert.match(DOCS.get('nrl-1998').source.conversion, /NRL\.com recorded six of the eleven in 1998 \(`stats`: tries, line breaks, tackles, missed tackles, offloads and errors; its run metres cover only some runs/);
  assert.match(DOCS.get('nrl-1998').source.conversion, /NRL\.com has no team lists before 1998: 1998's values are the season's alone/);
  assert.match(DOCS.get('nrl-2003').source.conversion, /it recorded fewer in 2002: 2003's values are the season's alone/);
});

test("a game counts NRL Fantasy's points for eleven stats and goals nowhere; the season before at half weight, when he played", () => {
  assert.deepEqual(CORE, { tries: 8, tryAssists: 5, lineBreaks: 4, lineBreakAssists: 2, tacklesMade: 1, missedTackles: -2, tackleBreaks: 2,
    offloads: 4, errors: -2, allRunMetres: 1 / 10, kickMetres: 1 / 30 });
  assert.deepEqual(Object.keys(CORE_REASONS), Object.keys(CORE), 'a reason for every weight');
  assert.ok(Object.values(CORE_REASONS).every(reason => reason.length > 15));
  assert.ok(!Object.keys(CORE).some(stat => /goal|point/i.test(stat)), 'goals, field goals and points count nowhere');
  assert.deepEqual(KEPT.slice(Object.keys(CORE).length), ['minutesPlayed', 'goals', 'fieldGoals']);
  assert.equal(PREVIOUS_WEIGHT, 0.5);
  // A try, a try assist, a line break and its assist, 30 tackles, 2 missed, 3 tackle breaks, 2 offloads, an error, 105
  // metres run and 95 kicked: exact, in thirtieths.
  assert.equal(corePoints([1, 1, 1, 1, 30, 2, 3, 2, 1, 105, 95]), 70.6667);
  assert.throws(() => corePoints([1, 1, 1, 1, 30, 2, 3, 2, 1, 105.5, 95]), /not a whole number/);
  assert.equal(seasonValue({ points: 300, clubGames: 24 }), 12.5, 'no season before: the season alone');
  assert.equal(seasonValue({ points: 300, clubGames: 24 }, { points: 200, clubGames: 25 }), round((300 + 100) / (24 + 12.5), 6));
  assert.equal(clubGamesOf([['a', 10], ['b', 3]], { a: 24, b: 25 }), 24.5, 'two clubs: the mean of their games');
  for (const snapshot of SNAPSHOTS.values()) {
    assert.deepEqual(snapshot.conversion.core.weights, CORE);
    assert.deepEqual(snapshot.conversion.core.reasons, CORE_REASONS);
    assert.equal(snapshot.conversion.previous, PREVIOUS_WEIGHT);
    assert.deepEqual(snapshot.conversion.kept, KEPT);
  }
  // A stat NRL.com did not record scores nothing: only the stats counted add up.
  assert.equal(corePoints([1, 1, 1, 1, 30, 2, 3, 2, 1, 105, 95], ['tries', 'tacklesMade', 'missedTackles', 'offloads', 'errors']), 8 + 30 - 4 + 8 - 2);
  assert.equal(corePoints([1, 1, 1, 1, 30, 2, 3, 2, 1, 105, 95], Object.keys(CORE)), 70.6667, 'all eleven: as before');
  assert.throws(() => corePoints([1, 1, 1, 1, 30, 2, 3, 2, 1, 105, 95], ['goals']), /not CORE's stats/);
});

test('a value counts the stats NRL.com recorded that season, and the season before only when it recorded the same', () => {
  // A stat is recorded when it appears in 95% of a season's games with team lists; the manifest marks one recorded in part.
  const game = (...rows) => ({ home: { players: rows }, away: { players: [] } });
  const twenty = Array.from({ length: 20 }, (_, i) => game(listed(i, 'Prop', 8, { tacklesMade: 30, tries: i < 19 ? 1 : 0, allRunMetres: i < 18 ? 90 : 0 })));
  const census = statCensus([...twenty, { home: { players: null }, away: { players: null } }]);
  assert.equal(census.games, 20, 'a game without team lists is not counted');
  assert.deepEqual(census.recorded, ['tries', 'tacklesMade'], 'tries in 19 of 20 games (95%), run metres in 18 (90%)');
  assert.deepEqual(statCensus(twenty, ['tries']).recorded, ['tacklesMade'], 'a stat recorded in part');
  assert.equal(RECORDED_SHARE, 0.95);
  assert.deepEqual(Object.keys(MANIFEST.nrlcom.partial), ['1998']);
  assert.match(MANIFEST.nrlcom.partial['1998'].allRunMetres, /^cover only some runs/);
  const counts = { 1998: 6, 1999: 8, 2000: 8, 2001: 8, 2002: 8 };
  for (const [id, snapshot] of SNAPSHOTS) {
    const year = Number(id.slice(4)), { stats } = snapshot.conversion;
    assert.equal(stats.counted.length, counts[year] ?? 11, `${id} counts ${stats.counted.join(', ')}`);
    assert.deepEqual(stats.counted, stats.census[year].recorded, id);
    for (const [at, entry] of Object.entries(stats.census)) {
      const recorded = Object.keys(CORE).filter((stat, i) => entry.given[i] >= RECORDED_SHARE * entry.games && !(entry.partial ?? []).includes(stat));
      assert.deepEqual(entry.recorded, recorded, `${id}: what NRL.com recorded in ${at}`);
      assert.deepEqual(entry.partial ?? [], Object.keys(MANIFEST.nrlcom.partial[at] ?? {}));
    }
    assert.equal(stats.seasonBefore, ![1998, 1999, 2003].includes(year), `${id}: the season before counts when NRL.com recorded the same stats`);
    assert.equal(stats.seasonBefore, Boolean(stats.census[year - 1]) && stats.census[year - 1].recorded.join() === stats.counted.join());
    assert.equal(Boolean(stats.census[year - 1]), year > 1998, 'no season before 1998 on NRL.com');
    if (!stats.seasonBefore) assert.ok(snapshot.players.every(row => row[8] === null), `${id}: the season alone`);
    else assert.ok(snapshot.players.filter(row => row[8]).length > 0.5 * snapshot.players.length, `${id}: most played the season before`);
  }
  // From 2003 NRL.com recorded every stat in nearly every game: 2003–2024's census at 96% or more each (2004's line-break assists).
  for (const [id, snapshot] of SNAPSHOTS) {
    const year = Number(id.slice(4)), { census } = snapshot.conversion.stats;
    if (year >= 2003) assert.ok(census[year].given.every(n => n >= 0.96 * census[year].games), `${id}: ${census[year].given.join(' ')} of ${census[year].games}`);
  }
});

test('who took the field and where: a start is the team list\'s position whatever the jersey; the bench counts with minutes or a stat', () => {
  assert.ok(tookField(listed(1, 'Prop', 15)), 'a prop in 15 started');
  assert.ok(!tookField(listed(2, 'Replacement', 18)), 'an unused 18th man has no game');
  assert.ok(!tookField(listed(3, 'Interchange', 14, { goals: 0 })), 'nor an unused interchange');
  assert.ok(tookField(listed(4, 'Interchange', 14, { minutesPlayed: 21 })));
  assert.ok(tookField(listed(5, 'Interchange', 16, { tacklesMade: 9 })), 'a game NRL.com kept no minutes for: his stats show he played');
  assert.ok(tookField(listed(6, 'Reserve', 19, { minutesPlayed: 8 })), 'a 19th man brought on');
  assert.throws(() => tookField(listed(7, 'Waterboy', 20)), /no position NRL.com uses/);
  assert.deepEqual(Object.values(NRLCOM_POSITION).sort(), ORDER.slice().sort());
  assert.deepEqual(NRLCOM_BENCH, ['Interchange', 'Replacement', 'Reserve', 'Unknown']);
  // A season of three games: player 1 starts twice at prop (once in 15) and once at lock, for two clubs.
  const game = (order, home, away, rows) => ({ order, home: { club: home, players: rows }, away: { club: away, players: [] } });
  const season = seasonPlayers([
    game(1, 'a', 'b', [listed(1, 'Prop', 15, { tacklesMade: 30 }), listed(2, 'Replacement', 18)]),
    game(2, 'a', 'b', [listed(1, 'Lock', 13, { tacklesMade: 20 }), listed(2, 'Interchange', 14, { minutesPlayed: 10 })]),
    game(3, 'c', 'b', [listed(1, 'Prop', 8, { tacklesMade: 25 })]),
    { order: 4, home: { club: 'c', players: null }, away: { club: 'b', players: null } },
  ]);
  const one = season.get(1);
  assert.deepEqual([one.games, one.clubs, one.starts, one.sums[KEPT.indexOf('tacklesMade')]], [3, { a: 2, c: 1 }, { PR: 2, LK: 1 }, 75]);
  assert.equal(mostStarted([one]), 'PR');
  assert.equal(clubOf(one), 'a', 'the club he played most games for');
  assert.equal(clubOf({ clubs: { a: 2, c: 2 }, lastAt: { a: 2, c: 3 } }), 'c', 'of two as many, the one he played for last');
  assert.deepEqual([season.get(2).games, season.get(2).starts], [1, {}], 'the 18th man counts only the game he came on in');
  assert.equal(mostStarted([season.get(2)]), null);
  assert.equal(mostStarted([{ starts: { CE: 3, WG: 3 }, lastStart: { CE: 1005, WG: 1009 } }]), 'WG', 'of two as often, the one he started at last');
  assert.equal(mostStarted([null, { starts: { SR: 1 }, lastStart: { SR: 2011 } }, { starts: { PR: 1 }, lastStart: { PR: 2010 } }]), 'SR');
  assert.deepEqual(rlpPositions('<dt>Position(s)</dt><dd>Second row / Front row</dd>'), ['SR', 'PR']);
  assert.deepEqual(rlpPositions('<dt>Position(s)</dt><dd>Utility Forward / Lock</dd>'), ['LK'], 'a utility names no position');
  assert.deepEqual(rlpPositions('<dt>Position(s)</dt><dd>Utility Forward</dd>'), []);
  assert.deepEqual(rlpPositions('<dt>Born</dt><dd>Monday, 1st May, 1995</dd>'), [], 'a page with no positions');
  assert.throws(() => rlpPositions('<dt>Position(s)</dt><dd>Goalkeeper</dd>'), /no position of the game's/);
  assert.deepEqual(Object.values(RLP_POSITION).sort(), ORDER.slice().sort());
  // The replies as read: a draw's finished games, a game's team lists with each player's stats.
  assert.deepEqual(drawGames({ fixtures: [{ type: 'Match', matchState: 'FullTime', matchCentreUrl: '/draw/x/', roundTitle: 'Round 1', venue: 'V', venueCity: 'C',
    clock: { kickOffTimeLong: '2016-03-03T09:00:00Z' }, homeTeam: { teamId: 1, nickName: 'H', score: 20 }, awayTeam: { teamId: 2, nickName: 'A', score: 18 } },
  { type: 'Bye' }, { type: 'Match', matchState: 'Upcoming', matchCentreUrl: '/draw/y/' }] }),
  [{ url: '/draw/x/', title: 'Round 1', kickOff: '2016-03-03T09:00:00Z', venue: 'V', city: 'C', home: [1, 'H', 20], away: [2, 'A', 18] }]);
  const reply = side => ({ teamId: side, score: 10, players: [{ playerId: side * 10, firstName: 'Jo', lastName: 'Bloggs', position: 'Hooker', number: 9 }] });
  const record = matchRecord({ matchId: 'm', roundTitle: 'Round 1', homeTeam: reply(1), awayTeam: reply(2),
    stats: { players: { homeTeam: [{ playerId: 10, tacklesMade: 40, minutesPlayed: 80, fantasyPointsTotal: 55 }] } } });
  assert.deepEqual(record.home.players[0], [10, 'Jo Bloggs', 'Hooker', 9, ...KEPT.map(stat => ({ tacklesMade: 40, minutesPlayed: 80 })[stat] ?? 0)]);
  assert.deepEqual(record.away.players[0].slice(4), KEPT.map(() => 0), 'no stats row: zeros');
  assert.equal(matchRecord({ homeTeam: { players: [] }, awayTeam: { players: [] } }), null, 'a reply without team lists');
  // NRL.com's `goals` is always empty: goals are conversions and penalty goals. Its replies of 2013–2015 record no
  // `errors`, only `handlingErrors`, which count in their place there, and only there.
  const kicks = (home, away) => matchRecord({ matchId: 'k', roundTitle: 'Round 2', homeTeam: reply(1), awayTeam: reply(2),
    stats: { players: { homeTeam: [{ playerId: 10, ...home }], awayTeam: [{ playerId: 20, ...away }] } } });
  // A stat of both sides' first player.
  const stat = (rec, name) => [rec.home, rec.away].map(side => side.players[0][4 + KEPT.indexOf(name)]);
  const old = kicks({ goals: 0, conversions: 4, penaltyGoals: 1, fieldGoals: 1, errors: 0, handlingErrors: 2 }, { errors: 0, handlingErrors: 1 });
  assert.deepEqual([stat(old, 'goals'), stat(old, 'fieldGoals'), stat(old, 'errors')], [[5, 0], [1, 0], [2, 1]]);
  const kept = kicks({ conversions: 2, errors: 1, handlingErrors: 3 }, { errors: 0, handlingErrors: 2 });
  assert.deepEqual(stat(kept, 'errors'), [1, 0], 'a game that records errors counts its errors alone');
  for (const snapshot of SNAPSHOTS.values()) {
    const sums = KEPT.map((_, i) => snapshot.players.reduce((total, row) => total + row[7][i], 0));
    assert.ok(sums[KEPT.indexOf('goals')] > 5 * snapshot.source.games && sums[KEPT.indexOf('errors')] > 15 * snapshot.source.games,
      `${snapshot.source.id}: every season keeps its goals and counts its errors`);
  }
});

test('each computed season places its players by the season, then a season either side, then two, then the Rugby League Project', () => {
  for (const [id, snapshot] of SNAPSHOTS) {
    const rows = snapshot.players.map(rowOf);
    assert.ok(rows.every(row => ['S', 'S±1', 'S±2', 'RLP'].includes(row.how) && ORDER.includes(row.pos)), id);
    assert.ok(rows.filter(row => row.how === 'S').length > 0.8 * rows.length, `${id}: most by his own season`);
    assert.deepEqual(rows.filter(row => row.how === 'RLP').map(row => String(row.nrlId)).sort(), Object.keys(snapshot.rlp).sort(),
      `${id}: every player RLP places, with his RLP id`);
    assert.equal(new Set(rows.map(row => row.nrlId)).size, rows.length, `${id}: each player once`);
    for (const [nrlId, name, club, games, reason] of snapshot.left) {
      assert.ok(Number.isInteger(nrlId) && name && club && games >= 1 && /^started at no position on NRL\.com/.test(reason), `${id}: ${name} left out: ${reason}`);
    }
    const audit = AUDITS.get(id);
    assert.equal(audit.left.length, snapshot.left.length, `${id}: the audit lists every one left out`);
    assert.deepEqual([audit.players.bySeason, audit.players.bySeasonEitherSide, audit.players.byTwoEitherSide, audit.players.byRlp],
      ['S', 'S±1', 'S±2', 'RLP'].map(how => rows.filter(row => row.how === how).length));
    assert.ok(rows.every(row => !Object.hasOwn(MANIFEST.nrlcom.aliases, String(row.nrlId))), `${id}: a second id plays under the first`);
  }
  // NRL.com gave Pat O'Hanlon (2012) and Matt King (2013) a new id for a season: aliased, each keeps his season before.
  const in2013 = nrlId => rowOf(SNAPSHOTS.get('nrl-2013').players.find(row => row[0] === nrlId));
  assert.deepEqual([in2013(500987).name, in2013(500987).previous[0]], ["Pat O'Hanlon", 2]);
  assert.deepEqual([in2013(501172).name, in2013(501172).previous[0]], ['Matt King', 20]);
});

test('every computed overall recomputes from its snapshot: value, percentile at the position, Rugby League 26\'s reference by the quota', () => {
  for (const [id, snapshot] of SNAPSHOTS) {
    const { conversion } = snapshot;
    const clubGames = Object.fromEntries(snapshot.clubs.map(club => [club.id, club.games]));
    const rows = snapshot.players.map(rowOf);
    for (const row of rows) {
      assert.equal(row.games, row.clubs.reduce((sum, [, n]) => sum + n, 0), `${id}: ${row.name}'s games`);
      assert.equal(row.clubs.find(([club]) => club === row.club)?.[1], Math.max(...row.clubs.map(([, n]) => n)),
        `${id}: ${row.name} plays for a club he played most for (of two as many, the last: clubOf)`);
      assert.equal(row.sums.length, KEPT.length);
      const { counted } = conversion.stats;
      const previous = row.previous && { points: corePoints(row.previous[2], counted), clubGames: clubGamesOf(row.previous[1], snapshot.previousClubGames) };
      assert.equal(row.value, seasonValue({ points: corePoints(row.sums, counted), clubGames: clubGamesOf(row.clubs, clubGames) }, previous), `${id}: ${row.name}'s value`);
      assert.equal(row.overall, overallOf(row.value, conversion.values[row.pos], conversion.reference[row.pos]), `${id}: ${row.name}'s overall`);
    }
    for (const pos of ORDER) {
      const at = rows.filter(row => row.pos === pos).sort((a, b) => a.value - b.value);
      assert.equal(conversion.quota[pos], round(at.length / snapshot.clubs.length, 4), `${id} ${pos}: as many a club as the season's`);
      assert.deepEqual(conversion.reference[pos], referenceOf(RL26, pos, conversion.quota[pos]), `${id} ${pos}: 2025's overalls by the quota`);
      assert.deepEqual(conversion.values[pos], at.map(row => row.value));
      assert.ok(at.every((row, i) => !i || row.overall >= at[i - 1].overall), `${id} ${pos}: a higher value never rates lower`);
      assert.ok(at[0].overall >= conversion.reference[pos][0] && at.at(-1).overall <= conversion.reference[pos].at(-1), `${id} ${pos}: within 2025's range`);
    }
  }
});

test("each computed club moves by its season's Simple Rating System, spread as its own results were; its players keep their order", () => {
  // Every target meets the built-in 2025 clubs' model strengths on average.
  const reference = builtInStrengths(CLUBS).sort((a, b) => a - b);
  const mean = round(reference.reduce((s, x) => s + x, 0) / reference.length, 3);
  assert.equal(mean, 83.883);
  // The seasons before 1998 move their clubs the same way.
  for (const [id, snapshot] of [...SNAPSHOTS, ...SELECTED_SNAPSHOTS]) {
    const games = snapshot.real.games.map(([, home, away, homeScore, awayScore]) => ({ home, away, homeScore, awayScore }));
    const { records, ...figures } = seasonFigures(games);
    assert.deepEqual(snapshot.real.figures, figures, `${id}: the real season's figures are its games'`);
    assert.deepEqual(snapshot.real.ladder.map(([club, won, drawn, lost]) => [club, won, drawn, lost]).sort(),
      Object.entries(records).map(([club, r]) => [club, r.won, r.drawn, r.lost]).sort());
    const fit = srsOf(games);
    const { clubShift } = snapshot.conversion;
    assert.deepEqual([clubShift.homeEdge, clubShift.sigma, clubShift.reliability], [fit.homeEdge, fit.sigma, fit.reliability], id);
    assert.deepEqual([clubShift.reference, clubShift.mean], [reference, mean], "the built-in 2025 NRL clubs' model strengths");
    const rows = snapshot.players.map(rowOf);
    // Its tries a team game: before 1998 its list's try rate, from 1998 its placed players' tries over its games.
    const { year } = MANIFEST.seasons.find(season => season.id === id);
    const tries = snapshot.source.basis === 'selection' ? snapshot.conversion.selection.tryRate
      : round(rows.reduce((sum, row) => sum + row.sums[KEPT.indexOf('tries')], 0) / snapshot.source.games / 2, 4);
    assert.deepEqual([clubShift.tries, clubShift.tryPoints, clubShift.matched], [tries, rulesOf(year).tryPoints, SPREAD.matched], id);
    const spread = spreadTargets(fit, { mean, tries, tryPoints: clubShift.tryPoints });
    assert.deepEqual([clubShift.margin, clubShift.scale], [spread.margin, spread.scale], id);
    assert.ok(Math.abs(clubShift.margin - 0.9 * marginPerStrength(tries, clubShift.tryPoints)) < 1e-4);
    const doc = DOCS.get(id) ?? SELECTED_DOCS.get(id);
    for (const club of snapshot.clubs) {
      const { team } = club;
      assert.equal(team.srs, fit.ratings[club.id], `${id}: ${club.id}'s SRS from the season's own games`);
      assert.equal(team.target, spread.targets[club.id], `${id}: ${club.id}'s target`);
      const at = rows.filter(row => row.club === club.id);
      const move = clubMoveOf(at.map(row => ({ id: row.nrlId, name: row.name, pos: row.pos, rating: row.overall, value: row.value })), team.target);
      assert.deepEqual([move.shift, move.plus, move.before, move.after, move.rating], [team.shift, team.plus, team.strength, team.shifted, team.rating],
        `${id}: ${club.id}'s move`);
      // Every player his club's whole number, its `plus` best one more: nobody passes a player rated above him.
      const best = new Set(move.best);
      assert.ok(at.every(row => row.shift === team.shift + (best.has(row.nrlId) ? 1 : 0)), `${id}: ${club.id}: one whole number, its best one more`);
      assert.ok(at.every(a => at.every(b => !(a.overall > b.overall) || a.overall + a.shift >= b.overall + b.shift)), `${id}: ${club.id} keeps its order`);
      assert.ok(Math.abs(team.shifted - team.target) <= 0.06, `${id}: ${club.id} within six hundredths of its target`);
      assert.equal(modelStrengthOf(at.map(row => ({ name: row.name, pos: row.pos, rating: row.overall + row.shift }))), team.shifted);
      assert.equal(doc.clubs.find(c => c.id === club.id).str, team.rating, 'the season shows the moved matchday 17\'s rating');
    }
    const bySrs = snapshot.clubs.slice().sort((a, b) => a.team.srs - b.team.srs);
    assert.ok(bySrs.every((club, i) => !i || club.team.target >= bySrs[i - 1].team.target), `${id}: the SRS order is the targets' order`);
    // The moved model strengths keep the SRS's order but where two targets lie within a step of each other.
    assert.ok(spearman(snapshot.clubs.map(club => club.team.shifted), snapshot.clubs.map(club => club.team.srs)) >= 0.98, id);
  }
  // The SRS on three clubs: margins fit exactly, ratings summing to zero, a home edge.
  const fit = srsOf([{ home: 'a', away: 'b', homeScore: 30, awayScore: 10 }, { home: 'b', away: 'a', homeScore: 12, awayScore: 20 },
    { home: 'b', away: 'c', homeScore: 24, awayScore: 18 }, { home: 'c', away: 'b', homeScore: 14, awayScore: 12 },
    { home: 'a', away: 'c', homeScore: 26, awayScore: 6 }, { home: 'c', away: 'a', homeScore: 10, awayScore: 22 }]);
  assert.equal(round(Object.values(fit.ratings).reduce((s, r) => s + r, 0), 6), 0);
  assert.ok(fit.ratings.a > fit.ratings.b && fit.ratings.b > fit.ratings.c && fit.homeEdge > 0, JSON.stringify(fit));
  // Its reliability: 1 when every margin fits, none when the ratings are no wider than their games' luck.
  const exact = srsOf([['a', 'b', 20, 10], ['b', 'a', 10, 16], ['b', 'c', 14, 10], ['c', 'b', 12, 12], ['a', 'c', 22, 10], ['c', 'a', 10, 18]]
    .map(([home, away, homeScore, awayScore]) => ({ home, away, homeScore, awayScore })));
  assert.deepEqual([exact.sigma, exact.reliability], [0, 1], JSON.stringify(exact));
  const luck = srsOf([['a', 'b', 30, 0], ['b', 'a', 30, 0], ['b', 'c', 2, 30], ['c', 'b', 30, 0], ['a', 'c', 0, 30], ['c', 'a', 0, 32]]
    .map(([home, away, homeScore, awayScore]) => ({ home, away, homeScore, awayScore })));
  assert.ok(luck.sigma > 25 && luck.reliability === 0, JSON.stringify(luck));
  // The spread: a club a point a game better than average plays √reliability ÷ (0.9 × marginPerStrength) points above it.
  const spread = spreadTargets({ ratings: { a: 4, b: -4 }, reliability: 0.81 }, { mean: 83, tries: 4, tryPoints: 4 });
  assert.deepEqual(spread.targets, { a: round(83 + 4 * 0.9 / spread.margin, 2), b: round(83 - 4 * 0.9 / spread.margin, 2) });
  assert.equal(spread.margin, round(0.9 * 2 * 0.14 * 4 * (4 + 2 * 0.755), 4));
  // The move: a whole number for all and one more for the best few, nearest the target, the smaller move of two as near.
  const pool = DOCS.get('nrl-2016').clubs[0].squad.map(([name, pos, rating], i) => ({ id: i, name, pos, rating, value: 1 / (i + 1) }));
  const start = modelStrengthOf(pool);
  assert.deepEqual(clubMoveOf(pool, start), { shift: 0, plus: 0, before: start, after: start, rating: clubSquadOf(pool).lineup.rating, best: [] });
  const up = clubMoveOf(pool, start + 1.5);
  assert.ok(up.shift === 1 && up.plus > 0 && Math.abs(up.after - start - 1.5) <= 0.06 && up.best.length === up.plus, JSON.stringify(up));
  assert.deepEqual(up.best, pool.slice().sort(bestFirst).slice(0, up.plus).map(p => p.id), 'the best take the extra point');
});

test("the spread's 0.9 is the match model's: its margin for a point of strength over the first order, over its luck against the real game's", () => {
  // Every pairing of six seasons' clubs, 300 games each way under the season's rules, its margins as the league counted
  // them: the slope of their mean on the gap in model strength, against marginPerStrength, and their spread about that
  // mean, against the season's own (`sigma`, its margins about its Simple Rating System).
  const ratios = [];
  for (const id of ['nrl-1965', 'nrl-1977', 'nrl-1990', 'nrl-2005', 'nrl-2016', 'nrl-2024']) {
    const snapshot = SNAPSHOTS.get(id) ?? SELECTED_SNAPSHOTS.get(id), sport = rulesOfSeason(id);
    const clubs = seasonClubs(root, id), eff = clubs.map(teamEff);
    const strength = new Map(snapshot.clubs.map(club => [club.id, club.team.shifted]));
    let sxy = 0, sxx = 0, squares = 0, games = 0;
    for (let i = 0; i < clubs.length; i++) {
      for (let j = 0; j < clubs.length; j++) {
        if (i === j) continue;
        const prepared = sport.prepareMatch(clubs[i], clubs[j], eff[i], eff[j]);
        const rng = makeRng(hashStr(`${id}|spread|${i}|${j}`));
        const margins = Array.from({ length: 300 }, () => {
          const result = sport.sampleResult(rng, prepared, 6);
          return sport.rules.golden ? result.ga - result.gd : result.regA - result.regD;
        });
        const mean = margins.reduce((s, m) => s + m, 0) / margins.length, gap = strength.get(clubs[i].id) - strength.get(clubs[j].id);
        sxy += gap * mean;
        sxx += gap * gap;
        squares += margins.reduce((s, m) => s + (m - mean) ** 2, 0);
        games += margins.length;
      }
    }
    const { tries, tryPoints, sigma } = snapshot.conversion.clubShift;
    const slope = sxy / sxx / marginPerStrength(tries, tryPoints), luck = Math.sqrt(squares / games) / sigma;
    assert.ok(slope > 0.85 && slope < 1.05 && luck > 0.9 && luck < 1.25, `${id}: slope ${slope.toFixed(3)}, luck ${luck.toFixed(3)}`);
    ratios.push(slope / luck);
  }
  const mean = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  assert.ok(Math.abs(mean - SPREAD.matched) < 0.04, `${ratios.map(r => r.toFixed(3)).join(', ')}: ${mean.toFixed(3)} against ${SPREAD.matched}`);
});

// The clubs of each computed season: twenty in 1998, seventeen in 1999, fourteen in 2000 and 2001, fifteen from 2002,
// sixteen from 2007, seventeen with the Dolphins from 2023.
const CLUB_COUNT = year => (year === 1998 ? 20 : year === 1999 ? 17 : year <= 2001 ? 14 : year <= 2006 ? 15 : year <= 2022 ? 16 : 17);

test("the computed seasons' clubs: twenty in 1998 down to fourteen, the Dolphins from 2023, each club as named that season, each era at its grounds", () => {
  for (const season of COMPUTED) {
    const doc = DOCS.get(season.id), teams = teamsOf(MANIFEST, season.year);
    assert.equal(doc.clubs.length, CLUB_COUNT(season.year), season.id);
    assert.equal(doc.clubs.some(club => club.id === 'nrl-dolphins'), season.year >= 2023, `${season.id}: the Dolphins from 2023`);
    for (const club of doc.clubs) {
      const team = teams.find(t => t.id === club.id);
      // A club of today's franchise in its colour, a defunct one in a colour of its own.
      const col = MANIFEST.defunct.includes(team.franchise) ? colourFor(team.id) : CLUBS.find(c => c.id === team.franchise).col;
      assert.deepEqual([club.name, club.code, club.league, club.country, club.col], [team.name, team.code, 'NRL', team.country, col], `${season.id}: ${club.name}`);
      assert.ok(club.squad.length >= 17 && club.squad.length <= 24);
    }
    assert.equal(doc.map, mapOf(MANIFEST, season.year));
    const bulldogs = doc.clubs.find(club => club.id.includes('bulldogs'));
    assert.deepEqual([bulldogs.id, bulldogs.name, bulldogs.code], season.year <= 1999 ? ['nrl-canterbury-bulldogs', 'Canterbury Bulldogs', 'CBY']
      : season.year <= 2009 ? ['nrl-bulldogs', 'Bulldogs', 'BUL'] : ['nrl-canterbury-bankstown-bulldogs', 'Canterbury-Bankstown Bulldogs', 'CBY'], season.id);
  }
  const at = (year, franchise) => teamsOf(MANIFEST, year).find(team => team.franchise === franchise);
  assert.deepEqual([1998, 1999, 2001, 2005, 2006, 2007, 2009, 2010, 2011, 2012, 2024].map(year => at(year, 'nrl-canterbury-bankstown-bulldogs').base ?? at(year, 'nrl-canterbury-bankstown-bulldogs').city),
    ['Canterbury', 'Homebush', 'Homebush', 'Homebush', 'Belmore Sports Ground', 'Belmore Sports Ground', 'Sydney Olympic Park', 'Sydney Olympic Park',
      'Sydney Olympic Park', 'Belmore Sports Ground', 'Belmore Sports Ground'], 'at Belmore in 1998, at Homebush 1999-2005, from Belmore while it shared Stadium Australia with the Rabbitohs');
  assert.deepEqual([2009, 2010].map(year => at(year, 'nrl-melbourne-storm').ground), ['Olympic Park Stadium', 'AAMI Park']);
  assert.deepEqual([2019, 2020].map(year => at(year, 'nrl-north-queensland-cowboys').ground), ['Dairy Farmers Stadium', 'Queensland Country Bank Stadium']);
  assert.deepEqual([2022, 2023].map(year => at(year, 'nrl-south-sydney-rabbitohs').base), ['Redfern Oval', 'Heffron Centre']);
  assert.deepEqual([2011, 2012, 2019, 2020].map(year => at(year, 'nrl-sydney-roosters').ground),
    ['Sydney Football Stadium', 'Allianz Stadium', 'Allianz Stadium', 'Allianz Stadium'], 'the SFS by its name of the day; rebuilt from 2019 (rule R1)');
  assert.deepEqual([2017, 2019, 2020].map(year => at(year, 'nrl-parramatta-eels').ground), ['Parramatta Stadium', 'Parramatta Stadium', 'CommBank Stadium'],
    'ANZ Stadium in 2017–18 and the new stadium on the site from 2019 keep the Eels at home (rules R1, R3)');
  // An era's seasons share their clubs and grounds, and 2023–2024 are today's: today's map serves them, built once.
  const fromNrl = MANIFEST.maps.filter(map => typeof map.seasons[0] === 'number' && map.seasons[0] >= 1998);
  assert.deepEqual(fromNrl.map(map => [map.id, map.seasons]), [['nrl1998', [1998]], ['nrl1999', [1999]], ['nrl2000', [2000]], ['nrl2001', [2001]],
    ['nrl2002', [2002]], ['nrl2003', [2003, 2004, 2005]], ['nrl2006', [2006]], ['nrl2007', [2007]], ['nrl2008', [2008, 2009]], ['nrl2010', [2010, 2011]],
    ['nrl2012', [2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019]], ['nrl2020', [2020, 2021, 2022]], ['nrl', [2023, 2024]]]);
  assert.ok(!CLUB_MAPS.some(entry => /^nrl20(2[3-9])/.test(entry.id)), 'no copy of today\'s map');
  for (const map of fromNrl.filter(entry => entry.id !== 'nrl' && entry.id !== 'nrl2008')) {
    const entry = CLUB_MAPS.find(e => e.id === map.id);
    assert.deepEqual([entry.sport, entry.league, entry.clubs, entry.venue, entry.lines], ['rugby-league', 'NRL', CLUB_COUNT(map.seasons[0]), 'ground', 'state or region']);
    assert.deepEqual(entry.seasons, map.seasons.map(seasonIdOf));
  }
});

test('the clubs of 1998–2007: the defunct by their own ids, the renamed by their names of the day, each placed from a pinned article', () => {
  const ids = year => teamsOf(MANIFEST, year).map(team => team.id);
  const has = (year, id) => ids(year).includes(id);
  // Twenty in 1998: St. George and Illawarra apart, Adelaide, the Gold Coast Chargers, North Sydney, Balmain and Western Suburbs.
  for (const id of ['nrl-adelaide-rams', 'nrl-gold-coast-chargers', 'nrl-illawarra-steelers', 'nrl-st-george-dragons']) {
    assert.deepEqual([1998, 1999].map(year => has(year, id)), [true, false], `${id}: 1998 only`);
  }
  for (const id of ['nrl-north-sydney-bears', 'nrl-balmain-tigers', 'nrl-western-suburbs-magpies', 'nrl-sydney-city-roosters', 'nrl-canterbury-bulldogs']) {
    assert.deepEqual([1998, 1999, 2000].map(year => has(year, id)), [true, true, false], `${id}: 1998 and 1999`);
  }
  assert.deepEqual([1999, 2000, 2001].map(year => [has(year, 'nrl-wests-tigers'), has(year, 'nrl-northern-eagles')]), [[false, false], [true, true], [true, true]]);
  assert.deepEqual([2002, 2003].map(year => [has(year, 'nrl-northern-eagles'), has(year, 'nrl-manly-warringah-sea-eagles')]), [[true, false], [false, true]]);
  assert.deepEqual([1999, 2000, 2001, 2002].map(year => has(year, 'nrl-south-sydney-rabbitohs')), [true, false, false, true], 'South Sydney out in 2000 and 2001');
  assert.deepEqual([2000, 2001].map(year => has(year, 'nrl-auckland-warriors')), [true, false], 'the New Zealand Warriors from 2001');
  assert.deepEqual([1998, 1999, 2002, 2003].map(year => has(year, 'nrl-sharks')), [false, true, true, false], 'the Sharks, 1999-2002');
  assert.deepEqual([2006, 2007].map(year => has(year, 'nrl-gold-coast-titans')), [false, true]);
  // Every defunct club is its own franchise, on no map of today's; those of 1998–2007 named by NRL.com's team id, those gone
  // before 1998 (Newtown, the Crushers, the Western Reds, the Hunter Mariners) known only to the Rugby League Project.
  assert.deepEqual(MANIFEST.defunct, ['nrl-adelaide-rams', 'nrl-balmain-tigers', 'nrl-gold-coast-chargers', 'nrl-illawarra-steelers', 'nrl-north-sydney-bears',
    'nrl-northern-eagles', 'nrl-western-suburbs-magpies', 'nrl-newtown-jets', 'nrl-south-queensland-crushers', 'nrl-western-reds', 'nrl-hunter-mariners']);
  const yearOf = key => Number(String(key).slice(-4));
  for (const id of MANIFEST.defunct) {
    assert.ok(!CLUBS.some(club => club.id === id), `${id} is no club of today's`);
    const seasons = Object.keys(MANIFEST.teams).filter(key => MANIFEST.teams[key].some(team => team.franchise === id)).map(yearOf);
    assert.ok(seasons.length && seasons.every(year => year <= 2002), `${id} plays ${seasons.join(', ')}`);
    assert.equal(Object.values(MANIFEST.nrlcom.teams).filter(club => club === id).length, Math.max(...seasons) >= 1998 ? 1 : 0, `${id}: NRL.com's team`);
  }
  assert.equal(MANIFEST.nrlcom.teams['500022'], 'nrl-st-george-illawarra-dragons', 'NRL.com files St. George\'s 1998 under the joint venture\'s team');
  assert.equal(teamsOf(MANIFEST, 1998).find(team => team.id === 'nrl-st-george-dragons').franchise, 'nrl-st-george-illawarra-dragons');
  // English Wikipedia names and places the clubs and grounds of 1998–2007, every article pinned to the revision read: each
  // defunct club's own, the grounds no club plays at today, and the season articles.
  assert.ok(Object.values(MANIFEST.wikipedia).every(revision => Number.isInteger(revision) && revision > 1e9));
  // A defunct club's entry under its own id cites its article (the Western Reds' is WA Reds' today), pinned.
  for (const id of MANIFEST.defunct) {
    const team = Object.values(MANIFEST.teams).flat().find(t => (t.id ?? t.franchise) === id);
    const cited = citedArticles(team.era);
    assert.ok(cited.length, `${team.name} cites English Wikipedia`);
    for (const title of cited) assert.ok(Object.hasOwn(MANIFEST.wikipedia, title), `${team.name}: ${title}'s article is pinned`);
  }
  for (const title of ['Queensland Sport and Athletics Centre', 'Willows Sports Complex', 'Sydney Football Stadium (1988)', 'Docklands Stadium', 'Central Coast Stadium',
    'Sydney Showground Stadium', 'Carrara Stadium', 'Adelaide Oval', 'North Sydney Oval', 'Jubilee Stadium', 'Leichhardt Oval', 'Campbelltown Sports Stadium',
    ...Array.from({ length: 10 }, (_, i) => `${1998 + i} NRL season`)]) assert.ok(Object.hasOwn(MANIFEST.wikipedia, title), `${title} is pinned`);
  // Grounds of the day: a ground no club plays at today keeps its name of the era's first season, one still played at its present name.
  const ground = (year, franchise) => teamsOf(MANIFEST, year).find(team => team.franchise === franchise).ground;
  assert.deepEqual([1998, 1999, 2000, 2007].map(year => ground(year, 'nrl-north-queensland-cowboys')), ['Malanda Stadium', 'Malanda Stadium', 'Dairy Farmers Stadium', 'Dairy Farmers Stadium']);
  assert.deepEqual([2001, 2002, 2007].map(year => ground(year, 'nrl-sydney-roosters')), ['Sydney Football Stadium', 'Aussie Stadium', 'Aussie Stadium']);
  assert.deepEqual([2002, 2003].map(year => ground(year, 'nrl-brisbane-broncos')), ['ANZ Stadium', 'Suncorp Stadium']);
  assert.deepEqual([2000, 2001, 2002].map(year => ground(year, 'nrl-melbourne-storm')), ['Olympic Park Stadium', 'Colonial Stadium', 'Olympic Park Stadium']);
  assert.deepEqual([2000, 2001, 2002].map(year => ground(year, 'nrl-northern-eagles')), ['NorthPower Stadium', 'NorthPower Stadium', '4 Pines Park']);
  assert.equal(ground(2007, 'nrl-gold-coast-titans'), 'Carrara Stadium', 'before Robina opened in 2008');
});

test('the era maps: the Bulldogs share the City of Parramatta while at Olympic Park, the Dolphins hold Redcliffe from 2023', () => {
  const olympicPark = [151.0631, -33.8472], parramattaStadium = [150.9997, -33.8081], belmore = [151.0947, -33.9167];
  const redcliffe = [153.0972, -27.2189], redfern = [151.2061, -33.8953], heffron = [151.237, -33.944];
  for (const [id, atOlympicPark, today] of [['nrl2008', true, false], ['nrl2010', true, false], ['nrl2012', false, false], ['nrl2020', false, false],
    ['nrl', false, true]]) {
    const map = decodeDomestic(JSON.parse(read(`public/domestic/${id}.json`)), id);
    const sectionAt = point => map.geo.countries.find(section => pointInPolys(point, section.polys))?.id ?? null;
    const homeOf = part => map.clubs.find(club => club.id.includes(part)).homeSection;
    assert.equal(map.clubs.length, today ? 17 : 16, id);
    assert.equal(sectionAt(redcliffe), homeOf(today ? 'dolphins' : 'broncos'), `${id}: Redcliffe`);
    assert.equal(sectionAt(parramattaStadium), homeOf('eels'), `${id}: the Eels' ground`);
    // Sydney Olympic Park is in the City of Parramatta: cut between the two clubs while the Bulldogs trained there.
    assert.equal(sectionAt(olympicPark), homeOf(atOlympicPark ? 'bulldogs' : 'eels'), `${id}: Sydney Olympic Park`);
    if (!atOlympicPark) assert.equal(sectionAt(belmore), homeOf('bulldogs'), `${id}: Belmore`);
    assert.equal(sectionAt(today ? heffron : redfern), homeOf('rabbitohs'), `${id}: the Rabbitohs' training ground`);
  }
});

test('the maps of 1998–2007: every club holds its own state from its ground of the day, the defunct clubs too', () => {
  const at = { adelaideOval: [138.5961, -34.9156], whyalla: [137.58, -33.03], carrara: [153.3672, -28.0064], wollongong: [150.9025, -34.4278],
    kogarah: [151.1292, -33.9719], northSydney: [151.2094, -33.8319], leichhardt: [151.1547, -33.8686], campbelltown: [150.8336, -34.0503],
    belmore: [151.0947, -33.9167], homebush: [151.0631, -33.8472], gosford: [151.3381, -33.4283], brookvale: [151.2733, -33.76],
    concord: [151.1094, -33.8683], redfern: [151.2061, -33.8953], nathan: [153.0622, -27.5583], docklands: [144.9475, -37.8164] };
  const maps = new Map(MANIFEST.maps.filter(map => map.seasons[0] >= 1998 && map.seasons[0] < 2008)
    .map(map => [map.id, decodeDomestic(JSON.parse(read(`public/domestic/${map.id}.json`)), map.id)]));
  const owner = (id, point) => {
    const map = maps.get(id), section = map.geo.countries.find(s => pointInPolys(point, s.polys))?.id ?? null;
    return section && map.clubs.find(club => club.homeSection === section).id;
  };
  for (const [id, map] of maps) {
    const year = MANIFEST.maps.find(entry => entry.id === id).seasons[0];
    assert.deepEqual(map.clubs.map(club => club.id).sort(), teamsOf(MANIFEST, year).map(team => team.id).sort(), `${id}: the season's clubs`);
    for (const team of teamsOf(MANIFEST, year)) assert.equal(owner(id, team.home), team.id, `${id}: ${team.name} holds where it grows from`);
    assert.equal(owner(id, at.nathan), 'nrl-brisbane-broncos', `${id}: Brisbane`);
  }
  assert.deepEqual([owner('nrl1998', at.adelaideOval), owner('nrl1998', at.whyalla), owner('nrl1999', at.adelaideOval)], ['nrl-adelaide-rams', 'nrl-adelaide-rams', null],
    'South Australia is the Rams\' in 1998, nobody\'s after');
  assert.deepEqual(['nrl1998', 'nrl2003', 'nrl2007'].map(id => owner(id, at.carrara)), ['nrl-gold-coast-chargers', 'nrl-brisbane-broncos', 'nrl-gold-coast-titans']);
  assert.deepEqual(['nrl1998', 'nrl1999'].map(id => [owner(id, at.wollongong), owner(id, at.kogarah) === 'nrl-st-george-dragons']),
    [['nrl-illawarra-steelers', true], ['nrl-st-george-illawarra-dragons', false]], 'St. George and Illawarra apart in 1998 only');
  assert.deepEqual(['nrl1998', 'nrl1999'].map(id => [owner(id, at.northSydney), owner(id, at.leichhardt), owner(id, at.campbelltown)]),
    Array(2).fill(['nrl-north-sydney-bears', 'nrl-balmain-tigers', 'nrl-western-suburbs-magpies']), 'North Sydney, Balmain and Western Suburbs to 1999');
  assert.deepEqual(['nrl2000', 'nrl2001', 'nrl2002', 'nrl2003'].map(id => owner(id, at.gosford) === 'nrl-northern-eagles'), [true, true, false, false]);
  assert.deepEqual(['nrl2002', 'nrl2003'].map(id => owner(id, at.brookvale)), ['nrl-northern-eagles', 'nrl-manly-warringah-sea-eagles'],
    'the Northern Eagles at Gosford in 2000 and 2001, at Brookvale in 2002, Manly from 2003');
  assert.deepEqual(['nrl2000', 'nrl2001', 'nrl2002'].map(id => maps.get(id).clubs.some(club => club.id === 'nrl-south-sydney-rabbitohs')), [false, false, true]);
  assert.equal(owner('nrl2000', at.concord), 'nrl-wests-tigers');
  // The Bulldogs at Belmore in 1998, at Homebush from 1999 (the City of Parramatta cut with the Eels), back at Belmore while
  // they shared Stadium Australia with the Rabbitohs.
  assert.deepEqual(['nrl1998', 'nrl1999', 'nrl2001', 'nrl2003', 'nrl2006', 'nrl2007'].map(id => owner(id, at.homebush).slice(4)),
    ['parramatta-eels', 'canterbury-bulldogs', 'bulldogs', 'bulldogs', 'parramatta-eels', 'parramatta-eels']);
  assert.deepEqual(['nrl1998', 'nrl2006'].map(id => owner(id, at.belmore).slice(4)), ['canterbury-bulldogs', 'bulldogs']);
  assert.deepEqual(['nrl1998', 'nrl2002', 'nrl2006'].map(id => owner(id, at.redfern)), Array(3).fill('nrl-south-sydney-rabbitohs'), 'the Rabbitohs from Redfern');
  assert.equal(owner('nrl2001', at.docklands), 'nrl-melbourne-storm');
  assert.equal(CLUB_MAPS.find(entry => entry.id === 'nrl1998').clubs, 20);
});

// ---------- the seasons before 1998 ----------

// The clubs of each: ten to 1966, twelve from 1967 (Cronulla-Sutherland, Penrith), fourteen in 1982 and 1983 (Canberra,
// Illawarra), thirteen from 1984 (no Newtown), sixteen from 1988 (Brisbane, the Gold Coast, Newcastle), twenty in the ARL of
// 1995 and 1996, then the ARL's twelve and Super League's ten in 1997.
const EARLY_CLUBS = id => {
  if (id === 'nrl-sl-1997') return 10;
  const year = Number(id.slice(4));
  return year <= 1966 ? 10 : year <= 1981 ? 12 : year <= 1983 ? 14 : year <= 1987 ? 13 : year <= 1994 ? 16 : year <= 1996 ? 20 : 12;
};
const competitionOf = season => (season.id === 'nrl-sl-1997' ? 'Super League' : season.year <= 1983 ? 'NSWRFL' : season.year <= 1994 ? 'NSWRL' : 'ARL');

test("the seasons before 1998 are 1960 to 1997 and Super League's 1997: computed from the Rugby League Project's lists, clubs only", () => {
  assert.deepEqual(SELECTED.map(season => season.id), [...Array.from({ length: 38 }, (_, i) => `nrl-${1960 + i}`), 'nrl-sl-1997']);
  for (const season of SELECTED) {
    const doc = SELECTED_DOCS.get(season.id);
    const { meta } = decodeFootballSet(doc, season.id);
    const competition = competitionOf(season);
    assert.deepEqual([meta.kind, meta.year, meta.season, meta.label, meta.source.provider, meta.source.method, season.competition],
      ['nrl', season.year, String(season.year), `${competition} (computed)`, 'Rugby League Project', 'computed', competition], season.id);
    assert.equal(meta.source.metric, 'selections (club starts and representative games) and tries a club game, the previous season at half weight');
    assert.ok(meta.source.conversion.startsWith(`Players: everyone the Rugby League Project lists as taking the field in the ${competition}'s ${season.year} premiership`), season.id);
    assert.equal(setHasNations(season.id), false, 'clubs only');
    assert.equal(doc.clubs.length, EARLY_CLUBS(season.id), season.id);
    // Every club plays in the premiership of its day, which the setup and the campaign name (leagueOf).
    assert.equal(leagueOf(MANIFEST, seasonKeyOf(season)), competition, season.id);
    assert.deepEqual([...new Set(doc.clubs.map(club => club.league))], [competition], `${season.id}: every club in the ${competition}`);
    // RLP's season: the NSWRFL's to 1983, the NSWRL's to 1994, the ARL's, Super League's.
    assert.equal(season.rlp.season, season.id === 'nrl-sl-1997' ? 'super-league-1997'
      : `${season.year <= 1983 ? 'nswrfl' : season.year <= 1994 ? 'nswrl' : 'arl'}-${season.year}`);
  }
  // Super League's 1997 is a season of its own beside the ARL's: its own id and key, and its own map.
  assert.deepEqual([seasonKeyOf(SELECTED.at(-1)), seasonKeyOf(SELECTED.find(season => season.id === 'nrl-1997')), mapOf(MANIFEST, 'nrl-sl-1997')],
    ['nrl-sl-1997', 1997, 'sl1997']);
  assert.deepEqual([setKindOf('nrl-sl-1997'), setSportOf('nrl-sl-1997'), setKindOf('nrl-1960')], ['nrl', 'rugby-league', 'nrl']);
  // The league a season was: its manifest entry's competition before 1998, the NRL from then.
  assert.deepEqual([1960, 1983, 1984, 1994, 1995, 1997, 'nrl-sl-1997', 1998, 2008, 2024].map(key => leagueOf(MANIFEST, key)),
    ['NSWRFL', 'NSWRFL', 'NSWRL', 'NSWRL', 'ARL', 'ARL', 'Super League', 'NRL', 'NRL', 'NRL']);
  assert.throws(() => leagueOf(MANIFEST, 1959), /No rugby league season 1959 in the manifest/);
});

test('the Rugby League Project\'s lists: starts by position, the bench no start, surnames as they are written, clubs by their codes', () => {
  const html = '<table class="list x"><thead><tr><td colspan="17"><input id="filter"></td></tr><tr><th><a href="?">Player</a> &uarr; <th>Age<th>Team(s)'
    + '<th>Position(s)<th class="n">APP<th class="n">INT<th class="n">TOT<th class="n">W<th class="n">L<th class="n">D<th class="n">W%<th class="n">T<th class="n">G'
    + '<th class="n">FG<th class="n">Pts<th>&nbsp;</thead><tbody><tr><td><a href="/players/1509">BEETSON, Arthur</a><td>30<td>SYD-20<td>FR-17, 2R-3<td>20<td>-<td>20'
    + '<td>17<td>3<td>-<td>85.00%<td>3<td>-<td>-<td>9<td>List<tr><td><a href="/players/7">McARTHUR, Bob</a><td>-<td>CBY-2, NOR-3<td>B-4, HK-1<td>1<td>4<td>5'
    + '<td>2<td>3<td>-<td>40%<td>-<td>-<td>-<td>-<td>List</tbody></table>';
  assert.deepEqual(rlpSeasonList(html), [
    { id: 1509, name: 'Arthur Beetson', teams: [['SYD', 20]], positions: { FR: 17, '2R': 3 }, starts: 20, interchange: 0, games: 20, won: 17, lost: 3, drawn: 0, tries: 3 },
    { id: 7, name: 'Bob McArthur', teams: [['CBY', 2], ['NOR', 3]], positions: { B: 4, HK: 1 }, starts: 1, interchange: 4, games: 5, won: 2, lost: 3, drawn: 0, tries: 0 }]);
  assert.deepEqual(["O'CONNOR", 'ADDO-CARR', 'McARTHUR', 'MacDOUGALL', 'de VILLIERS', 'EL MASRI'].map(rlpSurname),
    ["O'Connor", 'Addo-Carr', 'McArthur', 'MacDougall', 'de Villiers', 'El Masri']);
  assert.equal(mostStartedListed({ FR: 17, '2R': 3 }), 'PR');
  assert.equal(mostStartedListed({ B: 9 }), null, 'the bench is no start');
  assert.equal(mostStartedListed(null, { W: 2, C: 2 }), 'WG', 'two seasons summed; of two as often, the one nearer fullback');
  assert.deepEqual(Object.values(RLP_LIST_POSITION).sort(), [...ORDER].sort());
  // A club's code answers to its slugs of every season, NEW to Newtown's until 1983 and Newcastle's from 1988.
  assert.deepEqual(['canterbury', 'canterbury-bankstown', 'sydney-bulldogs', 'canterbury-bulldogs'].map(slug => RLP_CLUB_CODES.CBY.test(slug)), [true, true, true, true]);
  assert.deepEqual(['newtown', 'newtown-jets', 'newcastle-knights', 'north-sydney'].map(slug => RLP_CLUB_CODES.NEW.test(slug)), [true, true, true, false]);
  const games = [{ round: 'Round 1', home: 'easts', away: 'newtown', homeScore: 20, awayScore: 10 }, { round: 'Round 2', home: 'newtown', away: 'easts', homeScore: 7, awayScore: 7 }];
  assert.deepEqual(clubsByCode(games), { SYD: { slug: 'easts', games: 2, won: 1, drawn: 1, lost: 0 }, NEW: { slug: 'newtown', games: 2, won: 0, drawn: 1, lost: 1 } });
  assert.throws(() => checkListAgainstResults([{ name: 'A', teams: [['SYD', 3]], games: 3, won: 2, drawn: 1, lost: 0 }], clubsByCode(games), 'x'), /do not fit easts's/);
  assert.throws(() => clubsByCode([{ ...games[0], home: 'glebe' }]), /answers to no code/);
});

test('a season before 1998 values selections and tries a club game, the season before at half weight: every overall recomputes', () => {
  assert.deepEqual(SELECTION, { tryWeight: 2, tryRate: 4 });
  // 20 starts and 2 representative games, 6 tries at 3 tries a team game, 22 club games: (22 + 2 × 6 × 4/3) / 22.
  assert.equal(selectionValue({ selections: 22, tries: 6, tryRate: 3, clubGames: 22 }), round((22 + 16) / 22, 6));
  assert.equal(selectionValue({ selections: 22, tries: 6, tryRate: 3, clubGames: 22 }, { selections: 10, tries: 2, tryRate: 4, clubGames: 20 }),
    round((22 + 16 + 0.5 * (10 + 4)) / (22 + 10), 6), 'the season before at half weight');
  const mean = values => values.reduce((s, v) => s + v, 0) / values.length;
  for (const [id, snapshot] of SELECTED_SNAPSHOTS) {
    const { conversion } = snapshot;
    const clubGames = Object.fromEntries(snapshot.clubs.map(club => [club.id, club.games]));
    const rows = snapshot.players.map(rowOf);
    assert.equal(new Set(rows.map(row => row.nrlId)).size, rows.length, `${id}: each player once`);
    assert.ok(rows.filter(row => row.how === 'S').length > 0.8 * rows.length, `${id}: most by his own season`);
    for (const row of rows) {
      assert.ok(['S', 'S±1', 'S±2'].includes(row.how) && ORDER.includes(row.pos), `${id}: ${row.name}`);
      assert.equal(row.games, row.clubs.reduce((sum, [, n]) => sum + n, 0), `${id}: ${row.name}'s games`);
      assert.equal(row.clubs.find(([club]) => club === row.club)?.[1], Math.max(...row.clubs.map(([, n]) => n)), `${id}: ${row.name} plays for a club he played most for`);
      const [starts, representative, tries] = row.sums;
      const previous = row.previous && { selections: row.previous[2][0] + row.previous[2][1], tries: row.previous[2][2],
        tryRate: conversion.selection.tryRateBefore[row.previous[1][0][0].split('/')[0]], clubGames: mean(row.previous[1].map(([key]) => snapshot.previousClubGames[key])) };
      assert.equal(row.value, selectionValue({ selections: starts + representative, tries, tryRate: conversion.selection.tryRate,
        clubGames: mean(row.clubs.map(([club]) => clubGames[club])) }, previous), `${id}: ${row.name}'s value`);
      assert.equal(row.overall, overallOf(row.value, conversion.values[row.pos], conversion.reference[row.pos]), `${id}: ${row.name}'s overall`);
    }
    for (const pos of ORDER) {
      const at = rows.filter(row => row.pos === pos).sort((a, b) => a.value - b.value);
      assert.equal(conversion.quota[pos], round(at.length / snapshot.clubs.length, 4), `${id} ${pos}`);
      assert.deepEqual(conversion.reference[pos], referenceOf(RL26, pos, conversion.quota[pos]), `${id} ${pos}: 2025's overalls by the quota`);
      assert.deepEqual(conversion.values[pos], at.map(row => row.value));
      assert.ok(at.every((row, i) => !i || row.overall >= at[i - 1].overall), `${id} ${pos}: a higher value never rates lower`);
    }
    for (const [, name, club, games, reason] of snapshot.left) {
      assert.ok(name && club && games >= 1 && /^never started in \d{4}–\d{4} \(RLP's lists\)$/.test(reason), `${id}: ${name} left out: ${reason}`);
    }
    assert.equal(AUDITS.get(id).left.length, snapshot.left.length);
  }
  // Representative games count from Tests, State of Origin or the interstate series, and NSW City v Country; the World Cups'
  // games are Tests already, and so are Super League's of 1997.
  const representative = Object.values(MANIFEST.rlpSelection.representative).flat();
  assert.ok(representative.length > 100 && representative.every(file => /^(test-matches|interstate-series|state-of-origin|city-vs-country)/.test(file)), 'no World Cup, no tour');
  assert.deepEqual(MANIFEST.rlpSelection.representative['1975'], ['test-matches-1975/players.html', 'city-vs-country--firsts--1975/players.html',
    'interstate-series-1975/squads.html']);
});

test('the clubs of 1960–1997: each as named that season, the defunct by their own ids, each at the ground of most of its home games', () => {
  const team = (key, franchise) => teamsOf(MANIFEST, key).find(t => t.franchise === franchise);
  const name = (key, franchise) => team(key, franchise)?.name ?? null;
  // Names of the day, from the clubs' articles.
  assert.deepEqual([1977, 1978, 1994, 1995, 1996].map(year => name(year, 'nrl-canterbury-bankstown-bulldogs')),
    ['Canterbury-Bankstown Berries', 'Canterbury-Bankstown Bulldogs', 'Canterbury-Bankstown Bulldogs', 'Sydney Bulldogs', 'Canterbury Bulldogs']);
  assert.deepEqual([1994, 1995].map(year => name(year, 'nrl-sydney-roosters')), ['Eastern Suburbs Roosters', 'Sydney City Roosters']);
  assert.deepEqual([1972, 1973, 1983, 1984].map(year => name(year, 'nrl-newtown-jets')), ['Newtown Bluebags', 'Newtown Jets', 'Newtown Jets', null]);
  assert.deepEqual([1994, 1995, 1996, 1997].map(year => name(year, 'nrl-balmain-tigers')), ['Balmain Tigers', 'Sydney Tigers', 'Sydney Tigers', 'Balmain Tigers']);
  assert.deepEqual([1988, 1989, 1990, 1995, 1996].map(year => name(year, 'nrl-gold-coast-chargers')),
    ['Gold Coast-Tweed Giants', 'Gold Coast-Tweed Giants', 'Gold Coast Seagulls', 'Gold Coast Seagulls', 'Gold Coast Chargers']);
  assert.deepEqual([1996, 'nrl-sl-1997'].map(key => name(key, 'nrl-western-reds')), ['Western Reds', 'Perth Reds']);
  assert.deepEqual(teamsOf(MANIFEST, 'nrl-sl-1997').map(t => t.name).sort(), ['Adelaide Rams', 'Auckland Warriors', 'Brisbane Broncos', 'Canberra Raiders',
    'Canterbury Bulldogs', 'Cronulla-Sutherland Sharks', 'Hunter Mariners', 'North Queensland Cowboys', 'Penrith Panthers', 'Perth Reds']);
  // Grounds: of most home games, the league's match of the round at the SCG and the Sports Ground counting for no club but
  // Eastern Suburbs, its own; a ground being rebuilt stays its club's (R1); a club on another's ground grows from its base.
  const ground = (key, franchise) => { const t = team(key, franchise); return t.base ? `${t.ground} from ${t.base}` : t.ground; };
  assert.deepEqual([1961, 1962].map(year => ground(year, 'nrl-st-george-illawarra-dragons')), ['Jubilee Stadium', 'Jubilee Stadium'], 'St. George at Kogarah, not the SCG');
  assert.deepEqual([1981, 1982, 1985, 1986].map(year => ground(year, 'nrl-parramatta-eels')), ['Cumberland Oval', 'Parramatta Stadium', 'Parramatta Stadium', 'Parramatta Stadium']);
  assert.deepEqual([1985, 1986, 1988, 1989].map(year => ground(year, 'nrl-st-george-illawarra-dragons')), Array(4).fill('Jubilee Stadium'));
  assert.deepEqual([1976, 1977, 1986, 1987, 1988, 1990, 1991].map(year => ground(year, 'nrl-sydney-roosters')), ['Sydney Sports Ground', 'Sydney Cricket Ground',
    'Sydney Sports Ground', 'Sydney Football Stadium', 'Sydney Football Stadium', 'Henson Park', 'Sydney Football Stadium']);
  assert.deepEqual([1987, 1988, 1990, 1991].map(year => ground(year, 'nrl-south-sydney-rabbitohs')),
    ['Redfern Oval', 'Sydney Football Stadium from Redfern Oval', 'Sydney Football Stadium', 'Sydney Football Stadium from Redfern Oval']);
  assert.deepEqual([1970, 1971, 1973].map(year => ground(year, 'nrl-balmain-tigers')), ['Leichhardt Oval', 'Sydney Sports Ground from Leichhardt Oval', 'Leichhardt Oval']);
  assert.deepEqual([1995, 1996].map(year => [ground(year, 'nrl-balmain-tigers'), ground(year, 'nrl-canterbury-bankstown-bulldogs')]),
    [['Parramatta Stadium from Leichhardt Oval', 'Parramatta Stadium from Belmore Sports Ground'], ['Parramatta Stadium from Leichhardt Oval', 'Belmore Sports Ground']]);
  assert.deepEqual([1966, 1967, 1986, 1987].map(year => ground(year, 'nrl-western-suburbs-magpies')), ['Pratten Park', 'Lidcombe Oval', 'Lidcombe Oval', 'Campbelltown Sports Stadium']);
  assert.deepEqual([1967, 1968].map(year => ground(year, 'nrl-cronulla-sutherland-sharks')), ['Sutherland Oval', 'Ocean Protect Stadium']);
  assert.deepEqual([1989, 1990].map(year => ground(year, 'nrl-canberra-raiders')), ['Seiffert Oval', 'GIO Stadium']);
  assert.deepEqual([1992, 1993].map(year => ground(year, 'nrl-brisbane-broncos')), ['Suncorp Stadium', 'ANZ Stadium']);
  assert.deepEqual([1988, 1996].map(year => ground(year, 'nrl-gold-coast-chargers')), ['Seagulls Stadium', 'Carrara Stadium']);
  assert.equal(ground('nrl-sl-1997', 'nrl-hunter-mariners'), 'Topper Stadium');
  for (const season of SELECTED) {
    const teams = teamsOf(MANIFEST, seasonKeyOf(season));
    assert.equal(teams.length, EARLY_CLUBS(season.id), season.id);
    for (const t of teams) {
      assert.ok(RLP_CLUB_CODES[t.rlpCode].test(t.rlp), `${season.id}: ${t.name} is RLP's ${t.rlpCode}`);
      for (const title of citedArticles(t.era)) assert.ok(Object.hasOwn(MANIFEST.wikipedia, title), `${season.id} ${t.name}: ${title}'s article is pinned`);
    }
  }
  for (const title of [...Array.from({ length: 24 }, (_, i) => `${1960 + i} NSWRFL season`), ...Array.from({ length: 11 }, (_, i) => `${1984 + i} NSWRL season`),
    '1995 ARL season', '1996 ARL season', '1997 ARL season', '1997 Super League (Australia) season', 'Henson Park', 'Sydney Sports Ground', 'Sydney Cricket Ground',
    'Pratten Park', 'Lidcombe Oval', 'Sutherland Oval', 'Seiffert Oval', 'Seagulls Stadium', 'WACA Ground', 'The Gardens Greyhound and Sporting Complex']) {
    assert.ok(Object.hasOwn(MANIFEST.wikipedia, title), `${title} is pinned`);
  }
});

test('the maps of 1960–1997: every club holds where it grows from, Sydney\'s alone until 1982, Super League\'s from Perth to Auckland', () => {
  const at = { langPark: [153.0094, -27.4647], canberra: [149.13, -35.28], adelaideOval: [138.5961, -34.9156], waca: [115.8795, -31.9599],
    auckland: [174.8125, -36.9183], topper: [151.6825, -32.8933], murwillumbah: [153.3953, -28.3264], henson: [151.1583, -33.9044] };
  const early = MANIFEST.maps.filter(map => typeof map.seasons[0] === 'string' || map.seasons[0] < 1998);
  assert.deepEqual(early.map(map => map.id), ['nrl1960', 'nrl1967', 'nrl1968', 'nrl1971', 'nrl1973', 'nrl1977', 'nrl1978', 'nrl1982', 'nrl1984', 'nrl1987',
    'nrl1988', 'nrl1990', 'nrl1991', 'nrl1993', 'nrl1995', 'nrl1996', 'nrl1997', 'sl1997']);
  const maps = new Map(early.map(map => [map.id, decodeDomestic(JSON.parse(read(`public/domestic/${map.id}.json`)), map.id)]));
  const owner = (id, point) => {
    const map = maps.get(id), section = map.geo.countries.find(s => pointInPolys(point, s.polys))?.id ?? null;
    return section && map.clubs.find(club => club.homeSection === section).id;
  };
  for (const map of early) {
    const entry = CLUB_MAPS.find(e => e.id === map.id);
    // Each map names its seasons' premiership, one to a map: its file, its index entry (the setup's theatre) and its
    // attribution.
    const competitions = [...new Set(map.seasons.map(key => competitionOf(SELECTED.find(season => seasonKeyOf(season) === key))))];
    assert.equal(competitions.length, 1, `${map.id}: ${competitions.join(' and ')}`);
    assert.deepEqual([entry.sport, entry.league, entry.clubs, entry.venue, entry.lines],
      ['rugby-league', competitions[0], EARLY_CLUBS(seasonIdOf(map.seasons[0])), 'ground', 'state or region']);
    assert.equal(JSON.parse(read(`public/domestic/${map.id}.json`)).league, competitions[0], `${map.id}: the file's league`);
    assert.ok(read(`public/domestic/ATTRIBUTION-${map.id}.txt`).startsWith(`${competitions[0]} map of the seasons ${entry.seasons.join(', ')} `), map.id);
    assert.deepEqual(entry.seasons, map.seasons.map(seasonIdOf));
    const teams = teamsOf(MANIFEST, map.seasons[0]);
    const decoded = maps.get(map.id);
    assert.deepEqual(decoded.clubs.map(club => club.id).sort(), teams.map(t => t.id).sort(), `${map.id}: the season's clubs`);
    for (const t of teams) {
      // A ground on an estuary the simplified coast leaves out (Seagulls Stadium, on the Tweed) is in no section: its club
      // starts in the section named for its town.
      const held = owner(map.id, t.home), start = decoded.geo.countries.find(s => s.id === decoded.clubs.find(club => club.id === t.id).homeSection);
      assert.ok(held === t.id || (held === null && start.name === t.city), `${map.id}: ${t.name} holds where it grows from (${held}, ${start.name})`);
    }
  }
  // Sydney's clubs alone until 1982; Canberra played at Seiffert Oval, over the border in Queanbeyan, until 1989, so the
  // Australian Capital Territory is nobody's until the Raiders moved to Bruce Stadium in 1990.
  assert.deepEqual(['nrl1960', 'nrl1978', 'nrl1982', 'nrl1988', 'nrl1990'].map(id => [owner(id, at.langPark), owner(id, at.canberra)]),
    [[null, null], [null, null], [null, null], ['nrl-brisbane-broncos', null], ['nrl-brisbane-broncos', 'nrl-canberra-raiders']]);
  assert.equal(owner('nrl1988', at.murwillumbah), 'nrl-gold-coast-tweed-giants', 'the Giants hold the Tweed, over the border in New South Wales');
  assert.equal(owner('nrl1990', at.henson), 'nrl-eastern-suburbs-roosters', 'Eastern Suburbs at Henson Park in 1990');
  assert.deepEqual(['nrl1995', 'nrl1997', 'sl1997'].map(id => [owner(id, at.waca), owner(id, at.langPark), owner(id, at.adelaideOval)]),
    [['nrl-western-reds', 'nrl-south-queensland-crushers', null], [null, 'nrl-south-queensland-crushers', null], ['nrl-perth-reds', 'nrl-brisbane-broncos', 'nrl-adelaide-rams']]);
  assert.deepEqual([owner('sl1997', at.topper), owner('sl1997', at.auckland), owner('nrl1997', at.auckland)], ['nrl-hunter-mariners', 'nrl-auckland-warriors', null]);
});

test('the computed seasons play NRL-like seasons whose order, set by the season\'s results, is the real one', () => {
  for (const year of [1998, 2002, 2010, 2016, 2020, 2023]) {
    const id = `nrl-${year}`, snapshot = SNAPSHOTS.get(id), doc = DOCS.get(id);
    const report = playSeasons(doc.clubs, { seasons: 40, seed: 20261108, sport: rulesOfSeason(id) });
    // Its own scoring: 20.1 points a team in 1998, 24.1 in 2002.
    assert.ok(Math.abs(report.pointsPerTeam - snapshot.real.figures.pointsPerTeam) < 0.6,
      `${id}: points a team ${report.pointsPerTeam}, the season's ${snapshot.real.figures.pointsPerTeam}`);
    assert.ok(report.marginMean > 12 && report.marginMean < 20, `${id}: mean margin ${report.marginMean}`);
    // Its standings spread as its own did: 2010's level (0.131), 2020's apart (0.226).
    assert.ok(Math.abs(report.winPctSd - snapshot.real.figures.winPctSd) < 0.035, `${id}: win% SD ${report.winPctSd}, the season's ${snapshot.real.figures.winPctSd}`);
    const wins = new Map(snapshot.real.ladder.map(([club, won, drawn]) => [club, won + drawn / 2]));
    const rho = spearman(report.clubs.map(club => club.wins), report.clubs.map(club => wins.get(club.id)));
    assert.ok(rho >= 0.6, `${id}: the model's wins rank against the real season's at ${rho.toFixed(2)}`);
  }
  // Every season: the moved model strengths follow the season's Simple Rating System, which the move reads, at 0.98 or
  // better, far closer than the stats alone, and rank against the real wins at 0.7 or better. Margins and wins part most
  // in 2007 (the Cowboys won 15 of 24 and conceded more than they scored): there the SRS itself ranks against the wins at
  // 0.73. The matchday 17's rating the season shows weighs the bench as the starters, as the model does not: in a level
  // season it orders neighbours otherwise, 0.7 or better against the SRS.
  for (const [id, snapshot] of SNAPSHOTS) {
    const bySrs = key => spearman(snapshot.clubs.map(club => club.team[key]), snapshot.clubs.map(club => club.team.srs));
    assert.ok(bySrs('shifted') >= 0.98 && bySrs('shifted') > bySrs('strength'), `${id}: shifted ${bySrs('shifted')}, stats ${bySrs('strength')} against the SRS`);
    assert.ok(bySrs('rating') >= 0.7, `${id}: the rating shown ${bySrs('rating')} against the SRS`);
    const audit = AUDITS.get(id);
    assert.ok(audit.strengthAndResults.shifted >= 0.7, `${id}: ${JSON.stringify(audit.strengthAndResults)}`);
  }
});

// ---------- rules by era ----------

test('each earlier season\'s scoring is its record\'s: its regular season\'s points, its tries and field goals', () => {
  assert.deepEqual(Object.keys(NRL_LEAGUE_AVERAGES).sort(), MANIFEST.seasons.map(season => season.id).sort(), 'every earlier season, and no other');
  for (const season of MANIFEST.seasons) {
    const snapshot = JSON.parse(read(`scripts/data/rugby-league-seasons/${season.id}.json`));
    const league = NRL_LEAGUE_AVERAGES[season.id];
    assert.equal(league.points, snapshot.real.figures.pointsPerTeam, `${season.id}: the regular season's points`);
    if (season.basis === 'selection') {
      // RLP's list counts the tries the ratings read (the snapshot's try rate, over all the season's games), here at the
      // regular season's level.
      assert.ok(Math.abs(league.tries / snapshot.conversion.selection.tryRate - 1) < 0.03, `${season.id}: ${league.tries} v ${snapshot.conversion.selection.tryRate}`);
      assert.ok(league.fieldGoals >= 0 && league.fieldGoals < 1, `${season.id}: ${league.fieldGoals} field goals`);
    } else if (season.method === 'computed') {
      const { tries, fieldGoals } = leagueFigures(snapshot);
      assert.deepEqual([league.tries, league.fieldGoals], [tries, fieldGoals], `${season.id}: NRL.com's stats, as the snapshot keeps them`);
    } else assert.deepEqual(Object.keys(league), ['points', 'scoring'], `${season.id} keeps no stats: its points alone`);
    const { scoring } = league;
    assert.ok(scoring.tries > 0.4 && scoring.tries < 1.2 && scoring.penalties >= 0 && scoring.penalties < 2.5, `${season.id}: ${JSON.stringify(scoring)}`);
    assert.ok(scoring.fieldGoals >= 0 && scoring.fieldGoals <= 1 && scoring.openFieldGoals >= 0 && scoring.openFieldGoals < 1);
  }
  // Nobody kicked a field goal in 1960; the four-tackle rule (1967) made one the last tackle's play, a field goal and a half
  // a game, until it was worth one point (1971); 1986 kicked the most of the one-pointers' seasons.
  assert.deepEqual(['nrl-1960', 'nrl-1968', 'nrl-1971', 'nrl-1986'].map(id => NRL_LEAGUE_AVERAGES[id].fieldGoals), [0, 0.743, 0.081, 0.233]);
  assert.deepEqual(['nrl-1960', 'nrl-1968'].map(id => NRL_LEAGUE_AVERAGES[id].scoring.fieldGoals), [0, 1]);
  assert.ok(NRL_LEAGUE_AVERAGES['nrl-1968'].scoring.openFieldGoals > 0.5, 'most of 1968\'s field goals came in open play');
  // The scoring is the solver's (node scripts/build-nrl-league.mjs --check solves every season again): the sixties' three
  // parts, extra time's ARL of 1997, and 2008's points alone.
  for (const id of ['nrl-1968', 'nrl-1997', 'nrl-2008']) {
    const { year } = MANIFEST.seasons.find(season => season.id === id), { scoring, ...target } = NRL_LEAGUE_AVERAGES[id];
    assert.deepEqual(solveScoring(id, year, seasonClubs(root, id), target, { games: 16000 }), { ...scoring }, id);
  }
});

test('the league figures recompute from the Rugby League Project\'s pinned lists', { skip: !cached && 'the inputs (data-src/rugby-league-seasons/) are not on this computer' }, () => {
  for (const season of SELECTED) {
    const figures = leagueFigures(SELECTED_SNAPSHOTS.get(season.id), cachedList(root, season.rlp.season, SOURCES));
    const { points, tries, fieldGoals } = NRL_LEAGUE_AVERAGES[season.id];
    assert.deepEqual([figures.points, figures.tries, figures.fieldGoals, figures.from], [points, tries, fieldGoals, 'rlp'], season.id);
  }
  // Each list adds up as its day scored: a try three points to 1982 and four from 1983, a field goal two to 1970.
  const listOf = slug => rlpListTotals(readFileSync(new URL(`../data-src/rugby-league-seasons/rlp/seasons/${slug}/players.html`, import.meta.url), 'utf8'));
  for (const [slug, tryPoints, fieldGoalPoints] of [['nswrfl-1968', 3, 2], ['nswrfl-1975', 3, 1], ['nswrl-1985', 4, 1], ['nswrl-1986', 4, 1]]) {
    const totals = listOf(slug);
    assert.equal(totals.points, tryPoints * totals.tries + 2 * totals.goals + fieldGoalPoints * totals.fieldGoals, slug);
  }
  // From 1986 the lists give the kicks each goal came from.
  assert.deepEqual([listOf('nswrl-1985').kicks, listOf('nswrl-1986').kicks > listOf('nswrl-1986').goals], [null, true]);
});

test('every earlier season scores like its record under its own day\'s rules', () => {
  for (const season of MANIFEST.seasons) {
    const sport = rulesOfSeason(season.id), league = NRL_LEAGUE_AVERAGES[season.id];
    const measured = leagueScoring(sport, seasonClubs(root, season.id), { games: 4000, seed: `${season.id}:test` });
    assert.ok(Math.abs(measured.points - league.points) < 0.45, `${season.id}: ${measured.points.toFixed(2)} points a team, its league's ${league.points}`);
    if (league.tries != null) {
      assert.ok(Math.abs(measured.tries - league.tries) < 0.1, `${season.id}: ${measured.tries.toFixed(2)} tries a team, its league's ${league.tries}`);
      assert.ok(Math.abs(measured.fieldGoals - league.fieldGoals) < 0.05, `${season.id}: ${measured.fieldGoals.toFixed(3)} field goals, its league's ${league.fieldGoals}`);
    }
    // Before golden point, a game level at full time (a draw in the league) plays extra time, at most three periods.
    if (!sport.rules.golden) assert.ok(measured.level > 0.01 && measured.level < 0.06 && measured.longest <= 3, `${season.id}: ${JSON.stringify(measured)}`);
  }
});

test('the model ranks each computed season\'s clubs as its record does, by their expected wins', () => {
  // The seasons whose clubs' expected wins rank lowest against their record (docs/design/rugby-league.md, "The spread"):
  // 2007, when margins and wins parted most, and the level seasons of 1980, 1986 and 2009. A tally swaps close neighbours
  // from one seed to the next, a club's expected wins do not.
  for (const id of ['nrl-1980', 'nrl-1986', 'nrl-2007', 'nrl-2009']) {
    const doc = JSON.parse(read(`public/rugby-league/${id}.json`)), snapshot = JSON.parse(read(`scripts/data/rugby-league-seasons/${id}.json`));
    const wins = new Map(snapshot.real.ladder.map(([club, won]) => [club, won]));
    const expected = expectedWins(doc.clubs, { sport: rulesOfSeason(id), samples: 1000, seed: id });
    const rho = spearman(expected.map(club => club.wins), expected.map(club => wins.get(club.id)));
    assert.ok(rho >= 0.6, `${id}: the model's expected wins rank against the real ones at ${rho.toFixed(2)}`);
  }
});

test('the loader takes a computed NRL season and refuses one without its metric or conversion', () => {
  const text = read('public/rugby-league/nrl-2016.json');
  const broken = edit => { const copy = JSON.parse(text); edit(copy); return () => decodeFootballSet(copy, copy.id); };
  assert.doesNotThrow(broken(() => {}));
  assert.throws(broken(d => { delete d.source.metric; }), /source metric must name the measure the ratings rank/);
  assert.throws(broken(d => { delete d.source.conversion; }), /source conversion must say how the overalls were derived/);
  assert.throws(broken(d => { d.source.method = 'estimated'; }), /source method must be "computed" or absent/);
  assert.throws(broken(d => { delete d.source.method; }), /source rawScale must be a number/, 'not computed: a game\'s scale, as 2008');
  assert.throws(broken(d => { d.map = 'nrl2008'; }), /map "nrl2008" is not one of Rugby's maps listing this season/);
  assert.throws(broken(d => { d.season = '2015/16'; }), /season "2015\/16" must be "2016"/);
  const today = JSON.parse(read('public/rugby-league/nrl-2024.json'));
  assert.doesNotThrow(() => decodeFootballSet(today, 'nrl-2024'), '2024 plays on today\'s map');
});

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearDomesticCache: ['src/engine/domestic.js', 'clearDomesticCache'],
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
  clearFootballSetIndex: ['src/engine/footballSets.js', 'clearFootballSetIndex'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

async function withApp(fn) {
  const calls = [];
  const fetch = async url => {
    calls.push(String(url));
    const [, folder, id] = String(url).match(/^\/(domestic|rugby-league)\/([0-9A-Za-z-]+)\.json$/) || [];
    let text = null;
    try { text = folder && read(`public/${folder}/${id}.json`); } catch { text = null; }
    return text ? { ok: true, status: 200, json: async () => JSON.parse(text) }
      : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearDomesticCache();
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['036', '554', '598'],
    settings: { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn({ ...f, calls }); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}
const modelOf = app => buildSetupModel(app.state.setup, { managerTeams: app.setupTeams(), domestic: app.domesticStatus(), season: app.seasonStatus() });

test('rugby league\'s Season choice lists 2024 to 1960, its clubs only, and 2008 takes them onto the map of 2008', async () => {
  await withApp(async ({ app }) => {
    app.pickSetup('sport', 'rugby-league');
    // Clubs only (Rugby's nations are union's): every season of the NRL's is a choice at once.
    assert.equal(app.state.setup.layer, 'clubs');
    const model = modelOf(app);
    const competition = year => (year <= 1983 ? 'NSWRFL' : year <= 1994 ? 'NSWRL' : 'ARL');
    assert.deepEqual(model.season.options.map(option => option.label), ['2025 · built in',
      ...Array.from({ length: 16 }, (_, i) => `${2024 - i} · Computed from NRL.com match stats`), '2008 · Rugby League 2: World Cup Edition',
      ...Array.from({ length: 10 }, (_, i) => `${2007 - i} · Computed from NRL.com match stats`), '1997 · Super League (computed)', '1997 · ARL (computed)',
      ...Array.from({ length: 37 }, (_, i) => `${1996 - i} · ${competition(1996 - i)} (computed)`)]);
    // A season names itself by its year, "· computed"; 1997's two by their whole labels.
    assert.deepEqual(['nrl-1975', 'nrl-1997', 'nrl-sl-1997'].map(id => model.season.options.find(option => option.id === id).name),
      ['1975 · computed', '1997 · ARL (computed)', '1997 · Super League (computed)']);
    assert.match(model.season.note, /No game rated 1960–2007 or 2009–2024/);
    app.pickSetup('dataSet', 'nrl-2008');
    assert.deepEqual([app.state.setup.layer, app.state.setup.dataSet, app.state.setup.clubScope], ['clubs', 'nrl-2008', 'domestic:nrl2008']);
    assert.equal(modelOf(app).canLaunch, false, 'Launch waits for the season and its map');
    app.pickSetup('dataSet', null);
    assert.equal(app.state.setup.clubScope, 'domestic:nrl', 'the built-in season plays on today\'s map');
  });
});

test('a 2008 clubs campaign launches on the map of 2008, saves, and resumes without the season file', async () => {
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'rugby-league');
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', 'nrl-2008');
    time.advance(200);
    await Promise.all([app.loadCountry('nrl2008'), app.loadSet('nrl-2008')]);
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(app.domesticStatus().state, 'ready');
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.sport, st.settings.layer, st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason,
      st.settings.clubScope], ['rugby-league', 'clubs', 'nrl-2008', DOC.version, 2008, '2008', 'domestic:nrl2008']);
    assert.equal(st.settings.domesticVersion, CLUB_MAPS.find(entry => entry.id === 'nrl2008').version);
    assert.deepEqual(Object.keys(st.teams).sort(), DOC.clubs.map(club => club.id).sort());
    for (const club of DOC.clubs) {
      const team = st.teams[club.id];
      assert.deepEqual([team.name, team.code, team.str], [club.name, club.code, club.str]);
      assert.deepEqual(team.squad.map(p => [p.name, p.pos, p.rating]), club.squad);
      assert.equal(st.own[team.home], team.id);
    }
    assert.equal(app.territoryName(st.teams['nrl-bulldogs'].home), 'Homebush');
    assert.equal(app.territoryName(st.teams['nrl-new-zealand-warriors'].home), 'Auckland');
    assert.ok(calls.includes('/rugby-league/nrl-2008.json') && calls.includes('/domestic/nrl2008.json'));
    const text = items.get(SAVE_KEY);
    const saved = parseCampaign(text);
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams));
    B.clearFootballSetCache();
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams));
    const edited = edit => { const data = JSON.parse(text); edit(data.settings); if (data.initialSettings) edit(data.initialSettings); return JSON.stringify(data); };
    const today = CLUB_MAPS.find(entry => entry.id === 'nrl').version;
    assert.throws(() => parseCampaign(edited(s => { s.clubScope = 'domestic:nrl'; s.domesticVersion = today; })), /Campaign data set is invalid/);
    assert.throws(() => parseCampaign(edited(s => { s.dataSeason = '2007/08'; })), /Campaign data set is invalid/);
  });
});

test('a computed 2015 clubs campaign launches on the map of 2012–2019, saves, and resumes without the season file', async () => {
  const doc = DOCS.get('nrl-2015');
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'rugby-league');
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', 'nrl-2015');
    assert.deepEqual([app.state.setup.layer, app.state.setup.clubScope], ['clubs', 'domestic:nrl2012']);
    time.advance(200);
    await Promise.all([app.loadCountry('nrl2012'), app.loadSet('nrl-2015')]);
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(app.domesticStatus().state, 'ready');
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.clubScope, st.settings.domesticVersion],
      ['nrl-2015', doc.version, 2015, 'domestic:nrl2012', CLUB_MAPS.find(entry => entry.id === 'nrl2012').version]);
    for (const club of doc.clubs) {
      const team = st.teams[club.id];
      assert.deepEqual([team.name, team.code, team.str], [club.name, club.code, club.str]);
      assert.deepEqual(team.squad.map(p => [p.name, p.pos, p.rating]), club.squad);
    }
    assert.equal(app.territoryName(st.teams['nrl-canterbury-bankstown-bulldogs'].home), 'Canterbury', 'back at Belmore');
    assert.ok(calls.includes('/rugby-league/nrl-2015.json') && calls.includes('/domestic/nrl2012.json'));
    const saved = parseCampaign(items.get(SAVE_KEY));
    B.clearFootballSetCache();
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams));
  });
});

test('a computed 1998 clubs campaign launches on the map of 1998 with its twenty clubs, saves, and resumes without the season file', async () => {
  const doc = DOCS.get('nrl-1998');
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'rugby-league');
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', 'nrl-1998');
    assert.deepEqual([app.state.setup.layer, app.state.setup.clubScope], ['clubs', 'domestic:nrl1998']);
    time.advance(200);
    await Promise.all([app.loadCountry('nrl1998'), app.loadSet('nrl-1998')]);
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(app.domesticStatus().state, 'ready');
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.clubScope, st.settings.domesticVersion],
      ['nrl-1998', doc.version, 1998, 'domestic:nrl1998', CLUB_MAPS.find(entry => entry.id === 'nrl1998').version]);
    assert.deepEqual(Object.keys(st.teams).sort(), doc.clubs.map(club => club.id).sort());
    assert.equal(Object.keys(st.teams).length, 20);
    for (const club of doc.clubs) {
      const team = st.teams[club.id];
      assert.deepEqual([team.name, team.code, team.str], [club.name, club.code, club.str]);
      assert.equal(st.own[team.home], team.id);
    }
    assert.deepEqual(['nrl-adelaide-rams', 'nrl-north-sydney-bears', 'nrl-st-george-dragons', 'nrl-canterbury-bulldogs', 'nrl-auckland-warriors']
      .map(id => [st.teams[id].name, app.territoryName(st.teams[id].home)]),
    [['Adelaide Rams', 'Adelaide'], ['North Sydney Bears', 'North Sydney'], ['St. George Dragons', 'St George'], ['Canterbury Bulldogs', 'Canterbury'],
      ['Auckland Warriors', 'Auckland']]);
    assert.ok(calls.includes('/rugby-league/nrl-1998.json') && calls.includes('/domestic/nrl1998.json'));
    const saved = parseCampaign(items.get(SAVE_KEY));
    B.clearFootballSetCache();
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams));
  });
});

test('a 1975 clubs campaign launches on the map of 1973–1976 with its twelve clubs and resumes; Super League\'s 1997 plays on its own map', async () => {
  const doc = SELECTED_DOCS.get('nrl-1975');
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'rugby-league');
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', 'nrl-1975');
    assert.deepEqual([app.state.setup.layer, app.state.setup.clubScope], ['clubs', 'domestic:nrl1973']);
    time.advance(200);
    await Promise.all([app.loadCountry('nrl1973'), app.loadSet('nrl-1975')]);
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(app.domesticStatus().state, 'ready');
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.clubScope, st.settings.domesticVersion],
      ['nrl-1975', doc.version, 1975, 'domestic:nrl1973', CLUB_MAPS.find(entry => entry.id === 'nrl1973').version]);
    // Its matches play 1975's rules: three-point tries, one-point field goals, extra time.
    const rules = app.sport();
    assert.deepEqual({ ...rules.rules }, { ...rulesOfSeason('nrl-1975').rules });
    assert.deepEqual([rules.rules.tryPoints, rules.rules.fieldGoalPoints, rules.rules.golden, rules.labels.tie], [3, 1, false, 'EXTRA TIME']);
    assert.deepEqual(Object.keys(st.teams).sort(), doc.clubs.map(club => club.id).sort());
    assert.equal(Object.keys(st.teams).length, 12);
    for (const club of doc.clubs) {
      const team = st.teams[club.id];
      assert.deepEqual([team.name, team.code, team.str], [club.name, club.code, club.str]);
      assert.deepEqual(team.squad.map(p => [p.name, p.pos, p.rating]), club.squad);
      assert.equal(st.own[team.home], team.id);
    }
    assert.deepEqual(['nrl-newtown-jets', 'nrl-eastern-suburbs-roosters', 'nrl-canterbury-bankstown-berries'].map(id => st.teams[id].name),
      ['Newtown Jets', 'Eastern Suburbs Roosters', 'Canterbury-Bankstown Berries']);
    assert.ok(calls.includes('/rugby-league/nrl-1975.json') && calls.includes('/domestic/nrl1973.json'));
    const saved = parseCampaign(items.get(SAVE_KEY));
    B.clearFootballSetCache();
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams));
  });
  const sl = SELECTED_DOCS.get('nrl-sl-1997');
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'rugby-league');
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', 'nrl-sl-1997');
    assert.equal(app.state.setup.clubScope, 'domestic:sl1997');
    time.advance(200);
    await Promise.all([app.loadCountry('sl1997'), app.loadSet('nrl-sl-1997')]);
    await settle();
    app.startCampaign();
    const st = app.state;
    assert.deepEqual([st.phase, st.settings.dataSet, st.settings.dataYear, st.settings.clubScope], ['playing', 'nrl-sl-1997', 1997, 'domestic:sl1997']);
    assert.equal(app.sport().rules.season, 'nrl-sl-1997', 'Super League\'s own scoring, not the ARL\'s');
    assert.deepEqual(Object.keys(st.teams).sort(), sl.clubs.map(club => club.id).sort());
    assert.deepEqual(['nrl-perth-reds', 'nrl-hunter-mariners'].map(id => st.teams[id].name), ['Perth Reds', 'Hunter Mariners']);
  });
});

test('the setup and the campaign name each season\'s premiership: the NSWRFL\'s 1962, the ARL\'s and Super League\'s 1997, the NRL from 1998', async () => {
  for (const [id, map, count, league] of [['nrl-1962', 'nrl1960', 10, 'NSWRFL'], ['nrl-1990', 'nrl1990', 16, 'NSWRL'], ['nrl-1997', 'nrl1997', 12, 'ARL'],
    ['nrl-sl-1997', 'sl1997', 10, 'Super League'], ['nrl-1998', 'nrl1998', 20, 'NRL'], ['nrl-2024', 'nrl', 17, 'NRL']]) {
    const season = id.match(/\d{4}$/)[0];
    await withApp(async ({ app, time }) => {
      app.pickSetup('sport', 'rugby-league');
      app.pickSetup('layer', 'clubs');
      app.pickSetup('dataSet', id);
      time.advance(200);
      await Promise.all([app.loadCountry(map), app.loadSet(id)]);
      await settle();
      const model = modelOf(app);
      // Rugby's card names both codes' clubs; the theatre is the season's premiership, after union's European clubs, and
      // the map card names it.
      assert.deepEqual(model.sports.filter(sport => sport.selected).map(sport => [sport.id, sport.note]),
        [['rugby-union', 'Nations · European and NRL clubs']], id);
      assert.deepEqual(model.scopes.map(row => [row.id, row.label, row.count]),
        [['domestic:rugbyeurope', 'European clubs', 36], [`domestic:${map}`, league, count]], id);
      assert.equal(model.scopeName, `${league} · Australia and New Zealand`, id);
      assert.match(model.countryNote, new RegExp(` lead the ${count} ${league} clubs fighting over Australia and New Zealand, `), id);
      app.startCampaign();
      const st = app.state;
      assert.equal(st.phase, 'playing', id);
      assert.equal(st.campaignName, `Rugby ${season} · ${league} · Australia and New Zealand`, id);
      assert.equal(app.mapOverlaysModel().titleCard.title, `${league} · Australia and New Zealand · ${season}`, id);
      assert.ok(Object.values(st.teams).every(team => team.conf === league), `${id}: every club in the ${league}`);
    });
  }
});

test('a computed 2023 clubs campaign plays on today\'s map, with the Dolphins', async () => {
  const doc = DOCS.get('nrl-2023');
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'rugby-league');
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', 'nrl-2023');
    assert.equal(app.state.setup.clubScope, 'domestic:nrl');
    time.advance(200);
    await Promise.all([app.loadCountry('nrl'), app.loadSet('nrl-2023')]);
    await settle();
    app.startCampaign();
    const st = app.state;
    assert.deepEqual([st.phase, st.settings.dataSet, st.settings.clubScope], ['playing', 'nrl-2023', 'domestic:nrl']);
    assert.deepEqual(Object.keys(st.teams).sort(), doc.clubs.map(club => club.id).sort());
    assert.equal(st.teams['nrl-dolphins'].str, doc.clubs.find(club => club.id === 'nrl-dolphins').str, 'the season\'s Dolphins, not the built-in ones');
  });
});

test('the rugby league sport is the one a season binds', () => {
  assert.equal(seasonSport(decodeFootballSet(DOC, 'nrl-2008')).simulate, rugbyLeague.simulate);
  assert.equal(seasonSport(decodeFootballSet(DOCS.get('nrl-2016'), 'nrl-2016')).simulate, rugbyLeague.simulate);
});
