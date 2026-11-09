// Rugby league (docs/design/rugby-league.md): the NRL clubs and the nations built from the committed snapshot with
// Rugby League 26's ratings unchanged, the slice-by-slice match model and its live win probability, the NRL's own map of
// Australia and New Zealand (public/domestic/nrl.json) and the running App.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { CLUBS, SOURCE } from '../src/data/clubs.rugby-league.js';
import { ROSTERS } from '../src/data/rosters.rugby-league.js';
import { buildClub, buildTeam, makeRng, outOfPositionPenalty, RUGBY_CROSSING_PENALTY, RUGBY_NEAR_PENALTY, selectLineup, teamEff,
  teamSportId } from '../src/data/teams.js';
import { clockLabel, clockTick, getSport, overtimeEnd, overtimePeriodsOf, overtimeShort, overtimeText, SPORT_LIST } from '../src/sports/index.js';
import { BASELINE, deciderOdds, goldenRate, onField, POINTS, rugbyLeagueProfile, SLICE_MODEL, sliceMeans } from '../src/sports/rugbyLeague.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import { chartDomain, isLiveModel, liveModelFor, winProbabilityAt, winSeries } from '../src/engine/winProbability.js';
import { decodeDomestic, domesticSurroundings } from '../src/engine/domestic.js';
import { territories, validateReachability } from '../src/engine/campaign.js';
import { createDuelDraw } from '../src/engine/duelDraw.js';
import { fieldedNations, heldShapes } from '../src/engine/footballSets.js';
import { exportCampaign, parseCampaign } from '../src/engine/storage.js';
import { buildSetupModel, domesticDescription, sportNote } from '../src/screens/setup/setupModel.js';
import { buildSquad, sourceLabel } from '../src/viewModels/squad.js';
import { buildFeedRows, scorersLine } from '../src/viewModels/match.js';
import { kmToPolys, pointInPolys } from './lib/domestic-partition.mjs';
import { birthCountry, eligibleNation, playerOf } from './lib/nrl.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const sport = getSport('rugby-league');
const SNAPSHOT = JSON.parse(read('scripts/data/rugby-league-26.json'));
const GROUNDS = JSON.parse(read('scripts/data/nrl-teams.json')).teams;
const RATED = new Map(SNAPSHOT.players.map(row => [`${row[1]}|${row[2]}`, row]));
const teams = CLUBS.map(club => buildClub(club, sport));
const byId = Object.fromEntries(teams.map(team => [team.id, team]));
const listOf = id => GROUNDS[id].list;

// ---------- the ratings ----------

test('the 17 NRL clubs and the nations rebuild byte for byte from the committed snapshot', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.match(execFileSync(process.execPath, ['scripts/build-rugby-league.mjs', '--check'], { cwd: root, encoding: 'utf8' }), /Verified/);
  assert.equal(SNAPSHOT.source.listed, 597, 'every player Zero Tackle lists');
  assert.equal(SNAPSHOT.players.length + SNAPSHOT.source.unplaced.length, 597, 'each kept, or left out for want of a position');
  assert.ok(SNAPSHOT.source.unplaced.length <= 6, SNAPSHOT.source.unplaced.join(', '));
  assert.deepEqual([SOURCE.edition, SOURCE.season, SOURCE.published], ['Rugby League 26', '2025', '2025-07-17']);
});

test('every rating is Rugby League 26\'s, unchanged, and every position one the player plays', () => {
  const tuples = CLUBS.flatMap(club => club.squad.map(tuple => [club, tuple]));
  for (const [club, [name, positions, rating, source]] of tuples) {
    const row = RATED.get(`${name}|${GROUNDS[club.id].list}`);
    assert.ok(row, `${name} is listed at ${club.name}`);
    assert.equal(rating, row[3], `${name}'s overall`);
    assert.deepEqual(positions.split('/'), [row[4], ...row[5]], `${name}'s positions`);
    assert.equal(source.source, 'rl26');
    assert.equal(source.edition, 'Rugby League 26');
    assert.equal(source.goals ?? 0, row[10], `${name}'s goals in 2025`);
  }
  for (const [, , players] of Object.values(ROSTERS)) {
    for (const [name, , rating] of players) assert.ok(SNAPSHOT.players.some(row => row[1] === name && row[3] === rating), name);
  }
  // The best of them, as the game rates them.
  const haas = RATED.get('Payne Haas|Brisbane Broncos'), cleary = RATED.get('Nathan Cleary|Penrith Panthers');
  assert.deepEqual([haas[3], haas[4], cleary[3], cleary[4]], [93, 'PR', 93, 'HB']);
});

