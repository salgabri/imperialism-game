// The built-in seasons before FIFA 07 (docs/design/football-years.md): FIFA 05 and FIFA 06. A FIFA Index mirror (daguizer
// on Kaggle, as for FIFA 07–14's ratings) gives EA's overall, positions, name and date of birth, but no nationality or
// club, and SoFIFA, which has them for later editions, starts with FIFA 07. So a player's nationality is the one the same
// EA id has in the nearest later edition, provided the id still names that person (EA reused some), and otherwise the one
// Wikidata gives (scripts/data/ea-early-nationalities.json, written by scripts/sync-early-nationalities.mjs). A player
// with neither is left out, and these seasons have nations only: nothing here says which club anyone played for.
// No I/O here: scripts/build-ea-seasons.mjs reads the files.
import { EA_SCALE } from '../../src/data/eaPlayers.js';
import { FOOTBALL_FEDERATIONS } from '../../src/data/footballFederations.js';
import { territoryFor } from '../../src/data/footballSetBuild.js';
import { NATIONS } from '../../src/data/teams.js';
import { EA_NATION_ALIASES, EA_NO_TEAM, SET_ID, assembleEaSeason } from './ea-seasons.mjs';
import { isoDate, legacyPositionKeys } from './ea-legacy-seasons.mjs';

/** The ratings files of these editions hold one field more per row than their header names, after every column read. */
export const EARLY_EXTRA_FIELDS = 1;
/** How many of the best players left out a season's audit names. */
const AUDITED_LEFT_OUT = 40;

const pad = n => String(n).padStart(2, '0');
// What a decoder writes for bytes it could not read.
const GARBLED = String.fromCharCode(0xfffd);
const nationIds = new Map(Object.entries(NATIONS).map(([nation, rec]) => [rec[0], nation]));
/** The game nation an EA nationality name plays for, or undefined (no such nation, or one with no shape). */
const nationOf = name => nationIds.get(EA_NATION_ALIASES[name] || name);
/** Whether an EA season can read this nationality name: a game nation, or one listed as having no team. */
export const knownNationality = name => nationOf(name) != null || EA_NO_TEAM.includes(name);

// ---------- is it the same person? ----------

// Letters that have no decomposition to a base letter.
const FOLDED = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' };

/** A name's words, in lower case without accents: "Raúl M. Sørensen-Ruiz" → ['raul', 'm', 'sorensen', 'ruiz']. */
export function nameWords(name) {
  return String(name).toLowerCase().replace(/[øæœßłđðþı]/g, letter => FOLDED[letter]).normalize('NFD').replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// The same word, its initial ("r" for "raul") or a shortening of at least three letters ("josh" for "joshua").
const wordsAgree = (a, b) => a === b || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b))
  || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));

/**
 * Whether two spellings can name one person: each word of the shorter agrees with its own word of the longer. "D. Brivio"
 * and "Pierluigi Brivio" do not, though they share a surname, and that is the point: EA gave that id to another Brivio.
 */
export function namesAgree(a, b) {
  const [fewer, more] = [nameWords(a), nameWords(b)].sort((x, y) => x.length - y.length);
  if (!fewer.length) return false;
  const left = [...more];
  return fewer.every(word => {
    const at = left.findIndex(other => wordsAgree(word, other));
    if (at < 0) return false;
    left.splice(at, 1);
    return true;
  });
}

/** Whether a later edition's player (`{ names, dob }`) is the person in this ratings row: the same birth date, or an agreeing name. */
export function samePerson(row, later) {
  const dob = isoDate(row.birth_date);
  return (dob != null && dob === later.dob) || later.names.some(name => namesAgree(row.Fullname, name));
}

// ---------- the later editions ----------

/**
 * One FIFA 07–14 edition as a later edition: the SoFIFA scrape's nationality and short name with the ratings file's full
 * name and date of birth, where it has that player. `clubs` and `ratings` are readClubRows' and readRatingsRows' rows.
 */
