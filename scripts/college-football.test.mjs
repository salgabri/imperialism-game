// College football (docs/design/college-football.md): the FBS schools built from the committed College Football 27
// snapshot, American football's drive model under college rules and college overtime, its live win probability, the
// FBS map of the USA (public/domestic/cfb.json) and the running App, which plays the sport with its schools only, on
// that map.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { CLUBS, SOURCE } from '../src/data/clubs.college-football.js';
import { buildClub, isGridironSport, makeRng, outOfPositionPenalty, selectLineup, teamEff, teamSportId } from '../src/data/teams.js';
import { getSport, matchSport, overtimeShort, SPORT_LIST } from '../src/sports/index.js';
import { americanFootball, americanFootballProfile, collegeAnswer, collegeOvertimeOdds, DRIVE_MODEL, driveOdds } from '../src/sports/americanFootball.js';
import { COLLEGE_RULES } from '../src/sports/collegeFootball.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import { chartDomain, isLiveModel, liveModelFor, winProbabilityAt } from '../src/engine/winProbability.js';
import { decodeDomestic, domesticSurroundings } from '../src/engine/domestic.js';
import { territories, validateReachability } from '../src/engine/campaign.js';
import { createDuelDraw } from '../src/engine/duelDraw.js';
import { builtInSeasonOf } from '../src/engine/footballSets.js';
import { exportCampaign, parseCampaign } from '../src/engine/storage.js';
import { buildSetupModel, SPORT_NOTES, sportNote } from '../src/screens/setup/setupModel.js';
import { buildSquad } from '../src/viewModels/squad.js';
import { buildLiveMatch, scorersLine } from '../src/viewModels/match.js';
import { kmToPolys, pointInPolys } from './lib/domestic-partition.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const sport = getSport('college-football');
const SNAPSHOT = JSON.parse(read('scripts/data/college-football-27.json'));
const SCHOOLS = JSON.parse(read('scripts/data/cfb-teams.json')).teams;
const teams = CLUBS.map(club => buildClub(club, sport));
const byId = Object.fromEntries(teams.map(team => [team.id, team]));

// ---------- the schools ----------

test('the 138 FBS schools rebuild byte for byte from the committed College Football 27 snapshot', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.match(execFileSync(process.execPath, ['scripts/build-college-football.mjs', '--check'], { cwd: root, encoding: 'utf8' }), /Verified/);
  assert.equal(SNAPSHOT.players.length, SNAPSHOT.source.players);
  assert.equal(SNAPSHOT.source.iteration.id, 'cfb-ratings-week-10');
  assert.equal(Object.keys(SNAPSHOT.teams).length, 138);
  assert.deepEqual(Object.fromEntries(Object.entries(SNAPSHOT.conferences).map(([name, ids]) => [name, ids.length])), {
    ACC: 17, 'Big 12': 16, 'Big Ten': 18, 'Conference USA': 10, Independent: 2, MAC: 13, 'Mountain West': 10, 'Pac-12': 8, SEC: 16,
    'Sun Belt': 14, 'The American': 14 });
  assert.deepEqual(SOURCE, { edition: 'College Football 27', season: '2026', update: 'Week 10 Ratings', retrieved: SNAPSHOT.source.retrieved,
    url: 'https://www.ea.com/games/ea-sports-college-football/ratings' });
});

