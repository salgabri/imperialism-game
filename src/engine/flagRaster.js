// Flag artwork as bitmaps for the map's Flags mode: the rasteriser and its queue, kept outside React (its waits need
// timers, which components may not own) and read by the banners through useSyncExternalStore (components/flagBitmaps.js).
// An SVG flag on the map is redrawn shape by shape every time the map repaints (each camera frame, the draw compass,
// a hover), which made Flags mode lag; a bitmap is one image draw. Each SVG is rasterised once, in the background, at
// BITMAP_SIDE px on its longer side. FlagArt keeps the SVG until its bitmap is ready and wherever the flag is drawn
// larger than the bitmap, so a flag is never blurred.
// Browser-only: without OffscreenCanvas (jsdom, server rendering) nothing is rasterised and the SVGs stay.
//
// Parsing and drawing an SVG hold the page's own thread (a worker can neither decode an SVG nor draw one), so the
// queue keeps out of the player's way:
// - it draws only flags that a mounted banner still shows, so leaving Flags mode stops it, and the biggest go first;
// - each step on the page's thread waits QUIET_MS after the player's last press, key, wheel or drag, then for a
//   background-priority task;
// - finished bitmaps reach the banners in batches, one re-render for many flags (the swap looks the same either way).

const BITMAP_SIDE = 1024;
// No step starts within this long of the player's last input.
const QUIET_MS = 200;
// While the queue runs, banners re-render for new bitmaps at most this often; at once when it empties.
const BATCH_MS = 150;
// Flags in flight at once: one's fetch, decode or encode overlaps the other's steps on the page's thread.
const IN_FLIGHT = 2;

const bitmaps = new Map(); // SVG URL → { href, width, height } the banners show, or null: could not be rasterised, never retried
const ready = new Map(); // SVG URL → a finished bitmap, with its decoded image, waiting for the next batch
const wanted = new Map(); // SVG URL → how many mounted banner layers show it
const drawn = new Map(); // SVG URL → the largest size those layers draw it at, in device px on its longer side
const jobs = new Map(); // SVG URL → its rasterisation in flight: one per URL, which a new request for it joins
const listeners = new Set();
// What a job returns once no banner wants its flag: it stores nothing, so a later request queues the flag again.
const ABANDONED = Symbol('abandoned');

const canRasterise = () => typeof OffscreenCanvas === 'function' && typeof OffscreenCanvas.prototype.convertToBlob === 'function'
  && typeof Image === 'function' && typeof fetch === 'function' && typeof URL?.createObjectURL === 'function';
const now = () => (typeof performance === 'object' ? performance.now() : Date.now());

// ---- Taking turns with the player ----
let lastInput = -Infinity;
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];
const LISTENING = { capture: true, passive: true };
// A drag is input; a pointer merely passing over the map is not.
const onInput = event => { if (event.type !== 'pointermove' || event.buttons) lastInput = now(); };
let listening = false;
/** The input listeners, on the window only while the queue runs. */
function listen(on) {
  if (listening === on) return;
  listening = on;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  for (const type of INPUT_EVENTS) window[on ? 'addEventListener' : 'removeEventListener'](type, onInput, LISTENING);
}

/** A background-priority task where the browser has one; else an idle callback; else (Safari) a timer. */
function backgroundTask() {
  const { scheduler } = globalThis;
  if (typeof scheduler?.postTask === 'function') return scheduler.postTask(() => {}, { priority: 'background' });
  return new Promise(resolve => {
    if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(() => resolve(), { timeout: 1000 });
    else setTimeout(resolve, 0);
  });
}

/** Resolves in a background task at least QUIET_MS after the player's last input, input during the wait included. */
async function quiet() {
  for (;;) {
    const wait = lastInput + QUIET_MS - now();
    if (wait > 0) { await new Promise(resolve => setTimeout(resolve, wait)); continue; }
    await backgroundTask();
    if (now() - lastInput >= QUIET_MS) return;
  }
}

let gate = Promise.resolve();
/**
 * Waits for a job's next step on the page's thread: steps take turns, one quiet background task each. → whether a
 * banner still wants the flag. It is asked only now, never when a banner lets go: a banner remounted under a new key
 * (its region changed in a conquest) lets go and asks again in one commit, and its flag stays in flight.
 */
function turn(url) {
  // A wait that fails just ends the wait: a rejected gate would fail every flag after it, and a failed flag is never retried.
  const next = gate.then(quiet).catch(() => {});
  gate = next;
  return next.then(() => wanted.has(url));
}

// ---- Drawing ----
/**
 * One SVG drawn at BITMAP_SIDE px on its longer side, as a decoded image object URL (`decoded`: the image holding that
 * decode, until handOver); ABANDONED once unwanted.
 */
