// The club strengths an earlier season's Europe maps are drawn by (scripts/lib/club-strength.mjs,
// scripts/build-club-strength.mjs): standings within a league, league levels from the European cups, and the committed
// scripts/data/club-strength.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { STRENGTH_RULES, clubStrengths, fitLevels, leagueStandings, seasonDates, seasonOfDate, strengthGames } from './lib/club-strength.mjs';
import { FIRST_SEASON, KEPT, LAST_SEASON, RESULT_COUNTRIES, serializeStrengths, strengthDocument } from './build-club-strength.mjs';
import { NATIONS } from '../src/data/teams.js';
import { readParquet } from './lib/parquet.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RULES = { ...STRENGTH_RULES, iterations: 400 };

/** A game row as the results file has it, its date and clubs given; `country` names both clubs' countries. */
const row = (date, home, away, gh, ga, { cup = null, homeCountry, awayCountry = homeCountry, shootout = false } = {}) => ({
  date, home, away, gh, ga, full_time: shootout ? 'P' : 'F', competition: cup ?? homeCountry, home_country: homeCountry,
  away_country: awayCountry, home_continent: 'Europe', away_continent: 'Europe', level: cup ? 'international' : 'national',
});
/** A double round robin of `clubs` in `country`'s league, from `start` a week apart, `beat(a, b)` the home side's goals. */
function league(country, clubs, start, beat) {
  const rows = [];
  let day = Date.parse(start);
  for (const home of clubs) for (const away of clubs) {
    if (home === away) continue;
    const date = new Date(day).toISOString().slice(0, 10);
    const [gh, ga] = beat(home, away);
    rows.push(row(date, home, away, gh, ga, { homeCountry: country }));
    day += 7 * 86400000;
  }
  return rows;
}
const ranked = (clubs, order) => (home, away) => (order.indexOf(home) < order.indexOf(away) ? [2, 0] : [0, 1]);

test('seasons run July to June, and a season samples the 1st and 15th from August to May', () => {
  assert.equal(seasonOfDate('2009-07-01'), 2010);
  assert.equal(seasonOfDate('2010-06-30'), 2010);
  const dates = seasonDates(2010);
  assert.equal(dates.length, 20);
  assert.deepEqual([dates[0], dates.at(-1)], ['2009-08-01', '2010-05-15']);
});

test('a league slip, a game before the first date and a scoreless row are left out; cups and league games stay', () => {
  const games = strengthGames([
    row('2001-01-01', 'A (x)', 'B (x)', 1, 0, { homeCountry: 'x' }),
    { ...row('2001-01-02', 'C (y)', 'D (y)', 1, 0, { homeCountry: 'y' }), competition: 'z' },
    row('1950-01-01', 'A (x)', 'B (x)', 1, 0, { homeCountry: 'x' }),
    { ...row('2001-01-03', 'A (x)', 'B (x)', 1, 0, { homeCountry: 'x' }), gh: null },
    row('2001-01-04', 'A (x)', 'C (y)', 1, 1, { cup: 'UEFA CL', homeCountry: 'x', awayCountry: 'y' }),
    row('2001-01-05', 'A (x)', 'C (y)', 1, 1, { cup: 'Copa Lib', homeCountry: 'x', awayCountry: 'y' }),
  ]);
  assert.deepEqual(games.map(game => [game.date, game.league]), [['2001-01-01', 'x'], ['2001-01-04', null]]);
});

test('a league\'s standings: its winners above its mean, a promoted club starting at the relegated clubs\' rating', () => {
  const first = ['A (x)', 'B (x)', 'C (x)', 'D (x)'];
  const second = ['A (x)', 'B (x)', 'C (x)', 'E (x)'];
  const rows = [...league('x', first, '2001-08-01', ranked(first, first)), ...league('x', second, '2002-08-01', ranked(second, second))];
  const standings = leagueStandings(strengthGames(rows), RULES);
  const end = '2002-07-01';
  assert.ok(standings.standing('A (x)', end) > 50 && standings.standing('D (x)', end) < -50);
  // E came up when D went down: E starts at D's rating, the league's mean unchanged, so E's standing then is D's.
  const lastOfFirst = '2002-07-31';
  assert.equal(standings.standing('E (x)', lastOfFirst), 0, 'no standing before its first game');
  const sum = first.reduce((s, club) => s + standings.standing(club, end), 0);
  assert.ok(Math.abs(sum) < 1e-9, 'standings sum to nothing across a league season');
  assert.equal(standings.leagueOf('A (x)', end), 'x');
  assert.equal(standings.leagueOf('A (x)', '2010-01-01'), null, 'nothing 400 days after the last game');
});