test('a player plays for his 2025 Test side, else where he was born, else where he may: Tonga\'s and Samoa\'s for their own', () => {
  assert.deepEqual(['Newcastle, NSW', 'Auckland NZ', 'Lewisham, UK', '-', 'Apia, Samoa', 'Port Moresby, PNG', 'Pago Pago, American Samoa']
    .map(birthCountry), ['036', '554', null, null, '882', '598', null]);
  assert.equal(eligibleNation(['Samoa', 'New Zealand', 'Queensland']), '882');
  assert.equal(eligibleNation(['Queensland', 'Tonga']), '776');
  assert.equal(eligibleNation(['New South Wales']), null);
  const players = SNAPSHOT.players.map(playerOf);
  const of = name => players.find(player => player.name === name);
  assert.deepEqual([of('Nathan Cleary').nation, of('Herbie Farnworth').nation, of('Eliesa Katoa').nation, of('Payne Haas').nation],
    ['036', '826', '776', '882'], 'Australia, England, Tonga and Samoa, each by his 2025 Test');
  const tests = { Tonga: '776', Samoa: '882', 'Cook Islands': '184' };
  assert.ok(players.filter(player => tests[player.test]).every(player => player.nation === tests[player.test]));
  // The Pacific Championships' three islands field their Test players on the map since docs/design/pacific-islands.md.
  const fielded = id => new Set(ROSTERS[id][2].map(([name]) => name));
  assert.ok(fielded('776').has('Eliesa Katoa') && fielded('882').has('Payne Haas') && fielded('184').has('Marata Niukore'));
});

// ---------- the clubs and the nations ----------

test('every club fields a whole matchday 17 of its own, and depth behind it', () => {
  assert.equal(CLUBS.length, 17);
  assert.deepEqual(CLUBS.map(club => club.id).sort(), Object.keys(GROUNDS).sort());
  assert.equal(new Set(CLUBS.map(club => club.code)).size, 17);
  assert.deepEqual(CLUBS.map(club => club.str), CLUBS.map(club => club.str).slice().sort((a, b) => b - a));
  for (const club of CLUBS) {
    assert.equal(club.code, GROUNDS[club.id].code);
    assert.equal(club.league, 'NRL');
    assert.equal(club.country, club.id === 'nrl-new-zealand-warriors' ? '554' : '036');
    const team = byId[club.id];
    assert.equal(teamSportId(team), 'rugby-league');
    const lineup = selectLineup(team);
    assert.equal(lineup.slots.length, 17);
    assert.ok(lineup.slots.every(slot => slot.player && slot.penalty <= RUGBY_NEAR_PENALTY), `${club.name} fills every place`);
    assert.equal(club.str, lineup.rating);
    assert.equal(club.squad.length, 24, club.name);
    const { starters, bench } = onField(lineup);
    assert.deepEqual([starters.length, bench.length], [13, 4]);
    assert.ok(club.squad.every(([name]) => RATED.has(`${name}|${listOf(club.id)}`)), `${club.name}'s own players`);
  }
});

test('a back moves between the outside places, a forward round the pack; a winger in the front row is an emergency', () => {
  assert.deepEqual([outOfPositionPenalty('rugby-league'), RUGBY_NEAR_PENALTY, RUGBY_CROSSING_PENALTY], [4, 8, 15]);
  const player = (name, pos, positions) => ({ name, pos, rating: 80, ...(positions ? { positions } : {}) });
  const full = ['FB', 'WG', 'WG', 'CE', 'CE', 'FE', 'HB', 'PR', 'HK', 'PR', 'SR', 'SR', 'LK', 'HK', 'PR', 'PR', 'LK'];
  const lineupOf = squad => selectLineup({ sport: 'rugby-league', squad });
  const penaltyAt = (squad, position) => lineupOf(squad).slots.find(slot => slot.position === position && slot.player.name === 'Swap').penalty;
  const rest = position => full.filter((p, i) => i !== full.indexOf(position)).map((pos, i) => player(`P${i}`, pos));
  assert.equal(penaltyAt([...rest('FB'), player('Swap', 'WG')], 'FB'), 4, 'a winger at fullback');
  assert.equal(penaltyAt([...rest('SR'), player('Swap', 'CE')], 'SR'), 8, 'a centre in the second row');
  assert.equal(penaltyAt([...rest('HK'), player('Swap', 'HB')], 'HK'), 8, 'a halfback at hooker');
  assert.equal(penaltyAt([...rest('PR'), player('Swap', 'WG')], 'PR'), 15, 'a winger in the front row');
  assert.equal(penaltyAt([...rest('SR'), player('Swap', 'CE', ['CE', 'SR'])], 'SR'), 0, 'a second position is his own');
});

