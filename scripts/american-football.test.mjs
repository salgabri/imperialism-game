// American football (docs/design/american-football.md): the NFL clubs built from the committed Madden NFL snapshot,
// the drive-by-drive match model and its live win probability, the NFL's own map of the USA (public/domestic/nfl.json)
// and the running App, which plays the sport with clubs only, on that map.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { CLUBS, SOURCE } from '../src/data/clubs.american-football.js';
import { buildClub, makeRng, outOfPositionPenalty, selectLineup, teamEff, teamSportId } from '../src/data/teams.js';
import { getSport, overtimeEnd, SPORT_LIST } from '../src/sports/index.js';
import { americanFootballProfile, driveMoments, driveOdds } from '../src/sports/americanFootball.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import { chartDomain, isLiveModel, liveModelFor, winProbabilityAt, winSeries } from '../src/engine/winProbability.js';
import { decodeDomestic, domesticSurroundings } from '../src/engine/domestic.js';
import { territories, validateReachability } from '../src/engine/campaign.js';
import { createDuelDraw } from '../src/engine/duelDraw.js';
import { exportCampaign, parseCampaign } from '../src/engine/storage.js';
import { buildSetupModel, sportNote } from '../src/screens/setup/setupModel.js';
import { buildSquad } from '../src/viewModels/squad.js';
import { buildLiveMatch, scorersLine } from '../src/viewModels/match.js';
import { kmToPolys, pointInPolys } from './lib/domestic-partition.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const sport = getSport('american-football');
const SNAPSHOT = JSON.parse(read('scripts/data/madden-nfl-27.json'));
const FRANCHISES = JSON.parse(read('scripts/data/nfl-teams.json')).teams;
const teams = CLUBS.map(club => buildClub(club, sport));
const byId = Object.fromEntries(teams.map(team => [team.id, team]));

// ---------- the clubs ----------

test('the 32 NFL franchises rebuild byte for byte from the committed Madden snapshot', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.match(execFileSync(process.execPath, ['scripts/build-nfl.mjs', '--check'], { cwd: root, encoding: 'utf8' }), /Verified/);
  assert.equal(SNAPSHOT.players.length, SNAPSHOT.source.players);
  assert.equal(Object.keys(SNAPSHOT.teams).length, 32);
  assert.deepEqual(SOURCE, { edition: 'Madden NFL 27', season: '2026', update: SNAPSHOT.source.iteration.label,
    retrieved: SNAPSHOT.source.retrieved, url: SNAPSHOT.source.url });
});

test('every franchise fields its whole lineup at natural positions, with Madden ratings unchanged', () => {
  assert.equal(CLUBS.length, 32);
  assert.deepEqual(CLUBS.map(club => club.id).sort(), Object.keys(FRANCHISES).sort());
  assert.equal(new Set(CLUBS.map(club => club.code)).size, 32);
  const rated = new Map(SNAPSHOT.players.map(([, name, ea, , overall]) => [`${ea}|${name}`, overall]));
  for (const club of CLUBS) {
    assert.match(club.code, /^[A-Z]{3}$/);
    assert.equal(club.code, FRANCHISES[club.id].code);
    assert.equal(club.league, 'NFL');
    const team = byId[club.id];
    assert.equal(teamSportId(team), 'american-football');
    const lineup = selectLineup(team);
    assert.equal(lineup.slots.length, 23);
    assert.ok(lineup.slots.every(slot => slot.player && !slot.outOfPosition), `${club.name} fields every position`);
    assert.equal(club.str, lineup.rating);
    assert.equal(club.squad.length, 34, 'the starters and eleven backups');
    for (const [name, , rating] of club.squad) assert.equal(rated.get(`${FRANCHISES[club.id].ea}|${name}`), rating, `${name}'s Madden overall`);
  }
  // Strongest first.
  assert.deepEqual(CLUBS.map(club => club.str), CLUBS.map(club => club.str).slice().sort((a, b) => b - a));
});

