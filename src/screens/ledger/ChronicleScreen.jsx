// Owner: WP-LEDGER (see PLAN.md §4). Chronicle view (DEC D16): match history browser + archived MatchCard (full
// variant) + turning points + activity feed. Model: buildChronicle(st, ctx) (src/viewModels/ledger.js).
// Filter and selection are controlled by App (historyFilter / selectedHistory, persisted); when a caller omits
// them the screen keeps its own local state (ported Sidebar behaviour). The board 06 kind chips are local state.
// Compact pass (docs/design/compact-pass.md): lists page, and below 1200px Matches, Result and Story take a panel each
// behind the segmented control; picking a match there opens its result.
import React, { useState } from 'react';
import LedgerHead from './LedgerHead.jsx';
import HistoryBrowser from './HistoryBrowser.jsx';
import { ActivityFeed, TurningPoints } from './ChronicleSide.jsx';
import AdSlot from '../../components/AdSlot.jsx';
import { inHistoryFilter, inHistoryKind } from '../../viewModels/ledger.js';
import './ledger.css';

const PANELS = [['matches', 'Matches'], ['result', 'Result'], ['story', 'Story']];

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
  const [panel, setPanel] = useState('matches');
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
    setPanel('result');
  }
  function changeFilter(value) {
    setLocalFilter(value);
    onHistoryFilter?.(value);
    const newest = history.filter(entry => inHistoryFilter(entry, value));
    setLocalSelection(newest[newest.length - 1]?.id ?? null);
    onHistorySelect?.(newest[newest.length - 1]?.id ?? null);
  }

  return (
    <section id="view-panel-chronicle" className="screen screen--chronicle" aria-labelledby="view-tab-chronicle" tabIndex={-1} data-panel={panel}>
      <div className="chronicle">
        <LedgerHead titleId="chronicle-title" kicker={header?.kicker} title={header?.title || 'Chronicle'} stats={header?.stats || []} />
        <div className="segmented ledger-panels" role="group" aria-label="Chronicle panels">
          {PANELS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={panel === id} onClick={() => setPanel(id)}>{label}</button>
          ))}
        </div>
        <div className="chronicle-body">
          <HistoryBrowser entries={history} shown={shown} teamShown={teamShown} teams={historyTeams} report={report}
            filter={filter || ''} managedId={managedId} followedId={followedId} kinds={kinds} kind={kind} onKind={setLocalKind}
            onFilter={changeFilter} onSelect={select} onViewConquest={onViewConquest} onSelectTeam={onSelectTeam} />
          <aside className="chronicle-side" aria-label="Turning points and activity">
            <TurningPoints items={turning} />
            {/* Above the activity feed, which runs to its cap: below it the ad would sit far out of view. */}
            <AdSlot />
            <ActivityFeed entries={feed} />
          </aside>
        </div>
      </div>
    </section>
  );
}
