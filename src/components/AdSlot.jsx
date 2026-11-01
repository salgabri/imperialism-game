// An AdSense banner (src/ads.js): one unit under an "Advertisements" kicker, the only label AdSense allows besides
// "Sponsored Links". `size` is set inline on the unit, as AdSense supports (not from a stylesheet); `className` lets the
// placement's CSS position the slot and hide it where it doesn't fit. In preview the unit is a placeholder of the same
// size. Renders nothing while ads are off, or live without a slot.
import React, { useEffect, useId, useRef } from 'react';
import { AD_CLIENT, AD_SLOT, AD_TEST, adsMode, fillAdUnit } from '../ads.js';
import './ad-slot.css';

export default function AdSlot({ className = '', size = [300, 250] }) {
  const titleId = useId();
  const slotRef = useRef(null);
  useEffect(() => {
    const slot = slotRef.current;
    if (!slot || adsMode !== 'live') return undefined;
    const view = slot.ownerDocument.defaultView;
    // The ad is requested once the slot has a size, so a slot that CSS hides (a phone narrower than the unit, a short
    // window) asks for nothing until it shows.
    if (!view.ResizeObserver) {
      if (view.getComputedStyle(slot).display !== 'none') fillAdUnit();
      return undefined;
    }
    const observer = new view.ResizeObserver(entries => {
      if (!entries.some(entry => entry.contentRect.width > 0)) return;
      observer.disconnect();
      fillAdUnit();
    });
    observer.observe(slot);
    return () => observer.disconnect();
  }, []);
  if (adsMode === 'off' || (adsMode === 'live' && !AD_SLOT)) return null;
  const [width, height] = size;
  return (
    <section ref={slotRef} className={className ? `ad-slot ${className}` : 'ad-slot'} aria-labelledby={titleId}>
      <div className="kicker"><span className="kicker__title" id={titleId}>Advertisements</span></div>
      {adsMode === 'preview'
        ? <div className="ad-slot__unit ad-slot__unit--preview" style={{ width, height }}>Ad space · {width} × {height}</div>
        : <ins className="adsbygoogle ad-slot__unit" style={{ width, height }} data-ad-client={AD_CLIENT} data-ad-slot={AD_SLOT}
          {...(AD_TEST ? { 'data-adtest': 'on' } : {})} />}
    </section>
  );
}
