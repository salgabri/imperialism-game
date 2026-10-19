// Owner: WP-MAP (see PLAN.md §4). The v4 flat map (README §Map rendering, DEC D18–D22, PLAN §3.5):
// sea, graticule, pastel/you/opponent fills, conquest hatch, three border classes, your/opponent outlines,
// capitals, Archivo Narrow labels, the line of attack and the draw compass, plus the your-turn reach veil, the
// map chrome (modes, zoom, return, phone "Whole map"), anchored cards and the hover tooltip. A country map adds its
// neighbouring land as an inert backdrop and shows every home town.
// Stroke widths and glyph sizes are screen px multiplied by k (map units per px). Responsiveness that needs JS
// (label tier, inset, fit windows) comes from the viewport class read in useViewportClass (A-6), never App.render.
import React, { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  useMapViewport, useViewportClass, MAP_INSET, LABEL_MAX_PX, LABEL_MIN_PX, THEATRE_LAYOUT, NEAR_LAYOUT,
  CONQUEST_ARTICLE_PX, conquestLayout,
} from '../hooks/useMapViewport.js';
import Icon from './Icon.jsx';
import EmpireLabels from './EmpireLabels.jsx';
import DrawCompass, { AttackVector } from './DrawCompass.jsx';
import FlagPattern from './FlagPattern.jsx';
import { createMapBorderIndex } from '../engine/mapBorders.js';
import './map.css';

/** README §Map rendering values (tokens.css mirrors them; SVG attributes need literals). */
const PAINT = Object.freeze({
  youFill: '#c4917c', opponentFill: '#c3cfff', ink: '#111417', opponent: '#2f54eb', white: '#ffffff',
  coast: '#9aa7ae', capital: '#30363b',
  // Land outside the theatre (= --land-neutral): the backdrop around a country map, never an owner's colour.
  backdrop: '#e8e9e4',
});
const MODES = [['political', 'Political'], ['strength', 'Strength'], ['fronts', 'Fronts'], ['flags', 'Flags']];
const MAP_FONT = "'Archivo Narrow', 'Arial Narrow', sans-serif";
const TARGET_CARD = { width: 256, compactWidth: 196, height: 150 }; // TargetCard (WP-TURN): 256px, 196px on phone
// Conquest callout (`center` anchors): half its box, plus how far conquest.css moves the card off the centred wrapper
// (translate(-25%, -33%) of a ~224×62 card; translate(-25%, -60%) of a ~190×50 card on phone).
const CALLOUT_CARD = {
  regular: { halfWidth: 115, halfHeight: 33, shiftX: 56, liftY: 20 },
  compact: { halfWidth: 85, halfHeight: 25, shiftX: 48, liftY: 30 },
};
const EMPTY = [];
const NO_TOOLTIP = {};

const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
const stop = event => event.stopPropagation();

/**
 * Identity fills (DEC D18/D19, A-7); the same rule as viewModels/map.js identityFill. Flags mode and flag
 * patterns are never recoloured; you-fill needs `meFill`; Fronts keeps the opponent's win-chance tint.
 */
function identityFill(fill, ownerId, { meId, meFill, opponentId, mapMode }) {
  if (!ownerId || mapMode === 'flags' || fill === 'transparent' || String(fill).startsWith('url(')) return fill;
  if (meFill && meId && ownerId === meId) return PAINT.youFill;
  if (opponentId && ownerId === opponentId && mapMode !== 'fronts') return PAINT.opponentFill;
  return fill;
}

/**
 * Neighbouring land around a country map, for context only: never territory, never interactive. The fill attribute
 * repeats map.css for renderers without the stylesheet. Atlas ids can repeat (Australia and Ashmore share 036), so
 * keys carry the position too.
 */
const Backdrop = memo(function Backdrop({ shapes }) {
  if (!shapes?.length) return null;
  return (
    <g className="map-backdrop" aria-hidden="true" pointerEvents="none" fill={PAINT.backdrop}>
      {shapes.map((shape, i) => <path key={`${shape.id}-${i}`} d={shape.d} />)}
    </g>
  );
});

