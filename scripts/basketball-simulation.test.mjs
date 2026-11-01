import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildClub, makeRng } from '../src/data/teams.js';
import { BUILT_IN_BASKETBALL_SEASONS } from '../src/data/basketballSeasons.js';
import { LATEST_NBA_SEASON, NBA_LEAGUE_AVERAGES } from '../src/data/nbaLeagueAverages.js';
import { basketball, nbaBasketball, nbaBasketballIn } from '../src/sports/basketball.js';
import { matchSport } from '../src/sports/index.js';

const side = (id, ratings = 74) => ({
  id,
  sport: 'basketball',
  squad: basketball.positionPlan.map((pos, i) => ({ name: `${id}-${pos}`, pos, rating: Array.isArray(ratings) ? ratings[i] : ratings })),
});

test('basketball presentation uses exactly the score-only outcome and selected scorers', () => {
  const attacker = side('A', 79);
  const defender = side('D', 74);
  attacker.squad.push({ name: 'Unused reserve', pos: 'PG', rating: 40 });
  const prepared = basketball.prepareMatch(attacker, defender);
  const namesA = new Set(prepared.lineupA.starters.map(player => player.name));
  const namesD = new Set(prepared.lineupD.starters.map(player => player.name));
  let overtimes = 0;
  for (let seed = 0; seed < 1000; seed++) {
    const outcome = basketball.sampleResult(makeRng(seed), prepared, 6);
    const full = basketball.simulate(makeRng(seed), attacker, defender, 6);
    assert.deepEqual({ ga: full.ga, gd: full.gd, tie: full.tie, winner: full.winner }, {
      ga: outcome.ga, gd: outcome.gd, tie: outcome.tie, winner: outcome.winner,
    });
    assert.equal(full.ev.filter(event => event.tid === 'A').reduce((sum, event) => sum + event.pts, 0), full.ga);
    assert.equal(full.ev.filter(event => event.tid === 'D').reduce((sum, event) => sum + event.pts, 0), full.gd);
    assert.ok(full.ev.every((event, i) => Number.isInteger(event.m) && event.m > 0 && event.pts > 0
      && (event.tid === 'A' ? namesA : namesD).has(event.name) && (!i || full.ev[i - 1].m <= event.m)));
    assert.equal(full.ev.filter(event => event.m <= 40 && event.tid === 'A').reduce((sum, event) => sum + event.pts, 0), outcome.regA);
    assert.equal(full.ev.filter(event => event.m <= 40 && event.tid === 'D').reduce((sum, event) => sum + event.pts, 0), outcome.regD);
    if (full.tie) {
      overtimes++;
      assert.equal(outcome.regA, outcome.regD);
      assert.equal(full.tie.ga, full.ga);
      assert.equal(full.tie.gd, full.gd);
      full.tie.periods.forEach(([a, d], period) => {
        const periodEvents = full.ev.filter(event => event.m > 40 + period * 5 && event.m <= 45 + period * 5);
        assert.equal(periodEvents.filter(event => event.tid === 'A').reduce((sum, event) => sum + event.pts, 0), a);
        assert.equal(periodEvents.filter(event => event.tid === 'D').reduce((sum, event) => sum + event.pts, 0), d);
        if (period < full.tie.periods.length - 1) assert.equal(a, d);
      });
    } else assert.ok(full.ev.every(event => event.m <= 40));
    assert.notEqual(full.ga, full.gd);
    assert.equal(full.winner, full.ga > full.gd ? 'A' : 'D');
  }
  assert.ok(overtimes > 0, 'the fixture seeds must exercise overtime accounting');
});

test('four tied overtimes end with recorded points and either side can win the fallback', () => {
  const attacker = side('A');
  const defender = side('D');
  for (const [choice, winner] of [[0.1, 'A'], [0.9, 'D']]) {
    let draws = 0;
    const rng = () => draws++ === 36 ? choice : 0;
    const result = basketball.simulate(rng, attacker, defender, 0);
    assert.equal(result.winner, winner);
    assert.equal(result.tie.periods.length, 4);
    assert.deepEqual(result.tie.periods.slice(0, 3), [[10, 10], [10, 10], [10, 10]]);
    assert.deepEqual(result.tie.periods[3], winner === 'A' ? [11, 10] : [10, 11]);
    assert.equal(result.ga - result.tie.periods.reduce((sum, period) => sum + period[0], 0), 81);
    assert.equal(result.gd - result.tie.periods.reduce((sum, period) => sum + period[1], 0), 81);
    assert.equal(result.ev.filter(event => event.tid === 'A').reduce((sum, event) => sum + event.pts, 0), result.ga);
    assert.equal(result.ev.filter(event => event.tid === 'D').reduce((sum, event) => sum + event.pts, 0), result.gd);
    assert.ok(result.ev.every(event => event.m <= 60));
    assert.ok(draws < 1000, 'an adversarial random stream must still finish promptly');
  }
});

