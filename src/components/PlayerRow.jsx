import React from 'react';
import { C, FONT, POS_COLORS, ratingColor } from '../theme.js';

/**
 * One squad member. `from` is set on players taken as spoils of a conquest, which
 * is the whole story of a champion's final XI.
 */
export default function PlayerRow({ player, roomy = false }) {
  const posColor = POS_COLORS[player.pos] || C.textSoft;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: roomy ? '8px 14px' : '7px 12px',
        borderBottom: `1px solid ${C.lineSoft}`,
      }}
    >
      <span
        style={{
          minWidth: 26,
          textAlign: 'center',
          padding: '2px 0',
          borderRadius: 2,
          border: `1px solid ${posColor}`,
          color: posColor,
          fontFamily: FONT.mono,
          fontSize: 8.5,
          fontWeight: 600,
        }}
      >
        {player.pos}
      </span>
      <span
        // Generated players are dimmed and asterisked: the dataset has no entry
        // for this nation's shirt, so the name is invented and should not read
        // as a real footballer.
        title={player.gen ? 'Generated — no player in the dataset for this shirt' : undefined}
        style={{
          flex: 1,
          fontSize: roomy ? 15 : 14,
          fontWeight: 600,
          color: player.gen ? C.textFaint : C.textList,
          fontStyle: player.gen ? 'italic' : undefined,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {player.name}
        {player.gen && <span style={{ color: C.textFaded }}>*</span>}
      </span>
      {player.from && (
        <span
          style={{
            fontFamily: FONT.mono,
            fontSize: 8,
            color: C.cyan,
            border: `1px solid ${C.cyanEdge}`,
            borderRadius: 2,
            padding: '2px 5px',
            letterSpacing: 0.5,
          }}
        >
          EX {player.from}
        </span>
      )}
      <span
        style={{
          fontFamily: FONT.mono,
          fontSize: 13,
          fontWeight: 700,
          color: ratingColor(player.rating),
          minWidth: roomy ? undefined : 26,
          textAlign: 'right',
        }}
      >
        {player.rating}
      </span>
    </div>
  );
}
