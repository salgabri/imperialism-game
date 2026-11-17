// Rugby league (docs/design/rugby-league.md): the NRL clubs and the nations built from the committed snapshot with
// Rugby League 26's ratings unchanged, the slice-by-slice match model and its live win probability, each earlier season's
// rules ("Rules by era": its points, scoring and extra time), the NRL's own map of Australia and New Zealand
// (public/domestic/nrl.json) and the running App.
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
import { clockLabel, clockTick, getSport, matchSport, overtimeEnd, overtimePeriodsOf, overtimeShort, overtimeText, SPORT_LIST } from '../src/sports/index.js';
import { BASELINE, deciderOdds, goldenRate, marginPerStrength, onField, POINTS, rugbyLeagueIn, rugbyLeagueProfile, rugbyLeagueStrength,
  rugbyLeagueWith, RULES_TODAY, rulesIn, rulesOf, SLICE_MODEL, sliceMeans } from '../src/sports/rugbyLeague.js';
import { NRL_LEAGUE_AVERAGES } from '../src/data/nrlLeagueAverages.js';
import { BUILT_IN_RUGBY_LEAGUE_SEASONS } from '../src/data/rugbyLeagueSeasons.js';
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

// ---------- rules by era ----------

const YEARS = new Map(BUILT_IN_RUGBY_LEAGUE_SEASONS.map(entry => [entry.id, entry.year]));
const seasonSettings = id => ({ sport: 'rugby-league', layer: 'clubs', clubScope: 'domestic:nrl', dataSet: id, dataYear: YEARS.get(id) });
const seasonClubs = id => JSON.parse(read(`public/rugby-league/${id}.json`)).clubs.map(club => buildClub(club, sport));

test('each season plays its own day\'s points, scoring and extra time; the built-in season plays today\'s, the very same sport', () => {
  assert.equal(matchSport({ sport: 'rugby-league', layer: 'clubs' }), sport);
  assert.equal(matchSport({ sport: 'rugby-league', layer: 'nations' }), sport);
  assert.equal(rugbyLeagueIn({}), sport);
  assert.deepEqual([sport.simulationVersion, sport.rules], [1, RULES_TODAY]);
  assert.deepEqual(RULES_TODAY, { season: null, tryPoints: 4, fieldGoalPoints: 1, golden: true, tries: 1, penalties: 0.39, fieldGoals: 1,
    openFieldGoals: 0 });
  // A try three points to 1982, a field goal two to 1970, golden point from 2003 (extra time before it).
  assert.deepEqual([1960, 1970, 1971, 1982, 1983, 2002, 2003, 2024, null].map(year => Object.values(rulesOf(year))), [[3, 2, false], [3, 2, false],
    [3, 1, false], [3, 1, false], [4, 1, false], [4, 1, false], [4, 1, true], [4, 1, true], [4, 1, true]]);
  const sixties = matchSport(seasonSettings('nrl-1965'));
  assert.notEqual(sixties, sport);
  assert.equal(sixties, matchSport(seasonSettings('nrl-1965')), 'one rules object a season');
  assert.deepEqual([sixties.id, sixties.simulationVersion, sixties.tieBreak, sixties.name], ['rugby-league', 2, 'overtime', 'Rugby league']);
  assert.deepEqual(sixties.rules, { ...RULES_TODAY, tryPoints: 3, fieldGoalPoints: 2, golden: false, season: 'nrl-1965',
    ...NRL_LEAGUE_AVERAGES['nrl-1965'].scoring });
  assert.deepEqual(sixties.scoreValues, { try: 3, penalty: 2, field: 2 });
  // Super League's 1997 and the ARL's: the same day's rules, each at its own scoring.
  const [arl, superLeague] = ['nrl-1997', 'nrl-sl-1997'].map(id => matchSport(seasonSettings(id)));
  assert.notEqual(arl, superLeague);
  assert.deepEqual([arl.rules.tryPoints, superLeague.rules.tryPoints, arl.rules.golden, superLeague.rules.golden], [4, 4, false, false]);
  assert.ok(superLeague.rules.tries > arl.rules.tries, 'Super League scored more tries');
  // Every earlier season has its level; a season the table lacks plays its day's rules at today's.
  for (const { id, year } of BUILT_IN_RUGBY_LEAGUE_SEASONS) assert.ok(Object.hasOwn(NRL_LEAGUE_AVERAGES, id), `${id} (${year}) has its scoring`);
  assert.deepEqual(rulesIn('nrl-1899', 1899), { ...RULES_TODAY, tryPoints: 3, fieldGoalPoints: 2, golden: false, season: 'nrl-1899' });
  // A season's scoring scales its try rates and nothing else.
  const [a, d] = seasonClubs('nrl-1965');
  const today = sport.prepareMatch(a, d, teamEff(a), teamEff(d)), then = sixties.prepareMatch(a, d, teamEff(a), teamEff(d));
  assert.ok(Math.abs(then.triesA / today.triesA - sixties.rules.tries) < 1e-12 && Math.abs(then.triesD / today.triesD - sixties.rules.tries) < 1e-12);
  assert.equal(then.golden, today.golden);
  assert.equal(then.rules, sixties.rules);
});

