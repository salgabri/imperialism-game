// Club crests for every club the game ships: the all-leagues football layer, the NBA and
// NFL franchises and every country's domestic clubs. A club with a crest shows it wherever
// a nation shows its flag; a club without one keeps its monogram chip.
//
// Usage:
//   node scripts/sync-club-logos.mjs [--refresh]
//     --refresh  ask Wikidata and Wikipedia again (downloaded images stay cached)
//
// Sources (cached under the gitignored data-src/club-logos/, so reruns are offline):
//   - Each club's Wikidata item (CC0). Domestic clubs reuse the item their home town came
//     from (scripts/data/domestic/<nation>.json, location.source "wikidata:Q..", or location.qid); an
//     all-leagues club takes the item of its domestic twin, the club of its country whose
//     FM26 squad shares the most players with its EA FC 26 lineup; NBA and NFL franchises
//     are matched by English label. scripts/data/club-logos.json overrides any of these.
//   - The crest: the lead image of the club's English Wikipedia article (its infobox
//     crest), else the item's logo image (P154) on Wikimedia Commons. Most crests are
//     non-free files on English Wikipedia; SOURCES.tsv records each file and its licence.
//   - The file's 250px thumbnail from upload.wikimedia.org, trimmed and saved as WebP
//     fitting 128x128.
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
import { CLUBS as FOOTBALL_CLUBS } from '../src/data/clubs.football.js';
import { CLUBS as BASKETBALL_CLUBS } from '../src/data/clubs.basketball.js';
import { CLUBS as NFL_CLUBS } from '../src/data/clubs.american-football.js';
import { cachedGz, createLimiter } from './lib/domestic-sync.mjs';
import { norm } from './lib/domestic-locate.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, 'data-src/club-logos');
const outDir = path.join(root, 'public/club-logos');
const moduleFile = path.join(root, 'src/data/clubLogos.js');
const overridesFile = path.join(root, 'scripts/data/club-logos.json');
const refresh = process.argv.includes('--refresh');

const USER_AGENT = 'imperialism-game-build/1.0 (https://github.com/salgabri/imperialism-game; club crest sync)';
const SPARQL = 'https://query.wikidata.org/sparql';
const ENWIKI = 'https://en.wikipedia.org/w/api.php';
const NBA = 'Q155223', BASKETBALL_TEAM = 'Q13393265';
const NFL = 'Q1215884', AMERICAN_FOOTBALL_TEAM = 'Q17156793';
const THUMB_WIDTH = 250; // one of Wikimedia's standard thumbnail steps
const BOX = 128; // a crest fits this square: twice the largest mark the game draws (60px)
// The fewest lineup players an all-leagues club must share with a domestic club to be its twin.
const MIN_SHARED = 4;
const LOGO_NAME = /logo|crest|badge|escudo|emblem|wappen|stemma|scudo|blason|herb|insignia|s[ií]mbolo|embleem|logotip/i;
const PHOTO_NAME = /stadi|estadio|arena|\d{4}-\d{2}-\d{2}|photo|foto|kit|jersey|shirt|players|squad|team ?picture|vs\.? /i;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha1 = text => createHash('sha1').update(text).digest('hex');
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
      const response = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...(init.headers || {}) }, signal: AbortSignal.timeout(120000) });
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

/** Run one SPARQL query, cached by its text. → bindings, each value flattened to a string. */
async function sparql(query) {
  return cachedGz(path.join(cacheDir, `wikidata-${sha1(query)}.json.gz`), refresh, async () => {
    const data = await getJson(SPARQL, { method: 'POST', body: 'query=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' } });
    return data.results.bindings.map(row => Object.fromEntries(Object.entries(row).map(([key, cell]) => [key, cell.value])));
  });
}

