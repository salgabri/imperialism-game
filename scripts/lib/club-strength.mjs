// How strong each European club was in a season, on one scale across every country (docs/design/domestic-campaigns.md,
// "The Europe maps"): what an earlier season's Top 124 and Elite 32 are drawn by. A game's player ratings cannot do it:
// they rate a league's clubs well against each other but not one league against another (FIFA 10 rates every Premier
// League and La Liga side above Salzburg, Basel and every Ukrainian club). Results can, through the European cups.
//
// From every result of Europe's top divisions and the UEFA cups (schochastics/football-data, scripts/build-club-strength.mjs):
//   1. Standing: an Elo rating within each league, from its own games only (K 20, home advantage 80 points, more for a
//      wide margin, a shoot-out a draw). A club that comes up takes the mean rating of those that went down, so a
//      league's mean stays put; a club's standing is its rating less its league's mean.
//   2. Level: each league's level in each season (July to June), fitted to every UEFA cup game at once: a game is won
//      with the Elo chance of (level + standing + European form + home advantage) against the other side's. A level moves
//      from season to season by a random walk (30 points), so a league with few European games borrows from its years
//      either side; every level is held loosely to 1500 (300 points), which only matters where a league has no games.
//   3. European form: each club's over- or under-performance in its European games of the season, held to 0 (50 points),
//      so a long run in the Champions League counts and two qualifying games hardly do.
// A club's strength in a season is its league's level + its mean standing over August to May (the 1st and 15th of each
// month) + its European form. Only a club that played in its country's top division that season is ranked.
//
// No I/O here: rows in, strengths out (deterministic: the same rows give the same numbers).

export const STRENGTH_RULES = Object.freeze({
  firstDate: '1955-01-01',
  domesticK: 20,
  domesticHome: 80,
  // Two of a league's games this many days apart end one season and start the next.
  seasonGap: 40,
  // A club's standing counts for this many days after its last league game (a club down a division has none).
  standingDays: 400,
  levelPrior: 1500,
  levelPriorSd: 300,
  levelStep: 30,
  europeanSd: 50,
  iterations: 1500,
  learningRate: 2,
});

/** The UEFA club competitions in the results: Champions (League) Cup, UEFA Cup / Europa League, Conference League, Intertoto, Super Cup. */
export const UEFA_COMPETITIONS = Object.freeze(['UEFA CL', 'UEFA EL', 'UEFA CONF L', 'UEFA ITC', 'UEFA SC']);

/**
 * The leagues the results name otherwise than their clubs' countries, and those countries: North Macedonia's, Serbia
 * and Montenegro's of 1996/97 to 2005/06, East Germany's. Every other league is its country's name.
 */
export const LEAGUE_COUNTRIES = Object.freeze({
  'macedonia-fyr': Object.freeze(['north-macedonia']),
  'serbia-and-montenegro': Object.freeze(['serbia', 'montenegro']),
  ddr: Object.freeze(['germany']),
});
const leagueOfCountry = (league, country) => (LEAGUE_COUNTRIES[league] ?? [league]).includes(country);
// One level runs on through a league's change of name: Serbia and Montenegro's into Serbia's (2006/07 on), and its
// clubs' when they play in none, North Macedonia's by either name. East Germany's league stays a level of its own.
const LEVEL_KEYS = Object.freeze({ 'macedonia-fyr': 'north-macedonia', 'serbia-and-montenegro': 'serbia' });
/** The level a league's (or, playing in none, a country's) clubs take. */
export const levelKey = league => LEVEL_KEYS[league] ?? league;

const uefa = new Set(UEFA_COMPETITIONS);
const DAY = 86400000;
const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY;

/** The UEFA season a date falls in, named by the year it ends: July 2009 to June 2010 is 2010. */
export const seasonOfDate = date => Number(date.slice(0, 4)) + (Number(date.slice(5, 7)) >= 7 ? 1 : 0);