test('positions are specialised: an emergency starter costs 25 points, and a legacy squad still reads as American football', () => {
  assert.equal(outOfPositionPenalty('american-football'), 25);
  assert.equal(outOfPositionPenalty('football'), 12);
  assert.equal(outOfPositionPenalty('basketball'), 12);
  const squad = CLUBS[0].squad.map(([name, pos, rating]) => ({ name, pos, rating })).filter(player => player.pos !== 'K');
  const lineup = selectLineup({ squad });
  const kicker = lineup.slots.find(slot => slot.position === 'K');
  assert.ok(kicker.outOfPosition && kicker.penalty === 25, 'no kicker: someone kicks, 25 points down');
  assert.equal(teamSportId({ squad: [{ name: 'A', pos: 'C', rating: 80 }] }), 'basketball', "basketball's centre stays basketball");
  assert.equal(teamSportId({ squad: [{ name: 'A', pos: 'OL', rating: 80 }] }), 'american-football');
});

// ---------- the match model ----------

test('matches always produce a winner, events add up, and scores look like the NFL\'s', () => {
  const rng = makeRng(20261031);
  let points = 0, games = 0, overtimes = 0;
  const margins = [], finals = [];
  const kinds = new Map();
  for (let i = 0; i < 3000; i++) {
    const a = teams[i % 32], d = teams[(i * 7 + 3) % 32];
    if (a === d) continue;
    const result = sport.simulate(rng, a, d, 6, teamEff(a), teamEff(d));
    assert.ok(result.winner === a.id || result.winner === d.id);
    assert.notEqual(result.ga, result.gd, 'never level at the end');
    assert.equal(result.winner === a.id, result.ga > result.gd);
    const sum = id => result.ev.filter(e => e.tid === id).reduce((s, e) => s + e.pts, 0);
    assert.deepEqual([sum(a.id), sum(d.id)], [result.ga, result.gd], 'the feed adds up to the final score');
    for (const e of result.ev) {
      kinds.set(e.pts, (kinds.get(e.pts) || 0) + 1);
      // A safety is the defence's: one of its pass rushers or defensive backs.
      if (e.pts === 2) {
        const position = selectLineup(e.tid === a.id ? a : d).slots.find(slot => slot.player?.name === e.name)?.position;
        assert.ok(['DL', 'LB', 'CB', 'S'].includes(position), `${e.name} (${position}) is credited with a safety`);
      }
    }
    assert.ok(result.ev.every(e => e.m >= 1 && e.m <= 90), 'within regulation and three overtimes');
    if (result.tie) {
      overtimes++;
      assert.equal(result.regA, result.regD, 'overtime only from a level score');
      assert.ok(result.tie.periods.length >= 1 && result.tie.periods.length <= 3);
      assert.deepEqual([result.tie.ga, result.tie.gd], [result.ga, result.gd]);
      assert.ok(result.ev.some(e => e.m > 60), 'overtime scores in overtime');
    } else assert.ok(result.ev.every(e => e.m <= 60));
    points += result.regA + result.regD;
    games++;
    margins.push(Math.abs(result.regA - result.regD));
    finals.push(Math.abs(result.ga - result.gd));
  }
  const perTeam = points / games / 2;
  assert.ok(perTeam > 19 && perTeam < 26, `about 22 points a team (${perTeam.toFixed(1)})`);
  assert.ok(overtimes / games > 0.02 && overtimes / games < 0.09, `a few games go to overtime (${(overtimes / games * 100).toFixed(1)}%)`);
  margins.sort((x, y) => x - y);
  assert.ok(margins[margins.length >> 1] >= 7 && margins[margins.length >> 1] <= 14, 'a typical margin of one or two scores');
  // Touchdowns with the extra point (7), a missed try (6) or two points (8); field goals; now and then a safety.
  assert.deepEqual([...kinds.keys()].sort((x, y) => x - y), [2, 3, 6, 7, 8], 'touchdowns and their tries, field goals and safeties');
  const touchdowns = kinds.get(6) + kinds.get(7) + kinds.get(8);
  assert.ok(kinds.get(7) / touchdowns > 0.8 && kinds.get(7) / touchdowns < 0.9, 'most touchdowns are kicked and made');
  assert.ok(kinds.get(2) / games > 0.02 && kinds.get(2) / games < 0.08, `a safety in about one game in twenty (${kinds.get(2)} in ${games})`);
  // A field goal decides more NFL games than any other margin, about twice as many as by exactly 7.
  const by = margin => finals.filter(m => m === margin).length;
  assert.ok(by(3) > 1.5 * by(7), `more games decided by 3 than by 7 (${by(3)} v ${by(7)})`);
});

