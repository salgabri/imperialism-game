// Women's tennis's earlier seasons (docs/design/womens-tennis.md, "Earlier seasons"): Tennis Abstract's own year-end WTA
// Elo reports for 2016-2025 and Elo computed from Jeff Sackmann's WTA match results by Tennis Abstract's method for
// 1973-2015, built from committed snapshots; the Fed Cup's nations of each season (Czechoslovakia, the Soviet Union,
// Yugoslavia, West Germany on today's map, South Africa barred) and the documented fixes; the per-season shift that
// keeps the best at 99; the method's checks against every list Tennis Abstract published and its Tennis 128 peaks; the
// loader and the running App choosing, launching and resuming a season.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SAVE_KEY } from '../src/config.js';
import { BUILT_IN_WOMENS_TENNIS_SEASONS } from '../src/data/womensTennisSeasons.js';
import { HOME_NATIONS, NATIONS, makeRng, buildTeam } from '../src/data/teams.js';
import { BUILT_IN_SETS, builtInSeasonOf, decodeFootballSet, fieldedNations, seasonSport, setHasClubs, setHasNations, setKindOf, setSportOf,
  sportOf } from '../src/engine/footballSets.js';
import { WTA } from '../src/sports/tennis.js';
import { parseCampaign } from '../src/engine/storage.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { readChallenge } from '../src/screens/setup/challenge.js';
import { gameRating } from './lib/tennis.mjs';
import { ROUND_ORDER, wtaLevelOf } from './lib/tennis-elo.mjs';
import { codeOfDay, nationOfDay, teamsOf } from './lib/tennis-seasons.mjs';
import { womensTennis } from '../src/sports/womensTennis.js';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const MANIFEST = JSON.parse(read('scripts/data/womens-tennis-seasons.json'));
const VALIDATION = JSON.parse(read('scripts/data/womens-tennis-seasons/validation.json'));
const seasonFile = year => JSON.parse(read(`public/womens-tennis/wta-${year}.json`));
const snapshot = year => JSON.parse(read(`scripts/data/womens-tennis-seasons/${year}.json`));
const squadNames = (doc, nation) => doc.nations[nation][2].map(([name]) => name);
const everyone = year => Object.values(seasonFile(year).nations).flatMap(([, , squad]) => squad.map(([name]) => name));
const YEARS = Array.from({ length: 2025 - 1973 + 1 }, (_, i) => 2025 - i);

// ---------- building ----------

