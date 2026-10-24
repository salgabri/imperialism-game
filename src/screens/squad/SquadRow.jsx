// Owner: WP-SQUAD (see PLAN.md §4). One row of the desktop/tablet squad table (C§5.4, board C1) and its header row.
import React from 'react';
import SquadFlag from './SquadFlag.jsx';

/** Column headers (C§5.2), verbatim source case; CSS uppercases them. `hidden`: screen-reader only (the depth table). */
export function SquadTableHead({ showSource = true, hidden = false }) {
  return (
    <div className={`squad-table__head${hidden ? ' sr-only' : ''}`} role="row">
      <span role="columnheader">No</span>
      <span role="columnheader">Pos</span>
      <span role="columnheader">Player</span>
      <span role="columnheader">Natural</span>
      <span role="columnheader" className="is-center">In role</span>
      <span role="columnheader" className="is-center">Rtg</span>
      <span role="columnheader">Acquired</span>
      {showSource && <span role="columnheader">Source</span>}
    </div>
  );
}

/** The Source cell: the edition, linked to the player's sofifa / FM page when there is one, with the database evidence as its title. */
function SourceCell({ row }) {
  const label = row.source;
  return (
    <span className="squad-row__src" role="cell" title={row.sourceTitle || undefined}>
      {row.sourceUrl
        ? <a className="squad-row__src-link" href={row.sourceUrl} target="_blank" rel="noopener noreferrer"
          aria-label={`${label}: view ${row.fullName || row.name} (opens in a new tab)`}>{label}</a>
        : label}
    </span>
  );
}

/**
 * Row: { no, pos, name, fullName, natural, inRole, outOfPosition, rating, tier, acquired, source, sourceTitle, sourceUrl, generated }.
 * Starters show the effective rating in role (↓ when out of position); depth rows show "—".
 */
export default function SquadRow({ row, showSource = true }) {
  const acquired = row.acquired;
  return (
    <div className={`squad-row${row.outOfPosition ? ' is-out-of-position' : ''}${acquired ? ' is-claimed' : ''}`} role="row">
      <span className="squad-row__no" role="cell">{row.no}</span>
      <span className="squad-row__pos" role="cell">{row.pos}</span>
      <span className="squad-row__name" role="cell">
        <span className="squad-row__label" title={row.fullName || row.name}>{row.name}</span>
        {row.generated && <span className="squad-tag">Generated</span>}
      </span>
      <span className="squad-row__natural" role="cell">{row.natural}</span>
      <span className="squad-row__role" role="cell" title={row.outOfPosition ? `Out of position · natural ${row.natural}` : undefined}>
        {row.inRole}
        {row.outOfPosition && <><span className="squad-row__oop" aria-hidden="true"> ↓</span><span className="sr-only"> out of position</span></>}
      </span>
      <span className="squad-row__rtg" role="cell"><span className="rating-box" data-tier={row.tier}>{row.rating}</span></span>
      <span className="squad-row__acq" role="cell">
        {acquired && <>
          <SquadFlag flagId={acquired.flagId} isClub={acquired.isClub} width={16} height={12} />
          <span className="squad-row__acq-label">{acquired.label}</span>
        </>}
      </span>
      {showSource && <SourceCell row={row} />}
    </div>
  );
}
