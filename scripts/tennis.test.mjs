// Tennis (docs/design/tennis.md): the national teams built from the committed Tennis Abstract snapshot, every rating a
// player's Elo on the game's scale and nothing estimated, the Davis Cup tie (five rubbers, first to three, best-of-three
// sets), its live win probability, setup with nations only, the squad screen's court and the running App.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROSTERS, SOURCE } from '../src/data/rosters.tennis.js';
import { HISTORIC_NATIONS, buildTeam, HOME_NATIONS, makeRng, NATIONS, selectLineup, teamEff, teamSportId } from '../src/data/teams.js';
import { clockLabel, clockTick, getSport, overtimeEnd, SPORT_LIST } from '../src/sports/index.js';
import {
  bestOfThree, BLOCK, daySetChances, HOME_EDGE, holdChance, matchOdds, playMatch, playMatchWon, RUBBER_MODEL, sampleResult,
  serveEdge, setChance, setLogitFor, surname, tennisProfile, tiebreakChance,
} from '../src/sports/tennis.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import { acquisitionCandidates, automaticAcquisition } from '../src/engine/campaignExperience.js';
import { chartDomain, isLiveModel, liveModelFor, winProbabilityAt, winSeries } from '../src/engine/winProbability.js';
import { exportCampaign, parseCampaign } from '../src/engine/storage.js';
import { CLUB_SCOPES } from '../src/data/scopes.js';
import { buildSetupModel, campaignFacts, moreRulesSummary, signingsOffered, sportNote } from '../src/screens/setup/setupModel.js';
import { challengeQuery, readChallenge } from '../src/screens/setup/challenge.js';
import { buildSquad } from '../src/viewModels/squad.js';
import { buildFeedRows, buildLiveMatch, scorersLine } from '../src/viewModels/match.js';
import { gameRating, nationOf, playerOf } from './lib/tennis.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const sport = getSport('tennis');
const SNAPSHOT = JSON.parse(read('scripts/data/tennis-elo.json'));
const ELO = new Map(SNAPSHOT.players.map(row => [row[1], row[4]]));
const nation = id => buildTeam(id, makeRng(1), sport);
const team = (id, ratings) => ({ id, name: id, sport: 'tennis', squad: ratings.map((rating, i) => ({ name: `${id} Player${i + 1}`, pos: 'SGL', rating })) });
const tally = (n, f) => { let k = 0; for (let i = 0; i < n; i++) if (f(i)) k++; return k / n; };

// ---------- the ratings ----------

test('the nations rebuild byte for byte from the committed snapshot', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.match(execFileSync(process.execPath, ['scripts/build-tennis.mjs', '--check'], { cwd: root, encoding: 'utf8' }), /Verified/);
  assert.equal(SNAPSHOT.players.length, SNAPSHOT.source.players);
  assert.equal(new Set(SNAPSHOT.players.map(row => row[0])).size, SNAPSHOT.players.length, 'every player once');
  assert.equal(SOURCE.updated, SNAPSHOT.source.updated);
});

test('every rating is the player\'s Elo / 25 + 4, rounded, and nothing is estimated', () => {
  assert.deepEqual([gameRating(2296.9), gameRating(1700), gameRating(1050.2)], [96, 72, 46]);
  for (const [id, [str, count, squad]] of Object.entries(ROSTERS)) {
    assert.equal(count, squad.length, `${id}: its player count`);
    for (const [name, pos, rating, info] of squad) {
      assert.equal(pos, 'SGL');
      assert.equal(rating, gameRating(ELO.get(name)), `${name}: ${rating}`);
      assert.deepEqual([info.source, info.edition, info.rawRating, info.rawScale], ['tennis-abstract', 'Tennis Abstract Elo', ELO.get(name), 'Elo']);
      assert.match(info.url, /^https:\/\/www\.tennisabstract\.com\/cgi-bin\/player\.cgi\?p=/);
      assert.equal(info.snapshotDate, SNAPSHOT.source.updated);
    }
    assert.equal(str, selectLineup(nation(id)).rating, `${id}: its strength is its lineup's`);
  }
});

