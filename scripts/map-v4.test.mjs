// Owner: WP-MAP (see PLAN.md §4, §5.2). The v4 flat map: fills by rule, spectator identity, hatch, border layers,
// outlines, capitals, labels and their viewport tiers, the your-turn reach veil, the dashed preview, anchors,
// tooltip copy, map chrome and hide/unhide stability. Bundles the real JSX (classic transform) with esbuild + jsdom.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const compiled = await build({
  stdin: { contents: `
    export { default as WorldMap, placeAnchor, starPath } from './src/components/WorldMap.jsx';
    export { computeFitView, conquestLayout, THEATRE_LAYOUT } from './src/hooks/useMapViewport.js';
    export * as mapVM from './src/viewModels/map.js';
    export { matchupOdds, winChanceFor } from './src/viewModels/odds.js';
    export { winTone } from './src/viewModels/format.js';
    export { empireFill, V4, MAP } from './src/theme.js';
    export { buildTeam, makeRng, teamEff } from './src/data/teams.js';
    export { getSport } from './src/sports/index.js';
  `, resolveDir: root, loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom'],
  loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
  plugins: [{
    // Count real label layouts, exactly like smoke.mjs does, to prove hide/unhide and mode switches never relayout.
    name: 'count-label-layouts',
    setup(builder) {
      builder.onLoad({ filter: /[\\/]EmpireLabels\.jsx$/ }, async ({ path }) => {
        const source = await readFile(path, 'utf8');
        const instrumented = source.replace('import { createEmpireLabelEngine }', 'import { createEmpireLabelEngine as realCreateEmpireLabelEngine }');
        if (instrumented === source) throw new Error('EmpireLabels factory import changed');
        return { loader: 'jsx', contents: `${instrumented}
function createEmpireLabelEngine(...args) {
  const engine = realCreateEmpireLabelEngine(...args);
  return { ...engine, layout(...inputs) { globalThis.__mapV4Layouts = (globalThis.__mapV4Layouts || 0) + 1;
    globalThis.__mapV4LastLayout = inputs[0]; return engine.layout(...inputs); } };
}` };
      });
    },
  }],
});
const bundle = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), bundle, bundle.exports);
const { WorldMap, placeAnchor, starPath, mapVM, matchupOdds, winChanceFor, winTone, empireFill, V4, MAP, buildTeam, makeRng,
  teamEff, getSport, computeFitView, conquestLayout, THEATRE_LAYOUT } = bundle.exports;

const css = await readFile(new URL('../src/components/map.css', import.meta.url), 'utf8');
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const style = document.createElement('style');
style.textContent = css;
document.head.append(style);
const { createRoot } = await import('react-dom/client');
after(() => dom.window.close());

// ---- fixtures: Italy, Serbia, Austria and one neutral shape on a 960×540 world ----
const sport = getSport('football');
const rng = makeRng(2033);
const teams = Object.fromEntries(['380', '688', '040'].map(id => [id, buildTeam(id, rng, sport)]));
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const SHAPES = [
  { id: '380', ring: rect(100, 100, 300, 200) },
  { id: '688', ring: rect(400, 100, 300, 200) },
  { id: '040', ring: rect(700, 100, 200, 200) },
  { id: '999', ring: rect(100, 300, 300, 150) },
];
const pathD = ring => 'M' + ring.slice(0, -1).map(point => point.join(',')).join('L') + 'Z';
const labelGeometry = SHAPES.map(shape => ({ id: shape.id, rings: [shape.ring] }));
const OWN = { '380': '380', '688': '688', '040': '040' };
const LABELS = Object.keys(teams).map(id => ({ id, text: teams[id].name.toUpperCase() }));

function mapProps({ own = OWN, mapMode = 'political', ...overrides } = {}) {
  const calls = { click: [], enter: [], exit: [], move: [], mode: [], whole: 0, leave: 0 };
  const countries = SHAPES.map(shape => {
    const ownerId = own[shape.id] || null;
    return {
      id: shape.id, ownerId, ownerName: teams[ownerId]?.name, name: shape.id === '999' ? 'Neutralia' : teams[shape.id].name,
      d: pathD(shape.ring), cursor: ownerId ? 'pointer' : 'default',
      fill: mapVM.countryFill({ countryId: shape.id, ownerId, owner: teams[ownerId], mapMode }),
      onClick: () => calls.click.push(shape.id), onEnter: () => calls.enter.push(shape.id),
      onLeave: () => calls.exit.push(shape.id),
    };
  });
  return { calls, props: {
    countries, flagPatterns: [], graticule: { d: 'M0 270H960M480 0V540' }, homes: [], battleMarks: [], labels: LABELS,
    labelGeometry, ownership: own, tooltip: {}, playing: true, svgRef: React.createRef(), mapMode,
    onMapMode: mode => calls.mode.push(mode), onPointerMove: event => calls.move.push(event),
    onPointerLeave: () => { calls.leave++; },
    ...overrides,
  } };
}

async function mount(props) {
  const host = document.createElement('div');
  document.body.append(host);
  const reactRoot = createRoot(host);
  const view = {
    host, props,
    q: selector => host.querySelector(selector), qa: selector => [...host.querySelectorAll(selector)],
    async render(next) { view.props = next; await act(async () => reactRoot.render(React.createElement(WorldMap, next))); },
    async close() { await act(async () => reactRoot.unmount()); host.remove(); },
  };
  await view.render(props);
  return view;
}

async function withViewport(width, run) {
  const previous = Object.getOwnPropertyDescriptor(dom.window, 'innerWidth');
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: width });
  try { return await run(); } finally {
    if (previous) Object.defineProperty(dom.window, 'innerWidth', previous);
    else delete dom.window.innerWidth;
  }
}
const viewBox = view => view.q('svg.political-map').getAttribute('viewBox').split(' ').map(Number);
const num = (node, attribute) => Number(node.getAttribute(attribute));
const cssRule = selector => [...style.sheet.cssRules].find(rule => rule.selectorText === selector);

// ---- pure view-models ----

test('empire pastels follow the README hash (verified fixture values)', () => {
  for (const [id, fill] of [['380', '#dcd3e6'], ['688', '#cddfe2'], ['276', '#e6dcc7'], ['250', '#ebe2b9'],
    ['348', '#d6dbe8'], ['040', '#d8e4c4'], ['724', '#e8d9c2']]) assert.equal(empireFill(id), fill, id);
});

test('country fills follow the rule order: flags, neutral, flags mode, strength, fronts, political, identity', () => {
  const italy = teams['380'];
  const club = { id: 'c1', kind: 'club', col: '#123456' };
  const fill = args => mapVM.countryFill({ countryId: '380', ownerId: '380', owner: italy, ...args });
  assert.equal(fill({ hasFlagParts: true, meId: '380', meFill: true }), 'transparent', 'flag patterns are never recoloured');
  assert.equal(mapVM.countryFill({ countryId: '999' }), V4.landNeutral, 'unowned land is land-neutral');
  assert.equal(mapVM.countryFill({ countryId: '380', setup: true }), empireFill('380'), 'setup shows nation pastels');
  assert.equal(fill({}), empireFill('380'), 'political = pastel by hash');
  assert.equal(fill({ meId: '380', meFill: false }), empireFill('380'), 'a followed (spectator) empire keeps its pastel');
  assert.equal(fill({ meId: '380', meFill: true }), V4.youFill, 'a managed empire is you-fill');
  assert.equal(fill({ opponentId: '380' }), V4.opponentFill, 'the known next opponent is opponent-fill');
  assert.equal(fill({ mapMode: 'flags', meId: '380', meFill: true }), empireFill('380'), 'flags mode never shows you-fill');
  assert.equal(mapVM.countryFill({ countryId: 'x', ownerId: 'c1', owner: club, mapMode: 'flags' }), '#123456', 'clubs fly their colour in Flags');
  assert.equal(mapVM.countryFill({ countryId: 'x', ownerId: 'c1', owner: club }), empireFill('c1'), 'clubs are pastel in Political');
  assert.equal(fill({ mapMode: 'strength', strength: { '380': MAP.strengthRamp[3] } }), MAP.strengthRamp[3]);
  assert.equal(fill({ mapMode: 'strength', strength: { '380': MAP.strengthRamp[3] }, meId: '380', meFill: true }), V4.youFill);
  assert.equal(fill({ mapMode: 'fronts', fronts: { '688': MAP.frontsTint.gain } }), V4.landNeutral, 'non-fronts are neutral');
  assert.equal(mapVM.countryFill({ countryId: '688', ownerId: '688', owner: teams['688'], mapMode: 'fronts',
    fronts: { '688': MAP.frontsTint.gain }, opponentId: '688' }), MAP.frontsTint.gain, 'fronts keep the win-chance tint');
  assert.equal(fill({ mapMode: 'fronts', fronts: null }), empireFill('380'), 'no perspective → stays political');
});

