// The installable, offline game (README §Running it). vite.config.js hands these to vite-plugin-pwa, which writes
// manifest.webmanifest and the service worker sw.js into dist/; src/serviceWorker.js registers it in the page.

/** The web app manifest. Paths are relative, like Vite's `base`, so `dist/` installs from any subpath. */
export const APP_MANIFEST = Object.freeze({
  id: './',
  name: 'Imperialism',
  short_name: 'Imperialism',
  // index.html's description: what an install dialog shows.
  description: 'Sport decides the borders. Win a match to take all of the loser’s territory and one of its players. '
    + 'Football, women’s football, basketball, American football, baseball, ice hockey, tennis, women’s tennis and rugby league in your browser.',
  lang: 'en',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'any',
  // --surface in src/styles/tokens.css: the splash screen and title bar take the page's light ground.
  background_color: '#f5f5f2',
  theme_color: '#f5f5f2',
  categories: ['games', 'sports'],
  // The favicon's compass needle on clay (npm run build:icons); the maskable one draws it inside the central circle.
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
});

/** Other icons in public/ the page links to (index.html), precached with the manifest's. */
export const PAGE_ICONS = Object.freeze(['favicon.ico', 'favicon.svg', 'apple-touch-icon.png']);

/**
 * The app shell, precached when the worker installs (globs in dist/): under 3 MB of a build near 60 MB. Each new
 * version downloads it whole before the update prompt shows. Only the Archivo faces: fonts.css loads no others.
 */
export const PRECACHE = Object.freeze(['index.html', 'assets/**/*', 'fonts/archivo-*.woff2', 'world-110m.v1.json',
  'countries-50m.json']);

/**
 * Everything else in public/ is cached the first time the game uses it. Seasons and country maps come from the
 * network while online, so they always match the deployed build, and from the last copy offline. Flags and crests
 * rarely change: they show from the cache at once and refresh in the background. `pattern` is tested on the whole
 * URL; the caps hold every file in public/ with room to spare.
 */
export const RUNTIME_CACHES = Object.freeze([
  Object.freeze({ cacheName: 'imperialism-data', handler: 'NetworkFirst', maxEntries: 1000,
    pattern: /\/(?:football|womens-football|basketball|american-football|baseball|hockey|tennis|womens-tennis|rugby-league|domestic)\/[^/?#]+\.json$/ }),
  Object.freeze({ cacheName: 'imperialism-images', handler: 'StaleWhileRevalidate', maxEntries: 5000,
    pattern: /\/(?:flags|flags-symbols|club-logos|textures)\/[^/?#]+\.(?:svg|webp|png)$/ }),
]);

/** Whether the worker caches `url` on first use (a whole URL, as the worker sees it). */
export const isRuntimeCached = url => RUNTIME_CACHES.some(cache => cache.pattern.test(url));

/**
 * Opening a file directly (a season's JSON, a crest) is not a visit to the game: offline, every other navigation in
 * scope gets the cached index.html. Tested on the path and query.
 */
export const FILE_NAVIGATION = /\/[^/?#]+\.(?!html$)[a-z0-9]+$/i;
