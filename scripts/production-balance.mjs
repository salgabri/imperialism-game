// Runs the actual App campaign lifecycle. Only presentation timing, rendering,
// local saves and transient popups are suppressed. Draws, RNG, outcomes, manager
// decisions, series and acquisitions all use the production handlers.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { CAPITALS } from '../src/data/capitals.js';
import { NATIONS, makeRng, teamEff } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { WorldGeometry } from '../src/engine/geo.js';

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/App.jsx', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
  external: ['react'], loader: { '.css': 'empty' },
  define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const App = module.exports.default;
const load = name => JSON.parse(readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8'));
let geometry;
const fittedGeometry = new Map();
function worldGeometry() {
  if (!geometry) {
    geometry = {
      geo: new WorldGeometry(load('world-110m.v1.json'), CAPITALS).fitTo(Object.keys(NATIONS)),
      displayGeo: new WorldGeometry(load('countries-50m.json'), CAPITALS),
    };
    const { s, tx, ty } = geometry.geo.fit;
    geometry.displayGeo.paths = geometry.displayGeo.buildPaths(s, tx, ty);
  }
  return geometry;
}
function cloneGeo(geo) { return Object.assign(Object.create(Object.getPrototypeOf(geo)), geo); }

class ProductionCampaign extends App {
  constructor(setup) {
    super({});
    const initial = worldGeometry();
    this.geo = cloneGeo(initial.geo);
    this.displayGeo = cloneGeo(initial.displayGeo);
    this.labelGeometry = [];
    this.state = { ...this.state, phase: 'setup', setup: { ...this.state.setup, ...setup } };
    this.ready = true;
  }
  setState(update, callback) {
    const previous = this.state;
    const next = typeof update === 'function' ? update(this.state, this.props) : update;
    if (next) this.state = { ...this.state, ...next };
    if (this.ready) this.componentDidUpdate(this.props, previous);
    callback?.call(this);
  }
  fitMap(ids) {
    const key = ids.slice().sort().join(',');
    let fitted = fittedGeometry.get(key);
    if (!fitted) {
      const geo = cloneGeo(worldGeometry().geo).fitTo(ids);
      const displayGeo = cloneGeo(worldGeometry().displayGeo);
      const { s, tx, ty } = geo.fit;
      displayGeo.paths = displayGeo.buildPaths(s, tx, ty);
      fitted = { geo, displayGeo };
      fittedGeometry.set(key, fitted);
    }
    this.geo = fitted.geo;
    this.displayGeo = fitted.displayGeo;
  }
  // These are presentation/effect owners, not campaign rule handlers.
  persist() {}
  after() { return null; }
  drawFrame() {}
  presentMatch() {}
  showPopup() {}
  showToast() {}
}

export function runProductionCampaign({ seed = 20261002, sport = 'football', layer = 'nations', scope = 'elite',
  clubScope = 'elite', pacing = 'blitz', uncertainty = 'balanced', finale = 'single', acquisitionPolicy = 'highest-rated',
  rosterPreset = 'authentic', managerPolicy = 'spectator', managedTeamId, managerRank, resolution = 'instant', express = false } = {}) {
  const role = managerPolicy === 'spectator' ? 'spectator' : 'manager';
  const setup = { sport, layer, scope, clubScope, pacing, uncertainty, finale, acquisitionPolicy, rosterPreset,
    role, managedTeamId: managedTeamId || '', seed: String(seed), resolution, express };
  const app = new ProductionCampaign(setup);
  if (role === 'manager' && !setup.managedTeamId) {
    const included = app.opening(setup, makeRng(seed)).included.slice().sort((a, b) => teamEff(b) - teamEff(a) || a.id.localeCompare(b.id));
    // Manage a middle-ranked side unless a test asks for a particular rank.
    const index = managerRank == null ? Math.floor(included.length / 2) : Math.max(0, Math.min(included.length - 1, managerRank - 1));
    setup.managedTeamId = included[index]?.id || '';
    app.state.setup = { ...app.state.setup, managedTeamId: setup.managedTeamId };
  }
  app.startCampaign();
  if (app.state.phase !== 'playing') throw new Error(app.state.saveStatus?.message || 'Production campaign did not launch.');
  const initialRank = app.state.aliveIds.slice().sort((a, b) => teamEff(app.state.teams[b]) - teamEff(app.state.teams[a]) || a.localeCompare(b));
  const startingTeams = initialRank.length;
  const managerId = app.state.managedTeamId;
  let steps = 0, redraws = 0, firstDecisionMatch = null, eliminatedAt = null, managedPlacement = null, lastTactic = 'balanced';
  let stoppedReason = null;
  const tacticalChoices = { attack: 0, balanced: 0, defend: 0 }, signingChoices = {};
  const limit = Math.max(128, startingTeams * 16);
  while (app.state.aliveIds.length > 1 && steps++ < limit) {
    const state = app.state;
    if (state.managerElimination) {
      eliminatedAt = state.matches;
      managedPlacement = state.managerElimination.placement;
      app.continueAsSpectator();
    } else if (state.tacticalChoice) {
      firstDecisionMatch ??= state.matches + 1;
      const options = state.tacticalChoice.options;
      const tieOrder = { balanced: 0, defend: 1, attack: 2 };
      const option = managerPolicy === 'adaptive'
        ? options.slice().sort((a, b) => b.winProbability - a.winProbability || tieOrder[a.id] - tieOrder[b.id])[0]
        : options.find(item => item.id === managerPolicy) || options.find(item => item.id === 'balanced');
      lastTactic = option.id;
      tacticalChoices[option.id]++;
      app.chooseTactic(option.id);
    } else if (state.choice) {
      firstDecisionMatch ??= state.matches + 1;
      const policy = managerPolicy === 'adaptive' ? lastTactic : managerPolicy;
      const value = candidate => candidate.gain + (policy === 'attack' ? candidate.attackGain : policy === 'defend' ? candidate.defendGain : 0);
      const selected = state.choice.candidates.slice().sort((a, b) => value(b) - value(a) || b.rating - a.rating || a.index - b.index)[0];
      if (!selected) { stoppedReason = 'empty-manager-choice'; break; }
      signingChoices[selected.role || 'Unlabelled'] = (signingChoices[selected.role || 'Unlabelled'] || 0) + 1;
      app.chooseAcquisition(selected.index);
    } else if (state.match && !state.match.applied) {
      app.finishMatch();
    } else if (state.spin) {
      const draw = state.spin;
      app.lockDuel(draw.key);
      app.startMatch(draw.attackerId, draw.targetId, draw);
    } else {
      const previous = [state.matches, state.round, state.queue.length].join(':');
      app.nextAction();
      if (!app.state.match || app.state.match.applied) {
        if (!app.state.spin && !app.state.tacticalChoice && previous === [app.state.matches, app.state.round, app.state.queue.length].join(':')) redraws++;
      }
    }
  }
  if (app.state.managerElimination) {
    eliminatedAt = app.state.matches;
    managedPlacement = app.state.managerElimination.placement;
  }
  const championId = app.state.aliveIds.length === 1 ? app.state.aliveIds[0] : null;
  const useful = app.state.metrics.acquisitions.filter(gain => gain > .05).length;
  const acquisitions = app.state.metrics.acquisitions.length;
  const managerMatches = managerId ? app.state.history.filter(match => match.aId === managerId || match.dId === managerId).length : null;
  const result = {
    seed, sport, layer, scope: layer === 'clubs' ? clubScope : scope, pacing, uncertainty, finale, acquisitionPolicy, rosterPreset, managerPolicy,
    completed: !!championId, stalled: !championId, stoppedReason: stoppedReason || (!championId ? 'step-limit' : null), startingTeams,
    championId, champion: championId ? app.state.teams[championId].name : null,
    championInitialRank: championId ? initialRank.indexOf(championId) + 1 : null,
    matches: app.state.matches, conquests: app.state.fallen.length, redraws, usefulAcquisitions: useful, acquisitions,
    acquisitionGain: Math.round(app.state.metrics.acquisitions.reduce((sum, gain) => sum + gain, 0) * 100) / 100,
    managedTeamId: managerId, managedInitialRank: managerId ? initialRank.indexOf(managerId) + 1 : null,
    managedMatches: managerMatches, managedConquests: managerId ? app.state.stats[managerId]?.conq || 0 : null,
    managedEliminatedAt: eliminatedAt, managedPlacement: managerId ? managedPlacement || (championId === managerId ? 1 : null) : null,
    managedChampion: managerId ? championId === managerId : null, firstDecisionMatch, tacticalChoices, signingChoices,
    finalRngState: app.rng.getState(), decisionCount: app.state.decisionLedger.length,
    // Compact sequence is sufficient to compare deterministic replay and runner
    // equivalence without retaining every ticker event in large balance reports.
    outcomes: app.state.history.map(match => `${match.aId}:${match.dId}:${match.winnerId}:${match.a.score}:${match.b.score}`),
  };
  app.clearTimers();
  return result;
}

export function wilsonInterval(successes, trials) {
  if (!trials) return null;
  const z = 1.95996398454, p = successes / trials;
  const scale = 1 + z * z / trials;
  const centre = (p + z * z / (2 * trials)) / scale;
  const radius = z * Math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials)) / scale;
  return [Math.max(0, centre - radius), Math.min(1, centre + radius)].map(value => Math.round(value * 10000) / 10000);
}

