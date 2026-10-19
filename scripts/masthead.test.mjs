// Owner: WP-0 (see PLAN.md §5.2; WP-INT in W3). The v4 masthead: CommandBar markup contract (nav, primary, team
// block, stats), the buildMasthead model and the shared formatters, PlaybackBar variants and the phone chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React, { act } from 'react';
import { buildTeam, makeRng, teamEff } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { buildMasthead } from '../src/viewModels/masthead.js';
import { displayRound, formatOddsPair, formatWinChance, plainScopeName, roman, signedDelta, winTone } from '../src/viewModels/format.js';
import { createMinuteStore } from '../src/engine/liveMinute.js';
import { bundleComponents, withDom } from './lib/app-harness.mjs';

const { CommandBar, SettingsPanel, PlaybackBar, PhoneBar, PhoneTabBar, PhoneMoreSheet } = await bundleComponents({
  CommandBar: 'src/components/CommandBar.jsx',
  SettingsPanel: ['src/components/CommandBar.jsx', 'SettingsPanel'],
  PlaybackBar: 'src/components/PlaybackBar.jsx',
  PhoneBar: ['src/components/PhoneChrome.jsx', 'PhoneBar'],
  PhoneTabBar: ['src/components/PhoneChrome.jsx', 'PhoneTabBar'],
  PhoneMoreSheet: ['src/components/PhoneChrome.jsx', 'PhoneMoreSheet'],
});

const MINUS = '−';
const sport = getSport('football');
const rng = makeRng(4242);
const IDS = ['380', '688', '276', '250'];

/** Italy, Serbia, Germany, France with live squads; territories 3/2/1/0 (France holds none). */
function campaign({ baseDelta = { 380: -2.3, 688: 1.4, 276: 0 }, round = 18 } = {}) {
  const teams = Object.fromEntries(IDS.map(id => [id, buildTeam(id, makeRng(Number(id)), sport)]));
  for (const [id, delta] of Object.entries(baseDelta)) teams[id].baseEff = Math.round((teamEff(teams[id]) + delta) * 10) / 10;
  const own = { 380: '380', 'it-2': '380', 'it-3': '380', 688: '688', 'rs-2': '688', 276: '276', 250: '276' };
  const st = {
    phase: 'playing', round, teams, own, aliveIds: ['380', '688', '276'], matches: 33, queue: [], match: null, spin: null,
    stats: { 380: { conq: 4, steals: [{}, {}] }, 688: { conq: 1, steals: [] } },
    history: [{ result: { upset: true } }, { result: { upset: false } }, { result: { upset: true } }, {}],
    settings: { sport: 'football', turnOrder: 'random' },
  };
  return st;
}
const ctxFor = (st, { managedId = null, followedId = null } = {}) => ({
  board: { own: st.own, aliveIds: st.aliveIds }, managedId, followedId, displayRound: displayRound(st),
  totalTeams: Object.keys(st.teams).length, cache: new Map(),
});
const statOf = (model, key) => model.stats.find(stat => stat.key === key);

// ---------- shared formatters (PLAN §3.4) ----------

test('format helpers: roman numerals, win chance, tones and signed deltas', () => {
  assert.equal(roman(19), 'XIX');
  assert.equal(roman(1994), 'MCMXCIV');
  assert.equal(roman(0), '');
  assert.equal(roman(null), '');
  assert.deepEqual([formatWinChance(.004), formatWinChance(.995), formatWinChance(.374), formatWinChance(null)], ['<1%', '>99%', '37%', '']);
  // One rounding for both sides of a fixture: a k/512 estimate on a half (192/512 = 37.5%) reads 38% / 62%, never 63%.
  assert.deepEqual(formatOddsPair(192 / 512), { a: '38%', b: '62%', aShown: 38, bShown: 62 });
  assert.deepEqual(formatOddsPair(.004), { a: '<1%', b: '>99%', aShown: 0, bShown: 100 });
  assert.deepEqual(formatOddsPair(.995), { a: '>99%', b: '<1%', aShown: 100, bShown: 0 });
  assert.deepEqual(formatOddsPair(null), { a: '', b: '', aShown: null, bShown: null });
  assert.deepEqual(formatOddsPair(1.4), { a: '>99%', b: '<1%', aShown: 100, bShown: 0 }, 'clamped');
  // The data's footnote marker is a setup-only device.
  assert.deepEqual([plainScopeName('Asia & Oceania*'), plainScopeName('Europe'), plainScopeName(undefined)], ['Asia & Oceania', 'Europe', '']);
  assert.deepEqual([winTone(.6), winTone(.596), winTone(.45), winTone(.444), winTone(undefined)], ['gain', 'gain', 'even', 'loss', 'muted']);
  assert.deepEqual(signedDelta(2.34), { text: '+2.3', tone: 'gain' });
  assert.deepEqual(signedDelta(-1.36), { text: `${MINUS}1.4`, tone: 'loss' });
  assert.equal(signedDelta(-1.36).text.charCodeAt(0), 0x2212, 'loss uses U+2212, not a hyphen');
  assert.deepEqual(signedDelta(0.04), { text: '±0.0', tone: 'muted' });
  assert.deepEqual(signedDelta(-0.04), { text: '±0.0', tone: 'muted' });
  assert.deepEqual(signedDelta(undefined), { text: '±0.0', tone: 'muted' });
});

