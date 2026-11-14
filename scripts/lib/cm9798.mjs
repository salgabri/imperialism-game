// The 1997/98 football season from Sports Interactive's Championship Manager 97/98 database, as baskeyx extracted it to
// JSON (github.com/baskeyx/cm9798): national squads by nationality and Europe's strongest first-division clubs, in the
// data set format the game loads (src/engine/footballSets.js, kind 'cm', its players CM 01/02's tuples,
// src/data/cmPlayers.js). No I/O here: scripts/build-retro-seasons.mjs reads the files and writes the season,
// and tests build seasons from invented records. Every rating is the database's current ability, converted as a CM
// 01/02 database's is; a player it does not rate (ability 0) is left out, never guessed. Potential and the attributes
// are not read, so the extraction's null ones change nothing. See docs/design/football-years.md.
import { NATIONS, HISTORIC_NATIONS, PACIFIC_ISLANDS, selectLineup } from '../../src/data/teams.js';
import { CM_SCALE, cmNaturalPositions, cmTupleOf, expandCmTuple } from '../../src/data/cmPlayers.js';
import { CM0102_NATIONS } from '../../src/data/cm0102Nations.js';
import { FOOTBALL_FEDERATIONS } from '../../src/data/footballFederations.js';
import { FOOTBALL_SET_FORMAT, NO_TEAM, contentHash, nationResolver, presentClubs, serializeFootballSet, strongestBuilt, territoryFor } from '../../src/data/footballSetBuild.js';
import { BIG_LEAGUES, EUROPEAN_LEAGUES } from '../../src/data/footballLeagues.js';
import { TOP_CLUBS } from '../../src/data/scopes.js';
import { pickFootballSquad } from '../../src/data/footballSquad.js';

export const CM9798_ID = 'cm-9798';
const CLUB_SIZE = 11;

/**
 * Europe's first divisions the database holds, by its division codes: game league, map shape (src/data/footballLeagues.js).
 * The seven big leagues first; its Swedish Allsvenskan is WD1.
 */
export const CM9798_DIVISIONS = Object.freeze(Object.fromEntries(Object.entries({
  EPR: 'Premier League', SP1: 'La Liga', ISA: 'Serie A', GD1: 'Bundesliga', FD1: 'Ligue 1', HD1: 'Eredivisie', PD1: 'Liga Portugal',
  TR1: 'Süper Lig', BD1: 'Belgian Pro League', SPR: 'Scottish Premiership', DD1: 'Danish Superliga', ND1: 'Eliteserien', WD1: 'Allsvenskan',
}).map(([division, league]) => [division, [league, EUROPEAN_LEAGUES[league]]])));

/**
 * The database's nationality names as the game names its nations: CM 01/02's (src/data/cm0102Nations.js) plus CM 97/98's
 * own spellings. Its "Republic of Congo" is the former Zaire, today's DR Congo (Roger Lukaku, Nzelo Lembi and
 * Jean-Claude Mukanya are among its players); its "Congo" and "The Congo" are Congo-Brazzaville, as in CM 01/02.
 */
export const CM9798_NATIONS = {
  aliases: {
    ...CM0102_NATIONS.aliases, Bielorussia: '112', Bosnia: '070', 'Burkino Faso': '854', Eire: '372', Netherland: '528',
    'Republic of Congo': '180', 'Trinidad and Tobago': '780',
  },
  noTeam: [...CM0102_NATIONS.noTeam, 'Cape Verde'],
};

/**
 * Club names in players' records that are none of the team records' names: the extraction kept two of each team's names
 * (long and short) and the game has more. Only the top divisions' are resolved; every other player keeps his club as
 * written.
 */
export const CM9798_CLUB_ALIASES = { 'Newcastle U': 'Newcastle United', 'Sheff W': 'Sheffield Wednesday', Schalke: 'FC Schalke 04' };

/** Team records that are no club: a player there has none (`''`), and a retired one plays for nobody. */
export const CM9798_NO_CLUB = new Set(['free transfer', 'minor team', 'non league', 'schoolboy']);
export const CM9798_RETIRED = new Set(['retired']);

/** The database's position keys, by their CM 01/02 rating names. A position is 0 (no), 1 (can play there) or 2 (natural). */
const POSITION_KEYS = { gk: 'goalkeeper', sw: 'sweeper', d: 'defence', dm: 'anchor', m: 'midfield', am: 'support', f: 'attack',
  right: 'right', left: 'left', centre: 'central' };
