// Build League of Legends' earlier seasons from the committed snapshots (scripts/data/league-of-legends-seasons/<year>.json,
// written by npm run sync:league-of-legends-seasons from gol.gg's results; docs/design/league-of-legends.md, "Earlier
// seasons").
//
//   npm run build:league-of-legends-seasons   writes public/league-of-legends/lol-<year>.json, its ATTRIBUTION.txt,
//                                             src/data/leagueOfLegendsSeasons.js, src/data/leagueOfLegendsGames.js and
//                                             docs/design/league-of-legends-seasons-audit.json
//   --check                                   builds every file and compares it byte for byte, writes nothing
//
// A season fields the nations of its year's end as the built-in season fields today's (scripts/lib/league-of-legends.mjs: each
// nation's best player in each role, then its best others, seven in all; a rating (Elo − the season's base) / 25), and plays
// games of its year's length, kills and Barons: today's constants, each scaled by the year's figure over today's year's, both
// read off gol.gg the same way (the snapshots' `play`).
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { contentHash, serializeFootballSet } from '../src/data/footballSetBuild.js';
import { HISTORIC_NATIONS, HOME_NATIONS, NATIONS } from '../src/data/teams.js';
import { GAMES_TODAY, leagueOfLegends } from '../src/sports/leagueOfLegends.js';
import { leftOut } from './lib/esports-elo.mjs';
import { EDITION, LINEUP, SITE_URL, TEAM_SIZE, nationsOf, playerOf, tupleOf } from './lib/league-of-legends.mjs';
import { ANCHOR_PLAYERS, LAST_SEASON, TOP_RATING, WINDOW_YEARS } from './lib/league-of-legends-seasons.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const snapshots = path.join(root, 'scripts', 'data', 'league-of-legends-seasons');
const outDir = path.join(root, 'public', 'league-of-legends');
const listingFile = path.join(root, 'src', 'data', 'leagueOfLegendsSeasons.js');
const gamesFile = path.join(root, 'src', 'data', 'leagueOfLegendsGames.js');
const auditFile = path.join(root, 'docs', 'design', 'league-of-legends-seasons-audit.json');
const attributionFile = path.join(outDir, 'ATTRIBUTION.txt');
const countriesFile = path.join(root, 'scripts', 'data', 'league-of-legends-countries.json');
// A season is built only if it fields this many nations: enough for a continent of four to be offered.
const MIN_NATIONS = 4;
// The last year whose record holds one year's games of the great leagues alone: its ratings say they are rough.
const ROUGH_UNTIL = 2016;

const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--check');
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const round = (x, places) => Math.round(x * 10 ** places) / 10 ** places;

/**
 * How a season's games go: today's constants (GAMES_TODAY), each times the year's figure over the built-in year's (`todays`),
 * the same measure of both. A side's chance of a Baron grows as its Barons a game do: 1 − (1 − today's)^(the year's / today's).
 */
function gamesOf(play, todays) {
  const times = (figure, now) => figure / now;
  const baron = (chance, figure, now) => 1 - (1 - chance) ** times(figure, now);
  return {
    minutes: round(GAMES_TODAY.minutes * times(play.minutes, todays.minutes), 1),
    spread: round(GAMES_TODAY.spread * times(play.minutes, todays.minutes), 1),
    winnerKills: round(GAMES_TODAY.winnerKills * times(play.kills.winner, todays.kills.winner), 1),
    loserKills: round(GAMES_TODAY.loserKills * times(play.kills.loser, todays.kills.loser), 1),
    winnerBaron: round(baron(GAMES_TODAY.winnerBaron, play.nashors.winner, todays.nashors.winner), 2),
    loserBaron: round(baron(GAMES_TODAY.loserBaron, play.nashors.loser, todays.nashors.loser), 2),
  };
}

