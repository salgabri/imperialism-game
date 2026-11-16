// Counter-Strike's player Elo from Liquipedia's results: reads the wiki's own export (Special:Export's XML, saved by hand
// into data-src/liquipedia-counterstrike/) and writes scripts/data/counter-strike-elo.json, which npm run
// build-counter-strike turns into the national teams. Nothing is fetched: Liquipedia's robots.txt shuts Anthropic's
// crawlers out of the whole site and every bot out of its API (scripts/lib/liquipedia.mjs), so the export is made in a
// browser (docs/design/counter-strike.md, "The Liquipedia export").
//
// Usage: node scripts/sync-counter-strike.mjs [--tune]
//   npm run sync:counter-strike
//   --tune  also scores K and the regional starts on the last HOLDOUT_DAYS of maps, before each is played
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readExport } from './lib/liquipedia.mjs';
import { ACTIVE_DAYS, EDITION, K_SCALE, MIN_GAMES, ODDS_BINS, TIERS, formatOf, homeEdge, isRegionFlag, leftOut, nationalTeams,
  nationOfPlayer, nationsOf, oddsBin, playerOf, ratedPlayers, readTournaments, regionalStarts, rowOf, runElo, scoreOf, seriesInOrder }
  from './lib/counter-strike.mjs';

const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--tune');
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const folder = path.join(root, 'data-src', 'liquipedia-counterstrike');
const snapshotFile = path.join(root, 'scripts', 'data', 'counter-strike-elo.json');
const HOLDOUT_DAYS = 180;
// The real maps the match model is held against: Counter-Strike 2's (MR12), from its first events to the export's last.
const PLAY_FROM = '2023-09-27';

