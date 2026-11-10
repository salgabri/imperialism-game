// Owner: WP-MATCH (see PLAN.md §4). The Match view (boards B1/B2, A-3): score header, win-probability chart,
// both XIs and the dark match feed. Model from buildLiveMatch(st, ctx) (src/viewModels/match.js) + the FROZEN
// render props (minuteStore, speed, paused, onSpeed, onPause, onSelectTeam). The live minute is read from the
// store by the parts that show it (DEC D7), so the tables do not re-render per minute. No timers.
// Compact pass (docs/design/compact-pass.md): the chart fills the screen, with the lineups a switch away (above 700px;
// the phone has its own segments). The two XIs show the rows that fit and page together: American football fields 23.
import React from 'react';
import MatchCard from '../../components/MatchCard.jsx';
import ScoreHeader from './ScoreHeader.jsx';
import WinChart from './WinChart.jsx';
import XiTable from './XiTable.jsx';
import MatchFeed from './MatchFeed.jsx';
import MatchStats from './MatchStats.jsx';
import Pager from '../../components/Pager.jsx';
import { usePagedList } from '../../hooks/useFit.js';
import './match.css';

const NO_ROWS = [];

const SEGMENTS = [['feed', 'Feed'], ['lineups', 'Lineups'], ['stats', 'Stats']];
const MAIN_VIEWS = [['chart', 'Chart'], ['lineups', 'Lineups']];

function Shell({ children, state = 'empty', segment = 'feed', mainView = 'chart' }) {
  return (
    <section id="view-panel-match" className="screen screen--match" aria-labelledby="view-tab-match" tabIndex={-1}
      data-state={state} data-segment={segment} data-main={mainView}>
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
  const [mainView, setMainView] = React.useState('chart');
  // The Chart / Lineups switch and the phone's segments hide and show the lineups and the chart: each switch measures
  // them again in the commit that shows them, rather than a frame later when their ResizeObserver reports.
  const measureKey = `${mainView} ${segment}`;
  const rowsA = lineups?.a?.rows || NO_ROWS, rowsB = lineups?.b?.rows || NO_ROWS;
  const xi = usePagedList(rowsA.length >= rowsB.length ? rowsA : rowsB, { row: '.match-xi__row', measureKey });
  const page = rows => (Number.isFinite(xi.pageSize) ? rows.slice(xi.start, xi.start + xi.pageSize) : rows);

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
    <Shell state={state} segment={segment} mainView={mainView}>
      <ScoreHeader a={a} b={b} sport={sport} statusLabel={statusLabel} statusDetail={statusDetail} kicks={kicks} {...minuteProps} />
      <div className="segmented match-segments" role="group" aria-label="Match details">
        {SEGMENTS.map(([id, label]) => (
          <button key={id} type="button" className="match-segments__item" aria-pressed={segment === id}
            onClick={() => setSegment(id)}>{label}</button>
        ))}
      </div>
      <div className="match-body">
        <div className="match-main">
          <div className="segmented match-views" role="group" aria-label="Match view">
            {MAIN_VIEWS.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={mainView === id} onClick={() => setMainView(id)}>{label}</button>
            ))}
          </div>
          <WinChart sport={sport} model={model} goals={goals} perspective={perspective} final={final} length={length} ot={ot}
            chartNote={chartNote} aId={a.teamId} dId={b.teamId} measureKey={measureKey} {...minuteProps} />
          <MatchStats sport={sport} preMatch={preMatch} speed={speed} paused={paused} onSpeed={onSpeed} onPause={onPause} />
          <div className="match-lineups" ref={xi.boxRef} data-long={rowsA.length > 13 ? '' : undefined}>
            <Pager page={xi.page} pages={xi.pages} onPage={xi.setPage} label="Lineup pages" className="match-lineups__pager" />
            <XiTable {...(lineups?.a || {})} rows={page(rowsA)} onSelectTeam={onSelectTeam} />
            <XiTable {...(lineups?.b || {})} rows={page(rowsB)} onSelectTeam={onSelectTeam} />
          </div>
        </div>
        <MatchFeed model={props} speed={speed} paused={paused} onSpeed={onSpeed} onPause={onPause} {...minuteProps} />
      </div>
    </Shell>
  );
}
