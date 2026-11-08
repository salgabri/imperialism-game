// Owner: WP-LEDGER (see PLAN.md §4). Chronicle right column: turning points (campaignRecap) and the activity
// feed (former Sidebar "Activity"), newest first, one line per entry under its round, paged to what fits.
import React, { useMemo } from 'react';
import Pager from '../../components/Pager.jsx';
import { usePagedList } from '../../hooks/useFit.js';
import { roman } from '../../viewModels/format.js';

export function TurningPoints({ items = [] }) {
  if (!items.length) return null;
  return (
    <section className="chronicle-turning" aria-labelledby="chronicle-turning-title">
      <div className="kicker"><h2 className="kicker__title" id="chronicle-turning-title">Turning points</h2></div>
      <dl className="chronicle-turning__list">
        {items.map(item => (
          <div key={item.key} className="chronicle-turning__item">
            <dt>{item.label}</dt>
            <dd>{item.text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** `${id}-n`, where n counts the earlier calls with the same id. */
function countedKey(seen, id) {
  const n = seen.get(id) || 0;
  seen.set(id, n + 1);
  return `${id}-${n}`;
}

/**
 * One row per entry, with its round's numeral on the first of each run. Tolerates the W1 stub feed shape
 * ({ round: 'R12', chip, color, text } without `key`, `roman` or `kind`): the numeral is then derived from `round`.
 * React keys count from the oldest end (by round, kind and text), so a new entry inserts one row and a dropped one
 * removes one instead of re-keying the whole feed: the model keys are log positions, which move once the log is capped.
 */
function activityRows(entries) {
  const seen = new Map();
  const rows = entries.map((entry, index) => ({
    entry,
    first: index === 0 || entries[index - 1].round !== entry.round,
    numeral: entry.roman ?? roman(Number(String(entry.round ?? '').replace(/^R/, ''))),
  }));
  for (let i = rows.length - 1; i >= 0; i--) {
    rows[i].key = countedKey(seen, `${rows[i].entry.round ?? ''}|${rows[i].entry.kind ?? ''}|${rows[i].entry.text ?? ''}`);
  }
  return rows;
}

// Memoised: the feed model keeps its identity until the log changes.
export const ActivityFeed = React.memo(function ActivityFeed({ entries = [] }) {
  const rows = useMemo(() => activityRows(entries), [entries]);
  const paged = usePagedList(rows, { row: '.fi-activity-item' });
  return (
    <section className="fi-activity" aria-labelledby="chronicle-activity-title">
      <div className="kicker">
        <h2 className="kicker__title" id="chronicle-activity-title">Activity</h2>
        <Pager page={paged.page} pages={paged.pages} onPage={paged.setPage} label="Activity pages" />
      </div>
      {!rows.length
        ? <p className="fi-activity-empty">No activity yet.</p>
        : (
          <div className="fi-activity-box" ref={paged.boxRef}>
            <ol className="fi-activity-list" aria-label="Campaign activity">
              {paged.shown.map(row => (
                <li key={row.key} className="fi-activity-item" data-kind={row.entry.kind || undefined} title={row.entry.text}>
                  <span className={`fi-activity-round${row.first ? '' : ' is-repeat'}`}>{row.first ? (row.numeral ? `Round ${row.numeral}` : 'Start') : ''}</span>
                  <i className="fi-activity-mark" aria-hidden="true" />
                  <span className="fi-activity-text">{row.entry.text}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
    </section>
  );
});