const playingState = (extra = {}) => ({ phase: 'playing', teams, aliveIds: Object.keys(teams), own: { ...OWN },
  history: [], round: 4, followedId: null, ...extra });

test('identity: managed you-fill, spectator follows without you-fill, opponent only once the fixture is known', () => {
  const managed = { managedId: '380', followedId: null };
  const spectator = { managedId: null, followedId: '380' };
  assert.deepEqual(mapVM.mapIdentity(playingState(), managed), { meId: '380', meFill: true, opponentId: null });
  assert.deepEqual(mapVM.mapIdentity(playingState(), spectator), { meId: '380', meFill: false, opponentId: null });
  assert.equal(mapVM.mapMeId(playingState(), { managedId: null, followedId: null }), null);
  const spinning = { spin: { stage: 'spinning', attackerId: '380', targetId: '688' } };
  assert.equal(mapVM.mapOpponentId(playingState(spinning), managed), null, 'a spinning draw reveals nothing yet');
  assert.equal(mapVM.mapOpponentId(playingState({ spin: { ...spinning.spin, stage: 'locked' } }), managed), '688');
  assert.equal(mapVM.mapOpponentId(playingState({ tacticalChoice: { aId: '688', dId: '380' } }), managed), '688');
  assert.equal(mapVM.mapOpponentId(playingState({ match: { aId: '040', dId: '380', applied: false } }), managed), '040');
  assert.equal(mapVM.mapOpponentId(playingState({ match: { aId: '040', dId: '380', applied: true } }), managed), null);
  assert.equal(mapVM.mapOpponentId(playingState({ match: { aId: '040', dId: '688', applied: false } }), managed), null, 'other fixtures');
  const pending = { pendingTarget: { attackerId: '380', optionIds: ['688', '040'], selectedId: '040' } };
  assert.equal(mapVM.mapOpponentId(playingState(pending), managed), '040', 'your selected target is the next opponent');
  assert.equal(mapVM.mapOpponentId(playingState({ match: { aId: '688', dId: '380', applied: false } }), spectator), '688',
    'a spectator sees the followed team’s live opponent');
  assert.equal(mapVM.mapOpponentId(playingState({ choice: {}, match: { aId: '688', dId: '380', applied: false } }), managed), null,
    'the conquest screen has no target');
  for (const phase of ['loading', 'setup']) assert.equal(mapVM.mapOpponentId({ phase, teams: {}, aliveIds: [] }, managed), null);
});

test('strength fills share the quintile bins and lower bounds of strengthSteps; fronts need a perspective', () => {
  const st = playingState();
  const steps = mapVM.strengthSteps(st, {});
  const fills = mapVM.strengthFills(st, {});
  assert.equal(steps.length, 5);
  const effs = Object.fromEntries(Object.keys(teams).map(id => [id, teamEff(teams[id])]));
  const ordered = Object.keys(teams).sort((a, b) => effs[a] - effs[b]);
  assert.equal(fills[ordered[0]], MAP.strengthRamp[0], 'the weakest empire is the lightest');
  assert.equal(fills[ordered.at(-1)], MAP.strengthRamp[4], 'the strongest empire is the darkest');
  for (const id of ordered) {
    const step = steps[MAP.strengthRamp.indexOf(fills[id])];
    assert.ok(effs[id] >= step.min, `${id} is at least its bin's label`);
  }
  assert.deepEqual(mapVM.strengthFills({ teams: {}, aliveIds: [] }, {}), {});
  assert.equal(mapVM.frontsFills(st, { managedId: null, followedId: null }), null);
  assert.equal(mapVM.frontsFills({ phase: 'setup', teams: {}, aliveIds: [] }, { managedId: '380' }), null);
});

test('strength fills agree with the key: every empire wears the step of the highest "X+" label it reaches', () => {
  // The key labels each swatch "X+" from strengthSteps (campaign.js); a rank-based bin disagreed at every quintile
  // boundary when n is not a multiple of 5 (the team defining a label, and its ties, were painted a step lighter).
  const pool = ['100', '191', '196', '203', '208', '233', '246', '250', '276', '300', '348', '352', '372', '380', '040',
    '056', '070', '008', '112', '268', '288', '124'];
  const fieldRng = makeRng(2033);
  const field = Object.fromEntries(pool.map(id => [id, buildTeam(id, fieldRng, sport)]));
  for (const n of [3, 4, 5, 7, 11, 22]) {
    const ids = pool.slice(0, n);
    const roster = Object.fromEntries(ids.map(id => [id, field[id]]));
    // A forced tie: a copy of one team with exactly the same strength.
    const twinOf = ids[Math.floor(n / 2)];
    const twin = { ...field[twinOf], id: 'twin' };
    const stN = { phase: 'playing', teams: { ...roster, twin }, aliveIds: [...ids, 'twin'], own: {}, history: [] };
    const steps = mapVM.strengthSteps(stN, {});
    const fills = mapVM.strengthFills(stN, {});
    const effs = Object.fromEntries(stN.aliveIds.map(id => [id, teamEff(stN.teams[id])]));
    for (const id of stN.aliveIds) {
      const index = MAP.strengthRamp.indexOf(fills[id]);
      assert.ok(index >= 0, `n=${n} ${id}: painted from the ramp`);
      const step = steps[index];
      assert.ok(effs[id] + 1e-9 >= step.min, `n=${n} ${id} ${effs[id]}: reaches its step's label ${step.min}+`);
      assert.ok(!steps.some(other => other.min > step.min && effs[id] + 1e-9 >= other.min),
        `n=${n} ${id} ${effs[id]}: no higher label ${step.min}+ < ${steps.map(s => s.min)} is reached`);
      assert.equal(steps.findIndex(other => other.min === step.min), index, `n=${n} ${id}: the first of equal labels`);
    }
    // The team that defines each label is painted with that label's swatch (or an equal-label swatch below it).
    const sorted = stN.aliveIds.map(id => effs[id]).sort((a, b) => a - b);
    steps.forEach((step, i) => {
      const definer = stN.aliveIds.find(id => effs[id] === sorted[Math.floor(i * sorted.length / 5)]);
      assert.equal(steps[MAP.strengthRamp.indexOf(fills[definer])].min, step.min, `n=${n} step ${i} (${step.min}+)`);
    });
    assert.equal(fills.twin, fills[twinOf], `n=${n}: tied strengths share a step`);
    const ordered = stN.aliveIds.slice().sort((a, b) => effs[a] - effs[b]);
    assert.equal(fills[ordered[0]], MAP.strengthRamp[0], `n=${n}: the weakest is the lightest`);
    assert.equal(steps[MAP.strengthRamp.indexOf(fills[ordered.at(-1)])].min, steps[4].min,
      `n=${n}: the strongest wears the top label (the darkest swatch unless a tie repeats that label)`);
  }
});

test('tooltip copy: held since the conquest round, the result, the squad link; capitals and neutral land', () => {
  const history = [{ round: '012', aId: '380', dId: '688', a: { tid: '380', name: 'Italy', score: '2' },
    b: { tid: '688', name: 'Serbia', score: '1' }, winnerId: '380',
    result: { winnerId: '380', loserName: 'Serbia', territoryIds: ['688'], tieText: null } }];
  const st = playingState({ own: { ...OWN, '688': '380' }, history });
  assert.deepEqual(mapVM.tooltipModel(st, {}, '688'), { visible: true, name: 'Serbia',
    held: 'Held by Italy since Round XII', result: 'Won 2–1 against Serbia', link: 'Click to open the Italy squad' });
  const capital = mapVM.tooltipModel(st, {}, '380');
  assert.equal(capital.held, 'Capital of Italy');
  assert.equal(capital.result, `Strength ${teamEff(teams['380']).toFixed(1)}`);
  // The stored shoot-out text is attacker first (`${tie.ga}–${tie.gd} on penalties`): Serbia attacked and lost 3–4,
  // so Italy (the defender) won it 4–3, and the winner-first line says so.
  const penalties = { ...history[0], aId: '688', dId: '380', a: { tid: '688', name: 'Serbia', score: '1' },
    b: { tid: '380', name: 'Italy', score: '1' }, result: { ...history[0].result, tieText: '3–4 on penalties' } };
  assert.equal(mapVM.tooltipModel({ ...st, history: [penalties] }, {}, '688').result, 'Won 1–1 against Serbia · 4–3 on penalties');
  // An attacker's shoot-out win keeps the stored order; overtime copy is only lower-cased.
  const attackerPens = { ...history[0], result: { ...history[0].result, tieText: '5–4 on penalties' },
    a: { tid: '380', name: 'Italy', score: '2' }, b: { tid: '688', name: 'Serbia', score: '2' } };
  assert.equal(mapVM.tooltipModel({ ...st, history: [attackerPens] }, {}, '688').result, 'Won 2–2 against Serbia · 5–4 on penalties');
  const overtime = { ...penalties, result: { ...penalties.result, tieText: 'After 1 overtime period' },
    a: { tid: '688', name: 'Serbia', score: '98' }, b: { tid: '380', name: 'Italy', score: '101' } };
  assert.equal(mapVM.tooltipModel({ ...st, history: [overtime] }, {}, '688').result, 'Won 101–98 against Serbia · after 1 overtime period');
  const free = mapVM.tooltipModel(playingState({ own: { '380': '380' } }), {}, '040');
  assert.deepEqual(free, { visible: true, name: 'Austria', held: 'Not in this theatre', result: null, link: null });
  assert.equal(mapVM.tooltipModel({ phase: 'setup', teams: {}, own: {} }, {}, '040').held, 'Awaiting campaign');
  assert.equal(mapVM.tooltipModel(st, {}, null).visible, false);
  assert.equal(mapVM.tooltipModel(st, {}, 'no-such-shape').visible, false);
});