test('the scores follow the NFL: tries by the chart, safeties, and overtime walk-offs without a try', () => {
  const prepared = sport.prepareMatch(teams[5], teams[6], teamEff(teams[5]), teamEff(teams[6]));
  const rng = makeRng(31);
  const tries = { kick: 0, made: 0, two: 0, converted: 0, none: 0, regulationNone: 0 };
  let touchdowns = 0, safeties = 0, games = 0;
  for (; games < 20000; games++) {
    const { plays, ga, gd, regA, regD } = sport.sampleResult(rng, prepared, 6);
    assert.equal(plays.reduce((s, p) => s + (p.side === 'A' ? p.pts : 0), 0), ga);
    assert.equal(plays.reduce((s, p) => s + (p.side === 'D' ? p.pts : 0), 0), gd);
    assert.equal(plays.filter(p => !p.period).reduce((s, p) => s + (p.side === 'A' ? p.pts : -p.pts), 0), regA - regD);
    for (let period = 1; plays.some(p => p.period === period); period++) {
      const [first, second] = plays.filter(p => p.period === period);
      // A touchdown down after the first possession, the answer must be a touchdown: never a field goal that loses anyway.
      if (first.pts >= 6 && second && second.side !== first.side) assert.notEqual(second.pts, 3, 'no field goal a touchdown down');
    }
    for (const play of plays) {
      if (play.pts === 2) safeties++;
      if (play.pts < 6) continue;
      touchdowns++;
      if (play.conversion === 'kick') { tries.kick++; if (play.pts === 7) tries.made++; }
      else if (play.conversion === 'two') { tries.two++; if (play.pts === 8) tries.converted++; }
      else {
        // No try only when the touchdown has won an overtime.
        tries.none++;
        assert.equal(play.pts, 6);
        if (!play.period) tries.regulationNone++;
      }
    }
  }
  assert.equal(tries.regulationNone, 0, 'every touchdown in regulation has its try');
  assert.ok(tries.none > 0, 'overtime walk-offs');
  const share = (n, of) => `${(n / of * 100).toFixed(1)}%`;
  assert.ok(tries.made / tries.kick > 0.92 && tries.made / tries.kick < 0.97, `extra points made (${share(tries.made, tries.kick)})`);
  assert.ok(tries.two / touchdowns > 0.08 && tries.two / touchdowns < 0.12, `about one touchdown in ten goes for two (${share(tries.two, touchdowns)})`);
  assert.ok(tries.converted / tries.two > 0.42 && tries.converted / tries.two < 0.55, `two-point tries made (${share(tries.converted, tries.two)})`);
  assert.ok(safeties / games > 0.03 && safeties / games < 0.07, `about 0.05 safeties a game (${(safeties / games).toFixed(3)})`);
});

test('stronger teams are favourites, and Upsets widens the underdog\'s chance without removing drive luck', () => {
  const best = teams[0], worst = teams[31];
  const odds = preset => estimateWinProbability({ sport, attacker: best, defender: worst, preset, samples: 6000 }).attacker;
  const [predictable, balanced, wild] = ['predictable', 'balanced', 'wild'].map(odds);
  assert.ok(predictable > balanced && balanced > wild, `${predictable} > ${balanced} > ${wild}`);
  assert.ok(wild > 0.7 && predictable < 0.97, 'a favourite, never a certainty');
  const swap = estimateWinProbability({ sport, attacker: worst, defender: best, preset: 'balanced', samples: 6000 }).attacker;
  assert.ok(Math.abs(swap - (1 - balanced)) < 0.03, 'the attacker gets no home advantage');
});

