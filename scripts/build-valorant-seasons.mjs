// Build Valorant's earlier seasons from the committed snapshots (scripts/data/valorant-seasons/<year>.json, written by
// npm run sync:valorant from vlr.gg's results; docs/design/valorant.md, "Earlier seasons").
//
//   npm run build:valorant-seasons   writes public/valorant/val-<year>.json, public/valorant/ATTRIBUTION.txt,
//                                    src/data/valorantSeasons.js, src/data/valorantMapPools.js and
//                                    docs/design/valorant-seasons-audit.json
//   --check                          builds every file and compares it byte for byte, writes nothing
//
// A season fields the nations of its year's end as the built-in season fields today's (scripts/lib/valorant.mjs: each
// nation's seven best by Elo, its five best playing; a rating the Elo / 25 − 2), every player under the nation the whole
// record gives him. It plays its series on its year's map pool, the seven maps played most in the year's last thousand;
// its rounds are today's model, as each year's real rounds went as today's do (the audit's `play`).
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { contentHash, serializeFootballSet } from '../src/data/footballSetBuild.js';
import { HISTORIC_NATIONS, HOME_NATIONS, NATIONS } from '../src/data/teams.js';
import { MAP_POOL, valorant } from '../src/sports/valorant.js';
import { leftOut, nationsOf } from './lib/esports-elo.mjs';
import { EDITION, LINEUP, SITE_URL, TEAM_SIZE, playerOf, tupleOf } from './lib/valorant.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const snapshots = path.join(root, 'scripts', 'data', 'valorant-seasons');
const outDir = path.join(root, 'public', 'valorant');
const listingFile = path.join(root, 'src', 'data', 'valorantSeasons.js');
const poolsFile = path.join(root, 'src', 'data', 'valorantMapPools.js');
const auditFile = path.join(root, 'docs', 'design', 'valorant-seasons-audit.json');
const attributionFile = path.join(outDir, 'ATTRIBUTION.txt');
// A season is built only if it fields this many nations: enough for a continent of four to be offered.
const MIN_NATIONS = 4;

const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--check');
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const share = (part, whole) => Math.round(1000 * part / Math.max(1, whole)) / 1000;
const rate = ([n, yes]) => share(yes, n);

/** Season `snapshot`'s data set document and its audit row. */
function buildSeason(snapshot) {
  const year = snapshot.season;
  if (snapshot.mapPool.pool.length !== MAP_POOL.length) throw new Error(`${year}: a pool of ${snapshot.mapPool.pool.length} maps, not ${MAP_POOL.length}`);
  const players = snapshot.players.map((row, i) => playerOf(row, snapshot.date, i + 1));
  const nations = nationsOf(players, { teamSize: TEAM_SIZE, lineup: LINEUP, sport: valorant });
  const fielded = new Set(nations.map(nation => nation.id));
  const territory = {
    merged: Object.fromEntries(HOME_NATIONS.map(nation => [nation, '826'])),
    inactive: Object.keys(NATIONS).filter(key => !HISTORIC_NATIONS.includes(key) && !HOME_NATIONS.includes(key) && !fielded.has(key)),
  };
  const label = `vlr.gg Elo, end of ${year}`;
  const source = {
    edition: EDITION, name: 'vlr.gg', snapshotDate: snapshot.date, retrieved: snapshot.fetched, url: SITE_URL, rawScale: 'Elo',
    computed: true, method: `the Elo of every map of vlr.gg's VCT, Challengers and off-season events from ${snapshot.from} to the end`
      + ` of ${year}, each newcomer starting at his home circuit's level as the maps to then set it (docs/design/valorant.md,`
      + ` "Earlier seasons" and "Circuits on one scale")`, rated: snapshot.rated,
  };
  const doc = {
    format: 1, kind: 'val', id: `val-${year}`, version: '', year, season: String(year), label, local: false, source,
    nations: Object.fromEntries(nations.map(nation => [nation.id, [nation.str, nation.players, nation.squad.map(tupleOf)]])),
    clubs: [],
    territory,
    coverage: { rated: snapshot.rated, nations: nations.length, players: nations.reduce((n, nation) => n + nation.squad.length, 0) },
  };
  doc.version = `${doc.id}-${contentHash(doc)}`;
  const { noNation, short } = leftOut(players, { lineup: LINEUP });
  const { play } = snapshot;
  const audit = {
    id: doc.id, version: doc.version, label, date: snapshot.date, to: snapshot.to, matches: snapshot.matches, maps: snapshot.maps,
    rated: snapshot.rated, top: players.slice(0, 5).map(player => `${player.name} ${player.elo} → ${player.rating}`),
    nations: nations.map(nation => `${nation.name} ${nation.str} (${nation.squad.map(player => `${player.name} ${player.rating}`).join(', ')}`
      + `${nation.players > nation.squad.length ? `; +${nation.players - nation.squad.length}` : ''})`),
    leftOut: { noNation: noNation.length, fewerThanFive: short.length },
    mapPool: snapshot.mapPool,
    // The year's real maps between seasoned players: rounds a map, overtime and the economy, beside today's.
    play: { maps: play.maps, rounds: share(play.rounds, play.maps), overtime: share(play.ot, play.maps),
      afterPistol: rate(play.roundStats.afterPistol), bonus: rate(play.roundStats.bonus), broken: rate(play.roundStats.broken),
      lean: rate(play.roundStats.lean), defence: share(play.roundStats.defence, play.roundStats.rounds), series: play.series },
  };
  return { doc, text: serializeFootballSet(doc), pool: snapshot.mapPool.pool, audit };
}

