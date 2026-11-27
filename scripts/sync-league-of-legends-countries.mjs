// The countries of the League of Legends players gol.gg files under none, most of them retired before 2020, for the earlier
// seasons (docs/design/league-of-legends.md, "Earlier seasons"): esportsearnings.com's lists of the game's players by country,
// kept gzipped in data-src/esportsearnings/ (git-ignored), and Wikidata's League of Legends players (CC0). Writes
// scripts/data/league-of-legends-countries.json, which npm run sync:league-of-legends-seasons reads.
//
// Usage: node scripts/sync-league-of-legends-countries.mjs [--fetch] [--pause=MS]
//   npm run sync:league-of-legends-countries
//   --fetch   fetch the pages the cache lacks, one at a time and 10 seconds apart; without it nothing is fetched
//
// A player is found by his tag. gol.gg's tag may be another player's on the other lists, so a match counts only where it
// fits the leagues he played in (gol.gg's regions): one country of those leagues, or, for a player of another country (an
// import), both lists agreeing, or the only player of that tag on either list being of a country that sends players abroad.
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readPlayersTable, seasonCode } from './lib/golgg.mjs';
import { SITE, earningsPlayers } from './lib/esports-earnings.mjs';
import { FIRST_SEASON, LAST_SEASON, readSeasonLists } from './lib/league-of-legends-seasons.mjs';
import { mostOf } from './lib/esports-elo.mjs';
import { askWikidata as ask } from './lib/wikidata-sparql.mjs';

const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--fetch' && !/^--pause=/.test(arg));
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const fetching = args.includes('--fetch');
const pause = Number(args.find(arg => arg.startsWith('--pause='))?.split('=')[1] ?? 10000);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const golgg = path.join(root, 'data-src', 'golgg');
const earnings = path.join(root, 'data-src', 'esportsearnings');
const wikidataFile = path.join(root, 'data-src', 'esportsearnings', 'wikidata.json');
const outFile = path.join(root, 'scripts', 'data', 'league-of-legends-countries.json');
const today = new Date().toISOString().slice(0, 10);
// Only a player with this many games in a season can be rated in it (with those of the year before, a few more).
const LEAST_GAMES = 10;

/** A tag as the lists may each spell it: letters and digits only, a disambiguating bracket dropped. */
const loose = tag => String(tag ?? '').normalize('NFKD').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^\p{L}\p{N}]+/gu, '');

// The countries a league's own players come from, by gol.gg's region.
const EUROPE = ['al', 'am', 'at', 'ba', 'be', 'bg', 'by', 'ch', 'cy', 'cz', 'de', 'dk', 'ee', 'es', 'fi', 'fr', 'gb', 'ge', 'gr', 'hr', 'hu', 'ie', 'il', 'is', 'it', 'lt', 'lu',
  'lv', 'md', 'me', 'mk', 'mt', 'nl', 'no', 'pl', 'pt', 'ro', 'rs', 'ru', 'se', 'si', 'sk', 'tr', 'ua', 'xk'];
const LATIN = ['ar', 'bo', 'cl', 'co', 'cr', 'cu', 'do', 'ec', 'gt', 'hn', 'mx', 'ni', 'pa', 'pe', 'pr', 'py', 'sv', 'uy', 've'];
const HOME = { KR: ['kr'], CN: ['cn', 'hk', 'tw', 'mo'], TW: ['tw', 'hk', 'mo'], PCS: ['tw', 'hk', 'mo', 'my', 'sg', 'th', 'ph'], NA: ['us', 'ca'], EUW: EUROPE, BR: ['br'],
  CIS: ['ru', 'ua', 'by', 'kz', 'am', 'ge', 'az', 'lv', 'lt', 'ee', 'md'], TR: ['tr'], ES: ['es'], PT: ['pt'], FR: ['fr', 'be'], IT: ['it'], PL: ['pl'], CZ: ['cz', 'sk'],
  DE: ['de', 'at', 'ch'], GR: ['gr', 'cy'], RS: ['rs', 'hr', 'ba', 'si', 'mk', 'me', 'al', 'bg'], UK: ['gb', 'ie'], RO: ['ro', 'md'], BE: ['be', 'nl', 'lu'],
  NL: ['nl', 'be'], LT: ['lt', 'lv', 'ee'], AL: ['sa', 'ae', 'kw', 'qa', 'bh', 'om', 'jo', 'lb', 'eg', 'ma', 'dz', 'tn', 'iq', 'sy', 'ps'], OCE: ['au', 'nz'], JP: ['jp'],
  VN: ['vn'], LAN: LATIN, LAS: LATIN, LAT: LATIN, SEA: ['th', 'sg', 'my', 'ph', 'id', 'vn'] };
// Countries whose players went abroad to other leagues in numbers.
const SENDERS = new Set(['kr', 'cn', 'tw']);

