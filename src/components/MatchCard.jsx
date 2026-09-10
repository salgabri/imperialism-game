import React from 'react';
import { C } from '../theme.js';
import Flag from './Flag.jsx';
import Icon from './Icon.jsx';
import './results.css';

export function TeamMark({ id, code, color, isClub, width = 48 }) {
  return isClub ? (
    <span className="fi-team-monogram" style={{ '--team-color': color, width, minHeight: Math.round(width * 0.75) }} aria-hidden="true">
      {code}
    </span>
  ) : <Flag nationId={id} width={width} style={{ border: 'none', borderRadius: 2 }} />;
}

function PenRow({ code, kicks }) {
  return (
    <div className="fi-penalty-row" aria-label={`${code}: ${kicks.filter(Boolean).length} penalties scored from ${kicks.length}`}>
      <span>{code}</span>
      <div>{kicks.map((scored, i) => <i key={i} className={scored ? 'scored' : 'missed'} aria-hidden="true" />)}</div>
    </div>
  );
}

/** The latest match stays visible while its territory and player rewards resolve. */
export default function MatchCard({ round, status, statusColor, statusLive, startLabel, a, b, kicks, events = [], noEvents, result, eventsRef }) {
  const statusText = status === 'FT' || status === 'FULL TIME' ? 'Full time' : status;
  const statusTone = statusColor === C.gold ? 'warning' : statusLive ? 'positive' : 'muted';
  return (
    <section className="fi-match" aria-label="Latest match" data-testid="match-card">
      <div className="fi-match-heading">
        <h2>Latest match</h2>
        <span className={`fi-match-status${statusLive ? ' is-live' : ''}`} style={{ color: `var(--result-${statusTone}, ${statusColor || C.textMute})` }}>{statusText}</span>
      </div>
      <div className="fi-scoreboard" aria-label={`${a.name} ${a.score}, ${b.name} ${b.score}`}>
        <div className="fi-score-team">
          <TeamMark {...a} width={48} />
          <span className="fi-score-team-name">{a.name}</span>
          <span className="fi-score-eff" title="Effective team strength">EFF {a.eff}</span>
        </div>
        <div className="fi-score-number"><span>{a.score}</span><span className="fi-score-dash">–</span><span>{b.score}</span></div>
        <div className="fi-score-team">
          <TeamMark {...b} width={48} />
          <span className="fi-score-team-name">{b.name}</span>
          <span className="fi-score-eff" title="Effective team strength">EFF {b.eff}</span>
        </div>
      </div>
      <div className="fi-match-rule" aria-hidden="true" />
      {kicks && <div className="fi-penalties"><PenRow code={a.code} kicks={kicks.a} /><PenRow code={b.code} kicks={kicks.b} /></div>}
      {!result && (
        <div className="fi-match-events" ref={eventsRef} role="log" aria-label="Match events">
          {noEvents && <p className="fi-match-wait">{startLabel || 'Waiting for the opening play'} · Round {Number(round) || round}</p>}
          {events.map((e, i) => (
            <div className="fi-match-event" key={i}>
              <span className="fi-event-time">{e.when}</span>
              <i style={{ '--event-color': e.color }} aria-hidden="true" />
              <span>{e.text}</span>
            </div>
          ))}
        </div>
      )}
      {result && (
        <div className="fi-match-result" aria-live="polite">
          {result.upset && <div className="fi-upset-label">Upset victory</div>}
          <h3>{result.winnerName && result.loserName ? `${result.winnerName} takes ${result.loserName}` : result.title}</h3>
          {result.tieText && <p className="fi-result-tiebreak">{result.tieText}</p>}
          {result.territories != null && (
            <div className="fi-spoils-row"><Icon name="globe" size={17} /><span>+{result.territories} {Number(result.territories) === 1 ? 'territory' : 'territories'}</span></div>
          )}
          {result.player && (
            <div className="fi-spoils-row"><Icon name="users" size={17} /><span><strong>{result.player.name}</strong> joins {result.winnerName}<small>{result.player.pos} · {result.player.rating} rating</small></span></div>
          )}
          {Number.isFinite(result.strengthGain) && (
            <div className="fi-spoils-row fi-strength-reward" data-testid="match-strength-gain">
              <span>Overall strength<small>{result.strengthBefore.toFixed(1)} to {result.strengthAfter.toFixed(1)} · this conquest</small></span>
              <strong className={result.strengthGain > 0 ? 'fi-strength-gain' : 'fi-strength-unchanged'}>
                {result.strengthGain > 0 ? `+${result.strengthGain.toFixed(1)}` : 'No change'}
              </strong>
            </div>
          )}
          {result.territories == null && !result.player && result.text && <p className="fi-result-fallback">{result.text}</p>}
        </div>
      )}
    </section>
  );
}
