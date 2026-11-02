// The built-in earlier baseball seasons (docs/design/baseball.md, "Earlier seasons"): MLB The Show 21 to 25, each
// edition's nations by birthplace and MLB clubs, built from committed snapshots, their era maps (the Athletics in
// Oakland until 2024, the Cleveland Indians in 2021, the Rays at Steinbrenner Field in 2025), the loader and the App,
// which plays a season with its nations or with its clubs on the map of their day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SAVE_KEY } from '../src/config.js';
import { BUILT_IN_BASEBALL_SEASONS } from '../src/data/baseballSeasons.js';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { CLUBS } from '../src/data/clubs.baseball.js';
import { buildTeam, makeRng, selectLineup } from '../src/data/teams.js';
import { decodeDomestic } from '../src/engine/domestic.js';
import { BUILT_IN_SETS, builtInSeasonOf, decodeFootballSet, seasonMapOf, seasonSport, setHasNations, setSportOf, sportOf } from '../src/engine/footballSets.js';
import { parseCampaign } from '../src/engine/storage.js';
import { BASELINE } from '../src/sports/baseball.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { readChallenge } from '../src/screens/setup/challenge.js';
import { kmToPolys, pointInPolys } from './lib/domestic-partition.mjs';
import { editionOf, seasonIdOf, teamsOf } from './lib/mlb.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const MANIFEST = JSON.parse(read('scripts/data/mlb-seasons.json'));
const FRANCHISES = JSON.parse(read('scripts/data/mlb-teams.json')).teams;
const seasonFile = id => JSON.parse(read(`public/baseball/${id}.json`));
const mapFile = id => JSON.parse(read(`public/domestic/${id}.json`));
const ERA_MAPS = CLUB_MAPS.filter(entry => entry.sport === 'baseball' && entry.seasons);

// ---------- building ----------

