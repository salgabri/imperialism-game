// The built-in earlier football seasons (docs/design/football-years.md): one roster of one EA FIFA / FC edition
// becomes that season's national squads, top-flight clubs and territory, in the data set format the game loads
// (src/engine/footballSets.js, kind 'ea'). No I/O here: scripts/build-ea-seasons.mjs reads the export and writes the
// files, and tests build seasons from invented rows. Every player written is EA's own record, rating unchanged; a
// nation with fewer than eleven natural players keeps exactly the ones it has.
import { NATIONS, selectLineup } from '../../src/data/teams.js';
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
};

/**
 * Nationalities with no shape of their own on the game's map, so no national team; their players still play for
 * their clubs. The built-in rosters leave the same people out of every nation.
 */
export const EA_NO_TEAM = [
  'Andorra', 'Antigua and Barbuda', 'Aruba', 'Bahrain', 'Barbados', 'Bermuda', 'Cape Verde Islands', 'Comoros', 'Curacao',
  'Faroe Islands', 'Gibraltar', 'Grenada', 'Guam', 'Hong Kong', 'Liechtenstein', 'Macau', 'Malta', 'Mauritius',
  'Montserrat', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'San Marino',
  'São Tomé e Príncipe', 'Singapore',
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
  const warnings = [];
  const warn = message => warnings.push(message);
  const year = 2000 + fifaVersion;
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

  const nationIds = new Map(Object.entries(NATIONS).map(([nation, rec]) => [rec[0], nation]));
  const noTeamNames = new Set(EA_NO_TEAM);
  const unmapped = {}, noTeam = {}, seen = new Set();
  const players = mine.map(row => {
    const eaId = Number(row.player_id);
    if (!Number.isInteger(eaId) || seen.has(eaId)) throw new Error(`${edition}: invalid or repeated player id ${row.player_id}`);
    seen.add(eaId);
    const keys = row.player_positions.split(',').map(key => key.trim());
    if (keys.some(key => !Object.hasOwn(EA_ROLES, key))) throw new Error(`${edition}: player ${eaId} has positions ${row.player_positions}`);
    const overall = Number(row.overall);
    if (!Number.isInteger(overall) || overall < 1 || overall > EA_SCALE) throw new Error(`${edition}: player ${eaId} has overall ${row.overall}`);
    if (row.dob && !/^\d{4}-\d{2}-\d{2}$/.test(row.dob)) throw new Error(`${edition}: player ${eaId} has date of birth ${row.dob}`);
    const name = row.short_name.trim(), fullName = row.long_name.trim(), nationality = row.nationality_name.trim();
    if (!name || !nationality) throw new Error(`${edition}: player ${eaId} has no name or nationality`);
    const nationId = nationIds.get(EA_NATION_ALIASES[nationality] || nationality) ?? null;
    if (!nationId) count(noTeamNames.has(nationality) ? noTeam : unmapped, nationality);
    const tuple = [eaId, name, fullName && fullName !== name ? fullName : 0, overall, keys.join(','), nationality,
      row.club_name.trim(), row.dob || '', PLAYER_LINK.exec(row.player_url)[2]];
    const [, pos, rating, sourceInfo] = expandEaTuple(tuple, source);
    if (JSON.stringify(eaTupleOf(name, sourceInfo)) !== JSON.stringify(tuple)) throw new Error(`${edition}: player ${eaId} does not rebuild from its tuple`);
    return { name, pos, positions: sourceInfo.positions, rating, sourceInfo, tuple, nationId,
      clubId: Number(row.club_team_id) || null, leagueId: Number(row.league_id) || null };
  });
  const unmappedNames = Object.keys(unmapped).sort();
  if (unmappedNames.length) {
    throw new Error(`${edition}: nationalities with no game nation, and not listed as having no team: `
      + `${unmappedNames.map(nation => `${nation} (${unmapped[nation]} players)`).join(', ')}. Add them to EA_NATION_ALIASES or EA_NO_TEAM`);
  }

  const pools = new Map();
  for (const player of players) if (player.nationId) (pools.get(player.nationId) || pools.set(player.nationId, []).get(player.nationId)).push(player);
  const nations = {}, nationAudit = [];
  for (const [nation, rec] of Object.entries(NATIONS)) {
    const pool = pools.get(nation) || [];
    const squad = pickFootballSquad(pool);
    const lineup = selectLineup({ sport: 'football', squad });
    nations[nation] = [Math.round(lineup.rating), pool.length, squad.map(player => player.tuple)];
    nationAudit.push({ id: nation, name: rec[0], pool: pool.length, players: squad.length, strength: nations[nation][0],
      naturalLineup: squad.length === CLUB_SIZE && lineup.slots.every(slot => slot.player && !slot.outOfPosition) });
  }

  // Clubs by EA's competition id: the export names each club's league as it is in a later edition (FIFA 15's
  // Burnley sits in "Championship"), but its id is the edition's own.
  const byClub = new Map();
  for (const player of players) {
    const league = EA_LEAGUES[player.leagueId];
    if (!league || !player.clubId) continue;
    if (!byClub.has(player.clubId)) byClub.set(player.clubId, { name: player.sourceInfo.club, league: league[0], country: league[1], pool: [] });
    const club = byClub.get(player.clubId);
    if (club.name !== player.sourceInfo.club || club.league !== league[0]) throw new Error(`${edition}: club ${player.clubId} has two names or leagues`);
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
  for (const [league, { clubs }] of Object.entries(leagueAudit)) if (!clubs) warn(`No ${league} clubs in ${edition}`);
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
  const audit = { id, version: doc.version, edition, update, roster: source.roster, snapshotDate: source.snapshotDate,
    rows: mine.length, noTeam, coverage, leagues: leagueAudit, territory, shortNations, warnings };
  return { doc, text: serializeFootballSet(doc), audit, warnings };
}