test('the late sixties play three-point tries and two-point field goals, and a level game plays extra time in full', () => {
  const rules = matchSport(seasonSettings('nrl-1968'));
  const clubs = seasonClubs('nrl-1968');
  const rng = makeRng(1968);
  let games = 0, extra = 0, fieldGoals = 0, points = 0, tries = 0;
  for (let i = 0; i < 4000; i++) {
    const a = clubs[i % clubs.length], d = clubs[(i * 5 + 3) % clubs.length];
    if (a === d) continue;
    const result = rules.simulate(rng, a, d, 6, teamEff(a), teamEff(d));
    games++;
    assert.notEqual(result.ga, result.gd, 'never level at the end');
    const sum = id => result.ev.filter(e => e.tid === id).reduce((s, e) => s + e.pts, 0);
    assert.deepEqual([sum(a.id), sum(d.id)], [result.ga, result.gd], 'the feed adds up to the final score');
    for (const e of result.ev) {
      assert.ok(e.kind === 'try' ? e.pts === 3 || e.pts === 5 : e.kind === 'penalty' ? e.pts === 2 : e.kind === 'field' && e.pts === 2, JSON.stringify(e));
    }
    assert.ok(result.ev.every((e, k) => k === 0 || result.ev[k - 1].m <= e.m), 'in order');
    const regulation = result.ev.filter(e => e.m <= 80);
    fieldGoals += regulation.filter(e => e.kind === 'field').length;
    tries += regulation.filter(e => e.kind === 'try').length;
    points += result.regA + result.regD;
    if (result.tie) {
      extra++;
      assert.equal(result.regA, result.regD, 'extra time only from a level score');
      const { periods } = result.tie;
      assert.ok(periods.length >= 1 && periods.length <= SLICE_MODEL.MAX_EXTRA);
      // Each period is played to its end, and only a level one is followed by another.
      for (const [x, y] of periods.slice(0, -1)) assert.equal(x, y);
      assert.notEqual(...periods.at(-1));
      assert.ok(result.ev.every(e => e.m <= 80 + SLICE_MODEL.EXTRA * periods.length));
      assert.deepEqual([result.tie.ga, result.tie.gd], [result.ga, result.gd]);
    } else assert.ok(result.ev.every(e => e.m >= 1 && e.m <= 80));
  }
  const league = NRL_LEAGUE_AVERAGES['nrl-1968'];
  assert.ok(Math.abs(points / games / 2 - league.points) < 0.6, `1968's points a team (${(points / games / 2).toFixed(1)}, real ${league.points})`);
  assert.ok(Math.abs(tries / games / 2 - league.tries) < 0.15, `1968's tries a team (${(tries / games / 2).toFixed(2)}, real ${league.tries})`);
  assert.ok(Math.abs(fieldGoals / games / 2 - league.fieldGoals) < 0.08, `the field goals of the four-tackle rule (${(fieldGoals / games / 2).toFixed(2)})`);
  assert.ok(extra / games > 0.01 && extra / games < 0.06, `extra time now and then (${(extra / games * 100).toFixed(1)}%)`);
  // The seventies: three-point tries, one-point field goals; the eighties and nineties four and one, extra time still.
  for (const [id, values] of [['nrl-1977', [3, 5, 1]], ['nrl-1990', [4, 6, 1]]]) {
    const era = matchSport(seasonSettings(id)), [x, y] = seasonClubs(id);
    const seen = new Set();
    for (let k = 0; k < 300; k++) for (const e of era.simulate(rng, x, y, 6, teamEff(x), teamEff(y)).ev) seen.add(`${e.kind}:${e.pts}`);
    assert.ok([...seen].every(key => [`try:${values[0]}`, `try:${values[1]}`, 'penalty:2', `field:${values[2]}`].includes(key)), `${id}: ${[...seen]}`);
  }
});