test('a nation names its five best by Elo and needs two; the retired and the off-map play for nobody', () => {
  const ids = Object.keys(ROSTERS);
  assert.equal(ids.length, 52);
  for (const [id, [, , squad]] of Object.entries(ROSTERS)) {
    assert.ok(squad.length >= 2 && squad.length <= 5, `${NATIONS[id][0]}: ${squad.length}`);
    const elos = squad.map(([name]) => ELO.get(name));
    assert.deepEqual(elos, elos.slice().sort((a, b) => b - a), `${NATIONS[id][0]} in Elo order`);
  }
  const playing = new Set(Object.values(ROSTERS).flatMap(([, , squad]) => squad.map(([name]) => name)));
  for (const name of ['Gael Monfils', 'Kei Nishikori', 'Valentin Vacherot', 'Coleman Wong']) assert.ok(!playing.has(name), name);
  assert.equal(ROSTERS['826'][2][0][0], 'Cameron Norrie', 'Great Britain plays as the United Kingdom');
  assert.deepEqual(['GBR', 'LAT', 'LBN', 'TPE', 'MON'].map(nationOf), ['826', '428', '422', '158', null]);
  assert.throws(() => nationOf('XYZ'), /No nation/);
  const sinner = playerOf(SNAPSHOT.players.find(row => row[1] === 'Jannik Sinner'), SNAPSHOT.source.updated);
  assert.deepEqual([sinner.rating, sinner.nation, sinner.source.id], [96, '380', 'ta:JannikSinner']);
});

test('a nation with fewer than two players fields no team, and Great Britain\'s home nations play as one', () => {
  const { merged, inactive } = sport.territory;
  assert.deepEqual(Object.keys(merged).sort(), HOME_NATIONS.slice().sort());
  assert.ok(Object.values(merged).every(holder => holder === '826'));
  for (const id of Object.keys(NATIONS)) {
    // East Germany is not on today's map (HISTORIC_NATIONS): no 2026 tie is played there.
    if (HOME_NATIONS.includes(id) || HISTORIC_NATIONS.includes(id)) continue;
    assert.equal(inactive.includes(id), !Object.hasOwn(ROSTERS, id), NATIONS[id][0]);
  }
  assert.equal(nation('380').squad.length, 5, 'no generated players');
  assert.ok(nation('380').squad.every(player => !player.gen));
});

// ---------- the team ----------

test('the two best play the singles, the next two the doubles, and a small team doubles up', () => {
  const italy = selectLineup(nation('380'));
  assert.deepEqual(italy.slots.map(slot => [slot.position, slot.player.name]),
    [['SGL', 'Jannik Sinner'], ['SGL', 'Lorenzo Musetti'], ['DBL', 'Flavio Cobolli'], ['DBL', 'Matteo Berrettini']]);
  assert.equal(italy.starters.length, 4);
  assert.deepEqual(italy.bench.map(player => player.name), ['Luciano Darderi']);
  assert.equal(teamSportId({ squad: [{ pos: 'SGL' }] }), 'tennis');
  // Strength weighs each place by its rubbers: the singles two each, the pair one.
  assert.equal(selectLineup(team('t', [90, 80, 70, 60])).rating, Math.round((2 * 90 + 2 * 80 + 0.5 * 70 + 0.5 * 60) / 5 * 10) / 10);

  const norway = selectLineup(nation('578'));
  assert.deepEqual(norway.slots.map(slot => [slot.position, slot.player.name, !!slot.player.doubling]),
    [['SGL', 'Casper Ruud', false], ['SGL', 'Nicolai Budkov Kjaer', false], ['DBL', 'Viktor Durasovic', false], ['DBL', 'Casper Ruud', true]]);
  assert.equal(norway.starters.length, 3, 'each player once');
  const pair = selectLineup(team('t', [80, 70]));
  assert.deepEqual(pair.slots.map(slot => slot.player.name), ['t Player1', 't Player2', 't Player1', 't Player2']);
  assert.ok(pair.slots.every(slot => !slot.outOfPosition && slot.penalty === 0));
  const one = selectLineup(team('t', [80]));
  assert.deepEqual(one.slots.map(slot => slot.player?.name ?? null), ['t Player1', null, 't Player1', null]);
  assert.deepEqual(tennisProfile(italy), { singles: 88, doubles: 78 });
});

