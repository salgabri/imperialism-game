// Owner: WP-CONQ (see PLAN.md §4, §5.2). Conquest screen (D1/D2, DEC D15), its view-models, the callout,
// ManagerElimination and the v4 map notices. Component tests bundle the JSX with esbuild and mount it in jsdom
// (the strategy-ui / ui-interaction pattern); view-models are imported directly. App-level checks
// (selectAcquisition persisting choice.selected, provenance on confirm) belong to the conquestMethods wiring pass.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { acquisitionOptions } from '../src/engine/campaignExperience.js';
import { getSport } from '../src/sports/index.js';
import {
  buildConquestPreview, buildConquest, buildConquestCallout, buildElimination, conquestOptions, conquestFromChoice,
  winnerScore, eliminationFromResult,
} from '../src/viewModels/conquest.js';

const bundled = await build({
  stdin: { contents: `
    export {default as ConquestScreen} from './src/screens/conquest/ConquestScreen.jsx';
    export {default as ConquestCallout} from './src/screens/conquest/ConquestCallout.jsx';
    export {default as ManagerElimination} from './src/components/ManagerElimination.jsx';
    export {Toast, MatchupPopup, ResultPopup, StealPopup} from './src/components/Popups.jsx';
  `, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
  loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { ConquestScreen, ConquestCallout, ManagerElimination, Toast, MatchupPopup, ResultPopup, StealPopup } = module.exports;

const dom = new JSDOM('<!doctype html><html><body><button id="prior">Prior focus</button></body></html>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');

// Console-clean (PLAN rule 14): React key/prop warnings fail the suite.
const consoleProblems = [];
const originalError = console.error, originalWarn = console.warn;
console.error = (...args) => { consoleProblems.push(args.map(String).join(' ')); };
console.warn = (...args) => { consoleProblems.push(args.map(String).join(' ')); };
after(() => { console.error = originalError; console.warn = originalWarn; dom.window.close(); });

async function mount(element) {
  document.querySelector('#prior').focus();
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  return { host, root, async close() { await act(async () => root.unmount()); host.remove(); } };
}
const key = (target, name, extra = {}) => act(async () => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra })));
const click = target => act(async () => target.click());

// ---------- fixtures ----------

const footballSquad = rating => getSport('football').positionPlan.map((pos, index) => ({ name: `Player ${index}`, pos, rating }));
const team = (id, name, code, rating = 80, extra = {}) => ({ id, name, code, flagId: id, sport: 'football', squad: footballSquad(rating), ...extra });

function fixture({ winner = '380', attacker = '380', ga = 2, gd = 1, tie = null, round = 19, selected, loserTerritories = ['688', '070', 'KOS'] } = {}) {
  const teams = {
    380: team('380', 'Italy', 'ITA', 82),
    688: team('688', 'Serbia', 'SRB', 78, { squad: [
      { name: 'S. Milinković-Savić', pos: 'MF', rating: 90 }, { name: 'N. Milenković', pos: 'DF', rating: 60 }, { name: 'A. Rrahmani', pos: 'DF', rating: 59 },
    ] }),
    276: team('276', 'Germany', 'GER', 84),
  };
  const loser = winner === '380' ? '688' : '380';
  const own = { 380: '380', 499: '380', 191: '380', 276: '276' };
  for (const cid of loserTerritories) own[cid] = '688';
  const candidates = acquisitionOptions(teams[winner], teams[loser]);
  const defender = attacker === '380' ? '688' : '380';
  return {
    round, teams, own, aliveIds: ['380', '688', '276'],
    match: { aId: attacker, dId: defender, winner, finalGa: ga, finalGd: gd, ga, gd, tie, done: true, applied: false },
    choice: { winnerName: teams[winner].name, loserName: teams[loser].name, candidates, resumeAutoplay: false, openedAt: 0,
      ...(selected === undefined ? {} : { selected }) },
  };
}
const geoFor = ids => ({ paths: Object.fromEntries(ids.map((id, i) => [id, { bbox: { x: 100 + i * 10, y: 50 + i * 5, w: 10, h: 8 } }])) });
const sport = getSport('football');

// ---------- buildConquestPreview (FROZEN shape) ----------

