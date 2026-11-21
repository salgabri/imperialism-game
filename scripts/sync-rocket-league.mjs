// Rocket League's player Elo from Liquipedia's results: reads the wiki's own export (Special:Export's XML, saved by hand
// into data-src/liquipedia/) and writes scripts/data/rocket-league-elo.json, which npm run build-rocket-league turns into
// the national teams, and scripts/data/rocket-league-seasons/<year>.json, each earlier year's players as rated on its last
// day, which npm run build:rocket-league-seasons turns into the earlier seasons. Nothing is fetched: Liquipedia's
// robots.txt shuts Anthropic's crawlers out of the whole site and every bot out of its API (scripts/lib/liquipedia.mjs),
// so the export is made in a browser (docs/design/rocket-league.md, "The Liquipedia export").
//
// Usage: node scripts/sync-rocket-league.mjs [--tune]
//   npm run sync:rocket-league
//   --tune  also scores K, with and without the regions' levels, on the last HOLDOUT_DAYS of games, before each is played
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readExport } from './lib/liquipedia.mjs';
import { ACTIVE_DAYS, EDITION, K_SCALE, LEVEL_TAU, MIN_GAMES, ODDS_BINS, OFFSET_TAU, TIERS, homeEdge, homesOf, isRegionFlag, leftOut,
  nationalTeams, nationOfPlayer, nationsOf, oddsBin, playerKey, playerOf, playersAsOf, ratedPlayers, readTournaments, regionLevels,
  rowOf, runElo, scoreOf, seriesInOrder } from './lib/rocket-league.mjs';

const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--tune');
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const folder = path.join(root, 'data-src', 'liquipedia');
const snapshotFile = path.join(root, 'scripts', 'data', 'rocket-league-elo.json');
const seasonsDir = path.join(root, 'scripts', 'data', 'rocket-league-seasons');
const HOLDOUT_DAYS = 180;
// The real games the match model is held against: the last three years' (scoring between seasoned players has been
// steady since 2022).
const PLAY_YEARS = 3;

const files = (await readdir(folder).catch(() => [])).filter(name => name.toLowerCase().endsWith('.xml')).sort();
if (!files.length) {
  console.error(`No Liquipedia export in ${path.relative(root, folder)}/. Save one from
  https://liquipedia.net/rocketleague/Special:Export (in a browser: add the pages, keep "Include only the current
  revision" and "Save as file"), as docs/design/rocket-league.md describes, then run this again.`);
  process.exit(1);
}
const pages = [];
for (const name of files) {
  const found = readExport(await readFile(path.join(folder, name), 'utf8'));
  console.log(`${name}: ${found.length} pages`);
  pages.push(...found);
}

const { tournaments, missing, stageStarts, skipped, people, folded } = readTournaments(pages);
const { series, unplayable, borrowed, aliased } = seriesInOrder(tournaments);
const national = nationalTeams(tournaments);
const games = series.reduce((sum, one) => sum + one.games.length, 0);
console.log(`${tournaments.length} 3v3 tournaments of tiers ${TIERS.join(', ')}: ${series.length} series, ${games} games`
  + ` (${series[0]?.date ?? '—'} to ${series.at(-1)?.date ?? '—'})`);
console.log(`  skipped: ${skipped.mode.length} of another mode, ${skipped.tier.length} of another tier, ${skipped.school.length} schools'`
  + ` leagues, ${skipped.noInfobox.length} pages under no tournament`);
const recent = one => one.date >= new Date(Date.parse(series.at(-1)?.date ?? '2000-01-01') - 2 * 365 * 86400000).toISOString().slice(0, 10);
console.log(`  ${unplayable.length} series left out, a team with no roster of three near it (${unplayable.filter(recent).length} of`
  + ` the last two years): ${unplayable.filter(recent).slice(0, 10).map(one => `${one.teams.join(' v ')} (${one.event})`).join('; ')}`);
console.log(`  ${aliased.length} team templates matched to their event's roster as abbreviations: ${aliased.slice(-8).join('; ')}`);
console.log(`  ${borrowed.length} teams played with their roster at another event within four months`);
console.log(`  ${national.size} players have played for a national team (the FIFAe World Cup, the Esports Nations Cup)`);
console.log(`  ${folded.size} spellings of a player folded into the one his rosters use most (case and punctuation, redirects)`);
if (!series.length) process.exit(1);

