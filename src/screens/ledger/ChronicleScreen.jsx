// Owner: WP-LEDGER (see PLAN.md §4). Chronicle view (DEC D16): match history browser + archived MatchCard (full
// variant) + turning points + activity feed. Model: buildChronicle(st, ctx) (src/viewModels/ledger.js).
// Filter and selection are controlled by App (historyFilter / selectedHistory, persisted); when a caller omits
// them the screen keeps its own local state (ported Sidebar behaviour). The board 06 kind chips are local state.
import React, { useState } from 'react';
import LedgerHead from './LedgerHead.jsx';
import HistoryBrowser from './HistoryBrowser.jsx';
import { ActivityFeed, TurningPoints } from './ChronicleSide.jsx';
import { inHistoryFilter, inHistoryKind } from '../../viewModels/ledger.js';
import './ledger.css';

function kindOptions(managedId, followedId) {
  const mine = managedId != null ? { id: 'mine', label: 'Your matches' }
    : followedId != null ? { id: 'mine', label: 'Followed team' } : null;
  return [{ id: 'all', label: 'All matches' }, mine, { id: 'upsets', label: 'Upsets' }, { id: 'signings', label: 'Signings' }]
    .filter(Boolean);
}

export default function ChronicleScreen({
  history = [], historyTeams = [], feed = [], turning = [], header = null, managedId = null, followedId = null,
  selectedHistory = null, historyFilter, onHistorySelect, onHistoryFilter, onViewConquest, onSelectTeam,
}) {
  const [localFilter, setLocalFilter] = useState('');
  const [localSelection, setLocalSelection] = useState(null);
  const [localKind, setLocalKind] = useState('all');
  const filter = historyFilter ?? localFilter;
  const kinds = kindOptions(managedId, followedId);
  const kind = kinds.some(option => option.id === localKind) ? localKind : 'all';
  const ids = { managedId, followedId };
  const selection = selectedHistory || history.find(entry => entry.id === localSelection) || null;
  const teamShown = history.filter(entry => inHistoryFilter(entry, filter));
  const shown = kind === 'all' ? teamShown : teamShown.filter(entry => inHistoryKind(entry, kind, ids));
  const report = shown.find(entry => entry.id === selection?.id) || shown[shown.length - 1] || null;

  function select(id) {
    setLocalSelection(id);
    onHistorySelect?.(id);
  }
  function changeFilter(value) {
    setLocalFilter(value);
    onHistoryFilter?.(value);
    const newest = history.filter(entry => inHistoryFilter(entry, value));
    select(newest[newest.length - 1]?.id ?? null);
  }

  return (
    <section id="view-panel-chronicle" className="screen screen--chronicle" aria-labelledby="view-tab-chronicle" tabIndex={-1}>
      <div className="chronicle">
        <LedgerHead titleId="chronicle-title" kicker={header?.kicker} title={header?.title || 'Chronicle'} stats={header?.stats || []} />
        <div className="chronicle-body">
          <HistoryBrowser entries={history} shown={shown} teamShown={teamShown} teams={historyTeams} report={report}
            filter={filter || ''} managedId={managedId} followedId={followedId} kinds={kinds} kind={kind} onKind={setLocalKind}
            onFilter={changeFilter} onSelect={select} onViewConquest={onViewConquest} onSelectTeam={onSelectTeam} />
          <aside className="chronicle-side" aria-label="Turning points and activity">
            <TurningPoints items={turning} />
            <ActivityFeed entries={feed} />
          </aside>
        </div>
      </div>
    </section>
  );
}
