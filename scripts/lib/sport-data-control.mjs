// A `#sport-data` for tests of the page's lazy path (scripts/sport-data.test.mjs bundles it in with an esbuild plugin).
// Football's players come with the first download, as on the page (src/sports/sportData.lazy.js); every other sport's
// load only when the test settles its request: `release(id)` lets them arrive, `fail(id)` fails them, as a chunk that
// 404s after a deploy does. The players are Node's own (sportData.eager.js), so both paths read the same data.
import { EAGER as EVERY } from '../../src/sports/sportData.eager.js';

export const EAGER = { football: EVERY.football };

/** Every request for a sport's players, in order: { id, settled }. */
export const requests = [];

export const LOADERS = Object.fromEntries(Object.keys(EVERY).filter(id => !Object.hasOwn(EAGER, id)).map(id => [id, () =>
  new Promise((resolve, reject) => {
    const request = { id, settled: false };
    request.release = () => { request.settled = true; resolve(EVERY[id]); };
    request.fail = (error = new Error(`Failed to fetch dynamically imported module: /assets/${id}-old.js`)) => {
      request.settled = true;
      reject(error);
    };
    requests.push(request);
  })]));

/** The sports asked for so far, in order. */
export const requested = () => requests.map(request => request.id);

function settle(id, how, error) {
  const open = requests.filter(request => request.id === id && !request.settled);
  if (!open.length) throw new Error(`No request for the ${id} players is waiting`);
  for (const request of open) request[how](error);
}

/** Let every waiting request for sport `id`'s players arrive. */
export const release = id => settle(id, 'release');

/** Fail every waiting request for sport `id`'s players. */
export const fail = (id, error) => settle(id, 'fail', error);