test('a signing never weakens a team, and joins the lineup only when it is among the four best', () => {
  const italy = nation('380'), spain = nation('724');
  for (const candidate of acquisitionCandidates(italy, spain)) {
    assert.ok(candidate.gain >= 0, `${candidate.name}: ${candidate.gain}`);
    // Italy's fourth best is Berrettini, 77: an equal newcomer waits behind him.
    assert.equal(candidate.entersLineup, candidate.rating > 77, candidate.name);
  }
});

// ---------- the match model ----------

test('a set\'s odds come from holds and breaks, the same whoever serves first', () => {
  assert.ok(Math.abs(holdChance(0.64) - 0.8126) < 1e-4);
  assert.ok(Math.abs(holdChance(0.5) - 0.5) < 1e-12);
  assert.ok(Math.abs(tiebreakChance(0.64, 0.64) - 0.5) < 1e-12);
  assert.ok(Math.abs(setChance(0.64, 0.64) - 0.5) < 1e-12);
  for (const pA of [0.55, 0.64, 0.75]) for (const pD of [0.52, 0.66, 0.8]) {
    assert.ok(Math.abs(setChance(pA, pD) - (1 - setChance(pD, pA))) < 1e-12, `${pA} v ${pD}`);
  }
  for (const s of [0.3, 0.5, 0.62, 0.9]) {
    const edge = serveEdge(s);
    assert.ok(Math.abs(setChance(0.64 + edge / 2, 0.64 - edge / 2) - s) < 1e-9, `serve edge for ${s}`);
  }
});

test('a rubber\'s favourite wins as often as Elo says, its sets are correlated, and a third set comes about a third of the time', () => {
  assert.ok(Math.abs(matchOdds(4) - 0.64) < 0.005 && Math.abs(matchOdds(8) - 0.76) < 0.005 && Math.abs(matchOdds(16) - 0.909) < 0.005);
  for (const odds of [0.5, 0.76, 0.05]) {
    const days = daySetChances(odds);
    assert.ok(Math.abs(days.reduce((sum, { weight, s }) => sum + weight * bestOfThree(s), 0) - odds) < 1e-9, `${odds}: Elo's odds kept`);
    assert.ok(Number.isFinite(setLogitFor(odds)));
  }
  const rng = makeRng(20261108);
  const N = 6000;
  const matches = Array.from({ length: N }, () => playMatch(rng, matchOdds(8)));
  const won = matches.filter(sets => sets.filter(set => set.a > set.d).length === 2).length / N;
  const three = matches.filter(sets => sets.length === 3).length / N;
  assert.ok(Math.abs(won - matchOdds(8)) < 0.025, `won ${won}`);
  assert.ok(three > 0.31 && three < 0.39, `third sets ${three}`);
  for (const sets of matches) {
    assert.ok(sets.length >= 2 && sets.length <= 3);
    for (const { a, d, tb } of sets) {
      const [w, l] = a > d ? [a, d] : [d, a];
      assert.ok((w === 6 && l <= 4) || (w === 7 && l === 5) || (w === 7 && l === 6 && tb), `${a}–${d}`);
      if (tb) assert.ok(Math.max(...tb) >= 7 && Math.abs(tb[0] - tb[1]) >= 2 && (tb[0] > tb[1]) === (a > d), `tie-break ${tb}`);
    }
  }
  // Played out given the result: always that result, and as often to a third set as any match.
  const given = Array.from({ length: N }, (_, i) => playMatchWon(rng, matchOdds(8), i % 4 !== 0));
  given.forEach((sets, i) => assert.equal(sets.filter(set => set.a > set.d).length === 2, i % 4 !== 0));
  const givenThree = given.filter(sets => sets.length === 3).length / N;
  assert.ok(Math.abs(givenThree - three) < 0.05, `${givenThree} v ${three}`);
  // An underdog's win is found too.
  const upset = playMatchWon(makeRng(3), matchOdds(-30), true);
  assert.equal(upset.filter(set => set.a > set.d).length, 2);
});

