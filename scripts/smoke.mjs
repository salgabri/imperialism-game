// Headless smoke test: boots the real app under jsdom, plays a campaign to a
// champion, and asserts the invariants that matter (land conserved, one survivor,
// spoils collected). Run with `npm run smoke`.

import { readFile, readdir, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { DOMESTIC } from '../src/data/domestic.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(root, 'public');
const outDir = path.join(root, 'node_modules', `.smoke-${process.pid}`);
const startedAt = Date.now();
// `--scenarios=<text>` runs only the campaign, resume, label and manager scenarios whose
// names contain the text (any case), skipping the fixed checks between them.
const scenarioFilter = process.argv.find(arg => arg.startsWith('--scenarios='))?.slice('--scenarios='.length).toLowerCase();
const fixedChecks = scenarioFilter == null;
const wanted = scenario => fixedChecks || scenario.name.toLowerCase().includes(scenarioFilter);
// A country campaign on its own map; the duel run also exercises the setup flow.
const ENGLAND = { layer: 'clubs', clubScope: 'domestic:826' };
// Fewer clubs than sections: each Fiji club starts on a group of islands and districts.
const FIJI = { layer: 'clubs', clubScope: 'domestic:242' };

const SCENARIOS = [
  { name: 'South America · duel · ticker', scope: 'CONMEBOL', pacing: 'duel', resolution: 'ticker' },
  { name: 'South America · blitz · instant', scope: 'CONMEBOL', pacing: 'blitz', resolution: 'instant' },
  { name: 'N. & C. America · chaos · instant', scope: 'CONCACAF', pacing: 'chaos', resolution: 'instant' },
  { name: 'BASKETBALL · South America · duel · ticker', sport: 'basketball', scope: 'CONMEBOL', pacing: 'duel', resolution: 'ticker' },
  { name: 'BASKETBALL · Europe · blitz · instant', sport: 'basketball', scope: 'UEFA', pacing: 'blitz', resolution: 'instant' },
  { name: 'CLUBS · Premier League · blitz · instant', layer: 'clubs', clubScope: 'Premier League', pacing: 'blitz', resolution: 'instant' },
  { name: 'CLUBS · NBA · chaos · instant', sport: 'basketball', layer: 'clubs', clubScope: 'NBA', pacing: 'chaos', resolution: 'instant' },
  { name: 'DOMESTIC · England top clubs · duel · instant', ...ENGLAND, pacing: 'duel', resolution: 'instant', setupChecks: true },
  { name: 'DOMESTIC · England top clubs · blitz · instant', ...ENGLAND, pacing: 'blitz', resolution: 'instant' },
  { name: 'DOMESTIC · Fiji top clubs · duel · instant', ...FIJI, pacing: 'duel', resolution: 'instant' },
];

const RESUME_SCENARIOS = [
  { name: 'World war · blitz · instant', scope: 'world', pacing: 'blitz', resolution: 'instant', expectedField: 170 },
  { name: 'BASKETBALL · South America · blitz · instant', sport: 'basketball', scope: 'CONMEBOL', pacing: 'blitz', resolution: 'instant' },
  { name: 'CLUBS · Premier League · blitz · instant', layer: 'clubs', clubScope: 'Premier League', pacing: 'blitz', resolution: 'instant' },
  { name: 'CLUBS · NBA · chaos · instant', sport: 'basketball', layer: 'clubs', clubScope: 'NBA', pacing: 'chaos', resolution: 'instant' },
  { name: 'DOMESTIC · England top clubs · duel · instant', ...ENGLAND, pacing: 'duel', resolution: 'instant', finish: true },
  { name: 'DOMESTIC · Fiji top clubs · chaos · instant', ...FIJI, pacing: 'chaos', resolution: 'instant', finish: true },
];

const LABEL_SCENARIOS = [
  { name: 'World nations', scope: 'world' },
  { name: 'European nations', scope: 'UEFA' },
  { name: 'Premier League clubs', layer: 'clubs', clubScope: 'Premier League' },
  { name: 'England top clubs on their own map', ...ENGLAND },
];

// The one manager campaign (PLAN §4.12 task 3): driven only through the primary action, under round robin × You choose.
const MANAGER_SCENARIOS = [
  { name: 'MANAGER · Italy · Europe · duel · ticker · round robin × You choose', sport: 'football', layer: 'nations', scope: 'UEFA',
    pacing: 'duel', resolution: 'ticker', team: '380' },
];

// Focused subsets: `--campaign-only=<i>` runs only SCENARIOS[i], `--resume-only=<i>` only RESUME_SCENARIOS[i] and
// `--manager-only` only the manager campaign; any of them skips every other section (together they run each pick).
// The country scenarios come last, so they are `--campaign-only=7` (England duel, with the setup checks), `=8`
// (England blitz), `=9` (Fiji duel) and `--resume-only=4` (England), `=5` (Fiji). `--scenarios=<text>` composes with
// these: it narrows whatever they leave.
function onlyIndex(name, list) {
  const arg = process.argv.find(value => value.startsWith(`--${name}=`));
  if (!arg) return null;
  const index = Number(arg.slice(name.length + 3));
  if (!Number.isInteger(index) || index < 0 || index >= list.length) {
    process.stderr.write(`--${name} expects an index from 0 to ${list.length - 1}\n`);
    process.exit(2);
  }
  return index;
}
const campaignOnly = onlyIndex('campaign-only', SCENARIOS);
const resumeOnly = onlyIndex('resume-only', RESUME_SCENARIOS);
const managerOnly = process.argv.includes('--manager-only');
const filtered = campaignOnly !== null || resumeOnly !== null || managerOnly;
const campaignScenarios = filtered ? (campaignOnly === null ? [] : [SCENARIOS[campaignOnly]]) : SCENARIOS;
const resumeScenarios = filtered ? (resumeOnly === null ? [] : [RESUME_SCENARIOS[resumeOnly]]) : RESUME_SCENARIOS;
const managerScenarios = filtered && !managerOnly ? [] : MANAGER_SCENARIOS;

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
    // jsdom exercises DOM/state, while browser QA verifies CSS and textures.
    loader: { '.css': 'empty' },
    plugins: [{
      name: 'count-empire-label-work-in-tests-only',
      setup(builder) {
        builder.onLoad({ filter: /[\\/]EmpireLabels\.jsx$/ }, async ({ path: sourcePath }) => {
          const source = await readFile(sourcePath, 'utf8');
          const instrumented = source.replace('import { createEmpireLabelEngine }', 'import { createEmpireLabelEngine as realCreateEmpireLabelEngine }');
          if (instrumented === source) throw new Error('EmpireLabels factory import changed; update smoke-only instrumentation');
          return { loader: 'jsx', contents: `${instrumented}\nfunction createEmpireLabelEngine(...args) {
            const engine = realCreateEmpireLabelEngine(...args);
            globalThis.__smokeEmpireLabelWork.engines++;
            const layout = engine.layout.bind(engine);
            return { ...engine, layout(...inputs) {
              globalThis.__smokeEmpireLabelWork.layouts++;
              const { curveRatio, coastalAllowancePx, maxSeaFraction } = inputs[0] || {};
              globalThis.__smokeEmpireLabelWork.policy = { curveRatio, coastalAllowancePx, maxSeaFraction };
              return layout(...inputs);
            } };
          }` };
        });
      },
    }],
    define: {
      'import.meta.env.BASE_URL': '"/"',
      'process.env.NODE_ENV': '"development"',
    },
  });
  return outfile;
}

