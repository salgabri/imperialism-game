// Owner: WP-0 (see PLAN.md §4). Phone chrome (<700px; RM §2.9–2.10, A-10): the full-width primary bar, the bottom
// tab bar and the "More" sheet. Always mounted while playing; hidden by CSS at ≥700px. Named exports only.
import React, { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';
import { useLiveMinute } from './LiveMinute.jsx';

const TABS = [['map', 'Map'], ['squad', 'Squad'], ['match', 'Match'], ['ledger', 'Ledger']];

/**
 * The live minute, never below the last revealed event (`floor`): the same rule as the Match view's
 * `useMatchMinute` and the compact MatchCard, so the bar never trails the score band and feed.
 */
function PhoneMinute({ store, floor = 0, suffix = "'" }) {
  const minute = useLiveMinute(store, floor);
  return <span className="live-minute">{`${Math.max(Number(minute) || 0, Number(floor) || 0)}${suffix}`}</span>;
}

/**
 * The phone's primary action. The right text (round, live minute or signing gain) sits outside the button's
 * text content (DEC D13), so exact textContent lookups match the label alone. For the live minute,
 * `minuteFallback` is the last revealed event's minute and floors the store's value.
 */
export function PhoneBar({ primary, right = null, rightKind = null, minuteFallback = 0, minuteStore = null, onPrimary }) {
  if (!primary) return null;
  return (
    <div className="phone-bar">
      <button type="button" className="phone-bar__btn" data-primary disabled={!!primary.disabled} onClick={onPrimary}>
        <span className="phone-bar__label">{primary.label}</span>
        <svg className="phone-bar__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.6" aria-hidden="true" focusable="false"><path d="m9 6 6 6-6 6" /></svg>
      </button>
      <span className="phone-bar__right" aria-hidden="true">
        {rightKind === 'minute' && minuteStore ? <PhoneMinute store={minuteStore} floor={minuteFallback} /> : right}
      </span>
    </div>
  );
}

/** Map · Squad · Match · Ledger · More. Chronicle lives under More, which is marked current while it shows. */
export function PhoneTabBar({ active = null, hidden = false, locked = false, moreOpen = false, onView, onMore }) {
  return (
    <nav className="tabbar" aria-label="Screens (phone)" hidden={hidden || undefined}>
      {TABS.map(([id, label]) => (
        <button type="button" key={id} className="tabbar__item" aria-current={active === id && !moreOpen ? 'page' : undefined}
          disabled={locked && id !== 'map'} onClick={() => onView?.(id)}>
          <i className="tabbar__ind" aria-hidden="true" /><span>{label}</span>
        </button>
      ))}
      <button type="button" className="tabbar__item" aria-expanded={!!moreOpen} aria-controls={moreOpen ? 'phone-more' : undefined}
        aria-current={active === 'chronicle' && !moreOpen ? 'page' : undefined} onClick={onMore}>
        <i className="tabbar__ind" aria-hidden="true" /><span>More</span>
      </button>
    </nav>
  );
}

/**
 * Chronicle link, playback (autoplay/speed) and the same SettingsPanel as the masthead popover (A-10). It takes focus
 * when it opens and, when it closes with focus inside (Escape, the close button), hands focus back to its opener
 * (the More tab). `locked` (A-13: a signing or target choice holds the screen) disables the Chronicle link, as the
 * masthead nav and the tab bar do.
 */
export function PhoneMoreSheet({ onClose, onChronicle, settings = null, playback = null, locked = false }) {
  const sheetRef = useRef(null);
  useEffect(() => {
    const sheet = sheetRef.current;
    const opener = typeof document !== 'undefined' ? document.activeElement : null;
    sheet?.focus?.({ preventScroll: true });
    return () => {
      if (typeof document === 'undefined') return;
      const active = document.activeElement;
      // Focus moved elsewhere on purpose (a tab, the Chronicle panel): leave it there.
      if (active && active !== document.body && active.isConnected && !sheet?.contains(active)) return;
      const target = opener && opener !== document.body && opener.isConnected && !sheet?.contains(opener) ? opener
        : document.querySelector('.tabbar .tabbar__item[aria-expanded]');
      target?.focus?.({ preventScroll: true });
    };
  }, []);
  return (
    <section id="phone-more" ref={sheetRef} className="more-sheet" aria-label="More" tabIndex={-1}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose?.(); } }}>
      <div className="more-sheet__head">
        <h2 className="more-sheet__title">More</h2>
        <button type="button" className="icon-button" aria-label="Close more" onClick={onClose}><Icon name="close" size={18} /></button>
      </div>
      <button type="button" className="more-sheet__link" disabled={!!locked} onClick={onChronicle}><span>Chronicle</span><Icon name="chevronRight" size={16} /></button>
      {playback && <div className="more-sheet__section">{playback}</div>}
      {settings && <div className="more-sheet__section">{settings}</div>}
    </section>
  );
}
