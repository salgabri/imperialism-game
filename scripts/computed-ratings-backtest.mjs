// Back-test of the computed-ratings strategy (docs/design/computed-ratings.md, "Evidence"): how much of a game's
// ratings each kind of real evidence recovers on its own, and whether shrinkage and blend weights taken from the data
// alone (no game rating used to set them) do as well as the repo's rules that were tuned against the games.
//
// Reads committed data only, no network:
// - hockey: scripts/data/nhl-seasons/calibration.json (NHLPA 93, NHL 94, NHL 95, NHL 07 and NHL 22 with each rated
//   player's three seasons of lines from the Hockey Databank or MoneyPuck);
// - NFL: scripts/data/pfa-seasons/2000.json (Pro Football Archives' 2000 season) against
//   scripts/data/madden-seasons/2001.json (Madden NFL 2002's launch ratings);
// - MLB: scripts/data/mlb-war-seasons/2017.json (WAR and playing time of 2015-2017) against
//   scripts/data/mlb-the-show-18.json (MLB The Show 18's Live cards at its last roster update, after the 2018 season:
//   one season later than the data, the same lag for every measure);
// - the built-in clubs of eight sports (src/data/clubs.*.js) for each engine's rating scale.
//
// Usage: node scripts/computed-ratings-backtest.mjs [--json]
import { readFileSync } from 'node:fs';
import { RULE, groupOf, scoreOf, windowOf } from './lib/nhl-computed.mjs';
import {
  NOISE, mean, priorFromNoise, priorFromReliability, replacementRate, spearman, stabilityWeight, variance, zscores,
} from './lib/computed-ratings.mjs';
import { selectLineup } from '../src/data/teams.js';

const data = file => JSON.parse(readFileSync(new URL(`./data/${file}`, import.meta.url), 'utf8'));
const r3 = v => Math.round(v * 1000) / 1000;
const rho = (rows, key, target) => r3(spearman(rows.map(r => r[key]), rows.map(r => r[target])));
const quantile = (xs, p) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.round(p * (s.length - 1))]; };
// Combining accents (U+0300 to U+036F), built from their codes so no raw mark sits in the source.
const ACCENTS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');
const fold = name => name.normalize('NFD').replace(ACCENTS, '').toLowerCase().replace(/[^a-z ]/g, '')
  .replace(/\s+(jr|sr|ii|iii|iv)$/, '').trim();

/**
 * The variant the design doc rejected, kept so its figures reproduce: empirical Bayes with a covariate, each player's rate
 * shrunk toward what his selection predicts. The prediction is the least-squares line of rate on `usage` among players
 * with at least `least` exposure (weighted by exposure); the prior's strength is the noise left over the talent the line
 * does not explain. `noiseOf(rate, exposure)` is one player's sampling variance. → `{ k, values }`, values in order.
 */
function shrinkTowardSelection(players, least, noiseOf) {
  const big = players.filter(p => p.n >= least);
  const w = big.map(p => p.n), sw = w.reduce((s, v) => s + v, 0);
  const mu = big.reduce((s, p, i) => s + w[i] * p.usage, 0) / sw;
  const my = big.reduce((s, p, i) => s + w[i] * p.x / p.n, 0) / sw;
  let sxy = 0, sxx = 0;
  big.forEach((p, i) => { sxy += w[i] * (p.usage - mu) * (p.x / p.n - my); sxx += w[i] * (p.usage - mu) ** 2; });
  const slope = sxx ? sxy / sxx : 0;
  const line = u => my + slope * (u - mu);
  const residual = big.map(p => p.x / p.n - line(p.usage));
  const noise = mean(big.map(p => noiseOf(p.x / p.n, p.n)));
  const unit = mean(big.map(p => noiseOf(p.x / p.n, p.n) * p.n));
  const k = unit / Math.max(1e-9, variance(residual) - noise);
  return { k, values: players.map(p => (p.x + k * line(p.usage)) / (p.n + k)) };
}

// ---------------------------------------------------------------- hockey

/** Weighted exposure and events over the window (RULE.weights by season), seasons not played adding nothing. */
function pooled(lines, year, exposureOf, eventsOf) {
  let n = 0, x = 0;
  windowOf(year).forEach((season, k) => {
    const line = lines.find(l => l[0] === season);
    if (line) { n += RULE.weights[k] * exposureOf(line, season); x += RULE.weights[k] * eventsOf(line, season); }
  });
  return { n, x };
}

