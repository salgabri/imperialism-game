import React, { memo } from 'react';
import { useFlagBitmap } from './flagBitmaps.js';

/**
 * One geographic banner in map coordinates, drawn once in the map's defs: WorldMap shows it through each of the
 * region's land parts (a `<use>` clipped to the part). Only its field stretches; an emblem never does. A club's crest
 * is an emblem on its colour. `scale` is device px per map unit: SVG artwork is drawn from its bitmap while the bitmap
 * covers the drawn size (flagBitmaps.js), and from the SVG itself beyond that.
 */
function FlagArt({ flag: f, scale = 0 }) {
  const { bbox: b, symbolLayout: layout } = f;
  const crest = !!f.crestUrl;
  const layered = !crest && !!(layout && f.fieldUrl && f.symbolUrl);
  const flagHref = useArtwork(crest || layered ? null : f.url, b, scale);
  const fieldHref = useArtwork(layered ? f.fieldUrl : null, layout?.field, scale);
  const symbolHref = useArtwork(layered ? f.symbolUrl : null, layout?.symbol, scale);
  return (
    <g id={`fi-flag-${f.id}`} data-owner={f.ownerId} data-flag-source={f.url}
      data-flag-layout={crest ? 'crest' : layered ? 'symbol-aware' : 'native'} pointerEvents="none">
      <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={f.color} />
      {/* Land too small for a crest keeps the plain colour. */}
      {crest ? layout && <image data-flag-symbol="" href={f.crestUrl} x={layout.symbol.x} y={layout.symbol.y}
        width={layout.symbol.w} height={layout.symbol.h} preserveAspectRatio="xMidYMid meet" />
      : layered ? <>
        <image data-flag-field="" href={fieldHref} x={layout.field.x} y={layout.field.y}
          width={layout.field.w} height={layout.field.h} preserveAspectRatio="none" />
        <image data-flag-symbol="" href={symbolHref} x={layout.symbol.x} y={layout.symbol.y}
          width={layout.symbol.w} height={layout.symbol.h} preserveAspectRatio="xMidYMid meet" />
      </> : <image href={flagHref} x={b.x} y={b.y} width={b.w} height={b.h} preserveAspectRatio="none" />}
    </g>
  );
}

/** An artwork layer's href: its bitmap while that covers the layer's drawn size in device px, else the SVG. */
function useArtwork(url, box, scale) {
  const bitmap = useFlagBitmap(url);
  if (!url) return null;
  return bitmap && box.w * scale <= bitmap.width && box.h * scale <= bitmap.height ? bitmap.href : url;
}

export default memo(FlagArt);
