// Owner: WP-SQUAD (see PLAN.md §4). A former team's flag in the squad tables (C§0): a 4:3 flag-bg block with the
// README flag ring, the nation's flag on top when it has one; a club shows its crest, on no block, or keeps the
// plain block when it has no crest.
import React from 'react';
import Flag from '../../components/Flag.jsx';
import { crestUrl } from '../../data/crests.js';
import { useSeasonYear } from '../../components/seasonYear.js';

export default function SquadFlag({ flagId = null, teamId = null, isClub = false, width = 16, height = Math.round(width * 0.75), className = '' }) {
  // A club wears the crest of the season on screen (src/data/crests.js).
  const year = useSeasonYear();
  const logo = isClub ? crestUrl(teamId, year) : null;
  return (
    <span className={`squad-flag${logo ? ' squad-flag--logo' : ''}${className ? ` ${className}` : ''}`} style={{ width, height }} aria-hidden="true">
      {!isClub && flagId != null && <Flag nationId={flagId} width={width} height={height} className="squad-flag__img" />}
      {logo && <img src={logo} alt="" width={width} height={height} loading="lazy" decoding="async" className="squad-flag__img" />}
    </span>
  );
}