/** One English Wikipedia API query (GET parameters), cached. */
async function enwiki(params) {
  const url = `${ENWIKI}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  return cachedGz(path.join(cacheDir, `enwiki-${sha1(url)}.json.gz`), refresh, () => getJson(url));
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

/** An all-leagues club's domestic twin: the club of its country sharing the most lineup players. */
function twinOf(club, domestic) {
  const lineup = new Set(club.squad.map(player => surname(player[0])));
  let best = null;
  for (const candidate of domestic) {
    if (candidate.nation !== club.country) continue;
    const shared = new Set(candidate.squad.map(player => surname(player[1])).filter(name => lineup.has(name))).size;
    if (!best || shared > best.shared) best = { club: candidate, shared };
  }
  return best && best.shared >= MIN_SHARED ? best : null;
}

/** A league's current franchises by English label: the NBA's, or (`league`, `kind`) the NFL's. */
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

async function crestWebp(bytes) {
  const trimmed = await sharp(bytes).ensureAlpha().trim({ threshold: 8 }).toBuffer().catch(() => bytes);
  return sharp(trimmed).resize(BOX, BOX, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 86, alphaQuality: 100, effort: 6 }).toBuffer();
}

// ---- Main ----

const overrides = existsSync(overridesFile) ? JSON.parse(await readFile(overridesFile, 'utf8')) : {};
const itemOverrides = overrides.items || {}, fileOverrides = overrides.files || {};

const domestic = await domesticClubs();
const domesticById = new Map(domestic.map(club => [club.id, club]));
const nba = await leagueItems();
const nfl = await leagueItems(NFL, AMERICAN_FOOTBALL_TEAM);
const clubs = []; // { id, name, qid, twin? }
const problems = [];

for (const club of domestic) clubs.push({ id: club.id, name: club.name, qid: club.qid });
for (const club of FOOTBALL_CLUBS) {
  const twin = itemOverrides[club.id] ? null : twinOf(club, domestic);
  if (!twin && !itemOverrides[club.id]) problems.push(`${club.id}: no domestic twin (add it to ${path.relative(root, overridesFile)} "items")`);
  clubs.push({ id: club.id, name: club.name, qid: twin?.club.qid ?? null, twin: twin?.club.id ?? null });
}
for (const [league, items, list] of [['NBA', nba, BASKETBALL_CLUBS], ['NFL', nfl, NFL_CLUBS]]) for (const club of list) {
  const qid = items.get(club.name) || null;
  if (!qid && !itemOverrides[club.id]) problems.push(`${club.id}: no ${league} item labelled "${club.name}"`);
  clubs.push({ id: club.id, name: club.name, qid });
}
for (const [id, qid] of Object.entries(itemOverrides)) {
  const club = clubs.find(entry => entry.id === id);
  if (!club) throw new Error(`club-logos.json names unknown club ${id}`);
  club.qid = qid;
  club.twin = null;
}

const qids = [...new Set(clubs.map(club => club.qid).filter(Boolean))].sort();
const facts = await itemFacts(qids);
const leads = await leadImages([...facts.values()].map(fact => fact.article).filter(Boolean));
const candidatesOf = club => {
  if (club.id in fileOverrides) return fileOverrides[club.id] ? [{ name: fileName(fileOverrides[club.id]), from: 'override' }] : [];
  const fact = club.qid ? facts.get(club.qid) : null;
  return [
    fact?.article && leads.get(fact.article) ? { name: leads.get(fact.article), from: 'enwiki' } : null,
    fact?.p154 ? { name: fact.p154, from: 'p154' } : null,
  ].filter(Boolean).filter((c, i, all) => all.findIndex(other => other.name === c.name) === i);
};
const infos = await fileInfo(clubs.filter(club => !club.twin).flatMap(club => candidatesOf(club).map(c => c.name)));

await mkdir(outDir, { recursive: true });
const crests = new Map(); // club id -> { file id, name, info, from }
const rejected = {};
let done = 0;
// Eight clubs at a time: thousands of file reads and sharp jobs at once fill libuv's thread pool, and a download's
// DNS lookup, which needs that pool too, then waits behind them until it times out.
const work = createLimiter(8, 0);
await Promise.all(clubs.filter(club => !club.twin).map(club => work(async () => {
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
    const target = path.join(outDir, `${club.id}.webp`);
    if (!existsSync(target) || !webp.equals(await readFile(target))) await writeFile(target, webp);
    crests.set(club.id, { file: club.id, name: candidate.name, info, from: candidate.from });
    break;
  }
  if (++done % 500 === 0) console.log(`  ${done} clubs checked`);
})));
for (const club of clubs.filter(entry => entry.twin && crests.has(entry.twin))) crests.set(club.id, { ...crests.get(club.twin), file: club.twin });

// Files of clubs that no longer have a crest go.
for (const name of await readdir(outDir)) {
  if (name.endsWith('.webp') && ![...crests.values()].some(crest => `${crest.file}.webp` === name)) await rm(path.join(outDir, name));
}

// ---- Outputs ----

const byId = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const nameOf = new Map(clubs.map(club => [club.id, club.name]));
const tsv = [
  '# Club crests in this folder: GENERATED by scripts/sync-club-logos.mjs from English Wikipedia and Wikimedia Commons.',
  '# Crests are the clubs\' trademarks. Most are non-free files that Wikipedia hosts under its non-free content policy;',
  '# each row names the file, its licence as Wikipedia records it, and its file page. A club sharing another\'s file says so.',
  ['club', 'name', 'image', 'file', 'licence', 'non-free', 'file page'].join('\t'),
  ...[...crests].sort(([a], [b]) => byId(a, b)).map(([id, crest]) => [id, nameOf.get(id), `${crest.file}.webp`, crest.name,
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

// All-leagues football clubs that share their domestic twin's file.
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

// ---- Report ----

const count = list => list.filter(club => crests.has(club.id)).length;
const worldClubs = clubs.filter(club => club.id.startsWith('f-')), nbaClubs = clubs.filter(club => club.id.startsWith('b-'));
const nflClubs = clubs.filter(club => club.id.startsWith('nfl-'));
console.log(`Crests: ${crests.size} of ${clubs.length} clubs`);
console.log(`  all-leagues football ${count(worldClubs)}/${worldClubs.length}, NBA ${count(nbaClubs)}/${nbaClubs.length}, NFL ${count(nflClubs)}/${nflClubs.length}, domestic ${count(domestic)}/${domestic.length}`);
console.log(`  domestic clubs with a Wikidata item: ${domestic.filter(club => club.qid).length}`);
for (const [reason, list] of Object.entries(rejected)) console.log(`  rejected (${reason}): ${list.length}${list.length <= 12 ? '\n    ' + list.join('\n    ') : ''}`);
const missing = [...worldClubs, ...nbaClubs, ...nflClubs].filter(club => !crests.has(club.id));
if (missing.length) console.log(`  all-leagues, NBA and NFL clubs without a crest:\n    ${missing.map(club => `${club.id} (${club.qid || 'no item'})`).join('\n    ')}`);
for (const problem of problems) console.log(`  ${problem}`);
const sizes = await Promise.all([...new Set([...crests.values()].map(crest => crest.file))].map(async file => (await readFile(path.join(outDir, `${file}.webp`))).length));
console.log(`  ${sizes.length} files, ${(sizes.reduce((a, b) => a + b, 0) / 1048576).toFixed(1)} MB, module ${(Buffer.byteLength(await readFile(moduleFile, 'utf8')) / 1024).toFixed(1)} KB`);