const files = (await readdir(folder).catch(() => [])).filter(name => name.toLowerCase().endsWith('.xml')).sort();
if (!files.length) {
  console.error(`No Liquipedia export in ${path.relative(root, folder)}/. Save one from
  https://liquipedia.net/counterstrike/Special:Export (in a browser: add the pages, keep "Include only the current
  revision" and "Save as file"), as docs/design/counter-strike.md describes, then run this again.`);
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
const maps = series.reduce((sum, one) => sum + one.games.length, 0);
console.log(`${tournaments.length} 5v5 tournaments of tiers ${TIERS.join(', ')} in CS:GO and CS2: ${series.length} series, ${maps} maps`
  + ` (${series[0]?.date ?? '—'} to ${series.at(-1)?.date ?? '—'})`);
console.log(`  skipped: ${Object.entries(skipped).map(([reason, titles]) => `${titles.length} ${reason}`).join(', ')}`);
const recent = one => one.date >= new Date(Date.parse(series.at(-1)?.date ?? '2000-01-01') - 2 * 365 * 86400000).toISOString().slice(0, 10);
console.log(`  ${unplayable.length} series left out, a team with no roster of five near it (${unplayable.filter(recent).length} of`
  + ` the last two years): ${unplayable.filter(recent).slice(0, 10).map(one => `${one.teams.join(' v ')} (${one.event})`).join('; ')}`);
console.log(`  ${aliased.length} team templates matched to their event's roster as abbreviations: ${aliased.slice(-8).join('; ')}`);
console.log(`  ${borrowed.length} teams played with their roster at another event within four months`);
const nationEvents = tournaments.filter(tournament => tournament.nations);
console.log(`  ${national.size} players have played for a national team, at ${nationEvents.length} events: `
  + `${nationEvents.slice(-8).map(tournament => tournament.title).join('; ')}`);
console.log(`  ${folded.size} spellings of a player folded into the one his rosters use most (case and punctuation, redirects)`);
if (!series.length) process.exit(1);

const last = series.at(-1).date;
const holdout = new Date(Date.parse(last) - HOLDOUT_DAYS * 86400000).toISOString().slice(0, 10);
if (args.includes('--tune')) {
  console.log(`\nScored on the ${HOLDOUT_DAYS} days from ${holdout}, each map before it is played:`);
  for (const scale of [60, 80, 110, 140, 180, 240, 320, 400]) {
    for (const regional of [false, true]) {
      const starts = regional ? regionalStarts(series, { scale }) : {};
      const { scored } = runElo(series, { scale, starts, holdout });
      const all = scoreOf(scored.all), world = scoreOf(scored.international);
      console.log(`  K ${String(scale).padStart(3)}${regional ? ' regional' : '         '}  log loss ${all.logLoss.toFixed(4)}`
        + `  Brier ${all.brier.toFixed(4)}  (${all.n} maps)  international ${world.logLoss?.toFixed(4) ?? '—'} (${world.n})`);
    }
  }
}

// Every newcomer starts at START (scripts/lib/counter-strike.mjs, K_SCALE): regional starts foresee no better here.
const starts = {};

// How Counter-Strike 2's real maps went (MR12, from PLAY_FROM), for the match model (src/sports/counterStrike.js): only the
// maps whose ten players had each played MIN_GAMES maps before, as every rated player has (a newcomer's Elo has not yet
// found his level, so his maps run more lopsided than their odds say). By the favourite's odds before the map, in
// ODDS_BINS bins: how many, how many the favourite won, how many went to overtime, the rounds in all, and the loser's
// rounds in regulation (0 to 11; `ot` for an overtime), so the model can be played at the real maps' own odds.
const newBin = () => ({ n: 0, won: 0, ot: 0, rounds: 0, loser: new Array(12).fill(0), halves: 0, halfSwing: 0 });
const play = { from: PLAY_FROM, minGames: MIN_GAMES, maps: 0, ot: 0, rounds: 0, bins: Array.from({ length: ODDS_BINS }, newBin),
  otPeriods: {}, firstHalf: {}, series: {} };
const seriesOdds = new Map();
// The LANs' maps between seasoned players, for the home crowd's edge: a host nation's newcomers at a small local LAN start
// at START and lose more than Elo expects, which would read as a crowd against them.
const seasonedLan = [];
const countMap = (one, game, e, sides) => {
  if (!sides.flat().every(player => player.games >= MIN_GAMES)) return;
  if (one.host) seasonedLan.push({ keys: sides.map(side => side.map(player => player.key)), host: one.host, surprise: (game.winner === 1 ? 1 : 0) - e });
  if (one.date < PLAY_FROM) return;
  const format = formatOf(game, one.game);
  if (format !== 'mr12') return;
  const favourite = e >= 0.5 ? 1 : 2, odds = Math.max(e, 1 - e);
  const bin = play.bins[oddsBin(odds)];
  const winnerRounds = game.rounds[game.winner - 1], loserRounds = game.rounds[2 - game.winner];
  bin.n++;
  if (game.winner === favourite) bin.won++;
  bin.rounds += winnerRounds + loserRounds;
  play.maps++;
  play.rounds += winnerRounds + loserRounds;
  if (winnerRounds > 13) {
    bin.ot++;
    play.ot++;
    const periods = (winnerRounds - 13) / 3;
    play.otPeriods[periods] = (play.otPeriods[periods] ?? 0) + 1;
  } else bin.loser[loserRounds]++;
  // The first half's score, from the favourite's side: how far it runs from the odds within a map (the halves the wiki records).
  const first = game.halves?.find(half => half.ot === 0);
  if (first && first.rounds[0] + first.rounds[1] === 12) {
    const own = first.rounds[favourite - 1];
    play.firstHalf[own] = (play.firstHalf[own] ?? 0) + 1;
    bin.halves++;
    bin.halfSwing += (own - 6) ** 2;
  }
  // The series' favourite: its odds before its first map.
  if (!seriesOdds.has(one)) seriesOdds.set(one, e);
};
const tournamentGame = new Map(tournaments.map(tournament => [tournament.title, tournament.game]));
for (const one of series) one.game = tournamentGame.get(one.event) ?? null;
const { players, scored, lan } = runElo(series, { starts, holdout, onGame: countMap });
// The series of those maps: best of one, three and five, as they ended (from the favourite's side, by its odds before the
// first map), for the series' form: each scoreline's count, and for each by the favourite's odds (ODDS_BINS bins, each a
// row of its scorelines' counts in the order `lines` names them), so form can be fitted at the real series' own odds.
for (const [one, e] of seriesOdds) {
  if (!one.bestOf || one.bestOf % 2 === 0) continue;
  const won = [1, 2].map(side => one.games.filter(game => game.winner === side).length);
  const toWin = (one.bestOf + 1) / 2;
  if (Math.max(...won) !== toWin) continue;
  const favourite = e >= 0.5 ? 0 : 1;
  const key = `bo${one.bestOf}`;
  const lines = [];
  for (let lost = 0; lost < toWin; lost++) lines.push(`${toWin}-${lost}`);
  for (let won2 = toWin - 1; won2 >= 0; won2--) lines.push(`${won2}-${toWin}`);
  play.series[key] ??= { n: 0, odds: 0, scores: {}, lines, bins: Array.from({ length: ODDS_BINS }, () => new Array(lines.length).fill(0)) };
  const row = play.series[key];
  const scoreline = `${won[favourite]}-${won[1 - favourite]}`;
  row.n++;
  row.odds += Math.max(e, 1 - e);
  row.scores[scoreline] = (row.scores[scoreline] ?? 0) + 1;
  row.bins[oddsBin(Math.max(e, 1 - e))][row.lines.indexOf(scoreline)]++;
}
for (const row of Object.values(play.series)) row.odds = Math.round(row.odds / row.n * 1000) / 1000;
// The home crowd at a LAN, against Elo's expectation, each side's nation as the ratings give it: between seasoned players
// (`home`), and over every LAN map (`homeAll`, reported only).
const nationOfKey = key => nationOfPlayer(players.get(key) ?? { key, flags: new Map() }, people, national);
const home = homeEdge(seasonedLan, nationOfKey);
const homeAll = homeEdge(lan, nationOfKey);
const rated = ratedPlayers(players, last, people, national);
const exported = pages.reduce((latest, page) => (String(page.timestamp) > latest ? String(page.timestamp) : latest), '').slice(0, 10);
const round3 = x => Math.round(x * 1000) / 1000;

/** A snapshot file: one line a header field and one a player, so a new export's diff reads player by player. */
const writeSnapshot = (file, head, rows) => writeFile(file, `{\n${Object.entries(head).map(([key, value]) => ` ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n')},
 "players": [\n${rows.map(row => `  ${JSON.stringify(row)}`).join(',\n')}\n ]\n}\n`);

const calibration = scored.bins.filter(bin => bin.n).map(bin => [Math.round(bin.expected / bin.n * 1000) / 1000,
  Math.round(bin.won / bin.n * 1000) / 1000, bin.n]);
const snapshot = {
  source: {
    name: 'Liquipedia', wiki: 'https://liquipedia.net/counterstrike/', license: 'CC BY-SA 3.0', edition: EDITION,
    exported, files: files.length, pages: pages.length, from: series[0].date, to: last, tournaments: tournaments.length,
    series: series.length, maps, players: players.size, rated: rated.length, activeDays: ACTIVE_DAYS, minGames: MIN_GAMES,
    kScale: K_SCALE, starts, holdout: { from: holdout, ...scoreOf(scored.all), international: scoreOf(scored.international), calibration },
    home, homeAll,
  },
  play: { ...play, rounds: round3(play.rounds / Math.max(1, play.maps)), ot: round3(play.ot / Math.max(1, play.maps)),
    bins: play.bins.map(bin => [bin.n, bin.won, bin.ot, bin.rounds, bin.halves, bin.halfSwing, ...bin.loser]) },
  players: rated.map(rowOf),
};
const { players: rows, ...head } = snapshot;
await writeSnapshot(snapshotFile, head, rows);

const asPlayers = snapshot.players.map((row, i) => playerOf(row, exported, i + 1));
const nations = nationsOf(asPlayers);
const { noFlag, offMap, short } = leftOut(asPlayers);
console.log(`\nWrote ${rated.length} rated players (of ${players.size}) to ${path.relative(root, snapshotFile)}; regional starts ${JSON.stringify(starts)}`);
console.log(`  held out from ${holdout}: log loss ${scoreOf(scored.all).logLoss?.toFixed(4)} over ${scored.all.n} maps;`
  + ` calibration ${calibration.map(([e, w, n]) => `${e}→${w} (${n})`).join(', ')}`);
console.log(`  home sides at LANs, between seasoned players: ${home ? `${home.games} maps, ${home.elo} ± ${home.se} Elo against Elo's`
  + ` expectation` : 'none'} (every LAN map: ${homeAll ? `${homeAll.games}, ${homeAll.elo} ± ${homeAll.se}` : 'none'})`);
console.log(`  CS2 maps from ${PLAY_FROM} whose ten players had ${MIN_GAMES} maps: ${snapshot.play.maps}, ${snapshot.play.rounds} rounds a map,`
  + ` ${(snapshot.play.ot * 100).toFixed(1)}% to overtime (${JSON.stringify(play.otPeriods)}); series `
  + `${Object.entries(play.series).map(([key, row]) => `${key} ${row.n} at ${row.odds}: ${JSON.stringify(row.scores)}`).join('; ')}`);
console.log(`  top: ${asPlayers.slice(0, 15).map(p => `${p.name} ${p.rating}`).join(', ')}`);
console.log(`  ${nations.length} nations field a team: ${nations.map(n => `${n.name} ${n.str}`).join(', ')}`);
console.log(`  left out: ${noFlag.length} with no country (${noFlag.slice(0, 12).map(p => p.name).join(', ')}${noFlag.length > 12 ? ' …' : ''}),`
  + ` ${offMap.length} from a country off the map, ${short.length} from a nation of fewer than five`);
// A flag no nation answers to may be a code the aliases lack rather than a country off the map: each with its count.
const unknownFlags = new Map();
for (const player of offMap) unknownFlags.set(player.flag, (unknownFlags.get(player.flag) ?? 0) + 1);
if (unknownFlags.size) console.log(`  flags no nation answers to: ${[...unknownFlags].map(([flag, n]) => `${flag} ×${n}`).join(', ')}`);
console.log(`  ${people.size} player pages read for their country`);

// What another export should add, one title a line to paste into Special:Export: the stage pages the exports' events link
// to but lack, the newest first (none of an event yet to begin: it has no results), then the pages of the players rated
// today whom it still has no nation for, the best first, each under every spelling of him. A title an export already
// holds has nothing more to give.
const spellings = new Map();
for (const [from, to] of folded) spellings.set(to, [...(spellings.get(to) ?? []), from]);
const held = new Set(pages.map(page => page.title));
const stages = missing.filter(title => String(stageStarts.get(title) ?? '') <= last)
  .sort((a, b) => String(stageStarts.get(b) ?? '').localeCompare(String(stageStarts.get(a) ?? '')) || a.localeCompare(b));
const nationless = rated.filter(player => player.nation == null && !(player.flag && !isRegionFlag(player.flag)))
  .flatMap(player => [player.key, ...(spellings.get(player.key) ?? [])]);
const titles = [...new Set([...stages, ...nationless])].filter(title => !held.has(title));
const list = path.join(folder, 'next-export.txt');
if (titles.length) {
  await writeFile(list, `${titles.join('\n')}\n`);
  console.log(`\nAnother export would add ${stages.length} stage pages and the pages of ${nationless.length} rated players with no nation`
    + ` (${titles.length} titles in all): they are in ${path.relative(root, list)}, one a line.`);
}
