// Read FIBA's men's national-team results of 2023–2026 into their committed facts (docs/design/euroleague.md, "The
// nations' level"):
//
//   npm run sync:fiba-results                  writes scripts/data/fiba-results.json from the pinned pages
//   npm run sync:fiba-results -- --check       builds it and compares byte for byte, writes nothing
//   npm run sync:fiba-results -- --fetch       first downloads the pages missing from data-src/fiba-results/
//   npm run sync:fiba-results -- --pin         records each page's revision, SHA-256 and size in
//                                              scripts/data/fiba-results-sources.json, after a deliberate new download
//   npm run sync:fiba-results -- --data=<dir>  the downloaded pages elsewhere (default data-src/)
//
// Every source is an English Wikipedia article page (scripts/data/fiba-results-sources.json: the 2023 World Cup's groups
// and final round, the 2024 Olympic qualifying tournaments and the Olympic tournament, EuroBasket, the AmeriCup,
// AfroBasket and the Asia Cup of 2025, and the 2027 World Cup's qualifiers so far), pinned by SHA-256 at the revision
// read, and the sync stops on any other. Downloads go through scripts/lib/polite-fetch.mjs, Wikipedia's article paths
// (/wiki/, which its robots.txt allows) one at a time, 2 s apart. npm run build-basketball reads only the facts this writes.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { factsText, gamesOfPage, pageOf } from './lib/fiba-results.mjs';
import { politeFetch } from './lib/polite-fetch.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCES = path.join(root, 'scripts/data/fiba-results-sources.json');
const FACTS = path.join(root, 'scripts/data/fiba-results.json');
const FOLDER = 'fiba-results';
const GAP = 2_000;

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
/** An article's /wiki/ address, the only path read. */
export const pageUrl = title => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

/** Download each page not yet in the cache, one at a time. */
async function fetchMissing(dir, sources) {
  for (const page of sources.pages) {
    const at = path.join(dir, page.file);
    if (existsSync(at)) continue;
    const url = pageUrl(page.title);
    console.log(`Saving ${url}`);
    const response = await politeFetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    pageOf(bytes.toString('utf8'));
    await mkdir(dir, { recursive: true });
    await writeFile(at, bytes);
    await wait(GAP);
  }
}

/** Record each cached page's revision, the page it shows, its SHA-256 and size. */
async function pinAll(dir, sources) {
  for (const page of sources.pages) {
    const bytes = await readFile(path.join(dir, page.file));
    const shown = pageOf(bytes.toString('utf8'));
    Object.assign(page, { page: shown.page, revision: shown.revision, sha256: sha256(bytes), bytes: bytes.length });
  }
  sources.retrieved = new Date().toISOString().slice(0, 10);
  await writeFile(SOURCES, `${JSON.stringify(sources, null, 1)}\n`);
  console.log(`Pinned ${sources.pages.length} pages in ${path.relative(root, SOURCES)}`);
}

/** A page's text, after checking it is the pinned one: its bytes, and the page and revision it shows. */
async function pinnedPage(dir, page) {
  const at = path.join(dir, page.file);
  if (!existsSync(at)) throw new Error(`${at} is missing: npm run sync:fiba-results -- --fetch downloads ${pageUrl(page.title)}`);
  const bytes = await readFile(at);
  if (sha256(bytes) !== page.sha256 || bytes.length !== page.bytes) {
    throw new Error(`${at} is not the pinned page (SHA-256 ${sha256(bytes)}, ${bytes.length} bytes); see ${path.relative(root, SOURCES)}`);
  }
  const html = bytes.toString('utf8');
  const shown = pageOf(html);
  if (shown.page !== page.page || shown.revision !== page.revision) {
    throw new Error(`${page.file} shows ${shown.page} revision ${shown.revision}, not ${page.page} revision ${page.revision}`);
  }
  return html;
}

/** The facts: every played game of every page, one row each, by date. */
export function factsOf(sources, pages) {
  const games = [];
  const pageRows = [];
  for (const page of sources.pages) {
    const competition = { id: page.competition, ...sources.competitions[page.competition] };
    const found = gamesOfPage(pages.get(page.file), competition);
    if (!found.length) throw new Error(`${page.title} shows no game played`);
    games.push(...found);
    pageRows.push([page.title, page.page, page.revision, pageUrl(page.page), found.length]);
  }
  const key = game => `${game[0]}|${[game[2], game[3]].sort().join('|')}`;
  const seen = new Map();
  for (const game of games) {
    if (seen.has(key(game))) throw new Error(`${key(game)} is on two pages: the sources may list one game once`);
    seen.set(key(game), game);
  }
  games.sort((x, y) => x[0].localeCompare(y[0]) || x[1].localeCompare(y[1]) || x[2].localeCompare(y[2]) || x[3].localeCompare(y[3]));
  return {
    about: 'FIBA\'s men\'s national-team results, 2023–2026, as English Wikipedia\'s article pages show them (scripts/sync-fiba-results.mjs, '
      + 'scripts/data/fiba-results-sources.json): every game played of the 2023 World Cup (classification included), the 2024 Olympic '
      + 'qualifying tournaments and Olympic tournament, the 2025 continental championships and the 2027 World Cup\'s qualifiers and '
      + 'pre-qualifiers so far. A game is [date, competition, side A, side B, A\'s points, B\'s points, overtimes, home: A, B or N for '
      + 'neutral, venue as the page gives it]; overtime points count in the score. Each page is [title read, page shown, revision, address, games].',
    source: { ...sources.source, retrieved: sources.retrieved ?? null },
    competitions: Object.fromEntries(Object.entries(sources.competitions).map(([id, c]) => [id, c.name])),
    pages: pageRows,
    games,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sources = JSON.parse(await readFile(SOURCES, 'utf8'));
  const dir = path.join(path.resolve(args.data ?? path.join(root, 'data-src')), FOLDER);
  if (args.fetch) await fetchMissing(dir, sources);
  if (args.pin) await pinAll(dir, sources);
  const pages = new Map();
  for (const page of sources.pages) pages.set(page.file, await pinnedPage(dir, page));
  const facts = factsOf(sources, pages);
  const text = factsText(facts);
  if (args.check) {
    const current = existsSync(FACTS) ? (await readFile(FACTS, 'utf8')).replace(/\r\n/g, '\n') : null;
    if (current !== text) { console.error(`differs: ${path.relative(root, FACTS)}`); process.exit(1); }
    console.log(`Verified ${path.relative(root, FACTS)} byte for byte: ${facts.games.length} games from ${facts.pages.length} pages.`);
    return;
  }
  await writeFile(FACTS, text);
  const by = {};
  for (const game of facts.games) by[game[1]] = (by[game[1]] ?? 0) + 1;
  console.log(`Wrote ${path.relative(root, FACTS)}: ${facts.games.length} games from ${facts.pages.length} pages (${Object.entries(by).map(([c, n]) => `${c} ${n}`).join(', ')})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
