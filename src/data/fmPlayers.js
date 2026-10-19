// Football Manager 26 (EFEM.club) player conversion, shared by the build scripts
// and the browser. EFEM publishes Current Ability already normalised to 1–100;
// the game scales it once to its 1–99 display range and never invents a value.

export const FM_ROLES = {
  gk: 'GK', lb: 'DF', cb: 'DF', rb: 'DF', lwb: 'DF', rwb: 'DF',
  dm: 'MF', lm: 'MF', cm: 'MF', rm: 'MF', am: 'MF', lw: 'FW', rw: 'FW', st: 'FW',
};
export const FM_NATURAL_MIN = 90;
export const FM_CONVERSION = 'round(currentAbility * 99 / 100)';
export const FM_ORIGIN = 'https://efem.club';

export function fmGameRating(currentAbility) {
  if (!Number.isFinite(currentAbility) || currentAbility <= 0 || currentAbility > 100) throw new Error('Invalid FM current ability');
  return Math.max(1, Math.round(currentAbility * 99 / 100));
}

/** Natural FM position keys, strongest first (stable in FM_ROLES order on ties). */
export function fmNaturalPositions(proficiency) {
  return Object.keys(FM_ROLES).filter(pos => proficiency?.[pos] >= FM_NATURAL_MIN)
    .sort((a, b) => proficiency[b] - proficiency[a]);
}

export function fmPlayerUrl(id, name, origin = FM_ORIGIN) {
  return `${origin}/players/${id}-${encodeURIComponent(name.replace(/[\s/]+/g, '-'))}`;
}

/**
 * Expand a compact domestic tuple `[fmId, name, currentAbility, 'st,lw', nationCode?]`
 * into the roster tuple `[name, pos, rating, sourceInfo]` that buildClub reads.
 * Every field derives from the stored FM record; nothing is generated.
 */
export function expandFmTuple(tuple, source, clubName) {
  const [fmId, name, currentAbility, positionKeys, nationCode] = tuple;
  const naturalPositions = String(positionKeys || '').split(',').filter(pos => Object.hasOwn(FM_ROLES, pos));
  if (!Number.isInteger(fmId) || !name || !naturalPositions.length) throw new Error(`Invalid FM tuple ${JSON.stringify(tuple)}`);
  const positions = [...new Set(naturalPositions.map(pos => FM_ROLES[pos]))];
  const sourceInfo = {
    id: `fm:${fmId}`, fullName: name, positions,
    source: 'football-manager', edition: source.edition || 'FM 26', version: source.version,
    snapshotDate: source.snapshotDate, url: fmPlayerUrl(fmId, name, source.origin || FM_ORIGIN),
    rawRating: currentAbility, rawScale: 100, conversion: FM_CONVERSION,
    club: clubName, naturalPositions,
  };
  if (nationCode) sourceInfo.nationality = nationCode;
  return [name, positions[0], fmGameRating(currentAbility), sourceInfo];
}
