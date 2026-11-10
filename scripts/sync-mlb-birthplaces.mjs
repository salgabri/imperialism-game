// Birthplaces from MLB's own Stats API for the cards of the ShowZone seasons (MLB The Show 18 to 20) that neither their
// own card nor an edition within three of theirs places (docs/design/baseball.md, "Earlier seasons"): ShowZone keeps no
// birthplace for any MLB The Show 18 card, and a few of the later ones. Each such card is matched to one player of the
// 2016–2019 seasons (https://statsapi.mlb.com/api/v1/sports/1/players?season=<year>, MLB Advanced Media): by name, then
// by surname and a shortened first name ("Matt" for Matthew), then by surname, club and hands, always in the card's role
// (pitcher or not) and with its batting and throwing hands (ShowZone's records). A card one player matches takes his
// birthplace in The Show's words (a US state or a country); one no player or several do is listed with null and plays
// for his club only.
//
//   npm run sync:mlb-birthplaces             writes scripts/data/mlb-birthplaces.json (committed), read by
//                                            npm run build:mlb-seasons
//   npm run sync:mlb-birthplaces -- --check  rebuilds it from the cache and compares byte for byte, writes nothing
//
// The API's answers are cached in the ignored data-src/mlb-stats-api/ and pinned by SHA-256 in
// scripts/data/mlb-seasons.json (`statsApi`); a missing one is fetched once (four requests in all, 2 s apart).
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { editionOf, FREE_AGENTS, nameKey, nationOfBirthplace, nearestBirthplace, trustsBirthplace } from './lib/mlb.mjs';
import { showzoneCards } from './lib/showzone.mjs';
import { politeFetch } from './lib/polite-fetch.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, 'data-src/mlb-stats-api');
const output = path.join(root, 'scripts/data/mlb-birthplaces.json');
const PAUSE_MS = 2000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'Washington, DC', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', GU: 'Guam', VI: 'Virgin Islands', PR: 'Puerto Rico',
};
// The API's names for the countries The Show names otherwise.
const COUNTRIES = { VEN: 'Venezuela', DOM: 'Dominican Republic', NIR: 'Northern Ireland', 'Republic of Korea': 'South Korea',
  'U.S. Virgin Islands': 'Virgin Islands' };

/** A player's birthplace in The Show's words, or null when the API names none. */
function bornOf(person) {
  if (person.birthCountry === 'USA') return STATES[person.birthStateProvince] ?? null;
  return person.birthCountry ? COUNTRIES[person.birthCountry] ?? person.birthCountry : null;
}
const placeOf = person => [person.birthCity, person.birthStateProvince, person.birthCountry].filter(Boolean).join(', ');

/** The players of one season, as cached (and pinned) or, the first time, fetched. */
async function seasonPlayers(statsApi, season) {
  const name = `players-${season}.json`;
  const file = path.join(cacheDir, name);
  if (!existsSync(file)) {
    const url = statsApi.url.replace('<season>', season);
    const response = await politeFetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
    await sleep(PAUSE_MS);
  }
  const bytes = await readFile(file);
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== statsApi.sha256[name]) {
    throw new Error(`data-src/mlb-stats-api/${name} is not the pinned answer (sha256 ${sha}): if the API's new answer is meant, pin it in scripts/data/mlb-seasons.json`);
  }
  const body = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(body.people) || !body.people.length) throw new Error(`data-src/mlb-stats-api/${name} lists no players`);
  return body;
}

const pitches = position => position === 'SP' || position === 'RP' || position === 'CP';
const surname = name => nameKey(name.replace(/[\s.,]+(jr|sr|ii|iii|iv)\.?$/i, '').trim().split(/\s+/).pop());
const forename = name => nameKey(name.trim().split(/\s+/).slice(0, -1).join(' '));

/**
 * The one player `card` is, among `people` (the API's records, one a player a season, each with its `season` and
 * `team`), or the reason there is none: `{ person }` or `{ reason }`. `card` is `{ name, team (its club's name, or null
 * for a free agent), position, bats, throws, season }`. A player listed in several seasons counts once, as the season
 * nearest the card's lists him.
 */
function matchOf(card, people) {
  const once = list => [...list.reduce((by, person) => {
    const kept = by.get(person.id);
    const nearer = !kept || Math.abs(person.season - card.season) < Math.abs(kept.season - card.season)
      || (Math.abs(person.season - card.season) === Math.abs(kept.season - card.season) && person.season > kept.season);
    if (nearer) by.set(person.id, person);
    return by;
  }, new Map()).values()];
  // A pitcher's batting hand is no test: The Show and MLB often differ on it.
  const fits = [
    person => person.primaryPosition?.abbreviation === 'TWP' || (person.primaryPosition?.abbreviation === 'P') === pitches(card.position),
    person => !card.throws || person.pitchHand?.code === card.throws,
    person => !card.bats || pitches(card.position) || person.batSide?.code === card.bats,
  ];
  const narrow = list => fits.reduce((left, fit) => (left.length > 1 && left.some(fit) ? left.filter(fit) : left), list);
  const key = nameKey(card.name), last = surname(card.name), first = forename(card.name);
  const names = person => [person.fullName, `${person.useName} ${person.useLastName || person.lastName}`, `${person.firstName} ${person.lastName}`,
    person.nameFirstLast, person.firstLastName].filter(Boolean).map(nameKey);
  const firsts = person => [person.useName, person.firstName].filter(Boolean).map(nameKey);
  const shortened = person => first.length >= 3 && firsts(person).some(other => other.length >= 3 && (other.startsWith(first) || first.startsWith(other)));
  const passes = [
    once(people.filter(person => names(person).includes(key))),
    once(people.filter(person => nameKey(person.useLastName || person.lastName) === last && shortened(person))),
    once(people.filter(person => card.team && nameKey(person.useLastName || person.lastName) === last && person.season === card.season
      && person.team?.endsWith(card.team) && fits.every(fit => fit(person)))),
  ];
  for (const found of passes) {
    if (!found.length) continue;
    const left = narrow(found);
    if (left.length > 1) return { reason: `${left.length} players of that name, role and hands: ${left.map(person => person.id).join(', ')}` };
    if (fits.every(fit => fit(left[0]))) return { person: left[0] };
    return { reason: `the one player of that name, ${left[0].id}, differs in role or hands` };
  }
  return { reason: 'no player of that name' };
}