test('every school fields its whole lineup at natural positions, in its conference, with EA\'s ratings unchanged', () => {
  assert.equal(CLUBS.length, 138);
  assert.deepEqual(CLUBS.map(club => club.id).sort(), Object.keys(SCHOOLS).sort());
  assert.equal(new Set(CLUBS.map(club => club.code)).size, 138, 'every code its own');
  const conferenceOf = new Map(Object.entries(SNAPSHOT.conferences).flatMap(([name, ids]) => ids.map(ea => [ea, name])));
  const rated = new Map(SNAPSHOT.players.map(([, name, ea, position, overall]) => [`${ea}|${name}|${position === 'P' ? 'K' : 'any'}`, overall]));
  const overall = (ea, name, pos) => rated.get(`${ea}|${name}|any`) ?? rated.get(`${ea}|${name}|${pos}`);
  for (const club of CLUBS) {
    const school = SCHOOLS[club.id];
    assert.match(club.code, /^[A-Z]{3}$/);
    assert.deepEqual([club.code, club.name, club.league], [school.code, school.name, conferenceOf.get(school.ea)]);
    const team = byId[club.id];
    assert.equal(teamSportId(team), 'college-football');
    const lineup = selectLineup(team);
    assert.equal(lineup.slots.length, 23);
    assert.ok(lineup.slots.every(slot => slot.player && !slot.outOfPosition), `${club.name} fields every position`);
    assert.equal(club.str, lineup.rating);
    // The starters and eleven backups, but a backup the roster lacks: Western Michigan has three cornerbacks.
    assert.equal(club.squad.length, club.id === 'cfb-western-michigan' ? 33 : 34, `${club.name}: the starters and its backups`);
    for (const [name, pos, rating] of club.squad) assert.equal(overall(school.ea, name, pos), rating, `${name}'s EA overall`);
  }
  assert.deepEqual(CLUBS.map(club => club.str), CLUBS.map(club => club.str).slice().sort((a, b) => b - a), 'strongest first');
  // EA lists Air Force with no kicker: its punter kicks.
  const kicker = selectLineup(byId['cfb-air-force']).slots.find(slot => slot.position === 'K').player;
  assert.deepEqual([kicker.name, kicker.outOfPosition], ['Will Duncan', false]);
  assert.ok(SNAPSHOT.players.some(([, name, ea, position]) => name === 'Will Duncan' && ea === 1 && position === 'P'));
});

test('positions are the NFL\'s, as specialised: an emergency starter costs 25 points', () => {
  assert.equal(outOfPositionPenalty('college-football'), 25);
  assert.ok(isGridironSport('college-football') && isGridironSport('american-football') && !isGridironSport('rugby-league'));
  const squad = CLUBS[0].squad.map(([name, pos, rating]) => ({ name, pos, rating })).filter(player => player.pos !== 'K');
  const kicker = selectLineup({ sport: 'college-football', squad }).slots.find(slot => slot.position === 'K');
  assert.ok(kicker.outOfPosition && kicker.penalty === 25, 'no kicker: someone kicks, 25 points down');
});

// ---------- the match model ----------

test('college rules: more possessions, the college game\'s kicking and tries, and the NFL\'s model otherwise', () => {
  assert.equal(matchSport({ sport: 'college-football' }), sport, 'one season, one rulebook');
  assert.equal(sport.simulationVersion, 2);
  assert.equal(sport.prepareMatch(teams[0], teams[1]).drives, 12.3);
  assert.equal(americanFootball.prepareMatch(teams[0], teams[1]).drives, 11, 'the NFL keeps its eleven');
  const even = driveOdds(COLLEGE_RULES.edge, COLLEGE_RULES.kicker, COLLEGE_RULES);
  assert.ok(Math.abs(even.td - 0.2599) < 1e-9 && Math.abs(even.xp - 0.983) < 1e-9 && Math.abs(even.two - 0.461) < 1e-9 && Math.abs(even.make - 0.761) < 1e-9);
  // The college scale steepens the edge's effect: the same five points move a college drive further than an NFL one.
  const nflGain = driveOdds(5, 80).td - driveOdds(0, 80).td;
  const collegeGain = driveOdds(COLLEGE_RULES.edge + 5, 76, COLLEGE_RULES).td - even.td;
  assert.ok(collegeGain > 1.6 * nflGain, `${collegeGain} v ${nflGain}`);
  // Match-day form, which the scale would stretch, is half the NFL's in log odds: a point of drama moves a drive's
  // touchdown odds half as far as in the NFL. The NFL's rulebooks name no form of their own.
  assert.ok(Math.abs(COLLEGE_RULES.form * COLLEGE_RULES.scale - 0.5 * DRIVE_MODEL.FORM_PER_DRAMA) < 1e-12);
  const formGain = rules => driveOdds(rules.edge + (rules.form ?? DRIVE_MODEL.FORM_PER_DRAMA), rules.kicker, rules).td;
  const logit = p => Math.log(p / (1 - p));
  const nflRules = americanFootball.prepareMatch(teams[0], teams[1]).rules;
  assert.equal(nflRules.form, undefined);
  assert.ok(Math.abs((logit(formGain(COLLEGE_RULES)) - logit(even.td)) / (logit(formGain(nflRules)) - logit(nflRules.td)) - 0.5) < 1e-9);
  // From the 25 in overtime: a touchdown half the time between equals, and a touchdown down no field goal at all.
  const ot = collegeOvertimeOdds(COLLEGE_RULES.edge, COLLEGE_RULES.kicker, COLLEGE_RULES);
  assert.ok(Math.abs(ot.td - 0.5) < 1e-9 && Math.abs(ot.make - 0.7) < 1e-9);
  assert.equal(collegeAnswer(ot, 7).fgTry, 0);
  assert.equal(collegeAnswer(ot, 3), ot, 'a field goal down, played out');
  assert.ok(collegeAnswer(ot, 0).fgTry > ot.fgTry, 'level, the field goal that wins');
});

