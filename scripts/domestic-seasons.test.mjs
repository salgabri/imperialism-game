// Acceptance checks for the earlier seasons' own country maps (docs/design/domestic-campaigns.md, "Earlier seasons"):
// public/domestic/<country>y<year>.json against the index, the season files, the homes and the game's own loader.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DOMESTIC_SEASON_ROWS } from '../src/data/domesticSeasons.js';
import { BUILT_IN_SEASONS } from '../src/data/footballSeasons.js';
import { domesticCap } from '../src/data/domesticTiers.js';
import { NATIONS, buildClub, selectLineup } from '../src/data/teams.js';
import { decodeDomestic, DOMESTIC_FORMAT, DOMESTIC_SECTIONS, seasonCountry } from '../src/engine/domestic.js';
import { expandSetPlayer, isEraMap, isSeasonCountryMap, setKindOf } from '../src/engine/footballSets.js';
import { countryMapOf, countryMapsOf, domesticEntry, domesticLabel, isCountryScope, SEASON_COUNTRY_MAPS } from '../src/data/domesticScope.js';
import { MIN_CLUBS } from './lib/domestic-sync.mjs';
import { homeInSeason, locateSeasonClubs } from './lib/season-club-homes.mjs';
import { rememberStronger, secondTeamReason } from './lib/season-country-clubs.mjs';
import { CM0102_RELEASES } from '../src/data/cm0102Releases.js';
import { parseCampaign } from '../src/engine/storage.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';
import { challengeQuery, readChallenge } from '../src/screens/setup/challenge.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const shippedDir = path.join(root, 'public/domestic');
const FILE = /^(\d{3}|[A-Z]{3})y(\d{4})\.json$/;
const MAX_BYTES = 250000;
const shipped = readdirSync(shippedDir).filter(f => FILE.test(f)).map(f => f.slice(0, -5)).sort();
const homes = JSON.parse(readFileSync(path.join(root, 'scripts/data/season-club-homes.json'), 'utf8')).clubs;
const audit = JSON.parse(readFileSync(path.join(root, 'docs/design/domestic-seasons-audit.json'), 'utf8'));
const attribution = readFileSync(path.join(shippedDir, 'ATTRIBUTION-seasons.txt'), 'utf8');
const UPDATES = JSON.parse(readFileSync(path.join(root, 'scripts/data/cm0102-updates.json'), 'utf8')).releases;
/** The Update Team release that fills an EA season's countries (its season's), or null. */
const updateTeamRelease = season => {
  const year = BUILT_IN_SEASONS.find(entry => entry.id === season)?.year;
  return UPDATES.find(release => release.season === `${year - 1}/${String(year % 100).padStart(2, '0')}`) ?? null;
};
const seasonFiles = new Map();
const seasonFile = id => {
  if (!seasonFiles.has(id)) seasonFiles.set(id, JSON.parse(readFileSync(path.join(root, 'public/football', `${id}.json`), 'utf8')));
  return seasonFiles.get(id);
};