test('a tie: five rubbers in the Davis Cup\'s order, first to three, dead rubbers unplayed', () => {
  const italy = nation('380'), spain = nation('724');
  const prepared = sport.prepareMatch(italy, spain);
  assert.deepEqual(prepared.rubbers.map(rubber => [rubber.a, rubber.d, rubber.doubles]), [
    ['Jannik Sinner', 'Rafael Jodar', false],
    ['Lorenzo Musetti', 'Carlos Alcaraz', false],
    ['Cobolli/Berrettini', 'Fokina/Aguilar', true],
    ['Jannik Sinner', 'Carlos Alcaraz', false],
    ['Lorenzo Musetti', 'Rafael Jodar', false],
  ]);
  assert.equal(prepared.rubbers[0].gap, 96 - 84);
  const rng = makeRng(77);
  const scores = new Map();
  for (let i = 0; i < 2000; i++) {
    const result = sport.simulate(rng, italy, spain, 6, teamEff(italy), teamEff(spain));
    const { ga, gd, ev, winner, tie } = result;
    assert.equal(tie, null);
    assert.equal(Math.max(ga, gd), 3);
    assert.equal(winner, ga > gd ? '380' : '724');
    scores.set(`${Math.max(ga, gd)}–${Math.min(ga, gd)}`, (scores.get(`${Math.max(ga, gd)}–${Math.min(ga, gd)}`) || 0) + 1);
    // The score is the rubbers won: one event a set, pts 1 for the set that wins its rubber.
    assert.equal(ev.filter(e => e.tid === '380').reduce((sum, e) => sum + e.pts, 0), ga);
    assert.equal(ev.filter(e => e.tid === '724').reduce((sum, e) => sum + e.pts, 0), gd);
    assert.equal(ev.filter(e => e.pts === 1).length, ga + gd);
    ev.forEach((e, k) => {
      assert.ok(k === 0 || e.m > ev[k - 1].m, 'in order on the clock');
      assert.ok(e.m > (e.rubber - 1) * BLOCK && e.m <= e.rubber * BLOCK, `rubber ${e.rubber} at ${e.m}`);
      if (e.pts === 1) assert.equal(e.m, e.rubber * BLOCK, 'a rubber ends at the end of its block');
    });
    assert.equal(Math.max(...ev.map(e => e.m)), (ga + gd) * BLOCK);
  }
  assert.deepEqual([...scores.keys()].sort(), ['3–0', '3–1', '3–2']);
});

