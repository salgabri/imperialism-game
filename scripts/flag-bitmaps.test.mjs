// Flags mode's bitmap artwork (src/components/flagBitmaps.js through FlagArt): each SVG is rasterised once in the
// background, a banner switches to the bitmap while it covers the drawn size, and keeps the SVG beyond it. The
// browser APIs the rasteriser needs (OffscreenCanvas, Image decode, object URLs) are stubbed; React renders for real.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/FlagArt.jsx', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
  jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent',
});
const bundle = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), bundle, bundle.exports);
const FlagArt = bundle.exports.default;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');

// ---- browser stand-ins: every fetch and canvas is recorded ----
const fetched = [];
const canvases = [];
const viewBoxes = { field: '0 0 640 480', symbol: '170 90 300 300' };
const saved = { fetch: globalThis.fetch, Image: globalThis.Image, OffscreenCanvas: globalThis.OffscreenCanvas,
  createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
let objectUrls = 0;
const blobs = new Map();
globalThis.fetch = async url => {
  fetched.push(url);
  await new Promise(resolve => setTimeout(resolve, 5)); // a network round trip: the first render still shows the SVG
  if (url.includes('sized')) return { text: async () => `<svg xmlns="http://www.w3.org/2000/svg" width='10' height="20" viewBox="0 0 640 480"><rect width="5" height="5"/></svg>` };
  const viewBox = url.includes('broken') ? null : url.includes('symbol') ? viewBoxes.symbol : viewBoxes.field;
  return { text: async () => (viewBox ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"></svg>` : '<svg></svg>') };
};
URL.createObjectURL = blob => { const url = `blob:test/${++objectUrls}`; blobs.set(url, blob); return url; };
URL.revokeObjectURL = () => {};
globalThis.Image = class { decode() { return Promise.resolve(); } };
globalThis.OffscreenCanvas = class {
  constructor(width, height) { Object.assign(this, { width, height, draws: [] }); canvases.push(this); }
  getContext(type, options) { this.context = { type, options }; return { drawImage: (...args) => this.draws.push(args) }; }
  async convertToBlob(options) { this.type = options?.type; return new Blob(['png']); }
};
after(() => {
  Object.assign(globalThis, { fetch: saved.fetch, Image: saved.Image, OffscreenCanvas: saved.OffscreenCanvas });
  Object.assign(URL, { createObjectURL: saved.createObjectURL, revokeObjectURL: saved.revokeObjectURL });
  dom.window.close();
});

async function mount(element) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const view = {
    q: selector => host.querySelector(selector),
    render: next => act(async () => root.render(React.createElement('svg', null, React.createElement('defs', null, next)))),
    close: async () => { await act(async () => root.unmount()); host.remove(); },
  };
  await view.render(element);
  return view;
}

async function until(predicate, label) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return;
    await act(() => new Promise(resolve => setTimeout(resolve, 2)));
  }
  assert.fail(`timed out: ${label}`);
}

const native = (id, url, bbox = { x: 10, y: 20, w: 250, h: 60 }) => ({ id, ownerId: id, url, color: '#ccc', bbox, symbolLayout: null });

test('an SVG banner switches to its bitmap once rasterised, and keeps the SVG where it is drawn larger', async () => {
  const flag = native('276', '/flags/de.svg');
  const view = await mount(React.createElement(FlagArt, { flag, scale: 2 }));
  try {
    const href = () => view.q('#fi-flag-276 image').getAttribute('href');
    assert.equal(href(), '/flags/de.svg', 'the SVG until its bitmap lands');
    await until(() => href().startsWith('blob:'), 'bitmap swap');
    assert.deepEqual(fetched.filter(url => url === '/flags/de.svg'), ['/flags/de.svg'], 'fetched once');
    const canvas = canvases.at(-1);
    assert.deepEqual([canvas.width, canvas.height], [1024, 768], '1024 px on the longer side, native aspect');
    assert.deepEqual(canvas.draws[0].slice(1), [0, 0, 1024, 768]);
    assert.match(await blobs.get(canvas.draws[0][0].src).text(), /^<svg width="1024" height="768" xmlns=/,
      'drawn sized to the bitmap, never at a browser’s default size for a viewBox-only SVG');
    assert.deepEqual(canvas.context, { type: '2d', options: { willReadFrequently: true } },
      'a CPU canvas: encoding a GPU one stalls the page on a pixel readback');
    assert.equal(canvas.type, 'image/png', 'lossless, keeps transparency');
    const bitmap = href();

    // 250 map units at 4 px per unit is 1000 px: still covered by the 1024 px bitmap.
    await view.render(React.createElement(FlagArt, { flag, scale: 4 }));
    assert.equal(href(), bitmap);
    // At 5 px per unit the flag is drawn 1250 px wide: beyond the bitmap, so the SVG keeps it sharp.
    await view.render(React.createElement(FlagArt, { flag, scale: 5 }));
    assert.equal(href(), '/flags/de.svg');
    await view.render(React.createElement(FlagArt, { flag, scale: 1 }));
    assert.equal(href(), bitmap, 'zooming back out returns to the same bitmap, not a new one');
    assert.equal(fetched.filter(url => url === '/flags/de.svg').length, 1);
  } finally { await view.close(); }
});

