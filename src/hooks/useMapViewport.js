// Owner: WP-MAP (see PLAN.md §4). Map camera: pan, zoom, explicit fits and route reveals over fixed geography.
// No timers or animation frames (PLAN §0.10); ResizeObserver and resize listeners only, both guarded for jsdom.
import { useCallback, useEffect, useRef, useState } from 'react';

export const WORLD = { x: 0, y: 0, w: 960, h: 540 };
const MAX_ZOOM = 16;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** README §Responsive rules: wide ≥1600 · std 1200–1599 · tablet 700–1199 · phone <700. */
export function viewportClass(width) {
  const w = Number(width);
  if (width == null || !Number.isFinite(w)) return 'std';
  return w >= 1600 ? 'wide' : w >= 1200 ? 'std' : w >= 700 ? 'tablet' : 'phone';
}

/** README §A map overlay inset by viewport class (px). */
export const MAP_INSET = Object.freeze({ wide: 30, std: 20, tablet: 18, phone: 12 });
/** A-6 label size tiers (px): max by viewport class; hide below 9px, your own label down to 6.5px. */
export const LABEL_MAX_PX = Object.freeze({ wide: 30, std: 22, tablet: 20, phone: 18 });
export const LABEL_MIN_PX = 9;
export const OWN_LABEL_MIN_PX = 6.5;

/**
 * Design `fit()` windows (v4 L1445–1450): the bounds' centre sits in the [l..r]×[t..b] fraction of the canvas,
 * scaled by `pad`. Theatre framing leaves room for the title card (top) and the key/mode switch (bottom).
 */
export const THEATRE_LAYOUT = Object.freeze({
  wide: Object.freeze({ l: .02, r: .98, t: .08, b: .9, pad: 1 }),
  std: Object.freeze({ l: .02, r: .98, t: .12, b: .86, pad: 1 }),
  tablet: Object.freeze({ l: 0, r: 1, t: .1, b: .9, pad: .98 }),
  // [derived] the phone "Whole map": clear of the title card (top) and the Whole map button (bottom).
  phone: Object.freeze({ l: 0, r: 1, t: .12, b: .86, pad: 1 }),
});
/** A4: your empire + next opponent fill the 330px phone map (v4 L1448). */
export const NEAR_LAYOUT = Object.freeze({ l: 0, r: 1, t: 0, b: 1, pad: 1.55 });
/** Width of the conquest article that floats over the right of the map at ≥1200 (PLAN §1.3, D1). */
export const CONQUEST_ARTICLE_PX = 650;

/**
 * A-2 conquest framing. ≥1200: D1 `{l:.03, r:.5, t:.12, b:.88, pad:2.6}` against the full map width, with `r`
 * pulled left when a narrow window would put the taken land under the 650px article. Tablet: centred. Phone: D2.
 */
export function conquestLayout(breakpoint, width) {
  if (breakpoint === 'phone') return { l: 0, r: 1, t: 0, b: 1, pad: 2.8 };
  if (breakpoint === 'tablet') return { l: 0, r: 1, t: .12, b: .88, pad: 2.6 };
  const w = Number(width);
  const room = Number.isFinite(w) && w > 0 ? (w - CONQUEST_ARTICLE_PX - 40) / w : .5;
  return { l: .03, r: clamp(room, .2, .5), t: .12, b: .88, pad: 2.6 };
}

function validLayout(layout) {
  if (!layout || typeof layout !== 'object') return null;
  const l = Number.isFinite(layout.l) ? layout.l : 0, r = Number.isFinite(layout.r) ? layout.r : 1;
  const t = Number.isFinite(layout.t) ? layout.t : 0, b = Number.isFinite(layout.b) ? layout.b : 1;
  const pad = Number.isFinite(layout.pad) && layout.pad > 0 ? layout.pad : 1.03;
  return r > l && b > t ? { l, r, t, b, pad } : { l: 0, r: 1, t: 0, b: 1, pad };
}

