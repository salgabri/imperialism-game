// Owner: WP-MATCH (see PLAN.md §4). The Match view (boards B1/B2, A-3): score header, win-probability chart,
// both XIs and the dark match feed. Model from buildLiveMatch(st, ctx) (src/viewModels/match.js) + the FROZEN
// render props (minuteStore, speed, paused, onSpeed, onPause, onSelectTeam). The live minute is read from the
// store by the parts that show it (DEC D7), so the tables do not re-render per minute. No timers.
import React from 'react';
import MatchCard from '../../components/MatchCard.jsx';
import ScoreHeader from './ScoreHeader.jsx';
import WinChart from './WinChart.jsx';
import XiTable from './XiTable.jsx';
import MatchFeed from './MatchFeed.jsx';
import MatchStats from './MatchStats.jsx';
import './match.css';

const SEGMENTS = [['feed', 'Feed'], ['lineups', 'Lineups'], ['stats', 'Stats']];

function Shell({ children, state = 'empty', segment = 'feed' }) {
  return (
    <section id="view-panel-match" className="screen screen--match" aria-labelledby="view-tab-match" tabIndex={-1}
      data-state={state} data-segment={segment}>
      {children}
    </section>
  );
}

export default function MatchScreen(props) {
  const {
    empty = null, card = null, state = null, sport = 'football', statusLabel = '', statusDetail = null, live = false,
    a = null, b = null, minuteFallback = 0, minuteFloor = 0, length = 90, ot = 0, perspective = null, model = null,
    goals = [], final = null, chartNote = null, lineups = null, kicks = null, preMatch = null,
    minuteStore = null, speed = 1, paused = false, onSpeed, onPause, onSelectTeam,
  } = props;
  const [segment, setSegment] = React.useState('feed');

  if (!a || !b || !state) {
    // Before the App wiring pass the delegate may still hand over the legacy `card`; keep it readable.
    if (card) {
      return (
        <Shell state="legacy">
          <div className="match-screen__legacy"><MatchCard {...card} onSelectTeam={onSelectTeam} /></div>
        </Shell>
      );
    }
    return (
      <Shell state="empty">
        <div className="match-screen__empty">
          <p className="kicker match-screen__kicker"><span className="kicker__title">Match day</span></p>
          <h1 className="match-screen__empty-title">{empty?.title || 'No match yet'}</h1>
          {empty?.text && <p className="match-screen__empty-text">{empty.text}</p>}
        </div>
      </Shell>
    );
  }

  const minuteProps = { live, minuteStore, minuteFallback, minuteFloor };
  return (
    <Shell state={state} segment={segment}>
      <ScoreHeader a={a} b={b} statusLabel={statusLabel} statusDetail={statusDetail} kicks={kicks} {...minuteProps} />
      <div className="segmented match-segments" role="group" aria-label="Match details">
        {SEGMENTS.map(([id, label]) => (
          <button key={id} type="button" className="match-segments__item" aria-pressed={segment === id}
            onClick={() => setSegment(id)}>{label}</button>
        ))}
      </div>
      <div className="match-body">
        <div className="match-main">
          <WinChart sport={sport} model={model} goals={goals} perspective={perspective} final={final} length={length} ot={ot}
            chartNote={chartNote} aId={a.teamId} dId={b.teamId} {...minuteProps} />
          <MatchStats preMatch={preMatch} speed={speed} paused={paused} onSpeed={onSpeed} onPause={onPause} />
          <div className="match-lineups">
            <XiTable {...(lineups?.a || {})} onSelectTeam={onSelectTeam} />
            <XiTable {...(lineups?.b || {})} onSelectTeam={onSelectTeam} />
          </div>
        </div>
        <MatchFeed model={props} speed={speed} paused={paused} onSpeed={onSpeed} onPause={onPause} {...minuteProps} />
      </div>
    </Shell>
  );
}
