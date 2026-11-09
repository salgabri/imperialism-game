// Ice hockey's computed and converted seasons (docs/design/hockey.md, "Computed seasons", "NHL 08 and NHL 09", "Eras"):
// the rule by hand, its calibration against the five full EA editions (the committed fixture), the ratings read off the
// frozen histograms with every order kept, NHL 08 and NHL 09 converted onto NHL 07's overalls, the eras and their maps,
// clubs only before 1977/78, the loader's refusals, and the App playing a 1967/68 clubs campaign, a 1985/86 nations
// campaign and resuming a 2006/07 campaign saved on the map before it served more seasons.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { SAVE_KEY } from '../src/config.js';
import { BUILT_IN_HOCKEY_SEASONS } from '../src/data/hockeySeasons.js';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { selectLineup } from '../src/data/teams.js';
import { decodeDomestic } from '../src/engine/domestic.js';
import { decodeFootballSet, setHasClubs, setHasNations } from '../src/engine/footballSets.js';
import { parseCampaign } from '../src/engine/storage.js';
import { pointInPolys } from './lib/domestic-partition.mjs';
import {
  RULE, attributeMean, calibrationOf, clubOfStints, goalieValue, groupOf, groupRatings, midRankRatings, ratingsOfHistogram, scoreOf,
  seasonBefore, skaterValue, spearman, stepRating, windowOf,
} from './lib/nhl-computed.mjs';
import { hdbBirthCountry, hdbPosition, moneypuckStints } from './lib/nhl-stats.mjs';
import { mapOf, parseIgnAttributes, teamsOf } from './lib/nhl-seasons.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const MANIFEST = JSON.parse(read('scripts/data/nhl-seasons.json'));
const AUDIT = JSON.parse(read('docs/design/hockey-seasons-audit.json'));
const FIXTURE = JSON.parse(read('scripts/data/nhl-seasons/calibration.json'));
const snapshotOf = id => JSON.parse(read(`scripts/data/nhl-seasons/${id}.json`));
const seasonFile = id => JSON.parse(read(`public/hockey/${id}.json`));
const mapFile = id => JSON.parse(read(`public/domestic/${id}.json`));
const auditOf = id => AUDIT.seasons.find(season => season.id === id);
const COMPUTED = MANIFEST.seasons.filter(season => season.method === 'computed');
const CONVERTED = MANIFEST.seasons.filter(season => season.method === 'converted');
const close = (a, b) => Math.abs(a - b) < 1e-9;
const playerOf = (id, name) => {
  for (const club of seasonFile(id).clubs) {
    const player = club.squad.find(([n]) => n === name);
    if (player) return [club.code, ...player.slice(1)];
  }
  return null;
};

// ---------- the rule ----------

test('a line\'s value by hand: points a game, minutes a game, save percentage and goals against', () => {
  // A forward of the points era: 8 × (60 points + 1) / (70 games + 10).
  assert.ok(close(skaterValue([1980, 70, 60, null], 'F', false), 8 * 61 / 80));
  // A defender of the minutes era: (1,600 minutes + 90) / 92 + 5 × (40 + 1) / 92.
  assert.ok(close(skaterValue([2016, 82, 40, 96000], 'D', true), 1690 / 92 + 5 * 41 / 92));
  assert.throws(() => skaterValue([2016, 82, 40, null], 'D', true), /time on ice/);
  // A goalie by save percentage: 1,800 shots, 160 goals, league .910, 60 games of 82.
  const league = { savePct: 0.91, gaa: 2.7, maxGames: 82 };
  const savePct = (1640 + 600 * (0.91 - 0.012)) / (1800 + 600);
  assert.ok(close(goalieValue([2016, 60, 3500 * 60, 160, 1800], league, 'saves'), 1000 * (savePct - 0.91) + 6 * 60 / 82));
  // By goals against before shots were kept: 3,000 minutes, 140 goals, league 3.3 a game.
  const old = { savePct: null, gaa: 3.3, maxGames: 78 };
  const against = (140 + 20 * (3.3 + 0.36)) / (50 + 20);
  assert.ok(close(goalieValue([1975, 52, 3000 * 60, 140, null], old, 'goals'), 1000 * (3.3 - against) / 30 + 6 * 52 / 78));
  assert.throws(() => goalieValue([1975, 52, 3000 * 60, 140, null], old, 'saves'), /shots against/);
  // A workload over the most games any skater played counts as a full one.
  assert.ok(close(goalieValue([1975, 80, 4800 * 60, 200, null], { ...old, maxGames: 78 }, 'goals') - goalieValue([1975, 80, 4800 * 60, 200, null], { ...old, maxGames: 80 }, 'goals'), 0));
  assert.deepEqual(RULE.weights, [1, 2, 1]);
});

