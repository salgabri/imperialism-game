// Engine-scale gate for the built-in football squads (docs/design/football-squad-gate.md, "Engine-scale gate"). The
// match engine works on absolute rating constants (RATING_SCALE, MAX_LOG_EDGE, the 40-point empty shirt, the 12-point
// penalty, upsetThreshold), so new squads can rank nations right and still change odds, upsets and campaign length.
// The built-in squads (src/data/rosters.js, identified by the first 12 hex of its SHA-256) are measured on:
//   1. scale: SD and 10/50/90% quantiles of the national starters' effective ratings (best 4-4-2, 12-point penalty,
//      empty shirt 40) of every nation that fields a side, and the SD of T_n (unrounded XI mean); club starters are
//      reported only;
//   2. a seeded match-model probe: every pair of fielded nations inside one of the game's five confederation scopes
//      (AFC includes OFC) plays one match through src/sports/football.js (prepareFootballMatch + sampleFootballResult,
//      the Balanced drama, teamEff ratings, each match on its own seeded RNG so a pair draws the same random numbers
//      whatever the squads): favourite win rate (the higher teamEff wins; equal pairs left out) and upset rate (App's
//      rule: the winner's teamEff + CONFIG.upsetThreshold ≤ the loser's);
//   3. scripts/production-balance.mjs on the coverage matrix's football campaigns with matched seeds: meanMatches,
//      completion, topFiveChampionShare and effectiveChampionCount.
// The reference is the built-in these squads replaced: when the squads' hash differs from the committed report's
// built-in entry, that entry becomes the reference and the new squads are compared with it. So a rebuild or a season
// rollover is always measured against what shipped before it, though the old rosters have left the repo.
// Tolerances: SDs within ±10%, quantiles within ±1 point, shares inside the reference's Wilson 95% intervals,
// meanMatches within ±10%. Shares are gated pooled over the football campaigns (one Wilson interval on all completed
// runs) because per-campaign intervals of RUNS runs would fail sound squads by chance; per-campaign intervals are listed
// as diagnostics. effectiveChampionCount has no tolerance and is reported only. The output is deterministic (no
// timestamps); scripts/football-validate.mjs reads it and checks the hash. Each campaign records a fingerprint of its
// first seed's run, so the tests can spot a stale file from one run per campaign.
//
//   npm run engine-scale:football                      measures the built-in and writes the report
//   npm run engine-scale:football -- --check           recomputes and exits 1 if the committed file differs
//   npm run engine-scale:football -- --runs=N --output=<file>   a smaller sample, written elsewhere
//
// Ported on 2026-11-10 from the squad-years work (claude/football-rating-strategy-ef71dc), which compared each squad
// year with a fixed 2025/26 build.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const ENGINE_SCALE_FILE = 'docs/design/football-gate/engine-scale.json';
export const ROSTERS_FILE = 'src/data/rosters.js';
export const AUDIT_FILE = 'docs/design/football-roster-audit.json';
export const ENGINE_SCALE = {
  tolerances: { sdRelative: 0.1, quantilePoints: 1, meanMatchesRelative: 0.1, shares: 'inside the reference Wilson 95% interval' },
  quantiles: [0.1, 0.5, 0.9],
  probe: { seed: 20261002, scopes: ['UEFA', 'CONMEBOL', 'CAF', 'AFC', 'CONCACAF'] },
  // About a second per seed for the 11 football campaigns, so 40 seeds take under a minute.
  production: { runs: 40, seedStart: 20261002, matrix: 'coverage' },
};
const round4 = value => value == null || !Number.isFinite(value) ? null : Math.round(value * 1e4) / 1e4;