// ---------- gol.gg's players of no country, and the regions they played in ----------

const gunzip = async file => gunzipSync(await readFile(file)).toString('utf8');
const players = new Map();
for (let year = FIRST_SEASON; year <= LAST_SEASON; year++) {
  const list = await gunzip(path.join(golgg, 'season-players', `${seasonCode(year)}.html.gz`)).then(readPlayersTable, () => []);
  const lacking = new Map(list.filter(p => !p.country && p.games >= LEAST_GAMES).map(p => [p.id, p]));
  if (!lacking.size) continue;
  for (const [id, p] of lacking) {
    if (!players.has(id)) players.set(id, { id, name: p.name, games: 0, regions: new Map(), seasons: [] });
    const player = players.get(id);
    player.games += p.games;
    player.seasons.push(year);
  }
  for (const t of await readSeasonLists(golgg, year)) {
    for (const p of t.players ?? []) {
      if (!lacking.has(p.id) || t.region === 'WR') continue;
      const regions = players.get(p.id).regions;
      regions.set(t.region, (regions.get(t.region) ?? 0) + p.games);
    }
  }
}
console.log(`${players.size} of gol.gg's players of ${FIRST_SEASON}–${LAST_SEASON} with ${LEAST_GAMES} games in a season have no country there`);

// ---------- the other lists ----------

const listed = await earningsPlayers(earnings, { fetching, pause });
// Wikidata's players of League of Legends (Q223341), with their names there, their Liquipedia page and their citizenship.
let wikidata = await readFile(wikidataFile, 'utf8').then(JSON.parse, () => null);
if (!wikidata && fetching) {
  // Two questions, as QLever answers them quickly: the players with their citizenship's item, then each item's ISO code.
  const rows = answer => (answer.results?.bindings ?? []).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value.value])));
  // QLever answers a busy moment (and a query it gives up on) with HTTP 429: ask again after a minute, then two.
  const askWikidata = async (query, options) => {
    for (let attempt = 0; ; attempt++) {
      try { return await ask(query, options); } catch (error) {
        if (error.status !== 429 || attempt >= 2) throw error;
        console.log(`  QLever is busy (HTTP 429): asking again in ${60 * (attempt + 1)} s`);
        await new Promise(resolve => setTimeout(resolve, 60000 * (attempt + 1)));
      }
    }
  };
  try {
    const people = rows(await askWikidata(`SELECT DISTINCT ?p ?label ?alias ?country ?liquipedia WHERE {
      ?p wdt:P31 wd:Q5 . { ?p wdt:P2416 wd:Q223341 } UNION { ?p wdt:P641 wd:Q223341 }
      OPTIONAL { ?p rdfs:label ?label . FILTER(LANG(?label) = "en") }
      OPTIONAL { ?p skos:altLabel ?alias . FILTER(LANG(?alias) = "en") }
      OPTIONAL { ?p wdt:P10918 ?liquipedia }
      OPTIONAL { ?p wdt:P27 ?country } }`, { signal: AbortSignal.timeout(120000) }));
    const items = [...new Set(people.map(row => row.country).filter(Boolean))].map(iri => `wd:${iri.split('/').at(-1)}`);
    const codes = new Map(rows(await askWikidata(`SELECT ?country ?code WHERE { VALUES ?country { ${items.join(' ')} } ?country wdt:P297 ?code }`,
      { signal: AbortSignal.timeout(120000) })).map(row => [row.country, row.code]));
    wikidata = people.map(({ country, ...row }) => ({ ...row, ...(codes.has(country) ? { code: codes.get(country) } : {}) }));
    await writeFile(wikidataFile, JSON.stringify(wikidata, null, 1));
  } catch (error) {
    // Kept out of the cache, so the next --fetch asks again.
    console.log(`  Wikidata could not be read (${error.status ? `HTTP ${error.status}` : error.message}): esportsearnings.com's lists alone this time`);
    wikidata = null;
  }
}
const byTag = new Map();
const add = (tag, entry) => {
  const key = loose(tag);
  if (!key) return;
  if (!byTag.has(key)) byTag.set(key, []);
  if (!byTag.get(key).some(other => other.from === entry.from && other.ref === entry.ref)) byTag.get(key).push(entry);
};
for (const p of listed) add(p.handle, { from: 'esportsearnings', ref: `${SITE}/players/${p.id}-${p.slug}`, name: p.name, country: p.country });
for (const row of wikidata ?? []) {
  if (!row.code) continue;
  const entry = { from: 'wikidata', ref: row.p, name: row.label ?? null, country: row.code.toLowerCase() };
  for (const text of [row.label, row.alias]) {
    if (!text) continue;
    add(text, entry);
    for (const [, quoted] of text.matchAll(/["“”'‘’]([^"“”'‘’]+)["“”'‘’]/g)) add(quoted, entry);
  }
  if (row.liquipedia?.startsWith('leagueoflegends/')) add(row.liquipedia.slice('leagueoflegends/'.length).replace(/_/g, ' '), entry);
}
console.log(`${listed.length} players on esportsearnings.com, ${new Set((wikidata ?? []).map(row => row.p)).size} on Wikidata`);