test('phone near frame: your holdings plus the known opponent, dependencies excluded', () => {
  const geo = { paths: {
    '380': { bbox: { x: 100, y: 100, w: 300, h: 200 } }, '688': { bbox: { x: 400, y: 100, w: 300, h: 200 } },
    '040': { bbox: { x: 700, y: 100, w: 200, h: 200 } }, '304': { bbox: { x: 0, y: 0, w: 50, h: 50 } } } };
  const ctx = { managedId: '380', followedId: null, geo, displayGeo: null, cache: new Map() };
  const own = { ...OWN, '304': '380' };
  assert.deepEqual(mapVM.nearFocus(playingState({ own }), ctx), { x: 100, y: 100, w: 300, h: 200 }, 'Greenland never stretches it');
  assert.deepEqual(mapVM.nearFocus(playingState({ own, match: { aId: '688', dId: '380', applied: false } }), ctx),
    { x: 100, y: 100, w: 600, h: 200 }, 'the opponent joins once known');
  assert.equal(mapVM.nearFocus(playingState(), { managedId: null, followedId: null, geo }), null);
  assert.equal(mapVM.nearFocus(playingState(), { managedId: '380', geo: null }), null, 'loading has no geometry');
  // Your turn (M§8 "you + reach"): every empire in reach is framed, whichever one is selected.
  const choosing = playingState({ own, pendingTarget: { attackerId: '380', optionIds: ['688', '040'], selectedId: '688' } });
  const reachFrame = mapVM.nearFocus(choosing, ctx);
  assert.deepEqual(reachFrame, { x: 100, y: 100, w: 800, h: 200 }, 'you + every in-reach empire, not only the selection');
  const reselected = { ...choosing, pendingTarget: { ...choosing.pendingTarget, selectedId: '040' } };
  assert.equal(mapVM.nearFocus(reselected, ctx), reachFrame, 'changing the selection never moves the camera');
  assert.deepEqual(mapVM.nearFocus(choosing, { ...ctx, cache: new Map(), managedId: null, followedId: '380' }),
    { x: 100, y: 100, w: 300, h: 200 }, 'a spectator never sees your-turn reach');
});

test('fronts tint: your land fronts by your win chance; the fixture opponent uses the fixture odds (RM §1.9)', () => {
  const board = { geo: { paths: { '380': { cx: 10, cy: 10 }, '688': { cx: 20, cy: 10 }, '040': { cx: 30, cy: 10 } },
    adj: { '380': ['688'], '688': ['380', '040'], '040': ['688'] } }, own: OWN, aliveIds: Object.keys(teams) };
  const ctx = { managedId: '380', followedId: null, board, geo: board.geo, sport, drama: 6, cache: new Map() };
  const tint = p => MAP.frontsTint[winTone(p)];
  const idle = mapVM.frontsFills(playingState(), ctx);
  assert.deepEqual(Object.keys(idle), ['688'], 'only the land tier (Austria shares no border with Italy)');
  assert.equal(idle['688'], tint(winChanceFor(playingState(), ctx, '380', '688')), 'idle: you as the attacker');
  // A live match uses its own odds on your side (Serbia attacks, Italy defends with odds.b).
  for (const [b, tone] of [[.3, 'loss'], [.52, 'even'], [.8, 'gain']]) {
    const live = playingState({ match: { aId: '688', dId: '380', applied: false, done: false, odds: { a: 1 - b, b } } });
    assert.deepEqual(mapVM.fixtureWinChance(live, ctx), { opponentId: '688', p: b });
    assert.equal(mapVM.frontsFills(live, { ...ctx, cache: new Map() })['688'], MAP.frontsTint[tone], `live ${b}`);
  }
  // The tactical gate and a locked draw use the default-approach estimate in the fixture's orientation.
  for (const extra of [{ tacticalChoice: { aId: '688', dId: '380' } },
    { spin: { stage: 'locked', attackerId: '688', targetId: '380' } }]) {
    const st = playingState(extra);
    const p = matchupOdds(st, ctx, '688', '380').defender;
    assert.deepEqual(mapVM.fixtureWinChance(st, ctx), { opponentId: '688', p });
    assert.equal(mapVM.frontsFills(st, ctx)['688'], tint(p));
  }
  assert.equal(mapVM.fixtureWinChance(playingState({ spin: { stage: 'spinning', attackerId: '688', targetId: '380' } }), ctx), null,
    'no fixture while the compass spins (DEC D19)');
  assert.equal(mapVM.fixtureWinChance(playingState({ match: { aId: '688', dId: '040', applied: false, odds: { a: .5, b: .5 } } }), ctx),
    null, 'another empire’s fixture');
});

// ---- WorldMap rendering ----

test('sea, graticule and borders paint in README order with screen-px widths × k', async () => {
  const { props } = mapProps({ own: { '380': '380', '688': '380', '040': '040' } });
  const view = await mount(props);
  try {
    const graticule = view.q('.map-graticule');
    assert.equal(graticule.getAttribute('stroke'), '#ffffff');
    assert.equal(num(graticule, 'stroke-opacity'), .55);
    assert.equal(num(graticule, 'stroke-width'), .6);
    const svg = view.q('svg.political-map');
    const layerOrder = [...svg.children].map(node => node.getAttribute('class')).filter(Boolean);
    assert.deepEqual(layerOrder.slice(0, 5), ['map-graticule', 'country-shapes', 'ownership-borders', 'country-outlines', 'map-capitals']);
    const borders = [...view.q('.ownership-borders').children];
    assert.deepEqual(borders.map(node => node.getAttribute('class')), ['internal-borders', 'empire-borders', 'coast-borders']);
    const [inner, outer, coast] = borders;
    assert.deepEqual([inner.getAttribute('stroke'), num(inner, 'stroke-opacity'), num(inner, 'stroke-width')], ['#ffffff', .75, .6]);
    assert.deepEqual([outer.getAttribute('stroke'), num(outer, 'stroke-width')], ['#ffffff', 1.5]);
    assert.deepEqual([coast.getAttribute('stroke'), num(coast, 'stroke-width')], ['#9aa7ae', .6]);
    assert.match(inner.getAttribute('d'), /M400,100L400,300|M400,300L400,100/, 'Italy–Serbia is now an inner seam');
    assert.match(outer.getAttribute('d'), /700,100/, 'Serbia–Austria stays a border between empires');
    assert.ok(coast.getAttribute('d').length > 0);
    for (const path of view.qa('path[data-country]')) {
      assert.equal(path.getAttribute('stroke'), 'none', 'the mesh draws every line; land has no stroke');
      assert.ok(!String(path.getAttribute('fill')).startsWith('url('));
    }
    await act(async () => view.q('[aria-label="Zoom in"]').click());
    const k = viewBox(view)[2] / 960;
    assert.ok(k < 1);
    assert.ok(Math.abs(num(view.q('.empire-borders'), 'stroke-width') - 1.5 * k) < 1e-9, 'widths stay constant on screen');
    assert.ok(Math.abs(num(view.q('.map-graticule'), 'stroke-width') - .6 * k) < 1e-9);
  } finally { await view.close(); }
});

