// Owner: WP-MAP (wiring pass, see PLAN.md §4.2). App → WorldMap wiring in src/app/mapMethods.jsx: Political default
// (DEC D18), v4 fills via empireFill / countryFill, identity props (A-7, DEC D19), the signing projection and hatch
// (DEC D15), the dashed target preview and hover (C-18), tooltip copy, conquest framing reset, render purity (§0.9).
import test from 'node:test';
import assert from 'node:assert/strict';
import { empireFill, MAP, V4 } from '../src/theme.js';
import { bundleApp, syncAppFixture, findElement } from './lib/app-harness.mjs';

const App = await bundleApp();
const IDS = ['250', '276', '826'];

function fixture(options = {}) {
  return syncAppFixture({ App, ids: IDS, ...options });
}
const countryOf = (app, id) => app.mapCountries().countries.find(country => country.id === id);
const mapElement = app => findElement(app.render(), 'WorldMap');

test('a new App starts on the Political map (DEC D18)', () => {
  const f = fixture();
  try {
    assert.equal(f.app.state.mapMode, 'political');
    assert.equal(mapElement(f.app).props.mapMode, 'political');
  } finally { f.close(); }
});

test('loading and setup: render-called map delegates return their empty values and render does not throw', () => {
  for (const phase of ['loading', 'setup']) {
    const f = fixture({ phase });
    try {
      const { app } = f;
      const rng = app.rng.getState();
      const timers = app.timers.size;
      const map = mapElement(app);
      assert.ok(map, `${phase}: WorldMap is mounted`);
      assert.equal(app.mapMeId(), null);
      assert.equal(app.mapOpponentId(), null);
      assert.equal(app.mapNearFocus(), null);
      assert.deepEqual(app.mapProps(), {});
      assert.deepEqual(app.mapConquestIds(), []);
      assert.deepEqual(app.mapHomes(false), []);
      assert.deepEqual(app.mapLabels(false), []);
      assert.equal(app.tooltip(false).visible, false);
      assert.equal(app.mapAttack(), null);
      assert.equal(app.mapOwnership(), app.state.own, 'ownership keeps the state identity');
      const { countries } = app.mapCountries();
      if (phase === 'loading') assert.deepEqual(countries, [], 'no geometry yet');
      else {
        assert.equal(countries.length, IDS.length);
        for (const country of countries) {
          assert.equal(country.fill, empireFill(country.id), 'setup shows each nation in its pastel');
          assert.equal(country.stroke, 'none');
          assert.equal(country.ownerId, null);
        }
        app.setState({ hoverCid: '276' });
        assert.deepEqual(app.tooltip(false), { visible: true, name: 'Germany', held: 'Awaiting campaign', result: null, link: null });
      }
      assert.equal(app.rng.getState(), rng, 'render and delegates never touch the campaign RNG');
      assert.equal(app.timers.size, timers, 'no timers');
    } finally { f.close(); }
  }
});

test('Political fills use empireFill; the spectator\'s followed empire keeps its pastel but is the map\'s "you" (A-7)', () => {
  const f = fixture();
  try {
    const { app } = f;
    for (const id of IDS) assert.equal(countryOf(app, id).fill, empireFill(id));
    assert.equal(app.mapMeId(), null, 'nobody followed → no "you"');
    assert.deepEqual(app.mapProps(), { meFill: false });

    app.setState({ followedId: '276' });
    assert.equal(app.mapMeId(), '276');
    assert.deepEqual(app.mapProps(), { meFill: false }, 'a followed empire is never you-fill');
    assert.equal(countryOf(app, '276').fill, empireFill('276'));
    const homes = app.mapHomes(true);
    assert.deepEqual(homes.map(home => [home.id, home.you]), [['250', false], ['276', true], ['826', false]]);
    assert.ok(homes.every(home => !('color' in home)), 'capitals carry no team colour');

    const props = mapElement(app).props;
    assert.equal(props.meId, '276');
    assert.equal(props.meFill, false);
    assert.equal(props.ownership, app.state.own);
  } finally { f.close(); }
});

