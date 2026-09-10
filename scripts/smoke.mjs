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
const startedAt = Date.now();

const SCENARIOS = [
  { name: 'South America · duel · ticker', scope: 'CONMEBOL', pacing: 'duel', resolution: 'ticker' },
  { name: 'South America · blitz · instant', scope: 'CONMEBOL', pacing: 'blitz', resolution: 'instant' },
  { name: 'N. & C. America · chaos · instant', scope: 'CONCACAF', pacing: 'chaos', resolution: 'instant' },
  { name: 'BASKETBALL · South America · duel · ticker', sport: 'basketball', scope: 'CONMEBOL', pacing: 'duel', resolution: 'ticker' },
  { name: 'BASKETBALL · Europe · blitz · instant', sport: 'basketball', scope: 'UEFA', pacing: 'blitz', resolution: 'instant' },
  { name: 'CLUBS · Premier League · blitz · instant', layer: 'clubs', clubScope: 'Premier League', pacing: 'blitz', resolution: 'instant' },
  { name: 'CLUBS · NBA · chaos · instant', sport: 'basketball', layer: 'clubs', clubScope: 'NBA', pacing: 'chaos', resolution: 'instant' },
];

const RESUME_SCENARIOS = [
  { name: 'World war · blitz · instant', scope: 'world', pacing: 'blitz', resolution: 'instant', expectedField: 170 },
  { name: 'BASKETBALL · South America · blitz · instant', sport: 'basketball', scope: 'CONMEBOL', pacing: 'blitz', resolution: 'instant' },
  { name: 'CLUBS · Premier League · blitz · instant', layer: 'clubs', clubScope: 'Premier League', pacing: 'blitz', resolution: 'instant' },
  { name: 'CLUBS · NBA · chaos · instant', sport: 'basketball', layer: 'clubs', clubScope: 'NBA', pacing: 'chaos', resolution: 'instant' },
];

