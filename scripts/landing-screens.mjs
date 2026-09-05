// Refresh the landing-page app screenshots (web/public/screens/) from demo
// mode. Run a dev server first, then:
//
//   npm run dev:worker &
//   node scripts/landing-screens.mjs
//   for f in web/public/screens/*.png; do sips --resampleWidth 520 "$f"; done
//
// Captured light-theme at 390×780 @2x so the phone frames on the landing page
// stay crisp on retina screens.
import { chromium } from 'playwright';

const PAGES = [
  ['/?demo', 'log'],
  ['/stats?demo', 'stats'],
  ['/growth?demo', 'growth'],
];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 780 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  colorScheme: 'light',
});
for (const [path, name] of PAGES) {
  await page.goto('http://localhost:8787' + path);
  await page.waitForTimeout(1800); // let data load and charts draw
  await page.screenshot({ path: `web/public/screens/${name}.png` });
  console.log('captured', name);
}

// the settings modal ("choose what to track") opens over the log view
await page.goto('http://localhost:8787/?demo');
await page.waitForTimeout(1800);
await page.getByRole('button', { name: 'Settings' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: 'web/public/screens/settings.png' });
console.log('captured settings');
await browser.close();
