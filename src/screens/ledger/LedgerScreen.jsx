// Owner: WP-LEDGER (see PLAN.md §4). Ledger view (DEC D16): standings in the v4 table pattern with Conq./Claimed
// columns, share of the map and the fallen empires. Model: buildLedger(st, ctx, powerRows) (src/viewModels/ledger.js).
import React, { useCallback, useRef } from 'react';
import LedgerHead from './LedgerHead.jsx';
import StandingsTable from './StandingsTable.jsx';
import { FallenList, MapShare } from './LedgerSide.jsx';
import AdSlot from '../../components/AdSlot.jsx';
import './ledger.css';

export default function LedgerScreen({
  rows = [], fallen = null, session = null, share = null, header = null, youId = null, youLabel,
  standingsAside = '', fallenAside = '', selectedTeamId = null, onSelectTeam,
}) {
  const aside = standingsAside || `${rows.length} ${rows.length === 1 ? 'empire' : 'empires'}`;
  // One handler calling the latest onSelectTeam (App passes a new one per render), so the memoised standings table
  // and fallen list are skipped while their rows are unchanged.
  const selectRef = useRef(onSelectTeam);
  selectRef.current = onSelectTeam;
  const selectTeam = useCallback(id => selectRef.current?.(id), []);
  return (
    <section id="view-panel-ledger" className="screen screen--ledger" aria-labelledby="view-tab-ledger" tabIndex={-1}>
      <div className="ledger">
        <LedgerHead titleId="ledger-title" kicker={header?.kicker} title={header?.title || 'Ledger'} stats={header?.stats || []} />
        <div className="ledger-body">
          <section className="ledger-main" aria-labelledby="ledger-standings-title">
            <div className="kicker">
              <h2 className="kicker__title" id="ledger-standings-title">Standings</h2>
              {session
                ? <span className="kicker__aside" data-testid="session-remaining" role="status">{session}</span>
                : <span className="kicker__aside">{aside}</span>}
            </div>
            <StandingsTable rows={rows} selectedTeamId={selectedTeamId} youLabel={youLabel || (youId ? 'You' : '')} onSelectTeam={selectTeam} />
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
