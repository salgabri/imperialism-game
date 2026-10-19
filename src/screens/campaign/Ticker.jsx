// Owner: WP-COL (see PLAN.md §4). The live ticker (A§8): LIVE block, a solid cursor, then results newest first
// as one static, clipped line (DEC misc: no marquee). Text keeps source case; CSS sets it in capitals.
import React from 'react';
import './campaign.css';

/** README: items are separated by wide spaces (8 of them, kept by `white-space: pre`). */
const TICKER_GAP = '        ';

export default function Ticker({ items = [] }) {
  const list = Array.isArray(items) ? items.filter(item => item && item.text) : [];
  return (
    <div className="ticker" aria-live="off">
      <span className="ticker__live">Live</span>
      <span className="ticker__cursor" aria-hidden="true" />
      <span className="ticker__text">
        {list.length ? list.map((item, i) => (
          <React.Fragment key={item.key ?? i}>
            {i > 0 ? TICKER_GAP : null}
            <span className="ticker__item">{item.text}</span>
          </React.Fragment>
        )) : <span className="ticker__empty">No results yet</span>}
      </span>
    </div>
  );
}
