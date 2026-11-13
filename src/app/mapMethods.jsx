// Owner: WP-MAP (see PLAN.md §4). Map method bodies: v4 fills, flags, labels, capitals, tooltip, target hover,
// conquest framing and the WorldMap identity / reach props (PLAN §3.3, W2-UI-LOG "Wiring for src/app/mapMethods.jsx").
// Plain function declarations called as `fn.apply(this, args)` from App's one-line delegates (§1.1, §3.3); other App
// methods are called through `this.x()`. Everything render calls is pure (§0.9): no DOM, timers, setState or this.rng,
// and it returns its empty value outside playing/victory before reading the board.
import React from 'react';
import { CONFIG } from '../config.js';
import { V4 } from '../theme.js';
import { DEPENDENCIES, NATIONS } from '../data/teams.js';
import { FLAG_CODES, flagUrl } from '../data/flags.js';
import { FLAG_SYMBOLS } from '../data/flagSymbols.js';
import { crestUrl } from '../data/crests.js';
import { regionClips } from '../engine/flagClips.js';
import { flagRegionIndexSteps } from '../engine/flagRegions.js';
import { layoutFlagSymbol } from '../engine/flagSymbolLayout.js';
import { runQuietly } from '../engine/quietTurns.js';
import { memo } from '../viewModels/format.js';
import * as mapVM from '../viewModels/map.js';

const NONE = Object.freeze([]);
/**
 * A club's crest on its land in Flags mode, placed like a flag's emblem (engine/flagSymbolLayout.js): one undistorted
 * square, centred in a 4:3 field the size of the land, on the club's colour. Up to about 30% of the land: the crest
 * stands in for the club's code, which WorldMap leaves off land that shows one.
 */
const CREST_PROFILE = Object.freeze({ id: 'club-crest', sourceWidth: 640, sourceHeight: 480,
  bounds: Object.freeze({ x: 190, y: 110, w: 260, h: 260 }) });
/** A team's crest URL when it is a club with one in season year `year` (null: today's; src/data/crests.js). */
const crestOf = (team, year) => (team?.kind === 'club' ? crestUrl(team.id, year) : null);
const NO_IDENTITY = Object.freeze({ meId: null, meFill: false, opponentId: null });
const NO_CLAIMS = Object.freeze({});
// mapFlags' empty value: one object (never written to), so the memoised country rows keep their identity.
const NO_FLAGS = Object.freeze({ flagParts: new Map(), flagPatterns: NONE });
const isPlaying = st => st?.phase === 'playing' || st?.phase === 'victory';
/** The views that show the map (App.render's `mapVisible`); every other view hides it. */
const MAP_VIEWS = new Set(['setup', 'map', 'conquest']);

const homeClubCache = new WeakMap();
/**
 * Section id → the club that starts there on a loaded country map (`{ clubs, startOwners }` from engine/domestic.js):
 * every section of a club's starting group, not just its home. For the setup preview fill and the tooltip. Memoised
 * per decoded map; pure (a module WeakMap, never React state).
 */
export function homeClubs(domestic) {
  if (!domestic?.clubs) return {};
  if (!homeClubCache.has(domestic)) {
    const byId = new Map(domestic.clubs.map(club => [club.id, club]));
    const starts = domestic.startOwners || Object.fromEntries(domestic.clubs.map(club => [club.homeSection, club.id]));
    homeClubCache.set(domestic, Object.fromEntries(Object.entries(starts).map(([section, id]) => [section, byId.get(id)])));
  }
  return homeClubCache.get(domestic);
}

/**
 * The campaign as the map draws it. While the manager signs a player (`st.choice`) the map shows the projected
 * post-conquest board (DEC D15, D§2.3 / D§10): every loser cid belongs to the winner and the loser is no longer drawn,
 * so fills, flags, borders, capitals, labels and the tooltip agree with the hatch, and so does the claimed land
 * (the claims the conquest will settle). The projection comes from `this.conquestPreview()` (WP-CONQ) and is memoised
 * on state identities, so `ownership` keeps one identity across renders (label engine, border mesh and flag-region
 * caches). → { state, own, aliveIds, taken|null, claims }
 */
