// Women's football's club maps (docs/design/womens-football.md, docs/design/domestic-campaigns.md "The Europe maps" and
// "The NWSL map"): every European club, or its elite, on a map of Europe where a club's land lies in its own country, and
// the NWSL's clubs on the USA, each in its own state. The rules every Europe map and state map keeps are checked for these
// too in europe-maps.test.mjs and club-maps.test.mjs; here, what is the women's own: the fields, the places, the setup's
// choices, challenge links, campaigns on them, and campaigns saved on the world before them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import { CLUBS } from '../src/data/clubs.womens-football.js';
import { BUILT_IN_WOMENS_SEASONS } from '../src/data/womensFootballSeasons.js';
import { EUROPE_MAPS } from '../src/data/europeMaps.js';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { ELITE_CLUBS, isEuropeanClub, strongestClubs, worldClubTheatreName } from '../src/data/scopes.js';
import { clubMapOf, domesticLabel, theatreMapsOf } from '../src/data/domesticScope.js';
import { buildClub, makeRng, teamEff } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { setHasClubs } from '../src/engine/footballSets.js';
import { dataSetOf, domesticIdOf, setClubScope } from '../src/app/shared.js';
import { decodeDomestic, domesticSurroundings } from '../src/engine/domestic.js';
import { territories, validateReachability } from '../src/engine/campaign.js';
import { createDuelDraw } from '../src/engine/duelDraw.js';
import { parseCampaign } from '../src/engine/storage.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { challengeQuery, readChallenge } from '../src/screens/setup/challenge.js';
import { kmToPolys, pointInPolys, polysOf } from './lib/domestic-partition.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const docOf = id => JSON.parse(read(`public/domestic/${id}.json`));
const seasonOf = id => JSON.parse(read(`public/womens-football/${id}.json`));
const sport = getSport('womens-football');
const CLUB_SEASONS = BUILT_IN_WOMENS_SEASONS.filter(season => setHasClubs(season.id));
const ATLAS = JSON.parse(read('public/countries-50m.json'));
const WORLD = new Map();
for (const g of ATLAS.objects.countries.geometries) {
  if (!g.type || g.id == null) continue;
  WORLD.set(String(g.id), [...(WORLD.get(String(g.id)) || []), ...polysOf(feature(ATLAS, g).geometry)]);
}
const WEU = docOf('weu'), ELITE = docOf('weu32'), NWSL = docOf('nwsl');
const polysOfSection = (doc, i) => polysOf(feature(doc.topology, doc.topology.objects.sections.geometries[i]).geometry);
/** The club whose land holds a point, or null. */
function holder(doc, point) {
  const i = doc.topology.objects.sections.geometries.findIndex((_, k) => pointInPolys(point, polysOfSection(doc, k)));
  return i < 0 ? null : doc.clubs[i].id;
}
const european = clubs => clubs.filter(isEuropeanClub);
const nwslOf = clubs => clubs.filter(club => club.league === 'NWSL');

