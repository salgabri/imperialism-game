// Owner: WP-SETUP (see PLAN.md §4). Three-step campaign setup (PLAN A-5): Campaign → Rules → Your role, in the
// board-12 frame and v4 tokens. Every step stays mounted (inactive ones carry `hidden`) so the DOM contract of PLAN
// §4.7 holds on every step: theatre, the draw and match settings, managed team and the `Launch campaign` submit button.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import SaveControls from './SaveControls.jsx';
import TeamMark from './TeamMark.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import * as setupModel from '../screens/setup/setupModel.js';
import { themedPaint } from '../theme.js';
import './setup.css';

// Frozen named exports (kept for the module contract). Definitions live in the pure model module.
export const PACING_OPTIONS = setupModel.PACING_OPTIONS;
export const RESOLUTION_OPTIONS = setupModel.RESOLUTION_OPTIONS;
export const PACING_HELP = setupModel.PACING_HELP;
export const campaignPreview = setupModel.campaignPreview;
export const domesticDescription = setupModel.domesticDescription;

const {
  SETUP_STEPS, DRAW_CARDS, TARGETING_CARDS, ROLE_CARDS, CONQUEST_RULES, UNCERTAINTY_OPTIONS, UNCERTAINTY_HELP, FINALE_OPTIONS,
  FINALE_HELP, RECRUITMENT_OPTIONS, RECRUITMENT_HELP, ROSTER_OPTIONS, ROSTER_HELP, SHOW_MATCH_OPTIONS, showMatchesWrites,
} = setupModel;

/** Focus inside one of these keeps Space for itself (A-8). */
const SPACE_IGNORE = 'input, select, textarea, button, summary, a[href], [role="radio"], [role="button"], [role="dialog"], [aria-modal="true"], [contenteditable]:not([contenteditable="false"])';
/** Stable default so an omitted `managerTeams` prop does not invalidate the model memo on every render. */
const NO_TEAMS = Object.freeze([]);
/** App's chosen-country map state when no country is chosen (`domesticStatus()` shape, without `onRetry`). */
const IDLE_DOMESTIC = Object.freeze({ state: 'idle', message: null });
/** App's Season state with no data sets listed or chosen (`seasonStatus()` shape, without `onRetry`). */
const IDLE_SEASON = Object.freeze({ sets: NO_TEAMS, state: 'idle', message: null, sport: null });

function focusQuietly(element) {
  element?.focus?.({ preventScroll: true });
}

/** Centre a list's checked row inside the list's own scroll box only (scrollIntoView would also scroll the page). */
function centreChecked(list) {
  const row = list?.querySelector?.('[aria-checked="true"]');
  if (row) list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - (list.clientHeight - row.offsetHeight) / 2;
}

