// The computed national-team seasons between the computed World Cups, 1962/63 to 1992/93 (docs/design/football-years.md,
// "Computed national-team seasons"): the Wikidata reader on hand-made answers, the pools, the XI and its order, the
// Ballon d'Or matching, the committed facts and seasons rebuilt byte for byte, every year of football filled, history's
// spot checks, the federations of the day, the theatres, the loader's refusals, and a 1971/72 campaign saved and
// resumed without the season's file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SAVE_KEY } from '../src/config.js';
import { NATIONS } from '../src/data/teams.js';
import { BUILT_IN_SEASONS } from '../src/data/footballSeasons.js';
import { contentHash } from '../src/data/footballSetBuild.js';
import { nationTheatres } from '../src/data/scopes.js';
import {
  BUILT_IN_SETS, decodeFootballSet, fieldedNations, isFootballSetId, seasonSport, setHasClubs, setHasNations, setKindOf, setSportOf,
} from '../src/engine/footballSets.js';
import { parseCampaign } from '../src/engine/storage.js';
import { readChallenge } from '../src/screens/setup/challenge.js';
import { SEASON_NOTES, buildSetupModel } from '../src/screens/setup/setupModel.js';
import { sourceLabel, sourceTitle, sourceUrl } from '../src/viewModels/squad.js';
import { ballonDorPoints, sparqlRows, teamCountry, wikidataTables } from './lib/national-team-facts.mjs';
import {
  NATIONAL_TEAMS_LABEL, buildNationalTeamSeason, capsBy, coverOf, listedPosition, nationalTeamsAttribution, orderNationalEleven,
  pickNationalEleven, seasonPools,
} from './lib/national-team-seasons.mjs';
import { committedSeasons, eaSeasonIds, footballSeasonsModule, nationalTeamSeasonIds, retroSeasonIds, worldCupSeasonIds } from './lib/football-seasons-listing.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = file => readFileSync(path.join(root, file), 'utf8');
const json = file => JSON.parse(read(file));
const MANIFEST = json('scripts/data/national-team-seasons.json');
const WORLD_CUP = json('scripts/data/world-cup-seasons.json');
const WIKIDATA = json('scripts/data/national-team-seasons/wikidata.json');
const ELO = json('scripts/data/national-team-seasons/elo.json').seasons;
const VOTES = json('scripts/data/national-team-seasons/ballon-dor.json').years;
const IDS = MANIFEST.seasons.map(season => season.id);
const committed = id => json(`public/football/${id}.json`);
const names = (doc, nation) => doc.nations[nation][2].map(([name]) => name);
const WIKI = 'http://www.wikidata.org/entity/';
const RANK = 'http://wikiba.se/ontology#';

// ---------- the rule ----------

test('the seasons fill every year between the World Cups, and share their constants', () => {
  const worldCupYears = WORLD_CUP.seasons.map(season => season.year);
  const years = MANIFEST.seasons.map(season => season.year);
  const between = [];
  for (let year = worldCupYears[0] + 1; year < worldCupYears.at(-1); year++) if (!worldCupYears.includes(year)) between.push(year);
  assert.deepEqual(years, between, 'every season-end year from 1963 to 1993 that ends no World Cup');
  assert.equal(years.length, 24);
  for (const key of ['elo', 'strength', 'xi', 'profile', 'profileSource']) assert.deepEqual(MANIFEST[key], WORLD_CUP[key], key);
  assert.deepEqual(MANIFEST.sources.results, WORLD_CUP.sources.results, 'the same pinned results');
  assert.deepEqual(MANIFEST.names.ballonDorNationalities, WORLD_CUP.names.ballonDorNationalities);
  for (const season of MANIFEST.seasons) assert.deepEqual(season.ballonDor, [season.year - 1, season.year]);
  // Each Ballon d'Or page the World Cup seasons pinned is pinned alike here.
  for (const page of MANIFEST.sources.ballonDor.pages) {
    const theirs = WORLD_CUP.sources.ballonDor.pages.find(other => other.title === page.title);
    if (theirs) assert.deepEqual(page, theirs, page.title);
    assert.match(page.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isInteger(page.revision) && Number.isInteger(page.bytes), page.title);
  }
  for (const file of MANIFEST.sources.wikidata.files) {
    assert.match(file.sha256, /^[0-9a-f]{64}$/, file.name);
    assert.ok(MANIFEST.sources.wikidata.queries[file.query], `${file.name} is the answer to a query the manifest holds`);
  }
  assert.equal(MANIFEST.sources.wikidata.endpoint, 'https://qlever.dev/api/wikidata', 'never the robots-disallowed Query Service');
});

