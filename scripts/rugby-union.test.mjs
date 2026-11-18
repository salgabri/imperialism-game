// Rugby union, "Rugby" in the game (docs/design/rugby-union.md): the European clubs and the nations computed from the
// committed RugbyPass snapshot, the parsers that read RugbyPass's match centre, the slice-by-slice match model and its
// live win probability, the Six Nations theatre and the setup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLUBS, SOURCE } from '../src/data/clubs.rugby-union.js';
import { ROSTERS } from '../src/data/rosters.rugby-union.js';
import { buildClub, buildTeam, fieldsRealSide, isEuropeanScope, makeRng, NATIONS, RUGBY_CROSSING_PENALTY, RUGBY_NEAR_PENALTY,
  SCOPES, selectLineup, SIX_NATIONS, teamEff, teamSportId, UNION_CROSSING_PENALTY } from '../src/data/teams.js';
import { nationTheatre, nationTheatres } from '../src/data/scopes.js';
import { clockLabel, clockTick, getSport, matchSport, overtimeEnd, overtimePeriodsOf, overtimeShort, overtimeText, SPORT_LIST } from '../src/sports/index.js';
import { BASELINE, deciderOdds, goldenRate, marginOfGap, onField, POINTS, rugbyUnionProfile, rugbyUnionStrength, SLICE_MODEL,
  sliceMeans } from '../src/sports/rugbyUnion.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import { chartDomain, isLiveModel, liveModelFor, winProbabilityAt, winSeries } from '../src/engine/winProbability.js';
import { builtInSeasonOf, fieldedNations } from '../src/engine/footballSets.js';
import { buildSetupModel, SPORT_NOTES, sportNote } from '../src/screens/setup/setupModel.js';
import { buildSquad } from '../src/viewModels/squad.js';
import { scorersLine } from '../src/viewModels/match.js';
import { isEstimated } from '../src/data/estimates.js';
import { fixturesOf, gameOf, seasonsOf, valueAt } from './lib/rugbypass.mjs';
import { CORE, corePoints, endOf, minutesOf, nationOfTeam, POSITIONS, realFigures, referenceFor, snapshotOf, TOTALS } from './lib/rugby-union.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const sport = getSport('rugby-union');
const SNAPSHOT = JSON.parse(read('scripts/data/rugby-union-2025-26.json'));
const AUDIT = JSON.parse(read('docs/design/rugby-union-audit.json'));
const SPECS = JSON.parse(read('scripts/data/rugby-union-clubs.json')).clubs;
const teams = CLUBS.map(club => buildClub(club, sport));
const byId = Object.fromEntries(teams.map(team => [team.id, team]));

// ---------- the source ----------

