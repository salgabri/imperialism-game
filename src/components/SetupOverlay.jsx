// Owner: WP-SETUP (see PLAN.md §4). Three-step campaign setup (PLAN A-5): Campaign → Rules → Nation & role, in the
// board-12 frame and v4 tokens. Every step stays mounted (inactive ones carry `hidden`) so the DOM contract of PLAN
// §4.7 holds on every step: theatre, match settings, managed team and the `Launch campaign` submit button.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import SaveControls from './SaveControls.jsx';
import TeamMark from './TeamMark.jsx';
import * as setupModel from '../screens/setup/setupModel.js';
import './setup.css';

// Frozen named exports (CommandBar imports the option lists). Definitions live in the pure model module.
export const PACING_OPTIONS = setupModel.PACING_OPTIONS;
export const RESOLUTION_OPTIONS = setupModel.RESOLUTION_OPTIONS;
export const PACING_HELP = setupModel.PACING_HELP;
export const campaignPreview = setupModel.campaignPreview;

const { SETUP_STEPS, TURN_ORDER_CARDS, TARGETING_CARDS, ROLE_CARDS, CONQUEST_RULES, UNCERTAINTY_HELP, FINALE_HELP } = setupModel;

/** Focus inside one of these keeps Space for itself (A-8). */
const SPACE_IGNORE = 'input, select, textarea, button, summary, a[href], [role="radio"], [role="button"], [role="dialog"], [aria-modal="true"], [contenteditable]:not([contenteditable="false"])';
/** Stable default so an omitted `managerTeams` prop does not invalidate the model memo on every render. */
const NO_TEAMS = Object.freeze([]);

function focusQuietly(element) {
  element?.focus?.({ preventScroll: true });
}

function CheckMark() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m5 12 5 5 9-10" /></svg>
  );
}

function EyeMark() {
  return (
    <svg className="spectator-note__icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Arrow keys / Home / End move a radio group's selection; the next radio's own click handler selects it. */
function moveRadio(event) {
  const steps = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'first', End: 'last' };
  const step = steps[event.key];
  if (step == null || event.altKey || event.ctrlKey || event.metaKey) return;
  const group = event.currentTarget.closest('[role="radiogroup"]');
  const radios = group ? [...group.querySelectorAll('[role="radio"]:not(:disabled)')] : [];
  if (!radios.length) return;
  const index = radios.indexOf(event.currentTarget);
  const nextIndex = step === 'first' ? 0 : step === 'last' ? radios.length - 1 : (index + step + radios.length) % radios.length;
  event.preventDefault();
  radios[nextIndex].focus();
  if (radios[nextIndex] !== event.currentTarget) radios[nextIndex].click();
}

/** Type-ahead for long radio lists: a letter jumps to the next name starting with it. */
function typeAhead(event) {
  if (event.key.length !== 1 || event.key === ' ' || event.altKey || event.ctrlKey || event.metaKey) return;
  const radios = [...event.currentTarget.querySelectorAll('[role="radio"]')];
  const start = radios.indexOf(event.target);
  const letter = event.key.toLowerCase();
  for (let offset = 1; offset <= radios.length; offset += 1) {
    const radio = radios[(start + offset) % radios.length];
    if ((radio.dataset.name || '').toLowerCase().startsWith(letter)) {
      event.preventDefault();
      radio.focus();
      radio.click();
      return;
    }
  }
}

function Kicker({ id, title, aside }) {
  return (
    <div className="kicker setup-kicker">
      <span className="kicker__title" id={id}>{title}</span>
      {aside ? <span className="kicker__aside">{aside}</span> : null}
    </div>
  );
}

/** Board-12 option card: the whole card is the radio (M§3.4). */
function OptionCard({ idBase, card, checked, disabled = false, onSelect }) {
  return (
    <button type="button" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1} disabled={disabled}
      className="rule-card" data-dots={card.dotStyle} aria-labelledby={`${idBase}-title`}
      aria-describedby={card.tag ? `${idBase}-tag ${idBase}-body` : `${idBase}-body`}
      onClick={() => { if (!checked) onSelect(card.value); }} onKeyDown={moveRadio}>
      <span className="rule-card__title" id={`${idBase}-title`}>{card.title}</span>
      {card.dots ? (
        <span className="rule-dots" aria-hidden="true">
          {card.dots.map((dot, index) => <span key={index} className={`rule-dot rule-dot--${dot}`} />)}
        </span>
      ) : null}
      {card.tag ? <span className={`rule-card__tag rule-card__tag--${card.tone}`} id={`${idBase}-tag`}>{card.tag}</span> : null}
      <span className="rule-card__body" id={`${idBase}-body`}>{card.body}</span>
      <span className="setup-check" aria-hidden="true"><CheckMark /></span>
    </button>
  );
}

