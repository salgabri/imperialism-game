// Fetch Pro Football Archives' team-season pages (docs/design/american-football.md, "Computed seasons") into the
// gitignored data-src/pfa/: each season's league index (/<year>nfl.html, /<year>afl.html) and the page of every club it
// lists (/<year><league><team>.html, the regular season), which npm run sync:pfa reads. Facts only are taken from them
// (who played, at which position, in how many games and starts, and the season's box-score totals).
//
//   npm run fetch:pfa                       the seasons the computed seasons need (SEASONS), then pins them
//   npm run fetch:pfa -- --years=1965,1970-1972 --league=afl   some of them
//   npm run fetch:pfa -- --years=1998-2000 --into=pfa-1998-2000   a later download, kept apart in data-src/pfa-1998-2000/
//   npm run fetch:pfa -- --pin              only rewrite scripts/data/pfa-pages.json from the pages already here
//
// The pages sit in data-src/pfa/ or in the data-src/pfa-<name>/ of a later download, each laid out alike (<year>/,
// <year>/box/, fetch-log.tsv): a page in any of them is never fetched again, and the sync reads each from wherever it is.
//
// Politely: robots.txt first (the site has none: HTTP 404; should one appear, the run keeps a copy beside the pages and
// stops for it to be read), then one request every 5 s, across runs too, under a plain User-Agent that names no person.
// Every answer is logged in the folder's fetch-log.tsv (time, status, bytes, SHA-256, URL). An answer other than 200 or
// 404 (a block, a challenge, a server error) stops the run, and nothing tries to get round it; so does a 200 that is not
// the page asked for. scripts/data/pfa-pages.json (committed) pins every page by SHA-256, and names the day each
// season's pages were saved: the sync reads a page only when it is the pinned one.
import { existsSync, readdirSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { clubPagesOf } from './lib/pfa.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataSrc = path.join(root, 'data-src');
const pinsFile = path.join(root, 'scripts/data/pfa-pages.json');
const SITE = 'https://www.profootballarchives.com';
const USER_AGENT = 'imperialism-game-data/1.0';
const GAP_MS = 5000;

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/** The seasons the build reads, by league: the computed NFL and AFL seasons, and 2001–2005, which tune their weights. */
export const SEASONS = {
  nfl: [...range(1960, 1989), 1991, ...range(1996, 2005)],
  afl: range(1960, 1969),
};

/**
 * The strike games of 1987, weeks 4 to 6 (4 to 19 October), played by replacement players: their box scores tell those
 * players from the clubs' own (the computed 1987 season ranks its regular players only).
 */
export const STRIKE_GAMES = { 1987: ['1987-10-04', '1987-10-19'] };

/** The box scores a club page links for its games between two days (ISO dates), each once: `['/nflboxscores1/1987nfl050.html', …]`. */
export function boxScoresOf(html, [from, to]) {
  const out = [];
  for (const [, href, month, day, year] of html.matchAll(/<a href="(\/nflboxscores\d*\/[^"]+\.html)">(\d+)\/(\d+)\/(\d{4})<\/a>/g)) {
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    if (date >= from && date <= to && !out.includes(href)) out.push(href);
  }
  return out;
}

/**
 * The folders the pages are kept in: data-src/pfa/ first, then the data-src/pfa-<name>/ of each later download (a
 * folder or a link to one).
 */
export function cacheFolders(base = dataSrc) {
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter(entry => /^pfa(?:-[\w.-]+)?$/.test(entry.name) && (entry.isDirectory() || entry.isSymbolicLink()))
    .map(entry => entry.name).sort((a, b) => (a === 'pfa' ? -1 : b === 'pfa' ? 1 : a < b ? -1 : 1))
    .map(name => path.join(base, name));
}

/** Every copy of a page (by its path in a folder: '1998/1998nflari.html', '1987/box/1987nfl043.html'), in folder order. */
export const copiesOf = (file, folders = cacheFolders()) => folders.map(folder => path.join(folder, file)).filter(full => existsSync(full));

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let last = 0;
let logFile = null;

