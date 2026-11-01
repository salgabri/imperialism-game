// Baseball (docs/design/baseball.md): the MLB clubs and the birthplace nations built from the committed MLB The Show
// snapshot, the half-inning match model and its live win probability, MLB's own map of the USA and Canada
// (public/domestic/mlb.json) and the running App, which plays the sport with clubs on that map or with nations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { CLUBS, SOURCE } from '../src/data/clubs.baseball.js';
import { ROSTERS } from '../src/data/rosters.baseball.js';
import { buildClub, buildTeam, CROSSOVER_PENALTY, makeRng, outOfPositionPenalty, selectLineup, teamEff, teamSportId } from '../src/data/teams.js';
import { clockLabel, clockTick, getSport, overtimePeriodsOf, overtimeShort, overtimeText, SPORT_LIST } from '../src/sports/index.js';
import { BASELINE, baseballProfile, inningLabel, inningOdds, runMasses } from '../src/sports/baseball.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import { chartDomain, isLiveModel, liveModelFor, winProbabilityAt, winSeries } from '../src/engine/winProbability.js';
import { decodeDomestic, domesticSurroundings } from '../src/engine/domestic.js';
import { territories, validateReachability } from '../src/engine/campaign.js';
import { createDuelDraw } from '../src/engine/duelDraw.js';
import { exportCampaign, parseCampaign } from '../src/engine/storage.js';
import { buildSetupModel, sportNote } from '../src/screens/setup/setupModel.js';
import { buildSquad } from '../src/viewModels/squad.js';
import { buildFeedRows, scorersLine } from '../src/viewModels/match.js';
import { kmToPolys, pointInPolys } from './lib/domestic-partition.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const sport = getSport('baseball');
const SNAPSHOT = JSON.parse(read('scripts/data/mlb-the-show-26.json'));
const FRANCHISES = JSON.parse(read('scripts/data/mlb-teams.json')).teams;
const teams = CLUBS.map(club => buildClub(club, sport));
const byId = Object.fromEntries(teams.map(team => [team.id, team]));

// ---------- the clubs and the nations ----------

test('the 30 MLB clubs and the nations rebuild byte for byte from the committed MLB The Show snapshot', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.match(execFileSync(process.execPath, ['scripts/build-mlb.mjs', '--check'], { cwd: root, encoding: 'utf8' }), /Verified/);
  assert.equal(SNAPSHOT.players.length, SNAPSHOT.source.cards);
  assert.equal(Object.keys(SNAPSHOT.teams).length, 31, 'the 30 clubs and the free agents');
  assert.deepEqual(SOURCE, { edition: 'MLB The Show 26', season: '2026',
    update: `Roster update ${SNAPSHOT.source.rosterUpdate.id} (${SNAPSHOT.source.rosterUpdate.name})`,
    retrieved: SNAPSHOT.source.retrieved, url: SNAPSHOT.source.docs });
});

test('every club fields its whole lineup at natural positions from its 40-man roster, with The Show ratings unchanged', () => {
  assert.equal(CLUBS.length, 30);
  assert.deepEqual(CLUBS.map(club => club.id).sort(), Object.keys(FRANCHISES).sort());
  assert.equal(new Set(CLUBS.map(club => club.code)).size, 30);
  const rated = new Map(SNAPSHOT.players.map(([, name, team, , , overall]) => [`${team}|${name}`, overall]));
  for (const club of CLUBS) {
    assert.match(club.code, /^[A-Z]{3}$/);
    assert.equal(club.code, FRANCHISES[club.id].code);
    assert.equal(club.league, 'MLB');
    const team = byId[club.id];
    assert.equal(teamSportId(team), 'baseball');
    const lineup = selectLineup(team);
    assert.equal(lineup.slots.length, 13);
    assert.ok(lineup.slots.every(slot => slot.player && !slot.outOfPosition), `${club.name} fields every position`);
    assert.equal(club.str, lineup.rating);
    assert.equal(club.squad.length, 26, 'an active roster of 26');
    for (const [name, , rating] of club.squad) assert.equal(rated.get(`${FRANCHISES[club.id].show}|${name}`), rating, `${name}'s overall`);
  }
  assert.deepEqual(CLUBS.map(club => club.str), CLUBS.map(club => club.str).slice().sort((a, b) => b - a));
});

