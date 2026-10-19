// Owner: WP-SQUAD (see PLAN.md §4). "Claimed in conquest": the three most recent claims (C§9, board C1).
import React from 'react';
import SquadFlag from './SquadFlag.jsx';

/** `rows`: [{ key, roman: 'R XII', flagId, isClub, name, fromName, gain: '+0.4', tone }], newest first. */
export default function ClaimedList({ rows = [] }) {
  return (
    <section className="claimed-section" aria-labelledby="squad-claimed-title">
      <h2 className="kicker squad-kicker">
        <span className="kicker__title" id="squad-claimed-title">Claimed in conquest</span>
        <span className="kicker__aside">Gain</span>
      </h2>
      {rows.length ? (
        <ol className="claimed-list">
          {rows.map(row => (
            <li key={row.key} className="claimed-row">
              <span className="claimed-row__round">{row.roman}</span>
              <SquadFlag flagId={row.flagId} isClub={row.isClub} width={18} height={13} />
              <span className="claimed-row__name" title={`${row.name} · ${row.fromName}`}>
                {row.name} <span className="claimed-row__from">· {row.fromName}</span>
              </span>
              <span className={`claimed-row__gain tone-${row.tone}`}>{row.gain}</span>
            </li>
          ))}
        </ol>
      ) : <p className="claimed-empty">No players claimed yet</p>}
    </section>
  );
}
