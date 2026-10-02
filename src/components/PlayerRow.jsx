import React from 'react';
import { C, ratingColor } from '../theme.js';
import './results.css';

/** Claimed players retain their former team, keeping the campaign's story readable. */
export default function PlayerRow({ player, positionColors = {}, roomy = false, role }) {
  const posColor = positionColors[player.pos] || C.textSoft;
  const ratingTier = player.rating >= 85 ? 'elite' : player.rating >= 75 ? 'solid' : 'base';
  return (
    <div className={`fi-player-row${roomy ? ' is-roomy' : ''}${player.from ? ' is-acquired' : ''}${role ? ` is-${role}` : ''}`}>
      <span className="fi-player-position" title={player.assignedPos && player.assignedPos !== player.pos ? `Natural position ${player.pos}; playing ${player.assignedPos}` : undefined} style={{ color: `var(--result-position-${player.pos}, var(--result-muted, ${posColor}))` }}>{player.assignedPos || player.pos}</span>
      <span className={`fi-player-identity${player.gen ? ' is-generated' : ''}`} title={player.gen ? 'Generated player — roster data unavailable' : undefined}>
        <span>{player.name}{player.gen && <sup>*</sup>}</span>
        {player.from && <small className="fi-player-origin" title={`Acquired from ${player.from}`}>From {player.from}</small>}
        {(player.outOfPosition || player.assignedPos && player.assignedPos !== player.pos) && <small className="fi-out-of-position">Natural {player.pos} · out of position</small>}
      </span>
      <strong className="fi-player-rating" title={Number.isFinite(player.effectiveRating) && player.effectiveRating !== player.rating ? `Base rating ${player.rating}; lineup rating ${player.effectiveRating.toFixed(1)}` : undefined} style={{ color: `var(--result-rating-${ratingTier}, ${ratingColor(player.rating)})` }}>{Number.isFinite(player.effectiveRating) ? Number(player.effectiveRating.toFixed(1)) : player.rating}</strong>
    </div>
  );
}