test('conquest preview projects every loser territory, dependencies included, and frames only the mainland', () => {
  const st = {
    teams: { 380: { id: '380', name: 'Italy' }, 208: { id: '208', name: 'Denmark' }, 276: { id: '276', name: 'Germany' } },
    own: { 380: '380', 208: '208', 304: '208', 276: '276' }, aliveIds: ['380', '208', '276'],
    match: { aId: '380', dId: '208', winner: '380', done: true }, choice: { candidates: [] },
  };
  const geo = { paths: { 208: { bbox: { x: 10, y: 20, w: 30, h: 10 } }, 304: { bbox: { x: -400, y: -300, w: 200, h: 150 } }, 380: { bbox: { x: 0, y: 0, w: 5, h: 5 } } } };
  const preview = buildConquestPreview(st, { geo, totalTeams: 3 });
  assert.deepEqual(preview.taken.slice().sort(), ['208', '304']);
  assert.equal(preview.own['208'], '380');
  assert.equal(preview.own['304'], '380');
  assert.equal(st.own['208'], '208', 'the real ownership is untouched');
  assert.deepEqual(preview.territoryNames.slice().sort(), ['Denmark', 'Greenland']);
  assert.equal(preview.empireAfter, 3);
  assert.equal(preview.aliveAfter, 2);
  assert.equal(preview.totalEmpires, 3);
  assert.deepEqual(preview.bounds, { x: 10, y: 20, w: 30, h: 10 }, 'Greenland does not stretch the frame');
  assert.deepEqual(preview.centre, { x: 25, y: 25 });
  assert.equal(buildConquestPreview(st, {}).bounds, null, 'no geometry → no bounds');
  assert.equal(buildConquestPreview(st, {}).centre, null);
  assert.equal(buildConquestPreview({ ...st, choice: null }, { geo }), null);
  assert.equal(buildConquestPreview({ ...st, match: { ...st.match, applied: true } }, { geo }), null);
  const onlyDependency = buildConquestPreview({ ...st, own: { 380: '380', 304: '208' } }, { geo });
  assert.deepEqual(onlyDependency.bounds, { x: -400, y: -300, w: 200, h: 150 }, 'falls back to the dependency');
});

// ---------- buildConquest: copy ----------

test('standfirst names the winner first: beat when attacking, held off when defending', () => {
  const ctx = { sport, totalTeams: 3 };
  const attack = buildConquest(fixture(), ctx);
  assert.equal(attack.kicker, 'Round XIX · Conquest');
  assert.equal(attack.kickerRight, 'Result');
  assert.equal(attack.headline, 'Serbia is out');
  assert.equal(attack.standfirst, 'Italy beat Serbia 2–1. Italy take all 3 of Serbia’s territories and one player.');
  const defend = buildConquest(fixture({ attacker: '688', ga: 1, gd: 2 }), ctx);
  assert.equal(defend.standfirst, 'Italy held off Serbia 2–1. Italy take all 3 of Serbia’s territories and one player.');
  const single = buildConquest(fixture({ loserTerritories: ['688'] }), ctx);
  assert.match(single.standfirst, /Italy take Serbia’s only territory and one player\.$/);
});

test('tie-breaks are sport-aware and winner-first', () => {
  const pens = buildConquest(fixture({ attacker: '688', ga: 1, gd: 1, tie: { A: [1, 1, 1, 0], D: [1, 1, 1, 1], ga: 3, gd: 4 } }), { sport });
  assert.match(pens.standfirst, /^Italy held off Serbia 1–1, 4–3 on penalties\. /);
  const basketball = getSport('basketball');
  const overtime = { aId: '380', dId: '688', finalGa: 98, finalGd: 95, tie: { periods: [[10, 8]], ga: 98, gd: 95 } };
  assert.equal(winnerScore(overtime, '380', basketball), '98–95 after 1 overtime period');
  assert.equal(winnerScore({ ...overtime, tie: { periods: [[9, 9], [8, 5]], ga: 98, gd: 95 } }, '380', basketball), '98–95 after 2 overtime periods');
  assert.equal(winnerScore({ aId: 'a', dId: 'b', finalGa: 0, finalGd: 3 }, 'b'), '3–0');
  assert.equal(winnerScore({ aId: 'a', dId: 'b' }, 'a'), '', 'unknown score → no score text');
});

test('effects report the taken land and the empire after the conquest', () => {
  const model = buildConquest(fixture(), { sport, totalTeams: 3 });
  assert.deepEqual(model.effects.map(effect => [effect.label, effect.value, effect.detail]), [
    ['Territory', '+3', 'Serbia, Bosnia & Herz., Kosovo'],
    ['Empire', '6', 'territories · 2 of 3 empires remain'],
  ]);
  assert.deepEqual(model.effects.map(effect => effect.detailMore), [null, null]);
  const many = fixture({ loserTerritories: ['688', '070', 'KOS', '191x', '192x', '193x', '194x', '195x'] });
  const long = buildConquest(many, { sport });
  assert.equal(long.effects[0].detail, 'Serbia, Bosnia & Herz., Kosovo, 191x, 192x, 193x');
  assert.equal(long.effects[0].detailMore, '+ 2 more', 'the overflow count is separate from the clamped names');
  assert.equal(long.effects[0].detailFull.split(', ').length, 8);
  assert.equal(buildConquest({ ...fixture(), choice: null }, {}), null);
});

