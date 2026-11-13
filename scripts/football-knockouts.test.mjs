// Football's knockout rules by season (src/sports/football.js knockoutIn, footballIn): a level ninety goes to extra time in
// every season, then to the drawing of lots to 1969/70, the golden goal from 1995/96 to 2001/02, the silver goal in
// 2002/03 and 2003/04, and penalties otherwise (docs/design/match-simulation.md, "Knockout rules by era"); the live chart
// and the copy follow them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/data/teams.js';
import { BUILT_IN_SEASONS } from '../src/data/footballSeasons.js';
import { BUILT_IN_WOMENS_SEASONS } from '../src/data/womensFootballSeasons.js';
import { football, footballIn, knockoutIn } from '../src/sports/football.js';
import { womensFootball } from '../src/sports/womensFootball.js';
import { basketball } from '../src/sports/basketball.js';
import { finishLabel, matchSport, settledShort, settledText, shootoutOf } from '../src/sports/index.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import { liveModelFor, winProbabilityAt, winSeries } from '../src/engine/winProbability.js';

const side = (id, rating) => ({ id, name: id, sport: 'football', squad: football.positionPlan.map((pos, i) => ({ name: `${id}-${i}`, pos, rating })) });
const RULES = { lots: [1962, 1966, 1970], penalties: [1971, 1974, 1990, 1994, 1995, 2005, 2026, 2027], golden: [1996, 1998, 2002],
  silver: [2003, 2004] };
const rulesOf = sport => sport.prepareMatch(side('A', 75), side('D', 75), 75, 75).rules.id;

test('each season plays the knockout rules of its day', () => {
  for (const [id, years] of Object.entries(RULES)) {
    for (const year of years) assert.equal(knockoutIn(year).id, id, `${year}`);
  }
  for (const today of [null, undefined, NaN, '1966']) assert.equal(knockoutIn(today).id, 'penalties', `${today}: today's rules`);
  // Every built-in season, through matchSport as a setup or campaign asks for it; today's object for today's rules.
  const expected = year => (year <= 1970 ? 'lots' : year >= 1996 && year <= 2002 ? 'golden' : year === 2003 || year === 2004 ? 'silver' : 'penalties');
  for (const season of BUILT_IN_SEASONS) {
    const settings = { sport: 'football', layer: 'nations', dataSet: season.id, dataYear: season.year, dataSeason: season.season };
    const sport = matchSport(settings);
    assert.equal(rulesOf(sport), expected(season.year), `${season.id} (${season.season})`);
    assert.equal(matchSport({ ...settings }), sport, 'one object per set of rules');
    if (expected(season.year) === 'penalties') assert.equal(sport, football);
    assert.equal(sport.id, 'football');
  }
  // The World Cups to 1970 and the computed national-team seasons between them (scripts/football-national-team-seasons.test.mjs).
  assert.deepEqual(BUILT_IN_SEASONS.filter(season => expected(season.year) === 'lots').map(season => season.id),
    ['wc-1970', 'nt-1969', 'nt-1968', 'nt-1967', 'wc-1966', 'nt-1965', 'nt-1964', 'nt-1963', 'wc-1962']);
  // 2003/04 (Sawczuk's database) and 2002/03: UEFA's silver goal.
  assert.deepEqual(BUILT_IN_SEASONS.filter(season => expected(season.year) === 'silver').map(season => season.id), ['cm0102-2003-10', 'cm0102-2002-11']);
  assert.equal(matchSport({ sport: 'football' }), football, 'the built-in season plays today\'s rules');
  assert.equal(matchSport({ sport: 'football', dataYear: 1966 }), football, 'a year without its data set is not a season');
  // Women's football: every season, 2015/16 on, extra time then penalties.
  for (const season of BUILT_IN_WOMENS_SEASONS) {
    const sport = matchSport({ sport: 'womens-football', dataSet: season.id, dataYear: season.year, dataSeason: season.season });
    assert.equal(sport, womensFootball, season.id);
  }
  assert.equal(rulesOf(womensFootball), 'penalties');
  assert.equal(womensFootball.rulesFor, undefined);
});

/** `count` full matches between sides rated `ratingA` and `ratingD` under `sport`, the level ones only. */
function levelGames(sport, count, ratingA = 76, ratingD = 74, seed = 5) {
  const a = side('A', ratingA), d = side('D', ratingD);
  const rng = makeRng(seed);
  const games = [];
  for (let i = 0; i < count; i++) {
    const result = sport.simulate(rng, a, d, 6, ratingA, ratingD);
    if (result.tie) games.push(result);
  }
  return games;
}

