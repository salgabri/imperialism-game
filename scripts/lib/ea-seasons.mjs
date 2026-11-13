// The built-in earlier football seasons (docs/design/football-years.md): one roster of one EA FIFA / FC edition
// becomes that season's national squads, top-flight clubs and territory, in the data set format the game loads
// (src/engine/footballSets.js, kind 'ea'). No I/O here: scripts/build-ea-seasons.mjs reads the sources and writes the
// files, and tests build seasons from invented rows. Every player written is EA's own record, rating unchanged; a
// nation with fewer than eleven natural players keeps exactly the ones it has.
//
// buildEaSeason reads the FIFA 15 – EA FC 24 export, buildSnapshotEaSeason the committed EA FC 26 snapshot and
// scripts/lib/ea-legacy-seasons.mjs joins the FIFA 07 – FIFA 14 sources. All hand their players to assembleEaSeason,
// so every season is made the same way.
import { NATIONS, HISTORIC_NATIONS, PACIFIC_ISLANDS, selectLineup } from '../../src/data/teams.js';
import { EA_ROLES, EA_SCALE, eaTupleOf, expandEaTuple } from '../../src/data/eaPlayers.js';
import { FOOTBALL_FEDERATIONS } from '../../src/data/footballFederations.js';
import { FOOTBALL_SET_FORMAT, contentHash, presentClubs, serializeFootballSet, territoryFor } from '../../src/data/footballSetBuild.js';
import { pickFootballSquad } from '../../src/data/footballSquad.js';
import { NATION_ALIASES } from './football-data.mjs';

/** EA's competition ids of the club layer's seven leagues (build-clubs keys them the same way): game league, map shape. */
export const EA_LEAGUES = {
  13: ['Premier League', '826'], 53: ['La Liga', '724'], 31: ['Serie A', '380'], 19: ['Bundesliga', '276'],
  16: ['Ligue 1', '250'], 10: ['Eredivisie', '528'], 308: ['Liga Portugal', '620'],
};

/** EA's nationality names as the game names its nations: the built-in rosters' aliases, plus older spellings. */
export const EA_NATION_ALIASES = {
  ...NATION_ALIASES,
  'Brunei Darussalam': 'Brunei', 'Czech Republic': 'Czechia', 'Guinea Bissau': 'Guinea-Bissau', 'Korea DPR': 'North Korea',
  Swaziland: 'Eswatini',
  // EA's website (EA FC 25).
  Holland: 'Netherlands',
};

/**
 * Nationalities with no shape of their own on the game's map, so no national team; their players still play for
 * their clubs. The built-in rosters leave the same people out of every nation.
 */
export const EA_NO_TEAM = [
  'Andorra', 'Antigua and Barbuda', 'Aruba', 'Bahrain', 'Barbados', 'Bermuda', 'Cabo Verde', 'Cape Verde Islands', 'Comoros', 'Curacao',
  'Faroe Islands', 'Gibraltar', 'Grenada', 'Guam', 'Hong Kong', 'Liechtenstein', 'Macau', 'Malta', 'Mauritius',
  'Montserrat', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'San Marino',
  'São Tomé e Príncipe', 'Singapore', 'Turks and Caicos Islands',
  // EA's website (EA FC 25).
  'Curaçao', 'St. Kitts and Nevis', 'St. Lucia',
];

/** The CSV columns the build reads. */
export const EA_COLUMNS = ['player_id', 'player_url', 'fifa_version', 'fifa_update', 'update_as_of', 'short_name', 'long_name',
  'player_positions', 'overall', 'dob', 'club_team_id', 'club_name', 'league_id', 'nationality_name'];

export const SET_ID = /^ea-(?:fifa|fc)-\d{2}$/;
const CLUB_SIZE = 11;
// A SoFIFA link, absolute in older rows of the export and relative in newer ones.
const PLAYER_LINK = /^(?:https:\/\/sofifa\.com)?\/player\/(\d{1,10})\/([a-z0-9-]+)\/(\d{6})\/?$/;

