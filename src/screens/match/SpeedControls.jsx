// Owner: WP-MATCH (see PLAN.md §4). Speed chips 1×/2×/4× + Pause (B§1.6 footer, DEC D14, A-12).
// `tone="dark"` sits in the feed footer; `tone="light"` is the phone Stats segment.
import React from 'react';

export const SPEEDS = [1, 2, 4];

export default function SpeedControls({ speed = 1, paused = false, onSpeed, onPause, tone = 'dark' }) {
  return (
    <div className={`match-speed match-speed--${tone}`}>
      <div className="match-speed__group" role="group" aria-label="Match speed">
        <span className="match-speed__label" aria-hidden="true">Speed</span>
        {SPEEDS.map(n => (
          <button key={n} type="button" className="match-speed__chip" aria-pressed={speed === n}
            aria-label={`Speed ${n}×`} onClick={() => onSpeed?.(n)}>{`${n}×`}</button>
        ))}
      </div>
      {/* A plain action button whose label says what it does next (no aria-pressed on a label that flips). */}
      <button type="button" className={`match-speed__pause${paused ? ' is-paused' : ''}`} onClick={() => onPause?.()}>
        {paused ? 'Resume' : 'Pause'}
      </button>
    </div>
  );
}
