// Confederation levels for the computed football nations (docs/design/football-years.md, "Confederation levels"):
// World Football Elo is zero-sum inside each match, so a confederation whose sides mostly play one another keeps the
// level its sides started from and drifts with the new sides that join it; only its matches against the other
// confederations' sides tie it to them. Those matches, each scored with the Elo from before it (one step ahead), show
// how far each confederation's Elo sits from the reference confederation's: the level is the Elo that, added to every
// side of the confederation, makes them predict their results against the others best, fitted on the matches of a window
// around the day under a normal prior. A level moves a whole confederation, so it changes no forecast inside one.
// Pure: the syncs read the results and the table (scripts/data/football-confederations.json) and write the levels
// into each season's facts; the builders add them to the nations' Elo.
import { eloTrace, expectedScore, yearsBefore } from './football-elo.mjs';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const round1 = x => Math.round(x * 10) / 10;

/**
 * A side's confederation on a day, from the table: its dated rows where it has any (the row that covers the day, else
 * none), else the confederation that lists it, else none. With `women`, the table's `datedWomen` rows replace a side's
 * dated rows. → (team, day) => confederation | null
 */
export function confederationResolver(table, { women = false } = {}) {
  const known = new Set(table.confederations);
  const member = new Map();
  for (const [confederation, teams] of Object.entries(table.teams)) {
    if (!known.has(confederation)) throw new Error(`The confederation table lists ${confederation}, which is none of ${table.confederations.join(', ')}`);
    for (const team of teams) {
      if (member.has(team)) throw new Error(`The confederation table lists ${team} twice`);
      member.set(team, confederation);
    }
  }
  const dated = new Map();
  const addRows = (rows, replace) => {
    const replaced = new Set();
    for (const row of rows) {
      const [team, confederation, from, until] = row;
      if (!known.has(confederation) || (from != null && !DAY.test(from)) || (until != null && !DAY.test(until)) || (from && until && from > until)) {
        throw new Error(`The confederation table's dated row ${JSON.stringify(row)} is not [team, confederation, from, until]`);
      }
      if (member.has(team)) throw new Error(`${team} is both listed and dated in the confederation table`);
      if (replace && !replaced.has(team)) { dated.set(team, []); replaced.add(team); }
      (dated.get(team) || dated.set(team, []).get(team)).push(row);
    }
  };
  addRows(table.dated, false);
  if (women) addRows(table.datedWomen ?? [], true);
  for (const [team, rows] of dated) {
    const sorted = rows.slice().sort((a, b) => ((a[2] ?? '') < (b[2] ?? '') ? -1 : 1));
    if (sorted.some((row, i) => i && (sorted[i - 1][3] == null || row[2] == null || sorted[i - 1][3] >= row[2]))) throw new Error(`${team}'s dated rows overlap`);
  }
  return (team, day) => {
    const rows = dated.get(team);
    if (!rows) return member.get(team) ?? null;
    const row = rows.find(([, , from, until]) => (from == null || day >= from) && (until == null || day <= until));
    return row ? row[1] : null;
  };
}

/**
 * Every match between sides of two confederations, scored one step ahead by the Elo (eloTrace): `{ date, dr, w, a, b }`,
 * dr and w the home side's, a its confederation and b the away side's.
 */
export function interConfederationMatches(matches, elo, confederationOf) {
  const out = [];
  eloTrace(matches, elo, (m, dr, w) => {
    const a = confederationOf(m.home, m.date), b = confederationOf(m.away, m.date);
    if (a && b && a !== b) out.push({ date: m.date, dr, w, a, b });
  });
  return out;
}

const LN = Math.LN10 / 400; // dWe/d(dr) = LN · We · (1 − We)