test('the drive odds and the feed copy: a touchdown is 6 to 8 with its try, a field goal 3, a safety 2, by quarter', () => {
  const even = driveMoments(driveOdds(0, 80));
  assert.ok(even.mean > 1.8 && even.mean < 2.2, 'about two points a drive between equals');
  assert.ok(driveOdds(5, 80).td > driveOdds(0, 80).td && driveOdds(0, 90).make > driveOdds(0, 80).make);
  assert.ok(driveOdds(0, 90).xp > driveOdds(0, 80).xp && driveOdds(5, 80).two > driveOdds(0, 80).two, 'a better kicker, a better offence');
  assert.ok(Math.abs(driveOdds(0, 80).xp - 0.95) < 1e-9 && Math.abs(driveOdds(0, 80).two - 0.48) < 1e-9);
  for (const pts of [6, 7, 8]) {
    assert.deepEqual(sport.formatEvent({ m: 14, pts, name: 'Travis Kelce' }, 'KCC'), { when: 'Q1', text: 'TD — Travis Kelce (KCC)' });
    assert.equal(sport.formatToast({ pts, name: 'Travis Kelce' }), 'TOUCHDOWN — TRAVIS KELCE');
  }
  assert.deepEqual(sport.formatEvent({ m: 47, pts: 3, name: 'Harrison Butker' }, 'KCC'), { when: 'Q4', text: 'FG — Harrison Butker (KCC)' });
  assert.equal(sport.formatEvent({ m: 64, pts: 3, name: 'Harrison Butker' }, 'KCC').when, 'OT');
  assert.equal(sport.formatToast({ pts: 3, name: 'Harrison Butker' }), 'FIELD GOAL — HARRISON BUTKER');
  assert.deepEqual(sport.formatEvent({ m: 22, pts: 2, name: 'Chris Jones' }, 'KCC'), { when: 'Q2', text: 'SAFETY — Chris Jones (KCC)' });
  assert.equal(sport.formatToast({ pts: 2, name: 'Chris Jones' }), 'SAFETY — CHRIS JONES');
  // Ranked by the scores themselves, a touchdown counting 6 whatever its try.
  const shown = [{ tid: 'k', name: 'Travis Kelce', pts: 8 }, { tid: 'k', name: 'Travis Kelce', pts: 6 }, { tid: 'k', name: 'Harrison Butker', pts: 3 },
    { tid: 'k', name: 'Harrison Butker', pts: 3 }, { tid: 'k', name: 'Harrison Butker', pts: 3 }, { tid: 'k', name: 'Rashee Rice', pts: 7 },
    { tid: 'k', name: 'Chris Jones', pts: 2 }];
  assert.equal(scorersLine(shown, 'k', {}, 'american-football'), 'Kelce 2 TD · Butker 3 FG');
  assert.equal(scorersLine([{ tid: 'k', name: 'Chris Jones', pts: 2 }, { tid: 'k', name: 'Rashee Rice', pts: 8 }], 'k', {}, 'american-football'),
    'Rice 1 TD · Jones 1 safety');
});

test('an archived NFL final reads its scorer lines back from the feed copy, safeties included', () => {
  const { A, D } = { A: byId['nfl-kansas-city-chiefs'], D: byId['nfl-buffalo-bills'] };
  const entry = {
    a: { teamId: A.id, code: A.code, score: 15 }, b: { teamId: D.id, code: D.code, score: 13 },
    result: { winnerId: A.id }, events: [
      { when: 'Q1', text: `TD — Travis Kelce (${A.code})` }, { when: 'Q2', text: `SAFETY — Chris Jones (${A.code})` },
      { when: 'Q3', text: `TD — Josh Allen (${D.code})` }, { when: 'Q4', text: `FG — Harrison Butker (${A.code})` },
      { when: 'Q4', text: `TD — James Cook (${D.code})` }, { when: 'Q4', text: `TD — Rashee Rice (${A.code})` },
    ],
  };
  const model = buildLiveMatch({ teams: { [A.id]: A, [D.id]: D }, history: [entry] }, { sport });
  assert.equal(model.source, 'history');
  assert.equal(model.a.scorers, 'Kelce 1 TD · Rice 1 TD');
  assert.equal(model.b.scorers, 'Allen 1 TD · Cook 1 TD');
  const safetyFirst = { ...entry, events: [entry.events[1], entry.events[3]] };
  assert.equal(buildLiveMatch({ teams: { [A.id]: A, [D.id]: D }, history: [safetyFirst] }, { sport }).a.scorers, 'Butker 1 FG · Jones 1 safety');
});

