// Rugby league's earlier seasons (docs/design/rugby-league.md, "Earlier seasons"): the 2008 NRL season from Rugby League
// 2: World Cup Edition's database, every player checked against the Rugby League Project's 2008 records, its overall
// converted from the game's attributes onto Rugby League 26's ratings position by position, its clubs on the map of 2008,
// and the running App launching and resuming it.
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
  ATTRIBUTE_ORDER, DEFAULTS, PRIMARY_POSITION, REASONS, TEAM_RATING_PARTS, WEIGHTS, bornAlike, clubShiftOf, findListed, fold, nameParts,
  overallOf, playSeasons, positionScore, readOff, readRl2Database, referenceOf, rlpGrid, rlpName, rlpPlayer, rlpResults, seasonIdOf, shifted,
  spearman, teamRatingOf, teamsOf,
} from './lib/rugby-league-seasons.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const MANIFEST = JSON.parse(read('scripts/data/rugby-league-seasons.json'));
const SOURCES = JSON.parse(read('scripts/data/rugby-league-seasons-sources.json')).sources;
const SNAPSHOT = JSON.parse(read('scripts/data/rugby-league-seasons/nrl-2008.json'));
const AUDIT = JSON.parse(read('docs/design/rugby-league-seasons-audit.json')).seasons[0];
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

test('the 2008 season rebuilds byte for byte from its snapshot; the built-in season and its map are untouched', () => {
  assert.match(execFileSync(process.execPath, ['scripts/build-rugby-league-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the 1 rugby league season, the listing and the audit byte for byte/);
  assert.match(execFileSync(process.execPath, ['scripts/build-rugby-league.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the NRL clubs and the rugby league nations byte for byte/);
  // Every input is pinned by SHA-256: the database's zip, and of each Rugby League Project page the part read.
  assert.ok(Object.keys(SOURCES).length >= 70);
  assert.ok(Object.values(SOURCES).every(source => /^[0-9a-f]{64}$/.test(source.sha256) && /^https?:\/\//.test(source.url)));
  assert.deepEqual(Object.entries(SOURCES).filter(([, source]) => !source.pin).map(([file]) => file), ['rl2/aid56-RLDatabase.zip']);
  assert.equal(MANIFEST.seasons[0].database.sha256, '4891f3deab5caeddc276af68d24aca65c867d533db96d1f8edb6812d5b6ef9c8', 'RLDatabase.xml itself');
  assert.deepEqual(SNAPSHOT.source.database, MANIFEST.seasons[0].database);
});

const cached = existsSync(new URL('../data-src/rugby-league-seasons', import.meta.url));
test('the snapshot rebuilds from its pinned inputs', { skip: !cached && 'the inputs (data-src/rugby-league-seasons/) are not on this computer' }, () => {
  assert.match(execFileSync(process.execPath, ['scripts/sync-rugby-league-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the rugby league season snapshots byte for byte/);
});

test('the built-in season list has 2008: clubs only, a calendar year, on the map of 2008', () => {
  assert.deepEqual(BUILT_IN_RUGBY_LEAGUE_SEASONS.map(set => [set.id, set.year, set.season, set.label, set.map]),
    [['nrl-2008', 2008, '2008', 'Rugby League 2: World Cup Edition', 'nrl2008']]);
  assert.deepEqual(builtInSeasonOf('rugby-league'), { year: 2025, season: '2025' }, 'the built-in season stays 2025');
  const [listed] = BUILT_IN_RUGBY_LEAGUE_SEASONS;
  assert.deepEqual(BUILT_IN_SETS.find(set => set.id === listed.id), listed);
  assert.deepEqual([setKindOf('nrl-2008'), setSportOf('nrl-2008'), setHasNations('nrl-2008'), setHasClubs('nrl-2008'), setIsMapped('nrl-2008')],
    ['nrl', 'rugby-league', false, true, true]);
  assert.equal(seasonMapOf('nrl-2008'), 'nrl2008');
  assert.equal(listed.version, DOC.version);
  assert.equal(listed.id, seasonIdOf(listed.year));
  const era = CLUB_MAPS.find(entry => entry.id === 'nrl2008');
  assert.deepEqual([era.sport, era.league, era.seasons, era.clubs, era.sections, era.venue, era.lines], ['rugby-league', 'NRL', ['nrl-2008'], 16, 16, 'ground', 'state or region']);
  assert.ok(isEraMap('nrl2008') && !isEraMap('nrl'));
  assert.equal(CLUB_MAPS.find(entry => entry.id === 'nrl').seasons, undefined, 'today\'s map serves the built-in clubs');
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

test('rugby league\'s Season choice lists 2008, which takes the clubs onto the map of 2008', async () => {
  await withApp(async ({ app }) => {
    app.pickSetup('sport', 'rugby-league');
    const model = modelOf(app);
    assert.deepEqual(model.season.options.map(option => option.label), ['2025 · built in', '2008 · Rugby League 2: World Cup Edition']);
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

test('the rugby league sport is the one a season binds', () => {
  assert.equal(seasonSport(decodeFootballSet(DOC, 'nrl-2008')).simulate, rugbyLeague.simulate);
});