test('nations field their NRL players and the game fills what they lack; a nation without half a side fields no team', () => {
  const strongest = Object.entries(ROSTERS).sort((a, b) => b[1][0] - a[1][0]).map(([id]) => id);
  assert.deepEqual(strongest.slice(0, 2), ['036', '554'], 'Australia, then New Zealand');
  assert.ok(strongest.includes('826') && strongest.includes('242') && strongest.includes('598'), 'England, Fiji and Papua New Guinea');
  for (const [id, [str, real, players]] of Object.entries(ROSTERS)) {
    assert.equal(players.length, real, id);
    assert.ok(real <= 24 && str >= BASELINE && str <= 99, id);
  }
  const rng = makeRng(20261108);
  const australia = buildTeam('036', rng, sport);
  assert.ok(selectLineup(australia).slots.every(slot => slot.player && !slot.player.gen), 'Australia fields its own');
  const png = buildTeam('598', rng, sport);
  const lineup = selectLineup(png);
  assert.ok(lineup.slots.every(slot => slot.player && slot.penalty <= RUGBY_NEAR_PENALTY), 'Papua New Guinea\'s gaps are filled');
  assert.ok(lineup.starters.some(player => player.gen) && lineup.starters.some(player => player.name === 'Xavier Coates'));
  const brazil = buildTeam('076', rng, sport);
  assert.equal(brazil.real, 0);
  assert.equal(brazil.str, BASELINE, 'built anyway, a nation with no NRL players would be all generated');
  assert.equal(brazil.squad.length, 17);
  assert.ok(teamEff(australia) > teamEff(png) && teamEff(png) > teamEff(brazil));
  // Only a nation whose NRL players hold half its matchday 17 fields a team (fieldedNations): Papua New Guinea's six and
  // the Cook Islands' five fall short.
  assert.deepEqual(fieldedNations(sport).slice().sort(), ['036', '242', '554', '776', '826', '882'],
    'Australia, Fiji, New Zealand, Tonga, England and Samoa');
  assert.ok(!fieldedNations(sport).includes('NIR') && heldShapes(sport).some(([shape, holder]) => shape === 'NIR' && holder === '372'),
    'Ireland is the whole island');
  assert.ok(!Object.hasOwn(sport.territory.merged, 'SCO') && !Object.hasOwn(sport.territory.merged, 'WAL'),
    'Scotland and Wales are nations of their own, with no NRL side to field');
});

// ---------- the match model ----------

test('matches always produce a winner, the feed adds up, and golden point ends at its score', () => {
  const rng = makeRng(20261108);
  let points = 0, games = 0, golden = 0, tries = 0;
  for (let i = 0; i < 4000; i++) {
    const a = teams[i % 17], d = teams[(i * 5 + 3) % 17];
    if (a === d) continue;
    const result = sport.simulate(rng, a, d, 6, teamEff(a), teamEff(d));
    assert.ok(result.winner === a.id || result.winner === d.id);
    assert.notEqual(result.ga, result.gd, 'never level at the end');
    assert.equal(result.winner === a.id, result.ga > result.gd);
    const sum = id => result.ev.filter(e => e.tid === id).reduce((s, e) => s + e.pts, 0);
    assert.deepEqual([sum(a.id), sum(d.id)], [result.ga, result.gd], 'the feed adds up to the final score');
    for (const e of result.ev) {
      assert.ok(e.kind === 'try' ? e.pts === 4 || e.pts === 6 : e.kind === 'penalty' ? e.pts === 2 : e.kind === 'field' && e.pts === 1,
        JSON.stringify(e));
      assert.ok(typeof e.name === 'string' && e.name, 'a name on every score');
    }
    assert.ok(result.ev.every((e, k) => k === 0 || result.ev[k - 1].m <= e.m), 'in order');
    tries += result.ev.filter(e => e.kind === 'try').length;
    if (result.tie) {
      golden++;
      assert.equal(result.regA, result.regD, 'golden point only from a level score');
      assert.deepEqual([result.tie.ga, result.tie.gd], [result.ga, result.gd]);
      const late = result.ev.filter(e => e.m > 80);
      assert.equal(late.length, 1, 'the first score wins: nothing after it');
      assert.equal(late[0].tid, result.winner);
      assert.ok([1, 2, 4].includes(late[0].pts), 'a field goal, a penalty goal, or a try with no conversion');
      assert.ok(late[0].m <= 80 + SLICE_MODEL.GOLDEN * SLICE_MODEL.MAX_GOLDEN);
    } else assert.ok(result.ev.every(e => e.m >= 1 && e.m <= 80));
    points += result.regA + result.regD;
    games++;
  }
  const perTeam = points / games / 2;
  assert.ok(perTeam > 20 && perTeam < 25, `about 22 points a team (${perTeam.toFixed(1)})`);
  assert.ok(tries / games / 2 > 3.6 && tries / games / 2 < 4.3, `about four tries a team (${(tries / games / 2).toFixed(2)})`);
  assert.ok(golden / games > 0.01 && golden / games < 0.06, `golden point now and then (${(golden / games * 100).toFixed(1)}%)`);
});