// Inland towns, clear of the outlines' coarse coasts.
const TOWNS = {
  perth: [-3.43, 56.4], inverness: [-4.22, 57.48], dumfries: [-3.61, 55.07],
  coimbra: [-8.43, 40.21], evora: [-7.91, 38.57], braganca: [-6.76, 41.81],
  brno: [16.61, 49.2], ostrava: [18.29, 49.83], plzen: [13.38, 49.75],
  hamar: [11.07, 60.79], roros: [11.39, 62.57], karasjok: [25.51, 69.47],
  egilsstadir: [-14.4, 65.27], selfoss: [-21.0, 63.93],
  bern: [7.45, 46.95], lugano: [8.95, 46.01], chur: [9.53, 46.85],
  uppsala: [17.64, 59.86], kiruna: [20.22, 67.86], utrecht: [5.12, 52.09], eindhoven: [5.48, 51.44],
  turin: [7.68, 45.07], rome: [12.5, 41.9], florence: [11.25, 43.77],
  brussels: [4.35, 50.85], warsaw: [21.01, 52.23], vienna: [16.37, 48.21], budapest: [19.04, 47.5], dublin: [-6.26, 53.35],
  odense: [10.39, 55.4], tampere: [23.76, 61.5], builth: [-3.4, 52.15],
  // The NWSL's states.
  worcester: [-71.8, 42.26], providence: [-71.41, 41.82], dc: [-77.02, 38.91], sanjose: [-121.89, 37.34], pasadena: [-118.14, 34.15],
  elcajon: [-116.96, 32.79], fresno: [-119.79, 36.74], syracuse: [-76.15, 43.05], columbia: [-92.33, 38.95], wichita: [-97.34, 37.69],
  trenton: [-74.76, 40.22], denver: [-104.99, 39.74],
};
const at = (doc, ...towns) => towns.map(town => holder(doc, TOWNS[town]));

test('each season with clubs has a map of Europe for every European club, one for the elite where there are more, and the NWSL\'s', () => {
  assert.deepEqual(theatreMapsOf('womens-football').map(map => [map.id, map.league, map.clubs]),
    [['weu', 'Europe', 68], ['weu32', `Elite ${ELITE_CLUBS}`, 32], ['nwsl', 'NWSL', 16]]);
  assert.deepEqual(CLUB_SEASONS.map(season => season.id), ['eaw-fc-26', 'eaw-fc-25', 'eaw-fc-24', 'eaw-fifa-23']);
  for (const season of CLUB_SEASONS) {
    const { clubs } = seasonOf(season.id);
    const maps = theatreMapsOf('womens-football', season.id);
    const expected = [[`weus${season.year}`, european(clubs).length]];
    if (european(clubs).length > ELITE_CLUBS) expected.push([`weu32s${season.year}`, ELITE_CLUBS]);
    if (nwslOf(clubs).length) expected.push([`nwsls${season.year}`, nwslOf(clubs).length]);
    assert.deepEqual(maps.map(map => [map.id, map.clubs]), expected, season.id);
    for (const map of maps) assert.deepEqual(map.seasons, [season.id]);
  }
  assert.deepEqual(theatreMapsOf('womens-football', 'eaw-fifa-23').map(map => map.id), ['weus2023'], 'FIFA 23 rated the WSL and D1 Arkema only');
  for (const season of BUILT_IN_WOMENS_SEASONS.filter(season => !setHasClubs(season.id))) {
    assert.deepEqual(theatreMapsOf('womens-football', season.id), [], `${season.id} has national teams only`);
  }
  // None is a map the sport always plays, as the NBA's is basketball's; nor is any of them football's.
  assert.equal(clubMapOf('womens-football'), null);
  assert.ok(theatreMapsOf('football').every(map => map.sport === 'football'));
  assert.ok([...EUROPE_MAPS, ...CLUB_MAPS].filter(map => map.sport === 'womens-football').every(map => map.top?.length === 3),
    'each names its own strongest clubs, as only some of its season\'s are on it');
});

test('the fields: every European club, the 32 strongest of them, and the NWSL\'s, strongest first', () => {
  const ids = doc => doc.clubs.map(club => club.id);
  assert.deepEqual(ids(WEU), strongestClubs(european(CLUBS), CLUBS.length).map(club => club.id));
  assert.deepEqual(ids(ELITE), strongestClubs(european(CLUBS), ELITE_CLUBS).map(club => club.id));
  assert.deepEqual(ids(NWSL).slice().sort(), nwslOf(CLUBS).map(club => club.id).sort());
  assert.equal(WEU.clubs.length + NWSL.clubs.length, CLUBS.length, 'every club plays somewhere');
  for (const season of CLUB_SEASONS) {
    const { clubs } = seasonOf(season.id);
    assert.deepEqual(ids(docOf(`weus${season.year}`)), strongestClubs(european(clubs), clubs.length).map(club => club.id), season.id);
    if (european(clubs).length > ELITE_CLUBS) {
      assert.deepEqual(ids(docOf(`weu32s${season.year}`)), strongestClubs(european(clubs), ELITE_CLUBS).map(club => club.id), season.id);
    }
    if (nwslOf(clubs).length) {
      const doc = docOf(`nwsls${season.year}`);
      assert.deepEqual(ids(doc), nwslOf(clubs).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name)).map(club => club.id), season.id);
      assert.deepEqual(doc.clubs.map(club => club.name), doc.clubs.map(club => clubs.find(c => c.id === club.id).name), 'by the season\'s names');
    }
  }
});

