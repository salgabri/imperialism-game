// Owner: WP-COL (see PLAN.md §5.2). Campaign column (Next fixture / Your fronts / Latest results), ticker, map
// caption and key: view-models (pure builders) and components (jsdom).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { buildTeam, makeRng, teamEff } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { empireFill, MAP } from '../src/theme.js';
import { formatWinChance, winTone } from '../src/viewModels/format.js';
import { matchupOdds } from '../src/viewModels/odds.js';
import { buildTargetPanel, idleTurnCopy } from '../src/viewModels/turns.js';
import { strengthSteps } from '../src/viewModels/map.js';
import { empireNeighbors } from '../src/engine/campaign.js';
import { reachableTargets } from '../src/engine/turns.js';
import {
  buildColumn, buildFixture, buildFronts, buildLatestResults, buildMapOverlays, buildTicker,
} from '../src/viewModels/campaign.js';

// ---------- component bundle (classic JSX, CSS empty — the visual-polish/ui-interaction harness) ----------
const compiled = await build({
  stdin: { contents: `
    export {default as CampaignColumn} from './src/screens/campaign/CampaignColumn.jsx';
    export {default as NextFixture} from './src/screens/campaign/NextFixture.jsx';
    export {default as FrontsTable} from './src/screens/campaign/FrontsTable.jsx';
    export {default as LatestResults} from './src/screens/campaign/LatestResults.jsx';
    export {default as Ticker} from './src/screens/campaign/Ticker.jsx';
    export {default as MapOverlays} from './src/screens/campaign/MapOverlays.jsx';
  `, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
  loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
});
const bundled = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
const { CampaignColumn, NextFixture, FrontsTable, LatestResults, Ticker, MapOverlays } = bundled.exports;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
after(() => dom.window.close());

/** Mount and fail on any React console error/warning (keys, unknown DOM props, bad children). */
async function mount(Component, props, context) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const view = {
    host,
    async render(nextProps) {
      const noise = [];
      const original = { error: console.error, warn: console.warn };
      console.error = (...args) => noise.push(args.join(' '));
      console.warn = (...args) => noise.push(args.join(' '));
      try {
        await act(async () => root.render(React.createElement(Component, nextProps)));
      } finally {
        console.error = original.error;
        console.warn = original.warn;
      }
      assert.deepEqual(noise, [], 'renders without console noise');
    },
    async close() { await act(async () => root.unmount()); host.remove(); },
  };
  context.after(() => view.close());
  await view.render(props);
  return view;
}
const text = node => node?.textContent ?? null;
const click = async node => act(async () => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));

// ---------- fixtures ----------
const football = getSport('football');
const teamRng = makeRng(2033);
const IDS = ['380', '688', '040', '348', '250', '276'];   // Italy, Serbia, Austria, Hungary, France, Germany
const TEAMS = Object.fromEntries(IDS.map(id => [id, buildTeam(id, teamRng, football)]));
const OWN = { 380: '380', '070': '380', 688: '688', '040': '040', 348: '348', 191: '348', 250: '250', 276: '276' };
const ADJ = {
  380: ['040', '250'], '070': ['688', '191'], 688: ['070', '348'], '040': ['380', '276', '348'],
  348: ['040', '688', '191'], 191: ['070', '348'], 250: ['380', '276'], 276: ['250', '040'],
};

function state(extra = {}) {
  return {
    phase: 'playing', teams: TEAMS, own: OWN, aliveIds: IDS.slice(), round: 0, matches: 0, seed: '2026',
    settings: { sport: 'football', layer: 'nations', scope: 'UEFA', pacing: 'duel', resolution: 'ticker', role: 'manager',
      turnOrder: 'random', targeting: 'compass' },
    match: null, spin: null, tacticalChoice: null, pendingTarget: null, choice: null, queue: [], series: null,
    history: [], stats: {}, mapMode: 'political', wholeMap: false, phoneSheet: 'collapsed', followedId: null,
    ...extra,
  };
}
function context(st, extra = {}) {
  const board = { geo: { adj: ADJ, paths: {} }, routingPaths: {}, own: st.own, aliveIds: st.aliveIds };
  return { board, geo: board.geo, sport: football, managedId: '380', followedId: null, drama: 6, cache: new Map(),
    totalTeams: Object.keys(st.teams).length, ...extra };
}
const LAND = [{ tid: '040', tier: 'land' }, { tid: '250', tier: 'land' }, { tid: '688', tier: 'land' }, { tid: '348', tier: 'land' }];
/** A placed board (territory centroids, no coastline rings): every direct route is legal. `adj: {}` = no land border. */
const XY = { 380: [10, 20], '070': [14, 18], 688: [18, 16], '040': [12, 10], 348: [17, 10], 191: [15, 14], 250: [4, 10], 276: [8, 4] };
const PLACED_PATHS = Object.fromEntries(Object.entries(XY).map(([id, [cx, cy]]) => [id, { cx, cy }]));
const placedBoard = (st, adj = ADJ) => ({ geo: { paths: PLACED_PATHS, adj }, own: st.own, aliveIds: st.aliveIds });
const spinOf = (stage, extra = {}) => ({ attackerId: '688', targetId: '380', stage, isNeighbor: true, routeKind: 'straight',
  routeLabel: 'Direct challenge', key: 1, tid: '688', ...extra });

// =====================================================================================================
// buildFixture — every DEC D10 state
// =====================================================================================================

test('idle fixture uses the turn copy (random and round robin), no odds and no actions', () => {
  const st = state();
  const ctx = context(st);
  const fixture = buildFixture(st, ctx);
  const copy = idleTurnCopy(st, ctx);
  assert.equal(fixture.state, 'idle');
  assert.equal(fixture.kicker, 'Next fixture');
  assert.equal(fixture.kickerRight, 'Round I');
  assert.equal(fixture.idleTitle, copy.title);
  assert.equal(fixture.route, copy.route);
  assert.equal(fixture.headline, null);
  assert.equal(fixture.odds, null);
  assert.equal(fixture.meta, null);
  assert.deepEqual(fixture.actions, { preview: false, simulate: false });

  const rr = state({ round: 4, settings: { ...state().settings, turnOrder: 'round-robin', targeting: 'player' },
    turnQueue: ['250', '380', '276'], turnIndex: 1 });
  const rrCtx = context(rr);
  const rrFixture = buildFixture(rr, rrCtx);
  const rrCopy = idleTurnCopy(rr, rrCtx);
  assert.equal(rrFixture.state, 'idle');
  assert.equal(rrFixture.idleTitle, rrCopy.title);
  assert.equal(rrFixture.route, rrCopy.route);
  assert.equal(rrFixture.odds, null);
});

test('idle fixture copy is the literal DEC D10 text for every turn order × targeting', () => {
  const idleOf = (settings, extra = {}, ctxExtra = {}) => {
    const st = state({ settings: { ...state().settings, ...settings }, ...extra });
    const fixture = buildFixture(st, context(st, ctxExtra));
    assert.equal(fixture.state, 'idle');
    assert.equal(fixture.headline, null);
    assert.equal(fixture.odds, null);
    assert.equal(fixture.meta, null);
    return [fixture.idleTitle, fixture.route];
  };
  // Random draw: compass and You choose read the same before the draw.
  assert.deepEqual(idleOf({ turnOrder: 'random', targeting: 'compass' }), ['Next draw', 'Any of 6 empires can be drawn']);
  assert.deepEqual(idleOf({ turnOrder: 'random', targeting: 'player' }), ['Next draw', 'Any of 6 empires can be drawn']);
  assert.deepEqual(idleOf({ turnOrder: 'random', targeting: 'compass' }, { aliveIds: ['380', '688', '040'] }),
    ['Next draw', 'Any of 3 empires can be drawn']);
  // Round robin: the next attacker by name; the route line says who picks the target.
  const rr = { round: 4, turnQueue: ['250', '380', '276'] };
  assert.deepEqual(idleOf({ turnOrder: 'round-robin', targeting: 'compass' }, { ...rr, turnIndex: 0 }),
    ['France to attack', 'Compass decides the target']);
  assert.deepEqual(idleOf({ turnOrder: 'round-robin', targeting: 'compass' }, { ...rr, turnIndex: 1 }),
    ['Italy to attack', 'Compass decides the target']);
  assert.deepEqual(idleOf({ turnOrder: 'round-robin', targeting: 'player' }, { ...rr, turnIndex: 1 }),
    ['Italy to attack', 'You choose the target']);
  assert.deepEqual(idleOf({ turnOrder: 'round-robin', targeting: 'player' }, { ...rr, turnIndex: 0 }),
    ['France to attack', 'Compass decides the target']);
});