test('score effects: the late game follows the score, and field goals come when a point decides', () => {
  const early = sliceMeans(4, 0, 0);
  assert.ok(Math.abs(early.tries - 4 / 16 * (2 - 1.03)) < 1e-9, 'four tries a game, a little under a quarter a slice before half-time');
  assert.equal(early.fieldGoals, 0, 'no field goals early');
  const chasing = sliceMeans(4, -4, 14), protecting = sliceMeans(4, 4, 14), level = sliceMeans(4, 0, 14);
  assert.ok(chasing.tries > level.tries && protecting.tries < level.tries, 'four down late, the chaser pushes and the leader protects');
  assert.ok(level.penalties > early.penalties, 'level late, both take the two points');
  assert.ok(sliceMeans(4, -10, 14).penalties < early.penalties, 'ten down, a side runs its penalties');
  const last = SLICE_MODEL.SLICES - 1;
  assert.ok(sliceMeans(4, 0, last).fieldGoals > sliceMeans(4, 6, last).fieldGoals, 'level in the last minutes, a field goal');
  assert.ok(sliceMeans(4, 6, last).fieldGoals > 0 && sliceMeans(4, 3, last).fieldGoals === 0, 'six up, one more makes it two scores');
  assert.ok(sliceMeans(4, 24, 3).tries < early.tries * 1.03 && sliceMeans(4, 24, 3).tries < sliceMeans(4, 0, 3).tries, 'far ahead, a side eases off');
  assert.ok(goldenRate(4) > goldenRate(3.5), 'the better attack scores first more often');
  assert.ok(Math.abs(deciderOdds(0) - 0.5) < 1e-12 && deciderOdds(5) > 0.5 && deciderOdds(5) < 0.6, 'the last field goal is nearly a coin flip');
  assert.deepEqual(POINTS, { TRY: 4, CONVERSION: 2, PENALTY_GOAL: 2, FIELD_GOAL: 1 });
});

test('stronger teams are favourites, level sides are even, and home advantage counts when it is on', () => {
  const best = teams[0], worst = teams[16];
  const odds = preset => estimateWinProbability({ sport, attacker: best, defender: worst, preset, samples: 6000 }).attacker;
  const [predictable, balanced, wild] = ['predictable', 'balanced', 'wild'].map(odds);
  assert.ok(predictable > wild, `${predictable} > ${wild}`);
  assert.ok(balanced > 0.6 && balanced < 0.9, `a favourite, never a certainty: ${balanced}`);
  const swap = estimateWinProbability({ sport, attacker: worst, defender: best, preset: 'balanced', samples: 6000 }).attacker;
  assert.ok(Math.abs(swap - (1 - balanced)) < 0.03, 'neither side gains from attacking');
  const pairing = { sport, attacker: teams[8], defender: teams[9], preset: 'balanced', samples: 8000 };
  const neutral = estimateWinProbability(pairing).defender, home = estimateWinProbability({ ...pairing, home: true }).defender;
  assert.ok(home > neutral + 0.03, `the home side gains (${home} v ${neutral})`);
});

