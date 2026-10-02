import React, { useEffect, useMemo, useRef, useState } from 'react';
import { C, FONT } from '../theme.js';
import { niceDistance } from '../engine/geo.js';
import { useMapViewport } from '../hooks/useMapViewport.js';
import Icon from './Icon.jsx';
import EmpireLabels from './EmpireLabels.jsx';
import DrawCompass, { AttackVector } from './DrawCompass.jsx';
import FlagPattern from './FlagPattern.jsx';
import { createMapBorderIndex } from '../engine/mapBorders.js';
import './map.css';

/** Accurate, interactive political cartography; every fill comes from ownership. */
export default function WorldMap({
  countries, flagPatterns, graticule, homes, battleMarks, labels, labelGeometry, ownership, oceanLabels = [], attack, spin,
  tooltip, kmPerUnit, legend, viewResetKey, initialFocus, mapMode, onMapMode,
  title, playing, mapRef, svgRef, tipRef, coordRef, onPointerMove, onPointerLeave,
  children, playback, onShowDetails,
  conquestIds = [], followedId, selectedId, paused = false, focusBounds, focusKey,
}) {
  const vp = useMapViewport(svgRef, viewResetKey, initialFocus);
  const k = vp.view.w / (vp.size.width || 960);
  const { key: compassKey, ...compassProps } = spin || {};
  const stop = e => e.stopPropagation();
  const revealedDraw = useRef(null);
  const countryRefs = useRef(new Map());
  const zoomInRef = useRef(null);
  const [keyboardCountry, setKeyboardCountry] = useState(null);
  const interactive = countries.filter(country => country.ownerId);
  const activeCountry = interactive.some(country => country.id === keyboardCountry) ? keyboardCountry : interactive[0]?.id;
  const conquest = new Set(conquestIds);
  const borderIndex = useMemo(() => createMapBorderIndex(labelGeometry || []), [labelGeometry]);
  const borders = borderIndex.resolve(playing ? ownership : {});
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
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); country.onClick(); return; }
    const index = interactive.findIndex(item => item.id === country.id);
    let next;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % interactive.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + interactive.length - 1) % interactive.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = interactive.length - 1;
    if (next != null) { event.preventDefault(); focusCountry(interactive[next].id); }
  };
  useEffect(() => {
    if (!focusBounds) return;
    vp.fitBounds(focusBounds);
  }, [focusKey]);
  useEffect(() => {
    if (!spin) { revealedDraw.current = null; return; }
    const stage = spin.stage === 'locked' ? 'locked' : 'origin';
    const key = `${spin.key}-${stage}`;
    if (revealedDraw.current === key) return;
    revealedDraw.current = key;
    const routePoints = spin.routePoints?.map(point => Array.isArray(point) ? { x: point[0], y: point[1] } : point);
    vp.reveal(stage === 'locked' ? routePoints?.length ? routePoints : [{ x: spin.x, y: spin.y }, { x: spin.targetX, y: spin.targetY }] : [{ x: spin.x, y: spin.y }]);
  }, [spin?.key, spin?.stage, vp.reveal]);

  return (
    <section ref={mapRef} className={'world-map' + (playing ? '' : ' world-map--setup')} aria-label="Campaign map" tabIndex={-1}
      onPointerDown={e => { if (e.target.closest('button, select, a, summary')) return; vp.handlers.onMouseDown(e); }}
      onPointerMove={e => { vp.handlers.onMouseMove(e); onPointerMove(e); }}
      onPointerUp={vp.handlers.onMouseUp}
      onPointerCancel={vp.handlers.onMouseUp}
      onDoubleClick={vp.handlers.onDoubleClick}
      onPointerLeave={onPointerLeave}
      style={{ cursor: vp.panning ? 'grabbing' : 'grab' }}>
      {playing && <a className="map-skip-link" href="#campaign-details" onClick={event => {
        event.preventDefault();
        if (onShowDetails) onShowDetails();
        else document.getElementById('campaign-details')?.focus({ preventScroll: true });
      }}>Skip map to campaign details</a>}
      <svg ref={svgRef} className="political-map" data-testid="world-map"
        viewBox={`${vp.view.x} ${vp.view.y} ${vp.view.w} ${vp.view.h}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          {/* Mainland and nearby islands share a banner; distant regions don't. */}
          {flagPatterns.map(f => <FlagPattern key={f.id} flag={f} />)}
        </defs>
        <path d={graticule.d} fill="none" stroke="#9ebbc0" strokeOpacity=".09" strokeWidth={.6 * k} pointerEvents="none" />
        <g className="country-shapes">
          {countries.map(c => (
            <g key={c.id} className="country-region" style={{ animation: c.animation }}>
              <g className="country-flag-parts" pointerEvents="none">
                {c.flagParts?.map((part, i) => <path key={`${part.id}-${i}`} data-flag-country={c.id}
                  data-flag-component={part.id} d={part.d} fill={part.fill} />)}
              </g>
              <path data-country={c.id} data-owner={c.ownerId || ''} d={c.d} fill={c.fill}
                ref={element => { if (element) countryRefs.current.set(c.id, element); else countryRefs.current.delete(c.id); }}
                data-conquered={conquest.has(c.id) || undefined} data-followed={c.ownerId === followedId || undefined}
                data-selected={c.selected || undefined}
                stroke={conquest.has(c.id) ? '#f2d991' : c.stroke} strokeWidth={(conquest.has(c.id) ? 1.8 : borders.borderD ? 0 : c.strokeWidth) * k}
                onClick={() => { if (!vp.didPan()) c.onClick(); }}
                onMouseEnter={c.onEnter}
                aria-label={c.ownerName ? `${c.name}, held by ${c.ownerName}. Inspect squad.` : c.name} role={c.ownerId ? 'button' : undefined}
                tabIndex={c.ownerId ? c.id === activeCountry ? 0 : -1 : undefined}
                onFocus={event => {
                  setKeyboardCountry(c.id);
                  c.onEnter?.();
                  const bounds = event.currentTarget.getBoundingClientRect();
                  onPointerMove?.({ clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 });
                }}
                onKeyDown={event => navigateCountry(event, c)}
                style={{ cursor: c.cursor }} />
            </g>
          ))}
        </g>
        <g className="ownership-borders" pointerEvents="none" fill="none" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
          <path className="internal-borders" d={borders.internalD} stroke="#bcc4b4" strokeOpacity=".35" strokeWidth={.35 * k} />
          <path className="empire-borders" d={borders.borderD} stroke="#dce0cd" strokeOpacity=".85" strokeWidth={.8 * k} />
          {borders.ownerPaths.filter(border => border.ownerId === followedId && border.ownerId !== selectedId).map(border => <path key={`follow-${border.ownerId}`} d={border.d} stroke="#f5eee0" strokeWidth={1.2 * k} strokeOpacity=".9" />)}
          {borders.ownerPaths.filter(border => border.ownerId === selectedId).map(border => <g key={`select-${border.ownerId}`} data-selected-empire={border.ownerId}>
            <path d={border.d} stroke="#172925" strokeOpacity=".75" strokeWidth={3.2 * k} />
            <path d={border.d} stroke="#f2d991" strokeWidth={1.6 * k} />
          </g>)}
        </g>
        <g pointerEvents="none">
          {homes.filter(h => vp.zoom > 1.5 || homes.length < 55).map(h => (
            <circle key={h.id} cx={h.x} cy={h.y} r={2.1 * k} fill="#e8dfc9" stroke="#243238" strokeWidth={.9 * k} />
          ))}
          {battleMarks.slice(-3).map((b, i) => (
            <circle key={i} cx={b.x} cy={b.y} r={4 * k} fill="none" stroke={C.gold} strokeWidth={1.2 * k} opacity={b.op} />
          ))}
        </g>
        <g aria-hidden="true" pointerEvents="none">
          {oceanLabels.map(lb => <text key={lb.text} x={lb.x} y={lb.y} textAnchor="middle" fill="#afc3c6"
            style={{ fontFamily: FONT.map, fontSize: 12 * k, fontWeight: 500, letterSpacing: 3 * k }}>{lb.text}</text>)}
        </g>
        <EmpireLabels geometry={labelGeometry} ownership={ownership} labels={labels}
          viewBox={vp.view} unitsPerPixel={k} mapMode={mapMode} />
        {attack && <AttackVector {...attack} k={k} paused={paused} />}
        {spin && <DrawCompass key={compassKey} {...compassProps} k={k} paused={paused} />}
      </svg>

      {playing && <div className="map-heading"><h1>{title}</h1></div>}
      <div ref={tipRef} className="map-tooltip" style={{ display: tooltip.visible ? 'block' : 'none' }}>
        <strong>{tooltip.name}</strong><span>{tooltip.sub}</span>
      </div>
      {children}
      {playing && <div className="map-bottom" onPointerEnter={onPointerLeave} onPointerDown={stop} onDoubleClick={stop}>
        <div className="map-tools">
          <div className="map-modes" aria-label="Map display">
            <button type="button" aria-pressed={mapMode === 'political'} onClick={() => onMapMode('political')}>Political</button>
            <button type="button" aria-pressed={mapMode === 'flags'} onClick={() => onMapMode('flags')}>Flags</button>
          </div>
          <div className="map-zoom">
            <button className="icon-button" onClick={() => vp.zoomBy(1 / 1.6)} title="Zoom out" aria-label="Zoom out"><Icon name="minus" /></button>
            <button ref={zoomInRef} className="icon-button" onClick={() => vp.zoomBy(1.6)} title="Zoom in" aria-label="Zoom in"><Icon name="plus" /></button>
            <button className="map-reset" onClick={vp.reset} title="Reset view" aria-label="Reset view">{vp.zoom.toFixed(1)}×</button>
          </div>
          {vp.canRestore && <button type="button" className="map-return" onClick={() => { vp.restore(); zoomInRef.current?.focus(); }}>Back to previous view</button>}
        </div>
        {playback}
      </div>}
      {playing && <div className="map-footnote">
        <span>{legend ? legend.text : 'Scroll to zoom · Drag to pan · Arrow keys select territories'}</span>
        <span ref={coordRef} className="map-coordinates">Select a territory to inspect its squad</span>
        {kmPerUnit > 0 && <span className="map-distance" title="Approximate equatorial reference distance">≈ {niceDistance(vp.view.w * .12 * kmPerUnit).toLocaleString()} km</span>}
      </div>}
    </section>
  );
}
