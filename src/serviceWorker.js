// Registers the offline worker that vite-plugin-pwa builds (src/pwa.js) and runs its updates. A new version never
// reloads a page by itself: its worker waits until the player chooses Reload in the update prompt, and only that tab
// reloads (pagehide writes the campaign's checkpoint first). Other open tabs keep the version they loaded. It also
// fetches a campaign's crests and flags through the worker, so they show offline (cacheForOffline). UI-only: nothing
// here touches a campaign.
import { useEffect, useState } from 'react';
import { isRuntimeCached } from './pwa.js';

const CHECK_EVERY_MS = 60 * 60 * 1000;
// Coming back to the tab checks again, at most this often.
const CHECK_AGAIN_MS = 10 * 60 * 1000;
// cacheForOffline's fetches at once, beside the game's own requests.
const OFFLINE_FETCHES = 4;
// A first visit's page waits at most this long for App's first boot before it registers anyway, so a slow or stuck
// boot still gets the offline worker (registerAfterBoot).
const BOOT_WAIT_MS = 10 * 1000;
// Then it waits for an idle moment, at most this long. Browsers without requestIdleCallback (Safari) wait a moment.
const IDLE_WAIT_MS = 2000;
const NO_IDLE_WAIT_MS = 200;

let settleBoot = () => {};
/** Settles once App's first boot is over: the setup screen is up, or boot failed (settleFirstBoot). */
export const firstBoot = new Promise(resolve => { settleBoot = resolve; });

/** App's first boot is over (setup on screen, or its error): a first visit may register its worker now. Repeats do nothing. */
export function settleFirstBoot() {
  settleBoot();
}

const listeners = new Set();
let waiting = null;       // a new version's installed worker, while it waits for the player
let dismissed = null;     // the waiting worker the player put off ("Later") for this page
let session = null;       // { env, registration, reloading }
let deferred = null;      // files cacheForOffline was given before a worker controlled the page

const shown = () => (waiting && waiting !== dismissed ? waiting : null);

function publish(worker) {
  waiting = worker;
  listeners.forEach(listener => listener(shown()));
}

/**
 * Register `url` and watch for new versions (production builds only: main.jsx; the dev server has no worker).
 * `env` stands in for the browser's globals in tests. Resolves to the registration, or null where there is none.
 */
export async function registerServiceWorker(url = './sw.js', env = globalThis) {
  const container = env.navigator?.serviceWorker;
  if (typeof container?.register !== 'function' || session) return null;
  session = { env, registration: null, reloading: false };
  // A page the first install takes over has loaded files the worker never saw.
  let warm = !container.controller;
  container.addEventListener('controllerchange', () => {
    if (session?.reloading) env.location.reload();
    else if (warm) {
      warm = false;
      warmRuntimeCache(env);
    }
  });
  let registration;
  try {
    registration = await container.register(url, { scope: './' });
  } catch {
    session = null;
    return null; // Some private windows and embedded browsers refuse workers: the game still runs online.
  }
  session.registration = registration;
  // Waiting since an earlier visit, or installed while this page runs. A page with no controller came from the
  // network (a first visit, a hard reload) and already runs the newest version.
  const offer = worker => { if (worker && container.controller) publish(worker); };
  const watch = worker => worker?.addEventListener('statechange', () => { if (worker.state === 'installed') offer(worker); });
  offer(registration.waiting);
  // Loading the page checks for a new version too, and it may be installing already.
  watch(registration.installing);
  registration.addEventListener('updatefound', () => watch(registration.installing));
  let checked = Date.now();
  const check = () => {
    checked = Date.now();
    Promise.resolve().then(() => registration.update()).catch(() => { /* offline: the next check tries again */ });
  };
  env.setInterval?.(check, CHECK_EVERY_MS);
  env.document?.addEventListener?.('visibilitychange', () => {
    if (env.document.visibilityState === 'visible' && Date.now() - checked > CHECK_AGAIN_MS) check();
  });
  return registration;
}