test('the RugbyPass parsers read a JSON value to its bracket, the season list, a season\'s games and a game', () => {
  const text = 'x = {"a":"]}","b":[1,{"c":"\\"}"}]} tail';
  assert.deepEqual(valueAt(text, text.indexOf('{')), { a: ']}', b: [1, { c: '"}' }] });
  assert.deepEqual(seasonsOf('fixturesApp seasons:[{"season":202501,"years":{"2025":2025,"2026":2026},"label":"2025\\/2026","completed":1,"games":93}], x'),
    [{ season: 202501, label: '2025/2026', years: [2025, 2026], completed: 1, games: 93 }]);
  // A finals day may come as an object keyed by day.
  const game = { id: 7, url: 'u', epoch: 1, round: 'Final', tournamentUri: 'top-14', status: 'result', played: true, homeTeam: { id: 1, name: 'A' },
    awayTeam: { id: 2, name: 'B' }, homeScore: 20, awayScore: 13, venue: 'V' };
  const fixtures = fixturesOf({ currentGameDays: [], currentFinalGameDays: { d1: { tournaments: [{ games: [game] }] } } });
  assert.deepEqual(fixtures.map(f => [f.id, f.home.name, f.homeScore, f.round, f.played]), [[7, 'A', 20, 'Final', true]]);
  const page = 'appUri:\'home\', game:{"comp":1,"compUri":"six-nations","compTitle":"Six Nations","season":"202600","id":"9",'
    + '"homeTeam":{"id":5,"rpid":806,"name":"France","score":48},"awayTeam":{"id":1,"rpid":804,"name":"England","score":46},'
    + '"date":"2026-03-14T20:10:00.000Z","venue":"Stade de France","roundTitle":"5","dateStatus":"Full Time"}, '
    + '"homePlayers":[{"id":11,"fname":"Thomas Ramos","uri":"thomas-ramos","pos_id":15,"pos":"Outside Back",'
    + '"events":[{"minute":7,"second":40,"type":"conversion"}],"subEvents":[]}],"awayPlayers":[],"hasTeamSheets":true,'
    + '"keyEvents":{"eventList":[{"type":"interval"},{"type":"penalty-goal","side":"home","playerId":11,"time":"82\'","score":"48-46"}]},'
    + '"teamStats":{"statsSummary":[{"title":"Tries","home":"6","away":"7"}]},'
    + '"playerStats":{"stats":{"carries":[{"name":"Thomas Ramos","link":"https:\\/\\/www.rugbypass.com\\/players\\/thomas-ramos\\/","total":16}]}}';
  const parsed = gameOf(page);
  assert.deepEqual([parsed.id, parsed.competition, parsed.season, parsed.home.name, parsed.homeScore, parsed.awayScore, parsed.sheets],
    [9, 'six-nations', 202600, 'France', 48, 46, true]);
  assert.deepEqual(parsed.players.home[0], { id: 11, name: 'Thomas Ramos', uri: 'thomas-ramos', number: 15, position: 'Outside Back',
    events: [['conversion', 7.67]], subs: [] });
  assert.deepEqual(parsed.scoring, [{ type: 'penalty-goal', side: 'home', player: 11, time: "82'", score: '48-46' }]);
  assert.deepEqual([parsed.summary.Tries, parsed.stats.carries], [['6', '7'], { 'thomas-ramos': 16 }]);
  assert.throws(() => gameOf('<html>no game</html>'), /holds no game/);
});

test('a player\'s minutes follow his substitutions, a blood replacement\'s too, and a game ends at its last event', () => {
  assert.equal(minutesOf({ number: 3, subs: [['sub-off', 52.5]] }, 80), 52.5, 'a starter replaced');
  assert.equal(minutesOf({ number: 17, subs: [['sub-on', 52.5]] }, 80), 27.5, 'a replacement on');
  assert.equal(minutesOf({ number: 1, subs: [['sub-off', 62], ['sub-on', 77]] }, 80), 65, 'off, then back on');
  assert.equal(minutesOf({ number: 22, subs: [] }, 80), 0, 'an unused replacement');
  const player = (number, events, subs = []) => ({ number, events, subs });
  assert.equal(endOf({ players: { home: [player(15, [['penalty', 82.78]])], away: [] } }), 82.78);
  assert.equal(endOf({ players: { home: [player(10, [['drop-goal', 104]])], away: [] } }), 100, 'extra time, at most twenty minutes of it');
  assert.equal(endOf({ players: { home: [], away: [] } }), 80);
});

test('a Test side is its nation on the map; an A side, the Barbarians and a side with no land of its own are none', () => {
  assert.deepEqual(['England', 'Ireland', 'Scotland', 'Wales', 'Italy', 'France', 'Georgia', 'USA', 'Fiji'].map(nationOfTeam),
    ['826', '372', 'SCO', 'WAL', '380', '250', '268', '840', '242']);
  assert.deepEqual(['England A', 'Barbarians', 'Hong Kong China', 'British & Irish Lions'].map(nationOfTeam), [null, null, null, null]);
});

