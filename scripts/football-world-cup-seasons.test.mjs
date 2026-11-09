// The computed World Cup seasons, 1961/62 to 1993/94 (docs/design/football-years.md, "Computed World Cup seasons"): the
// Elo engine on hand-made results, the calibration of its constants, the cross-check against eloratings.net, the committed
// facts and seasons rebuilt byte for byte, history's spot checks, the federations of the day each season plays, the
// theatres it offers, the loader's refusals, and a 1969/70 campaign launched as the Soviet Union, saved and resumed
// without the season's file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAVE_KEY } from '../src/config.js';
import { NATIONS, nationIdentity, selectLineup } from '../src/data/teams.js';
import { BUILT_IN_SEASONS } from '../src/data/footballSeasons.js';
import { FOOTBALL_FEDERATIONS } from '../src/data/footballFederations.js';
import { contentHash, identitiesFor, territoryFor } from '../src/data/footballSetBuild.js';
import { nationTheatres } from '../src/data/scopes.js';
import {
  BUILT_IN_SETS, decodeFootballSet, fieldedNations, heldShapes, isFootballSetId, seasonSport, setHasClubs, setHasNations, setKindOf, setSportOf,
} from '../src/engine/footballSets.js';
import { footballRate, footballWinProbability } from '../src/engine/winProbability.js';
import { parseCampaign } from '../src/engine/storage.js';
import { readChallenge } from '../src/screens/setup/challenge.js';
import { SEASON_NOTES, buildSetupModel } from '../src/screens/setup/setupModel.js';
import { sourceLabel, sourceUrl } from '../src/viewModels/squad.js';
import { dayAfter, eloOn, expectedScore, goalFactor, kFactor, resultRows, yearsBefore } from './lib/football-elo.mjs';
import { ballonDorVotes, factsText, worldCupLineups } from './lib/world-cup-facts.mjs';
import {
  attributionText, buildWorldCupSeason, elevenRatings, orderEleven, pickEleven, strengthOf,
} from './lib/world-cup-seasons.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = file => readFileSync(path.join(root, file), 'utf8');
const MANIFEST = JSON.parse(read('scripts/data/world-cup-seasons.json'));
const IDS = ['wc-1962', 'wc-1966', 'wc-1970', 'wc-1974', 'wc-1978', 'wc-1982', 'wc-1986', 'wc-1990', 'wc-1994'];
const facts = id => JSON.parse(read(`scripts/data/world-cup-seasons/${id}.json`));
const committed = id => JSON.parse(read(`public/football/${id}.json`));
const eleven = (doc, id) => doc.nations[id][2];
const names = (doc, id) => eleven(doc, id).map(([name]) => name);
const mean = xs => xs.reduce((sum, x) => sum + x, 0) / xs.length;

// ---------- the Elo engine ----------

const ELO = MANIFEST.elo;
const match = (date, home, away, homeScore, awayScore, tournament = 'Friendly', neutral = 'FALSE') => ({ date, home_team: home, away_team: away,
  home_score: String(homeScore), away_score: String(awayScore), tournament, neutral });

test('Elo: K by tournament, G by margin, the home edge, and where a team starts', () => {
  assert.deepEqual(['FIFA World Cup', 'UEFA Euro', 'Copa América', 'FIFA World Cup qualification', 'African Cup of Nations qualification',
    'UEFA Nations League', 'Friendly', 'British Home Championship', 'Merdeka Tournament'].map(t => kFactor(t, ELO.k)), [60, 50, 50, 40, 40, 40, 20, 30, 30]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 7].map(goalFactor), [1, 1, 1.5, 1.75, 1.875, 2, 2.25]);
  assert.equal(expectedScore(0), 0.5);
  assert.ok(Math.abs(expectedScore(400) - 10 / 11) < 1e-12);
  const rows = resultRows([
    match('1925-03-01', 'Old', 'Older', 1, 1, 'Friendly', 'TRUE'),
    match('1950-06-01', 'New', 'Old', 3, 0, 'FIFA World Cup', 'TRUE'),
    match('1950-06-05', 'Old', 'Older', 2, 0),
    match('1950-06-06', 'Older', 'New', 0, 0, 'Copa América'),
  ]);
  const snaps = eloOn(rows, ['1950-06-02', '1950-06-06', '1960-01-01'], ELO);
  // 'New' first played in 1950, after 1930: it starts at 1300; the others at 1500. A neutral World Cup match, won by three.
  const after = snaps['1950-06-02'].ratings;
  const change = 60 * 1.75 * (1 - expectedScore(1300 - 1500));
  assert.ok(Math.abs(after.get('New') - (1300 + change)) < 1e-9 && Math.abs(after.get('Old') - (1500 - change)) < 1e-9);
  // A snapshot holds the matches before its day: 6 June's draw is not in the 6 June one.
  assert.equal(snaps['1950-06-06'].games.get('New'), 1);
  assert.equal(snaps['1960-01-01'].games.get('New'), 2);
  // At home a side has 100 points more in dr.
  const home = snaps['1950-06-06'].ratings, old = after.get('Old'), older = after.get('Older');
  const homeWin = 20 * 1.5 * (1 - expectedScore(old + 100 - older));
  assert.ok(Math.abs(home.get('Old') - (old + homeWin)) < 1e-9);
  assert.throws(() => resultRows([match('1950-06-02', 'A', 'B', 1, 0), match('1950-06-01', 'A', 'B', 1, 0)]), /is not a day after/);
  assert.throws(() => resultRows([match('1950-06-02', 'A', 'B', 'NA', 0)]), /score/);
  assert.equal(dayAfter('1970-06-21'), '1970-06-22');
  assert.equal(yearsBefore('1970-06-22', 4), '1966-06-22');
  assert.equal(yearsBefore('1996-02-29', 4), '1992-02-29');
  assert.equal(yearsBefore('1996-02-29', 1), '1995-02-28');
});

