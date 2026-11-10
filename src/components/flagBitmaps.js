// Flag artwork as bitmaps for the map's Flags mode: the banners' side. The rasteriser and its queue live outside
// React, in engine/flagRaster.js (README §Flags): each SVG is rasterised once, in the background, and FlagArt keeps the
// SVG until its bitmap is ready and wherever the flag is drawn larger than the bitmap, so a flag is never blurred.
import { useEffect, useSyncExternalStore } from 'react';
import { flagBitmap, releaseFlagBitmap, requestFlagBitmap, subscribeFlagBitmaps } from '../engine/flagRaster.js';

/**
 * An SVG's bitmap once rasterised (`{ href, width, height }`), else null. While mounted with a URL the layer wants
 * it: `px` is the size the layer draws the flag at, in device px on its longer side (the largest go first). Leaving
 * Flags mode unmounts every banner, and with nothing wanted the queue stops.
 */
export function useFlagBitmap(url, px = 0) {
  const bitmap = useSyncExternalStore(subscribeFlagBitmaps, () => flagBitmap(url), () => null);
  useEffect(() => {
    if (!url) return undefined;
    requestFlagBitmap(url, px);
    return () => releaseFlagBitmap(url);
  }, [url, px]);
  return bitmap;
}