test('manager: you-fill and, once the fixture is known, opponent-fill (DEC D19)', () => {
  const f = fixture({ role: 'manager' });
  try {
    const { app } = f;
    assert.equal(app.mapMeId(), '250');
    assert.deepEqual(app.mapProps(), { meFill: true });
    assert.equal(countryOf(app, '250').fill, V4.youFill);
    assert.equal(app.mapOpponentId(), null, 'no fixture yet');
    const props = mapElement(app).props;
    assert.equal(props.meId, '250');
    assert.equal(props.opponentId, null);
    assert.equal(props.meFill, true);
    assert.deepEqual(props.nearFocus, { x: 80, y: 80, w: 40, h: 40 }, 'no opponent yet → the phone frames your empire');

    app.setState({ spin: { key: 'k', stage: 'spinning', attackerId: '250', targetId: '276', ang: 0, spinMs: 900 } });
    assert.equal(app.mapOpponentId(), null, 'not while the compass spins');
    app.setState({ spin: { ...app.state.spin, stage: 'locked' } });
    assert.equal(app.mapOpponentId(), '276');
    assert.equal(countryOf(app, '276').fill, V4.opponentFill);
    app.setState({ spin: null, tacticalChoice: { aId: '826', dId: '250' } });
    assert.equal(app.mapOpponentId(), '826', 'the tactical gate names the opponent');
    const near = app.mapNearFocus();
    assert.deepEqual(near, { x: 80, y: 80, w: 240, h: 40 }, 'phone frame = you + next opponent');
    assert.equal(app.mapNearFocus(), near, 'memoised: same frame object across renders');
  } finally { f.close(); }
});

test('Strength and Fronts modes recolour through the view-model; Flags keeps pastels without flag regions', () => {
  const f = fixture({ role: 'manager' });
  try {
    const { app } = f;
    app.setState({ mapMode: 'strength' });
    assert.ok(MAP.strengthRamp.includes(countryOf(app, '276').fill));
    assert.equal(countryOf(app, '250').fill, V4.youFill, 'you-fill wins in Strength');
    app.setState({ mapMode: 'fronts' });
    const allowed = new Set([V4.landNeutral, V4.youFill, ...Object.values(MAP.frontsTint)]);
    for (const id of IDS) assert.ok(allowed.has(countryOf(app, id).fill), `fronts fill for ${id}`);
    app.setState({ mapMode: 'flags' });
    assert.equal(countryOf(app, '276').fill, empireFill('276'), 'no flag regions in the fixture → pastel, never you-fill');
    assert.equal(countryOf(app, '250').fill, empireFill('250'));
  } finally { f.close(); }
});

test('tooltip copy comes from tooltipModel', () => {
  const f = fixture();
  try {
    const { app } = f;
    app.setState({ hoverCid: '276' });
    const tip = app.tooltip(true);
    assert.equal(tip.visible, true);
    assert.equal(tip.name, 'Germany');
    assert.equal(tip.held, 'Capital of Germany');
    assert.match(tip.result, /^Strength \d+\.\d$/);
    assert.equal(tip.link, 'Click to open the Germany squad');
    assert.deepEqual(mapElement(app).props.tooltip, tip);
  } finally { f.close(); }
});

test('each country keeps its click and hover handlers across renders, so the map can skip unchanged land', () => {
  const f = fixture();
  try {
    const first = countryOf(f.app, '250');
    f.app.setState({ hoverCid: '276' });
    const again = countryOf(f.app, '250');
    assert.notEqual(again, first, 'a fresh row each render');
    for (const key of ['onClick', 'onEnter', 'onLeave']) assert.equal(again[key], first[key], key);
    again.onEnter();
    assert.equal(f.app.state.hoverCid, '250');
  } finally { f.close(); }
});

