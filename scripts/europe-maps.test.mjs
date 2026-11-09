// The Europe maps (docs/design/domestic-campaigns.md, "The Europe maps"): public/domestic/eu*.json against their index,
// the game's clubs and the world map. A club's land lies in its own country; a country's only club holds all of it,
// several clubs share it along its regional borders, and a country with no club stays grey beneath the map. Seeded
// campaigns on the app's board reach a champion, and the running App plays football clubs there while a world campaign
// saved before them stays on the world.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { feature, neighbors } from 'topojson-client';
import { CLUBS } from '../src/data/clubs.football.js';
import { BUILT_IN_SEASONS } from '../src/data/footballSeasons.js';
import { setHasClubs } from '../src/engine/footballSets.js';
import { EUROPE_MAPS } from '../src/data/europeMaps.js';
import { ELITE_CLUBS, TOP_CLUBS, strongestClubs } from '../src/data/scopes.js';
import { europeMapOf, europeMapsOf, isCountryScope, isEuropeScope } from '../src/data/domesticScope.js';
import { buildClub, makeRng, teamEff } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { dataSetOf, domesticIdOf, setClubScope } from '../src/app/shared.js';
import { decodeDomestic, domesticSurroundings } from '../src/engine/domestic.js';
import { territories, validateReachability } from '../src/engine/campaign.js';
import { createDuelDraw } from '../src/engine/duelDraw.js';
import { parseCampaign } from '../src/engine/storage.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { kmBetween, kmToPolys, interiorPoint, pointInPolys, polyAreaKm2, polysAreaKm2, polysOf } from './lib/domestic-partition.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const docOf = id => JSON.parse(read(`public/domestic/${id}.json`));
const setOf = id => JSON.parse(read(`public/football/${id}.json`));
// The earlier seasons with clubs. FIFA 05, FIFA 06 and SWOS 96/97 have nations only, so nothing to put on a map.
const CLUB_SEASONS = BUILT_IN_SEASONS.filter(season => setHasClubs(season.id));
const ATLAS = JSON.parse(read('public/countries-50m.json'));
const WORLD = new Map();
for (const g of ATLAS.objects.countries.geometries) {
  if (!g.type || g.id == null) continue;
  const id = String(g.id);
  WORLD.set(id, [...(WORLD.get(id) || []), ...polysOf(feature(ATLAS, g).geometry)]);
}
const sport = getSport('football');
const TOP = docOf('eu124'), ELITE = docOf('eu32');
const polysOfSection = (doc, i) => polysOf(feature(doc.topology, doc.topology.objects.sections.geometries[i]).geometry);
/** The club whose land holds a point, by name, or null. */
function holder(doc, point) {
  const i = doc.topology.objects.sections.geometries.findIndex((_, k) => pointInPolys(point, polysOfSection(doc, k)));
  return i < 0 ? null : doc.clubs[i].id;
}
const CLUB_ID = name => { const club = CLUBS.find(c => c.name === name); assert.ok(club, name); return club.id; };

const TOWNS = {
  brest: [-4.49, 48.39], strasbourg: [7.75, 48.58], marseille: [5.37, 43.3], bordeaux: [-0.58, 44.84], bastia: [9.45, 42.7],
  // Inland towns, clear of the outlines' coarse coasts.
  hamar: [11.07, 60.79], roros: [11.39, 62.57], karasjok: [25.51, 69.47], knin: [16.2, 44.04], osijek: [18.69, 45.55], sofia: [23.32, 42.7], shumen: [26.93, 43.27],
  wurzburg: [9.93, 49.79], regensburg: [12.1, 49.01], passau: [13.46, 48.57], munich: [11.58, 48.14],
  dresden: [13.74, 51.05], leipzig: [12.37, 51.34], chemnitz: [12.92, 50.83],
  amsterdam: [4.9, 52.37], rotterdam: [4.48, 51.92], brussels: [4.35, 50.85], warsaw: [21.01, 52.23], vienna: [16.37, 48.21], stockholm: [18.07, 59.33],
  bern: [7.45, 46.95], budapest: [19.04, 47.5], belgrade: [20.46, 44.82], dublin: [-6.26, 53.35], moscow: [37.62, 55.75], bucharest: [26.1, 44.43],
};

