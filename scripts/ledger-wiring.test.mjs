// Owner: WP-LEDGER (wiring pass). App ↔ src/app/ledgerMethods.jsx: the Ledger and Chronicle screens and the Victory
// dialog get real models from the running App (PLAN §3.3, §3.5, §4.9; DEC D16), the HEAD powerTable / victoryPanel
// contracts stay intact (smoke standingsSnapshot, campaign-experience recap), and the delegates are render-pure
// (no timers, no campaign RNG, no setState while building) and empty outside a running campaign (PLAN §0.9).
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { bundleApp, bundleComponents, syncAppFixture, findElement } from './lib/app-harness.mjs';
import { teamEff } from '../src/data/teams.js';

await bundleApp();
// `matchPreviewModel` has no App delegate until WP-INT applies APP-CHANGES.md (WP-LEDGER); call the module body
// on the App instance until then (the body only uses `this.state` / `this.viewContext()`).
const ledgerM = await bundleComponents({ matchPreviewModel: ['src/app/ledgerMethods.jsx', 'matchPreviewModel'] });
const previewOf = app => (typeof app.matchPreviewModel === 'function' ? app.matchPreviewModel() : ledgerM.matchPreviewModel.call(app));

const HEAD_ROW_KEYS = ['tid', 'rank', 'eff', 'territories', 'effGain', 'name', 'code', 'flagId', 'isClub', 'color'];
const RECAP_KEYS = ['biggestUpset', 'decisiveMatch', 'transferImpact', 'Leader changes', 'Acquisitions improving the lineup',
  'Elapsed time', 'Active viewing', 'Time choosing', 'Skipped presentations'];

/** Calls `fn` and asserts it scheduled nothing, moved no campaign RNG and called no setState. */
function pure(f, fn, label) {
  const rng = f.app.rng.getState();
  const pending = f.time.pending.size;
  const tasks = f.app.clock.tasks.size;
  const setState = f.app.setState;
  let writes = 0;
  f.app.setState = function (...args) { writes++; return setState.apply(this, args); };
  try {
    return fn();
  } finally {
    f.app.setState = setState;
    assert.equal(f.app.rng.getState(), rng, `${label}: campaign RNG untouched`);
    assert.equal(f.time.pending.size, pending, `${label}: no timers`);
    assert.equal(f.app.clock.tasks.size, tasks, `${label}: no playback tasks`);
    assert.equal(writes, 0, `${label}: no setState`);
  }
}

function historyEntry(app, winnerId, loserId, extra = {}) {
  const teams = app.state.teams;
  const side = (id, score) => ({ teamId: id, id: teams[id].flagId, isClub: false, code: teams[id].code, color: teams[id].col,
    name: teams[id].name, eff: teamEff(teams[id]).toFixed(1), score });
  return {
    id: `m-${winnerId}-${loserId}`, round: '001', aId: winnerId, dId: loserId, a: side(winnerId, 1), b: side(loserId, 0),
    winnerName: teams[winnerId].name, upsetGap: 0, events: [],
    result: { title: `${teams[winnerId].name} takes ${teams[loserId].name}`, winnerId, loserId, winnerName: teams[winnerId].name,
      loserName: teams[loserId].name, upset: false, territories: 1, strengthGain: 0 },
    ...extra,
  };
}

test('loading and setup: the ledger delegates return their empty values without throwing', () => {
  for (const phase of ['loading', 'setup']) {
    const f = syncAppFixture({ phase });
    try {
      pure(f, () => {
        assert.deepEqual(f.app.powerTable(false), [], phase);
        assert.deepEqual(f.app.powerTable(phase !== 'loading'), [], `${phase}: no teams`);
        const ledger = f.app.ledgerModel();
        assert.deepEqual(ledger.rows, [], phase);
        assert.deepEqual(ledger.fallen, [], phase);
        assert.equal(ledger.session, null, phase);
        const chronicle = f.app.chronicleModel();
        assert.deepEqual(chronicle.history, [], phase);
        assert.deepEqual(chronicle.feed, [], phase);
        assert.deepEqual(chronicle.historyTeams, [], phase);
        assert.equal(previewOf(f.app), null, phase);
        assert.equal(f.app.victoryPanel(), null, phase);
      }, phase);
    } finally { f.close(); }
  }
});

