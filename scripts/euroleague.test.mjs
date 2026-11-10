// Basketball's European competitions (docs/design/euroleague.md): the EuroLeague's 20 clubs, rebuilt from the committed
// snapshot with every rating an estimate from the player's EuroLeague box scores, on their own map of Europe under the
// EuroLeague's rules; and EuroBasket 2025's 24 nations as a basketball nation theatre, every one with a real five.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { feature } from 'topojson-client';
import { CLUBS } from '../src/data/clubs.euroleague.js';
import { CLUBS as NBA_CLUBS } from '../src/data/clubs.basketball.js';
import { ROSTERS } from '../src/data/rosters.basketball.js';
import { EUROPE_MAPS } from '../src/data/europeMaps.js';
import { EUROBASKET_2025, NATIONS, SCOPES, buildClub, buildTeam, makeRng, nationScopes, selectLineup, teamEff } from '../src/data/teams.js';
import { clubMapsOf, domesticLabel } from '../src/data/domesticScope.js';
import { estimateReason, estimateTitle, isEstimated } from '../src/data/estimates.js';
import { EUROLEAGUE_SCOPE, basketball, euroleagueBasketball, nbaBasketball } from '../src/sports/basketball.js';
import { getSport, matchSport } from '../src/sports/index.js';
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

    // An earlier season has NBA clubs only, on its era's map; the built-in season again offers both.
    app.openSetup();
    app.pickSetup('dataSet', 'nba-2k08');
    assert.equal(app.state.setup.clubScope, 'domestic:nba2008');
    assert.deepEqual(buildSetupModel(app.state.setup, { season: app.seasonStatus() }).scopes.map(scope => scope.id), ['domestic:nba2008']);
    app.pickSetup('dataSet', null);
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
  assert.equal(setClubScope(clubs({ clubScope: EUROLEAGUE_SCOPE, dataSet: 'nba-2k20' })), 'domestic:nba', 'an earlier season is NBA clubs only');
  assert.equal(setClubScope({ sport: 'hockey', layer: 'clubs', clubScope: EUROLEAGUE_SCOPE }), 'domestic:nhl');
  assert.deepEqual(clubMapsOf('basketball').map(map => map.id), ['nba', 'euroleague']);
  assert.deepEqual(clubMapsOf('basketball', 'nba2008').map(map => map.id), ['nba2008']);
  assert.deepEqual(clubMapsOf('hockey').map(map => map.id), ['nhl']);
  const query = challengeQuery(clubs({ clubScope: EUROLEAGUE_SCOPE, seed: '9' }), 9);
  assert.match(query, /theatre=domestic:euroleague/);
  const back = readChallenge(`?${query}`);
  assert.deepEqual([back.setup.sport, back.setup.layer, back.setup.clubScope, back.ignored], ['basketball', 'clubs', EUROLEAGUE_SCOPE, []]);
  const hockey = readChallenge('?sport=hockey&teams=clubs&theatre=domestic:euroleague');
  assert.deepEqual([hockey.setup.clubScope, hockey.ignored], ['domestic:nhl', ['theatre']]);
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
  const ids = sport => nationScopes(sport).map(scope => scope.id);
  assert.deepEqual(ids('basketball'), ['world', 'UEFA', 'eurobasket', 'CONMEBOL', 'CAF', 'AFC', 'CONCACAF', 'elite']);
  for (const sport of ['football', 'womens-football', 'baseball', 'hockey']) assert.ok(!ids(sport).includes('eurobasket'), sport);
  assert.equal(SCOPES.find(scope => scope.id === 'eurobasket').name, 'EuroBasket');
  const model = buildSetupModel({ sport: 'basketball', layer: 'nations', scope: 'eurobasket', role: 'spectator' }, {});
  assert.deepEqual(model.scopes.map(scope => scope.id), ids('basketball'));
  assert.equal(model.scopes.find(scope => scope.id === 'eurobasket').count, 24);
  assert.equal(model.scopeName, 'EuroBasket');
  assert.match(model.status, /^24 nations · 23 matches · /);
  // Football offers no EuroBasket: a setup still naming it shows the first theatre.
  assert.equal(buildSetupModel({ sport: 'football', layer: 'nations', scope: 'eurobasket' }, {}).scopeName, 'World War');
});

test('a EuroBasket campaign launches its 24 nations on their homelands; another sport goes back to Europe', async () => {
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
    app.pickSetup('sport', 'football');
    assert.equal(app.state.setup.scope, 'UEFA', "football's Europe instead");
    const football = app.opening({ ...app.state.setup, scope: 'eurobasket' }, makeRng(5));
    assert.ok(football.included.length > 100, 'a stale EuroBasket plays the world, not basketball\'s field');
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
