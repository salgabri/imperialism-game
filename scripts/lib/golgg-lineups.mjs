// Who played for whom in League of Legends' earlier seasons (docs/design/league-of-legends.md, "Earlier seasons"), worked out
// from two pages a tournament instead of one a series: its match list (each series' teams, score and date) and its players
// list (each player's games, wins and figures over them, but not his team). gol.gg has some 31,000 series of 2016 to mid-2025
// and stopped answering after 5,000 pages once; the two lists are 2,000 pages in all.
//
// A side's five play its every game, one to a role, so a team's players share its record (games, wins) or make it up between
// them; and a player's figures give his team's own: his gold a minute over his share of his team's gold is the team's gold a
// minute, and likewise its vision score, damage and kills. Each player goes where the records, the roles and the figures fit
// best (`solveLineups`), then each tournament is solved again with what the season's others say of each player's team
// (`solveSeason`), which settles which of two teams with one record a group is. docs/design/league-of-legends.md gives how
// often that is right, on the tournaments whose series pages are known.
import { ROLES } from './league-of-legends.mjs';

// ---------- roles ----------

// A player's figures as a role shows in them: his creeps, his shares of the team's gold, damage, kills and vision, how he
// gets his kills, how often he dies.
const roleFigures = p => [p.csm, p.gold, p.dmg, p.kp, p.vs ?? null, p.kills / (p.kills + p.assists + 0.5), (p.kills + p.assists) / 10, p.deaths / 3,
  (p.soloKills ?? 0) / Math.max(1, p.games), p.firstBlood ?? null];
const softmax = values => {
  const most = Math.max(...values);
  const exps = values.map(value => Math.exp(value - most));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(value => value / sum);
};

/** A role model's inputs of a player: each figure standardised (an unknown one at its mean), their products beside them. */
function roleInputs({ mean, sd }, player) {
  const z = roleFigures(player).map((value, j) => (Number.isFinite(value) ? Math.max(-4, Math.min(4, (value - mean[j]) / sd[j])) : 0));
  const x = [1, ...z];
  for (let i = 0; i < z.length; i++) for (let j = i; j < z.length; j++) x.push(z[i] * z[j]);
  return x;
}

// The figures a players list may lack: vision score before 2018 (and in some leagues after), and gold and damage too in the
// LPL of 2016 and 2017. A model that reads a missing figure as average misreads the player (2026's lists stripped of gold
// and damage put 21% of the players at their role with even odds, 91% with a model fitted without them), so a role model
// holds one fitted without each (`lacking`).
const LACKING = Object.freeze({ vision: ['vspm', 'vs'], gold: ['gpm', 'gold', 'dpm', 'dmg', 'vspm', 'vs'] });
const without = (player, keys) => ({ ...player, ...Object.fromEntries(keys.map(key => [key, null])) });

/**
 * The odds of each role (ROLES' order) for a player by his figures (readPlayersTable's row), by the model fitted on the
 * figures he has (`model.lacking`); even where he has no creeps, or the model none fitted without what he lacks.
 */
export function roleOdds(model, player) {
  const even = ROLES.map(() => 1 / ROLES.length);
  if (player.csm == null) return even;
  const fitted = player.gold == null || player.dmg == null ? model.lacking?.gold : player.vs == null ? model.lacking?.vision : model;
  if (!fitted) return even;
  const x = roleInputs(fitted, player);
  return softmax(fitted.weights.map(w => w.reduce((sum, weight, j) => sum + weight * x[j], 0)));
}

/**
 * A role model fitted to players whose role is known (`examples`: [{ player, role }]), with one fitted without each kind of
 * figure a list may lack (LACKING) → { mean, sd, weights, lacking: { vision, gold } }.
 */
export function trainRoles(examples, options = {}) {
  return { ...fitRoles(examples, options), lacking: Object.fromEntries(Object.entries(LACKING).map(([kind, keys]) =>
    [kind, fitRoles(examples.map(({ player, role }) => ({ player: without(player, keys), role })), options)])) };
}

