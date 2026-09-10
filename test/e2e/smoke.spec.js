import { test, expect } from '@playwright/test';

// Demo mode needs no auth, no Google, no D1 rows — it exercises the full
// stack (Worker → views.js → React render) with sample data.

test('demo log view renders the tracker', async ({ page }) => {
  await page.goto('/?demo');
  await expect(page.locator('#logView')).toBeVisible();
  await expect(page.getByText('Day summary')).toBeVisible();
  await expect(page.getByRole('button', { name: /Start|Log now/ })).toBeVisible();
  // the 24h day strip inside the summary widget, pageable to previous days
  await expect(page.locator('#summary .day-band')).toBeVisible();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.locator('#summary .day-name')).toHaveText('Yesterday');
  await expect(page.locator('#summary .day-band')).toBeVisible();
});

test('demo stats view renders charts with actual bars', async ({ page }) => {
  await page.goto('/stats?demo');
  // .first(): the foods-tried list is a second .stat-table once data lands
  await expect(page.locator('.stat-table').first()).toBeVisible();
  await expect(page.locator('.foods-table')).toBeVisible();
  // Recharts must have drawn real bar geometry, not just empty axes
  // (toBeAttached waits for the stats fetch to land and the bars to mount)
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeAttached();
  // the rhythm section: stacked week bands (today's loop lives on the log view)
  await expect(page.locator('.rhythm-week')).toBeVisible();
  // the night-stretch scatter with its worded verdict
  await expect(page.getByRole('heading', { name: 'Night stretch vs the day before' })).toBeVisible();
  await expect(page.locator('.recharts-scatter-symbol').first()).toBeAttached();
});

test('demo growth view renders WHO curves, points and the table', async ({ page }) => {
  await page.goto('/growth?demo');
  // five centile curves plus the baby's line, with dots on the measurements
  await expect(page.locator('.recharts-line').first()).toBeAttached();
  await expect(page.locator('.recharts-line-dot').first()).toBeAttached();
  await expect(page.getByRole('heading', { name: 'Weight (kg)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Height (cm)' })).toBeVisible();
  await expect(page.locator('.stat-table').first()).toBeVisible();
  await expect(page.getByText(/centile at/).first()).toBeVisible();
});

test('error screen shows when the session check fails', async ({ page }) => {
  await page.route('**/api/me*', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByText('Something went wrong')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
});
