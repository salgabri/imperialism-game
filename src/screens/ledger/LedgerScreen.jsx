// Owner: WP-LEDGER (see PLAN.md §4). Ledger view (DEC D16): standings in the v4 table pattern with Conq./Claimed
// columns, share of the map and the fallen empires. Model: buildLedger(st, ctx, powerRows) (src/viewModels/ledger.js).
// Compact pass (docs/design/compact-pass.md): the standings show the rows that fit and page through the rest, opening on
// your team's page. Below 1200px the map share and the fallen take a panel each behind the segmented control.
import React, { useCallback, useRef, useState } from 'react';
import LedgerHead from './LedgerHead.jsx';
import StandingsTable from './StandingsTable.jsx';
import { FallenList, MapShare } from './LedgerSide.jsx';
import AdSlot from '../../components/AdSlot.jsx';
import Pager from '../../components/Pager.jsx';
import { usePagedList } from '../../hooks/useFit.js';
import './ledger.css';

const PANELS = [['standings', 'Standings'], ['share', 'Map share'], ['fallen', 'Fallen']];

export default function LedgerScreen({
  rows = [], fallen = null, session = null, share = null, header = null, youId = null, youLabel,
  standingsAside = '', fallenAside = '', selectedTeamId = null, onSelectTeam,
}) {
  const aside = standingsAside || `${rows.length} ${rows.length === 1 ? 'empire' : 'empires'}`;
  const [panel, setPanel] = useState('standings');
  // One handler calling the latest onSelectTeam (App passes a new one per render), so the memoised standings table
  // and fallen list are skipped while their rows are unchanged.
  const selectRef = useRef(onSelectTeam);
  selectRef.current = onSelectTeam;
  const selectTeam = useCallback(id => selectRef.current?.(id), []);
  const focusIndex = rows.findIndex(team => team.you || (youId != null && team.tid === youId));
  const paged = usePagedList(rows, { row: 'tbody tr', focusIndex });
  return (
    <section id="view-panel-ledger" className="screen screen--ledger" aria-labelledby="view-tab-ledger" tabIndex={-1} data-panel={panel}>
      <div className="ledger">
        <LedgerHead titleId="ledger-title" kicker={header?.kicker} title={header?.title || 'Ledger'} stats={header?.stats || []} />
        <div className="segmented ledger-panels" role="group" aria-label="Ledger panels">
          {PANELS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={panel === id} onClick={() => setPanel(id)}>{label}</button>
          ))}
        </div>
        <div className="ledger-body">
          <section className="ledger-main" aria-labelledby="ledger-standings-title">
            <div className="kicker">
              <h2 className="kicker__title" id="ledger-standings-title">Standings</h2>
              <Pager page={paged.page} pages={paged.pages} onPage={paged.setPage} label="Standings pages" />
              {session
                ? <span className="kicker__aside" data-testid="session-remaining" role="status">{session}</span>
                : <span className="kicker__aside">{aside}</span>}
            </div>
            <div className="ledger-table" ref={paged.boxRef}>
              <StandingsTable rows={paged.shown} selectedTeamId={selectedTeamId} youLabel={youLabel || (youId ? 'You' : '')} onSelectTeam={selectTeam} />
            </div>
          </section>
          <aside className="ledger-side" aria-label="Map share and fallen empires">
            <MapShare share={share} />
            {/* The ad follows the bounded share list, never the fallen list that grows all campaign. */}
            <AdSlot />
            {/* Without a built model (W1 stub { rows }) the fallen list is omitted rather than claiming none have fallen. */}
            {Array.isArray(fallen) && <FallenList fallen={fallen} aside={fallenAside} onSelectTeam={selectTeam} />}
          </aside>
        </div>
      </div>
    </section>
  );
}
