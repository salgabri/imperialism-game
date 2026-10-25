// Owner: WP-SQUAD (see PLAN.md §4, §5.2). buildSquad / provenanceOf (C§16, DEC D8/D9) and the SquadScreen render.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const compiled = await build({
  stdin: { contents: `
    export { default as SquadScreen } from './src/screens/squad/SquadScreen.jsx';
    export { buildSquad, provenanceOf, profileSegments, sourceLabel, sourceTitle, sourceUrl, strengthProfile } from './src/viewModels/squad.js';
    export { selectLineup, teamEff } from './src/data/teams.js';
    export { flagUrl } from './src/data/flags.js';
  `, resolveDir: root, loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom'],
  loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { SquadScreen, buildSquad, provenanceOf, profileSegments, sourceLabel, sourceTitle, sourceUrl, strengthProfile, selectLineup, teamEff,
  flagUrl } = module.exports;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
after(() => dom.window.close());

async function mount(props, context) {
  const host = document.createElement('div');
  document.body.append(host);
  const reactRoot = createRoot(host);
  const errors = [];
  const original = console.error;
  console.error = (...args) => { errors.push(args.join(' ')); };
  const view = {
    host, errors,
    async render(next) { await act(async () => reactRoot.render(React.createElement(SquadScreen, next))); },
    async close() { await act(async () => reactRoot.unmount()); host.remove(); console.error = original; },
  };
  context.after(() => view.close());
  await view.render(props);
  return view;
}
const click = async element => act(async () => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
const key = async (element, name) => act(async () => element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true })));
const text = element => element?.textContent ?? null;
const texts = (scope, selector) => [...scope.querySelectorAll(selector)].map(element => element.textContent);

const ea = edition => ({ source: 'ea-fc', edition });
// Board C1 (seed 2033, Italy managed): 11 starters + 4 depth, 4 claimed in conquest.
function italy() {
  return {
    id: '380', name: 'Italy', code: 'ITA', flagId: '380', kind: 'nation', col: '#52A7E0', sport: 'football',
    squad: [
      { name: 'G. Donnarumma', pos: 'GK', rating: 89, sourceInfo: ea('EA FC 26') },
      { name: 'A. Bastoni', pos: 'DF', rating: 87, sourceInfo: ea('EA FC 26') },
      { name: 'F. Dimarco', pos: 'DF', positions: ['DF', 'MF'], rating: 85, sourceInfo: ea('EA FC 26') },
      { name: 'F. Acerbi', pos: 'DF', rating: 84, sourceInfo: ea('EA FC 26') },
      { name: 'N. Barella', pos: 'MF', rating: 87, sourceInfo: ea('EA FC 26') },
      { name: 'S. Tonali', pos: 'MF', rating: 86, sourceInfo: ea('EA FC 26') },
      { name: 'M. Locatelli', pos: 'MF', rating: 84, sourceInfo: ea('EA FC 26') },
      { name: 'M. Zaccagni', pos: 'MF', positions: ['MF', 'FW'], rating: 84, sourceInfo: ea('EA FC 26') },
      { name: 'M. Kean', pos: 'FW', rating: 83, sourceInfo: { source: 'football-manager', edition: 'FM 26' } },
      { name: 'G. Di Lorenzo', pos: 'DF', positions: ['DF', 'MF'], rating: 83, sourceInfo: ea('EA FC 26') },
      { name: 'G. Mancini', pos: 'DF', rating: 83, sourceInfo: ea('26') },
      { name: 'J. Oblak', pos: 'GK', rating: 88, sourceInfo: ea('EA FC 26'), from: 'SVN', fromId: '705', joined: 17, claimGain: 0 },
      { name: 'J. Gvardiol', pos: 'DF', positions: ['DF', 'MF'], rating: 84, sourceInfo: ea('EA FC 26'), from: 'CRO', fromId: '191', joined: 20, claimGain: .1 },
      { name: 'S. Savić', pos: 'DF', rating: 79, sourceInfo: ea('EA FC 26'), from: 'MNE', fromId: '499', joined: 24, claimGain: 0 },
      { name: 'S. Milinković-Savić', pos: 'MF', rating: 84, sourceInfo: ea('EA FC 26'), from: 'SRB', fromId: '688', joined: 27, claimGain: .1 },
    ],
  };
}
const nation = (id, name, code) => ({ id, name, code, flagId: id, kind: 'nation', squad: [] });
function campaign(overrides = {}) {
  const team = italy();
  team.baseEff = teamEff(team) - .2;
  return {
    teams: { 380: team, 191: nation('191', 'Croatia', 'CRO'), 688: nation('688', 'Serbia', 'SRB'),
      499: nation('499', 'Montenegro', 'MNE'), 705: nation('705', 'Slovenia', 'SVN') },
    aliveIds: ['380'], fallen: [{ id: '191', r: 20 }, { id: '688', r: 27 }], history: [], stats: {}, round: 27,
    followedId: null, squadReturn: null, ...overrides,
  };
}
const managerCtx = (extra = {}) => ({ managedId: '380', followedId: null, sport: { id: 'football' }, cache: new Map(), ...extra });

