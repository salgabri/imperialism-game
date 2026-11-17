// The football seasons against World Football Elo (scripts/validate-football-elo.mjs, docs/design/roster-audit.md):
// the codes of a nation's earlier names, the day a season is scored on, and the committed report's shape. The Elo
// files stay out of the repository, so nothing here fetches or replays; npm run validate:football-elo -- --check does,
// where the cache is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILT_IN_SETS, setHasNations, setSportOf } from '../src/engine/footballSets.js';
import { REPORT_FILE, codesIn, startOf } from './validate-football-elo.mjs';

test('a nation takes the Elo code of its day when the table has no code of today\'s', () => {
  const codes = codesIn(new Map([['WG', 1], ['DD', 1], ['SU', 1], ['YU', 1], ['CS', 1], ['ZR', 1], ['MK', 1], ['SZ', 1]]));
  assert.deepEqual(['276', '278', '643', '688', '203', '180', '807', '748'].map(id => codes[id]), ['WG', 'DD', 'SU', 'YU', 'CS', 'ZR', 'MK', 'SZ']);
  const today = codesIn(new Map([['DE', 1], ['WG', 1], ['RS', 1], ['RM', 1]]));
  assert.deepEqual([today['276'], today['688']], ['DE', 'RS'], 'today\'s code comes first');
  assert.equal(codesIn(new Map([['RM', 1], ['YU', 1]]))['688'], 'RM', 'Serbia and Montenegro (2003–2006) before Yugoslavia');
});

test('a season is scored on the day it starts', () => {
  assert.equal(startOf({ year: 1990, season: '1989/90' }), '1989-07-01');
  assert.equal(startOf({ year: 2027, season: '2026/27' }), '2026-07-01');
  assert.equal(startOf({ year: 2026, season: '2026' }), '2026-01-01');
});

test('the committed report scores every game-rated football season with national teams', () => {
  const report = JSON.parse(readFileSync(new URL(`../${REPORT_FILE}`, import.meta.url), 'utf8'));
  const expected = ['builtin:football', ...BUILT_IN_SETS.filter(set => setSportOf(set.id) === 'football' && setHasNations(set.id)
    && !/^(?:nt|wc)-/.test(set.id)).map(set => set.id)].sort();
  assert.deepEqual(report.seasons.map(row => row.id).sort(), expected);
  for (const row of report.seasons) {
    assert.ok(row.spearman >= -1 && row.spearman <= 1 && row.scored <= row.fielded && row.fullXIs.n <= row.scored, row.id);
    assert.equal(row.elo.method, 'replay', `${row.id} replays Elo to its day`);
    // The replay rebuilds the year's own table but for teams rated before their first match (Montenegro in 2006),
    // and those are never nations the season fields.
    const [exact, teams] = row.elo.replayCheck.match(/^(\d+)\/(\d+) exact$/).slice(1).map(Number);
    assert.equal(teams - exact, row.elo.notReplayed.length, row.id);
    assert.ok(row.elo.notReplayed.length <= 1 && !row.elo.fieldedNotReplayed.length, `${row.id}: ${row.elo.notReplayed}`);
    // Every fielded nation has an Elo rating but Vietnam in 1989/90, which played no international match then.
    assert.deepEqual(row.noElo, row.id === 'cm0102-2017-04-cm89' ? ['Vietnam'] : [], row.id);
  }
  assert.equal(report.summary.scored, report.seasons.length);
  // The weakest agreement, FIFA 08's, still ranks the nations far more like results than chance would.
  assert.ok(report.seasons.every(row => row.spearman >= 0.7), 'a season far below its neighbours means its XIs were built wrong');
});