// ---- statistics ----
/** Linear-interpolation quantile (type 7) of an ascending array. */
export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
/** n, mean, population SD and the gate's quantiles. */
export function describe(values, quantiles = ENGINE_SCALE.quantiles) {
  const sorted = values.slice().sort((a, b) => a - b), n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  return { n, mean: round4(mean), sd: round4(sd), min: sorted[0], max: sorted.at(-1),
    quantiles: Object.fromEntries(quantiles.map(q => [`q${Math.round(q * 100)}`, round4(quantile(sorted, q))])) };
}
/** Wilson score interval, the same as scripts/production-balance.mjs. */
export function wilsonInterval(successes, trials) {
  if (!trials) return null;
  const z = 1.95996398454, p = successes / trials, scale = 1 + z * z / trials;
  const centre = (p + z * z / (2 * trials)) / scale;
  const radius = z * Math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials)) / scale;
  return [Math.max(0, centre - radius), Math.min(1, centre + radius)].map(value => Math.round(value * 10000) / 10000);
}

// ---- tolerance checks ----
export const withinRelative = (value, reference, tolerance) => reference > 0 && Math.abs(value / reference - 1) <= tolerance + 1e-12;
export const withinPoints = (value, reference, points) => Math.abs(value - reference) <= points + 1e-12;
export const insideInterval = (value, interval) => !!interval && value >= interval[0] && value <= interval[1];

/** Gate checks of one measurement against the reference's: [{ check, value, reference, tolerance, pass }]. */
export function scaleChecks(measured, reference, tol = ENGINE_SCALE.tolerances) {
  const checks = [];
  const relative = (check, value, ref) => checks.push({ check, value, reference: ref, tolerance: `±${tol.sdRelative * 100}%`,
    ratio: round4(value / ref), pass: withinRelative(value, ref, tol.sdRelative) });
  relative('starter rating SD', measured.starters.sd, reference.starters.sd);
  for (const [key, ref] of Object.entries(reference.starters.quantiles))
    checks.push({ check: `starter rating ${key.replace('q', '')}% quantile`, value: measured.starters.quantiles[key], reference: ref,
      tolerance: `±${tol.quantilePoints} point`, difference: round4(measured.starters.quantiles[key] - ref), pass: withinPoints(measured.starters.quantiles[key], ref, tol.quantilePoints) });
  relative('T_n SD', measured.strength.sd, reference.strength.sd);
  for (const key of ['favouriteWinRate', 'upsetRate'])
    checks.push({ check: `probe ${key}`, value: measured.probe[key], reference: reference.probe[key], tolerance: 'reference Wilson 95%',
      interval: reference.probe[`${key}95`], pass: insideInterval(measured.probe[key], reference.probe[`${key}95`]) });
  const byName = new Map(reference.production.campaigns.map(c => [c.campaign, c]));
  for (const campaign of measured.production.campaigns) {
    const ref = byName.get(campaign.campaign);
    if (!ref) { checks.push({ check: `meanMatches ${campaign.campaign}`, value: campaign.meanMatches, reference: null, pass: false }); continue; }
    checks.push({ check: `meanMatches ${campaign.campaign}`, value: campaign.meanMatches, reference: ref.meanMatches,
      tolerance: `±${tol.meanMatchesRelative * 100}%`, ratio: round4(campaign.meanMatches / ref.meanMatches), pass: withinRelative(campaign.meanMatches, ref.meanMatches, tol.meanMatchesRelative) });
  }
  for (const key of ['completion', 'topFiveChampionShare'])
    checks.push({ check: `pooled ${key}`, value: measured.production.pooled[key], reference: reference.production.pooled[key], tolerance: 'reference Wilson 95%',
      interval: reference.production.pooled[`${key}95`], pass: insideInterval(measured.production.pooled[key], reference.production.pooled[`${key}95`]) });
  return checks;
}

// ---- measurements ----
export async function loadEngine(root = ROOT) {
  const imp = file => import(pathToFileURL(path.join(root, file)).href);
  const [teams, footballModule, sets, config, odds] = await Promise.all([
    imp('src/data/teams.js'), imp('src/sports/football.js'), imp('src/engine/footballSets.js'), imp('src/config.js'), imp('src/engine/odds.js')]);
  return { ...teams, ...footballModule, fieldedNations: sets.fieldedNations, CONFIG: config.CONFIG, UNCERTAINTY_PRESETS: odds.UNCERTAINTY_PRESETS };
}

