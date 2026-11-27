// Players' Elo from team results, as Rocket League's ratings are built (scripts/lib/rocket-league.mjs, which keeps its own
// copy for its Liquipedia exports), shared by the esports read from results sites: Valorant from vlr.gg
// (scripts/lib/valorant.mjs) and League of Legends from gol.gg (scripts/lib/league-of-legends.mjs).
//
// A series is a match between two teams; each of its games (a Valorant map, a League game) is one Elo game between the
// players who played it. A side plays at its players' mean Elo, the winner takes K × (1 − E) from the loser, and each of a
// side's players moves by his side's amount, his K shrinking with his games.
import { NATIONS, nationIdentity } from '../../src/data/teams.js';

export const START = 1500;
export const K_FLOOR = 8;
const DAY = 86400000;

/** Elo's expected score for a side `gap` points ahead. */
export const expected = gap => 1 / (1 + 10 ** (-gap / 400));
/** A player's K after `games` games: `scale` / (games + 5)^0.4, never below K_FLOOR. */
export const kFactor = (games, scale) => Math.max(K_FLOOR, scale / (games + 5) ** 0.4);
export const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

function newScore() { return { n: 0, logLoss: 0, brier: 0 }; }
function score(into, e, won) {
  const p = Math.min(1 - 1e-9, Math.max(1e-9, e));
  into.n++;
  into.logLoss -= won ? Math.log(p) : Math.log(1 - p);
  into.brier += (won - p) ** 2;
}
/** A score's means: { n, logLoss, brier }. */
export const scoreOf = into => ({ n: into.n, logLoss: into.n ? into.logLoss / into.n : null, brier: into.n ? into.brier / into.n : null });

// A gamer tag is the player's own choice, and now and then an insult or an obscenity (one rated on vlr.gg reads "bitch,
// you'd better be ready" in Chinese). Such a player is rated like any other but plays for nobody, so the game never shows
// his tag. A word no innocent tag holds matches anywhere ("xXfuckXx"); one that hides in innocent words only whole, with
// digits and punctuation as its edges ("Scunthorpe", "peacock" and the Turkish given name Nazim are no match). Words that
// are also names are left out ("porn" ends many Thai names; "suka" is a Japanese one).
const OFFENSIVE_ANYWHERE = /fuck|n[i1]gg[ae]r|faggot|pidor|orospu|siktir|caralho|buceta|putain|scheisse|cocksucker|motherf/i;
const OFFENSIVE_WHOLE = /(^|[^a-z])(shit\w*|cunt\w*|bitch\w*|whores?|sluts?|fag|retard\w*|rape|rapist|nazis?|hitler\w*|kkk|pussy|dick(head)?|cock|penis|vagina|puta|puto|merde|cazzo|blyat)(?![a-z])/i;
const OFFENSIVE_CHINESE = /婊子|傻逼|傻b|操你|草你|肏|他妈|你妈|妈的|尼玛|草泥马|鸡巴|屌|贱人|去死/i;
/** Whether a gamer tag is an insult or an obscenity the game should not show. */
export const isOffensiveName = name => {
  const text = String(name ?? '').normalize('NFKD');
  return OFFENSIVE_ANYWHERE.test(text) || OFFENSIVE_WHOLE.test(text) || OFFENSIVE_CHINESE.test(text);
};

/** The key the most games give, of a Map(key → count); ties to the first in key order. */
export const mostOf = counts => [...(counts ?? new Map()).entries()].sort((x, y) => y[1] - x[1] || String(x[0]).localeCompare(String(y[0])))[0]?.[0] ?? null;

/** An entry's share of his side's game: 1, or the part of a tournament's games he played where the games' own line-ups are not known. */
const shareOf = entry => entry.share ?? 1;
/** The shares of a side's entries together: five for five who played. */
const sharesOf = side => side.reduce((sum, entry) => sum + shareOf(entry), 0);

/** A player's home circuit: the one whose events he has played most games in, or null (international events only). */
export const homeOf = player => mostOf(player?.circuits);