// ---------- the matches ----------

/** A player's country from the entries of his tag, and why; null where they do not settle it. */
export function countryOf(player, entries) {
  if (!entries.length) return null;
  const home = new Set([...player.regions.keys()].flatMap(region => HOME[region] ?? []));
  const countries = [...new Set(entries.map(entry => entry.country))];
  const own = countries.filter(country => home.has(country));
  const from = country => entries.filter(entry => entry.country === country);
  // One of his leagues' own countries.
  if (own.length === 1 && countries.length === 1) return { country: own[0], entries: from(own[0]), why: 'his leagues\' own country' };
  // Several players of the tag: the one of his leagues' countries, unless a sender's player may be he.
  if (own.length === 1 && !countries.some(country => country !== own[0] && SENDERS.has(country))) return { country: own[0], entries: from(own[0]), why: 'the one of his tag from his leagues\' country' };
  if (countries.length !== 1) return null;
  const [country] = countries;
  if (new Set(entries.map(entry => entry.from)).size > 1) return { country, entries, why: 'both lists' };
  if (SENDERS.has(country)) return { country, entries, why: 'the only player of his tag, of a country that sends players abroad' };
  return null;
}

const out = {};
const tallies = new Map();
const unsettled = [];
for (const player of [...players.values()].sort((a, b) => a.id - b.id)) {
  const entries = byTag.get(loose(player.name)) ?? [];
  const found = countryOf(player, entries);
  if (!found) { unsettled.push({ player, entries }); continue; }
  tallies.set(found.why, (tallies.get(found.why) ?? 0) + 1);
  out[player.id] = { name: player.name, country: found.country, from: [...new Set(found.entries.map(entry => entry.from))].join(', '), ref: found.entries[0].ref,
    region: mostOf(player.regions) };
}
const text = `{\n "source": ${JSON.stringify({ names: wikidata?.length ? ['esportsearnings.com', 'Wikidata (CC0)'] : ['esportsearnings.com'], url: SITE, fetched: today, players: Object.keys(out).length })},\n "players": {\n${
  Object.entries(out).map(([id, row]) => `  ${JSON.stringify(id)}: ${JSON.stringify(row)}`).join(',\n')}\n }\n}\n`;
await writeFile(outFile, text);
console.log(`Wrote ${Object.keys(out).length} countries to ${path.relative(root, outFile)}: ${[...tallies].map(([why, n]) => `${n} by ${why}`).join('; ')}`);
console.log(`  not settled: ${unsettled.length}, the most played ${unsettled.sort((a, b) => b.player.games - a.player.games).slice(0, 40)
  .map(({ player, entries }) => `${player.name} (${mostOf(player.regions) ?? '—'} ${player.games}${entries.length ? ` ${[...new Set(entries.map(e => e.country))].join('/')}` : ''})`).join(', ')}`);

// How often the rule is right where gol.gg knows: its players with a country, asked as if it did not.
let right = 0, wrong = 0, silent = 0;
const misses = [];
for (let year = FIRST_SEASON; year <= 2019; year++) {
  for (const p of await gunzip(path.join(golgg, 'season-players', `${seasonCode(year)}.html.gz`)).then(readPlayersTable, () => [])) {
    if (!p.country || p.games < LEAST_GAMES) continue;
    const regions = new Map();
    const lists = await listsOf(year);
    for (const t of lists) { const row = t.byId?.get(p.id); if (row && t.region !== 'WR') regions.set(t.region, (regions.get(t.region) ?? 0) + row.games); }
    const found = countryOf({ regions }, byTag.get(loose(p.name)) ?? []);
    if (!found) silent++;
    else if (found.country === p.country.toLowerCase()) right++;
    else { wrong++; misses.push(`${p.name} ${p.country}, not ${found.country.toUpperCase()}`); }
  }
}
console.log(`  checked on the ${right + wrong + silent} player-seasons of ${FIRST_SEASON}–2019 whose country gol.gg gives: ${right} right, ${wrong} wrong, ${silent} left unsettled${misses.length ? ` (${[...new Set(misses)].slice(0, 25).join('; ')})` : ''}`);

async function listsOf(year) {
  listsOf.kept ??= new Map();
  if (!listsOf.kept.has(year)) {
    listsOf.kept.set(year, (await readSeasonLists(golgg, year)).map(t => ({ region: t.region, byId: t.players ? new Map(t.players.map(p => [p.id, p])) : null })));
  }
  return listsOf.kept.get(year);
}