test('the Wikidata reader: stints with a start, deprecated ones out, an open stint closed by its caps, goals conceded dropped', () => {
  const row = (vars, values) => Object.fromEntries(vars.map((name, i) => [name, values[i] == null ? undefined : { value: values[i] }]));
  const answer = (vars, rows) => sparqlRows({ head: { vars }, results: { bindings: rows.map(values => row(vars, values)) } });
  const day = year => `${year}-01-01T00:00:00Z`;
  const teams = answer(['team', 'teamLabel'], [[`${WIKI}Q1`, 'Atlantis men\'s national football team'], [`${WIKI}Q2`, 'Canadian men\'s national soccer team'],
    [`${WIKI}Q3`, 'Mu national under-21 football team']]);
  const st = n => `${WIKI}statement/S${n}`;
  const stints = answer(['player', 'team', 'st', 'rank', 'start', 'end', 'caps', 'goals'], [
    [`${WIKI}Q10`, `${WIKI}Q1`, st(1), `${RANK}NormalRank`, day(1960), day(1970), '50', '10'],
    [`${WIKI}Q11`, `${WIKI}Q1`, st(2), `${RANK}DeprecatedRank`, day(1960), day(1970), '5', '0'],
    [`${WIKI}Q12`, `${WIKI}Q1`, st(3), `${RANK}PreferredRank`, day(1968), null, '20', '-30'],
    [`${WIKI}Q13`, `${WIKI}Q1`, st(4), `${RANK}NormalRank`, day(1968), null, null, null],
    [`${WIKI}Q14`, `${WIKI}Q2`, st(5), `${RANK}NormalRank`, day(1971), day(1972), '3', null],
    [`${WIKI}Q14`, `${WIKI}Q2`, st(5), `${RANK}NormalRank`, day(1970), day(1972), '4', 'http://www.wikidata.org/.well-known/genid/ab12'],
    [`${WIKI}Q15`, `${WIKI}Q3`, st(6), `${RANK}NormalRank`, day(1970), day(1971), '9', '1'],
    [`${WIKI}Q16`, `${WIKI}Q1`, st(7), `${RANK}PreferredRank`, day(1940), day(1950), '9', '1'],
  ]);
  const players = answer(['player', 'label', 'mulLabel', 'birth', 'enwiki'], [
    [`${WIKI}Q10`, 'Ann Able', null, day(1940), 'https://en.wikipedia.org/wiki/Ann_Able'], [`${WIKI}Q11`, 'Wrong', null, null, null],
    [`${WIKI}Q12`, null, 'Bo Mul', 'http://www.wikidata.org/.well-known/genid/cd34', null], [`${WIKI}Q13`, 'Never', null, null, null],
    [`${WIKI}Q14`, 'Cy Two', null, day(1950), 'https://en.wikipedia.org/wiki/Cy_Two'], [`${WIKI}Q15`, 'Under', null, null, null],
    [`${WIKI}Q16`, 'Old', null, null, null]]);
  const positions = answer(['player', 'position'], [[`${WIKI}Q10`, `${WIKI}Q201330`], [`${WIKI}Q12`, `${WIKI}Q8025128`],
    [`${WIKI}Q12`, `${WIKI}Q280658`], [`${WIKI}Q14`, `${WIKI}Q2304909`]]);
  const names = { ...MANIFEST.names, ignoreTeams: ['Q3'] };
  const tables = wikidataTables({ teams, stints, players, positions }, { positions: MANIFEST.positions, names, years: [1962, 1993], openCapsPerYear: 8 });
  assert.deepEqual(tables.teams, [['Q1', 'Atlantis'], ['Q2', 'Canada']], 'suffix stripped, the manifest\'s country names, ignored teams out');
  assert.deepEqual(tables.stints, [
    ['Q10', 'Q1', 1960, 1970, 50, 10, 0],
    ['Q12', 'Q1', 1968, 1970, 20, null, 1], // ⌈20 / 8⌉ = 3 years; goals conceded (−30) are not goals
    ['Q14', 'Q2', 1970, 1972, 4, null, 0], // two rows of one statement: the earliest start, the most caps; an unknown value is none
  ]);
  assert.deepEqual(tables.players, [['Q10', 'Ann Able', '1940-01-01', 'Ann Able', ['GK']], ['Q12', 'Bo Mul', null, null, ['MF', 'FW']],
    ['Q14', 'Cy Two', '1950-01-01', 'Cy Two', []]], 'the mul label where English has none; an ice hockey position is none');
  assert.deepEqual([tables.audit.deprecated, tables.audit.noEnd, tables.audit.ended, tables.audit.conceded, tables.audit.multiValued], [1, 1, 1, 1, 1]);
  assert.equal(teamCountry('The Gambia men\'s national football team', MANIFEST.names), 'Gambia');
});

