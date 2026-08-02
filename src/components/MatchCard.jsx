import React from 'react';
import { C, FONT } from '../theme.js';
import Flag from './Flag.jsx';

const chip = {
  textAlign: 'center',
  padding: '4px 0',
  borderRadius: 3,
  color: C.ink,
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: 10,
};

const teamName = {
  fontSize: 16,
  fontWeight: 600,
  color: C.textHi,
  paddingLeft: 4,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const score = {
  fontFamily: FONT.mono,
  fontSize: 24,
  fontWeight: 700,
  color: C.goldSoft,
  textAlign: 'center',
  background: C.ink,
  border: `1px solid ${C.lineInner}`,
  borderRadius: 4,
  padding: '4px 2px',
};

function PenRow({ code, kicks }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontFamily: FONT.mono, fontSize: 9, fontWeight: 700, color: C.textChip, minWidth: 30 }}>
        {code}
      </span>
      <div style={{ display: 'flex', gap: 5 }}>
        {kicks.map((scored, i) => (
          <span
            key={i}
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: scored ? C.green : 'transparent',
              border: `1.5px solid ${scored ? C.green : C.red}`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Live scoreboard for the match currently on the pitch. */
export default function MatchCard({ round, mode, status, statusColor, statusLive, startLabel, a, b, kicks, events, noEvents, result, eventsRef }) {
  return (
    <div
      style={{
        margin: '12px 12px 0',
        border: `1px solid ${C.lineCard}`,
        borderRadius: 5,
        background: C.card,
        overflow: 'hidden',
        flex: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '7px 12px',
          borderBottom: `1px solid ${C.lineInner}`,
          background:
            'repeating-linear-gradient(90deg, rgba(87,196,139,0.10) 0px, rgba(87,196,139,0.10) 20px, rgba(87,196,139,0.045) 20px, rgba(87,196,139,0.045) 40px), ' +
            C.cardHi,
        }}
      >
        <span style={{ fontFamily: FONT.mono, fontSize: 9, letterSpacing: 1.5, color: C.textMute }}>
          ROUND {round} · {mode}
        </span>
        <span
          style={{
            fontFamily: FONT.mono,
            fontSize: 9,
            letterSpacing: 1.5,
            color: statusColor,
            animation: statusLive ? 'fiBlink 1.1s ease-in-out infinite' : 'none',
          }}
        >
          {status}
        </span>
      </div>

      <div
        style={{
          padding: '10px 12px 8px',
          display: 'grid',
          gridTemplateColumns: '22px 42px 1fr 52px',
          columnGap: 6,
          rowGap: 9,
          alignItems: 'center',
        }}
      >
        {[a, b].map((t, i) => (
          <React.Fragment key={i}>
            <Flag nationId={t.id} width={22} />
            <span style={{ ...chip, background: t.color }}>{t.code}</span>
            <span style={teamName}>
              {t.name}{' '}
              <span style={{ fontFamily: FONT.mono, fontSize: 9, color: C.textMute, fontWeight: 400 }}>
                EFF {t.eff}
              </span>
            </span>
            <span style={score}>{t.score}</span>
          </React.Fragment>
        ))}
      </div>

      {kicks && (
        <div style={{ padding: '0 12px 9px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          <PenRow code={a.code} kicks={kicks.a} />
          <PenRow code={b.code} kicks={kicks.b} />
        </div>
      )}

      <div
        ref={eventsRef}
        style={{
          maxHeight: 128,
          overflowY: 'auto',
          borderTop: `1px solid ${C.lineInner}`,
          padding: '7px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {noEvents && (
          <span style={{ fontFamily: FONT.mono, fontSize: 9, color: C.textFaint, letterSpacing: 1 }}>{startLabel}</span>
        )}
        {events.map((e, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontFamily: FONT.mono, fontSize: 9, color: C.textFaint, minWidth: 28 }}>{e.when}</span>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: e.color, flex: 'none' }} />
            <span
              style={{
                fontFamily: FONT.mono,
                fontSize: 10,
                color: C.textEvent,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {e.text}
            </span>
          </div>
        ))}
      </div>

      {result && (
        <div style={{ borderTop: `1px solid ${C.lineInner}`, padding: '10px 12px', background: result.background }}>
          {result.upset && (
            <div style={{ fontFamily: FONT.mono, fontSize: 9, letterSpacing: 2, color: C.gold, marginBottom: 5 }}>
              UPSET ALERT — GIANT KILLED
            </div>
          )}
          <div style={{ fontSize: 17, fontWeight: 700, color: C.textMax, letterSpacing: 0.5 }}>{result.title}</div>
          <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textChip, marginTop: 4, lineHeight: 1.55 }}>
            {result.text}
          </div>
        </div>
      )}
    </div>
  );
}