async function rasterise(url) {
  const text = await (await fetch(url)).text();
  if (!wanted.has(url)) return ABANDONED;
  const [, , w, h] = (/viewBox=["']([^"']+)["']/.exec(text)?.[1] || '').trim().split(/[\s,]+/).map(Number);
  if (!(w > 0 && h > 0)) return null;
  const scale = BITMAP_SIDE / Math.max(w, h);
  const width = Math.round(w * scale), height = Math.round(h * scale);
  // Sized to the bitmap: the flags carry only a viewBox, and a canvas draws a size-less SVG at a default size in
  // some browsers.
  const sized = text.replace(/<svg\b[^>]*>/, tag => tag.replace(/\s(?:width|height)=(["'])[^"']*\1/g, '')
    .replace(/^<svg/, `<svg width="${width}" height="${height}"`));
  const source = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  try {
    // The two steps that hold the page's thread: the SVG's parse, which the src starts, and the draw.
    if (!await turn(url)) return ABANDONED;
    const svg = new Image();
    svg.src = source;
    await svg.decode();
    if (!await turn(url)) return ABANDONED;
    // A CPU canvas: encoding a GPU one reads its pixels back, which stalls the page while the GPU draws the map.
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(svg, 0, 0, width, height);
    // Lossless WebP, not PNG: Chrome encodes a WebP on a worker thread, but a PNG on this one, in idle time, and all
    // at once when none comes for a second. Quality exactly 1 is Chrome's and Firefox's lossless mode: the same
    // pixels and transparency as a PNG. Safari has no WebP encoder and returns a PNG, used as it comes.
    const href = URL.createObjectURL(await canvas.convertToBlob({ type: 'image/webp', quality: 1 }));
    // Loaded before any <image> switches to it, so a banner never shows blank for a frame.
    const decoded = new Image();
    decoded.src = href;
    await decoded.decode();
    return { href, width, height, decoded };
  } finally {
    URL.revokeObjectURL(source);
  }
}

// ---- The queue ----
let active = 0;
/** Starts the wanted flags drawn largest (the most visible, and the dearest to repaint as SVG) until IN_FLIGHT run. */
function pump() {
  while (active < IN_FLIGHT) {
    let next, size = -1;
    for (const url of wanted.keys()) {
      if (bitmaps.has(url) || ready.has(url) || jobs.has(url)) continue;
      const px = drawn.get(url) || 0;
      if (px > size) { next = url; size = px; }
    }
    if (next === undefined) return;
    start(next);
  }
}

function start(url) {
  if (!listening) {
    listen(true);
    // The banners asking were mounted by a commit, most often one that a click or a key made just now, before these
    // listeners were there to hear it: the queue's first step waits out a quiet period too.
    lastInput = now();
  }
  active++;
  jobs.set(url, rasterise(url).catch(() => null).then(bitmap => {
    jobs.delete(url);
    active--;
    if (bitmap && bitmap !== ABANDONED) { ready.set(url, bitmap); batch(); }
    else if (bitmap === null) bitmaps.set(url, null);
    pump();
    if (!active) { listen(false); handOver(); }
  }));
}

let pumpQueued = false;
/** Pumps once the commit that asked is done, so the largest of all the flags it mounted go first. */
function queuePump() {
  if (pumpQueued) return;
  pumpQueued = true;
  Promise.resolve().then(() => { pumpQueued = false; pump(); });
}

let batchTimer = null;
function batch() {
  if (batchTimer === null) batchTimer = setTimeout(handOver, BATCH_MS);
}
// The decoded images of the batch handed over last, held until the next hand-over.
let handedOver = [];
/**
 * Hands the finished bitmaps to their banners at once: React re-renders them all in one commit. A bitmap's decoded
 * image is held until then, and the batch's through that commit: a batch waits up to BATCH_MS, and an image that
 * nothing holds can be collected in that time, its decode with it, so its banners would switch to a bitmap still
 * loading and show blank for a frame.
 */
function handOver() {
  if (batchTimer !== null) { clearTimeout(batchTimer); batchTimer = null; }
  if (!ready.size) return;
  handedOver = [];
  for (const [url, { decoded, ...bitmap }] of ready) { bitmaps.set(url, bitmap); handedOver.push(decoded); }
  ready.clear();
  listeners.forEach(listener => listener());
}

// ---- The encoder's connection ----
let encoderReady = false;
/**
 * The page's first canvas encode opens its connection to the GPU process, a round trip that holds the page's thread
 * until the GPU process answers. At the first flag's draw the GPU process was busy rastering the map's first Flags
 * frame, and the page stood still for 60-350 ms. Made with one pixel when the first banner asks, still within the
 * click and before that frame goes to the GPU, it takes under a millisecond.
 */
function readyEncoder() {
  if (encoderReady) return;
  encoderReady = true;
  try {
    const canvas = new OffscreenCanvas(1, 1);
    canvas.getContext('2d', { willReadFrequently: true })?.fillRect?.(0, 0, 1, 1);
    canvas.convertToBlob({ type: 'image/webp', quality: 1 }).catch(() => {});
  } catch { /* the flags' own encodes open it then */ }
}

// ---- What the banners use ----
/** A banner layer shows this flag, drawn `px` device px on its longer side: rasterise it unless done or under way. */
export function requestFlagBitmap(url, px = 0) {
  if (!url || !canRasterise()) return;
  readyEncoder();
  wanted.set(url, (wanted.get(url) || 0) + 1);
  drawn.set(url, Math.max(drawn.get(url) || 0, Number.isFinite(px) ? px : 0));
  if (!bitmaps.has(url) && !ready.has(url) && !jobs.has(url)) queuePump();
}

/** A banner layer no longer shows this flag. A job in flight decides at its next step whether any still does. */
export function releaseFlagBitmap(url) {
  const count = wanted.get(url);
  if (!count) return;
  if (count > 1) wanted.set(url, count - 1);
  else { wanted.delete(url); drawn.delete(url); }
}

/** A flag's bitmap handed to the banners (`{ href, width, height }`), else null: none yet, or it could not be made. */
export const flagBitmap = url => (url && bitmaps.get(url)) || null;

/** Called whenever a batch of bitmaps is handed over. → unsubscribe */
export function subscribeFlagBitmaps(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
