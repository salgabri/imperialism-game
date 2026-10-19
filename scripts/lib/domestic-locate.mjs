// Home towns for domestic clubs, layered and cached:
//   1. manual overrides (scripts/data/domestic-locations.json, keyed by FM clubId),
//   2. Wikidata association football clubs of the country (CC0),
//   3. GeoNames cities1000 town-in-name (CC BY 4.0).
// Only lon/lat are produced here; boundary checks happen in build-domestic.mjs.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { cachedGz, createLimiter, fetchText } from './domestic-sync.mjs';

const SPARQL = 'https://query.wikidata.org/sparql';
const GEONAMES = 'https://download.geonames.org/export/dump';
const FOOTBALL_CLUB = 'Q476028';
// Multi-sport clubs (San Lorenzo, Platense, Norwegian idrettslag, ...) are typed "sports club"
// with sport = association football rather than as football clubs.
const SPORTS_CLUB = 'Q847017', FOOTBALL = 'Q2736';
const KOSOVO = { qid: 'Q1246', a2: 'XK', langs: ['sq', 'sr'] };
// Countries whose clubs carry another P17 than the ISO-numeric item: the Kingdom of the
// Netherlands (Q29999) holds 528, Dutch clubs say Netherlands (Q55).
const COUNTRY_EXTRA = { '528': ['Q55'] };
// Regional languages that carry club names but are not national official languages in Wikidata.
const EXTRA_LANGS = { '724': ['ca', 'eu', 'gl'], '070': ['bs', 'hr', 'sr', 'sh'], '499': ['sr', 'sh'], '688': ['sh'], '756': ['de'], '056': ['nl'] };
const GERMAN_ADJECTIVES = new Set(['276', '040', '756']);
const WOMEN = /\b(?:women|ladies|w\.?f\.?c|l\.?f\.?c|cff|femenino|feminino|femenil|femminile|f[eé]minine?s?|frauen|damen|kvinner|kvinnor|naiset)\b/i;

// Brazilian state abbreviations as FM writes them, e.g. "Botafogo (SP)".
const BR_STATES = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapa', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceara', DF: 'Federal District',
  ES: 'Espirito Santo', GO: 'Goias', MA: 'Maranhao', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais', PA: 'Para', PB: 'Paraiba', PR: 'Parana', PE: 'Pernambuco', PI: 'Piaui',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondonia', RR: 'Roraima',
  SC: 'Santa Catarina', SP: 'Sao Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

// ---- Name normalisation ----

// Letters NFD does not decompose (Icelandic, Nordic, Polish, Turkish, ...).
const LETTERS = { 'ð': 'd', 'þ': 'th', 'æ': 'ae', 'ø': 'o', 'œ': 'oe', 'ß': 'ss', 'ł': 'l', 'đ': 'd', 'ı': 'i', 'ħ': 'h', 'ŧ': 't', 'ŋ': 'ng', 'ə': 'e' };
// FM abbreviations written with a dot ("Sta. Eulalia", "Vit. Setúbal", "Atl. Tucumán").
const ABBREVIATIONS = { sta: 'santa', sto: 'santo', sp: 'sporting', vit: 'vitoria', atl: 'atletico', dep: 'deportivo', gral: 'general',
  alte: 'almirante', def: 'defensores', juv: 'juventud', ac: 'academico', est: 'estudiantes', ind: 'independiente', nac: 'nacional' };
export const norm = s => String(s || '').toLowerCase().replace(/[ðþæøœßłđıħŧŋə]/g, c => LETTERS[c])
  .normalize('NFD').replace(/\p{M}/gu, '').replace(/\([^)]*\)/g, ' ')
  .replace(/\b([a-z]+)\./g, (m, word) => ABBREVIATIONS[word] ? ABBREVIATIONS[word] + ' ' : m)
  .replace(/&/g, ' and ').replace(/[.'’`´]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const STOP = new Set(('fc afc cf sc cd ud sd rcd ca club clube de del la el los las le du des futbol football futebol fussball f c '
  + 'esporte e do da dos das di y and of the associacao atletica atletico athletic sport sports sporting sociedade ec esportiva esportivo '
  + 'fk sv vfl vfb tsv ev ac as ss us ssd asd sad cp sl lda ltda balompie rc calcio s a d gd cdf ad cs ks nk sk bk if ik '
  + 'futbolowy klub kulubu spor jk sa ltd plc deportivo deportiva desportivo desportiva recreativo recreativa regatas foot ball agremiacao sportiva sportivo pd '
  + 'knattspyrnufelag knattspyrnufelagid knattspyrnudeild ithrottafelag ithrottafelagid ithrottabandalag ungmennafelag '
  + 'ungmennafelagid fimleikafelag handknattleiksfelag boltafelag umf').split(' '));