/**
 * Register the worker (registerServiceWorker) when its downloads no longer compete with boot's (main.jsx, production
 * only). A first install fetches its whole precache past the HTTP cache: Workbox asks for every file it versions with
 * cache 'reload' (index.html, the fonts, both world maps, the icons), a few hundred KB while boot downloads the same
 * maps. So a page no worker controls (a first visit, a hard reload) waits for `booted` (App's first boot: firstBoot),
 * or BOOT_WAIT_MS at most, then for an idle moment. A page a worker controls registers at once: register() downloads
 * nothing new there, and the update prompt and the crash screen's Reload (applyUpdate) need the registration from the
 * start. `env` and `booted` stand in for the browser's globals and App's boot in tests. Resolves as
 * registerServiceWorker does. Async like it, so an error here rejects into main.jsx's catch instead of throwing before
 * the game renders (Chromium throws reading navigator.serviceWorker in sandboxed and opaque-origin documents).
 */
export async function registerAfterBoot(url = './sw.js', env = globalThis, booted = firstBoot) {
  const container = env.navigator?.serviceWorker;
  if (typeof container?.register !== 'function' || container.controller) return registerServiceWorker(url, env);
  return new Promise(resolve => {
    let started = false, fallback = null;
    const start = () => {
      if (started) return;
      started = true;
      env.clearTimeout(fallback);
      const register = () => resolve(registerServiceWorker(url, env));
      if (typeof env.requestIdleCallback === 'function') env.requestIdleCallback(register, { timeout: IDLE_WAIT_MS });
      else env.setTimeout(register, NO_IDLE_WAIT_MS);
    };
    fallback = env.setTimeout(start, BOOT_WAIT_MS);
    Promise.resolve(booted).then(start, start);
  });
}

/**
 * Fetch again, now through the worker, the seasons, maps, flags and crests the page loaded before it took over, and
 * the campaign's crests and flags cacheForOffline was given before then.
 */
function warmRuntimeCache(env) {
  const loaded = (env.performance?.getEntriesByType?.('resource') || []).map(entry => entry.name);
  const marks = deferred || [];
  deferred = null;
  cacheForOffline([...loaded, ...marks], env);
}

/**
 * Keep `urls` (a campaign's crests and flags: src/data/teamMarks.js) for offline play, so a team the game never showed
 * online still shows offline. Each file the worker caches on first use (isRuntimeCached) and has not cached yet is
 * fetched through the worker, a few at a time. Only while online with a worker controlling the page; a page the first
 * worker has yet to take over fetches them when it does. Errors are ignored: a file missed here is cached on its first
 * use. Resolves once every fetch has settled and never rejects. `env` stands in for the browser's globals in tests.
 */
export async function cacheForOffline(urls, env = globalThis) {
  const container = env.navigator?.serviceWorker;
  if (!container || env.navigator.onLine === false) return;
  const queue = [...new Set(urls)].filter(isRuntimeCached);
  if (!container.controller) {
    deferred = queue;
    return;
  }
  const fetchNext = async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      try {
        if (!(await env.caches?.match(url))) await env.fetch(url);
      } catch { /* cached on its first use instead */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(OFFLINE_FETCHES, queue.length) }, fetchNext));
}

/** Reload into the waiting version: its worker takes over, then this tab reloads. False when nothing waits. */
export function applyUpdate() {
  if (!session || !waiting) return false;
  // A still newer version may have replaced the one offered.
  const worker = session.registration?.waiting || waiting;
  session.reloading = true;
  // Another tab's Reload may have started it already: this tab then only needs to reload.
  if (worker.state === 'activating' || worker.state === 'activated') session.env.location.reload();
  else worker.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

/** "Later": hide the prompt for this page until a newer version arrives (closing every tab updates too). */
export function dismissUpdate() {
  dismissed = waiting;
  publish(waiting);
}

/** The waiting worker while the update prompt should show, else null. */
export function useAppUpdate() {
  const [worker, setWorker] = useState(shown);
  useEffect(() => {
    listeners.add(setWorker);
    setWorker(shown());
    return () => listeners.delete(setWorker);
  }, []);
  return worker;
}

/** Forget the registration, any waiting version and any deferred files (tests). */
export function resetServiceWorker() {
  session = null;
  waiting = null;
  dismissed = null;
  deferred = null;
}
