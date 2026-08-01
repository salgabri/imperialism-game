import React from 'react';
import { C, FONT, pad3 } from '../theme.js';

const stat = { fontFamily: FONT.mono, fontSize: 10, color: C.textSoft };
const segBase = {
  fontFamily: FONT.mono,
  fontSize: 9,
  letterSpacing: 1,
  padding: '6px 10px',
  border: 'none',
  cursor: 'pointer',
};
const btn = {
  fontFamily: FONT.mono,
  fontSize: 9,
  letterSpacing: 1,
  padding: '6px 10px',
  border: `1px solid ${C.lineCtl}`,
  borderRadius: 3,
  background: 'transparent',
  color: C.text,
  cursor: 'pointer',
};

function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', border: `1px solid ${C.lineCtl}`, borderRadius: 3, overflow: 'hidden' }}>
      {options.map(([id, label], i) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          style={{
            ...segBase,
            borderLeft: i ? `1px solid ${C.lineCtl}` : 'none',
            color: value === id ? C.ink : C.textSoft,
            background: value === id ? C.gold : 'transparent',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function CommandBar({
  show,
  scopeName,
  round,
  alive,
  fallen,
  warStage,
  warPulsing,
  pacing,
  resolution,
  speed,
  autoplay,
  confirmNew,
  onPacing,
  onResolution,
  onSpeed,
  onStep,
  onPlay,
  onNew,
}) {
  return (
    <div
      style={{
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '0 16px',
        height: 54,
        borderBottom: `1px solid ${C.line}`,
        background: C.panel,
        flexWrap: 'wrap',
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <svg width="20" height="20" viewBox="0 0 20 20" style={{ flex: 'none' }}>
          <circle cx="10" cy="10" r="8.6" fill="none" stroke={C.gold} strokeWidth="1.4" />
          <path d="M10,4.6 L15.4,10 L10,15.4 L4.6,10 Z" fill={C.gold} />
          <circle cx="10" cy="10" r="2" fill={C.ink} />
        </svg>
        <span
          style={{
            fontFamily: FONT.head,
            fontWeight: 800,
            fontSize: 19,
            letterSpacing: 2,
            color: C.textHi,
          }}
        >
          FOOTBALL IMPERIALISM
        </span>
        <span
          style={{
            fontFamily: FONT.mono,
            fontSize: 8,
            letterSpacing: 1.5,
            color: C.gold,
            border: `1px solid ${C.goldEdge}`,
            padding: '2px 5px',
            borderRadius: 2,
          }}
        >
          WAR ROOM
        </span>
      </div>

      {show && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
          <span style={{ fontFamily: FONT.mono, fontSize: 9, color: C.textMute, letterSpacing: 1 }}>
            {scopeName}
          </span>
          <span style={stat}>
            RND <span style={{ color: C.textHi, fontWeight: 700 }}>{pad3(round)}</span>
          </span>
          <span style={stat}>
            ALIVE <span style={{ color: C.green, fontWeight: 700 }}>{alive}</span>
          </span>
          <span style={stat}>
            FALLEN <span style={{ color: C.red, fontWeight: 700 }}>{fallen}</span>
          </span>
          <span
            style={{
              fontFamily: FONT.mono,
              fontSize: 8.5,
              letterSpacing: 1.5,
              color: C.gold,
              border: `1px solid ${C.goldEdge}`,
              padding: '3px 7px',
              borderRadius: 2,
              animation: warPulsing ? 'fiBlink 2.4s ease-in-out infinite' : 'none',
            }}
          >
            {warStage}
          </span>

          <div style={{ flex: 1 }} />

          <Segmented
            options={[['duel', 'DUEL'], ['blitz', 'BLITZ'], ['chaos', 'CHAOS']]}
            value={pacing}
            onChange={onPacing}
          />
          <Segmented
            options={[['ticker', 'TICKER'], ['instant', 'INSTANT']]}
            value={resolution}
            onChange={onResolution}
          />

          <button onClick={onSpeed} style={{ ...btn, fontSize: 10, minWidth: 38 }}>
            {speed}×
          </button>
          <button onClick={onStep} style={{ ...btn, padding: '6px 12px' }}>
            STEP
          </button>
          <button
            onClick={onPlay}
            style={{
              ...btn,
              letterSpacing: 1.5,
              fontWeight: 700,
              padding: '6px 14px',
              border: `1px solid ${autoplay ? C.redEdge : C.green}`,
              background: autoplay ? 'transparent' : C.green,
              color: autoplay ? C.red : C.ink,
            }}
          >
            {autoplay ? 'PAUSE' : 'PLAY'}
          </button>
          <button
            onClick={onNew}
            style={{
              ...btn,
              border: `1px solid ${confirmNew ? C.redEdge : C.lineCtl}`,
              color: confirmNew ? C.red : C.textSoft,
            }}
          >
            {confirmNew ? 'SURE?' : 'NEW'}
          </button>
        </div>
      )}
    </div>
  );
}
