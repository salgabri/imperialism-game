// Bundled by scripts/smoke.mjs and executed under jsdom. Runs a whole campaign
// through the real component tree and reports what the UI actually rendered.
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import { FLAG_CODES } from '../src/data/flags.js';

const text = () => document.getElementById('root').textContent;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function until(label, predicate, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

function mount() {
  let app = null;
  const root = createRoot(document.getElementById('root'));
  root.render(<App ref={el => { app = el; }} />);
  return { root, get app() { return app; } };
}

/**
 * Full-world campaign, interrupted partway and reloaded from the autosave —
 * the path a player actually takes across sessions.
 */
export async function runResumeCheck() {
  const first = mount();
  await until('setup screen', () => text().includes('LAUNCH CAMPAIGN'));

  first.app.setState({ setup: { scope: 'world', pacing: 'blitz', resolution: 'instant' } });
  await sleep(50);
  first.app.startCampaign();
  await until('campaign running', () => first.app.state.phase === 'playing');

  const fielded = first.app.state.aliveIds.length;
  first.app.setState({ speed: 4 });
  first.app.togglePlay();

  await until('several rounds fought', () => first.app.state.round >= 3 && first.app.state.matches >= 40, 180000);
  first.app.togglePlay();
  await until('match settled', () => !first.app.state.match || first.app.state.match.applied);
  await sleep(400);

  const before = {
    round: first.app.state.round,
    alive: first.app.state.aliveIds.length,
    matches: first.app.state.matches,
    ownedByFirstAlive: Object.values(first.app.state.own).filter(o => o === first.app.state.aliveIds[0]).length,
    firstAlive: first.app.state.aliveIds[0],
  };
  first.root.unmount();
  await sleep(100);

  // Fresh mount, same localStorage: this is the reload.
  const second = mount();
  await until('setup screen again', () => text().includes('LAUNCH CAMPAIGN'));
  const offeredResume = second.app.state.hasSave && text().includes('SAVED CAMPAIGN');
  second.app.resume();
  await until('resumed', () => second.app.state.phase === 'playing');
  await sleep(200);

  const after = {
    round: second.app.state.round,
    alive: second.app.state.aliveIds.length,
    matches: second.app.state.matches,
    ownedByFirstAlive: Object.values(second.app.state.own).filter(o => o === before.firstAlive).length,
  };

  // The resumed campaign must still be playable.
  second.app.setState({ speed: 4 });
  second.app.step();
  await until('resumed campaign fights on', () => second.app.state.matches > after.matches || second.app.state.spin, 60000);
  const playableAfterResume = second.app.state.matches > after.matches || !!second.app.state.spin;
  second.root.unmount();

  return { fielded, offeredResume, before, after, playableAfterResume };
}

export async function run({ scope, pacing, resolution }) {
  const seen = new Set();
  let app = null;
  createRoot(document.getElementById('root')).render(
    <App ref={el => { app = el; }} />,
  );

  await until('map + setup screen', () => text().includes('LAUNCH CAMPAIGN'));
  const nations = app.geo.countries.length;

  app.setState({ setup: { scope, pacing, resolution } });
  await sleep(50);
  app.startCampaign();
  await until('campaign running', () => app.state.phase === 'playing');

  const fielded = app.state.aliveIds.length;
  app.setState({ speed: 4 });
  app.togglePlay();

  // Sample the UI while the war runs so transient screens are actually exercised.
  const sampler = setInterval(() => {
    const t = text();
    for (const marker of ['VS', 'ANNEXES', 'PLAYER CLAIMED', 'KICK-OFF', 'PENALTIES', 'UPSET ALERT', 'LARGEST EMPIRE']) {
      if (t.includes(marker)) seen.add(marker);
    }
    if (app.state.match) seen.add('match-card');
    if (app.state.spin) seen.add('spinner');
    if (app.state.atk) seen.add('attack-vector');
  }, 40);

  await until('a champion', () => app.state.phase === 'victory', 120000);
  clearInterval(sampler);
  await sleep(200);

  const champion = app.state.teams[app.state.aliveIds[0]];
  const owned = Object.values(app.state.own).filter(o => o === champion.id).length;
  // Every held territory must fly a flag, and it must be its owner's.
  const patterns = [...document.querySelectorAll('pattern[id^="fi-flag-"]')];
  const championFlag = new Set(
    patterns
      .filter(p => p.querySelector('image').getAttribute('href').endsWith(FLAG_CODES[champion.id] + '.svg'))
      .map(p => p.id),
  );
  const flagFills = [...document.querySelectorAll('path[fill^="url(#fi-flag-"]')].length;
  const championConquests = app.state.stats[champion.id].conq;
  // Across the whole field, one player changes shirts per match played.
  const stealsAllTeams = Object.values(app.state.stats).reduce((n, s) => n + s.steals.length, 0);
  const conquestsAllTeams = Object.values(app.state.stats).reduce((n, s) => n + s.conq, 0);

  // Every tab must render without throwing.
  const tabs = {};
  for (const tab of ['feed', 'power', 'squad']) {
    app.setState({ tab, selected: champion.id });
    await sleep(60);
    tabs[tab] = text().length;
  }

  return {
    nations,
    fielded,
    rounds: app.state.round,
    matches: app.state.matches,
    fallen: app.state.fallen.length,
    champion: champion.name,
    championSquad: champion.squad.length,
    championConquests,
    stolenPlayers: champion.squad.filter(p => p.from).length,
    stealsAllTeams,
    conquestsAllTeams,
    territoriesHeld: owned,
    totalTerritories: Object.keys(app.state.own).length,
    flagPatterns: patterns.length,
    flagFills,
    patternsFlyingChampionFlag: championFlag.size,
    logEntries: app.state.log.length,
    victoryScreen: text().includes('CAMPAIGN COMPLETE'),
    saveWritten: !!localStorage.getItem('football_imperialism_v1'),
    seen: [...seen].sort(),
    tabs,
  };
}