test('the hover tooltip never sticks: the sea, leaving the land and other views drop it (W4 final, minor #1)', () => {
  const f = fixture();
  try {
    const { app } = f;
    let updates = 0;
    const setState = app.setState;
    app.setState = function (...args) { updates++; return setState.apply(this, args); };
    // Pointer events as the map sees them: over a country path, or over the bare svg (the sea, no land under it).
    const overLand = { clientX: 10, clientY: 10, target: { closest: selector => (selector === 'path[data-country]' ? {} : null) } };
    const overSea = { clientX: 10, clientY: 10, target: { closest: () => null } };

    countryOf(app, '250').onEnter();
    assert.equal(app.state.hoverCid, '250');
    app.handleMapMove(overLand);
    assert.equal(app.state.hoverCid, '250', 'moving over land keeps the hover');
    app.handleMapMove(overSea);
    assert.equal(app.state.hoverCid, null, 'land → sea drops the card (it showed FRANCE over the Bay of Biscay)');
    assert.equal(app.tooltip(true).visible, false);
    updates = 0;
    app.handleMapMove(overSea);
    app.handleMapMove(overSea);
    assert.equal(updates, 0, 'no hover → moving over the sea sets no state');

    // Leaving a country clears only its own hover: France → Germany leaves France after Germany took over.
    countryOf(app, '250').onEnter();
    countryOf(app, '276').onEnter();
    countryOf(app, '250').onLeave();
    assert.equal(app.state.hoverCid, '276', 'a late leave of the previous land keeps the new hover');
    countryOf(app, '276').onLeave();
    assert.equal(app.state.hoverCid, null);
    assert.deepEqual(mapElement(app).props.tooltip, app.tooltip(true));
    assert.equal(mapElement(app).props.tooltip.visible, false);

    // A hover never shows while another view covers the map; the map views still show it.
    countryOf(app, '276').onEnter();
    for (const view of ['squad', 'match', 'ledger', 'chronicle']) {
      app.setState({ view });
      assert.equal(app.tooltip(true).visible, false, `${view}: no stale card behind the view`);
      assert.equal(mapElement(app).props.hidden, true);
    }
    app.setState({ view: 'map' });
    assert.equal(app.tooltip(true).visible, true, 'map view: the hover shows');
    assert.equal(mapElement(app).props.hidden, false);
    // App's onPointerLeave is what WorldMap calls when the map hides or reframes under a held hover.
    mapElement(app).props.onPointerLeave();
    assert.equal(app.state.hoverCid, null);
    assert.equal(app.tooltip(true).visible, false);
  } finally { f.close(); }
});

test('signing (DEC D15): projected ownership, hatch on the taken land, the loser drops out of labels and capitals', () => {
  const f = fixture({ role: 'manager' });
  try {
    const { app } = f;
    const own = app.state.own;
    app.setState({
      match: { aId: '250', dId: '276', winner: '250', done: true, applied: false, ga: 1, gd: 0, shown: [], allEv: [] },
      choice: { candidates: [{ index: 0, name: 'Player' }], selected: 0 },
      conquestIds: [], flash: {},
    });
    const projected = app.mapOwnership();
    assert.notEqual(projected, own);
    assert.equal(projected['276'], '250', 'the taken land belongs to the winner');
    assert.equal(app.state.own['276'], '276', 'state is untouched');
    assert.equal(app.mapOwnership(), projected, 'memoised: one ownership identity across renders');
    assert.deepEqual(app.mapConquestIds(), ['276']);
    assert.deepEqual(app.mapLabels(true).map(label => label.id), ['250', '826']);
    assert.deepEqual(app.mapHomes(true).map(home => home.id), ['250', '826']);
    const taken = countryOf(app, '276');
    assert.equal(taken.ownerId, '250');
    assert.equal(taken.ownerName, 'France');
    assert.equal(taken.fill, V4.youFill, 'you-fill under the hatch');
    assert.equal(app.mapOpponentId(), null, 'no opponent on the conquest screen');
    // D1/D2, D§2.3: no line of attack on the conquest screen, although the decided match's st.atk is still set.
    app.setState({ atk: { x1: 1, y1: 2, x2: 3, y2: 4 } });
    assert.equal(app.mapAttack(), null, 'no arrow while signing (App passes attack={this.mapAttack()})');
    app.setState({ hoverCid: '276' });
    assert.equal(app.tooltip(true).held, 'Held by France');
    app.viewConquest({ territoryIds: ['826'] });
    assert.equal(app.state.focusLayout, null);
    assert.deepEqual(app.state.conquestIds, [], 'viewConquest is ignored while the signing holds the screen');

    app.setState({ choice: null, match: { ...app.state.match, applied: true } });
    assert.equal(app.mapOwnership(), own, 'back to the state ownership after the signing');
  } finally { f.close(); }
});

test('hatch after an AI conquest lasts only for the flash; viewConquest frames and clears the conquest layout', () => {
  const f = fixture();
  try {
    const { app } = f;
    app.setState({ conquestIds: ['276'], flash: {} });
    assert.deepEqual(app.mapConquestIds(), []);
    app.setState({ flash: { 276: true } });
    assert.deepEqual(app.mapConquestIds(), ['276']);
    app.setState({ flash: {}, focusLayout: 'conquest', focusKey: 4, view: 'ledger' });
    app.viewConquest({ territoryIds: ['276', '826'] });
    assert.equal(app.state.focusLayout, null);
    assert.equal(app.state.focusKey, 5);
    assert.equal(app.state.view, 'map');
    assert.deepEqual(app.state.focusBounds, { x: 180, y: 80, w: 140, h: 40 });
  } finally { f.close(); }
});