/** Season `snapshot`'s data set document, its games and its audit row. */
function buildSeason(snapshot, todays) {
  const year = snapshot.season;
  const players = snapshot.players.map((row, i) => playerOf(row, snapshot.date, i + 1, snapshot.base));
  const nations = nationsOf(players, leagueOfLegends);
  const fielded = new Set(nations.map(nation => nation.id));
  const territory = {
    merged: Object.fromEntries(HOME_NATIONS.map(nation => [nation, '826'])),
    inactive: Object.keys(NATIONS).filter(key => !HISTORIC_NATIONS.includes(key) && !HOME_NATIONS.includes(key) && !fielded.has(key)),
  };
  const rough = year <= ROUGH_UNTIL;
  const label = `gol.gg Elo, end of ${year}${rough ? ' (rough)' : ''}`;
  const source = {
    edition: EDITION, name: 'gol.gg', snapshotDate: snapshot.date, retrieved: snapshot.fetched, url: SITE_URL, rawScale: 'Elo',
    computed: true, ...(rough ? { rough: true } : {}),
    method: `the Elo of every game gol.gg records of the leagues and the international events from ${snapshot.from} to the end of ${year}, each newcomer`
      + ` starting at his league's level as those games set it, a rating (Elo ${snapshot.base < 0 ? '+' : '−'} ${Math.abs(snapshot.base)}) / 25: the season's`
      + ` ${ANCHOR_PLAYERS} strongest players average what the built-in season's do, its best at ${TOP_RATING} or below (docs/design/league-of-legends.md,`
      + ' "Earlier seasons")',
    base: snapshot.base, rated: snapshot.rated,
  };
  const doc = {
    format: 1, kind: 'lol', id: `lol-${year}`, version: '', year, season: String(year), label, local: false, source,
    nations: Object.fromEntries(nations.map(nation => [nation.id, [nation.str, nation.players, nation.squad.map(tupleOf)]])),
    clubs: [],
    territory,
    coverage: { rated: snapshot.rated, nations: nations.length, players: nations.reduce((n, nation) => n + nation.squad.length, 0) },
  };
  doc.version = `${doc.id}-${contentHash(doc)}`;
  const { noNation, short } = leftOut(players, { lineup: LINEUP });
  const games = gamesOf(snapshot.play, todays);
  const audit = {
    id: doc.id, version: doc.version, label, date: snapshot.date, from: snapshot.from, to: snapshot.to, tournaments: snapshot.tournaments, series: snapshot.series,
    games: snapshot.games, rated: snapshot.rated, base: snapshot.base,
    top: players.slice(0, 5).map(player => `${player.name} ${player.role} ${player.elo} → ${player.rating}`),
    nations: nations.map(nation => `${nation.name} ${nation.str} (${nation.squad.map(player => `${player.name} ${player.role} ${player.rating}`).join(', ')}`
      + `${nation.players > nation.squad.length ? `; +${nation.players - nation.squad.length}` : ''})`),
    leftOut: { noNation: noNation.length, noCountry: snapshot.noCountry, fewerThanFive: short.length },
    levels: Object.fromEntries(Object.entries(snapshot.starts).sort((a, b) => b[1] - a[1])),
    lineups: snapshot.lineups, play: snapshot.play, plays: games,
  };
  return { doc, text: serializeFootballSet(doc), games, audit };
}