const last = series.at(-1).date;
const holdout = new Date(Date.parse(last) - HOLDOUT_DAYS * 86400000).toISOString().slice(0, 10);
// Each player's nation as the whole record gives it (his national teams, flags and page), for a home no regional event gives.
const { players: everyone } = runElo(series);
const nationOf = key => nationOfPlayer(everyone.get(key) ?? { key, flags: new Map() }, people, national);
if (args.includes('--tune')) {
  console.log(`\nScored on the ${HOLDOUT_DAYS} days from ${holdout}, each game before it is played (the regions' levels and homes`
    + ' from the games before; between two regions: games whose sides are each most of one region\'s players):');
  // The levels do not hang on K: fitted once, on the games before the held-out ones.
  const homesBefore = homesOf(series, { until: holdout, nationOf });
  const levelsBefore = regionLevels(series, homesBefore, { until: holdout });
  console.log(`  levels before ${holdout}: ${JSON.stringify(levelsBefore)}`);
  for (const scale of [60, 80, 110, 140, 180, 240, 320, 400, 500]) {
    for (const levels of [false, true]) {
      const { scored } = runElo(series, { scale, starts: levels ? levelsBefore : {}, homes: homesBefore, holdout });
      const all = scoreOf(scored.all), world = scoreOf(scored.international), cross = scoreOf(scored.cross);
      console.log(`  K ${String(scale).padStart(3)}${levels ? ' levels' : '       '}  log loss ${all.logLoss.toFixed(4)}`
        + `  Brier ${all.brier.toFixed(4)}  (${all.n} games)  between regions ${cross.logLoss?.toFixed(4) ?? '—'} (${cross.n})`
        + `  international ${world.logLoss?.toFixed(4) ?? '—'} (${world.n})`);
    }
  }
}

// A newcomer starts at his region's level (docs/design/rocket-league.md, "Regions"): his home the RLCS region whose events
// he has played most games in, else his nation's; each region's level fitted at once with every player's own strength.
const homes = homesOf(series, { nationOf });
const starts = regionLevels(series, homes);
// Each year's real games between seasoned players (as `play` below has them), for its season's goal rate
// (scripts/build-rocket-league-seasons.mjs): how many, their goals and overtimes, and the favourite's odds in each.
const yearPlay = new Map();
const countYear = (one, game, e, sides) => {
  if (!game.goals || !sides.flat().every(player => player.games >= MIN_GAMES)) return;
  const year = Number(one.date.slice(0, 4));
  if (!yearPlay.has(year)) yearPlay.set(year, { games: 0, goals: 0, ot: 0, odds: new Array(ODDS_BINS).fill(0) });
  const row = yearPlay.get(year);
  row.games++;
  row.goals += game.goals[0] + game.goals[1];
  if (game.ot) row.ot++;
  row.odds[oddsBin(e)]++;
};
const { players, scored, lan } = runElo(series, { starts, homes, holdout, onGame: countYear });
// The home crowd at a LAN, against Elo's expectation (the sport's HOME_EDGE), each side's nation as the ratings give it.
const home = homeEdge(lan, key => nationOfPlayer(players.get(key) ?? { key, flags: new Map() }, people, national));
const rated = ratedPlayers(players, last, people, national, homes);
const exported = pages.reduce((latest, page) => (String(page.timestamp) > latest ? String(page.timestamp) : latest), '').slice(0, 10);
const round3 = x => Math.round(x * 1000) / 1000;

