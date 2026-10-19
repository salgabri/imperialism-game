// Owner: WP-CONQ (see PLAN.md §4). Conquest result and signing choice (boards D1/D2, DEC D15, A-2, A-8).
// A screen, not a modal: never role="dialog" or aria-modal. The options list is a [data-space-primary] radiogroup
// with roving tabindex; arrows/Home/End move the selection (onSelect), Space reaches App's primary action and
// Enter confirms here. Props: the buildConquest model + FROZEN onSelect(index), onConfirm().
import React, { useEffect, useRef } from 'react';
import { conquestFromChoice } from '../../viewModels/conquest.js';
import './conquest.css';

function step(key) {
  switch (key) {
    case 'ArrowDown': case 'ArrowRight': return 1;
    case 'ArrowUp': case 'ArrowLeft': return -1;
    default: return 0;
  }
}

export default function ConquestScreen(props) {
  const { onSelect, onConfirm } = props;
  // Before conquestModel() is wired to buildConquest it passes the W1 stub { choice, selectedIndex }.
  const model = Array.isArray(props.options) ? props : conquestFromChoice(props.choice, props.selectedIndex);
  const {
    kicker = 'Conquest', kickerRight = 'Result', headline = 'Conquest', standfirst = '', effects = [],
    claimTitle = 'Claim one player', claimAside = 'Change to your XI', options = [], ctaLabel = null,
    waitNote = 'The campaign waits for your choice.', comparison = null,
  } = model || {};
  const listRef = useRef(null);

  useEffect(() => {
    // Initial focus lands on the selected option (PLAN §3.5; the screen replaces the old focus-trapped modal).
    listRef.current?.querySelector('[role="radio"][aria-checked="true"]')?.focus({ preventScroll: true });
  }, []);

  function focusOption(position) {
    listRef.current?.querySelectorAll('[role="radio"]')[position]?.focus();
  }

  function handleKeyDown(event, position) {
    const option = options[position];
    if (!option || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      // A held key auto-repeats: the repeat would land on the row the first press just selected and sign the
      // player without a second deliberate press. Only a fresh press acts (Space has the same guard in App).
      if (event.repeat) return;
      if (option.selected) onConfirm?.();
      else onSelect?.(option.index);
      return;
    }
    let next = null;
    const delta = step(event.key);
    if (delta) next = (position + delta + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    if (next == null || !options[next]) return;
    event.preventDefault();
    if (!options[next].selected) onSelect?.(options[next].index);
    focusOption(next);
  }

  return (
    <article className="screen screen--conquest" aria-labelledby="conquest-headline" tabIndex={-1}>
      <div className="conquest-kicker">
        <span className="conquest-kicker__title">{kicker}</span>
        <span className="conquest-kicker__aside">{kickerRight}</span>
      </div>
      <h1 id="conquest-headline" className="conquest-headline">{headline}</h1>
      {standfirst && <p className="conquest-standfirst">{standfirst}</p>}
      {effects.length > 0 && (
        <dl className="conquest-effects">
          {effects.map(effect => (
            <div key={effect.key || effect.label} className="conquest-effect">
              <dt className="conquest-effect__label">{effect.label}</dt>
              <dd className="conquest-effect__value">{effect.value}</dd>
              {(effect.detail || effect.detailMore) && (
                <dd className="conquest-effect__detail"
                  title={effect.detailFull && effect.detailFull !== effect.detail ? effect.detailFull : undefined}>
                  <span className="conquest-effect__text">{effect.detail}</span>
                  {effect.detailMore && <>{' '}<span className="conquest-effect__more">{effect.detailMore}</span></>}
                </dd>
              )}
            </div>
          ))}
        </dl>
      )}
      <div className="kicker conquest-claim-head">
        <span className="kicker__title">{claimTitle}</span>
        <span className="kicker__aside">{claimAside}</span>
      </div>
      <div ref={listRef} className="conquest-options" role="radiogroup" data-space-primary aria-label="Claim one player">
        {options.map((option, position) => (
          <div key={option.key || option.index} role="radio" aria-checked={!!option.selected}
            tabIndex={option.selected || (!options.some(item => item.selected) && position === 0) ? 0 : -1}
            className="conquest-option" data-index={option.index}
            onClick={() => { if (!option.selected) onSelect?.(option.index); }}
            onKeyDown={event => handleKeyDown(event, position)}>
            <span className="radio-square conquest-option__radio" aria-hidden="true" />
            <span className="conquest-option__body">
              <span className="conquest-option__name">{option.name}</span>
              <span className="conquest-option__meta">
                <span className="conquest-option__base">{option.base || option.meta}</span>
                {option.base && option.note && <span className="conquest-option__note"> · {option.note}</span>}
              </span>
            </span>
            <span className={`conquest-option__gain tone-${option.tone === 'gain' ? 'gain' : 'muted'}`}>{option.gain}</span>
          </div>
        ))}
      </div>
      {comparison && (
        <details className="conquest-compare">
          <summary className="conquest-compare__summary">
            <span className="conquest-compare__title">{comparison.summary}</span>
            <span className="conquest-compare__ratings">{comparison.beforeRating} → {comparison.afterRating}</span>
            <svg className="conquest-compare__chevron" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
              <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" />
            </svg>
          </summary>
          <table className="v4-table conquest-compare__table">
            <caption className="conquest-compare__caption">{comparison.caption}</caption>
            <thead>
              <tr><th scope="col">Position</th><th scope="col">Before</th><th scope="col">After</th></tr>
            </thead>
            <tbody>
              {comparison.rows.map(row => (
                <tr key={row.key} className={row.changed ? 'is-changed' : undefined}>
                  <th scope="row">{row.position}</th>
                  <td>{row.before.name} <span className="conquest-compare__rating">{row.before.rating}</span></td>
                  <td>{row.after.name} <span className="conquest-compare__rating">{row.after.rating}{row.after.outOfPosition ? ' · out of position' : ''}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {comparison.support && <p className="conquest-compare__support">{comparison.support}</p>}
        </details>
      )}
      {ctaLabel && (
        <div className="conquest-footer">
          <button type="button" className="btn-primary conquest-footer__cta" onClick={() => onConfirm?.()}>
            <span className="conquest-footer__label">{ctaLabel}</span>
          </button>
          <p className="conquest-footer__note">{waitNote}</p>
        </div>
      )}
    </article>
  );
}