test('every European club stands in its own country, at its own ground', () => {
  const places = JSON.parse(read('scripts/data/europe-clubs.json')).clubs;
  const clubs = [...CLUBS, ...CLUB_SEASONS.flatMap(season => seasonOf(season.id).clubs)].filter(isEuropeanClub);
  for (const club of new Map(clubs.map(c => [c.id, c])).values()) {
    const place = places[club.id];
    assert.ok(place, `${club.id} has a place`);
    assert.ok(place.city && place.source, club.id);
    const own = WORLD.get(place.shape ?? club.country);
    assert.ok(pointInPolys(place.home, own) || kmToPolys(place.home, own) < 5, `${club.id}: ${place.home} is in ${club.country}`);
  }
  assert.equal(places['w-manchester-united'].city, 'Leigh', 'the women\'s ground, not Old Trafford');
  const stadiums = JSON.parse(read('scripts/data/nwsl-teams.json'));
  assert.deepEqual(Object.keys(stadiums.teams).sort(), nwslOf(CLUBS).map(club => club.id).sort());
});

test('a country\'s only club holds all of it; one with none stays grey', () => {
  const only = (doc, name, towns) => {
    const id = doc.clubs.find(club => (club.name ?? CLUBS.find(c => c.id === club.id).name) === name)?.id ?? CLUBS.find(c => c.name === name).id;
    assert.deepEqual(at(doc, ...towns), towns.map(() => id), `${doc.id}: ${name}`);
  };
  only(WEU, 'Glasgow City FC', ['perth', 'inverness', 'dumfries']);
  only(WEU, 'SL Benfica', ['coimbra', 'evora', 'braganca']);
  only(WEU, 'Slavia Praha', ['brno', 'ostrava', 'plzen']);
  only(WEU, 'SK Brann', ['hamar', 'roros', 'karasjok']);
  only(WEU, 'Breidablik', ['egilsstadir', 'selfoss']);
  only(WEU, 'FC Zürich', ['bern', 'lugano', 'chur']);
  // Two clubs share a country along its regional borders.
  const shared = (doc, names, towns) => {
    const ids = names.map(name => CLUBS.find(c => c.name === name).id);
    for (const owner of at(doc, ...towns)) assert.ok(ids.includes(owner), `${doc.id}: ${towns} → ${owner}`);
  };
  shared(WEU, ['BK Häcken', 'FC Rosengård'], ['uppsala', 'kiruna']);
  shared(WEU, ['FC Twente', 'Ajax'], ['utrecht', 'eindhoven']);
  shared(WEU, ['Juventus', 'Roma'], ['turin', 'rome', 'florence']);
  assert.deepEqual(at(WEU, 'turin', 'rome'), ['w-juventus', 'w-roma']);
  for (const doc of [WEU, ELITE]) assert.deepEqual(at(doc, 'brussels', 'warsaw', 'vienna', 'budapest', 'dublin', 'odense', 'tampere', 'builth'), Array(8).fill(null), doc.id);
  // The elite's clubs are in six countries; the rest of Europe is grey.
  assert.deepEqual([...ELITE.hosts].sort(), ['250', '276', '380', '724', '752', '826']);
  assert.deepEqual(at(ELITE, 'perth', 'coimbra', 'brno', 'hamar', 'bern', 'utrecht'), Array(6).fill(null));
  const map = decodeDomestic(JSON.parse(JSON.stringify(ELITE)), 'weu32');
  const drawn = new Set(domesticSurroundings(ATLAS, map).shapes.map(shape => shape.id));
  for (const id of ['528', 'SCO', '620', '756']) assert.ok(drawn.has(id), `${id} is drawn beneath the map`);
});

