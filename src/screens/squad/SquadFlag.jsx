// Owner: WP-SQUAD (see PLAN.md §4). A former team's flag in the squad tables (C§0): a 4:3 flag-bg block with the
// README flag ring, the nation's flag on top when it has one; clubs (flagId null) keep the plain block.
import React from 'react';
import Flag from '../../components/Flag.jsx';

export default function SquadFlag({ flagId = null, isClub = false, width = 16, height = Math.round(width * 0.75), className = '' }) {
  return (
    <span className={`squad-flag${className ? ` ${className}` : ''}`} style={{ width, height }} aria-hidden="true">
      {!isClub && flagId != null && <Flag nationId={flagId} width={width} height={height} className="squad-flag__img" />}
    </span>
  );
}