test('buildSquad reproduces board C1: kicker, XI, groups, table cells, depth, pitch, profile and claims', () => {
  const st = campaign();
  const model = buildSquad(st, managerCtx(), '380');
  assert.equal(model.teamId, '380');
  assert.equal(model.name, 'Italy');
  assert.equal(model.kicker, 'First team · 15 players · 4 claimed in conquest');
  assert.equal(model.phoneMeta, '15 players · 4 claimed in conquest');
  assert.deepEqual(model.xi, { label: 'Starting XI', short: 'XI', value: selectLineup(st.teams[380]).rating.toFixed(1), delta: '+0.2', tone: 'gain' });
  assert.equal(model.claimedCount, 4);
  assert.deepEqual(model.groups.map(group => group.label), ['Goalkeeper', 'Defence', 'Midfield', 'Attack']);
  const rows = model.groups.flatMap(group => group.rows);
  assert.deepEqual(rows.map(row => row.no), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
  assert.deepEqual(rows.map(row => row.name).sort(), ['A. Bastoni', 'F. Acerbi', 'F. Dimarco', 'G. Donnarumma', 'J. Gvardiol', 'M. Kean',
    'M. Locatelli', 'M. Zaccagni', 'N. Barella', 'S. Milinković-Savić', 'S. Tonali'], 'the board C1 starting XI');
  assert.deepEqual(rows.slice(5, 7).map(row => row.name), ['N. Barella', 'S. Tonali']);
  const byName = Object.fromEntries(rows.map(row => [row.name, row]));
  assert.equal(rows[0].name, 'G. Donnarumma');
  assert.deepEqual(rows.slice(1, 5).map(row => row.pos), ['DF', 'DF', 'DF', 'DF']);
  assert.deepEqual(rows.slice(1, 3).map(row => row.name), ['A. Bastoni', 'F. Dimarco'], 'ties broken by base rating, descending');
  assert.equal(byName['F. Dimarco'].natural, 'DF / MF');
  assert.equal(byName['M. Zaccagni'].pos, 'FW');
  assert.equal(byName['M. Zaccagni'].natural, 'MF / FW');
  assert.equal(byName['M. Zaccagni'].inRole, '84');
  assert.equal(byName['M. Zaccagni'].outOfPosition, false);
  assert.equal(byName['G. Donnarumma'].tier, '88');
  assert.equal(byName['A. Bastoni'].tier, '84');
  assert.equal(byName['M. Kean'].tier, '80');
  assert.equal(byName['M. Kean'].source, 'FM 26');
  assert.equal(byName['A. Bastoni'].source, 'EA FC 26');
  assert.equal(byName['A. Bastoni'].acquired, null);
  assert.deepEqual(byName['J. Gvardiol'].acquired, { flagId: '191', teamId: '191', isClub: false, code: 'CRO', roman: 'R XX', label: 'CRO · R XX' });
  assert.equal(byName['S. Milinković-Savić'].acquired.label, 'SRB · R XXVII');

  assert.deepEqual(model.depth.rows.map(row => [row.no, row.pos, row.name, row.inRole]),
    [['—', 'GK', 'J. Oblak', '—'], ['—', 'DF', 'G. Di Lorenzo', '—'], ['—', 'DF', 'G. Mancini', '—'], ['—', 'DF', 'S. Savić', '—']]);
  assert.equal(model.depth.more, null, 'no "+ N more" with four in depth');
  assert.equal(model.depth.rows[2].source, 'EA FC 26', 'a numeric edition gets its source prefix');
  assert.equal(model.depth.rows[3].tier, '75');
  assert.equal(model.depth.rows[3].acquired.label, 'MNE · R XXIV');
  assert.equal(model.showSource, true);

  assert.equal(model.formation, '4-4-2');
  assert.equal(model.formationAside, '4-4-2 · ● claimed');
  assert.equal(model.formationTitle, 'Formation');
  assert.equal(model.viewLabel, 'Pitch');
  assert.equal(model.pitchLabel, 'Formation 4-4-2');
  assert.deepEqual(model.depth.rows.map(row => row.short), ['Oblak', 'Di Lorenzo', 'Mancini', 'Savić'], 'chips use surnames');
  assert.equal(model.pitch.length, 11);
  const disc = Object.fromEntries(model.pitch.map(slot => [slot.name, slot]));
  assert.deepEqual([disc.Donnarumma.x, disc.Donnarumma.y], ['50%', '88%']);
  assert.deepEqual([disc.Bastoni.x, disc.Bastoni.y], ['13%', '69%']);
  assert.deepEqual([disc.Dimarco.x, disc.Dimarco.y], ['37%', '72%']);
  assert.deepEqual([disc.Zaccagni.x, disc.Zaccagni.y, disc.Kean.x], ['36%', '20%', '64%']);
  assert.equal(disc['Milinković-Savić'].claimed, true);
  assert.equal(disc.Gvardiol.claimed, true);
  assert.equal(disc.Barella.claimed, false);

  assert.deepEqual(model.profile.map(row => [row.label, row.value, row.segments]),
    [['Attack', '84.3', 7], ['Defence', '86.0', 7], ['Goalkeeping', '89.0', 8]]);
  assert.equal(model.profileScale, 'Scale 60–95');
  assert.deepEqual(model.claimed.map(row => [row.roman, row.name, row.fromName, row.gain, row.tone]), [
    ['R XXVII', 'S. Milinković-Savić', 'Serbia', '+0.1', 'gain'],
    ['R XXIV', 'S. Savić', 'Montenegro', '±0.0', 'muted'],
    ['R XX', 'J. Gvardiol', 'Croatia', '+0.1', 'gain'],
  ]);
  assert.equal(model.acquisitions.rows.length, 4);
  assert.equal(model.acquisitions.aside, '4 players · 2 of 11 starters were claimed in conquest');
  assert.deepEqual(model.acquisitions.rows.map(row => row.status), ['Starter', 'Depth', 'Starter', 'Depth']);
  assert.equal(model.status, 'alive');
  assert.equal(model.canFollow, false, 'managers do not follow');
  assert.equal(model.back, null);
  assert.equal(model.home, null);
  assert.deepEqual(model.notes, []);
});

test('segments follow the 60–95 mapping and the strength profile matches the sport engines', () => {
  assert.equal(profileSegments(84.3), 7);
  assert.equal(profileSegments(86.0), 7);
  assert.equal(profileSegments(89.0), 8);
  assert.equal(profileSegments(61.4), 0);
  assert.equal(profileSegments(95), 10);
  assert.equal(profileSegments(120), 10);
  assert.equal(profileSegments(Number.NaN), 0);
  const lineup = selectLineup(italy());
  const means = position => {
    const slots = lineup.slots.filter(slot => slot.position === position);
    return slots.reduce((sum, slot) => sum + slot.effectiveRating, 0) / slots.length;
  };
  const attack = .56 * means('FW') + .36 * means('MF') + .08 * means('DF');
  assert.equal(strengthProfile(lineup, 'football')[0].value, attack.toFixed(1));
});

test('depth shows the first five by position, "+ N more" only beyond five, and unfilled places get a note', () => {
  const st = campaign();
  const team = st.teams[380];
  for (let i = 0; i < 2; i++) team.squad.push({ name: `Reserve ${i}`, pos: 'FW', rating: 70 + i });
  const model = buildSquad(st, managerCtx(), '380');
  assert.equal(model.depth.count, 6);
  assert.equal(model.depth.rows.length, 5);
  assert.equal(model.depth.more, '+ 1 more in depth');
  assert.deepEqual(model.depth.rows.map(row => row.pos), ['GK', 'DF', 'DF', 'DF', 'FW'], 'byPos order, not the best five');
  assert.equal(model.depth.extra.length, 1);
  assert.equal(model.depth.extra[0].source, '—');

  const short = { id: 'x', name: 'Short', code: 'SHO', kind: 'nation', flagId: null, sport: 'football',
    squad: [{ name: 'A Keeper', pos: 'GK', rating: 70 }, { name: 'B Back', pos: 'DF', rating: 71 }] };
  const thin = buildSquad({ teams: { x: short }, aliveIds: ['x'] }, { cache: new Map() }, 'x');
  assert.deepEqual(thin.notes, ['Source data covers 2 of 11 starting places. Unfilled places use a 40-point team-strength baseline.']);
  assert.equal(thin.kicker, 'First team · 2 players · 0 claimed in conquest');
  assert.equal(thin.xi.delta, '±0.0', 'teams without baseEff read as unchanged');
  assert.equal(thin.xi.tone, 'muted');
  assert.equal(thin.depth.more, null);
  assert.equal(thin.showSource, false);
});

test('provenance falls back to history for older saves, then to the team code', () => {
  const st = campaign();
  const team = st.teams[380];
  const old = { name: 'L. Modrić', pos: 'MF', rating: 86, from: 'CRO' };
  team.squad.push(old);
  st.history = [
    { id: 'match-3', round: '009', aId: '380', dId: '688', winnerId: '380',
      a: { teamId: '380', id: '380', code: 'ITA', name: 'Italy' }, b: { teamId: '688', id: '688', code: 'SRB', name: 'Serbia' },
      result: { winnerId: '380', loserId: '688', player: { name: 'L. Modrić', pos: 'MF', rating: 86 }, strengthGain: .9 } },
    { id: 'match-7', round: '012', aId: '191', dId: '380', winnerId: '380',
      a: { teamId: '191', id: '191', code: 'CRO', name: 'Croatia' }, b: { teamId: '380', id: '380', code: 'ITA', name: 'Italy' },
      result: { winnerId: '380', loserId: '191', loserName: 'Croatia', player: { name: 'L. Modrić', pos: 'MF', rating: 86 },
        strengthGain: .4, replacedPlayer: { name: 'M. Locatelli' } } },
  ];
  const prov = provenanceOf(old, st, '380');
  assert.deepEqual({ ...prov }, { fromId: '191', from: 'CRO', fromName: 'Croatia', flagId: '191', isClub: false,
    joined: 12, claimGain: .4, replaced: 'M. Locatelli' }, 'the SRB entry does not match a CRO claim');
  const model = buildSquad(st, managerCtx(), '380');
  const claim = model.acquisitions.rows.find(row => row.name === 'L. Modrić');
  assert.equal(claim.roman, 'R XII');
  assert.equal(claim.gain, '+0.4');
  const row = model.groups.flatMap(group => group.rows).concat(model.depth.all).find(item => item.name === 'L. Modrić');
  assert.equal(row.acquired.label, 'CRO · R XII');
  if (claim.status === 'Starter') assert.equal(claim.detail, 'Starts ahead of M. Locatelli');

  const noHistory = provenanceOf({ name: 'Somebody', pos: 'DF', rating: 70, from: 'MNE' }, { teams: st.teams, history: [] });
  assert.equal(noHistory.fromId, '499');
  assert.equal(noHistory.fromName, 'Montenegro');
  assert.equal(noHistory.joined, null, 'the round stays hidden without data');
  assert.equal(noHistory.claimGain, null);
  assert.equal(provenanceOf({ name: 'Home grown', pos: 'DF', rating: 70 }, st), null);
  assert.equal(provenanceOf(null, st), null);
  const stored = provenanceOf({ name: 'X', pos: 'DF', rating: 70, from: 'CRO', fromId: '191', joined: 3, claimGain: 1.2 }, { teams: {} });
  assert.deepEqual([stored.fromId, stored.from, stored.joined, stored.claimGain], ['191', 'CRO', 3, 1.2]);
});

test('basketball: groups, court slots, Offence/Defence profile, "Starting five" copy and the out-of-position marker', () => {
  const players = [
    { name: 'Emergency Guard', pos: 'SG', rating: 92 },
    { name: 'Starting Shooter', pos: 'SG', rating: 93 },
    { name: 'Starting Wing', pos: 'SF', rating: 83 },
    { name: 'Starting Forward', pos: 'PF', rating: 82 },
    { name: 'Starting Center', pos: 'C', rating: 81 },
    { name: 'Reserve Shooter', pos: 'SG', rating: 90, from: 'LAL', gen: true },
  ];
  const team = { id: 'b-mil', name: 'Milwaukee Bucks', code: 'MIL', kind: 'club', flagId: null, col: '#2f6', sport: 'basketball', squad: players };
  const lakers = { id: 'b-lal', name: 'Los Angeles Lakers', code: 'LAL', kind: 'club', flagId: null, sport: 'basketball', squad: [] };
  const model = buildSquad({ teams: { 'b-mil': team, 'b-lal': lakers }, aliveIds: ['b-mil'], followedId: 'b-mil', squadReturn: 'ledger' },
    { managedId: null, sport: { id: 'basketball' }, cache: new Map() }, 'b-mil');
  assert.equal(model.sport, 'basketball');
  assert.equal(model.layout, 'court');
  assert.deepEqual(model.groups.map(group => group.label), ['Guards', 'Forwards', 'Centres']);
  const guards = model.groups[0].rows;
  assert.deepEqual(guards.map(row => row.pos), ['PG', 'SG']);
  const emergency = selectLineup(team).starters.find(player => player.assignedPos === 'PG');
  assert.equal(guards[0].name, emergency.name);
  assert.equal(guards[0].inRole, String(emergency.rating - 12));
  assert.equal(guards[0].outOfPosition, true);
  assert.equal(guards[0].natural, 'SG');
  assert.equal(guards[0].rating, emergency.rating);
  assert.equal(model.xi.label, 'Starting five');
  assert.equal(model.xi.short, 'Five');
  assert.equal(model.formation, 'Starting five');
  assert.equal(model.formationTitle, 'Starting five');
  assert.equal(model.formationAside, '● claimed', 'no "Starting five" repeated under its own kicker');
  assert.equal(model.viewLabel, 'Court');
  assert.equal(model.pitchLabel, 'Court, starting five');
  assert.deepEqual(model.pitch.map(slot => [slot.pos, slot.x, slot.y]),
    [['PG', '50%', '82%'], ['SG', '20%', '62%'], ['SF', '80%', '62%'], ['PF', '30%', '30%'], ['C', '70%', '30%']]);
  assert.deepEqual(model.profile.map(row => row.label), ['Offence', 'Defence']);
  const lineup = selectLineup(team);
  const offence = lineup.slots.reduce((sum, slot) => sum + slot.effectiveRating * { PG: .25, SG: .25, SF: .2, PF: .15, C: .15 }[slot.position], 0);
  assert.equal(model.profile[0].value, offence.toFixed(1));
  assert.equal(model.depth.rows[0].generated, true);
  assert.equal(model.depth.rows[0].acquired.label, 'LAL');
  assert.equal(model.depth.rows[0].acquired.isClub, true);
  assert.equal(model.showSource, false, 'basketball rosters carry no source column');
  assert.equal(model.team.isClub, true);
  assert.equal(model.canFollow, true);
  assert.equal(model.following, true);
  assert.deepEqual(model.back, { label: 'Back to standings' });
});

test('buildSquad is pure, memoised and tolerant of empty states', () => {
  const st = campaign({ squadReturn: 'chronicle' });
  const before = JSON.stringify(st);
  const cache = new Map();
  const ctx = managerCtx({ cache, managedId: '191' });
  const first = buildSquad(st, ctx, '380');
  assert.equal(JSON.stringify(st), before, 'state is not mutated');
  assert.equal(buildSquad(st, ctx, '380'), first, 'memoised on state identities');
  assert.ok([...cache.keys()].every(key => key.startsWith('squad:')));
  assert.deepEqual(first.back, { label: 'Back to history' });
  assert.deepEqual(first.home, { teamId: '191', label: 'Your squad' });
  assert.equal(buildSquad(st, ctx, 'missing'), null);
  assert.equal(buildSquad({ teams: {}, aliveIds: [] }, null, null), null);
  assert.equal(buildSquad(undefined, undefined, '380'), null);
  const loose = buildSquad({ teams: { 380: italy() } }, undefined, '380');
  assert.equal(loose.status, 'alive');
  assert.equal(loose.claimed.length, 3);
  const fallen = buildSquad({ ...st, aliveIds: [], fallen: [{ id: '380', r: 12 }] }, managerCtx(), '380');
  assert.equal(fallen.status, 'fallen');
  assert.equal(fallen.statusLabel, 'Eliminated · Round XII');
  assert.equal(sourceLabel({ sourceInfo: { source: 'ea-fc' } }), 'EA FC');
  assert.equal(sourceLabel({}), '—');
});

test('SquadScreen renders the C1 list, header, summary column and phone list', async context => {
  const st = campaign({ squadReturn: 'map' });
  const model = buildSquad(st, managerCtx({ managedId: null }), '380');
  const calls = { back: 0, follow: [], select: [] };
  const view = await mount({ ...model, onBack: () => calls.back++, onFollow: id => calls.follow.push(id), onSelectTeam: id => calls.select.push(id) }, context);
  const section = view.host.querySelector('#view-panel-squad');
  assert.ok(section);
  assert.equal(section.getAttribute('aria-labelledby'), 'view-tab-squad');
  assert.equal(section.getAttribute('tabindex'), '-1');
  assert.ok(section.classList.contains('screen') && section.classList.contains('screen--squad'));
  assert.equal(section.getAttribute('role'), null, 'a screen, not a dialog');

  const head = section.querySelector('.squad-head');
  assert.equal(text(head.querySelector('.squad-head__kicker')), 'First team · 15 players · 4 claimed in conquest');
  assert.equal(text(head.querySelector('h1')), 'Italy');
  assert.ok(flagUrl('380'));
  assert.equal(head.querySelector('.squad-head__flag img')?.getAttribute('src'), flagUrl('380'));
  assert.ok(head.querySelector('.squad-head__flag > img.flag-chip'), 'the header renders TeamMark\'s own chip, no squad wrapper ring');
  assert.equal(head.querySelector('.squad-head__flag').classList.contains('squad-flag'), false);
  assert.deepEqual(texts(head, '.squad-tab'), ['List', 'Pitch', 'Acquisitions']);
  assert.equal(head.querySelector('[role=tab][aria-selected=true]').textContent, 'List');
  assert.deepEqual(texts(head, '.squad-head__label'), ['Starting XI', 'Claimed']);
  assert.equal(text(head.querySelector('.squad-head__value')), `${model.xi.value} +0.2`);
  assert.ok(head.querySelector('.squad-head__delta').classList.contains('tone-gain'));
  assert.equal(text(head.querySelector('.squad-head__value--claimed')), '4');

  const table = section.querySelector('.squad-main .squad-table');
  assert.equal(table.getAttribute('role'), 'table');
  assert.deepEqual(texts(table, '.squad-table__head [role=columnheader]'), ['No', 'Pos', 'Player', 'Natural', 'In role', 'Rtg', 'Acquired', 'Source']);
  assert.deepEqual(texts(table, '.squad-group'), ['Goalkeeper', 'Defence', 'Midfield', 'Attack']);
  assert.deepEqual([...table.querySelectorAll('.squad-group [role=rowheader]')].map(cell => cell.getAttribute('aria-colspan')), ['8', '8', '8', '8']);
  const rows = [...table.querySelectorAll('.squad-row')];
  assert.equal(rows.length, 11);
  const first = rows[0];
  assert.deepEqual([...first.children].map(cell => cell.textContent), ['1', 'GK', 'G. Donnarumma', 'GK', '89', '89', '', 'EA FC 26']);
  assert.equal(first.querySelector('.rating-box').dataset.tier, '88');
  const gvardiol = rows.find(row => row.textContent.includes('Gvardiol'));
  assert.equal(text(gvardiol.querySelector('.squad-row__acq')), 'CRO · R XX');
  assert.ok(gvardiol.querySelector('.squad-row__acq .squad-flag'));
  const depth = section.querySelector('.squad-main .squad-depth');
  assert.equal(text(depth.querySelector('.kicker__title')), 'Squad depth');
  assert.equal(depth.querySelector('.squad-depth__more'), null);
  assert.deepEqual([...depth.querySelectorAll('.squad-row')].map(row => row.children[0].textContent + row.children[2].textContent),
    ['—J. Oblak', '—G. Di Lorenzo', '—G. Mancini', '—S. Savić']);
  const depthHead = depth.querySelector('[role=table] > .squad-table__head');
  assert.ok(depthHead?.classList.contains('sr-only'), 'the depth table names its columns for screen readers');
  assert.equal(depthHead.querySelectorAll('[role=columnheader]').length, 8);

  const side = section.querySelector('.squad-side');
  assert.deepEqual(texts(side, '.kicker__title'), ['Formation', 'Strength profile', 'Claimed in conquest']);
  assert.deepEqual(texts(side, '.kicker__aside'), ['4-4-2 · ● claimed', 'Scale 60–95', 'Gain']);
  const pitch = side.querySelector('.pitch.pitch--side');
  assert.equal(pitch.querySelectorAll('.pitch__player').length, 11);
  assert.equal(pitch.querySelectorAll('.pitch__player.is-claimed').length, 2);
  const donnarumma = [...pitch.querySelectorAll('.pitch__player')].find(item => item.textContent.includes('Donnarumma'));
  assert.equal(donnarumma.style.left, '50%');
  assert.equal(donnarumma.style.top, '88%');
  assert.equal(text(donnarumma.querySelector('.pitch__dot')), '89');
  const profileRows = [...side.querySelectorAll('.profile__row')];
  assert.deepEqual(profileRows.map(row => [row.querySelector('.profile__label').textContent, row.querySelectorAll('.profile__seg').length,
    row.querySelectorAll('.profile__seg.is-filled').length, row.querySelector('.profile__value').textContent]),
  [['Attack', 10, 7, '84.3'], ['Defence', 10, 7, '86.0'], ['Goalkeeping', 10, 8, '89.0']]);
  assert.equal(profileRows[0].querySelector('[role=meter]').getAttribute('aria-valuetext'), '84.3');
  const claims = [...side.querySelectorAll('.claimed-row')];
  assert.deepEqual(claims.map(row => row.querySelector('.claimed-row__round').textContent), ['R XXVII', 'R XXIV', 'R XX']);
  assert.equal(text(claims[0].querySelector('.claimed-row__name')), 'S. Milinković-Savić · Serbia');
  assert.ok(claims[1].querySelector('.claimed-row__gain').classList.contains('tone-muted'));
  assert.equal(text(claims[1].querySelector('.claimed-row__gain')), '±0.0');

  const phone = section.querySelector('.squad-phone');
  assert.deepEqual(texts(section, '.squad-seg > button'), ['List', 'Pitch']);
  assert.deepEqual(texts(phone, '.squad-plist__head'), ['Goalkeeper', 'Defence', 'Midfield', 'Attack', 'Squad depth']);
  const phoneGvardiol = [...phone.querySelectorAll('.squad-prow')].find(row => row.textContent.includes('Gvardiol'));
  assert.equal(text(phoneGvardiol.querySelector('.squad-prow__meta')), 'DF / MF · from CRO R XX');
  assert.equal(phoneGvardiol.querySelector('.squad-prow__rating').dataset.tier, '84');
  assert.equal(text(section.querySelector('.squad-mhead__xi')), `XI ${model.xi.value}`);
  assert.equal(text(section.querySelector('.squad-mhead__meta')), '15 players · 4 claimed in conquest');

  assert.equal(section.querySelector(':scope > .squad-tools'), null, 'no tools row above the header (C1 height kept)');
  assert.ok(head.querySelector(':scope > .squad-tools .fi-squad-back'), 'desktop tools sit inside the header');
  const phoneTools = section.querySelector('.squad-mhead__line > .squad-tools');
  assert.ok(phoneTools, 'phone tools sit on the meta line');
  assert.equal(phoneTools.querySelector('.fi-squad-back').getAttribute('aria-label'), 'Back to map');
  assert.equal(phoneTools.querySelector('.fi-squad-back').textContent, '', 'phone Back is icon-only');
  assert.equal(phoneTools.querySelector('.fi-follow-team').textContent, 'Follow');
  assert.equal(phoneTools.querySelector('.fi-follow-team').getAttribute('aria-label'), 'Follow this team');
  const back = section.querySelector('.fi-squad-back');
  assert.equal(back.textContent, 'Back to map');
  await click(back);
  assert.equal(calls.back, 1);
  const follow = section.querySelector('.fi-follow-team');
  assert.equal(follow.textContent, 'Follow this team');
  assert.equal(follow.getAttribute('aria-pressed'), 'false');
  await click(follow);
  assert.deepEqual(calls.follow, ['380']);
  await key(section.querySelector('.squad-row'), 'Escape');
  assert.equal(calls.back, 2, 'Escape returns to the origin');
  assert.deepEqual(view.errors, []);
});

test('SquadScreen tabs: Pitch moves the pitch to the main column, Acquisitions lists every claim; phone segments', async context => {
  const st = campaign();
  const model = buildSquad(st, managerCtx({ managedId: '191' }), '380');
  const calls = [];
  const view = await mount({ ...model, onBack: () => {}, onSelectTeam: id => calls.push(id) }, context);
  const section = view.host.querySelector('#view-panel-squad');
  assert.equal(section.querySelector('.fi-squad-back'), null, 'no back button without an origin');
  assert.equal(section.querySelector('.fi-follow-team'), null, 'managers do not follow');
  await click(section.querySelector('.squad-tools__home'));
  assert.deepEqual(calls, ['191']);

  const tabs = [...section.querySelectorAll('.squad-tab')];
  await click(tabs[1]);
  assert.equal(section.dataset.tab, 'pitch');
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  assert.equal(section.querySelector('#squad-tabpanel').getAttribute('aria-labelledby'), 'squad-tab-pitch');
  assert.ok(section.querySelector('.squad-main .pitch.pitch--large'));
  assert.equal(section.querySelector('.squad-side .squad-formation'), null, 'no duplicate formation block');
  assert.deepEqual(texts(section, '.squad-side .kicker__title'), ['Strength profile', 'Claimed in conquest']);
  assert.deepEqual(texts(section, '.squad-main .squad-chip'), ['GK · Oblak · 88', 'DF · Di Lorenzo · 83', 'DF · Mancini · 83', 'DF · Savić · 79']);
  assert.equal(section.querySelector('.squad-main .squad-chip').getAttribute('title'), 'J. Oblak');
  const large = section.querySelector('.squad-main .squad-formation--large');
  assert.deepEqual([text(large.querySelector('.kicker__title')), text(large.querySelector('.kicker__aside'))], ['Formation', '4-4-2 · ● claimed'],
    'the large pitch keeps its legend');
  assert.equal(large.querySelector('.pitch').getAttribute('aria-label'), 'Formation 4-4-2');
  assert.deepEqual(texts(section, '.squad-phone .squad-formation--phone .kicker > span'), ['Formation', '4-4-2 · ● claimed']);
  assert.ok(section.querySelector('.squad-phone .pitch.pitch--phone'), 'the phone Pitch segment follows the tab');
  assert.equal(section.querySelector('.squad-seg > button[aria-pressed=true]').textContent, 'Pitch');

  await key(tabs[1], 'ArrowRight');
  assert.equal(section.dataset.tab, 'acquisitions');
  assert.equal(document.activeElement, tabs[2]);
  const acq = section.querySelector('.squad-main .squad-acq');
  assert.equal(text(acq.querySelector('.kicker__aside')), '4 players · 2 of 11 starters were claimed in conquest');
  assert.deepEqual(texts(acq, '.squad-acq__head [role=columnheader]'), ['Round', 'Former team flag', 'Player', 'Pos', 'Rtg', 'From', 'Gain', 'Status']);
  assert.deepEqual([...acq.querySelectorAll('.squad-acq__row')].map(row => [row.querySelector('.squad-acq__round').textContent,
    row.querySelector('.squad-acq__name').textContent, row.querySelector('.squad-acq__from').textContent, row.querySelector('.squad-acq__status').textContent]), [
    ['R XXVII', 'S. Milinković-Savić', 'Serbia', 'Starter'], ['R XXIV', 'S. Savić', 'Montenegro', 'Depth'],
    ['R XX', 'J. Gvardiol', 'Croatia', 'Starter'], ['R XVII', 'J. Oblak', 'Slovenia', 'Depth']]);
  assert.deepEqual(texts(section, '.squad-side .kicker__title'), ['Formation', 'Strength profile']);
  assert.equal(section.querySelector('.squad-seg > button[aria-pressed=true]').textContent, 'List', 'phone falls back to List');

  await key(tabs[2], 'Home');
  assert.equal(section.dataset.tab, 'list');
  await click(section.querySelectorAll('.squad-seg > button')[1]);
  assert.equal(section.dataset.tab, 'pitch');
  assert.deepEqual(view.errors, []);
});

test('SquadScreen expands deep benches, marks generated players without italics and tolerates an empty model', async context => {
  const st = campaign();
  for (let i = 0; i < 3; i++) st.teams[380].squad.push({ name: `Generated ${i}`, pos: 'FW', rating: 60 + i, gen: true });
  const model = buildSquad(st, managerCtx(), '380');
  assert.equal(model.depth.more, '+ 2 more in depth');
  const view = await mount({ ...model, onBack: () => {} }, context);
  const depth = view.host.querySelector('.squad-main .squad-depth');
  assert.equal(depth.querySelectorAll('.squad-row').length, 5);
  const more = depth.querySelector('.squad-depth__more');
  assert.equal(more.textContent, '+ 2 more in depth');
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  await click(more);
  assert.equal(depth.querySelectorAll('.squad-row').length, 7);
  assert.equal(more.textContent, 'Show fewer');
  const generated = [...depth.querySelectorAll('.squad-row')].find(row => row.textContent.includes('Generated 2'));
  assert.equal(text(generated.querySelector('.squad-tag')), 'Generated');
  assert.equal(text(generated.querySelector('.squad-row__src')), '—');
  assert.equal(text(generated.querySelector('.squad-row__label')), 'Generated 2', 'no asterisk suffix');
  const phoneGenerated = [...view.host.querySelectorAll('.squad-prow')].find(row => row.textContent.includes('Generated 2'));
  assert.equal(text(phoneGenerated.querySelector('.squad-prow__meta')), 'FW · Generated');
  for (const file of ['src/screens/squad/squad.css', 'src/components/player-row.css']) {
    assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), /font-style:\s*italic|monospace|(?<![-\w])serif\b|Alegreya|Consolas/i);
  }

  await view.render({ legacySquad: null, history: [], positionColors: {}, onBack: () => {} });
  const empty = view.host.querySelector('#view-panel-squad');
  assert.equal(empty.dataset.empty, 'true');
  assert.match(empty.textContent, /Select a team on the map or in the standings to inspect its squad\./);
  const emptyBack = empty.querySelector('.fi-squad-back');
  assert.equal(emptyBack?.textContent, 'Back to map', 'the empty state keeps a way back');
  await view.render({});
  assert.equal(view.host.querySelector('#view-panel-squad .fi-squad-back'), null, 'no Back without onBack');
  assert.deepEqual(view.errors, []);
});

