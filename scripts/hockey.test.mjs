// Ice hockey (docs/design/hockey.md): the NHL clubs and the nations built from the committed snapshot, EA's ratings
// unchanged and every other rating an estimate marked as one, the slice-by-slice match model and its live win
// probability, the NHL's own map of the USA and Canada (public/domestic/nhl.json) and the running App.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { CLUBS, SOURCE } from '../src/data/clubs.hockey.js';
import { ROSTERS } from '../src/data/rosters.hockey.js';
import { ESTIMATE_TITLE, isEstimated } from '../src/data/estimates.js';
import { buildClub, buildTeam, CROSSOVER_PENALTY, makeRng, outOfPositionPenalty, selectLineup, SKATER_CROSSOVER_PENALTY, teamEff, teamSportId } from '../src/data/teams.js';
import { clockLabel, clockTick, getSport, overtimeEnd, overtimePeriodsOf, overtimeShort, overtimeText, SPORT_LIST } from '../src/sports/index.js';
import { BASELINE, hockeyProfile, overtimeMeans, PERIOD_MODEL, shootoutOdds, sliceMeans } from '../src/sports/hockey.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import { chartDomain, isLiveModel, liveModelFor, winProbabilityAt, winSeries } from '../src/engine/winProbability.js';
import { decodeDomestic, domesticSurroundings } from '../src/engine/domestic.js';
import { territories, validateReachability } from '../src/engine/campaign.js';
import { createDuelDraw } from '../src/engine/duelDraw.js';
import { fieldedNations, heldShapes } from '../src/engine/footballSets.js';
import { exportCampaign, parseCampaign } from '../src/engine/storage.js';
import { buildSetupModel, sportNote } from '../src/screens/setup/setupModel.js';
import { buildSquad, sourceLabel, sourceTitle } from '../src/viewModels/squad.js';
import { conquestOptions } from '../src/viewModels/conquest.js';
import { buildFeedRows, scorersLine } from '../src/viewModels/match.js';
import { kmToPolys, pointInPolys } from './lib/domestic-partition.mjs';
import { ESTIMATE_RANGE, estimateScore, playerOf, ratePlayers } from './lib/nhl.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const sport = getSport('hockey');
const SNAPSHOT = JSON.parse(read('scripts/data/nhl-27.json'));
const FRANCHISES = JSON.parse(read('scripts/data/nhl-teams.json')).teams;
// By name and group: the NHL has two Elias Petterssons and two Sebastian Ahos, a forward and a defender each.
const groupOf = pos => (pos === 'G' || pos === 'D' ? pos : 'F');
const keyOf = (name, pos) => `${name}|${groupOf(pos)}`;
const RATED = new Map(SNAPSHOT.players.filter(row => row[6] !== null).map(row => [keyOf(row[1], row[3]), row[6]]));
const teams = CLUBS.map(club => buildClub(club, sport));
const byId = Object.fromEntries(teams.map(team => [team.id, team]));

// ---------- the ratings ----------

test('the 32 NHL clubs and the nations rebuild byte for byte from the committed snapshot', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.match(execFileSync(process.execPath, ['scripts/build-hockey.mjs', '--check'], { cwd: root, encoding: 'utf8' }), /Verified/);
  assert.equal(RATED.size, SNAPSHOT.source.rated, 'every player EA lists, each once');
  assert.equal(SOURCE.rated, 300, 'EA lists its top 300');
  assert.equal(SOURCE.floor, 84);
});

