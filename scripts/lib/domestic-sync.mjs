// EFEM.club (FM26) access for the domestic-club sync: polite cached HTTP, game
// nation -> FM nation mapping, club viability rules and the 16-player squad pick.
// Network results are cached under data-src/domestic/ so reruns are offline.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import { NATIONS } from '../../src/data/teams.js';
import { FM_ROLES, FM_ORIGIN, expandFmTuple, fmNaturalPositions } from '../../src/data/fmPlayers.js';

export const VERSION = '26.3.0';
export const USER_AGENT = 'imperialism-game-build/1.0 (offline data build)';
export const CLUBS_ENDPOINT = `${FM_ORIGIN}/api/clubs/filter`;
export const PLAYERS_ENDPOINT = `${FM_ORIGIN}/api/players/filter`;
export const CLUB_PAGE_SIZE = 100;
export const TIE_PAGE_SIZE = 2000;
export const SLICE_PAGE_SIZE = 5000;
export const SQUAD_SIZE = 16;
export const MAX_CLUBS = 100;
// Every map has 100 sections whatever N (format 2), so two clubs make a campaign.
export const MIN_CLUBS = 2;
const POSITIONS = Object.keys(FM_ROLES);

// ---- HTTP: concurrency-limited, paced, retried ----

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Run tasks through `concurrency` slots; each slot waits `spacing` ms between its requests. */
export function createLimiter(concurrency = 3, spacing = 500) {
  const free = Array.from({ length: concurrency }, () => ({ last: 0 }));
  const waiting = [];
  const release = slot => { slot.last = Date.now(); const next = waiting.shift(); next ? next(slot) : free.push(slot); };
  return async task => {
    const slot = free.length ? free.shift() : await new Promise(resolve => waiting.push(resolve));
    try {
      const wait = slot.last + spacing - Date.now();
      if (wait > 0) await sleep(wait);
      return await task();
    } finally { release(slot); }
  };
}

/** Fetch text with 3 retries and backoff on network errors, 429, 5xx and empty bodies. */
export async function fetchText(url, { method = 'GET', body, headers = {}, timeout = 120000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(1500 * 2 ** (attempt - 1));
    try {
      const response = await fetch(url, { method, body, headers: { 'User-Agent': USER_AGENT, ...headers }, signal: AbortSignal.timeout(timeout) });
      const text = await response.text();
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { fatal: true });
      if (!text.trim()) throw new Error('empty body');
      return text;
    } catch (error) {
      lastError = error;
      if (error.fatal) break;
    }
  }
  throw new Error(`${url.slice(0, 300)}: ${lastError.message}`);
}

// ---- On-disk cache (gzip JSON, atomic writes) ----

export async function readGzJson(file) {
  return JSON.parse(strFromU8(gunzipSync(new Uint8Array(await readFile(file)))));
}

export async function writeGzJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, gzipSync(strToU8(JSON.stringify(value)), { level: 6, mtime: 0 }));
  await rename(tmp, file);
}

/** Cache `produce()` (which returns a JSON value) in `file` unless `refresh`. */
export async function cachedGz(file, refresh, produce) {
  if (!refresh && existsSync(file)) return readGzJson(file);
  const value = await produce();
  await writeGzJson(file, value);
  return value;
}

const sha1 = text => createHash('sha1').update(text).digest('hex');

// ---- EFEM requests ----

export function createEfem({ cacheDir, refresh = false, concurrency = 3, spacing = 500 }) {
  const limit = createLimiter(concurrency, spacing);
  const fresh = new Set(); // URLs already re-downloaded by this run
  let requests = 0, cached = 0;
  /** GET an EFEM filter URL; `trim` reduces each row before it is cached. */
  async function get(url, trim, options = {}) {
    const hash = sha1(url);
    const file = path.join(cacheDir, 'efem', hash.slice(0, 2), `${hash}.json.gz`);
    if ((!(options.refresh ?? refresh) || fresh.has(url)) && existsSync(file)) { cached++; return readGzJson(file); }
    return cachedGz(file, true, () => limit(async () => {
      requests++;
      fresh.add(url);
      const result = JSON.parse(await fetchText(url));
      if (!Array.isArray(result.data) || !Number.isInteger(result.count)) throw new Error(`Invalid EFEM response for ${url}`);
      return { url, fetchedAt: new Date().toISOString(), count: result.count, data: result.data.map(trim).filter(Boolean) };
    }));
  }
  return { get, stats: () => ({ requests, cached }) };
}

