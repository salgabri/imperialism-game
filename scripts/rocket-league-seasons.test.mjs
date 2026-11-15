// Rocket League's earlier seasons (docs/design/rocket-league.md, "Earlier seasons"): each year from 2016 to 2025 as the
// Elo of Liquipedia's results stood on its last day, built from committed snapshots; nations only, each player under the
// nation the whole record gives him; each season at its own year's goal rate, solved on its real games; the loader, the
// match model and its live chart, and the running App choosing, launching and resuming a season.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SAVE_KEY } from '../src/config.js';
import { ROSTERS } from '../src/data/rosters.rocket-league.js';
import { BUILT_IN_ROCKET_LEAGUE_SEASONS } from '../src/data/rocketLeagueSeasons.js';
import { ROCKET_LEAGUE_SCORING } from '../src/data/rocketLeagueScoring.js';
import { HISTORIC_NATIONS, HOME_NATIONS, NATIONS, buildTeam, makeRng } from '../src/data/teams.js';
import {
  BUILT_IN_SETS, builtInSeasonOf, decodeFootballSet, fieldedNations, seasonSport, setHasClubs, setHasNations, setSportOf, sportOf,
} from '../src/engine/footballSets.js';
import { parseCampaign } from '../src/engine/storage.js';
import { isLiveModel, liveModelFor, winProbabilityAt } from '../src/engine/winProbability.js';
import { matchSport } from '../src/sports/index.js';
import { GOALS, gameMeans, rocketLeague, rocketLeagueIn } from '../src/sports/rocketLeague.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { readChallenge } from '../src/screens/setup/challenge.js';
import { ACTIVE_DAYS, MIN_GAMES, gameRating } from './lib/rocket-league.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const seasonFile = year => JSON.parse(read(`public/rocket-league/rl-${year}.json`));
const snapshot = year => JSON.parse(read(`scripts/data/rocket-league-seasons/${year}.json`));
const squadNames = (doc, nation) => doc.nations[nation][2].map(([name]) => name);
const YEARS = Array.from({ length: 2025 - 2016 + 1 }, (_, i) => 2025 - i);
const days = (from, to) => (Date.parse(to) - Date.parse(from)) / 86400000;

// ---------- building ----------