const core = s => norm(s).split(' ').filter(t => t && !STOP.has(t) && !/^\d+$/.test(t));

// Single words that are also place names somewhere but never identify a club's town.
const GENERIC = new Set(('real united city town athletic athletico atletico atletica sporting sport club union nacional national '
  + 'international rovers wanderers albion county rangers celtic olympic olympique olimpia olympia racing dynamo dinamo '
  + 'juventud juventus independiente estudiantes victoria vitoria progreso defensores unidos central sociedad stars star '
  + 'borough villa park palace forest harriers argyle alexandra santa san sao santo saint st nova novo nueva nuevo '
  + 'america brasil hope liberty concordia flamengo palmeiras botafogo fluminense cruzeiro guarani guarany vasco gremio '
  + 'internacional portuguesa nautico avai ferroviario ferroviaria operario river boca platense colon huracan velez '
  + 'esperanca esperanza aurora fortuna eintracht borussia viktoria alemannia preussen arminia germania wacker kickers libertad '
  + 'rot weiss blau gelb grun schwarz mineiro pallo '
  // Slavic "old/new/upper/lower/big/small", which alone name no town ("Stari" is also Kaštel Stari).
  + 'stari stara staro stary nowy nowa novi novy gornji gornja gornje donji donja donje veliki velika veliko mali mala malo horni dolni').split(' '));

const SAINTS = new Set('san santa santo sao saint sainte st ste sankt'.split(' '));
const OF = new Set('de do da del di'.split(' '));

// ---- Wikidata ----