const goalsIn = (result, side, from, to) => result.ev.filter(e => e.tid === side && e.m > from && e.m <= to).length;

test('a level ninety goes to extra time in every season, each half\'s goals in its own fifteen minutes', () => {
  for (const year of [1966, 1990, 1998, 2004, null]) {
    const games = levelGames(footballIn(year), 3000);
    assert.ok(games.length > 500, `${year}: enough level games`);
    for (const result of games) {
      assert.equal(result.regA, result.regD, 'extra time only after a level ninety');
      assert.equal(goalsIn(result, 'A', 0, 90), result.regA);
      assert.equal(goalsIn(result, 'D', 0, 90), result.regD);
      assert.ok(result.tie.end > 90 && result.tie.end <= 120, `${result.tie.end}`);
      assert.ok(result.ev.every(e => e.m <= result.tie.end), 'nothing after the end of play');
      assert.equal(result.ga - result.regA, goalsIn(result, 'A', 90, 120));
      assert.equal(result.gd - result.regD, goalsIn(result, 'D', 90, 120));
      assert.equal(result.tie.periods.reduce((sum, [a]) => sum + a, 0), result.ga - result.regA);
      assert.equal(result.tie.periods.reduce((sum, [, d]) => sum + d, 0), result.gd - result.regD);
      const kicks = shootoutOf(football, result.tie);
      if (result.ga !== result.gd) {
        assert.ok(['extra-time', 'golden-goal', 'silver-goal'].includes(result.tie.by), result.tie.by);
        assert.equal(kicks, null);
        assert.deepEqual([result.tie.A, result.tie.D, result.tie.ga, result.tie.gd], [[], [], 0, 0]);
        assert.equal(result.winner, result.ga > result.gd ? 'A' : 'D');
      } else {
        assert.equal(result.tie.end, 120, 'a level extra time is played to its end');
        assert.equal(result.tie.by, year === 1966 ? 'lots' : 'penalties');
      }
    }
  }
});

test('to 1969/70 a game still level after extra time is settled by the drawing of lots: a coin toss, even', () => {
  const games = levelGames(footballIn(1966), 20000, 84, 66, 7);
  const lots = games.filter(result => result.tie.by === 'lots');
  assert.ok(lots.length > 400 && games.some(result => result.tie.by === 'extra-time'));
  for (const result of lots) {
    assert.equal(result.ga, result.gd);
    assert.deepEqual([result.tie.A, result.tie.D], [[], []], 'no kicks');
    assert.ok(result.tie.lots === 'A' || result.tie.lots === 'D');
    assert.equal(result.winner, result.tie.lots);
  }
  // The stronger side wins its level games more often in extra time, but the lots are even whoever the stronger is.
  const won = lots.filter(result => result.winner === 'A').length / lots.length;
  assert.ok(Math.abs(won - 0.5) < 0.05, `the stronger side won ${won} of the lots`);
  assert.ok(games.every(result => result.tie.by !== 'penalties'), 'no penalties before 1970/71');
});

test('the golden goal ends extra time at its minute; the silver goal at extra time\'s half-time', () => {
  const golden = levelGames(footballIn(1998), 4000);
  const decided = golden.filter(result => result.tie.by === 'golden-goal');
  assert.ok(decided.length > 100 && golden.some(result => result.tie.by === 'penalties'));
  for (const result of decided) {
    const last = result.ev.at(-1);
    assert.equal(Math.abs(result.ga - result.gd), 1, 'one goal in extra time');
    assert.equal(last.m, result.tie.end, 'the golden goal is the last event, at the minute play ended');
    assert.equal(last.kind, 'golden');
    assert.equal(football.formatEvent(last, 'ITA').text, `GOLDEN GOAL — ${last.name} (ITA)`);
    assert.equal(football.formatToast(last), `${last.m}' GOLDEN GOAL — ${last.name.toUpperCase()}`);
    assert.equal(result.winner, last.tid);
    assert.equal(result.tie.periods.length, result.tie.end <= 105 ? 1 : 2);
  }
  assert.ok(decided.some(result => result.tie.end <= 105) && decided.some(result => result.tie.end > 105), 'in either half');
  for (const result of golden.filter(r => r.tie.by === 'penalties')) assert.deepEqual(result.tie.periods, [[0, 0], [0, 0]]);

  const silver = levelGames(footballIn(2004), 4000);
  const early = silver.filter(result => result.tie.by === 'silver-goal');
  assert.ok(early.length > 100 && silver.some(result => result.tie.by === 'extra-time') && silver.some(result => result.tie.by === 'penalties'));
  for (const result of early) {
    assert.equal(result.tie.end, 105);
    assert.equal(result.tie.periods.length, 1);
    assert.notEqual(result.tie.periods[0][0], result.tie.periods[0][1], 'ahead at extra time\'s half-time');
    assert.ok(result.ev.every(e => e.m <= 105));
  }
  for (const result of silver.filter(r => r.tie.by !== 'silver-goal')) {
    assert.equal(result.tie.end, 120);
    assert.equal(result.tie.periods[0][0], result.tie.periods[0][1], 'level at extra time\'s half-time, so its second half was played');
  }
});

