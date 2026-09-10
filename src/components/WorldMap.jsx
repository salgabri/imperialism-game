import React, { useEffect, useRef } from 'react';
import { C, FONT } from '../theme.js';
import { niceDistance } from '../engine/geo.js';
import { useMapViewport } from '../hooks/useMapViewport.js';
import Icon from './Icon.jsx';
import EmpireLabels from './EmpireLabels.jsx';
import DrawCompass, { AttackVector } from './DrawCompass.jsx';
import FlagPattern from './FlagPattern.jsx';
import './map.css';

/** Accurate, interactive political cartography; every fill comes from ownership. */
export default function WorldMap({
  countries, flagPatterns, graticule, homes, battleMarks, labels, labelGeometry, ownership, oceanLabels = [], attack, spin,
  tooltip, kmPerUnit, legend, viewResetKey, initialFocus, mapMode, onMapMode,
  title, playing, mapRef, svgRef, tipRef, coordRef, onPointerMove, onPointerLeave,
  children, playback,
}) {
  const vp = useMapViewport(svgRef, viewResetKey, initialFocus);
  const k = vp.view.w / (vp.size.width || 960);
  const { key: compassKey, ...compassProps } = spin || {};
  const stop = e => e.stopPropagation();
  const revealedDraw = useRef(null);
  useEffect(() => {
    if (!spin) { revealedDraw.current = null; return; }
    const stage = spin.stage === 'locked' ? 'locked' : 'origin';
    const key = `${spin.key}-${stage}`;
    if (revealedDraw.current === key) return;
    revealedDraw.current = key;
    vp.reveal(stage === 'locked' ? [{ x: spin.x, y: spin.y }, { x: spin.targetX, y: spin.targetY }] : [{ x: spin.x, y: spin.y }]);
  }, [spin?.key, spin?.stage, vp.reveal]);

  return (
    <section ref={mapRef} className={'world-map' + (playing ? '' : ' world-map--setup')} aria-label="Campaign map"
      onPointerDown={e => { if (e.target.closest('button, select, a, summary')) return; vp.handlers.onMouseDown(e); }}
      onPointerMove={e => { vp.handlers.onMouseMove(e); onPointerMove(e); }}
      onPointerUp={vp.handlers.onMouseUp}
      onPointerCancel={vp.handlers.onMouseUp}
      onDoubleClick={vp.handlers.onDoubleClick}
      onPointerLeave={onPointerLeave}
      style={{ cursor: vp.panning ? 'grabbing' : 'grab' }}>
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
                stroke={c.stroke} strokeWidth={c.strokeWidth * k}
                onClick={() => { if (!vp.didPan()) c.onClick(); }}
                onMouseEnter={c.onEnter}
                aria-label={c.name} role={c.ownerId ? 'button' : undefined}
                tabIndex={c.ownerId ? 0 : undefined}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.onClick(); } }}
                style={{ cursor: c.cursor }} />
            </g>
          ))}
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
        {attack && <AttackVector {...attack} k={k} />}
        {spin && <DrawCompass key={compassKey} {...compassProps} k={k} />}
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
            <button className="icon-button" onClick={() => vp.zoomBy(1.6)} title="Zoom in" aria-label="Zoom in"><Icon name="plus" /></button>
            <button className="map-reset" onClick={vp.reset} title="Reset view" aria-label="Reset view">{vp.zoom.toFixed(1)}×</button>
          </div>
        </div>
        {playback}
      </div>}
      {playing && <div className="map-footnote">
        <span>{legend ? legend.text : 'Scroll to zoom · Drag to pan'}</span>
        <span ref={coordRef} className="map-coordinates">Select a territory to inspect its squad</span>
        {kmPerUnit > 0 && <span className="map-distance" title="Approximate equatorial reference distance">≈ {niceDistance(vp.view.w * .12 * kmPerUnit).toLocaleString()} km</span>}
      </div>}
    </section>
  );
}