/**
 * Explicit inspection fits the requested land, unlike automatic route reveals.
 * Without `layout` the HUD insets (72/90/110 px) frame it; with `layout` the design's fit() window does.
 */
export function computeFitView(bounds, size, frameView, layout) {
  if (!bounds || !size || ![size.width, size.height].every(Number.isFinite) ||
      size.width <= 0 || size.height <= 0) return null;
  const { x, y, w, h, width = w, height = h } = bounds;
  if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) return null;
  const aspect = size.height / size.width;
  const baseWidth = Math.max(WORLD.w, WORLD.h / aspect);
  const frame = frameView || ((requestedWidth, requestedX, requestedY) => {
    const nextWidth = clamp(requestedWidth, baseWidth / MAX_ZOOM, baseWidth);
    const nextHeight = nextWidth * aspect;
    return { w: nextWidth, h: nextHeight,
      x: nextWidth > WORLD.w ? (WORLD.w - nextWidth) / 2 : clamp(requestedX, 0, WORLD.w - nextWidth),
      y: nextHeight > WORLD.h ? (WORLD.h - nextHeight) / 2 : clamp(requestedY, 0, WORLD.h - nextHeight) };
  });
  const fit = validLayout(layout);
  if (fit) {
    // v4 fit(): w = max(b.w/(r−l), (b.h/(b−t))/a)·pad, then centre the bounds in the window's middle.
    const requested = Math.max(width / (fit.r - fit.l), height / (fit.b - fit.t) / aspect) * fit.pad;
    const next = frame(requested, 0, 0);
    return frame(next.w, x + width / 2 - (fit.l + fit.r) / 2 * next.w, y + height / 2 - (fit.t + fit.b) / 2 * next.h);
  }
  const side = Math.min(72 / size.width, .2);
  const verticalScale = Math.min(1, size.height * .4 / 200);
  const top = 90 * verticalScale / size.height;
  const bottom = 110 * verticalScale / size.height;
  const requestedWidth = Math.max(width / (1 - 2 * side), height / (aspect * (1 - top - bottom)), baseWidth / MAX_ZOOM);
  const next = frame(requestedWidth, 0, 0);
  // Centre the land in the unobscured canvas, allowing for the larger bottom HUD.
  return frame(next.w, x + width / 2 - next.w / 2,
    y + height / 2 - next.h * (top + (1 - top - bottom) / 2));
}

/** Reveal map markers without zooming in or disturbing an already safe view. */
export function computeRevealView(current, points, size, frameView) {
  if (!current || ![current.x, current.y, current.w, current.h].every(Number.isFinite) ||
      current.w <= 0 || current.h <= 0 || !size ||
      ![size.width, size.height].every(Number.isFinite) || size.width <= 0 || size.height <= 0) return current;
  const targets = Array.isArray(points) ? points.filter(point =>
    point && Number.isFinite(point.x) && Number.isFinite(point.y)) : [];
  if (!targets.length) return current;

  const aspect = size.height / size.width;
  const baseWidth = Math.max(WORLD.w, WORLD.h / aspect);
  const frame = frameView || ((w, x, y) => {
    const width = clamp(w, baseWidth / MAX_ZOOM, baseWidth);
    const height = width * aspect;
    return { w: width, h: height,
      x: width > WORLD.w ? (WORLD.w - width) / 2 : clamp(x, 0, WORLD.w - width),
      y: height > WORLD.h ? (WORLD.h - height) / 2 : clamp(y, 0, WORLD.h - height) };
  });
  // Keep at least 60% of even a tiny canvas available for the route. The
  // asymmetric vertical inset leaves a little more room for the bottom HUD.
  const side = Math.min(72 / size.width, .2);
  const verticalScale = Math.min(1, size.height * .4 / 200);
  const top = 90 * verticalScale / size.height;
  const bottom = 110 * verticalScale / size.height;
  const minX = Math.min(...targets.map(point => point.x));
  const maxX = Math.max(...targets.map(point => point.x));
  const minY = Math.min(...targets.map(point => point.y));
  const maxY = Math.max(...targets.map(point => point.y));
  const width = Math.max(current.w, (maxX - minX) / (1 - 2 * side),
    (maxY - minY) / (aspect * (1 - top - bottom)));
  const next = frame(width, current.x, current.y);
  const position = (centered, lower, upper) => lower <= upper ? clamp(centered, lower, upper) : (lower + upper) / 2;
  // Choose the closest safe pan. If the zoom limit or world edge makes the
  // requested inset impossible, framing still reveals as much as it permits.
  const x = position(current.x + (current.w - next.w) / 2,
    maxX - next.w * (1 - side), minX - next.w * side);
  const y = position(current.y + (current.h - next.h) / 2,
    maxY - next.h * (1 - bottom), minY - next.h * top);
  const result = frame(next.w, x, y);
  return ['x', 'y', 'w', 'h'].every(key => Math.abs(result[key] - current[key]) < 1e-9) ? current : result;
}