test('managed identity: you-fill, ink 1.4 outline and star capital; opponent fill and cobalt 1.8 outline', async () => {
  const homes = [{ id: '380', x: 250, y: 200 }, { id: '688', x: 550, y: 200 }, { id: '040', x: 800, y: 200 }];
  const { props } = mapProps({ homes, meId: '380', meFill: true, opponentId: '688' });
  const view = await mount(props);
  try {
    assert.equal(view.q('path[data-country="380"]').getAttribute('fill'), V4.youFill);
    assert.equal(view.q('path[data-country="688"]').getAttribute('fill'), V4.opponentFill);
    assert.equal(view.q('path[data-country="040"]').getAttribute('fill'), empireFill('040'));
    assert.equal(view.q('path[data-country="999"]').getAttribute('fill'), V4.landNeutral);
    const you = view.q('[data-outline="you"]'), opponent = view.q('[data-outline="opponent"]');
    assert.deepEqual([you.getAttribute('stroke'), num(you, 'stroke-width')], ['#111417', 1.4]);
    assert.deepEqual([opponent.getAttribute('stroke'), num(opponent, 'stroke-width')], ['#2f54eb', 1.8]);
    assert.equal(you.nextElementSibling, opponent, 'the opponent outline wins on shared borders');
    const star = view.q('[data-capital="380"]');
    assert.equal(star.tagName.toLowerCase(), 'path');
    assert.equal(star.getAttribute('d'), starPath(250, 200, 5.2, 2.2));
    assert.deepEqual([star.getAttribute('fill'), star.getAttribute('stroke'), num(star, 'stroke-width')], ['#111417', '#ffffff', .9]);
    const square = view.q('[data-capital="688"]');
    assert.equal(square.tagName.toLowerCase(), 'rect');
    assert.deepEqual([num(square, 'x'), num(square, 'y'), num(square, 'width'), num(square, 'height')], [548.1, 198.1, 3.8, 3.8]);
    assert.deepEqual([square.getAttribute('fill'), square.getAttribute('stroke'), num(square, 'stroke-width')], ['#30363b', '#ffffff', .8]);
    const tip = starPath(0, 0, 5.2, 2.2).match(/^M([-\d.]+) ([-\d.]+)/).slice(1).map(Number);
    assert.deepEqual(tip, [0, -5.2], 'the star points straight up');

    await view.render({ ...props, meFill: false, opponentId: null });
    assert.equal(view.q('path[data-country="380"]').getAttribute('fill'), empireFill('380'), 'spectator: pastel kept');
    assert.ok(view.q('[data-outline="you"]'), 'spectator: ink outline kept (A-7)');
    assert.equal(view.q('[data-capital="380"]').tagName.toLowerCase(), 'path', 'spectator: star kept');
    assert.equal(view.q('[data-outline="opponent"]'), null);

    await view.render({ ...props, mapMode: 'flags' });
    assert.equal(view.q('path[data-country="380"]').getAttribute('fill'), empireFill('380'), 'Flags mode keeps base fills');
  } finally { await view.close(); }
});

test('conquest hatch is its own overlay, after the land and before the borders, never a flag tile', async () => {
  const flagPattern = { id: '380-1', ownerId: '380', url: '/flags/it.svg', color: '#d9dcd6', bbox: { x: 100, y: 100, w: 300, h: 200 } };
  const { props } = mapProps({ conquestIds: ['688'], flagPatterns: [flagPattern] });
  const view = await mount(props);
  try {
    const pattern = view.q('pattern[data-conquest-hatch-pattern]');
    assert.ok(pattern && !pattern.id.startsWith('fi-flag-'), pattern?.id);
    assert.equal(pattern.getAttribute('patternTransform'), 'rotate(45)');
    assert.equal(pattern.getAttribute('patternUnits'), 'userSpaceOnUse');
    assert.deepEqual([num(pattern, 'width'), num(pattern, 'height')], [5, 5]);
    const stripe = pattern.querySelector('rect');
    assert.deepEqual([num(stripe, 'width'), num(stripe, 'height'), stripe.getAttribute('fill')], [1.6, 5, 'rgba(255,255,255,.6)']);
    const hatch = view.qa('[data-conquest-hatch]');
    assert.deepEqual(hatch.map(node => node.dataset.conquestHatch), ['688']);
    assert.equal(hatch[0].getAttribute('fill'), `url(#${pattern.id})`);
    assert.equal(hatch[0].hasAttribute('data-country'), false, 'smoke countryPaths() never sees the hatch');
    assert.ok(!view.q('path[data-country="688"]').getAttribute('fill').startsWith('url('));
    assert.equal(view.q('path[data-country="688"]').dataset.conquered, 'true');
    const group = view.q('.conquest-hatch');
    assert.equal(group.previousElementSibling.getAttribute('class'), 'country-shapes');
    assert.equal(group.nextElementSibling.getAttribute('class'), 'ownership-borders');
    assert.ok(view.q('pattern#fi-flag-380-1'), 'flag tiles are untouched');
    assert.match(cssRule('.conquest-hatch path').style.getPropertyValue('animation'), /240ms/, 'fades in (opacity, A-2)');
    await view.render({ ...props, conquestIds: [] });
    assert.equal(view.q('.conquest-hatch'), null);
    assert.equal(view.q('pattern[data-conquest-hatch-pattern]'), null);
  } finally { await view.close(); }
});

test('labels: 700 for your empire, 600 for others, capped by the viewport tier (A-6)', async () => {
  globalThis.__mapV4Layouts = 0;
  const tiers = [[1920, 'wide', 30], [1440, 'std', 22], [1024, 'tablet', 20], [390, 'phone', 18]];
  for (const [width, breakpoint, maxPx] of tiers) {
    await withViewport(width, async () => {
      const { props } = mapProps({ meId: '380', meFill: true });
      const view = await mount(props);
      try {
        assert.equal(view.q('section.world-map').dataset.breakpoint, breakpoint);
        const layout = globalThis.__mapV4LastLayout;
        assert.equal(layout.maxFontPx, maxPx);
        assert.equal(layout.minFontPx, 9);
        assert.equal(layout.trackingEm, .14);
        assert.equal(layout.curveRatio, .05);
        assert.equal(layout.labels.find(label => label.id === '380').minFontPx, 6.5, 'your label shows down to 6.5px');
        assert.equal(layout.labels.find(label => label.id === '688').minFontPx, 9);
        const labels = view.qa('text[data-empire-label]');
        assert.ok(labels.length >= 2, `labels placed at ${width}px`);
        const k = viewBox(view)[2] / 960;
        for (const label of labels) {
          const own = label.dataset.empireLabel === '380';
          assert.equal(label.getAttribute('font-weight'), own ? '700' : '600');
          assert.match(label.getAttribute('font-family'), /Archivo Narrow|Arial Narrow/);
          const px = num(label, 'font-size') / k;
          assert.ok(px <= maxPx + 1e-6 && px >= (own ? 6.5 : 9) - 1e-6, `${label.dataset.empireLabel} ${px}px within ${maxPx}`);
        }
      } finally { await view.close(); }
    });
  }
  // A live resize across a breakpoint re-tiers the labels.
  await withViewport(1440, async () => {
    const { props } = mapProps();
    const view = await mount(props);
    try {
      Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 1700 });
      await act(async () => dom.window.dispatchEvent(new dom.window.Event('resize')));
      assert.equal(view.q('section.world-map').dataset.breakpoint, 'wide');
      assert.equal(globalThis.__mapV4LastLayout.maxFontPx, 30);
    } finally { await view.close(); }
  });
});