const encodeFilters = items => items.map(encodeURIComponent).join(',');

/** A nation's club list page; with `reputation`, every club of exactly that reputation in one page. */
export function clubsUrl(fmName, page, contains = false, reputation = null) {
  const filters = ['gender=0', contains ? `nation=*${fmName}/i` : `nation=${fmName}`];
  if (reputation != null) filters.push(`reputation=${reputation}`);
  return `${CLUBS_ENDPOINT}?filterString=pageSize=${reputation == null ? CLUB_PAGE_SIZE : TIE_PAGE_SIZE}&page=${page}&version=${VERSION}`
    + `&filter=${encodeFilters(filters)}&orderBy=${encodeURIComponent('reputation desc')}`;
}

export function playerSliceUrl(ca, ageMin, ageMax, pageSize = SLICE_PAGE_SIZE) {
  const filters = ['playerbase.gender=0', `currentAbility=${ca}`];
  if (ageMin != null) filters.push(`age>=${ageMin}`, `age<=${ageMax}`);
  return `${PLAYERS_ENDPOINT}?filterString=pageSize=${pageSize}&page=1&version=${VERSION}&view=Default`
    + `&filter=${encodeFilters(filters)}&orderBy=${encodeURIComponent('currentAbility desc')}`;
}

export const trimClub = club => ({
  clubId: club.clubId, name: club.name, shortName: club.shortName, gender: club.gender,
  gameVersion: club.gameVersion, reputation: club.reputation, efemScore: club.efemScore,
  totalPlayers: club.totalPlayers, competition: club.competition ?? null, nation: club.nation ?? null,
});

// Compact player row: [id, name, clubId, currentAbility, proficiency[14 in FM_ROLES order], nationCode].
export const trimPlayer = player => player.gender === 'Male' ? [
  player.id, player.name, player.clubId ?? null, player.currentAbility ?? null,
  POSITIONS.map(pos => player.positionProficiency?.[pos] ?? 0), player.primaryNationality?.nationCode ?? null,
] : null;

// ---- Nation mapping ----

// FM's nation names where they differ from the game's display names (taken from
// the primaryNationality names in scripts/data/fm26-players.json).
const FM_NATION_NAMES = {
  '044': 'The Bahamas', '070': 'Bosnia and Herzegovina', '096': 'Brunei Darussalam',
  '140': 'Central African Republic', '156': 'China PR', '158': 'Chinese Taipei (China PR)',
  '180': 'Democratic Republic of Congo', '214': 'Dominican Republic', '226': 'Equatorial Guinea',
  '270': 'The Gambia', '372': 'Republic of Ireland', '384': 'Ivory Coast', '626': 'East Timor',
  '780': 'Trinidad and Tobago', '792': 'Türkiye', '807': 'North Macedonia',
};
// FM nation codes that differ from the game's codes (as CODE_ALIASES in sync-football-manager.mjs).
// Club rows can carry a different code than player nationalities (Lebanon LIB, Sudan SUD).
const FM_NATION_CODES = { '422': ['LBN', 'LIB'], '496': ['MNG', 'MGL'], '729': ['SDN', 'SUD'], KOS: ['KOS', 'KVX'] };
// Contains-match queries (QUERY_ALIASES idea) for FM names the exact filter cannot take
// or that return nothing; the nation code check keeps other nations out.
const CONTAINS_FALLBACK = { '158': 'Chinese Taipei' };

export function fmNation(id) {
  const nation = NATIONS[id];
  if (!nation) throw new Error(`Unknown game nation ${id}`);
  const [name, code] = nation;
  return {
    id, name, fmName: FM_NATION_NAMES[id] ?? name, nationCode: FM_NATION_CODES[id]?.[0] ?? code, codes: FM_NATION_CODES[id] ?? [code],
    containsFallback: CONTAINS_FALLBACK[id] ?? null,
  };
}