/**
 * One role model: multinomial logistic regression on the players' figures and the figures' products, by gradient descent
 * (Adam, `steps` of them, a small ridge).
 */
function fitRoles(examples, { steps = 600, ridge = 0.0005, rate = 0.05 } = {}) {
  const figures = examples.map(({ player }) => roleFigures(player));
  const D = figures[0].length;
  const known = j => figures.map(row => row[j]).filter(Number.isFinite);
  const mean = Array.from({ length: D }, (_, j) => known(j).reduce((a, b) => a + b, 0) / Math.max(1, known(j).length));
  const sd = Array.from({ length: D }, (_, j) => Math.sqrt(known(j).reduce((a, b) => a + (b - mean[j]) ** 2, 0) / Math.max(1, known(j).length)) || 1);
  const data = examples.map(({ player, role }) => ({ x: roleInputs({ mean, sd }, player), y: ROLES.indexOf(role) }));
  const F = data[0].x.length;
  const zeros = () => ROLES.map(() => new Float64Array(F));
  const weights = zeros(), first = zeros(), second = zeros();
  for (let step = 1; step <= steps; step++) {
    const grad = zeros();
    for (const { x, y } of data) {
      const odds = softmax(weights.map(w => { let sum = 0; for (let j = 0; j < F; j++) sum += w[j] * x[j]; return sum; }));
      for (let c = 0; c < ROLES.length; c++) {
        const slack = odds[c] - (c === y ? 1 : 0);
        for (let j = 0; j < F; j++) grad[c][j] += slack * x[j];
      }
    }
    for (let c = 0; c < ROLES.length; c++) for (let j = 0; j < F; j++) {
      const g = grad[c][j] / data.length + ridge * weights[c][j];
      first[c][j] = 0.9 * first[c][j] + 0.1 * g;
      second[c][j] = 0.999 * second[c][j] + 0.001 * g * g;
      weights[c][j] -= rate * (first[c][j] / (1 - 0.9 ** step)) / (Math.sqrt(second[c][j] / (1 - 0.999 ** step)) + 1e-9);
    }
  }
  return { mean, sd, weights: weights.map(w => [...w]) };
}

// ---------- a tournament ----------

/**
 * The teams of a match list: [{ name, games, wins, also? }], `also` the games and wins with the series of which gol.gg keeps
 * only the score (readMatchList `unlinked`), which its players list sometimes counts and sometimes does not.
 */
export function teamsOf(list) {
  const teams = new Map();
  for (const one of list) {
    [one.left, one.right].forEach((name, s) => {
      if (!teams.has(name)) teams.set(name, { name, games: 0, wins: 0, extra: [0, 0] });
      const team = teams.get(name);
      const played = one.score[0] + one.score[1];
      if (one.id == null) { team.extra[0] += played; team.extra[1] += one.score[s]; }
      else { team.games += played; team.wins += one.score[s]; }
    });
  }
  return [...teams.values()].map(({ name, games, wins, extra }) => ({ name, games, wins,
    ...(extra[0] ? { also: [games + extra[0], wins + extra[1]] } : {}) }));
}

