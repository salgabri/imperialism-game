// Owner: WP-COL (wiring pass). App ↔ src/app/columnMethods.jsx: the Map column, the map title card/key and the
// ticker get real models from the running App (PLAN §3.3, §4.3; DEC D4, D5, D10, D21, D22), and the delegates stay
// render-pure (no timers, no campaign RNG) and empty outside a running campaign (PLAN §0.9).
import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleApp, syncAppFixture, findElement, forceResult } from './lib/app-harness.mjs';
import { reachableTargets } from '../src/engine/turns.js';
import { winChanceFor } from '../src/viewModels/odds.js';
import { formatWinChance, winTone } from '../src/viewModels/format.js';
import { teamEff } from '../src/data/teams.js';
import { empireFill } from '../src/theme.js';

await bundleApp();

const MODES = ['political', 'strength', 'fronts', 'flags'];

function expectedKeyVariant(mapMode) {
  return MODES.includes(mapMode) ? mapMode : 'political';
}

function columnDelegates(app) {
  return { column: app.columnModel(), overlays: app.mapOverlaysModel(), ticker: app.tickerModel(), idle: app.idleText() };
}

test('loading and setup: the column delegates return their empty values', () => {
  for (const phase of ['loading', 'setup']) {
    const f = syncAppFixture({ phase });
    try {
      const { column, overlays, ticker, idle } = columnDelegates(f.app);
      assert.equal(column.fixture, null, phase);
      assert.equal(column.fronts, null, phase);
      assert.deepEqual(column.results, { rows: [] }, phase);
      assert.equal(column.sheet, 'collapsed', phase);
      assert.deepEqual(overlays, { titleCard: null, mapKey: null }, phase);
      assert.deepEqual(ticker, { items: [] }, phase);
      assert.equal(idle, null, phase);
    } finally { f.close(); }
  }
});

test('spectator idle: DEC D10 idle fixture, campaign title card, mode key and empty ticker reach the render tree', () => {
  const f = syncAppFixture({ role: 'spectator' });
  try {
    const column = f.app.columnModel();
    assert.equal(column.role, 'spectator');
    assert.equal(column.fronts, null, 'spectators have no fronts table');
    assert.equal(column.fixture.state, 'idle');
    assert.equal(column.fixture.idleTitle, 'Next draw');
    assert.equal(column.fixture.route, 'Any of 3 empires can be drawn');
    assert.equal(column.fixture.odds, null, 'no odds bar before the draw');
    assert.deepEqual(column.results.rows, []);
    assert.equal(f.app.idleText(), 'Any of 3 empires can be drawn');

    const { titleCard, mapKey } = f.app.mapOverlaysModel();
    assert.equal(titleCard.variant, 'campaign');
    assert.equal(titleCard.title, 'The European Campaign');
    assert.match(titleCard.meta, /seed 728491$/);
    assert.equal(mapKey.variant, expectedKeyVariant(f.app.state.mapMode));
    assert.deepEqual(f.app.tickerModel(), { items: [] });

    const tree = f.app.render();
    const columnEl = findElement(tree, 'CampaignColumn');
    assert.ok(columnEl, 'CampaignColumn renders on the Map view');
    assert.equal(columnEl.props.fixture.state, 'idle');
    assert.equal(columnEl.props.role, 'spectator');
    assert.equal(findElement(tree, 'MapOverlays').props.titleCard.variant, 'campaign');
    assert.deepEqual(findElement(tree, 'Ticker').props.items, []);
  } finally { f.close(); }
});