test('EA\'s ratings stay as they are, and every other rating is an estimate below EA\'s cut-off', () => {
  const rated = ratePlayers(SNAPSHOT.players.map(playerOf));
  for (const player of rated) {
    if (player.overall !== null) {
      assert.equal(player.rating, player.overall, `${player.name}: EA's overall`);
      assert.equal(player.estimated, false);
    } else {
      assert.equal(player.estimated, true, `${player.name} is marked`);
      assert.ok(player.rating < SOURCE.floor, `${player.name}'s estimate is under EA's cut-off (${player.rating})`);
      assert.ok(player.rating >= Math.min(ESTIMATE_RANGE.skater, ESTIMATE_RANGE.goalie), `${player.name}: ${player.rating}`);
    }
  }
  // The squad files say which is which, tuple by tuple.
  const tuples = [...CLUBS.flatMap(club => club.squad), ...Object.values(ROSTERS).flatMap(roster => roster[2])];
  for (const [name, pos, rating, source] of tuples) {
    if (RATED.has(keyOf(name, pos))) {
      assert.deepEqual(source, { source: 'ea-nhl', edition: 'NHL 27' }, name);
      assert.equal(rating, RATED.get(keyOf(name, pos)), `${name}'s overall`);
    } else assert.deepEqual(source, { source: 'estimate', edition: 'Estimated' }, name);
  }
  // Each of two namesakes keeps his own: the Canucks' centre is rated, their young defender is not.
  const canucks = SNAPSHOT.players.filter(row => row[1] === 'Elias Pettersson' && row[2] === 'VAN');
  assert.deepEqual(canucks.map(row => row[3]).sort(), ['C', 'D']);
  assert.ok(canucks.find(row => row[3] === 'C')[6] >= 84, 'the centre');
  assert.equal(canucks.find(row => row[3] === 'D')[6], null, 'the defender');
  assert.ok(tuples.some(([, , , source]) => source.source === 'estimate') && tuples.some(([, , , source]) => source.source === 'ea-nhl'));
});

test('the estimates rank players by ice time and scoring, and a few games prove little', () => {
  const skater = (over = {}) => ({ pos: 'C', games: 80, seconds: 80 * 15 * 60, points: 40, shots: 0, saves: 0, ...over });
  assert.ok(estimateScore(skater({ seconds: 80 * 18 * 60 })) > estimateScore(skater()), 'more minutes');
  assert.ok(estimateScore(skater({ points: 60 })) > estimateScore(skater()), 'more points');
  assert.ok(estimateScore(skater({ games: 3, seconds: 3 * 22 * 60, points: 6 })) < estimateScore(skater({ seconds: 80 * 20 * 60, points: 70 })),
    'a three-game burst does not beat a full season of the same');
  const goalie = (shots, saves) => ({ pos: 'G', games: 40, seconds: 0, points: 0, shots, saves });
  assert.ok(estimateScore(goalie(1000, 915)) > estimateScore(goalie(1000, 880)));
  assert.ok(estimateScore(goalie(30, 29)) < estimateScore(goalie(1500, 1400)), 'a good night is not a good season');
  // Who the league uses most ranks first among the players EA leaves out, in each group.
  const rated = ratePlayers(SNAPSHOT.players.map(playerOf)).filter(player => player.estimated);
  for (const group of [p => p.pos === 'D', p => p.pos === 'C' || p.pos === 'LW' || p.pos === 'RW', p => p.pos === 'G']) {
    const list = rated.filter(group);
    assert.equal(Math.max(...list.map(p => p.rating)), ESTIMATE_RANGE.top);
    const best = list.filter(p => p.rating === ESTIMATE_RANGE.top)[0], last = list.reduce((low, p) => (p.rating < low.rating ? p : low));
    assert.ok(estimateScore(best) > estimateScore(last));
  }
});

// ---------- the clubs and the nations ----------

test('every club ices a whole lineup, with a goalie and six defenders of its own, and depth behind it', () => {
  assert.equal(CLUBS.length, 32);
  assert.deepEqual(CLUBS.map(club => club.id).sort(), Object.keys(FRANCHISES).sort());
  assert.equal(new Set(CLUBS.map(club => club.code)).size, 32);
  assert.deepEqual(CLUBS.map(club => club.str), CLUBS.map(club => club.str).slice().sort((a, b) => b - a));
  for (const club of CLUBS) {
    assert.equal(club.code, FRANCHISES[club.id].code);
    assert.equal(club.league, 'NHL');
    const team = byId[club.id];
    assert.equal(teamSportId(team), 'hockey');
    const lineup = selectLineup(team);
    assert.equal(lineup.slots.length, 19);
    assert.ok(lineup.slots.every(slot => slot.player), `${club.name} fills every place`);
    for (const slot of lineup.slots) {
      assert.ok(slot.penalty <= outOfPositionPenalty('hockey'), `${club.name}: ${slot.player.name} at ${slot.position}`);
      if (slot.position === 'D' || slot.position === 'G') assert.equal(slot.outOfPosition, false, `${club.name}'s ${slot.position}`);
    }
    assert.equal(club.str, lineup.rating);
    assert.ok(club.squad.length >= 22 && club.squad.length <= 23, `${club.name}: ${club.squad.length}`);
    assert.ok(club.squad.filter(([, pos]) => pos === 'G').length >= 2, `${club.name} has a backup goalie`);
    assert.ok(lineup.bench.every(player => !lineup.starters.includes(player)));
  }
});