test('the live win probability starts at the fixture odds, follows the score and settles at the end', () => {
  for (const [i, j] of [[0, 31], [5, 6], [12, 30], [31, 1]]) {
    const model = liveModelFor(sport, teams[i], teams[j], undefined, undefined, 6);
    assert.ok(isLiveModel(model), 'a drives model');
    assert.equal(model.kind, 'drives');
    const odds = estimateWinProbability({ sport, attacker: teams[i], defender: teams[j], preset: 'balanced', samples: 8000 }).attacker;
    assert.ok(Math.abs(winProbabilityAt(model, 0, 0) - odds) < 0.03, `kickoff ${winProbabilityAt(model, 0, 0)} v odds ${odds}`);
    assert.ok(winProbabilityAt(model, 50, 14) > winProbabilityAt(model, 50, 0) && winProbabilityAt(model, 50, 0) > winProbabilityAt(model, 50, -14));
    assert.ok(winProbabilityAt(model, 59, 10) > 0.97, 'two scores up with a minute left');
    assert.equal(winProbabilityAt(model, 90, 3), 1);
    assert.equal(winProbabilityAt(model, 60, 0), model.otChain[3], 'level at full time: the overtime chain');
    // In overtime a touchdown's lead leaves the trailing side one answer; a missed extra point leaves it a better one.
    assert.ok(winProbabilityAt(model, 63, 7) > model.otChain[3] && winProbabilityAt(model, 63, -7) < model.otChain[3]);
    assert.ok(winProbabilityAt(model, 63, 6) < winProbabilityAt(model, 63, 7) && winProbabilityAt(model, 63, 9) === 1);
    // A model saved before tries had none: its extra points were always good.
    const { xpA, twoA, xpD, twoD, ...saved } = model;
    assert.ok([xpA, twoA, xpD, twoD].every(p => p > 0 && p < 1) && isLiveModel(saved));
    assert.equal(winProbabilityAt(saved, 63, 7), 1 - saved.tdD * (1 - saved.otChain[3]));
    assert.equal(isLiveModel({ ...model, xpA: 1.5 }), false);
  }
  // The overtime chain is exact for the simulation's overtime rules, before form (Predictable).
  const prepared = sport.prepareMatch(teams[5], teams[6], teamEff(teams[5]), teamEff(teams[6]));
  const exact = liveModelFor(sport, teams[5], teams[6], teamEff(teams[5]), teamEff(teams[6]), 0).otChain[3];
  const rng = makeRng(77);
  let overtimes = 0, attackerWins = 0;
  for (let i = 0; i < 300000; i++) {
    const result = sport.sampleResult(rng, prepared, 0);
    if (!result.tie) continue;
    overtimes++;
    if (result.ga > result.gd) attackerWins++;
  }
  const simulated = attackerWins / overtimes;
  assert.ok(Math.abs(simulated - exact) < 3.5 * Math.sqrt(exact * (1 - exact) / overtimes), `overtime chain ${exact} v ${simulated} over ${overtimes}`);
  const model = liveModelFor(sport, teams[0], teams[1]);
  const series = winSeries({ model, goals: [{ m: 20, tid: 'a', pts: 7 }, { m: 70, tid: 'a', pts: 3 }], aId: 'a', dId: 'd', minute: 70,
    final: { winnerSide: 'A' } });
  assert.equal(series.at(-1).t, 70, 'the series runs to the end of the overtime played');
  assert.equal(series.at(-1).p, 1);
  // Overtime ends with the score that decides it: the series stops there, at 1, as the live clock does.
  const early = winSeries({ model, goals: [{ m: 20, tid: 'a', pts: 7 }, { m: 41, tid: 'd', pts: 7 }, { m: 63.4, tid: 'a', pts: 3 }], aId: 'a', dId: 'd',
    minute: 64, final: { winnerSide: 'A' } });
  assert.deepEqual([early.at(-1).t, early.at(-1).p], [64, 1]);
  assert.equal(overtimeEnd(sport, 1), 0, 'no period end to run on to after the deciding score');
  assert.deepEqual([overtimeEnd('basketball', 2), overtimeEnd('baseball', 1), overtimeEnd('football', 1)], [50, 60, 0]);
  assert.deepEqual(chartDomain(model, 70).ticks, [0, 15, 30, 45, 60, 70], 'quarters, then each overtime');
  assert.equal(liveModelFor(sport, teams[0], teams[1]).length, 60);
});

// ---------- the NFL map ----------

