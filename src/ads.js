// AdSense: Google's script and the banner unit (components/AdSlot.jsx). Real ads stay off until VITE_ADSENSE_CLIENT
// names a publisher (README "Advertising"). Placeholders show where each banner goes, without any request to Google:
// on any build when the address carries ?ads=preview, and on a dev server with a publisher unless VITE_ADSENSE_TEST=on.

// The esbuild test bundles have no import.meta.env.
const env = import.meta.env || {};

export const AD_CLIENT = env.VITE_ADSENSE_CLIENT || null;
/** The display ad unit behind every banner; each placement sets its exact size (AdSlot `size`). */
export const AD_SLOT = (AD_CLIENT && env.VITE_ADSENSE_SLOT) || null;
/** Test requests: the display unit sends data-adtest. */
export const AD_TEST = !!AD_CLIENT && env.VITE_ADSENSE_TEST === 'on';
const SCRIPT_URL = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

/** How banners show, set once by loadAds before the first render: 'off', 'preview' (placeholders) or 'live'. */
export let adsMode = 'off';

/**
 * Called once from main.jsx. Sets <html data-ads>, which ad-slot.css reads: "preview", "live" once the script is added,
 * or "blocked" when it fails to load (an ad blocker, offline).
 */
export function loadAds(doc = globalThis.document) {
  if (!doc || adsMode !== 'off') return;
  const root = doc.documentElement;
  const asked = new URLSearchParams(doc.defaultView?.location?.search || '').get('ads') === 'preview';
  if (asked || (AD_CLIENT && env.DEV && !AD_TEST)) {
    adsMode = root.dataset.ads = 'preview';
    return;
  }
  if (!AD_CLIENT) return;
  const win = doc.defaultView;
  win.adsbygoogle = win.adsbygoogle || [];
  const script = doc.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `${SCRIPT_URL}?client=${encodeURIComponent(AD_CLIENT)}`;
  script.addEventListener('error', () => { root.dataset.ads = 'blocked'; });
  adsMode = root.dataset.ads = 'live';
  doc.head.append(script);
}

/**
 * Queues one freshly mounted <ins class="adsbygoogle"> for an ad. Google fills the first unfilled unit in the page, which
 * is the right one because the game shows at most one: the setup rail's, the Ledger's or the Chronicle's.
 */
export function fillAdUnit(win = globalThis.window) {
  if (adsMode !== 'live' || !win) return;
  // An ad blocker can swap adsbygoogle for a stub that throws.
  try { win.adsbygoogle.push({}); } catch { /* no ad, nothing else to do */ }
}
