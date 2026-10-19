// Stage 1 of domestic campaigns: a country's top FM26 clubs, their squads and
// home towns, committed as one snapshot per nation (docs/design/domestic-campaigns.md).
//
// Usage:
//   node scripts/sync-domestic-clubs.mjs [--only=826,724] [--survey] [--refresh]
//     --survey   club list pages only: writes scripts/data/domestic/survey.json
//     --only     limit to these game nation ids (default: every nation in NATIONS)
//     --refresh  download club lists and Wikidata again for these nations
//     --refresh=all  also the global player listing (~700 requests) and GeoNames
//
// Sources (all cached under the gitignored data-src/domestic/, so reruns are offline):
//   - EFEM.club clubs, exact nation name, male, reputation order:
//       /api/clubs/filter?...&filter=gender=0,nation=<FM nation>&orderBy=reputation desc
//     Pages of 100 shuffle clubs of equal reputation, so the reputation at the end of
//     each page is re-read whole (filter ...,reputation=<v>) and every row is checked.
//   - EFEM.club players. The player grid's clubName filter matches FM's internal
//     club name ("R. Madrid", "Fla"), not the club list's display name, so a
//     name search misses whole squads. Instead every male 26.3.0 player is read
//     once, in single-page slices (currentAbility = v, age range) small enough
//     that no paging is needed (paging ties in Current Ability skips players),
//     and squads are grouped by exact clubId. The list carries no loan club (only the
//     contract clubId), so a player out on loan counts for his parent club.
//   - Wikidata SPARQL (CC0) and GeoNames cities1000 (CC BY 4.0) for home towns,
//     plus manual overrides in scripts/data/domestic-locations.json.
//   - Real names for FM's unlicensed placeholder names (Portugal's "BRG" is SC Braga)
//     from scripts/data/domestic-names.json; an all-capitals name without an entry there
//     stops the sync.
//
// Snapshot scripts/data/domestic/<nation id>.json (written only when N >= 10):
// {
//   "format": 1,
//   "source": { provider, game, version: '26.3.0', fetchedAt (ISO, newest cached
//               response used), endpoints: { clubs, players }, clubsQuery, playersQuery,
//               selection, squad, loans, locations, names, attribution, updateCommand },
//   "nation": { id, name, fmName, nationCode, wikidata, geonames: { country, admin1 } },
//   "stats":  { candidates, clubs, excluded: { reason: n }, locations: { override, wikidata,
//               geonames, none }, wikidataVia: { P115, P625, P159, P131 }, squad: { min, max },
//               totalPlayersMismatch },
//   "clubs": [   one club per line, rank order (reputation desc, efemScore desc, clubId asc)
//     { fm, name, short, fmName?, fmShort?, rep, efemScore, competition, totalPlayers, natural,
//       location: { lon, lat, source, label, via?, qid? } | null,
//       squad: [[fmId, name, currentAbility, 'natural,keys,strongest,first', nationCode|null], ...] }
//   ],
//   "excluded": [ one per line, rank order: { fm, name, reason } ]
// }
// location.source is 'override', 'wikidata:Q..' or 'geonames:<id>'; via is the
// Wikidata property that gave the point (P115 venue, P625, P159 HQ, P131).
// fmName/fmShort keep FM's own names when domestic-names.json replaces them.
// Squad tuples are exactly what expandFmTuple (src/data/fmPlayers.js) reads.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { NATIONS } from '../src/data/teams.js';
import {
  CLUBS_ENDPOINT, MAX_CLUBS, MIN_CLUBS, PLAYERS_ENDPOINT, SLICE_PAGE_SIZE, VERSION,
  createClubLister, createEfem, fmNation, foldedNames, nameReason, naturalPlayers, pickSquad,
  playerSliceUrl, trimPlayer, validateSnapshot,
} from './lib/domestic-sync.mjs';
import { createWikidata, ensureGeonames, locateClubs } from './lib/domestic-locate.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, 'data-src/domestic');
const outDir = path.join(root, 'scripts/data/domestic');
const overridesFile = path.join(root, 'scripts/data/domestic-locations.json');
const namesFile = path.join(root, 'scripts/data/domestic-names.json');
const REGIONS = { '826': { a2: 'GB', admin1: 'ENG' } }; // the game's 826 is England, not the UK

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
  return [key, value];
}));
const pad = id => /^\d+$/.test(id) ? id.padStart(3, '0') : id;
const ids = args.only ? args.only.split(',').map(s => pad(s.trim())).filter(Boolean) : Object.keys(NATIONS);
for (const id of ids) if (!NATIONS[id]) throw new Error(`Unknown nation id ${id}`);
const refresh = args.refresh === 'true' || args.refresh === 'all';
const refreshAll = args.refresh === 'all';
const efem = createEfem({ cacheDir, refresh });