test('the NWSL\'s clubs hold their stadiums\' states: California split three ways, Boston Legacy Massachusetts and Rhode Island', () => {
  const id = name => CLUBS.find(club => club.name === name).id;
  assert.deepEqual(at(NWSL, 'sanjose', 'pasadena', 'elcajon'), [id('Bay FC'), id('Angel City FC'), id('San Diego Wave')]);
  assert.ok([id('Bay FC'), id('Angel City FC'), id('San Diego Wave')].includes(holder(NWSL, TOWNS.fresno)));
  assert.deepEqual(at(NWSL, 'worcester', 'providence'), [id('Boston Legacy FC'), id('Boston Legacy FC')]);
  assert.deepEqual(at(NWSL, 'dc', 'trenton', 'columbia', 'denver'), [id('Washington Spirit'), id('Gotham FC'), id('Kansas City Current'), id('Denver Summit FC')]);
  assert.deepEqual(at(NWSL, 'syracuse', 'wichita'), [null, null], 'New York and Kansas have no club');
  // In 2023 (EA FC 24) the Current played in Kansas City, Kansas, and Boston and Denver had no club.
  const old = docOf('nwsls2024');
  assert.deepEqual(at(old, 'wichita', 'columbia', 'worcester', 'denver'), [id('Kansas City Current'), null, null, null]);
});

