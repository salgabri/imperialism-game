// Club crests for every club the game ships: the all-leagues football layer, the women's clubs, the NBA, NFL, MLB, NHL
// and NRL franchises, the EuroLeague's clubs, college football's FBS schools, rugby union's European clubs and every
// country's domestic clubs. A club with a crest shows it wherever a nation shows its flag; a club without one keeps its
// monogram chip.
//
// Usage:
//   node scripts/sync-club-logos.mjs [--refresh] [--pin]
//     --refresh  ask Wikidata again (downloaded images stay cached; Wikipedia's answers are never asked again)
//     --pin      record the SHA-256 of every Wikipedia answer the run reads in scripts/data/club-logos-wikipedia.json
//   node scripts/sync-club-logos.mjs --pages
//     rewrite only the crests scripts/data/club-logos.json "pages" names (below), from their file pages; every other
//     crest, its SOURCES.tsv row and src/data/clubLogos.js stay as committed. It reads no Wikipedia API answer and asks
//     Wikidata nothing, so it runs while the full sync cannot (no API answer is pinned).
//
// Sources (cached under the gitignored data-src/club-logos/, so reruns are offline). Every request goes through
// scripts/lib/polite-fetch.mjs (one generic User-Agent, robots.txt read first and obeyed):
//   - Each club's Wikidata item (CC0), by SPARQL from QLever's Wikidata endpoint (scripts/lib/wikidata-sparql.mjs; the
//     Query Service's robots.txt disallows its /sparql). Each query keeps the Query Service's text, which keys the cache.
//     Domestic clubs reuse the item their home town came
//     from (scripts/data/domestic/<nation>.json, location.source "wikidata:Q..", or location.qid); an
//     all-leagues club takes the item of its domestic twin, the club of its country whose
//     FM26 squad shares the most players with its EA lineup; NBA, NFL, MLB, NHL and NRL franchises
//     are matched by English label; a EuroLeague club names its basketball club's item (scripts/data/club-logos.json "items"). A women's club wears its men's club's crest (scripts/data/club-logos.json "twins")
//     or has an item of its own there ("items"). scripts/data/club-logos.json overrides any of these ("items"),
//     or names a twin the lineups do not find ("twins"). The all-leagues clubs are the built-in
//     ones plus those of the earlier EA seasons no older than the domestic squads (EA FC 26), so
//     a club that has left the seven leagues keeps its crest in the seasons it played.
//   - The crest: the lead image of the club's English Wikipedia article (its infobox
//     crest), else the item's logo image (P154) on Wikimedia Commons. Most crests are
//     non-free files on English Wikipedia; SOURCES.tsv records each file and its licence.
//     The lead images and the files' details (thumbnail, licence) are English Wikipedia API
//     answers, and en.wikipedia.org/w/api.php is disallowed by its robots.txt for every agent
//     (Wikimedia's REST API under /api/ too; read 2026-11-10), with no allowed source of the
//     same facts in bulk. So they are read only from the cache, and only answers pinned by their SHA-256
//     in scripts/data/club-logos-wikipedia.json: a run that needs an answer the cache lacks (a
//     new club, or an article Wikidata now names after --refresh), or one not pinned, stops
//     before writing anything, and the committed crests stay as they are. None is pinned yet:
//     a run from the newest cache on hand (2026-11-10) does not give back the committed crests
//     (89 files and the sources would change), so a run waits for someone to pin a cache, on
//     purpose, with --pin.
//   - The file's 250px thumbnail from upload.wikimedia.org (allowed by its robots.txt), trimmed
//     and saved as WebP fitting 128x128.
//   - A crest named in scripts/data/club-logos.json "pages" (club id -> { file, sha256, wiki? }) needs none of those
//     answers: its English Wikipedia file page (/wiki/File:…, which robots.txt allows; another language's where `wiki`
//     names it, as Italian Wikipedia's for Sassuolo's crest of 2025) gives the facts the API's answers gave,
//     the address of the file's original on upload.wikimedia.org and the licence its licence template states (the
//     licensetpl data the API's LicenseShortName and NonFree are read from). The original must have the SHA-256 pinned
//     there, and is drawn as the period crests are (scripts/lib/crest-image.mjs). So a club's crest of today can change
//     though the API is never asked again: ASVEL's LDLC ASVEL logo (since 2018/19) came this way. Its file then drops
//     out of the API's file requests (fifty files each), which changes one of them: a full run needs an answer no
//     cache holds, and stops. A record may name a standard thumbnail width instead (`thumb`: 120, 250, 330 or 500, never
//     wider than the original), whose bytes are then pinned and drawn: upload.wikimedia.org answers a run of originals
//     with HTTP 429 and asks for its standard thumbnails instead, so college football's 138 school crests are 330px
//     thumbnails. So are 287 of the 748 crests the country maps' clubs gained on 17 November 2026; 86 of those came from
//     another language's file page. A record may name the colour of a box the picture was saved on (`background`,
//     '#ffffff'), which the drawing clears as the period crests' is. A women's club may have a record of its own.
//     --pages also gives a club that wears its twin's file (an all-leagues or women's club) its twin's crest, new or
//     committed, when it has none, as the full sync would.
//
// Writes:
//   public/club-logos/<club id>.webp   one per club with a crest (an all-leagues club with a
//                                      domestic twin shares the twin's file)
//   public/club-logos/SOURCES.tsv      club, file, licence and file page for every crest
//   src/data/clubLogos.js              which clubs have a crest, and clubLogoUrl(id)
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { crestWebp } from './lib/crest-image.mjs';
import { filePageFacts, filePageUrl } from './lib/wiki-file-page.mjs';
import { CLUBS as FOOTBALL_CLUBS } from '../src/data/clubs.football.js';
import { CLUBS as BASKETBALL_CLUBS } from '../src/data/clubs.basketball.js';
import { CLUBS as EUROLEAGUE_CLUBS } from '../src/data/clubs.euroleague.js';
import { CLUBS as NFL_CLUBS } from '../src/data/clubs.american-football.js';
import { CLUBS as MLB_CLUBS } from '../src/data/clubs.baseball.js';
import { CLUBS as NHL_CLUBS } from '../src/data/clubs.hockey.js';
import { CLUBS as NRL_CLUBS } from '../src/data/clubs.rugby-league.js';
import { CLUBS as WOMENS_CLUBS } from '../src/data/clubs.womens-football.js';
import { CLUBS as CFB_CLUBS } from '../src/data/clubs.college-football.js';
import { CLUBS as RUGBY_UNION_CLUBS } from '../src/data/clubs.rugby-union.js';
import { BUILT_IN_SEASONS } from '../src/data/footballSeasons.js';
import { cachedGz, createLimiter, DATABASE_DATE, readGzJson } from './lib/domestic-sync.mjs';
import { norm } from './lib/domestic-locate.mjs';
import { politeFetch } from './lib/polite-fetch.mjs';
import { sparqlRequest, WIKIDATA_SPARQL } from './lib/wikidata-sparql.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, 'data-src/club-logos');
const outDir = path.join(root, 'public/club-logos');
const moduleFile = path.join(root, 'src/data/clubLogos.js');
const overridesFile = path.join(root, 'scripts/data/club-logos.json');
const pinsFile = path.join(root, 'scripts/data/club-logos-wikipedia.json');
const unknown = process.argv.slice(2).filter(arg => !['--refresh', '--pin', '--pages'].includes(arg));
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const refresh = process.argv.includes('--refresh');
const pinning = process.argv.includes('--pin');
// Only the "pages" crests (see the top of this file).
const pagesOnly = process.argv.includes('--pages');
if (pagesOnly && (refresh || pinning)) throw new Error('--pages asks Wikidata nothing and reads no Wikipedia API answer: pass it alone');