test('powerTable keeps every HEAD key, ranks by strength and adds teamId / conq / claimed (stats {} tolerated)', () => {
  const f = syncAppFixture({ ids: ['250', '276', '826'] });
  try {
    f.app.setState({ stats: { '250': { conq: 2, steals: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] } } });
    const rows = pure(f, () => f.app.powerTable(true), 'powerTable');
    const { teams } = f.app.state;
    const expected = f.app.state.aliveIds.slice().sort((a, b) => teamEff(teams[b]) - teamEff(teams[a])
      || teams[a].name.localeCompare(teams[b].name) || a.localeCompare(b));
    assert.deepEqual(rows.map(row => row.tid), expected);
    rows.forEach((row, i) => {
      for (const key of HEAD_ROW_KEYS) assert.ok(key in row, `row keeps ${key}`);
      assert.equal(row.rank, i + 1);
      assert.equal(row.eff, teamEff(teams[row.tid]).toFixed(1));
      assert.equal(row.territories, '1');
      assert.equal(row.teamId, row.tid);
    });
    const france = rows.find(row => row.tid === '250');
    assert.equal(france.conq, '2');
    assert.equal(france.claimed, '3');
    assert.equal(rows.find(row => row.tid === '276').conq, '0', 'missing stats entry → 0');
    assert.equal(rows.find(row => row.tid === '276').claimed, '0');
    assert.deepEqual(f.app.powerTable(false), []);
  } finally { f.close(); }
});

test('manager ledger: standings, fallen empire with its conqueror, session, share and header reach LedgerScreen', () => {
  const f = syncAppFixture({ ids: ['250', '276', '826'], role: 'manager' });
  try {
    const entry = historyEntry(f.app, '250', '826');
    f.app.setState({
      aliveIds: ['250', '276'], own: { '250': '250', '276': '276', '826': '250' }, fallen: [{ id: '826', r: 1 }],
      history: [entry], matches: 1, round: 1,
      stats: { '250': { conq: 1, steals: [{ name: 'p' }] }, '276': { conq: 0, steals: [] } },
    });
    const model = pure(f, () => f.app.ledgerModel(), 'ledgerModel');
    assert.equal(model.rows.length, 2);
    const you = model.rows.find(row => row.tid === '250');
    for (const key of HEAD_ROW_KEYS) assert.ok(key in you, `ledger row keeps ${key}`);
    assert.equal(you.you, true, 'the managed team is marked');
    assert.equal(you.conq, '1');
    assert.equal(you.claimed, '1');
    assert.equal(you.territories, '2');
    assert.ok(you.delta && typeof you.delta.text === 'string');
    assert.equal(model.youLabel, 'You');
    assert.equal(model.fallen.length, 1);
    assert.equal(model.fallen[0].teamId, '826');
    assert.equal(model.fallen[0].byName, f.app.state.teams['250'].name);
    assert.equal(model.fallen[0].line, `Round I · to ${f.app.state.teams['250'].name}`);
    assert.match(model.session, /^1 game remaining · ~1 min$/);
    assert.equal(model.header.title, 'Ledger');
    assert.equal(model.header.kicker, 'The European Campaign · Round II');
    assert.deepEqual(model.header.stats.map(stat => [stat.key, stat.value]), [['remain', '2'], ['fallen', '1'], ['matches', '1']]);
    assert.equal(model.share.total, 3);
    assert.equal(model.share.rows[0].teamId, '250');

    f.app.setView('ledger');
    const tree = pure(f, () => f.app.render(), 'render ledger');
    const screen = findElement(tree, 'LedgerScreen');
    assert.ok(screen, 'LedgerScreen is rendered in the ledger view');
    assert.equal(screen.props.header.title, 'Ledger');
    assert.equal(screen.props.rows.length, 2);
    assert.equal(screen.props.fallen.length, 1);
    const html = renderToStaticMarkup(screen);
    assert.equal((html.match(/<table class="fi-standings"/g) || []).length, 1, 'exactly one standings table');
    assert.equal((html.match(/class="fi-standing-team"/g) || []).length, 2, 'every alive team');
    assert.match(html, /data-testid="session-remaining"[^>]*>1 game remaining · ~1 min</);
    assert.match(html, /ledger-fallen/);
    assert.match(html, />Ledger</);
  } finally { f.close(); }
});

