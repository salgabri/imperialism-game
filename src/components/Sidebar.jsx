import React, { useEffect, useRef, useState } from 'react';
import MatchCard, { TeamMark } from './MatchCard.jsx';
import PlayerRow from './PlayerRow.jsx';
import Icon from './Icon.jsx';
import './results.css';

const TABS = [['power', 'Standings'], ['feed', 'Activity'], ['squad', 'Squad'], ['history', 'History']];

function gainColor(gain) {
  if (!gain) return 'var(--result-muted)';
  const tone = gain.text.startsWith('+') ? 'positive' : /^[−-]/.test(gain.text) ? 'negative' : 'muted';
  return `var(--result-${tone}, ${gain.color})`;
}

function Tabs({ value, onChange }) {
  function onKeyDown(event, current) {
    let next;
    if (event.key === 'ArrowRight') next = (current + 1) % TABS.length;
    if (event.key === 'ArrowLeft') next = (current + TABS.length - 1) % TABS.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = TABS.length - 1;
    if (next == null) return;
    event.preventDefault();
    onChange(TABS[next][0]);
    event.currentTarget.parentElement.children[next].focus();
  }
  return (
    <div className="fi-intel-tabs" role="tablist" aria-label="Campaign information">
      {TABS.map(([id, label], i) => (
        <button key={id} id={`intel-tab-${id}`} type="button" role="tab" aria-selected={value === id} aria-controls={`intel-panel-${id}`}
          tabIndex={value === id ? 0 : -1} onClick={() => onChange(id)} onKeyDown={event => onKeyDown(event, i)}>{label}</button>
      ))}
    </div>
  );
}

function Feed({ entries = [] }) {
  if (!entries.length) return <p className="fi-intel-empty">Match results and player transfers will appear here.</p>;
  return (
    <ol className="fi-activity-list" aria-label="Campaign activity">
      {entries.map((entry, i) => (
        <li key={i}>
          <span className="fi-activity-round" title="Round">{entry.round}</span>
          <i style={{ '--activity-color': entry.chip }} aria-hidden="true" />
          <span>{entry.text}</span>
        </li>
      ))}
    </ol>
  );
}

function Power({ rows = [], onSelect, selectedTeamId }) {
  return (
    <table className="fi-standings">
      <thead><tr><th scope="col">#</th><th scope="col">Team</th><th scope="col"><abbr title="Territories held">Terr.</abbr></th><th scope="col" aria-sort="descending"><abbr title="Overall team strength (EFF), highest first">Strength</abbr></th></tr></thead>
      <tbody>{rows.map(team => (
        <tr key={team.tid} className={selectedTeamId === team.tid ? 'is-selected' : undefined} style={{ '--team-color': team.color }}>
          <td>{Number(team.rank) || team.rank}</td>
          <td><button type="button" className="fi-standing-team" data-team-id={team.tid} onClick={() => onSelect?.(team.tid)} aria-label={`View ${team.name} squad`} aria-current={selectedTeamId === team.tid ? 'true' : undefined}>
            <TeamMark id={team.flagId} code={team.code} color={team.color} isClub={team.isClub} width={20} />
            <span title={team.name}>{team.name}</span>
          </button></td>
          <td>{String(team.territories).replace(/^T(?=\d)/, '')}</td>
          <td title={team.effGain ? `Change since campaign start: ${team.effGain.text}` : undefined}>
            <span className="fi-standing-rating">
              <span className="fi-standing-eff">{team.eff}</span>
              {team.effGain?.text?.startsWith('+') && <span key={team.effGain.text} className="fi-strength-gain" data-testid="standing-strength-gain"
                aria-label={`Gained ${team.effGain.text} overall strength since campaign start`}>{team.effGain.text}</span>}
            </span>
          </td>
        </tr>
      ))}</tbody>
    </table>
  );
}

const POSITION_GROUPS = {
  GK: 'Goalkeepers', DF: 'Defenders', MF: 'Midfielders', FW: 'Forwards',
  PG: 'Point guards', SG: 'Shooting guards', SF: 'Small forwards', PF: 'Power forwards', C: 'Centers',
};

