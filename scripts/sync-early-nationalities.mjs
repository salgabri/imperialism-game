// Ask Wikidata for the nationality of the FIFA 05 and FIFA 06 players whom no later EA edition names: mostly those who had
// retired by FIFA 07, among them Zidane, Bergkamp and Shearer (docs/design/football-years.md, "FIFA 05 and FIFA 06").
//
//   node scripts/sync-early-nationalities.mjs [--data=<dir>] [--csv=<file>] [--refresh]
//     --data     the downloaded sources (default data-src/), as for npm run build:ea-seasons
//     --csv      the FIFA 15 – EA FC 24 export elsewhere (default <data>/ea-leone/male_players.csv)
//     --refresh  ask the SPARQL queries again instead of reading the answers in data-src/wikidata-early/
//
// Wikidata's facts come by SPARQL from QLever's Wikidata endpoint (scripts/lib/wikidata-sparql.mjs), through
// scripts/lib/polite-fetch.mjs: the Wikidata Query Service's robots.txt disallows its /sparql. Each query keeps the
// Query Service's text, which keys the cache. The search by name used Wikidata's own search API (wbsearchentities under
// www.wikidata.org/w/api.php), which its robots.txt disallows for every agent, with no allowed source of the same
// answers; its answers as read on 2026-11-07 are pinned in scripts/data/ea-early-search.json, and a name without one
// there is not searched (the row stays unmatched).
//
// Output: scripts/data/ea-early-nationalities.json (committed; Wikidata is CC0). Put the SHA-256 it prints in
// scripts/data/ea-seasons.json (`early.nationalities`), then run npm run build:ea-seasons.
//
// A player is matched two ways. Most by birth date and name: a footballer born that day whose name agrees. FIFA 05 and
// FIFA 06 have many wrong birth dates, so a player rated NAME_ONLY_FROM or better who is still unmatched, and whose name
// has at least two words, is looked up by name: exactly one footballer of that name, of an age to be playing that season.
// A few real players these rules cannot settle are checked by hand (`early.checked` in the manifest). Anything else stays
// unmatched, and the season leaves that player out. Queries are cached by their text, so a run that stops resumes.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { eaCountryName, EARLY_EXTRA_FIELDS, inLaterEdition, nameWords, namesAgree, teamCountry, wikidataNationality } from './lib/ea-early-seasons.mjs';
import { pinned, readExport, readLaterEditions, sha256Of } from './lib/ea-season-files.mjs';
import { isoDate, readRatingsRows } from './lib/ea-legacy-seasons.mjs';
import { politeFetch } from './lib/polite-fetch.mjs';
import { sparqlRequest, WIKIDATA_SPARQL } from './lib/wikidata-sparql.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUTPUT = path.join(root, 'scripts/data/ea-early-nationalities.json');
const CACHE = path.join(root, 'data-src/wikidata-early');
const SEARCH_ANSWERS = path.join(root, 'scripts/data/ea-early-search.json');
const LANGUAGES = '"en","mul","de","es","fr","it","pt","nl"';
const FOOTBALLER = 'wd:Q937857';
const SENIOR_TEAM = 'wd:Q135408445';
const NAME_ONLY_FROM = 70;
// How old a footballer can be in the season a name-only match has to fit.
const YOUNGEST = 17, OLDEST = 42;
// Queries that start from a list of people must run as written: left to itself, the query service starts from every
// footballer and times out.
const AS_WRITTEN = 'hint:Query hint:optimizer "None" .';
const DATES_PER_QUERY = 40, PEOPLE_PER_QUERY = 150, PAUSE_MS = 400;

const args = process.argv.slice(2);
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const refresh = args.includes('--refresh');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const inGroups = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** A request's JSON from the cache, or from QLever with a pause and retries (none after a refusal). */
async function ask(key, url, init) {
  const file = path.join(CACHE, `${sha256Of(key).slice(0, 24)}.json`);
  if (!refresh && existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await politeFetch(url, { ...init, signal: AbortSignal.timeout(120000) });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const data = await response.json();
      await mkdir(CACHE, { recursive: true });
      await writeFile(file, JSON.stringify(data));
      await sleep(PAUSE_MS);
      return data;
    } catch (error) {
      if (attempt === 4 || error.fatal) throw new Error(`Wikidata: ${error.message}`);
      await sleep(5000 * (attempt + 1));
    }
  }
}