test('pools, the XI and its order', () => {
  assert.deepEqual([coverOf(1970, 1975, 1972), coverOf(1972, 1975, 1972), coverOf(1965, 1971, 1972), coverOf(1965, 1970, 1972)], [2, 1, 1, 0]);
  assert.deepEqual([capsBy(1970, 1979, 50, 1972), capsBy(1970, 1979, 50, 1969), capsBy(1970, 1979, 50, 1980), capsBy(1970, 1979, null, 1975)], [15, 0, 50, 0]);
  const people = [['Q1', 'Keeper', null, null, ['GK']], ['Q2', 'Both', null, null, ['MF', 'FW']], ['Q3', 'Away', null, null, ['DF']],
    ['Q4', 'Nameless', null, null, []]];
  const stints = [['Q1', 'QA', 1970, 1979, 50, 0, 0], ['Q2', 'QA', 1971, 1972, 4, 1, 0], ['Q2', 'QB', 1960, 1971, 60, 9, 0],
    ['Q3', 'QB', 1972, 1975, 40, 2, 0], ['Q3', 'QC', 1965, 1972, 8, 0, 0], ['Q4', 'QA', 1970, 1975, 30, 3, 0]];
  const nationOf = team => ({ QA: '100', QB: '200', QC: '200' })[team] ?? null;
  const pools = seasonPools({ players: people, stints }, 1972, nationOf);
  // Both: 4 caps over 2 years for A (2 a year, both years: 2) loses to 60 over 12 for B (5 a year, halved for one year: 2.5).
  assert.deepEqual([...pools.keys()], ['100', '200']);
  assert.deepEqual(pools.get('100').map(p => [p.qid, p.figure, p.total]), [['Q1', 5, 15]], 'no one without a position; Both plays for B');
  // Away: 40 over 4 for B (10 a year, halved: 5) beats 8 over 8 for C (1); his caps by then are B's 10 and C's 8.
  assert.deepEqual(pools.get('200').map(p => [p.qid, p.team, p.figure, p.total]),
    [['Q2', 'QB', 2.5, 60], ['Q3', 'QB', 5, 18]], 'one pool for the two teams of a nation, caps by then summed over both');
  const pool = [
    { qid: 'Q1', positions: ['GK'], figure: 5, total: 40 }, { qid: 'Q2', positions: ['GK'], figure: 6, total: 10 },
    ...['Q3', 'Q4', 'Q5'].map((qid, i) => ({ qid, positions: ['DF'], figure: 4 - i, total: 20 })),
    ...['Q6', 'Q7', 'Q8', 'Q9', 'Q10'].map((qid, i) => ({ qid, positions: ['MF', 'FW'], figure: 7 - i, total: 30 - i })),
    { qid: 'Q11', positions: ['FW'], figure: 1, total: 5 }, { qid: 'Q12', positions: ['GK'], figure: 0.5, total: 1 },
  ];
  const { eleven, filled } = pickNationalEleven(pool, MANIFEST.xi);
  assert.deepEqual(eleven.map(p => `${p.qid}:${p.role}`), ['Q2:GK', 'Q3:DF', 'Q4:DF', 'Q5:DF', 'Q6:MF', 'Q7:MF', 'Q8:MF', 'Q9:MF',
    'Q10:FW', 'Q11:FW', 'Q1:DF'], 'the highest figures per role; the short defence takes the best left, the other keeper');
  assert.deepEqual(filled.map(p => p.qid), ['Q1']);
  assert.deepEqual([listedPosition(eleven[4]), listedPosition(eleven[8]), listedPosition(eleven[10])], ['MF/FW', 'FW/MF', 'GK']);
  const ordered = orderNationalEleven(eleven.map(p => ({ ...p, ballonDor: p.qid === 'Q11' ? { 1972: 3 } : {} })));
  assert.deepEqual(ordered.slice(0, 3).map(p => p.qid), ['Q11', 'Q1', 'Q6'], 'Ballon d\'Or points first, then caps by then');
});