test('the constants: 3.2 points per 100 Elo give the match model Elo\'s expected score; the XI\'s profile and its rounding', () => {
  assert.deepEqual(MANIFEST.strength, { ...MANIFEST.strength, best: 87, perHundredElo: 3.2 });
  for (const gap of [50, 100, 150, 200, 250, 300]) {
    const delta = MANIFEST.strength.perHundredElo * gap / 100;
    const game = footballWinProbability({ rA: footballRate(0.075 * delta), rD: footballRate(-0.075 * delta), remaining: 1 });
    assert.ok(Math.abs(game - expectedScore(gap)) < 0.01, `${gap} Elo: ${game} against ${expectedScore(gap)}`);
  }
  const { profile } = MANIFEST;
  assert.deepEqual(profile, [5.3, 3.3, 2.1, 1.0, 0.0, -0.4, -1.0, -1.7, -2.1, -2.7, -3.9]);
  assert.ok(profile.every((d, k) => !k || d < profile[k - 1]), 'strictly falling');
  assert.ok(Math.abs(profile.reduce((sum, d) => sum + d, 0)) <= 0.1 + 1e-9, 'sums to 0 but for its rounding');
  assert.deepEqual(MANIFEST.xi, { GK: 1, DF: 4, MF: 4, FW: 2 });
  // The XI's mean is T within 1/22 and rounds as T does; the order never inverts.
  for (let t = 60; t <= 87; t += 0.013) {
    const ratings = elevenRatings(t, profile);
    assert.ok(ratings.every((r, k) => !k || r <= ratings[k - 1]), String(t));
    assert.ok(Math.abs(mean(ratings) - t) <= 1 / 22 + 1e-9, `${t}: mean ${mean(ratings)}`);
    assert.equal(Math.round(mean(ratings)), Math.round(t), String(t));
  }
  // 87 + D sums to 956.9 and is rounded to 957: the three largest fractions go up (84.9, 86.6, then the first 0.3).
  assert.deepEqual(elevenRatings(87, profile), [93, 90, 89, 88, 87, 87, 86, 85, 85, 84, 83]);
  assert.ok(Math.abs(strengthOf(1888.2, 1995.3, MANIFEST.strength) - (87 - 3.2 * 107.1 / 100)) < 1e-9);
});