/** A CM 97/98 position value on CM 01/02's 1-20 scale: 2 is natural (20), 1 can play there (10, below CM 01/02's 15). */
const LEVEL = { 0: 0, 1: 10, 2: 20 };

/**
 * A player's positions as CM 01/02 ratings, which cmNaturalPositions reads as the CM 01/02 builder does: natural where
 * position and side are both 2. CM 97/98 has no wing-back rating (0). A value other than 0, 1 or 2 is read as 0 and
 * reported in `odd`.
 */
export function cm9798Ratings(positions, odd = []) {
  const ratings = { wb: 0, free: 0 };
  for (const [key, field] of Object.entries(POSITION_KEYS)) {
    const value = positions?.[field];
    if (!Object.hasOwn(LEVEL, value)) odd.push(`${field} ${value}`);
    ratings[key] = LEVEL[value] ?? 0;
  }
  return ratings;
}

const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const count = (map, key) => { map[key] = (map[key] || 0) + 1; };

/**
 * Build the season from the extraction's `players` and `teams` arrays. A player's id is his place in `players` (1 for
 * its first record), since the extraction's own ids repeat (627 of them are shared by unrelated players). `source` is
 * the season's source block. Returns `{ doc, text, audit, warnings }`; throws on anything it does not understand.
 */