function listingModule(docs) {
  for (const doc of docs) if (/['\\]/.test(doc.label)) throw new Error(`${doc.id}: a label may not hold a quote or a backslash`);
  return `// GENERATED by npm run build:valorant-seasons; do not edit.
// The built-in earlier Valorant seasons, newest first: each year's players by the Elo of vlr.gg's results at its end,
// nations only. Each is public/valorant/<id>.json, loaded when a setup chooses it (src/engine/footballSets.js).
export const BUILT_IN_VALORANT_SEASONS = Object.freeze([
${docs.map(doc => `  Object.freeze({ id: '${doc.id}', version: '${doc.version}', year: ${doc.year}, season: '${doc.season}', label: '${doc.label}' }),`).join('\n')}
]);
`;
}

function poolsModule(rows) {
  return `// GENERATED by npm run build:valorant-seasons; do not edit.
// Valorant's map pool by season (docs/design/valorant.md, "Earlier seasons"): the ${MAP_POOL.length} maps played most in the
// year's last thousand maps on vlr.gg, the competitive pool of its December, most played first. An earlier season plays its
// series on them (\`valorantIn\`); the built-in season, ${rows.length ? rows[0].year + 1 : 'today\'s'}, plays today's (src/sports/valorant.js MAP_POOL).
export const VALORANT_MAP_POOLS = Object.freeze({
${rows.map(row => `  ${row.year}: Object.freeze([${row.pool.map(name => `'${name}'`).join(', ')}]),`).join('\n')}
});
`;
}

function attributionText(docs) {
  const years = docs.map(doc => doc.year);
  const [first, last] = [Math.min(...years), Math.max(...years)];
  return `Valorant seasons ${first}-${last} (val-<year>.json): attribution
=================================================

The ratings in these files are computed by this project from the match results vlr.gg records (${SITE_URL}): an Elo of
every player, built map by map from every map of its VCT, Challengers and off-season events from September 2022, each
newcomer starting at his home circuit's level, as it stood on the last day of each year; each player's country is the
one the whole record gives him (his Esports Nations Cup team, else the flag vlr.gg files him under). vlr.gg publishes no
ratings: these are not its numbers. See docs/design/valorant.md, "Earlier seasons".

Credit: vlr.gg (${SITE_URL}); each player's source links his page there.
`;
}

async function main() {
  const check = args.includes('--check');
  const files = (await readdir(snapshots).catch(() => [])).filter(name => /^\d{4}\.json$/.test(name)).sort();
  if (!files.length) throw new Error(`No season snapshots in ${path.relative(root, snapshots)}/: run npm run sync:valorant`);
  const results = [];
  for (const name of files) {
    const snapshot = JSON.parse(await readFile(path.join(snapshots, name), 'utf8'));
    if (`${snapshot.season}.json` !== name) throw new Error(`${name} is the ${snapshot.season} season`);
    const result = buildSeason(snapshot);
    if (Object.keys(result.doc.nations).length < MIN_NATIONS) {
      console.log(`${snapshot.season}: ${Object.keys(result.doc.nations).length} nations field ${LINEUP}, fewer than ${MIN_NATIONS}: no season`);
      continue;
    }
    results.push(result);
  }
  results.sort((a, b) => b.doc.year - a.doc.year);
  for (const { doc, pool, audit } of results) {
    console.log(`${doc.id} ${doc.label}: ${doc.coverage.nations} nations, ${doc.coverage.players} players of ${doc.coverage.rated} rated;`
      + ` pool ${pool.join(', ')}; ${audit.play.maps} real maps, ${audit.play.rounds} rounds, ${(audit.play.overtime * 100).toFixed(1)}% to`
      + ` overtime; ${audit.nations.slice(0, 3).map(n => n.replace(/ \(.*$/, '')).join(', ')}`);
  }
  const docs = results.map(result => result.doc);
  const audit = {
    generatedBy: 'scripts/build-valorant-seasons.mjs', teamSize: TEAM_SIZE, lineup: LINEUP, todaysPool: MAP_POOL,
    seasons: results.map(result => result.audit),
  };
  const outputs = [
    ...results.map(({ doc, text }) => [path.join(outDir, `${doc.id}.json`), text]),
    [attributionFile, attributionText(docs)],
    [listingFile, listingModule(docs)],
    [poolsFile, poolsModule(results.map(result => ({ year: result.doc.year, pool: result.pool })))],
    [auditFile, `${JSON.stringify(audit, null, 2)}\n`],
  ];
  if (check) {
    const differs = [];
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    if (differs.length) throw new Error(`differs: ${differs.join(', ')}`);
    console.log(`Verified the ${results.length} Valorant seasons, their listing, map pools, attribution and audit byte for byte.`);
    return;
  }
  await mkdir(outDir, { recursive: true });
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${results.length} seasons to ${path.relative(root, outDir)}/, ${path.relative(root, listingFile)}, `
    + `${path.relative(root, poolsFile)} and ${path.relative(root, auditFile)}`);
}

main().catch(error => {
  console.error(`build-valorant-seasons: ${error.message}`);
  process.exitCode = 1;
});
