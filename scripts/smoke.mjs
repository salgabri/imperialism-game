// Headless smoke test: boots the real app under jsdom, plays a campaign to a
// champion, and asserts the invariants that matter (land conserved, one survivor,
// spoils collected). Run with `npm run smoke`.

import { readFile, readdir, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'node_modules', '.smoke');

const SCENARIOS = [
  { name: 'South America · duel · ticker', scope: 'CONMEBOL', pacing: 'duel', resolution: 'ticker' },
  { name: 'South America · blitz · instant', scope: 'CONMEBOL', pacing: 'blitz', resolution: 'instant' },
  { name: 'N. & C. America · chaos · instant', scope: 'CONCACAF', pacing: 'chaos', resolution: 'instant' },
];

async function bundle() {
  await mkdir(outDir, { recursive: true });
  const outfile = path.join(outDir, 'entry.mjs');
  await build({
    entryPoints: [path.join(root, 'scripts', 'smoke.entry.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile,
    jsx: 'automatic',
    logLevel: 'silent',
    define: {
      'import.meta.env.BASE_URL': '"/"',
      'process.env.NODE_ENV': '"development"',
    },
  });
  return outfile;
}

async function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const mapJson = await readFile(path.join(root, 'public', 'world-110m.v1.json'), 'utf8');

  // The app fetches the topology relative to BASE_URL; serve it from disk.
  window.fetch = async () => ({ ok: true, status: 200, json: async () => JSON.parse(mapJson) });

  const keys = ['window', 'document', 'navigator', 'localStorage', 'fetch', 'requestAnimationFrame', 'cancelAnimationFrame', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'MouseEvent', 'getComputedStyle'];
  for (const key of keys) {
    // Node 24 defines some of these as getter-only on globalThis.
    Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  return dom;
}

/** Report a failure without tripping the console-warning gate below. */
function fail(msg) {
  process.stderr.write(msg + '\n');
}

function check(label, ok, detail) {
  if (!ok) throw new Error(`FAILED: ${label}${detail ? ' — ' + detail : ''}`);
  console.log(`    ok  ${label}`);
}

// React reports invalid props, missing keys and render crashes through console;
// treat any of it as a failure rather than letting it scroll past.
const consoleIssues = [];
for (const level of ['error', 'warn']) {
  const original = console[level];
  console[level] = (...args) => {
    const msg = args.map(String).join(' ');
    if (!/act\(\)/.test(msg)) consoleIssues.push(`${level}: ${msg.slice(0, 300)}`);
    original.call(console, ...args);
  };
}

const entry = await bundle();
let failures = 0;

// Capitals anchor every marker on the map, and a bad id silently reverts a
// nation to its centroid, so check the resolution rate rather than trusting it.
{
  const { WorldGeometry } = await import('../src/engine/geo.js');
  const { CAPITALS } = await import('../src/data/capitals.js');
  const { NATIONS, DEPENDENCIES } = await import('../src/data/teams.js');
  console.log('\n  Capitals and dependencies');
  try {
    const topo = JSON.parse(await readFile(path.join(root, 'public', 'world-110m.v1.json'), 'utf8'));
    const geo = new WorldGeometry(topo, CAPITALS).fitTo(Object.keys(NATIONS));
    const ids = Object.keys(NATIONS);
    const anchored = ids.filter(id => geo.capitals[id]);
    const unknown = Object.keys(CAPITALS).filter(id => !NATIONS[id] && !DEPENDENCIES[id]);
    const badDeps = Object.entries(DEPENDENCIES).filter(([shape, d]) => !NATIONS[d.of] || !geo.paths[shape]);

    check('every nation has capital coordinates', ids.every(id => CAPITALS[id]), 'missing entries');
    check('no capital points at an unknown shape', unknown.length === 0, unknown.join(', '));
    check('most capitals sit inside their country', anchored.length >= 160, `${anchored.length}/${ids.length}`);
    check('dependencies name a real nation and shape', badDeps.length === 0, badDeps.map(([s]) => s).join(', '));
    console.log(`    ${anchored.length}/${ids.length} anchored on their capital, rest on the centroid`);
  } catch (e) {
    failures++;
    fail(`    ${e.message}`);
  }
}

// Rosters are generated from a dataset that is not committed, so verify the
// committed output still builds a legal XI for every nation on the map.
{
  const { NATIONS, SQUAD_SIZE, buildTeam, makeRng, teamEff } = await import('../src/data/teams.js');
  const { ROSTERS } = await import('../src/data/rosters.js');
  console.log('\n  Squad rosters');
  try {
    const rng = makeRng(20260802);
    const ids = Object.keys(NATIONS);
    const teams = ids.map(id => buildTeam(id, rng));
    const realPlayers = teams.reduce((s, t) => s + t.real, 0);
    const fullyReal = teams.filter(t => t.real >= SQUAD_SIZE).length;
    const strays = Object.keys(ROSTERS).filter(id => !NATIONS[id]);
    const overCap = teams.flatMap(t => t.squad).filter(p => p.rating > 99 || p.rating < 1);
    const ranked = teams.map(t => ({ n: t.name, e: teamEff(t) })).sort((a, b) => b.e - a.e);

    check('every nation fields a full XI', teams.every(t => t.squad.length === SQUAD_SIZE), 'short squad');
    check('no roster for an unknown nation', strays.length === 0, strays.join(', '));
    check('every rating is within 1-99', overCap.length === 0, `${overCap.length} outside range`);
    check('every squad has a keeper', teams.every(t => t.squad.some(p => p.pos === 'GK')), 'missing GK');
    check('most of the world is real players', realPlayers / (teams.length * SQUAD_SIZE) > 0.6, `${realPlayers}`);
    check('the strongest nations look right', ['France', 'Spain', 'England', 'Brazil'].every(n => ranked.slice(0, 6).some(r => r.n === n)), ranked.slice(0, 6).map(r => r.n).join(', '));
    console.log(`    ${fullyReal}/${ids.length} nations field a fully real XI · ${realPlayers}/${teams.length * SQUAD_SIZE} players real (${(100 * realPlayers / (teams.length * SQUAD_SIZE)).toFixed(0)}%)`);
    console.log(`    strongest: ${ranked.slice(0, 6).map(r => `${r.n} ${r.e}`).join(', ')}`);
  } catch (e) {
    failures++;
    fail(`    ${e.message}`);
  }
}

// Flag assets are vendored, so a stale map would 404 silently in the browser.
{
  const { FLAG_CODES } = await import('../src/data/flags.js');
  const { NATIONS } = await import('../src/data/teams.js');
  console.log('\n  Flag assets');
  try {
    const onDisk = new Set((await readdir(path.join(root, 'public', 'flags'))).map(f => path.basename(f, '.svg')));
    const unmapped = Object.keys(NATIONS).filter(id => !FLAG_CODES[id]);
    const absent = [...new Set(Object.values(FLAG_CODES))].filter(code => !onDisk.has(code));
    check('every nation maps to a flag', unmapped.length === 0, unmapped.join(', '));
    check('every mapped flag is vendored', absent.length === 0, absent.join(', '));
    console.log(`    ${Object.keys(FLAG_CODES).length} nations → ${onDisk.size} flag files`);
  } catch (e) {
    failures++;
    fail(`    ${e.message}`);
  }
}

for (const scenario of SCENARIOS) {
  const dom = await installDom();
  console.log(`\n  ${scenario.name}`);
  try {
    // Fresh module instance per scenario so component state cannot leak.
    const mod = await import(`${new URL('file://' + entry.replace(/\\/g, '/'))}?v=${Math.random()}`);
    const r = await mod.run(scenario);

    console.log(
      `    ${r.fielded} nations · ${r.rounds} rounds · ${r.matches} matches · champion ${r.champion} ` +
      `(${r.territoriesHeld}/${r.totalTerritories} territories, ${r.championConquests} conquests, ${r.stolenPlayers} players taken)`,
    );
    console.log(`    rendered: ${r.seen.join(', ')}`);

    check('map decoded all shapes', r.nations > 150, `${r.nations}`);
    check('theatre fielded a full bracket', r.fielded > 1, `${r.fielded}`);
    check('every match eliminated exactly one nation', r.fallen === r.fielded - 1, `${r.fallen} fallen of ${r.fielded}`);
    check('every match was won by someone', r.conquestsAllTeams === r.matches, `${r.conquestsAllTeams} vs ${r.matches}`);
    check('champion holds the entire map', r.territoriesHeld === r.totalTerritories, `${r.territoriesHeld}/${r.totalTerritories}`);
    check('one player changed shirts per match', r.stealsAllTeams === r.matches, `${r.stealsAllTeams} vs ${r.matches} matches`);
    check('champion took a player per conquest', r.stolenPlayers === r.championConquests, `${r.stolenPlayers} vs ${r.championConquests}`);
    check('squad grew by the spoils', r.championSquad === 11 + r.championConquests, `${r.championSquad}`);
    check('every held territory flies a flag', r.flagFills === r.totalTerritories, `${r.flagFills} fills vs ${r.totalTerritories} territories`);
    check('one flag pattern per territory', r.flagPatterns === r.totalTerritories, `${r.flagPatterns}`);
    check('conquered land flies the conqueror’s flag', r.patternsFlyingChampionFlag === r.territoriesHeld, `${r.patternsFlyingChampionFlag} of ${r.territoriesHeld}`);
    check('victory screen rendered', r.victoryScreen);
    check('campaign autosaved', r.saveWritten);
    check('feed logged the war', r.logEntries > r.matches);
    check('match card appeared', r.seen.includes('match-card'));
    check('all three tabs rendered', Object.values(r.tabs).every(n => n > 0), JSON.stringify(r.tabs));
    if (scenario.pacing === 'duel') check('spinner ran', r.seen.includes('spinner'));
  } catch (e) {
    failures++;
    fail(`    ${e.message}`);
  } finally {
    dom.window.close();
  }
}

// World scope + autosave/reload
{
  const dom = await installDom();
  console.log('\n  World war · blitz · instant — interrupt and reload');
  try {
    const mod = await import(`${new URL('file://' + entry.replace(/\\/g, '/'))}?v=${Math.random()}`);
    const r = await mod.runResumeCheck();
    console.log(
      `    ${r.fielded} nations fielded · paused at round ${r.before.round} ` +
      `(${r.before.matches} matches, ${r.before.alive} alive) · reloaded at round ${r.after.round}`,
    );
    check('whole world fielded', r.fielded === 170, `${r.fielded}`);
    check('Greenland starts out Danish', r.greenlandStartsDanish, `owner ${r.greenlandAlwaysHeld}`);
    check('zoom in reframes the map', r.viewBoxZoomed !== r.viewBoxAtRest, r.viewBoxZoomed);
    check('zoom out clamps back to the world', r.viewBoxClamped === '0 0 960 540', r.viewBoxClamped);
    check('war reduced the field', r.before.alive < r.fielded, `${r.before.alive} of ${r.fielded}`);
    check('reload offered the saved campaign', r.offeredResume);
    check('round restored', r.after.round === r.before.round, `${r.after.round} vs ${r.before.round}`);
    check('survivors restored', r.after.alive === r.before.alive, `${r.after.alive} vs ${r.before.alive}`);
    check('match count restored', r.after.matches === r.before.matches, `${r.after.matches} vs ${r.before.matches}`);
    check('map ownership restored', r.after.ownedByFirstAlive === r.before.ownedByFirstAlive, `${r.after.ownedByFirstAlive} vs ${r.before.ownedByFirstAlive}`);
    check('campaign playable after reload', r.playableAfterResume);
  } catch (e) {
    failures++;
    fail(`    ${e.message}`);
  } finally {
    dom.window.close();
  }
}

await rm(outDir, { recursive: true, force: true });

if (consoleIssues.length) {
  failures++;
  fail(`\n  ${consoleIssues.length} console error(s)/warning(s) during render:`);
  for (const issue of [...new Set(consoleIssues)].slice(0, 10)) fail(`    ${issue}`);
}

console.log(failures ? `\n${failures} check group(s) failed\n` : '\nAll scenarios passed, no console warnings\n');
process.exit(failures ? 1 : 0);