test('a women\'s setup names the map of its theatre and season', () => {
  const clubs = over => ({ sport: 'womens-football', layer: 'clubs', dataSet: null, ...over });
  const cases = [
    ['all', null, 'weu'], ['elite', null, 'weu32'], ['NWSL', null, 'nwsl'],
    // The league theatres of before play every European club; a map of another season or sport finds its counterpart.
    ["Women's Super League", null, 'weu'], ['Liga F', null, 'weu'], ['domestic:weu32s2025', null, 'weu32'], ['domestic:eu32', null, 'weu32'],
    ['domestic:nba', null, 'weu'], ['domestic:826', null, 'weu'],
    ['domestic:weu32', 'eaw-fc-25', 'weu32s2025'], ['domestic:nwsl', 'eaw-fc-24', 'nwsls2024'], ['all', 'eaw-fc-26', 'weus2026'],
    // FIFA 23 has every European club only.
    ['domestic:nwsl', 'eaw-fifa-23', 'weus2023'], ['elite', 'eaw-fifa-23', 'weus2023'],
  ];
  for (const [clubScope, dataSet, map] of cases) assert.equal(setClubScope(clubs({ clubScope, dataSet })), `domestic:${map}`, `${clubScope} ${dataSet}`);
  assert.equal(setClubScope({ sport: 'football', layer: 'clubs', clubScope: 'domestic:weu32' }), 'domestic:eu32', 'and back to football\'s elite');
  assert.equal(setClubScope({ sport: 'football', layer: 'clubs', clubScope: 'domestic:nwsl' }), 'domestic:eu124');
  assert.equal(setClubScope({ sport: 'basketball', layer: 'clubs', clubScope: 'domestic:nwsl' }), 'domestic:nba');
  assert.equal(domesticIdOf(clubs({ clubScope: 'domestic:nwsl' })), 'nwsl');
  assert.equal(domesticIdOf({ sport: 'football', layer: 'clubs', clubScope: 'domestic:nwsl' }), null, 'a map is its own sport\'s');
  assert.equal(dataSetOf(clubs({ clubScope: 'domestic:weus2026', dataSet: 'eaw-fc-26' })), 'eaw-fc-26');
  assert.deepEqual(['domestic:weu', 'domestic:weu32', 'domestic:nwsl'].map(domesticLabel), ['Europe', 'Elite 32 · Europe', 'NWSL · USA']);

  const model = buildSetupModel(clubs({ clubScope: 'domestic:weu' }), {});
  assert.deepEqual(model.scopes.map(scope => [scope.id, scope.label, scope.count]),
    [['domestic:weu', 'Europe', 68], ['domestic:weu32', 'Elite 32', 32], ['domestic:nwsl', 'NWSL', 16]]);
  assert.equal(model.domesticScopes.length, 0, 'no country maps: those are the men\'s');
  assert.match(model.countryNote, /^Arsenal, FC Barcelona and OL Lyonnes lead the 68 European clubs EA rates, each on land in its own country: .*A country with no club stays grey\.$/);
  assert.match(buildSetupModel(clubs({ clubScope: 'domestic:weu32' }), {}).countryNote, /lead Europe's 32 strongest clubs, each on land in its own country/);
  assert.match(buildSetupModel(clubs({ clubScope: 'domestic:nwsl' }), {}).countryNote,
    /^Gotham FC, Kansas City Current and Washington Spirit lead the 16 NWSL clubs fighting over the USA, each starting with only its stadium's state\. A state with several clubs is divided between them; one with none stays empty\.$/);
  // A season's maps are known, and named by their own strongest clubs, while it loads.
  const loading = buildSetupModel(clubs({ clubScope: 'domestic:nwsls2025', dataSet: 'eaw-fc-25' }), {});
  assert.deepEqual(loading.scopes.map(scope => [scope.id, scope.count]), [['domestic:weus2025', 57], ['domestic:weu32s2025', 32], ['domestic:nwsls2025', 14]]);
  assert.match(loading.countryNote, /^NJ\/NY Gotham FC, Portland Thorns and San Diego Wave lead the 14 NWSL clubs/);
});

test('a challenge link names the women\'s theatres; one to a European league of before plays every European club', () => {
  const link = query => readChallenge(`?sport=womens-football&teams=clubs&${query}`).setup;
  assert.equal(link('theatre=NWSL').clubScope, 'domestic:nwsl');
  assert.equal(link('theatre=elite').clubScope, 'domestic:weu32');
  assert.equal(link('theatre=domestic:weu32&season=eaw-fc-24').clubScope, 'domestic:weu32s2024');
  const old = readChallenge('?sport=womens-football&teams=clubs&theatre=Liga+F');
  assert.deepEqual([old.setup.clubScope, old.ignored], ['domestic:weu', ['theatre']]);
  assert.equal(readChallenge('?sport=football&teams=clubs&theatre=domestic:nwsl').setup.clubScope, 'domestic:eu124', 'a map stays with its sport');
  const query = challengeQuery({ sport: 'womens-football', layer: 'clubs', clubScope: 'domestic:nwsl', seed: '7' });
  assert.match(query, /theatre=domestic:nwsl/);
  assert.equal(readChallenge(`?${query}`).setup.clubScope, 'domestic:nwsl');
  assert.doesNotMatch(challengeQuery({ sport: 'womens-football', layer: 'clubs', clubScope: 'domestic:weu', seed: '7' }), /theatre=/, 'Europe is the default');
});

for (const [name, doc] of [['every European club', WEU], ['the NWSL', NWSL]]) {
  test(`seeded duel campaigns of ${name} reach a champion by land, sea or open ground, never by treaty`, () => {
    const map = decodeDomestic(JSON.parse(JSON.stringify(doc)), doc.id);
    const { geo } = map;
    const { obstacles } = domesticSurroundings(ATLAS, map);
    for (const seed of [20261109, 3]) {
      const rng = makeRng(seed);
      const teams = Object.fromEntries(map.clubs.map(club => [club.id, buildClub(club, sport)]));
      let own = { ...map.startOwners }, aliveIds = map.clubs.map(club => club.id);
      assert.deepEqual(validateReachability({ geo, own, aliveIds }).unplacedIds, []);
      while (aliveIds.length > 1) {
        const board = { geo, routingPaths: geo.paths, own, aliveIds, obstacles, borderRoutes: true, ...(map.empty ? { openLand: true } : {}) };
        const draw = createDuelDraw(rng, board, { speed: 80 });
        assert.ok(draw && draw.attackerId !== draw.targetId, 'every duel resolves');
        assert.ok(draw.routeKind !== 'neutral-transit' && !draw.transitCountryIds.length, 'no transit treaty');
        const { winner } = sport.simulate(rng, teams[draw.attackerId], teams[draw.targetId], 6, teamEff(teams[draw.attackerId]), teamEff(teams[draw.targetId]));
        const loser = winner === draw.attackerId ? draw.targetId : draw.attackerId;
        own = { ...own, ...Object.fromEntries(territories({ own }, loser).map(id => [id, winner])) };
        aliveIds = aliveIds.filter(id => id !== loser);
      }
      assert.ok(Object.values(own).every(id => id === aliveIds[0]), 'the champion holds every territory');
    }
  });
}

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearDomesticCache: ['src/engine/domestic.js', 'clearDomesticCache'],
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

async function withApp(fn) {
  const fetch = async url => {
    const [, folder, id] = String(url).match(/^\/(domestic|womens-football)\/([0-9A-Za-z-]+)\.json$/) || [];
    let text = null;
    try { text = folder ? read(`public/${folder}/${id}.json`) : null; } catch { text = null; }
    return text ? { ok: true, status: 200, json: async () => JSON.parse(text) } : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearDomesticCache();
  B.clearFootballSetCache();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['826', '250', '724', '840'],
    settings: { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn(f); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}

/** The fields of a checkpoint parseCampaign reads, from the App's state. */
function checkpoint(state) {
  const { teams, own, aliveIds, fallen, stats, log, round, matches, queue, batchTotal, history, seed, rngState, settings, initialSettings, campaignId, revision, campaignName, startedAt } = state;
  return { teams, own, aliveIds, fallen, stats, log, round, matches, queue, batchTotal, history, seed, rngState, settings, initialSettings, campaignId, revision, campaignName, startedAt, phase: 'playing' };
}

test('women\'s clubs set up on the map of Europe, launch with every club on its own land, and save', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'womens-football');
    app.pickSetup('layer', 'clubs');
    assert.equal(app.state.setup.clubScope, 'domestic:weu');
    time.advance(200);
    await app.loadCountry('weu');
    await settle();
    app.startCampaign();
    const { state } = app;
    assert.equal(state.phase, 'playing');
    assert.equal(state.settings.domesticVersion, WEU.version);
    assert.equal(state.aliveIds.length, 68);
    assert.ok(Object.values(state.teams).every(team => state.own[team.home] === team.id && team.sport === 'womens-football'));
    assert.equal(state.campaignName, "Women's football · Europe");
    assert.equal(app.territoryName(state.teams['w-manchester-united'].home), 'Leigh');
    assert.doesNotThrow(() => parseCampaign(JSON.stringify({ v: 2, ...checkpoint(state) })));
  });
});