function mapSnapshot(app) {
  const st = app.state;
  const plain = { state: st, own: st.own || {}, aliveIds: st.aliveIds || NONE, taken: null, claims: st.claims || NO_CLAIMS };
  if (!st.choice || !isPlaying(st)) return plain;
  const projected = memo(app.vmCache, 'map:projection', [st.choice, st.match, st.own, st.teams, st.aliveIds, st.claims], () => {
    const preview = app.conquestPreview();
    if (!preview?.own) return null;
    return { own: preview.own, aliveIds: (st.aliveIds || NONE).filter(id => id !== preview.loserId), taken: preview.taken || NONE,
      claims: app.conquestClaims(st, preview.own, preview.winnerId, preview.loserId) };
  });
  return projected ? { state: { ...st, own: projected.own, aliveIds: projected.aliveIds, claims: projected.claims }, ...projected } : plain;
}

/**
 * Ownership as the map paints it: the territory, plus the claimed land that is one of the map's own shapes (a world
 * map's nations without a team) in its holder's name, so its fill, flag, borders, outline and label are the holder's
 * as if it were territory. A country map's claimed land lies in the backdrop (mapClaims), so there it is the territory
 * alone, the same object. Clicks, tab stops, targets and the tooltip keep reading the real holdings.
 */
function paintedOwnership(app, snap) {
  const paths = app.geo?.paths;
  if (!paths || !Object.keys(snap.claims).some(id => paths[id])) return snap.own;
  return memo(app.vmCache, 'map:painted-ownership', [snap.own, snap.claims, paths], () => {
    const painted = { ...snap.own };
    for (const [id, holder] of Object.entries(snap.claims)) if (paths[id] && painted[id] == null) painted[id] = holder;
    return painted;
  });
}

/**
 * Frame a conquest's land on the map (history inspection, "View conquest"). Ignored while a signing or a target
 * choice holds the screen (A-13): it would replace the D1 conquest framing or move the camera off the reach.
 */
export function viewConquest(result = this.matchCard()?.result) {
  const st = this.state;
  if (st.choice || st.pendingTarget || !this.geo) return;
  const ids = result?.territoryIds || st.conquestIds || NONE;
  const boxes = ids.map(id => (this.displayGeo?.paths[id] || this.geo.paths[id])?.bbox).filter(Boolean);
  if (!boxes.length) return;
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  const right = Math.max(...boxes.map(b => b.x + b.w)), bottom = Math.max(...boxes.map(b => b.y + b.h));
  this.setState({ view: 'map', viewSource: 'user', conquestIds: ids, focusBounds: { x, y, w: right - x, h: bottom - y },
    focusKey: st.focusKey + 1, focusLayout: null }, () => {
    this.mapRef.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    this.mapRef.current?.focus?.({ preventScroll: true });
  });
}

/**
 * Pointer (and keyboard-focus) moves over the map: keep the tooltip inside the map by its real size, drop the land
 * hover once the pointer is over no country (the sea, the map chrome, an overlay: README "hovering land shows the …
 * tooltip", not the sea), and while you choose a target hover the in-reach empire under the pointer (C-18). WorldMap
 * forwards leaving the land (off the map or onto its chrome) as a move whose target is no `[data-reach="in"]` land,
 * which clears the hover. The LAT/LON readout is retired (DEC D21). Event handler, not render: DOM reads are fine here.
 */
export function handleMapMove(e) {
  const st = this.state;
  const tip = this.tipRef.current;
  const map = this.mapRef.current;
  if (tip && map && Number.isFinite(e?.clientX) && Number.isFinite(e?.clientY)) {
    const b = map.getBoundingClientRect();
    // A hidden tooltip measures 0×0; fall back to its usual size so the first move does not overflow the edge.
    const width = tip.offsetWidth || 240, height = tip.offsetHeight || 72;
    tip.style.left = Math.max(8, Math.min(e.clientX - b.left + 14, b.width - width - 8)) + 'px';
    tip.style.top = Math.max(8, Math.min(e.clientY - b.top + 12, b.height - height - 8)) + 'px';
  }
  // Only a real change sets state, so moving over the sea with no hover renders nothing. Claimed land has a card too.
  if (st.hoverCid != null && !e?.target?.closest?.('path[data-country]') && !e?.target?.closest?.('path[data-claim]')) {
    this.setState({ hoverCid: null });
  }
  if (st.pendingTarget) {
    const owner = e?.target?.closest?.('[data-reach="in"]')?.dataset?.owner || null;
    if (owner !== (st.targetHoverId ?? null)) this.hoverTarget(owner);
  }
}

