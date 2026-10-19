// Owner: WP-LEDGER (see PLAN.md §5.2). Ledger and Chronicle screens, their view-models, the Match preview dialog,
// the Victory dialog and the dialog/SaveControls contracts. Ports the Sidebar History tests (ui-interaction L67-80,
// further-ui L53-118) and the standings → squad selection (visual-polish L104-137) to the new screens.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act, useState } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const bundled = await build({
  stdin: { contents: `
    export {default as LedgerScreen} from './src/screens/ledger/LedgerScreen.jsx';
    export {default as ChronicleScreen} from './src/screens/ledger/ChronicleScreen.jsx';
    export {default as TacticalChoice} from './src/components/TacticalChoice.jsx';
    export {default as VictoryOverlay} from './src/components/VictoryOverlay.jsx';
    export {default as CampaignStorageDialog} from './src/components/CampaignStorageDialog.jsx';
    export {default as ExportCheckpoint} from './src/components/ExportCheckpoint.jsx';
    export {default as SaveControls} from './src/components/SaveControls.jsx';
    export * as ledgerVM from './src/viewModels/ledger.js';
    export {tacticalOptions} from './src/engine/managerStrategy.js';
    export {getSport} from './src/sports/index.js';
    export {empireFill, V4} from './src/theme.js';
    export {FEED_CAP as SHARED_FEED_CAP} from './src/app/shared.js';
  `, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
  loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const {
  LedgerScreen, ChronicleScreen, TacticalChoice, VictoryOverlay, CampaignStorageDialog, ExportCheckpoint, SaveControls,
  ledgerVM, tacticalOptions, getSport, empireFill, V4, SHARED_FEED_CAP,
} = module.exports;

const dom = new JSDOM('<!doctype html><html><body><button id="prior">Prior focus</button></body></html>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
after(() => dom.window.close());

// React warnings (missing keys, unknown DOM props) fail the test that produced them.
const consoleErrors = [];
const originalError = console.error;
const originalWarn = console.warn;
console.error = (...args) => { consoleErrors.push(args.map(String).join(' ')); };
console.warn = (...args) => { consoleErrors.push(args.map(String).join(' ')); };
after(() => { console.error = originalError; console.warn = originalWarn; });
function assertConsoleClean() {
  const errors = consoleErrors.splice(0);
  assert.deepEqual(errors, [], 'no React console errors or warnings');
}

async function mount(Component, props, context) {
  document.querySelector('#prior').focus();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const view = {
    host, root,
    async render(nextProps) { await act(async () => root.render(React.createElement(Component, nextProps))); },
    async close() { if (!view.closed) { view.closed = true; await act(async () => root.unmount()); host.remove(); } },
  };
  context?.after(() => view.close());
  await view.render(props);
  return view;
}
const key = (target, name, extra = {}) => act(async () => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra })));

// ---------- fixtures ----------
const football = getSport('football');
const team = (id, name, code, rating, extra = {}) => ({ id, name, code, flagId: id, kind: 'nation', col: '#888', sport: 'football',
  squad: football.positionPlan.map((pos, index) => ({ name: `${code} Player ${index}`, pos, rating })), ...extra });
const teams = {
  '380': team('380', 'Italy', 'ITA', 86, { baseEff: 84.5 }),
  '688': team('688', 'Serbia', 'SRB', 80),
  '276': team('276', 'Germany', 'GER', 85),
  '040': team('040', 'Austria', 'AUT', 78),
};
const history = [
  { id: 'm1', round: '001', aId: '276', bId: '040', dId: '040', winnerId: '276', winnerName: 'Germany',
    a: { teamId: '276', id: '276', code: 'GER', name: 'Germany', score: 2 }, b: { teamId: '040', id: '040', code: 'AUT', name: 'Austria', score: 0 },
    result: { winnerId: '276', loserId: '040', winnerName: 'Germany', loserName: 'Austria', upset: false, territories: 1, player: { name: 'AUT Player 3', pos: 'DF', rating: 78 }, strengthGain: .4,
      strengthBefore: 85, strengthAfter: 85.4 } },
  { id: 'm2', round: '002', aId: '688', bId: '380', dId: '380', winnerId: '688', winnerName: 'Serbia', upsetGap: 6,
    a: { teamId: '688', id: '688', code: 'SRB', name: 'Serbia', score: 1 }, b: { teamId: '380', id: '380', code: 'ITA', name: 'Italy', score: 1 },
    result: { winnerId: '688', loserId: '380', winnerName: 'Serbia', loserName: 'Italy', upset: true, tieText: '4–3 on penalties' } },
];
const baseState = () => ({
  phase: 'playing', teams, aliveIds: ['380', '688', '276'],
  own: { '380': '380', '688': '688', '499': '688', '807': '688', '070': '688', '276': '276', '040': '276' },
  stats: { '380': { conq: 3, steals: ['x', 'y'] } }, fallen: [{ id: '040', r: 1 }], history, matches: 2, round: 2,
  settings: { sport: 'football', layer: 'nations', scope: 'UEFA', pacing: 'duel', resolution: 'ticker', finale: 'single' },
  speed: 1, seed: 2026, log: [
    { t: 'sys', r: 0, txt: 'CAMPAIGN BEGINS' },
    { t: 'match', r: 1, txt: 'GER 2–0 AUT', chip: '#888' },
    { t: 'elim', r: 1, txt: 'AUSTRIA FALLS — 1 TERRITORY ANNEXED BY GERMANY' },
    { t: 'upset', r: 2, txt: 'GIANT-KILLING — SERBIA TOPPLES ITALY' },
  ],
});
const ctxFor = (extra = {}) => ({ board: null, geo: null, sport: football, managedId: '380', followedId: null, perspectiveId: '380',
  drama: 6, cache: new Map(), ...extra });
const powerRow = (i, extra = {}) => ({ tid: `t${i}`, rank: i + 1, name: `Team ${i}`, code: `T${i}`, flagId: null, isClub: true, color: '#888',
  territories: String(200 - i), eff: (95 - i * .1).toFixed(1), effGain: { text: i % 3 === 0 ? `+${(i % 7 + 1).toFixed(1)}` : i % 3 === 1 ? '±0.0' : '−0.4' }, ...extra });