export function summarizeProduction(results) {
  const completed = results.filter(result => result.completed), managed = results.filter(result => result.managedTeamId);
  const champions = {};
  for (const result of completed) champions[result.champion] = (champions[result.champion] || 0) + 1;
  const sum = key => results.reduce((total, result) => total + result[key], 0);
  const mean = (key, selected = results) => {
    const values = selected.map(result => result[key]).filter(value => value != null);
    return values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length * 100) / 100 : null;
  };
  const topFive = completed.filter(result => result.championInitialRank <= 5).length;
  const acquisitions = sum('acquisitions'), useful = sum('usefulAcquisitions');
  const championDistribution = Object.entries(champions).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, wins]) => ({ name, wins, share: wins / Math.max(1, completed.length), share95: wilsonInterval(wins, completed.length) }));
  const entropy = championDistribution.reduce((value, entry) => value - entry.share * Math.log(entry.share), 0);
  return {
    runs: results.length, completed: completed.length, stalled: results.length - completed.length,
    completionShare95: wilsonInterval(completed.length, results.length),
    champions: championDistribution, distinctChampions: championDistribution.length,
    effectiveChampionCount: Math.round(Math.exp(entropy) * 100) / 100,
    leadingChampionShare: championDistribution[0]?.share || 0,
    topFiveChampionShare: topFive / Math.max(1, completed.length), topFiveChampionShare95: wilsonInterval(topFive, completed.length),
    usefulAcquisitionShare: useful / Math.max(1, acquisitions), usefulAcquisitionShare95: wilsonInterval(useful, acquisitions),
    meanMatches: mean('matches'), meanConquests: mean('conquests'), meanRedraws: mean('redraws'), meanAcquisitionGain: mean('acquisitionGain'),
    meanManagedMatches: mean('managedMatches', managed), meanManagedConquests: mean('managedConquests', managed),
    meanManagedPlacement: mean('managedPlacement', managed), meanManagedEliminatedAt: mean('managedEliminatedAt', managed),
    managedChampionShare: managed.length ? managed.filter(result => result.managedChampion).length / managed.length : null,
    meanFirstDecisionMatch: mean('firstDecisionMatch', managed), managedRuns: managed.length,
    failures: results.filter(result => !result.completed).map(result => ({ seed: result.seed, reason: result.stoppedReason })),
  };
}

