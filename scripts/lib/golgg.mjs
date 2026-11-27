// gol.gg (Game of Legends), League of Legends' results site, read for the ratings (docs/design/league-of-legends.md): each
// season's tournaments (its own listing's JSON), each tournament's match list, and each series' page, which holds the
// series' games (who won each, how long it took) and both sides' players. gol.gg's robots.txt disallows its rankings,
// summoner and admin pages for every agent, and nothing read here; every page is fetched through politeFetch
// (scripts/lib/polite-fetch.mjs), one at a time and PAUSE_MS apart, and kept gzipped in data-src/golgg/ (git-ignored).
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import { politeFetch } from './polite-fetch.mjs';

export const SITE = 'https://gol.gg';
// Between two requests: gol.gg dropped the connections of a fetch at one a second after 5,000 pages (2026-11-15).
export const PAUSE_MS = 10000;
/** gol.gg's season codes: S14 is 2024, S16 2026. */
export const seasonCode = year => `S${year - 2010}`;
export const yearOfSeason = code => Number(String(code).replace(/^S/, '')) + 2010;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let lastRequest = 0;

/**
 * A gol.gg page's text: from the cache (`file`, gzipped) if it is there, else fetched (PAUSE_MS after the previous
 * request, retried on a server error or a rate limit) and cached. `init` is fetch's (the tournament listing is a POST).
 */
export async function golPage(url, file, { refresh = false, pause = PAUSE_MS, init = {} } = {}) {
  if (!refresh) {
    const cached = await readFile(file).catch(() => null);
    if (cached) return gunzipSync(cached).toString('utf8');
  }
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequest + pause - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    let response;
    try {
      response = await politeFetch(url, { ...init, signal: AbortSignal.timeout(60000) });
    } catch (error) {
      if (error.fatal || attempt >= 5) throw error;
      await sleep(pause * 2 ** (attempt + 2));
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel().catch(() => {});
      if (attempt >= 6) throw new Error(`HTTP ${response.status} for ${url}`);
      await sleep(pause * 2 ** (attempt + 3));
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    // A connection closed mid-page: read the body again on the next try.
    let text;
    try {
      text = await response.text();
    } catch (error) {
      if (attempt >= 5) throw error;
      await sleep(pause * 2 ** (attempt + 2));
      continue;
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, gzipSync(text));
    return text;
  }
}

/** Whether a cache file is there. */
export const cached = file => stat(file).then(() => true, () => false);

/** A season's tournaments, as the listing's JSON gives them: [{ trname, region, nbgames, avgtime, firstgame, lastgame }]. */
export async function seasonTournaments(year, cacheDir, { fetching = false, refresh = false, pause } = {}) {
  const file = path.join(cacheDir, 'tournaments', `${seasonCode(year)}.json.gz`);
  if (!fetching && !(await cached(file))) return null;
  const text = await golPage(`${SITE}/tournament/ajax.trlist.php`, file, { refresh: fetching && refresh, pause,
    init: { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `season=${seasonCode(year)}` } });
  return JSON.parse(text);
}

/** A tournament's name as gol.gg's paths spell it. */
export const tournamentPath = name => encodeURIComponent(name);
/** A tournament's match list and its players list, a season's teams list and its players list. */
export const matchListUrl = name => `${SITE}/tournament/tournament-matchlist/${tournamentPath(name)}/`;
export const playersListUrl = name => `${SITE}/players/list/season-ALL/split-ALL/tournament-${tournamentPath(name)}/`;
export const teamsListUrl = year => `${SITE}/teams/list/season-${seasonCode(year)}/split-ALL/tournament-ALL/`;
export const seasonPlayersUrl = year => `${SITE}/players/list/season-${seasonCode(year)}/split-ALL/tournament-ALL/`;

// ---------- reading the pages ----------

/** HTML text as plain text: tags dropped, entities decoded, runs of space as one. */
export function plain(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (match, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ').trim();
}

/**
 * A tournament's series (`/tournament/tournament-matchlist/<name>/`), as its list gives them: [{ id, page: 'summary' or
 * 'game', title, left, right, leftWon, score: [left, right], stage, patch, date }]: `left` and `right` the two teams as
 * the row names them, `score` their games won, `leftWon` null in a series of two games won one each. `unlinked`: also the
 * series played of which gol.gg keeps no page, only the score (`id` and `page` null).
 */
export function readMatchList(html, { unlinked = false } = {}) {
  const series = [];
  const row = /<tr><td class='text-left'>(?:<a href='\.\.\/game\/stats\/(\d+)\/page-(summary|game)\/' title='([^']*)'>[^<]*<\/a>|([^<]*))<\/td><td class='text-right(?: (text_victory|text_defeat))?'>([^<]*)<\/td><td class='text-center'>(\d+) - (\d+)<\/td><td(?: class='(?:text_victory|text_defeat)')?>([^<]*)<\/td><td class='text-center'>([^<]*)<\/td><td class='text-center'>([^<]*)<\/td><td class='text-center'>([^<]*)<\/td><\/tr>/g;
  for (const [, id, page, title, label, side, left, a, b, right, stage, patch, date] of String(html).matchAll(row)) {
    if (!id && !unlinked) continue;
    series.push({ id: id ? Number(id) : null, page: page ?? null, title: plain(title ?? label), left: plain(left), right: plain(right),
      leftWon: side ? side === 'text_victory' : null, score: [Number(a), Number(b)], stage: plain(stage), patch: plain(patch), date: plain(date) });
  }
  return series;
}