test('the feed copy, the scorers, the clock and the golden point texts', () => {
  assert.deepEqual(sport.formatEvent({ m: 23, pts: 6, kind: 'try', name: 'Reece Walsh' }, 'BRI'), { when: "23'", text: 'TRY — Reece Walsh (BRI)' });
  assert.deepEqual(sport.formatEvent({ m: 51, pts: 2, kind: 'penalty', name: 'Nathan Cleary' }, 'PEN'), { when: "51'", text: 'PENALTY GOAL — Nathan Cleary (PEN)' });
  assert.deepEqual(sport.formatEvent({ m: 83, pts: 1, name: 'Nathan Cleary' }, 'PEN'), { when: "83'", text: 'FIELD GOAL — Nathan Cleary (PEN)' },
    'a save without kinds reads the score from its points');
  assert.equal(sport.formatToast({ m: 12, pts: 4, name: 'Brian To\'o' }), "12' TRY — BRIAN TO'O");
  const shown = [{ tid: 'p', m: 5, name: 'Brian To\'o', pts: 6, kind: 'try' }, { tid: 'p', m: 30, name: 'Brian To\'o', pts: 4, kind: 'try' },
    { tid: 'p', m: 44, name: 'Nathan Cleary', pts: 2, kind: 'penalty' }, { tid: 'p', m: 60, name: 'Nathan Cleary', pts: 2, kind: 'penalty' },
    { tid: 'p', m: 70, name: 'Isaah Yeo', pts: 6, kind: 'try' }, { tid: 'p', m: 79, name: 'Nathan Cleary', pts: 1, kind: 'field' }];
  assert.equal(scorersLine(shown, 'p', {}, 'rugby-league'), 'To\'o 2 tries · Cleary 2 PG, 1 FG');
  assert.deepEqual([clockLabel(sport, 38), clockLabel(sport, 83), clockTick(sport, 40), clockTick(sport, 85)], ["38'", "83'", "40'", 'GP']);
  assert.deepEqual([overtimeText(sport, 1), overtimeText(sport, 3), overtimeShort(sport, 2)], ['in golden point', 'in golden point', 'GP']);
  assert.deepEqual([overtimePeriodsOf(sport, 'Won in golden point'), overtimePeriodsOf(sport, 'nothing')], [1, null]);
  assert.equal(overtimeEnd(sport, 1), 0, 'golden point ends at its deciding score');
});

test('the feed marks half-time and golden point', () => {
  const base = { sport: 'rugby-league', state: 'live', aCode: 'PEN', bCode: 'MEL', aName: 'Penrith Panthers', bName: 'Melbourne Storm', aId: 'p', dId: 'm',
    length: 80, half: 40, finalMinute: 83, scoreA: 6, scoreB: 6, kickoff: 'Kick-off', endLabel: 'Full time', overtime: true,
    events: [{ key: 'e0', m: 5, label: "5'", tid: 'm', pts: 6, text: 'TRY — Ryan Papenhuyzen (MEL)' },
      { key: 'e1', m: 51, label: "51'", tid: 'p', pts: 6, text: 'TRY — Brian To\'o (PEN)' }] };
  const live = buildFeedRows({ feedBase: base }, 45);
  assert.ok(live.some(row => row.text === 'Half-time — PEN 0–6 MEL'), JSON.stringify(live.map(row => row.text)));
  const extra = buildFeedRows({ feedBase: base }, 82);
  assert.ok(extra.some(row => row.text === 'Golden point — PEN 6–6 MEL'), JSON.stringify(extra.map(row => row.text)));
  assert.equal(extra[0].text, 'Live — PEN 6–6 MEL · golden point');
});

test('the live win probability starts at the fixture odds, follows the score and settles at the end', () => {
  for (const [i, j] of [[0, 16], [5, 6], [12, 2], [16, 1]]) {
    const model = liveModelFor(sport, teams[i], teams[j], undefined, undefined, 6);
    assert.ok(isLiveModel(model));
    assert.equal(model.kind, 'tries');
    const odds = estimateWinProbability({ sport, attacker: teams[i], defender: teams[j], preset: 'balanced', samples: 12000 }).attacker;
    assert.ok(Math.abs(winProbabilityAt(model, 0, 0) - odds) < 0.02, `kick-off ${winProbabilityAt(model, 0, 0)} v odds ${odds}`);
    assert.ok(winProbabilityAt(model, 40, 6) > winProbabilityAt(model, 40, 0) && winProbabilityAt(model, 40, 0) > winProbabilityAt(model, 40, -6));
    assert.ok(winProbabilityAt(model, 75, 4) > winProbabilityAt(model, 50, 4), 'a lead is worth more as time runs out');
    assert.ok(winProbabilityAt(model, 79, -13) < 0.01, 'two converted tries down with a minute left');
    assert.equal(winProbabilityAt(model, 80, 1), 1);
    assert.equal(winProbabilityAt(model, 80, -1), 0);
    assert.equal(winProbabilityAt(model, 83, 1), 1, 'a score in golden point has won');
    const level = winProbabilityAt(model, 80, 0);
    assert.ok(level > 0.2 && level < 0.8, `level after eighty (${level})`);
    assert.ok(Math.abs(winProbabilityAt(model, 100, 0) - deciderOdds(model.golden)) < 1e-9, 'golden point\'s end: the last field goal');
  }
  const model = liveModelFor(sport, teams[0], teams[1]);
  const series = winSeries({ model, goals: [{ m: 5, tid: 'a', pts: 6 }, { m: 40, tid: 'd', pts: 6 }, { m: 82, tid: 'a', pts: 1 }], aId: 'a', dId: 'd',
    minute: 82, final: { winnerSide: 'A' } });
  assert.equal(series.at(-1).t, 82, 'the series ends at the deciding score');
  assert.equal(series.at(-1).p, 1);
  assert.deepEqual(chartDomain(model, 30).ticks, [0, 20, 40, 60, 80], 'every twenty minutes');
  assert.deepEqual(chartDomain(model, 82).ticks, [0, 20, 40, 60, 80, 85], 'then golden point');
  assert.deepEqual([chartDomain(model, 30).half, chartDomain(model, 30).guides], [40, [40]], 'half-time');
});

