import React, { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';
import './results.css';
import './strategy.css';

/** Outcome generation waits until this pre-match decision is committed. */
export default function TacticalChoice({ choice, onChoose }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.querySelector('[data-tactic="balanced"]')?.focus();
    const trap = event => {
      if (event.key !== 'Tab') return;
      const buttons = [...(dialog?.querySelectorAll('button:not(:disabled)') || [])];
      if (!buttons.length) return;
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus(); };
  }, []);
  if (!choice) return null;
  return <div className="fi-acquisition-backdrop">
    <section ref={dialogRef} className="fi-acquisition fi-tactical-choice" role="dialog" aria-modal="true" aria-labelledby="tactical-title" aria-describedby="tactical-description">
      <p className="fi-acquisition-eyebrow"><Icon name="users" size={18} />Manager decision · before the match</p>
      <h1 id="tactical-title">Choose your approach</h1>
      <p id="tactical-description">{choice.managerName} faces {choice.opponentName}. {choice.options?.[0]?.context} Commit an approach to start the match.</p>
      <div className="fi-acquisition-options">{(choice.options || []).map(option => <button type="button" key={option.id} data-tactic={option.id} onClick={() => onChoose(option.id)}>
        <span className="fi-acquisition-player"><strong>{option.label}</strong><span>{option.description}</span></span>
        <span className="fi-tactical-rating">Match strength {option.strength.toFixed(1)} <small>({option.bonus >= 0 ? '+' : '−'}{Math.abs(option.bonus).toFixed(2)})</small></span>
        <span className="fi-tactical-risk">Matchday variation {option.drama.toFixed(1)} / 12 <small>Normal: {option.baseDrama.toFixed(1)}</small></span>
        {option.support > 0 && <small>Reserve support contributes +{option.support.toFixed(2)} to this approach.</small>}
        {Number.isFinite(option.winProbability) && <small>{Math.round(option.winProbability * 100)}% estimated chance to win</small>}
        <span className="fi-acquisition-select">Play {option.label.toLowerCase()} <Icon name="arrow" size={16} /></span>
      </button>)}</div>
      <p className="fi-acquisition-note">Variation changes matchday form for both teams. Scoring luck remains at every setting. Your starting lineup stays the same; reserve support changes the approach’s match strength.</p>
    </section>
  </div>;
}