test('spectator ledger follows the followed team; paused session line', () => {
  const f = syncAppFixture({ ids: ['250', '276', '826'] });
  try {
    f.app.setState({ followedId: '276', paused: true });
    const model = f.app.ledgerModel();
    assert.equal(model.youLabel, 'Following');
    assert.equal(model.rows.find(row => row.tid === '276').you, true);
    assert.equal(model.rows.find(row => row.tid === '250').you, false);
    assert.match(model.session, / · Paused$/);
  } finally { f.close(); }
});

test('chronicle: history, alphabetical team filter, newest-first feed and header reach ChronicleScreen', () => {
  const f = syncAppFixture({ ids: ['250', '276', '826'], role: 'manager' });
  try {
    const entry = historyEntry(f.app, '250', '826', { upsetGap: 2.5, result: { ...historyEntry(f.app, '250', '826').result, upset: true } });
    f.app.setState({
      history: [entry],
      log: [{ t: 'sys', r: 0, txt: 'CAMPAIGN START' }, { t: 'win', r: 1, txt: 'FRANCE TAKES UNITED KINGDOM' }],
    });
    const model = pure(f, () => f.app.chronicleModel(), 'chronicleModel');
    assert.equal(model.history.length, 1);
    const names = model.historyTeams.map(team => team.name);
    assert.deepEqual(names, names.slice().sort((a, b) => a.localeCompare(b)), 'team filter is alphabetical');
    assert.equal(model.historyTeams.length, 3);
    assert.deepEqual(model.feed.map(item => [item.key, item.roman, item.text]),
      [['log-1', 'I', 'FRANCE TAKES UNITED KINGDOM'], ['log-0', '', 'CAMPAIGN START']]);
    assert.equal(model.managedId, '250');
    assert.equal(model.header.title, 'Chronicle');
    assert.equal(model.header.kicker, 'The European Campaign · seed 728491');
    assert.deepEqual(model.header.stats.map(stat => [stat.key, stat.value]), [['matches', '1'], ['upsets', '1'], ['signings', '0']]);
    assert.ok(model.turning.some(point => point.label === 'Biggest upset'));

    // The render tree passes the model plus the App-owned selection/filter props.
    f.app.setState({ history: [], selectedHistoryId: null });
    f.app.setView('chronicle');
    const tree = pure(f, () => f.app.render(), 'render chronicle');
    const screen = findElement(tree, 'ChronicleScreen');
    assert.ok(screen, 'ChronicleScreen is rendered in the chronicle view');
    assert.equal(screen.props.header.title, 'Chronicle');
    assert.equal(screen.props.feed.length, 2);
    const html = renderToStaticMarkup(screen);
    assert.match(html, /id="view-panel-chronicle"/);
    assert.match(html, /id="history-team"/);
  } finally { f.close(); }
});

test('the vm cache memoises the chronicle feed and fallen list across renders', () => {
  const f = syncAppFixture({ ids: ['250', '276', '826'] });
  try {
    f.app.setState({ log: [{ t: 'sys', r: 0, txt: 'START' }] });
    const first = f.app.chronicleModel();
    const second = f.app.chronicleModel();
    assert.equal(first.feed, second.feed, 'same feed identity while st.log is unchanged');
    assert.equal(first.historyTeams, second.historyTeams);
    assert.equal(f.app.ledgerModel().fallen, f.app.ledgerModel().fallen);
    f.app.setState({ log: [...f.app.state.log, { t: 'sys', r: 1, txt: 'NEXT' }] });
    assert.notEqual(f.app.chronicleModel().feed, first.feed, 'a new log rebuilds the feed');
  } finally { f.close(); }
});

