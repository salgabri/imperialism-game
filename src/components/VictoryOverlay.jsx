import React from 'react';
import { C, FONT } from '../theme.js';
import PlayerRow from './PlayerRow.jsx';
import Flag from './Flag.jsx';

function Stat({ value, label, color }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 8, letterSpacing: 1.5, color: C.textMute, marginTop: 3 }}>{label}</div>
    </div>
  );
}

/** Endgame: one nation, everyone else's best players. */
export default function VictoryOverlay({
  id,
  round,
  name,
  color,
  subtitle,
  conquests,
  steals,
  territories,
  effNow,
  effBase,
  effGain,
  squad,
  onClose,
  onNew,
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        background: 'rgba(26,38,55,0.95)',
        overflowY: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ textAlign: 'center', padding: '44px 28px', maxWidth: 600, width: '100%' }}>
        <div style={{ fontFamily: FONT.mono, fontSize: 10, letterSpacing: 4, color: C.gold }}>
          CAMPAIGN COMPLETE — ROUND {round}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}>
          <Flag nationId={id} width={96} style={{ borderRadius: 3, boxShadow: '0 8px 26px rgba(12,20,32,0.6)' }} />
        </div>
        <div
          style={{
            fontFamily: FONT.head,
            fontSize: 64,
            fontWeight: 800,
            letterSpacing: 2,
            lineHeight: 1.05,
            marginTop: 14,
            color,
          }}
        >
          {name}
        </div>
        <div style={{ fontSize: 19, color: C.text, marginTop: 8 }}>{subtitle}</div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 34, marginTop: 26, fontFamily: FONT.mono }}>
          <Stat value={conquests} label="CONQUESTS" color={C.textHi} />
          <Stat value={steals} label="PLAYERS TAKEN" color={C.cyan} />
          <Stat value={territories} label="TERRITORIES" color={C.green} />
          <Stat value={effGain.text} label="RATING GAINED" color={effGain.color} />
        </div>

        <div style={{ fontFamily: FONT.mono, fontSize: 9, letterSpacing: 3, color: C.textMute, margin: '30px 0 10px' }}>
          FINAL SQUAD — BUILT BY CONQUEST
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textSoft, marginBottom: 10 }}>
          KICK-OFF EFF {effBase} → {effNow}
        </div>
        <div style={{ border: `1px solid ${C.lineCard}`, borderRadius: 5, background: C.card, textAlign: 'left' }}>
          {squad.map((p, i) => (
            <PlayerRow key={i} player={p} roomy />
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 28 }}>
          <button
            onClick={onClose}
            style={{
              fontFamily: FONT.mono,
              fontSize: 10,
              letterSpacing: 1.5,
              padding: '10px 20px',
              border: `1px solid ${C.lineCtl}`,
              borderRadius: 3,
              background: 'transparent',
              color: C.text,
              cursor: 'pointer',
            }}
          >
            VIEW MAP
          </button>
          <button
            onClick={onNew}
            style={{
              fontFamily: FONT.mono,
              fontSize: 10,
              letterSpacing: 1.5,
              fontWeight: 700,
              padding: '10px 22px',
              border: 'none',
              borderRadius: 3,
              background: C.gold,
              color: C.ink,
              cursor: 'pointer',
            }}
          >
            NEW CAMPAIGN
          </button>
        </div>
      </div>
    </div>
  );
}