test('drawing fixture keeps the spin result hidden until the needle locks (DEC D19)', () => {
  for (const stage of ['ready', 'spinning']) {
    const st = state({ round: 3, spin: spinOf(stage) });
    const ctx = context(st);
    const fixture = buildFixture(st, ctx);
    assert.equal(fixture.state, 'drawing');
    assert.equal(fixture.kicker, 'Next fixture');
    assert.equal(fixture.kickerRight, 'Round III');
    assert.equal(fixture.idleTitle, 'Serbia to attack');
    assert.equal(fixture.route, 'The compass is choosing the target');
    assert.equal(fixture.headline, null);
    assert.equal(fixture.odds, null);
    assert.equal(fixture.meta, null);
    assert.deepEqual(fixture.actions, { preview: false, simulate: false });
    // While spinning, the drawn attacker's fronts row keeps Italy's own estimate (not the fixture's odds).
    const fronts = buildFronts(st, ctx, { reach: LAND });
    const serbia = fronts.rows.find(row => row.teamId === '688');
    assert.equal(serbia.win, formatWinChance(matchupOdds(st, ctx, '380', '688').attacker));
  }
  const locked = state({ round: 3, spin: spinOf('locked') });
  const lockedCtx = context(locked);
  assert.equal(`${buildFronts(locked, lockedCtx, { reach: LAND }).rows.find(row => row.teamId === '688').win} ITA`,
    buildFixture(locked, lockedCtx).odds.bLabel, 'from the locked spin the fronts row agrees with the fixture block');
});

test('locked fixture shows A v B, the route, the odds bar and the sample count', () => {
  const st = state({ round: 3, spin: spinOf('locked') });
  const ctx = context(st);
  const fixture = buildFixture(st, ctx);
  const odds = matchupOdds(st, ctx, '688', '380');
  assert.equal(fixture.state, 'locked');
  assert.equal(fixture.kickerRight, 'Round III');
  assert.deepEqual(fixture.headline, { a: 'Serbia', b: 'Italy' });
  assert.equal(fixture.route, 'Across a land border');
  assert.equal(fixture.odds.aLabel, `SRB ${formatWinChance(odds.attacker)}`);
  assert.equal(fixture.odds.bLabel, `${formatWinChance(odds.defender)} ITA`);
  assert.equal(fixture.odds.fill, Math.round(odds.attacker * 1000) / 10);
  assert.equal(fixture.odds.aria, `Serbia ${formatWinChance(odds.attacker)}, Italy ${formatWinChance(odds.defender)}`);
  assert.equal(fixture.meta, `Strength ${odds.effA.toFixed(1)} v ${odds.effD.toFixed(1)} · from ${odds.samples} simulated matches`);
  assert.match(fixture.meta, /from 512 simulated matches$/);
  assert.deepEqual(fixture.actions, { preview: false, simulate: false });
  const sea = buildFixture(state({ round: 3, spin: spinOf('locked', { isNeighbor: false, routeKind: 'sea' }) }), context(state()));
  assert.equal(sea.route, 'By sea — no shared border');
  const transit = buildFixture(state({ round: 3, spin: spinOf('locked', { isNeighbor: false, routeKind: 'neutral-transit' }) }), context(state()));
  assert.equal(transit.route, 'Through neutral land — transit treaty');
});

test('tactical gate offers Match preview and simulate with the balanced pre-match odds', () => {
  const st = state({ round: 7, tacticalChoice: { aId: '688', dId: '380', route: { isNeighbor: true, routeKind: 'straight' },
    options: [], managerName: 'Italy', opponentName: 'Serbia' } });
  const ctx = context(st);
  const fixture = buildFixture(st, ctx);
  const odds = matchupOdds(st, ctx, '688', '380', { tactic: 'balanced' });
  assert.equal(fixture.state, 'tactical');
  assert.equal(fixture.kickerRight, 'Round VII');
  assert.deepEqual(fixture.headline, { a: 'Serbia', b: 'Italy' });
  assert.deepEqual(fixture.actions, { preview: true, simulate: true });
  assert.equal(fixture.odds.fill, Math.round(odds.attacker * 1000) / 10);
  assert.equal(fixture.meta, `Strength ${odds.effA.toFixed(1)} v ${odds.effD.toFixed(1)} · from 512 simulated matches`);

  // The fronts row of the fixture opponent reuses the fixture's odds for the managed side (Italy defends).
  const fronts = buildFronts(st, ctx, { reach: LAND });
  const serbia = fronts.rows.find(row => row.teamId === '688');
  assert.equal(`${serbia.win} ITA`, fixture.odds.bLabel);
  assert.equal(serbia.tone, winTone(Number(serbia.win.replace(/[<>%]/g, '')) / 100));
});

test('odds pairs always read 100%: the attacker is rounded once, the defender shows the rest (k/512 halves)', () => {
  // Every 512-sample estimate: formatWinChance on each side alone gave 101% at k = 64, 192, 320, 448.
  for (let k = 0; k <= 512; k++) {
    const pA = k / 512;
    const st = state({ round: 9, match: { aId: '688', dId: '380', applied: false, done: false, odds: { a: pA, b: 1 - pA },
      effA: 80, effD: 82, routeKind: 'straight' } });
    const { odds } = buildFixture(st, context(st));
    const a = odds.aLabel.replace('SRB ', ''), b = odds.bLabel.replace(' ITA', '');
    assert.equal(a, formatWinChance(pA), `k=${k}: the attacker side is formatWinChance`);
    if (a === '<1%') assert.equal(b, '>99%', `k=${k}`);
    else if (a === '>99%') assert.equal(b, '<1%', `k=${k}`);
    else assert.equal(Number(a.slice(0, -1)) + Number(b.slice(0, -1)), 100, `k=${k}: ${a} / ${b}`);
    assert.equal(odds.aria, `Serbia ${a}, Italy ${b}`);
  }
  // p = 0.375: 'SRB 38%' [bar] '62% ITA', and the defending manager's fronts row reads the same 62%.
  const half = state({ round: 9, match: { aId: '688', dId: '380', applied: false, done: false, odds: { a: .375, b: .625 },
    effA: 80, effD: 82, routeKind: 'straight' } });
  const halfCtx = context(half);
  assert.deepEqual(buildFixture(half, halfCtx).odds, { aLabel: 'SRB 38%', bLabel: '62% ITA', fill: 37.5, aria: 'Serbia 38%, Italy 62%' });
  const serbia = buildFronts(half, halfCtx, { reach: LAND }).rows.find(row => row.teamId === '688');
  assert.deepEqual([serbia.win, serbia.tone], ['62%', 'gain']);
  // Attacking, the manager's row is the left-hand label.
  const attacking = state({ round: 9, match: { aId: '380', dId: '688', applied: false, done: false, odds: { a: .625, b: .375 },
    effA: 82, effD: 80, routeKind: 'straight' } });
  assert.equal(buildFronts(attacking, context(attacking), { reach: LAND }).rows.find(row => row.teamId === '688').win, '63%');
  // Edges stay symmetric.
  const edge = state({ round: 9, match: { aId: '688', dId: '380', applied: false, done: false, odds: { a: .004, b: .996 } } });
  const edgeCtx = context(edge);
  assert.deepEqual([buildFixture(edge, edgeCtx).odds.aLabel, buildFixture(edge, edgeCtx).odds.bLabel], ['SRB <1%', '>99% ITA']);
  assert.deepEqual(['win', 'tone'].map(key => buildFronts(edge, edgeCtx, { reach: LAND }).rows.find(row => row.teamId === '688')[key]),
    ['>99%', 'gain']);
});

