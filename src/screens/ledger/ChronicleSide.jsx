// Owner: WP-LEDGER (see PLAN.md §4). Chronicle right column: turning points (campaignRecap) and the activity
// feed (former Sidebar "Activity"), grouped by round, newest first.
import React from 'react';
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
 * Consecutive entries of one round. Tolerates the W1 stub feed shape ({ round: 'R12', chip, color, text } without
 * `key`, `roman` or `kind`): the numeral is then derived from `round`.
 * React keys count from the oldest end (a group by its round, an item by its kind and text), so a new entry inserts
 * one row and a dropped one removes one instead of re-keying the whole feed: the model keys are log positions, which
 * move once the log is capped.
 */
function groupByRound(entries) {
  const groups = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.round === entry.round) last.items.push(entry);
    else {
      const numeral = entry.roman ?? roman(Number(String(entry.round ?? '').replace(/^R/, '')));
      groups.push({ round: entry.round, roman: numeral, items: [entry] });
    }
  }
  const rounds = new Map();
  for (let g = groups.length - 1; g >= 0; g--) {
    const group = groups[g], texts = new Map();
    group.key = countedKey(rounds, group.round);
    group.itemKeys = [];
    for (let i = group.items.length - 1; i >= 0; i--) {
      group.itemKeys[i] = countedKey(texts, `${group.items[i].kind ?? ''}|${group.items[i].text ?? ''}`);
    }
  }
  return groups;
}

// Memoised: the feed model keeps its identity until the log changes.
export const ActivityFeed = React.memo(function ActivityFeed({ entries = [] }) {
  return (
    <section className="fi-activity" aria-labelledby="chronicle-activity-title">
      <div className="kicker">
        <h2 className="kicker__title" id="chronicle-activity-title">Activity</h2>
        <span className="kicker__aside">Newest first</span>
      </div>
      {!entries.length
        ? <p className="fi-activity-empty">Match results and player transfers will appear here.</p>
        : (
          <ol className="fi-activity-list" aria-label="Campaign activity">
            {groupByRound(entries).map(group => (
              <li key={group.key} className="fi-activity-group">
                <h3 className="fi-activity-round">{group.roman ? `Round ${group.roman}` : 'Before the first match'}</h3>
                <ul>
                  {group.items.map((item, i) => (
                    <li key={group.itemKeys[i]} className="fi-activity-item" data-kind={item.kind || undefined}>
                      <i className="fi-activity-mark" aria-hidden="true" />
                      <span className="fi-activity-text">{item.text}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
    </section>
  );
});
