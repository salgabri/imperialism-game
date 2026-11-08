// The built-in earlier women's football seasons (docs/design/womens-football.md, "Earlier seasons"): one roster of one EA
// FIFA / FC edition's women becomes that season's national teams and, from FIFA 23 on, its clubs, in the data set format
// the game loads (src/engine/footballSets.js, kind 'eaw'). No I/O here: scripts/build-womens-seasons.mjs reads the
// committed snapshot and writes the files, and tests build seasons from invented rows.
//
// The rules are the built-in season's (scripts/build-womens-football.mjs): every player is EA's own record, rating
// unchanged; a nation keeps exactly the players it has, so one short of eleven starts short-handed and one with none
// fields no team (its land stays neutral); every club EA rates plays, those of the leagues EA licenses whole in leagues
// of their own and the rest together. A club keeps the game's id for its EA team id, so its crest and colour follow it
// from season to season, and the name EA gave it that season.
import { NATIONS, selectLineup } from '../../src/data/teams.js';
import { EA_ROLES, EA_SCALE, eaTupleOf, expandEaTuple } from '../../src/data/eaPlayers.js';
import { FOOTBALL_SET_FORMAT, contentHash, serializeFootballSet } from '../../src/data/footballSetBuild.js';
import { pickFootballSquad } from '../../src/data/footballSquad.js';
import { colourFor, makeCode, slug } from './club-identity.mjs';
import { EA_NATION_ALIASES, EA_NO_TEAM } from './ea-seasons.mjs';

export const SET_ID = /^eaw-(?:fifa|fc)-\d{2}$/;
const SPORT = 'womens-football';
const SIZE = 11;
// EA rated national teams alone until FIFA 22; its women's clubs start with FIFA 23.
export const FIRST_CLUB_EDITION = 23;

const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
const seasonOf = year => `${year - 1}/${String(year % 100).padStart(2, '0')}`;
const count = (map, key) => { map[key] = (map[key] || 0) + 1; };
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// Scoreboard codes are three plain capitals: "Köln" makes KOL.
const ascii = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^ -~]/g, '');

/**
 * A club's name as the season shows it: the manifest's (`clubs`, by EA team id) where EA's label is shortened, else
 * EA's own without the " W" the export appends to every women's club ("Arsenal W").
 */
export function clubNameOf(label, teamId, names = {}) {
  const own = names[String(teamId)];
  if (own) return own;
  const name = String(label).replace(/\s+W$/, '').trim();
  if (!name) throw new Error(`EA team ${teamId} has no name`);
  return name;
}

/**
 * One season from its players. `records` are EA's player records:
 * `{ eaId, name, fullName, overall, positions, keys, dob, nationality, club, slug, teamId, league }`, where `keys` are EA
 * position codes, `positions` the source's text of them (for messages), `dob` is YYYY-MM-DD or empty, `club` the club's
 * name as the season shows it (or '' for none), `teamId` what groups a club's players (EA's team id where the source
 * has one) and `league` the club's league as `{ name, country, main }` (a league that is not `main` plays as `rest`),
 * or null. The season is `{ id, fifaVersion, edition, update, source }`; `builtIn` maps EA team ids to the built-in
 * clubs' ids. Returns `{ doc, text, audit, warnings }`.
 */
