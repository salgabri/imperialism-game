// Owner: WP-MATCH (see PLAN.md §4). Phone "Stats" segment (A-3): pre-match odds and strengths + speed and pause.
import React from 'react';
import SpeedControls from './SpeedControls.jsx';

export default function MatchStats({ preMatch = null, speed = 1, paused = false, onSpeed, onPause }) {
  return (
    <section className="match-stats" aria-labelledby="match-stats-title">
      <div className="kicker match-stats__kicker">
        <h2 className="kicker__title match-stats__title" id="match-stats-title">Before kick-off</h2>
        <span className="kicker__aside match-stats__aside">Estimate</span>
      </div>
      {preMatch?.odds ? (
        <div className="match-stats__odds">
          <span className="match-stats__odds-a">{preMatch.aLabel}</span>
          <span className="match-stats__bar" role="img" aria-label={preMatch.aria}>
            <span className="match-stats__fill" style={{ width: `${preMatch.fill}%` }} />
          </span>
          <span className="match-stats__odds-b">{preMatch.bLabel}</span>
        </div>
      ) : <p className="match-stats__meta">No pre-match estimate for this match.</p>}
      {(preMatch?.effA || preMatch?.effD) && (
        <p className="match-stats__meta">{`Strength ${preMatch.effA ?? '—'} v ${preMatch.effD ?? '—'}`}</p>
      )}
      <div className="kicker match-stats__kicker match-stats__kicker--playback">
        <h2 className="kicker__title match-stats__title">Playback</h2>
      </div>
      <SpeedControls speed={speed} paused={paused} onSpeed={onSpeed} onPause={onPause} tone="light" />
    </section>
  );
}