test('basketball ratings reflect positional offence and rim protection', () => {
  const neutral = side('D');
  const guards = basketball.prepareMatch(side('A', [90, 90, 70, 60, 60]), neutral);
  const bigs = basketball.prepareMatch(side('A', [60, 60, 70, 90, 90]), neutral);
  assert.equal(guards.lineupA.rating, bigs.lineupA.rating);
  assert.ok(guards.efficiencyA > bigs.efficiencyA, 'strong guards improve scoring efficiency');
  assert.ok(bigs.efficiencyD < guards.efficiencyD, 'strong bigs reduce opposing scoring efficiency');
});

test('matched basketball teams have varied plausible scores, shared pace and fair winners', () => {
  const prepared = basketball.prepareMatch(side('A'), side('D'));
  const rng = makeRng(20261002);
  const count = 30000;
  let a = 0, d = 0, a2 = 0, d2 = 0, ad = 0, margin2 = 0, wins = 0, overtime = 0;
  const scorelines = new Set();
  for (let i = 0; i < count; i++) {
    const result = basketball.sampleResult(rng, prepared, 6);
    a += result.regA;
    d += result.regD;
    a2 += result.regA ** 2;
    d2 += result.regD ** 2;
    ad += result.regA * result.regD;
    margin2 += (result.regA - result.regD) ** 2;
    wins += result.winner === 'A';
    overtime += !!result.tie;
    scorelines.add(`${result.ga}:${result.gd}`);
  }
  const meanA = a / count;
  const meanD = d / count;
  const correlation = (ad / count - meanA * meanD)
    / Math.sqrt((a2 / count - meanA ** 2) * (d2 / count - meanD ** 2));
  assert.ok(meanA > 78 && meanA < 84 && meanD > 78 && meanD < 84);
  assert.ok(wins / count > 0.48 && wins / count < 0.52);
  assert.ok(Math.sqrt(margin2 / count) > 14 && Math.sqrt(margin2 / count) < 18);
  assert.ok(correlation > 0.08 && correlation < 0.4, 'both teams share pace without sharing shooting luck');
  assert.ok(overtime / count > 0.015 && overtime / count < 0.045);
  assert.ok(scorelines.size > 2000);
});

test('club campaigns play NBA rules at their season\'s pace, nation campaigns FIBA rules', () => {
  assert.equal(matchSport({ sport: 'basketball', layer: 'clubs' }), nbaBasketball);
  // A season campaign plays its own season; one without league averages (the built-in 2026/27) the latest full one.
  assert.equal(matchSport({ sport: 'basketball', layer: 'clubs', dataSeason: '2003/04' }), nbaBasketballIn('2003/04'));
  assert.equal(nbaBasketballIn('2026/27'), nbaBasketball);
  assert.equal(nbaBasketballIn(LATEST_NBA_SEASON), nbaBasketball);
  assert.equal(LATEST_NBA_SEASON, '2025/26');
  assert.equal(nbaBasketballIn('2003/04').prepareMatch(side('A'), side('D')).pace, 90.1);
  assert.equal(nbaBasketball.prepareMatch(side('A'), side('D')).pace, 99.4);
  assert.equal(matchSport({ sport: 'basketball', layer: 'nations', dataSeason: '2003/04' }), basketball);
  assert.equal(matchSport({ sport: 'basketball', layer: 'nations' }), basketball);
  assert.equal(matchSport({ sport: 'basketball' }), basketball);
  assert.equal(matchSport({ sport: 'football', layer: 'clubs' }).id, 'football');
  assert.equal(matchSport({ sport: 'american-football', layer: 'clubs' }).id, 'american-football');
  assert.equal(matchSport(null).id, 'football');
  assert.deepEqual([basketball.clock.length, nbaBasketball.clock.length], [40, 48]);
  // The NBA clock runs faster, so a match lasts about as long on screen under either rulebook.
  const screenMs = sport => sport.clock.length * sport.clock.msPerUnit;
  assert.ok(Math.abs(screenMs(nbaBasketball) - screenMs(basketball)) < 50);
  // Only the rulebook's members differ: the squads, labels and score-only sampler are basketball's own.
  const ruled = new Set(['simulationVersion', 'clock', 'formatEvent', 'prepareMatch', 'simulate']);
  assert.deepEqual(Object.keys(nbaBasketball), Object.keys(basketball));
  for (const key of Object.keys(basketball)) if (!ruled.has(key)) assert.equal(nbaBasketball[key], basketball[key], key);
  assert.equal(nbaBasketball.id, 'basketball');
});

test('quarter labels follow the rulebook: ten-minute FIBA quarters, twelve-minute NBA quarters', () => {
  const when = (sport, m) => sport.formatEvent({ m, pts: 2, name: 'X' }, 'XXX').when;
  assert.deepEqual([1, 10, 11, 20, 30, 31, 40, 41, 45].map(m => when(basketball, m)),
    ['Q1', 'Q1', 'Q2', 'Q2', 'Q3', 'Q4', 'Q4', 'OT', 'OT']);
  assert.deepEqual([1, 12, 13, 24, 36, 37, 48, 49, 53].map(m => when(nbaBasketball, m)),
    ['Q1', 'Q1', 'Q2', 'Q2', 'Q3', 'Q4', 'Q4', 'OT', 'OT']);
  assert.deepEqual(nbaBasketball.formatEvent({ m: 30, pts: 5, name: 'Jayson Tatum' }, 'BCE'), { when: 'Q3', text: '+5 — Jayson Tatum (BCE)' });
});

