import React from 'react';
import { C, FONT } from '../theme.js';
import MatchCard from './MatchCard.jsx';
import PlayerRow from './PlayerRow.jsx';
import Flag from './Flag.jsx';

const TABS = [['feed', 'FEED'], ['power', 'POWER'], ['squad', 'SQUAD']];

function Tabs({ value, onChange }) {
  return (
    <div style={{ display: 'flex', borderBottom: `1px solid ${C.line}`, marginTop: 12, flex: 'none' }}>
      {TABS.map(([id, label], i) => {
        const on = value === id;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            style={{
              flex: 1,
              fontFamily: FONT.mono,
              fontSize: 9,
              letterSpacing: 1.5,
              padding: '9px 0',
              border: 'none',
              borderLeft: i ? `1px solid ${C.line}` : undefined,
              cursor: 'pointer',
              background: on ? C.cardHi : 'transparent',
              color: on ? C.gold : C.textMute,
              borderBottom: `2px solid ${on ? C.gold : 'transparent'}`,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Feed({ entries }) {
  return entries.map((f, i) => (
    <div
      key={i}
      style={{
        display: 'flex',
        gap: 9,
        padding: '7px 12px',
        borderBottom: `1px solid ${C.lineSoft}`,
        alignItems: 'flex-start',
      }}
    >
      <span style={{ fontFamily: FONT.mono, fontSize: 9, color: C.textFaint, minWidth: 32, paddingTop: 1 }}>
        {f.round}
      </span>
      <span style={{ width: 7, height: 7, borderRadius: 1, background: f.chip, flex: 'none', marginTop: 3 }} />
      <span style={{ fontFamily: FONT.mono, fontSize: 10.5, lineHeight: 1.5, color: f.color }}>{f.text}</span>
    </div>
  ));
}

function Power({ rows, onSelect }) {
  return rows.map(p => (
    <div
      key={p.tid}
      className="fi-row"
      onClick={() => onSelect(p.tid)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        borderBottom: `1px solid ${C.lineSoft}`,
        cursor: 'pointer',
      }}
    >
      <span style={{ fontFamily: FONT.mono, fontSize: 9, color: C.textFaint, minWidth: 22 }}>{p.rank}</span>
      <Flag nationId={p.tid} width={20} />
      <span
        style={{
          minWidth: 36,
          textAlign: 'center',
          padding: '3px 0',
          borderRadius: 3,
          background: p.color,
          color: C.ink,
          fontFamily: FONT.mono,
          fontSize: 9.5,
          fontWeight: 700,
        }}
      >
        {p.code}
      </span>
      <span
        style={{
          flex: 1,
          fontSize: 14,
          fontWeight: 600,
          color: C.textList,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {p.name}
      </span>
      <span style={{ fontFamily: FONT.mono, fontSize: 9, color: C.textMute }}>{p.territories}</span>
      <span style={{ textAlign: 'right', minWidth: 42 }}>
        <span style={{ fontFamily: FONT.mono, fontSize: 13, fontWeight: 700, color: C.textHi, display: 'block' }}>
          {p.eff}
        </span>
        <span style={{ fontFamily: FONT.mono, fontSize: 8.5, fontWeight: 700, color: p.effGain.color, display: 'block' }}>
          {p.effGain.text}
        </span>
      </span>
    </div>
  ));
}

function Squad({ squad }) {
  if (!squad) {
    return (
      <div
        style={{
          padding: '18px 14px',
          fontFamily: FONT.mono,
          fontSize: 10,
          color: C.textDim,
          lineHeight: 1.8,
          letterSpacing: 0.5,
        }}
      >
        NO NATION SELECTED.
        <br />
        CLICK A TERRITORY ON THE MAP, OR PICK FROM THE POWER TAB.
      </div>
    );
  }
  return (
    <>
      <div
        style={{
          padding: '13px 12px',
          borderBottom: `1px solid ${C.line}`,
          display: 'flex',
          gap: 11,
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 'none' }}>
          <Flag nationId={squad.id} width={44} style={{ borderRadius: 2 }} />
          <span
            style={{
              minWidth: 44,
              textAlign: 'center',
              padding: '4px 0',
              borderRadius: 4,
              background: squad.color,
              color: C.ink,
              fontFamily: FONT.mono,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {squad.code}
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 19,
              fontWeight: 700,
              color: C.textHi,
              letterSpacing: 0.5,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {squad.name}
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: 8.5, color: C.textMute, letterSpacing: 1, marginTop: 2 }}>
            {squad.meta}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: FONT.mono, fontSize: 17, fontWeight: 700, color: C.textHi }}>{squad.eff}</div>
          <div style={{ fontFamily: FONT.mono, fontSize: 8, color: C.textMute, letterSpacing: 1 }}>EFF</div>
          <div style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, color: squad.effGain.color, marginTop: 2 }}>
            {squad.effGain.text}
          </div>
        </div>
      </div>

      {/* What conquest has actually done to the squad. EFF tracks the best XI, so
          it only ever climbs; the squad average can fall when a big nation
          absorbs a weak one's best player. */}
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'baseline',
          gap: 14,
          borderBottom: `1px solid ${C.lineSoft}`,
          fontFamily: FONT.mono,
          fontSize: 9,
          color: C.textMute,
          letterSpacing: 0.5,
        }}
      >
        <span>
          SQUAD <span style={{ color: C.textList, fontWeight: 700 }}>{squad.players.length}</span>
        </span>
        <span>
          AVG <span style={{ color: C.textList, fontWeight: 700 }}>{squad.avg}</span>{' '}
          <span style={{ color: squad.avgGain.color, fontWeight: 700 }}>{squad.avgGain.text}</span>
        </span>
        <span style={{ marginLeft: 'auto', color: C.textFaded, letterSpacing: 1 }}>SINCE KICK-OFF</span>
      </div>

      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          gap: 16,
          borderBottom: `1px solid ${C.lineSoft}`,
          fontFamily: FONT.mono,
          fontSize: 9,
          color: C.textMute,
          letterSpacing: 0.5,
        }}
      >
        <span>
          TERR <span style={{ color: C.textList, fontWeight: 700 }}>{squad.territories}</span>
        </span>
        <span>
          CONQUESTS <span style={{ color: C.textList, fontWeight: 700 }}>{squad.conquests}</span>
        </span>
        <span>
          STOLEN <span style={{ color: C.cyan, fontWeight: 700 }}>{squad.stolen}</span>
        </span>
        <span style={{ marginLeft: 'auto', color: squad.statusColor, fontWeight: 700 }}>{squad.status}</span>
      </div>

      {squad.players.map((p, i) => (
        <PlayerRow key={i} player={p} />
      ))}
    </>
  );
}