test('a forward moves easily between the lines\' places; a defender up front and a skater in goal much less so', () => {
  assert.equal(outOfPositionPenalty('hockey'), 4);
  assert.equal(SKATER_CROSSOVER_PENALTY, 15);
  assert.equal(CROSSOVER_PENALTY, 40);
  const forwards = (pos, n) => Array.from({ length: n }, (_, i) => ({ name: `${pos}${i}`, pos, rating: 80 }));
  const lineup = selectLineup({ sport: 'hockey', squad: [...forwards('C', 8), ...forwards('LW', 4), ...forwards('D', 6), { name: 'Goalie', pos: 'G', rating: 85 }] });
  const rights = lineup.slots.filter(slot => slot.position === 'RW');
  assert.ok(rights.every(slot => slot.outOfPosition && slot.penalty === 4 && slot.effectiveRating === 76), 'spare centres on the right wing');
  assert.ok(lineup.slots.filter(slot => ['C', 'LW', 'D', 'G'].includes(slot.position)).every(slot => !slot.outOfPosition));
  const noGoalie = selectLineup({ sport: 'hockey', squad: [...forwards('C', 14), ...forwards('D', 6)] });
  const crease = noGoalie.slots.find(slot => slot.position === 'G');
  assert.equal(crease.penalty, 40, 'a skater in goal');
  const shortD = selectLineup({ sport: 'hockey', squad: [...forwards('C', 14), ...forwards('D', 5), { name: 'Goalie', pos: 'G', rating: 85 }] });
  assert.ok(shortD.slots.some(slot => slot.position === 'D' && slot.penalty === 15), 'a forward on the blue line');
});

test('nations field their NHL players, the game fills what they lack, and a nation with none is a minnow', () => {
  const strongest = Object.entries(ROSTERS).sort((a, b) => b[1][0] - a[1][0]).slice(0, 4).map(([id]) => id);
  assert.deepEqual(strongest.slice(0, 2), ['124', '840'], 'Canada, then the USA');
  assert.ok(strongest.includes('752') && strongest.includes('643'), 'Sweden and Russia next');
  for (const [id, [str, real, players]] of Object.entries(ROSTERS)) {
    assert.equal(players.length, real, id);
    assert.ok(real <= 23 && str >= BASELINE && str <= 99, id);
  }
  const rng = makeRng(20261107);
  const canada = buildTeam('124', rng, sport);
  assert.ok(selectLineup(canada).slots.every(slot => slot.player && !slot.player.gen), 'Canada fields its own');
  const germany = buildTeam('276', rng, sport);
  const lineup = selectLineup(germany);
  assert.ok(lineup.slots.every(slot => slot.player && slot.penalty <= 4), 'Germany\'s gaps are filled');
  assert.ok(lineup.starters.some(player => player.gen) && lineup.starters.some(player => player.name === 'Leon Draisaitl'));
  const brazil = buildTeam('076', rng, sport);
  assert.equal(brazil.real, 0);
  assert.equal(brazil.str, BASELINE, 'a nation with no NHL players is a minnow');
  assert.equal(brazil.squad.length, 19);
  assert.ok(teamEff(canada) > teamEff(germany) && teamEff(germany) > teamEff(brazil));
  assert.ok(!fieldedNations(sport).includes('SCO') && heldShapes(sport).some(([shape, holder]) => shape === 'SCO' && holder === '826'), 'Great Britain plays as one');
});

// ---------- the match model ----------