test('the snapshot sums each player\'s seasons from the team sheets, and keeps only the players of the three leagues\' clubs', () => {
  const sheet = (id, name, number, events = [], subs = []) => ({ id, name, uri: name.toLowerCase().replace(/ /g, '-'), number,
    position: number <= 15 ? 'Prop' : 'Hooker', events, subs });
  const game = (id, competition, home, away, players) => ({ fixture: { id, epoch: Date.UTC(2025, 9, id) / 1000, kind: competition === 'six-nations' ? 'test' : 'club', competition },
    game: { id, date: new Date(Date.UTC(2025, 9, id)).toISOString(), venue: 'V', home, away, homeScore: 12, awayScore: 5,
      summary: { Tries: ['2', '1'], Conversions: ['1', '0'], 'Penalty Goals': ['0', '0'], 'Drop Goals': ['0', '0'] },
      scoring: [], stats: { completed_tackles: { 'ann-one': 9 }, carries_metres: { 'ann-one': 31 } }, players }, });
  const seasons = [{ key: '2025/26', from: Date.UTC(2025, 7, 1), to: Date.UTC(2026, 7, 1) }];
  const snapshot = snapshotOf({ seasons, competitions: {}, games: [
    game(1, 'top-14', { id: 10, name: 'Toulouse' }, { id: 20, name: 'Pau' }, {
      home: [sheet(1, 'Ann One', 1, [['try', 10]], [['sub-off', 60]]), sheet(2, 'Bob Two', 16, [], [['sub-on', 60]]), sheet(3, 'Cy Three', 18)],
      away: [] }),
    game(2, 'six-nations', { id: 30, name: 'France' }, { id: 40, name: 'Italy' }, { home: [sheet(1, 'Ann One', 1)], away: [sheet(9, 'Dee Nine', 2)] }),
  ] });
  assert.deepEqual(snapshot.teams, { 10: ['Toulouse', 'club'], 20: ['Pau', 'club'], 30: ['France', 'test'], 40: ['Italy', 'test'] });
  assert.deepEqual(snapshot.games[0].slice(0, 8), [1, 0, 'top-14', '2025-10-01', 10, 20, 12, 5]);
  assert.deepEqual(snapshot.players.map(row => row[1]), ['Ann One', 'Bob Two'], 'Cy Three never came on; Dee Nine has no club of the leagues');
  const [stints, starts, bench, totals] = snapshot.players[0][2][0];
  assert.deepEqual(stints, [[10, 1, 1, 60], [30, 1, 1, 80]]);
  assert.deepEqual([starts, bench], [{ PR: 2 }, {}]);
  // Both games' stats name him (the helper gives every game the same): his tackles and metres add up over them.
  assert.deepEqual(Object.fromEntries(TOTALS.map((key, i) => [key, totals[i]])).tackles, 18);
  assert.equal(corePoints(Object.fromEntries(TOTALS.map((key, i) => [key, totals[i]])), 'PR'), 15 + 6.2 + 18, 'a forward\'s try, his metres and tackles');
  assert.deepEqual(snapshot.tryPlaces, [[0, 'top-14', { PR: 1 }]]);
  assert.deepEqual([CORE.tries.forward, CORE.tries.back, CORE.penaltyGoals.points, CORE.yellow.points], [15, 10, 3, -3]);
});

// ---------- the season ----------

test('the clubs, the nations and the audit rebuild byte for byte from the committed snapshot', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.match(execFileSync(process.execPath, ['scripts/build-rugby-union.mjs', '--check'], { cwd: root, encoding: 'utf8' }), /Verified/);
  assert.deepEqual(SNAPSHOT.seasons, ['2025/26', '2024/25', '2023/24']);
  assert.ok(SNAPSHOT.games.length > 1900 && SNAPSHOT.players.length > 1800, `${SNAPSHOT.games.length} games, ${SNAPSHOT.players.length} players`);
  assert.deepEqual([SOURCE.provider, SOURCE.season, SOURCE.edition], ['RugbyPass', '2025/26', 'Computed']);
  assert.match(SNAPSHOT.source.terms, /robots\.txt/);
});

test('36 European clubs: the Premiership\'s ten, the Top 14\'s fourteen and the URC\'s twelve, each in its own country', () => {
  const counts = {};
  for (const club of CLUBS) counts[club.league] = (counts[club.league] ?? 0) + 1;
  assert.deepEqual(counts, { Premiership: 10, 'Top 14': 14, URC: 12 });
  const europe = Object.values(SPECS).filter(spec => spec.europe !== false);
  assert.deepEqual(CLUBS.map(club => club.id).sort(), europe.map(spec => spec.id).sort(), 'the South African sides play on no map');
  for (const club of CLUBS) {
    assert.ok(['826', '250', '372', '380', 'SCO', 'WAL', 'NIR'].includes(club.country), `${club.name}: ${club.country}`);
    assert.equal(new Set(CLUBS.map(c => c.code)).size, CLUBS.length, 'codes are unique');
  }
  // Clubs order as 2025/26 did, broadly: Toulouse, Bath and Leinster near the top, Montauban last.
  const rank = id => CLUBS.findIndex(club => club.id === id);
  assert.ok(rank('ru-stade-toulousain') < 3 && rank('ru-bath') < 4 && rank('ru-leinster') < 8, CLUBS.slice(0, 8).map(c => c.name).join(', '));
  assert.equal(CLUBS.at(-1).id, 'ru-us-montauban');
});