test('any hitter can be the designated hitter; a starter in the bullpen is out of role, a hitter on the mound far worse', () => {
  assert.equal(outOfPositionPenalty('baseball'), 20);
  assert.equal(CROSSOVER_PENALTY, 40);
  const hitters = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'].map((pos, i) => ({ name: `H${i}`, pos, rating: 85 }));
  const ace = { name: 'Ace', pos: 'SP', rating: 90 };
  const lineup = selectLineup({ sport: 'baseball', squad: [...hitters, { name: 'Bat', pos: '1B', rating: 90 }, ace,
    { name: 'Two', pos: 'SP', rating: 88 }, { name: 'Pen', pos: 'RP', rating: 70 }] });
  const slot = position => lineup.slots.filter(s => s.position === position);
  assert.ok(['H1', 'Bat'].includes(slot('DH')[0].player.name) && !slot('DH')[0].outOfPosition, 'a second first baseman bats as the designated hitter');
  assert.ok(lineup.slots.filter(s => s.player && !['SP', 'RP'].includes(s.position)).every(s => !s.outOfPosition));
  const pen = slot('RP');
  assert.ok(pen.some(s => s.player?.name === 'Pen' && !s.outOfPosition));
  assert.ok(pen.some(s => s.player?.name === 'Two' && s.outOfPosition && s.penalty === 20), 'the second starter relieves, out of role');
  assert.ok(pen.some(s => !s.player), 'no hitter is spare to pitch: the third place stays unfilled');
  // A spare hitter pitches only when no pitcher is left, 40 points down.
  const short = selectLineup({ sport: 'baseball', squad: [...hitters, { name: 'Bat', pos: '1B', rating: 90 }, { name: 'Spare', pos: 'LF', rating: 85 }, ace] });
  const crossing = short.slots.filter(s => s.position === 'RP' && s.player);
  assert.equal(crossing.length, 1);
  assert.equal(crossing[0].penalty, CROSSOVER_PENALTY);
  assert.equal(crossing[0].effectiveRating, 45);
  // A two-way player is both: Ohtani is a starter who also plays the outfield and hits.
  const twoWay = selectLineup({ sport: 'baseball', squad: [{ name: 'Two-way', pos: 'SP', positions: ['SP', 'RF'], rating: 95 }] });
  assert.ok(['SP', 'RF', 'DH'].includes(twoWay.starters[0].assignedPos) && !twoWay.starters[0].outOfPosition);
  assert.equal(teamSportId({ squad: [{ name: 'A', pos: 'SS', rating: 80 }] }), 'baseball');
  assert.equal(teamSportId({ squad: [{ name: 'A', pos: 'C', rating: 80 }] }), 'basketball', "a lone 'C' stays basketball's centre");
});

test('nations field the players born there, the Kingdom of the Netherlands Curaçao and Aruba\'s, and the rest generated', () => {
  const born = new Map();
  for (const [, name, , , , , place] of SNAPSHOT.players) born.set(name, place);
  const strongest = Object.entries(ROSTERS).sort((a, b) => b[1][0] - a[1][0]).slice(0, 4).map(([id]) => id);
  assert.deepEqual(strongest, ['840', '214', '862', '192'], 'the USA, the Dominican Republic, Venezuela, Cuba');
  for (const [id, [str, real, players]] of Object.entries(ROSTERS)) {
    assert.equal(players.length, real);
    assert.ok(real <= 26 && str >= BASELINE && str <= 99, `${id}`);
  }
  const dutch = ROSTERS['528'][2].map(([name]) => born.get(name));
  assert.ok(dutch.includes('Curacao') && dutch.includes('Aruba'), 'the Kingdom of the Netherlands');
  assert.ok(ROSTERS['840'][2].every(([name]) => !['Dominican Republic', 'Japan'].includes(born.get(name))));

  const rng = makeRng(20261101);
  const usa = buildTeam('840', rng, sport);
  assert.equal(usa.real, 26);
  assert.ok(selectLineup(usa).slots.every(slot => slot.player && !slot.outOfPosition && !slot.player.gen), 'the USA fields its own');
  const japan = buildTeam('392', rng, sport);
  const lineup = selectLineup(japan);
  assert.ok(lineup.slots.every(slot => slot.player && !slot.outOfPosition), 'Japan fills its catcher and shortstop with generated players');
  assert.ok(lineup.starters.some(player => player.gen) && lineup.starters.some(player => player.name === 'Shohei Ohtani'));
  const brazil = buildTeam('076', rng, sport);
  assert.equal(brazil.real, 0);
  assert.equal(brazil.str, BASELINE, 'a nation with no MLB players is a minnow');
  assert.equal(brazil.squad.length, 13);
  assert.ok(selectLineup(brazil).slots.every(slot => slot.player?.gen && !slot.outOfPosition));
  assert.ok(teamEff(usa) > teamEff(japan) && teamEff(japan) > teamEff(brazil));
});

