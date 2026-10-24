// WP-TURN (PLAN §5.2): turn strip, "Choose a target" panel and card, spectator panel — view-models and components.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { makeRng, buildTeam } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import {
  buildTurnStrip, buildReach, buildTargetPanel, buildTargetCard, buildSpectatorPanel, targetOptions, idleTurnCopy,
  targetCardAnchor, targetChoiceSeed, TARGET_ROWS,
} from '../src/viewModels/turns.js';
import { displayRound } from '../src/viewModels/format.js';

const compiled = await build({
  stdin: { contents: `
    export {default as TurnStrip} from './src/screens/turns/TurnStrip.jsx';
    export {default as TargetPanel} from './src/screens/turns/TargetPanel.jsx';
    export {default as TargetCard} from './src/screens/turns/TargetCard.jsx';
    export {default as SpectatorPanel} from './src/screens/turns/SpectatorPanel.jsx';
  `, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
  loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { TurnStrip, TargetPanel, TargetCard, SpectatorPanel } = module.exports;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
after(() => dom.window.close());

// Component renders must be console-clean (unknown DOM props, missing keys, …): smoke fails on any error/warning.
const consoleErrors = [];
const originalError = console.error, originalWarn = console.warn;
console.error = (...args) => { consoleErrors.push(args.map(String).join(' ')); };
console.warn = (...args) => { consoleErrors.push(args.map(String).join(' ')); };
after(() => { console.error = originalError; console.warn = originalWarn; });

async function mount(Component, props, context) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const view = {
    host,
    async render(nextProps) { await act(async () => root.render(React.createElement(Component, nextProps))); },
    async close() { await act(async () => root.unmount()); host.remove(); },
  };
  context.after(() => view.close());
  await view.render(props);
  return view;
}
const text = node => node?.textContent.replace(/\s+/g, ' ').trim();
async function key(node, keyName, modifiers = {}) {
  const event = new dom.window.KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...modifiers });
  await act(async () => node.dispatchEvent(event));
  return event;
}
async function click(node) {
  await act(async () => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
}

// ---- fixtures: real football teams so win chances come from the repo's estimateWinProbability (DEC D5) ----
const sport = getSport('football');
const rng = makeRng(2033);
const IDS = ['380', '348', '688', '276', '250', '008', '040', '705', '191', '756'];
const TEAMS = Object.fromEntries(IDS.map(id => [id, buildTeam(id, rng, sport)]));
const TERRITORIES = { 380: 4, 348: 10, 688: 3, 276: 8, 250: 1, '008': 1, '040': 1, 705: 2, 191: 2, 756: 1 };
const OWN = Object.fromEntries(Object.entries(TERRITORIES).flatMap(([id, n]) => Array.from({ length: n }, (_, k) => [`${id}-${k}`, id])));

function state(overrides = {}) {
  return {
    phase: 'playing', round: 4, teams: TEAMS, own: OWN, aliveIds: IDS.slice(), stats: {}, history: [],
    settings: { pacing: 'duel', turnOrder: 'random', targeting: 'compass', sport: 'football', role: 'spectator' },
    turnQueue: [], turnIndex: 0, pendingTarget: null, targetHoverId: null, spin: null, match: null, choice: null,
    tacticalChoice: null, queue: [], autoplay: false, speed: 2, followedId: null, pauseFollow: false, managedTeamId: null,
    managementEnded: false, phoneSheet: 'collapsed',
    ...overrides,
  };
}
const context = (overrides = {}) => ({ board: null, geo: null, sport, managedId: null, followedId: null, drama: 6,
  cache: new Map(), ...overrides });
const pending = (overrides = {}) => ({ attackerId: '380', optionIds: ['348', '688', '276', '250', '008', '040'],
  selectedId: '348', round: 5, openedAt: 0, resumeAutoplay: false, turn: null, ...overrides });

// =========================================================================================================
// view-models

test('idleTurnCopy: random, round robin (compass / you choose) and pacing-specific copy (DEC D10)', () => {
  assert.deepEqual(idleTurnCopy(state(), context()), { title: 'Next draw', route: 'Any of 10 empires can be drawn' });
  assert.equal(idleTurnCopy(state({ aliveIds: ['380', '348'] }), context()).route, 'Any of 2 empires can be drawn');
  const rr = state({ settings: { ...state().settings, turnOrder: 'round-robin' }, turnQueue: ['276', '380', '348'], turnIndex: 1 });
  assert.deepEqual(idleTurnCopy(rr, context()), { title: 'Italy to attack', route: 'Compass decides the target' });
  const mine = { ...rr, settings: { ...rr.settings, targeting: 'player', role: 'manager' } };
  assert.deepEqual(idleTurnCopy(mine, context({ managedId: '380' })), { title: 'Italy to attack', route: 'You choose the target' });
  // Someone else attacks next: the compass picks their target even under "You choose".
  assert.equal(idleTurnCopy({ ...mine, turnIndex: 2 }, context({ managedId: '380' })).route, 'Compass decides the target');
  // An eliminated entry is skipped; at a boundary the next cycle starts with the strongest survivor.
  const boundary = { ...rr, turnQueue: ['276', '380'], turnIndex: 2 };
  const strongest = buildTurnStrip(boundary, context()).entries[0].name;
  assert.equal(idleTurnCopy(boundary, context()).title, `${strongest} to attack`);
  assert.equal(idleTurnCopy(state({ settings: { pacing: 'blitz' } }), context()).title, 'Next round');
  assert.equal(idleTurnCopy(state({ settings: { pacing: 'chaos' } }), context()).route, 'Matches are drawn until a name repeats');
  assert.equal(idleTurnCopy(state({ queue: [['380', '348']] }), context()).route, '1 match left this round');
  // Purity on loading/setup states (no teams, no board).
  assert.deepEqual(idleTurnCopy({ phase: 'setup', teams: {}, aliveIds: [] }, {}), { title: 'Next draw', route: 'Any of 0 empires can be drawn' });
});

test('idleTurnCopy memoises the next round-robin attacker per state identities (three builders call it per render)', () => {
  const settings = { ...state().settings, turnOrder: 'round-robin' };
  const boundary = state({ settings, turnQueue: ['276', '380'], turnIndex: 2 });
  const ctx = context();
  const first = idleTurnCopy(boundary, ctx);
  const hit = ctx.cache.get('turn:rr-next');
  assert.ok(hit, 'the attacker lookup is cached');
  assert.ok(ctx.cache.get('turn:rr-order'), 'a boundary reads the memoised preview order, not a fresh roundRobinOrder');
  assert.deepEqual(idleTurnCopy(boundary, ctx), first);
  assert.equal(ctx.cache.get('turn:rr-next'), hit, 'same identities: no recomputation');
  // Mid-cycle uses the engine's nextTurn rule; a new queue/turnIndex recomputes.
  assert.equal(idleTurnCopy({ ...boundary, turnQueue: ['276', '380', '348'], turnIndex: 2 }, ctx).title, 'Hungary to attack');
  assert.notEqual(ctx.cache.get('turn:rr-next'), hit);
});

test('turn strip visibility: duel only, round robin for everyone, random draw for spectators only', () => {
  assert.equal(buildTurnStrip(state({ phase: 'setup' }), context()).variant, null);
  assert.equal(buildTurnStrip(state({ settings: { ...state().settings, pacing: 'blitz' } }), context()).variant, null);
  assert.equal(buildTurnStrip(state(), context({ managedId: '380' })).variant, null);
  assert.equal(buildTurnStrip(state(), context()).variant, 'random');
  const rr = state({ settings: { ...state().settings, turnOrder: 'round-robin' } });
  assert.equal(buildTurnStrip(rr, context({ managedId: '380' })).variant, 'round-robin');
  assert.equal(buildTurnStrip({ ...rr, aliveIds: ['380'] }, context()).variant, null);
  assert.equal(buildTurnStrip({ phase: 'loading', teams: {} }, { board: null }).variant, null);
});

test('round-robin strip: current, played, eliminated and next entries (DEC D3)', () => {
  const settings = { ...state().settings, turnOrder: 'round-robin' };
  const queue = ['276', '380', '348', '688', '250'];
  const alive = IDS.filter(id => id !== '688');
  // A spin is running for the second entry (turnIndex already consumed it).
  const busy = state({ settings, turnQueue: queue, turnIndex: 2, aliveIds: alive, spin: { attackerId: '380', targetId: '348', stage: 'ready' } });
  const strip = buildTurnStrip(busy, context({ managedId: '380' }));
  assert.equal(strip.label, 'Round robin');
  assert.equal(strip.detail, 'Turn 2 of 5 this round');
  assert.equal(strip.detailShort, 'Turn 2 of 5');
  assert.deepEqual(strip.entries.map(entry => entry.state), ['done', 'current', 'next', 'out', 'next']);
  assert.deepEqual(strip.entries.map(entry => entry.nextUp), [false, false, true, false, false]);
  assert.equal(strip.entries[1].you, true);
  assert.equal(strip.next, 'Next: Hungary');
  // Idle mid-round: the next surviving entry at or after turnIndex is current; the eliminated one is skipped.
  const idle = buildTurnStrip({ ...busy, spin: null, turnIndex: 2 }, context());
  assert.deepEqual(idle.entries.map(entry => entry.state), ['done', 'done', 'current', 'out', 'next']);
  assert.equal(idle.next, 'Next: France');
  // Last surviving entry of the cycle.
  const last = buildTurnStrip({ ...busy, spin: { attackerId: '250', targetId: '380', stage: 'locked' }, turnIndex: 5 }, context());
  assert.equal(last.detail, 'Turn 5 of 5 this round');
  assert.equal(last.next, 'Next: new round');
  // Round boundary / first turn: preview of the next cycle (strongest first), no entry played yet.
  const fresh = buildTurnStrip(state({ settings, turnQueue: [], turnIndex: 0 }), context());
  assert.equal(fresh.entries.length, IDS.length);
  assert.equal(fresh.entries[0].state, 'current');
  assert.equal(fresh.detail, `Turn 1 of ${IDS.length} this round`);
  assert.ok(fresh.entries.slice(1).every(entry => entry.state === 'next'));
  // A live match and a pending target keep the consumed entry current.
  const live = buildTurnStrip({ ...busy, spin: null, match: { aId: '380', dId: '348', applied: false } }, context());
  assert.equal(live.entries[1].state, 'current');
  const choosing = buildTurnStrip({ ...busy, spin: null, pendingTarget: pending() }, context());
  assert.equal(choosing.entries[1].state, 'current');
});

test('round robin between best-of-three finale games names the series attacker, not the stale queue', () => {
  // App.nextAction plays every remaining game as series.teamIds[0] v [1], each in a round of its own.
  const settings = { ...state().settings, turnOrder: 'round-robin', finale: 'best-of-three' };
  const between = state({ settings, aliveIds: ['380', '348'], round: 3, turnQueue: ['348', '380'], turnIndex: 1,
    series: { teamIds: ['348', '380'], wins: { 348: 0, 380: 1 }, games: 1 } });
  const strip = buildTurnStrip(between, context());
  assert.equal(strip.entries.find(entry => entry.state === 'current')?.teamId, '348', 'Hungary kicks off game 2');
  assert.equal(idleTurnCopy(between, context()).title, 'Hungary to attack');
  assert.equal(displayRound(between), 4, 'the next game opens Round IV, as nextAction numbers it');
});

test('random-draw strip: pool and the six most recent attackers, newest first', () => {
  const history = Array.from({ length: 8 }, (_, i) => ({ id: `match-${i + 1}`, round: String(19 + i).padStart(3, '0'),
    aId: IDS[i], a: { teamId: IDS[i], id: IDS[i], code: TEAMS[IDS[i]].code, name: TEAMS[IDS[i]].name } }));
  const strip = buildTurnStrip(state({ history, aliveIds: IDS.slice(0, 7) }), context());
  assert.equal(strip.label, 'Random draw');
  assert.equal(strip.detail, 'Drawn from 7 empires');
  assert.equal(strip.phoneLabel, 'Random draw · 7 empires');
  assert.equal(strip.note, 'The same empire can be drawn twice in a row');
  assert.equal(strip.next, null);
  assert.equal(strip.recent.length, 6);
  assert.deepEqual(strip.recent.map(item => item.roman), ['XXVI', 'XXV', 'XXIV', 'XXIII', 'XXII', 'XXI']);
  assert.equal(strip.recent[0].code, TEAMS[IDS[7]].code);
  assert.equal(strip.recent[0].teamId, IDS[7]);
});

test('target options: in-reach ids ranked by win chance × territories; panel rows, count and CTA', () => {
  const st = state({ pendingTarget: pending(), settings: { ...state().settings, targeting: 'player', role: 'manager' } });
  const ctx = context({ managedId: '380' });
  const options = targetOptions(st, ctx, '380');
  assert.deepEqual(options.map(option => option.teamId).sort(), pending().optionIds.slice().sort());
  for (const option of options) {
    assert.ok(option.p > 0 && option.p < 1, 'win chance from estimateWinProbability');
    assert.equal(option.n, TERRITORIES[option.teamId]);
  }
  for (let i = 1; i < options.length; i++) assert.ok(options[i - 1].p * options[i - 1].n >= options[i].p * options[i].n);
  assert.equal(targetOptions(st, ctx, '380'), options, 'memoised on state identities');

  const panel = buildTargetPanel(st, ctx);
  assert.equal(panel.count, '6 neighbours in reach');
  assert.equal(panel.selectedId, '348');
  assert.equal(panel.ctaLabel, 'Attack Hungary');
  assert.equal(panel.rows.length, 6);
  const hungary = panel.rows.find(row => row.teamId === '348');
  assert.equal(hungary.selected, true);
  assert.equal(hungary.spoils, '+10');
  assert.match(hungary.eff, /^\d+\.\d$/);
  assert.match(hungary.win, /^(\d+%|<1%|>99%)$/);
  assert.ok(['gain', 'even', 'loss'].includes(hungary.tone));
  assert.equal(panel.rows.filter(row => row.selected).length, 1);

  const one = buildTargetPanel({ ...st, pendingTarget: pending({ optionIds: ['688'], selectedId: '688' }) }, context({ managedId: '380' }));
  assert.equal(one.count, '1 neighbour in reach');
  assert.equal(one.ctaLabel, 'Attack Serbia');

  // More than six options: six rows; a map-picked selection outside the top six stays visible as the last row.
  const many = ['348', '688', '276', '250', '008', '040', '705', '191', '756'];
  const ranked = targetOptions({ ...st, pendingTarget: pending({ optionIds: many }) }, context({ managedId: '380' }), '380');
  const outside = ranked.at(-1).teamId;
  const big = buildTargetPanel({ ...st, pendingTarget: pending({ optionIds: many, selectedId: outside }) }, context({ managedId: '380' }));
  assert.equal(big.count, '9 neighbours in reach');
  assert.equal(big.rows.length, TARGET_ROWS);
  assert.equal(big.rows.at(-1).teamId, outside);
  assert.equal(big.rows.at(-1).selected, true);
  // No pending target → empty panel.
  assert.deepEqual(buildTargetPanel(state(), context()), { count: '', rows: [], selectedId: null, ctaLabel: '' });
});

test('targetChoiceSeed: what openTargetChoice stores — rank order, top row preselected, one selection everywhere', () => {
  const st = state({ settings: { ...state().settings, targeting: 'player', role: 'manager' } });
  const ids = ['348', '688', '276', '250', '008', '040'];
  // Stored ids in an arbitrary order: the seed re-ranks them (with a board it ranks the DEC D4 reach).
  const unordered = { ...st, pendingTarget: pending({ optionIds: ids.slice().reverse(), selectedId: null }) };
  const seed = targetChoiceSeed(unordered, context({ managedId: '380' }), '380');
  const ranked = targetOptions(unordered, context({ managedId: '380' }), '380').map(option => option.teamId);
  assert.deepEqual(seed.optionIds, ranked);
  assert.equal(seed.selectedId, ranked[0]);
  // Once stored, the panel's checked row, its foot, the reach and the card all name the same team.
  const opened = { ...st, pendingTarget: pending({ optionIds: seed.optionIds, selectedId: seed.selectedId }) };
  const ctx = context({ managedId: '380' });
  const panel = buildTargetPanel(opened, ctx);
  assert.equal(panel.selectedId, opened.pendingTarget.selectedId);
  assert.equal(panel.rows[0].teamId, opened.pendingTarget.selectedId);
  assert.equal(panel.rows[0].selected, true);
  assert.equal(panel.ctaLabel, `Attack ${TEAMS[seed.selectedId].name}`);
  assert.equal(buildReach(opened, ctx).selectedId, seed.selectedId);
  assert.equal(buildTargetCard(opened, ctx).teamId, seed.selectedId);
  // No reach (tiny atlas, nothing pending): empty seed, so the turn falls back to the compass (DEC D4).
  assert.deepEqual(targetChoiceSeed(st, context({ managedId: '380' }), '380'), { optionIds: [], selectedId: null });
});

test('target card copy follows the hovered option, else the selection (M§5.5)', () => {
  const st = state({ pendingTarget: pending() });
  const ctx = context({ managedId: '380' });
  const card = buildTargetCard(st, ctx);
  assert.equal(card.name, 'Hungary');
  assert.match(card.line1, /^10 territories · strength \d+\.\d$/);
  assert.match(card.winLine, /^Win chance (\d+%|<1%|>99%)$/);
  assert.equal(card.stakeWin, 'Win: +10 territories and one player');
  assert.equal(card.stakeLose, 'Lose: Italy falls — campaign over');
  const hovered = buildTargetCard({ ...st, targetHoverId: '250' }, ctx);
  assert.equal(hovered.name, 'France');
  assert.match(hovered.line1, /^1 territory · /);
  assert.equal(hovered.stakeWin, 'Win: +1 territory and one player');
  // Hovering land outside the reach does not move the card.
  assert.equal(buildTargetCard({ ...st, targetHoverId: '756' }, ctx).name, 'Hungary');
  assert.equal(buildTargetCard(state(), ctx), null);
});

test('target card stakes in a best-of-three final follow the series (finishMatch: no conquest before the decider)', () => {
  const ctx = context({ managedId: '380' });
  const final = (extra = {}) => state({ aliveIds: ['380', '348'], settings: { ...state().settings, finale: 'best-of-three' },
    pendingTarget: pending({ optionIds: ['348'], selectedId: '348' }), ...extra });
  // Game one (the only game that opens a target choice: games two and three skip it): nothing changes hands yet.
  const first = buildTargetCard(final(), ctx);
  assert.equal(first.stakeWin, 'Win: Italy moves one game closer to total conquest');
  assert.equal(first.stakeLose, 'Lose: Hungary moves one game closer to total conquest');
  // A game one side can decide uses the decisive copy for that side.
  const series = wins => ({ teamIds: ['380', '348'], wins, games: wins['380'] + wins['348'] });
  const ahead = buildTargetCard(final({ series: series({ 380: 1, 348: 0 }) }), ctx);
  assert.equal(ahead.stakeWin, 'Win: +10 territories and one player');
  assert.equal(ahead.stakeLose, 'Lose: Hungary moves one game closer to total conquest');
  const decider = buildTargetCard(final({ series: series({ 380: 1, 348: 1 }) }), ctx);
  assert.equal(decider.stakeWin, 'Win: +10 territories and one player');
  assert.equal(decider.stakeLose, 'Lose: Italy falls — campaign over');
  // A single-game final (and any earlier round) keeps the territory/elimination copy.
  const single = buildTargetCard(final({ settings: { ...state().settings, finale: 'single' } }), ctx);
  assert.equal(single.stakeWin, 'Win: +10 territories and one player');
  assert.equal(single.stakeLose, 'Lose: Italy falls — campaign over');
  const early = buildTargetCard(state({ settings: { ...state().settings, finale: 'best-of-three' }, pendingTarget: pending() }), ctx);
  assert.equal(early.stakeWin, 'Win: +10 territories and one player');
});

test('reach model: FROZEN shape, hover only in reach, preview null-safe and memoised', () => {
  const st = state({ pendingTarget: pending(), targetHoverId: '688' });
  const ctx = context({ managedId: '380' });
  const reach = buildReach(st, ctx);
  assert.deepEqual(Object.keys(reach).sort(), ['attackerId', 'hoverId', 'ids', 'keepIds', 'preview', 'selectedId']);
  assert.equal(reach.attackerId, '380');
  assert.deepEqual(reach.ids, pending().optionIds);
  assert.deepEqual(reach.keepIds, ['380', ...pending().optionIds]);
  assert.equal(reach.selectedId, '348');
  assert.equal(reach.hoverId, '688');
  assert.equal(reach.preview, null, 'no board → no preview, and no throw');
  assert.equal(buildReach({ ...st, targetHoverId: '756' }, ctx).hoverId, null);
  assert.equal(buildReach(state(), ctx), null);
  assert.equal(buildReach({ phase: 'loading', teams: {} }, { board: null }), null);
});

test('reach preview: dashed atk-shaped route from the attacker to the selection, no RNG (tiny board)', () => {
  const points = { '380': [100, 100], '348': [160, 100], '688': [100, 170] };
  const paths = Object.fromEntries(Object.entries(points).map(([id, [cx, cy]]) => [id, {
    cx, cy, area: 900, d: `M${cx - 25},${cy - 25}h50v50h-50Z`, bbox: { x: cx - 25, y: cy - 25, w: 50, h: 50 },
    labelRings: [[[cx - 25, cy - 25], [cx + 25, cy - 25], [cx + 25, cy + 25], [cx - 25, cy + 25]]],
  }]));
  const own = { '380': '380', '348': '348', '688': '688' };
  const geo = { paths, adj: { '380': ['348', '688'], '348': ['380'], '688': ['380'] } };
  const board = { geo, routingPaths: paths, own, aliveIds: ['380', '348', '688'] };
  const st = state({ own, aliveIds: ['380', '348', '688'], pendingTarget: pending({ optionIds: ['348', '688'], selectedId: '348' }) });
  const ctx = context({ managedId: '380', board, geo });
  const reach = buildReach(st, ctx);
  assert.ok(reach.preview, 'createTargetedDraw/routeToTarget give a route on the tiny board');
  assert.equal(reach.preview.dashed, true);
  assert.deepEqual([reach.preview.x1, reach.preview.y1], [100, 100], 'starts at the attacker');
  for (const field of ['x2', 'y2']) assert.ok(Number.isFinite(reach.preview[field]), field);
  assert.match(reach.preview.routeD, /^M/);
  assert.ok(Array.isArray(reach.preview.routePoints) && reach.preview.routePoints.length >= 2);
  assert.equal(reach.preview.col, TEAMS['380'].col);
  assert.equal(buildReach(st, ctx).preview, reach.preview, 'memoised on pendingTarget/own');
  // Without a pending choice the DEC D4 reach supplies the options (land tier here).
  const free = targetOptions({ ...st, pendingTarget: null }, context({ managedId: '380', board, geo }), '380');
  assert.deepEqual(free.map(option => option.teamId).sort(), ['348', '688']);
  const anchor = targetCardAnchor(st, ctx);
  assert.equal(anchor.key, 'target-card');
  assert.equal(anchor.align, 'beside');
  assert.equal(anchor.teamId, '348');
  assert.ok(Number.isFinite(anchor.x) && Number.isFinite(anchor.y));
  assert.equal(anchor.card.name, 'Hungary');
  // Without routes the card anchors at the target's largest territory.
  const fallback = targetCardAnchor({ ...st, targetHoverId: '688' }, context({ managedId: '380', geo }));
  assert.equal(fallback.teamId, '688');
  assert.deepEqual([fallback.x, fallback.y], [100, 170]);
});

test('spectator panel model: this turn states, following, managed note and playback (A-14)', () => {
  const ctx = context({ followedId: '380' });
  const idle = buildSpectatorPanel(state({ followedId: '380', pauseFollow: true }), ctx);
  assert.equal(idle.thisTurn.state, 'idle');
  assert.equal(idle.thisTurn.kickerRight, 'Compass draw');
  assert.deepEqual(idle.thisTurn.idle, { title: 'Next draw', route: 'Any of 10 empires can be drawn' });
  assert.equal(idle.followed.name, 'Italy');
  assert.equal(idle.followed.pauseOnEvents, true);
  assert.match(idle.followed.detail, /^4 territories · strength \d+\.\d$/);
  assert.equal(idle.managed, null);
  assert.equal(idle.speed, 2);
  assert.equal(idle.sheet, 'collapsed');
  assert.deepEqual(idle.teams.map(team => team.name), idle.teams.map(team => team.name).slice().sort((a, b) => a.localeCompare(b)));

  // While the needle spins the target stays hidden, like the fixture block, title card and opponent fill (DEC D19).
  for (const stage of ['ready', 'spinning']) {
    const drawing = buildSpectatorPanel(state({ spin: { attackerId: '688', targetId: '380', stage } }), ctx);
    assert.equal(drawing.thisTurn.state, 'drawing', stage);
    assert.equal(drawing.thisTurn.a.name, 'Serbia');
    assert.equal(drawing.thisTurn.b, null, `${stage}: no defender before the lock`);
    assert.equal(drawing.thisTurn.odds, null, `${stage}: no odds before the lock`);
    assert.equal(drawing.thisTurn.pending, 'The compass is choosing the target');
  }
  const locked = buildSpectatorPanel(state({ spin: { attackerId: '688', targetId: '380', stage: 'locked' } }), ctx);
  assert.equal(locked.thisTurn.state, 'locked');
  assert.equal(locked.thisTurn.a.name, 'Serbia');
  assert.equal(locked.thisTurn.b.name, 'Italy');
  assert.match(locked.thisTurn.odds.aLabel, new RegExp(`^${TEAMS['688'].code} \\d+%$`));
  assert.match(locked.thisTurn.odds.bLabel, new RegExp(`^${TEAMS['380'].code} \\d+%$`));
  assert.ok(locked.thisTurn.odds.fill > 0 && locked.thisTurn.odds.fill < 100);
  assert.match(locked.thisTurn.odds.aria, /^Serbia \d+%, Italy \d+%$/);

  const live = buildSpectatorPanel(state({ match: { aId: '688', dId: '380', done: false, applied: false, odds: { a: .37, b: .63 } } }), ctx);
  assert.equal(live.thisTurn.state, 'live');
  assert.equal(live.thisTurn.odds.fill, 37);
  const done = buildSpectatorPanel(state({ match: { aId: '688', dId: '380', done: true, applied: true } }), ctx);
  assert.equal(done.thisTurn.state, 'done');
  assert.equal(done.thisTurn.odds, null, 'a match without odds still builds');

  const ended = buildSpectatorPanel(state({ managementEnded: true, managedTeamId: '348', aliveIds: IDS.filter(id => id !== '348'),
    history: [{ id: 'm1', round: '012', result: { loserId: '348' } }], followedId: '348' }), context());
  assert.deepEqual(ended.managed, { id: '348', name: 'Hungary', alive: false, ended: true });
  assert.equal(ended.followed.detail, 'Eliminated in Round XII');
  assert.equal(buildSpectatorPanel(state({ blitz: true, settings: { pacing: 'blitz' } }), ctx).thisTurn.kickerRight, 'Blitz round');
  assert.equal(buildSpectatorPanel(state({ aliveIds: ['380'] }), ctx).completed, true);
  // Loading: no teams, no board.
  const loading = buildSpectatorPanel({ phase: 'loading', teams: {}, aliveIds: [] }, { board: null });
  assert.equal(loading.followed, null);
  assert.deepEqual(loading.teams, []);
});

// =========================================================================================================
// components

test('TurnStrip renders the round-robin queue with states, current ring size and next', async t => {
  const settings = { ...state().settings, turnOrder: 'round-robin' };
  const model = buildTurnStrip(state({ settings, turnQueue: ['276', '380', '348', '688', '250'], turnIndex: 2,
    aliveIds: IDS.filter(id => id !== '688'), spin: { attackerId: '380', targetId: '348', stage: 'ready' } }), context({ managedId: '380' }));
  const view = await mount(TurnStrip, model, t);
  const strip = view.host.querySelector('section.turn-strip');
  assert.equal(strip.dataset.variant, 'round-robin');
  assert.equal(strip.getAttribute('aria-label'), 'Turn order');
  assert.equal(text(strip.querySelector('.turn-strip__label')), 'Round robin');
  assert.equal(text(strip.querySelector('.turn-strip__detail')), 'Turn 2 of 5 this round');
  assert.equal(text(strip.querySelector('.turn-strip__tail')), 'this round');
  const flags = [...strip.querySelectorAll('.turn-strip__flag')];
  assert.deepEqual(flags.map(flag => flag.dataset.state), ['done', 'current', 'next', 'out', 'next']);
  assert.equal(flags[1].getAttribute('aria-current'), 'step');
  assert.ok(flags[2].classList.contains('is-next-up'));
  assert.equal(flags[1].querySelector('img').getAttribute('width'), '32');
  assert.equal(flags[0].querySelector('img').getAttribute('width'), '20');
  assert.match(text(flags[1].querySelector('.sr-only')), /^Italy \(you\), attacking now$/);
  assert.equal(text(flags[3].querySelector('.sr-only')), 'Serbia, eliminated');
  assert.match(text(flags[2].querySelector('.sr-only')), /, attacks next$/, 'phones hide "Next: X"; the next-up flag says it');
  assert.equal(strip.querySelector('.turn-strip__flags').tabIndex, 0, 'the scrollable queue is keyboard-reachable');
  assert.equal(text(strip.querySelector('.turn-strip__next')), 'Next: Hungary');
  assert.equal(strip.querySelector('.turn-strip__note'), null);
  await view.render({ variant: null });
  assert.equal(view.host.innerHTML, '');
});

test('TurnStrip renders the random-draw variant with recent attackers and the note', async t => {
  const history = [{ id: 'm1', round: '025', aId: '348', a: { id: '348', code: 'HUN', name: 'Hungary' } },
    { id: 'm2', round: '026', aId: '203', a: { id: '203', code: 'CZE', name: 'Czechia' } }];
  const view = await mount(TurnStrip, buildTurnStrip(state({ history }), context()), t);
  const strip = view.host.querySelector('.turn-strip');
  assert.equal(strip.dataset.variant, 'random');
  assert.equal(text(strip.querySelector('.turn-strip__label')), 'Random draw');
  assert.equal(text(strip.querySelector('.turn-strip__detail')), 'Drawn from 10 empires');
  assert.equal(text(strip.querySelector('.turn-strip__recent-label')), 'Recent attackers');
  assert.deepEqual([...strip.querySelectorAll('.turn-strip__code')].map(text), ['CZE XXVI', 'HUN XXV']);
  assert.equal(text(strip.querySelector('.turn-strip__note')), 'The same empire can be drawn twice in a row');
  assert.equal(text(strip.querySelector('.turn-strip__phone')), 'Random draw · 10 empires');
  assert.equal(strip.querySelector('.turn-strip__phone').hasAttribute('aria-hidden'), false, 'the only phone text is read');
  assert.equal(strip.querySelector('.turn-strip__flags'), null);
  // Recent items have a name at every width (phones hide the codes), read once: the code itself is aria-hidden.
  const items = [...strip.querySelectorAll('.turn-strip__recent-item')];
  assert.deepEqual(items.map(item => text(item.querySelector('.sr-only'))), ['Czechia, Round XXVI', 'Hungary, Round XXV']);
  assert.ok(items.every(item => item.querySelector('.turn-strip__code').getAttribute('aria-hidden') === 'true'));
  // The recent row never scrolls (items that do not fit whole are clipped, still read): no tab stop.
  assert.equal(strip.querySelector('.turn-strip__recent').hasAttribute('tabindex'), false);
});

test('TargetPanel is a radiogroup in [data-space-primary] with roving tabindex, never a dialog (A-8)', async t => {
  const st = state({ pendingTarget: pending() });
  const model = buildTargetPanel(st, context({ managedId: '380' }));
  const calls = { select: [], hover: [], confirm: 0 };
  document.body.focus();
  const view = await mount(TargetPanel, { ...model, onSelect: id => calls.select.push(id), onHover: id => calls.hover.push(id),
    onConfirm: () => { calls.confirm += 1; } }, t);
  const panel = view.host.querySelector('section.target-panel');
  assert.equal(panel.getAttribute('aria-labelledby'), 'target-panel-title');
  assert.equal(text(panel.querySelector('#target-panel-title')), 'Choose a target');
  assert.equal(text(panel.querySelector('.kicker__aside')), '6 neighbours in reach');
  assert.equal(view.host.querySelector('[role="dialog"], [aria-modal]'), null);
  const group = panel.querySelector('[role="radiogroup"]');
  assert.ok(group.hasAttribute('data-space-primary'));
  const radios = [...group.querySelectorAll('[role="radio"]')];
  assert.equal(radios.length, 6);
  const selectedAt = model.rows.findIndex(row => row.teamId === '348');
  assert.deepEqual(radios.map(radio => radio.getAttribute('aria-checked')), model.rows.map(row => String(row.teamId === '348')));
  assert.deepEqual(radios.map(radio => radio.tabIndex), model.rows.map(row => (row.teamId === '348' ? 0 : -1)));
  assert.equal(document.activeElement, radios[selectedAt], 'opening the choice focuses the selected row');
  assert.match(radios[selectedAt].getAttribute('aria-label'), /^Hungary, strength \d+\.\d, spoils 10 territories, win chance \d+%$/);
  assert.equal(text(radios[selectedAt].querySelector('.target-panel__spoils')), '+10');
  assert.ok(radios[selectedAt].querySelector('.target-panel__win').classList.contains(`tone-${model.rows[selectedAt].tone}`));
  assert.equal(text(panel.querySelector('.target-panel__foot')),
    'Spoils are the territories you would annex. Confirm with Attack Hungary in the bar.');

  // Browser/OS shortcuts pass through untouched (Alt+arrows history, Ctrl/Cmd+Home/End, Ctrl+Enter).
  for (const [keyName, modifiers] of [['ArrowRight', { altKey: true }], ['ArrowLeft', { altKey: true }],
    ['Home', { ctrlKey: true }], ['End', { metaKey: true }], ['Enter', { ctrlKey: true }]]) {
    const event = await key(radios[selectedAt], keyName, modifiers);
    assert.equal(event.defaultPrevented, false, `${keyName} with a modifier is not swallowed`);
  }
  assert.deepEqual(calls.select, []);
  assert.equal(calls.confirm, 0);

  await key(radios[selectedAt], 'ArrowDown');
  const after = (selectedAt + 1) % radios.length;
  assert.equal(calls.select.at(-1), model.rows[after].teamId);
  assert.equal(document.activeElement, radios[after]);
  await key(radios[selectedAt], 'End');
  assert.equal(calls.select.at(-1), model.rows.at(-1).teamId);
  await key(radios[selectedAt], 'Home');
  assert.equal(calls.select.at(-1), model.rows[0].teamId);
  await key(radios[selectedAt], 'Enter');
  assert.equal(calls.confirm, 1, 'Enter on the selected row confirms');
  await key(radios[after], 'Enter');
  assert.equal(calls.confirm, 1, 'Enter on another row only selects it');
  assert.equal(calls.select.at(-1), model.rows[after].teamId);
  // A held Enter auto-repeats onto the row its first press selected: only a fresh press attacks.
  const repeated = await key(radios[selectedAt], 'Enter', { repeat: true });
  assert.equal(calls.confirm, 1, 'an auto-repeated Enter never confirms the attack');
  assert.equal(repeated.defaultPrevented, true);
  await click(radios[2]);
  assert.equal(calls.select.at(-1), model.rows[2].teamId);
  // React emulates pointerenter/leave from pointerover/pointerout with a relatedTarget.
  await act(async () => radios[3].dispatchEvent(new dom.window.MouseEvent('pointerover', { bubbles: true, relatedTarget: document.body })));
  assert.equal(calls.hover.at(-1), model.rows[3].teamId, 'hovering a row reports it');
  await act(async () => radios[3].dispatchEvent(new dom.window.MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body })));
  assert.equal(calls.hover.at(-1), null, 'leaving the list clears the hover');

  // Selection moved from the map: the roving tab stop follows it.
  await view.render({ ...model, rows: model.rows.map(row => ({ ...row, selected: row.teamId === model.rows[2].teamId })),
    selectedId: model.rows[2].teamId, onSelect() {}, onHover() {}, onConfirm() {} });
  assert.equal(group.querySelectorAll('[role="radio"]')[2].getAttribute('aria-checked'), 'true');
  assert.equal(group.querySelectorAll('[role="radio"]')[2].tabIndex, 0);
});