test('the score-only path and the full tie agree seed for seed, and the odds follow the ratings', () => {
  const italy = nation('380'), spain = nation('724'), norway = nation('578');
  for (const venue of [undefined, { home: true }]) {
    const prepared = sport.prepareMatch(italy, spain, 86, 86.1, venue);
    for (let seed = 1; seed <= 40; seed++) {
      const fast = sampleResult(makeRng(seed), prepared, 6), full = sport.simulate(makeRng(seed), italy, spain, 6, 86, 86.1, venue);
      assert.deepEqual([fast.ga, fast.gd, fast.winner], [full.ga, full.gd, full.winner], `seed ${seed}`);
    }
  }
  const even = estimateWinProbability({ sport, attacker: team('a', [80, 80, 75, 75]), defender: team('d', [80, 80, 75, 75]), samples: 20000 });
  assert.ok(Math.abs(even.attacker - 0.5) < 0.015, `even ${even.attacker}`);
  const strong = estimateWinProbability({ sport, attacker: nation('380'), defender: norway, samples: 20000 });
  assert.ok(strong.attacker > 0.8, `Italy v Norway ${strong.attacker}`);
  const calm = estimateWinProbability({ sport, attacker: nation('380'), defender: norway, preset: 'predictable', samples: 20000 });
  const wild = estimateWinProbability({ sport, attacker: nation('380'), defender: norway, preset: 'wild', samples: 20000 });
  assert.ok(calm.attacker > strong.attacker && wild.attacker < strong.attacker, 'Upsets widen the underdog\'s chance');
  // A host's edge is the singles' 1.8 points and the doubles' 0.7.
  const home = sport.prepareMatch(italy, spain, undefined, undefined, { home: true }), neutral = sport.prepareMatch(italy, spain);
  assert.deepEqual(home.rubbers.map((rubber, i) => Math.round((neutral.rubbers[i].gap - rubber.gap) * 100) / 100), [1.8, 1.8, 0.7, 1.8, 1.8]);
  assert.deepEqual(HOME_EDGE, { singles: 1.8, doubles: 0.7 });
});

test('an empty place concedes its rubber', () => {
  const a = team('a', [80]), d = team('d', [70, 70, 70, 70]);
  const prepared = sport.prepareMatch(a, d);
  assert.deepEqual(prepared.rubbers.map(rubber => rubber.walkover), [null, 'D', 'D', null, 'D']);
  const { ga, gd, ev } = sport.simulate(makeRng(5), a, d, 6);
  assert.equal(gd, 3);
  assert.ok(ga <= 2);
  assert.ok(ev.filter(e => e.score === 'w/o').every(e => e.tid === 'd' && e.pts === 1));
});

// ---------- the copy, the clock and the live chart ----------

test('the feed copy and the clock: rubbers, sets and a score in rubbers', () => {
  const set = { m: 9, rubber: 1, set: 1, pts: 0, name: 'Jannik Sinner', score: '7–6(5)', doubles: false };
  const rubber = { m: 20, rubber: 1, set: 2, pts: 1, name: 'Jannik Sinner', score: '7–6(5) 6–3', doubles: false };
  const doubles = { m: 60, rubber: 3, set: 2, pts: 1, name: 'Cobolli/Berrettini', score: '6–4 6–4', doubles: true };
  assert.deepEqual(sport.formatEvent(set, 'ITA'), { when: 'R1', text: 'SET 1 — Jannik Sinner (ITA) 7–6(5)' });
  assert.deepEqual(sport.formatEvent(rubber, 'ITA'), { when: 'R1', text: 'SINGLES — Jannik Sinner (ITA) 7–6(5) 6–3' });
  assert.deepEqual(sport.formatEvent(doubles, 'ITA'), { when: 'R3', text: 'DOUBLES — Cobolli/Berrettini (ITA) 6–4 6–4' });
  assert.equal(sport.formatToast(rubber), 'SINGLES — JANNIK SINNER 7–6(5) 6–3');
  assert.deepEqual([0, 1, 20, 21, 40, 41, 100].map(m => clockLabel(sport, m)), ['R1', 'R1', 'R1', 'R2', 'R2', 'R3', 'R5']);
  assert.deepEqual([0, 20, 60, 100].map(t => clockTick(sport, t)), ['', 'R1', 'R3', 'R5']);
  assert.equal(overtimeEnd(sport, 2), 0, 'no overtime: a tie ends with its last set');
  assert.equal(scorersLine([set, rubber, { ...doubles, tid: 'i' }].map(e => ({ tid: 'i', ...e })), 'i', {}, 'tennis'), 'Sinner · Cobolli/Berrettini');
  assert.deepEqual(['Alex De Minaur', 'Botic Van De Zandschulp', 'Jannik Sinner'].map(surname), ['De Minaur', 'Van De Zandschulp', 'Sinner']);
  assert.equal(sport.labels.score, 'RUBBERS');
  assert.equal(sport.words.half, null);
});