test('live and done fixtures carry the match, and done says what comes next', () => {
  const live = { aId: '688', dId: '380', ga: 1, gd: 0, shown: [], applied: false, done: false,
    odds: { a: .37, b: .63 }, effA: 79.5, effD: 85, routeKind: 'straight' };
  const st = state({ round: 9, match: live });
  const ctx = context(st);
  const fixture = buildFixture(st, ctx);
  assert.equal(fixture.state, 'live');
  assert.equal(fixture.kicker, 'Live match');
  assert.equal(fixture.kickerRight, 'Round IX');
  assert.deepEqual(fixture.odds, { aLabel: 'SRB 37%', bLabel: '63% ITA', fill: 37, aria: 'Serbia 37%, Italy 63%' });
  assert.equal(fixture.route, 'Across a land border');
  assert.equal(fixture.next, null);
  const fronts = buildFronts(st, ctx, { reach: LAND });
  assert.equal(fronts.rows.find(row => row.teamId === '688').win, '63%');
  assert.equal(fronts.rows.find(row => row.teamId === '688').tone, 'gain');

  const doneSt = state({ round: 9, match: { ...live, applied: true, done: true } });
  const doneCtx = context(doneSt);
  const done = buildFixture(doneSt, doneCtx);
  assert.equal(done.state, 'done');
  assert.equal(done.kicker, 'Result');
  assert.equal(done.kickerRight, 'Round IX');
  assert.deepEqual(done.next, idleTurnCopy(doneSt, doneCtx));

  const queued = buildFixture(state({ round: 9, match: { ...live, applied: true, done: true }, queue: [['380', '040']] }), doneCtx);
  assert.deepEqual(queued.next, { title: 'Next match', route: 'Italy v Austria' });
  const finale = state({ round: 9, aliveIds: ['380', '688'], match: { ...live, applied: true, done: true },
    series: { teamIds: ['688', '380'], wins: { 688: 1, 380: 0 }, games: 1 } });
  assert.deepEqual(buildFixture(finale, context(finale)).next, { title: 'Finale game 2', route: 'Serbia v Italy' });
  // Campaign complete: the result stays (the matchCard slot is rendered), nothing comes next.
  const complete = state({ round: 9, aliveIds: ['380'], match: { ...live, applied: true, done: true } });
  const completeFixture = buildFixture(complete, context(complete));
  assert.equal(completeFixture.state, 'done');
  assert.equal(completeFixture.next, null);
});

test('matches without odds, routeKind, live or tactic (smoke injections) do not throw', () => {
  const bare = { aId: '250', dId: '276', ga: 0, gd: 0, shown: [], applied: false, done: false, effA: 86.7, effD: 85.5 };
  const st = state({ round: 2, match: bare, history: [{ id: 'match-1', round: '001', a: { name: 'France', code: 'FRA', score: 2 },
    b: { name: 'Germany', code: 'GER', score: 1 }, winnerId: '250', aId: '250', dId: '276' }] });
  const ctx = context(st);
  const fixture = buildFixture(st, ctx);
  assert.equal(fixture.state, 'live');
  assert.equal(fixture.odds, null);
  assert.equal(fixture.meta, 'Strength 86.7 v 85.5');
  assert.doesNotThrow(() => buildColumn(st, ctx));
  assert.doesNotThrow(() => buildMapOverlays(st, ctx));
  const results = buildLatestResults(st, ctx);
  assert.equal(results.rows[0].title, 'France beat Germany');
  assert.equal(results.rows[0].meta, 'FRA 2–1 GER');
  assert.equal(buildFixture(state({ match: { aId: '250', dId: '276' } }), ctx).meta, null);
});

test('loading and setup states (teams {}, board null) build empty models', () => {
  for (const phase of ['loading', 'setup']) {
    const st = { phase, teams: {}, own: {}, aliveIds: [], round: 0, history: [], stats: {}, settings: { pacing: 'duel' },
      match: null, spin: null };
    const ctx = { board: null, geo: null, sport: football, managedId: null, followedId: null, drama: 6, cache: new Map() };
    const column = buildColumn(st, ctx);
    assert.equal(column.role, 'spectator');
    assert.equal(column.fronts, null);
    assert.deepEqual(column.results, { rows: [] });
    assert.equal(column.fixture.state, 'idle');
    assert.deepEqual(buildMapOverlays(st, ctx), { titleCard: null, mapKey: null });
    assert.deepEqual(buildTicker(st, ctx), { items: [] });
    assert.equal(buildFronts(st, { ...ctx, managedId: '380' }), null);
  }
  assert.doesNotThrow(() => buildColumn(null, {}));
  assert.doesNotThrow(() => buildFixture(undefined));
});

// =====================================================================================================
// buildFronts — DEC D4 land tier (fallback to the reachable list), DEC D5 tones on the displayed integer
// =====================================================================================================

test('fronts list the land tier strongest first with territories and win chances', () => {
  const st = state({ round: 4 });
  const ctx = context(st);
  const reach = [...LAND, { tid: '276', tier: 'sea' }];   // a sea-tier rival is ignored while land rivals exist
  const fronts = buildFronts(st, ctx, { reach });
  const expected = ['040', '250', '688', '348'].sort((a, b) => teamEff(TEAMS[b]) - teamEff(TEAMS[a])
    || TEAMS[a].name.localeCompare(TEAMS[b].name));
  assert.deepEqual(fronts.rows.map(row => row.teamId), expected);
  assert.equal(fronts.note, null);
  assert.equal(fronts.empty, null);
  for (const row of fronts.rows) {
    const team = TEAMS[row.teamId];
    assert.equal(row.name, team.name);
    assert.equal(row.code, team.code);
    assert.equal(row.flagId, team.flagId);
    assert.equal(row.eff, teamEff(team).toFixed(1));
    assert.equal(row.terr, String(Object.values(OWN).filter(owner => owner === row.teamId).length));
    const p = matchupOdds(st, ctx, '380', row.teamId).attacker;
    assert.equal(row.win, formatWinChance(p));
    // DEC D5: the colour follows the displayed integer.
    const shown = Number(row.win.replace(/[<>%]/g, ''));
    assert.equal(row.tone, shown >= 60 ? 'gain' : shown >= 45 ? 'even' : 'loss');
  }
  assert.equal(buildFronts(st, ctx, { reach }), fronts, 'memoised on state identities');
  assert.equal(buildFronts(st, ctx, { reach, limit: 2 }).rows.length, 2);
  assert.equal(fronts.rows.find(row => row.teamId === '348').terr, '2');
});

test('fronts fall back to the reachable list, show an empty note, and stay off for spectators and target choice', () => {
  const st = state();
  const ctx = context(st);
  const sea = buildFronts(st, ctx, { reach: [{ tid: '276', tier: 'sea' }, { tid: '688', tier: 'fallback', routeKind: 'sea' }] });
  assert.deepEqual(sea.rows.map(row => row.teamId).sort(), ['276', '688']);
  assert.equal(sea.note, 'No land border · these rivals are reached by sea');
  // DEC D4 third tier: coastal sea routes and neutral transit treaties; the note names what is present.
  const treaty = buildFronts(st, ctx, { reach: [{ tid: '276', tier: 'fallback', routeKind: 'neutral-transit' }] });
  assert.equal(treaty.note, 'No land border · these rivals are reached by transit treaty');
  const mixed = buildFronts(st, ctx, { reach: [{ tid: '276', tier: 'fallback', routeKind: 'neutral-transit' },
    { tid: '688', tier: 'fallback', routeKind: 'sea' }] });
  assert.equal(mixed.note, 'No land border · these rivals are reached by sea or transit treaty');
  const none = buildFronts(st, ctx, { reach: [] });
  assert.deepEqual(none.rows, []);
  assert.equal(none.empty, 'No rival is within reach.');
  assert.equal(buildFronts(st, { ...ctx, managedId: null }, { reach: LAND }), null);
  assert.equal(buildFronts(state({ pendingTarget: { attackerId: '380', optionIds: ['040'], selectedId: '040' } }), ctx, { reach: LAND }), null);
  assert.equal(buildFronts(state({ aliveIds: IDS.filter(id => id !== '380') }), ctx, { reach: LAND }), null);
  // Without the seam, the real reachableTargets runs on the board; a board without geometry must not throw.
  assert.doesNotThrow(() => buildFronts(st, { ...ctx, cache: new Map() }));
  const column = buildColumn(state({ pendingTarget: { attackerId: '380', optionIds: ['040'], selectedId: '040' } }), ctx);
  assert.equal(column.fronts, null);
  assert.equal(column.fixture.idleTitle, 'Italy to attack');
  assert.equal(buildColumn(st, { ...ctx, managedId: null }).role, 'spectator');
  assert.equal(buildColumn(state({ phoneSheet: 'expanded' }), ctx).sheet, 'expanded');
});

