import React, { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';
import './results.css';
import './strategy.css';

/** A conquest waits here until its manager makes the one strategic choice. */
export default function AcquisitionChoice({ choice, onChoose }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.querySelector('button')?.focus();
    const trap = event => {
      if (event.key !== 'Tab') return;
      const controls = [...(dialogRef.current?.querySelectorAll('button:not(:disabled), summary') || [])];
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
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
        const change = value => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`;
        const lineup = candidate.lineupPreview;
        return <article className="fi-signing-option" key={candidate.index ?? i}>
          <button type="button" data-testid="acquisition-candidate" onClick={() => onChoose(candidate.index ?? i)}>
          {candidate.role && <span className="fi-signing-role">{candidate.role}</span>}
          <span className="fi-acquisition-player"><strong>{candidate.name}</strong><span>{candidate.pos} · {candidate.rating} rating</span></span>
          <span className={gain > 0 ? 'fi-strength-gain' : 'fi-strength-unchanged'}>{gain > 0 ? `+${gain.toFixed(1)} strength` : 'No strength change'}</span>
          <small>{replaces ? `Replaces ${replaces} in the starting lineup` : 'Provides reserve support; starting lineup stays unchanged'}</small>
          {candidate.support && <span className="fi-signing-support">
            <span>Attack support {change(candidate.attackGain || 0)}</span>
            <span>Defensive support {change(candidate.defendGain || 0)}</span>
          </span>}
          <span className="fi-acquisition-select">Claim player <Icon name="arrow" size={16} /></span>
          </button>
          {lineup && <details className="fi-signing-preview">
            <summary>Compare starting lineup · {lineup.beforeRating.toFixed(1)} → {lineup.afterRating.toFixed(1)}</summary>
            <table><caption>Legal lineup before and after signing {candidate.name}</caption>
              <thead><tr><th scope="col">Position</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
              <tbody>{lineup.after.map((slot, index) => <tr key={`${slot.position}-${index}`} className={slot.name !== lineup.before[index]?.name ? 'is-changed' : ''}>
                <th scope="row">{slot.position}</th><td>{lineup.before[index]?.name} <small>{lineup.before[index]?.rating.toFixed(1)}</small></td>
                <td>{slot.name} <small>{slot.rating.toFixed(1)}{slot.outOfPosition ? ' · out of position' : ''}</small></td>
              </tr>)}</tbody>
            </table>
          </details>}
        </article>;
      })}</div>
      <p className="fi-acquisition-note">Starting strength uses a legal positional lineup. The best reserve in a useful position adds up to 1.20 match strength to Attack or Defend; support does not stack. Your signing completes this conquest.</p>
    </section>
  </div>;
}