/** Scale statistics and the match probe for the built-in nations (those fielding a side) and clubs. */
export function measureSquads(engine, { rosters, clubs }) {
  const { SCOPES, buildTeam, buildClub, selectLineup, teamEff, makeRng, hashStr, prepareFootballMatch, sampleFootballResult, CONFIG, UNCERTAINTY_PRESETS } = engine;
  const sport = { ...engine.football, rosters, clubs };
  const ids = [...engine.fieldedNations(sport)].sort();
  const teams = new Map(ids.map(id => [id, buildTeam(id, null, sport)]));
  const starters = [], strengths = [], eff = new Map();
  for (const id of ids) {
    const lineup = selectLineup(teams.get(id));
    for (const slot of lineup.slots) starters.push(slot.effectiveRating);
    strengths.push(lineup.slots.reduce((s, slot) => s + slot.effectiveRating, 0) / lineup.slots.length);
    eff.set(id, teamEff(teams.get(id)));
  }
  const clubStarters = clubs.flatMap(club => selectLineup(buildClub(club, sport)).slots.map(slot => slot.effectiveRating));
  // Probe: every pair inside a confederation scope, attacker = lower id; one seeded RNG per pair.
  const drama = UNCERTAINTY_PRESETS.balanced.drama, threshold = Number(CONFIG.upsetThreshold);
  const pairs = [];
  for (const scopeId of ENGINE_SCALE.probe.scopes) {
    const scope = SCOPES.find(s => s.id === scopeId), members = ids.filter(id => scope.filter(teams.get(id)));
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) pairs.push([scopeId, members[i], members[j]]);
  }
  let favourites = 0, favouriteWins = 0, upsets = 0, eligible = 0, eligibleUpsets = 0, equal = 0;
  for (const [scopeId, aId, dId] of pairs) {
    const a = teams.get(aId), d = teams.get(dId), effA = eff.get(aId), effD = eff.get(dId);
    const prepared = prepareFootballMatch(a, d, effA, effD);
    const result = sampleFootballResult(makeRng(hashStr(`${ENGINE_SCALE.probe.seed}:${scopeId}:${aId}:${dId}`)), prepared, drama);
    const [effW, effL] = result.winner === aId ? [effA, effD] : [effD, effA];
    if (effA === effD) equal++;
    else { favourites++; if (effW > effL) favouriteWins++; }
    const upset = effW + threshold <= effL;
    upsets += upset ? 1 : 0;
    if (Math.abs(effA - effD) >= threshold) { eligible++; eligibleUpsets += upset ? 1 : 0; }
  }
  return {
    nations: ids.length,
    starters: describe(starters), strength: describe(strengths), clubStarters: clubStarters.length ? describe(clubStarters) : null,
    probe: { pairs: pairs.length, drama, upsetThreshold: threshold, equalPairs: equal,
      favouriteWinRate: round4(favouriteWins / favourites), favouriteWinRate95: wilsonInterval(favouriteWins, favourites), favouriteMatches: favourites,
      upsetRate: round4(upsets / pairs.length), upsetRate95: wilsonInterval(upsets, pairs.length),
      underdogWinRateAtThreshold: round4(eligibleUpsets / eligible), pairsAtThreshold: eligible },
  };
}