test('the index lists a built-in pair of maps and one for each earlier season with clubs, each file as its entry says', () => {
  const seasons = [null, ...CLUB_SEASONS.map(season => season.id)];
  assert.equal(EUROPE_MAPS.length, seasons.length * 2);
  for (const season of seasons) {
    assert.deepEqual(europeMapsOf(season).map(map => [map.league, map.clubs, map.theatre]),
      [[`Top ${TOP_CLUBS}`, TOP_CLUBS, 'all'], [`Elite ${ELITE_CLUBS}`, ELITE_CLUBS, 'elite']], String(season));
  }
  const nationsOnly = BUILT_IN_SEASONS.filter(season => !setHasClubs(season.id)).map(season => season.id);
  // The computed World Cup seasons (`wc-<year>`) have nations only too.
  assert.deepEqual(nationsOnly.filter(id => !id.startsWith('wc-')), ['ea-fifa-06', 'ea-fifa-05', 'swos-9697']);
  for (const season of nationsOnly) {
    assert.deepEqual(europeMapsOf(season), [], season);
    assert.deepEqual(setOf(season).clubs, [], `${season} has no clubs`);
  }
  for (const entry of EUROPE_MAPS) {
    const text = read(`public/domestic/${entry.id}.json`);
    assert.ok(Buffer.byteLength(text) <= 250000, `${entry.id} is at most 250 KB`);
    const doc = JSON.parse(text);
    assert.deepEqual({ format: doc.format, sport: doc.sport, league: doc.league, name: doc.name, theatre: doc.theatre, version: doc.version },
      { format: 1, sport: 'football', league: entry.league, name: 'Europe', theatre: entry.theatre, version: entry.version });
    const { version, ...rest } = doc;
    assert.equal(version, `${entry.id}-${createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 8)}`, `${entry.id}: content hash`);
    assert.deepEqual(doc.seasons, entry.seasons, entry.id);
    assert.equal(entry.countries, doc.hosts.length);
    assert.equal(entry.clubs, doc.clubs.length);
  }
  assert.ok(read('public/domestic/ATTRIBUTION-europe.txt').includes(TOP.version), 'the attribution names the maps');
});

test('the field is the strongest clubs of the season: Europe\'s for the built-in one, the seven leagues\' for an earlier one', () => {
  const ids = doc => doc.clubs.map(club => club.id);
  assert.deepEqual(ids(TOP), strongestClubs(CLUBS, TOP_CLUBS).map(club => club.id), 'the whole built-in club list');
  assert.deepEqual(ids(ELITE), strongestClubs(CLUBS, ELITE_CLUBS).map(club => club.id));
  assert.ok(new Set(CLUBS.map(club => club.country)).size > 7, 'more than the seven big leagues');
  for (const season of CLUB_SEASONS) {
    const { clubs } = setOf(season.id);
    assert.deepEqual(ids(docOf(`eu124s${season.year}`)), strongestClubs(clubs, TOP_CLUBS).map(club => club.id), season.id);
    assert.deepEqual(ids(docOf(`eu32s${season.year}`)), strongestClubs(clubs, ELITE_CLUBS).map(club => club.id), season.id);
  }
});

test('a club holds land only in its own country, and every country with a club is fully shared out', () => {
  for (const entry of EUROPE_MAPS) {
    const doc = docOf(entry.id);
    const shapes = [...new Set(doc.clubs.map(club => club.shape))];
    assert.deepEqual([...doc.hosts].sort(), [...shapes].sort(), `${entry.id}: the hosts are the countries with clubs`);
    let total = 0;
    doc.clubs.forEach((club, i) => {
      const own = WORLD.get(club.shape);
      assert.ok(own, `${club.id}: ${club.shape} is a world shape`);
      const polys = polysOfSection(doc, i);
      total += polysAreaKm2(polys);
      for (const poly of polys) {
        if (polyAreaKm2(poly) < 50) continue;
        const point = interiorPoint([poly]);
        assert.ok(pointInPolys(point, own) || kmToPolys(point, own) < 5, `${entry.id}: ${club.id} land at ${point} is outside ${club.shape}`);
      }
    });
    const outline = shapes.reduce((sum, id) => {
      const polys = WORLD.get(id), main = polys.reduce((a, b) => (polyAreaKm2(b) > polyAreaKm2(a) ? b : a));
      return sum + polysAreaKm2(polys.filter(poly => kmBetween(interiorPoint([poly]), interiorPoint([main])) <= 2500));
    }, 0);
    assert.ok(Math.abs(total - outline) / outline < 0.02, `${entry.id}: ${Math.round(total)} km² of land against ${Math.round(outline)} km² of outlines`);
  }
});