function PositionGroups({ players = [], positionColors, starter = false, depth = false }) {
  const grouped = new Map();
  players.forEach(player => {
    const position = starter ? player.assignedPos || player.pos : player.pos;
    if (!grouped.has(position)) grouped.set(position, []);
    grouped.get(position).push(player);
  });
  const ordered = [...Object.keys(POSITION_GROUPS), ...grouped.keys()].filter((position, i, positions) => positions.indexOf(position) === i && grouped.has(position));
  return ordered.map(position => <section className="fi-position-group" aria-label={POSITION_GROUPS[position] || position} key={position}>
    <div className="fi-position-group-heading"><h5>{POSITION_GROUPS[position] || position}</h5><span>{grouped.get(position).length}</span></div>
    <div className="fi-player-list">{grouped.get(position).map((player, i) => <PlayerRow key={player.originalIndex ?? `${player.name}-${player.pos}-${player.from || ''}-${i}`} player={player} positionColors={positionColors} role={starter ? 'starter' : depth ? 'depth' : undefined} />)}</div>
  </section>);
}

function LatestAcquisition({ squad, history = [] }) {
  const latest = history.slice().reverse().find(entry => entry.winnerId === squad.teamId && entry.result?.player);
  if (!latest) return null;
  const { player, strengthBefore, strengthAfter, strengthGain, replacedPlayer } = latest.result;
  const previousTeam = latest.aId === squad.teamId ? latest.b : latest.a;
  const currentPlayer = squad.players.find(member => member.name === player.name && member.pos === player.pos && member.rating === player.rating && member.from === previousTeam?.code);
  const starts = currentPlayer && squad.starters?.some(member => member.name === currentPlayer.name && member.pos === currentPlayer.pos && member.from === currentPlayer.from);
  return <section className="fi-acquisition-spotlight" aria-label="Latest acquisition">
    <div className="fi-acquisition-heading"><span>Latest acquisition</span><span>Round {Number(latest.round) || latest.round}</span></div>
    <div className="fi-acquisition-player"><Icon name="users" size={18} /><div><strong>{player.name}</strong><p>{player.pos} · {player.rating} rating{previousTeam?.name ? ` · From ${previousTeam.name}` : ''}</p></div></div>
    {currentPlayer && <p className="fi-acquisition-role">{starts ? 'In the current starting lineup' : 'Available in squad depth'}</p>}
    {Number.isFinite(strengthGain) && <div className="fi-acquisition-impact"><span>Strength at acquisition{Number.isFinite(strengthBefore) && Number.isFinite(strengthAfter) && <small>{strengthBefore.toFixed(1)} → {strengthAfter.toFixed(1)}</small>}</span><strong className={strengthGain > 0 ? 'fi-strength-gain' : 'fi-strength-unchanged'}>{strengthGain > 0 ? `+${strengthGain.toFixed(1)}` : 'No change'}</strong></div>}
    {replacedPlayer && <p className="fi-acquisition-replaced">Replaced {typeof replacedPlayer === 'string' ? replacedPlayer : replacedPlayer.name} in the lineup at acquisition.</p>}
  </section>;
}