test('fronts without the seam: the engine reachableTargets land tier is the empire neighbours (DEC D4)', () => {
  const st = state({ round: 4 });
  const board = placedBoard(st);
  const paths = PLACED_PATHS;
  const ctx = { ...context(st), board, geo: board.geo, cache: new Map() };
  const neighbours = [...empireNeighbors(board, '380')].sort();
  assert.deepEqual(neighbours, ['040', '250', '348', '688']);
  assert.deepEqual(reachableTargets(board, '380').filter(entry => entry.tier === 'land').map(entry => entry.tid).sort(), neighbours);
  const fronts = buildFronts(st, ctx);
  assert.deepEqual(fronts.rows.map(row => row.teamId).sort(), neighbours, 'Germany (no shared border) is left out');
  assert.equal(fronts.note, null);
  assert.equal(fronts.rows.find(row => row.teamId === '348').terr, '2');
  // No adjacency at all: the direct sea tier, every rival, with the sea note.
  const island = { ...board, geo: { paths, adj: {} } };
  const seaFronts = buildFronts(st, { ...ctx, board: island, geo: island.geo, cache: new Map() });
  assert.deepEqual(seaFronts.rows.map(row => row.teamId).sort(), ['040', '250', '276', '348', '688']);
  assert.equal(seaFronts.note, 'No land border · these rivals are reached by sea');
});

// =====================================================================================================
// Latest results and ticker (A§7, A§8, ED§4e.8–9)
// =====================================================================================================

const HISTORY = [
  { id: 'match-1', round: '005', aId: '203', dId: '276', winnerId: '276', winnerName: 'Germany',
    a: { teamId: '203', code: 'CZE', name: 'Czechia', score: 0 }, b: { teamId: '276', code: 'GER', name: 'Germany', score: 1 },
    result: { winnerName: 'Germany', loserName: 'Czechia', player: { name: 'P. Schick' }, tieText: null } },
  { id: 'match-2', round: '006', aId: '380', dId: '688', winnerId: '380', winnerName: 'Italy',
    a: { teamId: '380', code: 'ITA', name: 'Italy', score: 1 }, b: { teamId: '688', code: 'SRB', name: 'Serbia', score: 1 },
    result: { loserName: 'Serbia', player: { name: 'Dušan Vlahović' }, tieText: '4–3 on penalties' } },
  { id: 'match-3', round: '007', aId: 'b-1', dId: 'b-2', winnerId: 'b-2', winnerName: 'Boston',
    a: { teamId: 'b-1', code: 'LAL', name: 'Los Angeles', score: 101 }, b: { teamId: 'b-2', code: 'BOS', name: 'Boston', score: 104 },
    result: { loserName: 'Los Angeles', player: null, tieText: 'After 1 overtime period' } },
  { id: 'match-4', round: '008', aId: '380', dId: '250', winnerId: '380', winnerName: 'Italy',
    a: { teamId: '380', code: 'ITA', name: 'Italy', score: 2 }, b: { teamId: '250', code: 'FRA', name: 'France', score: 0 },
    series: { aWins: 1, bWins: 0, bestOf: 3 }, result: { winnerName: 'Italy', player: null, tieText: null } },
  { id: 'match-5', round: '009', aId: '040', dId: '348', winnerId: '348', winnerName: 'Hungary',
    a: { teamId: '040', code: 'AUT', name: 'Austria', score: 0 }, b: { teamId: '348', code: 'HUN', name: 'Hungary', score: 3 },
    result: { loserName: 'Austria', player: { name: 'David Alaba' } } },
];

test('latest results: newest first, winner-first titles, pens/OT, claims, series games without a conquest', () => {
  const st = state({ history: HISTORY });
  const ctx = context(st);
  const { rows } = buildLatestResults(st, ctx);
  assert.deepEqual(rows.map(row => row.key), ['match-5', 'match-4', 'match-3', 'match-2']);
  assert.deepEqual(rows.map(row => row.roman), ['IX', 'VIII', 'VII', 'VI']);
  assert.deepEqual(rows.map(row => row.title), ['Hungary beat Austria', 'Italy beat France', 'Boston beat Los Angeles', 'Italy beat Serbia']);
  assert.deepEqual(rows.map(row => row.meta), [
    'AUT 0–3 HUN · claims David Alaba',
    'ITA 2–0 FRA · series 1–0',
    'LAL 101–104 BOS (OT)',
    'ITA 1–1 SRB (pens) · claims Dušan Vlahović',
  ]);
  assert.equal(buildLatestResults(st, ctx, { limit: 2 }).rows.length, 2);
  assert.deepEqual(buildLatestResults(state(), context(state())).rows, []);
  const all = buildLatestResults(st, { ...ctx, cache: new Map() }, { limit: 10 }).rows;
  assert.equal(all.at(-1).meta, 'CZE 0–1 GER · claims P. Schick');
  assert.equal(all.at(-1).title, 'Germany beat Czechia');
});

test('ticker: last seven, newest first, "R XXVI  CZECHIA 0  GERMANY 1 · CZECHIA OUT" in source case', () => {
  const st = state({ history: HISTORY });
  const { items } = buildTicker(st, context(st));
  assert.deepEqual(items.map(item => item.text), [
    'R IX  Austria 0  Hungary 3 · Austria out',
    'R VIII  Italy 2  France 0',
    'R VII  Los Angeles 101  Boston 104 (OT) · Los Angeles out',
    'R VI  Italy 1  Serbia 1 (pens) · Serbia out',
    'R V  Czechia 0  Germany 1 · Czechia out',
  ]);
  const many = Array.from({ length: 12 }, (_, i) => ({ ...HISTORY[0], id: `m-${i}`, round: String(i + 1).padStart(3, '0') }));
  const long = buildTicker(state({ history: many }), context(state()));
  assert.equal(long.items.length, 7);
  assert.equal(long.items[0].key, 'm-11');
});

// =====================================================================================================
// Map overlays: caption and key (DEC D21, A-11, RM §1.11, M§5.4, M§6.4)
// =====================================================================================================

test('map caption: campaign title, round-0 copy, phone title and Whole map; no round kicker or seed', () => {
  const opening = state();
  const first = buildMapOverlays(opening, context(opening)).titleCard;
  assert.deepEqual(first, { variant: 'campaign', title: 'The European Campaign', phoneTitle: 'Your fronts',
    meta: 'Before the first match', sub: null, wholeMap: false });
  const later = state({ round: 18, wholeMap: true });
  const card = buildMapOverlays(later, context(later)).titleCard;
  assert.ok(!('kicker' in card), 'the round lives in the masthead');
  assert.equal(card.meta, 'Map after Round XVIII');
  assert.equal(card.wholeMap, true);
  // Busy (live) round: the map still shows the state after the previous round.
  const busy = state({ round: 19, match: { aId: '380', dId: '040', applied: false, done: false } });
  assert.equal(buildMapOverlays(busy, context(busy)).titleCard.meta, 'Map after Round XVIII');
  const world = state({ settings: { ...state().settings, scope: 'world' } });
  assert.equal(buildMapOverlays(world, context(world)).titleCard.title, 'The World Campaign');
  const southAmerica = state({ settings: { ...state().settings, scope: 'CONMEBOL' } });
  assert.equal(buildMapOverlays(southAmerica, context(southAmerica)).titleCard.title, 'South America Campaign');
  // Spectators: the phone frames the followed empire; nobody followed → whole-map title.
  const spectating = state({ followedId: '688' });
  assert.equal(buildMapOverlays(spectating, context(spectating, { managedId: null, followedId: '688' })).titleCard.phoneTitle, 'Serbia');
  assert.equal(buildMapOverlays(state(), context(state(), { managedId: null })).titleCard.phoneTitle, null);
});

