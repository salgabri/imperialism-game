// The American League's record against the National League in each regular season's interleague games, 1997 to 2017,
// which put the two leagues' clubs on one scale in the seasons computed from WAR (docs/design/baseball.md, "One scale
// for both leagues"), read from English Wikipedia's "Interleague play" article.
//
//   node scripts/sync-mlb-interleague.mjs --fetch   reads https://en.wikipedia.org/wiki/Interleague_play once, through
//                                                   scripts/lib/polite-fetch.mjs (its robots.txt read first), into the
//                                                   ignored data-src/mlb-interleague/, and prints the revision and
//                                                   SHA-256 to pin in scripts/data/mlb-war-seasons.json `sources`
//   node scripts/sync-mlb-interleague.mjs           parses the cached page, its SHA-256 and revision the pinned ones, and
//                                                   writes scripts/data/mlb-interleague.json (committed)
//   node scripts/sync-mlb-interleague.mjs --check   parses it again and compares the file byte for byte
//
// Only facts are taken: each season's wins and losses of the American League against the National League. Each season's
// wins less losses must be the Baseball Databank's, the American League's clubs' wins less their losses that season
// (scripts/data/mlb-war-seasons/<year>.json), whose games inside the league cancel out; a season that differs, or one
// missing, stops the script. npm run build:mlb-seasons reads the committed file and checks the same of every season.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { politeFetch, USER_AGENT } from './lib/polite-fetch.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestFile = path.join(root, 'scripts/data/mlb-war-seasons.json');
const outputFile = path.join(root, 'scripts/data/mlb-interleague.json');
const PAGE_URL = 'https://en.wikipedia.org/wiki/Interleague_play';
const CACHE_DIR = 'data-src/mlb-interleague';
const PAGE_FILE = 'Interleague_play.html';
/** The seasons the computed seasons need: interleague play began in 1997; the last computed season is 2017. */
export const FIRST_INTERLEAGUE = 1997;
export const LAST_COMPUTED = 2017;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** The page's revision id, from the JavaScript configuration MediaWiki writes into every page (`wgRevisionId`). */
export function revisionOf(html) {
  const match = /"wgRevisionId":(\d+)/.exec(html);
  if (!match) throw new Error('The page names no revision (wgRevisionId)');
  return Number(match[1]);
}