test('matches always produce a winner, events add up, and scores look like the FBS\'s', () => {
  const rng = makeRng(20261115);
  let points = 0, games = 0, overtimes = 0;
  const kinds = new Map();
  for (let i = 0; i < 3000; i++) {
    const a = teams[i % 138], d = teams[(i * 37 + 11) % 138];
    if (a === d) continue;
    const result = sport.simulate(rng, a, d, 6, teamEff(a), teamEff(d));
    assert.ok(result.winner === a.id || result.winner === d.id);
    assert.notEqual(result.ga, result.gd, 'never level at the end');
    assert.equal(result.winner === a.id, result.ga > result.gd);
    const sum = id => result.ev.filter(e => e.tid === id).reduce((s, e) => s + e.pts, 0);
    assert.deepEqual([sum(a.id), sum(d.id)], [result.ga, result.gd], 'the feed adds up to the final score');
    for (const e of result.ev) {
      const key = e.kind === 'two' ? '2PT' : e.pts;
      kinds.set(key, (kinds.get(key) || 0) + 1);
      if (e.kind === 'two') assert.ok(e.m > 60 + 2 * COLLEGE_RULES.ot, 'two-point plays from the third overtime');
      else if (e.pts === 2) assert.ok(e.m <= 60, 'no safety in overtime');
    }
    assert.ok(result.ev.every(e => e.m >= 1 && e.m <= 60 + COLLEGE_RULES.maxOvertimes * COLLEGE_RULES.ot), 'within regulation and the overtimes');
    if (result.tie) {
      overtimes++;
      assert.equal(result.regA, result.regD, 'overtime only from a level score');
      assert.ok(result.tie.periods.length >= 1 && result.tie.periods.length <= COLLEGE_RULES.maxOvertimes);
      assert.deepEqual([result.tie.ga, result.tie.gd], [result.ga, result.gd]);
    } else assert.ok(result.ev.every(e => e.m <= 60));
    points += result.regA + result.regD;
    games++;
  }
  const perTeam = points / games / 2;
  // Random pairs of FBS schools, a wider spread than a conference's: about 27 a team, as the FBS's 26.5 in 2024–25.
  assert.ok(perTeam > 24 && perTeam < 31, `about 27 points a team (${perTeam.toFixed(1)})`);
  assert.ok(overtimes / games > 0.01 && overtimes / games < 0.08, `a few games go to overtime (${(overtimes / games * 100).toFixed(1)}%)`);
  for (const kind of [2, 3, 6, 7, 8]) assert.ok(kinds.get(kind) > 0, `${kind}-point scores`);
});