test('the score weighs the season 1, the one before 2, the one before that 1, over the seasons played; 2004/05 is skipped', () => {
  assert.deepEqual(windowOf(1980), [1980, 1979, 1978]);
  assert.deepEqual(windowOf(2006), [2006, 2004, 2003], '2004/05 was cancelled');
  assert.deepEqual(windowOf(2007), [2007, 2006, 2004]);
  assert.equal(seasonBefore(2006), 2004);
  const form = { skaters: 'points', goalies: 'saves' };
  const leagues = { 1980: {}, 1979: {}, 1978: {} };
  const v = (games, points) => skaterValue([0, games, points, null], 'F', false);
  const all = scoreOf({ pos: 'C', lines: [[1980, 80, 100, null], [1979, 80, 80, null], [1978, 80, 60, null]] }, 1980, leagues, form);
  assert.ok(close(all, (v(80, 100) + 2 * v(80, 80) + v(80, 60)) / 4));
  // A rookie has his one season; a player who missed the season before has the two he played, weighted 1 and 1.
  assert.ok(close(scoreOf({ pos: 'C', lines: [[1980, 80, 100, null]] }, 1980, leagues, form), v(80, 100)));
  assert.ok(close(scoreOf({ pos: 'C', lines: [[1980, 80, 100, null], [1978, 80, 60, null]] }, 1980, leagues, form), (v(80, 100) + v(80, 60)) / 2));
  // A line from outside the window counts for nothing.
  assert.equal(scoreOf({ pos: 'C', lines: [[1977, 80, 60, null]] }, 1980, leagues, form), null);
});

test('a player plays for the club he played most games for, a tie going to the later one', () => {
  assert.equal(clubOfStints([['PHI', 57], ['FLA', 18]]), 'PHI');
  assert.equal(clubOfStints([['NJD', 30], ['ARI', 35]]), 'ARI');
  assert.equal(clubOfStints([['BOS', 20], ['TOR', 20]]), 'TOR');
  assert.equal(clubOfStints([]), null);
  // MoneyPuck's game-by-game rows: regular-season games only, in date order.
  const rows = [
    { playerId: '1', gameId: '2021020001', gameDate: '20211013', playerTeam: 'PHI', situation: 'all' },
    { playerId: '1', gameId: '2021020500', gameDate: '20220320', playerTeam: 'FLA', situation: 'all' },
    { playerId: '1', gameId: '2021020600', gameDate: '20220322', playerTeam: 'FLA', situation: 'all' },
    { playerId: '1', gameId: '2021030111', gameDate: '20220503', playerTeam: 'FLA', situation: 'all' },
    { playerId: '1', gameId: '2021020002', gameDate: '20211015', playerTeam: 'PHI', situation: '5on5' },
  ];
  assert.deepEqual(moneypuckStints(rows, 2022).get(1), [['PHI', 1], ['FLA', 2]], 'a playoff game and a 5-on-5 row do not count');
  assert.deepEqual(moneypuckStints([{ playerId: '2', gameId: '2010020001', gameDate: '20101008', playerTeam: 'ARI', situation: 'all' }], 2011).get(2), [['PHX', 1]],
    'MoneyPuck codes the Phoenix Coyotes as Arizona');
});