/**
 * Each flag region's banner (`components` from createFlagRegionIndex) and the clip paths every territory shows it
 * through: one per territory and region, its parts joined (engine/flagClips.js, kept per region object).
 * `markOf(ownerId)` says what an owner flies: `{ crestUrl }` for a club with a crest, else `{ nationId }` for a flag, and
 * the `color` behind it; an owner with neither flies nothing. `idPrefix` keeps two maps' banners apart in one document.
 * → { flagParts: Map(territory id → [{ id, d }]), flagPatterns }
 */
function layoutBanners(components, markOf, { idPrefix = '' } = {}) {
  const flagParts = new Map(), flagPatterns = [];
  for (const component of components) {
    const { crestUrl = null, nationId = null, color = V4.flagBg } = markOf(component.ownerId) || {};
    const url = crestUrl || flagUrl(nationId);
    if (!url) continue;
    // Owner + the lowest stable piece id is short and unique, including when
    // a country's mainland and overseas polygons need different flag tiles.
    const id = idPrefix + component.key.split('|').slice(0, 2).join('-').replace(/[^a-zA-Z0-9_-]/g, '-');
    const b = component.bbox;
    const symbolProfile = crestUrl ? CREST_PROFILE : FLAG_SYMBOLS[FLAG_CODES[nationId]];
    const symbolLayout = symbolProfile ? layoutFlagSymbol(component, symbolProfile) : null;
    flagPatterns.push({ id, ownerId: component.ownerId, url, color, symbolProfile, symbolLayout, crestUrl,
      fieldUrl: symbolProfile?.fieldFile ? `${import.meta.env.BASE_URL}${symbolProfile.fieldFile}` : null,
      symbolUrl: symbolProfile?.symbolFile ? `${import.meta.env.BASE_URL}${symbolProfile.symbolFile}` : null,
      bbox: { x: b.x - .1, y: b.y - .1, w: b.w + .2, h: b.h + .2 } });
    for (const { countryId, d } of regionClips(component)) {
      if (!flagParts.has(countryId)) flagParts.set(countryId, []);
      flagParts.get(countryId).push({ id, d });
    }
  }
  return { flagParts, flagPatterns };
}

/**
 * The flag region index of this fit, built on its first Flags view (fitMap keeps only its source), unless the warm-up
 * has built it already. One the warm-up is still building is finished here, not begun again.
 */
function flagIndex(app) {
  const source = app.flagRegionSource;
  if (!app.flagComponents && source) {
    const build = app.flagIndexBuild?.source === source ? app.flagIndexBuild.steps
      : flagRegionIndexSteps(source.geometry, { maxGap: source.maxGap });
    app.flagIndexBuild = null;
    for (;;) {
      const { done, value } = build.next();
      if (done) { app.flagComponents = value; break; }
    }
  }
  return app.flagComponents;
}

/** What each owner flies on the campaign map (layoutBanners' `markOf`). */
const campaignMarks = (teams, playing, year = null) => ownerId => {
  const owner = playing ? teams[ownerId] : null;
  // README §Map rendering: flag-bg behind a flag (clubs keep their colour, under the crest).
  return { crestUrl: crestOf(owner, year), color: owner?.col || V4.flagBg,
    nationId: playing ? owner?.flagId : NATIONS[ownerId] ? ownerId : DEPENDENCIES[ownerId]?.of };
};

/**
 * One regional banner across mainland and nearby islands, not tiny repeats; a club flies its crest. `mapMode` is the
 * map's mode unless asked for Flags' banners while the map shows another (the warm-up).
 */