/**
 * The viewport class (A-6), read from window.innerWidth in this hook (never in App.render) and kept current by a
 * resize listener. Server/test renders without a window fall back to 'std'.
 */
export function useViewportClass() {
  const [breakpoint, setBreakpoint] = useState(() =>
    typeof window !== 'undefined' ? viewportClass(window.innerWidth) : 'std');
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined;
    const update = () => setBreakpoint(viewportClass(window.innerWidth));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return breakpoint;
}

/** The live canvas size, or null while it is detached or hidden (0×0). */
function measuredSize(svgRef) {
  try {
    const rect = svgRef.current?.getBoundingClientRect?.();
    return rect && rect.width > 0 && rect.height > 0 ? { width: rect.width, height: rect.height } : null;
  } catch {
    return null;
  }
}

/**
 * A responsive camera over fixed geography: resizing never changes the rules.
 * `initialFocus` = { x, y, w, h, layout? }: with `layout` (a fit() window) reset() uses the design framing,
 * otherwise the legacy ×1.08 centring. A zero-sized (hidden) canvas never resets or refits the camera.
 * `fitBounds(bounds, layout?)` fits against the canvas as laid out now (the conquest view widens the map in the
 * same commit that asks for the fit), and an explicit fit stays framed across later resizes until the player
 * pans, zooms, resets or restores. `layout` may be a function of the canvas size ({ width, height }); it is
 * re-resolved whenever the canvas or `fitKey` (the viewport class: conquestLayout depends on it) changes. A new
 * theatre within the same `resetKey` (the phone near frame ↔ the theatre across the 700px breakpoint, new
 * holdings) keeps an untouched fit too and only becomes its return target; a new `resetKey` discards it.
 * Two touch pointers pinch-zoom around their midpoint (the phone has no zoom buttons, A4).
 */
