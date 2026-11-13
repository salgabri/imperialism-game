// Read the computed national-team seasons' sources into their committed facts (docs/design/football-years.md, "Computed
// national-team seasons"):
//
//   npm run sync:national-team-seasons                  writes scripts/data/national-team-seasons/{wikidata,elo,ballon-dor}.json
//   npm run sync:national-team-seasons -- --check       builds and compares every output byte for byte, writes nothing
//   npm run sync:national-team-seasons -- --fetch       first downloads the sources missing from data-src/ (QLever's
//                                                       answers to the manifest's queries, Wikipedia's Ballon d'Or pages)
//   npm run sync:national-team-seasons -- --pin         records the SHA-256, size (and a page's revision) of every source
//                                                       file in the manifest, after a deliberate new download
//   npm run sync:national-team-seasons -- --data=<dir>  the downloaded sources elsewhere (default data-src/)
//
// Every source is a file in data-src/ pinned by SHA-256 in scripts/data/national-team-seasons.json, and the sync stops on
// any other: QLever's answers (Wikidata, CC0) to the four queries the manifest holds, martj42's results at the commit it
// names, and the Wikipedia article pages of the Ballon d'Or at the revisions it names. Downloads go through
// scripts/lib/polite-fetch.mjs: QLever (qlever.dev, no robots.txt) one query at a time, a minute apart; Wikipedia's article
// paths (/wiki/, which its robots.txt allows) 2 s apart. npm run build:national-team-seasons reads only the facts.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { eloOn, resultRows } from './lib/football-elo.mjs';
import { ballonDorVotes, csvRows, pageRevision } from './lib/world-cup-facts.mjs';
import { ballonDorPoints, seasonElo, sparqlRows, wikidataTables } from './lib/national-team-facts.mjs';
import { politeFetch } from './lib/polite-fetch.mjs';
import { WIKIDATA_SPARQL, sparqlRequest } from './lib/wikidata-sparql.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MANIFEST = path.join(root, 'scripts/data/national-team-seasons.json');
const OUT = path.join(root, 'scripts/data/national-team-seasons');
const QLEVER_GAP = 60_000;
const WIKIPEDIA_GAP = 2_000;

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
const pageUrl = title => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/')}`;

/** Download every source file the data folder lacks: Wikipedia's pages, then QLever's answers. Nothing is retried. */
async function fetchMissing(dataDir, manifest) {
  const { wikidata, ballonDor } = manifest.sources;
  const { mkdir } = await import('node:fs/promises');
  let fetched = false;
  for (const page of ballonDor.pages) {
    const at = path.join(dataDir, ballonDor.folder, page.file);
    if (existsSync(at)) continue;
    if (fetched) await wait(WIKIPEDIA_GAP);
    fetched = true;
    console.log(`Saving ${pageUrl(page.title)}`);
    const response = await politeFetch(pageUrl(page.title));
    const html = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${page.title}`);
    const shown = pageRevision(html);
    if (shown.page !== page.title) throw new Error(`${pageUrl(page.title)} shows ${shown.page}`);
    await mkdir(path.dirname(at), { recursive: true });
    await writeFile(at, html);
  }
  for (const file of wikidata.files) {
    const at = path.join(dataDir, wikidata.folder, file.name);
    if (existsSync(at)) continue;
    // Its nginx turns away a client that asks again too soon (HTTP 429), so every query waits, the first too.
    await wait(QLEVER_GAP);
    console.log(`Asking ${WIKIDATA_SPARQL} the ${file.query} query`);
    const response = await politeFetch(WIKIDATA_SPARQL, sparqlRequest(wikidata.queries[file.query]));
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${WIKIDATA_SPARQL} for ${file.query}: ${text.slice(0, 200)}`);
    sparqlRows(JSON.parse(text));
    await mkdir(path.dirname(at), { recursive: true });
    await writeFile(at, text);
  }
}

/** Record each source file's SHA-256 and size (and a page's revision) in the manifest. */
async function pinAll(dataDir, manifest) {
  const { wikidata, ballonDor } = manifest.sources;
  for (const file of wikidata.files) {
    const bytes = await readFile(path.join(dataDir, wikidata.folder, file.name));
    Object.assign(file, { sha256: sha256(bytes), bytes: bytes.length });
  }
  for (const page of ballonDor.pages) {
    const bytes = await readFile(path.join(dataDir, ballonDor.folder, page.file));
    const { revision, page: title } = pageRevision(bytes.toString('utf8'));
    if (title !== page.title) throw new Error(`${page.file} shows ${title}, not ${page.title}`);
    Object.assign(page, { revision, sha256: sha256(bytes), bytes: bytes.length });
  }
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('Pinned every source file in scripts/data/national-team-seasons.json');
}

