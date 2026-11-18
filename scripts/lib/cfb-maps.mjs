// The FBS seasons' era maps (docs/design/domestic-campaigns.md, "The FBS map"): each earlier season's schools, each at the
// stadium it played most of its home games in that season, from scripts/data/cfb-seasons.json. `maps` groups the seasons
// that share their schools and stadiums, each map listing its seasons' `schools`; `venues` gives a school's stadium in the
// seasons it played elsewhere than today (scripts/data/cfb-teams.json), `schools` the schools the built-in season lacks.
// No I/O: the callers read the files.

/** The data set id of an FBS season (2009 → 'cfb-2009'). */
export const cfbSeasonIdOf = year => `cfb-${year}`;

/** The era map of the manifest that serves season `year`, or undefined. */
export const cfbMapOf = (manifest, year) => (manifest.maps ?? []).find(map => map.seasons.includes(year));

/**
 * A school's place in season `year`, `{ id, name, city, stadium, home }`: the manifest's venue era that covers the season,
 * else the school's stadium of today (scripts/data/cfb-teams.json `teams`, or the manifest's `schools` for a school the
 * built-in season lacks). An era keeps the school's town unless it names its own (`city`).
 */
export function cfbPlaceOf(teams, manifest, id, year) {
  const today = teams[id] ?? manifest.schools?.[id];
  if (!today) throw new Error(`${id}: no school of scripts/data/cfb-teams.json or the manifest's schools`);
  const era = (manifest.venues?.[id] ?? []).find(e => e.from <= year && year <= e.to);
  return { id, name: today.name, city: era?.city ?? today.city, stadium: era?.stadium ?? today.stadium, home: era?.home ?? today.home };
}

/**
 * Season `year`'s schools at their places, in `order` (school ids: today's schools strongest first, then the manifest's
 * other schools), so that section ids follow the same order on every map.
 */
export function cfbTeamsOf(teams, manifest, year, order) {
  const map = cfbMapOf(manifest, year);
  if (!map) throw new Error(`${year}: no FBS map of scripts/data/cfb-seasons.json lists the season`);
  const rank = new Map(order.map((id, i) => [id, i]));
  const unranked = map.schools.filter(id => !rank.has(id));
  if (unranked.length) throw new Error(`${map.id}: ${unranked.join(', ')} is no school of today's and none of the manifest's schools`);
  return map.schools.map(id => cfbPlaceOf(teams, manifest, id, year)).sort((a, b) => rank.get(a.id) - rank.get(b.id));
}