export function useMapViewport(svgRef, resetKey, initialFocus, fitKey = null) {
  const [size, setSize] = useState({ width: 960, height: 540 });
  const aspect = size.height / size.width;
  const baseWidth = Math.max(WORLD.w, WORLD.h / aspect);
  const frame = useCallback((w, x, y) => {
    const width = clamp(w, baseWidth / MAX_ZOOM, baseWidth);
    const height = width * aspect;
    return { w: width, h: height,
      x: width > WORLD.w ? (WORLD.w - width) / 2 : clamp(x, 0, WORLD.w - width),
      y: height > WORLD.h ? (WORLD.h - height) / 2 : clamp(y, 0, WORLD.h - height) };
  }, [aspect, baseWidth]);
  const [view, setView] = useState({ ...WORLD });
  const [panning, setPanning] = useState(false);
  const [canRestore, setCanRestore] = useState(false);
  const inspectionOrigin = useRef(null);
  const viewRef = useRef(view);
  const drag = useRef(null);
  const suppressClick = useRef(false);
  // The last explicit fit ({ bounds, layout }) while the camera still shows it; cleared by any camera move.
  const activeFit = useRef(null);
  const touches = useRef(new Map());
  const pinch = useRef(null);
  viewRef.current = view;
  const fx = initialFocus?.x, fy = initialFocus?.y, fw = initialFocus?.w, fh = initialFocus?.h;
  const layout = initialFocus?.layout;
  const hasLayout = !!layout && typeof layout === 'object';
  const ll = layout?.l, lr = layout?.r, lt = layout?.t, lb = layout?.b, lp = layout?.pad;
  /** The theatre camera for the current canvas (the initial focus, else the whole world). */
  const theatreView = useCallback(() => {
    const fitted = fw && fh && hasLayout
      ? computeFitView({ x: fx, y: fy, w: fw, h: fh }, size, frame, { l: ll, r: lr, t: lt, b: lb, pad: lp })
      : null;
    if (fitted) return fitted;
    if (fw && fh) {
      const width = Math.max(fw, fh / aspect) * 1.08;
      return frame(width, fx + fw / 2 - width / 2, fy + fh / 2 - width * aspect / 2);
    }
    return frame(baseWidth, (WORLD.w - baseWidth) / 2, (WORLD.h - baseWidth * aspect) / 2);
  }, [fx, fy, fw, fh, hasLayout, ll, lr, lt, lb, lp, size, aspect, baseWidth, frame]);
  const reset = useCallback(() => {
    inspectionOrigin.current = null;
    activeFit.current = null;
    setCanRestore(false);
    // Keep the ref current, so an explicit fit in the same commit records the theatre as its return target.
    const next = theatreView();
    viewRef.current = next;
    setView(next);
  }, [theatreView]);

  const previousCamera = useRef(null);
  const settled = previousCamera.current;
  // Until a new theatre is framed for the canvas it will have, the view is a stand-in: callers can skip work that
  // depends on it (label layout). Only a new resetKey (another campaign or country) or a pending canvas fit counts:
  // both are always followed by a camera update, hence a render. A focus change within a campaign (the phone near
  // frame, a conquest refit) may leave the view as it is and must never hide the labels.
  const framing = !settled || settled.needsFit || settled.resetKey !== resetKey;
  useEffect(() => {
    const previous = previousCamera.current;
    const newTheatre = !previous || previous.resetKey !== resetKey ||
      previous.fx !== fx || previous.fy !== fy || previous.fw !== fw || previous.fh !== fh;
    const rect = svgRef.current?.getBoundingClientRect();
    // A theatre change may reveal the sidebar in the same render. Take the
    // canvas size from the layout now and frame once, for that aspect.
    const needsFit = (newTheatre || previous?.needsFit) && rect?.width > 0 && rect.height > 0 &&
      Math.abs(rect.height / rect.width - aspect) > .0001;
    previousCamera.current = { resetKey, fx, fy, fw, fh, baseWidth, aspect, needsFit, fitKey };
    // Frame once, for the canvas the layout already has: the next pass (previous.needsFit) resets or refits with
    // the right aspect, rather than framing a stand-in first and again after ResizeObserver reports.
    if (needsFit) {
      setSize({ width: rect.width, height: rect.height });
      return;
    }
    if (newTheatre || previous.needsFit) {
      // An untouched explicit fit outlives a theatre change of the same campaign: a reloaded signing (resume() runs
      // fitMap() and frames the conquest in one commit, then the canvas settles) and the conquest view crossing the
      // 700px breakpoint (the phone near frame ↔ the theatre, D1 ↔ D2). It is re-fitted to the canvas, and its
      // return target becomes the new theatre on that canvas. A new campaign (resetKey) discards it.
      const fit = previous && previous.resetKey === resetKey && activeFit.current;
      const refit = fit && computeFitView(fit.bounds, size, frame, typeof fit.layout === 'function' ? fit.layout(size) : fit.layout);
      if (refit) {
        if (inspectionOrigin.current) inspectionOrigin.current = { view: theatreView(), baseWidth };
        const current = viewRef.current;
        // After a pending canvas fit (`framing` this render) one more render must follow, even for an equal view.
        if (previous.needsFit || ['x', 'y', 'w', 'h'].some(key => Math.abs(refit[key] - current[key]) > 1e-9)) {
          viewRef.current = refit;
          setView(refit);
        }
        return;
      }
      reset();
      return;
    }
    const resized = previous.baseWidth !== baseWidth || previous.aspect !== aspect;
    if (!resized && previous.fitKey === fitKey) return;
    const fit = activeFit.current;
    if (fit) {
      // An untouched explicit fit (the D1 conquest frame, a history inspection) is re-fitted to the new canvas.
      const next = computeFitView(fit.bounds, size, frame, typeof fit.layout === 'function' ? fit.layout(size) : fit.layout);
      if (next) {
        const current = viewRef.current;
        if (['x', 'y', 'w', 'h'].some(key => Math.abs(next[key] - current[key]) > 1e-9)) {
          viewRef.current = next;
          setView(next);
        }
        return;
      }
    }
    if (!resized) return;
    // Keep the chosen location and zoom when the browser or sidebar resizes.
    // frame() still clamps the camera at the map edges and minimum zoom.
    setView(current => {
      const width = current.w * baseWidth / previous.baseWidth;
      return frame(width, current.x + current.w / 2 - width / 2,
        current.y + current.h / 2 - width * aspect / 2);
    });
  }, [resetKey, fx, fy, fw, fh, baseWidth, aspect, size, frame, reset, theatreView, fitKey]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return undefined;
    // A hidden map (display:none) measures 0×0: keep the last real size so hiding never moves the camera.
    const measure = () => {
      const r = svg.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize(old => old.width === r.width && old.height === r.height ? old : { width: r.width, height: r.height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    measure();
    return () => observer.disconnect();
  }, [svgRef]);

  const zoomAt = useCallback((factor, clientX, clientY) => {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const v = viewRef.current;
    const screenScale = Math.min(rect.width / v.w, rect.height / v.h);
    const ox = (rect.width - v.w * screenScale) / 2;
    const oy = (rect.height - v.h * screenScale) / 2;
    const wx = v.x + (clientX - rect.left - ox) / screenScale;
    const wy = v.y + (clientY - rect.top - oy) / screenScale;
    const next = frame(v.w / factor, 0, 0);
    activeFit.current = null;
    setView(frame(next.w, wx - (wx - v.x) * next.w / v.w, wy - (wy - v.y) * next.h / v.h));
  }, [svgRef, frame]);

  const zoomBy = useCallback(factor => {
    const v = viewRef.current;
    const next = frame(v.w / factor, 0, 0);
    activeFit.current = null;
    setView(frame(next.w, v.x + (v.w - next.w) / 2, v.y + (v.h - next.h) / 2));
  }, [frame]);

  const reveal = useCallback(points => {
    const current = viewRef.current;
    const next = computeRevealView(current, points, size, frame);
    if (next === current) return;
    activeFit.current = null;
    viewRef.current = next;
    setView(next);
  }, [size, frame]);

  const fitBounds = useCallback((bounds, fitLayout) => {
    // Fit the canvas as laid out now, not the last ResizeObserver report: the conquest view widens the map in the
    // same commit that sets focusBounds (A-2, D1). The resize that follows then re-fits to the same view.
    const canvas = measuredSize(svgRef) || size;
    const sameSize = canvas.width === size.width && canvas.height === size.height;
    const layoutFor = typeof fitLayout === 'function' ? fitLayout(canvas) : fitLayout;
    const next = computeFitView(bounds, canvas, sameSize ? frame : undefined, layoutFor);
    if (!next) return;
    // Several conquests can be inspected before returning to the exploration view.
    if (!inspectionOrigin.current) inspectionOrigin.current = { view: { ...viewRef.current }, baseWidth };
    activeFit.current = { bounds, layout: fitLayout };
    setCanRestore(true);
    viewRef.current = next;
    setView(next);
    if (!sameSize) setSize(canvas);
  }, [svgRef, size, frame, baseWidth]);

  const restore = useCallback(() => {
    const saved = inspectionOrigin.current;
    if (!saved) return;
    const width = saved.view.w * baseWidth / saved.baseWidth;
    const next = frame(width, saved.view.x + saved.view.w / 2 - width / 2,
      saved.view.y + saved.view.h / 2 - width * aspect / 2);
    inspectionOrigin.current = null;
    activeFit.current = null;
    setCanRestore(false);
    viewRef.current = next;
    setView(next);
  }, [frame, baseWidth, aspect]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = e => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * .0016), e.clientX, e.clientY); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [svgRef, zoomAt]);

  const onMouseDown = useCallback(e => {
    const touch = e.pointerType === 'touch' && e.pointerId != null;
    if (touch) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touch && touches.current.size >= 2) {
      // A second finger turns the gesture into a pinch; neither finger can then tap a country.
      const [a, b] = [...touches.current.values()];
      pinch.current = { distance: Math.hypot(b.x - a.x, b.y - a.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        view: viewRef.current };
      drag.current = null;
      suppressClick.current = true;
      return;
    }
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, view: viewRef.current, travel: 0 };
    suppressClick.current = false;
    // Keep the original country as the click target after a touch tap.
    if (touch) {
      try { e.target.setPointerCapture?.(e.pointerId); } catch { /* the pointer is no longer active */ }
    }
  }, []);
  const onMouseMove = useCallback(e => {
    const el = svgRef.current;
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const p = pinch.current;
    if (p) {
      if (!el || touches.current.size < 2 || !(p.distance > 0)) return;
      const [a, b] = [...touches.current.values()];
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const rect = el.getBoundingClientRect();
      if (!(distance > 0) || !rect.width || !rect.height) return;
      // Keep the map point under the starting midpoint under the fingers' current midpoint.
      const v = p.view;
      const startScale = Math.min(rect.width / v.w, rect.height / v.h);
      const wx = v.x + (p.mid.x - rect.left - (rect.width - v.w * startScale) / 2) / startScale;
      const wy = v.y + (p.mid.y - rect.top - (rect.height - v.h * startScale) / 2) / startScale;
      const zoomed = frame(v.w * p.distance / distance, 0, 0);
      const scale = Math.min(rect.width / zoomed.w, rect.height / zoomed.h);
      const mx = (a.x + b.x) / 2 - rect.left - (rect.width - zoomed.w * scale) / 2;
      const my = (a.y + b.y) / 2 - rect.top - (rect.height - zoomed.h * scale) / 2;
      const next = frame(zoomed.w, wx - mx / scale, wy - my / scale);
      activeFit.current = null;
      viewRef.current = next;
      setView(next);
      return;
    }
    const d = drag.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.travel = Math.max(d.travel, Math.abs(dx) + Math.abs(dy));
    if (d.travel < 4) return;
    setPanning(true);
    suppressClick.current = true;
    activeFit.current = null;
    const rect = el.getBoundingClientRect();
    const scale = Math.min(rect.width / d.view.w, rect.height / d.view.h);
    if (scale) setView(frame(d.view.w, d.view.x - dx / scale, d.view.y - dy / scale));
  }, [svgRef, frame]);
  const endDrag = useCallback(e => {
    if (e?.pointerId != null) touches.current.delete(e.pointerId);
    // Lifting one finger of a pinch ends the gesture without starting a pan from the remaining finger.
    if (touches.current.size < 2) pinch.current = null;
    drag.current = null;
    setPanning(false);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const events = ['pointerup', 'pointercancel', 'mouseup'];
    events.forEach(type => window.addEventListener(type, endDrag));
    return () => events.forEach(type => window.removeEventListener(type, endDrag));
  }, [endDrag]);

  return { view, size, zoom: baseWidth / view.w, panning, framing, reset, zoomBy, reveal, fitBounds, restore, canRestore,
    didPan: () => suppressClick.current,
    handlers: { onMouseDown, onMouseMove, onMouseUp: endDrag, onDoubleClick: reset } };
}
