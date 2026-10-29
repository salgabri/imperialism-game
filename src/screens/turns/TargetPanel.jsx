// Owner: WP-TURN (see PLAN.md §4). "Choose a target" docked in the Map column in place of Next fixture (A-1,
// M§5.6 type/rows/copy without the floating box). A radiogroup inside [data-space-primary] with roving tabindex:
// arrows/Home/End move the selection, Space runs the masthead primary "Attack <team>" (App, A-8), Enter confirms
// here. Never a dialog (A-8).
import React, { useEffect, useRef } from 'react';
import TeamMark from '../../components/TeamMark.jsx';
import './turns.css';

export default function TargetPanel({ count = '', rows = [], selectedId = null, ctaLabel = '', onSelect, onHover, onConfirm }) {
  const listRef = useRef(null);
  const titleId = 'target-panel-title';
  const selected = rows.find(row => row.teamId === selectedId) || rows.find(row => row.selected) || rows[0] || null;

  // When the choice opens with focus on the page or on the primary button, move focus to the selected row so
  // arrows and Space work straight away (no scroll jump, no timers). From the page (e.g. the turn arrived under
  // autoplay) the ring is suppressed where `focusVisible` is supported: the clay selection is the resting look
  // (M§5.6) and the ink ring appears with the first arrow key. From the primary, the browser's heuristic decides.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const active = document.activeElement;
    const fromPage = !active || active === document.body;
    if (!fromPage && !active.closest?.('[data-primary]')) return;
    const row = listRef.current?.querySelector('[role="radio"][tabindex="0"]');
    row?.focus?.(fromPage ? { preventScroll: true, focusVisible: false } : { preventScroll: true });
  }, []);

  function focusRow(position) {
    listRef.current?.querySelectorAll('[role="radio"]')[position]?.focus?.();
  }
  function onKeyDown(event, position) {
    // Leave browser and OS shortcuts alone (Alt+←/→ history, Ctrl/Cmd+Home/End, Ctrl+Enter …).
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      // A held key auto-repeats onto the row the first press just selected: only a fresh press may attack.
      if (event.repeat) return;
      if (rows[position] === selected) onConfirm?.();
      else if (rows[position]) onSelect?.(rows[position].teamId);
      return;
    }
    const last = rows.length - 1;
    let next = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = position === last ? 0 : position + 1;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = position === 0 ? last : position - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next == null || !rows[next]) return;
    event.preventDefault();
    onSelect?.(rows[next].teamId);
    focusRow(next);
  }

  return (
    <section className="target-panel" aria-labelledby={titleId}>
      <div className="kicker">
        <span className="kicker__title" id={titleId}>Choose a target</span>
        {count && <span className="kicker__aside">{count}</span>}
      </div>
      <div className="target-panel__head" aria-hidden="true"><span>Spoils</span><span>Win</span></div>
      <div ref={listRef} className="target-panel__rows" role="radiogroup" data-space-primary aria-labelledby={titleId}
        onPointerLeave={() => onHover?.(null)}>
        {rows.map((row, position) => {
          const checked = row === selected;
          return (
            <div key={row.teamId} role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1}
              className={`target-panel__row${checked ? ' is-selected' : ''}`} data-team-id={row.teamId}
              aria-label={`${row.name}, strength ${row.eff}, spoils ${row.spoils.replace('+', '')} ${row.spoils === '+1' ? 'territory' : 'territories'}, win chance ${row.win}`}
              onClick={() => onSelect?.(row.teamId)} onKeyDown={event => onKeyDown(event, position)}
              onPointerEnter={() => onHover?.(row.teamId)}>
              <span className="radio-square radio-square--sm" aria-hidden="true" />
              <span className="target-panel__mark" aria-hidden="true">
                <TeamMark id={row.flagId} teamId={row.teamId} code={row.code} color={row.color} isClub={row.isClub} width={20} height={15} />
              </span>
              <span className="target-panel__name">{row.name}<span className="target-panel__eff num">{row.eff}</span></span>
              <span className="target-panel__spoils num">{row.spoils}</span>
              <span className={`target-panel__win num tone-${row.tone || 'muted'}`}>{row.win}</span>
            </div>
          );
        })}
      </div>
      {ctaLabel && (
        <p className="target-panel__foot">
          Spoils are the territories you would annex. Confirm with <b>{ctaLabel}</b> in the bar. Everyone else’s targets
          come from the compass.
        </p>
      )}
    </section>
  );
}
