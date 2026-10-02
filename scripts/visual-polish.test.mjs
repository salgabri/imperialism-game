import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act, useState } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { selectLineup } from '../src/data/teams.js';

const compiled = await build({
  stdin: { contents: `
    export {default as MatchCard} from './src/components/MatchCard.jsx';
    export {default as Sidebar} from './src/components/Sidebar.jsx';
    export {default as PlaybackBar} from './src/components/PlaybackBar.jsx';
  `, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
  loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { MatchCard, Sidebar, PlaybackBar } = module.exports;
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
after(() => dom.window.close());

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

const match = {
  round: '003', status: 'Q4', statusLive: true,
  a: { id: '840', teamId: 'b-milwaukee-bucks', isClub: true, code: 'MBU', name: 'Milwaukee Bucks', eff: '86.2', score: 123 },
  b: { id: null, teamId: 'b-los-angeles-lakers', isClub: true, code: 'LAL', name: 'Los Angeles Lakers', eff: '84.0', score: 101 },
  events: [{ when: 'Q4 07:12', text: 'MBU finishes a seven-point run', color: '#297a55' }],
};

test('club squad links use campaign IDs and archived links preserve eliminated team IDs', async context => {
  const selected = [];
  const view = await mount(MatchCard, { ...match, onSelectTeam: id => selected.push(id) }, context);
  await act(async () => view.host.querySelector('[aria-label="View Milwaukee Bucks squad"]').click());
  await act(async () => view.host.querySelector('[aria-label="View Los Angeles Lakers squad"]').click());
  assert.deepEqual(selected, ['b-milwaukee-bucks', 'b-los-angeles-lakers']);

  // Older archive entries keep campaign IDs at the fixture level, rather than in flag artwork.
  await view.render({ ...match, archived: true, statusLive: false, status: 'FT',
    a: { ...match.a, teamId: undefined }, b: { ...match.b, teamId: undefined },
    aId: match.a.teamId, dId: match.b.teamId, onSelectTeam: id => selected.push(id),
  });
  await act(async () => view.host.querySelector('[aria-label="View Los Angeles Lakers squad"]').click());
  assert.equal(selected.at(-1), 'b-los-angeles-lakers');

  await view.render({ ...match, a: { ...match.a, teamId: undefined }, b: { ...match.b, teamId: undefined }, onSelectTeam: id => selected.push(id) });
  assert.equal(view.host.querySelector('button'), null, 'A flag ID alone must never become a squad destination');
});

test('full time retains supplied events in an expandable report and preserves basketball scores', async context => {
  const eventsRef = React.createRef();
  const view = await mount(MatchCard, { ...match, eventsRef }, context);
  assert.equal(eventsRef.current, view.host.querySelector('[role="log"]'));
  assert.match(eventsRef.current.textContent, /MBU finishes a seven-point run/);
  assert.equal(view.host.querySelector('details'), null);

  await view.render({ ...match, eventsRef, status: 'FT', statusLive: false, result: { title: 'Milwaukee Bucks wins the series game' } });
  assert.equal(eventsRef.current, null);
  assert.equal(view.host.querySelector('[role="log"]'), null);
  assert.equal(view.host.querySelector('[role="group"]').getAttribute('aria-label'), 'Milwaukee Bucks 123, Los Angeles Lakers 101');
  assert.equal(view.host.querySelector('.fi-score-number').textContent, '123–101');
  const report = view.host.querySelector('details');
  assert.equal(report.open, false);
  await act(async () => report.querySelector('summary').click());
  assert.equal(report.open, true);
  const eventRegion = report.querySelector('[aria-label="Completed match events"]');
  assert.match(eventRegion.textContent, /Q4 07:12/);
  assert.match(eventRegion.textContent, /MBU finishes a seven-point run/);
});

test('an acquired player opens the winner squad while keeping replacement and zero-gain information', async context => {
  const selected = [];
  const view = await mount(MatchCard, { ...match, status: 'FT', statusLive: false,
    result: { winnerId: match.a.teamId, winnerName: match.a.name, loserName: match.b.name,
      territories: 1, player: { name: 'Reserve Shooter', pos: 'SG', rating: 90 },
      replacedPlayer: { name: 'Previous Starter' }, strengthBefore: 86.2, strengthAfter: 86.2, strengthGain: 0,
    }, onSelectTeam: id => selected.push(id),
  }, context);
  await act(async () => view.host.querySelector('[aria-label="View Reserve Shooter in Milwaukee Bucks squad"]').click());
  assert.deepEqual(selected, [match.a.teamId]);
  assert.match(view.host.textContent, /replaces Previous Starter in the lineup/);
  assert.match(view.host.querySelector('[data-testid="match-strength-gain"]').textContent, /No change/);
});

const players = [
  { name: 'Emergency Guard', pos: 'SG', rating: 92 },
  { name: 'Starting Shooter', pos: 'SG', rating: 93 },
  { name: 'Starting Wing', pos: 'SF', rating: 83 },
  { name: 'Starting Forward', pos: 'PF', rating: 82 },
  { name: 'Starting Center', pos: 'C', rating: 81 },
  { name: 'Reserve Shooter', pos: 'SG', rating: 90, from: 'LAL' },
];
const lineup = selectLineup({ sport: 'basketball', squad: players });
const squad = { teamId: match.a.teamId, id: null, isClub: true, code: match.a.code, name: match.a.name,
  status: 'ALIVE', eff: lineup.rating.toFixed(1), avg: '86.8', territories: 2, conquests: 1, stolen: 1,
  players, starters: lineup.starters, bench: lineup.bench, lineupRating: lineup.rating,
};
const power = [{ tid: match.b.teamId, name: match.b.name, rank: 1, territories: 1, eff: '84.0' },
  { tid: squad.teamId, name: squad.name, rank: 2, territories: 2, eff: squad.eff }];

test('selecting a standings team focuses its dossier and Escape restores that team button', async context => {
  function CampaignDetails() {
    const [tab, setTab] = useState('power');
    const [selectedTeamId, setSelectedTeamId] = useState(null);
    return React.createElement(Sidebar, { tab, onTab: setTab, power,
      squad: selectedTeamId === squad.teamId ? squad : null, selectedTeamId,
      onSelectTeam: id => { setSelectedTeamId(id); setTab('squad'); },
    });
  }
  const view = await mount(CampaignDetails, {}, context);
  await act(async () => view.host.querySelector(`[data-team-id="${squad.teamId}"]`).click());
  assert.equal(document.activeElement, view.host.querySelector('[role="tabpanel"]'));
  assert.equal(document.activeElement.id, 'intel-panel-squad');
  await act(async () => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(document.activeElement.dataset.teamId, squad.teamId);
  assert.equal(document.activeElement.getAttribute('aria-current'), 'true');
  assert.equal(view.host.querySelector('[aria-selected="true"]').textContent, 'Standings');
});

test('squad groups the actual legal lineup, shows emergency assignments and retains acquired depth', async context => {
  const view = await mount(Sidebar, { tab: 'squad', squad,
    history: [{ round: 3, winnerId: squad.teamId, aId: squad.teamId, a: match.a, b: match.b,
      result: { player: players.at(-1), strengthGain: 0, strengthBefore: lineup.rating, strengthAfter: lineup.rating } }],
  }, context);
  const starterNames = [...view.host.querySelectorAll('.is-starter .fi-player-identity > span')].map(item => item.textContent).sort();
  assert.deepEqual(starterNames, lineup.starters.map(player => player.name).sort());
  const depthNames = [...view.host.querySelectorAll('.is-depth .fi-player-identity > span')].map(item => item.textContent);
  assert.deepEqual(depthNames, lineup.bench.map(player => player.name));
  assert.deepEqual(depthNames, ['Reserve Shooter'], 'A high reserve rating must not replace a legal positional starter');
  const pointGuards = view.host.querySelector('[aria-label="Point guards"]');
  const emergencyStarter = lineup.starters.find(player => player.assignedPos === 'PG');
  assert.ok(pointGuards.textContent.includes(emergencyStarter.name));
  assert.match(pointGuards.textContent, /Natural SG · out of position/);
  assert.equal(pointGuards.querySelector('.fi-player-position').textContent, 'PG');
  assert.equal(pointGuards.querySelector('.fi-player-rating').textContent, String(emergencyStarter.effectiveRating));
  const acquisition = view.host.querySelector('[aria-label="Latest acquisition"]');
  assert.match(acquisition.textContent, /Reserve Shooter/);
  assert.match(acquisition.textContent, /From Los Angeles Lakers/);
  assert.match(acquisition.textContent, /Available in squad depth/);
  assert.match(acquisition.textContent, /No change/);
});

test('manual pause offers a match resume, autoplay announces its state, and unavailable steps cannot fire', async context => {
  let stepped = 0, played = 0, resumed = 0;
  const props = { speed: 1, autoplay: false, live: true, onStep: () => stepped++, onPlay: () => played++, onPause: () => resumed++ };
  const view = await mount(PlaybackBar, props, context);
  const step = () => view.host.querySelector('.playback-step');
  assert.equal(step().disabled, false);
  await act(async () => step().click());
  assert.equal(stepped, 1);
  await view.render({ ...props, paused: true });
  assert.equal(view.host.querySelector('[role="status"]').textContent, 'Paused');
  assert.equal(step().disabled, true);
  await act(async () => step().click());
  assert.equal(stepped, 1);
  await act(async () => view.host.querySelector('[aria-label="Resume this match"]').click());
  assert.equal(resumed, 1);
  assert.equal(played, 0, 'Resuming a manual match must not start campaign autoplay');
  await view.render({ ...props, autoplay: true });
  const autoplay = view.host.querySelector('.playback-play');
  assert.equal(autoplay.getAttribute('aria-pressed'), 'true');
  assert.equal(autoplay.textContent, 'Pause');
  await act(async () => autoplay.click());
  assert.equal(played, 1);
  await view.render({ ...props, live: false, completed: true });
  assert.equal(view.host.querySelector('[role="status"]').textContent, 'Completed');
  assert.ok([...view.host.querySelectorAll('button')].every(button => button.disabled));
});
