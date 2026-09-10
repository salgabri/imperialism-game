import React, { useEffect, useRef } from 'react';
import PlayerRow from './PlayerRow.jsx';
import { TeamMark } from './MatchCard.jsx';
import Icon from './Icon.jsx';
import './results.css';

function Stat({ value, label }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

/** A campaign's final reward, with the map and new campaign one action away. */
export default function VictoryOverlay({
  id, code, isClub, round, name, color, subtitle, conquests, steals, territories,
  effNow, effBase, effGain, squad, positionColors, onClose, onNew,
}) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const buttons = dialogRef.current?.querySelectorAll('button:not(:disabled), [tabindex="0"]');
      if (!buttons?.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); if (previous?.isConnected) previous.focus(); };
  }, [onClose]);

  return (
    <div className="fi-victory-backdrop">
      <section className="fi-victory" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="victory-title" aria-describedby="victory-description">
        <button type="button" className="fi-victory-close" onClick={onClose} aria-label="Close campaign results"><Icon name="close" size={19} /></button>
        <div className="fi-victory-eyebrow"><Icon name="trophy" size={18} /><span>Campaign complete · Round {Number(round) || round}</span></div>
        <div className="fi-victory-emblem"><TeamMark id={id} code={code || name.slice(0, 3)} color={color} isClub={isClub || !id} width={70} /></div>
        <h1 id="victory-title">{name}</h1>
        <p id="victory-description">{subtitle}</p>
        <div className="fi-victory-stats">
          <Stat value={conquests} label="Conquests" /><Stat value={steals} label="Players claimed" />
          <Stat value={territories} label="Territories" /><Stat value={effGain.text} label="Strength gained" />
        </div>
        <div className="fi-victory-squad-heading"><h2>The champion's squad</h2><span>EFF {effBase} → {effNow}</span></div>
        <div className="fi-victory-squad">{squad.map((player, i) => <PlayerRow key={i} player={player} positionColors={positionColors} roomy />)}</div>
        <div className="fi-victory-actions"><button ref={closeRef} type="button" onClick={onClose}>View map</button><button type="button" className="fi-victory-primary" onClick={onNew}>New campaign <Icon name="arrow" size={17} /></button></div>
      </section>
    </div>
  );
}
