// Build Rocket League's earlier seasons from the committed snapshots (scripts/data/rocket-league-seasons/<year>.json,
// written by npm run sync:rocket-league from Liquipedia's exports; docs/design/rocket-league.md, "Earlier seasons").
//
//   npm run build:rocket-league-seasons   writes public/rocket-league/rl-<year>.json, public/rocket-league/ATTRIBUTION.txt,
//                                         src/data/rocketLeagueSeasons.js, src/data/rocketLeagueScoring.js and
//                                         docs/design/rocket-league-seasons-audit.json
//   --check                               builds every file and compares it byte for byte, writes nothing
//
// A season fields the nations of its year's end as the built-in season fields today's (scripts/lib/rocket-league.mjs:
// each nation's five best by Elo, the three best playing; a rating the Elo / 25 − 2), every player under the nation the
// whole record gives him. It plays its year's goal rate: the match model's goals between equals (src/sports/rocketLeague.js
// GOALS, today's) solved so that the year's real games between seasoned players, each played through the model at its own
// pre-game Elo odds, score as they did (gameMeans); the late game and overtime are today's.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { contentHash, serializeFootballSet } from '../src/data/footballSetBuild.js';
import { HISTORIC_NATIONS, HOME_NATIONS, NATIONS } from '../src/data/teams.js';
import { GOALS, gameMeans, rocketLeague } from '../src/sports/rocketLeague.js';
import { EDITION, MIN_PLAYERS, TEAM_SIZE, WIKI, binOdds, leftOut, nationsOf, playerOf, tupleOf } from './lib/rocket-league.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const snapshots = path.join(root, 'scripts', 'data', 'rocket-league-seasons');
const outDir = path.join(root, 'public', 'rocket-league');
const listingFile = path.join(root, 'src', 'data', 'rocketLeagueSeasons.js');
const scoringFile = path.join(root, 'src', 'data', 'rocketLeagueScoring.js');
const auditFile = path.join(root, 'docs', 'design', 'rocket-league-seasons-audit.json');
const attributionFile = path.join(outDir, 'ATTRIBUTION.txt');
const LICENCE = Object.freeze({ name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/' });
// A season is built only if it fields this many nations: enough for a continent of four to be offered, and every year
// from the first with rated players (2016) has more.
const MIN_NATIONS = 4;
// The record begins in September 2015, so at the end of 2016 and 2017 a rating rests on a year or two of games: those
// seasons say they are rough.
const ROUGH_BEFORE = 2018;

const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--check');
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const round = (x, places) => Math.round(x * 10 ** places) / 10 ** places;

/**
 * The goal rate between equals that brings a year's real games (`play`: their goals a game and the favourite's odds in
 * each, by ODDS_BINS) to their own goals, each at its odds → { scoring, model: { goals, overtime } }: a fixed point of
 * goals × real ÷ model, as the model's goals grow almost in proportion to its rate, to the hundredth.
 */
function solveScoring(play) {
  const bins = play.odds.map((n, bin) => [binOdds(bin), n]).filter(([, n]) => n > 0);
  const games = bins.reduce((sum, [, n]) => sum + n, 0);
  const modelAt = goals => {
    let total = 0, overtime = 0;
    for (const [odds, n] of bins) {
      const means = gameMeans(odds, goals);
      total += n * means.goals;
      overtime += n * means.overtime;
    }
    return { goals: total / games, overtime: overtime / games };
  };
  let goals = GOALS;
  for (let step = 0; step < 40; step++) {
    const next = goals * play.goals / modelAt(goals).goals;
    const settled = Math.abs(next - goals) < 1e-7;
    goals = next;
    if (settled) break;
  }
  const scoring = round(goals, 2);
  const model = modelAt(scoring);
  return { scoring, model: { goals: round(model.goals, 3), overtime: round(model.overtime, 3) } };
}

/** Season `snapshot`'s data set document, its scoring and its audit row. */
function buildSeason(snapshot) {
  const year = snapshot.season;
  const players = snapshot.players.map((row, i) => playerOf(row, snapshot.date, i + 1));
  const nations = nationsOf(players, rocketLeague);
  const fielded = new Set(nations.map(nation => nation.id));
  const territory = {
    merged: Object.fromEntries(HOME_NATIONS.map(nation => [nation, '826'])),
    inactive: Object.keys(NATIONS).filter(key => !HISTORIC_NATIONS.includes(key) && !HOME_NATIONS.includes(key) && !fielded.has(key)),
  };
  const rough = year < ROUGH_BEFORE;
  const label = `Liquipedia Elo, end of ${year}${rough ? ' (rough)' : ''}`;
  const source = {
    edition: EDITION, name: 'Liquipedia', snapshotDate: snapshot.date, retrieved: snapshot.exported, url: WIKI, rawScale: 'Elo',
    computed: true, method: `the Elo of every 3v3 series of Liquipedia's S-, A- and B-Tier events from ${snapshot.from} to the end of`
      + ` ${year} (docs/design/rocket-league.md, "Earlier seasons")`, licence: LICENCE.name, rated: snapshot.rated,
    ...(rough ? { rough: true } : {}),
  };
  const doc = {
    format: 1, kind: 'rl', id: `rl-${year}`, version: '', year, season: String(year), label, local: false, source,
    nations: Object.fromEntries(nations.map(nation => [nation.id, [nation.str, nation.players, nation.squad.map(tupleOf)]])),
    clubs: [],
    territory,
    coverage: { rated: snapshot.rated, nations: nations.length, players: nations.reduce((n, nation) => n + nation.squad.length, 0) },
  };
  doc.version = `${doc.id}-${contentHash(doc)}`;
  const scoring = solveScoring(snapshot.play);
  const { noFlag, offMap, short } = leftOut(players);
  const audit = {
    id: doc.id, version: doc.version, label, date: snapshot.date, to: snapshot.to, series: snapshot.series, games: snapshot.games,
    rated: snapshot.rated, top: players.slice(0, 5).map(player => `${player.name} ${player.elo} → ${player.rating}`),
    nations: nations.map(nation => `${nation.name} ${nation.str} (${nation.squad.map(player => `${player.name} ${player.rating}`).join(', ')}`
      + `${nation.players > nation.squad.length ? `; +${nation.players - nation.squad.length}` : ''})`),
    leftOut: { noCountry: noFlag.map(player => player.name), offTheMap: offMap.length, fewerThanThree: short.length },
    play: { games: snapshot.play.games, goals: snapshot.play.goals, overtime: snapshot.play.ot },
    scoring: { goals: scoring.scoring, model: scoring.model },
  };
  return { doc, text: serializeFootballSet(doc), scoring: { games: snapshot.play.games, goals: snapshot.play.goals, scoring: scoring.scoring }, audit };
}

function listingModule(docs) {
  for (const doc of docs) if (/['\\]/.test(doc.label)) throw new Error(`${doc.id}: a label may not hold a quote or a backslash`);
  return `// GENERATED by npm run build:rocket-league-seasons; do not edit.
// The built-in earlier Rocket League seasons, newest first: each year's players by the Elo of Liquipedia's results at its
// end, nations only. Each is public/rocket-league/<id>.json, loaded when a setup chooses it (src/engine/footballSets.js).
export const BUILT_IN_ROCKET_LEAGUE_SEASONS = Object.freeze([
${docs.map(doc => `  Object.freeze({ id: '${doc.id}', version: '${doc.version}', year: ${doc.year}, season: '${doc.season}', label: '${doc.label}' }),`).join('\n')}
]);
`;
}

function scoringModule(rows) {
  return `// GENERATED by npm run build:rocket-league-seasons; do not edit.
// Rocket League's goal rate by season (docs/design/rocket-league.md, "Earlier seasons"). \`goals\`: the goals a game of
// the year's real games between seasoned players (each of the six with 20 games behind him), as Liquipedia's results
// record them, over \`games\` games. \`scoring\`: the match model's goals between equals (src/sports/rocketLeague.js GOALS,
// today's ${GOALS}) that brings those games, each at its own pre-game Elo odds, to \`goals\`; an earlier season plays it
// (\`rocketLeagueIn\`). The built-in season, ${rows.length ? rows[0].year + 1 : 'today\'s'}, plays today's.
export const ROCKET_LEAGUE_SCORING = Object.freeze({
${rows.map(row => `  ${row.year}: Object.freeze({ games: ${row.games}, goals: ${row.goals}, scoring: ${row.scoring} }),`).join('\n')}
});
`;
}

function attributionText(docs) {
  const years = docs.map(doc => doc.year);
  const [first, last] = [Math.min(...years), Math.max(...years)];
  return `Rocket League seasons ${first}-${last} (rl-<year>.json): attribution and licence
=============================================================

The ratings in these files are computed by this project from the results of Liquipedia's Rocket League wiki
(${WIKI}): an Elo of every player, built game by game from every 3v3 series of its S-, A- and B-Tier events
from September 2015, as it stood on the last day of each year; each player's country is the one the whole record gives
him. Liquipedia publishes no ratings: these are not its numbers. See docs/design/rocket-league.md, "Earlier seasons".

Credit: Liquipedia (${WIKI}) and its contributors; each player's source links his page there.
Licence: ${LICENCE.name} (${LICENCE.url}). These files are shared under the same licence.
`;
}

async function main() {
  const check = args.includes('--check');
  const files = (await readdir(snapshots).catch(() => [])).filter(name => /^\d{4}\.json$/.test(name)).sort();
  if (!files.length) throw new Error(`No season snapshots in ${path.relative(root, snapshots)}/: run npm run sync:rocket-league`);
  const results = [];
  for (const name of files) {
    const snapshot = JSON.parse(await readFile(path.join(snapshots, name), 'utf8'));
    if (`${snapshot.season}.json` !== name) throw new Error(`${name} is the ${snapshot.season} season`);
    const result = buildSeason(snapshot);
    if (Object.keys(result.doc.nations).length < MIN_NATIONS) {
      console.log(`${snapshot.season}: ${Object.keys(result.doc.nations).length} nations field ${MIN_PLAYERS}, fewer than ${MIN_NATIONS}: no season`);
      continue;
    }
    results.push(result);
  }
  results.sort((a, b) => b.doc.year - a.doc.year);
  for (const { doc, scoring, audit } of results) {
    console.log(`${doc.id} ${doc.label}: ${doc.coverage.nations} nations, ${doc.coverage.players} players of ${doc.coverage.rated} rated;`
      + ` ${scoring.goals} goals a game over ${scoring.games} → rate ${scoring.scoring} (model ${audit.scoring.model.goals},`
      + ` ${(audit.scoring.model.overtime * 100).toFixed(1)}% to overtime; real ${(audit.play.overtime * 100).toFixed(1)}%);`
      + ` ${audit.nations.slice(0, 3).map(n => n.replace(/ \(.*$/, '')).join(', ')}`);
  }
  const docs = results.map(result => result.doc);
  const audit = {
    generatedBy: 'scripts/build-rocket-league-seasons.mjs', licence: LICENCE, teamSize: TEAM_SIZE, minPlayers: MIN_PLAYERS,
    roughBefore: ROUGH_BEFORE, todaysGoals: GOALS, seasons: results.map(result => result.audit),
  };
  const outputs = [
    ...results.map(({ doc, text }) => [path.join(outDir, `${doc.id}.json`), text]),
    [attributionFile, attributionText(docs)],
    [listingFile, listingModule(docs)],
    [scoringFile, scoringModule(results.map(result => ({ year: result.doc.year, ...result.scoring })))],
    [auditFile, `${JSON.stringify(audit, null, 2)}\n`],
  ];
  if (check) {
    const differs = [];
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    if (differs.length) throw new Error(`differs: ${differs.join(', ')}`);
    console.log(`Verified the ${results.length} Rocket League seasons, their listing, scoring, attribution and audit byte for byte.`);
    return;
  }
  await mkdir(outDir, { recursive: true });
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${results.length} seasons to ${path.relative(root, outDir)}/, ${path.relative(root, listingFile)}, `
    + `${path.relative(root, scoringFile)} and ${path.relative(root, auditFile)}`);
}

main().catch(error => {
  console.error(`build-rocket-league-seasons: ${error.message}`);
  process.exitCode = 1;
});