test('every season rebuilds byte for byte from its committed snapshot', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.match(execFileSync(process.execPath, ['scripts/build-mlb-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }), /Verified the 5 baseball seasons/);
  for (const year of MANIFEST.seasons) {
    const snapshot = JSON.parse(read(`scripts/data/mlb-the-show-${editionOf(year)}.json`));
    assert.equal(snapshot.players.length, snapshot.source.cards);
    assert.equal(snapshot.source.season, String(year));
    assert.equal(Object.keys(snapshot.teams).length, 31, `${year}: the 30 clubs and the free agents`);
  }
});

test('the built-in seasons are the manifest\'s, newest first, from 2025 back to 2021, each on its era\'s map', () => {
  assert.deepEqual(BUILT_IN_BASEBALL_SEASONS.map(set => set.id), [...MANIFEST.seasons].reverse().map(seasonIdOf));
  assert.deepEqual(BUILT_IN_BASEBALL_SEASONS.map(set => [set.season, set.label, set.map]), [
    ['2025', 'MLB The Show 25', 'mlb2025'], ['2024', 'MLB The Show 24', 'mlb2022'], ['2023', 'MLB The Show 23', 'mlb2022'],
    ['2022', 'MLB The Show 22', 'mlb2022'], ['2021', 'MLB The Show 21', 'mlb2021']]);
  assert.equal(builtInSeasonOf('baseball').season, '2026', 'the built-in season stays the current one');
  for (const listed of BUILT_IN_BASEBALL_SEASONS) {
    const set = BUILT_IN_SETS.find(entry => entry.id === listed.id);
    assert.deepEqual(set, listed, `${listed.id} is listed as built`);
    assert.equal(setSportOf(set.id), 'baseball');
    assert.ok(setHasNations(set.id), 'a baseball season fields nations');
    assert.equal(seasonMapOf(set.id), listed.map);
    assert.equal(seasonFile(set.id).version, listed.version);
  }
  assert.deepEqual(ERA_MAPS.map(entry => [entry.id, entry.seasons]), [
    ['mlb2021', ['mlb-the-show-21']], ['mlb2022', ['mlb-the-show-22', 'mlb-the-show-23', 'mlb-the-show-24']], ['mlb2025', ['mlb-the-show-25']]]);
});

// ---------- the seasons ----------

test('every season loads and fits its era\'s map: the same clubs, named and housed as that season had them', () => {
  for (const listed of BUILT_IN_BASEBALL_SEASONS) {
    const doc = seasonFile(listed.id);
    const set = decodeFootballSet(doc, listed.id);
    assert.deepEqual([set.meta.year, set.meta.season, set.meta.map], [listed.year, listed.season, listed.map]);
    const map = decodeDomestic(mapFile(listed.map), listed.map);
    assert.deepEqual(map.clubs.map(club => club.id).sort(), doc.clubs.map(club => club.id).sort(), `${listed.id}'s clubs are its map's`);
    const teams = teamsOf(FRANCHISES, MANIFEST, listed.year);
    for (const club of doc.clubs) {
      const team = teams.find(t => t.id === club.id);
      assert.ok(team, `${club.name} is a club of ${listed.year}`);
      assert.deepEqual([club.name, club.code, club.league], [team.name, team.code, 'MLB']);
      assert.equal(club.squad.length, 26);
      const lineup = selectLineup({ sport: 'baseball', squad: club.squad.map(([name, listedPositions, rating]) => {
        const [pos, ...others] = listedPositions.split('/');
        return { name, pos, positions: [pos, ...others], rating };
      }) });
      assert.ok(lineup.slots.every(slot => slot.player && !slot.outOfPosition), `${listed.year} ${club.name} fields every position`);
      assert.equal(lineup.rating, club.str);
    }
    assert.ok(Object.keys(doc.nations).length >= 18, `${listed.year} has its baseball nations`);
    assert.ok(doc.nations['840'][0] > doc.nations['214'][0] - 10, 'the United States among the strongest');
    assert.deepEqual(doc.territory, { merged: { SCO: '826', WAL: '826', NIR: '826' }, inactive: [] });
  }
});

test('clubs play where they played then: Cleveland\'s Indians in 2021, Oakland until 2024, the Rays in Tampa in 2025', () => {
  const clubIds = id => seasonFile(id).clubs.map(club => club.id);
  assert.ok(clubIds('mlb-the-show-21').includes('mlb-cleveland-indians') && !clubIds('mlb-the-show-21').includes('mlb-cleveland-guardians'));
  assert.ok(clubIds('mlb-the-show-22').includes('mlb-cleveland-guardians'));
  for (const id of ['mlb-the-show-21', 'mlb-the-show-22', 'mlb-the-show-23', 'mlb-the-show-24']) {
    assert.ok(clubIds(id).includes('mlb-oakland-athletics') && !clubIds(id).includes('mlb-athletics'), `${id}: the Oakland Athletics`);
  }
  assert.ok(clubIds('mlb-the-show-25').includes('mlb-athletics'), '2025: the Athletics in Sacramento');
  const sectionAt = (map, point) => map.geo.countries.find(section => pointInPolys(point, section.polys))?.id ?? null;
  const home = (map, id) => map.clubs.find(club => club.id === id).homeSection;
  const oakland = decodeDomestic(mapFile('mlb2022'), 'mlb2022');
  assert.equal(oakland.sectionNames[home(oakland, 'mlb-oakland-athletics')], 'Oakland');
  assert.equal(sectionAt(oakland, [-122.2006, 37.7517]), home(oakland, 'mlb-oakland-athletics'), 'the Coliseum is the A\'s');
  const tampa = decodeDomestic(mapFile('mlb2025'), 'mlb2025');
  const rays = tampa.clubs.find(club => club.id === 'mlb-tampa-bay-rays');
  assert.deepEqual(rays.homePoint, [-82.5067, 27.9803], 'Steinbrenner Field');
  assert.equal(sectionAt(tampa, [-121.5138, 38.5804]), home(tampa, 'mlb-athletics'), 'Sutter Health Park is the Athletics\'');
  for (const entry of ERA_MAPS) {
    const map = decodeDomestic(mapFile(entry.id), entry.id);
    for (const club of map.clubs) {
      const land = map.geo.countries.find(section => section.id === club.homeSection).polys;
      assert.ok(kmToPolys(club.homePoint, land) <= 2, `${entry.id}: ${club.name} plays inside its own territory`);
    }
    assert.equal(sectionAt(map, [-87.6556, 41.9481]), home(map, 'mlb-chicago-cubs'), `${entry.id}: Wrigley Field`);
    assert.equal(sectionAt(map, [-87.6339, 41.83]), home(map, 'mlb-chicago-white-sox'), `${entry.id}: the White Sox's ballpark`);
  }
});

test('the loader refuses a baseball season that is not the builder\'s', () => {
  const doc = seasonFile('mlb-the-show-23');
  const broken = edit => { const copy = JSON.parse(JSON.stringify(doc)); edit(copy); return () => decodeFootballSet(copy, copy.id); };
  assert.throws(broken(d => { d.map = 'mlb2025'; }), /not a baseball map listing this season/);
  assert.throws(broken(d => { d.season = '2022/23'; }), /season "2022\/23" must be "2023"/);
  assert.throws(broken(d => { d.clubs[0].squad[0][1] = 'QB'; }), /must be baseball positions/);
  assert.throws(broken(d => { d.clubs.pop(); }), /clubs must be the 30 of map mlb2022/);
  assert.throws(broken(d => { d.nations['840'][1] = 5; }), /counts 5 players/);
  assert.throws(broken(d => { d.nations.XXX = [50, 1, [['A', 'SS', 50]]]; }), /is not a nation id/);
  assert.throws(broken(d => { d.clubs[0].id = 'b-boston-celtics'; }), /must look like "mlb-<name>"/);
});

test('a season binds baseball to its nations and clubs; a nation it does not list is a minnow', () => {
  const set = decodeFootballSet(seasonFile('mlb-the-show-21'), 'mlb-the-show-21');
  const sport = seasonSport(set);
  assert.deepEqual([sport.id, sport.dataSet, sport.dataSeason, sport.clubMap], ['baseball', 'mlb-the-show-21', '2021', 'mlb2021']);
  assert.equal(sport.clubs.length, 30);
  const rng = makeRng(2021);
  const usa = buildTeam('840', rng, sport);
  assert.deepEqual(usa.squad.filter(p => !p.gen).map(p => p.name), set.rosters['840'][2].map(([name]) => name), 'the 2021 Americans');
  const brazil = buildTeam('076', rng, sport);
  assert.equal(set.rosters['076'] == null ? brazil.str : BASELINE, BASELINE);
  // Nations and clubs both play a season; a basketball season stays clubs only.
  assert.equal(sportOf({ sport: 'baseball', layer: 'nations', dataSet: 'mlb-the-show-21' }), null, 'until it has loaded');
  assert.ok(!setHasNations('nba-2k10'));
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
    const [, folder, id] = String(url).match(/^\/(domestic|baseball)\/([0-9A-Za-z-]+)\.json$/) || [];
    const file = folder ? `public/${folder}/${id}.json` : null;
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
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['840', '124', '484', '214', '862'],
    settings: { sport: 'baseball', layer: 'nations', scope: 'CONCACAF', clubScope: 'domestic:mlb', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn({ ...f, calls }); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}
const modelOf = app => buildSetupModel(app.state.setup, { managerTeams: app.setupTeams(), domestic: app.domesticStatus(), season: app.seasonStatus() });

test('baseball\'s Season choice lists its own seasons; a season keeps Nations, and Clubs take its era\'s map', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'baseball');
    const model = modelOf(app);
    assert.deepEqual(model.season.options.map(option => option.name), ['2026', '2025', '2024', '2023', '2022', '2021']);
    assert.deepEqual(model.season.options.map(option => option.label),
      ['2026 · built in', ...BUILT_IN_BASEBALL_SEASONS.map(set => `${set.season} · ${set.label}`)]);
    assert.match(model.season.note, /MLB The Show ratings of each season/);

    app.pickSetup('dataSet', 'mlb-the-show-23');
    assert.deepEqual([app.state.setup.layer, app.state.setup.dataSet], ['nations', 'mlb-the-show-23'], 'a baseball season keeps its nations');
    time.advance(200);
    await app.loadSet('mlb-the-show-23');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(modelOf(app).canLaunch, true);

    app.pickSetup('layer', 'clubs');
    assert.deepEqual([app.state.setup.dataSet, app.state.setup.clubScope], ['mlb-the-show-23', 'domestic:mlb2022'], 'the 2023 clubs on the map of 2022–24');
    app.pickSetup('dataSet', null);
    assert.equal(app.state.setup.clubScope, 'domestic:mlb', 'the built-in season plays on today\'s map');
    app.pickSetup('sport', 'basketball');
    assert.equal(app.state.setup.dataSet, null, 'a season stays with its sport');
  });
});

