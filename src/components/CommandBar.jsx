import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import TeamMark from './TeamMark.jsx';
import { SHOW_MATCH_BUSY, SHOW_MATCH_HELP, campaignFacts, showMatchOptions, showMatchesOf, showMatchesWrites } from '../screens/setup/setupModel.js';
import SaveControls from './SaveControls.jsx';
import { roman } from '../viewModels/format.js';
import ThemeToggle from './ThemeToggle.jsx';
import './masthead.css';

const VIEWS = [['map', 'Map'], ['squad', 'Squad'], ['match', 'Match'], ['ledger', 'Ledger'], ['chronicle', 'Chronicle']];
const SETTINGS_KEYS = ['confirmNew', 'onNew', 'busy', 'completed', 'saveStatus', 'onExport', 'onImport', 'onResults', 'onCancelNew',
  'seed', 'settings', 'onSetting', 'onManageSaves', 'managementEnded', 'managedName'];

function PanelKicker({ id, title, aside }) {
  return (
    <h3 className="kicker settings-panel__kicker">
      <span className="kicker__title" id={id}>{title}</span>
      {aside ? <span className="kicker__aside">{aside}</span> : null}
    </h3>
  );
}

/**
 * Campaign settings: the masthead popover body and the phone More sheet (A-10). `idPrefix` is prefixed onto
 * every control id so both can be mounted at once. Show matches is the one live control (`resolution` / `express`
 * through `onSetting`); the launch rules are read-only facts, each with its stored value in `data-value`.
 */
export function SettingsPanel({
  confirmNew, onNew, busy = false, completed = false, saveStatus, onExport, onImport, onResults, onCancelNew, seed,
  settings, onSetting, onManageSaves, managementEnded = false, managedName = null, idPrefix = '',
}) {
  const id = name => `${idPrefix}${name}`;
  const mode = showMatchesOf(settings);
  const facts = settings ? campaignFacts(settings, { seed, managementEnded, managedName }) : [];
  return (
    <div className="settings-panel">
      {completed && onResults && <button type="button" className="button settings-panel__results" onClick={onResults}>Campaign results</button>}
      <section className="settings-panel__section" aria-labelledby={id('settings-matches-title')}>
        <PanelKicker id={id('settings-matches-title')} title="Show matches" aside="Change any time" />
        <div className="control-field">
          <select id={id('campaign-resolution')} aria-labelledby={id('settings-matches-title')} aria-describedby={id('campaign-resolution-help')}
            value={mode} disabled={completed || !onSetting}
            onChange={event => { for (const [key, value] of showMatchesWrites(event.target.value, settings)) onSetting?.(key, value); }}>
            {showMatchOptions(settings, { busy }).map(option => (
              <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
            ))}
          </select>
          <small className="control-help" id={id('campaign-resolution-help')}>{busy && !completed ? SHOW_MATCH_BUSY : SHOW_MATCH_HELP[mode]}</small>
        </div>
      </section>
      {facts.length > 0 && (
        <section className="settings-panel__section" aria-labelledby={id('settings-campaign-title')}>
          <PanelKicker id={id('settings-campaign-title')} title="This campaign" aside="Set at launch" />
          <dl className="settings-panel__facts">
            {facts.map(row => (
              <div key={row.id}>
                <dt>{row.label}</dt>
                <dd id={id(`campaign-${row.id}`)} data-value={row.stored} className={row.num ? 'num' : undefined}>
                  {row.inner ? <span id={id(`campaign-${row.inner.id}`)} data-value={row.inner.stored}>{row.value}</span> : row.value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="settings-panel__note">Start a new campaign to change these.</p>
        </section>
      )}
      <section className="settings-panel__section" aria-labelledby={id('settings-saves-title')}>
        <PanelKicker id={id('settings-saves-title')} title="Saves" />
        <SaveControls status={saveStatus} onExport={onExport} onImport={onImport} onManageSaves={onManageSaves} compact />
      </section>
      <div className="settings-panel__new">
        {confirmNew && <p role="alert">Start a new campaign? This one stays in Saved campaigns.</p>}
        <button type="button" className="button" onClick={onNew}>{confirmNew ? 'Confirm new campaign' : 'New campaign'}</button>
        {confirmNew && <button type="button" className="button" onClick={onCancelNew}>Cancel</button>}
      </div>
    </div>
  );
}

/**
 * v4 masthead (RM Part 2; DEC D11–D14). Row 1: wordmark · dateline · screen nav · primary (Space) · settings · theme.
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
        <ThemeToggle className="mast__theme" />
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
