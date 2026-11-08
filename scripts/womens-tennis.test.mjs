// Women's tennis (docs/design/womens-tennis.md): the WTA's players by Tennis Abstract's Elo, nothing estimated, in the
// Billie Jean King Cup's ties (five rubbers in the Davis Cup's order, first to three, best-of-three sets) with the WTA's
// serve; setup with nations only, the squad screen's court and the running App.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROSTERS, SOURCE } from '../src/data/rosters.womens-tennis.js';
import { ROSTERS as MEN } from '../src/data/rosters.tennis.js';
import { buildTeam, HOME_NATIONS, isTennisSport, makeRng, NATIONS, selectLineup, teamEff, teamSportId } from '../src/data/teams.js';
import { getSport, SPORT_LIST } from '../src/sports/index.js';
import { ATP, holdChance, matchOdds, playMatch, playMatchWon, sampleResult, serveEdge, setChance, simulateTie, WTA } from '../src/sports/tennis.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import { isLiveModel, liveModelFor, winProbabilityAt } from '../src/engine/winProbability.js';
import { builtInSeasonOf } from '../src/engine/footballSets.js';
import { exportCampaign, parseCampaign } from '../src/engine/storage.js';
import { CLUB_SCOPES } from '../src/data/scopes.js';
import { buildSetupModel, sportNote } from '../src/screens/setup/setupModel.js';
import { challengeQuery, readChallenge } from '../src/screens/setup/challenge.js';
import { buildSquad } from '../src/viewModels/squad.js';
import { scorersLine } from '../src/viewModels/match.js';
import { gameRating, leftOut, nationOf, nationsOf, playerOf, TOURS } from './lib/tennis.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const sport = getSport('womens-tennis');
const men = getSport('tennis');
const SNAPSHOT = JSON.parse(read('scripts/data/womens-tennis-elo.json'));
const ELO = new Map(SNAPSHOT.players.map(row => [row[1], row[4]]));
const players = SNAPSHOT.players.map(row => playerOf(row, SNAPSHOT.source.updated, TOURS.wta));
const nation = id => buildTeam(id, makeRng(1), sport);
const team = (id, ratings) => ({ id, name: id, sport: 'womens-tennis', squad: ratings.map((rating, i) => ({ name: `${id} Player${i + 1}`, pos: 'SGL', rating })) });

// ---------- the ratings ----------