function CheckMark() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m5 12 5 5 9-10" /></svg>
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
function OptionCard({ idBase, card, checked, onSelect }) {
  return (
    <button type="button" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1}
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

/**
 * Step 1's map card: the theatre's opening board, each starting territory in its team's kick-off pastel over the land
 * nobody holds. A world theatre's `preview` comes from `setupModel.theatreMapPreview`, a country's from
 * `setupModel.countryMapPreview` (its sections over the neighbouring land). Static and decorative — no camera, labels or
 * territory attributes; the caption, description and stats carry the same facts in text. Memoised: App re-renders
 * setup on every state change, and `preview` keeps its identity per board.
 */
const TheatreMap = React.memo(function TheatreMap({ preview, caption, loading = false, kind }) {
  if (!preview && !loading) return null;
  return (
    <figure className="setup-map" aria-hidden="true" data-state={preview ? 'ready' : 'loading'} data-kind={kind}>
      {preview ? (
        <svg className="setup-map__chart" viewBox={preview.viewBox} preserveAspectRatio="xMidYMid meet" focusable="false">
          <g className="setup-map__backdrop">
            {preview.backdrop.map((shape, index) => <path key={`${shape.id}-${index}`} d={shape.d} />)}
          </g>
          <g className="setup-map__sections">
            {preview.sections.map(section => <path key={section.id} d={section.d} fill={section.fill} style={{ fill: themedPaint(section.fill) }} />)}
          </g>
        </svg>
      ) : <div className="setup-map__chart setup-map__placeholder" />}
      <figcaption className="setup-map__caption">{caption}</figcaption>
    </figure>
  );
});

/** The world card's caption: "Europe · 46 nations, each on its own land" (clubs are dealt out, README §The club layer). */
function theatreCaption(model, preview) {
  const teams = `${preview.teams} ${preview.teams === 1 ? model.noun : model.nouns}`;
  return `${model.scopeName} · ${teams}${model.clubLayer ? ' dealt onto the nearest free land' : ', each on its own land'}`;
}

/**
 * The setup wizard. Props are App's (HEAD) setup props plus optional `onCancel` (header Cancel, only with a save) and
 * the country-campaign props: `domestic` (App's `domesticStatus()`: { state, message, onRetry, preview? }),
 * `launching` (App prepares a country campaign) and `restoring` (a saved country campaign waits for its map).
 * `theatreMap` is App's `setupMapPreview()`: a world theatre's opening board for step 1's map card, or null.
 * `season` is App's `seasonStatus()` ({ sets, state, message, sport, onRetry }) for football data sets.
 */
export default function SetupOverlay({
  setup = {}, hasSave = false, savedText = '', saveStatus, onResume, onDiscard, onPick, onStart,
  onExport, onImport, onManageSaves, onCancel, managerTeams = NO_TEAMS,
  domestic = IDLE_DOMESTIC, launching = false, restoring = false, theatreMap = null, season = IDLE_SEASON,
}) {
  const [step, setStep] = useState(1);
  const [confirmation, setConfirmation] = useState(null);
  const headings = useRef({});
  const nationList = useRef(null);
  const theatreList = useRef(null);
  const navigated = useRef(false);
  const keepSaveButton = useRef(null);
  const clearSaveButton = useRef(null);
  /** Where focus goes after the quick-resume confirmation opens or closes: 'keep' | 'trigger' | 'heading'. */
  const confirmationFocus = useRef(null);
  // App passes a fresh `onStart` arrow on every render; the Space listener reads the latest one through this ref.
  const startRef = useRef(onStart);
  // App passes a fresh `domestic` object (with a fresh `onRetry`) every render: the model keys on its values only.
  const mapState = domestic?.state || 'idle';
  const mapMessage = domestic?.message || null;
  // Likewise `season`: its list and sport keep their identity until they change.
  const { sets: seasonSets = NO_TEAMS, state: seasonState = 'idle', message: seasonMessage = null, sport: seasonSport = null } = season || IDLE_SEASON;
  const model = useMemo(() => setupModel.buildSetupModel(setup, {
    managerTeams, domestic: { state: mapState, message: mapMessage }, launching,
    season: { sets: seasonSets, state: seasonState, message: seasonMessage, sport: seasonSport },
  }), [setup, managerTeams, mapState, mapMessage, launching, seasonSets, seasonState, seasonMessage, seasonSport]);
  const { rules } = model;
  const manager = model.role === 'manager';
  /** Football clubs also offer one country's own top clubs: a long, scrolling theatre list in two groups. */
  const countries = model.domesticScopes.length > 0;

  const pick = (key, value) => onPick?.(key, value);
  function choose(key, value, current) { if (value !== current) pick(key, value); }
  function theatreRadio(scope) {
    const checked = scope.id === model.scopeId;
    const describedBy = scope.note ? `setup-theatre-note-${scope.id}`
      : checked && model.country ? 'setup-theatre-description' : undefined;
    return (
      <button type="button" role="radio" key={scope.id} aria-checked={checked} tabIndex={checked ? 0 : -1}
        className="setup-theatre" data-name={scope.label} aria-describedby={describedBy}
        onClick={() => choose(model.scopeKey, scope.id, model.scopeId)} onKeyDown={moveRadio}>
        <span className="setup-theatre__name">
          {scope.label}{scope.note ? <span className="setup-theatre__mark" aria-hidden="true">*</span> : null}
        </span>
        {/* A chosen data set's counts are unknown until it loads. */}
        <span className="setup-theatre__count num">{scope.count == null ? '' : `${scope.count} ${model.nouns}`}</span>
      </button>
    );
  }
  const theatreChoices = rows => rows.map(scope => (
    <option value={scope.id} key={scope.id}>{scope.count == null ? scope.label : `${scope.label} · ${scope.count} ${model.nouns}`}</option>
  ));
  function goTo(next) {
    const target = Math.min(3, Math.max(1, next));
    navigated.current = true;
    // The discard confirmation belongs to step 1's quick-resume card; leaving the step dismisses it.
    if (target !== 1) setConfirmation(null);
    setStep(target);
  }
  /** A draw card writes its pacing and, for a one-match draw, its turn order (only the keys that change). */
  function chooseDraw(value) {
    const card = DRAW_CARDS.find(item => item.value === value);
    if (!card) return;
    choose('pacing', card.pacing, rules.pacing);
    if (card.turnOrder) choose('turnOrder', card.turnOrder, rules.stored.turnOrder);
  }
  function showMatches(mode) {
    for (const [key, value] of showMatchesWrites(mode, setup)) pick(key, value);
  }

  useEffect(() => { startRef.current = onStart; });

  // On mount, move focus into the wizard (it covers the whole app) unless a modal dialog already holds it. A chosen
  // country can sit far down the long theatre list: centre it there.
  useEffect(() => {
    if (countries) centreChecked(theatreList.current);
    if (typeof document === 'undefined' || document.querySelector('[aria-modal="true"]')) return;
    focusQuietly(headings.current[1]);
  }, []);

  // After a step change, move focus to that step's heading (the scroll body is per step, so it starts at the top).
  useEffect(() => {
    if (!navigated.current) return;
    headings.current[step]?.focus?.();
    // Centre the chosen team (or a chosen country) inside its own list.
    if (step === 3) centreChecked(nationList.current);
    else if (step === 1 && countries) centreChecked(theatreList.current);
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
    if (launching) return;
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
            disabled={!model.canLaunch} aria-busy={launching || undefined}>Launch campaign</button>
        )}
      </footer>
    );
  }

  const moreRules = (
    <details className="setup-advanced">
      <summary>
        <Icon name="chevron" size={16} />
        <span className="setup-advanced__title">More rules</span>
        <small className="setup-advanced__values" title={model.moreRules}>{model.moreRules}</small>
      </summary>
      <div className="setup-settings-fields">
        <label className="control-field" htmlFor="setup-uncertainty"><span>Upsets</span>
          <select id="setup-uncertainty" value={model.uncertainty} onChange={event => pick('uncertainty', event.target.value)}>
            {UNCERTAINTY_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <small className="control-help">{UNCERTAINTY_HELP[model.uncertainty]}</small>
        </label>
        <label className="control-field" htmlFor="setup-finale"><span>Final</span>
          <select id="setup-finale" value={model.finale} onChange={event => pick('finale', event.target.value)}>
            {FINALE_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <small className="control-help">{FINALE_HELP[model.finale]}</small>
        </label>
        <label className="control-field" htmlFor="setup-recruitment"><span>Computer signings</span>
          <select id="setup-recruitment" value={model.acquisitionPolicy} onChange={event => pick('acquisitionPolicy', event.target.value)}>
            {RECRUITMENT_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <small className="control-help">{RECRUITMENT_HELP[model.acquisitionPolicy]}</small>
        </label>
        {model.sport.id === 'basketball' ? (
          <label className="control-field" htmlFor="setup-roster-preset"><span>Team strengths</span>
            <select id="setup-roster-preset" value={model.rosterPreset} onChange={event => pick('rosterPreset', event.target.value)}>
              {ROSTER_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <small className="control-help">{ROSTER_HELP[model.rosterPreset]}</small>
          </label>
        ) : null}
        <label className="control-field" htmlFor="setup-seed"><span>Seed (optional)</span>
          <input id="setup-seed" type="number" min="1" max="4294967295" step="1" inputMode="numeric" placeholder="Random"
            value={setup.seed ?? ''} onChange={event => pick('seed', event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />
          <small className="control-help">Replays the same campaign with the same rules and choices. Leave blank for a new one.</small>
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
          {onCancel ? <button type="button" className="setup-head__cancel" disabled={restoring} onClick={onCancel}>Cancel</button> : null}
          <ThemeToggle className="setup-head__theme" />
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
                        <button type="button" className="btn-secondary setup-save__resume" disabled={restoring} onClick={onResume}>Resume</button>
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

              {/* Football seasons: only when a local data set is listed (or chosen), so the built-in setup is unchanged. */}
              {model.season ? (
                <div className="setup-group setup-group--list">
                  <Kicker id="setup-season-label" title="Season" />
                  <div className="setup-theatres" role="radiogroup" aria-labelledby="setup-season-label" aria-describedby="setup-season-note"
                    data-long={model.season.options.length > 5 ? '' : undefined}>
                    {model.season.options.map(option => (
                      <button type="button" role="radio" key={option.key} aria-checked={option.checked} tabIndex={option.checked ? 0 : -1}
                        className="setup-theatre" data-name={option.label} aria-label={option.label}
                        onClick={() => choose('dataSet', option.id, model.season.id)} onKeyDown={moveRadio}>
                        <span className="setup-theatre__name">{option.season}</span>
                        <span className="setup-theatre__count">{option.source}</span>
                      </button>
                    ))}
                  </div>
                  <p className="setup-theatres__note" id="setup-season-note">{model.season.note}</p>
                  {model.season.state === 'loading' ? <p className="setup-domestic__status" role="status">{model.season.loading}</p> : null}
                  {model.season.state === 'error' ? (
                    <div className="rule-note setup-domestic__error" role="alert">
                      <Icon name="info" size={20} />
                      <p>{model.season.message}{' '}
                        <button type="button" className="btn-link rule-note__action" onClick={() => season?.onRetry?.()}>Retry</button>
                      </p>
                    </div>
                  ) : null}
                  {/* Native mirror of the season radios, value-bound like `#setup-theatre` ('' is the built-in season). */}
                  <select id="setup-season" className="setup-mirror" aria-hidden="true" tabIndex={-1} value={model.season.id ?? ''}
                    onChange={event => pick('dataSet', event.target.value || null)}>
                    {model.season.options.map(option => <option value={option.id ?? ''} key={option.key}>{option.label}</option>)}
                  </select>
                </div>
              ) : null}

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
                <Kicker id="setup-theatre-label" title="Theatre" aside="Where the war is fought" />
                {/* One radiogroup for leagues and countries: a single tab stop, and arrow keys walk from one into the other. */}
                <div className="setup-theatres" role="radiogroup" aria-labelledby="setup-theatre-label" ref={theatreList}
                  data-long={countries ? '' : undefined} onKeyDown={countries ? typeAhead : undefined}>
                  {model.scopes.map(theatreRadio)}
                  {countries ? (
                    <>
                      <p className="setup-theatres__group" aria-hidden="true">{model.domesticGroup}</p>
                      {model.domesticScopes.map(theatreRadio)}
                    </>
                  ) : null}
                </div>
                {/* The data's "*" marker ("Asia & Oceania*") resolves to the scope's own description. */}
                {model.theatreNotes.map(scope => (
                  <p className="setup-theatres__note" id={`setup-theatre-note-${scope.id}`} key={scope.id}>
                    <span aria-hidden="true">* </span>{scope.note}
                  </p>
                ))}
                {model.country ? (
                  <>
                    <p className="setup-theatres__note setup-domestic__note" id="setup-theatre-description">{model.countryNote}</p>
                    {model.countryState === 'loading' ? (
                      <p className="setup-domestic__status" role="status">{model.mapLoading}</p>
                    ) : null}
                    {model.countryState === 'error' ? (
                      <div className="rule-note setup-domestic__error" role="alert">
                        <Icon name="info" size={20} />
                        <p>{model.countryMessage}{' '}
                          <button type="button" className="btn-link rule-note__action" onClick={() => domestic?.onRetry?.()}>Retry</button>
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {/* Native mirror of the theatre radios: keeps `#setup-theatre` value-bound for automation (PLAN §4.7). */}
                <select id="setup-theatre" className="setup-mirror" aria-hidden="true" tabIndex={-1} value={model.scopeId}
                  onChange={event => pick(model.scopeKey, event.target.value)}>
                  {countries ? (
                    <>
                      <optgroup label={model.leagueGroup}>{theatreChoices(model.scopes)}</optgroup>
                      <optgroup label={model.domesticGroup}>{theatreChoices(model.domesticScopes)}</optgroup>
                    </>
                  ) : theatreChoices(model.scopes)}
                </select>
              </div>
            </div>

            <div className="setup-side">
              {model.country ? (
                <TheatreMap kind="country" preview={domestic?.preview || null} loading={model.countryState === 'loading'}
                  caption={domestic?.preview ? `${model.country.name} · ${domestic.preview.sections.length} sections, `
                    + (model.country.sections === model.country.clubs ? 'one per club' : `${model.country.clubs} clubs`)
                    : `Loading the map of ${model.country.name}…`} />
              ) : theatreMap ? <TheatreMap kind="world" preview={theatreMap} caption={theatreCaption(model, theatreMap)} /> : null}
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
                <p className="setup-estimate__note">{model.estimateNote}</p>
                <p className="sr-only" role="status">{model.status}</p>
              </div>
              <section className="setup-saves" aria-labelledby="setup-saves-title">
                <Kicker id="setup-saves-title" title="Saves" />
                <SaveControls status={saveStatus} onExport={hasSave ? onExport : undefined} onImport={onImport} onManageSaves={onManageSaves} />
              </section>
            </div>
          </div>
          {footer(1)}
        </section>

        {/* Step 2 — Rules of war: one draw choice, then Show matches and the collapsed More rules */}
        <section className="setup-step" id="setup-step-rules" data-step="2" hidden={step !== 2} aria-labelledby="setup-rules-title">
          <div className="setup-step__body">
            <div className="setup-main">
              <div className="setup-heading">
                {stepHeading(2, 'setup-rules-title', 'Rules of war')}
                <p className="setup-lede">Choose how matches are drawn. With Random draw or Round robin, a manager can also pick their own opponents in step 3.</p>
              </div>
              <div className="rule-group">
                <Kicker id="rule-draw-label" title="The draw" />
                <div className="setup-card-grid" role="radiogroup" aria-labelledby="rule-draw-label">
                  {DRAW_CARDS.map(card => (
                    <OptionCard key={card.value} idBase={`rule-draw-${card.value}`} card={card}
                      checked={rules.draw === card.value} onSelect={chooseDraw} />
                  ))}
                </div>
                {/* Native mirror of the draw's pacing (PLAN §4.7 `#setup-pacing`, value-bound) for automation. */}
                <select id="setup-pacing" className="setup-mirror" aria-hidden="true" tabIndex={-1} value={rules.pacing}
                  onChange={event => pick('pacing', event.target.value)}>
                  {PACING_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </div>
            </div>

            <div className="setup-side">
              <div className="setup-group setup-playback">
                <Kicker id="setup-playback-label" title="Show matches" aside="Change any time" />
                <div className="control-field">
                  <select id="setup-resolution" aria-labelledby="setup-playback-label" aria-describedby="setup-resolution-help"
                    value={model.showMatches} onChange={event => showMatches(event.target.value)}>
                    {SHOW_MATCH_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                  <small className="control-help" id="setup-resolution-help">{model.showMatchesHelp}</small>
                </div>
              </div>
              {moreRules}
            </div>
          </div>
          {footer(2)}
        </section>

        {/* Step 3 — Your role (V1 board 03, restyled into the frame); a manager also picks who chooses their opponents */}
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
                <div className="setup-group setup-opponents">
                  <Kicker id="rule-target-label" title="Who picks your opponent" />
                  {rules.applies ? (
                    <>
                      <div className="segmented setup-segmented" role="radiogroup" aria-labelledby="rule-target-label"
                        aria-describedby="rule-target-help">
                        {TARGETING_CARDS.map(card => {
                          const checked = rules.targeting === card.value;
                          return (
                            <button type="button" role="radio" key={card.value} aria-checked={checked} tabIndex={checked ? 0 : -1}
                              aria-labelledby={`rule-target-${card.value}-title`}
                              onClick={() => choose('targeting', card.value, rules.targeting)} onKeyDown={moveRadio}>
                              <span id={`rule-target-${card.value}-title`}>{card.title}</span>
                            </button>
                          );
                        })}
                      </div>
                      <small className="control-help setup-opponents__help" id="rule-target-help">{rules.targetingHelp}</small>
                    </>
                  ) : (
                    <div className="rule-note" role="note" id="rule-target-none">
                      <Icon name="info" size={20} />
                      <p>{rules.note} <button type="button" className="btn-link rule-note__action" onClick={() => goTo(2)}>Change the draw</button></p>
                    </div>
                  )}
                </div>
              ) : null}
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
                  ) : <p className="setup-empty">{model.teamsEmpty}</p>}
                  {/* Native mirror of the team radios (PLAN §4.7 `#setup-managed-team`, value-bound). */}
                  <select id="setup-managed-team" className="setup-mirror" aria-hidden="true" tabIndex={-1} value={setup.managedTeamId || ''}
                    onChange={event => pick('managedTeamId', event.target.value)}>
                    <option value="" disabled>Choose your team</option>
                    {model.teams.map(team => <option key={team.id} value={team.id}>{`${team.name} · ${team.ratingText} strength`}</option>)}
                  </select>
                  <p className="control-help setup-teams__help">{`You manage this ${model.noun} until it is knocked out, then keep watching as a spectator.`}</p>
                </div>
              ) : null}
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