test('displayRound: busy keeps the round, idle shows the next one', () => {
  const st = campaign();
  assert.equal(displayRound(st), 19);
  assert.equal(displayRound({ ...st, match: { applied: false } }), 18);
  assert.equal(displayRound({ ...st, match: { applied: true } }), 19);
  assert.equal(displayRound({ ...st, spin: {} }), 18);
  assert.equal(displayRound({ ...st, choice: {} }), 18);
  assert.equal(displayRound(null), 0);
  // A completed campaign has no next round: the final one, as the victory overlay shows it.
  assert.equal(displayRound({ ...st, aliveIds: ['380'] }), 18);
  assert.equal(displayRound({ ...st, aliveIds: ['380'], settings: { turnOrder: 'round-robin' }, turnQueue: [], turnIndex: 0 }), 18);
  assert.equal(displayRound({ round: 0, aliveIds: [] }), 1, 'setup (no teams yet) still reads Round I');
});

test('a completed campaign dates the masthead with its final round', () => {
  const st = { ...campaign(), aliveIds: ['380'] };
  const model = buildMasthead(st, ctxFor(st, { managedId: '380' }));
  assert.deepEqual([model.roundLabel, model.roundShort, model.remain], ['Round XVIII', 'R XVIII', '1 of 4 remain']);
});

// ---------- buildMasthead (FROZEN shape) ----------

test('manager model: team, role, round copy and the four stats with signed strength delta', () => {
  const st = campaign();
  const italy = st.teams['380'];
  const model = buildMasthead(st, ctxFor(st, { managedId: '380', followedId: '688' }));
  assert.equal(model.variant, 'manager');
  assert.deepEqual(model.team, { teamId: '380', flagId: italy.flagId, isClub: false, code: italy.code, color: italy.col, name: italy.name });
  assert.equal(model.name, italy.name);
  assert.equal(model.role, 'Managed by you');
  assert.deepEqual([model.roman, model.roundLabel, model.roundShort, model.remain], ['XIX', 'Round XIX', 'R XIX', '3 of 4 remain']);
  assert.deepEqual(model.stats.map(stat => [stat.key, stat.label, stat.short]), [
    ['strength', 'Strength', 'Str'], ['territories', 'Territories', 'Terr'], ['conquests', 'Conquests', 'Conq'], ['claimed', 'Claimed', 'Claimed']]);
  const strength = statOf(model, 'strength');
  assert.equal(strength.value, teamEff(italy).toFixed(1));
  assert.deepEqual([strength.delta, strength.tone], ['+2.3', 'gain']);
  assert.ok(strength.tip);
  assert.deepEqual(model.stats.slice(1).map(stat => stat.value), ['3', '4', '2']);
  assert.ok(model.stats.slice(1).every(stat => stat.delta === '' && stat.tone === 'muted'));
});

test('the strength tip names the sport lineup: Starting XI, or Starting five for basketball', () => {
  const st = campaign();
  const tip = ctx => statOf(buildMasthead(st, ctx), 'strength').tip;
  assert.equal(tip(ctxFor(st, { managedId: '380' })), 'Starting XI strength · change since Round I');
  assert.equal(tip({ ...ctxFor(st, { managedId: '380' }), sport: { id: 'basketball' } }), 'Starting five strength · change since Round I');
  assert.equal(tip({ ...ctxFor(st, { managedId: '380' }), sport: 'basketball' }), 'Starting five strength · change since Round I');
});

test('manager deltas: U+2212 loss, ±0.0 muted, and teams without baseEff', () => {
  const st = campaign();
  const serbia = statOf(buildMasthead(st, ctxFor(st, { managedId: '688' })), 'strength');
  assert.deepEqual([serbia.delta, serbia.tone], [`${MINUS}1.4`, 'loss']);
  const germany = statOf(buildMasthead(st, ctxFor(st, { managedId: '276' })), 'strength');
  assert.deepEqual([germany.delta, germany.tone], ['±0.0', 'muted']);
  delete st.teams['276'].baseEff;
  const unbased = buildMasthead(st, ctxFor(st, { managedId: '276' }));
  assert.deepEqual([statOf(unbased, 'strength').delta, statOf(unbased, 'strength').tone], ['±0.0', 'muted']);
  // stats {} and an unknown team in stats: zeros, never a throw.
  const bare = buildMasthead({ ...st, stats: {} }, ctxFor(st, { managedId: '276' }));
  assert.deepEqual(bare.stats.map(stat => stat.value).slice(1), ['2', '0', '0']);
  const noStats = buildMasthead({ ...st, stats: undefined }, ctxFor(st, { managedId: '688' }));
  assert.deepEqual(noStats.stats.map(stat => stat.value).slice(1), ['2', '0', '0']);
});