function hockey() {
  const editions = [];
  for (const edition of data('nhl-seasons/calibration.json').editions) {
    const L = edition.leagues;
    const [y0, y1] = windowOf(edition.year);
    const rows = edition.players.filter(p => p[4]?.length)
      .map(([name, team, pos, overall, lines]) => ({ name, team, pos, overall, lines, group: groupOf(pos) }));
    const result = { edition: edition.id, players: rows.length };
    for (const group of ['F', 'D', 'G']) {
      const m = rows.filter(p => p.group === group);
      const goalie = group === 'G';
      for (const p of m) {
        // Selection: the share of his club's games he played, over the window (a season not played counts 0).
        p.usage = pooled(p.lines, edition.year, () => 1, (l, s) => l[1] / L[s].maxGames).x / 4;
        // Ice time a team game, where the source keeps it (MoneyPuck, NHL 22).
        if (!goalie && edition.form.skaters === 'minutes') p.ice = pooled(p.lines, edition.year, () => 1, (l, s) => (l[3] ?? 0) / 60 / L[s].maxGames).x / 4;
        // Production: points over games (skaters), saves above the league's rate over shots (goalies).
        Object.assign(p, goalie
          ? pooled(p.lines, edition.year, l => l[4] ?? 0, (l, s) => (l[4] ?? 0) - l[3] - (l[4] ?? 0) * L[s].savePct)
          : pooled(p.lines, edition.year, l => l[1], l => l[2]));
        p.rule = scoreOf({ pos: p.pos, lines: p.lines }, edition.year, L, edition.form);
      }
      // A goalie's record is saves above the league's rate over shots: its noise is the save share's, p(1 − p) at p ≈ .91.
      const { k } = goalie
        ? priorFromNoise(m.filter(p => p.n > 0), { least: 500, unitNoise: () => 0.0819 })
        : priorFromNoise(m, { least: 40, unitNoise: NOISE.poisson });
      const replacement = replacementRate(m);
      for (const p of m) p.production = (p.x + k * replacement) / (p.n + k);
      const toward = goalie
        ? shrinkTowardSelection(m.filter(p => p.n >= 0), 500, (rate, n) => 0.0819 / n)
        : shrinkTowardSelection(m, 40, (rate, n) => rate / n);
      m.forEach((p, i) => { p.towardSelection = toward.values[i]; });
      // Each signal's reliability: its rank correlation between the window's two latest seasons, players in both.
      const pairs = m.map(p => [p.lines.find(l => l[0] === y0), p.lines.find(l => l[0] === y1)]).filter(([a, b]) => a && b);
      const relUsage = spearman(pairs.map(([a]) => a[1] / L[y0].maxGames), pairs.map(([, b]) => b[1] / L[y1].maxGames));
      const both = goalie ? pairs.filter(([a, b]) => (a[4] ?? 0) >= 300 && (b[4] ?? 0) >= 300) : pairs.filter(([a, b]) => a[1] >= 20 && b[1] >= 20);
      const rateOf = goalie ? l => (l[4] - l[3]) / l[4] : l => l[2] / l[1];
      const relProduction = spearman(both.map(([a]) => rateOf(a)), both.map(([, b]) => rateOf(b)));
      const wU = stabilityWeight(relUsage), wP = stabilityWeight(relProduction);
      const zU = zscores(m.map(p => p.usage)), zP = zscores(m.map(p => p.production));
      m.forEach((p, i) => { p.blend = wU * zU[i] + wP * zP[i]; });
      result[group] = {
        players: m.length, prior: r3(k), replacement: r3(replacement), relUsage: r3(relUsage), relProduction: r3(relProduction),
        productionWeight: r3(wP / (wU + wP)),
        usage: rho(m, 'usage', 'overall'), ...(m[0]?.ice != null ? { iceTime: rho(m, 'ice', 'overall') } : {}),
        production: rho(m, 'production', 'overall'), blend: rho(m, 'blend', 'overall'),
        towardSelection: rho(m, 'towardSelection', 'overall'), rule: rho(m, 'rule', 'overall'),
      };
    }
    editions.push(result);
  }
  const means = {};
  for (const group of ['F', 'D', 'G']) {
    means[group] = Object.fromEntries(['usage', 'production', 'blend', 'towardSelection', 'rule']
      .map(key => [key, r3(mean(editions.map(e => e[group][key])))]));
  }
  return { editions, means };
}