test('a country\'s only club holds all of it', () => {
  const psg = CLUB_ID('Paris Saint-Germain');
  assert.equal(ELITE.clubs.filter(club => club.shape === '250').length, 1, 'one French club in the elite');
  for (const town of ['brest', 'strasbourg', 'marseille', 'bordeaux', 'bastia']) assert.equal(holder(ELITE, TOWNS[town]), psg, town);
  const france = polysOfSection(ELITE, ELITE.clubs.findIndex(club => club.id === psg));
  assert.ok(pointInPolys(TOWNS.strasbourg, france));
  for (const [towns, name] of [[['hamar', 'roros', 'karasjok'], 'FK Bodø/Glimt'], [['knin', 'osijek'], 'Dinamo Zagreb'], [['sofia', 'shumen'], 'PFC Ludogorets']]) {
    for (const town of towns) assert.equal(holder(TOP, TOWNS[town]), CLUB_ID(name), town);
  }
});

test('clubs share a country along its regional borders: a region with one club goes whole to it', () => {
  // The elite's Bavaria and Saxony have one club each, and each whole region is that club's.
  for (const town of ['wurzburg', 'regensburg', 'passau', 'munich']) assert.equal(holder(ELITE, TOWNS[town]), CLUB_ID('FC Bayern München'), town);
  for (const town of ['dresden', 'leipzig', 'chemnitz']) assert.equal(holder(ELITE, TOWNS[town]), CLUB_ID('RB Leipzig'), town);
  // A country with several clubs is really divided: even the most crowded club holds land you can see on the map.
  for (const doc of [TOP, ELITE]) doc.clubs.forEach((club, i) => {
    assert.ok(polysAreaKm2(polysOfSection(doc, i)) > 800, `${doc.id}: ${club.id} holds ${Math.round(polysAreaKm2(polysOfSection(doc, i)))} km²`);
  });
});

test('a country with no club stays grey: no section covers it, and it is drawn beneath the map', () => {
  for (const town of ['warsaw', 'vienna', 'stockholm', 'bern', 'budapest', 'belgrade', 'dublin', 'moscow', 'bucharest']) {
    assert.equal(holder(TOP, TOWNS[town]), null, town);
  }
  for (const town of ['amsterdam', 'rotterdam', 'brussels', 'warsaw']) assert.equal(holder(ELITE, TOWNS[town]), null, town);
  const map = decodeDomestic(JSON.parse(JSON.stringify(ELITE)), 'eu32');
  const { shapes, obstacles } = domesticSurroundings(ATLAS, map);
  const drawn = new Set(shapes.map(shape => shape.id));
  for (const id of ['528', '056', '616', '756']) assert.ok(drawn.has(id), `${id} is drawn beneath the map`);
  for (const id of ELITE.hosts) assert.ok(!drawn.has(id), `${id} is on the map itself`);
  assert.ok(obstacles.some(shape => shape.id === '528'), 'and routes go around it');
});

test('neighbouring clubs differ in colour, and each club keeps its crest', () => {
  for (const doc of [TOP, ELITE]) {
    const shared = neighbors(doc.topology.objects.sections.geometries);
    shared.forEach((list, i) => list.forEach(j => assert.notEqual(doc.clubs[i].col, doc.clubs[j].col, `${doc.clubs[i].id} / ${doc.clubs[j].id}`)));
  }
  const borders = neighbors(ELITE.topology.objects.sections.geometries);
  const across = name => borders[ELITE.clubs.findIndex(club => club.id === CLUB_ID(name))].map(i => ELITE.clubs[i].id);
  assert.ok(across('Paris Saint-Germain').includes(CLUB_ID('FC Barcelona')), 'France and Spain share their border, as the world map draws it');
  assert.ok(across('Paris Saint-Germain').includes(CLUB_ID('Borussia Dortmund')) || across('Paris Saint-Germain').includes(CLUB_ID('Bayer 04 Leverkusen')), 'France and Germany too');
});

for (const [name, doc] of [['the Top 124', TOP], ['the Elite 32', ELITE]]) {
  test(`seeded duel campaigns on ${name} reach a champion by land or sea, never by treaty`, () => {
    const map = decodeDomestic(JSON.parse(JSON.stringify(doc)), doc.id);
    const { geo } = map;
    const { obstacles } = domesticSurroundings(ATLAS, map);
    const sectionIds = geo.countries.map(section => section.id);
    for (const seed of [20261107, 5]) {
      const rng = makeRng(seed);
      const teams = Object.fromEntries(map.clubs.map(club => [club.id, buildClub(club, sport)]));
      let own = { ...map.startOwners }, aliveIds = map.clubs.map(club => club.id);
      assert.deepEqual(validateReachability({ geo, own, aliveIds }).unplacedIds, []);
      while (aliveIds.length > 1) {
        const board = { geo, routingPaths: geo.paths, own, aliveIds, obstacles, borderRoutes: true };
        const draw = createDuelDraw(rng, board, { speed: 80 });
        assert.ok(draw && draw.attackerId !== draw.targetId, 'every duel resolves');
        assert.ok(draw.routeKind !== 'neutral-transit' && !draw.transitCountryIds.length, 'grey land is never a transit treaty');
        const { winner } = sport.simulate(rng, teams[draw.attackerId], teams[draw.targetId], 6, teamEff(teams[draw.attackerId]), teamEff(teams[draw.targetId]));
        const loser = winner === draw.attackerId ? draw.targetId : draw.attackerId;
        const taken = territories({ own }, loser);
        own = { ...own, ...Object.fromEntries(taken.map(id => [id, winner])) };
        aliveIds = aliveIds.filter(id => id !== loser);
      }
      assert.deepEqual(Object.keys(own).sort(), [...sectionIds].sort(), 'every territory stays owned');
      assert.ok(Object.values(own).every(id => id === aliveIds[0]), 'the champion holds every territory');
    }
  });
}