test('Ballon d\'Or votes match Wikidata players by article, a pinned redirect, or name within the team', () => {
  const players = [['Q1', 'Johan Cruyff', null, 'Johan Cruyff', ['FW']], ['Q2', 'Toni Schumacher', null, 'Toni Schumacher', ['GK']],
    ['Q3', 'Jan Jansen', null, null, ['DF']]];
  const stints = [['Q1', 'QN', 1966, 1977, 48, 33, 0], ['Q2', 'QG', 1979, 1986, 76, 0, 0], ['Q3', 'QN', 1970, 1972, 5, 0, 0]];
  const teams = [['QN', 'Netherlands'], ['QG', 'Germany']];
  const votes = [{ name: 'Johan Cruyff', title: 'Johan Cruyff', nationality: 'Netherlands', points: 116 },
    { name: 'Harald Schumacher', title: 'Harald Schumacher', nationality: 'West Germany', points: 12 },
    { name: 'Jan Jansen', title: null, nationality: 'Netherlands', points: 2 }, { name: 'Nobody', title: 'Nobody', nationality: 'Spain', points: 1 }];
  const pinned = [{ vote: 'Harald Schumacher', nationality: 'West Germany', qid: 'Q2', name: 'Toni Schumacher' }];
  assert.deepEqual(ballonDorPoints(votes, { year: 1972, players, stints, teams, pinned }),
    { points: [['Q1', 116], ['Q2', 12], ['Q3', 2]], unmatched: [['Nobody', 'Spain', 1]], pinned: ['Harald Schumacher'] });
  assert.throws(() => ballonDorPoints(votes, { year: 1972, players, stints, teams, pinned: [{ ...pinned[0], name: 'Harald' }] }), /whom Wikidata calls/);
  // On the pinned pages every vote but two finds its man: Peiró's last stint ended in 1959, Bjerregaard has none.
  const unmatched = Object.entries(VOTES).flatMap(([year, { unmatched: missed }]) => missed.map(([name]) => `${year} ${name}`));
  assert.deepEqual(unmatched, ['1962 Joaquín Peiró', '1967 Johnny Bjerregaard']);
});

test('the facts rebuild byte for byte from the pinned sources (when they are in data-src/)', t => {
  const dir = path.join(root, 'data-src', MANIFEST.sources.wikidata.folder);
  if (!existsSync(path.join(dir, MANIFEST.sources.wikidata.files[0].name))) {
    t.skip('data-src/wikidata-national-teams is not here');
    return;
  }
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/sync-national-team-seasons.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /3 files rebuild byte for byte/);
});

