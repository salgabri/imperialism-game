// Build Counter-Strike's earlier seasons from the committed snapshots (scripts/data/counter-strike-seasons/<year>.json,
// written by npm run sync:counter-strike from Liquipedia's exports; docs/design/counter-strike.md, "Earlier seasons").
//
//   npm run build:counter-strike-seasons   writes public/counter-strike/cs-<year>.json, public/counter-strike/ATTRIBUTION.txt,
//                                          src/data/counterStrikeSeasons.js, src/data/counterStrikeRules.js and
//                                          docs/design/counter-strike-seasons-audit.json
//   --check                                builds every file and compares it byte for byte, writes nothing
//
// A season fields the nations of its year's end as the built-in season fields today's (scripts/lib/counter-strike.mjs: each
// nation's seven best by Elo, its five best playing; a rating the Elo / 25 − 2), every player under the nation his record
// gives him. It plays its year's rounds: the format most of the year's maps were played in (first to 13, MR12, or first to
// 16, MR15), and the momentum that makes the year's real maps between seasoned players, each played through the match model
// at its own pre-map Elo odds, likeliest by their loser's rounds (src/sports/counterStrike.js mapMeans), as today's is
// fitted; 1.6's and Source's years, whose maps are too few for one each, share one.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { contentHash, serializeFootballSet } from '../src/data/footballSetBuild.js';
import { HISTORIC_NATIONS, HOME_NATIONS, NATIONS } from '../src/data/teams.js';
import { RULES_TODAY, counterStrike, mapMeans } from '../src/sports/counterStrike.js';
import { EDITION, FIRST_GO_SEASON, HALF_ROUNDS, MIN_NATIONS, MIN_PLAYERS, TEAM_SIZE, WIKI, binOdds, leftOut, nationsOf, playerOf, tupleOf }
  from './lib/counter-strike.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const snapshots = path.join(root, 'scripts', 'data', 'counter-strike-seasons');
