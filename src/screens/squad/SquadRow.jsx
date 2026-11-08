// Owner: WP-SQUAD (see PLAN.md §4). One row of the desktop/tablet squad table (C§5.4, board C1) and its header row.
// Compact pass (docs/design/compact-pass.md): position, player, rating, where a claim came from. The natural positions and
// the rating's source are the row's title, and the player's name links to the source when there is a page to link to.
import React from 'react';
import SquadFlag from './SquadFlag.jsx';

/** Column headers (C§5.2), verbatim source case; CSS uppercases them. `hidden`: screen-reader only (the depth table). */
export function SquadTableHead({ hidden = false }) {
  return (
    <div className={`squad-table__head${hidden ? ' sr-only' : ''}`} role="row">
      <span role="columnheader">Pos</span>
      <span role="columnheader">Player</span>
      <span role="columnheader" className="is-center">Rtg</span>
      <span role="columnheader">Acquired</span>
    </div>
  );
}

/** The name, linked to the player's sofifa / FM page when there is one. */
function PlayerName({ row }) {
  const name = row.fullName || row.name;
  return row.sourceUrl
    ? <a className="squad-row__label squad-row__src-link" href={row.sourceUrl} target="_blank" rel="noopener noreferrer"
      title={name} aria-label={`${row.source}: view ${name} (opens in a new tab)`}>{row.name}</a>
    : <span className="squad-row__label" title={name}>{row.name}</span>;
}

/**
 * Row: { pos, name, fullName, natural, inRole, outOfPosition, rating, tier, acquired, source, sourceTitle, sourceUrl, generated, estimated }.
 * A starter out of position shows the rating in role beside the natural one (↓).
 */
export default function SquadRow({ row }) {
  const acquired = row.acquired;
  const title = [row.natural && `Natural ${row.natural}`, row.sourceTitle || (row.source !== '—' ? row.source : null)].filter(Boolean).join(' · ');
  return (
    <div className={`squad-row${row.outOfPosition ? ' is-out-of-position' : ''}${acquired ? ' is-claimed' : ''}`} role="row" title={title || undefined}>
      <span className="squad-row__pos" role="cell">{row.pos}</span>
      <span className="squad-row__name" role="cell">
        <PlayerName row={row} />
        {row.generated && <span className="squad-tag">Generated</span>}
        {row.estimated && <span className="squad-tag" title={row.sourceTitle}>Estimated</span>}
      </span>
      <span className="squad-row__rtg" role="cell">
        {row.outOfPosition && <span className="squad-row__role" title={`Out of position · natural ${row.natural}`}>
          {row.inRole}<span className="squad-row__oop" aria-hidden="true"> ↓</span><span className="sr-only"> out of position</span>
        </span>}
        <span className="rating-box" data-tier={row.tier}>{row.rating}</span>
      </span>
      <span className="squad-row__acq" role="cell">
        {acquired && <>
          <SquadFlag flagId={acquired.flagId} teamId={acquired.teamId} isClub={acquired.isClub} width={16} height={12} />
          <span className="squad-row__acq-label">{acquired.label}</span>
        </>}
      </span>
    </div>
  );
}