test('out-of-position starters show ↓ in role on desktop and a note on phone', async context => {
  const players = [
    { name: 'Emergency Guard', pos: 'SG', rating: 92 }, { name: 'Starting Shooter', pos: 'SG', rating: 93 },
    { name: 'Starting Wing', pos: 'SF', rating: 83 }, { name: 'Starting Forward', pos: 'PF', rating: 82 },
    { name: 'Starting Center', pos: 'C', rating: 81 },
  ];
  const team = { id: 'b', name: 'Bravo', code: 'BRA', kind: 'club', flagId: null, sport: 'basketball', squad: players };
  const model = buildSquad({ teams: { b: team }, aliveIds: ['b'] }, { sport: { id: 'basketball' }, cache: new Map() }, 'b');
  const view = await mount(model, context);
  const emergency = selectLineup(team).starters.find(player => player.assignedPos === 'PG');
  const row = [...view.host.querySelectorAll('.squad-main .squad-row')].find(item => item.textContent.includes(emergency.name));
  assert.equal(text(row.querySelector('.squad-row__pos')), 'PG');
  assert.equal(text(row.querySelector('.squad-row__role')), `${emergency.rating - 12} ↓ out of position`);
  assert.equal(text(row.querySelector('.squad-row__oop')), ' ↓');
  assert.equal(row.querySelector('.squad-row__oop').getAttribute('aria-hidden'), 'true');
  assert.equal(view.host.querySelector('.squad-main .squad-table').dataset.source, 'false');
  assert.equal(row.querySelectorAll('[role=cell]').length, 7, 'no Source cell for basketball');
  assert.ok(view.host.querySelector('.squad-side .pitch.pitch--court .pitch__hoop'));
  assert.deepEqual(texts(view.host, '.squad-head__label'), ['Starting five', 'Claimed']);
  const phoneRow = [...view.host.querySelectorAll('.squad-prow')].find(item => item.textContent.includes(emergency.name));
  assert.equal(text(phoneRow.querySelector('.squad-prow__meta')), 'SG · out of position');
  assert.equal(text(view.host.querySelector('.squad-mhead__xi')), `Five ${model.xi.value}`);
  assert.ok(view.host.querySelector('.squad-head__flag > .fi-team-monogram'), 'clubs show their monogram chip');
  assert.deepEqual(texts(view.host, '.squad-tab'), ['List', 'Court', 'Acquisitions']);
  assert.deepEqual(texts(view.host, '.squad-seg > button'), ['List', 'Court']);
  const formation = view.host.querySelector('.squad-side .squad-formation');
  assert.deepEqual([text(formation.querySelector('.kicker__title')), text(formation.querySelector('.kicker__aside'))], ['Starting five', '● claimed']);
  assert.equal(formation.querySelector('.pitch').getAttribute('aria-label'), 'Court, starting five');
  assert.equal(view.host.querySelector('.squad-group [role=rowheader]').getAttribute('aria-colspan'), '7');
  assert.deepEqual(view.errors, []);
});

