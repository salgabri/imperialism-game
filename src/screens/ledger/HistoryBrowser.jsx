// Owner: WP-LEDGER (see PLAN.md §4). Chronicle match history: kind chips, team filter, result list and the report.
// Contract (DEC D16, ported Sidebar History tests): select#history-team, .fi-history-list button[data-history-id]
// [aria-pressed], the archived full MatchCard inside .fi-history, copy "No matches for this team yet.".
// Board 06 chips (All matches / Your matches / Upsets / Signings) are an extra, component-local filter on top of the
// team select: ChronicleScreen owns their state and passes `kinds`, `kind` and `onKind`.
import React from 'react';
import MatchCard from '../../components/MatchCard.jsx';
import { historyRow } from '../../viewModels/ledger.js';
import { historyRound, roman } from '../../viewModels/format.js';

const KIND_EMPTY = {
  upsets: 'No upsets yet.',
  signings: 'No signings yet.',
};

function emptyCopy(entries, teamShown, kind, managedId) {
  if (!entries.length) return 'Completed matches will be saved here, including events and spoils.';
  if (!teamShown.length) return 'No matches for this team yet.';
  if (kind === 'mine') return managedId != null ? 'No matches for your team yet.' : 'No matches for the followed team yet.';
  return KIND_EMPTY[kind] || 'No matches for this team yet.';
}

function HistoryItem({ entry, pressed, managedId, followedId, onSelect }) {
  const row = historyRow(entry, { managedId, followedId });
  const score = `${row.a.code || row.a.name} ${row.a.score}–${row.b.score} ${row.b.code || row.b.name}`;
  const meta = [score + (row.tie ? ` (${row.tie})` : ''), row.claim].filter(Boolean).join(' · ');
  return (
    <li>
      <button type="button" data-history-id={entry.id} aria-pressed={pressed} onClick={() => onSelect(entry.id)}
        className={row.mine || row.followed ? 'is-mine' : undefined}>
        <span className="fi-history-round"><span className="sr-only">Round </span>{row.roman || '—'}</span>
        <span className="fi-history-body">
          <span className="fi-history-title">{row.title || `${row.a.name} v ${row.b.name}`}</span>
          <span className="fi-history-meta">{meta}</span>
        </span>
        <span className="fi-history-tags">
          {row.mine && <span className="fi-history-tag is-you">Your match</span>}
          {row.followed && <span className="fi-history-tag is-you">Followed</span>}
          {row.upset && <span className="fi-history-tag is-upset">Upset</span>}
        </span>
      </button>
    </li>
  );
}

export default function HistoryBrowser({
  entries = [], shown = [], teamShown = shown, teams = [], report = null, filter = '', managedId = null, followedId = null,
  kinds = [], kind = 'all', onKind, onFilter, onSelect, onViewConquest, onSelectTeam,
}) {
  const reportRow = report ? historyRow(report) : null;
  return (
    <section className="fi-history" aria-label="Match history">
      <div className="fi-history__index">
        <div className="kicker">
          <h2 className="kicker__title">Match history</h2>
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
            <span>Filter by team</span>
            <select id="history-team" value={filter} onChange={event => onFilter?.(event.target.value)}>
              <option value="">All teams</option>
              {teams.map(team => <option key={team.id || team.tid} value={team.id || team.tid}>{team.name}</option>)}
            </select>
          </label>
        </div>
        {!shown.length
          ? <p className="fi-history-empty">{emptyCopy(entries, teamShown, kind, managedId)}</p>
          : (
            <ol className="fi-history-list">
              {shown.slice().reverse().map((entry, i) => (
                <HistoryItem key={entry.id ?? i} entry={entry} pressed={report?.id === entry.id}
                  managedId={managedId} followedId={followedId} onSelect={id => onSelect?.(id)} />
              ))}
            </ol>
          )}
      </div>
      {report && (
        <div className="fi-history__report">
          {/* "Result", not "Match report": the archived MatchCard below has its own "Match report" disclosure. */}
          <div className="kicker">
            <h2 className="kicker__title">Result</h2>
            {reportRow?.title && <span className="kicker__aside">{reportRow.title}</span>}
          </div>
          {/* The archived heading reads "Round XIV" like every other round in the UI (MatchCard prints `round` as given). */}
          <MatchCard {...report} round={roman(historyRound(report)) || report.round} archived
            onViewConquest={onViewConquest} onSelectTeam={onSelectTeam} />
        </div>
      )}
    </section>
  );
}
