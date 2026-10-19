// Owner: WP-COL (see PLAN.md §4). "Latest results" list (A§7): round numeral · "Germany beat Czechia" · meta.
import React from 'react';

/** Rows from buildLatestResults (≤ 4, newest first; CSS keeps 2 at 700–1599px). "Chronicle" opens the Chronicle view. */
export default function LatestResults({ results = null, onOpenChronicle }) {
  const rows = Array.isArray(results?.rows) ? results.rows : [];
  return (
    <section className="results-list" aria-labelledby="results-kicker">
      <div className="kicker results-list__kicker">
        <h2 className="kicker__title v4-column__heading" id="results-kicker">Latest results</h2>
        {typeof onOpenChronicle === 'function'
          ? <button type="button" className="kicker__aside results-list__more" onClick={() => onOpenChronicle()}>Chronicle</button>
          : <span className="kicker__aside">Chronicle</span>}
      </div>
      {rows.length ? <ol className="results-list__rows">
        {rows.map(row => (
          <li key={row.key} className="results-list__row">
            <span className="results-list__round">{row.roman ? <><span className="sr-only">Round </span>{row.roman}</> : null}</span>
            <div className="results-list__body">
              <p className="results-list__title">{row.title}</p>
              <p className="results-list__meta">{row.meta}</p>
            </div>
          </li>
        ))}
      </ol> : <p className="results-list__empty">No results yet.</p>}
    </section>
  );
}
