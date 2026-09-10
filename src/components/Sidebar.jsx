import React from 'react';
import MatchCard, { TeamMark } from './MatchCard.jsx';
import PlayerRow from './PlayerRow.jsx';
import Icon from './Icon.jsx';
import './results.css';

const TABS = [['power', 'Standings'], ['feed', 'Activity'], ['squad', 'Squad']];

function gainColor(gain) {
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

function Power({ rows = [], onSelect }) {
  return (
    <table className="fi-standings">
      <thead><tr><th scope="col">#</th><th scope="col">Team</th><th scope="col"><abbr title="Territories held">Terr.</abbr></th><th scope="col" aria-sort="descending"><abbr title="Overall team strength (EFF), highest first">Strength</abbr></th></tr></thead>
      <tbody>{rows.map(team => (
        <tr key={team.tid}>
          <td>{Number(team.rank) || team.rank}</td>
          <td><button type="button" className="fi-standing-team" onClick={() => onSelect(team.tid)} aria-label={`View ${team.name} squad`}>
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

function Squad({ squad, positionColors }) {
  if (!squad) return <div className="fi-intel-empty"><Icon name="users" size={25} /><p>Select a team on the map or in the standings to inspect its squad.</p></div>;
  return (
    <section className="fi-squad" aria-label={`${squad.name} squad`}>
      <div className="fi-squad-heading">
        <TeamMark {...squad} width={40} />
        <div><h3>{squad.name}</h3><p>{squad.meta}</p></div>
        <div className="fi-squad-strength"><strong>{squad.eff}</strong><span>EFF</span><small style={{ color: gainColor(squad.effGain) }}>{squad.effGain.text}</small></div>
      </div>
      <div className="fi-squad-summary">
        <span><strong>{squad.territories}</strong> {Number(squad.territories) === 1 ? 'territory' : 'territories'}</span><span><strong>{squad.conquests}</strong> {Number(squad.conquests) === 1 ? 'conquest' : 'conquests'}</span><span><strong>{squad.stolen}</strong> claimed</span>
      </div>
      <div className="fi-squad-roster-heading"><span>{squad.players.length} players · Avg. {squad.avg} <small style={{ color: gainColor(squad.avgGain) }}>{squad.avgGain.text}</small></span><span style={{ color: `var(--result-${squad.status === 'ALIVE' ? 'positive' : 'negative'}, ${squad.statusColor})` }}>{squad.status}</span></div>
      <div className="fi-player-list">{squad.players.map((player, i) => <PlayerRow key={i} player={player} positionColors={positionColors} />)}</div>
      {squad.players.some(player => player.gen) && <p className="fi-roster-note">* Generated player where roster data is unavailable.</p>}
    </section>
  );
}

/** One quiet information surface: latest match, then standings, activity or squad. */
export default function Sidebar({ match, draw, idleText, queueLeft, tab = 'power', onTab, feed, power, squad, positionColors, onSelectTeam, eventsRef }) {
  return (
    <aside className="fi-intel" aria-label="Campaign details">
      {match ? <MatchCard {...match} eventsRef={eventsRef} /> : draw ? (
        <section className="fi-match fi-match-empty fi-match-draw" data-testid="draw-status" role="status" aria-live="polite" aria-atomic="true">
          <div className="fi-match-heading"><h2>Latest match</h2><span className="fi-match-status">{draw.stage === 'locked' ? 'Opponent selected' : 'Drawing'}</span></div>
          <h3>{draw.stage === 'locked' ? `${draw.attackerName} faces ${draw.targetName}` : `${draw.attackerName} to attack`}</h3>
          <p>{draw.stage === 'locked' ? draw.isNeighbor ? 'Land-border opponent selected.' : 'Overseas opponent selected.' : 'Drawing a direction and finding an opponent.'}</p>
        </section>
      ) : (
        <section className="fi-match fi-match-empty"><div className="fi-match-heading"><h2>Latest match</h2><span className="fi-match-status">Ready</span></div>
          <h3>No match in progress</h3><p>{idleText || 'Choose Next match to draw the next fixture.'}</p>
        </section>
      )}
      {queueLeft > 0 && <p className="fi-queue-note">{queueLeft} {queueLeft === 1 ? 'match' : 'matches'} remaining this round</p>}
      <Tabs value={tab} onChange={onTab} />
      <div className={`fi-intel-content fi-intel-content--${tab}`} role="tabpanel" id={`intel-panel-${tab}`} aria-labelledby={`intel-tab-${tab}`} tabIndex={0}>
        {tab === 'feed' && <Feed entries={feed} />}
        {tab === 'power' && <Power rows={power} onSelect={onSelectTeam} />}
        {tab === 'squad' && <Squad squad={squad} positionColors={positionColors} />}
      </div>
      {tab === 'power' && <p className="fi-intel-hint"><Icon name="info" size={17} /><span>Select a team to view its squad.</span></p>}
    </aside>
  );
}