test('every season rebuilds byte for byte from its committed snapshot, and the snapshots from the pinned inputs', () => {
  assert.match(execFileSync(process.execPath, ['scripts/build-tennis-seasons.mjs', '--tour=wta', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the 53 women's tennis seasons, their listing, attribution and audit byte for byte/);
  // The men's seasons still rebuild as they were before the women's tour joined.
  assert.match(execFileSync(process.execPath, ['scripts/build-tennis-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the 53 tennis seasons/);
  // The snapshots rebuild from the archive and the captures, cached in the ignored data-src/ (not on a fresh checkout).
  const cached = Object.keys(MANIFEST.archive.files).every(file => existsSync(`${root}/data-src/womens-tennis-seasons/sackmann/${file}`))
    && MANIFEST.reports.every(report => existsSync(`${root}/data-src/womens-tennis-seasons/wayback/elo_${report.capture}.html`))
    && MANIFEST.rankings.every(capture => existsSync(`${root}/data-src/womens-tennis-seasons/wayback/rank_${capture.capture}.html`));
  if (cached) {
    assert.match(execFileSync(process.execPath, ['scripts/sync-tennis-seasons.mjs', '--tour=wta', '--check'], { cwd: root, encoding: 'utf8' }),
      /Verified the 53 women's tennis season snapshots and their validation byte for byte/);
  }
  for (const year of YEARS) {
    const data = snapshot(year);
    assert.equal(data.season, year);
    assert.equal(data.kind, year >= 2016 ? 'published' : 'computed');
    assert.equal(data.rated, data.players.length);
    assert.ok(data.players.every((row, i) => i === 0 || row[5] <= data.players[i - 1][5]), `${year} runs strongest first`);
    if (data.kind === 'computed') assert.ok(data.players.every(row => row[6] >= MANIFEST.method.activity), `${year}: ten counted matches each`);
  }
  // Every input is pinned: the 117 files of Sackmann's WTA archive and the 20 captures.
  assert.equal(Object.keys(MANIFEST.archive.files).length, 117);
  assert.equal(MANIFEST.archive.commit, '83733587353df8a41f2fd4f516147d5aa83f5a8d');
  assert.ok(Object.values(MANIFEST.archive.files).every(hash => /^[0-9a-f]{64}$/.test(hash)));
  assert.ok([...MANIFEST.reports, ...MANIFEST.rankings].every(entry => /^[0-9a-f]{64}$/.test(entry.sha256) && /^\d{14}$/.test(entry.capture)));
});

test('the counted matches are Tennis Abstract\'s: tour level, its qualifying, WTA 125s and ITF events of $50K or more', () => {
  const at = (file, level, round = 'R32', season = 2010, eventName = 'An event') => wtaLevelOf({ file, level, round: ROUND_ORDER[round], season, eventName });
  assert.deepEqual(['W', 'G', 'D', 'O', 'F', 'T1', 'T5', 'PM', 'P', 'I'].map(level => at(0, level)), Array(10).fill('tour'));
  assert.deepEqual(['E', 'J', 'CC', '35+H'].map(level => at(0, level)), [null, null, null, null], 'exhibitions, juniors and small ITF events');
  assert.equal(at(0, '50+H'), 'challenger', 'the ITF W50 with hospitality of 2025');
  assert.equal(at(0, 'W', 'R32', 2024, 'Buenos Aires 125'), 'challenger', 'a WTA 125 in the tour-level file');
  assert.equal(at(1, 'I', 'Q2'), 'qualifying');
  assert.deepEqual(['50', '60', '75', '80', '100'].map(level => at(1, level)), Array(5).fill('challenger'));
  assert.deepEqual(['10', '15', '25', '35', '40'].map(level => at(1, level)), Array(5).fill(null));
  assert.equal(at(1, '100', 'Q1'), null, 'an ITF event\'s qualifying');
  assert.equal(at(1, 'C', 'R32', 1988), null, 'an ITF event before 1994 names no prize');
  assert.equal(at(1, 'C', 'R32', 2015), 'challenger', 'a WTA 125');
  assert.equal(at(1, 'C', 'Q1', 2015), null, 'its qualifying');
  assert.deepEqual(MANIFEST.method.start, { ...MANIFEST.method.start, tour: 1330, challenger: 1275, qualifying: 1275 });
});

test('the built-in seasons run from 2025 back to 1973: Tennis Abstract\'s own lists, then Elo computed by its method', () => {
  assert.deepEqual(BUILT_IN_WOMENS_TENNIS_SEASONS.map(set => set.id), YEARS.map(year => `wta-${year}`));
  assert.equal(builtInSeasonOf('womens-tennis').season, '2026', 'the built-in season stays November 2026\'s');
  const label = year => BUILT_IN_WOMENS_TENNIS_SEASONS.find(set => set.year === year).label;
  assert.equal(label(2023), 'Tennis Abstract Elo, December 2023');
  assert.equal(label(2020), 'Tennis Abstract Elo, 9 November 2020, before Linz', 'no capture holds the season\'s last update');
  assert.equal(label(2016), 'Tennis Abstract Elo, November 2016');
  assert.equal(label(1985), 'Elo from match results, end of 1985');
  assert.equal(label(1975), 'Elo from match results, end of 1975 (rough)', 'the 1970s are rougher, and say so');
  for (const listed of BUILT_IN_WOMENS_TENNIS_SEASONS) {
    assert.ok(listed.label.length <= 50, `${listed.id}'s label is short`);
    const set = BUILT_IN_SETS.find(entry => entry.id === listed.id);
    assert.deepEqual(set, listed, `${listed.id} is listed as built`);
    assert.deepEqual([setKindOf(set.id), setSportOf(set.id)], ['wta', 'womens-tennis']);
    assert.ok(setHasNations(set.id) && !setHasClubs(set.id), 'nations only');
    assert.equal(seasonFile(set.year).version, listed.version);
  }
  // The men's seasons are their own: no id of one tour is the other's.
  assert.equal(setSportOf('tennis-1985'), 'tennis');
});

// ---------- the seasons ----------

test('every season decodes: two to five women a nation, each her source\'s Elo on the game\'s scale, shifted so the best is 99', () => {
  for (const year of YEARS) {
    const doc = seasonFile(year);
    const set = decodeFootballSet(doc, doc.id);
    assert.deepEqual([set.meta.year, set.meta.season, doc.clubs.length, doc.kind], [year, String(year), 0, 'wta']);
    const shift = doc.source.shift ?? 0;
    const squads = Object.values(doc.nations).map(([, , squad]) => squad);
    for (const squad of squads) {
      assert.ok(squad.length >= 2 && squad.length <= 5);
      for (const [, pos, rating, source] of squad) {
        assert.equal(pos, 'SGL');
        assert.equal(rating, gameRating(source.rawRating) - shift, `${year}: ${source.id} is her Elo on the game's scale`);
        assert.equal(source.rawScale, 'Elo');
        if (year < 2016) assert.match(source.id, /^wta:\d+$/);
        else assert.match(source.url, /^https:\/\/www\.tennisabstract\.com\/cgi-bin\/wplayer\.cgi\?p=/);
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
      assert.match(doc.source.url, /^https:\/\/web\.archive\.org\/web\/\d{14}\/https?:\/\/tennisabstract\.com(:80)?\/reports\/wta_elo_ratings\.html$/);
    } else {
      assert.deepEqual([doc.source.edition, doc.source.computed, doc.source.name], ['Elo from match results', true, 'Jeff Sackmann\'s WTA match results (Tennis Abstract)']);
      assert.equal(!!doc.source.rough, year <= 1979);
    }
  }
});

test('ratings over 99 shift their whole season, the Elo kept: Graf\'s 2600 is 99 in 1989, Navratilova\'s 2575 in 1985', () => {
  const graf = seasonFile(1989).nations['276'][2][0];
  assert.deepEqual([graf[0], graf[2], graf[3].rawRating, seasonFile(1989).source.shift], ['Steffi Graf', 99, 2600.5, 9]);
  const martina = seasonFile(1985).nations['840'][2][0];
  assert.deepEqual([martina[0], martina[2], martina[3].rawRating, seasonFile(1985).source.shift], ['Martina Navratilova', 99, 2575.2, 8]);
  assert.equal(seasonFile(1974).source.shift, undefined, 'a season whose best is 99 or less keeps its ratings');
  const audit = JSON.parse(read('docs/design/womens-tennis-seasons-audit.json'));
  assert.deepEqual(audit.shifted.map(line => Number(line.slice(0, 4))), YEARS.filter(year => seasonFile(year).source.shift));
});

test('the 1980s Fed Cup: Czechoslovakia holds Slovakia\'s land with Mandlikova, West Germany has Graf, South Africa is barred', () => {
  const doc = seasonFile(1985);
  assert.equal(doc.territory.merged['703'], '203', 'Slovakia starts in Czechoslovakia\'s empire');
  assert.ok(!doc.nations['703'] && !doc.territory.inactive.includes('703'));
  assert.deepEqual(squadNames(doc, '203').slice(0, 2), ['Hana Mandlikova', 'Helena Sukova']);
  assert.deepEqual(squadNames(doc, '276').slice(0, 2), ['Claudia Kohde Kilsch', 'Steffi Graf']);
  assert.deepEqual(squadNames(doc, '840').slice(0, 2), ['Martina Navratilova', 'Chris Evert']);
  for (const shape of ['191', '705', '070', '807', '499', 'KOS']) assert.equal(doc.territory.merged[shape], '688', `${shape} is Yugoslavia's in 1985`);
  // South Africa is barred from 1978 until 1992: its players play for nobody, its land is neutral.
  assert.ok(!doc.nations['710'] && doc.territory.inactive.includes('710'));
  assert.equal(squadNames(seasonFile(1977), '710')[0], 'Greer Stevens', 'South Africa played the Fed Cup until 1977');
  assert.ok(!seasonFile(1978).nations['710'] && !seasonFile(1991).nations['710']);
  assert.ok(squadNames(seasonFile(1992), '710').includes('Amanda Coetzer'), 'back in 1992');
  // The Soviet Union holds the other republics while it fields a team; in 1992 the CIS holds all but the Baltic states.
  const ussr = seasonFile(1990);
  assert.deepEqual(squadNames(ussr, '643').slice(0, 2), ['Leila Meskhi', 'Natalia Zvereva']);
  assert.ok(['804', '112', '233', '428', '440', '268'].every(shape => ussr.territory.merged[shape] === '643'));
  const cis = seasonFile(1992);
  assert.equal(cis.territory.merged['804'], '643');
  assert.ok(['233', '428', '440', '268'].every(shape => cis.territory.merged[shape] === undefined));
  assert.equal(seasonFile(1993).territory.merged['703'], undefined, 'Slovakia plays alone from 1993');
  // Serbia and Montenegro hold Montenegro and Kosovo to 2006; Serbia, Kosovo in 2007.
  assert.deepEqual(squadNames(seasonFile(2006), '688'), ['Jelena Jankovic', 'Ana Ivanovic']);
  assert.equal(seasonFile(2006).territory.merged['499'], '688');
  assert.equal(seasonFile(2007).territory.merged['KOS'], '688');
  assert.equal(seasonFile(2008).territory.merged['KOS'], undefined);
});

test('a woman plays for the nation of her day: Fed Cup ties first, then succession and the documented fixes', () => {
  const rules = MANIFEST.nations;
  assert.equal(codeOfDay('SVK', 1985, 'SVK', rules), 'TCH');
  assert.equal(codeOfDay('GER', 1989, 'GER', rules), 'FRG');
  assert.equal(codeOfDay('GDR', 1985, 'GDR', rules), 'GDR', 'East Germany fielded no Fed Cup team');
  assert.equal(codeOfDay('YUG', 1992, 'USA', rules), 'FRY');
  assert.deepEqual(nationOfDay({ id: 'x', ioc: 'USA', davisCup: new Map([[1985, new Map([['TCH', 4]])]]) }, 1988, rules), { code: 'TCH', how: 'fed-cup' });
  // Navratilova defected in 1975: American from 1976, though her Fed Cup rows are Czechoslovakia's until then.
  assert.deepEqual(nationOfDay({ id: '200293', ioc: 'USA' }, 1977, rules), { code: 'USA', how: 'fix' });
  assert.ok(squadNames(seasonFile(1977), '840').includes('Martina Navratilova'));
  assert.ok(!squadNames(seasonFile(1977), '203').includes('Martina Navratilova'), 'not Czechoslovakia\'s');
  // Mandlikova was Australian from 1988.
  assert.equal(squadNames(seasonFile(1988), '036')[0], 'Hana Mandlikova');
  // Seles was Yugoslav until 1994: Yugoslavia's in 1989 and 1990; its only rated player in 1991 and 1992 (a nation needs
  // two), and FR Yugoslavia barred in 1993.
  assert.deepEqual(squadNames(seasonFile(1990), '688'), ['Monica Seles', 'Sabrina Goles']);
  for (const year of [1991, 1992, 1993]) assert.ok(!everyone(year).includes('Monica Seles'), `${year}`);
  const audit = JSON.parse(read('docs/design/womens-tennis-seasons-audit.json')).seasons;
  assert.ok(audit.find(s => s.id === 'wta-1991').leftOut.aloneInTheirNation.includes('Monica Seles (YUG)'));
  assert.ok(audit.find(s => s.id === 'wta-1993').leftOut.barred.includes('Monica Seles (FRY)'));
  assert.deepEqual(nationOfDay({ id: '200468', ioc: 'USA' }, 1984, rules), { code: 'USA', how: 'fix' }, 'Hu Na, after defecting');
  // The snapshots say where each nation came from.
  const hows = new Set(YEARS.flatMap(year => snapshot(year).players.map(row => row[3].replace(/ \d{4}-\d{2}-\d{2}$/, ''))));
  assert.deepEqual([...hows].sort(), ['fed-cup', 'fix', 'player-file', 'rankings']);
  const { nations, left } = teamsOf([{ name: 'A', elo: 2000, nation: '710' }, { name: 'B', elo: 1900, nation: '710' }, { name: 'C', elo: 1800, nation: '040' }],
    1985, rules, womensTennis);
  assert.deepEqual([nations.length, left.barred.length, left.alone.length], [0, 2, 1]);
});

test('the published seasons are Tennis Abstract\'s own lists, each woman under the country its rankings report gave her then', () => {
  const doc = seasonFile(2023);
  const [name, , rating, source] = doc.nations['840'][2][0];
  assert.deepEqual([name, rating, source.rawRating, source.snapshotDate, source.edition], ['Cori Gauff', 89, 2127, '2023-12-25', 'Tennis Abstract Elo']);
  // A key Tennis Abstract has since renamed is linked by its current one.
  assert.deepEqual([source.id, source.url], ['ta:CocoGauff', 'https://www.tennisabstract.com/cgi-bin/wplayer.cgi?p=CocoGauff']);
  assert.ok(Object.keys(MANIFEST.keyAliases).length >= 20);
  // The list keeps the women with ten counted matches in the season, as the computed seasons do.
  for (const year of [2018, 2023]) {
    const data = snapshot(year);
    assert.equal(data.listed, data.rated + data.left.length);
    assert.ok(data.left.every(([, , why]) => /counted matches|not in the match files/.test(why)));
  }
  assert.deepEqual(snapshot(2023).left.filter(([, , why]) => why === 'not in the match files').map(([key]) => key), ['TatianaBarkova']);
});

test('the method reproduces Tennis Abstract: its own lists and the Tennis 128\'s career peaks', () => {
  const { fit, published } = VALIDATION;
  assert.ok(Math.abs(fit.meanDiff) < 5 && fit.rms < 50, `1973-2000 targets: mean ${fit.meanDiff}, rms ${fit.rms}`);
  assert.equal(fit.n, 17);
  // The same engine with the method Tennis Abstract used until 2018 reproduces its 2016 and 2017 lists.
  for (const year of [2016, 2017]) {
    assert.ok(published[year].v1.top100.r > 0.99 && published[year].v1.top100.meanAbsDiff < 15, `${year}: ${JSON.stringify(published[year].v1.top100)}`);
  }
  for (const year of [2021, 2022, 2023, 2024, 2025]) {
    const { top100, topTenShared, listed } = published[year].current;
    assert.ok(top100.r > 0.96 && Math.abs(top100.meanDiff) < 15 && top100.slope > 0.9 && top100.slope < 1.1, `${year}: ${JSON.stringify(top100)}`);
    assert.ok(topTenShared >= 7, `${year}: ${topTenShared} of the top ten`);
    assert.ok(listed.both / listed.published > 0.9, `${year}: the same women listed`);
  }
  // Graf and Seles land within ten points of their published peaks.
  for (const name of ['Steffi Graf', 'Monica Seles']) assert.ok(Math.abs(VALIDATION.peaks.find(peak => peak.name === name).diff) < 10, name);
});

test('the loader refuses a women\'s season that is not the builder\'s', () => {
  const doc = seasonFile(1985);
  const broken = edit => { const copy = JSON.parse(JSON.stringify(doc)); edit(copy); return () => decodeFootballSet(copy, copy.id); };
  assert.throws(broken(d => { d.season = '1984/85'; }), /season "1984\/85" must be "1985"/);
  assert.throws(broken(d => { d.kind = 'elo'; }), /kind "elo" is not the kind its id names/);
  assert.throws(broken(d => { d.nations['203'][2] = d.nations['203'][2].slice(0, 1); }), /two to five players/);
  assert.throws(broken(d => { d.nations['203'][2].reverse(); }), /strongest first/);
  assert.throws(broken(d => { d.clubs = [{}]; }), /nations only/);
  assert.throws(broken(d => { delete d.territory.merged.SCO; }), /home nations/);
  assert.throws(broken(d => { d.source.rawScale = 99; }), /rawScale must be "Elo"/);
});

test('a season binds women\'s tennis, the WTA\'s serve and its nations; its fielded nations are the Fed Cup\'s of the day', () => {
  const set = decodeFootballSet(seasonFile(1985), 'wta-1985');
  const sport = seasonSport(set);
  assert.deepEqual([sport.id, sport.dataSet, sport.dataSeason, sport.nationsOnly, sport.tour], ['womens-tennis', 'wta-1985', '1985', true, WTA]);
  const fielded = fieldedNations(sport);
  assert.deepEqual(fielded.slice().sort(), Object.keys(set.rosters).sort());
  assert.ok(!fielded.includes('703') && !fielded.includes('710'));
  const czechs = buildTeam('203', makeRng(1985), sport);
  assert.deepEqual(czechs.squad.map(player => player.name), set.rosters['203'][2].map(([name]) => name));
  assert.equal(czechs.sport, 'womens-tennis');
  assert.equal(sportOf({ sport: 'womens-tennis', layer: 'nations', dataSet: 'wta-1985' }), null, 'until it has loaded');
  assert.equal(sportOf({ sport: 'tennis', layer: 'nations', dataSet: 'wta-1985' }).id, 'tennis', 'a women\'s season never plays as the men\'s');
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
    const [, id] = String(url).match(/^\/womens-tennis\/(wta-\d{4})\.json$/) || [];
    let text = null;
    try { text = id && read(`public/womens-tennis/${id}.json`); } catch { text = null; }
    return text ? { ok: true, status: 200, json: async () => JSON.parse(text) }
      : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  // Czechia, Slovakia, the United States, Germany, Australia and South Africa.
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['203', '703', '840', '276', '036', '710'],
    settings: { sport: 'womens-tennis', layer: 'nations', scope: 'world', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn({ ...f, calls }); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}
const modelOf = app => buildSetupModel(app.state.setup, { managerTeams: app.setupTeams(), domestic: app.domesticStatus(), season: app.seasonStatus() });

test('women\'s tennis\'s Season choice lists 2026 and the 53 earlier seasons, newest first', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'womens-tennis');
    const model = modelOf(app);
    assert.deepEqual(model.season.options.map(option => option.name), ['2026', ...YEARS.map(String)]);
    assert.equal(model.season.options[1].label, '2025 · Tennis Abstract Elo, December 2025');
    assert.equal(model.season.options.at(-1).label, '1973 · Elo from match results, end of 1973 (rough)');
    app.pickSetup('dataSet', 'wta-1985');
    assert.deepEqual([app.state.setup.layer, app.state.setup.dataSet], ['nations', 'wta-1985']);
    time.advance(200);
    await app.loadSet('wta-1985');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(modelOf(app).canLaunch, true);
    app.pickSetup('sport', 'tennis');
    assert.equal(app.state.setup.dataSet, null, 'a season stays with its sport');
  });
});

test('a season launches with that year\'s nations, Slovakia in Czechoslovakia\'s empire, and resumes as it was played', async () => {
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'womens-tennis');
    app.pickSetup('scope', 'world');
    app.pickSetup('dataSet', 'wta-1985');
    time.advance(200);
    await app.loadSet('wta-1985');
    await settle();
    const doc = seasonFile(1985);
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.sport, st.settings.layer, st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason],
      ['womens-tennis', 'nations', 'wta-1985', doc.version, 1985, '1985']);
    assert.ok(calls.includes('/womens-tennis/wta-1985.json'));
    assert.deepEqual(st.teams['203'].squad.map(player => player.name), squadNames(doc, '203'), 'Mandlikova\'s Czechoslovakia');
    assert.ok(st.teams['203'].squad.every(player => player.sourceInfo.edition === 'Elo from match results' && !player.gen));
    assert.ok(!st.teams['703'] && st.own['703'] === '203', 'Slovakia starts in Czechoslovakia\'s empire');
    assert.ok(!st.teams['710'] && !('710' in st.own), 'South Africa is barred: neutral land');
    assert.deepEqual(st.aliveIds.slice().sort(), Object.keys(doc.nations).sort(), 'the 20 nations of 1985');
    const saved = parseCampaign(items.get(SAVE_KEY));
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams), 'the squads come back exactly');
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.equal(app.state.own['703'], '203');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams));
    const edited = edit => { const data = JSON.parse(items.get(SAVE_KEY)); edit(data.settings); if (data.initialSettings) edit(data.initialSettings); return JSON.stringify(data); };
    assert.throws(() => parseCampaign(edited(s => { s.dataSeason = '1984/85'; })), /Campaign data set is invalid/);
    assert.throws(() => parseCampaign(edited(s => { s.sport = 'tennis'; })), /Campaign data set is invalid|sport/i);
  });
});

test('a challenge link to a women\'s season loads it', async () => {
  await withApp(async ({ app, time }) => {
    const link = readChallenge('?sport=womens-tennis&theatre=world&season=wta-2023&seed=1');
    assert.deepEqual(link.ignored, []);
    app.setState({ setup: link.setup });
    app.showSetupSet();
    time.advance(200);
    await app.loadSet('wta-2023');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(app.state.setup.dataSet, 'wta-2023');
    // A men's season in a women's link is ignored.
    assert.deepEqual(readChallenge('?sport=womens-tennis&season=tennis-1985').ignored, ['season']);
  });
});