export function createWikidata({ cacheDir, refresh = false }) {
  const limit = createLimiter(1, 1000);
  const dir = path.join(cacheDir, 'wikidata');
  let requests = 0;
  const sparql = query => limit(async () => {
    // A server-side timeout arrives as HTTP 200 with an error appended to the JSON, so parse failures retry too.
    for (let attempt = 0; ; attempt++) {
      requests++;
      const text = await fetchText(SPARQL, {
        method: 'POST', body: 'query=' + encodeURIComponent(query), timeout: 180000,
        headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      try {
        return JSON.parse(text).results.bindings.map(b => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
      } catch (error) {
        if (attempt >= 2) throw new Error(`Wikidata query failed: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));
      }
    }
  });
  const cached = (name, query) => cachedGz(path.join(dir, `${name}.json.gz`), refresh, async () => ({ query, fetchedAt: new Date().toISOString(), rows: await sparql(query) }));

  async function country(numericId) {
    const found = await countryItem(numericId);
    if (!found) return null;
    const qids = [found.qid, ...(COUNTRY_EXTRA[numericId] || [])];
    // The country's own point: a club whose HQ or located-in is just "the country" carries it.
    const query = `SELECT ?c ?coord WHERE { VALUES ?c { ${qids.map(q => `wd:${q}`).join(' ')} } ?c wdt:P625 ?coord }`;
    const { rows } = await cached(`${found.qid}-centre-${hash(query)}`, query);
    return { ...found, qids, centres: rows.map(row => point(row.coord)).filter(Boolean) };
  }

  async function countryItem(numericId) {
    if (numericId === 'KOS') return KOSOVO;
    const { rows } = await cachedGz(path.join(dir, 'countries.json.gz'), false, async () => {
      const query = `SELECT ?c ?num ?a2 ?sl (GROUP_CONCAT(DISTINCT ?code; separator=",") AS ?langs) WHERE {
  ?c wdt:P299 ?num ; wdt:P297 ?a2 ; wikibase:sitelinks ?sl .
  OPTIONAL { ?c wdt:P37/wdt:P424 ?code }
} GROUP BY ?c ?num ?a2 ?sl`;
      return { query, fetchedAt: new Date().toISOString(), rows: await sparql(query) };
    });
    const row = rows.filter(r => r.num === numericId).sort((a, b) => +b.sl - +a.sl)[0];
    if (!row) return null;
    const langs = row.langs ? row.langs.split(',').flatMap(code => [code, code.split('-')[0]]) : [];
    return { qid: qidOf(row.c), a2: row.a2, langs: [...new Set(langs)] };
  }

  const coordsQuery = values => `SELECT ?club (SAMPLE(?ven) AS ?venue) (SAMPLE(?p625) AS ?coord) (SAMPLE(?hq) AS ?hqCoord) (SAMPLE(?loc) AS ?p131Coord) (MAX(?sl) AS ?sitelinks) (SAMPLE(?end) AS ?dissolved) WHERE {
  ${values}
  OPTIONAL { ?club wdt:P115/wdt:P625 ?ven }
  OPTIONAL { ?club wdt:P625 ?p625 }
  OPTIONAL { ?club wdt:P159/wdt:P625 ?hq }
  OPTIONAL { ?club wdt:P131/wdt:P625 ?loc }
  OPTIONAL { ?club wikibase:sitelinks ?sl }
  OPTIONAL { ?club wdt:P576 ?end }
} GROUP BY ?club`;

  /** Football clubs (and football-playing sports clubs) of one country: coordinates and names (label/alias, chosen languages). */
  async function clubs(qids, langs) {
    const qid = qids[0];
    const p17 = qids.length > 1 ? `wdt:P17 ?country . VALUES ?country { ${qids.map(q => `wd:${q}`).join(' ')} }` : `wdt:P17 wd:${qid} .`;
    // Labels and coordinates in one query time out, and OPTIONALs must follow the main pattern.
    const coordsText = coordsQuery(`?club wdt:P31/wdt:P279* wd:${FOOTBALL_CLUB} ; ${p17}`);
    const coords = await cached(`${qid}-coords-${hash(coordsText)}`, coordsText);
    const sportsText = coordsQuery(`?club wdt:P31 wd:${SPORTS_CLUB} ; wdt:P641 wd:${FOOTBALL} ; ${p17}`);
    const sports = await cached(`${qid}-sports-${hash(sportsText)}`, sportsText);
    const langList = [...new Set(['en', 'mul', ...langs])].sort();
    // Names by explicit item lists: the class-path query plus labels times out for large countries.
    // Football clubs and the extra sports clubs are listed separately so each list stays cached.
    const byNumber = (a, b) => +a.slice(1) - +b.slice(1);
    const ids = [...new Set(coords.rows.map(row => qidOf(row.club)))].sort(byNumber);
    const known = new Set(ids);
    const extraRows = sports.rows.filter(row => !known.has(qidOf(row.club)));
    const extraIds = [...new Set(extraRows.map(row => qidOf(row.club)))].sort(byNumber);
    const names = [];
    let fetchedAt = [coords.fetchedAt, sports.fetchedAt].sort().at(-1);
    for (const list of [ids, extraIds]) {
      for (let i = 0; i < list.length; i += 300) {
        const query = `SELECT ?club ?name ?k ?lang WHERE {
  VALUES ?club { ${list.slice(i, i + 300).map(id => `wd:${id}`).join(' ')} }
  { ?club rdfs:label ?name BIND("l" AS ?k) } UNION { ?club skos:altLabel ?name BIND("a" AS ?k) }
  BIND(LANG(?name) AS ?lang)
  FILTER(?lang IN (${langList.map(l => `"${l}"`).join(',')}))
}`;
        const chunk = await cached(`${qid}-names-${hash(query)}`, query);
        names.push(...chunk.rows);
        if (chunk.fetchedAt > fetchedAt) fetchedAt = chunk.fetchedAt;
      }
    }
    return { coords: [...coords.rows, ...extraRows], names, fetchedAt, langs: langList, sportsClubs: extraIds.length };
  }

  /** Coordinates for explicit QIDs (manual overrides outside the country query). */
  async function items(qids) {
    const out = [];
    for (const qid of [...qids].sort()) {
      const query = coordsQuery(`VALUES ?club { wd:${qid} }`);
      const { rows } = await cached(`item-${qid}-${hash(query)}`, query);
      out.push(...rows);
    }
    return out;
  }

  return { country, clubs, items, stats: () => ({ requests }) };
}

const qidOf = uri => uri.split('/').pop();
const hash = text => createHash('sha1').update(text).digest('hex').slice(0, 16);
const point = wkt => {
  const m = wkt && wkt.match(/Point\(([-\d.eE]+) ([-\d.eE]+)\)/);
  return m ? [+m[1], +m[2]] : null;
};

/** Coordinates of a Wikidata row in priority order: venue > own P625 > headquarters > located-in. */
function coordsOf(row) {
  const out = [];
  for (const [field, via] of [['venue', 'P115'], ['coord', 'P625'], ['hqCoord', 'P159'], ['p131Coord', 'P131']]) {
    const p = point(row[field]);
    if (p && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90 && Math.abs(p[0]) <= 180) out.push({ lon: p[0], lat: p[1], via });
  }
  return out;
}

// A Wikidata point farther than this from every GeoNames town of the country is a wrong
// venue, a swapped lat/lon or a foreign item; the next property (or candidate) is used.
const MAX_TOWN_KM = 50;
// How near a weak namesake match must lie to the town in the club's name.
const NAMESAKE_KM = 15;

// ---- GeoNames ----

export async function ensureGeonames(cacheDir, refresh = false) {
  const dir = path.join(cacheDir, 'geonames');
  await mkdir(dir, { recursive: true });
  const cities = path.join(dir, 'cities1000.txt');
  if (refresh || !existsSync(cities)) {
    const zip = new Uint8Array(Buffer.from(await fetchBinary(`${GEONAMES}/cities1000.zip`)));
    const files = unzipSync(zip, { filter: file => file.name === 'cities1000.txt' });
    if (!files['cities1000.txt']) throw new Error('cities1000.zip has no cities1000.txt');
    await atomicWrite(cities, files['cities1000.txt']);
  }
  const admin1 = path.join(dir, 'admin1CodesASCII.txt');
  if (refresh || !existsSync(admin1)) await atomicWrite(admin1, await fetchText(`${GEONAMES}/admin1CodesASCII.txt`));
  return { cities, admin1 };
}

async function fetchBinary(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'imperialism-game-build/1.0 (offline data build)' }, signal: AbortSignal.timeout(600000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.arrayBuffer();
    } catch (error) {
      if (attempt === 3) throw new Error(`${url}: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 2000 * 2 ** attempt));
    }
  }
}

async function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

let citiesText = null;
const admin1Names = new Map();

/** GeoNames places of one country (feature class P), optionally one admin1 code. */
export async function loadPlaces(files, a2) {
  citiesText ??= await readFile(files.cities, 'utf8');
  if (!admin1Names.size) {
    for (const line of (await readFile(files.admin1, 'utf8')).split('\n')) {
      const [code, name, ascii] = line.split('\t');
      if (code) admin1Names.set(code, ascii || name);
    }
  }
  const places = [];
  for (const line of citiesText.split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    if (f[8] !== a2 || f[6] !== 'P') continue;
    places.push({ id: +f[0], name: f[1], ascii: f[2], alt: f[3], lat: +f[4], lon: +f[5], admin1: f[10], pop: +f[14] || 0 });
  }
  return places.sort((a, b) => a.id - b.id);
}

// cities1000 also lists hamlets without a population whose alternate names are province
// or common words ("Yanbian", "Gilan", "Lam"), so only populated places lend alternate names.
const ALT_MIN_POP = 1;
// A place's own name beats other places' alternate names ("Gheorghe Doja" is not George
// Enescu) unless it has no population figure (the Trostianets hamlet, not the town written
// Trostyanets) or the other is a far bigger city. A shortened alternate name ("Câmpulung" for
// Câmpulung Moldovenesc, "Weißkirchen" for Weißkirchen in Steiermark) loses to any full name,
// unless it is a far bigger city (Frankfurt for Frankfurt am Main, not Frankfurt (Oder)).
const BIG_CITY_POP = 100000, BIG_CITY_RATIO = 5;

const nameOk = n => n && !/\d/.test(n) && !/^[A-Z]{2,4}$/.test(n);
const morePopulous = (a, b) => !b || a.pop > b.pop || (a.pop === b.pop && a.id < b.id);

/** Normalised names of a place: own (name, ascii), full alternate and shortened alternate. */
function placeNames(place) {
  const own = new Set([place.name, place.ascii].filter(nameOk).map(norm).filter(n => n.length >= 3));
  const ownWords = new Set([...own].flatMap(n => n.split(' ')));
  const alt = new Set(), short = new Set();
  if (place.pop >= ALT_MIN_POP && place.alt) {
    for (const n of place.alt.split(',').filter(nameOk).map(norm)) {
      if (n.length < 3 || own.has(n)) continue;
      (n.split(' ').every(t => ownWords.has(t)) ? short : alt).add(n);
    }
  }
  return { own, alt, short };
}

/** name -> { place, short }: the most populous place of that full name, else of that shortened name. */
function placeIndex(places) {
  const tiers = { own: new Map(), alt: new Map(), short: new Map() };
  for (const place of places) {
    const names = placeNames(place);
    for (const tier of ['own', 'alt', 'short']) for (const n of names[tier]) if (morePopulous(place, tiers[tier].get(n))) tiers[tier].set(n, place);
  }
  const big = (place, current) => place.pop >= BIG_CITY_POP && place.pop >= BIG_CITY_RATIO * current.pop;
  const index = new Map([...tiers.own].map(([n, place]) => [n, { place, short: false }]));
  for (const [n, place] of tiers.alt) {
    const current = index.get(n)?.place;
    if (!current || (current.pop === 0 && place.pop > 0) || big(place, current)) index.set(n, { place, short: false });
  }
  for (const [n, place] of tiers.short) {
    const current = index.get(n)?.place;
    if (!current || big(place, current)) index.set(n, { place, short: true });
  }
  return index;
}

/** name -> every place carrying that full name (namesake towns all count; shortened names do not). */
function namesakeIndex(places) {
  const out = new Map();
  for (const place of places) {
    const names = placeNames(place);
    for (const n of new Set([...names.own, ...names.alt])) {
      if (!out.has(n)) out.set(n, []);
      out.get(n).push(place);
    }
  }
  return out;
}

// Province suffixes dropped before matching admin1 names against club names and competitions.
// "Kyiv City" and "Kyiv Oblast" both become "kyiv", so a Kyiv club may lie in either.
const ADMIN_SUFFIX = /\s+(?:autonomous district|autonomous region|province|region|oblast|governorate|state|prefecture|department|county|district|voivodeship|krai|kray|republic|municipality|canton|city|capital|f d)$/;

/**
 * admin1 matcher for one country: texts -> { codes: Set of admin1 codes, name } for the province
 * named in them (longest name wins), or null.
 * Country names are masked first ("Chinese Taipei League" names no Taipei), and a province
 * name inside a longer town name is no province ("Nizhniy Novgorod" is not Novgorod Oblast).
 */
function provinceMatcher(a2, excluded, isTown) {
  const byName = new Map();
  for (const [code, name] of admin1Names) {
    if (!code.startsWith(a2 + '.')) continue;
    const n = norm(name).replace(ADMIN_SUFFIX, '');
    if (n.length < 4 || excluded.has(n)) continue;
    if (!byName.has(n)) byName.set(n, new Set());
    byName.get(n).add(code.slice(a2.length + 1));
  }
  const countries = [...excluded].map(c => c.split(' '));
  const named = (tokens, n) => {
    const len = n.split(' ').length;
    const inCountry = i => countries.some(c => {
      for (let j = Math.max(0, i + len - c.length); j <= i; j++) if (tokens.slice(j, j + c.length).join(' ') === c.join(' ')) return true;
      return false;
    });
    for (let i = 0; i + len <= tokens.length; i++) {
      if (tokens.slice(i, i + len).join(' ') !== n || inCountry(i)) continue;
      let covered = false;
      for (let from = Math.max(0, i - 3); from <= i && !covered; from++) {
        for (let to = i + len; to <= Math.min(tokens.length, from + 4) && !covered; to++) {
          if (to - from > len) covered = isTown(tokens.slice(from, to).join(' '));
        }
      }
      if (!covered) return true;
    }
    return false;
  };
  return texts => {
    let best = null, bestLen = 0, tie = false;
    for (const text of texts) {
      const tokens = norm(text).split(' ');
      for (const [n, codes] of byName) {
        if (!named(tokens, n)) continue;
        const len = n.split(' ').length;
        if (len > bestLen) { best = { codes, name: n }; bestLen = len; tie = false; }
        else if (len === bestLen && best.codes !== codes) tie = true;
      }
    }
    return best && !tie ? best : null;
  };
}

const km = (a, b) => {
  const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

function nearestPlace(places, lon, lat) {
  let best = null, bestD = Infinity;
  for (const place of places) {
    const d = km([lon, lat], [place.lon, place.lat]);
    if (d < bestD) { bestD = d; best = place; }
  }
  return best ? { place: best, km: bestD } : null;
}

// ---- Matching ----

/** FM state hint "(SP)" -> GeoNames admin1 code, for Brazil only. */
function stateHint(nationId, club) {
  if (nationId !== '076') return null;
  for (const text of [club.name, club.shortName]) {
    const m = String(text || '').match(/\(([A-Z]{2})\)/);
    if (m && BR_STATES[m[1]]) {
      const code = [...admin1Names].find(([key, name]) => key.startsWith('BR.') && norm(name) === norm(BR_STATES[m[1]]));
      if (code) return { uf: m[1], admin1: code[0].slice(3) };
    }
  }
  return null;
}

/** Bracketed parts of the FM names: "San Martín (Tucumán)" -> ["Tucumán"]. */
const bracketed = club => [club.name, club.shortName].flatMap(text => [...String(text || '').matchAll(/\(([^)]+)\)/g)].map(m => m[1].trim()));

function adjectiveVariants(token) {
  if (token.length <= 5 || !token.endsWith('er')) return [token];
  return [token, token.slice(0, -2), token.slice(0, -1), token.slice(0, -2) + 'en', token.replace(/scher$/, ''), token.replace(/ner$/, 'en')];
}

/**
 * Locate clubs (already in reputation order). Returns { locations: Map clubId -> location,
 * remote, wikidata, geonames }; location = { lon, lat, source, label, via?, qid? } with
 * source 'override', 'wikidata:Q..' or 'geonames:<id>'. Unlocated clubs have no entry.
 */
export async function locateClubs({ nation, clubs, overrides, wikidata, geoFiles, region }) {
  const country = await wikidata.country(nation.id);
  if (!country) throw new Error(`No Wikidata country for ${nation.id}`);
  const a2 = region?.a2 ?? country.a2;
  const allPlaces = await loadPlaces(geoFiles, a2);
  const regionPlaces = region?.admin1 ? allPlaces.filter(p => p.admin1 === region.admin1) : allPlaces;
  // Country and province names are never a club's town ("Sporting Clube de Portugal",
  // "Jiangxi Lushan", where a Gansu hamlet is also called Jiangxi).
  const countryNames = new Set([nation.name, nation.fmName].map(norm));
  const notTown = new Set([...countryNames, ...[...admin1Names].filter(([code]) => code.startsWith(a2 + '.')).map(([, name]) => norm(name).replace(ADMIN_SUFFIX, ''))]);
  const townIndex = placeIndex(regionPlaces), namesakes = namesakeIndex(regionPlaces);
  const province = provinceMatcher(a2, countryNames, gram => townIndex.has(gram));
  const langs = [...country.langs, ...(EXTRA_LANGS[nation.id] || [])];
  const wd = await wikidata.clubs(country.qids, langs);

  // Wikidata candidate index.
  const entry = row => {
    const coords = coordsOf(row);
    return { qid: qidOf(row.club), sitelinks: +row.sitelinks || 0, coords, coord: coords[0] ?? null, dissolved: !!row.dissolved };
  };
  const info = new Map(wd.coords.map(row => [qidOf(row.club), entry(row)]));
  const labels = new Map(), women = new Set(), namesOf = new Map();
  const exact = new Map(), coreIndex = new Map(), byToken = new Map(), words = new Map();
  const add = (map, key, qid) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(qid); };
  for (const { club, name, k, lang } of [...wd.names].sort((a, b) => (a.club + a.name).localeCompare(b.club + b.name))) {
    const qid = qidOf(club);
    if (!info.has(qid)) continue;
    if (k === 'l' && WOMEN.test(name)) women.add(qid);
    if (k === 'l') { const list = labels.get(qid) || []; list.push({ lang, name }); labels.set(qid, list); }
    namesOf.set(qid, [...(namesOf.get(qid) || []), name]);
    const n = norm(name), tokens = core(name);
    for (const t of core(name.replace(/[()]/g, ' '))) add(words, qid, t);
    if (n) add(exact, n, qid);
    if (tokens.length) {
      add(coreIndex, tokens.join(' '), qid);
      for (const t of new Set(tokens)) { if (!byToken.has(t)) byToken.set(t, new Map()); byToken.get(t).set(qid, (byToken.get(t).get(qid) || []).concat([tokens])); }
    }
  }
  const labelOf = qid => {
    const list = labels.get(qid) || [];
    const pick = list.find(l => l.lang === 'en') || list.find(l => l.lang === 'mul') || list.find(l => langs.includes(l.lang)) || list[0];
    return pick?.name || qid;
  };
  const subset = text => {
    const q = core(text);
    const key = q.find(t => t.length > 1);
    if (!key) return [];
    // The club's core words must open the candidate's name: "Botafogo" fits "Botafogo de Futebol e
    // Regatas", but "Bahia" must not fit "Vitória da Bahia". FM initials ("G. Segoviana",
    // "R. Majadahonda") match any word with that first letter.
    const fits = ts => ts.length >= q.length && q.every((t, i) => ts[i] === t || (t.length === 1 && ts[i].startsWith(t)));
    const out = [];
    for (const [qid, tokenLists] of byToken.get(key) || []) if (tokenLists.some(fits)) out.push(qid);
    return out;
  };

  const placeCache = new Map();
  const placeOf = coord => {
    const key = `${coord.lon},${coord.lat}`;
    if (!placeCache.has(key)) placeCache.set(key, nearestPlace(allPlaces, coord.lon, coord.lat));
    return placeCache.get(key);
  };

  const used = new Set();
  const result = new Map();
  const round = v => Math.round(v * 1e4) / 1e4;

  // 1. Overrides (claim their QIDs first so automatic matches cannot reuse them).
  const qidOverrides = clubs.map(c => overrides[c.clubId]).filter(o => o?.qid && !info.get(o.qid)?.coord).map(o => o.qid);
  if (qidOverrides.length) for (const row of await wikidata.items(qidOverrides)) info.set(qidOf(row.club), entry(row));
  for (const club of clubs) {
    const o = overrides[club.clubId];
    if (!o) continue;
    if (Number.isFinite(o.lon) && Number.isFinite(o.lat)) {
      result.set(club.clubId, { lon: round(o.lon), lat: round(o.lat), source: 'override', label: o.note || o.name || '' });
    } else if (o.qid) {
      const c = info.get(o.qid)?.coord;
      if (!c) throw new Error(`Override ${club.clubId} -> ${o.qid} has no coordinates`);
      used.add(o.qid);
      result.set(club.clubId, { lon: round(c.lon), lat: round(c.lat), source: 'override', label: labelOf(o.qid), via: c.via, qid: o.qid });
    }
  }

  // Towns the club's names hold: 1-4-grams (and bracketed parts) that are places of the country,
  // leaving out generic club words, saints' names, country and province names.
  const townsOf = club => {
    const out = new Set(bracketed(club).map(norm).filter(n => townIndex.has(n) && !notTown.has(n)));
    for (const text of [club.name, club.shortName]) {
      const tokens = norm(text).split(' ').filter(Boolean);
      for (let len = 1; len <= Math.min(4, tokens.length); len++) {
        for (let i = 0; i + len <= tokens.length; i++) {
          const gram = tokens.slice(i, i + len).join(' ');
          if (len === 1 && (GENERIC.has(gram) || STOP.has(gram) || gram.length < 3)) continue;
          if (!SAINTS.has(tokens[i]) && !notTown.has(gram) && townIndex.has(gram)) out.add(gram);
        }
      }
    }
    return [...out];
  };

  // Does any of an item's names hold a town that none of the club's names holds?
  const clubWords = club => new Set([club.name, club.shortName].flatMap(t => norm(t).split(' ')));
  const otherTown = (qid, club) => {
    const own = clubWords(club);
    return (namesOf.get(qid) || []).some(name => townsOf({ name }).some(gram => !gram.split(' ').every(t => own.has(t))));
  };

  // 2. Wikidata, in reputation order, each QID at most once. A candidate whose names hold the
  // club's bracketed town ("San Martín (Tucumán)") outranks namesakes with more sitelinks.
  for (const club of clubs) {
    if (result.has(club.clubId)) continue;
    const hint = stateHint(nation.id, club);
    const towns = bracketed(club).map(core).filter(ts => ts.length && ts.some(t => t.length > 2));
    const agrees = qid => towns.some(ts => ts.every(t => words.get(qid)?.has(t)));
    // Towns in the club's names prefer the item's coordinate near them: a wrong venue point
    // ("Piteå IF" at an arena near Tierp) gives way to the item's next property.
    const named = townsOf(club).flatMap(gram => [...(namesakes.get(gram) || []), townIndex.get(gram).place]);
    const nearTown = (coord, limit = MAX_TOWN_KM) => named.some(place => km([place.lon, place.lat], [coord.lon, coord.lat]) <= limit);
    const quality = new Map();
    const offer = (qids, q) => { for (const qid of qids) if (!quality.has(qid) || quality.get(qid) > q) quality.set(qid, q); };
    for (const text of [club.name, club.shortName]) {
      if (!text) continue;
      // Multi-word exact or core matches are strong evidence; one-word names
      // ("Botafogo", "Sanse") and token subsets are weak and pooled by sitelinks.
      const n = norm(text), c = core(text);
      offer(exact.get(n) || [], n.includes(' ') ? 0 : 2);
      if (c.length) offer(coreIndex.get(c.join(' ')) || [], c.length > 1 ? 1 : 2);
      offer(subset(text), 2);
    }
    // Each candidate's first point that lies near a town of the country (and of the region
    // or the Brazilian state when given).
    const inside = coord => {
      const near = placeOf(coord);
      return !!near && near.km <= MAX_TOWN_KM && !country.centres.some(p => km(p, [coord.lon, coord.lat]) < 2)
        && (!region?.admin1 || near.place.admin1 === region.admin1)
        && (!hint || near.place.admin1 === hint.admin1);
    };
    const candidates = [...quality].map(([qid, q]) => ({ ...info.get(qid), q }))
      .filter(c => !used.has(c.qid) && !women.has(c.qid))
      .map(c => {
        const coords = c.coords.filter(inside);
        return { ...c, coord: coords.find(coord => nearTown(coord)) ?? coords[0], town: agrees(c.qid) };
      })
      // A weak match (one-word or subset name) whose own names hold another town is a namesake
      // club elsewhere ("Radnički (V)" is not FK Radnički Beograd): it must lie near the club's town.
      .filter(c => c.coord && !(c.q > 1 && named.length && !nearTown(c.coord, NAMESAKE_KM) && otherTown(c.qid, club)))
      .sort((a, b) => a.dissolved - b.dissolved || b.town - a.town || (a.q > 1) - (b.q > 1) || b.sitelinks - a.sitelinks || a.q - b.q || +a.qid.slice(1) - +b.qid.slice(1));
    const top = candidates[0];
    if (!top) continue;
    used.add(top.qid);
    result.set(club.clubId, { lon: round(top.coord.lon), lat: round(top.coord.lat), source: `wikidata:${top.qid}`, label: labelOf(top.qid), via: top.coord.via });
  }

  // 3. GeoNames: the bracketed town if it is a place, else the longest 1-4-gram of the club
  // name that is a place in the country. A province named in the club's names or competition
  // ("Guizhou Zhucheng", "Western Australia State League") limits the search to it; with no
  // town there the club stays unlocated (provinces reports it) rather than take a namesake.
  const indexes = new Map();
  const indexFor = admin1s => {
    const key = admin1s ? [...admin1s].sort().join(',') : '';
    if (!indexes.has(key)) indexes.set(key, admin1s ? placeIndex(regionPlaces.filter(p => admin1s.has(p.admin1))) : townIndex);
    return indexes.get(key);
  };
  const provinces = new Map();
  for (const club of clubs) {
    if (result.has(club.clubId)) continue;
    const hint = stateHint(nation.id, club);
    const named = hint ? null : province([club.name, club.shortName, club.competition?.name].filter(Boolean));
    let admin1s = hint ? new Set([hint.admin1]) : named?.codes ?? null;
    // GeoNames files some towns under older admin1 codes (Yamoussoukro under Lacs): a province
    // without a single place gives no hint.
    if (admin1s && !regionPlaces.some(p => admin1s.has(p.admin1))) admin1s = null;
    const index = indexFor(admin1s);
    let found = null;
    for (const text of bracketed(club)) {
      const place = norm(text).length >= 3 && index.get(norm(text))?.place;
      if (place && (!found || place.pop > found.place.pop || (place.pop === found.place.pop && place.id < found.place.id))) found = { place, len: 9, gram: norm(text) };
    }
    // A saint's name ("San Antonio", "Santa Ana") is often the club's patron rather than its
    // town, so it only counts when the name holds no other place ("SD San Antonio Penonomé"),
    // unless it follows "de" ("Libertad de San Carlos").
    // A shortened alternate name loses to a place's own name of the same length.
    const better = (a, b) => !b || a.weak < b.weak || (a.weak === b.weak && (a.len > b.len || (a.len === b.len
      && (!!a.short < !!b.short || (!!a.short === !!b.short && (a.place.pop > b.place.pop || (a.place.pop === b.place.pop && a.place.id < b.place.id)))))));
    for (const text of found ? [] : [club.name, club.shortName]) {
      const tokens = norm(text).split(' ').filter(Boolean);
      for (let len = Math.min(4, tokens.length); len >= 1; len--) {
        for (let i = 0; i + len <= tokens.length; i++) {
          const gram = tokens.slice(i, i + len).join(' ');
          if (len === 1 && (GENERIC.has(gram) || STOP.has(gram) || gram.length < 3 || /^\d+$/.test(gram))) continue;
          const variants = len > 1 ? [gram] : GERMAN_ADJECTIVES.has(nation.id) ? adjectiveVariants(gram)
            : nation.id === '246' && gram.length > 4 && gram.endsWith('n') ? [gram, gram.slice(0, -1)] : [gram]; // Finnish genitive: Tornion -> Tornio
          for (const v of variants) {
            const hit = index.get(v);
            const match = hit && { place: hit.place, len, gram: v, short: hit.short, weak: SAINTS.has(tokens[i]) && !OF.has(tokens[i - 1]) };
            if (match && better(match, found)) found = match;
          }
        }
      }
    }
    // A club named after its province ("Taipei Medical University") may take that name's city
    // when GeoNames files the city under another admin1 code, but only a real city: villages
    // share province names too (Jiangxi, Kebbe, Northland).
    const capital = !found && named && townIndex.get(named.name)?.place;
    if (capital && capital.pop >= BIG_CITY_POP && [club.name, club.shortName].some(t => ` ${norm(t)} `.includes(` ${named.name} `))) found = { place: capital };
    if (found) result.set(club.clubId, { lon: round(found.place.lon), lat: round(found.place.lat), source: `geonames:${found.place.id}`, label: found.place.name });
    else if (admin1s && !hint) provinces.set(club.clubId, [...admin1s].sort().map(code => admin1Names.get(`${a2}.${code}`)).join(' / '));
  }

  // Flag Wikidata points far from every town of the country (a wrong venue, a foreign item);
  // build-domestic.mjs makes the actual boundary decision.
  const remote = clubs.filter(club => result.get(club.clubId)?.source.startsWith('wikidata')).map(club => {
    const loc = result.get(club.clubId), near = nearestPlace(regionPlaces, loc.lon, loc.lat);
    return { fm: club.clubId, name: club.name, km: near ? Math.round(near.km) : null };
  }).filter(r => r.km === null || r.km > 30);

  return { locations: result, remote, provinces, wikidata: { qid: country.qid, langs: wd.langs, clubs: info.size, fetchedAt: wd.fetchedAt }, geonames: { a2, admin1: region?.admin1 ?? null } };
}
