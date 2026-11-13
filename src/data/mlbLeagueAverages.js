// MLB's regular seasons, summed over every club: `games` its team-games (each game counted once a side), `runs` the
// runs scored, `outs` the outs its pitchers recorded and `shutouts` the games a side was held scoreless.
//
// 1960 to 2022 are summed from the Baseball Databank's Teams.csv (Chadwick Baseball Bureau, CC BY-SA 3.0, commit
// e9f247e, the copy scripts/data/mlb-war-seasons.json pins): G, R, IPouts and SHO of every American and National League
// club. npm run import:mlb-war sums them again from that file and stops on any number that is not this module's.
// 2023 to 2026 are summed from MLB's own Stats API (MLB Advanced Media), read 2026-11-10: each club's regular season,
// https://statsapi.mlb.com/api/v1/teams/stats?season=<year>&sportIds=1&group=hitting&stats=season&gameType=R for games and
// runs, group=pitching for outs and shutouts, kept club by club in scripts/data/mlb-league-runs.json (node
// scripts/sync-mlb-league-runs.mjs). The API gives the same games and runs as the Databank in every season the file
// holds of both (1960, 1968, 1981, 1987, 1994, 2000, 2010, 2018 to 2022), and the same shutouts and outs but for 2020's
// shutouts (100 against 99) and the outs of 1960 and 1968 (13 and 21 more); scripts/baseball-eras.test.mjs holds both.
//
// Baseball plays each earlier season so that its games average its runs a game (3.42 in 1968, 5.14 in 2000) in the
// proportion they bear to the latest full season's (src/sports/baseball.js `baseballIn`, docs/design/baseball.md "Rules by
// era"); shutouts are what the tests hold its run distribution to. 2020 and 2021 scheduled seven-inning doubleheaders,
// which the game does not play, so their runs a game run 2–4% under their runs a nine innings (27 · runs / outs).
export const MLB_LEAGUE_TOTALS = Object.freeze({
  1960: Object.freeze({ games: 2472, runs: 10664, outs: 66597, shutouts: 159 }),
  1961: Object.freeze({ games: 2860, runs: 12942, outs: 76347, shutouts: 173 }),
  1962: Object.freeze({ games: 3242, runs: 14461, outs: 86991, shutouts: 199 }),
  1963: Object.freeze({ games: 3238, runs: 12780, outs: 87300, shutouts: 275 }),
  1964: Object.freeze({ games: 3252, runs: 13124, outs: 87390, shutouts: 269 }),
  1965: Object.freeze({ games: 3246, runs: 12946, outs: 87525, shutouts: 243 }),
  1966: Object.freeze({ games: 3230, runs: 12900, outs: 87111, shutouts: 246 }),
  1967: Object.freeze({ games: 3240, runs: 12210, outs: 87534, shutouts: 274 }),
  1968: Object.freeze({ games: 3250, runs: 11109, outs: 87681, shutouts: 339 }),
  1969: Object.freeze({ games: 3892, runs: 15850, outs: 104643, shutouts: 300 }),
  1970: Object.freeze({ games: 3888, runs: 16880, outs: 104576, shutouts: 234 }),
  1971: Object.freeze({ games: 3876, runs: 15073, outs: 104301, shutouts: 315 }),
  1972: Object.freeze({ games: 3718, runs: 13706, outs: 100351, shutouts: 357 }),
  1973: Object.freeze({ games: 3886, runs: 16376, outs: 104636, shutouts: 293 }),
  1974: Object.freeze({ games: 3890, runs: 16046, outs: 104827, shutouts: 286 }),
  1975: Object.freeze({ games: 3868, runs: 16295, outs: 104172, shutouts: 266 }),
  1976: Object.freeze({ games: 3878, runs: 15492, outs: 104777, shutouts: 325 }),
  1977: Object.freeze({ games: 4206, runs: 18803, outs: 113217, shutouts: 238 }),
  1978: Object.freeze({ games: 4204, runs: 17251, outs: 112490, shutouts: 305 }),
  1979: Object.freeze({ games: 4196, runs: 18713, outs: 112435, shutouts: 237 }),
  1980: Object.freeze({ games: 4210, runs: 18053, outs: 113584, shutouts: 264 }),
  1981: Object.freeze({ games: 2788, runs: 11147, outs: 75285, shutouts: 220 }),
  1982: Object.freeze({ games: 4214, runs: 18110, outs: 113635, shutouts: 238 }),
  1983: Object.freeze({ games: 4218, runs: 18170, outs: 113226, shutouts: 248 }),
  1984: Object.freeze({ games: 4210, runs: 17921, outs: 113114, shutouts: 254 }),
  1985: Object.freeze({ games: 4206, runs: 18216, outs: 112976, shutouts: 257 }),
  1986: Object.freeze({ games: 4206, runs: 18545, outs: 113023, shutouts: 236 }),
  1987: Object.freeze({ games: 4210, runs: 19883, outs: 112724, shutouts: 212 }),
  1988: Object.freeze({ games: 4200, runs: 17380, outs: 113003, shutouts: 292 }),
  1989: Object.freeze({ games: 4212, runs: 17405, outs: 113145, shutouts: 292 }),
  1990: Object.freeze({ games: 4210, runs: 17919, outs: 112691, shutouts: 260 }),
  1991: Object.freeze({ games: 4208, runs: 18127, outs: 113309, shutouts: 272 }),
  1992: Object.freeze({ games: 4212, runs: 17341, outs: 113489, shutouts: 298 }),
  1993: Object.freeze({ games: 4538, runs: 20864, outs: 121521, shutouts: 220 }),
  1994: Object.freeze({ games: 3200, runs: 15752, outs: 85759, shutouts: 143 }),
  1995: Object.freeze({ games: 4034, runs: 19554, outs: 108096, shutouts: 204 }),
  1996: Object.freeze({ games: 4534, runs: 22831, outs: 121682, shutouts: 196 }),
  1997: Object.freeze({ games: 4532, runs: 21604, outs: 121362, shutouts: 211 }),
  1998: Object.freeze({ games: 4864, runs: 23297, outs: 130304, shutouts: 244 }),
  1999: Object.freeze({ games: 4856, runs: 24691, outs: 129634, shutouts: 193 }),
  2000: Object.freeze({ games: 4858, runs: 24971, outs: 129733, shutouts: 204 }),
  2001: Object.freeze({ games: 4858, runs: 23199, outs: 129862, shutouts: 229 }),
  2002: Object.freeze({ games: 4852, runs: 22408, outs: 129807, shutouts: 275 }),
  2003: Object.freeze({ games: 4860, runs: 22978, outs: 130006, shutouts: 259 }),
  2004: Object.freeze({ games: 4856, runs: 23376, outs: 130182, shutouts: 251 }),
  2005: Object.freeze({ games: 4862, runs: 22325, outs: 129697, shutouts: 261 }),
  2006: Object.freeze({ games: 4858, runs: 23599, outs: 129774, shutouts: 260 }),
  2007: Object.freeze({ games: 4862, runs: 23322, outs: 130277, shutouts: 243 }),
  2008: Object.freeze({ games: 4856, runs: 22585, outs: 130073, shutouts: 271 }),
  2009: Object.freeze({ games: 4860, runs: 22419, outs: 129816, shutouts: 273 }),
  2010: Object.freeze({ games: 4860, runs: 21308, outs: 129916, shutouts: 329 }),
  2011: Object.freeze({ games: 4858, runs: 20808, outs: 130582, shutouts: 323 }),
  2012: Object.freeze({ games: 4860, runs: 21017, outs: 130066, shutouts: 310 }),
  2013: Object.freeze({ games: 4862, runs: 20255, outs: 130960, shutouts: 331 }),
  2014: Object.freeze({ games: 4860, runs: 19761, outs: 130841, shutouts: 353 }),
  2015: Object.freeze({ games: 4858, runs: 20647, outs: 130223, shutouts: 339 }),
  2016: Object.freeze({ games: 4856, runs: 21744, outs: 129919, shutouts: 276 }),
  2017: Object.freeze({ games: 4860, runs: 22582, outs: 129771, shutouts: 261 }),
  2018: Object.freeze({ games: 4862, runs: 21630, outs: 130467, shutouts: 312 }),
  2019: Object.freeze({ games: 4858, runs: 23467, outs: 130270, shutouts: 268 }),
  2020: Object.freeze({ games: 1796, runs: 8344, outs: 46406, shutouts: 99 }),
  2021: Object.freeze({ games: 4858, runs: 22010, outs: 127845, shutouts: 299 }),
  2022: Object.freeze({ games: 4860, runs: 20817, outs: 129226, shutouts: 341 }),
  2023: Object.freeze({ games: 4860, runs: 22432, outs: 129262, shutouts: 309 }),
  2024: Object.freeze({ games: 4858, runs: 21343, outs: 129349, shutouts: 321 }),
  2025: Object.freeze({ games: 4860, runs: 21614, outs: 129225, shutouts: 331 }),
  2026: Object.freeze({ games: 4858, runs: 21769, outs: 129239, shutouts: 301 }),
});

/** The latest full season, 2026, the built-in season's own: a season without totals plays at its rate. */
export const LATEST_MLB_SEASON = Math.max(...Object.keys(MLB_LEAGUE_TOTALS).map(Number));

const totalsOf = year => (Object.hasOwn(MLB_LEAGUE_TOTALS, year) ? MLB_LEAGUE_TOTALS[year] : null);

/** The runs a side scored a game in MLB's regular season `year` (4.48 in 2026), or null for a season without totals. */
export function mlbRunsPerGame(year) {
  const totals = totalsOf(year);
  return totals ? totals.runs / totals.games : null;
}

/** The runs a side scored in nine innings (27 outs) in MLB's regular season `year`, or null for a season without totals. */
export function mlbRunsPerNine(year) {
  const totals = totalsOf(year);
  return totals ? 27 * totals.runs / totals.outs : null;
}

/** The share of a side's games in which it was held scoreless in MLB's regular season `year`, or null without totals. */
export function mlbShutoutRate(year) {
  const totals = totalsOf(year);
  return totals ? totals.shutouts / totals.games : null;
}