test('board null (loading) counts no territories', () => {
  const st = campaign();
  const model = buildMasthead(st, { ...ctxFor(st, { managedId: '380' }), board: null });
  assert.equal(statOf(model, 'territories').value, '0');
});

test('spectator model: followed team, Spectating, campaign stats without deltas', () => {
  const st = campaign();
  const model = buildMasthead(st, ctxFor(st, { followedId: '688' }));
  assert.equal(model.variant, 'spectator');
  assert.equal(model.name, 'Spectating');
  assert.equal(model.role, `Following ${st.teams['688'].name}`);
  assert.equal(model.team.teamId, '688');
  assert.deepEqual(model.stats.map(stat => [stat.key, stat.label, stat.short, stat.value]), [
    ['empires', 'Empires', 'Empires', '3'], ['matches', 'Matches', 'Matches', '33'], ['upsets', 'Upsets', 'Upsets', '2'],
    ['largest', 'Largest', 'Largest', `${st.teams['380'].code} · 3`]]);
  assert.ok(model.stats.every(stat => stat.delta === '' && stat.tone === 'muted'));
  const unfollowed = buildMasthead(st, ctxFor(st));
  assert.deepEqual([unfollowed.variant, unfollowed.team, unfollowed.role], ['spectator', null, 'No team followed']);
});

test('largest empire ties resolve in aliveIds order', () => {
  const st = campaign();
  st.own = { a: '688', b: '688', c: '276', d: '276' };
  assert.equal(statOf(buildMasthead(st, ctxFor(st)), 'largest').value, `${st.teams['688'].code} · 2`);
  st.aliveIds = ['276', '688', '380'];
  assert.equal(statOf(buildMasthead(st, ctxFor(st)), 'largest').value, `${st.teams['276'].code} · 2`);
});

test('buildMasthead tolerates loading and setup state (teams {}, aliveIds [], empty ctx)', () => {
  for (const st of [{ phase: 'loading', teams: {}, aliveIds: [], round: 0 }, { phase: 'setup', teams: {}, aliveIds: [], round: 0, stats: {} }]) {
    const model = buildMasthead(st, { board: null, managedId: '380', followedId: '688', cache: new Map() });
    assert.equal(model.variant, 'spectator');
    assert.equal(model.remain, '0 of 0 remain');
    assert.equal(model.roman, 'I');
    assert.equal(statOf(model, 'largest').value, '—');
  }
  assert.doesNotThrow(() => buildMasthead({}, undefined));
});

test('during a pending signing the masthead shows the current, pre-signing values (DEC D15)', () => {
  const st = campaign();
  const before = buildMasthead(st, ctxFor(st, { managedId: '380' }));
  const choice = { candidates: [{ index: 0, name: 'X', gain: 1.2 }], selected: 0 };
  const during = buildMasthead({ ...st, choice }, ctxFor({ ...st, choice }, { managedId: '380' }));
  assert.deepEqual(during.stats, before.stats);
  assert.equal(during.roman, 'XVIII', 'the round being decided');
});

// ---------- CommandBar markup contract ----------

const noop = () => {};
function barProps(overrides = {}) {
  const st = campaign();
  return {
    show: true, sportName: 'Football', layerName: 'Nations', scopeName: 'Europe', round: 18, alive: 3,
    pacing: 'duel', resolution: 'ticker', confirmNew: false, busy: false, completed: false, saveStatus: { ok: true, message: 'Saved' },
    onPacing: noop, onResolution: noop, onNew: noop, onCancelNew: noop, onExport: noop, onImport: noop, onResults: noop,
    seed: 2026, settings: st.settings, onSetting: noop, managementEnded: false, onManageSaves: noop,
    view: 'map', navLocked: false, onView: noop, primary: { id: 'continue', label: 'Continue' }, onPrimary: noop,
    masthead: buildMasthead(st, ctxFor(st, { managedId: '380' })), playback: null,
    ...overrides,
  };
}
const navIds = host => [...host.querySelectorAll('nav.mast__nav[aria-label="Screens"] button')].map(button => button.id);

