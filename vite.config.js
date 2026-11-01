import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

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
  plugins: [react(), adsense(loadEnv(mode, process.cwd(), 'VITE_ADSENSE_'))],
  // Relative asset URLs so `dist/` can be served from any subpath.
  base: './',
}));