const campaignName = p => [p.layer, p.layer === 'clubs' ? p.clubScope : p.scope, p.pacing, p.uncertainty, p.finale, p.acquisitionPolicy, p.managerPolicy].join('/');
export const footballCampaigns = (balance, matrix = ENGINE_SCALE.production.matrix) => balance.productionMatrix(matrix).filter(p => p.sport === 'football');
/** First 12 hex of sha256 over one run's champion, match count and outcomes: lets a test spot a stale file from one seed. */
export const runFingerprint = result => createHash('sha256').update(JSON.stringify([result.championId, result.matches, result.outcomes])).digest('hex').slice(0, 12);
/** production-balance on the coverage matrix's football campaigns, seeds seedStart … seedStart + runs − 1. */
export function measureProduction(balance, { runs, seedStart, matrix }) {
  const campaigns = [], pooled = { runs: 0, completed: 0, topFive: 0 };
  for (const parameters of footballCampaigns(balance, matrix)) {
    const results = Array.from({ length: runs }, (_, i) => balance.runProductionCampaign({ ...parameters, seed: seedStart + i }));
    const s = balance.summarizeProduction(results), topFive = Math.round(s.topFiveChampionShare * s.completed);
    pooled.runs += s.runs; pooled.completed += s.completed; pooled.topFive += topFive;
    campaigns.push({ campaign: campaignName(parameters), firstSeedFingerprint: runFingerprint(results[0]), runs: s.runs, completed: s.completed, completion: round4(s.completed / s.runs),
      completion95: s.completionShare95, meanMatches: s.meanMatches, topFiveChampionShare: round4(s.topFiveChampionShare),
      topFiveChampionShare95: s.topFiveChampionShare95, effectiveChampionCount: s.effectiveChampionCount, distinctChampions: s.distinctChampions });
  }
  return { campaigns, pooled: { runs: pooled.runs, completed: pooled.completed,
    completion: round4(pooled.completed / pooled.runs), completion95: wilsonInterval(pooled.completed, pooled.runs),
    topFiveChampionShare: round4(pooled.topFive / Math.max(1, pooled.completed)), topFiveChampionShare95: wilsonInterval(pooled.topFive, pooled.completed) } };
}

/** Diagnostics: per-campaign shares against the reference campaign's own Wilson intervals (not gated). */
function campaignDiagnostics(measured, reference) {
  const byName = new Map(reference.production.campaigns.map(c => [c.campaign, c]));
  return measured.production.campaigns.map(c => { const ref = byName.get(c.campaign);
    return { campaign: c.campaign, completionInside: insideInterval(c.completion, ref?.completion95),
      topFiveInside: insideInterval(c.topFiveChampionShare, ref?.topFiveChampionShare95),
      effectiveChampionCountRatio: ref ? round4(c.effectiveChampionCount / ref.effectiveChampionCount) : null }; });
}

/** The built-in's identity: the first 12 hex of the SHA-256 of src/data/rosters.js, and its sources from the audit. */
export async function builtInIdentity(root = ROOT) {
  const contentHash = createHash('sha256').update(await readFile(path.join(root, ROSTERS_FILE))).digest('hex').slice(0, 12);
  const audit = JSON.parse(await readFile(path.join(root, AUDIT_FILE), 'utf8'));
  const ea = audit.ea.snapshots.map(row => `${row.edition} of ${row.snapshotDate}`).join(', ');
  return { contentHash, label: `${ea} + ${audit.fm.edition} ${audit.fm.version}${audit.identity ? `, Reep person keys ${audit.identity.reep.release}` : ''}` };
}

/** The measurement fields an entry keeps beside its identity, verdict and checks. */
const MEASURED = ['nations', 'starters', 'strength', 'clubStarters', 'probe', 'production'];
const measuredOf = entry => Object.fromEntries(MEASURED.map(key => [key, entry[key]]));

/**
 * Measure the built-in and compare it with the reference: the committed report's reference while the squads are the
 * ones it measured (same hash), else the committed built-in entry, the squads these replaced. `committed` is the
 * parsed committed report or null; `production` overrides the runs.
 */