/** A done step's rail summary: each " · " part stays whole, so a long one ("… · Asia & Oceania") wraps at a separator. */
function RailSummary({ text }) {
  return String(text).split(' · ').map((part, index) => (
    <React.Fragment key={index}>{index ? ' · ' : null}<span className="setup-rail__part">{part}</span></React.Fragment>
  ));
}

function SummaryList({ rows, className = '' }) {
  return (
    <dl className={`setup-summary ${className}`.trim()}>
      {rows.map(([label, value]) => (
        <div className="setup-summary__row" key={label}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

function TeamRowMark({ team, width = 24 }) {
  return (
    <span className="setup-team-mark" aria-hidden="true">
      <TeamMark id={team.id} code={team.code} isClub={team.isClub} width={width} />
    </span>
  );
}

function SelectedTeam({ team, noun }) {
  return (
    <section className="setup-pick" aria-labelledby="setup-pick-name">
      <div className="setup-pick__head">
        <span className="setup-pick__flag" aria-hidden="true">
          <TeamMark id={team.id} code={team.code} isClub={team.isClub} width={60} />
        </span>
        <div className="setup-pick__id">
          <p className="setup-pick__kicker">Selected {noun}</p>
          <h3 className="setup-pick__name" id="setup-pick-name">{team.name}</h3>
          <p className="setup-pick__meta">{team.meta}</p>
        </div>
      </div>
      <dl className="setup-pick__stats">
        <div><dt>Strength</dt><dd className="num">{team.ratingText}</dd></div>
        <div><dt>Rank</dt><dd className="num">{team.rankText}</dd></div>
        <div><dt>Tier</dt><dd className="setup-pick__tier">{team.tier}</dd></div>
      </dl>
      {team.players.length ? (
        <div className="setup-pick__players">
          <Kicker id="setup-pick-players" title="Best players" />
          <ol className="setup-players" aria-labelledby="setup-pick-players">
            {team.players.map(player => (
              <li className="setup-player" key={`${player.name}-${player.pos}`}>
                <span className="setup-player__pos">{player.pos}</span>
                <span className="setup-player__name">{player.name}</span>
                <span className="rating-box setup-player__rating" data-tier={player.tier}>{player.ratingText}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {team.fronts ? (
        <div className="setup-pick__fronts">
          <Kicker id="setup-pick-fronts" title="Fronts" aside={team.fronts.countText} />
          {team.fronts.rows.length ? (
            <ol className="setup-fronts" aria-labelledby="setup-pick-fronts">
              {team.fronts.rows.map(front => (
                <li className="setup-front" key={front.id}>
                  <TeamRowMark team={front} width={20} />
                  <span className="setup-front__name">{front.name}</span>
                  <span className="setup-front__eff num">{front.ratingText}</span>
                  <span className="setup-front__rel" data-tone={front.tone}>{front.rel}</span>
                </li>
              ))}
            </ol>
          ) : <p className="setup-fronts__empty">No land borders — every war goes by sea.</p>}
        </div>
      ) : null}
      <p className="setup-pick__note">You pick the approach before each match and the signing after each win.</p>
    </section>
  );
}

function TeamShortlist({ id, title, teams }) {
  if (!teams.length) return null;
  return (
    <section className="setup-shortlist" aria-labelledby={id}>
      <Kicker id={id} title={title} />
      <ol className="setup-shortlist__rows">
        {teams.map(team => (
          <li className="setup-shortlist__row" key={team.id}>
            <TeamRowMark team={team} />
            <span className="setup-shortlist__name">{team.name}</span>
            <span className="setup-shortlist__eff num">{team.ratingText}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The setup wizard. Props are App's (HEAD) setup props plus optional `onCancel` (header Cancel, only with a save). */
export default function SetupOverlay({
  setup = {}, hasSave = false, savedText = '', saveStatus, onResume, onDiscard, onPick, onStart,
  onExport, onImport, onManageSaves, onCancel, managerTeams = NO_TEAMS,
}) {
  const [step, setStep] = useState(1);
  const [confirmation, setConfirmation] = useState(null);
  const headings = useRef({});
  const nationList = useRef(null);
  const navigated = useRef(false);
  const keepSaveButton = useRef(null);
  const clearSaveButton = useRef(null);
  /** Where focus goes after the quick-resume confirmation opens or closes: 'keep' | 'trigger' | 'heading'. */
  const confirmationFocus = useRef(null);
  // App passes a fresh `onStart` arrow on every render; the Space listener reads the latest one through this ref.
  const startRef = useRef(onStart);
  const model = useMemo(() => setupModel.buildSetupModel(setup, { managerTeams }), [setup, managerTeams]);
  const { rules } = model;
  const manager = model.role === 'manager';

  const pick = (key, value) => onPick?.(key, value);
  function choose(key, value, current) { if (value !== current) pick(key, value); }
  function goTo(next) {
    const target = Math.min(3, Math.max(1, next));
    navigated.current = true;
    // The discard confirmation belongs to step 1's quick-resume card; leaving the step dismisses it.
    if (target !== 1) setConfirmation(null);
    setStep(target);
  }
  function chooseCell(cell) {
    choose('turnOrder', cell.turnOrder, rules.stored.turnOrder);
    choose('targeting', cell.targeting, rules.stored.targeting);
  }

  useEffect(() => { startRef.current = onStart; });

  // On mount, move focus into the wizard (it covers the whole app) unless a modal dialog already holds it.
  useEffect(() => {
    if (typeof document === 'undefined' || document.querySelector('[aria-modal="true"]')) return;
    focusQuietly(headings.current[1]);
  }, []);

  // After a step change, move focus to that step's heading (the scroll body is per step, so it starts at the top).
  useEffect(() => {
    if (!navigated.current) return;
    headings.current[step]?.focus?.();
    // Centre the chosen team inside its own scroll box only (scrollIntoView would also scroll the page).
    const list = nationList.current;
    const row = step === 3 ? list?.querySelector?.('[aria-checked="true"]') : null;
    if (row) list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - (list.clientHeight - row.offsetHeight) / 2;
  }, [step]);

  // Quick-resume confirmation: its trigger unmounts when it opens and its buttons unmount when it closes, so focus is
  // placed explicitly — Keep save on open, back on the trigger after Keep save, the step heading after the discard.
  useEffect(() => {
    const target = confirmationFocus.current;
    if (!target) return;
    confirmationFocus.current = null;
    const element = target === 'keep' ? keepSaveButton.current : target === 'trigger' ? clearSaveButton.current : null;
    focusQuietly(element || headings.current[1]);
  }, [confirmation, hasSave]);

  // A-8: SetupOverlay owns Space in setup. No timers; one listener, replaced only when step, launchability or the
  // confirmation change.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    function onKeyDown(event) {
      if (event.key !== ' ' && event.code !== 'Space') return;
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target && typeof target.closest === 'function' && target.closest(SPACE_IGNORE)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      // The visible discard confirmation waits for an explicit answer.
      if (confirmation && step === 1) return;
      if (step < 3) {
        event.preventDefault();
        goTo(step + 1);
      } else if (model.canLaunch) {
        event.preventDefault();
        startRef.current?.();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [step, model.canLaunch, confirmation]);

  function launch(event) {
    event.preventDefault();
    if (!model.canLaunch) { goTo(3); return; }
    onStart?.();
  }

  function askDiscard() {
    confirmationFocus.current = 'keep';
    setConfirmation('discard');
  }

  function keepSave() {
    confirmationFocus.current = 'trigger';
    setConfirmation(null);
  }

  function confirmDiscard() {
    confirmationFocus.current = 'heading';
    setConfirmation(null);
    onDiscard?.();
  }

  function stepHeading(n, id, text) {
    return (
      <h2 className="setup-title" id={id} tabIndex={-1} ref={element => { headings.current[n] = element; }}>{text}</h2>
    );
  }

  function footer(n) {
    const meta = SETUP_STEPS[n - 1];
    const note = n === 3 ? model.launchNote : meta.note;
    return (
      <footer className="setup-foot">
        <p className="setup-foot__note">{note}</p>
        {n > 1 ? <button type="button" className="btn-secondary setup-foot__back" onClick={() => goTo(n - 1)}>Back</button> : null}
        {n < 3 ? (
          <button type="button" className="btn-primary setup-foot__next" data-key-hint="Space" data-bar-hint={`Step ${n} of 3`}
            onClick={() => goTo(n + 1)}>{meta.next}</button>
        ) : (
          <button type="submit" className="btn-primary setup-foot__next setup-launch" data-key-hint="Space" data-bar-hint="Step 3 of 3"
            disabled={!model.canLaunch}>Launch campaign</button>
        )}
      </footer>
    );
  }

  const advancedFields = (
    <details className="setup-advanced">
      <summary>
        <Icon name="chevron" size={16} />
        <span className="setup-advanced__title">Match settings</span>
        <small className="setup-advanced__values">{model.pacingName} · {model.resolutionName}</small>
      </summary>
      <div className="setup-settings-fields">
        <label className="control-field" htmlFor="setup-pacing"><span>Pacing</span>
          <select id="setup-pacing" value={model.pacing} onChange={event => pick('pacing', event.target.value)}>
            {PACING_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <small className="control-help">{PACING_HELP[model.pacing] || PACING_HELP.duel}</small>
        </label>
        <label className="control-field" htmlFor="setup-resolution"><span>Match display</span>
          <select id="setup-resolution" value={model.resolution} onChange={event => pick('resolution', event.target.value)}>
            {RESOLUTION_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <small className="control-help">{model.resolution === 'instant' ? 'Results appear at once.' : 'Events appear at their minute; Finish match reveals the result.'}</small>
        </label>
        <label className="control-field" htmlFor="setup-uncertainty"><span>Match uncertainty</span>
          <select id="setup-uncertainty" value={model.uncertainty} onChange={event => pick('uncertainty', event.target.value)}>
            <option value="predictable">Predictable</option><option value="balanced">Balanced</option><option value="wild">Wild</option>
          </select>
          <small className="control-help">{UNCERTAINTY_HELP[model.uncertainty]}</small>
        </label>
        <label className="control-field" htmlFor="setup-finale"><span>Final two teams</span>
          <select id="setup-finale" value={model.finale} onChange={event => pick('finale', event.target.value)}>
            <option value="single">Single match</option><option value="best-of-three">Best of three</option>
          </select>
          <small className="control-help">{FINALE_HELP[model.finale]}</small>
        </label>
        <label className="control-field" htmlFor="setup-recruitment"><span>Automatic recruitment</span>
          <select id="setup-recruitment" value={setup.acquisitionPolicy || 'highest-rated'} onChange={event => pick('acquisitionPolicy', event.target.value)}>
            <option value="highest-rated">Highest rated player</option><option value="best-fit">Best fit for the starting lineup</option>
          </select>
          <small className="control-help">Applies to teams without a manager. Best fit maximizes legal lineup improvement, then rating.</small>
        </label>
        {model.sport.id === 'basketball' ? (
          <label className="control-field" htmlFor="setup-roster-preset"><span>Starting ratings</span>
            <select id="setup-roster-preset" value={setup.rosterPreset || 'authentic'} onChange={event => pick('rosterPreset', event.target.value)}>
              <option value="authentic">Authentic</option><option value="competitive">Competitive field</option>
            </select>
            <small className="control-help">Competitive narrows the strength gaps between teams and preserves player differences within each roster.</small>
          </label>
        ) : null}
        <label className="control-field" htmlFor="setup-seed"><span>Campaign seed</span>
          <input id="setup-seed" type="number" min="1" max="4294967295" step="1" inputMode="numeric" placeholder="Random seed"
            value={setup.seed ?? ''} onChange={event => pick('seed', event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />
          <small className="control-help">Share a seed and these settings to replay the same draw. Leave blank for a new seed.</small>
        </label>
        <label className="control-checkbox setup-express">
          <input type="checkbox" checked={!!setup.express} onChange={event => pick('express', event.target.checked)} />
          <span>Express playback<small>Shorter draw and result pauses. Manager choices still wait for you.</small></span>
        </label>
      </div>
    </details>
  );

  return (
    <div className="setup-overlay" data-step={step}>
      <form className="setup-frame" onSubmit={launch} noValidate>
        <header className="setup-head">
          <span className="setup-head__wordmark">Imperialism</span>
          <span className="setup-head__rule" aria-hidden="true" />
          <h1 className="setup-head__title">New campaign</h1>
          {onCancel ? <button type="button" className="setup-head__cancel" onClick={onCancel}>Cancel</button> : null}
        </header>

        <nav className="setup-rail" aria-label="Setup steps">
          <ol className="setup-rail__steps">
            {SETUP_STEPS.map(item => {
              const state = item.n < step ? 'done' : item.n === step ? 'current' : 'upcoming';
              return (
                <li key={item.id} data-state={state}>
                  <button type="button" className="setup-rail__step" data-state={state} aria-current={state === 'current' ? 'step' : undefined}
                    aria-controls={`setup-step-${item.id}`} onClick={() => goTo(item.n)}>
                    <span className="setup-rail__badge" aria-hidden="true">{state === 'done' ? <CheckMark /> : item.n}</span>
                    <span className="setup-rail__text">
                      <span className="setup-rail__title">{state === 'done' ? <span className="sr-only">Done: </span> : null}{item.title}</span>
                      <span className="setup-rail__sub">{state === 'done' ? <RailSummary text={model.stepSummaries[item.n]} /> : item.pending}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* Step 1 — Campaign (V1 board 02) */}
        <section className="setup-step" id="setup-step-campaign" data-step="1" hidden={step !== 1} aria-labelledby="setup-campaign-title">
          <div className="setup-step__body">
            <div className="setup-main">
              {hasSave ? (
                <div className="setup-save">
                  {confirmation === 'discard' ? (
                    <div className="setup-confirmation" role="alert">
                      <div className="setup-save__text">
                        <strong>Clear quick resume?</strong>
                        <p>The campaign stays available in Saved campaigns.</p>
                      </div>
                      <div className="setup-save__actions">
                        <button type="button" className="btn-secondary" ref={keepSaveButton} onClick={keepSave}>Keep save</button>
                        <button type="button" className="btn-link" onClick={confirmDiscard}>Clear quick resume</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="setup-save__text"><strong>Continue your campaign</strong><p>{savedText}</p></div>
                      <div className="setup-save__actions">
                        <button type="button" className="btn-secondary setup-save__resume" onClick={onResume}>Resume</button>
                        <button type="button" className="btn-link" ref={clearSaveButton} onClick={askDiscard}>Clear quick resume</button>
                      </div>
                    </>
                  )}
                </div>
              ) : null}

              <div className="setup-heading">
                {stepHeading(1, 'setup-campaign-title', 'Raise a campaign')}
                <p className="setup-lede">Every team starts with its own land. Win a match to take all of the loser’s territory — and one of its players.</p>
              </div>

              <div className="setup-group">
                <Kicker id="setup-sport-label" title="Sport" />
                <div className="setup-card-grid" role="radiogroup" aria-labelledby="setup-sport-label">
                  {model.sports.map(item => (
                    <div className="setup-card" data-checked={item.selected} key={item.id}>
                      <button type="button" role="radio" aria-checked={item.selected} tabIndex={item.selected ? 0 : -1}
                        className="setup-card__button" aria-describedby={`setup-sport-${item.id}-note`}
                        onClick={() => choose('sport', item.id, model.sport.id)} onKeyDown={moveRadio}>{item.name}</button>
                      <span className="setup-card__note" id={`setup-sport-${item.id}-note`}>{item.note}</span>
                      <span className="setup-check" aria-hidden="true"><CheckMark /></span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="setup-group">
                <Kicker id="setup-layer-label" title="Teams" />
                <div className="segmented setup-segmented" role="radiogroup" aria-labelledby="setup-layer-label">
                  {[['nations', 'Nations'], ['clubs', 'Clubs']].map(([id, name]) => (
                    <button type="button" role="radio" key={id} aria-checked={model.layer === id} tabIndex={model.layer === id ? 0 : -1}
                      onClick={() => choose('layer', id, model.layer)} onKeyDown={moveRadio}>{name}</button>
                  ))}
                </div>
              </div>

              <div className="setup-group setup-group--list">
                <Kicker id="setup-theatre-label" title="Theatre" />
                <div className="setup-theatres" role="radiogroup" aria-labelledby="setup-theatre-label">
                  {model.scopes.map(scope => {
                    const checked = scope.id === model.scopeId;
                    return (
                      <button type="button" role="radio" key={scope.id} aria-checked={checked} tabIndex={checked ? 0 : -1}
                        className="setup-theatre" aria-describedby={scope.note ? `setup-theatre-note-${scope.id}` : undefined}
                        onClick={() => choose(model.scopeKey, scope.id, model.scopeId)} onKeyDown={moveRadio}>
                        <span className="setup-theatre__name">
                          {scope.label}{scope.note ? <span className="setup-theatre__mark" aria-hidden="true">*</span> : null}
                        </span>
                        <span className="setup-theatre__count num">{`${scope.count} ${model.nouns}`}</span>
                      </button>
                    );
                  })}
                </div>
                {/* The data's "*" marker ("Asia & Oceania*") resolves to the scope's own description. */}
                {model.theatreNotes.map(scope => (
                  <p className="setup-theatres__note" id={`setup-theatre-note-${scope.id}`} key={scope.id}>
                    <span aria-hidden="true">* </span>{scope.note}
                  </p>
                ))}
                {/* Native mirror of the theatre radios: keeps `#setup-theatre` value-bound for automation (PLAN §4.7). */}
                <select id="setup-theatre" className="setup-mirror" aria-hidden="true" tabIndex={-1} value={model.scopeId}
                  onChange={event => pick(model.scopeKey, event.target.value)}>
                  {model.scopes.map(scope => (
                    <option value={scope.id} key={scope.id}>{`${scope.label} · ${scope.count} ${model.nouns}`}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="setup-side">
              <section className="setup-howto" aria-labelledby="setup-howto-title">
                <Kicker id="setup-howto-title" title="How conquest works" />
                <ol className="setup-rules">
                  {CONQUEST_RULES.map(rule => <li key={rule}>{rule}</li>)}
                </ol>
              </section>
              <div className="setup-estimate">
                <dl className="setup-stats">
                  {model.stats.map(stat => (
                    <div className={`setup-stat${stat.small ? ' setup-stat--small' : ''}`} key={stat.id}>
                      <dt>{stat.label}</dt><dd className="num">{stat.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="setup-estimate__note">Ties and manager decisions may take longer.</p>
                <p className="sr-only" role="status">{model.status}</p>
              </div>
              <SummaryList className="setup-summary--plain" rows={[
                ['Pacing', model.summary.pacing], ['Uncertainty', model.summary.uncertainty],
                ['Final two', model.summary.finale], ['Recruitment', model.summary.recruitment],
              ]} />
              <section className="setup-saves" aria-labelledby="setup-saves-title">
                <Kicker id="setup-saves-title" title="Saves" />
                <SaveControls status={saveStatus} onExport={hasSave ? onExport : undefined} onImport={onImport} onManageSaves={onManageSaves} />
              </section>
            </div>
          </div>
          {footer(1)}
        </section>

        {/* Step 2 — Rules of war (board 12) */}
        <section className="setup-step" id="setup-step-rules" data-step="2" hidden={step !== 2} aria-labelledby="setup-rules-title">
          <div className="setup-step__body">
            <div className="setup-main">
              <div className="setup-heading">
                {stepHeading(2, 'setup-rules-title', 'Rules of war')}
                <p className="setup-lede">Decide who attacks each turn — and who picks the target.</p>
              </div>
              {!rules.applies ? (
                <div className="rule-note" role="note">
                  <Icon name="info" size={20} />
                  <p>{rules.note} <button type="button" className="btn-link rule-note__action" onClick={() => pick('pacing', 'duel')}>Use One by one</button></p>
                </div>
              ) : null}
              <div className="rule-group">
                <Kicker id="rule-order-label" title="Turn order · who attacks" />
                <div className="setup-card-grid" role="radiogroup" aria-labelledby="rule-order-label" aria-disabled={!rules.applies || undefined}>
                  {TURN_ORDER_CARDS.map(card => (
                    <OptionCard key={card.value} idBase={`rule-order-${card.value}`} card={card} disabled={!rules.applies}
                      checked={rules.turnOrder === card.value} onSelect={value => pick('turnOrder', value)} />
                  ))}
                </div>
              </div>
              <div className="rule-group">
                <Kicker id="rule-target-label" title="Target · whom they attack" />
                <div className="setup-card-grid" role="radiogroup" aria-labelledby="rule-target-label" aria-disabled={!rules.applies || undefined}>
                  {TARGETING_CARDS.map(card => (
                    <OptionCard key={card.value} idBase={`rule-target-${card.value}`} card={card} disabled={!rules.applies}
                      checked={rules.targeting === card.value} onSelect={value => pick('targeting', value)} />
                  ))}
                </div>
              </div>
              <div className="spectator-note" role="note">
                <EyeMark />
                <p><b>Watching as a spectator?</b> Every combination works. Targets always come from the compass, nothing waits for input, and you can follow any empire.</p>
              </div>
            </div>

            <div className="setup-side">
              <div className="rule-explainer__head">
                <h3 className="rule-explainer__title" id="rule-matrix-title">How a turn plays</h3>
                <p className="rule-explainer__sub">Your pick is highlighted. The other three are one click away.</p>
              </div>
              <div className="rule-matrix" role="radiogroup" aria-labelledby="rule-matrix-title" aria-disabled={!rules.applies || undefined}>
                <span className="rule-matrix__corner" aria-hidden="true" />
                <span className="rule-matrix__head" aria-hidden="true">You choose</span>
                <span className="rule-matrix__head" aria-hidden="true">Compass</span>
                {rules.cells.map((cell, index) => (
                  <React.Fragment key={cell.id}>
                    {index % 2 === 0 ? (
                      <span className="rule-matrix__row" aria-hidden="true">{cell.turnOrder === 'round-robin' ? 'Round robin' : 'Random'}</span>
                    ) : null}
                    <button type="button" role="radio" aria-checked={cell.selected} tabIndex={cell.selected ? 0 : -1} disabled={!rules.applies}
                      className="rule-matrix__cell" data-turn-order={cell.turnOrder} data-targeting={cell.targeting}
                      aria-label={`${cell.title}: ${cell.turnOrder === 'round-robin' ? 'Round robin' : 'Random draw'} and ${cell.targeting === 'player' ? 'You choose' : 'Compass'}`}
                      aria-describedby={`rule-cell-${cell.id}-body rule-cell-${cell.id}-tag`}
                      onClick={() => chooseCell(cell)} onKeyDown={moveRadio}>
                      <span className="rule-matrix__title">{cell.title}</span>
                      <span className="rule-matrix__body" id={`rule-cell-${cell.id}-body`}>{cell.body}</span>
                      <span className={`rule-matrix__tag rule-matrix__tag--${cell.tone}`} id={`rule-cell-${cell.id}-tag`}>{cell.tag}</span>
                      {/* The board's " · selected" suffix as its own line, so the tag never wraps (aria-checked carries it). */}
                      {cell.selected ? (
                        <span className="rule-matrix__selected" aria-hidden="true">
                          <span className="rule-matrix__check"><CheckMark /></span>Selected
                        </span>
                      ) : null}
                    </button>
                  </React.Fragment>
                ))}
              </div>
              <SummaryList rows={[
                ['Uncertainty', model.summary.uncertainty], ['Final two', model.summary.finale], ['Recruitment', model.summary.recruitment],
              ]} />
              {advancedFields}
            </div>
          </div>
          {footer(2)}
        </section>

        {/* Step 3 — Nation & role (V1 board 03, restyled into the frame) */}
        <section className="setup-step" id="setup-step-role" data-step="3" hidden={step !== 3} aria-labelledby="setup-role-title">
          <div className="setup-step__body">
            <div className="setup-main">
              <div className="setup-heading">
                {stepHeading(3, 'setup-role-title', model.roleTitle)}
                <p className="setup-lede setup-lede--meta">{model.roleMeta}</p>
              </div>
              <div className="setup-group">
                <Kicker id="setup-role-label" title="Your role" />
                <div className="setup-card-grid" role="radiogroup" aria-labelledby="setup-role-label">
                  {ROLE_CARDS.map(card => (
                    <OptionCard key={card.value} idBase={`setup-role-${card.value}`} card={card}
                      checked={model.role === card.value} onSelect={value => pick('role', value)} />
                  ))}
                </div>
              </div>
              {manager ? (
                <div className="setup-group setup-group--list">
                  <Kicker id="setup-team-label" title={`Your ${model.noun}`} aside={`${model.field} ${model.nouns} · A–Z`} />
                  {model.teams.length ? (
                    <div className="setup-teams" role="radiogroup" aria-labelledby="setup-team-label" aria-required="true"
                      ref={nationList} onKeyDown={typeAhead}>
                      {model.teams.map((team, index) => {
                        const checked = team.id === setup.managedTeamId;
                        const focusable = checked || (!model.managed && index === 0);
                        return (
                          <button type="button" role="radio" key={team.id} aria-checked={checked} tabIndex={focusable ? 0 : -1}
                            className="setup-team" data-name={team.name} onClick={() => choose('managedTeamId', team.id, setup.managedTeamId)}
                            onKeyDown={moveRadio}>
                            <TeamRowMark team={team} />
                            <span className="setup-team__name">{team.name}</span>
                            <span className="setup-team__eff num">{team.ratingText}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : <p className="setup-empty">No {model.nouns} in this theatre.</p>}
                  {/* Native mirror of the team radios (PLAN §4.7 `#setup-managed-team`, value-bound). */}
                  <select id="setup-managed-team" className="setup-mirror" aria-hidden="true" tabIndex={-1} value={setup.managedTeamId || ''}
                    onChange={event => pick('managedTeamId', event.target.value)}>
                    <option value="" disabled>Choose your team</option>
                    {model.teams.map(team => <option key={team.id} value={team.id}>{`${team.name} · ${team.ratingText} strength`}</option>)}
                  </select>
                  <p className="control-help setup-teams__help">Management stays with this team until elimination. You can follow any team independently.</p>
                </div>
              ) : (
                <p className="setup-role-note">Spectators never wait for input: draws, results and signings run on their own. Follow any empire from the map once the campaign starts.</p>
              )}
            </div>

            <div className="setup-side">
              {manager ? (
                model.managed ? <SelectedTeam team={model.managed} noun={model.noun} /> : (
                  <div className="setup-pick setup-pick--empty">
                    <p className="setup-pick__kicker">Selected {model.noun}</p>
                    <p className="setup-pick__placeholder">Pick a {model.noun} from the list to see its strength, rank and best players.</p>
                  </div>
                )
              ) : null}
              <TeamShortlist id="setup-favourites" title="Favourites" teams={model.favourites} />
              <TeamShortlist id="setup-long-shots" title="Long shots" teams={model.longShots} />
            </div>
          </div>
          {footer(3)}
        </section>
      </form>
    </div>
  );
}
