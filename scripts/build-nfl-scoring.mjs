// The NFL's and the AFL's scoring, season by season (docs/design/american-football.md, "Rules by era"): each league
// season's team-games, points, touchdowns, extra points, two-point tries, field goals and safeties, summed over its
// clubs' regular seasons from Pro Football Archives' team-season pages (their SCORING tables' Team Totals and their
// score tables). An earlier season plays at its own (src/sports/americanFootball.js, seasonRules).
//
//   npm run build:nfl-scoring -- --fetch    save the pages no cache holds yet (below), and nflverse's games
//   npm run build:nfl-scoring               read every season's pages: scripts/data/nfl-scoring.json and
//                                           src/data/nflLeagueAverages.js
//   npm run build:nfl-scoring -- --check    both files byte for byte where data-src/ has every page, else the module
//                                           from the committed table; and each season's average matchup from its clubs
//   npm run build:nfl-scoring -- --report   each season's figures a team-game, from the committed table
//
// The pages: the computed seasons' (npm run fetch:pfa: data-src/pfa/ and data-src/pfa-1998-2000/, pinned in
// scripts/data/pfa-pages.json) hold 1960 to 1989, 1991 and 1996 to 2005, and the AFL's ten seasons; --fetch saves the
// rest (1990, 1992 to 1995 and 2006 to 2024) into the ignored data-src/nfl-scoring/, as politely as fetch:pfa does:
// through politeFetch (scripts/lib/polite-fetch.mjs: robots.txt first, for this agent and Anthropic's crawlers, and the
// project's one User-Agent; the site has none: HTTP 404), one request every 5 s, every answer logged (fetch-log.tsv), and
// anything but 200 or 404 stops the run. scripts/data/nfl-scoring.json pins every
// page it read by SHA-256. Facts only are taken. The site had no 2025 season on 2026-11-13 (its index answered HTTP
// 404), so the table ends with 2024, whose figures a later season plays (src/sports/americanFootball.js, seasonRules).
//
// A second source checks the points: nflverse's games (github.com/nflverse/nfldata, data/games.csv, at a pinned
// commit, through jsDelivr), every regular-season score from 1999. Each season's points a team-game must agree.
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clubPagesOf, parseTeamSeason } from './lib/pfa.mjs';
import { copiesOf } from './fetch-pfa.mjs';
import { politeFetch } from './lib/polite-fetch.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OWN = path.join(root, 'data-src', 'nfl-scoring');
const TABLE = path.join(root, 'scripts/data/nfl-scoring.json');
const MODULE = path.join(root, 'src/data/nflLeagueAverages.js');
const SITE = 'https://www.profootballarchives.com';
const GAP_MS = 5000;
/** nflverse's games, at the commit read on 2026-11-10 (the 2026 season under way: only finished seasons are read). */
export const NFLVERSE = Object.freeze({ repo: 'nflverse/nfldata', commit: 'cf94eee45c7af1955914145a1a84fab705327724', file: 'data/games.csv',
  first: 1999 });
const nflverseUrl = `https://cdn.jsdelivr.net/gh/${NFLVERSE.repo}@${NFLVERSE.commit}/${NFLVERSE.file}`;
const nflverseCopy = path.join(OWN, 'nflverse', `games-${NFLVERSE.commit.slice(0, 12)}.csv`);

// The points a season nflverse's scores and the site's scoring tables may differ by: a slip of a point or two in a
// season's tables, never a game's worth.
const NFLVERSE_SLACK = 2;

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/** Every league season the table holds: the NFL's from 1960 to the last the site has (2024), the AFL's ten. */
export const SEASONS = Object.freeze({ nfl: range(1960, 2024), afl: range(1960, 1969) });

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * A league index's club pages (clubPagesOf), less its navigation's Draft link, which the 2008 index misspells
 * (2008nflraft.html, answering HTTP 404).
 */
