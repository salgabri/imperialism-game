// Basketball's European competitions (docs/design/euroleague.md): the EuroLeague's 20 clubs, rebuilt from the committed
// snapshot with every rating an estimate from the player's EuroLeague box scores, on their own map of Europe under the
// EuroLeague's rules; and EuroBasket 2025's 24 nations as a basketball nation theatre, every one with a real five.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';
import { CLUBS } from '../src/data/clubs.euroleague.js';
import { CLUBS as NBA_CLUBS } from '../src/data/clubs.basketball.js';
import { ROSTERS } from '../src/data/rosters.basketball.js';
import { EUROPE_MAPS } from '../src/data/europeMaps.js';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { EUROBASKET_2025, NATIONS, SCOPES, buildClub, buildTeam, makeRng, selectLineup, teamEff } from '../src/data/teams.js';
import { nationTheatres } from '../src/data/scopes.js';
import { clubMapOf, domesticLabel, theatreMapsOf } from '../src/data/domesticScope.js';
import { estimateReason, estimateTitle, isEstimated } from '../src/data/estimates.js';
import { EUROLEAGUE_SCOPE, basketball, euroleagueBasketball, euroleagueBasketballIn, isEuroleagueScope, nbaBasketball, nbaBasketballIn } from '../src/sports/basketball.js';
import { getSport, matchSport } from '../src/sports/index.js';
import { loadSportData } from '../src/sports/sportData.js';
import { BUILT_IN_BASKETBALL_SEASONS } from '../src/data/basketballSeasons.js';
import { EUROLEAGUE_LEAGUE_AVERAGES } from '../src/data/euroleagueLeagueAverages.js';
import { decodeFootballSet, seasonSport } from '../src/engine/footballSets.js';
import { REFERENCE_SEASON, euroleagueSeasons, seasonScale, spearman } from './lib/euroleague-seasons.mjs';
import { decodeDomestic, domesticSurroundings } from '../src/engine/domestic.js';
import { territories, validateReachability } from '../src/engine/campaign.js';
import { createDuelDraw } from '../src/engine/duelDraw.js';
import { parseCampaign } from '../src/engine/storage.js';
import { setClubScope } from '../src/app/shared.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { challengeQuery, readChallenge } from '../src/screens/setup/challenge.js';
import {
  ESTIMATE, PRIOR_PIR, RATING_AT_LEVEL, RATING_PER_PIR, RATING_RANGE, blendedPir, displayName, estimateRating, euroleagueClubs, positionsOf,
} from './lib/euroleague.mjs';
import { pointInPolys, polysOf } from './lib/domestic-partition.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const SNAPSHOT = JSON.parse(read('scripts/data/euroleague-2026-27.json'));
const IDENTITY = JSON.parse(read('scripts/data/euroleague-teams.json'));
const TEXT = read('public/domestic/euroleague.json');
const DOC = JSON.parse(TEXT);
const ENTRY = EUROPE_MAPS.find(entry => entry.id === 'euroleague');
const ATLAS = JSON.parse(read('public/countries-50m.json'));
const club = name => { const found = CLUBS.find(c => c.name === name); assert.ok(found, name); return found; };

// ---------- the clubs ----------

test('the clubs rebuild from the committed snapshot, each with its best five', () => {
  const teams = Object.fromEntries(Object.entries(IDENTITY.clubs).map(([code, team]) => [code, { ...team, col: CLUBS.find(c => c.id === team.id).col }]));
  const { clubs, players, warnings } = euroleagueClubs(SNAPSHOT, teams, IDENTITY.names);
  assert.deepEqual(clubs.map(({ source, ...rest }) => rest), CLUBS.map(c => ({ ...c })), 'npm run build:euroleague writes these');
  assert.deepEqual(warnings, [], 'every five fits its positions, and every club in the season has its identity');
  assert.equal(players.length, SNAPSHOT.players.length, 'every rostered player is rated');
  assert.deepEqual(SNAPSHOT.clubs.map(c => c.code).sort(), Object.keys(IDENTITY.clubs).sort(), "the season's 20 clubs");
});

