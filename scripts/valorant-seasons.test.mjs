// Valorant's earlier seasons (docs/design/valorant.md, "Earlier seasons"): each year from 2023 to 2025 as the Elo of
// vlr.gg's results stood on its last day, built from committed snapshots; nations only, each player under the nation the
// whole record gives him; each season on its own December's map pool; the loader, the match model, and the running App
// choosing, launching and resuming a season.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SAVE_KEY } from '../src/config.js';
import { BUILT_IN_VALORANT_SEASONS } from '../src/data/valorantSeasons.js';
import { VALORANT_MAP_POOLS } from '../src/data/valorantMapPools.js';
import { HISTORIC_NATIONS, HOME_NATIONS, NATIONS, buildTeam, makeRng } from '../src/data/teams.js';
import {
  BUILT_IN_SETS, builtInSeasonOf, decodeFootballSet, fieldedNations, seasonSport, setHasClubs, setHasNations, setSportOf, sportOf,
} from '../src/engine/footballSets.js';
import { parseCampaign } from '../src/engine/storage.js';
import { matchSport } from '../src/sports/index.js';
import { MAP_POOL, valorant, valorantIn } from '../src/sports/valorant.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { readChallenge } from '../src/screens/setup/challenge.js';
import { ACTIVE_DAYS, MIN_GAMES, gameRating } from './lib/valorant.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const seasonFile = year => JSON.parse(read(`public/valorant/val-${year}.json`));
const snapshot = year => JSON.parse(read(`scripts/data/valorant-seasons/${year}.json`));
const squadNames = (doc, nation) => doc.nations[nation][2].map(([name]) => name);
const YEARS = [2025, 2024, 2023];
const days = (from, to) => (Date.parse(to) - Date.parse(from)) / 86400000;

// ---------- building ----------