test('the live chart follows extra time and the rules of the season\'s day', () => {
  const a = side('A', 79), d = side('D', 74);
  const plain = liveModelFor(football, a, d, 79, 74, 6);
  const golden = liveModelFor(footballIn(1998), a, d, 79, 74, 6);
  const silver = liveModelFor(footballIn(2004), a, d, 79, 74, 6);
  const lots = liveModelFor(footballIn(1966), a, d, 79, 74, 6);
  assert.equal(plain.sudden, undefined);
  assert.equal(golden.sudden, 'golden');
  assert.equal(silver.sudden, 'silver');
  assert.deepEqual(lots, plain, 'lots and penalties are both 50/50 on the chart');
  // Level at 90': the stronger side's chance through extra time; the golden goal favours it a little less (no comeback).
  for (const model of [plain, golden, silver]) {
    const level = winProbabilityAt(model, 90, 0);
    assert.ok(level > 0.55 && level < 0.75, `${model.sudden}: ${level}`);
    assert.equal(winProbabilityAt(model, 120, 0), 0.5, 'level at 120\': the tie-break');
  }
  // A lead in extra time: the golden goal has won; the silver goal's has at half-time; the plain one can be levelled.
  assert.equal(winProbabilityAt(golden, 100, 1), 1);
  assert.equal(winProbabilityAt(golden, 100, -1), 0);
  assert.equal(winProbabilityAt(silver, 105, -1), 0);
  assert.ok(winProbabilityAt(silver, 100, 1) < 1 && winProbabilityAt(silver, 100, 1) > winProbabilityAt(plain, 100, 1));
  assert.ok(winProbabilityAt(plain, 100, 1) < 1 && winProbabilityAt(plain, 119, 1) > winProbabilityAt(plain, 100, 1));
  assert.equal(winProbabilityAt(plain, 120, -1), 0);
  // The silver goal reads the score at extra time's half-time: level then, a lead in the second half is not yet a win.
  const goals = [{ m: 30, tid: 'A', pts: 1 }, { m: 60, tid: 'D', pts: 1 }, { m: 112, tid: 'A', pts: 1 }];
  const series = winSeries({ model: silver, goals, aId: 'A', dId: 'D', minute: 115 });
  assert.equal(series.length, 116);
  assert.ok(series[115].p < 1 && series[115].p > series[105].p);
  const ahead = winSeries({ model: silver, goals: goals.slice(0, 2).concat([{ m: 98, tid: 'D', pts: 1 }]), aId: 'A', dId: 'D', minute: 105 });
  assert.equal(ahead.at(-1).p, 0, 'behind at extra time\'s half-time under the silver goal');
});