const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const seasonOf = year => `${year - 1}/${String(year % 100).padStart(2, '0')}`;
const count = (map, key) => { map[key] = (map[key] || 0) + 1; };

/**
 * Build one season. `rows` are the export's rows as objects keyed by EA_COLUMNS (other editions' rows are skipped);
 * `edition` is `{ id, fifaVersion, edition, update }` from scripts/data/ea-seasons.json; `dataset` the export's page.
 * Returns `{ doc, text, audit, warnings }`. Throws on a nationality that is neither a game nation nor listed in
 * EA_NO_TEAM, a row EA's format does not allow, or rows from more than one roster or date.
 */
export function buildEaSeason(rows, { id, fifaVersion, edition, update }, { dataset, federations = FOOTBALL_FEDERATIONS } = {}) {
  if (!SET_ID.test(id)) throw new Error(`Season id ${id} is not like ea-fifa-15 or ea-fc-24`);
  const mine = rows.filter(row => Number(row.fifa_version) === fifaVersion && Number(row.fifa_update) === update);
  if (!mine.length) throw new Error(`${edition}: the export has no rows of roster update ${update}`);
  const dates = [...new Set(mine.map(row => row.update_as_of))];
  if (dates.length !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(dates[0])) throw new Error(`${edition}: roster dates ${dates.join(', ')}, not one`);
  const rosters = new Set();
  for (const row of mine) {
    const link = PLAYER_LINK.exec(row.player_url);
    if (!link || link[1] !== row.player_id) throw new Error(`${edition}: player ${row.player_id} links to ${JSON.stringify(row.player_url)}`);
    rosters.add(link[3]);
  }
  if (rosters.size !== 1) throw new Error(`${edition}: rows from rosters ${[...rosters].join(', ')}, not one`);
  const source = { provider: 'EA Sports', edition, update, roster: [...rosters][0], snapshotDate: dates[0], url: dataset, rawScale: EA_SCALE };
  const records = mine.map(row => ({
    eaId: row.player_id, name: row.short_name, fullName: row.long_name, overall: row.overall, positions: row.player_positions,
    keys: row.player_positions.split(',').map(key => key.trim()), dob: row.dob, nationality: row.nationality_name,
    club: row.club_name, slug: PLAYER_LINK.exec(row.player_url)[2],
    // Clubs by EA's competition id: the export names each club's league as it is in a later edition (FIFA 15's
    // Burnley sits in "Championship"), but its id is the edition's own.
    clubKey: Number(row.club_team_id) || null, league: EA_LEAGUES[Number(row.league_id)] || null,
  }));
  return assembleEaSeason(records, { id, year: 2000 + fifaVersion, edition, update, source, federations });
}

/**
 * Build one season from a committed EA snapshot (scripts/data/ea-fc26.csv): the players loadEaPlayers keeps, so EA's
 * generated players are already gone, all of one SoFIFA roster and date. `edition` is a snapshots entry of
 * scripts/data/ea-seasons.json; `dataset` the snapshot's page. Returns `{ doc, text, audit, warnings }`.
 */
export function buildSnapshotEaSeason(players, { id, fifaVersion, edition, update }, { dataset, federations = FOOTBALL_FEDERATIONS } = {}) {
  if (!SET_ID.test(id)) throw new Error(`Season id ${id} is not like ea-fifa-15 or ea-fc-24`);
  const rosters = new Set(), dates = new Set();
  const records = players.map(player => {
    const info = player.sourceInfo;
    const link = PLAYER_LINK.exec(info.url);
    if (!link || `ea:${link[1]}` !== info.id) throw new Error(`${edition}: player ${info.id} links to ${JSON.stringify(info.url)}`);
    if (info.edition !== edition || info.update !== update) throw new Error(`${edition}: player ${info.id} is from ${info.edition} update ${info.update}`);
    rosters.add(link[3]);
    dates.add(info.snapshotDate);
    return { eaId: link[1], name: player.name, fullName: info.fullName, overall: player.rating, positions: info.naturalPositions.join(', '),
      keys: info.naturalPositions, dob: info.dateOfBirth, nationality: info.nationality, club: info.club, slug: link[2],
      clubKey: info.clubId, league: EA_LEAGUES[player.leagueId] || null };
  });
  if (rosters.size !== 1) throw new Error(`${edition}: rows from rosters ${[...rosters].join(', ')}, not one`);
  if (dates.size !== 1) throw new Error(`${edition}: roster dates ${[...dates].join(', ')}, not one`);
  const source = { provider: 'EA Sports', edition, update, roster: [...rosters][0], snapshotDate: [...dates][0], url: dataset, rawScale: EA_SCALE };
  return assembleEaSeason(records, { id, year: 2000 + fifaVersion, edition, update, source, federations });
}

