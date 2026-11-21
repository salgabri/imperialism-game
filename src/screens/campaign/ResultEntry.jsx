// Owner: scores entered by you (README §Scores entered by you, src/engine/enteredResult.js). "Enter the result",
// docked in the Map column in place of Next fixture (in either role), as the target choice is: the match waiting for
// the score the player types in after playing it somewhere else. Never a dialog, so the map and its attack arrow stay in
// view. One form: the two scores (and a level football score's shoot-out), a line saying what the score does, Confirm
// and Simulate. Enter confirms a complete result, else moves to the first empty field. The primary (masthead, phone
// bar, Space) confirms too, or brings you here while the score is incomplete (App.primaryAction).
import React, { useEffect, useRef } from 'react';
import TeamMark from '../../components/TeamMark.jsx';
import './result-entry.css';

/** A score field: digits only (the App keeps them, src/engine/enteredResult.js scoreText), the phone's number pad. */
function ScoreField({ id, value, label, last, onChange, onKeyDown }) {
  return (
    <input id={id} className="result-entry__field" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={3}
      autoComplete="off" spellCheck={false} enterKeyHint={last ? 'done' : 'next'} aria-label={label}
      value={value} onChange={event => onChange(event.target.value)} onKeyDown={onKeyDown} />
  );
}

export default function ResultEntry({
  round = '', a, b, unit = 'score', draft = {}, shootout = false, ready = false, line = '', series = null,
  onDraft, onSubmit, onSimulate,
}) {
  const formRef = useRef(null);
  const fields = () => [...(formRef.current?.querySelectorAll('input') || [])];

  // When the form opens with nothing else focused (a draw under autoplay, a reload) or from the primary, a mouse and
  // keyboard player can type at once. Not on a touch screen, where focus would pop the keyboard over the map.
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest?.('[data-primary]')) return;
    if (!window.matchMedia?.('(pointer: fine)')?.matches) return;
    fields()[0]?.focus?.({ preventScroll: true });
  }, []);

  if (!a || !b) return null;
  const set = key => value => onDraft?.({ [key]: value });

  function submit(event) {
    event.preventDefault();
    if (ready) { onSubmit?.(); return; }
    // An incomplete score: on to the first empty field (Enter after the first score moves to the second).
    const empty = fields().find(field => field.value === '');
    empty?.focus();
  }
  // Enter in a field: a browser submits a form by Enter only through an enabled default button, so while Confirm waits
  // for the rest of the score the move on to the first empty field happens here. A complete score submits as usual.
  function fieldKey(event) {
    if (event.key !== 'Enter' || ready || event.nativeEvent?.isComposing) return;
    event.preventDefault();
    fields().find(field => field.value === '')?.focus();
  }

  return (
    <section className="result-entry" aria-labelledby="result-entry-title">
      <div className="kicker">
        <h2 className="kicker__title v4-column__heading" id="result-entry-title">Enter the result</h2>
        {round ? <span className="kicker__aside">{round}</span> : null}
      </div>
      <h3 className="fixture__title result-entry__title">{a.name} <span className="fixture__v">v</span> {b.name}</h3>
      {series ? <p className="result-entry__series">{series}</p> : null}
      <form id="result-entry" className="result-entry__form" ref={formRef} onSubmit={submit} noValidate>
        <div className="result-entry__scores" role="group" aria-label={`Final score, ${unit}`}>
          <span className="result-entry__team">
            <TeamMark id={a.flagId} teamId={a.teamId} code={a.code} color={a.color} isClub={a.isClub} width={28} height={21} />
            <span className="result-entry__code" aria-hidden="true">{a.code}</span>
          </span>
          <ScoreField id="result-entry-a" value={draft.a ?? ''} label={`${a.name} ${unit}`} onChange={set('a')} onKeyDown={fieldKey} />
          <span className="result-entry__dash" aria-hidden="true">–</span>
          <ScoreField id="result-entry-b" value={draft.b ?? ''} label={`${b.name} ${unit}`} last={!shootout} onChange={set('b')}
            onKeyDown={fieldKey} />
          <span className="result-entry__team result-entry__team--b">
            <span className="result-entry__code" aria-hidden="true">{b.code}</span>
            <TeamMark id={b.flagId} teamId={b.teamId} code={b.code} color={b.color} isClub={b.isClub} width={28} height={21} />
          </span>
        </div>
        {shootout ? (
          <div className="result-entry__scores result-entry__scores--pens" role="group" aria-label="Penalty shoot-out">
            <span className="result-entry__pens">Penalties</span>
            <ScoreField id="result-entry-pa" value={draft.pa ?? ''} label={`${a.name} penalties`} onChange={set('pa')} onKeyDown={fieldKey} />
            <span className="result-entry__dash" aria-hidden="true">–</span>
            <ScoreField id="result-entry-pb" value={draft.pb ?? ''} label={`${b.name} penalties`} last onChange={set('pb')}
              onKeyDown={fieldKey} />
            <span className="result-entry__pens" aria-hidden="true" />
          </div>
        ) : null}
        <div className="result-entry__foot">
          <p className={`result-entry__line${ready ? ' is-ready' : ''}`} role="status">{line}</p>
          <div className="result-entry__actions">
            <button type="submit" className="btn-primary result-entry__confirm" disabled={!ready}>Confirm result</button>
            {typeof onSimulate === 'function' && (
              <button type="button" className="btn-link result-entry__simulate" onClick={() => onSimulate()}
                title="Let the game play this match from the teams’ strengths">Simulate</button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}