/**
 * The games the strengths are computed from, by date (ties in the file's order): every game of a European top division
 * between two European clubs, its league named by `competition`, and every UEFA cup game. A league game neither of
 * whose clubs is from the league's country (LEAGUE_COUNTRIES) is the source's slip and is left out (a Welsh club in the
 * English league stays). `rows` are the source's: `{ date: 'YYYY-MM-DD', home, away (idents), gh, ga, full_time,
 * competition, home_country, away_country, home_continent, away_continent, level }`.
 */
export function strengthGames(rows, rules = STRENGTH_RULES) {
  const games = [];
  rows.forEach((row, index) => {
    if (row.date < rules.firstDate || row.gh == null || row.ga == null) return;
    const isUefa = row.level === 'international' && uefa.has(row.competition);
    const isLeague = row.level === 'national' && row.home_continent === 'Europe' && row.away_continent === 'Europe'
      && (leagueOfCountry(row.competition, row.home_country) || leagueOfCountry(row.competition, row.away_country));
    if (!isUefa && !isLeague) return;
    games.push({ index, date: row.date, home: row.home, away: row.away, hg: row.gh, ag: row.ga, shootout: row.full_time === 'P',
      league: isLeague ? row.competition : null, homeCountry: row.home_country, awayCountry: row.away_country });
  });
  return games.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.index - b.index));
}

/** A game's score for the home side: 1, ½ (a draw, or a tie settled on penalties) or 0. */
const scoreOf = game => (game.shootout || game.hg === game.ag ? 0.5 : game.hg > game.ag ? 1 : 0);
/** World Football Elo's weight for the margin: 1 up to a goal, 1.5 for two, (11 + n) / 8 for n of three or more. */
const marginOf = game => { const n = game.shootout ? 0 : Math.abs(game.hg - game.ag); return n <= 1 ? 1 : n === 2 ? 1.5 : (11 + n) / 8; };
const eloChance = diff => 1 / (1 + 10 ** (-diff / 400));

/**
 * Step 1: each league's Elo, its seasons split where its games stop for `seasonGap` days. Returns `{ standing(club, date),
 * leagueOf(club, date), countryOf }`: a club's standing (rating less its league's mean) after its last league game before
 * `date`, and that game's league, or 0 and null when it played none in the `standingDays` before; `countryOf` every club's
 * own country.
 */
export function leagueStandings(games, rules = STRENGTH_RULES) {
  const byLeague = new Map();
  const countryOf = new Map();
  for (const game of games) {
    if (!countryOf.has(game.home)) countryOf.set(game.home, game.homeCountry);
    if (!countryOf.has(game.away)) countryOf.set(game.away, game.awayCountry);
    if (game.league) (byLeague.get(game.league) || byLeague.set(game.league, []).get(game.league)).push(game);
  }
  const history = new Map(); // club -> { dates: [], standings: [], leagues: [] }, in date order
  const note = (club, date, standing, league) => {
    let h = history.get(club);
    if (!h) history.set(club, h = { dates: [], standings: [], leagues: [] });
    h.dates.push(date);
    h.standings.push(standing);
    h.leagues.push(league);
  };
  for (const [league, list] of byLeague) {
    const seasons = [];
    let last = null;
    for (const game of list) {
      if (last === null || daysBetween(last, game.date) >= rules.seasonGap) seasons.push([]);
      seasons[seasons.length - 1].push(game);
      last = game.date;
    }
    const rating = new Map();
    let before = [];
    for (const season of seasons) {
      const members = [];
      for (const game of season) for (const club of [game.home, game.away]) if (!members.includes(club)) members.push(club);
      const staying = new Set(members);
      const left = before.filter(club => !staying.has(club)).map(club => rating.get(club));
      // A club that comes up (or a league's first season, at 1500) starts at the mean of those that went down.
      const entry = left.length ? left.reduce((sum, r) => sum + r, 0) / left.length
        : before.length ? before.map(club => rating.get(club)).sort((a, b) => a - b)[Math.floor(before.length * 0.15)] : 1500;
      const had = new Set(before);
      for (const club of members) if (!had.has(club)) rating.set(club, entry);
      const mean = members.reduce((sum, club) => sum + rating.get(club), 0) / members.length;
      for (const game of season) {
        const rh = rating.get(game.home), ra = rating.get(game.away);
        const delta = rules.domesticK * marginOf(game) * (scoreOf(game) - eloChance(rh + rules.domesticHome - ra));
        rating.set(game.home, rh + delta);
        rating.set(game.away, ra - delta);
        note(game.home, game.date, rh + delta - mean, league);
        note(game.away, game.date, ra - delta - mean, league);
      }
      before = members;
    }
  }
  // Each club's history in date order (a club in two leagues on one day keeps the file's order).
  for (const h of history.values()) {
    const order = h.dates.map((_, i) => i).sort((a, b) => (h.dates[a] < h.dates[b] ? -1 : h.dates[a] > h.dates[b] ? 1 : a - b));
    h.dates = order.map(i => h.dates[i]);
    h.standings = order.map(i => h.standings[i]);
    h.leagues = order.map(i => h.leagues[i]);
  }
  const lastBefore = (club, date) => {
    const h = history.get(club);
    if (!h) return -1;
    let lo = 0, hi = h.dates.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (h.dates[mid] < date) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found >= 0 && daysBetween(h.dates[found], date) <= rules.standingDays ? found : -1;
  };
  return {
    standing: (club, date) => { const i = lastBefore(club, date); return i < 0 ? 0 : history.get(club).standings[i]; },
    leagueOf: (club, date) => { const i = lastBefore(club, date); return i < 0 ? null : history.get(club).leagues[i]; },
    playedLeague: (club, from, to) => { const h = history.get(club); return !!h && h.dates.some(d => d >= from && d <= to); },
    countryOf,
  };
}

