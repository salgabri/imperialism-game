// The built-in earlier basketball seasons (docs/design/football-years.md, "Earlier basketball seasons"): the builder
// on invented players (scripts/lib/nba-seasons.mjs), the shipped seasons against their era maps and the manifest, the
// loader's checks, and the running App: a season's Season row, its era's map, a launch with its NBA 2K fives, and a
// save that resumes as it was played.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SAVE_KEY } from '../src/config.js';
import { BUILT_IN_BASKETBALL_SEASONS } from '../src/data/basketballSeasons.js';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { CLUBS } from '../src/data/clubs.basketball.js';
import { colourFor, contentHash } from '../src/data/footballSetBuild.js';
import { decodeDomestic } from '../src/engine/domestic.js';
import { BUILT_IN_SETS, builtInSeasonOf, clearFootballSetIndex, decodeFootballSet, loadFootballSetIndex, seasonMapOf, seasonSport,
  setSportOf, sportOf } from '../src/engine/footballSets.js';
import { parseCampaign } from '../src/engine/storage.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { buildNbaSeason, editionOf, extractYears, mapOf, positionsOf, seasonIdOf, teamsOf } from './lib/nba-seasons.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const MANIFEST = JSON.parse(read('scripts/data/nba-seasons.json'));
const ARENAS = JSON.parse(read('scripts/data/nba-arenas.json')).clubs;
const seasonFile = id => JSON.parse(read(`public/basketball/${id}.json`));
const mapFile = id => JSON.parse(read(`public/domestic/${id}.json`));

// ---------- the builder, on invented players ----------

const TEST_MANIFEST = {
  source: { name: 'Test Archive', url: 'https://example.test/ratings', file: 'home.html', sha256: '0'.repeat(64) },
  teams: {
    // Moved after 2001: its own city and arena before, then the game's club's.
    MOV: [{ to: 2001, id: 'b-old-town-movers', name: 'Old Town Movers', city: 'Old Town', arena: 'Old Hall', home: [-100, 40] },
      { from: 2002, id: 'b-boston-celtics', name: 'Boston Celtics' }],
    NEW: [{ id: 'b-new-city-testers', name: 'New City Testers', city: 'New City', arena: 'Test Dome', home: [-90, 35] }],
  },
  maps: [{ id: 'test2001', seasons: [2001] }, { id: 'test2002', seasons: [2002] }],
};
const player = (n, p, o, t) => ({ n, p, o, t });
const five = (team, base) => [player(`${team} Point`, 'PG', base + 4, team), player(`${team} Shooter`, 'SG/SF', base + 3, team),
  player(`${team} Wing`, 'SF', base + 2, team), player(`${team} Forward`, 'PF/C', base + 1, team), player(`${team} Centre`, 'C', base, team)];
const YEARS = {
  2001: [...five('MOV', 80), player('MOV Bench', 'C', 60, 'MOV'), player('Blank Guard', '', 99, 'MOV'),
    player('Nobody Knows', '', 98, 'NEW'), ...five('NEW', 70), player('Free Agent', 'PG', 97, 'FA')],
  2002: [...five('MOV', 81), player('Blank Guard', 'SG/C', 90, 'NEW'), ...five('NEW', 71)],
};

test('editions, ids and positions read as the game names them', () => {
  assert.deepEqual([2000, 2008, 2024].map(editionOf), ['NBA 2K', 'NBA 2K8', 'NBA 2K24']);
  assert.deepEqual([2000, 2008, 2024].map(seasonIdOf), ['nba-2k00', 'nba-2k08', 'nba-2k24']);
  assert.deepEqual(['SF/PF', 'C', 'PG/C', 'G', ''].map(positionsOf), [['SF', 'PF'], ['C'], ['PG'], null, null],
    'a second position that is no neighbour is dropped');
});

test('the YEARS table is read as data: braces inside strings do not end it, and nothing on the page runs', () => {
  const html = '<script>const NOTE = "}"; const YEARS = {"2001":[{"n":"Brace } \\"Quote\\" {","o":80,"p":"PG","t":"MOV"}]};'
    + ' globalThis.ran = true;</script>';
  assert.deepEqual(extractYears(html), { 2001: [{ n: 'Brace } "Quote" {', o: 80, p: 'PG', t: 'MOV' }] });
  assert.equal(globalThis.ran, undefined);
  assert.throws(() => extractYears('<p>No ratings here</p>'), /no YEARS table/);
  assert.throws(() => extractYears('const YEARS = {"2001": ['), /never closes/);
});