test('every season rebuilds byte for byte from its committed snapshot, each a year\'s players as rated on its last day', () => {
  assert.match(execFileSync(process.execPath, ['scripts/build-rocket-league-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the 10 Rocket League seasons, their listing, scoring, attribution and audit byte for byte/);
  for (const year of YEARS) {
    const data = snapshot(year);
    assert.deepEqual([data.season, data.date], [year, `${year}-12-31`]);
    assert.ok(data.to <= data.date && data.from === '2015-09-10');
    assert.equal(data.rated, data.players.length);
    assert.ok(data.players.every((row, i) => i === 0 || row[5] <= data.players[i - 1][5]), `${year} runs strongest first`);
    assert.ok(data.players.every(row => row[6] >= MIN_GAMES), `${year}: ${MIN_GAMES} games each`);
    assert.ok(data.players.every(row => row[8] <= data.date && days(row[8], data.date) <= ACTIVE_DAYS), `${year}: each played within the year`);
    assert.equal(new Set(data.players.map(row => row[0])).size, data.players.length, `${year}: no player listed twice`);
    assert.equal(data.play.odds.reduce((sum, n) => sum + n, 0), data.play.games, `${year}: each real game in one odds bin`);
  }
  // The record begins in September 2015: nobody has twenty games by the end of that year, so 2016 is the first season.
  assert.throws(() => read('scripts/data/rocket-league-seasons/2015.json'));
});

test('the built-in seasons run from 2025 back to 2016, the first two rough', () => {
  assert.deepEqual(BUILT_IN_ROCKET_LEAGUE_SEASONS.map(set => set.id), YEARS.map(year => `rl-${year}`));
  assert.equal(builtInSeasonOf('rocket-league').season, '2026', 'the built-in season stays 2026\'s');
  const label = year => BUILT_IN_ROCKET_LEAGUE_SEASONS.find(set => set.year === year).label;
  assert.equal(label(2025), 'Liquipedia Elo, end of 2025');
  assert.equal(label(2018), 'Liquipedia Elo, end of 2018');
  assert.equal(label(2017), 'Liquipedia Elo, end of 2017 (rough)', 'a rating then rests on a year or two of games');
  assert.equal(label(2016), 'Liquipedia Elo, end of 2016 (rough)');
  for (const listed of BUILT_IN_ROCKET_LEAGUE_SEASONS) {
    const set = BUILT_IN_SETS.find(entry => entry.id === listed.id);
    assert.deepEqual(set, listed, `${listed.id} is listed as built`);
    assert.equal(setSportOf(set.id), 'rocket-league');
    assert.ok(setHasNations(set.id) && !setHasClubs(set.id), 'nations only');
    assert.equal(seasonFile(set.year).version, listed.version);
  }
});

// ---------- the seasons ----------

test('every season decodes: three to five players a nation, each his Elo of that day on the game\'s scale', () => {
  for (const year of YEARS) {
    const doc = seasonFile(year);
    const set = decodeFootballSet(doc, doc.id);
    assert.deepEqual([set.meta.year, set.meta.season, doc.clubs.length], [year, String(year), 0]);
    for (const [str, players, squad] of Object.values(doc.nations)) {
      assert.ok(squad.length >= 3 && squad.length <= 5 && players >= squad.length);
      assert.equal(str, Math.round(squad.slice(0, 3).reduce((sum, [, , rating]) => sum + rating, 0) / 3 * 10) / 10, 'its three best play');
      assert.equal(new Set(squad.map(([name]) => name)).size, squad.length, `${year}: a name of his own each`);
      for (const [, pos, rating, source] of squad) {
        assert.equal(pos, 'PLR');
        assert.equal(rating, gameRating(source.rawRating), `${year}: ${source.id} is his Elo on the game's scale`);
        assert.deepEqual([source.source, source.edition, source.snapshotDate, source.rawScale], ['liquipedia', 'Liquipedia Elo', `${year}-12-31`, 'Elo']);
        assert.ok(source.lastPlayed <= `${year}-12-31` && source.url.startsWith('https://liquipedia.net/rocketleague/'));
      }
    }
    assert.ok(HOME_NATIONS.every(home => doc.territory.merged[home] === '826'), 'Great Britain plays as one');
    assert.equal(doc.coverage.nations, Object.keys(doc.nations).length);
    assert.deepEqual([doc.source.edition, doc.source.licence, doc.source.computed, !!doc.source.rough], ['Liquipedia Elo', 'CC BY-SA 3.0', true, year < 2018]);
  }
  // The nations grow with the game: nine at the end of 2016, fifty by 2025 (the national-team events of 2025).
  assert.deepEqual(YEARS.map(year => seasonFile(year).coverage.nations), [50, 27, 33, 30, 29, 24, 18, 13, 11, 9]);
});

test('each season is its day\'s: Kaydop\'s France and mist\'s United States in 2019, Saudi Arabia ahead in 2021', () => {
  const doc = seasonFile(2019);
  assert.deepEqual(squadNames(doc, '840').slice(0, 3), ['mist', 'jstn.', 'GarrettG']);
  assert.ok(squadNames(doc, '250').includes('Kaydop') && squadNames(doc, '250').includes('Ferra'));
  assert.equal(doc.nations['840'][2][0][3].team, 'Pittsburgh Knights', 'each player\'s team of that day');
  const top = year => Object.entries(seasonFile(year).nations).sort((a, b) => b[1][0] - a[1][0])[0][0];
  assert.equal(top(2021), '682', 'Saudi Arabia led at the end of 2021');
  assert.equal(top(2017), '528', 'the Netherlands (remkoe) at the end of 2017');
  // The built-in season's rule for a name two share: each shown by his page.
  assert.deepEqual(ROSTERS['512'][2].map(([name]) => name).filter(name => name.startsWith('Abdullah')), ['Abdullah', 'Abdullahrll']);
});

// ---------- the goal rate of each season ----------

test('each season scores as its year did: its rate solved so its real games, at their own odds, bring their own goals', () => {
  const audit = JSON.parse(read('docs/design/rocket-league-seasons-audit.json'));
  assert.deepEqual(Object.keys(ROCKET_LEAGUE_SCORING).map(Number).sort(), YEARS.slice().sort());
  for (const row of audit.seasons) {
    const year = Number(row.id.slice(3));
    assert.equal(ROCKET_LEAGUE_SCORING[year].scoring, row.scoring.goals);
    assert.ok(Math.abs(row.scoring.model.goals - row.play.goals) <= 0.01, `${year}: ${row.scoring.model.goals} goals where ${row.play.goals} were scored`);
    assert.ok(row.scoring.goals > 3.3 && row.scoring.goals < 4.1, `${year}: a rate of ${row.scoring.goals}`);
  }
  // 2019 and 2020 scored least (3.86 and 3.90 goals a game), so their rates are the lowest; 2022-2025 are close to today's
  // 3.8.
  const byRate = Object.keys(ROCKET_LEAGUE_SCORING).map(Number)
    .sort((a, b) => ROCKET_LEAGUE_SCORING[a].scoring - ROCKET_LEAGUE_SCORING[b].scoring);
  assert.deepEqual(byRate.slice(0, 2).sort(), [2019, 2020]);
  assert.ok([2022, 2023, 2024, 2025].every(year => Math.abs(ROCKET_LEAGUE_SCORING[year].scoring - GOALS) < 0.1));
  // The model's goals grow with the rate, and an even game's are a little more than the rate (the late game, overtime).
  const even = gameMeans(0.5, GOALS);
  assert.ok(even.goals > GOALS && even.goals < GOALS + 0.6 && even.overtime > 0.2 && even.overtime < 0.3);
  assert.ok(gameMeans(0.5, 3.48).goals < even.goals && gameMeans(0.5, 3.48).overtime > even.overtime, 'fewer goals, more overtime');
});

test('a season plays its rate; the winners are Elo\'s at any rate, so only its goals differ from today\'s', () => {
  const settings = { sport: 'rocket-league', layer: 'nations', dataSet: 'rl-2019', dataYear: 2019 };
  const sport2019 = matchSport(settings);
  assert.equal(sport2019, rocketLeagueIn(settings));
  assert.equal(sport2019.rules.goals, ROCKET_LEAGUE_SCORING[2019].scoring);
  assert.equal(matchSport({ sport: 'rocket-league', layer: 'nations' }), rocketLeague, 'the built-in season plays today\'s');
  assert.equal(matchSport({ ...settings, dataYear: 1999 }), rocketLeague, 'a year the table lacks plays today\'s');
  const set = decodeFootballSet(seasonFile(2019), 'rl-2019');
  const bound = seasonSport(set);
  const us = buildTeam('840', makeRng(1), bound), france = buildTeam('250', makeRng(2), bound);
  let goalsThen = 0, goalsNow = 0, games = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const then = sport2019.simulate(makeRng(seed), us, france, 6);
    const now = rocketLeague.simulate(makeRng(seed), us, france, 6);
    assert.deepEqual([then.ga, then.gd, then.winner], [now.ga, now.gd, now.winner], 'the same draws decide the same games');
    goalsThen += then.ev.filter(e => e.pts === 0).length;
    goalsNow += now.ev.filter(e => e.pts === 0).length;
    games += then.ga + then.gd;
  }
  assert.ok(goalsThen / games < goalsNow / games - 0.2, `2019 scores less: ${(goalsThen / games).toFixed(2)} a game, today ${(goalsNow / games).toFixed(2)}`);
  // The live chart plays the season's rate in the game in play, and names it; today's names none.
  const live = liveModelFor(sport2019, us, france, us.squad[0].rating, france.squad[0].rating, 6);
  const today = liveModelFor(rocketLeague, us, france, us.squad[0].rating, france.squad[0].rating, 6);
  assert.equal(live.goals, ROCKET_LEAGUE_SCORING[2019].scoring);
  assert.equal(today.goals, undefined);
  assert.ok(isLiveModel(live) && !isLiveModel({ ...live, goals: 0 }));
  // Before a goal the odds are Elo's at any rate, but for the grid of goal splits each rate reads its odds from (a few in
  // 100,000 a game).
  assert.ok(Math.abs(winProbabilityAt(live, 0, 0) - winProbabilityAt(today, 0, 0)) < 1e-4, 'before a goal, the odds are Elo\'s at any rate');
});

// ---------- the loader ----------

test('the loader refuses a Rocket League season that is not the builder\'s', () => {
  const doc = seasonFile(2019);
  const broken = edit => { const copy = JSON.parse(JSON.stringify(doc)); edit(copy); return () => decodeFootballSet(copy, copy.id); };
  assert.throws(broken(d => { d.season = '2018/19'; }), /season "2018\/19" must be "2019"/);
  assert.throws(broken(d => { d.nations['840'][2] = d.nations['840'][2].slice(0, 2); }), /three to five players/);
  assert.throws(broken(d => { d.nations['840'][2][1][1] = 'SGL'; }), /position must be PLR/);
  assert.throws(broken(d => { d.nations['840'][2].reverse(); }), /strongest first/);
  assert.throws(broken(d => { d.clubs = [{}]; }), /a Rocket League season has nations only/);
  assert.throws(broken(d => { delete d.territory.merged.SCO; }), /home nations in the United Kingdom, as Great Britain plays as one/);
  assert.throws(broken(d => { d.territory.inactive.pop(); }), /every nation the season neither lists nor merges/);
  assert.throws(broken(d => { d.kind = 'elo'; }), /kind "elo" is not the kind its id names/);
});

test('a season binds Rocket League to its nations; every other nation\'s land stays neutral', () => {
  const set = decodeFootballSet(seasonFile(2019), 'rl-2019');
  const sport = seasonSport(set);
  assert.deepEqual([sport.id, sport.dataSet, sport.dataSeason, sport.nationsOnly], ['rocket-league', 'rl-2019', '2019', true]);
  const fielded = fieldedNations(sport);
  assert.deepEqual(fielded.slice().sort(), Object.keys(set.rosters).sort());
  const team = buildTeam('840', makeRng(2019), sport);
  assert.deepEqual(team.squad.map(player => player.name), squadNames(seasonFile(2019), '840'));
  assert.equal(team.name, 'United States');
  assert.equal(buildTeam('826', makeRng(1), sport).name, 'Great Britain');
  assert.equal(sportOf({ sport: 'rocket-league', layer: 'nations', dataSet: 'rl-2019' }), null, 'until it has loaded');
  assert.equal(Object.keys(NATIONS).length - HISTORIC_NATIONS.length, set.territory.inactive.length + Object.keys(set.territory.merged).length + fielded.length);
});

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
  clearFootballSetIndex: ['src/engine/footballSets.js', 'clearFootballSetIndex'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

// The United States, France, Britain, Brazil, the Netherlands and Australia.
async function withApp(fn, ids = ['840', '250', '826', '076', '528', '036']) {
  const calls = [];
  const fetch = async url => {
    calls.push(String(url));
    const [, id] = String(url).match(/^\/rocket-league\/(rl-\d{4})\.json$/) || [];
    let text = null;
    try { text = id && read(`public/rocket-league/${id}.json`); } catch { text = null; }
    return text ? { ok: true, status: 200, json: async () => JSON.parse(text) }
      : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids,
    settings: { sport: 'rocket-league', layer: 'nations', scope: 'world', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn({ ...f, calls }); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}
const modelOf = app => buildSetupModel(app.state.setup, { managerTeams: app.setupTeams(), domestic: app.domesticStatus(), season: app.seasonStatus() });

test('Rocket League\'s Season choice lists 2026 and the ten earlier seasons, newest first', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'rocket-league');
    const model = modelOf(app);
    assert.deepEqual(model.season.options.map(option => option.name), ['2026', ...YEARS.map(String)]);
    assert.equal(model.season.options[1].label, '2025 · Liquipedia Elo, end of 2025');
    assert.equal(model.season.options.at(-1).label, '2016 · Liquipedia Elo, end of 2016 (rough)');
    assert.match(model.season.note, /at the end of each year from 2016/);
    app.pickSetup('dataSet', 'rl-2019');
    assert.deepEqual([app.state.setup.layer, app.state.setup.dataSet], ['nations', 'rl-2019']);
    time.advance(200);
    await app.loadSet('rl-2019');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(modelOf(app).canLaunch, true);
    app.pickSetup('sport', 'tennis');
    assert.equal(app.state.setup.dataSet, null, 'a season stays with its sport');
  });
});

test('a season launches with that year\'s nations, plays at its rate and resumes as it was played', async () => {
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'rocket-league');
    app.pickSetup('scope', 'world');
    app.pickSetup('dataSet', 'rl-2019');
    time.advance(200);
    await app.loadSet('rl-2019');
    await settle();
    const doc = seasonFile(2019);
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.layer, st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason],
      ['nations', 'rl-2019', doc.version, 2019, '2019']);
    assert.ok(calls.includes('/rocket-league/rl-2019.json'));
    assert.deepEqual(st.teams['840'].squad.map(player => player.name), squadNames(doc, '840'), 'mist\'s United States');
    assert.ok(st.teams['840'].squad.every(player => player.sourceInfo.edition === 'Liquipedia Elo' && !player.gen));
    assert.equal(matchSport(st.settings).rules.goals, ROCKET_LEAGUE_SCORING[2019].scoring);
    const saved = parseCampaign(items.get(SAVE_KEY));
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams), 'the squads come back exactly');
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams));
    const edited = edit => { const data = JSON.parse(items.get(SAVE_KEY)); edit(data.settings); if (data.initialSettings) edit(data.initialSettings); return JSON.stringify(data); };
    assert.throws(() => parseCampaign(edited(s => { s.dataSeason = '2018/19'; })), /Campaign data set is invalid/);
  });
});

test('a challenge link to a Rocket League season loads it', async () => {
  await withApp(async ({ app, time }) => {
    const link = readChallenge('?sport=rocket-league&theatre=world&season=rl-2023&seed=1');
    assert.deepEqual(link.ignored, []);
    app.setState({ setup: link.setup });
    app.showSetupSet();
    time.advance(200);
    await app.loadSet('rl-2023');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(app.state.setup.dataSet, 'rl-2023');
  });
});
