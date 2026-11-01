// Owner: WP-SQUAD (see PLAN.md §4). Formation pitch (C§7, board C1), the basketball half court (C§17, DEC misc), the
// American football field and the baseball diamond.
import React from 'react';

/**
 * `slots`: [{ key, x: '50%', y: '88%', name, fullName, rating, claimed }] positioned in % of the box.
 * `layout`: 'pitch' | 'court' | 'field' | 'diamond'. `size`: 'side' (430×330, wide 500×384) | 'large' (Pitch tab) | 'phone'.
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
      ) : <>
        <i className="pitch__outline" aria-hidden="true" />
        <i className="pitch__halfway" aria-hidden="true" />
        <i className="pitch__circle" aria-hidden="true" />
        <i className="pitch__box pitch__box--top" aria-hidden="true" />
        <i className="pitch__box pitch__box--bottom" aria-hidden="true" />
      </>}
      {slots.map(slot => (
        <div key={slot.key} className={`pitch__player${slot.claimed ? ' is-claimed' : ''}`} style={{ left: slot.x, top: slot.y }}
          title={slot.fullName || slot.name}>
          <span className="pitch__dot">{slot.rating}</span>
          <span className="pitch__name">{slot.name}</span>
          {slot.claimed && <span className="sr-only"> (claimed in conquest)</span>}
        </div>
      ))}
    </div>
  );
}
