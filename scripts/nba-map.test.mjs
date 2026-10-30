// The NBA's own map (docs/design/domestic-campaigns.md, "The NBA map"): public/domestic/nba.json against
// its index, its arenas and the game's basketball clubs; the USA and Canada are its only land, and neighbours
// across their border share it; seeded campaigns on the app's board reach a champion; and the running App
// plays basketball clubs there while a world NBA save stays on the world.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { neighbors } from 'topojson-client';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { CLUBS } from '../src/data/clubs.basketball.js';
import { buildClub, makeRng, teamEff } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { decodeDomestic, domesticSurroundings } from '../src/engine/domestic.js';
import { territories, validateReachability } from '../src/engine/campaign.js';
import { createDuelDraw } from '../src/engine/duelDraw.js';
import { createAttackRouteIndex, routeLandCrossings } from '../src/engine/attackRoutes.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { kmToPolys, polysAreaKm2 } from './lib/domestic-partition.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const TEXT = read('public/domestic/nba.json');
const DOC = JSON.parse(TEXT);
const MAP = decodeDomestic(JSON.parse(TEXT), 'nba');
const ENTRY = CLUB_MAPS.find(entry => entry.id === 'nba');
const ARENAS = JSON.parse(read('scripts/data/nba-arenas.json')).clubs;
const ATLAS = JSON.parse(read('public/countries-50m.json'));
const sport = getSport('basketball');
const { geo } = MAP;
const sectionIds = geo.countries.map(section => section.id);
const colourOf = Object.fromEntries(MAP.clubs.map(club => [club.homeSection, club.col]));

test('the NBA map gives every franchise one territory around its arena, as the index lists it', () => {
  // Today's map; the earlier eras' list their seasons (scripts/nba-seasons.test.mjs).
  assert.deepEqual(CLUB_MAPS.filter(entry => !entry.seasons).map(entry => entry.id), ['nba']);
  assert.deepEqual({ format: DOC.format, sport: DOC.sport, league: DOC.league, name: DOC.name, hosts: DOC.hosts },
    { format: 1, sport: 'basketball', league: 'NBA', name: 'USA and Canada', hosts: ['840', '124'] });
  const { version, ...rest } = DOC;
  assert.equal(version, `nba-${createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 8)}`, 'content-hash version');
  assert.equal(ENTRY.version, version);
  assert.ok(Buffer.byteLength(TEXT) <= 250000, 'small enough to fetch on demand');
  assert.ok(read('public/domestic/ATTRIBUTION-nba.txt').includes(version), 'the attribution names this build');

  // Strongest first, as the section ids run; every franchise once.
  const ranked = CLUBS.slice().sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
  assert.deepEqual(MAP.clubs.map(club => club.id), ranked.map(club => club.id));
  assert.deepEqual(sectionIds, ranked.map((_, i) => `nba-${String(i + 1).padStart(3, '0')}`));
  assert.deepEqual([ENTRY.clubs, ENTRY.sections, ENTRY.top], [CLUBS.length, CLUBS.length, ranked.slice(0, 3).map(club => club.name)]);
  assert.deepEqual(Object.keys(ARENAS).sort(), CLUBS.map(club => club.id).sort(), 'one arena per franchise');
  for (const club of MAP.clubs) {
    const source = CLUBS.find(item => item.id === club.id);
    // The map gives land and colour; the franchise keeps its name, code, strength and five.
    assert.deepEqual([club.name, club.code, club.league, club.str, club.squad], [source.name, source.code, source.league, source.str, source.squad]);
    assert.deepEqual(club.startSections, [club.homeSection]);
    assert.deepEqual(club.homePoint, ARENAS[club.id].home);
    assert.equal(MAP.sectionNames[club.homeSection], ARENAS[club.id].city, 'a territory is named after its city');
    const land = geo.countries.find(section => section.id === club.homeSection).polys;
    assert.ok(kmToPolys(club.homePoint, land) <= 2, `${club.name} plays inside its own territory`);
    const team = buildClub(club, sport);
    assert.equal(team.home, club.homeSection);
    assert.ok(Number.isFinite(teamEff(team)));
  }
});

