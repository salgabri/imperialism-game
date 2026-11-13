// The rules of a season's day. A built-in earlier season (a setup's or campaign's `dataSet`) plays the rules its sport
// had then: a sport whose rules changed gives them by season (`rulesFor(settings)`, read by matchSport in index.js),
// and the built-in current season, which has no data set, plays today's.

/**
 * The year whose rules a setup or campaign plays: its season's end year (`dataYear`: 1974 for 1973/74, 1977 for the
 * 1977 NFL season), or null for the built-in current season (today's rules).
 */
export function rulesYear(settings) {
  const year = settings?.dataYear;
  return settings?.dataSet != null && Number.isInteger(year) ? year : null;
}

/**
 * One sport object per set of rules: `make(key)` runs once for each key, and the same object comes back every time
 * after, so caches keyed by the sport object (odds, live models) hold across a campaign.
 */
export function rulesMemo(make) {
  const memo = new Map();
  return key => {
    if (!memo.has(key)) memo.set(key, make(key));
    return memo.get(key);
  };
}