// ---------------------------------------------------------------- NFL

function nfl() {
  const pfa = data('pfa-seasons/2000.json');
  const madden = data('madden-seasons/2001.json');
  const GROUP = { QB: 'QB', HB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE', LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL', LE: 'DL', RE: 'DL',
    DT: 'DL', LOLB: 'LB', MLB: 'LB', ROLB: 'LB', CB: 'CB', FS: 'S', SS: 'S', K: 'K' };
  const count = new Map();
  for (const [name] of madden.players) count.set(fold(name), (count.get(fold(name)) || 0) + 1);
  const rated = new Map();
  for (const [name, , pos, overall] of madden.players) if (count.get(fold(name)) === 1 && GROUP[pos]) rated.set(fold(name), { overall, group: GROUP[pos] });
  const rows = [];
  for (const [name, , , position, , facts] of pfa.players) {
    const match = rated.get(fold(name));
    if (match?.group === position) rows.push({ name, group: position, overall: match.overall, starts: facts.gs + facts.gp / 100, value: facts.value });
  }
  const positions = {};
  for (const group of ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K']) {
    const m = rows.filter(r => r.group === group);
    positions[group] = { players: m.length, starts: rho(m, 'starts', 'overall'), rule: rho(m, 'value', 'overall') };
  }
  const list = Object.values(positions);
  return { players: rows.length, positions, means: { starts: r3(mean(list.map(p => p.starts))), rule: r3(mean(list.map(p => p.rule))) } };
}

// ---------------------------------------------------------------- MLB

function mlb() {
  const war = data('mlb-war-seasons/2017.json');
  const show = data('mlb-the-show-18.json');
  const count = new Map();
  for (const card of show.players) count.set(fold(card[1]), (count.get(fold(card[1])) || 0) + 1);
  const card = new Map(show.players.filter(c => count.get(fold(c[1])) === 1).map(c => [fold(c[1]), c]));
  const rows = [];
  for (const [, name, , , role, , score, wars, time] of war.players) {
    const c = card.get(fold(name));
    if (!c || (c[3] === 'SP' ? 'SP' : c[3] === 'RP' || c[3] === 'CP' ? 'RP' : 'H') !== role) continue;
    // The strategy's window (the season itself 3, the one before 2, then 1), seasons not played adding nothing.
    const weights = [3, 2, 1];
    let n = 0, x = 0, usage = 0;
    weights.forEach((w, i) => { if (time[i] != null) { n += w * time[i]; x += w * (wars[i] ?? 0); usage += w * time[i]; } });
    rows.push({ name, role, overall: c[5], n, x, usage: usage / 6, rule: score, now: [time[0], wars[0]], before: [time[1], wars[1]] });
  }
  const roles = {};
  for (const role of ['H', 'SP', 'RP']) {
    const m = rows.filter(r => r.role === role);
    // WAR has no Poisson or binomial noise: the prior comes from its year-to-year reliability at the typical exposure,
    // k = n̄ (1 − r) / r, over players with a regular's work in both seasons.
    const least = { H: 200, SP: 60, RP: 25 }[role];
    const both = m.filter(r => r.now[0] >= least && r.before[0] >= least);
    const relRate = spearman(both.map(r => r.now[1] / r.now[0]), both.map(r => r.before[1] / r.before[0]));
    const typical = mean(both.flatMap(r => [r.now[0], r.before[0]]));
    const k = priorFromReliability(relRate, typical);
    const replacement = replacementRate(m);
    for (const r of m) r.production = (r.x + k * replacement) / (r.n + k);
    const used = m.filter(r => r.now[0] != null && r.before[0] != null);
    const relUsage = spearman(used.map(r => r.now[0]), used.map(r => r.before[0]));
    const wU = stabilityWeight(relUsage), wP = stabilityWeight(relRate);
    const zU = zscores(m.map(r => r.usage)), zP = zscores(m.map(r => r.production));
    m.forEach((r, i) => { r.blend = wU * zU[i] + wP * zP[i]; });
    roles[role] = {
      players: m.length, prior: Math.round(k), relUsage: r3(relUsage), relProduction: r3(relRate), productionWeight: r3(wP / (wU + wP)),
      usage: rho(m, 'usage', 'overall'), production: rho(m, 'production', 'overall'), blend: rho(m, 'blend', 'overall'), rule: rho(m, 'rule', 'overall'),
    };
  }
  return { players: rows.length, roles };
}

