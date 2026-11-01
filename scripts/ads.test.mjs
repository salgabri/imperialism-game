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

/** src/ads.js and AdSlot as a Vite build with `env` would see them. */
async function bundleWithEnv(env) {
  const contents = "export * as ads from './src/ads.js';\nexport { default as AdSlot } from './src/components/AdSlot.jsx';";
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
