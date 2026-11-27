// League of Legends' earlier seasons (docs/design/league-of-legends.md, "Earlier seasons"): each year from 2016 to 2025 as the
// Elo of gol.gg's results stood on its last day, built from committed snapshots; nations only, each player at the role he
// played, on a scale whose best are today's best; each season's games as long and as bloody as its year's; the loader, the
// match model, and the running App choosing, launching and resuming a season.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SAVE_KEY } from '../src/config.js';
import { BUILT_IN_LEAGUE_OF_LEGENDS_SEASONS } from '../src/data/leagueOfLegendsSeasons.js';
import { LEAGUE_OF_LEGENDS_GAMES } from '../src/data/leagueOfLegendsGames.js';
import { HISTORIC_NATIONS, HOME_NATIONS, NATIONS, buildTeam, makeRng, selectLineup } from '../src/data/teams.js';
import {
  BUILT_IN_SETS, builtInSeasonOf, decodeFootballSet, fieldedNations, seasonSport, setHasClubs, setHasNations, setSportOf, sportOf,
} from '../src/engine/footballSets.js';
import { liveModelFor, winProbabilityAt } from '../src/engine/winProbability.js';
import { parseCampaign } from '../src/engine/storage.js';
import { matchSport } from '../src/sports/index.js';
import { GAMES_TODAY, ROLES, leagueOfLegends, leagueOfLegendsIn, playGame } from '../src/sports/leagueOfLegends.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { readChallenge } from '../src/screens/setup/challenge.js';
import { ACTIVE_DAYS, K_SCALE, MIN_GAMES, gameRating } from './lib/league-of-legends.mjs';
import { ANCHOR_PLAYERS, FIRST_SEASON, LAST_SEASON, TOP_RATING, WINDOW_YEARS } from './lib/league-of-legends-seasons.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const seasonFile = year => JSON.parse(read(`public/league-of-legends/lol-${year}.json`));
const snapshot = year => JSON.parse(read(`scripts/data/league-of-legends-seasons/${year}.json`));
const squadNames = (doc, nation) => doc.nations[nation][2].map(([name]) => name);
const YEARS = Array.from({ length: LAST_SEASON - FIRST_SEASON + 1 }, (_, i) => LAST_SEASON - i);
const days = (from, to) => (Date.parse(to) - Date.parse(from)) / 86400000;

// ---------- building ----------