export function mapFlags(playing, mapMode = this.state.mapMode) {
  const { teams } = this.state;
  if (mapMode !== 'flags') return NO_FLAGS;
  // Clubs wear the crests of the campaign's season.
  const year = playing ? this.state.settings?.dataYear ?? null : null;
  if (playing && !Object.values(teams).some(team => team.flagId || crestOf(team, year))) return NO_FLAGS;
  if (!flagIndex(this)) return NO_FLAGS;
  // While signing, the projected board: the taken land already flies the winner's banner (DEC D15). Claimed nations fly
  // their holder's banner too (paintedOwnership).
  const components = this.flagComponents.components(playing ? paintedOwnership(this, mapSnapshot(this)) : this.setupFlagOwnership);
  const cached = this.flagLayoutCache;
  if (cached?.components === components && cached.teams === teams && cached.playing === playing) return cached.result;
  const result = layoutBanners(components, campaignMarks(teams, playing, year));
  this.flagLayoutCache = { components, teams, playing, result };
  return result;
}

// ---- Flags mode's first view, made ahead ----
// The first Flags view of a fit builds its region index, every region's emblem layout and every territory's clip paths:
// about 140 ms of the click on a desktop, several times that on a phone. The warm-up builds them before the click, in
// quiet turns of a few milliseconds (engine/quietTurns.js) while the campaign map shows another mode, and follows the
// board as it changes, so the click finds them made. It fills the caches the Flags view reads (flagComponents, the
// per-region clip and layout caches, flagLayoutCache) with what that view would make itself, and nothing else.

/** The warm-up follows a changing board at most this often, ms: a quick campaign changes it several times a second. */
const FLAG_WARMUP_EVERY_MS = 2000;
const clock = () => (typeof performance === 'object' ? performance.now() : Date.now());

/** Whether the warm-up has a view to make ready: a campaign map showing another mode, on a fit it can build from. */
function warmupWanted(app) {
  const st = app.state;
  return !app.flagWarmup?.stopped && isPlaying(st) && st.mapMode !== 'flags' && !!app.flagRegionSource;
}

/**
 * The warm-up's steps for the board on screen: the region index, then each region's banner, then the banners. None
 * when no team flies a flag or crest (Flags mode then shows none).
 */
function* flagWarmupSteps(app) {
  const source = app.flagRegionSource;
  if (!Object.values(app.state.teams || {}).some(team => team.flagId || crestOf(team, app.state.settings?.dataYear ?? null))) return;
  if (!app.flagComponents) {
    // Kept on the app, so a click on Flags meanwhile finishes this build (flagIndex) instead of starting it over.
    const build = app.flagIndexBuild = { source, steps: flagRegionIndexSteps(source.geometry, { maxGap: source.maxGap }) };
    for (;;) {
      if (app.flagIndexBuild !== build) break;
      const { done, value } = build.steps.next();
      if (done) { app.flagComponents = value; app.flagIndexBuild = null; break; }
      yield;
    }
    if (!app.flagComponents) return;
  }
  const components = app.flagComponents.components(paintedOwnership(app, mapSnapshot(app)));
  yield;
  // One region a step: its emblem layout and clip paths are kept per region, so the banners below find them made.
  const marks = campaignMarks(app.state.teams, true, app.state.settings?.dataYear ?? null);
  for (const component of components) { layoutBanners([component], marks); yield; }
  app.mapFlags(true, 'flags');
}

const newWarmup = () => ({ board: null, running: false, timer: null, startedAt: -Infinity, stopped: false, failedOn: null });

/**
 * Starts the warm-up for the board on screen unless it has run for it, runs now, or ran less than
 * FLAG_WARMUP_EVERY_MS ago (then it starts once that time is up). App calls it after every commit: it reads identities
 * only, until it starts.
 */