test('ratings come from a frozen histogram by mid-rank: ties stay ties, nobody passes anybody, a depth player steps down', () => {
  const rating = midRankRatings([1, 2, 2, 3, 4], [70, 75, 80, 85, 90]);
  assert.deepEqual([...rating].sort((a, b) => a[0] - b[0]), [[1, 70], [2, 80], [3, 85], [4, 90]]);
  const players = [{ pos: 'C', s: 3 }, { pos: 'LW', s: 1 }, { pos: 'D', s: 5 }, { pos: 'D', s: 2 }, { pos: 'G', s: 9 }];
  const by = groupRatings(players, 's', { F: { 70: 1, 90: 1 }, D: { 60: 1, 80: 1 }, G: { 85: 1 } });
  assert.deepEqual(players.map(p => by.get(p)), [90, 70, 80, 60, 85], 'each group reads its own histogram');
  const squad = [{ pos: 'C', score: 10, rating: 90 }, { pos: 'C', score: 5, rating: 80 }, { pos: 'D', score: 4, rating: 77 }];
  assert.equal(stepRating({ pos: 'RW', score: 7 }, squad), 80, 'the highest squad score not above his');
  assert.equal(stepRating({ pos: 'LW', score: 1 }, squad), 80, 'below every squad forward: the lowest squad forward\'s rating');
  assert.deepEqual(ratingsOfHistogram({ 72: 2, 80: 1 }), [72, 72, 80]);
});

// ---------- the computed seasons ----------

test('the computed seasons: every squad rating NHL 27\'s, the order of every group kept, the source saying how', () => {
  assert.equal(COMPUTED.length, 52);
  assert.deepEqual(MANIFEST.seasons.map(s => s.year).sort((a, b) => a - b),
    Array.from({ length: 60 }, (_, i) => 1967 + i).filter(year => year !== 2005), 'every season from 1966/67 to 2025/26 but 2004/05');
  const reference = Object.fromEntries(['F', 'D', 'G'].map(g => [g, new Set(ratingsOfHistogram(MANIFEST.computed.histograms[g]))]));
  for (const entry of COMPUTED) {
    const doc = seasonFile(entry.id), snapshot = snapshotOf(entry.id);
    assert.equal(doc.source.method, 'computed');
    assert.match(doc.source.conversion, /weighted 1:2:1/);
    assert.equal(doc.label, 'Computed from statistics');
    assert.equal(snapshot.source.kind, entry.source.kind);
    assert.equal(snapshot.form.skaters, entry.year >= 2011 ? 'minutes' : 'points', `${entry.id}: minutes a game only where MoneyPuck keeps time on ice`);
    assert.equal(snapshot.form.goalies, entry.year >= 1985 ? 'saves' : 'goals', `${entry.id}: save percentage once the whole window kept shots against`);
    assert.equal(doc.source.provider, entry.year <= 2010 ? 'the Hockey Databank project' : 'MoneyPuck.com');
    const leagues = snapshot.leagues;
    const scores = new Map(snapshot.players.map(([, name, team, pos, , lines]) => [`${name}|${team}`, scoreOf({ pos, lines }, entry.year, leagues, snapshot.form)]));
    const squad = doc.clubs.flatMap(club => club.squad.map(([name, pos, rating]) => ({ name, pos, rating, score: scores.get(`${name}|${club.code}`) })));
    for (const group of ['F', 'D', 'G']) {
      const list = squad.filter(p => groupOf(p.pos) === group).sort((a, b) => a.score - b.score);
      assert.ok(list.every(p => reference[group].has(p.rating)), `${entry.id} ${group}: every rating is NHL 27's`);
      assert.ok(list.every((p, i) => i === 0 || p.rating >= list[i - 1].rating), `${entry.id} ${group}: nobody passes anybody`);
    }
    for (const club of doc.clubs) {
      const lineup = selectLineup({ sport: 'hockey', squad: club.squad.map(([name, pos, rating]) => ({ name, pos, rating })) });
      assert.equal(lineup.rating, club.str, `${entry.id} ${club.name}'s strength is its lineup's`);
    }
  }
});