const LABEL_SCENARIOS = [
  { name: 'World nations', scope: 'world' },
  { name: 'European nations', scope: 'UEFA' },
  { name: 'Premier League clubs', layer: 'clubs', clubScope: 'Premier League' },
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

async function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const mapJson = await readFile(path.join(root, 'public', 'world-110m.v1.json'), 'utf8');
  const atlasJson = await readFile(path.join(root, 'public', 'countries-50m.json'), 'utf8');

  // The app fetches the topology relative to BASE_URL; serve it from disk.
  window.fetch = async url => ({ ok: true, status: 200, json: async () => JSON.parse(String(url).includes('countries-50m.json') ? atlasJson : mapJson) });

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
  check(`${label}: labels stay within 11–32 screen pixels and the viewport`, snapshot.fontSizes && snapshot.withinViewport);
  check(`${label}: every name follows its valid unique quadratic text path`, snapshot.textPathsValid && snapshot.gentleArches);
  check(`${label}: coastal output respects the explicit 10px/22% UI policy`, snapshot.coastalPolicyValid && snapshot.uiPolicyEnabled);
  if (snapshot.geography) check(`${label}: owned anchor, no foreign land and tightly bounded sea spill`, snapshot.geography.valid, snapshot.geography.errors.join('; '));
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

if (!process.argv.includes('--duel-frame-only') && !process.argv.includes('--empire-flags-only') && !process.argv.includes('--empire-labels-only')) {
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

if (!process.argv.includes('--duel-frame-only') && !process.argv.includes('--empire-labels-only')) {
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
    check('reload restores identical shared flags and their territory ownership', r.reloadPreservesPattern && r.reloadPreservesOwnership);
  } catch (error) {
    failures++;
    fail(`    ${error.message}`);
  } finally {
    dom.window.close();
  }
}
if (!process.argv.includes('--duel-frame-only') && !process.argv.includes('--empire-labels-only')) {
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

if (!process.argv.includes('--duel-frame-only')) {
  for (const scenario of LABEL_SCENARIOS) {
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
      check('hover, ticker and styling keep owner text-path references stable', r.hoverReferencesStable && r.tickerReferencesStable && r.styleReferencesStable);
      check('owner text-path ids survive zoom visibility changes and conquest', r.ownerReferencesStable);
      check('Political/Flags styling cannot repeat label layout', r.styleCached);
      check('zoom updates placements without rebuilding display geometry', r.zoomChangesPlacement && r.cameraReusesGeometry);
      check('reset restores the theatre camera', r.resetRestoresCamera);
      check('label interactions leave ownership, squads and strength unchanged', r.nonRuleInteractionsUnchanged);
      check('conquest updates ownership metadata and removes the eliminated owner label', r.conquestOwnershipUpdated);
      check('conquest reuses the already prepared display geometry', r.conquestKeepsGeometryCache);
      check('reload restores owner labels without changing squads or strength', r.restoreLabels && r.restoreRules);
      check('uninvolved territories do not acquire empire labels', r.neutralTerritories > 0 && r.restored.onlyCurrentOwners);
      if (scenario.layer === 'clubs') check('club territory labels use club codes', r.usesClubCodes && r.restored.count > 0);
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
{
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
{
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
{
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

for (const scenario of SCENARIOS) {
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

    check('map decoded all shapes', r.nations > 150, `${r.nations}`);
    check('theatre fielded a full bracket', r.fielded > 1, `${r.fielded}`);
    check('rapid play then pause leaves the campaign idle', r.rapidPauseHeld);
    check('standings start sorted by live overall strength', r.standingsAtKickoff.sorted && r.standingsAtKickoff.announced);
    check('standings stay strength-sorted after every sampled result', r.standingsStayedSorted && r.standingsSamples > 1, `${r.standingsSamples} snapshots`);
    check('survivor ranks stay sequential throughout the campaign', r.standingsRanksStayedSequential);
    check('standings display only true positive cumulative strength gains', r.standingsGainsStayedCorrect);
    checkEmpireLabels('campaign kickoff', r.labelsAtKickoff);
    check('labels follow only current owners throughout the campaign', r.labelsStayedValid);
    checkEmpireLabels('campaign finish', r.labelsAtFinish);
    check('every match eliminated exactly one nation', r.fallen === r.fielded - 1, `${r.fallen} fallen of ${r.fielded}`);
    check('every match was won by someone', r.conquestsAllTeams === r.matches, `${r.conquestsAllTeams} vs ${r.matches}`);
    check('champion holds the entire map', r.territoriesHeld === r.totalTerritories, `${r.territoriesHeld}/${r.totalTerritories}`);
    check('one player changed shirts per match', r.stealsAllTeams === r.matches, `${r.stealsAllTeams} vs ${r.matches} matches`);
    check('champion took a player per conquest', r.stolenPlayers === r.championConquests, `${r.stolenPlayers} vs ${r.championConquests}`);
    check('squad grew by the spoils', r.championSquad === r.squadSize + r.championConquests, `${r.championSquad}`);
    check('setup defaults to each country’s national flag', r.setupFlags);
    check('campaign defaults to flags with the correct owner assets', r.kickoffFlags);
    const continentalNations = r.layer !== 'clubs' && scenario.scope !== 'world';
    checkFlagScope('kickoff', r.kickoffFlagScope, { continental: continentalNations });
    checkFlagScope('first conquest', r.firstConquestFlagScope, { continental: continentalNations, conquered: r.layer !== 'clubs' });
    checkFlagScope('victory', r.victoryFlagScope, { continental: continentalNations, conquered: r.layer !== 'clubs' });
    check('Political control switches to ownership colours', r.politicalAtStart);
    check('political conquest repaints every held territory', r.politicalConquest);
    check('Flags control restores owner flags and leaves uninvolved land neutral', r.finalFlags);
    checkFlagScope('completed map', r.finalFlagScope, { continental: continentalNations, conquered: r.layer !== 'clubs' });
    if (r.layer === 'clubs') {
      check('clubs paint territory rather than flying flags', r.flagPatterns === 0, `${r.flagPatterns} flag patterns`);
      check('conquered land shows the conqueror’s colour', r.championFill === r.territoriesHeld, `${r.championFill} of ${r.territoriesHeld}`);
    } else {
      check('every held territory with visible fill area flies a flag', r.flagFills === r.paintableTerritories, `${r.flagFills} fills vs ${r.paintableTerritories} paintable territories`);
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
    check('all three tabs rendered', Object.values(r.tabs).every(n => n > 0), JSON.stringify(r.tabs));
    if (scenario.pacing === 'duel') check('spinner ran', r.seen.includes('spinner'));
  } catch (e) {
    failures++;
    fail(`    ${e.message}`);
  } finally {
    dom.window.close();
  }
}

// Autosave/reload through the real controls across both sports and team layers.
for (const scenario of RESUME_SCENARIOS) {
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
    checkFlagScope('resume scenario kickoff', r.kickoffFlagScope, { continental: continentalNations });
    checkFlagScope('before reload', r.flagScopeBefore, { continental: continentalNations, conquered: nationalCampaign });
    checkFlagScope('restored map', r.flagScopeAfter, { continental: continentalNations, conquered: nationalCampaign });
    checkFlagScope('resumed conquest', r.flagScopeAfterMatch, { continental: continentalNations, conquered: nationalCampaign });
    check('zoom in reframes the map', r.viewBoxZoomed !== r.viewBoxAtRest, r.viewBoxZoomed);
    check('zoom out clamps back to the world', r.viewBoxClamped === '0 0 960 540', r.viewBoxClamped);
    check('war reduced the field', r.before.alive < r.fielded, `${r.before.alive} of ${r.fielded}`);
    check('reload offered the saved campaign', r.offeredResume);
    check('round restored', r.after.round === r.before.round, `${r.after.round} vs ${r.before.round}`);
    check('survivors restored', r.after.alive === r.before.alive, `${r.after.alive} vs ${r.before.alive}`);
    check('match count restored', r.after.matches === r.before.matches, `${r.after.matches} vs ${r.before.matches}`);
    check('map ownership restored', r.after.ownedByFirstAlive === r.before.ownedByFirstAlive, `${r.after.ownedByFirstAlive} vs ${r.before.ownedByFirstAlive}`);
    check('all ownership and map markers restored', r.after.ownership === r.before.ownership && r.restoredMap);
    check('reloaded map defaults to the restored owners’ flags', r.restoredFlags);
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
