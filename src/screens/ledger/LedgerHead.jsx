// Owner: WP-LEDGER (see PLAN.md §4). Screen header shared by Ledger and Chronicle: one line, the theatre and the figures.
// The masthead's nav names the screen, so its title is for screen readers.
import React from 'react';

export default function LedgerHead({ titleId, kicker, title, stats = [] }) {
  return (
    <header className="ledger-head">
      <h1 className="ledger-head__name sr-only" id={titleId}>{title}</h1>
      {kicker && <p className="ledger-head__kicker">{kicker}</p>}
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