// ---------- the seasons ----------

test('the 24 seasons are built in beside the World Cups, labelled computed, and football has a season every year', () => {
  const listed = BUILT_IN_SEASONS.filter(set => setKindOf(set.id) === 'nt');
  assert.deepEqual(listed.map(set => set.id), IDS.slice().reverse(), 'newest first');
  const years = new Set(BUILT_IN_SEASONS.map(set => set.year));
  for (let year = 1962; year <= 2026; year++) assert.ok(years.has(year), `a football season ends in ${year}`);
  for (const set of listed) {
    const doc = committed(set.id);
    assert.deepEqual([doc.id, doc.version, doc.year, doc.season, doc.label], [set.id, set.version, set.year, set.season, set.label]);
    assert.equal(doc.version, `${doc.id}-${contentHash(doc)}`);
    assert.equal(doc.label, NATIONAL_TEAMS_LABEL);
    assert.ok(isFootballSetId(doc.id) && setSportOf(doc.id) === 'football' && BUILT_IN_SETS.some(entry => entry.id === doc.id));
    assert.ok(setHasNations(doc.id) && !setHasClubs(doc.id), 'nations only');
    assert.deepEqual([doc.kind, doc.local], ['nt', false]);
    const { source } = doc;
    assert.deepEqual([source.provider, source.method, source.computed, source.rawScale, source.licence],
      ['Computed', 'computed', true, 'Elo', 'CC BY-SA 4.0']);
    assert.equal(source.snapshotDate, `${doc.year}-07-01`, 'the Elo of 1 July of the season\'s end year');
    assert.match(source.conversion, /^T = 87 − 3\.2 × \(E_best − E\) \/ 100/);
    assert.equal(source.results.commit, MANIFEST.sources.results.commit);
    assert.deepEqual(Object.keys(source.wikipedia.ballonDor).map(Number), [doc.year - 1, doc.year]);
  }
  // The listing names every season of the four builders alike, whichever writes it.
  assert.ok(read('src/data/footballSeasons.js').includes('by npm run build:national-team-seasons, computed'));
  assert.ok(SEASON_NOTES.football.includes('the seasons between them are computed'), 'the setup note says so');
});

test('every season rebuilds byte for byte from its committed facts, with its credits and the shared listing', async () => {
  const docs = [];
  for (const season of MANIFEST.seasons) {
    const { doc, text } = buildNationalTeamSeason({ wikidata: WIKIDATA, elo: ELO[season.id], votes: VOTES }, MANIFEST, season);
    assert.equal(text, read(`public/football/${season.id}.json`).replace(/\r\n/g, '\n'), season.id);
    docs.push(doc);
  }
  const attribution = read('public/football/ATTRIBUTION-national-teams.txt').replace(/\r\n/g, '\n');
  assert.equal(attribution, nationalTeamsAttribution(MANIFEST, docs));
  for (const needed of ['CC0 1.0', 'https://creativecommons.org/licenses/by-sa/4.0/legalcode', 'qlever.dev', MANIFEST.sources.results.commit]) {
    assert.ok(attribution.includes(needed), needed);
  }
  const dir = path.join(root, 'public/football');
  const ea = json('scripts/data/ea-seasons.json'), retro = json('scripts/data/retro-seasons.json');
  const listed = [...await committedSeasons(dir, eaSeasonIds(ea)), ...await committedSeasons(dir, retroSeasonIds(retro)),
    ...await committedSeasons(dir, worldCupSeasonIds(WORLD_CUP)), ...await committedSeasons(dir, nationalTeamSeasonIds(MANIFEST))];
  assert.equal(footballSeasonsModule(listed, { ea, retro, worldCup: WORLD_CUP, nationalTeams: MANIFEST }),
    read('src/data/footballSeasons.js').replace(/\r\n/g, '\n'), 'src/data/footballSeasons.js is the listing every builder writes');
});