export function queueFlagWarmup() {
  if (!warmupWanted(this)) return;
  const st = this.state;
  const warm = this.flagWarmup ||= newWarmup();
  // A fit it failed on is left to the Flags view, which builds what it needs as without a warm-up.
  if (warm.running || warm.timer || warm.failedOn === this.flagRegionSource) return;
  const board = { source: this.flagRegionSource, own: st.own, claims: st.claims, choice: st.choice, teams: st.teams };
  const last = warm.board;
  if (last && Object.keys(board).every(key => last[key] === board[key])) return;
  const wait = warm.startedAt + FLAG_WARMUP_EVERY_MS - clock();
  if (wait > 0) {
    warm.timer = setTimeout(() => { warm.timer = null; this.queueFlagWarmup(); }, wait);
    return;
  }
  Object.assign(warm, { board, running: true, startedAt: clock() });
  runQuietly(flagWarmupSteps(this), { wanted: () => warmupWanted(this) && this.flagRegionSource === board.source })
    // A warm-up cut short (Flags shown, a new fit, the campaign over) leaves its board to be made again; the Flags view
    // makes whatever it lacks, as without a warm-up.
    .then(finished => { if (!finished) warm.board = null; }, () => { warm.board = null; warm.failedOn = board.source; })
    .finally(() => { warm.running = false; if (!warm.stopped) this.queueFlagWarmup(); });
}

/** Ends the warm-up for good (App unmounting). */
export function stopFlagWarmup() {
  const warm = this.flagWarmup ||= newWarmup();
  warm.stopped = true;
  clearTimeout(warm.timer);
  warm.timer = null;
  this.flagIndexBuild = null;
}

/** Banner ids of the setup map card: apart from the campaign map's, which stays mounted behind the wizard. */
const SETUP_FLAG_PREFIX = 'setup-';
/**
 * Step 1's map card in Flags mode: every starting team's flag (a nation) or crest (a club) across the land it holds at
 * kick-off, one banner per region exactly as the campaign's Flags mode draws it (mapFlags), on the board the card
 * shows: a world theatre's (`setupMapPreview`) or the chosen country's once it is on screen (`domesticStatus`).
 * `fills` gives a club's land its colour, the ground behind its crest or, with no crest, all it shows. Render-safe;
 * memoised per board. → { flagParts, flagPatterns, fills: Map(territory id → colour) } | null
 */
export function setupMapFlags(setup = this.state.setup) {
  if (!this.geo || !this.flagRegionSource) return null;
  if (!this.setupMapPreview(setup) && !this.domesticStatus(setup).preview) return null;
  this.setupTeams(setup);
  // Clubs wear the crests of the chosen season (`year`, cached with the marks it goes with).
  const { opening, marks, year = null } = this.setupTeamsCache;
  const index = flagIndex(this);
  const cached = this.setupFlagCache;
  if (cached?.index === index && cached.opening === opening && cached.marks === marks) return cached.result;
  const result = layoutBanners(index.components(opening), ownerId => {
    const team = marks[ownerId];
    if (!team) return null;
    return team.kind === 'club' ? { crestUrl: crestUrl(ownerId, year), color: team.col || V4.flagBg }
      : { nationId: team.flagId, color: team.col || V4.flagBg };
  }, { idPrefix: SETUP_FLAG_PREFIX });
  const fills = new Map();
  for (const [territory, ownerId] of Object.entries(opening)) {
    const team = marks[ownerId];
    if (team?.kind === 'club' && team.col) fills.set(territory, team.col);
  }
  const value = { ...result, fills };
  this.setupFlagCache = { index, opening, marks, result: value };
  return value;
}

/**
 * A country's click and hover handlers, made once per country id (they only name the id), so every render hands
 * the map the same functions instead of three new closures for each of ~240 shapes. One cache per geometry, so
 * browsing country maps in setup keeps only the drawn map's ids.
 */
function countryHandlers(app, cid) {
  if (app.countryHandlerGeo !== app.geo) { app.countryHandlers = new Map(); app.countryHandlerGeo = app.geo; }
  const cache = app.countryHandlers;
  let handlers = cache.get(cid);
  if (!handlers) {
    handlers = {
      onClick: () => app.selectCountry(cid),
      onEnter: () => app.setState(s => (s.hoverCid === cid ? null : { hoverCid: cid })),
      // Leaving this land (or tabbing off it) drops its hover, unless another country already took it over.
      onLeave: () => app.setState(s => (s.hoverCid === cid ? { hoverCid: null } : null)),
    };
    cache.set(cid, handlers);
  }
  return handlers;
}