test('every club fields a whole matchday 23 of its own and depth behind it; every rating is an estimate, marked', () => {
  for (const team of teams) {
    const lineup = selectLineup(team);
    assert.equal(lineup.slots.length, 23);
    const crossing = lineup.slots.filter(slot => !slot.player || slot.penalty > RUGBY_NEAR_PENALTY);
    assert.deepEqual(crossing.map(slot => slot.position), [], `${team.name} fills every place within its units`);
    assert.ok(team.squad.length >= 23 && team.squad.length <= 30, `${team.name}: ${team.squad.length}`);
    for (const player of team.squad) {
      assert.ok(player.rating >= 1 && player.rating <= 99 && Number.isInteger(player.rating));
      assert.ok([player.pos, ...(player.positions || [])].every(code => POSITIONS.includes(code)), `${player.name}: ${player.pos}`);
      assert.ok(isEstimated(player), `${player.name} is marked an estimate`);
    }
  }
  // A kicker carries his goals: the model's goal-kicker is the starter who kicked the most.
  const kickers = CLUBS.flatMap(club => club.squad).filter(tuple => tuple[3].goals);
  assert.ok(kickers.length >= 60, `${kickers.length} kickers`);
  assert.equal(teamSportId({ squad: [{ pos: 'FL' }, { pos: 'PR' }] }), 'rugby-union', 'a squad with union\'s own codes is union\'s');
});

test('positions: a flanker at number eight is a small move, a lock in the back row a near one, a wing at prop an emergency', () => {
  const lineupOf = squad => selectLineup({ sport: 'rugby-union', squad });
  const xv = (extra = []) => [['PR', 80], ['PR', 80], ['HK', 80], ['LK', 80], ['LK', 80], ['FL', 80], ['FL', 80], ['N8', 80], ['SH', 80],
    ['FH', 80], ['CE', 80], ['CE', 80], ['WG', 80], ['WG', 80], ['FB', 80], ['HK', 70], ['PR', 70], ['PR', 70], ['LK', 70], ['FL', 70],
    ['SH', 70], ['FH', 70], ['CE', 70], ...extra].map(([pos, rating], i) => ({ name: `P${i}`, pos, rating }));
  assert.ok(lineupOf(xv()).slots.every(slot => slot.penalty === 0), 'a whole 23 plays in position');
  const noEight = xv().filter(p => p.pos !== 'N8');
  noEight.push({ name: 'Spare flanker', pos: 'FL', rating: 80 });
  const eight = lineupOf(noEight).slots.find(slot => slot.position === 'N8');
  assert.equal(eight.penalty, 4, 'a flanker at number eight');
  const noProps = xv().filter(p => p.pos !== 'PR').concat([{ name: 'Wing', pos: 'WG', rating: 90 }, { name: 'Lock', pos: 'LK', rating: 60 }]);
  const props = lineupOf(noProps).slots.filter(slot => slot.position === 'PR');
  assert.ok(props.every(slot => !slot.player || slot.penalty >= RUGBY_NEAR_PENALTY), 'no prop: hookers cover, then emergencies');
  assert.equal(UNION_CROSSING_PENALTY > RUGBY_CROSSING_PENALTY, true, 'union\'s places are more specialised than league\'s');
  // Every nation fields its matchday 23 within its units, whatever the draw of its generated players.
  for (const id of Object.keys(ROSTERS)) {
    for (const seed of [1, 77, 20260802]) {
      const lineup = selectLineup(buildTeam(id, makeRng(seed), sport));
      assert.deepEqual(lineup.slots.filter(slot => !slot.player || slot.penalty > RUGBY_NEAR_PENALTY).map(slot => slot.position), [],
        `${NATIONS[id][0]} (seed ${seed})`);
    }
  }
});