// ---------- view-models ----------
test('buildLedger extends power rows, lists the fallen with their conqueror and tolerates loading state', () => {
  const st = baseState();
  const ctx = ctxFor();
  const rows = [
    { tid: '380', rank: 1, name: 'Italy', code: 'ITA', flagId: '380', isClub: false, color: '#888', territories: '2', eff: '86.0', effGain: { text: '+1.5' } },
    { tid: '688', rank: 2, name: 'Serbia', code: 'SRB', flagId: '688', isClub: false, color: '#888', territories: '1', eff: '80.0', effGain: { text: '±0.0' } },
  ];
  const model = ledgerVM.buildLedger(st, ctx, rows);
  assert.equal(model.rows.length, 2);
  assert.deepEqual(Object.keys(rows[0]).every(k => k in model.rows[0]), true, 'power-row keys are kept');
  assert.equal(model.rows[0].conq, '3');
  assert.equal(model.rows[0].claimed, '2');
  assert.deepEqual(model.rows[0].delta, { text: '+1.5', tone: 'gain' });
  assert.equal(model.rows[1].conq, '0', 'stats {} tolerated');
  assert.equal(model.rows[0].you, true);
  assert.equal(model.youLabel, 'You');
  assert.deepEqual(model.fallen.map(f => [f.name, f.roman, f.byName, f.line]), [['Austria', 'I', 'Germany', 'Round I · to Germany']]);
  assert.equal(model.session, '2 games remaining · ~1 min');
  assert.equal(model.header.title, 'Ledger');
  assert.equal(model.header.kicker, 'The European Campaign · Round III', 'idle: the round about to be played');
  assert.equal(model.share.rows[0].pct, '67%');
  assert.equal(model.share.rows[0].fill, V4.youFill, 'the managed empire is you-fill, as on the map');
  assert.equal(model.share.rows[1].fill, empireFill('688'));
  assert.equal(model.paused, false);
  // A-7: a spectator's followed empire keeps its map pastel; only the ink ring (`you`) marks it.
  const spectator = ledgerVM.buildLedger(st, ctxFor({ managedId: null, followedId: '380', perspectiveId: '380' }), rows);
  assert.equal(spectator.share.rows[0].you, true);
  assert.equal(spectator.share.rows[0].fill, empireFill('380'));
  assert.equal(spectator.youLabel, 'Following');
  // HEAD Sidebar: " · Paused" while paused, a signing pending or a tactical choice pending.
  assert.equal(ledgerVM.sessionLine({ ...st, paused: true }), '2 games remaining · ~1 min · Paused');
  assert.equal(ledgerVM.sessionLine({ ...st, choice: { winnerId: '380' } }), '2 games remaining · ~1 min · Paused');
  assert.equal(ledgerVM.buildLedger({ ...st, tacticalChoice: { aId: '688', dId: '380' } }, ctxFor(), rows).paused, true);
  assert.equal(ledgerVM.FEED_CAP, SHARED_FEED_CAP, 'FEED_CAP is the frozen shared constant');
  const loading = ledgerVM.buildLedger({ phase: 'loading', teams: {}, aliveIds: [], stats: {}, fallen: [], history: [] }, { cache: new Map() }, []);
  assert.deepEqual(loading.rows, []);
  assert.equal(loading.session, null);
  assert.doesNotThrow(() => ledgerVM.buildLedger({}, {}, undefined));
  assert.doesNotThrow(() => ledgerVM.buildChronicle({}, {}));
  assert.equal(ledgerVM.buildMatchPreview({}, {}), null);
});

test('buildChronicle sorts the team filter, caps the newest-first feed and pulls turning points', () => {
  const st = baseState();
  st.log = Array.from({ length: 120 }, (_, i) => ({ t: 'match', r: Math.floor(i / 4), txt: `Entry ${i}` }));
  const model = ledgerVM.buildChronicle(st, ctxFor());
  assert.deepEqual(model.historyTeams.map(t => t.name), ['Austria', 'Germany', 'Italy', 'Serbia']);
  assert.equal(model.historyTeams.find(t => t.name === 'Austria').alive, false);
  assert.equal(model.feed.length, ledgerVM.FEED_CAP);
  assert.equal(model.feed[0].text, 'Entry 119');
  assert.equal(model.feed[0].round, 'R29');
  assert.equal(model.feed[0].roman, 'XXIX');
  assert.deepEqual(model.turning.map(t => t.label), ['Biggest upset', 'Decisive match', 'Transfer impact']);
  assert.deepEqual(model.header.stats.map(s => s.value), ['2', '1', '1']);
  assert.equal(model.header.kicker, 'The European Campaign · seed 2026');
  const row = ledgerVM.historyRow(history[1], { managedId: '380' });
  assert.equal(row.title, 'Serbia beat Italy');
  assert.equal(row.roman, 'II');
  assert.equal(row.tie, '4–3 on penalties');
  assert.equal(row.mine, true);
  assert.equal(row.upset, true);
});

test('turning points survive partial history entries and skip "No … recorded" placeholders', () => {
  const partial = [{ id: 'p1', round: '001', a: { name: 'A', score: 1 }, b: { name: 'B', score: 0 },
    result: { winnerName: 'A', loserName: 'B', player: { name: 'Someone' } } }];
  const model = ledgerVM.buildChronicle({ history: partial, teams: {}, aliveIds: [], log: [] }, { cache: new Map() });
  assert.deepEqual(model.turning.map(t => t.label), ['Decisive match', 'Transfer impact']);
  assert.match(model.turning[1].text, /^Someone: \+0\.0 strength/);
});

test('buildMatchPreview frames the pending tactical gate from the manager side', () => {
  const st = baseState();
  const options = tacticalOptions(teams['380'], teams['688'], 6).map(option => ({ ...option, winProbability: .6 }));
  st.tacticalChoice = { aId: '688', dId: '380', route: { routeKind: 'land', isNeighbor: true }, managerName: 'Italy', opponentName: 'Serbia', options };
  const ctx = ctxFor();
  const preview = ledgerVM.buildMatchPreview(st, ctx);
  assert.equal(preview.a.name, 'Serbia');
  assert.equal(preview.a.role, 'Attack');
  assert.equal(preview.b.role, 'Defend');
  assert.equal(preview.b.you, true);
  assert.equal(preview.a.lineup.length, 11);
  assert.equal(preview.route, 'Across a land border');
  assert.match(preview.odds.aLabel, /^SRB \d+%$/);
  assert.match(preview.odds.bLabel, /^\d+% ITA$/);
  // Board 07 copy: first three territory names (homeland first) and an ellipsis.
  assert.equal(preview.stakes.win, 'Annex 4 territories — Serbia, Montenegro, N. Macedonia… — and claim one player');
  assert.equal(preview.stakes.lose, 'Italy falls. Your campaign ends.');
  assert.equal(preview.lineupLabel, 'Starting XI');
  assert.equal(preview.lineupShort, 'XI');
  // Board 07 tale of the tape: positional profile + lineup rating on the fixed (v − 55) / 40 scale.
  assert.deepEqual(preview.tape.map(r => r.label), ['Attack', 'Defence', 'Goalkeeping', 'Starting XI']);
  const xi = preview.tape.at(-1);
  assert.equal(xi.a, preview.a.xi);
  assert.equal(xi.aPct, ledgerVM.tapeWidth(Number(preview.a.xi)));
  assert.ok(xi.aPct < 100 && xi.bPct < 100, 'the leader is not pinned to a full bar');
  assert.equal(xi.lead, 'b');
  assert.equal(ledgerVM.tapeWidth(75), 50);
  assert.equal(ledgerVM.tapeWidth(50), 4);
  assert.equal(ledgerVM.tapeWidth(99), 100);
  assert.equal(ledgerVM.buildMatchPreview(st, ctx), preview, 'memoised on the choice/teams/own identities');
  // Without the managed side in the fixture there are no stakes.
  assert.equal(ledgerVM.buildMatchPreview(st, ctxFor({ managedId: '276', cache: new Map() })).stakes, null);
  // Single-territory empire: no ellipsis, singular noun.
  const small = { ...st, own: { ...st.own, '499': '380', '807': '380', '070': '380' } };
  assert.equal(ledgerVM.buildMatchPreview(small, ctxFor()).stakes.win, 'Annex 1 territory — Serbia — and claim one player');
  // Best-of-three final: a game decides the series only for a side that already has a win (as the target card does).
  const final = { ...st, aliveIds: ['380', '688'], settings: { ...st.settings, finale: 'best-of-three' } };
  const at = wins => ledgerVM.buildMatchPreview({ ...final, series: { teamIds: ['688', '380'], wins, games: 1 } }, ctxFor({ cache: new Map() })).stakes;
  assert.deepEqual(at({ 380: 0, 688: 0 }), { win: 'Italy moves one game closer to total conquest',
    lose: 'Serbia moves one game closer to total conquest' });
  assert.deepEqual(at({ 380: 1, 688: 0 }), { win: 'Annex 4 territories — Serbia, Montenegro, N. Macedonia… — and claim one player',
    lose: 'Serbia moves one game closer to total conquest' });
  assert.deepEqual(at({ 380: 1, 688: 1 }), { win: 'Annex 4 territories — Serbia, Montenegro, N. Macedonia… — and claim one player',
    lose: 'Italy falls. Your campaign ends.' });
});