/**
 * Load club list pages for a nation; tries the exact FM name, then a contains fallback.
 * EFEM orders clubs of equal reputation differently from one page request to the next,
 * so a reputation tie that straddles a page boundary repeats some clubs and never returns
 * others. Every reputation at the end of a page is therefore re-read whole as one
 * exact-reputation slice, which makes rows() complete down to the last fetched reputation.
 */
export function createClubLister(efem, nation) {
  let mode = null, count = 0;
  const pages = [], ties = new Map(); // reputation -> slice response
  const fmName = () => mode === 'contains' ? nation.containsFallback : nation.fmName;
  const fetchPage = page => efem.get(clubsUrl(fmName(), page, mode === 'contains'), trimClub);
  async function readTie(reputation) {
    if (!Number.isFinite(reputation) || ties.has(reputation)) return;
    const slice = await efem.get(clubsUrl(fmName(), 1, mode === 'contains', reputation), trimClub);
    if (slice.data.length !== slice.count || new Set(slice.data.map(c => c.clubId)).size !== slice.count) {
      throw new Error(`${nation.name}: reputation ${reputation} slice has ${slice.data.length} rows for count ${slice.count}`);
    }
    ties.set(reputation, slice);
  }
  const more = () => mode === null || pages.length * CLUB_PAGE_SIZE < count;
  /** Every club fetched (any nation code), each once; throws when pages and slices disagree. */
  function union() {
    const seen = new Map();
    for (const slice of [...ties.values()]) for (const club of slice.data) seen.set(club.clubId, club);
    for (const page of pages) for (const club of page.data) {
      if (ties.has(club.reputation)) {
        if (!seen.has(club.clubId)) throw new Error(`${nation.name}: club ${club.clubId} is on a list page but not in its reputation ${club.reputation} slice`);
      } else if (seen.has(club.clubId)) {
        throw new Error(`${nation.name}: club ${club.clubId} (reputation ${club.reputation}) is on two list pages outside a re-read tie`);
      } else seen.set(club.clubId, club);
    }
    if (!more() && seen.size !== count) throw new Error(`${nation.name}: ${seen.size} distinct clubs fetched for count ${count}`);
    return [...seen.values()];
  }
  return {
    get mode() { return mode; },
    get count() { return count; },
    get pages() { return pages; },
    get ties() { return [...ties.values()]; },
    get more() { return more(); },
    query() { return clubsUrl(fmName(), 1, mode === 'contains'); },
    /** Fetch the next page (and its boundary tie); returns false when there is none. */
    async next() {
      if (mode === null) {
        // Parentheses and commas break EFEM's filter parser (HTTP 500).
        mode = /[(),]/.test(nation.fmName) && nation.containsFallback ? 'contains' : 'exact';
        let first = await fetchPage(1);
        if (!first.count && nation.containsFallback && mode === 'exact') { mode = 'contains'; first = await fetchPage(1); }
        count = first.count; pages.push(first);
      } else {
        if (!more()) return false;
        pages.push(await fetchPage(pages.length + 1));
      }
      const page = pages.at(-1);
      if (more()) await readTie(page.data.at(-1)?.reputation);
      return page.data.length > 0;
    },
    union,
    rows() {
      return union().filter(club => nation.codes.includes(club.nation?.nationCode)).sort(compareClubs);
    },
  };
}

export const compareClubs = (a, b) => (b.reputation ?? 0) - (a.reputation ?? 0)
  || (b.efemScore ?? 0) - (a.efemScore ?? 0) || a.clubId - b.clubId;

// ---- Viability ----

// Clubs the name rules miss. Keyed by FM clubId.
export const EXCLUDED_CLUBS = {
};