const publicFiles = new Map();

/**
 * Serve public/ by URL path, as Vite does; anything else is a 404. A scenario
 * may delay or fail a path once (`globalThis.__smokeFetch`) to observe the
 * app's loading and error states; every request is recorded.
 */
async function serveStatic(url) {
  const plan = globalThis.__smokeFetch;
  let rel = null;
  try { rel = decodeURIComponent(new URL(String(url), 'http://localhost/').pathname).replace(/^\/+/, ''); } catch { /* malformed: 404 */ }
  if (rel != null) plan?.requests.push(rel);
  if (plan?.delays[rel]) await new Promise(resolve => setTimeout(resolve, plan.delays[rel]));
  const failed = !!plan?.failures.delete(rel);
  const file = rel == null ? null : path.resolve(publicDir, rel);
  let body = null;
  if (!failed && file?.startsWith(publicDir + path.sep)) {
    if (!publicFiles.has(file)) publicFiles.set(file, readFile(file, 'utf8').catch(() => null));
    body = await publicFiles.get(file);
  }
  const status = failed ? 503 : body == null ? 404 : 200;
  return {
    ok: status === 200, status, url: String(url),
    json: async () => { if (body == null) throw new SyntaxError(`HTTP ${status} for ${url}`); return JSON.parse(body); },
    text: async () => body ?? '',
  };
}

async function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  // jsdom has no layout engine; squad-panel scrolling still needs its DOM API.
  window.HTMLElement.prototype.scrollIntoView = () => {};

  // The app fetches relative to BASE_URL; serve the real files from disk.
  globalThis.__smokeFetch = { requests: [], delays: {}, failures: new Set() };
  window.fetch = serveStatic;

  const keys = ['window', 'document', 'navigator', 'localStorage', 'fetch', 'requestAnimationFrame', 'cancelAnimationFrame', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'MouseEvent', 'getComputedStyle'];
  for (const key of keys) {
    // Node 24 defines some of these as getter-only on globalThis.
    Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  globalThis.__smokeEmpireLabelWork = { engines: 0, layouts: 0 };
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

function checkFlagScope(label, snapshot, { conquered = false, continental = false } = {}) {
  check(`${label}: flags match campaign ownership`, snapshot.correct);
  check(`${label}: uninvolved land has neither flag fills nor flag patterns`, snapshot.neutralCount > 0 && snapshot.neutralHasNoFlags);
  if (continental) check(`${label}: out-of-theatre nations remain neutral`, snapshot.inactiveNations > 0);
  check(`${label}: dependencies follow their participating owner`, snapshot.dependenciesCorrect);
  if (conquered) check(`${label}: eliminated nations retain the conqueror's flag`, snapshot.conqueredCount > 0 && snapshot.conqueredKeepOwnerFlags);
  checkEmpireFlags(label, snapshot.empireFlags);
}

function checkEmpireFlags(label, snapshot) {
  check(`${label}: one shared banner with exact owner artwork per nearby land region`, snapshot.onePatternPerComponent && snapshot.oneBannerPerPattern && snapshot.sharedReferences,
    `${snapshot.patternCount} patterns for ${snapshot.componentCount} regions`);
  check(`${label}: each flag remains local and covers its region`, snapshot.localBounds && snapshot.coversEveryPolygon);
  check(`${label}: flag parts exactly cover owned countries with the right owner`, snapshot.correctOwner && snapshot.exactCountryCoverage);
  check(`${label}: only completely collapsed shapes may have no flag part`, snapshot.unpaintedOwnersHaveNoFillArea);
}

function checkEmpireLabels(label, snapshot) {
  check(`${label}: at most one label per current owner`, snapshot.onePerOwner && snapshot.onlyCurrentOwners);
  check(`${label}: nation names or club codes match live metadata`, snapshot.correctText && snapshot.currentMetadata);
  check(`${label}: labels stay within 9–20 screen pixels (own empire from 6.5) and the viewport`, snapshot.fontSizes && snapshot.withinViewport);
  check(`${label}: every name follows its valid unique quadratic text path`, snapshot.textPathsValid && snapshot.gentleArches);
  check(`${label}: coastal output respects the explicit 10px/22% UI policy`, snapshot.coastalPolicyValid && snapshot.uiPolicyEnabled);
  if (snapshot.geography) check(`${label}: owned anchor, no foreign land and tightly bounded sea spill`, snapshot.geography.valid, snapshot.geography.errors.join('; '));
}

function checkBackdrop(label, backdrop) {
  check(`${label}: neighbouring land is drawn beneath the sections`, backdrop.present && backdrop.drawn && backdrop.beneath && backdrop.ariaHidden,
    JSON.stringify(backdrop));
  check(`${label}: the backdrop is muted, inert and never a territory`, backdrop.muted && backdrop.inert && backdrop.notTerritory, JSON.stringify(backdrop));
}

/** A country map: every section held and, in Flags mode, painted in its club's colour with its crest when it has one. */
function checkDomesticMap(label, snapshot) {
  check(`${label}: in Flags mode every section shows its holder's club colour, with its crest when it has one, and no flag`, snapshot.correct);
  check(`${label}: every section is held, so no land is neutral`, snapshot.neutralCount === 0 && snapshot.sections === snapshot.expectedSections,
    `${snapshot.sections}/${snapshot.expectedSections} sections, ${snapshot.neutralCount} neutral`);
  checkEmpireFlags(label, snapshot.empireFlags);
  checkBackdrop(label, snapshot.backdrop);
}

function checkMapScope(label, snapshot, options) {
  if (snapshot.domestic) checkDomesticMap(label, snapshot);
  else checkFlagScope(label, snapshot, options);
}

/** Football clubs offer every shipped country, grouped apart from the leagues; nothing else does. */
function checkTheatres(scenario, theatre) {
  const countries = theatre.options.filter(option => option.value.startsWith('domestic:'));
  if (scenario.layer !== 'clubs' || (scenario.sport || 'football') !== 'football') {
    check('only football clubs offer single-country theatres', countries.length === 0, countries.map(option => option.text).join(', '));
    return;
  }
  const leagues = theatre.groups.find(group => group.label === 'European leagues');
  const domestic = theatre.groups.find(group => group.label === 'One country · top clubs');
  const expected = DOMESTIC.slice().sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => ({ value: `domestic:${entry.id}`, text: `${entry.name} · ${entry.clubs} clubs` }));
  check('existing club theatres are grouped as European leagues', JSON.stringify(leagues?.options.map(option => option.value)) === JSON.stringify(theatre.clubScopes),
    JSON.stringify(theatre.groups.map(group => group.label)));
  check('every shipped country is offered by name with its club count', JSON.stringify(domestic?.options) === JSON.stringify(expected),
    JSON.stringify(domestic?.options));
}