/**
 * Elo over `series` in date order: [{ date, circuit, games: [{ sides: [[entry…], [entry…]], winner: 1 or 2 }] }], each
 * entry `{ key, name, flag?, team?, share? }`: one with a `share` played only that part of the side's games, counts for it in
 * the side's mean, and moves and counts his games by it (League of Legends' earlier seasons). `scale`: the K scale. `starts`: a circuit's starting Elo for a newcomer who calls it
 * home (`homes`: key → circuit, homesOf), or whose first game is in its event when he has no home there (`start` for any
 * other). `holdout`: the date from which each game's prediction is scored
 * before it is played (log loss, Brier score, calibration by tenths). `onGame(one, game, expected, sides)` is told of each
 * game before it moves anyone.
 * → { players: Map(key → player), games, scored }
 */
export function runElo(series, { scale, starts = {}, homes = null, start = START, holdout = null, onGame = null } = {}) {
  const players = new Map();
  const scored = { all: newScore(), bins: Array.from({ length: 10 }, () => ({ n: 0, expected: 0, won: 0 })) };
  let games = 0;
  const playerOf = (entry, one) => {
    let player = players.get(entry.key);
    if (!player) {
      player = { key: entry.key, name: entry.name, elo: starts[homes?.get(entry.key) ?? one.circuit] ?? start, games: 0, wins: 0, first: one.date,
        last: one.date, flags: new Map(), names: new Map(), circuits: new Map(), team: null };
      players.set(entry.key, player);
    }
    return player;
  };
  for (const one of series) {
    for (const game of one.games) {
      const sides = game.sides.map(side => side.map(entry => playerOf(entry, one)));
      game.sides.forEach((side, s) => side.forEach((entry, i) => {
        const player = sides[s][i];
        if (entry.flag) player.flags.set(entry.flag, (player.flags.get(entry.flag) ?? 0) + 1);
        if (entry.name) player.names.set(entry.name, (player.names.get(entry.name) ?? 0) + 1);
        player.name = entry.name || player.name;
        if (entry.team) player.team = entry.team;
        player.last = one.date;
        if (one.circuit) player.circuits.set(one.circuit, (player.circuits.get(one.circuit) ?? 0) + shareOf(entry));
      }));
      const [a, b] = sides.map((side, s) => side.reduce((sum, player, i) => sum + shareOf(game.sides[s][i]) * player.elo, 0) / sharesOf(game.sides[s]));
      const e = expected(a - b);
      const won = game.winner === 1 ? 1 : 0;
      if (onGame) onGame(one, game, e, sides);
      if (holdout && one.date >= holdout) {
        score(scored.all, e, won);
        const bin = scored.bins[Math.min(9, Math.floor(e * 10))];
        bin.n++; bin.expected += e; bin.won += won;
      }
      sides.forEach((side, s) => {
        const delta = s === 0 ? won - e : e - won;
        side.forEach((player, i) => {
          const share = shareOf(game.sides[s][i]);
          player.elo += share * kFactor(player.games, scale) * delta;
          player.games += share;
          if ((s === 0) === (won === 1)) player.wins += share;
        });
      });
      games++;
    }
  }
  return { players, games, scored };
}

/**
 * Each player's home circuit over the games before `until` (all of them when null): the circuit whose events he has played
 * most games in (homeOf), for those who have played in any. `byCountry`: a player who has played in none (the world
 * stage, invitationals) calls home the circuit most of his country's players call home, his country the flag his games
 * give most; one with no flag, or of a country no one else's home gives, has none. → Map(key → circuit)
 */
export function homesOf(series, { until = null, byCountry = false } = {}) {
  const counts = new Map();
  const flags = new Map();
  for (const one of series) {
    if (until && one.date >= until) break;
    for (const game of one.games) for (const side of game.sides) for (const entry of side) {
      if (byCountry && entry.flag) {
        if (!flags.has(entry.key)) flags.set(entry.key, new Map());
        flags.get(entry.key).set(entry.flag, (flags.get(entry.key).get(entry.flag) ?? 0) + 1);
      }
      if (!one.circuit) continue;
      if (!counts.has(entry.key)) counts.set(entry.key, new Map());
      const played = counts.get(entry.key);
      played.set(one.circuit, (played.get(one.circuit) ?? 0) + shareOf(entry));
    }
  }
  const homes = new Map([...counts].map(([key, played]) => [key, mostOf(played)]));
  if (!byCountry) return homes;
  const byFlag = new Map();
  for (const [key, home] of homes) {
    const flag = mostOf(flags.get(key));
    if (!flag) continue;
    if (!byFlag.has(flag)) byFlag.set(flag, new Map());
    byFlag.get(flag).set(home, (byFlag.get(flag).get(home) ?? 0) + 1);
  }
  for (const [key, played] of flags) {
    const home = homes.has(key) ? null : mostOf(byFlag.get(mostOf(played)));
    if (home) homes.set(key, home);
  }
  return homes;
}