test('basketball: Natural lists both positions and a starter at his second one pays no penalty', async context => {
  const players = [
    { name: 'Point Guard', pos: 'PG', rating: 90 }, { name: 'Combo Guard', pos: 'PG', positions: ['PG', 'SG'], rating: 88 },
    { name: 'Starting Wing', pos: 'SF', positions: ['SF', 'PF'], rating: 83 },
    { name: 'Stretch Big', pos: 'PF', positions: ['PF', 'C'], rating: 82 }, { name: 'Starting Center', pos: 'C', rating: 81 },
  ];
  const team = { id: 'b', name: 'Bravo', code: 'BRA', kind: 'club', flagId: null, sport: 'basketball', squad: players };
  const model = buildSquad({ teams: { b: team }, aliveIds: ['b'] }, { sport: { id: 'basketball' }, cache: new Map() }, 'b');
  const combo = model.groups[0].rows.find(row => row.name === 'Combo Guard');
  assert.deepEqual([combo.pos, combo.natural, combo.inRole, combo.outOfPosition], ['SG', 'PG / SG', '88', false]);
  const view = await mount(model, context);
  const row = [...view.host.querySelectorAll('.squad-main .squad-row')].find(item => item.textContent.includes('Combo Guard'));
  assert.equal(text(row.querySelector('.squad-row__pos')), 'SG');
  assert.equal(text(row.querySelector('.squad-row__natural')), 'PG / SG');
  assert.equal(text(row.querySelector('.squad-row__role')), '88');
  assert.equal(row.querySelector('.squad-row__oop'), null);
  const phoneRow = [...view.host.querySelectorAll('.squad-prow')].find(item => item.textContent.includes('Combo Guard'));
  assert.equal(text(phoneRow.querySelector('.squad-prow__meta')), 'PG / SG');
  assert.deepEqual(view.errors, []);
});