test('the live win probability starts at the tie\'s odds, moves with every set and rubber, and settles at the end', () => {
  const italy = nation('380'), spain = nation('724');
  const model = liveModelFor(sport, italy, spain, teamEff(italy), teamEff(spain), 6);
  assert.ok(isLiveModel(model));
  assert.equal(model.kind, 'rubbers');
  assert.equal(model.gaps.length, 5);
  assert.ok(isLiveModel(JSON.parse(JSON.stringify(model))), 'a saved model still reads');
  const odds = estimateWinProbability({ sport, attacker: italy, defender: spain, samples: 20000 }).attacker;
  assert.ok(Math.abs(winProbabilityAt(model, 0, 0) - odds) < 0.015, `${winProbabilityAt(model, 0, 0)} v ${odds}`);
  const { ev, winner } = sport.simulate(makeRng(31), italy, spain, 6, teamEff(italy), teamEff(spain));
  const goals = ev.map(e => ({ m: e.m, tid: e.tid, pts: e.pts }));
  const series = winSeries({ model, goals, aId: '380', dId: '724', minute: Math.max(...ev.map(e => e.m)), final: { winnerId: winner } });
  assert.equal(series.at(-1).p, winner === '380' ? 1 : 0);
  // Between events the chart holds: a set or a rubber moves it, time alone never does.
  for (let t = 1; t < series.length - 1; t++) {
    if (!ev.some(e => Math.ceil(e.m) === t)) assert.equal(series[t].p, series[t - 1].p, `minute ${t}`);
  }
  for (const e of ev) {
    const before = series[e.m - 1].p, after = series[e.m].p;
    if (e.m < series.length - 1) assert.ok(e.tid === '380' ? after > before : after < before, `the ${e.pts ? 'rubber' : 'set'} at ${e.m} moves it its way`);
  }
  // After a set, the rubber's chance weighs the day's form by it: more than independent sets would give.
  const even = liveModelFor(sport, team('a', [80, 80, 80, 80]), team('d', [80, 80, 80, 80]), undefined, undefined, 0);
  const afterSet = winSeries({ model: even, goals: [{ m: 7, tid: 'a', pts: 0 }], aId: 'a', dId: 'd', minute: 7 }).at(-1).p;
  assert.ok(afterSet > 0.55, `after the first set ${afterSet}`);
  assert.deepEqual(chartDomain(model, 50).ticks, [0, 20, 40, 60]);
  assert.deepEqual(chartDomain(model, 75).ticks, [0, 20, 40, 60, 80]);
  assert.equal(RUBBER_MODEL.LENGTH, 60);
});

test('the feed reads rubbers: no half-time, a live row by rubber and the final in rubbers', () => {
  const italy = nation('380'), spain = nation('724');
  const sim = sport.simulate(makeRng(9), italy, spain, 6, teamEff(italy), teamEff(spain));
  const st = { phase: 'playing', settings: { sport: 'tennis' }, teams: { 380: italy, 724: spain }, history: [],
    match: { aId: '380', dId: '724', effA: 86, effD: 86.1, ga: sim.ga, gd: sim.gd, shown: sim.ev, allEv: sim.ev, tie: null,
      winner: sim.winner, finalGa: sim.ga, finalGd: sim.gd, status: sport.labels.end, applied: false, done: true } };
  const live = buildLiveMatch(st, { sport });
  assert.equal(live.state, 'full-time');
  assert.equal(live.goals.filter(goal => goal.pts === 0).length, sim.ev.filter(e => e.pts === 0).length, 'a set counts nothing');
  assert.equal(live.a.score + live.b.score, sim.ga + sim.gd);
  assert.ok(live.lineups.a.rows.length === 4 && live.lineups.a.rows.every(row => ['SGL', 'DBL'].includes(row.pos)));
  const rows = buildFeedRows(live, 100);
  assert.match(rows[0].text, new RegExp(`^Final — ITA ${sim.ga}–${sim.gd} ESP$`));
  assert.ok(!rows.some(row => /Half-time|Overtime/.test(row.text)));
  assert.ok(rows.some(row => /^SINGLES — /.test(row.text)) && rows.some(row => /^SET 1 — /.test(row.text)));
  assert.equal(rows.at(-1).text, 'First serve — Italy attack Spain');
  const liveRows = buildFeedRows({ ...live, feedBase: { ...live.feedBase, state: 'live' } }, 25);
  assert.match(liveRows[0].text, /· rubber 2 of 5$/);
});

