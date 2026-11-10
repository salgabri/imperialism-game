import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_MANIFEST, FILE_NAVIGATION, PAGE_ICONS, PRECACHE, RUNTIME_CACHES } from './src/pwa.js';

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
    // Installable and offline (src/pwa.js). The page registers the worker itself (src/serviceWorker.js) and runs the
    // update prompt, so a new version waits for the player instead of reloading a campaign.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: APP_MANIFEST,
      includeAssets: PAGE_ICONS,
      workbox: {
        globPatterns: PRECACHE,
        // The first chunk (the game and football's players) is about 1.8 MB; past this the build fails rather than ship a
        // worker without it. Every other sport's players are a chunk of their own (src/sports/sportData.lazy.js).
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
}));
