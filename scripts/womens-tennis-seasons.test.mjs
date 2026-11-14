// Women's tennis's earlier seasons (docs/design/womens-tennis.md, "Earlier seasons"): Tennis Abstract's own year-end WTA
// Elo reports for 2016-2025 and Elo computed from Jeff Sackmann's WTA match results by Tennis Abstract's method for
// 1973-2015, and for 1963-1972 by a second run warmed up on the majors' and the Federation Cup's results of 1960-1967
// from English Wikipedia's pages ("1963-1967"; the seasons before 1973 against the published top tens), built from
// committed snapshots; the pages read (draws, ties, dates, the women and their joins to the player file); the Fed Cup's
// nations of each season (Czechoslovakia, the Soviet Union, Yugoslavia, West Germany on today's map, South Africa
// barred) and the documented fixes; the per-season shift that keeps the best at 99; the method's checks against every
// list Tennis Abstract published and its Tennis 128 peaks; the loader and the running App choosing, launching and
// resuming a season.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SAVE_KEY } from '../src/config.js';
import { BUILT_IN_WOMENS_TENNIS_SEASONS } from '../src/data/womensTennisSeasons.js';
import { HISTORIC_NATIONS, HOME_NATIONS, NATIONS, makeRng, buildTeam } from '../src/data/teams.js';
import { BUILT_IN_SETS, builtInSeasonOf, decodeFootballSet, fieldedNations, seasonSport, setHasClubs, setHasNations, setKindOf, setSportOf,
  sportOf } from '../src/engine/footballSets.js';
import { WTA } from '../src/sports/tennis.js';
import { parseCampaign } from '../src/engine/storage.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { readChallenge } from '../src/screens/setup/challenge.js';
import { gameRating } from './lib/tennis.mjs';
import { ROUND_ORDER, wtaLevelOf } from './lib/tennis-elo.mjs';
import { codeOfDay, nationIdOf, nationOfDay, teamsOf } from './lib/tennis-seasons.mjs';
import { cupTies, dateOf, drawMatches, eventStart, linkKinds, pageOf, pinnedPages, playerCell, wikiFile, wikipediaMatches } from './lib/tennis-wikipedia.mjs';
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
const YEARS = Array.from({ length: 2025 - 1963 + 1 }, (_, i) => 2025 - i);
// The pinned Wikipedia pages and Wikidata answer, cached in the ignored data-src/ (not on a fresh checkout).
const WIKI_DIR = `${root}/data-src/womens-tennis-seasons/wikipedia`;
const sha1 = text => createHash('sha1').update(text).digest('hex');
const pagesCached = () => [...MANIFEST.wikipedia.draws.flatMap(row => [row[0], row[4]]), ...MANIFEST.wikipedia.cups.map(row => row[0]),
  ...MANIFEST.wikipedia.redirects.items.map(row => row[0])].every(title => existsSync(`${WIKI_DIR}/${wikiFile(title, sha1)}`))
  && existsSync(`${root}/data-src/womens-tennis-seasons/wikidata/${MANIFEST.wikipedia.wikidata.file}`)
  && existsSync(`${root}/data-src/womens-tennis-seasons/sackmann/wta_players.csv`);

// ---------- building ----------