export async function runEngineScale({ root = ROOT, committed = null, runs = ENGINE_SCALE.production.runs, log = () => {} } = {}) {
  const engine = await loadEngine(root);
  const balance = await import(pathToFileURL(path.join(root, 'scripts/production-balance.mjs')).href);
  const identity = await builtInIdentity(root);
  const production = { ...ENGINE_SCALE.production, runs };
  const started = Date.now();
  const measured = { ...measureSquads(engine, { rosters: engine.football.rosters, clubs: engine.football.clubs }), production: measureProduction(balance, production) };
  log(`Built-in ${identity.contentHash}: measured in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  const previous = committed?.builtIn ?? null;
  const reference = previous && previous.contentHash === identity.contentHash ? committed.reference ?? null
    : previous ? { contentHash: previous.contentHash, label: previous.label, ...measuredOf(previous) } : null;
  const checks = reference ? scaleChecks(measured, reference) : [];
  const failed = checks.filter(check => !check.pass);
  return {
    note: 'Engine-scale gate (docs/design/football-squad-gate.md): the built-in squads against the reference, the built-in they replaced, on starter-rating scale, a seeded match-model probe over real nation pairs and production-balance campaigns with matched seeds. Keyed by the content hash of src/data/rosters.js; scripts/football-validate.mjs checks it. Regenerate with npm run engine-scale:football.',
    configuration: { quantiles: ENGINE_SCALE.quantiles, probe: { ...ENGINE_SCALE.probe, pairs: 'every pair of nations fielding a side inside one confederation scope, one match each, attacker = lower NATIONS id', ratings: 'teamEff (src/data/teams.js)', drama: 'Balanced preset' },
      production: { ...production, campaigns: 'the coverage matrix\'s football entries (scripts/production-balance.mjs productionMatrix)' } },
    tolerances: { ...ENGINE_SCALE.tolerances, sharesPooled: 'completion and topFiveChampionShare are gated pooled over all football campaigns; per-campaign intervals are diagnostics only',
      notGated: ['effectiveChampionCount (no tolerance)', 'club starters'] },
    reference,
    builtIn: { contentHash: identity.contentHash, label: identity.label, verdict: failed.length ? 'fail' : 'pass',
      ...(reference ? {} : { note: 'First measurement: no earlier built-in to compare with.' }),
      failed: failed.map(check => check.check), ...measured, ...(reference ? { campaignDiagnostics: campaignDiagnostics(measured, reference) } : {}), checks },
  };
}

export const serializeEngineScale = report => `${JSON.stringify(report, null, 2)}\n`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = Object.fromEntries(process.argv.slice(2).filter(argument => argument.startsWith('--')).map(argument => {
    const [key, ...parts] = argument.slice(2).split('='); return [key, parts.length ? parts.join('=') : true];
  }));
  const unknown = Object.keys(args).filter(key => !['check', 'output', 'runs'].includes(key));
  if (unknown.length) throw new Error(`Unknown option(s) --${unknown.join(', --')}. Usage: node scripts/football-engine-scale.mjs [--check] [--output=file] [--runs=N]`);
  const committedPath = path.join(ROOT, ENGINE_SCALE_FILE);
  const output = path.resolve(typeof args.output === 'string' ? args.output : committedPath);
  const runs = args.runs ? Math.max(1, Math.round(Number(args.runs))) : ENGINE_SCALE.production.runs;
  if (runs !== ENGINE_SCALE.production.runs && typeof args.output !== 'string')
    throw new Error(`--runs=${runs} differs from the committed ${ENGINE_SCALE.production.runs}; pass --output=file`);
  const committedText = await readFile(committedPath, 'utf8').catch(() => null);
  const report = await runEngineScale({ committed: committedText ? JSON.parse(committedText) : null, runs, log: message => console.error(message) });
  const m = report.builtIn;
  console.log(`Built-in ${m.contentHash} (${m.label}): ${m.verdict}${report.reference ? ` against ${report.reference.contentHash}` : ' (no reference yet)'}. Starters SD ${m.starters.sd}, q10/50/90 ${Object.values(m.starters.quantiles).join('/')}; T_n SD ${m.strength.sd}; `
    + `probe favourite ${m.probe.favouriteWinRate}, upsets ${m.probe.upsetRate} over ${m.probe.pairs} pairs; campaigns: completion ${m.production.pooled.completion}, top-five champions ${m.production.pooled.topFiveChampionShare}.`);
  for (const failed of m.failed) console.log(`  - fails ${failed}`);
  const text = serializeEngineScale(report), shown = path.relative(ROOT, output).split(path.sep).join('/');
  if (args.check) {
    if (committedText !== text) { console.error(`${shown} is stale; run npm run engine-scale:football`); process.exitCode = 1; }
    else console.log(`${shown} is current.`);
  } else {
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, text);
    console.log(`Wrote ${shown}`);
  }
}