test('field and emblem layers are rasterised once each and shared by every banner; crests never are', async () => {
  const layered = (id, x) => ({ id, ownerId: '756', url: '/flags/ch.svg', color: '#ccc', bbox: { x, y: 0, w: 100, h: 80 },
    fieldUrl: '/flags-symbols/ch-field.svg', symbolUrl: '/flags-symbols/ch-symbol.svg',
    symbolLayout: { field: { x, y: 0, w: 100, h: 80 }, symbol: { x: x + 30, y: 20, w: 40, h: 40 } } });
  const crest = { id: 'f-club', ownerId: 'f-club', url: '/club-logos/f-club.webp', crestUrl: '/club-logos/f-club.webp', color: '#c00',
    bbox: { x: 0, y: 100, w: 80, h: 80 }, symbolLayout: { field: { x: 0, y: 100, w: 80, h: 80 }, symbol: { x: 20, y: 120, w: 40, h: 40 } } };
  const view = await mount([layered('756-a', 0), layered('756-b', 200), crest]
    .map(flag => React.createElement(FlagArt, { key: flag.id, flag, scale: 3 })));
  try {
    const layers = () => [...document.querySelectorAll('[data-flag-layout="symbol-aware"] image')].map(image => image.getAttribute('href'));
    await until(() => layers().every(href => href.startsWith('blob:')), 'both layers of both banners');
    assert.equal(new Set(layers()).size, 2, 'one bitmap for the field and one for the emblem, shared');
    assert.equal(fetched.filter(url => url.includes('ch-field')).length, 1);
    assert.equal(fetched.filter(url => url.includes('ch-symbol')).length, 1);
    const symbolCanvas = canvases.find(canvas => canvas.width === 1024 && canvas.height === 1024);
    assert.ok(symbolCanvas, 'a square emblem rasterises square');
    assert.equal(view.q('[data-flag-layout="crest"] image').getAttribute('href'), crest.crestUrl, 'a crest is already a bitmap');
    assert.equal(fetched.some(url => url.includes('club-logos')), false);
  } finally { await view.close(); }
});

test('an SVG with a size of its own is redrawn at the bitmap size: the root size is replaced, never doubled', async () => {
  const view = await mount(React.createElement(FlagArt, { flag: native('100', '/flags/sized.svg'), scale: 1 }));
  try {
    await until(() => view.q('#fi-flag-100 image').getAttribute('href').startsWith('blob:'), 'bitmap swap');
    const canvas = canvases.at(-1);
    assert.equal(await blobs.get(canvas.draws[0][0].src).text(),
      '<svg width="1024" height="768" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><rect width="5" height="5"/></svg>',
      'one width and height on the root (a duplicate attribute would not parse); inner shapes untouched');
  } finally { await view.close(); }
});

test('artwork that cannot be rasterised keeps its SVG and is not retried', async () => {
  const flag = native('999', '/flags/broken.svg');
  const view = await mount(React.createElement(FlagArt, { flag, scale: 1 }));
  try {
    await until(() => fetched.includes('/flags/broken.svg'), 'the attempt');
    await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    assert.equal(view.q('#fi-flag-999 image').getAttribute('href'), '/flags/broken.svg');
    await view.render(React.createElement(FlagArt, { flag: { ...flag }, scale: 2 }));
    await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    assert.equal(fetched.filter(url => url === '/flags/broken.svg').length, 1);
  } finally { await view.close(); }
});