test('a game still level after a third extra time ends with a field goal on its last minute; golden point from 2003', () => {
  // Nobody scores in play: every game goes the distance, and the last field goal, near a coin flip, decides it.
  const scoreless = rugbyLeagueWith(Object.freeze({ ...matchSport(seasonSettings('nrl-1965')).rules, tries: 1e-9, penalties: 0, fieldGoals: 0 }));
  const [a, d] = seasonClubs('nrl-1965');
  const rng = makeRng(3);
  let attackerWins = 0;
  for (let k = 0; k < 400; k++) {
    const result = scoreless.simulate(rng, a, d, 6, teamEff(a), teamEff(d));
    assert.deepEqual(result.tie.periods.map(([x, y]) => x + y), [0, 0, 2], 'two goalless periods, then the deciding field goal');
    assert.deepEqual(result.ev.map(e => [e.m, e.kind, e.pts]), [[80 + 3 * SLICE_MODEL.EXTRA, 'field', 2]]);
    assert.equal(result.ev[0].tid, result.winner);
    if (result.winner === a.id) attackerWins++;
  }
  assert.ok(attackerWins > 150 && attackerWins < 250, `close to a coin flip (${attackerWins} of 400)`);
  // 2003 on: golden point, its first score the winner.
  const noughties = matchSport(seasonSettings('nrl-2005')), clubs = seasonClubs('nrl-2005');
  assert.equal(noughties.rules.golden, true);
  let golden = 0;
  for (let k = 0; k < 2000; k++) {
    const x = clubs[k % clubs.length], y = clubs[(k * 7 + 2) % clubs.length];
    if (x === y) continue;
    const result = noughties.simulate(rng, x, y, 6, teamEff(x), teamEff(y));
    if (!result.tie) continue;
    golden++;
    const late = result.ev.filter(e => e.m > 80);
    assert.equal(late.length, 1, 'the first score wins');
    assert.ok(late[0].m <= 80 + SLICE_MODEL.GOLDEN * SLICE_MODEL.MAX_GOLDEN);
  }
  assert.ok(golden > 10, `golden point now and then (${golden})`);
});

