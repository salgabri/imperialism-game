import React, { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';
import './results.css';

/** A conquest waits here until its manager makes the one strategic choice. */
export default function AcquisitionChoice({ choice, onChoose }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.querySelector('button')?.focus();
    const trap = event => {
      if (event.key !== 'Tab') return;
      const buttons = [...(dialogRef.current?.querySelectorAll('button:not(:disabled)') || [])];
      if (!buttons.length) return;
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus(); };
  }, []);
  if (!choice) return null;
  return <div className="fi-acquisition-backdrop">
    <section ref={dialogRef} className="fi-acquisition" role="dialog" aria-modal="true" aria-labelledby="acquisition-title" aria-describedby="acquisition-description">
      <p className="fi-acquisition-eyebrow"><Icon name="users" size={18} />Manager decision · campaign paused</p>
      <h1 id="acquisition-title">Choose your signing</h1>
      <p id="acquisition-description">{choice.winnerName} defeated {choice.loserName}. Claim one player for your squad.</p>
      <div className="fi-acquisition-options">{(choice.candidates || []).map((candidate, i) => {
        const gain = Number(candidate.gain) || 0;
        const replaces = typeof candidate.replaces === 'string' ? candidate.replaces : candidate.replaces?.name;
        return <button type="button" key={candidate.index ?? i} data-testid="acquisition-candidate" onClick={() => onChoose(candidate.index ?? i)}>
          <span className="fi-acquisition-player"><strong>{candidate.name}</strong><span>{candidate.pos} · {candidate.rating} rating</span></span>
          <span className={gain > 0 ? 'fi-strength-gain' : 'fi-strength-unchanged'}>{gain > 0 ? `+${gain.toFixed(1)} strength` : 'No strength change'}</span>
          <small>{replaces ? `Replaces ${replaces} in the starting lineup` : 'Adds a squad option'}</small>
          <span className="fi-acquisition-select">Claim player <Icon name="arrow" size={16} /></span>
        </button>;
      })}</div>
      <p className="fi-acquisition-note">Lineup improvement accounts for positions and existing starters. Your choice completes this conquest.</p>
    </section>
  </div>;
}