// ---------------------------------------------------------------- the engines' scales

async function scales() {
  const SPORTS = ['football', 'womens-football', 'basketball', 'american-football', 'college-football', 'baseball', 'hockey', 'rugby-league'];
  const out = {};
  for (const sport of SPORTS) {
    const { CLUBS } = await import(`../src/data/clubs.${sport}.js`);
    const starters = [], strengths = [], within = [];
    for (const club of CLUBS) {
      if (!club.squad?.length) continue;
      const squad = club.squad.map(([name, listed, rating]) => {
        const [pos, ...others] = String(listed).split('/');
        return { name, pos, rating, ...(others.length ? { positions: [pos, ...others] } : {}) };
      });
      const lineup = selectLineup({ sport, squad });
      const ratings = lineup.slots.map(slot => slot.effectiveRating);
      starters.push(...ratings);
      strengths.push(lineup.rating);
      within.push(Math.sqrt(variance(ratings)));
    }
    out[sport] = {
      clubs: strengths.length, starters: [0.05, 0.25, 0.5, 0.75, 0.95].map(p => quantile(starters, p)),
      clubSD: r3(Math.sqrt(variance(strengths))), withinSD: r3(mean(within)),
    };
  }
  return out;
}

const report = { hockey: hockey(), nfl: nfl(), mlb: mlb(), scales: await scales() };
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const { hockey: h, nfl: n, mlb: b, scales: s } = report;
  console.log('Spearman with the game\'s overall, within position group. usage = selection only; production = rate shrunk to replacement');
  console.log('with a prior measured from the data; blend = both, weighted by their own year-to-year stability; rule = the repo\'s tuned rule.\n');
  console.log('HOCKEY (5 EA editions)        usage  produc  blend   rule   | toward selection | prior   relU   relP   prodWeight');
  const prior = v => String(v >= 100 ? Math.round(v) : v.toFixed(1)).padStart(6);
  for (const e of h.editions) {
    for (const g of ['F', 'D', 'G']) {
      const r = e[g];
      console.log(`  ${e.edition} ${g} (${String(r.players).padStart(3)})`.padEnd(30), [r.usage, r.production, r.blend, r.rule].map(v => v.toFixed(3)).join('  '),
        '  |', r.towardSelection.toFixed(3).padStart(16), ' |', prior(r.prior), ' ', r.relUsage.toFixed(3), ' ', r.relProduction.toFixed(3), ' ',
        r.productionWeight.toFixed(3), r.iceTime != null ? `  (ice time ${r.iceTime})` : '');
    }
  }
  for (const g of ['F', 'D', 'G']) {
    console.log(`  mean ${g}`.padEnd(30), ['usage', 'production', 'blend', 'rule'].map(k => h.means[g][k].toFixed(3)).join('  '), '  |',
      h.means[g].towardSelection.toFixed(3).padStart(16));
  }
  console.log('\nNFL 2000 against Madden NFL 2002 (launch)   starts  rule');
  for (const [g, r] of Object.entries(n.positions)) console.log(`  ${g} (${r.players})`.padEnd(43), r.starts.toFixed(3), ' ', r.rule.toFixed(3));
  console.log('  mean'.padEnd(43), n.means.starts.toFixed(3), ' ', n.means.rule.toFixed(3));
  console.log('\nMLB 2015-17 against MLB The Show 18     usage  produc  blend   rule   | prior  relU   relP   prodWeight');
  for (const [role, r] of Object.entries(b.roles)) {
    console.log(`  ${role} (${r.players})`.padEnd(39), [r.usage, r.production, r.blend, r.rule].map(v => v.toFixed(3)).join('  '), '  |',
      prior(r.prior), ' ', r.relUsage.toFixed(3), ' ', r.relProduction.toFixed(3), ' ', r.productionWeight.toFixed(3));
  }
  console.log('\nBUILT-IN SCALES (the lineup the game picks)   starters p5/p25/p50/p75/p95   club SD   within-lineup SD');
  for (const [sport, r] of Object.entries(s)) console.log(`  ${sport} (${r.clubs} clubs)`.padEnd(46), r.starters.join('/').padEnd(28), String(r.clubSD).padStart(7), String(r.withinSD).padStart(10));
}