test('every season rebuilds byte for byte from its committed snapshot, each a year\'s players as rated on its last day', () => {
  assert.match(execFileSync(process.execPath, ['scripts/build-league-of-legends-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the 10 League of Legends seasons, their listing, games, attribution and audit byte for byte/);
  for (const year of YEARS) {
    const data = snapshot(year);
    assert.deepEqual([data.season, data.date, data.kScale], [year, `${year}-12-31`, K_SCALE]);
    assert.ok(data.to <= data.date && data.from >= `${year - WINDOW_YEARS + 1}-01-01`, `${year}: its own window's games`);
    assert.equal(data.rated, data.players.length);
    assert.ok(data.players.every((row, i) => i === 0 || row[5] <= data.players[i - 1][5]), `${year} runs strongest first`);
    assert.ok(data.players.every(row => row[6] >= MIN_GAMES), `${year}: ${MIN_GAMES} games each`);
    assert.ok(data.players.every(row => row[8] <= data.date && days(row[8], data.date) <= ACTIVE_DAYS), `${year}: each played within the year`);
    assert.ok(data.players.every(row => ROLES.includes(row[4])), `${year}: each at a role`);
    assert.equal(new Set(data.players.map(row => row[0])).size, data.players.length, `${year}: no player listed twice`);
  }
  // gol.gg's players lists are whole from 2016.
  assert.throws(() => read(`scripts/data/league-of-legends-seasons/${FIRST_SEASON - 1}.json`));
});

test('the built-in seasons run from 2025 back to 2016, the first rough', () => {
  assert.deepEqual(BUILT_IN_LEAGUE_OF_LEGENDS_SEASONS.map(set => set.id), YEARS.map(year => `lol-${year}`));
  assert.equal(builtInSeasonOf('league-of-legends').season, '2026', 'the built-in season stays 2026\'s');
  const label = year => BUILT_IN_LEAGUE_OF_LEGENDS_SEASONS.find(set => set.year === year).label;
  assert.deepEqual([label(2025), label(2017), label(2016)], ['gol.gg Elo, end of 2025', 'gol.gg Elo, end of 2017', 'gol.gg Elo, end of 2016 (rough)']);
  for (const listed of BUILT_IN_LEAGUE_OF_LEGENDS_SEASONS) {
    const set = BUILT_IN_SETS.find(entry => entry.id === listed.id);
    assert.deepEqual(set, listed, `${listed.id} is listed as built`);
    assert.equal(setSportOf(set.id), 'league-of-legends');
    assert.ok(setHasNations(set.id) && !setHasClubs(set.id), 'nations only');
    assert.equal(seasonFile(set.year).version, listed.version);
  }
});

// ---------- the seasons ----------

test('every season decodes: five to seven players a nation at their roles, each his Elo of that day on the season\'s scale', () => {
  for (const year of YEARS) {
    const doc = seasonFile(year);
    const set = decodeFootballSet(doc, doc.id);
    assert.deepEqual([set.meta.year, set.meta.season, doc.clubs.length], [year, String(year), 0]);
    const { base } = doc.source;
    assert.equal(base, snapshot(year).base);
    for (const [id, [str, players, squad]] of Object.entries(doc.nations)) {
      assert.ok(squad.length >= 5 && squad.length <= 7 && players >= squad.length);
      assert.equal(new Set(squad.map(([name]) => name)).size, squad.length, `${year}: a name of his own each`);
      for (const [, pos, rating, source] of squad) {
        assert.ok(ROLES.includes(pos));
        assert.equal(rating, gameRating(source.rawRating, base), `${year}: ${source.id} is his Elo on the season's scale`);
        assert.ok(rating >= 1 && rating <= 99);
        assert.deepEqual([source.source, source.edition, source.snapshotDate, source.rawScale], ['golgg', 'gol.gg Elo', `${year}-12-31`, 'Elo']);
        assert.ok(source.lastPlayed <= `${year}-12-31` && source.url.startsWith('https://gol.gg/players/player-stats/'));
      }
      const lineup = selectLineup({ sport: 'league-of-legends', squad: squad.map(([name, pos, rating]) => ({ name, pos, rating })) });
      assert.equal(lineup.rating, str, `${year} ${id}: the lineup the game picks`);
    }
    assert.ok(HOME_NATIONS.every(home => doc.territory.merged[home] === '826'), 'Great Britain plays as one');
    assert.equal(doc.coverage.nations, Object.keys(doc.nations).length);
    assert.deepEqual([doc.source.edition, doc.source.name, doc.source.computed, !!doc.source.rough], ['gol.gg Elo', 'gol.gg', true, year === 2016]);
  }
});

test('a season\'s scale: its strongest players average what the built-in season\'s do, its best never above 98', () => {
  const todays = JSON.parse(read('scripts/data/league-of-legends-elo.json')).players.slice(0, ANCHOR_PLAYERS).map(row => row[5]);
  const mean = list => list.reduce((a, b) => a + b, 0) / list.length;
  for (const year of YEARS) {
    const { base, players } = snapshot(year);
    const best = players.slice(0, ANCHOR_PLAYERS).map(row => row[5]);
    const anchored = Math.abs((mean(best) - base) - (mean(todays) - 100)) <= 1;
    const capped = gameRating(players[0][5], base) === TOP_RATING && mean(best) - base < mean(todays) - 100;
    assert.ok(anchored || capped, `${year}: base ${base}`);
    assert.ok(gameRating(players[0][5], base) <= TOP_RATING, `${year}: its best reads ${gameRating(players[0][5], base)}`);
  }
});

// ---------- the games of each season ----------

test('each season\'s games go as its year\'s did: longer and less bloody the further back', () => {
  assert.deepEqual(Object.keys(LEAGUE_OF_LEGENDS_GAMES).map(Number).sort(), YEARS.slice().sort());
  const todays = JSON.parse(read('scripts/data/league-of-legends-seasons/built-in-games.json'));
  assert.equal(todays.season, LAST_SEASON + 1);
  for (const year of YEARS) {
    const games = LEAGUE_OF_LEGENDS_GAMES[year];
    const { play } = snapshot(year);
    assert.deepEqual(Object.keys(games), Object.keys(GAMES_TODAY));
    assert.ok(Math.abs(games.minutes - GAMES_TODAY.minutes * play.minutes / todays.minutes) <= 0.05, `${year}: ${games.minutes} minutes`);
    assert.ok(Math.abs(games.winnerKills - GAMES_TODAY.winnerKills * play.kills.winner / todays.kills.winner) <= 0.05);
    assert.ok(games.winnerKills > games.loserKills && games.winnerBaron > games.loserBaron && games.winnerBaron < 1);
  }
  assert.ok(LEAGUE_OF_LEGENDS_GAMES[2016].minutes > LEAGUE_OF_LEGENDS_GAMES[2019].minutes && LEAGUE_OF_LEGENDS_GAMES[2019].minutes > LEAGUE_OF_LEGENDS_GAMES[2023].minutes);
  assert.ok(LEAGUE_OF_LEGENDS_GAMES[2018].winnerKills < LEAGUE_OF_LEGENDS_GAMES[2021].winnerKills && LEAGUE_OF_LEGENDS_GAMES[2021].winnerKills < LEAGUE_OF_LEGENDS_GAMES[2025].winnerKills);
  const settings = { sport: 'league-of-legends', layer: 'nations', dataSet: 'lol-2016', dataYear: 2016 };
  const sport2016 = matchSport(settings);
  assert.equal(sport2016, leagueOfLegendsIn(settings));
  assert.deepEqual(sport2016.rules.games, LEAGUE_OF_LEGENDS_GAMES[2016]);
  assert.equal(sport2016.simulationVersion, leagueOfLegends.simulationVersion, 'the games change no result');
  assert.equal(matchSport({ sport: 'league-of-legends', layer: 'nations' }), leagueOfLegends, 'the built-in season plays today\'s games');
  assert.equal(matchSport({ ...settings, dataYear: 1999 }), leagueOfLegends, 'a year the table lacks plays today\'s');
  const set = decodeFootballSet(seasonFile(2016), 'lol-2016');
  const bound = seasonSport(set);
  const korea = buildTeam('410', makeRng(1), bound), china = buildTeam('156', makeRng(2), bound);
  for (let seed = 1; seed <= 200; seed++) {
    const then = sport2016.simulate(makeRng(seed), korea, china, 6);
    const now = leagueOfLegends.simulate(makeRng(seed), korea, china, 6);
    assert.deepEqual([then.ga, then.gd, then.winner], [now.ga, now.gd, now.winner], 'the same draws decide the same series');
  }
  // The year's lengths and kills come out of the games.
  const rng = makeRng(2016);
  const played = Array.from({ length: 20000 }, () => playGame(rng, 'A', LEAGUE_OF_LEGENDS_GAMES[2016]));
  const mean = f => played.reduce((sum, game) => sum + f(game), 0) / played.length;
  assert.ok(Math.abs(mean(game => game.minutes) - LEAGUE_OF_LEGENDS_GAMES[2016].minutes) < 0.2);
  assert.ok(Math.abs(mean(game => game.kills.A) - LEAGUE_OF_LEGENDS_GAMES[2016].winnerKills) < 0.2);
  // The live chart knows the games won and the gap, not how long a game was: the same at any season.
  const at = (sport, a, b) => winProbabilityAt(liveModelFor(sport, a, b), [], 0);
  assert.equal(at(sport2016, korea, china), at(leagueOfLegends, korea, china));
});

// ---------- the loader ----------

test('the loader refuses a League of Legends season that is not the builder\'s', () => {
  const doc = seasonFile(2019);
  const broken = edit => { const copy = JSON.parse(JSON.stringify(doc)); edit(copy); return () => decodeFootballSet(copy, copy.id); };
  assert.throws(broken(d => { d.season = '2018/19'; }), /season "2018\/19" must be "2019"/);
  assert.throws(broken(d => { d.nations['410'][2] = d.nations['410'][2].slice(0, 4); }), /five to seven players/);
  assert.throws(broken(d => { d.nations['410'][2][1][1] = 'PLR'; }), /position must be TOP, JGL, MID, BOT, SUP/);
  assert.throws(broken(d => { d.nations['410'][2].reverse(); }), /strongest first/);
  assert.throws(broken(d => { d.clubs = [{}]; }), /a League of Legends season has nations only/);
  assert.throws(broken(d => { delete d.territory.merged.SCO; }), /home nations in the United Kingdom, as Great Britain plays as one/);
  assert.throws(broken(d => { d.territory.inactive.pop(); }), /every nation the season neither lists nor merges/);
  assert.throws(broken(d => { d.kind = 'val'; }), /kind "val" is not the kind its id names/);
});

test('a season binds League of Legends to its nations; every other nation\'s land stays neutral', () => {
  const set = decodeFootballSet(seasonFile(2019), 'lol-2019');
  const sport = seasonSport(set);
  assert.deepEqual([sport.id, sport.dataSet, sport.dataSeason, sport.nationsOnly], ['league-of-legends', 'lol-2019', '2019', true]);
  const fielded = fieldedNations(sport);
  assert.deepEqual(fielded.slice().sort(), Object.keys(set.rosters).sort());
  const team = buildTeam('410', makeRng(2019), sport);
  assert.deepEqual(team.squad.map(player => player.name), squadNames(seasonFile(2019), '410'));
  assert.equal(team.name, 'South Korea');
  assert.equal(sportOf({ sport: 'league-of-legends', layer: 'nations', dataSet: 'lol-2019' }), null, 'until it has loaded');
  assert.equal(Object.keys(NATIONS).length - HISTORIC_NATIONS.length, set.territory.inactive.length + Object.keys(set.territory.merged).length + fielded.length
    - (fielded.includes('826') ? 0 : 0));
});

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
  clearFootballSetIndex: ['src/engine/footballSets.js', 'clearFootballSetIndex'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

// South Korea, China, the United States, Denmark, France and Germany: each fields a team in every season.
const FIELDED = ['410', '156', '840', '208', '250', '276'];
async function withApp(fn, ids = FIELDED) {
  const calls = [];
  const fetch = async url => {
    calls.push(String(url));
    const [, id] = String(url).match(/^\/league-of-legends\/(lol-\d{4})\.json$/) || [];
    let text = null;
    try { text = id && read(`public/league-of-legends/${id}.json`); } catch { text = null; }
    return text ? { ok: true, status: 200, json: async () => JSON.parse(text) }
      : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids,
    settings: { sport: 'league-of-legends', layer: 'nations', scope: 'world', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn({ ...f, calls }); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}
const modelOf = app => buildSetupModel(app.state.setup, { managerTeams: app.setupTeams(), domestic: app.domesticStatus(), season: app.seasonStatus() });

test('League of Legends\' Season choice lists 2026 and the ten earlier seasons, newest first', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'league-of-legends');
    const model = modelOf(app);
    assert.deepEqual(model.season.options.map(option => option.name), ['2026', ...YEARS.map(String)]);
    assert.equal(model.season.options[1].label, '2025 · gol.gg Elo, end of 2025');
    assert.match(model.season.note, /at the end of each year from 2016 \(2016 rough\), each year at its own length of game and its own kills/);
    app.pickSetup('dataSet', 'lol-2016');
    assert.deepEqual([app.state.setup.layer, app.state.setup.dataSet], ['nations', 'lol-2016']);
    time.advance(200);
    await app.loadSet('lol-2016');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(modelOf(app).canLaunch, true);
    app.pickSetup('sport', 'valorant');
    assert.equal(app.state.setup.dataSet, null, 'a season stays with its sport');
  });
});

test('a season launches with that year\'s nations, plays its games and resumes as it was played', async () => {
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'league-of-legends');
    app.pickSetup('scope', 'world');
    app.pickSetup('dataSet', 'lol-2019');
    time.advance(200);
    await app.loadSet('lol-2019');
    await settle();
    const doc = seasonFile(2019);
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.layer, st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason],
      ['nations', 'lol-2019', doc.version, 2019, '2019']);
    assert.ok(calls.includes('/league-of-legends/lol-2019.json'));
    assert.deepEqual(st.teams['410'].squad.map(player => player.name), squadNames(doc, '410'));
    assert.ok(st.teams['410'].squad.every(player => player.sourceInfo.edition === 'gol.gg Elo' && !player.gen));
    assert.deepEqual(matchSport(st.settings).rules.games, LEAGUE_OF_LEGENDS_GAMES[2019]);
    const saved = parseCampaign(items.get(SAVE_KEY));
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams), 'the squads come back exactly');
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams));
  });
});

test('a challenge link to a League of Legends season loads it', async () => {
  await withApp(async ({ app, time }) => {
    const link = readChallenge('?sport=league-of-legends&theatre=world&season=lol-2022&seed=1');
    assert.deepEqual(link.ignored, []);
    app.setState({ setup: link.setup });
    app.showSetupSet();
    time.advance(200);
    await app.loadSet('lol-2022');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(app.state.setup.dataSet, 'lol-2022');
  });
});