test('map caption meta mid-round: round robin turns and blitz batches already changed the map', () => {
  const rec = (round, i) => ({ id: `r${round}-${i}`, round: String(round).padStart(3, '0'), aId: '380', dId: '040', winnerId: '380',
    a: { teamId: '380', code: 'ITA', name: 'Italy', score: 1 }, b: { teamId: '040', code: 'AUT', name: 'Austria', score: 0 },
    result: { winnerName: 'Italy', loserName: 'Austria' } });
  const metaOf = extra => { const st = state(extra); return buildMapOverlays(st, context(st)).titleCard.meta; };
  const rrSettings = { ...state().settings, turnOrder: 'round-robin' };
  const queue = ['276', '250', '380', '040', '348', '688'];
  // Idle after turn 2 of cycle III (DEC D3: every turn of a cycle shares round 3).
  const rrIdle = { round: 3, settings: rrSettings, turnQueue: queue, turnIndex: 2, history: [rec(2, 0), rec(3, 0), rec(3, 1)] };
  assert.equal(metaOf(rrIdle), 'Map after turn 2 of Round III');
  // Turn 3 in progress (turnIndex already consumed): the map still shows turn 2.
  assert.equal(metaOf({ ...rrIdle, turnIndex: 3, spin: spinOf('locked', { attackerId: '380', targetId: '040' }) }),
    'Map after turn 2 of Round III');
  assert.equal(metaOf({ ...rrIdle, turnIndex: 3, match: { aId: '380', dId: '040', applied: false, done: false } }),
    'Map after turn 2 of Round III');
  // Turn 3 finished (applied, not continued yet).
  assert.equal(metaOf({ ...rrIdle, turnIndex: 3, history: [...rrIdle.history, rec(3, 2)],
    match: { aId: '380', dId: '040', applied: true, done: true } }), 'Map after turn 3 of Round III');
  // First turn of cycle IV in progress: nothing of round IV is on the map yet.
  assert.equal(metaOf({ ...rrIdle, round: 4, turnIndex: 1, spin: spinOf('spinning', { attackerId: '276', targetId: '250' }) }),
    'Map after Round III');
  // Cycle boundary (idle, queue exhausted): the next round is IV, the map is after round III.
  assert.equal(metaOf({ ...rrIdle, turnIndex: 6 }), 'Map after Round III');

  // Blitz: one round per batch; after the first applied match the queue still holds the rest.
  const blitz = { ...state().settings, pacing: 'blitz' };
  const batch = { round: 5, settings: blitz, history: [rec(4, 0), rec(5, 0)], queue: [['250', '276']],
    match: { aId: '380', dId: '040', applied: true, done: true } };
  assert.equal(metaOf(batch), 'Map after match 1 of Round V');
  assert.equal(metaOf({ ...batch, queue: [], history: [...batch.history, rec(5, 1)],
    match: { aId: '250', dId: '276', applied: false, done: false } }), 'Map after match 2 of Round V');
  // Batch over (idle): Round VI is next, the map is after Round V.
  assert.equal(metaOf({ ...batch, queue: [], match: null }), 'Map after Round V');
  // Random-draw duels keep the per-round formula.
  assert.equal(metaOf({ round: 5, history: [rec(4, 0), rec(5, 0)] }), 'Map after Round V');
  // The champion's last match closes the campaign's last round, however few of its matches were played.
  const won = { aliveIds: ['380'], own: Object.fromEntries(Object.keys(OWN).map(id => [id, '380'])) };
  assert.equal(metaOf({ ...rrIdle, ...won, turnIndex: 1, history: [...rrIdle.history, rec(4, 0)], round: 4 }), 'Map after Round IV');
  assert.equal(metaOf({ ...batch, ...won, queue: [], match: null, round: 6, history: [...batch.history, rec(6, 0)] }),
    'Map after Round VI');
  assert.equal(metaOf({ round: 6, history: [rec(4, 0), rec(5, 0)], spin: spinOf('spinning') }), 'Map after Round V');
});

test('map caption variants: your turn while choosing, the draw for spectators, nothing in the conquest view', () => {
  const choosing = state({ round: 4, pendingTarget: { attackerId: '380', optionIds: ['040'], selectedId: '040', round: 5 } });
  const yourTurn = buildMapOverlays(choosing, context(choosing)).titleCard;
  assert.equal(yourTurn.variant, 'your-turn');
  assert.equal(yourTurn.title, 'Your turn');
  assert.equal(yourTurn.sub, 'Pick a neighbour to attack');

  const spec = { managedId: null, followedId: '380' };
  const drawing = state({ round: 3, spin: spinOf('spinning'), followedId: '380' });
  const draw = buildMapOverlays(drawing, context(drawing, spec)).titleCard;
  assert.equal(draw.variant, 'draw');
  assert.ok(!('kicker' in draw));
  assert.equal(draw.title, 'Serbia to attack');
  assert.equal(draw.sub, null, 'the target is named once the needle locks');
  assert.doesNotMatch(draw.title, /Italy/);
  const lockedDraw = state({ round: 3, spin: spinOf('locked'), followedId: '380' });
  const locked = buildMapOverlays(lockedDraw, context(lockedDraw, spec)).titleCard;
  assert.equal(locked.title, 'Serbia attacks Italy');
  assert.equal(locked.sub, 'Across a land border');
  const live = state({ round: 3, followedId: '380', match: { aId: '688', dId: '380', applied: false, done: false, routeKind: 'sea' } });
  const liveCard = buildMapOverlays(live, context(live, spec)).titleCard;
  assert.equal(liveCard.title, 'Serbia attacks Italy');
  assert.equal(liveCard.sub, 'By sea — no shared border');
  const rr = state({ round: 3, spin: spinOf('locked'), settings: { ...state().settings, turnOrder: 'round-robin' } });
  const rrCard = buildMapOverlays(rr, context(rr, spec)).titleCard;
  assert.equal(rrCard.title, 'Serbia attacks Italy');
  assert.ok(!('kicker' in rrCard));
  // Managers keep the campaign card during an AI duel; blitz spectators too.
  assert.equal(buildMapOverlays(drawing, context(drawing)).titleCard.variant, 'campaign');
  const blitz = state({ match: { aId: '688', dId: '380', applied: false }, settings: { ...state().settings, pacing: 'blitz' } });
  assert.equal(buildMapOverlays(blitz, context(blitz, spec)).titleCard.variant, 'campaign');

  const signing = state({ choice: { candidates: [{ index: 0 }] } });
  assert.deepEqual(buildMapOverlays(signing, context(signing)), { titleCard: null, mapKey: null });
});

test('your-turn caption names the reach as the target panel does: neighbours on land, targets by sea (DEC D4)', () => {
  const choosing = state({ round: 4, pendingTarget: { attackerId: '380', optionIds: ['040', '250'], selectedId: '040', round: 5 } });
  const ctxOn = board => ({ ...context(choosing), board, geo: board.geo, cache: new Map() });
  const land = ctxOn(placedBoard(choosing));
  assert.equal(buildMapOverlays(choosing, land).titleCard.sub, 'Pick a neighbour to attack');
  assert.match(buildTargetPanel(choosing, land).count, / neighbours in reach$/);
  // No land border (an island): the options are direct sea strikes, so both say "target".
  const island = ctxOn(placedBoard(choosing, {}));
  assert.ok(reachableTargets(island.board, '380').every(entry => entry.tier !== 'land'));
  assert.equal(buildMapOverlays(choosing, island).titleCard.sub, 'Pick a target to attack');
  assert.match(buildTargetPanel(choosing, island).count, / targets in reach$/);
  // No board yet: the land copy.
  assert.match(buildMapOverlays(choosing, { ...context(choosing), board: null }).titleCard.sub, /^Pick a neighbour/);
});