test('matches always produce a winner, the feed adds up, and sudden death ends at its goal', () => {
  const rng = makeRng(20261107);
  let goals = 0, games = 0, overtime = 0, shootouts = 0;
  for (let i = 0; i < 4000; i++) {
    const a = teams[i % 32], d = teams[(i * 7 + 3) % 32];
    if (a === d) continue;
    const result = sport.simulate(rng, a, d, 6, teamEff(a), teamEff(d));
    assert.ok(result.winner === a.id || result.winner === d.id);
    assert.notEqual(result.ga, result.gd, 'never level at the end');
    assert.equal(result.winner === a.id, result.ga > result.gd);
    const sum = id => result.ev.filter(e => e.tid === id).reduce((s, e) => s + e.pts, 0);
    assert.deepEqual([sum(a.id), sum(d.id)], [result.ga, result.gd], 'the feed adds up to the final score');
    assert.ok(result.ev.every(e => e.pts === 1));
    assert.ok(result.ev.every((e, k) => k === 0 || result.ev[k - 1].m <= e.m), 'in order');
    assert.ok(result.ev.every(e => typeof e.name === 'string' && e.name), 'a name on every goal');
    if (result.tie) {
      overtime++;
      assert.equal(result.regA, result.regD, 'overtime only from a level score');
      assert.deepEqual([result.tie.ga, result.tie.gd], [result.ga, result.gd]);
      assert.equal(Math.abs(result.ga - result.gd), 1, 'one goal, the deciding one');
      const last = result.ev.at(-1), late = result.ev.filter(e => e.m > 60);
      assert.equal(late.length, 1, 'nothing after the deciding goal');
      assert.equal(last.tid, result.winner);
      if (result.tie.periods.length === 2) {
        shootouts++;
        assert.equal(last.m, PERIOD_MODEL.SHOOTOUT_MINUTE);
        assert.deepEqual(result.tie.periods[0], [0, 0], 'a goalless overtime');
      } else {
        assert.equal(result.tie.periods.length, 1);
        assert.ok(last.m > 60 && last.m <= 65, `in the five minutes (${last.m})`);
      }
    } else assert.ok(result.ev.every(e => e.m >= 1 && e.m <= 60));
    goals += result.regA + result.regD;
    games++;
  }
  const perTeam = goals / games / 2;
  assert.ok(perTeam > 2.7 && perTeam < 3.3, `about three goals a team (${perTeam.toFixed(2)})`);
  assert.ok(overtime / games > 0.18 && overtime / games < 0.28, `about a quarter of games reach overtime (${(overtime / games * 100).toFixed(1)}%)`);
  assert.ok(shootouts / overtime > 0.2 && shootouts / overtime < 0.42, `about a third of those a shoot-out (${(shootouts / overtime * 100).toFixed(1)}%)`);
});

test('score effects: the late game follows the score, and the side behind pulls its goalie', () => {
  const [a, d] = sliceMeans(3, 3, 0, 0);
  assert.ok(Math.abs(a - 0.15) < 1e-9 && a === d, 'level early: three goals a game is 0.15 a slice');
  const [lateA, lateD] = sliceMeans(3, 3, 0, 15);
  assert.ok(lateA < a && lateA === lateD, 'level late, both tighten up');
  const [leader, chaser] = sliceMeans(3, 3, 1, 15);
  assert.ok(chaser > a && leader < a, 'a goal down late, the chaser pushes');
  const [chaser2, leader2] = sliceMeans(3, 3, -1, 15);
  assert.deepEqual([chaser2, leader2], [chaser, leader], 'swapping sides swaps the means');
  const [netA, netD] = sliceMeans(3, 3, 1, PERIOD_MODEL.SLICES - 1);
  assert.ok(netA > 0.5 && netD > chaser, 'the last slice: an empty net, and an extra attacker');
  const [easedA, easedD] = sliceMeans(3, 3, 4, 2);
  assert.ok(easedA < a && easedD === a, 'four goals up, the leader eases off');
  assert.deepEqual(overtimeMeans(3, 3).map(v => Number(v.toFixed(2))), [0.6, 0.6], 'three on three scores faster');
  assert.ok(Math.abs(shootoutOdds(0) - 0.5) < 1e-12 && shootoutOdds(5) > 0.5 && shootoutOdds(5) < 0.6, 'nearly a coin flip');
});

test('stronger teams are favourites, level sides are even, and Upsets widens the underdog\'s chance', () => {
  const best = teams[0], worst = teams[31];
  const odds = preset => estimateWinProbability({ sport, attacker: best, defender: worst, preset, samples: 6000 }).attacker;
  const [predictable, balanced, wild] = ['predictable', 'balanced', 'wild'].map(odds);
  assert.ok(predictable > wild, `${predictable} > ${wild}`);
  assert.ok(balanced > 0.55 && balanced < 0.8, `a favourite, never a certainty: ${balanced}`);
  const swap = estimateWinProbability({ sport, attacker: worst, defender: best, preset: 'balanced', samples: 6000 }).attacker;
  assert.ok(Math.abs(swap - (1 - balanced)) < 0.03, 'neither side gains from attacking');
  const pairing = { sport, attacker: teams[10], defender: teams[11], preset: 'balanced', samples: 8000 };
  const neutral = estimateWinProbability(pairing).defender, home = estimateWinProbability({ ...pairing, home: true }).defender;
  assert.ok(home > neutral + 0.02, `the home side gains (${home} v ${neutral})`);
});