// What a player's figures say of his team's (`of`, as a logarithm): gold a minute, vision score a minute, damage a minute and
// kills a game. Measured on 2026's team-mates, whose sides are known: `least` and `game` the error of one who played its every
// game, from rounding and averaging (`game` shrinking with the games), `part` a single game's spread, for one of part of them.
// `season` is how far a team's figure in one tournament stands from its season's.
const SIGNS = [
  { of: p => (p.gpm && p.gold ? p.gpm / p.gold : null), least: 0.0025, game: 0.006, part: 0.14, season: 0.03 },
  { of: p => (p.vspm && p.vs ? p.vspm / p.vs : null), least: 0.002, game: 0.03, part: 0.2, season: 0.05 },
  { of: p => (p.dpm && p.dmg ? p.dpm / p.dmg : null), least: 0.004, game: 0.07, part: 0.32, season: 0.06 },
  { of: p => (p.kp && p.kills != null ? (p.kills + p.assists) / p.kp : null), least: 0.01, game: 0.15, part: 0.76, season: 0.12 },
];
/** A team's season figures (readTeamsTable's row) as SIGNS reads them, null where the list has none. */
export const usualOf = team => [team.gpm, null, team.dpm, team.kills].map(value => (value > 0 ? Math.log(value) : null));
const SIGN_WEIGHT = 0.35;
// The cost of a player left without a team, a game.
const LEFT_OUT = 1.4;
// The cost of a team's players sharing another record than its own, a game or a win.
const ANOTHER_RECORD = 4;
// What a whole word on a player's team (a weight of 1) is worth: that much less there, that much more with another team.
const PRIOR = 8;
// A team's five with most games play one role each, in their likeliest arrangement (ARRANGEMENTS): each costs his
// log-odds against his likeliest role (MISFIT a unit), not a whole role's games. The role model reads an era unlike the
// one it learnt on with confidence and sometimes wrongly (2016's bot laners as mid laners, 84-91%), and counting each
// player at his likeliest role broke whole teams of one record apart rather than put one of them at his second role.
const MISFIT = 1;
// A group of one record is one team's only if its players can take a role each, together this unlikely at most.
const GROUP_MISFIT = Math.log(100);
const ARRANGEMENTS = (() => {
  const out = [];
  const take = (left, picked) => {
    if (!left.length) { out.push(picked); return; }
    left.forEach((r, k) => take([...left.slice(0, k), ...left.slice(k + 1)], [...picked, r]));
  };
  take(ROLES.map((_, r) => r), []);
  return out;
})();

/** A small seeded generator (mulberry32): the same tournament always solves the same way. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Which team each player of a tournament played for. `teams`: teamsOf's, each with its season's figures (`usual`, usualOf)
 * when known; `players`: readPlayersTable's rows, each with his role odds (`odds`); `prior(player)`: Map(team name → weight),
 * what other tournaments say. Starts from the groups the records and figures make plain, then moves and swaps players while
 * that lowers the cost, at random (seeded) so as not to stick, `restarts` times. → { teamOf: Map(id → team name), cost,
 * costs: Map(team name → cost) }
 */
