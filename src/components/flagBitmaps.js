// Flag artwork as bitmaps for the map's Flags mode. An SVG flag on the map is redrawn shape by shape every time the
// map repaints (each camera frame, the draw compass, a hover), which made Flags mode lag; a bitmap is one image
// draw. Each SVG is rasterised once, in the background, at BITMAP_SIDE px on its longer side. FlagArt keeps the SVG
// until its bitmap is ready and wherever the flag is drawn larger than the bitmap, so a flag is never blurred.
// Browser-only: without OffscreenCanvas (jsdom, server rendering) nothing is rasterised and the SVGs stay.
import { useEffect, useSyncExternalStore } from 'react';

const BITMAP_SIDE = 1024;

const bitmaps = new Map(); // SVG URL → { href, width, height }, or null when it could not be rasterised
const pending = new Set(); // queued or being rasterised
const listeners = new Set();
let running = false;

const canRasterise = () => typeof OffscreenCanvas === 'function' && typeof OffscreenCanvas.prototype.convertToBlob === 'function'
  && typeof Image === 'function' && typeof fetch === 'function' && typeof URL?.createObjectURL === 'function';

/** One SVG drawn at BITMAP_SIDE px on its longer side, as a decoded PNG object URL. */
async function rasterise(url) {
  const text = await (await fetch(url)).text();
  const [, , w, h] = (/viewBox=["']([^"']+)["']/.exec(text)?.[1] || '').trim().split(/[\s,]+/).map(Number);
  if (!(w > 0 && h > 0)) return null;
  const scale = BITMAP_SIDE / Math.max(w, h);
  const width = Math.round(w * scale), height = Math.round(h * scale);
  // Sized to the bitmap: the flags carry only a viewBox, and a canvas draws a size-less SVG at a default size in
  // some browsers.
  const sized = text.replace(/<svg\b[^>]*>/, tag => tag.replace(/\s(?:width|height)=(["'])[^"']*\1/g, '')
    .replace(/^<svg/, `<svg width="${width}" height="${height}"`));
  const source = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  try {
    const svg = new Image();
    svg.src = source;
    await svg.decode();
    // A CPU canvas: encoding a GPU one reads its pixels back, which stalls the page while the GPU draws the map.
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(svg, 0, 0, width, height);
    const href = URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
    // Loaded before any <image> switches to it, so a banner never shows blank for a frame.
    const png = new Image();
    png.src = href;
    await png.decode();
    return { href, width, height };
  } finally {
    URL.revokeObjectURL(source);
  }
}

/**
 * Rasterise the queue one SVG at a time; each finished bitmap re-renders its banners. Every step but the draw waits on
 * the browser (fetch, decode, PNG encode), so frames keep flowing while it runs.
 */
async function drain() {
  running = true;
  for (const url of pending) {
    let bitmap = null;
    try { bitmap = await rasterise(url); } catch { /* keep the SVG */ }
    bitmaps.set(url, bitmap);
    pending.delete(url);
    listeners.forEach(listener => listener());
  }
  running = false;
}

function requestBitmap(url) {
  if (!url || bitmaps.has(url) || pending.has(url) || !canRasterise()) return;
  pending.add(url);
  if (!running) drain();
}

const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };

/** An SVG's bitmap once rasterised (`{ href, width, height }`), else null; asks for it on first use. */
export function useFlagBitmap(url) {
  const bitmap = useSyncExternalStore(subscribe, () => (url ? bitmaps.get(url) : undefined), () => undefined);
  useEffect(() => { requestBitmap(url); }, [url]);
  return bitmap || null;
}
