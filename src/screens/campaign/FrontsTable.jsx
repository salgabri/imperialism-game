// Owner: WP-COL (see PLAN.md §4). "Your fronts" table (A§6): flag · Nation · Str · Terr · Win (DEC D4, D5); the
// clubs layer heads the first column "Club" (buildFronts nameHeading).
import React from 'react';
import TeamMark from '../../components/TeamMark.jsx';

/**
 * Rows come from buildFronts (≤ 5; CSS keeps 4 below 1600px). Clicking a nation or club opens its squad. Renders
 * nothing for spectators (no model) and an empty note when the managed empire has no rival in reach.
 */
export default function FrontsTable({ fronts = null, onSelectTeam }) {
  if (!fronts) return null;
  const rows = Array.isArray(fronts.rows) ? fronts.rows : [];
  const select = typeof onSelectTeam === 'function' ? onSelectTeam : null;
  return (
    <section className="fronts" aria-labelledby="fronts-kicker">
      <div className="kicker">
        <h2 className="kicker__title v4-column__heading" id="fronts-kicker">Your fronts</h2>
        <span className="kicker__aside">Win chance</span>
      </div>
      {rows.length ? <table className="fronts__table">
        <colgroup>
          <col />
          <col className="fronts__col-str" />
          <col className="fronts__col-terr" />
          <col className="fronts__col-win" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="fronts__th fronts__th--nation">{fronts.nameHeading === 'Club' ? 'Club' : 'Nation'}</th>
            <th scope="col" className="fronts__th"><abbr title="Strength">Str</abbr></th>
            <th scope="col" className="fronts__th"><abbr title="Territories">Terr</abbr></th>
            <th scope="col" className="fronts__th"><abbr title="Win chance">Win</abbr></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.teamId} className="fronts__row" data-team-id={row.teamId}>
              <td className="fronts__cell fronts__cell--nation">
                <span className="fronts__nation">
                  <span className="fronts__flag" aria-hidden="true">
                    <TeamMark id={row.flagId} teamId={row.teamId} code={row.code} color={row.color} isClub={row.isClub} width={24} height={18} />
                  </span>
                  {select
                    ? <button type="button" className="fronts__name fronts__name--button" aria-label={`View ${row.name} squad`}
                      onClick={() => select(row.teamId)}>{row.name}</button>
                    : <span className="fronts__name">{row.name}</span>}
                </span>
              </td>
              <td className="fronts__cell fronts__num">{row.eff}</td>
              <td className="fronts__cell fronts__num fronts__terr">{row.terr}</td>
              <td className={`fronts__cell fronts__num fronts__win tone-${row.tone || 'muted'}`}>{row.win}</td>
            </tr>
          ))}
        </tbody>
      </table> : <p className="fronts__empty">{fronts.empty || 'No rival is within reach.'}</p>}
      {fronts.note ? <p className="fronts__note">{fronts.note}</p> : null}
    </section>
  );
}
