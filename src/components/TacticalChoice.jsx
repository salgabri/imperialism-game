// Owner: WP-LEDGER (see PLAN.md §4). "Match preview" dialog (DEC D10): v1 board 07 mapped to v4 tokens.
// Opened from the Next fixture block; no longer auto-opens. Contract (strategy-ui L36-47): [data-tactic] buttons
// commit immediately, initial focus on the recommended approach (the one Continue kicks off with), focus restored on
// close, role="dialog" aria-modal="true". Escape → onClose.
// Compact pass (docs/design/compact-pass.md): the decision first and whole on one screen. Three approaches side by side,
// each a name, a win chance and two small figures; what they mean is each card's title and description for screen
// readers. The tale of the tape and both XIs share one panel below, one at a time.
// Optional `preview` (buildMatchPreview(st, ctx), src/viewModels/ledger.js) adds the fixture header, stakes,
// tale of the tape and both XIs; optional `onSimulate` adds the "simulate the result" link.
import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import TeamMark from './TeamMark.jsx';
import Pager from './Pager.jsx';
import { usePagedList } from '../hooks/useFit.js';
import { recommendedTactic } from '../engine/managerStrategy.js';
import { formatWinChance, routeWorthSaying, winTone } from '../viewModels/format.js';
import './dialogs.css';

const NO_LINES = [];

/** What the variation squares mean, on their title. */
const VARIATION_NOTE = 'Variation changes matchday form for both teams. Scoring luck remains at every setting.';
/** The variation squares: matchday variation runs 0–12, drawn in six squares. */
const VARIATION_SQUARES = 6;

/** Reserve support sits in the approach's strength; said once, on the title of the reserves tag. */
const SUPPORT_NOTE = 'Your starting lineup stays the same; reserve support changes the approach’s match strength.';

/** The approach's matchday variation as filled squares, the figures on the title. */
function Variation({ drama, baseDrama }) {
  const level = Math.round((Math.max(0, Math.min(12, Number(drama) || 0)) / 12) * VARIATION_SQUARES);
  const text = `Matchday variation ${Number(drama).toFixed(1)} / 12. Normal: ${Number(baseDrama).toFixed(1)}.`;
  return (
    <span className="fi-tactical-risk" title={`${text} ${VARIATION_NOTE}`}>
      <span className="fi-tactical-risk__label">Variation</span>
      <span className="fi-tactical-risk__squares" aria-hidden="true">
        {Array.from({ length: VARIATION_SQUARES }, (_, i) => <i key={i} className={i < level ? 'is-on' : undefined} />)}
      </span>
      <span className="sr-only">{text}</span>
    </span>
  );
}

