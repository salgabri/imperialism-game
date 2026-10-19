import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import TeamMark from './TeamMark.jsx';
import { PACING_OPTIONS, PACING_HELP, RESOLUTION_OPTIONS } from './SetupOverlay.jsx';
import SaveControls from './SaveControls.jsx';
import { roman } from '../viewModels/format.js';
import './masthead.css';

const VIEWS = [['map', 'Map'], ['squad', 'Squad'], ['match', 'Match'], ['ledger', 'Ledger'], ['chronicle', 'Chronicle']];
const SETTINGS_KEYS = ['pacing', 'resolution', 'confirmNew', 'onPacing', 'onResolution', 'onNew', 'busy', 'completed', 'saveStatus',
  'onExport', 'onImport', 'onResults', 'onCancelNew', 'seed', 'settings', 'onSetting', 'onManageSaves', 'managementEnded'];

/**
 * Campaign settings: the masthead popover body and the phone More sheet (A-10). `idPrefix` is prefixed onto
 * every control id so both can be mounted at once. Draw rules are read-only after launch.
 */
export function SettingsPanel({
  pacing, resolution, confirmNew, onPacing, onResolution, onNew, busy = false, completed = false,
  saveStatus, onExport, onImport, onResults, onCancelNew, seed,
  settings, onSetting, onManageSaves, managementEnded = false, idPrefix = '',
}) {
  const id = name => `${idPrefix}${name}`;
  return (
    <div className="settings-panel">
      <label className="control-field" htmlFor={id('campaign-pacing')}><span>Pacing</span>
        <select id={id('campaign-pacing')} value={pacing} disabled title="Draw rules are fixed at launch" onChange={event => onPacing?.(event.target.value)}>
          {PACING_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </label>
      {PACING_HELP[pacing] && <p className="settings-panel__note">{PACING_HELP[pacing]}</p>}
      <div className="settings-panel__rules">
        <label className="control-field" htmlFor={id('campaign-turn-order')}><span>Turn order</span>
          <select id={id('campaign-turn-order')} value={settings?.turnOrder === 'round-robin' ? 'round-robin' : 'random'} disabled title="Rules are fixed at launch" onChange={() => {}}>
            <option value="random">Random draw</option><option value="round-robin">Round robin</option>
          </select>
        </label>
        <label className="control-field" htmlFor={id('campaign-targeting')}><span>Target</span>
          <select id={id('campaign-targeting')} value={settings?.targeting === 'player' ? 'player' : 'compass'} disabled title="Rules are fixed at launch" onChange={() => {}}>
            <option value="compass">Compass</option><option value="player">You choose</option>
          </select>
        </label>
      </div>
      <label className="control-field" htmlFor={id('campaign-resolution')}><span>Match display</span>
        <select id={id('campaign-resolution')} value={resolution} disabled={busy || completed} onChange={event => onResolution?.(event.target.value)}>
          {RESOLUTION_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </label>
      {busy && <p className="settings-panel__note">Match settings are available after this match.</p>}
      {onSetting && <>
        <label className="control-checkbox"><input type="checkbox" id={id('campaign-express')} checked={!!settings?.express} disabled={completed} onChange={event => onSetting('express', event.target.checked)} /><span>Express playback<small>Shorter waits from the next match.</small></span></label>
        <label className="control-field" htmlFor={id('campaign-uncertainty')}><span>Match uncertainty</span><select id={id('campaign-uncertainty')} value={settings?.uncertainty || 'balanced'} disabled onChange={() => {}}><option value="predictable">Predictable</option><option value="balanced">Balanced</option><option value="wild">Wild</option></select></label>
        <label className="control-field" htmlFor={id('campaign-finale')}><span>Final two teams</span><select id={id('campaign-finale')} value={settings?.finale || 'single'} disabled onChange={() => {}}><option value="single">Single match</option><option value="best-of-three">Best of three</option></select></label>
        <label className="control-field" htmlFor={id('campaign-role')}><span>Your role at launch</span><select id={id('campaign-role')} value={settings?.role || 'spectator'} disabled onChange={() => {}}><option value="spectator">Spectator</option><option value="manager">Manager</option></select><small className="control-help">{managementEnded ? 'Your managed team was eliminated. You are watching as a spectator.' : 'Campaign rules and your managed team are fixed at launch.'}</small></label>
        <p className="settings-panel__note">Recruitment: {settings?.acquisitionPolicy === 'best-fit' ? 'Best lineup fit' : 'Highest rated'}{settings?.sport === 'basketball' ? ` · ${settings.rosterPreset === 'competitive' ? 'Competitive' : 'Authentic'} ratings` : ''}</p>
      </>}
      {seed != null && <p className="settings-panel__note settings-panel__seed">Seed <strong>{seed}</strong></p>}
      {completed && onResults && <button type="button" className="button settings-panel__results" onClick={onResults}>Campaign results</button>}
      <SaveControls status={saveStatus} onExport={onExport} onImport={onImport} onManageSaves={onManageSaves} compact />
      <div className="settings-panel__new">
        {confirmNew && <p role="alert">Choose a new campaign? This run remains available in Saved campaigns.</p>}
        <button type="button" className="button" onClick={onNew}>{confirmNew ? 'Confirm new campaign' : 'New campaign'}</button>
        {confirmNew && <button type="button" className="button" onClick={onCancelNew}>Cancel</button>}
      </div>
    </div>
  );
}

/**
 * v4 masthead (RM Part 2; DEC D11–D14). Row 1: wordmark · dateline · screen nav · primary (Space) · settings.
 * Row 2: managed/followed team · stats · playback. Sizes switch in CSS only. The primary's textContent is
 * exactly `primary.mastLabel || primary.label`; the SPACE chip is CSS (`data-key-hint`), never a text node.
 * Must stay a plain function named CommandBar, rendered as a direct child of App's root (tests read its props).
 */
export default function CommandBar(props) {
  const {
    show, round, alive, completed = false, saveStatus, onResults,
    view = null, navLocked = false, onView, primary = null, onPrimary, masthead = null, playback = null,
  } = props;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    // A modal opened from the popover (Saved campaigns, Export) owns the keyboard and the pointer: the popover stays
    // open underneath so the dialog can return focus to the control that opened it.
    const modalOpen = () => !!document.querySelector('[aria-modal="true"]');
    const outside = event => {
      if (modalOpen()) return;
      if (!settingsRef.current?.contains(event.target)) setSettingsOpen(false);
    };
    const escape = event => {
      if (event.key === 'Escape' && !event.defaultPrevented && !modalOpen()) {
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

  const settingsProps = Object.fromEntries(SETTINGS_KEYS.filter(key => key in props).map(key => [key, props[key]]));
  const numeral = masthead?.roman ?? roman(round);
  const dateline = masthead ? `${masthead.roundLabel} · ${masthead.remain}` : `Round ${numeral || round || 0} · ${alive ?? 0} remaining`;
  const roundShort = masthead?.roundShort ?? (numeral ? `R ${numeral}` : '');
  const team = masthead?.team || null;
  const mark = team ? <TeamMark id={team.flagId} code={team.code} color={team.color} isClub={team.isClub} width={22} height={16} /> : null;

  return (
    <header className="mast" data-variant={masthead?.variant}>
      <div className="mast__row1">
        {show && mark && <span className="mast__mark mast__mark--phone" aria-hidden="true">{mark}</span>}
        <span className="mast__wordmark">Imperialism</span>
        {show && <>
          <span className="mast__divider" aria-hidden="true" />
          <span className="mast__dateline">{dateline}</span>
        </>}
        <span className="mast__spacer" />
        {show && <>
          {onView && <nav className="mast__nav" aria-label="Screens">
            {VIEWS.map(([id, label]) => (
              <button type="button" key={id} id={`view-tab-${id}`} className="mast__tab" aria-current={view === id ? 'page' : undefined}
                disabled={navLocked && id !== 'map'} onClick={() => onView(id)}>{label}</button>
            ))}
          </nav>}
          {primary && <button type="button" className="btn-primary mast__cta" data-primary data-key-hint="Space"
            disabled={!!primary.disabled} onClick={onPrimary}><span className="mast__cta-label">{primary.mastLabel || primary.label}</span></button>}
          {roundShort && <span className="mast__round">{roundShort}</span>}
          <div className="command-extras">
            {saveStatus?.ok === false && <button type="button" className="command-save-warning" onClick={() => setSettingsOpen(true)} title={saveStatus.message}><span role="status">Unsaved</span></button>}
            {completed && onResults && <button type="button" className="icon-button command-results-trigger" aria-label="Campaign results" title="Campaign results" onClick={onResults}><Icon name="trophy" size={20} /></button>}
            <div className="command-settings" ref={settingsRef}>
              <button type="button" className="icon-button" aria-label="Settings" title="Settings" aria-expanded={settingsOpen} aria-controls="campaign-settings" ref={triggerRef} onClick={() => setSettingsOpen(value => !value)}><Icon name="settings" size={20} /></button>
              {settingsOpen && (
                <section id="campaign-settings" className="command-popover" aria-label="Campaign settings">
                  <div className="command-popover-heading"><h2>Settings</h2><button type="button" className="icon-button" aria-label="Close settings" onClick={() => { setSettingsOpen(false); triggerRef.current?.focus(); }}><Icon name="close" size={17} /></button></div>
                  <SettingsPanel {...settingsProps} />
                </section>
              )}
            </div>
          </div>
        </>}
      </div>
      {show && masthead && (
        <div className="mast__row2">
          <span className="mast__id" aria-label={masthead.variant === 'manager' ? 'Managed team' : 'Followed team'}>
            {mark && <span className="mast__mark" aria-hidden="true">{mark}</span>}
            <b className="mast__team">{masthead.name}</b>
            <span className="mast__role">{masthead.role}</span>
          </span>
          {(masthead.stats || []).map(stat => (
            <span className="mast__stat" key={stat.key} title={stat.tip}>
              <span className="mast__label"><span className="mast__label-long">{stat.label}</span><span className="mast__label-short">{stat.short}</span></span>
              <b className="mast__value">{stat.value}</b>
              {stat.delta ? <span className="mast__delta" data-tone={stat.tone}>{stat.delta}</span> : null}
            </span>
          ))}
          <span className="mast__status">
            {playback}
            {roundShort && <span className="mast__round mast__round--tab">{roundShort}</span>}
          </span>
        </div>
      )}
    </header>
  );
}