test('map key follows the map mode (A-11) and the reach key replaces it while choosing a target', () => {
  const keyOf = (extra, ctxExtra) => { const st = state(extra); return buildMapOverlays(st, context(st, ctxExtra)).mapKey; };
  const political = keyOf();
  assert.equal(political.variant, 'political');
  assert.equal(political.heading, 'Key');
  assert.deepEqual(political.items.map(item => [item.key, item.kind, item.label]), [
    ['you', 'swatch', 'Your empire'], ['opponent', 'swatch', 'Next opponent'], ['attack', 'arrow', 'Line of attack'], ['capital', 'capital', 'Capital']]);
  assert.deepEqual(political.items[0].ring, { color: 'var(--ink)', width: 1.4 });
  assert.equal(political.items[0].color, 'var(--you-fill)');
  assert.deepEqual(political.items[1].ring, { color: 'var(--opponent)', width: 2 });

  const st = state({ mapMode: 'strength' });
  const strength = buildMapOverlays(st, context(st)).mapKey;
  const steps = strengthSteps(st, context(st));
  assert.equal(strength.heading, 'Strength');
  assert.equal(steps.length, 5);
  assert.deepEqual(strength.items.slice(0, 5).map(item => [item.label, item.color]), steps.map(step => [`${step.min.toFixed(1)}+`, step.color]));
  assert.equal(strength.items[5].label, 'Your empire');
  // Two empires: five steps share two floors, and the map paints only the first step of each — the key lists two.
  const duo = state({ mapMode: 'strength', aliveIds: ['380', '688'], own: { 380: '380', 688: '688' } });
  const duoSteps = strengthSteps(duo, context(duo));
  const duoKey = buildMapOverlays(duo, context(duo)).mapKey.items.filter(item => item.key.startsWith('step-'));
  assert.equal(new Set(duoSteps.map(step => step.min)).size, 2);
  assert.deepEqual(duoKey.map(item => item.label), [...new Set(duoSteps.map(step => `${step.min.toFixed(1)}+`))]);
  assert.deepEqual(duoKey.map(item => item.color), duoSteps.filter((step, i) => duoSteps.findIndex(other => other.min === step.min) === i)
    .map(step => step.color), 'each swatch is the colour the map paints at that floor');

  const fronts = keyOf({ mapMode: 'fronts' });
  assert.deepEqual(fronts.items.map(item => item.label), ['Your empire', 'Win ≥60%', '45–59%', '<45%']);
  assert.deepEqual(fronts.items.slice(1).map(item => item.color), [MAP.frontsTint.gain, MAP.frontsTint.even, MAP.frontsTint.loss]);

  const flags = keyOf({ mapMode: 'flags' });
  assert.deepEqual(flags.items.map(item => [item.label, item.color]), [['Your empire', null], ['Next opponent', null], ['Capital', undefined]]);

  const reach = keyOf({ mapMode: 'strength', pendingTarget: { attackerId: '380', optionIds: ['040'], selectedId: '040' } });
  assert.equal(reach.variant, 'reach');
  assert.equal(reach.heading, null);
  assert.deepEqual(reach.items.map(item => [item.label, item.kind]), [['Your empire', 'swatch'], ['In reach this turn', 'dash'], ['Out of reach', 'veil']]);

  const spectatorNone = keyOf({}, { managedId: null });
  assert.deepEqual(spectatorNone.items.map(item => item.key), ['attack', 'capital']);
  const following = keyOf({ followedId: '688' }, { managedId: null, followedId: '688' });
  assert.equal(following.items[0].label, 'Followed empire');
  assert.equal(following.items[0].color, empireFill('688'));
  assert.equal(following.items[1].label, 'Next opponent');
});

test('the "you" swatch is filled as the map paints that empire in each mode (A-7, A-11)', () => {
  const youOf = (extra, ctxExtra) => {
    const st = state(extra);
    return buildMapOverlays(st, context(st, ctxExtra)).mapKey.items.find(item => item.key === 'you');
  };
  const spectator = { managedId: null, followedId: '688' };
  // A followed empire keeps its base fill: its pastel in Political only. The Strength ramp and the Fronts
  // land-neutral are not its colour, so there (as in Flags) the key shows the ink outline alone.
  for (const [mapMode, color] of [['political', empireFill('688')], ['strength', null], ['fronts', null], ['flags', null]]) {
    const item = youOf({ mapMode, followedId: '688' }, spectator);
    assert.equal(item.label, 'Followed empire', mapMode);
    assert.equal(item.color, color, mapMode);
    assert.deepEqual(item.ring, { color: 'var(--ink)', width: 1.4 }, mapMode);
  }
  // A managed empire is you-fill in every mode but Flags, while choosing a target too.
  for (const [mapMode, color] of [['political', 'var(--you-fill)'], ['strength', 'var(--you-fill)'], ['fronts', 'var(--you-fill)'],
    ['flags', null]]) {
    assert.equal(youOf({ mapMode }).color, color, mapMode);
    const reach = youOf({ mapMode, pendingTarget: { attackerId: '380', optionIds: ['040'], selectedId: '040' } });
    assert.equal(reach.color, color, `${mapMode} reach key`);
  }
  // An unknown mode paints as Political.
  assert.equal(youOf({ mapMode: 'weird', followedId: '688' }, spectator).color, empireFill('688'));
});

// =====================================================================================================
// Components
// =====================================================================================================

test('NextFixture renders the idle placeholder and the W1 idleText fallback', async context => {
  const st = state();
  const fixture = buildFixture(st, contextOf(st));
  const view = await mount(NextFixture, { fixture }, context);
  const root = view.host.querySelector('section.fixture.fixture--idle');
  assert.ok(root);
  assert.equal(root.getAttribute('aria-labelledby'), 'fixture-kicker');
  assert.equal(text(root.querySelector('h2#fixture-kicker.kicker__title')), 'Next fixture', 'the section name is the heading');
  assert.equal(text(root.querySelector('.kicker__aside')), 'Round I');
  assert.equal(text(root.querySelector('h3.fixture__title--idle')), fixture.idleTitle);
  assert.equal(text(root.querySelector('.fixture__route')), fixture.route);
  assert.equal(root.querySelector('.odds'), null);
  assert.equal(root.querySelector('button'), null);

  await view.render({ fixture: null, idleText: 'Choose Next match to draw the next fixture.' });
  assert.equal(text(view.host.querySelector('.fixture__route')), 'Choose Next match to draw the next fixture.');
  assert.equal(text(view.host.querySelector('#fixture-kicker')), 'Next fixture');

  // Compass still spinning: the attacker only, no matchup or odds.
  const spinning = state({ round: 3, spin: spinOf('spinning') });
  await view.render({ fixture: buildFixture(spinning, contextOf(spinning)) });
  assert.ok(view.host.querySelector('section.fixture--drawing'));
  assert.equal(text(view.host.querySelector('h3.fixture__title--idle')), 'Serbia to attack');
  assert.equal(text(view.host.querySelector('.fixture__route')), 'The compass is choosing the target');
  assert.equal(view.host.querySelector('.odds'), null);
  assert.equal(view.host.querySelector('.fixture__v'), null);
});
function contextOf(st, extra) { return context(st, extra); }

test('NextFixture tactical state: headline, odds bar, Match preview and simulate', async context => {
  const st = state({ round: 7, tacticalChoice: { aId: '688', dId: '380', route: { isNeighbor: true }, options: [] } });
  const fixture = buildFixture(st, contextOf(st));
  const calls = [];
  const view = await mount(NextFixture, { fixture, onPreview: () => calls.push('preview'), onSimulate: () => calls.push('simulate') }, context);
  const title = view.host.querySelector('h3.fixture__title');
  assert.equal(text(title), 'Serbia v Italy');
  assert.equal(text(title.querySelector('.fixture__v')), 'v');
  const bar = view.host.querySelector('.odds__bar');
  assert.equal(bar.getAttribute('role'), 'img');
  assert.equal(bar.getAttribute('aria-label'), fixture.odds.aria);
  assert.equal(view.host.querySelector('.odds__fill').style.width, `${fixture.odds.fill}%`);
  assert.equal(text(view.host.querySelector('.odds__label--a')), fixture.odds.aLabel);
  assert.equal(text(view.host.querySelector('.odds__label--b')), fixture.odds.bLabel);
  assert.equal(text(view.host.querySelector('.fixture__meta')), fixture.meta);
  const preview = [...view.host.querySelectorAll('button')].find(button => button.textContent === 'Match preview');
  const simulate = [...view.host.querySelectorAll('button')].find(button => button.textContent === 'or simulate the result');
  assert.ok(preview.classList.contains('btn-secondary'));
  assert.ok(simulate.classList.contains('btn-link'));
  assert.equal(preview.type, 'button');
  await click(preview);
  await click(simulate);
  assert.deepEqual(calls, ['preview', 'simulate']);
  await view.render({ fixture });
  assert.equal(view.host.querySelector('button'), null, 'no actions without handlers');
});