// ---------- the match model ----------

test('matches always produce a winner, the feed adds up, and scores look like MLB\'s', () => {
  const rng = makeRng(20261101);
  let runs = 0, games = 0, extras = 0, oneRun = 0;
  for (let i = 0; i < 4000; i++) {
    const a = teams[i % 30], d = teams[(i * 7 + 3) % 30];
    if (a === d) continue;
    const result = sport.simulate(rng, a, d, 6, teamEff(a), teamEff(d));
    assert.ok(result.winner === a.id || result.winner === d.id);
    assert.notEqual(result.ga, result.gd, 'never level at the end');
    assert.equal(result.winner === a.id, result.ga > result.gd);
    const sum = id => result.ev.filter(e => e.tid === id).reduce((s, e) => s + e.pts, 0);
    assert.deepEqual([sum(a.id), sum(d.id)], [result.ga, result.gd], 'the feed adds up to the final score');
    assert.ok(result.ev.every(e => Number.isInteger(e.pts) && e.pts >= 1 && e.pts <= 4), 'one to four runs batted in at a time');
    assert.ok(result.ev.every(e => e.m >= 1 && e.m <= 90), 'within nine innings and six extra');
    assert.ok(result.ev.every((e, k) => k === 0 || result.ev[k - 1].m <= e.m), 'in order');
    // The attacker bats in the top of each inning, the home side in the bottom.
    assert.ok(result.ev.every(e => (inningLabel(e.m)[0] === 'T') === (e.tid === a.id)));
    if (result.tie) {
      extras++;
      assert.equal(result.regA, result.regD, 'extra innings only from a level score');
      assert.ok(result.tie.periods.length >= 1 && result.tie.periods.length <= 6);
      assert.deepEqual([result.tie.ga, result.tie.gd], [result.ga, result.gd]);
    } else assert.ok(result.ev.every(e => e.m <= 54));
    runs += result.regA + result.regD;
    games++;
    if (Math.abs(result.ga - result.gd) === 1) oneRun++;
  }
  const perTeam = runs / games / 2;
  assert.ok(perTeam > 3.9 && perTeam < 4.9, `about 4.4 runs a team (${perTeam.toFixed(2)})`);
  assert.ok(extras / games > 0.05 && extras / games < 0.14, `some games go to extra innings (${(extras / games * 100).toFixed(1)}%)`);
  assert.ok(oneRun / games > 0.24 && oneRun / games < 0.38, `about three in ten games are won by a run (${(oneRun / games * 100).toFixed(1)}%)`);
});

test('the home side does not bat in the ninth when ahead, and a walk-off ends the game on the winning run', () => {
  const prepared = sport.prepareMatch(teams[0], teams[29]);
  const rng = makeRng(9);
  let skipped = 0, walkoffs = 0;
  for (let i = 0; i < 3000; i++) {
    const { ga, gd, halves, tie } = sport.sampleResult(rng, prepared, 6);
    const last = halves.at(-1);
    if (last.side === 'A' && last.half === 16) { skipped++; assert.ok(gd > ga, 'no bottom of the ninth only when the home side leads'); }
    if (last.side === 'D' && last.half >= 17 && gd > ga && last.runs > 0) {
      walkoffs++;
      assert.equal(gd - ga, 1, 'the winning run ends it');
    }
    if (!tie) assert.ok(halves.length === 17 || halves.length === 18);
  }
  assert.ok(skipped > 300 && walkoffs > 30, `${skipped} unplayed ninths, ${walkoffs} walk-offs`);
});

test('stronger teams are favourites, and Upsets widens the underdog\'s chance without removing inning luck', () => {
  const best = teams[0], worst = teams[29];
  const odds = preset => estimateWinProbability({ sport, attacker: best, defender: worst, preset, samples: 6000 }).attacker;
  const [predictable, balanced, wild] = ['predictable', 'balanced', 'wild'].map(odds);
  assert.ok(predictable > balanced && balanced > wild, `${predictable} > ${balanced} > ${wild}`);
  assert.ok(wild > 0.7 && predictable < 0.9, 'a favourite, never a certainty: baseball is the game of upsets');
  const swap = estimateWinProbability({ sport, attacker: worst, defender: best, preset: 'balanced', samples: 6000 }).attacker;
  assert.ok(Math.abs(swap - (1 - balanced)) < 0.03, 'batting last is no advantage');
});