test("a season's reserve sides stay off its country maps; a first team named II stays on", () => {
  // Each country's clubs strongest first, as countryFields reads them: a second team's marker counts only when the rest
  // of its name is a stronger club's, shortened or spelt as the season's source spells it.
  const reasons = clubs => {
    const stronger = { folded: new Set(), words: [] };
    return clubs.map(([name, key]) => {
      const club = { name, short: null, league: 'A league', key: key ?? `test:${name}` };
      const reason = secondTeamReason(club, stronger);
      rememberStronger(stronger, club);
      return reason;
    });
  };
  assert.deepEqual(reasons([['Ajax'], ['PSV'], ['Willem II'], ['Jong Ajax'], ['Jong Rambaan']]), [null, null, null, 'reserve side', null]);
  assert.deepEqual(reasons([['Borussia Dortmund'], ['SpVgg Greuther Fürth'], ['Tennis Borussia Berlin'], ['B. Dortmund II'],
    ['SpVgg Gr. Fürth Amateure'], ['Tennis Borussia Amateure'], ['FC Bayern Hof']]), [null, null, null, 'reserve side', 'reserve side', 'reserve side', null]);
  assert.deepEqual(reasons([['Athletic Club', 'swos:035:ATHLETIC BILBAO'], ['Real Madrid'], ['Ath. Bilbao B', 'swos:035:ATH. BILBAO B'],
    ['Real Madrid Castilla']]), [null, null, 'reserve side', 'reserve side']);
  assert.deepEqual(reasons([['Dinamo Kiev'], ['Metallurg Donetsk'], ['Dinamo-2 Kiev'], ['Metalurg-2 Donetsk'], ['Dinamo-Yuni Kiev']]),
    [null, null, 'reserve side', 'reserve side', 'reserve side']);
  assert.deepEqual(reasons([['Boca Juniors'], ['Argentinos Juniors'], ['Argentina U-20']]), [null, null, 'youth side']);
  // On the maps: Willem II plays every Dutch season that rates it; no German Amateure side takes a senior club's place.
  const names = id => JSON.parse(readFileSync(path.join(root, `public/domestic/${id}.json`), 'utf8')).clubs.map(club => club.name);
  for (const id of ['528y2016', '528y2004', '528y1996']) assert.ok(names(id).includes('Willem II'), id);
  for (const id of ['276y2000', '276y2001', '276y2002', '276y2003', '276y2004']) assert.ok(!names(id).some(name => /Amateure$/.test(name)), id);
});

test("a hand override gives a club today's club's home, its crest at another ground, or a point; a club that moved, each season's ground", async () => {
  const FCSB = { lon: 26.1525, lat: 44.4372, source: 'map:d642-1', label: 'FCSB', twin: 'd642-1' };
  const GHENCEA = { lon: 26.0404, lat: 44.4128, note: 'Ghencea' }, REGIE = { lon: 26.0529, lat: 44.4482, note: 'Regie' };
  const locate = overrides => locateSeasonClubs({ nation: { id: '642', name: 'Romania' }, clubs: Object.keys(overrides).map(name => ({ name })),
    snapshot: { clubs: [{ fm: 1, name: 'FCSB', location: { lon: FCSB.lon, lat: FCSB.lat } }] }, overrides });
  const found = await locate({
    Today: { as: 'd642-1' },
    Then: { as: 'd642-1', ...GHENCEA },
    Moved: { as: 'd642-1', note: 'FCSB', eras: [{ from: 2009, through: 2015, ...GHENCEA }] },
    Twice: { ...GHENCEA, eras: [{ from: 1995, through: 1997, ...REGIE }, { from: 2003, through: 2003, lon: 1, lat: 2 }] },
    Nowhere: { unplaced: true },
  });
  const ghencea = { lon: 26.0404, lat: 44.4128, source: 'override', label: 'Ghencea' };
  assert.deepEqual(found.get('Today'), FCSB);
  assert.deepEqual(found.get('Then'), { ...ghencea, twin: 'd642-1' }, "the twin's crest at the ground of the time");
  assert.deepEqual(found.get('Moved'), { ...FCSB, eras: [{ from: 2009, through: 2015, ...ghencea }] });
  assert.equal(found.has('Nowhere'), false);
  // The ground of a season: its era's, whose last year counts, else the home; its twin either way.
  const at = (name, year) => homeInSeason(found.get(name), year);
  assert.deepEqual([2008, 2009, 2015, 2016].map(year => at('Moved', year)), [FCSB, { ...ghencea, twin: 'd642-1' }, { ...ghencea, twin: 'd642-1' }, FCSB]);
  assert.deepEqual([1996, 1998, 2003].map(year => [at('Twice', year).lon, at('Twice', year).lat]), [[26.0529, 44.4482], [26.0404, 44.4128], [1, 2]]);
  assert.deepEqual(at('Today', 2003), FCSB);
  assert.equal(homeInSeason(null, 2003), null);
  // An era without its point or its years, or out of order, and eras with no home to leave, are mistakes.
  for (const eras of [[{ from: 2009, through: 2015 }], [{ through: 2015, ...GHENCEA }], [{ from: 2015, through: 2009, ...GHENCEA }],
    [{ from: 2009, through: 2012, ...GHENCEA }, { from: 2012, through: 2015, ...REGIE }]]) {
    await assert.rejects(locate({ Moved: { as: 'd642-1', eras } }), /Moved: each era of an override/, JSON.stringify(eras));
  }
  await assert.rejects(locate({ Moved: { eras: [{ from: 2009, through: 2015, ...GHENCEA }] } }), /Moved has eras but no home/);
});