test('CommandBar nav: ids, labels, aria-current and the A-13 lock', async () => {
  await withDom(async ({ mount }) => {
    const views = [];
    const view = await mount(CommandBar, barProps({ onView: id => views.push(id) }));
    assert.equal(view.host.querySelector('header.mast').dataset.variant, 'manager');
    assert.deepEqual(navIds(view.host), ['view-tab-map', 'view-tab-squad', 'view-tab-match', 'view-tab-ledger', 'view-tab-chronicle']);
    assert.deepEqual([...view.host.querySelectorAll('.mast__tab')].map(tab => tab.textContent), ['Map', 'Squad', 'Match', 'Ledger', 'Chronicle']);
    assert.ok([...view.host.querySelectorAll('.mast__tab')].every(tab => tab.getAttribute('type') === 'button'));
    assert.equal(view.host.querySelector('#view-tab-map').getAttribute('aria-current'), 'page');
    assert.equal(view.host.querySelectorAll('[aria-current]').length, 1);
    await act(async () => view.host.querySelector('#view-tab-ledger').click());
    assert.deepEqual(views, ['ledger']);

    await view.render(barProps({ view: 'chronicle' }));
    assert.equal(view.host.querySelector('#view-tab-chronicle').getAttribute('aria-current'), 'page');
    assert.equal(view.host.querySelector('#view-tab-map').hasAttribute('aria-current'), false);

    await view.render(barProps({ navLocked: true }));
    const disabled = [...view.host.querySelectorAll('.mast__tab')].map(tab => [tab.id, tab.disabled]);
    assert.deepEqual(disabled, [['view-tab-map', false], ['view-tab-squad', true], ['view-tab-match', true], ['view-tab-ledger', true],
      ['view-tab-chronicle', true]]);

    await view.render(barProps({ view: null }));
    assert.equal(view.host.querySelectorAll('[aria-current]').length, 0, 'setup highlights nothing');

    await view.render(barProps({ show: false }));
    assert.ok(!view.host.querySelector('nav'));
    assert.ok(!view.host.querySelector('.mast__row2'));
    assert.ok(!view.host.querySelector('[data-primary]'));
  });
});

test('CommandBar primary: exact textContent, Space key-hint attribute (never text), disabled and click', async () => {
  await withDom(async ({ mount }) => {
    let runs = 0;
    const view = await mount(CommandBar, barProps({ onPrimary: () => runs++ }));
    const cta = () => view.host.querySelector('button.btn-primary.mast__cta[data-primary]');
    assert.equal(cta().textContent, 'Continue');
    assert.equal(cta().getAttribute('data-key-hint'), 'Space');
    assert.equal(cta().getAttribute('type'), 'button');
    assert.equal(cta().disabled, false);
    await act(async () => cta().click());
    assert.equal(runs, 1);

    // The label sits in its own span (it ellipsizes on tablet) and is the button's whole text.
    assert.equal(cta().querySelector('.mast__cta-label').textContent, 'Continue');
    assert.equal(cta().children.length, 1);
    await view.render(barProps({ primary: { id: 'sign', label: 'Sign Federico Chiesa', mastLabel: 'Sign player' } }));
    assert.equal(cta().textContent, 'Sign player');
    await view.render(barProps({ primary: { id: 'drawing', label: 'Continue', disabled: true } }));
    assert.equal(cta().disabled, true);
    assert.equal(cta().textContent, 'Continue');
    await view.render(barProps({ primary: null }));
    assert.ok(!cta());
    // Nav and primary come before any other button with the same text (smoke's button(label) finds the masthead first).
    await view.render(barProps({ primary: { id: 'pause', label: 'Pause' } }));
    const texts = [...view.host.querySelectorAll('button')].map(button => button.textContent);
    assert.ok(texts.indexOf('Pause') > texts.indexOf('Chronicle'));
  });
});

test('CommandBar row 2: managed team block, long/short labels, value and toned delta', async () => {
  await withDom(async ({ mount }) => {
    const props = barProps();
    const view = await mount(CommandBar, props);
    const block = view.host.querySelector('[aria-label="Managed team"]');
    assert.ok(block);
    assert.equal(block.querySelector('.mast__team').textContent, props.masthead.name);
    assert.equal(block.querySelector('.mast__role').textContent, 'Managed by you');
    const stats = [...view.host.querySelectorAll('.mast__stat')];
    assert.equal(stats.length, 4);
    assert.deepEqual(stats.map(stat => [stat.querySelector('.mast__label-long').textContent, stat.querySelector('.mast__label-short').textContent]),
      [['Strength', 'Str'], ['Territories', 'Terr'], ['Conquests', 'Conq'], ['Claimed', 'Claimed']]);
    assert.equal(stats[0].querySelector('b.mast__value').textContent, props.masthead.stats[0].value);
    const delta = stats[0].querySelector('.mast__delta');
    assert.deepEqual([delta.textContent, delta.dataset.tone], ['+2.3', 'gain']);
    assert.ok(!stats[1].querySelector('.mast__delta'), 'no empty delta node');
    assert.equal(view.host.querySelector('.mast__dateline').textContent, 'Round XIX · 3 of 4 remain');
    assert.ok([...view.host.querySelectorAll('.mast__round')].some(node => node.textContent === 'R XIX'));

    const st = campaign();
    await view.render(barProps({ masthead: buildMasthead(st, ctxFor(st, { followedId: '688' })) }));
    assert.equal(view.host.querySelector('header.mast').dataset.variant, 'spectator');
    assert.ok(!view.host.querySelector('[aria-label="Managed team"]'));
    const followed = view.host.querySelector('[aria-label="Followed team"]');
    assert.equal(followed.querySelector('.mast__team').textContent, 'Spectating');
    assert.equal(followed.querySelector('.mast__role').textContent, `Following ${st.teams['688'].name}`);
    assert.deepEqual([...view.host.querySelectorAll('.mast__label-short')].map(node => node.textContent), ['Empires', 'Matches', 'Upsets', 'Largest']);
    assert.equal(view.host.querySelectorAll('.mast__delta').length, 0);
  });
});