test('college overtime: a possession each from the 25, two-point tries in the second period, two-point plays from the third', () => {
  // Two equal sides, the same school, so overtimes come often: one whose offence outrates its defence as much as the
  // average school's does, so its drives from the 25 go as an average matchup's.
  const average = teams.slice().sort((x, y) => Math.abs(sport.prepareMatch(x, x).edgeA - COLLEGE_RULES.edge)
    - Math.abs(sport.prepareMatch(y, y).edgeA - COLLEGE_RULES.edge))[0];
  const a = average, d = { ...average, id: 'twin' };
  const prepared = sport.prepareMatch(a, d);
  assert.ok(Math.abs(prepared.edgeA - COLLEGE_RULES.edge) < 0.2);
  const rng = makeRng(1115);
  const seen = { periods: new Map(), kicked: 0, twoInSecond: 0, walkOff: 0, rounds: 0 };
  for (let n = 0; n < 40000; n++) {
    const { plays, tie, regA, regD, ga, gd } = sport.sampleResult(rng, prepared, 6);
    if (!tie) continue;
    assert.equal(regA, regD);
    assert.equal(ga - regA, tie.periods.reduce((s, [x]) => s + x, 0));
    assert.equal(gd - regD, tie.periods.reduce((s, [, y]) => s + y, 0));
    seen.periods.set(tie.periods.length, (seen.periods.get(tie.periods.length) || 0) + 1);
    let first = null;
    tie.periods.forEach(([x, y], k) => {
      const period = k + 1;
      const own = plays.filter(play => play.period === period);
      // Each period opens with the other side from the last.
      if (first) assert.notEqual(own[0].side, first, 'the first possession alternates');
      first = own[0].side;
      // Level at every period's start but the last's end.
      if (period < tie.periods.length) assert.equal(x, y, 'a period that decides nothing leads to the next');
      else assert.notEqual(x, y, 'the last period decides it');
      if (period <= 2) {
        assert.equal(own.length, 2, 'a possession each');
        assert.ok(own.every(play => !play.kind && play.pts !== 2), 'possessions, no safeties');
        const [opening, answer] = own;
        if (opening.pts >= 6) assert.equal(opening.conversion, period === 1 ? 'kick' : 'two', 'kicked in the first period, two in the second');
        if (opening.pts >= 6 && answer.side !== opening.side) assert.notEqual(answer.pts, 3, 'no field goal a touchdown down');
        if (period === 1 && opening.pts >= 6) seen.kicked++;
        if (period === 2 && opening.pts >= 6) seen.twoInSecond++;
        if (answer.pts >= 6 && !answer.conversion) seen.walkOff++;
      } else {
        assert.ok(own.every(play => play.kind === 'two' && (play.pts === 0 || play.pts === 2)), 'two-point plays');
        assert.ok(own.length === 2 || (own.length === 3 && period === COLLEGE_RULES.maxOvertimes), 'one each, a decisive one after the last');
        seen.rounds++;
      }
    });
  }
  assert.ok(seen.kicked > 0 && seen.twoInSecond > 0 && seen.walkOff > 0 && seen.rounds > 0);
  const total = [...seen.periods.values()].reduce((s, v) => s + v, 0);
  // Between average sides most overtimes end in the first period (both kicking a touchdown sends one in three on).
  assert.ok(seen.periods.get(1) / total > 0.5 && seen.periods.get(1) / total < 0.8, `${seen.periods.get(1)} of ${total} in one overtime`);
  assert.ok([...seen.periods.keys()].some(periods => periods >= 3), 'some reach the third');
  assert.equal(overtimeShort(sport, 3), '3OT');
});

test('stronger schools are favourites, upsets happen, and Home advantage is about 2.5 points between equals', () => {
  const best = teams[0], middle = teams[69], worst = teams[137];
  const odds = (attacker, defender, preset = 'balanced') => estimateWinProbability({ sport, attacker, defender, preset, samples: 6000 }).attacker;
  assert.ok(odds(best, worst) > 0.95, 'the best school beats the weakest nearly always');
  const [predictable, wild] = [odds(best, middle, 'predictable'), odds(best, middle, 'wild')];
  assert.ok(predictable > wild && wild > 0.6 && predictable < 0.995, `${predictable} > ${wild}`);
  const swap = odds(middle, best);
  assert.ok(Math.abs(swap - (1 - odds(best, middle))) < 0.03, 'the attacker gets no edge of its own');
  const a = teams[60], twin = { ...teams[60], id: 'twin' };
  const prepared = sport.prepareMatch(a, twin, undefined, undefined, { home: true });
  const rng = makeRng(25);
  let margin = 0, homeWins = 0;
  const N = 40000;
  for (let n = 0; n < N; n++) {
    const result = sport.sampleResult(rng, prepared, 6);
    margin += result.gd - result.ga;
    if (result.winner === 'twin') homeWins++;
  }
  assert.ok(margin / N > 1.8 && margin / N < 3.2, `the home side by ${(margin / N).toFixed(2)}`);
  assert.ok(homeWins / N > 0.53 && homeWins / N < 0.6, `home wins ${(homeWins / N * 100).toFixed(1)}%`);
});