test('Source cells keep the roster evidence: database title, sofifa / FM link (http only) and the full name', async context => {
  const st = campaign();
  const squad = st.teams[380].squad;
  squad[0] = { ...squad[0], sourceInfo: { source: 'ea-fc', edition: 'EA FC 26', fullName: 'Gianluigi Donnarumma', snapshotDate: '2025-09-19',
    version: '26.4', rawRating: 89, rawScale: 99, url: 'https://sofifa.com/player/230621/gianluigi-donnarumma/260004/' } };
  squad[8] = { ...squad[8], sourceInfo: { source: 'football-manager', edition: 'FM 26', rawRating: 152, rawScale: 'current ability',
    conversion: 'CA 152 → 83', url: 'javascript:alert(1)' } };
  assert.equal(sourceTitle(squad[0]), 'EA FC 26 · Database 26.4 · Database snapshot 2025-09-19 · Source rating 89/99');
  assert.equal(sourceTitle(squad[8]),
    'FM 26 · Source rating 152 (current ability scale) · Game rating converted from Football Manager current ability: CA 152 → 83');
  assert.equal(sourceTitle({ name: 'x' }), '');
  assert.equal(sourceUrl(squad[0]), squad[0].sourceInfo.url);
  assert.equal(sourceUrl(squad[8]), null, 'only http(s) links');
  const model = buildSquad(st, managerCtx(), '380');
  const rows = model.groups.flatMap(group => group.rows);
  const keeper = rows.find(row => row.name === 'G. Donnarumma');
  assert.equal(keeper.fullName, 'Gianluigi Donnarumma');
  assert.equal(rows.find(row => row.name === 'A. Bastoni').fullName, 'A. Bastoni', 'falls back to the display name');

  const view = await mount(model, context);
  const row = [...view.host.querySelectorAll('.squad-main .squad-row')].find(item => item.textContent.includes('Donnarumma'));
  assert.equal(row.querySelector('.squad-row__label').getAttribute('title'), 'Gianluigi Donnarumma');
  const cell = row.querySelector('.squad-row__src');
  assert.equal(cell.getAttribute('title'), keeper.sourceTitle);
  const link = cell.querySelector('a.squad-row__src-link');
  assert.equal(link.getAttribute('href'), squad[0].sourceInfo.url);
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(link.textContent, 'EA FC 26');
  assert.match(link.getAttribute('aria-label'), /^EA FC 26: view Gianluigi Donnarumma/);
  const kean = [...view.host.querySelectorAll('.squad-main .squad-row')].find(item => item.textContent.includes('Kean'));
  assert.equal(kean.querySelector('.squad-row__src a'), null, 'a non-http URL is never linked');
  assert.equal(text(kean.querySelector('.squad-row__src')), 'FM 26');
  assert.deepEqual(view.errors, []);
});