function Squad({ squad, positionColors, followed, onFollow, history, onBack, backLabel = 'Back to standings' }) {
  if (!squad) return <div className="fi-intel-empty"><Icon name="users" size={25} /><p>Select a team on the map or in the standings to inspect its squad.</p></div>;
  const expectedStarters = positionColors?.GK ? 11 : 5;
  return (
    <section className="fi-squad" aria-label={`${squad.name} squad`} style={{ '--team-color': squad.color }}>
      {onBack && <button type="button" className="fi-context-button fi-squad-back" onClick={onBack}><Icon name="arrow" size={16} />{backLabel}</button>}
      <div className="fi-squad-heading">
        <TeamMark {...squad} width={44} />
        <div className="fi-squad-identity"><span className="fi-squad-eyebrow">{squad.code} · {squad.isClub ? 'Club team' : 'National team'}</span><h3>{squad.name}</h3><p>{squad.meta}</p></div>
        <div className="fi-squad-strength"><strong>{squad.eff}</strong><span>Strength</span><small title="Change since campaign start" style={{ color: gainColor(squad.effGain) }}>{squad.effGain?.text}</small></div>
      </div>
      {onFollow && <button type="button" className="fi-context-button fi-follow-team" disabled={squad.status !== 'ALIVE'} aria-pressed={followed?.id === squad.teamId} onClick={() => onFollow(squad.teamId)}>{followed?.id === squad.teamId ? 'Following this team' : 'Follow this team'}</button>}
      <div className="fi-squad-summary">
        <span><strong>{squad.territories}</strong> {Number(squad.territories) === 1 ? 'territory' : 'territories'}</span><span><strong>{squad.conquests}</strong> {Number(squad.conquests) === 1 ? 'conquest' : 'conquests'}</span><span><strong>{squad.stolen}</strong> {Number(squad.stolen) === 1 ? 'acquisition' : 'acquisitions'}</span>
      </div>
      <LatestAcquisition squad={squad} history={history} />
      <div className="fi-squad-roster-heading"><span>{squad.players.length} players · Avg. {squad.avg} <small title="Squad average change since campaign start" style={{ color: gainColor(squad.avgGain) }}>{squad.avgGain?.text}</small></span><span className="fi-squad-status" style={{ color: `var(--result-${squad.status === 'ALIVE' ? 'positive' : 'negative'}, ${squad.statusColor})` }}>{squad.status === 'ALIVE' ? 'In contention' : squad.status?.replace('FALLEN R', 'Eliminated · R')}</span></div>
      {squad.starters ? <>
        <div className="fi-lineup-heading"><h4>Starting lineup</h4><span>{squad.starters.length} starters · rating {Number(squad.lineupRating).toFixed(1)}</span></div>
        <p className="fi-lineup-help">Strength uses these starters. Players outside their natural position receive a rating penalty.</p>
        <PositionGroups players={squad.starters} positionColors={positionColors} starter />
        <div className="fi-lineup-heading"><h4>Squad depth</h4><span>{squad.bench?.length || 0} players</span></div>
        <PositionGroups players={squad.bench || []} positionColors={positionColors} depth />
        {!squad.bench?.length && <p className="fi-lineup-help">No reserve players yet.</p>}
      </> : <PositionGroups players={squad.players} positionColors={positionColors} />}
      {squad.players.some(player => player.gen) && <p className="fi-roster-note">* Generated player where roster data is unavailable.</p>}
      {squad.starters && squad.starters.length < expectedStarters && !squad.players.some(player => player.gen)
        && <p className="fi-roster-note">Source data covers {squad.starters.length} of {expectedStarters} starting places. Unfilled places use a 40-point team-strength baseline.</p>}
    </section>
  );
}