test('the NWSL and a season\'s own maps launch too, with the season\'s clubs', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'womens-football');
    app.pickSetup('layer', 'clubs');
    app.pickSetup('clubScope', 'domestic:nwsl');
    app.pickSetup('dataSet', 'eaw-fc-25');
    assert.equal(app.state.setup.clubScope, 'domestic:nwsls2025', 'the theatre follows the season');
    time.advance(200);
    await app.loadSet('eaw-fc-25');
    await app.loadCountry('nwsls2025');
    await settle();
    app.startCampaign();
    const { state } = app;
    assert.equal(state.phase, 'playing');
    assert.deepEqual([state.settings.dataSet, state.settings.domesticVersion], ['eaw-fc-25', docOf('nwsls2025').version]);
    const clubs = nwslOf(seasonOf('eaw-fc-25').clubs);
    assert.deepEqual(Object.keys(state.teams).sort(), clubs.map(club => club.id).sort());
    const gotham = clubs.find(club => club.id === 'w-gotham-fc');
    assert.deepEqual([state.teams['w-gotham-fc'].name, state.teams['w-gotham-fc'].squad.length], ['NJ/NY Gotham FC', gotham.squad.length]);
    assert.equal(state.campaignName, "Women's football 2024/25 · NWSL · USA");
    assert.doesNotThrow(() => parseCampaign(JSON.stringify({ v: 2, ...checkpoint(state) })));
    // A save that puts the season on another season's map, or on football's, is refused.
    const moved = { v: 2, ...checkpoint(state) };
    for (const clubScope of ['domestic:nwsl', 'domestic:nwsls2024', 'domestic:eu124s2025']) {
      const settings = { ...state.settings, clubScope, domesticVersion: undefined };
      assert.throws(() => parseCampaign(JSON.stringify({ ...moved, settings, initialSettings: settings })), /data set is invalid/, clubScope);
    }
  });
});