const TEXT = read('public/domestic/nfl.json');
const DOC = JSON.parse(TEXT);
const MAP = decodeDomestic(JSON.parse(TEXT), 'nfl');
const ENTRY = CLUB_MAPS.find(entry => entry.id === 'nfl');
const ATLAS = JSON.parse(read('public/countries-50m.json'));
const { geo } = MAP;
const sectionIds = geo.countries.map(section => section.id);
const sectionAt = point => geo.countries.find(section => pointInPolys(point, section.polys))?.id ?? null;
const home = id => MAP.clubs.find(club => club.id === id).homeSection;

test('the NFL map gives every franchise one territory around its stadium, across the USA only', () => {
  assert.deepEqual({ format: DOC.format, sport: DOC.sport, league: DOC.league, name: DOC.name, hosts: DOC.hosts },
    { format: 1, sport: 'american-football', league: 'NFL', name: 'USA', hosts: ['840'] });
  assert.equal(ENTRY.version, DOC.version);
  assert.deepEqual([ENTRY.clubs, ENTRY.sections, ENTRY.venue, ENTRY.lines, ENTRY.top],
    [32, 32, 'stadium', 'state', CLUBS.slice(0, 3).map(club => club.name)]);
  assert.ok(Buffer.byteLength(TEXT) <= 250000);
  assert.ok(read('public/domestic/ATTRIBUTION-nfl.txt').includes(DOC.version));
  assert.deepEqual(MAP.clubs.map(club => club.id), CLUBS.map(club => club.id), 'strongest first, as the section ids run');
  for (const club of MAP.clubs) {
    const source = CLUBS.find(item => item.id === club.id);
    assert.deepEqual([club.name, club.code, club.str, club.squad], [source.name, source.code, source.str, source.squad]);
    assert.deepEqual(club.homePoint, FRANCHISES[club.id].home);
    assert.equal(MAP.sectionNames[club.homeSection], FRANCHISES[club.id].city);
    const land = geo.countries.find(section => section.id === club.homeSection).polys;
    assert.ok(kmToPolys(club.homePoint, land) <= 2, `${club.name} plays inside its own territory`);
  }
  const { shapes } = domesticSurroundings(ATLAS, MAP);
  const ids = new Set(shapes.map(shape => shape.id));
  assert.ok(!ids.has('840') && ids.has('124') && ids.has('484'), 'Canada and Mexico lie beneath as inert land');
});

test('New York City is a New York team\'s, upstate the Bills\', and the shared stadiums split their states', () => {
  assert.equal(sectionAt([-73.95, 40.75]), home('nfl-new-york-giants'), 'Manhattan');
  assert.equal(sectionAt([-78.88, 42.89]), home('nfl-buffalo-bills'), 'Buffalo');
  assert.equal(sectionAt([-74.48, 40.86]), home('nfl-new-york-jets'), 'Morris County, New Jersey');
  assert.equal(sectionAt([-118.6, 34.2]), home('nfl-los-angeles-rams'), 'the San Fernando Valley');
  assert.equal(sectionAt([-117.16, 32.72]), home('nfl-los-angeles-chargers'), 'San Diego, the Chargers\' old home');
  assert.equal(sectionAt([-77.02, 38.91]), home('nfl-washington-commanders'), 'Washington, D.C., beside the Commanders\' stadium in Maryland');
  assert.equal(sectionAt([-76.61, 39.4]), home('nfl-baltimore-ravens'), 'Towson, Maryland');
  assert.equal(sectionAt([-104.82, 38.83]), home('nfl-denver-broncos'), 'Colorado Springs');
  assert.equal(sectionAt([-104.82, 41.14]), null, 'Cheyenne: Wyoming has no club');
  assert.equal(sectionAt([-72.68, 41.76]), null, 'Hartford: Connecticut has no club');
  assert.equal(sectionAt([-149.9, 61.22]), null, 'Alaska is nobody\'s');
  assert.deepEqual(DOC.topology.objects.empty.geometries.map(g => g.properties.name).sort(), ['Alabama', 'Arkansas', 'Connecticut', 'Delaware', 'Idaho',
    'Iowa', 'Kansas', 'Kentucky', 'Maine', 'Mississippi', 'Montana', 'Nebraska', 'New Hampshire', 'New Mexico', 'North Dakota', 'Oklahoma', 'Oregon',
    'Rhode Island', 'South Carolina', 'South Dakota', 'Utah', 'Vermont', 'Virginia', 'West Virginia', 'Wyoming'], 'every state without a franchise');
});