export function buildCm9798Season({ players, teams }, { source, year, federations = FOOTBALL_FEDERATIONS }) {
  const warnings = [];
  const warn = message => warnings.push(message);
  const resolve = nationResolver(CM9798_NATIONS);

  // Team names that name exactly one record; a name two records share is ambiguous and resolves to none.
  const named = new Map();
  for (const team of teams) {
    for (const name of new Set([team.name, team.shortName].filter(Boolean))) named.set(name, named.has(name) ? null : team);
  }
  for (const [alias, name] of Object.entries(CM9798_CLUB_ALIASES)) {
    if (named.has(alias)) throw new Error(`The club alias ${alias} is a team record's own name`);
    if (!named.get(name)) throw new Error(`The club alias ${alias} names ${name}, which is not one team record`);
  }

  const dropped = { noAbility: 0, noPositions: 0, retired: 0, noName: 0 };
  const unmapped = {}, noTeam = {}, odd = [], kept = [];
  players.forEach((record, i) => {
    const name = [record.firstName, record.secondName].map(part => String(part ?? '').trim()).filter(Boolean).join(' ');
    if (!name) { dropped.noName++; return; }
    if (!Number.isInteger(record.ability) || record.ability < 0 || record.ability > CM_SCALE) throw new Error(`${name} has ability ${record.ability}`);
    if (record.ability === 0) { dropped.noAbility++; return; }
    const strange = [];
    const keys = cmNaturalPositions(cm9798Ratings(record.positions, strange));
    if (strange.length) odd.push(`${name} (${record.currentClub}): ${strange.join(', ')}`);
    if (!keys.length) { dropped.noPositions++; return; }
    const club = String(record.currentClub ?? '').trim();
    if (CM9798_RETIRED.has(fold(club))) { dropped.retired++; return; }
    const nation = resolve(record.nation);
    if (nation == null) { count(unmapped, record.nation); return; }
    if (nation === NO_TEAM) count(noTeam, record.nation);
    const team = named.get(CM9798_CLUB_ALIASES[club] ?? club) || null;
    const clubName = CM9798_NO_CLUB.has(fold(club)) ? '' : team ? team.name : club;
    const tuple = [i + 1, name, 0, record.ability, keys.join(','), record.nation, clubName, ''];
    const [playerName, pos, rating, sourceInfo] = expandCmTuple(tuple, source);
    if (JSON.stringify(cmTupleOf(playerName, sourceInfo)) !== JSON.stringify(tuple)) throw new Error(`${name} does not rebuild from the tuple`);
    kept.push({ name, pos, positions: sourceInfo.positions, rating, sourceInfo, tuple, nationId: nation === NO_TEAM ? null : nation, team });
  });
  const unmappedNames = Object.keys(unmapped).sort();
  if (unmappedNames.length) {
    throw new Error(`CM 97/98 nationalities with no game nation, and not listed as having no team: ${unmappedNames.map(n => `${n} (${unmapped[n]})`).join(', ')}`);
  }
  if (odd.length) warn(`${odd.length} players have position values other than 0, 1 or 2, read as 0: ${odd.join('; ')}`);

  const pools = new Map();
  for (const player of kept) if (player.nationId) (pools.get(player.nationId) || pools.set(player.nationId, []).get(player.nationId)).push(player);
  const nations = {}, nationAudit = [];
  const islands = PACIFIC_ISLANDS.some(id => pools.get(id)?.length);
  for (const [id, rec] of Object.entries(NATIONS)) {
    if (!islands && PACIFIC_ISLANDS.includes(id)) continue;
    // A nation of the map's earlier years (East Germany) is listed only with players of its own.
    if (HISTORIC_NATIONS.includes(id) && !pools.get(id)?.length) continue;
    const pool = pools.get(id) || [];
    const squad = pickFootballSquad(pool);
    const lineup = selectLineup({ sport: 'football', squad });
    nations[id] = [Math.round(lineup.rating), pool.length, squad.map(p => p.tuple)];
    nationAudit.push({ id, name: rec[0], pool: pool.length, players: squad.length, strength: nations[id][0],
      naturalLineup: squad.length === CLUB_SIZE && lineup.slots.every(slot => slot.player && !slot.outOfPosition) });
  }

  const byTeam = new Map();
  for (const player of kept) if (player.team) (byTeam.get(player.team) || byTeam.set(player.team, []).get(player.team)).push(player);
  const built = [], leagueAudit = [];
  for (const [division, [league, country]] of Object.entries(CM9798_DIVISIONS)) {
    const members = teams.filter(team => team.division === division);
    // The seven big leagues' divisions are in the database; the others too, but none is needed.
    if (!members.length && BIG_LEAGUES.includes(league)) throw new Error(`No ${division} teams`);
    const short = [];
    for (const team of members) {
      if (![team.name, team.shortName].filter(Boolean).every(name => named.get(name) === team)) throw new Error(`${division} team ${team.name} shares a name with another record`);
      const squad = pickFootballSquad(byTeam.get(team) || []);
      if (squad.length < CLUB_SIZE) { short.push({ name: team.name, players: squad.length }); continue; }
      built.push({ name: team.name, league, country, str: Math.round(mean(squad.map(p => p.rating))), squad });
    }
    leagueAudit.push({ league, division, members: members.length, clubs: members.length - short.length, kept: 0, short });
  }
  // Europe's strongest TOP_CLUBS, as every season keeps.
  const clubs = presentClubs(strongestBuilt(built, TOP_CLUBS), warn);
  for (const club of clubs) leagueAudit.find(entry => entry.league === club.league).kept++;

  const territory = territoryFor(federations, year);
  const written = new Set([...Object.values(nations).flatMap(([, , squad]) => squad), ...clubs.flatMap(club => club.squad)].map(tuple => tuple[0]));
  const coverage = {
    players: written.size, nations: nationAudit.filter(n => n.players).length,
    completeXIs: nationAudit.filter(n => n.naturalLineup).length, clubs: clubs.length, leagues: new Set(clubs.map(c => c.league)).size,
  };
  const doc = { format: FOOTBALL_SET_FORMAT, kind: 'cm', id: CM9798_ID, version: '', year, season: `${year - 1}/${String(year % 100).padStart(2, '0')}`,
    label: source.edition, local: false, source, nations, clubs, territory, coverage };
  doc.version = `${CM9798_ID}-${contentHash(doc)}`;
  // Potential and the attributes are not read (the game rates by current ability alone), so their gaps cost nothing.
  const unread = { nullPotential: players.filter(p => p.potential == null).length,
    nullAttributes: players.filter(p => Object.values(p.attributes || {}).some(value => value == null)).length };
  const audit = {
    id: CM9798_ID, version: doc.version, records: players.length, teams: teams.length, eligible: kept.length, dropped, unread, noTeam, coverage,
    leagues: leagueAudit, territory, shortNations: nationAudit.filter(n => !n.naturalLineup).map(n => `${n.id} ${n.name} (${n.players})`), warnings,
  };
  return { doc, text: serializeFootballSet(doc), audit, warnings };
}
