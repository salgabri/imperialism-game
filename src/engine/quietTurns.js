// Background work that keeps out of the player's way (README §Flags): the flag rasteriser (flagRaster.js) and Flags
// mode's warm-up (app/mapMethods.jsx) take turns on the page's thread through here. A turn comes QUIET_MS after the
// player's last press, key, wheel or drag, in a background-priority task.

// No turn starts within this long of the player's last input.
export const QUIET_MS = 200;

const now = () => (typeof performance === 'object' ? performance.now() : Date.now());

let lastInput = -Infinity;
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];
const LISTENING = { capture: true, passive: true };
// A drag is input; a pointer merely passing over the map is not.
const onInput = event => { if (event.type !== 'pointermove' || event.buttons) lastInput = now(); };
let watchers = 0;

/**
 * Starts (`true`) or ends (`false`) one piece of work's watch on input: the listeners are on the window while any runs.
 * A watch that starts counts its start as input: the commit that set it off was most often a click or a key, made
 * before the listeners were there to hear it, so the first turn waits out a quiet period too.
 */
export function watchInput(on) {
  if (on) lastInput = now();
  if (on ? watchers++ > 0 : --watchers > 0) return;
  if (watchers < 0) { watchers = 0; return; }
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
export async function quiet() {
  for (;;) {
    const wait = lastInput + QUIET_MS - now();
    if (wait > 0) { await new Promise(resolve => setTimeout(resolve, wait)); continue; }
    await backgroundTask();
    if (now() - lastInput >= QUIET_MS) return;
  }
}

/**
 * Runs a generator's steps in quiet turns, as many in a turn as fit in `budgetMs` (a step is never cut short, so keep
 * them small). Stops before a step once `wanted()` is false. → whether every step ran
 */
export async function runQuietly(steps, { budgetMs = 8, wanted = () => true } = {}) {
  watchInput(true);
  try {
    for (;;) {
      await quiet();
      const end = now() + budgetMs;
      do {
        if (!wanted()) return false;
        if (steps.next().done) return true;
      } while (now() < end);
    }
  } finally {
    watchInput(false);
  }
}