function checkDomesticSetup(setup, full) {
  check('the country map is fetched only once it is chosen', setup.lazy);
  check('a polite loading status holds Launch campaign while the map loads', setup.sawLoading);
  if (full) {
    check('a failed map load shows its message and Retry, with Launch campaign disabled', setup.errorShown);
    check('Retry loads the map', setup.retryLoaded);
    check('a session preset keeps the chosen country', setup.presetKeepsCountry);
    check('a session preset keeps the managed club of that country', setup.presetKeepsClub);
    check('switching to basketball drops the country theatre', setup.basketballResets);
  }
  check('the setup map shows exactly the country’s sections', setup.sectionsShown);
  check('setup previews each section in its starting club’s kickoff colour (Political pastel, Flags club colour)', setup.setupColours,
    JSON.stringify({ political: setup.politicalPreview, flags: setup.flagsPreview }));
  check('setup tooltips name each club’s home and the rest of its starting group', setup.setupTooltips && setup.groupedPreview);
  check('the country card shows every section in its starting club’s pastel, with sections and clubs in the caption', setup.countryCard,
    setup.countryCardText);
  check('setup counts the country’s clubs', setup.previewCount);
  check('the theatre description names the leading clubs, the sections and each club’s share', setup.description, setup.descriptionText);
  checkBackdrop('setup', setup.backdrop);
}