export function assembleWomensSeason(records, { id, fifaVersion, edition, update, source }, { rest, builtIn = new Map() }) {
  if (!SET_ID.test(id)) throw new Error(`Season id ${id} is not like eaw-fifa-16 or eaw-fc-24`);
  const year = 2000 + fifaVersion;
  const warnings = [];
  const nationIds = new Map(Object.entries(NATIONS).map(([nation, rec]) => [rec[0], nation]));
  const noTeamNames = new Set(EA_NO_TEAM);
  const unmapped = {}, noTeam = {}, seen = new Set();
  const players = records.map(record => {
    const eaId = Number(record.eaId);
    if (!Number.isInteger(eaId) || seen.has(eaId)) throw new Error(`${edition}: invalid or repeated player id ${record.eaId}`);
    seen.add(eaId);
    const { keys } = record;
    if (!keys.length || keys.some(key => !Object.hasOwn(EA_ROLES, key))) throw new Error(`${edition}: player ${eaId} has positions ${record.positions}`);
    const overall = Number(record.overall);
    if (!Number.isInteger(overall) || overall < 1 || overall > EA_SCALE) throw new Error(`${edition}: player ${eaId} has overall ${record.overall}`);
    if (record.dob && !/^\d{4}-\d{2}-\d{2}$/.test(record.dob)) throw new Error(`${edition}: player ${eaId} has date of birth ${record.dob}`);
    const name = record.name.trim(), fullName = record.fullName.trim(), nationality = record.nationality.trim();
    if (!name || !nationality) throw new Error(`${edition}: player ${eaId} has no name or nationality`);
    const nationId = nationIds.get(EA_NATION_ALIASES[nationality] || nationality) ?? null;
    if (!nationId) count(noTeamNames.has(nationality) ? noTeam : unmapped, nationality);
    const tuple = [eaId, name, fullName && fullName !== name ? fullName : 0, overall, keys.join(','), nationality,
      record.club, record.dob || '', record.slug];
    const [, pos, rating, sourceInfo] = expandEaTuple(tuple, source);
    if (JSON.stringify(eaTupleOf(name, sourceInfo)) !== JSON.stringify(tuple)) throw new Error(`${edition}: player ${eaId} does not rebuild from its tuple`);
    return { name, pos, positions: sourceInfo.positions, rating, sourceInfo, tuple, nationId, teamId: record.teamId, league: record.league };
  });
  const unmappedNames = Object.keys(unmapped).sort();
  if (unmappedNames.length) {
    throw new Error(`${edition}: nationalities with no game nation, and not listed as having no team: `
      + `${unmappedNames.map(nation => `${nation} (${unmapped[nation]} players)`).join(', ')}. Add them to EA_NATION_ALIASES or EA_NO_TEAM`);
  }

  // ---------- the nations: only those with a rated player field a team ----------
  const pools = new Map();
  for (const player of players) if (player.nationId) (pools.get(player.nationId) || pools.set(player.nationId, []).get(player.nationId)).push(player);
  const nations = {}, nationAudit = [];
  for (const [nation, rec] of Object.entries(NATIONS)) {
    const pool = pools.get(nation);
    if (!pool) continue;
    const squad = pickFootballSquad(pool);
    const lineup = selectLineup({ sport: SPORT, squad });
    nations[nation] = [Math.round(lineup.rating), pool.length, squad.map(player => player.tuple)];
    nationAudit.push({ id: nation, name: rec[0], pool: pool.length, players: squad.length, strength: nations[nation][0],
      naturalLineup: squad.length === SIZE && lineup.slots.every(slot => slot.player && !slot.outOfPosition) });
  }
  const inactive = Object.keys(NATIONS).filter(nation => !Object.hasOwn(nations, nation));

  // ---------- the clubs ----------
  const byTeam = new Map();
  if (fifaVersion >= FIRST_CLUB_EDITION) {
    for (const player of players) {
      if (!player.teamId) continue;
      const { league } = player;
      if (!league) throw new Error(`${edition}: club ${player.sourceInfo.club} (${player.teamId}) has no league the game knows`);
      if (!byTeam.has(player.teamId)) byTeam.set(player.teamId, { name: player.sourceInfo.club, league, pool: [] });
      const club = byTeam.get(player.teamId);
      if (club.name !== player.sourceInfo.club || club.league !== league) throw new Error(`${edition}: EA team ${player.teamId} has two names or leagues`);
      club.pool.push(player);
    }
  } else if (players.some(player => player.teamId)) {
    throw new Error(`${edition}: EA rated no women's club before FIFA ${FIRST_CLUB_EDITION}, but players have one`);
  }
  const short = [], ids = new Set(), codes = new Set();
  const clubs = [...byTeam.entries()]
    .map(([teamId, club]) => {
      const squad = pickFootballSquad(club.pool);
      return { teamId, name: club.name, league: club.league.main ? club.league.name : rest, country: club.league.country,
        str: Math.round(mean(squad.map(player => player.rating))), squad };
    })
    .filter(club => club.squad.length >= SIZE || !short.push({ name: club.name, players: club.squad.length }))
    .sort((a, b) => b.str - a.str || byText(a.name, b.name))
    .map(club => {
      const id = builtIn.get(String(club.teamId)) ?? `w-${slug(club.name)}`;
      if (ids.has(id)) throw new Error(`${edition}: two clubs make the id ${id}`);
      ids.add(id);
      return { id, name: club.name, code: makeCode(ascii(club.name), codes), league: club.league, country: club.country, col: colourFor(id),
        str: club.str, squad: club.squad.map(player => player.tuple) };
    });
  for (const club of short) warnings.push(`${club.name} has ${club.players} players, short of eleven: left out`);

  const written = new Set([...Object.values(nations).flatMap(([, , squad]) => squad), ...clubs.flatMap(club => club.squad)].map(tuple => tuple[0]));
  const coverage = {
    players: written.size, nations: nationAudit.length, completeXIs: nationAudit.filter(n => n.naturalLineup).length,
    clubs: clubs.length, leagues: new Set(clubs.map(club => club.league)).size,
  };
  const doc = { format: FOOTBALL_SET_FORMAT, kind: 'eaw', id, version: '', year, season: seasonOf(year), label: edition, local: false,
    source, nations, clubs, territory: { merged: {}, inactive }, coverage };
  doc.version = `${id}-${contentHash(doc)}`;
  const audit = { id, version: doc.version, edition, update, roster: source.roster, snapshotDate: source.snapshotDate,
    rows: records.length, noTeam, coverage,
    nations: nationAudit.map(n => `${n.id} ${n.name}: ${n.players}${n.naturalLineup ? '' : ' (no natural XI)'} of ${n.pool}, ${n.strength}`),
    clubs: Object.fromEntries([...new Set(clubs.map(club => club.league))].map(league => [league, clubs.filter(club => club.league === league).map(club => `${club.name} ${club.str}`)])),
    warnings };
  return { doc, text: serializeFootballSet(doc), audit, warnings };
}
