// The football engine-scale gate (scripts/football-engine-scale.mjs; docs/design/football-squad-gate.md): its statistics
// and tolerances, and the committed report against the shipped built-in squads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { CONFIG } from '../src/config.js';
import { ENGINE_SCALE, ENGINE_SCALE_FILE, ROSTERS_FILE, builtInIdentity, describe, footballCampaigns, insideInterval, loadEngine,
  measureSquads, quantile, runFingerprint, scaleChecks, wilsonInterval, withinPoints, withinRelative } from './football-engine-scale.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const committed = JSON.parse(await readFile(path.join(root, ENGINE_SCALE_FILE), 'utf8'));
const stale = `${ENGINE_SCALE_FILE} is stale; run npm run engine-scale:football (then npm run validate:football)`;
const close = (actual, expected, label = '') => assert.ok(Math.abs(actual - expected) < 1e-9, `${label} ${actual} ≠ ${expected}`);

test('quantiles interpolate linearly and the description uses the population SD', () => {
  const sorted = [40, 50, 60, 70, 80];
  assert.equal(quantile(sorted, 0.5), 60);
  close(quantile(sorted, 0.1), 44);
  close(quantile(sorted, 0.9), 76);
  assert.equal(quantile([7], 0.9), 7);
  const d = describe([80, 40, 60, 70, 50]);
  assert.deepEqual(d.quantiles, { q10: 44, q50: 60, q90: 76 });
  assert.equal(d.sd, Math.round(Math.sqrt(200) * 1e4) / 1e4);
  assert.deepEqual([d.n, d.mean, d.min, d.max], [5, 60, 40, 80]);
});

test('tolerances: ±10% on SDs and meanMatches, ±1 point on quantiles, shares inside the Wilson interval', () => {
  assert.ok(withinRelative(11, 10, 0.1) && withinRelative(9, 10, 0.1), '±10% is inclusive');
  assert.ok(!withinRelative(11.01, 10, 0.1) && !withinRelative(8.99, 10, 0.1));
  assert.ok(withinPoints(70, 69, 1) && !withinPoints(70.5, 69, 1));
  assert.ok(insideInterval(0.5, [0.4, 0.6]) && insideInterval(0.6, [0.4, 0.6]) && !insideInterval(0.61, [0.4, 0.6]) && !insideInterval(0.5, null));
  assert.deepEqual(wilsonInterval(30, 40), [0.5981, 0.8581], 'centre (p + z²/2n)/(1 + z²/n), as in production-balance');
  assert.equal(wilsonInterval(0, 0), null);
  const summary = ({ sd = 10, q = [54, 69, 81], tsd = 9.5, fav = 0.74, upset = 0.09, matches = 31, completion = 1, topFive = 0.6 } = {}) => ({
    starters: { sd, quantiles: { q10: q[0], q50: q[1], q90: q[2] } }, strength: { sd: tsd },
    probe: { favouriteWinRate: fav, favouriteWinRate95: wilsonInterval(Math.round(fav * 3446), 3446), upsetRate: upset, upsetRate95: wilsonInterval(Math.round(upset * 3462), 3462) },
    production: { campaigns: [{ campaign: 'nations/elite', meanMatches: matches }],
      pooled: { completion, completion95: wilsonInterval(Math.round(completion * 440), 440), topFiveChampionShare: topFive, topFiveChampionShare95: wilsonInterval(Math.round(topFive * 440), 440) } },
  });
  const reference = summary();
  const failing = measured => scaleChecks(measured, reference).filter(check => !check.pass).map(check => check.check);
  assert.deepEqual(failing(summary()), []);
  assert.deepEqual(failing(summary({ sd: 11, q: [55, 68, 82], tsd: 8.55, matches: 34.1 })), [], 'edges pass');
  assert.deepEqual(failing(summary({ sd: 11.2 })), ['starter rating SD']);
  assert.deepEqual(failing(summary({ q: [54, 70.5, 81] })), ['starter rating 50% quantile']);
  assert.deepEqual(failing(summary({ tsd: 8.4 })), ['T_n SD']);
  assert.deepEqual(failing(summary({ fav: 0.78, upset: 0.07 })), ['probe favouriteWinRate', 'probe upsetRate']);
  assert.deepEqual(failing(summary({ matches: 35 })), ['meanMatches nations/elite']);
  assert.deepEqual(failing(summary({ topFive: 0.5 })), ['pooled topFiveChampionShare']);
  assert.deepEqual(failing(summary({ completion: 0.9 })), ['pooled completion']);
});

test('the committed engine-scale.json measures the shipped built-in against the built-in it replaced', async () => {
  const contentHash = createHash('sha256').update(await readFile(path.join(root, ROSTERS_FILE))).digest('hex').slice(0, 12);
  const entry = committed.builtIn;
  assert.equal(entry.contentHash, contentHash, `${stale}: src/data/rosters.js changed`);
  assert.equal(entry.label, (await builtInIdentity(root)).label, stale);
  assert.deepEqual(committed.configuration.production.runs, ENGINE_SCALE.production.runs, stale);
  assert.ok(committed.reference && committed.reference.contentHash !== contentHash, 'the reference is an earlier built-in');
  // Checks and verdict follow from the recorded measurements and the tolerances in the script.
  const checks = scaleChecks(entry, committed.reference);
  assert.deepEqual(entry.checks, checks, stale);
  assert.equal(entry.verdict, checks.every(check => check.pass) ? 'pass' : 'fail', stale);
  assert.deepEqual(entry.failed, checks.filter(check => !check.pass).map(check => check.check), stale);
  assert.equal(entry.probe.upsetThreshold, CONFIG.upsetThreshold, stale);
  assert.equal(entry.production.campaigns.length, 11);
  assert.equal(entry.verdict, 'pass', `the built-in squads leave the engine's scale: ${entry.failed.join(', ')}`);
});

test('the committed engine-scale.json is current: scale statistics, the probe and each campaign\'s first seed reproduce', async () => {
  const engine = await loadEngine(root), entry = committed.builtIn;
  const measured = measureSquads(engine, { rosters: engine.football.rosters, clubs: engine.football.clubs });
  for (const key of ['nations', 'starters', 'strength', 'clubStarters', 'probe']) assert.deepEqual(entry[key], measured[key], `${key}: ${stale}`);
  // The full 40-seed rerun takes about a minute (npm run engine-scale:football -- --check); one seed per campaign spots
  // most staleness.
  const balance = await import(pathToFileURL(path.join(root, 'scripts/production-balance.mjs')).href);
  const campaigns = footballCampaigns(balance);
  assert.equal(campaigns.length, entry.production.campaigns.length);
  for (const [i, parameters] of campaigns.entries()) {
    const run = balance.runProductionCampaign({ ...parameters, seed: ENGINE_SCALE.production.seedStart });
    assert.equal(runFingerprint(run), entry.production.campaigns[i].firstSeedFingerprint, `${entry.production.campaigns[i].campaign}: ${stale}`);
  }
});