test('the feed copy, the clock and the tie-break texts', () => {
  assert.deepEqual(sport.formatEvent({ m: 38, pts: 1, name: 'Connor McDavid' }, 'EDM'), { when: "38'", text: 'GOAL — Connor McDavid (EDM)' });
  assert.deepEqual(sport.formatEvent({ m: 66, pts: 1, name: 'Connor McDavid' }, 'EDM'), { when: 'SO', text: 'SHOOT-OUT — Connor McDavid (EDM)' });
  assert.equal(sport.formatToast({ m: 12, name: 'Leon Draisaitl' }), "12' GOAL — LEON DRAISAITL");
  assert.equal(sport.formatToast({ m: 66, name: 'Leon Draisaitl' }), 'SHOOT-OUT — LEON DRAISAITL');
  const shown = [{ tid: 'e', m: 5, name: 'Connor McDavid', pts: 1 }, { tid: 'e', m: 30, name: 'Connor McDavid', pts: 1 }, { tid: 'e', m: 44, name: 'Leon Draisaitl', pts: 1 },
    { tid: 'e', m: 50, name: 'Zach Hyman', pts: 1 }, { tid: 'e', m: 66, name: 'Zach Hyman', pts: 1 }];
  assert.equal(scorersLine(shown, 'e', {}, 'hockey'), 'McDavid 2 G · Draisaitl 1 G', 'a shoot-out goal is on nobody\'s line');
  assert.deepEqual([clockLabel(sport, 38), clockLabel(sport, 63), clockLabel(sport, 66), clockTick(sport, 20), clockTick(sport, 65), clockTick(sport, 70)],
    ["38'", "63'", 'SO', "20'", 'OT', 'SO']);
  assert.deepEqual([overtimeText(sport, 1), overtimeText(sport, 2), overtimeShort(sport, 1), overtimeShort(sport, 2)],
    ['in overtime', 'in a shoot-out', 'OT', 'SO']);
  assert.deepEqual([overtimePeriodsOf(sport, 'In overtime'), overtimePeriodsOf(sport, 'In a shoot-out'), overtimePeriodsOf(sport, 'nothing')], [1, 2, null]);
  assert.equal(overtimeEnd(sport, 1), 0, 'overtime ends at its deciding goal');
});

test('the feed names no half-time and marks the overtime', () => {
  const base = { sport: 'hockey', state: 'live', aCode: 'EDM', bCode: 'TOR', aName: 'Edmonton Oilers', bName: 'Toronto Maple Leafs', aId: 'e', dId: 't',
    length: 60, half: 0, finalMinute: 63, scoreA: 1, scoreB: 1, kickoff: 'Puck drop', endLabel: 'Final', overtime: true,
    events: [{ key: 'e0', m: 5, label: "5'", tid: 't', pts: 1, text: 'GOAL — Auston Matthews (TOR)' },
      { key: 'e1', m: 51, label: "51'", tid: 'e', pts: 1, text: 'GOAL — Connor McDavid (EDM)' }] };
  const live = buildFeedRows({ feedBase: base }, 30);
  assert.ok(!live.some(row => /Half-time/.test(row.text)), 'no half-time in hockey');
  assert.equal(live.at(-1).text, 'Puck drop — Edmonton Oilers attack Toronto Maple Leafs');
  const extra = buildFeedRows({ feedBase: base }, 62);
  assert.ok(extra.some(row => row.text === 'Overtime — EDM 1–1 TOR'), JSON.stringify(extra.map(row => row.text)));
});