test('nations field the clubs\' players by their latest Test side; the Six Nations and the others with half a side play', () => {
  const fielded = fieldedNations(sport);
  for (const id of SIX_NATIONS) assert.ok(fielded.includes(id), `${NATIONS[id][0]} fields a team`);
  for (const id of ['032', '710', '242', '268']) assert.ok(fielded.includes(id), `${NATIONS[id][0]} fields a team`);
  assert.ok(!fielded.includes('554'), 'New Zealand\'s players play at home: no side of these clubs\' players');
  for (const id of fielded) assert.ok(fieldsRealSide(id, sport));
  // Each of the six plays at its Test results' level: France above Ireland and England, Italy and Wales below them all.
  const strength = id => rugbyUnionStrength(selectLineup(buildTeam(id, makeRng(1), sport)));
  const [fra, irl, eng, sco, ita, wal] = ['250', '372', '826', 'SCO', '380', 'WAL'].map(strength);
  assert.ok(fra > irl && fra > eng && Math.min(irl, eng, sco) > Math.max(ita, wal), JSON.stringify({ fra, irl, eng, sco, ita, wal }));
  const moved = AUDIT.report.tests.moves;
  assert.deepEqual(Object.keys(moved).sort(), ['032', '250', '372', '380', '826', 'SCO', 'WAL'].sort(), 'only nations these clubs\' players cover');
  for (const id of Object.keys(moved)) assert.ok(moved[id].coverage >= AUDIT.report.tests.covered);
  assert.equal(ROSTERS['250'][2].length, 30, 'a nation\'s squad: its 23 and depth');
});

test('the Six Nations is rugby union\'s own theatre, framed on Europe, beside the world and Europe\'s', () => {
  const scope = SCOPES.find(entry => entry.id === 'six-nations');
  assert.deepEqual(scope.sports, ['rugby-union']);
  assert.ok(isEuropeanScope('six-nations'));
  assert.deepEqual(nationTheatres(sport).map(entry => entry.id).filter(id => ['world', 'UEFA', 'six-nations'].includes(id)), ['world', 'UEFA', 'six-nations']);
  assert.equal(nationTheatre(getSport('rugby-league'), 'six-nations').id === 'six-nations', false, 'rugby league plays its heartland instead');
  assert.equal(nationTheatre(getSport('football'), 'six-nations').id === 'six-nations', false);
  const model = buildSetupModel({ sport: 'rugby-union', layer: 'nations', scope: 'six-nations' }, {});
  assert.equal(model.layer, 'nations');
  assert.ok(model.theatre?.id === 'six-nations' || model.scope === 'six-nations' || JSON.stringify(model).includes('Six Nations'), 'the setup offers it');
});

// ---------- the match ----------

