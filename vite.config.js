import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The React SPA lives in web/ and builds to dist/, which the Worker serves
// as static assets (see wrangler.toml). During `vite dev` the /api and /auth
// calls are proxied to a locally-running `wrangler dev` on :8787.
export default defineConfig({
  root: 'web',
  publicDir: 'public',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/auth': 'http://localhost:8787',
    },
  },
  // Vitest: tests live in test/ at the repo root, not under web/.
  test: {
    root: '.',
    include: ['test/**/*.test.js'],
  },
});