test('every season rebuilds byte for byte from its committed snapshot, and the snapshots from the pinned inputs', () => {
  assert.match(execFileSync(process.execPath, ['scripts/build-tennis-seasons.mjs', '--tour=wta', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the 63 women's tennis seasons, their listing, attribution and audit byte for byte/);
  // The men's seasons still rebuild as they were before the women's tour joined.
  assert.match(execFileSync(process.execPath, ['scripts/build-tennis-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the 66 tennis seasons/);
  // The snapshots rebuild from the archive, the captures and the Wikipedia pages, cached in the ignored data-src/ (not on a
  // fresh checkout).
  const cached = Object.keys(MANIFEST.archive.files).every(file => existsSync(`${root}/data-src/womens-tennis-seasons/sackmann/${file}`))
    && MANIFEST.reports.every(report => existsSync(`${root}/data-src/womens-tennis-seasons/wayback/elo_${report.capture}.html`))
    && MANIFEST.rankings.every(capture => existsSync(`${root}/data-src/womens-tennis-seasons/wayback/rank_${capture.capture}.html`))
    && pagesCached();
  if (cached) {
    assert.match(execFileSync(process.execPath, ['scripts/sync-tennis-seasons.mjs', '--tour=wta', '--check'], { cwd: root, encoding: 'utf8' }),
      /Verified the 63 women's tennis season snapshots and their validation byte for byte/);
  }
  for (const year of YEARS) {
    const data = snapshot(year);
    assert.equal(data.season, year);
    assert.equal(data.kind, year >= 2016 ? 'published' : 'computed');
    assert.equal(data.rated, data.players.length);
    assert.ok(data.players.every((row, i) => i === 0 || row[5] <= data.players[i - 1][5]), `${year} runs strongest first`);
    // 1963-1967 list three counted matches, or a singles rubber of the year's cup (the cup's players are checked below).
    assert.equal(data.activity ?? MANIFEST.method.activity, year <= 1967 ? 3 : 10);
    assert.equal(!!data.cup, year <= 1967);
    if (data.kind === 'computed') assert.ok(data.players.every(row => row[6] >= (data.activity ?? MANIFEST.method.activity) || data.cup), `${year}: its counted matches each`);
    assert.equal(data.run === 'early', year <= 1972, `${year}: the second run makes the seasons before 1973`);
  }
  // Every input is pinned: the 117 files of Sackmann's WTA archive, the 20 captures, and Wikipedia's 32 draws, their
  // tournaments' 32 articles, the 5 cups, the 96 redirects and Wikidata's answer for the 248 articles.
  assert.equal(Object.keys(MANIFEST.archive.files).length, 117);
  assert.equal(MANIFEST.archive.commit, '83733587353df8a41f2fd4f516147d5aa83f5a8d');
  assert.ok(Object.values(MANIFEST.archive.files).every(hash => /^[0-9a-f]{64}$/.test(hash)));
  assert.ok([...MANIFEST.reports, ...MANIFEST.rankings].every(entry => /^[0-9a-f]{64}$/.test(entry.sha256) && /^\d{14}$/.test(entry.capture)));
  const W = MANIFEST.wikipedia;
  assert.deepEqual([W.draws.length, W.cups.length, W.redirects.items.length, W.wikidata.articles.length], [32, 5, 96, 248]);
  const pins = [...W.draws.flatMap(row => [[row[1], row[2], row[3]], [row[6], row[7], row[8]]]), ...W.cups.map(row => row.slice(1, 4)), ...W.redirects.items.map(row => row.slice(2, 5))];
  assert.ok(pins.every(([revision, sha, bytes]) => Number.isInteger(revision) && /^[0-9a-f]{64}$/.test(sha) && Number.isInteger(bytes)));
  assert.ok(/^[0-9a-f]{64}$/.test(W.wikidata.sha256) && W.read === '2026-11-14');
  // The draws of the four majors of 1960-1967 and the cups of 1963-1967, all read under /wiki/.
  assert.deepEqual(W.draws.map(row => row[0].slice(0, 4)), Array.from({ length: 32 }, (_, i) => String(1960 + Math.floor(i / 4))));
  assert.deepEqual(W.cups.map(row => row[0]), [1963, 1964, 1965, 1966, 1967].map(year => `${year} Federation Cup (tennis)`));
  assert.equal(W.page, 'https://en.wikipedia.org/wiki/{title}');
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

test('the built-in seasons run from 2025 back to 1963: Tennis Abstract\'s own lists, then Elo computed by its method', () => {
  assert.deepEqual(BUILT_IN_WOMENS_TENNIS_SEASONS.map(set => set.id), YEARS.map(year => `wta-${year}`));
  assert.equal(builtInSeasonOf('womens-tennis').season, '2026', 'the built-in season stays November 2026\'s');
  const label = year => BUILT_IN_WOMENS_TENNIS_SEASONS.find(set => set.year === year).label;
  assert.equal(label(2023), 'Tennis Abstract Elo, December 2023');
  assert.equal(label(2020), 'Tennis Abstract Elo, 9 November 2020, before Linz', 'no capture holds the season\'s last update');
  assert.equal(label(2016), 'Tennis Abstract Elo, November 2016');
  assert.equal(label(1985), 'Elo from match results, end of 1985');
  assert.equal(label(1975), 'Elo from match results, end of 1975 (rough)', 'the 1970s are rougher, and say so');
  assert.equal(label(1968), 'Elo from match results, end of 1968 (rough)', 'the files\' first year');
  assert.equal(label(1967), 'Amateur Elo, end of 1967 (rough)', 'before the open era, the amateurs\' majors and cup');
  assert.equal(label(1963), 'Amateur Elo, end of 1963 (rough)', 'the Federation Cup\'s first year');
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
        // A woman of the pages who is not the player file's keeps her own id before 1968.
        if (year < 1968) assert.match(source.id, /^(wta:\d+|wp:.+)$/);
        else if (year < 2016) assert.match(source.id, /^wta:\d+$/);
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
    } else if (year >= 1968) {
      assert.deepEqual([doc.source.edition, doc.source.computed, doc.source.name], ['Elo from match results', true, 'Jeff Sackmann\'s WTA match results (Tennis Abstract)']);
      assert.equal(!!doc.source.rough, year <= 1979);
      assert.equal(/warmed up on the majors' and the Federation Cup's results of 1960-1967 from English Wikipedia/.test(doc.source.method), year <= 1972);
    } else {
      // 1963-1967: the amateurs of Wikipedia's pages alone, the source citing that year's cup at its pinned revision.
      const cup = MANIFEST.wikipedia.cups.find(([title]) => title.startsWith(`${year} `));
      assert.deepEqual([doc.source.edition, doc.source.computed, doc.source.rough, doc.source.amateurs, doc.source.name, doc.source.url, doc.source.retrieved],
        ['Elo from match results', true, true, true, 'English Wikipedia: the majors\' women\'s singles draws and the Federation Cup',
          `https://en.wikipedia.org/w/index.php?oldid=${cup[1]}`, '2026-11-14']);
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
  assert.deepEqual([...hows].sort(), ['fed-cup', 'fix', 'flag', 'player-file', 'rankings']);
  // Her draws' flag decides only before 1968, for a woman with no cup row near.
  assert.ok(YEARS.filter(year => year >= 1968).every(year => snapshot(year).players.every(row => row[3] !== 'flag')));
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

test('1963-1972: Court and King lead Australia and the United States, South Africa plays, Tingay\'s tens agree', () => {
  const doc = seasonFile(1970);
  assert.equal(squadNames(doc, '036')[0], 'Margaret Court');
  assert.equal(squadNames(doc, '840')[0], 'Billie Jean King');
  assert.equal(snapshot(1971).players[0][1], 'Billie Jean King');
  for (const year of [1963, 1964, 1965, 1966]) assert.equal(squadNames(seasonFile(year), '036')[0], 'Margaret Court', `Court leads Australia in ${year}`);
  assert.ok(!everyone(1967).includes('Margaret Court'), 'Court spent 1967 away from the game');
  assert.equal(snapshot(1967).players[0][1], 'Billie Jean King');
  // South Africa played the Federation Cup until 1977 (it won the 1972 cup at home); it is barred only from 1978.
  for (const year of [1963, 1964, 1965, 1966, 1967, 1968, 1969, 1970, 1971, 1972]) assert.ok(seasonFile(year).nations['710'], `South Africa plays in ${year}`);
  // The 1971 cup is all but missing from the files (five rubbers, no tie names): nations come from the cups around it.
  assert.ok(snapshot(1971).players.filter(row => row[3] === 'fed-cup').length > 50);
  // Against Tingay's ten (married names joined: Margaret Smith is Margaret Court, Billie Jean Moffitt Billie Jean King),
  // about seven shared a season before 1968 and eight after. Every one of his women is rated in her season but Nancy
  // Richey in 1963: the U.S. Championships' pages show their last eight only, and the pages give her one match.
  const { topTens, statements } = VALIDATION.checks;
  assert.deepEqual(Object.keys(topTens.seasons), ['1963', '1964', '1965', '1966', '1967', '1968', '1969', '1970', '1971', '1972']);
  assert.ok(topTens.periods.amateur.shared >= 7 && topTens.periods.amateur.rho > 0.7, JSON.stringify(topTens.periods));
  assert.ok(topTens.periods.open.shared >= 8 && topTens.periods.open.rho > 0.65, JSON.stringify(topTens.periods));
  assert.deepEqual(Object.entries(topTens.seasons).filter(([, season]) => season.listed < 10).map(([year, season]) => [year, season.notListed]),
    [['1963', ['Nancy Richey: 1 counted matches']]]);
  // The warm-up lifts King, Tingay's first of 1968, from seventh to second; 1968 shares eight of his ten.
  assert.equal(snapshot(1968).players.findIndex(row => row[1] === 'Billie Jean King'), 1);
  assert.equal(topTens.seasons[1968].shared, 8);
  // Court's peak: Tennis Abstract's 2,389 of 1971; here 2,256 at the end of 1971, her peak in December 1973.
  const court = statements.peaks.find(peak => peak.name === 'Margaret Court');
  assert.ok(Math.abs(court.computed - court.published) < 50 && court.endOfYear < court.published, JSON.stringify(court));
  // The second run carries on as the first: from 1973 its Elo of the first run's top 50 is within a point and a half.
  const { early } = VALIDATION;
  assert.deepEqual(early.seasons, [1963, 1972]);
  assert.ok(Object.values(early.seam).every(season => Math.abs(season.meanDiff) < 1.5 && season.meanAbsDiff < 1.5), JSON.stringify(early.seam));
  assert.ok(Math.abs(early.fit.meanDiff - VALIDATION.fit.meanDiff) < 1 && Math.abs(early.fit.rms - VALIDATION.fit.rms) < 1, JSON.stringify(early.fit));
  assert.deepEqual([early.wikipedia.pages, early.wikipedia.matches, early.wikipedia.counted, early.wikipedia.women, early.wikipedia.playerFile],
    [37, 1991, 1882, 547, 278]);
});

// ---------- the pages of 1960-1967 ----------

// A page as Wikipedia serves it: Parsoid HTML, each template's wikitext in a data-mw attribute, its links rendered.
const mw = (name, params) => `<span data-mw='${JSON.stringify({ parts: [{ template: { target: { wt: name }, params: Object.fromEntries(Object.entries(params)
  .map(([key, wt]) => [key, { wt }])) } }] }).replace(/&/g, '&amp;').replace(/'/g, '&apos;').replace(/</g, '&lt;')}'></span>`;
const head = (title, revision, from = null) => `<script>RLCONF={"wgPageName":${JSON.stringify(title.replace(/ /g, '_'))},"wgRevisionId":${revision}`
  + `${from ? `,"wgRedirectedFrom":${JSON.stringify(from.replace(/ /g, '_'))}` : ''}};</script>`;
const link = (title, kind = 'article') => (kind === 'missing'
  ? `<a rel="mw:WikiLink" href="https://en.wikipedia.org/wiki/${title.replace(/ /g, '_')}?action=edit&amp;redlink=1" title="${title} (page does not exist)" class="new">x</a>`
  : `<a rel="mw:WikiLink" href="https://en.wikipedia.org/wiki/${title.replace(/ /g, '_')}" title="${title}"${kind === 'redirect' ? ' class="mw-redirect"' : ''}>x</a>`);

test('a draw page: its brackets\' rounds numbered back from the last, winners by their bold, walkovers and retirements unplayed', () => {
  assert.deepEqual(playerCell("{{flagicon|AUS}} '''[[Margaret Court|Margaret Smith]]'''"), { flag: 'AUS', link: 'Margaret Court', name: 'Margaret Smith', bold: true });
  assert.deepEqual(playerCell('{{flagicon|AUS}} [[Margaret Court|S]]mith'), { flag: 'AUS', link: 'Margaret Court', name: 'Smith', bold: false });
  assert.deepEqual(playerCell('{{flagicon|FRA}} Michelle Bourbonnais'), { flag: 'FRA', link: null, name: 'Michelle Bourbonnais', bold: false });
  assert.equal(playerCell(''), null, 'a bye');
  // A 64-line draw: a section of 16 whose last round is the quarter-finals, and the finals bracket that shows its
  // quarter-final again.
  const section = { RD1: 'First round', RD2: 'Second round', RD3: 'Third round', RD4: 'Quarterfinals',
    'RD1-team01': "{{flagicon|AUS}} '''[[Ann Able]]'''", 'RD1-score01-1': "'''6'''", 'RD1-score01-2': "'''6'''",
    'RD1-team02': '{{flagicon|USA}} [[Bea Bell]]', 'RD1-score02-1': '1', 'RD1-score02-2': '2',
    'RD1-team03': '{{flagicon|GBR}} [[Cat Cole]]', 'RD1-score03-1': 'w/o', 'RD1-team04': "{{flagicon|FRA}} '''[[Dee Dunn]]'''",
    'RD1-team05': "{{flagicon|ITA}} '''[[Eve Eng]]'''", 'RD1-score05-1': "'''6'''", 'RD1-score05-2': '4<sup>r</sup>',
    'RD1-team06': '{{flagicon|NED}} [[Fay Fox]]', 'RD1-score06-1': '3', 'RD1-score06-2': "'''5'''",
    'RD4-team01': "{{flagicon|AUS}} '''[[Ann Able]]'''", 'RD4-score01-1': "'''6'''", 'RD4-score01-2': "'''7'''",
    'RD4-team02': '{{flagicon|FRA}} [[Dee Dunn]]', 'RD4-score02-1': '2', 'RD4-score02-2': '5' };
  const finals = { 'RD1-team1': "{{flagicon|AUS}} '''[[Ann Able|Able]]'''", 'RD1-score1-1': "'''6'''", 'RD1-score1-2': "'''7'''",
    'RD1-team2': '{{flagicon|FRA}} [[Dee Dunn|Dunn]]', 'RD1-score2-1': '2', 'RD1-score2-2': '5' };
  const html = `${head('1999 Test Championships – Women\'s singles', 1)}${mw('8TeamBracket-Tennis3', finals)}${mw('16TeamBracket-Compact-Tennis3-Byes', section)}`;
  const matches = drawMatches(html);
  assert.deepEqual(matches.map(m => [m.round, m.a.name, m.b.name, m.winner, m.unplayed]), [
    ['QF', 'Able', 'Dunn', 0, false],
    ['R64', 'Ann Able', 'Bea Bell', 0, false], ['R64', 'Cat Cole', 'Dee Dunn', 1, true], ['R64', 'Eve Eng', 'Fay Fox', 0, true],
  ], 'the quarter-final shown twice is one match; a walkover and a retirement are unplayed');
  // A section whose last round is the fourth precedes the finals' quarter-finals: its first round has 128 players.
  const wimbledon = { ...section, RD4: 'Fourth round' };
  assert.equal(drawMatches(mw('16TeamBracket-Compact-Tennis3', wimbledon))[0].round, 'R128');
  // The pages' dates: the first day, the singles' week where the doubles' is given apart.
  assert.equal(dateOf('22 January-1 February 1960'), 19600122);
  assert.equal(dateOf('August 30 – September 10', 1967), 19670830);
  const us1960 = mw('TennisEventInfo', { date: "August 21–28{{efn|name=md-wd|Men's and women's doubles}} <br> September 2–17{{efn|name=ms-ws-mx|Men's and women's singles and mixed doubles}}" });
  assert.equal(eventStart(us1960, 1960), 19600902);
  // Links: an article, a redirect, a red link.
  const kinds = linkKinds(`${link('Margaret Court')}${link('Margaret Smith Court', 'redirect')}${link('Jan Shearer (tennis)', 'missing')}`);
  assert.deepEqual([...kinds], [['Margaret Court', 'article'], ['Margaret Smith Court', 'redirect'], ['Jan Shearer (tennis)', 'missing']]);
  assert.deepEqual(pageOf(head('Margaret Court', 7, 'Margaret Smith Court')), { title: 'Margaret Court', revision: 7, redirectedFrom: 'Margaret Smith Court' });
});

test('a Federation Cup page: each tie\'s two singles and its doubles, its day, its teams', () => {
  const tie = mw('FedCupbox3', { team1: 'Australia', team2: 'Belgium', date: '17 June 1963',
    R1: '{{ TennisMatch3 |T1P1=[[Margaret Court|Margaret Smith]] |6 |6 | |T2P1=[[Christiane Mercelis]] |3 |1 | }}',
    R2: '{{ TennisMatch3 |T1P1=[[Jan Lehane]] |6 |6 | |T2P1=[[Elza Bellens]] |0 |3 | }}',
    R3: '{{ TennisMatch3 |T1P1=[[Margaret Court|Margaret Smith]] |T1P2=[[Lesley Turner Bowrey|Lesley Turner]] |6 |6 | |T2P1=[[Mary Marechal]] |T2P2=[[Christiane Mercelis]] |1 |0 | }}' });
  const [one] = cupTies(tie, 1963);
  assert.deepEqual([one.team1, one.team2, one.date], ['Australia', 'Belgium', 19630617]);
  assert.deepEqual(one.rubbers.map(r => [r.no, r.doubles, r.t1.map(p => p.link).join('/'), r.t2.map(p => p.name).join('/'), r.winner, r.score]), [
    [1, false, 'Margaret Court', 'Christiane Mercelis', 0, '6-3 6-1'], [2, false, 'Jan Lehane', 'Elza Bellens', 0, '6-0 6-3'],
    [3, true, 'Margaret Court/Lesley Turner Bowrey', 'Mary Marechal/Christiane Mercelis', 0, '6-1 6-0']]);
});

test('the women of the pages: redirects followed, reviewed aliases and joins, the player file\'s ids, the cup\'s singles', () => {
  const people = new Map([['200144', { name: 'Margaret Court', ioc: 'AUS', wikidata: 'Q1' }], ['200500', { name: 'Jan Lehane', ioc: 'AUS', wikidata: null }]]);
  const draw = `${head('1963 Test Championships – Women\'s singles', 1)}${link('Margaret Smith Court', 'redirect')}${link('Jan Lehane', 'missing')}`
    + mw('8TeamBracket-Tennis3', { 'RD1-team1': "{{flagicon|AUS}} '''[[Margaret Smith Court|Smith]]'''", 'RD1-score1-1': "'''6'''", 'RD1-score1-2': "'''6'''",
      'RD1-team2': '{{flagicon|AUS}} [[Jan Lehane|Lehane]]', 'RD1-score2-1': '1', 'RD1-score2-2': '1',
      'RD1-team3': '{{flagicon|AUS}} J. Lehane', 'RD1-score3-1': '6', 'RD1-score3-2': '6', 'RD1-team4': "{{flagicon|SAF}} '''Ann Able'''", 'RD1-score4-1': "'''8'''", 'RD1-score4-2': "'''8'''" });
  const cup = `${head('1963 Federation Cup (tennis)', 2)}${link('Margaret Court')}`
    + mw('FedCupbox3', { team1: 'Australia', team2: 'South Africa', date: '17 June 1963',
      R1: '{{ TennisMatch3 |T1P1=[[Margaret Court]] |6 |6 | |T2P1=Ann Able |3 |1 | }}' });
  const input = rules => ({ draws: [{ title: '1963 Test Championships – Women\'s singles', html: draw, start: 19630110, event: 'wp-1963-AO' }],
    cups: [{ title: '1963 Federation Cup (tennis)', html: cup, year: 1963, event: 'wp-1963-FC' }],
    redirects: new Map([['Margaret Smith Court', 'Margaret Court']]), qids: new Map([['Margaret Court', 'Q1']]), people, roundOrder: ROUND_ORDER,
    rules: { flags: { SAF: 'RSA' }, teams: { Australia: 'AUS', 'South Africa': 'RSA' }, sameCodes: {}, aliases: [], joins: [], ...rules } });
  const result = wikipediaMatches(input({ joins: [['Jan Lehane', '200500', 'name']] }));
  // The redirect and the article are one woman, the player file's by her article's Wikidata item; the red link is the
  // player file's by the reviewed join; the unlinked "J. Lehane" is a woman of her own until an alias joins her.
  assert.deepEqual(result.matches.map(m => [m.winner, m.loser, m.level, m.why]), [['200144', '200500', 'G', null], ['wp:Ann Able|RSA', 'wp:J. Lehane|AUS', 'G', null],
    ['200144', 'wp:Ann Able|RSA', 'D', null]]);
  assert.deepEqual([...result.cupSingles.get(1963)].sort(), ['200144', 'wp:Ann Able|RSA']);
  assert.deepEqual(result.women.get('wp:Ann Able|RSA'), { name: 'Ann Able', ioc: 'RSA', born: null, keys: ['Ann Able|RSA'] });
  assert.deepEqual([...result.flags.get('200144').get(1963)], [['AUS', 1]], 'her draws\' flags, not her cup team');
  // A reviewed row of rule 'name' is checked: one plain name in one country.
  assert.throws(() => wikipediaMatches(input({ aliases: [['J. Lehane|AUS', 'Margaret Court', 'name']] })), /not one name in one country/);
  assert.throws(() => wikipediaMatches(input({ aliases: [['J. Lehane|AUS', 'Ann Able|RSA', 'initial', 'two opponents']] })), /are one woman/);
  assert.throws(() => wikipediaMatches(input({ joins: [['Ann Able|RSA', '200500', 'name']] })), /not one name in one country/);
  assert.throws(() => wikipediaMatches(input({ aliases: [['Jan Lehane', 'Margaret Court', 'name']] })), /one woman|not one name/, 'opponents are two women');
  assert.doesNotThrow(() => wikipediaMatches(input({ aliases: [['J. Lehane|AUS', 'Jan Lehane', 'initial', 'Her initial, in the draw of her own year']] })));
  // The manifest's reviewed rows: every alias and join either of rule 'name' or explained.
  const { aliases, joins } = MANIFEST.method.early;
  assert.deepEqual([aliases.items.length, joins.items.length], [45, 120]);
  assert.ok([...aliases.items, ...joins.items].every(([, , rule, why]) => rule === 'name' || (rule === 'spelling' && why)));
});

test('1963-1967: every Federation Cup nation fields a team of the women who played its singles', async () => {
  // The cups' nations, from the pinned pages (the 1965 cup, in Melbourne, drew eleven).
  const CUPS = {
    1963: ['036', '040', '056', '124', '203', '208', '250', '276', '826', '348', '380', '528', '578', '710', '756', '840'],
    1964: ['032', '036', '040', '056', '124', '203', '208', '250', '276', '826', '372', '380', '392', '484', '528', '578', '710', '752', '756', '840'],
    1965: ['032', '036', '076', '250', '276', '826', '380', '392', '554', '710', '840'],
    1966: ['032', '036', '040', '056', '100', '124', '203', '250', '276', '826', '348', '380', '504', '528', '616', '716', '710', '752', '756', '840'],
    1967: ['036', '056', '124', '208', '250', '276', '826', '380', '528', '578', '716', '710', '752', '756', '840'],
  };
  for (const [year, nations] of Object.entries(CUPS)) {
    const doc = seasonFile(Number(year));
    for (const nation of nations) assert.ok(doc.nations[nation], `${year}: ${NATIONS[nation][0]} played the cup and fields a team`);
    assert.equal(nations.length, { 1963: 16, 1964: 20, 1965: 11, 1966: 20, 1967: 15 }[year]);
  }
  // Two nations more, of two rated women each: the Soviet Union of 1967 (its first cup was 1968) holds its republics.
  assert.deepEqual(squadNames(seasonFile(1967), '643'), ['Galina Baksheeva', 'Anna Dmitrieva']);
  assert.equal(seasonFile(1967).territory.merged['804'], '643');
  // Maria Bueno is Brazil's only rated woman but in 1965, when Maureen Schwartz played the cup with her: a nation needs two.
  assert.deepEqual(squadNames(seasonFile(1965), '076'), ['Maria Bueno', 'Maureen Schwartz']);
  for (const year of [1963, 1964, 1966, 1967]) assert.ok(!everyone(year).includes('Maria Bueno'), `${year}`);
  // Rhodesia (Zimbabwe's land) plays its cups of 1966 and 1967; Czechoslovakia holds Slovakia.
  assert.deepEqual(squadNames(seasonFile(1966), '716'), ['Patricia Walkden', 'Joan Walker']);
  assert.equal(seasonFile(1963).territory.merged['703'], '203');
  // With the pages cached: every woman who played a singles rubber of her year's cup is listed, plays for that cup's
  // nation, and is in its five (but Gail Sherriff in 1966, Australia's sixth best: Court and Turner did not play that cup).
  if (!pagesCached()) return;
  const W = MANIFEST.wikipedia, E = MANIFEST.method.early;
  const { draws, cups, redirects } = await pinnedPages(W, title => readFileSync(`${WIKI_DIR}/${wikiFile(title, sha1)}`, 'utf8'));
  const lines = readFileSync(`${root}/data-src/womens-tennis-seasons/sackmann/wta_players.csv`, 'utf8').split(/\r?\n/).filter(Boolean);
  const people = new Map(lines.slice(1).map(line => { const c = line.split(','); return [c[0], { name: `${c[1]} ${c[2]}`.trim(), ioc: c[5] || null, wikidata: /^Q\d+$/.test(c[7] ?? '') ? c[7] : null }]; }));
  const answer = JSON.parse(readFileSync(`${root}/data-src/womens-tennis-seasons/wikidata/${W.wikidata.file}`, 'utf8'));
  const wiki = wikipediaMatches({ draws, cups, redirects, people, roundOrder: ROUND_ORDER,
    qids: new Map(answer.results.bindings.map(row => [row.title.value, row.item.value.replace(/^.*\//, '')])),
    rules: { flags: W.flags, teams: W.teams, sameCodes: W.sameCodes, aliases: E.aliases.items, joins: E.joins.items } });
  const outside = [];
  for (const [year, ids] of wiki.cupSingles) {
    const rows = new Map(snapshot(year).players.map(row => [row[0], row]));
    const played = new Map(wiki.matches.filter(m => m.season === year && m.level === 'D').flatMap(m => [[m.winner, m.winnerIoc], [m.loser, m.loserIoc]]));
    for (const id of ids) {
      const row = rows.get(id);
      assert.ok(row, `${year}: ${id} played the cup's singles and is listed`);
      assert.equal(row[2], played.get(id), `${year}: ${row[1]} plays for the nation of her cup`);
      const nation = nationIdOf(row[2], year, MANIFEST.nations);
      if (!squadNames(seasonFile(year), nation).includes(row[1])) outside.push(`${year} ${row[1]}`);
    }
  }
  assert.deepEqual(outside, ['1966 Gail Sherriff']);
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

test('women\'s tennis\'s Season choice lists 2026 and the 63 earlier seasons, newest first', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'womens-tennis');
    const model = modelOf(app);
    assert.deepEqual(model.season.options.map(option => option.name), ['2026', ...YEARS.map(String)]);
    assert.equal(model.season.options[1].label, '2025 · Tennis Abstract Elo, December 2025');
    assert.equal(model.season.options.at(-1).label, '1963 · Amateur Elo, end of 1963 (rough)');
    assert.match(model.season.note, /\(1963–1979 rough; before 1968 the majors and the Federation Cup only, as Wikipedia records them\)/);
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

test('the open era\'s first season, 1968, launches with its Fed Cup nations, South Africa among them, and resumes', async () => {
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'womens-tennis');
    app.pickSetup('scope', 'world');
    app.pickSetup('dataSet', 'wta-1968');
    time.advance(200);
    await app.loadSet('wta-1968');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    const doc = seasonFile(1968);
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason], ['wta-1968', doc.version, 1968, '1968']);
    assert.ok(calls.includes('/womens-tennis/wta-1968.json'));
    assert.deepEqual(st.teams['036'].squad.map(player => player.name), squadNames(doc, '036'), 'Court\'s Australia');
    assert.ok(st.teams['710'] && st.teams['840'], 'South Africa plays the 1968 cup, as do the United States');
    assert.ok(st.own['703'] === '203', 'Slovakia starts in Czechoslovakia\'s empire');
    assert.deepEqual(st.aliveIds.slice().sort(), Object.keys(doc.nations).sort());
    const saved = parseCampaign(items.get(SAVE_KEY));
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams), 'the squads come back exactly');
  });
});

test('the first season, 1963, launches with the Federation Cup\'s first nations and resumes', async () => {
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'womens-tennis');
    app.pickSetup('scope', 'world');
    app.pickSetup('dataSet', 'wta-1963');
    time.advance(200);
    await app.loadSet('wta-1963');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    const doc = seasonFile(1963);
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason], ['wta-1963', doc.version, 1963, '1963']);
    assert.ok(calls.includes('/womens-tennis/wta-1963.json'));
    assert.deepEqual(st.teams['036'].squad.map(player => player.name), squadNames(doc, '036'), 'Court\'s Australia');
    assert.equal(st.teams['036'].squad[0].name, 'Margaret Court');
    assert.ok(st.teams['203'] && st.own['703'] === '203', 'Suková\'s Czechoslovakia holds Slovakia');
    assert.ok(st.teams['710'] && st.teams['840'] && st.teams['276'], 'South Africa, the United States and West Germany played the first cup');
    assert.deepEqual(st.aliveIds.slice().sort(), Object.keys(doc.nations).sort(), 'the 16 nations of the first cup');
    const saved = parseCampaign(items.get(SAVE_KEY));
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams), 'the squads come back exactly');
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