// The API the cached Wikipedia answers came from: their cache keys are its request URLs. Never requested now.
const ENWIKI = 'https://en.wikipedia.org/w/api.php';
const NBA = 'Q155223', BASKETBALL_TEAM = 'Q13393265';
const NFL = 'Q1215884', AMERICAN_FOOTBALL_TEAM = 'Q17156793';
const MLB = 'Q1163715', BASEBALL_TEAM = 'Q13027888';
const NHL = 'Q1215892', HOCKEY_TEAM = 'Q4498974';
const NRL = 'Q1140630', RUGBY_LEAGUE_TEAM = 'Q15221215';
const THUMB_WIDTH = 250; // one of Wikimedia's standard thumbnail steps
// The fewest lineup players an all-leagues club must share with a domestic club to be its twin.
const MIN_SHARED = 4;
const LOGO_NAME = /logo|crest|badge|escudo|emblem|wappen|stemma|scudo|blason|herb|insignia|s[ií]mbolo|embleem|logotip/i;
const PHOTO_NAME = /stadi|estadio|arena|\d{4}-\d{2}-\d{2}|photo|foto|kit|jersey|shirt|players|squad|team ?picture|vs\.? /i;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha1 = text => createHash('sha1').update(text).digest('hex');
const sha256 = text => createHash('sha256').update(text).digest('hex');
const limit = createLimiter(4, 250);
// upload.wikimedia.org answers bursts with HTTP 429, so images come two at a time, well spaced.
const imageLimit = createLimiter(2, 700);

// A 429 pauses every request, not just the one that met it, for the server's Retry-After (30s to 2 minutes).
let pausedUntil = 0;

async function fetchOk(url, init = {}) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt) await sleep(Math.min(60000, 2000 * 2 ** (attempt - 1)));
    if (pausedUntil > Date.now()) await sleep(pausedUntil - Date.now());
    try {
      // A refusal (robots.txt) is fatal: no retry.
      const response = await politeFetch(url, { ...init, signal: AbortSignal.timeout(120000) });
      if (response.status === 429) {
        const pause = Math.min(120, Math.max(30, Number(response.headers.get('retry-after')) || 0));
        pausedUntil = Math.max(pausedUntil, Date.now() + pause * 1000);
        console.log(`  HTTP 429 from ${new URL(url).host}: pausing ${pause}s`);
      }
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { fatal: true });
      return response;
    } catch (error) {
      lastError = error;
      if (error.fatal) break;
    }
  }
  throw new Error(`${url.slice(0, 200)}: ${lastError.message}`);
}

