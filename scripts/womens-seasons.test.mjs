// The built-in earlier women's football seasons (docs/design/womens-football.md, "Earlier seasons"): FIFA 16 to EA FC 26,
// each EA edition's women from committed snapshots, by the built-in season's rules. EA rated national teams alone until
// FIFA 22 and the women's clubs from FIFA 23; a nation with no rated player fields no team; nothing is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SAVE_KEY } from '../src/config.js';
import { BUILT_IN_WOMENS_SEASONS } from '../src/data/womensFootballSeasons.js';
import { CLUBS } from '../src/data/clubs.womens-football.js';
import { clubLogoFile } from '../src/data/clubLogos.js';
import { CLUB_SCOPES } from '../src/data/scopes.js';
import { buildTeam, makeRng, NATIONS } from '../src/data/teams.js';
import { BUILT_IN_SETS, builtInSeasonOf, decodeFootballSet, fieldedNations, seasonMapOf, seasonSport, setHasClubs, setHasNations,
  setIsMapped, setSportOf, sportOf } from '../src/engine/footballSets.js';
import { parseCampaign } from '../src/engine/storage.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { readChallenge } from '../src/screens/setup/challenge.js';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const MANIFEST = JSON.parse(read('scripts/data/ea-women-seasons.json'));
const TABLE = JSON.parse(read('scripts/data/ea-women-leagues.json'));
const seasonFile = id => JSON.parse(read(`public/womens-football/${id}.json`));
const WOMENS_LEAGUES = new Set([...Object.values(TABLE.leagues).filter(league => league.main).map(league => league.name), TABLE.rest]);
const NATIONS_ONLY = ['eaw-fifa-22', 'eaw-fifa-21', 'eaw-fifa-20', 'eaw-fifa-19', 'eaw-fifa-18', 'eaw-fifa-17', 'eaw-fifa-16'];

// ---------- building ----------

