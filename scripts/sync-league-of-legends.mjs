// League of Legends' player Elo from gol.gg's results (docs/design/league-of-legends.md): each season's tournaments, each
// tournament's match list and each series' page, kept gzipped in data-src/golgg/ (git-ignored). Then rates every player by
// an Elo of the games (scripts/lib/esports-elo.mjs) and writes scripts/data/league-of-legends-elo.json, which
// npm run build-league-of-legends turns into the national teams.
//
// Usage: node scripts/sync-league-of-legends.mjs [--fetch] [--refresh-lists] [--tune] [--from=YEAR] [--max-series=N] [--pause=MS]
//   npm run sync:league-of-legends
//   --fetch          fetch the pages the cache lacks (one at a time, PAUSE_MS apart); without it nothing is fetched
//   --refresh-lists  fetch the current season's tournaments and the match lists of tournaments not yet over again
//   --tune           also score K and the circuits' starts on the last HOLDOUT_DAYS of games, before each is played
import { readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SITE, cached, golPage, readMatchList, seasonTournaments, tournamentPath } from './lib/golgg.mjs';
import { calibrationOf, circuitLevels, homesOf, leftOut, mostOf, ratedPlayers, runElo, scoreOf, snapshotText } from './lib/esports-elo.mjs';
import { ACTIVE_DAYS, CIRCUIT_LEVELS, EDITION, K_SCALE, LINEUP, MIN_GAMES, TEAM_SIZE, nationOfPlayer, nationsOf, playerOf, playOf, readCache, rolesOf,
  rowOf, seriesOf } from './lib/league-of-legends.mjs';
import { GREAT_BRITAIN } from '../src/data/teams.js';

// Great Britain plays as one, as in Rocket League and tennis.
const leagueOfLegends = { playsAs: { '826': GREAT_BRITAIN } };

const args = process.argv.slice(2);
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1];
const known = ['--fetch', '--refresh-lists', '--tune'];
const unknown = args.filter(arg => !known.includes(arg) && !/^--(from|max-series|pause)=/.test(arg));
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const fetching = args.includes('--fetch');
const refreshLists = args.includes('--refresh-lists');
const maxSeries = Number(option('max-series') ?? Infinity);
const pause = Number(option('pause') ?? 1200);
// The first season read: 2024 (Season 14).
const FIRST_YEAR = Number(option('from') ?? 2024);
const LAST_YEAR = 2026;
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cache = path.join(root, 'data-src', 'golgg');
const today = new Date().toISOString().slice(0, 10);
const snapshotFile = path.join(root, 'scripts', 'data', 'league-of-legends-elo.json');
// The days before the last game whose games score K: each predicted before it is played.
const HOLDOUT_DAYS = 180;
// The real games the match model is held against: the last two years'.
const PLAY_YEARS = 2;

// 1. Each season's tournaments.
const tournaments = [];
for (let year = LAST_YEAR; year >= FIRST_YEAR; year--) {
  const list = await seasonTournaments(year, cache, { fetching, refresh: refreshLists && year === LAST_YEAR, pause });
  if (!list) continue;
  for (const t of list) tournaments.push({ ...t, year, games: Number(t.nbgames) });
}
tournaments.sort((a, b) => b.lastgame.localeCompare(a.lastgame) || a.trname.localeCompare(b.trname));
console.log(`${tournaments.length} tournaments of ${FIRST_YEAR}–${LAST_YEAR}, ${tournaments.reduce((sum, t) => sum + t.games, 0)} games`);

// 2. Each tournament's match list, the newest first.
const series = [];
let lists = 0;
for (const t of tournaments) {
  // A tournament whose last game is within a week may still be playing.
  const current = Date.parse(today) - Date.parse(t.lastgame) < 7 * 86400000;
  const file = path.join(cache, 'matchlists', `${t.year}`, `${encodeURIComponent(t.trname)}.html.gz`);
  if (!fetching && !(await cached(file))) continue;
  const html = await golPage(`${SITE}/tournament/tournament-matchlist/${tournamentPath(t.trname)}/`, file,
    { refresh: fetching && refreshLists && current, pause });
  lists++;
  for (const one of readMatchList(html)) series.push({ ...one, tournament: t.trname, region: t.region, year: t.year });
  if (fetching && lists % 50 === 0) console.log(`  ${lists} of ${tournaments.length} match lists read: ${series.length} series so far`);
}
const games = series.reduce((sum, one) => sum + one.score[0] + one.score[1], 0);
console.log(`${lists} of ${tournaments.length} match lists read: ${series.length} series, ${games} games`);

// 3. Each series' page, the newest tournaments' first.
let fetched = 0, have = 0;
const started = Date.now();
for (const one of series) {
  const file = path.join(cache, 'series', `${one.id}.html.gz`);
  if (await cached(file)) { have++; continue; }
  if (!fetching || fetched >= maxSeries) continue;
  await golPage(`${SITE}/game/stats/${one.id}/page-${one.page}/`, file, { pause });
  fetched++;
  if (fetched % 100 === 0) {
    const rate = fetched / ((Date.now() - started) / 1000);
    const left = series.length - have - fetched;
    console.log(`  ${fetched} series pages fetched (${have} cached before), ${left} to go, ~${Math.round(left / rate / 60)} min left`);
  }
}
const files = (await readdir(path.join(cache, 'series')).catch(() => [])).length;
console.log(`${have + fetched} of ${series.length} series pages cached (${fetched} fetched now; ${files} files in data-src/golgg/series)`);
if (fetching && have + fetched < series.length) process.exit(0);