/** Intel panel: what just happened, who is winning, and who plays for them. */
export default function Sidebar({ match, idleText, queueLeft, tab, onTab, feed, power, squad, onSelectTeam, eventsRef }) {
  return (
    <div
      style={{
        flex: 'none',
        width: 378,
        borderLeft: `1px solid ${C.line}`,
        background: C.panel,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {match && <MatchCard {...match} eventsRef={eventsRef} />}

      {idleText && (
        <div
          style={{
            margin: '12px 12px 0',
            border: `1px dashed ${C.lineCard}`,
            borderRadius: 5,
            padding: 14,
            color: C.textDim,
            fontFamily: FONT.mono,
            fontSize: 10,
            letterSpacing: 0.5,
            lineHeight: 1.7,
            flex: 'none',
          }}
        >
          {idleText}
        </div>
      )}

      {queueLeft > 0 && (
        <div
          style={{
            margin: '8px 12px 0',
            padding: '6px 10px',
            border: `1px solid ${C.line}`,
            borderRadius: 3,
            fontFamily: FONT.mono,
            fontSize: 9,
            letterSpacing: 1,
            color: C.textSoft,
            flex: 'none',
          }}
        >
          BATCH · {queueLeft} MATCH(ES) QUEUED THIS ROUND
        </div>
      )}

      <Tabs value={tab} onChange={onTab} />

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {tab === 'feed' && <Feed entries={feed} />}
        {tab === 'power' && <Power rows={power} onSelect={onSelectTeam} />}
        {tab === 'squad' && <Squad squad={squad} />}
      </div>
    </div>
  );
}