function listingModule(docs) {
  for (const doc of docs) if (/['\\]/.test(doc.label)) throw new Error(`${doc.id}: a label may not hold a quote or a backslash`);
  return `// GENERATED by npm run build:league-of-legends-seasons; do not edit.
// The built-in earlier League of Legends seasons, newest first: each year's players by the Elo of gol.gg's results at its end,
// nations only. Each is public/league-of-legends/<id>.json, loaded when a setup chooses it (src/engine/footballSets.js).
export const BUILT_IN_LEAGUE_OF_LEGENDS_SEASONS = Object.freeze([
${docs.map(doc => `  Object.freeze({ id: '${doc.id}', version: '${doc.version}', year: ${doc.year}, season: '${doc.season}', label: '${doc.label}' }),`).join('\n')}
]);
`;
}

function gamesModule(rows) {
  const row = games => Object.entries(games).map(([key, value]) => `${key}: ${value}`).join(', ');
  return `// GENERATED by npm run build:league-of-legends-seasons; do not edit.
// How League of Legends' games went, by season (docs/design/league-of-legends.md, "Earlier seasons"): their mean length and
// its spread in minutes, the winner's and the loser's kills in a game of that length, and each one's chance of a Baron:
// today's constants (src/sports/leagueOfLegends.js GAMES_TODAY), each scaled by the year's figure over 2026's as gol.gg gives
// both. An earlier season plays them (\`leagueOfLegendsIn\`); the built-in season, ${LAST_SEASON + 1}, plays today's.
export const LEAGUE_OF_LEGENDS_GAMES = Object.freeze({
${rows.map(({ year, games }) => `  ${year}: Object.freeze({ ${row(games)} }),`).join('\n')}
});
`;
}

/** The lists the countries gol.gg lacks came from (scripts/data/league-of-legends-countries.json), as credited. */
const CREDITS = { 'esportsearnings.com': 'esportsearnings.com (https://www.esportsearnings.com)', 'Wikidata (CC0)': 'Wikidata (https://www.wikidata.org, CC0)' };

function attributionText(docs, countrySources) {
  const years = docs.map(doc => doc.year);
  const [first, last] = [Math.min(...years), Math.max(...years)];
  const named = countrySources.map(name => name.replace(/ \(CC0\)$/, ''));
  const either = named.length > 1 ? `${named.slice(0, -1).join(', ')} or ${named.at(-1)}` : named[0];
  const credited = countrySources.map(name => CREDITS[name] ?? name);
  const both = credited.length > 1 ? `${credited.slice(0, -1).join(', ')} and ${credited.at(-1)}` : credited[0];
  return `League of Legends seasons ${first}-${last} (lol-<year>.json): attribution
===========================================================

The ratings in these files are computed by this project from the match results gol.gg (Games of Legends, ${SITE_URL})
records: an Elo of every player, built game by game from the leagues and the international events of each year and the year
before, each newcomer starting at his league's level, as it stood on the last day of the year. gol.gg publishes no ratings:
these are not its numbers. Each player's country is the one gol.gg files him under, or, for players it files under none,
the one ${either} does. See docs/design/league-of-legends.md, "Earlier seasons".

Credit: gol.gg (${SITE_URL}); each player's source links his page there.
Countries gol.gg lacks: ${both}.
`;
}

async function main() {
  const check = args.includes('--check');
  const files = (await readdir(snapshots).catch(() => [])).filter(name => /^\d{4}\.json$/.test(name)).sort();
  if (!files.length) throw new Error(`No season snapshots in ${path.relative(root, snapshots)}/: run npm run sync:league-of-legends-seasons`);
  const todays = JSON.parse(await readFile(path.join(snapshots, 'built-in-games.json'), 'utf8'));
  const countrySources = JSON.parse(await readFile(countriesFile, 'utf8')).source.names;
  const results = [];
  for (const name of files) {
    const snapshot = JSON.parse(await readFile(path.join(snapshots, name), 'utf8'));
    if (`${snapshot.season}.json` !== name) throw new Error(`${name} is the ${snapshot.season} season`);
    const result = buildSeason(snapshot, todays);
    if (Object.keys(result.doc.nations).length < MIN_NATIONS) {
      console.log(`${snapshot.season}: ${Object.keys(result.doc.nations).length} nations field ${LINEUP}, fewer than ${MIN_NATIONS}: no season`);
      continue;
    }
    results.push(result);
  }
  results.sort((a, b) => b.doc.year - a.doc.year);
  for (const { doc, games, audit } of results) {
    console.log(`${doc.id} ${doc.label}: ${doc.coverage.nations} nations, ${doc.coverage.players} players of ${doc.coverage.rated} rated;`
      + ` ${games.minutes} minutes, kills ${games.winnerKills}–${games.loserKills}, Barons ${games.winnerBaron} / ${games.loserBaron};`
      + ` ${audit.nations.slice(0, 4).map(n => n.replace(/ \(.*$/, '')).join(', ')}`);
  }
  const docs = results.map(result => result.doc);
  const audit = {
    generatedBy: 'scripts/build-league-of-legends-seasons.mjs', teamSize: TEAM_SIZE, lineup: LINEUP, windowYears: WINDOW_YEARS, anchorPlayers: ANCHOR_PLAYERS,
    todaysGames: GAMES_TODAY, todaysYear: todays, seasons: results.map(result => result.audit),
  };
  const outputs = [
    ...results.map(({ doc, text }) => [path.join(outDir, `${doc.id}.json`), text]),
    [attributionFile, attributionText(docs, countrySources)],
    [listingFile, listingModule(docs)],
    [gamesFile, gamesModule(results.map(result => ({ year: result.doc.year, games: result.games })))],
    [auditFile, `${JSON.stringify(audit, null, 2)}\n`],
  ];
  if (check) {
    const differs = [];
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    if (differs.length) throw new Error(`differs: ${differs.join(', ')}`);
    console.log(`Verified the ${results.length} League of Legends seasons, their listing, games, attribution and audit byte for byte.`);
    return;
  }
  await mkdir(outDir, { recursive: true });
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${results.length} seasons to ${path.relative(root, outDir)}/, ${path.relative(root, listingFile)}, `
    + `${path.relative(root, gamesFile)} and ${path.relative(root, auditFile)}`);
}

main().catch(error => {
  console.error(`build-league-of-legends-seasons: ${error.message}`);
  process.exitCode = 1;
});
