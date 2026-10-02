import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { PACING_OPTIONS, PACING_HELP, RESOLUTION_OPTIONS } from './SetupOverlay.jsx';
import SaveControls from './SaveControls.jsx';
import './controls.css';

export default function CommandBar({
  show, sportName = 'Football', layerName = 'Nations', scopeName, round, alive,
  pacing, resolution, confirmNew, onPacing, onResolution, onNew, busy = false, completed = false,
  saveStatus, onExport, onImport, onResults, onCancelNew, seed,
  settings, onSetting, onManageSaves, managementEnded = false,
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
        {saveStatus?.ok === false && <button type="button" className="command-save-warning" onClick={() => setSettingsOpen(true)} title={saveStatus.message}><span role="status">Unsaved</span></button>}
        {completed && onResults && <button type="button" className="icon-button command-results-trigger" aria-label="Campaign results" title="Campaign results" onClick={onResults}><Icon name="trophy" size={21} /></button>}
        <div className="command-settings" ref={settingsRef}>
          <button type="button" className="icon-button" aria-label="Settings" title="Settings" aria-expanded={settingsOpen} aria-controls="campaign-settings" ref={triggerRef} onClick={() => setSettingsOpen(value => !value)}><Icon name="settings" size={21} /></button>
          {settingsOpen && (
            <section id="campaign-settings" className="command-popover" aria-label="Campaign settings">
              <div className="command-popover-heading"><h2>Settings</h2><button type="button" className="icon-button" aria-label="Close settings" onClick={() => { setSettingsOpen(false); triggerRef.current?.focus(); }}><Icon name="close" size={17} /></button></div>
              <label className="control-field" htmlFor="campaign-pacing"><span>Pacing</span>
                <select id="campaign-pacing" value={pacing} disabled title="Draw rules are fixed at launch" onChange={event => onPacing(event.target.value)}>
                  {PACING_OPTIONS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
                </select>
              </label>
              <p className="command-settings-note">{PACING_HELP[pacing]}</p>
              <label className="control-field" htmlFor="campaign-resolution"><span>Match display</span>
                <select id="campaign-resolution" value={resolution} disabled={busy || completed} onChange={event => onResolution(event.target.value)}>
                  {RESOLUTION_OPTIONS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
                </select>
              </label>
              {busy && <p className="command-settings-note">Match settings are available after this match.</p>}
              {onSetting && <>
                <label className="control-checkbox"><input type="checkbox" checked={!!settings?.express} disabled={completed} onChange={event => onSetting('express', event.target.checked)} /><span>Express playback<small>Shorter waits from the next match.</small></span></label>
                <label className="control-field" htmlFor="campaign-uncertainty"><span>Match uncertainty</span><select id="campaign-uncertainty" value={settings?.uncertainty || 'balanced'} disabled><option value="predictable">Predictable</option><option value="balanced">Balanced</option><option value="wild">Wild</option></select></label>
                <label className="control-field" htmlFor="campaign-finale"><span>Final two teams</span><select id="campaign-finale" value={settings?.finale || 'single'} disabled><option value="single">Single match</option><option value="best-of-three">Best of three</option></select></label>
                <label className="control-field" htmlFor="campaign-role"><span>Your role at launch</span><select id="campaign-role" value={settings?.role || 'spectator'} disabled><option value="spectator">Spectator</option><option value="manager">Manager</option></select><small className="control-help">{managementEnded ? 'Your managed team was eliminated. You are watching as a spectator.' : 'Campaign rules and your managed team are fixed at launch.'}</small></label>
                <p className="command-settings-note">Recruitment: {settings?.acquisitionPolicy === 'best-fit' ? 'Best lineup fit' : 'Highest rated'}{settings?.sport === 'basketball' ? ` · ${settings.rosterPreset === 'competitive' ? 'Competitive' : 'Authentic'} ratings` : ''}</p>
              </>}
              {seed != null && <p className="command-settings-note campaign-seed">Seed <strong>{seed}</strong></p>}
              <SaveControls status={saveStatus} onExport={onExport} onImport={onImport} onManageSaves={onManageSaves} compact />
              <div className="command-new">
                {confirmNew && <p role="alert">Choose a new campaign? This run remains available in Saved campaigns.</p>}
                <button type="button" className="button button-quiet" onClick={onNew}>{confirmNew ? 'Confirm new campaign' : 'New campaign'}</button>
                {confirmNew && <button type="button" className="button button-quiet command-cancel" onClick={onCancelNew}>Cancel</button>}
              </div>
            </section>
          )}
        </div>
      </>}
    </header>
  );
}