/** The file's text: one card a line, by season, then as its snapshot lists it. */
function fileText(source, seasons) {
  const lines = Object.entries(seasons).map(([season, cards]) => (Object.keys(cards).length ? `    "${season}": {\n${Object.entries(cards)
    .map(([uuid, row]) => `      ${JSON.stringify(uuid)}: ${JSON.stringify(row)}`).join(',\n')}\n    }` : `    "${season}": {}`));
  return `{\n  "note": ${JSON.stringify(NOTE)},\n  "source": ${JSON.stringify(source)},\n  "seasons": {\n${lines.join(',\n')}\n  }\n}\n`;
}
const NOTE = 'Birthplaces from MLB\'s Stats API for the cards of MLB The Show 18 to 20 (ShowZone\'s copies) that neither their own card nor an edition within three of theirs places, by season and card uuid: [card name, birthplace in The Show\'s words, MLB player id, the API\'s birthplace], or [card name, null, null, why no player matches]. Written by npm run sync:mlb-birthplaces; read by npm run build:mlb-seasons.';

async function main() {
  const check = process.argv.includes('--check');
  const unknown = process.argv.slice(2).filter(arg => arg !== '--check');
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/mlb-seasons.json'), 'utf8'));
  const { statsApi, showzone } = manifest;
  const unreliable = manifest.unreliableBirthplaces || {};
  const snapshots = new Map();
  for (const year of [...manifest.seasons, manifest.builtIn.year]) {
    snapshots.set(year, JSON.parse(await readFile(path.join(root, `scripts/data/mlb-the-show-${editionOf(year)}.json`), 'utf8')));
  }
  const people = [];
  let copyright = null;
  for (const season of statsApi.seasons) {
    const body = await seasonPlayers(statsApi, season);
    copyright = body.copyright;
    for (const person of body.people) people.push({ ...person, season, team: person.currentTeam?.name ?? null });
  }
  const seasons = {};
  for (const year of statsApi.for) {
    const hands = new Map((await showzoneCards(root, showzone, year)).map(card => [card.tsnId, card]));
    const snapshot = snapshots.get(year);
    const cards = {};
    for (const row of snapshot.players) {
      const [uuid, name, team, position, , , born] = row;
      if (trustsBirthplace(born, year, unreliable) || nearestBirthplace(snapshots, year, row, unreliable)) continue;
      const own = hands.get(uuid);
      if (!own) throw new Error(`${snapshot.source.edition}: ShowZone has no card ${uuid} (${name})`);
      const card = { name, team: team === FREE_AGENTS ? null : snapshot.teams[team], position, bats: own.batHand, throws: own.throwHand, season: year };
      const { person, reason } = matchOf(card, people);
      if (person) {
        const place = bornOf(person);
        cards[uuid] = place ? [name, place, person.id, placeOf(person)] : [name, null, person.id, `the API names no birthplace for ${person.fullName}`];
      } else {
        cards[uuid] = [name, null, null, reason];
      }
    }
    seasons[year] = cards;
    const rows = Object.values(cards);
    console.log(`${snapshot.source.edition}: ${rows.length} cards to place, ${rows.filter(r => r[1]).length} placed (`
      + `${rows.filter(r => r[1] && nationOfBirthplace(r[1])).length} in a nation the game knows); unmatched: ${rows.filter(r => !r[1]).map(r => `${r[0]} (${r[3]})`).join('; ') || 'none'}`);
  }
  const source = { name: 'MLB Stats API', provider: 'MLB Advanced Media', url: statsApi.url, seasons: statsApi.seasons, retrieved: statsApi.retrieved, copyright };
  const text = fileText(source, seasons);
  if (check) {
    const current = existsSync(output) ? (await readFile(output, 'utf8')).replace(/\r\n/g, '\n') : null;
    if (current !== text) throw new Error(`differs: ${path.relative(root, output)}`);
    console.log('Verified scripts/data/mlb-birthplaces.json byte for byte.');
    return;
  }
  await writeFile(output, text);
  console.log(`Wrote ${path.relative(root, output)}`);
}

main().catch(error => {
  console.error(`sync-mlb-birthplaces: ${error.message}`);
  process.exitCode = 1;
});
