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
import { layoutFlagSymbol } from '../engine/flagSymbolLayout.js';
import { memo } from '../viewModels/format.js';
import * as mapVM from '../viewModels/map.js';

const NONE = Object.freeze([]);
const NO_IDENTITY = Object.freeze({ meId: null, meFill: false, opponentId: null });
const isPlaying = st => st?.phase === 'playing' || st?.phase === 'victory';
/** The views that show the map (App.render's `mapVisible`); every other view hides it. */
const MAP_VIEWS = new Set(['setup', 'map', 'conquest']);

const homeClubCache = new WeakMap();
/**
 * Section id → the club that starts there on a loaded country map (`{ clubs }` from engine/domestic.js), for the
 * setup preview fill and the tooltip. Memoised per decoded map; pure (a module WeakMap, never React state).
 */
export function homeClubs(domestic) {
  if (!domestic?.clubs) return {};
  if (!homeClubCache.has(domestic)) {
    homeClubCache.set(domestic, Object.fromEntries(domestic.clubs.map(club => [club.homeSection, club])));
  }
  return homeClubCache.get(domestic);
}

/**
 * The campaign as the map draws it. While the manager signs a player (`st.choice`) the map shows the projected
 * post-conquest board (DEC D15, D§2.3 / D§10): every loser cid belongs to the winner and the loser is no longer drawn,
 * so fills, flags, borders, capitals, labels and the tooltip agree with the hatch. The projection comes from
 * `this.conquestPreview()` (WP-CONQ) and is memoised on state identities, so `ownership` keeps one identity across
 * renders (label engine, border mesh and flag-region caches). → { state, own, aliveIds, taken|null }
 */
function mapSnapshot(app) {
  const st = app.state;
  const plain = { state: st, own: st.own || {}, aliveIds: st.aliveIds || NONE, taken: null };
  if (!st.choice || !isPlaying(st)) return plain;
  const projected = memo(app.vmCache, 'map:projection', [st.choice, st.match, st.own, st.teams, st.aliveIds], () => {
    const preview = app.conquestPreview();
    if (!preview?.own) return null;
    return { own: preview.own, aliveIds: (st.aliveIds || NONE).filter(id => id !== preview.loserId), taken: preview.taken || NONE };
  });
  return projected ? { state: { ...st, own: projected.own, aliveIds: projected.aliveIds }, ...projected } : plain;
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
  // Only a real change sets state, so moving over the sea with no hover renders nothing.
  if (st.hoverCid != null && !e?.target?.closest?.('path[data-country]')) this.setState({ hoverCid: null });
  if (st.pendingTarget) {
    const owner = e?.target?.closest?.('[data-reach="in"]')?.dataset?.owner || null;
    if (owner !== (st.targetHoverId ?? null)) this.hoverTarget(owner);
  }
}

/** One regional banner across mainland and nearby islands, not tiny repeats. */
export function mapFlags(playing) {
  const { mapMode, teams } = this.state;
  const empty = { flagParts: new Map(), flagPatterns: [] };
  if (mapMode !== 'flags' || !this.flagComponents) return empty;
  if (playing && !Object.values(teams).some(team => team.flagId)) return empty;
  // While signing, the projected board: the taken land already flies the winner's banner (DEC D15).
  const components = this.flagComponents.components(playing ? mapSnapshot(this).own : this.setupFlagOwnership);
  const cached = this.flagLayoutCache;
  if (cached?.components === components && cached.teams === teams && cached.playing === playing) return cached.result;

  const flagParts = new Map();
  const flagPatterns = [];
  for (const component of components) {
    const owner = playing ? teams[component.ownerId] : null;
    const nationId = playing ? owner?.flagId : NATIONS[component.ownerId] ? component.ownerId : DEPENDENCIES[component.ownerId]?.of;
    const url = flagUrl(nationId);
    if (!url) continue;
    // Owner + the lowest stable piece id is short and unique, including when
    // a country's mainland and overseas polygons need different flag tiles.
    const id = component.key.split('|').slice(0, 2).join('-').replace(/[^a-zA-Z0-9_-]/g, '-');
    const b = component.bbox;
    const symbolProfile = FLAG_SYMBOLS[FLAG_CODES[nationId]];
    const symbolLayout = symbolProfile ? layoutFlagSymbol(component, symbolProfile) : null;
    // README §Map rendering: flag-bg behind a flag (clubs keep their colour).
    flagPatterns.push({ id, ownerId: component.ownerId, url, color: owner?.col || V4.flagBg,
      symbolProfile, symbolLayout,
      fieldUrl: symbolProfile ? `${import.meta.env.BASE_URL}${symbolProfile.fieldFile}` : null,
      symbolUrl: symbolProfile ? `${import.meta.env.BASE_URL}${symbolProfile.symbolFile}` : null,
      bbox: { x: b.x - .1, y: b.y - .1, w: b.w + .2, h: b.h + .2 } });
    for (const part of component.parts) {
      if (!flagParts.has(part.countryId)) flagParts.set(part.countryId, []);
      flagParts.get(part.countryId).push({ id, fill: `url(#fi-flag-${id})`,
        d: part.rings.map(ring => 'M' + ring.map(point => point.join(',')).join('L') + 'Z').join('') });
    }
  }
  const result = { flagParts, flagPatterns };
  this.flagLayoutCache = { components, teams, playing, result };
  return result;
}