test('every season rebuilds byte for byte from its committed snapshot, each a year\'s players as rated on its last day', () => {
  assert.match(execFileSync(process.execPath, ['scripts/build-valorant-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the 3 Valorant seasons, their listing, map pools, attribution and audit byte for byte/);
  for (const year of YEARS) {
    const data = snapshot(year);
    assert.deepEqual([data.season, data.date], [year, `${year}-12-31`]);
    assert.ok(data.to <= data.date && data.from === '2022-09-15');
    assert.equal(data.rated, data.players.length);
    assert.ok(data.players.every((row, i) => i === 0 || row[5] <= data.players[i - 1][5]), `${year} runs strongest first`);
    assert.ok(data.players.every(row => row[6] >= MIN_GAMES), `${year}: ${MIN_GAMES} maps each`);
    assert.ok(data.players.every(row => row[8] <= data.date && days(row[8], data.date) <= ACTIVE_DAYS), `${year}: each played within the year`);
    assert.equal(new Set(data.players.map(row => row[0])).size, data.players.length, `${year}: no player listed twice`);
    assert.equal(data.mapPool.maps, 1000, `${year}: the pool is read off the year's last thousand maps`);
  }
  // The cache begins in September 2022 with 2023's first qualifiers: 2023 is the first whole year, the first season.
  assert.throws(() => read('scripts/data/valorant-seasons/2022.json'));
});

test('the built-in seasons run from 2025 back to 2023', () => {
  assert.deepEqual(BUILT_IN_VALORANT_SEASONS.map(set => set.id), YEARS.map(year => `val-${year}`));
  assert.equal(builtInSeasonOf('valorant').season, '2026', 'the built-in season stays 2026\'s');
  assert.equal(BUILT_IN_VALORANT_SEASONS.find(set => set.year === 2023).label, 'vlr.gg Elo, end of 2023');
  for (const listed of BUILT_IN_VALORANT_SEASONS) {
    const set = BUILT_IN_SETS.find(entry => entry.id === listed.id);
    assert.deepEqual(set, listed, `${listed.id} is listed as built`);
    assert.equal(setSportOf(set.id), 'valorant');
    assert.ok(setHasNations(set.id) && !setHasClubs(set.id), 'nations only');
    assert.equal(seasonFile(set.year).version, listed.version);
  }
});

// ---------- the seasons ----------

test('every season decodes: five to seven players a nation, each his Elo of that day on the game\'s scale', () => {
  for (const year of YEARS) {
    const doc = seasonFile(year);
    const set = decodeFootballSet(doc, doc.id);
    assert.deepEqual([set.meta.year, set.meta.season, doc.clubs.length], [year, String(year), 0]);
    for (const [str, players, squad] of Object.values(doc.nations)) {
      assert.ok(squad.length >= 5 && squad.length <= 7 && players >= squad.length);
      assert.equal(str, Math.round(squad.slice(0, 5).reduce((sum, [, , rating]) => sum + rating, 0) / 5 * 10) / 10, 'its five best play');
      assert.equal(new Set(squad.map(([name]) => name)).size, squad.length, `${year}: a name of his own each`);
      for (const [, pos, rating, source] of squad) {
        assert.equal(pos, 'PLR');
        assert.equal(rating, gameRating(source.rawRating), `${year}: ${source.id} is his Elo on the game's scale`);
        assert.deepEqual([source.source, source.edition, source.snapshotDate, source.rawScale], ['vlr', 'vlr.gg Elo', `${year}-12-31`, 'Elo']);
        assert.ok(source.lastPlayed <= `${year}-12-31` && source.url.startsWith('https://www.vlr.gg/player/'));
      }
    }
    assert.ok(HOME_NATIONS.every(home => doc.territory.merged[home] === '826'), 'Great Britain plays as one');
    assert.equal(doc.coverage.nations, Object.keys(doc.nations).length);
    assert.deepEqual([doc.source.edition, doc.source.name, doc.source.computed], ['vlr.gg Elo', 'vlr.gg', true]);
  }
  // The nations grow with the game's second tier: 48 at the end of 2023, 61 by 2025.
  assert.deepEqual(YEARS.map(year => seasonFile(year).coverage.nations), [61, 60, 48]);
});

test('each season is its day\'s: the United States in 2023 behind EG\'s Demon1 and in 2024, Turkey in 2025', () => {
  const doc = seasonFile(2023);
  assert.deepEqual(squadNames(doc, '840').slice(0, 2), ['neT', 'Demon1']);
  assert.equal(doc.nations['840'][2][1][3].team, 'Evil Geniuses', 'each player\'s team of that December');
  const top = year => Object.entries(seasonFile(year).nations).sort((a, b) => b[1][0] - a[1][0])[0][0];
  assert.deepEqual(YEARS.map(top), ['792', '840', '840']);
  assert.equal(seasonFile(2024).nations['410'][2][0][0], 'Lakia', 'Gen.G\'s Lakia, the year Gen.G won Masters Shanghai');
});

test('each season\'s circuits are on one scale: India below France and Germany at the end of 2024, the VCT\'s levels on top', () => {
  // Before the circuits' levels (2026-11-21) India, of Challengers South Asia, stood level with France and Germany at the end
  // of 2024 (77.6 against 75.4 and 76.6) though South Asia's sides lost far more often than Elo expected outside their circuit.
  const doc = seasonFile(2024);
  const strength = id => doc.nations[id][0];
  assert.ok(strength('356') < strength('250') && strength('356') < strength('276'), 'India below France and Germany');
  assert.ok(strength('840') > strength('360') && strength('410') > strength('360'), 'the United States and South Korea above Indonesia');
  const built = JSON.parse(read('scripts/data/valorant-elo.json'));
  const levels = built.source.starts;
  for (const region of ['Americas', 'EMEA', 'Pacific']) {
    const vct = levels[`VCT ${region}`];
    assert.ok(vct > Math.max(...Object.entries(levels).filter(([circuit]) => circuit.startsWith('Challengers')).map(([, level]) => level)),
      `VCT ${region}'s newcomers start above every Challengers circuit's`);
  }
});

// ---------- the map pool of each season ----------

test('each season plays its December\'s pool, the seven maps most played in its last thousand; today\'s plays today\'s', () => {
  assert.deepEqual(Object.keys(VALORANT_MAP_POOLS).map(Number).sort(), YEARS.slice().sort());
  for (const year of YEARS) {
    const pool = VALORANT_MAP_POOLS[year];
    assert.deepEqual(pool, snapshot(year).mapPool.pool);
    assert.equal(new Set(pool).size, MAP_POOL.length, `${year}: seven maps`);
  }
  // Maps come and go: Abyss came in 2024 and Corrode in 2025, Breeze left after 2023 and came back in 2026, Lotus sat out
  // the end of 2024 and 2025.
  assert.ok(!VALORANT_MAP_POOLS[2023].includes('Abyss') && VALORANT_MAP_POOLS[2024].includes('Abyss'));
  assert.ok(!VALORANT_MAP_POOLS[2024].includes('Corrode') && VALORANT_MAP_POOLS[2025].includes('Corrode'));
  assert.ok(VALORANT_MAP_POOLS[2023].includes('Breeze') && !VALORANT_MAP_POOLS[2025].includes('Breeze'));
  const settings = { sport: 'valorant', layer: 'nations', dataSet: 'val-2023', dataYear: 2023 };
  const sport2023 = matchSport(settings);
  assert.equal(sport2023, valorantIn(settings));
  assert.deepEqual(sport2023.rules.mapPool, VALORANT_MAP_POOLS[2023]);
  assert.equal(sport2023.simulationVersion, valorant.simulationVersion, 'the maps\' names change no result');
  assert.equal(matchSport({ sport: 'valorant', layer: 'nations' }), valorant, 'the built-in season plays today\'s pool');
  assert.equal(matchSport({ ...settings, dataYear: 1999 }), valorant, 'a year the table lacks plays today\'s');
  const set = decodeFootballSet(seasonFile(2023), 'val-2023');
  const bound = seasonSport(set);
  const us = buildTeam('840', makeRng(1), bound), turkey = buildTeam('792', makeRng(2), bound);
  const named = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const then = sport2023.simulate(makeRng(seed), us, turkey, 6);
    const now = valorant.simulate(makeRng(seed), us, turkey, 6);
    assert.deepEqual([then.ga, then.gd, then.winner], [now.ga, now.gd, now.winner], 'the same draws decide the same series');
    for (const e of then.ev) named.add(e.map);
  }
  assert.deepEqual([...named].sort(), VALORANT_MAP_POOLS[2023].slice().sort(), 'every map of the pool, and none other');
});

// ---------- the loader ----------

test('the loader refuses a Valorant season that is not the builder\'s', () => {
  const doc = seasonFile(2023);
  const broken = edit => { const copy = JSON.parse(JSON.stringify(doc)); edit(copy); return () => decodeFootballSet(copy, copy.id); };
  assert.throws(broken(d => { d.season = '2022/23'; }), /season "2022\/23" must be "2023"/);
  assert.throws(broken(d => { d.nations['840'][2] = d.nations['840'][2].slice(0, 4); }), /five to seven players/);
  assert.throws(broken(d => { d.nations['840'][2][1][1] = 'SGL'; }), /position must be PLR/);
  assert.throws(broken(d => { d.nations['840'][2].reverse(); }), /strongest first/);
  assert.throws(broken(d => { d.clubs = [{}]; }), /a Valorant season has nations only/);
  assert.throws(broken(d => { delete d.territory.merged.SCO; }), /home nations in the United Kingdom, as Great Britain plays as one/);
  assert.throws(broken(d => { d.territory.inactive.pop(); }), /every nation the season neither lists nor merges/);
  assert.throws(broken(d => { d.kind = 'rl'; }), /kind "rl" is not the kind its id names/);
});

test('a season binds Valorant to its nations; every other nation\'s land stays neutral', () => {
  const set = decodeFootballSet(seasonFile(2023), 'val-2023');
  const sport = seasonSport(set);
  assert.deepEqual([sport.id, sport.dataSet, sport.dataSeason, sport.nationsOnly], ['valorant', 'val-2023', '2023', true]);
  const fielded = fieldedNations(sport);
  assert.deepEqual(fielded.slice().sort(), Object.keys(set.rosters).sort());
  const team = buildTeam('840', makeRng(2023), sport);
  assert.deepEqual(team.squad.map(player => player.name), squadNames(seasonFile(2023), '840'));
  assert.equal(team.name, 'United States');
  assert.equal(buildTeam('826', makeRng(1), sport).name, 'Great Britain');
  assert.equal(sportOf({ sport: 'valorant', layer: 'nations', dataSet: 'val-2023' }), null, 'until it has loaded');
  assert.equal(Object.keys(NATIONS).length - HISTORIC_NATIONS.length, set.territory.inactive.length + Object.keys(set.territory.merged).length + fielded.length);
});

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
  clearFootballSetIndex: ['src/engine/footballSets.js', 'clearFootballSetIndex'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

// The United States, Turkey, South Korea, Canada, Brazil and Japan: each fields a team in every season.
async function withApp(fn, ids = ['840', '792', '410', '124', '076', '392']) {
  const calls = [];
  const fetch = async url => {
    calls.push(String(url));
    const [, id] = String(url).match(/^\/valorant\/(val-\d{4})\.json$/) || [];
    let text = null;
    try { text = id && read(`public/valorant/${id}.json`); } catch { text = null; }
    return text ? { ok: true, status: 200, json: async () => JSON.parse(text) }
      : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids,
    settings: { sport: 'valorant', layer: 'nations', scope: 'world', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn({ ...f, calls }); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}
const modelOf = app => buildSetupModel(app.state.setup, { managerTeams: app.setupTeams(), domestic: app.domesticStatus(), season: app.seasonStatus() });

test('Valorant\'s Season choice lists 2026 and the three earlier seasons, newest first', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'valorant');
    const model = modelOf(app);
    assert.deepEqual(model.season.options.map(option => option.name), ['2026', ...YEARS.map(String)]);
    assert.equal(model.season.options[1].label, '2025 · vlr.gg Elo, end of 2025');
    assert.match(model.season.note, /at the end of each year from 2023, each year on its own map pool/);
    app.pickSetup('dataSet', 'val-2023');
    assert.deepEqual([app.state.setup.layer, app.state.setup.dataSet], ['nations', 'val-2023']);
    time.advance(200);
    await app.loadSet('val-2023');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(modelOf(app).canLaunch, true);
    app.pickSetup('sport', 'rocket-league');
    assert.equal(app.state.setup.dataSet, null, 'a season stays with its sport');
  });
});

test('a season launches with that year\'s nations, plays its pool and resumes as it was played', async () => {
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'valorant');
    app.pickSetup('scope', 'world');
    app.pickSetup('dataSet', 'val-2023');
    time.advance(200);
    await app.loadSet('val-2023');
    await settle();
    const doc = seasonFile(2023);
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.layer, st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason],
      ['nations', 'val-2023', doc.version, 2023, '2023']);
    assert.ok(calls.includes('/valorant/val-2023.json'));
    assert.deepEqual(st.teams['840'].squad.map(player => player.name), squadNames(doc, '840'), 'neT\'s and Demon1\'s United States');
    assert.ok(st.teams['840'].squad.every(player => player.sourceInfo.edition === 'vlr.gg Elo' && !player.gen));
    assert.deepEqual(matchSport(st.settings).rules.mapPool, VALORANT_MAP_POOLS[2023]);
    const saved = parseCampaign(items.get(SAVE_KEY));
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams), 'the squads come back exactly');
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams));
  });
});

test('a challenge link to a Valorant season loads it', async () => {
  await withApp(async ({ app, time }) => {
    const link = readChallenge('?sport=valorant&theatre=world&season=val-2024&seed=1');
    assert.deepEqual(link.ignored, []);
    app.setState({ setup: link.setup });
    app.showSetupSet();
    time.advance(200);
    await app.loadSet('val-2024');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(app.state.setup.dataSet, 'val-2024');
  });
});