test('the XI: the most-used of each role, a role short of players filled by the most-used left; its order by the records', () => {
  const player = (id, position, minutes, over = {}) => ({ id, name: id, shirt: Number(id.slice(2)), position, minutes, starts: Math.round(minutes / 90),
    goals: 0, awards: [], ballonDor: {}, ...over });
  // A squad with two midfielders, as the WM sides of 1962 list them.
  const squad = [player('P-01', 'GK', 360), player('P-02', 'GK', 0), ...[3, 4, 5, 6, 7].map(n => player(`P-0${n}`, 'DF', 400 - n * 10)),
    player('P-08', 'MF', 360), player('P-09', 'MF', 300), ...[10, 11, 12, 13].map(n => player(`P-${n}`, 'FW', 400 - n * 10))];
  const { eleven: xi, filled } = pickEleven(squad, MANIFEST.xi);
  assert.deepEqual(xi.map(p => p.id), ['P-01', 'P-03', 'P-04', 'P-05', 'P-06', 'P-08', 'P-09', 'P-10', 'P-11', 'P-07', 'P-12']);
  assert.deepEqual(filled.map(p => p.id), ['P-07', 'P-12'], 'the most-used left, whatever their position');
  const order = orderEleven([player('P-21', 'FW', 540, { goals: 2 }), player('P-22', 'MF', 90, { goals: 1 }), player('P-23', 'DF', 540, { ballonDor: { 1970: 3 } }),
    player('P-24', 'FW', 540, { awards: ['Bronze Boot'], goals: 5 }), player('P-25', 'GK', 540), player('P-26', 'DF', 0)], MANIFEST.awards);
  assert.deepEqual(order.map(p => p.id), ['P-23', 'P-24', 'P-22', 'P-21', 'P-25', 'P-26'], 'Ballon d\'Or, awards, goals a minute, minutes');
});

// ---------- the sources ----------

test('every source is pinned, and the cross-check against eloratings.net holds', () => {
  const { worldCup, results, ballonDor, lineups, crossCheck } = MANIFEST.sources;
  assert.match(worldCup.commit, /^[0-9a-f]{40}$/);
  assert.match(results.commit, /^[0-9a-f]{40}$/);
  assert.equal(worldCup.licence, 'CC BY-SA 4.0');
  assert.equal(results.licence, 'CC0-1.0');
  for (const file of [...worldCup.files, ...results.files, ...crossCheck.files]) {
    assert.match(file.sha256, /^[0-9a-f]{64}$/, file.name);
    assert.ok(Number.isInteger(file.bytes) && file.bytes > 0, file.name);
  }
  for (const page of [...ballonDor.pages, ...lineups.pages]) {
    assert.ok(Number.isInteger(page.revision) && page.revision > 1e9, page.title);
    assert.match(page.sha256, /^[0-9a-f]{64}$/, page.title);
  }
  assert.deepEqual(ballonDor.pages.map(page => page.title), MANIFEST.seasons.flatMap(season => season.ballonDor.map(year => `${year} Ballon d'Or`)));
  assert.deepEqual(lineups.pages.map(page => page.title), MANIFEST.seasons.flatMap(season => season.lineupPages || []));
  assert.match(crossCheck.use, /^Cross-check only/);
  const check = JSON.parse(read('scripts/data/world-cup-seasons/elo-crosscheck.json'));
  assert.equal(check.years.length, 9);
  for (const year of check.years) {
    assert.ok(year.pearson >= 0.85 && year.spearmanTop48 >= 0.85, `${year.year}: ${year.pearson}, ${year.spearmanTop48}`);
    const leader = year.leaders.published[0];
    assert.equal(year.leaders.computed[0], crossCheck.aliases[leader] ?? leader, `${year.year}: the same leader`);
  }
  assert.ok(check.mean.spearmanTop48 >= 0.9, `top-48 Spearman ${check.mean.spearmanTop48}`);
  // The cross-check keeps figures, never eloratings.net's ratings.
  assert.ok(!/"elo"/.test(read('scripts/data/world-cup-seasons/elo-crosscheck.json')));
});

test('the facts rebuild byte for byte from the pinned sources (when they are in data-src/)', t => {
  const { worldCup, results, ballonDor, lineups, crossCheck } = MANIFEST.sources;
  const files = [...worldCup.files.map(f => [worldCup.folder, f.name]), ...results.files.map(f => [results.folder, f.name]),
    ...ballonDor.pages.map(p => [ballonDor.folder, p.file]), ...lineups.pages.map(p => [lineups.folder, p.file]), ...crossCheck.files.map(f => [crossCheck.folder, f.name])];
  const missing = files.filter(([folder, name]) => !existsSync(path.join(root, 'data-src', folder, name)));
  if (missing.length) {
    t.skip(`sources not in data-src/: ${missing.slice(0, 3).map(([folder, name]) => `${folder}/${name}`).join(', ')}${missing.length > 3 ? ', …' : ''}`);
    return;
  }
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/sync-world-cup-seasons.mjs'), '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /10 files rebuild byte for byte/);
});

