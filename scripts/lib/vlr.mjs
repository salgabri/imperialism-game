// vlr.gg, Valorant's results site, read for the ratings (docs/design/valorant.md): its events listing, each event's matches
// and each match's page, which holds every map's score, its rounds one by one, and both sides' five players with their
// country flags. vlr.gg's robots.txt disallows only its search box and /rr/, for every agent; every page here is fetched
// through politeFetch (scripts/lib/polite-fetch.mjs), one at a time and PAUSE_MS apart, and kept gzipped in data-src/vlr/
// (git-ignored), so a page is fetched once and every later run reads the cache.
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import { politeFetch } from './polite-fetch.mjs';

export const SITE = 'https://www.vlr.gg';
/** The listing's tiers read: VCT (60: the international leagues, Masters, Champions, and 2021–2022's Challengers stages),
 * Challengers (61: every region's second tier since 2023) and off-season events (67: invitationals between seasons). Game
 * Changers (63), collegiate (64) and the third tier (62) are left out. */
export const TIERS = Object.freeze([60, 61, 67]);
const PAUSE_MS = 1000;
/** The first event read: VCT 2023's LOCK//IN São Paulo, which opened the franchised leagues' era. */
export const FIRST_EVENT = 1188;
/** The most completed matches a qualifier may have and still count: more is an open bracket of amateur teams. */
export const OPEN_BRACKET = 300;

/**
 * Whether an event's matches are read: one of FIRST_EVENT or later that is no open qualifier (its title says so, or a
 * qualifier with more than OPEN_BRACKET completed matches: the VCT 2027 Kickoff's European qualifier has 685).
 */
export const countsEvent = (event, completed) => event.id >= FIRST_EVENT && !/open qualifier/i.test(event.title)
  && !(/qualifier/i.test(event.title) && completed > OPEN_BRACKET);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let lastRequest = 0;

/**
 * A vlr.gg page's HTML: from the cache (`file`, gzipped) if it is there, else fetched (PAUSE_MS after the previous request,
 * retried on a server error or a rate limit) and cached. `refresh` fetches it again even when cached. A 404 is cached
 * as an empty page.
 */
export async function vlrPage(url, file, { refresh = false, pause = PAUSE_MS } = {}) {
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
      response = await politeFetch(url, { signal: AbortSignal.timeout(60000) });
    } catch (error) {
      if (error.fatal || attempt >= 5) throw error;
      await sleep(pause * 2 ** (attempt + 2));
      continue;
    }
    if (response.status === 404) {
      await response.body?.cancel().catch(() => {});
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, gzipSync(''));
      return '';
    }
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel().catch(() => {});
      if (attempt >= 6) throw new Error(`HTTP ${response.status} for ${url}`);
      await sleep(pause * 2 ** (attempt + 3));
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    // The site now and then closes the connection mid-page: read the body again on the next try.
    let html;
    try {
      html = await response.text();
    } catch (error) {
      if (attempt >= 5) throw error;
      await sleep(pause * 2 ** (attempt + 2));
      continue;
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, gzipSync(html));
    return html;
  }
}

/** Whether a cache file is there. */
export const cached = file => stat(file).then(() => true, () => false);

// ---------- reading the pages ----------

/** HTML text as plain text: tags dropped, entities decoded, runs of space as one. */
export function plain(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/&#(\d+);/g, (match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, ' ').trim();
}

/**
 * The events of one listing page (`/events/?tier=…&page=…`): [{ id, slug, title, status, dates, prize, flag }], and the
 * last page number the listing links to.
 */
export function readEventList(html) {
  const events = [];
  const item = /<a class="wf-card mod-flex event-item" href="\/event\/(\d+)\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const [, id, slug, body] of String(html).matchAll(item)) {
    const title = plain(/<div class="event-item-title">([\s\S]*?)<\/div>/.exec(body)?.[1]);
    const status = /event-item-desc-item-status mod-(\w+)/.exec(body)?.[1] ?? null;
    const dates = plain(/mod-dates">([\s\S]*?)<div class="event-item-desc-item-label/.exec(body)?.[1]);
    const prize = plain(/mod-prize">([\s\S]*?)<div class="event-item-desc-item-label/.exec(body)?.[1]);
    const flag = /mod-location">\s*<i class="flag mod-([a-z0-9]+)"/.exec(body)?.[1] ?? null;
    events.push({ id: Number(id), slug, title, status, dates, prize, flag });
  }
  // The listing's own links write `&amp;page=`.
  const pages = [...String(html).matchAll(/[?&;]page=(\d+)/g)].map(match => Number(match[1]));
  return { events, lastPage: pages.length ? Math.max(...pages) : 1 };
}

