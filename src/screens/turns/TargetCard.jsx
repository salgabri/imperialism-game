// Owner: WP-TURN (see PLAN.md §4). The map-anchored target card (M§5.5, README "Hover/selection card"): follows the
// hovered in-reach empire, else the selected target. WorldMap places it through `anchors` (map units → px).
import React from 'react';
import './turns.css';

export default function TargetCard({ name = '', line1 = '', winLine = '', tone = 'muted', stakeWin = '', stakeLose = '' }) {
  if (!name) return null;
  return (
    <div className="target-card" data-tone={tone}>
      <strong className="target-card__name">{name}</strong>
      {line1 && <span className="target-card__line">{line1}</span>}
      {winLine && <span className={`target-card__win tone-${tone}`}>{winLine}</span>}
      {(stakeWin || stakeLose) && (
        <span className="target-card__stakes">
          {stakeWin && <span className="target-card__stake tone-gain">{stakeWin}</span>}
          {stakeLose && <span className="target-card__stake tone-loss">{stakeLose}</span>}
        </span>
      )}
    </div>
  );
}
