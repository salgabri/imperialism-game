import React from 'react';
import { C, FONT } from '../theme.js';
import { niceDistance } from '../engine/geo.js';
import { useMapViewport } from '../hooks/useMapViewport.js';

/**
 * The theatre. Country fills are the whole game state made visible, so this stays
 * a pure render of pre-computed geometry.
 *
 * Tooltip position and the lat/lon readout are written straight to the DOM via
 * refs — they follow the pointer, and re-rendering ~180 country paths on every
 * mousemove would be wasteful.
 */
export default function WorldMap({
  countries,
  flagPatterns,
  graticule,
  homes,
  battleMarks,
  labels,
  attack,
  spin,
  tooltip,
  kmPerUnit,
  legend,
  viewResetKey,
  mapRef,
  svgRef,
  tipRef,
  coordRef,
  onPointerMove,
  onPointerLeave,
  children,
}) {
  const vp = useMapViewport(svgRef, viewResetKey);
  // Counter-scale: strokes, labels and markers are UI, not terrain, so they keep
  // a constant weight on screen however far the map is zoomed in.
  const k = 1 / vp.zoom;

  const handleMove = e => {
    vp.handlers.onMouseMove(e);
    onPointerMove(e);
  };

  return (
    <div
      ref={mapRef}
      onMouseDown={vp.handlers.onMouseDown}
      onMouseMove={handleMove}
      onMouseUp={vp.handlers.onMouseUp}
      onDoubleClick={vp.handlers.onDoubleClick}
      onMouseLeave={onPointerLeave}
      style={{
        cursor: vp.panning ? 'grabbing' : 'grab',
        position: 'relative',
        flex: 1,
        minWidth: 0,
        background:
          'repeating-linear-gradient(45deg, transparent 0px, transparent 14px, rgba(160,200,240,0.028) 14px, rgba(160,200,240,0.028) 15px), ' +
          `radial-gradient(1100px 640px at 50% 42%, ${C.ocean} 0%, ${C.deep} 75%)`,
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`${vp.view.x} ${vp.view.y} ${vp.view.w} ${vp.view.h}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <defs>
          <filter id="fiLand" x="-5%" y="-5%" width="110%" height="110%">
            <feDropShadow dx="0" dy="1.6" stdDeviation="2.2" floodColor={C.shadow} floodOpacity="0.55" />
          </filter>
          {/*
            One pattern per held territory, sized to that country's mainland
            bounds. The 4:3 viewBox is stretched to fill, so the whole flag design
            stays visible instead of being cropped; outlying islands repeat the
            tile. The colour rect underneath shows through if the SVG fails.
          */}
          {flagPatterns.map(f => (
            <pattern
              key={f.id}
              id={`fi-flag-${f.id}`}
              patternUnits="userSpaceOnUse"
              x={f.bbox.x}
              y={f.bbox.y}
              width={f.bbox.w}
              height={f.bbox.h}
              viewBox="0 0 4 3"
              preserveAspectRatio="none"
            >
              <rect x="0" y="0" width="4" height="3" fill={f.color} />
              <image href={f.url} x="0" y="0" width="4" height="3" preserveAspectRatio="none" />
            </pattern>
          ))}
        </defs>

        <path d={graticule.d} fill="none" stroke="rgba(160,200,240,0.11)" strokeWidth={0.5 * k} style={{ pointerEvents: 'none' }} />
        <g>
          {graticule.labels.map(gl => (
            <text
              key={gl.y}
              x={vp.view.x + 10 * k}
              y={gl.y}
              fontSize={8 * k}
              fill="rgba(174,193,212,0.55)"
              style={{ fontFamily: FONT.mono, pointerEvents: 'none' }}
            >
              {gl.text}
            </text>
          ))}
        </g>

        <g filter="url(#fiLand)">
          {countries.map(c => (
            <path
              key={c.id}
              d={c.d}
              fill={c.fill}
              stroke={c.stroke}
              strokeWidth={c.strokeWidth * k}
              onClick={() => {
                // A drag that ends over a country is a pan, not a selection.
                if (!vp.didPan()) c.onClick();
              }}
              onMouseEnter={c.onEnter}
              style={{ cursor: c.cursor, animation: c.animation, transition: 'fill 0.25s ease' }}
            />
          ))}
        </g>

        {/* capital markers */}
        <g>
          {homes.map(h => (
            <CapitalMark key={h.id} x={h.x} y={h.y} color={h.color} k={k} />
          ))}
        </g>

        {/* recent battle scars, oldest faintest */}
        <g>
          {battleMarks.map((bm, i) => (
            <g key={i} style={{ pointerEvents: 'none', opacity: bm.op }} transform={`translate(${bm.x},${bm.y}) scale(${k})`}>
              <line x1="-4" y1="-4" x2="4" y2="4" stroke={C.red} strokeWidth="1.4" />
              <line x1="-4" y1="4" x2="4" y2="-4" stroke={C.red} strokeWidth="1.4" />
            </g>
          ))}
        </g>

        {attack && <AttackVector {...attack} k={k} />}
        {spin && <Spinner {...spin} k={k} />}

        <g>
          {labels.map(lb => (
            <text
              key={lb.key}
              x={lb.x}
              y={lb.y}
              textAnchor="middle"
              fontSize={11 * k}
              fill={C.textMax}
              style={{
                fontFamily: FONT.body,
                fontWeight: 600,
                letterSpacing: 1 * k,
                paintOrder: 'stroke',
                stroke: C.ink,
                strokeWidth: 3 * k,
                pointerEvents: 'none',
              }}
            >
              {lb.text}
            </text>
          ))}
        </g>

        <ScaleBar view={vp.view} kmPerUnit={kmPerUnit} k={k} />
      </svg>

      {/* CRT scanlines */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 5,
          background:
            'repeating-linear-gradient(0deg, transparent 0px, transparent 3px, rgba(12,20,34,0.05) 3px, rgba(12,20,34,0.05) 4px)',
        }}
      />

      <ZoomControls zoom={vp.zoom} onZoom={vp.zoomBy} onReset={vp.reset} />

      <div
        ref={tipRef}
        style={{
          position: 'absolute',
          left: -999,
          top: -999,
          pointerEvents: 'none',
          zIndex: 20,
          display: tooltip.visible ? 'block' : 'none',
          background: C.cardHi,
          border: `1px solid ${C.lineCtl}`,
          borderRadius: 3,
          padding: '6px 9px',
          maxWidth: 240,
        }}
      >
        <div style={{ fontFamily: FONT.body, fontSize: 13, fontWeight: 600, color: C.textHi, letterSpacing: 0.5 }}>
          {tooltip.name}
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 9, color: C.textSoft, marginTop: 2 }}>{tooltip.sub}</div>
      </div>

      {children}

      {legend && (
        <div
          style={{
            position: 'absolute',
            left: 12,
            bottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'rgba(46,64,88,0.9)',
            border: `1px solid ${C.line}`,
            borderRadius: 3,
            padding: '7px 10px',
          }}
        >
          <span style={{ width: 9, height: 9, borderRadius: 2, background: legend.color }} />
          <span style={{ fontFamily: FONT.mono, fontSize: 9, letterSpacing: 1, color: C.textChip }}>
            {legend.text}
          </span>
        </div>
      )}

      <Compass />
      <FrameCorners />

      <div style={{ position: 'absolute', right: 16, bottom: 14, textAlign: 'right', pointerEvents: 'none' }}>
        <div ref={coordRef} style={{ fontFamily: FONT.mono, fontSize: 9.5, letterSpacing: 1.5, color: C.textCoord }}>
          LAT — · LON —
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 8, letterSpacing: 1, color: C.textFaded, marginTop: 3 }}>
          SCROLL TO ZOOM · DRAG TO PAN · DOUBLE-CLICK TO RESET
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 8, letterSpacing: 1, color: C.textFaded, marginTop: 2 }}>
          SPINNER PICKS THE ATTACKER · CLICK A NATION FOR ITS SQUAD
        </div>
      </div>
    </div>
  );
}

/** A nation's capital: a diamond on the city itself. */
function CapitalMark({ x, y, color, k }) {
  return (
    <g transform={`translate(${x},${y}) scale(${k})`} style={{ pointerEvents: 'none' }}>
      <path d="M0,-3.6 L3.6,0 L0,3.6 L-3.6,0 Z" fill={color} stroke={C.ink} strokeWidth="0.8" />
    </g>
  );
}

/** Marching line from attacker to victim, with a crosshair over the target. */
function AttackVector({ x1, y1, x2, y2, color, k }) {
  return (
    <g style={{ pointerEvents: 'none' }}>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={1.6 * k}
        pathLength="100"
        strokeDasharray="100"
        style={{ animation: 'fiDash 0.55s ease-out forwards' }}
      />
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={3.4 * k}
        strokeDasharray={`${2 * k} ${9 * k}`}
        opacity="0.5"
        style={{ animation: 'fiMarch 0.5s linear infinite' }}
      />
      <g transform={`translate(${x2},${y2}) scale(${k})`} style={{ animation: 'fiPulse 0.9s ease-in-out infinite' }}>
        <circle cx="0" cy="0" r="9" fill="none" stroke={color} strokeWidth="1.5" />
        <line x1="-14" y1="0" x2="-5" y2="0" stroke={color} strokeWidth="1.2" />
        <line x1="5" y1="0" x2="14" y2="0" stroke={color} strokeWidth="1.2" />
        <line x1="0" y1="-14" x2="0" y2="-5" stroke={color} strokeWidth="1.2" />
        <line x1="0" y1="5" x2="0" y2="14" stroke={color} strokeWidth="1.2" />
      </g>
    </g>
  );
}

/** The bottle spin that chooses a direction of attack. */
function Spinner({ x, y, angle, color, k }) {
  return (
    <g transform={`translate(${x},${y}) scale(${k})`} style={{ pointerEvents: 'none' }}>
      <circle cx="0" cy="0" r="13" fill="none" stroke={color} strokeWidth="1.5" style={{ animation: 'fiPulse 1s ease-in-out infinite' }} />
      <g style={{ transform: `rotate(${angle}deg)`, transition: 'transform 2.1s cubic-bezier(0.12, 0.55, 0.12, 1)' }}>
        <line x1="0" y1="0" x2="32" y2="0" stroke={color} strokeWidth="2" />
        <path d="M32,-5 L45,0 L32,5 Z" fill={color} />
      </g>
    </g>
  );
}

/**
 * Distance scale, drawn in map space so it stays truthful at any zoom. The bar
 * targets roughly a seventh of the view and then snaps to a round distance.
 */
function ScaleBar({ view, kmPerUnit, k }) {
  if (!kmPerUnit) return null;
  const km = niceDistance(view.w * 0.14 * kmPerUnit);
  const len = km / kmPerUnit;
  const x = view.x + view.w * 0.03;
  const y = view.y + view.h * 0.94;
  const tick = 7 * k;
  return (
    <g style={{ pointerEvents: 'none' }} stroke={C.textDim} strokeWidth={k}>
      <line x1={x} y1={y - tick} x2={x} y2={y} />
      <line x1={x} y1={y} x2={x + len} y2={y} />
      <line x1={x + len} y1={y - tick} x2={x + len} y2={y} />
      <text
        x={x}
        y={y + 9 * k}
        fontSize={8 * k}
        fill={C.textDim}
        stroke="none"
        style={{ fontFamily: FONT.mono, letterSpacing: k }}
      >
        {km >= 1000 ? `${km / 1000}000 KM` : `${km} KM`}
      </text>
    </g>
  );
}

function ZoomControls({ zoom, onZoom, onReset }) {
  const btn = {
    width: 26,
    height: 26,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `1px solid ${C.lineCtl}`,
    background: 'rgba(46,64,88,0.9)',
    color: C.textChip,
    fontFamily: FONT.mono,
    fontSize: 14,
    lineHeight: 1,
    cursor: 'pointer',
    padding: 0,
  };
  // The map owns mousedown for panning, so stop these from starting a drag.
  const swallow = e => e.stopPropagation();
  return (
    <div
      onMouseDown={swallow}
      onDoubleClick={swallow}
      style={{ position: 'absolute', left: 12, bottom: 46, zIndex: 6, display: 'flex', flexDirection: 'column', gap: 4 }}
    >
      <button style={{ ...btn, borderRadius: '3px 3px 0 0' }} onClick={() => onZoom(1.6)} title="Zoom in">
        +
      </button>
      <button style={{ ...btn, marginTop: -4, borderRadius: '0 0 3px 3px' }} onClick={() => onZoom(1 / 1.6)} title="Zoom out">
        −
      </button>
      <button
        style={{ ...btn, width: 26, height: 20, fontSize: 8, letterSpacing: 0.5, borderRadius: 3 }}
        onClick={onReset}
        title="Reset view"
      >
        {zoom < 9.95 ? zoom.toFixed(1) : Math.round(zoom)}×
      </button>
    </div>
  );
}

function Compass() {
  return (
    <div style={{ position: 'absolute', left: 16, top: 16, opacity: 0.55, pointerEvents: 'none' }}>
      <svg width="62" height="62" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="25" fill="none" stroke={C.textSoft} strokeWidth="1" />
        <circle cx="32" cy="32" r="19" fill="none" stroke={C.textSoft} strokeWidth="0.5" strokeDasharray="2 3" />
        <path d="M32,11 L36,30 L32,27 L28,30 Z" fill={C.gold} />
        <path d="M32,53 L36,34 L32,37 L28,34 Z" fill={C.textSoft} />
        <line x1="13" y1="32" x2="21" y2="32" stroke={C.textSoft} strokeWidth="1" />
        <line x1="43" y1="32" x2="51" y2="32" stroke={C.textSoft} strokeWidth="1" />
        <text x="32" y="8" textAnchor="middle" fontSize="8" fill={C.textChip} style={{ fontFamily: FONT.mono }}>
          N
        </text>
      </svg>
    </div>
  );
}

function FrameCorners() {
  const base = { position: 'absolute', width: 14, height: 14, pointerEvents: 'none' };
  const edge = `2px solid ${C.lineCorner}`;
  return (
    <>
      <div style={{ ...base, left: 8, top: 8, borderLeft: edge, borderTop: edge }} />
      <div style={{ ...base, right: 8, top: 8, borderRight: edge, borderTop: edge }} />
      <div style={{ ...base, left: 8, bottom: 8, borderLeft: edge, borderBottom: edge }} />
      <div style={{ ...base, right: 8, bottom: 8, borderRight: edge, borderBottom: edge }} />
    </>
  );
}
