// Owner: WP-LEDGER (see PLAN.md §4). Chronicle match history: kind chips, team filter, result list and the report.
// Contract (DEC D16, ported Sidebar History tests): select#history-team, .fi-history-list button[data-history-id]
// [aria-pressed], the archived full MatchCard inside .fi-history, copy "No matches for this team yet.".
// Board 06 chips (All matches / Your matches / Upsets / Signings) are an extra, component-local filter on top of the
// team select: ChronicleScreen owns their state and passes `kinds`, `kind` and `onKind`.
import React, { useCallback, useMemo, useRef } from 'react';
import MatchCard from '../../components/MatchCard.jsx';
import Pager from '../../components/Pager.jsx';
import { usePagedList } from '../../hooks/useFit.js';
import { historyRow } from '../../viewModels/ledger.js';
import { historyRound, roman } from '../../viewModels/format.js';

const KIND_EMPTY = {
  upsets: 'No upsets yet.',
  signings: 'No signings yet.',
};

function emptyCopy(entries, teamShown, kind, managedId) {
  if (!entries.length) return 'No matches yet.';
  if (!teamShown.length) return 'No matches for this team yet.';
  if (kind === 'mine') return managedId != null ? 'No matches for your team yet.' : 'No matches for the followed team yet.';
  return KIND_EMPTY[kind] || 'No matches for this team yet.';
}

// Memoised: history entries are never edited once recorded and HistoryBrowser's handler is stable, so a render
// touches only the new entry and the rows whose pressed state flips.
const HistoryItem = React.memo(function HistoryItem({ entry, pressed, managedId, followedId, onSelect }) {
  const row = historyRow(entry, { managedId, followedId });
  const score = `${row.a.code || row.a.name} ${row.a.score}–${row.b.score} ${row.b.code || row.b.name}`;
  const meta = [score + (row.tie ? ` (${row.tie})` : ''), row.claim].filter(Boolean).join(' · ');
  return (
    <li>
      <button type="button" data-history-id={entry.id} aria-pressed={pressed} onClick={() => onSelect(entry.id)}
        className={row.mine || row.followed ? 'is-mine' : undefined}>
        <span className="fi-history-round"><span className="sr-only">Round </span>{row.roman || '—'}</span>
        <span className="fi-history-body">
          <span className="fi-history-title" title={meta}>{row.title || `${row.a.name} v ${row.b.name}`}</span>
          <span className="fi-history-meta">{meta}</span>
        </span>
        <span className="fi-history-tags">
          {row.mine && <span className="fi-history-tag is-you">You</span>}
          {row.followed && <span className="fi-history-tag is-you">Followed</span>}
          {row.upset && <span className="fi-history-tag is-upset">Upset</span>}
        </span>
      </button>
    </li>
  );
});

export default function HistoryBrowser({
  entries = [], shown = [], teamShown = shown, teams = [], report = null, filter = '', managedId = null, followedId = null,
  kinds = [], kind = 'all', onKind, onFilter, onSelect, onViewConquest, onSelectTeam, measureKey = null,
}) {
  // One handler for every row, calling the latest onSelect (ChronicleScreen passes a new one per render).
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const selectRow = useCallback(id => selectRef.current?.(id), []);
  const newestFirst = useMemo(() => shown.slice().reverse(), [shown]);
  // `measureKey` (the Chronicle's panel) measures the list again in the commit that shows it.
  const paged = usePagedList(newestFirst, { row: '.fi-history-list > li', focusIndex: newestFirst.findIndex(entry => entry.id === report?.id), measureKey });
  return (
    <section className="fi-history" aria-label="Match history">
      <div className="fi-history__index">
        <div className="kicker">
          <h2 className="kicker__title">Match history</h2>
          <Pager page={paged.page} pages={paged.pages} onPage={paged.setPage} label="Match history pages" />
          <span className="kicker__aside">{shown.length} {shown.length === 1 ? 'match' : 'matches'}</span>
        </div>
        <div className="fi-history-controls">
          {kinds.length > 1 && entries.length > 0 && (
            <div className="segmented fi-history-kinds" role="group" aria-label="Show">
              {kinds.map(option => (
                <button key={option.id} type="button" aria-pressed={option.id === kind} onClick={() => onKind?.(option.id)}>
                  {option.label}
                </button>
              ))}
            </div>
          )}
          <label className="fi-history-filter" htmlFor="history-team">
            <span className="sr-only">Filter by team</span>
            <select id="history-team" value={filter} onChange={event => onFilter?.(event.target.value)}>
              <option value="">All teams</option>
              {teams.map(team => <option key={team.id || team.tid} value={team.id || team.tid}>{team.name}</option>)}
            </select>
          </label>
        </div>
        {!shown.length
          ? <p className="fi-history-empty">{emptyCopy(entries, teamShown, kind, managedId)}</p>
          : (
            <div className="fi-history-box" ref={paged.boxRef}>
              <ol className="fi-history-list">
                {paged.shown.map((entry, i) => (
                  <HistoryItem key={entry.id ?? i} entry={entry} pressed={report?.id === entry.id}
                    managedId={managedId} followedId={followedId} onSelect={selectRow} />
                ))}
              </ol>
            </div>
          )}
      </div>
      {report && (
        <div className="fi-history__report">
          {/* The archived heading reads "Round XIV" like every other round in the UI (MatchCard prints `round` as given). */}
          <MatchCard {...report} round={roman(historyRound(report)) || report.round} archived
            onViewConquest={onViewConquest} onSelectTeam={onSelectTeam} />
        </div>
      )}
    </section>
  );
}