test('CommandBar keeps the HEAD props working: no nav without onView, dateline fallback without a model', async () => {
  await withDom(async ({ mount }) => {
    const view = await mount(CommandBar, barProps({ onView: undefined, masthead: null, round: 4, alive: 9 }));
    assert.ok(!view.host.querySelector('nav'));
    assert.equal(view.host.querySelector('.mast__dateline').textContent, 'Round IV · 9 remaining');
    assert.ok(!view.host.querySelector('.mast__row2'));
  });
});

test('CommandBar settings popover holds SettingsPanel with read-only rules', async () => {
  await withDom(async ({ mount }) => {
    const view = await mount(CommandBar, barProps({ settings: { ...campaign().settings, turnOrder: 'round-robin', targeting: 'player' } }));
    await act(async () => view.host.querySelector('button[aria-label="Settings"]').click());
    const popover = view.host.querySelector('#campaign-settings');
    assert.ok(popover);
    assert.equal(popover.querySelector('#campaign-turn-order').value, 'round-robin');
    assert.equal(popover.querySelector('#campaign-turn-order').disabled, true);
    assert.equal(popover.querySelector('#campaign-targeting').value, 'player');
    assert.equal(popover.querySelector('#campaign-targeting').disabled, true);
    assert.equal(popover.querySelector('#campaign-pacing').disabled, true);
  });
});

test('a modal opened from the settings popover owns Escape and the pointer; the popover waits underneath', async () => {
  await withDom(async ({ document, window, mount }) => {
    const view = await mount(CommandBar, barProps());
    const trigger = view.host.querySelector('button[aria-label="Settings"]');
    const popover = () => view.host.querySelector('#campaign-settings');
    await act(async () => trigger.click());
    assert.ok(popover());
    const escape = () => act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    // Saved campaigns / Export open an aria-modal dialog; its listener runs after the popover's (registered later).
    const modal = document.createElement('section');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = '<button type="button">Close saved campaigns</button>';
    document.body.append(modal);
    await escape();
    assert.ok(popover(), 'Escape closes only the dialog on top');
    await act(async () => modal.querySelector('button').dispatchEvent(new window.Event('pointerdown', { bubbles: true })));
    assert.ok(popover(), 'a click inside the dialog keeps the control that opened it mounted');
    modal.remove();
    await escape();
    assert.ok(!popover(), 'with no modal, Escape closes the popover');
    assert.equal(document.activeElement, trigger, 'and returns focus to the gear');
  });
});

// ---------- masthead CSS (layout is measured in a browser; these pin the cascade the layout depends on) ----------

