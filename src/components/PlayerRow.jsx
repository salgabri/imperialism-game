import React from 'react';
import { C, ratingColor } from '../theme.js';
import './results.css';

/** Claimed players retain their former team, keeping the campaign's story readable. */
export default function PlayerRow({ player, positionColors = {}, roomy = false, role }) {
  const posColor = positionColors[player.pos] || C.textSoft;
  const ratingTier = player.rating >= 85 ? 'elite' : player.rating >= 75 ? 'solid' : 'base';
  const naturalPositions = player.positions?.length ? player.positions.join('/') : player.pos;
  const outOfPosition = player.outOfPosition ?? (player.assignedPos && player.assignedPos !== player.pos && !player.positions?.includes(player.assignedPos));
  const source = player.sourceInfo;
  const sourceName = source?.source === 'ea-fc' ? 'EA FC' : 'Football Manager';
  const edition = String(source?.edition || '');
  const sourceLabel = edition ? /^\d+$/.test(edition) ? `${sourceName} ${edition}` : edition : sourceName;
  const sourceTitle = source ? [sourceLabel, source.version && `Database ${source.version}`, source.snapshotDate && `Database snapshot ${source.snapshotDate}`,
    Number.isFinite(source.rawRating) && `Source rating ${source.rawRating}${Number.isFinite(source.rawScale) ? `/${source.rawScale}` : source.rawScale ? ` (${source.rawScale} scale)` : ''}`,
    source.conversion && `Game rating converted from Football Manager current ability: ${source.conversion}`].filter(Boolean).join(' · ') : '';
  const ratingTitle = [Number.isFinite(player.effectiveRating) && player.effectiveRating !== player.rating
    ? `Base rating ${player.rating}; lineup rating ${player.effectiveRating.toFixed(1)}` : null, sourceTitle].filter(Boolean).join(' · ');
  return (
    <div className={`fi-player-row${roomy ? ' is-roomy' : ''}${player.from ? ' is-acquired' : ''}${role ? ` is-${role}` : ''}`}>
      <span className="fi-player-position" title={player.assignedPos && player.assignedPos !== player.pos ? `Natural positions ${naturalPositions}; playing ${player.assignedPos}` : undefined} style={{ color: `var(--result-position-${player.pos}, var(--result-muted, ${posColor}))` }}>{player.assignedPos || player.pos}</span>
      <span className={`fi-player-identity${player.gen ? ' is-generated' : ''}`} title={player.gen ? 'Generated player — roster data unavailable' : undefined}>
        <span title={source?.fullName || undefined}>{player.name}{player.gen && <sup>*</sup>}</span>
        {source && <small className="fi-player-source" title={sourceTitle}>{/^https?:\/\//.test(source.url || '')
          ? <a href={source.url} target="_blank" rel="noopener noreferrer" aria-label={`View ${source.fullName || player.name} in ${sourceLabel}`}>{sourceLabel}</a>
          : sourceLabel}</small>}
        {player.from && <small className="fi-player-origin" title={`Acquired from ${player.from}`}>From {player.from}</small>}
        {outOfPosition && <small className="fi-out-of-position">Natural {naturalPositions} · out of position</small>}
      </span>
      <strong className="fi-player-rating" title={ratingTitle || undefined} style={{ color: `var(--result-rating-${ratingTier}, ${ratingColor(player.rating)})` }}>{Number.isFinite(player.effectiveRating) ? Number(player.effectiveRating.toFixed(1)) : player.rating}</strong>
    </div>
  );
}