test('a season\'s nations launch with that year\'s players and resume as they were played', async () => {
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'baseball');
    app.pickSetup('scope', 'CONCACAF');
    app.pickSetup('dataSet', 'mlb-the-show-22');
    time.advance(200);
    await app.loadSet('mlb-the-show-22');
    await settle();
    const doc = seasonFile('mlb-the-show-22');
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.layer, st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason],
      ['nations', 'mlb-the-show-22', doc.version, 2022, '2022']);
    const usa = st.teams['840'];
    assert.deepEqual(usa.squad.filter(p => !p.gen).map(p => [p.name, p.rating]), doc.nations['840'][2].map(([name, , rating]) => [name, rating]),
      'the 2022 Americans, as The Show 22 rated them');
    assert.ok(calls.includes('/baseball/mlb-the-show-22.json'));
    const saved = parseCampaign(items.get(SAVE_KEY));
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams));
    const edited = edit => { const data = JSON.parse(items.get(SAVE_KEY)); edit(data.settings); if (data.initialSettings) edit(data.initialSettings); return JSON.stringify(data); };
    assert.throws(() => parseCampaign(edited(s => { s.dataSeason = '2021/22'; })), /Campaign data set is invalid/);
    assert.throws(() => parseCampaign(edited(s => { s.sport = 'basketball'; })), /Campaign data set is invalid/);
  });
});