/**
 * One season from its players, whatever the source. `records` are EA's player records:
 * `{ eaId, name, fullName, overall, positions, keys, dob, nationality, club, slug, clubKey, league }`, where `keys`
 * are EA position codes, `positions` the source's own text of them (for messages), `dob` is YYYY-MM-DD or empty,
 * `clubKey` groups a club's players and `league` is an EA_LEAGUES entry `[game league, map shape]` or null (not one of
 * the seven). The season is `{ id, year, edition, update, source, federations }`, plus `auditExtra` (fields the audit
 * adds after the snapshot date), `everyLeague` (stop, not warn, on a league left with no club) and `noClubs` (a season
 * with nations only, so a league with no club is no news). Returns `{ doc, text, audit, warnings }`.
 */
export function assembleEaSeason(records, { id, year, edition, update, source, federations = FOOTBALL_FEDERATIONS, auditExtra = {}, everyLeague = false, noClubs = false }) {
  const warnings = [];
  const warn = message => warnings.push(message);

  const nationIds = new Map(Object.entries(NATIONS).map(([nation, rec]) => [rec[0], nation]));
  const noTeamNames = new Set(EA_NO_TEAM);
  const unmapped = {}, noTeam = {}, seen = new Set();
  const players = records.map(record => {
    const eaId = Number(record.eaId);
    if (!Number.isInteger(eaId) || seen.has(eaId)) throw new Error(`${edition}: invalid or repeated player id ${record.eaId}`);
    seen.add(eaId);
    const { keys } = record;
    if (keys.some(key => !Object.hasOwn(EA_ROLES, key))) throw new Error(`${edition}: player ${eaId} has positions ${record.positions}`);
    const overall = Number(record.overall);
    if (!Number.isInteger(overall) || overall < 1 || overall > EA_SCALE) throw new Error(`${edition}: player ${eaId} has overall ${record.overall}`);
    if (record.dob && !/^\d{4}-\d{2}-\d{2}$/.test(record.dob)) throw new Error(`${edition}: player ${eaId} has date of birth ${record.dob}`);
    const name = record.name.trim(), fullName = record.fullName.trim(), nationality = record.nationality.trim();
    if (!name || !nationality) throw new Error(`${edition}: player ${eaId} has no name or nationality`);
    const nationId = nationIds.get(EA_NATION_ALIASES[nationality] || nationality) ?? null;
    if (!nationId) count(noTeamNames.has(nationality) ? noTeam : unmapped, nationality);
    const tuple = [eaId, name, fullName && fullName !== name ? fullName : 0, overall, keys.join(','), nationality,
      record.club.trim(), record.dob || '', record.slug];
    const [, pos, rating, sourceInfo] = expandEaTuple(tuple, source);
    if (JSON.stringify(eaTupleOf(name, sourceInfo)) !== JSON.stringify(tuple)) throw new Error(`${edition}: player ${eaId} does not rebuild from its tuple`);
    return { name, pos, positions: sourceInfo.positions, rating, sourceInfo, tuple, nationId, clubKey: record.clubKey, league: record.league };
  });
  const unmappedNames = Object.keys(unmapped).sort();
  if (unmappedNames.length) {
    throw new Error(`${edition}: nationalities with no game nation, and not listed as having no team: `
      + `${unmappedNames.map(nation => `${nation} (${unmapped[nation]} players)`).join(', ')}. Add them to EA_NATION_ALIASES or EA_NO_TEAM`);
  }

  const pools = new Map();
  for (const player of players) if (player.nationId) (pools.get(player.nationId) || pools.set(player.nationId, []).get(player.nationId)).push(player);
  const nations = {}, nationAudit = [];
  // Tonga, Samoa and the Cook Islands are listed only when the edition rates a player of theirs, and no edition does:
  // without them a season plays as on the map it was built for, where they field no team (src/engine/footballSets.js),
  // and every season rebuilds byte for byte.
  const islands = PACIFIC_ISLANDS.some(nation => pools.get(nation)?.length);
  for (const [nation, rec] of Object.entries(NATIONS)) {
    if (!islands && PACIFIC_ISLANDS.includes(nation)) continue;
    // East Germany is no EA nation: a nation of the map's earlier years is listed only with players of its own.
    if (HISTORIC_NATIONS.includes(nation) && !pools.get(nation)?.length) continue;
    const pool = pools.get(nation) || [];
    const squad = pickFootballSquad(pool);
    const lineup = selectLineup({ sport: 'football', squad });
    nations[nation] = [Math.round(lineup.rating), pool.length, squad.map(player => player.tuple)];
    nationAudit.push({ id: nation, name: rec[0], pool: pool.length, players: squad.length, strength: nations[nation][0],
      naturalLineup: squad.length === CLUB_SIZE && lineup.slots.every(slot => slot.player && !slot.outOfPosition) });
  }

  const byClub = new Map();
  for (const player of players) {
    const { league } = player;
    if (!league || !player.clubKey) continue;
    if (!byClub.has(player.clubKey)) byClub.set(player.clubKey, { name: player.sourceInfo.club, league: league[0], country: league[1], pool: [] });
    const club = byClub.get(player.clubKey);
    if (club.name !== player.sourceInfo.club || club.league !== league[0]) throw new Error(`${edition}: club ${player.clubKey} has two names or leagues`);
    club.pool.push(player);
  }
  const built = [], leagueAudit = Object.fromEntries(Object.values(EA_LEAGUES).map(([league]) => [league, { clubs: 0, short: [] }]));
  for (const club of byClub.values()) {
    const squad = pickFootballSquad(club.pool);
    if (squad.length < CLUB_SIZE) {
      leagueAudit[club.league].short.push({ name: club.name, players: squad.length });
      continue;
    }
    leagueAudit[club.league].clubs++;
    built.push({ name: club.name, league: club.league, country: club.country, str: Math.round(mean(squad.map(p => p.rating))), squad });
  }
  for (const [league, { clubs }] of Object.entries(leagueAudit)) {
    if (clubs || noClubs) continue;
    if (everyLeague) throw new Error(`${edition}: no ${league} club has eleven players`);
    warn(`No ${league} clubs in ${edition}`);
  }
  const clubs = presentClubs(built, warn);

  const territory = territoryFor(federations, year);
  const written = new Set([...Object.values(nations).flatMap(([, , squad]) => squad), ...clubs.flatMap(club => club.squad)].map(tuple => tuple[0]));
  const coverage = {
    players: written.size, nations: nationAudit.filter(n => n.players).length,
    completeXIs: nationAudit.filter(n => n.naturalLineup).length, clubs: clubs.length, leagues: new Set(clubs.map(club => club.league)).size,
  };
  const doc = { format: FOOTBALL_SET_FORMAT, kind: 'ea', id, version: '', year, season: seasonOf(year), label: edition, local: false,
    source, nations, clubs, territory, coverage };
  doc.version = `${id}-${contentHash(doc)}`;
  // The nations short of a natural XI, as "id name (players)": the rest is in the season file itself.
  const shortNations = nationAudit.filter(n => !n.naturalLineup).map(n => `${n.id} ${n.name} (${n.players})`);
  const audit = { id, version: doc.version, edition, update, roster: source.roster, snapshotDate: source.snapshotDate, ...auditExtra,
    rows: records.length, noTeam, coverage, leagues: leagueAudit, territory, shortNations, warnings };
  return { doc, text: serializeFootballSet(doc), audit, warnings };
}
