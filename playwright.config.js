import { defineConfig } from '@playwright/test';

// Smoke tests: build the SPA, serve it through the real Worker (wrangler
// dev), and check the demo views actually render. This catches the class of
// failure unit tests can't — a green build that ships a blank page.
export default defineConfig({
  testDir: 'test/e2e',
  webServer: {
    // --host: with the custom-domain route in wrangler.toml, wrangler dev
    // would otherwise present requests as https://tinyloops.app
    command: 'npm run build && npx wrangler dev --port 8788 --host localhost:8788',
    url: 'http://127.0.0.1:8788/?demo',
    reuseExistingServer: false,
    timeout: 120000,
  },
  use: { baseURL: 'http://127.0.0.1:8788' },
});