test('the feed copy and scorer lines: touchdowns, field goals, safeties and overtime\'s two-point plays', () => {
  for (const pts of [6, 7, 8]) assert.deepEqual(sport.formatEvent({ m: 14, pts, name: 'Jeremiah Smith' }, 'OSU'), { when: 'Q1', text: 'TD — Jeremiah Smith (OSU)' });
  assert.equal(sport.formatToast({ pts: 7, name: 'Jeremiah Smith' }), 'TOUCHDOWN — JEREMIAH SMITH');
  assert.deepEqual(sport.formatEvent({ m: 47, pts: 3, name: 'Jayden Fielding' }, 'OSU'), { when: 'Q4', text: 'FG — Jayden Fielding (OSU)' });
  assert.deepEqual(sport.formatEvent({ m: 22, pts: 2, name: 'Caden Curry' }, 'OSU'), { when: 'Q2', text: 'SAFETY — Caden Curry (OSU)' });
  assert.equal(sport.formatEvent({ m: 62, pts: 7, name: 'Jeremiah Smith' }, 'OSU').when, 'OT');
  assert.equal(sport.formatEvent({ m: 66, pts: 8, name: 'Jeremiah Smith' }, 'OSU').when, '2OT');
  assert.deepEqual(sport.formatEvent({ m: 70, pts: 2, kind: 'two', name: 'Jeremiah Smith' }, 'OSU'), { when: '3OT', text: '2PT — Jeremiah Smith (OSU)' });
  assert.equal(sport.formatToast({ pts: 2, kind: 'two', name: 'Jeremiah Smith' }), 'TWO-POINT CONVERSION — JEREMIAH SMITH');
  const shown = [{ tid: 'o', name: 'Jeremiah Smith', pts: 7 }, { tid: 'o', name: 'Jeremiah Smith', pts: 2, kind: 'two' },
    { tid: 'o', name: 'Jayden Fielding', pts: 3 }, { tid: 'o', name: 'Caden Curry', pts: 2 }];
  assert.equal(scorersLine(shown, 'o', {}, 'college-football'), 'Smith 1 TD, 1 2PT · Fielding 1 FG');
  // An archived final reads its two-point plays back from the feed copy, apart from safeties.
  const A = byId['cfb-ohio-state'], D = byId['cfb-michigan'];
  const entry = { a: { teamId: A.id, code: A.code, score: 19 }, b: { teamId: D.id, code: D.code, score: 17 }, result: { winnerId: A.id }, events: [
    { when: 'Q1', text: `TD — Jeremiah Smith (${A.code})` }, { when: 'Q2', text: `SAFETY — Caden Curry (${A.code})` },
    { when: 'Q4', text: `TD — Bryson Kuzdzal (${D.code})` }, { when: 'OT', text: `TD — Jeremiah Smith (${A.code})` },
    { when: 'OT', text: `TD — Jordan Marshall (${D.code})` }, { when: '3OT', text: `2PT — Jeremiah Smith (${A.code})` },
  ] };
  const model = buildLiveMatch({ teams: { [A.id]: A, [D.id]: D }, history: [entry] }, { sport });
  assert.equal(model.source, 'history');
  assert.equal(model.a.scorers, 'Smith 2 TD, 1 2PT · Curry 1 safety');
});