/** One polite request: `{ status, bytes }`. Throws on anything but 200 or 404, and on a 200 that is not a PFA page. */
async function get(url, expect) {
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  let response;
  try {
    response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'manual', signal: AbortSignal.timeout(60000) });
  } catch (error) {
    await appendFile(logFile, `${new Date().toISOString()}\tERR\t0\t-\t${url}\n`);
    throw new Error(`${url}: ${error.message}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await appendFile(logFile, `${new Date().toISOString()}\t${response.status}\t${bytes.length}\t${sha256(bytes)}\t${url}\n`);
  if (response.status === 404) return { status: 404, bytes };
  if (response.status !== 200) throw new Error(`${url} answered HTTP ${response.status}: stopping (no retry, nothing worked around)`);
  if (expect && !expect.test(bytes.toString('utf8'))) throw new Error(`${url} answered 200 with something other than the page: stopping`);
  return { status: 200, bytes };
}

/** The fetch logs' lines of every folder: `[{ time, status, sha, url }]`. */
async function logLines() {
  const lines = [];
  for (const folder of cacheFolders()) {
    const file = path.join(folder, 'fetch-log.tsv');
    if (!existsSync(file)) continue;
    for (const line of (await readFile(file, 'utf8')).split('\n').filter(Boolean)) {
      const [time, status, , sha, url] = line.split('\t');
      lines.push({ time, status, sha, url });
    }
  }
  return lines;
}

/**
 * Every page of every folder (and its box scores, <year>/box/) by its path there, and its SHA-256, by year, the year's
 * own pages before its box scores; a page two folders hold must be the same. With the day each season's pages were
 * saved, by the fetch logs' answers: `{ files, retrieved: { day: [years] } }`.
 */
async function pins() {
  const files = new Map();
  for (const folder of cacheFolders()) {
    for (const year of (await readdir(folder, { withFileTypes: true })).filter(d => d.isDirectory() && /^\d{4}$/.test(d.name)).map(d => d.name)) {
      for (const sub of ['', 'box/']) {
        const dir = path.join(folder, year, sub);
        if (!existsSync(dir)) continue;
        for (const name of (await readdir(dir)).filter(n => n.endsWith('.html'))) {
          const file = `${year}/${sub}${name}`, sha = sha256(await readFile(path.join(dir, name)));
          if (files.has(file) && files.get(file) !== sha) throw new Error(`Two folders hold different copies of ${file}`);
          files.set(file, sha);
        }
      }
    }
  }
  const box = file => file.split('/').length > 2;
  const order = [...files.keys()].sort((a, b) => (a.slice(0, 4) !== b.slice(0, 4) ? (a < b ? -1 : 1)
    : box(a) !== box(b) ? (box(a) ? 1 : -1) : a < b ? -1 : a > b ? 1 : 0));
  const savedOn = new Map();
  for (const { time, status, sha } of await logLines()) {
    const day = time.slice(0, 10);
    if (status === '200' && !(savedOn.get(sha) <= day)) savedOn.set(sha, day);
  }
  const days = new Map();
  for (const file of order) {
    const day = savedOn.get(files.get(file));
    if (!day) throw new Error(`No fetch log records ${file} (SHA-256 ${files.get(file)})`);
    if (!days.has(day)) days.set(day, new Set());
    days.get(day).add(Number(file.slice(0, 4)));
  }
  return {
    files: Object.fromEntries(order.map(file => [file, files.get(file)])),
    retrieved: Object.fromEntries([...days.keys()].sort().map(day => [day, [...days.get(day)].sort((a, b) => a - b)])),
  };
}

async function writePins() {
  const { files, retrieved } = await pins();
  const note = 'Pro Football Archives (https://www.profootballarchives.com) team-season pages, as npm run fetch:pfa saved them in the gitignored data-src/pfa/<year>/ (or a later download\'s data-src/pfa-<name>/<year>/), each by its SHA-256: npm run sync:pfa reads a page only when it is the one pinned here. `retrieved`: the seasons whose pages were saved on each day, by the fetch logs. Facts only are taken from them. (c) 2006-2026 Pro Football Archives; the site states no terms of use and has no robots.txt (HTTP 404).';
  // One line a day; the pages one a line, as JSON.stringify indents them.
  const days = Object.entries(retrieved).map(([day, years]) => `\n  ${JSON.stringify(day)}: ${JSON.stringify(years)}`).join(',');
  await writeFile(pinsFile, `{\n "note": ${JSON.stringify(note)},\n "site": ${JSON.stringify(SITE)},\n "retrieved": {${days}\n },\n`
    + ` "files": ${JSON.stringify(files, null, 1).replace(/\n/g, '\n ')}\n}\n`);
  console.log(`Pinned ${Object.keys(files).length} pages in ${path.relative(root, pinsFile)}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const option = name => argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const unknown = argv.filter(arg => !/^--(years|league|into)=/.test(arg) && arg !== '--pin');
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  if (argv.includes('--pin')) return writePins();
  // A later download goes into a folder of its own, data-src/pfa-<name>/, which the sync reads beside data-src/pfa/.
  const into = option('into') ?? 'pfa';
  if (!/^pfa(?:-[\w.-]+)?$/.test(into)) throw new Error(`--into=${into}: name a folder pfa-<name> (data-src/pfa-<name>/)`);
  const cacheDir = path.join(dataSrc, into);
  await mkdir(cacheDir, { recursive: true });
  logFile = path.join(cacheDir, 'fetch-log.tsv');
  // A run started right after another keeps the gap too: the first request waits for the logs' last answer.
  last = Math.max(0, ...(await logLines()).map(line => Date.parse(line.time) || 0));
  const leagues = option('league') ? [option('league')] : Object.keys(SEASONS);
  if (leagues.some(league => !SEASONS[league])) throw new Error(`Unknown league ${option('league')}`);
  const years = option('years')?.split(',').flatMap(part => {
    const [from, to] = part.split('-').map(Number);
    return range(from, to ?? from);
  });

  const robots = await get(`${SITE}/robots.txt`);
  if (robots.status !== 404) {
    await writeFile(path.join(cacheDir, 'robots.txt'), robots.bytes);
    throw new Error(`robots.txt now exists (kept in ${path.relative(root, cacheDir)}): read it before fetching anything (this script assumes none)`);
  }
  // A page is read from the first folder that has it, and saved into this run's folder.
  const have = file => copiesOf(file)[0];
  let fetched = 0, kept = 0;
  for (const league of leagues) {
    for (const year of SEASONS[league].filter(y => !years || years.includes(y))) {
      const dir = path.join(cacheDir, String(year));
      const index = `${year}/${year}${league}.html`;
      if (!have(index)) {
        const { status, bytes } = await get(`${SITE}/${year}${league}.html`, new RegExp(`${year} ${league.toUpperCase()} Season`));
        if (status !== 200) throw new Error(`No ${year} ${league.toUpperCase()} index`);
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(cacheDir, index), bytes);
        fetched++;
      }
      const clubs = clubPagesOf(await readFile(have(index), 'utf8'), year, league);
      if (!clubs.length) throw new Error(`The ${year} ${league.toUpperCase()} index lists no clubs`);
      for (const page of clubs) {
        if (have(`${year}/${page}`)) { kept++; continue; }
        const { status, bytes } = await get(`${SITE}/${page}`, new RegExp(`<title>${year} [^<]*\\(${league.toUpperCase()}\\)`));
        if (status !== 200) { console.log(`  ${page}: HTTP ${status}`); continue; }
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, page), bytes);
        fetched++;
      }
      // The box scores of the strike games, from the clubs' own score tables.
      if (STRIKE_GAMES[year]) {
        const scores = [];
        for (const page of clubs) for (const href of boxScoresOf(await readFile(have(`${year}/${page}`), 'utf8'), STRIKE_GAMES[year])) if (!scores.includes(href)) scores.push(href);
        for (const href of scores) {
          const file = `${year}/box/${path.basename(href)}`;
          if (have(file)) { kept++; continue; }
          const { status, bytes } = await get(`${SITE}${href}`, new RegExp(String(year)));
          if (status !== 200) throw new Error(`${href}: HTTP ${status}`);
          await mkdir(path.join(dir, 'box'), { recursive: true });
          await writeFile(path.join(cacheDir, file), bytes);
          fetched++;
        }
        console.log(`  ${year}: ${scores.length} box scores of the strike games`);
      }
      console.log(`${year} ${league.toUpperCase()}: ${clubs.length} clubs (${fetched} pages fetched so far, ${kept} already here)`);
    }
  }
  await writePins();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`fetch-pfa: ${error.message}`);
    process.exitCode = 1;
  });
}
