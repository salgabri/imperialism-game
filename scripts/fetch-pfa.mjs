// Fetch Pro Football Archives' team-season pages (docs/design/american-football.md, "Computed seasons") into the
// gitignored data-src/pfa/: each season's league index (/<year>nfl.html, /<year>afl.html) and the page of every club it
// lists (/<year><league><team>.html, the regular season), which npm run sync:pfa reads. Facts only are taken from them
// (who played, at which position, in how many games and starts, and the season's box-score totals).
//
//   npm run fetch:pfa                       the seasons the computed seasons need (SEASONS), then pins them
//   npm run fetch:pfa -- --years=1965,1970-1972 --league=afl   some of them
//   npm run fetch:pfa -- --pin              only rewrite scripts/data/pfa-pages.json from the pages already here
//
// Politely: robots.txt first (the site has none: HTTP 404), then one request every 5 s, a page already in data-src/pfa/
// never fetched again. Every answer is logged in data-src/pfa/fetch-log.tsv (time, status, bytes, SHA-256, URL). An
// answer other than 200 or 404 (a block, a challenge, a server error) stops the run, and nothing tries to get round it;
// so does a 200 that is not the page asked for. scripts/data/pfa-pages.json (committed) pins every page by SHA-256:
// the sync reads a page only when it is the pinned one.
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { clubPagesOf } from './lib/pfa.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, 'data-src/pfa');
const pinsFile = path.join(root, 'scripts/data/pfa-pages.json');
const SITE = 'https://www.profootballarchives.com';
const USER_AGENT = 'imperialism-game data sync (low rate; github.com/salgabri/imperialism-game)';
const GAP_MS = 5000;

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/** The seasons the build reads, by league: the computed NFL and AFL seasons, and 2001–2005, which tune their weights. */
export const SEASONS = {
  nfl: [...range(1960, 1989), 1991, 1996, 1997, ...range(2001, 2005)],
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

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let last = 0;

/** One polite request: `{ status, bytes }`. Throws on anything but 200 or 404, and on a 200 that is not a PFA page. */
async function get(url, expect) {
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  let response;
  try {
    response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'manual', signal: AbortSignal.timeout(60000) });
  } catch (error) {
    await appendFile(path.join(cacheDir, 'fetch-log.tsv'), `${new Date().toISOString()}\tERR\t0\t-\t${url}\n`);
    throw new Error(`${url}: ${error.message}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await appendFile(path.join(cacheDir, 'fetch-log.tsv'), `${new Date().toISOString()}\t${response.status}\t${bytes.length}\t${sha256(bytes)}\t${url}\n`);
  if (response.status === 404) return { status: 404, bytes };
  if (response.status !== 200) throw new Error(`${url} answered HTTP ${response.status}: stopping (no retry, nothing worked around)`);
  if (expect && !expect.test(bytes.toString('utf8'))) throw new Error(`${url} answered 200 with something other than the page: stopping`);
  return { status: 200, bytes };
}

/** Every page in data-src/pfa/<year>/ (and its box scores, <year>/box/) by its path there, and its SHA-256. */
async function pins() {
  const files = {};
  for (const year of (await readdir(cacheDir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort()) {
    for (const sub of ['', 'box/']) {
      const dir = path.join(cacheDir, year, sub);
      if (!existsSync(dir)) continue;
      for (const name of (await readdir(dir)).filter(n => n.endsWith('.html')).sort()) {
        files[`${year}/${sub}${name}`] = sha256(await readFile(path.join(dir, name)));
      }
    }
  }
  return files;
}

async function writePins() {
  const files = await pins();
  const log = existsSync(path.join(cacheDir, 'fetch-log.tsv')) ? await readFile(path.join(cacheDir, 'fetch-log.tsv'), 'utf8') : '';
  const days = [...new Set(log.split('\n').filter(Boolean).map(line => line.slice(0, 10)))].sort();
  const doc = {
    note: 'Pro Football Archives (https://www.profootballarchives.com) team-season pages, as npm run fetch:pfa saved them in the gitignored data-src/pfa/<year>/, each by its SHA-256: npm run sync:pfa reads a page only when it is the one pinned here. Facts only are taken from them. (c) 2006-2026 Pro Football Archives; the site states no terms of use and has no robots.txt (HTTP 404).',
    site: SITE,
    retrieved: days.length ? (days.length > 1 ? `${days[0]} to ${days.at(-1)}` : days[0]) : null,
    files,
  };
  await writeFile(pinsFile, `${JSON.stringify(doc, null, 1)}\n`);
  console.log(`Pinned ${Object.keys(files).length} pages in ${path.relative(root, pinsFile)}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const option = name => argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const unknown = argv.filter(arg => !/^--(years|league)=/.test(arg) && arg !== '--pin');
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  await mkdir(cacheDir, { recursive: true });
  if (argv.includes('--pin')) return writePins();
  // A run started right after another keeps the gap too: the first request waits for the log's last answer.
  const logFile = path.join(cacheDir, 'fetch-log.tsv');
  if (existsSync(logFile)) last = Date.parse((await readFile(logFile, 'utf8')).trim().split('\n').at(-1)?.split('\t')[0]) || 0;
  const leagues = option('league') ? [option('league')] : Object.keys(SEASONS);
  if (leagues.some(league => !SEASONS[league])) throw new Error(`Unknown league ${option('league')}`);
  const years = option('years')?.split(',').flatMap(part => {
    const [from, to] = part.split('-').map(Number);
    return range(from, to ?? from);
  });

  const robots = await get(`${SITE}/robots.txt`);
  if (robots.status !== 404) throw new Error('robots.txt now exists: read it before fetching anything (this script assumes none)');
  let fetched = 0, kept = 0;
  for (const league of leagues) {
    for (const year of SEASONS[league].filter(y => !years || years.includes(y))) {
      const dir = path.join(cacheDir, String(year));
      await mkdir(dir, { recursive: true });
      const indexFile = path.join(dir, `${year}${league}.html`);
      if (!existsSync(indexFile)) {
        const { status, bytes } = await get(`${SITE}/${year}${league}.html`, new RegExp(`${year} ${league.toUpperCase()} Season`));
        if (status !== 200) throw new Error(`No ${year} ${league.toUpperCase()} index`);
        await writeFile(indexFile, bytes);
        fetched++;
      }
      const clubs = clubPagesOf(await readFile(indexFile, 'utf8'), year, league);
      if (!clubs.length) throw new Error(`The ${year} ${league.toUpperCase()} index lists no clubs`);
      for (const page of clubs) {
        const file = path.join(dir, page);
        if (existsSync(file)) { kept++; continue; }
        const { status, bytes } = await get(`${SITE}/${page}`, new RegExp(`<title>${year} [^<]*\\(${league.toUpperCase()}\\)`));
        if (status !== 200) { console.log(`  ${page}: HTTP ${status}`); continue; }
        await writeFile(file, bytes);
        fetched++;
      }
      // The box scores of the strike games, from the clubs' own score tables.
      if (STRIKE_GAMES[year]) {
        await mkdir(path.join(dir, 'box'), { recursive: true });
        const scores = [];
        for (const page of clubs) for (const href of boxScoresOf(await readFile(path.join(dir, page), 'utf8'), STRIKE_GAMES[year])) if (!scores.includes(href)) scores.push(href);
        for (const href of scores) {
          const file = path.join(dir, 'box', path.basename(href));
          if (existsSync(file)) { kept++; continue; }
          const { status, bytes } = await get(`${SITE}${href}`, new RegExp(String(year)));
          if (status !== 200) throw new Error(`${href}: HTTP ${status}`);
          await writeFile(file, bytes);
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
