// Sensible World of Soccer 96/97 player conversion, shared by the data set builder (scripts/lib/swos.mjs), the
// data set loader and saves. SWOS rates no player overall: each has a price, one of the game's 50 value steps
// (0 = none, 1 = 25K ... 48 = 15M, 49 = 16M). An outfield player's step is the sum of his seven skills (0-7 each:
// passing, velocity (shooting power), heading, tackling, control (ball control), speed, finishing), from 1 to 48; a
// goalkeeper has no skills and is rated by his price alone. So the price step is SWOS's one rating for everyone, and
// the game lays its 50 steps evenly on its own ratings, from 40 (the strength of an empty shirt, a player nobody
// rated) to 99. The raw step and the skills stay in the player's source record. See docs/design/football-years.md.

export const SWOS_SOURCE = 'swos';
export const SWOS_SCALE = 49;
export const SWOS_CONVERSION = 'round(40 + value * 59 / 49)';
/** SWOS's price for each value step, in pounds (the game's own table). */
export const SWOS_PRICES = Object.freeze([0, 25e3, 30e3, 40e3, 50e3, 65e3, 75e3, 85e3, 100e3, 110e3, 130e3, 150e3, 160e3, 180e3,
  200e3, 250e3, 300e3, 350e3, 450e3, 500e3, 550e3, 600e3, 650e3, 700e3, 750e3, 800e3, 850e3, 950e3, 1e6, 1.1e6, 1.3e6, 1.5e6,
  1.6e6, 1.8e6, 1.9e6, 2e6, 2.25e6, 2.75e6, 3e6, 3.5e6, 4.5e6, 5e6, 6e6, 7e6, 8e6, 9e6, 10e6, 12e6, 15e6, 16e6]);
/** The seven outfield skills, in the order a tuple's skill digits give them. */
export const SWOS_SKILLS = Object.freeze(['PA', 'VE', 'HE', 'TA', 'CO', 'SP', 'FI']);
/**
 * SWOS's one position per player, as position keys, mapped to the game's roles. SWOS plays a 4-4-2 whose wide
 * midfielders are its RW and LW, so they are midfielders here (a CM or EA winger is a forward).
 */
export const SWOS_ROLES = Object.freeze({ g: 'GK', rb: 'DF', lb: 'DF', d: 'DF', rw: 'MF', lw: 'MF', m: 'MF', a: 'FW' });

/** The game's 1-99 rating of a SWOS value step (0-49). */
export function swosGameRating(value) {
  if (!Number.isInteger(value) || value < 0 || value > SWOS_SCALE) throw new Error('Invalid SWOS value step');
  return Math.round(40 + value * 59 / SWOS_SCALE);
}

/**
 * Expand a compact tuple `[swosId, name, 0, value, positionKey, nationality, '', '', skills]` into the roster tuple
 * `[name, pos, rating, sourceInfo]` that buildTeam and buildClub read: the layout of a CM tuple (src/data/cmPlayers.js),
 * whose full name, club and date of birth SWOS's national records do not have, plus the seven skill digits ('' for a
 * goalkeeper). `source` is the data set's source block. Every field is SWOS's; nothing is generated.
 */
export function expandSwosTuple(tuple, source) {
  const [swosId, name, fullName, value, positionKey, nationality, club, dateOfBirth, skills] = tuple;
  if (!Number.isInteger(swosId) || swosId < 1 || typeof name !== 'string' || !name.trim() || fullName !== 0
      || !Object.hasOwn(SWOS_ROLES, positionKey) || typeof nationality !== 'string' || !nationality.trim() || club !== '' || dateOfBirth !== ''
      || typeof skills !== 'string' || (positionKey === 'g' ? skills !== '' : !/^[0-7]{7}$/.test(skills))) {
    throw new Error(`Invalid SWOS tuple ${JSON.stringify(tuple)}`);
  }
  const role = SWOS_ROLES[positionKey];
  const sourceInfo = {
    id: `swos:${swosId}`, fullName: name, positions: [role], source: SWOS_SOURCE, edition: source.edition, version: source.version,
    snapshotDate: source.snapshotDate, url: source.url, rawRating: value, rawScale: SWOS_SCALE, conversion: SWOS_CONVERSION,
    nationality, club: '', price: SWOS_PRICES[value], naturalPositions: [positionKey],
  };
  if (skills) sourceInfo.skills = Object.fromEntries(SWOS_SKILLS.map((skill, i) => [skill, Number(skills[i])]));
  return [name, role, swosGameRating(value), sourceInfo];
}

/** The compact tuple of a SWOS player record, or null when the record is not one `expandSwosTuple` would rebuild. */
export function swosTupleOf(name, sourceInfo) {
  if (sourceInfo?.source !== SWOS_SOURCE || typeof sourceInfo.id !== 'string' || !/^swos:\d{1,10}$/.test(sourceInfo.id)
      || !Array.isArray(sourceInfo.naturalPositions) || sourceInfo.naturalPositions.length !== 1) return null;
  const skills = sourceInfo.skills ? SWOS_SKILLS.map(skill => sourceInfo.skills[skill]).join('') : '';
  return [Number(sourceInfo.id.slice(5)), name, 0, sourceInfo.rawRating, sourceInfo.naturalPositions[0], sourceInfo.nationality, '', '', skills];
}
