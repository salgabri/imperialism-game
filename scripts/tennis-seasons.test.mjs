// Tennis's earlier seasons (docs/design/tennis.md, "Earlier seasons"): Tennis Abstract's own year-end Elo reports for
// 2016-2025 and Elo computed from Jeff Sackmann's match results by Tennis Abstract's method for 1973-2015, built from
// committed snapshots; the Davis Cup's nations of each season (Czechoslovakia, the Soviet Union, Yugoslavia, West
// Germany on today's map, South Africa barred); the per-season shift that keeps the best at 99; the method's checks
// against every list Tennis Abstract published; the loader and the running App choosing, launching and resuming a season.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SAVE_KEY } from '../src/config.js';
import { BUILT_IN_TENNIS_SEASONS } from '../src/data/tennisSeasons.js';
import { HOME_NATIONS, NATIONS, makeRng, buildTeam } from '../src/data/teams.js';
import { BUILT_IN_SETS, builtInSeasonOf, decodeFootballSet, fieldedNations, seasonSport, setHasClubs, setHasNations, setSportOf, sportOf } from '../src/engine/footballSets.js';
import { parseCampaign } from '../src/engine/storage.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { readChallenge } from '../src/screens/setup/challenge.js';
import { gameRating } from './lib/tennis.mjs';
import { codeOfDay, nationOfDay, teamsOf } from './lib/tennis-seasons.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const MANIFEST = JSON.parse(read('scripts/data/tennis-seasons.json'));
const VALIDATION = JSON.parse(read('scripts/data/tennis-seasons/validation.json'));
const seasonFile = year => JSON.parse(read(`public/tennis/tennis-${year}.json`));
const snapshot = year => JSON.parse(read(`scripts/data/tennis-seasons/${year}.json`));
const squadNames = (doc, nation) => doc.nations[nation][2].map(([name]) => name);
const YEARS = Array.from({ length: 2025 - 1973 + 1 }, (_, i) => 2025 - i);

// ---------- building ----------