test('long territory names keep "+ N more" outside the 2-line clamp (D§10 #7)', async () => {
  const longNames = ['Central African Rep.', 'Dem. Rep. Congo', 'Republic of the Congo', 'Equatorial Guinea', 'São Tomé and Príncipe',
    'Bosnia and Herzegovina', 'Trinidad and Tobago', 'Saint Vincent and the Grenadines'];
  const ids = longNames.map((_, i) => `L${i}`);
  const st = fixture({ loserTerritories: ids });
  const ctx = { sport, geo: { countries: ids.map((id, i) => ({ id, name: longNames[i] })) } };
  const model = buildConquest(st, ctx);
  const [territory] = model.effects;
  assert.equal(territory.detail, longNames.slice(0, 6).join(', '));
  assert.equal(territory.detailMore, '+ 2 more');
  assert.equal(territory.detailFull, longNames.join(', '));
  const view = await mount(React.createElement(ConquestScreen, { ...model, onSelect() {}, onConfirm() {} }));
  const detail = view.host.querySelector('.conquest-effect__detail');
  assert.equal(detail.textContent, `${longNames.slice(0, 6).join(', ')} + 2 more`);
  assert.equal(detail.getAttribute('title'), longNames.join(', '), 'the full list stays available');
  const text = detail.querySelector('.conquest-effect__text');
  const more = detail.querySelector('.conquest-effect__more');
  assert.equal(more.textContent, '+ 2 more');
  assert.ok(!text.contains(more), 'the count is a sibling of the clamped text, so the clamp cannot cut it');
  const empire = view.host.querySelectorAll('.conquest-effect__detail')[1];
  assert.equal(empire.querySelector('.conquest-effect__more'), null);
  assert.equal(empire.getAttribute('title'), null);
  await view.close();
});

test('options show position, rating, lineup note and toned gains; selection follows choice.selected', () => {
  const st = fixture();
  const model = buildConquest(st, { sport });
  const [best, ...rest] = model.options;
  assert.equal(best.name, 'S. Milinković-Savić');
  assert.match(best.meta, /^MF · 90 rating · Starts ahead of Player \d+$/);
  assert.match(best.gain, /^\+\d\.\d$/);
  assert.equal(best.tone, 'gain');
  assert.ok(best.selected, 'default selection is the best lineup fit');
  for (const option of rest) {
    assert.equal(option.meta, `${option.base} · Adds depth · the XI is unchanged`);
    assert.equal(option.gain, '±0.0');
    assert.equal(option.tone, 'muted');
  }
  assert.equal(model.selectedIndex, best.index);
  assert.equal(model.ctaLabel, 'Sign S. Milinković-Savić');
  assert.equal(model.ctaGain, best.gain);
  assert.equal(model.waitNote, 'The campaign waits for your choice.');
  const other = rest[0];
  const reselected = buildConquest(fixture({ selected: other.index }), { sport });
  assert.deepEqual(reselected.options.filter(option => option.selected).map(option => option.index), [other.index]);
  assert.equal(reselected.ctaLabel, `Sign ${other.name}`);
  assert.equal(reselected.ctaGain, '±0.0');
  assert.match(reselected.comparison.caption, new RegExp(`before and after signing ${other.name}`));
  const invalid = buildConquest(fixture({ selected: 99 }), { sport });
  assert.equal(invalid.selectedIndex, best.index, 'an unknown selection falls back to the best fit');
  assert.deepEqual(conquestOptions({ candidates: [{ index: 2, name: 'X', pos: 'FW', rating: 80, gain: 0, entersLineup: true }] })[0].note, 'Starts in the XI');
  assert.equal(model.claimAside, 'Change to your XI');
});

test('a basketball conquest reads "starting five" where football reads "XI" (DEC misc)', () => {
  const basketball = getSport('basketball');
  const model = buildConquest(fixture(), { sport: basketball });
  assert.equal(model.claimAside, 'Change to your starting five');
  const [, ...rest] = model.options;
  for (const option of rest) assert.equal(option.note, 'Adds depth · the starting five is unchanged');
  assert.ok(model.options.every(option => !/\bXI\b/.test(option.meta)), 'no football noun in any row');
  const enters = [{ index: 2, name: 'X', pos: 'C', rating: 80, gain: 0, entersLineup: true }];
  assert.equal(conquestOptions({ candidates: enters }, 2, basketball)[0].note, 'Starts in the starting five');
  assert.equal(conquestOptions({ candidates: enters }, 2, 'basketball')[0].note, 'Starts in the starting five', 'a sport id works too');
  assert.equal(conquestOptions({ candidates: enters }, 2, sport)[0].note, 'Starts in the XI');
});

// ---------- ConquestScreen ----------

function Harness({ st, ctx, confirmed, selects = [] }) {
  const [selected, setSelected] = React.useState(st.choice.selected ?? st.choice.candidates[0].index);
  const model = buildConquest({ ...st, choice: { ...st.choice, selected } }, ctx);
  const onSelect = index => { selects.push(index); setSelected(index); };
  return React.createElement(ConquestScreen, { ...model, onSelect, onConfirm: () => confirmed.push(selected) });
}

