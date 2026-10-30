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
import { getSport, SPORT_LIST } from '../src/sports/index.js';
import { americanFootballProfile, driveMoments, driveOdds } from '../src/sports/americanFootball.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import { chartDomain, isLiveModel, liveModelFor, winProbabilityAt, winSeries } from '../src/engine/winProbability.js';
import { decodeDomestic, domesticSurroundings } from '../src/engine/domestic.js';
import { territories, validateReachability } from '../src/engine/campaign.js';
import { createDuelDraw } from '../src/engine/duelDraw.js';
import { exportCampaign, parseCampaign } from '../src/engine/storage.js';
import { buildSetupModel, sportNote } from '../src/screens/setup/setupModel.js';
import { buildSquad } from '../src/viewModels/squad.js';
import { scorersLine } from '../src/viewModels/match.js';
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
  const margins = [];
  for (let i = 0; i < 3000; i++) {
    const a = teams[i % 32], d = teams[(i * 7 + 3) % 32];
    if (a === d) continue;
    const result = sport.simulate(rng, a, d, 6, teamEff(a), teamEff(d));
    assert.ok(result.winner === a.id || result.winner === d.id);
    assert.notEqual(result.ga, result.gd, 'never level at the end');
    assert.equal(result.winner === a.id, result.ga > result.gd);
    const sum = id => result.ev.filter(e => e.tid === id).reduce((s, e) => s + e.pts, 0);
    assert.deepEqual([sum(a.id), sum(d.id)], [result.ga, result.gd], 'the feed adds up to the final score');
    assert.ok(result.ev.every(e => e.pts === 7 || e.pts === 3), 'touchdowns and field goals');
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
  }
  const perTeam = points / games / 2;
  assert.ok(perTeam > 19 && perTeam < 26, `about 22 points a team (${perTeam.toFixed(1)})`);
  assert.ok(overtimes / games > 0.02 && overtimes / games < 0.09, `a few games go to overtime (${(overtimes / games * 100).toFixed(1)}%)`);
  margins.sort((x, y) => x - y);
  assert.ok(margins[margins.length >> 1] >= 7 && margins[margins.length >> 1] <= 14, 'a typical margin of one or two scores');
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

test('the drive odds and the feed copy: a touchdown is 7, a field goal 3, by quarter', () => {
  const even = driveMoments(driveOdds(0, 80));
  assert.ok(even.mean > 1.8 && even.mean < 2.2, 'about two points a drive between equals');
  assert.ok(driveOdds(5, 80).td > driveOdds(0, 80).td && driveOdds(0, 90).make > driveOdds(0, 80).make);
  assert.deepEqual(sport.formatEvent({ m: 14, pts: 7, name: 'Travis Kelce' }, 'KCC'), { when: 'Q1', text: 'TD — Travis Kelce (KCC)' });
  assert.deepEqual(sport.formatEvent({ m: 47, pts: 3, name: 'Harrison Butker' }, 'KCC'), { when: 'Q4', text: 'FG — Harrison Butker (KCC)' });
  assert.equal(sport.formatEvent({ m: 64, pts: 3, name: 'Harrison Butker' }, 'KCC').when, 'OT');
  assert.equal(sport.formatToast({ pts: 7, name: 'Travis Kelce' }), 'TOUCHDOWN — TRAVIS KELCE');
  const shown = [{ tid: 'k', name: 'Travis Kelce', pts: 7 }, { tid: 'k', name: 'Travis Kelce', pts: 7 }, { tid: 'k', name: 'Harrison Butker', pts: 3 },
    { tid: 'k', name: 'Harrison Butker', pts: 3 }, { tid: 'k', name: 'Harrison Butker', pts: 3 }, { tid: 'k', name: 'Rashee Rice', pts: 7 }];
  assert.equal(scorersLine(shown, 'k', {}, 'american-football'), 'Kelce 2 TD · Butker 3 FG');
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
    // In overtime a touchdown's lead leaves the trailing side one answer.
    assert.ok(winProbabilityAt(model, 63, 7) > model.otChain[3] && winProbabilityAt(model, 63, -7) < model.otChain[3]);
  }
  const model = liveModelFor(sport, teams[0], teams[1]);
  const series = winSeries({ model, goals: [{ m: 20, tid: 'a', pts: 7 }, { m: 70, tid: 'a', pts: 3 }], aId: 'a', dId: 'd', minute: 70,
    final: { winnerSide: 'A' } });
  assert.equal(series.at(-1).t, 70, 'the series runs to the end of the overtime played');
  assert.equal(series.at(-1).p, 1);
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
  assert.equal(sectionAt([-104.82, 41.14]), home('nfl-denver-broncos'), 'Cheyenne');
  assert.equal(sectionAt([-149.9, 61.22]), null, 'Alaska is nobody\'s');
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
  assert.deepEqual(SPORT_LIST.map(item => item.id), ['football', 'basketball', 'american-football']);
  assert.equal(sportNote(sport), '32 NFL clubs');
  const model = buildSetupModel({ sport: 'american-football', layer: 'clubs', clubScope: 'domestic:nfl' }, {});
  assert.equal(model.clubsOnly, 'NFL');
  assert.deepEqual(model.scopes.map(scope => [scope.id, scope.label, scope.count]), [['domestic:nfl', 'NFL', 32]]);
  assert.equal(model.scopeName, 'NFL · USA');
  assert.match(model.countryNote, /lead the 32 NFL clubs, each starting on the land nearest its stadium: USA split into 32 territories along state lines\./);
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
    assert.equal(app.state.setup.clubScope, 'all', "the NFL's map is no football theatre");
  } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
});