test('buildMatchPreview reads "Starting five" and the basketball profile for basketball', () => {
  const basketball = getSport('basketball');
  const bteam = (id, name, code, rating) => ({ id, name, code, flagId: id, kind: 'nation', col: '#888', sport: 'basketball',
    squad: basketball.positionPlan.map((pos, index) => ({ name: `${code} Player ${index}`, pos, rating })) });
  const st = baseState();
  st.teams = { '380': bteam('380', 'Italy', 'ITA', 84), '688': bteam('688', 'Serbia', 'SRB', 86) };
  st.settings = { ...st.settings, sport: 'basketball' };
  st.tacticalChoice = { aId: '688', dId: '380', route: { isNeighbor: true }, managerName: 'Italy', opponentName: 'Serbia',
    options: tacticalOptions(st.teams['380'], st.teams['688'], 6) };
  const preview = ledgerVM.buildMatchPreview(st, ctxFor({ sport: basketball }));
  assert.equal(preview.lineupLabel, 'Starting five');
  assert.equal(preview.lineupShort, 'Five');
  assert.equal(preview.a.lineup.length, 5);
  assert.deepEqual(preview.tape.map(r => r.label), ['Offence', 'Defence', 'Starting five']);
  // The sport also comes from settings when ctx carries none.
  assert.equal(ledgerVM.buildMatchPreview(st, { managedId: '380', cache: new Map() }).lineupLabel, 'Starting five');
  assert.deepEqual(ledgerVM.lineupCopy('football'), { label: 'Starting XI', short: 'XI' });
});

test('buildMatchPreview reads the land border from the board when the gate carries no route (blitz / chaos)', () => {
  const st = baseState();
  const options = tacticalOptions(teams['380'], teams['688'], 6);
  // Blitz and chaos call startMatch(a, d) without a route, so the gate stores `route: {}`.
  st.tacticalChoice = { aId: '688', dId: '380', route: {}, managerName: 'Italy', opponentName: 'Serbia', options };
  // Italy (380) and Serbia's holdings share no edge here; Serbia (688) borders Montenegro (499), its own.
  const island = { '380': [], '688': ['499'], '499': ['688'], '807': [], '070': [], '276': ['040'], '040': ['276'] };
  const board = { geo: { adj: island }, own: st.own, aliveIds: st.aliveIds };
  assert.equal(ledgerVM.buildMatchPreview(st, ctxFor({ board })).route, 'By sea — no shared border',
    'a distant blitz pairing reads as the Next fixture block does');
  const bordering = { ...island, '380': ['070'], '070': ['380'] };
  assert.equal(ledgerVM.buildMatchPreview(st, ctxFor({ board: { ...board, geo: { adj: bordering } } })).route, 'Across a land border');
  // A draw's own isNeighbor / routeKind still wins over the board.
  const drawn = { ...st, tacticalChoice: { ...st.tacticalChoice, route: { routeKind: 'neutral-transit', isNeighbor: false } } };
  assert.equal(ledgerVM.buildMatchPreview(drawn, ctxFor({ board })).route, 'Through neutral land — transit treaty');
  // The memo follows the atlas: a cached preview built before the board loaded is not reused once it has.
  const cache = new Map();
  assert.equal(ledgerVM.buildMatchPreview(st, ctxFor({ cache })).route, 'Across a land border', 'no board: the copy default');
  assert.equal(ledgerVM.buildMatchPreview(st, ctxFor({ cache, board })).route, 'By sea — no shared border');
});

test('one upset definition: the Chronicle count, tags and "Biggest upset" all read result.upset', () => {
  const underdog = { id: 'u1', round: '003', aId: '040', bId: '276', dId: '276', winnerId: '040', winnerName: 'Austria', upsetGap: 5,
    a: { teamId: '040', id: '040', code: 'AUT', name: 'Austria', score: 1, eff: '80.0' }, b: { teamId: '276', id: '276', code: 'GER', name: 'Germany', score: 0, eff: '85.0' },
    result: { winnerId: '040', loserId: '276', winnerName: 'Austria', loserName: 'Germany', upset: false } };
  // Below CONFIG.upsetThreshold: an underdog win, not an upset — no count, no tag and no "Biggest upset" line.
  const plain = ledgerVM.buildChronicle({ ...baseState(), history: [history[0], underdog] }, ctxFor());
  assert.equal(plain.header.stats.find(s => s.key === 'upsets').value, '0');
  assert.deepEqual(plain.turning.map(t => t.label), ['Decisive match', 'Transfer impact']);
  assert.equal(ledgerVM.biggestUpsetLine([history[0], underdog]), null);
  // Flagged upsets: the widest overturned gap wins, read back from the sides' eff when upsetGap is missing.
  const flagged = { ...underdog, id: 'u2', upsetGap: undefined, result: { ...underdog.result, upset: true } };
  assert.equal(ledgerVM.biggestUpsetLine([flagged]), 'Austria overturned a 5.0-point strength gap');
  assert.equal(ledgerVM.biggestUpsetLine([history[1], flagged, underdog]), 'Serbia overturned a 6.0-point strength gap');
  const counted = ledgerVM.buildChronicle({ ...baseState(), history: [...history, flagged] }, ctxFor());
  assert.equal(counted.header.stats.find(s => s.key === 'upsets').value, '2');
  assert.equal(counted.turning.find(t => t.key === 'biggestUpset').text, 'Serbia overturned a 6.0-point strength gap');
});

