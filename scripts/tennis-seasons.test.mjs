// Tennis's earlier seasons (docs/design/tennis.md, "Earlier seasons"): Tennis Abstract's own year-end Elo reports for
// 2016-2025 and Elo computed from Jeff Sackmann's match results by Tennis Abstract's method for 1973-2015, and for
// 1960-1972 by a second run warmed up on his amateur file ("Before 1973"), built from committed snapshots; the Davis
// Cup's nations of each season (Czechoslovakia, the Soviet Union, Yugoslavia, West Germany on today's map, South Africa
// barred); the per-season shift that keeps the best at 99; the method's checks against every list Tennis Abstract
// published and the seasons before 1973 against the published top tens; the loader and the running App choosing,
// launching and resuming a season.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SAVE_KEY } from '../src/config.js';
import { BUILT_IN_TENNIS_SEASONS } from '../src/data/tennisSeasons.js';
import { HISTORIC_NATIONS, HOME_NATIONS, NATIONS, makeRng, buildTeam } from '../src/data/teams.js';
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
const YEARS = Array.from({ length: 2025 - 1960 + 1 }, (_, i) => 2025 - i);
const EARLY = MANIFEST.method.early;

// ---------- building ----------

test('every season rebuilds byte for byte from its committed snapshot, and the snapshots from the pinned inputs', () => {
  assert.match(execFileSync(process.execPath, ['scripts/build-tennis-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the 66 tennis seasons, their listing, attribution and audit byte for byte/);
  // The snapshots rebuild from the archive and the captures, cached in the ignored data-src/ (not on a fresh checkout).
  const cached = Object.keys(MANIFEST.archive.files).every(file => existsSync(`${root}/data-src/tennis-seasons/sackmann/${file}`))
    && MANIFEST.reports.every(report => existsSync(`${root}/data-src/tennis-seasons/wayback/elo_${report.capture}.html`))
    && MANIFEST.rankings.every(capture => existsSync(`${root}/data-src/tennis-seasons/wayback/rank_${capture.capture}.html`));
  if (cached) {
    assert.match(execFileSync(process.execPath, ['scripts/sync-tennis-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
      /Verified the 66 tennis season snapshots and their validation byte for byte/);
  }
  for (const year of YEARS) {
    const data = snapshot(year);
    assert.equal(data.season, year);
    assert.equal(data.kind, year >= 2016 ? 'published' : 'computed');
    assert.equal(data.rated, data.players.length);
    assert.ok(data.players.every((row, i) => i === 0 || row[5] <= data.players[i - 1][5]), `${year} runs strongest first`);
    // The seasons before 1973 are the second run's: three counted matches each to 1967, ten from 1968, as from 1973.
    const floor = year >= 1973 ? MANIFEST.method.activity : year >= 1968 ? EARLY.activity.open : EARLY.activity.amateur;
    if (data.kind === 'computed') assert.ok(data.players.every(row => row[6] >= floor), `${year}: ${floor} counted matches each`);
    assert.deepEqual([data.run, data.activity], year < 1973 ? ['early', floor] : [undefined, undefined]);
    assert.equal(new Set(data.players.map(row => row[0])).size, data.players.length, `${year}: no man listed twice`);
  }
  // Every input is pinned: the 108 files of Sackmann's archive (the amateur file among them) and the 19 captures.
  assert.equal(Object.keys(MANIFEST.archive.files).length, 108);
  assert.equal(MANIFEST.archive.files[EARLY.file], '2edfa7ab1a1d14fff924dd824ed261d6bb845d954f13b56699157c0262859912');
  assert.ok(Object.values(MANIFEST.archive.files).every(hash => /^[0-9a-f]{64}$/.test(hash)));
  assert.ok([...MANIFEST.reports, ...MANIFEST.rankings].every(entry => /^[0-9a-f]{64}$/.test(entry.sha256) && /^\d{14}$/.test(entry.capture)));
});

test('the built-in seasons run from 2025 back to 1960: Tennis Abstract\'s own lists, then Elo computed by its method', () => {
  assert.deepEqual(BUILT_IN_TENNIS_SEASONS.map(set => set.id), YEARS.map(year => `tennis-${year}`));
  assert.equal(builtInSeasonOf('tennis').season, '2026', 'the built-in season stays November 2026\'s');
  const label = year => BUILT_IN_TENNIS_SEASONS.find(set => set.year === year).label;
  assert.equal(label(2023), 'Tennis Abstract Elo, December 2023');
  assert.equal(label(2019), 'Tennis Abstract Elo, December 2019');
  assert.equal(label(2017), 'Tennis Abstract Elo, through the ATP Finals', 'the 2017 list never took in the Davis Cup final');
  assert.equal(label(1985), 'Elo from match results, end of 1985');
  assert.equal(label(1975), 'Elo from match results, end of 1975 (rough)', 'the 1970s are rougher, and say so');
  assert.equal(label(1970), 'Elo from match results, end of 1970 (rough)');
  assert.equal(label(1962), 'Amateur Elo, end of 1962 (rough)', 'before 1968 the amateurs alone, and rough');
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
      assert.equal(!!doc.source.amateurs, year <= 1967);
      assert.match(doc.source.method, year < 1973 ? /warmed up on Jeff Sackmann's majors and Davis Cup results of 1877-1967/ : /^Tennis Abstract's published Elo method \(/);
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

// ---------- before 1973 ----------

test('before 1973 the amateurs alone: the professionals are missing until 1968, then back, Laver first in 1968-1970', () => {
  const ids = year => new Set(snapshot(year).players.map(row => row[0]));
  // Rosewall (100016) turned professional in 1957, Laver (100029) in 1963: the amateur file has no match of theirs.
  for (let year = 1960; year <= 1967; year++) assert.ok(!ids(year).has('100016'), `Rosewall is not an amateur in ${year}`);
  for (let year = 1963; year <= 1967; year++) assert.ok(!ids(year).has('100029'), `Laver is not an amateur in ${year}`);
  assert.equal(snapshot(1962).players[0][1], 'Rod Laver', 'the amateur Grand Slam year');
  assert.equal(snapshot(1965).players[0][1], 'Roy Emerson');
  // Open tennis: the professionals come back with their last amateur ratings, uncharged for the years away.
  for (const id of ['100029', '100016', '100005']) assert.ok(ids(1968).has(id), `${id} plays in 1968`);
  for (const year of [1968, 1969, 1970]) assert.equal(snapshot(year).players[0][1], 'Rod Laver', `Laver first at the end of ${year}, as Tennis Abstract has him`);
  assert.equal(snapshot(1972).players[0][1], 'Ilie Nastase');
  // Ratings on today's scale, no season over 99.
  for (let year = 1960; year <= 1972; year++) assert.equal(seasonFile(year).source.shift, undefined, `${year} needs no shift`);
});

test('before 1973 each man once: the amateur file\'s duplicate ids are merged, each pair checked', () => {
  const { items } = EARLY.aliases;
  assert.ok(items.length >= 200);
  const from = new Set(items.map(([id]) => id));
  assert.equal(from.size, items.length, 'no id merged twice');
  for (const [merged, kept, name, rule, kind] of items) {
    assert.notEqual(merged, kept);
    assert.ok(!from.has(kept), `${name}: no chain`);
    assert.match(rule, /^(name|initial|born|hand: .+)$/);
    assert.ok(['davis-cup', 'open-era'].includes(kind));
  }
  // Edison Mandarino's Davis Cup id joins Jose Edison Mandarino's: Brazil names him once.
  for (let year = 1960; year <= 1972; year++) assert.ok(!snapshot(year).players.some(row => row[0] === '109856'), `${year}`);
  assert.equal(squadNames(seasonFile(1967), '076').filter(name => /Mandarino/.test(name)).length, 1);
  // A surname spelt two ways is one man too: Julie Mayer ("Julius Mayer" in the 1961 ties, "Julian Mayers" at the majors)
  // and Andras Szikszay ("Szikszai" at the majors).
  assert.deepEqual(squadNames(seasonFile(1961), '710').filter(name => /Mayer/.test(name)), ['Julian Mayers']);
  assert.deepEqual(squadNames(seasonFile(1967), '348').filter(name => /Sziksza/.test(name)), ['Andras Szikszay']);
  // No nation lists two men of one first initial whose surnames are two letters or less apart: one man's two spellings.
  const plain = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').trim().split(/\s+/);
  const apart = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  for (let year = 1960; year <= 1972; year++) {
    const rows = snapshot(year).players;
    for (const [i, a] of rows.entries()) for (const b of rows.slice(i + 1)) {
      const [na, nb] = [plain(a[1]), plain(b[1])];
      if (a[2] !== b[2] || na[0][0] !== nb[0][0] || na.at(-1) === nb.at(-1) || Math.min(na.at(-1).length, nb.at(-1).length) < 4) continue;
      assert.ok(apart(na.at(-1), nb.at(-1)) > 2, `${year}: ${a[1]} and ${b[1]} may be one man`);
    }
  }
  // Brothers stay two men.
  assert.ok(squadNames(seasonFile(1968), '208').includes('Torben Ulrich') && squadNames(seasonFile(1968), '208').includes('Jorgen Ulrich'));
});

test('before 1973 the Davis Cup nations of the day: South Africa barred 1970-1972, the Soviet Union from 1962, the fixes', () => {
  // South Africa was expelled from the 1970 cup and readmitted in 1973.
  for (const year of [1968, 1969]) assert.ok(seasonFile(year).nations['710'], `South Africa plays in ${year}`);
  const audit = JSON.parse(read('docs/design/tennis-seasons-audit.json')).seasons;
  for (const year of [1970, 1971, 1972]) {
    assert.ok(!seasonFile(year).nations['710'] && seasonFile(year).territory.inactive.includes('710'), `barred in ${year}`);
    const barred = audit.find(row => row.id === `tennis-${year}`).leftOut.barred;
    assert.ok(barred.includes('Cliff Drysdale (RSA)') && barred.includes('Bob Hewitt (RSA)'), `${year}: ${barred}`);
  }
  // The Soviet Union's first cup was 1962: Russia holds the other republics from then.
  assert.ok(!seasonFile(1960).nations['643'] && !seasonFile(1961).nations['643']);
  assert.ok(seasonFile(1962).nations['643'] && seasonFile(1962).territory.merged['804'] === '643');
  // Drobny played for Egypt, then Britain; Mulligan was Australian until Italy's team of 1968, Hewitt until 1967.
  const row = (year, id) => snapshot(year).players.find(entry => entry[0] === id);
  assert.deepEqual(row(1960, '112517').slice(2, 4), ['GBR', 'fix']);
  assert.ok(squadNames(seasonFile(1960), '826').includes('Jaroslav Drobny'));
  assert.deepEqual(row(1962, '100050').slice(2, 4), ['AUS', 'fix']);
  assert.deepEqual(row(1968, '100050').slice(2, 4), ['ITA', 'davis-cup']);
  assert.deepEqual(row(1962, '100040').slice(2, 4), ['AUS', 'fix']);
  assert.deepEqual(row(1967, '100040').slice(2, 4), ['RSA', 'davis-cup']);
  assert.deepEqual(squadNames(seasonFile(1962), '036'), ['Rod Laver', 'Neale Fraser', 'Roy Emerson', 'Martin Mulligan', 'Bob Hewitt']);
  // Cliff Letcher took up Austria's Davis Cup offer in November 1974: Australian in 1971, Austrian by the window from the
  // shipped 1973 on.
  assert.deepEqual(row(1971, '100265').slice(2, 4), ['AUS', 'fix']);
  assert.ok(!squadNames(seasonFile(1971), '040').includes('Cliff Letcher'));
  assert.deepEqual(row(1973, '100265').slice(2, 4), ['AUT', 'davis-cup']);
  // Czechoslovakia and Yugoslavia hold their land while they field a team, as from 1973.
  assert.equal(seasonFile(1968).territory.merged['703'], '203');
  assert.equal(seasonFile(1968).territory.merged['191'], '688');
});

test('before 1973 the second run carries on as the first and agrees with the published top tens', () => {
  const { early, checks } = VALIDATION;
  assert.ok(Math.abs(early.fit.meanDiff) < 5 && early.fit.rms < 20, `1973-2000 targets: ${JSON.stringify(early.fit)}`);
  for (const [season, seam] of Object.entries(early.seam)) assert.ok(seam.meanAbsDiff < 5 && seam.n === 50, `${season}: ${JSON.stringify(seam)}`);
  // Tingay's ten: about seven shared a season, before and after 1968.
  assert.ok(checks.topTens.periods.amateur.shared >= 6 && checks.topTens.periods.open.shared >= 6, JSON.stringify(checks.topTens.periods));
  assert.ok(checks.topTens.periods.amateur.rho > 0.5, JSON.stringify(checks.topTens.periods));
  assert.deepEqual(Object.keys(checks.topTens.seasons), Array.from({ length: 13 }, (_, i) => String(1960 + i)));
  // Tennis Abstract's own year ends: Laver first in each.
  for (const statement of checks.statements.yearEnd) assert.equal(statement.ours[0], 'Rod Laver 1', `${statement.season}`);
  // Nothing from the published lists is in a season file.
  assert.ok(!read('public/tennis/tennis-1962.json').includes('Tingay'));
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
  // Every nation of today's map; East Germany (HISTORIC_NATIONS) never played the Davis Cup or the Fed Cup.
  assert.equal(Object.keys(NATIONS).length - HISTORIC_NATIONS.length, set.territory.inactive.length + Object.keys(set.territory.merged).length + fielded.length);
});

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
  clearFootballSetIndex: ['src/engine/footballSets.js', 'clearFootballSetIndex'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

// Czechia, Slovakia, the United States, Sweden, Germany and South Africa, unless a test names its own map.
async function withApp(fn, ids = ['203', '703', '840', '752', '276', '710']) {
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
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids,
    settings: { sport: 'tennis', layer: 'nations', scope: 'world', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn({ ...f, calls }); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}
const modelOf = app => buildSetupModel(app.state.setup, { managerTeams: app.setupTeams(), domestic: app.domesticStatus(), season: app.seasonStatus() });

test('tennis\'s Season choice lists 2026 and the 66 earlier seasons, newest first', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'tennis');
    const model = modelOf(app);
    assert.deepEqual(model.season.options.map(option => option.name), ['2026', ...YEARS.map(String)]);
    assert.equal(model.season.options[1].label, '2025 · Tennis Abstract Elo, December 2025');
    assert.equal(model.season.options.find(option => option.name === '1973').label, '1973 · Elo from match results, end of 1973 (rough)');
    assert.equal(model.season.options.at(-1).label, '1960 · Amateur Elo, end of 1960 (rough)');
    assert.match(model.season.note, /1960–1979 rough; before 1968 the amateurs' majors and Davis Cup only/);
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

test('an amateur season launches with its Davis Cup nations, the Soviet Union holding its republics, and resumes', async () => {
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'tennis');
    app.pickSetup('scope', 'world');
    app.pickSetup('dataSet', 'tennis-1962');
    time.advance(200);
    await app.loadSet('tennis-1962');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    const doc = seasonFile(1962);
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason], ['tennis-1962', doc.version, 1962, '1962']);
    assert.ok(calls.includes('/tennis/tennis-1962.json'));
    assert.deepEqual(st.teams['036'].squad.map(player => player.name), squadNames(doc, '036'), 'Laver\'s Australia');
    assert.ok(st.teams['036'].squad.every(player => player.sourceInfo.edition === 'Elo from match results' && !player.gen));
    assert.equal(st.own['804'], '643', 'Ukraine starts in the Soviet Union\'s empire');
    assert.deepEqual(st.aliveIds.slice().sort(), Object.keys(doc.nations).sort(), 'the 28 nations of 1962');
    const saved = parseCampaign(items.get(SAVE_KEY));
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams), 'the squads come back exactly');
  }, ['036', '643', '804', '840', '826', '380']); // Australia, Russia, Ukraine, the United States, Britain and Italy
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