test('the USA and Canada are all its land; the rest of the world lies beneath, never territory', () => {
  const total = geo.countries.reduce((sum, section) => sum + polysAreaKm2(section.polys), 0);
  assert.ok(Math.abs(total - DOC.boundaries.areaKm2) / DOC.boundaries.areaKm2 < 0.02, 'the sections cover the source units');
  // Nothing south of Florida's keys or across the Bering Strait.
  const lats = geo.countries.flatMap(section => section.polys.flatMap(poly => poly[0].map(([, lat]) => lat)));
  const lons = geo.countries.flatMap(section => section.polys.flatMap(poly => poly[0].map(([lon]) => lon)));
  assert.ok(Math.min(...lats) > 24 && Math.max(...lons) < -50 && Math.min(...lons) >= -180);
  const { shapes, obstacles } = domesticSurroundings(ATLAS, MAP);
  const ids = new Set(shapes.map(shape => shape.id));
  assert.ok(!ids.has('840') && !ids.has('124'), 'the hosts are not drawn beneath their own sections');
  assert.ok(ids.has('484') && ids.has('304'), 'Mexico and Greenland are');
  assert.deepEqual(obstacles, shapes);
});

test('neighbours across the national border share it, and every pair of neighbours differs in colour', () => {
  const name = id => MAP.sectionNames[id];
  const across = id => [...geo.adj[sectionIds[MAP.clubs.findIndex(club => club.id === id)]]].map(name);
  // Toronto meets the Great Lakes franchises by land and river; Portland's Washington and British Columbia are one territory.
  assert.ok(across('b-toronto-raptors').includes('Detroit'));
  assert.ok(across('b-toronto-raptors').includes('New York'));
  const portland = geo.countries.find(section => section.id === MAP.clubs.find(club => club.id === 'b-portland-trail-blazers').homeSection);
  const mainland = portland.polys.reduce((best, poly) => (polysAreaKm2([poly]) > polysAreaKm2([best]) ? poly : best));
  assert.ok(kmToPolys([-120.33, 50.67], [mainland]) === 0 && kmToPolys([-122.7, 45.5], [mainland]) === 0, 'Kamloops and Portland on one landmass');
  const shared = neighbors(DOC.topology.objects.sections.geometries);
  shared.forEach((list, i) => list.forEach(j => assert.notEqual(DOC.clubs[i].col, DOC.clubs[j].col, `${name(sectionIds[i])} / ${name(sectionIds[j])}`)));
  for (const [id, list] of Object.entries(geo.adj)) for (const other of list) assert.notEqual(colourOf[id], colourOf[other]);
});

test('seeded duel campaigns on the app board reach a champion, attacking only by land, sea or across the border', () => {
  const { obstacles } = domesticSurroundings(ATLAS, MAP);
  const routeIndex = createAttackRouteIndex(geo.paths);
  for (const seed of [20261029, 5]) {
    const rng = makeRng(seed);
    const teams = Object.fromEntries(MAP.clubs.map(club => [club.id, buildClub(club, sport)]));
    let own = { ...MAP.startOwners }, aliveIds = MAP.clubs.map(club => club.id);
    assert.deepEqual(validateReachability({ geo, own, aliveIds }).unplacedIds, []);
    while (aliveIds.length > 1) {
      // As App.board() builds it for a map of its own.
      const board = { geo, routingPaths: geo.paths, own, aliveIds, obstacles, borderRoutes: true };
      const draw = createDuelDraw(rng, board, { speed: 80 });
      assert.ok(draw && draw.attackerId !== draw.targetId, 'every duel resolves');
      assert.ok(draw.routeKind !== 'neutral-transit' && !draw.transitCountryIds.length, 'no neutral land, so never a treaty');
      const crossings = draw.routePoints.slice(1).flatMap((point, i) => routeLandCrossings(routeIndex,
        { ax: draw.routePoints[i][0], ay: draw.routePoints[i][1], bx: point[0], by: point[1] }));
      const foreign = crossings.filter(({ countryId }) => own[countryId] !== draw.attackerId);
      assert.ok(foreign.every(({ countryId }) => own[countryId] === draw.targetId), 'a route crosses no third franchise');
      const { winner } = sport.simulate(rng, teams[draw.attackerId], teams[draw.targetId], 6, teamEff(teams[draw.attackerId]), teamEff(teams[draw.targetId]));
      const loser = winner === draw.attackerId ? draw.targetId : draw.attackerId;
      const taken = territories({ own }, loser);
      assert.ok(taken.length > 0);
      own = { ...own, ...Object.fromEntries(taken.map(id => [id, winner])) };
      aliveIds = aliveIds.filter(id => id !== loser);
    }
    assert.deepEqual(Object.keys(own).sort(), [...sectionIds].sort(), 'every territory stays owned');
    assert.ok(Object.values(own).every(id => id === aliveIds[0]), 'the champion holds the USA and Canada');
  }
});

