// EA FC 25 (2024/25), the season between the FIFA 15 – EA FC 24 export and the EA FC 26 snapshot
// (docs/design/football-years.md). No one file holds it whole:
//
// - An export of EA's own ratings website a week after release (nyagami on Kaggle) gives each player's overall,
//   positions, name, nationality, league and launch club. It has no date of birth, and it names clubs as EA's website
//   does, which is not how the other seasons name them: Inter is "Lombardia FC", Paris Saint-Germain "Paris SG".
// - A SoFIFA scrape of June 2025 (aniss7 on Kaggle) gives the date of birth, full name and SoFIFA's club name for most
//   of the same EA ids.
//
// The two are joined by EA id, and EA's age on the website must agree with the June date of birth. The June file's club
// names only name the launch clubs: each takes the name most of its players carry in June, so a winter transfer moves
// nobody. Players link to SoFIFA's release roster of the edition, as FIFA 15 – EA FC 24's do. No I/O here:
// scripts/build-ea-seasons.mjs reads the files.
import { EA_ROLES, EA_SCALE } from '../../src/data/eaPlayers.js';
import { EA_LEAGUES, SET_ID, assembleEaSeason } from './ea-seasons.mjs';
import { parseCsv } from './football-data.mjs';

/** The club layer's seven leagues as EA's website names them, by EA's competition id (EA_LEAGUES). */
export const SITE_LEAGUES = Object.freeze({
  'Premier League': 13, 'LALIGA EA SPORTS': 53, 'Serie A Enilive': 31, Bundesliga: 19, "Ligue 1 McDonald's": 16,
  Eredivisie: 10, 'Liga Portugal': 308,
});
/** The website export's columns the build reads. */
export const SITE_COLUMNS = ['Name', 'OVR', 'Position', 'Alternative positions', 'Age', 'Nation', 'League', 'Team', 'url'];
/** The later SoFIFA scrape's columns the build reads. */
export const LATER_COLUMNS = ['player_id', 'dob', 'full_name', 'club_name'];
/** How many of a launch club's players the June file must hold before it can name the club. */
const NAMING_PLAYERS = 5;

// A player's page on EA's website: /player-ratings/<slug>/<EA id>.
const SITE_PLAYER = /^https:\/\/www\.ea\.com\/games\/ea-sports-fc\/ratings\/player-ratings\/([a-z0-9-]+)\/(\d{1,10})\/?$/;
// A letter of another script than Latin. Spaces, punctuation and combining accents belong to every script.
const NOT_LATIN = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;

/** Whether `text` is a real day, YYYY-MM-DD. */
const isDay = text => /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;

function columnsOf(header, columns, what) {
  return columns.map(name => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`${what} has no "${name}" column`);
    return index;
  });
}

/** The website export's rows as objects holding only SITE_COLUMNS. Throws on a row that does not line up with the header. */
export function readSiteRows(text) {
  const [header, ...rows] = parseCsv(text);
  const at = columnsOf(header, SITE_COLUMNS, 'The ratings file');
  return rows.map((row, i) => {
    if (row.length !== header.length) throw new Error(`Ratings row ${i + 2} has ${row.length} fields; expected ${header.length}`);
    return Object.fromEntries(SITE_COLUMNS.map((name, k) => [name, row[at[k]]]));
  });
}

/**
 * The later scrape by EA id: `{ rows: Map(id → { dob, fullName, club }), unreadable, repeats }`. A row that does not line
 * up with the header is skipped and counted in `unreadable` (the June 2025 file has 85, two fields short). An id listed
 * twice must say the same both times; `repeats` counts the copies. Throws on an id or date of birth it cannot read.
 */
export function readLaterRows(text) {
  const [header, ...rows] = parseCsv(text);
  const at = columnsOf(header, LATER_COLUMNS, 'The later file');
  const byId = new Map();
  let unreadable = 0, repeats = 0;
  for (const row of rows) {
    if (row.length !== header.length) {
      unreadable++;
      continue;
    }
    const [id, dob, fullName, club] = at.map(k => row[k]);
    if (!/^\d{1,10}$/.test(id) || !isDay(dob)) throw new Error(`The later file's row for ${JSON.stringify(id)} has date of birth ${JSON.stringify(dob)}`);
    const record = { dob, fullName: fullName.trim(), club: club.trim() };
    const seen = byId.get(id);
    if (!seen) byId.set(id, record);
    else if (JSON.stringify(seen) === JSON.stringify(record)) repeats++;
    else throw new Error(`The later file lists EA id ${id} twice, differently`);
  }
  return { rows: byId, unreadable, repeats };
}

/**
 * A full name without the same name in another script glued to its end ("Hakim Ziyechحكيم زياش" → "Hakim Ziyech"), or
 * '' when no Latin part stands alone (a name only in another script, or scripts that alternate).
 */
export function latinPart(text) {
  const name = String(text || '').trim();
  const cut = name.search(NOT_LATIN);
  if (cut < 0) return name;
  if (/\p{Script=Latin}/u.test(name.slice(cut))) return '';
  return name.slice(0, cut).trim();
}

/** Age in whole years on `day` of someone born on `dob`, both YYYY-MM-DD. */
export function ageOn(dob, day) {
  const [y, m, d] = dob.split('-').map(Number), [Y, M, D] = day.split('-').map(Number);
  return Y - y - (M < m || (M === m && D < d) ? 1 : 0);
}

/**
 * Whether EA's age on the website fits a date of birth on the data's day: the same, or a year less, since the website
 * counts age from an earlier day of the year (427 of the 13,453 joined players are a year younger there).
 */
export const ageFits = (age, dob, day) => [0, -1].includes(Number(age) - ageOn(dob, day));

