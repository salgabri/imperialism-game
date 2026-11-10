// Flags mode's bitmap artwork (src/engine/flagRaster.js, through components/flagBitmaps.js and FlagArt): each SVG is
// rasterised once in the background, a banner switches to the bitmap while it covers the drawn size, and keeps the
// SVG beyond it. The queue draws only flags a banner still shows, keeps out of the way of input, and hands bitmaps
// over in batches. The browser APIs the rasteriser needs (OffscreenCanvas, Image decode, object URLs) are stubbed;
// React renders for real.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import v8 from 'node:v8';
import vm from 'node:vm';

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

// ---- browser stand-ins: every fetch, image source and canvas is recorded ----
const fetched = [];
const read = []; // URLs whose SVG text the rasteriser has read
const canvases = [];
const sources = []; // [image source, when it was set]: setting an SVG's source starts its parse on the page's thread
const images = new Map(); // image source → a weak reference to the Image it was set on
const delays = new Map(); // URL → how long its fetch takes, ms (else 5)
const holds = new Map(); // URL → a promise its fetch waits for
let encodesWebp = true; // false: a browser without a WebP encoder (Safari), which returns a PNG whatever it is asked
const viewBoxes = { field: '0 0 640 480', symbol: '170 90 300 300' };
const saved = { fetch: globalThis.fetch, Image: globalThis.Image, OffscreenCanvas: globalThis.OffscreenCanvas,
  createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
let objectUrls = 0;
const blobs = new Map();
globalThis.fetch = async url => {
  fetched.push(url);
  await new Promise(resolve => setTimeout(resolve, delays.get(url) ?? 5)); // a network round trip: the first render still shows the SVG
  await holds.get(url);
  const respond = body => ({ text: async () => { read.push(url); return body; } });
  if (url.includes('sized')) return respond(`<svg xmlns="http://www.w3.org/2000/svg" width='10' height="20" viewBox="0 0 640 480"><rect width="5" height="5"/></svg>`);
  const viewBox = url.includes('broken') ? null : url.includes('symbol') ? viewBoxes.symbol : viewBoxes.field;
  return respond(viewBox ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"></svg>` : '<svg></svg>');
};
URL.createObjectURL = blob => { const url = `blob:test/${++objectUrls}`; blobs.set(url, blob); return url; };
URL.revokeObjectURL = () => {};
globalThis.Image = class {
  get src() { return this.source; }
  set src(value) { this.source = value; sources.push([value, performance.now()]); images.set(value, new WeakRef(this)); }
  decode() { return Promise.resolve(); }
};
// The one-pixel canvas that opens the encoder (flagRaster's readyEncoder), kept apart from the flags' canvases.
const encoderCanvases = [];
globalThis.OffscreenCanvas = class {
  constructor(width, height) {
    Object.assign(this, { width, height, draws: [], fills: 0, createdAt: performance.now(), fetchesBefore: fetched.length });
    (width === 1 && height === 1 ? encoderCanvases : canvases).push(this);
  }
  getContext(type, options) {
    this.context = { type, options };
    return { drawImage: (...args) => { this.drawnAt = performance.now(); this.draws.push(args); }, fillRect: () => { this.fills++; } };
  }
  async convertToBlob(options) {
    this.type = options?.type; this.quality = options?.quality;
    return new Blob(['bitmap'], { type: encodesWebp ? options?.type : 'image/png' });
  }
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

// Real time passes: the rasteriser waits a quiet period after input (and after it starts) before each step.
async function until(predicate, label, ms = 4000) {
  for (const end = performance.now() + ms; performance.now() < end;) {
    if (predicate()) return;
    await act(() => new Promise(resolve => setTimeout(resolve, 2)));
  }
  if (!predicate()) assert.fail(`timed out: ${label}`);
}
const wait = ms => act(() => new Promise(resolve => setTimeout(resolve, ms)));

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
    assert.deepEqual([canvas.type, canvas.quality], ['image/webp', 1],
      'lossless WebP, encoded off the page’s thread: quality exactly 1 keeps every pixel and the transparency');
    assert.equal(blobs.get(href()).type, 'image/webp');
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

const releaser = () => { let release; const held = new Promise(resolve => { release = resolve; }); return { held, release }; };
const INPUT_EVENTS = ['keydown', 'pointerdown', 'pointermove', 'touchstart', 'wheel'];
// Records the window listeners added and removed: the rasteriser listens for input only while its queue runs, so the
// removals also say when the queue has gone idle.
function spyOnListeners() {
  const calls = [], add = window.addEventListener, remove = window.removeEventListener;
  const saved = ['addEventListener', 'removeEventListener'].map(name => [name, Object.getOwnPropertyDescriptor(window, name)]);
  window.addEventListener = function (type, listener, options) {
    calls.push(['add', type, options?.capture, options?.passive]);
    return add.call(this, type, listener, options);
  };
  window.removeEventListener = function (type, listener, options) {
    calls.push(['remove', type, options?.capture]);
    return remove.call(this, type, listener, options);
  };
  return { calls, restore() {
    for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(window, name, descriptor); else delete window[name]; }
  } };
}

test('no step starts within the quiet period after input; the input listeners are there only while the queue runs', async () => {
  const { calls, restore } = spyOnListeners();
  const url = '/flags/pt.svg', hold = releaser();
  holds.set(url, hold.held);
  const before = sources.length;
  const view = await mount(React.createElement(FlagArt, { flag: native('620', url), scale: 1 }));
  try {
    await until(() => fetched.includes(url), 'the fetch');
    assert.deepEqual(calls.filter(([kind]) => kind === 'add').map(call => call.slice(1)).sort(),
      INPUT_EVENTS.map(type => [type, true, true]), 'passive capture listeners on the window while the queue runs');
    // A key press while the flag's SVG is still on its way: its parse and its draw wait out the quiet period after it.
    const pressed = performance.now();
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    hold.release();
    await until(() => view.q('#fi-flag-620 image').getAttribute('href').startsWith('blob:'), 'the swap');
    const steps = [...sources.slice(before).map(([, at]) => at), canvases.at(-1).drawnAt];
    assert.equal(steps.length, 3, 'the SVG parse, the draw and the bitmap decode');
    for (const at of steps) assert.ok(at - pressed >= 200, `a step ${(at - pressed).toFixed(1)} ms after the key press`);
    assert.deepEqual(calls.filter(([kind]) => kind === 'remove').map(call => call.slice(1)).sort(),
      INPUT_EVENTS.map(type => [type, true]), 'all removed once the queue is empty');
  } finally {
    restore();
    holds.delete(url);
    await view.close();
  }
});

test('a flag no banner shows any more is dropped before its turn, not failed: shown again, it is drawn', async () => {
  const url = '/flags/gr.svg', flag = native('300', url);
  const drawsBefore = canvases.length, spy = spyOnListeners();
  try {
    const view = await mount(React.createElement(FlagArt, { flag, scale: 1 }));
    // Its SVG is read: the job now waits out the quiet period before its first step, and a click keeps it waiting.
    await until(() => read.includes(url), 'the SVG read');
    window.dispatchEvent(new window.MouseEvent('pointerdown', { buttons: 1 }));
    // Every banner showing it goes (the player leaves Flags mode). At its turn the job finds no banner wanting the
    // flag and stops: the queue goes idle.
    await view.close();
    await until(() => spy.calls.some(([kind]) => kind === 'remove'), 'the queue going idle');
  } finally { spy.restore(); }
  assert.equal(canvases.length, drawsBefore, 'never drawn');
  const again = await mount(React.createElement(FlagArt, { flag, scale: 1 }));
  try {
    await until(() => again.q('#fi-flag-300 image').getAttribute('href').startsWith('blob:'), 'drawn once shown again');
    assert.equal(fetched.filter(fetchedUrl => fetchedUrl === url).length, 2, 'queued afresh: the dropped job kept nothing');
    assert.equal(canvases.length, drawsBefore + 1);
  } finally { await again.close(); }
});

test('a banner remounted under a new key in one commit keeps its flag in flight', async () => {
  const url = '/flags/es.svg';
  const drawsBefore = canvases.length;
  const view = await mount(React.createElement(FlagArt, { key: '724-a', flag: native('724-a', url), scale: 1 }));
  try {
    await until(() => fetched.includes(url), 'in flight');
    // A conquest renames the region's banner: the old one unmounts and the new one mounts in the same commit.
    await view.render(React.createElement(FlagArt, { key: '724-b', flag: native('724-b', url), scale: 1 }));
    assert.equal(view.q('#fi-flag-724-a'), null);
    await until(() => view.q('#fi-flag-724-b image').getAttribute('href').startsWith('blob:'), 'the swap');
    assert.equal(fetched.filter(fetchedUrl => fetchedUrl === url).length, 1, 'never restarted');
    assert.equal(canvases.length, drawsBefore + 1, 'drawn once');
  } finally { await view.close(); }
});

test('bitmaps finishing close together reach their banners in one re-render', async () => {
  // Two flags released together and a third that starts once one of them is done (two are in flight at a time) and
  // takes 30 ms longer: each would be a commit of its own if every finished bitmap re-rendered its banners.
  const urls = ['/flags/it.svg', '/flags/fr.svg', '/flags/nl.svg'], hold = releaser();
  holds.set(urls[0], hold.held); holds.set(urls[1], hold.held); delays.set(urls[2], 30);
  const flags = urls.map((url, i) => native(`b${i}`, url, { x: i * 300, y: 0, w: 250, h: 60 }));
  let commits = 0;
  const view = await mount(React.createElement(React.Profiler, { id: 'banners', onRender: (id, phase) => { if (phase !== 'mount') commits++; } },
    flags.map(flag => React.createElement(FlagArt, { key: flag.id, flag, scale: 1 }))));
  try {
    await until(() => fetched.includes(urls[0]) && fetched.includes(urls[1]), 'two in flight');
    hold.release();
    const hrefs = () => flags.map(flag => view.q(`#fi-flag-${flag.id} image`).getAttribute('href'));
    await until(() => hrefs().every(href => href.startsWith('blob:')), 'all three swaps');
    assert.equal(commits, 1, 'one re-render for the three bitmaps');
  } finally {
    for (const url of urls) { holds.delete(url); delays.delete(url); }
    await view.close();
  }
});

test('the flags drawn largest are rasterised first', async () => {
  const urls = ['/flags/small.svg', '/flags/medium.svg', '/flags/large.svg'];
  const flags = urls.map((url, i) => native(`s${i}`, url, { x: i * 500, y: 0, w: [40, 150, 400][i], h: 30 }));
  const view = await mount(flags.map(flag => React.createElement(FlagArt, { key: flag.id, flag, scale: 1 })));
  try {
    await until(() => urls.every(url => fetched.includes(url)), 'all three');
    assert.deepEqual(fetched.filter(url => urls.includes(url)), [urls[2], urls[1], urls[0]], 'by drawn size, largest first');
  } finally { await view.close(); }
});

test('where the browser has no WebP encoder (Safari), the PNG it returns is shown', async () => {
  encodesWebp = false;
  const view = await mount(React.createElement(FlagArt, { flag: native('826', '/flags/gb.svg'), scale: 1 }));
  try {
    const href = () => view.q('#fi-flag-826 image').getAttribute('href');
    await until(() => href().startsWith('blob:'), 'the swap');
    assert.deepEqual([canvases.at(-1).type, canvases.at(-1).quality], ['image/webp', 1], 'asked for lossless WebP');
    assert.equal(blobs.get(href()).type, 'image/png', 'and shows the PNG that came back');
  } finally {
    encodesWebp = true;
    await view.close();
  }
});

// The bitmap images decoded since `from` in `sources` (an SVG's own source is an image/svg+xml blob).
const decodedSince = from => sources.slice(from).map(([source]) => source).filter(source => blobs.get(source)?.type === 'image/webp');

test('when the queue empties, the last bitmaps reach their banners at once, not a batch window later', async () => {
  const from = sources.length;
  const view = await mount(React.createElement(FlagArt, { flag: native('40', '/flags/at.svg'), scale: 1 }));
  try {
    // The decode and the hand-over run in one task, and until() checks only once React has committed what that task
    // asked for: the banner already shows the bitmap the moment its decode is seen.
    await until(() => decodedSince(from).length, 'the bitmap decoded');
    assert.ok(view.q('#fi-flag-40 image').getAttribute('href').startsWith('blob:'), 'shown with no wait for the batch timer');
  } finally { await view.close(); }
});

test('a finished bitmap holds its decoded image until its batch reaches the banners, and through that swap', async () => {
  // A batch waits up to 150 ms. An image that nothing holds could be collected in that time, its decode with it, and
  // the banner would then switch to a bitmap still loading: blank for a frame.
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  const collect = async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    gc();
    await new Promise(resolve => setTimeout(resolve, 0));
  };
  const urls = ['/flags/ie.svg', '/flags/pl.svg'], hold = releaser();
  holds.set(urls[1], hold.held); // the second flag stays in flight, so the queue does not empty and hand over at once
  const flags = urls.map((url, i) => native(`g${i}`, url, { x: i * 300, y: 0, w: [250, 100][i], h: 60 }));
  const from = sources.length;
  const view = await mount(flags.map(flag => React.createElement(FlagArt, { key: flag.id, flag, scale: 1 })));
  try {
    await until(() => decodedSince(from).length, 'the first bitmap decoded');
    const [first] = decodedSince(from);
    assert.equal(view.q('#fi-flag-g0 image').getAttribute('href'), urls[0], 'its batch is still waiting');
    await collect();
    assert.ok(images.get(first).deref(), 'its decoded image is held while the batch waits');
    hold.release();
    await until(() => flags.every(flag => view.q(`#fi-flag-${flag.id} image`).getAttribute('href').startsWith('blob:')), 'both swaps');
    await collect();
    assert.ok(images.get(decodedSince(from).at(-1)).deref(), 'the last batch’s decoded images are held through its swap');
  } finally {
    holds.delete(urls[1]);
    await view.close();
  }
});

test('the first banner to ask opens the encoder at once, one pixel encoded as lossless WebP, before any flag is fetched', async () => {
  // Earlier tests mounted banners: the first of them opened it, and none since has opened another.
  const view = await mount(React.createElement(FlagArt, { flag: native('203', '/flags/cz.svg'), scale: 1 }));
  try {
    assert.equal(encoderCanvases.length, 1, 'once for the page');
    const [canvas] = encoderCanvases;
    assert.deepEqual([canvas.fills, canvas.type, canvas.quality, canvas.context.options], [1, 'image/webp', 1, { willReadFrequently: true }],
      'drawn and encoded as the flags are, so it opens the same connection to the GPU process');
    assert.equal(canvas.fetchesBefore, 0, 'within the commit that asked, before the first flag was fetched');
    await until(() => view.q('#fi-flag-203 image').getAttribute('href').startsWith('blob:'), 'the swap');
    assert.equal(encoderCanvases.length, 1);
  } finally { await view.close(); }
});