test('squad.css: touch targets, no WP-0 internals restyled, README pitch height kept on short viewports', () => {
  const css = readFileSync(new URL('../src/screens/squad/squad.css', import.meta.url), 'utf8');
  // The first top-level rule whose selector is exactly `selector` (declarations only).
  const rule = selector => {
    const at = css.indexOf(`\n${selector} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };
  assert.match(rule('.squad-tab'), /min-height:\s*var\(--tap\)/, 'tabs reach 44px on coarse pointers');
  assert.match(rule('.squad-tab'), /align-items:\s*flex-end/, 'the active bar stays on the header rule');
  assert.match(rule('.screen--squad .squad-depth__more::after'), /height:\s*var\(--tap\)/);
  assert.match(rule('.squad-tools .fi-context-button::after'), /height:\s*var\(--tap\)/);
  // Phone (C2): the icon-only Back's 12px chevron still gets a full --tap-wide target (the 44px phone rule).
  const phoneBack = css.match(/\n\s+\.squad-mhead \.squad-tools \.fi-squad-back::after \{([^}]*)\}/);
  assert.ok(phoneBack, 'the phone Back has its own hit-area rule');
  assert.match(phoneBack[1], /width:\s*max\([^;]*var\(--tap\)\)/, 'phone Back target is at least --tap wide');
  assert.doesNotMatch(css, /\.flag-chip|\.fi-team-monogram/, 'Flag / TeamMark internals belong to WP-0');
  assert.doesNotMatch(css, /max-height:\s*820px/, 'no short-viewport pitch shrink (README 330px)');
  assert.match(css, /--sq-pitch-h:\s*330px/);
  assert.match(rule('.pitch--large'), /height:\s*var\(--sq-pitch-large-h\)/);
  assert.doesNotMatch(rule('.pitch--large'), /width/, 'full column width (C§12)');
});

// (W3, WP-INT) Ported from visual-polish L139-160, which mounted the legacy Sidebar dossier (PlayerRow groups, the
// "Natural SG · out of position" note and the "Latest acquisition" card). Same fixture, asserted on SquadScreen.
test('ported Sidebar dossier: the legal lineup, the emergency assignment in role and the acquired reserve', async context => {
  const players = [
    { name: 'Emergency Guard', pos: 'SG', rating: 92 },
    { name: 'Starting Shooter', pos: 'SG', rating: 93 },
    { name: 'Starting Wing', pos: 'SF', rating: 83 },
    { name: 'Starting Forward', pos: 'PF', rating: 82 },
    { name: 'Starting Center', pos: 'C', rating: 81 },
    { name: 'Reserve Shooter', pos: 'SG', rating: 90, from: 'LAL' },
  ];
  const bucks = { id: 'b-milwaukee-bucks', name: 'Milwaukee Bucks', code: 'MBU', kind: 'club', flagId: null, sport: 'basketball', squad: players };
  const lineup = selectLineup(bucks);
  const a = { id: '840', teamId: bucks.id, isClub: true, code: 'MBU', name: 'Milwaukee Bucks', score: 123 };
  const b = { id: null, teamId: 'b-los-angeles-lakers', isClub: true, code: 'LAL', name: 'Los Angeles Lakers', score: 101 };
  // An older save: the reserve carries only `from`, so the round, former team and gain come from the history entry.
  const st = { teams: { [bucks.id]: bucks }, aliveIds: [bucks.id], history: [{ round: 3, winnerId: bucks.id, aId: bucks.id, a, b,
    result: { player: players.at(-1), strengthGain: 0, strengthBefore: lineup.rating, strengthAfter: lineup.rating } }] };
  const view = await mount(buildSquad(st, { sport: { id: 'basketball' }, cache: new Map() }, bucks.id), context);
  const main = view.host.querySelector('.squad-main');
  const labels = scope => texts(scope, '.squad-row .squad-row__label');
  assert.deepEqual(labels(main.querySelector('.squad-table:not(.squad-table--depth)')).sort(),
    lineup.starters.map(player => player.name).sort(), 'the table groups the actual legal lineup');
  assert.deepEqual(labels(main.querySelector('.squad-table--depth')), lineup.bench.map(player => player.name));
  assert.deepEqual(labels(main.querySelector('.squad-table--depth')), ['Reserve Shooter'],
    'A high reserve rating must not replace a legal positional starter');

  const emergency = lineup.starters.find(player => player.assignedPos === 'PG');
  const guards = [...main.querySelectorAll('.squad-table__group')].find(group => text(group.querySelector('.squad-group')) === 'Guards');
  const row = [...guards.querySelectorAll('.squad-row')].find(item => text(item.querySelector('.squad-row__label')) === emergency.name);
  assert.ok(row, 'the emergency point guard is listed with the guards');
  assert.ok(row.classList.contains('is-out-of-position'));
  assert.equal(text(row.querySelector('.squad-row__pos')), 'PG');
  assert.equal(text(row.querySelector('.squad-row__natural')), 'SG');
  assert.equal(text(row.querySelector('.squad-row__role')), `${Math.round(emergency.effectiveRating)} ↓ out of position`,
    'the in-role rating is the penalty-adjusted one');
  assert.equal(row.querySelector('.squad-row__role').getAttribute('title'), 'Out of position · natural SG');
  const phoneRow = [...view.host.querySelectorAll('.squad-prow')].find(item => text(item.querySelector('.squad-prow__name')) === emergency.name);
  assert.equal(text(phoneRow.querySelector('.squad-prow__meta')), 'SG · out of position');

  // The former "Latest acquisition" card: player, former team, round, depth role and the zero gain.
  const reserve = main.querySelector('.squad-table--depth .squad-row');
  assert.equal(text(reserve.querySelector('.squad-row__acq-label')), 'LAL · R III');
  const claims = [...view.host.querySelectorAll('.squad-side .claimed-row')];
  assert.equal(claims.length, 1);
  assert.equal(text(claims[0].querySelector('.claimed-row__name')), 'Reserve Shooter · Los Angeles Lakers');
  assert.equal(text(claims[0].querySelector('.claimed-row__round')), 'R III');
  assert.equal(text(claims[0].querySelector('.claimed-row__gain')), '±0.0');
  assert.ok(claims[0].querySelector('.claimed-row__gain').classList.contains('tone-muted'), 'no change reads muted');
  await click(view.host.querySelectorAll('.squad-tab')[2]);
  assert.deepEqual([...view.host.querySelectorAll('.squad-acq__row')].map(item => ['round', 'name', 'from', 'gain', 'status']
    .map(cell => text(item.querySelector(`.squad-acq__${cell}`)))), [['R III', 'Reserve Shooter', 'Los Angeles Lakers', '±0.0', 'Depth']]);
  assert.deepEqual(view.errors, []);
});