/**
 * The name each launch club takes (Map clubKey → name): the June name more than half of its players there carry. Throws
 * when a club has fewer than NAMING_PLAYERS players there, no name has a majority, or two clubs would take one name.
 */
export function clubNames(players, label) {
  const votes = new Map();
  for (const { clubKey, match } of players) {
    if (!clubKey) continue;
    const tally = votes.get(clubKey) || votes.set(clubKey, new Map()).get(clubKey);
    if (match?.club) tally.set(match.club, (tally.get(match.club) || 0) + 1);
  }
  const names = new Map(), taken = new Map();
  for (const [clubKey, tally] of votes) {
    const total = [...tally.values()].reduce((sum, n) => sum + n, 0);
    const [name, n] = [...tally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0] || ['', 0];
    const team = clubKey.slice(clubKey.indexOf(':') + 1);
    if (total < NAMING_PLAYERS) throw new Error(`${label}: only ${total} players of ${team} are in the later file, too few to name it`);
    if (n * 2 <= total) throw new Error(`${label}: ${team}'s players carry no one name in the later file (${name} ${n} of ${total})`);
    if (taken.has(name)) throw new Error(`${label}: ${team} and ${taken.get(name)} would both be ${name}`);
    taken.set(name, team);
    names.set(clubKey, name);
  }
  return names;
}

/**
 * Build one season from the website export's rows (readSiteRows) and the later scrape (readLaterRows). `edition` is the
 * manifest's `{ id, fifaVersion, edition, update, roster, snapshotDate }`: the roster is SoFIFA's release roster, which
 * the players link to, and the snapshot date the export's. Options: `ratingsUrl` (the export's page) and `federations`.
 * Returns assembleEaSeason's `{ doc, text, audit, warnings }`.
 *
 * A player the June file lacks, or whose age there disagrees with EA's, has no date of birth and EA's name as full name.
 * Every one of the seven leagues must have its clubs. Throws on a link, position or overall EA's format does not allow,
 * an id listed twice, or a club the June file cannot name.
 */
export function buildSiteEaSeason({ ratings, later }, edition, { ratingsUrl, federations } = {}) {
  const { id, fifaVersion, edition: label, update, roster, snapshotDate } = edition;
  if (!SET_ID.test(id)) throw new Error(`Season id ${id} is not like ea-fc-25`);
  if (!isDay(snapshotDate)) throw new Error(`${label}: snapshot date ${snapshotDate} is not YYYY-MM-DD`);
  if (!new RegExp(`^${fifaVersion}\\d{4}$`).test(roster) || Number(roster.slice(2)) !== update) {
    throw new Error(`${label}: roster ${roster} is not update ${update} of FIFA ${fifaVersion} in SoFIFA's pattern (${fifaVersion}000${update})`);
  }
  const source = { provider: 'EA Sports', edition: label, update, roster, snapshotDate, url: ratingsUrl, rawScale: EA_SCALE };

  const seen = new Set(), players = [];
  let joined = 0, ageMismatch = 0, fullNamesTrimmed = 0;
  for (const row of ratings) {
    const link = SITE_PLAYER.exec(row.url);
    if (!link) throw new Error(`${label}: ${row.Name} links to ${JSON.stringify(row.url)}`);
    const [, slug, eaId] = link;
    if (seen.has(eaId)) throw new Error(`${label}: EA id ${eaId} is listed twice`);
    seen.add(eaId);
    const keys = [...new Set([row.Position, ...row['Alternative positions'].split(',')].map(key => key.trim()).filter(Boolean))];
    if (!keys.length || keys.some(key => !Object.hasOwn(EA_ROLES, key))) throw new Error(`${label}: ${row.Name} has positions ${keys.join(', ')}`);
    if (!/^\d{1,2}$/.test(row.Age)) throw new Error(`${label}: ${row.Name} is aged ${JSON.stringify(row.Age)}`);
    let match = later.rows.get(eaId) || null;
    if (match && !ageFits(row.Age, match.dob, snapshotDate)) {
      ageMismatch++;
      match = null;
    }
    let fullName = '';
    if (match) {
      joined++;
      fullName = latinPart(match.fullName);
      if (fullName !== match.fullName) fullNamesTrimmed++;
    }
    const leagueId = SITE_LEAGUES[row.League];
    players.push({ row, eaId, slug, keys, match, fullName, clubKey: leagueId ? `${leagueId}:${row.Team.trim()}` : null, leagueId });
  }

  const names = clubNames(players, label);
  const records = players.map(({ row, eaId, slug, keys, match, fullName, clubKey, leagueId }) => ({
    eaId, name: row.Name, fullName: fullName || row.Name, overall: row.OVR, positions: keys.join(', '), keys,
    dob: match?.dob || '', nationality: row.Nation, club: clubKey ? names.get(clubKey) : row.Team, slug,
    clubKey, league: clubKey ? EA_LEAGUES[leagueId] : null,
  }));
  const renamed = [...names].map(([clubKey, name]) => [clubKey.slice(clubKey.indexOf(':') + 1), name])
    .filter(([team, name]) => team !== name).sort(([a], [b]) => (a < b ? -1 : 1));
  const auditExtra = {
    join: { ratingsRows: ratings.length, laterIds: later.rows.size, laterUnreadable: later.unreadable, laterRepeats: later.repeats,
      joined, ageMismatch, withoutLater: ratings.length - joined, fullNamesTrimmed },
    clubNames: Object.fromEntries(renamed),
  };
  return assembleEaSeason(records, { id, year: 2000 + fifaVersion, edition: label, update, source, federations, auditExtra, everyLeague: true });
}