// ---------- Ledger screen ----------
test('ledger renders exactly one complete standings table with the smoke contract', async context => {
  const rows = Array.from({ length: 120 }, (_, i) => powerRow(i, i === 4 ? { you: true } : {}));
  const fallen = [{ key: 'f1', teamId: 'x1', flagId: null, isClub: true, code: 'X1', name: 'Fallen One', roman: 'III', byName: 'Team 0', line: 'Round III · to Team 0' }];
  const selected = [];
  const view = await mount(LedgerScreen, { rows, fallen, session: 'Up to 20 games remaining · ~6 min', header: { kicker: 'K', title: 'Ledger', stats: [] },
    youId: 't4', youLabel: 'You', selectedTeamId: 't7', onSelectTeam: id => selected.push(id) }, context);
  const panel = view.host.querySelector('#view-panel-ledger');
  assert.ok(panel.classList.contains('screen') && panel.classList.contains('screen--ledger'));
  assert.equal(panel.getAttribute('aria-labelledby'), 'view-tab-ledger');
  assert.equal(view.host.querySelectorAll('table.fi-standings').length, 1);
  const headers = [...view.host.querySelectorAll('.fi-standings thead th')].map(th => th.textContent.trim());
  assert.deepEqual(headers.slice(0, 4), ['#', 'Team', 'Terr.', 'Strength']);
  assert.equal(view.host.querySelector('.fi-standings th[aria-sort="descending"]').textContent.trim(), 'Strength');
  const trs = [...view.host.querySelectorAll('.fi-standings tbody tr')];
  assert.equal(trs.length, 120, 'every alive team, no truncation');
  trs.forEach((tr, i) => {
    assert.equal(tr.cells[0].textContent.trim(), String(i + 1));
    assert.equal(tr.cells[1].querySelector('.fi-standing-team > span[title]').textContent.trim(), `Team ${i}`);
    assert.equal(tr.cells[3].querySelector('.fi-standing-eff').textContent.trim(), rows[i].eff);
    const badge = tr.cells[3].querySelector('[data-testid="standing-strength-gain"]');
    if (rows[i].effGain.text.startsWith('+')) {
      assert.ok(badge?.classList.contains('fi-strength-gain'));
      assert.equal(badge.textContent.trim(), rows[i].effGain.text);
    } else assert.equal(badge, null);
  });
  assert.equal(trs[105].cells[0].textContent.trim(), '106', 'ranks continue past 99');
  assert.equal(trs[7].querySelector('.fi-standing-team').getAttribute('aria-current'), 'true');
  assert.ok(trs[4].classList.contains('is-you'));
  assert.equal(view.host.querySelector('[data-team-id="t2"]').getAttribute('aria-label'), 'View Team 2 squad');
  await act(async () => view.host.querySelector('[data-team-id="t9"]').click());
  assert.deepEqual(selected, ['t9']);
  // Fallen list: own classes, never .fi-standings; selecting a fallen empire opens its squad too.
  assert.equal(view.host.querySelector('.ledger-fallen .fi-standings'), null);
  assert.match(view.host.querySelector('.ledger-fallen').textContent, /Fallen One.*Round III · to Team 0/);
  const fallenButton = view.host.querySelector('.ledger-fallen [data-team-id="x1"]');
  assert.equal(fallenButton.hasAttribute('aria-label'), false, 'the visible name and "Round III · to Team 0" form the name');
  assert.equal(fallenButton.querySelector('.ledger-fallen__mark').getAttribute('aria-hidden'), 'true');
  await act(async () => fallenButton.click());
  assert.deepEqual(selected, ['t9', 'x1']);
  const session = view.host.querySelector('[data-testid="session-remaining"]');
  assert.match(session.textContent, /Up to 20 games/);
  assert.equal(session.getAttribute('role'), 'status');
  assertConsoleClean();
});

test('ledger renders the built model and an empty fallen list', async context => {
  const st = baseState();
  st.fallen = [];
  const rows = [{ tid: '380', rank: 1, name: 'Italy', code: 'ITA', flagId: '380', isClub: false, color: '#888', territories: '2', eff: '86.0', effGain: { text: '+1.5' } }];
  const view = await mount(LedgerScreen, { ...ledgerVM.buildLedger(st, ctxFor(), rows), selectedTeamId: null, onSelectTeam() {} }, context);
  assert.equal(view.host.querySelector('#ledger-title').textContent, 'Ledger');
  assert.match(view.host.querySelector('.ledger-fallen').textContent, /No empire has fallen yet/);
  assert.match(view.host.querySelector('.ledger-share').textContent, /Share of the map/);
  assert.equal(view.host.querySelector('.fi-standing-you').textContent, 'You');
  assertConsoleClean();
});

