// Owner: WP-SQUAD (see PLAN.md §4). One phone squad row (C§10.3, board C2), a single line.
import React from 'react';

/** Outlined position box · name, then what is out of the ordinary (generated, estimated, out of position, claimed) · tier-coloured rating. */
export default function SquadPhoneRow({ row }) {
  const acquired = row.acquired;
  const notes = [row.generated && 'Generated', row.estimated && 'Estimated', row.outOfPosition && 'out of position',
    acquired && `from ${acquired.code}${acquired.roman ? ` ${acquired.roman}` : ''}`].filter(Boolean).join(' · ');
  return (
    <li className={`squad-prow${acquired ? ' is-claimed' : ''}`} title={row.natural ? `Natural ${row.natural}` : undefined}>
      <span className="squad-prow__pos">{row.pos}</span>
      <span className="squad-prow__body">
        <span className="squad-prow__name">{row.name}</span>
        {notes && <span className={`squad-prow__meta${acquired ? ' squad-prow__from' : row.outOfPosition ? ' squad-prow__oop' : ''}`}>{notes}</span>}
      </span>
      <span className="squad-prow__rating squad-tier" data-tier={row.tier}>{row.rating}</span>
    </li>
  );
}