// 4. The ratings: every cached series of the seasons' tournaments, game by game.
const { series: read, people } = await readCache(cache);
const rated0 = seriesOf(read, people);
const roles = rolesOf(rated0);
const games0 = rated0.reduce((sum, one) => sum + one.games.length, 0);
if (!rated0.length) { console.error('No series cached: run with --fetch first.'); process.exit(1); }
const last = rated0.at(-1).date;
const holdout = new Date(Date.parse(last) - HOLDOUT_DAYS * 86400000).toISOString().slice(0, 10);
console.log(`
${rated0.length} series with both lineups, ${games0} games, ${rated0[0].date} to ${last}; ${people.size} players in gol.gg's list`);

if (args.includes('--tune')) {
  console.log(`
Scored on the ${HOLDOUT_DAYS} days from ${holdout}, each game before it is played:`);
  // The circuits' levels do not hang on K: fitted once, on the games before the held-out ones.
  const levels = circuitLevels(rated0, { until: holdout });
  const homes = homesOf(rated0, { until: holdout });
  for (const scale of [80, 120, 160, 200, 240, 320, 400]) {
    for (const circuits of [false, true]) {
      const starts = circuits ? levels : {};
      const { scored } = runElo(rated0, { scale, starts, homes, holdout });
      const all = scoreOf(scored.all);
      console.log(`  K ${String(scale).padStart(3)}${circuits ? ' circuits' : '         '}  log loss ${all.logLoss.toFixed(4)}`
        + `  Brier ${all.brier.toFixed(4)}  (${all.n} games)`);
    }
  }
}

const starts = CIRCUIT_LEVELS ? circuitLevels(rated0) : {};
const homes = CIRCUIT_LEVELS ? homesOf(rated0) : null;
const { players, scored } = runElo(rated0, { scale: K_SCALE, starts, homes, holdout });
const rated = ratedPlayers(players, last, { minGames: MIN_GAMES, activeDays: ACTIVE_DAYS, nationOf: nationOfPlayer })
  .map(player => ({ ...player, role: mostOf(roles.get(player.key)) }));
const calibration = calibrationOf(scored);
// How the real games of the last PLAY_YEARS went between seasoned players.
const playFrom = new Date(Date.parse(last) - PLAY_YEARS * 365 * 86400000).toISOString().slice(0, 10);
const play = playOf(rated0, { scale: K_SCALE, starts, homes, from: playFrom });
const snapshot = {
  source: { name: 'gol.gg', site: SITE, edition: EDITION, fetched: today, from: rated0[0].date, to: last,
    tournaments: new Set(rated0.map(one => one.tournament)).size, series: rated0.length, games: games0, players: players.size,
    rated: rated.length, activeDays: ACTIVE_DAYS, minGames: MIN_GAMES, kScale: K_SCALE, starts,
    holdout: { from: holdout, ...scoreOf(scored.all), calibration } },
  play,
  players: rated.map(rowOf),
};
const { players: rows, ...head } = snapshot;
await writeFile(snapshotFile, snapshotText(head, rows));

const asPlayers = snapshot.players.map((row, i) => playerOf(row, today, i + 1));
const nations = nationsOf(asPlayers, leagueOfLegends);
const { noNation, short } = leftOut(asPlayers, { lineup: LINEUP });
console.log(`\nWrote ${rated.length} rated players (of ${players.size}) to ${path.relative(root, snapshotFile)}; circuit starts ${JSON.stringify(starts)}`);
console.log(`  real games from ${playFrom} between seasoned players: ${play.games}, ${play.minutes.mean} minutes (spread ${play.minutes.spread});`
  + ` kills ${play.kills.winner}–${play.kills.loser} over ${play.kills.games} single games, Barons ${play.barons.winner} / ${play.barons.loser};`
  + ` series ${JSON.stringify(play.series)}`);
console.log(`  held out from ${holdout}: log loss ${scoreOf(scored.all).logLoss?.toFixed(4)} over ${scored.all.n} games;`
  + ` calibration ${calibration.map(([e, w, n]) => `${e}→${w} (${n})`).join(', ')}`);
console.log(`  top: ${asPlayers.slice(0, 15).map(p => `${p.name} ${p.role} ${p.rating}`).join(', ')}`);
console.log(`  ${nations.length} nations field a team: ${nations.map(n => `${n.name} ${n.str}`).join(', ')}`);
console.log(`  left out: ${noNation.length} with no country on the map (${noNation.slice(0, 15).map(p => `${p.name} ${p.flag ?? '—'}`).join(', ')}${noNation.length > 15 ? ' …' : ''}),`
  + ` ${short.length} from a nation of fewer than ${LINEUP}`);