/**
 * Steps 2 and 3: every league's level in every season and every club's European form, fitted to the UEFA cup games at
 * once (the posterior's mode, by Adam's steps from 1500 and 0). A game counts for the league each club last played in
 * (Swansea's Europa League games of 2013/14 for England's), else its own country's. Returns `{ level(league, season),
 * form(club, season), home, games, logLoss }`.
 */
export function fitLevels(games, standings, rules = STRENGTH_RULES) {
  const cup = games.filter(game => !game.league);
  const seasons = cup.map(game => seasonOfDate(game.date));
  const first = Math.min(...seasons), count = Math.max(...seasons) - first + 1;
  const leagueIds = new Map(), formIds = new Map();
  const leagueOf = (club, date, country) => levelKey(standings.leagueOf(club, date) ?? country);
  const id = (map, key) => (map.has(key) ? map.get(key) : map.set(key, map.size).get(key));
  const rows = cup.map((game, i) => {
    const t = seasons[i] - first;
    const hl = leagueOf(game.home, game.date, game.homeCountry), al = leagueOf(game.away, game.date, game.awayCountry);
    return {
      h: id(leagueIds, hl) * count + t, a: id(leagueIds, al) * count + t,
      hs: standings.standing(game.home, game.date), as: standings.standing(game.away, game.date),
      hf: id(formIds, `${game.home}\u0000${seasons[i]}`), af: id(formIds, `${game.away}\u0000${seasons[i]}`), w: scoreOf(game),
    };
  });
  const level = new Float64Array(leagueIds.size * count).fill(rules.levelPrior), form = new Float64Array(formIds.size);
  const gLevel = new Float64Array(level.length), gForm = new Float64Array(form.length);
  const moments = [level, form].map(p => ({ m: new Float64Array(p.length), v: new Float64Array(p.length) }));
  let home = 60, mHome = 0, vHome = 0, logLoss = 0;
  const c = Math.LN10 / 400, b1 = 0.9, b2 = 0.999, eps = 1e-8, lr = rules.learningRate;
  const step = (p, g, { m, v }, it) => {
    for (let i = 0; i < p.length; i++) {
      m[i] = b1 * m[i] + (1 - b1) * g[i];
      v[i] = b2 * v[i] + (1 - b2) * g[i] * g[i];
      p[i] -= lr * (m[i] / (1 - b1 ** it)) / (Math.sqrt(v[i] / (1 - b2 ** it)) + eps);
    }
  };
  const step2 = rules.levelStep ** 2, prior2 = rules.levelPriorSd ** 2, form2 = rules.europeanSd ** 2;
  for (let it = 1; it <= rules.iterations; it++) {
    gLevel.fill(0);
    gForm.fill(0);
    let gHome = 0;
    logLoss = 0;
    for (const row of rows) {
      const e = 1 / (1 + Math.exp(-(level[row.h] + row.hs + form[row.hf] + home - level[row.a] - row.as - form[row.af]) * c));
      logLoss -= row.w * Math.log(e) + (1 - row.w) * Math.log(1 - e);
      const r = (e - row.w) * c;
      gLevel[row.h] += r; gLevel[row.a] -= r; gForm[row.hf] += r; gForm[row.af] -= r; gHome += r;
    }
    for (let k = 0; k < leagueIds.size; k++) {
      for (let t = 0; t < count; t++) {
        const i = k * count + t;
        gLevel[i] += (level[i] - rules.levelPrior) / prior2;
        if (t > 0) gLevel[i] += (level[i] - level[i - 1]) / step2;
        if (t < count - 1) gLevel[i] += (level[i] - level[i + 1]) / step2;
      }
    }
    for (let i = 0; i < form.length; i++) gForm[i] += form[i] / form2;
    step(level, gLevel, moments[0], it);
    step(form, gForm, moments[1], it);
    mHome = b1 * mHome + (1 - b1) * gHome;
    vHome = b2 * vHome + (1 - b2) * gHome * gHome;
    home -= lr * (mHome / (1 - b1 ** it)) / (Math.sqrt(vHome / (1 - b2 ** it)) + eps);
  }
  return {
    level: (league, season) => {
      const k = leagueIds.get(league), t = season - first;
      return k == null || t < 0 || t >= count ? null : level[k * count + t];
    },
    form: (club, season) => { const k = formIds.get(`${club}\u0000${season}`); return k == null ? 0 : form[k]; },
    home, games: rows.length, logLoss: rows.length ? logLoss / rows.length : 0,
  };
}