/**
 * A country's click and hover handlers, made once per country id (they only name the id), so every render hands
 * the map the same functions instead of three new closures for each of ~240 shapes.
 */
function countryHandlers(app, cid) {
  const cache = app.countryHandlers || (app.countryHandlers = new Map());
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
 * Every map shape, plus the flag patterns held territory is filled with (README §Map rendering, DEC D18/D19).
 * Fills come from `mapVM.countryFill` per `st.mapMode`: Political empire pastels (`empireFill`), Strength ramp,
 * Fronts win-chance tints, Flags banners (a country flies its *owner's* flag, so an empire reads as one banner);
 * then you-fill (managed only, A-7) and opponent-fill once the fixture is known. Borders come from WorldMap's mesh,
 * so the shapes carry no stroke. Setup shows the nations' pastels (or their flags) on neutral land; a previewed
 * country map paints each section in the colour its starting club takes at kick-off (`countryFill` `preview`).
 */
export function mapCountries() {
  const st = this.state;
  if (!this.geo) return { countries: [], flagPatterns: [] };
  const { teams = {}, selected, flash = {}, phase, mapMode } = st;
  const playing = isPlaying(st);
  const snap = mapSnapshot(this);
  const ctx = playing ? this.viewContext(snap.state) : null;
  const identity = playing ? mapVM.mapIdentity(snap.state, ctx) : NO_IDENTITY;
  const strength = playing && mapMode === 'strength' ? mapVM.strengthFills(snap.state, ctx) : null;
  const fronts = playing && mapMode === 'fronts' ? mapVM.frontsFills(snap.state, ctx) : null;
  const domestic = this.domesticMap();
  const preview = domestic && !playing ? homeClubs(domestic) : null;

  const countries = [];
  const { flagParts, flagPatterns } = this.mapFlags(playing);
  for (const c of this.geo.countries) {
    const p = this.displayGeo?.paths[c.id] || this.geo.paths[c.id];
    if (!p) continue;
    const ownerId = playing ? snap.own[c.id] : null;
    const owner = ownerId ? teams[ownerId] : null;
    const isSelected = owner && selected === ownerId;
    const parts = flagParts.get(c.id);
    countries.push({
      id: c.id,
      ownerId,
      ownerName: owner?.name,
      selected: !!isSelected,
      name: domestic?.sectionNames[c.id] || NATIONS[c.id]?.[0] || DEPENDENCIES[c.id]?.name || c.name || c.id,
      d: p.d,
      flagParts: parts,
      fill: mapVM.countryFill({ countryId: c.id, ownerId, owner, mapMode, hasFlagParts: !!parts?.length,
        setup: phase === 'setup', ...identity, strength, fronts, preview: preview?.[c.id] || null }),
      stroke: 'none',
      strokeWidth: 0,
      cursor: owner ? 'pointer' : 'default',
      animation: flash[c.id] ? 'fiFlash 0.9s ease-out' : 'none',
      ...countryHandlers(this, c.id),
    });
  }
  return { countries, flagPatterns };
}

/** One label per alive empire (the projected survivors while signing). Uppercase text is the smoke contract. */
export function mapLabels(playing) {
  if (!playing || !CONFIG.showLabels || !this.geo) return [];
  const { teams } = this.state;
  return mapSnapshot(this).aliveIds.filter(id => teams[id]).map(id => ({
    id,
    text: (teams[id].kind === 'club' ? teams[id].code : teams[id].name).toUpperCase(),
  }));
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
 * map the sections are named, "Home of Burnley" on a home section (in setup: the club starting there).
 * Hidden while another view covers the map (App's `mapVisible` views), so a hover left over from the map never shows
 * on Squad, Match, Ledger or Chronicle; WorldMap drops that hover when the map hides or reframes.
 */
export function tooltip() {
  const st = this.state;
  if (!st.hoverCid || !MAP_VIEWS.has(this.currentView())) return { visible: false, name: '', held: null, result: null, link: null };
  const snap = mapSnapshot(this);
  const ctx = isPlaying(st) ? this.viewContext(snap.state) : {};
  const domestic = this.domesticMap();
  if (!domestic) return mapVM.tooltipModel(snap.state, ctx, st.hoverCid);
  return mapVM.tooltipModel(snap.state, { ...ctx, sectionNames: domestic.sectionNames,
    homeClubs: isPlaying(st) ? null : homeClubs(domestic) }, st.hoverCid);
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

/** Ownership the map draws: the projected post-conquest board while signing (DEC D15), else `st.own` (same identity). */
export function mapOwnership() {
  return mapSnapshot(this).own;
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
