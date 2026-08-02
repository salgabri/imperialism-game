import React, { useMemo } from 'react';
import { C, FONT } from '../theme.js';
import { NATIONS, SCOPES } from '../data/teams.js';
import { SPORT_LIST, getSport } from '../sports/index.js';
import { CLUB_SCOPES } from '../data/scopes.js';

const PACING = [
  ['duel', 'ONE BY ONE', 'A spinner picks an attacker and a direction. One dramatic duel per round.'],
  ['blitz', 'BLITZ ROUND', 'Every nation is paired with a neighbour. One round halves the field.'],
  ['chaos', 'CHAOS DRAW', 'Random matchups are drawn until a name repeats — then the batch resolves.'],
];

const resolutionCards = sport => [
  ['ticker', 'LIVE TICKER', `Scoring lands minute by minute. Level games go to ${sport.labels.tie.toLowerCase()}.`],
  ['instant', 'INSTANT RESULT', 'Final score at once. Built for fast wars.'],
];

const sectionLabel = {
  fontFamily: FONT.mono,
  fontSize: 10,
  letterSpacing: 3,
  color: C.textMute,
};

function Card({ selected, onPick, name, desc, count }) {
  return (
    <div
      className="fi-card"
      onClick={onPick}
      style={{
        border: `1px solid ${selected ? C.gold : C.lineCard}`,
        background: selected ? C.cardPick : C.card,
        borderRadius: 5,
        padding: '12px 14px',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: count ? 17 : 16, fontWeight: 700, color: selected ? C.gold : C.textList, letterSpacing: 0.5 }}>
          {name}
        </span>
        {count && <span style={{ fontFamily: FONT.mono, fontSize: 9, color: C.textMute, flex: 'none' }}>{count}</span>}
      </div>
      <div style={{ fontSize: 13, color: C.textCoord, marginTop: 3, lineHeight: 1.35 }}>{desc}</div>
    </div>
  );
}

function Grid({ min, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: 10 }}>
      {children}
    </div>
  );
}

