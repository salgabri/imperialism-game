// The computed fills (docs/design/football-years.md, "Computed fills"; scripts/lib/football-fills.mjs): the rating rule
// and the XI on invented players, the Wikidata reader's first-year rule, the manifest's shared constants and dates, every
// computed player of the committed EA seasons checked against the committed facts, FIFA 05 to FIFA 09 left with no short
// XI, the loader's refusals, the estimate's words, a 2008/09 campaign that shows, saves and resumes them, and the facts
// rebuilt byte for byte where data-src/ has the answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SAVE_KEY } from '../src/config.js';
import { NATIONS, selectLineup } from '../src/data/teams.js';
import { parseCampaign } from '../src/engine/storage.js';
import { sourceLabel, sourceTitle, sourceUrl } from '../src/viewModels/squad.js';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';
import { estimateReason, estimateTitle, isEstimated } from '../src/data/estimates.js';
import { decodeFootballSet, fieldedNations } from '../src/engine/footballSets.js';
import { SEASON_NOTES } from '../src/screens/setup/setupModel.js';
import { expandEaTuple } from '../src/data/eaPlayers.js';
import { wikidataTables } from './lib/national-team-facts.mjs';
import { coverOf } from './lib/national-team-seasons.mjs';
import {
  FILL_LEAGUE, FILL_SOURCE, FILL_YEARS, addedSum, fillEleven, fillTarget, lineLevel, personIndex, playerRange, profileOf,
  samePersonIn, spreadRatings, teamNations, withoutMalformedDays,
} from './lib/football-fills.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const json = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const MANIFEST = json('scripts/data/football-fills.json');
const NATIONAL = json('scripts/data/national-team-seasons.json');
const WIKIDATA = json('scripts/data/football-fills/wikidata.json');
const ELO = json('scripts/data/football-fills/elo.json').seasons;
const AUDIT = json('docs/design/football-seasons-audit.json');
const EA = json('scripts/data/ea-seasons.json');
const EA_IDS = [...EA.snapshots, ...EA.site.editions, ...EA.editions, ...EA.legacy.editions, ...EA.early.editions].map(edition => edition.id);
const season = id => json(`public/football/${id}.json`);
const isComputed = tuple => tuple.length === 4;
const D = MANIFEST.profile;
const sum = xs => xs.reduce((total, x) => total + x, 0);

test('the profile read at m places: eleven take D, one takes nothing, and every set sums to zero, strongest first', () => {
  const mean = sum(D) / D.length;
  assert.deepEqual(profileOf(11, D).map(d => Math.round(d * 1e9) / 1e9), D.map(d => Math.round((d - mean) * 1e9) / 1e9));
  assert.deepEqual(profileOf(1, D), [0]);
  for (let m = 1; m <= 11; m++) {
    const d = profileOf(m, D);
    assert.equal(d.length, m);
    assert.ok(Math.abs(sum(d)) < 1e-9, `${m} sum to zero`);
    assert.ok(d.every((x, i) => i === 0 || x <= d[i - 1]), `${m} strongest first`);
  }
  assert.throws(() => profileOf(0, D));
  assert.throws(() => profileOf(12, D));
});

test('added ratings bring the XI to T where an XI member at T can be, sum exactly and keep their order', () => {
  // Four EA players at 70 and seven places: the seven take what the XI needs to reach 75.
  assert.deepEqual(addedSum(7, 280, 11, 75, D), { sum: 825 - 280, held: 0 });
  // One place beside ten EA players far below T: held at T + max D, and far above: held at T + min D.
  assert.deepEqual(addedSum(1, 600, 11, 75, D), { sum: 80, held: 1 });
  assert.deepEqual(addedSum(1, 800, 11, 75, D), { sum: 72, held: -1 });
  assert.deepEqual(playerRange(75, D), [72, 80]);
  assert.deepEqual(playerRange(2, D), [1, 7]);
  const ratings = spreadRatings(545, profileOf(7, D), [1, 99]);
  assert.equal(sum(ratings), 545);
  assert.ok(ratings.every((r, i) => Number.isInteger(r) && (i === 0 || r <= ratings[i - 1])));
  const held = spreadRatings(545, profileOf(7, D), playerRange(75, D));
  assert.ok(held.every((r, i) => r >= 72 && r <= 80 && (i === 0 || r <= held[i - 1])), `${held} within 72–80, strongest first`);
  // Held: the ratings stay in range, though they no longer reach the sum.
  assert.deepEqual(spreadRatings(300, [5, 0, -5], [95, 99]), [99, 99, 95]);
});