const sparql = query => ask(query, WIKIDATA_SPARQL, sparqlRequest(query)).then(data => data.results.bindings);
const qid = binding => binding.value.split('/').pop();
const numeric = id => Number(id.slice(1));

/** Every footballer's spellings of their name, for those born on these days or with these ids: Map(id → { names, dobs }). */
async function footballers({ dates = [], ids = [] }) {
  const people = new Map();
  const groups = dates.length ? inGroups(dates, DATES_PER_QUERY) : inGroups(ids, PEOPLE_PER_QUERY);
  for (const group of groups) {
    const values = dates.length
      ? `VALUES ?dob { ${group.map(date => `"${date}T00:00:00Z"^^xsd:dateTime`).join(' ')} } ?p wdt:P569 ?dob ; wdt:P106 ${FOOTBALLER} .`
      : `VALUES ?p { ${group.map(id => `wd:${id}`).join(' ')} } ?p wdt:P106 ${FOOTBALLER} ; wdt:P569 ?dob .`;
    const rows = await sparql(`SELECT ?p ?dob ?name WHERE { ${dates.length ? '' : `${AS_WRITTEN} `}${values} { ?p rdfs:label ?name } UNION { ?p skos:altLabel ?name } FILTER(LANG(?name) IN (${LANGUAGES})) }`);
    for (const row of rows) {
      const id = qid(row.p);
      if (!people.has(id)) people.set(id, { names: new Set(), dobs: new Set() });
      people.get(id).names.add(row.name.value);
      people.get(id).dobs.add(row.dob.value.slice(0, 10));
    }
  }
  return people;
}

/** What Wikidata says these people's football nationality rests on: Map(id → { senior, sport, teams, citizenship }), as labels. */
async function statements(ids) {
  const found = new Map(ids.map(id => [id, { senior: [], sport: [], teams: [], citizenship: [] }]));
  for (const group of inGroups(ids, PEOPLE_PER_QUERY)) {
    const rows = await sparql(`SELECT ?p ?kind ?label WHERE { ${AS_WRITTEN} VALUES ?p { ${group.map(id => `wd:${id}`).join(' ')} }
      { ?p wdt:P1532 ?c . ?c rdfs:label ?label . BIND("sport" AS ?kind) } UNION { ?p wdt:P27 ?c . ?c rdfs:label ?label . BIND("citizenship" AS ?kind) }
      UNION { ?p wdt:P54 ?t . ?t wdt:P31 ${SENIOR_TEAM} ; rdfs:label ?label . BIND("senior" AS ?kind) }
      UNION { ?p wdt:P54 ?t . FILTER NOT EXISTS { ?t wdt:P31 ${SENIOR_TEAM} } ?t rdfs:label ?label . FILTER(CONTAINS(LCASE(?label), " national ")) BIND("teams" AS ?kind) }
      FILTER(LANG(?label) = "en") }`);
    for (const row of rows) found.get(qid(row.p))[row.kind.value].push(row.label.value);
  }
  return found;
}

/**
 * Day-precision birth dates of these people: Map(id → YYYY-MM-DD), from Wikidata's preferred statements. A date known only
 * to the year or month is not one, and nor is a person's where two statements disagree.
 */
async function exactBirthDates(ids) {
  const found = new Map();
  for (const group of inGroups(ids, PEOPLE_PER_QUERY)) {
    const rows = await sparql(`SELECT ?p ?dob WHERE { ${AS_WRITTEN} VALUES ?p { ${group.map(id => `wd:${id}`).join(' ')} }
      ?p p:P569 ?statement . ?statement a wikibase:BestRank ; psv:P569 ?value . ?value wikibase:timeValue ?dob ; wikibase:timePrecision 11 . }`);
    for (const row of rows) (found.get(qid(row.p)) || found.set(qid(row.p), new Set()).get(qid(row.p))).add(row.dob.value.slice(0, 10));
  }
  return new Map([...found].filter(([, dates]) => dates.size === 1).map(([id, [date]]) => [id, date]));
}