test('matches always produce a winner, the feed adds up, and sudden death ends at its score', () => {
  const rng = makeRng(20261118);
  let points = 0, games = 0, tied = 0, tries = 0;
  for (let i = 0; i < 4000; i++) {
    const a = teams[i % teams.length], d = teams[(i * 7 + 3) % teams.length];
    if (a === d) continue;
    const result = sport.simulate(rng, a, d, 6, teamEff(a), teamEff(d));
    assert.ok(result.winner === a.id || result.winner === d.id);
    assert.notEqual(result.ga, result.gd, 'never level at the end');
    assert.equal(result.winner === a.id, result.ga > result.gd);
    const sum = id => result.ev.filter(e => e.tid === id).reduce((s, e) => s + e.pts, 0);
    assert.deepEqual([sum(a.id), sum(d.id)], [result.ga, result.gd], 'the feed adds up to the final score');
    for (const e of result.ev) {
      assert.ok(e.kind === 'try' ? e.pts === 5 || e.pts === 7 : (e.kind === 'penalty' || e.kind === 'field') && e.pts === 3, JSON.stringify(e));
      assert.ok(typeof e.name === 'string' && e.name, 'a name on every score');
    }
    assert.ok(result.ev.every((e, k) => k === 0 || result.ev[k - 1].m <= e.m), 'in order');
    tries += result.ev.filter(e => e.kind === 'try' && e.m <= 80).length;
    if (result.tie) {
      tied++;
      assert.equal(result.regA, result.regD, 'extra time only from a level score');
      const late = result.ev.filter(e => e.m > 80);
      assert.equal(late.length, 1, 'the first score wins: nothing after it');
      assert.equal(late[0].tid, result.winner);
      assert.ok(late[0].m <= 80 + SLICE_MODEL.GOLDEN * SLICE_MODEL.MAX_GOLDEN);
    } else assert.ok(result.ev.every(e => e.m >= 1 && e.m <= 80));
    points += result.regA + result.regD;
    games++;
  }
  const perTeam = points / games / 2;
  assert.ok(perTeam > 24 && perTeam < 30, `about 27 points a team (${perTeam.toFixed(1)})`);
  assert.ok(tries / games / 2 > 3.3 && tries / games / 2 < 4.1, `about 3.7 tries a team (${(tries / games / 2).toFixed(2)})`);
  assert.ok(tied / games > 0.01 && tied / games < 0.05, `level after eighty now and then (${(tied / games * 100).toFixed(1)}%)`);
});

test('score effects: a side within two scores chases late, a side far ahead eases, the three points are taken when they count', () => {
  const early = sliceMeans(3.6, 0, 0);
  assert.ok(Math.abs(early.tries - 3.6 / 16 * (2 - 1.03)) < 1e-9);
  assert.equal(early.fieldGoals, 0, 'no late drop goals early');
  const chasing = sliceMeans(3.6, -6, 13), protecting = sliceMeans(3.6, 6, 13), level = sliceMeans(3.6, 0, 13);
  assert.ok(chasing.tries > level.tries && protecting.tries < level.tries);
  assert.ok(level.penalties > early.penalties, 'level late, both take the three points');
  assert.ok(sliceMeans(3.6, -10, 13).penalties < early.penalties, 'ten down late, a side kicks for the corner');
  const last = SLICE_MODEL.SLICES - 1;
  assert.ok(sliceMeans(3.6, 0, last).fieldGoals > 0 && sliceMeans(3.6, -3, last).fieldGoals > 0 && sliceMeans(3.6, -4, last).fieldGoals === 0);
  assert.ok(sliceMeans(3.6, 24, 3).tries < sliceMeans(3.6, 0, 3).tries, 'far ahead, a side eases off');
  assert.ok(goldenRate(4) > goldenRate(3.5));
  assert.ok(Math.abs(deciderOdds(0) - 0.5) < 1e-12 && deciderOdds(5) > 0.5 && deciderOdds(5) < 0.6);
  assert.deepEqual(POINTS, { TRY: 5, CONVERSION: 2, PENALTY_GOAL: 3, FIELD_GOAL: 3 });
});

test('the model plays its attack and defence\'s mean, and the clubs\' margins follow their 2025/26 results', () => {
  const rng = makeRng(5);
  let total = 0;
  for (let i = 0; i < 6000; i++) total += marginOfGap(3, rng);
  assert.ok(Math.abs(total / 6000 - 3 * AUDIT.report.perPoint) < 1.5, `three points of strength: ${(total / 6000).toFixed(2)} a game`);
  const profile = rugbyUnionProfile(byId['ru-leinster']);
  assert.ok(profile.forwards > 60 && profile.backs > 60 && profile.halves > 60, JSON.stringify(profile));
  // Every club's matchday strength reached its target, the club's results moved by √reliability.
  for (const club of AUDIT.clubs) assert.ok(Math.abs(club.after - club.target) < 0.6, `${club.name}: ${club.after} v ${club.target}`);
  assert.ok(AUDIT.report.srs.reliability > 0.8 && AUDIT.report.tests.reliability > 0.8);
});