test('the line\'s level is the median of the full XIs on it, and T falls 3.2 points for every 100 Elo below the best', () => {
  const points = [{ strength: 86, elo: 2000 }, { strength: 80, elo: 1800 }, { strength: 70, elo: 1500 }];
  // On the line: 86, 80 + 6.4 = 86.4, 70 + 16 = 86.
  assert.equal(lineLevel(points, 2000, 3.2), 86);
  assert.equal(fillTarget(1500, 2000, 86, 3.2), 70);
  assert.equal(fillTarget(2000, 2000, 86, 3.2), 86);
  assert.throws(() => lineLevel([], 2000, 3.2));
});

test('Wikidata\'s stints: one with neither end nor caps covers its first year only for the fills, a typed year is no day', () => {
  const uri = q => `http://www.wikidata.org/entity/${q}`;
  const rank = 'http://wikiba.se/ontology#NormalRank';
  const day = y => `${y}-01-01T00:00:00Z`;
  const answers = {
    teams: [{ team: uri('Q1'), teamLabel: "Ruritania men's national association football team" }],
    stints: [
      { player: uri('Q10'), team: uri('Q1'), st: 's1', rank, start: day(2008), end: null, caps: null, goals: null },
      { player: uri('Q11'), team: uri('Q1'), st: 's2', rank, start: day(2005), end: day(2009), caps: '20', goals: null },
      { player: uri('Q12'), team: uri('Q1'), st: 's3', rank, start: '112020-01-01T00:00:00', end: null, caps: '3', goals: null },
    ],
    players: [10, 11, 12].map(n => ({ player: uri(`Q${n}`), label: `Player ${n}`, mulLabel: null, birth: null, enwiki: null })),
    positions: [],
  };
  const options = { positions: {}, names: { teamSuffix: NATIONAL.names.teamSuffix, ignoreTeams: [], countries: {} }, years: [2004, 2027], openCapsPerYear: 8 };
  const { rows, malformed } = withoutMalformedDays(answers.stints);
  assert.deepEqual(malformed, [['s3', 'start', '112020-01-01T00:00:00']]);
  const national = wikidataTables({ ...answers, stints: rows }, options);
  assert.deepEqual(national.stints.map(s => s[0]), ['Q11'], 'the national-team seasons leave the open stint out');
  const fills = wikidataTables({ ...answers, stints: rows }, { ...options, openFirstYear: true });
  assert.deepEqual(fills.stints, [['Q10', 'Q1', 2008, 2008, null, null, 2], ['Q11', 'Q1', 2005, 2009, 20, null, 0]]);
  assert.equal(fills.audit.firstYearOnly, 1);
  assert.equal(fills.audit.noStart, 1, 'the typed year leaves its stint without a start');
});

test('one person: born the same day with a word in common, or an agreeing name of the same nation or birth year', () => {
  const ea = (name, fullName, dateOfBirth, nationId) => ({ name, nationId, sourceInfo: { fullName, ...(dateOfBirth ? { dateOfBirth } : {}) } });
  const index = personIndex([ea('M. Aboutrika', 'Mohamed Aboutrika', '1978-11-07', '818'), ea('Lee Chung Yong', 'Lee Chung Yong', '1988-07-02', '410'),
    ea('D. Berbatov', 'Dimitar Berbatov', '1981-01-31', '100'), ea('J. Pérez', 'José Pérez', '1990-05-05', '724')]);
  assert.equal(samePersonIn(index, { name: 'Mohamed Aboutrika', born: '1978-11-07' }, '818')?.name, 'M. Aboutrika');
  assert.equal(samePersonIn(index, { name: 'Lee Chung-yong', born: '1988-07-02' }, '410')?.name, 'Lee Chung Yong');
  // EA's birth date off, but the same nation's agreeing name.
  assert.equal(samePersonIn(index, { name: 'Dimitar Berbatov', born: '1981-01-30' }, '100')?.name, 'D. Berbatov');
  // A common name in another nation, born in another year: someone else.
  assert.equal(samePersonIn(index, { name: 'José Pérez', born: '1984-02-02' }, '170'), null);
  // The same name in another nation and the same birth year: the same person.
  assert.equal(samePersonIn(index, { name: 'José Pérez', born: '1990-01-01' }, '170')?.name, 'J. Pérez');
});