test('known history: the stars of their day on top, the strongest and weakest clubs of a few seasons', () => {
  assert.deepEqual(auditOf('nhl-1967').best.forwards.slice(0, 2), ['Bobby Hull (CHI) 99', 'Stan Mikita (CHI) 95'], 'Hull and Mikita, 1966/67');
  assert.match(auditOf('nhl-1967').clubs[0], /^Chicago Black Hawks/, 'Chicago, first in 1966/67');
  for (const id of ['nhl-1971', 'nhl-1972', 'nhl-1973', 'nhl-1974', 'nhl-1975']) assert.match(auditOf(id).best.defenders[0], /^Bobby Orr/, `${id}: Orr the best defender`);
  for (let year = 1980; year <= 1989; year++) assert.match(auditOf(`nhl-${year}`).best.forwards[0], /^Wayne Gretzky \((?:EDM|LAK)\) 99$/, `${year}: Gretzky first`);
  assert.match(auditOf('nhl-1990').best.forwards[0], /^Mario Lemieux/, 'Lemieux in 1989/90');
  assert.match(auditOf('nhl-1977').clubs[0], /^Montreal Canadiens/, 'the 1976/77 Canadiens strongest');
  assert.deepEqual(auditOf('nhl-1975').clubs.slice(-2).map(line => line.replace(/ \d.*/, '')), ['Kansas City Scouts', 'Washington Capitals'], 'the 1974/75 expansion clubs weakest');
  assert.match(auditOf('nhl-2020').best.forwards[0], /^Connor McDavid/);
  assert.deepEqual(playerOf('nhl-1986', 'Wayne Gretzky'), ['EDM', 'C', 99]);
});

test('calibration: the rule against the five full editions, from the permitted sources', () => {
  assert.deepEqual(FIXTURE.editions.map(e => [e.id, e.kind]), [['nhl-1993', 'hdb'], ['nhl-1994', 'hdb'], ['nhl-1995', 'hdb'], ['nhl-2007', 'hdb'], ['nhl-2022', 'moneypuck']]);
  const measured = e => calibrationOf(e.players.map(([name, team, pos, overall, lines]) => ({ name, team, pos, overall,
    score: lines.length ? scoreOf({ pos, lines }, e.year, e.leagues, e.form) : null })), MANIFEST.computed.histograms);
  for (const e of FIXTURE.editions) {
    const m = measured(e);
    assert.ok(m.F.rho >= 0.84 && m.D.rho >= 0.75 && m.G.rho >= 0.59, `${e.id}: F ${m.F.rho}, D ${m.D.rho}, G ${m.G.rho}`);
    assert.ok(m.playerGap <= 2.8 && m.clubs.gap <= 1.7, `${e.id}: players ${m.playerGap} apart, clubs ${m.clubs.gap}`);
    assert.ok(e.unmatched.length <= 7, `${e.id}: ${e.unmatched.length} of the edition's players without a line`);
    const recorded = AUDIT.calibration.find(row => row.id === e.id).forms[0];
    assert.deepEqual([recorded.F.rho, recorded.D.rho, recorded.G.rho], [m.F.rho, m.D.rho, m.G.rho], 'the audit records it');
  }
  // Minutes a game: NHL 22's defenders and clubs rank better with it than by points alone.
  const nhl22 = FIXTURE.editions.find(e => e.id === 'nhl-2022');
  const points = measured({ ...nhl22, form: { ...nhl22.form, skaters: 'points' } }), minutes = measured(nhl22);
  assert.ok(minutes.D.rho > points.D.rho && minutes.clubs.gap < points.clubs.gap);
  // Goals against before 1982/83: on the editions that have both, within 0.03 of save percentage on average.
  const hdb = FIXTURE.editions.filter(e => e.kind === 'hdb');
  const mean = list => list.reduce((s, v) => s + v, 0) / list.length;
  const bySaves = mean(hdb.map(e => measured(e).G.rho)), byGoals = mean(hdb.map(e => measured({ ...e, form: { ...e.form, goalies: 'goals' } }).G.rho));
  assert.ok(byGoals > bySaves - 0.03, `goals against ${byGoals.toFixed(3)}, save percentage ${bySaves.toFixed(3)}`);
});

