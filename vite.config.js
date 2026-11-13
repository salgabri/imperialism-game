import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv, normalizePath } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_MANIFEST, FILE_NAVIGATION, PRECACHE, RUNTIME_CACHES } from './src/pwa.js';

/** A config's public/ folder: Vite's default unless the config names another. */
const publicDirOf = config => path.resolve(config.root ?? process.cwd(), config.publicDir || 'public');

/**
 * Whether a build asks for public/football/index.json, the list of CM 01/02 sets built on this computer
 * (src/engine/footballSets.js): only when there was one to copy into dist/. Git ignores it, so a deployed build has
 * none, and asking cost every page load a request that could only fail. The dev server and the tests always ask.
 */
export function localSeasonIndex() {
  return {
    name: 'local-season-index',
    apply: 'build',
    config: config => ({
      define: { __LOCAL_SEASON_INDEX__: JSON.stringify(existsSync(path.join(publicDirOf(config), 'football', 'index.json'))) },
    }),
  };
}

/**
 * A build's world maps and fonts under content-hashed names in assets/ (README "Running it"). Workbox fetches a
 * precached file whose name has no hash past the browser's cache, so a first visit downloaded both maps and the fonts
 * twice: once for the page, then again for the worker. A hashed file it takes from the copy the page just loaded, and
 * vercel.json lets browsers keep assets/ for a year. The maps (src/mapRequests.js) learn their names from
 * __HASHED_MAPS__; the fonts go through fontsAsAssets. Build only: the dev server and the tests read public/ under the
 * plain names. Its inline PostCSS config means a build reads no postcss.config.js; the project has none, so a
 * PostCSS plugin the project ever needs goes beside fontsAsAssets.
 */
export function hashedShell({ maps = ['world-110m.v1.json', 'countries-50m.json'] } = {}) {
  let files = []; // [public file, its bytes, its name in dist/]
  return {
    name: 'hashed-shell',
    apply: 'build',
    config(config) {
      const publicDir = publicDirOf(config);
      files = maps.map(file => {
        const source = readFileSync(path.join(publicDir, file));
        const { name, ext } = path.parse(file);
        return [file, source, `assets/${name}-${createHash('sha256').update(source).digest('hex').slice(0, 8)}${ext}`];
      });
      return {
        define: { __HASHED_MAPS__: JSON.stringify(Object.fromEntries(files.map(([file, , name]) => [file, name]))) },
        css: { postcss: { plugins: [fontsAsAssets(publicDir)] } },
      };
    },
    generateBundle() {
      for (const [, source, fileName] of files) this.emitFile({ type: 'asset', fileName, source });
    },
  };
}

/**
 * A PostCSS step for hashedShell: src/fonts.css names its fonts by their public URLs (url('/fonts/…')), which Vite
 * leaves as they are. Each becomes a path from the stylesheet that names it to the file in public/, which Vite hashes
 * into assets/ like any asset. PostCSS, not a transform, because index.css @imports fonts.css: it runs after the import
 * is inlined and before Vite rewrites the URLs.
 */