test('manager: fronts use the real reachableTargets and estimator win chances; the tactical gate offers preview and simulate', () => {
  const f = syncAppFixture({ role: 'manager' });
  try {
    const app = f.app;
    const rng = app.rng.getState();
    const column = app.columnModel();
    assert.equal(column.role, 'manager');
    assert.ok(column.fronts, 'managers get a fronts table');

    const reach = reachableTargets(app.board(), '250');
    const land = reach.filter(entry => entry.tier === 'land');
    const pool = [...new Set((land.length ? land : reach).map(entry => entry.tid))];
    assert.ok(column.fronts.rows.length >= 1, 'the tiny atlas has at least one rival in reach');
    assert.deepEqual(new Set(column.fronts.rows.map(row => row.teamId)), new Set(pool.slice(0, 5)));
    const ctx = app.viewContext();
    for (const row of column.fronts.rows) {
      const p = winChanceFor(app.state, ctx, '250', row.teamId);
      assert.equal(row.win, formatWinChance(p), `win chance for ${row.teamId}`);
      assert.equal(row.tone, winTone(p));
      assert.equal(row.eff, teamEff(app.state.teams[row.teamId]).toFixed(1));
    }
    assert.equal(app.mapOverlaysModel().titleCard.phoneTitle, 'Your fronts');

    app.startMatch('250', '276');
    assert.ok(app.state.tacticalChoice, 'the managed fixture stops at the tactical gate');
    const tactical = app.columnModel().fixture;
    assert.equal(tactical.state, 'tactical');
    assert.deepEqual(tactical.actions, { preview: true, simulate: true });
    assert.deepEqual(tactical.headline, { a: app.state.teams['250'].name, b: app.state.teams['276'].name });
    assert.ok(tactical.odds, 'odds bar at the tactical gate');
    assert.match(tactical.meta, /^Strength \d+\.\d v \d+\.\d · from 512 simulated matches$/);
    assert.equal(app.state.tacticalPreview, false, 'the dialog no longer opens by itself (DEC D10)');
    assert.equal(app.rng.getState(), rng, 'column models never touch the campaign RNG');

    const columnEl = findElement(app.render(), 'CampaignColumn');
    assert.equal(columnEl.props.fixture.state, 'tactical');
    columnEl.props.onPreview();
    assert.equal(app.state.tacticalPreview, true, 'Match preview opens the TacticalChoice dialog');
    app.closeMatchPreview();
    findElement(app.render(), 'CampaignColumn').props.onSimulate();
    assert.equal(app.state.tacticalChoice, null);
    assert.equal(app.state.match?.instant, true, 'or simulate the result = instant reveal of this match');
    assert.ok(['live', 'done'].includes(app.columnModel().fixture.state));
  } finally { f.close(); }
});

test('live then done: the matchCard slot, latest results and ticker follow the match and history', () => {
  const f = syncAppFixture({ role: 'manager' });
  try {
    const app = f.app;
    app.startMatch('276', '826'); // the managed side (250) is not involved: no tactical gate
    assert.ok(app.state.match && !app.state.tacticalChoice);
    const live = app.columnModel().fixture;
    assert.equal(live.state, 'live');
    assert.equal(live.kicker, 'Live match');
    let columnEl = findElement(app.render(), 'CampaignColumn');
    assert.equal(columnEl.props.fixture.state, 'live');
    assert.ok(columnEl.props.matchCard, 'App passes the compact MatchCard while the match exists');

    forceResult(app, '276', { aId: '276', dId: '826' });
    app.finishMatch();
    assert.ok(app.state.match.applied, 'an AI conquest applies at once');
    const done = app.columnModel();
    assert.equal(done.fixture.state, 'done');
    assert.equal(done.fixture.kicker, 'Result');
    assert.ok(done.fixture.next, 'the done state says what comes next');
    assert.equal(done.results.rows.length, 1);
    assert.equal(done.results.rows[0].title, `${app.state.teams['276'].name} beat ${app.state.teams['826'].name}`);
    const ticker = app.tickerModel();
    assert.equal(ticker.items.length, 1);
    assert.match(ticker.items[0].text, new RegExp(`· ${app.state.teams['826'].name} out$`));

    const tree = app.render();
    columnEl = findElement(tree, 'CampaignColumn');
    assert.equal(columnEl.props.fixture.state, 'done');
    assert.ok(columnEl.props.matchCard, 'the slot stays after the match is applied');
    assert.equal(findElement(tree, 'Ticker').props.items.length, 1);
  } finally { f.close(); }
});

test('title card: your turn while a target is pending; overlays empty on the conquest screen and hidden map views', () => {
  const f = syncAppFixture({ role: 'manager' });
  try {
    const app = f.app;
    app.state = { ...app.state, pendingTarget: { attackerId: '250', optionIds: ['276', '826'], selectedId: '276', round: 1,
      openedAt: 0, resumeAutoplay: false, turn: null } };
    const { titleCard, mapKey } = app.mapOverlaysModel();
    assert.equal(titleCard.variant, 'your-turn');
    assert.equal(titleCard.title, 'Your turn');
    assert.equal(mapKey.variant, 'reach');
    const column = app.columnModel();
    assert.equal(column.fronts, null, 'the target panel replaces the fronts');
    assert.equal(column.fixture.idleTitle, `${app.state.teams['250'].name} to attack`);
    assert.equal(column.fixture.route, 'You choose the target');
    assert.equal(app.idleText(), 'You choose the target');

    app.state = { ...app.state, pendingTarget: null, view: 'squad' };
    assert.deepEqual(app.mapOverlaysModel(), { titleCard: null, mapKey: null }, 'the map is hidden on Squad');
    app.state = { ...app.state, view: 'map', choice: { winnerName: 'A', loserName: 'B', candidates: [] } };
    assert.deepEqual(app.mapOverlaysModel(), { titleCard: null, mapKey: null }, 'conquest screen has no title card or key');
    app.state = { ...app.state, choice: null };
    assert.equal(app.mapOverlaysModel().titleCard.variant, 'campaign');
  } finally { f.close(); }
});

