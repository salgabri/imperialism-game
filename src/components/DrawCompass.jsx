import React from 'react';
import './draw-compass.css';

const TAU = Math.PI * 2;

/** The parent owns the draw stages and clock; this instrument only presents them. */
export default function DrawCompass({
  x, y, angle = 0, stage = 'ready', durationMs = 0, reducedMotion = false, k = 1,
  attackerName, targetName, targetX, targetY,
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
export function AttackVector({ x1, y1, x2, y2, k = 1, reducedMotion = false }) {
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const scale = Number.isFinite(k) && k > 0 ? k : 1;
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
      pointerEvents="none" aria-hidden="true" style={{ animation: reducedMotion ? 'none' : undefined }}>
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
