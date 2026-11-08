// Owner: WP-SQUAD (see PLAN.md §4). Acquisitions tab: every claimed player, newest first (C§12 proposal, A-4), paged to
// what fits.
import React from 'react';
import SquadFlag from './SquadFlag.jsx';
import Pager from '../../components/Pager.jsx';
import { usePagedList } from '../../hooks/useFit.js';

/** `acquisitions`: { rows: [claim], aside, empty }; claim = { key, roman, flagId, isClub, name, pos, rating, tier, fromName, gain, tone, status, detail }. */
export default function SquadAcquisitions({ acquisitions }) {
  const rows = acquisitions?.rows || [];
  const paged = usePagedList(rows, { row: '.squad-acq__row' });
  return (
    <section className="squad-acq" aria-labelledby="squad-acq-title">
      <h2 className="kicker squad-kicker">
        <span className="kicker__title" id="squad-acq-title">Claimed in conquest</span>
        <Pager page={paged.page} pages={paged.pages} onPage={paged.setPage} label="Acquisitions pages" />
        {acquisitions?.aside && <span className="kicker__aside">{acquisitions.aside}</span>}
      </h2>
      {rows.length ? (
        <div className="squad-acq__table" role="table" aria-labelledby="squad-acq-title" ref={paged.boxRef}>
          <div className="squad-acq__head" role="row">
            <span role="columnheader">Round</span>
            <span role="columnheader"><span className="sr-only">Former team flag</span></span>
            <span role="columnheader">Player</span>
            <span role="columnheader">Pos</span>
            <span role="columnheader" className="is-center">Rtg</span>
            <span role="columnheader">From</span>
            <span role="columnheader" className="is-end">Gain</span>
            <span role="columnheader">Status</span>
          </div>
          {paged.shown.map(row => (
            <div key={row.key} className="squad-acq__row" role="row" title={row.detail || undefined}>
              <span className="squad-acq__round" role="cell">{row.roman}</span>
              <span role="cell"><SquadFlag flagId={row.flagId} teamId={row.teamId} isClub={row.isClub} width={18} height={13} /></span>
              <span className="squad-acq__player" role="cell">
                <span className="squad-acq__name" title={row.name}>{row.name}</span>
              </span>
              <span className="squad-acq__pos" role="cell">{row.pos}</span>
              <span className="squad-acq__rtg" role="cell"><span className="rating-box" data-tier={row.tier}>{row.rating}</span></span>
              <span className="squad-acq__from" role="cell">{row.fromName}</span>
              <span className={`squad-acq__gain tone-${row.tone}`} role="cell">{row.gain}</span>
              <span className={`squad-acq__status${row.status === 'Starter' ? ' is-starter' : ''}`} role="cell">{row.status}</span>
            </div>
          ))}
        </div>
      ) : <p className="squad-empty">{acquisitions?.empty}</p>}
    </section>
  );
}