test('the live win probability starts at the fixture odds, follows the score and settles at the end', () => {
  for (const [i, j] of [[0, 31], [5, 6], [12, 28], [31, 1]]) {
    const model = liveModelFor(sport, teams[i], teams[j], undefined, undefined, 6);
    assert.ok(isLiveModel(model));
    assert.equal(model.kind, 'periods');
    const odds = estimateWinProbability({ sport, attacker: teams[i], defender: teams[j], preset: 'balanced', samples: 12000 }).attacker;
    assert.ok(Math.abs(winProbabilityAt(model, 0, 0) - odds) < 0.02, `puck drop ${winProbabilityAt(model, 0, 0)} v odds ${odds}`);
    assert.ok(winProbabilityAt(model, 30, 2) > winProbabilityAt(model, 30, 0) && winProbabilityAt(model, 30, 0) > winProbabilityAt(model, 30, -2));
    assert.ok(winProbabilityAt(model, 58, 1) > winProbabilityAt(model, 45, 1), 'a lead is worth more as time runs out');
    assert.ok(winProbabilityAt(model, 59, -3) < 0.03, 'three down with a minute left');
    assert.equal(winProbabilityAt(model, 60, 1), 1);
    assert.equal(winProbabilityAt(model, 60, -1), 0);
    assert.equal(winProbabilityAt(model, 63, 1), 1, 'a goal in overtime has won');
    const level = winProbabilityAt(model, 60, 0);
    assert.ok(level > 0.3 && level < 0.7, `level after sixty (${level})`);
    assert.ok(Math.abs(winProbabilityAt(model, 65, 0) - shootoutOdds(model.shootout)) < 1e-9, 'after the five minutes, the shoot-out');
  }
  const model = liveModelFor(sport, teams[0], teams[1]);
  const series = winSeries({ model, goals: [{ m: 5, tid: 'a', pts: 1 }, { m: 40, tid: 'd', pts: 1 }, { m: 62, tid: 'a', pts: 1 }], aId: 'a', dId: 'd', minute: 62, final: { winnerSide: 'A' } });
  assert.equal(series.at(-1).t, 62, 'the series ends at the deciding goal');
  assert.equal(series.at(-1).p, 1);
  assert.deepEqual(chartDomain(model, 30).ticks, [0, 20, 40, 60], 'each period');
  assert.deepEqual(chartDomain(model, 62).ticks, [0, 20, 40, 60, 65], 'then the overtime');
  assert.deepEqual(chartDomain(model, 66).ticks, [0, 20, 40, 60, 65, 70], 'and the shoot-out');
  assert.equal(model.length, 60);
});

// ---------- the NHL map ----------

const TEXT = read('public/domestic/nhl.json');
const DOC = JSON.parse(TEXT);
const MAP = decodeDomestic(JSON.parse(TEXT), 'nhl');
const ENTRY = CLUB_MAPS.find(entry => entry.id === 'nhl');
const ATLAS = JSON.parse(read('public/countries-50m.json'));
const { geo } = MAP;
const sectionIds = geo.countries.map(section => section.id);
const sectionAt = point => geo.countries.find(section => pointInPolys(point, section.polys))?.id ?? null;
const home = id => MAP.clubs.find(club => club.id === id).homeSection;

test('the NHL map gives every club one territory around its arena, across the USA and Canada', () => {
  assert.deepEqual({ format: DOC.format, sport: DOC.sport, league: DOC.league, name: DOC.name, hosts: DOC.hosts },
    { format: 1, sport: 'hockey', league: 'NHL', name: 'USA and Canada', hosts: ['840', '124'] });
  assert.equal(ENTRY.version, DOC.version);
  assert.deepEqual([ENTRY.clubs, ENTRY.sections, ENTRY.top], [32, 32, CLUBS.slice(0, 3).map(club => club.name)]);
  assert.ok(Buffer.byteLength(TEXT) <= 250000);
  assert.ok(read('public/domestic/ATTRIBUTION-nhl.txt').includes(DOC.version));
  assert.deepEqual(MAP.clubs.map(club => club.id), CLUBS.map(club => club.id), 'strongest first, as the section ids run');
  for (const club of MAP.clubs) {
    const source = CLUBS.find(item => item.id === club.id);
    assert.deepEqual([club.name, club.code, club.str], [source.name, source.code, source.str]);
    assert.deepEqual(club.homePoint, FRANCHISES[club.id].home);
    assert.equal(MAP.sectionNames[club.homeSection], FRANCHISES[club.id].city);
    const land = geo.countries.find(section => section.id === club.homeSection).polys;
    assert.ok(kmToPolys(club.homePoint, land) <= 2, `${club.name} plays inside its own territory`);
  }
  const { shapes } = domesticSurroundings(ATLAS, MAP);
  const ids = new Set(shapes.map(shape => shape.id));
  assert.ok(!ids.has('840') && !ids.has('124') && ids.has('484'), 'Mexico lies beneath as inert land');
});