// Candidate indices are squad indices, not row positions: re-key the fixture so a position/index mix-up fails.
const SPARSE = [4, 2, 7]; // no row position equals its index
function sparseFixture(options) {
  const st = fixture(options);
  return { ...st, choice: { ...st.choice, candidates: st.choice.candidates.map((candidate, i) => ({ ...candidate, index: SPARSE[i] })) } };
}

test('the conquest article is a screen, not a modal, with a space-primary radiogroup and roving focus', async () => {
  const confirmed = [], selects = [];
  const st = sparseFixture();
  assert.deepEqual(st.choice.candidates.map(candidate => candidate.index), SPARSE);
  const view = await mount(React.createElement(Harness, { st, ctx: { sport, totalTeams: 3 }, confirmed, selects }));
  const article = view.host.querySelector('article.screen.screen--conquest');
  assert.ok(article);
  assert.equal(article.getAttribute('role'), null);
  assert.equal(article.getAttribute('aria-modal'), null);
  assert.equal(view.host.querySelector('[role=dialog], [aria-modal]'), null);
  assert.equal(article.getAttribute('tabindex'), '-1');
  assert.equal(document.getElementById(article.getAttribute('aria-labelledby')).textContent, 'Serbia is out');
  assert.equal(view.host.querySelector('.conquest-kicker').textContent, 'Round XIX · ConquestResult');
  assert.match(view.host.querySelector('.conquest-standfirst').textContent, /^Italy beat Serbia 2–1\./);
  assert.equal(view.host.querySelectorAll('.conquest-effect').length, 2);
  assert.equal(view.host.querySelector('.conquest-claim-head').textContent, 'Claim one playerChange to your XI');

  const group = view.host.querySelector('[role=radiogroup][data-space-primary]');
  assert.equal(group.getAttribute('aria-label'), 'Claim one player');
  const radios = () => [...group.querySelectorAll('[role=radio]')];
  assert.equal(radios().length, 3);
  assert.deepEqual(radios().map(radio => radio.dataset.index), SPARSE.map(String), 'rows carry the candidate index');
  const tabStops = () => radios().filter(radio => radio.getAttribute('tabindex') === '0');
  assert.equal(tabStops().length, 1);
  assert.equal(tabStops()[0].getAttribute('aria-checked'), 'true');
  assert.equal(document.activeElement, radios()[0], 'initial focus is on the selected option');
  const cta = () => view.host.querySelector('.conquest-footer__cta');
  assert.equal(cta().textContent, 'Sign S. Milinković-Savić');
  assert.equal(cta().getAttribute('data-key-hint'), null, 'the SPACE chip lives on the masthead CTA only');

  await key(radios()[0], 'ArrowDown');
  assert.deepEqual(selects, [2], 'ArrowDown selects the next row by its candidate index, not its position');
  assert.equal(radios()[1].getAttribute('aria-checked'), 'true');
  assert.equal(document.activeElement, radios()[1]);
  assert.equal(tabStops().length, 1);
  assert.equal(cta().textContent, `Sign ${st.choice.candidates[1].name}`, 'the button label follows the selection');
  await key(radios()[1], 'End');
  assert.equal(document.activeElement, radios()[2]);
  await key(radios()[2], 'ArrowDown');
  assert.equal(document.activeElement, radios()[0], 'arrows wrap');
  assert.equal(radios()[0].getAttribute('aria-checked'), 'true');
  await key(radios()[0], 'ArrowUp');
  assert.equal(radios()[2].getAttribute('aria-checked'), 'true');
  await key(radios()[2], 'Home');
  assert.equal(radios()[0].getAttribute('aria-checked'), 'true');
  assert.deepEqual(selects, [2, 7, 4, 7, 4], 'every move reports the candidate index of the row it lands on');
  await click(radios()[1]);
  assert.equal(radios()[1].getAttribute('aria-checked'), 'true');
  assert.equal(selects.at(-1), 2, 'a click passes the candidate index');
  await click(radios()[1]);
  assert.equal(selects.length, 6, 'clicking the selected row does not re-select');
  await key(radios()[0], 'Enter');
  assert.equal(radios()[0].getAttribute('aria-checked'), 'true', 'Enter on an unselected option selects it');
  assert.equal(selects.at(-1), 4);
  assert.deepEqual(confirmed, []);
  await key(radios()[0], 'Enter');
  assert.deepEqual(confirmed, [4], 'Enter on the selected option confirms');
  await click(radios()[2]);
  await click(cta());
  assert.deepEqual(confirmed, [4, 7]);
  await view.close();
});

test('a held Enter (auto-repeat) never confirms: only a fresh press acts', async () => {
  const confirmed = [], selects = [];
  const st = sparseFixture();
  const view = await mount(React.createElement(Harness, { st, ctx: { sport }, confirmed, selects }));
  const radios = () => [...view.host.querySelectorAll('[role=radio]')];
  await key(radios()[1], 'Enter');
  assert.deepEqual(selects, [2], 'the first press selects the row');
  await key(radios()[1], 'Enter', { repeat: true });
  await key(radios()[1], 'Enter', { repeat: true });
  assert.deepEqual(confirmed, [], 'auto-repeat on the now-selected row does not sign the player');
  await key(radios()[2], 'Enter', { repeat: true });
  assert.deepEqual(selects, [2], 'auto-repeat does not select either');
  assert.equal(radios()[1].getAttribute('aria-checked'), 'true');
  await key(radios()[1], 'Enter');
  assert.deepEqual(confirmed, [2], 'a second deliberate press confirms');
  await view.close();
});

