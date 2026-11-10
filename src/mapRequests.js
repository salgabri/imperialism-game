// The two world maps App.boot reads: the 110m rules map and the 50m atlas it draws. Nothing here may import another
// module: startMapRequests.js runs this file first of all, before React and the game's own code (see there).

const MAP_URL = `${import.meta.env.BASE_URL}world-110m.v1.json`;
const ATLAS_URL = `${import.meta.env.BASE_URL}countries-50m.json`;

/**
 * Ask for both maps at once → { map: Promise<Response>, atlas: Promise<string | null> }. The atlas is only ever read as
 * text and never rejects: a missing or unreadable atlas means drawing without it. A failed map request is boot's to
 * report ("MAP DATA FAILED TO LOAD"); it is marked handled here, so one that fails before boot asks for it is not also
 * reported as an unhandled rejection.
 */
export function requestMaps() {
  const map = fetch(MAP_URL);
  map.catch(() => {});
  const atlas = fetch(ATLAS_URL).then(response => (response.ok ? response.text() : null)).catch(() => null);
  return { map, atlas };
}

let early = null;

/** Start the requests now, once (startMapRequests.js, as the page's script starts). */
export function requestMapsEarly() {
  early ||= requestMaps();
}

/**
 * The requests started early, handed over once: boot's first run takes them, and Try again asks anew. Null when
 * nothing started them (the tests, which mount App without main.jsx).
 */
export function takeMapRequests() {
  const requests = early;
  early = null;
  return requests;
}
