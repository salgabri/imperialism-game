import React from 'react';
import { C, FONT } from '../theme.js';
import Flag from './Flag.jsx';

const POP_IN = 'fiPop 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.15)';

const stage = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
  zIndex: 25,
};

const panel = {
  background: 'rgba(26,38,55,0.95)',
  border: `1px solid ${C.lineCtl}`,
  borderRadius: 8,
  textAlign: 'center',
  animation: POP_IN,
  boxShadow: '0 20px 55px rgba(12,20,32,0.55)',
};

const codeChip = {
  textAlign: 'center',
  borderRadius: 4,
  color: C.ink,
  fontFamily: FONT.mono,
  fontWeight: 700,
};

/** Goal flash across the top of the map. */
export function Toast({ code, text, color }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 14,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        zIndex: 26,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          background: 'rgba(20,32,46,0.96)',
          border: `1px solid ${C.lineCtl}`,
          borderRadius: 4,
          overflow: 'hidden',
          animation: 'fiPop 0.25s ease-out',
          boxShadow: '0 10px 28px rgba(12,20,32,0.45)',
        }}
      >
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '7px 10px',
            background: color,
            color: C.ink,
            fontFamily: FONT.mono,
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {code}
        </span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '7px 14px',
            fontFamily: FONT.mono,
            fontSize: 11,
            letterSpacing: 1,
            color: C.textMax,
          }}
        >
          {text}
        </span>
      </div>
    </div>
  );
}

function Side({ id, code, color, name, eff }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 130 }}>
      <Flag nationId={id} width={44} style={{ borderRadius: 2, boxShadow: '0 2px 8px rgba(12,20,32,0.5)' }} />
      <span style={{ ...codeChip, minWidth: 54, padding: '6px 0', background: color, fontSize: 13 }}>{code}</span>
      <span style={{ fontSize: 19, fontWeight: 700, color: C.textMax, letterSpacing: 0.5, lineHeight: 1.1 }}>
        {name}
      </span>
      <span style={{ fontFamily: FONT.mono, fontSize: 9, color: C.textSoft }}>EFF {eff}</span>
    </div>
  );
}

/** Pre-match card: who is attacking whom, and how the ratings compare. */
export function MatchupPopup({ label, a, b }) {
  return (
    <div style={stage}>
      <div style={{ ...panel, padding: '18px 30px 20px', minWidth: 360, position: 'relative', overflow: 'hidden' }}>
        <svg
          width="220"
          height="130"
          viewBox="0 0 220 130"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            opacity: 0.07,
            pointerEvents: 'none',
          }}
        >
          <circle cx="110" cy="65" r="44" fill="none" stroke={C.textMax} strokeWidth="2" />
          <line x1="110" y1="0" x2="110" y2="130" stroke={C.textMax} strokeWidth="2" />
          <circle cx="110" cy="65" r="4" fill={C.textMax} />
        </svg>
        <div style={{ fontFamily: FONT.mono, fontSize: 9, letterSpacing: 2.5, color: C.gold, marginBottom: 13 }}>
          {label}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
          <Side {...a} />
          <span style={{ fontFamily: FONT.head, fontSize: 32, fontWeight: 800, color: C.textChip }}>VS</span>
          <Side {...b} />
        </div>
      </div>
    </div>
  );
}

/** Full-time card: score, annexation headline, upset banner. */
export function ResultPopup({ label, score, title, sub, upset, color }) {
  return (
    <div style={stage}>
      <div style={{ ...panel, overflow: 'hidden', minWidth: 380 }}>
        <div style={{ height: 4, background: color }} />
        <div style={{ padding: '16px 30px 20px' }}>
          <div style={{ fontFamily: FONT.mono, fontSize: 9, letterSpacing: 2.5, color: C.textMute }}>{label}</div>
          {upset && (
            <div style={{ fontFamily: FONT.mono, fontSize: 10, letterSpacing: 2, color: C.gold, marginTop: 8 }}>
              UPSET ALERT — GIANT KILLED
            </div>
          )}
          <div style={{ fontFamily: FONT.mono, fontSize: 34, fontWeight: 700, color: C.textMax, marginTop: 8 }}>
            {score}
          </div>
          <div
            style={{
              fontFamily: FONT.head,
              fontSize: 23,
              fontWeight: 700,
              color: C.textMax,
              letterSpacing: 1,
              marginTop: 6,
            }}
          >
            {title}
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: 10, letterSpacing: 1, color: C.textSoft, marginTop: 6 }}>
            {sub}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The spoils: the loser's best player changing shirts. */
export function StealPopup({ name, meta, from, fromId, fromColor, to, toId, toColor, sub }) {
  return (
    <div style={stage}>
      <div style={{ ...panel, border: `1px solid ${C.cyanEdge}`, padding: '16px 32px 20px', minWidth: 360 }}>
        <div style={{ fontFamily: FONT.mono, fontSize: 9, letterSpacing: 2.5, color: C.cyan }}>PLAYER CLAIMED</div>
        <div
          style={{
            fontFamily: FONT.head,
            fontSize: 29,
            fontWeight: 700,
            color: C.textMax,
            letterSpacing: 1,
            marginTop: 8,
          }}
        >
          {name}
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 11, color: C.textSoft, marginTop: 4 }}>{meta}</div>
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 12 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Flag nationId={fromId} width={24} />
            <span style={{ ...codeChip, minWidth: 46, padding: '5px 0', background: fromColor, fontSize: 11, borderRadius: 3 }}>
              {from}
            </span>
          </div>
          <span style={{ fontFamily: FONT.mono, fontSize: 14, color: C.cyan }}>→</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ ...codeChip, minWidth: 46, padding: '5px 0', background: toColor, fontSize: 11, borderRadius: 3 }}>
              {to}
            </span>
            <Flag nationId={toId} width={24} />
          </div>
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 9, letterSpacing: 2, color: C.textMute, marginTop: 10 }}>
          {sub}
        </div>
      </div>
    </div>
  );
}