test('extra time reads on the clock, the feed, the scorers\' line and the tie-break texts; golden point\'s seasons read as today', () => {
  const rules = matchSport(seasonSettings('nrl-1990'));
  assert.deepEqual([rules.labels.tie, rules.labels.tieShort, rules.words.overtime, rules.clock.ot, rules.clock.sudden], ['EXTRA TIME', 'ET', 'Extra time', 20, false]);
  assert.deepEqual([clockLabel(rules, 95), clockTick(rules, 80), clockTick(rules, 100), clockTick(rules, 120), clockTick(rules, 140)],
    ["95'", "80'", 'ET', '2ET', '3ET']);
  assert.deepEqual([1, 2, 3].map(n => overtimeText(rules, n)), ['after extra time', 'after a second extra time', 'after a third extra time']);
  assert.deepEqual([1, 2, 3].map(n => overtimeShort(rules, n)), ['ET', '2ET', '3ET']);
  assert.deepEqual(['Won after a third extra time', 'after a second extra time', 'after extra time', 'in golden point', 'level']
    .map(text => overtimePeriodsOf(rules, text)), [3, 2, 1, 1, null]);
  assert.deepEqual([overtimeEnd(rules, 1), overtimeEnd(rules, 3)], [100, 140], 'extra time is played to its end');
  const noughties = matchSport(seasonSettings('nrl-2005'));
  assert.deepEqual([noughties.labels.tie, overtimeText(noughties, 1), overtimeEnd(noughties, 1), clockTick(noughties, 85)],
    ['GOLDEN POINT', 'in golden point', 0, 'GP']);
  const base = { sport: 'rugby-league', state: 'live', aCode: 'PEN', bCode: 'MAN', aName: 'Penrith Panthers', bName: 'Manly Warringah Sea Eagles',
    aId: 'p', dId: 'm', length: 80, half: 40, finalMinute: 100, scoreA: 6, scoreB: 6, kickoff: 'Kick-off', endLabel: 'Full time', overtime: true,
    events: [{ key: 'e0', m: 5, label: "5'", tid: 'm', pts: 6, text: 'TRY — Cliff Lyons (MAN)' },
      { key: 'e1', m: 51, label: "51'", tid: 'p', pts: 6, text: 'TRY — Greg Alexander (PEN)' }] };
  const rows = buildFeedRows({ feedBase: base, clockSport: rules }, 86);
  assert.ok(rows.some(row => row.text === 'Extra time — PEN 6–6 MAN'), JSON.stringify(rows.map(row => row.text)));
  assert.equal(rows[0].text, 'Live — PEN 6–6 MAN · extra time');
  // The scorers' line ranks by the day's points: in 1968 two field goals (four points) outrank a try (three).
  const shown = [{ tid: 'p', m: 10, name: 'Arthur Beetson', pts: 3, kind: 'try' }, { tid: 'p', m: 30, name: 'Keith Outten', pts: 2, kind: 'field' },
    { tid: 'p', m: 60, name: 'Keith Outten', pts: 2, kind: 'field' }];
  assert.equal(scorersLine(shown, 'p', {}, matchSport(seasonSettings('nrl-1968'))), 'Outten 2 FG · Beetson 1 try');
  assert.equal(scorersLine(shown, 'p', {}, 'rugby-league'), 'Beetson 1 try · Outten 2 FG', 'today a try is worth more');
});

