import React, { useEffect, useRef } from 'react';
import './manager.css';

export default function ManagerElimination({ result, onSpectate, onRetry }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector('button')?.focus();
    const trap = event => {
      if (event.key !== 'Tab') return;
      const buttons = [...ref.current.querySelectorAll('button')];
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="manager-backdrop"><section className="manager-ending" ref={ref} role="dialog" aria-modal="true" aria-labelledby="manager-ending-title">
    <p className="manager-eyebrow">Your campaign ends here</p>
    <h1 id="manager-ending-title">{result.teamName} eliminated</h1>
    <p>{result.opponentName} won the decisive match, {result.score}.</p>
    <dl className="manager-stats"><div><dt>Placement</dt><dd>{result.placement}</dd></div><div><dt>Conquests</dt><dd>{result.conquests}</dd></div><div><dt>Signings</dt><dd>{result.signings}</dd></div></dl>
    <p>Your run is saved. Follow the remaining teams or try the same opening again.</p>
    <div className="manager-ending-actions"><button className="button button-primary" onClick={onSpectate}>Continue as spectator</button><button className="button button-quiet" onClick={onRetry}>Retry this setup</button></div>
  </section></div>;
}
