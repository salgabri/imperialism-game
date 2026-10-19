// Owner: WP-MAP (see PLAN.md §4). v4 empire labels (README §Map rendering, DEC D19): Archivo Narrow 600 (your
// empire 700), uppercase, .14em tracking, a gentle 5% arc, sizes capped per viewport class (A-6).
// No CSS import here: map-fonts.test bundles this file without a CSS loader. The engine import line below is
// instrumented by smoke.mjs and must stay byte-identical.
import React, { useEffect, useId, useMemo, useState } from 'react';
import { createEmpireLabelEngine } from '../engine/empireLabels.js';
import { V4_LABEL_POLICY, estimateLabelWidthEm } from '../engine/empireLabels.js';

const EMPTY_GEOMETRY = [];
const FALLBACK_MAP_FONT = "'Arial Narrow', sans-serif";
/** The self-hosted variable Archivo Narrow face covers 400–700, so one load serves both weights. */
const MAP_FONT = "'Archivo Narrow', 'Arial Narrow', sans-serif";
const MAP_FONT_WEIGHT = 600;
const OWN_FONT_WEIGHT = 700;
// README / DEC D19 label policy, single-sourced from the engine: .14em tracking, 5% arc, 9px floor (yours 6.5px).
const POLICY = V4_LABEL_POLICY || { trackingEm: .14, curveRatio: .05, minFontPx: 9, ownMinFontPx: 6.5, coastalAllowancePx: 10, maxSeaFraction: .22 };
const estimateWidth = (text, weight) => (typeof estimateLabelWidthEm === 'function' ? estimateLabelWidthEm(text, weight) : text.length * .8);
const measuredWidths = new Map();
let textContext;

/** Measure the actual label font; headless/non-SVG environments use a safe estimate. */
function widthInEm(text, family, weight = MAP_FONT_WEIGHT) {
  const key = `${weight} ${family}\u0000${text}`;
  if (measuredWidths.has(key)) return measuredWidths.get(key);
  if (textContext === undefined) {
    const hasSvgText = typeof document !== 'undefined' &&
      typeof document.createElementNS('http://www.w3.org/2000/svg', 'text').getComputedTextLength === 'function';
    try { textContext = hasSvgText ? document.createElement('canvas').getContext('2d') : null; }
    catch { textContext = null; }
  }
  // The selected family is also assigned to SVG in the same React render. Never
  // measure an unloaded Archivo Narrow fallback and then keep its widths after swap.
  if (textContext) textContext.font = `${weight} 100px ${family}`;
  // Headless (no canvas or SVG text metrics): the engine's deterministic narrow-grotesque advances.
  const width = textContext ? textContext.measureText(text).width / 100 : estimateWidth(text, weight);
  measuredWidths.set(key, width);
  return width;
}

function useMapFont(characters) {
  const [loaded, setLoaded] = useState(null);
  const ready = loaded?.family === MAP_FONT && [...characters].every(character => loaded.characters.includes(character));
  useEffect(() => {
    if (ready || typeof document === 'undefined' || typeof document.fonts?.load !== 'function') return undefined;
    let cancelled = false;
    // Load the specific face, not a fallback stack: an empty result means the
    // webfont is unavailable. The current character sample also covers any
    // additional locally hosted Unicode subset needed by a new nation name.
    const primaryFamily = MAP_FONT.split(',')[0].trim();
    try {
      Promise.resolve(document.fonts.load(`${MAP_FONT_WEIGHT} 100px ${primaryFamily}`, characters))
        .then(faces => {
          if (cancelled || !Array.isArray(faces) || !faces.length || faces.some(face => face.status !== 'loaded')) return;
          measuredWidths.clear();
          setLoaded(previous => ({ family: MAP_FONT,
            characters: [...new Set((previous?.family === MAP_FONT ? previous.characters : '') + characters)].join(''),
            revision: (previous?.revision || 0) + 1,
          }));
        }, () => { /* A failed local font keeps the explicitly measured fallback. */ });
    } catch { /* FontFaceSet implementations may throw synchronously. */ }
    return () => { cancelled = true; };
  }, [characters, ready]);
  return { family: ready ? MAP_FONT : FALLBACK_MAP_FONT, revision: loaded?.revision || 0 };
}