// ---------- setup and the squad screen ----------

test('setup offers tennis with nations only, on its built-in 2026 season', () => {
  assert.ok(SPORT_LIST.some(item => item.id === 'tennis'));
  assert.equal(sportNote(sport), 'Nations');
  assert.deepEqual(CLUB_SCOPES(sport), []);
  const model = buildSetupModel({ sport: 'tennis', layer: 'clubs', scope: 'UEFA' }, {});
  assert.equal(model.layer, 'nations', 'never clubs');
  assert.equal(model.nationsOnly, true);
  assert.equal(model.clubsOnly, null);
  assert.deepEqual(model.season.options.map(option => option.name), ['2026']);
  assert.match(model.season.note, /Tennis Abstract/);
  assert.equal(buildSetupModel({ sport: 'football' }, {}).nationsOnly, false);
  // A challenge link cannot ask for tennis clubs.
  const { setup, ignored } = readChallenge('?sport=tennis&teams=clubs&theatre=UEFA');
  assert.deepEqual([setup.sport, setup.layer, setup.scope], ['tennis', 'nations', 'UEFA']);
  assert.deepEqual(ignored, ['teams']);
  assert.doesNotMatch(challengeQuery({ sport: 'tennis', layer: 'clubs', scope: 'UEFA' }, 7), /teams=/);
});

test('Computer signings is no choice in tennis: the best-rated player is always the best fit', () => {
  // Any player plays any place, so both settings sign the same player for every winner and loser.
  for (const game of [sport, getSport('womens-tennis')]) {
    const teams = Object.keys(game.rosters).map(id => buildTeam(id, makeRng(1), game));
    for (const winner of teams) {
      for (const loser of teams) {
        if (winner === loser) continue;
        assert.equal(automaticAcquisition(winner, loser, 'best-fit')?.index, automaticAcquisition(winner, loser, 'highest-rated')?.index,
          `${game.id}: ${winner.name} signing from ${loser.name}`);
      }
    }
    assert.equal(signingsOffered(game.id), false, game.id);
  }
  assert.ok(signingsOffered('football') && signingsOffered('basketball'));
  // So setup, the campaign's rules and challenge links leave it out.
  const settings = { sport: 'tennis', layer: 'nations', scope: 'UEFA', acquisitionPolicy: 'best-fit' };
  assert.ok(!campaignFacts(settings).some(row => row.id === 'recruitment'));
  assert.ok(campaignFacts({ ...settings, sport: 'football' }).some(row => row.id === 'recruitment'));
  assert.equal(moreRulesSummary(settings), 'Standard');
  assert.deepEqual(readChallenge('?sport=tennis&signings=best-fit').ignored, ['signings']);
  assert.doesNotMatch(challengeQuery(settings, 7), /signings=/);
  assert.match(challengeQuery({ ...settings, sport: 'football' }, 7), /signings=best-fit/);
});

