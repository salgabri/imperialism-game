// AdSense (README "Advertising"): src/ads.js, components/AdSlot.jsx and the vite.config.js ads.txt plugin. Without a
// publisher nothing loads, renders or queues; with one, the script and the side-column unit carry what Google documents.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { ROOT, bundleComponents, withDom } from './lib/app-harness.mjs';
import { adsense } from '../vite.config.js';

const require = createRequire(import.meta.url);
const PUBLISHER = 'ca-pub-1234567890123456';
const SLOT = '9876543210';
const LIVE = { VITE_ADSENSE_CLIENT: PUBLISHER, VITE_ADSENSE_SLOT: SLOT };

/** src/ads.js, AdSlot and the screens that place it, as a Vite build with `env` would see them. */
async function bundleWithEnv(env) {
  const contents = [
    "export * as ads from './src/ads.js';",
    "export { default as AdSlot } from './src/components/AdSlot.jsx';",
    "export { default as SetupOverlay } from './src/components/SetupOverlay.jsx';",
    "export { default as LedgerScreen } from './src/screens/ledger/LedgerScreen.jsx';",
    "export { default as ChronicleScreen } from './src/screens/ledger/ChronicleScreen.jsx';",
  ].join('\n');
  const result = await build({
    stdin: { contents, resolveDir: ROOT, loader: 'jsx' }, jsx: 'automatic',
    bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom'], loader: { '.css': 'empty' },
    define: { 'import.meta.env': JSON.stringify({ BASE_URL: '/', DEV: false, ...env }) }, logLevel: 'silent',
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

test('without a publisher nothing loads, renders or queues', async () => {
  const { loadAds, fillAdUnit, AdSlot } = await bundleComponents({ loadAds: ['src/ads.js', 'loadAds'],
    fillAdUnit: ['src/ads.js', 'fillAdUnit'], AdSlot: 'src/components/AdSlot.jsx' });
  await withDom(async ({ window, document, mount }) => {
    loadAds(document);
    fillAdUnit(window);
    assert.equal(document.querySelectorAll('script').length, 0);
    assert.equal(document.documentElement.hasAttribute('data-ads'), false);
    assert.equal(typeof window.adsbygoogle, 'undefined');
    const view = await mount(AdSlot);
    assert.equal(view.host.innerHTML, '');
  });
});

test('a slot id without a publisher stays off', async () => {
  const { ads, AdSlot } = await bundleWithEnv({ VITE_ADSENSE_SLOT: SLOT });
  assert.equal(ads.AD_SLOT, null);
  assert.equal(renderToStaticMarkup(React.createElement(AdSlot)), '');
});

test('a build with a publisher adds Google\'s script once', async () => {
  const { ads } = await bundleWithEnv(LIVE);
  await withDom(async ({ window, document }) => {
    ads.loadAds(document);
    ads.loadAds(document);
    const scripts = document.querySelectorAll('script');
    assert.equal(scripts.length, 1, 'one script however often loadAds runs');
    const [script] = scripts;
    assert.equal(script.src, `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${PUBLISHER}`);
    assert.equal(script.async, true);
    assert.equal(script.getAttribute('crossorigin'), 'anonymous');
    assert.equal(document.documentElement.dataset.ads, 'live');
    assert.equal(window.adsbygoogle.length, 0, 'nothing queued before a slot mounts');
    script.dispatchEvent(new window.Event('error'));
    assert.equal(document.documentElement.dataset.ads, 'blocked', 'a blocked script hides the slots (ad-slot.css)');
  });
});

test('the side-column unit sits under an "Advertisements" kicker and asks for one ad when it mounts', async () => {
  const { ads, AdSlot } = await bundleWithEnv(LIVE);
  await withDom(async ({ window, document, mount }) => {
    ads.loadAds(document);
    const view = await mount(AdSlot);
    const slot = view.host.querySelector('section.ad-slot');
    assert.ok(slot, 'the slot renders');
    const label = slot.querySelector('.kicker .kicker__title');
    assert.equal(label.textContent, 'Advertisements', 'AdSense allows only "Advertisements" or "Sponsored Links"');
    assert.equal(slot.getAttribute('aria-labelledby'), label.id);
    const unit = slot.querySelector('ins');
    assert.equal(unit.className, 'adsbygoogle ad-slot__unit');
    assert.deepEqual([unit.style.width, unit.style.height], ['300px', '250px'], 'the size is inline, as AdSense supports');
    assert.equal(unit.getAttribute('data-ad-client'), PUBLISHER);
    assert.equal(unit.getAttribute('data-ad-slot'), SLOT);
    assert.equal(unit.hasAttribute('data-adtest'), false);
    assert.deepEqual([...window.adsbygoogle], [{}]);
    await view.render();
    assert.equal(window.adsbygoogle.length, 1, 'a re-render asks for no second ad');
  });
});

test('a slot that CSS hides asks for no ad', async () => {
  const { ads, AdSlot } = await bundleWithEnv(LIVE);
  await withDom(async ({ window, document, mount }) => {
    ads.loadAds(document);
    const style = document.createElement('style');
    style.textContent = '.ad-slot { display:none; }';
    document.head.append(style);
    await mount(AdSlot);
    assert.equal(window.adsbygoogle.length, 0);
  });
});

test('with a ResizeObserver, a slot asks for its ad once it first has a size, and only once', async () => {
  const { ads, AdSlot } = await bundleWithEnv(LIVE);
  await withDom(async ({ window, document, mount }) => {
    const observers = [];
    window.ResizeObserver = class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe(target) { this.target = target; }
      disconnect() { this.disconnected = true; }
      resize(width) { if (!this.disconnected) this.callback([{ target: this.target, contentRect: { width, height: width } }]); }
    };
    ads.loadAds(document);
    const view = await mount(AdSlot, { className: 'setup-rail__ad', size: [200, 200] });
    const unit = view.host.querySelector('.ad-slot.setup-rail__ad ins');
    assert.deepEqual([unit.style.width, unit.style.height], ['200px', '200px'], 'the placement sets its own size');
    const [observer] = observers;
    observer.resize(0);
    assert.equal(window.adsbygoogle.length, 0, 'hidden (a short window): no request yet');
    observer.resize(200);
    observer.resize(200);
    assert.deepEqual([...window.adsbygoogle], [{}], 'shown: one request');
    assert.equal(observer.disconnected, true);
    await view.unmount();
  });
});

test('the setup rail, the Ledger and the Chronicle each place one banner where the plan says', async () => {
  const { ads, SetupOverlay, LedgerScreen, ChronicleScreen } = await bundleWithEnv({ ...LIVE, DEV: true });
  // SetupOverlay reads the bare localStorage global, which Node 26 only warns about: lend it the jsdom's.
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  await withDom(async ({ window, document }) => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: window.localStorage });
    ads.loadAds(document);
    const render = element => {
      const host = document.createElement('div');
      host.innerHTML = renderToStaticMarkup(element);
      return host;
    };
    const setup = render(React.createElement(SetupOverlay, {
      setup: { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', pacing: 'duel', resolution: 'ticker',
        preset: 'standard', seed: '', uncertainty: 'balanced', express: false, finale: 'single', role: 'spectator', managedTeamId: '',
        acquisitionPolicy: 'highest-rated', rosterPreset: 'authentic', turnOrder: 'random', targeting: 'compass' },
      managerTeams: [], hasSave: false, savedText: '', onPick() {}, onStart() {}, onResume() {}, onDiscard() {}, onImport() {},
      onManageSaves() {},
    }));
    assert.equal(setup.querySelectorAll('.ad-slot').length, 1, 'one banner in setup, whatever the step');
    const rail = setup.querySelector('.setup-rail');
    assert.deepEqual([...rail.children].map(child => child.tagName + (child.className ? '.' + child.className : '')),
      ['NAV', 'SECTION.ad-slot setup-rail__ad'], 'the square follows the steps, outside their navigation landmark');
    assert.equal(rail.querySelector('nav').getAttribute('aria-label'), 'Setup steps');
    assert.equal(rail.querySelector('ins').style.width, '200px');

    const ledger = render(React.createElement(LedgerScreen, {
      share: { total: 1, rows: [{ key: '250', teamId: '250', name: 'France', territories: 1, pct: '100%', width: 100 }] }, fallen: [],
    }));
    assert.deepEqual([...ledger.querySelector('.ledger-side').children].map(child => child.className),
      ['ledger-share', 'ad-slot', 'ledger-fallen'], 'after the bounded share list, above the growing fallen list');

    const chronicle = render(React.createElement(ChronicleScreen, { turning: [{ key: 'upset', label: 'Biggest upset', text: 'A beat B' }] }));
    assert.deepEqual([...chronicle.querySelector('.chronicle-side').children].map(child => child.className),
      ['chronicle-turning', 'ad-slot', 'fi-activity'], 'after the turning points, above the activity feed');
  }).finally(() => {
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage); else delete globalThis.localStorage;
  });
});

