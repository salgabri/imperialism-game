import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { PACING_OPTIONS, RESOLUTION_OPTIONS } from './SetupOverlay.jsx';
import './controls.css';

export default function CommandBar({
  show, sportName = 'Football', layerName = 'Nations', scopeName, round, alive,
  pacing, resolution, confirmNew, onPacing, onResolution, onNew, busy = false, completed = false,
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const outside = event => {
      if (!settingsRef.current?.contains(event.target)) setSettingsOpen(false);
    };
    const escape = event => {
      if (event.key === 'Escape') {
        setSettingsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [settingsOpen]);

  useEffect(() => { if (!show) setSettingsOpen(false); }, [show]);

  return (
    <header className="command-bar">
      <div className="command-identity">
        <span className="command-brand">Imperialism</span>
        <span className="command-subtitle">{sportName} / {layerName}</span>
      </div>
      {show && <>
        <span className="command-theatre">{scopeName}</span>
        <div className="command-status" aria-label={`Round ${round}, ${alive} remaining`}>
          <span>Round <strong>{String(round).padStart(2, '0')}</strong></span>
          <span><strong>{alive}</strong> remaining</span>
        </div>
        <div className="command-settings" ref={settingsRef}>
          <button type="button" className="icon-button" aria-label="Settings" title="Settings" aria-expanded={settingsOpen} aria-controls="campaign-settings" ref={triggerRef} onClick={() => setSettingsOpen(value => !value)}><Icon name="settings" size={21} /></button>
          {settingsOpen && (
            <section id="campaign-settings" className="command-popover" aria-label="Campaign settings">
              <div className="command-popover-heading"><h2>Settings</h2><button type="button" className="icon-button" aria-label="Close settings" onClick={() => { setSettingsOpen(false); triggerRef.current?.focus(); }}><Icon name="close" size={17} /></button></div>
              <label className="control-field" htmlFor="campaign-pacing"><span>Pacing</span>
                <select id="campaign-pacing" value={pacing} disabled={busy || completed} onChange={event => onPacing(event.target.value)}>
                  {PACING_OPTIONS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
                </select>
              </label>
              <label className="control-field" htmlFor="campaign-resolution"><span>Match display</span>
                <select id="campaign-resolution" value={resolution} disabled={busy || completed} onChange={event => onResolution(event.target.value)}>
                  {RESOLUTION_OPTIONS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
                </select>
              </label>
              {busy && <p className="command-settings-note">Match settings are available after this match.</p>}
              <div className="command-new">
                {confirmNew && <p role="alert">End this campaign and choose a new one?</p>}
                <button type="button" className="button button-quiet" onClick={onNew}>{confirmNew ? 'Confirm new campaign' : 'New campaign'}</button>
              </div>
            </section>
          )}
        </div>
      </>}
    </header>
  );
}