test('nations only from 1977/78, the first season with three real sides; clubs only before', () => {
  assert.equal(AUDIT.firstSeasonWithNations, '1977/78');
  for (const entry of COMPUTED) {
    const doc = seasonFile(entry.id);
    const clubsOnly = entry.year <= 1977;
    assert.equal(setHasNations(entry.id), !clubsOnly, entry.id);
    assert.ok(setHasClubs(entry.id));
    if (clubsOnly) assert.deepEqual(doc.nations, {}, `${entry.id} has clubs only`);
    else assert.ok(doc.nations['124'] && doc.nations['840'], `${entry.id}: Canada and the USA`);
    assert.ok(auditOf(entry.id).realSides.length >= 3 || clubsOnly, `${entry.id}: ${auditOf(entry.id).realSides.join(', ')}`);
  }
  assert.deepEqual(auditOf('nhl-1977').realSides, ['Canada', 'United States']);
  assert.deepEqual(auditOf('nhl-1978').realSides, ['Canada', 'United States', 'Sweden']);
});

test('birth countries: the Hockey Databank\'s, a birth city in another country today deciding', () => {
  const m = (birthCountry, birthCity) => ({ firstName: 'A', lastName: 'B', birthCountry, birthCity, playerID: 'x' });
  assert.equal(hdbBirthCountry(m('USSR', 'Riga')), 'LVA');
  assert.equal(hdbBirthCountry(m('Czechoslovakia', 'Kosice')), 'SVK');
  assert.equal(hdbBirthCountry(m('Czech Republic', 'Sokolce')), 'SVK', 'Mikita, born in Slovakia');
  assert.equal(hdbBirthCountry(m('Czech Republic', 'Kladno')), 'CZE');
  assert.equal(hdbBirthCountry(m('Ukraine', 'Sverdlovsk')), 'RUS', 'Khabibulin, born in Sverdlovsk');
  assert.equal(hdbBirthCountry(m('England', 'Birmingham')), 'GBR');
  assert.equal(hdbBirthCountry(m('', '')), null);
  assert.throws(() => hdbBirthCountry(m('USSR', 'Atlantis')), /No country today/);
  assert.equal(hdbPosition('L/C'), 'LW');
  const doc = seasonFile('nhl-1983');
  const nationOf = name => Object.keys(doc.nations).filter(id => doc.nations[id][2].some(([player]) => player === name));
  assert.deepEqual(nationOf('Peter Stastny'), ['703'], 'Peter Stastny for Slovakia, born in Bratislava');
});

// ---------- NHL 08 and NHL 09 ----------

