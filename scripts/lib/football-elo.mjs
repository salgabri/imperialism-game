// World Football Elo for the computed World Cup seasons (docs/design/football-years.md, "Computed World Cup seasons"):
// men's full internationals from martj42/international_results (CC0), rated by the formula eloratings.net publishes.
// Pure: the caller reads results.csv and passes its rows; every constant comes from the manifest
// (scripts/data/world-cup-seasons.json `elo`), so a later change of the built-in data changes nothing here.
//
//   R' = R + K · G · (W − We),  We = 1 / (1 + 10^(−dr / 400)),  dr = R_home − R_away (+ home, unless neutral)
//
// K by tournament (manifest `elo.k`), G by goal margin (1, 1.5, 1.75, then 1.75 + (N − 3) / 8), W 1, ½ or 0 (a match
// level after extra time is a draw, whatever its shoot-out). A team starts at `start.early`, or at `start.late` when its
// first match is in a year after `start.lateAfter`.

/** K for a tournament: the first of the manifest's lists that names it, else the rule for qualifiers, else `other`. */
export function kFactor(tournament, k) {
  if (k.worldCup.includes(tournament)) return k.worldCupK;
  if (k.continental.includes(tournament)) return k.continentalK;
  if (tournament.endsWith(k.qualifierSuffix) || k.qualifier.includes(tournament)) return k.qualifierK;
  if (k.friendly.includes(tournament)) return k.friendlyK;
  return k.otherK;
}

/** G, the goal-margin factor. */
export const goalFactor = margin => (margin <= 1 ? 1 : margin === 2 ? 1.5 : margin === 3 ? 1.75 : 1.75 + (margin - 3) / 8);

/** The expected score of a side `dr` Elo points stronger. */
export const expectedScore = dr => 1 / (1 + 10 ** (-dr / 400));

const SCORE = /^\d{1,3}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Check martj42's rows (date, home_team, away_team, home_score, away_score, tournament, neutral) and keep them in the
 * file's order, which is by date; refuse anything else rather than guess.
 */
export function resultRows(rows) {
  let last = '';
  return rows.map((row, i) => {
    const at = `results.csv row ${i + 2}`;
    if (!DAY.test(row.date) || row.date < last) throw new Error(`${at}: date ${row.date} is not a day after ${last || 'the start'}`);
    last = row.date;
    if (!row.home_team || !row.away_team || row.home_team === row.away_team) throw new Error(`${at}: teams ${row.home_team} and ${row.away_team}`);
    if (!SCORE.test(row.home_score) || !SCORE.test(row.away_score)) throw new Error(`${at}: score ${row.home_score}-${row.away_score}`);
    if (!['TRUE', 'FALSE'].includes(row.neutral)) throw new Error(`${at}: neutral ${row.neutral}`);
    if (!row.tournament) throw new Error(`${at}: no tournament`);
    return { date: row.date, home: row.home_team, away: row.away_team, homeScore: Number(row.home_score), awayScore: Number(row.away_score),
      tournament: row.tournament, neutral: row.neutral === 'TRUE' };
  });
}

/**
 * Rate `matches` (resultRows') in order and read the ratings on each of `dates`: the state after every match played
 * before that day. Returns `{ [date]: { ratings: Map(team → Elo), last: Map(team → day of its last match), games } }`.
 */
export function eloOn(matches, dates, elo) {
  const firstYear = new Map();
  for (const m of matches) for (const team of [m.home, m.away]) if (!firstYear.has(team)) firstYear.set(team, Number(m.date.slice(0, 4)));
  const startOf = team => (firstYear.get(team) > elo.start.lateAfter ? elo.start.late : elo.start.early);
  const ratings = new Map(), last = new Map(), games = new Map();
  const snapshots = {};
  const wanted = [...new Set(dates)].sort();
  let next = 0;
  const take = () => { snapshots[wanted[next]] = { ratings: new Map(ratings), last: new Map(last), games: new Map(games) }; next++; };
  for (const m of matches) {
    while (next < wanted.length && m.date >= wanted[next]) take();
    if (next === wanted.length) break;
    for (const team of [m.home, m.away]) if (!ratings.has(team)) ratings.set(team, startOf(team));
    const dr = ratings.get(m.home) + (m.neutral ? 0 : elo.home) - ratings.get(m.away);
    const w = m.homeScore > m.awayScore ? 1 : m.homeScore < m.awayScore ? 0 : 0.5;
    const change = kFactor(m.tournament, elo.k) * goalFactor(Math.abs(m.homeScore - m.awayScore)) * (w - expectedScore(dr));
    ratings.set(m.home, ratings.get(m.home) + change);
    ratings.set(m.away, ratings.get(m.away) - change);
    for (const team of [m.home, m.away]) {
      last.set(team, m.date);
      games.set(team, (games.get(team) || 0) + 1);
    }
  }
  while (next < wanted.length) take();
  return snapshots;
}

/** The day `days` after `day` (YYYY-MM-DD, UTC). */
export function dayAfter(day, days = 1) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The same day `years` earlier (29 February falls back to the 28th). */
export function yearsBefore(day, years) {
  const [y, m, d] = day.split('-').map(Number);
  const back = new Date(Date.UTC(y - years, m - 1, d));
  if (back.getUTCMonth() !== m - 1) back.setUTCDate(0);
  return back.toISOString().slice(0, 10);
}
