import React, { useEffect, useRef } from 'react';
import './draw-compass.css';

const TAU = Math.PI * 2;
/** Outer radius (px) of the dial: r32 plus half of its 1.1px outline. */
const DIAL_OUTER_PX = 32.55;
/** Outer radius (px) of the locked source pointer: legible at every width, small enough to leave the map readable. */
export const LOCKED_POINTER_PX = 13;
/** The locked pointer never reaches further along the route than this share of it (the arrow head starts ≥ 60%). */
const LOCKED_REACH = .42;
/** AttackVector draws no route shorter than this (screen px). */
const MIN_ROUTE_PX = .5;

/**
 * The locked pointer's placement in px around the draw origin. On a route long enough it is centred on the origin;
 * on a short one it keeps its legible size and slides back, away from the target, so its front edge stops at 42% of
 * the drawn arrow and the arrow head stays exposed (the Bosnia→Montenegro regression), instead of shrinking to a dot on
 * a zoomed-out phone or tablet map. The drawn arrow is never shorter than ARROW.minLength: a shorter route starts
 * behind the origin (AttackVector), so the 42% is measured from that start. → { dx, dy } in screen px.
 */
export function lockedPointerOffset({ x, y, targetX, targetY, angle = 0, k = 1 }) {
  const scale = Number.isFinite(k) && k > 0 ? k : 1;
  if (![x, y, targetX, targetY].every(Number.isFinite)) return { dx: 0, dy: 0 };
  const distance = Math.hypot(targetX - x, targetY - y) / scale;
  // AttackVector draws nothing under half a pixel, so a coincident target keeps the plain 13px slide.
  const shown = distance < MIN_ROUTE_PX ? distance : Math.max(distance, ARROW.minLength);
  const back = Math.max(0, LOCKED_POINTER_PX - (distance - shown * (1 - LOCKED_REACH)));
  if (!(back > 0)) return { dx: 0, dy: 0 };
  // Away from the target; a coincident target falls back to the needle's bearing.
  const bearing = Number.isFinite(angle) ? angle * Math.PI / 180 : 0;
  const ux = distance > 0 ? (targetX - x) / scale / distance : Math.cos(bearing);
  const uy = distance > 0 ? (targetY - y) / scale / distance : Math.sin(bearing);
  return { dx: +(-ux * back).toFixed(3) || 0, dy: +(-uy * back).toFixed(3) || 0 };
}

