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

function ScoreTeam({ team, teamId, onSelectTeam }) {
  const content = <>
    <TeamMark {...team} width={48} />
    <span className="fi-score-team-name">{team.name}</span>
    <span className="fi-score-eff" title="Strength of the legal starting lineup"><span className="fi-score-eff-label">Strength</span> <span className="fi-score-eff-value">{team.eff}</span></span>
  </>;
  return onSelectTeam && teamId != null ? (
    <button type="button" className="fi-score-team fi-score-team-button" onClick={() => onSelectTeam(teamId)} aria-label={`View ${team.name} squad`}>
      {content}
    </button>
  ) : <div className="fi-score-team">{content}</div>;
}

function MatchEvents({ events }) {
  return events.map((event, index) => (
    <div className="fi-match-event" key={index}>
      <span className="fi-event-time">{event.when}</span>
      <i style={{ '--event-color': event.color }} aria-hidden="true" />
      <span>{event.text}</span>
    </div>
  ));
}

function formatWinChance(probability) {
  if (probability < .01) return '<1%';
  if (probability > .99) return '>99%';
  return `${Math.round(probability * 100)}%`;
}

/** The latest match stays visible while its territory and player rewards resolve. */
export default function MatchCard({ round, status, statusColor, statusLive, startLabel, a, b, aId, bId, dId, winnerId, kicks, events = [], noEvents, result, eventsRef, odds, series, onViewConquest, onSelectTeam, archived = false, routeLabel }) {
  const statusText = status === 'FT' || status === 'FULL TIME' ? 'Full time' : status;
  const statusTone = statusColor === C.gold ? 'warning' : statusLive ? 'positive' : 'muted';
  // Flag IDs describe artwork; only campaign IDs can open a squad, particularly for clubs.
  const firstTeamId = a.teamId ?? a.tid ?? aId;
  const secondTeamId = b.teamId ?? b.tid ?? dId ?? bId;
  const resultWinnerId = result?.winnerId ?? winnerId;
  const completed = !!result || archived;
  return (
    <section className={`fi-match${archived ? ' fi-match--archived' : ''}`} aria-label={archived ? 'Archived match' : 'Latest match'} data-testid="match-card">
      <div className="fi-match-heading">
        <h2>{archived ? `Round ${Number(round) || round}` : 'Latest match'}</h2>
        <span className={`fi-match-status${statusLive ? ' is-live' : ''}`} style={{ color: `var(--result-${statusTone}, ${statusColor || C.textMute})` }}>{statusText}</span>
      </div>
      <div className="fi-scoreboard" role="group" aria-label={`${a.name} ${a.score}, ${b.name} ${b.score}`}>
        <ScoreTeam team={a} teamId={firstTeamId} onSelectTeam={onSelectTeam} />
        <div className="fi-score-number"><span className="fi-score-value">{a.score}</span><span className="fi-score-dash">–</span><span className="fi-score-value">{b.score}</span></div>
        <ScoreTeam team={b} teamId={secondTeamId} onSelectTeam={onSelectTeam} />
      </div>
      {odds != null && <p className="fi-match-odds" title="Pre-match estimate including match-day uncertainty and tie-breaks"><span>{a.code || a.name} {formatWinChance(typeof odds === 'number' ? odds : odds.a)}</span><span>Estimated win chance</span><span>{b.code || b.name} {formatWinChance(typeof odds === 'number' ? 1 - odds : odds.b ?? 1 - odds.a)}</span></p>}
      {series && <p className="fi-series-status" role="status">Final series · {a.code || a.name} {series.aWins}–{series.bWins} {b.code || b.name} · first to {Math.ceil((series.bestOf || 3) / 2)} wins</p>}
      {routeLabel && routeLabel !== 'Direct challenge' && <p className="fi-match-route">{routeLabel}{/neutral/i.test(routeLabel) ? ' · neutral territories remain unclaimed' : ''}</p>}
      <div className="fi-match-rule" aria-hidden="true" />
      {kicks && <div className="fi-penalties"><PenRow code={a.code} kicks={kicks.a} /><PenRow code={b.code} kicks={kicks.b} /></div>}
      {!completed && (
        <div className="fi-match-events" ref={eventsRef} role="log" aria-label="Match events">
          {noEvents && <p className="fi-match-wait">{startLabel || 'Waiting for the opening play'} · Round {Number(round) || round}</p>}
          <MatchEvents events={events} />
        </div>
      )}
      {result && (
        <div className="fi-match-result" aria-live="polite">
          {result.upset && <div className="fi-upset-label">Upset victory</div>}
          <h3>{result.winnerName && result.loserName ? `${result.winnerName} takes ${result.loserName}` : result.title}</h3>
          {result.tieText && <p className="fi-result-tiebreak">{result.tieText}</p>}
          {result.territories != null && (
            <div className="fi-spoils-row fi-spoils-row--territory"><Icon name="globe" size={17} /><span><span className="fi-reward-label">Territory gained</span><strong className="fi-reward-value">+{result.territories} {Number(result.territories) === 1 ? 'territory' : 'territories'}</strong></span></div>
          )}
          {result.player && (
            <div className="fi-spoils-row fi-spoils-row--player"><Icon name="users" size={17} /><span><span className="fi-reward-label">Player acquired</span>{onSelectTeam && resultWinnerId != null ? <button type="button" className="fi-player-inspect" onClick={() => onSelectTeam(resultWinnerId)} aria-label={`View ${result.player.name} in ${result.winnerName || 'the winning team'} squad`}>{result.player.name}</button> : <strong>{result.player.name}</strong>} joins {result.winnerName}<small>{result.player.pos} · {result.player.rating} rating{result.replacedPlayer ? ` · replaces ${typeof result.replacedPlayer === 'string' ? result.replacedPlayer : result.replacedPlayer.name} in the lineup` : ''}</small></span></div>
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
          {!!result.territoryNames?.length && <details className="fi-conquest-details"><summary>{result.territoryNames.length === 1 ? 'Territory claimed' : 'Territories claimed'}</summary><p>{result.territoryNames.join(', ')}</p></details>}
          {result.territories > 0 && onViewConquest && <button type="button" className="fi-context-button" onClick={() => onViewConquest(result)}><Icon name="globe" size={15} />View conquest on map</button>}
        </div>
      )}
      {completed && <details className="fi-match-report" key={`${round}-${firstTeamId}-${secondTeamId}`}>
        <summary><span>Match report</span><span className="fi-match-report-count">{events.length} {events.length === 1 ? 'event' : 'events'}</span></summary>
        <div className="fi-match-events fi-match-events--report" role="region" aria-label="Completed match events">
          {events.length ? <MatchEvents events={events} /> : <p className="fi-match-wait">No match events recorded.</p>}
        </div>
      </details>}
    </section>
  );
}
