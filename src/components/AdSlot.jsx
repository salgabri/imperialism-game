// The side-column ad (src/ads.js): one fixed 300×250 AdSense unit under an "Advertisements" kicker, the only label
// AdSense allows besides "Sponsored Links". Renders nothing until src/ads.js has a publisher and a slot.
import React, { useEffect, useId, useRef } from 'react';
import { AD_CLIENT, AD_SLOT, AD_TEST, fillAdUnit } from '../ads.js';
import './ad-slot.css';

export default function AdSlot() {
  const titleId = useId();
  const slotRef = useRef(null);
  useEffect(() => {
    // A slot ad-slot.css hides (a phone narrower than the unit) asks for nothing.
    const slot = slotRef.current;
    if (slot && slot.ownerDocument.defaultView.getComputedStyle(slot).display !== 'none') fillAdUnit();
  }, []);
  if (!AD_SLOT) return null;
  return (
    <section ref={slotRef} className="ad-slot" aria-labelledby={titleId}>
      <div className="kicker"><span className="kicker__title" id={titleId}>Advertisements</span></div>
      <ins className="adsbygoogle ad-slot__unit" data-ad-client={AD_CLIENT} data-ad-slot={AD_SLOT}
        {...(AD_TEST ? { 'data-adtest': 'on' } : {})} />
    </section>
  );
}