// ---------- Chronicle screen (ported Sidebar History tests) ----------
const fixtures = [
  { id: 'm1', round: 1, aId: 'a', bId: 'b', a: { teamId: 'a', name: 'Alfa', code: 'ALF', score: 2 }, b: { teamId: 'b', name: 'Beta', code: 'BET', score: 1 } },
  { id: 'm2', round: 2, aId: 'c', bId: 'd', a: { teamId: 'c', name: 'Gamma', code: 'GAM', score: 0 }, b: { teamId: 'd', name: 'Delta', code: 'DEL', score: 1 } },
  { id: 'm3', round: 3, aId: 'a', bId: 'e', a: { teamId: 'a', name: 'Alfa', code: 'ALF', score: 3 }, b: { teamId: 'e', name: 'Echo', code: 'ECH', score: 1 } },
];
const filterTeams = [{ id: 'a', name: 'Alfa' }, { id: 'c', name: 'Gamma' }, { id: 'z', name: 'Zulu' }];
async function chooseFilter(view, value) {
  await act(async () => {
    const select = view.host.querySelector('#history-team');
    select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
}

test('history filters archived fixtures by team and selecting a result retains its identifier (uncontrolled)', async context => {
  const selected = [];
  const view = await mount(ChronicleScreen, { history: fixtures.slice(0, 2), historyTeams: [{ id: 'a', name: 'Alfa' }], onHistorySelect: id => selected.push(id) }, context);
  const panel = view.host.querySelector('#view-panel-chronicle');
  assert.ok(panel.classList.contains('screen--chronicle'));
  assert.equal(panel.getAttribute('aria-labelledby'), 'view-tab-chronicle');
  await chooseFilter(view, 'a');
  assert.equal(view.host.querySelectorAll('.fi-history-list button').length, 1);
  await act(async () => view.host.querySelector('.fi-history-list button').click());
  assert.deepEqual(selected, ['m1', 'm1'], 'Changing the filter selects its newest report before the explicit click');
  assertConsoleClean();
});

test('filter changes replace unrelated history reports and clear empty selections', async context => {
  const selected = [];
  function Details() {
    const [id, setId] = useState('m2');
    const [filter, setFilter] = useState('');
    return React.createElement(ChronicleScreen, {
      history: fixtures, historyTeams: filterTeams,
      selectedHistory: fixtures.find(entry => entry.id === id), historyFilter: filter, onHistoryFilter: setFilter,
      onHistorySelect: next => { selected.push(next); setId(next); },
    });
  }
  const view = await mount(Details, {}, context);
  assert.match(view.host.querySelector('.fi-history .fi-match').textContent, /Gamma/);
  assert.equal(view.host.querySelector('.fi-history-list [aria-pressed="true"]').dataset.historyId, 'm2');
  await chooseFilter(view, 'a');
  assert.equal(selected.at(-1), 'm3');
  assert.equal(view.host.querySelector('.fi-history-list [aria-pressed="true"]').dataset.historyId, 'm3');
  assert.match(view.host.querySelector('.fi-history .fi-match').textContent, /Echo/);
  assert.doesNotMatch(view.host.querySelector('.fi-history .fi-match').textContent, /Gamma/);
  await chooseFilter(view, 'z');
  assert.equal(selected.at(-1), null);
  assert.equal(view.host.querySelector('.fi-history .fi-match'), null);
  assert.match(view.host.querySelector('.fi-history').textContent, /No matches for this team yet\./);
  assertConsoleClean();
});

test('history filter and selection survive leaving the Chronicle and coming back; report squad links select the team', async context => {
  const opened = [];
  let setVisible;
  function App() {
    const [visible, show] = useState(true);
    setVisible = show;
    const [id, setId] = useState('m3');
    const [filter, setFilter] = useState('');
    return visible ? React.createElement(ChronicleScreen, {
      history: fixtures, historyTeams: filterTeams, selectedHistory: fixtures.find(entry => entry.id === id),
      historyFilter: filter, onHistoryFilter: setFilter, onHistorySelect: setId, onSelectTeam: tid => opened.push(tid),
    }) : React.createElement('p', null, 'Squad');
  }
  const view = await mount(App, {}, context);
  await chooseFilter(view, 'a');
  await act(async () => view.host.querySelector('[data-history-id="m1"]').click());
  await act(async () => view.host.querySelector('.fi-history [aria-label="View Alfa squad"]').click());
  assert.deepEqual(opened, ['a']);
  await act(async () => setVisible(false));
  await act(async () => setVisible(true));
  assert.equal(view.host.querySelector('#history-team').value, 'a');
  assert.equal(view.host.querySelector('.fi-history-list [aria-pressed="true"]').dataset.historyId, 'm1');
  assertConsoleClean();
});

// (W3, WP-INT) Ported from further-ui "local history state also persists when a caller omits controlled filter props":
// the Sidebar kept it across its own tab switches; ChronicleScreen keeps it across re-renders from its parent.
test('local filter and selection persist when a caller omits the controlled props', async context => {
  const view = await mount(ChronicleScreen, { history: fixtures, historyTeams: filterTeams }, context);
  await chooseFilter(view, 'a');
  await act(async () => view.host.querySelector('[data-history-id="m1"]').click());
  // A later match lands and the parent re-renders with a longer history, still without filter/selection props.
  const m4 = { id: 'm4', round: 4, aId: 'c', bId: 'a', a: { teamId: 'c', name: 'Gamma', code: 'GAM', score: 1 }, b: { teamId: 'a', name: 'Alfa', code: 'ALF', score: 2 } };
  await view.render({ history: [...fixtures, m4], historyTeams: filterTeams });
  assert.equal(view.host.querySelector('#history-team').value, 'a');
  assert.equal(view.host.querySelector('.fi-history-list [aria-pressed="true"]').dataset.historyId, 'm1');
  assert.deepEqual([...view.host.querySelectorAll('.fi-history-list button')].map(button => button.dataset.historyId).sort(), ['m1', 'm3', 'm4']);
  assertConsoleClean();
});

test('chronicle shows roman rounds, tags, turning points and a grouped activity feed', async context => {
  const st = baseState();
  const model = ledgerVM.buildChronicle(st, ctxFor());
  const view = await mount(ChronicleScreen, { ...model, selectedHistory: null, historyFilter: '' }, context);
  assert.equal(view.host.querySelector('#chronicle-title').textContent, 'Chronicle');
  const items = [...view.host.querySelectorAll('.fi-history-list button')];
  assert.deepEqual(items.map(button => button.dataset.historyId), ['m2', 'm1'], 'newest first');
  assert.match(items[0].textContent, /II.*Serbia beat Italy.*SRB 1–1 ITA \(4–3 on penalties\).*Your match.*Upset/);
  assert.match(items[1].textContent, /Germany beat Austria.*claims AUT Player 3/);
  assert.equal(items[0].getAttribute('aria-pressed'), 'true', 'newest report shown by default');
  assert.deepEqual([...view.host.querySelectorAll('.fi-activity-round')].map(h => h.textContent),
    ['Round II', 'Round I', 'Before the first match']);
  assert.equal(view.host.querySelector('.fi-activity-item').dataset.kind, 'upset');
  assert.match(view.host.querySelector('.chronicle-turning').textContent, /Biggest upset/);
  assert.equal(view.host.querySelector('.fi-history__report .kicker__title').textContent, 'Result',
    'the column kicker does not repeat the MatchCard "Match report" disclosure');
  assert.equal(view.host.querySelector('.fi-history__report .fi-match-heading h2').textContent, 'Round II',
    'the archived card names its round in roman numerals, like the list and the masthead');
  const empty = await mount(ChronicleScreen, { history: [], historyTeams: [], feed: [] }, context);
  assert.match(empty.host.querySelector('.fi-history').textContent, /Completed matches will be saved here/);
  assert.match(empty.host.querySelector('.fi-activity').textContent, /Match results and player transfers will appear here/);
  assert.equal(empty.host.querySelector('.fi-history-kinds'), null, 'no chips before the first match');
  assertConsoleClean();
});

test('board 06 chips filter by your matches, upsets and signings on top of the team filter', async context => {
  const model = ledgerVM.buildChronicle(baseState(), ctxFor());
  const view = await mount(ChronicleScreen, model, context);
  const chips = () => [...view.host.querySelectorAll('.fi-history-kinds button')];
  const listed = () => [...view.host.querySelectorAll('.fi-history-list button')].map(button => button.dataset.historyId);
  const chip = label => act(async () => chips().find(button => button.textContent === label).click());
  assert.equal(view.host.querySelector('.fi-history-kinds').getAttribute('role'), 'group');
  assert.deepEqual(chips().map(button => button.textContent), ['All matches', 'Your matches', 'Upsets', 'Signings']);
  assert.deepEqual(chips().map(button => button.getAttribute('aria-pressed')), ['true', 'false', 'false', 'false']);
  await chip('Upsets');
  assert.deepEqual(listed(), ['m2']);
  assert.equal(view.host.querySelector('.fi-history-list [aria-pressed="true"]').dataset.historyId, 'm2');
  await chip('Signings');
  assert.deepEqual(listed(), ['m1']);
  assert.equal(view.host.querySelector('.fi-history-list [aria-pressed="true"]').dataset.historyId, 'm1', 'the report follows the visible list');
  assert.match(view.host.querySelector('.fi-history .fi-match').textContent, /Germany/);
  await chip('Your matches');
  assert.deepEqual(listed(), ['m2']);
  assert.equal(chips()[1].getAttribute('aria-pressed'), 'true');
  await chooseFilter(view, '276');
  assert.deepEqual(listed(), []);
  assert.match(view.host.querySelector('.fi-history').textContent, /No matches for your team yet\./);
  await chip('All matches');
  assert.deepEqual(listed(), ['m1']);
  assert.ok(view.host.querySelector('select#history-team'), 'the team select stays the tested contract');
  const spectator = await mount(ChronicleScreen, ledgerVM.buildChronicle(baseState(), ctxFor({ managedId: null, perspectiveId: null })), context);
  assert.deepEqual([...spectator.host.querySelectorAll('.fi-history-kinds button')].map(b => b.textContent), ['All matches', 'Upsets', 'Signings']);
  const following = await mount(ChronicleScreen, ledgerVM.buildChronicle(baseState(), ctxFor({ managedId: null, followedId: '688', perspectiveId: '688' })), context);
  assert.ok([...following.host.querySelectorAll('.fi-history-kinds button')].some(b => b.textContent === 'Followed team'));
  assertConsoleClean();
});

test('screens tolerate the W1 stub models (feed without key/roman/kind, ledger { rows }) with a clean console', async context => {
  const st = baseState();
  // src/app/ledgerMethods.jsx W1 stub mapping (before the wiring pass), minus `key` and `roman`.
  const feed = st.log.slice().reverse().map(f => ({ round: 'R' + f.r, chip: f.chip || '#999', color: f.col || '#555', text: f.txt }));
  const historyTeams = Object.values(st.teams).map(team => ({ id: team.id, name: team.name, alive: st.aliveIds.includes(team.id) }));
  const view = await mount(ChronicleScreen, { history: st.history, historyTeams, feed, selectedHistory: undefined, historyFilter: '' }, context);
  assert.deepEqual([...view.host.querySelectorAll('.fi-activity-round')].map(h => h.textContent), ['Round II', 'Round I', 'Before the first match']);
  assert.equal(view.host.querySelectorAll('.fi-activity-item').length, 4);
  assert.equal(view.host.querySelector('.fi-activity-item').hasAttribute('data-kind'), false);
  assertConsoleClean();
  const rows = [{ tid: '380', rank: 1, name: 'Italy', code: 'ITA', flagId: '380', isClub: false, color: '#888', territories: '2', eff: '86.0', effGain: { text: '+1.5' } }];
  const ledger = await mount(LedgerScreen, { rows, selectedTeamId: null, onSelectTeam() {} }, context);
  assert.equal(ledger.host.querySelectorAll('.fi-standings tbody tr').length, 1);
  assert.equal(ledger.host.querySelector('.ledger-fallen'), null, 'no false "No empire has fallen yet" without the built model');
  assert.equal(ledger.host.querySelector('.kicker__aside').textContent, '1 empire');
  assertConsoleClean();
});

// ---------- Match preview dialog ----------
test('match preview keeps the tactical contract, adds the board-07 preview and closes with Escape', async context => {
  const st = baseState();
  // Italy without a goalkeeper (a defender plays GK out of position) and a forward claimed from Austria in round XII.
  const italy = { ...teams['380'], squad: teams['380'].squad.map((player, i) => i === 0 ? { ...player, pos: 'DF' }
    : i === 9 ? { ...player, name: 'Claimed Forward', rating: 90, from: 'AUT', fromId: '040', joined: 12 } : player) };
  st.teams = { ...teams, '380': italy };
  const options = tacticalOptions(italy, teams['688'], 6).map((option, i) => ({ ...option, winProbability: [.42, .48, .51][i] }));
  st.tacticalChoice = { aId: '688', dId: '380', route: { routeKind: 'sea', isNeighbor: false }, managerName: 'Italy', opponentName: 'Serbia', options };
  const preview = ledgerVM.buildMatchPreview(st, ctxFor());
  const claimedRow = preview.b.lineup.find(row => row.claimed);
  assert.deepEqual({ ...claimedRow.claimed, color: undefined }, { code: 'AUT', roman: 'R XII', label: 'AUT · R XII', flagId: '040', isClub: false, color: undefined });
  assert.ok(preview.b.lineup.some(row => row.outOfPosition));
  const chosen = [], closed = [], simulated = [];
  const view = await mount(TacticalChoice, { choice: st.tacticalChoice, preview, onChoose: id => chosen.push(id),
    onClose: () => closed.push(true), onSimulate: () => simulated.push(true) }, context);
  const dialog = view.host.querySelector('[role="dialog"]');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.equal(document.activeElement.dataset.tactic, 'balanced', 'initial focus on the default approach');
  assert.match(view.host.textContent, /Matchday variation 11\.0/);
  assert.match(view.host.textContent, /Scoring luck remains/);
  assert.match(view.host.querySelector('.fi-tactical-fixture').textContent, /Attack.*Serbia.*By sea — no shared border.*Defend · You.*Italy/);
  assert.match(view.host.querySelector('.fi-tactical-stakes').textContent, /If you win.*If you lose.*Italy falls/);
  assert.equal(view.host.querySelectorAll('.fi-tactical-xi').length, 2);
  assert.equal(view.host.querySelectorAll('.fi-tactical-xi__row').length, 22);
  assert.equal(view.host.querySelectorAll('[data-tactic]').length, 3);
  assert.ok(view.host.querySelector('[data-tactic="balanced"]').classList.contains('is-default'));
  assert.match(view.host.querySelector('[data-tactic="attack"]').textContent, /42%/);
  // DEC D5: win chance coloured by the displayed integer.
  assert.equal(view.host.querySelector('[data-tactic="attack"] .fi-tactical-option__chance b').className, 'tone-loss');
  assert.equal(view.host.querySelector('[data-tactic="balanced"] .fi-tactical-option__chance b').className, 'tone-even');
  assert.match(view.host.querySelector('.fi-tactical-stakes').textContent, /Annex 4 territories — Serbia, Montenegro, N\. Macedonia… — and claim one player/);
  const [xiA, xiB] = view.host.querySelectorAll('.fi-tactical-xi');
  assert.equal(xiA.querySelector('.kicker__title').textContent, 'SRB · Starting XI');
  assert.match(xiB.querySelector('.kicker__aside').textContent, /^XI \d+\.\d$/);
  const claimed = xiB.querySelector('.fi-tactical-xi__claimed');
  assert.equal(claimed.textContent, 'claimed from AUT · R XII');
  assert.equal(claimed.querySelector('img.flag-chip').getAttribute('width'), '16');
  assert.equal(claimed.querySelector('img.flag-chip').getAttribute('height'), '12');
  assert.equal(xiB.querySelectorAll('.fi-tactical-xi__oop').length, 1);
  assert.match(xiB.querySelector('.fi-tactical-xi__oop').textContent, /↓/);
  assert.deepEqual([...view.host.querySelectorAll('.fi-tactical-tape__label')].map(n => n.textContent), ['Attack', 'Defence', 'Goalkeeping', 'Starting XI']);
  assert.ok(view.host.querySelector('.dialog-backdrop.fi-tactical-backdrop > .dialog.fi-tactical'), 'the dialog primitives are on the roots');
  // Board 07 order: the tale of the tape leads the centre column (level with both XI headers), the approach follows.
  assert.deepEqual([...view.host.querySelector('.fi-tactical-main').children].map(n => n.className), ['fi-tactical-tape', 'fi-tactical-approach']);
  // The closing line is the panel's sticky footer (a direct child after the body), so "simulate the result" stays in view.
  const foot = dialog.querySelector(':scope > .fi-tactical-foot');
  assert.ok(foot?.previousElementSibling.classList.contains('fi-tactical-body'), 'the footer follows the body');
  assert.ok([...foot.querySelectorAll('button')].some(b => b.textContent === 'simulate the result'));
  assert.equal(view.host.querySelector('.fi-tactical-main .fi-tactical-foot'), null);
  // The fixture header names both sides and the footer says how to kick off: the standfirst keeps the strength context.
  assert.equal(view.host.querySelector('#tactical-description').textContent, options[0].context);
  await act(async () => [...view.host.querySelectorAll('button')].find(b => b.textContent === 'simulate the result').click());
  assert.deepEqual(simulated, [true]);
  await act(async () => view.host.querySelector('[data-tactic="defend"]').click());
  assert.deepEqual(chosen, ['defend']);
  await key(document, 'Escape');
  assert.deepEqual(closed, [true]);
  await act(async () => view.host.querySelector('[aria-label="Close match preview"]').click());
  assert.deepEqual(closed, [true, true]);
  await view.close();
  assert.equal(document.activeElement.id, 'prior', 'focus restored');
  assertConsoleClean();
});

test('match preview without a preview model or close handler still renders the approach choice', async context => {
  const choice = { managerName: 'Alfa', opponentName: 'Beta', options: tacticalOptions(team('a', 'Alfa', 'ALF', 75), team('b', 'Beta', 'BET', 85), 6) };
  const chosen = [];
  const view = await mount(TacticalChoice, { choice, onChoose: id => chosen.push(id) }, context);
  assert.match(view.host.textContent, /You are the underdog/);
  assert.equal(view.host.querySelector('[aria-label="Close match preview"]'), null);
  assert.equal(view.host.querySelector('.fi-tactical-fixture'), null);
  assert.match(view.host.querySelector('.fi-tactical-headline').textContent, /Alfa v Beta/);
  await key(document, 'Escape');
  await act(async () => view.host.querySelector('[data-tactic="attack"]').click());
  assert.deepEqual(chosen, ['attack']);
  assertConsoleClean();
});

test('match preview: reserve support is a tag on the option name row, never an extra line', async context => {
  const choice = { managerName: 'Alfa', opponentName: 'Beta', options: tacticalOptions(team('a', 'Alfa', 'ALF', 75), team('b', 'Beta', 'BET', 85), 6)
    .map(option => option.id === 'balanced' ? option : { ...option, support: option.id === 'attack' ? .45 : 1.02 }) };
  const view = await mount(TacticalChoice, { choice, onChoose() {} }, context);
  const tag = view.host.querySelector('[data-tactic="attack"] .fi-tactical-option__name > .fi-tactical-option__support');
  assert.equal(tag.textContent, 'Reserve support +0.45');
  assert.equal(tag.getAttribute('title'), 'Reserve support contributes +0.45 to this approach.');
  assert.equal(view.host.querySelector('[data-tactic="defend"] .fi-tactical-option__name > .fi-tactical-option__support').textContent, 'Reserve support +1.02');
  assert.equal(view.host.querySelector('[data-tactic="balanced"] .fi-tactical-option__support'), null);
  assert.equal(view.host.querySelectorAll('.fi-tactical-option__body > .fi-tactical-option__support').length, 0);
  // Without the preview model the standfirst keeps the full sentence, and the footer still closes the panel.
  assert.equal(view.host.querySelector('#tactical-description').textContent,
    'Alfa faces Beta. You are the underdog. Commit an approach to start the match.');
  assert.equal(view.host.querySelector('.dialog.fi-tactical > .fi-tactical-foot').textContent, 'Pick an approach to kick off and watch it live.');
  assertConsoleClean();
});

test('basketball match preview reads "Starting five" over five rows', async context => {
  const basketball = getSport('basketball');
  const bteam = (id, name, code, rating) => ({ id, name, code, flagId: id, kind: 'nation', col: '#888', sport: 'basketball',
    squad: basketball.positionPlan.map((pos, index) => ({ name: `${code} Player ${index}`, pos, rating })) });
  const st = baseState();
  st.teams = { '380': bteam('380', 'Italy', 'ITA', 84), '688': bteam('688', 'Serbia', 'SRB', 86) };
  st.settings = { ...st.settings, sport: 'basketball' };
  st.tacticalChoice = { aId: '688', dId: '380', route: { isNeighbor: true }, managerName: 'Italy', opponentName: 'Serbia',
    options: tacticalOptions(st.teams['380'], st.teams['688'], 6) };
  const preview = ledgerVM.buildMatchPreview(st, ctxFor({ sport: basketball }));
  const view = await mount(TacticalChoice, { choice: st.tacticalChoice, preview, onChoose() {}, onClose() {} }, context);
  const titles = [...view.host.querySelectorAll('.fi-tactical-xi .kicker__title')].map(n => n.textContent);
  assert.deepEqual(titles, ['SRB · Starting five', 'ITA · Starting five']);
  assert.match(view.host.querySelector('.fi-tactical-xi .kicker__aside').textContent, /^Five \d+\.\d$/);
  assert.equal(view.host.querySelectorAll('.fi-tactical-xi__row').length, 10);
  assert.doesNotMatch(view.host.textContent, /Starting XI/);
  assertConsoleClean();
});

// ---------- Victory ----------
test('victory dialog keeps the smoke contract and closes with Escape', async context => {
  const closes = [], news = [];
  const view = await mount(VictoryOverlay, {
    id: '380', code: 'ITA', isClub: false, round: '031', name: 'ITALY', color: '#888', subtitle: 'has conquered Europe in 31 battles',
    conquests: '9', steals: '4', territories: '55', effNow: '88.1', effBase: '84.5', effGain: { text: '+3.6' },
    squad: teams['380'].squad.slice(0, 3), positionColors: football.positionColors, seed: 2026,
    recap: { biggestUpset: 'Serbia overturned a 6.0-point strength gap', decisiveMatch: 'Italy 2–1 Spain', transferImpact: '', 'Elapsed time': '12 min', 'Leader changes': 3 },
    onClose: () => closes.push(true), onNew: () => news.push(true),
  }, context);
  const dialog = document.querySelector('[role="dialog"][aria-labelledby="victory-title"]');
  assert.ok(dialog);
  assert.ok(dialog.textContent.includes('Campaign complete'));
  assert.match(view.host.querySelector('.fi-victory-kicker').textContent, /Round XXXI/);
  assert.equal(document.getElementById('victory-title').textContent, 'ITALY');
  assert.equal(document.activeElement.getAttribute('aria-label'), 'Close campaign results');
  assert.match(dialog.textContent, /Biggest upset.*Serbia overturned/);
  assert.match(dialog.textContent, /Elapsed time.*12 min/);
  assert.doesNotMatch(dialog.textContent, /Transfer impact/, 'empty recap values are skipped');
  // Named regions need a role: ARIA does not name generic elements.
  assert.equal(dialog.querySelector('.fi-victory-recap').getAttribute('role'), 'group');
  assert.equal(dialog.querySelector('.fi-victory-record').getAttribute('role'), 'group');
  assert.equal(dialog.querySelector('.fi-victory-record').getAttribute('aria-label'), 'Campaign record');
  assert.ok(dialog.classList.contains('dialog') && dialog.parentElement.classList.contains('dialog-backdrop'));
  const button = label => [...dialog.querySelectorAll('button')].find(el => el.textContent.trim() === label);
  await act(async () => button('View map').click());
  await act(async () => button('New campaign').click());
  await key(document, 'Escape');
  assert.deepEqual(closes, [true, true]);
  assert.deepEqual(news, [true]);
  assert.equal(dialog.querySelectorAll('.fi-player-row').length, 3);
  await view.close();
  assert.equal(document.activeElement.id, 'prior');
  assertConsoleClean();
});

test('victory squad: on phone/touch the roster source is plain text (no 47×12 link), elsewhere it stays a link', async context => {
  const listeners = new Set();
  const queries = [];
  let matches = true;
  dom.window.matchMedia = media => { queries.push(media); return {
    media, get matches() { return matches; },
    addEventListener: (type, fn) => listeners.add(fn), removeEventListener: (type, fn) => listeners.delete(fn),
  }; };
  context.after(() => { delete dom.window.matchMedia; });
  const sourceInfo = { source: 'ea-fc', edition: '26', url: 'https://sofifa.com/player/1', fullName: 'Gianluigi Donnarumma' };
  const squad = [{ name: 'Donnarumma', pos: 'GK', rating: 88, sourceInfo }, { name: 'Bastoni', pos: 'DF', rating: 86, sourceInfo, from: 'SRB' }];
  const view = await mount(VictoryOverlay, {
    id: '380', code: 'ITA', round: '031', name: 'ITALY', subtitle: 'has conquered Europe', conquests: '9', steals: '1', territories: '55',
    effNow: '88.1', effBase: '84.5', effGain: { text: '+3.6' }, squad, positionColors: football.positionColors, onClose() {}, onNew() {},
  }, context);
  const sources = () => [...view.host.querySelectorAll('.fi-victory .fi-player-source')];
  assert.ok(queries.some(media => /max-width:699\.98px/.test(media) && /pointer:coarse/.test(media)), 'the --tap breakpoints');
  assert.equal(sources().length, 2);
  assert.ok(sources().every(el => el.textContent === 'EA FC 26' && !el.querySelector('a')), 'phone: plain muted text, no tap target');
  assert.equal(squad[0].sourceInfo.url, sourceInfo.url, 'the squad prop is not mutated');
  matches = false;
  await act(async () => listeners.forEach(fn => fn()));
  assert.ok(sources().every(el => el.querySelector('a')?.getAttribute('href') === sourceInfo.url), 'desktop: the source link returns');
  await view.close();
  assert.equal(listeners.size, 0, 'the media listener is removed on unmount');
  assertConsoleClean();
});

// ---------- Dialog contracts ----------
test('SaveControls uses the .save-* namespace and CampaignStorageDialog keeps its function name', async context => {
  const view = await mount(SaveControls, { status: 'Autosave after each match', onExport() {}, onImport() {}, onManageSaves() {} }, context);
  assert.ok(view.host.querySelector('.save-controls'));
  assert.equal(view.host.querySelectorAll('.save-text-button').length, 3);
  assert.equal(view.host.querySelector('.setup-text-button'), null);
  assert.equal(view.host.querySelector('[role=status]').textContent, 'Autosave after each match');
  assert.equal(CampaignStorageDialog.name, 'CampaignStorageDialog');
  const storage = await mount(CampaignStorageDialog, { mode: 'slots', campaigns: [], onClose() {} }, context);
  assert.match(storage.host.querySelector('.campaign-storage-kicker').textContent, /Campaign storage/);
  assert.equal(storage.host.querySelector('#campaign-storage-title').textContent, 'Saved campaigns');
  await storage.close();
  const exported = await mount(ExportCheckpoint, { text: '{}', onDownload() {}, onClose() {} }, context);
  assert.ok(exported.host.querySelector('textarea.fi-export-text'));
  assert.equal(exported.host.querySelector('label[for="campaign-checkpoint-json"]').textContent, 'Campaign checkpoint JSON');
  assertConsoleClean();
});

test('saved campaigns: the fork name defaults to "<current campaign> copy" and the theatre reads its display name', async context => {
  const slot = (id, name, settings) => ({ id, name, round: 14, matches: 14, seed: 2033, aliveIds: ['a', 'b'], settings });
  const campaigns = [
    slot('c1', 'Football · Europe · Italy', { sport: 'football', layer: 'nations', scope: 'UEFA' }),
    slot('c2', 'Clubs', { sport: 'football', layer: 'clubs', clubScope: 'elite' }),
    slot('c3', 'League', { sport: 'football', layer: 'clubs', clubScope: 'Premier League' }),
  ];
  const view = await mount(CampaignStorageDialog, { mode: 'slots', campaigns, activeId: 'c1', onFork() {}, onClose() {} }, context);
  assert.equal(view.host.querySelector('#campaign-fork-name').value, 'Football · Europe · Italy copy', 'never "Imported campaign"');
  const theatres = [...view.host.querySelectorAll('.campaign-storage-preview > div')]
    .filter(row => row.querySelector('dt').textContent === 'Theatre').map(row => row.querySelector('dd').textContent);
  assert.deepEqual(theatres, ['Europe', 'Elite 32', 'Premier League'], 'scope display names, not raw ids such as "UEFA"');
  await view.close();
  const fresh = await mount(CampaignStorageDialog, { mode: 'slots', campaigns: [], onFork() {}, onClose() {} }, context);
  assert.equal(fresh.host.querySelector('#campaign-fork-name').value, 'Campaign copy');
  await fresh.close();
  const imported = await mount(CampaignStorageDialog, { mode: 'import', campaign: { settings: { scope: 'world' } }, onClose() {} }, context);
  assert.equal(imported.host.querySelector('#import-campaign-name').value, 'Imported campaign', 'an unnamed import keeps its default');
  assert.match(imported.host.querySelector('.campaign-storage-preview').textContent, /Theatre.*World War/);
  assertConsoleClean();
});

test('dialog and ledger CSS: the match preview fits the viewport and Fallen is not painted loss red', async () => {
  const { readFileSync } = await import('node:fs');
  const css = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const dialogs = css('src/components/dialogs.css');
  const panel = dialogs.match(/\n\.fi-tactical \{([^}]*)\}/)?.[1] || '';
  assert.match(panel, /max-height:calc\(100dvh - 48px\)/, 'capped to the viewport (24px backdrop margins)');
  assert.match(panel, /overflow:auto/, 'the tall preview scrolls inside the panel, under its sticky top');
  assert.match(dialogs, /\.fi-tactical, \.fi-tactical\.has-preview \{[^}]*max-height:none/, 'phone: full-screen sheet');
  const foot = dialogs.match(/\n\.fi-tactical-foot \{([^}]*)\}/)?.[1] || '';
  assert.match(foot, /position:sticky; bottom:0/, 'the "simulate the result" line is a sticky footer');
  assert.match(foot, /background:#fff/, 'the footer is opaque over the scrolled content');
  // RC2: the whole preview fits 1440×900 and 1366×768 without scrolling — stepped rhythm by viewport height.
  assert.match(dialogs, /@media \(min-width:700px\) and \(max-height:979\.98px\) \{[^@]*\.fi-tactical-v \{ display:none; \}/);
  const short = dialogs.match(/@media \(min-width:700px\) and \(max-height:879\.98px\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(short, /\.fi-tactical-option__desc \{[^}]*clip:rect\(0 0 0 0\)/,
    'short viewports hide the descriptions visually only (they stay in each option\'s accessible name)');
  assert.doesNotMatch(short, /display:none/);
  assert.doesNotMatch(css('src/screens/ledger/ledger.css'), /data-stat=fallen\][^{]*\{[^}]*--loss/,
    'README reserves loss for negative deltas and win chances under 45%');
  // Phone: the head kicker ("THE EUROPEAN CAMPAIGN · … · SEED 2033") gets its own full-width row, not an ellipsis
  // beside the three stats.
  const phone = css('src/screens/ledger/ledger.css').match(/@media \(max-width:699\.98px\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(phone, /\.ledger-head \{[^}]*flex-wrap:wrap/);
  assert.match(phone, /\.ledger-head__title \{ display:contents; \}/);
  assert.match(phone, /\.ledger-head__kicker \{[^}]*flex:1 0 100%/);
});
