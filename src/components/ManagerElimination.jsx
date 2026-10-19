// Owner: WP-CONQ (see PLAN.md §4). The manager's defeat, restyled with the conquest article pattern (DEC D15):
// "ITALY IS OUT" headline, winner-first standfirst, stats, Continue as spectator / Retry this setup.
// FROZEN props { result, onSpectate, onRetry } + optional `model` (buildElimination). Stays a modal dialog with a
// focus trap (primaryAction is null while it is open) and restores focus on close.
import React, { useEffect, useRef } from 'react';
import { eliminationFromResult } from '../viewModels/conquest.js';
import './manager.css';

export default function ManagerElimination({ result, model = null, onSpectate, onRetry }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector('button')?.focus();
    const trap = event => {
      if (event.key !== 'Tab' || !ref.current) return;
      const buttons = [...ref.current.querySelectorAll('button:not(:disabled)')];
      if (!buttons.length) return;
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus(); };
  }, []);
  const view = model || eliminationFromResult(result) || {};
  const { kicker = 'Eliminated', kickerRight = 'Result', headline = '', standfirst = '', stats = [], note = '', noteTone = null } = view;
  return (
    <div className="manager-backdrop">
      <section className="manager-ending" ref={ref} role="dialog" aria-modal="true"
        aria-labelledby="manager-ending-title" aria-describedby={standfirst ? 'manager-ending-standfirst' : undefined}>
        <div className="manager-kicker">
          <span className="manager-kicker__title">{kicker}</span>
          <span className="manager-kicker__aside">{kickerRight}</span>
        </div>
        <h1 id="manager-ending-title" className="manager-headline">{headline}</h1>
        {standfirst && <p id="manager-ending-standfirst" className="manager-standfirst">{standfirst}</p>}
        {stats.length > 0 && (
          <dl className="manager-stats">
            {stats.map(stat => (
              <div key={stat.key || stat.label} className="manager-stat">
                <dt className="manager-stat__label">{stat.label}</dt>
                <dd className="manager-stat__value">{stat.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {note && <p className={`manager-note${noteTone === 'unsaved' ? ' manager-note--unsaved' : ''}`}>{note}</p>}
        <div className="manager-ending-actions">
          <button type="button" className="btn-primary manager-ending__primary" onClick={onSpectate}>Continue as spectator</button>
          <button type="button" className="btn-secondary manager-ending__secondary" onClick={onRetry}>Retry this setup</button>
        </div>
      </section>
    </div>
  );
}
