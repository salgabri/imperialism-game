// Font loading must never swap map glyphs independently of the measured layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/EmpireLabels.jsx', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'], logLevel: 'silent',
});
const componentCode = bundled.outputFiles[0].text;
const fallback = "'Arial Narrow', sans-serif";
const props = {
  geometry: [{ id: 'A', rings: [[[100, 100], [700, 100], [700, 350], [100, 350], [100, 100]]] }],
  ownership: { A: 'A' }, labels: [{ id: 'A', text: 'ASYNCFONT' }],
  viewBox: { x: 0, y: 0, w: 960, h: 540 }, unitsPerPixel: 1, mapMode: 'flags',
};

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture({ load, headless = false } = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
  const saved = new Map(['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const measurements = [], requests = [];
  let webfontLoaded = false;
  if (load) Object.defineProperty(dom.window.document, 'fonts', { configurable: true, value: {
    load(font, characters) { requests.push({ font, characters }); return load(font, characters); },
  } });
  if (!headless) {
    dom.window.SVGElement.prototype.getComputedTextLength = () => 100;
    const context = { font: '', measureText(text) {
      measurements.push({ text, font: this.font, webfontLoaded });
      return { width: 100 * (this.font.includes('Archivo Narrow') && webfontLoaded ? 4 : 8) };
    } };
    dom.window.HTMLCanvasElement.prototype.getContext = () => context;
  } else dom.window.HTMLCanvasElement.prototype.getContext = () => { throw new Error('headless path must not require canvas'); };
  // Fresh module state per case isolates the production family/text cache.
  const module = { exports: {} };
  new Function('require', 'module', 'exports', componentCode)(require, module, module.exports);
  const Component = module.exports.default;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root'));
  let unmounted = false;
  const render = async (overrides = {}) => {
    await act(async () => root.render(React.createElement('svg', {}, React.createElement(Component, { ...props, ...overrides }))));
  };
  const text = () => dom.window.document.querySelector('[data-empire-label="A"]');
  await render();
  return { dom, measurements, requests, render, text,
    async complete(pending) { webfontLoaded = true; await act(async () => pending.resolve([{ family: 'Archivo Narrow', status: 'loaded' }])); },
    async unmount() { if (!unmounted) { await act(async () => root.unmount()); unmounted = true; } },
    async close() {
      if (!unmounted) await act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    },
  };
}

test('delayed Archivo Narrow loading keeps measured/rendered fallback together, then remeasures once', async () => {
  const pending = deferred(), f = await fixture({ load: () => pending.promise });
  try {
    assert.equal(f.requests.length, 1);
    assert.match(f.requests[0].font, /^600 100px ['"]?Archivo Narrow['"]?$/);
    assert.ok(f.requests[0].characters.includes('A'));
    assert.equal(f.text().getAttribute('font-family'), fallback);
    assert.equal(f.text().getAttribute('font-weight'), '600');
    assert.equal(f.measurements.length, 1);
    assert.equal(f.measurements[0].font, `600 100px ${fallback}`);
    const before = Number(f.text().getAttribute('textLength'));
    await f.complete(pending);
    const loadedFamily = f.text().getAttribute('font-family');
    assert.match(loadedFamily, /^['"]Archivo Narrow['"],/);
    assert.equal(f.measurements.length, 2, 'same name is remeasured after the face loads');
    assert.equal(f.measurements[1].font, `600 100px ${loadedFamily}`, 'canvas and SVG use identical family and weight');
    assert.ok(f.measurements[1].webfontLoaded, 'Archivo Narrow was never measured while unloaded');
    assert.ok(Number(f.text().getAttribute('textLength')) < before * .7, 'new advance invalidates geometric placement');
    await f.render({ labels: [{ ...props.labels[0] }], mapMode: 'political' });
    assert.equal(f.measurements.length, 2, 'equivalent names and map styling reuse measured widths');
    assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});

test('a newly needed Unicode subset uses explicit fallback until that subset is ready', async () => {
  const first = deferred(), second = deferred();
  let request = 0;
  const f = await fixture({ load: () => (++request === 1 ? first.promise : second.promise) });
  try {
    await f.complete(first);
    await f.render({ labels: [{ id: 'A', text: 'ČESKÁ' }] });
    assert.equal(f.requests.length, 2);
    assert.ok(f.requests[1].characters.includes('Č'));
    assert.equal(f.text().getAttribute('font-family'), fallback, 'new glyphs cannot silently swap under old metrics');
    assert.equal(f.measurements.at(-1).font, `600 100px ${fallback}`);
    await f.complete(second);
    assert.match(f.text().getAttribute('font-family'), /Archivo Narrow/);
    assert.equal(f.measurements.at(-1).font, `600 100px ${f.text().getAttribute('font-family')}`);
  } finally { await f.close(); }
});

test('rejected, missing, and synchronously failing font loads retain visible safe fallback labels', async () => {
  for (const load of [() => Promise.reject(new Error('missing local font')), () => Promise.resolve([]), () => { throw new Error('unsupported load'); }]) {
    const f = await fixture({ load });
    try {
      assert.ok(f.text(), 'font failure never removes map labels');
      assert.equal(f.text().getAttribute('font-family'), fallback);
      assert.ok(f.measurements.every(item => item.font === `600 100px ${fallback}`));
    } finally { await f.close(); }
  }
});

test('headless environments without FontFaceSet or canvas still render deterministic labels', async () => {
  const f = await fixture({ headless: true });
  try {
    assert.ok(f.text());
    assert.equal(f.text().getAttribute('font-family'), fallback);
    assert.ok(Number(f.text().getAttribute('textLength')) > 0);
    assert.equal(f.requests.length, 0);
    assert.equal(f.measurements.length, 0);
  } finally { await f.close(); }
});

test('late font completion after unmount does not measure or render a detached map', async () => {
  const pending = deferred(), f = await fixture({ load: () => pending.promise });
  try {
    await f.unmount();
    const before = f.measurements.length;
    await f.complete(pending);
    assert.equal(f.text(), null);
    assert.equal(f.measurements.length, before);
  } finally { await f.close(); }
});

test('your own empire is measured and drawn at 700 in ink; other empires stay 600 at 72%', async () => {
  const pending = deferred(), f = await fixture({ load: () => pending.promise });
  try {
    await f.render({ meId: 'A', mapMode: 'political' });
    const own = f.text();
    assert.equal(own.getAttribute('font-weight'), '700');
    assert.equal(own.dataset.own, 'true');
    assert.equal(f.measurements.at(-1).font, `700 100px ${fallback}`, 'the bold advance is measured, not reused');
    assert.equal(own.getAttribute('fill'), '#111417');
    assert.equal(Number(own.getAttribute('fill-opacity')), 1);
    assert.equal(own.getAttribute('stroke'), '#ffffff');
    assert.equal(Number(own.getAttribute('stroke-opacity')), .35);
    await f.complete(pending);
    assert.equal(f.measurements.at(-1).font, `700 100px ${f.text().getAttribute('font-family')}`);
    assert.equal(f.requests.length, 1, 'one variable face serves both weights');

    await f.render({ meId: 'B', mapMode: 'political' });
    const other = f.text();
    assert.equal(other.getAttribute('font-weight'), '600');
    assert.equal(other.dataset.own, undefined);
    assert.equal(other.getAttribute('fill'), '#2c3236');
    assert.equal(Number(other.getAttribute('fill-opacity')), .72);
    assert.equal(Number(other.getAttribute('stroke-opacity')), .5);
    const size = Number(other.getAttribute('font-size'));
    assert.ok(Math.abs(Number(other.getAttribute('stroke-width')) - size * .12) < 1e-9, 'halo = 12% of the font size');
    assert.ok(Math.abs(Number(other.getAttribute('letter-spacing')) / size - .14) < 1e-9, '.14em tracking');
    assert.equal(other.getAttribute('paint-order'), 'stroke');
  } finally { await f.close(); }
});

test('flags mode switches to white letters on an ink halo without measuring again', async () => {
  const f = await fixture({ load: () => Promise.reject(new Error('offline')) });
  try {
    await f.render({ mapMode: 'political' });
    const measured = f.measurements.length;
    const placement = f.text().getAttribute('transform');
    await f.render({ mapMode: 'flags' });
    assert.equal(f.text().getAttribute('fill'), '#ffffff');
    assert.equal(f.text().getAttribute('stroke'), '#111417');
    assert.equal(f.measurements.length, measured, 'map styling never remeasures');
    assert.equal(f.text().getAttribute('transform'), placement, 'map styling never relays out');
  } finally { await f.close(); }
});
