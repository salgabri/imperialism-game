import React from 'react';
import { C, ratingColor } from '../theme.js';
import './results.css';

/** Claimed players retain their former team, keeping the campaign's story readable. */
export default function PlayerRow({ player, positionColors = {}, roomy = false }) {
  const posColor = positionColors[player.pos] || C.textSoft;
  const ratingTier = player.rating >= 85 ? 'elite' : player.rating >= 75 ? 'solid' : 'base';
  return (
    <div className={`fi-player-row${roomy ? ' is-roomy' : ''}`}>
      <span className="fi-player-position" style={{ color: `var(--result-position-${player.pos}, var(--result-muted, ${posColor}))` }}>{player.pos}</span>
      <span className={`fi-player-identity${player.gen ? ' is-generated' : ''}`} title={player.gen ? 'Generated player — roster data unavailable' : undefined}>
        <span>{player.name}{player.gen && <sup>*</sup>}</span>
        {player.from && <small>From {player.from}</small>}
      </span>
      <strong className="fi-player-rating" style={{ color: `var(--result-rating-${ratingTier}, ${ratingColor(player.rating)})` }}>{player.rating}</strong>
    </div>
  );
}
