// Owner: WP-SQUAD (see PLAN.md §4). One 50px phone squad row (C§10.3, board C2).
import React from 'react';

/** 32px outlined position box · name over natural positions (+ " · from CRO R XX" in claimed) · tier-coloured rating. */
export default function SquadPhoneRow({ row }) {
  const acquired = row.acquired;
  return (
    <li className={`squad-prow${acquired ? ' is-claimed' : ''}`}>
      <span className="squad-prow__pos">{row.pos}</span>
      <span className="squad-prow__body">
        <span className="squad-prow__name">{row.name}</span>
        <span className="squad-prow__meta">
          {row.natural}
          {row.generated && <span className="squad-prow__gen"> · Generated</span>}
          {row.outOfPosition && <span className="squad-prow__oop"> · out of position</span>}
          {acquired && <span className="squad-prow__from"> · from {acquired.code}{acquired.roman ? ` ${acquired.roman}` : ''}</span>}
        </span>
      </span>
      <span className="squad-prow__rating squad-tier" data-tier={row.tier}>{row.rating}</span>
    </li>
  );
}
