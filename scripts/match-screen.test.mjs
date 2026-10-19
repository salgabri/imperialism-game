// Owner: WP-MATCH (see PLAN.md §4, §5.2). Match view model, MatchScreen and MatchCard (full + compact) contracts.
// REQUIRED in the matchMethods wiring pass (PLAN §5.2, tracked in W2-UI-LOG): the App-side minute clock and speed
// reschedule cases (startMinuteClock, rescheduleForSpeed) join this file then; everything here runs without App.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const compiled = await build({
  stdin: { contents: `
    export {default as MatchScreen} from './src/screens/match/MatchScreen.jsx';
    export {default as MatchCard, TeamMark} from './src/components/MatchCard.jsx';
    export {default as LiveMinute, useLiveMinute} from './src/components/LiveMinute.jsx';
    export {buildLiveMatch, buildFeedRows, scorersLine} from './src/viewModels/match.js';
    export {createMinuteStore} from './src/engine/liveMinute.js';
    export {getSport} from './src/sports/index.js';
  `, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom'],
  loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { MatchScreen, MatchCard, buildLiveMatch, buildFeedRows, scorersLine, createMinuteStore, getSport } = module.exports;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
after(() => dom.window.close());

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
    async render(next) { await act(async () => root.render(React.createElement(Component, next))); },
    async close() { await act(async () => root.unmount()); host.remove(); },
  };
  context.after(() => view.close());
  await view.render(props);
  return view;
}

// ---------- fixtures ----------
const FOOTBALL_PLAN = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'];
function footballTeam(id, name, code, flagId, base, extra = []) {
  const squad = FOOTBALL_PLAN.map((pos, i) => ({ name: `${name} Player ${i + 1}`, pos, rating: base - (i % 4) }));
  return { id, name, code, flagId, kind: 'nation', col: '#888888', squad: [...squad, ...extra] };
}
const ITA = footballTeam('380', 'Italy', 'ITA', '380', 86, [
  { name: 'Dušan Vlahović', pos: 'FW', rating: 92, from: 'SRB', fromId: '688', joined: 12 },
]);
const SRB = footballTeam('688', 'Serbia', 'SRB', '688', 82);
const HUN = footballTeam('348', 'Hungary', 'HUN', '348', 78);
const teams = { 380: ITA, 688: SRB, 348: HUN };
const sport = getSport('football');

function liveState(matchPatch = {}, extra = {}) {
  const shown = [
    { m: 24, tid: '688', name: 'Sergej Milinković-Savić', pts: 1 },
    { m: 29, tid: '380', name: 'Giovanni Di Lorenzo', pts: 1 },
  ];
  return {
    phase: 'playing', round: 27, settings: { sport: 'football', pacing: 'duel', resolution: 'ticker' }, teams,
    aliveIds: ['380', '688', '348'], history: [], stats: {},
    match: { aId: '688', dId: '380', effA: 80.5, effD: 85.1, ga: 1, gd: 1, shown, allEv: [...shown, { m: 71, tid: '380', name: 'Federico Chiesa', pts: 1 }],
      tie: null, tieShown: null, winner: '380', finalGa: 1, finalGd: 2, status: 'LIVE', applied: false, done: false,
      odds: { a: .37, b: .63 }, routeLabel: 'Across a land border', ...matchPatch },
    ...extra,
  };
}
const ctxFor = (managedId = '380', followedId = null) => ({ sport, managedId, followedId, perspectiveId: managedId || followedId, drama: 6, cache: new Map() });

// ---------- view-model ----------
test('buildLiveMatch tolerates loading/setup phases and reports the next fixture in the empty state', () => {
  for (const st of [{ phase: 'loading', teams: {}, aliveIds: [], settings: { sport: 'football' } },
    { phase: 'setup', teams: {}, aliveIds: [], settings: {} }, undefined]) {
    const model = buildLiveMatch(st, { cache: new Map(), sport });
    assert.equal(model.empty.title, 'No match yet');
    assert.equal(model.a, null);
  }
  const gate = buildLiveMatch({ ...liveState(), match: null, tacticalChoice: { aId: '688', dId: '380' } }, ctxFor());
  assert.equal(gate.empty.text, 'Next fixture: Serbia v Italy');
  const idle = buildLiveMatch({ ...liveState(), match: null }, ctxFor());
  assert.match(idle.empty.text, /Next draw · Any of 3 empires can be drawn/);
});

test('a live football match: attacker first, scorers, perspective, minute floor and lineups with claimed tags', () => {
  const model = buildLiveMatch(liveState(), ctxFor('380'));
  assert.equal(model.state, 'live');
  assert.equal(model.statusLabel, 'LIVE');
  assert.equal(model.live, true);
  assert.equal(model.a.code, 'SRB');
  assert.equal(model.a.side, 'Attack');
  assert.equal(model.b.side, 'Defend');
  assert.equal(model.a.scorers, "Milinković-Savić 24'");
  assert.equal(model.b.scorers, "Di Lorenzo 29'");
  assert.deepEqual(model.perspective, { side: 'D', teamId: '380', code: 'ITA', name: 'Italy' });
  assert.equal(model.minuteFloor, 29);
  assert.equal(model.minuteFallback, 29);
  assert.deepEqual(model.goals, [{ m: 24, tid: '688', pts: 1 }, { m: 29, tid: '380', pts: 1 }]);
  assert.equal(model.final, null);
  assert.equal(model.lineups.a.title, 'Serbia · XI');
  assert.equal(model.lineups.b.rows.length, 11);
  assert.deepEqual(model.lineups.b.rows.map(row => row.pos), FOOTBALL_PLAN);
  const claimed = model.lineups.b.rows.find(row => row.claimed);
  assert.equal(claimed.name, 'Dušan Vlahović');
  assert.equal(claimed.claimed.roman, 'R XII');
  assert.equal(claimed.claimed.flagId, '688');
  assert.equal(claimed.tier, '88');
  assert.equal(model.preMatch.aLabel, 'SRB 37%');
  assert.equal(model.preMatch.bLabel, '63% ITA');
  assert.equal(model.preMatch.fill, 37);
  // Spectator following nobody in this match → the attacker's side.
  assert.equal(buildLiveMatch(liveState(), ctxFor(null, '348')).perspective.side, 'A');
  assert.equal(buildLiveMatch(liveState(), ctxFor(null, '380')).perspective.side, 'D');
});

test('the model tolerates matches without odds, live model, tactic or route (smoke-injected fixtures)', () => {
  const model = buildLiveMatch(liveState({ odds: undefined, live: undefined, routeLabel: undefined, routeKind: undefined, tactic: undefined }), ctxFor());
  assert.equal(model.preMatch.odds, null);
  assert.equal(model.preMatch.aLabel, null);
  assert.ok(model.chartNote === null || typeof model.chartNote === 'string');
  assert.ok(Array.isArray(buildFeedRows(model, 38)));
});