export function productionMatrix(name = 'coverage') {
  const baseline = { sport: 'football', layer: 'nations', scope: 'elite', clubScope: 'elite', pacing: 'blitz',
    uncertainty: 'balanced', finale: 'single', acquisitionPolicy: 'highest-rated', rosterPreset: 'authentic', managerPolicy: 'spectator' };
  if (name === 'competitive') return ['authentic', 'competitive'].map(rosterPreset => ({ ...baseline, sport: 'basketball', rosterPreset }));
  const firstLeague = sport => getSport(sport).clubs[0]?.league || 'all';
  return [
    {},
    { scope: 'CONMEBOL', pacing: 'duel', uncertainty: 'predictable' },
    { scope: 'world', pacing: 'chaos', uncertainty: 'wild', finale: 'best-of-three', acquisitionPolicy: 'best-fit' },
    { scope: 'CAF', uncertainty: 'predictable' },
    { scope: 'AFC', pacing: 'chaos', finale: 'best-of-three', acquisitionPolicy: 'best-fit' },
    { scope: 'CONCACAF', pacing: 'duel' },
    { layer: 'clubs', acquisitionPolicy: 'best-fit' },
    { layer: 'clubs', clubScope: firstLeague('football'), pacing: 'duel', uncertainty: 'wild' },
    { sport: 'basketball' },
    { sport: 'basketball', rosterPreset: 'competitive' },
    { sport: 'basketball', scope: 'UEFA', pacing: 'chaos', uncertainty: 'wild', acquisitionPolicy: 'best-fit', finale: 'best-of-three' },
    { sport: 'basketball', scope: 'world', uncertainty: 'predictable', rosterPreset: 'competitive' },
    { sport: 'basketball', scope: 'AFC', pacing: 'duel', rosterPreset: 'competitive' },
    { sport: 'basketball', layer: 'clubs', pacing: 'chaos', rosterPreset: 'competitive' },
    { sport: 'basketball', layer: 'clubs', clubScope: 'all', uncertainty: 'wild' },
    { scope: 'CONMEBOL', pacing: 'duel', uncertainty: 'predictable', managerPolicy: 'balanced' },
    { scope: 'UEFA', managerPolicy: 'adaptive', acquisitionPolicy: 'best-fit' },
    { scope: 'UEFA', pacing: 'chaos', uncertainty: 'wild', managerPolicy: 'attack' },
    { sport: 'basketball', managerPolicy: 'defend' },
    { sport: 'basketball', managerPolicy: 'adaptive', rosterPreset: 'competitive' },
  ].map(entry => ({ ...baseline, ...entry }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = Object.fromEntries(process.argv.slice(2).filter(argument => argument.startsWith('--')).map(argument => {
    const [key, ...parts] = argument.slice(2).split('='); return [key, parts.join('=')];
  }));
  const runs = Math.max(1, Math.min(500, Math.round(Number(args.runs) || 4)));
  const seedStart = Number(args.seed) >>> 0 || 20261002;
  let matrix = productionMatrix(args.matrix || 'coverage');
  const fields = { sport: 'sport', layer: 'layer', scope: 'scope', 'club-scope': 'clubScope', pacing: 'pacing',
    uncertainty: 'uncertainty', finale: 'finale', acquisition: 'acquisitionPolicy', roster: 'rosterPreset', 'manager-policy': 'managerPolicy' };
  if (Object.keys(fields).some(key => args[key])) {
    // Explicit fields build a targeted Cartesian matrix over the baseline.
    matrix = [productionMatrix()[0]];
    for (const [key, field] of Object.entries(fields)) if (args[key])
      matrix = matrix.flatMap(entry => args[key].split(',').map(value => ({ ...entry, [field]: value })));
  }
  const report = { note: 'Production App campaigns with one shared seeded RNG. Matched seeds across variants; divergent decisions/results naturally advance the shared stream differently. Model probes, not human engagement evidence. Wilson intervals are binomial reference intervals; the pooled acquisition interval does not account for within-campaign dependence.',
    runner: 'src/App.jsx production lifecycle', seedStart, runs, matrix: args.matrix || 'coverage', campaigns: [] };
  for (const parameters of matrix) {
    const results = Array.from({ length: runs }, (_, index) => runProductionCampaign({ ...parameters, seed: seedStart + index }));
    const summary = { ...parameters, ...summarizeProduction(results) };
    report.campaigns.push(summary);
    console.error(`${parameters.sport}/${parameters.layer}/${parameters.layer === 'clubs' ? parameters.clubScope : parameters.scope}/${parameters.pacing}/${parameters.uncertainty}/${parameters.rosterPreset}/${parameters.managerPolicy}: ${summary.completed}/${runs} complete; ${summary.distinctChampions} champions`);
  }
  const json = JSON.stringify(report, null, 2);
  if (args.output) writeFileSync(args.output, `${json}\n`);
  console.log(json);
  if (report.campaigns.some(campaign => campaign.stalled)) process.exitCode = 1;
}
