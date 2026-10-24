// Owner: WP-LEDGER (see PLAN.md §4). Screen header shared by Ledger and Chronicle: the v4 squad header pattern
// (C1 §3: kicker + 54px title on the left, big stats on the right, 1px ink rule below).
import React from 'react';

export default function LedgerHead({ titleId, kicker, title, stats = [] }) {
  return (
    <header className="ledger-head">
      <div className="ledger-head__title">
        {kicker && <p className="ledger-head__kicker">{kicker}</p>}
        <h1 className="ledger-head__name" id={titleId}>{title}</h1>
      </div>
      {stats.length > 0 && (
        <dl className="ledger-head__stats">
          {stats.map(stat => (
            <div key={stat.key} className="ledger-head__stat" data-stat={stat.key}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}{stat.sub ? <small> {stat.sub}</small> : null}</dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}