test('feed rows: status row first, newest first, half-time only from 45 and pluralised minutes', () => {
  const model = buildLiveMatch(liveState(), ctxFor());
  const at38 = buildFeedRows(model, 38);
  assert.deepEqual(at38.map(row => [row.minute, row.text, row.weight]), [
    ["38'", 'Live — SRB 1–1 ITA · 52 minutes left', 600],
    ["29'", 'GOAL — Giovanni Di Lorenzo (ITA)', 700],
    ["24'", 'GOAL — Sergej Milinković-Savić (SRB)', 700],
    ["0'", 'Kick-off — Serbia attack Italy', 500],
  ]);
  assert.equal(at38[0].live, true);
  const at89 = buildFeedRows(model, 89);
  assert.equal(at89[0].text, 'Live — SRB 1–1 ITA · 1 minute left');
  assert.deepEqual(at89[1], { key: 'half', minute: "45'", text: 'Half-time — SRB 1–1 ITA', weight: 500, status: false, live: false });
  assert.deepEqual(buildFeedRows(null, 10), []);
});

test('full time, penalties and the series end state', () => {
  const ft = buildLiveMatch(liveState({ status: 'FULL TIME', ga: 1, gd: 2, done: true }), ctxFor());
  assert.equal(ft.state, 'full-time');
  assert.equal(ft.statusLabel, 'FULL TIME');
  assert.deepEqual(ft.final, { winnerSide: 'D' });
  assert.equal(ft.minuteFallback, 90);
  assert.equal(buildFeedRows(ft, 0)[0].text, 'Full time — SRB 1–2 ITA');

  const tie = { A: [1, 1, 0], D: [1, 1, 1], first: 'A', ga: 2, gd: 3 };
  const pens = buildLiveMatch(liveState({ status: 'PENALTIES', tie, tieShown: { A: [1, 1], D: [1] } }), ctxFor());
  assert.equal(pens.state, 'penalties');
  assert.equal(pens.statusLabel, 'PENALTIES');
  assert.equal(pens.statusDetail, '2–1');
  assert.deepEqual(pens.kicks, { a: [1, 1], b: [1] });
  assert.equal(buildFeedRows(pens, 0)[0].text, 'Penalties — SRB 1–1 ITA · 2–1');

  const settled = buildLiveMatch(liveState({ status: 'PENALTIES', tie, tieShown: { A: tie.A, D: tie.D }, applied: true, done: true }), ctxFor());
  assert.equal(settled.state, 'full-time');
  assert.equal(settled.statusDetail, '2–3 on penalties');
  assert.equal(buildFeedRows(settled, 0)[0].text, 'Full time — SRB 1–1 ITA · 2–3 on penalties');
});

test('basketball: FINAL label, points scorers, tip-off and an overtime row', () => {
  const bball = getSport('basketball');
  const guard = (name, pos, rating) => ({ name, pos, rating });
  const five = (prefix, base) => ['PG', 'SG', 'SF', 'PF', 'C'].map((pos, i) => guard(`${prefix} ${pos}`, pos, base - i));
  const t = { b1: { id: 'b1', name: 'Serbia', code: 'SRB', flagId: '688', kind: 'nation', squad: five('Serbia', 84) },
    b2: { id: 'b2', name: 'Spain', code: 'ESP', flagId: '724', kind: 'nation', squad: five('Spain', 83) } };
  const shown = [{ m: 12, tid: 'b1', name: 'Nikola Jokić', pts: 7 }, { m: 39, tid: 'b2', name: 'Willy Hernangómez', pts: 3 },
    { m: 40, tid: 'b1', name: 'Nikola Jokić', pts: 2 }, { m: 43, tid: 'b2', name: 'Santi Aldama', pts: 5 }];
  const st = { phase: 'playing', round: 4, settings: { sport: 'basketball' }, teams: t, aliveIds: ['b1', 'b2'], history: [],
    match: { aId: 'b1', dId: 'b2', effA: 80, effD: 79, ga: 9, gd: 8, shown, allEv: shown, status: 'LIVE', applied: false, done: false,
      tie: { periods: [{ a: 0, b: 0 }] } } };
  const live = buildLiveMatch(st, { sport: bball, cache: new Map() });
  assert.equal(live.a.scorers, 'Jokić 9 pts');
  // DECISIONS (Misc): basketball squads read "Starting five", never "XI".
  assert.equal(live.lineups.a.title, 'Serbia · Starting five');
  assert.equal(live.lineups.b.title, 'Spain · Starting five');
  assert.equal(live.lineups.a.rows.length, 5);
  const rows = buildFeedRows(live, 43);
  assert.equal(rows[0].text, 'Live — SRB 9–8 ESP · overtime');
  assert.ok(rows.some(row => row.key === 'overtime' && row.text === 'Overtime — SRB 9–3 ESP'));
  assert.ok(rows.some(row => row.key === 'half' && row.minute === "20'"));
  assert.equal(rows.at(-1).text, 'Tip-off — Serbia attack Spain');
  const final = buildLiveMatch({ ...st, match: { ...st.match, status: 'OVERTIME', done: true, winner: 'b1' } }, { sport: bball, cache: new Map() });
  assert.equal(final.statusLabel, 'FINAL');
  assert.equal(final.statusDetail, 'after 1 overtime period');
  assert.match(buildFeedRows(final, 0)[0].text, /^Final — SRB 9–8 ESP · after 1 overtime period$/);
});

test('with no current match the Match view shows the last finished match from history (DEC D11)', () => {
  const entry = { id: 'match-9', round: '012', aId: '688', dId: '380',
    a: { teamId: '688', id: '688', code: 'SRB', name: 'Serbia', score: 1, eff: '80.5' },
    b: { teamId: '380', id: '380', code: 'ITA', name: 'Italy', score: 2, eff: '85.1' },
    events: [{ when: "24'", text: 'GOAL — S. Milinković-Savić (SRB)' }, { when: "61'", text: 'GOAL — F. Chiesa (ITA)' }],
    winnerId: '380', result: { winnerId: '380', tieText: null }, odds: { a: .4, b: .6 } };
  const model = buildLiveMatch({ ...liveState(), match: null, history: [entry] }, ctxFor());
  assert.equal(model.source, 'history');
  assert.equal(model.state, 'full-time');
  assert.equal(model.a.score, 1);
  assert.equal(model.b.score, 2);
  assert.equal(model.model, null);
  const rows = buildFeedRows(model, 0);
  assert.deepEqual(rows.map(row => row.minute), ["90'", "61'", "24'", "0'"]);
  assert.equal(rows[0].text, 'Full time — SRB 1–2 ITA');
  // The archived header keeps the scorer lines the feed lists (read back from the saved event copy).
  assert.equal(model.a.scorers, "Milinković-Savić 24'");
  assert.equal(model.b.scorers, "Chiesa 61'");
});

