import { test, expect } from '@playwright/test';

// Demo mode needs no auth, no Google, no D1 rows — it exercises the full
// stack (Worker → views.js → React render) with sample data.

test('demo log view renders the tracker', async ({ page }) => {
  await page.goto('/?demo');
  await expect(page.locator('#logView')).toBeVisible();
  await expect(page.getByText('Day summary')).toBeVisible();
  await expect(page.getByRole('button', { name: /Start|Log now/ })).toBeVisible();
});

test('demo stats view renders charts with actual bars', async ({ page }) => {
  await page.goto('/stats?demo');
  await expect(page.locator('.stat-table')).toBeVisible();
  // Recharts must have drawn real bar geometry, not just empty axes
  // (toBeAttached waits for the stats fetch to land and the bars to mount)
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeAttached();
});

test('error screen shows when the session check fails', async ({ page }) => {
  await page.route('**/api/me*', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByText('Something went wrong')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
});