test('your turn: veil over out-of-reach land only, dashed cobalt reach outlines, inert land, dashed preview', async () => {
  const homes = [{ id: '380', x: 250, y: 200 }, { id: '688', x: 550, y: 200 }, { id: '040', x: 800, y: 200 }];
  const reach = { attackerId: '380', ids: ['688'], keepIds: ['380', '688'], selectedId: '688', hoverId: null, preview: null };
  const attack = { x1: 250, y1: 200, x2: 550, y2: 200, dashed: true };
  const { props, calls } = mapProps({ homes, reach, meId: '380', meFill: true, opponentId: '688', attack,
    tooltip: { visible: true, name: 'Austria', held: 'Held by Austria' } });
  const view = await mount(props);
  try {
    assert.equal(view.q('section.world-map').dataset.reach, 'choose');
    const veils = view.qa('.reach-veil');
    assert.equal(veils.length, 1, 'one veil path, not a copy of every out-of-reach country');
    assert.deepEqual(veils[0].dataset.veilCountries.split(' ').sort(), ['040', '999'], 'only out-of-reach land (owned or neutral) is veiled');
    assert.equal(veils[0].getAttribute('d'), [SHAPES[2], SHAPES[3]].map(shape => pathD(shape.ring)).join(' '));
    assert.equal(veils[0].getAttribute('fill-rule'), null, 'nonzero fill: no seams between neighbouring shapes');
    assert.equal(view.q('.reach-veil').hasAttribute('fill'), false, 'the veil colour is the CSS switch (A-9)');
    assert.equal(cssRule('.reach-veil').style.getPropertyValue('fill').trim(), 'var(--map-veil)');
    const veilLayer = view.q('.reach-veil-layer');
    assert.equal(veilLayer.previousElementSibling.getAttribute('class'), 'ownership-borders');
    const dashed = view.q('[data-reach-outline="688"]');
    assert.deepEqual([dashed.getAttribute('stroke'), num(dashed, 'stroke-width'), dashed.getAttribute('stroke-dasharray')],
      ['#2f54eb', 2, '5 3']);
    // The dashes must render: browsers restart a dash pattern at every subpath, so the outline is one chained run
    // per border (not one `M a L b` per ring edge), and butt caps keep the 3px gaps open (round caps add 2px).
    assert.equal((dashed.getAttribute('d').match(/M/g) || []).length, 1, `one run around Serbia: ${dashed.getAttribute('d')}`);
    assert.match(dashed.getAttribute('d'), /^M[^M]*(L[^M]*){3}Z$/, 'a closed polyline of its four edges');
    assert.equal(dashed.getAttribute('stroke-linecap'), 'butt');
    assert.ok(dashed.compareDocumentPosition(view.q('[data-outline="opponent"]')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
      'the selected target’s solid outline is drawn over its dashed one');
    const path = id => view.q(`path[data-country="${id}"]`);
    assert.deepEqual(['380', '688', '040', '999'].map(id => path(id).dataset.reach), ['kept', 'in', 'out', 'out']);
    assert.deepEqual(view.qa('[data-country][tabindex]').map(node => node.dataset.country), ['688'], 'only targets are tabbable');
    assert.equal(path('688').getAttribute('tabindex'), '0');
    assert.match(path('688').getAttribute('aria-label'), /held by Serbia\. Choose as target\./);
    assert.match(path('040').getAttribute('aria-label'), /held by Austria\. Out of reach\.$/, 'inert land announces no action');
    assert.match(path('380').getAttribute('aria-label'), /held by Italy\.$/, 'your own land: no action phrase');
    assert.equal(path('040').getAttribute('role'), null);
    assert.equal(path('040').style.cursor, 'default');
    await act(async () => path('040').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    await act(async () => path('040').dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })));
    assert.deepEqual(calls.click, [], 'out-of-reach land is inert');
    assert.deepEqual(calls.enter, [], 'no hover while choosing (the target card replaces the tooltip)');
    await act(async () => path('688').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.deepEqual(calls.click, ['688'], 'in-reach land chooses the target');
    await act(async () => path('688').dispatchEvent(new dom.window.Event('pointermove', { bubbles: true })));
    assert.equal(calls.move.at(-1).target.closest('[data-reach="in"]')?.dataset.owner, '688', 'handleMapMove can resolve the hovered target');
    // Leaving the map straight from a target is forwarded as a move over a non-target, so the hover clears.
    const out = related => new dom.window.PointerEvent('pointerout', { bubbles: true, relatedTarget: related });
    await act(async () => path('688').dispatchEvent(out(null)));
    assert.equal(calls.leave, 1);
    assert.equal(calls.move.at(-1).target, view.q('section.world-map'));
    assert.equal(calls.move.at(-1).target.closest('[data-reach="in"]'), null, 'handleMapMove resolves no target → hoverTarget(null)');
    // Moving from a target onto the map chrome does the same.
    await act(async () => path('688').dispatchEvent(new dom.window.Event('pointermove', { bubbles: true })));
    await act(async () => path('688').dispatchEvent(out(view.q('.map-modes button'))));
    assert.equal(calls.move.at(-1).target, view.q('.map-modes'));
    assert.equal(calls.move.at(-1).target.closest('[data-reach="in"]'), null);
    assert.equal(view.q('.map-tooltip').style.display, 'none', 'no tooltip while choosing');
    assert.deepEqual(view.qa('[data-capital]').map(node => node.dataset.capital).sort(), ['380', '688'], 'capitals only for kept empires');
    assert.ok(view.qa('text[data-empire-label]').every(label => ['380', '688'].includes(label.dataset.empireLabel)), 'labels only for kept empires');
    assert.equal(view.q('.draw-route-line').getAttribute('stroke-dasharray'), '7 5', 'the preview arrow is dashed');

    await view.render({ ...props, reach: null, attack: null });
    assert.equal(view.qa('.reach-veil').length, 0);
    assert.equal(view.q('.map-tooltip').style.display, 'block');
    await act(async () => path('040').dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })));
    assert.deepEqual(calls.enter, ['040'], 'hover returns after the choice');
  } finally { await view.close(); }
});

test('your turn: the roving tab stop starts on the preselected target, not the first in DOM order', async () => {
  const reach = { attackerId: '380', ids: ['688', '040'], keepIds: ['380', '688', '040'], selectedId: '040', hoverId: null, preview: null };
  const { props } = mapProps({ reach, meId: '380', meFill: true, opponentId: '040' });
  const view = await mount(props);
  try {
    assert.deepEqual(view.qa('[data-country][tabindex="0"]').map(node => node.dataset.country), ['040']);
    assert.deepEqual(view.qa('[data-country][tabindex="-1"]').map(node => node.dataset.country), ['688']);
    await view.render({ ...props, reach: { ...reach, selectedId: 'gone' } });
    assert.deepEqual(view.qa('[data-country][tabindex="0"]').map(node => node.dataset.country), ['688'], 'fallback: first target');
    await view.render({ ...props, reach: null });
    assert.deepEqual(view.qa('[data-country][tabindex="0"]').map(node => node.dataset.country), ['380'], 'outside the choice: first land');
  } finally { await view.close(); }
});

test('tooltip panel renders the v4 lines and tolerates the legacy {name, sub} and empty fixtures', async () => {
  const { props } = mapProps({ tooltip: { visible: true, name: 'Serbia', held: 'Held by Italy since Round XII',
    result: 'Won 2–1 against Serbia', link: 'Click to open the Italy squad' } });
  const view = await mount(props);
  try {
    const tip = view.q('.map-tooltip');
    assert.equal(tip.style.display, 'block');
    assert.deepEqual([...tip.children].map(node => [node.className, node.textContent]), [
      ['map-tooltip__name', 'Serbia'], ['map-tooltip__held', 'Held by Italy since Round XII'],
      ['map-tooltip__result', 'Won 2–1 against Serbia'], ['map-tooltip__link', 'Click to open the Italy squad']]);
    assert.equal(cssRule('.map-tooltip__name').style.getPropertyValue('text-transform'), 'uppercase', 'name uppercased by CSS');
    await view.render({ ...props, tooltip: { visible: true, name: 'SERBIA', sub: 'HELD BY ITALY' } });
    assert.equal(view.q('.map-tooltip__held').textContent, 'HELD BY ITALY');
    await view.render({ ...props, tooltip: {} });
    assert.equal(view.q('.map-tooltip').style.display, 'none');
  } finally { await view.close(); }
});

test('the hover tooltip never sticks: leaving land, tabbing off it, hiding or reframing the map drop it (W4 minor #1)', async () => {
  const card = { visible: true, name: 'Serbia', held: 'Capital of Serbia', result: null, link: null };
  const { props, calls } = mapProps({ tooltip: card, focusKey: 0 });
  const view = await mount(props);
  try {
    const path = id => view.q(`path[data-country="${id}"]`);
    const out = (from, to) => act(async () => from.dispatchEvent(new dom.window.MouseEvent('mouseout', { bubbles: true, relatedTarget: to })));
    // Land → sea (the bare svg), land → land and land → off the page each leave the land the pointer was on.
    await out(path('688'), view.q('svg.political-map'));
    assert.deepEqual(calls.exit, ['688'], 'leaving Serbia for the sea drops its hover');
    await out(path('380'), path('688'));
    assert.deepEqual(calls.exit, ['688', '380']);
    assert.deepEqual(calls.enter, ['688'], 'and the land entered takes the hover');
    // Keyboard: focus moving on drops the card; a window blur (no relatedTarget) keeps it.
    await act(async () => path('688').dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true, relatedTarget: null })));
    assert.deepEqual(calls.exit, ['688', '380'], 'window blur keeps the card');
    await act(async () => path('688').dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true, relatedTarget: view.q('.map-modes button') })));
    assert.deepEqual(calls.exit, ['688', '380', '688'], 'tabbing off the land drops its card');
    // Leaving the land still clears a hover held from before a target choice (the enter is off while choosing).
    const reach = { attackerId: '380', ids: ['688'], keepIds: ['380', '688'], selectedId: '688', hoverId: null, preview: null };
    await view.render({ ...props, reach });
    await out(path('040'), view.q('svg.political-map'));
    assert.equal(calls.exit.at(-1), '040');
    await view.render(props);

    // A still pointer: the map hides (another view) or reframes (conquest fit) with no pointer event. The held hover
    // is dropped through onPointerLeave once per change, and never shown while hidden.
    const leaves = calls.leave;
    await view.render({ ...props });
    assert.equal(calls.leave, leaves, 'a plain re-render keeps the hover');
    await view.render({ ...props, hidden: true });
    assert.equal(calls.leave, leaves + 1, 'hiding the map drops the hover');
    assert.equal(view.q('.map-tooltip').style.display, 'none', 'no card while the map is hidden');
    await view.render({ ...props, hidden: true, tooltip: {} });
    await view.render({ ...props, hidden: false, tooltip: {} });
    assert.equal(calls.leave, leaves + 1, 'no hover held → nothing to drop on the way back');
    await view.render({ ...props, tooltip: card });
    assert.equal(view.q('.map-tooltip').style.display, 'block', 'a fresh hover on the visible map shows');
    await view.render({ ...props, tooltip: card, focusLayout: 'conquest', focusKey: 1 });
    assert.equal(calls.leave, leaves + 2, 'the conquest fit moves the land under the pointer: drop the card');
    await view.render({ ...props, tooltip: {}, focusLayout: 'conquest', focusKey: 1 });
    await view.render({ ...props, tooltip: {}, focusLayout: null, focusKey: 1 });
    assert.equal(calls.leave, leaves + 2, 'leaving the conquest with no hover held calls nothing');
  } finally { await view.close(); }
});