test('the live win probability starts at the fixture odds and charts college overtime exactly', () => {
  for (const [i, j] of [[0, 137], [10, 20], [60, 61], [100, 30]]) {
    const model = liveModelFor(sport, teams[i], teams[j], undefined, undefined, 6);
    assert.ok(isLiveModel(model), 'a drives model');
    assert.deepEqual([model.kind, model.overtime, model.maxOt, model.ot, model.drives], ['drives', 'college', 8, 4, 12.3]);
    const odds = estimateWinProbability({ sport, attacker: teams[i], defender: teams[j], preset: 'balanced', samples: 8000 }).attacker;
    assert.ok(Math.abs(winProbabilityAt(model, 0, 0) - odds) < 0.03, `kickoff ${winProbabilityAt(model, 0, 0)} v odds ${odds}`);
    assert.equal(winProbabilityAt(model, 60, 0), model.otChain[8], 'level at full time: the overtime chain');
    // In the third overtime a two-point lead leaves the trailing side one play to level.
    const next = model.otChain[8 - 2 - 1];
    assert.ok(Math.abs(winProbabilityAt(model, 70, 2) - (1 - model.twoD * (1 - next))) < 1e-12);
    assert.ok(Math.abs(winProbabilityAt(model, 70, -2) - model.twoA * next) < 1e-12);
    // In the first, a touchdown's 7 leaves the answer a touchdown (going for it) and the kick to play on.
    assert.ok(Math.abs(winProbabilityAt(model, 62, 7) - (1 - model.tdLateD * model.xpD * (1 - model.otChain[7]))) < 1e-12);
    assert.equal(winProbabilityAt(model, 92, 2), 1);
    assert.equal(isLiveModel({ ...model, tdLateA: 1.2 }), false);
    assert.equal(isLiveModel({ ...model, overtime: 'penalties' }), false);
  }
  // The chain is exact for the simulation's overtime, before form (Predictable).
  const [x, y] = [teams[40], teams[47]];
  const prepared = sport.prepareMatch(x, y);
  const exact = liveModelFor(sport, x, y, undefined, undefined, 0).otChain[8];
  const rng = makeRng(78);
  let overtimes = 0, attackerWins = 0;
  for (let i = 0; i < 300000; i++) {
    const result = sport.sampleResult(rng, prepared, 0);
    if (!result.tie) continue;
    overtimes++;
    if (result.ga > result.gd) attackerWins++;
  }
  const simulated = attackerWins / overtimes;
  assert.ok(overtimes > 5000);
  assert.ok(Math.abs(simulated - exact) < 3.5 * Math.sqrt(exact * (1 - exact) / overtimes), `overtime chain ${exact} v ${simulated} over ${overtimes}`);
  assert.deepEqual(chartDomain(liveModelFor(sport, x, y), 69).ticks, [0, 15, 30, 45, 60, 64, 68, 72], 'quarters, then each overtime');
});

// ---------- the FBS map ----------

const TEXT = read('public/domestic/cfb.json');
const DOC = JSON.parse(TEXT);
const MAP = decodeDomestic(JSON.parse(TEXT), 'cfb');
const ENTRY = CLUB_MAPS.find(entry => entry.id === 'cfb');
const ATLAS = JSON.parse(read('public/countries-50m.json'));
const { geo } = MAP;
const sectionIds = geo.countries.map(section => section.id);
const sectionAt = point => geo.countries.find(section => pointInPolys(point, section.polys))?.id ?? null;
const home = id => MAP.clubs.find(club => club.id === id).homeSection;