function Side({ team, align }) {
  return (
    <div className={`fi-tactical-side fi-tactical-side--${align}${team.you ? ' is-you' : ''}`}>
      <span className="fi-tactical-side__mark"><TeamMark id={team.flagId} teamId={team.teamId} code={team.code} color={team.color} isClub={team.isClub} width={48} /></span>
      <div className="fi-tactical-side__text">
        <span className="fi-tactical-side__role">{team.role}{team.you ? ' · You' : ''}</span>
        <span className="fi-tactical-side__name">{team.name}</span>
        <span className="fi-tactical-side__eff" title={`Strength ${team.eff}`}><span className="sr-only">Strength </span><b>{team.eff}</b></span>
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
        {odds && <>
          <div className="fi-tactical-odds" role="img" aria-label={`Win chance: ${odds.aria}`} title="Win chance">
            <i style={{ width: `${odds.fill}%` }} />
          </div>
          <div className="fi-tactical-odds-labels" aria-hidden="true">
            <span>{odds.aLabel}</span><span>{odds.bLabel}</span>
          </div>
        </>}
        {routeWorthSaying(route) && <p className="fi-tactical-route">{route}</p>}
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
              <TeamMark id={claimed.flagId} teamId={claimed.teamId} code={claimed.code} color={claimed.color} isClub={claimed.isClub} width={16} height={12} />
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

/** One side's lineup: `rows` is the page on show (the whole lineup until a phone's sheet pages it). */
function Lineup({ team, rows = team?.lineup, label = 'Starting XI', short = 'XI' }) {
  if (!team?.lineup?.length) return null;
  return (
    <section className="fi-tactical-xi" aria-label={`${team.name} · ${label}`}>
      <div className="kicker">
        <span className="kicker__title">{team.code || team.name} · {label}</span>
        {team.xi && <span className="kicker__aside">{short} {team.xi}</span>}
      </div>
      <ol className="fi-tactical-xi__list" data-long={team.lineup.length > 13 ? '' : undefined}>
        {rows.map(row => <LineupRow key={row.key} row={row} />)}
      </ol>
    </section>
  );
}

function Tape({ rows = [], a, b }) {
  if (!rows.length) return null;
  return (
    <section className="fi-tactical-tape" aria-labelledby="tactical-tape-title">
      <h2 className="sr-only" id="tactical-tape-title">Tale of the tape</h2>
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
  const [panel, setPanel] = useState('tape');
  // Lineups longer than a phone's sheet (ice hockey fields 19, American football 23) page together, as on the Match
  // screen; elsewhere the panel is as tall as its rows and keeps them all.
  const linesA = preview?.a?.lineup || NO_LINES, linesB = preview?.b?.lineup || NO_LINES;
  const xi = usePagedList(linesA.length >= linesB.length ? linesA : linesB, { row: '.fi-tactical-xi__row' });
  const xiPage = lines => (Number.isFinite(xi.pageSize) ? lines.slice(xi.start, xi.start + xi.pageSize) : lines);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const recommended = recommendedTactic(choice?.options || []);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.querySelector(`[data-tactic="${recommended}"]`)?.focus();
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
  // With the board-07 preview the fixture header already names both sides; the plain dialog keeps the full sentence.
  // Read by screen readers as the dialog's description: on screen the odds say the same.
  const standfirst = rich && context ? context
    : [`${choice.managerName} faces ${choice.opponentName}.`, context, 'Commit an approach to start the match.'].filter(Boolean).join(' ');
  return (
    <div className="dialog-backdrop fi-tactical-backdrop">
      <section ref={dialogRef} className={`dialog fi-tactical${rich ? ' has-preview' : ''}`} role="dialog" aria-modal="true"
        aria-labelledby="tactical-title" aria-describedby="tactical-description">
        <div className="fi-tactical-top">
          <p className="fi-tactical-kicker">
            <span className="fi-tactical-kicker__main">{preview?.kicker || 'Match preview'}</span>
          </p>
          {onSimulate && <button type="button" className="btn-link fi-tactical-simulate" onClick={onSimulate}>Simulate the result</button>}
          {onClose && <button type="button" className="icon-button fi-tactical-close" aria-label="Close match preview" onClick={onClose}><Icon name="close" size={18} /></button>}
        </div>
        {rich ? <Fixture preview={preview} /> : (
          <p className="fi-tactical-headline">{choice.managerName}<span className="fi-tactical-headline__v"> v </span>{choice.opponentName}</p>
        )}
        {preview?.stakes && (
          <div className="fi-tactical-stakes">
            <p className="fi-tactical-stake fi-tactical-stake--win" title={preview.stakes.winTitle}><span>If you win</span>{preview.stakes.win}</p>
            <p className="fi-tactical-stake fi-tactical-stake--lose"><span>If you lose</span>{preview.stakes.lose}</p>
          </div>
        )}
        <div className="fi-tactical-body">
          <div className="fi-tactical-approach">
            <h1 className="sr-only" id="tactical-title">Choose your approach</h1>
            <p id="tactical-description" className="sr-only">{standfirst}</p>
            <div className="fi-tactical-options">
              {options.map(option => {
                const isDefault = option.id === recommended;
                const bonus = Number(option.bonus) || 0;
                const support = Number(option.support) || 0;
                return (
                  <button type="button" key={option.id} data-tactic={option.id} onClick={() => onChoose(option.id)}
                    title={option.description} className={`fi-tactical-option${isDefault ? ' is-default' : ''}`}>
                    <span className="fi-tactical-option__name"><strong>{option.label}</strong>
                      {isDefault && <span className="fi-tactical-option__tag">Recommended</span>}
                    </span>
                    <span className="fi-tactical-option__desc sr-only">{option.description}</span>
                    <span className="fi-tactical-option__meta">
                      <span className="fi-tactical-rating" title={`Match strength ${Number(option.strength).toFixed(1)}`}>Strength <b>{bonus >= 0 ? '+' : '−'}{Math.abs(bonus).toFixed(2)}</b></span>
                      <Variation drama={option.drama} baseDrama={option.baseDrama} />
                      {support > 0 && <span className="fi-tactical-option__support" title={`Reserve support contributes +${support.toFixed(2)} to this approach. ${SUPPORT_NOTE}`}>Reserves +{support.toFixed(2)}</span>}
                    </span>
                    {Number.isFinite(option.winProbability) && (
                      <span className="fi-tactical-option__chance" title="Estimated chance to win">
                        <b className={`tone-${winTone(option.winProbability)}`}>{formatWinChance(option.winProbability)}</b>
                        <span className="sr-only">estimated chance to win</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          {rich && (
            <div className="fi-tactical-main">
              <div className="segmented fi-tactical-panels" role="group" aria-label="Match detail">
                <button type="button" aria-pressed={panel === 'tape'} onClick={() => setPanel('tape')}>Tale of the tape</button>
                <button type="button" aria-pressed={panel === 'lineups'} onClick={() => setPanel('lineups')}>Lineups</button>
              </div>
              <div className="fi-tactical-panel" hidden={panel !== 'tape'}><Tape rows={preview.tape} a={preview.a} b={preview.b} /></div>
              <div className="fi-tactical-panel fi-tactical-lineups" hidden={panel !== 'lineups'} ref={xi.boxRef}>
                <Pager page={xi.page} pages={xi.pages} onPage={xi.setPage} label="Lineup pages" className="fi-tactical-lineups__pager" />
                <Lineup team={preview.a} rows={xiPage(linesA)} label={preview.lineupLabel} short={preview.lineupShort} />
                <Lineup team={preview.b} rows={xiPage(linesB)} label={preview.lineupLabel} short={preview.lineupShort} />
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