test('the parsers read Wikipedia\'s voting tables and line-ups as the pages give them', () => {
  const vote = (rank, name, href, nation, points, attrs = '') => `<tr><td${attrs}>${rank}</td><td><a href="${href}" title="${name}">${name}</a></td>`
    + `<td>Club</td><td><a href="/wiki/${nation}">${nation}</a></td><td>${points}</td></tr>`;
  const table = `<table class="wikitable"><tr><th>Rank</th><th>Name</th><th>Club(s)</th><th>Nationality</th><th>Points</th></tr>
    ${vote(1, 'Gerd Müller', 'https://en.wikipedia.org/wiki/Gerd_Müller', 'West Germany', 77)}
    <tr><td rowspan="2">2</td><td><a href="/wiki/Bobby_Moore">Bobby Moore</a></td><td>West Ham</td><td>England</td><td>70</td></tr>
    <tr><td><a href="./Gigi_Riva">Gigi Riva</a></td><td>Cagliari</td><td>Italy</td><td>65</td></tr></table>`;
  assert.deepEqual(ballonDorVotes(table), [
    { rank: '1', name: 'Gerd Müller', title: 'Gerd Müller', nationality: 'West Germany', points: 77 },
    { rank: '2', name: 'Bobby Moore', title: 'Bobby Moore', nationality: 'England', points: 70 },
    { rank: '2', name: 'Gigi Riva', title: 'Gigi Riva', nationality: 'Italy', points: 65 }]);
  const row = (pos, n, name) => `<tr><td id="a">${pos}</td><td><b>${n}</b></td><td><a rel="mw:WikiLink" href="https://en.wikipedia.org/wiki/${name.replace(/ /g, '_')}">${name}</a></td></tr>`;
  const side = (prefix, extra = 0) => `<table>${Array.from({ length: 11 + extra }, (_, i) => row(i ? 'DF' : 'GK', i + 1, `${prefix} ${i + 1}`)).join('')}</table>`;
  const box = `<div itemscope class="footballbox"><span class="bday dtstart published updated itvstart">1966-07-30</span>
    <table class="fevent"><tr><th class="fhome"><a href="https://en.wikipedia.org/wiki/England_national_football_team">England</a></th>
    <th class="fscore">4–2 (a.e.t.)</th><th class="faway"><a href="/wiki/West_Germany_national_football_team">West Germany</a></th></tr></table>`;
  const [game] = worldCupLineups(`${box}<table width="100%"><tr><td>${side('Home')}</td><td>${side('Away')}</td></tr></table>`);
  assert.deepEqual([game.date, game.home, game.away, game.score], ['1966-07-30', 'England', 'West Germany', '4–2 (a.e.t.)']);
  assert.deepEqual(game.lineups[1][0], { position: 'GK', shirt: 1, name: 'Away 1', title: 'Away 1' });
  assert.throws(() => worldCupLineups(`${box}<table><tr><td>${side('Home')}</td><td>${side('Away', -1)}</td></tr></table>`), /line-ups of 11 and 10/);
});

// ---------- the committed seasons ----------

test('the nine seasons are built in, after the games\' seasons, labelled computed, each its committed file', () => {
  assert.deepEqual(MANIFEST.seasons.map(season => season.id), IDS);
  const listed = BUILT_IN_SEASONS.filter(set => setKindOf(set.id) === 'wc');
  assert.deepEqual(listed.map(set => set.id), IDS.slice().reverse(), 'newest first');
  assert.deepEqual(BUILT_IN_SEASONS.slice(-IDS.length), listed, 'the earliest seasons');
  for (const set of listed) {
    const doc = committed(set.id);
    assert.deepEqual([doc.id, doc.version, doc.year, doc.season, doc.label], [set.id, set.version, set.year, set.season, set.label]);
    assert.equal(doc.version, `${doc.id}-${contentHash(doc)}`);
    assert.match(doc.label, /^Computed · \d{4} World Cup$/);
    assert.ok(isFootballSetId(doc.id) && setSportOf(doc.id) === 'football' && BUILT_IN_SETS.some(entry => entry.id === doc.id));
    assert.ok(setHasNations(doc.id) && !setHasClubs(doc.id), 'nations only');
    assert.equal(doc.kind, 'wc');
    assert.equal(doc.local, false);
    const { source } = doc;
    assert.deepEqual([source.provider, source.method, source.computed, source.rawScale, source.licence],
      ['Computed', 'computed', true, 'Elo', 'CC BY-SA 4.0']);
    assert.equal(source.snapshotDate, facts(doc.id).elo.date, 'the Elo of the day after the final');
    assert.match(source.conversion, /^T = 87 − 3\.2 × \(E_best − E\) \/ 100/);
    assert.equal(source.squads.commit, MANIFEST.sources.worldCup.commit);
    assert.equal(source.results.commit, MANIFEST.sources.results.commit);
    assert.deepEqual(Object.keys(source.wikipedia.ballonDor).map(Number), [doc.year - 1, doc.year]);
  }
  assert.ok(SEASON_NOTES.football.includes('1961/62 to 1993/94 are computed'), 'the setup note says so');
  assert.ok(read('src/data/footballSeasons.js').includes('by npm run build:world-cup-seasons, computed'));
});