// ---------- the NRL map ----------

const TEXT = read('public/domestic/nrl.json');
const DOC = JSON.parse(TEXT);
const MAP = decodeDomestic(JSON.parse(TEXT), 'nrl');
const ENTRY = CLUB_MAPS.find(entry => entry.id === 'nrl');
const ATLAS = JSON.parse(read('public/countries-50m.json'));
const { geo } = MAP;
const sectionIds = geo.countries.map(section => section.id);
const sectionAt = point => geo.countries.find(section => pointInPolys(point, section.polys))?.id ?? null;
const home = id => MAP.clubs.find(club => club.id === id).homeSection;
const empty = new Set(DOC.topology.objects.empty.geometries.map(g => g.id));

test('the NRL map gives every club one territory around its ground, across Australia and New Zealand', () => {
  assert.deepEqual({ format: DOC.format, sport: DOC.sport, league: DOC.league, name: DOC.name, hosts: DOC.hosts },
    { format: 1, sport: 'rugby-league', league: 'NRL', name: 'Australia and New Zealand', hosts: ['036', '554'] });
  assert.equal(ENTRY.version, DOC.version);
  assert.deepEqual([ENTRY.clubs, ENTRY.sections, ENTRY.venue, ENTRY.lines, ENTRY.top],
    [17, 17, 'ground', 'state or region', CLUBS.slice(0, 3).map(club => club.name)]);
  assert.ok(Buffer.byteLength(TEXT) <= 250000);
  assert.ok(read('public/domestic/ATTRIBUTION-nrl.txt').includes(DOC.version));
  assert.deepEqual(MAP.clubs.map(club => club.id), CLUBS.map(club => club.id), 'strongest first, as the section ids run');
  for (const club of MAP.clubs) {
    const source = CLUBS.find(item => item.id === club.id);
    assert.deepEqual([club.name, club.code, club.str], [source.name, source.code, source.str]);
    assert.deepEqual(club.homePoint, GROUNDS[club.id].home);
    assert.equal(MAP.sectionNames[club.homeSection], GROUNDS[club.id].city);
    const land = geo.countries.find(section => section.id === club.homeSection).polys;
    assert.ok(kmToPolys(club.homePoint, land) <= 2, `${club.name} plays inside its own territory`);
  }
  const { shapes } = domesticSurroundings(ATLAS, MAP);
  const ids = new Set(shapes.map(shape => shape.id));
  assert.ok(!ids.has('036') && !ids.has('554') && ids.has('598'), 'Papua New Guinea lies beneath as inert land');
  assert.match(domesticDescription(ENTRY), /^Melbourne Storm, Penrith Panthers and .+ lead the 17 NRL clubs fighting over Australia and New Zealand, each starting with only its ground's state or region\./);
});

test('New South Wales and Queensland are split between their clubs; every other state is one club\'s or nobody\'s', () => {
  assert.equal(sectionAt([144.9839, -37.8253]), home('nrl-melbourne-storm'), 'Victoria is the Storm\'s');
  assert.equal(sectionAt([143.85, -37.56]), home('nrl-melbourne-storm'), 'Ballarat too');
  assert.equal(sectionAt([149.13, -35.28]), home('nrl-canberra-raiders'), 'the ACT is the Raiders\'');
  assert.equal(sectionAt([174.76, -36.85]), home('nrl-new-zealand-warriors'), 'Auckland is the Warriors\'');
  assert.equal(sectionAt([175.28, -37.79]), null, 'Hamilton is nobody\'s');
  assert.equal(sectionAt([146.8167, -19.2661]), home('nrl-north-queensland-cowboys'));
  assert.equal(sectionAt([145.77, -16.92]), home('nrl-north-queensland-cowboys'), 'Cairns is North Queensland\'s');
  const sydney = ['nrl-sydney-roosters', 'nrl-south-sydney-rabbitohs', 'nrl-wests-tigers', 'nrl-canterbury-bankstown-bulldogs',
    'nrl-parramatta-eels', 'nrl-penrith-panthers', 'nrl-cronulla-sutherland-sharks', 'nrl-manly-warringah-sea-eagles'];
  assert.equal(new Set(sydney.map(home)).size, 8, 'eight Sydney clubs, eight territories');
  assert.equal(sectionAt([151.7267, -32.9189]), home('nrl-newcastle-knights'));
  assert.equal(sectionAt([150.9025, -34.4278]), home('nrl-st-george-illawarra-dragons'), 'Wollongong is the Dragons\'');
  for (const region of ['AU-WA', 'AU-SA', 'AU-TAS', 'AU-NT', 'NZ-CAN', 'NZ-WGN']) assert.ok(empty.has(region), `${region} is empty`);
  for (const region of ['AU-NSW', 'AU-QLD', 'AU-VIC', 'AU-ACT', 'NZ-AUK']) assert.ok(!empty.has(region), `${region} is held`);
});

test('seeded duel campaigns on the NRL map reach a champion, across the Tasman too', () => {
  const { obstacles } = domesticSurroundings(ATLAS, MAP);
  const rng = makeRng(20261108);
  const field = Object.fromEntries(MAP.clubs.map(club => [club.id, buildClub(club, sport)]));
  let own = { ...MAP.startOwners }, aliveIds = MAP.clubs.map(club => club.id);
  assert.deepEqual(validateReachability({ geo, own, aliveIds }).unplacedIds, []);
  while (aliveIds.length > 1) {
    const board = { geo, routingPaths: geo.paths, own, aliveIds, obstacles, borderRoutes: true };
    const draw = createDuelDraw(rng, board, { speed: 80 });
    assert.ok(draw && draw.attackerId !== draw.targetId);
    const { winner } = sport.simulate(rng, field[draw.attackerId], field[draw.targetId], 6, teamEff(field[draw.attackerId]), teamEff(field[draw.targetId]));
    const loser = winner === draw.attackerId ? draw.targetId : draw.attackerId;
    own = { ...own, ...Object.fromEntries(territories({ own }, loser).map(id => [id, winner])) };
    aliveIds = aliveIds.filter(id => id !== loser);
  }
  assert.deepEqual(Object.keys(own).sort(), [...sectionIds].sort());
  assert.ok(Object.values(own).every(id => id === aliveIds[0]));
});

// ---------- setup and the squad screen ----------

test('setup lists rugby league with nations and the NRL clubs, on its built-in 2025 season', () => {
  assert.equal(SPORT_LIST.at(-1).id, 'rugby-league');
  assert.equal(sportNote(sport), 'Nations · 17 NRL clubs');
  const clubs = buildSetupModel({ sport: 'rugby-league', layer: 'clubs', clubScope: 'domestic:nrl' }, {});
  assert.equal(clubs.clubsOnly, null);
  assert.deepEqual(clubs.scopes.map(scope => [scope.id, scope.label, scope.count]), [['domestic:nrl', 'NRL', 17]]);
  assert.equal(clubs.scopeName, 'NRL · Australia and New Zealand');
  assert.deepEqual(clubs.season.options.map(option => option.name), ['2025']);
  assert.match(clubs.season.note, /Rugby League 26/);
  assert.equal(buildSetupModel({ sport: 'rugby-league', layer: 'nations', scope: 'world' }, {}).layer, 'nations');
});

test('the squad screen draws the field and its bench, and profiles the backs, halves and forwards', () => {
  const team = { ...byId['nrl-penrith-panthers'], baseEff: teamEff(byId['nrl-penrith-panthers']) };
  const squad = buildSquad({ teams: { [team.id]: team }, aliveIds: [team.id], history: [] }, { sport }, team.id);
  assert.equal(squad.layout, 'rugby');
  assert.equal(squad.viewLabel, 'Field');
  assert.equal(squad.xi.label, 'Matchday 17');
  assert.deepEqual(squad.groups.map(group => group.label), ['Outside backs', 'Halves', 'Front row', 'Back row']);
  assert.equal(squad.pitch.length, 17);
  assert.equal(new Set(squad.pitch.map(slot => `${slot.x}|${slot.y}`)).size, 17, 'seventeen places, the bench below the field');
  assert.equal(squad.pitch.filter(slot => parseFloat(slot.y) > 85).length, 4, 'four on the interchange bench');
  assert.deepEqual(squad.profile.map(row => row.label), ['Backs', 'Halves', 'Forwards']);
  const profile = rugbyLeagueProfile(selectLineup(team));
  assert.ok(profile.backs > 75 && profile.halves > 75 && profile.forwards > 75);
  const cleary = squad.groups.flatMap(group => group.rows).find(row => row.name === 'Nathan Cleary');
  assert.deepEqual([cleary.rating, cleary.source, cleary.estimated], [93, 'Rugby League 26', false]);
  assert.equal(sourceLabel(team.squad.find(player => player.name === 'Nathan Cleary')), 'Rugby League 26');
  assert.deepEqual(squad.notes, []);
});

test('the goal-kicker is the one who kicked the most goals in 2025', () => {
  const rng = makeRng(3);
  const panthers = byId['nrl-penrith-panthers'], storm = byId['nrl-melbourne-storm'];
  const kickers = new Set();
  for (let i = 0; i < 300; i++) {
    for (const e of sport.simulate(rng, panthers, storm, 6, teamEff(panthers), teamEff(storm)).ev) if (e.kind === 'penalty' && e.tid === panthers.id) kickers.add(e.name);
  }
  assert.deepEqual([...kickers], ['Nathan Cleary']);
});

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearDomesticCache: ['src/engine/domestic.js', 'clearDomesticCache'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

test('rugby league sets up with clubs on the NRL map or with nations, launches and saves', async () => {
  const calls = [];
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: async url => {
    calls.push(String(url));
    return url === '/domestic/nrl.json' ? { ok: true, status: 200, json: async () => JSON.parse(TEXT) }
      : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  } });
  B.clearDomesticCache();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['036', '554', '598'],
    settings: { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try {
    const { app, time } = f;
    app.pickSetup('sport', 'rugby-league');
    assert.equal(app.state.setup.layer, 'nations', 'rugby league has nations');
    app.pickSetup('layer', 'clubs');
    assert.equal(app.state.setup.clubScope, 'domestic:nrl', "the NRL's one theatre");
    time.advance(200);
    await app.loadCountry('nrl');
    await settle();
    assert.deepEqual(calls, ['/domestic/nrl.json']);
    assert.equal(buildSetupModel(app.state.setup, { domestic: app.domesticStatus() }).canLaunch, true);

    app.startCampaign();
    const { state } = app;
    assert.equal(state.phase, 'playing');
    assert.equal(state.aliveIds.length, 17);
    assert.equal(state.campaignName, 'Rugby league · NRL · Australia and New Zealand');
    assert.ok(Object.values(state.teams).every(team => team.sport === 'rugby-league' && state.own[team.home] === team.id));
    assert.equal(app.territoryName(state.teams['nrl-new-zealand-warriors'].home), 'Auckland');
    const saved = parseCampaign(exportCampaign(state));
    assert.equal(saved.settings.sport, 'rugby-league');
    assert.equal(Object.keys(saved.teams).length, 17);
    assert.ok(saved.teams['nrl-penrith-panthers'].squad.some(player => player.name === 'Nathan Cleary' && player.sourceInfo?.goals > 0),
      'a save keeps who kicks the goals');

    app.openSetup();
    app.pickSetup('sport', 'football');
    assert.equal(app.state.setup.clubScope, 'domestic:eu124', "the NRL's map is no football theatre");
  } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
});

test('the win chart marks half-time in rugby league', async () => {
  const { WinChart } = await bundleComponents({ WinChart: 'src/screens/match/WinChart.jsx' });
  const { renderToStaticMarkup } = await import('react-dom/server');
  const React = (await import('react')).default;
  const html = renderToStaticMarkup(React.createElement(WinChart, { sport: 'rugby-league', model: liveModelFor(sport, teams[0], teams[1]), minuteFallback: 30 }));
  assert.ok((html.match(/class="match-chart__guide"/g) || []).length >= 1, 'half-time');
  for (const tick of [0, 20, 40, 60, 80]) assert.ok(html.includes(`>${tick}&#x27;<`), `${tick}'`);
});