export function clubsOf(html, year, league) {
  const draft = new Set([...html.matchAll(/<a href="\/?([^"]+)">Draft<\/a>/g)].map(m => m[1]));
  return clubPagesOf(html, year, league).filter(page => !draft.has(page));
}

/** A page by its path in a cache folder ('1990/1990nflbuf.html'): the computed seasons' copy first, else ours. */
function copyOf(file) {
  const own = path.join(OWN, file);
  return copiesOf(file)[0] ?? (existsSync(own) ? own : null);
}

// ---------- fetching ----------

let last = 0;

/** One polite request: `{ status, bytes }`. Throws on anything but 200 or 404, and on a 200 that is not the page asked for. */
async function get(url, expect) {
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const log = path.join(OWN, 'fetch-log.tsv');
  let response;
  try {
    response = await politeFetch(url, { redirect: 'manual', signal: AbortSignal.timeout(60000) });
  } catch (error) {
    await appendFile(log, `${new Date().toISOString()}\tERR\t0\t-\t${url}\n`);
    throw new Error(`${url}: ${error.message}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await appendFile(log, `${new Date().toISOString()}\t${response.status}\t${bytes.length}\t${sha256(bytes)}\t${url}\n`);
  if (response.status === 404) return { status: 404, bytes };
  if (response.status !== 200) throw new Error(`${url} answered HTTP ${response.status}: stopping (no retry, nothing worked around)`);
  if (expect && !expect.test(bytes.toString('utf8'))) throw new Error(`${url} answered 200 with something other than the page: stopping`);
  return { status: 200, bytes };
}

/** `only`: the years to fetch (`--years=2018-2020,2024`), every season's by default. */
async function fetchMissing(only = null) {
  await mkdir(OWN, { recursive: true });
  const logFile = path.join(OWN, 'fetch-log.tsv');
  // A run started right after another keeps the gap too.
  if (existsSync(logFile)) {
    const times = (await readFile(logFile, 'utf8')).split('\n').filter(Boolean).map(line => Date.parse(line.split('\t')[0]) || 0);
    last = Math.max(0, ...times);
  }
  if (!existsSync(nflverseCopy)) {
    const { status, bytes } = await get(nflverseUrl, /^nfl_detail_id|^game_id|game_id,/);
    if (status !== 200) throw new Error(`No nflverse games at ${nflverseUrl}`);
    await mkdir(path.dirname(nflverseCopy), { recursive: true });
    await writeFile(nflverseCopy, bytes);
    console.log(`nflverse games: ${bytes.length} bytes`);
  }
  const robots = await get(`${SITE}/robots.txt`);
  if (robots.status !== 404) {
    await writeFile(path.join(OWN, 'robots.txt'), robots.bytes);
    throw new Error('robots.txt now exists (kept in data-src/nfl-scoring/): read it before fetching anything (this script assumes none)');
  }
  let fetched = 0;
  for (const [league, years] of Object.entries(SEASONS)) {
    for (const year of years.filter(y => !only || only.includes(y))) {
      const index = `${year}/${year}${league}.html`;
      if (!copyOf(index)) {
        const { status, bytes } = await get(`${SITE}/${year}${league}.html`, new RegExp(`${year} ${league.toUpperCase()} Season`));
        if (status !== 200) throw new Error(`No ${year} ${league.toUpperCase()} index`);
        await mkdir(path.join(OWN, String(year)), { recursive: true });
        await writeFile(path.join(OWN, index), bytes);
        fetched++;
      }
      const clubs = clubsOf(await readFile(copyOf(index), 'utf8'), year, league);
      if (!clubs.length) throw new Error(`The ${year} ${league.toUpperCase()} index lists no clubs`);
      let saved = 0;
      for (const page of clubs) {
        if (copyOf(`${year}/${page}`)) continue;
        const { status, bytes } = await get(`${SITE}/${page}`, new RegExp(`<title>${year} [^<]*\\(${league.toUpperCase()}\\)`));
        if (status !== 200) throw new Error(`${page}: HTTP ${status}`);
        await mkdir(path.join(OWN, String(year)), { recursive: true });
        await writeFile(path.join(OWN, String(year), page), bytes);
        fetched++;
        saved++;
      }
      if (saved) console.log(`${year} ${league.toUpperCase()}: ${saved} of ${clubs.length} club pages saved (${fetched} pages so far)`);
    }
  }
  console.log(`Fetched ${fetched} pages`);
}

// ---------- reading ----------

// DX: the defence's two-point conversions (a try returned to the other end zone, worth 2 to the defence since 2015).
const COUNTS = ['TD', 'X1', 'X1A', 'X2', 'X2A', 'DX', 'FG', 'FGA', 'SAF', 'PTS'];

/** The points a club's SCORING totals add up to: touchdowns and their tries, field goals, safeties, the defence's tries. */
const partsOf = t => 6 * (t.TD ?? 0) + (t.X1 ?? 0) + 2 * (t.X2 ?? 0) + 2 * (t.DX ?? 0) + 3 * (t.FG ?? 0) + 2 * (t.SAF ?? 0);

/**
 * The regular-season games a club page's score table gives as tied ('T'). Its overtime marks ('W OT') are left alone:
 * they miss games (21 in 2002, where nflverse's games have 25).
 */
export function tiesOf(html) {
  return scoreRows(html).filter(row => row.result === 'T').length;
}

/**
 * The regular-season games of a club page's score table, each `{ result, for, against }`: its result 'W', 'L', 'T', or
 * '-' for a game never finished (the Bills' at Cincinnati of 2 January 2023, suspended in the first quarter and
 * cancelled), which nflverse's games leave out and so does the table.
 */
export function scoreRows(html) {
  const table = /<th[^>]*>SCORES<\/th>[\s\S]*?<\/table>/.exec(html)?.[0] ?? '';
  const rows = [];
  for (const [, attrs, inner] of table.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)) {
    const kind = /class="([^"]*)"/.exec(attrs)?.[1] ?? '';
    const cells = [...inner.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim());
    if (kind === 'exh' || kind === 'playoff' || cells.length < 11 || !/^\d+$/.test(cells[4]) || !/^\d+$/.test(cells[5])) continue;
    rows.push({ result: cells[6], for: Number(cells[4]), against: Number(cells[5]) });
  }
  return rows;
}

/**
 * One league season's scoring from its pages: `{ league, year, clubs, games, points, agreed, corrected, TD, X1, X1A, X2,
 * X2A, DX, FG, FGA, SAF, PTS, ties, pages }`, `games` its team-games, `points` its score tables' sum, PTS its SCORING
 * tables', `ties` its tied games (each counted from both clubs' pages, halved), `pages` every page read with its SHA-256.
 * `agreed`: each club's points as two of its three figures have them (its SCORING table's PTS, what that table's
 * touchdowns, tries, field goals and safeties add up to, and its score table's sum), which every club of 1960 to 2024 has;
 * `corrected` the clubs whose PTS the other two overrule (the 2013 Ravens' "32" for 320).
 */
export async function leagueSeason(league, year, read = file => readFile(copyOf(file))) {
  const index = `${year}/${year}${league}.html`;
  const pages = { [index]: sha256(await read(index)) };
  const clubs = clubsOf((await read(index)).toString('utf8'), year, league);
  const season = { league: league.toUpperCase(), year, clubs: clubs.length, games: 0, points: 0, agreed: 0, corrected: [],
    ...Object.fromEntries(COUNTS.map(k => [k, 0])), ties: 0 };
  for (const club of clubs) {
    const file = `${year}/${club}`;
    const bytes = await read(file);
    pages[file] = sha256(bytes);
    const html = bytes.toString('utf8');
    const page = parseTeamSeason(html);
    const totals = page.totals.SCORING?.team;
    if (!totals) throw new Error(`${file} has no SCORING totals`);
    // A game never finished counts neither as a game nor for its points (scoreRows).
    const unfinished = scoreRows(html).filter(row => row.result === '-');
    const table = page.games.reduce((sum, game) => sum + game.for, 0) - unfinished.reduce((sum, row) => sum + row.for, 0), parts = partsOf(totals);
    const agreed = totals.PTS === parts || totals.PTS === table ? totals.PTS : parts === table ? parts : null;
    if (agreed === null) throw new Error(`${file}: its PTS ${totals.PTS}, its scoring's parts ${parts} and its score table's ${table} all differ`);
    if (agreed !== totals.PTS) season.corrected.push(`${club}: PTS ${totals.PTS}, its parts and score table ${agreed}`);
    season.games += page.games.length - unfinished.length;
    season.points += table;
    season.agreed += agreed;
    for (const key of COUNTS) season[key] += totals[key] ?? 0;
    season.ties += tiesOf(html);
  }
  season.ties /= 2;
  season.pages = pages;
  return season;
}

/**
 * nflverse's regular seasons from its games file: `{ [year]: { games, points, overtime } }`, `games` its team-games and
 * `overtime` its games that went to overtime; played games only. Its first fifteen columns hold no quoted commas.
 */
export function nflverseSeasons(csv) {
  const [head, ...rows] = csv.trim().split(/\r?\n/);
  const col = Object.fromEntries(head.split(',').map((name, i) => [name, i]));
  const out = {};
  for (const line of rows) {
    const cells = line.split(',');
    if (cells[col.game_type] !== 'REG' || cells[col.home_score] === 'NA' || cells[col.home_score] === '') continue;
    const year = Number(cells[col.season]);
    const season = (out[year] ??= { games: 0, points: 0, overtime: 0 });
    season.games += 2;
    season.points += Number(cells[col.home_score]) + Number(cells[col.away_score]);
    if (cells[col.overtime] === '1') season.overtime++;
  }
  return out;
}

// ---------- the table ----------

/** Each built-in season's average matchup, as the match model rates its clubs (see `matchupsOf`). */
async function seasonMatchups() {
  const { buildClub, selectLineup } = await import('../src/data/teams.js');
  const { americanFootball, americanFootballProfile } = await import('../src/sports/americanFootball.js');
  const { BUILT_IN_AMERICAN_FOOTBALL_SEASONS } = await import('../src/data/americanFootballSeasons.js');
  const { CLUBS } = await import('../src/data/clubs.american-football.js');
  const average = clubs => {
    const profiles = clubs.map(club => americanFootballProfile(selectLineup(buildClub(club, americanFootball))));
    const mean = key => profiles.reduce((sum, p) => sum + p[key], 0) / profiles.length;
    return { edge: Math.round((mean('offence') - mean('defence')) * 1000) / 1000, kicking: Math.round(mean('kicking') * 1000) / 1000 };
  };
  const out = { 'built-in': average(CLUBS) };
  for (const season of BUILT_IN_AMERICAN_FOOTBALL_SEASONS) {
    const set = JSON.parse(await readFile(path.join(root, 'public/american-football', `${season.id}.json`), 'utf8'));
    out[season.id] = average(set.clubs);
  }
  return out;
}

/** The pinned pages of the computed seasons (scripts/data/pfa-pages.json), and the day each season's were saved. */
async function computedPins() {
  const { files, retrieved } = JSON.parse(await readFile(path.join(root, 'scripts/data/pfa-pages.json'), 'utf8'));
  return { files, retrieved };
}

/** The day each of our own pages was saved, from the fetch log's answers: `{ [sha]: day }`. */
async function ownDays() {
  const log = path.join(OWN, 'fetch-log.tsv');
  const days = {};
  if (!existsSync(log)) return days;
  for (const line of (await readFile(log, 'utf8')).split('\n').filter(Boolean)) {
    const [time, status, , sha] = line.split('\t');
    if (status === '200' && !(days[sha] <= time.slice(0, 10))) days[sha] = time.slice(0, 10);
  }
  return days;
}

/**
 * Every league season read from its pages (each page the pinned one, where the computed seasons pin it), nflverse's
 * points beside the NFL's from 1999, and the built-in seasons' matchups → the table scripts/data/nfl-scoring.json holds.
 */
async function buildTable() {
  const pins = await computedPins();
  const days = await ownDays();
  const verseBytes = await readFile(nflverseCopy);
  const verse = nflverseSeasons(verseBytes.toString('utf8'));
  const seasons = {}, own = {}, retrieved = {};
  const dayOf = new Map();
  for (const [day, years] of Object.entries(pins.retrieved)) for (const year of years) if (!dayOf.has(year)) dayOf.set(year, day);
  for (const [league, years] of Object.entries(SEASONS)) {
    for (const year of years) {
      const read = async file => {
        const at = copyOf(file);
        if (!at) throw new Error(`data-src/ lacks ${file}: npm run build:nfl-scoring -- --fetch`);
        const bytes = await readFile(at);
        if (pins.files[file] && sha256(bytes) !== pins.files[file]) throw new Error(`${file} is not the page scripts/data/pfa-pages.json pins`);
        return bytes;
      };
      const s = await leagueSeason(league, year, read);
      const pinned = Object.keys(s.pages).every(file => pins.files[file]);
      for (const [file, sha] of Object.entries(s.pages)) if (!pins.files[file]) own[file] = sha;
      const day = pinned ? dayOf.get(year) : [...new Set(Object.entries(s.pages).filter(([file]) => !pins.files[file]).map(([, sha] ) => days[sha]))].sort().at(-1);
      if (!day) throw new Error(`No day of retrieval for the ${league.toUpperCase()}'s ${year} pages`);
      (retrieved[day] ??= []).push(`${s.league} ${year}`);
      // Each club's points as two of its three figures agree (leagueSeason `agreed`; `corrected` the clubs whose PTS
      // they overrule). Where the site's score tables sum to other points (`scoreTables`: 10 over in 2005), or the
      // scoring tables' touchdowns, tries, field goals, safeties and the defence's tries (`defensiveTwo`) do
      // (`scoredParts`), both are kept.
      const parts = partsOf(s);
      seasons[`${s.league} ${year}`] = { clubs: s.clubs, games: s.games, points: s.agreed, td: s.TD, xpm: s.X1, xpa: s.X1A, twoMade: s.X2, twoAtt: s.X2A,
        fgm: s.FG, fga: s.FGA, safeties: s.SAF, ...(s.DX ? { defensiveTwo: s.DX } : {}), ties: s.ties,
        ...(s.points !== s.agreed ? { scoreTables: s.points } : {}), ...(parts !== s.agreed ? { scoredParts: parts } : {}),
        ...(s.corrected.length ? { corrected: s.corrected } : {}),
        ...(league === 'nfl' && verse[year] ? { nflverse: { games: verse[year].games, points: verse[year].points, overtime: verse[year].overtime } } : {}) };
    }
  }
  return {
    note: 'The NFL\'s and the AFL\'s regular-season scoring, league season by league season (npm run build:nfl-scoring): each '
      + 'club\'s SCORING table (Team Totals: touchdowns TD, extra points X1 of X1A tried, two-point tries X2 of X2A, the '
      + 'defence\'s two-point returns DX, field goals FG of FGA, safeties SAF, points PTS) and its score table (the games, and '
      + 'those tied), summed over the league\'s clubs, from Pro Football Archives\' team-season pages. `games` counts '
      + 'team-games; `points` each club\'s as two of its PTS, its scoring\'s parts and its score table agree (`corrected`: the '
      + 'clubs whose PTS the other two overrule). Facts only. '
      + '`nflverse`: the same season\'s regular-season games in nflverse\'s games file, a second source for the points. '
      + '`matchups`: each built-in season\'s clubs\' mean offence less mean defence, and mean kicker, as the match model rates '
      + 'their lineups (src/sports/americanFootball.js). (c) 2006-2026 Pro Football Archives; the site states no terms of use '
      + 'and has no robots.txt (HTTP 404).',
    source: {
      site: SITE,
      computedPages: 'scripts/data/pfa-pages.json',
      retrieved: Object.fromEntries(Object.entries(retrieved).sort()),
      nflverse: { url: nflverseUrl, repo: NFLVERSE.repo, commit: NFLVERSE.commit, file: NFLVERSE.file, sha256: sha256(verseBytes),
        retrieved: days[sha256(verseBytes)] ?? null, first: NFLVERSE.first },
    },
    seasons,
    matchups: await seasonMatchups(),
    pages: Object.fromEntries(Object.entries(own).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}

/** The table as committed: one season, matchup and page a line. */
function tableText(table) {
  const lines = entries => Object.entries(entries).map(([key, value]) => `\n    ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',');
  return `{\n  "note": ${JSON.stringify(table.note)},\n  "source": ${JSON.stringify(table.source, null, 2).replace(/\n/g, '\n  ')},\n`
    + `  "seasons": {${lines(table.seasons)}\n  },\n  "matchups": {${lines(table.matchups)}\n  },\n  "pages": {${lines(table.pages)}\n  }\n}\n`;
}

/** src/data/nflLeagueAverages.js from the table. */
export function moduleText(table) {
  const years = Object.keys(table.seasons).filter(key => key.startsWith('NFL ')).map(key => Number(key.slice(4)));
  const season = s => `{ games: ${s.games}, points: ${s.points}, td: ${s.td}, xpm: ${s.xpm}, xpa: ${s.xpa}, twoMade: ${s.twoMade}, `
    + `twoAtt: ${s.twoAtt}, fgm: ${s.fgm}, fga: ${s.fga}, safeties: ${s.safeties} }`;
  const league = name => Object.entries(table.seasons).filter(([key]) => key.startsWith(`${name} `))
    .map(([key, s]) => `    ${key.slice(4)}: Object.freeze(${season(s)}),`).join('\n');
  const matchups = Object.entries(table.matchups).map(([id, m]) => `  '${id}': Object.freeze({ edge: ${m.edge}, kicking: ${m.kicking} }),`).join('\n');
  return `// GENERATED by npm run build:nfl-scoring from scripts/data/nfl-scoring.json; do not edit.
// The NFL's and the AFL's regular seasons, league season by league season: team-games played, and the points,
// touchdowns, extra points made and tried (xpm, xpa), two-point tries made and tried (twoMade, twoAtt; none in the NFL
// before 1994), field goals made and tried (fgm, fga) and safeties scored in them, summed over the league's clubs from
// Pro Football Archives' team-season pages (https://www.profootballarchives.com/<year>nfl.html and each club's page,
// their SCORING tables' Team Totals): 1960 to 1989, 1991 and 1996 to 2005 and the AFL's ten seasons as the computed
// seasons' pages were saved on 2026-11-09 and 2026-11-10 (scripts/data/pfa-pages.json), the rest (to 2024, the site's
// last) as saved on 2026-11-10 and 2026-11-13. Each club's points are the figure two of its three agree on (its PTS, its
// scoring's parts, its score table). From 1999 the points agree with nflverse's games (github.com/nflverse/nfldata,
// data/games.csv at commit ${NFLVERSE.commit.slice(0, 7)}). Each earlier season plays at its own, a later one at the
// latest's (src/sports/americanFootball.js).
export const NFL_LEAGUE_AVERAGES = Object.freeze({
  NFL: Object.freeze({
${league('NFL')}
  }),
  AFL: Object.freeze({
${league('AFL')}
  }),
});

/** The latest finished NFL season in the table. */
export const LATEST_NFL_SEASON = ${Math.max(...years)};

// Each built-in season's average matchup, as the match model rates its clubs' lineups: their mean offence less their
// mean defence (\`edge\`), and their mean kicker (\`kicking\`); 'built-in' is the built-in season's (Madden NFL 27). A
// season's drive odds are stated at its own average matchup, so an edition (or a computed overall) that rates offences
// and defences differently against each other still plays its league's scoring.
export const NFL_SEASON_MATCHUPS = Object.freeze({
${matchups}
});
`;
}

async function main() {
  const argv = process.argv.slice(2);
  const unknown = argv.filter(arg => !['--fetch', '--check', '--report'].includes(arg));
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  if (argv.includes('--fetch')) return fetchMissing();
  if (argv.includes('--report')) {
    const table = JSON.parse(await readFile(TABLE, 'utf8'));
    for (const [key, s] of Object.entries(table.seasons)) {
      const g = s.games, f = (x, d = 2) => x.toFixed(d);
      const v = s.nflverse ? ` nflverse ${f(s.nflverse.points / s.nflverse.games)} (${s.nflverse.overtime} OT)` : '';
      console.log(`${key} clubs ${s.clubs} pts ${f(s.points / g)} TD ${f(s.td / g)} FGA ${f(s.fga / g)} FG% ${f(100 * s.fgm / s.fga, 1)}`
        + ` XP% ${f(100 * s.xpm / s.xpa, 1)} 2PA/TD ${f(100 * s.twoAtt / s.td, 1)}% 2P% ${s.twoAtt ? f(100 * s.twoMade / s.twoAtt, 1) : '-'}`
        + ` SAF ${f(s.safeties / g, 3)} ties ${s.ties}${v}`);
    }
    return;
  }
  const check = argv.includes('--check');
  let table;
  const complete = Object.entries(SEASONS).every(([league, years]) => years.every(year => copyOf(`${year}/${year}${league}.html`)))
    && existsSync(nflverseCopy);
  if (complete) {
    table = await buildTable();
    for (const [key, s] of Object.entries(table.seasons)) {
      if (!s.nflverse) continue;
      if (s.nflverse.games !== s.games || Math.abs(s.nflverse.points - s.points) > NFLVERSE_SLACK) {
        throw new Error(`${key}: Pro Football Archives ${s.points} points in ${s.games} team-games, nflverse ${s.nflverse.points} in ${s.nflverse.games}`);
      }
    }
  } else if (check) {
    // Without the pages, the committed table's seasons stand; its matchups are still the season files' own.
    table = JSON.parse(await readFile(TABLE, 'utf8'));
    if (JSON.stringify(await seasonMatchups()) !== JSON.stringify(table.matchups)) {
      throw new Error(`${path.relative(root, TABLE)}'s matchups differ from the seasons' clubs: npm run build:nfl-scoring where data-src/ has the pages`);
    }
    console.log('data-src/ lacks some pages: the matchups are checked against the seasons, the module against the committed table');
  } else throw new Error('data-src/ lacks some pages: npm run build:nfl-scoring -- --fetch');
  const outputs = [...(complete ? [[TABLE, tableText(table)]] : []), [MODULE, moduleText(table)]];
  if (check) {
    for (const [file, text] of outputs) {
      if ((existsSync(file) ? await readFile(file, 'utf8') : null) !== text) throw new Error(`${path.relative(root, file)} differs from its rebuild`);
    }
    console.log(`Verified ${outputs.map(([file]) => path.relative(root, file)).join(' and ')} byte for byte`);
    return;
  }
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${Object.keys(table.seasons).length} league seasons to ${outputs.map(([file]) => path.relative(root, file)).join(' and ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`build-nfl-scoring: ${error.message}`);
    process.exitCode = 1;
  });
}
