// Owner: WP-0 (see PLAN.md §4). Final in W1, frozen in W2 (PLAN §3.5).
import React from 'react';
import Flag from './Flag.jsx';

/**
 * A team's mark: the nation's flag, or a club monogram chip. Its root never carries a `title`
 * (smoke reads `.fi-standing-team > span[title]` as the team name). Monogram size travels in custom
 * properties so a container (e.g. the masthead) can resize it with CSS.
 */
export default function TeamMark({ id, code, color, isClub, width = 48, height }) {
  const markHeight = height ?? Math.round(width * 0.75);
  if (isClub) {
    return (
      <span className="fi-team-monogram" aria-hidden="true"
        style={{ '--team-color': color, '--mark-w': `${width}px`, '--mark-h': `${markHeight}px` }}>
        {code}
      </span>
    );
  }
  return <Flag nationId={id} width={width} height={markHeight} />;
}