/**
 * Every map shape, plus the banners held territory flies in Flags mode (README §Map rendering, DEC D18/D19).
 * Fills come from `mapVM.countryFill` per `st.mapMode`: Political pastels of each empire's own colour (`politicalFill`), Strength ramp,
 * Fronts win-chance tints, Flags banners (a country flies its *owner's* flag, so an empire reads as one banner);
 * then you-fill (managed only, A-7) and opponent-fill once the fixture is known. Borders come from WorldMap's mesh,
 * so the shapes carry no stroke. Setup shows the nations' pastels (or their flags) on neutral land; a previewed
 * country map paints each section in the colour its starting club takes at kick-off (`countryFill` `preview`).
 * A claimed nation (app/claimMethods.js) is painted as its holder's land (`claimOwnerId`, paintedOwnership) while
 * `ownerId` stays its real holder, nobody: it takes no clicks, tab stop or target.
 */
export function mapCountries() {
  const st = this.state;
  if (!this.geo) return { countries: [], flagPatterns: [] };
  const { teams = {}, selected, flash = {}, phase, mapMode } = st;
  const playing = isPlaying(st);
  const snap = mapSnapshot(this);
  const painted = playing ? paintedOwnership(this, snap) : snap.own;
  const ctx = playing ? this.viewContext(snap.state) : null;
  const identity = playing ? mapVM.mapIdentity(snap.state, ctx) : NO_IDENTITY;
  const strength = playing && mapMode === 'strength' ? mapVM.strengthFills(snap.state, ctx) : null;
  const fronts = playing && mapMode === 'fronts' ? mapVM.frontsFills(snap.state, ctx) : null;
  const domestic = this.domesticMap();
  const preview = domestic && !playing ? homeClubs(domestic) : null;

  const { flagParts, flagPatterns } = this.mapFlags(playing);
  // Keyed on every input of the rows, by identity; fitMap refits geo and displayGeo in place, so on their path maps.
  // The ticker, the compass and hover re-render App many times per match without changing any of them, and the same
  // rows let WorldMap keep its country elements.
  const countries = memo(this.vmCache, 'map:countries', [this.geo.countries, this.geo.paths, this.displayGeo?.paths,
    domestic, preview, phase, snap.own, painted, teams, selected, flash, mapMode, identity.meId, identity.meFill,
    identity.opponentId, strength, fronts, flagParts], () => {
    const rows = [];
    for (const c of this.geo.countries) {
      const p = this.displayGeo?.paths[c.id] || this.geo.paths[c.id];
      if (!p) continue;
      const ownerId = playing ? snap.own[c.id] : null;
      const owner = ownerId ? teams[ownerId] : null;
      const claimOwnerId = playing && !ownerId && teams[painted[c.id]] ? painted[c.id] : null;
      const isSelected = owner && selected === ownerId;
      const parts = flagParts.get(c.id);
      rows.push({
        id: c.id,
        ownerId,
        ...(claimOwnerId ? { claimOwnerId } : {}),
        ownerName: owner?.name,
        selected: !!isSelected,
        name: domestic?.sectionNames[c.id] || NATIONS[c.id]?.[0] || DEPENDENCIES[c.id]?.name || c.name || c.id,
        d: p.d,
        // The mainland's bounds: keyboard focus reveals these, never a date-line-split country's map-wide box.
        bbox: p.bbox,
        flagParts: parts,
        fill: mapVM.countryFill({ countryId: c.id, ownerId: ownerId || claimOwnerId, owner: owner || teams[claimOwnerId] || null,
          mapMode, hasFlagParts: !!parts?.length, setup: phase === 'setup', ...identity, strength, fronts,
          preview: preview?.[c.id] || null }),
        stroke: 'none',
        strokeWidth: 0,
        cursor: owner ? 'pointer' : 'default',
        animation: flash[c.id] ? 'fiFlash 0.9s ease-out' : 'none',
        ...countryHandlers(this, c.id),
      });
    }
    return rows;
  });
  return { countries, flagPatterns };
}