test('choosing a target (C-18): dashed preview arrow and hover from the in-reach land under the pointer', () => {
  const f = fixture({ role: 'manager' });
  try {
    const { app } = f;
    const atk = { x1: 1, y1: 2, x2: 3, y2: 4 };
    app.setState({ atk });
    assert.equal(app.mapAttack(), atk, 'no choice → the drawn line of attack');
    const preview = { x1: 100, y1: 100, x2: 200, y2: 100, routeD: '' };
    let reach = { attackerId: '250', ids: ['276'], keepIds: ['250', '276'], selectedId: '276', hoverId: null, preview };
    app.reachModel = () => reach;
    app.setState({ pendingTarget: { attackerId: '250', optionIds: ['276'], selectedId: '276', round: 1 }, atk: null, targetHoverId: null });
    const dashed = app.mapAttack();
    assert.deepEqual(dashed, { ...preview, dashed: true });
    assert.equal(app.mapAttack(), dashed, 'memoised preview arrow');
    reach = { ...reach, preview: null };
    assert.equal(app.mapAttack(), null, 'no preview yet → no arrow');

    const hovers = [];
    app.hoverTarget = id => { hovers.push(id); app.setState({ targetHoverId: id || null }); };
    const over = owner => ({ clientX: 10, clientY: 10, target: { closest: selector =>
      selector === '[data-reach="in"]' && owner ? { dataset: { owner } } : null } });
    app.handleMapMove(over('276'));
    app.handleMapMove(over('276'));
    app.handleMapMove(over(null));
    app.handleMapMove({ clientX: 1, clientY: 1, target: null });
    assert.deepEqual(hovers, ['276', null], 'one hover per change, cleared when leaving the target');

    app.setState({ pendingTarget: null });
    app.handleMapMove(over('826'));
    assert.deepEqual(hovers, ['276', null], 'no target hover outside the choice');
  } finally { f.close(); }
});

test('handleMapMove keeps the tooltip inside the map by its measured size', () => {
  const f = fixture();
  try {
    const { app } = f;
    const style = {};
    app.tipRef.current = { offsetWidth: 200, offsetHeight: 60, style };
    app.mapRef.current = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 500, height: 300 }) };
    app.handleMapMove({ clientX: 480, clientY: 310 });
    assert.deepEqual(style, { left: '292px', top: '232px' });
    app.handleMapMove({ clientX: 15, clientY: 20 });
    assert.deepEqual(style, { left: '19px', top: '12px' });
  } finally { f.close(); }
});

test('a country map: setup paints each section as its starting club and names it; capitals mark the home town', () => {
  const club = { id: 'd250-1', name: 'Paris FC', code: 'PFC', col: '#123456', homeSection: '250' };
  const domestic = { clubs: [club], sectionNames: { '250': 'Paris', '276': 'Berlin', '826': 'London' } };
  const f = fixture({ phase: 'setup' });
  try {
    const { app } = f;
    app.domesticMap = () => domestic;
    const paris = countryOf(app, '250');
    assert.equal(paris.name, 'Paris');
    assert.equal(paris.fill, empireFill(club.id), 'Political: the pastel the club takes at kick-off');
    assert.equal(paris.ownerId, null, 'no owner, so no tab stops behind the wizard');
    app.setState({ mapMode: 'flags' });
    assert.equal(countryOf(app, '250').fill, club.col, 'Flags: the club colour');
    app.setState({ hoverCid: '250' });
    assert.deepEqual(app.tooltip(false), { visible: true, name: 'Paris', held: 'Home of Paris FC', result: null, link: null });
    app.setState({ hoverCid: '826' });
    assert.deepEqual(app.tooltip(false), { visible: true, name: 'London', held: 'Awaiting campaign', result: null, link: null });
  } finally { f.close(); }

  const g = fixture();
  try {
    const { app } = g;
    const plain = app.mapHomes(true).find(home => home.id === '276');
    assert.deepEqual([plain.x, plain.y], [app.geo.paths['276'].cx, app.geo.paths['276'].cy], 'world paths mark cx/cy');
    app.geo = { ...app.geo, paths: { ...app.geo.paths, '276': { ...app.geo.paths['276'], homeX: 201.5, homeY: 99.25 } } };
    const town = app.mapHomes(true).find(home => home.id === '276');
    assert.deepEqual([town.x, town.y], [201.5, 99.25], 'a section marks the home town, not its routing anchor');
  } finally { g.close(); }
});
