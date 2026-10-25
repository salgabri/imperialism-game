// Owner: WP-LEDGER (see PLAN.md §4). Ledger right column: share of the map and the fallen empires.
// The fallen list never uses .fi-standings classes (smoke reads exactly one standings table).
import React from 'react';
import TeamMark from '../../components/TeamMark.jsx';
import { empireFill, themedPaint } from '../../theme.js';

export function MapShare({ share }) {
  const rows = share?.rows || [];
  if (!rows.length) return null;
  const others = share.others;
  return (
    <section className="ledger-share" aria-labelledby="ledger-share-title">
      <div className="kicker">
        <h2 className="kicker__title" id="ledger-share-title">Share of the map</h2>
        <span className="kicker__aside">{share.total} {share.total === 1 ? 'territory' : 'territories'}</span>
      </div>
      <div className="ledger-share__bar" aria-hidden="true">
        {rows.map(row => (
          <i key={row.key} className={row.you ? 'is-you' : undefined}
            style={{ width: `${row.width}%`, background: themedPaint(row.fill || empireFill(row.teamId)) }} />
        ))}
        {others && <i className="is-others" style={{ width: `${others.width}%` }} />}
      </div>
      <ol className="ledger-share__list">
        {rows.map(row => (
          <li key={row.key} className={row.you ? 'is-you' : undefined}>
            <i className="ledger-share__swatch" aria-hidden="true" style={{ background: themedPaint(row.fill || empireFill(row.teamId)) }} />
            <span className="ledger-share__name">{row.name}</span>
            <span className="ledger-share__count">{row.territories}</span>
            <b className="ledger-share__pct">{row.pct}</b>
          </li>
        ))}
        {others && (
          <li className="is-others">
            <i className="ledger-share__swatch" aria-hidden="true" />
            <span className="ledger-share__name">{others.count} other {others.count === 1 ? 'empire' : 'empires'}</span>
            <span className="ledger-share__count">{others.territories}</span>
            <b className="ledger-share__pct">{others.pct}</b>
          </li>
        )}
      </ol>
    </section>
  );
}

export function FallenList({ fallen = [], aside = '', onSelectTeam }) {
  return (
    <section className="ledger-fallen" aria-labelledby="ledger-fallen-title">
      <div className="kicker">
        <h2 className="kicker__title" id="ledger-fallen-title">Fallen empires</h2>
        {aside && <span className="kicker__aside">{aside}</span>}
      </div>
      {fallen.length ? (
        <ol className="ledger-fallen__list">
          {fallen.map(entry => (
            <li key={entry.key} className="ledger-fallen__row">
              <button type="button" className="ledger-fallen__team" data-team-id={entry.teamId}
                onClick={() => onSelectTeam?.(entry.teamId)}>
                <span className="ledger-fallen__mark" aria-hidden="true"><TeamMark id={entry.flagId} teamId={entry.teamId} code={entry.code} isClub={entry.isClub} width={24} /></span>
                <span className="ledger-fallen__text">
                  <span className="ledger-fallen__name">{entry.name}</span>
                  {entry.line && <span className="ledger-fallen__line">{entry.line}</span>}
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : <p className="ledger-empty">No empire has fallen yet.</p>}
    </section>
  );
}