export function solveLineups(teams, players, { prior = () => null, seed = 1, sweeps = 600, restarts = 5 } = {}) {
  const T = teams.length, P = players.length, NONE = T;
  const g = players.map(p => p.games), w = players.map(p => p.wins);
  const odds = players.map(p => p.odds);
  const role = odds.map(o => o.indexOf(Math.max(...o)));
  // Each player's log-odds of each role, and of his likeliest.
  const logOdds = odds.map(o => o.map(odd => Math.log(Math.max(1e-4, odd))));
  const likeliest = logOdds.map(l => Math.max(...l));
  /** The likeliest arrangement of up to five players at a role each → { roles (ROLES' indices, in `core`'s order), loss }. */
  const arrange = core => {
    let roles = null, score = -Infinity;
    for (const arrangement of ARRANGEMENTS) {
      let sum = 0;
      for (let k = 0; k < core.length; k++) sum += logOdds[core[k]][arrangement[k]];
      if (sum > score) { score = sum; roles = arrangement; }
    }
    return { roles, loss: core.reduce((sum, i) => sum + likeliest[i], 0) - score };
  };
  const signs = players.map(p => SIGNS.map(sign => { const value = sign.of(p); return value ? Math.log(value) : null; }));
  const here = new Set(teams.map(team => team.name));
  const priorCost = players.map(p => {
    const known = prior(p);
    if (!known?.size) return teams.map(() => 0);
    let inThis = 0;
    for (const [name, weight] of known) if (here.has(name)) inThis += weight;
    return teams.map(team => {
      const weight = known.get(team.name) ?? 0;
      return weight > 0 ? -PRIOR * Math.min(1, weight) : inThis > 0 ? PRIOR * Math.min(1, inThis) : 1;
    });
  });
  // A player cannot have more games, wins or losses than his team, give or take what one list has and the other lacks.
  const slack = team => Math.max(2, Math.ceil(team.games * 0.15)) + (team.also ? team.also[0] - team.games : 0);
  const able = players.map((p, i) => teams.map(team => g[i] <= team.games + slack(team) && w[i] <= team.wins + slack(team)
    && g[i] - w[i] <= team.games - team.wins + slack(team)));
  const members = Array.from({ length: T + 1 }, () => new Set());
  const at = new Int32Array(P).fill(NONE);
  const place = (i, t) => { members[at[i]].delete(i); members[t].add(i); at[i] = t; };
  // The variance of player i's reading of sign s when his team played G games.
  const own = (i, s) => SIGNS[s].least ** 2 + SIGNS[s].game ** 2 / Math.max(1, g[i]);
  const variance = (i, s, G) => own(i, s) + SIGNS[s].part ** 2 * Math.max(0, 1 / Math.max(1, g[i]) - 1 / Math.max(1, g[i], G));

  /** How badly a team's members fit its record, its roles and each other. */
  function costOf(t) {
    if (t === NONE) {
      let cost = 0;
      for (const i of members[NONE]) cost += LEFT_OUT * g[i];
      return cost;
    }
    const team = teams[t];
    let G = team.games, W = team.wins, cost = 0;
    // The two lists may differ by a game or a series: the record three of its players or more share stands in for the team's.
    const records = new Map();
    for (const i of members[t]) { const key = g[i] * 1000 + w[i]; records.set(key, (records.get(key) ?? 0) + 1); }
    const ofRecord = records.get(G * 1000 + W) ?? 0;
    let shared = null;
    for (const [key, n] of records) if (n >= 3 && n > ofRecord && (!shared || n > shared.n)) shared = { key, n };
    if (shared) {
      const games = Math.floor(shared.key / 1000), wins = shared.key % 1000;
      cost = ANOTHER_RECORD * Math.min(Math.abs(games - G) + Math.abs(wins - W), team.also ? Math.abs(games - team.also[0]) + Math.abs(wins - team.also[1]) : Infinity);
      G = games;
      W = wins;
    }
    let games = 0, wins = 0;
    for (const i of members[t]) { games += g[i]; wins += w[i]; }
    cost += 0.8 * Math.abs(ROLES.length * G - games) + 0.5 * Math.abs(ROLES.length * W - wins);
    // Each role's games and wins are the team's: its five with most games one to a role (MISFIT), each other where he
    // fills a role's games best for his odds.
    const ranked = [...members[t]].sort((a, b) => g[b] - g[a] || a - b);
    const core = ranked.slice(0, ROLES.length);
    const { roles: arranged, loss } = arrange(core);
    cost += MISFIT * loss;
    const byRole = ROLES.map(() => [0, 0]);
    core.forEach((i, k) => { byRole[arranged[k]][0] += g[i]; byRole[arranged[k]][1] += w[i]; });
    for (const i of ranked.slice(ROLES.length)) {
      let pick = 0, least = Infinity;
      for (let r = 0; r < ROLES.length; r++) {
        const [gamesThere, winsThere] = byRole[r];
        const change = 0.35 * (Math.abs(G - gamesThere - g[i]) - Math.abs(G - gamesThere)) + 0.2 * (Math.abs(W - winsThere - w[i]) - Math.abs(W - winsThere))
          + MISFIT * (likeliest[i] - logOdds[i][r]);
        if (change < least) { least = change; pick = r; }
      }
      byRole[pick][0] += g[i];
      byRole[pick][1] += w[i];
      cost += MISFIT * (likeliest[i] - logOdds[i][pick]);
    }
    for (const [gamesThere, winsThere] of byRole) cost += 0.35 * Math.abs(G - gamesThere) + 0.2 * Math.abs(W - winsThere);
    for (let s = 0; s < SIGNS.length; s++) {
      let sum = 0, weight = 0;
      for (const i of members[t]) {
        if (signs[i][s] == null) continue;
        const v = variance(i, s, G);
        sum += signs[i][s] / v;
        weight += 1 / v;
      }
      if (!weight) continue;
      const mean = sum / weight;
      if (team.usual?.[s] != null) cost += 0.5 * Math.min(12, ((mean - team.usual[s]) / SIGNS[s].season) ** 2);
      for (const i of members[t]) if (signs[i][s] != null) cost += SIGN_WEIGHT * Math.min(40, (signs[i][s] - mean) ** 2 / variance(i, s, G));
    }
    for (const i of members[t]) cost += priorCost[i][t];
    return cost;
  }

  /** How unlike two players' readings of their team are, over the signs both have. */
  const unlike = (i, j) => SIGNS.reduce((sum, _, s) => (signs[i][s] == null || signs[j][s] == null ? sum
    : sum + Math.min(60, (signs[i][s] - signs[j][s]) ** 2 / (own(i, s) + own(j, s)))), 0);

  // The plain groups: players of one record put together by their readings, the likest first, no more than one to a role.
  const pools = new Map();
  for (let i = 0; i < P; i++) { const key = `${g[i]}/${w[i]}`; if (!pools.has(key)) pools.set(key, []); pools.get(key).push(i); }
  const groups = [];
  for (const pool of pools.values()) {
    if (pool.length < 3) continue;
    const clusters = pool.map(i => [i]);
    for (;;) {
      let pick = null;
      for (let a = 0; a < clusters.length; a++) for (let b = a + 1; b < clusters.length; b++) {
        if (clusters[a].length + clusters[b].length > ROLES.length) continue;
        if (arrange([...clusters[a], ...clusters[b]]).loss > GROUP_MISFIT) continue;
        let sum = 0;
        for (const i of clusters[a]) for (const j of clusters[b]) sum += unlike(i, j);
        const mean = sum / (clusters[a].length * clusters[b].length);
        if (!pick || mean < pick.mean) pick = { a, b, mean };
      }
      if (!pick || pick.mean > 30) break;
      clusters[pick.a].push(...clusters[pick.b]);
      clusters.splice(pick.b, 1);
    }
    for (const cluster of clusters) if (cluster.length >= 3) groups.push(cluster);
  }
  groups.sort((a, b) => b.length - a.length || g[b[0]] - g[a[0]]);

  const rng = seeded(seed);
  let best = null;
  for (let attempt = 0; attempt < restarts; attempt++) {
    for (const set of members) set.clear();
    at.fill(NONE);
    for (let i = 0; i < P; i++) members[NONE].add(i);
    // Each plain group to a team of its record, then each left over to the nearest record's.
    const taken = new Set();
    for (const exact of [true, false]) {
      for (const group of groups) {
        if (at[group[0]] !== NONE) continue;
        const [games, wins] = [g[group[0]], w[group[0]]];
        const off = team => Math.min(Math.abs(team.games - games) + Math.abs(team.wins - wins),
          team.also ? Math.abs(team.also[0] - games) + Math.abs(team.also[1] - wins) : Infinity);
        const open = teams.map((_, t) => t).filter(t => !taken.has(t) && (exact ? off(teams[t]) === 0 : off(teams[t]) <= slack(teams[t]) + 1 && able[group[0]][t]));
        if (!open.length) continue;
        const fit = open.map(t => [group.reduce((sum, i) => sum + priorCost[i][t], 0) + 3 * off(teams[t]) + (attempt ? rng() : 0), t]);
        const t = fit.sort((a, b) => a[0] - b[0] || a[1] - b[1])[0][1];
        taken.add(t);
        for (const i of group) place(i, t);
      }
    }
    const cost = Float64Array.from({ length: T + 1 }, (_, t) => costOf(t));
    // The rest, most games first, each where he lowers the cost most.
    const rest = [...members[NONE]].sort((a, b) => g[b] - g[a] || (attempt ? rng() - 0.5 : a - b));
    for (const i of rest) {
      const before = cost[NONE];
      place(i, NONE);
      members[NONE].delete(i);
      const without = costOf(NONE);
      let pick = { gain: 0, t: NONE };
      for (let t = 0; t < T; t++) {
        if (!able[i][t]) continue;
        members[t].add(i);
        const gain = costOf(t) - cost[t] + without - before;
        members[t].delete(i);
        if (gain < pick.gain) pick = { gain, t };
      }
      members[pick.t].add(i);
      at[i] = pick.t;
      cost[NONE] = costOf(NONE);
      if (pick.t !== NONE) cost[pick.t] = costOf(pick.t);
    }
    let total = cost.reduce((a, b) => a + b, 0);
    const steps = sweeps * P;
    for (let step = 0; step < steps; step++) {
      const heat = (attempt ? 6 : 2.5) * (1 - step / steps) ** 2 + 0.02;
      const i = Math.floor(rng() * P);
      const from = at[i];
      let j = -1, to;
      if (rng() < 0.5) {
        // Two players change places, mostly two of one role.
        j = Math.floor(rng() * P);
        to = at[j];
        if (j === i || to === from || (role[j] !== role[i] && rng() < 0.85)) continue;
        if ((to !== NONE && !able[i][to]) || (from !== NONE && !able[j][from])) continue;
      } else {
        to = rng() < 0.06 ? NONE : Math.floor(rng() * T);
        if (to === from || (to !== NONE && !able[i][to])) continue;
      }
      place(i, to);
      if (j >= 0) place(j, from);
      const a = costOf(from), b = costOf(to);
      const change = a + b - cost[from] - cost[to];
      if (change <= 0 || rng() < Math.exp(-change / heat)) {
        cost[from] = a;
        cost[to] = b;
        total += change;
      } else {
        place(i, from);
        if (j >= 0) place(j, to);
      }
    }
    if (!best || total < best.total) best = { total, at: Int32Array.from(at), cost: Float64Array.from(cost) };
  }
  const teamOf = new Map();
  players.forEach((p, i) => { if (best && best.at[i] !== NONE) teamOf.set(p.id, teams[best.at[i]].name); });
  return { teamOf, cost: best?.total ?? 0, costs: new Map(teams.map((team, t) => [team.name, best?.cost[t] ?? 0])) };
}

