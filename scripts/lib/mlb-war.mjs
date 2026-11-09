// The seasons no game rated, 1960 to 2017, computed from the players' WAR (docs/design/baseball.md, "Seasons before
// 2018: computed from WAR"). npm run import:mlb-war (scripts/import-mlb-war.mjs) turns the pinned sources into one
// committed snapshot a season (scripts/data/mlb-war-seasons/<year>.json) and the reference of MLB The Show 18 to 24's
// overalls (scripts/data/mlb-war-reference.json); npm run build:mlb-seasons rates each season's players by these rules
// and teams them as every baseball season is teamed (scripts/lib/mlb.mjs); npm run build:mlb-map draws each era's map
// from the same franchise eras (scripts/data/mlb-war-seasons.json). No I/O here.
//
// A player's score is his WAR per playing time over the season and the two before it, weighted toward the latest and
// regressed toward a level below replacement, so that playing time counts. Each role's scores are then put on MLB The
// Show's scale rank for rank: the k-th best score of a season of T clubs takes the overall a player at the same depth
// per club held in MLB The Show 18 to 24.

/** The data set id of the computed season of `year`: 'mlb-war-1961'. */
export const warSeasonIdOf = year => `mlb-war-${year}`;
/** The season's listing label. */
export const warLabelOf = year => `Computed from WAR, end of ${year}`;
/** The three roles rated apart: hitters, starting pitchers and relievers. */
export const WAR_ROLES = Object.freeze(['H', 'SP', 'RP']);
/** The fielding positions a hitter's games are counted at (the designated hitter is any hitter's). */
export const FIELD_POSITIONS = Object.freeze(['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']);

/** `value` rounded to `digits` decimals, the one rounding every snapshot number goes through. */
export const roundTo = (value, digits) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

/**
 * A player-season's score from its snapshot row's inputs: `war` and `use` are the season's and the two before it
 * (latest first; null where he did not play), WAR and plate appearances for a hitter, pitching WAR and innings for a
 * pitcher; `li` a reliever's average leverage. `method` is the manifest's (scripts/data/mlb-war-seasons.json `method`):
 *   score = per × (Σ weight·WAR + prior·rate) / (Σ weight·use + prior) [+ leverage × li for a reliever]
 */
export function warScoreOf({ role, war, use, li }, method) {
  const rule = method.roles[role];
  if (!rule) throw new Error(`No scoring rule for role ${role}`);
  let num = rule.prior * rule.rate, den = rule.prior;
  for (let k = 0; k < rule.weights.length; k++) {
    if (war[k] == null) continue;
    num += rule.weights[k] * war[k];
    den += rule.weights[k] * use[k];
  }
  const score = rule.per * num / den + (rule.leverage ? rule.leverage * (li ?? 1) : 0);
  return roundTo(score, 4);
}

/**
 * Each player's rating, rank for rank within his role: `players` are `{ id, role, score }` of one season of
 * `clubCount` clubs; `reference` holds, by role, the overalls of the calibration seasons' players, strongest first,
 * over `teamSeasons` club-seasons. The k-th best score (0-based) takes the reference value at index
 * (k + 0.5) / clubCount × teamSeasons − 0.5, linearly interpolated and rounded; deeper ranks take the floor. Equal
 * scores share their mean rank, so ties stay ties and nobody passes anybody. → Map id → rating.
 */
export function rateByRank(players, reference, clubCount, teamSeasons) {
  const ratings = new Map();
  for (const role of WAR_ROLES) {
    const ref = reference[role];
    if (!ref?.length) throw new Error(`No reference overalls for role ${role}`);
    const list = players.filter(p => p.role === role).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (let i = 0; i < list.length;) {
      let j = i;
      while (j + 1 < list.length && list[j + 1].score === list[i].score) j++;
      const at = ((i + j) / 2 + 0.5) / clubCount * teamSeasons - 0.5;
      const lo = Math.max(0, Math.min(ref.length - 1, Math.floor(at))), hi = Math.min(ref.length - 1, lo + 1);
      const t = Math.min(1, Math.max(0, at - lo));
      const rating = Math.round(ref[lo] * (1 - t) + ref[hi] * t);
      for (let m = i; m <= j; m++) ratings.set(list[m].id, rating);
      i = j + 1;
    }
  }
  return ratings;
}

/**
 * The clubs of season `year`, `{ franchise, war, id, name, code, city, ballpark, base?, home, park }` in today's
 * franchise order (scripts/data/mlb-teams.json): each franchise with an era of scripts/data/mlb-war-seasons.json
 * (`eras`) covering the year, under its own id, name, code and territory (`city`) where the era names them and today's
 * otherwise. `war` is the Baseball-Reference code the WAR file and Lahman file the club under, `park` Lahman's key of the
 * ballpark it played most of its home games in, `base` the ballpark it grows from when that ballpark was another
 * club's (`home` is then the base's), and `lahmanName` the name Lahman gives the club where it is not the era's.
 */
export function teamsOfWar(franchises, manifest, year) {
  return Object.entries(franchises).flatMap(([franchise, team]) => {
    const era = (manifest.eras[franchise] || []).find(e => e.from <= year && year <= e.to);
    if (!era) return [];
    return [{ franchise, war: era.war, id: era.id ?? franchise, name: era.name ?? team.name, code: era.code ?? team.code,
      city: era.city ?? team.city, ballpark: era.ballpark, ...(era.base ? { base: era.base } : {}), home: era.home, park: era.park,
      ...(era.lahmanName ? { lahmanName: era.lahmanName } : {}) }];
  });
}

/** The era map the computed season of `year` plays on (scripts/data/mlb-war-seasons.json `maps`). */
export function warMapOf(manifest, year) {
  const map = manifest.maps.find(entry => entry.seasons.includes(year));
  if (!map) throw new Error(`No map for the ${year} season`);
  return map.id;
}

/**
 * The game's nation of a Lahman birth country (scripts/data/mlb-war-seasons.json `nations`): a nation id, or null for a
 * country the game has no nation for (and for a player with no birthplace). Throws for a country the manifest does not
 * list, so a new one is never placed silently.
 */
export function nationOfBirthCountry(country, nations) {
  if (country === '') return null;
  if (!Object.hasOwn(nations, country)) throw new Error(`No nation for the birth country ${JSON.stringify(country)}`);
  return nations[country];
}

/** A player's name as the seasons show it: Lahman's first name and surname, then the WAR file's generational suffix. */
export const displayNameOf = ({ first, last, suffix }) => `${first} ${last}${suffix ? ` ${suffix}` : ''}`;

/**
 * Names that tell apart players who share one (`group`: `{ id, first, last, suffix, given, born }`, `given` Lahman's
 * given names, `born` the birth year): the middle initial of each one's given names ("Bob L. Miller") when every one
 * has a second given name and their initials differ, else the birth year ("Pedro Martinez (1971)") when those differ;
 * nothing when neither tells them apart. → Map id → alias.
 */
export function aliasesOf(group) {
  const initials = group.map(p => p.given.split(/\s+/).filter(Boolean)[1]?.[0] ?? null);
  if (initials.every(Boolean) && new Set(initials).size === group.length) {
    return new Map(group.map((p, i) => [p.id, displayNameOf({ ...p, first: `${p.first} ${initials[i]}.` })]));
  }
  const years = group.map(p => p.born);
  if (years.every(Boolean) && new Set(years).size === group.length) return new Map(group.map(p => [p.id, `${displayNameOf(p)} (${p.born})`]));
  return new Map();
}
