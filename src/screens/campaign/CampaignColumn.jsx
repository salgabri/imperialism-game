// Owner: WP-COL (see PLAN.md §4). The Map view's column (board A, PLAN §3.5, A-1, DEC D22).
import React from 'react';
import NextFixture from './NextFixture.jsx';
import FrontsTable from './FrontsTable.jsx';
import LatestResults from './LatestResults.jsx';
import './campaign.css';

/**
 * Composition (A-1): manager → `targetPanel` or <NextFixture/> (which embeds the `matchCard` slot whenever a
 * match exists), Your fronts only without a target panel, then Latest results. Spectator → `spectatorPanel`, then
 * Latest results. Layout is CSS-only: a column at ≥1200px, a two-column body under the map at 700–1199px, and a
 * bottom sheet below 700px (collapsed = the first block; the grab handle expands it over the map).
 */
export default function CampaignColumn({
  role = 'manager', sheet = 'collapsed', fixture = null, fronts = null, results = null, idleText = null,
  matchCard = null, targetPanel = null, spectatorPanel = null,
  onPreview, onSimulate, onToggleSheet, onOpenChronicle, onSelectTeam,
}) {
  const spectator = role === 'spectator' && !!spectatorPanel;
  const showFronts = !spectator && !targetPanel && !!fronts;
  const expanded = sheet === 'expanded';
  const toggle = typeof onToggleSheet === 'function' ? onToggleSheet : null;
  const lead = spectator ? spectatorPanel : targetPanel || (
    <NextFixture fixture={fixture} idleText={idleText} matchCard={matchCard} onPreview={onPreview} onSimulate={onSimulate} />
  );
  const className = ['v4-column', `v4-column--${spectator ? 'spectator' : 'manager'}`,
    showFronts ? 'v4-column--fronts' : 'v4-column--no-fronts', expanded ? 'v4-column--expanded' : null].filter(Boolean).join(' ');
  const grabRef = React.useRef(null);
  function onKeyDown(event) {
    if (event.key === 'Escape' && expanded && toggle && !event.defaultPrevented) {
      event.preventDefault();
      // Fronts and results are hidden in the collapsed sheet: keep focus on the handle instead of dropping to <body>.
      if (event.target?.closest?.('.fronts, .results-list')) grabRef.current?.focus();
      toggle();
    }
  }
  return (
    <aside id="campaign-details" className={className} aria-label="Campaign details" tabIndex={-1}
      data-sheet={expanded ? 'expanded' : 'collapsed'} onKeyDown={onKeyDown}>
      {/* One fixed name for every role (spectator, your turn, manager); aria-expanded carries the state. */}
      {toggle && <button type="button" ref={grabRef} className="sheet__grab" aria-expanded={expanded}
        aria-label="More campaign detail" onClick={() => toggle()} />}
      <div className="v4-column__lead">{lead}</div>
      {showFronts && <FrontsTable fronts={fronts} onSelectTeam={onSelectTeam} />}
      <LatestResults results={results} onOpenChronicle={onOpenChronicle} />
    </aside>
  );
}