test('a dev server shows the reserved slot and loads or requests nothing', async () => {
  const { ads, AdSlot } = await bundleWithEnv({ ...LIVE, DEV: true });
  await withDom(async ({ window, document, mount }) => {
    ads.loadAds(document);
    assert.equal(document.documentElement.dataset.ads, 'preview');
    assert.equal(document.querySelectorAll('script').length, 0);
    const view = await mount(AdSlot);
    assert.ok(view.host.querySelector('ins.adsbygoogle'), 'the reserved box shows where the ad goes');
    assert.equal(typeof window.adsbygoogle, 'undefined', 'no queue and no request');
  });
});

test('VITE_ADSENSE_TEST marks requests as tests and loads the script on a dev server too', async () => {
  const { ads, AdSlot } = await bundleWithEnv({ ...LIVE, DEV: true, VITE_ADSENSE_TEST: 'on' });
  await withDom(async ({ document, mount }) => {
    ads.loadAds(document);
    assert.equal(document.querySelectorAll('script').length, 1);
    const view = await mount(AdSlot);
    assert.equal(view.host.querySelector('ins').getAttribute('data-adtest'), 'on');
  });
});

test('the build writes ads.txt for the publisher and refuses malformed ids', () => {
  const emitted = [];
  adsense({ VITE_ADSENSE_CLIENT: PUBLISHER }).generateBundle.call({ emitFile: file => emitted.push(file) });
  assert.deepEqual(emitted, [{ type: 'asset', fileName: 'ads.txt', source: 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n' }]);
  const none = [];
  adsense({}).generateBundle.call({ emitFile: file => none.push(file) });
  assert.deepEqual(none, [], 'no publisher, no ads.txt');
  assert.throws(() => adsense({ VITE_ADSENSE_CLIENT: 'pub-1234567890123456' }).config(), /ca-pub-/);
  assert.throws(() => adsense({ VITE_ADSENSE_CLIENT: PUBLISHER, VITE_ADSENSE_SLOT: 'side-column' }).config(), /VITE_ADSENSE_SLOT/);
  assert.doesNotThrow(() => adsense({ VITE_ADSENSE_CLIENT: PUBLISHER, VITE_ADSENSE_SLOT: SLOT }).config());
});