/** Pre-campaign briefing: theatre, pacing, and how matches resolve. */
export default function SetupOverlay({ setup, hasSave, savedText, onResume, onDiscard, onPick, onStart }) {
  const scopeCounts = useMemo(() => {
    const ids = Object.keys(NATIONS);
    const counts = {};
    for (const s of SCOPES) {
      if (s.id === 'world') counts[s.id] = ids.length + ' NATIONS';
      else if (s.id === 'elite') counts[s.id] = '32 NATIONS';
      else counts[s.id] = ids.filter(id => s.filter({ conf: NATIONS[id][2] })).length + ' NATIONS';
    }
    return counts;
  }, []);
  const sport = getSport(setup.sport);
  const clubLayer = setup.layer === 'clubs';
  const clubScopes = useMemo(() => CLUB_SCOPES(sport), [sport]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(26,38,55,0.96)',
        zIndex: 40,
        overflowY: 'auto',
      }}
    >
      <div style={{ maxWidth: 940, margin: '0 auto', padding: '46px 28px 70px' }}>
        <div
          style={{
            fontFamily: FONT.head,
            fontSize: 48,
            fontWeight: 800,
            letterSpacing: 3,
            color: C.textHi,
            lineHeight: 1,
          }}
        >
          {sport.name.toUpperCase()} IMPERIALISM
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 10, letterSpacing: 2.5, color: C.gold, marginTop: 10 }}>
          WIN THE MATCH · TAKE ALL THEIR LAND · STEAL THEIR BEST PLAYER · LAST NATION STANDING
        </div>

        {hasSave && (
          <div
            style={{
              marginTop: 26,
              border: `1px solid ${C.cyanEdge}`,
              borderRadius: 5,
              background: C.cyanPanel,
              padding: '13px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontFamily: FONT.mono, fontSize: 10, letterSpacing: 1, color: C.cyan }}>
              SAVED CAMPAIGN
            </span>
            <span style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textSoft }}>{savedText}</span>
            <div style={{ flex: 1 }} />
            <button
              onClick={onResume}
              style={{
                fontFamily: FONT.mono,
                fontSize: 9,
                letterSpacing: 1.5,
                fontWeight: 700,
                padding: '8px 16px',
                border: 'none',
                borderRadius: 3,
                background: C.cyan,
                color: C.ink,
                cursor: 'pointer',
              }}
            >
              RESUME
            </button>
            <button
              onClick={onDiscard}
              style={{
                fontFamily: FONT.mono,
                fontSize: 9,
                letterSpacing: 1,
                padding: '8px 12px',
                border: `1px solid ${C.lineCtl}`,
                borderRadius: 3,
                background: 'transparent',
                color: C.textSoft,
                cursor: 'pointer',
              }}
            >
              DISCARD
            </button>
          </div>
        )}

        <div style={{ ...sectionLabel, margin: '34px 0 12px' }}>01 · SELECT SPORT</div>
        <Grid min={240}>
          {SPORT_LIST.map(s => (
            <Card
              key={s.id}
              selected={setup.sport === s.id}
              onPick={() => onPick('sport', s.id)}
              name={s.name.toUpperCase()}
              desc={s.blurb}
              count={`${Object.keys(s.rosters).length} REAL SQUADS`}
            />
          ))}
        </Grid>

        <div style={{ ...sectionLabel, margin: '30px 0 12px' }}>02 · WHO FIGHTS</div>
        <Grid min={240}>
          <Card
            selected={setup.layer === 'nations'}
            onPick={() => onPick('layer', 'nations')}
            name="NATIONS"
            desc="National teams contest the map, each starting on its own homeland."
            count={`${Object.keys(sport.rosters).length} REAL SQUADS`}
          />
          <Card
            selected={setup.layer === 'clubs'}
            onPick={() => onPick('layer', 'clubs')}
            name="CLUBS"
            desc="Domestic-league clubs fight for the world instead. Each is dealt the nearest free country to its home, then expands by conquest."
            count={`${sport.clubs.length} CLUBS`}
          />
        </Grid>

        <div style={{ ...sectionLabel, margin: '30px 0 12px' }}>03 · SELECT THEATRE</div>
        <Grid min={200}>
          {clubLayer
            ? clubScopes.map(s => (
                <Card
                  key={s.id}
                  selected={setup.clubScope === s.id}
                  onPick={() => onPick('clubScope', s.id)}
                  name={s.name.toUpperCase()}
                  desc={s.desc}
                  count={`${sport.clubs.filter(s.filter).length} CLUBS`}
                />
              ))
            : SCOPES.map(s => (
                <Card
                  key={s.id}
                  selected={setup.scope === s.id}
                  onPick={() => onPick('scope', s.id)}
                  name={s.name.toUpperCase()}
                  desc={s.desc}
                  count={scopeCounts[s.id]}
                />
              ))}
        </Grid>

        <div style={{ ...sectionLabel, margin: '30px 0 12px' }}>04 · PACING</div>
        <Grid min={240}>
          {PACING.map(([id, name, desc]) => (
            <Card key={id} selected={setup.pacing === id} onPick={() => onPick('pacing', id)} name={name} desc={desc} />
          ))}
        </Grid>

        <div style={{ ...sectionLabel, margin: '30px 0 12px' }}>05 · MATCH RESOLUTION</div>
        <Grid min={240}>
          {resolutionCards(sport).map(([id, name, desc]) => (
            <Card
              key={id}
              selected={setup.resolution === id}
              onPick={() => onPick('resolution', id)}
              name={name}
              desc={desc}
            />
          ))}
        </Grid>

        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 38, flexWrap: 'wrap' }}>
          <button
            onClick={onStart}
            style={{
              fontFamily: FONT.body,
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: 3,
              padding: '13px 34px',
              border: 'none',
              borderRadius: 4,
              background: C.gold,
              color: C.ink,
              cursor: 'pointer',
            }}
          >
            LAUNCH CAMPAIGN
          </button>
          <span style={{ fontFamily: FONT.mono, fontSize: 9, color: C.textDim, letterSpacing: 1 }}>
            PROGRESS AUTOSAVES AFTER EVERY MATCH
          </span>
        </div>
      </div>
    </div>
  );
}