test('anchors convert map units to px and clamp to the overlay inset', async () => {
  const view = { x: 100, y: 50, w: 480, h: 270 }, size = { width: 960, height: 540 };
  assert.deepEqual(placeAnchor({ x: 340, y: 185 }, view, size, { inset: 20 }),
    { side: null, left: 480, top: 270, px: 480, py: 270 }, 'centre anchors sit on the point');
  const clamped = placeAnchor({ x: 90, y: 40 }, view, size, { inset: 20 });
  // The callout CSS draws the card 25% of its width left and lifted (33% desktop, 60% phone) off the centred wrapper:
  // the clamp keeps that drawn box (not the wrapper) inside the inset when the land is panned to an edge.
  assert.deepEqual([clamped.left, clamped.top], [20 + 115 + 56, 20 + 33 + 20], 'the drawn card stays inside the inset box');
  const phoneClamped = placeAnchor({ x: 90, y: 40 }, view, { width: 390, height: 330 }, { inset: 12, compact: true });
  assert.deepEqual([phoneClamped.left, phoneClamped.top], [12 + 85 + 48, 12 + 25 + 30], 'the phone card is lifted further');
  const beside = placeAnchor({ x: 500, y: 100, align: 'beside' }, view, size, { inset: 20 });
  assert.equal(beside.side, 'left', 'a card that would cross the right inset flips to the left of the point');
  assert.deepEqual([beside.left, beside.top], [800 - 22, 100 - 44]);
  const right = placeAnchor({ x: 150, y: 300, align: 'beside' }, view, size, { inset: 20 });
  assert.equal(right.side, 'right');
  assert.equal(right.left, 100 + 22);
  assert.equal(right.top, 540 - 20 - 150, 'the card stays above the bottom inset');
  const roomy = placeAnchor({ x: 420, y: 150, align: 'beside' }, view, size, { inset: 20 });
  assert.equal(roomy.side, 'right', 'right of centre but with room for 256px: stays on the right');
  assert.equal(placeAnchor({ x: 420, y: 150, align: 'beside' }, view, { width: 390, height: 330 }, { inset: 12, compact: true }).side,
    'left', 'the 196px phone card flips earlier on a narrow map');
  assert.ok(placeAnchor({ x: 300, y: 200 }, view, size, { inset: 20, rightEdge: 960 - 650 }).left + 115 - 56 <= 960 - 650 - 20,
    'a conquest callout stays clear of the 650px article');
  assert.equal(placeAnchor({ x: NaN, y: 1 }, view, size), null);

  await withViewport(1440, async () => {
    const { props } = mapProps({ anchors: [{ key: 'callout', x: 480, y: 270, align: 'center',
      node: React.createElement('span', { className: 'probe' }, '+3') }] });
    const mapView = await mount(props);
    try {
      const anchor = mapView.q('.map-anchor[data-anchor="callout"]');
      assert.equal(anchor.dataset.align, 'center');
      assert.equal(anchor.querySelector('.probe').textContent, '+3');
      assert.deepEqual([anchor.style.left, anchor.style.top], ['480px', '270px'], 'the world view maps 1:1 at 960×540');
    } finally { await mapView.close(); }
  });
});

test('chrome: four exact mode buttons, zoom group, return, phone Whole map; hidden in conquest view', async () => {
  const { props, calls } = mapProps({ nearFocus: { x: 100, y: 100, w: 600, h: 200 }, onWholeMap: () => { calls.whole++; } });
  const view = await mount(props);
  try {
    const modes = view.qa('.map-modes button');
    assert.deepEqual(modes.map(button => button.textContent), ['Political', 'Strength', 'Fronts', 'Flags']);
    assert.deepEqual(modes.map(button => button.getAttribute('aria-pressed')), ['true', 'false', 'false', 'false']);
    assert.equal(view.q('.map-modes').getAttribute('role'), 'group');
    await act(async () => modes[1].click());
    assert.deepEqual(calls.mode, ['strength']);
    for (const label of ['Zoom in', 'Zoom out', 'Reset view']) assert.ok(view.q(`.map-zoom button[aria-label="${label}"]`), label);
    assert.equal(view.q('.map-whole').textContent, 'Whole map');
    await act(async () => view.q('.map-whole').click());
    assert.equal(calls.whole, 1);
    await view.render({ ...props, wholeMap: true });
    assert.equal(view.q('.map-whole').textContent, 'Your fronts');
    await view.render({ ...props, onMapMode: undefined });
    await act(async () => view.qa('.map-modes button')[3].click()); // no crash without a handler
    for (const selector of ['.map-modes', '.map-zoom', '.map-return', '.map-whole']) {
      const rule = cssRule(`.app-shell[data-view=conquest] .world-map ${selector}`)
        || [...style.sheet.cssRules].find(item => item.selectorText?.split(',').map(part => part.trim())
          .includes(`.app-shell[data-view="conquest"] .world-map ${selector}`) || item.selectorText?.includes(`[data-view=conquest] .world-map ${selector}`));
      assert.ok(rule, `${selector} rule for the conquest view`);
      assert.equal(rule.style.getPropertyValue('display'), 'none');
    }
    await view.render({ ...props, playing: false });
    assert.equal(view.q('.map-modes, .map-zoom, .map-whole, .map-skip-link'), null, 'setup shows no chrome');
    assert.equal(view.q('.empire-borders').getAttribute('d').includes('400,100'), true, 'setup borders are all "between"');
  } finally { await view.close(); }
});

test('hidden keeps the camera and causes no label layout across hide and unhide', async () => {
  const observers = new Set();
  const previousRO = globalThis.ResizeObserver;
  const previousRect = Object.getOwnPropertyDescriptor(dom.window.SVGElement.prototype, 'getBoundingClientRect');
  globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback; } observe() { observers.add(this); } disconnect() { observers.delete(this); } };
  Object.defineProperty(dom.window.SVGElement.prototype, 'getBoundingClientRect', { configurable: true, value() {
    const hidden = !!this.closest('section')?.hidden;
    const width = hidden ? 0 : 960, height = hidden ? 0 : 540;
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height };
  } });
  try {
    const { props } = mapProps({ meId: '380', viewResetKey: 'europe', initialFocus: { x: 100, y: 100, w: 800, h: 350 } });
    const view = await mount(props);
    try {
      await act(async () => view.q('[aria-label="Zoom in"]').click());
      const camera = view.q('svg').getAttribute('viewBox');
      const signature = () => JSON.stringify(view.qa('text[data-empire-label]').map(label =>
        [label.dataset.empireLabel, label.getAttribute('transform'), label.getAttribute('font-size'), label.getAttribute('textLength')]));
      const labels = signature();
      const layouts = globalThis.__mapV4Layouts;
      await view.render({ ...props, hidden: true });
      assert.equal(view.q('section.world-map').hidden, true);
      await act(async () => observers.forEach(observer => observer.callback([])));
      assert.equal(view.q('svg').getAttribute('viewBox'), camera, 'hiding never resets or refits the camera');
      await view.render({ ...props, hidden: false, mapMode: 'flags' });
      await act(async () => observers.forEach(observer => observer.callback([])));
      assert.equal(view.q('section.world-map').hidden, false);
      assert.equal(view.q('svg').getAttribute('viewBox'), camera, 'unhiding restores the same camera');
      assert.equal(signature(), labels);
      assert.equal(globalThis.__mapV4Layouts, layouts, 'no label layout on hide, unhide or a mode switch');
    } finally { await view.close(); }
  } finally {
    if (previousRO) globalThis.ResizeObserver = previousRO; else delete globalThis.ResizeObserver;
    if (previousRect) Object.defineProperty(dom.window.SVGElement.prototype, 'getBoundingClientRect', previousRect);
    else delete dom.window.SVGElement.prototype.getBoundingClientRect;
  }
});