test('every season rebuilds byte for byte from its committed snapshot, and the snapshots from the pinned inputs', () => {
  assert.match(execFileSync(process.execPath, ['scripts/build-tennis-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the 53 tennis seasons, their listing, attribution and audit byte for byte/);
  // The snapshots rebuild from the archive and the captures, cached in the ignored data-src/ (not on a fresh checkout).
  const cached = Object.keys(MANIFEST.archive.files).every(file => existsSync(`${root}/data-src/tennis-seasons/sackmann/${file}`))
    && MANIFEST.reports.every(report => existsSync(`${root}/data-src/tennis-seasons/wayback/elo_${report.capture}.html`))
    && MANIFEST.rankings.every(capture => existsSync(`${root}/data-src/tennis-seasons/wayback/rank_${capture.capture}.html`));
  if (cached) {
    assert.match(execFileSync(process.execPath, ['scripts/sync-tennis-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
      /Verified the 53 tennis season snapshots and their validation byte for byte/);
  }
  for (const year of YEARS) {
    const data = snapshot(year);
    assert.equal(data.season, year);
    assert.equal(data.kind, year >= 2016 ? 'published' : 'computed');
    assert.equal(data.rated, data.players.length);
    assert.ok(data.players.every((row, i) => i === 0 || row[5] <= data.players[i - 1][5]), `${year} runs strongest first`);
    if (data.kind === 'computed') assert.ok(data.players.every(row => row[6] >= MANIFEST.method.activity), `${year}: ten counted matches each`);
  }
  // Every input is pinned: the 107 files of Sackmann's archive and the 19 captures.
  assert.equal(Object.keys(MANIFEST.archive.files).length, 107);
  assert.ok(Object.values(MANIFEST.archive.files).every(hash => /^[0-9a-f]{64}$/.test(hash)));
  assert.ok([...MANIFEST.reports, ...MANIFEST.rankings].every(entry => /^[0-9a-f]{64}$/.test(entry.sha256) && /^\d{14}$/.test(entry.capture)));
});

test('the built-in seasons run from 2025 back to 1973: Tennis Abstract\'s own lists, then Elo computed by its method', () => {
  assert.deepEqual(BUILT_IN_TENNIS_SEASONS.map(set => set.id), YEARS.map(year => `tennis-${year}`));
  assert.equal(builtInSeasonOf('tennis').season, '2026', 'the built-in season stays November 2026\'s');
  const label = year => BUILT_IN_TENNIS_SEASONS.find(set => set.year === year).label;
  assert.equal(label(2023), 'Tennis Abstract Elo, December 2023');
  assert.equal(label(2019), 'Tennis Abstract Elo, December 2019');
  assert.equal(label(2017), 'Tennis Abstract Elo, through the ATP Finals', 'the 2017 list never took in the Davis Cup final');
  assert.equal(label(1985), 'Elo from match results, end of 1985');
  assert.equal(label(1975), 'Elo from match results, end of 1975 (rough)', 'the 1970s are rougher, and say so');
  for (const listed of BUILT_IN_TENNIS_SEASONS) {
    assert.ok(listed.label.length <= 44, `${listed.id}'s label is short`);
    const set = BUILT_IN_SETS.find(entry => entry.id === listed.id);
    assert.deepEqual(set, listed, `${listed.id} is listed as built`);
    assert.equal(setSportOf(set.id), 'tennis');
    assert.ok(setHasNations(set.id) && !setHasClubs(set.id), 'nations only');
    assert.equal(seasonFile(set.year).version, listed.version);
  }
});

// ---------- the seasons ----------

test('every season decodes: two to five men a nation, each his source\'s Elo on the game\'s scale, shifted so the best is 99', () => {
  for (const year of YEARS) {
    const doc = seasonFile(year);
    const set = decodeFootballSet(doc, doc.id);
    assert.deepEqual([set.meta.year, set.meta.season, doc.clubs.length], [year, String(year), 0]);
    const shift = doc.source.shift ?? 0;
    const squads = Object.values(doc.nations).map(([, , squad]) => squad);
    for (const squad of squads) {
      assert.ok(squad.length >= 2 && squad.length <= 5);
      for (const [, pos, rating, source] of squad) {
        assert.equal(pos, 'SGL');
        assert.equal(rating, gameRating(source.rawRating) - shift, `${year}: ${source.id} is his Elo on the game's scale`);
        assert.equal(source.rawScale, 'Elo');
      }
    }
    const best = Math.max(...squads.flat().map(([, , rating]) => rating));
    assert.ok(best <= 99, `${year}: nobody over 99`);
    if (shift) assert.equal(best, 99, `${year}: a shifted season's best is 99`);
    assert.ok(HOME_NATIONS.every(home => doc.territory.merged[home] === '826'), 'Great Britain plays as one');
    assert.equal(doc.coverage.nations, Object.keys(doc.nations).length);
    assert.equal(doc.source.licence, 'CC BY-NC-SA 4.0');
    if (year >= 2016) {
      assert.equal(doc.source.edition, 'Tennis Abstract Elo');
      assert.match(doc.source.url, /^https:\/\/web\.archive\.org\/web\/\d{14}\/https?:\/\/tennisabstract\.com\/reports\/atp_elo_ratings\.html$/);
    } else {
      assert.deepEqual([doc.source.edition, doc.source.computed], ['Elo from match results', true]);
      assert.equal(!!doc.source.rough, year <= 1979);
    }
  }
});

test('ratings over 99 shift their whole season, the Elo kept: Borg\'s 2466 is 99 in 1980, Djokovic\'s 2508 in 2016', () => {
  const borg = seasonFile(1980).nations['752'][2][0];
  assert.deepEqual([borg[0], borg[2], borg[3].rawRating], ['Bjorn Borg', 99, 2466.2]);
  assert.equal(seasonFile(1980).source.shift, 4, 'four points: 103 down to 99');
  assert.equal(gameRating(2466.2), 103);
  const novak = seasonFile(2016).nations['688'][2][0];
  assert.deepEqual([novak[0], novak[2], novak[3].rawRating, seasonFile(2016).source.shift], ['Novak Djokovic', 99, 2508.1, 5]);
  assert.equal(seasonFile(1985).source.shift, undefined, 'a season whose best is 99 or less keeps its ratings');
  // Every season over 99 is in the audit.
  const audit = JSON.parse(read('docs/design/tennis-seasons-audit.json'));
  assert.deepEqual(audit.shifted.map(line => Number(line.slice(0, 4))), YEARS.filter(year => seasonFile(year).source.shift));
});

test('the 1980s Davis Cup: Czechoslovakia holds Slovakia\'s land with Lendl, West Germany has Becker, South Africa is barred', () => {
  const doc = seasonFile(1985);
  assert.equal(doc.territory.merged['703'], '203', 'Slovakia starts in Czechoslovakia\'s empire');
  assert.ok(!doc.nations['703'] && !doc.territory.inactive.includes('703'));
  assert.equal(squadNames(doc, '203')[0], 'Ivan Lendl', 'Lendl played for Czechoslovakia, though the player file lists him as American');
  assert.ok(squadNames(doc, '203').includes('Miloslav Mecir'));
  assert.equal(squadNames(doc, '276')[0], 'Boris Becker');
  for (const shape of ['191', '705', '070', '807', '499', 'KOS']) assert.equal(doc.territory.merged[shape], '688', `${shape} is Yugoslavia's in 1985`);
  // South Africa is barred from 1979 until 1992: its men play for nobody, its land is neutral.
  assert.ok(!doc.nations['710'] && doc.territory.inactive.includes('710'));
  const all = year => Object.values(seasonFile(year).nations).flatMap(([, , squad]) => squad.map(([name]) => name));
  assert.ok(!all(1980).includes('Johan Kriek') && !all(1980).includes('Kevin Curren'), 'Kriek and Curren were South African then');
  assert.ok(squadNames(seasonFile(1978), '710').includes('Johan Kriek'), 'and played for South Africa before the ban');
  assert.ok(all(1985).includes('Kevin Curren') && squadNames(seasonFile(1985), '840').includes('Kevin Curren'), 'an American from 1985');
  assert.ok(seasonFile(1993).nations['710'], 'back in 1993');
  // The Soviet Union holds the other republics while it fields a team; in 1992 the CIS holds all but the Baltic states
  // and Georgia, and Croatia plays alone.
  const ussr = seasonFile(1990);
  assert.ok(ussr.nations['643'] && ['804', '112', '233', '428', '440', '268'].every(shape => ussr.territory.merged[shape] === '643'));
  const cis = seasonFile(1992);
  assert.equal(cis.territory.merged['804'], '643');
  assert.ok(['233', '428', '440', '268'].every(shape => cis.territory.merged[shape] === undefined));
  assert.equal(squadNames(cis, '191')[0], 'Goran Ivanisevic');
  assert.equal(squadNames(seasonFile(1990), '688').includes('Goran Ivanisevic'), true, 'a Yugoslav in 1990');
  assert.equal(seasonFile(1993).territory.merged['703'], undefined, 'Slovakia plays alone from 1993');
  // FR Yugoslavia, barred 1993-1995, then Serbia and Montenegro holding Montenegro and Kosovo to 2006, Kosovo alone from 2008.
  assert.ok(!seasonFile(1994).nations['688']);
  assert.equal(seasonFile(2006).territory.merged['499'], '688');
  assert.equal(seasonFile(2007).territory.merged['KOS'], '688');
  assert.equal(seasonFile(2008).territory.merged['KOS'], undefined);
  assert.equal(squadNames(seasonFile(2005), '688')[0], 'Novak Djokovic');
});

test('a man plays for the nation of his day: Davis Cup ties first, then succession and the documented fixes', () => {
  const rules = MANIFEST.nations;
  assert.equal(codeOfDay('SVK', 1985, 'SVK', rules), 'TCH');
  assert.equal(codeOfDay('YUG', 1993, 'CRO', rules), 'CRO', 'Ivanisevic after Yugoslavia');
  assert.equal(codeOfDay('YUG', 1997, 'SRB', rules), 'FRY');
  assert.equal(codeOfDay('TCH', 1993, 'USA', rules), 'USA', 'an emigrant keeps his country');
  assert.equal(codeOfDay('URS', 1992, 'UKR', rules), 'CIS');
  assert.equal(codeOfDay('GER', 1989, 'GER', rules), 'FRG');
  assert.equal(codeOfDay('GDR', 1985, 'GDR', rules), 'GDR', 'East Germany fielded no Davis Cup team');
  const lendl = { id: '100656', ioc: 'USA', davisCup: new Map([[1985, new Map([['TCH', 4]])]]) };
  assert.deepEqual(nationOfDay(lendl, 1988, rules), { code: 'TCH', how: 'davis-cup' });
  assert.deepEqual(nationOfDay(lendl, 1992, rules), { code: 'USA', how: 'player-file' }, 'seven seasons on, his own country');
  assert.deepEqual(nationOfDay({ id: '100532', ioc: 'USA' }, 1981, rules), { code: 'RSA', how: 'fix' }, 'Johan Kriek');
  assert.deepEqual(nationOfDay({ id: '102257', ioc: 'GBR' }, 1994, rules), { code: 'CAN', how: 'fix' }, 'Greg Rusedski');
  // The snapshots say where each nation came from.
  const hows = new Set(YEARS.flatMap(year => snapshot(year).players.map(row => row[3].replace(/ \d{4}-\d{2}-\d{2}$/, ''))));
  assert.deepEqual([...hows].sort(), ['davis-cup', 'fix', 'player-file', 'rankings']);
  // A nation needs two rated men; a nation of one and a barred one field nobody.
  const { nations, left } = teamsOf([{ name: 'A', elo: 2000, nation: '710' }, { name: 'B', elo: 1900, nation: '710' }, { name: 'C', elo: 1800, nation: '040' }], 1985, rules);
  assert.deepEqual([nations.length, left.barred.length, left.alone.length], [0, 2, 1]);
});

test('the published seasons are Tennis Abstract\'s own lists, each man under the country its rankings report gave him then', () => {
  const doc = seasonFile(2023);
  const [name, , rating, source] = doc.nations['688'][2][0];
  assert.deepEqual([name, rating, source.rawRating, source.snapshotDate, source.edition], ['Novak Djokovic', 93, 2226.7, '2023-12-25', 'Tennis Abstract Elo']);
  assert.equal(source.url, 'https://www.tennisabstract.com/cgi-bin/player.cgi?p=NovakDjokovic');
  // A key Tennis Abstract has since renamed is linked by its current one.
  const stan = seasonFile(2016).nations['756'][2].find(([who]) => who === 'Stanislas Wawrinka');
  assert.deepEqual([stan[3].id, stan[3].url], ['ta:StanWawrinka', 'https://www.tennisabstract.com/cgi-bin/player.cgi?p=StanWawrinka']);
  // Alejandro Tabilo played for Canada in 2019, for Chile afterwards.
  const tabilo = year => snapshot(year).players.find(row => row[0] === 'AlejandroTabilo')?.[2];
  assert.equal(tabilo(2019), 'CAN');
  assert.equal(tabilo(2023), 'CHI');
  // The list keeps the men with ten counted matches in the season, as the computed seasons do.
  const data = snapshot(2018);
  assert.equal(data.listed, data.rated + data.left.length);
  assert.ok(data.left.every(([, , why]) => /counted matches|not in the match files/.test(why)));
});

test('the method reproduces Tennis Abstract: its own lists, its season and career peaks', () => {
  const { fit, published } = VALIDATION;
  assert.ok(Math.abs(fit.meanDiff) < 5 && fit.rms < 20, `1973-2000 targets: mean ${fit.meanDiff}, rms ${fit.rms}`);
  // The same engine with the method Tennis Abstract used until 2018 reproduces its 2016 and 2017 lists.
  for (const year of [2016, 2017]) {
    assert.ok(published[year].v1.top100.r > 0.99 && published[year].v1.top100.meanAbsDiff < 10, `${year}: ${JSON.stringify(published[year].v1.top100)}`);
  }
  for (const year of [2019, 2020, 2021, 2022, 2023, 2024, 2025]) {
    const { top100, topTenShared, listed } = published[year].current;
    assert.ok(top100.r > 0.95 && top100.slope > 0.85 && top100.slope < 1.1, `${year}: ${JSON.stringify(top100)}`);
    assert.ok(topTenShared >= 8, `${year}: ${topTenShared} of the top ten`);
    if (year >= 2020) assert.ok(listed.both / listed.published > 0.98, `${year}: the same men listed`);
  }
});

test('the loader refuses a tennis season that is not the builder\'s', () => {
  const doc = seasonFile(1985);
  const broken = edit => { const copy = JSON.parse(JSON.stringify(doc)); edit(copy); return () => decodeFootballSet(copy, copy.id); };
  assert.throws(broken(d => { d.season = '1984/85'; }), /season "1984\/85" must be "1985"/);
  assert.throws(broken(d => { d.nations['203'][2] = d.nations['203'][2].slice(0, 1); }), /two to five players/);
  assert.throws(broken(d => { d.nations['203'][2].reverse(); }), /strongest first/);
  assert.throws(broken(d => { d.clubs = [{}]; }), /nations only/);
  assert.throws(broken(d => { delete d.territory.merged.SCO; }), /home nations/);
  assert.throws(broken(d => { d.territory.inactive.pop(); }), /every nation the season neither lists nor merges/);
  assert.throws(broken(d => { d.source.rawScale = 99; }), /rawScale must be "Elo"/);
});

test('a season binds tennis to its nations; its fielded nations are the Davis Cup\'s of the day', () => {
  const set = decodeFootballSet(seasonFile(1985), 'tennis-1985');
  const sport = seasonSport(set);
  assert.deepEqual([sport.id, sport.dataSet, sport.dataSeason, sport.nationsOnly], ['tennis', 'tennis-1985', '1985', true]);
  const fielded = fieldedNations(sport);
  assert.deepEqual(fielded.slice().sort(), Object.keys(set.rosters).sort());
  assert.ok(!fielded.includes('703') && !fielded.includes('710'));
  const czechs = buildTeam('203', makeRng(1985), sport);
  assert.deepEqual(czechs.squad.map(player => player.name), set.rosters['203'][2].map(([name]) => name));
  assert.equal(sportOf({ sport: 'tennis', layer: 'nations', dataSet: 'tennis-1985' }), null, 'until it has loaded');
  assert.equal(Object.keys(NATIONS).length, set.territory.inactive.length + Object.keys(set.territory.merged).length + fielded.length);
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
    const [, id] = String(url).match(/^\/tennis\/(tennis-\d{4})\.json$/) || [];
    let text = null;
    try { text = id && read(`public/tennis/${id}.json`); } catch { text = null; }
    return text ? { ok: true, status: 200, json: async () => JSON.parse(text) }
      : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  // Czechia, Slovakia, the United States, Sweden, Germany and South Africa.
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['203', '703', '840', '752', '276', '710'],
    settings: { sport: 'tennis', layer: 'nations', scope: 'world', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn({ ...f, calls }); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}
const modelOf = app => buildSetupModel(app.state.setup, { managerTeams: app.setupTeams(), domestic: app.domesticStatus(), season: app.seasonStatus() });

test('tennis\'s Season choice lists 2026 and the 53 earlier seasons, newest first', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'tennis');
    const model = modelOf(app);
    assert.deepEqual(model.season.options.map(option => option.name), ['2026', ...YEARS.map(String)]);
    assert.equal(model.season.options[1].label, '2025 · Tennis Abstract Elo, December 2025');
    assert.equal(model.season.options.at(-1).label, '1973 · Elo from match results, end of 1973 (rough)');
    app.pickSetup('dataSet', 'tennis-1985');
    assert.deepEqual([app.state.setup.layer, app.state.setup.dataSet], ['nations', 'tennis-1985']);
    time.advance(200);
    await app.loadSet('tennis-1985');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(modelOf(app).canLaunch, true);
    app.pickSetup('sport', 'baseball');
    assert.equal(app.state.setup.dataSet, null, 'a season stays with its sport');
  });
});

test('a season launches with that year\'s nations, Slovakia in Czechoslovakia\'s empire, and resumes as it was played', async () => {
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'tennis');
    app.pickSetup('scope', 'world');
    app.pickSetup('dataSet', 'tennis-1985');
    time.advance(200);
    await app.loadSet('tennis-1985');
    await settle();
    const doc = seasonFile(1985);
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.layer, st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason],
      ['nations', 'tennis-1985', doc.version, 1985, '1985']);
    assert.ok(calls.includes('/tennis/tennis-1985.json'));
    assert.deepEqual(st.teams['203'].squad.map(player => player.name), squadNames(doc, '203'), 'Lendl\'s Czechoslovakia');
    assert.ok(st.teams['203'].squad.every(player => player.sourceInfo.edition === 'Elo from match results' && !player.gen));
    assert.ok(!st.teams['703'] && st.own['703'] === '203', 'Slovakia starts in Czechoslovakia\'s empire');
    assert.ok(!st.teams['710'] && !('710' in st.own), 'South Africa is barred: neutral land');
    assert.deepEqual(st.aliveIds.slice().sort(), Object.keys(doc.nations).sort(), 'the 27 nations of 1985');
    const saved = parseCampaign(items.get(SAVE_KEY));
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams), 'the squads come back exactly');
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.equal(app.state.own['703'], '203');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams));
    const edited = edit => { const data = JSON.parse(items.get(SAVE_KEY)); edit(data.settings); if (data.initialSettings) edit(data.initialSettings); return JSON.stringify(data); };
    assert.throws(() => parseCampaign(edited(s => { s.dataSeason = '1984/85'; })), /Campaign data set is invalid/);
    assert.throws(() => parseCampaign(edited(s => { s.layer = 'clubs'; })), /Campaign data set is invalid|layer/i);
  });
});

test('a challenge link to a tennis season loads it', async () => {
  await withApp(async ({ app, time }) => {
    const link = readChallenge('?sport=tennis&theatre=world&season=tennis-2023&seed=1');
    assert.deepEqual(link.ignored, []);
    app.setState({ setup: link.setup });
    app.showSetupSet();
    time.advance(200);
    await app.loadSet('tennis-2023');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(app.state.setup.dataSet, 'tennis-2023');
  });
});