// ---------- a season ----------

const DAY = 86400000;
// A team's name without what marks an org's second team: "KT Rolster Challengers" and "KT Rolster" are one org, whose academy
// plays in the cups under the org's name.
const orgOf = name => name.replace(/\b(challengers?|academy|youth team|junior|prospects|fenix|blue stars?|blue|nord|esports|e-sports|gaming|team)\b/gi, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();
// How long a tournament speaks for a player's team: its word fades over about two months.
const FADE_DAYS = 60;

/** The days between two tournaments (0 when they overlap). */
const apart = (a, b) => Math.max(0, (Date.parse(a.from) - Date.parse(b.to)) / DAY, (Date.parse(b.from) - Date.parse(a.to)) / DAY);

// How far its players' other tournaments, bearing a group's name out, set it apart from the teams of the same record.
const BORNE = 0.7;

/**
 * A season's line-ups. `tournaments`: [{ name, from, to, list (readMatchList's, unlinked too), players (readPlayersTable's,
 * each with `odds`) }]; `usual`: Map(team name → usualOf's). Each tournament is solved with what those already solved say of
 * each player's team, the nearer in time the more, the plainest (the fewest teams of a shared record) first, `passes` times
 * over. A group of a record of its own is surely that team's; one of a shared record may be any of the teams that share it,
 * and is named by its players' other tournaments. → Map(tournament → { teams, teamOf, cost, costs, names: Map(team name →
 * Map(team name → the likelihood that its group is that team's)) })
 */
export function solveSeason(tournaments, { usual = new Map(), passes = 3 } = {}) {
  const solved = new Map();
  // What each tournament says of each player's team: Map(id → Map(tournament → { names, weight })).
  const says = new Map();
  const plans = tournaments.map(t => {
    const teams = teamsOf(t.list).map(team => ({ ...team, usual: usual.get(team.name) ?? null }));
    const records = new Map();
    for (const team of teams) { const key = `${team.games}/${team.wins}`; records.set(key, (records.get(key) ?? 0) + 1); }
    // The teams whose record another has too, each with the names that share it.
    const shared = new Map(teams.filter(team => records.get(`${team.games}/${team.wins}`) > 1)
      .map(team => [team.name, teams.filter(other => other.games === team.games && other.wins === team.wins).map(other => other.name)]));
    return { t, teams, shared, names: new Set(teams.map(team => team.name)), orgs: new Map(teams.map(team => [orgOf(team.name), team.name])),
      games: teams.reduce((sum, team) => sum + team.games, 0) };
  }).sort((a, b) => a.shared.size / Math.max(1, a.teams.length) - b.shared.size / Math.max(1, b.teams.length) || b.games - a.games
    || a.t.name.localeCompare(b.t.name));
  for (let pass = 0; pass < passes; pass++) {
    for (const { t, teams, shared, names, orgs } of plans) {
      const prior = player => {
        const known = new Map();
        for (const [other, word] of says.get(player.id) ?? []) {
          if (other === t) continue;
          const faded = word.weight * Math.exp(-apart(other, t) / FADE_DAYS);
          for (const [team, likelihood] of word.names) {
            const name = names.has(team) ? team : orgs.get(orgOf(team));
            known.set(name ?? team, (known.get(name ?? team) ?? 0) + faded * likelihood * (name && name !== team ? 0.5 : 1));
          }
        }
        return known;
      };
      const one = solveLineups(teams, t.players, { prior, seed: 1 + pass });
      one.teams = teams;
      one.names = new Map(teams.map(team => {
        if (!shared.has(team.name)) return [team.name, new Map([[team.name, 1]])];
        const members = t.players.filter(p => one.teamOf.get(p.id) === team.name);
        const games = members.reduce((sum, p) => sum + p.games, 0);
        const borne = BORNE * members.reduce((sum, p) => sum + p.games * Math.min(1, prior(p).get(team.name) ?? 0), 0) / Math.max(1, games);
        const sharers = shared.get(team.name);
        return [team.name, new Map(sharers.map(name => [name, (1 - borne) / sharers.length + (name === team.name ? borne : 0)]))];
      }));
      solved.set(t, one);
      for (const p of t.players) {
        if (!says.has(p.id)) says.set(p.id, new Map());
        const team = one.teamOf.get(p.id);
        if (team) says.get(p.id).set(t, { names: one.names.get(team), weight: Math.min(1, p.games / 8) });
        else says.get(p.id).delete(t);
      }
    }
  }
  return solved;
}

/**
 * The role each of a team's players took in a tournament: its five with most games one to a role, by the likeliest arrangement
 * of the five; each other by his own odds. `members`: [{ id, games, odds }]. → Map(id → role)
 */
export function rolesWithin(members) {
  const sorted = members.slice().sort((a, b) => b.games - a.games || a.id - b.id);
  const five = sorted.slice(0, ROLES.length);
  const roles = new Map();
  for (const p of sorted) roles.set(p.id, ROLES[p.odds.indexOf(Math.max(...p.odds))]);
  if (five.length < ROLES.length || five.at(-1).games < sorted[0].games / 2) return roles;
  const log = five.map(p => p.odds.map(odd => Math.log(Math.max(1e-6, odd))));
  let best = null;
  const take = (n, used, sum, picked) => {
    if (n === five.length) { if (!best || sum > best.sum) best = { sum, picked: picked.slice() }; return; }
    for (let r = 0; r < ROLES.length; r++) if (!used.has(r)) { used.add(r); picked.push(r); take(n + 1, used, sum + log[n][r], picked); picked.pop(); used.delete(r); }
  };
  take(0, new Set(), 0, []);
  five.forEach((p, n) => roles.set(p.id, ROLES[best.picked[n]]));
  return roles;
}