test('every season rebuilds byte for byte from its committed facts, with its credits', () => {
  const docs = [];
  for (const id of IDS) {
    const { doc, text } = buildWorldCupSeason(facts(id), MANIFEST);
    assert.equal(text, read(`public/football/${id}.json`).replace(/\r\n/g, '\n'), id);
    docs.push(doc);
    assert.equal(factsText(facts(id)), read(`scripts/data/world-cup-seasons/${id}.json`).replace(/\r\n/g, '\n'), `${id}: the facts' own form`);
  }
  const attribution = read('public/football/ATTRIBUTION-world-cup.txt').replace(/\r\n/g, '\n');
  assert.equal(attribution, attributionText(MANIFEST, docs));
  for (const doc of docs) assert.ok(attribution.includes(doc.version), doc.id);
  for (const needed of ['© 2023 Joshua C. Fjelstul, Ph.D.', 'https://github.com/jfjelstul/worldcup', 'https://creativecommons.org/licenses/by-sa/4.0/legalcode',
    'Changes:', 'oldid=1354464059']) assert.ok(attribution.includes(needed), needed);
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/build-world-cup-seasons.mjs'), '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /12 files rebuild byte for byte/);
});

const NATION_COUNTS = { 'wc-1962': 16, 'wc-1966': 16, 'wc-1970': 16, 'wc-1974': 15, 'wc-1978': 16, 'wc-1982': 24, 'wc-1986': 24, 'wc-1990': 24, 'wc-1994': 24 };

test('each season decodes: its finalists, eleven players each, rated 1–99 strongest first, the XI\'s mean the nation\'s T', () => {
  for (const id of IDS) {
    const doc = committed(id), own = facts(id);
    const set = decodeFootballSet(doc);
    assert.equal(Object.keys(doc.nations).length, NATION_COUNTS[id], id);
    assert.deepEqual(doc.coverage.nations, NATION_COUNTS[id]);
    assert.equal(doc.coverage.players, 11 * NATION_COUNTS[id]);
    assert.deepEqual(doc.clubs, []);
    for (const [nation, [str, size, players]] of Object.entries(doc.nations)) {
      const at = `${id} ${NATIONS[nation][0]}`;
      const team = own.nations.find(entry => entry.squad.some(player => `wc:${player.id}` === players[0][3].id));
      assert.equal(size, team.squad.length, at);
      assert.equal(players.length, 11, at);
      assert.ok(players.every(([, , rating], k) => Number.isInteger(rating) && rating >= 1 && rating <= 99 && (!k || rating <= players[k - 1][2])), at);
      const T = strengthOf(team.elo, own.elo.best.elo, MANIFEST.strength);
      assert.ok(Math.abs(mean(players.map(([, , rating]) => rating)) - T) <= 1 / 22 + 1e-9, `${at}: T ${T}`);
      assert.equal(str, Math.round(selectLineup({ sport: 'football', squad: players.map(([name, pos, rating]) => ({ name, pos, rating })) }).rating), at);
      assert.ok(players.every(([, , , source], k) => source.xiRank === k + 1 && source.teamElo === team.elo && source.snapshotDate === own.elo.date), at);
      // Every player is one of the squad.
      assert.ok(players.every(([name, pos, , source]) => team.squad.some(p => `wc:${p.id}` === source.id && p.name === name && p.position === pos)), at);
    }
    assert.ok(Object.keys(set.rosters).length === NATION_COUNTS[id] && set.clubs.length === 0, id);
  }
});

// ---------- history ----------