test('seeded duel campaigns on the NFL map reach a champion', () => {
  const { obstacles } = domesticSurroundings(ATLAS, MAP);
  const rng = makeRng(20261031);
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

test('setup lists American football as a third sport with clubs only, on its built-in 2026 season', () => {
  assert.deepEqual(SPORT_LIST.map(item => item.id).filter(id => id !== 'womens-football').slice(0, 3), ['football', 'basketball', 'american-football']);
  assert.equal(sportNote(sport), '32 NFL clubs');
  const model = buildSetupModel({ sport: 'american-football', layer: 'clubs', clubScope: 'domestic:nfl' }, {});
  assert.equal(model.clubsOnly, 'NFL');
  assert.deepEqual(model.scopes.map(scope => [scope.id, scope.label, scope.count]), [['domestic:nfl', 'NFL', 32]]);
  assert.equal(model.scopeName, 'NFL · USA');
  assert.match(model.countryNote, /lead the 32 NFL clubs fighting over the USA, each starting with only its stadium's state\. A state with several clubs is divided between them; one with none stays empty\./);
  assert.deepEqual(model.season.options.map(option => option.name), ['2026']);
  assert.equal(buildSetupModel({ sport: 'football' }, {}).clubsOnly, null);
});

test('the squad screen draws a field, groups the units and profiles offence, defence and kicking', () => {
  const team = { ...byId['nfl-kansas-city-chiefs'], baseEff: teamEff(byId['nfl-kansas-city-chiefs']) };
  const squad = buildSquad({ teams: { [team.id]: team }, aliveIds: [team.id], history: [] }, { sport }, team.id);
  assert.equal(squad.layout, 'field');
  assert.equal(squad.viewLabel, 'Field');
  assert.equal(squad.xi.label, 'Starting lineup');
  assert.deepEqual(squad.groups.map(group => group.label), ['Quarterback', 'Running back', 'Receivers', 'Offensive line', 'Defensive line',
    'Linebackers', 'Secondary', 'Kicker']);
  assert.equal(squad.pitch.length, 23);
  assert.ok(squad.pitch.every(slot => /%$/.test(slot.x) && /%$/.test(slot.y)));
  assert.deepEqual(squad.profile.map(row => row.label), ['Offence', 'Defence', 'Kicking']);
  const profile = americanFootballProfile(selectLineup(team));
  assert.ok(profile.offence > 60 && profile.defence > 60 && profile.kicking > 60);
});

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearDomesticCache: ['src/engine/domestic.js', 'clearDomesticCache'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

test('American football sets up with clubs only, launches on the NFL map and saves', async () => {
  const calls = [];
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: async url => {
    calls.push(String(url));
    return url === '/domestic/nfl.json' ? { ok: true, status: 200, json: async () => JSON.parse(TEXT) }
      : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  } });
  B.clearDomesticCache();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['840', '124', '484'],
    settings: { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try {
    const { app, time } = f;
    app.pickSetup('sport', 'american-football');
    assert.equal(app.state.setup.layer, 'clubs', 'no nations to choose');
    assert.equal(app.state.setup.clubScope, 'domestic:nfl', "the NFL's one theatre");
    app.pickSetup('layer', 'nations');
    assert.equal(app.state.setup.layer, 'clubs', 'Nations stays off');
    time.advance(200);
    await app.loadCountry('nfl');
    await settle();
    assert.deepEqual(calls, ['/domestic/nfl.json']);
    assert.equal(buildSetupModel(app.state.setup, { domestic: app.domesticStatus() }).canLaunch, true);

    app.startCampaign();
    const { state } = app;
    assert.equal(state.phase, 'playing');
    assert.equal(state.aliveIds.length, 32);
    assert.equal(state.campaignName, 'American football · NFL · USA');
    assert.ok(Object.values(state.teams).every(team => team.sport === 'american-football' && state.own[team.home] === team.id));
    assert.equal(app.territoryName(state.teams['nfl-green-bay-packers'].home), 'Green Bay');
    const saved = parseCampaign(exportCampaign(state));
    assert.equal(saved.settings.sport, 'american-football');
    assert.equal(Object.keys(saved.teams).length, 32);

    app.openSetup();
    app.pickSetup('sport', 'football');
    assert.equal(app.state.setup.clubScope, 'domestic:eu124', "the NFL's map is no football theatre");
  } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
});