test('NHL 08 and NHL 09: EA\'s attributes, the mean ranked onto NHL 07\'s overalls, 255 left out', () => {
  assert.deepEqual(CONVERTED.map(s => s.id), ['nhl-2008', 'nhl-2009']);
  const n08 = snapshotOf('nhl-2008'), n09 = snapshotOf('nhl-2009');
  assert.equal(n08.attributes.skater.length, 19);
  assert.equal(n08.attributes.goalie.length, 16);
  assert.ok(!n08.attributes.skater.some(a => ['Aggression', 'Discipline', 'Durability', 'Potential', 'Toughness'].includes(a)));
  assert.equal(n09.attributes.skater.length, 19);
  assert.ok(!n09.attributes.skater.some(a => ['DIS', 'TGH', 'AGG', 'DUR'].includes(a)) && !n09.attributes.goalie.some(a => ['AGGR', 'DUR', 'PUCK'].includes(a)));
  assert.deepEqual(n08.left.map(([name]) => name).sort(), ['Alexei Zhamnov', 'Jiri Fischer', 'Mike Rathje', 'Rob DiMaio'], 'EA\'s unset 255');
  assert.equal(attributeMean([80, 255]), null);
  assert.equal(attributeMean([80, 90]), 85);
  const reference = Object.fromEntries(['F', 'D', 'G'].map(g => [g, new Set(ratingsOfHistogram(MANIFEST.converted.histograms[g]))]));
  for (const entry of CONVERTED) {
    const doc = seasonFile(entry.id), snapshot = snapshotOf(entry.id);
    assert.equal(doc.source.method, 'converted');
    assert.match(doc.source.conversion, /NHL 07's EA overalls/);
    const mean = new Map(snapshot.players.map(([name, team, , , values]) => [`${name}|${team}`, attributeMean(values)]));
    for (const club of doc.clubs) {
      for (const [name, pos, rating] of club.squad) assert.ok(reference[groupOf(pos)].has(rating) && mean.has(`${name}|${club.code}`), `${entry.id} ${name}`);
    }
    assert.ok(doc.clubs.every(club => club.squad.filter(([, pos]) => pos === 'G').length >= 1), 'every club ices a goalie');
  }
  assert.match(seasonFile('nhl-2009').source.compiler, /overalls were not ready/);
  assert.deepEqual(playerOf('nhl-2008', 'Martin Brodeur'), ['NJD', 'G', 96]);
  assert.match(auditOf('nhl-2008').clubs[0], /^Anaheim Ducks/, 'the 2007 champions strongest in NHL 08');
  // Nations: EA's Country (NHL 08), its NHL 08 country a year on (NHL 09).
  assert.ok(seasonFile('nhl-2008').nations['124'][2].some(([name]) => name === 'Sidney Crosby'));
});

const nhl07Pages = new URL('../data-src/nhl-seasons/nhl07/', import.meta.url);
test('the conversion\'s premise: within NHL 07 the mean of the skill attributes ranks players like EA\'s overall', { skip: !existsSync(nhl07Pages) && 'IGN\'s NHL 07 pages (data-src/nhl-seasons/nhl07/) are not on this computer' }, () => {
  const SKILLS = ['Speed', 'Acceleration', 'Agility', 'Balance', 'Wrist Shot Power', 'Wrist Shot Acc.', 'Slapshot Power', 'Slapshot Acc.', 'Passing', 'Deking',
    'Puck Control', 'Faceoff', 'Checking', 'Endurance'];
  const rows = readdirSync(nhl07Pages).filter(f => f !== 'goalies.html').flatMap(f => parseIgnAttributes(readFileSync(new URL(f, nhl07Pages), 'latin1')));
  for (const [group, test] of [['F', pos => pos !== 'Defenseman' && pos !== 'Goalie'], ['D', pos => pos === 'Defenseman']]) {
    const list = rows.filter(r => test(r.fields.Position));
    const rho = spearman(list.map(r => attributeMean(SKILLS.map(a => Number(r.fields[a])))), list.map(r => Number(r.fields.Overall)));
    assert.ok(rho >= 0.93, `${group}: ${rho}`);
  }
});

// ---------- eras and maps ----------

test('the eras: the clubs of every season, the defunct Seals and Barons, the 1979/80 Whalers at Springfield', () => {
  const counts = Object.fromEntries([1967, 1968, 1971, 1973, 1975, 1977, 1979, 1980, 1992, 1993, 1994, 1999, 2000, 2001, 2018, 2022]
    .map(year => [year, teamsOf(MANIFEST, year).length]));
  assert.deepEqual(counts, { 1967: 6, 1968: 12, 1971: 14, 1973: 16, 1975: 18, 1977: 18, 1979: 17, 1980: 21, 1992: 22, 1993: 24, 1994: 26, 1999: 27, 2000: 28,
    2001: 30, 2018: 31, 2022: 32 });
  const seals = teamsOf(MANIFEST, 1968).find(t => t.code === 'OAK');
  assert.deepEqual([seals.id, seals.franchise, seals.name], ['nhl-oakland-seals', null, 'Oakland Seals']);
  assert.equal(teamsOf(MANIFEST, 1972).find(t => t.code === 'CGS').name, 'California Golden Seals');
  assert.deepEqual(teamsOf(MANIFEST, 1978).find(t => t.code === 'CLE').city, 'Richfield');
  assert.ok(!teamsOf(MANIFEST, 1979).some(t => t.code === 'CLE'), 'the Barons merged into the North Stars');
  const whalers = teamsOf(MANIFEST, 1980).find(t => t.code === 'HFD');
  assert.deepEqual([whalers.city, whalers.arena], ['Springfield', 'Springfield Civic Center'], '22 of 40 home games');
  assert.equal(teamsOf(MANIFEST, 1981).find(t => t.code === 'HFD').city, 'Hartford');
  assert.throws(() => teamsOf(MANIFEST, 2005), /No NHL clubs/);
  // The eras give the shipped seasons' clubs exactly as `teams` lists them.
  for (const year of Object.keys(MANIFEST.teams)) {
    const listed = teamsOf(MANIFEST, Number(year));
    const derived = teamsOf({ ...MANIFEST, teams: {} }, Number(year));
    assert.deepEqual(derived.map(t => JSON.stringify(t)).sort(), listed.map(t => JSON.stringify(t)).sort(), year);
  }
});

test('every season names its map; an era map serves only seasons of the same clubs; 2025/26 plays on today\'s', () => {
  const era = CLUB_MAPS.filter(entry => entry.sport === 'hockey' && entry.seasons);
  assert.equal(era.length, 31);
  for (const entry of MANIFEST.seasons) {
    const map = mapOf(MANIFEST, entry.year);
    assert.equal(seasonFile(entry.id).map, map);
    const listed = BUILT_IN_HOCKEY_SEASONS.find(s => s.id === entry.id);
    assert.equal(listed.map, map);
    if (map === 'nhl') continue;
    assert.ok(era.find(e => e.id === map).seasons.includes(entry.id), `${map} lists ${entry.id}`);
  }
  assert.equal(seasonFile('nhl-2026').map, 'nhl');
  assert.deepEqual(era.find(e => e.id === 'nhl2007').seasons, ['nhl-2007', 'nhl-2008', 'nhl-2009', 'nhl-2010', 'nhl-2011']);
  assert.deepEqual(era.find(e => e.id === 'nhl1968').seasons, ['nhl-1968', 'nhl-1969', 'nhl-1970']);
  // Defunct franchises rank after today's: the Seals' section comes last.
  const seals = decodeDomestic(mapFile('nhl1968'), 'nhl1968');
  assert.equal(seals.clubs.at(-1).id, 'nhl-oakland-seals');
  // The 1979/80 Whalers hold Massachusetts' west, Connecticut nobody's.
  const whalers = decodeDomestic(mapFile('nhl1980'), 'nhl1980');
  const at = point => whalers.geo.countries.find(section => pointInPolys(point, section.polys))?.id ?? null;
  assert.equal(at([-72.5869, 42.1022]), whalers.clubs.find(c => c.id === 'nhl-hartford-whalers').homeSection);
  assert.equal(at([-72.6769, 41.7683]), null, 'Hartford, Connecticut: nobody\'s in 1979/80');
});

// ---------- the loader ----------

test('the loader refuses a computed season without its rule, and a clubs-only season\'s nations', () => {
  const doc = seasonFile('nhl-1990');
  const broken = edit => { const copy = JSON.parse(JSON.stringify(doc)); edit(copy); return () => decodeFootballSet(copy, copy.id); };
  assert.doesNotThrow(broken(() => {}));
  assert.throws(broken(d => { delete d.source.conversion; }), /source conversion must say how the ratings were derived/);
  assert.throws(broken(d => { d.source.method = 'guessed'; }), /source method must be "computed" or "converted"/);
  const early = decodeFootballSet(seasonFile('nhl-1968'), 'nhl-1968');
  assert.deepEqual(early.rosters, {});
  assert.equal(setHasNations('nhl-1968'), false);
  assert.equal(setHasNations('nhl-1978'), true);
});

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearDomesticCache: ['src/engine/domestic.js', 'clearDomesticCache'],
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
  clearFootballSetIndex: ['src/engine/footballSets.js', 'clearFootballSetIndex'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

async function withApp(fn) {
  const fetch = async url => {
    const [, folder, id] = String(url).match(/^\/(domestic|hockey)\/([0-9A-Za-z-]+)\.json$/) || [];
    let text = null;
    try { text = folder && read(`public/${folder}/${id}.json`); } catch { text = null; }
    return text ? { ok: true, status: 200, json: async () => JSON.parse(text) } : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearDomesticCache();
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['840', '124', '484'],
    settings: { sport: 'hockey', layer: 'nations', scope: 'UEFA', clubScope: 'domestic:nhl', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn(f); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}

test('a 1967/68 clubs campaign plays the twelve clubs on the map of 1967/68 and resumes; it offers no nations', async () => {
  await withApp(async ({ app, time, items }) => {
    app.pickSetup('sport', 'hockey');
    app.pickSetup('dataSet', 'nhl-1968');
    assert.equal(app.state.setup.layer, 'clubs', 'a clubs-only season takes the clubs');
    assert.equal(app.state.setup.clubScope, 'domestic:nhl1968');
    time.advance(200);
    await Promise.all([app.loadCountry('nhl1968'), app.loadSet('nhl-1968')]);
    await settle();
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.dataSet, st.settings.dataSeason, st.settings.clubScope], ['nhl-1968', '1967/68', 'domestic:nhl1968']);
    assert.equal(Object.keys(st.teams).length, 12);
    assert.equal(st.teams['nhl-oakland-seals'].name, 'Oakland Seals');
    assert.equal(app.territoryName(st.teams['nhl-oakland-seals'].home), 'Oakland');
    assert.equal(JSON.stringify(parseCampaign(items.get(SAVE_KEY)).teams), JSON.stringify(st.teams));
  });
});

test('a 1985/86 nations campaign launches with the season\'s computed Swedes', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'hockey');
    app.pickSetup('scope', 'UEFA');
    app.pickSetup('dataSet', 'nhl-1986');
    assert.equal(app.state.setup.layer, 'nations');
    time.advance(200);
    await app.loadSet('nhl-1986');
    await settle();
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    const doc = seasonFile('nhl-1986');
    assert.deepEqual(st.teams['752'].squad.filter(p => !p.gen).map(p => [p.name, p.rating]), doc.nations['752'][2].map(([name, , rating]) => [name, rating]));
  });
});

