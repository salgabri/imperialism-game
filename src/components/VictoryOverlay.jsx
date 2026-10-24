// Owner: WP-LEDGER (see PLAN.md §4). Campaign results dialog: v1 board 11 mapped to v4 (white panel, article on
// the left, the champion's XI on the right). Contract (smoke L1072-1077): [role=dialog][aria-labelledby=victory-title]
// containing "Campaign complete", #victory-title textContent === the (already upper-cased) champion name, a
// button whose text is exactly "View map", Escape → onClose, focus starts on the close button and is restored.
import React, { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import PlayerRow from './PlayerRow.jsx';
import TeamMark from './TeamMark.jsx';
import Icon from './Icon.jsx';
import { roman } from '../viewModels/format.js';
import './dialogs.css';

const HIGHLIGHTS = { biggestUpset: 'Biggest upset', decisiveMatch: 'Decisive match', transferImpact: 'Transfer impact' };

// Phone and touch (the --tap breakpoints in tokens.css): the squad's roster-source links ("EA FC 26", 47×12 on 40px
// rows) cannot get a 44px target without overlapping the next row's, so there the source reads as plain muted text,
// as on the squad phone rows. Read through useSyncExternalStore so render stays pure and follows a rotate/resize.
const TOUCH_QUERY = '(max-width:699.98px), (pointer:coarse)';
const touchQuery = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(TOUCH_QUERY) : null);
function subscribeTouch(onChange) {
  const query = touchQuery();
  query?.addEventListener?.('change', onChange);
  return () => query?.removeEventListener?.('change', onChange);
}
const touchSnapshot = () => !!touchQuery()?.matches;
const noTouch = () => false;
const withoutSourceLink = player => (player?.sourceInfo?.url ? { ...player, sourceInfo: { ...player.sourceInfo, url: undefined } } : player);

function recapText(value) {
  return typeof value === 'string' || typeof value === 'number' ? value : value?.text || value?.summary || value?.name || '';
}

function toneOf(text) {
  const value = String(text ?? '');
  return value.startsWith('+') ? 'gain' : /^[−-]/.test(value) ? 'loss' : 'muted';
}

/** A campaign's final reward, with the map and new campaign one action away. */
export default function VictoryOverlay({
  id, code, isClub, round, name = '', color, subtitle, conquests, steals, territories,
  effNow, effBase, effGain, squad = [], positionColors, onClose, onNew, onChronicle,
  recap, seed,
}) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const touch = useSyncExternalStore(subscribeTouch, touchSnapshot, noTouch);
  const rows = useMemo(() => (touch ? squad.map(withoutSourceLink) : squad), [touch, squad]);
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === 'Escape') { event.preventDefault(); closeCallback.current?.(); return; }
      if (event.key !== 'Tab') return;
      const buttons = dialogRef.current?.querySelectorAll('button:not(:disabled), [tabindex="0"], a[href]');
      if (!buttons?.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); if (previous?.isConnected) previous.focus(); };
  }, []);

  const roundNumber = Number(round) || 0;
  const entries = Object.entries(recap || {}).filter(([, value]) => value != null && value !== '');
  const highlights = entries.filter(([key]) => HIGHLIGHTS[key]);
  const record = entries.filter(([key]) => !HIGHLIGHTS[key]);
  const gainText = effGain?.text ?? '';
  return (
    <div className="dialog-backdrop fi-victory-backdrop">
      <section className="dialog fi-victory" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="victory-title" aria-describedby="victory-description">
        <button ref={closeRef} type="button" className="icon-button fi-victory-close" onClick={onClose} aria-label="Close campaign results"><Icon name="close" size={19} /></button>
        <div className="fi-victory-main">
          <div className="fi-victory-eyebrow">
            <span className="fi-victory-emblem"><TeamMark id={id} code={code || name.slice(0, 3)} color={color} isClub={isClub || !id} width={48} /></span>
            <span className="fi-victory-kicker">Campaign complete · Round {roundNumber ? roman(roundNumber) : round}</span>
          </div>
          <h1 id="victory-title" className="fi-victory-title">{name}</h1>
          <p id="victory-description" className="fi-victory-standfirst">{subtitle}</p>
          <dl className="fi-victory-stats">
            <div><dt>Conquests</dt><dd>{conquests}</dd></div>
            <div><dt>Players claimed</dt><dd className="tone-claimed">{steals}</dd></div>
            <div><dt>Territories</dt><dd>{territories}</dd></div>
            <div><dt>Strength gained</dt><dd className={`tone-${toneOf(gainText)}`}>{gainText}</dd></div>
          </dl>
          {highlights.length > 0 && (
            <div className="fi-victory-recap" role="group" aria-label="Campaign highlights">
              {highlights.map(([key, value]) => (
                <div key={key}><strong>{HIGHLIGHTS[key]}</strong><p>{recapText(value)}</p></div>
              ))}
            </div>
          )}
          {record.length > 0 && (
            <dl className="fi-victory-record" role="group" aria-label="Campaign record">
              {record.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{recapText(value)}</dd></div>)}
            </dl>
          )}
          {seed != null && <p className="fi-victory-seed">Campaign seed {seed} · export the campaign to keep its match archive</p>}
          <div className="fi-victory-actions">
            <button type="button" className="btn-primary fi-victory-primary" onClick={onNew}>New campaign <Icon name="arrow" size={17} /></button>
            <button type="button" className="btn-secondary" onClick={onClose}>View map</button>
            {onChronicle && <button type="button" className="btn-secondary" onClick={onChronicle}>Read the chronicle</button>}
          </div>
        </div>
        <aside className="fi-victory-side" aria-labelledby="victory-squad-title">
          <div className="kicker fi-victory-squad-heading">
            <h2 className="kicker__title" id="victory-squad-title">The champion's squad</h2>
            <span className="kicker__aside">Strength {effBase} → {effNow}</span>
          </div>
          <div className="fi-victory-squad">{rows.map((player, i) => <PlayerRow key={i} player={player} positionColors={positionColors} roomy />)}</div>
        </aside>
      </section>
    </div>
  );
}