/** Solve A x = b (A symmetric positive definite, small) by Gaussian elimination with partial pivoting. */
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * The confederation levels on `day`: the inter-confederation matches (interConfederationMatches') played from `years`
 * years before the day to `years` after it, the reference confederation held at 0 and each other's level θ fitted so
 * p = We(dr + θ_home − θ_away) predicts them best (maximum likelihood, a draw half a win), under a normal prior of mean
 * 0 and standard deviation `prior` Elo. A confederation with no match in the window keeps the prior's 0. Its standard
 * error is the sandwich's (robust to the draws). → `{ from, to, matches, confederations: [[c, level, se, matches]] }` in the table's order,
 * levels and errors to a tenth of an Elo point.
 */
export function confederationLevels(inter, day, { years, prior, reference, confederations }) {
  if (!DAY.test(day)) throw new Error(`${day} is no day`);
  if (!confederations.includes(reference)) throw new Error(`The reference ${reference} is none of ${confederations.join(', ')}`);
  const from = yearsBefore(day, years), to = yearsBefore(day, -years);
  const window = inter.filter(m => m.date >= from && m.date < to);
  const free = confederations.filter(c => c !== reference && window.some(m => m.a === c || m.b === c));
  const k = free.length, index = new Map(free.map((c, j) => [c, j]));
  const xs = window.map(m => {
    const x = new Array(k).fill(0);
    if (index.has(m.a)) x[index.get(m.a)] += 1;
    if (index.has(m.b)) x[index.get(m.b)] -= 1;
    return x;
  });
  let theta = new Array(k).fill(0);
  const pass = () => {
    const g = theta.map(t => -t / prior ** 2);
    const I = free.map((_, j) => free.map((__, l) => (j === l ? 1 / prior ** 2 : 0)));
    const V = free.map(() => new Array(k).fill(0));
    window.forEach((m, i) => {
      const x = xs[i];
      const p = expectedScore(m.dr + x.reduce((sum, v, j) => sum + v * theta[j], 0));
      for (let j = 0; j < k; j++) {
        if (!x[j]) continue;
        g[j] += LN * (m.w - p) * x[j];
        for (let l = 0; l < k; l++) {
          if (!x[l]) continue;
          I[j][l] += LN * LN * p * (1 - p) * x[j] * x[l];
          V[j][l] += LN * LN * (m.w - p) ** 2 * x[j] * x[l];
        }
      }
    });
    return { g, I, V };
  };
  for (let iteration = 0; k && iteration < 100; iteration++) {
    const { g, I } = pass();
    const step = solve(I, g);
    theta = theta.map((t, j) => t + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-9) break;
  }
  const { I, V } = pass();
  const inverse = free.map((_, j) => solve(I, free.map((__, i) => (i === j ? 1 : 0))));
  const se = free.map((_, j) => {
    let s = 0;
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) s += inverse[a][j] * V[a][b] * inverse[b][j];
    return Math.sqrt(s);
  });
  const count = c => window.filter(m => m.a === c || m.b === c).length;
  return {
    from, to, matches: window.length,
    confederations: confederations.map(c => (c === reference ? [c, 0, 0, count(c)]
      : index.has(c) ? [c, round1(theta[index.get(c)]) + 0, round1(se[index.get(c)]), count(c)] : [c, 0, prior, 0])),
  };
}

/**
 * The levels a season's facts carry (`levels`: the manifest's { years, prior, reference }, `confederations` the table's):
 * a tournament's facts (worldCupFacts' and olympicFacts': `elo` { date, activeSince, … } and `nations` [{ team, results,
 * elo, rank, squad }]) gain `elo.levels` and `elo.levelledBest`, and each nation its confederation; a nation without
 * one stops the sync.
 */
export function tournamentWithLevels(facts, { snapshot, inter, levels, confederations, confederationOf }) {
  const day = facts.elo.date;
  const found = confederationLevels(inter, day, { ...levels, confederations });
  const best = levelledBest(snapshot, facts.elo.activeSince, day, found, confederationOf);
  const nations = facts.nations.map(({ team, results, elo, rank, ...rest }) => {
    const confederation = confederationOf(results, day);
    if (!confederation) throw new Error(`${facts.id}: ${team} (${results}) has no confederation on ${day} in scripts/data/football-confederations.json`);
    return { team, results, elo, rank, confederation, ...rest };
  });
  return { ...facts, elo: { ...facts.elo, levels: found, levelledBest: best }, nations };
}

/**
 * A season's Elo facts (seasonElo's: { date, activeSince, best, ratings: [[team, Elo, rank]] }) with the levels: `levels`,
 * `levelledBest`, and each row's confederation, [team, Elo, rank, confederation | null].
 */
export function seasonEloWithLevels(season, { snapshot, inter, levels, confederations, confederationOf }) {
  const found = confederationLevels(inter, season.date, { ...levels, confederations });
  const best = levelledBest(snapshot, season.activeSince, season.date, found, confederationOf);
  const { ratings, ...rest } = season;
  return { ...rest, levels: found, levelledBest: best, ratings: ratings.map(([team, elo, rank]) => [team, elo, rank, confederationOf(team, season.date)]) };
}

/** A side's level on the facts' day (`levels`: confederationLevels'), 0 for the reference; none without a confederation. */
export function levelOf(levels, confederation) {
  if (!confederation) return null;
  const entry = levels.confederations.find(([c]) => c === confederation);
  if (!entry) throw new Error(`No level for ${confederation}`);
  return entry[1];
}

/** E′ = E + the level, to a tenth. */
export const levelled = (elo, level) => round1(elo + level);

/** The levels as a season's rule names them: "UEFA 0, CONMEBOL −14.5, …, fitted on the matches of 1966-07-08 to 1982-07-08". */
export function levelsText(levels) {
  const signed = x => (x < 0 ? `−${-x}` : x > 0 ? `+${x}` : '0');
  return `${levels.confederations.map(([c, level]) => `${c} ${signed(level)}`).join(', ')}, fitted on the ${levels.matches} `
    + `inter-confederation matches from ${levels.from} to ${levels.to}`;
}

/**
 * The best levelled Elo of the teams active on the snapshot's day (`ratings`, `last`: eloOn's; active: a match from
 * `since`), of those with a confederation. → `{ team, elo }`
 */
export function levelledBest(snapshot, since, day, levels, confederationOf) {
  let best = null;
  for (const [team, elo] of snapshot.ratings) {
    if (!(snapshot.last.get(team) >= since)) continue;
    const level = levelOf(levels, confederationOf(team, day));
    if (level == null) continue;
    const value = levelled(round1(elo), level);
    if (!best || value > best.elo || (value === best.elo && team < best.team)) best = { team, elo: value };
  }
  if (!best) throw new Error(`No team with a confederation played from ${since} to ${day}`);
  return best;
}