test('the FBS map gives every school one territory around its stadium, Hawaii\'s included', () => {
  assert.deepEqual({ format: DOC.format, sport: DOC.sport, league: DOC.league, name: DOC.name, hosts: DOC.hosts },
    { format: 1, sport: 'college-football', league: 'FBS', name: 'USA', hosts: ['840'] });
  assert.equal(ENTRY.version, DOC.version);
  assert.deepEqual([ENTRY.clubs, ENTRY.sections, ENTRY.venue, ENTRY.lines, ENTRY.top],
    [138, 138, 'stadium', 'state', CLUBS.slice(0, 3).map(club => club.name)]);
  assert.ok(Buffer.byteLength(TEXT) <= 250000);
  assert.ok(read('public/domestic/ATTRIBUTION-cfb.txt').includes(DOC.version));
  assert.deepEqual(MAP.clubs.map(club => club.id), CLUBS.map(club => club.id), 'strongest first, as the section ids run');
  for (const club of MAP.clubs) {
    const source = CLUBS.find(item => item.id === club.id);
    assert.deepEqual([club.name, club.code, club.str, club.squad, club.league], [source.name, source.code, source.str, source.squad, source.league]);
    assert.deepEqual(club.homePoint, SCHOOLS[club.id].home);
    assert.equal(MAP.sectionNames[club.homeSection], SCHOOLS[club.id].city);
    const land = geo.countries.find(section => section.id === club.homeSection).polys;
    assert.ok(kmToPolys(club.homePoint, land) <= 2, `${club.name} plays inside its own territory`);
  }
  assert.equal(new Set(Object.values(MAP.sectionNames)).size, 138, 'every territory its own name');
  const { shapes } = domesticSurroundings(ATLAS, MAP);
  const ids = new Set(shapes.map(shape => shape.id));
  assert.ok(!ids.has('840') && ids.has('124') && ids.has('484'), 'Canada and Mexico lie beneath as inert land');
});

test('schools sharing a county split it, Hawaii is the Rainbow Warriors\', and states without a school stay empty', () => {
  assert.equal(sectionAt([-84.37, 33.93]), home('cfb-georgia-tech'), 'Sandy Springs, north Fulton County');
  assert.equal(sectionAt([-84.45, 33.65]), home('cfb-georgia-state'), 'College Park, south Fulton County');
  assert.equal(sectionAt([-95.82, 29.79]), home('cfb-rice'), 'Katy, west Harris County');
  assert.equal(sectionAt([-94.98, 29.74]), home('cfb-houston'), 'Baytown, east Harris County');
  assert.equal(sectionAt([-118.14, 34.15]), home('cfb-ucla'), 'Pasadena, by the Rose Bowl');
  assert.equal(sectionAt([-118.19, 33.77]), home('cfb-usc'), 'Long Beach');
  assert.equal(sectionAt([-80.28, 25.86]), home('cfb-miami'), 'Hialeah, north Miami-Dade County');
  assert.equal(sectionAt([-80.48, 25.47]), home('cfb-fiu'), 'Homestead, south Miami-Dade County');
  assert.equal(sectionAt([-83.78, 42.17]), home('cfb-michigan'), 'Saline, Washtenaw County');
  assert.equal(sectionAt([-157.86, 21.31]), home('cfb-hawaii'), 'Honolulu');
  assert.equal(sectionAt([-155.09, 19.72]), home('cfb-hawaii'), 'Hilo, on the Big Island');
  assert.equal(MAP.sectionNames[home('cfb-hawaii')], 'Honolulu');
  assert.equal(sectionAt([-96.79, 46.88]), home('cfb-north-dakota-state'), 'Fargo');
  for (const [where, point] of [['Billings', [-108.5, 45.78]], ['Sioux Falls', [-96.73, 43.54]], ['Anchorage', [-149.9, 61.22]],
    ['Washington, D.C.', [-77.02, 38.91]], ['Providence', [-71.41, 41.82]]]) assert.equal(sectionAt(point), null, `${where} is nobody's`);
  assert.deepEqual(DOC.topology.objects.empty.geometries.map(g => g.properties.name).sort(), ['District of Columbia', 'Maine', 'Montana',
    'New Hampshire', 'Rhode Island', 'South Dakota', 'Vermont'], 'every state without a school');
});