test('the XI: EA\'s natural part stays, each short role takes its candidates by caps, EA\'s top-ups only where none is left', () => {
  const ea = (id, pos, rating) => ({ name: `E${id}`, pos, positions: [pos], rating, sourceInfo: { id: `ea:${id}`, source: 'ea-fc' } });
  const wd = (qid, positions, figure, total = 0) => ({ qid, name: `W${qid}`, positions, figure, total, born: null, caps: 1 });
  // Eleven EA players without a goalkeeper or a fourth defender: three of them are top-ups out of position.
  const pool = [ea(1, 'DF', 70), ea(2, 'DF', 70), ea(3, 'DF', 70), ...[4, 5, 6, 7, 8].map(n => ea(n, 'MF', 70 - n)), ea(9, 'FW', 72), ea(10, 'FW', 71), ea(11, 'FW', 60)];
  const squad = pool.slice(); // as pickFootballSquad keeps them: all eleven
  const rate = (m, eaSum, size) => {
    assert.equal(size, 11);
    return Array(m).fill(Math.round((size * 70 - eaSum) / m));
  };
  const filled = fillEleven({ pool, squad, candidates: [wd('Q3', ['DF'], 2), wd('Q1', ['GK'], 5), wd('Q2', ['GK'], 1), wd('Q4', ['MF'], 9)], rate });
  assert.deepEqual(filled.added.map(p => [p.qid, p.role]), [['Q1', 'GK'], ['Q3', 'DF']], 'the capped keeper first, then a defender; no midfielder');
  assert.deepEqual(filled.ea.map(p => p.name).sort(), ['E1', 'E10', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E9']);
  assert.deepEqual(filled.droppedEa.map(p => p.name).sort(), ['E11', 'E8']);
  // No keeper among the candidates: EA's best top-up stays in goal's place, and nobody else is dropped for him.
  const noKeeper = fillEleven({ pool, squad, candidates: [wd('Q3', ['DF'], 2)], rate });
  assert.deepEqual(noKeeper.added.map(p => p.role), ['DF']);
  assert.equal(noKeeper.ea.length, 10);
  // Nothing to add: no fill.
  assert.equal(fillEleven({ pool, squad, candidates: [wd('Q4', ['MF'], 9)], rate }), null);
  // A thin pool with no natural candidate left: a candidate out of position takes the place.
  const thin = [ea(1, 'GK', 60), ...[2, 3, 4, 5].map(n => ea(n, 'DF', 60)), ...[6, 7, 8, 9].map(n => ea(n, 'MF', 60))];
  const out = fillEleven({ pool: thin, squad: thin, candidates: [wd('Q9', ['MF'], 3), wd('Q8', ['FW'], 1)], rate });
  assert.deepEqual(out.added.map(p => [p.qid, p.role]), [['Q9', 'FW'], ['Q8', 'FW']]);
});

test('teams play for the nation of their year: Serbia and Montenegro for Serbia, a merged or not yet admitted shape for none', () => {
  const teams = [['Q1', 'Serbia and Montenegro'], ['Q2', 'Montenegro'], ['Q3', 'Kosovo'], ['Q4', 'Ghana'], ['Q5', 'Malta']];
  assert.deepEqual([...teamNations(teams, 2005, MANIFEST.names)], [['Q1', '688'], ['Q4', '288']]);
  assert.deepEqual([...teamNations(teams, 2020, MANIFEST.names)], [['Q1', '688'], ['Q2', '499'], ['Q3', 'KOS'], ['Q4', '288']]);
});

test('the manifest shares the computed seasons\' constants and names every EA season at its ratings date', () => {
  assert.deepEqual(MANIFEST.elo, NATIONAL.elo);
  assert.equal(MANIFEST.strength.perHundredElo, NATIONAL.strength.perHundredElo);
  assert.deepEqual([MANIFEST.xi, MANIFEST.profile, MANIFEST.selection.openCapsPerYear], [NATIONAL.xi, NATIONAL.profile, NATIONAL.selection.openCapsPerYear]);
  for (const [item, role] of Object.entries(NATIONAL.positions)) assert.equal(MANIFEST.positions[item], role, item);
  for (const [name, nation] of Object.entries(NATIONAL.names.nations.aliases)) assert.equal(MANIFEST.names.nations.aliases[name], nation, name);
  assert.deepEqual(MANIFEST.names.nations.noTeam, NATIONAL.names.nations.noTeam);
  assert.deepEqual(MANIFEST.sources.results, NATIONAL.sources.results, 'the same pinned results');
  for (const file of MANIFEST.sources.wikidata.files) assert.match(file.sha256, /^[0-9a-f]{64}$/, `${file.name} is pinned`);
  for (const id of EA_IDS) {
    const doc = season(id), entry = MANIFEST.seasons.find(s => s.id === id);
    assert.ok(entry, `${id} is a season of the fills`);
    assert.deepEqual([entry.year, entry.date], [doc.year, doc.source.ratingsDate ?? doc.source.snapshotDate], id);
    assert.equal(ELO[id].date, entry.date, `${id}'s Elo is of its ratings date`);
  }
  assert.deepEqual(FILL_YEARS, [Math.min(...MANIFEST.seasons.map(s => s.year)) - 1, Math.max(...MANIFEST.seasons.map(s => s.year))]);
});

test('every computed player of the EA seasons is capped for his nation that season, marked, no one twice and no EA player again', () => {
  const person = new Map(WIKIDATA.players.map(row => [row[0], row]));
  const stintsOf = new Map();
  for (const stint of WIKIDATA.stints) (stintsOf.get(stint[0]) || stintsOf.set(stint[0], []).get(stint[0])).push(stint);
  let computed = 0;
  for (const id of EA_IDS) {
    const doc = season(id);
    const audit = AUDIT.seasons.find(s => s.id === id).fill;
    const teamNation = teamNations(WIKIDATA.teams, doc.year, MANIFEST.names);
    const eaPlayers = Object.entries(doc.nations).flatMap(([nation, [, , list]]) => list.filter(t => !isComputed(t)).map(t => {
      const [name, , , sourceInfo] = expandEaTuple(t, doc.source);
      return { name, nationId: nation, sourceInfo };
    }));
    const index = personIndex(eaPlayers);
    const seen = new Set();
    const listed = Object.entries(doc.nations).flatMap(([nation, [, , list]]) => list.filter(isComputed).map(player => [nation, player]));
    assert.equal(!!doc.fill, listed.length > 0, `${id} names the fill exactly when it lists computed players`);
    if (doc.fill) {
      assert.equal(doc.fill.snapshotDate, ELO[id].date);
      assert.equal(doc.coverage.computed, listed.length);
    }
    for (const [nation, [name, position, rating, info]] of listed) {
      computed++;
      const qid = info.id.slice(3);
      assert.equal(isEstimated({ sourceInfo: info }), true);
      assert.deepEqual([info.source, info.league, info.snapshotDate], [FILL_SOURCE, FILL_LEAGUE, ELO[id].date], `${id} ${name}`);
      assert.ok(!seen.has(qid), `${id}: ${name} is listed once`);
      seen.add(qid);
      const [, label, born, , positions] = person.get(qid);
      assert.ok(name === label || name.startsWith(`${label} (`), `${id}: ${name} is Wikidata's ${label}`);
      assert.ok(position.split('/').every(role => positions.includes(role)) || position === positions.join('/'), `${id} ${name} plays ${position}`);
      const stint = stintsOf.get(qid).find(([, team, from, to]) => teamNation.get(team) === nation && from === info.from && to === info.to);
      assert.ok(stint && coverOf(stint[2], stint[3], doc.year) > 0, `${id}: ${name}'s stint covers the season`);
      assert.notEqual(stint[4], 0, `${id}: ${name} was capped`);
      assert.equal(samePersonIn(index, { name: label, born }, nation), null, `${id}: ${name} is no EA player of the season`);
      const row = audit.nations.find(entry => entry.id === nation);
      assert.ok(row.ea * 2 >= 11, `${id}: ${NATIONS[nation][0]} fielded a side of EA's own`);
      const [lo, hi] = playerRange(row.T, MANIFEST.profile);
      assert.ok(rating >= lo && rating <= hi, `${id}: ${name} at ${rating} lies within ${lo}–${hi} of T ${row.T}`);
    }
  }
  assert.ok(computed > 1000, `${computed} computed players`);
});

test('FIFA 05 to FIFA 09 field no short XI: every nation that plays has eleven, and every XI the fill touched stays fielded', () => {
  for (const id of ['ea-fifa-05', 'ea-fifa-06', 'ea-fifa-07', 'ea-fifa-08', 'ea-fifa-09']) {
    const set = decodeFootballSet(season(id), id);
    const sport = { id: 'football', rosters: set.rosters, territory: set.territory, dataYear: season(id).year };
    const fielded = fieldedNations(sport);
    const short = fielded.filter(nation => set.rosters[nation][2].length < 11);
    assert.deepEqual(short, [], `${id}: ${short.map(nation => NATIONS[nation][0]).join(', ')}`);
    for (const row of AUDIT.seasons.find(s => s.id === id).fill.nations.filter(entry => entry.added)) {
      assert.ok(fielded.includes(row.id), `${id}: ${row.name} still fields`);
      assert.ok(row.after >= row.before, `${id}: ${row.name} plays no weaker`);
    }
  }
});

test('the loader takes computed players only in an EA season\'s nations, named by its fill', () => {
  const doc = season('ea-fifa-09');
  const [nation, [, , list]] = Object.entries(doc.nations).find(([, [, , players]]) => players.some(isComputed));
  const decoded = decodeFootballSet(doc, doc.id);
  const players = decoded.rosters[nation][2];
  assert.equal(players.length, list.length);
  const computed = players.filter(player => isEstimated({ sourceInfo: player[3] }));
  assert.ok(computed.length);
  assert.ok(computed.every(([name, pos, rating, info]) => typeof name === 'string' && /^(GK|DF|MF|FW)/.test(pos) && Number.isInteger(rating) && info.league === FILL_LEAGUE));
  const lineup = selectLineup({ sport: 'football', squad: players.map(([name, listed, rating, info]) => ({ name, pos: listed.split('/')[0], positions: info.positions ?? listed.split('/'), rating })) });
  assert.equal(Math.round(lineup.rating), doc.nations[nation][0], 'the strength is the lineup\'s');
  const copy = () => JSON.parse(JSON.stringify(doc));
  const broken = [
    [d => { delete d.fill; }, /is not an EA player tuple/],
    [d => { d.nations[nation][2].find(isComputed)[3].league = 'NHL'; }, /computed player on Wikidata/],
    [d => { d.nations[nation][2].find(isComputed)[3].source = 'wikidata'; }, /computed player on Wikidata/],
    [d => { d.nations[nation][2].find(isComputed)[2] = 120; }, /is not a computed player/],
    [d => { d.nations[nation][2].find(isComputed)[1] = 'ST'; }, /is not a computed player/],
    [d => { d.fill.method = 'converted'; }, /fill must say/],
    [d => { d.clubs[0].squad.push(d.nations[nation][2].find(isComputed)); }, /is not an EA player tuple/],
  ];
  for (const [change, error] of broken) {
    const d = copy();
    change(d);
    assert.throws(() => decodeFootballSet(d, d.id), error);
  }
});

test('a computed player says why his rating is an estimate, and the setup\'s note says how EA\'s seasons fill their XIs', () => {
  const player = { sourceInfo: { source: FILL_SOURCE, league: FILL_LEAGUE } };
  assert.equal(estimateTitle(player), 'Estimated rating: EA rated too few of this nation\'s players for an XI, so this one comes from his caps for it that season and its World Football Elo');
  assert.equal(estimateReason(player), 'EA rated too few of this nation\'s players for an XI');
  assert.match(SEASON_NOTES.football, /places EA leaves empty go to players capped for it that season on Wikidata/);
});

const B = await bundleComponents({
  App: 'src/App.jsx',
  PlayerRow: 'src/components/PlayerRow.jsx',
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
  clearFootballSetIndex: ['src/engine/footballSets.js', 'clearFootballSetIndex'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

test('a 2008/09 campaign plays Egypt\'s filled eleven, marks the computed players, saves them whole and resumes without the file', async () => {
  const doc = season('ea-fifa-09');
  const calls = [], gone = new Set();
  const fetch = async url => {
    const at = String(url);
    calls.push(at);
    if (gone.has(at)) throw new Error('the file is gone');
    if (at === '/football/ea-fifa-09.json') return { ok: true, status: 200, json: async () => season('ea-fifa-09') };
    return { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['818', '288', '012', '566', '504', '384'],
    settings: { sport: 'football', layer: 'nations', scope: 'CAF', clubScope: 'all', role: 'manager', managedTeamId: '818', seed: '9' } });
  f.app.opening = B.App.prototype.opening;
  try {
    const { app, items, time } = f;
    await app.requestSeasons();
    app.pickSetup('dataSet', 'ea-fifa-09');
    time.advance(200);
    await app.loadSet('ea-fifa-09');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    app.pickSetup('managedTeamId', '818');
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    const squad = st.teams['818'].squad;
    assert.deepEqual(squad.map(player => player.name), doc.nations['818'][2].map(t => (isComputed(t) ? t[0] : t[1])), 'EA\'s six and the five capped players');
    const computed = squad.filter(isEstimated);
    assert.deepEqual(computed.map(player => player.name), ['Ahmed Hassan', 'Hosny Abd Rabo', 'Wael Gomaa', 'Mohamed Aboutrika', 'Hany Saïd']);
    assert.ok(squad.filter(player => !isEstimated(player)).every(player => player.sourceInfo.source === 'ea-fc'));
    // The squad screen's Source column says computed and links to his article; the tooltip says why it is an estimate.
    const player = computed[0];
    assert.equal(sourceLabel(player), '2008/09 national team, computed');
    assert.equal(sourceUrl(player), 'https://en.wikipedia.org/wiki/Ahmed_Hassan_(footballer%2C_born_1975)');
    assert.equal(sourceTitle(player), estimateTitle(player));
    const row = renderToStaticMarkup(React.createElement(B.PlayerRow, { player }));
    assert.ok(row.includes('<sup>*</sup>') && row.includes(`title="${estimateTitle(player).replace(/'/g, '&#x27;')}"`), 'marked as an estimate');

    // The checkpoint packs EA's players, keeps the computed ones whole, and resumes with no file.
    const text = items.get(SAVE_KEY);
    assert.equal(JSON.parse(text).playerPack?.kind, 'ea');
    assert.ok(text.includes('"source":"estimate"'), 'the computed players are stored whole');
    B.clearFootballSetCache();
    gone.add('/football/ea-fifa-09.json');
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

test('the facts rebuild byte for byte from the pinned answers (when they are in data-src/)', t => {
  const folder = path.join(root, 'data-src', MANIFEST.sources.wikidata.folder);
  const results = path.join(root, 'data-src', MANIFEST.sources.results.folder, MANIFEST.sources.results.files[0].name);
  if (!existsSync(folder) || !existsSync(results)) { t.skip('data-src/ lacks QLever\'s answers or martj42\'s results'); return; }
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/sync-football-fills.mjs'), '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});
