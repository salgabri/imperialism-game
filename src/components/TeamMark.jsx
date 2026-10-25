// Owner: WP-0 (see PLAN.md §4). Final in W1, frozen in W2 (PLAN §3.5).
import React from 'react';
import Flag from './Flag.jsx';
import { clubLogoUrl } from '../data/clubLogos.js';

/**
 * A team's mark: the nation's flag, or a club's crest, or a club monogram chip when the club has no crest. A club is
 * found by `teamId` (or `id`, which a club only carries where its team id stands in for the flag id). Its root never
 * carries a `title` (smoke reads `.fi-standing-team > span[title]` as the team name). Mark size travels in custom
 * properties so a container (e.g. the masthead) can resize it with CSS; a crest sits in the monogram's box, so every
 * container that sizes a monogram sizes a crest too.
 */
export default function TeamMark({ id, teamId, code, color, isClub, width = 48, height }) {
  const markHeight = height ?? Math.round(width * 0.75);
  if (isClub) {
    const logo = clubLogoUrl(teamId ?? id);
    const size = { '--team-color': color, '--mark-w': `${width}px`, '--mark-h': `${markHeight}px` };
    if (logo) {
      return (
        <span className="fi-team-monogram fi-team-monogram--logo" aria-hidden="true" style={size}>
          <img src={logo} alt="" width={width} height={markHeight} loading="lazy" decoding="async" />
        </span>
      );
    }
    return <span className="fi-team-monogram" aria-hidden="true" style={size}>{code}</span>;
  }
  return <Flag nationId={id} width={width} height={markHeight} />;
}
