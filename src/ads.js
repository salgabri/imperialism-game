// AdSense: Google's script and the banner unit (components/AdSlot.jsx). All of it stays off until
// VITE_ADSENSE_CLIENT names a publisher (README "Advertising"). A dev server requests no ads unless
// VITE_ADSENSE_TEST=on: it shows the reserved slots instead.

// The esbuild test bundles have no import.meta.env.
const env = import.meta.env || {};

export const AD_CLIENT = env.VITE_ADSENSE_CLIENT || null;
/** The display ad unit behind every banner; each placement's CSS sets its exact size. */
export const AD_SLOT = (AD_CLIENT && env.VITE_ADSENSE_SLOT) || null;
/** Test requests: the display unit sends data-adtest. */
export const AD_TEST = !!AD_CLIENT && env.VITE_ADSENSE_TEST === 'on';
const SCRIPT_URL = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

let scriptAdded = false;

/**
 * Called once from main.jsx. Sets <html data-ads>, which ad-slot.css reads: "preview" on a dev server (empty reserved
 * slots, no script), "live" once the script is added, "blocked" when it fails to load (an ad blocker, offline).
 */
export function loadAds(doc = globalThis.document) {
  if (!AD_CLIENT || !doc || doc.documentElement.dataset.ads) return;
  const root = doc.documentElement;
  if (env.DEV && !AD_TEST) {
    root.dataset.ads = 'preview';
    return;
  }
  const win = doc.defaultView;
  win.adsbygoogle = win.adsbygoogle || [];
  const script = doc.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `${SCRIPT_URL}?client=${encodeURIComponent(AD_CLIENT)}`;
  script.addEventListener('error', () => { root.dataset.ads = 'blocked'; });
  root.dataset.ads = 'live';
  doc.head.append(script);
  scriptAdded = true;
}

/**
 * Queues one freshly mounted <ins class="adsbygoogle"> for an ad. Google fills the first unfilled unit in the page, which
 * is the right one because the game shows at most one: the setup rail's, the Ledger's or the Chronicle's.
 */
export function fillAdUnit(win = globalThis.window) {
  if (!scriptAdded || !win) return;
  // An ad blocker can swap adsbygoogle for a stub that throws.
  try { win.adsbygoogle.push({}); } catch { /* no ad, nothing else to do */ }
}
