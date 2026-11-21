// The confederation levels of the computed football nations (docs/design/football-years.md, "Confederation levels";
// scripts/lib/confederation-levels.mjs): the table's rules, the fit on invented matches whose truth is known, the
// inter-confederation matches the Elo scores one step ahead, and the committed facts and seasons that carry them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NATIONS } from '../src/data/teams.js';
import { eloOn, expectedScore, resultRows } from './lib/football-elo.mjs';
import {
  confederationLevels, confederationResolver, interConfederationMatches, levelOf, levelled, levelledBest, levelsText, seasonEloWithLevels,
} from './lib/confederation-levels.mjs';
import { RESULTS_NAMES } from './lib/results-names.mjs';
import { strengthOf } from './lib/world-cup-seasons.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const json = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const TABLE = json('scripts/data/football-confederations.json');
const WORLD_CUP = json('scripts/data/world-cup-seasons.json');
const NATIONAL = json('scripts/data/national-team-seasons.json');
const FILLS = json('scripts/data/football-fills.json');
const CONFEDERATIONS = ['UEFA', 'CONMEBOL', 'CONCACAF', 'CAF', 'AFC', 'OFC'];
const OPTIONS = { years: 8, prior: 100, reference: 'UEFA', confederations: CONFEDERATIONS };