function FollowedTeam({ followed, teams = [], onFollow, onPauseFollow }) {
  if (!onFollow) return null;
  return <section className="fi-followed" aria-label="Followed team">
    <div className="fi-followed-header"><strong>Following</strong><span className={followed?.alive === false ? 'is-fallen' : ''}>{followed?.id ? followed.alive === false ? 'Eliminated' : 'In contention' : 'Choose a favourite'}</span></div>
    <label className="sr-only" htmlFor="followed-team">Followed team</label>
    <select id="followed-team" value={followed?.id || ''} onChange={event => onFollow(event.target.value)}>
      <option value="">No followed team</option>
      {teams.map(team => <option key={team.id || team.tid} value={team.id || team.tid}>{team.name}{team.alive === false ? ' · eliminated' : ''}</option>)}
    </select>
    {onPauseFollow && <label className="control-checkbox"><input type="checkbox" checked={!!followed?.pauseOnEvents} onChange={event => onPauseFollow(event.target.checked)} /><span>Pause for this team's matches and major events</span></label>}
  </section>;
}

function belongsToHistoryFilter(entry, filter) {
  return !filter || String(entry.aId ?? entry.a?.teamId ?? entry.a?.id) === filter || String(entry.dId ?? entry.bId ?? entry.b?.teamId ?? entry.b?.id) === filter;
}

function History({ entries = [], teams = [], selected, filter = '', onFilter, onSelect, onViewConquest, onSelectTeam }) {
  const shown = entries.filter(entry => belongsToHistoryFilter(entry, filter));
  const report = shown.find(entry => entry.id === selected?.id) || shown.at(-1);
  return <section className="fi-history" aria-label="Match history">
    <label className="fi-history-filter" htmlFor="history-team"><span>Filter by team</span><select id="history-team" value={filter} onChange={event => onFilter?.(event.target.value)}><option value="">All teams</option>{teams.map(team => <option key={team.id || team.tid} value={team.id || team.tid}>{team.name}</option>)}</select></label>
    {!shown.length ? <p className="fi-intel-empty">{entries.length ? 'No matches for this team yet.' : 'Completed matches will be saved here, including events and spoils.'}</p> : <>
      <ol className="fi-history-list">{shown.slice().reverse().map((entry, i) => <li key={entry.id ?? i}><button type="button" data-history-id={entry.id} aria-pressed={report?.id === entry.id} onClick={() => onSelect?.(entry.id)}><span>R{Number(entry.round) || entry.round}</span><span>{entry.a?.name} <strong>{entry.a?.score}–{entry.b?.score}</strong> {entry.b?.name}</span></button></li>)}</ol>
      {report && <MatchCard {...report} archived onViewConquest={onViewConquest} onSelectTeam={onSelectTeam} />}
    </>}
  </section>;
}

/** One quiet information surface: latest match, then standings, activity or squad. */
export default function Sidebar({ match, draw, idleText, queueLeft, tab = 'power', onTab, feed, power, squad, positionColors, onSelectTeam, eventsRef,
  followed, managed, onFollow, onPauseFollow, history = [], historyTeams = [], onHistorySelect, selectedHistory, historyFilter, onHistoryFilter, onViewConquest, session, paused = false, selectedTeamId }) {
  const contentRef = useRef(null);
  const returnToStandingsRef = useRef(false);
  const squadOriginRef = useRef('power');
  const tabNavigationRef = useRef(false);
  const [localHistoryFilter, setLocalHistoryFilter] = useState('');
  const [localHistorySelection, setLocalHistorySelection] = useState(null);
  const filter = historyFilter ?? localHistoryFilter;
  const historySelection = selectedHistory || history.find(entry => entry.id === localHistorySelection);
  const inspectedTeamId = selectedTeamId ?? squad?.teamId;
  useEffect(() => {
    if (tab === 'squad' && squad?.teamId && !tabNavigationRef.current) contentRef.current?.focus();
    tabNavigationRef.current = false;
    if (tab === squadOriginRef.current && returnToStandingsRef.current) {
      returnToStandingsRef.current = false;
      const originButton = tab === 'history'
        ? [...(contentRef.current?.querySelectorAll('[data-history-id]') || [])].find(button => button.dataset.historyId === String(historySelection?.id))
        : [...(contentRef.current?.querySelectorAll('[data-team-id]') || [])].find(button => button.dataset.teamId === String(inspectedTeamId));
      (originButton || contentRef.current)?.focus();
    }
  }, [tab, squad?.teamId, inspectedTeamId, historySelection?.id]);
  function backToOrigin() {
    returnToStandingsRef.current = true;
    onTab?.(squadOriginRef.current);
  }
  function inspectTeam(id) {
    if (tab !== 'squad') squadOriginRef.current = tab === 'history' ? 'history' : 'power';
    onSelectTeam?.(id);
  }
  function selectHistory(id) {
    setLocalHistorySelection(id);
    onHistorySelect?.(id);
  }
  function changeHistoryFilter(value) {
    setLocalHistoryFilter(value);
    onHistoryFilter?.(value);
    selectHistory(history.filter(entry => belongsToHistoryFilter(entry, value)).at(-1)?.id ?? null);
  }
  return (
    <aside id="campaign-details" className="fi-intel" aria-label="Campaign details" tabIndex={-1}>
      {managed?.id && <section className="fi-followed" aria-label="Managed team">
        <div className="fi-followed-header"><strong>Your managed team</strong><span className={managed.alive === false ? 'is-fallen' : ''}>{managed.ended ? 'Now spectating' : managed.alive === false ? 'Eliminated' : 'In contention'}</span></div>
        {onSelectTeam ? <button type="button" className="fi-context-button" onClick={() => inspectTeam(managed.id)}>View {managed.name} squad</button> : <p>{managed.name}</p>}
      </section>}
      <FollowedTeam followed={followed} teams={historyTeams.length ? historyTeams : (power || []).map(team => ({ id: team.tid, name: team.name, alive: true }))} onFollow={onFollow} onPauseFollow={onPauseFollow} />
      {match ? <MatchCard {...match} eventsRef={eventsRef} onViewConquest={onViewConquest} onSelectTeam={onSelectTeam ? inspectTeam : undefined} /> : draw ? (
        <section className="fi-match fi-match-empty fi-match-draw" data-testid="draw-status" role="status" aria-live="polite" aria-atomic="true">
          <div className="fi-match-heading"><h2>Latest match</h2><span className="fi-match-status">{draw.stage === 'locked' ? 'Opponent selected' : 'Drawing'}</span></div>
          <h3>{draw.stage === 'locked' ? `${draw.attackerName} faces ${draw.targetName}` : `${draw.attackerName} to attack`}</h3>
          <p>{draw.stage === 'locked' ? draw.isNeighbor ? 'Land-border opponent selected.' : 'Overseas opponent selected.' : 'Drawing a direction and finding an opponent.'}</p>
          {draw.stage === 'locked' && draw.routeLabel && <p className="fi-route-explanation">{draw.routeLabel}{draw.routeKind === 'neutral-transit' ? ' · neutral land is crossed under a transit treaty.' : ''}</p>}
        </section>
      ) : (
        <section className="fi-match fi-match-empty"><div className="fi-match-heading"><h2>Latest match</h2><span className="fi-match-status">Ready</span></div>
          <h3>No match in progress</h3><p>{idleText || 'Choose Next match to draw the next fixture.'}</p>
        </section>
      )}
      {queueLeft > 0 && <p className="fi-queue-note">{queueLeft} {queueLeft === 1 ? 'match' : 'matches'} remaining this round</p>}
      {session && <p className="fi-session-remaining" data-testid="session-remaining" role="status">{session.games ? <>{session.upTo ? 'Up to ' : ''}{session.games} {Number(session.games) === 1 ? 'game' : 'games'} remaining · ~{Math.max(1, Math.ceil((session.seconds || 0) / 60))} min{paused ? ' · Paused' : ''}</> : 'Campaign complete'}</p>}
      <Tabs value={tab} onChange={value => {
        tabNavigationRef.current = true;
        if (value === 'squad' && tab !== 'squad') squadOriginRef.current = tab === 'history' ? 'history' : 'power';
        onTab?.(value);
      }} />
      <div ref={contentRef} className={`fi-intel-content fi-intel-content--${tab}`} role="tabpanel" id={`intel-panel-${tab}`} aria-labelledby={`intel-tab-${tab}`} tabIndex={0} onKeyDown={event => {
        if (tab === 'squad' && event.key === 'Escape' && onTab) { event.preventDefault(); backToOrigin(); }
      }}>
        {tab === 'feed' && <Feed entries={feed} />}
        {tab === 'power' && <Power rows={power} onSelect={onSelectTeam ? inspectTeam : undefined} selectedTeamId={inspectedTeamId} />}
        {tab === 'squad' && <Squad squad={squad} positionColors={positionColors} followed={followed} onFollow={onFollow} history={history} onBack={onTab ? backToOrigin : undefined} backLabel={squadOriginRef.current === 'history' ? 'Back to history' : 'Back to standings'} />}
        {tab === 'history' && <History entries={history} teams={historyTeams} selected={historySelection} filter={filter} onFilter={changeHistoryFilter} onSelect={selectHistory} onViewConquest={onViewConquest} onSelectTeam={onSelectTeam ? inspectTeam : undefined} />}
      </div>
      {tab === 'power' && <p className="fi-intel-hint"><Icon name="info" size={17} /><span>Select a team to view its squad.</span></p>}
    </aside>
  );
}