test('TargetCard renders the M§5.5 copy with the win tone', async t => {
  const card = buildTargetCard(state({ pendingTarget: pending() }), context({ managedId: '380' }));
  const view = await mount(TargetCard, card, t);
  const node = view.host.querySelector('.target-card');
  assert.equal(text(node.querySelector('.target-card__name')), 'Hungary');
  assert.equal(text(node.querySelector('.target-card__line')), card.line1);
  assert.ok(node.querySelector('.target-card__win').classList.contains(`tone-${card.tone}`));
  assert.deepEqual([...node.querySelectorAll('.target-card__stake')].map(text),
    ['Win: +10 territories and one player', 'Lose: Italy falls — campaign over']);
  await view.render({});
  assert.equal(view.host.innerHTML, '');
});

test('SpectatorPanel: idle copy, the draw with odds, and the match card slot whenever a match exists', async t => {
  const ctx = context({ followedId: '380' });
  const view = await mount(SpectatorPanel, buildSpectatorPanel(state({ followedId: '380' }), ctx), t);
  const panel = view.host.querySelector('section.spectator-panel');
  assert.equal(panel.getAttribute('aria-label'), 'Spectator');
  assert.equal(panel.dataset.sheet, 'collapsed');
  assert.equal(text(panel.querySelector('.this-turn .kicker__title')), 'This turn');
  assert.equal(text(panel.querySelector('.this-turn .kicker__aside')), 'Compass draw');
  assert.equal(text(panel.querySelector('.this-turn__title')), 'Next draw');
  assert.equal(text(panel.querySelector('.this-turn__route')), 'Any of 10 empires can be drawn');

  // Spinning: the attacker and "The compass is choosing the target" — no defender, connector or odds yet.
  const spinning = buildSpectatorPanel(state({ followedId: '380', spin: { attackerId: '688', targetId: '380', stage: 'spinning' } }), ctx);
  await view.render(spinning);
  assert.equal(panel.querySelector('.this-turn').dataset.state, 'drawing');
  assert.deepEqual([...panel.querySelectorAll('.this-turn__name')].map(text), ['Serbia']);
  assert.equal(text(panel.querySelector('.this-turn__pending')), 'The compass is choosing the target');
  assert.ok(panel.querySelector('.this-turn__pending .this-turn__compass'), 'the compass glyph leads the line');
  assert.equal(panel.querySelector('.this-turn__connector'), null);
  assert.equal(panel.querySelector('.this-turn__odds'), null);
  assert.doesNotMatch(panel.querySelector('.this-turn').textContent, /Italy|ITA/, 'the target is not named while the needle spins');

  const drawing = buildSpectatorPanel(state({ followedId: '380', spin: { attackerId: '688', targetId: '380', stage: 'locked' } }), ctx);
  await view.render(drawing);
  assert.equal(panel.querySelector('.this-turn__pending'), null);
  const names = [...panel.querySelectorAll('.this-turn__name')].map(text);
  assert.deepEqual(names, ['Serbia', 'Italy']);
  const eff = panel.querySelector('.this-turn__eff');
  assert.equal(eff.hasAttribute('aria-label'), false, 'no name on a generic span');
  assert.equal(eff.textContent, `strength ${drawing.thisTurn.a.eff}`);
  assert.equal(text(eff.querySelector('.sr-only')), 'strength');
  assert.equal(text(panel.querySelector('.this-turn__connector')), 'compass points to');
  assert.equal(panel.querySelector('.this-turn__fill').style.width, `${drawing.thisTurn.odds.fill}%`);
  assert.equal(panel.querySelector('.this-turn__bar').getAttribute('aria-label'), drawing.thisTurn.odds.aria);
  assert.deepEqual([...panel.querySelectorAll('.this-turn__labels span')].map(text),
    [drawing.thisTurn.odds.aLabel, 'Win chance', drawing.thisTurn.odds.bLabel]);

  const live = buildSpectatorPanel(state({ followedId: '380', match: { aId: '688', dId: '380', done: false, applied: false } }), ctx);
  const card = React.createElement('section', { 'data-testid': 'match-card', className: 'fi-match' }, 'compact card');
  await view.render({ ...live, matchCard: card });
  assert.equal(text(panel.querySelector('.this-turn [data-testid="match-card"]')), 'compact card');
  assert.equal(panel.querySelector('.this-turn__draw'), null);
  // Done/applied (and a completed campaign) keep the slot.
  const finished = buildSpectatorPanel(state({ followedId: '380', aliveIds: ['380'], match: { aId: '688', dId: '380', done: true, applied: true } }), ctx);
  await view.render({ ...finished, matchCard: card });
  assert.ok(panel.querySelector('[data-testid="match-card"]'));
  assert.equal(panel.querySelector('.follow-autoplay__toggle').disabled, true, 'autoplay is off once the campaign is complete');
});