test('ported AcquisitionChoice contract: lineup consequence, gain, focus and the actual candidate index', async () => {
  const selects = [], choices = [];
  const choice = { winnerName: 'Alfa', loserName: 'Beta', candidates: [
    { index: 4, name: 'A Player', pos: 'MF', rating: 88, gain: 1.2, replaces: { name: 'Old Player' } },
    { index: 9, name: 'B Player', pos: 'DF', rating: 80, gain: 0 },
  ] };
  // The W1 stub model { choice, selectedIndex } still renders a full article (conquestFromChoice). Like App, the
  // stub harness re-renders with the selection it is handed and confirms whatever the screen shows as selected.
  function StubHarness() {
    const [selectedIndex, setSelectedIndex] = React.useState(4);
    return React.createElement(ConquestScreen, { choice, selectedIndex,
      onSelect: index => { selects.push(index); setSelectedIndex(index); },
      onConfirm: () => choices.push(Number(document.querySelector('.conquest-option[aria-checked=true]').dataset.index)) });
  }
  const view = await mount(React.createElement(StubHarness));
  assert.match(view.host.textContent, /Starts ahead of Old Player/);
  assert.match(view.host.querySelector('.conquest-option__gain').textContent, /^\+1\.2$/);
  assert.equal(view.host.querySelector('.conquest-option__gain').className, 'conquest-option__gain tone-gain');
  assert.equal(document.activeElement, view.host.querySelector('[role=radio]'));
  assert.equal(view.host.querySelector('h1').textContent, 'Beta is out');
  assert.equal(view.host.querySelector('.conquest-standfirst').textContent, 'Alfa claim one player.',
    'the stub has no score or attacker, so the copy stays neutral');
  await click(view.host.querySelector('.conquest-footer__cta'));
  assert.deepEqual(choices, [4]);
  await key(document.activeElement, 'ArrowDown');
  assert.deepEqual(selects, [9], 'the second row reports its candidate index');
  assert.equal(view.host.querySelector('.conquest-footer__cta').textContent, 'Sign B Player');
  await click(view.host.querySelector('.conquest-footer__cta'));
  assert.deepEqual(choices, [4, 9]);
  await view.close();
  const fallback = conquestFromChoice(choice, 4);
  assert.equal(fallback.ctaLabel, 'Sign A Player');
  assert.equal(fallback.selectedIndex, 4);
  assert.equal(conquestFromChoice({ ...choice, winnerName: '' }).standfirst, '');
});

test('ported signing comparison: the lineup table sits outside every button and starts with focus in the article', async () => {
  const winner = team('a', 'Alfa', 'ALF', 80), loser = { ...team('b', 'Beta', 'BET', 70), squad: [{ name: 'New defender', pos: 'DF', rating: 85 }] };
  const choice = { winnerName: 'Alfa', loserName: 'Beta', candidates: acquisitionOptions(winner, loser) };
  const st = { round: 3, teams: { a: winner, b: loser }, own: { x: 'a', y: 'b' }, aliveIds: ['a', 'b'], choice,
    match: { aId: 'a', dId: 'b', winner: 'a', finalGa: 1, finalGd: 0, done: true } };
  const view = await mount(React.createElement(ConquestScreen, { ...buildConquest(st, { sport }), onSelect() {}, onConfirm() {} }));
  const summary = view.host.querySelector('summary');
  assert.ok(summary);
  assert.equal(view.host.querySelector('button summary'), null);
  assert.match(summary.textContent, /^Lineup before and after/);
  assert.equal(view.host.querySelectorAll('tbody tr').length, 11);
  assert.match(view.host.querySelector('caption').textContent, /before and after signing New defender/);
  assert.ok(view.host.querySelector('.is-changed'));
  assert.ok(document.activeElement.closest('article.screen--conquest'));
  assert.equal(document.activeElement.getAttribute('role'), 'radio');
  assert.equal(document.activeElement.getAttribute('aria-checked'), 'true');
  assert.match(view.host.querySelector('.conquest-compare__support').textContent, /^Attack support [+−]\d\.\d\d · Defensive support [+−]\d\.\d\d$/);
  await view.close();
});

// ---------- callout ----------

