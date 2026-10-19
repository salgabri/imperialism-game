// Owner: WP-MATCH (see PLAN.md §4). Match view score header (B§1.3) / phone score band (B§2.3).
import React from 'react';
import TeamMark from '../../components/TeamMark.jsx';
import { useMatchMinute } from './useMatchMinute.js';

function Side({ team, align }) {
  const mark = <TeamMark id={team.flagId} code={team.code} color={team.color} isClub={team.isClub} width={28} height={21} />;
  return (
    <div className={`match-score__side match-score__side--${align}`}>
      <div className="match-score__label">
        {align === 'a' && <span className="match-score__label-text">{team.side}</span>}
        <span className="match-score__mark">{mark}</span>
        {align === 'd' && <span className="match-score__label-text">{team.side}</span>}
      </div>
      <p className="match-score__name" title={team.name}>{team.name}</p>
      <p className="match-score__scorers">{team.scorers}</p>
    </div>
  );
}

function StatusLine({ live, statusLabel, statusDetail, minuteStore, minuteFallback, minuteFloor }) {
  const minute = useMatchMinute({ live, minuteStore, minuteFallback, minuteFloor });
  const text = live ? `${minute}' · ${statusLabel}` : `${statusLabel}${statusDetail ? ` · ${statusDetail}` : ''}`;
  return (
    <p className={`match-score__minute${live ? ' is-live' : ''}`}>
      <i className="match-score__square" aria-hidden="true" />
      <span className="match-score__minute-text">{text}</span>
    </p>
  );
}

/** The kick dots are graphics: role="img" makes the tally sentence a valid aria-label target (a bare span is not). */
function Kicks({ code, kicks }) {
  return (
    <span className="match-score__kicks" role="img" aria-label={`${code}: ${kicks.filter(Boolean).length} penalties scored from ${kicks.length}`}>
      <span className="match-score__kicks-code" aria-hidden="true">{code}</span>
      {kicks.map((scored, i) => <i key={i} className={scored ? 'is-scored' : 'is-missed'} aria-hidden="true" />)}
    </span>
  );
}

/** Attack | score + minute | Defend. The attacker always comes first, whichever side you manage (B§1.7). */
export default function ScoreHeader({ a, b, live = false, statusLabel = '', statusDetail = null, kicks = null,
  minuteStore = null, minuteFallback = 0, minuteFloor = 0 }) {
  return (
    <header className="match-score">
      <h1 className="sr-only">{`${a.name} ${a.score}, ${b.name} ${b.score}`}</h1>
      <Side team={a} align="a" />
      <div className="match-score__digits" aria-hidden="true">
        <span>{a.score}</span><span className="match-score__dash">–</span><span>{b.score}</span>
      </div>
      <Side team={b} align="d" />
      <StatusLine live={live} statusLabel={statusLabel} statusDetail={statusDetail}
        minuteStore={minuteStore} minuteFallback={minuteFallback} minuteFloor={minuteFloor} />
      {kicks && (kicks.a?.length || kicks.b?.length) ? (
        <div className="match-score__pens">
          <Kicks code={a.code} kicks={kicks.a || []} />
          <Kicks code={b.code} kicks={kicks.b || []} />
        </div>
      ) : null}
    </header>
  );
}