test('the nations rebuild byte for byte from the committed WTA snapshot', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.match(execFileSync(process.execPath, ['scripts/build-tennis.mjs', '--tour=wta', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the women's tennis nations/);
  assert.match(execFileSync(process.execPath, ['scripts/build-tennis.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the tennis nations/, 'the men\'s still rebuild as they were');
  assert.equal(SNAPSHOT.players.length, SNAPSHOT.source.players);
  assert.equal(SNAPSHOT.source.elo, 'https://tennisabstract.com/reports/wta_elo_ratings.html');
  assert.equal(new Set(SNAPSHOT.players.map(row => row[0])).size, SNAPSHOT.players.length, 'every player once');
  assert.equal(SOURCE.updated, SNAPSHOT.source.updated);
});

test('every rating is the player\'s Elo / 25 + 4, rounded, and nothing is estimated', () => {
  assert.equal(gameRating(2159.2), 90, 'Elena Rybakina');
  for (const [id, [str, count, squad]] of Object.entries(ROSTERS)) {
    assert.equal(count, squad.length, `${id}: its player count`);
    for (const [name, pos, rating, info] of squad) {
      assert.equal(pos, 'SGL');
      assert.equal(rating, gameRating(ELO.get(name)), `${name}: ${rating}`);
      assert.deepEqual([info.source, info.edition, info.rawRating, info.rawScale], ['tennis-abstract', 'Tennis Abstract Elo', ELO.get(name), 'Elo']);
      assert.match(info.url, /^https:\/\/www\.tennisabstract\.com\/cgi-bin\/wplayer\.cgi\?p=/, 'the women\'s player pages');
      assert.ok(Number.isInteger(info.wtaRank) && !('atpRank' in info), `${name}: her WTA rank`);
      assert.equal(info.snapshotDate, SNAPSHOT.source.updated);
    }
    assert.equal(str, selectLineup(nation(id)).rating, `${id}: its strength is its lineup's`);
  }
});

test('a nation names its five best by Elo and needs two; the off-map, combined teams and nations of one play for nobody', () => {
  assert.equal(Object.keys(ROSTERS).length, 45);
  const built = nationsOf(players, TOURS.wta);
  assert.deepEqual(built.map(n => n.id).sort(), Object.keys(ROSTERS).sort());
  assert.deepEqual(built.slice(0, 3).map(n => n.name), ['United States', 'Russia', 'Czechia'], 'strongest first');
  assert.ok(built.every((n, i) => i === 0 || built[i - 1].str >= n.str));
  for (const [id, [, , squad]] of Object.entries(ROSTERS)) {
    assert.ok(squad.length >= 2 && squad.length <= 5, `${NATIONS[id][0]}: ${squad.length}`);
    const elos = squad.map(([name]) => ELO.get(name));
    assert.deepEqual(elos, elos.slice().sort((a, b) => b - a), `${NATIONS[id][0]} in Elo order`);
  }
  assert.deepEqual(ROSTERS['840'][2].map(([name]) => name), ['Coco Gauff', 'Jessica Pegula', 'Iva Jovic', 'Amanda Anisimova', 'Emma Navarro']);
  assert.equal(ROSTERS['826'][2][0][0], 'Sonay Kartal', 'Great Britain plays as the United Kingdom');
  assert.equal(ROSTERS['036'][2][0][0], 'Daria Kasatkina', 'a player plays for the country Tennis Abstract files her under');
  assert.ok(ROSTERS['643'] && ROSTERS['112'], 'Russia and Belarus play, as in the men\'s game');
  // Pacific Oceania is a combined team; Malta, Andorra, Liechtenstein and Hong Kong are off the map.
  assert.deepEqual(['SLO', 'INA', 'TPE', 'POC', 'MLT', 'AND', 'LIE', 'HKG'].map(nationOf), ['705', '360', '158', null, null, null, null, null]);
  const { unranked, offMap, alone } = leftOut(players);
  assert.equal(unranked.length, 0, 'every rated woman has a WTA rank');
  assert.deepEqual(offMap.map(p => p.country).sort(), ['AND', 'HKG', 'LIE', 'MLT', 'POC']);
  assert.equal(alone.length, 13);
  assert.ok(alone.some(p => p.name === 'Clara Tauson') && alone.some(p => p.name === 'Alexandra Eala'), 'Denmark and the Philippines have one each');
  const playing = new Set(Object.values(ROSTERS).flatMap(([, , squad]) => squad.map(([name]) => name)));
  for (const p of [...offMap, ...alone]) assert.ok(!playing.has(p.name), p.name);
});

test('a nation with fewer than two players fields no team, and Great Britain\'s home nations play as one', () => {
  const { merged, inactive } = sport.territory;
  assert.deepEqual(Object.keys(merged).sort(), HOME_NATIONS.slice().sort());
  assert.ok(Object.values(merged).every(holder => holder === '826'));
  for (const id of Object.keys(NATIONS)) {
    if (HOME_NATIONS.includes(id)) continue;
    assert.equal(inactive.includes(id), !Object.hasOwn(ROSTERS, id), NATIONS[id][0]);
  }
  assert.ok(inactive.includes('208') && inactive.includes('608'), 'Denmark and the Philippines stay neutral');
  assert.deepEqual([nation('826').name, nation('826').code, nation('826').flagId], ['Great Britain', 'GBR', 'GBR']);
  assert.ok(nation('840').squad.every(player => !player.gen), 'no generated players');
  // The women's teams are their own: no woman plays in the men's game, and the two sports keep apart.
  const menNames = new Set(Object.values(MEN).flatMap(([, , squad]) => squad.map(([name]) => name)));
  assert.ok(Object.values(ROSTERS).every(([, , squad]) => squad.every(([name]) => !menNames.has(name))));
});

// ---------- the team ----------

test('the two best play the singles, the next two the doubles, and a team of two doubles up', () => {
  assert.ok(isTennisSport('womens-tennis') && isTennisSport('tennis') && !isTennisSport('womens-football'));
  const usa = selectLineup(nation('840'));
  assert.deepEqual(usa.slots.map(slot => [slot.position, slot.player.name]),
    [['SGL', 'Coco Gauff'], ['SGL', 'Jessica Pegula'], ['DBL', 'Iva Jovic'], ['DBL', 'Amanda Anisimova']]);
  assert.deepEqual(usa.bench.map(player => player.name), ['Emma Navarro']);
  assert.equal(teamSportId({ sport: 'womens-tennis', squad: [] }), 'womens-tennis');
  const armenia = selectLineup(nation('051'));
  assert.deepEqual(armenia.slots.map(slot => [slot.position, slot.player.name, !!slot.player.doubling]),
    [['SGL', 'Alina Charaeva', false], ['SGL', 'Elina Avanesyan', false], ['DBL', 'Alina Charaeva', true], ['DBL', 'Elina Avanesyan', true]]);
  assert.equal(armenia.starters.length, 2, 'each player once');
  assert.equal(selectLineup(team('t', [90, 80, 70, 60])).rating, Math.round((2 * 90 + 2 * 80 + 0.5 * 70 + 0.5 * 60) / 5 * 10) / 10);
});

// ---------- the match model ----------

test('the WTA\'s serve: women hold less often, so fewer sets reach a tie-break and more end 6–0; the odds stay Elo\'s', () => {
  assert.deepEqual([ATP.serve, WTA.serve], [0.64, 0.567]);
  assert.equal(men.tour, ATP);
  assert.equal(sport.tour, WTA);
  // Sackmann's match files, tour level 2022–2025: holds 79.9% on the ATP, 65.7% on the WTA.
  assert.ok(Math.abs(holdChance(WTA.serve) - 0.657) < 0.01, `hold ${holdChance(WTA.serve)}`);
  for (const s of [0.3, 0.5, 0.62, 0.9]) {
    const edge = serveEdge(s, WTA.serve);
    assert.ok(Math.abs(setChance(WTA.serve + edge / 2, WTA.serve - edge / 2) - s) < 1e-9, `serve edge for ${s}`);
  }
  const N = 6000;
  const shares = tour => {
    const rng = makeRng(20261108);
    const matches = Array.from({ length: N }, () => playMatch(rng, matchOdds(4), tour));
    const sets = matches.flat();
    return { won: matches.filter(m => m.filter(set => set.a > set.d).length === 2).length / N,
      three: matches.filter(m => m.length === 3).length / N,
      tiebreaks: sets.filter(set => set.tb).length / sets.length,
      bagels: sets.filter(set => Math.min(set.a, set.d) === 0).length / sets.length };
  };
  const women = shares(WTA), menShares = shares(ATP);
  assert.ok(Math.abs(women.won - matchOdds(4)) < 0.025, `won ${women.won}`);
  assert.ok(Math.abs(women.three - menShares.three) < 0.03, `the same day form: ${women.three} v ${menShares.three}`);
  // Real: 11.1% of the WTA's sets go to a tie-break and 5.0% end 6–0; the ATP's 19.1% and 2.0%.
  assert.ok(women.tiebreaks > 0.08 && women.tiebreaks < 0.15, `tie-breaks ${women.tiebreaks}`);
  assert.ok(menShares.tiebreaks > 0.15, `men's tie-breaks ${menShares.tiebreaks}`);
  assert.ok(women.bagels > 0.03 && women.bagels > 2 * menShares.bagels, `6–0 sets ${women.bagels} v ${menShares.bagels}`);
  const upset = playMatchWon(makeRng(3), matchOdds(-30), true, WTA);
  assert.equal(upset.filter(set => set.a > set.d).length, 2);
});

test('a tie: five rubbers in the Billie Jean King Cup\'s order (the Davis Cup\'s), first to three, played with the WTA\'s serve', () => {
  const usa = nation('840'), russia = nation('643');
  const prepared = sport.prepareMatch(usa, russia);
  assert.deepEqual(prepared.rubbers.map(rubber => [rubber.a, rubber.d, rubber.doubles]), [
    ['Coco Gauff', 'Diana Shnaider', false],
    ['Jessica Pegula', 'Mirra Andreeva', false],
    ['Jovic/Anisimova', 'Kalinskaya/Alexandrova', true],
    ['Coco Gauff', 'Mirra Andreeva', false],
    ['Jessica Pegula', 'Diana Shnaider', false],
  ]);
  assert.equal(prepared.rubbers[0].gap, 89 - 84);
  const scores = new Set();
  let tiebreaks = 0, sets = 0, differs = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const result = sport.simulate(makeRng(seed), usa, russia, 6, teamEff(usa), teamEff(russia));
    assert.equal(Math.max(result.ga, result.gd), 3);
    assert.equal(result.winner, result.ga > result.gd ? '840' : '643');
    assert.equal(result.ev.filter(e => e.tid === '840').reduce((sum, e) => sum + e.pts, 0), result.ga);
    scores.add(`${Math.max(result.ga, result.gd)}–${Math.min(result.ga, result.gd)}`);
    // The score-only path decides the same rubbers; only the games inside the sets are the WTA's.
    const fast = sampleResult(makeRng(seed), prepared, 6);
    assert.deepEqual([fast.ga, fast.gd, fast.winner], [result.ga, result.gd, result.winner], `seed ${seed}`);
    const asMen = simulateTie(makeRng(seed), prepared, 6, ATP);
    assert.deepEqual([asMen.ga, asMen.gd], [result.ga, result.gd]);
    if (asMen.ev.map(e => e.score).join() !== result.ev.map(e => e.score).join()) differs++;
    for (const e of result.ev.filter(e => e.pts > 0)) {
      const played = e.score.split(' ');
      sets += played.length;
      tiebreaks += played.filter(set => set.includes('(')).length;
    }
  }
  assert.deepEqual([...scores].sort(), ['3–0', '3–1', '3–2']);
  assert.ok(differs > 250, `the WTA's games: ${differs} of 300 ties scored otherwise with the men's serve`);
  assert.ok(tiebreaks / sets < 0.16, `tie-break sets ${tiebreaks / sets}`);
});

test('the odds follow the ratings, and the live chart starts at them', () => {
  const usa = nation('840'), armenia = nation('051');
  const even = estimateWinProbability({ sport, attacker: team('a', [80, 80, 75, 75]), defender: team('d', [80, 80, 75, 75]), samples: 20000 });
  assert.ok(Math.abs(even.attacker - 0.5) < 0.015, `even ${even.attacker}`);
  const strong = estimateWinProbability({ sport, attacker: usa, defender: armenia, samples: 20000 });
  assert.ok(strong.attacker > 0.9, `the United States v Armenia ${strong.attacker}`);
  const russia = nation('643');
  const model = liveModelFor(sport, usa, russia, teamEff(usa), teamEff(russia), 6);
  assert.ok(isLiveModel(model));
  assert.equal(model.kind, 'rubbers');
  const odds = estimateWinProbability({ sport, attacker: usa, defender: russia, samples: 20000 }).attacker;
  assert.ok(Math.abs(winProbabilityAt(model, 0, 0) - odds) < 0.015, `${winProbabilityAt(model, 0, 0)} v ${odds}`);
  assert.equal(scorersLine([{ tid: 'u', name: 'Coco Gauff', pts: 1 }, { tid: 'u', name: 'Iva Jovic', pts: 0 },
    { tid: 'u', name: 'Jovic/Anisimova', pts: 1 }], 'u', {}, 'womens-tennis'), 'Gauff · Jovic/Anisimova');
});

// ---------- setup and the squad screen ----------

test('setup offers women\'s tennis after tennis, with nations only, on its built-in 2026 season', () => {
  const ids = SPORT_LIST.map(item => item.id);
  assert.equal(ids.indexOf('womens-tennis'), ids.indexOf('tennis') + 1);
  assert.equal(sport.name, 'Women\'s tennis');
  assert.match(sport.blurb, /^Billie Jean King Cup ties/);
  assert.equal(sportNote(sport), 'Nations');
  assert.deepEqual(CLUB_SCOPES(sport), []);
  assert.deepEqual(builtInSeasonOf('womens-tennis'), { year: 2026, season: '2026' });
  const model = buildSetupModel({ sport: 'womens-tennis', layer: 'clubs', scope: 'UEFA' }, {});
  assert.equal(model.layer, 'nations', 'never clubs');
  assert.equal(model.nationsOnly, true);
  // 2026, then the earlier seasons (scripts/womens-tennis-seasons.test.mjs).
  assert.equal(model.season.options[0].name, '2026');
  assert.match(model.season.note, /WTA's women: Tennis Abstract's own as of 2 November 2026 and at the end of 2016–2025/);
  const { setup, ignored } = readChallenge('?sport=womens-tennis&teams=clubs&theatre=UEFA');
  assert.deepEqual([setup.sport, setup.layer, setup.scope], ['womens-tennis', 'nations', 'UEFA']);
  assert.deepEqual(ignored, ['teams']);
  assert.match(challengeQuery({ sport: 'womens-tennis', layer: 'nations', scope: 'UEFA' }, 7), /sport=womens-tennis/);
});

test('the squad screen draws the court, says who doubles up and links each player\'s Tennis Abstract page', () => {
  const armenia = { ...nation('051'), baseEff: teamEff(nation('051')) };
  const squad = buildSquad({ teams: { '051': armenia }, aliveIds: ['051'], history: [] }, { sport }, '051');
  assert.equal(squad.layout, 'tennis');
  assert.equal(squad.viewLabel, 'Court');
  assert.deepEqual(squad.groups.map(group => [group.label, group.rows.map(row => row.name)]),
    [['Singles', ['Alina Charaeva', 'Elina Avanesyan']], ['Doubles', ['Alina Charaeva', 'Elina Avanesyan']]]);
  assert.equal(new Set(squad.pitch.map(slot => `${slot.x}|${slot.y}`)).size, 4, 'four places on the court');
  assert.deepEqual(squad.profile.map(row => row.label), ['Singles', 'Doubles']);
  assert.ok(squad.notes.includes('Charaeva and Avanesyan play the singles and the doubles: the team has 2 rated players.'));
  const gauff = buildSquad({ teams: { 840: nation('840') }, aliveIds: ['840'], history: [] }, { sport }, '840').groups[0].rows[0];
  assert.deepEqual([gauff.name, gauff.rating, gauff.source], ['Coco Gauff', 89, 'Tennis Abstract Elo']);
  assert.match(gauff.sourceTitle, /Source rating 2123.5 \(Elo scale\)/);
  assert.equal(gauff.sourceUrl, 'https://www.tennisabstract.com/cgi-bin/wplayer.cgi?p=CocoGauff');
});

// ---------- the running App ----------

const B = await bundleComponents({ App: 'src/App.jsx' }, { jsx: 'automatic' });

test('women\'s tennis sets up with nations only, launches, plays a tie and saves it', () => {
  // Denmark (208) has one rated player: Clara Tauson.
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['840', '643', '250', '826', '208'],
    settings: { sport: 'tennis', layer: 'nations', scope: 'UEFA', clubScope: 'all', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try {
    const { app } = f;
    app.pickSetup('sport', 'womens-tennis');
    assert.equal(app.state.setup.sport, 'womens-tennis');
    app.pickSetup('layer', 'clubs');
    assert.equal(app.state.setup.layer, 'nations', 'nations only');
    app.pickSetup('scope', 'world');
    app.startCampaign();
    const { state } = app;
    assert.equal(state.phase, 'playing');
    assert.match(state.campaignName, /^Women's tennis/);
    assert.deepEqual(state.aliveIds.slice().sort(), Object.keys(ROSTERS).sort(), 'the 45 nations with a team');
    assert.ok(!state.teams['208'], 'Denmark fields no team');
    assert.ok(Object.values(state.teams).every(t => t.sport === 'womens-tennis' && t.squad.every(player => !player.gen)));
    f.app.showPopup = () => {};
    f.app.showToast = () => {};
    app.startMatch('840', '643');
    const m = app.state.match;
    assert.equal(Math.max(m.finalGa, m.finalGd), 3);
    assert.equal(m.live?.kind, 'rubbers');
    const saved = parseCampaign(exportCampaign(app.state));
    assert.equal(saved.settings.sport, 'womens-tennis');
    assert.equal(saved.settings.layer, 'nations');
    assert.ok(saved.teams['840'].squad.some(player => player.name === 'Coco Gauff' && player.sourceInfo?.rawRating === 2123.5));
  } finally {
    f.close();
  }
});