test('the table: a side\'s confederation by its list, or by the dated row that covers the day; none for the rest', () => {
  const men = confederationResolver(TABLE), women = confederationResolver(TABLE, { women: true });
  assert.deepEqual(TABLE.confederations, CONFEDERATIONS);
  assert.deepEqual([men('Brazil', '1970-06-21'), men('Zaire', '1974-06-22'), men('DR Congo', '1974-06-22'), men('Haiti', '1974-06-15')],
    ['CONMEBOL', null, 'CAF', 'CONCACAF'], 'the results\' own names: Zaire is DR Congo there');
  assert.deepEqual([men('Australia', '2005-12-31'), men('Australia', '2006-01-01')], ['OFC', 'AFC'], 'Australia joined the AFC in 2006');
  assert.deepEqual([men('Israel', '1974-07-01'), men('Israel', '1985-09-01')], ['AFC', 'UEFA']);
  assert.deepEqual([men('Taiwan', '1980-01-01'), women('Taiwan', '1980-01-01'), men('Taiwan', '1990-01-01')], ['OFC', 'AFC', 'AFC'],
    'Chinese Taipei\'s women played the Asian championships throughout');
  assert.deepEqual([men('Kazakhstan', '1990-01-01'), men('Kazakhstan', '1998-01-01'), men('Kazakhstan', '2002-04-25')], [null, 'AFC', 'UEFA']);
  assert.deepEqual([men('Ukraine', '1985-01-01'), men('Ukraine', '1992-04-29'), men('Estonia', '1938-01-01'), men('Estonia', '1960-01-01')],
    [null, 'UEFA', 'UEFA', null], 'the Soviet republics\' matches before 1992 count for none');
  assert.deepEqual([men('Basque Country', '1990-01-01'), men('Greenland', '2000-01-01'), men('Monaco', '2010-01-01')], [null, null, null]);
  // Today every map nation is in the confederation teams.js gives it.
  for (const [id, name] of Object.entries(RESULTS_NAMES)) assert.equal(men(name, '2026-10-06'), NATIONS[id][2], `${NATIONS[id][0]} (${name})`);
  assert.throws(() => confederationResolver({ ...TABLE, teams: { ...TABLE.teams, OFC: [...TABLE.teams.OFC, 'Brazil'] } }), /lists Brazil twice/);
  assert.throws(() => confederationResolver({ ...TABLE, dated: [...TABLE.dated, ['Australia', 'OFC', '2005-01-01', null]] }), /overlap/);
  assert.throws(() => confederationResolver({ ...TABLE, dated: [...TABLE.dated, ['Fiji', 'XYZ', null, null]] }), /is not \[team, confederation/);
});

// Invented matches whose truth is known: every match's result is its true expected score (a fraction, so the fit sees no
// noise); confederation B's sides play 120 Elo below their Elo, C's 40 above, A is the reference.
const invented = (offsets, perPair = 400) => {
  const out = [];
  const pairs = [['A', 'B'], ['A', 'C'], ['B', 'C']];
  for (let i = 0; i < perPair; i++) {
    for (const [a, b] of pairs) {
      const dr = ((i * 37) % 600) - 300;
      out.push({ date: `19${String(70 + (i % 10)).padStart(2, '0')}-0${1 + (i % 9)}-15`, dr, w: expectedScore(dr + offsets[a] - offsets[b]), a, b });
    }
  }
  return out;
};

test('the fit: the level each confederation\'s sides play at, the reference held at 0, shrunk toward 0 by the prior', () => {
  const matches = invented({ A: 0, B: -120, C: 40 });
  const loose = confederationLevels(matches, '1975-01-01', { years: 8, prior: 1e6, reference: 'A', confederations: ['A', 'B', 'C', 'D'] });
  const by = Object.fromEntries(loose.confederations.map(([c, level, se, n]) => [c, { level, se, n }]));
  assert.deepEqual([by.A.level, by.B.level, by.C.level], [0, -120, 40], 'recovered to the tenth');
  assert.deepEqual([by.D.level, by.D.se, by.D.n], [0, 1e6, 0], 'a confederation with no match keeps the prior\'s 0');
  assert.deepEqual([loose.from, loose.to, loose.matches], ['1967-01-01', '1983-01-01', 1200]);
  // A prior of 100 Elo shrinks a level more the fewer matches carry it.
  const level = (n, prior) => levelOf(confederationLevels(invented({ A: 0, B: -120, C: 40 }, n), '1975-01-01',
    { years: 8, prior, reference: 'A', confederations: ['A', 'B', 'C'] }), 'B');
  assert.ok(level(400, 100) > -120 && level(400, 100) < -110, `${level(400, 100)}`);
  assert.ok(level(10, 100) > level(400, 100), 'ten matches a pair move it less');
  // Only the window's matches count: [day − years, day + years).
  const late = confederationLevels(matches, '2000-01-01', { years: 8, prior: 100, reference: 'A', confederations: ['A', 'B', 'C'] });
  assert.deepEqual([late.matches, levelOf(late, 'B')], [0, 0]);
  assert.equal(levelsText(loose).split(', fitted')[0], 'A 0, B −120, C +40, D 0');
  assert.equal(levelled(1526.8, -58.4), 1468.4);
  assert.equal(levelOf(loose, null), null);
});

test('the matches between confederations, scored with the Elo from before each', () => {
  const row = (date, home, away, hs, as, tournament = 'Friendly', neutral = 'TRUE') => ({ date, home_team: home, away_team: away,
    home_score: String(hs), away_score: String(as), tournament, neutral });
  const matches = resultRows([
    row('1974-06-14', 'Brazil', 'Yugoslavia', 0, 0, 'FIFA World Cup'),
    row('1974-06-18', 'Zaire', 'Scotland', 0, 2, 'FIFA World Cup'),
    row('1974-06-18', 'DR Congo', 'Scotland', 0, 2, 'FIFA World Cup'),
    row('1974-06-22', 'Yugoslavia', 'DR Congo', 9, 0, 'FIFA World Cup'),
    row('1974-06-26', 'Basque Country', 'Brazil', 9, 0, 'Copa América'),
    row('1974-06-28', 'Basque Country', 'Zaire', 9, 0, 'Copa América'),
    row('1974-07-01', 'Scotland', 'Yugoslavia', 1, 1, 'FIFA World Cup'),
  ]);
  const table = confederationResolver(TABLE);
  const inter = interConfederationMatches(matches, WORLD_CUP.elo, table);
  assert.deepEqual(inter.map(m => [m.date, m.a, m.b, m.w]), [['1974-06-14', 'CONMEBOL', 'UEFA', 0.5], ['1974-06-18', 'CAF', 'UEFA', 0],
    ['1974-06-22', 'UEFA', 'CAF', 1]], 'a side with no confederation and a match inside one are left out');
  // dr is the gap of the Elo from before the match: Yugoslavia and DR Congo as they stood after 18 June.
  const before = eloOn(matches, ['1974-06-22'], WORLD_CUP.elo)['1974-06-22'].ratings;
  assert.ok(Math.abs(inter[2].dr - (before.get('Yugoslavia') - before.get('DR Congo'))) < 1e-9);
  // The best levelled Elo of the active sides: a side with no confederation is never the best, though the Basque
  // Country's two 9–0s put it first on its Elo.
  const snapshot = eloOn(matches, ['1975-01-01'], WORLD_CUP.elo)['1975-01-01'];
  const flat = { confederations: CONFEDERATIONS.map(c => [c, 0, 0, 0]) };
  const uefaDown = { confederations: CONFEDERATIONS.map(c => [c, c === 'UEFA' ? -300 : 0, 0, 0]) };
  const order = [...snapshot.ratings].sort((a, b) => b[1] - a[1]).map(([team]) => team);
  assert.equal(order[0], 'Basque Country');
  const topOfUefa = order.find(team => table(team, '1975-01-01') === 'UEFA');
  assert.equal(levelledBest(snapshot, '1974-01-01', '1975-01-01', flat, table).team, order.find(team => table(team, '1975-01-01')));
  assert.equal(levelledBest(snapshot, '1974-01-01', '1975-01-01', flat, table).team, topOfUefa);
  assert.equal(levelledBest(snapshot, '1974-01-01', '1975-01-01', uefaDown, table).team, 'Brazil', 'UEFA\'s sides 300 Elo down');
  const season = seasonEloWithLevels({ date: '1975-01-01', activeSince: '1974-01-01', best: {}, ratings: [['Brazil', 1500, 1], ['Basque Country', 1400, 2]] },
    { snapshot, inter, levels: { years: 8, prior: 100, reference: 'UEFA' }, confederations: CONFEDERATIONS, confederationOf: table });
  assert.deepEqual(season.ratings, [['Brazil', 1500, 1, 'CONMEBOL'], ['Basque Country', 1400, 2, null]]);
});

test('the computed men\'s seasons share the levels\' constants, and every season\'s facts carry them', () => {
  for (const manifest of [NATIONAL, FILLS]) {
    for (const key of ['table', 'reference', 'years', 'prior', 'rule']) assert.deepEqual(manifest.levels[key], WORLD_CUP.levels[key], key);
  }
  assert.deepEqual([WORLD_CUP.levels.reference, WORLD_CUP.levels.years, WORLD_CUP.levels.prior], ['UEFA', 8, 100]);
  const check = (id, elo) => {
    assert.deepEqual(elo.levels.confederations.map(([c]) => c), CONFEDERATIONS, id);
    assert.deepEqual(elo.levels.confederations[0].slice(0, 3), ['UEFA', 0, 0], `${id}: UEFA is the reference`);
    assert.ok(elo.levels.matches > 300, `${id} rests on ${elo.levels.matches} matches`);
    assert.ok(elo.levelledBest.elo <= elo.best.elo + Math.max(...elo.levels.confederations.map(([, level]) => level)) + 0.05, id);
  };
  for (const season of WORLD_CUP.seasons) {
    const facts = json(`scripts/data/world-cup-seasons/${season.id}.json`);
    check(season.id, facts.elo);
    for (const nation of facts.nations) assert.ok(CONFEDERATIONS.includes(nation.confederation), `${season.id} ${nation.team}`);
  }
  const ntElo = json('scripts/data/national-team-seasons/elo.json').seasons;
  for (const season of NATIONAL.seasons) {
    const elo = ntElo[season.id];
    check(season.id, elo);
    const levelledOf = ([, value, , c]) => (c ? levelled(value, levelOf(elo.levels, c)) : -Infinity);
    assert.equal(Math.max(...elo.ratings.map(levelledOf)), elo.levelledBest.elo, `${season.id}: the best levelled Elo is the table's`);
  }
  const fillElo = json('scripts/data/football-fills/elo.json').seasons;
  for (const season of FILLS.seasons) check(season.id, fillElo[season.id]);
});

test('the levels set the weaker confederations\' champions below the world\'s best, as their matches against it did', () => {
  // Every confederation but CONMEBOL sat above its results against UEFA's sides in every World Cup season.
  for (const season of WORLD_CUP.seasons) {
    const { levels } = json(`scripts/data/world-cup-seasons/${season.id}.json`).elo;
    for (const [c, level, se] of levels.confederations.filter(([c]) => ['CONCACAF', 'AFC', 'OFC'].includes(c))) {
      assert.ok(level < -2 * se, `${season.id}: ${c} ${level} ± ${se}`);
    }
  }
  const audit = json('docs/design/football-national-team-seasons-audit.json').seasons;
  const T = (id, name) => audit.find(s => s.id === id).nations.find(n => n.name === name);
  const rank = (id, name) => audit.find(s => s.id === id).nations.indexOf(T(id, name)) + 1;
  // Mexico, CONCACAF's champion, was seventh in the world in 1972/73 on its Elo alone; its results against the others put it 20th.
  assert.equal(rank('nt-1973', 'Mexico'), 20);
  assert.ok(T('nt-1973', 'Mexico').T < T('nt-1973', 'Italy').T - 5);
  // Each finalist's T reads its levelled Elo off the line.
  const worldCupAudit = json('docs/design/football-world-cup-seasons-audit.json').seasons;
  for (const season of WORLD_CUP.seasons) {
    const facts = json(`scripts/data/world-cup-seasons/${season.id}.json`);
    for (const nation of facts.nations) {
      const value = levelled(nation.elo, levelOf(facts.elo.levels, nation.confederation));
      const entry = worldCupAudit.find(s => s.id === season.id).nations.find(n => n.team === nation.team);
      assert.equal(entry.T, Math.round(strengthOf(value, facts.elo.levelledBest.elo, WORLD_CUP.strength) * 100) / 100, `${season.id} ${nation.team}`);
    }
  }
});