test('an earlier season\'s live chart plays its points, its kicks and its extra time in full', () => {
  const rules = matchSport(seasonSettings('nrl-1965')), clubs = seasonClubs('nrl-1965');
  for (const [i, j] of [[0, clubs.length - 1], [3, 4], [clubs.length - 1, 1]]) {
    const model = liveModelFor(rules, clubs[i], clubs[j], undefined, undefined, 6);
    assert.ok(isLiveModel(model));
    assert.deepEqual([model.kind, model.ot, model.maxOt, model.extra, model.points], ['tries', 20, 3, true, [3, 2]]);
    assert.deepEqual(model.kicks, [rules.rules.penalties, rules.rules.fieldGoals, rules.rules.openFieldGoals]);
    const odds = estimateWinProbability({ sport: rules, attacker: clubs[i], defender: clubs[j], preset: 'balanced', samples: 12000 }).attacker;
    assert.ok(Math.abs(winProbabilityAt(model, 0, 0) - odds) < 0.02, `kick-off ${winProbabilityAt(model, 0, 0)} v odds ${odds}`);
    assert.ok(winProbabilityAt(model, 60, 5) > winProbabilityAt(model, 60, 0) && winProbabilityAt(model, 60, 0) > winProbabilityAt(model, 60, -5));
    assert.equal(winProbabilityAt(model, 80, 1), 1, 'a lead at full time has won');
    // Level after eighty, extra time is still open: 1965's first and last clubs play eight points of strength apart.
    const level = winProbabilityAt(model, 80, 0);
    assert.ok(level > 0.1 && level < 0.9, `level after eighty (${level})`);
    const ahead = winProbabilityAt(model, 90, 2);
    assert.ok(ahead > level && ahead < 1, `two up in extra time has not won until it ends (${ahead})`);
    assert.equal(winProbabilityAt(model, 100, 2), 1, 'a lead at the end of a period has');
    assert.ok(Math.abs(winProbabilityAt(model, 140, 0) - deciderOdds(model.golden)) < 1e-9, 'level after the third: the last field goal');
  }
  const model = liveModelFor(rules, clubs[0], clubs[1]);
  assert.deepEqual(chartDomain(model, 90).ticks, [0, 20, 40, 60, 80, 100], 'a tick at each period of extra time reached');
  const series = winSeries({ model, goals: [{ m: 5, tid: 'a', pts: 5 }, { m: 40, tid: 'd', pts: 5 }, { m: 92, tid: 'a', pts: 2 }], aId: 'a', dId: 'd',
    minute: 92, final: { winnerSide: 'A' } });
  assert.deepEqual([series.at(-1).t, series.at(-1).p], [100, 1], 'the chart runs to the end of the period, played in full');
  // Malformed earlier rules are refused; today's model names none of them.
  for (const broken of [{ points: [5, 2] }, { kicks: [1, 2, 0] }, { kicks: [1, 0.5] }, { points: undefined }, { kicks: undefined }, { extra: 1 }]) {
    assert.equal(isLiveModel({ ...model, ...broken }), false, JSON.stringify(broken));
  }
  const today = liveModelFor(sport, teams[0], teams[1]);
  assert.deepEqual(['points', 'kicks', 'extra'].filter(key => key in today), []);
  // A golden point season's chart reads as today's, at its own scoring.
  const noughties = liveModelFor(matchSport(seasonSettings('nrl-2005')), teams[0], teams[1]);
  assert.deepEqual([noughties.ot, noughties.maxOt, noughties.extra, noughties.points], [5, 4, undefined, [4, 1]]);
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
  assert.equal(SPORT_LIST[9].id, 'rugby-league', 'the last of the sports, before the esports');
  assert.equal(SPORT_LIST[10].id, 'rocket-league', 'the first esport');
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

test('the strength the model plays is its attack and defence\'s mean, and a point of it is worth its first-order margin', () => {
  const panthers = byId['nrl-penrith-panthers'], storm = byId['nrl-melbourne-storm'];
  const strength = team => rugbyLeagueStrength(selectLineup(team));
  // The units' weights: backs 0.3, halves 0.225, forwards 0.475 (attack and defence halved), on the player-rating scale.
  const profile = rugbyLeagueProfile(selectLineup(panthers));
  assert.ok(Math.abs(strength(panthers) - (0.3 * profile.backs + 0.225 * profile.halves + 0.475 * profile.forwards)) < 1e-9);
  // Every player a point up: the strength a point up, the lineup unchanged.
  const up = { ...panthers, squad: panthers.squad.map(player => ({ ...player, rating: player.rating + 1 })) };
  assert.ok(Math.abs(strength(up) - strength(panthers) - 1) < 1e-9);
  // Each point moves the two try rates apart by 0.14 in log, at whatever scoring: the margin's first order.
  for (const rules of [RULES_TODAY, rulesIn('nrl-1965', 1965)]) {
    const model = rugbyLeagueWith(rules);
    const before = model.prepareMatch(panthers, storm, teamEff(panthers), teamEff(storm));
    const after = model.prepareMatch(up, storm, teamEff(up), teamEff(storm));
    assert.ok(Math.abs(Math.log(after.triesA / after.triesD) - Math.log(before.triesA / before.triesD) - 0.28) < 0.02);
  }
  assert.ok(Math.abs(marginPerStrength(4, 4) - 0.28 * 4 * (4 + 2 * 0.755)) < 1e-12);
  assert.ok(Math.abs(marginPerStrength(2.5, 3) - 0.28 * 2.5 * (3 + 2 * 0.755)) < 1e-12, 'a try worth three before 1983');
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