test('the shared states are split between their clubs, and their scraps stay at home', () => {
  assert.equal(sectionAt([-73.9934, 40.7505]), home('nhl-new-york-rangers'), 'Madison Square Garden');
  assert.equal(sectionAt([-78.8763, 42.875]), home('nhl-buffalo-sabres'), 'KeyBank Center');
  assert.equal(sectionAt([-79.3791, 43.6435]), home('nhl-toronto-maple-leafs'), 'Scotiabank Arena');
  assert.equal(sectionAt([-75.9276, 45.2969]), home('nhl-ottawa-senators'), 'Canadian Tire Centre');
  assert.equal(sectionAt([-74.1711, 40.7336]), home('nhl-new-jersey-devils'), 'Prudential Center');
  const newYork = ['nhl-new-york-rangers', 'nhl-new-york-islanders', 'nhl-buffalo-sabres'].map(home);
  assert.ok(newYork.includes(sectionAt([-74.1502, 40.5795])), 'Staten Island stays New York\'s, beside New Jersey');
  assert.equal(sectionAt([-149.9, 61.22]), null, 'Alaska is nobody\'s');
});

test('seeded duel campaigns on the NHL map reach a champion', () => {
  const { obstacles } = domesticSurroundings(ATLAS, MAP);
  const rng = makeRng(20261107);
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

test('setup lists ice hockey with nations and the NHL clubs, on its built-in 2026/27 season, and says what is estimated', () => {
  assert.ok(SPORT_LIST.some(item => item.id === 'hockey'));
  assert.equal(sportNote(sport), 'Nations · 32 NHL clubs');
  const clubs = buildSetupModel({ sport: 'hockey', layer: 'clubs', clubScope: 'domestic:nhl' }, {});
  assert.equal(clubs.clubsOnly, null);
  assert.deepEqual(clubs.scopes.map(scope => [scope.id, scope.label, scope.count]), [['domestic:nhl', 'NHL', 32]]);
  assert.equal(clubs.scopeName, 'NHL · USA and Canada');
  assert.deepEqual(clubs.season.options.map(option => option.name), ['2026/27']);
  assert.match(clubs.season.note, /top 300 players only/);
  assert.match(clubs.season.note, /estimate/);
  assert.equal(buildSetupModel({ sport: 'hockey', layer: 'nations', scope: 'UEFA' }, {}).layer, 'nations');
});

test('the squad screen draws a rink, marks every estimate and profiles attack, defence and goaltending', () => {
  const team = { ...byId['nhl-edmonton-oilers'], baseEff: teamEff(byId['nhl-edmonton-oilers']) };
  const squad = buildSquad({ teams: { [team.id]: team }, aliveIds: [team.id], history: [] }, { sport }, team.id);
  assert.equal(squad.layout, 'rink');
  assert.equal(squad.viewLabel, 'Rink');
  assert.equal(squad.xi.label, 'Starting lineup');
  assert.deepEqual(squad.groups.map(group => group.label), ['Centres', 'Wings', 'Defence', 'Goalie']);
  assert.equal(squad.pitch.length, 19);
  assert.ok(squad.pitch.every(slot => /%$/.test(slot.x) && /%$/.test(slot.y)));
  assert.equal(new Set(squad.pitch.map(slot => `${slot.x}|${slot.y}`)).size, 19, 'nineteen places on the ice');
  assert.deepEqual(squad.profile.map(row => row.label), ['Attack', 'Defence', 'Goaltending']);
  const profile = hockeyProfile(selectLineup(team));
  assert.ok(profile.attack > 60 && profile.defence > 60 && profile.goaltending > 60);

  const rows = squad.groups.flatMap(group => group.rows);
  const mcdavid = rows.find(row => row.name === 'Connor McDavid');
  assert.deepEqual([mcdavid.rating, mcdavid.estimated, mcdavid.source], [99, false, 'NHL 27']);
  const estimated = rows.filter(row => row.estimated);
  assert.ok(estimated.length, 'a lineup holds estimates');
  assert.ok(estimated.every(row => row.source === 'Estimated' && row.sourceTitle === ESTIMATE_TITLE && row.rating < 84));
  assert.equal(squad.pitch.filter(slot => slot.estimated).length, estimated.length, 'the rink marks the same players');
  assert.ok(squad.notes.some(note => new RegExp(`^${estimated.length} of the 19 starting ratings are estimates`).test(note)));
  const player = team.squad.find(isEstimated);
  assert.equal(sourceLabel(player), 'Estimated');
  assert.equal(sourceTitle(player), ESTIMATE_TITLE);
});

test('a signing and a match lineup mark an estimate too', async () => {
  const squad = byId['nhl-edmonton-oilers'].squad;
  const estimated = squad.find(isEstimated), rated = squad.find(player => !isEstimated(player));
  const [a, b] = conquestOptions({ candidates: [estimated, rated].map((player, index) => ({ ...player, index, gain: 0, entersLineup: false })) }, 0, sport);
  assert.match(a.base, / rating \(estimated\)$/);
  assert.doesNotMatch(b.base, /estimated/);
  const { XiTable } = await bundleComponents({ XiTable: 'src/screens/match/XiTable.jsx' });
  const { renderToStaticMarkup } = await import('react-dom/server');
  const React = (await import('react')).default;
  const row = (name, flag) => ({ key: name, pos: 'C', name, rating: 80, tier: 'solid', outOfPosition: false, claimed: null, estimated: flag });
  const html = renderToStaticMarkup(React.createElement(XiTable, { title: 'Lineup', teamId: 'e', rows: [row('Rated Player', false), row('Guessed Player', true)] }));
  assert.equal((html.match(/<sup/g) || []).length, 1, 'one asterisk, on the estimate');
  assert.ok(html.includes('Guessed Player<sup') && html.includes('(estimated rating)'));
});

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearDomesticCache: ['src/engine/domestic.js', 'clearDomesticCache'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

test('hockey sets up with clubs on the NHL map or with nations, launches and saves its estimates', async () => {
  const calls = [];
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: async url => {
    calls.push(String(url));
    return url === '/domestic/nhl.json' ? { ok: true, status: 200, json: async () => JSON.parse(TEXT) }
      : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  } });
  B.clearDomesticCache();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['840', '124', '484'],
    settings: { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try {
    const { app, time } = f;
    app.pickSetup('sport', 'hockey');
    assert.equal(app.state.setup.layer, 'nations', 'hockey has nations');
    app.pickSetup('layer', 'clubs');
    assert.equal(app.state.setup.clubScope, 'domestic:nhl', "the NHL's one theatre");
    time.advance(200);
    await app.loadCountry('nhl');
    await settle();
    assert.deepEqual(calls, ['/domestic/nhl.json']);
    assert.equal(buildSetupModel(app.state.setup, { domestic: app.domesticStatus() }).canLaunch, true);

    app.startCampaign();
    const { state } = app;
    assert.equal(state.phase, 'playing');
    assert.equal(state.aliveIds.length, 32);
    assert.equal(state.campaignName, 'Ice hockey · NHL · USA and Canada');
    assert.ok(Object.values(state.teams).every(team => team.sport === 'hockey' && state.own[team.home] === team.id));
    assert.equal(app.territoryName(state.teams['nhl-new-york-rangers'].home), 'Manhattan');
    const saved = parseCampaign(exportCampaign(state));
    assert.equal(saved.settings.sport, 'hockey');
    assert.equal(Object.keys(saved.teams).length, 32);
    assert.ok(saved.teams['nhl-edmonton-oilers'].squad.some(isEstimated), 'a save keeps the marks');
    assert.ok(saved.teams['nhl-edmonton-oilers'].squad.some(player => player.name === 'Connor McDavid' && !isEstimated(player)));

    app.openSetup();
    app.pickSetup('sport', 'football');
    assert.equal(app.state.setup.clubScope, 'domestic:eu124', "the NHL's map is no football theatre");
  } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
});

test('the win chart marks no half-time in hockey', async () => {
  const { WinChart } = await bundleComponents({ WinChart: 'src/screens/match/WinChart.jsx' });
  const { renderToStaticMarkup } = await import('react-dom/server');
  const React = (await import('react')).default;
  const html = renderToStaticMarkup(React.createElement(WinChart, { sport: 'hockey', model: liveModelFor(sport, teams[0], teams[1]), minuteFallback: 30 }));
  assert.equal((html.match(/class="match-chart__guide"/g) || []).length, 1, 'the quarter lines only');
  for (const tick of [0, 20, 40, 60]) assert.ok(html.includes(`>${tick}&#x27;<`), `${tick}'`);
});