/**
 * Claimed land that lies in a country map's backdrop (app/claimMethods.js; a world map paints its claimed nations as
 * country shapes instead, see mapCountries): `[{ id, ownerId, d, fill, onEnter, onLeave }]`, one row per claimed shape,
 * filled exactly as its holder's territory is in this map mode (identity fills included), so nothing tells them apart
 * but the tooltip. Projected while signing, like every other fill; empty outside a campaign.
 */
export function mapClaims(playing) {
  const st = this.state;
  if (!playing || !isPlaying(st) || !this.geo) return NONE;
  const snap = mapSnapshot(this);
  if (!Object.keys(snap.claims).length) return NONE;
  const land = this.claimLand(snap.state);
  if (!land) return NONE;
  const { teams = {}, mapMode } = st;
  const ctx = this.viewContext(snap.state);
  const identity = mapVM.mapIdentity(snap.state, ctx);
  const strength = mapMode === 'strength' ? mapVM.strengthFills(snap.state, ctx) : null;
  const fronts = mapMode === 'fronts' ? mapVM.frontsFills(snap.state, ctx) : null;
  return memo(this.vmCache, 'map:claims', [snap.claims, land, teams, mapMode, identity.meId, identity.meFill, identity.opponentId,
    strength, fronts, this.geo.paths], () => Object.keys(snap.claims).sort().flatMap(id => {
    const ownerId = snap.claims[id], owner = teams[ownerId], d = land.d.get(id);
    if (!owner || !d || this.geo.paths[id]) return [];
    const { onEnter, onLeave } = countryHandlers(this, id);
    return [{ id, ownerId, d, onEnter, onLeave,
      fill: mapVM.countryFill({ countryId: id, ownerId, owner, mapMode, ...identity, strength, fronts }) }];
  }));
}

/** One label per alive empire (the projected survivors while signing). Uppercase text is the smoke contract. */
export function mapLabels(playing) {
  if (!playing || !CONFIG.showLabels || !this.geo) return NONE;
  const { teams } = this.state;
  const { aliveIds } = mapSnapshot(this);
  // One list per survivors and teams (both replaced, never edited), not a new one for every ticker render.
  return memo(this.vmCache, 'map:labels', [aliveIds, teams], () => aliveIds.filter(id => teams[id]).map(id => ({
    id,
    text: (teams[id].kind === 'club' ? teams[id].code : teams[id].name).toUpperCase(),
  })));
}

/**
 * A capital on every empire that still holds its own homeland; `you` marks the map's "you" (A-7: star). A country
 * section marks the home town itself (`homeX/homeY`); routes still leave from cx/cy, a point well inside.
 */
export function mapHomes(playing) {
  const st = this.state;
  if (!playing || !isPlaying(st) || !this.geo) return [];
  const { teams } = st;
  const { own, aliveIds } = mapSnapshot(this);
  const meId = mapVM.mapMeId(st, this.viewContext());
  const out = [];
  for (const tid of aliveIds) {
    const team = teams[tid];
    if (!team || own[team.home] !== tid) continue;
    const p = this.geo.paths[team.home];
    if (!p) continue;
    out.push({ id: tid, x: p.homeX ?? p.cx, y: p.homeY ?? p.cy, you: tid === meId });
  }
  return out;
}

/**
 * Hover tooltip (README §Interactions): `{ visible, name, held, result, link }` from `mapVM.tooltipModel` —
 * "Held by Italy since Round XII" | "Capital of Italy" | "Held by Italy", "Won 2–1 against Serbia" | "Strength 84.6",
 * "Click to open the Italy squad"; unowned "Not in this theatre" (playing) / "Awaiting campaign" (setup). On a country
 * map the sections are named, "Home of Burnley" on a home section (in setup also "Burnley starts here" on the rest of
 * its starting group).
 * Hidden while another view covers the map (App's `mapVisible` views), so a hover left over from the map never shows
 * on Squad, Match, Ledger or Chronicle; WorldMap drops that hover when the map hides or reframes.
 */