test('spot checks: each season\'s strongest nations and players are history\'s', () => {
  const T = (id, nation) => committed(id).nations[nation][0];
  const best = id => Object.entries(committed(id).nations).sort((a, b) => b[1][0] - a[1][0] || (a[0] < b[0] ? -1 : 1))[0][0];
  // The strongest by Elo the day after each final: the winner, but in 1978 and 1982 Brazil (third, unbeaten, in 1978).
  assert.deepEqual(IDS.map(best), ['076', '826', '076', '276', '076', '076', '032', '276', '076']);
  for (const id of IDS) assert.equal(facts(id).elo.best.team, { '076': 'Brazil', 826: 'England', 276: 'Germany', '032': 'Argentina' }[best(id)], id);
  assert.ok(T('wc-1970', '276') > T('wc-1970', '826') && T('wc-1970', '826') > T('wc-1970', '643'), '1970: West Germany, England, then the Soviet Union');
  // Each XI's first is its star of the day.
  const first = (id, nation) => names(committed(id), nation)[0];
  assert.equal(first('wc-1962', '076'), 'Garrincha');
  assert.equal(first('wc-1962', '203'), 'Josef Masopust', '1962\'s Ballon d\'Or');
  assert.equal(first('wc-1962', '643'), 'Lev Yashin');
  assert.equal(first('wc-1966', '620'), 'Eusébio');
  assert.equal(first('wc-1970', '076'), 'Jairzinho');
  assert.equal(first('wc-1970', '276'), 'Gerd Müller');
  assert.equal(first('wc-1974', '528'), 'Johan Cruyff');
  assert.equal(first('wc-1978', '032'), 'Mario Kempes');
  assert.equal(first('wc-1982', '380'), 'Paolo Rossi');
  assert.equal(first('wc-1986', '032'), 'Diego Maradona');
  assert.equal(first('wc-1990', '276'), 'Lothar Matthäus');
  assert.equal(first('wc-1994', '380'), 'Roberto Baggio');
  // The XI is the most-used per role: Brazil 1970's 4-2-4 keeps Pelé and Jairzinho up front; Tostão, its third forward,
  // has no place in a 4-4-2.
  const brazil = names(committed('wc-1970'), '076');
  for (const name of ['Pelé', 'Jairzinho', 'Rivellino', 'Gérson', 'Clodoaldo', 'Carlos Alberto', 'Félix']) assert.ok(brazil.includes(name), name);
  assert.ok(!brazil.includes('Tostão'));
  const pele = eleven(committed('wc-1970'), '076').find(([name]) => name === 'Pelé')[3];
  assert.deepEqual([pele.goals, pele.minutes, pele.starts, pele.url], [4, 540, 6, 'https://en.wikipedia.org/wiki/Pel%C3%A9']);
});

test('the federations of the day: the finalists play under their own names, and hold only their own members', () => {
  const sportOf = id => seasonSport(decodeFootballSet(committed(id)));
  const held = (id, holder) => Object.entries(committed(id).territory.merged).filter(([, h]) => h === holder).map(([shape]) => shape).sort();
  const URS = { name: 'Soviet Union', code: 'URS', flagId: 'URS' };
  // 1969/70: the Soviet Union holds Ukraine and the Baltic states; Yugoslavia, not a finalist, holds nothing.
  const s1970 = sportOf('wc-1970');
  assert.deepEqual(nationIdentity('643', s1970), URS);
  assert.deepEqual(committed('wc-1970').identities, { 203: { name: 'Czechoslovakia', code: 'TCH', flagId: '203' },
    276: { name: 'West Germany', code: 'FRG', flagId: '276' }, 643: URS });
  assert.ok(['804', '233', '428', '440'].every(shape => committed('wc-1970').territory.merged[shape] === '643'));
  assert.deepEqual(held('wc-1970', '203'), ['703']);
  assert.ok(['191', '705', '070', '807', '499', 'KOS'].every(shape => committed('wc-1970').territory.inactive.includes(shape)), 'Yugoslavia\'s land neutral');
  assert.ok(!fieldedNations(s1970).includes('688') && !fieldedNations(s1970).includes('804'));
  // 1981/82: Yugoslavia holds Croatia; 1989/90: Czechoslovakia holds Slovakia.
  assert.equal(committed('wc-1982').territory.merged['191'], '688');
  assert.equal(nationIdentity('688', sportOf('wc-1982')).name, 'Yugoslavia');
  assert.equal(committed('wc-1990').territory.merged['703'], '203');
  assert.equal(nationIdentity('276', sportOf('wc-1990')).name, 'West Germany');
  // 1973/74: Zaire under its name and flag; East Germany has no shape, so 15 of the 16 finalists play.
  const s1974 = sportOf('wc-1974');
  assert.deepEqual(nationIdentity('180', s1974), { name: 'Zaire', code: 'ZAI', flagId: 'ZAI' });
  assert.deepEqual(JSON.parse(read('docs/design/football-world-cup-seasons-audit.json')).seasons.find(s => s.id === 'wc-1974').dropped,
    [{ team: 'East Germany', why: 'no shape on the map' }]);
  assert.ok(facts('wc-1974').nations.some(n => n.team === 'East Germany'));
  // 1993/94: no federation of the day; Russia and Germany under their own names.
  assert.ok(!('identities' in committed('wc-1994')));
  assert.equal(nationIdentity('643', sportOf('wc-1994')).name, 'Russia');
  assert.equal(nationIdentity('276', sportOf('wc-1994')).name, 'Germany');
  // Each season's territory and identities are the federations table's, with its finalists fielding.
  for (const id of IDS) {
    const doc = committed(id), fields = shape => Object.hasOwn(doc.nations, shape);
    assert.deepEqual(doc.territory, territoryFor(FOOTBALL_FEDERATIONS, doc.year, { fields }), id);
    assert.deepEqual(doc.identities ?? {}, identitiesFor(FOOTBALL_FEDERATIONS, doc.year, { fields }), id);
    const sport = sportOf(id);
    assert.deepEqual(fieldedNations(sport).slice().sort(), Object.keys(doc.nations).sort(), `${id}: every finalist, and only they, field a team`);
    assert.ok(heldShapes(sport).every(([shape]) => !Object.hasOwn(doc.nations, shape)), `${id}: no finalist starts in another's empire`);
  }
});