test('each season decodes: every listed nation fields its eleven, rated 1–99 strongest first, mean the nation\'s T', () => {
  for (const id of IDS) {
    const doc = committed(id);
    const sport = seasonSport(decodeFootballSet(doc));
    assert.deepEqual([...fieldedNations(sport)].sort(), Object.keys(doc.nations).sort(), `${id}: the listed nations, every one a real side`);
    assert.ok(Object.keys(doc.nations).length >= 36, `${id} fields ${Object.keys(doc.nations).length}`);
    const audit = json('docs/design/football-national-team-seasons-audit.json').seasons.find(season => season.id === id);
    for (const [nation, [, size, eleven]] of Object.entries(doc.nations)) {
      const T = audit.nations.find(entry => entry.id === nation).T;
      const mean = eleven.reduce((sum, player) => sum + player[2], 0) / 11;
      // T is the audit's, to two decimals: the XI sums to round(11 × T), so its mean is within 1/22 of the exact T.
      assert.ok(Math.abs(mean - T) <= 1 / 22 + 0.005 + 1e-9, `${id} ${nation}: mean ${mean} against T ${T}`);
      assert.ok(size >= 11 && eleven.some(([, position]) => position.startsWith('GK')), `${id} ${nation} names a keeper`);
      for (const [, , rating, source] of eleven) assert.ok(rating >= 1 && rating <= 99 && source.from <= doc.year && source.to >= doc.year - 1);
    }
  }
});

test('spot checks: the players of the day, the federations of the day, and who sits out', () => {
  const s72 = committed('nt-1972'), s88 = committed('nt-1988'), s92 = committed('nt-1992'), s79 = committed('nt-1979');
  assert.equal(names(s72, '528')[0], 'Johan Cruyff', 'the Ballon d\'Or of 1971 leads the Netherlands');
  assert.deepEqual(names(s72, '276').slice(0, 2), ['Franz Beckenbauer', 'Gerd Müller']);
  assert.ok(names(s72, '826').includes('Gordon Banks') && names(s72, '826').includes('Bobby Moore'));
  assert.deepEqual(names(s88, '528').slice(0, 2), ['Ruud Gullit', 'Marco van Basten']);
  assert.ok(names(s79, '032').includes('Diego Maradona') && names(s79, '032').includes('Daniel Passarella'));
  const maldini = s92.nations['380'][2].find(([name]) => name === 'Paolo Maldini');
  assert.ok(maldini && maldini[3].toEstimated === true, 'Maldini\'s open Italy stint, closed by its caps');
  // The federations of the day play under their own names, and only where they field a team.
  assert.deepEqual(s72.identities['643'], { name: 'Soviet Union', code: 'URS', flagId: 'URS' });
  assert.deepEqual(s72.identities['180'], { name: 'Zaire', code: 'ZAI', flagId: 'ZAI' });
  assert.deepEqual(s92.identities['643'], { name: 'CIS', code: 'CIS', flagId: 'CIS' }, '1991/92: the Soviet and CIS players together');
  assert.ok(['804', '268'].every(shape => s92.territory.merged[shape] === '643'));
  assert.ok(!committed('nt-1991').identities['276'], 'Germany, reunited, plays under its own name in 1990/91');
  // East Germany plays on its own land of the day up to 1988/89, as the map draws it to 1990 (teams.js HISTORIC_THROUGH).
  assert.deepEqual(names(committed('nt-1976'), '278').slice().sort(), ['Bernd Bransch', 'Gerd Kische', 'Gerd Weber', 'Hans-Jürgen Dörner',
    'Hans-Jürgen Riediger', 'Joachim Streich', 'Jürgen Croy', 'Jürgen Sparwasser', 'Konrad Weise', 'Martin Hoffmann', 'Reinhard Lauck'],
  'the Olympic champions of 1976');
  for (const id of IDS) {
    const doc = committed(id);
    assert.equal('278' in doc.nations, doc.year <= 1990, `${id}: East Germany only on the map of its years`);
    assert.equal('710' in doc.nations, doc.year === 1993, `${id}: South Africa only after its readmission (1992)`);
    assert.equal('156' in doc.nations, doc.year >= 1981, `${id}: China left FIFA from 1958 to 1980`);
    assert.equal('688' in doc.nations, doc.year <= 1991, `${id}: Yugoslavia until its suspension of May 1992`);
    if (doc.year <= 1991) assert.equal(doc.identities['688'].name, 'Yugoslavia');
  }
});

