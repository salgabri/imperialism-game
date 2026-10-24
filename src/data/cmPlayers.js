// Championship Manager 01/02 player conversion, shared by the data set builder,
// the data set loader and saves. A CM database rates current ability on 1–200;
// the game scales it once to its 1–99 display range and never invents a value.
// See docs/design/football-years.md.

export const CM_SOURCE = 'cm0102';
export const CM_SCALE = 200;
export const CM_CONVERSION = 'round(ca * 99 / 200)';

/** Position keys derived from CM's position and side ratings, mapped to the game's roles as FM's are. */
export const CM_ROLES = {
  gk: 'GK', sw: 'DF', lb: 'DF', cb: 'DF', rb: 'DF', lwb: 'DF', rwb: 'DF',
  dm: 'MF', lm: 'MF', cm: 'MF', rm: 'MF', am: 'MF', lw: 'FW', rw: 'FW', st: 'FW',
};

/** A rating of 20 is natural; without any, the best fit counts if it is at least this. */
export const CM_NATURAL = 20;
export const CM_ACCOMPLISHED = 15;

export function cmGameRating(currentAbility) {
  if (!Number.isInteger(currentAbility) || currentAbility < 1 || currentAbility > CM_SCALE) throw new Error('Invalid CM current ability');
  return Math.max(1, Math.round(currentAbility * 99 / CM_SCALE));
}

/**
 * How well a player fits each slot: the lower of the position rating and the side rating, as the game's own
 * team picker does. `r` holds CM's 1–20 ratings { gk, sw, d, dm, m, am, f, wb, right, left, centre } (0 = unset).
 */
export function cmSlotFit(r) {
  const side = (rating, s) => Math.min(rating, s);
  return {
    gk: r.gk,
    sw: side(r.sw, r.centre),
    lb: side(Math.max(r.d, r.wb), r.left),
    cb: side(Math.max(r.d, r.sw), r.centre),
    rb: side(Math.max(r.d, r.wb), r.right),
    lwb: side(Math.max(r.wb, r.dm), r.left),
    rwb: side(Math.max(r.wb, r.dm), r.right),
    dm: side(r.dm, r.centre),
    lm: side(r.m, r.left),
    cm: side(r.m, r.centre),
    rm: side(r.m, r.right),
    am: side(r.am, r.centre),
    lw: Math.max(side(r.am, r.left), side(r.f, r.left)),
    rw: Math.max(side(r.am, r.right), side(r.f, r.right)),
    st: side(r.f, r.centre),
  };
}

/**
 * Natural position keys in CM_ROLES order: the slots rated 20, or, when there are none, the best-fitting slots if
 * they reach 15. Empty for a player with no usable ratings.
 */
export function cmNaturalPositions(ratings) {
  const fit = cmSlotFit(ratings), keys = Object.keys(CM_ROLES);
  const natural = keys.filter(key => fit[key] >= CM_NATURAL);
  if (natural.length) return natural;
  const best = Math.max(...keys.map(key => fit[key]));
  return best >= CM_ACCOMPLISHED ? keys.filter(key => fit[key] === best) : [];
}

/**
 * Expand a compact tuple `[cmId, name, fullName | 0, ca, 'cb,rb', nationality, club, dateOfBirth]` into the roster
 * tuple `[name, pos, rating, sourceInfo]` that buildTeam and buildClub read. `source` is the data set's source block.
 * Every field derives from the stored CM record; nothing is generated.
 */
export function expandCmTuple(tuple, source) {
  const [cmId, name, fullName, currentAbility, positionKeys, nationality, club, dateOfBirth] = tuple;
  const naturalPositions = String(positionKeys || '').split(',').filter(key => Object.hasOwn(CM_ROLES, key));
  if (!Number.isInteger(cmId) || cmId < 0 || typeof name !== 'string' || !name.trim() || !naturalPositions.length
      || typeof nationality !== 'string' || typeof club !== 'string' || typeof dateOfBirth !== 'string') {
    throw new Error(`Invalid CM tuple ${JSON.stringify(tuple)}`);
  }
  const positions = [...new Set(naturalPositions.map(key => CM_ROLES[key]))];
  const sourceInfo = {
    id: `cm:${cmId}`, fullName: typeof fullName === 'string' && fullName ? fullName : name, positions,
    source: CM_SOURCE, edition: source.edition, version: source.version, snapshotDate: source.snapshotDate,
    url: source.url, rawRating: currentAbility, rawScale: CM_SCALE, conversion: CM_CONVERSION,
    nationality, club,
  };
  if (dateOfBirth) sourceInfo.dateOfBirth = dateOfBirth;
  sourceInfo.naturalPositions = naturalPositions;
  return [name, positions[0], cmGameRating(currentAbility), sourceInfo];
}

/** The compact tuple of a CM player record, or null when the record is not one `expandCmTuple` would rebuild. */
export function cmTupleOf(name, sourceInfo) {
  if (sourceInfo?.source !== CM_SOURCE || typeof sourceInfo.id !== 'string' || !/^cm:\d{1,10}$/.test(sourceInfo.id)
      || !Array.isArray(sourceInfo.naturalPositions)) return null;
  return [Number(sourceInfo.id.slice(3)), name, sourceInfo.fullName === name ? 0 : sourceInfo.fullName, sourceInfo.rawRating,
    sourceInfo.naturalPositions.join(','), sourceInfo.nationality, sourceInfo.club, sourceInfo.dateOfBirth || ''];
}