test('the theatres: the world always, a continent with four finalists, never the Elite 32', () => {
  const offered = id => nationTheatres(seasonSport(decodeFootballSet(committed(id)))).map(scope => scope.id);
  assert.deepEqual(IDS.map(offered), [
    ['world', 'UEFA', 'CONMEBOL'], ['world', 'UEFA', 'CONMEBOL'], ['world', 'UEFA'], ['world', 'UEFA', 'CONMEBOL'], ['world', 'UEFA'],
    ['world', 'UEFA', 'CONMEBOL'], ['world', 'UEFA', 'CONMEBOL'], ['world', 'UEFA', 'CONMEBOL'], ['world', 'UEFA', 'CONMEBOL']]);
});

test('a challenge link names a computed season; it plays nations only', () => {
  const link = readChallenge('theatre=UEFA&season=wc-1970&seed=7');
  assert.deepEqual([link.setup.dataSet, link.setup.scope, link.ignored], ['wc-1970', 'UEFA', []]);
  const clubs = readChallenge('teams=clubs&season=wc-1990');
  assert.deepEqual([clubs.setup.dataSet, clubs.setup.layer, clubs.ignored], ['wc-1990', 'nations', ['teams']]);
  assert.deepEqual(readChallenge('season=wc-1958').ignored, ['season'], 'no World Cup before 1962');
});

// ---------- the loader ----------

test('the loader refuses a damaged World Cup season', () => {
  const doc = committed('wc-1970');
  const refuses = (change, pattern) => {
    const copy = structuredClone(doc);
    change(copy);
    assert.throws(() => decodeFootballSet(copy, copy.id), pattern);
  };
  const first = copy => copy.nations['076'][2][0];
  refuses(copy => { copy.kind = 'cm0102'; }, /is not the kind its id names/);
  refuses(copy => { delete copy.source.method; }, /ratings are computed/);
  refuses(copy => { copy.source.rawScale = 99; }, /rawScale must be "Elo"/);
  refuses(copy => { copy.source.conversion = ' '; }, /how the ratings were computed/);
  refuses(copy => { delete copy.source.licence; }, /licence/);
  refuses(copy => { copy.clubs = [{ id: 'f-santos' }]; }, /nations only/);
  refuses(copy => { copy.nations['076'][2].pop(); }, /must name its eleven/);
  refuses(copy => { first(copy)[2] = 100; }, /rating must be a whole number 1-99/);
  refuses(copy => { first(copy)[2] = 92.5; }, /rating must be a whole number 1-99/);
  refuses(copy => { first(copy)[1] = 'ST'; }, /must be GK, DF, MF or FW/);
  refuses(copy => { first(copy).pop(); }, /is not \[name, position, rating, source\]/);
  refuses(copy => { const xi = copy.nations['076'][2]; xi[1][2] = xi[0][2] + 1; }, /strongest first/);
  refuses(copy => { delete first(copy)[3].teamElo; }, /source must name the player/);
  refuses(copy => { first(copy)[3].xiRank = 2; }, /source must name the player/);
  refuses(copy => { first(copy)[3].source = 'football-manager'; }, /source must name the player/);
  refuses(copy => { first(copy)[3].url = 'https://example.com/pele'; }, /his Wikipedia article/);
  refuses(copy => { copy.nations['076'][2][1][0] = copy.nations['076'][2][0][0]; }, /repeats one/);
  refuses(copy => { copy.nations['076'][1] = 10; }, /squad of 10 cannot hold/);
  refuses(copy => { copy.nations['032'] = copy.nations['076']; }, /repeats player/);
  refuses(copy => { copy.territory.merged['804'] = '688'; }, /names no nation of this season as its holder/);
  refuses(copy => { copy.territory.inactive.push('076'); }, /fields a team of its own|names no nation/);
  refuses(copy => { copy.identities['688'] = { name: 'Yugoslavia', code: 'YUG', flagId: 'YUG' }; }, /identities\[688\] names no nation the season fields/);
  refuses(copy => { delete copy.identities; copy.nations = { '076': copy.nations['076'] }; copy.territory = { merged: {}, inactive: [] }; },
    /at least two nations/);
  assert.ok(decodeFootballSet(structuredClone(doc)), 'the file itself loads');
});

