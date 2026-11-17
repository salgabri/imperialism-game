import React, { memo } from 'react';
import { flagLip } from '../engine/flagFit.js';
import { useFlagBitmap } from './flagBitmaps.js';

/**
 * One geographic banner in map coordinates, drawn once in the map's defs: WorldMap shows it through each of the
 * region's land parts (a `<use>` clipped to the part). Only its field stretches; an emblem never does. A club's crest
 * is an emblem on its colour, and a club with no crest shows its monogram there instead (MonogramChip). A whole flag
 * fills the box its fit gives it (`fitLayout`, engine/flagFit.js), and strips in the colours of its edges carry it on
 * over the rest of the region; each strip's gradient sits beside the banner in the defs. `scale` is device px per map
 * unit: SVG artwork is drawn from its bitmap while the bitmap covers the drawn size (flagBitmaps.js), and from the SVG
 * itself beyond that.
 */
function FlagArt({ flag: f, scale = 0 }) {
  const { bbox: b, symbolLayout: layout } = f;
  const crest = !!f.crestUrl;
  const monogram = !crest && !!f.monogram;
  const club = crest || monogram;
  const layered = !club && !!(layout && f.fieldUrl && f.symbolUrl);
  const fit = !club && !layered ? f.fitLayout || null : null;
  const art = fit ? fit.flag : b;
  const flagHref = useArtwork(club || layered ? null : f.url, art, scale, fit?.kind);
  const fieldHref = useArtwork(layered ? f.fieldUrl : null, layout?.field, scale);
  const symbolHref = useArtwork(layered ? f.symbolUrl : null, layout?.symbol, scale);
  const gradientId = side => `fi-flag-${f.id}-${side}`;
  return (
    <>
      {fit?.strips.filter(strip => strip.stops).map(strip => (
        <linearGradient key={strip.side} id={gradientId(strip.side)} gradientUnits="userSpaceOnUse"
          x1={strip.axis === 'x' ? strip.from : 0} x2={strip.axis === 'x' ? strip.to : 0}
          y1={strip.axis === 'y' ? strip.from : 0} y2={strip.axis === 'y' ? strip.to : 0}>
          {strip.stops.map((stop, i) => <stop key={i} offset={stop.offset} stopColor={stop.color}
            stopOpacity={stop.opacity === 1 ? undefined : stop.opacity} />)}
        </linearGradient>
      ))}
      <g id={`fi-flag-${f.id}`} data-owner={f.ownerId} data-flag-source={f.url}
        data-flag-layout={crest ? 'crest' : monogram ? 'monogram' : layered ? 'symbol-aware' : 'native'} data-flag-fit={fit?.kind}
        pointerEvents="none">
        <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={f.color} />
        {/* Land too small for a crest, or a monogram, keeps the plain colour. */}
        {crest ? layout && <image data-flag-symbol="" href={f.crestUrl} x={layout.symbol.x} y={layout.symbol.y}
          width={layout.symbol.w} height={layout.symbol.h} preserveAspectRatio="xMidYMid meet" />
        : monogram ? layout && <MonogramChip code={f.monogram} box={layout.symbol} />
        : layered ? <>
          <image data-flag-field="" href={fieldHref} x={layout.field.x} y={layout.field.y}
            width={layout.field.w} height={layout.field.h} preserveAspectRatio="none" />
          <image data-flag-symbol="" href={symbolHref} x={layout.symbol.x} y={layout.symbol.y}
            width={layout.symbol.w} height={layout.symbol.h} preserveAspectRatio="xMidYMid meet" />
        </> : <>
          {fit?.strips.map(strip => <rect key={strip.side} data-flag-strip={strip.side} x={strip.x} y={strip.y}
            width={strip.w} height={strip.h} fill={strip.color || `url(#${gradientId(strip.side)})`} />)}
          <image href={flagHref} x={art.x} y={art.y} width={art.w} height={art.h} preserveAspectRatio="none" />
          {/* An SVG's layers leave a seam along its edge, which a lip in the strip's colours hides (engine/flagFit.js). */}
          {flagHref === f.url && fit?.strips.map(({ side, color }) => {
            const lip = flagLip(art, side, scale);
            return <rect key={`lip-${side}`} data-flag-lip={side} x={lip.x} y={lip.y} width={lip.w} height={lip.h}
              fill={color || `url(#${gradientId(side)})`} />;
          })}
        </>}
      </g>
    </>
  );
}

/** The monogram chip's height to its width, as the UI's chip (TeamMark: 0.75). */
const MONOGRAM_RATIO = .75;
/** Its code's size to the chip's height, as the UI's chip (.fi-team-monogram in src/styles/primitives.css). */
const MONOGRAM_TEXT = .42;

/**
 * A club's monogram where its crest would sit, for a club with no crest: the UI's monogram chip, a 4:3 box centred in
 * the crest's square (`box`) with the club's code in its middle. `.fi-map-monogram` (src/styles/primitives.css) paints
 * it in either theme, as `.fi-team-monogram` paints the chip.
 */
function MonogramChip({ code, box }) {
  const w = Math.min(box.w, box.h / MONOGRAM_RATIO), h = w * MONOGRAM_RATIO;
  const x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2;
  return (
    <g className="fi-map-monogram" data-flag-monogram={code}>
      <rect x={x} y={y} width={w} height={h} />
      <text x={x + w / 2} y={y + h / 2} fontSize={h * MONOGRAM_TEXT} textAnchor="middle" dominantBaseline="central">{code}</text>
    </g>
  );
}

/**
 * An artwork layer's href: its bitmap while that covers the layer's drawn size in device px, else the SVG. A flag of
 * horizontal stripes (`kind` rows) is the same at any width, so only its height counts; one of vertical stripes only its
 * width; a plain one neither.
 */
function useArtwork(url, box, scale, kind) {
  // The size it is drawn at puts the biggest flags first in the rasteriser's queue.
  const bitmap = useFlagBitmap(url, url && box ? Math.max(box.w, box.h) * scale : 0);
  if (!url) return null;
  return bitmap && (kind === 'rows' || kind === 'plain' || box.w * scale <= bitmap.width)
    && (kind === 'cols' || kind === 'plain' || box.h * scale <= bitmap.height) ? bitmap.href : url;
}

export default memo(FlagArt);