test('NBA matches run 48 minutes, then five-minute overtimes, and their events add up to the score', () => {
  const attacker = side('A', 79);
  const defender = side('D', 74);
  const prepared = nbaBasketball.prepareMatch(attacker, defender);
  const points = (ev, tid, from, to) => ev.filter(event => event.tid === tid && event.m > from && event.m <= to)
    .reduce((sum, event) => sum + event.pts, 0);
  let overtimes = 0;
  for (let seed = 0; seed < 1000; seed++) {
    const outcome = nbaBasketball.sampleResult(makeRng(seed), prepared, 6);
    const full = nbaBasketball.simulate(makeRng(seed), attacker, defender, 6);
    assert.deepEqual({ ga: full.ga, gd: full.gd, tie: full.tie, winner: full.winner }, {
      ga: outcome.ga, gd: outcome.gd, tie: outcome.tie, winner: outcome.winner,
    });
    assert.ok(full.ev.every((event, i) => Number.isInteger(event.m) && event.m > 0 && (!i || full.ev[i - 1].m <= event.m)));
    assert.equal(points(full.ev, 'A', 0, 48), outcome.regA);
    assert.equal(points(full.ev, 'D', 0, 48), outcome.regD);
    if (full.tie) {
      overtimes++;
      full.tie.periods.forEach(([a, d], period) => {
        assert.equal(points(full.ev, 'A', 48 + period * 5, 53 + period * 5), a);
        assert.equal(points(full.ev, 'D', 48 + period * 5, 53 + period * 5), d);
      });
      assert.ok(full.ev.every(event => event.m <= 48 + full.tie.periods.length * 5));
    } else assert.ok(full.ev.every(event => event.m <= 48));
    assert.notEqual(full.ga, full.gd);
  }
  assert.ok(overtimes > 0, 'the fixture seeds must exercise overtime accounting');
});

test('NBA pace: matched fives score about 113 a side in 2025/26, the built-in franchises about the league\'s 116', () => {
  const prepared = nbaBasketball.prepareMatch(side('A'), side('D'));
  const rng = makeRng(20261101);
  const count = 30000;
  let a = 0, d = 0, margin2 = 0, wins = 0, overtime = 0;
  for (let i = 0; i < count; i++) {
    const result = nbaBasketball.sampleResult(rng, prepared, 6);
    a += result.regA;
    d += result.regD;
    margin2 += (result.regA - result.regD) ** 2;
    wins += result.winner === 'A';
    overtime += !!result.tie;
  }
  assert.ok(a / count > 110 && a / count < 116 && d / count > 110 && d / count < 116, `${a / count}–${d / count}`);
  assert.ok(wins / count > 0.48 && wins / count < 0.52);
  assert.ok(Math.sqrt(margin2 / count) > 16 && Math.sqrt(margin2 / count) < 23);
  assert.ok(overtime / count > 0.01 && overtime / count < 0.04);

  // Every pairing of the built-in clubs: NBA rules lift them from FIBA's mid-eighties to the league's level.
  const clubs = basketball.clubs.map(club => buildClub(club, basketball));
  const nba = clubScoring(nbaBasketball, clubs), fiba = clubScoring(basketball, clubs);
  assert.ok(Math.abs(nba - NBA_LEAGUE_AVERAGES['2025/26'].points) < 2.5, `NBA rules: ${nba}`);
  assert.ok(fiba > 80 && fiba < 88, `FIBA rules: ${fiba}`);
});

/** Mean regulation points a side over every pairing of `clubs`, four draws each, under `sport`. */
function clubScoring(sport, clubs) {
  const rng = makeRng(7);
  let points = 0, sides = 0;
  for (const attacker of clubs) {
    for (const defender of clubs) {
      if (attacker === defender) continue;
      const pairing = sport.prepareMatch(attacker, defender);
      for (let k = 0; k < 4; k++) {
        const result = sport.sampleResult(rng, pairing, 6);
        points += result.regA + result.regD;
        sides += 2;
      }
    }
  }
  return points / sides;
}

test('every NBA season scores like its league: 93 a side in 2003/04, 114 in 2023/24', () => {
  const root = new URL('../', import.meta.url);
  for (const season of BUILT_IN_BASKETBALL_SEASONS) {
    const league = NBA_LEAGUE_AVERAGES[season.season];
    assert.ok(league, `${season.season} has league averages`);
    const set = JSON.parse(readFileSync(new URL(`public/basketball/${season.id}.json`, root), 'utf8'));
    const clubs = set.clubs.map(club => buildClub(club, basketball));
    const sport = matchSport({ sport: 'basketball', layer: 'clubs', dataSeason: season.season });
    assert.equal(sport.prepareMatch(clubs[0], clubs[1]).pace, league.pace);
    const points = clubScoring(sport, clubs);
    assert.ok(Math.abs(points - league.points) < 2.5, `${season.season}: ${points.toFixed(1)} against the league's ${league.points}`);
  }
});