test('your turn without a land border: the title card and the target panel both say "target" (DEC D4)', () => {
  const f = syncAppFixture({ role: 'manager', settings: { turnOrder: 'round-robin', targeting: 'player' } });
  try {
    const app = f.app;
    // The tiny atlas has no adjacency: the managed empire reaches its rivals by sea only.
    const reach = reachableTargets(app.board(), '250');
    assert.ok(reach.length && reach.every(entry => entry.tier !== 'land'));
    assert.equal(app.openTargetChoice('250'), true);
    const count = app.targetPanelModel().count;
    assert.match(count, /^\d+ targets? in reach$/);
    const { titleCard } = app.mapOverlaysModel();
    assert.equal(titleCard.variant, 'your-turn');
    assert.equal(titleCard.sub, 'Pick a target to attack. Everyone else’s targets come from the compass.');
    assert.equal(findElement(app.render(), 'MapOverlays').props.titleCard.sub, titleCard.sub);
  } finally { f.close(); }
});

test('map key: the followed empire swatch matches its map fill in every mode, or is the outline alone', () => {
  const f = syncAppFixture({ role: 'spectator' });
  try {
    const app = f.app;
    for (const mapMode of MODES) {
      app.state = { ...app.state, followedId: '250', mapMode };
      const you = app.mapOverlaysModel().mapKey.items.find(item => item.key === 'you');
      assert.equal(you.label, 'Followed empire', mapMode);
      const fill = app.mapCountries().countries.find(country => country.id === '250').fill;
      if (mapMode === 'political') assert.equal(you.color, fill, 'political: the pastel the map paints');
      else {
        if (mapMode !== 'flags') assert.notEqual(fill, empireFill('250'), `${mapMode}: the map does not paint the pastel`);
        assert.equal(you.color, null, `${mapMode}: so the key shows the outline alone`);
      }
      assert.deepEqual(you.ring, { color: 'var(--ink)', width: 1.4 });
    }
  } finally { f.close(); }
});

test('clubs layer: the fronts table heads its name column "Club"', () => {
  const f = syncAppFixture({ role: 'manager', settings: { layer: 'clubs' } });
  try {
    const app = f.app;
    app.state = { ...app.state, teams: Object.fromEntries(Object.entries(app.state.teams)
      .map(([id, team]) => [id, { ...team, kind: 'club', flagId: null }])) };
    const { fronts } = app.columnModel();
    assert.equal(fronts.nameHeading, 'Club');
    assert.ok(fronts.rows.length && fronts.rows.every(row => row.isClub));
    assert.equal(findElement(app.render(), 'CampaignColumn').props.fronts.nameHeading, 'Club');
  } finally { f.close(); }
  const nations = syncAppFixture({ role: 'manager' });
  try { assert.equal(nations.app.columnModel().fronts.nameHeading, 'Nation'); } finally { nations.close(); }
});

test('phone sheet: togglePhoneSheet flips the column sheet (DEC D22)', () => {
  const f = syncAppFixture({ role: 'spectator' });
  try {
    assert.equal(f.app.columnModel().sheet, 'collapsed');
    findElement(f.app.render(), 'CampaignColumn').props.onToggleSheet();
    assert.equal(f.app.state.phoneSheet, 'expanded');
    assert.equal(f.app.columnModel().sheet, 'expanded');
    f.app.togglePhoneSheet();
    assert.equal(f.app.columnModel().sheet, 'collapsed');
  } finally { f.close(); }
});

test('render purity: the column delegates schedule nothing and never move the campaign RNG', () => {
  for (const role of ['spectator', 'manager']) {
    const f = syncAppFixture({ role });
    try {
      const app = f.app;
      app.startMatch('276', '826');
      const rng = app.rng.getState();
      const pending = f.time.pending.size, tasks = app.timers.size;
      const match = app.state.match;
      for (let i = 0; i < 3; i++) { columnDelegates(app); app.render(); }
      assert.equal(app.rng.getState(), rng, role);
      assert.equal(f.time.pending.size, pending, `${role}: no timers`);
      assert.equal(app.timers.size, tasks, `${role}: no clock tasks`);
      assert.equal(app.state.match, match, `${role}: state.match untouched`);
    } finally { f.close(); }
  }
});