test('the half-inning odds and the feed copy: runs batted in, by half-inning', () => {
  const even = inningOdds(0);
  assert.ok(Math.abs(even.score - 0.28) < 1e-9 && even.extra > 0.5, 'a run in 28% of half-innings, most extra ones');
  assert.ok(inningOdds(5).score > even.score && inningOdds(-5).score < even.score);
  const masses = runMasses(0.28);
  assert.ok(Math.abs(masses.reduce((s, v) => s + v, 0) - 1) < 1e-12);
  assert.ok(Math.abs(masses.reduce((s, v, k) => s + v * k, 0) - 0.49) < 0.01, 'about 0.49 runs a half-inning');
  assert.deepEqual([inningLabel(1), inningLabel(3), inningLabel(4), inningLabel(54), inningLabel(55), inningLabel(0)],
    ['T1', 'T1', 'B1', 'B9', 'T10', 'T1']);
  assert.deepEqual(sport.formatEvent({ m: 14, pts: 2, name: 'Aaron Judge' }, 'NYY'), { when: 'T3', text: '2 RBI — Aaron Judge (NYY)' });
  assert.equal(sport.formatToast({ pts: 1, name: 'Juan Soto' }), '1 RBI — JUAN SOTO');
  const shown = [{ tid: 'y', name: 'Aaron Judge', pts: 2 }, { tid: 'y', name: 'Aaron Judge', pts: 1 }, { tid: 'y', name: 'Giancarlo Stanton', pts: 1 },
    { tid: 'y', name: 'Anthony Volpe', pts: 1 }];
  assert.equal(scorersLine(shown, 'y', {}, 'baseball'), 'Judge 3 RBI · Stanton 1 RBI');
  // The clock counts outs: the 27th ends the top of the fifth, the 28th is the first in the bottom.
  assert.deepEqual([clockLabel(sport, 27), clockLabel(sport, 28), clockLabel('football', 27), clockTick(sport, 18), clockTick(sport, 0),
    clockTick('basketball', 20)], ['T5', 'B5', "27'", '3', '', "20'"]);
  assert.deepEqual([overtimeText(sport, 2), overtimeShort(sport, 2), overtimePeriodsOf(sport, 'After 11 innings')], ['after 11 innings', 'F/11', 2]);
  assert.deepEqual([overtimeText('basketball', 1), overtimeShort('basketball', 2), overtimePeriodsOf('basketball', 'after 2 overtime periods')],
    ['after 1 overtime period', '2OT', 2]);
});

test('the feed reads half-innings, keeps no half-time and names the extra innings', () => {
  const base = { sport: 'baseball', state: 'live', aCode: 'NYY', bCode: 'BOS', aName: 'New York Yankees', bName: 'Boston Red Sox', aId: 'y', dId: 'b',
    length: 54, half: 0, finalMinute: 60, scoreA: 3, scoreB: 3, kickoff: 'First pitch', endLabel: 'Final', overtime: true,
    events: [{ key: 'e0', m: 5, label: 'B1', tid: 'b', pts: 3, text: '3 RBI — Rafael Devers (BOS)' },
      { key: 'e1', m: 50, label: 'T9', tid: 'y', pts: 3, text: '3 RBI — Aaron Judge (NYY)' }] };
  const live = buildFeedRows({ feedBase: base }, 30);
  assert.equal(live[0].minute, 'B5');
  assert.match(live[0].text, /· 4 innings left$/);
  assert.ok(!live.some(row => /Half-time/.test(row.text)), 'no half-time in baseball');
  assert.equal(live.at(-1).minute, 'T1');
  assert.equal(live.at(-1).text, 'First pitch — New York Yankees attack Boston Red Sox');
  const extra = buildFeedRows({ feedBase: base }, 57);
  assert.ok(extra.some(row => row.minute === 'B9' && row.text === 'Extra innings — NYY 3–3 BOS'));
  assert.match(extra[0].text, /· extra innings$/);
});