/** Text of an HTML fragment: tags dropped, entities and footnote marks removed, whitespace folded. */
function textOf(fragment) {
  return fragment.replace(/<sup[\s\S]*?<\/sup>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#8211;|&ndash;/g, '–').replace(/\s+/g, ' ').trim();
}

/** Every table of the page as rows of cell texts (th and td alike). */
export function tablesOf(html) {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(([table]) => [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)]
    .map(([row]) => [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(([, cell]) => textOf(cell))));
}

/** The headings of the article's table of season-by-season records, as the revision pinned has them. */
export const TABLE_HEADINGS = Object.freeze(['Year', 'Best record', 'Total games', 'American League', 'National League']);

/**
 * The American League's [wins, losses] against the National League by season, from the page's one table whose headings
 * begin TABLE_HEADINGS: each row of a year, its American League's wins and its National League's (the American League's
 * losses), which must add up to its total games. → `{ '1997': [w, l], … }` for every year of the table.
 */
export function recordsOf(html) {
  const tables = tablesOf(html).filter(rows => TABLE_HEADINGS.every((heading, i) => rows[0]?.[i] === heading));
  if (tables.length !== 1) throw new Error(`${tables.length} tables headed ${TABLE_HEADINGS.join(' | ')}: the page is not the one pinned`);
  const [head, ...rows] = tables[0];
  const at = name => head.indexOf(name);
  const number = text => (/^\d[\d,]*$/.test(text) ? Number(text.replace(/,/g, '')) : NaN);
  const records = {};
  for (const row of rows) {
    if (!/^\d{4}$/.test(row[0])) continue;
    const total = number(row[at('Total games')]), w = number(row[at('American League')]), l = number(row[at('National League')]);
    if (![total, w, l].every(Number.isInteger)) throw new Error(`${row[0]}: the row reads ${JSON.stringify(row)}`);
    if (w + l !== total) throw new Error(`${row[0]}: ${w}–${l} is not its ${total} games`);
    records[row[0]] = [w, l];
  }
  return records;
}

/** Each season's American League wins less losses in the Baseball Databank (the committed snapshots). */
async function databankNets() {
  const nets = {};
  for (let year = FIRST_INTERLEAGUE; year <= LAST_COMPUTED; year++) {
    const { teams } = JSON.parse(await readFile(path.join(root, `scripts/data/mlb-war-seasons/${year}.json`), 'utf8'));
    nets[year] = Object.values(teams).filter(team => team.league === 'AL').reduce((sum, team) => sum + team.w - team.l, 0);
  }
  return nets;
}

async function fetchPage() {
  const response = await politeFetch(PAGE_URL, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${PAGE_URL}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const html = bytes.toString('utf8');
  const revision = revisionOf(html);
  const dir = path.join(root, CACHE_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, PAGE_FILE), bytes);
  const retrieved = new Date().toISOString().slice(0, 10);
  await writeFile(path.join(dir, 'SOURCE.txt'), `${PAGE_URL}\nretrieved ${retrieved} through scripts/lib/polite-fetch.mjs (User-Agent ${USER_AGENT}), `
    + `HTTP ${response.status}\nrevision ${revision}\nsha256 ${sha256(bytes)}\nbytes ${bytes.length}\n`);
  console.log(`Saved ${CACHE_DIR}/${PAGE_FILE}: revision ${revision}, ${bytes.length} bytes, sha256 ${sha256(bytes)}, retrieved ${retrieved}`);
}

const NOTE = 'The American League\'s record against the National League in each regular season\'s interleague games, 1997 to 2017: '
  + '[the American League\'s wins, the National League\'s] (docs/design/baseball.md, "One scale for both leagues"), from English Wikipedia\'s '
  + '"Interleague play" at the revision `source` pins (its table of each season\'s total games and each league\'s wins; facts only). Each season\'s '
  + 'wins less losses are the Baseball Databank\'s American League clubs\' wins less their losses (their games inside the league cancel out). '
  + 'Written by node scripts/sync-mlb-interleague.mjs; npm run build:mlb-seasons puts the two leagues on one scale with it (scripts/lib/mlb-war.mjs jointShareOf).';

/** scripts/data/mlb-interleague.json's text, from the cached page (`bytes`) and its pin (`pin`, the manifest's `sources.interleague`). */
export async function snapshotText(bytes, pin) {
  if (sha256(bytes) !== pin.sha256) throw new Error(`${pin.cache}/${pin.file} is not the pinned page (sha256 ${sha256(bytes)}, pinned ${pin.sha256})`);
  const html = bytes.toString('utf8');
  if (revisionOf(html) !== pin.revision) throw new Error(`${pin.cache}/${pin.file} is revision ${revisionOf(html)}, pinned ${pin.revision}`);
  const all = recordsOf(html);
  const nets = await databankNets();
  const seasons = {};
  for (let year = FIRST_INTERLEAGUE; year <= LAST_COMPUTED; year++) {
    const record = all[year];
    if (!record) throw new Error(`The page has no record for ${year}`);
    if (record[0] - record[1] !== nets[year]) {
      throw new Error(`${year}: the page's ${record[0]}–${record[1]} is ${record[0] - record[1]} net, the Databank's American League clubs ${nets[year]}`);
    }
    seasons[year] = record;
  }
  const doc = {
    note: NOTE,
    source: { name: pin.name, url: pin.url, revision: pin.revision, sha256: pin.sha256, retrieved: pin.retrieved, licence: pin.licence,
      table: TABLE_HEADINGS.join(' | ') },
    league: 'AL',
    seasons,
  };
  const head = JSON.stringify({ ...doc, seasons: undefined }, null, 2).replace(/\n}$/, '');
  const rows = Object.entries(seasons).map(([year, [w, l]]) => `    "${year}": [${w}, ${l}]`);
  return `${head},\n  "seasons": {\n${rows.join(',\n')}\n  }\n}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter(arg => !['--fetch', '--check'].includes(arg));
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  if (args.includes('--fetch')) { await fetchPage(); return; }
  const pin = JSON.parse(await readFile(manifestFile, 'utf8')).sources.interleague;
  if (!pin) throw new Error('scripts/data/mlb-war-seasons.json pins no `sources.interleague`: run --fetch and pin the page it prints');
  const at = path.join(root, pin.cache, pin.file);
  if (!existsSync(at)) throw new Error(`${pin.cache}/${pin.file} is not on this computer: run node scripts/sync-mlb-interleague.mjs --fetch`);
  const text = await snapshotText(await readFile(at), pin);
  if (args.includes('--check')) {
    const current = existsSync(outputFile) ? (await readFile(outputFile, 'utf8')).replace(/\r\n/g, '\n') : null;
    if (current !== text) throw new Error(`differs: ${path.relative(root, outputFile)}`);
    console.log(`Verified ${path.relative(root, outputFile)} byte for byte (revision ${pin.revision}, every season's net the Databank's).`);
    return;
  }
  await writeFile(outputFile, text);
  console.log(`Wrote ${path.relative(root, outputFile)}: ${LAST_COMPUTED - FIRST_INTERLEAGUE + 1} seasons from revision ${pin.revision}, every season's net the Databank's.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`sync-mlb-interleague: ${error.message}`);
    process.exitCode = 1;
  });
}
