// Owner: WP-MATCH (see PLAN.md §4). Live win-probability chart (B§1.5.1–1.5.2, B§2.5, DEC D6).
// One viewBox 800 wide at 100% width; strokes are in viewBox units. 132 tall on a phone (358×59); wherever the plot has
// a box of its own to fill (compact pass: the Match view at ≥700) the viewBox takes that box's shape, so the chart grows
// without stretching its lines and markers.
import React, { useEffect, useRef, useState } from 'react';
import { winSeries, chartGeometry } from '../../engine/winProbability.js';
import { formatWinChance } from '../../viewModels/format.js';
import { useMatchMinute } from './useMatchMinute.js';
import { clockLabel, clockTick, getSport } from '../../sports/index.js';

const W = 800, BASE_H = 132, MAX_H = 480;

/** The viewBox height that matches the plot's box, while CSS lays the drawing out to fill it (position:absolute). */
function usePlotHeight() {
  const plotRef = useRef(null);
  const [height, setHeight] = useState(BASE_H);
  useEffect(() => {
    const plot = plotRef.current;
    const view = plot?.ownerDocument?.defaultView;
    if (!plot || typeof view?.ResizeObserver !== 'function') return undefined;
    const measure = () => {
      const svg = plot.querySelector('svg');
      if (!svg || view.getComputedStyle(svg).position !== 'absolute') { setHeight(BASE_H); return; }
      const { width, height: boxHeight } = svg.getBoundingClientRect();
      if (width > 0 && boxHeight > 0) setHeight(Math.max(BASE_H, Math.min(MAX_H, Math.round(W * boxHeight / width))));
    };
    measure();
    const observer = new view.ResizeObserver(measure);
    observer.observe(plot);
    return () => observer.disconnect();
  }, []);
  return [plotRef, height];
}

/** Axis length: regulation, extended by whole overtime periods once the clock passes it. */
function axisLength(length, ot, minute) {
  if (!(ot > 0) || minute <= length) return length;
  return length + Math.ceil((minute - length) / ot) * ot;
}

function ticksFor(sport, length, axis, ot) {
  // A sport's own tick (baseball: every inning); basketball ticks its quarters (ten minutes under FIBA rules, twelve in
  // the NBA); the others every 15'.
  const step = Number(getSport(sport).clock?.tick) || (sport === 'basketball' ? length / 4 : 15);
  const ticks = [];
  for (let t = 0; t <= length; t += step) ticks.push(t);
  if (ticks.at(-1) !== length) ticks.push(length);
  for (let t = length + ot; ot > 0 && t <= axis; t += ot) ticks.push(t);
  return ticks;
}

function safeSeries(args) {
  try {
    const series = winSeries(args);
    return Array.isArray(series) ? series.filter(point => Number.isFinite(point?.t) && Number.isFinite(point?.p)) : [];
  } catch { return []; }
}

export default function WinChart({ sport = 'football', live = false, model = null, goals = [], perspective = null, final = null,
  length = 90, ot = 0, chartNote = null, aId = null, dId = null, minuteStore = null, minuteFallback = 0, minuteFloor = 0 }) {
  const minute = useMatchMinute({ live, minuteStore, minuteFallback, minuteFloor });
  const [plotRef, H] = usePlotHeight();
  const reactId = React.useId();
  const patternId = `match-hatch-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const series = React.useMemo(() => (model
    ? safeSeries({ model, goals, aId, dId, minute, perspective: perspective?.side || 'A', final })
    : []), [model, goals, aId, dId, minute, perspective?.side, final]);
  const regulation = Number(model?.length) || length;
  const overtime = Number(model?.ot) || ot;
  const lastT = series.length ? series[series.length - 1].t : minute;
  const axis = axisLength(regulation, overtime, lastT);
  const label = `${perspective?.code || ''} win probability`.trim();
  if (!model) {
    return (
      <section className="match-chart match-chart--empty" aria-label="Win probability">
        <div className="kicker match-chart__head">
          <h2 className="kicker__title match-chart__label">Win probability</h2>
          <span className="match-chart__value" aria-hidden="true">—</span>
        </div>
        {chartNote && <p className="match-chart__note">{chartNote}</p>}
      </section>
    );
  }
  let geometry = { line: '', area: '', now: null };
  try { geometry = series.length ? chartGeometry(series, { width: W, height: H, length: axis, markers: [] }) || geometry : geometry; }
  catch { /* keep the empty chart */ }
  const now = series.at(-1) || null;
  // A decided match ends the series at exactly 1 / 0 (DEC D6): say "100%" / "0%", not the estimate clamps ">99%" / "<1%".
  const settled = !!final && !!now && (now.p >= 1 || now.p <= 0);
  const value = now ? (settled ? `${Math.round(now.p * 100)}%` : formatWinChance(now.p)) : '—';
  const pointAt = t => series.find(point => point.t === t) || series.filter(point => point.t <= t).at(-1) || null;
  // Basketball scoring runs are too dense to mark; football goals sit on the post-goal value (B§1.5.2).
  const markers = (model.kind === 'normal' ? [] : goals).filter(goal => goal.m <= lastT).map((goal, i) => {
    const point = pointAt(Math.ceil(goal.m));
    return point ? { key: `${goal.tid}-${goal.m}-${i}`, x: (Math.ceil(goal.m) / axis) * W, y: H - point.p * H } : null;
  }).filter(Boolean);
  const nowPoint = geometry.now && Number.isFinite(geometry.now.x) ? geometry.now
    : now ? { x: (now.t / axis) * W, y: H - now.p * H } : null;
  const half = ((regulation / 2) / axis) * W;
  const ticks = ticksFor(sport, regulation, axis, overtime);
  return (
    <section className="match-chart" aria-labelledby={`${patternId}-label`}>
      <div className="kicker match-chart__head">
        <h2 className="kicker__title match-chart__label" id={`${patternId}-label`}>{label}</h2>
        <span className="match-chart__value">{value}</span>
      </div>
      <div className="match-chart__plot" ref={plotRef}>
        <svg className="match-chart__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
          aria-label={`${label} ${value} at ${clockLabel(sport, minute)}`} focusable="false">
          <defs>
            <pattern id={patternId} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
              <rect width="1.2" height="5" className="match-chart__hatch" />
            </pattern>
          </defs>
          <rect width={W} height={H} className="match-chart__bg" />
          <path d={`M0 ${H * .25}H${W}M0 ${H * .75}H${W}`} className="match-chart__guide" />
          <path d={`M0 ${H / 2}H${W}`} className="match-chart__even" />
          {/* Half-time, in the sports that have one (baseball's words.half is null). */}
          {getSport(sport).words?.half !== null && <path d={`M${half} 0V${H}`} className="match-chart__guide" />}
          {geometry.area && <path d={geometry.area} fill={`url(#${patternId})`} className="match-chart__area" />}
          {geometry.line && <path d={geometry.line} className="match-chart__line" />}
          {markers.map(marker => <circle key={marker.key} cx={marker.x} cy={marker.y} r="4.5" className="match-chart__goal" />)}
          {nowPoint && <circle cx={nowPoint.x} cy={nowPoint.y} r="4" className="match-chart__now" />}
        </svg>
        <div className="match-chart__axis" aria-hidden="true">
          {ticks.map(t => {
            const frac = axis ? t / axis : 0;
            return <span key={t} style={{ left: `${frac * 100}%`, transform: `translateX(${-frac * 100}%)` }}>{clockTick(sport, t)}</span>;
          })}
        </div>
      </div>
    </section>
  );
}