/** Five-point star, first point straight up (v4 `star(cx, cy, R, r)`). */
export function starPath(cx, cy, outer, inner) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 5, radius = i % 2 ? inner : outer;
    d += `${i ? 'L' : 'M'}${+(cx + Math.cos(angle) * radius).toFixed(3)} ${+(cy + Math.sin(angle) * radius).toFixed(3)}`;
  }
  return `${d}Z`;
}

/** Border classes from the engine mesh; falls back to resolve() if layers() is unavailable. */
function borderLayers(index, ownership) {
  if (typeof index.layers === 'function') return index.layers(ownership);
  const legacy = index.resolve(ownership);
  return { coastD: '', innerD: legacy.internalD, outerD: legacy.borderD, ownerPaths: legacy.ownerPaths };
}

/**
 * Map units → px inside the map, clamped to the overlay inset (PLAN §3.5 anchors). `center` cards are centred on
 * the point (conquest callout; its CSS then moves the card up-left, which the clamp accounts for); `beside` cards sit
 * 22px to the side facing the map's middle, 44px above (M§5.5).
 */
export function placeAnchor(anchor, view, size, { inset = 20, rightEdge = Infinity, compact = false } = {}) {
  const width = size?.width, height = size?.height;
  if (!anchor || ![anchor.x, anchor.y, view?.x, view?.y, view?.w, view?.h, width, height].every(Number.isFinite)
    || view.w <= 0 || view.h <= 0 || width <= 0 || height <= 0) return null;
  const px = (anchor.x - view.x) * width / view.w;
  const py = (anchor.y - view.y) * height / view.h;
  const right = Math.min(width, rightEdge);
  if (anchor.align === 'beside') {
    // Right of the point by default; flip left when the card would cross the right inset (M§5.5, WP-TURN).
    const cardWidth = compact ? TARGET_CARD.compactWidth : TARGET_CARD.width;
    const side = px + 22 + cardWidth > right - inset ? 'left' : 'right';
    const left = side === 'left'
      ? clamp(px - 22, inset + cardWidth, right - inset)
      : clamp(px + 22, inset, right - inset - cardWidth);
    return { side, left: Math.round(left), top: Math.round(clamp(py - 44, inset, height - inset - TARGET_CARD.height)), px, py };
  }
  // The card is drawn shifted left and lifted off the anchor point, so clamp its drawn box, not the wrapper's: near the
  // top or left edge of a panned map the lift/shift would otherwise push it past the inset.
  const { halfWidth, halfHeight, shiftX, liftY } = CALLOUT_CARD[compact ? 'compact' : 'regular'];
  return { side: null, left: Math.round(clamp(px, inset + halfWidth + shiftX, right - inset - halfWidth + shiftX)),
    top: Math.round(clamp(py, inset + halfHeight + liftY, height - inset - halfHeight + liftY)), px, py };
}