test('framing: theatre window per tier, phone near frame and Whole map, conquest fit then automatic return', async () => {
  const centreOf = (bounds, box) => [((bounds.x + bounds.w / 2) - box[0]) / box[2] * 960, ((bounds.y + bounds.h / 2) - box[1]) / box[3] * 540];
  const theatre = { x: 200, y: 120, w: 400, h: 240 };
  const near = { x: 380, y: 200, w: 120, h: 60 };
  await withViewport(390, async () => {
    const { props } = mapProps({ viewResetKey: 'europe', initialFocus: theatre, nearFocus: near, onWholeMap() {} });
    const view = await mount(props);
    try {
      const [cx, cy] = centreOf(near, viewBox(view));
      assert.ok(Math.abs(cx - 480) < 1e-6 && Math.abs(cy - 270) < 1e-6, 'phone frames your empire + opponent, centred');
      const aspect = 540 / 960;
      assert.ok(Math.abs(viewBox(view)[2] - Math.max(120, 60 / aspect) * 1.55) < 1e-6, 'pad 1.55');
      await view.render({ ...props, wholeMap: true });
      const whole = viewBox(view);
      assert.ok(whole[2] > Math.max(120, 60 / aspect) * 1.55, 'Whole map zooms out to the theatre');
    } finally { await view.close(); }
  });
  await withViewport(1440, async () => {
    const { props } = mapProps({ viewResetKey: 'europe', initialFocus: theatre, nearFocus: near });
    const view = await mount(props);
    try {
      const box = viewBox(view);
      const [, cy] = centreOf(theatre, box);
      assert.ok(Math.abs(cy - (.12 + .86) / 2 * 540) < 1e-6, 'std window t .12 / b .86 (title card above, chrome below)');
      const taken = { x: 430, y: 240, w: 20, h: 15 };
      await view.render({ ...props, focusBounds: taken, focusKey: 1, focusLayout: 'conquest' });
      const [tx, ty] = centreOf(taken, viewBox(view));
      // The measured map is 960px wide here, so r stops 40px short of the 650px article: (960 − 690) / 960.
      const r = Math.min(.5, (960 - 650 - 40) / 960);
      assert.ok(Math.abs(tx - (.03 + r) / 2 * 960) < 1e-6 && Math.abs(ty - 270) < 1e-6, `D1 framing: left of the article, centred (${tx})`);
      assert.equal(view.q('section.world-map').dataset.focusLayout, 'conquest');
      await view.render({ ...props, focusBounds: taken, focusKey: 1, focusLayout: null });
      assert.deepEqual(viewBox(view), box, 'signing returns the camera to the campaign view');
      assert.equal(view.q('.map-return'), null);
    } finally { await view.close(); }
  });
});

// A stubbed canvas: ResizeObserver reports on demand and the SVG measures whatever `canvas.size` says now.
async function withCanvas(canvas, run) {
  const observers = new Set();
  const previousRO = globalThis.ResizeObserver;
  const previousRect = Object.getOwnPropertyDescriptor(dom.window.SVGElement.prototype, 'getBoundingClientRect');
  globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback; } observe() { observers.add(this); } disconnect() { observers.delete(this); } };
  Object.defineProperty(dom.window.SVGElement.prototype, 'getBoundingClientRect', { configurable: true, value() {
    const { width, height } = canvas.size;
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height };
  } });
  const report = () => act(async () => observers.forEach(observer => observer.callback([])));
  try { return await run(report); } finally {
    if (previousRO) globalThis.ResizeObserver = previousRO; else delete globalThis.ResizeObserver;
    if (previousRect) Object.defineProperty(dom.window.SVGElement.prototype, 'getBoundingClientRect', previousRect);
    else delete dom.window.SVGElement.prototype.getBoundingClientRect;
  }
}

test('conquest framing fits the canvas laid out in the same commit (the map widens to full width), then holds it', async () => {
  const taken = { x: 430, y: 240, w: 20, h: 15 };
  const screenCentre = (box, size) => [((taken.x + taken.w / 2) - box[0]) / box[2] * size.width,
    ((taken.y + taken.h / 2) - box[1]) / box[3] * size.height];
  const expectD1 = (view, size, message) => {
    const box = viewBox(view);
    const r = Math.min(.5, (size.width - 650 - 40) / size.width);
    const [x, y] = screenCentre(box, size);
    assert.ok(Math.abs(x - (.03 + r) / 2 * size.width) < 1e-6, `${message}: centre x ${x}`);
    assert.ok(Math.abs(y - .5 * size.height) < 1e-6, `${message}: centre y ${y}`);
    const aspect = size.height / size.width;
    const width = Math.max(taken.w / (r - .03), taken.h / .76 / aspect) * 2.6;
    assert.ok(Math.abs(box[2] - width) < 1e-6, `${message}: pad 2.6 zoom (${box[2]} vs ${width})`);
    assert.ok(Math.abs(box[3] / box[2] - aspect) < 1e-9, `${message}: the view has the canvas aspect`);
  };
  const canvas = { size: { width: 1080, height: 794 } }; // map-view cell at 1440: 1fr minus the 360px column, ticker row
  await withViewport(1440, () => withCanvas(canvas, async report => {
    const { props } = mapProps({ viewResetKey: 'europe', initialFocus: { x: 200, y: 120, w: 400, h: 240 } });
    const view = await mount(props);
    try {
      await report();
      const campaign = viewBox(view);
      // finishMatch: choice + focusLayout + focusBounds + focusKey in one setState; the map grows to all of main.
      canvas.size = { width: 1440, height: 824 };
      await view.render({ ...props, focusBounds: taken, focusKey: 7, focusLayout: 'conquest' });
      expectD1(view, canvas.size, 'first paint of the conquest view');
      const fitted = viewBox(view);
      await report();
      assert.deepEqual(viewBox(view), fitted, 'the late ResizeObserver report keeps the D1 frame');
      // A window resize while the conquest view is untouched re-fits D1 to the new canvas.
      canvas.size = { width: 1300, height: 800 };
      await report();
      expectD1(view, canvas.size, 'after a resize');
      // Once the player zooms, a resize keeps their camera (centre and zoom) instead of re-fitting.
      await act(async () => view.q('[aria-label="Zoom in"]').click());
      const zoomed = viewBox(view);
      canvas.size = { width: 1280, height: 800 };
      await report();
      const after = viewBox(view);
      assert.ok(Math.abs((after[0] + after[2] / 2) - (zoomed[0] + zoomed[2] / 2)) < 1e-9, 'centre kept');
      assert.ok(Math.abs(after[2] - zoomed[2]) < 1e-9, 'zoom kept');
      // Signing returns to the campaign camera (the canvas shrinks back in the same commit).
      canvas.size = { width: 1080, height: 794 };
      await view.render({ ...props, focusBounds: taken, focusKey: 7, focusLayout: null });
      await report();
      const back = viewBox(view);
      assert.ok(Math.abs((back[0] + back[2] / 2) - (campaign[0] + campaign[2] / 2)) < 1e-6
        && Math.abs((back[1] + back[3] / 2) - (campaign[1] + campaign[3] / 2)) < 1e-6
        && Math.abs(back[2] - campaign[2]) < 1e-6, `campaign camera restored (${back} vs ${campaign})`);
      assert.equal(view.q('.map-return'), null);
    } finally { await view.close(); }
  }));
});

test('a reloaded signing keeps the conquest framing over the theatre reset of the same commit (W3 gate)', async () => {
  // resume(): fitMap() bumps viewResetKey and the theatre focus while conquestFocus() sets focusBounds/focusKey/'conquest'
  // in the same setState, and the canvas changes size in that commit (the setup map loses the turn-strip / tablet rows).
  // The deferred theatre re-fit for the new canvas aspect must not replace the explicit D1 fit made after it.
  const taken = { x: 430, y: 240, w: 20, h: 15 };
  const theatre = { x: 200, y: 120, w: 400, h: 240 };
  for (const [width, setupSize, conquestSize] of [[1440, { width: 1440, height: 900 }, { width: 1440, height: 848 }],
    [820, { width: 820, height: 1040 }, { width: 820, height: 560 }]]) {
    const canvas = { size: setupSize };
    await withViewport(width, () => withCanvas(canvas, async report => {
      const { props } = mapProps({ viewResetKey: 1, playing: false });
      const view = await mount(props);
      try {
        await report();
        canvas.size = conquestSize;
        await view.render({ ...props, playing: true, viewResetKey: 2, initialFocus: theatre,
          focusBounds: taken, focusKey: 1, focusLayout: 'conquest' });
        const fitted = viewBox(view);
        await report();
        assert.deepEqual(viewBox(view), fitted, `${width}: the ResizeObserver report keeps the reloaded conquest frame`);
        const box = viewBox(view);
        const cx = taken.x + taken.w / 2, cy = taken.y + taken.h / 2;
        assert.ok(cx > box[0] && cx < box[0] + box[2] && cy > box[1] && cy < box[1] + box[3], `${width}: the taken land is in view`);
        assert.ok(box[2] < 400, `${width}: zoomed in on the taken land, not the theatre (${box})`);
        assert.ok(Math.abs(box[3] / box[2] - conquestSize.height / conquestSize.width) < 1e-9, `${width}: the view has the canvas aspect`);
        if (width === 1440) {
          // The same D1 window as a live signing: left of the 650px article, vertically centred.
          const r = Math.min(.5, (conquestSize.width - 650 - 40) / conquestSize.width);
          const sx = (cx - box[0]) / box[2] * conquestSize.width, sy = (cy - box[1]) / box[3] * conquestSize.height;
          assert.ok(Math.abs(sx - (.03 + r) / 2 * conquestSize.width) < 1e-6 && Math.abs(sy - conquestSize.height / 2) < 1e-6,
            `D1 framing after reload (${sx}, ${sy})`);
        }
        // Signing returns to the campaign camera, not the setup world view.
        await view.render({ ...props, playing: true, viewResetKey: 2, initialFocus: theatre,
          focusBounds: taken, focusKey: 1, focusLayout: null });
        const back = viewBox(view);
        assert.ok(back[2] > 400 - 1e-9 && back[2] < 960, `${width}: back on the theatre after signing (${back})`);
      } finally { await view.close(); }
    }));
  }
});