// ---- Club classification ----

/**
 * Walk a nation's clubs in rank order, reading more list pages as needed.
 * Returns { taken (up to 100 viable), excluded (non-viable clubs ranked above the cut), rows (clubs examined) }.
 * Without `squadsOf` (the survey) viability is estimated from totalPlayers.
 */
async function selectClubs(nation, lister, squadsOf) {
  await lister.next();
  for (;;) {
    const rows = lister.rows();
    const taken = [], excluded = [], stronger = new Set();
    let last = null;
    for (const club of rows) {
      if (taken.length >= MAX_CLUBS) break;
      last = club;
      const reason = classify(club, stronger, squadsOf);
      for (const name of foldedNames(club)) stronger.add(name);
      if (reason) excluded.push({ club, reason });
      else taken.push(club);
    }
    // rows are complete down to the last fetched reputation (the lister re-reads the tie
    // at each page end), so a full list needs no further page.
    if (taken.length < MAX_CLUBS && lister.more && await lister.next()) continue;
    return { taken, excluded, rows: rows.indexOf(last) + 1 };
  }
}

function classify(club, stronger, squadsOf) {
  if (club.gender !== 'Male') return 'not a male side';
  // A null competition alone is no reason: FM leaves many real regional clubs without
  // a playable league (Greece, Mexico, Colombia); nameReason still drops school sides there.
  const byName = nameReason(club, stronger);
  if (byName) return byName;
  if (!(club.totalPlayers >= 11)) return 'fewer than 11 players';
  if (!squadsOf) return null; // survey: estimate from totalPlayers only
  const natural = naturalPlayers(squadsOf.get(club.clubId) || []);
  if (natural.length < 11) return 'fewer than 11 natural-position players';
  if (!natural.some(p => p.keys.includes('gk'))) return 'no natural goalkeeper';
  return null;
}

// ---- Survey ----