test('the loader takes a sport map\'s clubs from the game, and refuses a club or sport it does not have', () => {
  const broken = edit => { const doc = JSON.parse(TEXT); edit(doc); return () => decodeDomestic(doc, 'nba'); };
  assert.throws(broken(doc => { doc.clubs[0].id = 'b-seattle-supersonics'; }), /clubs\[0\] \("b-seattle-supersonics"\) is not one of the game's basketball clubs/);
  assert.throws(broken(doc => { doc.clubs[1].id = doc.clubs[0].id; }), /clubs\[1\] .* id is duplicated/);
  assert.throws(broken(doc => { doc.sport = 'hockey'; }), /unknown sport "hockey"/);
  assert.throws(broken(doc => { doc.hosts = []; }), /hosts must list world shape ids/);
  assert.throws(broken(doc => { delete doc.clubs[2].col; }), /has no colour/);
});

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearDomesticCache: ['src/engine/domestic.js', 'clearDomesticCache'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

async function withApp(fn, settings = {}) {
  const calls = [];
  const fetch = async url => {
    calls.push(String(url));
    return url === '/domestic/nba.json' ? { ok: true, status: 200, json: async () => JSON.parse(TEXT) }
      : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearDomesticCache();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['840', '124', '484'],
    settings: { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', role: 'spectator', seed: '11', ...settings } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn({ ...f, calls }); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}

test('basketball clubs set up and launch on the NBA map; football clubs keep their own theatres', async () => {
  await withApp(async ({ app, time, calls }) => {
    app.pickSetup('sport', 'basketball');
    app.pickSetup('layer', 'clubs');
    assert.equal(app.state.setup.clubScope, 'domestic:nba', "basketball clubs' one theatre");
    const loading = buildSetupModel(app.state.setup, { domestic: app.domesticStatus() });
    assert.deepEqual(loading.scopes.map(scope => [scope.id, scope.label, scope.count]), [['domestic:nba', 'NBA', 30]]);
    assert.equal(loading.country.name, 'USA and Canada');
    assert.equal(loading.canLaunch, false, 'Launch waits for the map');
    time.advance(200);
    await app.loadCountry('nba');
    await settle();
    assert.deepEqual(calls, ['/domestic/nba.json']);
    const ready = buildSetupModel(app.state.setup, { domestic: app.domesticStatus() });
    assert.equal(app.domesticStatus().state, 'ready');
    assert.equal(ready.canLaunch, true);
    assert.equal(ready.scopeName, 'NBA · USA and Canada');
    assert.match(ready.countryNote, /lead the 30 NBA clubs, each starting on the land nearest its arena: USA and Canada split into 30 territories/);

    app.startCampaign();
    const { state } = app;
    assert.equal(state.phase, 'playing');
    assert.equal(state.settings.domesticVersion, DOC.version);
    assert.deepEqual(Object.keys(state.own).sort(), [...sectionIds].sort(), 'only the USA and Canada are land of its own');
    assert.equal(state.aliveIds.length, 30);
    assert.ok(Object.values(state.teams).every(team => state.own[team.home] === team.id && team.sport === 'basketball'));
    assert.equal(state.campaignName, 'Basketball · NBA · USA and Canada');
    assert.equal(app.territoryName(state.teams['b-boston-celtics'].home), 'Boston');

    // Back to football: the NBA's map is no football theatre.
    app.openSetup();
    app.pickSetup('sport', 'football');
    assert.equal(app.state.setup.clubScope, 'all');
  });
});

test('a world NBA campaign saved before the map still plays on the world', async () => {
  await withApp(async ({ app }) => {
    for (const clubScope of ['all', 'elite', 'NBA']) {
      assert.equal(app.scopeName({ sport: 'basketball', layer: 'clubs', clubScope }), clubScope === 'all' ? 'All Leagues' : clubScope === 'elite' ? 'Elite 32' : 'NBA');
    }
    // withCampaignMap restores a campaign without a map of its own at once, as saved.
    const campaign = { settings: { sport: 'basketball', layer: 'clubs', clubScope: 'NBA' } };
    assert.equal(app.withCampaignMap(campaign, (loaded, fitted) => [loaded, fitted === campaign]).join(), ',true');
  }, { sport: 'basketball', layer: 'clubs', clubScope: 'domestic:nba' });
});