test('a 2006/07 campaign saved on the map before it served 2007/08 to 2010/11 resumes on it', async () => {
  // The version nhl2007 had when it served 2006/07 alone (src/data/clubMaps.js at 06db6f6).
  const OLD = 'nhl2007-784f3771';
  assert.notEqual(CLUB_MAPS.find(entry => entry.id === 'nhl2007').version, OLD);
  await withApp(async ({ app, time, items }) => {
    app.pickSetup('sport', 'hockey');
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', 'nhl-2007');
    time.advance(200);
    await Promise.all([app.loadCountry('nhl2007'), app.loadSet('nhl-2007')]);
    await settle();
    app.startCampaign();
    const before = app.state;
    const saved = JSON.parse(items.get(SAVE_KEY));
    saved.settings.domesticVersion = OLD;
    if (saved.initialSettings) saved.initialSettings.domesticVersion = OLD;
    const old = parseCampaign(JSON.stringify(saved));
    assert.equal(old.settings.domesticVersion, OLD);
    // The map is loaded, so the save is fitted to it at once.
    let resumed = null;
    const outcome = app.withCampaignMap(old, (loaded, fitted) => { resumed = { loaded, fitted }; return true; });
    assert.notEqual(outcome, false, 'the old save fits the map that now serves more seasons');
    assert.deepEqual(Object.keys(resumed.fitted.teams).sort(), Object.keys(before.teams).sort());
    assert.deepEqual(resumed.fitted.own, before.own, 'every club keeps its land');
    app.restoreCampaign(resumed.fitted, resumed.loaded);
    assert.equal(app.state.phase, 'playing');
    assert.equal(app.state.settings.domesticVersion, CLUB_MAPS.find(entry => entry.id === 'nhl2007').version, 'it plays on with the map\'s new version');
    assert.deepEqual(app.state.own, before.own);
  });
});