test('every season rebuilds byte for byte from the committed snapshots', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.match(execFileSync(process.execPath, ['scripts/build-womens-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified 11 women's seasons, their listing and audit byte for byte/);
  // The snapshots hold every player of their rosters: nine editions' women from the exports (FIFA 16 and FIFA 19 from the
  // file of every update: FIFA 19's launch roster there is the first after release), FC 25's and FC 26's.
  const lines = file => read(file).trim().split('\n').length - 1;
  assert.equal(lines(MANIFEST.snapshot), 5040);
  assert.deepEqual(MANIFEST.editions.filter(edition => edition.export === 'fifa23').map(edition => [edition.id, edition.update]),
    [['eaw-fifa-19', 3], ['eaw-fifa-16', 3]]);
  assert.deepEqual(MANIFEST.site.map(site => lines(site.snapshot)), [1645, 1576]);
});

test('the seasons run from EA FC 26 back to FIFA 16, newest first, beside the built-in 2026/27', () => {
  assert.deepEqual(BUILT_IN_WOMENS_SEASONS.map(set => [set.id, set.season, set.label]), [
    ['eaw-fc-26', '2025/26', 'EA FC 26'], ['eaw-fc-25', '2024/25', 'EA FC 25'], ['eaw-fc-24', '2023/24', 'EA FC 24'],
    ['eaw-fifa-23', '2022/23', 'FIFA 23'], ['eaw-fifa-22', '2021/22', 'FIFA 22'], ['eaw-fifa-21', '2020/21', 'FIFA 21'],
    ['eaw-fifa-20', '2019/20', 'FIFA 20'], ['eaw-fifa-19', '2018/19', 'FIFA 19'], ['eaw-fifa-18', '2017/18', 'FIFA 18'],
    ['eaw-fifa-17', '2016/17', 'FIFA 17'], ['eaw-fifa-16', '2015/16', 'FIFA 16']]);
  assert.equal(builtInSeasonOf('womens-football').season, '2026/27', 'the built-in season stays the current one');
  for (const listed of BUILT_IN_WOMENS_SEASONS) {
    assert.deepEqual(BUILT_IN_SETS.find(set => set.id === listed.id), listed, `${listed.id} is listed as built`);
    assert.equal(setSportOf(listed.id), 'womens-football');
    assert.ok(setHasNations(listed.id));
    assert.equal(setHasClubs(listed.id), !NATIONS_ONLY.includes(listed.id), `${listed.id}: clubs from FIFA 23 on`);
    assert.ok(!setIsMapped(listed.id) && seasonMapOf(listed.id) == null, 'women\'s clubs play on the world');
    assert.equal(seasonFile(listed.id).version, listed.version);
  }
  // The men's seasons keep their own ids and kind.
  assert.equal(setSportOf('ea-fifa-16'), 'football');
});

// ---------- the seasons ----------

test('every season is EA\'s women of that edition: its rated nations and, from FIFA 23, its clubs', () => {
  for (const listed of BUILT_IN_WOMENS_SEASONS) {
    const doc = seasonFile(listed.id);
    const set = decodeFootballSet(doc, listed.id);
    assert.equal(doc.kind, 'eaw');
    assert.equal(set.meta.source.edition, listed.label);
    // Only nations with a rated player are listed; every other one fields no team and its land stays neutral.
    const listedNations = Object.keys(doc.nations);
    assert.deepEqual([...listedNations, ...doc.territory.inactive].sort(), Object.keys(NATIONS).sort());
    assert.deepEqual(doc.territory.merged, {});
    for (const [nation, [str, pool, squad]] of Object.entries(doc.nations)) {
      assert.ok(squad.length >= 1 && squad.length <= 11 && pool >= squad.length, `${listed.id} ${NATIONS[nation][0]}`);
      assert.ok(squad.every(tuple => tuple[5] && Number.isInteger(tuple[3])), 'EA nationality and overall');
      assert.ok(str >= 1 && str <= 99);
    }
    for (const club of doc.clubs) {
      assert.ok(WOMENS_LEAGUES.has(club.league), `${listed.id} ${club.name}: ${club.league}`);
      assert.match(club.id, /^w-[a-z0-9-]+$/);
      assert.equal(club.squad.length, 11, `${listed.id} ${club.name} fields eleven`);
    }
    for (const [, , , sourceInfo] of Object.values(set.rosters).flatMap(([, , players]) => players)) {
      assert.equal(sourceInfo.source, 'ea-fc');
      assert.equal(sourceInfo.edition, listed.label);
      assert.match(sourceInfo.url, /^https:\/\/sofifa\.com\/player\/\d+\/[a-z0-9-]+\/\d{6}$/);
    }
  }
  const nationsOf = id => Object.keys(seasonFile(id).nations).map(nation => NATIONS[nation][0]).sort();
  assert.deepEqual(nationsOf('eaw-fifa-16'), ['Australia', 'Brazil', 'Canada', 'China', 'England', 'France', 'Germany', 'Italy', 'Mexico',
    'Spain', 'Sweden', 'United States'], 'FIFA 16\'s twelve national teams');
  for (const id of NATIONS_ONLY) assert.deepEqual(seasonFile(id).clubs, [], `${id} has national teams only`);
  assert.deepEqual([...new Set(seasonFile('eaw-fifa-23').clubs.map(club => club.league))].sort(), ['Première Ligue', 'Women\'s Super League']);
  assert.equal(new Set(seasonFile('eaw-fc-24').clubs.map(club => club.league)).size, 6, 'FC 24: five whole leagues and the rest');
});

test('a club keeps its id, crest and colour from season to season, with the name EA gave it that year', () => {
  const club = (id, clubId) => seasonFile(id).clubs.find(entry => entry.id === clubId);
  for (const id of ['eaw-fifa-23', 'eaw-fc-24', 'eaw-fc-25', 'eaw-fc-26']) {
    const arsenal = club(id, 'w-arsenal');
    assert.equal(arsenal?.name, 'Arsenal', `${id}: Arsenal`);
    assert.equal(arsenal.col, CLUBS.find(entry => entry.id === 'w-arsenal').col);
    assert.ok(clubLogoFile('w-arsenal'), 'with its crest');
  }
  assert.equal(club('eaw-fc-25', 'w-ol-lyonnes').name, 'Olympique Lyonnais', 'Lyon before its 2025 rename');
  assert.equal(club('eaw-fc-26', 'w-ol-lyonnes').name, 'OL Lyonnes');
  assert.equal(club('eaw-fc-24', 'w-seattle-reign').name, 'OL Reign', 'Seattle as the 2023 NWSL had it');
  assert.equal(club('eaw-fc-24', 'w-chicago-stars-fc').name, 'Chicago Red Stars');
});

test('the loader refuses a women\'s season that is not the builder\'s', () => {
  const doc = seasonFile('eaw-fc-24');
  const broken = edit => { const copy = JSON.parse(JSON.stringify(doc)); edit(copy); return () => decodeFootballSet(copy, copy.id); };
  assert.throws(broken(d => { d.nations['004'] = [40, 0, []]; }), /has no players: a nation with none is inactive/);
  assert.throws(broken(d => { d.territory.inactive = d.territory.inactive.filter(id => id !== '004'); }), /leaves 004 active with no players/);
  assert.throws(broken(d => { d.territory.inactive.push('724'); }), /makes listed nations 724 inactive/);
  assert.throws(broken(d => { d.clubs[0].id = 'f-barcelona'; }), /must look like "w-<name>"/);
  assert.throws(broken(d => { d.clubs[0].league = 'La Liga'; }), /is not a built-in league/);
  assert.throws(broken(d => { d.kind = 'ea'; }), /is not the kind its id names/);
  const nationsOnly = JSON.parse(JSON.stringify(seasonFile('eaw-fifa-20')));
  nationsOnly.clubs = doc.clubs.slice(0, 1);
  assert.throws(() => decodeFootballSet(nationsOnly, nationsOnly.id), /this season has nations only/);
});

test('a season binds the women\'s game to its nations and clubs; unrated nations field no team', () => {
  const set = decodeFootballSet(seasonFile('eaw-fifa-19'), 'eaw-fifa-19');
  const sport = seasonSport(set);
  assert.deepEqual([sport.id, sport.dataSet, sport.dataSeason, sport.name], ['womens-football', 'eaw-fifa-19', '2018/19', "Women's football"]);
  assert.equal(fieldedNations(sport).length, 14);
  const team = buildTeam('840', makeRng(19), sport);
  assert.deepEqual(team.squad.filter(player => !player.gen).map(player => player.name), set.rosters['840'][2].map(([name]) => name),
    'the 2018/19 United States, as FIFA 19 rated them');
  assert.ok(team.squad.every(player => player.sourceInfo?.edition === 'FIFA 19'));
  const clubs = seasonSport(decodeFootballSet(seasonFile('eaw-fc-24'), 'eaw-fc-24'));
  assert.deepEqual(CLUB_SCOPES(clubs).map(scope => scope.id).slice(0, 2), ['all', 'elite']);
  assert.ok(CLUB_SCOPES(clubs).some(scope => scope.id === 'NWSL'));
  assert.equal(sportOf({ sport: 'womens-football', layer: 'clubs', dataSet: 'eaw-fifa-19' }).dataSet, undefined,
    'a season of national teams leaves clubs to the built-in season');
  assert.equal(sportOf({ sport: 'womens-football', layer: 'nations', dataSet: 'eaw-fifa-18' }), null, 'until it has loaded');
});

test('a challenge link carries a women\'s season, and a season of national teams plays nations', () => {
  const sets = BUILT_IN_SETS;
  const nations = readChallenge('?sport=womens-football&season=eaw-fifa-21&teams=clubs', { sets });
  assert.deepEqual([nations.setup.dataSet, nations.setup.layer], ['eaw-fifa-21', 'nations']);
  const clubs = readChallenge('?sport=womens-football&season=eaw-fc-24&teams=clubs', { sets });
  assert.deepEqual([clubs.setup.dataSet, clubs.setup.layer], ['eaw-fc-24', 'clubs']);
  assert.equal(readChallenge('?sport=football&season=eaw-fc-24', { sets }).setup.dataSet ?? null, null, 'a season stays with its sport');
});

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
  clearFootballSetIndex: ['src/engine/footballSets.js', 'clearFootballSetIndex'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

async function withApp(fn) {
  const calls = [];
  const fetch = async url => {
    calls.push(String(url));
    const [, folder, id] = String(url).match(/^\/(womens-football)\/([0-9A-Za-z-]+)\.json$/) || [];
    let text = null;
    try { text = folder ? read(`public/${folder}/${id}.json`) : null; } catch { text = null; }
    return text ? { ok: true, status: 200, json: async () => JSON.parse(text) }
      : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['840', '124', '250', '276', '826', '724', '004'],
    settings: { sport: 'womens-football', layer: 'nations', scope: 'world', clubScope: 'all', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn({ ...f, calls }); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}
const modelOf = app => buildSetupModel(app.state.setup, { managerTeams: app.setupTeams(), domestic: app.domesticStatus(), season: app.seasonStatus() });

test('the women\'s Season choice lists its seasons; one of national teams keeps Nations, and Clubs leave it', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'womens-football');
    const model = modelOf(app);
    assert.deepEqual(model.season.options.map(option => option.label),
      ['2026/27 · built in', ...BUILT_IN_WOMENS_SEASONS.map(set => `${set.season} · ${set.label}`)]);
    assert.match(model.season.note, /national teams only until 2021\/22/);

    app.pickSetup('dataSet', 'eaw-fifa-19');
    assert.deepEqual([app.state.setup.layer, app.state.setup.dataSet], ['nations', 'eaw-fifa-19']);
    time.advance(200);
    await app.loadSet('eaw-fifa-19');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(modelOf(app).canLaunch, true);
    app.pickSetup('layer', 'clubs');
    assert.equal(app.state.setup.dataSet, null, 'FIFA 19 rated no women\'s club: clubs go back to the built-in season');

    app.pickSetup('dataSet', 'eaw-fc-24');
    assert.deepEqual([app.state.setup.layer, app.state.setup.dataSet], ['clubs', 'eaw-fc-24']);
    app.pickSetup('sport', 'football');
    assert.equal(app.state.setup.dataSet, null, 'a season stays with its sport');
  });
});