const readCss = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
/** Flat list of `{ media, selectors, body }` style rules (comments dropped, nested @media flattened). */
function cssRules(text) {
  const rules = [];
  const walk = (source, media) => {
    let index = 0;
    while (index < source.length) {
      const open = source.indexOf('{', index);
      if (open < 0) break;
      const prelude = source.slice(index, open).trim();
      let depth = 1, end = open + 1;
      while (end < source.length && depth) { if (source[end] === '{') depth++; else if (source[end] === '}') depth--; end++; }
      const body = source.slice(open + 1, end - 1);
      if (prelude.startsWith('@media')) walk(body, prelude);
      else if (!prelude.startsWith('@')) rules.push({ media, selectors: prelude.split(',').map(s => s.trim()), body });
      index = end;
    }
  };
  walk(text.replace(/\/\*[\s\S]*?\*\//g, ''), null);
  return rules;
}
/** Class-level specificity (classes, attributes, pseudo-classes) of a compound selector; ids weigh 100. */
const specificity = selector => (selector.match(/#[\w-]+/g) || []).length * 100 + (selector.match(/\.[\w-]+/g) || []).length
  + (selector.match(/\[[^\]]+\]/g) || []).length + (selector.match(/(^|[^:]):[\w-]+/g) || []).length;
const sets = (body, property, value) => new RegExp(`(^|;|\\s)${property}\\s*:\\s*${value}`).test(body);

test('phone: the masthead primary is hidden by a selector that outranks primitives .btn-primary (load order aside)', () => {
  const primitives = cssRules(readCss('src/styles/primitives.css'));
  const display = primitives.flatMap(rule => sets(rule.body, 'display', '[a-z-]+') ? rule.selectors : [])
    .filter(selector => /\.btn-primary(?![\w-])/.test(selector) && !selector.includes('::') && !/\s/.test(selector));
  assert.ok(display.length, 'primitives give .btn-primary a display');
  const strongest = Math.max(...display.map(specificity));
  const phone = cssRules(readCss('src/components/masthead.css')).filter(rule => rule.media?.includes('max-width:699.98px'));
  const hide = phone.flatMap(rule => sets(rule.body, 'display', 'none') ? rule.selectors : []).filter(selector => selector.includes('mast__cta'));
  assert.ok(hide.length, 'the phone block hides the masthead CTA');
  assert.ok(Math.max(...hide.map(specificity)) > strongest,
    `the hide rule (${hide.join(', ')}) must outrank ${display.join(', ')}: component CSS loads before primitives.css`);
});

test('tablet: the masthead primary can shrink and ellipsize so the settings gear never leaves row 1', () => {
  const rules = cssRules(readCss('src/components/masthead.css'));
  const tablet = rules.filter(rule => rule.media?.includes('max-width:1199.98px') && rule.selectors.includes('.btn-primary.mast__cta'));
  assert.ok(tablet.some(rule => sets(rule.body, 'flex', '0 1 auto') && sets(rule.body, 'min-width', '0')), 'CTA flex-shrinks below 1200px');
  const label = rules.find(rule => !rule.media && rule.selectors.includes('.mast__cta-label'));
  assert.ok(label && sets(label.body, 'text-overflow', 'ellipsis') && sets(label.body, 'overflow', 'hidden') && sets(label.body, 'min-width', '0'));
  // Everything else in row 1 stays rigid (the gear, nav and wordmark never shrink).
  for (const selector of ['.mast__wordmark', '.mast__nav', '.command-extras']) {
    assert.ok(rules.some(rule => !rule.media && rule.selectors.includes(selector) && sets(rule.body, 'flex', 'none')), selector);
  }
});

// ---------- PlaybackBar variants ----------

const playbackProps = (overrides = {}) => ({ speed: 2, autoplay: false, completed: false, paused: false, live: false, busy: false,
  stepLabel: 'Next match', stateLabel: 'Ready', summary: null, onSpeed: noop, onStep: noop, onPlay: noop, onPause: noop, ...overrides });

test('PlaybackBar masthead variant: step only when shown, autoplay names, speed text, no status node', async () => {
  await withDom(async ({ mount }) => {
    let steps = 0, plays = 0, speeds = 0;
    const view = await mount(PlaybackBar, playbackProps({ variant: 'masthead', onStep: () => steps++, onPlay: () => plays++, onSpeed: () => speeds++ }));
    const root = view.host.querySelector('.playback-mast');
    assert.ok(root);
    assert.ok(!view.host.querySelector('[role=status]'));
    assert.equal(root.querySelector('.playback-step').textContent, 'Next match');
    const play = root.querySelector('.playback-play');
    assert.deepEqual([play.textContent, play.getAttribute('aria-label'), play.getAttribute('aria-pressed')], ['Autoplay off', 'Play campaign', 'false']);
    assert.equal(root.querySelector('.playback-speed').textContent, 'Speed 2×');
    assert.equal(root.querySelector('.playback-speed').getAttribute('aria-label'), 'Playback speed 2 times. Change speed.');
    await act(async () => { root.querySelector('.playback-step').click(); play.click(); root.querySelector('.playback-speed').click(); });
    assert.deepEqual([steps, plays, speeds], [1, 1, 1]);

    await view.render(playbackProps({ variant: 'masthead', autoplay: true, showStep: false, stepLabel: 'Finish match' }));
    assert.ok(!view.host.querySelector('.playback-step'));
    const on = view.host.querySelector('.playback-play');
    assert.deepEqual([on.textContent, on.getAttribute('aria-label'), on.getAttribute('aria-pressed')], ['Autoplay on', 'Pause', 'true']);
    await view.render(playbackProps({ variant: 'masthead', stepLabel: 'Finish match', paused: true }));
    assert.equal(view.host.querySelector('.playback-step').textContent, 'Finish match');
    assert.equal(view.host.querySelector('.playback-step').disabled, true, 'paused');
  });
});

test('PlaybackBar sheet variant keeps the names and step visibility; default bar keeps its status node', async () => {
  await withDom(async ({ mount }) => {
    const view = await mount(PlaybackBar, playbackProps({ variant: 'sheet', id: 'campaign-playback-sheet' }));
    assert.ok(view.host.querySelector('#campaign-playback-sheet.playback-sheet'));
    assert.ok(!view.host.querySelector('[role=status]'));
    assert.equal(view.host.querySelector('.playback-play').getAttribute('aria-label'), 'Play campaign');
    assert.ok(view.host.querySelector('.playback-step').textContent.startsWith('Next match'));
    await view.render(playbackProps({ variant: 'sheet', id: 'campaign-playback-sheet', showStep: false, autoplay: true }));
    assert.ok(!view.host.querySelector('.playback-step'));
    assert.equal(view.host.querySelector('.playback-play').getAttribute('aria-label'), 'Pause');
    await view.render(playbackProps());
    assert.ok(view.host.querySelector('#campaign-playback.playback-bar [role=status]'));
  });
});

test('PlaybackBar sheet variant: a fixed "Playback" heading, the live state as a sub-line below it', async () => {
  await withDom(async ({ mount }) => {
    const summary = { text: 'FRA 1–0 GER', label: 'France 1, Germany 0' };
    const view = await mount(PlaybackBar, playbackProps({ variant: 'sheet', id: 'campaign-playback-sheet', stateLabel: 'Choose an approach', summary }));
    const head = view.host.querySelector('.playback-sheet__head');
    assert.equal(head.querySelector('h3.playback-sheet__title').textContent, 'Playback');
    assert.equal(head.querySelector('.playback-sheet__state').textContent, 'Choose an approach · FRA 1–0 GER');
    const first = view.host.querySelector('.playback-sheet').firstElementChild;
    assert.equal(first, head, 'the heading leads the section, before the controls');
    await view.render(playbackProps({ variant: 'sheet', id: 'campaign-playback-sheet', stateLabel: 'Drawing' }));
    assert.equal(view.host.querySelector('.playback-sheet__title').textContent, 'Playback', 'the heading never follows the state');
    assert.equal(view.host.querySelector('.playback-sheet__state').textContent, 'Drawing');
  });
});

// ---------- phone chrome ----------

test('PhoneBar: the label alone is the button text; round, minute and gain sit outside it', async () => {
  await withDom(async ({ mount }) => {
    let runs = 0;
    const view = await mount(PhoneBar, { primary: { id: 'continue', label: 'Continue' }, right: 'Round XIX', rightKind: 'round', onPrimary: () => runs++ });
    const button = view.host.querySelector('button.phone-bar__btn[data-primary]');
    assert.equal(button.textContent, 'Continue');
    const right = view.host.querySelector('.phone-bar__right');
    assert.equal(right.textContent, 'Round XIX');
    assert.equal(button.contains(right), false);
    assert.equal(right.getAttribute('aria-hidden'), 'true');
    await act(async () => button.click());
    assert.equal(runs, 1);

    const store = createMinuteStore(12);
    await view.render({ primary: { id: 'finish', label: 'Finish match' }, rightKind: 'minute', minuteStore: store, minuteFallback: 0 });
    assert.equal(view.host.querySelector('.phone-bar__right').textContent, "12'");
    await act(async () => store.set(38));
    assert.equal(view.host.querySelector('.phone-bar__right').textContent, "38'");
    await view.render({ primary: { id: 'sign', label: 'Sign Federico Chiesa', mastLabel: 'Sign player' }, right: '+1.2', rightKind: 'gain' });
    assert.equal(view.host.querySelector('.phone-bar__btn').textContent, 'Sign Federico Chiesa');
    assert.equal(view.host.querySelector('.phone-bar__right').textContent, '+1.2');
    await view.render({ primary: { id: 'drawing', label: 'Continue', disabled: true } });
    assert.equal(view.host.querySelector('.phone-bar__btn').disabled, true);
    await view.render({ primary: null });
    assert.ok(!view.host.querySelector('.phone-bar'));
  });
});

test('PhoneBar minute never trails the last revealed event (the Match view rule)', async () => {
  await withDom(async ({ mount }) => {
    const store = createMinuteStore(34);
    const props = minuteFallback => ({ primary: { id: 'finish', label: 'Resume' }, rightKind: 'minute', minuteStore: store, minuteFallback });
    const view = await mount(PhoneBar, props(37));
    const right = () => view.host.querySelector('.phone-bar__right').textContent;
    assert.equal(right(), "37'", 'the clock lags the 37th-minute goal: the bar shows 37, as the band does');
    await act(async () => store.set(41));
    assert.equal(right(), "41'", 'the store leads once it passes the event');
    await view.render(props(0));
    assert.equal(right(), "41'");
  });
});

test('PhoneTabBar: Map/Squad/Match/Ledger/More, aria-current, lock and hidden', async () => {
  await withDom(async ({ mount }) => {
    const views = [];
    let more = 0;
    const view = await mount(PhoneTabBar, { active: 'ledger', onView: id => views.push(id), onMore: () => more++ });
    const nav = view.host.querySelector('nav.tabbar[aria-label="Screens (phone)"]');
    const buttons = [...nav.querySelectorAll('button')];
    assert.deepEqual(buttons.map(button => button.textContent), ['Map', 'Squad', 'Match', 'Ledger', 'More']);
    assert.deepEqual(buttons.map(button => button.getAttribute('aria-current')), [null, null, null, 'page', null]);
    await act(async () => { buttons[1].click(); buttons[4].click(); });
    assert.deepEqual([views, more], [['squad'], 1]);
    await view.render({ active: 'map', locked: true, hidden: true, onView: noop, onMore: noop });
    assert.equal(view.host.querySelector('nav').hidden, true);
    assert.deepEqual([...view.host.querySelectorAll('button')].slice(0, 4).map(button => button.disabled), [false, true, true, true]);
  });
});

test('PhoneMoreSheet: Chronicle, playback and the shared SettingsPanel (A-10)', async () => {
  await withDom(async ({ mount }) => {
    const calls = [];
    const settingsProps = (overrides = {}) => ({ ...barProps(), onNew: () => calls.push('new'), onCancelNew: () => calls.push('cancel'),
      onExport: () => calls.push('export'), onImport: () => calls.push('import'), onSetting: (key, value) => calls.push(`${key}=${value}`),
      onResolution: value => calls.push(`resolution=${value}`), idPrefix: 'sheet-', ...overrides });
    const sheet = (overrides = {}) => React.createElement(PhoneMoreSheet, {
      onClose: () => calls.push('close'), onChronicle: () => calls.push('chronicle'),
      settings: React.createElement(SettingsPanel, settingsProps(overrides)),
      playback: React.createElement(PlaybackBar, playbackProps({ variant: 'sheet', id: 'campaign-playback-sheet' })),
    });
    const view = await mount(() => sheet());
    const root = view.host.querySelector('section.more-sheet[aria-label="More"]');
    assert.ok(root);
    const button = text => [...root.querySelectorAll('button')].find(node => node.textContent.trim() === text);
    await act(async () => button('Chronicle').click());
    assert.ok(root.querySelector('#campaign-playback-sheet .playback-play'));
    assert.ok(button('Export campaign'));
    assert.ok(button('Import campaign'));
    assert.ok(root.querySelector('input[type=file][aria-label="Import campaign file"]'));
    await act(async () => { button('Export campaign').click(); button('New campaign').click(); });
    const resolution = root.querySelector('#sheet-campaign-resolution');
    assert.equal(resolution.disabled, false);
    const express = root.querySelector('#sheet-campaign-express');
    assert.equal(express.type, 'checkbox');
    await act(async () => express.click());
    for (const id of ['sheet-campaign-pacing', 'sheet-campaign-turn-order', 'sheet-campaign-targeting', 'sheet-campaign-uncertainty',
      'sheet-campaign-finale', 'sheet-campaign-role']) assert.equal(root.querySelector(`#${id}`)?.disabled, true, `${id} is read-only`);
    assert.ok(!root.querySelector('.settings-panel [id^="campaign-"]'), 'every settings control id carries the prefix');
    await act(async () => root.querySelector('button[aria-label="Close more"]').click());
    await act(async () => root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.deepEqual(calls, ['chronicle', 'export', 'new', 'express=true', 'close', 'close']);

    const confirm = await mount(() => sheet({ confirmNew: true, completed: true }));
    const confirmRoot = confirm.host.querySelector('.more-sheet');
    const texts = [...confirmRoot.querySelectorAll('button')].map(node => node.textContent.trim());
    assert.ok(texts.includes('Confirm new campaign'));
    assert.ok(texts.includes('Cancel'));
    assert.ok(texts.includes('Campaign results'));
    assert.ok(confirmRoot.querySelector('[role=alert]'));
  });
});

test('PhoneMoreSheet: locked disables Chronicle; closing hands focus back to the More tab', async () => {
  await withDom(async ({ document, mount }) => {
    const chronicle = host => [...host.querySelectorAll('button')].find(node => node.textContent.trim() === 'Chronicle');
    const tabs = await mount(PhoneTabBar, { active: 'map', onView: noop, onMore: noop });
    const moreTab = [...tabs.host.querySelectorAll('button')].at(-1);
    moreTab.focus();
    const sheet = await mount(PhoneMoreSheet, { onClose: noop, onChronicle: noop });
    assert.equal(document.activeElement.id, 'phone-more', 'the sheet takes focus when it opens');
    assert.equal(chronicle(sheet.host).disabled, false);
    await sheet.unmount();
    assert.equal(document.activeElement, moreTab, 'Escape / Close: focus returns to the opener');

    // Opened from nowhere (focus on body): the More tab is still where focus lands.
    document.activeElement.blur();
    const fromBody = await mount(PhoneMoreSheet, { onClose: noop, onChronicle: noop });
    await fromBody.unmount();
    assert.equal(document.activeElement, moreTab);

    // Focus already moved on (a tab, the Chronicle panel): it stays there.
    const elsewhere = await mount(PhoneMoreSheet, { onClose: noop, onChronicle: noop });
    const ledgerTab = tabs.host.querySelectorAll('button')[3];
    ledgerTab.focus();
    await elsewhere.unmount();
    assert.equal(document.activeElement, ledgerTab);

    const locked = await mount(PhoneMoreSheet, { onClose: noop, onChronicle: noop, locked: true });
    assert.equal(chronicle(locked.host).disabled, true, 'A-13: like the masthead nav and the tab bar');
  });
});