test('a women\'s world campaign saved before the maps stays on the world, under its own name', async () => {
  await withApp(async ({ app }) => {
    const cases = [['all', null, 'All Leagues'], ['elite', null, 'Elite 32'], ["Women's Super League", null, "Women's Super League"],
      ['NWSL', null, 'NWSL'], ['all', 'eaw-fc-26', 'All Leagues'], ['Liga F', 'eaw-fc-24', 'Liga F']];
    for (const [clubScope, dataSet, name] of cases) {
      const settings = { sport: 'womens-football', layer: 'clubs', clubScope, dataSet };
      assert.equal(app.scopeName(settings), name);
      assert.equal(worldClubTheatreName(settings), name);
      assert.equal(domesticIdOf(settings), null);
      const campaign = { settings };
      assert.equal(app.withCampaignMap(campaign, (loaded, fitted) => [loaded, fitted === campaign]).join(), ',true');
    }
    // Such a save still passes the checks: a club of each league on a few world shapes.
    const teams = Object.fromEntries(['w-arsenal', 'w-fc-barcelona', 'w-gotham-fc'].map(id => {
      const club = buildClub(CLUBS.find(c => c.id === id), sport);
      return [id, club];
    }));
    const own = { 826: 'w-arsenal', 724: 'w-fc-barcelona', 840: 'w-gotham-fc', 250: 'w-arsenal' };
    const settings = { sport: 'womens-football', layer: 'clubs', clubScope: 'all', pacing: 'duel', resolution: 'ticker', role: 'spectator' };
    const save = { v: 2, teams, own, aliveIds: Object.keys(teams), settings, initialSettings: settings, seed: 1, rngState: 1, round: 3, phase: 'playing' };
    const parsed = parseCampaign(JSON.stringify(save));
    assert.deepEqual([parsed.own['826'], parsed.own['840'], parsed.settings.clubScope], ['w-arsenal', 'w-gotham-fc', 'all']);
    // And one of a season, as it was saved then.
    const season = { ...settings, clubScope: "Women's Super League", dataSet: 'eaw-fc-26', dataVersion: BUILT_IN_WOMENS_SEASONS[0].version,
      dataYear: 2026, dataSeason: '2025/26' };
    assert.equal(parseCampaign(JSON.stringify({ ...save, settings: season, initialSettings: season })).settings.dataSet, 'eaw-fc-26');
  });
});
