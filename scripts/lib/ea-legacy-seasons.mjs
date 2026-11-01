// The built-in seasons before FIFA 15 (docs/design/football-years.md): FIFA 07 to FIFA 14, one roster each, from two
// scrapes of EA's rosters joined by EA's player id. A FIFA Index mirror (daguizer on Kaggle) gives EA's overall,
// positions, full name and date of birth, but no nationality or club. A SoFIFA scrape (Big-Data-FC on GitHub) gives
// the nationality, club, league, short name and the player's SoFIFA page; its own rating (`bov`) is SoFIFA's best
// overall at any position, not EA's, and is never read. A player missing from either file is left out, nothing is
// borrowed from another edition, and the players EA renamed with invented names are left out by the manifest's
// documented list. No I/O here: scripts/build-ea-seasons.mjs reads the files and checks them against their SHA-256.
import { EA_ROLES, EA_SCALE } from '../../src/data/eaPlayers.js';
import { FOOTBALL_FEDERATIONS } from '../../src/data/footballFederations.js';
import { EA_LEAGUES, SET_ID, assembleEaSeason } from './ea-seasons.mjs';
import { parseCsv } from './football-data.mjs';

/**
 * FIFA Index's position codes that EA's modern codes (EA_ROLES) do not have, as those codes. Its FIFA 07–10 files use
 * LWM / RWM for the wide players and have no LW / RW; SW, LF and RF last until FIFA 11.
 */
export const LEGACY_POSITIONS = Object.freeze({
  SW: 'CB', LCB: 'CB', RCB: 'CB',
  LDM: 'CDM', RDM: 'CDM', LCDM: 'CDM', RCDM: 'CDM',
  LCM: 'CM', RCM: 'CM',
  LAM: 'CAM', RAM: 'CAM', LCAM: 'CAM', RCAM: 'CAM',
  LWM: 'LM', RWM: 'RM',
  LF: 'CF', RF: 'CF',
  LS: 'ST', RS: 'ST',
});

/** The ratings file's columns the build reads (semicolon-separated, one row per player). */
export const RATINGS_COLUMNS = ['id', 'Fullname', 'current_rating', 'birth_date', 'preferred_positions'];
/** The clubs file's columns the build reads (comma-separated). */
export const CLUBS_COLUMNS = ['sofifa_id', 'player_url', 'short_name', 'nationality', 'club_name', 'league_name'];

// A player's page on one SoFIFA roster, as Big-Data-FC stores it.
const CLUB_LINK = /^\/player\/(\d{1,10})\/([a-z0-9-]+)\/(\d{6})\/$/;
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
// What a decoder writes for bytes it could not read.
const GARBLED = String.fromCharCode(0xfffd);
const pad = n => String(n).padStart(2, '0');