test('NextFixture embeds the matchCard slot whenever a match exists, then the next turn', async context => {
  const done = state({ round: 9, match: { aId: '688', dId: '380', ga: 1, gd: 2, applied: true, done: true, odds: { a: .4, b: .6 } } });
  const fixture = buildFixture(done, contextOf(done));
  const card = React.createElement('section', { 'data-testid': 'match-card', className: 'fi-match' },
    React.createElement('p', { className: 'fi-match-result' }, 'Italy takes Serbia'));
  const view = await mount(NextFixture, { fixture, matchCard: card }, context);
  assert.ok(view.host.querySelector('.fixture__card [data-testid="match-card"] .fi-match-result'));
  assert.equal(view.host.querySelector('.fixture__title'), null, 'the card replaces the headline');
  assert.equal(view.host.querySelector('.odds'), null);
  assert.equal(text(view.host.querySelector('#fixture-kicker')), 'Result');
  assert.equal(text(view.host.querySelector('.fixture__next')), `${fixture.next.title} · ${fixture.next.route}`);

  const complete = state({ round: 9, aliveIds: ['380'], match: { ...done.match } });
  await view.render({ fixture: buildFixture(complete, contextOf(complete)), matchCard: card });
  assert.ok(view.host.querySelector('[data-testid="match-card"]'), 'campaign complete keeps the card');
  assert.equal(view.host.querySelector('.fixture__next'), null);
  // A slot passed with an idle model (inconsistent caller) still renders.
  await view.render({ fixture: buildFixture(state(), contextOf(state())), matchCard: card });
  assert.ok(view.host.querySelector('[data-testid="match-card"]'));
});

test('FrontsTable rows, squad links, tones and the empty note', async context => {
  const st = state();
  const fronts = buildFronts(st, contextOf(st), { reach: LAND });
  const selected = [];
  const view = await mount(FrontsTable, { fronts, onSelectTeam: id => selected.push(id) }, context);
  assert.equal(text(view.host.querySelector('#fronts-kicker')), 'Your fronts');
  assert.equal(text(view.host.querySelector('.fronts .kicker__aside')), 'Win chance');
  assert.deepEqual([...view.host.querySelectorAll('thead th')].map(text), ['Nation', 'Str', 'Terr', 'Win']);
  const rows = [...view.host.querySelectorAll('tbody tr.fronts__row')];
  assert.equal(rows.length, fronts.rows.length);
  rows.forEach((tr, i) => {
    const row = fronts.rows[i];
    assert.equal(tr.dataset.teamId, row.teamId);
    const cells = [...tr.children].map(text);
    assert.deepEqual(cells, [row.name, row.eff, row.terr, row.win]);
    assert.ok(tr.querySelector('.fronts__win').classList.contains(`tone-${row.tone}`));
    assert.ok(tr.querySelector('.fronts__flag img.flag-chip'), 'nation flag chip');
  });
  const button = rows[1].querySelector('button.fronts__name');
  assert.equal(button.getAttribute('aria-label'), `View ${fronts.rows[1].name} squad`);
  await click(button);
  assert.deepEqual(selected, [fronts.rows[1].teamId]);

  await view.render({ fronts: { rows: [], empty: 'No rival is within reach.', note: null } });
  assert.equal(view.host.querySelector('table'), null);
  assert.equal(text(view.host.querySelector('.fronts__empty')), 'No rival is within reach.');
  await view.render({ fronts: null });
  assert.equal(view.host.innerHTML, '');
});

test('FrontsTable heads the name column "Club" in the clubs layer', async context => {
  const nations = buildFronts(state(), contextOf(state()), { reach: LAND });
  assert.equal(nations.nameHeading, 'Nation');
  const clubTeams = Object.fromEntries(Object.entries(TEAMS).map(([id, team]) => [id, { ...team, kind: 'club', flagId: null }]));
  const st = state({ teams: clubTeams, settings: { ...state().settings, layer: 'clubs', clubScope: 'eu-top' } });
  const fronts = buildFronts(st, contextOf(st), { reach: LAND });
  assert.equal(fronts.nameHeading, 'Club');
  assert.ok(fronts.rows.every(row => row.isClub));
  const view = await mount(FrontsTable, { fronts }, context);
  assert.deepEqual([...view.host.querySelectorAll('thead th')].map(text), ['Club', 'Str', 'Terr', 'Win']);
  // Same rows, nations layer: the design's "Nation".
  await view.render({ fronts: nations });
  assert.equal(text(view.host.querySelector('thead th')), 'Nation');
});

test('LatestResults rows and the Chronicle link', async context => {
  const st = state({ history: HISTORY });
  const results = buildLatestResults(st, contextOf(st));
  const opened = [];
  const view = await mount(LatestResults, { results, onOpenChronicle: () => opened.push(true) }, context);
  assert.equal(text(view.host.querySelector('#results-kicker')), 'Latest results');
  const rows = [...view.host.querySelectorAll('ol.results-list__rows > li.results-list__row')];
  assert.equal(rows.length, 4);
  assert.equal(text(rows[0].querySelector('.results-list__round')), 'Round IX');
  assert.equal(text(rows[0].querySelector('.results-list__title')), 'Hungary beat Austria');
  assert.equal(text(rows[0].querySelector('.results-list__meta')), 'AUT 0–3 HUN · claims David Alaba');
  const chronicle = view.host.querySelector('button.results-list__more');
  assert.equal(chronicle.textContent, 'Chronicle');
  await click(chronicle);
  assert.equal(opened.length, 1);
  await view.render({ results: { rows: [] } });
  assert.equal(text(view.host.querySelector('.results-list__empty')), 'No results yet.');
  assert.equal(view.host.querySelector('button'), null);
  assert.equal(text(view.host.querySelector('.kicker__aside')), 'Chronicle');
});

test('Ticker: LIVE block, cursor, items separated by eight spaces; never a marquee', async context => {
  const st = state({ history: HISTORY.slice(0, 2) });
  const model = buildTicker(st, contextOf(st));
  const view = await mount(Ticker, model, context);
  const ticker = view.host.querySelector('.ticker');
  assert.equal(ticker.getAttribute('aria-live'), 'off');
  assert.equal(text(ticker.querySelector('.ticker__live')), 'Live');
  assert.equal(ticker.querySelector('.ticker__cursor').getAttribute('aria-hidden'), 'true');
  assert.equal(text(ticker.querySelector('.ticker__text')),
    'R VI  Italy 1  Serbia 1 (pens) · Serbia out        R V  Czechia 0  Germany 1 · Czechia out');
  assert.equal(ticker.querySelector('marquee'), null);
  await view.render({ items: [] });
  assert.equal(text(view.host.querySelector('.ticker__text')), 'No results yet');
});

test('MapOverlays: nothing in conquest, one-line caption variants, phone swap and key glyphs', async context => {
  const view = await mount(MapOverlays, { titleCard: null, mapKey: null }, context);
  assert.equal(view.host.innerHTML, '');

  const st = state({ round: 18 });
  const overlays = buildMapOverlays(st, contextOf(st));
  await view.render(overlays);
  const card = view.host.querySelector('.map-title-card.map-title-card--campaign');
  assert.ok(card.classList.contains('map-title-card--swap'));
  assert.equal(card.querySelector('.map-title-card__kicker'), null);
  assert.equal(text(card.querySelector('h2.map-title-card__title .map-title-card__title-full')), 'The European Campaign');
  assert.equal(text(card.querySelector('.map-title-card__title--phone')), 'Your fronts');
  assert.equal(text(card.querySelector('.map-title-card__meta')), 'Map after Round XVIII');
  assert.doesNotMatch(card.textContent, /seed|Round XIX/, 'the masthead carries the round, Settings the seed');
  const key = view.host.querySelector('.map-key.map-key--political');
  assert.equal(key.getAttribute('role'), 'group');
  assert.equal(key.getAttribute('aria-label'), 'Map key');
  assert.equal(text(key.querySelector('.map-key__heading')), 'Key');
  assert.deepEqual([...key.querySelectorAll('.map-key__label')].map(text), ['Your empire', 'Next opponent', 'Line of attack', 'Capital']);
  const [you, opponent] = key.querySelectorAll('.map-key__swatch');
  assert.equal(you.style.background, 'var(--you-fill)');
  assert.equal(you.style.boxShadow, '0 0 0 1.4px var(--ink)');
  assert.equal(opponent.style.boxShadow, '0 0 0 2px var(--opponent)');
  assert.ok(key.querySelector('svg.map-key__arrow path[fill="currentColor"]'));
  assert.ok(key.querySelector('i.map-key__capital'));

  await view.render({ ...overlays, titleCard: { ...overlays.titleCard, wholeMap: true } });
  assert.equal(view.host.querySelector('.map-title-card__title--phone'), null, 'Whole map shows the full title');

  const choosing = state({ pendingTarget: { attackerId: '380', optionIds: ['040'], selectedId: '040' } });
  await view.render(buildMapOverlays(choosing, contextOf(choosing)));
  assert.equal(text(view.host.querySelector('.map-title-card--your-turn .map-title-card__title')), 'Your turn');
  assert.equal(text(view.host.querySelector('.map-title-card--your-turn .map-title-card__sub')), 'Pick a neighbour to attack');
  const reach = view.host.querySelector('.map-key--reach');
  assert.equal(reach.querySelector('.map-key__heading'), null);
  assert.equal(reach.querySelector('svg.map-key__dash rect').getAttribute('stroke-dasharray'), '5 3');
  assert.ok(reach.querySelector('.map-key__veil'));
});