test('callout model centres on the taken land and the card renders the D1 copy', async () => {
  const st = fixture({ loserTerritories: ['688', '070'] });
  const geo = geoFor(['688', '070']);
  const callout = buildConquestCallout(st, { geo });
  const preview = buildConquestPreview(st, { geo });
  assert.deepEqual({ x: callout.x, y: callout.y }, preview.centre);
  assert.equal(callout.key, 'conquest-callout');
  assert.equal(callout.align, 'center');
  assert.equal(callout.figure, '+2');
  assert.equal(callout.label, 'Territories taken');
  assert.equal(callout.sub, 'Now part of Italy');
  assert.equal(buildConquestCallout(st, {}), null, 'no geometry → no anchor');
  // One territory: the label agrees with the figure, as the standfirst's "only territory" does.
  const single = fixture({ loserTerritories: ['688'] });
  const one = buildConquestCallout(single, { geo: geoFor(['688']) });
  assert.deepEqual([one.figure, one.label], ['+1', 'Territory taken']);
  assert.match(buildConquest(single, { sport, geo: geoFor(['688']) }).standfirst, /Serbia’s only territory/);
  const view = await mount(React.createElement(ConquestCallout, { figure: '+3', label: 'Territories taken', sub: 'Now part of Italy' }));
  const card = view.host.querySelector('.callout.panel-callout');
  assert.equal(card.querySelector('.callout__figure').textContent, '+3');
  assert.equal(card.querySelector('.callout__label').textContent, 'Territories taken');
  assert.equal(card.querySelector('.callout__sub').textContent, 'Now part of Italy');
  assert.ok(!card.classList.contains('callout--compact'));
  await act(async () => view.root.render(React.createElement(ConquestCallout, { figure: '+1', label: 'Territories taken', compact: true })));
  assert.ok(view.host.querySelector('.callout').classList.contains('callout--compact'));
  assert.equal(view.host.querySelector('.callout__sub'), null);
  await view.close();
});

// ---------- ManagerElimination ----------

const eliminationState = () => ({
  round: 7, teams: { 380: { id: '380', name: 'Italy' }, 688: { id: '688', name: 'Serbia' } }, history: [],
  match: { id: 'm', aId: '688', dId: '380', winner: '688', finalGa: 2, finalGd: 1, ga: 2, gd: 1, done: true, applied: true, territoriesGained: 3 },
  managerElimination: { teamId: '380', opponentId: '688', matchId: 'match-9', teamName: 'Italy', opponentName: 'Serbia',
    score: '2–1', placement: 3, conquests: 2, signings: 1 },
});

test('elimination model restates the defeat winner-first in the article pattern', () => {
  const model = buildElimination(eliminationState(), { sport });
  assert.equal(model.kicker, 'Round VII · Eliminated');
  assert.equal(model.headline, 'Italy is out');
  assert.equal(model.standfirst, 'Serbia beat Italy 2–1. Serbia take all 3 of Italy’s territories. Your campaign ends here.');
  assert.deepEqual(model.stats.map(stat => [stat.label, stat.value]), [['Placement', '3rd'], ['Conquests', '2'], ['Signings', '1']]);
  const defended = eliminationState();
  defended.match = { ...defended.match, aId: '380', dId: '688', finalGa: 0, finalGd: 1 };
  assert.match(buildElimination(defended, { sport }).standfirst, /^Serbia held off Italy 1–0\. /);
  const reloaded = { ...eliminationState(), match: null, history: [{ id: 'match-9', aId: '380', a: { score: '1' }, b: { score: '1' },
    result: { tieText: '2–4 on penalties', territories: 1 } }] };
  assert.equal(buildElimination(reloaded, {}).standfirst, 'Serbia held off Italy 1–1, 4–2 on penalties. Serbia take Italy’s only territory. Your campaign ends here.');
  assert.equal(buildElimination({ ...eliminationState(), managerElimination: null }, {}), null);
  // No match and no archived entry: result.score is attacker-first ("1–2 (1–1 PENS)"), so it is never printed.
  const orphan = { ...eliminationState(), match: null, history: [] };
  orphan.managerElimination = { ...orphan.managerElimination, score: '1–2 (1–1 PENS)' };
  assert.equal(buildElimination(orphan, {}).standfirst, 'Serbia won the decisive match. Your campaign ends here.');
  assert.equal(eliminationFromResult(orphan.managerElimination).standfirst, 'Serbia won the decisive match. Your campaign ends here.');
});

test('the elimination note follows the last save: saved, failed (export pointer) or unknown (no claim)', async () => {
  const saved = buildElimination({ ...eliminationState(), saveStatus: { ok: true, savedAt: 1 } }, { sport });
  assert.equal(saved.note, 'Your run is saved. Follow the remaining teams or try the same opening again.');
  assert.equal(saved.noteTone, null);
  const failed = buildElimination({ ...eliminationState(),
    saveStatus: { ok: false, message: 'Progress could not be saved. Export your campaign to keep it.' } }, { sport });
  assert.doesNotMatch(failed.note, /is saved/, 'never claims a save the masthead calls Unsaved');
  assert.match(failed.note, /could not be saved.*Export campaign/);
  assert.equal(failed.noteTone, 'unsaved');
  const unknown = buildElimination(eliminationState(), { sport });
  assert.equal(unknown.note, 'Follow the remaining teams or try the same opening again.');
  assert.doesNotMatch(eliminationFromResult(eliminationState().managerElimination).note, /saved/);
  const view = await mount(React.createElement(ManagerElimination, { result: eliminationState().managerElimination, model: failed,
    onSpectate() {}, onRetry() {} }));
  const note = view.host.querySelector('.manager-note');
  assert.ok(note.classList.contains('manager-note--unsaved'));
  assert.equal(note.textContent, failed.note);
  await view.close();
  const plain = await mount(React.createElement(ManagerElimination, { result: eliminationState().managerElimination, model: saved,
    onSpectate() {}, onRetry() {} }));
  assert.ok(!plain.host.querySelector('.manager-note').classList.contains('manager-note--unsaved'));
  await plain.close();
});

