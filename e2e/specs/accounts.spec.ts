import { test, expect } from '../fixtures';

test('signing in as someone else on the same device never shows the previous account’s data', async ({
  page,
}) => {
  // Coach Alex on the seeded team: sees the coach-only availability panel on Home.
  await page.goto('/signin');
  await page.getByRole('button', { name: /Alex Morgan/ }).click();
  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByRole('heading', { name: /Who's in/ })).toBeVisible();

  // Player Jess signs in on the same device without signing out first.
  await page.goto('/signin');
  await page.getByRole('button', { name: /Jess Taylor/ }).click();
  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByRole('heading', { name: /Jess/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Who's in/ })).toHaveCount(0);
  await expect(page.getByText('Copy a nudge')).toHaveCount(0);
});
