import React from 'react';

/** One geographic banner. Only its field stretches; an emblem never does. */
export default function FlagPattern({ flag: f }) {
  const { bbox: b, symbolLayout: layout } = f;
  const layered = !!(layout && f.fieldUrl && f.symbolUrl);
  // SVG translates the pattern tile to b.x/b.y. Keep its contents tile-local;
  // using absolute map coordinates here would offset the artwork twice.
  return (
    <pattern id={`fi-flag-${f.id}`} data-owner={f.ownerId} data-flag-source={f.url}
      data-flag-layout={layered ? 'symbol-aware' : 'native'}
      patternUnits="userSpaceOnUse" patternContentUnits="userSpaceOnUse"
      x={b.x} y={b.y} width={b.w} height={b.h} pointerEvents="none">
      <rect x={0} y={0} width={b.w} height={b.h} fill={f.color} />
      {layered ? <>
        <image data-flag-field="" href={f.fieldUrl} x={layout.field.x - b.x} y={layout.field.y - b.y}
          width={layout.field.w} height={layout.field.h} preserveAspectRatio="none" />
        <image data-flag-symbol="" href={f.symbolUrl} x={layout.symbol.x - b.x} y={layout.symbol.y - b.y}
          width={layout.symbol.w} height={layout.symbol.h} preserveAspectRatio="xMidYMid meet" />
      </> : <image href={f.url} x={0} y={0} width={b.w} height={b.h} preserveAspectRatio="none" />}
    </pattern>
  );
}
