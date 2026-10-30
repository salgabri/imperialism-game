// EA FIFA / FC player records of the built-in earlier seasons (docs/design/football-years.md), shared by the season
// builder, the data set loader and saves. EA rates overall on 1–99, the game's own range, so ratings are used
// unchanged and nothing is converted or invented.

export const EA_SOURCE = 'ea-fc';
export const EA_SCALE = 99;

/** EA's position codes, mapped to the game's roles as the built-in rosters map them (scripts/lib/football-data.mjs). */
export const EA_ROLES = {
  GK: 'GK', CB: 'DF', LB: 'DF', RB: 'DF', LWB: 'DF', RWB: 'DF',
  CDM: 'MF', CM: 'MF', CAM: 'MF', LM: 'MF', RM: 'MF',
  LW: 'FW', RW: 'FW', ST: 'FW', CF: 'FW',
};

// A player's page for one roster on SoFIFA: /player/<EA id>/<slug>/<roster id>.
const SOFIFA_PLAYER = /^https:\/\/sofifa\.com\/player\/(\d{1,10})\/([a-z0-9-]+)\/(\d{6})$/;

/** The roster id in an EA player's SoFIFA link, or null. */
export const eaRosterOf = url => SOFIFA_PLAYER.exec(url || '')?.[3] ?? null;

/**
 * Expand a compact tuple `[eaId, name, fullName | 0, overall, 'ST,LW', nationality, club, dateOfBirth, slug]` into
 * the roster tuple `[name, pos, rating, sourceInfo]` that buildTeam and buildClub read. `source` is the season's
 * source block: its edition, roster update, snapshot date and SoFIFA roster id. Every field comes from EA's record.
 */
export function expandEaTuple(tuple, source) {
  const [eaId, name, fullName, overall, positionKeys, nationality, club, dateOfBirth, slug] = tuple;
  const naturalPositions = String(positionKeys || '').split(',').filter(key => Object.hasOwn(EA_ROLES, key));
  if (!Number.isInteger(eaId) || eaId < 0 || typeof name !== 'string' || !name.trim() || !naturalPositions.length
      || !Number.isInteger(overall) || overall < 1 || overall > EA_SCALE || typeof nationality !== 'string'
      || typeof club !== 'string' || typeof dateOfBirth !== 'string' || typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Invalid EA tuple ${JSON.stringify(tuple)}`);
  }
  const positions = [...new Set(naturalPositions.map(key => EA_ROLES[key]))];
  const sourceInfo = {
    id: `ea:${eaId}`, fullName: typeof fullName === 'string' && fullName ? fullName : name, positions,
    source: EA_SOURCE, edition: source.edition, update: source.update, snapshotDate: source.snapshotDate,
    url: `https://sofifa.com/player/${eaId}/${slug}/${source.roster}`, rawRating: overall, rawScale: EA_SCALE,
    nationality, club,
  };
  if (dateOfBirth) sourceInfo.dateOfBirth = dateOfBirth;
  sourceInfo.naturalPositions = naturalPositions;
  return [name, positions[0], overall, sourceInfo];
}

/** The compact tuple of an EA season's player record, or null when it is not one `expandEaTuple` would rebuild. */
export function eaTupleOf(name, sourceInfo) {
  if (sourceInfo?.source !== EA_SOURCE || typeof sourceInfo.id !== 'string' || !/^ea:\d{1,10}$/.test(sourceInfo.id)
      || !Array.isArray(sourceInfo.naturalPositions)) return null;
  const link = SOFIFA_PLAYER.exec(sourceInfo.url || '');
  if (!link || link[1] !== sourceInfo.id.slice(3)) return null;
  return [Number(sourceInfo.id.slice(3)), name, sourceInfo.fullName === name ? 0 : sourceInfo.fullName, sourceInfo.rawRating,
    sourceInfo.naturalPositions.join(','), sourceInfo.nationality, sourceInfo.club, sourceInfo.dateOfBirth || '', link[2]];
}