test('clubs once placed as another club, in a namesake town or at a ground of another time stand at their own', () => {
  const clubs = new Map();
  const club = (id, name) => {
    if (!clubs.has(id)) clubs.set(id, JSON.parse(readFileSync(path.join(shippedDir, `${id}.json`), 'utf8')).clubs);
    return clubs.get(id).find(entry => entry.name === name);
  };
  for (const [id, name, home, twin] of [
    // A reserve side's or another club's Wikidata item.
    ['804y2019', 'Arsenal Kyiv', [30.5352, 50.4504]], ['804y2014', 'Metalurh Donetsk', [37.7981, 47.9732]], ['804y2009', 'FC Borysfen Boryspil', [30.9522, 50.3541]],
    ['804y2013', 'FC Sevastopol', [33.542, 44.6026]], ['156y2018', 'Shenzhen', [114.2122, 22.6971]], ['428y2015', 'Skonto', [24.1164, 56.9614]],
    ['250y2008', 'Chamois Niortais Football Club', [-0.4896, 46.3171]], ['056y2002', 'Verbroedering Denderhoutem', [4.0182, 50.8723]],
    // Another club's twin, by a word of their names: its own twin, or none.
    ['804y2018', 'Desna Chernihiv', [31.3272, 51.5017]], ['804y2020', 'Balkany Zoria', [29.694, 46.0011]], ['398y2025', 'Zhenis Astana', [71.4133, 51.1627], 'd398-59016973'],
    ['300y2019', 'Platanias Chania', [24.0006, 35.4873]], ['300y2019', 'Olympiakos Volos', [22.9677, 39.3555]], ['688y2002', 'Zeleznicar Belgrade', [20.4476, 44.8005]],
    // A namesake town.
    ['380y2003', 'San Marino', [12.477, 43.9712]], ['818y2020', 'Masr El Makasa', [30.84, 29.318]], ['360y2013', 'Persatuan Sepak Bola Pelita Jaya', [107.3062, -6.3026]],
    ['484y2003', 'Club Leones de Zacatepec', [-99.192, 18.6551]], ['484y1996', 'Zacatepec', [-99.192, 18.6551]],
    // The ground of the season: Dnipro's, Steaua's, Karagümrük's and İstanbul Büyükşehir Belediyespor's moves; Rapid's, not Sportul's.
    ['804y2008', 'Dnipro Dnipropetrovsk', [35.0056, 48.4356]], ['804y2009', 'Dnipro Dnipropetrovsk', [35.0325, 48.4603]],
    ['642y2015', 'Steaua Bucuresti', [26.0404, 44.4128], 'd642-1513'], ['642y2016', 'Steaua Bucuresti', [26.1525, 44.4372], 'd642-1513'],
    ['642y2003', 'Rapid Bucharest', [26.0568, 44.4559], 'd642-57171586'], ['642y2003', 'Sportul Studentesc Bucharest', [26.0529, 44.4482]],
    ['792y2012', 'Fatih Karagümrük', [28.939, 41.0278], 'd792-458631'], ['792y2021', 'Fatih Karagümrük', [28.7657, 41.0745], 'd792-458631'],
    ['792y2004', 'Istanbul Büyüksehir Belediye Spor', [28.9053, 41.0382], 'd792-130343'], ['792y2012', 'Istanbul Büyüksehir Belediye Spor', [28.7657, 41.0745], 'd792-130343'],
  ]) {
    const found = club(id, name);
    assert.ok(found, `${id} ${name}`);
    assert.deepEqual(found.home, home, `${id} ${name}`);
    assert.equal(found.twin, twin, `${id} ${name}: twin`);
  }
  // Nikšić is off Serbia's map, as Montenegro's other clubs of these seasons are: an estimate, not the village of Sutjeska.
  assert.match(club('688y2003', 'Sutjeska Niksic').homeSource, /^placed:/);
});