/** YYYY-MM-DD of a real calendar day, or null. */
function isoDay(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${pad(month)}-${pad(day)}` : null;
}

/** FIFA Index's dd/mm/yyyy as YYYY-MM-DD, or null when it is not a real day. */
export function isoDate(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(text));
  return m ? isoDay(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

/**
 * A ratings file's rows as objects of RATINGS_COLUMNS. The FIFA 11–14 files name one column more than their rows
 * hold (the attributes after `composure` shift by one) and FIFA 11's last row is cut short; the columns read here all
 * come before both, so a row needs only those.
 */
export function readRatingsRows(text) {
  const lines = text.split('\n').map(line => line.replace(/\r$/, ''));
  if (lines.at(-1) === '') lines.pop();
  const header = lines[0].split(';');
  const at = RATINGS_COLUMNS.map(name => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`The ratings file has no "${name}" column`);
    return index;
  });
  const needed = Math.max(...at) + 1;
  return lines.slice(1).map((line, i) => {
    const fields = line.split(';');
    if (fields.length < needed || fields.length > header.length) throw new Error(`Ratings row ${i + 2} has ${fields.length} fields`);
    return Object.fromEntries(RATINGS_COLUMNS.map((name, k) => [name, fields[at[k]]]));
  });
}

/** A clubs file's rows as objects of CLUBS_COLUMNS, without its exact duplicate rows: `{ rows, duplicates }`. */
export function readClubRows(text) {
  const [header, ...rows] = parseCsv(text);
  const at = CLUBS_COLUMNS.map(name => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`The clubs file has no "${name}" column`);
    return index;
  });
  const seen = new Set(), unique = [];
  rows.forEach((row, i) => {
    if (row.length !== header.length) throw new Error(`Clubs row ${i + 2} has ${row.length} fields; expected ${header.length}`);
    const key = JSON.stringify(row);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(Object.fromEntries(CLUBS_COLUMNS.map((name, k) => [name, row[at[k]]])));
  });
  return { rows: unique, duplicates: rows.length - unique.length };
}

/**
 * SoFIFA's roster dates (`{ data: [['Aug 30, 2006', …, 'FIFA 07'], …] }`, each edition's rosters in order, so the
 * n-th date of FIFA 07 is roster 07000n) as `{ 'FIFA 07': ['2006-08-30', '2007-02-22'], … }`. A row that names its
 * roster id (FIFA 15's later rows do) must sit at that place; a date that does not parse is kept as null.
 */
export function rosterDates(data) {
  if (!Array.isArray(data?.data)) throw new Error('The roster dates have no data list');
  const byEdition = {};
  for (const row of data.data) {
    const [text, , , , , roster, edition] = row;
    if (typeof edition !== 'string') throw new Error(`Roster date ${JSON.stringify(row)} names no edition`);
    const list = (byEdition[edition] ||= []);
    const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(String(text));
    list.push(m && MONTHS[m[1]] ? isoDay(Number(m[3]), MONTHS[m[1]], Number(m[2])) : null);
    const version = /(\d{2})$/.exec(edition)?.[1];
    if (roster && version && String(roster) !== `${version}${String(list.length).padStart(4, '0')}`) {
      throw new Error(`Roster date ${JSON.stringify(row)} is number ${list.length} of ${edition}, not roster ${roster}`);
    }
  }
  return byEdition;
}

/** The date of one roster of an edition ('FIFA 07', '070002' → '2007-02-22'). */
export function rosterDate(dates, edition, roster) {
  const date = dates[edition]?.[Number(String(roster).slice(2)) - 1];
  if (!date) throw new Error(`${edition}: the roster dates give no date for roster ${roster}`);
  return date;
}

/**
 * FIFA Index's positions ('CF-ST-RW') as EA's modern codes, legacy ones mapped and repeats dropped: `{ keys, mapped }`,
 * or null when a code is neither EA's nor in LEGACY_POSITIONS.
 */
export function legacyPositionKeys(text) {
  const codes = String(text).split('-');
  const keys = [], mapped = [];
  for (const code of codes) {
    const key = Object.hasOwn(LEGACY_POSITIONS, code) ? LEGACY_POSITIONS[code] : code;
    if (!Object.hasOwn(EA_ROLES, key)) return null;
    if (key !== code) mapped.push(`${code}→${key}`);
    if (!keys.includes(key)) keys.push(key);
  }
  return { keys, mapped };
}

/**
 * The manifest's exclusions (`[{ player, evidence, records: [{ edition, eaId, name }] }]`) as one record per edition:
 * `[{ edition, eaId, name, player }]`. Each group must say whom EA's invented names stand for and how that is known.
 */
export function legacyExclusions(groups = []) {
  const seen = new Set();
  return groups.flatMap(group => {
    if (typeof group?.player !== 'string' || !group.player.trim() || typeof group.evidence !== 'string' || !group.evidence.trim()
        || !Array.isArray(group.records) || !group.records.length) {
      throw new Error(`Exclusion ${JSON.stringify(group?.player)} must name the player, its evidence and its records`);
    }
    return group.records.map(({ edition, eaId, name }) => {
      if (typeof edition !== 'string' || !Number.isInteger(eaId) || typeof name !== 'string' || !name.trim()) {
        throw new Error(`Exclusion of ${group.player}: record ${JSON.stringify({ edition, eaId, name })} is incomplete`);
      }
      if (seen.has(`${edition} ${eaId}`)) throw new Error(`${edition}: player ${eaId} is excluded twice`);
      seen.add(`${edition} ${eaId}`);
      return { edition, eaId, name, player: group.player };
    });
  });
}

/**
 * Build one FIFA 07–14 season. `ratings` are readRatingsRows' rows, `clubs` readClubRows' rows (`clubDuplicates` the
 * exact duplicates it dropped); `edition` is the manifest's `{ id, fifaVersion, edition, ratings: { roster },
 * clubs: { roster }, leagues: { game league: [SoFIFA names] } }`. Options: `ratingsUrl` and `clubsUrl` (the sources'
 * pages), `dates` (rosterDates), `exclusions` (legacyExclusions) and `federations`. Returns assembleEaSeason's
 * `{ doc, text, audit, warnings }`. Throws on an unknown position code, a malformed or damaged row, rows from another
 * roster, a league name the clubs file does not hold, a league left with no club, a nationality with no game nation
 * that is not listed as having no team, or an exclusion that names no player of the edition.
 */
export function buildLegacyEaSeason({ ratings, clubs, clubDuplicates = 0 }, edition, {
  ratingsUrl, clubsUrl, dates, exclusions = [], federations = FOOTBALL_FEDERATIONS,
} = {}) {
  const { id, fifaVersion, edition: label, leagues } = edition;
  if (!SET_ID.test(id)) throw new Error(`Season id ${id} is not like ea-fifa-07`);
  const version = pad(fifaVersion);
  const ratingsRoster = String(edition.ratings?.roster), clubsRoster = String(edition.clubs?.roster);
  for (const roster of [ratingsRoster, clubsRoster]) {
    if (!new RegExp(`^${version}\\d{4}$`).test(roster)) throw new Error(`${label}: roster ${roster} is not one of ${label}'s`);
  }
  const snapshotDate = rosterDate(dates, label, clubsRoster);
  const ratingsDate = ratingsRoster === clubsRoster ? null : rosterDate(dates, label, ratingsRoster);
  const update = Number(clubsRoster.slice(2));
  const source = { provider: 'EA Sports', edition: label, update, roster: clubsRoster, snapshotDate,
    ...(ratingsDate ? { ratingsDate } : {}), url: ratingsUrl, clubsUrl, rawScale: EA_SCALE };

  // readClubRows has dropped the clubs file's exact duplicates, so a player found twice there has two different rows.
  const byId = (rows, key, what, twice) => {
    const map = new Map();
    for (const row of rows) {
      const playerId = row[key];
      if (!/^\d{1,10}$/.test(playerId)) throw new Error(`${label}: the ${what} file has player id ${JSON.stringify(playerId)}`);
      if (map.has(Number(playerId))) throw new Error(`${label}: the ${what} file ${twice} ${playerId}`);
      map.set(Number(playerId), row);
    }
    return map;
  };
  const rated = byId(ratings, 'id', 'ratings', 'repeats player');
  const placed = byId(clubs, 'sofifa_id', 'clubs', 'has two different rows for player');
  const rosters = new Set(), links = new Map();
  for (const [playerId, row] of placed) {
    const link = CLUB_LINK.exec(row.player_url);
    if (!link || Number(link[1]) !== playerId) throw new Error(`${label}: player ${playerId} links to ${JSON.stringify(row.player_url)}`);
    rosters.add(link[3]);
    links.set(playerId, link[2]);
  }
  if (rosters.size !== 1 || !rosters.has(clubsRoster)) throw new Error(`${label}: the clubs file holds rosters ${[...rosters].join(', ')}, not ${clubsRoster}`);

  // The seven leagues by SoFIFA's names in this edition: each name must be one the clubs file uses.
  const gameLeagues = Object.values(EA_LEAGUES);
  const named = Object.keys(leagues || {});
  if (named.length !== gameLeagues.length || gameLeagues.some(([league]) => !named.includes(league))) {
    throw new Error(`${label}: the league table names ${named.join(', ') || 'no league'}, not the seven game leagues`);
  }
  const used = new Set([...placed.values()].map(row => row.league_name));
  const leagueOf = new Map();
  for (const entry of gameLeagues) {
    const names = leagues[entry[0]];
    if (!Array.isArray(names) || !names.length) throw new Error(`${label}: the league table gives ${entry[0]} no SoFIFA name`);
    for (const name of names) {
      if (!used.has(name)) throw new Error(`${label}: no player of the clubs file is in "${name}" (${entry[0]})`);
      if (leagueOf.has(name)) throw new Error(`${label}: "${name}" is named for two leagues`);
      leagueOf.set(name, entry);
    }
  }

  // The join, in EA id order. The players EA renamed with invented names are left out, each named as the data spells it.
  const joined = [...rated.keys()].filter(playerId => placed.has(playerId)).sort((a, b) => a - b);
  const mine = exclusions.filter(exclusion => exclusion.edition === label);
  const excluded = new Map();
  for (const exclusion of mine) {
    const row = placed.has(exclusion.eaId) ? rated.get(exclusion.eaId) : null;
    if (!row) throw new Error(`${label}: the exclusion of ${exclusion.eaId} (${exclusion.name}) names no player of this edition`);
    if (row.Fullname.trim() !== exclusion.name) throw new Error(`${label}: player ${exclusion.eaId} is ${row.Fullname.trim()}, not ${exclusion.name}`);
    excluded.set(exclusion.eaId, exclusion);
  }

  const mappedCodes = {}, namesFromRatings = [];
  const records = joined.filter(playerId => !excluded.has(playerId)).map(playerId => {
    const rating = rated.get(playerId), club = placed.get(playerId);
    const positions = legacyPositionKeys(rating.preferred_positions);
    if (!positions) throw new Error(`${label}: player ${playerId} has positions ${rating.preferred_positions}, a code neither EA's nor in LEGACY_POSITIONS`);
    for (const pair of positions.mapped) mappedCodes[pair] = (mappedCodes[pair] || 0) + 1;
    const dob = isoDate(rating.birth_date);
    if (!dob) throw new Error(`${label}: player ${playerId} has date of birth ${rating.birth_date}`);
    // A character the scrape could not decode (U+FFFD) is a damaged field: the build stops on one, except in the
    // clubs file's short name, where EA's full name from the ratings file stands in and the audit says so.
    let name = club.short_name;
    for (const [field, text] of [['full name', rating.Fullname], ['nationality', club.nationality], ['club', club.club_name]]) {
      if (text.includes(GARBLED)) throw new Error(`${label}: player ${playerId} has a damaged ${field} ${JSON.stringify(text)}`);
    }
    if (name.includes(GARBLED)) {
      namesFromRatings.push(`${playerId} ${JSON.stringify(name)} → ${JSON.stringify(rating.Fullname.trim())}`);
      name = rating.Fullname;
    }
    return {
      eaId: String(playerId), name, fullName: rating.Fullname, overall: rating.current_rating,
      positions: rating.preferred_positions, keys: positions.keys, dob, nationality: club.nationality, club: club.club_name,
      slug: links.get(playerId), clubKey: club.club_name.trim() || null, league: leagueOf.get(club.league_name) || null,
    };
  });

  const auditExtra = {
    ratingsRoster, ...(ratingsDate ? { ratingsDate } : {}),
    join: { ratingsRows: ratings.length, clubsRows: clubs.length, clubsDuplicates: clubDuplicates, joined: joined.length,
      ratingsOnly: rated.size - joined.length, clubsOnly: placed.size - joined.length, excluded: excluded.size },
    excluded: [...excluded.values()].map(exclusion => `${exclusion.eaId} ${exclusion.name} (stands for ${exclusion.player})`),
    mappedPositions: Object.fromEntries(Object.entries(mappedCodes).sort(([a], [b]) => (a < b ? -1 : 1))),
    namesFromRatings,
  };
  return assembleEaSeason(records, { id, year: 2000 + fifaVersion, edition: label, update, source, federations, auditExtra, everyLeague: true });
}
