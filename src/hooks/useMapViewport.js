import { useCallback, useEffect, useRef, useState } from 'react';

export const WORLD = { x: 0, y: 0, w: 960, h: 540 };
const MAX_ZOOM = 16;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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

/** A responsive camera over fixed geography: resizing never changes the rules. */
export function useMapViewport(svgRef, resetKey, initialFocus) {
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
  const viewRef = useRef(view);
  const drag = useRef(null);
  const suppressClick = useRef(false);
  viewRef.current = view;
  const fx = initialFocus?.x, fy = initialFocus?.y, fw = initialFocus?.w, fh = initialFocus?.h;
  const reset = useCallback(() => {
    if (fw && fh) {
      const width = Math.max(fw, fh / aspect) * 1.08;
      setView(frame(width, fx + fw / 2 - width / 2, fy + fh / 2 - width * aspect / 2));
    } else {
      setView(frame(baseWidth, (WORLD.w - baseWidth) / 2, (WORLD.h - baseWidth * aspect) / 2));
    }
  }, [fx, fy, fw, fh, aspect, baseWidth, frame]);

  const previousCamera = useRef(null);
  useEffect(() => {
    const previous = previousCamera.current;
    const newTheatre = !previous || previous.resetKey !== resetKey ||
      previous.fx !== fx || previous.fy !== fy || previous.fw !== fw || previous.fh !== fh;
    const rect = svgRef.current?.getBoundingClientRect();
    // A theatre change may reveal the sidebar in the same render. Complete
    // that initial fit after ResizeObserver reports the new canvas aspect.
    const needsFit = (newTheatre || previous?.needsFit) && rect?.width > 0 &&
      Math.abs(rect.height / rect.width - aspect) > .0001;
    previousCamera.current = { resetKey, fx, fy, fw, fh, baseWidth, aspect, needsFit };
    if (newTheatre || previous.needsFit) {
      reset();
      return;
    }
    if (previous.baseWidth === baseWidth && previous.aspect === aspect) return;
    // Keep the chosen location and zoom when the browser or sidebar resizes.
    // frame() still clamps the camera at the map edges and minimum zoom.
    setView(current => {
      const width = current.w * baseWidth / previous.baseWidth;
      return frame(width, current.x + current.w / 2 - width / 2,
        current.y + current.h / 2 - width * aspect / 2);
    });
  }, [resetKey, fx, fy, fw, fh, baseWidth, aspect, frame, reset]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return undefined;
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
    setView(frame(next.w, wx - (wx - v.x) * next.w / v.w, wy - (wy - v.y) * next.h / v.h));
  }, [svgRef, frame]);

  const zoomBy = useCallback(factor => {
    const v = viewRef.current;
    const next = frame(v.w / factor, 0, 0);
    setView(frame(next.w, v.x + (v.w - next.w) / 2, v.y + (v.h - next.h) / 2));
  }, [frame]);

  const reveal = useCallback(points => {
    const current = viewRef.current;
    const next = computeRevealView(current, points, size, frame);
    if (next === current) return;
    viewRef.current = next;
    setView(next);
  }, [size, frame]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = e => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * .0016), e.clientX, e.clientY); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [svgRef, zoomAt]);

  const onMouseDown = useCallback(e => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, view: viewRef.current, travel: 0 };
    suppressClick.current = false;
    // Keep the original country as the click target after a touch tap.
    if (e.pointerType === 'touch') e.target.setPointerCapture?.(e.pointerId);
  }, []);
  const onMouseMove = useCallback(e => {
    const d = drag.current;
    const el = svgRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.travel = Math.max(d.travel, Math.abs(dx) + Math.abs(dy));
    if (d.travel < 4) return;
    setPanning(true);
    suppressClick.current = true;
    const rect = el.getBoundingClientRect();
    const scale = Math.min(rect.width / d.view.w, rect.height / d.view.h);
    if (scale) setView(frame(d.view.w, d.view.x - dx / scale, d.view.y - dy / scale));
  }, [svgRef, frame]);
  const endDrag = useCallback(() => { drag.current = null; setPanning(false); }, []);
  useEffect(() => {
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('mouseup', endDrag);
    return () => { window.removeEventListener('pointerup', endDrag); window.removeEventListener('mouseup', endDrag); };
  }, [endDrag]);

  return { view, size, zoom: baseWidth / view.w, panning, reset, zoomBy, reveal,
    didPan: () => suppressClick.current,
    handlers: { onMouseDown, onMouseMove, onMouseUp: endDrag, onDoubleClick: reset } };
}
