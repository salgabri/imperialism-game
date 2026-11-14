// Owner: WP-SQUAD (see PLAN.md §4). Formation pitch (C§7, board C1), the basketball half court (C§17, DEC misc), the
// American football field, the baseball diamond, the hockey rink, the tennis court, the rugby league field and the Rocket
// League arena.
import React from 'react';
import { ESTIMATE_TITLE } from '../../data/estimates.js';

/**
 * `slots`: [{ key, x: '50%', y: '88%', name, fullName, rating, claimed, estimated }] positioned in % of the box.
 * `layout`: 'pitch' | 'court' | 'field' | 'diamond' | 'rink' | 'tennis' | 'rugby' | 'arena'. `size`: 'side' (430×330, wide 500×384) | 'large' (Pitch tab) | 'phone'.
 */
export default function SquadPitch({ slots = [], layout = 'pitch', size = 'side', label = 'Formation' }) {
  return (
    <div className={`pitch pitch--${layout} pitch--${size}`} role="group" aria-label={label}>
      {layout === 'court' ? (
        <i className="pitch__outline" aria-hidden="true">
          <i className="pitch__lane" />
          <i className="pitch__ft" />
          <i className="pitch__arc" />
          <i className="pitch__hoop" />
        </i>
      ) : layout === 'field' ? (
        // The offence below the line of scrimmage, the defence above it; yard lines every ten yards.
        <i className="pitch__outline" aria-hidden="true">
          <i className="pitch__yards" />
          <i className="pitch__scrimmage" />
        </i>
      ) : layout === 'diamond' ? (
        // Home plate at the foot, the foul lines and the outfield fence, the infield diamond and the mound. The drawing
        // stretches with the box, as the players' places do.
        <svg className="pitch__diamond" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path d="M50 88L3 36M50 88L97 36M3 36Q50 -12 97 36" />
          <path d="M50 88L68 64L50 40L32 64Z" />
          <ellipse cx="50" cy="63" rx="2.6" ry="3.2" />
        </svg>
      ) : layout === 'tennis' ? (
        // A tennis court from above: the doubles alleys, the service boxes and the net across the middle. The singles
        // players stand in the near half, the doubles pair across the net. The drawing stretches with the box.
        <svg className="pitch__tennis" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <rect x="6" y="3" width="88" height="94" />
          <path d="M17 3V97M83 3V97M17 25.4H83M17 74.6H83M50 25.4V74.6M50 3V5.5M50 97V94.5" />
          <path className="pitch__net" d="M2 50H98" />
        </svg>
      ) : layout === 'rugby' ? (
        // The half the side attacks: the posts and the try line at the top, the 20-metre and 40-metre lines, halfway at
        // the foot of the field, and the interchange bench below it. The drawing stretches with the box.
        <svg className="pitch__rugby" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <rect x="0" y="0" width="100" height="84" />
          <path d="M0 6H100M0 84H100" />
          <path className="pitch__rugby-line" d="M0 26H100M0 54H100" />
          <path d="M45 6V0M55 6V0M45 2.5H55" />
        </svg>
      ) : layout === 'arena' ? (
        // A Rocket League arena from above: its cut corners, a goal at each end, halfway and the centre circle. The
        // drawing stretches with the box.
        <svg className="pitch__arena" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path d="M14 6H86L96 16V84L86 94H14L4 84V16Z" />
          <path d="M37 6V1H63V6M37 94V99H63V94M4 50H96" />
          <ellipse cx="50" cy="50" rx="10" ry="8" />
        </svg>
      ) : layout === 'rink' ? (
        // One end of the rink: the goal line and crease at the foot, the blue line and the centre line and circle
        // above them. The drawing stretches with the box, as the players' places do.
        <svg className="pitch__rink" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <rect x="0" y="0" width="100" height="100" rx="7" ry="7" />
          <path d="M0 92H100M0 56H100M0 3H100" />
          <path d="M44 92A6 6 0 0 1 56 92" />
        </svg>
      ) : <>
        <i className="pitch__outline" aria-hidden="true" />
        <i className="pitch__halfway" aria-hidden="true" />
        <i className="pitch__circle" aria-hidden="true" />
        <i className="pitch__box pitch__box--top" aria-hidden="true" />
        <i className="pitch__box pitch__box--bottom" aria-hidden="true" />
      </>}
      {slots.map(slot => (
        <div key={slot.key} className={`pitch__player${slot.claimed ? ' is-claimed' : ''}${slot.estimated ? ' is-estimated' : ''}`} style={{ left: slot.x, top: slot.y }}
          title={slot.estimated ? `${slot.fullName || slot.name}. ${slot.estimateTitle || ESTIMATE_TITLE}` : slot.fullName || slot.name}>
          <span className="pitch__dot">{slot.rating}</span>
          <span className="pitch__name">{slot.name}</span>
          {slot.estimated && <span className="sr-only"> (estimated rating)</span>}
          {slot.claimed && <span className="sr-only"> (claimed in conquest)</span>}
        </div>
      ))}
    </div>
  );
}