/** An event's matches (`/event/matches/<id>/…/?series_id=all`): [{ id, slug, completed }], in the page's order. */
export function readEventMatches(html) {
  const matches = [];
  const seen = new Set();
  const item = /<a href="\/(\d+)\/([^"]+)" class="wf-module-item match-item[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  for (const [, id, slug, body] of String(html).matchAll(item)) {
    if (seen.has(id)) continue;
    seen.add(id);
    matches.push({ id: Number(id), slug, completed: /ml-status">\s*Completed/i.test(body) });
  }
  return matches;
}

const number = text => (/-?\d+/.test(String(text ?? '')) ? Number(/-?\d+/.exec(text)[0]) : null);

/** A map section's rounds, in order: [{ n, winner: 1 or 2, side: 'ct' or 't', how }] (`how`: elim, defuse, boom, time). */
function readRounds(chunk) {
  const rounds = [];
  const start = chunk.indexOf('<div class="vlr-rounds');
  if (start < 0) return rounds;
  const end = chunk.indexOf('<div class="ovw-', start);
  // Each column: its round's number, then the two teams' squares in order, the winner's marked and holding how it ended.
  for (const column of chunk.slice(start, end < 0 ? undefined : end).split('<div class="vlr-rounds-row-col').slice(1)) {
    const n = /<div class="rnd-num">\s*(\d+)/.exec(column)?.[1];
    if (!n) continue;
    const squares = [...column.matchAll(/<div class="rnd-sq([^"]*)">/g)];
    const won = squares.findIndex(([, classes]) => /mod-win/.test(classes));
    if (won < 0 || won > 1) continue;
    const classes = squares[won][1];
    const after = column.slice(squares[won].index, squares[won + 1]?.index);
    rounds.push({ n: Number(n), winner: won + 1, side: /mod-ct/.test(classes) ? 'ct' : /mod-t\b/.test(classes) ? 't' : null,
      how: /round\/(\w+)\.webp/.exec(after)?.[1] ?? null });
  }
  return rounds;
}

/** A player table's rows: [{ id, slug, name, flag, country }]. */
function readPlayers(table) {
  const players = [];
  const row = /<div class="ovw-player">([\s\S]*?)<\/a>/g;
  for (const [, body] of table.matchAll(row)) {
    const link = /<a href="\/player\/(\d+)\/([^"]*)"/.exec(body);
    if (!link) continue;
    const flag = /<i class="flag mod-([a-z0-9]+)"(?: title="([^"]*)")?/.exec(body);
    players.push({ id: Number(link[1]), slug: link[2], name: plain(/ovw-player-name[^>]*>([\s\S]*?)<\/div>/.exec(body)?.[1]),
      flag: flag?.[1] ?? null, country: flag?.[2] ? plain(flag[2]) : null });
  }
  return players;
}

/**
 * A match page: { date, patch, event: { id, name, series }, teams: [{ id, name }, { id, name }], score: [a, b], bestOf,
 * maps: [{ id, name, pick, score: [a, b], halves: [[first, second], …], duration, rounds, players: [[…], […]] }] }. The
 * first team is the header's left one throughout. `pick`: 1 or 2 for the team that picked the map, null for a decider.
 * A map played without its rounds or its players on the page keeps what it has.
 */
export function readMatch(html) {
  const text = String(html);
  const date = /<div class="match-header-date">[\s\S]*?data-utc-ts="([^"]+)"/.exec(text)?.[1] ?? null;
  const patch = /Patch\s+([\d.]+)/.exec(text)?.[1] ?? null;
  const eventId = number(/<a href="\/event\/(\d+)[^"]*" class="match-header-event"/.exec(text)?.[1]);
  const eventName = plain(/class="match-header-event"[\s\S]*?<div style="font-weight: 700;">([\s\S]*?)<\/div>/.exec(text)?.[1]);
  const series = plain(/<div class="match-header-event-series">([\s\S]*?)<\/div>/.exec(text)?.[1]);
  const teams = [1, 2].map(side => {
    const block = new RegExp(`<a class="match-header-link[^"]*mod-${side}"\\s*href="/team/(\\d+)/[^"]*"[\\s\\S]*?<div class="wf-title-med[^"]*">([\\s\\S]*?)</div>`).exec(text);
    return { id: block ? Number(block[1]) : null, name: block ? plain(block[2]) : null };
  });
  const scoreBlock = /<div class="match-header-vs-score">\s*<div class="match-header-vs-note">[\s\S]*?<div class="sp-hide">([\s\S]*?)<\/div>/.exec(text)?.[1] ?? '';
  const numbers = [...scoreBlock.matchAll(/<span class="match-header-vs-score-(?:winner|loser)">\s*(\d+)/g)].map(match => Number(match[1]));
  const bestOf = number(/<div class="match-header-vs-note">\s*Bo(\d)/.exec(text)?.[1]);
  const maps = [];
  const chunks = text.split(/<div class="vm-stats-game\s/).slice(1);
  for (const chunk of chunks) {
    const id = /^[^>]*data-game-id="([^"]+)"/.exec(chunk)?.[1];
    if (!id || id === 'all') continue;
    const headerEnd = [chunk.indexOf('<div class="vlr-rounds'), chunk.indexOf('<div class="ovw-table')].filter(at => at >= 0);
    const header = chunk.slice(0, headerEnd.length ? Math.min(...headerEnd) : 4000);
    const scores = [...header.matchAll(/<div class="score[^"]*"[^>]*>\s*(\d+)/g)].map(match => Number(match[1]));
    if (scores.length < 2) continue;
    const mapName = plain(/<div class="map-name">([\s\S]*?)<(?:span class="picked|\/span)/.exec(header)?.[1]);
    const pick = number(/class="picked mod-(\d)/.exec(header)?.[1]);
    const duration = plain(/<div class="map-duration[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(header)?.[1]) || null;
    // Each team's rounds by half as the header lists them: the side it began on, then the other, then overtime's.
    const teamBlocks = header.split(/<div class="map">/);
    const halves = [teamBlocks[0], teamBlocks[1] ?? ''].map(block => [...block.matchAll(/<span class="mod-(t|ct|ot)">\s*(\d+)\s*<\/span>/g)]
      .map(([, side, n]) => [side, Number(n)]));
    const tables = chunk.split(/<div class="ovw-table">/).slice(1);
    maps.push({ id: Number(id), name: mapName, pick: pick ?? null, score: [scores[0], scores[1]], halves, duration,
      rounds: readRounds(chunk), players: [readPlayers(tables[0] ?? ''), readPlayers(tables[1] ?? '')] });
  }
  return { date, patch, event: { id: eventId, name: eventName, series }, teams, score: numbers.length === 2 ? numbers : null,
    bestOf, maps };
}