/** A snapshot file: one line a header field and one a player, so a new export's diff reads player by player. */
const writeSnapshot = (file, head, rows) => writeFile(file, `{\n${Object.entries(head).map(([key, value]) => ` ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n')},
 "players": [\n${rows.map(row => `  ${JSON.stringify(row)}`).join(',\n')}\n ]\n}\n`);

// How the real games of the last PLAY_YEARS went, the game as it is played now, for the match model
// (src/sports/rocketLeague.js): goals, overtime, margins, series scores. Only the games whose six players had each played
// MIN_GAMES before, as every rated player has: a newcomer's Elo has not yet found his level, so his games are more
// lopsided than their odds say (more goals, fewer overtimes), and the model, played at those odds, is not meant for them.
const playFrom = new Date(Date.parse(last) - PLAY_YEARS * 365 * 86400000).toISOString().slice(0, 10);
const play = { from: playFrom, minGames: MIN_GAMES, games: 0, goals: 0, ot: 0, margins: {}, series: {} };
const played = new Map();
const seasoned = keys => keys.every(key => (played.get(key) ?? 0) >= MIN_GAMES);
for (const one of series) {
  const keys = one.teams.flat().map(playerKey);
  const recent = one.date >= playFrom;
  const won = [1, 2].map(side => one.games.filter(game => game.winner === side).length);
  const toWin = Math.max(...won);
  if (recent && seasoned(keys) && one.bestOf && toWin === (one.bestOf + 1) / 2) {
    const key = `bo${one.bestOf}`;
    const scoreline = `${toWin}-${Math.min(...won)}`;
    play.series[key] ??= {};
    play.series[key][scoreline] = (play.series[key][scoreline] ?? 0) + 1;
  }
  for (const game of one.games) {
    if (recent && game.goals && seasoned(keys)) {
      play.games++;
      play.goals += game.goals[0] + game.goals[1];
      if (game.ot) play.ot++;
      const margin = Math.abs(game.goals[0] - game.goals[1]);
      play.margins[margin] = (play.margins[margin] ?? 0) + 1;
    }
    for (const key of keys) played.set(key, (played.get(key) ?? 0) + 1);
  }
}

const calibration = scored.bins.filter(bin => bin.n).map(bin => [Math.round(bin.expected / bin.n * 1000) / 1000,
  Math.round(bin.won / bin.n * 1000) / 1000, bin.n]);
const snapshot = {
  source: {
    name: 'Liquipedia', wiki: 'https://liquipedia.net/rocketleague/', license: 'CC BY-SA 3.0', edition: EDITION,
    exported, files: files.length, pages: pages.length, from: series[0].date, to: last, tournaments: tournaments.length,
    series: series.length, games, players: players.size, rated: rated.length, activeDays: ACTIVE_DAYS, minGames: MIN_GAMES,
    kScale: K_SCALE, levels: { offsetTau: OFFSET_TAU, levelTau: LEVEL_TAU }, starts,
    holdout: { from: holdout, ...scoreOf(scored.all), international: scoreOf(scored.international), betweenRegions: scoreOf(scored.cross),
      calibration },
    home,
  },
  play: { ...play, goals: round3(play.goals / Math.max(1, play.games)), ot: round3(play.ot / Math.max(1, play.games)) },
  players: rated.map(rowOf),
};
const { players: rows, ...head } = snapshot;
await writeSnapshot(snapshotFile, head, rows);

const asPlayers = snapshot.players.map((row, i) => playerOf(row, exported, i + 1));
const nations = nationsOf(asPlayers);
const { noFlag, offMap, short } = leftOut(asPlayers);
console.log(`\nWrote ${rated.length} rated players (of ${players.size}) to ${path.relative(root, snapshotFile)}; regions' levels ${JSON.stringify(starts)}`);
console.log(`  held out from ${holdout}: log loss ${scoreOf(scored.all).logLoss?.toFixed(4)} over ${scored.all.n} games`
  + ` (between regions ${scoreOf(scored.cross).logLoss?.toFixed(4)} over ${scored.cross.n});`
  + ` calibration ${calibration.map(([e, w, n]) => `${e}→${w} (${n})`).join(', ')}`);