// Age groups are never senior sides, whatever league they play in.
const AGE_GROUP = /\b(?:U-?\s?\d{2}s?|Under[- ]?\d{2}s?|Sub[- ]?\d{2})\b/i;
// English/Japanese/Malay school terms only: "Universidad de Chile" or "Universitatea Craiova" are senior clubs.
// Applied only outside senior leagues: Orbit College or Juan Pablo II College play top-flight football.
const SCHOOL = /\b(?:University|Univ\.|College|High School|H\.S\.|School|Sekolah|Gakuen|Gakuin|Koko)\b/i;
const STUDENT_LEAGUE = /\b(?:U[- ]League|Universit\w*|College|School|Student)\b/i;
const ALL_STAR = /\bAll[- ]?Stars?\b/i;
// Second-team markers count only when the rest of the name is a stronger club of the same
// nation: "Borussia Dortmund II" and "Jong Genk" are reserves, "Willem II", "Negombo Youth"
// and "Jong Rambaan" are senior clubs. The marker may follow a slash or hyphen ("Atlantis FC/Akatemia").
const SECOND_TEAM = [
  [/^(.+?)[\s/-]+(?:B|C|II|III|IV|2|3|Reserves?|Res\.|Reserva|Reservas|Amateure|Amateurs|Next Gen|Castilla|Atl[eè]tic|Mestalla|Promesas|Fabril|Mirandilla|Fortuna|Futuro|Academy|Akademi|Akatemia|Development)$/i, 'reserve side'],
  [/^Jong\s+(.+)$/i, 'reserve side'],
  [/^(.+?)[\s/-]+(?:Youth|Juvenil(?: [A-C])?|Juvenis|Jugend|Primavera|Juunior)$/i, 'youth side'],
];
const CLUB_TOKENS = new Set(['fc', 'cf', 'ac', 'sc', 'afc', 'cd', 'ss', 'as', 'us', 'ssc', 'rcd', 'ud', 'sd', 'ca', 'rc', 'sk', 'sv', 'fk', 'nk',
  'krc', 'kaa', 'kv', 'rsc', 'rfc', 'ksv', 'kvc', 'club', 'sad']);