test('a season\'s clubs launch on their era\'s map: the Oakland Athletics in Oakland', async () => {
  await withApp(async ({ app, time, items }) => {
    app.pickSetup('sport', 'baseball');
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', 'mlb-the-show-24');
    time.advance(200);
    await Promise.all([app.loadCountry('mlb2022'), app.loadSet('mlb-the-show-24')]);
    await settle();
    assert.equal(app.domesticStatus().state, 'ready');
    const doc = seasonFile('mlb-the-show-24');
    app.startCampaign();
    const st = app.state;
    assert.deepEqual([st.settings.clubScope, st.settings.dataSet], ['domestic:mlb2022', 'mlb-the-show-24']);
    assert.equal(st.settings.domesticVersion, CLUB_MAPS.find(entry => entry.id === 'mlb2022').version);
    assert.equal(st.campaignName, 'Baseball 2024 · MLB · USA and Canada');
    assert.deepEqual(Object.keys(st.teams).sort(), doc.clubs.map(club => club.id).sort());
    const oakland = st.teams['mlb-oakland-athletics'];
    const listed = doc.clubs.find(club => club.id === 'mlb-oakland-athletics');
    assert.deepEqual([oakland.name, oakland.code, oakland.str], ['Oakland Athletics', 'OAK', listed.str]);
    assert.equal(app.territoryName(oakland.home), 'Oakland');
    assert.deepEqual(oakland.squad.map(p => p.name), listed.squad.map(([name]) => name), 'the 2024 A\'s');
    const edited = edit => { const data = JSON.parse(items.get(SAVE_KEY)); edit(data.settings); if (data.initialSettings) edit(data.initialSettings); return JSON.stringify(data); };
    const today = CLUB_MAPS.find(entry => entry.id === 'mlb').version;
    assert.throws(() => parseCampaign(edited(s => { s.clubScope = 'domestic:mlb'; s.domesticVersion = today; })), /Campaign data set is invalid/);
    assert.ok(CLUBS.every(club => club.id !== 'mlb-oakland-athletics'), 'today\'s Athletics are another club');
  });
});

test('a challenge link to a season\'s nations keeps the manager\'s team once the season loads', async () => {
  await withApp(async ({ app, time }) => {
    const link = readChallenge('?sport=baseball&theatre=CONCACAF&season=mlb-the-show-24&role=manager&team=214&seed=1');
    assert.deepEqual(link.ignored, []);
    app.setState({ setup: link.setup });
    app.showSetupSet();
    time.advance(200);
    await app.loadSet('mlb-the-show-24');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(app.state.setup.clubScope, 'domestic:mlb2022', 'the clubs\' map follows the season');
    assert.equal(app.state.setup.managedTeamId, '214', 'the nations field is unchanged, so the Dominican Republic stays picked');
  });
});

test('baseball\'s Elite 32 is the same nations for every seed, so New draw keeps the team it fielded', async () => {
  await withApp(async ({ app }) => {
    // Most baseball nations tie on strength with generated players, which come from the campaign's draw.
    const setup = { ...app.state.setup, sport: 'baseball', layer: 'nations', scope: 'elite', dataSet: null };
    const fields = [1, 2, 3, 2026, 4294967295].map(seed => app.opening(setup, makeRng(seed)).included.map(team => team.id).sort().join());
    assert.equal(fields[0].split(',').length, 32);
    assert.equal(new Set(fields).size, 1);
  });
});