export function laterFromScrape(edition, clubs, ratings) {
  const rated = new Map(ratings.map(row => [row.id, row]));
  const players = new Map();
  for (const row of clubs) {
    const rating = rated.get(row.sofifa_id);
    players.set(Number(row.sofifa_id), { nationality: row.nationality.trim(),
      names: [row.short_name, rating?.Fullname].filter(Boolean).map(name => name.trim()), dob: rating ? isoDate(rating.birth_date) : null });
  }
  return { edition, players };
}

/** The FIFA 15 – EA FC 24 export's editions (`[{ fifaVersion, edition }]`) as later editions, a player's first row in each. */
export function laterFromExport(rows, editions) {
  const byVersion = new Map(editions.map(({ fifaVersion, edition }) => [fifaVersion, { edition, players: new Map() }]));
  for (const row of rows) {
    const players = byVersion.get(Number(row.fifa_version))?.players;
    if (!players || players.has(Number(row.player_id))) continue;
    players.set(Number(row.player_id), { nationality: row.nationality_name.trim(), names: [row.short_name, row.long_name].map(name => name.trim()), dob: row.dob || null });
  }
  return [...byVersion.values()];
}

/**
 * What the later editions (oldest first) say of a ratings row: `{ player, edition }`, the nearest edition that has its EA
 * id and agrees it is the same person; `{ reused: { edition, names } }` when that edition's id names someone else (every
 * later edition then does too); or null when no later edition has the id.
 */
export function inLaterEdition(row, later) {
  const eaId = Number(row.id);
  for (const { edition, players } of later) {
    const player = players.get(eaId);
    if (!player) continue;
    return samePerson(row, player) ? { player, edition } : { reused: { edition, names: player.names } };
  }
  return null;
}

// ---------- Wikidata ----------

/** Wikidata's country names that are not EA's, as EA's. Null: a state that does not tell which of the game's nations it is. */
export const WIKIDATA_COUNTRIES = Object.freeze({
  'Kingdom of the Netherlands': 'Netherlands', 'Kingdom of Denmark': 'Denmark', 'Realm of New Zealand': 'New Zealand',
  'United States of America': 'United States', "People's Republic of China": 'China PR', 'South Korea': 'Korea Republic', 'North Korea': 'Korea DPR',
  Ireland: 'Republic of Ireland', 'Republic of Ireland': 'Republic of Ireland', 'Northern Ireland': 'Northern Ireland',
  'Ivory Coast': "Côte d'Ivoire", 'Democratic Republic of the Congo': 'DR Congo', 'Republic of the Congo': 'Congo', 'Cape Verde': 'Cape Verde Islands',
  Taiwan: 'Chinese Taipei', 'Republic of China': 'Chinese Taipei', Czechia: 'Czech Republic', 'East Timor': 'Timor-Leste',
  'The Gambia': 'Gambia', 'State of Palestine': 'Palestine',
  // A state of its time, then the one that continued it.
  'West Germany': 'Germany', 'East Germany': 'Germany', 'German Democratic Republic': 'Germany', 'Federal Republic of Germany': 'Germany',
  'Federal Republic of Yugoslavia': 'Serbia', 'FR Yugoslavia': 'Serbia', 'Serbia and Montenegro': 'Serbia', 'Curaçao': 'Curacao',
  // Too wide to name a nation of the game.
  'United Kingdom': null, 'Kingdom of Great Britain': null, 'United Kingdom of Great Britain and Ireland': null,
  'Soviet Union': null, Czechoslovakia: null, Yugoslavia: null, 'Socialist Federal Republic of Yugoslavia': null, 'Kingdom of Yugoslavia': null,
});

/** EA's name of a Wikidata country label, or null: too wide, or nothing the game reads. */
export function eaCountryName(label) {
  const name = Object.hasOwn(WIKIDATA_COUNTRIES, label) ? WIKIDATA_COUNTRIES[label] : label;
  return name != null && knownNationality(name) ? name : null;
}