test('the conquest frame survives resizes across breakpoints (D1 ↔ D2), then signing returns to the theatre of that width', async () => {
  // Crossing 700px swaps the camera's theatre (the phone near frame ↔ the theatre). That used to reset the camera and
  // drop the untouched conquest fit (the phone frame won over D2; the whole theatre showed at 820 with the taken land
  // tiny under the callout). The fit must hold, re-resolved by conquestLayout for the new viewport class.
  const taken = { x: 430, y: 240, w: 20, h: 15 };
  const theatre = { x: 200, y: 120, w: 400, h: 240 };
  const near = { x: 380, y: 200, w: 120, h: 60 };
  const sizes = { std: { width: 1440, height: 824 }, tablet: { width: 820, height: 560 }, phone: { width: 390, height: 520 } };
  const widths = { std: 1440, tablet: 820, phone: 390 };
  const same = (actual, expected, message) => {
    assert.ok(expected && actual.every((value, i) => Math.abs(value - [expected.x, expected.y, expected.w, expected.h][i]) < 1e-6),
      `${message}: ${actual} vs ${expected && [expected.x, expected.y, expected.w, expected.h]}`);
  };
  const expectConquest = (view, tier, message) =>
    same(viewBox(view), computeFitView(taken, sizes[tier], undefined, conquestLayout(tier, sizes[tier].width)), message);
  const canvas = { size: sizes.std };
  await withViewport(1440, () => withCanvas(canvas, async report => {
    const resizeWindow = tier => act(async () => {
      Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: widths[tier] });
      dom.window.dispatchEvent(new dom.window.Event('resize'));
    });
    const { props } = mapProps({ viewResetKey: 'europe', initialFocus: theatre, nearFocus: near, onWholeMap() {} });
    const view = await mount(props);
    try {
      await report();
      const conquest = { ...props, focusBounds: taken, focusKey: 3, focusLayout: 'conquest' };
      await view.render(conquest);
      expectConquest(view, 'std', 'D1 at 1440');
      // The canvas reports before the window's resize event (ResizeObserver first): the fit re-resolves its layout
      // when the viewport class arrives, not only on the next canvas change.
      canvas.size = sizes.tablet;
      await report();
      await resizeWindow('tablet');
      assert.equal(view.q('section.world-map').dataset.breakpoint, 'tablet');
      expectConquest(view, 'tablet', '1440 → 820 (canvas first)');
      // Down to the phone (window event first): the phone near frame becomes the theatre, D2 stays on screen.
      canvas.size = sizes.phone;
      await resizeWindow('phone');
      await report();
      expectConquest(view, 'phone', '820 → 390: D2, not the phone near frame');
      assert.ok(view.q('.map-return'), 'still an explicit fit');
      // Back up to the tablet: the theatre returns, D2 becomes the tablet window, not the whole theatre.
      canvas.size = sizes.tablet;
      await resizeWindow('tablet');
      await report();
      expectConquest(view, 'tablet', '390 → 820: the taken land stays framed');
      // Signing returns to the theatre of the current width.
      await view.render({ ...conquest, focusLayout: null });
      same(viewBox(view), computeFitView(theatre, sizes.tablet, undefined, THEATRE_LAYOUT.tablet), 'signing at 820');
      assert.equal(view.q('.map-return'), null);
    } finally { await view.close(); }
  }));
  // Opened on the phone, then widened: D2 → D1, and signing lands on the std theatre.
  const wide = { size: sizes.phone };
  await withViewport(390, () => withCanvas(wide, async report => {
    const { props } = mapProps({ viewResetKey: 'europe', initialFocus: theatre, nearFocus: near, onWholeMap() {} });
    const view = await mount(props);
    try {
      await report();
      const conquest = { ...props, focusBounds: taken, focusKey: 1, focusLayout: 'conquest' };
      await view.render(conquest);
      expectConquest(view, 'phone', 'D2 at 390');
      wide.size = sizes.std;
      await act(async () => {
        Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 1440 });
        dom.window.dispatchEvent(new dom.window.Event('resize'));
      });
      await report();
      expectConquest(view, 'std', '390 → 1440');
      await view.render({ ...conquest, focusLayout: null });
      same(viewBox(view), computeFitView(theatre, sizes.std, undefined, THEATRE_LAYOUT.std), 'signing at 1440');
    } finally { await view.close(); }
  }));
});

test('"Back to previous view" hands focus to a control that can take it: zoom in, else Whole map, else the map', async () => {
  const { props } = mapProps({ viewResetKey: 'europe', nearFocus: { x: 380, y: 200, w: 120, h: 60 }, onWholeMap() {} });
  const view = await mount(props);
  const bounds = { x: 440, y: 260, w: 30, h: 20 };
  const back = async (next, focusKey) => {
    await view.render({ ...next, focusBounds: bounds, focusKey });
    const button = view.q('.map-return');
    assert.ok(button, `inspection ${focusKey} offers the way back`);
    button.focus();
    await act(async () => button.click());
    assert.equal(view.q('.map-return'), null, 'the button unmounts once the camera is restored');
  };
  try {
    await back(props, 1);
    assert.equal(document.activeElement, view.q('[aria-label="Zoom in"]'), 'desktop and tablet: the zoom control');
    // Below 700px the zoom group is display:none and focus() does nothing there (jsdom ignores CSS: stub that).
    view.q('[aria-label="Zoom in"]').focus = () => {};
    await back(props, 2);
    assert.equal(document.activeElement, view.q('.map-whole'), 'phone: the visible Whole map toggle');
    const noWhole = { ...props, onWholeMap: undefined };
    await view.render({ ...noWhole, focusBounds: bounds, focusKey: 2 });
    assert.equal(view.q('.map-whole'), null);
    view.q('[aria-label="Zoom in"]').focus = () => {};
    await back(noWhole, 3);
    assert.equal(document.activeElement, view.q('section.world-map'), 'no Whole map: the map section, never <body>');
  } finally { await view.close(); }
});

test('phone: no zoom buttons (A4); two fingers pinch-zoom around their midpoint and never tap a country', async () => {
  const media = [...style.sheet.cssRules].find(rule => rule.conditionText === '(max-width: 699.98px)');
  const hidden = [...media.cssRules].find(rule => rule.selectorText.split(',').map(part => part.trim()).includes('.map-zoom'));
  assert.equal(hidden?.style.getPropertyValue('display'), 'none', 'the phone hides the −/+ group');
  const coarse = [...style.sheet.cssRules].find(rule => rule.conditionText === '(pointer: coarse)');
  assert.match(coarse.cssRules[0].style.getPropertyValue('--wm-modes-h'), /max\(31px, ?var\(--tap/, 'touch tablets get 44px modes');
  const canvas = { size: { width: 960, height: 540 } };
  await withViewport(390, () => withCanvas(canvas, async report => {
    const { props, calls } = mapProps();
    const view = await mount(props);
    try {
      await report();
      assert.deepEqual(viewBox(view), [0, 0, 960, 540]);
      const svg = view.q('svg.political-map');
      const pointer = (type, pointerId, clientX, clientY = 270) => act(async () => svg.dispatchEvent(new dom.window.PointerEvent(type,
        { bubbles: true, pointerId, pointerType: 'touch', clientX, clientY, button: type === 'pointermove' ? -1 : 0, isPrimary: pointerId === 1 })));
      await pointer('pointerdown', 1, 380);
      await pointer('pointerdown', 2, 580);
      await pointer('pointermove', 2, 780); // fingers 200px → 400px apart, midpoint 480 → 580
      assert.deepEqual(viewBox(view), [190, 135, 480, 270], '×2 around the starting midpoint, which follows the fingers');
      await pointer('pointerup', 2, 780);
      await pointer('pointermove', 1, 300);
      assert.deepEqual(viewBox(view), [190, 135, 480, 270], 'lifting a finger ends the pinch without a pan');
      await act(async () => view.q('path[data-country="380"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
      assert.deepEqual(calls.click, [], 'the pinch is not a tap');
      await pointer('pointerup', 1, 300);
      await pointer('pointerdown', 1, 400);
      await pointer('pointerup', 1, 400);
      await act(async () => view.q('path[data-country="380"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
      assert.deepEqual(calls.click, ['380'], 'a later tap works again');
    } finally { await view.close(); }
  }));
});