const outDir = path.join(root, 'public', 'counter-strike');
const listingFile = path.join(root, 'src', 'data', 'counterStrikeSeasons.js');
const rulesFile = path.join(root, 'src', 'data', 'counterStrikeRules.js');
const auditFile = path.join(root, 'docs', 'design', 'counter-strike-seasons-audit.json');
const attributionFile = path.join(outDir, 'ATTRIBUTION.txt');
const LICENCE = Object.freeze({ name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/' });
// 1.6's first seasons, whose ratings rest on a year or a few of a dozen or two events each, say they are rough, and so does
// Global Offensive's first, which rests on a year of its own.
const isRough = year => year < 2005 || year === FIRST_GO_SEASON;

const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--check');
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const round = (x, places) => Math.round(x * 10 ** places) / 10 ** places;

// ---------- a year's rounds ----------

const meansMemo = new Map();
/** The match model's map at an odds bin's middle (mapMeans), kept: every season's fit asks for the same ones. */
function meansAt(bin, momentum, half) {
  const key = `${bin}|${momentum}|${half}`;
  if (!meansMemo.has(key)) meansMemo.set(key, mapMeans(binOdds(bin), momentum, half));
  return meansMemo.get(key);
}

/** How likely `momentum` makes real maps (`plays`: each { half, bins }, the sync's), by their loser's rounds or overtime. */
function likelihood(plays, momentum) {
  let total = 0;
  for (const { half, bins } of plays) {
    bins.forEach(([n, overtimes, ...loser], bin) => {
      if (!n) return;
      const means = meansAt(bin, momentum, half);
      total += overtimes * Math.log(means.overtime);
      loser.forEach((maps, rounds) => { if (maps) total += maps * Math.log(means.loser[rounds]); });
    });
  }
  return total;
}

/** The likeliest momentum for real maps, to the hundredth: the best tenth from 0 to 1.5, then the best hundredth about it. */
function fitMomentum(plays) {
  const best = (from, to, step) => {
    let found = null;
    for (let i = Math.round(from / step); i <= Math.round(to / step); i++) {
      const momentum = round(i * step, 2), value = likelihood(plays, momentum);
      if (!found || value > found.value) found = { momentum, value };
    }
    return found.momentum;
  };
  const tenth = best(0, 1.5, 0.1);
  return best(Math.max(0, tenth - 0.1), tenth + 0.1, 0.01);
}

/** What the match model plays at a season's rounds over its real maps' own odds → { rounds, overtime }. */
function modelOver({ half, bins }, momentum) {
  let maps = 0, rounds = 0, overtime = 0;
  bins.forEach(([n], bin) => {
    if (!n) return;
    const means = meansAt(bin, momentum, half);
    maps += n;
    rounds += n * means.rounds;
    overtime += n * means.overtime;
  });
  return { rounds: round(rounds / Math.max(1, maps), 2), overtime: round(overtime / Math.max(1, maps), 3) };
}

// ---------- a season ----------

const playOf = snapshot => ({ half: HALF_ROUNDS[snapshot.format], bins: snapshot.play.bins });

/** Season `snapshot`'s data set document and its audit row, at its `momentum`. */
function buildSeason(snapshot, momentum) {
  const year = snapshot.season, older = year < FIRST_GO_SEASON, half = HALF_ROUNDS[snapshot.format];
  const players = snapshot.players.map((row, i) => {
    const player = playerOf(row, snapshot.date, i + 1);
    // A player of 1.6's and Source's seasons says which he is rated in (the sync's twelfth field).
    return row[11] ? { ...player, source: { ...player.source, game: row[11] } } : player;
  });
  const nations = nationsOf(players, counterStrike);
  const fielded = new Set(nations.map(nation => nation.id));
  const territory = {
    merged: Object.fromEntries(HOME_NATIONS.map(nation => [nation, '826'])),
    inactive: Object.keys(NATIONS).filter(key => !HISTORIC_NATIONS.includes(key) && !HOME_NATIONS.includes(key) && !fielded.has(key)),
  };
  const rough = isRough(year);
  const notes = [...(older ? [snapshot.games.join(' and ')] : []), ...(rough ? ['rough'] : [])];
  const label = `Liquipedia Elo, end of ${year}${notes.length ? ` (${notes.join(', ')})` : ''}`;
  const levelsOf = levels => Object.entries(levels).filter(([region]) => region !== 'world').map(([region, elo]) => `${region} ${elo}`).join(', ');
  const levels = older ? Object.entries(snapshot.starts).map(([game, own]) => `${game}: ${levelsOf(own)}`).join('; ')
    : levelsOf(Object.values(snapshot.starts)[0]);
  const record = older ? `every 5v5 series of ${snapshot.games.join(' and ')} in Liquipedia's S-, A- and B-Tier events from ${snapshot.from} to the end of ${year},`
      + ' a series that records no map counted as one, each game an Elo of its own, a player of both rated in the one he played more of that year'
    : `every map of Counter-Strike: Global Offensive${year > 2022 ? ' and Counter-Strike 2' : ''} in Liquipedia's S-, A- and B-Tier 5v5 events from`
      + ` ${snapshot.from} to the end of ${year}`
      + (year === FIRST_GO_SEASON ? ', a newcomer starting as far above his region\'s level as he stood above it in 1.6 or Source' : '');
  const source = {
    edition: EDITION, name: 'Liquipedia', snapshotDate: snapshot.date, retrieved: snapshot.exported, url: WIKI, rawScale: 'Elo',
    computed: true, method: `the Elo of ${record} (docs/design/counter-strike.md, "Earlier seasons")`,
    conversion: `rating = Elo / 25 − 2, rounded; each newcomer started at his region's level as the maps to ${snapshot.date} measure it`
      + ` (${levels}; fitted at once with every player's own strength, Europe's at 1,500: docs/design/counter-strike.md, "Regions")`,
    licence: LICENCE.name, rated: snapshot.rated,
    ...(rough ? { rough: true } : {}),
  };
  const doc = {
    format: 1, kind: 'cs', id: `cs-${year}`, version: '', year, season: String(year), label, local: false, source,
    nations: Object.fromEntries(nations.map(nation => [nation.id, [nation.str, nation.players, nation.squad.map(tupleOf)]])),
    clubs: [],
    territory,
    coverage: { rated: snapshot.rated, nations: nations.length, players: nations.reduce((n, nation) => n + nation.squad.length, 0) },
  };
  doc.version = `${doc.id}-${contentHash(doc)}`;
  const { noFlag, offMap, short } = leftOut(players);
  const audit = {
    id: doc.id, version: doc.version, label, date: snapshot.date, from: snapshot.from, to: snapshot.to, games: snapshot.games,
    series: snapshot.series, maps: snapshot.maps, results: snapshot.results, rated: snapshot.rated, carried: snapshot.carried,
    minGames: snapshot.minGames, minRecent: snapshot.minRecent, levels: snapshot.starts,
    top: players.slice(0, 5).map(player => `${player.name} ${player.elo} → ${player.rating}`),
    nations: nations.map(nation => `${nation.name} ${nation.str} (${nation.squad.map(player => `${player.name} ${player.rating}`).join(', ')}`
      + `${nation.players > nation.squad.length ? `; +${nation.players - nation.squad.length}` : ''})`),
    leftOut: { noCountry: noFlag.map(player => player.name), offTheMap: offMap.length, fewerThanFive: short.length },
    // The year's maps by format, the season's, and its real maps between seasoned players beside the model's at their odds.
    formats: snapshot.formats, half, momentum,
    real: { maps: snapshot.play.maps, rounds: snapshot.play.rounds, overtime: snapshot.play.ot, favourite: snapshot.play.favourite },
    model: snapshot.play.maps ? modelOver(playOf(snapshot), momentum) : null,
  };
  return { doc, text: serializeFootballSet(doc), audit };
}

// ---------- the generated modules ----------

function listingModule(docs) {
  for (const doc of docs) if (/['\\]/.test(doc.label)) throw new Error(`${doc.id}: a label may not hold a quote or a backslash`);
  return `// GENERATED by npm run build:counter-strike-seasons; do not edit.
// The built-in earlier Counter-Strike seasons, newest first: each year's players by the Elo of Liquipedia's results at its
// end (1.6's and Source's to 2012, then Global Offensive's and Counter-Strike 2's), nations only. Each is
// public/counter-strike/<id>.json, loaded when a setup chooses it (src/engine/footballSets.js).
export const BUILT_IN_COUNTER_STRIKE_SEASONS = Object.freeze([
${docs.map(doc => `  Object.freeze({ id: '${doc.id}', version: '${doc.version}', year: ${doc.year}, season: '${doc.season}', label: '${doc.label}' }),`).join('\n')}
]);
`;
}

function rulesModule(rows) {
  return `// GENERATED by npm run build:counter-strike-seasons; do not edit.
// Counter-Strike's rounds by season (docs/design/counter-strike.md, "Earlier seasons"). \`half\`: the rounds a half of the
// format most of the year's maps on Liquipedia were played in (12: first to 13; 15: first to 16). \`momentum\`: the pull of a
// round won on the next (src/sports/counterStrike.js MOMENTUM, today's ${RULES_TODAY.momentum}) that makes the year's real maps between seasoned
// players likeliest, each at its own pre-map Elo odds; 1.6's and Source's years, to 2012, share theirs. An earlier season
// plays them (\`counterStrikeIn\`). The built-in season, ${rows.length ? rows[0].year + 1 : 'today\'s'}, plays today's.
export const COUNTER_STRIKE_RULES = Object.freeze({
${rows.map(row => `  ${row.year}: Object.freeze({ half: ${row.half}, momentum: ${row.momentum} }),`).join('\n')}
});
`;
}

function attributionText(docs) {
  const years = docs.map(doc => doc.year);
  const [first, last] = [Math.min(...years), Math.max(...years)];
  return `Counter-Strike seasons ${first}-${last} (cs-<year>.json): attribution and licence
=============================================================

The ratings in these files are computed by this project from the results of Liquipedia's Counter-Strike wiki
(${WIKI}): an Elo of every player, built map by map from every 5v5 series of its S-, A- and B-Tier events
(Counter-Strike 1.6's and Source's from December 2000 to 2012, Global Offensive's and Counter-Strike 2's from 2012), as it
stood on the last day of each year; each player's country is the one his record gives him. Liquipedia publishes no ratings:
these are not its numbers. See docs/design/counter-strike.md, "Earlier seasons".

Credit: Liquipedia (${WIKI}) and its contributors; each player's source links his page there.
Licence: ${LICENCE.name} (${LICENCE.url}). These files are shared under the same licence.
`;
}

async function main() {
  const check = args.includes('--check');
  const files = (await readdir(snapshots).catch(() => [])).filter(name => /^\d{4}\.json$/.test(name)).sort();
  if (!files.length) throw new Error(`No season snapshots in ${path.relative(root, snapshots)}/: run npm run sync:counter-strike`);
  const seasons = [];
  for (const name of files) {
    const snapshot = JSON.parse(await readFile(path.join(snapshots, name), 'utf8'));
    if (`${snapshot.season}.json` !== name) throw new Error(`${name} is the ${snapshot.season} season`);
    if (!HALF_ROUNDS[snapshot.format]) throw new Error(`${name}: no format ${snapshot.format}`);
    seasons.push(snapshot);
  }
  const shared = fitMomentum(seasons.filter(snapshot => snapshot.season < FIRST_GO_SEASON).map(playOf));
  const results = [];
  for (const snapshot of seasons) {
    const momentum = snapshot.season < FIRST_GO_SEASON ? shared : fitMomentum([playOf(snapshot)]);
    const result = buildSeason(snapshot, momentum);
    if (result.doc.coverage.nations < MIN_NATIONS) {
      console.log(`${snapshot.season}: ${result.doc.coverage.nations} nations field ${MIN_PLAYERS}, fewer than ${MIN_NATIONS}: no season`);
      continue;
    }
    results.push(result);
  }
  results.sort((a, b) => b.doc.year - a.doc.year);
  for (const { doc, audit } of results) {
    console.log(`${doc.id} ${doc.label}: ${doc.coverage.nations} nations, ${doc.coverage.players} players of ${doc.coverage.rated} rated; first to`
      + ` ${audit.half + 1}, momentum ${audit.momentum}: ${audit.real.maps} real maps ${audit.real.rounds} rounds, ${(audit.real.overtime * 100).toFixed(1)}%`
      + ` to overtime (model ${audit.model ? `${audit.model.rounds}, ${(audit.model.overtime * 100).toFixed(1)}%` : '—'});`
      + ` ${audit.nations.slice(0, 3).map(n => n.replace(/ \(.*$/, '')).join(', ')}`);
  }
  const docs = results.map(result => result.doc);
  const audit = {
    generatedBy: 'scripts/build-counter-strike-seasons.mjs', licence: LICENCE, teamSize: TEAM_SIZE, minPlayers: MIN_PLAYERS, minNations: MIN_NATIONS,
    todaysRounds: RULES_TODAY, seasons: results.map(result => result.audit),
  };
  const outputs = [
    ...results.map(({ doc, text }) => [path.join(outDir, `${doc.id}.json`), text]),
    [attributionFile, attributionText(docs)],
    [listingFile, listingModule(docs)],
    [rulesFile, rulesModule(results.map(result => ({ year: result.doc.year, half: result.audit.half, momentum: result.audit.momentum })))],
    [auditFile, `${JSON.stringify(audit, null, 2)}\n`],
  ];
  if (check) {
    const differs = [];
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    if (differs.length) throw new Error(`differs: ${differs.join(', ')}`);
    console.log(`Verified the ${results.length} Counter-Strike seasons, their listing, rounds, attribution and audit byte for byte.`);
    return;
  }
  await mkdir(outDir, { recursive: true });
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${results.length} seasons to ${path.relative(root, outDir)}/, ${path.relative(root, listingFile)}, `
    + `${path.relative(root, rulesFile)} and ${path.relative(root, auditFile)}`);
}

main().catch(error => {
  console.error(`build-counter-strike-seasons: ${error.message}`);
  process.exitCode = 1;
});