test('stronger teams are favourites, level sides are even, and home advantage counts when it is on', () => {
  const best = byId['ru-stade-toulousain'], worst = byId['ru-us-montauban'];
  const odds = preset => estimateWinProbability({ sport, attacker: best, defender: worst, preset, samples: 6000 }).attacker;
  const [predictable, balanced, wild] = ['predictable', 'balanced', 'wild'].map(odds);
  assert.ok(predictable > wild, `${predictable} > ${wild}`);
  assert.ok(balanced > 0.8 && balanced < 0.995, `a heavy favourite, never a certainty: ${balanced}`);
  const pairing = { sport, attacker: byId['ru-munster'], defender: byId['ru-sale-sharks'], preset: 'balanced', samples: 8000 };
  const neutral = estimateWinProbability(pairing).defender, home = estimateWinProbability({ ...pairing, home: true }).defender;
  assert.ok(home > neutral + 0.1, `the home side gains a lot in rugby union (${home} v ${neutral})`);
});

test('the feed copy, the scorers, the clock and the extra-time texts', () => {
  assert.deepEqual(sport.formatEvent({ m: 6, pts: 7, kind: 'try', name: 'Louis Bielle-Biarrey' }, 'FRA'), { when: "6'", text: 'TRY — Louis Bielle-Biarrey (FRA)' });
  assert.deepEqual(sport.formatEvent({ m: 22, pts: 3, kind: 'penalty', name: 'Thomas Ramos' }, 'FRA'), { when: "22'", text: 'PENALTY GOAL — Thomas Ramos (FRA)' });
  assert.deepEqual(sport.formatEvent({ m: 78, pts: 3, kind: 'field', name: 'Marcus Smith' }, 'ENG'), { when: "78'", text: 'DROP GOAL — Marcus Smith (ENG)' });
  const shown = [{ tid: 'f', m: 6, name: 'Louis Bielle-Biarrey', pts: 7, kind: 'try' }, { tid: 'f', m: 12, name: 'Louis Bielle-Biarrey', pts: 5, kind: 'try' },
    { tid: 'f', m: 22, name: 'Thomas Ramos', pts: 3, kind: 'penalty' }, { tid: 'f', m: 60, name: 'Thomas Ramos', pts: 3, kind: 'penalty' },
    { tid: 'f', m: 79, name: 'Thomas Ramos', pts: 3, kind: 'field' }];
  assert.equal(scorersLine(shown, 'f', {}, 'rugby-union'), 'Bielle-Biarrey 2 tries · Ramos 2 PG, 1 DG');
  assert.deepEqual([clockLabel(sport, 38), clockLabel(sport, 83), clockTick(sport, 40), clockTick(sport, 85)], ["38'", "83'", "40'", 'ET']);
  assert.deepEqual([overtimeText(sport, 1), overtimeShort(sport, 2)], ['in extra time', 'AET']);
  assert.deepEqual([overtimePeriodsOf(sport, 'Won in extra time'), overtimePeriodsOf(sport, 'nothing')], [1, null]);
  assert.equal(overtimeEnd(sport, 1), 0, 'sudden death ends at its deciding score');
  assert.equal(matchSport({ sport: 'rugby-union', layer: 'clubs' }), sport, 'one season, one set of rules');
});

test('the live win probability starts at the fixture odds, follows the score and settles at the end', () => {
  for (const [a, d] of [['ru-stade-toulousain', 'ru-us-montauban'], ['ru-munster', 'ru-sale-sharks'], ['ru-zebre-parma', 'ru-bath']]) {
    const model = liveModelFor(sport, byId[a], byId[d], undefined, undefined, 6);
    assert.ok(isLiveModel(model));
    assert.deepEqual([model.kind, model.code], ['tries', 'union']);
    const odds = estimateWinProbability({ sport, attacker: byId[a], defender: byId[d], preset: 'balanced', samples: 12000 }).attacker;
    assert.ok(Math.abs(winProbabilityAt(model, 0, 0) - odds) < 0.02, `kick-off ${winProbabilityAt(model, 0, 0)} v odds ${odds}`);
    assert.ok(winProbabilityAt(model, 40, 7) > winProbabilityAt(model, 40, 0) && winProbabilityAt(model, 40, 0) > winProbabilityAt(model, 40, -7));
    assert.ok(winProbabilityAt(model, 79, -15) < 0.01, 'more than two converted tries down with a minute left');
    assert.equal(winProbabilityAt(model, 80, 1), 1);
    assert.equal(winProbabilityAt(model, 83, -3), 0, 'a score in sudden death has won');
    const level = winProbabilityAt(model, 80, 0);
    assert.ok(level > 0.1 && level < 0.9, `level after eighty (${level})`);
    assert.ok(Math.abs(winProbabilityAt(model, 100, 0) - deciderOdds(model.golden)) < 1e-9, 'the last drop goal');
  }
  const model = liveModelFor(sport, byId['ru-leinster'], byId['ru-munster']);
  // Between near equals a lead is worth more as time runs out (a heavy favourite four up at 50' would likely pull away).
  assert.ok(winProbabilityAt(model, 75, 4) > winProbabilityAt(model, 50, 4));
  const series = winSeries({ model, goals: [{ m: 5, tid: 'a', pts: 7 }, { m: 40, tid: 'd', pts: 7 }, { m: 84, tid: 'a', pts: 3 }], aId: 'a', dId: 'd',
    minute: 84, final: { winnerSide: 'A' } });
  assert.equal(series.at(-1).p, 1);
  assert.deepEqual(chartDomain(model, 30).ticks, [0, 20, 40, 60, 80]);
});

