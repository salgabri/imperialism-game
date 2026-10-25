// Owner: WP-TURN (see PLAN.md §4). The 52px turn strip under the masthead (M§4, DEC D3, A-15); 40px on phones.
// Presentational: the model comes from viewModels/turns.js buildTurnStrip(); `variant: null` renders nothing.
import React, { useEffect, useRef } from 'react';
import TeamMark from '../../components/TeamMark.jsx';
import './turns.css';

const STATE_TEXT = { done: 'attacked this round', current: 'attacking now', next: 'still to attack', out: 'eliminated' };

function entryText(entry) {
  const state = entry.state === 'next' && entry.nextUp ? 'attacks next' : STATE_TEXT[entry.state] || '';
  return `${entry.name || entry.code}${entry.you ? ' (you)' : ''}, ${state}`;
}

/** Keep the current attacker centred when the queue is wider than its row (layout read/write only, no timers). */
function centreCurrent(list) {
  const flag = list?.querySelector?.('[data-state="current"]');
  if (!list || !flag || !(list.scrollWidth > list.clientWidth)) return;
  list.scrollLeft = Math.max(0, flag.offsetLeft - (list.clientWidth - flag.offsetWidth) / 2);
}

/** Flag (or club monogram) at the strip's sizes: current 32×24, others 20×15 (CSS resizes them on phones). */
function Mark({ entry, current = false }) {
  const width = current ? 32 : 20;
  return <TeamMark id={entry.flagId} teamId={entry.teamId} code={entry.code} color={entry.color} isClub={entry.isClub} width={width} height={width * .75} />;
}

function Detail({ detail, detailShort }) {
  if (detailShort && detail.startsWith(detailShort) && detail !== detailShort) {
    return <span className="turn-strip__detail">{detailShort}<span className="turn-strip__tail">{detail.slice(detailShort.length)}</span></span>;
  }
  return <span className="turn-strip__detail">{detail}</span>;
}

export default function TurnStrip({
  variant = null, label = '', detail = '', detailShort = '', phoneLabel = '', entries = [], recent = [], next = null, note = null,
}) {
  const listRef = useRef(null);
  const currentId = entries.find(entry => entry.state === 'current')?.teamId ?? null;
  // Centre the current attacker on a turn change and again whenever the row's width changes (resize, breakpoint).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    centreCurrent(list);
    const view = list.ownerDocument?.defaultView;
    if (typeof view?.ResizeObserver === 'function') {
      const observer = new view.ResizeObserver(() => centreCurrent(list));
      observer.observe(list);
      return () => observer.disconnect();
    }
    const onResize = () => centreCurrent(list);
    view?.addEventListener?.('resize', onResize);
    return () => view?.removeEventListener?.('resize', onResize);
  }, [variant, currentId, entries.length]);
  if (!variant) return null;
  const roundRobin = variant === 'round-robin';
  return (
    <section className="turn-strip" data-variant={variant} aria-label="Turn order">
      <div className="turn-strip__head">
        <span className="turn-strip__label">{label}</span>
        <Detail detail={detail} detailShort={detailShort} />
      </div>
      {/* Phone only (display:none ≥700px, where the head carries the same words), so it is read exactly once. */}
      {phoneLabel && !roundRobin && <span className="turn-strip__phone">{phoneLabel}</span>}
      {/* tabIndex: the row scrolls horizontally when the queue is wider than the strip (World scope, tablet). */}
      {roundRobin && entries.length > 0 && (
        <ol ref={listRef} className="turn-strip__flags" aria-label="Attack order this round" tabIndex={0}>
          {entries.map((entry, i) => (
            <li key={`${entry.teamId}-${i}`} className={`turn-strip__flag${entry.nextUp ? ' is-next-up' : ''}`}
              data-state={entry.state} title={entry.code || entry.name}
              aria-current={entry.state === 'current' ? 'step' : undefined}>
              <Mark entry={entry} current={entry.state === 'current'} />
              <span className="sr-only">{entryText(entry)}</span>
            </li>
          ))}
        </ol>
      )}
      {!roundRobin && recent.length > 0 && <>
        <span className="turn-strip__divider" aria-hidden="true" />
        <span className="turn-strip__recent-label" id="turn-strip-recent">Recent attackers</span>
        {/* Never scrolls (items that do not fit whole are clipped, still read), so it is no tab stop. The visible
            code is hidden from AT (and from view on phones), the sr-only name reads the same at every width. */}
        <ol className="turn-strip__recent" aria-labelledby="turn-strip-recent">
          {recent.map(item => (
            <li key={item.key} className="turn-strip__recent-item" title={item.name || item.code}>
              <Mark entry={item} />
              <span className="turn-strip__code" aria-hidden="true">{item.code}{item.roman && <> <span className="turn-strip__roman">{item.roman}</span></>}</span>
              <span className="sr-only">{`${item.name || item.code}${item.roman ? `, Round ${item.roman}` : ''}`}</span>
            </li>
          ))}
        </ol>
      </>}
      {next && <span className="turn-strip__next">{next}</span>}
      {note && <span className="turn-strip__note">{note}</span>}
    </section>
  );
}