export function fontsAsAssets(publicDir) {
  return {
    postcssPlugin: 'fonts-as-assets',
    Once(root) {
      root.walkDecls(declaration => {
        const from = declaration.source?.input.file;
        if (!from || !declaration.value.includes('/fonts/')) return;
        const toPublic = normalizePath(path.relative(path.dirname(from), publicDir));
        declaration.value = declaration.value.replace(/url\((['"]?)\/fonts\//g, `url($1${toPublic}/fonts/`);
      });
    },
  };
}

// React and football's built-in players and clubs (with sourceTable.js, which unpacks them and women's football's):
// about 170 KB compressed that a release of the game's code leaves alone.
const STABLE_MODULES = [
  /\/node_modules\/(?:react|react-dom|scheduler)\//,
  /\/src\/data\/(?:rosters|clubs\.football|sourceTable)\.js$/,
];
// The players of every sport but football (first download) and women's football (about as big as these seven together).
const SPORT_PLAYERS = /\/src\/data\/players\/(?!womens-football\.js$)[^/]+\.js$/;

/**
 * The chunk a module joins, Rollup's manualChunks (README "Caching"). Each release re-sends every file whose content
 * changed to every returning player, and a first visit's worker fetches every chunk:
 * - 'stable': STABLE_MODULES, out of the first chunk, which changes with every release. When only the game's code
 *   changes, a release re-sends about 290 KB compressed, not 500.
 * - 'sports': the seven smaller sports' players, one file instead of seven (4 to 11 KB compressed each), loaded the
 *   first time any of them is played (src/sports/sportData.lazy.js). Women's football's stay a chunk of their own.
 * Neither may import the first chunk, or every release would change them too: scripts/chunks.test.mjs checks the
 * import graph. Rollup adds a module's dependencies to its chunk, so a sport's own data files go with it.
 */
export function chunkOf(id) {
  const file = normalizePath(id);
  if (STABLE_MODULES.some(pattern => pattern.test(file))) return 'stable';
  if (SPORT_PLAYERS.test(file)) return 'sports';
  return undefined;
}

/**
 * AdSense (src/ads.js, README "Advertising"): a mistyped publisher or slot id stops the build instead of quietly serving
 * no ads, and a build with a publisher writes the ads.txt line AdSense looks for at the root of the domain.
 */
export function adsense({ VITE_ADSENSE_CLIENT: client, VITE_ADSENSE_SLOT: slot }) {
  return {
    name: 'adsense',
    config() {
      if (client && !/^ca-pub-\d{16}$/.test(client)) {
        throw new Error(`VITE_ADSENSE_CLIENT should look like ca-pub-1234567890123456, not "${client}".`);
      }
      if (slot && !/^\d+$/.test(slot)) throw new Error(`VITE_ADSENSE_SLOT should be the ad unit's number, not "${slot}".`);
    },
    generateBundle() {
      if (client) this.emitFile({ type: 'asset', fileName: 'ads.txt', source: `google.com, ${client.slice(3)}, DIRECT, f08c47fec0942fa0\n` });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    adsense(loadEnv(mode, process.cwd(), 'VITE_ADSENSE_')),
    localSeasonIndex(),
    hashedShell(),
    // Installable and offline (src/pwa.js). The page registers the worker itself (src/serviceWorker.js) and runs the
    // update prompt, so a new version waits for the player instead of reloading a campaign.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: APP_MANIFEST,
      // The icons stay out of the precache: the browser fetches the ones it shows itself, and an installed app keeps
      // its own copy. Precaching them cost every first visit six more requests; vercel.json lets browsers keep them a
      // day, so a return visit asks for none.
      includeManifestIcons: false,
      workbox: {
        globPatterns: PRECACHE,
        // The largest chunk (the game's code) is about 1 MB, football's players with React about 0.8 MB (chunkOf); past
        // this the build fails rather than ship a worker without one of them.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // The first install takes control of the open page, so what it loads next is cached for offline play. A
        // new version still waits (no skipWaiting) until the prompt's Reload.
        clientsClaim: true,
        skipWaiting: false,
        navigateFallbackDenylist: [FILE_NAVIGATION],
        runtimeCaching: RUNTIME_CACHES.map(({ cacheName, handler, maxEntries, pattern }) => ({
          urlPattern: pattern,
          handler,
          options: {
            cacheName,
            ...(handler === 'NetworkFirst' ? { networkTimeoutSeconds: 5 } : {}),
            cacheableResponse: { statuses: [200] },
            expiration: { maxEntries, purgeOnQuotaError: true },
          },
        })),
      },
    }),
  ],
  build: { rollupOptions: { output: { manualChunks: chunkOf } } },
  // Relative asset URLs so `dist/` can be served from any subpath.
  base: './',
}));