test('a football setup always names the map of its theatre and season', () => {
  const clubs = over => ({ sport: 'football', layer: 'clubs', dataSet: null, ...over });
  assert.equal(setClubScope(clubs({ clubScope: 'all' })), 'domestic:eu124');
  assert.equal(setClubScope(clubs({ clubScope: 'elite' })), 'domestic:eu32');
  assert.equal(setClubScope(clubs({ clubScope: 'Premier League' })), 'domestic:eu124', 'one league is no theatre now');
  assert.equal(setClubScope(clubs({ clubScope: 'domestic:826' })), 'domestic:826', 'one country stays');
  assert.equal(setClubScope(clubs({ clubScope: 'domestic:nba' })), 'domestic:eu124', "another sport's map is none of football's");
  assert.equal(setClubScope(clubs({ clubScope: 'domestic:eu32', dataSet: 'ea-fifa-18' })), 'domestic:eu32s2018', 'the elite of the season');
  assert.equal(setClubScope(clubs({ clubScope: 'domestic:eu124s2018', dataSet: null })), 'domestic:eu124', 'back to the built-in season');
  assert.equal(setClubScope(clubs({ clubScope: 'domestic:826', dataSet: 'ea-fifa-18' })), 'domestic:eu124s2018', 'a country map has only built-in clubs');
  assert.equal(setClubScope(clubs({ clubScope: 'elite', dataSet: 'cm0102-2026-05' })), 'elite', 'a set with no maps plays on the world');
  assert.equal(setClubScope(clubs({ clubScope: 'domestic:eu124', dataSet: 'cm0102-2026-05' })), 'all');
  assert.equal(europeMapOf('elite').id, 'eu32');
  assert.ok(isEuropeScope('domestic:eu124') && !isEuropeScope('domestic:826') && !isEuropeScope('all'));
  assert.ok(isCountryScope('domestic:826') && isCountryScope('domestic:999') && !isCountryScope('domestic:eu32') && !isCountryScope('domestic:nba') && !isCountryScope('all'));
  // A season's Europe map keeps the season; a country map plays the built-in data.
  assert.equal(dataSetOf(clubs({ clubScope: 'domestic:eu124s2018', dataSet: 'ea-fifa-18' })), 'ea-fifa-18');
  assert.equal(dataSetOf(clubs({ clubScope: 'domestic:826', dataSet: 'ea-fifa-18' })), null);
  assert.equal(domesticIdOf(clubs({ clubScope: 'domestic:eu32' })), 'eu32');
  assert.equal(domesticIdOf(clubs({ clubScope: 'all' })), null, 'a campaign saved on the world stays there');
});

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearDomesticCache: ['src/engine/domestic.js', 'clearDomesticCache'],
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