test('ManagerElimination keeps its dialog, focus trap and exact button copy', async () => {
  const calls = [];
  const st = eliminationState();
  const view = await mount(React.createElement(ManagerElimination, { result: st.managerElimination, model: buildElimination(st, { sport }),
    onSpectate: () => calls.push('spectate'), onRetry: () => calls.push('retry') }));
  const dialog = view.host.querySelector('section.manager-ending[role=dialog]');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.equal(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent, 'Italy is out');
  assert.match(document.getElementById(dialog.getAttribute('aria-describedby')).textContent, /^Serbia beat Italy 2–1\./);
  const buttons = [...dialog.querySelectorAll('button')];
  assert.deepEqual(buttons.map(button => button.textContent), ['Continue as spectator', 'Retry this setup']);
  assert.ok(buttons.every(button => button.type === 'button'));
  assert.equal(document.activeElement, buttons[0]);
  await key(buttons[0], 'Tab', { shiftKey: true });
  assert.equal(document.activeElement, buttons[1], 'Shift+Tab wraps to the last button');
  await key(buttons[1], 'Tab');
  assert.equal(document.activeElement, buttons[0], 'Tab wraps to the first button');
  await click(buttons[0]);
  await click(buttons[1]);
  assert.deepEqual(calls, ['spectate', 'retry']);
  assert.equal(dialog.querySelectorAll('.manager-stat').length, 3);
  await view.close();
  assert.equal(document.activeElement.id, 'prior', 'focus returns to where it was');

  const legacy = await mount(React.createElement(ManagerElimination, { result: st.managerElimination, onSpectate() {}, onRetry() {} }));
  assert.equal(legacy.host.querySelector('h1').textContent, 'Italy is out');
  assert.match(legacy.host.textContent, /Serbia won the decisive match\. Your campaign ends here\./);
  assert.doesNotMatch(legacy.host.textContent, /2–1/, 'the attacker-first legacy score is not shown');
  await legacy.close();
});

// ---------- Popups ----------

test('map notices keep their exports, test ids and live-region roles in the v4 panel markup', async () => {
  const view = await mount(React.createElement('div', null,
    React.createElement(Toast, { code: 'ITA', text: "23' GOAL — F. CHIESA", color: '#123456' }),
    React.createElement(MatchupPopup, { label: 'Round 12 — Italy attacks Serbia',
      a: { id: '380', code: 'ITA', color: '#000', name: 'Italy', eff: '84.6' }, b: { code: 'SRB', name: 'Serbia', eff: '80.5' } }),
    React.createElement(ResultPopup, { label: 'Full time — Round 12', score: 'ITA 2–1 SRB', title: 'Italy annexes Serbia', sub: '+3 territories', upset: true, color: '#f00' }),
    React.createElement(StealPopup, { name: 'D. Vlahović', meta: 'Rating 84 · FW', from: 'SRB', fromId: '688', fromColor: '#f00', to: 'ITA', toId: '380', toColor: '#00f', sub: 'Joins Italy' }),
  ));
  const toast = view.host.querySelector('.fi-match-toast[role=status]');
  assert.equal(toast.querySelector('.fi-toast-code').textContent, 'ITA');
  assert.equal(toast.querySelector('.fi-toast-text').textContent, "23' GOAL — F. CHIESA");
  assert.equal(toast.getAttribute('style'), null, 'v4 toasts carry no team colour');
  const matchup = view.host.querySelector('[data-testid="matchup-notice"].fi-map-notice[role=status]');
  assert.equal(matchup.querySelector('.fi-notice-label').textContent, 'Round 12 — Italy attacks Serbia');
  assert.deepEqual([...matchup.querySelectorAll('.fi-matchup-name')].map(node => node.textContent), ['Italy', 'Serbia']);
  assert.deepEqual([...matchup.querySelectorAll('.fi-matchup-eff')].map(node => node.textContent), ['Strength 84.6', 'Strength 80.5']);
  assert.equal(matchup.querySelector('.fi-matchup-vs').textContent, 'v');
  assert.ok(matchup.querySelector('.fi-team-monogram'), 'a side without a flag id falls back to a monogram');
  const result = view.host.querySelector('[data-testid="result-notice"].fi-map-notice.fi-result-notice[role=status]');
  assert.equal(result.querySelector('.fi-result-notice-title').textContent, 'Italy annexes Serbia');
  assert.equal(result.querySelector('.fi-result-notice-score').textContent, 'ITA 2–1 SRB');
  assert.equal(result.querySelector('.fi-result-notice-upset').textContent, 'Upset victory');
  assert.equal(result.querySelector('.fi-result-notice-sub').textContent, '+3 territories');
  assert.equal(result.getAttribute('style'), null);
  const transfer = view.host.querySelector('[data-testid="transfer-notice"].fi-map-notice.fi-transfer-notice[role=status]');
  assert.equal(transfer.querySelector('.fi-notice-label').textContent, 'Player claimed');
  assert.equal(transfer.querySelector('.fi-transfer-player strong').textContent, 'D. Vlahović');
  assert.deepEqual([...transfer.querySelectorAll('.fi-transfer-code')].map(node => node.textContent), ['SRB', 'ITA']);
  assert.equal(transfer.querySelector('.fi-transfer-arrow .sr-only').textContent, 'to');
  assert.equal(transfer.querySelector('.fi-transfer-sub').textContent, 'Joins Italy');
  assert.equal(view.host.querySelector('.fi-map-notice [title]'), null);
  await view.close();
});