test('league levels come from the cups: a league whose clubs win in Europe ranks above, its standings below it', () => {
  const strong = ['S1 (s)', 'S2 (s)', 'S3 (s)', 'S4 (s)'], weak = ['W1 (w)', 'W2 (w)', 'W3 (w)', 'W4 (w)'];
  const rows = [];
  for (const year of [2001, 2002, 2003]) {
    rows.push(...league('s', strong, `${year}-08-01`, ranked(strong, strong)), ...league('w', weak, `${year}-08-01`, ranked(weak, weak)));
    // Each weak club meets each strong one in the cup in October: the strong side wins, but W1 holds S4 at home.
    let day = Date.parse(`${year}-10-01`);
    for (const w of weak) for (const s of strong) {
      const date = new Date(day += 86400000).toISOString().slice(0, 10);
      const draw = w === 'W1 (w)' && s === 'S4 (s)';
      rows.push(row(date, w, s, draw ? 1 : 0, draw ? 1 : 2, { cup: 'UEFA EL', homeCountry: 'w', awayCountry: 's' }));
    }
  }
  const { seasons, level } = clubStrengths(rows, [2002, 2003], RULES);
  assert.ok(level('s', 2002) > level('w', 2002) + 100, `s ${level('s', 2002)} against w ${level('w', 2002)}`);
  const order = seasons[2003].map(entry => entry.club);
  assert.deepEqual(order.slice(0, 4), strong, 'every strong club above every weak one');
  assert.equal(order[4], 'W1 (w)', 'the weak league\'s best next');
  assert.ok(seasons[2003].every(entry => Number.isFinite(entry.strength)));
});

test('a club with no league game in the season is not ranked, and the same rows give the same numbers', () => {
  const clubs = ['A (x)', 'B (x)'];
  const rows = [...league('x', clubs, '2001-09-01', ranked(clubs, clubs)), row('2001-10-10', 'A (x)', 'B (x)', 1, 0, { cup: 'UEFA CL', homeCountry: 'x' })];
  const once = clubStrengths(rows, [2002, 2005], RULES), again = clubStrengths(rows, [2002, 2005], RULES);
  assert.deepEqual(once.seasons, again.seasons);
  assert.equal(once.seasons[2002].length, 2);
  assert.equal(once.seasons[2005].length, 0, 'no league games in 2004/05');
  const standings = leagueStandings(strengthGames(rows), RULES);
  assert.ok(fitLevels(strengthGames(rows), standings, RULES).games === 1);
});

test('the committed strengths: every season from 1993/94 to 2025/26, its clubs on map shapes, strongest first', () => {
  const doc = JSON.parse(readFileSync(path.join(root, 'scripts/data/club-strength.json'), 'utf8'));
  assert.deepEqual(Object.keys(doc.seasons).map(Number), Array.from({ length: LAST_SEASON - FIRST_SEASON + 1 }, (_, i) => FIRST_SEASON + i));
  for (const [season, clubs] of Object.entries(doc.seasons)) {
    assert.equal(clubs.length, KEPT, `${season} keeps ${KEPT}`);
    assert.equal(new Set(clubs.map(([club]) => club)).size, clubs.length, `${season} lists each club once`);
    clubs.forEach(([club, shape, strength, league, ...rest], i) => {
      assert.ok(/^\S.* \([^()]+\)$/.test(club), `${season}: ${club} is a results ident, "Name (Country)"`);
      assert.ok(Object.hasOwn(NATIONS, shape) && Object.values(RESULT_COUNTRIES).includes(shape), `${season}: ${club} on shape ${shape}`);
      assert.ok(Number.isInteger(strength) && (i === 0 || clubs[i - 1][2] >= strength), `${season}: ${club} in strength order`);
      assert.ok(league === undefined || (league !== shape && Object.values(RESULT_COUNTRIES).includes(league)), `${season}: ${club}'s league shape`);
      assert.equal(rest.length, 0);
    });
  }
  assert.ok(/Open Data Commons Attribution/.test(doc.source.licence) && /^[0-9a-f]{40}$/.test(doc.source.commit));
});

// The rebuild needs the pinned results file, which only a machine that fetched it has (data-src/ is not in git).
const resultsFile = path.join(root, 'data-src/football-results/games.parquet');
test('the committed strengths rebuild byte for byte from the pinned results', { skip: !existsSync(resultsFile) && 'no data-src/football-results/' }, () => {
  const committed = readFileSync(path.join(root, 'scripts/data/club-strength.json'), 'utf8').replace(/\r\n/g, '\n');
  const { source } = JSON.parse(committed);
  const rows = readParquet(new Uint8Array(readFileSync(resultsFile)), { columns: ['date', 'gh', 'ga', 'full_time', 'competition', 'home_ident',
    'away_ident', 'home_country', 'away_country', 'home_continent', 'away_continent', 'level'] })
    .map(r => ({ ...r, home: r.home_ident, away: r.away_ident, date: new Date(r.date * 86400000).toISOString().slice(0, 10) }));
  const { lastGame, ...pinned } = source;
  assert.equal(serializeStrengths(strengthDocument(rows, pinned)), committed);
});
