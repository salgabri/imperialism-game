import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const compiled = await build({
  stdin: { contents: `
    export {default as SetupOverlay} from './src/components/SetupOverlay.jsx';
    export {default as SaveControls} from './src/components/SaveControls.jsx';
    export {default as DrawCompass} from './src/components/DrawCompass.jsx';
    export {default as WorldMap} from './src/components/WorldMap.jsx';
    export {default as ExportCheckpoint} from './src/components/ExportCheckpoint.jsx';
  `, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
  loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { SetupOverlay, SaveControls, DrawCompass, WorldMap, ExportCheckpoint } = module.exports;
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
after(() => dom.window.close());

async function mount(Component, props) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(Component === DrawCompass ? React.createElement('svg', null, React.createElement(Component, props)) : React.createElement(Component, props)));
  return { host, root, async close() { await act(async () => root.unmount()); host.remove(); } };
}

test('setup presents rules, role, reproducible settings and honest session preview', () => {
  const markup = renderToStaticMarkup(React.createElement(SetupOverlay, {
    setup: { sport: 'football', layer: 'nations', scope: 'elite', pacing: 'duel', resolution: 'ticker', role: 'manager', seed: '42', finale: 'best-of-three' },
  }));
  assert.match(markup, /take all of the loser/);
  assert.match(markup, /some signings add bench options/);
  assert.match(markup, /up to three signings/);
  assert.match(markup, /31–33 matches/);
  assert.match(markup, /id="setup-seed"[^>]*value="42"/);
  assert.match(markup, /neutral transit/i);
  assert.doesNotMatch(markup, /Progress saved after every match/);
});

test('import forwards the chosen file and permits the same file to be chosen again', async () => {
  const imported = [];
  const view = await mount(SaveControls, { status: { ok: false, message: 'Progress could not be saved' }, onImport: file => imported.push(file) });
  assert.match(view.host.querySelector('[role=status]').textContent, /could not/);
  const input = view.host.querySelector('input');
  const file = new dom.window.File(['{}'], 'campaign.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
  await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
  assert.deepEqual(imported, [file, file]);
  assert.equal(input.value, '');
  await view.close();
});

// The Sidebar history test and the AcquisitionChoice test moved with their screens (W3): see ledger-chronicle.test.mjs
// ("history filters archived fixtures…") and conquest-screen.test.mjs ("ported AcquisitionChoice contract…").

test('compass pause controls its existing animation rather than restarting it', async () => {
  let created = 0, paused = 0, resumed = 0, canceled = 0;
  dom.window.Element.prototype.animate = () => { created++; return { pause() { paused++; }, play() { resumed++; }, cancel() { canceled++; } }; };
  const props = { x: 0, y: 0, angle: 810, stage: 'spinning', durationMs: 1550 };
  const view = await mount(DrawCompass, props);
  await act(async () => view.root.render(React.createElement('svg', null, React.createElement(DrawCompass, { ...props, paused: true }))));
  await act(async () => view.root.render(React.createElement('svg', null, React.createElement(DrawCompass, { ...props, paused: false }))));
  assert.equal(created, 1);
  assert.equal(paused, 1);
  assert.ok(resumed >= 1);
  await view.close();
  assert.equal(canceled, 1);
  delete dom.window.Element.prototype.animate;
});

test('map has one country tab stop, arrow navigation and owner announcements', async () => {
  const svgRef = React.createRef();
  const view = await mount(WorldMap, {
    countries: ['a', 'b', 'c'].map((id, i) => ({ id, ownerId: id, ownerName: `Owner ${id}`, name: `Land ${id}`, d: `M${i * 10} 0h5v5h-5z`, strokeWidth: 1, onClick() {} })),
    flagPatterns: [], graticule: { d: '' }, homes: [], battleMarks: [], labels: [], ownership: {}, tooltip: {}, playing: true, svgRef,
    onPointerMove() {},
  });
  assert.equal(view.host.querySelectorAll('[data-country][tabindex="0"]').length, 1);
  const first = view.host.querySelector('[data-country="a"]');
  assert.match(first.getAttribute('aria-label'), /held by Owner a/);
  await act(async () => first.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  assert.equal(document.activeElement.dataset.country, 'b');
  assert.equal(view.host.querySelectorAll('[data-country][tabindex="0"]').length, 1);
  await view.close();
});

test('export checkpoint preserves JSON, exposes download/close and supports copy fallback', async () => {
  let downloads = 0, closes = 0;
  const checkpoint = '{"seed":42,"round":3}';
  const view = await mount(ExportCheckpoint, { text: checkpoint, filename: 'campaign-42.json', onDownload: () => downloads++, onClose: () => closes++ });
  const textarea = view.host.querySelector('textarea');
  assert.equal(textarea.value, checkpoint);
  assert.equal(textarea.readOnly, true);
  assert.equal(view.host.querySelector(`label[for="${textarea.id}"]`).textContent, 'Campaign checkpoint JSON');
  const button = label => [...view.host.querySelectorAll('button')].find(item => item.textContent === label);
  await act(async () => button('Download JSON').click());
  assert.equal(downloads, 1);
  await act(async () => button('Copy JSON').click());
  assert.match(view.host.querySelector('[role=status]').textContent, /usual Copy command/);
  assert.equal(document.activeElement, textarea);
  assert.equal(textarea.selectionStart, 0);
  assert.equal(textarea.selectionEnd, checkpoint.length);
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let copied;
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async value => { copied = value; } } } });
    await act(async () => button('Copy JSON').click());
    assert.equal(copied, checkpoint);
    assert.match(view.host.querySelector('[role=status]').textContent, /Copied/);
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else delete globalThis.navigator;
  }
  await act(async () => button('Close').click());
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(closes, 2);
  await view.close();
});