test('a settled conquest shows the kickoff XIs: the claimed player is back with the loser (live-applied and history)', () => {
  // Serbia (attacker) lost to Italy; applyConquest moved Serbia's best striker to the end of Italy's squad.
  const star = { name: 'Aleksandar Mitrović', pos: 'FW', rating: 91 };
  const srbBefore = footballTeam('688', 'Serbia', 'SRB', '688', 82, [star]);
  const srbAfter = { ...srbBefore, squad: srbBefore.squad.filter(p => p !== star) };
  const itaAfter = { ...ITA, squad: [...ITA.squad, { ...star, from: 'SRB', fromId: '688', joined: 27, claimGain: .4 }] };
  const after = { ...teams, 688: srbAfter, 380: itaAfter };
  const kickoffNames = team => buildLiveMatch(liveState({}, { teams: { ...teams, 688: srbBefore } }), ctxFor())
    .lineups[team].rows.map(row => row.name);
  const applied = liveState({ status: 'FULL TIME', ga: 1, gd: 2, done: true, applied: true, winner: '380', playerTaken: { ...star } },
    { teams: after });
  const model = buildLiveMatch(applied, ctxFor());
  assert.deepEqual(model.lineups.a.rows.map(row => row.name), kickoffNames('a'), 'Serbia still fields the striker');
  assert.ok(model.lineups.a.rows.some(row => row.name === star.name && !row.claimed));
  assert.equal(model.lineups.a.rows.length, 11);
  assert.deepEqual(model.lineups.b.rows.map(row => row.name), kickoffNames('b'), 'Italy without its new signing');
  assert.ok(!model.lineups.b.rows.some(row => row.name === star.name));

  const entry = { id: 'match-27', round: '027', aId: '688', dId: '380',
    a: { teamId: '688', id: '688', code: 'SRB', name: 'Serbia', score: 1, eff: '80.5' },
    b: { teamId: '380', id: '380', code: 'ITA', name: 'Italy', score: 2, eff: '85.1' },
    events: [{ when: "24'", text: 'GOAL — Aleksandar Mitrović (SRB)' }, { when: "61'", text: 'GOAL — F. Chiesa (ITA)' }, { when: "88'", text: 'GOAL — F. Chiesa (ITA)' }],
    winnerId: '380', result: { winnerId: '380', loserId: '688', tieText: null, player: { ...star } } };
  const archived = buildLiveMatch({ ...liveState({}, { teams: after }), match: null, history: [entry] }, ctxFor());
  assert.equal(archived.source, 'history');
  assert.deepEqual(archived.lineups.a.rows.map(row => row.name), kickoffNames('a'));
  assert.deepEqual(archived.lineups.b.rows.map(row => row.name), kickoffNames('b'));
  assert.ok(!archived.lineups.b.rows.some(row => row.claimed?.roman === 'R XXVII'), 'no tag from the match itself');
  assert.equal(archived.a.scorers, "Mitrović 24'");
  assert.equal(archived.b.scorers, "Chiesa 61' · Chiesa 88'");

  // Nothing to undo before the conquest is applied (a live match, or the manager's signing still open).
  const live = buildLiveMatch(liveState({}, { teams: { ...teams, 688: srbBefore } }), ctxFor());
  assert.ok(live.lineups.a.rows.some(row => row.name === star.name));
});

test('an archived overtime game ends at the overtime minute, like the live model (basketball)', () => {
  const bball = getSport('basketball');
  const five = (prefix, base) => ['PG', 'SG', 'SF', 'PF', 'C'].map((pos, i) => ({ name: `${prefix} ${pos}`, pos, rating: base - i }));
  const t = { b1: { id: 'b1', name: 'Honduras', code: 'HON', flagId: '340', kind: 'nation', squad: five('Honduras', 70) },
    b2: { id: 'b2', name: 'Guatemala', code: 'GUA', flagId: '320', kind: 'nation', squad: five('Guatemala', 69) } };
  const shown = [{ m: 12, tid: 'b1', name: 'Honduras PG', pts: 7 }, { m: 40, tid: 'b2', name: 'Guatemala SG', pts: 3 },
    { m: 43, tid: 'b2', name: 'Guatemala C', pts: 5 }];
  const st = { phase: 'playing', round: 9, settings: { sport: 'basketball' }, teams: t, aliveIds: ['b2'], history: [],
    match: { aId: 'b1', dId: 'b2', effA: 70, effD: 69, ga: 7, gd: 8, shown, allEv: shown, status: 'OVERTIME', applied: true, done: true,
      winner: 'b2', tie: { periods: [{ a: 0, b: 5 }] } } };
  const live = buildLiveMatch(st, { sport: bball, cache: new Map() });
  assert.equal(buildFeedRows(live, 0)[0].minute, "45'");
  const entry = { id: 'match-30', round: '009', aId: 'b1', dId: 'b2',
    a: { teamId: 'b1', id: '340', code: 'HON', name: 'Honduras', score: 7, eff: '70.0' },
    b: { teamId: 'b2', id: '320', code: 'GUA', name: 'Guatemala', score: 8, eff: '69.0' },
    events: [{ when: 'Q2', text: '+7 — Honduras PG (HON)' }, { when: 'Q4', text: '+3 — Guatemala SG (GUA)' }, { when: 'OT', text: '+5 — Guatemala C (GUA)' }],
    winnerId: 'b2', result: { winnerId: 'b2', loserId: 'b1', tieText: 'After 1 overtime period' } };
  const archived = buildLiveMatch({ ...st, match: null, history: [entry] }, { sport: bball, cache: new Map() });
  assert.equal(archived.source, 'history');
  assert.equal(archived.minuteFallback, 45);
  assert.equal(buildFeedRows(archived, 0)[0].text, 'Final — HON 7–8 GUA · After 1 overtime period');
  assert.equal(buildFeedRows(archived, 0)[0].minute, "45'");
  assert.equal(archived.b.scorers, 'C 5 pts · SG 3 pts');
});

test('scorersLine keeps particles and joins with a middle dot', () => {
  const shown = [{ m: 23, tid: 'x', name: 'Federico Chiesa' }, { m: 61, tid: 'x', name: 'Giacomo Raspadori' }, { m: 70, tid: 'y', name: 'G. Di Lorenzo' }];
  assert.equal(scorersLine(shown, 'x', {}), "Chiesa 23' · Raspadori 61'");
  assert.equal(scorersLine(shown, 'y', {}), "Di Lorenzo 70'");
  assert.equal(scorersLine([], 'x', {}), '');
  assert.equal(scorersLine(null, 'x', {}), '');
});

// ---------- MatchScreen ----------
const screenProps = (st, extra = {}) => ({ ...buildLiveMatch(st, ctxFor()), speed: 2, paused: false, ...extra });