/** The country in a national team's name: "England men's national association football team" → "England". */
export const teamCountry = label => /^(.*?)\s+(?:men's\s+)?national\b/i.exec(label)?.[1] ?? label;

/**
 * A footballer's nationality from Wikidata, as `{ nationality, evidence }`, or null when it does not settle on one. In
 * order of how directly it speaks of who they played for: their senior national team (P54), their country for sport
 * (P1532), a youth or B national team (P54), citizenship (P27). A country for sport no citizenship backs does not count:
 * it is how a league's country gets mistaken for the player's (Robson Ponte, a Brazilian in Germany). Teams are named by
 * their labels, as Wikidata files England's under the United Kingdom. `senior` and `teams` are team labels, `sport` and
 * `citizenship` country labels.
 */
export function wikidataNationality({ senior = [], sport = [], teams = [], citizenship = [] }) {
  const names = labels => [...new Set(labels.map(eaCountryName).filter(Boolean))];
  const citizen = names(citizenship);
  const backed = names(sport).filter(name => !citizen.length || citizen.includes(name));
  for (const [found, evidence] of [[names(senior.map(teamCountry)), 'P54'], [backed, 'P1532'], [names(teams.map(teamCountry)), 'P54'], [citizen, 'P27']]) {
    if (found.length === 1) return { nationality: found[0], evidence };
    if (found.length > 1) return null;
  }
  return null;
}

/**
 * The Wikidata entries for the players who need one, read back as a Map by EA id. Each `{ eaId, names, nationality,
 * wikidata, evidence, match, dob? }` names the ratings files' spellings of that player, so an entry never reaches another
 * person who holds the same id in another edition.
 */
export function nationalityEntries(file) {
  if (!Array.isArray(file?.players)) throw new Error('The early nationalities file has no players');
  const entries = new Map();
  for (const entry of file.players) {
    const { eaId, names, nationality, wikidata, evidence, match, dob } = entry;
    if (!Number.isInteger(eaId) || !Array.isArray(names) || !names.length || !names.every(name => typeof name === 'string' && name.trim())
        || !/^Q\d+$/.test(wikidata) || !['P1532', 'P54', 'P27', 'checked'].includes(evidence) || !['birth date and name', 'name'].includes(match)
        || (dob != null && !/^\d{4}-\d{2}-\d{2}$/.test(dob))) {
      throw new Error(`Early nationality ${JSON.stringify(entry)} is incomplete`);
    }
    if (!knownNationality(nationality)) throw new Error(`Early nationality of ${eaId}: "${nationality}" is not a nationality the seasons read`);
    if (entries.has(eaId)) throw new Error(`Early nationality of ${eaId} is listed twice`);
    entries.set(eaId, entry);
  }
  return entries;
}

// ---------- the season ----------

const slugOf = name => nameWords(name).join('-').replace(/[^a-z0-9-]/g, '') || 'player';

/**
 * Build one FIFA 05 or FIFA 06 season. `ratings` are readRatingsRows' rows, `later` the later editions oldest first
 * (laterFromScrape, laterFromExport), `entries` nationalityEntries' Map; `edition` is the manifest's `{ id, fifaVersion,
 * edition, released }`. Options: `ratingsUrl` (the source's page), `nationalities` (a line naming where they come from)
 * and `federations`. Returns assembleEaSeason's `{ doc, text, audit, warnings }`.
 *
 * Each edition has one roster, numbered in SoFIFA's pattern (060001), and the season's date is the game's release. Where
 * a later edition has another birth date for the same person, the later one stands: these two files have many wrong dates
 * (Teddy Sheringham, born in 1966, is born in 1984). A nationality with no federation that year counts for the nation that
 * held its shape (Montenegro's for Serbia until 2006), or for no team where no nation did (Kosovo). Throws on an unknown
 * position code, a date that is no real day, damaged text, or a nationality with no game nation that is not listed as
 * having no team.
 */
export function buildEarlyEaSeason({ ratings, later, entries = new Map() }, edition, { ratingsUrl, nationalities, federations = FOOTBALL_FEDERATIONS } = {}) {
  const { id, fifaVersion, edition: label, released } = edition;
  if (!SET_ID.test(id)) throw new Error(`Season id ${id} is not like ea-fifa-06`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(released))) throw new Error(`${label}: release date ${released} is not YYYY-MM-DD`);
  const year = 2000 + fifaVersion;
  const territory = territoryFor(federations, year);
  const update = 1, roster = `${pad(fifaVersion)}0001`;
  const source = { provider: 'EA Sports', edition: label, update, roster, snapshotDate: released, url: ratingsUrl,
    ...(nationalities ? { nationalities } : {}), rawScale: EA_SCALE };

  const fromLater = {}, fromWikidata = {}, noFederation = {}, heldBy = {}, mappedCodes = {};
  const reused = [], leftOut = [];
  let datesCorrected = 0;
  const count = (map, key) => { map[key] = (map[key] || 0) + 1; };
  const records = [];
  for (const row of ratings) {
    const name = row.Fullname.trim();
    if (row.Fullname.includes(GARBLED)) throw new Error(`${label}: player ${row.id} has a damaged name ${JSON.stringify(row.Fullname)}`);
    const positions = legacyPositionKeys(row.preferred_positions);
    if (!positions) throw new Error(`${label}: player ${row.id} has positions ${row.preferred_positions}, a code neither EA's nor in LEGACY_POSITIONS`);
    const ownDob = isoDate(row.birth_date);
    if (!ownDob) throw new Error(`${label}: player ${row.id} has date of birth ${row.birth_date}`);

    const found = inLaterEdition(row, later);
    if (found?.reused) reused.push(`${row.id} ${name}: ${found.reused.edition} names ${found.reused.names.join(' / ')}`);
    const entry = entries.get(Number(row.id));
    let nationality, dob = ownDob;
    if (found?.player) {
      nationality = found.player.nationality;
      count(fromLater, found.edition);
      if (found.player.dob && found.player.dob !== ownDob) {
        dob = found.player.dob;
        datesCorrected++;
      }
    } else if (entry?.names.includes(name)) {
      nationality = entry.nationality;
      count(fromWikidata, entry.evidence);
      if (entry.dob && entry.dob !== ownDob) {
        dob = entry.dob;
        datesCorrected++;
      }
    } else {
      leftOut.push(row);
      continue;
    }

    const shape = nationOf(nationality);
    if (territory.inactive.includes(shape)) {
      count(noFederation, nationality);
      continue;
    }
    if (Object.hasOwn(territory.merged, shape)) {
      count(heldBy, `${nationality} → ${NATIONS[territory.merged[shape]][0]}`);
      nationality = NATIONS[territory.merged[shape]][0];
    }
    for (const pair of positions.mapped) count(mappedCodes, pair);
    records.push({ eaId: row.id, name, fullName: name, overall: row.current_rating, positions: row.preferred_positions, keys: positions.keys,
      dob, nationality, club: '', slug: slugOf(name), clubKey: null, league: null });
  }

  const best = leftOut.slice().sort((a, b) => Number(b.current_rating) - Number(a.current_rating) || a.Fullname.localeCompare(b.Fullname))
    .slice(0, AUDITED_LEFT_OUT).map(row => `${row.id} ${row.Fullname.trim()} (${row.current_rating})`);
  const auditExtra = {
    join: { ratingsRows: ratings.length, fromLater, fromWikidata, reusedIds: reused.length, leftOut: leftOut.length, datesCorrected, noFederation, heldBy },
    reused, leftOutBest: best,
    mappedPositions: Object.fromEntries(Object.entries(mappedCodes).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
  return assembleEaSeason(records, { id, year, edition: label, update, source, federations, auditExtra, noClubs: true });
}
