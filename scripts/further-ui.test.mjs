import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const compiled = await build({
  stdin: { contents: `
    export {default as WorldMap} from './src/components/WorldMap.jsx';
  `, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
  loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { WorldMap } = module.exports;
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
after(() => dom.window.close());

async function mount(Component, props, context) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const view = {
    host,
    async render(nextProps) { await act(async () => root.render(React.createElement(Component, nextProps))); },
    async close() { await act(async () => root.unmount()); host.remove(); },
  };
  context.after(() => view.close());
  await view.render(props);
  return view;
}

// The four Sidebar history / follow tests moved with their screens (W3): ledger-chronicle.test.mjs (history filter,
// selection, leaving and returning, uncontrolled local state), squad-screen.test.mjs ("Back to history" label, Escape),
// view-router.test.mjs (Back from a Chronicle squad focuses the selected history row) and turn-panels.test.mjs (managed
// identity pinned, #followed-team picker).

const mapProps = () => ({ countries: [], flagPatterns: [], graticule: { d: '' }, homes: [], battleMarks: [], labels: [], ownership: {}, tooltip: {}, playing: true, svgRef: React.createRef(), onPointerMove() {}, viewResetKey: 'world' });
const viewBox = view => view.host.querySelector('svg.political-map').getAttribute('viewBox').split(' ').map(Number);

test('explicit conquests zoom in and Back restores the prior exploration camera and keyboard focus', async context => {
  const props = mapProps();
  const view = await mount(WorldMap, props, context);
  await act(async () => view.host.querySelector('[aria-label="Zoom in"]').click());
  const previous = viewBox(view);
  await view.render({ ...props, focusBounds: { x: 440, y: 260, w: 30, h: 20 }, focusKey: 1 });
  assert.ok(viewBox(view)[2] < previous[2]);
  // A second conquest still returns to the camera from before inspection began.
  await view.render({ ...props, focusBounds: { x: 650, y: 200, w: 60, h: 45 }, focusKey: 2 });
  await act(async () => view.host.querySelector('.map-return').click());
  assert.deepEqual(viewBox(view), previous);
  assert.equal(view.host.querySelector('.map-return'), null);
  assert.equal(document.activeElement, view.host.querySelector('[aria-label="Zoom in"]'));
});

test('resetting or changing theatres discards the obsolete conquest return camera', async context => {
  const props = mapProps();
  const view = await mount(WorldMap, props, context);
  await view.render({ ...props, focusBounds: { x: 440, y: 260, w: 30, h: 20 }, focusKey: 1 });
  assert.ok(view.host.querySelector('.map-return'));
  await act(async () => view.host.querySelector('[aria-label="Reset view"]').click());
  assert.equal(view.host.querySelector('.map-return'), null);
  await view.render({ ...props, focusBounds: { x: 440, y: 260, w: 30, h: 20 }, focusKey: 2 });
  assert.ok(view.host.querySelector('.map-return'));
  await view.render({ ...props, viewResetKey: 'europe', initialFocus: { x: 400, y: 150, w: 100, h: 80 }, focusBounds: { x: 440, y: 260, w: 30, h: 20 }, focusKey: 2 });
  assert.equal(view.host.querySelector('.map-return'), null);
});
