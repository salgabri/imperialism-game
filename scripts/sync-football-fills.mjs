// Read the computed fills' sources into their committed facts (docs/design/football-years.md, "Computed fills"):
//
//   npm run sync:football-fills                  writes scripts/data/football-fills/{wikidata,elo}.json
//   npm run sync:football-fills -- --check       builds and compares every output byte for byte, writes nothing
//   npm run sync:football-fills -- --fetch       first downloads QLever's answers missing from data-src/
//   npm run sync:football-fills -- --pin         records the SHA-256 and size of every answer in the manifest, after a
//                                                deliberate new download
//   npm run sync:football-fills -- --data=<dir>  the downloaded sources elsewhere (default data-src/)
//
// Every source is a file in data-src/ pinned by SHA-256 in scripts/data/football-fills.json, and the sync stops on any
// other: QLever's answers (Wikidata, CC0) to the four queries the manifest holds, and martj42's results at the commit the
// computed national-team seasons read. Downloads go through scripts/lib/polite-fetch.mjs, one query at a time, a minute
// apart (QLever, qlever.dev, has no robots.txt; its nginx answers a client that asks again too soon with HTTP 429), and
// nothing is retried. npm run build:ea-seasons and npm run build-rosters read only the facts.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { eloOn, resultRows } from './lib/football-elo.mjs';
import { csvRows } from './lib/world-cup-facts.mjs';
import { seasonElo, sparqlRows, wikidataTables } from './lib/national-team-facts.mjs';
import { FILL_YEARS, withoutMalformedDays } from './lib/football-fills.mjs';
import { politeFetch } from './lib/polite-fetch.mjs';
import { WIKIDATA_SPARQL, sparqlRequest } from './lib/wikidata-sparql.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MANIFEST = path.join(root, 'scripts/data/football-fills.json');
const OUT = path.join(root, 'scripts/data/football-fills');
const QLEVER_GAP = 60_000;

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [, key, value] = /^--([a-z]+)(?:=(.*))?$/s.exec(arg) || [];
    if (['check', 'fetch', 'pin'].includes(key) && value === undefined) args[key] = true;
    else if (key === 'data' && value) args.data = value;
    else throw new Error(`Unknown option ${arg}`);
  }
  if (args.check && (args.fetch || args.pin)) throw new Error('--check writes nothing: run it without --fetch or --pin');
  return args;
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Download each of QLever's answers the data folder lacks, one query a minute (the first waits too). Nothing is retried. */
async function fetchMissing(dataDir, manifest) {
  const { wikidata } = manifest.sources;
  for (const file of wikidata.files) {
    const at = path.join(dataDir, wikidata.folder, file.name);
    if (existsSync(at)) continue;
    await wait(QLEVER_GAP);
    console.log(`${new Date().toISOString()} asking ${WIKIDATA_SPARQL} the ${file.query} query`);
    const response = await politeFetch(WIKIDATA_SPARQL, sparqlRequest(wikidata.queries[file.query]));
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${WIKIDATA_SPARQL} for ${file.query}: ${text.slice(0, 300)}`);
    const rows = sparqlRows(JSON.parse(text));
    await mkdir(path.dirname(at), { recursive: true });
    await writeFile(at, text);
    console.log(`${new Date().toISOString()} saved ${file.name}: ${rows.length} rows, ${text.length} characters`);
  }
}

/** Record each answer's SHA-256 and size in the manifest. */
async function pinAll(dataDir, manifest) {
  const { wikidata } = manifest.sources;
  for (const file of wikidata.files) {
    const bytes = await readFile(path.join(dataDir, wikidata.folder, file.name));
    Object.assign(file, { sha256: sha256(bytes), bytes: bytes.length });
  }
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('Pinned every answer in scripts/data/football-fills.json');
}

/** A pinned file's text, after checking it is the pinned one. */
async function pinned(dataDir, folder, file, where) {
  const at = path.join(dataDir, folder, file.name);
  if (!existsSync(at)) throw new Error(`${at} is missing: run with --fetch, or download ${where} into data-src/${folder}/`);
  const bytes = await readFile(at);
  const digest = sha256(bytes);
  if (digest !== file.sha256 || bytes.length !== file.bytes) {
    throw new Error(`${at} is not the pinned file (SHA-256 ${digest}, ${bytes.length} bytes); see scripts/data/football-fills.json`);
  }
  return bytes.toString('utf8');
}

// Rows one to a line, the rest as JSON.stringify writes it with two spaces: small, stable diffs.
function factsText(value) {
  const lines = JSON.stringify(value, (key, v) => (Array.isArray(v) && v.length && v.every(Array.isArray)
    ? v.map(row => `\u0000${JSON.stringify(row)}`) : v), 2);
  return `${lines.replace(/"\\u0000((?:[^"\\]|\\.)*)"/g, (_, row) => JSON.parse(`"${row}"`))}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const dataDir = path.resolve(args.data ?? path.join(root, 'data-src'));
  if (args.fetch) await fetchMissing(dataDir, manifest);
  if (args.pin) await pinAll(dataDir, manifest);
  const { wikidata, results } = manifest.sources;

  const answers = {};
  for (const file of wikidata.files) answers[file.query] = sparqlRows(JSON.parse(await pinned(dataDir, wikidata.folder, file, `${wikidata.endpoint} (query ${file.query})`)));
  const { rows: stints, malformed } = withoutMalformedDays(answers.stints);
  const tables = wikidataTables({ ...answers, stints }, { positions: manifest.positions, names: manifest.names, years: FILL_YEARS, openCapsPerYear: manifest.selection.openCapsPerYear, openFirstYear: true });

  const matches = resultRows(csvRows(await pinned(dataDir, results.folder, results.files[0], `${results.download}${results.files[0].name}`)));
  const snapshots = eloOn(matches, manifest.seasons.map(season => season.date), manifest.elo);
  const elo = Object.fromEntries(manifest.seasons.map(season => [season.id, seasonElo(snapshots[season.date], season.date, manifest.elo.activeYears)]));

  const outputs = new Map([
    [path.join(OUT, 'wikidata.json'), factsText({
      about: `Wikidata's men's national teams that have a player stint of ${FILL_YEARS[0]} to ${FILL_YEARS[1]}, those stints and their players, from QLever's answers `
        + 'pinned in scripts/data/football-fills.json (CC0). Rows: teams [qid, country]; players [qid, name, born, English Wikipedia article, '
        + 'positions]; stints [player, team, from, to, caps, goals, ended], ended 1 where Wikidata gives no end and the manifest\'s rule does '
        + '(selection.openCapsPerYear). Written by scripts/sync-football-fills.mjs.',
      audit: { ...tables.audit, malformedDays: malformed }, teams: tables.teams, players: tables.players, stints: tables.stints,
    })],
    [path.join(OUT, 'elo.json'), factsText({
      about: 'Each season\'s World Football Elo on its ratings date, computed from martj42\'s results (CC0) by the formula eloratings.net '
        + 'publishes: every team that played in the four years before, [results name, Elo, rank]. Written by scripts/sync-football-fills.mjs.',
      seasons: elo,
    })],
  ]);
  console.log(`Wikidata: ${tables.teams.length} teams, ${tables.players.length} players, ${tables.stints.length} stints `
    + `(${tables.audit.ended} ended by the rule, ${tables.audit.noEnd} left out with neither end nor caps, ${tables.audit.noCaps} without caps)`);
  for (const season of manifest.seasons) console.log(`${season.id}: Elo of ${elo[season.id].date}, ${elo[season.id].ratings.length} active, best ${elo[season.id].best.team} ${elo[season.id].best.elo}`);
  if (args.check) {
    const differs = [];
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    if (differs.length) throw new Error(`Check failed, these differ from what the sync writes: ${differs.join(', ')}`);
    console.log(`Check only, nothing written: ${outputs.size} files rebuild byte for byte`);
    return;
  }
  await mkdir(OUT, { recursive: true });
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${outputs.size} files to scripts/data/football-fills/`);
}

main().catch(error => {
  console.error(`sync-football-fills: ${error.message}`);
  process.exitCode = 1;
});