test('a season\'s national teams launch with that year\'s players and resume as they were played', async () => {
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'womens-football');
    app.pickSetup('scope', 'world');
    app.pickSetup('dataSet', 'eaw-fifa-20');
    time.advance(200);
    await app.loadSet('eaw-fifa-20');
    await settle();
    const doc = seasonFile('eaw-fifa-20');
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.layer, st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason],
      ['nations', 'eaw-fifa-20', doc.version, 2020, '2019/20']);
    assert.deepEqual(Object.keys(st.teams).sort(), Object.keys(doc.nations).sort(), 'FIFA 20\'s sixteen national teams, and no other');
    assert.deepEqual(st.teams['840'].squad.map(player => [player.name, player.rating]), doc.nations['840'][2].map(tuple => [tuple[1], tuple[3]]));
    assert.ok(calls.includes('/womens-football/eaw-fifa-20.json'));
    const saved = parseCampaign(items.get(SAVE_KEY));
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams));
    const edited = edit => { const data = JSON.parse(items.get(SAVE_KEY)); edit(data.settings); if (data.initialSettings) edit(data.initialSettings); return JSON.stringify(data); };
    assert.throws(() => parseCampaign(edited(s => { s.layer = 'clubs'; })), /Campaign data set is invalid/);
    assert.throws(() => parseCampaign(edited(s => { s.sport = 'football'; })), /Campaign data set is invalid/);
  });
});

test('a season\'s clubs launch in their leagues, on the world, and save', async () => {
  await withApp(async ({ app, time, items }) => {
    app.pickSetup('sport', 'womens-football');
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', 'eaw-fifa-23');
    time.advance(200);
    await app.loadSet('eaw-fifa-23');
    await settle();
    const doc = seasonFile('eaw-fifa-23');
    app.pickSetup('clubScope', 'all');
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.layer, st.settings.dataSet, st.settings.clubScope], ['clubs', 'eaw-fifa-23', 'all']);
    // The test map has seven shapes, so the seven strongest clubs of the 2022/23 WSL and D1 Arkema take them.
    const strongest = doc.clubs.slice().sort((a, b) => b.str - a.str).slice(0, 7);
    assert.deepEqual(Object.keys(st.teams).sort(), strongest.map(club => club.id).sort());
    for (const club of strongest) {
      assert.deepEqual(st.teams[club.id].squad.map(player => player.name), club.squad.map(tuple => tuple[1]), `${club.name} as FIFA 23 rated them`);
    }
    assert.equal(st.teams['w-arsenal'].name, 'Arsenal');
    const saved = parseCampaign(items.get(SAVE_KEY));
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams));
  });
});
