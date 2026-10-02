import React, { useEffect, useRef } from 'react';
import './draw-compass.css';

const TAU = Math.PI * 2;

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
  const targetDistance = [x, y, targetX, targetY].every(Number.isFinite)
    ? Math.hypot(targetX - x, targetY - y) / scale : NaN;
  // The large dial owns the draw. Once locked, it becomes a small source
  // pointer so nearby opponents and the newly revealed route remain visible.
  const lockedRadius = Number.isFinite(targetDistance) ? Math.min(13, targetDistance * .42) : 13;
  const instrumentScale = locked ? lockedRadius / 32.55 : 1; // r32 + half of the 1.1px outline
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
        data-scale={instrumentScale} transform={`scale(${instrumentScale})`}>
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

/** Screen-sized marks along a geographic route, without shared SVG marker IDs. */
export function AttackVector({ x1, y1, x2, y2, k = 1, reducedMotion = false, paused = false, routePoints, routeD, routeKind, routeLabel }) {
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const scale = Number.isFinite(k) && k > 0 ? k : 1;
  const points = routePoints?.map(point => Array.isArray(point) ? point : [point.x, point.y]);
  if (points?.length > 2 || routeKind && routeKind !== 'straight' || routeD && !points?.length) {
    const path = routeD || points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
    const end = points?.at(-1) || [x2, y2];
    const beforeEnd = points?.at(-2) || [x1, y1];
    const bearing = Math.atan2(end[1] - beforeEnd[1], end[0] - beforeEnd[0]) * 180 / Math.PI;
    const terminalDistance = Math.hypot(end[0] - beforeEnd[0], end[1] - beforeEnd[1]) / scale;
    const radius = Math.min(4.5, terminalDistance * .12);
    const clearance = Math.min(2, terminalDistance * .06);
    const tip = -radius - clearance;
    const headLength = Math.min(8, terminalDistance * .24);
    const headWidth = Math.min(3.5, terminalDistance * .1);
    return <g className="draw-route draw-route--routed" data-testid="attack-vector" data-route-kind={routeKind || 'sea'} pointerEvents="none" role="img" aria-label={routeLabel || 'Attack route'} style={{ animation: reducedMotion ? 'none' : undefined, animationPlayState: paused ? 'paused' : undefined }}>
      <title>{routeLabel || 'Attack route'}</title>
      <path className="draw-route-casing" d={path} fill="none" strokeWidth={4.5 * scale} />
      <path className="draw-route-line" d={path} fill="none" strokeWidth={1.65 * scale} strokeDasharray={`${6 * scale} ${4 * scale}`} />
      <circle className="draw-route-origin" cx={x1} cy={y1} r={2 * scale} strokeWidth={scale} />
      <g transform={`translate(${end[0]} ${end[1]}) rotate(${bearing}) scale(${scale})`}>
        <path className="draw-route-arrow" data-testid="attack-vector-head" d={`M${tip} 0 L${tip - headLength} ${-headWidth} L${tip - headLength} ${headWidth} Z`} strokeWidth={Math.min(1.3, terminalDistance * .07)} />
        <g className="draw-route-target" data-testid="attack-vector-target"><circle r={radius} /><path d={`M${-radius - clearance} 0h${clearance}M${radius} 0h${clearance}M0 ${-radius - clearance}v${clearance}M0 ${radius}v${clearance}`} /></g>
      </g>
    </g>;
  }
  const distance = Math.hypot(x2 - x1, y2 - y1) / scale;
  if (distance < .5) return null;
  const bearing = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  const radius = Math.min(4.5, distance * .12);
  const sourceRadius = Math.min(2, distance * .06);
  const clearance = Math.min(2, distance * .06);
  const tip = distance - radius - clearance;
  const headLength = Math.min(8, distance * .24);
  const headWidth = Math.min(3.5, distance * .1);
  const start = sourceRadius + clearance;
  const end = tip - headLength * .6;
  const shaft = `M${start} 0 H${end}`;
  const arrow = `M${tip} 0 L${tip - headLength} ${-headWidth} L${tip - headLength} ${headWidth} Z`;
  const fineStroke = Math.min(1.65, distance * .09);
  const casingStroke = Math.min(4.5, distance * .22);

  return (
    <g className="draw-route" data-testid="attack-vector" data-distance-px={distance}
      transform={`translate(${x1} ${y1}) rotate(${bearing}) scale(${scale})`}
      pointerEvents="none" aria-hidden="true" style={{ animation: reducedMotion ? 'none' : undefined, animationPlayState: paused ? 'paused' : undefined }}>
      {end > start && <>
        <path className="draw-route-casing" d={shaft} strokeWidth={casingStroke} />
        <path className="draw-route-line" d={shaft} strokeWidth={fineStroke}
          strokeDasharray={distance > 96 ? '6 4' : undefined} />
      </>}
      <circle className="draw-route-origin" r={sourceRadius} strokeWidth={Math.min(1, distance * .05)} />
      <path className="draw-route-arrow" data-testid="attack-vector-head" d={arrow}
        strokeWidth={Math.min(1.3, distance * .07)} />
      <g className="draw-route-target" data-testid="attack-vector-target" transform={`translate(${distance} 0)`}>
        <circle r={radius} strokeWidth={Math.min(1.3, distance * .07)} />
        {distance >= 24 && <path d="M-2 0 H2 M0-2 V2" />}
      </g>
    </g>
  );
}