async function survey() {
  const file = path.join(outDir, 'survey.json');
  const previous = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')).nations : [];
  const entries = new Map(previous.map(entry => [entry.id, entry]));
  let lastFetch = previous.length ? JSON.parse(await readFile(file, 'utf8')).source.fetchedAt ?? '' : '';
  await Promise.all(ids.map(async id => {
    const nation = fmNation(id);
    const lister = createClubLister(efem, nation);
    let result;
    try { result = await selectClubs(nation, lister, null); } catch (error) {
      entries.set(id, { id, name: nation.name, fmName: nation.fmName, nationCode: nation.nationCode, error: error.message.slice(-200), ships: false });
      console.warn(`${id} ${nation.name}: ${error.message}`);
      return;
    }
    const { taken, excluded, rows } = result;
    const all = lister.union();
    for (const page of [...lister.pages, ...lister.ties]) if (page.fetchedAt > lastFetch) lastFetch = page.fetchedAt;
    entries.set(id, {
      id, name: nation.name, fmName: nation.fmName, nationCode: nation.nationCode, query: lister.mode,
      totalMale: lister.count, fetched: all.length, tieSlices: lister.ties.length, otherNation: all.filter(c => !nation.codes.includes(c.nation?.nationCode)).length,
      examined: rows, estN: taken.length, ships: taken.length >= MIN_CLUBS,
      topRep: taken[0]?.reputation ?? null, lastRep: taken.at(-1)?.reputation ?? null,
      excluded: excluded.reduce((acc, e) => { acc[e.reason] = (acc[e.reason] || 0) + 1; return acc; }, {}),
    });
    console.log(`${id} ${nation.name}: ${lister.count} clubs (${lister.mode}), est. N ${taken.length}`);
  }));
  const nations = [...entries.values()].sort((a, b) => a.id.localeCompare(b.id));
  const source = {
    provider: 'EFEM.club', version: VERSION, endpoint: CLUBS_ENDPOINT, fetchedAt: lastFetch,
    rule: 'Club list pages only. estN = clubs in reputation order that are male, not reserve/youth/school/all-star by name, '
      + 'and list totalPlayers >= 11, capped at 100. The full sync also requires >= 11 natural-position players incl. a goalkeeper. Ships when N >= 10. '
      + 'fetched = distinct clubs read: list pages of 100 plus tieSlices exact-reputation re-reads of the reputation at each page end.',
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(file, '{\n"source":' + JSON.stringify(source) + ',\n"nations":[\n' + nations.map(n => JSON.stringify(n)).join(',\n') + '\n]\n}\n');
  console.log(`Survey: ${nations.filter(n => n.ships).length}/${nations.length} nations reach N >= ${MIN_CLUBS}; wrote ${path.relative(root, file)}`);
}

// ---- Players: every male player, in single-page slices ----

async function loadPlayers() {
  const started = Date.now();
  const get = url => efem.get(url, trimPlayer, { refresh: refreshAll });
  const total = (await get(`${PLAYERS_ENDPOINT}?filterString=pageSize=1&page=1&version=${VERSION}&view=Default&filter=${encodeURIComponent('playerbase.gender=0')}&orderBy=${encodeURIComponent('currentAbility desc')}`)).count;
  const slices = [];
  // Probe a slice's size with pageSize=1, then read it as one page or halve its age range
  // (no age filter at first). Returns the number of players read.
  async function slice(ca, lo, hi) {
    const { count } = await get(playerSliceUrl(ca, lo, hi, 1));
    if (!count) return 0;
    if (count > SLICE_PAGE_SIZE) {
      if (lo != null && lo === hi) throw new Error(`Slice CA ${ca} age ${lo} still exceeds ${SLICE_PAGE_SIZE}`);
      const [from, to] = lo == null ? [0, 99] : [lo, hi], mid = Math.floor((from + to) / 2);
      const [a, b] = await Promise.all([slice(ca, from, mid), slice(ca, mid + 1, to)]);
      if (lo == null && a + b !== count) console.warn(`CA ${ca}: ${a + b} players in age slices, ${count} in total (players without an age are missed)`);
      return a + b;
    }
    const page = await get(playerSliceUrl(ca, lo, hi));
    if (page.data.length !== page.count) throw new Error(`Slice CA ${ca} age ${lo}-${hi}: ${page.data.length} rows for count ${page.count}`);
    slices.push(page);
    return page.count;
  }
  const sliced = (await Promise.all(Array.from({ length: 100 }, (_, i) => slice(i + 1, null, null)))).reduce((a, b) => a + b, 0);
  slices.sort((a, b) => a.url.localeCompare(b.url));
  const byClub = new Map(), seen = new Set();
  let fetchedAt = '';
  for (const page of slices) {
    if (page.fetchedAt > fetchedAt) fetchedAt = page.fetchedAt;
    for (const row of page.data) {
      if (seen.has(row[0])) continue;
      seen.add(row[0]);
      if (row[2] == null) continue;
      if (!byClub.has(row[2])) byClub.set(row[2], []);
      byClub.get(row[2]).push(row);
    }
  }
  console.log(`Players: ${seen.size} unique of ${total} male (${sliced} in CA 1-100 slices, ${slices.length} slices), ${byClub.size} clubs, ${((Date.now() - started) / 1000).toFixed(0)} s`);
  if (seen.size !== total) console.warn(`Players: ${total - seen.size} male players are missing from the slices`);
  return { byClub, fetchedAt, total, unique: seen.size };
}

// ---- Sync ----

const REGIONAL = 'Regional football';
const SELECTION = `Male clubs of the FM nation (exact nation name, nation.nationCode checked) in reputation order (ties: efemScore desc, clubId asc), `
  + `read in list pages of 100 with the reputation at each page end re-read whole (filter reputation=<v>), since pages shuffle tied clubs. `
  + `Excluded: reserve, B/II, youth, under-N, university/school (outside senior competitions) and all-star sides (name rules plus EXCLUDED_CLUBS in scripts/lib/domestic-sync.mjs); `
  + `fewer than 11 natural-position (proficiency >= 90) players or no natural goalkeeper. A club without an FM competition stays in as "${REGIONAL}". N = min(${MAX_CLUBS}, viable); a nation ships when N >= ${MIN_CLUBS}.`;
const SQUAD = `Up to 16 players: the strongest natural 4-4-2 (1 GK, 4 DF, 4 MF, 2 FW) in the game's roles (FM_ROLES: lw/rw are forwards), `
  + 'players seated in Current Ability order whenever the filled shirts can be rearranged to fit them, then the best remaining by Current Ability.';
const LOANS = `Not applied: EFEM's player list (views Default, ValueAndWage and Profile checked) gives only the contract clubId and no loan club, `
  + `so a player out on loan is in his parent club's squad, not the squad of the club he plays for.`;
const NAMES = `FM's own names, except unlicensed placeholders (e.g. "BRG") replaced from scripts/data/domestic-names.json; fmName/fmShort keep FM's.`;
const LOCATIONS = 'Manual overrides (scripts/data/domestic-locations.json), then Wikidata football clubs of the country (venue P115 > P625 > HQ P159 > P131; '
  + 'multi-word exact/core name matches first, then one-word and leading-word subset matches pooled by sitelinks, dissolved items last; '
  + 'each item used once in reputation order; Brazilian state hints; when the club name holds a town, the first item property within 50 km of it is used, '
  + 'and a weak match whose own names hold another town must lie within 15 km of it), then the longest GeoNames cities1000 place name in the club name '
  + `(own names beat other places' alternate names, alternate names only from places with a population, shortened ones weakest; `
  + 'limited to a province named in the club name or competition).';

// FM gives some unlicensed clubs a capitals placeholder ("BRG", "VTSC"); real names in
// capitals (AIK, GAIS) are listed in domestic-names.json without a replacement.
const PLACEHOLDER = /^\p{Lu}{2,5}$/u;

/** Display names for a nation's taken clubs: Map clubId -> { name, short, fmName?, fmShort? }. */
function displayNames(nation, taken, names) {
  const out = new Map();
  for (const club of taken) {
    const entry = names[club.clubId];
    if (entry && entry.fm !== club.name) throw new Error(`${nation.name}: domestic-names.json ${club.clubId} is for "${entry.fm}", FM now says "${club.name}"`);
    if (!entry && PLACEHOLDER.test(club.name)) throw new Error(`${nation.name}: "${club.name}" (${club.clubId}) looks like an FM placeholder; add it to scripts/data/domestic-names.json`);
    out.set(club.clubId, entry?.name
      ? { name: entry.name, short: entry.short || entry.name, fmName: club.name, fmShort: club.shortName }
      : { name: club.name, short: club.shortName });
  }
  return out;
}

async function sync() {
  const withoutComments = json => Object.fromEntries(Object.entries(JSON.parse(json)).filter(([key]) => !key.startsWith('_')));
  const overrides = withoutComments(await readFile(overridesFile, 'utf8'));
  const names = withoutComments(await readFile(namesFile, 'utf8'));
  const players = await loadPlayers();
  const wikidata = createWikidata({ cacheDir, refresh });
  const geoFiles = await ensureGeonames(cacheDir, refreshAll);
  await mkdir(outDir, { recursive: true });
  for (const id of ids) {
    const started = Date.now(), before = efem.stats().requests, wdBefore = wikidata.stats().requests;
    const nation = fmNation(id);
    const lister = createClubLister(efem, nation);
    const { taken, excluded, rows } = await selectClubs(nation, lister, players.byClub);
    if (taken.length < MIN_CLUBS) { console.log(`${id} ${nation.name}: only ${taken.length} viable clubs; no snapshot`); continue; }
    const display = displayNames(nation, taken, names);
    const located = await locateClubs({
      nation, overrides, wikidata, geoFiles, region: REGIONS[id],
      clubs: taken.map(club => ({ ...club, name: display.get(club.clubId).name, shortName: display.get(club.clubId).short })),
    });
    for (const r of located.remote) console.warn(`${id} ${r.name} (${r.fm}): home point ${r.km ?? '?'} km from the nearest GeoNames town; check it or add an override`);
    for (const [fm, province] of located.provinces) console.warn(`${id} ${display.get(fm).name} (${fm}): no town found in ${province}; add an override`);
    const clubs = taken.map(club => {
      const natural = naturalPlayers(players.byClub.get(club.clubId) || []);
      const { name, short, fmName, fmShort } = display.get(club.clubId);
      return {
        fm: club.clubId, name, short, ...(fmName ? { fmName, fmShort } : {}), rep: club.reputation, efemScore: club.efemScore,
        competition: club.competition?.name || REGIONAL, totalPlayers: club.totalPlayers, natural: natural.length,
        location: located.locations.get(club.clubId) ?? null, squad: pickSquad(natural),
      };
    });
    const count = (list, key) => list.reduce((acc, item) => { const k = key(item); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    const tier = loc => !loc ? 'none' : loc.source.split(':')[0];
    const fetchedAt = [players.fetchedAt, located.wikidata.fetchedAt, ...[...lister.pages, ...lister.ties].map(p => p.fetchedAt)].sort().at(-1);
    const snapshot = {
      format: 1,
      source: {
        provider: 'EFEM.club', game: 'Football Manager 26', version: VERSION, fetchedAt,
        endpoints: { clubs: CLUBS_ENDPOINT, players: PLAYERS_ENDPOINT },
        clubsQuery: lister.query(),
        playersQuery: `Every male ${VERSION} player, read in single-page slices (playerbase.gender=0, currentAbility=<v>, age range; pageSize ${SLICE_PAGE_SIZE}) and grouped by exact clubId.`,
        selection: SELECTION, squad: SQUAD, loans: LOANS, locations: LOCATIONS, names: NAMES,
        attribution: { geonames: 'GeoNames (geonames.org), CC BY 4.0', wikidata: 'Wikidata, CC0' },
        updateCommand: `node scripts/sync-domestic-clubs.mjs --only=${id}`,
      },
      nation: { id, name: nation.name, fmName: nation.fmName, nationCode: nation.nationCode, wikidata: located.wikidata.qid, geonames: { country: located.geonames.a2, admin1: located.geonames.admin1 } },
      stats: {
        candidates: rows, clubs: clubs.length,
        excluded: count(excluded, e => e.reason),
        locations: { override: 0, wikidata: 0, geonames: 0, none: 0, ...count(clubs, c => tier(c.location)) },
        wikidataVia: count(clubs.filter(c => c.location?.via), c => c.location.via),
        squad: { min: Math.min(...clubs.map(c => c.squad.length)), max: Math.max(...clubs.map(c => c.squad.length)) },
        totalPlayersMismatch: taken.filter(c => (players.byClub.get(c.clubId)?.length ?? 0) !== c.totalPlayers).length,
      },
      clubs,
      excluded: excluded.map(({ club, reason }) => ({ fm: club.clubId, name: club.name, reason })),
    };
    validateSnapshot(snapshot);
    const file = path.join(outDir, `${id}.json`);
    await writeFile(file, '{\n"format":1,\n"source":' + JSON.stringify(snapshot.source) + ',\n"nation":' + JSON.stringify(snapshot.nation)
      + ',\n"stats":' + JSON.stringify(snapshot.stats) + ',\n"clubs":[\n' + clubs.map(c => JSON.stringify(c)).join(',\n')
      + '\n],\n"excluded":[\n' + snapshot.excluded.map(e => JSON.stringify(e)).join(',\n') + '\n]\n}\n');
    const s = snapshot.stats;
    console.log(`${id} ${nation.name}: N ${clubs.length} of ${rows} examined; excluded ${JSON.stringify(s.excluded)}; `
      + `locations ${JSON.stringify(s.locations)}; ${efem.stats().requests - before} EFEM + ${wikidata.stats().requests - wdBefore} Wikidata requests, `
      + `${((Date.now() - started) / 1000).toFixed(1)} s -> ${path.relative(root, file)}`);
  }
}

if (args.survey === 'true') await survey();
else await sync();
console.log(`EFEM requests: ${efem.stats().requests} (cache hits ${efem.stats().cached})`);