test('seeded duel campaigns on the FBS map reach a champion', () => {
  const { obstacles } = domesticSurroundings(ATLAS, MAP);
  const rng = makeRng(20261115);
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

test('setup lists college football after American football, its schools only, on the built-in 2026 season', () => {
  const ids = SPORT_LIST.map(item => item.id);
  assert.equal(ids.indexOf('college-football'), ids.indexOf('american-football') + 1);
  assert.equal(sportNote(sport), '138 FBS schools');
  assert.equal(SPORT_NOTES['college-football'], sportNote(sport));
  assert.deepEqual(builtInSeasonOf('college-football'), { year: 2026, season: '2026' });
  const model = buildSetupModel({ sport: 'college-football', layer: 'clubs', clubScope: 'domestic:cfb' }, {});
  assert.equal(model.clubsOnly, 'FBS');
  assert.equal(model.clubsNoun, 'schools');
  assert.deepEqual(model.scopes.map(scope => [scope.id, scope.label, scope.count]), [['domestic:cfb', 'FBS', 138]]);
  assert.equal(model.scopeName, 'FBS · USA');
  assert.deepEqual(model.season.options.map(option => option.name), ['2026']);
  assert.match(model.season.note, /College Football 27/);
  assert.equal(buildSetupModel({ sport: 'american-football', layer: 'clubs', clubScope: 'domestic:nfl' }, {}).clubsNoun, 'clubs', 'the NFL\'s are clubs');
});

test('the squad screen draws American football\'s field, units and profile', () => {
  const team = { ...byId['cfb-ohio-state'], baseEff: teamEff(byId['cfb-ohio-state']) };
  const squad = buildSquad({ teams: { [team.id]: team }, aliveIds: [team.id], history: [] }, { sport }, team.id);
  assert.equal(squad.layout, 'field');
  assert.equal(squad.viewLabel, 'Field');
  assert.equal(squad.xi.label, 'Starting lineup');
  assert.deepEqual(squad.groups.map(group => group.label), ['Quarterback', 'Running back', 'Receivers', 'Offensive line', 'Defensive line',
    'Linebackers', 'Secondary', 'Kicker']);
  assert.equal(squad.pitch.length, 23);
  assert.deepEqual(squad.profile.map(row => row.label), ['Offence', 'Defence', 'Kicking']);
  const profile = americanFootballProfile(selectLineup(team));
  assert.ok(profile.offence > 70 && profile.defence > 70 && profile.kicking > 60);
});

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearDomesticCache: ['src/engine/domestic.js', 'clearDomesticCache'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

test('college football sets up with its schools only, launches on the FBS map, saves and resumes', async () => {
  const calls = [];
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: async url => {
    calls.push(String(url));
    return url === '/domestic/cfb.json' ? { ok: true, status: 200, json: async () => JSON.parse(TEXT) }
      : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  } });
  B.clearDomesticCache();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['840', '124', '484'],
    settings: { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', role: 'spectator', seed: '15' } });
  f.app.opening = B.App.prototype.opening;
  try {
    const { app, time } = f;
    app.pickSetup('sport', 'college-football');
    assert.equal(app.state.setup.layer, 'clubs', 'no nations to choose');
    assert.equal(app.state.setup.clubScope, 'domestic:cfb', 'the FBS map, its one theatre');
    app.pickSetup('layer', 'nations');
    assert.equal(app.state.setup.layer, 'clubs', 'Nations stays off');
    time.advance(200);
    await app.loadCountry('cfb');
    await settle();
    assert.deepEqual(calls, ['/domestic/cfb.json']);
    assert.equal(buildSetupModel(app.state.setup, { domestic: app.domesticStatus() }).canLaunch, true);

    app.startCampaign();
    const { state } = app;
    assert.equal(state.phase, 'playing');
    assert.equal(state.aliveIds.length, 138);
    assert.equal(state.campaignName, 'College football · FBS · USA');
    assert.ok(Object.values(state.teams).every(team => team.sport === 'college-football' && state.own[team.home] === team.id));
    assert.equal(app.territoryName(state.teams['cfb-alabama'].home), 'Tuscaloosa');
    assert.equal(app.territoryName(state.teams['cfb-hawaii'].home), 'Honolulu');
    const text = exportCampaign(state);
    const saved = parseCampaign(text);
    assert.equal(saved.settings.sport, 'college-football');
    assert.equal(saved.settings.clubScope, 'domestic:cfb');
    assert.equal(Object.keys(saved.teams).length, 138);
    assert.deepEqual(saved.aliveIds, state.aliveIds);
    assert.deepEqual(saved.own, state.own);
    assert.equal(saved.teams['cfb-air-force'].squad.find(player => player.pos === 'K').name, 'Will Duncan');

    app.openSetup();
    app.pickSetup('sport', 'football');
    assert.equal(app.state.setup.clubScope, 'domestic:eu124', 'the FBS map is no football theatre');
  } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
});