const getJson = async (url, init) => {
  const text = await (await limit(() => fetchOk(url, init))).text();
  try { return JSON.parse(text); } catch { throw new Error(`${url.slice(0, 200)}: not JSON: ${text.slice(0, 120)}`); }
};

/** Run one SPARQL query (the Query Service's text, which keys the cache) on QLever. → bindings, each value a string. */
async function sparql(query) {
  return cachedGz(path.join(cacheDir, `wikidata-${sha1(query)}.json.gz`), refresh, async () => {
    const data = await getJson(WIKIDATA_SPARQL, sparqlRequest(query));
    return data.results.bindings.map(row => Object.fromEntries(Object.entries(row).map(([key, cell]) => [key, cell.value])));
  });
}

// Each cached Wikipedia answer's SHA-256 (of its JSON), by the SHA-1 of its request URL.
const pins = existsSync(pinsFile) ? JSON.parse(await readFile(pinsFile, 'utf8')).answers : {};
const read = {}; // the answers this run read, for --pin

/** One English Wikipedia API answer (GET parameters), from the cache only, as pinned (see the top of this file). */
async function enwiki(params) {
  const url = `${ENWIKI}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  const key = sha1(url), file = path.join(cacheDir, `enwiki-${key}.json.gz`);
  if (!existsSync(file)) {
    throw new Error(`No cached Wikipedia answer ${path.relative(root, file)} for ${url.slice(0, 160)}…: en.wikipedia.org/w/api.php is `
      + 'disallowed by its robots.txt, so it is never asked. Nothing was written; the committed crests stay as they are.');
  }
  const answer = await readGzJson(file);
  const digest = sha256(JSON.stringify(answer));
  if (!pinning && pins[key] !== digest) {
    throw new Error(`${path.relative(root, file)} is ${pins[key] ? 'not the pinned answer' : 'not pinned'} in ${path.relative(root, pinsFile)}. `
      + 'Nothing was written. Pass --pin only to record, deliberately, the answers of the cache on hand (the run then rewrites the crests from them).');
  }
  read[key] = digest;
  return answer;
}

const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
const qidOf = uri => uri.split('/').pop();
const fileName = name => decodeURIComponent(String(name)).replace(/^File:/, '').replace(/_/g, ' ');

// ---- Which Wikidata item each club is ----

async function domesticClubs() {
  const clubs = [];
  const snapshots = (await readdir(path.join(root, 'scripts/data/domestic'))).filter(name => /^[0-9A-Z]+\.json$/.test(name) && name !== 'survey.json');
  const shipped = new Set((await readdir(path.join(root, 'public/domestic'))).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)));
  for (const name of snapshots.sort()) {
    const nation = name.slice(0, -5);
    if (!shipped.has(nation)) continue;
    const snapshot = JSON.parse(await readFile(path.join(root, 'scripts/data/domestic', name), 'utf8'));
    const map = JSON.parse(await readFile(path.join(root, 'public/domestic', name), 'utf8'));
    const byFm = new Map(snapshot.clubs.map(club => [club.fm, club]));
    for (const club of map.clubs) {
      const source = byFm.get(club.fm);
      // A hand-placed home town (source "override") may still name the club's item.
      const qid = /^wikidata:(Q\d+)$/.exec(source?.location?.source || '')?.[1] || source?.location?.qid || null;
      clubs.push({ id: club.id, name: club.name, nation, fm: club.fm, qid, squad: source?.squad || [] });
    }
  }
  return clubs;
}

const surname = name => norm(name).split(' ').filter(Boolean).pop();

/** An all-leagues club's domestic twin: the club of its country sharing the most lineup players (`players`, names). */
function twinOf(club, domestic) {
  const lineup = new Set(club.players.map(surname));
  let best = null;
  for (const candidate of domestic) {
    if (candidate.nation !== club.country) continue;
    const shared = new Set(candidate.squad.map(player => surname(player[1])).filter(name => lineup.has(name))).size;
    if (!best || shared > best.shared) best = { club: candidate, shared };
  }
  return best && best.shared >= MIN_SHARED ? best : null;
}

/** A league's current franchises by English label: the NBA's, or (`league`, `kind`) the NFL's, MLB's, the NHL's or the NRL's. */
async function leagueItems(league = NBA, kind = BASKETBALL_TEAM) {
  const rows = await sparql(`SELECT ?team ?label WHERE { ?team wdt:P118 wd:${league}; wdt:P31/wdt:P279* wd:${kind}; rdfs:label ?label .
    FILTER(lang(?label) = 'en') FILTER NOT EXISTS { ?team wdt:P576 [] } }`);
  return new Map(rows.map(row => [row.label, qidOf(row.team)]));
}

// ---- Which file is each item's crest ----

/** item -> { article, p154 }: its English Wikipedia article title and its logo image (P154). */
async function itemFacts(qids) {
  const facts = new Map(qids.map(qid => [qid, { article: null, p154: null }]));
  for (const chunk of chunks(qids, 400)) {
    const values = chunk.map(qid => `wd:${qid}`).join(' ');
    for (const row of await sparql(`SELECT ?c ?t WHERE { VALUES ?c { ${values} } ?a schema:about ?c; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?t }`)) {
      facts.get(qidOf(row.c)).article = row.t;
    }
    for (const row of await sparql(`SELECT ?c ?logo WHERE { VALUES ?c { ${values} } ?c wdt:P154 ?logo }`)) {
      facts.get(qidOf(row.c)).p154 ??= fileName(row.logo.split('/').pop());
    }
  }
  return facts;
}

/**
 * article title -> its lead image file name, following redirects. PageImages records a non-free lead image as
 * page_image and a free one only as page_image_free, so a free crest is the lead image when page_image is absent.
 */
async function leadImages(titles) {
  const images = new Map();
  for (const chunk of chunks([...new Set(titles)], 50)) {
    const data = await enwiki({ action: 'query', redirects: '1', prop: 'pageprops', ppprop: 'page_image|page_image_free', titles: chunk.join('|') });
    const moved = new Map([...(data.query.normalized || []), ...(data.query.redirects || [])].map(step => [step.from, step.to]));
    const byTitle = new Map(data.query.pages.map(page => [page.title, page.pageprops?.page_image || page.pageprops?.page_image_free || null]));
    for (const title of chunk) {
      let at = title;
      for (let hops = 0; moved.has(at) && hops < 5; hops++) at = moved.get(at);
      if (byTitle.get(at)) images.set(title, fileName(byTitle.get(at)));
    }
  }
  return images;
}

/** file name -> { thumb, page, mime, width, height, licence, nonFree } (or null for a missing file). */
async function fileInfo(names) {
  const info = new Map();
  for (const chunk of chunks([...new Set(names)], 50)) {
    const data = await enwiki({ action: 'query', prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(THUMB_WIDTH),
      iiextmetadatafilter: 'LicenseShortName|NonFree', titles: chunk.map(name => `File:${name}`).join('|') });
    const moved = new Map((data.query.normalized || []).map(step => [step.from, step.to]));
    const byTitle = new Map(data.query.pages.map(page => [page.title, page.imageinfo?.[0] || null]));
    for (const name of chunk) {
      const title = moved.get(`File:${name}`) || `File:${name}`;
      const ii = byTitle.get(title);
      info.set(name, ii ? {
        thumb: ii.thumburl || ii.url, page: ii.descriptionurl, mime: ii.mime, width: ii.width, height: ii.height,
        licence: ii.extmetadata?.LicenseShortName?.value || '', nonFree: ii.extmetadata?.NonFree?.value === 'true',
      } : null);
    }
  }
  return info;
}

/**
 * A "pages" file's details from its Wikipedia file page (scripts/lib/wiki-file-page.mjs: English Wikipedia's, or
 * `wiki`'s), the page cached as it came: { original, page, licence, nonFree }.
 */
async function pageInfo(name, wiki = 'en') {
  const url = filePageUrl(name, wiki);
  const { html } = await cachedGz(path.join(cacheDir, `page-${sha1(url)}.json.gz`), false,
    async () => ({ url, html: await (await limit(() => fetchOk(url))).text() }));
  try {
    return filePageFacts(html, name, wiki);
  } catch (error) {
    throw new Error(`${url}: ${error.message}. Nothing was written.`);
  }
}

// ---- Images ----

async function download(url) {
  const ext = path.extname(new URL(url).pathname).toLowerCase() || '.bin';
  const file = path.join(cacheDir, 'files', `${sha1(url)}${ext}`);
  if (existsSync(file)) return readFile(file);
  const bytes = await imageLimit(async () => Buffer.from(await (await fetchOk(url)).arrayBuffer()));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return bytes;
}

/** The share of an image's pixels that are mostly transparent: a crest has some, a photo none. */
async function transparency(bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  let clear = 0;
  for (const alpha of data) if (alpha < 128) clear++;
  return clear / (info.width * info.height);
}

/**
 * Whether a downloaded file is a crest. A lead image is almost always the infobox crest, so it only has to be a
 * graphic (not a JPEG photo) of a crest's shape; a P154 file must also look like one, by transparency or its name.
 */
async function crestReason(name, from, info, bytes) {
  if (PHOTO_NAME.test(name) && !LOGO_NAME.test(name)) return 'photo-like name';
  const meta = await sharp(bytes).metadata();
  const aspect = meta.width / meta.height;
  if (!(aspect > 0.4 && aspect < 2.5)) return `aspect ${aspect.toFixed(2)}`;
  if (info.mime === 'image/jpeg' && !LOGO_NAME.test(name)) return 'JPEG without a logo name';
  if (from === 'p154' && !LOGO_NAME.test(name) && await transparency(bytes) < 0.03) return 'opaque P154 file';
  return null;
}

/** The crests SOURCES.tsv lists, as the last run wrote them: club id -> { file, name, info, from, label }. */
async function committedCrests() {
  const rows = (await readFile(path.join(outDir, 'SOURCES.tsv'), 'utf8')).split(/\r?\n/).filter(line => line && !line.startsWith('#')).slice(1);
  return new Map(rows.map(line => {
    const [id, label, image, name, licence, nonFree, page] = line.split('\t');
    return [id, { file: image.replace(/\.webp$/, ''), name, info: { licence, nonFree: nonFree === 'yes', page }, from: 'committed', label }];
  }));
}

// ---- Main ----

const overrides = existsSync(overridesFile) ? JSON.parse(await readFile(overridesFile, 'utf8')) : {};
const itemOverrides = overrides.items || {}, fileOverrides = overrides.files || {}, twinOverrides = overrides.twins || {};
const pageOverrides = overrides.pages || {};

const domestic = await domesticClubs();
const domesticById = new Map(domestic.map(club => [club.id, club]));
// --pages asks Wikidata nothing: its crests name their files, and the clubs' items find none of them.
const itemsOf = (league, kind) => (pagesOnly ? new Map() : leagueItems(league, kind));
const nba = await itemsOf(NBA, BASKETBALL_TEAM);
const nfl = await itemsOf(NFL, AMERICAN_FOOTBALL_TEAM);
const mlb = await itemsOf(MLB, BASEBALL_TEAM);
const nhl = await itemsOf(NHL, HOCKEY_TEAM);
const nrl = await itemsOf(NRL, RUGBY_LEAGUE_TEAM);
const clubs = []; // { id, name, qid, twin? }
const problems = [];

// The all-leagues clubs: the built-in ones, then those of the earlier EA seasons whose squads are no older than the
// domestic ones (the season ending in 2026 for FM 26 26.3.0), newest first, that no built-in club already names.
const domesticSeason = Number(DATABASE_DATE.slice(0, 4)) + (DATABASE_DATE.slice(5) >= '07-01' ? 1 : 0);
const footballClubs = FOOTBALL_CLUBS.map(club => ({ id: club.id, name: club.name, country: club.country, players: club.squad.map(player => player[0]), builtIn: true }));
for (const season of BUILT_IN_SEASONS.filter(set => set.year >= domesticSeason)) {
  const { clubs: seasonClubs } = JSON.parse(await readFile(path.join(root, 'public/football', `${season.id}.json`), 'utf8'));
  for (const club of seasonClubs) {
    if (footballClubs.some(entry => entry.id === club.id)) continue;
    footballClubs.push({ id: club.id, name: club.name, country: club.country, players: club.squad.map(tuple => tuple[1]), builtIn: false });
  }
}

for (const club of domestic) clubs.push({ id: club.id, name: club.name, qid: club.qid });
for (const club of footballClubs) {
  const named = twinOverrides[club.id];
  if (named && !domesticById.has(named)) throw new Error(`club-logos.json twins ${club.id} with unknown domestic club ${named}`);
  const twin = itemOverrides[club.id] ? null : named ? { club: domesticById.get(named) } : twinOf(club, domestic);
  if (!twin && !itemOverrides[club.id]) {
    // An earlier season's club without a twin keeps its monogram; a built-in one is reported.
    if (club.builtIn) problems.push(`${club.id}: no domestic twin (add it to ${path.relative(root, overridesFile)} "twins" or "items")`);
    else continue;
  }
  clubs.push({ id: club.id, name: club.name, qid: twin?.club.qid ?? null, twin: twin?.club.id ?? null });
}
// A women's club named in none of "twins", "items" and "pages" keeps its monogram.
for (const club of WOMENS_CLUBS) {
  const named = twinOverrides[club.id];
  if (named && !domesticById.has(named)) throw new Error(`club-logos.json twins ${club.id} with unknown domestic club ${named}`);
  if (named || itemOverrides[club.id] || pageOverrides[club.id]) {
    clubs.push({ id: club.id, name: club.name, qid: named ? domesticById.get(named).qid : null, twin: named ?? null });
  }
}
for (const [league, items, list] of [['NBA', nba, BASKETBALL_CLUBS], ['NFL', nfl, NFL_CLUBS], ['MLB', mlb, MLB_CLUBS], ['NHL', nhl, NHL_CLUBS], ['NRL', nrl, NRL_CLUBS]]) for (const club of list) {
  const qid = items.get(club.name) || null;
  if (!qid && !itemOverrides[club.id]) problems.push(`${club.id}: no ${league} item labelled "${club.name}"`);
  clubs.push({ id: club.id, name: club.name, qid });
}
// The EuroLeague's clubs: a basketball club's item is not its football club's (Real Madrid Baloncesto, not Real Madrid
// CF), and no league item lists them by label, so each names its own.
for (const club of EUROLEAGUE_CLUBS) {
  if (!itemOverrides[club.id]) problems.push(`${club.id}: no item (add it to ${path.relative(root, overridesFile)} "items")`);
  clubs.push({ id: club.id, name: club.name, qid: null });
}
// College football's schools: each crest is its athletics logo, named in "pages" (scripts/data/cfb-teams.json `crest`),
// which needs no Wikipedia API answer.
for (const club of CFB_CLUBS) {
  if (!pageOverrides[club.id] && !itemOverrides[club.id]) problems.push(`${club.id}: no crest (add its file to ${path.relative(root, overridesFile)} "pages")`);
  clubs.push({ id: club.id, name: club.name, qid: null });
}
// Rugby union's European clubs likewise: each crest is its article's infobox crest, named in "pages".
for (const club of RUGBY_UNION_CLUBS) {
  if (!pageOverrides[club.id] && !itemOverrides[club.id]) problems.push(`${club.id}: no crest (add its file to ${path.relative(root, overridesFile)} "pages")`);
  clubs.push({ id: club.id, name: club.name, qid: null });
}
for (const [id, qid] of Object.entries(itemOverrides)) {
  const club = clubs.find(entry => entry.id === id);
  if (!club) throw new Error(`club-logos.json names unknown club ${id}`);
  club.qid = qid;
  club.twin = null;
}

// The "pages" crests: each file page read, its original (or, where the record names a `thumb` width, that standard
// thumbnail of it) checked against its pin and drawn before anything is written, so a page or a file that has changed
// stops the run. upload.wikimedia.org answers a run of originals with HTTP 429 and asks for thumbnails in its standard
// sizes instead (https://w.wiki/GHai): college football's 138 crests are 330px thumbnails.
const STANDARD_THUMBS = new Set([120, 250, 330, 500]);
/** A file's thumbnail `width` pixels wide on upload.wikimedia.org, from its original's address (an SVG's is a PNG). */
const thumbOf = (original, width) => {
  const match = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/(?:[a-z]{2,3}|commons))\/([0-9a-f]\/[0-9a-f]{2})\/([^/?#]+)$/.exec(original);
  if (!match) throw new Error(`${original} is no upload.wikimedia.org original`);
  return `${match[1]}/thumb/${match[2]}/${match[3]}/${width}px-${match[3]}${/\.svg$/i.test(match[3]) ? '.png' : ''}`;
};
const pageCrests = new Map(); // club id -> { webp, crest }
for (const [id, record] of Object.entries(pageOverrides)) {
  const club = clubs.find(entry => entry.id === id);
  if (!club) throw new Error(`club-logos.json "pages" names unknown club ${id}`);
  if (!record?.file || !/^[0-9a-f]{64}$/.test(record.sha256 ?? '')) throw new Error(`club-logos.json "pages" ${id}: give its file and its original's SHA-256`);
  if (record.thumb !== undefined && !STANDARD_THUMBS.has(record.thumb)) throw new Error(`club-logos.json "pages" ${id}: thumb ${record.thumb} is no standard width (${[...STANDARD_THUMBS].join(', ')})`);
  // A picture saved on a solid box names the box's colour, which the drawing clears (as the period crests' do).
  if (record.background !== undefined && !/^#[0-9a-f]{6}$/.test(record.background)) throw new Error(`club-logos.json "pages" ${id}: background is a #rrggbb colour`);
  const name = fileName(record.file);
  const info = await pageInfo(name, record.wiki ?? 'en');
  const source = record.thumb ? thumbOf(info.original, record.thumb) : info.original;
  const bytes = await download(source);
  if (sha256(bytes) !== record.sha256) {
    throw new Error(`${id}: ${source} (SHA-256 ${sha256(bytes)}) is not the ${record.thumb ? 'thumbnail' : 'original'} pinned in ${path.relative(root, overridesFile)} "pages". Nothing was written.`);
  }
  club.twin = null; // a file of its own
  pageCrests.set(id, { webp: await crestWebp(bytes, { svg: !record.thumb && /\.svg$/i.test(info.original), background: record.background ?? null }),
    crest: { file: id, name, info, from: 'page' } });
}

const qids = pagesOnly ? [] : [...new Set(clubs.map(club => club.qid).filter(Boolean))].sort();
const facts = await itemFacts(qids);
const leads = await leadImages([...facts.values()].map(fact => fact.article).filter(Boolean));
const candidatesOf = club => {
  if (pageCrests.has(club.id)) return [];
  if (club.id in fileOverrides) return fileOverrides[club.id] ? [{ name: fileName(fileOverrides[club.id]), from: 'override' }] : [];
  const fact = club.qid ? facts.get(club.qid) : null;
  return [
    fact?.article && leads.get(fact.article) ? { name: leads.get(fact.article), from: 'enwiki' } : null,
    fact?.p154 ? { name: fact.p154, from: 'p154' } : null,
  ].filter(Boolean).filter((c, i, all) => all.findIndex(other => other.name === c.name) === i);
};
const infos = await fileInfo(pagesOnly ? [] : clubs.filter(club => !club.twin).flatMap(club => candidatesOf(club).map(c => c.name)));

await mkdir(outDir, { recursive: true });
const writeCrest = async (id, webp) => {
  const target = path.join(outDir, `${id}.webp`);
  if (!existsSync(target) || !webp.equals(await readFile(target))) await writeFile(target, webp);
};
// --pages starts from the crests the last run wrote, and changes only its own.
const crests = pagesOnly ? await committedCrests() : new Map(); // club id -> { file id, name, info, from, label? }
const rejected = {};
let done = 0;
// Eight clubs at a time: thousands of file reads and sharp jobs at once fill libuv's thread pool, and a download's
// DNS lookup, which needs that pool too, then waits behind them until it times out.
const work = createLimiter(8, 0);
await Promise.all(clubs.filter(club => !pagesOnly && !club.twin && !pageCrests.has(club.id)).map(club => work(async () => {
  for (const candidate of candidatesOf(club)) {
    const info = infos.get(candidate.name);
    if (!info) { (rejected['missing file'] ||= []).push(`${club.id} ${candidate.name}`); continue; }
    let reason, webp, bytes;
    try {
      bytes = await download(info.thumb);
      reason = candidate.from === 'override' ? null : await crestReason(candidate.name, candidate.from, info, bytes);
      if (!reason) webp = await crestWebp(bytes);
    } catch (error) {
      reason = bytes ? `unreadable image (${error.message.split('\n')[0]})` : 'download failed (rerun to retry)';
    }
    if (reason) { (rejected[reason] ||= []).push(`${club.id} ${candidate.name}`); continue; }
    await writeCrest(club.id, webp);
    crests.set(club.id, { file: club.id, name: candidate.name, info, from: candidate.from });
    break;
  }
  if (++done % 500 === 0) console.log(`  ${done} clubs checked`);
})));
for (const [id, { webp, crest }] of pageCrests) {
  await writeCrest(id, webp);
  // In --pages every row keeps the club name it had, and a club sharing the file (an all-leagues club, its domestic
  // twin's) lists the new source too.
  if (pagesOnly) for (const [other, entry] of crests) if (other !== id && entry.file === id) crests.set(other, { ...crest, label: entry.label });
  crests.set(id, { ...crest, label: crests.get(id)?.label });
}
if (!pagesOnly) for (const club of clubs.filter(entry => entry.twin && crests.has(entry.twin))) crests.set(club.id, { ...crests.get(club.twin), file: club.twin });
// --pages: an all-leagues or women's club without a crest shares its twin's, new or committed, as the full sync would
// (Union Berlin's all-leagues club wears its country-map twin's since that twin's crest came from its file page; Costa
// Adeje Tenerife's women wear CD Tenerife's, named in "twins").
if (pagesOnly) for (const club of clubs.filter(entry => entry.twin && !crests.has(entry.id) && crests.has(entry.twin))) {
  crests.set(club.id, { ...crests.get(club.twin), label: undefined });
}

// Files of clubs that no longer have a crest go (--pages leaves every other club's as it is). A period crest
// ('<club id>.<year>.webp') is scripts/sync-crest-eras.mjs's.
if (!pagesOnly) for (const name of await readdir(outDir)) {
  if (name.endsWith('.webp') && !/\.\d{4}\.webp$/.test(name) && ![...crests.values()].some(crest => `${crest.file}.webp` === name)) {
    await rm(path.join(outDir, name));
  }
}

// ---- Outputs ----

const byId = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const nameOf = new Map(clubs.map(club => [club.id, club.name]));
const tsv = [
  '# Club crests in this folder: GENERATED by scripts/sync-club-logos.mjs from English Wikipedia and Wikimedia Commons',
  '# (some from another language\'s Wikipedia, where only that Wikipedia has the club\'s crest of today).',
  '# Crests are the clubs\' trademarks. Most are non-free files that Wikipedia hosts under its non-free content policy;',
  '# each row names the file, its licence as Wikipedia records it, and its file page. A club sharing another\'s file says so.',
  ['club', 'name', 'image', 'file', 'licence', 'non-free', 'file page'].join('\t'),
  ...[...crests].sort(([a], [b]) => byId(a, b)).map(([id, crest]) => [id, crest.label ?? nameOf.get(id), `${crest.file}.webp`, crest.name,
    crest.info.licence, crest.info.nonFree ? 'yes' : 'no', crest.info.page].join('\t')),
];
await writeFile(path.join(outDir, 'SOURCES.tsv'), tsv.join('\n') + '\n');

const own = [...crests].filter(([id, crest]) => crest.file === id && !domesticById.has(id)).map(([id]) => id).sort(byId);
const shared = Object.fromEntries([...crests].filter(([id, crest]) => crest.file !== id).map(([id, crest]) => [id, crest.file]).sort(([a], [b]) => byId(a, b)));
const perNation = {};
for (const [id] of crests) {
  const club = domesticById.get(id);
  if (club) (perNation[club.nation] ||= []).push(club.fm);
}
const nationLines = Object.keys(perNation).sort(byId).map(nation => `  '${nation}': '${perNation[nation].sort((a, b) => a - b).join(' ')}',`);
await writeFile(moduleFile, `// GENERATED by scripts/sync-club-logos.mjs; do not edit. Run \`npm run sync:club-logos\` to refresh.
//
// Clubs with a crest in public/club-logos/ (sources and licences: public/club-logos/SOURCES.tsv).
// A club with a crest shows it wherever a nation shows its flag; the rest keep their monogram.

// All-leagues and women's football clubs that share their domestic twin's file.
const SHARED = JSON.parse('${JSON.stringify(shared)}');
// Other clubs with a file of their own.
const OWN = new Set('${own.join(' ')}'.split(' '));
// Domestic clubs ('d<nation>-<FM club id>') with a crest, by nation.
const DOMESTIC = {
${nationLines.join('\n')}
};
const domestic = new Map();
const DOMESTIC_ID = /^d([0-9A-Za-z]+)-(\\d+)$/;

/** The crest file a club uses ('<club id>' of public/club-logos/<club id>.webp), or null. */
export function clubLogoFile(id) {
  if (SHARED[id]) return SHARED[id];
  if (OWN.has(id)) return id;
  const match = DOMESTIC_ID.exec(id ?? '');
  if (!match || !DOMESTIC[match[1]]) return null;
  if (!domestic.has(match[1])) domestic.set(match[1], new Set(DOMESTIC[match[1]].split(' ')));
  return domestic.get(match[1]).has(match[2]) ? id : null;
}

/** A club's crest URL, or null when it has none (it keeps its monogram). */
export function clubLogoUrl(id) {
  const file = clubLogoFile(id);
  return file ? \`\${import.meta.env.BASE_URL}club-logos/\${file}.webp\` : null;
}
`);
if (pinning) {
  const answers = Object.fromEntries(Object.entries(read).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(pinsFile, `${JSON.stringify({
    note: 'The English Wikipedia API answers scripts/sync-club-logos.mjs reads, each from its cache file data-src/club-logos/enwiki-<key>.json.gz, '
      + 'where the key is the SHA-1 of the request URL, and each pinned by the SHA-256 of its JSON. en.wikipedia.org/w/api.php is disallowed by '
      + 'its robots.txt for every agent, so the sync never asks it again: these answers are the only source of the lead images and file details. '
      + 'Written by npm run sync:club-logos -- --pin.',
    answers,
  }, null, 2)}\n`);
  console.log(`Pinned ${Object.keys(answers).length} Wikipedia answers in ${path.relative(root, pinsFile)}`);
}

// ---- Report ----

const count = list => list.filter(club => crests.has(club.id)).length;
const worldClubs = clubs.filter(club => club.id.startsWith('f-')), nbaClubs = clubs.filter(club => club.id.startsWith('b-'));
const nflClubs = clubs.filter(club => club.id.startsWith('nfl-')), mlbClubs = clubs.filter(club => club.id.startsWith('mlb-'));
const nhlClubs = clubs.filter(club => club.id.startsWith('nhl-')), womensClubs = clubs.filter(club => club.id.startsWith('w-'));
const nrlClubs = clubs.filter(club => club.id.startsWith('nrl-'));
const cfbClubs = clubs.filter(club => club.id.startsWith('cfb-'));
const euroleagueClubs = clubs.filter(club => club.id.startsWith('el-'));
const rugbyUnionClubs = clubs.filter(club => club.id.startsWith('ru-'));
console.log(`Crests: ${crests.size} of ${clubs.length} clubs`);
console.log(`  all-leagues football ${count(worldClubs)}/${worldClubs.length}, NBA ${count(nbaClubs)}/${nbaClubs.length}, NFL ${count(nflClubs)}/${nflClubs.length}, MLB ${count(mlbClubs)}/${mlbClubs.length}, NHL ${count(nhlClubs)}/${nhlClubs.length}, NRL ${count(nrlClubs)}/${nrlClubs.length}, EuroLeague ${count(euroleagueClubs)}/${euroleagueClubs.length}, college football ${count(cfbClubs)}/${cfbClubs.length}, rugby union ${count(rugbyUnionClubs)}/${rugbyUnionClubs.length}, women's ${count(womensClubs)}/${womensClubs.length}, domestic ${count(domestic)}/${domestic.length}`);
console.log(`  domestic clubs with a Wikidata item: ${domestic.filter(club => club.qid).length}`);
for (const [reason, list] of Object.entries(rejected)) console.log(`  rejected (${reason}): ${list.length}${list.length <= 12 ? '\n    ' + list.join('\n    ') : ''}`);
const missing = [...worldClubs, ...nbaClubs, ...nflClubs, ...mlbClubs, ...nhlClubs, ...nrlClubs, ...euroleagueClubs, ...cfbClubs, ...rugbyUnionClubs, ...womensClubs].filter(club => !crests.has(club.id));
if (missing.length) console.log(`  all-leagues, NBA, NFL, MLB, NHL, NRL, EuroLeague, college football, rugby union and women's clubs without a crest:\n    ${missing.map(club => `${club.id} (${club.qid || 'no item'})`).join('\n    ')}`);
// (--pages looks up no item, so it has no problems of its own to report.)
if (!pagesOnly) for (const problem of problems) console.log(`  ${problem}`);
for (const [id, { crest }] of pageCrests) console.log(`  ${id}: ${crest.name} (${crest.info.licence}${crest.info.nonFree ? ', non-free' : ''}), from its file page ${crest.info.page}`);
const sizes = await Promise.all([...new Set([...crests.values()].map(crest => crest.file))].map(async file => (await readFile(path.join(outDir, `${file}.webp`))).length));
console.log(`  ${sizes.length} files, ${(sizes.reduce((a, b) => a + b, 0) / 1048576).toFixed(1)} MB, module ${(Buffer.byteLength(await readFile(moduleFile, 'utf8')) / 1024).toFixed(1)} KB`);
