import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_MANIFEST, FILE_NAVIGATION, PAGE_ICONS, PRECACHE, RUNTIME_CACHES } from './src/pwa.js';

export default defineConfig({
  plugins: [
    react(),
    // Installable and offline (src/pwa.js). The page registers the worker itself (src/serviceWorker.js) and runs the
    // update prompt, so a new version waits for the player instead of reloading a campaign.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: APP_MANIFEST,
      includeAssets: PAGE_ICONS,
      workbox: {
        globPatterns: PRECACHE,
        // The bundle is one ~1.7 MB chunk; past this the build fails rather than ship a worker without it.
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
  // Relative asset URLs so `dist/` can be served from any subpath.
  base: './',
});