console.log(`  home sides at LANs: ${home ? `${home.games} games, ${home.elo} ± ${home.se} Elo against Elo's expectation` : 'none'}`);
console.log(`  real games from ${playFrom} whose six players had ${MIN_GAMES} games: ${snapshot.play.games} with goals,`
  + ` ${snapshot.play.goals} goals a game, ${(snapshot.play.ot * 100).toFixed(1)}% to overtime;`
  + ` series ${JSON.stringify(play.series)}`);
console.log(`  top: ${asPlayers.slice(0, 12).map(p => `${p.name} ${p.rating}`).join(', ')}`);
console.log(`  ${nations.length} nations field a team: ${nations.map(n => `${n.name} ${n.str}`).join(', ')}`);
console.log(`  left out: ${noFlag.length} with no country (${noFlag.slice(0, 12).map(p => p.name).join(', ')}${noFlag.length > 12 ? ' …' : ''}),`
  + ` ${offMap.length} from a country off the map, ${short.length} from a nation of fewer than three`);
// A flag no nation answers to may be a code the aliases lack rather than a country off the map: each with its count.
const unknownFlags = new Map();
for (const player of offMap) unknownFlags.set(player.flag, (unknownFlags.get(player.flag) ?? 0) + 1);
if (unknownFlags.size) console.log(`  flags no nation answers to: ${[...unknownFlags].map(([flag, n]) => `${flag} ×${n}`).join(', ')}`);
console.log(`  ${people.size} player pages read for their country`);

// The earlier seasons (docs/design/rocket-league.md, "Earlier seasons"): every calendar year from the first game's to the
// one before the export's last, its players as rated on its last day (playersAsOf), each newcomer at his region's level as
// the games to that day measure it (homesOf and regionLevels over them: nothing a later year showed), and its real games
// between seasoned players (yearPlay), for npm run build:rocket-league-seasons.
await mkdir(seasonsDir, { recursive: true });
const seasonRated = [];
console.log(`\nEarlier seasons, each as rated on 31 December, to ${path.relative(root, seasonsDir)}:`);
for (let year = Number(series[0].date.slice(0, 4)); year < Number(last.slice(0, 4)); year++) {
  const date = `${year}-12-31`;
  const upTo = series.filter(one => one.date <= date);
  const homesThen = homesOf(upTo, { nationOf });
  const startsThen = regionLevels(upTo, homesThen);
  const ratedThen = playersAsOf(series, date, { starts: startsThen, homes: homesThen, people, national, whole: players });
  if (!ratedThen.length) {
    console.log(`  ${year}: nobody rated yet (${upTo.reduce((sum, one) => sum + one.games.length, 0)} games so far)`);
    continue;
  }
  seasonRated.push(ratedThen);
  const thatYear = yearPlay.get(year) ?? { games: 0, goals: 0, ot: 0, odds: new Array(ODDS_BINS).fill(0) };
  const season = { season: year, date, exported, from: series[0].date, to: upTo.at(-1).date, series: upTo.length,
    games: upTo.reduce((sum, one) => sum + one.games.length, 0), rated: ratedThen.length, activeDays: ACTIVE_DAYS, minGames: MIN_GAMES,
    starts: startsThen,
    play: { games: thatYear.games, goals: round3(thatYear.goals / Math.max(1, thatYear.games)), ot: round3(thatYear.ot / Math.max(1, thatYear.games)),
      odds: thatYear.odds } };
  await writeSnapshot(path.join(seasonsDir, `${year}.json`), season, ratedThen.map(rowOf));
  const fielded = nationsOf(ratedThen.map((player, i) => playerOf(rowOf(player), date, i + 1)));
  console.log(`  ${year}: ${ratedThen.length} rated, ${fielded.length} nations (${fielded.slice(0, 4).map(n => `${n.name} ${n.str}`).join(', ')}…);`
    + ` levels ${JSON.stringify(startsThen)};`
    + ` ${season.play.games} games between seasoned players, ${season.play.goals} goals a game, ${(season.play.ot * 100).toFixed(1)}% to overtime`);
}

// What another export should add, one title a line to paste into Special:Export: the stage pages the exports' events link
// to but lack, the newest first, then the pages of the players rated today or at an earlier season's end whom it still
// has no nation for, the best first (the wiki reads a flag a card leaves out from there), each under every spelling of
// him, as one of them may be the page and the others redirects to it. A title an export already holds has nothing more to
// give (a redirect's target is listed in its place), and a player filed under a country off the map (Singapore, Malta)
// has one: his page would add nothing.
const spellings = new Map();
for (const [from, to] of folded) spellings.set(to, [...(spellings.get(to) ?? []), from]);
const held = new Set(pages.map(page => page.title));
const stages = missing.slice().sort((a, b) => String(stageStarts.get(b) ?? '').localeCompare(String(stageStarts.get(a) ?? '')) || a.localeCompare(b));
const best = new Map();
for (const player of [rated, ...seasonRated].flat()) {
  if (player.nation != null || (player.flag && !isRegionFlag(player.flag))) continue;
  best.set(player.key, Math.max(best.get(player.key) ?? -Infinity, player.elo));
}
const nationless = [...best].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).flatMap(([key]) => [key, ...(spellings.get(key) ?? [])]);
const titles = [...new Set([...stages, ...nationless])].filter(title => !held.has(title));
const list = path.join(folder, 'next-export.txt');
if (titles.length) {
  await writeFile(list, `${titles.join('\n')}\n`);
  console.log(`\nAnother export would add ${stages.length} stage pages and the pages of ${best.size} rated players with no nation`
    + ` (${titles.length} titles in all): they are in ${path.relative(root, list)}, one a line.`);
}