async function main() {
  const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/ea-seasons.json'), 'utf8'));
  const dataDir = path.resolve(option('data') ?? path.join(root, 'data-src'));
  const csv = path.resolve(option('csv') ?? path.join(dataDir, 'ea-leone', manifest.dataset.file));
  const rows = await readExport(manifest.dataset, csv);
  const later = await readLaterEditions(manifest, dataDir, rows);

  // One line per edition's row of a player no later edition names. A row keeps its own spelling and date.
  const needed = [];
  for (const edition of manifest.early.editions) {
    const file = path.join(dataDir, manifest.legacy.ratings.folder, edition.ratings.file);
    const ratings = readRatingsRows(await pinned(file, edition.ratings.sha256, `${edition.edition} ratings file`), { extraFields: EARLY_EXTRA_FIELDS });
    for (const row of ratings) {
      if (inLaterEdition(row, later)?.player) continue;
      needed.push({ eaId: Number(row.id), name: row.Fullname.trim(), dob: isoDate(row.birth_date), rating: Number(row.current_rating), year: 2000 + edition.fifaVersion, edition: edition.edition });
    }
  }
  console.log(`${needed.length} rows of ${new Set(needed.map(row => row.eaId)).size} players need a nationality`);

  // First pass: born that day, and the name agrees. 1 January is left to the second pass: it is usually a placeholder in
  // the ratings files, and Wikidata stores a date known only to the year as 1 January, so no query of that day finishes.
  const dates = [...new Set(needed.map(row => row.dob))].filter(date => !date.endsWith('-01-01')).sort();
  const born = await footballers({ dates });
  console.log(`${dates.length} birth dates: ${born.size} footballers`);
  const byDate = new Map();
  for (const [id, person] of born) for (const dob of person.dobs) (byDate.get(dob) || byDate.set(dob, []).get(dob)).push(id);
  for (const row of needed) {
    row.candidates = (byDate.get(row.dob) || []).filter(id => [...born.get(id).names].some(name => namesAgree(row.name, name)));
    row.match = 'birth date and name';
  }

  // Second pass, for the better players still unmatched: exactly one footballer of that name, of an age to be playing.
  const named = needed.filter(row => !row.candidates.length && row.rating >= NAME_ONLY_FROM && nameWords(row.name).filter(word => word.length > 1).length >= 2);
  console.log(`${named.length} rows rated ${NAME_ONLY_FROM}+ unmatched by birth date: searching by name (the pinned answers)`);
  const { answers: pinnedSearch } = JSON.parse(await readFile(SEARCH_ANSWERS, 'utf8'));
  let unsearched = 0;
  for (const row of named) {
    if (!Object.hasOwn(pinnedSearch, row.name)) unsearched++;
    row.search = pinnedSearch[row.name] ?? [];
  }
  if (unsearched) console.log(`  ${unsearched} of those names have no pinned search answer (${path.relative(root, SEARCH_ANSWERS)}): not searched`);
  const searched = [...new Set(named.flatMap(row => row.search))];
  const people = await footballers({ ids: searched });
  for (const row of named) {
    const fits = row.search.filter(id => people.has(id) && [...people.get(id).names].some(name => namesAgree(row.name, name))
      && [...people.get(id).dobs].some(dob => { const age = row.year - Number(dob.slice(0, 4)); return age >= YOUNGEST && age <= OLDEST; }));
    if (fits.length === 1) {
      row.candidates = fits;
      row.match = 'name';
    } else row.ambiguousNames = fits.length;
  }

  // Their nationality: every candidate of a row must say the same.
  const candidateIds = [...new Set(needed.flatMap(row => row.candidates))];
  const said = await statements(candidateIds);
  const unknownLabels = new Map();
  for (const person of said.values()) {
    for (const label of [...person.senior.map(teamCountry), ...person.sport, ...person.citizenship]) {
      if (eaCountryName(label) == null) unknownLabels.set(label, (unknownLabels.get(label) || 0) + 1);
    }
  }
  const checked = manifest.early.checked;
  const exact = await exactBirthDates([...new Set([...needed.filter(row => row.match === 'name').flatMap(row => row.candidates), ...checked.map(entry => entry.wikidata)])]);

  const unresolved = [];
  // Those checked by hand come first, and the rules do not ask about them again.
  const byPlayer = new Map(checked.map(({ eaId, names, nationality, wikidata }) => [eaId, { eaId, names: [...names], nationality, wikidata, evidence: 'checked', match: 'name',
    rating: 99, ...(exact.has(wikidata) ? { dob: exact.get(wikidata) } : {}) }]));
  for (const row of needed) {
    if (checked.some(entry => entry.eaId === row.eaId && entry.names.includes(row.name))) continue;
    const answers = row.candidates.map(id => ({ id, ...wikidataNationality(said.get(id)) })).filter(answer => answer.nationality);
    const nationalities = new Set(answers.map(answer => answer.nationality));
    if (nationalities.size !== 1 || answers.length !== row.candidates.length) {
      unresolved.push({ ...row, why: !row.candidates.length ? (row.ambiguousNames ? `${row.ambiguousNames} people of that name` : 'no match') : nationalities.size > 1 ? 'candidates disagree' : 'no single country' });
      continue;
    }
    const best = answers.sort((a, b) => numeric(a.id) - numeric(b.id))[0];
    const entry = byPlayer.get(row.eaId);
    if (entry && entry.wikidata !== best.id) {
      // One EA id, two people: FIFA 05 and FIFA 06 name different players. The better one keeps the entry.
      if (entry.rating >= row.rating) { unresolved.push({ ...row, why: `id is ${entry.names[0]} in another edition` }); continue; }
      unresolved.push({ eaId: entry.eaId, name: entry.names[0], rating: entry.rating, why: `id is ${row.name} in another edition` });
      byPlayer.delete(row.eaId);
    }
    if (byPlayer.has(row.eaId)) {
      const kept = byPlayer.get(row.eaId);
      if (!kept.names.includes(row.name)) kept.names.push(row.name);
      kept.rating = Math.max(kept.rating, row.rating);
    } else {
      byPlayer.set(row.eaId, { eaId: row.eaId, names: [row.name], nationality: best.nationality, wikidata: best.id, evidence: best.evidence, match: row.match,
        rating: row.rating, ...(row.match === 'name' && exact.has(best.id) ? { dob: exact.get(best.id) } : {}) });
    }
  }

  const ordered = [...byPlayer.values()].sort((a, b) => a.eaId - b.eaId).map(({ eaId, names, nationality, wikidata, evidence, match, dob }) =>
    ({ eaId, names: names.slice().sort(), nationality, wikidata, evidence, match, ...(dob ? { dob } : {}) }));
  const text = `${JSON.stringify({
    note: 'The nationalities of the FIFA 05 and FIFA 06 players no later EA edition names, from Wikidata. Written by scripts/sync-early-nationalities.mjs; docs/design/football-years.md describes the rules. evidence: P1532 country for sport, P54 the national teams played for, P27 citizenship. match: "birth date and name", or "name" where the ratings file\'s birth date is wrong, and then dob is Wikidata\'s.',
    source: { name: 'Wikidata', url: 'https://www.wikidata.org/', licence: 'CC0-1.0', retrieved: new Date().toISOString().slice(0, 10) },
    players: 'PLAYERS',
  }, null, 2).replace('"PLAYERS"', `[\n${ordered.map(entry => `    ${JSON.stringify(entry)}`).join(',\n')}\n  ]`)}\n`;
  await writeFile(OUTPUT, text);

  const count = (list, key) => list.reduce((map, item) => ({ ...map, [item[key]]: (map[item[key]] || 0) + 1 }), {});
  console.log(`Wrote ${ordered.length} players: ${JSON.stringify(count(ordered, 'evidence'))}, ${JSON.stringify(count(ordered, 'match'))}`);
  console.log(`SHA-256 ${sha256Of(text)}`);
  console.log(`Unresolved rows: ${unresolved.length}; ${JSON.stringify(count(unresolved.map(row => ({ why: row.why.replace(/^\d+ people.*/, 'several people of that name').replace(/^id is .*/, 'id names two people') })), 'why'))}`);
  console.log('Best unresolved:');
  for (const row of unresolved.filter(item => item.rating >= 76).sort((a, b) => b.rating - a.rating)) console.log(`  ${row.eaId} ${row.name} (${row.rating}, ${row.edition || ''}, ${row.dob || ''}): ${row.why}`);
  console.log('Country labels with no EA name:', [...unknownLabels].sort((a, b) => b[1] - a[1]).map(([label, n]) => `${label} (${n})`).join(', '));
}

main().catch(error => {
  console.error(`sync-early-nationalities: ${error.message}`);
  process.exitCode = 1;
});
