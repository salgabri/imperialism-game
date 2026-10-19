import React from 'react';
import { C } from '../theme.js';
import TeamMark from './TeamMark.jsx';
import Icon from './Icon.jsx';
import { useLiveMinute } from './LiveMinute.jsx';
import { formatOddsPair, roman } from '../viewModels/format.js';
import './match-card.css';

// TeamMark moved to its own module (PLAN §3.5); this re-export keeps `import { TeamMark } from './MatchCard.jsx'` working.
export { default as TeamMark } from './TeamMark.jsx';

/** The kick dots are graphics: role="img" makes the per-team tally a valid aria-label target (a generic div is not). */
function PenRow({ code, kicks }) {
  return (
    <div className="fi-penalty-row" role="img" aria-label={`${code}: ${kicks.filter(Boolean).length} penalties scored from ${kicks.length}`}>
      <span>{code}</span>
      <div>{kicks.map((scored, i) => <i key={i} className={scored ? 'scored' : 'missed'} aria-hidden="true" />)}</div>
    </div>
  );
}

function ScoreTeam({ team, teamId, onSelectTeam, markWidth = 48 }) {
  const content = <>
    <TeamMark {...team} width={markWidth} />
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

const oddsA = odds => (typeof odds === 'number' ? odds : odds.a);
/** Both labels from the attacker's probability with one rounding, so the pair matches the bar and reads 100%. */
const oddsLabels = odds => formatOddsPair(oddsA(odds));

/** Territory, player and strength consequences: identical copy in both variants (smoke reads `.fi-match-result`). */
function MatchResult({ result, resultWinnerId, onSelectTeam, onViewConquest }) {
  return (
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
  );
}

/** "38' · LIVE" read from the minute store (DEC D7); never below the model's minute (last revealed event). */
function CompactMinute({ store, fallback = 0, label }) {
  const minute = useLiveMinute(store, fallback);
  return <>{`${Math.max(Number(minute) || 0, Number(fallback) || 0)}' · ${label}`}</>;
}

const STATUS_COPY = { FT: 'Full time', 'FULL TIME': 'Full time', FINAL: 'Final', PENALTIES: 'Penalties', OVERTIME: 'Overtime' };

/** "KICK-OFF… · Round VII": the same Roman round as the fixture kicker around the card (no round when unknown). */
function waitLine(startLabel, round) {
  const numeral = roman(Number(round));
  return `${startLabel || 'Waiting for the opening play'}${numeral ? ` · Round ${numeral}` : ''}`;
}

const territoryCount = n => `+${n} ${Number(n) === 1 ? 'territory' : 'territories'}`;

/**
 * The compact card's done state (DEC D10: a result line). Visible: the headline and the winner's strength delta; the
 * territory, the player, the pre-match odds, route and shoot-out dots wait in one collapsed `<details>` (still inside
 * `.fi-match-result`, so its text keeps the smoke contract). Keeps the Map column's fronts and results in view.
 */
function CompactResult({ result, resultWinnerId, onSelectTeam, onViewConquest, extras, detailsKey }) {
  const headline = result.winnerName && result.loserName ? `${result.winnerName} takes ${result.loserName}` : result.title;
  const names = result.territoryNames || [];
  const player = result.player;
  const replaced = result.replacedPlayer ? (typeof result.replacedPlayer === 'string' ? result.replacedPlayer : result.replacedPlayer.name) : null;
  const viewConquest = result.territories > 0 && onViewConquest;
  const hasSpoils = result.territories != null || !!player || names.length > 0 || !!viewConquest;
  const summaryAside = [result.territories != null ? territoryCount(result.territories) : null, player ? player.name : null]
    .filter(Boolean).join(' · ');
  return (
    <div className="fi-match-result" aria-live="polite">
      <div className="fi-match-result-head">
        <h3>{headline}</h3>
        {result.upset && <span className="fi-upset-label">Upset victory</span>}
      </div>
      {Number.isFinite(result.strengthGain) && (
        <div className="fi-spoils-row fi-strength-reward" data-testid="match-strength-gain">
          <span>
            <span className="fi-reward-label">{result.winnerName ? `${result.winnerName} strength` : 'Overall strength'}</span>
            <small>{result.strengthBefore.toFixed(1)} to {result.strengthAfter.toFixed(1)}</small>
          </span>
          <strong className={result.strengthGain > 0 ? 'fi-strength-gain' : 'fi-strength-unchanged'}>
            {result.strengthGain > 0 ? `+${result.strengthGain.toFixed(1)}` : 'No change'}
          </strong>
        </div>
      )}
      {result.territories == null && !player && result.text && <p className="fi-result-fallback">{result.text}</p>}
      {(hasSpoils || extras) && (
        <details className="fi-match-spoils" key={detailsKey}>
          <summary>
            <span className="fi-match-spoils-title">Match details</span>
            {summaryAside && <span className="fi-match-spoils-aside">{summaryAside}</span>}
          </summary>
          <div className="fi-match-spoils-body">
            {result.territories != null && (
              <div className="fi-spoils-row fi-spoils-row--territory"><Icon name="globe" size={17} /><span><span className="fi-reward-label">Territory gained</span><strong className="fi-reward-value">{territoryCount(result.territories)}</strong>{names.length > 0 && <small>{names.join(', ')}</small>}</span></div>
            )}
            {player && (
              <div className="fi-spoils-row fi-spoils-row--player"><Icon name="users" size={17} /><span><span className="fi-reward-label">Player acquired</span>{onSelectTeam && resultWinnerId != null ? <button type="button" className="fi-player-inspect" onClick={() => onSelectTeam(resultWinnerId)} aria-label={`View ${player.name} in ${result.winnerName || 'the winning team'} squad`}>{player.name}</button> : <strong>{player.name}</strong>} joins {result.winnerName}<small>{player.pos} · {player.rating} rating{replaced ? ` · replaces ${replaced} in the lineup` : ''}</small></span></div>
            )}
            {result.territories == null && names.length > 0 && <p className="fi-result-fallback">{names.join(', ')}</p>}
            {extras}
            {viewConquest && <button type="button" className="fi-context-button" onClick={() => onViewConquest(result)}><Icon name="globe" size={15} />View conquest on map</button>}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * The Map column's match block (DEC D10/D17): the fixture block's live/done state. Keeps the contract classes
 * (`data-testid="match-card"`, `.fi-scoreboard`, `.fi-match-odds` with three spans, `.fi-match-result`,
 * `[data-testid="match-strength-gain"]`); the live log stays chronological so App's eventsRef scrolls to the newest.
 * Done (DEC D10 "result line"): score, one status line (with the tie-break), the headline and the strength delta;
 * everything else folds into the result's details so the column keeps its fronts and latest results.
 */
function CompactMatchCard({ round, status, statusLive, startLabel, a, b, firstTeamId, secondTeamId, resultWinnerId, kicks,
  events, noEvents, result, eventsRef, odds, series, onViewConquest, onSelectTeam, routeLabel, minuteStore, minuteFallback }) {
  const done = !!result;
  const live = !done && !!statusLive;
  const ticking = live && /^live$/i.test(String(status || ''));
  const statusText = STATUS_COPY[String(status || '').toUpperCase()] || status;
  const fill = odds != null ? Math.max(0, Math.min(1, Number(oddsA(odds)) || 0)) * 100 : 0;
  // Never below the last revealed event, even before App passes `minuteFallback` (wiring step 3 stays authoritative).
  const floor = Math.max(Number(minuteFallback) || 0, ...(events || []).map(e => parseInt(e?.when, 10)).filter(Number.isFinite));
  const oddsRow = odds != null && (
    <p className="fi-match-odds" title="Pre-match estimate including match-day uncertainty and tie-breaks">
      <span>{a.code || a.name} {oddsLabels(odds).a}</span>
      <span className="fi-match-odds-bar" style={{ '--odds-fill': `${fill.toFixed(1)}%` }}>Estimated win chance</span>
      <span>{oddsLabels(odds).b} {b.code || b.name}</span>
    </p>
  );
  const routeRow = routeLabel && routeLabel !== 'Direct challenge'
    && <p className="fi-match-route">{routeLabel}{/neutral/i.test(routeLabel) ? ' · neutral territories remain unclaimed' : ''}</p>;
  const kicksRow = kicks && <div className="fi-penalties"><PenRow code={a.code} kicks={kicks.a} /><PenRow code={b.code} kicks={kicks.b} /></div>;
  return (
    <section className="fi-match fi-match--compact" aria-label="Latest match" data-testid="match-card"
      data-state={done ? 'done' : live ? 'live' : 'ended'}>
      <div className="fi-scoreboard" role="group" aria-label={`${a.name} ${a.score}, ${b.name} ${b.score}`}>
        <ScoreTeam team={a} teamId={firstTeamId} onSelectTeam={onSelectTeam} markWidth={28} />
        <div className="fi-score-number"><span className="fi-score-value">{a.score}</span><span className="fi-score-dash">–</span><span className="fi-score-value">{b.score}</span></div>
        <ScoreTeam team={b} teamId={secondTeamId} onSelectTeam={onSelectTeam} markWidth={28} />
      </div>
      <p className={`fi-match-status${live ? ' is-live' : ''}`}>
        <i className="fi-match-status-mark" aria-hidden="true" />
        <span>{ticking ? <CompactMinute store={minuteStore} fallback={floor} label={status} />
          : done && result.tieText ? `${statusText} · ${result.tieText}` : statusText}</span>
      </p>
      {!done && oddsRow}
      {series && <p className="fi-series-status" role="status">Final series · {a.code || a.name} {series.aWins}–{series.bWins} {b.code || b.name} · first to {Math.ceil((series.bestOf || 3) / 2)} wins</p>}
      {!done && routeRow}
      {!done && kicksRow}
      {!done && (
        <div className="fi-match-events" ref={eventsRef} role="log" aria-label="Match events">
          {noEvents && <p className="fi-match-wait">{waitLine(startLabel, round)}</p>}
          <MatchEvents events={events} />
        </div>
      )}
      {done && <CompactResult result={result} resultWinnerId={resultWinnerId} onSelectTeam={onSelectTeam} onViewConquest={onViewConquest}
        detailsKey={`${round}-${firstTeamId}-${secondTeamId}`}
        extras={oddsRow || routeRow || kicksRow ? <>{kicksRow}{oddsRow}{routeRow}</> : null} />}
    </section>
  );
}

/** The latest match stays visible while its territory and player rewards resolve. */
export default function MatchCard({ round, status, statusColor, statusLive, startLabel, a, b, aId, bId, dId, winnerId, kicks, events = [], noEvents, result, eventsRef, odds, series, onViewConquest, onSelectTeam, archived = false, routeLabel, variant = 'full', minuteStore = null, minuteFallback = 0 }) {
  // Flag IDs describe artwork; only campaign IDs can open a squad, particularly for clubs.
  const firstTeamId = a.teamId ?? a.tid ?? aId;
  const secondTeamId = b.teamId ?? b.tid ?? dId ?? bId;
  const resultWinnerId = result?.winnerId ?? winnerId;
  if (variant === 'compact' && !archived) {
    return <CompactMatchCard round={round} status={status} statusLive={statusLive} startLabel={startLabel} a={a} b={b}
      firstTeamId={firstTeamId} secondTeamId={secondTeamId} resultWinnerId={resultWinnerId} kicks={kicks} events={events}
      noEvents={noEvents} result={result} eventsRef={eventsRef} odds={odds} series={series} onViewConquest={onViewConquest}
      onSelectTeam={onSelectTeam} routeLabel={routeLabel} minuteStore={minuteStore} minuteFallback={minuteFallback} />;
  }
  const statusText = status === 'FT' || status === 'FULL TIME' ? 'Full time' : status;
  const statusTone = statusColor === C.gold ? 'warning' : statusLive ? 'positive' : 'muted';
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
      {odds != null && <p className="fi-match-odds" title="Pre-match estimate including match-day uncertainty and tie-breaks"><span>{a.code || a.name} {oddsLabels(odds).a}</span><span>Estimated win chance</span><span>{b.code || b.name} {oddsLabels(odds).b}</span></p>}
      {series && <p className="fi-series-status" role="status">Final series · {a.code || a.name} {series.aWins}–{series.bWins} {b.code || b.name} · first to {Math.ceil((series.bestOf || 3) / 2)} wins</p>}
      {routeLabel && routeLabel !== 'Direct challenge' && <p className="fi-match-route">{routeLabel}{/neutral/i.test(routeLabel) ? ' · neutral territories remain unclaimed' : ''}</p>}
      <div className="fi-match-rule" aria-hidden="true" />
      {kicks && <div className="fi-penalties"><PenRow code={a.code} kicks={kicks.a} /><PenRow code={b.code} kicks={kicks.b} /></div>}
      {!completed && (
        <div className="fi-match-events" ref={eventsRef} role="log" aria-label="Match events">
          {noEvents && <p className="fi-match-wait">{waitLine(startLabel, round)}</p>}
          <MatchEvents events={events} />
        </div>
      )}
      {result && <MatchResult result={result} resultWinnerId={resultWinnerId} onSelectTeam={onSelectTeam} onViewConquest={onViewConquest} />}
      {completed && <details className="fi-match-report" key={`${round}-${firstTeamId}-${secondTeamId}`}>
        <summary><span>Match report</span><span className="fi-match-report-count">{events.length} {events.length === 1 ? 'event' : 'events'}</span></summary>
        <div className="fi-match-events fi-match-events--report" role="region" aria-label="Completed match events">
          {events.length ? <MatchEvents events={events} /> : <p className="fi-match-wait">No match events recorded.</p>}
        </div>
      </details>}
    </section>
  );
}