/** The parent owns the draw stages and clock; this instrument only presents them. */
export default function DrawCompass({
  x, y, angle = 0, stage = 'ready', durationMs = 0, reducedMotion = false, k = 1,
  attackerName, targetName, targetX, targetY,
  paused = false,
}) {
  const scale = Number.isFinite(k) && k > 0 ? k : 1;
  const rotation = Number.isFinite(angle) ? angle : 0;
  const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const locked = stage === 'locked';
  // The large dial owns the draw. Once locked, it becomes a 13px source pointer so nearby opponents and the newly
  // revealed route remain visible; on a short route it slides back from the origin rather than shrinking.
  const instrumentScale = locked ? LOCKED_POINTER_PX / DIAL_OUTER_PX : 1;
  const offset = locked ? lockedPointerOffset({ x, y, targetX, targetY, angle: rotation, k: scale }) : { dx: 0, dy: 0 };
  const instrumentTransform = `${offset.dx || offset.dy ? `translate(${offset.dx} ${offset.dy}) ` : ''}scale(${instrumentScale})`;
  const description = locked
    ? `${attackerName || 'Attacker'} locked on ${targetName || 'opponent'}`
    : `Drawing an attack direction for ${attackerName || 'the selected team'}`;
  const needleRef = useRef(null);
  const animationRef = useRef(null);
  useEffect(() => {
    const needle = needleRef.current;
    if (stage !== 'spinning' || reducedMotion || !needle?.animate) return undefined;
    // The animation and simulation use the parent's captured duration.
    // Inline transition remains the fallback when Web Animations is absent.
    needle.style.transition = 'none';
    const animation = needle.animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${rotation}deg)` }], {
      duration, easing: 'cubic-bezier(.12,.64,.16,1)', fill: 'forwards',
    });
    animationRef.current = animation;
    if (paused) animation.pause();
    return () => { animation.cancel(); animationRef.current = null; };
  }, [stage, reducedMotion, rotation, duration]);
  useEffect(() => {
    const animation = animationRef.current;
    if (animation) { if (paused) animation.pause(); else animation.play(); }
  }, [paused]);

  return (
    <g className={`draw-compass draw-compass--${stage}`} data-testid="draw-compass"
      data-stage={stage} data-angle={rotation}
      data-target-x={Number.isFinite(targetX) ? targetX : undefined}
      data-target-y={Number.isFinite(targetY) ? targetY : undefined}
      transform={`translate(${x} ${y}) scale(${scale})`} pointerEvents="none"
      role="img" aria-label={description}>
      <title>{description}</title>
      <g className="draw-compass-instrument" data-testid="draw-compass-instrument"
        data-scale={instrumentScale} transform={instrumentTransform}>
        <circle className="draw-compass-disk" r={32} />
        {!locked && <>
          <circle className="draw-compass-inner" r={22} />
          <g className="draw-compass-ticks" aria-hidden="true">
            {Array.from({ length: 12 }, (_, index) => {
              const bearing = index * TAU / 12;
              const inner = index % 3 === 0 ? 26 : 28;
              return <line key={index} x1={Math.cos(bearing) * inner} y1={Math.sin(bearing) * inner}
                x2={Math.cos(bearing) * 30} y2={Math.sin(bearing) * 30} />;
            })}
          </g>
          <text className="draw-compass-north" x={0} y={-14} textAnchor="middle" aria-hidden="true">N</text>
        </>}
        <g className="draw-compass-needle" data-testid="draw-compass-needle"
          ref={needleRef}
          style={{ transform: `rotate(${rotation}deg)`,
            transition: stage === 'spinning' && !reducedMotion
              ? `transform ${duration}ms cubic-bezier(.12,.64,.16,1)` : 'none' }}
          aria-hidden="true">
          <path className="draw-compass-tail" d="M-20 0 L-2-4.5 L-2 4.5 Z" />
          <path className="draw-compass-tip" d="M26 0 L-2-4.5 L-2 4.5 Z" />
          <path className="draw-compass-needle-seam" d="M-17 0 H22" />
        </g>
        <circle className="draw-compass-pivot" r={3.2} />
        <circle className="draw-compass-pin" r={1} />
      </g>
    </g>
  );
}

/**
 * README §Map rendering line-of-attack values, in screen px (the group is scaled by the map's k). `minLength`: the
 * shortest arrow drawn on screen, so neighbouring capitals on a zoomed-out map still get a legible arrow (DEC D20).
 */
export const ARROW = Object.freeze({ bend: .22, halo: 7, shaft: 3.2, headStroke: 1.2, origin: 3.4, originStroke: 1.8,
  headLength: 18, headHalfWidth: 10, dash: '7 5', fullSizeAt: 24, minLength: 28 });

const round3 = value => +value.toFixed(3);

/**
 * A routed line's geometry in map units: total length, and the point `back` units before the end along the
 * polyline (the head base). Zero-length legs are ignored.
 */
export function routeGeometry(points, back) {
  const legs = [];
  for (let i = 1; i < points.length; i++) {
    const length = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    if (length > 0) legs.push({ from: points[i - 1], to: points[i], length });
  }
  const total = legs.reduce((sum, leg) => sum + leg.length, 0);
  let remaining = Math.min(Math.max(0, back), total);
  let base = points[0];
  for (let i = legs.length - 1; i >= 0; i--) {
    const leg = legs[i];
    if (remaining <= leg.length) {
      const t = leg.length ? remaining / leg.length : 0;
      base = [leg.to[0] - (leg.to[0] - leg.from[0]) * t, leg.to[1] - (leg.to[1] - leg.from[1]) * t];
      break;
    }
    remaining -= leg.length;
  }
  return { total, base };
}

/** The 7/5 preview dashes (map units) up to `stop`, then one gap past the end of the path. */
function dashesUntil(stop, total, dash, gap) {
  const list = [];
  for (let at = 0; at < stop - 1e-9; at += dash + gap) list.push(Math.min(dash, stop - at), gap);
  if (!list.length) return `0 ${round3(total + gap)}`;
  list[list.length - 1] = total + gap;
  return list.map(round3).join(' ');
}

/**
 * The v4 line of attack (README §Map rendering, DEC D20): a quadratic curve bent 22% of its length to the right of
 * travel, a white halo, an ink shaft with round caps, a filled ink head (length ≤18px, half-width ≤10px) with a
 * white edge and a white origin ring. `dashed` previews a choice (your turn): only the ink shaft is dashed.
 * Routes that bend through other land (sea, transit) keep the engine's polyline as `.draw-route-line` d; their
 * head is sized from the whole route (a short last leg to the shore never shrinks it), points from the head base
 * 18px back along the route to the end, and the halo and shaft stop at that base (a dash list over `pathLength`).
 * Everything is drawn without shared SVG ids or markers. An arrow is never drawn shorter than ARROW.minLength (28px):
 * a shorter straight route starts behind the attacker's capital so its tip stays exactly on the target capital, and a
 * short routed one sizes its head and strokes from that floor. Strokes would only shrink below fullSizeAt (24px).
 */
export function AttackVector({ x1, y1, x2, y2, k = 1, reducedMotion = false, paused = false, dashed = false,
  routePoints, routeD, routeKind, routeLabel }) {
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const scale = Number.isFinite(k) && k > 0 ? k : 1;
  const style = { animation: reducedMotion ? 'none' : undefined, animationPlayState: paused ? 'paused' : undefined };
  const points = routePoints?.map(point => Array.isArray(point) ? point : [point.x, point.y])
    .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (points?.length > 2 || routeKind && routeKind !== 'straight' || routeD && !points?.length) {
    const polyline = points?.length >= 2 ? points : [[x1, y1], [x2, y2]];
    const path = routeD || polyline.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
    const end = polyline.at(-1);
    const lengthPx = Math.max(routeGeometry(polyline, 0).total / scale, ARROW.minLength);
    const fit = Math.min(1, lengthPx / ARROW.fullSizeAt);
    const reach = Math.min(lengthPx * .4, ARROW.headLength);
    const headWidth = Math.min(lengthPx * .24, ARROW.headHalfWidth);
    const { total, base } = routeGeometry(polyline, reach * scale);
    const stop = Math.max(0, total - reach * scale);
    // The head runs from its base on the route to the end, so the shaft meets it exactly.
    const headLength = Math.hypot(end[0] - base[0], end[1] - base[1]) / scale;
    const bearing = headLength > 0 ? Math.atan2(end[1] - base[1], end[0] - base[0]) * 180 / Math.PI : 0;
    const length = total > 0 ? round3(total) : undefined;
    const solid = total > 0 ? `${round3(stop)} ${round3(total + 1)}` : undefined;
    return <g className="draw-route draw-route--routed" data-testid="attack-vector" data-route-kind={routeKind || 'sea'}
      data-dashed={dashed ? 'true' : undefined} pointerEvents="none" role="img" aria-label={routeLabel || 'Attack route'} style={style}>
      <title>{routeLabel || 'Attack route'}</title>
      <path className="draw-route-casing" d={path} fill="none" strokeWidth={ARROW.halo * fit * scale}
        pathLength={length} strokeDasharray={solid} />
      <path className="draw-route-line" d={path} fill="none" strokeWidth={ARROW.shaft * fit * scale} pathLength={length}
        strokeDasharray={dashed && total > 0 ? dashesUntil(stop, total, 7 * scale, 5 * scale) : solid} />
      <g transform={`translate(${end[0]} ${end[1]}) rotate(${round3(bearing)}) scale(${scale})`}>
        <path className="draw-route-arrow" data-testid="attack-vector-head"
          d={`M0 0 L${-round3(headLength)} ${-round3(headWidth)} L${-round3(headLength)} ${round3(headWidth)} Z`}
          strokeWidth={ARROW.headStroke * fit} />
      </g>
      <circle className="draw-route-origin" cx={x1} cy={y1} r={ARROW.origin * fit * scale} strokeWidth={ARROW.originStroke * fit * scale} />
    </g>;
  }
  const distance = Math.hypot(x2 - x1, y2 - y1) / scale;
  if (distance < MIN_ROUTE_PX) return null;
  const bearing = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  // Local frame: origin (0,0), tip (d,0); the unit normal (−dy, dx)/d maps to local +y. The drawn arrow is `shown`
  // long: a route shorter than ARROW.minLength starts at `start` < 0, behind the attacker's capital.
  const shown = Math.max(distance, ARROW.minLength);
  const start = round3(distance - shown);
  const fit = Math.min(1, shown / ARROW.fullSizeAt);
  const qx = start + shown / 2, qy = ARROW.bend * shown;
  const tangent = Math.hypot(distance - qx, qy);
  const tx = (distance - qx) / tangent, ty = -qy / tangent;
  const headLength = Math.min(shown * .4, ARROW.headLength);
  const headWidth = Math.min(shown * .24, ARROW.headHalfWidth);
  const bx = distance - tx * headLength, by = -ty * headLength;
  const shaft = `M${start} 0 Q${qx} ${qy} ${bx} ${by}`;
  const head = `M${distance} 0 L${bx + ty * headWidth} ${by - tx * headWidth} L${bx - ty * headWidth} ${by + tx * headWidth} Z`;

  return (
    <g className="draw-route" data-testid="attack-vector" data-distance-px={distance}
      data-dashed={dashed ? 'true' : undefined}
      transform={`translate(${x1} ${y1}) rotate(${bearing}) scale(${scale})`}
      pointerEvents="none" aria-hidden="true" style={style}>
      <path className="draw-route-casing" d={shaft} strokeWidth={ARROW.halo * fit} />
      <path className="draw-route-line" d={shaft} strokeWidth={ARROW.shaft * fit}
        strokeDasharray={dashed ? ARROW.dash : undefined} />
      <path className="draw-route-arrow" data-testid="attack-vector-head" d={head} strokeWidth={ARROW.headStroke * fit} />
      <circle className="draw-route-origin" cx={start || undefined} r={ARROW.origin * fit} strokeWidth={ARROW.originStroke * fit} />
    </g>
  );
}