// ---------- the setup and the squad ----------

test('setup lists Rugby, union, before rugby league, with nations and 36 clubs from three leagues, on its built-in 2025/26 season', () => {
  const ids = SPORT_LIST.map(item => item.id);
  assert.equal(ids.indexOf('rugby-union') + 1, ids.indexOf('rugby-league'));
  assert.equal(sport.name, 'Rugby');
  assert.equal(getSport('rugby-league').name, 'Rugby league');
  assert.equal(sportNote(sport), 'Nations · 36 clubs from 3 leagues');
  assert.equal(SPORT_NOTES['rugby-union'], sportNote(sport));
  assert.deepEqual(builtInSeasonOf('rugby-union'), { year: 2026, season: '2025/26' });
  const clubs = buildSetupModel({ sport: 'rugby-union', layer: 'clubs', clubScope: 'domestic:rugbyeurope' }, {});
  assert.deepEqual(clubs.scopes.map(scope => [scope.id, scope.label, scope.count]), [['domestic:rugbyeurope', 'European clubs', 36]]);
  assert.deepEqual(clubs.season.options.map(option => option.name), ['2025/26']);
  assert.match(clubs.season.note, /RugbyPass/);
  assert.equal(BASELINE, 45);
});

test('the squad screen draws the field and its eight replacements, and profiles the backs, halves and forwards', () => {
  const team = { ...byId['ru-leinster'], baseEff: teamEff(byId['ru-leinster']) };
  const squad = buildSquad({ teams: { [team.id]: team }, aliveIds: [team.id], history: [] }, { sport }, team.id);
  assert.equal(squad.layout, 'rugby');
  assert.equal(squad.pitch.length, 23);
  assert.deepEqual(squad.groups.map(group => group.label), ['Front row', 'Second row', 'Back row', 'Halves', 'Centres', 'Back three']);
  assert.match(squad.notes.join(' '), /no game publishes rugby union ratings/);
  assert.deepEqual(squad.profile.map(row => row.label), ['Backs', 'Halves', 'Forwards']);
  const { starters, bench } = onField(selectLineup(team));
  assert.deepEqual([starters.length, bench.length], [15, 8]);
});

test('the real figures the model is checked against come from the snapshot\'s three leagues', () => {
  const [latest] = realFigures(SNAPSHOT);
  assert.equal(latest.season, '2025/26');
  assert.equal(latest.games, 431, 'the Premiership\'s 93, the Top 14\'s 187 and the URC\'s 151');
  assert.ok(latest.pointsPerTeam > 26 && latest.pointsPerTeam < 29);
  assert.ok(latest.homeWins > 0.6, 'home sides win two games in three');
  assert.ok(Object.values(latest.tryShares).reduce((s, x) => s + x, 0) > 0.999);
  // The reference: the matchday's share of a position at the default shape, everyone below on a straight line.
  const reference = referenceFor(100, 40);
  assert.ok(reference[0] >= 60 && reference.at(-1) <= 92 && reference.every((r, i) => i === 0 || r >= reference[i - 1]));
});
