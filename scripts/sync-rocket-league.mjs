// Rocket League's player Elo from Liquipedia's results: reads the wiki's own export (Special:Export's XML, saved by hand
// into data-src/liquipedia/) and writes scripts/data/rocket-league-elo.json, which npm run build-rocket-league turns into
// the national teams. Nothing is fetched: Liquipedia's robots.txt shuts Anthropic's crawlers out of the whole site and
// every bot out of its API (scripts/lib/liquipedia.mjs), so the export is made in a browser (docs/design/rocket-league.md,
// "The Liquipedia export").
//
// Usage: node scripts/sync-rocket-league.mjs [--tune]
//   npm run sync:rocket-league
//   --tune  also scores K and the regional starts on the last HOLDOUT_DAYS of games, before each is played
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readExport } from './lib/liquipedia.mjs';
import { ACTIVE_DAYS, EDITION, K_SCALE, MIN_GAMES, TIERS, homeEdge, isRegionFlag, leftOut, nationalTeams, nationOfPlayer, nationsOf, playerKey,
  playerOf, ratedPlayers, readTournaments, regionalStarts, rowOf, runElo, scoreOf, seriesInOrder } from './lib/rocket-league.mjs';

const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--tune');
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const folder = path.join(root, 'data-src', 'liquipedia');
const snapshotFile = path.join(root, 'scripts', 'data', 'rocket-league-elo.json');
const HOLDOUT_DAYS = 180;
// The stage pages worth another export: those of the events of the last three years, whose series rate today's players.
const STAGE_YEARS = 3;
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
if (args.includes('--tune')) {
  console.log(`\nScored on the ${HOLDOUT_DAYS} days from ${holdout}, each game before it is played:`);
  for (const scale of [60, 80, 110, 140, 180, 240, 320, 400, 500]) {
    for (const regional of [false, true]) {
      const starts = regional ? regionalStarts(series, { scale }) : {};
      const { scored } = runElo(series, { scale, starts, holdout });
      const all = scoreOf(scored.all), world = scoreOf(scored.international);
      console.log(`  K ${String(scale).padStart(3)}${regional ? ' regional' : '         '}  log loss ${all.logLoss.toFixed(4)}`
        + `  Brier ${all.brier.toFixed(4)}  (${all.n} games)  international ${world.logLoss?.toFixed(4) ?? '—'} (${world.n})`);
    }
  }
}

const starts = regionalStarts(series);
const { players, scored, lan } = runElo(series, { starts, holdout });
// The home crowd at a LAN, against Elo's expectation (the sport's HOME_EDGE), each side's nation as the ratings give it.
const home = homeEdge(lan, key => nationOfPlayer(players.get(key) ?? { key, flags: new Map() }, people, national));
const rated = ratedPlayers(players, last, people, national);
const exported = pages.reduce((latest, page) => (String(page.timestamp) > latest ? String(page.timestamp) : latest), '').slice(0, 10);

// What another export should add, one title a line to paste into Special:Export: the stage pages of the last three years'
// events that the export lacks, then the pages of the rated players it still has no nation for (the wiki reads a flag a
// card leaves out from there).
const cutoff = new Date(Date.parse(last) - STAGE_YEARS * 365 * 86400000).toISOString().slice(0, 10);
const stages = missing.filter(title => String(stageStarts.get(title) ?? '') >= cutoff);
// Every spelling of each, as one of them may be the page and the others redirects to it.
const spellings = new Map();
for (const [from, to] of folded) spellings.set(to, [...(spellings.get(to) ?? []), from]);
// A player filed under a country off the map (Singapore, Malta) has one: his page would add nothing.
const nationless = rated.filter(player => player.nation == null && (!player.flag || isRegionFlag(player.flag)))
  .flatMap(player => [player.key, ...(spellings.get(player.key) ?? [])]);
const list = path.join(folder, 'next-export.txt');
if (stages.length || nationless.length) {
  await writeFile(list, `${[...stages, ...nationless].join('\n')}\n`);
  console.log(`  another export would add ${stages.length} stage pages of the last ${STAGE_YEARS} years (of ${missing.length} missing)`
    + ` and ${nationless.length} rated players' pages: the titles are in ${path.relative(root, list)}, one a line.`);
}

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
    kScale: K_SCALE, starts, holdout: { from: holdout, ...scoreOf(scored.all), international: scoreOf(scored.international), calibration },
    home,
  },
  play: { ...play, goals: Math.round(play.goals / Math.max(1, play.games) * 1000) / 1000,
    ot: Math.round(play.ot / Math.max(1, play.games) * 1000) / 1000 },
  players: rated.map(rowOf),
};
// One line a header field and one a player, so a new export's diff reads player by player.
const { players: rows, ...head } = snapshot;
await writeFile(snapshotFile, `{\n${Object.entries(head).map(([key, value]) => ` ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n')},
 "players": [\n${rows.map(row => `  ${JSON.stringify(row)}`).join(',\n')}\n ]\n}\n`);

const asPlayers = snapshot.players.map((row, i) => playerOf(row, exported, i + 1));
const nations = nationsOf(asPlayers);
const { noFlag, offMap, short } = leftOut(asPlayers);
console.log(`\nWrote ${rated.length} rated players (of ${players.size}) to ${path.relative(root, snapshotFile)}; regional starts ${JSON.stringify(starts)}`);
console.log(`  held out from ${holdout}: log loss ${scoreOf(scored.all).logLoss?.toFixed(4)} over ${scored.all.n} games;`
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