test('twenty clubs, each a real five of estimated ratings on NBA 2K\'s scale, marked as estimates', () => {
  assert.equal(CLUBS.length, 20);
  assert.equal(new Set(CLUBS.map(c => c.id)).size, 20);
  assert.equal(new Set(CLUBS.map(c => c.code)).size, 20);
  const nbaIds = new Set(NBA_CLUBS.map(c => c.id));
  for (const c of CLUBS) {
    assert.match(c.id, /^el-[a-z0-9-]+$/);
    assert.ok(!nbaIds.has(c.id), `${c.id} is no NBA franchise`);
    assert.match(c.code, /^[A-Z]{3}$/);
    assert.equal(c.league, 'EuroLeague');
    assert.ok(NATIONS[c.country], `${c.name} plays in a game nation (${c.country})`);
    assert.equal(c.squad.length, 5, `${c.name} fields a five`);
    for (const [name, positions, rating, meta] of c.squad) {
      assert.ok(name && !/[A-Z]{4}/.test(name), `${name}: a name as the game shows it, not EuroLeague's capitals`);
      assert.match(positions, /^(PG|SG|SF|PF|C)(\/(PG|SG|SF|PF|C))?$/);
      assert.ok(rating >= RATING_RANGE[0] && rating <= RATING_RANGE[1], `${name}: ${rating}`);
      assert.deepEqual(meta, ESTIMATE, `${name}: marked as an estimate`);
    }
    const team = buildClub(c, basketball);
    assert.ok(team.squad.every(isEstimated));
    assert.ok(selectLineup(team).slots.every(slot => !slot.outOfPosition), `${c.name}: nobody out of position`);
    assert.equal(c.str, Math.round(c.squad.reduce((sum, p) => sum + p[2], 0) / 5));
  }
  // The strongest first; the clubs spread about as far apart as the league's (scripts/simulation-realism.test.mjs).
  assert.deepEqual(CLUBS.map(c => c.str), CLUBS.map(c => c.str).slice().sort((a, b) => b - a));
  assert.ok(CLUBS[0].str - CLUBS.at(-1).str >= 5 && CLUBS[0].str - CLUBS.at(-1).str <= 12);
  // The estimate says why, in the EuroLeague's words; a hockey estimate keeps its own.
  const [player] = buildClub(club('Real Madrid'), basketball).squad;
  assert.match(estimateTitle(player), /^Estimated rating: no game rates EuroLeague players, so this one comes from his EuroLeague box scores/);
  assert.equal(estimateReason(player), 'no game rates EuroLeague players');
  assert.match(estimateTitle({ sourceInfo: { source: 'estimate', edition: 'Estimated' } }), /NHL 27's top 300/);
});

test('a rating is linear in PIR a game, the season under way counting most, few games drawn to a bench player\'s', () => {
  const line = (games, pir) => [games, 25, 12, 4, 3, 3, pir];
  // No EuroLeague game: a bench player's rating.
  assert.equal(blendedPir([null, null, null]), PRIOR_PIR);
  assert.equal(estimateRating([null, null, null]), Math.round(RATING_AT_LEVEL + RATING_PER_PIR * (PRIOR_PIR - 9)));
  // A season of PIR 9 rates about 73, a little under for the bench player's four games it is drawn towards.
  assert.equal(estimateRating([null, line(40, 9), null]), 72);
  assert.equal(estimateRating([null, line(400, 9), null]), RATING_AT_LEVEL);
  // Each point of PIR is 1.3 rating points.
  assert.equal(estimateRating([null, line(400, 19), null]) - estimateRating([null, line(400, 9), null]), 13);
  // The season under way counts one and a half times the last, and the one before half.
  assert.ok(Math.abs(blendedPir([null, line(10, 10), line(10, 20)]) - (10 * 10 + 15 * 20 + 16) / 29) < 1e-9);
  assert.ok(Math.abs(blendedPir([line(10, 20), line(10, 10), null]) - (5 * 20 + 10 * 10 + 16) / 19) < 1e-9);
  // Bounded.
  assert.equal(estimateRating([null, line(400, 60), null]), RATING_RANGE[1]);
  assert.equal(estimateRating([null, line(400, -20), null]), RATING_RANGE[0]);
});

test('positions follow the EuroLeague\'s guard, forward or centre, the box score and height', () => {
  // [games, minutes, points, rebounds, assists, three-point attempts, PIR]: per 36 minutes, as given at 36 minutes a game.
  const at36 = ({ reb = 4, ast = 2, tpa = 3 }) => [[10, 36, 12, reb, ast, tpa, 10]];
  assert.deepEqual(positionsOf('G', 183, at36({ ast: 8 })), ['PG']);
  assert.deepEqual(positionsOf('G', 190, at36({ ast: 6 })), ['PG', 'SG']);
  assert.deepEqual(positionsOf('G', 186, at36({ ast: 4.2 })), ['PG', 'SG'], 'a small guard who passes runs the point');
  assert.deepEqual(positionsOf('G', 193, at36({ ast: 4.5 })), ['SG', 'PG']);
  assert.deepEqual(positionsOf('G', 200, at36({ ast: 2 })), ['SG', 'SF']);
  assert.deepEqual(positionsOf('G', 192, at36({ ast: 2 })), ['SG']);
  assert.deepEqual(positionsOf('F', 196, at36({})), ['SF', 'SG']);
  assert.deepEqual(positionsOf('F', 198, at36({ ast: 4 })), ['SF', 'SG']);
  assert.deepEqual(positionsOf('F', 198, at36({})), ['SF']);
  assert.deepEqual(positionsOf('F', 201, at36({})), ['SF', 'PF']);
  assert.deepEqual(positionsOf('F', 204, at36({ reb: 5, tpa: 4 })), ['SF', 'PF'], 'a shooting forward of 204 cm plays the three');
  assert.deepEqual(positionsOf('F', 204, at36({ reb: 7, tpa: 1 })), ['PF', 'SF']);
  assert.deepEqual(positionsOf('F', 208, at36({})), ['PF', 'C']);
  assert.deepEqual(positionsOf('C', 211, at36({ tpa: 0.5 })), ['C']);
  assert.deepEqual(positionsOf('C', 211, at36({ tpa: 3 })), ['C', 'PF'], 'a centre who shoots threes plays the four too');
  assert.deepEqual(positionsOf('C', 203, at36({ tpa: 0 })), ['C', 'PF']);
  // No EuroLeague minutes: by height alone.
  assert.deepEqual(positionsOf('G', 185, [null, null, null]), ['PG', 'SG']);
  assert.deepEqual(positionsOf('G', 196, [null, null, null]), ['SG', 'PG']);
  assert.throws(() => positionsOf('X', 200, []), /Unknown EuroLeague position/);
});

test('names read as the game shows them: initials, Mc, suffixes and particles, the accents EuroLeague keeps', () => {
  assert.equal(displayName('CAMPAZZO, FACUNDO'), 'Facundo Campazzo');
  assert.equal(displayName('MILLER-MCINTYRE, CODI', { abbr: 'Miller-McIntyre, C.' }), 'Codi Miller-McIntyre');
  assert.equal(displayName('WRIGHT IV, MCKINLEY'), 'McKinley Wright IV');
  assert.equal(displayName('SHORTS, TJ'), 'T.J. Shorts');
  assert.equal(displayName('LAWSON, A.J.'), 'A.J. Lawson');
  assert.equal(displayName('ALSTON JR. , DERRICK'), 'Derrick Alston Jr.');
  assert.equal(displayName('ALVES DE SOUZA, THIERRY HENRY'), 'Thierry Henry Alves de Souza');
  assert.equal(displayName('BRISSETT, O\'SHAE J'), 'O\'Shae J Brissett');
  assert.equal(displayName('KUTLUAY, OMER', { alias: 'KUTLUAY, ÖMER' }), 'Ömer Kutluay');
  assert.equal(displayName('VALANCIUNAS, JONAS', { abbr: 'Valanciunas, J.' }, 'Jonas Valančiūnas'), 'Jonas Valančiūnas');
  // Every override names a rostered player; every club's five has a name.
  const codes = new Set(SNAPSHOT.players.map(row => row[0]));
  for (const code of Object.keys(IDENTITY.names)) assert.ok(codes.has(code), `names.${code} is on a roster`);
  assert.ok(CLUBS.some(c => c.squad.some(([name]) => name === 'Jonas Valančiūnas')));
});

// ---------- the rules ----------

test('EuroLeague clubs play FIBA\'s forty minutes at the EuroLeague\'s pace, with its home edge', () => {
  const settings = over => ({ sport: 'basketball', layer: 'clubs', ...over });
  assert.equal(matchSport(settings({ clubScope: EUROLEAGUE_SCOPE })), euroleagueBasketball);
  assert.equal(matchSport(settings({ clubScope: 'domestic:nba' })), nbaBasketball);
  assert.equal(matchSport(settings({ layer: 'nations', clubScope: EUROLEAGUE_SCOPE })), basketball, 'nations play FIBA\'s rules');
  assert.equal(euroleagueBasketball.clock.length, 40);
  assert.equal(euroleagueBasketball.id, 'basketball');
  const [a, d] = CLUBS.slice(0, 2).map(c => buildClub(c, euroleagueBasketball));
  const neutral = euroleagueBasketball.prepareMatch(a, d);
  assert.equal(neutral.pace, 74.2);
  assert.equal(neutral.rules.minutes, 40);
  // At home the defender gains more than under the nations' FIBA rules: EuroLeague home sides win 61–66% of games.
  const edge = sport => { const n = sport.prepareMatch(a, d), h = sport.prepareMatch(a, d, NaN, NaN, { home: true });
    return (h.efficiencyD - h.efficiencyA) - (n.efficiencyD - n.efficiencyA); };
  assert.ok(edge(euroleagueBasketball) > 2 * edge(basketball));
  // A ticker line names the quarter of a forty-minute game.
  assert.equal(euroleagueBasketball.formatEvent({ m: 31, pts: 3, name: 'X' }, 'OLY').when, 'Q4');
  assert.equal(euroleagueBasketball.formatEvent({ m: 41, pts: 2, name: 'X' }, 'OLY').when, 'OT');
  const result = euroleagueBasketball.simulate(makeRng(3), a, d, 6, teamEff(a), teamEff(d));
  assert.ok(result.ga > 40 && result.gd > 40 && result.ga !== result.gd);
});

// ---------- the map ----------

const polysOfSection = i => polysOf(feature(DOC.topology, DOC.topology.objects.sections.geometries[i]).geometry);
const holder = point => {
  const i = DOC.topology.objects.sections.geometries.findIndex((_, k) => pointInPolys(point, polysOfSection(k)));
  return i < 0 ? null : DOC.clubs[i].id;
};

test('the EuroLeague map: its clubs strongest first, each on land in its own country, as the index says', () => {
  assert.deepEqual({ format: DOC.format, sport: DOC.sport, league: DOC.league, name: DOC.name, theatre: DOC.theatre },
    { format: 1, sport: 'basketball', league: 'EuroLeague', name: 'Europe', theatre: undefined });
  const { version, ...rest } = DOC;
  assert.equal(version, `euroleague-${createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 8)}`);
  assert.deepEqual([ENTRY.version, ENTRY.clubs, ENTRY.countries, ENTRY.top], [version, 20, 10, CLUBS.slice(0, 3).map(c => c.name)]);
  assert.deepEqual(DOC.clubs.map(c => c.id), CLUBS.map(c => c.id));
  assert.deepEqual([...DOC.hosts].sort(), [...new Set(CLUBS.map(c => c.country))].sort());
  // Alone in its country, a club holds all of it: Dubai the Emirates, Bayern Germany, Žalgiris Lithuania.
  for (const [point, name] of [[[55.27, 25.2], 'Dubai Basketball'], [[54.37, 24.45], 'Dubai Basketball'], [[9.99, 53.55], 'Bayern Munich'],
    [[13.4, 52.52], 'Bayern Munich'], [[25.28, 54.69], 'Žalgiris Kaunas']]) assert.equal(holder(point), club(name).id, name);
  // Several share theirs: Spain's four, Turkey's three, and Belgrade's and Tel Aviv's two each.
  for (const [point, country] of [[[-5.98, 37.39], '724'], [[32.85, 39.93], '792'], [[19.84, 45.25], '688'], [[35.29, 32.61], '376'], [[34.79, 31.25], '376'],
    [[12.5, 41.9], '380'], [[-1.55, 47.22], '250'], [[22.94, 40.64], '300']]) {
    const id = holder(point);
    assert.ok(id && CLUBS.find(c => c.id === id).country === country, `${point} is ${country}'s`);
  }
  // A country with no club stays grey.
  for (const point of [[16.37, 48.21], [21.01, 52.23], [-9.14, 38.72], [46.68, 24.71]]) assert.equal(holder(point), null, String(point));
  const map = decodeDomestic(JSON.parse(TEXT), 'euroleague');
  assert.equal(map.clubs.length, 20);
  assert.ok(map.clubs.every(row => CLUBS.some(c => c.id === row.id && c.squad === row.squad)), "the map takes the game's clubs");
  assert.equal(domesticLabel(EUROLEAGUE_SCOPE), 'EuroLeague · Europe');
});

test('seeded duel campaigns on the EuroLeague map reach a champion by land or sea', () => {
  const map = decodeDomestic(JSON.parse(TEXT), 'euroleague');
  const { geo } = map;
  const { obstacles } = domesticSurroundings(ATLAS, map);
  const sport = euroleagueBasketball;
  for (const seed of [20261108, 7]) {
    const rng = makeRng(seed);
    const teams = Object.fromEntries(map.clubs.map(row => [row.id, buildClub(row, sport)]));
    let own = { ...map.startOwners }, aliveIds = map.clubs.map(row => row.id);
    assert.deepEqual(validateReachability({ geo, own, aliveIds }).unplacedIds, []);
    while (aliveIds.length > 1) {
      const draw = createDuelDraw(rng, { geo, routingPaths: geo.paths, own, aliveIds, obstacles, borderRoutes: true }, { speed: 80 });
      assert.ok(draw && draw.attackerId !== draw.targetId, 'every duel resolves');
      assert.ok(draw.routeKind !== 'neutral-transit', 'grey land is never a transit treaty');
      const { winner } = sport.simulate(rng, teams[draw.attackerId], teams[draw.targetId], 6, teamEff(teams[draw.attackerId]), teamEff(teams[draw.targetId]));
      const loser = winner === draw.attackerId ? draw.targetId : draw.attackerId;
      own = { ...own, ...Object.fromEntries(territories({ own }, loser).map(id => [id, winner])) };
      aliveIds = aliveIds.filter(id => id !== loser);
    }
    assert.ok(Object.values(own).every(id => id === aliveIds[0]), 'the champion holds every territory');
  }
});

// ---------- setup, launch, saves and links ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearDomesticCache: ['src/engine/domestic.js', 'clearDomesticCache'],
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

async function withApp(fn) {
  const calls = [];
  const fetch = async url => {
    const path = String(url);
    calls.push(path);
    if (/^\/domestic\/[0-9a-z]+\.json$/.test(path)) return { ok: true, status: 200, json: async () => JSON.parse(read(`public${path}`)) };
    if (/^\/basketball\/nba-2k\d\d\.json$/.test(path)) return { ok: true, status: 200, json: async () => JSON.parse(read(`public${path}`)) };
    return { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearDomesticCache();
  B.clearFootballSetCache();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['724', '300', '792'],
    settings: { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn({ ...f, calls }); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}

/** The fields of a checkpoint parseCampaign reads, from the App's state. */
function checkpoint(state) {
  const { teams, own, aliveIds, fallen, stats, log, round, matches, queue, batchTotal, history, seed, rngState, settings, initialSettings, campaignId,
    revision, campaignName, startedAt } = state;
  return { teams, own, aliveIds, fallen, stats, log, round, matches, queue, batchTotal, history, seed, rngState, settings, initialSettings, campaignId,
    revision, campaignName, startedAt, phase: 'playing' };
}

test('basketball clubs choose the EuroLeague: its map loads, its 20 clubs launch under its rules, and a save passes the checks', async () => {
  await withApp(async ({ app, time, calls }) => {
    app.pickSetup('sport', 'basketball');
    app.pickSetup('layer', 'clubs');
    assert.equal(app.state.setup.clubScope, 'domestic:nba');
    app.pickSetup('clubScope', EUROLEAGUE_SCOPE);
    assert.equal(app.state.setup.clubScope, EUROLEAGUE_SCOPE, 'the EuroLeague stays chosen');
    const loading = buildSetupModel(app.state.setup, { domestic: app.domesticStatus() });
    assert.deepEqual(loading.scopes.map(scope => [scope.id, scope.label, scope.count]), [['domestic:nba', 'NBA', 30], [EUROLEAGUE_SCOPE, 'EuroLeague', 20]]);
    assert.equal(loading.scopeName, 'EuroLeague · Europe');
    assert.match(loading.countryNote, /^Olympiacos, Panathinaikos and Dubai Basketball lead the 20 EuroLeague clubs, each on land in its own country: .* A country with no club stays grey\.$/);
    assert.deepEqual([loading.country.clubs, loading.country.countries], [20, 10]);
    assert.match(loading.preview.duration, /^about \d+–\d+ min/);
    time.advance(200);
    await app.loadCountry('euroleague');
    await settle();
    assert.ok(calls.includes('/domestic/euroleague.json'));
    const ready = buildSetupModel(app.state.setup, { domestic: app.domesticStatus() });
    assert.equal(ready.canLaunch, true);
    assert.equal(ready.count, 20);

    app.startCampaign();
    const { state } = app;
    assert.equal(state.phase, 'playing');
    assert.equal(state.settings.domesticVersion, DOC.version);
    assert.deepEqual(state.aliveIds.slice().sort(), CLUBS.map(c => c.id).sort());
    assert.ok(Object.values(state.teams).every(team => state.own[team.home] === team.id && team.sport === 'basketball' && team.squad.every(isEstimated)));
    assert.equal(state.campaignName, 'Basketball · EuroLeague · Europe');
    // The App bundles its own copy of the sports, so the EuroLeague's rulebook is checked by what it is.
    assert.deepEqual([app.sport().clock.length, app.sport().simulationVersion], [40, euroleagueBasketball.simulationVersion],
      'its matches are the EuroLeague\'s');
    assert.equal(app.territoryName(state.teams['el-real-madrid'].home), 'Madrid');
    assert.doesNotThrow(() => parseCampaign(JSON.stringify({ v: 2, ...checkpoint(state) })), 'a save of it passes the checks');

    // An earlier season offers its NBA era's map and its own EuroLeague's, and keeps the EuroLeague; the built-in season
    // again offers both, and a season before 2000/01 its NBA map alone.
    app.openSetup();
    app.pickSetup('dataSet', 'nba-2k08');
    assert.equal(app.state.setup.clubScope, 'domestic:el2008');
    assert.deepEqual(buildSetupModel(app.state.setup, { season: app.seasonStatus() }).scopes.map(scope => scope.id), ['domestic:nba2008', 'domestic:el2008']);
    app.pickSetup('dataSet', null);
    assert.equal(app.state.setup.clubScope, EUROLEAGUE_SCOPE);
    app.pickSetup('dataSet', 'nba-live-99');
    assert.equal(app.state.setup.clubScope, 'domestic:nba1999');
    app.pickSetup('dataSet', null);
    app.pickSetup('clubScope', 'domestic:nba');
    assert.equal(app.state.setup.clubScope, 'domestic:nba');
    // Another sport leaves the EuroLeague's map.
    app.pickSetup('clubScope', EUROLEAGUE_SCOPE);
    app.pickSetup('sport', 'football');
    assert.equal(app.state.setup.clubScope, 'domestic:eu124');
  });
});

test('the setup and a challenge link keep the EuroLeague; another sport has none', () => {
  const clubs = over => ({ sport: 'basketball', layer: 'clubs', dataSet: null, ...over });
  assert.equal(setClubScope(clubs({ clubScope: EUROLEAGUE_SCOPE })), EUROLEAGUE_SCOPE);
  assert.equal(setClubScope(clubs({ clubScope: 'all' })), 'domestic:nba');
  // An earlier season keeps the EuroLeague, its own; the NBA, its era's; and before 2000/01 has the NBA alone.
  assert.equal(setClubScope(clubs({ clubScope: EUROLEAGUE_SCOPE, dataSet: 'nba-2k20' })), 'domestic:el2020');
  assert.equal(setClubScope(clubs({ clubScope: 'domestic:el2010', dataSet: 'nba-2k21' })), 'domestic:el2020', '2019/20 and 2020/21 share a map');
  assert.equal(setClubScope(clubs({ clubScope: 'domestic:nba', dataSet: 'nba-2k20' })), 'domestic:nba');
  assert.equal(setClubScope(clubs({ clubScope: 'domestic:el2010', dataSet: 'nba-2k10' })), 'domestic:el2010');
  assert.equal(setClubScope(clubs({ clubScope: 'domestic:el2010', dataSet: null })), EUROLEAGUE_SCOPE, 'back to the built-in EuroLeague');
  assert.equal(setClubScope(clubs({ clubScope: EUROLEAGUE_SCOPE, dataSet: 'nba-live-99' })), 'domestic:nba1999');
  assert.equal(setClubScope(clubs({ clubScope: 'all', dataSet: 'nba-2k10' })), 'domestic:nba2009', 'no theatre chosen: the season\'s NBA map');
  assert.equal(setClubScope({ sport: 'hockey', layer: 'clubs', clubScope: EUROLEAGUE_SCOPE }), 'domestic:nhl');
  assert.deepEqual(theatreMapsOf('basketball').map(map => map.id), ['nba', 'euroleague']);
  assert.deepEqual(theatreMapsOf('basketball', 'nba-2k08').map(map => map.id), ['nba2008', 'el2008'], 'an earlier season: its era\'s NBA map and its EuroLeague');
  assert.deepEqual(theatreMapsOf('basketball', 'nba-2k20').map(map => map.id), ['nba', 'el2020'], 'a season on today\'s NBA map');
  assert.deepEqual(theatreMapsOf('basketball', 'nba-2k00').map(map => map.id), ['nba2000'], '1999/00: the NBA alone');
  assert.deepEqual([clubMapOf('hockey')?.id, theatreMapsOf('hockey')], ['nhl', []]);
  const query = challengeQuery(clubs({ clubScope: EUROLEAGUE_SCOPE, seed: '9' }), 9);
  assert.match(query, /theatre=domestic:euroleague/);
  const back = readChallenge(`?${query}`);
  assert.deepEqual([back.setup.sport, back.setup.layer, back.setup.clubScope, back.ignored], ['basketball', 'clubs', EUROLEAGUE_SCOPE, []]);
  const hockey = readChallenge('?sport=hockey&teams=clubs&theatre=domestic:euroleague');
  assert.deepEqual([hockey.setup.clubScope, hockey.ignored], ['domestic:nhl', ['theatre']]);
});

// ---------- the earlier seasons ----------

const EARLIER = euroleagueSeasons(fileURLToPath(new URL('..', import.meta.url)));
const seasonOfYear = year => EARLIER.seasons.find(season => season.year === year);
const nbaSeasonOf = year => BUILT_IN_BASKETBALL_SEASONS.find(set => set.year === year + 1);
const mean = list => list.reduce((sum, value) => sum + value, 0) / list.length;
const regularShare = club => club.regular[0] / club.regular[1];

test('every season from 2000/01 to 2025/26 has its EuroLeague: the API\'s clubs, each with its best five of estimates', () => {
  assert.deepEqual(EARLIER.seasons.map(season => season.season), Array.from({ length: 26 }, (_, i) => `${2000 + i}/${String(2001 + i).slice(2)}`));
  assert.deepEqual(EARLIER.seasons.map(season => season.clubs.length),
    [24, 32, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 16, 16, 16, 18, 18, 18, 18, 18, 18, 20]);
  let stretched = 0;
  for (const season of EARLIER.seasons) {
    const snapshot = EARLIER.snapshots[season.year];
    assert.deepEqual(season.clubs.map(club => club.source).sort(), snapshot.clubs.map(club => club.code).sort(), `${season.season}: the API's clubs`);
    assert.equal(new Set(snapshot.players.map(row => row[0])).size, snapshot.players.length, `${season.season}: each player counts once`);
    assert.ok(snapshot.players.length > 6 * season.clubs.length, `${season.season}: every player with a game, not the leaderboard's`);
    for (const club of season.clubs) {
      assert.match(club.id, /^el-[a-z0-9-]+$/);
      assert.match(club.code, /^[A-Z]{3}$/);
      assert.ok(NATIONS[club.country], `${club.name} plays in a game nation`);
      assert.equal(club.squad.length, 5);
      assert.equal(club.str, Math.round(club.squad.reduce((sum, p) => sum + p[2], 0) / 5));
      for (const [name, positions, rating] of club.squad) {
        assert.ok(name && !/[A-Z]{4}/.test(name), `${season.season} ${club.name}: ${name}`);
        assert.match(positions, /^(PG|SG|SF|PF|C)(\/(PG|SG|SF|PF|C))?$/);
        assert.ok(rating >= RATING_RANGE[0] && rating <= RATING_RANGE[1]);
      }
    }
    stretched += season.warnings.filter(warning => /out of position/.test(warning)).length;
    assert.deepEqual(season.warnings.filter(warning => !/out of position/.test(warning)), [], season.season);
  }
  // Assists counted sparingly in the 2000s would leave many fives with no point guard; on 2025/26's level, few do.
  assert.ok(stretched <= 10, `${stretched} fives play someone out of position`);
});

test('earlier seasons are rated by the built-in season\'s rule, each season\'s box scores put on 2025/26\'s level', () => {
  assert.equal(REFERENCE_SEASON, 2025);
  assert.deepEqual(seasonScale(EARLIER.snapshots, 2025), { pir: 1, reb: 1, ast: 1, tpa: 1 });
  // 2010/11: the average team's PIR 77.3 a game against 2025/26's 95.2, its assists 13.7 against 18.8.
  const scale = seasonScale(EARLIER.snapshots, 2010);
  assert.ok(Math.abs(scale.pir - 95.2 / 77.3) < 1e-9 && Math.abs(scale.ast - 18.8 / 13.7) < 1e-9);
  const rhos = [];
  for (const season of EARLIER.seasons) {
    const starters = mean(season.clubs.flatMap(club => club.squad.map(p => p[2])));
    assert.ok(starters > 75.5 && starters < 79, `${season.season}: starters rate ${starters.toFixed(1)} on average (the built-in's 76.3)`);
    const strengths = season.clubs.map(club => club.str);
    assert.ok(Math.max(...strengths) - Math.min(...strengths) >= 5 && Math.max(...strengths) - Math.min(...strengths) <= 13, season.season);
    rhos.push(spearman(strengths, season.clubs.map(regularShare)));
  }
  // The box scores rank the clubs about as their regular seasons did, never the other way round.
  rhos.sort((a, b) => a - b);
  assert.ok(rhos[13] >= 0.55 && rhos[0] > 0.25, `Spearman against the regular seasons' records: median ${rhos[13].toFixed(2)}, lowest ${rhos[0].toFixed(2)}`);
  // A player who played for two clubs counts for the one he played the most minutes for.
  const gabriel = EARLIER.snapshots[2024].players.find(row => row[1] === 'GABRIEL, WENYEN');
  assert.deepEqual([gabriel[2], gabriel[7].clubs], ['PAN', { TEL: [9, 136], PAN: [23, 393] }]);
  // EuroLeague files Ülkerspor (2001/02 to 2005/06) under the code Fenerbahçe has played under since.
  assert.ok(seasonOfYear(2005).clubs.some(club => club.id === 'el-ulkerspor' && club.name === 'Ülkerspor'));
  assert.ok(seasonOfYear(2006).clubs.some(club => club.id === 'el-fenerbahce') && !seasonOfYear(2006).clubs.some(club => club.id === 'el-ulkerspor'));
  // Today's clubs keep their identity in every season: Baskonia, never Tau Cerámica.
  assert.ok(EARLIER.seasons.every(season => season.clubs.some(club => club.id === 'el-baskonia' && club.name === 'Baskonia')));
});

test('each season\'s file carries its EuroLeague clubs after the NBA\'s, every one of their ratings marked as an estimate', async () => {
  await loadSportData('basketball');
  for (const season of EARLIER.seasons) {
    const listed = nbaSeasonOf(season.year);
    const doc = JSON.parse(read(`public/basketball/${listed.id}.json`));
    assert.equal(doc.version, listed.version);
    assert.equal(doc.euroleague, season.map, `${listed.id} names its EuroLeague's map`);
    const clubs = doc.clubs.filter(club => club.league === 'EuroLeague');
    assert.deepEqual(clubs, season.clubs.map(({ id, name, code, league, country, col, str, squad }) => ({ id, name, code, league, country, col, str, squad })));
    assert.ok(doc.clubs.slice(0, doc.clubs.length - clubs.length).every(club => club.league === 'NBA'), 'the NBA\'s first');
  }
  for (const set of BUILT_IN_BASKETBALL_SEASONS.filter(entry => entry.year <= 2000)) {
    assert.equal(JSON.parse(read(`public/basketball/${set.id}.json`)).euroleague, undefined, `${set.season}: no EuroLeague before 2000/01`);
  }
  const sport = seasonSport(decodeFootballSet(JSON.parse(read('public/basketball/nba-2k10.json')), 'nba-2k10'));
  const cska = buildClub(sport.clubs.find(club => club.id === 'el-cska-moscow'), sport);
  assert.ok(cska.squad.every(isEstimated), 'the EuroLeague\'s players are estimates');
  assert.match(estimateTitle(cska.squad[0]), /no game rates EuroLeague players/);
  assert.ok(!buildClub(sport.clubs.find(club => club.id === 'b-los-angeles-lakers'), sport).squad.some(isEstimated), 'NBA 2K10\'s are not');
});

test('each run of seasons with the same clubs plays on a map of Europe of its own, Russia\'s clubs on its European part', () => {
  assert.deepEqual(EARLIER.maps.map(map => [map.id, map.years.length]), [['el2001', 1], ['el2002', 1], ['el2003', 1], ['el2004', 1], ['el2005', 1],
    ['el2006', 1], ['el2007', 1], ['el2008', 1], ['el2009', 1], ['el2010', 1], ['el2011', 1], ['el2012', 1], ['el2013', 1], ['el2014', 1],
    ['el2015', 1], ['el2016', 1], ['el2017', 1], ['el2018', 1], ['el2019', 1], ['el2020', 2], ['el2022', 1], ['el2023', 2], ['el2025', 1], ['el2026', 1]]);
  for (const map of EARLIER.maps) {
    const entry = EUROPE_MAPS.find(item => item.id === map.id);
    assert.ok(entry, `${map.id} is in the index`);
    assert.deepEqual([entry.sport, entry.league, entry.theatre, entry.seasons], ['basketball', 'EuroLeague', undefined, map.years.map(year => nbaSeasonOf(year).id)]);
    const text = read(`public/domestic/${map.id}.json`);
    const doc = JSON.parse(text);
    assert.equal(doc.version, entry.version);
    assert.deepEqual(doc.clubs.map(club => [club.id, club.name]), map.clubs.map(club => [club.id, club.name]), `${map.id}: the clubs, strongest first`);
    assert.deepEqual([...doc.hosts].sort(), [...new Set(map.clubs.map(club => club.country))].sort());
    assert.equal(decodeDomestic(JSON.parse(text), map.id).clubs.length, map.clubs.length);
    assert.deepEqual(doc.partial, doc.hosts.includes('643') ? ['643'] : undefined, `${map.id}: European Russia only, the rest of Russia beneath`);
  }
  // 2019/20 and 2020/21 had the same eighteen clubs, as had 2022/23 and 2023/24.
  assert.deepEqual(EUROPE_MAPS.find(entry => entry.id === 'el2020').seasons, ['nba-2k20', 'nba-2k21']);
  assert.deepEqual(EUROPE_MAPS.find(entry => entry.id === 'el2023').seasons, ['nba-2k23', 'nba-2k24']);
  assert.equal(domesticLabel('domestic:el2010'), 'EuroLeague · Europe');
});

test('seeded duel campaigns on earlier EuroLeague maps reach a champion by land or sea', () => {
  for (const [id, year] of [['el2002', 2001], ['el2001', 2000]]) {
    const map = decodeDomestic(JSON.parse(read(`public/domestic/${id}.json`)), id);
    const { geo } = map;
    const { obstacles } = domesticSurroundings(ATLAS, map);
    const sport = euroleagueBasketballIn(seasonOfYear(year).season);
    const clubs = new Map(seasonOfYear(year).clubs.map(club => [club.id, club]));
    const rng = makeRng(2000 + year);
    const teams = Object.fromEntries(map.clubs.map(row => [row.id, buildClub(clubs.get(row.id), sport)]));
    let own = { ...map.startOwners }, aliveIds = map.clubs.map(row => row.id);
    assert.deepEqual(validateReachability({ geo, own, aliveIds }).unplacedIds, [], id);
    while (aliveIds.length > 1) {
      const draw = createDuelDraw(rng, { geo, routingPaths: geo.paths, own, aliveIds, obstacles, borderRoutes: true }, { speed: 80 });
      assert.ok(draw && draw.attackerId !== draw.targetId, `${id}: every duel resolves`);
      const { winner } = sport.simulate(rng, teams[draw.attackerId], teams[draw.targetId], 6, teamEff(teams[draw.attackerId]), teamEff(teams[draw.targetId]));
      const loser = winner === draw.attackerId ? draw.targetId : draw.attackerId;
      own = { ...own, ...Object.fromEntries(territories({ own }, loser).map(land => [land, winner])) };
      aliveIds = aliveIds.filter(club => club !== loser);
    }
    assert.ok(Object.values(own).every(club => club === aliveIds[0]), `${id}: the champion holds every territory`);
  }
});

test('an earlier season\'s EuroLeague plays FIBA\'s forty minutes at that season\'s pace and scoring rate', () => {
  const settings = over => ({ sport: 'basketball', layer: 'clubs', ...over });
  const sport = matchSport(settings({ clubScope: 'domestic:el2011', dataSeason: '2010/11' }));
  assert.equal(sport, euroleagueBasketballIn('2010/11'));
  assert.equal(matchSport(settings({ clubScope: 'domestic:nba2009', dataSeason: '2010/11' })), nbaBasketballIn('2010/11'));
  assert.equal(matchSport(settings({ clubScope: EUROLEAGUE_SCOPE })), euroleagueBasketball, 'the built-in season plays its own');
  assert.equal(euroleagueBasketballIn('1998/99'), euroleagueBasketball, 'a season without league figures plays the built-in\'s');
  assert.ok(isEuroleagueScope('domestic:el2001') && isEuroleagueScope(EUROLEAGUE_SCOPE) && !isEuroleagueScope('domestic:nba2009') && !isEuroleagueScope('domestic:eu124'));
  const [a, d] = seasonOfYear(2010).clubs.slice(0, 2).map(club => buildClub(club, sport));
  const { pace, rules } = sport.prepareMatch(a, d);
  const league = EUROLEAGUE_LEAGUE_AVERAGES['2010/11'];
  assert.equal(pace, league.pace);
  assert.equal(rules.scoring, Number((1.03 * league.rating / EUROLEAGUE_LEAGUE_AVERAGES['2025/26'].rating).toFixed(3)));
  assert.deepEqual([rules.minutes, rules.home, rules.buzzer], [40, 0.06, [0.1, 0.05]]);
  assert.equal(sport.clock.length, 40);
});

test('an earlier season offers its EuroLeague in setup: its map loads, its clubs launch under its rules, and a save passes the checks', async () => {
  await withApp(async ({ app, time, calls }) => {
    app.pickSetup('sport', 'basketball');
    app.pickSetup('layer', 'clubs');
    app.pickSetup('clubScope', EUROLEAGUE_SCOPE);
    app.pickSetup('dataSet', 'nba-2k10');
    assert.equal(app.state.setup.clubScope, 'domestic:el2010', 'the EuroLeague of 2009/10');
    time.advance(200);
    await Promise.all([app.loadCountry('el2010'), app.loadSet('nba-2k10')]);
    await settle();
    assert.ok(calls.includes('/domestic/el2010.json') && calls.includes('/basketball/nba-2k10.json'));
    const model = buildSetupModel(app.state.setup, { domestic: app.domesticStatus(), season: app.seasonStatus() });
    assert.equal(model.canLaunch, true);
    assert.deepEqual(model.scopes.map(scope => [scope.id, scope.label, scope.count]), [['domestic:nba2009', 'NBA', 30], ['domestic:el2010', 'EuroLeague', 24]]);
    const season = seasonOfYear(2009);
    assert.match(model.countryNote, new RegExp(`^${season.clubs.slice(0, 3).map(club => club.name).join(', ').replace(/, ([^,]*)$/, ' and $1')} lead the 24 EuroLeague clubs`));

    app.startCampaign();
    const { state } = app;
    assert.equal(state.phase, 'playing');
    assert.deepEqual([state.settings.dataSet, state.settings.dataSeason, state.settings.clubScope], ['nba-2k10', '2009/10', 'domestic:el2010']);
    assert.equal(state.settings.domesticVersion, EUROPE_MAPS.find(entry => entry.id === 'el2010').version);
    assert.deepEqual(state.aliveIds.slice().sort(), season.clubs.map(club => club.id).sort());
    assert.ok(Object.values(state.teams).every(team => state.own[team.home] === team.id && team.squad.every(isEstimated)));
    assert.equal(state.campaignName, 'Basketball 2009/10 · EuroLeague · Europe');
    assert.equal(app.territoryName(state.teams['el-cska-moscow'].home), 'Moscow');
    // The App bundles its own copy of the sports, so the season's rulebook is checked by what it is.
    const [a, d] = Object.values(state.teams);
    assert.deepEqual([app.sport().clock.length, app.sport().prepareMatch(a, d).pace], [40, EUROLEAGUE_LEAGUE_AVERAGES['2009/10'].pace]);
    const text = JSON.stringify({ v: 2, ...checkpoint(state) });
    assert.doesNotThrow(() => parseCampaign(text), 'a save of it passes the checks');
    const edited = edit => { const data = JSON.parse(text); edit(data.settings); edit(data.initialSettings); return JSON.stringify(data); };
    const onMap = id => s => { s.clubScope = `domestic:${id}`; s.domesticVersion = EUROPE_MAPS.find(entry => entry.id === id).version; };
    assert.throws(() => parseCampaign(edited(onMap('el2020'))), /Campaign data set is invalid/, 'another season\'s EuroLeague');
    assert.throws(() => parseCampaign(edited(onMap('euroleague'))), /Campaign data set is invalid/, 'the built-in season\'s');
    assert.doesNotThrow(() => parseCampaign(edited(s => { s.clubScope = 'domestic:nba2009'; s.domesticVersion = CLUB_MAPS.find(entry => entry.id === 'nba2009').version; })),
      'its own NBA map');
  });
});

test('a challenge link carries an earlier season\'s EuroLeague; another season\'s map becomes the season\'s own', () => {
  const query = challengeQuery({ sport: 'basketball', layer: 'clubs', dataSet: 'nba-2k10', clubScope: 'domestic:el2010', seed: '9' }, 9);
  assert.match(query, /season=nba-2k10/);
  assert.match(query, /theatre=domestic:el2010/);
  const back = readChallenge(`?${query}`);
  assert.deepEqual([back.setup.dataSet, back.setup.layer, back.setup.clubScope, back.ignored], ['nba-2k10', 'clubs', 'domestic:el2010', []]);
  assert.equal(readChallenge('?sport=basketball&teams=clubs&season=nba-2k20&theatre=domestic:el2010').setup.clubScope, 'domestic:el2020');
  assert.equal(readChallenge('?sport=basketball&teams=clubs&season=nba-2k00&theatre=domestic:el2010').setup.clubScope, 'domestic:nba2000', '1999/00 has no EuroLeague');
});

// ---------- EuroBasket ----------

test('EuroBasket is a basketball nation theatre of the 24 nations of EuroBasket 2025, each with a real five', () => {
  assert.equal(new Set(EUROBASKET_2025).size, 24);
  for (const id of EUROBASKET_2025) {
    assert.ok(NATIONS[id], `${id} is a game nation`);
    const roster = ROSTERS[id];
    assert.ok(roster, `${NATIONS[id][0]} fields a curated five`);
    assert.equal(roster[1], 5, `${NATIONS[id][0]}: five real players`);
    const team = buildTeam(id, makeRng(1), basketball);
    assert.equal(team.real, 5);
    assert.ok(team.squad.every(player => !player.gen), `${NATIONS[id][0]}: nobody generated`);
    assert.ok(selectLineup(team).slots.every(slot => !slot.outOfPosition), `${NATIONS[id][0]}: nobody out of position`);
  }
  const ids = sport => nationTheatres(getSport(sport)).map(scope => scope.id);
  assert.deepEqual(ids('basketball'), ['world', 'UEFA', 'eurobasket', 'CAF', 'AFC', 'CONCACAF', 'elite'], 'South America: too few real fives');
  for (const sport of ['football', 'womens-football', 'baseball', 'hockey']) assert.ok(!ids(sport).includes('eurobasket'), sport);
  assert.equal(SCOPES.find(scope => scope.id === 'eurobasket').name, 'EuroBasket');
  const model = buildSetupModel({ sport: 'basketball', layer: 'nations', scope: 'eurobasket', role: 'spectator' }, {});
  assert.deepEqual(model.scopes.map(scope => scope.id), ids('basketball'));
  assert.equal(model.scopes.find(scope => scope.id === 'eurobasket').count, 24);
  assert.equal(model.scopeName, 'EuroBasket');
  assert.match(model.status, /^24 nations · 23 matches · /);
  // Football offers no EuroBasket: a setup still naming it shows football's heartland.
  assert.equal(buildSetupModel({ sport: 'football', layer: 'nations', scope: 'eurobasket' }, {}).scopeName, 'Europe');
});

test('a EuroBasket campaign launches its 24 nations on their homelands; another sport plays its own Europe', async () => {
  await withApp(async ({ app }) => {
    app.pickSetup('sport', 'basketball');
    app.pickSetup('scope', 'eurobasket');
    assert.equal(app.state.setup.scope, 'eurobasket');
    const { included, own, scopeName } = app.opening(app.state.setup, makeRng(5));
    assert.deepEqual(included.map(team => team.id).sort(), EUROBASKET_2025.slice().sort());
    assert.ok(included.every(team => own[team.id] === team.id));
    assert.equal(scopeName, 'EuroBasket');
    // A football link to it is not a football theatre.
    assert.deepEqual(readChallenge('?theatre=eurobasket').ignored, ['theatre']);
    assert.equal(readChallenge('?sport=basketball&theatre=eurobasket').setup.scope, 'eurobasket');
    // Football keeps the choice but plays its heartland, Europe; basketball finds EuroBasket again.
    app.pickSetup('sport', 'football');
    assert.equal(app.state.setup.scope, 'eurobasket');
    const football = app.opening(app.state.setup, makeRng(5));
    assert.equal(football.scopeName, 'Europe');
    assert.ok(football.included.length > 24 && football.included.every(team => NATIONS[team.id][2] === 'UEFA'), 'Europe\'s football nations');
    app.pickSetup('sport', 'basketball');
    assert.equal(app.opening(app.state.setup, makeRng(5)).scopeName, 'EuroBasket');
  });
});

test('EuroBasket\'s new fives: the seven nations that had none field their EuroBasket 2025 players', () => {
  const names = id => ROSTERS[id][2].map(([name]) => name);
  assert.ok(names('620').includes('Neemias Queta'), 'Portugal');
  assert.ok(names('752').includes('Pelle Larsson'), 'Sweden');
  assert.ok(names('233').includes('Kristian Kullamae'), 'Estonia');
  assert.ok(names('826').includes('Myles Hesson'), 'Great Britain, the United Kingdom\'s shape');
  assert.ok(names('196').includes('Darral Willis'), 'Cyprus');
  assert.ok(names('056').includes('Ismael Bako'), 'Belgium');
  assert.ok(names('352').includes('Tryggvi Hlinason'), 'Iceland');
  // NBA players are rated by NBA 2K27, as everywhere in the national fives.
  const queta = ROSTERS['620'][2].find(([name]) => name === 'Neemias Queta');
  assert.ok(queta[2] >= 75, 'Queta is rated by NBA 2K');
  assert.equal(getSport('basketball').rosters, ROSTERS);
});
