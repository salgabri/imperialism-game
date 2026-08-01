import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs so `dist/` can be served from any subpath.
  base: './',
});