test('a season keeps each club\'s best five as 2K rated them, on its era\'s teams and map', () => {
  const builtIn = [{ id: 'b-boston-celtics', code: 'BCE', col: 'oklch(0.5 0.1 10)' }];
  const arenas = { 'b-boston-celtics': { city: 'Boston', arena: 'TD Garden', home: [-71.06, 42.37] } };
  assert.deepEqual(teamsOf(TEST_MANIFEST, 2002, arenas).map(team => [team.code, team.id, team.city]),
    [['MOV', 'b-boston-celtics', 'Boston'], ['NEW', 'b-new-city-testers', 'New City']]);
  assert.deepEqual([mapOf(TEST_MANIFEST, 2001), mapOf(TEST_MANIFEST, 2002)], ['test2001', 'test2002']);

  const { doc, text, audit } = buildNbaSeason(YEARS, 2001, TEST_MANIFEST, { arenas, builtIn });
  assert.equal(text, `${JSON.stringify(doc)}\n`);
  assert.deepEqual({ ...doc, clubs: undefined, version: undefined }, { format: 1, kind: 'nba2k', id: 'nba-2k01', version: undefined,
    year: 2001, season: '2000/01', label: 'NBA 2K1', local: false,
    source: { provider: '2K Sports', edition: 'NBA 2K1', compiler: 'Test Archive', url: 'https://example.test/ratings', rawScale: 99 },
    map: 'test2001', clubs: undefined, coverage: { players: 10, clubs: 2 } });
  assert.equal(doc.version, `nba-2k01-${contentHash(doc)}`, 'content-hash version');
  const [movers, testers] = doc.clubs;
  // The blank position comes from the nearest edition that lists him (2002's, the only one: 'SG/C' keeps SG). The five
  // is the strongest lineup the positions allow: the shooter covers SF, so the wing (82) sits for the centre (80).
  // 2K's ratings stay as rated.
  assert.deepEqual(movers, { id: 'b-old-town-movers', name: 'Old Town Movers', code: movers.code, league: 'NBA', country: '840',
    col: colourFor('b-old-town-movers'), str: 85,
    squad: [['Blank Guard', 'SG', 99], ['MOV Point', 'PG', 84], ['MOV Shooter', 'SG/SF', 83], ['MOV Forward', 'PF/C', 81], ['MOV Centre', 'C', 80]] });
  assert.match(movers.code, /^[A-Z]{3}$/);
  assert.equal(testers.str, 72, 'a player with no position in any edition is left out, never guessed');
  assert.deepEqual(audit.filledPositions, ['Blank Guard SG (NBA 2K2)']);
  assert.deepEqual(audit.droppedNoPosition, ['Nobody Knows']);
  assert.ok(!text.includes('Free Agent'), 'free agents play for nobody');

  // A club that kept its id keeps the game's code and colour.
  const later = buildNbaSeason(YEARS, 2002, TEST_MANIFEST, { arenas, builtIn }).doc;
  assert.deepEqual(later.clubs.map(club => [club.id, club.code, club.col]),
    [['b-boston-celtics', 'BCE', 'oklch(0.5 0.1 10)'], ['b-new-city-testers', later.clubs[1].code, colourFor('b-new-city-testers')]]);
});