function checkDomesticKickoff(label, state) {
  check(`${label}: settings name the country and the loaded map version`, state.scope && state.version);
  check(`${label}: every club starts on its own starting sections, its home among them`, state.fielded && state.everySectionHeld
    && state.startGroups && state.wholeGroups);
  check(`${label}: routing runs on the sections alone`, state.routingIsSections);
  check(`${label}: neighbouring land blocks routes and is never a section`, state.obstacles);
  check(`${label}: the Ledger header and the map title card name the country`, state.theatreLabel && state.mapTitle,
    JSON.stringify({ ledger: state.ledgerKicker, title: state.titleText }));
  check(`${label}: every home marker shows at the opening zoom`, state.homesShown);
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

// Every scenario fetches through this server, so prove it serves by path and
// 404s honestly; then load each shipped country through the runtime loader.
// The focused `--*-only=<i>` runs skip it (decoding every shipped map takes a while).
if (!filtered) {
  const dom = await installDom();
  console.log('\n  Static files and shipped country maps');
  try {
    const { clearDomesticCache, loadDomestic } = await import('../src/engine/domestic.js');
    const status = async url => (await globalThis.fetch(url)).status;
    check('public files are served by path', await status('/world-110m.v1.json') === 200 && await status('/countries-50m.json') === 200);
    check('a missing file is a 404, never another map', await status('/domestic/000.json') === 404 && await status('/missing.json') === 404);
    check('requests cannot leave public/', await status('/domestic/..%2f..%2fpackage.json') === 404);
    for (const country of DOMESTIC) {
      const loaded = await loadDomestic(country.id, { baseUrl: '/', fetch: globalThis.fetch });
      // Format-1 index entries have no `sections`: one per club.
      const sections = country.sections ?? country.clubs;
      check(`${country.name}: the runtime loader accepts the shipped map and it matches the index`,
        loaded.meta.version === country.version && loaded.clubs.length === country.clubs && loaded.geo.countries.length === sections
          && Object.keys(loaded.startOwners).length === sections,
        `${loaded.meta.version} · ${loaded.clubs.length} clubs · ${loaded.geo.countries.length} sections`);
      // All decoded countries together hold ~700 MB; keep none past its check.
      clearDomesticCache(country.id);
    }
  } catch (error) {
    failures++;
    fail(`    ${error.message}`);
  } finally {
    dom.window.close();
  }
}

if (!filtered && fixedChecks && !process.argv.includes('--duel-frame-only') && !process.argv.includes('--empire-flags-only') && !process.argv.includes('--empire-labels-only')) {
  const dom = await installDom();
  console.log('\n  Live overall-strength standings');
  try {
    const mod = await import(`${new URL('file://' + entry.replace(/\\/g, '/'))}?strength-standings`);
    const r = await mod.runStrengthStandingsCheck();
    check('world standings rank all 170 teams by current strength', r.world.sorted && r.world.count === 170);
    check('ranks remain sequential and untruncated beyond 99', r.world.ranks);
    check('strength column announces descending order', r.world.announced);
    check('a weaker large empire ranks below a stronger small team', r.weakerEmpireBelow && r.fixture.sorted);
    check('equal strengths use team names, never territories', r.alphabeticalTie);
    check('equal strength and names use stable team ids', r.stableIdTie);
    check('a claimed player immediately changes the live standings', r.acquired && r.rerankedAfterAcquisition && r.after.sorted);
    check('eliminated teams leave the table and remaining ranks close up', r.eliminatedRemoved && r.after.ranks);
    check('unimproved baseline standings do not display gain badges', r.world.gainsCorrect && r.fixture.gainsCorrect && r.fixture.gains.every(gain => gain === null));
    check('a player acquisition displays its exact positive overall gain', r.firstGain.accurate && r.firstGain.visible && r.firstGain.positive && r.firstGain.gain === 1.8);
    check('the earned standing gain preserves live strength ordering', r.after.gainsCorrect && r.after.sorted);
    check('applying an already resolved match cannot award strength twice', r.noDoubleApply);
    check('a second conquest reports its own gain without a territory multiplier', r.twoTerritories && r.secondGain.accurate && r.secondGain.visible && r.secondGain.gain === 1.8);
    check('standing gain accumulates across two player acquisitions', r.cumulativeCorrect);
    check('a weaker acquisition reports No change neutrally', r.lowPlayerGain.accurate && r.lowPlayerGain.visible && r.lowPlayerGain.neutral);
    check('six conquered territories do not invent an overall-strength bonus', r.sixTerritories && r.noTerritoryBonus && r.zeroDoesNotAddGain);
    check('earned overall gains survive a saved-campaign reload', r.gainedStrengthRestored);
  } catch (error) {
    failures++;
    fail(`    ${error.message}`);
  } finally {
    dom.window.close();
  }
}
if (process.argv.includes('--strength-standings-only')) {
  await rm(outDir, { recursive: true, force: true });
  process.exit(failures || consoleIssues.length ? 1 : 0);
}

if (!filtered && fixedChecks && !process.argv.includes('--duel-frame-only') && !process.argv.includes('--empire-labels-only')) {
  const dom = await installDom();
  console.log('\n  Regional flags across nearby conquered land');
  try {
    const mod = await import(`${new URL('file://' + entry.replace(/\\/g, '/'))}?empire-flags`);
    const r = await mod.runEmpireFlagCheck();
    for (const state of ['kickoff', 'firstConquest', 'neighboring', 'disjoint', 'archipelago', 'zoomed', 'resized', 'restored']) checkEmpireFlags(state, r[state]);
    check('world kickoff covers all 170 owners with paintable land and separates offshore pieces', r.kickoff.ownerCount + r.kickoff.unpaintedOwners.length === 170
      && r.kickoff.unpaintedOwnersHaveNoFillArea && r.kickoff.patternCount > 170 && r.franceAtKickoffDetached,
      `${r.kickoff.ownerCount} painted owners, ${r.kickoff.patternCount} components, collapsed: ${r.kickoff.unpaintedOwners.join(', ')}`);
    check('conquered Danish mainland joins Germany’s flag', r.denmarkConnected && r.grewWithNeighbor && r.germanAssetAfterDenmark);
    check('Greenland gets a separate flag instead of stretching Germany’s', r.greenlandDetached);
    check('conquered French mainland joins Germany while colonies stay separate', r.franceConnected && r.franceOffshoreDetached);
    check('disjoint conquered Japan gets local owner flags', r.japanDetached && r.disjoint.ownerCount === r.kickoff.ownerCount - 3);
    check('date-line islands lie outside the mainland-only bounds', r.islandsBeyondMainland);
    check('Fiji’s detached islands keep local owner flags', r.islandDetached && r.archipelago.ownerCount === r.kickoff.ownerCount - 4);
    check('overseas conquests cannot distort the continental flag', r.mainlandUnchangedByJapan && r.mainlandUnchangedByFiji);
    check('zoom cannot retile or rescale the geographic flag', r.zoomPreservesPattern);
    check('responsive resize cannot retile or rescale the geographic flag', r.resizePreservesPattern);
    check('reload restores identical shared flags in Flags mode and their territory ownership', r.reloadPreservesPattern && r.reloadPreservesOwnership);
  } catch (error) {
    failures++;
    fail(`    ${error.message}`);
  } finally {
    dom.window.close();
  }
}
if (!filtered && fixedChecks && !process.argv.includes('--duel-frame-only') && !process.argv.includes('--empire-labels-only')) {
  const dom = await installDom();
  console.log('\n  Swiss flags across France, Italy and nearby islands');
  try {
    const mod = await import(`${new URL('file://' + entry.replace(/\\/g, '/'))}?swiss-flag-regions`);
    const r = await mod.runSwissFlagRegionCheck();
    check('fixture locates real mainland, island and overseas polygons', Object.values(r.located).every(Boolean), JSON.stringify(r.located));
    checkEmpireFlags('Swiss conquest', r.afterConquests);
    check('France, Switzerland and Italy share the Swiss regional flag', r.mainlandShared && r.swissAsset);
    check('Corsica shares the mainland canvas, not a miniature cross', r.corsicaShared);
    check('Sardinia shares the mainland canvas across nearby islands', r.sardiniaShared);
    check('Sicily shares the mainland canvas across the short strait', r.sicilyShared);
    check('remote Guiana retains a separate Swiss regional flag', r.guianaSeparate);
    check('regional grouping cannot annex extra land or award extra players', r.onlyIntendedConquests);
    check('Political removes regional flags and Flags restores the same regions', r.politicalHasNoFlags && r.modesPreserveRegions);
    check('switching map style leaves ownership, squads and strength unchanged', r.modesPreserveRules);
    checkEmpireFlags('Swiss flags restored', r.restored);
  } catch (error) {
    failures++;
    fail(`    ${error.message}`);
  } finally {
    dom.window.close();
  }
}
if (process.argv.includes('--empire-flags-only')) {
  await rm(outDir, { recursive: true, force: true });
  process.exit(failures || consoleIssues.length ? 1 : 0);
}

if (!filtered && !process.argv.includes('--duel-frame-only')) {
  for (const scenario of LABEL_SCENARIOS) {
    if (!wanted(scenario)) continue;
    const dom = await installDom();
    console.log(`\n  Owner-wide map labels — ${scenario.name}`);
    try {
      const mod = await import(`${new URL('file://' + entry.replace(/\\/g, '/'))}?empire-labels=${LABEL_SCENARIOS.indexOf(scenario)}`);
      const r = await mod.runEmpireLabelCheck(scenario);
      check('label engine receives the exact rendered map rings', r.geometryMatchesMap);
      check('opening view contains readable empire labels', r.kickoff.count > 0);
      for (const state of ['kickoff', 'political', 'reset', 'conquered', 'restored']) checkEmpireLabels(state, r[state]);
      r.zoomed.forEach((snapshot, i) => checkEmpireLabels(`zoom ${i + 1}`, snapshot));
      check('hover and ticker reuse cached geographic label placement', r.hoverCached && r.tickerCached);
      check('hover, ticker and styling keep owner text-path references stable', r.hoverReferencesStable && r.tickerReferencesStable && r.styleReferencesStable,
        JSON.stringify({ hover: r.hoverReferencesStable, ticker: r.tickerReferencesStable, style: r.styleReferencesStable }));
      check('owner text-path ids survive zoom visibility changes and conquest', r.ownerReferencesStable);
      check('Political/Flags styling cannot repeat label layout', r.styleCached);
      check('zoom updates placements without rebuilding display geometry', r.zoomChangesPlacement && r.cameraReusesGeometry);
      check('reset restores the theatre camera', r.resetRestoresCamera);
      check('label interactions leave ownership, squads and strength unchanged', r.nonRuleInteractionsUnchanged);
      check('conquest updates ownership metadata and removes the eliminated owner label', r.conquestOwnershipUpdated);
      check('conquest reuses the already prepared display geometry', r.conquestKeepsGeometryCache);
      check('reload restores owner labels without changing squads or strength', r.restoreLabels && r.restoreRules);
      if (r.domestic) check('every section is held, so labels follow owners only', r.neutralTerritories === 0 && r.restored.onlyCurrentOwners);
      else check('uninvolved territories do not acquire empire labels', r.neutralTerritories > 0 && r.restored.onlyCurrentOwners);
      if (scenario.layer === 'clubs') check('club territory labels use club codes', r.usesClubCodes && r.restored.count > 0);
      if (scenario.layer === 'clubs') check('Flags mode prints no club code over a drawn crest', r.crestLabels.drawn > 0 && r.crestLabels.labelledOverCrest === 0,
        JSON.stringify(r.crestLabels));
    } catch (error) {
      failures++;
      fail(`    ${error.message}`);
    } finally {
      dom.window.close();
    }
  }
}
if (process.argv.includes('--empire-labels-only')) {
  await rm(outDir, { recursive: true, force: true });
  process.exit(failures || consoleIssues.length ? 1 : 0);
}

// Reproduce the delayed-rAF/React-batching race without depending on host load.
if (!filtered && fixedChecks) {
  const dom = await installDom();
  console.log('\n  Duel animation scheduling');
  try {
    const mod = await import(`${new URL('file://' + entry.replace(/\\/g, '/'))}?duel-frame`);
    const result = await mod.runDuelFrameRace();
    check('late spinner frame cannot resurrect a spinner after kickoff', result.matchStarted && result.spinnerCleared);
  } catch (error) {
    failures++;
    fail(`    ${error.message}`);
  } finally {
    dom.window.close();
  }
}
if (process.argv.includes('--duel-frame-only')) {
  await rm(outDir, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
}

// A restore that waits for a country map must stop when the player says no.
if (!filtered && fixedChecks) {
  const dom = await installDom();
  console.log('\n  Country restores while the map loads');
  try {
    const mod = await import(`${new URL('file://' + entry.replace(/\\/g, '/'))}?restore-race`);
    const r = await mod.runRestoreRaceCheck();
    check('Resume says it is loading the map and cannot be pressed twice', r.setupLoading);
    check('Clear quick resume stops a pending resume; the pointer stays cleared', r.discardStops);
    check('the import dialog shows the map loading and holds its choices', r.dialogLoading);
    check('Cancel import stops the import: the playing campaign stays and no slot is added', r.cancelImportStops);
    check('a slot resume shows the map loading in Saved campaigns', r.slotLoading);
    check('Escape stops a pending slot resume', r.escapeStops);
    check('the campaign in play cannot be deleted', r.liveNotDeletable);
    check('Delete asks first, then removes the saved campaign', r.deleted);
    check('the playing campaign carries on', r.stillPlaying);
    check('a country backdrop draws each neighbour once (Australia whole beside Indonesia)', r.backdropIds);
  } catch (error) {
    failures++;
    fail(`    ${error.message}`);
  } finally {
    dom.window.close();
  }
}

// Capitals anchor every marker on the map, and a bad id silently reverts a
// nation to its centroid, so check the resolution rate rather than trusting it.
if (!filtered && fixedChecks) {
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
    const missingFullBounds = Object.entries(geo.paths).filter(([, geometry]) => !geometry.fullBounds);
    const clippedRuleGeometry = Object.entries(geo.paths).filter(([, geometry]) => {
      const bounds = geometry.fullBounds;
      if (!bounds) return true;
      return [...geometry.d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].some(([, x, y]) =>
        Number(x) < bounds.x - .000001 || Number(x) > bounds.x + bounds.w + .000001
        || Number(y) < bounds.y - .000001 || Number(y) > bounds.y + bounds.h + .000001);
    });
    check('fallback 110m geometry supplies full flag bounds for every shape', missingFullBounds.length === 0, missingFullBounds.map(([id]) => id).join(', '));
    check('fallback 110m full bounds contain every rendered island and polygon', clippedRuleGeometry.length === 0, clippedRuleGeometry.map(([id]) => id).join(', '));
    console.log(`    ${anchored.length}/${ids.length} anchored on their capital, rest on the centroid`);

    const atlas = JSON.parse(await readFile(path.join(root, 'public', 'countries-50m.json'), 'utf8'));
    const displayGeo = new WorldGeometry(atlas, CAPITALS);
    const { s, tx, ty } = geo.fit;
    const displayPaths = displayGeo.buildPaths(s, tx, ty);
    const missingDisplay = ids.filter(id => !displayPaths[id]);
    check('detailed atlas contains every playable nation', missingDisplay.length === 0, missingDisplay.join(', '));
    check('detailed atlas identifies Kosovo by name', displayGeo.countries.some(country => country.id === 'KOS' && country.name === 'Kosovo'));
  } catch (e) {
    failures++;
    fail(`    ${e.message}`);
  }
}

// Rosters are generated from a dataset that is not committed, so verify the
// committed output still builds a legal XI for every nation on the map.
if (!filtered && fixedChecks) {
  const { NATIONS, buildTeam, makeRng, teamEff } = await import('../src/data/teams.js');
  const { SPORT_LIST } = await import('../src/sports/index.js');
  const EXPECTED_BEST = { football: ['France', 'Spain', 'England', 'Brazil'], basketball: ['United States', 'Serbia', 'Canada'] };

  for (const sport of SPORT_LIST) {
    console.log(`\n  Squad rosters — ${sport.name}`);
    try {
      const rng = makeRng(20260802);
      const ids = Object.keys(NATIONS);
      const teams = ids.map(id => buildTeam(id, rng, sport));
      const size = sport.squadSize;
      const realPlayers = teams.reduce((s, t) => s + t.real, 0);
      const fullyReal = teams.filter(t => t.real >= size).length;
      const strays = Object.keys(sport.rosters).filter(id => !NATIONS[id]);
      const outOfRange = teams.flatMap(t => t.squad).filter(p => p.rating > 99 || p.rating < 1);
      const badPos = teams.flatMap(t => t.squad).filter(p => !sport.positionColors[p.pos]);
      const ranked = teams.map(t => ({ n: t.name, e: teamEff(t) })).sort((a, b) => b.e - a.e);
      const top = ranked.slice(0, 8).map(r => r.n);

      check('every nation fields a full lineup', teams.every(t => t.squad.length === size), 'short squad');
      check('no roster for an unknown nation', strays.length === 0, strays.join(', '));
      check('every rating is within 1-99', outOfRange.length === 0, `${outOfRange.length} outside range`);
      check('every position belongs to this sport', badPos.length === 0, [...new Set(badPos.map(p => p.pos))].join(', '));
      check('every squad has the positions the sim needs', teams.every(t => sport.requiredPositions.every(pos => t.squad.some(p => p.pos === pos))), 'missing a required position');
      check('the strongest nations look right', EXPECTED_BEST[sport.id].every(n => top.includes(n)), top.join(', '));
      console.log(`    ${fullyReal}/${ids.length} nations fully real · ${realPlayers}/${teams.length * size} shirts real (${(100 * realPlayers / (teams.length * size)).toFixed(0)}%)`);
      console.log(`    strongest: ${ranked.slice(0, 6).map(r => `${r.n} ${r.e}`).join(', ')}`);
    } catch (e) {
      failures++;
      fail(`    ${e.message}`);
    }
  }

  // Clubs are combatants too, so they need the same guarantees a nation has.
  const { buildClub } = await import('../src/data/teams.js');
  const { CLUB_SCOPES } = await import('../src/data/scopes.js');
  for (const sport of SPORT_LIST) {
    console.log(`\n  Club layer — ${sport.name}`);
    try {
      const clubs = sport.clubs.map(c => buildClub(c, sport));
      const codes = clubs.map(c => c.code);
      const leagues = [...new Set(sport.clubs.map(c => c.league))];
      const scopes = CLUB_SCOPES(sport);
      const badHome = clubs.filter(c => !NATIONS[c.home]);
      const outOfRange = clubs.flatMap(c => c.squad).filter(p => p.rating > 99 || p.rating < 1);
      const badPos = clubs.flatMap(c => c.squad).filter(p => !sport.positionColors[p.pos]);

      check('every club fields a full lineup', clubs.every(c => c.squad.length === sport.squadSize), 'short lineup');
      check('club codes are unique', new Set(codes).size === codes.length, `${codes.length - new Set(codes).size} duplicates`);
      check('every club has a real home country', badHome.length === 0, badHome.map(c => c.name).join(', '));
      check('every club rating is within 1-99', outOfRange.length === 0, `${outOfRange.length} outside range`);
      check('every club position belongs to this sport', badPos.length === 0, [...new Set(badPos.map(p => p.pos))].join(', '));
      check('every league is selectable as a theatre', leagues.every(l => scopes.some(s => s.id === l)), 'missing scope');
      check('clubs carry no flag', clubs.every(c => c.flagId === null), 'club has a flagId');

      const ranked = clubs.slice().sort((a, b) => b.str - a.str);
      console.log(`    ${clubs.length} clubs · ${leagues.length} league(s): ${leagues.join(', ')}`);
      console.log(`    strongest: ${ranked.slice(0, 5).map(c => `${c.name} ${c.str}`).join(', ')}`);
    } catch (e) {
      failures++;
      fail(`    ${e.message}`);
    }
  }

  // Seeding must give every club a foothold, without ever double-booking a country.
  {
    const { WorldGeometry } = await import('../src/engine/geo.js');
    const { CAPITALS } = await import('../src/data/capitals.js');
    const { seedClubs } = await import('../src/engine/campaign.js');
    console.log('\n  Club seeding');
    try {
      const topo = JSON.parse(await readFile(path.join(root, 'public', 'world-110m.v1.json'), 'utf8'));
      const geo = new WorldGeometry(topo, CAPITALS).fitTo(Object.keys(NATIONS));
      for (const sport of SPORT_LIST) {
        const clubs = sport.clubs.map(c => buildClub(c, sport));
        const own = seedClubs(geo, clubs);
        const seeded = new Set(Object.values(own));
        const countries = Object.keys(own);
        check(`${sport.name}: every club gets exactly one country`, seeded.size === clubs.length && countries.length === clubs.length, `${seeded.size} clubs on ${countries.length} shapes`);
        check(`${sport.name}: the best club in each league takes its homeland`, [...new Set(clubs.map(c => c.home))].every(home => own[home] !== undefined), 'a homeland went unclaimed');
      }
    } catch (e) {
      failures++;
      fail(`    ${e.message}`);
    }
  }

  // The match model must produce sane scorelines and always separate the teams.
  for (const sport of SPORT_LIST) {
    console.log(`\n  Match model — ${sport.name}`);
    try {
      const rng = makeRng(99);
      const a = buildTeam('840', rng, sport);
      const b = buildTeam('250', rng, sport);
      const results = [];
      for (let i = 0; i < 400; i++) results.push(sport.simulate(rng, a, b, 6, teamEff(a), teamEff(b)));
      const scores = results.flatMap(r => [r.ga, r.gd]);
      const mean = scores.reduce((s, x) => s + x, 0) / scores.length;
      const unresolved = results.filter(r => r.ga === r.gd && !r.tie).length;
      const evTotals = results.every(r => {
        const sum = t => r.ev.filter(e => e.tid === t).reduce((s, e) => s + e.pts, 0);
        return sum(a.id) === r.ga && sum(b.id) === r.gd;
      });

      check('every match has a winner', results.every(r => r.winner === a.id || r.winner === b.id), 'no winner');
      check('a level score always triggers a tie-break', unresolved === 0, `${unresolved} left level`);
      check('the feed adds up to the final score', evTotals, 'event totals mismatch');
      check('scoring is in the right range for the sport', sport.id === 'football' ? mean > 0.6 && mean < 3.5 : mean > 60 && mean < 110, `mean ${mean.toFixed(1)}`);
      console.log(`    400 matches · mean score ${mean.toFixed(1)} · ${results.filter(r => r.tie).length} needed ${sport.labels.tie.toLowerCase()}`);
    } catch (e) {
      failures++;
      fail(`    ${e.message}`);
    }
  }
}

// Flag assets are vendored, so a stale map would 404 silently in the browser.
if (!filtered && fixedChecks) {
  const { FLAG_CODES } = await import('../src/data/flags.js');
  const { FLAG_SYMBOLS } = await import('../src/data/flagSymbols.js');
  const { NATIONS } = await import('../src/data/teams.js');
  console.log('\n  Flag assets');
  try {
    const onDisk = new Set((await readdir(path.join(root, 'public', 'flags'))).map(f => path.basename(f, '.svg')));
    const unmapped = Object.keys(NATIONS).filter(id => !FLAG_CODES[id]);
    const absent = [...new Set(Object.values(FLAG_CODES))].filter(code => !onDisk.has(code));
    check('every nation maps to a flag', unmapped.length === 0, unmapped.join(', '));
    check('every mapped flag is vendored', absent.length === 0, absent.join(', '));
    const layerFiles = new Set((await readdir(path.join(root, 'public', 'flags-symbols'))).map(file => `flags-symbols/${file}`));
    const missingLayers = Object.values(FLAG_SYMBOLS).flatMap(profile => [profile.fieldFile, profile.symbolFile]).filter(file => !layerFiles.has(file));
    check('every separated emblem and matching field is vendored', missingLayers.length === 0, missingLayers.join(', '));
    console.log(`    ${Object.keys(FLAG_CODES).length} nations → ${onDisk.size} flag files`);
  } catch (e) {
    failures++;
    fail(`    ${e.message}`);
  }
}

for (const scenario of campaignScenarios) {
  if (!wanted(scenario)) continue;
  const dom = await installDom();
  console.log(`\n  ${scenario.name}`);
  try {
    // Fresh module instance per scenario so component state cannot leak.
    const mod = await import(`${new URL('file://' + entry.replace(/\\/g, '/'))}?v=${Math.random()}`);
    const r = await mod.run({ ...scenario, seed: 20260910 + SCENARIOS.indexOf(scenario) });

    console.log(
      `    ${r.fielded} ${r.layer === 'clubs' ? 'clubs' : 'nations'} · ${r.rounds} rounds · ${r.matches} matches · champion ${r.champion} ` +
      `(${r.territoriesHeld}/${r.totalTerritories} territories, ${r.championConquests} conquests, ${r.stolenPlayers} players taken)`,
    );
    console.log(`    rendered: ${r.seen.join(', ')}`);

    checkTheatres(scenario, r.theatre);
    if (r.domestic) {
      check(`map decoded all ${r.domestic.sections} sections of ${r.domestic.name}`, r.nations === r.domestic.sections, `${r.nations}`);
      check('every club of the country takes the field', r.fielded === r.domestic.clubs, `${r.fielded}`);
      checkDomesticSetup(r.domesticSetup, !!scenario.setupChecks);
      checkDomesticKickoff('kickoff', r.domesticKickoff);
      check('tooltips name the hovered section and its holder', r.domesticPointer.tooltip, `${r.domesticPointer.section}: ${r.domesticPointer.tooltipText}`);
      check('the backdrop ignores hover and clicks', r.domesticPointer.backdropIgnored);
      check('the opening map labels sections with club codes', r.labelsAtKickoff.count > 0);
    } else {
      check('map decoded all shapes', r.nations > 150, `${r.nations}`);
    }
    if (r.layer === 'clubs') {
      check('in Flags mode a drawn crest replaces its club code', r.crestLabelsAtKickoff.drawn > 0 && r.crestLabelsAtKickoff.labelledOverCrest === 0,
        JSON.stringify(r.crestLabelsAtKickoff));
    }
    check('theatre fielded a full bracket', r.fielded > 1, `${r.fielded}`);
    check('rapid play then pause leaves the campaign idle', r.rapidPauseHeld);
    check('standings start sorted by live overall strength', r.standingsAtKickoff.sorted && r.standingsAtKickoff.announced);
    check('standings stay strength-sorted after every sampled result', r.standingsStayedSorted && r.standingsSamples > 1, `${r.standingsSamples} snapshots`);
    check('survivor ranks stay sequential throughout the campaign', r.standingsRanksStayedSequential);
    check('standings display only true positive cumulative strength gains', r.standingsGainsStayedCorrect);
    checkEmpireLabels('campaign kickoff', r.labelsAtKickoff);
    check('labels follow only current owners throughout the campaign', r.labelsStayedValid, JSON.stringify(r.labelFailures));
    checkEmpireLabels('campaign finish', r.labelsAtFinish);
    check('every match eliminated exactly one team', r.fallen === r.fielded - 1 && r.matches === r.fielded - 1,
      `${r.fallen} fallen of ${r.fielded} in ${r.matches} matches`);
    check('every match was won by someone', r.conquestsAllTeams === r.matches, `${r.conquestsAllTeams} vs ${r.matches}`);
    check('champion holds the entire map', r.territoriesHeld === r.totalTerritories, `${r.territoriesHeld}/${r.totalTerritories}`);
    check('one player changed shirts per match', r.stealsAllTeams === r.matches, `${r.stealsAllTeams} vs ${r.matches} matches`);
    check('champion took a player per conquest', r.stolenPlayers === r.championConquests, `${r.stolenPlayers} vs ${r.championConquests}`);
    // Domestic squads hold up to 16 players, so measure growth from kickoff.
    check('squad grew by the spoils', r.championSquad === r.championInitialSquad + r.championConquests,
      `${r.championSquad} from ${r.championInitialSquad}`);
    check('setup opens on the Political map', r.setupPolitical);
    check('setup shows each country’s national flag in Flags mode', r.setupFlags);
    check('campaign kickoff opens on the Political map', r.kickoffPolitical);
    check('campaign Flags mode shows the correct owner assets', r.kickoffFlags);
    const continentalNations = r.layer !== 'clubs' && scenario.scope !== 'world';
    checkMapScope('kickoff', r.kickoffFlagScope, { continental: continentalNations });
    checkMapScope('first conquest', r.firstConquestFlagScope, { continental: continentalNations, conquered: r.layer !== 'clubs' });
    checkMapScope('victory', r.victoryFlagScope, { continental: continentalNations, conquered: r.layer !== 'clubs' });
    check('Political control switches to ownership colours', r.politicalAtStart);
    check('political conquest repaints every held territory', r.politicalConquest);
    check('Flags control restores owner flags and leaves uninvolved land neutral', r.finalFlags);
    checkMapScope('completed map', r.finalFlagScope, { continental: continentalNations, conquered: r.layer !== 'clubs' });
    if (r.domestic) {
      check('conquest summaries name the sections taken', r.domestic.resultsNameSections);
      check('a conquest takes whole starting groups, and the first takes exactly the loser’s', r.domestic.groupsStayedWhole && r.domestic.firstConquestTakesGroup);
      check('the victory screen names the country', r.domestic.victoryNamesCountry);
    }
    if (r.layer === 'clubs' && !r.championCrest) {
      check('a club without a crest paints territory rather than flying a banner', r.flagPatterns === 0, `${r.flagPatterns} flag patterns`);
      check('conquered land shows the conqueror’s colour', r.championFill === r.territoriesHeld, `${r.championFill} of ${r.territoriesHeld}`);
    } else {
      check('every held territory with visible fill area flies a flag (or its club’s crest)', r.flagFills === r.paintableTerritories, `${r.flagFills} fills vs ${r.paintableTerritories} paintable territories`);
      check('champion flags have one unique pattern per regional land group', r.flagPatterns > 0 && r.flagPatterns === r.uniqueHeldPatterns
        && r.flagPatterns === r.finalFlagScope.empireFlags.componentCount, `${r.flagPatterns} patterns, ${r.uniqueHeldPatterns} unique`);
      check('every land region flies the conqueror’s flag', r.patternsFlyingChampionFlag === r.flagPatterns, `${r.patternsFlyingChampionFlag} champion flag patterns`);
    }
    check('victory screen rendered', r.victoryScreen);
    check('completed campaign leaves no spinner or simulation timers', r.campaignIdle);
    check('result names the winner, territory gain and claimed player', r.structuredConsequences);
    check('campaign autosaved', r.saveWritten);
    check('feed logged the war', r.logEntries > r.matches);
    check('match card appeared', r.seen.includes('match-card'));
    check('all three screens rendered', Object.values(r.tabs).every(n => n > 0), JSON.stringify(r.tabs));
    if (scenario.pacing === 'duel') check('spinner ran', r.seen.includes('spinner'));
  } catch (e) {
    failures++;
    fail(`    ${e.message}`);
  } finally {
    dom.window.close();
  }
}

// A manager campaign played only through the primary action: target choice, tactical gate, live match, signing.
for (const scenario of managerScenarios) {
  if (!wanted(scenario)) continue;
  const dom = await installDom();
  console.log(`\n  ${scenario.name}`);
  try {
    const mod = await import(`${new URL('file://' + entry.replace(/\\/g, '/'))}?manager=${Math.random()}`);
    // The seed keeps Italy in charge for two cycles (target choices with one and five options, eight signings) before it
    // falls, so every check below has something to verify, Continue as spectator included.
    const r = await mod.runManagerCampaign({ ...scenario, seed: 20261026 + MANAGER_SCENARIOS.indexOf(scenario) });
    console.log(
      `    ${r.fielded} nations · ${r.roundRobin.cycles} cycles · ${r.turns} turns · ${r.matches} matches · champion ${r.champion} · ` +
      `${r.teamName} ${r.eliminated ? `out in round ${r.eliminated.round} (placed ${r.eliminated.placement} of ${r.fielded}, by ${r.eliminated.by})` : 'won the campaign'}`,
    );
    console.log(`    decisions: ${r.targetChoices} targets (options ${r.optionCounts.join('/') || 'none'}), ${r.tacticalGates} tactical gates, ${r.signings} signings · primary clicks ${JSON.stringify(r.clicks)}`);
    console.log(`    rendered: ${r.seen.join(', ')}`);

    check('launched as the manager with round robin and You choose', r.settingsApplied);
    check('campaign kickoff opens on the Political map', r.kickoffPolitical);
    check('the round-robin queue follows starting strength every cycle and skips only fallen teams', r.roundRobin.valid && r.roundRobin.cycles > 1,
      `${r.roundRobin.cycles} cycles; ${r.roundRobin.errors.join('; ')}`);
    check('every duel turn draws exactly three campaign samples', r.threeSamples && r.unscheduledTurns === 0, `samples ${JSON.stringify(r.sampleCounts)}, ${r.unscheduledTurns} unscheduled`);
    check('the turn strip shows the round-robin order', r.seen.includes('turn-strip'));
    check('every managed turn opens Choose a target with options in reach', r.managedTurns > 0 && r.targetChoices === r.managedTurns && r.optionCounts.every(n => n >= 1),
      `${r.targetChoices} choices for ${r.managedTurns} managed turns, options ${JSON.stringify(r.optionCounts)}`);
    check('target panel, map reach and both primaries agree on the selection', r.targetAgree);
    check('choosing another target moves the selection and the Attack label', r.retargeted === true, String(r.retargeted));
    check('Attack kicks off against the chosen empire', r.attackHitsChoice);
    check('tactical gates wait for Continue without opening the match preview', r.tacticalGates > 0 && r.tacticalQuiet && r.previewOffered);
    check('managed kickoffs switch to the Match view, which returns to the Map afterwards', r.autoSwitched && r.autoReturned, `${r.autoReturns} returns`);
    check('live matches finish through Finish match', (r.clicks.finish || 0) > 0);
    check('a pending signing holds the conquest screen and names the selected player everywhere', r.signings > 0 && r.signAgree);
    check('choosing another signing moves the selection and the Sign label', r.resigned === true, String(r.resigned));
    check('the signed player joins with provenance', r.claimedSelected);
    check('every managed conquest went through the signing screen', r.managerConquestsSigned);
    check('masthead and phone primaries always show the primary action', r.primariesShown);
    check('no clock timers while a target or signing is pending', r.noTimersWhileDeciding && r.decisionSamples > 0, `${r.decisionSamples} decision samples`);
    check('the decision ledger records every target, approach and signing', r.ledgerCounts);
    check('standings sampled outside decisions stay strength-sorted', r.standingsAtKickoff.sorted && r.standingsStayedSorted && r.standingsSamples > 1,
      `${r.standingsSamples} snapshots`);
    check('manager standings keep sequential ranks and true gains', r.standingsRanksStayedSequential && r.standingsGainsStayedCorrect);
    checkEmpireLabels('manager kickoff', r.labelsAtKickoff);
    check('manager labels follow only current owners throughout the campaign', r.labelsStayedValid, JSON.stringify(r.labelFailures));
    checkEmpireLabels('manager finish', r.labelsAtFinish);
    if (r.eliminated) {
      check('elimination article offers Continue as spectator', r.eliminationShown);
      check('the spectator plays on to a champion with compass targets', (r.spectated || r.eliminated.placement === 2) && r.pendingAfterElimination === 0);
    }
    check('every match eliminated exactly one nation', r.fallen === r.fielded - 1 && r.matches === r.fielded - 1, `${r.fallen} fallen, ${r.matches} matches of ${r.fielded}`);
    check('champion holds the entire map', r.territoriesHeld === r.totalTerritories, `${r.territoriesHeld}/${r.totalTerritories}`);
    check('match card appeared', r.seen.includes('match-card'));
    check('spinner ran', r.seen.includes('spinner'));
    check('victory screen rendered', r.victoryScreen);
    check('completed campaign leaves no spinner or simulation timers', r.campaignIdle);
    check('campaign autosaved', r.saveWritten);
  } catch (e) {
    failures++;
    fail(`    ${e.message}`);
  } finally {
    dom.window.close();
  }
}

// Autosave/reload through the real controls across both sports and team layers.
for (const scenario of resumeScenarios) {
  if (!wanted(scenario)) continue;
  const dom = await installDom();
  console.log(`\n  ${scenario.name} — interrupt and reload`);
  try {
    const mod = await import(`${new URL('file://' + entry.replace(/\\/g, '/'))}?v=${Math.random()}`);
    const r = await mod.runResumeCheck({ ...scenario, seed: 20261010 + RESUME_SCENARIOS.indexOf(scenario) });
    console.log(
      `    ${r.fielded} ${scenario.layer === 'clubs' ? 'clubs' : 'nations'} fielded · paused at round ${r.before.round} ` +
      `(${r.before.matches} matches, ${r.before.alive} alive) · reloaded at round ${r.after.round}`,
    );
    if (scenario.scope === 'world') {
      check('whole world fielded', r.fielded === scenario.expectedField, `${r.fielded}`);
      check('Greenland starts out Danish', r.greenlandStartsDanish, `owner ${r.greenlandAlwaysHeld}`);
      check('world kickoff still flags every participating nation', r.kickoffFlagScope.inactiveNations === 0 && r.kickoffFlagScope.correct);
    }
    const nationalCampaign = scenario.layer !== 'clubs';
    const continentalNations = nationalCampaign && scenario.scope !== 'world';
    checkMapScope('resume scenario kickoff', r.kickoffFlagScope, { continental: continentalNations });
    checkMapScope('before reload', r.flagScopeBefore, { continental: continentalNations, conquered: nationalCampaign });
    checkMapScope('restored map', r.flagScopeAfter, { continental: continentalNations, conquered: nationalCampaign });
    checkMapScope('resumed conquest', r.flagScopeAfterMatch, { continental: continentalNations, conquered: nationalCampaign });
    if (r.domesticSaved) {
      check('the quick-resume strip names the country', r.domesticSaved.stripNamesCountry);
      check('the saved-campaign list names the country', r.domesticSaved.dialogNamesCountry);
    }
    if (r.domesticRestore) {
      const k = r.domesticRestore;
      check('a save naming sections the map lacks is refused with a clear message', k.mismatchRefused);
      check('a map that cannot load blocks the resume with a clear message', k.loadFailureRefused);
      check('a cold resume fetches the map and says it is loading it', k.coldLoading && k.coldFetched, JSON.stringify(k));
      check('a save from an earlier map build resumes, re-stamped with the loaded version', k.updatedMap.restamped);
      check('that resume says the map changed and the stale draw is dropped', k.updatedMap.told && k.updatedMap.staleDrawDropped,
        JSON.stringify(k.updatedMap));
      check('a one-section-per-club save gives each club’s whole group to the holder of its old section', k.updatedMap.ownershipKept);
    }
    if (r.domesticResumed) {
      const k = r.domesticResumed;
      check('reload restores the country map, its version and section routing', k.scope && k.version && k.everySectionHeld && k.routingIsSections && k.obstacles);
      check('every starting group still has one holder after the reload', k.wholeGroups);
      check('the reloaded header still describes the country and every home marker shows', k.theatreLabel && k.homesShown,
        JSON.stringify({ ledger: k.ledgerKicker }));
    }
    check('zoom in reframes the map', r.viewBoxZoomed !== r.viewBoxAtRest, r.viewBoxZoomed);
    check('zoom out clamps back to the world', r.viewBoxClamped === '0 0 960 540', r.viewBoxClamped);
    check('war reduced the field', r.before.alive < r.fielded, `${r.before.alive} of ${r.fielded}`);
    check('reload offered the saved campaign', r.offeredResume);
    check('round restored', r.after.round === r.before.round, `${r.after.round} vs ${r.before.round}`);
    check('survivors restored', r.after.alive === r.before.alive, `${r.after.alive} vs ${r.before.alive}`);
    check('match count restored', r.after.matches === r.before.matches, `${r.after.matches} vs ${r.before.matches}`);
    check('map ownership restored', r.after.ownedByFirstAlive === r.before.ownedByFirstAlive, `${r.after.ownedByFirstAlive} vs ${r.before.ownedByFirstAlive}`);
    check('all ownership and map markers restored', r.after.ownership === r.before.ownership && r.restoredMap);
    check('reloaded map opens on the Political map (map style is not saved)', r.reloadPolitical);
    check('reloaded map restores the owners’ flags after choosing Flags', r.restoredFlags);
    check('sport, team layer and match settings restored', r.after.settings === r.before.settings);
    check('all squads and acquired players restored', r.after.squads === r.before.squads);
    check('remaining match queue restored', r.after.queue === r.before.queue);
    check('live overall-strength standings restored exactly', r.after.standings === r.before.standings && r.standingsBefore.sorted && r.standingsAfter.sorted);
    check('cumulative strength gains restore exactly and remain visible', r.after.strengthGains === r.before.strengthGains
      && r.standingsBefore.gainsCorrect && r.standingsAfter.gainsCorrect
      && JSON.stringify(r.standingsBefore.gains) === JSON.stringify(r.standingsAfter.gains));
    check('resumed matches keep strength ordering and sequential ranks', r.standingsAfterMatch.sorted && r.standingsAfterMatch.ranks);
    check('resumed acquisitions retain accurate cumulative strength gains', r.standingsAfterMatch.gainsCorrect);
    checkEmpireLabels('before reload', r.labelsBefore);
    checkEmpireLabels('after reload', r.labelsAfter);
    checkEmpireLabels('resumed match', r.labelsAfterMatch);
    check('campaign playable after reload', r.playableAfterResume);
    if (scenario.finish) {
      check('the reloaded campaign plays on to a champion holding every territory', r.finished.alive === 1 && r.finished.championHoldsAll
        && r.finished.mapShowsChampion, JSON.stringify(r.finished));
      check('one team fell per match all the way through', r.finished.fallen === r.fielded - 1 && r.finished.matches === r.fielded - 1,
        `${r.finished.fallen} fallen in ${r.finished.matches} matches`);
    }
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
console.log(`Smoke suite completed in ${((Date.now() - startedAt) / 1000).toFixed(1)} seconds`);
process.exit(failures ? 1 : 0);