test('SpectatorPanel following: managed identity pinned, picker, pause switch, autoplay and speed', async t => {
  const calls = { follow: [], pause: [], toggle: 0, speed: [] };
  const handlers = { onFollow: id => calls.follow.push(id), onPauseFollow: value => calls.pause.push(value),
    onToggleAutoplay: () => { calls.toggle += 1; }, onSpeed: n => calls.speed.push(n) };
  // Ported from further-ui (DEC D16): the managed note is separate from the followed-team picker.
  const teams = [{ id: 'a', name: 'Alfa' }, { id: 'c', name: 'Gamma' }, { id: 'z', name: 'Zulu', alive: false }];
  const view = await mount(SpectatorPanel, { managed: { id: 'a', name: 'Alfa', alive: true, ended: true },
    followed: { id: 'c', name: 'Gamma', alive: true, detail: '3 territories · strength 81.0' }, teams, autoplay: true, speed: 2,
    pauseFollow: false, ...handlers }, t);
  const managed = view.host.querySelector('[aria-label="Managed team"]');
  assert.match(managed.textContent, /Alfa/);
  assert.equal(managed.querySelector('select'), null);
  const selector = view.host.querySelector('select#followed-team');
  // WCAG 2.5.3: the visible "Change" starts the select's accessible name.
  assert.equal(view.host.querySelector('label[for="followed-team"]').textContent, 'Change followed team');
  assert.equal(selector.value, 'c');
  assert.deepEqual([...selector.options].map(option => option.textContent), ['No followed team', 'Alfa', 'Gamma', 'Zulu · eliminated']);
  assert.equal(view.host.querySelector('.follow-change__label').firstChild.textContent, 'Change');
  await act(async () => { selector.value = 'a'; selector.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  assert.deepEqual(calls.follow, ['a']);
  assert.match(managed.textContent, /Alfa/);
  assert.equal(text(view.host.querySelector('.follow-team__name')), 'Gamma');
  assert.equal(text(view.host.querySelector('.follow-team__detail')), '3 territories · strength 81.0');

  const pause = view.host.querySelector('.follow-pause');
  assert.equal(pause.getAttribute('role'), 'switch');
  assert.equal(pause.getAttribute('aria-checked'), 'false');
  assert.equal(text(pause), 'Pause when Gamma plays');
  await click(pause);
  assert.deepEqual(calls.pause, [true]);

  const toggle = view.host.querySelector('.follow-autoplay__toggle');
  assert.equal(toggle.getAttribute('role'), 'switch');
  assert.equal(toggle.getAttribute('aria-checked'), 'true');
  assert.equal(text(toggle), 'Autoplay on');
  await click(toggle);
  assert.equal(calls.toggle, 1);
  const speeds = [...view.host.querySelectorAll('.follow-speed button')];
  assert.deepEqual(speeds.map(text), ['1×', '2×', '4×']);
  assert.deepEqual(speeds.map(button => button.getAttribute('aria-pressed')), ['false', 'true', 'false']);
  await click(speeds[2]);
  assert.deepEqual(calls.speed, [4]);

  // Nobody followed: a "Choose" picker, no pause switch.
  await view.render({ followed: null, teams, autoplay: false, speed: 1, sheet: 'expanded', ...handlers });
  assert.equal(text(view.host.querySelector('.follow-team__name')), 'No team followed');
  assert.equal(view.host.querySelector('label[for="followed-team"]').textContent, 'Choose a team to follow');
  assert.equal(view.host.querySelector('.follow-pause'), null);
  assert.equal(view.host.querySelector('[aria-label="Managed team"]'), null);
  assert.equal(text(view.host.querySelector('.follow-autoplay__toggle')), 'Autoplay off');
  assert.equal(view.host.querySelector('.spectator-panel').dataset.sheet, 'expanded');
  // Buttons whose exact text smoke looks up stay unique to the masthead (Play campaign / Pause / Next match).
  const labels = [...view.host.querySelectorAll('button')].map(button => button.textContent.trim());
  for (const reserved of ['Play campaign', 'Pause', 'Next match', 'Finish match', 'Continue']) assert.ok(!labels.includes(reserved), reserved);

  // An eliminated followed team never plays again: no pause switch.
  await view.render({ followed: { id: 'z', name: 'Zulu', alive: false, detail: 'Eliminated in Round XII' }, teams, ...handlers });
  assert.equal(text(view.host.querySelector('.follow-team__name')), 'Zulu');
  assert.equal(view.host.querySelector('.follow-pause'), null);
});

test('SpectatorPanel tolerates the W1 transitional model (partial followed/managed, no thisTurn)', async t => {
  // The shape src/app/turnMethods.jsx's W1 stub passes until the wiring pass: nobody followed, a live manager.
  const view = await mount(SpectatorPanel, { followed: { id: null, name: undefined, alive: true, controlled: false, pauseOnEvents: false },
    managed: { id: '380', name: 'Italy', alive: true, ended: false }, teams: [{ id: '380', name: 'Italy', alive: true }],
    pauseFollow: false, autoplay: false, speed: 1, onFollow() {}, onPauseFollow() {}, onSpeed() {} }, t);
  assert.equal(text(view.host.querySelector('.this-turn__title')), 'Next draw');
  assert.equal(view.host.querySelector('.this-turn__route'), null);
  assert.equal(text(view.host.querySelector('.follow-team__name')), 'No team followed');
  assert.equal(view.host.querySelector('.follow-pause'), null, 'no "Pause when  plays"');
  assert.equal(view.host.querySelector('[aria-label="Managed team"]'), null, 'a live manager has no managed-team note');
  assert.equal(view.host.querySelector('select#followed-team').value, '');
  // A followed team without detail renders no blank line.
  await view.render({ followed: { id: '380', name: 'Italy', alive: true }, teams: [{ id: '380', name: 'Italy' }], onFollow() {} });
  assert.equal(text(view.host.querySelector('.follow-team__name')), 'Italy');
  assert.equal(view.host.querySelector('.follow-team__detail'), null);
});

test('turns.css: state rules the primitives would otherwise override, phone strip and touch targets', () => {
  const css = readFileSync(new URL('../src/screens/turns/turns.css', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const block = query => {
    const at = css.indexOf(query);
    assert.ok(at >= 0, query);
    let depth = 0, i = css.indexOf('{', at);
    const start = i;
    for (; i < css.length; i++) { if (css[i] === '{') depth++; else if (css[i] === '}' && --depth === 0) break; }
    return css.slice(start, i + 1);
  };
  // The pressed speed chip keeps ink/white on hover: (0,4,1) beats `.segmented > button:hover:not(:disabled)` (0,3,1).
  assert.match(css, /\.follow-speed\.segmented > button\[aria-pressed=true\]:hover\s*\{[^}]*background:var\(--ink\);\s*color:#fff;/);
  // Wide chips stay at least 44px on coarse pointers.
  assert.match(block('@media (min-width:1600px) {\n  .follow-pause'), /\.follow-speed\.segmented > button \{[^}]*min-height:max\(36px, var\(--tap\)\)/);
  // A-15 phone strip: "Turn N of M" + current + next flag only.
  assert.match(block('@media (max-width:699.98px) {\n  .turn-strip {'), /\.turn-strip__next \{ display:none; \}/);
  // Recent attackers show whole items only (a one-line wrapping box that clips the rest), never a cut-off last item
  // in a scrolling row (820 tablet).
  assert.match(block('.turn-strip__recent {'), /flex-wrap:wrap/);
  assert.match(block('.turn-strip__recent {'), /overflow:hidden/);
  assert.doesNotMatch(css, /\.turn-strip__recent \{[^}]*overflow-x:auto/);
  // The keyboard ring on the checked row sits outside the 1.5px `you` inset.
  assert.match(css, /\.target-panel__row\.is-selected:focus-visible \{ outline-offset:1px; \}/);
  // Tablet (700–1199): This turn (done card) + Following + Autoplay share the left half of the 820×1180 column, so the
  // rhythm tightens there only. Phone keeps its own values (the queries start at 700px), and the overrides come after
  // the base rules they replace (equal specificity, so source order decides).
  const tablet = '@media (min-width:700px) and (max-width:1199.98px) {';
  assert.match(css, /@media \(min-width:700px\) and \(max-width:1199\.98px\) \{ \.spectator-panel \{ --sp-gap:14px; \} \}/);
  assert.doesNotMatch(css, /@media \(max-width:1199\.98px\) \{ \.spectator-panel \{ --sp-gap/, 'no tablet gap leaks into phone');
  const rhythm = block(`${tablet}\n  .this-turn__card`);
  assert.match(rhythm, /\.this-turn__card \{ margin-top:10px; \}/);
  assert.match(rhythm, /\.follow-team \{ margin-top:6px; \}/);
  assert.match(rhythm, /\.follow-pause \{ margin-top:4px; min-height:max\(24px, var\(--tap\)\); \}/, '24px target, --tap on coarse pointers');
  assert.match(rhythm, /\.follow-autoplay \{ padding-top:6px; \}/);
  const after = css.indexOf(`${tablet}\n  .this-turn__card`);
  for (const base of ['.this-turn__card { margin-top:12px', '.follow-team { display:flex', '.follow-pause {\n', '.follow-autoplay { display:flex']) {
    assert.ok(css.indexOf(base) >= 0 && css.indexOf(base) < after, `${base.trim()} precedes the tablet overrides`);
  }
});

test('component renders are console-clean', () => {
  assert.deepEqual(consoleErrors, []);
});