/**
 * A statistics table's rows, each `{ id, title, cells }`: `cells` by its column's heading ("Games", "GPM", "Gold%"…), and the
 * id and title of the row's own link (`link` 'player-stats' or 'team-stats').
 */
function readStatsTable(html, link) {
  const table = String(html).split('<table').slice(1).map(part => part.slice(0, part.indexOf('</table>')))
    .find(part => part.includes(`./${link}/`) && /<th[\s>]/.test(part) && />\s*Games\s*</.test(part));
  if (!table) return [];
  const columns = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(([, text]) => plain(text));
  const rows = [];
  for (const [, row] of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const [, id, title] = new RegExp(`href='\\./${link}/(\\d+)/[^']*'[^>]*title='([^']*?) stats'`).exec(row) ?? [];
    if (!id) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, text]) => plain(text));
    rows.push({ id: Number(id), title: plain(title), cells: Object.fromEntries(columns.map((column, i) => [column, cells[i] ?? ''])) });
  }
  return rows;
}

/** A tag gol.gg stored as UTF-8 read as Latin-1, as it was ("FÃ©nec" → "Fénec"); any other tag as it is. */
export function mended(name) {
  if (!/[Â-Å][\u0080-¿]/.test(name) || /[^\u0000-ÿ]/.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

/** "57.3%" → 0.573, "1,696" → 1696, "-" or nothing → null. */
const statNumber = text => {
  const match = /^(-?[\d,]*\.?\d+)(%?)$/.exec(String(text ?? '').trim());
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  return match[2] ? Number((value / 100).toFixed(4)) : value;
};

/**
 * A players list (`/players/list/season-…/split-…/tournament-…/`): each player's games and figures over them, [{ id, name,
 * country (a two-letter code, or null), games, wins, kills, deaths, assists (a game), csm, gpm, dpm, vspm (a minute), kp, dmg,
 * gold, vs (his share of his team's kills, damage, gold and vision score), soloKills, firstBlood }]; a figure gol.gg leaves
 * blank is null.
 */
export function readPlayersTable(html) {
  return readStatsTable(html, 'player-stats').map(({ id, title, cells }) => {
    const number = column => statNumber(cells[column]);
    const share = column => number(column) || null;
    const games = number('Games') ?? 0;
    return { id, name: mended(title), country: /^[A-Z]{2}$/.test(cells.Country) ? cells.Country : null, games,
      wins: Math.round(games * (number('Win rate') ?? 0)), kills: number('Avg kills'), deaths: number('Avg deaths'),
      assists: number('Avg assists'), csm: share('CSM'), gpm: share('GPM'), dpm: share('DPM'), vspm: share('VSPM'), kp: share('KP%'),
      dmg: share('DMG%'), gold: share('Gold%'), vs: share('VS%'), soloKills: number('Solo Kills'), firstBlood: number('FB %') };
  });
}

/**
 * A teams list (`/teams/list/season-…/split-…/tournament-…/`): [{ id, name, region, games, wins, gpm, kills, deaths, nashors
 * (a game), minutes }].
 */
export function readTeamsTable(html) {
  return readStatsTable(html, 'team-stats').map(({ id, title, cells }) => {
    const number = column => statNumber(cells[column]);
    const games = number('Games') ?? 0;
    const length = /^(\d+):(\d\d)$/.exec(cells['Game duration'] ?? '');
    return { id, name: title, region: cells.Region || null, games, wins: Math.round(games * (number('Win rate') ?? 0)), gpm: number('GPM'),
      dpm: number('DPM'), kills: number('Kills / game'), deaths: number('Deaths / game'), nashors: number('NASHPG'),
      minutes: length ? Number(length[1]) + Number(length[2]) / 60 : null };
  });
}

/** "36:10" → 2170 seconds; null for anything else. */
const seconds = text => {
  const match = /^(\d+):(\d\d)$/.exec(String(text ?? '').trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** The players a table lists, in order: [{ id, name }], read from their player-stats links. */
function playersIn(html) {
  const players = [];
  // A link's title may come before its href or after it.
  for (const [tag] of String(html).matchAll(/<a [^>]*players\/player-stats\/\d+\/[^>]*>/g)) {
    const id = Number(/player-stats\/(\d+)\//.exec(tag)[1]);
    const name = /title='([^']*?) stats'/.exec(tag)?.[1];
    if (name != null && !players.some(player => player.id === id)) players.push({ id, name: plain(name) });
  }
  return players;
}

/** A team link's `{ id, name }` from a page's team-stats link. */
const teamOf = match => (match ? { id: Number(match[1]), name: plain(match[2]) } : { id: null, name: null });
const TEAM_LINK = /href='\.\.\/teams\/team-stats\/(\d+)\/[^']*' title='([^']*?) stats'>/;

/**
 * A single game's page (`/game/stats/<id>/page-game/`): { teams: [blue, red], games: [{ winner, duration, stats: [{ kills,
 * towers, dragons, barons, gold }, …] }], players: [[…], […]], bestOf: 1 }, the blue side first.
 */
export function readGamePage(html) {
  const text = String(html);
  const blueAt = text.indexOf('blue-line-header'), redAt = text.indexOf('red-line-header', blueAt);
  if (blueAt < 0 || redAt < 0) return null;
  const blueHead = text.slice(blueAt, text.indexOf('</div>', blueAt));
  const redHead = text.slice(redAt, text.indexOf('</div>', redAt));
  const teams = [teamOf(TEAM_LINK.exec(blueHead)), teamOf(TEAM_LINK.exec(redHead))];
  const won = [/-\s*WIN/.test(plain(blueHead)), /-\s*WIN/.test(plain(redHead))];
  if (won[0] === won[1]) return null;
  const duration = seconds(/Game Time[\s\S]*?<h1>([^<]*)<\/h1>/.exec(text)?.[1]);
  const boxes = side => [...text.matchAll(new RegExp(`<span class="score-box ${side}_line">([\\s\\S]*?)</span>`, 'g'))]
    .map(([, body]) => plain(body.replace(/<[^>]*>/g, ' ')));
  const statsOf = values => {
    const [kills, towers, dragons, barons, gold] = values;
    const number = value => (/^\d+(?:\.\d+)?k?$/.test(value ?? '') ? (value.endsWith('k') ? Math.round(parseFloat(value) * 1000) : Number(value)) : null);
    return { kills: number(kills), towers: number(towers), dragons: number(dragons), barons: number(barons), gold: number(gold) };
  };
  // The players' tables follow the two headers, the blue side's then the red side's (each row nests tables of its own, so
  // the red one ends where the page's next list begins).
  const blueTable = text.indexOf("<table class='playersInfosLine", redAt);
  const redTable = blueTable < 0 ? -1 : text.indexOf("<table class='playersInfosLine", blueTable + 1);
  const end = redTable < 0 ? -1 : text.indexOf('<table class="table_list"', redTable);
  const players = blueTable < 0 || redTable < 0 ? [[], []]
    : [playersIn(text.slice(blueTable, redTable)), playersIn(text.slice(redTable, end < 0 ? redTable + 20000 : end))];
  return { teams, bestOf: 1, games: [{ winner: won[0] ? 1 : 2, duration, stats: [statsOf(boxes('blue')), statsOf(boxes('red'))] }],
    players };
}

/**
 * A series' summary page (`/game/stats/<id>/page-summary/`): { teams: [left, right], bestOf, games: [{ winner, duration }],
 * players: [[…], […]] }: each game's winner (1 the left team) and length in order, and each side's players over the series
 * (a sixth when a substitute played a game).
 */
export function readSummaryPage(html) {
  const text = String(html);
  const bestOfAt = text.search(/<h1>BO\d<\/h1>/);
  if (bestOfAt < 0) return null;
  const bestOf = Number(/<h1>BO(\d)<\/h1>/.exec(text.slice(bestOfAt))[1]);
  const before = text.slice(Math.max(0, bestOfAt - 3000), bestOfAt);
  const after = text.slice(bestOfAt);
  const left = [...before.matchAll(new RegExp(TEAM_LINK.source, 'g'))].at(-1);
  const right = new RegExp(TEAM_LINK.source).exec(after);
  const teams = [teamOf(left), teamOf(right)];
  // Each game: the left team's result, the game's length, the right team's result.
  const games = [];
  const result = /<h1 class='text_(victory|defeat)'>(?:WIN|LOSS)<\/h1>[\s\S]*?<h1>(\d+:\d\d)<\/h1>[\s\S]*?<h1 class='text_(victory|defeat)'>(?:WIN|LOSS)<\/h1>/g;
  const tablesAt = after.indexOf("<table class='table_list trhover'>");
  for (const [, leftResult, length, rightResult] of after.slice(0, tablesAt < 0 ? undefined : tablesAt).matchAll(result)) {
    if (leftResult === rightResult) continue;
    games.push({ winner: leftResult === 'victory' ? 1 : 2, duration: seconds(length) });
  }
  const tables = tablesAt < 0 ? [] : after.slice(tablesAt).split("<table class='table_list trhover'>").slice(1, 3);
  const players = [playersIn(tables[0] ?? ''), playersIn(tables[1] ?? '')];
  return { teams, bestOf, games, players };
}

/**
 * Every player gol.gg knows, from the search box any of its pages carries: id → { name, country } (`country` its
 * two-letter code, or null).
 */
export function readPlayerList(html) {
  const players = new Map();
  for (const [, id, label] of String(html).matchAll(/\{class:'player',value: 'p_(\d+)',name: '((?:[^'\\]|\\.)*)'\}/g)) {
    const text = label.replace(/\\'/g, "'");
    const match = /^(.*) - ([A-Z]{2})$/.exec(text);
    players.set(Number(id), { name: match ? match[1] : text, country: match ? match[2] : null });
  }
  return players;
}
