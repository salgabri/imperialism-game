// A team's strength for the views (src/viewModels/teamStrength.js): teamEff once per team object, shared by the Ledger's
// standings, the Strength map and the turn panels, and never read by gameplay. Plus the standings' territory counts,
// which come from the turn panels' one pass over `own` rather than a pass over the map per survivor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTeam, makeRng, teamEff } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { territories } from '../src/engine/campaign.js';
import { viewTeamEff } from '../src/viewModels/teamStrength.js';
import { bundleApp, syncAppFixture } from './lib/app-harness.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

test('viewTeamEff is teamEff, once per team object, for every sport', () => {
  for (const sportId of ['football', 'basketball', 'american-football', 'hockey', 'baseball', 'tennis', 'rugby-league']) {
    const rng = makeRng(4242);
    const team = buildTeam('250', rng, getSport(sportId));
    assert.equal(viewTeamEff(team), teamEff(team), sportId);
    assert.equal(viewTeamEff(team), teamEff(team), `${sportId}, from the cache`);
  }
});

test('the cache keeps a value while the squad is the same array of the same length, and searches again otherwise', () => {
  const team = buildTeam('380', makeRng(77), getSport('football'));
  const before = viewTeamEff(team);
  // State never edits a squad in place; a rating changed in place is how a test can see that the value was cached.
  const best = team.squad.reduce((top, player) => (player.rating > top.rating ? player : top));
  best.rating -= 30;
  assert.equal(viewTeamEff(team), before, 'the same object, squad and length: the cached value');
  assert.notEqual(teamEff(team), before, 'which teamEff no longer gives');
  team.squad.push({ name: 'Late signing', pos: 'FW', rating: 99 });
  assert.equal(viewTeamEff(team), teamEff(team), 'a push to the squad it showed: searched again');
  team.squad = team.squad.slice(0, -1);
  assert.equal(viewTeamEff(team), teamEff(team), 'a new squad array: searched again');
  const copy = { ...team, squad: team.squad.slice() };
  assert.equal(viewTeamEff(copy), teamEff(copy), 'a replaced team is a new object');
});

test('a team whose strength cannot be worked out throws every time: no throw is cached, each caller keeps its fallback', () => {
  const broken = { id: 'x', squad: {} };
  assert.throws(() => teamEff(broken));
  assert.throws(() => viewTeamEff(broken));
  assert.throws(() => viewTeamEff(broken), 'still throws: nothing was stored');
  broken.squad = buildTeam('380', makeRng(5), getSport('football')).squad;
  assert.equal(viewTeamEff(broken), teamEff(broken));
  assert.equal(viewTeamEff(null), teamEff(null), 'what is not a team object goes to teamEff as it is');
});

/** Every source file under src/, relative to the repository, with forward slashes. */
function sources(dir = path.join(ROOT, 'src')) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(jsx?|mjs)$/.test(entry.name) ? [path.relative(ROOT, full).replace(/\\/g, '/')] : [];
  });
}

test('only view code reads the strength cache: gameplay (engine/, conquestMethods) calls teamEff itself', () => {
  const importers = sources().filter(file => /from\s+['"][^'"]*teamStrength\.js['"]/.test(readFileSync(path.join(ROOT, file), 'utf8')));
  assert.ok(importers.includes('src/app/ledgerMethods.jsx') && importers.includes('src/viewModels/map.js')
    && importers.includes('src/viewModels/turns.js'), importers.join(', '));
  const outside = importers.filter(file => !file.startsWith('src/viewModels/') && file !== 'src/app/ledgerMethods.jsx');
  assert.deepEqual(outside, [], 'view-models and the Ledger builder only');
});

test('the standings count each survivor’s territories as territories() does, from the one counting pass', async () => {
  await bundleApp();
  const f = syncAppFixture({ ids: ['250', '276', '826', '380'] });
  try {
    // France takes Britain; Italy's land is nobody's (a claimed or empty country has no owner).
    f.app.setState({ own: { ...f.app.state.own, '826': '250', '380': null }, aliveIds: ['250', '276'] });
    const rows = f.app.powerTable(true);
    const board = f.app.board();
    assert.deepEqual(rows.map(row => [row.tid, row.territories]),
      rows.map(row => [row.tid, String(territories(board, row.tid).length)]));
    assert.deepEqual(Object.fromEntries(rows.map(row => [row.tid, row.territories])), { '250': '2', '276': '1' });
    assert.deepEqual(rows.map(row => row.eff), rows.map(row => teamEff(f.app.state.teams[row.tid]).toFixed(1)));
  } finally { f.close(); }
});
