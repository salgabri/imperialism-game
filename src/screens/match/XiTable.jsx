// Owner: WP-MATCH (see PLAN.md §4). One starting lineup (B§1.5.3): pos · name + claimed tag · rating in tier colour.
// The claimed tag sits in the player cell so it hugs the rating on every row (B1's per-row `auto` track).
import React from 'react';
import TeamMark from '../../components/TeamMark.jsx';

export default function XiTable({ title = '', teamId = null, rows = [], onSelectTeam }) {
  const titleId = `match-xi-${String(teamId ?? title).replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const canOpen = !!onSelectTeam && teamId != null;
  return (
    <section className="match-xi" aria-labelledby={titleId}>
      <div className="kicker match-xi__kicker">
        <h3 className="kicker__title match-xi__title">
          {canOpen ? (
            // Visible text first in the name (WCAG 2.5.3); the section is named by the title span alone.
            // The 44px touch target is the button's ::after (match.css); the label keeps the kicker's line box.
            <button type="button" className="match-xi__title-button" onClick={() => onSelectTeam(teamId)}>
              <span className="match-xi__title-text" id={titleId}>{title}</span><span className="sr-only">, view squad</span>
            </button>
          ) : <span className="match-xi__title-text" id={titleId}>{title}</span>}
        </h3>
        <span className="kicker__aside match-xi__aside" aria-hidden="true">Rtg</span>
      </div>
      <table className="match-xi__table">
        <colgroup>
          <col className="match-xi__col-pos" /><col className="match-xi__col-name" /><col className="match-xi__col-rating" />
        </colgroup>
        <thead className="match-xi__head">
          <tr><th scope="col">Position</th><th scope="col">Player</th><th scope="col">Rating</th></tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.key} className="match-xi__row">
              <td className="match-xi__pos">{row.pos}</td>
              <td className="match-xi__name">
                <span className="match-xi__player">
                  <span className="match-xi__player-name" title={row.name}>{row.name}</span>
                  <span className="match-xi__claimed">
                    {row.claimed && (
                      <span className="match-xi__tag" title={row.claimed.label}>
                        <TeamMark id={row.claimed.flagId} code={row.claimed.code} color={row.claimed.color}
                          isClub={row.claimed.isClub} width={14} height={10} />
                        <span className="match-xi__tag-text" aria-hidden="true">{row.claimed.roman || row.claimed.code}</span>
                        <span className="sr-only">{`, ${row.claimed.label}`}</span>
                      </span>
                    )}
                  </span>
                </span>
              </td>
              <td className="match-xi__rating" data-tier={row.tier}>{row.rating}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
