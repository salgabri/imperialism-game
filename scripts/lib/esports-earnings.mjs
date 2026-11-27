// esportsearnings.com's players of one game by country, read for the countries gol.gg lacks (docs/design/league-of-legends.md,
// "Earlier seasons"): its list of the game's countries, and each country's players, a hundred a page. Its robots.txt shuts no
// agent out; every page is fetched through politeFetch, one at a time and PAUSE_MS apart, and kept gzipped in
// data-src/esportsearnings/ (git-ignored).
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import { politeFetch } from './polite-fetch.mjs';
import { plain } from './golgg.mjs';

export const SITE = 'https://www.esportsearnings.com';
/** League of Legends there. */
export const GAME = '164-league-of-legends';
export const PAUSE_MS = 10000;
const PAGE = 100;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let lastRequest = 0;
/** A page's text from the cache, else fetched when `fetching` allows it, else null. */
export async function earningsPage(url, file, { fetching = false, pause = PAUSE_MS } = {}) {
  if (await stat(file).then(() => true, () => false)) return gunzipSync(await readFile(file)).toString('utf8');
  if (!fetching) return null;
  const wait = lastRequest + pause - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  const response = await politeFetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const text = await response.text();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, gzipSync(text));
  return text;
}

/** The list of a game's countries: [{ country (a two-letter code), players }]. */
export function readCountries(html) {
  const countries = new Map();
  for (const [, country, , players] of String(html).matchAll(/countries\/([a-z]{2})"[^>]*>([^<]*)<\/a>[\s\S]{0,600}?([\d,]+) Players/g)) {
    if (!countries.has(country)) countries.set(country, Number(players.replace(/,/g, '')));
  }
  return [...countries].map(([country, players]) => ({ country, players }));
}

/** A country's players: [{ id, slug, handle, name, country }], `country` the flag beside each. */
export function readCountryPlayers(html) {
  const players = [];
  for (const [, row] of String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const country = /href="\/countries\/([a-z]{2})"/.exec(row)?.[1];
    const links = [...row.matchAll(/<a href="\/players\/(\d+)-([^"]*)">([^<]*)<\/a>/g)];
    if (!country || links.length < 2) continue;
    players.push({ id: Number(links[0][1]), slug: links[0][2], handle: plain(links[0][3]), name: plain(links[1][3]), country });
  }
  return players;
}

/** Every player of the game esportsearnings.com lists, as the cache holds them (or fetched when `fetching`). */
export async function earningsPlayers(cacheDir, { fetching = false, pause } = {}) {
  const base = `${SITE}/games/${GAME}/countries`;
  const index = await earningsPage(base, path.join(cacheDir, 'countries.html.gz'), { fetching, pause });
  if (!index) return [];
  const players = [];
  for (const { country, players: count } of readCountries(index)) {
    for (let from = 0; from < count; from += PAGE) {
      const name = from ? `${country}-x${from}` : country;
      const html = await earningsPage(`${base}/${name}`, path.join(cacheDir, `${name}.html.gz`), { fetching, pause });
      if (html) players.push(...readCountryPlayers(html));
    }
  }
  return players;
}
