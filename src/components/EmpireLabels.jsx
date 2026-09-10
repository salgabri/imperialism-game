import React, { useEffect, useId, useMemo, useState } from 'react';
import { createEmpireLabelEngine } from '../engine/empireLabels.js';
import { FONT } from '../theme.js';

const EMPTY_GEOMETRY = [];
const FALLBACK_MAP_FONT = "Georgia, 'Times New Roman', serif";
const MAP_FONT = FONT.map || "'Alegreya', Georgia, 'Times New Roman', serif";
const MAP_FONT_WEIGHT = 500;
const measuredWidths = new Map();
let textContext;

/** Measure the actual label font; headless/non-SVG environments use a safe estimate. */
function widthInEm(text, family) {
  const key = `${MAP_FONT_WEIGHT} ${family}\u0000${text}`;
  if (measuredWidths.has(key)) return measuredWidths.get(key);
  if (textContext === undefined) {
    const hasSvgText = typeof document !== 'undefined' &&
      typeof document.createElementNS('http://www.w3.org/2000/svg', 'text').getComputedTextLength === 'function';
    try { textContext = hasSvgText ? document.createElement('canvas').getContext('2d') : null; }
    catch { textContext = null; }
  }
  // The selected family is also assigned to SVG in the same React render. Never
  // measure an unloaded Alegreya fallback and then keep its widths after swap.
  if (textContext) textContext.font = `${MAP_FONT_WEIGHT} 100px ${family}`;
  const width = textContext ? textContext.measureText(text).width / 100 : text.length * .8;
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

/** Geographic label work is independent of the match ticker and map styling. */
export default function EmpireLabels({ geometry = EMPTY_GEOMETRY, ownership, labels, viewBox, unitsPerPixel, mapMode }) {
  const pathPrefix = `empire-name-${useId().replace(/:/g, '')}`;
  const engine = useMemo(() => createEmpireLabelEngine(geometry), [geometry]);
  const namesKey = JSON.stringify(labels);
  const characters = useMemo(() => [...new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZ' + labels.map(label => label.text).join(''))].sort().join(''), [namesKey]);
  const mapFont = useMapFont(characters);
  const names = useMemo(() => labels.map(label => ({ ...label, widthEm: widthInEm(label.text, mapFont.family) })), [namesKey, mapFont.family, mapFont.revision]);
  const placed = useMemo(() => names.length ? engine.layout({
    ownership, labels: names, viewBox, unitsPerPixel, minFontPx: 11, maxFontPx: 32,
    curveRatio: .055, coastalAllowancePx: 10, maxSeaFraction: .22,
  }) : [], [engine, ownership, names, viewBox, unitsPerPixel]);
  // Keep references unique across maps and stable as other owners enter/leave view.
  const pathId = id => `${pathPrefix}-${Array.from(String(id), c => c.codePointAt(0).toString(16)).join('-')}`;

  return (
    <g className="territory-labels" pointerEvents="none">
      <defs>
        {placed.map(label => {
          const rise = label.curveRise || 0;
          return <path key={label.id} id={pathId(label.id)}
            d={`M ${-label.width / 2},${rise / 2} Q 0,${-1.5 * rise} ${label.width / 2},${rise / 2}`} />;
        })}
      </defs>
      {placed.map(label => (
        <text key={label.id} data-empire-label={label.id}
          data-curve-rise={label.curveRise || 0} data-coastal={label.coastal ? 'true' : 'false'}
          data-sea-fraction={label.seaFraction || 0}
          transform={`translate(${label.x} ${label.y}) rotate(${label.angle})`}
          x={0} y={0} textAnchor="middle" dominantBaseline="central"
          fontFamily={mapFont.family} fontWeight={MAP_FONT_WEIGHT} fontSize={label.fontSize}
          letterSpacing={label.letterSpacing} textLength={label.width} lengthAdjust="spacing"
          fill={mapMode === 'flags' ? '#fff9ea' : '#192d34'}
          stroke={mapMode === 'flags' ? '#14222c' : '#e4e5cf'}
          strokeOpacity={.88} strokeWidth={Math.min(label.fontSize * .12, 2 * unitsPerPixel)}
          strokeLinejoin="round" paintOrder="stroke">
          <textPath href={`#${pathId(label.id)}`} startOffset="50%">{label.text}</textPath>
        </text>
      ))}
    </g>
  );
}