test('the theatres: the world, the continents with four sides of their own, and the Elite 32', () => {
  const offered = id => nationTheatres(seasonSport(decodeFootballSet(committed(id)))).map(scope => scope.id);
  assert.deepEqual(offered('nt-1963'), ['world', 'UEFA', 'CONMEBOL', 'elite']);
  assert.deepEqual(offered('nt-1993'), ['world', 'UEFA', 'CONMEBOL', 'CAF', 'AFC', 'CONCACAF', 'elite']);
  for (const id of IDS) assert.ok(offered(id).includes('elite'), `${id} fields 32 or more`);
});

test('a challenge link names a computed national-team season; it plays nations only', () => {
  const link = readChallenge('theatre=UEFA&season=nt-1972&seed=7');
  assert.deepEqual([link.setup.dataSet, link.setup.scope, link.ignored], ['nt-1972', 'UEFA', []]);
  const clubs = readChallenge('teams=clubs&season=nt-1984');
  assert.deepEqual([clubs.setup.dataSet, clubs.setup.layer, clubs.ignored], ['nt-1984', 'nations', ['teams']]);
  assert.deepEqual(readChallenge('season=nt-1970').ignored, ['season'], 'a World Cup year has the World Cup season');
});

test('the loader refuses a damaged national-team season', () => {
  const doc = committed('nt-1972');
  const refuses2 = (base, change, pattern) => {
    const copy = structuredClone(base);
    change(copy);
    assert.throws(() => decodeFootballSet(copy, copy.id), pattern);
  };
  const refuses = (change, pattern) => refuses2(doc, change, pattern);
  const first = copy => copy.nations['528'][2][0];
  refuses(copy => { copy.kind = 'wc'; }, /is not the kind its id names/);
  refuses(copy => { delete copy.source.method; }, /ratings are computed/);
  refuses(copy => { copy.source.rawScale = 99; }, /rawScale must be "Elo"/);
  refuses(copy => { copy.clubs = [{ id: 'f-ajax' }]; }, /nations only/);
  refuses(copy => { copy.nations['528'][2].pop(); }, /must name its eleven/);
  refuses(copy => { first(copy)[2] = 100; }, /rating must be a whole number 1-99/);
  refuses(copy => { first(copy)[1] = 'ST'; }, /must be GK, DF, MF or FW/);
  refuses(copy => { first(copy)[1] = 'MF/MF'; }, /must be GK, DF, MF or FW/);
  refuses(copy => { const xi = copy.nations['528'][2]; xi[1][2] = xi[0][2] + 1; }, /strongest first/);
  refuses(copy => { first(copy)[3].source = 'world-cup'; }, /source must name the player/);
  refuses(copy => { first(copy)[3].id = 'wc:P-00001'; }, /source must name the player/);
  refuses(copy => { first(copy)[3].to = 1969; }, /a stint covering the season/);
  refuses(copy => { delete first(copy)[3].team; }, /source must name the player/);
  refuses(copy => { first(copy)[3].caps = -1; }, /caps and goals must be counts/);
  refuses(copy => { first(copy)[3].url = 'https://example.com/cruyff'; }, /Wikipedia article or Wikidata item/);
  refuses(copy => { first(copy)[3].ballonDor = { 1969: 4 }; }, /the season's two years/);
  refuses(copy => { copy.nations['032'] = copy.nations['528']; }, /repeats player/);
  refuses(copy => { copy.territory.inactive.push('528'); }, /fields a team of its own|names no nation/);
  const later = committed('nt-1991');
  refuses2(later, copy => { copy.nations['278'] = structuredClone(committed('nt-1989').nations['278']); }, /on the map only up to 1990/);
  assert.ok(decodeFootballSet(structuredClone(doc)), 'the file itself loads');
});

// ---------- in the game ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  PlayerRow: 'src/components/PlayerRow.jsx',
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
  clearFootballSetIndex: ['src/engine/footballSets.js', 'clearFootballSetIndex'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

test('a 1971/72 campaign plays the Netherlands\' computed eleven, saves its players whole, and resumes without the file', async () => {
  const doc = committed('nt-1972');
  const calls = [], gone = new Set();
  const fetch = async url => {
    const at = String(url);
    calls.push(at);
    if (gone.has(at)) throw new Error('the file is gone');
    if (/^\/football\/nt-\d{4}\.json$/.test(at)) return { ok: true, status: 200, json: async () => JSON.parse(read(`public${at}`)) };
    return { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  const ids = ['528', '276', '643', '804', '688', '191', '826', '380'];
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids,
    settings: { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', role: 'manager', managedTeamId: '528', seed: '9' } });
  f.app.opening = B.App.prototype.opening;
  try {
    const { app, items, time } = f;
    await app.requestSeasons();
    assert.ok(app.state.footballSets.some(set => set.id === 'nt-1972' && set.label === NATIONAL_TEAMS_LABEL));
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', 'nt-1972');
    assert.equal(app.state.setup.layer, 'nations', 'a season with nations only takes the nations');
    time.advance(200);
    await app.loadSet('nt-1972');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    app.pickSetup('managedTeamId', '528');
    const wall = app.setupTeams();
    assert.deepEqual(wall.map(team => team.id).sort(), Object.keys(doc.nations).filter(id => NATIONS[id][2] === 'UEFA').sort(),
      'Europe\'s sides of the season, no one else');
    const model = buildSetupModel(app.state.setup, { managerTeams: wall, season: app.seasonStatus() });
    assert.equal(model.campaignSummary, 'Football · Nations · Europe · 1971/72');
    assert.equal(model.season.options.find(option => option.id === 'nt-1972').name, '1971/72 · computed');

    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason], ['nt-1972', doc.version, 1972, '1971/72']);
    assert.deepEqual(st.teams['528'].squad.map(player => player.name), names(doc, '528'), 'the computed eleven');
    assert.ok(st.teams['528'].squad.every(player => player.sourceInfo.source === 'wikidata'));
    assert.deepEqual([st.teams['643'].name, st.teams['643'].flagId], ['Soviet Union', 'URS']);
    assert.equal(st.own['804'], '643', 'the Soviet Union holds Ukraine');
    // The squad screen's Source column says computed and links to the player's article; its tooltip names the Elo.
    const player = st.teams['528'].squad[0];
    assert.equal(sourceLabel(player), '1971/72 national team, computed');
    assert.equal(sourceUrl(player), 'https://en.wikipedia.org/wiki/Johan_Cruyff');
    const title = `1971/72 national team, computed · Team Elo ${doc.nations['528'][2][0][3].teamElo} on 1972-07-01`;
    assert.equal(sourceTitle(player), title);
    assert.ok(renderToStaticMarkup(React.createElement(B.PlayerRow, { player })).includes(`title="${title}"`));

    // The checkpoint keeps the players whole and resumes with no file.
    const text = items.get(SAVE_KEY);
    assert.equal(JSON.parse(text).playerPack, undefined);
    B.clearFootballSetCache();
    gone.add('/football/nt-1972.json');
    const before = calls.length;
    const saved = parseCampaign(text);
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams), 'squads rebuild exactly');
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams));
    assert.equal(calls.length, before, 'resuming fetched nothing');
  } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
});