test('the live win probability starts at the fixture odds, follows the score and settles at the end', () => {
  for (const [i, j] of [[0, 29], [5, 6], [12, 28], [29, 1]]) {
    const model = liveModelFor(sport, teams[i], teams[j], undefined, undefined, 6);
    assert.ok(isLiveModel(model), 'an innings model');
    assert.equal(model.kind, 'innings');
    const odds = estimateWinProbability({ sport, attacker: teams[i], defender: teams[j], preset: 'balanced', samples: 12000 }).attacker;
    assert.ok(Math.abs(winProbabilityAt(model, 0, 0) - odds) < 0.02, `first pitch ${winProbabilityAt(model, 0, 0)} v odds ${odds}`);
    assert.ok(winProbabilityAt(model, 27, 2) > winProbabilityAt(model, 27, 0) && winProbabilityAt(model, 27, 0) > winProbabilityAt(model, 27, -2));
    assert.equal(winProbabilityAt(model, 51, -1), 0, 'behind after the top of the ninth, the visitor has no more outs');
    assert.ok(winProbabilityAt(model, 51, 3) > 0.9, 'three up going into the bottom of the ninth');
    assert.equal(winProbabilityAt(model, 54, 2), 1);
    assert.ok(winProbabilityAt(model, 57, 1) > winProbabilityAt(model, 54, 0) && winProbabilityAt(model, 57, -1) < winProbabilityAt(model, 54, 0),
      'a run in the top of the tenth');
  }
  const model = liveModelFor(sport, teams[0], teams[1]);
  const series = winSeries({ model, goals: [{ m: 5, tid: 'a', pts: 2 }, { m: 40, tid: 'd', pts: 2 }, { m: 58, tid: 'a', pts: 1 }], aId: 'a', dId: 'd',
    minute: 60, final: { winnerSide: 'A' } });
  assert.equal(series.at(-1).t, 60, 'the series runs to the end of the extra inning played');
  assert.equal(series.at(-1).p, 1);
  assert.deepEqual(chartDomain(model, 60).ticks, [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60], 'every inning, then each extra one');
  assert.equal(model.length, 54);
});

// ---------- the MLB map ----------

const TEXT = read('public/domestic/mlb.json');
const DOC = JSON.parse(TEXT);
const MAP = decodeDomestic(JSON.parse(TEXT), 'mlb');
const ENTRY = CLUB_MAPS.find(entry => entry.id === 'mlb');
const ATLAS = JSON.parse(read('public/countries-50m.json'));
const { geo } = MAP;
const sectionIds = geo.countries.map(section => section.id);
const sectionAt = point => geo.countries.find(section => pointInPolys(point, section.polys))?.id ?? null;
const home = id => MAP.clubs.find(club => club.id === id).homeSection;

test('the MLB map gives every club one territory around its ballpark, across the USA and Canada', () => {
  assert.deepEqual({ format: DOC.format, sport: DOC.sport, league: DOC.league, name: DOC.name, hosts: DOC.hosts },
    { format: 1, sport: 'baseball', league: 'MLB', name: 'USA and Canada', hosts: ['840', '124'] });
  assert.equal(ENTRY.version, DOC.version);
  assert.deepEqual([ENTRY.clubs, ENTRY.sections, ENTRY.venue, ENTRY.top], [30, 30, 'ballpark', CLUBS.slice(0, 3).map(club => club.name)]);
  assert.ok(Buffer.byteLength(TEXT) <= 250000);
  assert.ok(read('public/domestic/ATTRIBUTION-mlb.txt').includes(DOC.version));
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
  assert.ok(!ids.has('840') && !ids.has('124') && ids.has('484'), 'Mexico lies beneath as inert land');
});

test('Chicago is split between its clubs, the Bronx and Queens are New York\'s two, and Toronto holds Ontario', () => {
  assert.equal(sectionAt([-87.6556, 41.9481]), home('mlb-chicago-cubs'), 'Wrigley Field');
  assert.equal(sectionAt([-87.6339, 41.83]), home('mlb-chicago-white-sox'), 'Rate Field');
  assert.equal(sectionAt([-73.9264, 40.8296]), home('mlb-new-york-yankees'), 'Yankee Stadium');
  assert.equal(sectionAt([-73.8458, 40.757]), home('mlb-new-york-mets'), 'Citi Field');
  assert.equal(sectionAt([-75.69, 45.42]), home('mlb-toronto-blue-jays'), 'Ottawa');
  assert.equal(sectionAt([-149.9, 61.22]), null, 'Alaska is nobody\'s');
});

