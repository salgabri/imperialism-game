// Registers the offline worker that vite-plugin-pwa builds (src/pwa.js) and runs its updates. A new version never
// reloads a page by itself: its worker waits until the player chooses Reload in the update prompt, and only that tab
// reloads (pagehide writes the campaign's checkpoint first). Other open tabs keep the version they loaded. UI-only:
// nothing here touches a campaign.
import { useEffect, useState } from 'react';
import { isRuntimeCached } from './pwa.js';

const CHECK_EVERY_MS = 60 * 60 * 1000;
// Coming back to the tab checks again, at most this often.
const CHECK_AGAIN_MS = 10 * 60 * 1000;

const listeners = new Set();
let waiting = null;       // a new version's installed worker, while it waits for the player
let dismissed = null;     // the waiting worker the player put off ("Later") for this page
let session = null;       // { env, registration, reloading }

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

/** Fetch again, now through the worker, the seasons, maps, flags and crests the page loaded before it took over. */
function warmRuntimeCache(env) {
  const urls = new Set((env.performance?.getEntriesByType?.('resource') || []).map(entry => entry.name).filter(isRuntimeCached));
  for (const url of urls) Promise.resolve().then(() => env.fetch(url)).catch(() => { /* cached on its next use */ });
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

/** Forget the registration and any waiting version (tests). */
export function resetServiceWorker() {
  session = null;
  waiting = null;
  dismissed = null;
}