// ---------- CSS contracts measured in the browser (see W2-UI-LOG): keep them from regressing silently ----------

test('layout guards: sticky signing footer, notices clear of the map chrome and hidden on the conquest view', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = async path => (await readFile(new URL(`../${path}`, import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (text, selector) => {
    const at = text.indexOf(`${selector} {`);
    assert.ok(at >= 0, `missing ${selector}`);
    return text.slice(at, text.indexOf('}', at));
  };
  const conquest = await css('src/screens/conquest/conquest.css');
  const footer = rule(conquest, '.conquest-footer');
  assert.match(footer, /position:sticky; bottom:0/, 'the CTA stays in view whenever the article scrolls');
  assert.match(footer, /margin-top:auto/);
  assert.match(footer, /background:var\(--surface\)/);
  assert.match(rule(conquest, '.conquest-effect__more'), /flex:none; white-space:nowrap/);
  const popups = await css('src/components/popups.css');
  assert.match(popups, /\.app-shell\[data-view=conquest\] \.fi-match-toast,\s*\.app-shell\[data-view=conquest\] \.fi-map-notice \{ display:none; \}/);
  const tablet = popups.slice(popups.indexOf('@media (max-width:1199.98px)'), popups.indexOf('@media (max-width:699.98px)'));
  assert.match(tablet, /right:calc\(var\(--map-inset\) \+ var\(--wm-zoom-size, 36px\) \+ 8px\)/, 'tablet notices step in by the zoom column');
  assert.doesNotMatch(tablet, /bottom:/, 'tablet notices stay out of the bottom-right zoom corner');
  const phone = popups.slice(popups.indexOf('@media (max-width:699.98px)'));
  assert.match(phone, /right:calc\(var\(--map-inset\) \+ var\(--wm-zoom-size, 44px\) \+ 8px\)/, 'phone notice stops short of the zoom column');
});

test('callout nudge: left and up of the taken land, and clear of its lower half on the phone', async () => {
  const { readFile } = await import('node:fs/promises');
  const conquest = (await readFile(new URL('../src/screens/conquest/conquest.css', import.meta.url), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // The anchor wrapper centres the card on the land (translate -50% -50%); this is the card's extra offset.
  const nudge = block => {
    const at = block.search(/(^|\s)\.callout \{/);
    assert.ok(at >= 0, 'missing .callout rule');
    const body = block.slice(at, block.indexOf('}', at));
    const m = body.match(/transform:translate\((-?[\d.]+)%,\s*(-?[\d.]+)%\)/);
    assert.ok(m, `no percentage translate in ${body}`);
    return { x: Number(m[1]), y: Number(m[2]) };
  };
  const phoneAt = conquest.indexOf('@media (max-width:699.98px)');
  assert.ok(phoneAt > 0, 'missing the phone block');
  const base = nudge(conquest.slice(0, conquest.indexOf('@media')));
  assert.deepEqual(base, { x: -25, y: -33 }, 'D1: a quarter of the card left, about a third of its height up');
  const phone = nudge(conquest.slice(phoneAt));
  assert.equal(phone.x, -25, 'D2: a quarter of the card left');
  // The phone land box is often shorter than the ~50px card (Belgium ~40px, Luxembourg ~14px at 390): with the
  // card's bottom edge at or below the land's centre it hid the whole hatch. Bottom edge = centre + (50 + y)% of h.
  assert.ok(phone.y <= -55, `phone card bottom edge must sit above the land's centre (got ${phone.y}%)`);
  assert.ok(phone.y > -75, `phone card must still overlap the land (got ${phone.y}%)`);
});

test('no React warnings or errors were logged', () => {
  assert.deepEqual(consoleProblems, []);
});