async function withApp(fn) {
  const fetch = async url => {
    const path = String(url);
    if (/^\/domestic\/eu[0-9a-z]+\.json$/.test(path)) return { ok: true, status: 200, json: async () => JSON.parse(read(`public${path}`)) };
    if (/^\/football\/ea-[a-z0-9-]+\.json$/.test(path)) return { ok: true, status: 200, json: async () => JSON.parse(read(`public${path}`)) };
    return { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearDomesticCache();
  B.clearFootballSetCache();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['826', '250', '724'],
    settings: { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn(f); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}

test('football clubs set up and launch on the map of Europe, with Top 124 and Elite 32 to choose from', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('layer', 'clubs');
    assert.equal(app.state.setup.clubScope, 'domestic:eu124');
    const loading = buildSetupModel(app.state.setup, { domestic: app.domesticStatus() });
    assert.deepEqual(loading.scopes.map(scope => [scope.id, scope.label, scope.count]), [['domestic:eu124', 'Top 124', 124], ['domestic:eu32', 'Elite 32', 32]]);
    assert.ok(loading.domesticScopes.length > 100, 'one country at a time stays on offer');
    assert.equal(loading.leagueGroup, 'Europe');
    assert.equal(loading.canLaunch, false, 'Launch waits for the map');
    time.advance(200);
    await app.loadCountry('eu124');
    await settle();
    const ready = buildSetupModel(app.state.setup, { domestic: app.domesticStatus() });
    assert.equal(ready.canLaunch, true);
    assert.equal(ready.scopeName, 'Top 124 · Europe');
    assert.equal(ready.count, 124);
    assert.match(ready.countryNote, /^Paris Saint-Germain, .* lead Europe's 124 strongest clubs, each on land in its own country: alone it holds all of it, .*regional borders\. A country with no club stays grey\.$/);

    app.startCampaign();
    const { state } = app;
    assert.equal(state.phase, 'playing');
    assert.equal(state.settings.domesticVersion, TOP.version);
    assert.equal(state.aliveIds.length, 124);
    assert.ok(Object.values(state.teams).every(team => state.own[team.home] === team.id && team.sport === 'football'));
    assert.equal(state.campaignName, 'Football · Top 124 · Europe');
    assert.ok(/\S/.test(app.territoryName(state.teams[CLUB_ID('Real Madrid')].home)));

    // A session length picks between the two; a country map's clubs are the built-in ones, and so on.
    app.openSetup();
    app.pickSetup('preset', 'short');
    assert.equal(app.state.setup.clubScope, 'domestic:eu32');
    app.pickSetup('preset', 'standard');
    assert.equal(app.state.setup.clubScope, 'domestic:eu124');
    app.pickSetup('clubScope', 'domestic:826');
    app.pickSetup('preset', 'short');
    assert.equal(app.state.setup.clubScope, 'domestic:826', 'a session length leaves a chosen country');
  });
});

test('an earlier season plays its own clubs on its own map of Europe, and saves', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('layer', 'clubs');
    app.pickSetup('clubScope', 'domestic:eu32');
    app.pickSetup('dataSet', 'ea-fifa-18');
    assert.equal(app.state.setup.clubScope, 'domestic:eu32s2018', 'the theatre follows the season');
    assert.deepEqual(buildSetupModel(app.state.setup, { season: app.seasonStatus() }).scopes.map(scope => [scope.id, scope.count]),
      [['domestic:eu124s2018', 124], ['domestic:eu32s2018', 32]], 'its maps are known while the season loads');
    time.advance(200);
    await app.loadSet('ea-fifa-18');
    await app.loadCountry('eu32s2018');
    await settle();
    app.startCampaign();
    const { state } = app;
    assert.equal(state.phase, 'playing');
    assert.equal(state.settings.dataSet, 'ea-fifa-18');
    assert.equal(state.settings.domesticVersion, docOf('eu32s2018').version);
    const set = setOf('ea-fifa-18');
    const strongest = strongestClubs(set.clubs, ELITE_CLUBS);
    assert.deepEqual(Object.keys(state.teams).sort(), strongest.map(club => club.id).sort(), "the season's elite");
    const top = strongest[0];
    assert.equal(state.teams[top.id].name, top.name);
    assert.equal(state.teams[top.id].squad.length, top.squad.length, "with the season's own players");
    assert.doesNotThrow(() => parseCampaign(JSON.stringify({ v: 2, ...checkpoint(state) })), 'a save of it passes the checks');
  });
});

/** The fields of a checkpoint parseCampaign reads, from the App's state. */
function checkpoint(state) {
  const { teams, own, aliveIds, fallen, stats, log, round, matches, queue, batchTotal, history, seed, rngState, settings, initialSettings, campaignId, revision, campaignName, startedAt } = state;
  return { teams, own, aliveIds, fallen, stats, log, round, matches, queue, batchTotal, history, seed, rngState, settings, initialSettings, campaignId, revision, campaignName, startedAt, phase: 'playing' };
}

test('a world campaign saved on a theatre of before stays on the world, under its own name', async () => {
  await withApp(async ({ app }) => {
    for (const [clubScope, name] of [['all', 'All Leagues'], ['elite', 'Elite 32'], ['Premier League', 'Premier League']]) {
      assert.equal(app.scopeName({ sport: 'football', layer: 'clubs', clubScope }), name);
      const campaign = { settings: { sport: 'football', layer: 'clubs', clubScope } };
      assert.equal(app.withCampaignMap(campaign, (loaded, fitted) => [loaded, fitted === campaign]).join(), ',true');
    }
  });
});