test('the builder stops on an edition whose teams are not the manifest\'s, or a club short of five', () => {
  const arenas = { 'b-boston-celtics': { city: 'Boston', arena: 'TD Garden', home: [-71.06, 42.37] } };
  const build = years => () => buildNbaSeason(years, 2001, TEST_MANIFEST, { arenas });
  assert.throws(build({ 2001: [...YEARS[2001], player('Stranger', 'PG', 70, 'ZZZ')] }), /teams ZZZ are not the manifest's/);
  assert.throws(build({ 2001: five('MOV', 80) }), /missing NEW/);
  assert.throws(build({ 2001: [...five('MOV', 80), ...five('NEW', 70).slice(1)] }), /New City Testers has 4 players/);
  assert.throws(build({ 2001: [...five('MOV', 80), ...five('NEW', 70), player('Bad Rating', 'PG', 120, 'NEW')] }), /rating outside 1-99/);
  assert.throws(() => buildNbaSeason(YEARS, 2003, TEST_MANIFEST, { arenas }), /no NBA 2K3/);
});

// ---------- the shipped seasons ----------

const ERA_MAPS = CLUB_MAPS.filter(entry => entry.seasons);

test('the built-in seasons are the manifest\'s, newest first, 2011/12 left out as its source is broken', () => {
  assert.deepEqual(BUILT_IN_BASKETBALL_SEASONS.map(set => set.year), MANIFEST.seasons.slice().sort((a, b) => b - a));
  assert.equal(BUILT_IN_BASKETBALL_SEASONS.length, 24);
  assert.deepEqual([BUILT_IN_BASKETBALL_SEASONS[0].label, BUILT_IN_BASKETBALL_SEASONS.at(-1).label], ['NBA 2K24', 'NBA 2K']);
  assert.ok(!MANIFEST.seasons.includes(2012) && /Philadelphia/.test(MANIFEST.skipped['2012']), 'the skip says why');
  assert.deepEqual(builtInSeasonOf('basketball'), { year: MANIFEST.builtIn.year, season: MANIFEST.builtIn.season });
  // Listed with the football seasons, each with its map; a local index never adds a basketball season.
  for (const listed of BUILT_IN_BASKETBALL_SEASONS) {
    const set = BUILT_IN_SETS.find(entry => entry.id === listed.id);
    assert.deepEqual(set, { id: listed.id, version: listed.version, year: listed.year, season: listed.season, label: listed.label, map: listed.map });
    assert.equal(setSportOf(set.id), 'basketball');
    assert.equal(seasonMapOf(set.id), mapOf(MANIFEST, set.year));
  }
  assert.ok(BUILT_IN_SETS.filter(set => setSportOf(set.id) === 'football').every(set => !('map' in set)));
});

test('a local index never lists a basketball season', async () => {
  clearFootballSetIndex();
  const index = { format: 1, sets: [{ id: 'nba-2k99', year: 2099, season: '2098/99', label: 'NBA 2K99', map: 'nba' }] };
  const sets = await loadFootballSetIndex({ fetch: async () => ({ ok: true, json: async () => index }) });
  assert.equal(sets, BUILT_IN_SETS);
  clearFootballSetIndex();
});

test('every season loads and fits its era\'s map: the same franchises, named and housed as that season had them', () => {
  const today = new Set(CLUBS.map(club => club.id));
  for (const listed of BUILT_IN_BASKETBALL_SEASONS) {
    const doc = seasonFile(listed.id);
    const set = decodeFootballSet(structuredClone(doc), listed.id);
    assert.equal(doc.version, listed.version);
    assert.equal(doc.version, `${listed.id}-${contentHash(doc)}`, `${listed.id} is the builder's file`);
    assert.equal(doc.label, editionOf(doc.year));
    const map = decodeDomestic(mapFile(listed.map), listed.map);
    const entry = CLUB_MAPS.find(item => item.id === listed.map);
    assert.equal(map.meta.version, entry.version);
    assert.deepEqual(set.clubs.map(club => club.id).sort(), map.clubs.map(club => club.id).sort(), `${listed.id} has ${listed.map}'s franchises`);
    const teams = new Map(teamsOf(MANIFEST, doc.year, ARENAS).map(team => [team.id, team]));
    for (const row of map.clubs) {
      const team = teams.get(row.id), club = set.clubs.find(item => item.id === row.id);
      assert.equal(club.name, team.name);
      assert.equal(map.sectionNames[row.homeSection], team.city, `${team.name} starts at home`);
      assert.deepEqual(row.homePoint, team.home);
      if (entry.seasons) assert.equal(row.name, club.name, 'an era map names its season\'s franchises');
      // The best five, rated as 2K rated them.
      assert.equal(club.squad.length, 5);
      assert.equal(club.str, Math.round(club.squad.reduce((sum, [, , rating]) => sum + rating, 0) / 5));
    }
    if (entry.seasons) assert.ok(entry.seasons.includes(listed.id));
    else assert.deepEqual(new Set(set.clubs.map(club => club.id)), today, 'today\'s map serves seasons with today\'s franchises');
  }
  // Every era map serves at least one season, and only seasons that name it.
  for (const entry of ERA_MAPS) {
    assert.deepEqual(entry.seasons, BUILT_IN_BASKETBALL_SEASONS.filter(set => set.map === entry.id).map(set => set.id).sort());
    assert.ok(!('top' in entry), 'an era\'s strongest clubs are its seasons\' own');
  }
  assert.deepEqual(ERA_MAPS.map(entry => entry.id), MANIFEST.maps.map(map => map.id).filter(id => id !== 'nba'));
});

test('franchises that moved play where they played then', () => {
  const homeOf = (season, id) => {
    const listed = BUILT_IN_BASKETBALL_SEASONS.find(set => set.id === season);
    const map = decodeDomestic(mapFile(listed.map), listed.map);
    const row = map.clubs.find(club => club.id === id);
    return row && [seasonFile(season).clubs.find(club => club.id === id).name, map.sectionNames[row.homeSection]];
  };
  assert.deepEqual(homeOf('nba-2k00', 'b-vancouver-grizzlies'), ['Vancouver Grizzlies', 'Vancouver']);
  assert.deepEqual(homeOf('nba-2k02', 'b-memphis-grizzlies'), ['Memphis Grizzlies', 'Memphis']);
  assert.deepEqual(homeOf('nba-2k08', 'b-seattle-supersonics'), ['Seattle SuperSonics', 'Seattle']);
  assert.deepEqual(homeOf('nba-2k09', 'b-oklahoma-city-thunder'), ['Oklahoma City Thunder', 'Oklahoma City']);
  assert.deepEqual(homeOf('nba-2k07', 'b-new-orleans-oklahoma-city-hornets'), ['New Orleans/Oklahoma City Hornets', 'Oklahoma City']);
  assert.deepEqual(homeOf('nba-2k02', 'b-charlotte-hornets'), ['Charlotte Hornets', 'Charlotte']);
  assert.deepEqual(homeOf('nba-2k03', 'b-new-orleans-hornets'), ['New Orleans Hornets', 'New Orleans']);
  assert.deepEqual(homeOf('nba-2k11', 'b-new-jersey-nets'), ['New Jersey Nets', 'New Jersey']);
  assert.deepEqual(homeOf('nba-2k13', 'b-brooklyn-nets'), ['Brooklyn Nets', 'Brooklyn']);
  assert.equal(homeOf('nba-2k02', 'b-vancouver-grizzlies'), undefined, 'gone the season after');
});

test('the loader refuses a basketball season that is not the builder\'s', () => {
  const doc = seasonFile('nba-2k08');
  const broken = edit => { const copy = structuredClone(doc); edit(copy); return () => decodeFootballSet(copy, 'nba-2k08'); };
  assert.throws(broken(d => { d.map = 'nba2000'; }), /map "nba2000" is not a basketball map listing this season/);
  assert.throws(broken(d => { d.map = '826'; }), /is not a basketball map/);
  assert.throws(broken(d => { d.nations = {}; }), /clubs only/);
  assert.throws(broken(d => { d.clubs.pop(); }), /clubs must be the 30 of map nba2008, found 29/);
  assert.throws(broken(d => { d.kind = 'ea'; }), /kind "ea" is not the kind its id names/);
  assert.throws(broken(d => { d.clubs[0].id = 'f-phoenix-suns'; }), /must look like "b-<name>"/);
  assert.throws(broken(d => { d.clubs[1].code = d.clubs[0].code; }), /is duplicated/);
  assert.throws(broken(d => { d.clubs[0].league = 'EuroLeague'; }), /not a built-in league/);
  assert.throws(broken(d => { d.clubs[0].squad.pop(); }), /needs at least five players/);
  assert.throws(broken(d => { d.clubs[0].squad[0][1] = 'PG/SF'; }), /one position or two neighbouring ones/);
  assert.throws(broken(d => { d.clubs[0].squad[0][2] = 95.5; }), /whole number 1-99/);
  assert.throws(broken(d => { d.clubs[0].squad[1][0] = d.clubs[0].squad[0][0]; }), /repeats/);
  assert.throws(broken(d => { d.source.rawScale = 100; }), /rawScale must be 99/);
  assert.throws(broken(d => { delete d.source.compiler; }), /who compiled its ratings/);
});

test('a basketball season binds the basketball sport to its clubs and map, for clubs only', () => {
  const set = decodeFootballSet(seasonFile('nba-2k08'), 'nba-2k08');
  const sport = seasonSport(set);
  assert.equal(sport.id, 'basketball');
  assert.equal(sport.clubs, set.clubs);
  assert.deepEqual([sport.clubMap, sport.dataSet, sport.dataYear, sport.dataSeason, sport.dataLabel], ['nba2008', 'nba-2k08', 2008, '2007/08', 'NBA 2K8']);
  assert.equal(set.rosters, null, 'no national teams');
  // Until it loads, a basketball season plays nothing; with nations it is not played at all.
  assert.equal(sportOf({ sport: 'basketball', layer: 'clubs', dataSet: 'nba-2k07' }), null);
  assert.equal(sportOf({ sport: 'basketball', layer: 'nations', dataSet: 'nba-2k07' }).dataSet, undefined);
  assert.equal(sportOf({ sport: 'football', layer: 'clubs', dataSet: 'nba-2k07' }).id, 'football');
});

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearDomesticCache: ['src/engine/domestic.js', 'clearDomesticCache'],
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
  clearFootballSetIndex: ['src/engine/footballSets.js', 'clearFootballSetIndex'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

async function withApp(fn) {
  const calls = [];
  const fetch = async url => {
    calls.push(String(url));
    const [, folder, id] = String(url).match(/^\/(domestic|basketball)\/([0-9A-Za-z-]+)\.json$/) || [];
    const file = folder === 'domestic' ? `public/domestic/${id}.json` : folder ? `public/basketball/${id}.json` : null;
    let text = null;
    try { text = file && read(file); } catch { text = null; }
    return text ? { ok: true, status: 200, json: async () => JSON.parse(text) }
      : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearDomesticCache();
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['840', '124', '484'],
    settings: { sport: 'basketball', layer: 'nations', scope: 'UEFA', clubScope: 'domestic:nba', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn({ ...f, calls }); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}

/** Choose a season and wait for it and its map, as the player waits on the setup screen. */
async function chooseSeason(app, time, id) {
  app.pickSetup('dataSet', id);
  time.advance(200);
  await Promise.all([app.loadCountry(seasonMapOf(id)), app.loadSet(id)]);
  await settle();
  assert.equal(app.seasonStatus().state, 'ready');
  assert.equal(app.domesticStatus().state, 'ready');
}
const modelOf = app => buildSetupModel(app.state.setup, { managerTeams: app.setupTeams(), domestic: app.domesticStatus(), season: app.seasonStatus() });
const strongest = doc => doc.clubs.slice().sort((a, b) => b.str - a.str || a.name.localeCompare(b.name)).slice(0, 3).map(club => club.name);

test('basketball\'s Season choice lists its own seasons; one takes the clubs onto its era\'s map, and Nations goes back', async () => {
  await withApp(async ({ app, time }) => {
    const model = modelOf(app);
    assert.deepEqual(model.season.options.map(option => option.label),
      ['2024/25 · built in', ...BUILT_IN_BASKETBALL_SEASONS.map(set => `${set.season} · ${set.label}`)]);
    assert.equal(model.season.options.at(-1).label, '1999/00 · NBA 2K');
    assert.match(model.season.note, /NBA 2K ratings of that season, as compiled by 2K Archive. They have NBA clubs only/);
    assert.equal(model.season.id, null);

    app.pickSetup('dataSet', 'nba-2k08');
    assert.deepEqual([app.state.setup.layer, app.state.setup.clubScope], ['clubs', 'domestic:nba2008'], 'clubs only, on the 2007/08 map');
    const loading = modelOf(app);
    assert.deepEqual(loading.scopes.map(scope => [scope.id, scope.label, scope.count]), [['domestic:nba2008', 'NBA', 30]]);
    assert.equal(loading.canLaunch, false, 'Launch waits for the season and its map');
    assert.match(loading.countryNote, /^The strongest clubs lead the 30 NBA clubs/, 'no club named before the season loads');

    app.pickSetup('layer', 'nations');
    assert.deepEqual([app.state.setup.dataSet, app.state.setup.clubScope], [null, 'domestic:nba'], 'Nations plays the built-in season');
    app.pickSetup('dataSet', 'nba-2k15');
    assert.deepEqual([app.state.setup.layer, app.state.setup.clubScope], ['clubs', 'domestic:nba'], 'today\'s franchises play on today\'s map');
    app.pickSetup('sport', 'football');
    assert.equal(app.state.setup.dataSet, null, 'a season stays with its sport');
    assert.ok(modelOf(app).season.options.every(option => option.id == null || setSportOf(option.id) === 'football'));
    app.pickSetup('dataSet', 'ea-fifa-18');
    app.pickSetup('sport', 'basketball');
    assert.equal(app.state.setup.dataSet, null);
  });
});

test('a season launches its own fives on its era\'s map and resumes as it was played', async () => {
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'basketball');
    await chooseSeason(app, time, 'nba-2k08');
    const doc = seasonFile('nba-2k08');
    const model = modelOf(app);
    assert.equal(model.canLaunch, true);
    assert.equal(model.campaignSummary, 'Basketball · Clubs · NBA · USA and Canada · 2007/08');
    const [first, second, third] = strongest(doc);
    assert.match(model.countryNote, new RegExp(`^${first}, ${second} and ${third} lead the 30 NBA clubs`));
    const sonics = model.teams.find(team => team.id === 'b-seattle-supersonics');
    assert.equal(sonics.name, 'Seattle SuperSonics');

    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason, st.settings.clubScope],
      ['nba-2k08', doc.version, 2008, '2007/08', 'domestic:nba2008']);
    assert.equal(st.settings.domesticVersion, CLUB_MAPS.find(entry => entry.id === 'nba2008').version);
    assert.equal(st.campaignName, 'Basketball 2007/08 · NBA · USA and Canada');
    assert.deepEqual(Object.keys(st.teams).sort(), doc.clubs.map(club => club.id).sort());
    for (const club of doc.clubs) {
      const team = st.teams[club.id];
      assert.deepEqual([team.name, team.code, team.str], [club.name, club.code, club.str]);
      assert.deepEqual(team.squad.map(p => [p.name, p.rating]), club.squad.map(([name, , rating]) => [name, rating]), `${club.name}'s 2K8 five`);
      assert.equal(st.own[team.home], team.id);
    }
    assert.equal(app.territoryName(st.teams['b-seattle-supersonics'].home), 'Seattle');
    assert.ok(calls.includes('/basketball/nba-2k08.json') && calls.includes('/domestic/nba2008.json'));

    // The save holds every player as played, so it needs no season file to resume.
    const text = items.get(SAVE_KEY);
    assert.equal(JSON.parse(text).playerPack, undefined);
    const saved = parseCampaign(text);
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams));
    B.clearFootballSetCache();
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams));

    // A season belongs on its own map, and an era's map belongs to its seasons.
    const edited = edit => { const data = JSON.parse(text); edit(data.settings); if (data.initialSettings) edit(data.initialSettings); return JSON.stringify(data); };
    const today = CLUB_MAPS.find(entry => entry.id === 'nba').version;
    assert.throws(() => parseCampaign(edited(s => { s.clubScope = 'domestic:nba'; s.domesticVersion = today; })), /Campaign data set is invalid/);
    assert.throws(() => parseCampaign(edited(s => { s.dataSet = null; s.dataVersion = null; s.dataYear = null; s.dataSeason = null; })), /Campaign data set is invalid/);
    assert.throws(() => parseCampaign(edited(s => { s.layer = 'nations'; })), /Campaign data set is invalid/);
    assert.throws(() => parseCampaign(edited(s => { s.sport = 'football'; })), /Campaign data set is invalid/);
  });
});

test('a season with today\'s franchises plays on today\'s map with that season\'s fives', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'basketball');
    await chooseSeason(app, time, 'nba-2k15');
    const doc = seasonFile('nba-2k15');
    assert.match(modelOf(app).countryNote, new RegExp(`^${strongest(doc).join(', ').replace(/, ([^,]*)$/, ' and $1')} lead the 30 NBA clubs`));
    app.startCampaign();
    const st = app.state;
    assert.equal(st.settings.clubScope, 'domestic:nba');
    const warriors = doc.clubs.find(club => club.id === 'b-golden-state-warriors');
    assert.deepEqual(st.teams['b-golden-state-warriors'].squad.map(p => p.name), warriors.squad.map(([name]) => name), 'the 2K15 five, not today\'s');
    assert.notDeepEqual(warriors.squad.map(([name]) => name), CLUBS.find(club => club.id === 'b-golden-state-warriors').squad.map(([name]) => name));
  });
});