test('seeded duel campaigns on the MLB map reach a champion', () => {
  const { obstacles } = domesticSurroundings(ATLAS, MAP);
  const rng = makeRng(20261101);
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

test('setup lists baseball as a fourth sport with nations and the MLB clubs, on its built-in 2026 season', () => {
  assert.deepEqual(SPORT_LIST.map(item => item.id), ['football', 'basketball', 'american-football', 'baseball']);
  assert.equal(sportNote(sport), 'Nations · 30 MLB clubs');
  const clubs = buildSetupModel({ sport: 'baseball', layer: 'clubs', clubScope: 'domestic:mlb' }, {});
  assert.equal(clubs.clubsOnly, null);
  assert.deepEqual(clubs.scopes.map(scope => [scope.id, scope.label, scope.count]), [['domestic:mlb', 'MLB', 30]]);
  assert.equal(clubs.scopeName, 'MLB · USA and Canada');
  assert.match(clubs.countryNote, /the 30 MLB clubs, each starting on the land nearest its ballpark: USA and Canada split into 30 territories along state and province lines\./);
  assert.deepEqual(clubs.season.options.map(option => option.name), ['2026']);
  const nations = buildSetupModel({ sport: 'baseball', layer: 'nations', scope: 'CONCACAF' }, {});
  assert.equal(nations.layer, 'nations');
});

test('the squad screen draws a diamond, groups the batting order and profiles batting, pitching and fielding', () => {
  const team = { ...byId['mlb-new-york-yankees'], baseEff: teamEff(byId['mlb-new-york-yankees']) };
  const squad = buildSquad({ teams: { [team.id]: team }, aliveIds: [team.id], history: [] }, { sport }, team.id);
  assert.equal(squad.layout, 'diamond');
  assert.equal(squad.viewLabel, 'Diamond');
  assert.equal(squad.xi.label, 'Starting lineup');
  assert.deepEqual(squad.groups.map(group => group.label), ['Catcher', 'Infield', 'Outfield', 'Designated hitter', 'Starting pitcher', 'Bullpen']);
  assert.equal(squad.pitch.length, 13);
  assert.ok(squad.pitch.every(slot => /%$/.test(slot.x) && /%$/.test(slot.y)));
  assert.deepEqual(squad.profile.map(row => row.label), ['Batting', 'Pitching', 'Fielding']);
  const profile = baseballProfile(selectLineup(team));
  assert.ok(profile.batting > 60 && profile.pitching > 60 && profile.fielding > 60);
});

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearDomesticCache: ['src/engine/domestic.js', 'clearDomesticCache'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

test('baseball sets up with clubs on the MLB map or with nations, launches and saves', async () => {
  const calls = [];
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: async url => {
    calls.push(String(url));
    return url === '/domestic/mlb.json' ? { ok: true, status: 200, json: async () => JSON.parse(TEXT) }
      : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  } });
  B.clearDomesticCache();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['840', '124', '484'],
    settings: { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try {
    const { app, time } = f;
    app.pickSetup('sport', 'baseball');
    assert.equal(app.state.setup.layer, 'nations', 'baseball has nations');
    app.pickSetup('layer', 'clubs');
    assert.equal(app.state.setup.clubScope, 'domestic:mlb', "MLB's one theatre");
    time.advance(200);
    await app.loadCountry('mlb');
    await settle();
    assert.deepEqual(calls, ['/domestic/mlb.json']);
    assert.equal(buildSetupModel(app.state.setup, { domestic: app.domesticStatus() }).canLaunch, true);

    app.startCampaign();
    const { state } = app;
    assert.equal(state.phase, 'playing');
    assert.equal(state.aliveIds.length, 30);
    assert.equal(state.campaignName, 'Baseball · MLB · USA and Canada');
    assert.ok(Object.values(state.teams).every(team => team.sport === 'baseball' && state.own[team.home] === team.id));
    assert.equal(app.territoryName(state.teams['mlb-chicago-cubs'].home), 'North Side');
    const saved = parseCampaign(exportCampaign(state));
    assert.equal(saved.settings.sport, 'baseball');
    assert.equal(Object.keys(saved.teams).length, 30);

    app.openSetup();
    app.pickSetup('sport', 'football');
    assert.equal(app.state.setup.clubScope, 'all', "MLB's map is no football theatre");
  } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
});