const fold = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/\([^)]*\)/g, ' ').replace(/[.'’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  .split(' ').filter(word => !CLUB_TOKENS.has(word)).join(' ');

/** Name-rule exclusion reason, or null. `stronger` = folded names of higher-ranked clubs (foldedNames). */
export function nameReason(club, stronger) {
  if (EXCLUDED_CLUBS[club.clubId]) return EXCLUDED_CLUBS[club.clubId];
  const names = [club.name, club.shortName].filter(Boolean).map(name => name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim());
  if (names.some(name => ALL_STAR.test(name))) return 'all-star side';
  if (names.some(name => AGE_GROUP.test(name))) return 'youth side';
  const studentLeague = !club.competition || STUDENT_LEAGUE.test(club.competition.name);
  if (studentLeague && names.some(name => SCHOOL.test(name))) return 'university or school side';
  for (const name of names) {
    for (const [pattern, reason] of SECOND_TEAM) {
      const base = fold(name.match(pattern)?.[1]);
      if (base && [...stronger].some(parent => base === parent || base.startsWith(parent + ' '))) return reason;
    }
  }
  return null;
}

export const foldedNames = club => [club.name, club.shortName].filter(Boolean).map(fold).filter(Boolean);

// ---- Squads ----

/** Natural-position players of one club, strongest first (CA desc, then id). */
export function naturalPlayers(rows) {
  return rows.map(([id, name, , ca, proficiency, nationCode]) => {
    const keys = fmNaturalPositions(Object.fromEntries(POSITIONS.map((pos, i) => [pos, proficiency[i]])));
    return { id, name, ca, keys, nationCode };
  }).filter(p => Number.isInteger(p.ca) && p.ca >= 1 && p.ca <= 100 && p.keys.length && typeof p.name === 'string' && p.name.trim())
    .sort((a, b) => b.ca - a.ca || a.id - b.id);
}

// The game's football lineup (selectLineup in src/data/teams.js).
const LINEUP = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'];

/**
 * Up to 16 players: the strongest natural 4-4-2 (1 GK, 4 DF, 4 MF, 2 FW) in the
 * game's own roles (FM_ROLES, so wingers are forwards), then the best remaining
 * by Current Ability. Players are seated in Current Ability order whenever the
 * shirts already filled can be rearranged to make room (augmenting paths), so a
 * two-role player never blocks a shirt only someone else could wear.
 * Returns compact tuples, strongest first.
 */
export function pickSquad(players, size = SQUAD_SIZE) {
  const roles = new Map(players.map(p => [p, new Set(p.keys.map(key => FM_ROLES[key]))]));
  const holder = LINEUP.map(() => null);
  const seat = (player, seen) => LINEUP.some((role, i) => {
    if (seen[i] || !roles.get(player).has(role)) return false;
    seen[i] = true;
    if (holder[i] && !seat(holder[i], seen)) return false;
    holder[i] = player;
    return true;
  });
  for (const player of players) if (holder.includes(null)) seat(player, []);
  const chosen = new Set(holder.filter(Boolean));
  for (const player of players) { if (chosen.size >= size) break; chosen.add(player); }
  return [...chosen].sort((a, b) => b.ca - a.ca || a.id - b.id).slice(0, size)
    .map(p => [p.id, p.name, p.ca, p.keys.join(','), p.nationCode]);
}

// ---- Snapshot validation (also usable from tests) ----

/** Throws when a scripts/data/domestic/<id>.json snapshot breaks the contract. */
export function validateSnapshot(snapshot) {
  const fail = message => { throw new Error(`Snapshot ${snapshot?.nation?.id}: ${message}`); };
  if (snapshot.format !== 1) fail('format must be 1');
  if (snapshot.source?.version !== VERSION) fail(`version must be ${VERSION}`);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(snapshot.source?.fetchedAt || '')) fail('fetchedAt must be an ISO date');
  const { clubs, excluded } = snapshot;
  if (!Array.isArray(clubs) || clubs.length > MAX_CLUBS || clubs.length < MIN_CLUBS) fail(`club count ${clubs?.length} outside ${MIN_CLUBS}-${MAX_CLUBS}`);
  const clubIds = new Set(), playerIds = new Set();
  const source = { version: VERSION, snapshotDate: snapshot.source.fetchedAt.slice(0, 10) };
  clubs.forEach((club, i) => {
    if (!Number.isInteger(club.fm) || clubIds.has(club.fm)) fail(`duplicate or invalid club id ${club.fm}`);
    clubIds.add(club.fm);
    if (!club.name || !club.competition) fail(`club ${club.fm} needs a name and competition`);
    if (i && clubs[i - 1].rep < club.rep) fail(`club ${club.fm} is out of reputation order`);
    if (!Array.isArray(club.squad) || club.squad.length < 11 || club.squad.length > SQUAD_SIZE) fail(`club ${club.fm} squad size ${club.squad?.length}`);
    if (!club.squad.some(t => String(t[3]).split(',').includes('gk'))) fail(`club ${club.fm} has no natural goalkeeper`);
    for (const tuple of club.squad) {
      const [id, name, ca, keys] = tuple;
      if (tuple.length !== 5 || !Number.isInteger(id) || typeof name !== 'string' || !name.trim() || typeof keys !== 'string') fail(`bad tuple ${JSON.stringify(tuple)}`);
      if (!Number.isInteger(ca) || ca < 1 || ca > 100) fail(`player ${id} currentAbility ${ca}`);
      if (playerIds.has(id)) fail(`player ${id} appears twice`);
      playerIds.add(id);
      expandFmTuple(tuple, source, club.name);
    }
    const loc = club.location;
    if (loc !== null) {
      if (!Number.isFinite(loc?.lon) || !Number.isFinite(loc?.lat) || Math.abs(loc.lon) > 180 || Math.abs(loc.lat) > 90) fail(`club ${club.fm} location ${JSON.stringify(loc)}`);
      if (!/^(override|wikidata:Q\d+|geonames:\d+)$/.test(loc.source)) fail(`club ${club.fm} location source ${loc.source}`);
    }
  });
  for (const entry of excluded || []) {
    if (!Number.isInteger(entry.fm) || !entry.reason || clubIds.has(entry.fm)) fail(`bad exclusion ${JSON.stringify(entry)}`);
  }
  return true;
}