test('CampaignColumn composes the manager column, the target panel, the spectator panel and the phone sheet', async context => {
  const st = state({ round: 7, history: HISTORY, tacticalChoice: { aId: '688', dId: '380', route: { isNeighbor: true }, options: [] } });
  const ctx = contextOf(st);
  const model = { ...buildColumn(st, ctx), fronts: buildFronts(st, ctx, { reach: LAND }) };
  const calls = [];
  const handlers = {
    onPreview: () => calls.push('preview'), onSimulate: () => calls.push('simulate'), onToggleSheet: () => calls.push('sheet'),
    onOpenChronicle: () => calls.push('chronicle'), onSelectTeam: id => calls.push(`team:${id}`),
  };
  const view = await mount(CampaignColumn, { ...model, ...handlers, matchCard: null, targetPanel: null, spectatorPanel: null }, context);
  const aside = view.host.querySelector('aside#campaign-details');
  assert.ok(aside.classList.contains('v4-column'));
  assert.equal(aside.getAttribute('aria-label'), 'Campaign details');
  assert.equal(aside.tabIndex, -1);
  assert.equal(aside.dataset.sheet, 'collapsed');
  assert.deepEqual([...aside.children].map(node => node.className.split(' ')[0]), ['sheet__grab', 'v4-column__lead', 'fronts', 'results-list']);
  assert.ok(aside.querySelector('.v4-column__lead > .fixture.fixture--tactical'));
  assert.ok(aside.classList.contains('v4-column--fronts'));
  // Heading navigation reaches every section (h2 kickers), the matchup sits under its section (h3).
  assert.deepEqual([...aside.querySelectorAll('h2')].map(text), ['Next fixture', 'Your fronts', 'Latest results']);
  assert.equal(text(aside.querySelector('.fixture h3.fixture__title')), 'Serbia v Italy');
  const grab = aside.querySelector('button.sheet__grab');
  assert.equal(grab.getAttribute('aria-expanded'), 'false');
  assert.equal(grab.getAttribute('aria-label'), 'More campaign detail');
  await click(grab);
  assert.deepEqual(calls, ['sheet']);

  // Expanded sheet: Escape collapses it.
  await view.render({ ...model, ...handlers, sheet: 'expanded' });
  assert.equal(aside.dataset.sheet, 'expanded');
  assert.ok(aside.classList.contains('v4-column--expanded'));
  assert.equal(aside.querySelector('button.sheet__grab').getAttribute('aria-expanded'), 'true');
  assert.equal(aside.querySelector('button.sheet__grab').getAttribute('aria-label'), 'More campaign detail', 'one fixed name');
  await act(async () => aside.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.deepEqual(calls, ['sheet', 'sheet']);
  // Escape from a fronts or results control (hidden once collapsed) hands focus to the grab handle.
  const squadLink = aside.querySelector('.fronts button.fronts__name');
  squadLink.focus();
  assert.equal(document.activeElement, squadLink);
  await act(async () => squadLink.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(document.activeElement, aside.querySelector('button.sheet__grab'));
  assert.deepEqual(calls, ['sheet', 'sheet', 'sheet']);
  // Escape from the first block (still visible) leaves focus where it is.
  const preview = aside.querySelector('.fixture__preview');
  preview.focus();
  await act(async () => preview.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(document.activeElement, preview);

  // Manager with a live/done match: NextFixture embeds the slot.
  const card = React.createElement('section', { 'data-testid': 'match-card' }, 'card');
  await view.render({ ...model, ...handlers, matchCard: card });
  assert.ok(aside.querySelector('.fixture [data-testid="match-card"]'));

  // Your turn: the target panel replaces the fixture and the fronts.
  const panel = React.createElement('section', { className: 'target-panel' }, 'Choose a target');
  await view.render({ ...model, ...handlers, targetPanel: panel });
  assert.ok(aside.querySelector('.v4-column__lead > .target-panel'));
  assert.equal(aside.querySelector('.fixture'), null);
  assert.equal(aside.querySelector('.fronts'), null);
  assert.ok(aside.classList.contains('v4-column--no-fronts'));
  assert.ok(aside.querySelector('.results-list'));

  // Spectator: the spectator panel, then latest results; no fixture, no fronts.
  const spectatorPanel = React.createElement('section', { className: 'spectator-panel' }, card);
  await view.render({ ...model, ...handlers, role: 'spectator', fronts: null, spectatorPanel });
  assert.ok(aside.classList.contains('v4-column--spectator'));
  assert.ok(aside.querySelector('.v4-column__lead > .spectator-panel [data-testid="match-card"]'));
  assert.equal(aside.querySelector('.fixture'), null);
  assert.equal(aside.querySelector('.fronts'), null);
  const chronicle = aside.querySelector('button.results-list__more');
  await click(chronicle);
  assert.equal(calls.at(-1), 'chronicle');
  // Spectator without a panel (defensive) falls back to the fixture block.
  await view.render({ ...model, role: 'spectator', fronts: null, spectatorPanel: null });
  assert.ok(aside.querySelector('.fixture'));
  assert.equal(aside.querySelector('.sheet__grab'), null, 'no grab handle without a toggle handler');
});

test('the W1 stub props (role, sheet, idleText only) still render', async context => {
  const view = await mount(CampaignColumn, { role: 'manager', sheet: 'collapsed', idleText: 'Choose Next match to draw the next fixture.' }, context);
  assert.equal(text(view.host.querySelector('.fixture__route')), 'Choose Next match to draw the next fixture.');
  assert.equal(text(view.host.querySelector('.results-list__empty')), 'No results yet.');
  assert.equal(view.host.querySelector('.fronts'), null);
});

test('phone: the collapsed sheet holds the whole done state above the Continue bar (A4)', async () => {
  const { readFileSync } = await import('node:fs');
  const read = rel => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
  // Every `@media (max-width:699.98px) { … }` block of a stylesheet, concatenated.
  const phone = css => {
    let out = '';
    for (let at = css.indexOf('@media (max-width:699.98px) {'); at !== -1; at = css.indexOf('@media (max-width:699.98px) {', at + 1)) {
      let depth = 0, i = css.indexOf('{', at);
      const start = i;
      for (; i < css.length; i++) { if (css[i] === '{') depth++; else if (css[i] === '}' && --depth === 0) break; }
      out += css.slice(start, i + 1);
    }
    return out;
  };
  // The "Next draw" line waits in the expanded sheet: the phone bar already names the next step.
  const column = phone(read('src/screens/campaign/campaign.css'));
  assert.match(column, /\.v4-column\[data-sheet=collapsed\] \.fixture__next \{ display:none; \}/);
  assert.doesNotMatch(column, /\.v4-column\[data-sheet=expanded\][^{]*\.fixture__next/);
  // The compact done card keeps its order on phone with a tighter rhythm: at 390×844 the done lead measures ≈232px
  // against 247px of collapsed-sheet room (it was 268px, 21px under the Continue bar).
  const card = phone(read('src/components/match-card.css'));
  assert.match(card, /\.fi-match--compact \.fi-match-status \{ margin-top:8px; \}/);
  assert.match(card, /\.fi-match--compact \.fi-match-result \{ margin-top:8px; padding-top:6px; \}/);
  assert.match(card, /\.fi-match--compact \.fi-strength-reward \{ padding-top:4px; \}/);
  assert.match(card, /\.fi-match--compact \.fi-match-spoils \{ margin-top:0; \}/);
});