/**
 * Each circuit's level, the start of a newcomer who calls it home (homesOf): fitted at once with every player's own strength over the games
 * before `until` (all of them when null). A player plays at his home circuit's level (homeOf: where he has played most)
 * plus his own offset, which a normal prior of spread `tau` keeps near 0 where his games say little; a side plays at its
 * players' mean, and wins with Elo's odds of the two sides' difference. Gradient ascent on that likelihood (Adam, steps of
 * about `rate` points, `iterations` of them), the levels centred so that the players' mean is `start`. `levelSpread`, when
 * finite, is a normal prior on the levels themselves: a circuit whose links say little stays near the players' mean
 * instead of going as far as its few games allow (Valorant's 100, League of Legends' 500). `homes` (homesOf, byCountry)
 * gives the home of a player who has played in no circuit's events, who otherwise plays at no circuit's level.
 *
 * Circuits meet at the international events and wherever a player of one plays in another's (a call-up, a move, a promoted
 * team), too rarely for Elo alone to bring a whole circuit to its level: Elo leaves each circuit's players around its own
 * newcomers' start. Fitted at once, every such link counts, each in proportion to what it says: a circuit is not lifted by
 * beating weaker circuits more than Elo expected when the circuits above it beat it as often as they should.
 */
export function circuitLevels(series, { until = null, tau = 150, levelSpread = Infinity, homes = null, iterations = 600, rate = 4, start = START } = {}) {
  const index = new Map();
  const counts = [];
  const games = [];
  for (const one of series) {
    if (until && one.date >= until) break;
    for (const game of one.games) {
      const sides = game.sides.map(side => Int32Array.from(side, entry => {
        let i = index.get(entry.key);
        if (i === undefined) {
          i = index.size;
          index.set(entry.key, i);
          counts.push(new Map());
        }
        if (one.circuit) counts[i].set(one.circuit, (counts[i].get(one.circuit) ?? 0) + shareOf(entry));
        return i;
      }));
      const shares = game.sides.map(side => Float64Array.from(side, shareOf));
      games.push({ sides, shares, all: game.sides.map(sharesOf), won: game.winner === 1 ? 1 : 0 });
    }
  }
  const circuits = [];
  const keys = [...index.keys()];
  const home = Int32Array.from(counts, (played, i) => {
    const circuit = mostOf(played) ?? homes?.get(keys[i]) ?? null;
    if (!circuit) return -1;
    if (!circuits.includes(circuit)) circuits.push(circuit);
    return circuits.indexOf(circuit);
  });
  // theta: the circuits' levels, then the players' offsets.
  const C = circuits.length, P = index.size, slope = Math.LN10 / 400;
  const theta = new Float64Array(C + P), grad = new Float64Array(C + P);
  const first = new Float64Array(C + P), second = new Float64Array(C + P);
  const strength = i => (home[i] >= 0 ? theta[home[i]] : 0) + theta[C + i];
  for (let step = 1; step <= iterations; step++) {
    grad.fill(0);
    for (const { sides, shares, all, won } of games) {
      let a = 0, b = 0;
      for (let n = 0; n < sides[0].length; n++) a += shares[0][n] * strength(sides[0][n]);
      for (let n = 0; n < sides[1].length; n++) b += shares[1][n] * strength(sides[1][n]);
      const g = (won - expected(a / all[0] - b / all[1])) * slope;
      sides.forEach((side, s) => {
        const share = (s === 0 ? g : -g) / all[s];
        for (let n = 0; n < side.length; n++) {
          const i = side[n];
          grad[C + i] += share * shares[s][n];
          if (home[i] >= 0) grad[home[i]] += share * shares[s][n];
        }
      });
    }
    for (let i = 0; i < P; i++) grad[C + i] -= theta[C + i] / (tau * tau);
    if (Number.isFinite(levelSpread)) for (let c = 0; c < C; c++) grad[c] -= theta[c] / (levelSpread * levelSpread);
    for (let j = 0; j < C + P; j++) {
      first[j] = 0.9 * first[j] + 0.1 * grad[j];
      second[j] = 0.999 * second[j] + 0.001 * grad[j] * grad[j];
      theta[j] += rate * (first[j] / (1 - 0.9 ** step)) / (Math.sqrt(second[j] / (1 - 0.999 ** step)) + 1e-12);
    }
    let sum = 0, homed = 0;
    for (let i = 0; i < P; i++) if (home[i] >= 0) { sum += theta[home[i]]; homed++; }
    if (homed) for (let c = 0; c < C; c++) theta[c] -= sum / homed;
  }
  return Object.fromEntries(circuits.map((circuit, c) => [circuit, Math.round(start + theta[c])]).sort((x, y) => x[0].localeCompare(y[0])));
}

