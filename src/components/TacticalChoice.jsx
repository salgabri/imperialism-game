// Owner: WP-LEDGER (see PLAN.md §4). "Match preview" dialog (DEC D10): v1 board 07 mapped to v4 tokens.
// Opened from the Next fixture block; no longer auto-opens. Contract (strategy-ui L36-47): [data-tactic] buttons
// commit immediately, copy "You are the underdog" / "Matchday variation 11.0" / "Scoring luck remains", initial
// focus on data-tactic="balanced", focus restored on close, role="dialog" aria-modal="true". Escape → onClose.
// Optional `preview` (buildMatchPreview(st, ctx), src/viewModels/ledger.js) adds the fixture header, stakes,
// tale of the tape and both XIs; optional `onSimulate` adds the "simulate the result" link.
import React, { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';
import TeamMark from './TeamMark.jsx';
import { formatWinChance, winTone } from '../viewModels/format.js';
import './dialogs.css';

function Side({ team, align }) {
  return (
    <div className={`fi-tactical-side fi-tactical-side--${align}${team.you ? ' is-you' : ''}`}>
      <span className="fi-tactical-side__mark"><TeamMark id={team.flagId} code={team.code} color={team.color} isClub={team.isClub} width={48} /></span>
      <div className="fi-tactical-side__text">
        <span className="fi-tactical-side__role">{team.role}{team.you ? ' · You' : ''}</span>
        <span className="fi-tactical-side__name">{team.name}</span>
        <span className="fi-tactical-side__eff">Strength <b>{team.eff}</b></span>
      </div>
    </div>
  );
}

function Fixture({ preview }) {
  const { a, b, odds, route } = preview;
  return (
    <div className="fi-tactical-fixture">
      <Side team={a} align="a" />
      <div className="fi-tactical-centre">
        <span className="fi-tactical-v" aria-hidden="true">v</span>
        {odds && <>
          <div className="fi-tactical-odds" role="img" aria-label={`Win chance: ${odds.aria}`}>
            <i style={{ width: `${odds.fill}%` }} />
          </div>
          <div className="fi-tactical-odds-labels" aria-hidden="true">
            <span>{odds.aLabel}</span><small>Win chance</small><span>{odds.bLabel}</span>
          </div>
        </>}
        {route && <p className="fi-tactical-route">{route}</p>}
      </div>
      <Side team={b} align="b" />
    </div>
  );
}

/** One XI row: pos · name · claimed tag (flag 16×12 + "AUT · R XII") · "↓" when out of position · rating box. */
function LineupRow({ row }) {
  const claimed = row.claimed;
  const claimedLabel = claimed ? claimed.label || [claimed.code, claimed.roman].filter(Boolean).join(' · ') : '';
  return (
    <li className="fi-tactical-xi__row">
      <span className="fi-tactical-xi__pos">{row.pos}</span>
      <span className="fi-tactical-xi__name">{row.name}</span>
      {claimed && (
        <span className="fi-tactical-xi__claimed" title="Claimed in conquest">
          {(claimed.flagId || claimed.isClub) && (
            <span className="fi-tactical-xi__from" aria-hidden="true">
              <TeamMark id={claimed.flagId} code={claimed.code} color={claimed.color} isClub={claimed.isClub} width={16} height={12} />
            </span>
          )}
          <span className="sr-only">claimed from </span>{claimedLabel}
        </span>
      )}
      {row.outOfPosition && <span className="fi-tactical-xi__oop" title="Out of position"><span aria-hidden="true">↓</span><span className="sr-only">out of position</span></span>}
      <span className="rating-box" data-tier={row.tier}>{row.rating}</span>
    </li>
  );
}

function Lineup({ team, label = 'Starting XI', short = 'XI' }) {
  if (!team?.lineup?.length) return null;
  return (
    <section className="fi-tactical-xi" aria-label={`${team.name} · ${label}`}>
      <div className="kicker">
        <span className="kicker__title">{team.code || team.name} · {label}</span>
        {team.xi && <span className="kicker__aside">{short} {team.xi}</span>}
      </div>
      <ol className="fi-tactical-xi__list">
        {team.lineup.map(row => <LineupRow key={row.key} row={row} />)}
      </ol>
    </section>
  );
}

function Tape({ rows = [], a, b }) {
  if (!rows.length) return null;
  return (
    <section className="fi-tactical-tape" aria-labelledby="tactical-tape-title">
      <div className="kicker"><h2 className="kicker__title" id="tactical-tape-title">Tale of the tape</h2></div>
      <ul className="fi-tactical-tape__list">
        {rows.map(row => (
          <li key={row.key} className="fi-tactical-tape__row">
            <span className="sr-only">{row.label}: {a?.name} {row.a}, {b?.name} {row.b}</span>
            <span className={`fi-tactical-tape__value${row.lead === 'a' ? ' is-lead' : ''}`} aria-hidden="true">{row.a}</span>
            <span className="fi-tactical-tape__bar fi-tactical-tape__bar--a" aria-hidden="true"><i className={row.lead === 'a' ? 'is-lead' : undefined} style={{ width: `${row.aPct}%` }} /></span>
            <span className="fi-tactical-tape__label" aria-hidden="true">{row.label}</span>
            <span className="fi-tactical-tape__bar fi-tactical-tape__bar--b" aria-hidden="true"><i className={row.lead === 'b' ? 'is-lead' : undefined} style={{ width: `${row.bPct}%` }} /></span>
            <span className={`fi-tactical-tape__value fi-tactical-tape__value--b${row.lead === 'b' ? ' is-lead' : ''}`} aria-hidden="true">{row.b}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Outcome generation waits until this pre-match decision is committed. */
export default function TacticalChoice({ choice, preview = null, onChoose, onClose, onSimulate }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.querySelector('[data-tactic="balanced"]')?.focus();
    const keys = event => {
      if (event.key === 'Escape' && closeRef.current) { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const buttons = [...(dialog?.querySelectorAll('button:not(:disabled)') || [])];
      if (!buttons.length) return;
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
    };
    document.addEventListener('keydown', keys);
    return () => { document.removeEventListener('keydown', keys); if (previous?.isConnected) previous.focus(); };
  }, []);
  if (!choice) return null;
  const options = choice.options || [];
  const context = options[0]?.context || '';
  const rich = !!preview?.a && !!preview?.b;
  // With the board-07 preview the fixture header already names both sides and the footer says how to kick off, so the
  // standfirst keeps only the strength context (one line); the plain dialog keeps the full sentence.
  const standfirst = rich && context ? context
    : [`${choice.managerName} faces ${choice.opponentName}.`, context, 'Commit an approach to start the match.'].filter(Boolean).join(' ');
  return (
    <div className="dialog-backdrop fi-tactical-backdrop">
      <section ref={dialogRef} className={`dialog fi-tactical${rich ? ' has-preview' : ''}`} role="dialog" aria-modal="true"
        aria-labelledby="tactical-title" aria-describedby="tactical-description">
        <div className="fi-tactical-top">
          <p className="fi-tactical-kicker">
            <span className="fi-tactical-kicker__main">{preview?.kicker || 'Match preview'}</span>
            <span className="fi-tactical-kicker__aside">Manager decision · before the match</span>
          </p>
          {onClose && <button type="button" className="icon-button fi-tactical-close" aria-label="Close match preview" onClick={onClose}><Icon name="close" size={18} /></button>}
        </div>
        {rich ? <Fixture preview={preview} /> : (
          <p className="fi-tactical-headline">{choice.managerName}<span className="fi-tactical-headline__v"> v </span>{choice.opponentName}</p>
        )}
        {preview?.stakes && (
          <div className="fi-tactical-stakes">
            <p className="fi-tactical-stake fi-tactical-stake--win"><span>If you win</span>{preview.stakes.win}</p>
            <p className="fi-tactical-stake fi-tactical-stake--lose"><span>If you lose</span>{preview.stakes.lose}</p>
          </div>
        )}
        <div className="fi-tactical-body">
          {rich && <Lineup team={preview.a} label={preview.lineupLabel} short={preview.lineupShort} />}
          <div className="fi-tactical-main">
            {/* Board 07 order: the tale of the tape sits level with both XI headers, the approach choice below it. */}
            {rich && <Tape rows={preview.tape} a={preview.a} b={preview.b} />}
            <div className="fi-tactical-approach">
              <div className="kicker">
                <h1 className="kicker__title" id="tactical-title">Choose your approach</h1>
                <span className="kicker__aside">Locks at kick-off</span>
              </div>
              <p id="tactical-description" className="fi-tactical-standfirst">{standfirst}</p>
              <div className="fi-tactical-options">
                {options.map(option => {
                  const recommended = option.id === 'balanced';
                  const bonus = Number(option.bonus) || 0;
                  const support = Number(option.support) || 0;
                  return (
                    <button type="button" key={option.id} data-tactic={option.id} onClick={() => onChoose(option.id)}
                      className={`fi-tactical-option${recommended ? ' is-default' : ''}`}>
                      <span className="radio-square" aria-hidden="true" />
                      <span className="fi-tactical-option__body">
                        {/* Reserve support is a tag on the name row (beside "Default", which only Balanced carries and
                            Balanced never has support), so it never adds a line to the row. */}
                        <span className="fi-tactical-option__name"><strong>{option.label}</strong>
                          {recommended && <span className="fi-tactical-option__tag">Default</span>}
                          {support > 0 && <span className="fi-tactical-option__support" title={`Reserve support contributes +${support.toFixed(2)} to this approach.`}>Reserve support +{support.toFixed(2)}</span>}
                        </span>
                        <span className="fi-tactical-option__desc">{option.description}</span>
                        <span className="fi-tactical-option__meta">
                          <span className="fi-tactical-rating">Match strength {Number(option.strength).toFixed(1)} <small>({bonus >= 0 ? '+' : '−'}{Math.abs(bonus).toFixed(2)})</small></span>
                          <span className="fi-tactical-risk">Matchday variation {Number(option.drama).toFixed(1)} / 12 <small>Normal: {Number(option.baseDrama).toFixed(1)}</small></span>
                        </span>
                      </span>
                      {Number.isFinite(option.winProbability) && (
                        <span className="fi-tactical-option__chance">
                          <b className={`tone-${winTone(option.winProbability)}`}>{formatWinChance(option.winProbability)}</b>
                          <small>estimated chance to win</small>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="fi-tactical-note">Variation changes matchday form for both teams. Scoring luck remains at every setting. Your starting lineup stays the same; reserve support changes the approach’s match strength.</p>
            </div>
          </div>
          {rich && <Lineup team={preview.b} label={preview.lineupLabel} short={preview.lineupShort} />}
        </div>
        {/* Sticky footer: the "simulate the result" escape hatch stays in view however far the panel scrolls. */}
        <p className="fi-tactical-foot">
          {onSimulate
            ? <>Pick an approach to kick off and watch it live, or <button type="button" className="btn-link" onClick={onSimulate}>simulate the result</button>.</>
            : 'Pick an approach to kick off and watch it live.'}
        </p>
      </section>
    </div>
  );
}