test('MatchScreen renders the score header, live minute from the store, chart, XIs and the dark feed', async context => {
  const store = createMinuteStore(38);
  const speeds = [], pauses = [], squads = [];
  const view = await mount(MatchScreen, screenProps(liveState(), {
    minuteStore: store, onSpeed: n => speeds.push(n), onPause: () => pauses.push(1), onSelectTeam: id => squads.push(id) }), context);
  const root = view.host.querySelector('#view-panel-match');
  assert.ok(root.classList.contains('screen') && root.classList.contains('screen--match'));
  assert.equal(root.getAttribute('aria-labelledby'), 'view-tab-match');
  assert.equal(root.getAttribute('tabindex'), '-1');
  assert.equal(root.dataset.state, 'live');
  assert.equal(view.host.querySelector('.match-score__digits').textContent, '1–1');
  assert.equal(view.host.querySelector('.match-score__minute').textContent, "38' · LIVE");
  assert.deepEqual([...view.host.querySelectorAll('.match-score__label-text')].map(n => n.textContent), ['Attack', 'Defend']);
  assert.deepEqual([...view.host.querySelectorAll('.match-score__name')].map(n => n.textContent), ['Serbia', 'Italy']);
  assert.equal(view.host.querySelector('.match-score__scorers').textContent, "Milinković-Savić 24'");
  const feed = view.host.querySelector('.match-feed__body[role="log"]');
  assert.ok(feed);
  assert.equal(feed.querySelector('.match-feed__row').textContent, "38'Live — SRB 1–1 ITA · 52 minutes left");
  assert.equal(feed.querySelector('.match-feed__row').getAttribute('aria-hidden'), 'true');
  assert.equal(view.host.querySelectorAll('.match-xi').length, 2);
  assert.equal(view.host.querySelectorAll('.match-xi__row').length, 22);
  assert.equal(view.host.querySelector('.match-xi__tag-text').textContent, 'R XII');
  const chart = view.host.querySelector('.match-chart');
  assert.ok(chart);
  const liveModel = buildLiveMatch(liveState(), ctxFor()).model;
  assert.equal(liveModel?.kind, 'poisson', 'the view-model falls back to liveModelFor when match.live is missing');
  if (liveModel) {
    assert.equal(chart.querySelector('.match-chart__label').textContent, 'ITA win probability');
    assert.match(chart.querySelector('.match-chart__value').textContent, /^(<1%|>99%|\d{1,2}%)$/);
    const svg = chart.querySelector('svg');
    assert.equal(svg.getAttribute('viewBox'), '0 0 800 132');
    assert.match(svg.querySelector('.match-chart__line').getAttribute('d'), /^M0,/);
    assert.equal(svg.querySelectorAll('.match-chart__goal').length, 2);
    assert.ok(svg.querySelector('.match-chart__now'));
    assert.match(svg.querySelector('.match-chart__area').getAttribute('fill'), /^url\(#match-hatch-[\w-]+\)$/);
    assert.ok(svg.querySelector(`pattern#${svg.querySelector('.match-chart__area').getAttribute('fill').slice(5, -1)}`));
    assert.deepEqual([...chart.querySelectorAll('.match-chart__axis span')].map(n => n.textContent), ["0'", "15'", "30'", "45'", "60'", "75'", "90'"]);
  } else {
    assert.ok(chart.querySelector('.match-chart__note'));
  }

  // The minute store drives the header and the feed without a new model (DEC D7).
  await act(async () => store.set(41));
  assert.equal(view.host.querySelector('.match-score__minute').textContent, "41' · LIVE");
  assert.match(view.host.querySelector('.match-feed__row').textContent, /49 minutes left/);
  // Never below the last revealed event.
  await act(async () => store.set(3));
  assert.equal(view.host.querySelector('.match-score__minute').textContent, "29' · LIVE");

  const chips = [...view.host.querySelectorAll('.match-feed .match-speed__chip')];
  assert.deepEqual(chips.map(chip => chip.textContent), ['1×', '2×', '4×']);
  assert.deepEqual(chips.map(chip => chip.getAttribute('aria-pressed')), ['false', 'true', 'false']);
  await act(async () => chips[2].click());
  await act(async () => view.host.querySelector('.match-feed .match-speed__pause').click());
  assert.deepEqual(speeds, [4]);
  assert.equal(pauses.length, 1);
  // The XI title stays a heading; the squad button sits inside it and the section is named by the title alone.
  const xi = view.host.querySelector('.match-xi');
  const heading = xi.querySelector('h3.match-xi__title');
  const squadButton = heading.querySelector('button.match-xi__title-button');
  assert.ok(squadButton);
  assert.equal(squadButton.textContent, 'Serbia · XI, view squad');
  assert.equal(document.getElementById(xi.getAttribute('aria-labelledby')).textContent, 'Serbia · XI');
  assert.equal(xi.querySelector('.match-xi__kicker').classList.contains('kicker'), true);
  // B1 per-row auto track: the tag lives in the player cell, ahead of the rating cell; three columns.
  assert.deepEqual([...xi.querySelectorAll('thead th')].map(th => th.textContent), ['Position', 'Player', 'Rating']);
  const tagged = view.host.querySelector('.match-xi__tag').closest('tr');
  assert.deepEqual([...tagged.children].map(td => td.className), ['match-xi__pos', 'match-xi__name', 'match-xi__rating']);
  assert.ok(tagged.querySelector('.match-xi__name .match-xi__player > .match-xi__claimed > .match-xi__tag'));
  assert.equal(tagged.querySelector('.match-xi__player-name').textContent, 'Dušan Vlahović');
  await act(async () => squadButton.click());
  assert.deepEqual(squads, ['688']);

  const pause = view.host.querySelector('.match-feed .match-speed__pause');
  assert.equal(pause.textContent, 'Pause');
  assert.equal(pause.hasAttribute('aria-pressed'), false);
  assert.equal(pause.classList.contains('is-paused'), false);
  await view.render(screenProps(liveState(), { minuteStore: store, paused: true }));
  assert.equal(pause.textContent, 'Resume');
  assert.equal(pause.hasAttribute('aria-pressed'), false, 'a label that flips must not also be a pressed toggle');
  assert.equal(pause.classList.contains('is-paused'), true);
});

test('MatchScreen end states: FULL TIME, PENALTIES and the empty state', async context => {
  const store = createMinuteStore(12);
  const view = await mount(MatchScreen, screenProps(liveState({ status: 'FULL TIME', ga: 1, gd: 2, done: true }), { minuteStore: store }), context);
  assert.equal(view.host.querySelector('.match-score__minute').textContent, 'FULL TIME');
  assert.equal(view.host.querySelector('#view-panel-match').dataset.state, 'full-time');
  assert.equal(view.host.querySelector('.match-feed__row').textContent, "90'Full time — SRB 1–2 ITA");

  const tie = { A: [1, 0, 1], D: [1, 1, 1], first: 'A', ga: 2, gd: 3 };
  await view.render(screenProps(liveState({ status: 'PENALTIES', tie, tieShown: { A: [1, 0], D: [1] } }), { minuteStore: store }));
  assert.equal(view.host.querySelector('.match-score__minute').textContent, 'PENALTIES · 1–1');
  const kicks = [...view.host.querySelectorAll('.match-score__kicks')];
  assert.equal(kicks.length, 2);
  // The dots are graphics: role="img" is a valid aria-label target (a bare span is not; browse mode skipped it).
  assert.deepEqual(kicks.map(node => [node.getAttribute('role'), node.getAttribute('aria-label')]),
    [['img', 'SRB: 1 penalties scored from 2'], ['img', 'ITA: 1 penalties scored from 1']]);

  await view.render(screenProps({ phase: 'playing', teams: {}, aliveIds: [], settings: {} }, { minuteStore: store }));
  assert.equal(view.host.querySelector('.match-screen__empty-title').textContent, 'No match yet');
  assert.equal(view.host.querySelector('#view-panel-match').dataset.state, 'empty');
});

test('MatchScreen renders a basketball match at full time: FINAL · after overtime, 10-minute axis, starting five', async context => {
  const bball = getSport('basketball');
  const five = (prefix, base) => ['PG', 'SG', 'SF', 'PF', 'C'].map((pos, i) => ({ name: `${prefix} ${pos}`, pos, rating: base - i }));
  const t = { b1: { id: 'b1', name: 'Serbia', code: 'SRB', flagId: '688', kind: 'nation', squad: five('Serbia', 84) },
    b2: { id: 'b2', name: 'Spain', code: 'ESP', flagId: '724', kind: 'nation', squad: five('Spain', 83) } };
  const shown = [{ m: 12, tid: 'b1', name: 'Nikola Jokić', pts: 7 }, { m: 39, tid: 'b2', name: 'Willy Hernangómez', pts: 3 },
    { m: 40, tid: 'b1', name: 'Nikola Jokić', pts: 2 }, { m: 43, tid: 'b2', name: 'Santi Aldama', pts: 5 }];
  const st = { phase: 'playing', round: 4, settings: { sport: 'basketball' }, teams: t, aliveIds: ['b1', 'b2'], history: [],
    match: { aId: 'b1', dId: 'b2', effA: 80, effD: 79, ga: 9, gd: 8, shown, allEv: shown, status: 'OVERTIME', applied: false, done: true,
      winner: 'b1', tie: { periods: [{ a: 0, b: 0 }] } } };
  const model = buildLiveMatch(st, { sport: bball, managedId: 'b1', cache: new Map() });
  const view = await mount(MatchScreen, { ...model, minuteStore: createMinuteStore(12), speed: 1, paused: false }, context);
  const root = view.host.querySelector('#view-panel-match');
  assert.equal(root.dataset.state, 'full-time');
  assert.equal(view.host.querySelector('.match-score__minute').textContent, 'FINAL · after 1 overtime period');
  assert.equal(view.host.querySelector('.match-score__minute').classList.contains('is-live'), false);
  assert.equal(view.host.querySelector('.match-score__digits').textContent, '9–8');
  assert.equal(view.host.querySelector('.match-score__scorers').textContent, 'Jokić 9 pts');
  // The final minute is the end of the overtime played (40 + 5), not the last scoring run (43'): the archived view agrees.
  assert.equal(view.host.querySelector('.match-feed__row').textContent, "45'Final — SRB 9–8 ESP · after 1 overtime period");
  assert.equal(view.host.querySelector('.match-feed__row:last-child').textContent, "0'Tip-off — Serbia attack Spain");
  assert.deepEqual([...view.host.querySelectorAll('.match-xi__title')].map(n => n.textContent), ['Serbia · Starting five', 'Spain · Starting five']);
  assert.equal(view.host.querySelectorAll('.match-xi__row').length, 10);
  const chart = view.host.querySelector('.match-chart');
  assert.equal(model.model?.kind, 'normal', 'basketball falls back to the normal-approximation live model');
  if (model.model) {
    assert.equal(chart.querySelector('.match-chart__label').textContent, 'SRB win probability');
    // A decided match ends at exactly 1 (DEC D6): "100%", never the estimate clamp ">99%".
    assert.equal(chart.querySelector('.match-chart__value').textContent, '100%');
    // Basketball scoring runs are too dense to mark (B§1.5.2): no goal markers.
    assert.equal(chart.querySelectorAll('.match-chart__goal').length, 0);
    // 10-minute ticks over regulation, then the overtime period the match reached.
    assert.deepEqual([...chart.querySelectorAll('.match-chart__axis span')].map(n => n.textContent), ["0'", "10'", "20'", "30'", "40'", "45'"]);
  } else {
    assert.ok(chart.querySelector('.match-chart__note'));
  }
});

test('phone segments switch between Feed, Lineups and Stats (component state, A-3)', async context => {
  const speeds = [];
  const view = await mount(MatchScreen, screenProps(liveState(), { minuteStore: createMinuteStore(38), onSpeed: n => speeds.push(n) }), context);
  const root = view.host.querySelector('#view-panel-match');
  assert.ok(view.host.querySelector('.match-segments').classList.contains('segmented'));
  assert.ok(view.host.querySelector('.match-chart__head').classList.contains('kicker'));
  const segments = [...view.host.querySelectorAll('.match-segments__item')];
  assert.deepEqual(segments.map(button => button.textContent), ['Feed', 'Lineups', 'Stats']);
  assert.equal(root.dataset.segment, 'feed');
  assert.equal(segments[0].getAttribute('aria-pressed'), 'true');
  await act(async () => segments[1].click());
  assert.equal(root.dataset.segment, 'lineups');
  assert.equal(segments[1].getAttribute('aria-pressed'), 'true');
  await act(async () => segments[2].click());
  assert.equal(root.dataset.segment, 'stats');
  const stats = view.host.querySelector('.match-stats');
  assert.match(stats.textContent, /SRB 37%/);
  assert.match(stats.textContent, /Strength 80\.5 v 85\.1/);
  await act(async () => stats.querySelector('.match-speed__chip:first-of-type').click());
  assert.deepEqual(speeds, [1]);
});

test('MatchScreen still renders the legacy card handed over before the App wiring pass', async context => {
  const view = await mount(MatchScreen, { card: { round: '003', status: 'LIVE', statusLive: true,
    a: { name: 'Alfa', code: 'ALF', score: 1, eff: '75.0' }, b: { name: 'Beta', code: 'BET', score: 0, eff: '74.0' }, events: [] } }, context);
  assert.ok(view.host.querySelector('#view-panel-match [data-testid="match-card"]'));
});

// ---------- MatchCard ----------
const card = {
  round: '027', status: 'LIVE', statusLive: true, startLabel: 'KICK-OFF…',
  a: { teamId: '688', id: '688', isClub: false, code: 'SRB', name: 'Serbia', eff: '80.5', score: 1 },
  b: { teamId: '380', id: '380', isClub: false, code: 'ITA', name: 'Italy', eff: '85.1', score: 1 },
  events: [{ when: "24'", text: 'GOAL — S. Milinković-Savić (SRB)', color: '#fff' }, { when: "29'", text: 'GOAL — G. Di Lorenzo (ITA)', color: '#fff' }],
  noEvents: false, odds: { a: .37, b: .63 }, routeLabel: 'Across a land border', minuteFallback: 29,
};
const result = { title: '', winnerId: '380', loserId: '688', winnerName: 'Italy', loserName: 'Serbia', territories: 3,
  player: { name: 'Dušan Vlahović', pos: 'FW', rating: 88 }, strengthBefore: 85.1, strengthAfter: 85.6, strengthGain: .5,
  territoryNames: ['Serbia', 'Kosovo', 'Bosnia'], territoryIds: [], replacedPlayer: null, tieText: null };

test('compact MatchCard keeps the contract classes and reads the minute store', async context => {
  const store = createMinuteStore(38);
  const eventsRef = React.createRef();
  const view = await mount(MatchCard, { ...card, variant: 'compact', minuteStore: store, eventsRef, onSelectTeam: () => {} }, context);
  const root = view.host.querySelector('[data-testid="match-card"]');
  assert.ok(root.classList.contains('fi-match--compact'));
  assert.equal(root.querySelector('.fi-scoreboard').getAttribute('aria-label'), 'Serbia 1, Italy 1');
  assert.equal(root.querySelector('.fi-score-number').textContent, '1–1');
  assert.equal(root.querySelector('.fi-match-status').textContent, "38' · LIVE");
  const odds = [...root.querySelectorAll('.fi-match-odds span')].map(span => span.textContent);
  assert.deepEqual(odds, ['SRB 37%', 'Estimated win chance', '63% ITA']);
  assert.equal(root.querySelector('.fi-match-odds-bar').style.getPropertyValue('--odds-fill'), '37.0%');
  assert.equal(eventsRef.current, root.querySelector('[role="log"]'));
  assert.equal(root.querySelector('details'), null);
  await act(async () => store.set(44));
  assert.equal(root.querySelector('.fi-match-status').textContent, "44' · LIVE");
  assert.ok(root.querySelector('[aria-label="View Serbia squad"]'));

  await view.render({ ...card, variant: 'compact', minuteStore: store, eventsRef, status: 'FULL TIME', statusLive: false, result,
    onSelectTeam: () => {}, onViewConquest: () => {} });
  assert.equal(root.querySelector('[role="log"]'), null);
  assert.equal(root.querySelector('.fi-match-status').textContent, 'Full time');
  const resultText = root.querySelector('.fi-match-result').textContent;
  assert.match(resultText, /Italy takes Serbia/);
  assert.match(resultText, /\+3 territor/);
  assert.match(resultText, /Dušan Vlahović joins Italy/);
  const reward = root.querySelector('[data-testid="match-strength-gain"]');
  assert.equal(reward.querySelector('strong').textContent, '+0.5');
  assert.match(reward.textContent, /85\.1 to 85\.6/);
  assert.ok(root.querySelector('.fi-context-button'));

  // DEC D10 "result line": only the score, status, headline and strength delta stay visible; the rest is folded.
  assert.equal(root.dataset.state, 'done');
  assert.equal(root.querySelector('.fi-match-result h3').textContent, 'Italy takes Serbia');
  assert.equal(reward.closest('details'), null, 'the strength delta is visible');
  const details = root.querySelector('.fi-match-result > details.fi-match-spoils');
  assert.ok(details);
  assert.equal(details.open, false, 'collapsed by default');
  assert.equal(details.querySelector('summary').textContent, 'Match details+3 territories · Dušan Vlahović');
  for (const selector of ['.fi-spoils-row--territory', '.fi-spoils-row--player', '.fi-context-button', '.fi-match-odds', '.fi-match-route']) {
    assert.ok(root.querySelector(selector)?.closest('details.fi-match-spoils'), `${selector} is folded into the details`);
  }
  assert.match(details.querySelector('.fi-spoils-row--territory').textContent, /Serbia, Kosovo, Bosnia/);
  assert.equal(root.querySelectorAll('.fi-match-odds').length, 1);

  // A shoot-out's tie-break joins the status line; the kick dots fold away with role="img" tallies.
  await view.render({ ...card, variant: 'compact', minuteStore: store, eventsRef, status: 'FULL TIME', statusLive: false,
    kicks: { a: [1, 0, 1], b: [1, 1, 1] }, result: { ...result, upset: true, tieText: '2–3 on penalties' } });
  assert.equal(root.querySelector('.fi-match-status').textContent, 'Full time · 2–3 on penalties');
  assert.equal(root.querySelector('.fi-match-result-head .fi-upset-label').textContent, 'Upset victory');
  const pens = [...root.querySelectorAll('.fi-penalty-row')];
  assert.equal(pens.length, 2);
  assert.ok(pens.every(row => row.closest('details.fi-match-spoils') && row.getAttribute('role') === 'img'));
  assert.equal(pens[0].getAttribute('aria-label'), 'SRB: 2 penalties scored from 3');
});

test('compact MatchCard waits for the first event with the Roman round of the fixture kicker', async context => {
  const view = await mount(MatchCard, { ...card, events: [], noEvents: true, minuteFallback: 0, variant: 'compact',
    minuteStore: createMinuteStore(0) }, context);
  assert.equal(view.host.querySelector('.fi-match-wait').textContent, 'KICK-OFF… · Round XXVII');
  await view.render({ ...card, round: '', events: [], noEvents: true, variant: 'compact', minuteStore: createMinuteStore(0) });
  assert.equal(view.host.querySelector('.fi-match-wait').textContent, 'KICK-OFF…', 'no numeral, no round');
});

test('compact MatchCard never shows a minute below the last revealed event, even without minuteFallback', async context => {
  const store = createMinuteStore(0);
  const { minuteFallback, ...withoutFallback } = card;
  assert.equal(minuteFallback, 29);
  const view = await mount(MatchCard, { ...withoutFallback, variant: 'compact', minuteStore: store }, context);
  const status = view.host.querySelector('.fi-match-status');
  assert.equal(status.textContent, "29' · LIVE");
  await act(async () => store.set(33));
  assert.equal(status.textContent, "33' · LIVE");
  await view.render({ ...withoutFallback, variant: 'compact', minuteStore: store, events: [] });
  assert.equal(status.textContent, "33' · LIVE");
  await act(async () => store.set(0));
  assert.equal(status.textContent, "0' · LIVE");
});

// Frozen full-variant DOM (PLAN §3.5 MatchCard): rendered from the W1 MatchCard and pinned here. Markup owned by
// other modules (flag <img>, Icon <svg>, monogram inline style, theme fallback colours) is normalised away so only
// MatchCard's own DOM is compared. If MatchCard's full DOM must change, regenerate these deliberately.
const FULL_GOLDEN = {
  "live": "<section class=\"fi-match\" aria-label=\"Latest match\" data-testid=\"match-card\"><div class=\"fi-match-heading\"><h2>Latest match</h2><span class=\"fi-match-status is-live\" style=\"color:var(--result-positive, #95A3A8)\">LIVE</span></div><div class=\"fi-scoreboard\" role=\"group\" aria-label=\"Serbia 1, Italy 1\"><button type=\"button\" class=\"fi-score-team fi-score-team-button\" aria-label=\"View Serbia squad\"><img/><span class=\"fi-score-team-name\">Serbia</span><span class=\"fi-score-eff\" title=\"Strength of the legal starting lineup\"><span class=\"fi-score-eff-label\">Strength</span> <span class=\"fi-score-eff-value\">80.5</span></span></button><div class=\"fi-score-number\"><span class=\"fi-score-value\">1</span><span class=\"fi-score-dash\">–</span><span class=\"fi-score-value\">1</span></div><button type=\"button\" class=\"fi-score-team fi-score-team-button\" aria-label=\"View Italy squad\"><img/><span class=\"fi-score-team-name\">Italy</span><span class=\"fi-score-eff\" title=\"Strength of the legal starting lineup\"><span class=\"fi-score-eff-label\">Strength</span> <span class=\"fi-score-eff-value\">85.1</span></span></button></div><p class=\"fi-match-odds\" title=\"Pre-match estimate including match-day uncertainty and tie-breaks\"><span>SRB 37%</span><span>Estimated win chance</span><span>ITA 63%</span></p><p class=\"fi-match-route\">Across a land border</p><div class=\"fi-match-rule\" aria-hidden=\"true\"></div><div class=\"fi-match-events\" role=\"log\" aria-label=\"Match events\"><div class=\"fi-match-event\"><span class=\"fi-event-time\">24&#x27;</span><i style=\"--event-color:#fff\" aria-hidden=\"true\"></i><span>GOAL — S. Milinković-Savić (SRB)</span></div><div class=\"fi-match-event\"><span class=\"fi-event-time\">29&#x27;</span><i style=\"--event-color:#fff\" aria-hidden=\"true\"></i><span>GOAL — G. Di Lorenzo (ITA)</span></div></div></section>",
  "fullTime": "<section class=\"fi-match\" aria-label=\"Latest match\" data-testid=\"match-card\"><div class=\"fi-match-heading\"><h2>Latest match</h2><span class=\"fi-match-status\" style=\"color:var(--result-muted, #95A3A8)\">Full time</span></div><div class=\"fi-scoreboard\" role=\"group\" aria-label=\"Serbia 1, Italy 1\"><button type=\"button\" class=\"fi-score-team fi-score-team-button\" aria-label=\"View Serbia squad\"><img/><span class=\"fi-score-team-name\">Serbia</span><span class=\"fi-score-eff\" title=\"Strength of the legal starting lineup\"><span class=\"fi-score-eff-label\">Strength</span> <span class=\"fi-score-eff-value\">80.5</span></span></button><div class=\"fi-score-number\"><span class=\"fi-score-value\">1</span><span class=\"fi-score-dash\">–</span><span class=\"fi-score-value\">1</span></div><button type=\"button\" class=\"fi-score-team fi-score-team-button\" aria-label=\"View Italy squad\"><img/><span class=\"fi-score-team-name\">Italy</span><span class=\"fi-score-eff\" title=\"Strength of the legal starting lineup\"><span class=\"fi-score-eff-label\">Strength</span> <span class=\"fi-score-eff-value\">85.1</span></span></button></div><p class=\"fi-match-odds\" title=\"Pre-match estimate including match-day uncertainty and tie-breaks\"><span>SRB 37%</span><span>Estimated win chance</span><span>ITA 63%</span></p><p class=\"fi-series-status\" role=\"status\">Final series · SRB 1–0 ITA · first to 2 wins</p><p class=\"fi-match-route\">Across a land border</p><div class=\"fi-match-rule\" aria-hidden=\"true\"></div><div class=\"fi-penalties\"><div class=\"fi-penalty-row\" role=\"img\" aria-label=\"SRB: 2 penalties scored from 3\"><span>SRB</span><div><i class=\"scored\" aria-hidden=\"true\"></i><i class=\"missed\" aria-hidden=\"true\"></i><i class=\"scored\" aria-hidden=\"true\"></i></div></div><div class=\"fi-penalty-row\" role=\"img\" aria-label=\"ITA: 3 penalties scored from 3\"><span>ITA</span><div><i class=\"scored\" aria-hidden=\"true\"></i><i class=\"scored\" aria-hidden=\"true\"></i><i class=\"scored\" aria-hidden=\"true\"></i></div></div></div><div class=\"fi-match-result\" aria-live=\"polite\"><div class=\"fi-upset-label\">Upset victory</div><h3>Italy takes Serbia</h3><p class=\"fi-result-tiebreak\">2–3 on penalties</p><div class=\"fi-spoils-row fi-spoils-row--territory\"><svg/><span><span class=\"fi-reward-label\">Territory gained</span><strong class=\"fi-reward-value\">+3 territories</strong></span></div><div class=\"fi-spoils-row fi-spoils-row--player\"><svg/><span><span class=\"fi-reward-label\">Player acquired</span><button type=\"button\" class=\"fi-player-inspect\" aria-label=\"View Dušan Vlahović in Italy squad\">Dušan Vlahović</button> joins Italy<small>FW · 88 rating · replaces M. Kean in the lineup</small></span></div><div class=\"fi-spoils-row fi-strength-reward\" data-testid=\"match-strength-gain\"><span>Overall strength<small>85.1 to 85.6 · this conquest</small></span><strong class=\"fi-strength-gain\">+0.5</strong></div><details class=\"fi-conquest-details\"><summary>Territories claimed</summary><p>Serbia, Kosovo, Bosnia</p></details><button type=\"button\" class=\"fi-context-button\"><svg/>View conquest on map</button></div><details class=\"fi-match-report\"><summary><span>Match report</span><span class=\"fi-match-report-count\">2 events</span></summary><div class=\"fi-match-events fi-match-events--report\" role=\"region\" aria-label=\"Completed match events\"><div class=\"fi-match-event\"><span class=\"fi-event-time\">24&#x27;</span><i style=\"--event-color:#fff\" aria-hidden=\"true\"></i><span>GOAL — S. Milinković-Savić (SRB)</span></div><div class=\"fi-match-event\"><span class=\"fi-event-time\">29&#x27;</span><i style=\"--event-color:#fff\" aria-hidden=\"true\"></i><span>GOAL — G. Di Lorenzo (ITA)</span></div></div></details></section>",
  "archived": "<section class=\"fi-match fi-match--archived\" aria-label=\"Archived match\" data-testid=\"match-card\"><div class=\"fi-match-heading\"><h2>Round 27</h2><span class=\"fi-match-status\" style=\"color:var(--result-muted, #95A3A8)\">Full time</span></div><div class=\"fi-scoreboard\" role=\"group\" aria-label=\"Club Alfa 1, Italy 1\"><button type=\"button\" class=\"fi-score-team fi-score-team-button\" aria-label=\"View Club Alfa squad\"><span class=\"fi-team-monogram\">CLB</span><span class=\"fi-score-team-name\">Club Alfa</span><span class=\"fi-score-eff\" title=\"Strength of the legal starting lineup\"><span class=\"fi-score-eff-label\">Strength</span> <span class=\"fi-score-eff-value\">80.5</span></span></button><div class=\"fi-score-number\"><span class=\"fi-score-value\">1</span><span class=\"fi-score-dash\">–</span><span class=\"fi-score-value\">1</span></div><button type=\"button\" class=\"fi-score-team fi-score-team-button\" aria-label=\"View Italy squad\"><img/><span class=\"fi-score-team-name\">Italy</span><span class=\"fi-score-eff\" title=\"Strength of the legal starting lineup\"><span class=\"fi-score-eff-label\">Strength</span> <span class=\"fi-score-eff-value\">85.1</span></span></button></div><p class=\"fi-match-odds\" title=\"Pre-match estimate including match-day uncertainty and tie-breaks\"><span>CLB 37%</span><span>Estimated win chance</span><span>ITA 63%</span></p><p class=\"fi-match-route\">Through neutral land — transit treaty · neutral territories remain unclaimed</p><div class=\"fi-match-rule\" aria-hidden=\"true\"></div><div class=\"fi-match-result\" aria-live=\"polite\"><h3>Italy takes Serbia</h3><div class=\"fi-spoils-row fi-spoils-row--territory\"><svg/><span><span class=\"fi-reward-label\">Territory gained</span><strong class=\"fi-reward-value\">+3 territories</strong></span></div><div class=\"fi-spoils-row fi-spoils-row--player\"><svg/><span><span class=\"fi-reward-label\">Player acquired</span><button type=\"button\" class=\"fi-player-inspect\" aria-label=\"View Dušan Vlahović in Italy squad\">Dušan Vlahović</button> joins Italy<small>FW · 88 rating</small></span></div><div class=\"fi-spoils-row fi-strength-reward\" data-testid=\"match-strength-gain\"><span>Overall strength<small>85.1 to 85.6 · this conquest</small></span><strong class=\"fi-strength-gain\">+0.5</strong></div><details class=\"fi-conquest-details\"><summary>Territories claimed</summary><p>Serbia, Kosovo, Bosnia</p></details></div><details class=\"fi-match-report\"><summary><span>Match report</span><span class=\"fi-match-report-count\">2 events</span></summary><div class=\"fi-match-events fi-match-events--report\" role=\"region\" aria-label=\"Completed match events\"><div class=\"fi-match-event\"><span class=\"fi-event-time\">24&#x27;</span><i style=\"--event-color:#fff\" aria-hidden=\"true\"></i><span>GOAL — S. Milinković-Savić (SRB)</span></div><div class=\"fi-match-event\"><span class=\"fi-event-time\">29&#x27;</span><i style=\"--event-color:#fff\" aria-hidden=\"true\"></i><span>GOAL — G. Di Lorenzo (ITA)</span></div></div></details></section>"
};
const normaliseCard = markup => markup
  .replace(/<svg\b[\s\S]*?<\/svg>/g, '<svg/>')
  .replace(/<img\b[^>]*>/g, '<img/>')
  .replace(/<span class="fi-team-monogram"[^>]*>/g, '<span class="fi-team-monogram">')
  .replace(/(var\(--result-[a-z]+), [^)]*\)/g, '$1)');

test('full MatchCard markup is byte-identical to the frozen W1 DOM (live, full time with result, archived)', () => {
  const noop = () => {};
  const cases = {
    live: { ...card, onSelectTeam: noop },
    fullTime: { ...card, status: 'FULL TIME', statusLive: false, kicks: { a: [1, 0, 1], b: [1, 1, 1] }, series: { aWins: 1, bWins: 0, bestOf: 3 },
      result: { ...result, upset: true, tieText: '2–3 on penalties', replacedPlayer: { name: 'M. Kean' } }, onSelectTeam: noop, onViewConquest: noop },
    archived: { ...card, a: { ...card.a, teamId: undefined, isClub: true, code: 'CLB', name: 'Club Alfa' }, aId: 'c-1', status: 'FT', statusLive: false,
      archived: true, result, routeLabel: 'Through neutral land — transit treaty', onSelectTeam: noop },
  };
  for (const [name, props] of Object.entries(cases)) {
    const markup = renderToStaticMarkup(React.createElement(MatchCard, { ...props, minuteStore: createMinuteStore(80) }));
    assert.equal(normaliseCard(markup), normaliseCard(FULL_GOLDEN[name]), `full MatchCard DOM changed: ${name}`);
  }
});

test('full MatchCard (default variant) keeps the frozen DOM: no compact classes, odds spans, report after full time', async context => {
  const markup = renderToStaticMarkup(React.createElement(MatchCard, { ...card, minuteStore: createMinuteStore(80) }));
  assert.match(markup, /class="fi-scoreboard"/);
  assert.doesNotMatch(markup, /fi-match--compact|fi-match-odds-bar|live-minute/);
  const host = new JSDOM(markup).window.document;
  assert.deepEqual([...host.querySelectorAll('.fi-match-odds span')].map(span => span.textContent), ['SRB 37%', 'Estimated win chance', 'ITA 63%']);
  assert.equal(host.querySelector('.fi-match-heading h2').textContent, 'Latest match');
  assert.equal(host.querySelector('.fi-match-status').textContent, 'LIVE');
  assert.ok(host.querySelector('[role="log"]'));
  const view = await mount(MatchCard, { ...card, status: 'FULL TIME', statusLive: false, result, archived: true }, context);
  assert.ok(view.host.querySelector('.fi-match--archived details.fi-match-report'));
  assert.equal(view.host.querySelector('.fi-match-heading h2').textContent, 'Round 27');
});

test('no React warnings or errors were logged while rendering', () => {
  assert.deepEqual(consoleErrors, []);
});