/** Accurate, interactive political cartography; every fill comes from ownership. */
export default function WorldMap({
  countries = EMPTY, flagPatterns = EMPTY, graticule, homes = EMPTY, labels = EMPTY, labelGeometry, ownership,
  oceanLabels = EMPTY, attack, spin, tooltip, viewResetKey, initialFocus, mapMode = 'political', onMapMode,
  playing = false, mapRef, svgRef, tipRef, onPointerMove, onPointerLeave, children, onShowDetails,
  conquestIds = EMPTY, followedId, selectedId, paused = false, focusBounds, focusKey, hidden = false,
  focusLayout = null, nearFocus = null, meId = null, opponentId = null, meFill = false, reach = null,
  wholeMap = false, onWholeMap, anchors = EMPTY,
  // A country map: its neighbouring land (inert backdrop) and every home town shown at any zoom.
  backdrop = EMPTY, showAllHomes = false,
  // Accepted for the App contract but not drawn in v4 (PLAN §3.5, DEC D21): battle scars, km scale, LAT/LON, legend, title.
  battleMarks, kmPerUnit, coordRef, legend, title,
}) {
  const fallbackSvgRef = useRef(null);
  const svg = svgRef || fallbackSvgRef;
  const breakpoint = useViewportClass();
  const breakpointRef = useRef(breakpoint);
  breakpointRef.current = breakpoint;
  const inset = MAP_INSET[breakpoint];
  const phoneFrame = breakpoint === 'phone' && !wholeMap && nearFocus
    && [nearFocus.x, nearFocus.y, nearFocus.w, nearFocus.h].every(Number.isFinite) && (nearFocus.w > 0 || nearFocus.h > 0)
    ? nearFocus : null;
  const cameraFocus = phoneFrame ? { ...phoneFrame, layout: NEAR_LAYOUT }
    : initialFocus ? { ...initialFocus, layout: initialFocus.layout || THEATRE_LAYOUT[breakpoint] } : null;
  // The breakpoint is the fit key: an untouched conquest fit re-resolves conquestLayout(breakpoint) when it changes.
  const vp = useMapViewport(svg, viewResetKey, cameraFocus, breakpoint);
  const k = vp.view.w / (vp.size.width || 960);
  const { key: compassKey, ...compassProps } = spin || {};
  const revealedDraw = useRef(null);
  const countryRefs = useRef(new Map());
  const zoomInRef = useRef(null);
  const hatchId = `map-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [keyboardCountry, setKeyboardCountry] = useState(null);

  // Your turn (C-18, DEC D21): in-reach empires are the only targets; everything else is veiled and inert.
  const reachIds = reach && Array.isArray(reach.ids) ? reach.ids : null;
  const choosing = !!reachIds;
  const inReach = new Set(reachIds || EMPTY);
  const kept = new Set(choosing ? (reach.keepIds || [meId, ...reachIds]).filter(Boolean) : EMPTY);
  const reachStateOf = country => !choosing ? undefined
    : inReach.has(country.ownerId) ? 'in' : kept.has(country.ownerId) ? 'kept' : 'out';
  const interactive = countries.filter(country => country.ownerId && (!choosing || inReach.has(country.ownerId)));
  // The roving tab stop starts on the preselected target while you choose, so it matches the checked row.
  const preferredCountry = choosing ? interactive.find(country => country.ownerId === reach.selectedId)?.id : undefined;
  const activeCountry = interactive.some(country => country.id === keyboardCountry) ? keyboardCountry
    : preferredCountry ?? interactive[0]?.id;
  const actionPhrase = reachState => reachState === 'in' ? ' Choose as target.' : reachState === 'out' ? ' Out of reach.'
    : reachState === 'kept' ? '' : ' Inspect squad.';

  const hatchSet = new Set(conquestIds || EMPTY);
  const hatched = countries.filter(country => hatchSet.has(country.id));
  const borderIndex = useMemo(() => createMapBorderIndex(labelGeometry || EMPTY), [labelGeometry]);
  const mesh = borderLayers(borderIndex, playing ? ownership || {} : {});
  const meshReady = !!(mesh.coastD || mesh.innerD || mesh.outerD);
  const outlineOf = id => (id == null ? '' : mesh.ownerPaths.find(path => path.ownerId === String(id))?.d || '');
  const youOutline = outlineOf(meId), opponentOutline = opponentId === meId ? '' : outlineOf(opponentId);
  const identity = { meId, meFill, opponentId, mapMode };
  const isYou = home => !!home.you || (meId != null && home.id === meId);
  // A crowded world map keeps capitals for closer zooms; a country map always shows its home towns.
  const shownHomes = homes.filter(home => (!choosing || kept.has(home.id))
    && (isYou(home) || showAllHomes || vp.zoom > 1.5 || homes.length < 55));
  const shownLabels = choosing ? labels.filter(label => kept.has(label.id)) : labels;
  const tip = tooltip || NO_TOOLTIP;
  const rightEdge = focusLayout === 'conquest' && (breakpoint === 'wide' || breakpoint === 'std')
    ? vp.size.width - CONQUEST_ARTICLE_PX : Infinity;

  const focusCountry = id => {
    setKeyboardCountry(id);
    const path = countryRefs.current.get(id);
    path?.focus();
    try {
      const bounds = path?.getBBox();
      if (bounds) vp.reveal([{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y + bounds.height }]);
    } catch { /* A detached SVG cannot provide bounds yet. */ }
  };
  const navigateCountry = (event, country) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); country.onClick?.(); return; }
    const index = interactive.findIndex(item => item.id === country.id);
    if (index < 0) return;
    let next;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % interactive.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + interactive.length - 1) % interactive.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = interactive.length - 1;
    if (next != null) { event.preventDefault(); focusCountry(interactive[next].id); }
  };

  // Explicit fits (conquest framing A-2, history inspection) and the return after a conquest is signed.
  const lastFocus = useRef({ key: Symbol('mount'), layout: null });
  useEffect(() => {
    const previous = lastFocus.current;
    lastFocus.current = { key: focusKey, layout: focusLayout };
    if (focusBounds && previous.key !== focusKey) {
      // The D1 window is computed from the canvas fitBounds measures (the map widens in this same commit).
      vp.fitBounds(focusBounds, focusLayout === 'conquest'
        ? canvas => conquestLayout(breakpointRef.current, canvas.width) : undefined);
    } else if (previous.layout === 'conquest' && focusLayout !== 'conquest' && vp.canRestore) {
      vp.restore();
    }
  }, [focusKey, focusLayout]);
  useEffect(() => {
    if (!spin) { revealedDraw.current = null; return; }
    const stage = spin.stage === 'locked' ? 'locked' : 'origin';
    const key = `${spin.key}-${stage}`;
    if (revealedDraw.current === key) return;
    revealedDraw.current = key;
    const routePoints = spin.routePoints?.map(point => Array.isArray(point) ? { x: point[0], y: point[1] } : point);
    vp.reveal(stage === 'locked' ? routePoints?.length ? routePoints : [{ x: spin.x, y: spin.y }, { x: spin.targetX, y: spin.targetY }] : [{ x: spin.x, y: spin.y }]);
  }, [spin?.key, spin?.stage, vp.reveal]);

  // While choosing, leaving the land (off the map or onto its chrome) is a move over a non-target, so App's
  // handleMapMove clears the hovered target and the target card returns to the selection.
  const forwardLeave = event => {
    if (choosing) onPointerMove?.({ clientX: event.clientX, clientY: event.clientY, target: event.currentTarget });
  };
  const leaveControls = event => { forwardLeave(event); onPointerLeave?.(); };

  // A still pointer keeps its last hover across a view change: hiding the map (another view), reframing it (the
  // conquest fit, history inspection) or entering the campaign moves the land from under it without a pointer event,
  // so the old country's card would come back or stay up. When that context changes while a hover is held, drop it
  // (App's onPointerLeave clears it); the next move over land shows the right card. Runs after every commit, but
  // only a real change with a tooltip up (or just hidden by the change) calls out.
  const tipContext = `${!!hidden}|${focusLayout || ''}|${focusKey ?? ''}|${!!playing}`;
  const lastTip = useRef({ context: tipContext, visible: false });
  useEffect(() => {
    const previous = lastTip.current;
    lastTip.current = { context: tipContext, visible: !!tip.visible };
    if (previous.context !== tipContext && (previous.visible || tip.visible)) onPointerLeave?.();
  });
  const veiled = choosing ? countries.filter(c => !kept.has(c.ownerId)) : EMPTY;
  const showWhole = playing && typeof onWholeMap === 'function' && (!!nearFocus || wholeMap);

  return (
    <section ref={mapRef} className={'world-map' + (playing ? '' : ' world-map--setup')} aria-label="Campaign map" tabIndex={-1}
      hidden={hidden || undefined} data-map-mode={mapMode} data-breakpoint={breakpoint}
      data-reach={choosing ? 'choose' : undefined} data-focus-layout={focusLayout || undefined}
      onPointerDown={e => { if (e.target.closest?.('button, select, a, summary')) return; vp.handlers.onMouseDown(e); }}
      onPointerMove={e => { vp.handlers.onMouseMove(e); onPointerMove?.(e); }}
      onPointerUp={vp.handlers.onMouseUp}
      onPointerCancel={vp.handlers.onMouseUp}
      onDoubleClick={vp.handlers.onDoubleClick}
      onPointerLeave={event => { forwardLeave(event); onPointerLeave?.(event); }}
      style={{ cursor: vp.panning ? 'grabbing' : 'grab' }}>
      {playing && <a className="map-skip-link" href="#campaign-details" onClick={event => {
        event.preventDefault();
        if (onShowDetails) onShowDetails();
        else document.getElementById('campaign-details')?.focus({ preventScroll: true });
      }}>Skip map to campaign details</a>}
      <svg ref={svg} className="political-map" data-testid="world-map"
        viewBox={`${vp.view.x} ${vp.view.y} ${vp.view.w} ${vp.view.h}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          {/* Mainland and nearby islands share a banner; distant regions don't. */}
          {flagPatterns.map(f => <FlagPattern key={f.id} flag={f} />)}
          {/* README: white 1.6px lines every 5px at 45°, 60% opacity — its own pattern, never a flag tile. */}
          {hatched.length > 0 && <pattern id={hatchId} data-conquest-hatch-pattern="" patternUnits="userSpaceOnUse"
            width={5 * k} height={5 * k} patternTransform="rotate(45)">
            <rect width={1.6 * k} height={5 * k} fill="rgba(255,255,255,.6)" />
          </pattern>}
        </defs>
        <path className="map-graticule" d={graticule?.d || ''} fill="none" stroke={PAINT.white} strokeOpacity={.55}
          strokeWidth={.6 * k} pointerEvents="none" />
        <Backdrop shapes={backdrop} />
        <g className="country-shapes">
          {/* Hover: entering land shows its card; leaving it, or tabbing off it, drops that card (App's handleMapMove
              also drops it over the sea). A window blur has no relatedTarget and keeps the card. */}
          {countries.map(c => {
            const reachState = reachStateOf(c);
            const targetable = !choosing || reachState === 'in';
            const conquered = hatchSet.has(c.id);
            const tabbable = !!c.ownerId && targetable;
            return (
              <g key={c.id} className="country-region" style={{ animation: c.animation }}>
                <g className="country-flag-parts" pointerEvents="none">
                  {c.flagParts?.map((part, i) => <path key={`${part.id}-${i}`} data-flag-country={c.id}
                    data-flag-component={part.id} d={part.d} fill={part.fill} />)}
                </g>
                <path data-country={c.id} data-owner={c.ownerId || ''} d={c.d} fill={identityFill(c.fill, c.ownerId, identity)}
                  ref={element => { if (element) countryRefs.current.set(c.id, element); else countryRefs.current.delete(c.id); }}
                  data-conquered={conquered || undefined} data-followed={(c.ownerId && c.ownerId === followedId) || undefined}
                  data-selected={c.selected || undefined} data-reach={reachState}
                  stroke={meshReady ? 'none' : c.stroke} strokeWidth={meshReady ? 0 : (c.strokeWidth || 0) * k}
                  onClick={() => { if (!vp.didPan() && targetable) c.onClick?.(); }}
                  onMouseEnter={choosing ? undefined : c.onEnter}
                  onMouseLeave={c.onLeave}
                  aria-label={c.ownerName ? `${c.name}, held by ${c.ownerName}.${actionPhrase(reachState)}` : c.name}
                  role={tabbable ? 'button' : undefined}
                  tabIndex={tabbable ? c.id === activeCountry ? 0 : -1 : undefined}
                  onFocus={event => {
                    setKeyboardCountry(c.id);
                    if (!choosing) c.onEnter?.();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    onPointerMove?.({ clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2, target: event.currentTarget });
                  }}
                  onBlur={event => { if (event.relatedTarget) c.onLeave?.(); }}
                  onKeyDown={event => navigateCountry(event, c)}
                  style={{ cursor: targetable ? c.cursor : 'default' }} />
              </g>
            );
          })}
        </g>
        {hatched.length > 0 && <g className="conquest-hatch" pointerEvents="none" aria-hidden="true">
          {hatched.map(c => <path key={c.id} data-conquest-hatch={c.id} d={c.d} fillRule="evenodd" fill={`url(#${hatchId})`} />)}
        </g>}
        <g className="ownership-borders" pointerEvents="none" fill="none" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
          <path className="internal-borders" d={mesh.innerD} stroke={PAINT.white} strokeOpacity={.75} strokeWidth={.6 * k} />
          <path className="empire-borders" d={mesh.outerD} stroke={PAINT.white} strokeWidth={1.5 * k} />
          <path className="coast-borders" d={mesh.coastD} stroke={PAINT.coast} strokeWidth={.6 * k} />
        </g>
        {/* One veil path (nonzero fill): no per-country copies in the DOM and no anti-aliased seams between them. */}
        {choosing && <g className="reach-veil-layer" pointerEvents="none" aria-hidden="true">
          {veiled.length > 0 && <path className="reach-veil" data-veil-countries={veiled.map(c => c.id).join(' ')}
            d={veiled.map(c => c.d).join(' ')} />}
        </g>}
        <g className="country-outlines" pointerEvents="none" fill="none" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
          {/* DEC D21 dash 5 3 at 2px: butt caps, or round caps would grow each dash by 2px and close the 3px gaps.
              The outline is one chained run per border (mapBorders chainSegments), so the dash never restarts. */}
          {choosing && reachIds.map(id => {
            const d = outlineOf(id);
            return d ? <path key={`reach-${id}`} className="reach-outline" data-reach-outline={id} d={d}
              stroke={PAINT.opponent} strokeWidth={2 * k} strokeDasharray={`${5 * k} ${3 * k}`} strokeLinecap="butt" /> : null;
          })}
          {youOutline ? <path className="country-outline country-outline--you" data-outline="you"
            d={youOutline} stroke={PAINT.ink} strokeWidth={1.4 * k} /> : null}
          {opponentOutline ? <path className="country-outline country-outline--opponent"
            data-outline="opponent" d={opponentOutline} stroke={PAINT.opponent} strokeWidth={1.8 * k} /> : null}
        </g>
        <g className="map-capitals" pointerEvents="none" aria-hidden="true">
          {shownHomes.map(home => isYou(home)
            ? <path key={home.id} data-capital={home.id} data-capital-you="true" d={starPath(home.x, home.y, 5.2 * k, 2.2 * k)}
              fill={PAINT.ink} stroke={PAINT.white} strokeWidth={.9 * k} />
            : <rect key={home.id} data-capital={home.id} x={home.x - 1.9 * k} y={home.y - 1.9 * k} width={3.8 * k} height={3.8 * k}
              fill={PAINT.capital} stroke={PAINT.white} strokeWidth={.8 * k} />)}
        </g>
        <g aria-hidden="true" pointerEvents="none">
          {oceanLabels.map(lb => <text key={lb.text} x={lb.x} y={lb.y} textAnchor="middle" fill={PAINT.coast}
            style={{ fontFamily: MAP_FONT, fontSize: 12 * k, fontWeight: 600, letterSpacing: .14 * 12 * k, textTransform: 'uppercase' }}>{lb.text}</text>)}
        </g>
        {/* Labels wait for the opening camera (laying out 100 names for a stand-in view is wasted work) and keep
            their last layout while a drag is under way. */}
        <EmpireLabels geometry={labelGeometry} ownership={ownership} labels={vp.framing ? EMPTY : shownLabels}
          viewBox={vp.view} unitsPerPixel={k} mapMode={mapMode} meId={meId}
          maxFontPx={LABEL_MAX_PX[breakpoint]} minFontPx={LABEL_MIN_PX} holdCamera={vp.panning} />
        {attack && <AttackVector {...attack} k={k} paused={paused} />}
        {spin && <DrawCompass key={compassKey} {...compassProps} k={k} paused={paused} />}
      </svg>

      <div ref={tipRef} className="map-tooltip" aria-hidden="true"
        style={{ display: tip.visible && !choosing && !hidden ? 'block' : 'none' }}>
        <strong className="map-tooltip__name">{tip.name}</strong>
        {tip.held ? <span className="map-tooltip__held">{tip.held}</span>
          : tip.sub ? <span className="map-tooltip__held">{tip.sub}</span> : null}
        {tip.result && <span className="map-tooltip__result">{tip.result}</span>}
        {tip.link && <span className="map-tooltip__link">{tip.link}</span>}
      </div>
      {anchors.map(anchor => {
        const place = placeAnchor(anchor, vp.view, vp.size, { inset, rightEdge, compact: breakpoint === 'phone' });
        return place && <div key={anchor.key} className="map-anchor" data-anchor={anchor.key}
          data-align={anchor.align === 'beside' ? 'beside' : 'center'} data-side={place.side || undefined}
          style={{ left: place.left, top: place.top }}>{anchor.node}</div>;
      })}
      {children}
      {playing && <div className="map-modes" role="group" aria-label="Map display"
        onPointerDown={stop} onDoubleClick={stop} onPointerEnter={leaveControls}>
        {MODES.map(([id, label]) => <button key={id} type="button" className="map-modes__btn" aria-pressed={mapMode === id}
          onClick={() => onMapMode?.(id)}>{label}</button>)}
      </div>}
      {playing && <div className="map-zoom" role="group" aria-label="Zoom"
        onPointerDown={stop} onDoubleClick={stop} onPointerEnter={leaveControls}>
        <button ref={zoomInRef} type="button" className="map-zoom__btn" onClick={() => vp.zoomBy(1.6)} title="Zoom in" aria-label="Zoom in"><Icon name="plus" size={16} /></button>
        <button type="button" className="map-zoom__btn" onClick={() => vp.zoomBy(1 / 1.6)} title="Zoom out" aria-label="Zoom out"><Icon name="minus" size={16} /></button>
        <button type="button" className="map-zoom__btn map-reset" onClick={() => vp.reset()} title="Reset view" aria-label="Reset view">{vp.zoom.toFixed(1)}×</button>
      </div>}
      {playing && vp.canRestore && <button type="button" className="map-return" onPointerDown={stop} onDoubleClick={stop}
        onClick={event => {
          const doc = event.currentTarget.ownerDocument;
          const section = event.currentTarget.closest('.world-map');
          vp.restore();
          // This button unmounts once the camera is restored. Hand focus to the zoom control; below 700px that group
          // is display:none and cannot take focus, so fall back to "Whole map", then the map itself (never <body>).
          for (const target of [zoomInRef.current, section?.querySelector('.map-whole'), section]) {
            target?.focus?.({ preventScroll: true });
            if (target && doc.activeElement === target) break;
          }
        }}>Back to previous view</button>}
      {showWhole && <button type="button" className="map-whole" onPointerDown={stop} onDoubleClick={stop}
        onClick={() => onWholeMap()}>{wholeMap ? 'Your fronts' : 'Whole map'}</button>}
    </section>
  );
}
