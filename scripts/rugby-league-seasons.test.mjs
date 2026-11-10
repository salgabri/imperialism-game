// Rugby league's earlier seasons (docs/design/rugby-league.md, "Earlier seasons"): the 2008 NRL season from Rugby League
// 2: World Cup Edition's database, every player checked against the Rugby League Project's 2008 records, its overall
// converted from the game's attributes onto Rugby League 26's ratings position by position, its clubs on the map of 2008,
// and the running App launching and resuming it. Then the computed seasons, 2009–2024 ("Computed seasons"): every
// overall recomputed from its snapshot, the club shift from the season's own results, the clubs and maps of each era.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SAVE_KEY } from '../src/config.js';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { CLUBS } from '../src/data/clubs.rugby-league.js';
import { BUILT_IN_RUGBY_LEAGUE_SEASONS } from '../src/data/rugbyLeagueSeasons.js';
import { buildClub, selectLineup } from '../src/data/teams.js';
import { decodeDomestic } from '../src/engine/domestic.js';
import {
  BUILT_IN_SETS, builtInSeasonOf, decodeFootballSet, isEraMap, seasonMapOf, seasonSport, setHasClubs, setHasNations, setIsMapped, setKindOf,
  setSportOf, sportOf,
} from '../src/engine/footballSets.js';
import { parseCampaign } from '../src/engine/storage.js';
import { rugbyLeague } from '../src/sports/rugbyLeague.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { kmToPolys, pointInPolys } from './lib/domestic-partition.mjs';
import { playerOf } from './lib/nrl.mjs';
import {
  ATTRIBUTE_ORDER, CORE, CORE_REASONS, DEFAULTS, KEPT, NRLCOM_BENCH, NRLCOM_POSITION, PREVIOUS_WEIGHT, PRIMARY_POSITION, REASONS, RLP_POSITION,
  TEAM_RATING_PARTS, WEIGHTS, bornAlike, clubGamesOf, clubOf, clubShiftOf, corePoints, drawGames, findListed, fold, mapOf, matchRecord, mostStarted,
  nameParts, overallOf, playSeasons, positionScore, readOff, readRl2Database, referenceOf, rlpGrid, rlpName, rlpPlayer, rlpPositions, rlpResults,
  seasonFigures, seasonIdOf, seasonPlayers, seasonValue, shifted, spearman, srsOf, teamRatingOf, teamsOf, tookField,
} from './lib/rugby-league-seasons.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

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
    /Verified the 17 rugby league seasons, the listing and the audit byte for byte/);
  assert.match(execFileSync(process.execPath, ['scripts/build-rugby-league.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the NRL clubs and the rugby league nations byte for byte/);
  // Every input is pinned by SHA-256: the database's zip, of each Rugby League Project page the part read, and of NRL.com's
  // replies what is read of each season's rounds and each round's games.
  assert.ok(Object.keys(SOURCES).length >= 70);
  assert.ok(Object.values(SOURCES).every(source => /^[0-9a-f]{64}$/.test(source.sha256) && /^https?:\/\//.test(source.url)));
  assert.deepEqual(Object.entries(SOURCES).filter(([, source]) => !source.pin).map(([file]) => file), ['rl2/aid56-RLDatabase.zip']);
  const nrlcom = Object.entries(SOURCES).filter(([key]) => key.startsWith('nrlcom/'));
  assert.deepEqual([...new Set(nrlcom.map(([key]) => Number(key.split('/')[1])))].sort((a, b) => a - b),
    Array.from({ length: 20 }, (_, i) => 2007 + i), 'NRL.com 2007–2026: each computed season and the two either side');
  assert.ok(nrlcom.every(([key, source]) => (key.split('/').length === 2 ? source.pin === 'rounds'
    : source.pin === 'round' && Number.isInteger(source.games) && source.url.startsWith('https://www.nrl.com/draw/data?competition=111&season='))));
  assert.equal(MANIFEST.seasons[0].database.sha256, '4891f3deab5caeddc276af68d24aca65c867d533db96d1f8edb6812d5b6ef9c8', 'RLDatabase.xml itself');
  assert.deepEqual(SNAPSHOT.source.database, MANIFEST.seasons[0].database);
});

const cached = existsSync(new URL('../data-src/rugby-league-seasons', import.meta.url));
test('the snapshot rebuilds from its pinned inputs', { skip: !cached && 'the inputs (data-src/rugby-league-seasons/) are not on this computer' }, () => {
  assert.match(execFileSync(process.execPath, ['scripts/sync-rugby-league-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the rugby league season snapshots byte for byte/);
});

test('the built-in season list has 2024 to 2008, newest first: clubs only, calendar years, each on the map of its day', () => {
  const computed = Array.from({ length: 16 }, (_, i) => 2024 - i)
    .map(year => [`nrl-${year}`, year, String(year), 'Computed from NRL.com match stats', mapOf(MANIFEST, year)]);
  assert.deepEqual(BUILT_IN_RUGBY_LEAGUE_SEASONS.map(set => [set.id, set.year, set.season, set.label, set.map]),
    [...computed, ['nrl-2008', 2008, '2008', 'Rugby League 2: World Cup Edition', 'nrl2008']]);
  assert.deepEqual(computed.map(([, year, , , map]) => `${year} ${map}`), ['2024 nrl', '2023 nrl', '2022 nrl2020', '2021 nrl2020', '2020 nrl2020',
    '2019 nrl2012', '2018 nrl2012', '2017 nrl2012', '2016 nrl2012', '2015 nrl2012', '2014 nrl2012', '2013 nrl2012', '2012 nrl2012', '2011 nrl2010',
    '2010 nrl2010', '2009 nrl2008']);
  assert.deepEqual(builtInSeasonOf('rugby-league'), { year: 2025, season: '2025' }, 'the built-in season stays 2025');
  const listed = BUILT_IN_RUGBY_LEAGUE_SEASONS.at(-1);
  for (const set of BUILT_IN_RUGBY_LEAGUE_SEASONS) {
    assert.deepEqual(BUILT_IN_SETS.find(other => other.id === set.id), set);
    assert.deepEqual([setKindOf(set.id), setSportOf(set.id), setHasNations(set.id), setHasClubs(set.id), setIsMapped(set.id)],
      ['nrl', 'rugby-league', false, true, true]);
    assert.equal(seasonMapOf(set.id), set.map);
    assert.equal(set.id, seasonIdOf(set.year));
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
  [{ competition: null, round: 'Round 1', home: 'melbourne', away: 'warriors', homeScore: 30, awayScore: 12 }]);
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
  assert.throws(broken(d => { d.map = 'nhl2007'; }), /map "nhl2007" is not one of Rugby league's maps listing this season/);
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

test("the 2008 clubs play NRL-like seasons; their order, a check only, comes nearer 2008's with the shift", () => {
  const report = playSeasons(DOC.clubs, { seasons: 40, seed: 20261108 });
  const real = SNAPSHOT.real.figures;
  assert.deepEqual([real.games, real.bestWins, real.worstWins, real.draws], [192, 17, 5, 1], 'the real 2008 regular season, from RLP');
  assert.deepEqual(SNAPSHOT.real.ladder[0].slice(0, 4), ['nrl-melbourne-storm', 17, 0, 7], 'Melbourne the minor premiers');
  assert.ok(report.pointsPerTeam > 19 && report.pointsPerTeam < 26, `points a team ${report.pointsPerTeam}`);
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
const COMPUTED = MANIFEST.seasons.filter(season => season.method === 'computed');
const SNAPSHOTS = new Map(COMPUTED.map(season => [season.id, JSON.parse(read(`scripts/data/rugby-league-seasons/${season.id}.json`))]));
const DOCS = new Map(COMPUTED.map(season => [season.id, JSON.parse(read(`public/rugby-league/${season.id}.json`))]));
const RL26 = JSON.parse(read('scripts/data/rugby-league-26.json')).players.map(playerOf).map(p => ({ name: p.name, club: p.club, pos: p.pos, rating: p.rating }));
const rowOf = ([nrlId, name, club, pos, how, games, clubs, sums, previous, value, overall, shift]) =>
  ({ nrlId, name, club, pos, how, games, clubs, sums, previous, value, overall, shift });
const round = (x, digits) => Math.round(x * 10 ** digits) / 10 ** digits;
/** A team-list row as matchRecord keeps it: [id, name, position, jersey, ...KEPT]. */
const listed = (id, position, jersey, stats = {}) => [id, `Player ${id}`, position, jersey, ...KEPT.map(stat => stats[stat] ?? 0)];

test('the computed seasons are 2009 to 2024: one method, clubs only, the method stated in the source', () => {
  assert.deepEqual(COMPUTED.map(season => season.year), Array.from({ length: 16 }, (_, i) => 2009 + i));
  for (const season of COMPUTED) {
    const doc = DOCS.get(season.id);
    const { meta } = decodeFootballSet(doc, season.id);
    assert.deepEqual([meta.kind, meta.year, meta.season, meta.label, meta.source.provider, meta.source.method],
      ['nrl', season.year, String(season.year), 'Computed from NRL.com match stats', 'NRL.com', 'computed']);
    assert.equal(meta.source.rawScale, undefined, 'no game\'s scale');
    assert.match(meta.source.metric, /^core points a club game: NRL Fantasy's points for eleven NRL\.com stats, the season before at half weight$/);
    assert.match(meta.source.conversion, new RegExp(`^No game rated the ${season.year} season`));
    assert.match(meta.source.conversion, /the season's results set each club's level, while its players keep their order/);
    assert.equal(setHasNations(season.id), false, 'clubs only: a nations game plays the built-in nations');
  }
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
      const previous = row.previous && { points: corePoints(row.previous[2]), clubGames: clubGamesOf(row.previous[1], snapshot.previousClubGames) };
      assert.equal(row.value, seasonValue({ points: corePoints(row.sums), clubGames: clubGamesOf(row.clubs, clubGames) }, previous), `${id}: ${row.name}'s value`);
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

test("each computed club moves by its season's Simple Rating System, read off the built-in clubs' strengths; its players keep their order", () => {
  const reference = CLUBS.map(club => club.str).sort((a, b) => a - b);
  for (const [id, snapshot] of SNAPSHOTS) {
    const games = snapshot.real.games.map(([, home, away, homeScore, awayScore]) => ({ home, away, homeScore, awayScore }));
    const { records, ...figures } = seasonFigures(games);
    assert.deepEqual(snapshot.real.figures, figures, `${id}: the real season's figures are its games'`);
    assert.deepEqual(snapshot.real.ladder.map(([club, won, drawn, lost]) => [club, won, drawn, lost]).sort(),
      Object.entries(records).map(([club, r]) => [club, r.won, r.drawn, r.lost]).sort());
    const { ratings, homeEdge } = srsOf(games);
    assert.equal(snapshot.conversion.clubShift.homeEdge, homeEdge, id);
    assert.deepEqual(snapshot.conversion.clubShift.reference, reference, "the built-in 2025 NRL clubs' strengths");
    const rows = snapshot.players.map(rowOf);
    const doc = DOCS.get(id);
    for (const club of snapshot.clubs) {
      const { team } = club;
      assert.equal(team.srs, ratings[club.id], `${id}: ${club.id}'s SRS from the season's own games`);
      assert.equal(team.target, round(readOff(ratings[club.id], Object.values(ratings), reference), 2), `${id}: ${club.id}'s target`);
      const pool = rows.filter(row => row.club === club.id).map(row => ({ name: row.name, pos: row.pos, rating: row.overall }));
      assert.deepEqual(clubShiftOf(pool, team.target), { shift: team.shift, before: team.strength, after: team.shifted }, `${id}: ${club.id}'s shift`);
      assert.ok(rows.filter(row => row.club === club.id).every(row => row.shift === team.shift), 'one whole number for all its players');
      assert.ok(Math.abs(team.shifted - team.target) <= 0.5 + 1e-9, `${id}: ${club.id} within half a point of its target`);
      assert.equal(doc.clubs.find(c => c.id === club.id).str, team.shifted, 'the season plays the shifted strength');
    }
    const bySrs = snapshot.clubs.slice().sort((a, b) => a.team.srs - b.team.srs);
    assert.ok(bySrs.every((club, i) => !i || club.team.target >= bySrs[i - 1].team.target), `${id}: the SRS order is the targets' order`);
  }
  // The SRS on three clubs: margins fit exactly, ratings summing to zero, a home edge.
  const fit = srsOf([{ home: 'a', away: 'b', homeScore: 30, awayScore: 10 }, { home: 'b', away: 'a', homeScore: 12, awayScore: 20 },
    { home: 'b', away: 'c', homeScore: 24, awayScore: 18 }, { home: 'c', away: 'b', homeScore: 14, awayScore: 12 },
    { home: 'a', away: 'c', homeScore: 26, awayScore: 6 }, { home: 'c', away: 'a', homeScore: 10, awayScore: 22 }]);
  assert.equal(round(Object.values(fit.ratings).reduce((s, r) => s + r, 0), 6), 0);
  assert.ok(fit.ratings.a > fit.ratings.b && fit.ratings.b > fit.ratings.c && fit.homeEdge > 0, JSON.stringify(fit));
});

test("the computed seasons' clubs: sixteen to 2022, the Dolphins from 2023, the Bulldogs as named in 2009, each era at its grounds", () => {
  for (const season of COMPUTED) {
    const doc = DOCS.get(season.id), teams = teamsOf(MANIFEST, season.year);
    assert.equal(doc.clubs.length, season.year >= 2023 ? 17 : 16, season.id);
    assert.equal(doc.clubs.some(club => club.id === 'nrl-dolphins'), season.year >= 2023, `${season.id}: the Dolphins from 2023`);
    for (const club of doc.clubs) {
      const team = teams.find(t => t.id === club.id);
      assert.deepEqual([club.name, club.code, club.league, club.country, club.col], [team.name, team.code, 'NRL', team.country,
        CLUBS.find(c => c.id === team.franchise).col], `${season.id}: ${club.name}`);
      assert.ok(club.squad.length >= 17 && club.squad.length <= 24);
    }
    assert.equal(doc.map, mapOf(MANIFEST, season.year));
    const bulldogs = doc.clubs.find(club => club.id.includes('bulldogs'));
    assert.deepEqual([bulldogs.id, bulldogs.code], season.year === 2009 ? ['nrl-bulldogs', 'BUL'] : ['nrl-canterbury-bankstown-bulldogs', 'CBY']);
  }
  const at = (year, franchise) => teamsOf(MANIFEST, year).find(team => team.franchise === franchise);
  assert.deepEqual([2009, 2010, 2011, 2012, 2024].map(year => at(year, 'nrl-canterbury-bankstown-bulldogs').base),
    ['Sydney Olympic Park', 'Sydney Olympic Park', 'Sydney Olympic Park', 'Belmore Sports Ground', 'Belmore Sports Ground'], 'back at Belmore from 2012');
  assert.deepEqual([2009, 2010].map(year => at(year, 'nrl-melbourne-storm').ground), ['Olympic Park Stadium', 'AAMI Park']);
  assert.deepEqual([2019, 2020].map(year => at(year, 'nrl-north-queensland-cowboys').ground), ['Dairy Farmers Stadium', 'Queensland Country Bank Stadium']);
  assert.deepEqual([2022, 2023].map(year => at(year, 'nrl-south-sydney-rabbitohs').base), ['Redfern Oval', 'Heffron Centre']);
  assert.deepEqual([2011, 2012, 2019, 2020].map(year => at(year, 'nrl-sydney-roosters').ground),
    ['Sydney Football Stadium', 'Allianz Stadium', 'Allianz Stadium', 'Allianz Stadium'], 'the SFS by its name of the day; rebuilt from 2019 (rule R1)');
  assert.deepEqual([2017, 2019, 2020].map(year => at(year, 'nrl-parramatta-eels').ground), ['Parramatta Stadium', 'Parramatta Stadium', 'CommBank Stadium'],
    'ANZ Stadium in 2017–18 and the new stadium on the site from 2019 keep the Eels at home (rules R1, R3)');
  // An era's seasons share their clubs and grounds, and 2023–2024 are today's: today's map serves them, built once.
  assert.deepEqual(MANIFEST.maps.map(map => [map.id, map.seasons]), [['nrl2008', [2008, 2009]], ['nrl2010', [2010, 2011]],
    ['nrl2012', [2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019]], ['nrl2020', [2020, 2021, 2022]], ['nrl', [2023, 2024]]]);
  assert.ok(!CLUB_MAPS.some(entry => /^nrl20(2[3-9])/.test(entry.id)), 'no copy of today\'s map');
  for (const id of ['nrl2010', 'nrl2012', 'nrl2020']) {
    const entry = CLUB_MAPS.find(e => e.id === id);
    assert.deepEqual([entry.sport, entry.league, entry.clubs, entry.venue, entry.lines], ['rugby-league', 'NRL', 16, 'ground', 'state or region']);
    assert.deepEqual(entry.seasons, MANIFEST.maps.find(map => map.id === id).seasons.map(seasonIdOf));
  }
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

test('the computed seasons play NRL-like seasons whose order, set by the season\'s results, is the real one', () => {
  for (const year of [2010, 2016, 2020, 2023]) {
    const id = `nrl-${year}`, snapshot = SNAPSHOTS.get(id), doc = DOCS.get(id);
    const report = playSeasons(doc.clubs, { seasons: 40, seed: 20261108 });
    assert.ok(report.pointsPerTeam > 19 && report.pointsPerTeam < 26, `${id}: points a team ${report.pointsPerTeam}`);
    assert.ok(report.marginMean > 12 && report.marginMean < 20, `${id}: mean margin ${report.marginMean}`);
    assert.ok(report.winPctSd > 0.12 && report.winPctSd < 0.24, `${id}: win% SD ${report.winPctSd}`);
    const wins = new Map(snapshot.real.ladder.map(([club, won, drawn]) => [club, won + drawn / 2]));
    const rho = spearman(report.clubs.map(club => club.wins), report.clubs.map(club => wins.get(club.id)));
    assert.ok(rho >= 0.6, `${id}: the model's wins rank against the real season's at ${rho.toFixed(2)}`);
  }
  // Every season: the clubs' strengths rank against the real wins far better shifted than from the stats alone.
  for (const [id, audit] of AUDITS) {
    if (audit.method !== 'computed') continue;
    assert.ok(audit.strengthAndResults.shifted >= 0.6 && audit.strengthAndResults.shifted > audit.strengthAndResults.stats, `${id}: ${JSON.stringify(audit.strengthAndResults)}`);
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
  assert.throws(broken(d => { d.map = 'nrl2008'; }), /map "nrl2008" is not one of Rugby league's maps listing this season/);
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

test('rugby league\'s Season choice lists 2024 to 2008, and 2008 takes the clubs onto the map of 2008', async () => {
  await withApp(async ({ app }) => {
    app.pickSetup('sport', 'rugby-league');
    const model = modelOf(app);
    assert.deepEqual(model.season.options.map(option => option.label), ['2025 · built in',
      ...Array.from({ length: 16 }, (_, i) => `${2024 - i} · Computed from NRL.com match stats`), '2008 · Rugby League 2: World Cup Edition']);
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

test('a computed 2023 clubs campaign plays on today\'s map, with the Dolphins', async () => {
  const doc = DOCS.get('nrl-2023');
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'rugby-league');
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