test('the chance through extra time is its formula, and matches the simulated level games', () => {
  // Written out independently: [A ahead, level] after `minutes` at the rates a and d a ninety minutes.
  const pois = (lambda, n) => { let p = Math.exp(-lambda); for (let i = 1; i <= n; i++) p *= lambda / i; return p; };
  const after = (a, d, minutes) => {
    let ahead = 0, level = 0;
    for (let i = 0; i <= 30; i++) {
      for (let j = 0; j <= 30; j++) {
        const q = pois(a * minutes / 90, i) * pois(d * minutes / 90, j);
        if (i > j) ahead += q; else if (i === j) level += q;
      }
    }
    return [ahead, level];
  };
  for (const year of [null, 1998, 2004]) {
    const sport = footballIn(year);
    const model = liveModelFor(sport, side('A', 80), side('D', 73), 80, 73, 6);
    const a = model.rA * model.extra, d = model.rD * model.extra;
    let win, level;
    if (model.sudden === 'golden') {
      level = Math.exp(-(a + d) * 30 / 90);
      win = (1 - level) * a / (a + d);
    } else if (model.sudden === 'silver') {
      const [w1, l1] = after(a, d, 15), [w2, l2] = after(a, d, 15);
      [win, level] = [w1 + l1 * w2, l1 * l2];
    } else [win, level] = after(a, d, 30);
    const chance = winProbabilityAt(model, 90, 0);
    assert.ok(Math.abs(chance - (win + level / 2)) < 1e-9, `${year}: ${chance} against ${win + level / 2}`);
    // The README formula leaves out match-day form and tempo, as in the ninety, and takes the shoot-out as 50/50: with
    // the simulated shoot-outs' own share in its place, it sits within three points of the level games the attacker won.
    const games = levelGames(sport, 30000, 80, 73, 11);
    const shootouts = games.filter(result => result.tie.by === 'penalties');
    const kicks = shootouts.filter(result => result.winner === 'A').length / shootouts.length;
    const won = games.filter(result => result.winner === 'A').length / games.length;
    assert.ok(Math.abs(win + level * kicks - won) < 0.03, `${year}: chart ${win + level * kicks}, simulated ${won} over ${games.length}`);
  }
  // The pre-match odds sample each season's own rules (sampleResult reads them from the prepared match).
  const odds = year => estimateWinProbability({ sport: footballIn(year), attacker: side('A', 80), defender: side('D', 73), samples: 20000 }).attacker;
  assert.ok(odds(null) > 0.6 && odds(1966) > 0.6 && odds(1998) > 0.6);
});

test('the copy says how a level game was settled', () => {
  const tie = (by, extra = {}) => ({ by, periods: [[0, 0], [0, 0]], end: 120, A: [], D: [], ga: 0, gd: 0, ...extra });
  const cases = [
    [tie('extra-time'), 'after extra time', 'AET'],
    [tie('golden-goal', { end: 97, periods: [[1, 0]] }), 'after a golden goal in extra time', 'GOLDEN GOAL'],
    [tie('silver-goal', { end: 105, periods: [[0, 1]] }), 'after a silver goal in extra time', 'SILVER GOAL'],
    [tie('lots', { lots: 'D' }), 'after extra time, on the drawing of lots', 'LOTS'],
    [tie('penalties', { A: [1, 1, 1, 1], D: [1, 0, 1, 0], ga: 4, gd: 2, first: 'A' }), '4–2 on penalties', '4–2 PENS'],
    // A tie saved before extra time came in went straight to penalties.
    [{ A: [1, 0, 1, 1, 1], D: [1, 1, 0, 1, 0], ga: 4, gd: 3, first: 'D' }, '4–3 on penalties', '4–3 PENS'],
  ];
  for (const [settled, text, short] of cases) {
    assert.equal(settledText(football, settled), text);
    assert.equal(settledShort(football, settled), short);
    assert.equal(settledText(footballIn(1966), settled), text, 'every season says it the same way');
    const kicks = settled.by === undefined || settled.by === 'penalties';
    assert.equal(shootoutOf(football, settled), kicks ? settled : null);
    assert.equal(finishLabel(football, settled), kicks ? 'PENALTIES' : 'FULL TIME');
  }
  assert.equal(finishLabel(football, null), 'FULL TIME');
  const overtime = { periods: [[10, 8]], ga: 99, gd: 97 };
  assert.equal(shootoutOf(basketball, overtime), null);
  assert.equal(finishLabel(basketball, overtime), 'OVERTIME');
  assert.equal(settledText(basketball, overtime), 'after 1 overtime period');
  assert.equal(settledShort(basketball, overtime), 'OT');
  // The feed's time left runs on into extra time.
  assert.equal(football.clockLeft(12, 90), '78 minutes left');
  assert.equal(football.clockLeft(89, 90), '1 minute left');
  assert.equal(football.clockLeft(90, 90), 'final minute');
  assert.equal(football.clockLeft(95, 90), 'extra time, 25 minutes left');
  assert.equal(football.clockLeft(119, 90), 'extra time, 1 minute left');
  assert.equal(football.clockLeft(120, 90), 'extra time, final minute');
  assert.equal(football.words.overtime, 'Extra time');
  assert.equal(football.clock.ot, 15);
  assert.match(football.blurb, /extra time, then penalties/);
  assert.match(womensFootball.blurb, /extra time, then penalties/);
});
