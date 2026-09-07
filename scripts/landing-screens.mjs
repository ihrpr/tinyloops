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

// Demo data is generated relative to "now", so capture at a fixed 20:45 —
// a full day of sleeps and feeds on every screen, whenever the script runs.
const evening = new Date();
evening.setHours(20, 45, 0, 0);
await page.clock.setFixedTime(evening);
for (const [path, name] of PAGES) {
  await page.goto('http://localhost:8787' + path);
  await page.waitForTimeout(1800); // let data load and charts draw
  await page.screenshot({ path: `web/public/screens/${name}.png` });
  console.log('captured', name);
}

// the day-strip widget: the log view scrolled so the Day summary owns the frame
await page.goto('http://localhost:8787/?demo');
await page.waitForTimeout(1800);
await page.locator('h2', { hasText: 'Day summary' })
  .evaluate((el) => window.scrollTo(0, el.offsetTop - 10));
await page.waitForTimeout(300);
await page.screenshot({ path: 'web/public/screens/rhythm.png' });
console.log('captured rhythm');

// the settings modal ("choose what to track") opens over the log view
await page.goto('http://localhost:8787/?demo');
await page.waitForTimeout(1800);
await page.getByRole('button', { name: 'Settings' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: 'web/public/screens/settings.png' });
console.log('captured settings');
await browser.close();
