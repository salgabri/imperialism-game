import { useCallback, useEffect, useRef, useState } from 'react';

// The map's natural coordinate space, matching the SVG's authored viewBox.
export const WORLD = { x: 0, y: 0, w: 960, h: 540 };
const ASPECT = WORLD.h / WORLD.w;

const MIN_ZOOM = 1;
const MAX_ZOOM = 16;
const WHEEL_SENSITIVITY = 0.0016;
const DRAG_THRESHOLD = 4; // px of travel before a press counts as a pan, not a click

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Frame a view of the given width, keeping it inside the world bounds. */
function frame(w, x, y) {
  const width = clamp(w, WORLD.w / MAX_ZOOM, WORLD.w / MIN_ZOOM);
  const height = width * ASPECT;
  return {
    w: width,
    h: height,
    x: clamp(x, WORLD.x, WORLD.x + WORLD.w - width),
    y: clamp(y, WORLD.y, WORLD.y + WORLD.h - height),
  };
}

/**
 * Wheel-to-zoom and drag-to-pan over an SVG viewBox.
 *
 * Zoom is anchored on the pointer so the feature under the cursor stays put.
 * The view is clamped to the world, so the map can never be lost off-screen —
 * there is no "where did it go" state to recover from.
 */
export function useMapViewport(svgRef, resetKey) {
  const [view, setView] = useState({ ...WORLD });
  const [panning, setPanning] = useState(false);
  const drag = useRef(null);
  const suppressClick = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  const reset = useCallback(() => setView({ ...WORLD }), []);

  // A new theatre reframes the map, so any zoom the player had is stale.
  useEffect(() => {
    reset();
  }, [resetKey, reset]);

  /** Pixels on screen per world unit, accounting for xMidYMid letterboxing. */
  const screenScale = useCallback(rect => {
    if (!rect.width || !rect.height) return 0; // not laid out yet
    return Math.min(rect.width / viewRef.current.w, rect.height / viewRef.current.h);
  }, []);

  /** Pointer position in world coordinates. */
  const toWorld = useCallback(
    (clientX, clientY, rect) => {
      const v = viewRef.current;
      const k = screenScale(rect);
      // Letterbox offset: the viewBox is centred within the element.
      const ox = (rect.width - v.w * k) / 2;
      const oy = (rect.height - v.h * k) / 2;
      return [v.x + (clientX - rect.left - ox) / k, v.y + (clientY - rect.top - oy) / k];
    },
    [screenScale],
  );

  const zoomAt = useCallback(
    (factor, clientX, clientY) => {
      const el = svgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (!screenScale(rect)) return;
      const v = viewRef.current;
      const [wx, wy] = toWorld(clientX, clientY, rect);
      const next = frame(v.w / factor, 0, 0);
      // Keep the anchor point under the cursor.
      setView(frame(next.w, wx - (wx - v.x) * (next.w / v.w), wy - (wy - v.y) * (next.h / v.h)));
    },
    [svgRef, toWorld, screenScale],
  );

  /** Zoom about the centre of the view — for the on-screen +/- buttons. */
  const zoomBy = useCallback(
    factor => {
      const v = viewRef.current;
      const next = frame(v.w / factor, 0, 0);
      setView(frame(next.w, v.x + (v.w - next.w) / 2, v.y + (v.h - next.h) / 2));
    },
    [],
  );

  // Wheel must be a non-passive listener to stop the page scrolling behind the map.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = e => {
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * WHEEL_SENSITIVITY), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [svgRef, zoomAt]);

  const onMouseDown = useCallback(e => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, view: viewRef.current, travel: 0 };
    suppressClick.current = false;
  }, []);

  const onMouseMove = useCallback(
    e => {
      const d = drag.current;
      const el = svgRef.current;
      if (!d || !el) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.travel = Math.max(d.travel, Math.abs(dx) + Math.abs(dy));
      if (d.travel < DRAG_THRESHOLD) return;
      if (!panning) setPanning(true);
      suppressClick.current = true;
      const k = screenScale(el.getBoundingClientRect());
      if (!k) return;
      setView(frame(d.view.w, d.view.x - dx / k, d.view.y - dy / k));
    },
    [svgRef, screenScale, panning],
  );

  const endDrag = useCallback(() => {
    drag.current = null;
    setPanning(false);
  }, []);

  // Release the drag even if the button comes up outside the map.
  useEffect(() => {
    window.addEventListener('mouseup', endDrag);
    return () => window.removeEventListener('mouseup', endDrag);
  }, [endDrag]);

  const zoom = WORLD.w / view.w;
  return {
    view,
    zoom,
    panning,
    reset,
    zoomBy,
    /** True when the last press was a pan, so map clicks should be ignored. */
    didPan: () => suppressClick.current,
    handlers: { onMouseDown, onMouseMove, onMouseUp: endDrag, onDoubleClick: reset },
  };
}