/** The 1st and 15th of each month from 1 August to 31 May of the season ending in `season`. */
export function seasonDates(season) {
  const dates = [];
  for (let year = season - 1; year <= season; year++) {
    for (let month = 1; month <= 12; month++) {
      for (const day of ['01', '15']) {
        const date = `${year}-${String(month).padStart(2, '0')}-${day}`;
        if (date >= `${season - 1}-08-01` && date <= `${season}-05-31`) dates.push(date);
      }
    }
  }
  return dates;
}

/**
 * Every club's strength in each of `seasons` (years they end in): `{ [season]: [{ club, country, league, strength,
 * level, standing, form }] }`, strongest first (equals by club), only clubs that played a league game from 15 August to
 * 31 May and whose league has a level that season: a league's season runs through those months, while the one before it
 * ends by early August, even 2019/20's, played on into the summer (Serie A's last day was 2 August 2020, the Swiss
 * Super League's the 3rd). `country` is the club's own (its `home_country`), `league` the league whose level it takes
 * (where it played its last league game before July).
 */
export function clubStrengths(rows, seasons, rules = STRENGTH_RULES) {
  const games = strengthGames(rows, rules);
  const standings = leagueStandings(games, rules);
  const fit = fitLevels(games, standings, rules);
  const out = {};
  for (const season of seasons) {
    const dates = seasonDates(season), from = `${season - 1}-08-15`, to = `${season}-05-31`;
    const list = [];
    for (const [club, country] of standings.countryOf) {
      if (!standings.playedLeague(club, from, to)) continue;
      const league = standings.leagueOf(club, `${season}-07-01`) ?? standings.leagueOf(club, dates[dates.length - 1]);
      const level = league == null ? null : fit.level(levelKey(league), season);
      if (level == null) continue;
      const standing = dates.reduce((sum, date) => sum + standings.standing(club, date), 0) / dates.length;
      const form = fit.form(club, season);
      list.push({ club, country, league, strength: level + standing + form, level, standing, form });
    }
    out[season] = list.sort((a, b) => b.strength - a.strength || (a.club < b.club ? -1 : a.club > b.club ? 1 : 0));
  }
  return { seasons: out, fit: { games: fit.games, home: fit.home, logLoss: fit.logLoss }, level: fit.level };
}