export function tooltip() {
  const st = this.state;
  if (!st.hoverCid || !MAP_VIEWS.has(this.currentView())) return { visible: false, name: '', held: null, result: null, link: null };
  const snap = mapSnapshot(this);
  const playing = isPlaying(st);
  // Claimed land is named by its map (a country map's empty states, the atlas's countries beneath a Europe map).
  const ctx = playing ? { ...this.viewContext(snap.state), claimNames: this.claimLand(snap.state)?.names || null } : {};
  const domestic = this.domesticMap();
  if (!domestic) return mapVM.tooltipModel(snap.state, ctx, st.hoverCid);
  return mapVM.tooltipModel(snap.state, { ...ctx, sectionNames: domestic.sectionNames,
    homeClubs: playing ? null : homeClubs(domestic) }, st.hoverCid);
}

// ---------- v4 WorldMap props (PLAN §3.3 delegates; render-called, pure) ----------

/** The map mode a new App starts in: Political (DEC D18). UI-only, never saved. */
export const DEFAULT_MAP_MODE = mapVM.DEFAULT_MAP_MODE;

/** The empire drawn as "yours" (A-7): the managed team, else the followed team; null outside a campaign. */
export function mapMeId() {
  const st = this.state;
  if (!isPlaying(st)) return null;
  return mapVM.mapMeId(st, this.viewContext());
}

/**
 * The next opponent once the fixture is known (DEC D19, A-7): your selected target, a locked draw, the tactical gate
 * or an unapplied match; null while the compass spins, before the draw, while signing and outside a campaign.
 */
export function mapOpponentId() {
  const st = this.state;
  if (!isPlaying(st)) return null;
  return mapVM.mapOpponentId(st, this.viewContext());
}

/**
 * Ownership the map draws: the projected post-conquest board while signing (DEC D15), else `st.own` (same identity),
 * with claimed nations in their holder's name so borders, outlines and labels treat them as its land (paintedOwnership).
 */
export function mapOwnership() {
  const st = this.state;
  return isPlaying(st) ? paintedOwnership(this, mapSnapshot(this)) : mapSnapshot(this).own;
}

/**
 * The line of attack. While you choose a target it is the dashed preview from your capital to the selected target
 * (C-18, `reach.preview`, WP-TURN), or nothing until one exists; otherwise the drawn `st.atk`. The conquest screen
 * (D1/D2, D§2.3) draws no arrow: `st.atk` of the decided match stays set until the signing, so it is withheld here.
 */
export function mapAttack() {
  const st = this.state;
  if (st.choice) return null;
  if (!st.pendingTarget) return st.atk;
  const preview = this.reachModel()?.preview;
  return preview ? memo(this.vmCache, 'map:attack-preview', [preview], () => ({ ...preview, dashed: true })) : null;
}

/** Compass data for the draw (the HEAD render expression). */
export function mapSpin() {
  const st = this.state;
  return st.spin ? { ...st.spin, angle: st.spin.ang, durationMs: st.spin.spinMs,
    attackerName: st.teams[st.spin.attackerId]?.name, targetName: st.teams[st.spin.targetId]?.name } : null;
}

/**
 * Territory ids the map hatches (DEC D15): the land the signing takes while you choose a player, and the last
 * conquest's land for the flash duration after an AI or spectator conquest; nothing otherwise.
 */
export function mapConquestIds() {
  const st = this.state;
  if (!isPlaying(st)) return NONE;
  if (st.choice) return mapSnapshot(this).taken || NONE;
  return Object.keys(st.flash || {}).length ? st.conquestIds || NONE : NONE;
}

/** The opening camera frame; WorldMap adds the per-breakpoint theatre window (THEATRE_LAYOUT). */
export function mapInitialFocus() {
  return this.viewFocus;
}

/** The phone near frame (A-7, DEC D22): you + your next opponent, or you + every empire in reach while choosing. */
export function mapNearFocus() {
  const st = this.state;
  if (!isPlaying(st)) return null;
  return mapVM.nearFocus(st, this.viewContext());
}

/** Extra WorldMap props, spread last by App's render (§1.2): `meFill` (you-fill only for a managed empire, A-7). */
export function mapProps() {
  const st = this.state;
  if (!isPlaying(st)) return {};
  return { meFill: mapVM.mapIdentity(st, this.viewContext()).meFill };
}