test('the index lists every shipped season map once, by season and country', () => {
  const ids = SEASON_COUNTRY_MAPS.map(entry => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate map ids');
  assert.deepEqual([...ids].sort(), shipped, 'the index and public/domestic/<country>y<year>.json differ');
  assert.deepEqual(DOMESTIC_SEASON_ROWS.map(([, year]) => year), DOMESTIC_SEASON_ROWS.map(([, year]) => year).slice().sort((a, b) => b - a), 'newest season first');
  for (const [season, year, maps] of DOMESTIC_SEASON_ROWS) {
    const listed = BUILT_IN_SEASONS.find(entry => entry.id === season);
    assert.ok(listed, `${season} is no built-in season`);
    assert.equal(listed.year, year, `${season}'s year`);
    assert.equal(new Set(maps.map(([country]) => country)).size, maps.length, `${season} lists a country twice`);
  }
  assert.deepEqual(audit.maps.map(entry => entry.id).sort(), shipped, 'the audit and the maps differ');
  for (const id of shipped) assert.ok(attribution.includes(`${id} `), `ATTRIBUTION-seasons.txt lacks ${id}`);
});

test('a country scope follows the season: today\'s map, or that season\'s own', () => {
  const england = SEASON_COUNTRY_MAPS.find(entry => entry.country === '826');
  assert.ok(england, 'England has a map in some earlier season');
  assert.equal(countryMapOf('826', null)?.id, '826');
  assert.equal(countryMapOf('826', england.season)?.id, england.id);
  assert.ok(isCountryScope(`domestic:${england.id}`));
  assert.equal(domesticEntry(`domestic:${england.id}`), england);
  assert.equal(domesticLabel(`domestic:${england.id}`), `England · top ${england.clubs} clubs`);
  assert.ok(countryMapsOf(england.season).every(entry => entry.season === england.season));
  assert.ok(isEraMap(england.id) && isSeasonCountryMap(england.id, england.season));
  assert.ok(!isSeasonCountryMap(england.id, 'ea-fc-24') || england.season === 'ea-fc-24');
  assert.ok(!isEraMap('826') && !isSeasonCountryMap('826', england.season), "today's England is no season's");
});

for (const entry of SEASON_COUNTRY_MAPS) {
  test(`${entry.id} ${entry.name} ${entry.season}: shipped season map`, () => {
    const file = path.join(shippedDir, `${entry.id}.json`);
    assert.ok(statSync(file).size <= MAX_BYTES, `${statSync(file).size} bytes > ${MAX_BYTES}`);
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    const { id, country, season, clubs: n } = entry;
    const set = seasonFile(season);

    // Header, version hash and index entry: the country, its name, the season and its players' kind and source.
    assert.equal(doc.format, DOMESTIC_FORMAT);
    assert.equal(doc.id, id);
    assert.equal(doc.name, NATIONS[country][0]);
    assert.equal(doc.country, country);
    assert.equal(doc.season, season);
    assert.equal(doc.year, set.year);
    // A country the EA edition rates too few clubs of takes the season's CM 01/02 Update Team database (cm0102-updates.json).
    const fill = updateTeamRelease(season);
    if (doc.kind === 'cm0102' && setKindOf(season) === 'ea') {
      assert.ok(fill, `${season} has no Update Team database`);
      assert.deepEqual([doc.source.provider, doc.source.compiler], ['CM 01/02 Update Team', 'CM 01/02 Update Team'], 'the Update Team credited');
      assert.equal(doc.source.version, CM0102_RELEASES.find(release => release.id === fill.id).label, "the release's label");
    } else {
      assert.equal(doc.kind, setKindOf(season));
      assert.deepEqual(doc.source, set.source, "the season file's source");
    }
    assert.ok(seasonCountry(doc));
    const { version, ...rest } = doc;
    assert.equal(version, `${id}-${createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 8)}`, 'version is not the content hash');
    assert.equal(audit.maps.find(a => a.id === id)?.version, version, 'the audit names another build');

    // 100 sections in club rank order, home first, in groups of floor or ceil(100 / N).
    const S = DOMESTIC_SECTIONS;
    assert.equal(doc.clubs.length, n);
    assert.ok(n >= MIN_CLUBS && n <= domesticCap(country), `N = ${n}, tier ${domesticCap(country)}`);
    const geoms = doc.topology.objects.sections.geometries;
    const sectionIds = geoms.map(g => g.id);
    assert.deepEqual(sectionIds, Array.from({ length: S }, (_, k) => `${id}-${String(k + 1).padStart(3, '0')}`), 'section ids');
    assert.deepEqual(doc.clubs.flatMap(c => c.sections), sectionIds, 'club groups do not list every section once, in club rank order');
    const q = Math.floor(S / n), sizes = doc.clubs.map(c => c.sections.length);
    assert.ok(sizes.every(k => k === q || k === q + 1), `group sizes ${[...new Set(sizes)].join('/')}`);
    assert.equal(sizes.filter(k => k === q + 1).length, S - q * n, 'number of larger groups');

    // Clubs: the season's ids and squads, strongest first, each its lineup's rating, its home as the homes file has it.
    assert.equal(new Set(doc.clubs.map(c => c.id)).size, n, 'duplicate club ids');
    assert.equal(new Set(doc.clubs.map(c => c.code)).size, n, 'duplicate codes');
    const ofSeason = new Map(set.clubs.map(club => [club.id, club]));
    const strengths = doc.clubs.map(club => club.str);
    assert.deepEqual(strengths, strengths.slice().sort((a, b) => b - a), 'clubs strongest first');
    for (const club of doc.clubs) {
      const label = `${id} ${club.name}`;
      assert.match(club.id, /^f-[a-z0-9-]{1,62}$/, `${label}: id`);
      assert.ok(typeof club.league === 'string' && club.league.trim(), `${label}: league`);
      assert.ok(club.squad.length >= 11, `${label}: ${club.squad.length} players`);
      const squad = club.squad.map(tuple => expandSetPlayer(tuple, doc.source, doc.kind));
      assert.ok(squad.some(player => player[3].positions.includes('GK')), `${label}: no natural goalkeeper`);
      assert.equal(new Set(club.squad.map(t => t[0])).size, club.squad.length, `${label}: duplicate players`);
      assert.equal(club.str, selectLineup(buildClub({ ...club, squad }, { id: 'football' })).rating, `${label}: str`);
      // A club the season file has (on its Europe maps) fields the same players there.
      const same = ofSeason.get(club.id);
      if (same) {
        assert.equal(same.name, club.name, `${label}: the season file's ${club.id} is ${same.name}`);
        assert.deepEqual(same.squad, club.squad, `${label}: squad differs from the season file's`);
      }
      const listed = homes[country]?.[club.name];
      assert.ok(listed !== undefined, `${label}: not in scripts/data/season-club-homes.json`);
      const home = homeInSeason(listed, doc.year);
      if (/^placed:\d+$/.test(club.homeSource ?? '')) assert.ok(club.home.every(Number.isFinite), `${label}: placed home`);
      else if (club.home) {
        assert.deepEqual(club.home, [home.lon, home.lat], `${label}: home`);
        assert.equal(club.homeSource, home.source);
      }
      if (club.twin != null) assert.equal(club.twin, home?.twin, `${label}: twin`);
    }

    // The game's own loader accepts it and builds the season's players.
    const decoded = decodeDomestic(doc, id);
    assert.equal(decoded.clubs.length, n);
    assert.equal(decoded.clubs[0].squad.length, doc.clubs[0].squad.length);
    for (const sid of sectionIds) {
      const p = decoded.geo.paths[sid];
      assert.ok(p && Number.isFinite(p.cx) && Number.isFinite(p.cy) && p.area > 0, `${sid} does not decode to a finite, non-empty shape`);
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
const read = file => readFileSync(path.join(root, file), 'utf8');

async function withApp(fn) {
  const fetch = async url => {
    const at = String(url);
    if (/^\/(?:domestic|football)\/[0-9A-Za-z-]+\.json$/.test(at)) return { ok: true, status: 200, json: async () => JSON.parse(read(`public${at}`)) };
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

/** The fields of a checkpoint parseCampaign reads, from the App's state. */
function checkpoint(state) {
  const { teams, own, aliveIds, fallen, stats, log, round, matches, queue, batchTotal, history, seed, rngState, settings, initialSettings, campaignId, revision, campaignName, startedAt } = state;
  return { teams, own, aliveIds, fallen, stats, log, round, matches, queue, batchTotal, history, seed, rngState, settings, initialSettings, campaignId, revision, campaignName, startedAt, phase: 'playing' };
}

test("a country chosen for an earlier season plays that season's own map, clubs and players, and saves", async () => {
  const england = SEASON_COUNTRY_MAPS.find(entry => entry.country === '826' && entry.season === 'ea-fifa-16');
  assert.ok(england, 'England has a map of 2015/16');
  await withApp(async ({ app, time }) => {
    app.pickSetup('layer', 'clubs');
    app.pickSetup('clubScope', 'domestic:826');
    app.pickSetup('dataSet', 'ea-fifa-16');
    assert.equal(app.state.setup.clubScope, `domestic:${england.id}`, 'the country follows the season');
    const model = buildSetupModel(app.state.setup, { season: app.seasonStatus() });
    assert.ok(model.domesticScopes.some(row => row.id === `domestic:${england.id}` && row.count === england.clubs), "the season's countries are listed");
    assert.ok(model.domesticScopes.every(row => domesticEntry(row.id)?.season === 'ea-fifa-16'), 'and only they');
    time.advance(200);
    await app.loadSet('ea-fifa-16');
    await app.loadCountry(england.id);
    await settle();
    app.startCampaign();
    const { state } = app;
    assert.equal(state.phase, 'playing');
    assert.equal(state.settings.dataSet, 'ea-fifa-16');
    const doc = JSON.parse(read(`public/domestic/${england.id}.json`));
    assert.equal(state.settings.domesticVersion, doc.version);
    assert.deepEqual(Object.keys(state.teams).sort(), doc.clubs.map(club => club.id).sort(), "the season's clubs of England");
    const top = doc.clubs[0];
    assert.equal(state.teams[top.id].squad.length, top.squad.length, "with the season's own players");
    assert.equal(state.teams[top.id].squad[0].sourceInfo.edition, 'FIFA 16');
    const saved = parseCampaign(JSON.stringify({ v: 2, ...checkpoint(state) }));
    assert.equal(saved.settings.clubScope, `domestic:${england.id}`, 'a save of it passes the checks');
    // The map plays only with its own season: a save naming another season, or none, is refused.
    for (const dataSet of [null, 'ea-fifa-11']) {
      const other = checkpoint(state);
      const settings = { ...other.settings, dataSet, ...(dataSet ? { dataVersion: `${dataSet}-00000000`, dataYear: 2011, dataSeason: '2010/11' }
        : { dataVersion: undefined, dataYear: undefined, dataSeason: undefined }) };
      assert.throws(() => parseCampaign(JSON.stringify({ v: 2, ...other, settings, initialSettings: settings })), /data set is invalid/, `refused with ${dataSet}`);
    }
    // Resumed, it plays on the same map with the same players.
    app.openSetup();
    app.continueSaved(saved);
    for (let i = 0; i < 5 && app.state.phase !== 'playing'; i++) await settle();
    assert.equal(app.state.phase, 'playing', 'it resumes');
    assert.equal(app.state.settings.clubScope, `domestic:${england.id}`);
    assert.deepEqual(app.state.teams[top.id].squad.map(p => p.name), state.teams[top.id].squad.map(p => p.name));
  });
});


test("a challenge link to a season's country map names the map and its season, and opens on them", () => {
  const england = SEASON_COUNTRY_MAPS.find(entry => entry.country === '826' && entry.season === 'ea-fifa-16');
  const query = challengeQuery({ sport: 'football', layer: 'clubs', clubScope: `domestic:${england.id}`, dataSet: 'ea-fifa-16', seed: '7' });
  assert.match(query, new RegExp(`theatre=domestic:${england.id}`));
  assert.match(query, /season=ea-fifa-16/);
  const { setup, ignored } = readChallenge(`?${query}`);
  assert.deepEqual(ignored, []);
  assert.equal(setup.clubScope, `domestic:${england.id}`);
  assert.equal(setup.dataSet, 'ea-fifa-16');
  // Another season's map with this season gives way to this season's own map of the country.
  const other = readChallenge(`?teams=clubs&theatre=domestic:${england.id}&season=ea-fifa-11`);
  assert.deepEqual(other.ignored, ['theatre']);
});