/**
 * The games from `from` (to `to`, when given) as runElo(series, options) scores them, each before it is played, with its two
 * sides' circuits: a side's circuit is the home of `least` of its players or more, each player's home counted over the
 * games before this one (null for a side with no such circuit). `seasoned`: each of the ten had `minGames` behind him (but one
 * whose share of the games is under a half).
 * `keys`: each row also keeps its sides' players' keys.
 * → [{ id, date, e, won, circuits: [first side's, second's], seasoned, keys? }]
 */
export function scoredGames(series, options, { from, to = null, least = 3, minGames = 20, keys = false } = {}) {
  const counts = new Map();
  const rows = [];
  const sideCircuit = (side, entries) => {
    const tally = new Map();
    side.forEach((player, i) => {
      const home = mostOf(counts.get(player.key));
      if (home) tally.set(home, (tally.get(home) ?? 0) + shareOf(entries[i]));
    });
    const [best] = [...tally.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
    return best && best[1] >= least ? best[0] : null;
  };
  runElo(series, { ...options, holdout: null, onGame: (one, game, e, sides) => {
    if (one.date >= from && (!to || one.date < to)) {
      rows.push({ id: one.id, date: one.date, e, won: game.winner === 1 ? 1 : 0, circuits: sides.map((side, s) => sideCircuit(side, game.sides[s])),
        seasoned: sides.every((side, s) => side.every((player, i) => player.games >= minGames || shareOf(game.sides[s][i]) < 0.5)),
        ...(keys ? { keys: sides.map(side => side.map(player => player.key)) } : {}) });
    }
    if (!one.circuit) return;
    for (const side of game.sides) for (const entry of side) {
      if (!counts.has(entry.key)) counts.set(entry.key, new Map());
      const played = counts.get(entry.key);
      played.set(one.circuit, (played.get(one.circuit) ?? 0) + shareOf(entry));
    }
  } });
  return rows;
}

/** The log loss and Brier score of scored games ([{ e, won }]): { n, logLoss, brier }. */
export function scoreRows(rows) {
  const into = newScore();
  for (const row of rows) score(into, row.e, row.won);
  return scoreOf(into);
}

/**
 * A group's offset in its games against the others: the Elo added to its side's edge that makes its expected wins its wins
 * (maximum likelihood), with a standard error clustered by series (a series' games are not independent). `rows`:
 * [{ gap: the group's side's Elo edge as scored, won: 1 when its side won, cluster }]. → { n, series, won, expected, elo, se }
 */
export function groupOffset(rows) {
  const slope = Math.LN10 / 400;
  let elo = 0;
  for (let step = 0; step < 50; step++) {
    let slack = 0, curve = 0;
    for (const row of rows) {
      const p = expected(row.gap + elo);
      slack += row.won - p;
      curve += p * (1 - p) * slope;
    }
    const move = curve ? slack / curve : 0;
    elo += move;
    if (Math.abs(move) < 1e-6) break;
  }
  let info = 0, won = 0, expectedWins = 0;
  const byCluster = new Map();
  for (const row of rows) {
    const p = expected(row.gap + elo);
    info += p * (1 - p) * slope * slope;
    byCluster.set(row.cluster, (byCluster.get(row.cluster) ?? 0) + (row.won - p) * slope);
    won += row.won;
    expectedWins += expected(row.gap);
  }
  const clustered = Math.sqrt([...byCluster.values()].reduce((sum, x) => sum + x * x, 0)) / info;
  return { n: rows.length, series: byCluster.size, won, expected: Math.round(expectedWins * 10) / 10, elo: Math.round(elo),
    se: Math.round(Math.max(clustered, 1 / Math.sqrt(info))) };
}

/**
 * Each group's offset (groupOffset) in the games between groups among `rows` (scoredGames), a side's group `groupOf(its
 * circuit)`; only games whose two sides both have a group, and different ones. → { group: offset }, most negative first
 */
export function groupOffsets(rows, groupOf = circuit => circuit) {
  const groups = new Map();
  for (const row of rows) {
    const [a, b] = row.circuits.map(circuit => (circuit ? groupOf(circuit) : null));
    if (!a || !b || a === b) continue;
    const gap = -400 * Math.log10(1 / Math.min(1 - 1e-9, Math.max(1e-9, row.e)) - 1);
    for (const [group, edge, won] of [[a, gap, row.won], [b, -gap, 1 - row.won]]) {
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({ gap: edge, won, cluster: row.id });
    }
  }
  return Object.fromEntries([...groups.entries()].map(([group, games]) => [group, groupOffset(games)]).sort((x, y) => x[1].elo - y[1].elo));
}

/**
 * The rated players of a run, strongest first: those with `minGames` behind them whose last game is within `activeDays`
 * of `asOf`. `nationOf(player)` gives each one's nation (or null) and `sideOf(player)` the national team he played for.
 */
export function ratedPlayers(players, asOf, { minGames, activeDays, nationOf, sideOf = () => null, flagOf = player => mostOf(player.flags) }) {
  return [...players.values()]
    .filter(player => player.games >= minGames && daysBetween(player.last, asOf) <= activeDays)
    .map(player => {
      const name = mostOf(player.names) ?? player.name;
      // A player whose tag is an insult plays for nobody (isOffensiveName).
      return { key: player.key, name, flag: flagOf(player), nation: isOffensiveName(name) ? null : nationOf(player),
        side: sideOf(player), elo: Math.round(player.elo * 10) / 10, games: Math.round(player.games), wins: Math.round(player.wins), last: player.last,
        team: player.team, circuit: homeOf(player) };
    })
    .sort((a, b) => b.elo - a.elo || a.name.localeCompare(b.name));
}

/** The calibration of a run's held-out games: [expected, won, n] a tenth. */
export const calibrationOf = scored => scored.bins.filter(bin => bin.n).map(bin => [Math.round(bin.expected / bin.n * 1000) / 1000,
  Math.round(bin.won / bin.n * 1000) / 1000, bin.n]);

/**
 * A squad whose players each have a name of his own: two of a nation's who go by one name get " II" on the second.
 */
function distinctNames(squad) {
  const seen = new Set();
  return squad.map(player => {
    let name = player.name;
    if (seen.has(name)) name = `${name} II`;
    seen.add(name);
    return name === player.name ? player : { ...player, name };
  });
}

/**
 * The nations that field a team, strongest first: each `{ id, name, str, squad, players }`, `squad` its `teamSize` best by
 * Elo, `players` how many it has in all, `str` its `lineup` best players' mean rating. A nation with fewer than `lineup`
 * rated players fields none, and one off the map (not in NATIONS) none either.
 */
export function nationsOf(players, { teamSize, lineup, sport = null }) {
  const pools = new Map();
  for (const player of players) {
    if (player.nation == null || !Object.hasOwn(NATIONS, player.nation)) continue;
    if (!pools.has(player.nation)) pools.set(player.nation, []);
    pools.get(player.nation).push(player);
  }
  const byElo = (a, b) => b.elo - a.elo || a.name.localeCompare(b.name);
  return [...pools.entries()].filter(([, pool]) => pool.length >= lineup).map(([id, pool]) => {
    const squad = distinctNames(pool.slice().sort(byElo).slice(0, teamSize));
    const str = Math.round(squad.slice(0, lineup).reduce((sum, player) => sum + player.rating, 0) / lineup * 10) / 10;
    return { id, name: nationIdentity(id, sport).name, str, squad, players: pool.length };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
}

/**
 * Rated players who play for nobody, by reason: no nation (`noNation`: no country's flag at all, or one off the map) or a
 * nation of fewer than `lineup`.
 */
export function leftOut(players, { lineup }) {
  const noNation = players.filter(player => player.nation == null || !Object.hasOwn(NATIONS, player.nation));
  const counts = new Map();
  for (const player of players) if (player.nation != null) counts.set(player.nation, (counts.get(player.nation) || 0) + 1);
  const short = players.filter(player => player.nation != null && Object.hasOwn(NATIONS, player.nation) && counts.get(player.nation) < lineup);
  return { noNation, short };
}

/**
 * The favourite's odds a game, in ODDS_BINS bins of 1% from even (0.50–0.51 the first, 0.99–1 the last): how real games
 * are kept, so a match model can be held against them at their own odds.
 */
export const ODDS_BINS = 50;
export const oddsBin = e => Math.min(ODDS_BINS - 1, Math.floor((Math.max(e, 1 - e) - 0.5) * 2 * ODDS_BINS));
/** A bin's middle: 0.505 for the first. */
export const binOdds = bin => 0.5 + (bin + 0.5) / (2 * ODDS_BINS);

/**
 * The home crowd's edge: each game where exactly one side is of the host nation (`least` of its players, `nationOf` a
 * player's key's), that side's surprise (won − expected); their mean, in Elo points on the slope at an even game (1600 /
 * ln 10 a unit), with its standard error. `games`: [{ host, keys: [[…], […]], surprise }]. → { games, surprise, elo, se }
 * (null with no such game).
 */
export function homeEdge(games, nationOf, least) {
  const nationOfSide = keys => {
    const counts = new Map();
    for (const key of keys) {
      const nation = nationOf(key);
      if (nation) counts.set(nation, (counts.get(nation) ?? 0) + 1);
    }
    return [...counts.entries()].find(([, n]) => n >= least)?.[0] ?? null;
  };
  const surprises = [];
  for (const { keys, host, surprise } of games) {
    const [a, b] = keys.map(nationOfSide);
    if ((a === host) === (b === host)) continue;
    surprises.push(a === host ? surprise : -surprise);
  }
  if (!surprises.length) return null;
  const mean = surprises.reduce((sum, x) => sum + x, 0) / surprises.length;
  const sd = Math.sqrt(surprises.reduce((sum, x) => sum + (x - mean) ** 2, 0) / Math.max(1, surprises.length - 1));
  const toElo = 1600 / Math.LN10;
  return { games: surprises.length, surprise: Math.round(mean * 10000) / 10000, elo: Math.round(mean * toElo * 10) / 10,
    se: Math.round(sd / Math.sqrt(surprises.length) * toElo * 10) / 10 };
}

/**
 * The favourite's record in each kind of series (`bestOf` 3 or 5) between seasoned sides, by its game odds before the
 * first game (ODDS_BINS bins): `[bin, series, favourite won, favourite swept, underdog swept]` a bin that has any, for
 * fitting and checking match-day form. `rows`: [{ bestOf, odds, won: [first side's, second's] }].
 */
export function favouriteBins(rows) {
  const out = {};
  for (const { bestOf, odds, won } of rows) {
    const toWin = (bestOf + 1) / 2;
    if (Math.max(...won) !== toWin) continue;
    const fav = odds >= 0.5 ? 0 : 1;
    const key = `bo${bestOf}`;
    out[key] ??= new Map();
    const bin = oddsBin(odds);
    const row = out[key].get(bin) ?? [bin, 0, 0, 0, 0];
    row[1]++;
    if (won[fav] === toWin) row[2]++;
    if (won[fav] === toWin && won[1 - fav] === 0) row[3]++;
    if (won[1 - fav] === toWin && won[fav] === 0) row[4]++;
    out[key].set(bin, row);
  }
  return Object.fromEntries(Object.entries(out).map(([key, bins]) => [key, [...bins.values()].sort((a, b) => a[0] - b[0])]));
}

/** A snapshot file's text: one line a header field and one a player, so a new sync's diff reads player by player. */
export const snapshotText = (head, rows) => `{\n${Object.entries(head).map(([key, value]) => ` ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n')},
 "players": [\n${rows.map(row => `  ${JSON.stringify(row)}`).join(',\n')}\n ]\n}\n`;