// ---------- in the running game ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
  clearFootballSetIndex: ['src/engine/footballSets.js', 'clearFootballSetIndex'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

test('a 1969/70 campaign plays the Soviet Union\'s computed eleven, saves its players whole, and resumes without the file', async () => {
  const doc = committed('wc-1970');
  const calls = [], gone = new Set();
  const fetch = async url => {
    const at = String(url);
    calls.push(at);
    if (gone.has(at)) throw new Error('the file is gone');
    if (/^\/football\/wc-\d{4}\.json$/.test(at)) return { ok: true, status: 200, json: async () => JSON.parse(read(`public${at}`)) };
    return { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  const ids = ['643', '804', '428', '688', '191', '276', '826', '380'];
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids,
    settings: { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', role: 'manager', managedTeamId: '643', seed: '9' } });
  f.app.opening = B.App.prototype.opening;
  try {
    const { app, items, time } = f;
    await app.requestSeasons();
    assert.ok(app.state.footballSets.some(set => set.id === 'wc-1970' && set.label === 'Computed · 1970 World Cup'));
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', 'wc-1970');
    assert.equal(app.state.setup.layer, 'nations', 'a season with nations only takes the nations');
    time.advance(200);
    await app.loadSet('wc-1970');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    app.pickSetup('managedTeamId', '643');
    const wall = app.setupTeams();
    assert.deepEqual(wall.map(team => team.id).sort(), Object.keys(doc.nations).filter(id => NATIONS[id][2] === 'UEFA').sort(),
      'Europe\'s finalists, no one else');
    const soviet = wall.find(team => team.id === '643');
    assert.deepEqual([soviet.name, soviet.code, soviet.flagId], ['Soviet Union', 'URS', 'URS']);
    const model = buildSetupModel(app.state.setup, { managerTeams: wall, season: app.seasonStatus() });
    assert.equal(model.campaignSummary, 'Football · Nations · Europe · 1969/70');
    assert.match(model.season.note, /1961\/62 to 1993\/94 are computed/);

    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason], ['wc-1970', doc.version, 1970, '1969/70']);
    assert.equal(st.campaignName, 'Football 1969/70 · Europe · Soviet Union');
    assert.deepEqual(st.teams['643'].squad.map(player => player.name), names(doc, '643'), 'the computed eleven');
    assert.ok(st.teams['643'].squad.every(player => player.sourceInfo.source === 'world-cup'));
    assert.deepEqual([st.teams['276'].name, st.teams['276'].flagId], ['West Germany', '276']);
    assert.ok(['804', '428'].every(shape => st.own[shape] === '643'), 'the Soviet Union holds its republics');
    assert.ok(!st.teams['688'] && !st.teams['191'] && !('191' in st.own), 'Yugoslavia, not a finalist, fields no team, its land neutral');
    // The squad screen's Source column says computed and links to the player's article.
    const player = st.teams['643'].squad[0];
    assert.equal(sourceLabel(player), '1970 World Cup, computed');
    assert.equal(sourceUrl(player), player.sourceInfo.url);

    // The checkpoint keeps the players whole (no pack: a computed player is a plain record) and resumes with no file.
    const text = items.get(SAVE_KEY);
    assert.equal(JSON.parse(text).playerPack, undefined);
    B.clearFootballSetCache();
    gone.add('/football/wc-1970.json');
    const before = calls.length;
    const saved = parseCampaign(text);
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams), 'squads rebuild exactly');
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams));
    assert.equal(calls.length, before, 'resuming fetched nothing');
    assert.equal(app.state.settings.dataSet, 'wc-1970');
  } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
});