test('match preview model frames the pending tactical gate from the manager side', () => {
  const f = syncAppFixture({ ids: ['250', '276', '826'], role: 'manager' });
  try {
    assert.equal(previewOf(f.app), null, 'no gate → null');
    f.app.startMatch('250', '276');
    assert.ok(f.app.state.tacticalChoice, 'the managed fixture opens the tactical gate');
    const preview = pure(f, () => previewOf(f.app), 'matchPreviewModel');
    assert.equal(preview.a.teamId, '250');
    assert.equal(preview.b.teamId, '276');
    assert.equal(preview.a.role, 'Attack');
    assert.equal(preview.a.you, true);
    assert.ok(preview.stakes?.win && preview.stakes?.lose);
    assert.equal(preview.lineupLabel, 'Starting XI');
    assert.ok(preview.odds?.aLabel.startsWith(f.app.state.teams['250'].code));
    assert.match(preview.kicker, /^Round [IVXLC]+ · Fixture$/);
    // startMatch(a, d) with no route (blitz / chaos): the board decides, as in the Next fixture block. The tiny atlas
    // has no land adjacency, so both read "By sea".
    assert.deepEqual(f.app.state.tacticalChoice.route, {});
    assert.equal(preview.route, 'By sea — no shared border');
    assert.equal(f.app.columnModel().fixture.route, preview.route, 'preview and Next fixture block agree');
  } finally { f.close(); }
});

test('victoryPanel keeps every HEAD and recap key and adds a Chronicle exit that VictoryOverlay receives', () => {
  const f = syncAppFixture({ ids: ['250', '276', '826'] });
  try {
    f.app.setState({ phase: 'victory', aliveIds: ['250'], own: { '250': '250', '276': '250', '826': '250' },
      history: [historyEntry(f.app, '250', '276')], matches: 2, round: 2, completedAt: 1_000_000, startedAt: 1_000_000 - 180_000 });
    const panel = pure(f, () => f.app.victoryPanel(), 'victoryPanel');
    for (const key of ['id', 'code', 'isClub', 'round', 'name', 'color', 'subtitle', 'conquests', 'steals', 'territories',
      'effNow', 'effBase', 'effGain', 'squad', 'recap', 'seed']) assert.ok(key in panel, `victory keeps ${key}`);
    assert.deepEqual(Object.keys(panel.recap), RECAP_KEYS);
    assert.equal(panel.recap['Elapsed time'], '3 min');
    assert.equal(panel.recap.biggestUpset, 'No upsets recorded', 'the Chronicle\'s upset definition (result.upset)');
    assert.equal(panel.name, f.app.state.teams['250'].name.toUpperCase());
    assert.equal(panel.territories, '3');
    assert.equal(panel.round, '002');
    assert.equal(typeof panel.onChronicle, 'function');

    const tree = pure(f, () => f.app.render(), 'render victory');
    const overlay = findElement(tree, 'VictoryOverlay');
    assert.ok(overlay, 'VictoryOverlay is rendered in the victory phase');
    assert.equal(typeof overlay.props.onChronicle, 'function', 'render spreads onChronicle into VictoryOverlay');
    assert.deepEqual(Object.keys(overlay.props.recap), RECAP_KEYS);

    overlay.props.onChronicle();
    assert.equal(f.app.state.phase, 'playing');
    assert.equal(f.app.state.view, 'chronicle');
    assert.equal(f.app.currentView(), 'chronicle');
    assert.ok(findElement(f.app.render(), 'ChronicleScreen'), 'the Chronicle opens after the results close');
  } finally { f.close(); }
});