test('the squad screen draws a court with the singles and the doubles, and says who doubles up', () => {
  const norway = { ...nation('578'), baseEff: teamEff(nation('578')) };
  const squad = buildSquad({ teams: { 578: norway }, aliveIds: ['578'], history: [] }, { sport }, '578');
  assert.equal(squad.layout, 'tennis');
  assert.equal(squad.viewLabel, 'Court');
  assert.equal(squad.xi.label, 'Team');
  assert.deepEqual(squad.groups.map(group => [group.label, group.rows.map(row => row.name)]),
    [['Singles', ['Casper Ruud', 'Nicolai Budkov Kjaer']], ['Doubles', ['Casper Ruud', 'Viktor Durasovic']]]);
  assert.equal(squad.pitch.length, 4);
  assert.equal(new Set(squad.pitch.map(slot => slot.key)).size, 4);
  assert.equal(new Set(squad.pitch.map(slot => `${slot.x}|${slot.y}`)).size, 4, 'four places on the court');
  assert.deepEqual(squad.profile.map(row => row.label), ['Singles', 'Doubles']);
  assert.ok(squad.notes.includes('Ruud plays the singles and the doubles: the team has 3 rated players.'));
  assert.ok(!squad.notes.some(note => /Source data covers/.test(note)), 'no place is empty');
  const sinner = buildSquad({ teams: { 380: nation('380') }, aliveIds: ['380'], history: [] }, { sport }, '380')
    .groups[0].rows[0];
  assert.deepEqual([sinner.name, sinner.rating, sinner.source], ['Jannik Sinner', 96, 'Tennis Abstract Elo']);
  assert.match(sinner.sourceTitle, /Source rating 2296.9 \(Elo scale\)/);
  assert.match(sinner.sourceUrl, /p=JannikSinner$/);
});

// ---------- the running App ----------

const B = await bundleComponents({ App: 'src/App.jsx', WinChart: 'src/screens/match/WinChart.jsx' }, { jsx: 'automatic' });

test('tennis sets up with nations only, launches, plays a tie and saves it', () => {
  // Afghanistan (004) has no rated player.
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['380', '724', '250', '826', '004'],
    settings: { sport: 'football', layer: 'clubs', scope: 'UEFA', clubScope: 'all', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try {
    const { app } = f;
    app.pickSetup('sport', 'tennis');
    assert.equal(app.state.setup.layer, 'nations', 'tennis takes the nations');
    app.pickSetup('layer', 'clubs');
    assert.equal(app.state.setup.layer, 'nations', 'and keeps them');
    app.pickSetup('scope', 'world');
    app.startCampaign();
    const { state } = app;
    assert.equal(state.phase, 'playing');
    assert.match(state.campaignName, /^Tennis/);
    assert.deepEqual(state.aliveIds.slice().sort(), Object.keys(ROSTERS).sort(), 'the 52 nations with a team');
    assert.ok(!state.teams['004'], 'Afghanistan fields no team');
    assert.ok(Object.values(state.teams).every(t => t.sport === 'tennis' && t.squad.every(player => !player.gen)));
    const [a, d] = state.aliveIds;
    f.app.showPopup = () => {};
    f.app.showToast = () => {};
    app.startMatch(a, d);
    const m = app.state.match;
    assert.equal(Math.max(m.finalGa, m.finalGd), 3);
    assert.equal(m.live?.kind, 'rubbers');
    const saved = parseCampaign(exportCampaign(app.state));
    assert.equal(saved.settings.sport, 'tennis');
    assert.equal(saved.settings.layer, 'nations');
    assert.ok(saved.teams['380'].squad.some(player => player.name === 'Jannik Sinner' && player.sourceInfo?.rawRating === 2296.9));
  } finally {
    f.close();
  }
});

test('the win chart ticks at the end of each rubber and marks no half-time', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const React = (await import('react')).default;
  const model = liveModelFor(sport, nation('380'), nation('724'));
  const html = renderToStaticMarkup(React.createElement(B.WinChart, { sport: 'tennis', model, minuteFallback: 30 }));
  assert.equal((html.match(/class="match-chart__guide"/g) || []).length, 1, 'the 25% and 75% lines only');
  for (const tick of ['R1', 'R2', 'R3']) assert.ok(html.includes(`>${tick}<`), tick);
  assert.ok(!html.includes('>R4<'), 'a fourth rubber shows once it is played');
});
