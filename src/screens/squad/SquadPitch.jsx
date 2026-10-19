// Owner: WP-SQUAD (see PLAN.md §4). Formation pitch (C§7, board C1) and the basketball half court (C§17, DEC misc).
import React from 'react';

/**
 * `slots`: [{ key, x: '50%', y: '88%', name, fullName, rating, claimed }] positioned in % of the box.
 * `layout`: 'pitch' | 'court'. `size`: 'side' (430×330, wide 500×384) | 'large' (Pitch tab) | 'phone'.
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
