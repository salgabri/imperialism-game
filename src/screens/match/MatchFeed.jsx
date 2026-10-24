// Owner: WP-MATCH (see PLAN.md §4). Dark match feed (B§1.6, B§2.6): newest first, status row on top.
import React from 'react';
import { buildFeedRows } from '../../viewModels/match.js';
import { useMatchMinute } from './useMatchMinute.js';
import SpeedControls from './SpeedControls.jsx';

export default function MatchFeed({ model, live = false, minuteStore = null, minuteFallback = 0, minuteFloor = 0,
  speed = 1, paused = false, onSpeed, onPause }) {
  const minute = useMatchMinute({ live, minuteStore, minuteFallback, minuteFloor });
  const rows = buildFeedRows(model, minute);
  return (
    <aside className="match-feed" aria-labelledby="match-feed-title">
      <div className="match-feed__head">
        <h2 className="match-feed__title" id="match-feed-title">Match feed</h2>
        <span className="match-feed__order">Newest first</span>
      </div>
      <div className="match-feed__body" role="log" aria-live="polite" aria-label="Match feed">
        <span className="match-feed__cursor" aria-hidden="true" />
        {rows.map(row => (
          <div key={row.key} className={`match-feed__row${row.status ? ' is-status' : ''}`} data-weight={row.weight}
            aria-hidden={row.live ? 'true' : undefined}>
            <span className="match-feed__minute">{row.minute}</span>
            <span className="match-feed__text">{row.text}</span>
          </div>
        ))}
      </div>
      <div className="match-feed__foot">
        <SpeedControls speed={speed} paused={paused} onSpeed={onSpeed} onPause={onPause} tone="dark" />
      </div>
    </aside>
  );
}