/**
 * Geographic label work is independent of the match ticker and map styling: mode and colour changes never
 * re-run layout. `meId` (A-7: managed, else followed) gets weight 700, ink fill and a 6.5px minimum.
 */
export default function EmpireLabels({
  geometry = EMPTY_GEOMETRY, ownership, labels, viewBox, unitsPerPixel, mapMode,
  meId = null, maxFontPx = 22, minFontPx = POLICY.minFontPx,
}) {
  const pathPrefix = `empire-name-${useId().replace(/:/g, '')}`;
  const engine = useMemo(() => createEmpireLabelEngine(geometry), [geometry]);
  const namesKey = JSON.stringify(labels);
  const characters = useMemo(() => [...new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZ' + labels.map(label => label.text).join(''))].sort().join(''), [namesKey]);
  const mapFont = useMapFont(characters);
  const names = useMemo(() => labels.map(label => {
    const own = meId != null && label.id === meId;
    return { ...label, widthEm: widthInEm(label.text, mapFont.family, own ? OWN_FONT_WEIGHT : MAP_FONT_WEIGHT),
      minFontPx: own ? Math.min(POLICY.ownMinFontPx, minFontPx) : minFontPx };
  }), [namesKey, mapFont.family, mapFont.revision, meId, minFontPx]);
  const placed = useMemo(() => names.length ? engine.layout({
    ownership, labels: names, viewBox, unitsPerPixel, minFontPx, maxFontPx,
    curveRatio: POLICY.curveRatio, coastalAllowancePx: POLICY.coastalAllowancePx, maxSeaFraction: POLICY.maxSeaFraction,
    trackingEm: POLICY.trackingEm,
  }) : [], [engine, ownership, names, viewBox, unitsPerPixel, minFontPx, maxFontPx]);
  // Keep references unique across maps and stable as other owners enter/leave view.
  const pathId = id => `${pathPrefix}-${Array.from(String(id), c => c.codePointAt(0).toString(16)).join('-')}`;
  const flags = mapMode === 'flags';

  return (
    <g className="territory-labels" pointerEvents="none">
      <defs>
        {placed.map(label => {
          const rise = label.curveRise || 0;
          return <path key={label.id} id={pathId(label.id)}
            d={`M ${-label.width / 2},${rise / 2} Q 0,${-1.5 * rise} ${label.width / 2},${rise / 2}`} />;
        })}
      </defs>
      {placed.map(label => {
        const own = meId != null && label.id === meId;
        // Flags mode (DEC D18): white letters on an ink halo; elsewhere the README ink-on-white-halo scheme.
        // Strength mode darkens land, so labels drop their transparency there (RM §1.9).
        return (
          <text key={label.id} data-empire-label={label.id} data-own={own ? 'true' : undefined}
            data-curve-rise={label.curveRise || 0} data-coastal={label.coastal ? 'true' : 'false'}
            data-sea-fraction={label.seaFraction || 0}
            transform={`translate(${label.x} ${label.y}) rotate(${label.angle})`}
            x={0} y={0} textAnchor="middle" dominantBaseline="central"
            fontFamily={mapFont.family} fontWeight={own ? OWN_FONT_WEIGHT : MAP_FONT_WEIGHT} fontSize={label.fontSize}
            letterSpacing={label.letterSpacing} textLength={label.width} lengthAdjust="spacing"
            fill={flags ? '#ffffff' : own ? '#111417' : '#2c3236'}
            fillOpacity={flags || own || mapMode === 'strength' ? 1 : .72}
            stroke={flags ? '#111417' : '#ffffff'}
            strokeOpacity={flags ? .55 : own ? .35 : .5} strokeWidth={label.fontSize * .12}
            strokeLinejoin="round" paintOrder="stroke">
            <textPath href={`#${pathId(label.id)}`} startOffset="50%">{label.text}</textPath>
          </text>
        );
      })}
    </g>
  );
}