/** A pinned file's text, after checking it is the pinned one. */
async function pinned(dataDir, folder, file, where) {
  const at = path.join(dataDir, folder, file.name ?? file.file);
  if (!existsSync(at)) throw new Error(`${at} is missing: run with --fetch, or download ${where} into data-src/${folder}/`);
  const bytes = await readFile(at);
  const digest = sha256(bytes);
  if (digest !== file.sha256 || bytes.length !== file.bytes) {
    throw new Error(`${at} is not the pinned file (SHA-256 ${digest}, ${bytes.length} bytes); see scripts/data/national-team-seasons.json`);
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
  const { wikidata, results, ballonDor } = manifest.sources;

  const answers = {};
  for (const file of wikidata.files) answers[file.query] = sparqlRows(JSON.parse(await pinned(dataDir, wikidata.folder, file, `${wikidata.endpoint} (query ${file.query})`)));
  const years = [Math.min(...manifest.seasons.map(s => s.year)) - 1, Math.max(...manifest.seasons.map(s => s.year))];
  const tables = wikidataTables(answers, { positions: manifest.positions, names: manifest.names, years, openCapsPerYear: manifest.selection.openCapsPerYear });

  const matches = resultRows(csvRows(await pinned(dataDir, results.folder, results.files[0], `${results.download}${results.files[0].name}`)));
  const dates = manifest.seasons.map(season => `${season.year}-${manifest.selection.cutoff}`);
  const snapshots = eloOn(matches, dates, manifest.elo);
  const elo = Object.fromEntries(manifest.seasons.map((season, i) => [season.id, seasonElo(snapshots[dates[i]], dates[i], manifest.elo.activeYears)]));

  const votes = {}, pinsUsed = new Set();
  for (const page of ballonDor.pages) {
    const html = await pinned(dataDir, ballonDor.folder, page, pageUrl(page.title));
    const shown = pageRevision(html);
    if (shown.revision !== page.revision || shown.page !== page.title) throw new Error(`${page.file} shows ${shown.page} revision ${shown.revision}, not ${page.title} revision ${page.revision}`);
    const year = Number(/^(\d{4}) Ballon d'Or$/.exec(page.title)?.[1]);
    const { pinned: used, ...matched } = ballonDorPoints(ballonDorVotes(html), { year, ...tables, nationalities: manifest.names.ballonDorNationalities,
      pinned: manifest.names.ballonDorPlayers });
    votes[year] = matched;
    for (const vote of used) pinsUsed.add(vote);
  }
  const unusedPins = manifest.names.ballonDorPlayers.filter(pin => !pinsUsed.has(pin.vote));
  if (unusedPins.length) throw new Error(`Pinned Ballon d'Or votes no year needs: ${unusedPins.map(pin => pin.vote).join(', ')}`);

  const outputs = new Map([
    [path.join(OUT, 'wikidata.json'), factsText({
      about: 'Wikidata\'s men\'s national teams that have a player stint of 1962 to 1993, those stints and their players, from QLever\'s answers '
        + 'pinned in scripts/data/national-team-seasons.json (CC0). Rows: teams [qid, country]; players [qid, name, born, English Wikipedia article, '
        + 'positions]; stints [player, team, from, to, caps, goals, ended], ended 1 where Wikidata gives no end and the manifest\'s rule does '
        + '(selection.openCapsPerYear). Written by scripts/sync-national-team-seasons.mjs.',
      audit: tables.audit, teams: tables.teams, players: tables.players, stints: tables.stints,
    })],
    [path.join(OUT, 'elo.json'), factsText({
      about: 'Each season\'s World Football Elo on 1 July of its end year, computed from martj42\'s results (CC0) by the formula eloratings.net '
        + 'publishes: every team that played in the four years before, [results name, Elo, rank]. Written by scripts/sync-national-team-seasons.mjs.',
      seasons: elo,
    })],
    [path.join(OUT, 'ballon-dor.json'), factsText({
      about: 'Ballon d\'Or points per year (Wikipedia\'s voting tables, CC BY-SA 4.0; the votes are France Football\'s), matched to Wikidata '
        + 'players by article, else by name in the nationality\'s team that year: [qid, points], and the votes matched to none. Written by '
        + 'scripts/sync-national-team-seasons.mjs.',
      years: votes,
    })],
  ]);
  console.log(`Wikidata: ${tables.teams.length} teams, ${tables.players.length} players, ${tables.stints.length} stints `
    + `(${tables.audit.ended} ended by the rule, ${tables.audit.noEnd} left out with neither end nor caps, ${tables.audit.noCaps} without caps)`);
  for (const season of manifest.seasons) console.log(`${season.id}: Elo of ${elo[season.id].date}, ${elo[season.id].ratings.length} active, best ${elo[season.id].best.team} ${elo[season.id].best.elo}`);
  for (const [year, { points, unmatched }] of Object.entries(votes)) console.log(`Ballon d'Or ${year}: ${points.length} players matched, ${unmatched.length} not`);
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
  const { mkdir } = await import('node:fs/promises');
  await mkdir(OUT, { recursive: true });
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${outputs.size} files to scripts/data/national-team-seasons/`);
}

main().catch(error => {
  console.error(`sync-national-team-seasons: ${error.message}`);
  process.exitCode = 1;
});
